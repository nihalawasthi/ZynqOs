// GitHub sync service for pushing/pulling user data to their own repo
import { openDB, type IDBPDatabase } from 'idb'
import { fetchGitHubFileSha, uploadGitHubFile, deleteGitHubFile, listGitHubFiles, downloadGitHubFile } from '../utils/githubApi'
import { sanitizeGitHubPath, vfsToGitHubPath, githubToVfsPath } from '../utils/pathUtils'
import { toBase64, uint8ArrayToBase64 } from '../utils/encoding'

const SYNC_REPO_NAME = '.zynqos_storage'
const SYNC_BRANCH = 'main'

type SyncConfig = {
  repoFullName: string // e.g., "username/microos-data"
  lastSyncCommitSha: string | null
  autoSyncEnabled: boolean
  autoSyncIntervalMinutes: number | null
}

type FileBlob = {
  path: string
  content: string // base64 encoded
  sha?: string // for updates
}

type SyncStatus = {
  syncing: boolean
  lastSyncTime: number | null
  error: string | null
  pendingChanges: number
  pulling?: boolean
}

class GitHubSyncService {
  private db: IDBPDatabase | null = null
  private config: SyncConfig | null = null
  private syncInterval: number | null = null
  private isPulling = false // Flag to prevent tracking during pull
  private status: SyncStatus = {
    syncing: false,
    lastSyncTime: null,
    error: null,
    pendingChanges: 0
  }

  // Handle 401 responses with automatic re-authentication check
  private async handleUnauthorized() {
    try {
      console.warn('[githubSync] Received 401 Unauthorized, checking session validity')
      // Check if we still have a valid session
      const statusRes = await fetch('/api?route=auth&action=status', { credentials: 'include' })
      const statusJson = await statusRes.json()
      
      if (!statusJson.authenticated && !statusJson.connected) {
        // Session is invalid, prompt user to re-authenticate
        throw new Error('GitHub session expired. Please re-authenticate.')
      }
      // Session is still valid, might be a temporary issue
      return true
    } catch (error) {
      console.error('[githubSync] Session check failed:', error)
      this.status.error = 'GitHub authentication failed. Please log in again.'
      this.notifyStatusChange()
      // Dispatch event to prompt UI for re-authentication
      window.dispatchEvent(new CustomEvent('microos:auth-required', { detail: { provider: 'github' } }))
      return false
    }
  }

  async init() {
    try {
      // Open IndexedDB for tracking sync state
      this.db = await openDB('microos-sync', 2, {
        upgrade(db, oldVersion) {
          if (!db.objectStoreNames.contains('sync-config')) {
            db.createObjectStore('sync-config')
          }
          if (!db.objectStoreNames.contains('pending-changes')) {
            db.createObjectStore('pending-changes', { keyPath: 'path' })
          }
          if (!db.objectStoreNames.contains('pending-deletions')) {
            db.createObjectStore('pending-deletions', { keyPath: 'path' })
          }
        }
      })

      // Load config
      this.config = await this.db.get('sync-config', 'current') || null

      // If no config, attempt to infer from auth status (GitHub OAuth) using default repo name
      if (!this.config) {
        const inferred = await this.inferConfigFromSession()
        if (inferred) {
          this.config = inferred
          await this.db.put('sync-config', this.config, 'current')
        }
      }

      // Migrate legacy repo name (microos-data) to new default for current login
      if (this.config && this.config.repoFullName.endsWith('/microos-data')) {
        const migrated = await this.inferConfigFromSession()
        if (migrated) {
          this.config = { ...this.config, repoFullName: migrated.repoFullName }
          await this.db.put('sync-config', this.config, 'current')
        }
      }

      // Normalize owner to current login if available
      const session = await this.getSession()
      if (session?.profile?.name && this.config) {
        const login = session.profile.name
        const [, repoName] = this.config.repoFullName.split('/')
        const desired = `${login}/${repoName}`
        if (this.config.repoFullName !== desired) {
          this.config.repoFullName = desired
          await this.db.put('sync-config', this.config, 'current')
        }
      }
      
      // Load pending changes count
      const pendingChanges = await this.db.getAll('pending-changes')
      this.status.pendingChanges = pendingChanges.length

      // Start auto-sync if enabled
      if (this.config?.autoSyncEnabled && this.config.autoSyncIntervalMinutes) {
        this.startAutoSync(this.config.autoSyncIntervalMinutes)
      }

      // Auto pull once on init (best-effort)
      if (this.config) {
        this.pullFromGitHub().catch(() => {})
      }
    } catch (error) {
      console.error('Failed to initialize GitHub sync:', error)
    }
  }

  async setupRepo(accessToken: string, username: string): Promise<string> {
    const repoName = SYNC_REPO_NAME
    const repoFullName = `${username}/${repoName}`

    try {
      // Check if repo exists
      const checkRes = await fetch(`https://api.github.com/repos/${repoFullName}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json'
        }
      })

      if (checkRes.status === 404) {
        // Create new repo
        const createRes = await fetch('https://api.github.com/user/repos', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: repoName,
            private: true,
            description: 'MicroOS user data storage',
            auto_init: true
          })
        })

        if (!createRes.ok) {
          throw new Error('Failed to create repo')
        }

        // Initialize with README
        await this.createInitialStructure(accessToken, repoFullName)
      }

      // Save config
      this.config = {
        repoFullName,
        lastSyncCommitSha: null,
        autoSyncEnabled: false,
        autoSyncIntervalMinutes: null
      }

      await this.db?.put('sync-config', this.config, 'current')

      return repoFullName
    } catch (error) {
      console.error('Setup repo error:', error)
      throw error
    }
  }

  private async createInitialStructure(accessToken: string, repoFullName: string) {
    const readme = toBase64('# MicroOS Data\n\nThis repository stores your MicroOS data, including files, settings, and logs.')
    
    try {
      await fetch(`https://api.github.com/repos/${repoFullName}/contents/README.md`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: 'Initialize MicroOS data repo',
          content: readme
        })
      })

      // Create directory structure via .gitkeep files
      const dirs = ['files', 'logs', 'settings', 'audit']
      for (const dir of dirs) {
        await fetch(`https://api.github.com/repos/${repoFullName}/contents/${dir}/.gitkeep`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: `Create ${dir} directory`,
            content: toBase64('')
          })
        })
      }
    } catch (error) {
      console.error('Create initial structure error:', error)
    }
  }

  async trackChange(path: string, content: string | Uint8Array | ArrayBuffer) {
    if (!this.db) return
    
    // Remove from deletions if it was marked for deletion
    try {
      await this.db.delete('pending-deletions', path)
    } catch {}
    
    // Normalize content for storage
    let storedContent = content;
    if (content instanceof ArrayBuffer) {
      storedContent = new Uint8Array(content);
    }
    
    await this.db.put('pending-changes', {
      path,
      content: storedContent,
      timestamp: Date.now(),
      isBinary: content instanceof Uint8Array || content instanceof ArrayBuffer
    })

    const pendingChanges = await this.db.getAll('pending-changes')
    const pendingDeletions = await this.db.getAll('pending-deletions')
    this.status.pendingChanges = pendingChanges.length + pendingDeletions.length
    this.notifyStatusChange()
  }

  async trackDeletion(path: string) {
    if (!this.db) return
    
    // Don't track deletions during pull (remote deletions)
    if (this.isPulling) return
    
    // Remove from changes if it was marked for upload
    try {
      await this.db.delete('pending-changes', path)
    } catch {}
    
    await this.db.put('pending-deletions', {
      path,
      timestamp: Date.now()
    })

    const pendingChanges = await this.db.getAll('pending-changes')
    const pendingDeletions = await this.db.getAll('pending-deletions')
    this.status.pendingChanges = pendingChanges.length + pendingDeletions.length
    this.notifyStatusChange()
  }

  async syncToGitHub(): Promise<void> {
    if (!this.config || !this.db) {
      throw new Error('Sync not initialized')
    }

    if (this.status.syncing) {
      console.log('Sync already in progress')
      return
    }

    this.status.syncing = true
    this.status.error = null
    this.notifyStatusChange()

    try {
      const pendingChanges = await this.db.getAll('pending-changes')
      const pendingDeletions = await this.db.getAll('pending-deletions')
      
      if (pendingChanges.length === 0 && pendingDeletions.length === 0) {
        console.log('No pending changes to sync')
        this.status.syncing = false
        return
      }

      // Use server-side upload per file (token comes from session cookie)
      const [owner, repo] = this.config.repoFullName.split('/')
      for (const change of pendingChanges) {
        // Sanitize and convert VFS path to GitHub path
        const githubPath = vfsToGitHubPath(change.path);
        // Ensure content is valid Base64, support binary files
        let base64Content = change.content;
        function isBase64(str) {
          if (typeof str !== 'string') return false;
          try { atob(str); return true; } catch { return false; }
        }
        if (typeof base64Content !== 'string' || !isBase64(base64Content)) {
          // Use centralized encoding utility
          if (typeof change.content === 'string') {
            base64Content = toBase64(change.content);
          } else if (change.content instanceof Uint8Array) {
            base64Content = uint8ArrayToBase64(change.content);
          } else if (Array.isArray(change.content)) {
            base64Content = uint8ArrayToBase64(Uint8Array.from(change.content));
          } else {
            base64Content = toBase64(String(change.content || ''));
          }
        }
        // Ensure content is always a valid base64 string (even if empty file)
        if (!base64Content) {
          base64Content = toBase64('');
        }
        // Fetch latest SHA for the file (required for update, 404 means new file)
        const sha = await fetchGitHubFileSha(owner, repo, githubPath);
        
        // Upload using centralized API
        await uploadGitHubFile({
          owner,
          repo,
          path: githubPath,
          content: base64Content,
          message: `Sync ${githubPath}`,
          sha: sha || undefined
        });
      }

      // Process deletions
      for (const deletion of pendingDeletions) {
        // Sanitize and convert VFS path to GitHub path
        const githubPath = vfsToGitHubPath(deletion.path);
        
        // Get file SHA for deletion
        const sha = await fetchGitHubFileSha(owner, repo, githubPath);
        if (sha) {
          await deleteGitHubFile({
            owner,
            repo,
            path: githubPath,
            sha,
            message: `Delete ${githubPath}`
          });
        }
      }

      // Clear pending changes and deletions
      const tx = this.db.transaction(['pending-changes', 'pending-deletions'], 'readwrite')
      await tx.objectStore('pending-changes').clear()
      await tx.objectStore('pending-deletions').clear()
      await tx.done

      // Update config
      // Commit SHA not available via content API; mark lastSyncTime only
      await this.db.put('sync-config', this.config, 'current')

      // Update status
      this.status.lastSyncTime = Date.now()
      this.status.pendingChanges = 0
      this.status.syncing = false

      // Update server
      await fetch('/api/user-data?action=update-sync', {
        method: 'POST',
        credentials: 'include'
      })

      this.notifyStatusChange()
      console.log('Sync completed successfully')
    } catch (error) {
      this.status.syncing = false
      this.status.error = error instanceof Error ? error.message : 'Sync failed'
      this.notifyStatusChange()
      throw error
    }
  }

  async pullFromGitHub(): Promise<void> {
    if (!this.config || !this.db) {
      throw new Error('Sync not initialized')
    }

    const [owner, repo] = this.config.repoFullName.split('/')
    this.status.pulling = true
    this.isPulling = true // Set flag to prevent tracking deletions
    this.notifyStatusChange()

    try {
      // List tree using centralized API
      const tree = await listGitHubFiles(owner, repo);

      // Pull files from files/, logs/ directory, and settings.json
      const fileEntries = tree.filter((n: any) => {
        if (n.type !== 'blob' || typeof n.path !== 'string') return false;
        const path = n.path as string;
        return path.startsWith('files/') || path.startsWith('logs/') || path === 'settings.json';
      });

      for (const entry of fileEntries) {
        const githubPath = entry.path as string;
        const result = await downloadGitHubFile(owner, repo, githubPath);
        
        if (result?.content instanceof Uint8Array) {
          // Store in VFS
          await this.writeVfs(githubPath, result.content);
        }
      }

      this.status.error = null
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : 'Pull failed'
      throw error
    } finally {
      this.status.pulling = false
      this.isPulling = false // Reset flag
      this.notifyStatusChange()
    }
  }

  async setAutoSync(enabled: boolean, intervalMinutes: number | null) {
    if (!this.config || !this.db) return

    this.config.autoSyncEnabled = enabled
    this.config.autoSyncIntervalMinutes = intervalMinutes

    await this.db.put('sync-config', this.config, 'current')

    // Update server
    await fetch('/api/user-data?action=update-auto-sync-interval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ intervalMinutes: enabled ? intervalMinutes : null })
    })

    if (enabled && intervalMinutes) {
      this.startAutoSync(intervalMinutes)
    } else {
      this.stopAutoSync()
    }
  }

  private startAutoSync(intervalMinutes: number) {
    this.stopAutoSync()
    
    this.syncInterval = window.setInterval(async () => {
      try {
        // Push first to ensure local VFS changes are uploaded to GitHub
        await this.syncToGitHub()
        // Then pull to get any remote changes
        await this.pullFromGitHub()
      } catch (error) {
        console.error('Auto-sync error:', error)
      }
    }, intervalMinutes * 60 * 1000)
  }

  private stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
  }

  private async writeVfs(path: string, data: Uint8Array) {
    try {
      const mod = await import('../vfs/fs');
      // Convert GitHub path to VFS path
      const vfsPath = githubToVfsPath(path);
      
      // Heuristic: treat as text if .md, .txt, .js, .ts, .json, .py, .html, .css, .csv, .log, .sh, .xml, .yml, .yaml
      // Binary formats: pdf, png, jpg, jpeg, gif, webp, zip, tar, gz, bin, wasm
      const isText = /\.(md|txt|js|ts|json|py|html|css|csv|log|sh|xml|yml|yaml)$/i.test(vfsPath);
      const isBinary = /\.(pdf|png|jpg|jpeg|gif|webp|zip|tar|gz|bin|wasm|exe|dll|so|dylib)$/i.test(vfsPath);
      let toStore: string | Uint8Array = data;
      
      if (isText && !isBinary) {
        try {
          toStore = new TextDecoder('utf-8', { fatal: true }).decode(data);
        } catch (e) {
          // fallback: store as Uint8Array for encoding errors
          console.debug('[githubSync] Could not decode as UTF-8, storing as binary:', vfsPath);
          toStore = data;
        }
      }
      // Binary files always stored as Uint8Array
      console.debug('[githubSync] writeVfs', { path, vfsPath, isText, isBinary, dataType: data?.constructor?.name, dataLen: data?.length });
      await mod.writeFile(vfsPath, toStore);
    } catch (e) {
      console.error('Failed to write to VFS:', e, path);
    }
  }

  private async listVfsFiles(): Promise<string[]> {
    try {
      const mod = await import('../vfs/fs');
      const allPaths = await mod.readdir('');
      // Return paths without 'files/' prefix (VFS paths)
      return allPaths.map(p => p.replace(/^\//, ''));
    } catch (e) {
      console.error('Failed to list VFS files:', e);
      return [];
    }
  }

  private async deleteVfs(path: string) {
    try {
      const mod = await import('../vfs/fs');
      // Convert GitHub path to VFS path
      const vfsPath = githubToVfsPath(path);
      await mod.removeFile(vfsPath);
    } catch (e) {
      console.error('Failed to delete from VFS:', e, path);
    }
  }

  private async getSession() {
    try {
      const res = await fetch('/api?route=auth&action=status', { credentials: 'include' })
      const data = await res.json()
      return data
    } catch {
      return null
    }
  }

  private async inferConfigFromSession(): Promise<SyncConfig | null> {
    const session = await this.getSession()
    if (!session || !session.profile || !session.profile.name) return null
    const login = session.profile.name
    return {
      repoFullName: `${login}/${SYNC_REPO_NAME}`,
      lastSyncCommitSha: null,
      autoSyncEnabled: false,
      autoSyncIntervalMinutes: null
    }
  }

  getStatus(): SyncStatus {
    return { ...this.status }
  }

  private notifyStatusChange() {
    window.dispatchEvent(new CustomEvent('microos:sync-status-changed', {
      detail: this.getStatus()
    }))
  }

  getConfig(): SyncConfig | null {
    return this.config ? { ...this.config } : null
  }

  /**
   * Sync a single file to GitHub
   * Tracks the file change and triggers sync immediately
   */
  async syncFileToGitHub(path: string, content: string | Uint8Array | ArrayBuffer): Promise<void> {
    await this.trackChange(path, content)
    await this.syncToGitHub()
  }

  /**
   * Pull all files from GitHub
   * Note: GitHub sync pulls entire directory as individual requests per file
   * If you need to reload a specific file after pull, use readFile from VFS
   */
  async pullFileFromGitHub(path: string): Promise<void> {
    // Pull entire repository (that's how the sync works)
    await this.pullFromGitHub()
    // Caller should re-read the specific file from VFS after pull
  }
}

// Singleton instance
export const githubSync = new GitHubSyncService()
