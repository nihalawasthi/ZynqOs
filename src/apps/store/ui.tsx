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

type ViewMode = 'browse' | 'installed' | 'upload' | 'settings'

export default function StoreUI() {
  const [viewMode, setViewMode] = useState<ViewMode>('installed')
  const [availablePackages, setAvailablePackages] = useState<PackageManifest[]>([])
  const [installedPackages, setInstalledPackages] = useState<InstalledPackage[]>([])
  const [systemPackages, setSystemPackages] = useState<PackageManifest[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
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
  const filteredPackages = availablePackages.filter(pkg => {
    const matchesSearch = !searchQuery || 
      pkg.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pkg.description.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesTags = selectedTags.length === 0 ||
      selectedTags.some(tag => pkg.tags.includes(tag))

    return matchesSearch && matchesTags
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

  return (
    <div className="p-4 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-2xl font-bold mb-2">ZynqOS Package Manager</h2>
        <div className="flex gap-2 mb-3">
          <button
            className={`px-3 py-1 rounded ${viewMode === 'browse' ? 'bg-blue-600' : 'bg-gray-700'}`}
            onClick={() => setViewMode('browse')}
          >
            📦 Browse ({availablePackages.length})
          </button>
          <button
            className={`px-3 py-1 rounded ${viewMode === 'installed' ? 'bg-blue-600' : 'bg-gray-700'}`}
            onClick={() => setViewMode('installed')}
          >
            ✓ Installed ({systemPackages.length + installedPackages.length})
          </button>
          <button
            className={`px-3 py-1 rounded ${viewMode === 'upload' ? 'bg-blue-600' : 'bg-gray-700'}`}
            onClick={() => setViewMode('upload')}
          >
            ⬆️ Upload
          </button>
          {updates.length > 0 && (
            <span className="ml-auto px-2 py-1 bg-orange-600/80 rounded text-sm">
              {updates.length} update{updates.length !== 1 ? 's' : ''} available
            </span>
          )}
        </div>

        {/* Search and filter */}
        {(viewMode === 'browse' || viewMode === 'installed') && (
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Search packages..."
              className="w-full px-3 py-2 bg-gray-800 rounded border border-gray-700"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {allTags.slice(0, 10).map(tag => (
                <button
                  key={tag}
                  className={`px-2 py-1 text-xs rounded ${
                    selectedTags.includes(tag)
                      ? 'bg-blue-600'
                      : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                  onClick={() => {
                    setSelectedTags(prev =>
                      prev.includes(tag)
                        ? prev.filter(t => t !== tag)
                        : [...prev, tag]
                    )
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="text-center text-gray-400">Loading...</div>}

        {/* Browse view */}
        {viewMode === 'browse' && !loading && (
          <>
            {filteredPackages.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                <p className="text-lg mb-2">No packages available</p>
                <p className="text-sm">Try adjusting your search or filters</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredPackages.map(pkg => {
              const installed = isInstalled(pkg.id)
              const progress = installProgress[pkg.id]
              const updateAvailable = hasUpdate(pkg.id)

              return (
                <div key={pkg.id} className="p-3 bg-gray-800/40 rounded border border-gray-700/30">
                    <div className="flex items-start gap-3">
                    <div className="text-3xl">{renderIcon(pkg.icon)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold flex items-center gap-2">
                        {pkg.name}
                        {pkg.verified && <span className="text-blue-400">✓</span>}
                        {updateAvailable && <span className="text-orange-400 text-xs">⬆</span>}
                      </div>
                      <div className="text-xs text-gray-400">{pkg.description}</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {pkg.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="px-1 py-0.5 bg-gray-700/50 rounded text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 text-xs text-gray-500">
                        v{pkg.version} • {pkg.author} • {formatBytes(pkg.size)}
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-3">
                    {progress ? (
                      <div>
                        <div className="text-xs text-gray-400 mb-1">{progress.status}</div>
                        {progress.percent !== undefined && (
                          <div className="w-full bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all"
                              style={{ width: `${progress.percent}%` }}
                            />
                          </div>
                        )}
                      </div>
                    ) : installed ? (
                      <div className="flex gap-2">
                        {updateAvailable ? (
                          <button
                            className="flex-1 px-3 py-1 bg-orange-600 rounded text-sm hover:brightness-110"
                            onClick={() => handleUpdate(pkg.id)}
                          >
                            Update
                          </button>
                        ) : (
                          <span className="flex-1 px-3 py-1 bg-green-600/30 rounded text-sm text-center">
                            Installed ✓
                          </span>
                        )}
                        <button
                          className="px-3 py-1 bg-red-700/70 rounded text-sm hover:brightness-110"
                          onClick={() => handleUninstall(pkg.id)}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <button
                        className="w-full px-3 py-1 bg-green-600 rounded text-sm hover:brightness-110"
                        onClick={() => handleInstall(pkg)}
                      >
                        Install
                      </button>
                    )}
                  </div>
                </div>
              )
                })}
              </div>
            )}
          </>
        )}

        {/* Installed view */}
        {viewMode === 'installed' && !loading && (
          <div className="space-y-4">
            {/* System Apps */}
            {systemPackages.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-400 mb-2 uppercase tracking-wide">System Apps</h3>
                <div className="space-y-2">
                  {systemPackages.map(pkg => (
                    <div key={pkg.id} className="p-3 bg-gray-800/40 rounded border border-gray-700/30">
                        <div className="flex items-start gap-3">
                        <div className="text-2xl">{renderIcon(pkg.icon)}</div>
                        <div className="flex-1">
                          <div className="font-semibold flex items-center gap-2">
                            {pkg.name}
                            {pkg.verified && <span className="text-blue-400 text-xs">✓</span>}
                          </div>
                          <div className="text-xs text-gray-400">{pkg.description}</div>
                          <div className="mt-1 text-xs text-gray-500">
                            v{pkg.version} • Pre-installed • {formatBytes(pkg.size)}
                          </div>
                        </div>
                        <div className="px-3 py-1 bg-blue-900/30 rounded text-sm text-blue-300">
                          System App
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* User Installed Apps */}
            {installedPackages.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-400 mb-2 uppercase tracking-wide">User Installed</h3>
                <div className="space-y-2">
                  {installedPackages.map(pkg => {
                    const updateAvailable = hasUpdate(pkg.id)
                    return (
                      <div key={pkg.id} className="p-3 bg-gray-800/40 rounded border border-gray-700/30">
                          <div className="flex items-start gap-3">
                          <div className="text-2xl">{renderIcon(pkg.icon)}</div>
                          <div className="flex-1">
                            <div className="font-semibold flex items-center gap-2">
                              {pkg.name}
                              {updateAvailable && <span className="text-orange-400 text-xs">Update available</span>}
                            </div>
                            <div className="text-xs text-gray-400">{pkg.description}</div>
                            <div className="mt-1 text-xs text-gray-500">
                              v{pkg.version} • {pkg.source} • {formatBytes(pkg.size)}
                            </div>
                            {pkg.installDate && (
                              <div className="text-xs text-gray-500">
                                Installed: {new Date(pkg.installDate).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {(pkg.type === 'wasm' || pkg.type === 'wasi') && (
                              <button
                                className="px-3 py-1 bg-blue-600 rounded text-sm hover:brightness-110"
                                onClick={() => handleExecute(pkg)}
                              >
                                Run
                              </button>
                            )}
                            {updateAvailable && (
                              <button
                                className="px-3 py-1 bg-orange-600 rounded text-sm hover:brightness-110"
                                onClick={() => handleUpdate(pkg.id)}
                              >
                                Update
                              </button>
                            )}
                            <button
                              className="px-3 py-1 bg-red-700/70 rounded text-sm hover:brightness-110"
                              onClick={() => handleUninstall(pkg.id)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {installedPackages.length === 0 && (
              <div className="text-center text-gray-400 py-4">
                <p>No user-installed packages yet.</p>
                <p className="text-sm mt-2">Browse the store to install apps!</p>
              </div>
            )}
          </div>
        )}

        {/* Upload view */}
        {viewMode === 'upload' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-gray-800/40 rounded border border-gray-700/30 p-6">
              <h3 className="text-lg font-semibold mb-4">Upload Custom WASM Package</h3>
              <div className="space-y-4">
                <div className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".wasm,.wasi,.zip,.mapp"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="wasm-upload"
                  />
                  <label htmlFor="wasm-upload" className="cursor-pointer">
                    <div className="text-4xl mb-3">📦</div>
                    <div className="text-lg mb-2">Click to upload package</div>
                    <div className="text-sm text-gray-400">
                      Supports .wasm, .wasi, .zip (wasm-bindgen), or .mapp files
                    </div>
                  </label>
                </div>
                <div className="bg-blue-900/20 border border-blue-700/30 rounded p-4">
                  <div className="text-sm">
                    <div className="font-semibold mb-2">ℹ️ Upload Guidelines:</div>
                    <ul className="list-disc list-inside space-y-1 text-gray-300">
                      <li>Files are stored locally in IndexedDB</li>
                      <li>Maximum recommended size: 50MB</li>
                      <li>WASM binaries are automatically validated</li>
                      <li>You can upload multiple packages</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
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