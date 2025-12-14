/**
 * Package Storage Manager
 * Handles IndexedDB storage for installed packages and their binaries
 */

import { openDB, type IDBPDatabase } from 'idb'
import type { InstalledPackage, PackageManifest } from './types'

const DB_NAME = 'ZynqOS-packages'
const DB_VERSION = 1
const METADATA_STORE = 'package-metadata'
const BINARY_STORE = 'package-binaries'

let dbInstance: IDBPDatabase | null = null

/**
 * Initialize and get database instance
 */
async function getDB() {
  if (dbInstance) return dbInstance

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Store for package metadata
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        const metaStore = db.createObjectStore(METADATA_STORE, { keyPath: 'id' })
        metaStore.createIndex('type', 'type', { unique: false })
        metaStore.createIndex('source', 'source', { unique: false })
        metaStore.createIndex('status', 'status', { unique: false })
        metaStore.createIndex('installDate', 'installDate', { unique: false })
      }

      // Store for package binaries (separate for performance)
      if (!db.objectStoreNames.contains(BINARY_STORE)) {
        db.createObjectStore(BINARY_STORE) // key: packageId, value: Uint8Array
      }
    }
  })

  return dbInstance
}

/**
 * Save a complete package (metadata + binary)
 */
export async function savePackage(pkg: InstalledPackage, binary?: Uint8Array): Promise<void> {
  const db = await getDB()
  const tx = db.transaction([METADATA_STORE, BINARY_STORE], 'readwrite')

  // Save metadata (without binary data)
  const metadataToSave = { ...pkg }
  delete metadataToSave.binaryData
  metadataToSave.binaryStorageKey = pkg.id // Use package ID as binary key
  
  await tx.objectStore(METADATA_STORE).put(metadataToSave)

  // Save binary if provided
  if (binary) {
    await tx.objectStore(BINARY_STORE).put(binary, pkg.id)
  }

  await tx.done
  console.log(`[PackageStorage] Saved package: ${pkg.id} (${formatBytes(binary?.length || 0)})`)
}

/**
 * Get package metadata
 */
export async function getPackageMetadata(packageId: string): Promise<InstalledPackage | undefined> {
  const db = await getDB()
  const metadata = await db.get(METADATA_STORE, packageId)
  return metadata
}

/**
 * Get package binary
 */
export async function getPackageBinary(packageId: string): Promise<Uint8Array | undefined> {
  const db = await getDB()
  const binary = await db.get(BINARY_STORE, packageId)
  return binary
}

/**
 * Get complete package (metadata + binary)
 */
export async function getPackage(packageId: string): Promise<InstalledPackage | undefined> {
  const [metadata, binary] = await Promise.all([
    getPackageMetadata(packageId),
    getPackageBinary(packageId)
  ])

  if (!metadata) return undefined

  return {
    ...metadata,
    binaryData: binary
  }
}

/**
 * List all installed packages
 */
export async function listPackages(filterFn?: (pkg: InstalledPackage) => boolean): Promise<InstalledPackage[]> {
  const db = await getDB()
  let packages = await db.getAll(METADATA_STORE)
  
  if (filterFn) {
    packages = packages.filter(filterFn)
  }

  return packages
}

/**
 * Remove a package completely
 */
export async function removePackage(packageId: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction([METADATA_STORE, BINARY_STORE], 'readwrite')
  
  await tx.objectStore(METADATA_STORE).delete(packageId)
  await tx.objectStore(BINARY_STORE).delete(packageId)
  
  await tx.done
  console.log(`[PackageStorage] Removed package: ${packageId}`)
}

/**
 * Update package metadata (without changing binary)
 */
export async function updatePackageMetadata(packageId: string, updates: Partial<InstalledPackage>): Promise<void> {
  const db = await getDB()
  const existing = await db.get(METADATA_STORE, packageId)
  
  if (!existing) {
    throw new Error(`Package ${packageId} not found`)
  }

  const updated = { ...existing, ...updates }
  await db.put(METADATA_STORE, updated)
}

/**
 * Search packages by various criteria
 */
export async function searchPackages(
  query: string,
  options?: {
    searchFields?: ('name' | 'description' | 'tags')[]
    caseSensitive?: boolean
  }
): Promise<InstalledPackage[]> {
  const packages = await listPackages()
  const searchFields = options?.searchFields || ['name', 'description', 'tags']
  const caseSensitive = options?.caseSensitive || false
  
  const searchTerm = caseSensitive ? query : query.toLowerCase()

  return packages.filter(pkg => {
    for (const field of searchFields) {
      let value: string
      
      if (field === 'tags') {
        value = pkg.tags.join(' ')
      } else {
        value = pkg[field] || ''
      }

      const compareValue = caseSensitive ? value : value.toLowerCase()
      if (compareValue.includes(searchTerm)) {
        return true
      }
    }
    return false
  })
}

/**
 * Get storage statistics
 */
export async function getStorageStats(): Promise<{
  totalPackages: number
  totalSize: number
  byType: Record<string, number>
  bySource: Record<string, number>
}> {
  const packages = await listPackages()
  const db = await getDB()
  
  let totalSize = 0
  const byType: Record<string, number> = {}
  const bySource: Record<string, number> = {}

  for (const pkg of packages) {
    // Count by type
    byType[pkg.type] = (byType[pkg.type] || 0) + 1
    
    // Count by source
    bySource[pkg.source] = (bySource[pkg.source] || 0) + 1
    
    // Calculate total size
    const binary = await db.get(BINARY_STORE, pkg.id)
    if (binary) {
      totalSize += binary.length
    }
  }

  return {
    totalPackages: packages.length,
    totalSize,
    byType,
    bySource
  }
}

/**
 * Clear all packages (dangerous!)
 */
export async function clearAllPackages(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction([METADATA_STORE, BINARY_STORE], 'readwrite')
  
  await tx.objectStore(METADATA_STORE).clear()
  await tx.objectStore(BINARY_STORE).clear()
  
  await tx.done
  console.warn('[PackageStorage] Cleared all packages!')
}

/**
 * Check if a package exists
 */
export async function packageExists(packageId: string): Promise<boolean> {
  const db = await getDB()
  const count = await db.count(METADATA_STORE, packageId)
  return count > 0
}

/**
 * Export package for sharing
 */
export async function exportPackage(packageId: string): Promise<Blob> {
  const pkg = await getPackage(packageId)
  if (!pkg) {
    throw new Error(`Package ${packageId} not found`)
  }

  // Create a package bundle
  const bundle = {
    metadata: {
      ...pkg,
      binaryData: undefined,
      binaryStorageKey: undefined
    },
    binary: pkg.binaryData ? Array.from(pkg.binaryData) : null
  }

  return new Blob([JSON.stringify(bundle)], { type: 'application/json' })
}

/**
 * Import package from exported bundle
 */
export async function importPackage(bundleBlob: Blob): Promise<InstalledPackage> {
  const text = await bundleBlob.text()
  const bundle = JSON.parse(text)
  
  const binary = bundle.binary ? new Uint8Array(bundle.binary) : undefined
  const metadata: InstalledPackage = {
    ...bundle.metadata,
    installDate: new Date().toISOString(),
    status: 'installed'
  }

  await savePackage(metadata, binary)
  return metadata
}

// Utility functions
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}
