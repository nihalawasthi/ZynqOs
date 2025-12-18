import React, { useState, useMemo, useEffect, useRef } from 'react'
import { writeFile, readFile, readdir } from '../vfs/fs'
import { getStorageStatus, disconnectStorage, type StorageStatus } from '../auth/storage'
import { isTextFile } from '../vfs/fileTypes'
import { getInstalledPackages, executePackage } from '../packages/manager'
import type { InstalledPackage } from '../packages/types'
import CalculatorUI from '../apps/calculator-runtime/CalculatorUI'

type App = {
    id: string
    name: string
    icon: React.ReactNode
    description?: string
    openFn: () => void
}

type ContextMenu = {
    x: number
    y: number
    app: App
} | null

const PROFILE_CACHE_KEY = 'zynqos_profile_cache'
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

type ProfileCache = {
    profile: { name?: string; email?: string; avatar?: string; provider?: string }
    timestamp: number
}

function getCachedProfile(): ProfileCache['profile'] | null {
    try {
        const cached = localStorage.getItem(PROFILE_CACHE_KEY)
        if (!cached) return null
        const data: ProfileCache = JSON.parse(cached)
        if (Date.now() - data.timestamp > CACHE_TTL) {
            localStorage.removeItem(PROFILE_CACHE_KEY)
            return null
        }
        return data.profile
    } catch {
        return null
    }
}

function setCachedProfile(profile: ProfileCache['profile']) {
    try {
        const data: ProfileCache = { profile, timestamp: Date.now() }
        localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data))
    } catch { }
}

function clearCachedProfile() {
    try {
        localStorage.removeItem(PROFILE_CACHE_KEY)
    } catch { }
}

export default function StartMenu() {
    const [open, setOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [activeSection, setActiveSection] = useState<'pinned' | 'all'>('pinned')
    const [importStatus, setImportStatus] = useState<string>('')
    const [storageStatus, setStorageStatus] = useState<StorageStatus>({ connected: false })
    const [profile, setProfile] = useState<{ name?: string; email?: string; avatar?: string; provider?: string }>(getCachedProfile() || {})
    const [contextMenu, setContextMenu] = useState<ContextMenu>(null)
    const [installedPackages, setInstalledPackages] = useState<InstalledPackage[]>([])
    const searchInputRef = useRef<HTMLInputElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (open) {
            setTimeout(() => searchInputRef.current?.focus(), 100)
            // Check storage status
            getStorageStatus().then(status => {
                setStorageStatus(status)
                if (status.connected) {
                    // Check cache first
                    const cached = getCachedProfile()
                    if (cached) {
                        setProfile(cached)
                    }
                    // Fetch profile proactively when menu opens
                    fetch('/api?route=auth&action=profile', { credentials: 'include' })
                        .then(r => r.ok ? r.json() : Promise.reject(new Error('Profile fetch failed')))
                        .then(data => {
                            const p = data?.profile || {}
                            const provider = data?.provider
                            const profileData = {
                                name: p.name || p.login || p.id || (provider === 'github' ? 'GitHub User' : provider === 'google' ? 'Google User' : 'Connected User'),
                                email: p.email || (provider === 'github' ? 'GitHub Account' : provider === 'google' ? 'Google Account' : ''),
                                avatar: p.avatar_url || p.picture,
                                provider
                            }
                            setProfile(profileData)
                            setCachedProfile(profileData)
                        })
                        .catch(() => { })
                }
            })
        } else {
            setSearchQuery('')
            setImportStatus('')
            setContextMenu(null)
        }
    }, [open])

    // Close context menu on click outside
    useEffect(() => {
        const handleClick = () => setContextMenu(null)
        if (contextMenu) {
            document.addEventListener('click', handleClick)
            return () => document.removeEventListener('click', handleClick)
        }
    }, [contextMenu])

    // Load installed packages
    useEffect(() => {
        loadInstalledPackages()
    }, [])

    async function loadInstalledPackages() {
        try {
            const packages = await getInstalledPackages()
            setInstalledPackages(packages)
        } catch (err) {
            console.error('Failed to load installed packages:', err)
        }
    }

    // Listen for package installations to refresh the list
    useEffect(() => {
        const onPackageChange = () => loadInstalledPackages()
        window.addEventListener('zynqos:package-installed', onPackageChange as EventListener)
        window.addEventListener('zynqos:package-uninstalled', onPackageChange as EventListener)
        return () => {
            window.removeEventListener('zynqos:package-installed', onPackageChange as EventListener)
            window.removeEventListener('zynqos:package-uninstalled', onPackageChange as EventListener)
        }
    }, [])

    // Listen for storage connection events to update UI instantly
    useEffect(() => {
        const onConnected = () => {
            getStorageStatus().then(status => {
                setStorageStatus(status)
                fetch('/api?route=auth&action=profile', { credentials: 'include' })
                    .then(r => r.ok ? r.json() : Promise.reject(new Error('Profile fetch failed')))
                    .then(data => {
                        const p = data?.profile || {}
                        const provider = data?.provider
                        const profileData = {
                            name: p.name || p.login || p.id || (provider === 'github' ? 'GitHub User' : provider === 'google' ? 'Google User' : 'Connected User'),
                            email: p.email || (provider === 'github' ? 'GitHub Account' : provider === 'google' ? 'Google Account' : ''),
                            avatar: p.avatar_url || p.picture,
                            provider
                        }
                        setProfile(profileData)
                        setCachedProfile(profileData)
                    })
                    .catch(() => { })
            })
        }
        window.addEventListener('zynqos:storage-connected', onConnected as EventListener)
        return () => window.removeEventListener('zynqos:storage-connected', onConnected as EventListener)
    }, [])

    const handleAppOpen = (app: App) => {
        app.openFn()
        setOpen(false)
    }

    const handleDisconnectStorage = async () => {
        const { toast: showToast } = await import('../hooks/use-toast')
        const { dismiss } = showToast({
            title: 'Disconnect Storage?',
            description: 'Local files will remain.',
            variant: 'default',
            action: (
                <button
                    onClick={async () => {
                        dismiss()
                        const success = await disconnectStorage()
                        if (success) {
                            setStorageStatus({ connected: false })
                            setProfile({})
                            clearCachedProfile()
                            setImportStatus('✓ Storage disconnected')
                            setTimeout(() => setImportStatus(''), 2000)
                            showToast({ title: 'Disconnected', description: 'Cloud storage disconnected', variant: 'success' })
                        } else {
                            setImportStatus('✗ Failed to disconnect')
                            showToast({ title: 'Error', description: 'Failed to disconnect', variant: 'destructive' })
                        }
                    }}
                    className="px-3 py-1 text-sm bg-red-600 rounded hover:bg-red-700"
                >
                    Disconnect
                </button>
            ),
        })
    }

    const handleImportFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return

        setImportStatus(`Importing ${files.length} file(s)...`)

        try {
            // Create the imports directory marker if it doesn't exist
            await writeFile('/home/imports/', '')

            for (const file of Array.from(files)) {
                const fileName = file.name
                const isText = isTextFile(fileName) || file.type.startsWith('text/')

                const filePath = `/home/imports/${file.name}`

                if (isText) {
                    // Store text files as strings
                    const text = await file.text()
                    await writeFile(filePath, text)
                } else {
                    // Store binary files as Uint8Array
                    const arrayBuffer = await file.arrayBuffer()
                    const uint8Array = new Uint8Array(arrayBuffer)
                    await writeFile(filePath, uint8Array)
                }
            }
            setImportStatus(`✓ Imported ${files.length} file(s) to /home/imports/`)
            setTimeout(() => setImportStatus(''), 3000)
        } catch (error) {
            setImportStatus(`✗ Import failed: ${error}`)
        }
    }

    const handleExportFiles = async () => {
        try {
            const allFiles = await readdir('/home')
            if (allFiles.length === 0) {
                setImportStatus('No files to export')
                setTimeout(() => setImportStatus(''), 2000)
                return
            }

            // Show file picker or export dialog
            (window as any).ZynqOS_openWindow?.('Export Files',
                <ExportFilesDialog />,
                'export-files')
            setOpen(false)
        } catch (error) {
            setImportStatus(`Export error: ${error}`)
        }
    }

    const pinnedApps: App[] = [
        {
            id: 'file-browser',
            name: 'Files & Zynqpad',
            icon: <i className="fas fa-folder"></i>,
            description: 'Browse, edit, and manage files',
            openFn: () => (window as any).ZynqOS_openWindow?.('Files & Zynqpad', window.__FILE_BROWSER_UI__ ?? <div>Loading...</div>, 'file-browser'),
        },
        {
            id: 'terminal',
            name: 'Terminal',
            icon: <i className="fa fa-terminal"></i>,
            description: 'WASI terminal emulator',
            openFn: () => (window as any).ZynqOS_openWindow?.('Terminal', window.__TERMINAL_UI__ ?? <div>Loading Terminal...</div>, 'terminal'),
        },
        {
            id: 'python',
            name: 'Python',
            icon: <i className="fab fa-python"></i>,
            description: 'Python REPL powered by Pyodide',
            openFn: () => (window as any).ZynqOS_openWindow?.('Python', window.__PYTHON_UI__ ?? <div>Loading Python...</div>, 'python'),
        },
        {
            id: 'wednesday',
            name: 'Wednesday',
            icon: <i className="scale-80 fa-solid fa-wand-magic-sparkles"></i>,
            description: 'AI Assistant with terminal integration',
            openFn: () => (window as any).ZynqOS_openWindow?.('Wednesday AI', window.__WEDNESDAY_UI__ ?? <div>Loading Wednesday...</div>, 'wednesday'),
        },
        {
            id: 'store',
            name: 'App Store',
            icon: <i className="fa-solid fa-store"></i>,
            description: 'Browse and install apps',
            openFn: () => (window as any).ZynqOS_openWindow?.('App Store', window.__STORE_UI__ ?? <div>Loading Store...</div>, 'store'),
        },
        {
            id: 'phantomsurf',
            name: 'PhantomSurf',
            icon: <i className="fas fa-globe"></i>,
            description: 'Secure browser with VPN/Tor and HTML viewer',
            openFn: () => (window as any).ZynqOS_openWindow?.('PhantomSurf', window.__PHANTOMSURF_UI__ ?? <div>Loading PhantomSurf...</div>, 'phantomsurf'),
        },
    ]

    const systemApps: App[] = [
        {
            id: 'settings',
            name: 'Settings',
            icon: <i className="fas fa-cog"></i>,
            description: 'System preferences',
            openFn: () => {
                (window as any).ZynqOS_openWindow?.('Settings',
                    window.__SETTINGS_UI__ ?? <div>Loading Settings...</div>,
                    'settings',
                    undefined,
                    undefined,
                    undefined,
                    true)
            },
        },
    ]

    // Convert installed packages to App format (support wasm/wasi and selected web-apps)
    const renderIcon = (icon?: string) => {
        if (!icon) return <span className="text-2xl">📦</span>
        const isUrl = icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('//')
        return isUrl ? (
            <img
                src={icon}
                alt="app icon"
                className="h-6 w-6 object-contain"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
        ) : (
            <span className="text-2xl">{icon}</span>
        )
    }

    const installedApps: App[] = installedPackages
        .filter(pkg => pkg.type === 'wasm' || pkg.type === 'wasi' || pkg.type === 'wasm-bindgen' || pkg.type === 'web-app')
        .map(pkg => ({
            id: pkg.id,
            name: pkg.name,
            icon: renderIcon(pkg.icon),
            description: pkg.description,
            openFn: async () => {
                try {
                    if (pkg.type === 'wasm-bindgen') {
                        const instance = await executePackage(pkg.id)
                        if (!instance) throw new Error('Execution failed')

                        const exports = (instance as any).exports || {}
                        
                        // Special handling for calculator
                        if (pkg.id === 'calculator') {
                            const content = <CalculatorUI wasmModule={exports} />
                            ;(window as any).ZynqOS_openWindow?.(pkg.name, content, pkg.id)
                            return
                        }

                        // Generic wasm-bindgen module viewer for other packages
                        const exportNames = Object.keys(exports).filter(k => k !== 'default')
                        const content = (
                            <div className="p-3 space-y-2 text-sm text-gray-200">
                                <div className="font-semibold">{pkg.name} (wasm-bindgen)</div>
                                <div className="text-gray-400">Module loaded. Exposed exports:</div>
                                <div className="flex flex-wrap gap-1 text-xs">
                                    {exportNames.length === 0 ? (
                                        <span className="text-gray-500">(none)</span>
                                    ) : (
                                        exportNames.map(name => (
                                            <span key={name} className="px-2 py-1 bg-gray-800 rounded border border-gray-700">{name}</span>
                                        ))
                                    )}
                                </div>
                                <div className="text-gray-500 text-xs">Use exports in console or custom UI.</div>
                            </div>
                        )

                        ;(window as any).ZynqOS_openWindow?.(pkg.name, content, pkg.id)
                        return
                    }

                    if (pkg.type === 'wasm' || pkg.type === 'wasi') {
                        const instance = await executePackage(pkg.id)
                        if (!instance) throw new Error('Execution failed')
                    } else {
                        // web-app: dynamically load UI module if available
                        try {
                            await import(/* @vite-ignore */ `../apps/${pkg.id}/ui`)
                        } catch {}
                        const uiVar = (pkg.id === 'calculator') ? (window as any).__CALC_UI__ : null
                        const ui = uiVar ?? <div>Loading {pkg.name}...</div>
                        ;(window as any).ZynqOS_openWindow?.(pkg.name, ui, pkg.id)
                    }
                } catch (err) {
                    console.error(`Failed to open ${pkg.name}:`, err)
                    // Error already logged, no need for alert
                }
            }
        }))

    const allApps = [...pinnedApps, ...systemApps, ...installedApps]

    const filteredApps = useMemo(() => {
        if (!searchQuery.trim()) return []
        const query = searchQuery.toLowerCase()
        return allApps.filter(app =>
            app.name.toLowerCase().includes(query) ||
            app.description?.toLowerCase().includes(query)
        )
    }, [searchQuery, installedApps])

    return (
        <>
            {/* Start button */}
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center justify-center w-10 h-10 ml-2 rounded-[10px] transition-all duration-200 hover:bg-gray-200/30 hover:scale-105"
                title="Start Menu"
            >
                <img
                    src="/assets/logo.png"
                    className={`aspect-[1/1] h-10 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
                    alt="Start"
                />
            </button>

            {/* Start Menu Panel */}
            {open && (
                <>
                    {/* Backdrop - exclude taskbar area */}
                    <div
                        className="fixed inset-0 bottom-16 z-40 bg-black/20 animate-fadeIn"
                        onClick={() => setOpen(false)}
                    />

                    <div className="flex fixed bottom-20 left-1/2 -translate-x-1/2 min-w-[calc(60%-48px)] max-w-[980px] gap-1 z-50">
                        {/* Hidden file input for imports */}
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(e) => handleImportFiles(e.target.files)}
                        />

                        {/* Main Menu */}
                        <div className="w-[420px] bg-black backdrop-blur-xl border border-[#333] rounded-xl shadow-2xl overflow-hidden">
                            {/* Search bar */}
                            <div className="px-5 py-4">
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666]">
                                        <i className="fas fa-search text-sm"></i>
                                    </span>
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search apps, settings..."
                                        onKeyDown={(e) => {
                                            e.stopPropagation()
                                            if (e.key === 'Enter' && filteredApps.length > 0) {
                                                handleAppOpen(filteredApps[0])
                                            }
                                            if (e.key === 'Escape') {
                                                setOpen(false)
                                            }
                                        }}
                                        className="w-full pl-9 pr-4 py-2.5 bg-[#0d0d0d] border border-[#333] rounded-lg text-sm text-[#e0e0e0] placeholder-[#666] focus:outline-none focus:border-[#4a9eff] transition-all"
                                    />
                                    {searchQuery && (
                                        <button
                                            onClick={() => setSearchQuery('')}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#666] hover:text-[#999] transition"
                                        >
                                            <i className="fas fa-times text-xs"></i>
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Search Results */}
                            {searchQuery && (
                                <div className="px-5 pb-4 max-h-64 overflow-y-auto">
                                    {filteredApps.length > 0 ? (
                                        <div className="space-y-1">
                                            {filteredApps.map((app) => (
                                                <button
                                                    key={app.id}
                                                    onClick={() => handleAppOpen(app)}
                                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#2a2a2a] transition group"
                                                >
                                                    <span className="text-2xl">{app.icon}</span>
                                                    <div className="text-left">
                                                        <div className="text-sm text-[#e0e0e0] font-medium">{app.name}</div>
                                                        {app.description && (
                                                            <div className="text-xs text-[#808080]">{app.description}</div>
                                                        )}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 text-[#666]">
                                            <i className="fas fa-search text-2xl mb-2 opacity-50"></i>
                                            <p className="text-sm">No results for "{searchQuery}"</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Content when not searching */}
                            {!searchQuery && (
                                <>
                                    {/* Section tabs */}
                                    <div className="px-5 flex gap-1 mb-2">
                                        <button
                                            onClick={() => setActiveSection('pinned')}
                                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${activeSection === 'pinned'
                                                ? 'bg-[#2a2a2a] text-[#4a9eff]'
                                                : 'text-[#808080] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]'
                                                }`}
                                        >
                                            Pinned
                                        </button>
                                        <button
                                            onClick={() => setActiveSection('all')}
                                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${activeSection === 'all'
                                                ? 'bg-[#2a2a2a] text-[#4a9eff]'
                                                : 'text-[#808080] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]'
                                                }`}
                                        >
                                            All Apps
                                        </button>
                                    </div>

                                    {/* Pinned Apps Grid */}
                                    {activeSection === 'pinned' && (
                                        <div className="px-5 min-h-[30vh] pb-4">
                                            <div className="grid grid-cols-5 gap-2">
                                                {pinnedApps.map((app) => (
                                                    <button
                                                        key={app.id}
                                                        onClick={() => handleAppOpen(app)}
                                                        onContextMenu={(e) => {
                                                            e.preventDefault()
                                                            setContextMenu({ x: e.clientX, y: e.clientY, app })
                                                        }}
                                                        className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-[#2a2a2a] transition-all duration-200 group hover:scale-105"
                                                        title={app.description}
                                                    >
                                                        <div className="text-2xl group-hover:scale-110 transition-transform">{app.icon}</div>
                                                        <div className="text-xs text-center text-[#808080] group-hover:text-[#e0e0e0] transition line-clamp-1">{app.name}</div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* All Apps List */}
                                    {activeSection === 'all' && (
                                        <div className="px-5 pb-4 max-h-56 overflow-y-auto scrollbar">
                                            <div className="space-y-1">
                                                {allApps.map((app) => (
                                                    <button
                                                        key={app.id}
                                                        onClick={() => handleAppOpen(app)}
                                                        onContextMenu={(e) => {
                                                            e.preventDefault()
                                                            setContextMenu({ x: e.clientX, y: e.clientY, app })
                                                        }}
                                                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#2a2a2a] transition group"
                                                    >
                                                        <span className="text-l">{app.icon}</span>
                                                        <div className="text-left flex-1">
                                                            <div className="text-sm text-[#e0e0e0] group-hover:text-white">{app.name}</div>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                </>
                            )}
                        </div>

                        {/* User Profile Panel */}
                        <div className="w-56 bg-black backdrop-blur-xl border border-[#333] rounded-xl shadow-2xl overflow-hidden flex flex-col">
                            {/* Profile Header */}
                            <div className="p-5 pb-0 bg-black relative border-b border-[#333]">
                                {/* About & setting */}
                                <div className="absolute top-2 left-3 flex flex-col gap-1">
                                    <button
                                        onClick={() => {
                                            systemApps[0].openFn()
                                            setOpen(false)
                                        }}
                                        className="transition text-gray-400 hover:text-gray-200"
                                        title='Settings'
                                        id='settings'
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" className="svg-icon"><g strokeWidth="1.5" strokeLinecap="round" stroke="#99a1af"><circle r="2.5" cy="10" cx="10"></circle><path fillRule="evenodd" d="m8.39079 2.80235c.53842-1.51424 2.67991-1.51424 3.21831-.00001.3392.95358 1.4284 1.40477 2.3425.97027 1.4514-.68995 2.9657.82427 2.2758 2.27575-.4345.91407.0166 2.00334.9702 2.34248 1.5143.53842 1.5143 2.67996 0 3.21836-.9536.3391-1.4047 1.4284-.9702 2.3425.6899 1.4514-.8244 2.9656-2.2758 2.2757-.9141-.4345-2.0033.0167-2.3425.9703-.5384 1.5142-2.67989 1.5142-3.21831 0-.33914-.9536-1.4284-1.4048-2.34247-.9703-1.45148.6899-2.96571-.8243-2.27575-2.2757.43449-.9141-.01669-2.0034-.97028-2.3425-1.51422-.5384-1.51422-2.67994.00001-3.21836.95358-.33914 1.40476-1.42841.97027-2.34248-.68996-1.45148.82427-2.9657 2.27575-2.27575.91407.4345 2.00333-.01669 2.34247-.97026z" clipRule="evenodd"></path></g></svg>
                                    </button>
                                    <button
                                        onClick={async () => {
                                            const { toast: showToast } = await import('../hooks/use-toast')
                                            const { dismiss } = showToast({
                                                title: 'Refresh System?',
                                                description: 'This will reload the page.',
                                                variant: 'default',
                                                action: (
                                                    <button
                                                        onClick={() => {
                                                            dismiss()
                                                            window.location.reload()
                                                        }}
                                                        className="px-3 py-1 text-sm bg-blue-600 rounded hover:bg-blue-700"
                                                    >
                                                        Refresh
                                                    </button>
                                                ),
                                            })
                                        }}
                                        className="transition text-gray-400 hover:text-gray-200"
                                        title="Restart"
                                    >
                                        <i className="fas fa-redo text-xs"></i>
                                    </button>
                                </div>
                                {/* Profile info - centered */}
                                <div className="flex flex-col pb-2 items-center bg-black justify-center gap-3">
                                    <div className="w-14 h-14 rounded-full border border-blue-400/30 flex items-center justify-center text-lg font-bold text-blue-200 shadow-md shadow-blue-400/10 overflow-hidden">
                                        {profile.avatar ? (
                                            <img src={profile.avatar} alt={profile.name || 'avatar'} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                        ) : (
                                            <span>{(profile.name || 'Z').charAt(0).toUpperCase()}</span>
                                        )}
                                    </div>
                                    <div className="text-center">
                                        <div className="font-semibold text-slate-100" id="zynqos-profile-name">{profile.name || (storageStatus.connected ? 'Connected User' : 'User')}</div>
                                        <div className="text-xs text-slate-500 pt-1" id="zynqos-profile-email">{profile.email || (storageStatus.connected ? (storageStatus.provider === 'github' ? 'GitHub Account' : 'Cloud Account') : 'Local Account')}</div>
                                    </div>
                                </div>

                                {/* Storage Status */}
                                {storageStatus.connected && (
                                    <div className="px-4 py-2 flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-xs">
                                            <i className={`fab fa-${storageStatus.provider === 'google' ? 'google' : 'github'} text-[#4ade80]`}></i>
                                            <span className="text-[#4ade80] font-medium">
                                                {storageStatus.provider === 'google' ? 'Google Drive' : 'GitHub'} connected
                                            </span>
                                        </div>
                                        <button
                                            onClick={handleDisconnectStorage}
                                            className="text-[#808080] hover:text-[#f87171] transition text-xs"
                                            title="Disconnect"
                                        >
                                            <i className="fas fa-sign-out-alt"></i>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Import Status */}
                            {importStatus && (
                                <div className={`px-4 py-2 text-xs ${importStatus.startsWith('✓') ? 'bg-green-900/30 text-green-400' : importStatus.startsWith('✗') ? 'bg-red-900/30 text-red-400' : 'bg-[#2a2a2a] text-[#808080]'}`}>
                                    {importStatus}
                                </div>
                            )}

                            {/* Quick Actions */}
                            <div className="flex-1 px-2 py-1 space-y-1">
                                <div className="w-full flex items-center">
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="w-[50%] flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[#2a2a2a] transition text-sm text-[#e0e0e0] hover:text-white group"
                                    >
                                        <span className="w-6 h-6 rounded-lg flex items-center justify-center transition">
                                            <i className="fa-solid fa-file-import"></i>
                                        </span>
                                        <span>Import</span>
                                    </button>

                                    <button
                                        onClick={handleExportFiles}
                                        className="w-[50%] flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[#2a2a2a] transition text-sm text-[#e0e0e0] hover:text-white group"
                                    >
                                        <span className="w-6 h-6 rounded-lg flex items-center justify-center transition">
                                            <i className="fa-solid fa-file-export"></i>
                                        </span>
                                        <span>Export</span>
                                    </button>
                                </div>

                                {/* New Window Button */}
                                <button
                                    onClick={() => {
                                        window.open(window.location.href, '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no')
                                        setOpen(false)
                                    }}
                                    className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[#2a2a2a] transition text-sm text-[#e0e0e0] hover:text-white group"
                                    title="Open new window for multi-window support"
                                >
                                    <span className="w-6 h-6 rounded-lg bg-[#2a3a4a] flex items-center justify-center text-[#4a9eff] group-hover:bg-[#2a4a5a] transition">
                                        <i className="fas fa-window-restore text-xs"></i>
                                    </span>
                                    <span>New Window</span>
                                </button>
                            </div>

                            {/* Signin/Signup */}
                            <div className="p-2 border-t border-[#333] h-[56px]">
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => {
                                            (window as any).ZynqOS_openConsent?.()
                                            setOpen(false)
                                        }}
                                        className="w-full flex items-center gap-3 px-3 py-1 rounded-lg hover:bg-[#2a2a2a] transition text-sm text-[#e0e0e0] hover:text-white group"
                                    >
                                        <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[#4a9eff] transition">
                                            {!storageStatus.connected ? (
                                                <i className="fa fa-sign-in" aria-hidden="true"></i>
                                            ) : storageStatus.provider === 'google' ? (
                                                <i className="fab fa-github" aria-hidden="true"></i>
                                            ) : (
                                                <i className="fab fa-google" aria-hidden="true"></i>
                                            )}
                                        </span>
                                        <span>
                                            {!storageStatus.connected
                                                ? 'Signin / Signup'
                                                : storageStatus.provider === 'google'
                                                    ? 'Connect GitHub'
                                                    : 'Connect Google'}
                                        </span>
                                    </button>
                                    {/* 
                                    */}
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Right-click Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-[9999] bg-[#2a2a2a] border border-[#444] rounded-lg shadow-2xl py-1 min-w-[180px] animate-fadeIn"
                    style={{
                        left: `${contextMenu.x}px`,
                        top: `${contextMenu.y}px`,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => {
                            contextMenu.app.openFn()
                            setContextMenu(null)
                            setOpen(false)
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#e0e0e0] hover:bg-[#333] transition text-left"
                    >
                        <i className="fas fa-window-maximize text-xs w-4"></i>
                        <span>Open</span>
                    </button>
                    <button
                        onClick={() => {
                            // Open as a new child window in the same parent window with a unique ID
                            const appUIMap: Record<string, any> = {
                                'file-browser': window.__FILE_BROWSER_UI__ ?? <div>Loading...</div>,
                                'text-editor': window.__FILE_BROWSER_UI__ ?? <div>Loading...</div>,
                                'terminal': window.__TERMINAL_UI__ ?? <div>Loading Terminal...</div>,
                                'python': window.__PYTHON_UI__ ?? <div>Loading Python...</div>,
                                'wednesday': window.__WEDNESDAY_UI__ ?? <div>Loading Wednesday...</div>,
                                'store': window.__STORE_UI__ ?? <div>Loading Store...</div>,
                                'mapp-importer': window.__MAPP_IMPORTER_UI__ ?? <div>Loading...</div>,
                                'phantomsurf': window.__PHANTOMSURF_UI__ ?? <div>Loading PhantomSurf...</div>,
                            }

                            const appTitleMap: Record<string, string> = {
                                'file-browser': 'Files & Zynqpad',
                                'text-editor': 'Files & Zynqpad',
                                'terminal': 'Terminal',
                                'python': 'Python',
                                'wednesday': 'Wednesday AI',
                                'store': 'App Store',
                                'mapp-importer': 'Import Package',
                                'phantomsurf': 'PhantomSurf',
                            }

                            const ui = appUIMap[contextMenu.app.id]
                            const title = appTitleMap[contextMenu.app.id] || contextMenu.app.name

                            if (ui) {
                                ; (window as any).ZynqOS_openWindow?.(
                                    title,
                                    ui,
                                    `${contextMenu.app.id}-${Date.now()}`
                                )
                            }
                            setContextMenu(null)
                            setOpen(false)
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#e0e0e0] hover:bg-[#333] transition text-left"
                    >
                        <i className="fas fa-external-link-alt text-xs w-4"></i>
                        <span>Open in New Window</span>
                    </button>
                    <div className="border-t border-[#444] my-1"></div>
                    <div className="px-4 py-1 text-xs text-[#666]">
                        {contextMenu.app.description || contextMenu.app.name}
                    </div>
                </div>
            )}

            {/* CSS for animations */}
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from { 
                        opacity: 0; 
                        transform: translate(-50%, 20px);
                    }
                    to { 
                        opacity: 1; 
                        transform: translate(-50%, 0);
                    }
                }
                .animate-fadeIn {
                    animation: fadeIn 0.15s ease-out;
                }
                .animate-slideUp {
                    animation: slideUp 0.2s ease-out;
                }
                .line-clamp-1 {
                    display: -webkit-box;
                    -webkit-line-clamp: 1;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                }
            `}</style>
        </>
    )
}

// Export Files Dialog Component
function ExportFilesDialog() {
    const [files, setFiles] = useState<string[]>([])
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(true)
    const [exporting, setExporting] = useState(false)

    useEffect(() => {
        loadFiles()
    }, [])

    async function loadFiles() {
        setLoading(true)
        try {
            const allFiles = await readdir('/home')
            setFiles(allFiles.filter(f => !f.endsWith('/')))
        } catch (error) {
            console.error('Failed to load files:', error)
        }
        setLoading(false)
    }

    function toggleFile(file: string) {
        const newSelected = new Set(selectedFiles)
        if (newSelected.has(file)) {
            newSelected.delete(file)
        } else {
            newSelected.add(file)
        }
        setSelectedFiles(newSelected)
    }

    function selectAll() {
        if (selectedFiles.size === files.length) {
            setSelectedFiles(new Set())
        } else {
            setSelectedFiles(new Set(files))
        }
    }

    async function exportSelected() {
        if (selectedFiles.size === 0) return

        setExporting(true)

        for (const filePath of selectedFiles) {
            try {
                const content = await readFile(filePath)
                if (content !== undefined) {
                    let blob: Blob
                    if (content instanceof Uint8Array) {
                        // Create a new ArrayBuffer copy to avoid SharedArrayBuffer issues
                        const buffer = new ArrayBuffer(content.length)
                        new Uint8Array(buffer).set(content)
                        blob = new Blob([buffer])
                    } else {
                        blob = new Blob([content], { type: 'text/plain' })
                    }

                    const fileName = filePath.split('/').pop() || 'file'
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = fileName
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                    URL.revokeObjectURL(url)
                }
            } catch (error) {
                console.error(`Failed to export ${filePath}:`, error)
            }
        }

        setExporting(false)
    }

    return (
        <div className="p-4 bg-[#1a1a1a] text-[#e0e0e0] min-h-[300px]">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Export Files</h2>
                <button
                    onClick={selectAll}
                    className="text-xs px-3 py-1 rounded bg-[#2a2a2a] hover:bg-[#333] text-[#808080] hover:text-[#e0e0e0] transition"
                >
                    {selectedFiles.size === files.length ? 'Deselect All' : 'Select All'}
                </button>
            </div>

            {loading ? (
                <div className="text-center py-8 text-[#666]">Loading files...</div>
            ) : files.length === 0 ? (
                <div className="text-center py-8 text-[#666]">
                    <i className="fas fa-folder-open text-3xl mb-2 opacity-50"></i>
                    <p>No files found in /home</p>
                </div>
            ) : (
                <>
                    <div className="max-h-[200px] overflow-y-auto space-y-1 mb-4">
                        {files.map((file) => (
                            <button
                                key={file}
                                onClick={() => toggleFile(file)}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition text-sm text-left ${selectedFiles.has(file)
                                    ? 'bg-[#2a4a3a] text-[#4ade80]'
                                    : 'hover:bg-[#2a2a2a] text-[#e0e0e0]'
                                    }`}
                            >
                                <i className={`fas ${selectedFiles.has(file) ? 'fa-check-square' : 'fa-square'} text-xs`}></i>
                                <span className="truncate">{file}</span>
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={exportSelected}
                        disabled={selectedFiles.size === 0 || exporting}
                        className={`w-full py-2 rounded-lg font-medium transition ${selectedFiles.size === 0 || exporting
                            ? 'bg-[#2a2a2a] text-[#666] cursor-not-allowed'
                            : 'bg-[#4a9eff] hover:bg-[#3a8eef] text-white'
                            }`}
                    >
                        {exporting ? 'Exporting...' : `Export ${selectedFiles.size} file(s)`}
                    </button>
                </>
            )}
        </div>
    )
}
