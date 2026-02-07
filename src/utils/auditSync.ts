/**
 * Audit Log Sync Service
 * Syncs audit history to GitHub repo storage (.zynqos_storage/logs/)
 * Logs are saved as YYYY-MM-DD.json for easy cross-device access
 */

import { fetchGitHubFile, uploadGitHubFile, listGitHubFiles } from './githubApi.js'
import { base64ToString } from './encoding.js'

export type AuditEntry = {
  id: string
  ts: number
  ip: string
  route: string
  action?: string
  event: string
  status: 'success' | 'error'
  provider?: string
  message?: string
}

export type AuditSyncConfig = {
  autoSync: boolean
  lastSyncTime: number | null
  syncedDates?: Set<string> // Track which dates have been synced to avoid re-uploading
}

class AuditLogSyncService {
  private config: AuditSyncConfig = {
    autoSync: true,
    lastSyncTime: null,
    syncedDates: new Set()
  }
  private syncInProgress = false
  private pendingEntries: AuditEntry[] = []

  async init() {
    try {
      // Load config from localStorage
      const savedConfig = localStorage.getItem('zynqos_audit_sync_config')
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig)
        this.config = {
          ...parsed,
          // Convert array back to Set if needed
          syncedDates: parsed.syncedDates ? new Set(parsed.syncedDates) : new Set()
        }
      }

      // Load pending entries from localStorage
      const savedPending = localStorage.getItem('zynqos_audit_pending')
      if (savedPending) {
        this.pendingEntries = JSON.parse(savedPending)
      }

      // Pull existing audit logs from GitHub on init
      await this.pullAuditLogs()
    } catch (error) {
      console.error('[AuditSync] Init error:', error)
    }
  }

  /**
   * Track a new audit entry for syncing
   */
  async trackAuditEntry(entry: AuditEntry) {
    // Check if entry already exists (by ID)
    const exists = this.pendingEntries.some(e => e.id === entry.id)
    if (exists) {
      return // Don't track duplicates
    }

    this.pendingEntries.push(entry)
    this.savePendingToStorage()

    // Auto-sync if enabled
    if (this.config.autoSync) {
      // Debounce: sync after 5 seconds of no new entries
      this.debouncedSync()
    }
  }

  private syncTimeout: number | null = null
  private debouncedSync() {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout)
    }
    this.syncTimeout = window.setTimeout(() => {
      this.syncToGitHub().catch(console.error)
    }, 5000)
  }

  /**
   * Sync pending audit entries to GitHub storage
   */
  async syncToGitHub(): Promise<void> {
    if (this.syncInProgress || this.pendingEntries.length === 0) {
      return
    }

    this.syncInProgress = true

    try {
      // Check if user is authenticated
      const session = await this.getSession()
      if (!session?.connected || !session?.profile?.name) {
        console.warn('[AuditSync] User not authenticated, skipping sync')
        this.syncInProgress = false
        return
      }

      // Group entries by date
      const entriesByDate = this.groupEntriesByDate(this.pendingEntries)

      // Sync only dates with pending entries (not all dates from history)
      for (const [date, entries] of Object.entries(entriesByDate)) {
        await this.syncDateLog(date, entries)
        // Mark date as synced to avoid re-uploading
        this.config.syncedDates?.add(date)
      }

      // Clear pending entries
      this.pendingEntries = []
      this.savePendingToStorage()

      // Update last sync time
      this.config.lastSyncTime = Date.now()
      this.saveConfig()

      this.notifyStatusChange()
    } catch (error) {
      console.error('[AuditSync] Sync error:', error)
      throw error
    } finally {
      this.syncInProgress = false
    }
  }

  /**
   * Pull audit logs from GitHub storage
   */
  async pullAuditLogs(): Promise<Record<string, AuditEntry[]>> {
    try {
      const session = await this.getSession()
      if (!session?.connected || !session?.profile?.name) {
        return {}
      }

      const [owner, repo] = this.getRepoFullName(session).split('/')

      // List files in logs/ directory using centralized API
      const logFiles = await listGitHubFiles(owner, repo, 'logs')
      
      // Filter for *.json files
      const jsonFiles = logFiles.filter(
        (n: any) => n.type === 'blob' && n.path.endsWith('.json')
      )

      // Download and parse each log file
      const allLogs: Record<string, AuditEntry[]> = {}
      for (const file of jsonFiles) {
        const path = file.path as string
        const date = path.replace('logs/', '').replace('.json', '')

        const result = await fetchGitHubFile(owner, repo, path)

        if (result?.content) {
          try {
            const entries = this.parseJsonContent(result.content)
            if (Array.isArray(entries)) {
              allLogs[date] = entries
            }
          } catch (e) {
            console.error(`[AuditSync] Failed to parse log file ${path}:`, e)
          }
        }
      }

      return allLogs
    } catch (error) {
      console.error('[AuditSync] Pull error:', error)
      return {}
    }
  }

  /**
   * Get audit logs for a specific date
   */
  async getLogsForDate(date: string): Promise<AuditEntry[]> {
    const allLogs = await this.pullAuditLogs()
    return allLogs[date] || []
  }

  /**
   * Get audit logs for a date range
   */
  async getLogsForDateRange(startDate: string, endDate: string): Promise<AuditEntry[]> {
    const allLogs = await this.pullAuditLogs()
    const entries: AuditEntry[] = []

    for (const [date, logs] of Object.entries(allLogs)) {
      if (date >= startDate && date <= endDate) {
        entries.push(...logs)
      }
    }

    return entries.sort((a, b) => b.ts - a.ts)
  }

  /**
   * Sync a single date's log file to GitHub
   */
  private async syncDateLog(date: string, newEntries: AuditEntry[]) {
    const session = await this.getSession()
    if (!session?.connected || !session?.profile?.name) {
      throw new Error('Not authenticated')
    }

    const [owner, repo] = this.getRepoFullName(session).split('/')
    const path = `logs/${date}.json`

    // Fetch existing log file to get SHA and merge entries
    let existingEntries: AuditEntry[] = []
    let sha: string | undefined

    const existingFile = await fetchGitHubFile(owner, repo, path)
    if (existingFile?.content && existingFile?.sha) {
      try {
        const parsed = this.parseJsonContent(existingFile.content)
        if (Array.isArray(parsed)) {
          existingEntries = parsed
        }
      } catch (error) {
        console.warn(`[AuditSync] Failed to parse existing log ${path}, overwriting.`, error)
      }
      sha = existingFile.sha
    }

    // Merge entries (dedupe by ID)
    const mergedEntries = [...existingEntries]
    const existingIds = new Set(existingEntries.map(e => e.id))

    for (const entry of newEntries) {
      if (!existingIds.has(entry.id)) {
        mergedEntries.push(entry)
      }
    }

    // Sort by timestamp
    mergedEntries.sort((a, b) => a.ts - b.ts)

    // Upload to GitHub using centralized API
    await uploadGitHubFile({
      owner,
      repo,
      path,
      content: JSON.stringify(mergedEntries, null, 2),
      message: `Update audit log for ${date}`,
      sha
    })
  }

  /**
   * Group entries by date (YYYY-MM-DD format)
   */
  private groupEntriesByDate(entries: AuditEntry[]): Record<string, AuditEntry[]> {
    const grouped: Record<string, AuditEntry[]> = {}

    for (const entry of entries) {
      const date = new Date(entry.ts).toISOString().split('T')[0]
      if (!grouped[date]) {
        grouped[date] = []
      }
      grouped[date].push(entry)
    }

    return grouped
  }

  /**
   * Get session info from API
   */
  private async getSession() {
    try {
      const res = await fetch('/api?route=auth&action=status', { credentials: 'include' })
      if (res.ok) {
        return await res.json()
      }
    } catch (error) {
      console.error('[AuditSync] Failed to get session:', error)
    }
    return null
  }

  /**
   * Get repository full name from session
   */
  private getRepoFullName(session: any): string {
    if (session.profile?.repoFullName) {
      return session.profile.repoFullName
    }
    const username = session.profile?.name || 'unknown'
    return `${username}/.zynqos_storage`
  }

  /**
   * Save pending entries to localStorage
   */
  private savePendingToStorage() {
    try {
      localStorage.setItem('zynqos_audit_pending', JSON.stringify(this.pendingEntries))
    } catch (e) {
      console.error('[AuditSync] Failed to save pending entries:', e)
    }
  }

  /**
   * Save config to localStorage
   */
  private saveConfig() {
    try {
      // Convert Set to array for JSON serialization
      const configToSave = {
        ...this.config,
        syncedDates: Array.from(this.config.syncedDates || [])
      }
      localStorage.setItem('zynqos_audit_sync_config', JSON.stringify(configToSave))
    } catch (e) {
      console.error('[AuditSync] Failed to save config:', e)
    }
  }

  /**
   * Notify UI of status changes
   */
  private notifyStatusChange() {
    window.dispatchEvent(new CustomEvent('microos:audit-sync-changed', {
      detail: {
        lastSyncTime: this.config.lastSyncTime,
        pendingCount: this.pendingEntries.length,
        syncing: this.syncInProgress
      }
    }))
  }

  /**
   * Enable/disable auto-sync
   */
  async setAutoSync(enabled: boolean) {
    this.config.autoSync = enabled
    this.saveConfig()

    // If enabling and there are pending entries, sync immediately
    if (enabled && this.pendingEntries.length > 0) {
      await this.syncToGitHub()
    }
  }

  /**
   * Get current config
   */
  getConfig(): AuditSyncConfig {
    return { ...this.config }
  }

  /**
   * Get sync status
   */
  getStatus() {
    return {
      syncing: this.syncInProgress,
      pendingCount: this.pendingEntries.length,
      lastSyncTime: this.config.lastSyncTime,
      autoSync: this.config.autoSync
    }
  }

  private parseJsonContent(content: string | Uint8Array): unknown {
    if (content instanceof Uint8Array) {
      const text = new TextDecoder().decode(content)
      return JSON.parse(text)
    }

    try {
      return JSON.parse(content)
    } catch {
      const decoded = base64ToString(content)
      return JSON.parse(decoded)
    }
  }
}

// Singleton instance
export const auditSync = new AuditLogSyncService()
