import React, { useState } from 'react'

type App = {
    id: string
    name: string
    icon: string
    openFn: () => void
}

export default function StartMenu() {
    const [open, setOpen] = useState(false)

    const pinnedApps: App[] = [
        {
            id: 'file-browser',
            name: 'Files',
            icon: '📁',
            openFn: () => (window as any).ZynqOS_openWindow?.('Files', window.__FILE_BROWSER_UI__ ?? <div>Loading...</div>, 'file-browser'),
        },
        {
            id: 'text-editor',
            name: 'Zynqpad',
            icon: '📝',
            openFn: () => (window as any).ZynqOS_openWindow?.('Zynqpad', window.__TEXT_EDITOR_UI__ ?? <div>Loading...</div>, 'text-editor'),
        },
        {
            id: 'terminal',
            name: 'Terminal',
            icon: '💻',
            openFn: () => (window as any).ZynqOS_openWindow?.('Terminal', window.__TERMINAL_UI__ ?? <div>Loading Terminal...</div>, 'terminal'),
        },
        {
            id: 'store',
            name: 'App Store',
            icon: '🛍️',
            openFn: () => (window as any).ZynqOS_openWindow?.('App Store', window.__STORE_UI__ ?? <div>Loading Store...</div>, 'store'),
        },
    ]

    const quickLaunch: App[] = [
        {
            id: 'mapp-importer',
            name: 'Import .mapp',
            icon: '📦',
            openFn: () => {
                const Comp = window.__MAPP_IMPORTER_UI__
                if (Comp) {
                    (window as any).ZynqOS_openWindow?.('Import Package', Comp, 'mapp-importer')
                }
            },
        },
    ]

    return (
        <>
            {/* Start button */}
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center justify-center w-10 h-10 ml-2 rounded-[10px] hover:bg-gray-200/30 transition transform hover:scale-105 "
                title="Start Menu"
            >
                <div className="flex items-center gap-3">
                    <img src="/assets/logo.png"
                        className='aspect-[1/1] h-10'
                        alt="" />
                </div>
            </button>

            {/* Start Menu Panel */}
            {open && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-40"
                        style={{ pointerEvents: 'auto' }}
                        onClick={() => setOpen(false)}
                    />

                    {/* Menu */}
                    <div className="fixed bottom-20 left-4 w-96 bg-gray-950/95 backdrop-blur-lg border border-gray-800/50 rounded-2xl shadow-2xl p-6 z-50">
                        {/* Search bar */}
                        <div className="mb-6">
                            <input
                                type="text"
                                placeholder="Search for apps, settings..."
                                onKeyDown={(e) => e.stopPropagation()}
                                className="w-full px-4 py-2 bg-gray-800/50 border border-gray-700/30 rounded-full text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
                            />
                        </div>

                        {/* Pinned Apps */}
                        <div className="mb-6">
                            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Apps</div>
                            <div className="grid grid-cols-4 gap-3">
                                {pinnedApps.map((app) => (
                                    <button
                                        key={app.id}
                                        onClick={() => {
                                            app.openFn()
                                            setOpen(false)
                                        }}
                                        className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-gray-800/50 transition group"
                                    >
                                        <div className="text-3xl">{app.icon}</div>
                                        <div className="text-xs text-center text-gray-300 group-hover:text-white transition">{app.name}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Quick Launch */}
                        <div className="border-t border-gray-800/50 pt-4">
                            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Quick Launch</div>
                            <div className="space-y-2">
                                {quickLaunch.map((app) => (
                                    <button
                                        key={app.id}
                                        onClick={() => {
                                            app.openFn()
                                            setOpen(false)
                                        }}
                                        className="w-full flex items-center gap-3 px-3 py-2 rounded-md bg-gray-800/30 hover:bg-gray-800/60 transition text-sm text-gray-200 hover:text-white"
                                    >
                                        <span className="text-lg">{app.icon}</span>
                                        <span>{app.name}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    )
}
