/**
 * Package Registry Manager
 * Handles fetching and managing package repositories (like AUR)
 */

import type { PackageManifest, PackageRegistry, PackageSearchOptions } from './types'

// Default registries
const DEFAULT_REGISTRIES: PackageRegistry[] = [
  {
    name: 'Official ZynqOS',
    url: '/apps/store-manifest.json',
    enabled: true,
    priority: 100,
    verified: true
  },
  {
    name: 'ZUR (ZynqOS User Repository)',
    url: 'https://raw.githubusercontent.com/nihalawasthi/ZynqOS-User-Repository/main/manifest.json',
    enabled: true, // Enable ZUR by default - community packages!
    priority: 80,
    verified: true // Verified community repository
  },
  {
    name: 'Community',
    url: 'https://raw.githubusercontent.com/zynqos/community-packages/main/manifest.json',
    enabled: false, // Disabled by default until community repo exists
    priority: 50,
    verified: false
  }
]

const REGISTRY_STORAGE_KEY = 'zynqos_package_registries'
const CACHE_KEY = 'zynqos_registry_cache'
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

type CachedRegistry = {
  registry: PackageRegistry
  packages: PackageManifest[]
  timestamp: number
}

/**
 * Registry Manager Class
 */
export class RegistryManager {
  private registries: PackageRegistry[] = []
  private cache = new Map<string, CachedRegistry>()

  constructor() {
    this.loadRegistries()
    this.loadCache()
  }

  /**
   * Load registries from localStorage
   */
  private loadRegistries() {
    try {
      const stored = localStorage.getItem(REGISTRY_STORAGE_KEY)
      this.registries = stored ? JSON.parse(stored) : [...DEFAULT_REGISTRIES]
    } catch (e) {
      console.error('[RegistryManager] Failed to load registries:', e)
      this.registries = [...DEFAULT_REGISTRIES]
    }
  }

  /**
   * Save registries to localStorage
   */
  private saveRegistries() {
    try {
      localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(this.registries))
    } catch (e) {
      console.error('[RegistryManager] Failed to save registries:', e)
    }
  }

  /**
   * Load cache from localStorage
   */
  private loadCache() {
    try {
      const stored = localStorage.getItem(CACHE_KEY)
      if (stored) {
        const cached: CachedRegistry[] = JSON.parse(stored)
        cached.forEach(item => {
          this.cache.set(item.registry.url, item)
        })
      }
    } catch (e) {
      console.error('[RegistryManager] Failed to load cache:', e)
    }
  }

  /**
   * Save cache to localStorage
   */
  private saveCache() {
    try {
      const cacheArray = Array.from(this.cache.values())
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheArray))
    } catch (e) {
      console.error('[RegistryManager] Failed to save cache:', e)
    }
  }

  /**
   * Get all registries
   */
  getRegistries(): PackageRegistry[] {
    return [...this.registries]
  }

  /**
   * Add a new registry
   */
  addRegistry(registry: Omit<PackageRegistry, 'priority'>): void {
    const newRegistry: PackageRegistry = {
      ...registry,
      priority: 0 // User registries get lowest priority
    }
    this.registries.push(newRegistry)
    this.saveRegistries()
  }

  /**
   * Remove a registry
   */
  removeRegistry(url: string): void {
    this.registries = this.registries.filter(r => r.url !== url)
    this.cache.delete(url)
    this.saveRegistries()
    this.saveCache()
  }

  /**
   * Update registry settings
   */
  updateRegistry(url: string, updates: Partial<PackageRegistry>): void {
    const index = this.registries.findIndex(r => r.url === url)
    if (index !== -1) {
      this.registries[index] = { ...this.registries[index], ...updates }
      this.saveRegistries()
    }
  }

  /**
   * Fetch packages from a specific registry
   */
  async fetchRegistry(registry: PackageRegistry, forceRefresh = false): Promise<PackageManifest[]> {
    // Check cache first
    if (!forceRefresh) {
      const cached = this.cache.get(registry.url)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`[RegistryManager] Using cached data for ${registry.name}`)
        return cached.packages
      }
    }

    try {
      console.log(`[RegistryManager] Fetching ${registry.name} from ${registry.url}`)
      const response = await fetch(registry.url)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const json = await response.json()
      // Allow both array manifest and { packages: [...] }
      const packages: PackageManifest[] = Array.isArray(json)
        ? json
        : (Array.isArray(json?.packages) ? json.packages : [])

      if (!Array.isArray(packages)) {
        throw new Error('Invalid manifest format: expected array or { packages: [] }')
      }
      
      // Validate and enhance packages
      const validatedPackages = packages.map(pkg => ({
        ...pkg,
        source: registry.verified ? 'official' as const : 'community' as const,
        verified: registry.verified
      }))

      // Update cache
      this.cache.set(registry.url, {
        registry,
        packages: validatedPackages,
        timestamp: Date.now()
      })
      this.saveCache()

      return validatedPackages
    } catch (error) {
      console.error(`[RegistryManager] Failed to fetch ${registry.name}:`, error)
      
      // Return cached data if available, even if expired
      const cached = this.cache.get(registry.url)
      if (cached) {
        console.warn(`[RegistryManager] Using stale cache for ${registry.name}`)
        return cached.packages
      }
      
      throw error
    }
  }

  /**
   * Fetch packages from all enabled registries
   */
  async fetchAllPackages(forceRefresh = false): Promise<PackageManifest[]> {
    const enabledRegistries = this.registries
      .filter(r => r.enabled)
      .sort((a, b) => b.priority - a.priority) // Higher priority first

    const results = await Promise.allSettled(
      enabledRegistries.map(r => this.fetchRegistry(r, forceRefresh))
    )

    const allPackages: PackageManifest[] = []
    const seenIds = new Set<string>()

    // Merge packages, preferring higher priority registries for duplicates
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        result.value.forEach(pkg => {
          if (!seenIds.has(pkg.id)) {
            seenIds.add(pkg.id)
            allPackages.push(pkg)
          } else {
            console.warn(`[RegistryManager] Duplicate package ID: ${pkg.id} from ${enabledRegistries[index].name}`)
          }
        })
      } else {
        console.error(`[RegistryManager] Registry fetch failed:`, result.reason)
      }
    })

    return allPackages
  }

  /**
   * Search packages across all registries
   */
  async searchPackages(options: PackageSearchOptions): Promise<PackageManifest[]> {
    let packages = await this.fetchAllPackages()

    // Apply filters
    if (options.query) {
      const query = options.query.toLowerCase()
      packages = packages.filter(pkg =>
        pkg.name.toLowerCase().includes(query) ||
        pkg.description.toLowerCase().includes(query) ||
        pkg.tags.some(tag => tag.toLowerCase().includes(query))
      )
    }

    if (options.tags && options.tags.length > 0) {
      packages = packages.filter(pkg =>
        options.tags!.some(tag => pkg.tags.includes(tag))
      )
    }

    if (options.type) {
      packages = packages.filter(pkg => pkg.type === options.type)
    }

    if (options.source) {
      packages = packages.filter(pkg => pkg.source === options.source)
    }

    return packages
  }

  /**
   * Get a specific package by ID
   */
  async getPackage(packageId: string): Promise<PackageManifest | undefined> {
    const allPackages = await this.fetchAllPackages()
    return allPackages.find(pkg => pkg.id === packageId)
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cache.clear()
    localStorage.removeItem(CACHE_KEY)
  }

  /**
   * Reset registries to defaults
   */
  resetToDefaults(): void {
    this.registries = [...DEFAULT_REGISTRIES]
    this.saveRegistries()
    this.clearCache()
  }
}

// Export singleton instance
export const registryManager = new RegistryManager()
