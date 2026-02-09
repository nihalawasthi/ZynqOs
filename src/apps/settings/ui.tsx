import React, { useState, useEffect } from 'react'
import { toast } from '../../hooks/use-toast'
import { getStorageStatus, disconnectStorage, type StorageStatus, connectGitHubRepo } from '../../auth/storage'
import { githubSync } from '../../storage/githubSync'
import { auditSync, type AuditEntry as AuditSyncEntry } from '../../utils/auditSync'
import { readFile, writeFile, removeFile, readdir } from '../../vfs/fs'

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
    const [remotePythonBaseUrl, setRemotePythonBaseUrl] = useState(DEFAULT_SETTINGS.remotePython.baseUrl || 'https://ec2-13-233-236-112.ap-south-1.compute.amazonaws.com:8000')
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
                root.style.backgroundImage = `url('${wp.source}')`
                root.style.backgroundSize = wp.size
                root.style.backgroundRepeat = wp.repeat
                root.style.backgroundPosition = wp.position
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
                        className="px-3 py-1 text-sm bg-blue-600 rounded hover:bg-blue-700"
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
                    'zynqos_session_timer'
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
                className="px-3 py-1 text-sm bg-red-600 rounded hover:bg-red-700"
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
                    className="px-3 py-1 text-sm bg-red-600 rounded hover:bg-red-700"
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
            description: 'This will restore the default wallpaper.',
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
                        applyWallpaper(newSettings.display.wallpaper)
                        toast({ title: 'Success', description: 'Wallpaper reset to default', variant: 'success' })
                    }}
                    className="px-3 py-1 text-sm bg-blue-600 rounded hover:bg-blue-700"
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
            {/* Wallpaper Settings */}
            <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                <div className='w-full flex items-center justify-between mb-3'>
                    <h3 className="text-white font-semibold flex items-center gap-2">
                        <i className="fas fa-image"></i>
                        Wallpaper
                    </h3>

                    {/* Reset Button */}
                    {settings.display.wallpaper.source !== DEFAULT_SETTINGS.display.wallpaper.source && (
                        <button
                            onClick={handleResetWallpaper}
                            className="transition text-gray-400 hover:text-gray-200 ml-auto"
                            title="Restart"
                        >
                            <i className="fas fa-redo text-xs"></i>
                        </button>
                    )}
                </div>
                <div className="space-y-4">
                    {/* All Wallpaper Controls - Single Line */}
                    <div className="bg-black/50 rounded p-3">
                        <div className="flex gap-2 items-center">
                            <input type="text" value={settings.display.wallpaper.source || ''} onChange={(e) => handleWallpaperInputChange(e.target.value)} className="flex-1 bg-gray-900 text-gray-300 px-3 py-2 rounded text-xs border border-gray-700 focus:border-blue-500 focus:outline-none" placeholder="Wallpaper URL" />
                            <input type="file" id="wallpaper-upload" accept="image/*" onChange={handleWallpaperUpload} disabled={wallpaperLoading} className="hidden" />
                            <button onClick={() => document.getElementById('wallpaper-upload')?.click()} disabled={wallpaperLoading} className="px-3 py-2 bg-blue-600/80 hover:bg-blue-700/80 disabled:bg-gray-600 text-white text-xs rounded transition whitespace-nowrap">{wallpaperLoading ? 'Uploading...' : <i className="fa-solid fa-upload"></i>}</button>
                            {/* <button onClick={handleWallpaperUrl} className="px-3 py-2 bg-blue-600/80 hover:bg-blue-700/80 text-white text-xs rounded transition whitespace-nowrap">🔗 URL</button> */}
                            <select value={settings.display.wallpaper.size || '60%'} onChange={(e) => handleBackgroundSizeChange(e.target.value)} className="bg-gray-900 text-gray-300 p-2 rounded text-xs border border-gray-700 focus:border-blue-500 focus:outline-none cursor-pointer">
                                <option value="100% 100%">Full</option>
                                <option value="cover">Cover</option>
                                <option value="contain">Contain</option>
                                <option value="60%">Center</option>
                            </select>
                        </div>
                    </div>
                </div>
                <span className="text-gray-400 text-xs"> <i className="fas fa-info-circle text-xs"></i> Enter image URL or upload an image. Supported formats: JPG, PNG, GIF. Large images may impact performance.</span>
            </div>

            {/* Theme Settings */}
            {/* <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-palette"></i>
                    Theme
                </h3>
                <div className="space-y-2">
                    <label className="flex items-center gap-3 p-2 rounded hover:bg-[#2a2a2a] cursor-pointer">
                        <input type="radio" name="theme" value="dark" defaultChecked className="w-4 h-4" />
                        <span className="text-gray-300">Dark Mode (Default)</span>
                    </label>
                    <p className="text-gray-400 text-xs px-2 py-1">
                        Theme customization coming soon. Currently using dark theme throughout the system.
                    </p>
                </div>
            </div> */}

            {/* Window Settings */}
            <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-window-maximize"></i>
                    Window Management
                </h3>
                <div className="space-y-3 text-gray-300 text-sm">
                    <div className="bg-black/50 rounded p-3">
                        <p className="font-semibold mb-2">Window Snapping</p>
                        <ul className="list-disc list-inside space-y-1 text-gray-400 text-xs">
                            <li><code className="bg-black px-1 py-0.5 rounded text-xs">Ctrl+Left</code> - Snap left</li>
                            <li><code className="bg-black px-1 py-0.5 rounded text-xs">Ctrl+Right</code> - Snap right</li>
                            <li><code className="bg-black px-1 py-0.5 rounded text-xs">Ctrl+Up</code> - Maximize</li>
                            <li><code className="bg-black px-1 py-0.5 rounded text-xs">Ctrl+Down</code> - Restore</li>
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
            <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-cloud"></i>
                    Cloud Storage
                </h3>
                <div className="space-y-3">
                    {storageStatus.connected ? (
                        <>
                                <div className="bg-green-900/20 border border-green-700/50 rounded p-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {profile?.profile?.avatar_url && (
                                            <img src={profile.profile.avatar_url} alt="Avatar" className="w-8 h-8 rounded-full" />
                                        )}
                                        <div>
                                            <p className="text-green-300 font-semibold">{profile?.profile?.name || 'Connected'}</p>
                                            {profile?.profile?.email && (
                                                <p className="text-green-400/70 text-sm">{profile.profile.email}</p>
                                            )}
                                            {profile?.provider && (
                                                <p className="text-green-400/70 text-sm">
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
                                            className="px-3 py-1 bg-green-700 hover:bg-green-800 text-white text-sm rounded transition"
                                        >
                                            Configure GitHub App
                                        </a>
                                        <button
                                            onClick={handleDisconnectStorage}
                                            className="px-3 py-1 bg-gray-700 hover:bg-gray-800 text-white text-sm rounded transition"
                                        >
                                            Disconnect
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : storageStatus.authenticated ? (
                        <>
                            <div className="bg-blue-900/20 border border-blue-700/50 rounded p-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {profile?.profile?.avatar_url && (
                                            <img src={profile.profile.avatar_url} alt="Avatar" className="w-8 h-8 rounded-full" />
                                        )}
                                        <div>
                                            <p className="text-blue-300 font-semibold">{profile?.profile?.name || 'Authenticated'}</p>
                                            {profile?.profile?.email && (
                                                <p className="text-blue-400/70 text-sm">{profile.profile.email}</p>
                                            )}
                                            {profile?.provider && (
                                                <p className="text-blue-400/70 text-sm">
                                                    Signed in with <span className="capitalize">{profile.provider}</span>
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleDisconnectStorage}
                                        className="px-3 py-1 bg-gray-700 hover:bg-gray-800 text-white text-sm rounded transition"
                                    >
                                        Sign Out
                                    </button>
                                </div>
                            </div>
                            <div className="bg-black/40 rounded p-3 space-y-2">
                                <p className="text-gray-200 text-sm font-semibold">Enable Decentralized Storage</p>
                                <p className="text-gray-300 text-xs">
                                    You're signed in! Now set up decentralized storage to sync your files and settings across devices using your own GitHub repo.
                                </p>
                                <div className="flex gap-2 items-center mt-3">
                                    <a
                                        href={(import.meta as any).env?.VITE_GITHUB_APP_INSTALL_URL || 'https://github.com/apps/zynq-os/installations/new'}
                                        rel="noreferrer"
                                        className="px-4 py-2 bg-green-600/80 hover:bg-green-700/80 text-white text-sm rounded transition font-semibold"
                                    >
                                        Install GitHub App
                                    </a>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="bg-gray-900/50 border border-gray-700/50 rounded p-3 space-y-3">
                            <div className="bg-black/40 rounded p-3 space-y-2">
                                <p className="text-gray-200 text-sm font-semibold">Connect GitHub Repo</p>
                                <ol className="list-decimal list-inside text-gray-400 text-xs space-y-1">
                                    <li>Create a new private [recommended] repo on GitHub for your ZynqOS data</li>
                                    <li>Click "Install App" to authorize ZynqOS</li>
                                    <li>Select the repo during installation and authorize</li>
                                    <li>You'll be redirected back to ZynqOS with your data connected</li>
                                </ol>
                                <p className="text-gray-300 text-xs mt-2">
                                    Your files, settings, and audit logs will be synced to your repo and accessible across all devices signed in with your GitHub account. All data stays in your control—ZynqOS cannot access your repo without your authorization.
                                    <br />
                                    <span className="text-gray-400">Default storage repo: /your-username/.zynqos_storage</span>
                                </p>
                                <div className="flex gap-2 items-center mt-3">
                                    <a
                                        href={(import.meta as any).env?.VITE_GITHUB_APP_INSTALL_URL || 'https://github.com/apps/zynq-os/installations/new'}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="px-4 py-2 bg-green-600/80 hover:bg-green-700/80 text-white text-sm rounded transition font-semibold"
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
            <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-database"></i>
                    Local Storage
                </h3>
                <div className="space-y-3">
                    <div className="bg-black/50 rounded p-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-gray-300">Cache Usage</span>
                            <span className="text-blue-400 font-mono text-sm">{cacheSize}</span>
                        </div>
                        <div className="w-full bg-gray-700 rounded-full h-2">
                            <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${cacheRatio}%` }}></div>
                        </div>
                        <p className="text-gray-500 text-xs mt-2">
                            Includes temporary files, images, and app data.
                        </p>
                    </div>
                    <button
                        onClick={handleClearCache}
                        className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-800 text-white text-sm rounded transition"
                    >
                        Clear Cache
                    </button>
                </div>
            </div>

            {/* Sync Status */}
            <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-sync"></i>
                    GitHub Sync
                </h3>
                
                {!storageStatus.authenticated ? (
                    <div className="bg-black/50 rounded p-3">
                        <p className="text-gray-400 text-sm">
                            Sign in with GitHub to enable peer-to-peer sync
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {/* Sync Status Display */}
                        <div className="bg-black/50 rounded p-3 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-gray-400">Last Sync</span>
                                <span className={`text-sm ${syncStatus.lastSyncTime ? 'text-green-400' : 'text-gray-500'}`}>
                                    {formatLastSyncTime(syncStatus.lastSyncTime)}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-gray-400">Pending Changes</span>
                                <span className={`text-sm font-mono ${syncStatus.pendingChanges > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
                                    {syncStatus.pendingChanges}
                                </span>
                            </div>
                            {syncStatus.error && (
                                <div className="text-red-400 text-xs mt-2">
                                    Error: {syncStatus.error}
                                </div>
                            )}
                        </div>

                        {/* Manual Sync / Pull Buttons */}
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={handleSyncNow}
                                disabled={syncStatus.syncing}
                                className={`w-full px-4 py-2 rounded text-sm font-semibold transition ${
                                    syncStatus.syncing
                                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                                }`}
                            >
                                {syncStatus.syncing ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin mr-2"></i>
                                        Push…
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-cloud-upload-alt mr-2"></i>
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
                                className={`w-full px-4 py-2 rounded text-sm font-semibold transition ${
                                    syncStatus.syncing
                                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                        : 'bg-gray-700 hover:bg-gray-600 text-white'
                                }`}
                            >
                                <i className="fas fa-cloud-download-alt mr-2"></i>
                                Pull Now
                            </button>
                        </div>

                        {/* Auto-sync Settings */}
                        <div className="bg-black/40 rounded p-3 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-300 text-sm">Auto-sync</span>
                                    <span className="text-gray-500 text-xs">Background sync</span>
                                </div>
                                <button
                                    onClick={handleAutoSyncToggle}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                        autoSyncEnabled ? 'bg-blue-600' : 'bg-gray-600'
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
                                <div className="space-y-2">
                                    <label className="text-gray-400 text-sm">Sync interval</label>
                                    <select
                                        value={autoSyncInterval}
                                        onChange={(e) => handleAutoSyncIntervalChange(Number(e.target.value))}
                                        className="w-full bg-gray-900 text-gray-300 px-3 py-2 rounded text-sm border border-gray-700 focus:border-blue-500 focus:outline-none"
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

                        <p className="text-gray-500 text-xs">
                            Your data is synced to your own GitHub repo: .zynqos_storage. All files, settings, and logs stay under your control.
                        </p>
                    </div>
                )}
            </div>
        </div>
    )

    const systemTabContent = () => (
        <div className="space-y-6">
            {/* Session Time */}
            <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-hourglass-half"></i>
                    Session Activity
                </h3>
                <div className="bg-black/50 rounded p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-gray-300">Total Active Time</span>
                        <span className="text-blue-400 font-mono text-lg font-bold">{sessionTime}</span>
                    </div>
                    <p className="text-gray-500 text-xs">
                        Tracks time spent actively using this application. Pauses during idle periods (1 minute threshold).
                    </p>
                </div>
            </div>

            {/* System Information */}
            <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-info-circle"></i>
                    System Information
                </h3>
                <div className="space-y-2 text-sm">
                    <div className="bg-black/50 rounded p-3 flex items-center justify-between">
                        <span className="text-gray-400">OS</span>
                        <span className="text-gray-200">ZynqOS (Web-based)</span>
                    </div>
                    <div className="bg-black/50 rounded p-3 flex items-center justify-between">
                        <span className="text-gray-400">Browser</span>
                        <span className="text-gray-200">{getBrowserInfoLocal()}</span>
                    </div>
                    <div className="bg-black/50 rounded p-3 flex items-center justify-between">
                        <span className="text-gray-400">Platform</span>
                        <span className="text-gray-200">{getPlatformInfoLocal()}</span>
                    </div>
                    <div className="bg-black/50 rounded p-3 flex items-center justify-between">
                        <span className="text-gray-400">Runtime</span>
                        <span className="text-gray-200">WASI + WebAssembly</span>
                    </div>
                </div>
            </div>

            {/* Remote Python Runtime */}
            <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-terminal"></i>
                    Remote Python Runtime
                </h3>
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-gray-300 text-sm">Enable Remote Runtime</p>
                            <p className="text-gray-500 text-xs">Optional: only set this if you run your own server-side runtime.</p>
                        </div>
                        <button
                            onClick={() => setRemotePythonEnabled(prev => !prev)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                remotePythonEnabled ? 'bg-blue-600' : 'bg-gray-600'
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
                            <label className="text-gray-400 text-xs">Base URL</label>
                            <input
                                value={remotePythonBaseUrl}
                                onChange={(e) => setRemotePythonBaseUrl(e.target.value)}
                                placeholder="ec2-13-233-236-112.ap-south-1.compute.amazonaws.com:8000"
                                className="w-full mt-1 bg-[#151515] border border-[#333] rounded px-3 py-2 text-sm text-gray-200"
                            />
                            <p className="text-gray-500 text-[11px] mt-1">Leave empty to keep local Pyodide runtime.</p>
                        </div>
                        <div>
                            <label className="text-gray-400 text-xs">User ID</label>
                            <input
                                value={remotePythonUserId}
                                onChange={(e) => setRemotePythonUserId(e.target.value)}
                                placeholder="nihal"
                                className="w-full mt-1 bg-[#151515] border border-[#333] rounded px-3 py-2 text-sm text-gray-200"
                            />
                            <p className="text-gray-500 text-[11px] mt-1">Used to isolate /home on the remote server.</p>
                        </div>
                    </div>

                    <div>
                        <label className="text-gray-400 text-xs">API Key (stored locally only)</label>
                        <input
                            type="password"
                            value={remotePythonApiKey}
                            onChange={(e) => setRemotePythonApiKey(e.target.value)}
                            placeholder="Same as in EC2 .env - If no api key set leave this blank"
                            className="w-full mt-1 bg-[#151515] border border-[#333] rounded px-3 py-2 text-sm text-gray-200"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="flex items-center justify-between bg-black/40 border border-[#333] rounded px-3 py-2">
                            <div>
                                <p className="text-gray-300 text-sm">Overwrite on Pull</p>
                                <p className="text-gray-500 text-xs">Replace local files when remote differs.</p>
                            </div>
                            <button
                                onClick={() => setRemotePythonOverwriteOnPull(prev => !prev)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    remotePythonOverwriteOnPull ? 'bg-blue-600' : 'bg-gray-600'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        remotePythonOverwriteOnPull ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                        <div>
                            <label className="text-gray-400 text-xs">Pull Interval (seconds)</label>
                            <input
                                type="number"
                                min={15}
                                max={3600}
                                value={remotePythonPullIntervalSec}
                                onChange={(e) => {
                                    const val = Number((e.target as HTMLInputElement).value || 60)
                                    setRemotePythonPullIntervalSec(Number.isNaN(val) ? 60 : val)
                                }}
                                className="w-full mt-1 bg-[#151515] border border-[#333] rounded px-3 py-2 text-sm text-gray-200"
                            />
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={handleSaveRemotePython}
                            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition"
                        >
                            Save Settings
                        </button>
                        <button
                            onClick={handleTestRemotePython}
                            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition"
                        >
                            Test Connection
                        </button>
                    </div>

                    <div className="border border-[#333] rounded bg-black/40 p-3">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-gray-300 text-sm">Conflict Viewer</p>
                            <button
                                onClick={refreshRemoteConflicts}
                                className="text-xs text-gray-300 hover:text-white"
                            >
                                Refresh
                            </button>
                        </div>
                        {remoteConflictLoading && (
                            <p className="text-xs text-gray-400">Loading conflicts...</p>
                        )}
                        {remoteConflictError && !remoteConflictLoading && (
                            <p className="text-xs text-red-400">{remoteConflictError}</p>
                        )}
                        {!remoteConflictLoading && !remoteConflictError && remoteConflictFiles.length === 0 && (
                            <p className="text-xs text-gray-500">No conflicts detected.</p>
                        )}
                        {!remoteConflictLoading && !remoteConflictError && remoteConflictFiles.length > 0 && (
                            <div className="space-y-2">
                                {remoteConflictFiles.map((path) => {
                                    const basePath = path.replace(/\.remote-\d{14}$/, '')
                                    return (
                                        <div key={path} className="bg-[#151515] border border-[#333] rounded px-3 py-2">
                                            <div className="text-xs text-gray-300 break-all">{path}</div>
                                            <div className="text-[11px] text-gray-500">Original: {basePath}</div>
                                            <div className="flex gap-2 mt-2">
                                                <button
                                                    onClick={() => resolveConflictUseRemote(path)}
                                                    className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
                                                >
                                                    Use Remote
                                                </button>
                                                <button
                                                    onClick={() => resolveConflictKeepLocal(path)}
                                                    className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded"
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
                </div>
            </div>

            {/* Storage Usage */}
            <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-chart-pie"></i>
                    Storage Usage
                </h3>
                <div className="bg-black/50 rounded p-3 space-y-3">
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-gray-400 text-sm">IndexedDB</span>
                            <span className="text-gray-300 text-sm">{cacheSize}</span>
                        </div>
                        <div className="w-full bg-gray-700 rounded-full h-2">
                            <div className="bg-green-500 h-2 rounded-full" style={{ width: `${cacheRatio}%` }}></div>
                        </div>
                    </div>
                    <p className="text-gray-500 text-xs">
                        Files, apps, and VFS data stored in browser IndexedDB.
                    </p>
                </div>
            </div>
        </div>
    )

    const securityTabContent = () => (
        <div className="space-y-6">
            <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <i className="fas fa-shield-alt text-blue-400"></i>
                        <h3 className="text-white font-semibold">Audit Log</h3>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={fetchAuditLog}
                            className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded transition"
                        >
                            Refresh
                        </button>
                        <span className="text-xs text-gray-500">Last {auditEntries.length} events</span>
                    </div>
                </div>
                <p className="text-gray-400 text-sm mb-3">
                    Auth events are captured server-side (in-memory ring buffer). Data resets on cold starts and never includes tokens.
                </p>
                <div className="bg-black/40 rounded border border-[#333] divide-y divide-[#222]">
                    <div className="grid grid-cols-5 gap-2 text-xs text-gray-400 px-3 py-2">
                        <span>Time</span>
                        <span>Event</span>
                        <span>Status</span>
                        <span>Provider</span>
                        <span>IP</span>
                    </div>
                    {auditLoading && (
                        <div className="px-3 py-3 text-sm text-gray-300">Loading audit log...</div>
                    )}
                    {auditError && !auditLoading && (
                        <div className="px-3 py-3 text-sm text-red-400">{auditError}</div>
                    )}
                    {!auditLoading && !auditError && auditEntries.length === 0 && (
                        <div className="px-3 py-3 text-sm text-gray-400">No audit events recorded yet.</div>
                    )}
                    {!auditLoading && !auditError && auditEntries.map(entry => (
                        <div key={`local-${entry.id}`} className="grid grid-cols-5 gap-2 px-3 py-2 text-xs text-gray-200">
                            <span className="text-gray-400">{formatTimestamp(entry.ts)}</span>
                            <span className="font-mono text-[11px] text-gray-100">{entry.event}</span>
                            <span className={entry.status === 'success' ? 'text-green-400' : 'text-red-400'}>{entry.status}</span>
                            <span className="capitalize text-gray-300">{entry.provider || '—'}</span>
                            <span className="text-gray-400 truncate" title={entry.ip}>{entry.ip === '::1' ? 'localhost' : entry.ip}</span>
                            {entry.message && (
                                <span className="col-span-5 text-gray-400 text-[11px]">{entry.message}</span>
                            )}
                        </div>
                    ))}
                </div>
                <div className="text-xs text-gray-500 mt-3">
                    Rate limiting is enabled server-side to protect auth endpoints; burst limits can be tuned via env vars.
                </div>
            </div>

            {/* Audit Sync to GitHub */}
            {storageStatus.connected && (storageStatus.provider === 'github' || storageStatus.provider === 'github-app') && (
                <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <i className="fas fa-cloud-upload-alt text-blue-400"></i>
                            <h3 className="text-white font-semibold">Audit Log Sync</h3>
                        </div>
                        <div className="flex items-center gap-2">
                            {auditSyncStatus.syncing && (
                                <span className="text-xs text-blue-400">Syncing...</span>
                            )}
                            {!auditSyncStatus.syncing && auditSyncStatus.pendingCount > 0 && (
                                <span className="text-xs text-yellow-400">{auditSyncStatus.pendingCount} pending</span>
                            )}
                            {auditSyncStatus.lastSyncTime && (
                                <span className="text-xs text-gray-500">
                                    Last sync: {new Date(auditSyncStatus.lastSyncTime).toLocaleTimeString()}
                                </span>
                            )}
                        </div>
                    </div>
                    <p className="text-gray-400 text-sm mb-3">
                        Automatically sync audit logs to your GitHub storage repository for cross-device access and long-term retention.
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={syncAuditToGitHub}
                            disabled={auditSyncStatus.syncing}
                            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm rounded transition flex items-center gap-2"
                        >
                            <i className="fas fa-sync-alt"></i>
                            Sync Now
                        </button>
                        <button
                            onClick={loadSyncedAuditLogs}
                            disabled={auditLoading}
                            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white text-sm rounded transition flex items-center gap-2"
                        >
                            <i className="fas fa-history"></i>
                            View History (30 days)
                        </button>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="autoAuditSync"
                            checked={auditSyncStatus.autoSync}
                            onChange={(e) => auditSync.setAutoSync(e.target.checked)}
                            className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                        />
                        <label htmlFor="autoAuditSync" className="text-sm text-gray-300">
                            Enable automatic sync (debounced 5s after changes)
                        </label>
                    </div>
                    {showSyncedLogs && syncedAuditEntries.length > 0 && (
                        <div className="mt-4">
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="text-sm font-semibold text-white">Synced History</h4>
                                <button
                                    onClick={() => setShowSyncedLogs(false)}
                                    className="text-xs text-gray-400 hover:text-gray-300"
                                >
                                    <i className="fas fa-times"></i> Close
                                </button>
                            </div>
                            <div className="bg-black/40 rounded border border-[#333] divide-y divide-[#222] max-h-60 overflow-y-auto scrollbar">
                                <div className="grid grid-cols-5 gap-2 text-xs text-gray-400 px-3 py-2 sticky top-0 bg-black/60">
                                    <span>Time</span>
                                    <span>Event</span>
                                    <span>Status</span>
                                    <span>Provider</span>
                                    <span>IP</span>
                                </div>
                                {syncedAuditEntries.map(entry => (
                                    <div key={`synced-${entry.id}`} className="grid grid-cols-5 gap-2 px-3 py-2 text-xs text-gray-200">
                                        <span className="text-gray-400">{formatTimestamp(entry.ts)}</span>
                                        <span className="font-mono text-[11px] text-gray-100">{entry.event}</span>
                                        <span className={entry.status === 'success' ? 'text-green-400' : 'text-red-400'}>{entry.status}</span>
                                        <span className="capitalize text-gray-300">{entry.provider || '—'}</span>
                                        <span className="text-gray-400 truncate" title={entry.ip}>{entry.ip === '::1' ? 'localhost' : entry.ip}</span>
                                        {entry.message && (
                                            <span className="col-span-5 text-gray-400 text-[11px]">{entry.message}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <p className="text-xs text-gray-500 mt-3">
                        Logs are stored in your .zynqos_storage repo under logs/YYYY-MM-DD.json for easy access across devices.
                    </p>
                </div>
            )}
        </div>
    )

    const aboutTabContent = () => (
        <div className="space-y-6">
            {/* Logo and Title */}
            <div className="flex flex-col items-center py-6">
                <img src="/assets/logo.png" alt="ZynqOS" className="w-24 h-24 mb-4" />
                <h2 className="text-2xl font-bold text-white mb-2">ZynqOS</h2>
                <p className="text-blue-400 text-sm">Browser Micro-Runtime v0.5</p>
            </div>

            {/* Description */}
            <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                <h3 className="text-white font-semibold mb-3">About</h3>
                <p className="text-gray-300 text-sm leading-relaxed">
                    ZynqOS is a web-based operating system experience that brings together a comprehensive suite of applications and utilities in a single, interconnected environment. It leverages modern web technologies to provide a desktop-like experience entirely in your browser.
                </p>
            </div>

            {/* Features */}
            <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <i className="fas fa-microchip"></i>
                    Core Capabilities
                </h3>
                <ul className="space-y-2 text-gray-300 text-sm">
                    <li className="flex items-start gap-2">
                        <i className="fas fa-check text-blue-500 mt-1"></i>
                        <span>WASI-based command-line utilities compiled to WebAssembly</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <i className="fas fa-check text-blue-500 mt-1"></i>
                        <span>Full-stack Python environment powered by Pyodide runtime</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <i className="fas fa-check text-blue-500 mt-1"></i>
                        <span>Multi-window system with cross-window cursor synchronization</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <i className="fas fa-check text-blue-500 mt-1"></i>
                        <span>OAuth-secured cloud sync with Google Drive and GitHub repos</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <i className="fas fa-check text-blue-500 mt-1"></i>
                        <span>Persistent VFS backed by IndexedDB with WASI interop</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <i className="fas fa-check text-blue-500 mt-1"></i>
                        <span>Window snapping engine with keyboard shortcuts and drag zones</span>
                    </li>
                </ul>
            </div>

            {/* Technology Stack */}
            <div className="border border-[#333] rounded-lg p-4 bg-[#1a1a1a]">
                <h3 className="text-white font-semibold mb-3">Technology</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-black/50 rounded p-2">
                        <p className="text-gray-400 text-xs">Frontend</p>
                        <p className="text-gray-200">React + TypeScript</p>
                    </div>
                    <div className="bg-black/50 rounded p-2">
                        <p className="text-gray-400 text-xs">Styling</p>
                        <p className="text-gray-200">Tailwind CSS</p>
                    </div>
                    <div className="bg-black/50 rounded p-2">
                        <p className="text-gray-400 text-xs">Storage</p>
                        <p className="text-gray-200">IndexedDB</p>
                    </div>
                    <div className="bg-black/50 rounded p-2">
                        <p className="text-gray-400 text-xs">Runtime</p>
                        <p className="text-gray-200">WebAssembly</p>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="text-center py-4">
                <p className="text-gray-500 text-xs">
                    A comprehensive desktop-like OS for the web, powered by WASI & WebAssembly
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
        <div className="h-full bg-black text-white flex flex-col scrollbar">
            {/* Header */}
            <div className="border-b border-[#333] p-6">
                <h1 className="text-2xl font-bold">System Settings</h1>
            </div>

            {/* Tab Navigation */}
            <div className="border-b border-[#333] flex relative">
                {(['about', 'display', 'storage', 'security', 'system'] as const).map((tab, index) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex-1 px-4 py-3 font-semibold text-sm uppercase tracking-wide transition-colors duration-500 ${activeTab === tab
                            ? 'text-blue-400'
                            : 'text-gray-400 hover:text-gray-300'
                            }`}
                    >
                        {tab === 'about' && <i className="fas fa-info-circle mr-2"></i>}
                        {tab === 'display' && <i className="fas fa-palette mr-2"></i>}
                        {tab === 'storage' && <i className="fas fa-cloud mr-2"></i>}
                        {tab === 'security' && <i className="fas fa-shield-alt mr-2"></i>}
                        {tab === 'system' && <i className="fas fa-cog mr-2"></i>}
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
                {/* Sliding indicator */}
                <div 
                    className="absolute bottom-0 h-0.5 bg-blue-500 transition-all duration-500 ease-out"
                    style={{
                        width: '20%',
                        left: `${['about', 'display', 'storage', 'security', 'system'].indexOf(activeTab) * 20}%`
                    }}
                ></div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 scrollbar">
                <div className="tab-slide-enter" key={activeTab}>
                    {activeTab === 'display' && displayTabContent()}
                    {activeTab === 'storage' && storageTabContent()}
                    {activeTab === 'security' && securityTabContent()}
                    {activeTab === 'system' && systemTabContent()}
                    {activeTab === 'about' && aboutTabContent()}
                </div>
            </div>
        </div>
    )
}

// Export for window-based app loading
window.__SETTINGS_UI__ = SettingsUI
