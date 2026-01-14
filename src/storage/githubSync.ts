// GitHub sync service for pushing/pulling user data to their own repo
import { openDB, type IDBPDatabase } from 'idb'

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
    const readme = btoa('# MicroOS Data\n\nThis repository stores your MicroOS data, including files, settings, and logs.')
    
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
            content: btoa('')
          })
        })
      }
    } catch (error) {
      console.error('Create initial structure error:', error)
    }
  }

  async trackChange(path: string, content: string) {
    if (!this.db) return
    
    // Remove from deletions if it was marked for deletion
    try {
      await this.db.delete('pending-deletions', path)
    } catch {}
    
    await this.db.put('pending-changes', {
      path,
      content,
      timestamp: Date.now()
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
        // Sanitize path: remove leading slashes, backslashes, and '..'
        let safePath = change.path.replace(/^\/+/, "").replace(/\\/g, "/").replace(/\.\./g, "");
        // Remove any accidental double slashes
        safePath = safePath.replace(/\/+/, '/');
        // Don't add 'files/' prefix for logs/ directory and settings.json (they're at repo root)
        const isSpecialPath = safePath.startsWith('logs/') || safePath === 'settings.json';
        const githubPath = isSpecialPath ? safePath : `files/${safePath}`;
        // Ensure content is valid Base64, support binary files
        let base64Content = change.content;
        function isBase64(str) {
          try { atob(str); return true; } catch { return false; }
        }
        if (!isBase64(base64Content)) {
          // If value is a string, encode as UTF-8, else assume Uint8Array
          let bytes;
          if (typeof change.content === 'string') {
            bytes = new TextEncoder().encode(change.content);
          } else if (change.content instanceof Uint8Array) {
            bytes = change.content;
          } else if (Array.isArray(change.content)) {
            bytes = Uint8Array.from(change.content);
          } else {
            bytes = new TextEncoder().encode(String(change.content || ''));
          }
          // Use streaming-safe base64 encoder
          base64Content = btoa(Array.prototype.map.call(bytes, (ch) => String.fromCharCode(ch)).join(''));
        }
        // Ensure content is always a valid base64 string (even if empty file)
        if (!base64Content) {
          base64Content = btoa('');
        }
        // Fetch latest SHA for the file (required for update, 404 means new file)
        let sha = undefined;
        try {
          const shaRes = await fetch(`/api?route=storage&provider=github&action=download&owner=${owner}&repo=${repo}&path=${encodeURIComponent(githubPath)}`, { credentials: 'include' });
          if (shaRes.ok) {
            const shaJson = await shaRes.json();
            if (shaJson.sha) sha = shaJson.sha;
          } else if (shaRes.status === 401) {
            const handled = await this.handleUnauthorized();
            if (!handled) throw new Error('GitHub session expired');
          } else if (shaRes.status !== 404) {
            console.warn(`Failed to fetch SHA for ${githubPath}:`, shaRes.status);
          }
          // 404 is expected for new files, no warning needed
        } catch (e) {
          console.debug('SHA fetch error (file may not exist yet):', e);
        }
        const upRes = await fetch('/api?route=storage&provider=github&action=upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            owner,
            repo,
            path: githubPath,
            content: base64Content,
            message: `Sync ${githubPath}`,
            ...(sha ? { sha } : {})
          })
        });
        if (upRes.status === 401) {
          const handled = await this.handleUnauthorized();
          if (!handled) throw new Error('GitHub session expired');
        }
        if (!upRes.ok) {
          const err = await upRes.json().catch(() => ({ error: 'Upload failed' }))
          if (upRes.status === 401) {
            const session = await this.getSession()
            if (session?.provider === 'github') {
              throw new Error('Your GitHub OAuth token does not have repo write access. Click "Configure GitHub App" to sign in via the app for full sync access to ' + repo)
            }
            throw new Error('GitHub authentication failed. Ensure the app is installed on the correct repository.')
          }
          throw new Error(err.error || 'Upload failed')
        }
      }

      // Process deletions
      for (const deletion of pendingDeletions) {
        let safePath = deletion.path.replace(/^\/+/, "").replace(/\\/g, "/").replace(/\.\./g, "");
        safePath = safePath.replace(/\/+/, '/');
        // Don't add 'files/' prefix for logs/ directory and settings.json (they're at repo root)
        const isSpecialPath = safePath.startsWith('logs/') || safePath === 'settings.json';
        const githubPath = isSpecialPath ? safePath : `files/${safePath}`;
        
        // Get file SHA for deletion
        try {
          const shaRes = await fetch(`/api?route=storage&provider=github&action=download&owner=${owner}&repo=${repo}&path=${encodeURIComponent(githubPath)}`, { credentials: 'include' });
          if (shaRes.ok) {
            const shaJson = await shaRes.json();
            if (shaJson.sha) {
              // Delete the file using GitHub API
              const delRes = await fetch(`/api?route=storage&provider=github&action=delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  owner,
                  repo,
                  path: githubPath,
                  sha: shaJson.sha,
                  message: `Delete ${githubPath}`
                })
              });
              if (!delRes.ok && delRes.status !== 404) {
                console.error(`Failed to delete ${githubPath}:`, await delRes.text())
              }
            }
          } else if (shaRes.status === 404) {
            console.debug(`File ${githubPath} already deleted from GitHub`)
          }
        } catch (e) {
          console.debug(`Error fetching SHA for deletion of ${githubPath}:`, e)
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
      // List tree
      const listRes = await fetch(`/api?route=storage&provider=github&action=list&owner=${owner}&repo=${repo}`, {
        credentials: 'include'
      })
      if (!listRes.ok) {
        if (listRes.status === 401) {
          const handled = await this.handleUnauthorized();
          if (!handled) throw new Error('GitHub session expired. Please log in again.');
        }
        const err = await listRes.json().catch(() => ({ error: 'List failed' }))
        throw new Error(err.error || 'List failed')
      }
      const listJson = await listRes.json()
      const tree = Array.isArray(listJson.tree) ? listJson.tree : []

      // Pull files from files/, logs/ directory, and settings.json
      const fileEntries = tree.filter((n: any) => {
        if (n.type !== 'blob' || typeof n.path !== 'string') return false;
        const path = n.path as string;
        return path.startsWith('files/') || path.startsWith('logs/') || path === 'settings.json';
      });

      for (const entry of fileEntries) {
        const githubPath = entry.path as string;
        const dlRes = await fetch(`/api?route=storage&provider=github&action=download&owner=${owner}&repo=${repo}&path=${encodeURIComponent(githubPath)}`, {
          credentials: 'include'
        });
        if (dlRes.status === 401) {
          const handled = await this.handleUnauthorized();
          if (!handled) throw new Error('GitHub session expired');
        }
        if (!dlRes.ok) continue;
        const dlJson = await dlRes.json();
        if (!dlJson.content) continue;
        const decoded = Uint8Array.from(atob(dlJson.content), c => c.charCodeAt(0));
        // Store in VFS after stripping 'files/' prefix (handled by writeVfs)
        await this.writeVfs(githubPath, decoded);
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
      let vfsPath = path.replace(/^\/+/, "");
      // Strip 'files/' prefix but keep logs/, settings/, audit/ as-is
      if (vfsPath.startsWith('files/')) {
        vfsPath = vfsPath.slice('files/'.length);
      }
      // logs/, settings/, audit/ remain at their paths
      // Heuristic: treat as text if .md, .txt, .js, .ts, .json, .py, .html, .css, .csv, .log, .sh, .xml, .yml, .yaml
      const isText = /\.(md|txt|js|ts|json|py|html|css|csv|log|sh|xml|yml|yaml)$/i.test(vfsPath);
      let toStore: string | Uint8Array = data;
      if (isText) {
        try {
          toStore = new TextDecoder('utf-8').decode(data);
        } catch (e) {
          // fallback: store as Uint8Array
          toStore = data;
        }
      }
      console.debug('[githubSync] writeVfs', { path, vfsPath, isText, dataType: data?.constructor?.name, dataLen: data?.length });
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
      let vfsPath = path.replace(/^\/+/, "");
      // Strip 'files/' prefix but keep logs/, settings/, audit/ as-is
      if (vfsPath.startsWith('files/')) {
        vfsPath = vfsPath.slice('files/'.length);
      }
      // logs/, settings/, audit/ remain at their paths
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
}

// Singleton instance
export const githubSync = new GitHubSyncService()
