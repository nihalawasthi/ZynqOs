import React, { useState, useMemo, useEffect, useRef } from 'react'
import { writeFile, readFile, readdir } from '../vfs/fs'
import { getStorageStatus, disconnectStorage, type StorageStatus } from '../auth/storage'

type App = {
    id: string
    name: string
    icon: React.ReactNode
    description?: string
    openFn: () => void
}

export default function StartMenu() {
    const [open, setOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [activeSection, setActiveSection] = useState<'pinned' | 'all'>('pinned')
    const [importStatus, setImportStatus] = useState<string>('')
    const [storageStatus, setStorageStatus] = useState<StorageStatus>({ connected: false })
    const searchInputRef = useRef<HTMLInputElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (open) {
            setTimeout(() => searchInputRef.current?.focus(), 100)
            // Check storage status
            getStorageStatus().then(setStorageStatus)
        } else {
            setSearchQuery('')
            setImportStatus('')
        }
    }, [open])

    // Listen for storage connection events to update UI instantly
    useEffect(() => {
        const onConnected = () => {
            getStorageStatus().then(setStorageStatus)
                        // Fetch user profile and update UI labels
                        fetch('/api?route=auth&action=profile', { credentials: 'include' })
                            .then(r => r.ok ? r.json() : Promise.reject(new Error('Profile fetch failed')))
                            .then(data => {
                                const nameEl = document.getElementById('zynqos-profile-name')
                                const emailEl = document.getElementById('zynqos-profile-email')
                                const name = data?.profile?.name || 'Connected User'
                                const email = data?.profile?.email || (data?.provider === 'github' ? 'GitHub Account' : 'Google Account')
                                if (nameEl) nameEl.textContent = name
                                if (emailEl) emailEl.textContent = email
                            })
                            .catch(() => {})
        }
        window.addEventListener('zynqos:storage-connected', onConnected as EventListener)
        return () => window.removeEventListener('zynqos:storage-connected', onConnected as EventListener)
    }, [])

    const handleAppOpen = (app: App) => {
        app.openFn()
        setOpen(false)
    }

    const handleDisconnectStorage = async () => {
        if (!confirm('Disconnect cloud storage? Local files will remain.')) return
        const success = await disconnectStorage()
        if (success) {
            setStorageStatus({ connected: false })
            setImportStatus('✓ Storage disconnected')
            setTimeout(() => setImportStatus(''), 2000)
        } else {
            setImportStatus('✗ Failed to disconnect')
        }
    }

    const handleImportFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return

        setImportStatus(`Importing ${files.length} file(s)...`)

        // Text file extensions that should be stored as strings
        const textExtensions = ['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.html', '.css', '.xml', '.csv', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.bash', '.zsh', '.py', '.rs', '.c', '.cpp', '.h', '.hpp', '.java', '.go', '.rb', '.php', '.sql', '.log', '.env']

        try {
            // Create the imports directory marker if it doesn't exist
            await writeFile('/home/imports/', '')

            for (const file of Array.from(files)) {
                const fileName = file.name.toLowerCase()
                const isTextFile = textExtensions.some(ext => fileName.endsWith(ext)) || file.type.startsWith('text/')

                const filePath = `/home/imports/${file.name}`

                if (isTextFile) {
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
            name: 'Files',
            icon: <i className="fas fa-folder"></i>,
            description: 'Browse and manage files',
            openFn: () => (window as any).ZynqOS_openWindow?.('Files', window.__FILE_BROWSER_UI__ ?? <div>Loading...</div>, 'file-browser'),
        },
        {
            id: 'text-editor',
            name: 'Zynqpad',
            icon: <i className="fa fa-file-text"></i>,
            description: 'Text and code editor',
            openFn: () => (window as any).ZynqOS_openWindow?.('Zynqpad', window.__TEXT_EDITOR_UI__ ?? <div>Loading...</div>, 'text-editor'),
        },
        {
            id: 'terminal',
            name: 'Terminal',
            icon: <i className="fa fa-terminal"></i>,
            description: 'WASI terminal emulator',
            openFn: () => (window as any).ZynqOS_openWindow?.('Terminal', window.__TERMINAL_UI__ ?? <div>Loading Terminal...</div>, 'terminal'),
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
            id: 'calculator',
            name: 'Calculator',
            icon: <i className="fas fa-calculator"></i>,
            description: 'Perform calculations',
            openFn: () => (window as any).ZynqOS_openWindow?.('Calculator', window.__CALC_UI__ ?? <div>Loading Calculator...</div>, 'calculator'),
        },
        {
            id: 'mapp-importer',
            name: 'Package Import',
            icon: <i className="fas fa-box-open"></i>,
            description: 'Import .mapp packages',
            openFn: () => {
                const Comp = window.__MAPP_IMPORTER_UI__
                if (Comp) {
                    (window as any).ZynqOS_openWindow?.('Import Package', Comp, 'mapp-importer')
                }
            },
        },
    ]

    const systemApps: App[] = [
        {
            id: 'settings',
            name: 'Settings',
            icon: <i className="fas fa-cog"></i>,
            description: 'System preferences',
            openFn: () => {
                // Settings placeholder
                (window as any).ZynqOS_openWindow?.('Settings',
                    <div className="p-6 text-gray-300">
                        <h2 className="text-xl font-bold mb-4">System Settings</h2>
                        <p className="text-gray-500">Settings panel coming soon...</p>
                    </div>,
                    'settings')
            },
        },
        {
            id: 'about',
            name: 'About',
            icon: <i className="fas fa-info-circle"></i>,
            description: 'System information',
            openFn: () => {
                (window as any).ZynqOS_openWindow?.('About ZynqOS',
                    <div className="p-6 text-gray-300 flex flex-col items-center">
                        <img src="/assets/logo.png" className="w-20 h-20 mb-4" alt="ZynqOS" />
                        <h2 className="text-xl font-bold mb-2">ZynqOS</h2>
                        <p className="text-gray-500 text-sm mb-4">Browser Micro-Runtime v0.5</p>
                        <div className="text-xs text-gray-600 text-center">
                            <p>A web-based operating system experience</p>
                            <p className="mt-2">Powered by WASI & WebAssembly</p>
                        </div>
                    </div>,
                    'about')
            },
        },
    ]

    const allApps = [...pinnedApps, ...systemApps]

    const filteredApps = useMemo(() => {
        if (!searchQuery.trim()) return []
        const query = searchQuery.toLowerCase()
        return allApps.filter(app =>
            app.name.toLowerCase().includes(query) ||
            app.description?.toLowerCase().includes(query)
        )
    }, [searchQuery])

    const currentTime = new Date()
    const greeting = currentTime.getHours() < 12 ? 'Good morning' :
        currentTime.getHours() < 18 ? 'Good afternoon' : 'Good evening'

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

                    <div className="flex fixed bottom-20 left-4 gap-3 z-50 animate-slideUp">
                        {/* Hidden file input for imports */}
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(e) => handleImportFiles(e.target.files)}
                        />

                        {/* Main Menu */}
                        <div className="w-[420px] bg-[#1a1a1a] backdrop-blur-xl border border-[#333] rounded-xl shadow-2xl overflow-hidden">
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
                                        <div className="px-5 pb-4">
                                            <div className="grid grid-cols-4 gap-2">
                                                {pinnedApps.map((app) => (
                                                    <button
                                                        key={app.id}
                                                        onClick={() => handleAppOpen(app)}
                                                        className="flex flex-col items-center gap-1.5 p-3 rounded-lg hover:bg-[#2a2a2a] transition-all duration-200 group hover:scale-105"
                                                        title={app.description}
                                                    >
                                                        <div className="text-3xl group-hover:scale-110 transition-transform">{app.icon}</div>
                                                        <div className="text-xs text-center text-[#808080] group-hover:text-[#e0e0e0] transition line-clamp-1">{app.name}</div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* All Apps List */}
                                    {activeSection === 'all' && (
                                        <div className="px-5 pb-4 max-h-56 overflow-y-auto">
                                            <div className="space-y-1">
                                                {allApps.map((app) => (
                                                    <button
                                                        key={app.id}
                                                        onClick={() => handleAppOpen(app)}
                                                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#2a2a2a] transition group"
                                                    >
                                                        <span className="text-xl">{app.icon}</span>
                                                        <div className="text-left flex-1">
                                                            <div className="text-sm text-[#e0e0e0] group-hover:text-white">{app.name}</div>
                                                        </div>
                                                        <i className="fas fa-chevron-right text-xs text-[#666] group-hover:text-[#999] transition"></i>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Quick Launch */}
                                    {activeSection === 'pinned' && (
                                        <div className="px-5 pb-4 border-t border-[#333] pt-3">
                                            <div className="text-xs font-semibold text-[#666] uppercase tracking-wider mb-2">Quick Launch</div>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    onClick={() => {
                                                        const Comp = window.__MAPP_IMPORTER_UI__
                                                        if (Comp) {
                                                            (window as any).ZynqOS_openWindow?.('Import Package', Comp, 'mapp-importer')
                                                        }
                                                        setOpen(false)
                                                    }}
                                                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#2a2a2a] hover:bg-[#333] transition text-sm text-[#e0e0e0] hover:text-white"
                                                >
                                                    <i className="fas fa-box-open"></i>
                                                    <span>Import .mapp</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}


                                </>
                            )}
                        </div>

                        {/* User Profile Panel */}
                        <div className="w-56 bg-[#1a1a1a] backdrop-blur-xl border border-[#333] rounded-xl shadow-2xl overflow-hidden flex flex-col">
                            {/* Profile Header */}
                            <div className="p-5 bg-gradient-to-r from-slate-800/50 to-slate-900/50 border-b border-slate-700/30 relative">
                                {/* Logout button - top right */}
                                <button
                                    onClick={() => {
                                        if (confirm('Close all windows and clear session?')) {
                                            localStorage.clear()
                                            window.location.reload()
                                        }
                                    }}
                                    className="absolute bottom-1 right-2 p-2 rounded-lg hover:bg-[#3a2a2a] transition text-[#f87171] hover:text-[#fca5a5]"
                                    title="Sign Out"
                                >
                                    <i className="fas fa-sign-out-alt text-sm"></i>
                                </button>
                                {/*  */}

                                <button
                                    onClick={() => {
                                        systemApps[1].openFn()
                                        setOpen(false)
                                    }}
                                    className="absolute top-2 left-3 transition text-gray-400 hover:text-gray-200"
                                    title='About'
                                >
                                        <i className="fas fa-info-circle text-sm"></i>
                                </button>
                                {/* Profile info - centered */}
                                <div className="flex flex-col items-center justify-center gap-3">
                                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500/40 to-blue-600/30 border border-blue-500/50 flex items-center justify-center text-lg font-bold text-blue-300 shadow-lg shadow-blue-500/20 overflow-hidden">
                                        {storageStatus.connected && storageStatus.provider === 'github' && (
                                            <img src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png" alt="avatar" className="w-full h-full object-cover" />
                                        )}
                                        {!storageStatus.connected && (
                                            <>Z</>
                                        )}
                                    </div>
                                    <div className="text-center">
                                        <div className="font-semibold text-slate-100" id="zynqos-profile-name">{storageStatus.connected ? 'Connected User' : 'User'}</div>
                                        <div className="text-xs text-slate-500" id="zynqos-profile-email">{storageStatus.connected ? 'Cloud Account' : 'Local Account'}</div>
                                    </div>
                                </div>
                            </div>

                            {/* Storage Status */}
                            {storageStatus.connected && (
                                <div className="px-4 py-2 bg-[#2a3a2a]/50 border-b border-[#333] flex items-center justify-between">
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
                                        <i className="fas fa-times"></i>
                                    </button>
                                </div>
                            )}

                            {/* Import Status */}
                            {importStatus && (
                                <div className={`px-4 py-2 text-xs ${importStatus.startsWith('✓') ? 'bg-green-900/30 text-green-400' : importStatus.startsWith('✗') ? 'bg-red-900/30 text-red-400' : 'bg-[#2a2a2a] text-[#808080]'}`}>
                                    {importStatus}
                                </div>
                            )}

                            {/* Quick Actions */}
                            <div className="flex-1 p-3 space-y-1">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#2a2a2a] transition text-sm text-[#e0e0e0] hover:text-white group"
                                >
                                    <span className="w-8 h-8 rounded-lg bg-[#2a4a3a] flex items-center justify-center text-[#4ade80] group-hover:bg-[#2a5a3a] transition">
                                        <i className="fas fa-upload text-xs"></i>
                                    </span>
                                    <span>Import Files</span>
                                </button>

                                <button
                                    onClick={handleExportFiles}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#2a2a2a] transition text-sm text-[#e0e0e0] hover:text-white group"
                                >
                                    <span className="w-8 h-8 rounded-lg bg-[#4a3a2a] flex items-center justify-center text-[#fbbf24] group-hover:bg-[#5a3a2a] transition">
                                        <i className="fas fa-download text-xs"></i>
                                    </span>
                                    <span>Export Files</span>
                                </button>

                                <button
                                    onClick={() => {
                                        systemApps[0].openFn()
                                        setOpen(false)
                                    }}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#2a2a2a] transition text-sm text-[#e0e0e0] hover:text-white group"
                                >
                                    <span className="w-8 h-8 rounded-lg bg-[#2a2a2a] flex items-center justify-center text-[#808080] group-hover:bg-[#333] transition">
                                        <i className="fas fa-cog text-xs"></i>
                                    </span>
                                    <span>Settings</span>
                                </button>

                                <button
                                    onClick={() => {
                                        (window as any).ZynqOS_openConsent?.()
                                        setOpen(false)
                                    }}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#2a2a2a] transition text-sm text-[#e0e0e0] hover:text-white group"
                                >
                                    <span className="w-8 h-8 rounded-lg bg-[#2a2a3a] flex items-center justify-center text-[#4a9eff] group-hover:bg-[#2a2a4a] transition">
                                        <i className="fas fa-cloud text-xs"></i>
                                    </span>
                                    <span>Connect Storage</span>
                                </button>
                            </div>

                            {/* Power Options */}
                            <div className="p-3 border-t border-[#333]">
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => {
                                            if (confirm('Refresh the system?')) {
                                                window.location.reload()
                                            }
                                        }}
                                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#2a2a2a] hover:bg-[#333] transition text-sm text-[#808080] hover:text-[#e0e0e0]"
                                        title="Restart"
                                    >
                                        <i className="fas fa-redo text-xs"></i>
                                        <span>Restart</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
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
                        transform: translateY(20px); 
                    }
                    to { 
                        opacity: 1; 
                        transform: translateY(0); 
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
