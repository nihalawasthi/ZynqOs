import React, { useEffect, useState, useRef } from 'react'
import { toast } from '../../hooks/use-toast'
import { registryManager } from '../../packages/registry'
import {
  installPackage,
  uploadPackage,
  uninstallPackage,
  getInstalledPackages,
  checkUpdates,
  executePackage,
  updatePackage
} from '../../packages/manager'
import type { PackageManifest, InstalledPackage, PackageType } from '../../packages/types'
import { loadMapp } from '../../wasm/mappLoader'

type ViewMode = 'browse' | 'installed' | 'upload' | 'updates' | 'settings'

export default function StoreUI() {
  const [viewMode, setViewMode] = useState<ViewMode>('installed')
  const [availablePackages, setAvailablePackages] = useState<PackageManifest[]>([])
  const [installedPackages, setInstalledPackages] = useState<InstalledPackage[]>([])
  const [systemPackages, setSystemPackages] = useState<PackageManifest[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState<{ [key: string]: { status: string; percent?: number } }>({})
  const [updates, setUpdates] = useState<{ packageId: string; currentVersion: string; latestVersion: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load data
  useEffect(() => {
    loadAvailablePackages()
    loadInstalledPackages()
    checkForUpdates()
  }, [])

  async function loadAvailablePackages() {
    setLoading(true)
    try {
      const packages = await registryManager.fetchAllPackages()
      const system = packages.filter(p => p.isSystemApp)
      const available = packages.filter(p => !p.isSystemApp)
      setSystemPackages(system)
      setAvailablePackages(available)
    } catch (err) {
      console.error('Failed to load packages:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadInstalledPackages() {
    const packages = await getInstalledPackages()
    setInstalledPackages(packages)
  }

  async function checkForUpdates() {
    const availableUpdates = await checkUpdates()
    setUpdates(availableUpdates)
  }

  async function handleInstall(pkg: PackageManifest) {
    // Check if it's a system app
    if (pkg.isSystemApp) {
      toast({ title: 'Cannot Install', description: 'This is a pre-installed system app and cannot be installed.', variant: 'destructive' })
      return
    }

    const result = await installPackage(pkg.id, (status, percent) => {
      setInstallProgress(prev => ({ ...prev, [pkg.id]: { status, percent } }))
    })

    if (result.success) {
      await loadInstalledPackages()
      await checkForUpdates()
      toast({ title: 'Success', description: `${pkg.name} installed successfully!`, variant: 'success' })
      // Notify others
      window.dispatchEvent(new CustomEvent('zynqos:package-installed', { detail: { packageId: pkg.id } }))
    } else {
      toast({ title: 'Installation Failed', description: result.error, variant: 'destructive' })
    }

    // Clear progress after a delay
    setTimeout(() => {
      setInstallProgress(prev => {
        const next = { ...prev }
        delete next[pkg.id]
        return next
      })
    }, 2000)
  }

  async function handleUninstall(packageId: string) {
    const { dismiss } = toast({
      title: 'Uninstall Package?',
      description: 'Are you sure you want to uninstall this package?',
      variant: 'default',
      action: (
        <button
          onClick={async () => {
            dismiss()
            const success = await uninstallPackage(packageId)
            if (success) {
              await loadInstalledPackages()
              await checkForUpdates()
              window.dispatchEvent(new CustomEvent('zynqos:package-uninstalled', { detail: { packageId } }))
              toast({ title: 'Success', description: 'Package uninstalled', variant: 'success' })
            } else {
              toast({ title: 'Error', description: 'Failed to uninstall', variant: 'destructive' })
            }
          }}
          className="px-3 py-1 text-sm bg-red-600 rounded hover:bg-red-700"
        >
          Uninstall
        </button>
      ),
    })
  }

  async function handleUpdate(packageId: string) {
    const result = await updatePackage(packageId, (status, percent) => {
      setInstallProgress(prev => ({ ...prev, [packageId]: { status, percent } }))
    })

    if (result.success) {
      await loadInstalledPackages()
      await checkForUpdates()
      toast({ title: 'Success', description: 'Package updated successfully!', variant: 'success' })
    } else {
      toast({ title: 'Update Failed', description: result.error, variant: 'destructive' })
    }

    setTimeout(() => {
      setInstallProgress(prev => {
        const next = { ...prev }
        delete next[packageId]
        return next
      })
    }, 2000)
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setLoading(true)

    try {
      // Check if it's a .mapp file
      if (file.name.toLowerCase().endsWith('.mapp')) {
        const manifest = await loadMapp(file)
        toast({ title: 'Success', description: `Package "${manifest.name}" imported to /apps/${manifest.name}`, variant: 'success' })
        setLoading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }

      // For other files, prompt for metadata
      const name = prompt('Enter package name:', file.name.replace(/\.(wasm|wasi|zip)$/, ''))
      if (!name) {
        setLoading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }

      const description = prompt('Enter package description:') || 'User uploaded package'
      const author = prompt('Enter author name:') || 'Anonymous'
      const version = prompt('Enter version:', '1.0.0') || '1.0.0'

      const result = await uploadPackage({
        file,
        metadata: {
          name,
          description,
          author,
          version,
          type: 'wasm',
          tags: ['user-uploaded']
        }
      })

      if (result.success) {
        toast({ title: 'Success', description: 'Package uploaded successfully!', variant: 'success' })
        await loadInstalledPackages()
        setViewMode('installed')
      } else {
        toast({ title: 'Upload Failed', description: result.error, variant: 'destructive' })
      }
    } catch (err) {
      toast({ title: 'Import Failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' })
    }

    setLoading(false)

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function handleExecute(pkg: InstalledPackage) {
    if (pkg.type === 'wasm' || pkg.type === 'wasi') {
      const instance = await executePackage(pkg.id)
      if (instance) {
        toast({ title: 'Success', description: `Executed ${pkg.name}`, variant: 'success' })
      } else {
        toast({ title: 'Execution Failed', description: `Failed to execute ${pkg.name}. See console for details.`, variant: 'destructive' })
      }
    } else {
      toast({ title: 'Error', description: 'Only WASM packages can be executed directly', variant: 'destructive' })
    }
  }

  // Filter packages
  const categories = [
    { key: 'all', label: 'All', icon: 'apps' },
    { key: 'development', label: 'Development', icon: 'terminal' },
    { key: 'games', label: 'Games', icon: 'videogame_asset' },
    { key: 'system', label: 'System', icon: 'dns' },
    { key: 'design', label: 'Design', icon: 'design_services' },
    { key: 'multimedia', label: 'Multimedia', icon: 'music_note' },
  ]

  const filteredPackages = availablePackages.filter(pkg => {
    const q = searchQuery.trim().toLowerCase()
    const matchesSearch = !q || pkg.name.toLowerCase().includes(q) || pkg.description.toLowerCase().includes(q)
    const matchesCategory = !selectedCategory || selectedCategory === 'all' || pkg.tags.includes(selectedCategory)
    return matchesSearch && matchesCategory
  })

  const isInstalled = (packageId: string) => {
    return installedPackages.some(p => p.id === packageId)
  }

  const hasUpdate = (packageId: string) => {
    return updates.some(u => u.packageId === packageId)
  }

  // Get all unique tags
  const allTags = Array.from(new Set(availablePackages.flatMap(p => p.tags)))

  const renderIcon = (icon?: string) => {
    if (!icon) return <span className="text-3xl">📦</span>
    const isUrl = icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('//')
    return isUrl ? (
      <img
        src={icon}
        alt="icon"
        className="h-8 w-8 object-contain"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      />
    ) : (
      <span className="text-3xl">{icon}</span>
    )
  }

  // Derived lists used by Installed page
  const installedAll: Array<InstalledPackage | (PackageManifest & { system: true })> = [
    ...systemPackages.map(p => ({ ...p, system: true as const })),
    ...installedPackages
  ]
  const installedFiltered = installedAll.filter(p => {
    const name = 'name' in p ? p.name : (p as any).name
    const desc = 'description' in p ? p.description : (p as any).description
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return name.toLowerCase().includes(q) || desc.toLowerCase().includes(q)
  })

  const handleCleanCache = () => {
    const { dismiss } = toast({
      title: 'Clean Cache?',
      description: 'This will remove cached downloads to free space.',
      variant: 'default',
      action: (
        <button
          className="px-3 py-1 text-sm bg-red-600 rounded hover:bg-red-700"
          onClick={() => {
            dismiss()
            toast({ title: 'Cache Cleared', description: 'Temporary cache removed.', variant: 'success' })
          }}
        >
          Confirm
        </button>
      )
    })
  }

  return (
    <div className="h-full flex overflow-hidden bg-[#0f1115] text-white">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 hidden md:flex md:flex-col bg-white text-slate-900 dark:text-white dark:bg-[#1a1d23] border-r border-slate-200 dark:border-slate-800">
        <div className="p-6 pb-2 w-full">
          <div className="flex items-center gap-3 mb-8">
            <div className="bg-[#137fec]/20 flex items-center justify-center rounded-lg size-10">
              <span className="material-symbols-outlined text-[#137fec] text-2xl">grid_view</span>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white leading-none">ZynqOS</h1>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Package Manager</span>
            </div>
          </div>
          <nav className="flex flex-col gap-1">
            <button onClick={() => setViewMode('browse')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border-l-4 ${viewMode==='browse' ? 'bg-[#137fec]/10 text-[#137fec] border-[#137fec]' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border-transparent'} transition-colors`}>
              <span className="material-symbols-outlined text-[20px]">explore</span>
              <span className="text-sm font-semibold">Browse</span>
            </button>
            <button onClick={() => setViewMode('installed')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border-l-4 ${viewMode==='installed' ? 'bg-[#137fec]/10 text-[#137fec] border-[#137fec]' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border-transparent'} transition-colors`}>
              <span className="material-symbols-outlined text-[20px]">inventory_2</span>
              <span className="text-sm font-medium">Installed</span>
            </button>
            <button onClick={() => setViewMode('upload')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border-l-4 ${viewMode==='upload' ? 'bg-[#137fec]/10 text-[#137fec] border-[#137fec]' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border-transparent'} transition-colors`}>
              <span className="material-symbols-outlined text-[20px]">cloud_upload</span>
              <span className="text-sm font-medium">Upload</span>
            </button>
            <button onClick={() => setViewMode('updates')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border-l-4 ${viewMode==='updates' ? 'bg-[#137fec]/10 text-[#137fec] border-[#137fec]' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border-transparent'} transition-colors`}>
              <span className="material-symbols-outlined text-[20px]">history</span>
              <span className="text-sm font-medium">Updates</span>
              {updates.length>0 && <span className="ml-auto bg-[#137fec] text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">{updates.length}</span>}
            </button>
          </nav>
        </div>
        <div className="mt-auto p-6 border-t border-slate-200 dark:border-slate-800">
          <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">Storage</h3>
          <div className="flex flex-col gap-2">
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
              <div className="bg-[#137fec] h-2 rounded-full" style={{ width: '72%' }} />
            </div>
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>34.2 GB used</span>
              <span>128 GB</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-8 py-3 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-[#0f1115]/80 backdrop-blur-sm sticky top-0 z-10">
          {/* Search (hidden on Upload page) */}
          {viewMode !== 'upload' && (
            <div className="flex-1 max-w-xl">
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="material-symbols-outlined text-slate-400 group-focus-within:text-[#137fec] transition-colors">search</span>
                </div>
                <input
                  type="text"
                  placeholder={viewMode==='installed' ? 'Search installed packages...' : 'Search packages, libraries, or tools...'}
                  className="block w-full pl-10 pr-3 py-2 border-none rounded-lg leading-5 bg-slate-100 dark:bg-[#1a1d23] text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:bg-white dark:focus:bg-[#252932] focus:ring-1 focus:ring-[#137fec] sm:text-sm transition-all"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <span className="text-xs text-slate-400 border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5">⌘K</span>
                </div>
              </div>
            </div>
          )}
          {/* Remove moon and bell icons */}
          <div className="hidden" />
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
        {loading && <div className="text-center text-gray-400">Loading...</div>}

        {/* Browse view */}
        {viewMode === 'browse' && !loading && (
          <div className="max-w-[1400px] mx-auto space-y-8">
            {/* Featured / Hero Card */}
            <div className="w-full relative rounded-xl overflow-hidden bg-[#1a1d23] shadow-xl min-h-[280px] flex items-center group">
              <div className="absolute inset-0 bg-cover bg-center z-0 transition-transform duration-700 group-hover:scale-105" style={{backgroundImage: 'url(https://lh3.googleusercontent.com/aida-public/AB6AXuBdYEfh6T8X2gex_aCmDDZRgsczhxKgbc_n9b13go05fJ6kZ4_VclgVYUYkh2_HbakKrAVUuohKV31Qav-j-5hcutKc8horcF8SbKA6CvhFfDzKkg6fHfG6X_23INGetUFLVc6oUa33ldvxE139Kfm_ZyOAuXGHT-5KOIJfUpPmknFdQg_PHtsUQeyjjwRUQ7oaHWUKcMWxOI7M2X63HLho6jpl8ZzbGuWvAF2L2yciMobrqf9hLmWxc9TDN8eYnIWiLjjWcdZqEYB2)'}} />
              <div className="absolute inset-0 bg-gradient-to-r from-[#0f1115] via-[#0f1115]/90 to-transparent z-10"></div>
              <div className="relative z-20 p-6 md:p-10 max-w-2xl flex flex-col items-start gap-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#137fec]/20 text-[#137fec] border border-[#137fec]/20 backdrop-blur-md">
                  <span className="material-symbols-outlined text-sm font-bold">star</span>
                  <span className="text-xs font-bold uppercase tracking-wide">Editor's Choice</span>
                </div>
                <h2 className="text-4xl font-bold tracking-tight leading-tight">{availablePackages[0]?.name || 'Featured App'} <span className="text-slate-400 font-medium block md:inline">for ZynqOS</span></h2>
                <p className="text-slate-300 text-base leading-relaxed max-w-lg">{availablePackages[0]?.description || 'Explore top apps, tools, and utilities curated for you.'}</p>
                <div className="flex items-center gap-4 mt-2">
                  {availablePackages[0] && (
                    <button className="flex items-center gap-2 bg-[#137fec] hover:bg-[#137fec]/90 text-white px-5 py-2.5 rounded-lg font-semibold transition-all shadow-lg shadow-[#137fec]/20" onClick={() => handleInstall(availablePackages[0])}>
                      <span className="material-symbols-outlined">download</span>
                      Install Now
                    </button>
                  )}
                  <button className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-lg font-medium backdrop-blur-sm transition-all">
                    Learn More
                  </button>
                </div>
              </div>
            </div>

            {/* Chips / Filters */}
            <div className="flex items-center gap-3 overflow-x-auto pb-2">
              {categories.map(cat => (
                <button key={cat.key} onClick={() => setSelectedCategory(cat.key)} className={`flex shrink-0 items-center gap-2 px-4 py-2 rounded-lg ${selectedCategory===cat.key || (!selectedCategory && cat.key==='all') ? 'bg-[#137fec] text-white shadow-md shadow-[#137fec]/20' : 'bg-white dark:bg-[#1a1d23] hover:bg-slate-100 dark:hover:bg-[#252932] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'} transition-all active:scale-95`}>
                  <span className="material-symbols-outlined text-[18px]">{cat.icon}</span>
                  <span className="text-sm font-medium">{cat.label}</span>
                </button>
              ))}
            </div>

            {/* Packages Grid */}
            {filteredPackages.length === 0 ? (
              <div className="text-center text-slate-400 py-12">No packages match your filters.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredPackages.map(pkg => {
                  const installed = isInstalled(pkg.id)
                  const progress = installProgress[pkg.id]
                  const updateAvailable = hasUpdate(pkg.id)
                  return (
                    <div key={pkg.id} className="group bg-white dark:bg-[#1a1d23] rounded-xl p-5 border border-slate-200 dark:border-slate-800 hover:border-[#137fec]/50 transition-all hover:shadow-lg hover:shadow-[#137fec]/5 cursor-pointer flex flex-col h-full relative overflow-hidden">
                      <div className="flex items-start justify-between mb-4">
                        <div className="size-12 rounded-lg bg-white/5 flex items-center justify-center text-white shadow-md">
                          <span className="text-[28px]">{renderIcon(pkg.icon)}</span>
                        </div>
                        {pkg.verified && (
                          <div className="flex items-center gap-1 bg-green-500/10 text-green-500 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                            <span className="material-symbols-outlined text-[12px]">verified</span> Safe
                          </div>
                        )}
                      </div>
                      <div className="mb-2">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-[#137fec] transition-colors">{pkg.name}</h3>
                        <p className="text-slate-500 dark:text-slate-400 text-sm line-clamp-2 mt-1">{pkg.description}</p>
                      </div>

                      {progress && progress.percent !== undefined && (
                        <>
                          <div className="flex items-center justify-between text-[10px] text-[#137fec] font-semibold mb-1 mt-1 uppercase tracking-wide">
                            <span>{progress.status}</span>
                            <span>{Math.round(progress.percent)}%</span>
                          </div>
                          <div className="h-1 w-full bg-slate-200 dark:bg-slate-800 rounded-full mb-3 overflow-hidden">
                            <div className="h-full bg-[#137fec] rounded-full" style={{ width: `${progress.percent}%` }} />
                          </div>
                        </>
                      )}

                      <div className="flex items-center gap-2 mt-auto pt-4 border-t border-slate-100 dark:border-slate-800/50">
                        <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs px-2 py-1 rounded">v{pkg.version}</span>
                        <span className="text-xs text-slate-400">{formatBytes(pkg.size)}</span>
                        {updateAvailable && <span className="ml-auto text-orange-400 text-xs font-semibold">Update</span>}
                      </div>

                      {/* Hover Action Overlay */}
                      <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        {installed ? (
                          <button className="bg-green-600/90 text-white px-3 py-1.5 rounded-lg shadow-lg hover:bg-green-600 transition-colors" onClick={() => handleUninstall(pkg.id)}>Remove</button>
                        ) : (
                          <button className="bg-[#137fec] text-white p-2 rounded-lg shadow-lg hover:bg-[#137fec]/90 transition-colors" onClick={() => handleInstall(pkg)}>
                            <span className="material-symbols-outlined text-[20px]">download</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Installed view */}
        {viewMode === 'installed' && !loading && (
          <div className="max-w-[1400px] mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-white">Installed Packages</h2>
                <p className="text-sm text-[#92adc9] mt-1">Manage your local software and libraries.</p>
              </div>
            </div>
            {installedFiltered.length === 0 ? (
              <div className="text-center text-gray-400 py-12">No installed packages match your search.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {installedFiltered.map((pkg) => {
                  // Type guards
                  const isSystem = (pkg as any).system === true
                  const id = (pkg as any).id as string
                  const name = (pkg as any).name as string
                  const description = (pkg as any).description as string
                  const version = (pkg as any).version as string
                  const size = (pkg as any).size as number
                  const type = (pkg as any).type as PackageType | undefined
                  const updateAvailable = hasUpdate(id)
                  const progress = installProgress[id]
                  return (
                    <div key={id} className="group rounded-xl p-5 bg-white dark:bg-[#1a1d23] hover:bg-white dark:hover:bg-[#233648] border border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10 transition-all shadow-sm flex flex-col relative overflow-hidden">
                      <div className="flex gap-4">
                        <div className="size-14 shrink-0 rounded-lg bg-white/30 dark:bg-white/5 flex items-center justify-center">
                          <span className="text-[28px]">{renderIcon((pkg as any).icon)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white truncate pr-2">{name}</h3>
                            {isSystem && <span className="text-xs text-slate-500 dark:text-[#92adc9]">system</span>}
                          </div>
                          <p className="text-slate-500 dark:text-[#92adc9] text-sm line-clamp-2 leading-relaxed">{description}</p>
                        </div>
                      </div>

                      {progress && progress.percent !== undefined && (
                        <>
                          <div className="flex items-center justify-between text-[10px] text-blue-500 font-semibold mb-1 mt-3 uppercase tracking-wide">
                            <span>{progress.status}</span>
                            <span>{Math.round(progress.percent)}%</span>
                          </div>
                          <div className="h-1 w-full bg-[#324d67] rounded-full mb-3 overflow-hidden">
                            <div className="h-full bg-[#137fec] rounded-full" style={{ width: `${progress.percent}%` }} />
                          </div>
                        </>
                      )}

                      <div className="mt-auto pt-4 border-t border-slate-200 dark:border-white/5 flex items-center justify-between">
                        <div className="text-xs text-slate-500 dark:text-[#92adc9] font-mono">v{version} • {formatBytes(size)}</div>
                        <div className="flex items-center gap-2">
                          {type && (type === 'wasm' || type === 'wasi') && (
                            <button
                              className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-slate-100 dark:bg-[#233648] text-slate-700 dark:text-white hover:bg-slate-200 dark:hover:bg-[#324d67] text-xs font-semibold transition-colors"
                              onClick={() => !isSystem && handleExecute(pkg as InstalledPackage)}
                              disabled={isSystem}
                            >
                              Open
                            </button>
                          )}
                          {updateAvailable && (
                            <button
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-orange-500/10 text-orange-400 text-xs font-semibold border border-orange-500/20 hover:bg-orange-500/20"
                              onClick={() => handleUpdate(id)}
                            >
                              Update
                            </button>
                          )}
                          {!isSystem && (
                            <button
                              className="p-1.5 text-slate-400 dark:text-[#92adc9] hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                              title="Remove"
                              onClick={() => handleUninstall(id)}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="py-8 text-center border-t border-white/5 mt-8">
              <p className="text-sm text-[#92adc9]">Showing {installedFiltered.length} of {installedAll.length} installed packages</p>
            </div>
          </div>
        )}

        {viewMode==='updates' && !loading && (
          <div className="max-w-5xl mx-auto w-full px-2 sm:px-0">
            {/* Status */}
            <div className="flex flex-col gap-3 mt-6">
              <div className="flex gap-6 justify-between items-center">
                <p className="text-white text-sm font-medium flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-400 text-[18px]">check_circle</span>
                  System Analysis Complete
                </p>
                <p className="text-[#92adc9] text-xs">Last checked: Just now</p>
              </div>
              <div className="rounded-full bg-[#324d67] h-1.5 w-full overflow-hidden">
                <div className="h-full bg-[#137fec] rounded-full" style={{width:'0%'}} />
              </div>
            </div>

            {/* Filters */}
            <div className="flex gap-2 overflow-x-auto pb-2 mt-4">
              <button className="flex h-8 shrink-0 items-center justify-center gap-x-2 rounded-lg bg-white text-[#101922] font-bold px-4 text-sm shadow-sm">All Updates</button>
              <button className="flex h-8 shrink-0 items-center justify-center gap-x-2 rounded-lg bg-[#233648] hover:bg-[#324d67] px-4 border border-white/5 transition-colors">
                <span className="material-symbols-outlined text-[#137fec] text-[18px]">shield</span>
                <p className="text-[#92adc9] text-sm">Security</p>
              </button>
              <button className="flex h-8 shrink-0 items-center justify-center gap-x-2 rounded-lg bg-[#233648] hover:bg-[#324d67] px-4 border border-white/5 transition-colors">
                <span className="material-symbols-outlined text-orange-400 text-[18px]">apps</span>
                <p className="text-[#92adc9] text-sm">Apps</p>
              </button>
              <button className="flex h-8 shrink-0 items-center justify-center gap-x-2 rounded-lg bg-[#233648] hover:bg-[#324d67] px-4 border border-white/5 transition-colors">
                <span className="material-symbols-outlined text-purple-400 text-[18px]">memory</span>
                <p className="text-[#92adc9] text-sm">System</p>
              </button>
              <div className="ml-auto flex items-center gap-2">
                <button className="flex h-8 shrink-0 items-center justify-center gap-x-1 rounded-lg hover:bg-[#233648] px-2 text-[#92adc9] transition-colors">
                  <span className="material-symbols-outlined text-[20px]">sort</span>
                  <span className="text-xs font-medium">Sort by Priority</span>
                </button>
              </div>
            </div>

            {/* Featured */}
            {updates.length>0 && (
              <div className="flex flex-col md:flex-row items-stretch justify-between gap-6 rounded-xl bg-gradient-to-br from-[#192633] to-[#1e2d3d] p-1 shadow-lg ring-1 ring-white/10 mt-2">
                <div className="flex flex-1 flex-col justify-center gap-4 p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="bg-red-500/10 text-red-400 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded border border-red-500/20">Critical</span>
                    <span className="text-[#92adc9] text-xs">Released today</span>
                  </div>
                  <div>
                    <h3 className="text-white text-xl font-bold leading-tight mb-2">{availablePackages[0]?.name || 'System Security Patch'}</h3>
                    <p className="text-[#92adc9] text-sm leading-relaxed">Critical patches and improvements. Recommended for immediate installation to ensure system integrity.</p>
                  </div>
                  <div className="flex items-center gap-4 mt-2">
                    <button onClick={() => updates[0] && handleUpdate(updates[0].packageId)} className="flex cursor-pointer items-center justify-center gap-2 rounded-lg h-9 px-5 bg-[#137fec] hover:bg-blue-600 text-white text-sm font-bold shadow-lg shadow-blue-500/10 w-fit transition-all">Update Now</button>
                    <span className="text-[#92adc9] text-xs font-mono">150 MB</span>
                  </div>
                </div>
                <div className="w-full md:w-1/3 min-h-[160px] bg-center bg-no-repeat bg-cover rounded-lg m-1 opacity-80 mix-blend-overlay md:mix-blend-normal" style={{backgroundImage:'url(https://lh3.googleusercontent.com/aida-public/AB6AXuBX38DZWDBjTtG1a-YkqJGjqkDn146scDb1xgV5eWWEmZq_Y2LFD-N0K5qTK_wYgBMj7kloMNOANZ0mgriiZu0qk2w9lCwNGmy-ssKEK8ZqlfCgJ8VK7IGnV2JGLAyaDyFfgimwC5Whcopffl_6C4aAW0snoOgf1WhjZQ0x5hfwm1t3OzJBAds7Hq9U3d770KM8lFH57M2pXaHt7hhCs4GJo1yhac1OOWqlMF35Vi3DnrsaWklkmJb8ujD5e-hYd_GDMXlLASi09mxU)'}} />
              </div>
            )}

            {/* Updates list */}
            <div className="flex flex-col gap-3 mt-6">
              <h3 className="text-white text-lg font-bold px-1">Applications</h3>
              {updates.map(u => {
                const meta = installedPackages.find(p=>p.id===u.packageId) || availablePackages.find(p=>p.id===u.packageId)
                const name = meta?.name || u.packageId
                const desc = (meta as any)?.description || 'Package update available.'
                const tag = (meta as any)?.tags?.[0]
                const size = (meta as any)?.size
                return (
                  <div key={u.packageId} className="group flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl bg-[#192633] hover:bg-[#233648] border border-white/5 hover:border-white/10 transition-all">
                    <div className="rounded-lg size-12 shrink-0 bg-white/5 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[28px]">apps</span>
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 text-center sm:text-left">
                      <div className="flex items-center justify-center sm:justify-start gap-2">
                        <h4 className="text-white font-bold text-base truncate">{name}</h4>
                        {tag && <span className="bg-[#233648] text-[#92adc9] text-[10px] px-1.5 py-0.5 rounded border border-white/5">{tag}</span>}
                      </div>
                      <p className="text-[#92adc9] text-sm truncate">{desc}</p>
                    </div>
                    <div className="flex flex-col sm:items-end gap-1 text-center sm:text-right px-4 sm:border-l border-white/5">
                      <div className="flex items-center gap-2 font-mono text-sm">
                        <span className="text-[#92adc9]">v{u.currentVersion}</span>
                        <span className="material-symbols-outlined text-[#92adc9] text-[14px]">arrow_right_alt</span>
                        <span className="text-emerald-400 font-bold">v{u.latestVersion}</span>
                      </div>
                      {typeof size==='number' && <span className="text-xs text-[#92adc9]">{formatBytes(size)}</span>}
                    </div>
                    <button onClick={()=>handleUpdate(u.packageId)} className="shrink-0 h-9 px-4 rounded-lg bg-[#233648] hover:bg-[#137fec] hover:text-white text-white text-sm font-medium transition-colors border border-white/5">Update</button>
                  </div>
                )
              })}
              {updates.length===0 && (
                <div className="text-center text-[#92adc9] py-12">No updates available.</div>
              )}
            </div>
            <div className="flex justify-center mt-4">
              <button className="text-[#92adc9] hover:text-white text-sm font-medium flex items-center gap-2 transition-colors">
                <span className="material-symbols-outlined text-[18px]">expand_more</span>
                Show ignored updates
              </button>
            </div>
          </div>
        )}

        {/* Upload view */}
        {viewMode === 'upload' && (
          <div className="max-w-5xl mx-auto flex flex-col gap-8">
            <div className="flex items-center text-sm font-medium">
              <span className="text-[#92adc9]">Home</span>
              <span className="mx-2 text-[#92adc9]/40">/</span>
              <span className="text-white">Upload</span>
            </div>
            <div className="bg-[#16202a] border border-[#233648] rounded-xl shadow-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[#233648] bg-[#111a22]/50 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-white">Package Details</h3>
                <span className="px-2.5 py-1 rounded-full bg-yellow-500/10 text-yellow-500 text-xs font-medium border border-yellow-500/20">Draft Mode</span>
              </div>
              <div className="p-6 md:p-8 space-y-8">
                {/* Metadata Grid */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  <div className="md:col-span-8 space-y-2">
                    <label className="text-xs font-bold text-[#92adc9] uppercase tracking-wider">Package Identifier</label>
                    <div className="relative group">
                      <input className="w-full bg-[#111a22] border border-[#233648] text-white rounded-lg px-4 py-3 focus:border-[#137fec] focus:ring-1 focus:ring-[#137fec] outline-none transition-all placeholder-[#92adc9]/40 font-mono text-sm" type="text" defaultValue="com.zynqos." />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <span className="text-xs text-[#92adc9] hidden group-focus-within:block">Checking...</span>
                        <span className="material-symbols-outlined text-green-500 text-[20px]">check_circle</span>
                      </div>
                    </div>
                    <p className="text-xs text-[#92adc9]/80">Use reverse domain notation (e.g., com.company.appname).</p>
                  </div>
                  <div className="md:col-span-4 space-y-2">
                    <label className="text-xs font-bold text-[#92adc9] uppercase tracking-wider">Semantic Version</label>
                    <input className="w-full bg-[#111a22] border border-[#233648] text-white rounded-lg px-4 py-3 focus:border-[#137fec] focus:ring-1 focus:ring-[#137fec] outline-none transition-all placeholder-[#92adc9]/40 font-mono text-sm" placeholder="1.0.0" type="text" />
                  </div>
                  <div className="md:col-span-12 space-y-2">
                    <label className="text-xs font-bold text-[#92adc9] uppercase tracking-wider">Description</label>
                    <textarea className="w-full bg-[#111a22] border border-[#233648] text-white rounded-lg px-4 py-3 focus:border-[#137fec] focus:ring-1 focus:ring-[#137fec] outline-none transition-all placeholder-[#92adc9]/40 resize-y min-h-[100px]" placeholder="Describe the functionality, features, and dependencies of your package..." rows={4}></textarea>
                  </div>
                  <div className="md:col-span-12 space-y-2">
                    <label className="text-xs font-bold text-[#92adc9] uppercase tracking-wider">Category Tags</label>
                    <div className="flex flex-wrap items-center gap-2 bg-[#111a22] border border-[#233648] rounded-lg p-2 min-h-[50px]">
                      <span className="inline-flex items-center gap-1.5 bg-[#233648] text-[#137fec] text-xs font-medium px-2.5 py-1.5 rounded-md border border-[#233648]/50">system-utility</span>
                      <span className="inline-flex items-center gap-1.5 bg-[#233648] text-[#137fec] text-xs font-medium px-2.5 py-1.5 rounded-md border border-[#233648]/50">network</span>
                      <input className="bg-transparent text-white text-sm outline-none min-w-[100px] flex-1 px-1 h-full placeholder-[#92adc9]/40" placeholder="Add tag..." type="text" />
                    </div>
                    <p className="text-xs text-[#92adc9]/80">Press Enter to create a tag.</p>
                  </div>
                </div>
                {/* Upload Zone */}
                <div className="space-y-3">
                  <label className="text-xs font-bold text-[#92adc9] uppercase tracking-wider">Package File (.zpkg)</label>
                  <div className="relative w-full">
                    <input ref={fileInputRef} type="file" accept=".wasm,.wasi,.zip,.mapp" onChange={handleFileUpload} className="hidden" id="file-upload" />
                    <label htmlFor="file-upload" className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-[#324d67] rounded-xl cursor-pointer bg-[#111a22]/30 hover:bg-[#111a22] hover:border-[#137fec]/50 transition-all duration-300 group">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <div className="mb-4 p-3 rounded-full bg-[#233648] text-white group-hover:bg-[#137fec] group-hover:scale-110 transition-all duration-300 shadow-lg">
                          <span className="material-symbols-outlined text-3xl">cloud_upload</span>
                        </div>
                        <p className="mb-2 text-sm text-white font-medium"><span className="font-bold text-[#137fec] group-hover:underline">Click to upload</span> or drag and drop</p>
                        <p className="text-xs text-[#92adc9]">Binary Package (.zpkg) up to 500MB</p>
                      </div>
                    </label>
                  </div>
                </div>
                <div className="bg-[#111a22]/50 border border-[#233648] rounded p-4 text-sm flex items-center gap-2 text-[#92adc9]">
                  <span className="material-symbols-outlined text-[16px]">info</span>
                  All uploads are scanned for malware automatically.
                </div>
              </div>
              <div className="bg-[#111a22]/50 px-6 py-4 border-t border-[#233648] flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-xs text-[#92adc9]">Max size 50MB. Keep the app metadata ready.</div>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button className="flex-1 sm:flex-none px-5 py-2.5 rounded-lg text-sm font-medium text-[#92adc9] hover:text-white hover:bg-[#233648] transition-colors">Save Draft</button>
                  <button className="flex-1 sm:flex-none px-6 py-2.5 rounded-lg text-sm font-bold bg-[#137fec] text-white hover:bg-blue-600 shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">download</span>
                    Install Package
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
      </main>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

// @ts-ignore
window.__STORE_UI__ = StoreUI