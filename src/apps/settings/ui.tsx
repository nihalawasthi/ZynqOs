import React, { useState, useEffect } from 'react'
import { toast } from '../../hooks/use-toast'
import { getStorageStatus, disconnectStorage, type StorageStatus } from '../../auth/storage'

type TabType = 'display' | 'storage' | 'system' | 'about'

export default function SettingsUI() {
    const [activeTab, setActiveTab] = useState<TabType>('about')
    const [storageStatus, setStorageStatus] = useState<StorageStatus>({ connected: false })
    const [sessionTime, setSessionTime] = useState<string>('0s')
    const [cacheSize, setCacheSize] = useState<string>('calculating...')
    const [cacheRatio, setCacheRatio] = useState<number>(0)
    const [profile, setProfile] = useState<any>(null)
    const [wallpaperSource, setWallpaperSource] = useState<string>('')
    const [backgroundSize, setBackgroundSize] = useState<string>('60%')
    const [wallpaperLoading, setWallpaperLoading] = useState(false)

    useEffect(() => {
        // Get storage status
        getStorageStatus().then(status => {
            setStorageStatus(status)
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

        // Get profile info
        if (storageStatus.connected) {
            fetch('/api?route=auth&action=profile', { credentials: 'include' })
                .then(r => r.ok ? r.json() : Promise.reject())
                .then(data => setProfile(data))
                .catch(() => { })
        }

        // Calculate cache size
        calculateCacheSize()

        // Load saved wallpaper settings
        const savedWallpaper = localStorage.getItem('zynqos_wallpaper_source')
        const savedSize = localStorage.getItem('zynqos_background_size')

        if (savedWallpaper) {
            setWallpaperSource(savedWallpaper)
        }
        if (savedSize) {
            setBackgroundSize(savedSize)
        }

        // Apply wallpaper immediately if saved
        if (savedWallpaper || savedSize) {
            const root = document.querySelector('.h-screen')
            if (root && root instanceof HTMLElement) {
                if (savedWallpaper) {
                    root.style.backgroundImage = `url('${savedWallpaper}')`
                }
                if (savedSize) {
                    root.style.backgroundSize = savedSize
                }
                root.style.backgroundRepeat = 'no-repeat'
                root.style.backgroundPosition = 'center'
            }
        }

        return () => clearInterval(interval)
    }, [storageStatus.connected])

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

    const handleWallpaperUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setWallpaperLoading(true)
        try {
            const reader = new FileReader()
            reader.onload = (event) => {
                const dataUrl = event.target?.result as string
                localStorage.setItem('zynqos_wallpaper_source', dataUrl)
                setWallpaperSource(dataUrl)
                // Apply immediately
                applyWallpaper(dataUrl)
                setWallpaperLoading(false)
            }
            reader.readAsDataURL(file)
        } catch (e) {
            console.error('Upload error:', e)
            setWallpaperLoading(false)
            toast({ title: 'Upload Failed', description: 'Failed to upload wallpaper', variant: 'destructive' })
        }
    }

    const handleWallpaperUrl = () => {
        const url = prompt('Enter image URL:')
        if (url) {
            try {
                // Test if URL is valid
                new URL(url)
                localStorage.setItem('zynqos_wallpaper_source', url)
                setWallpaperSource(url)
                applyWallpaper(url)
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
                    onClick={() => {
                        dismiss()
                        localStorage.removeItem('zynqos_wallpaper_source')
                        localStorage.removeItem('zynqos_background_size')
                        setWallpaperSource('')
                        setBackgroundSize('60%')
                        // Apply default wallpaper without refresh
                        const root = document.querySelector('.h-screen')
                        if (root && root instanceof HTMLElement) {
                            root.style.backgroundImage = `url('/assets/wallpaper.png')`
                            root.style.backgroundSize = '60%'
                            root.style.backgroundRepeat = 'no-repeat'
                            root.style.backgroundPosition = 'center'
                        }
                        toast({ title: 'Success', description: 'Wallpaper reset to default', variant: 'success' })
                    }}
                    className="px-3 py-1 text-sm bg-blue-600 rounded hover:bg-blue-700"
                >
                    Reset
                </button>
            ),
        })
    }

    const handleWallpaperInputChange = (newUrl: string) => {
        if (newUrl.trim()) {
            try {
                // Test if URL is valid
                new URL(newUrl)
                localStorage.setItem('zynqos_wallpaper_source', newUrl)
                setWallpaperSource(newUrl)
                applyWallpaper(newUrl)
            } catch {
                // If not a valid URL, just update the state but don't apply
                setWallpaperSource(newUrl)
            }
        }
    }

    const applyWallpaper = (source: string) => {
        const root = document.querySelector('.h-screen')
        if (root && root instanceof HTMLElement) {
            root.style.backgroundImage = `url('${source}')`
            root.style.backgroundSize = backgroundSize
            root.style.backgroundRepeat = 'no-repeat'
            root.style.backgroundPosition = 'center'
        }
    }

    const handleBackgroundSizeChange = (size: string) => {
        setBackgroundSize(size)
        localStorage.setItem('zynqos_background_size', size)
        const root = document.querySelector('.h-screen')
        if (root && root instanceof HTMLElement) {
            root.style.backgroundSize = size
        }
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
                    {wallpaperSource && (
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
                            <input type="text" value={wallpaperSource || '/assets/wallpaper.png'} onChange={(e) => handleWallpaperInputChange(e.target.value)} className="flex-1 bg-gray-900 text-gray-300 px-3 py-2 rounded text-xs border border-gray-700 focus:border-blue-500 focus:outline-none" placeholder="Wallpaper URL" />
                            <input type="file" id="wallpaper-upload" accept="image/*" onChange={handleWallpaperUpload} disabled={wallpaperLoading} className="hidden" />
                            <button onClick={() => document.getElementById('wallpaper-upload')?.click()} disabled={wallpaperLoading} className="px-3 py-2 bg-blue-600/80 hover:bg-blue-700/80 disabled:bg-gray-600 text-white text-xs rounded transition whitespace-nowrap">{wallpaperLoading ? 'Uploading...' : <i className="fa-solid fa-upload"></i>}</button>
                            {/* <button onClick={handleWallpaperUrl} className="px-3 py-2 bg-blue-600/80 hover:bg-blue-700/80 text-white text-xs rounded transition whitespace-nowrap">🔗 URL</button> */}
                            <select value={backgroundSize} onChange={(e) => handleBackgroundSizeChange(e.target.value)} className="bg-gray-900 text-gray-300 p-2 rounded text-xs border border-gray-700 focus:border-blue-500 focus:outline-none cursor-pointer">
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
                                    <div>
                                        <p className="text-green-300 font-semibold">Connected</p>
                                        {profile?.provider && (
                                            <p className="text-green-400/70 text-sm mt-1">
                                                Provider: <span className="capitalize">{profile.provider}</span>
                                            </p>
                                        )}
                                        {profile?.profile?.email && (
                                            <p className="text-green-400/70 text-sm">
                                                {profile.profile.email}
                                            </p>
                                        )}
                                    </div>
                                    <button
                                        onClick={handleDisconnectStorage}
                                        className="px-3 py-1 bg-gray-700 hover:bg-gray-800 text-white text-sm rounded transition"
                                    >
                                        Disconnect
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="bg-gray-900/50 border border-gray-700/50 rounded p-3">
                            <p className="text-gray-300 mb-3">No cloud storage connected</p>
                            <p className="text-gray-400 text-sm">
                                Connect to Google Drive or GitHub to sync your files automatically.
                            </p>
                            <p className="text-gray-500 text-xs mt-2">
                                Use the profile menu in the Start Menu to connect cloud storage.
                            </p>
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
                    Sync Status
                </h3>
                <div className="bg-black/50 rounded p-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-gray-400">Last Sync</span>
                        <span className="text-gray-500">Auto (disabled)</span>
                    </div>
                    <p className="text-gray-500 text-xs">
                        Background sync is currently scaffolded but not fully implemented. Manual sync happens on demand.
                    </p>
                </div>
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
                {(['about', 'display', 'storage', 'system'] as const).map((tab, index) => (
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
                        {tab === 'system' && <i className="fas fa-cog mr-2"></i>}
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
                {/* Sliding indicator */}
                <div 
                    className="absolute bottom-0 h-0.5 bg-blue-500 transition-all duration-500 ease-out"
                    style={{
                        width: '25%',
                        left: `${['about', 'display', 'storage', 'system'].indexOf(activeTab) * 25}%`
                    }}
                ></div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 scrollbar">
                <div className="tab-slide-enter" key={activeTab}>
                    {activeTab === 'display' && displayTabContent()}
                    {activeTab === 'storage' && storageTabContent()}
                    {activeTab === 'system' && systemTabContent()}
                    {activeTab === 'about' && aboutTabContent()}
                </div>
            </div>
        </div>
    )
}

// Export for window-based app loading
window.__SETTINGS_UI__ = SettingsUI
