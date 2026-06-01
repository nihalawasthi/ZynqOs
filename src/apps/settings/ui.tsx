import React, { useState, useEffect } from 'react'
import { toast } from '../../hooks/use-toast'
import { getStorageStatus, disconnectStorage, type StorageStatus, connectGitHubRepo } from '../../auth/storage'
import { githubSync } from '../../storage/githubSync'
import { auditSync, type AuditEntry as AuditSyncEntry } from '../../utils/auditSync'
import { readFile, writeFile, removeFile, readdir } from '../../vfs/fs'
import { useTheme } from '../../hooks/useTheme'

type TabType = 'display' | 'storage' | 'security' | 'system' | 'about'

type UserSettings = {
    version: string
    display: {
        theme: 'dark' | 'light'
        wallpaper: {
            source: string
            size: string
            position: string
            repeat: string
        }
    }
    remotePython: {
        enabled: boolean
        baseUrl: string
        userId: string
        overwriteOnPull: boolean
        pullIntervalSec: number
    }
    sync: {
        autoSyncEnabled: boolean
        autoSyncIntervalMinutes: number
    }
    audit: {
        autoSync: boolean
    }
}

const DEFAULT_SETTINGS: UserSettings = {
    version: '1.0.0',
    display: {
        theme: 'dark',
        wallpaper: {
            source: '/assets/wallpaper.png',
            size: '60%',
            position: 'center',
            repeat: 'no-repeat'
        }
    },
    remotePython: {
        enabled: false,
        baseUrl: '',
        userId: '',
        overwriteOnPull: false,
        pullIntervalSec: 60
    },
    sync: {
        autoSyncEnabled: false,
        autoSyncIntervalMinutes: 30
    },
    audit: {
        autoSync: true
    }
}

type AuditEntry = {
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

type SyncStatus = {
    syncing: boolean
    lastSyncTime: number | null
    error: string | null
    pendingChanges: number
}

const REMOTE_PY_API_KEY_STORAGE = 'zynqos_remote_python_api_key'

export default function SettingsUI() {
    const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
    const [activeTab, setActiveTab] = useState<TabType>('about')
    const [storageStatus, setStorageStatus] = useState<StorageStatus>({ connected: false })
    const [sessionTime, setSessionTime] = useState<string>('0s')
    const [cacheSize, setCacheSize] = useState<string>('calculating...')
    const [cacheRatio, setCacheRatio] = useState<number>(0)
    const [profile, setProfile] = useState<any>(null)
    const [wallpaperLoading, setWallpaperLoading] = useState(false)
    const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
    const [auditLoading, setAuditLoading] = useState(false)
    const [auditError, setAuditError] = useState<string | null>(null)
    const [syncStatus, setSyncStatus] = useState<SyncStatus>({
        syncing: false,
        lastSyncTime: null,
        error: null,
        pendingChanges: 0
    })
    const [autoSyncEnabled, setAutoSyncEnabled] = useState(DEFAULT_SETTINGS.sync.autoSyncEnabled)
    const [autoSyncInterval, setAutoSyncInterval] = useState<number>(DEFAULT_SETTINGS.sync.autoSyncIntervalMinutes)
    const [remotePythonEnabled, setRemotePythonEnabled] = useState(DEFAULT_SETTINGS.remotePython.enabled)
    const [remotePythonBaseUrl, setRemotePythonBaseUrl] = useState(DEFAULT_SETTINGS.remotePython.baseUrl || 'http://13.233.236.112:8000')
    const [remotePythonUserId, setRemotePythonUserId] = useState(DEFAULT_SETTINGS.remotePython.userId)
    const [remotePythonOverwriteOnPull, setRemotePythonOverwriteOnPull] = useState(DEFAULT_SETTINGS.remotePython.overwriteOnPull)
    const [remotePythonPullIntervalSec, setRemotePythonPullIntervalSec] = useState(DEFAULT_SETTINGS.remotePython.pullIntervalSec)
    const [remotePythonApiKey, setRemotePythonApiKey] = useState('')
    const [remoteConflictFiles, setRemoteConflictFiles] = useState<string[]>([])
    const [remoteConflictLoading, setRemoteConflictLoading] = useState(false)
    const [remoteConflictError, setRemoteConflictError] = useState<string | null>(null)
    const [auditSyncStatus, setAuditSyncStatus] = useState({
        syncing: false,
        pendingCount: 0,
        lastSyncTime: null as number | null,
        autoSync: true
    })
    const [showSyncedLogs, setShowSyncedLogs] = useState(false)
    const [syncedAuditEntries, setSyncedAuditEntries] = useState<AuditSyncEntry[]>([])

    const { isLightMode, toggleTheme } = useTheme()

    const mergeSettings = (loaded: Partial<UserSettings>): UserSettings => ({
        ...DEFAULT_SETTINGS,
        ...loaded,
        display: {
            ...DEFAULT_SETTINGS.display,
            ...(loaded.display || {}),
            wallpaper: {
                ...DEFAULT_SETTINGS.display.wallpaper,
                ...(loaded.display?.wallpaper || {})
            }
        },
        remotePython: {
            ...DEFAULT_SETTINGS.remotePython,
            ...(loaded.remotePython || {})
        },
        sync: {
            ...DEFAULT_SETTINGS.sync,
            ...(loaded.sync || {})
        },
        audit: {
            ...DEFAULT_SETTINGS.audit,
            ...(loaded.audit || {})
        }
    })

    const loadRemoteApiKey = () => {
        try {
            return localStorage.getItem(REMOTE_PY_API_KEY_STORAGE) || ''
        } catch {
            return ''
        }
    }

    // Save settings to VFS and track for sync
    const saveSettings = async (newSettings: UserSettings) => {
        try {
            const settingsJson = JSON.stringify(newSettings, null, 2)
            await writeFile('settings.json', settingsJson)
            await githubSync.trackChange('settings.json', settingsJson)
            setSettings(newSettings)
        } catch (error) {
            console.error('Failed to save settings:', error)
        }
    }

    // Load settings from VFS
    const loadSettings = async () => {
        try {
            const data = await readFile('settings.json')
            if (data && typeof data === 'string') {
                const loadedSettings = JSON.parse(data) as Partial<UserSettings>
                const merged = mergeSettings(loadedSettings)
                setSettings(merged)
                return merged
            }
        } catch (error) {
            console.debug('No saved settings found, using defaults')
        }
        return DEFAULT_SETTINGS
    }

    useEffect(() => {
        // Load settings from VFS
        loadSettings().then(loadedSettings => {
            // Initialize autoSync states from loaded settings
            setAutoSyncEnabled(loadedSettings.sync.autoSyncEnabled)
            setAutoSyncInterval(loadedSettings.sync.autoSyncIntervalMinutes)
            setRemotePythonEnabled(loadedSettings.remotePython.enabled)
            setRemotePythonBaseUrl(loadedSettings.remotePython.baseUrl)
            setRemotePythonUserId(loadedSettings.remotePython.userId)
            setRemotePythonOverwriteOnPull(loadedSettings.remotePython.overwriteOnPull)
            setRemotePythonPullIntervalSec(loadedSettings.remotePython.pullIntervalSec)
            setRemotePythonApiKey(loadRemoteApiKey())
            
            // Apply wallpaper from settings
            const root = document.querySelector('.h-screen')
            if (root && root instanceof HTMLElement) {
                const wp = loadedSettings.display.wallpaper
                // Only apply if it's different from the current global CSS var to avoid overriding the light/dark theme switch unless the user explicitly set a custom one
                if (wp.source !== DEFAULT_SETTINGS.display.wallpaper.source) {
                    root.style.backgroundImage = `url('${wp.source}')`
                    root.style.backgroundSize = wp.size
                    root.style.backgroundRepeat = wp.repeat
                    root.style.backgroundPosition = wp.position
                }
            }
        })

        // Get session timer data if available
        const updateSessionTime = () => {
            const sessionTimerData = localStorage.getItem('zynqos_session_timer')
            if (sessionTimerData) {
                try {
                    const data = JSON.parse(sessionTimerData)
                    const totalMs = data.totalActiveMs || 0
                    setSessionTime(formatDuration(totalMs))
                } catch { }
            }
        }
        updateSessionTime()
        const interval = setInterval(updateSessionTime, 1000)

        // Calculate cache size
        calculateCacheSize()

        // Initialize GitHub sync
        githubSync.init().then(() => {
            const status = githubSync.getStatus()
            setSyncStatus(status)
            
            const config = githubSync.getConfig()
            if (config) {
                setAutoSyncEnabled(config.autoSyncEnabled)
                setAutoSyncInterval(config.autoSyncIntervalMinutes || 30)
                // Update settings state with loaded sync config
                setSettings(prev => ({
                    ...prev,
                    sync: {
                        autoSyncEnabled: config.autoSyncEnabled,
                        autoSyncIntervalMinutes: config.autoSyncIntervalMinutes || 30
                    }
                }))
            }
        })

        // Listen for sync status changes
        const handleSyncStatusChange = (e: Event) => {
            const customEvent = e as CustomEvent<SyncStatus>
            setSyncStatus(customEvent.detail)
        }
        // Listen for authentication required events
        const handleAuthRequired = (e: Event) => {
            const customEvent = e as CustomEvent
            const { provider } = customEvent.detail
            toast({
                title: 'Re-authentication Required',
                description: `Your ${provider} session has expired. Please log in again.`,
                variant: 'destructive',
                action: (
                    <button
                        onClick={() => {
                            if (provider === 'github') {
                                (window as any).ZynqOS_startGitHubAuth?.()
                            }
                        }}
                        className="px-3 py-1 text-sm bg-blue-600 rounded hover:bg-blue-700 text-white"
                    >
                        Login
                    </button>
                )
            })
        }
        
        window.addEventListener('microos:sync-status-changed', handleSyncStatusChange as EventListener)
        window.addEventListener('microos:auth-required', handleAuthRequired as EventListener)

        return () => {
            clearInterval(interval)
            window.removeEventListener('microos:sync-status-changed', handleSyncStatusChange as EventListener)
            window.removeEventListener('microos:auth-required', handleAuthRequired as EventListener)
        }
    }, [])

    // Listen for auth initialization to sync profile
    useEffect(() => {
        // Initialize storage status (force refresh to ensure latest connection state)
        getStorageStatus(true).then(status => {
            setStorageStatus(status)
        })

        const onStatusEvent = (e: Event) => {
            const customEvent = e as CustomEvent<StorageStatus>
            const status = customEvent.detail
            if (status) setStorageStatus(status)
        }

        const onConnected = () => {
            // Force refresh when storage actually connects
            getStorageStatus(true).then(status => setStorageStatus(status))
        }

        window.addEventListener('zynqos:auth-initialized', onStatusEvent as EventListener)
        window.addEventListener('zynqos:storage-connected', onConnected as EventListener)
        return () => {
            window.removeEventListener('zynqos:auth-initialized', onStatusEvent as EventListener)
            window.removeEventListener('zynqos:storage-connected', onConnected as EventListener)
        }
    }, [])

    // Update profile when storage status changes
    useEffect(() => {
        if (storageStatus.authenticated || storageStatus.connected) {
            // Status endpoint now includes profile data
            setProfile({
                connected: storageStatus.connected,
                authenticated: storageStatus.authenticated,
                provider: storageStatus.provider,
                profile: storageStatus.profile || {}
            })
        }
    }, [storageStatus])

    useEffect(() => {
        if (activeTab === 'security') {
            fetchAuditLog()
            // Update audit sync status
            const status = auditSync.getStatus()
            setAuditSyncStatus(status)
        }
    }, [activeTab])

    useEffect(() => {
        if (activeTab !== 'system') return
        refreshRemoteConflicts()
    }, [activeTab])

    useEffect(() => {
        const handleRemoteConflictUpdate = (e: Event) => {
            const ev = e as CustomEvent
            const detail = ev.detail || {}
            const path = String(detail.path || '')
            if (path.startsWith('/home/') && path.includes('.remote-')) {
                refreshRemoteConflicts()
            }
        }
        window.addEventListener('microos:vfs-changed', handleRemoteConflictUpdate as EventListener)
        return () => window.removeEventListener('microos:vfs-changed', handleRemoteConflictUpdate as EventListener)
    }, [])

    // Listen for audit sync status changes
    useEffect(() => {
        const handleAuditSyncChange = (e: Event) => {
            const customEvent = e as CustomEvent
            setAuditSyncStatus(customEvent.detail)
        }
        window.addEventListener('microos:audit-sync-changed', handleAuditSyncChange as EventListener)
        return () => {
            window.removeEventListener('microos:audit-sync-changed', handleAuditSyncChange as EventListener)
        }
    }, [])

    const formatDuration = (ms: number): string => {
        const seconds = Math.floor(ms / 1000)
        const minutes = Math.floor(seconds / 60)
        const hours = Math.floor(minutes / 60)
        const days = Math.floor(hours / 24)

        if (days > 0) return `${days}d ${hours % 24}h`
        if (hours > 0) return `${hours}h ${minutes % 60}m`
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`
        return `${seconds}s`
    }

    const formatTimestamp = (ts: number): string => new Date(ts).toLocaleString()

    const calculateCacheSize = async () => {
        try {
            const estimate = await (navigator as any).storage?.estimate?.()
            if (estimate) {
                const sizeInMB = (estimate.usage / (1024 * 1024)).toFixed(2)
                const limitInMB = (estimate.quota / (1024 * 1024)).toFixed(0)
                const ratio = Math.max(1, Math.min(100, (estimate.usage / estimate.quota) * 100))
                setCacheSize(`${sizeInMB} MB / ${limitInMB} MB`)
                setCacheRatio(ratio)
            }
        } catch {
            setCacheSize('Unknown')
            setCacheRatio(0)
        }
    }

    async function fetchAuditLog() {
        setAuditLoading(true)
        setAuditError(null)
        try {
            const res = await fetch('/api?route=auth&action=audit&limit=100', { credentials: 'include' })
            if (res.status === 401) {
                throw new Error('unauthorized')
            }
            if (!res.ok) throw new Error(`status ${res.status}`)
            const data = await res.json()
            const entries = Array.isArray(data.entries) ? data.entries : []
            setAuditEntries(entries)
            
            // Track entries for auto-sync if GitHub storage is connected
            if (storageStatus.connected && (storageStatus.provider === 'github' || storageStatus.provider === 'github-app')) {
                // Track new entries (non-blocking)
                entries.forEach(entry => {
                    auditSync.trackAuditEntry(entry).catch(() => {})
                })
            }
        } catch (e) {
            console.error('Audit log fetch failed:', e)
            if (e instanceof Error && e.message === 'unauthorized') {
                setAuditError('Sign in to view audit log')
            } else {
                setAuditError('Failed to load audit log')
            }
        } finally {
            setAuditLoading(false)
        }
    }

    async function syncAuditToGitHub() {
        try {
            // First get the server-side audit entries
            const res = await fetch('/api?route=auth&action=audit_sync', { credentials: 'include' })
            if (!res.ok) {
                throw new Error('Failed to fetch audit data')
            }
            const data = await res.json()
            const entries = data.entries || []

            // Track each entry for syncing
            for (const entry of entries) {
                await auditSync.trackAuditEntry(entry)
            }

            // Force sync to GitHub
            await auditSync.syncToGitHub()

            toast({
                title: 'Audit Synced',
                description: `${entries.length} audit entries synced to GitHub storage`,
                variant: 'success'
            })
        } catch (e) {
            console.error('Audit sync failed:', e)
            toast({
                title: 'Sync Failed',
                description: e instanceof Error ? e.message : 'Failed to sync audit log',
                variant: 'destructive'
            })
        }
    }

    async function loadSyncedAuditLogs() {
        try {
            setAuditLoading(true)
            // Get last 30 days of logs
            const endDate = new Date().toISOString().split('T')[0]
            const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            
            const logs = await auditSync.getLogsForDateRange(startDate, endDate)
            
            // Deduplicate entries by ID (keep most recent by timestamp)
            const uniqueLogsMap = new Map<string, AuditSyncEntry>()
            logs.forEach(entry => {
                const existing = uniqueLogsMap.get(entry.id)
                if (!existing || entry.ts > existing.ts) {
                    uniqueLogsMap.set(entry.id, entry)
                }
            })
            const uniqueLogs = Array.from(uniqueLogsMap.values()).sort((a, b) => b.ts - a.ts)
            
            setSyncedAuditEntries(uniqueLogs)
            setShowSyncedLogs(true)
            
            toast({
                title: 'Logs Loaded',
                description: `Loaded ${uniqueLogs.length} unique audit entries (${logs.length} total)`,
                variant: 'success'
            })
        } catch (e) {
            console.error('Failed to load synced logs:', e)
            toast({
                title: 'Load Failed',
                description: 'Failed to load synced audit logs',
                variant: 'destructive'
            })
        } finally {
            setAuditLoading(false)
        }
    }

    const normalizeRemoteBaseUrl = (value: string) => {
        const trimmed = value.trim().replace(/\/+$/, '')
        if (!trimmed) return ''
        if (/^https?:\/\//i.test(trimmed)) return trimmed
        return `http://${trimmed}`
    }

    const handleSaveRemotePython = async () => {
        try {
            const normalizedBaseUrl = normalizeRemoteBaseUrl(remotePythonBaseUrl)
            const cleanedUserId = remotePythonUserId.trim()
            const normalizedInterval = Math.max(15, Math.min(3600, Number(remotePythonPullIntervalSec) || 60))
            const newSettings: UserSettings = {
                ...settings,
                remotePython: {
                    enabled: remotePythonEnabled,
                    baseUrl: normalizedBaseUrl,
                    userId: cleanedUserId,
                    overwriteOnPull: remotePythonOverwriteOnPull,
                    pullIntervalSec: normalizedInterval
                }
            }
            await saveSettings(newSettings)
            if (remotePythonApiKey) {
                localStorage.setItem(REMOTE_PY_API_KEY_STORAGE, remotePythonApiKey)
            } else {
                localStorage.removeItem(REMOTE_PY_API_KEY_STORAGE)
            }
            setRemotePythonBaseUrl(normalizedBaseUrl)
            setRemotePythonUserId(cleanedUserId)
            setRemotePythonPullIntervalSec(normalizedInterval)
            toast({
                title: 'Saved',
                description: 'Remote Python settings updated',
                variant: 'success'
            })
        } catch (e) {
            console.error('Failed to save remote Python settings', e)
            toast({
                title: 'Save failed',
                description: 'Could not update Remote Python settings',
                variant: 'destructive'
            })
        }
    }

    const handleTestRemotePython = async () => {
        const baseUrl = normalizeRemoteBaseUrl(remotePythonBaseUrl)
        if (!baseUrl) {
            toast({
                title: 'Missing URL',
                description: 'Add the runtime base URL before testing',
                variant: 'destructive'
            })
            return
        }

        try {
            const headers: Record<string, string> = {}
            if (remotePythonApiKey) headers['X-Api-Key'] = remotePythonApiKey
            if (remotePythonUserId) headers['X-User-Id'] = remotePythonUserId

            const res = await fetch(`${baseUrl}/v1/python/version`, { headers })
            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || `HTTP ${res.status}`)
            }
            const contentType = res.headers.get('content-type') || ''
            if (!contentType.includes('application/json')) {
                const text = await res.text()
                throw new Error(text || 'Invalid response from runtime')
            }
            const json = await res.json()
            toast({
                title: 'Connected',
                description: json.version ? `Python ${json.version}` : 'Runtime reachable',
                variant: 'success'
            })
        } catch (e) {
            console.error('Remote Python test failed', e)
            toast({
                title: 'Connection failed',
                description: e instanceof Error ? e.message : 'Unable to reach runtime',
                variant: 'destructive'
            })
        }
    }

    const handleClearCache = async () => {
        const { dismiss } = toast({
            title: 'Clear Cache?',
            description: 'This will remove temporary files but keep your files and settings.',
            variant: 'default',
            action: (
                <button
                    onClick={async () => {
                        dismiss()
            try {
                // Clear all caches
                const cacheNames = await caches.keys()
                for (const cacheName of cacheNames) {
                    await caches.delete(cacheName)
                }

                // Clear localStorage (but keep important settings)
                const keysToKeep = [
                    'zynqos_profile_cache',
                    'zynqos_installed_apps',
                    'zynqos_wallpaper_source',
                    'zynqos_background_size',
                    'zynqos_session_timer',
                    'os-theme' // Keep theme setting
                ]

                const keysToDelete: string[] = []
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i)
                    if (key && !keysToKeep.includes(key)) {
                        keysToDelete.push(key)
                    }
                }
                keysToDelete.forEach(key => localStorage.removeItem(key))

                // Clear IndexedDB
                const dbs = await (window.indexedDB as any).databases?.()
                if (dbs) {
                    for (const db of dbs) {
                        window.indexedDB.deleteDatabase(db.name)
                    }
                }

                await calculateCacheSize()
                        toast({ title: 'Success', description: 'Cache cleared successfully', variant: 'success' })
                    } catch (e) {
                        console.error('Cache clear error:', e)
                        toast({ title: 'Partial Success', description: 'Failed to clear some cache items, but cleared what was possible', variant: 'warning' })
                    }
                }}
                className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition"
            >
                Clear
            </button>
            ),
        })
    }

    const handleDisconnectStorage = async () => {
        const { dismiss } = toast({
            title: 'Disconnect Storage?',
            description: 'You can reconnect later.',
            variant: 'default',
            action: (
                <button
                    onClick={async () => {
                        dismiss()
                        try {
                            await disconnectStorage()
                            setStorageStatus({ connected: false })
                            toast({ title: 'Disconnected', description: 'Cloud storage disconnected', variant: 'success' })
                        } catch (e) {
                            toast({ title: 'Error', description: 'Failed to disconnect', variant: 'destructive' })
                        }
                    }}
                    className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition"
                >
                    Disconnect
                </button>
            ),
        })
    }

    const handleRefreshWallpaper = () => {
        // Force reload the background
        window.location.reload()
    }

    const handleSystemReset = () => {
        try {
            window.localStorage.removeItem('zynqos_theme')
            window.localStorage.removeItem('zynqos_wallpaper')
            window.localStorage.removeItem('zynqos_workspace_positions')
            window.localStorage.removeItem('zynqos_window_positions')
            window.localStorage.removeItem('zynqos_layout_positions')
        } catch (error) {
            console.error('Failed to clear system defaults storage keys:', error)
        }
        window.location.reload()
    }

    const refreshRemoteConflicts = async () => {
        setRemoteConflictLoading(true)
        setRemoteConflictError(null)
        try {
            const keys = await readdir('')
            const conflicts = keys
                .filter(k => k.startsWith('/home/') && /\.remote-\d{14}$/.test(k))
                .sort()
            setRemoteConflictFiles(conflicts)
        } catch (e) {
            console.error('Failed to list remote conflicts', e)
            setRemoteConflictError('Failed to load conflicts')
        } finally {
            setRemoteConflictLoading(false)
        }
    }

    const resolveConflictKeepLocal = async (conflictPath: string) => {
        try {
            await removeFile(conflictPath)
            await refreshRemoteConflicts()
            toast({ title: 'Resolved', description: 'Kept local version', variant: 'success' })
        } catch (e) {
            toast({ title: 'Resolve failed', description: 'Could not remove conflict file', variant: 'destructive' })
        }
    }

    const resolveConflictUseRemote = async (conflictPath: string) => {
        try {
            const content = await readFile(conflictPath)
            if (content === undefined) throw new Error('Conflict file missing')
            const basePath = conflictPath.replace(/\.remote-\d{14}$/, '')
            await writeFile(basePath, content)
            await removeFile(conflictPath)
            await refreshRemoteConflicts()
            toast({ title: 'Resolved', description: 'Remote version applied', variant: 'success' })
        } catch (e) {
            toast({ title: 'Resolve failed', description: 'Could not apply remote version', variant: 'destructive' })
        }
    }

    const handleWallpaperUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setWallpaperLoading(true)
        try {
            const reader = new FileReader()
            reader.onload = async (event) => {
                const dataUrl = event.target?.result as string
                const newSettings = {
                    ...settings,
                    display: {
                        ...settings.display,
                        wallpaper: {
                            ...settings.display.wallpaper,
                            source: dataUrl
                        }
                    }
                }
                await saveSettings(newSettings)
                applyWallpaper(newSettings.display.wallpaper)
                setWallpaperLoading(false)
            }
            reader.readAsDataURL(file)
        } catch (e) {
            console.error('Upload error:', e)
            setWallpaperLoading(false)
            toast({ title: 'Upload Failed', description: 'Failed to upload wallpaper', variant: 'destructive' })
        }
    }

    const handleWallpaperUrl = async () => {
        const url = prompt('Enter image URL:')
        if (url) {
            try {
                new URL(url)
                const newSettings = {
                    ...settings,
                    display: {
                        ...settings.display,
                        wallpaper: {
                            ...settings.display.wallpaper,
                            source: url
                        }
                    }
                }
                await saveSettings(newSettings)
                applyWallpaper(newSettings.display.wallpaper)
            } catch {
                toast({ title: 'Error', description: 'Invalid URL', variant: 'destructive' })
            }
        }
    }

    const handleResetWallpaper = () => {
        const { dismiss } = toast({
            title: 'Reset Wallpaper?',
            description: 'This will restore the default wallpaper and re-enable dynamic theme backgrounds.',
            variant: 'default',
            action: (
                <button
                    onClick={async () => {
                        dismiss()
                        const newSettings = {
                            ...settings,
                            display: {
                                ...settings.display,
                                wallpaper: DEFAULT_SETTINGS.display.wallpaper
                            }
                        }
                        await saveSettings(newSettings)
                        
                        // Remove the inline style so the CSS variables take over again
                        const root = document.querySelector('.h-screen')
                        if (root && root instanceof HTMLElement) {
                            root.style.removeProperty('background-image')
                            root.style.removeProperty('background-size')
                            root.style.removeProperty('background-repeat')
                            root.style.removeProperty('background-position')
                        }
                        
                        toast({ title: 'Success', description: 'Wallpaper reset to default', variant: 'success' })
                    }}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                >
                    Reset
                </button>
            ),
        })
    }

    const handleWallpaperInputChange = async (newUrl: string) => {
        if (newUrl.trim()) {
            try {
                new URL(newUrl)
                const newSettings = {
                    ...settings,
                    display: {
                        ...settings.display,
                        wallpaper: {
                            ...settings.display.wallpaper,
                            source: newUrl
                        }
                    }
                }
                await saveSettings(newSettings)
                applyWallpaper(newSettings.display.wallpaper)
            } catch {
                // Invalid URL, ignore
            }
        }
    }

    const applyWallpaper = (wallpaper: UserSettings['display']['wallpaper']) => {
        const root = document.querySelector('.h-screen')
        if (root && root instanceof HTMLElement) {
            root.style.backgroundImage = `url('${wallpaper.source}')`
            root.style.backgroundSize = wallpaper.size
            root.style.backgroundRepeat = wallpaper.repeat
            root.style.backgroundPosition = wallpaper.position
        }
    }

    const handleBackgroundSizeChange = async (size: string) => {
        const newSettings = {
            ...settings,
            display: {
                ...settings.display,
                wallpaper: {
                    ...settings.display.wallpaper,
                    size: size
                }
            }
        }
        await saveSettings(newSettings)
        const root = document.querySelector('.h-screen')
        if (root && root instanceof HTMLElement) {
            root.style.backgroundSize = size
        }
    }

    const handleSyncNow = async () => {
        if (!storageStatus.authenticated) {
            toast({ title: 'Error', description: 'Please sign in to sync', variant: 'destructive' })
            return
        }

        try {
            // Ensure storage connection status; not strictly required for upload but helpful
            await fetch('/api?route=auth&action=status', { credentials: 'include' })

            await githubSync.syncToGitHub()
            toast({ title: 'Success', description: 'Sync completed successfully', variant: 'success' })
        } catch (error) {
            console.error('Sync error:', error)
            toast({ 
                title: 'Sync Failed', 
                description: error instanceof Error ? error.message : 'Unknown error', 
                variant: 'destructive' 
            })
        }
    }

    const handleAutoSyncToggle = async () => {
        const newEnabled = !autoSyncEnabled
        setAutoSyncEnabled(newEnabled)
        
        try {
            await githubSync.setAutoSync(newEnabled, newEnabled ? autoSyncInterval : null)
            toast({ 
                title: newEnabled ? 'Auto-sync enabled' : 'Auto-sync disabled',
                description: newEnabled ? `Syncing every ${autoSyncInterval} minutes` : 'Manual sync only',
                variant: 'success'
            })
        } catch (error) {
            console.error('Auto-sync toggle error:', error)
            setAutoSyncEnabled(!newEnabled) // Revert on error
        }
    }

    const handleAutoSyncIntervalChange = async (newInterval: number) => {
        setAutoSyncInterval(newInterval)
        
        if (autoSyncEnabled) {
            try {
                await githubSync.setAutoSync(true, newInterval)
                // Update settings object
                const newSettings = {
                    ...settings,
                    sync: {
                        ...settings.sync,
                        autoSyncIntervalMinutes: newInterval
                    }
                }
                await saveSettings(newSettings)
                toast({ 
                    title: 'Auto-sync updated',
                    description: `Now syncing every ${newInterval} minutes`,
                    variant: 'success'
                })
            } catch (error) {
                console.error('Auto-sync interval change error:', error)
            }
        }
    }

    const formatLastSyncTime = (timestamp: number | null): string => {
        if (!timestamp) return 'Never'
        const now = Date.now()
        const diff = now - timestamp
        const minutes = Math.floor(diff / 60000)
        const hours = Math.floor(minutes / 60)
        const days = Math.floor(hours / 24)

        if (days > 0) return `${days}d ago`
        if (hours > 0) return `${hours}h ago`
        if (minutes > 0) return `${minutes}m ago`
        return 'Just now'
    }

    const displayTabContent = () => (
        <div className="space-y-6">
            
            {/* Theme Settings */}
            <div className="border border-[var(--border-color)] rounded-lg p-4 bg-[var(--taskbar-bg)] shadow-sm">
                <h3 className="text-[var(--text-color)] font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-palette text-blue-500"></i>
                    Theme & Appearance
                </h3>
                <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 rounded bg-[var(--bg-color)] border border-[var(--border-color)]">
                        <div>
                            <p className="text-[var(--text-color)] text-sm font-semibold">Light Mode</p>
                            <p className="text-[var(--text-color)] opacity-60 text-xs">Switch the entire OS between dark and light themes</p>
                        </div>
                        <button
                            onClick={toggleTheme}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                isLightMode ? 'bg-blue-600' : 'bg-gray-600'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    isLightMode ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                </div>
            </div>

            {/* Wallpaper Settings */}
            <div className="border border-[var(--border-color)] rounded-lg p-4 bg-[var(--taskbar-bg)] shadow-sm">
                <div className='w-full flex items-center justify-between mb-3'>
                    <h3 className="text-[var(--text-color)] font-semibold flex items-center gap-2">
                        <i className="fas fa-image text-blue-500"></i>
                        Custom Wallpaper
                    </h3>

                    {/* Reset Button */}
                    {settings.display.wallpaper.source !== DEFAULT_SETTINGS.display.wallpaper.source && (
                        <button
                            onClick={handleResetWallpaper}
                            className="transition text-[var(--text-color)] opacity-60 hover:opacity-100 hover:text-red-500 ml-auto flex items-center gap-1 bg-red-500/10 px-2 py-1 rounded"
                            title="Reset to Default Theme Wallpaper"
                        >
                            <i className="fas fa-redo text-xs"></i>
                            <span className="text-xs font-semibold">Reset</span>
                        </button>
                    )}
                </div>
                <div className="space-y-4">
                    {/* All Wallpaper Controls - Single Line */}
                    <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded p-3">
                        <div className="flex gap-2 items-center">
                            <input type="text" value={settings.display.wallpaper.source || ''} onChange={(e) => handleWallpaperInputChange(e.target.value)} className="flex-1 bg-[var(--taskbar-bg)] text-[var(--text-color)] px-3 py-2 rounded text-xs border border-[var(--border-color)] focus:border-blue-500 focus:outline-none" placeholder="Wallpaper URL" />
                            <input type="file" id="wallpaper-upload" accept="image/*" onChange={handleWallpaperUpload} disabled={wallpaperLoading} className="hidden" />
                            <button onClick={() => document.getElementById('wallpaper-upload')?.click()} disabled={wallpaperLoading} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white text-xs rounded transition whitespace-nowrap">{wallpaperLoading ? 'Uploading...' : <i className="fa-solid fa-upload"></i>}</button>
                            <select value={settings.display.wallpaper.size || '60%'} onChange={(e) => handleBackgroundSizeChange(e.target.value)} className="bg-[var(--taskbar-bg)] text-[var(--text-color)] p-2 rounded text-xs border border-[var(--border-color)] focus:border-blue-500 focus:outline-none cursor-pointer">
                                <option value="100% 100%">Full</option>
                                <option value="cover">Cover</option>
                                <option value="contain">Contain</option>
                                <option value="60%">Center</option>
                            </select>
                        </div>
                    </div>
                </div>
                <span className="text-[var(--text-color)] opacity-60 text-xs mt-2 block"> <i className="fas fa-info-circle text-xs"></i> Setting a custom wallpaper overrides the automatic Light/Dark mode backgrounds. Reset to restore dynamic backgrounds.</span>
            </div>

            {/* Window Settings */}
            <div className="border border-[var(--border-color)] rounded-lg p-4 bg-[var(--taskbar-bg)] shadow-sm">
                <h3 className="text-[var(--text-color)] font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-window-maximize text-blue-500"></i>
                    Window Management
                </h3>
                <div className="space-y-3 text-[var(--text-color)] opacity-80 text-sm">
                    <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded p-3">
                        <p className="font-semibold mb-2 text-[var(--text-color)]">Window Snapping</p>
                        <ul className="list-disc list-inside space-y-2 text-[var(--text-color)] opacity-70 text-xs">
                            <li><code className="bg-[var(--taskbar-bg)] border border-[var(--border-color)] px-1.5 py-0.5 rounded text-xs text-[var(--text-color)]">Ctrl+Left</code> - Snap left</li>
                            <li><code className="bg-[var(--taskbar-bg)] border border-[var(--border-color)] px-1.5 py-0.5 rounded text-xs text-[var(--text-color)]">Ctrl+Right</code> - Snap right</li>
                            <li><code className="bg-[var(--taskbar-bg)] border border-[var(--border-color)] px-1.5 py-0.5 rounded text-xs text-[var(--text-color)]">Ctrl+Up</code> - Maximize</li>
                            <li><code className="bg-[var(--taskbar-bg)] border border-[var(--border-color)] px-1.5 py-0.5 rounded text-xs text-[var(--text-color)]">Ctrl+Down</code> - Restore</li>
                            <li>Drag near screen edges to snap windows</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    )

    const storageTabContent = () => (
        <div className="space-y-6">
            {/* Cloud Storage */}
            <div className="border border-[var(--border-color)] rounded-lg p-4 bg-[var(--taskbar-bg)] shadow-sm">
                <h3 className="text-[var(--text-color)] font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-cloud text-blue-500"></i>
                    Cloud Storage
                </h3>
                <div className="space-y-3">
                    {storageStatus.connected ? (
                        <>
                                <div className="bg-green-500/10 border border-green-500/30 rounded p-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {profile?.profile?.avatar_url && (
                                            <img src={profile.profile.avatar_url} alt="Avatar" className="w-8 h-8 rounded-full" />
                                        )}
                                        <div>
                                            <p className="text-green-600 dark:text-green-400 font-semibold">{profile?.profile?.name || 'Connected'}</p>
                                            {profile?.profile?.email && (
                                                <p className="text-green-600/70 dark:text-green-400/70 text-sm">{profile.profile.email}</p>
                                            )}
                                            {profile?.provider && (
                                                <p className="text-green-600/70 dark:text-green-400/70 text-sm">
                                                    Provider: <span className="capitalize">{profile.provider}</span> (Storage Enabled)
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <a
                                            href={(import.meta as any).env?.VITE_GITHUB_APP_INSTALL_URL || 'https://github.com/apps/zynq-os/installations/new'}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition"
                                        >
                                            Configure App
                                        </a>
                                        <button
                                            onClick={handleDisconnectStorage}
                                            className="px-3 py-1 bg-[var(--bg-color)] border border-[var(--border-color)] hover:bg-gray-500/20 text-[var(--text-color)] text-sm rounded transition"
                                        >
                                            Disconnect
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : storageStatus.authenticated ? (
                        <>
                            <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {profile?.profile?.avatar_url && (
                                            <img src={profile.profile.avatar_url} alt="Avatar" className="w-8 h-8 rounded-full" />
                                        )}
                                        <div>
                                            <p className="text-blue-600 dark:text-blue-400 font-semibold">{profile?.profile?.name || 'Authenticated'}</p>
                                            {profile?.profile?.email && (
                                                <p className="text-blue-600/70 dark:text-blue-400/70 text-sm">{profile.profile.email}</p>
                                            )}
                                            {profile?.provider && (
                                                <p className="text-blue-600/70 dark:text-blue-400/70 text-sm">
                                                    Signed in with <span className="capitalize">{profile.provider}</span>
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleDisconnectStorage}
                                        className="px-3 py-1 bg-[var(--bg-color)] border border-[var(--border-color)] hover:bg-gray-500/20 text-[var(--text-color)] text-sm rounded transition"
                                    >
                                        Sign Out
                                    </button>
                                </div>
                            </div>
                            <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded p-3 space-y-2">
                                <p className="text-[var(--text-color)] text-sm font-semibold">Enable Decentralized Storage</p>
                                <p className="text-[var(--text-color)] opacity-70 text-xs">
                                    You're signed in! Now set up decentralized storage to sync your files and settings across devices using your own GitHub repo.
                                </p>
                                <div className="flex gap-2 items-center mt-3">
                                    <a
                                        href={(import.meta as any).env?.VITE_GITHUB_APP_INSTALL_URL || 'https://github.com/apps/zynq-os/installations/new'}
                                        rel="noreferrer"
                                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition font-semibold"
                                    >
                                        Install GitHub App
                                    </a>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="bg-gray-500/10 border border-[var(--border-color)] rounded p-3 space-y-3">
                            <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded p-3 space-y-2">
                                <p className="text-[var(--text-color)] text-sm font-semibold">Connect GitHub Repo</p>
                                <ol className="list-decimal list-inside text-[var(--text-color)] opacity-70 text-xs space-y-1">
                                    <li>Create a new private [recommended] repo on GitHub for your ZynqOS data</li>
                                    <li>Click "Install App" to authorize ZynqOS</li>
                                    <li>Select the repo during installation and authorize</li>
                                    <li>You'll be redirected back to ZynqOS with your data connected</li>
                                </ol>
                                <p className="text-[var(--text-color)] opacity-70 text-xs mt-2">
                                    Your files, settings, and audit logs will be synced to your repo and accessible across all devices signed in with your GitHub account. All data stays in your control—ZynqOS cannot access your repo without your authorization.
                                    <br />
                                    <span className="opacity-50 mt-1 block">Default storage repo: /your-username/.zynqos_storage</span>
                                </p>
                                <div className="flex gap-2 items-center mt-3">
                                    <a
                                        href={(import.meta as any).env?.VITE_GITHUB_APP_INSTALL_URL || 'https://github.com/apps/zynq-os/installations/new'}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition font-semibold"
                                    >
                                        Install App
                                    </a>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Local Storage */}
            <div className="border border-[var(--border-color)] rounded-lg p-4 bg-[var(--taskbar-bg)] shadow-sm">
                <h3 className="text-[var(--text-color)] font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-database text-blue-500"></i>
                    Local Storage
                </h3>
                <div className="space-y-3">
                    <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded p-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[var(--text-color)] opacity-80">Cache Usage</span>
                            <span className="text-blue-500 font-mono text-sm font-semibold">{cacheSize}</span>
                        </div>
                        <div className="w-full bg-gray-500/20 border border-[var(--border-color)] rounded-full h-2">
                            <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${cacheRatio}%` }}></div>
                        </div>
                        <p className="text-[var(--text-color)] opacity-50 text-xs mt-2">
                            Includes temporary files, images, and app data.
                        </p>
                    </div>
                    <button
                        onClick={handleClearCache}
                        className="w-full px-3 py-2 bg-red-600/10 hover:bg-red-600/20 text-red-500 border border-red-500/30 text-sm rounded transition font-semibold"
                    >
                        Clear Cache
                    </button>
                </div>
            </div>

            {/* Sync Status */}
            <div className="border border-[var(--border-color)] rounded-lg p-4 bg-[var(--taskbar-bg)] shadow-sm">
                <h3 className="text-[var(--text-color)] font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-sync text-blue-500"></i>
                    GitHub Sync
                </h3>
                
                {!storageStatus.authenticated ? (
                    <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded p-3">
                        <p className="text-[var(--text-color)] opacity-60 text-sm">
                            Sign in with GitHub to enable peer-to-peer sync
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {/* Sync Status Display */}
                        <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded p-3 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[var(--text-color)] opacity-70 text-sm">Last Sync</span>
                                <span className={`text-sm font-medium ${syncStatus.lastSyncTime ? 'text-green-500' : 'text-[var(--text-color)] opacity-50'}`}>
                                    {formatLastSyncTime(syncStatus.lastSyncTime)}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[var(--text-color)] opacity-70 text-sm">Pending Changes</span>
                                <span className={`text-sm font-mono font-bold ${syncStatus.pendingChanges > 0 ? 'text-orange-500' : 'text-[var(--text-color)] opacity-50'}`}>
                                    {syncStatus.pendingChanges}
                                </span>
                            </div>
                            {syncStatus.error && (
                                <div className="text-red-500 text-xs mt-2 bg-red-500/10 p-2 rounded">
                                    Error: {syncStatus.error}
                                </div>
                            )}
                        </div>

                        {/* Manual Sync / Pull Buttons */}
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={handleSyncNow}
                                disabled={syncStatus.syncing}
                                className={`w-full px-4 py-2 rounded text-sm font-semibold transition flex items-center justify-center gap-2 border ${
                                    syncStatus.syncing
                                        ? 'bg-[var(--bg-color)] border-[var(--border-color)] text-[var(--text-color)] opacity-50 cursor-not-allowed'
                                        : 'bg-blue-600 hover:bg-blue-500 border-blue-600 text-white shadow-md'
                                }`}
                            >
                                {syncStatus.syncing ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin"></i>
                                        Push…
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-cloud-upload-alt"></i>
                                        Push Now
                                    </>
                                )}
                            </button>
                            <button
                                onClick={async () => {
                                    try {
                                        await githubSync.pullFromGitHub()
                                        toast({ title: 'Pulled', description: 'Latest data fetched from GitHub', variant: 'success' })
                                    } catch (e) {
                                        toast({ title: 'Pull failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
                                    }
                                }}
                                disabled={syncStatus.syncing}
                                className={`w-full px-4 py-2 rounded text-sm font-semibold transition flex items-center justify-center gap-2 border ${
                                    syncStatus.syncing
                                        ? 'bg-[var(--bg-color)] border-[var(--border-color)] text-[var(--text-color)] opacity-50 cursor-not-allowed'
                                        : 'bg-[var(--bg-color)] hover:bg-gray-500/10 border-[var(--border-color)] text-[var(--text-color)]'
                                }`}
                            >
                                <i className="fas fa-cloud-download-alt"></i>
                                Pull Now
                            </button>
                        </div>

                        {/* Auto-sync Settings */}
                        <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded p-3 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-[var(--text-color)] text-sm font-medium">Auto-sync</span>
                                    <span className="text-[var(--text-color)] opacity-50 text-xs">Background sync</span>
                                </div>
                                <button
                                    onClick={handleAutoSyncToggle}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                        autoSyncEnabled ? 'bg-blue-600' : 'bg-gray-500'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                            autoSyncEnabled ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                    />
                                </button>
                            </div>

                            {autoSyncEnabled && (
                                <div className="space-y-2 pt-2 border-t border-[var(--border-color)]">
                                    <label className="text-[var(--text-color)] opacity-70 text-xs font-semibold uppercase">Sync interval</label>
                                    <select
                                        value={autoSyncInterval}
                                        onChange={(e) => handleAutoSyncIntervalChange(Number(e.target.value))}
                                        className="w-full bg-[var(--taskbar-bg)] text-[var(--text-color)] px-3 py-2 rounded text-sm border border-[var(--border-color)] focus:border-blue-500 focus:outline-none"
                                    >
                                        <option value={5}>Every 5 minutes</option>
                                        <option value={15}>Every 15 minutes</option>
                                        <option value={30}>Every 30 minutes</option>
                                        <option value={60}>Every hour</option>
                                        <option value={180}>Every 3 hours</option>
                                    </select>
                                </div>
                            )}
                        </div>

                        <p className="text-[var(--text-color)] opacity-50 text-xs bg-blue-500/10 border border-blue-500/20 p-2 rounded">
                            <i className="fas fa-info-circle mr-1 text-blue-500"></i>
                            Your data is synced to your own GitHub repo: <strong>.zynqos_storage</strong>. All files, settings, and logs stay under your control.
                        </p>
                    </div>
                )}
            </div>
        </div>
    )

    const systemTabContent = () => (
        <div className="space-y-6">
            {/* Session Time */}
            <div className="border border-[var(--border-color)] rounded-lg p-4 bg-[var(--taskbar-bg)] shadow-sm">
                <h3 className="text-[var(--text-color)] font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-hourglass-half text-blue-500"></i>
                    Session Activity
                </h3>
                <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[var(--text-color)] opacity-80 font-medium">Total Active Time</span>
                        <span className="text-blue-500 font-mono text-lg font-bold">{sessionTime}</span>
                    </div>
                    <p className="text-[var(--text-color)] opacity-50 text-xs">
                        Tracks time spent actively using this application. Pauses during idle periods (1 minute threshold).
                    </p>
                </div>
            </div>

            {/* System Information */}
            <div className="border border-[var(--border-color)] rounded-lg p-4 bg-[var(--taskbar-bg)] shadow-sm">
                <h3 className="text-[var(--text-color)] font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-info-circle text-blue-500"></i>
                    System Information
                </h3>
                <div className="space-y-2 text-sm">
                    <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded p-3 flex items-center justify-between">
                        <span className="text-[var(--text-color)] opacity-70">OS</span>
                        <span className="text-[var(--text-color)] font-medium">ZynqOS (Web-based)</span>
                    </div>
                    <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded p-3 flex items-center justify-between">
                        <span className="text-[var(--text-color)] opacity-70">Browser</span>
                        <span className="text-[var(--text-color)] font-medium">{getBrowserInfoLocal()}</span>
                    </div>
                    <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded p-3 flex items-center justify-between">
                        <span className="text-[var(--text-color)] opacity-70">Platform</span>
                        <span className="text-[var(--text-color)] font-medium">{getPlatformInfoLocal()}</span>
                    </div>
                    <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded p-3 flex items-center justify-between">
                        <span className="text-[var(--text-color)] opacity-70">Runtime</span>
                        <span className="text-[var(--text-color)] font-medium">WASI + WebAssembly</span>
                    </div>
                </div>
            </div>

            {/* Remote Python Runtime */}
            <div className="border border-[var(--border-color)] rounded-lg p-4 bg-[var(--taskbar-bg)] shadow-sm">
                <h3 className="text-[var(--text-color)] font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-terminal text-blue-500"></i>
                    Remote Python Runtime
                </h3>
                <div className="space-y-3">
                    <div className="flex items-center justify-between bg-[var(--bg-color)] border border-[var(--border-color)] rounded p-3">
                        <div className="flex flex-col">
                            <p className="text-[var(--text-color)] text-sm font-semibold">Enable Remote Runtime</p>
                            <p className="text-[var(--text-color)] opacity-50 text-xs">Optional: only set this if you run your own server-side runtime.</p>
                        </div>
                        <button
                            onClick={() => setRemotePythonEnabled(prev => !prev)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                remotePythonEnabled ? 'bg-blue-600' : 'bg-gray-500'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    remotePythonEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="text-[var(--text-color)] opacity-70 text-xs font-semibold uppercase">Base URL</label>
                            <input
                                value={remotePythonBaseUrl}
                                onChange={(e) => setRemotePythonBaseUrl(e.target.value)}
                                placeholder="ec2-xxx-xxx-xxx-xxx.yy-yyyyy.compute.amazonaws.com:8000"
                                className="w-full mt-1 bg-[var(--bg-color)] border border-[var(--border-color)] rounded px-3 py-2 text-sm text-[var(--text-color)] focus:border-blue-500 outline-none"
                            />
                            <p className="text-[var(--text-color)] opacity-50 text-[11px] mt-1">Leave empty to keep local Pyodide runtime.</p>
                        </div>
                        <div>
                            <label className="text-[var(--text-color)] opacity-70 text-xs font-semibold uppercase">User ID</label>
                            <input
                                value={remotePythonUserId}
                                onChange={(e) => setRemotePythonUserId(e.target.value)}
                                placeholder="user"
                                className="w-full mt-1 bg-[var(--bg-color)] border border-[var(--border-color)] rounded px-3 py-2 text-sm text-[var(--text-color)] focus:border-blue-500 outline-none"
                            />
                            <p className="text-[var(--text-color)] opacity-50 text-[11px] mt-1">Used to isolate /home on the remote server.</p>
                        </div>
                    </div>

                    <div>
                        <label className="text-[var(--text-color)] opacity-70 text-xs font-semibold uppercase">API Key (stored locally only)</label>
                        <input
                            type="password"
                            value={remotePythonApiKey}
                            onChange={(e) => setRemotePythonApiKey(e.target.value)}
                            placeholder="Same as in EC2 .env - If no api key set leave this blank"
                            className="w-full mt-1 bg-[var(--bg-color)] border border-[var(--border-color)] rounded px-3 py-2 text-sm text-[var(--text-color)] focus:border-blue-500 outline-none"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="flex items-center justify-between bg-[var(--bg-color)] border border-[var(--border-color)] rounded px-3 py-2">
                            <div>
                                <p className="text-[var(--text-color)] text-sm font-semibold">Overwrite on Pull</p>
                                <p className="text-[var(--text-color)] opacity-50 text-xs">Replace local files when remote differs.</p>
                            </div>
                            <button
                                onClick={() => setRemotePythonOverwriteOnPull(prev => !prev)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                                    remotePythonOverwriteOnPull ? 'bg-blue-600' : 'bg-gray-500'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        remotePythonOverwriteOnPull ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                        <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded px-3 py-2">
                            <label className="text-[var(--text-color)] opacity-70 text-xs font-semibold uppercase">Pull Interval (seconds)</label>
                            <input
                                type="number"
                                min={15}
                                max={3600}
                                value={remotePythonPullIntervalSec}
                                onChange={(e) => {
                                    const val = Number((e.target as HTMLInputElement).value || 60)
                                    setRemotePythonPullIntervalSec(Number.isNaN(val) ? 60 : val)
                                }}
                                className="w-full mt-1 bg-[var(--taskbar-bg)] border border-[var(--border-color)] rounded px-2 py-1 text-sm text-[var(--text-color)] focus:border-blue-500 outline-none"
                            />
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2">
                        <button
                            onClick={handleSaveRemotePython}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded transition shadow-sm"
                        >
                            Save Settings
                        </button>
                        <button
                            onClick={handleTestRemotePython}
                            className="px-4 py-2 bg-[var(--bg-color)] border border-[var(--border-color)] hover:bg-gray-500/10 text-[var(--text-color)] font-semibold text-sm rounded transition"
                        >
                            Test Connection
                        </button>
                    </div>

                    <div className="border border-[var(--border-color)] rounded bg-[var(--bg-color)] p-3 mt-4">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-[var(--text-color)] font-semibold text-sm">Conflict Viewer</p>
                            <button
                                onClick={refreshRemoteConflicts}
                                className="text-xs text-blue-500 hover:text-blue-400 font-semibold"
                            >
                                <i className="fas fa-sync-alt mr-1"></i> Refresh
                            </button>
                        </div>
                        {remoteConflictLoading && (
                            <p className="text-xs text-[var(--text-color)] opacity-50 py-2">Loading conflicts...</p>
                        )}
                        {remoteConflictError && !remoteConflictLoading && (
                            <p className="text-xs text-red-500 bg-red-500/10 p-2 rounded">{remoteConflictError}</p>
                        )}
                        {!remoteConflictLoading && !remoteConflictError && remoteConflictFiles.length === 0 && (
                            <p className="text-xs text-[var(--text-color)] opacity-50 py-2 text-center bg-[var(--taskbar-bg)] rounded border border-dashed border-[var(--border-color)]">No conflicts detected.</p>
                        )}
                        {!remoteConflictLoading && !remoteConflictError && remoteConflictFiles.length > 0 && (
                            <div className="space-y-2">
                                {remoteConflictFiles.map((path) => {
                                    const basePath = path.replace(/\.remote-\d{14}$/, '')
                                    return (
                                        <div key={path} className="bg-[var(--taskbar-bg)] border border-orange-500/30 rounded p-3">
                                            <div className="text-xs text-[var(--text-color)] font-mono break-all font-semibold">{path}</div>
                                            <div className="text-[11px] text-[var(--text-color)] opacity-60 mt-1">Original: {basePath}</div>
                                            <div className="flex gap-2 mt-3">
                                                <button
                                                    onClick={() => resolveConflictUseRemote(path)}
                                                    className="flex-1 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded transition"
                                                >
                                                    Use Remote
                                                </button>
                                                <button
                                                    onClick={() => resolveConflictKeepLocal(path)}
                                                    className="flex-1 py-1.5 text-xs font-semibold bg-[var(--bg-color)] border border-[var(--border-color)] hover:bg-gray-500/20 text-[var(--text-color)] rounded transition"
                                                >
                                                    Keep Local
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    <div className="border border-red-200 rounded-lg bg-[#e06c75] p-4 text-white shadow-sm">
                        <div className="flex flex-col gap-3">
                            <p className="font-semibold text-sm">Factory Reset</p>
                            <p className="text-[0.85rem] opacity-90">Clear local configuration and restore default layout settings immediately.</p>
                            <button
                                onClick={handleSystemReset}
                                className="w-full px-4 py-3 bg-white text-[#e06c75] font-semibold rounded shadow hover:bg-gray-100 transition cursor-pointer"
                            >
                                Reset System Defaults
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )

    const securityTabContent = () => (
        <div className="space-y-6">
            <div className="border border-[var(--border-color)] rounded-lg p-4 bg-[var(--taskbar-bg)] shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
                    <div className="flex items-center gap-2">
                        <i className="fas fa-shield-alt text-blue-500 text-lg"></i>
                        <h3 className="text-[var(--text-color)] font-bold text-lg">Audit Log</h3>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-[var(--text-color)] opacity-60 font-medium bg-[var(--bg-color)] border border-[var(--border-color)] px-2 py-1 rounded">Last {auditEntries.length} events</span>
                        <button
                            onClick={fetchAuditLog}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded transition shadow-sm flex items-center gap-2"
                        >
                            <i className="fas fa-sync-alt text-xs"></i> Refresh
                        </button>
                    </div>
                </div>
                <p className="text-[var(--text-color)] opacity-60 text-sm mb-4">
                    Auth events are captured server-side (in-memory ring buffer). Data resets on cold starts and never includes tokens.
                </p>
                <div className="bg-[var(--bg-color)] rounded-lg border border-[var(--border-color)] overflow-hidden">
                    <div className="grid grid-cols-5 gap-2 text-xs font-bold text-[var(--text-color)] opacity-70 uppercase tracking-wider px-4 py-3 bg-gray-500/10 border-b border-[var(--border-color)]">
                        <span>Time</span>
                        <span>Event</span>
                        <span>Status</span>
                        <span>Provider</span>
                        <span>IP</span>
                    </div>
                    <div className="divide-y divide-[var(--border-color)] max-h-80 overflow-y-auto scrollbar">
                        {auditLoading && (
                            <div className="px-4 py-6 text-center text-sm text-[var(--text-color)] opacity-50">
                                <i className="fas fa-spinner fa-spin mr-2"></i> Loading audit log...
                            </div>
                        )}
                        {auditError && !auditLoading && (
                            <div className="px-4 py-6 text-center text-sm text-red-500 bg-red-500/5">{auditError}</div>
                        )}
                        {!auditLoading && !auditError && auditEntries.length === 0 && (
                            <div className="px-4 py-8 text-center text-sm text-[var(--text-color)] opacity-50 flex flex-col items-center gap-2">
                                <i className="fas fa-clipboard-list text-2xl opacity-50"></i>
                                No audit events recorded yet.
                            </div>
                        )}
                        {!auditLoading && !auditError && auditEntries.map(entry => (
                            <div key={`local-${entry.id}`} className="grid grid-cols-5 gap-2 px-4 py-3 text-xs text-[var(--text-color)] hover:bg-gray-500/5 transition-colors">
                                <span className="opacity-70 whitespace-nowrap">{formatTimestamp(entry.ts)}</span>
                                <span className="font-mono text-[11px] font-semibold text-blue-500">{entry.event}</span>
                                <div>
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${entry.status === 'success' ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'}`}>
                                        {entry.status}
                                    </span>
                                </div>
                                <span className="capitalize opacity-80">{entry.provider || '—'}</span>
                                <span className="opacity-60 font-mono truncate" title={entry.ip}>{entry.ip === '::1' ? 'localhost' : entry.ip}</span>
                                {entry.message && (
                                    <span className="col-span-5 text-[var(--text-color)] opacity-50 text-[11px] mt-1 pl-1 border-l-2 border-gray-500/30">{entry.message}</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
                <div className="text-xs text-[var(--text-color)] opacity-50 mt-4 flex items-start gap-2 bg-blue-500/5 p-3 rounded border border-blue-500/10">
                    <i className="fas fa-info-circle text-blue-500 mt-0.5"></i>
                    Rate limiting is enabled server-side to protect auth endpoints; burst limits can be tuned via env vars.
                </div>
            </div>

            {/* Audit Sync to GitHub */}
            {storageStatus.connected && (storageStatus.provider === 'github' || storageStatus.provider === 'github-app') && (
                <div className="border border-[var(--border-color)] rounded-lg p-4 bg-[var(--taskbar-bg)] shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
                        <div className="flex items-center gap-2">
                            <i className="fas fa-cloud-upload-alt text-blue-500 text-lg"></i>
                            <h3 className="text-[var(--text-color)] font-bold text-lg">Audit Log Sync</h3>
                        </div>
                        <div className="flex items-center gap-3">
                            {auditSyncStatus.syncing && (
                                <span className="text-xs font-semibold text-blue-500 flex items-center gap-1"><i className="fas fa-spinner fa-spin"></i> Syncing...</span>
                            )}
                            {!auditSyncStatus.syncing && auditSyncStatus.pendingCount > 0 && (
                                <span className="text-xs font-semibold text-orange-500 bg-orange-500/10 px-2 py-1 rounded border border-orange-500/20">{auditSyncStatus.pendingCount} pending</span>
                            )}
                            {auditSyncStatus.lastSyncTime && (
                                <span className="text-xs text-[var(--text-color)] opacity-60 bg-[var(--bg-color)] border border-[var(--border-color)] px-2 py-1 rounded">
                                    Last sync: {new Date(auditSyncStatus.lastSyncTime).toLocaleTimeString()}
                                </span>
                            )}
                        </div>
                    </div>
                    <p className="text-[var(--text-color)] opacity-70 text-sm mb-4">
                        Automatically sync audit logs to your GitHub storage repository for cross-device access and long-term retention.
                    </p>
                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={syncAuditToGitHub}
                            disabled={auditSyncStatus.syncing}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded transition shadow-sm flex items-center gap-2"
                        >
                            <i className="fas fa-sync-alt"></i>
                            Force Sync Now
                        </button>
                        <button
                            onClick={loadSyncedAuditLogs}
                            disabled={auditLoading}
                            className="px-4 py-2 bg-[var(--bg-color)] border border-[var(--border-color)] hover:bg-gray-500/10 disabled:opacity-50 disabled:cursor-not-allowed text-[var(--text-color)] text-sm font-semibold rounded transition flex items-center gap-2"
                        >
                            <i className="fas fa-history text-blue-500"></i>
                            View Cloud History (30 days)
                        </button>
                    </div>
                    <div className="mt-5 flex items-center gap-3 bg-[var(--bg-color)] p-3 rounded-lg border border-[var(--border-color)]">
                        <div className="relative flex items-center">
                            <input
                                type="checkbox"
                                id="autoAuditSync"
                                checked={auditSyncStatus.autoSync}
                                onChange={(e) => auditSync.setAutoSync(e.target.checked)}
                                className="peer sr-only"
                            />
                            <div className="block h-6 w-11 rounded-full bg-gray-500 peer-checked:bg-blue-600 transition-colors"></div>
                            <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-5"></div>
                        </div>
                        <label htmlFor="autoAuditSync" className="text-sm font-medium text-[var(--text-color)] cursor-pointer">
                            Enable automatic background sync <span className="opacity-50 font-normal">(debounced 5s after changes)</span>
                        </label>
                    </div>

                    {/* Synced Logs Modal/Overlay */}
                    {showSyncedLogs && syncedAuditEntries.length > 0 && (
                        <div className="mt-6 border-t border-[var(--border-color)] pt-4">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-base font-bold text-[var(--text-color)] flex items-center gap-2">
                                    <i className="fas fa-cloud text-blue-500"></i> Cloud History
                                </h4>
                                <button
                                    onClick={() => setShowSyncedLogs(false)}
                                    className="text-xs font-semibold px-2 py-1 bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded transition"
                                >
                                    <i className="fas fa-times"></i> Close View
                                </button>
                            </div>
                            <div className="bg-[var(--bg-color)] rounded-lg border border-[var(--border-color)] overflow-hidden">
                                <div className="grid grid-cols-5 gap-2 text-xs font-bold text-[var(--text-color)] opacity-70 uppercase tracking-wider px-4 py-3 bg-gray-500/10 border-b border-[var(--border-color)]">
                                    <span>Time</span>
                                    <span>Event</span>
                                    <span>Status</span>
                                    <span>Provider</span>
                                    <span>IP</span>
                                </div>
                                <div className="divide-y divide-[var(--border-color)] max-h-80 overflow-y-auto scrollbar">
                                    {syncedAuditEntries.map(entry => (
                                        <div key={`synced-${entry.id}`} className="grid grid-cols-5 gap-2 px-4 py-3 text-xs text-[var(--text-color)] hover:bg-gray-500/5 transition-colors">
                                            <span className="opacity-70 whitespace-nowrap">{formatTimestamp(entry.ts)}</span>
                                            <span className="font-mono text-[11px] font-semibold text-blue-500">{entry.event}</span>
                                            <div>
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${entry.status === 'success' ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'}`}>
                                                    {entry.status}
                                                </span>
                                            </div>
                                            <span className="capitalize opacity-80">{entry.provider || '—'}</span>
                                            <span className="opacity-60 font-mono truncate" title={entry.ip}>{entry.ip === '::1' ? 'localhost' : entry.ip}</span>
                                            {entry.message && (
                                                <span className="col-span-5 text-[var(--text-color)] opacity-50 text-[11px] mt-1 pl-1 border-l-2 border-gray-500/30">{entry.message}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )

    const aboutTabContent = () => (
        <div className="space-y-6">
            {/* Logo and Title */}
            <div className="flex flex-col items-center py-8">
                <div className="bg-[var(--bg-color)] border border-[var(--border-color)] p-4 rounded-2xl shadow-lg mb-6">
                    <img src="/assets/logo.png" alt="ZynqOS" className="w-24 h-24 object-contain" />
                </div>
                <h2 className="text-3xl font-black text-[var(--text-color)] tracking-tight mb-2">ZynqOS</h2>
                <div className="bg-blue-500/10 border border-blue-500/20 px-3 py-1 rounded-full">
                    <p className="text-blue-600 dark:text-blue-400 font-bold text-sm tracking-wide">Browser Micro-Runtime v0.5</p>
                </div>
            </div>

            {/* Description */}
            <div className="border border-[var(--border-color)] rounded-xl p-5 bg-[var(--taskbar-bg)] shadow-sm text-center max-w-2xl mx-auto">
                <p className="text-[var(--text-color)] opacity-80 text-base leading-relaxed">
                    ZynqOS is a web-based operating system experience that brings together a comprehensive suite of applications and utilities in a single, interconnected environment. It leverages modern web technologies to provide a desktop-like experience entirely within your browser.
                </p>
            </div>

            {/* Features & Tech Stack Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl mx-auto">
                {/* Features */}
                <div className="border border-[var(--border-color)] rounded-xl overflow-hidden bg-[var(--taskbar-bg)] shadow-sm flex flex-col">
                    <div className="bg-[var(--bg-color)] border-b border-[var(--border-color)] px-5 py-4 flex items-center gap-3">
                        <div className="bg-purple-500/20 p-2 rounded-lg text-purple-500">
                            <i className="fas fa-microchip text-lg"></i>
                        </div>
                        <h3 className="text-[var(--text-color)] font-bold text-lg">Core Capabilities</h3>
                    </div>
                    <ul className="p-5 space-y-4 text-[var(--text-color)] opacity-80 text-sm flex-1">
                        <li className="flex items-start gap-3">
                            <div className="mt-0.5 bg-green-500/20 rounded-full p-1 text-green-500 shrink-0">
                                <i className="fas fa-check text-[10px]"></i>
                            </div>
                            <span className="leading-snug">WASI-based command-line utilities compiled to WebAssembly</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <div className="mt-0.5 bg-green-500/20 rounded-full p-1 text-green-500 shrink-0">
                                <i className="fas fa-check text-[10px]"></i>
                            </div>
                            <span className="leading-snug">Full-stack Python environment powered by Pyodide runtime</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <div className="mt-0.5 bg-green-500/20 rounded-full p-1 text-green-500 shrink-0">
                                <i className="fas fa-check text-[10px]"></i>
                            </div>
                            <span className="leading-snug">Multi-window system with cross-window cursor synchronization</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <div className="mt-0.5 bg-green-500/20 rounded-full p-1 text-green-500 shrink-0">
                                <i className="fas fa-check text-[10px]"></i>
                            </div>
                            <span className="leading-snug">OAuth-secured cloud sync with Google Drive and GitHub repos</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <div className="mt-0.5 bg-green-500/20 rounded-full p-1 text-green-500 shrink-0">
                                <i className="fas fa-check text-[10px]"></i>
                            </div>
                            <span className="leading-snug">Persistent VFS backed by IndexedDB with WASI interop</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <div className="mt-0.5 bg-green-500/20 rounded-full p-1 text-green-500 shrink-0">
                                <i className="fas fa-check text-[10px]"></i>
                            </div>
                            <span className="leading-snug">Window snapping engine with keyboard shortcuts and drag zones</span>
                        </li>
                    </ul>
                </div>

                {/* Technology Stack */}
                <div className="border border-[var(--border-color)] rounded-xl overflow-hidden bg-[var(--taskbar-bg)] shadow-sm flex flex-col">
                    <div className="bg-[var(--bg-color)] border-b border-[var(--border-color)] px-5 py-4 flex items-center gap-3">
                        <div className="bg-blue-500/20 p-2 rounded-lg text-blue-500">
                            <i className="fas fa-code text-lg"></i>
                        </div>
                        <h3 className="text-[var(--text-color)] font-bold text-lg">Technology Stack</h3>
                    </div>
                    <div className="p-5 grid grid-cols-2 gap-4 flex-1">
                        <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl p-4 hover:border-blue-500/50 transition-colors group">
                            <div className="text-blue-500 mb-2 group-hover:scale-110 transition-transform origin-left">
                                <i className="fab fa-react text-2xl"></i>
                            </div>
                            <p className="text-[var(--text-color)] opacity-50 text-[10px] font-bold uppercase tracking-wider mb-1">Frontend</p>
                            <p className="text-[var(--text-color)] font-semibold text-sm">React + TypeScript</p>
                        </div>
                        <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl p-4 hover:border-teal-500/50 transition-colors group">
                            <div className="text-teal-500 mb-2 group-hover:scale-110 transition-transform origin-left">
                                <i className="fas fa-paint-brush text-2xl"></i>
                            </div>
                            <p className="text-[var(--text-color)] opacity-50 text-[10px] font-bold uppercase tracking-wider mb-1">Styling</p>
                            <p className="text-[var(--text-color)] font-semibold text-sm">Tailwind CSS</p>
                        </div>
                        <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl p-4 hover:border-yellow-500/50 transition-colors group">
                            <div className="text-yellow-500 mb-2 group-hover:scale-110 transition-transform origin-left">
                                <i className="fas fa-database text-2xl"></i>
                            </div>
                            <p className="text-[var(--text-color)] opacity-50 text-[10px] font-bold uppercase tracking-wider mb-1">Storage</p>
                            <p className="text-[var(--text-color)] font-semibold text-sm">IndexedDB</p>
                        </div>
                        <div className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl p-4 hover:border-purple-500/50 transition-colors group">
                            <div className="text-purple-500 mb-2 group-hover:scale-110 transition-transform origin-left">
                                <i className="fas fa-cog text-2xl"></i>
                            </div>
                            <p className="text-[var(--text-color)] opacity-50 text-[10px] font-bold uppercase tracking-wider mb-1">Runtime</p>
                            <p className="text-[var(--text-color)] font-semibold text-sm">WebAssembly</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="text-center py-6 mt-4">
                <p className="text-[var(--text-color)] opacity-40 font-mono text-xs font-semibold tracking-widest uppercase">
                    Designed & Built for the Web
                </p>
            </div>
        </div>
    )

    // Helper functions - defined before they're used
    function getBrowserInfoLocal(): string {
        const ua = navigator.userAgent
        if (ua.indexOf('Firefox') > -1) return 'Firefox'
        if (ua.indexOf('Chrome') > -1) return 'Chromium'
        if (ua.indexOf('Safari') > -1) return 'Safari'
        if (ua.indexOf('Edge') > -1) return 'Edge'
        return 'Unknown'
    }

    function getPlatformInfoLocal(): string {
        const ua = navigator.userAgent
        if (ua.indexOf('Win') > -1) return 'Windows'
        if (ua.indexOf('Mac') > -1) return 'macOS'
        if (ua.indexOf('X11') > -1 || ua.indexOf('Linux') > -1) return 'Linux'
        if (ua.indexOf('Android') > -1) return 'Android'
        if (ua.indexOf('iPhone') > -1 || ua.indexOf('iPad') > -1) return 'iOS'
        return 'Unknown'
    }

    return (
        <div className="h-full bg-[var(--bg-color)] text-[var(--text-color)] flex flex-col scrollbar relative overflow-hidden">
            {/* Header Area */}
            <div className="border-b border-[var(--border-color)] bg-[var(--taskbar-bg)] px-8 py-6 shrink-0 relative z-10">
                <div className="flex items-center gap-4">
                    <div className="bg-blue-600 text-white p-3 rounded-xl shadow-lg shadow-blue-600/20">
                        <i className="fas fa-sliders-h text-xl"></i>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">System Settings</h1>
                        <p className="text-[var(--text-color)] opacity-60 text-sm font-medium mt-0.5">Manage preferences, storage, and security</p>
                    </div>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="border-b border-[var(--border-color)] flex relative bg-[var(--taskbar-bg)] px-4 shrink-0 z-10 overflow-x-auto no-scrollbar">
                {(['about', 'display', 'storage', 'security', 'system'] as const).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex items-center gap-2 px-6 py-4 font-bold text-sm tracking-wide transition-all duration-300 relative whitespace-nowrap ${activeTab === tab
                            ? 'text-blue-500'
                            : 'text-[var(--text-color)] opacity-60 hover:opacity-100 hover:bg-gray-500/5'
                            }`}
                    >
                        <i className={`fas fa-${
                            tab === 'about' ? 'info-circle' :
                            tab === 'display' ? 'palette' :
                            tab === 'storage' ? 'cloud' :
                            tab === 'security' ? 'shield-alt' :
                            'cog'
                        } ${activeTab === tab ? 'text-blue-500' : 'opacity-70'}`}></i>
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        
                        {/* Active Indicator */}
                        {activeTab === tab && (
                            <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-500 rounded-t-full shadow-[0_-2px_10px_rgba(59,130,246,0.5)]"></div>
                        )}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 scrollbar bg-[var(--bg-color)] relative z-0">
                <div className="max-w-5xl mx-auto w-full transition-opacity duration-300">
                    <div className="tab-slide-enter" key={activeTab}>
                        {activeTab === 'display' && displayTabContent()}
                        {activeTab === 'storage' && storageTabContent()}
                        {activeTab === 'security' && securityTabContent()}
                        {activeTab === 'system' && systemTabContent()}
                        {activeTab === 'about' && aboutTabContent()}
                    </div>
                </div>
            </div>
        </div>
    )
}

// Export for window-based app loading
window.__SETTINGS_UI__ = SettingsUI