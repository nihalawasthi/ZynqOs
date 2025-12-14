/**
 * Package Management Types for ZynqOS
 * Inspired by AUR (Arch User Repository) model
 */

export type PackageType = 'wasm' | 'wasi' | 'wasm-bindgen' | 'web-app' | 'native'

export type PackageStatus = 'available' | 'installed' | 'updating' | 'broken'

export type PackageSource = 'official' | 'community' | 'user-uploaded'

/**
 * Package metadata structure
 */
export interface PackageManifest {
  // Basic Info
  id: string                    // Unique package identifier
  name: string                  // Display name
  description: string           // Short description
  longDescription?: string      // Detailed description
  icon?: string                 // Emoji or data URI
  version: string               // Semantic version
  
  // Package Details
  type: PackageType             // Type of package
  source: PackageSource         // Where it came from
  author: string                // Author/maintainer
  license?: string              // License type (MIT, GPL, etc.)
  homepage?: string             // Project homepage
  repository?: string           // Source code repository
  
  // Technical
  tags: string[]                // For search/filtering
  dependencies?: string[]       // Other package IDs required
  size: number                  // Size in bytes
  checksum?: string             // SHA-256 hash for verification
  
  // Installation
  downloadUrl?: string          // URL to download from (for official packages)
  installDate?: string          // ISO timestamp of installation
  lastUpdated: string           // ISO timestamp of last update
  
  // Runtime
  entrypoint?: string           // Main file to execute
  permissions?: PackagePermissions  // Required permissions
  jsFiles?: { [filename: string]: string }  // For wasm-bindgen: companion JS files
  tsFiles?: { [filename: string]: string }  // TypeScript declaration files
  assets?: { [filename: string]: string }   // Base64-encoded assets (images, etc.)
  
  // Metadata
  downloads?: number            // Download count
  rating?: number               // User rating (0-5)
  verified?: boolean            // Official verification badge
  isSystemApp?: boolean         // Pre-installed system app
}

/**
 * Permissions that a package might require
 */
export interface PackagePermissions {
  filesystem?: 'read' | 'write' | 'full'
  network?: boolean
  storage?: boolean
  wasi?: boolean
}

/**
 * Local package storage structure
 */
export interface InstalledPackage extends PackageManifest {
  status: PackageStatus
  binaryData?: Uint8Array      // The actual WASM binary
  binaryStorageKey?: string     // Key in IndexedDB for large binaries
  configData?: Record<string, any>  // User configuration
  jsFiles?: { [filename: string]: string }  // Stored JS glue code for wasm-bindgen
  tsFiles?: { [filename: string]: string }  // TypeScript declaration files
  assets?: { [filename: string]: string }   // Base64-encoded assets
}

/**
 * Package registry/repository configuration
 */
export interface PackageRegistry {
  name: string                  // Registry name (e.g., "Official", "Community")
  url: string                   // Manifest URL
  enabled: boolean              // Whether to fetch from this registry
  priority: number              // Higher priority registries checked first
  verified: boolean             // Official/trusted registry
}

/**
 * Package search filters
 */
export interface PackageSearchOptions {
  query?: string                // Text search
  tags?: string[]               // Filter by tags
  type?: PackageType            // Filter by type
  source?: PackageSource        // Filter by source
  installed?: boolean           // Show only installed
}

/**
 * Package installation result
 */
export interface InstallResult {
  success: boolean
  packageId: string
  error?: string
  installedPackage?: InstalledPackage
}

/**
 * Package upload data
 */
export interface PackageUpload {
  file: File                    // WASM file
  metadata: Partial<PackageManifest>  // User-provided metadata
}
