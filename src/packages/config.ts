/**
 * Package Manager Configuration
 * Centralized settings for the package management system
 */

export const PACKAGE_CONFIG = {
  // Storage
  storage: {
    dbName: 'ZynqOS-packages',
    dbVersion: 1,
    maxPackageSize: 100 * 1024 * 1024, // 100MB
    warnPackageSize: 50 * 1024 * 1024, // 50MB
  },

  // Cache
  cache: {
    ttl: 5 * 60 * 1000, // 5 minutes
    storageKey: 'zynqos_registry_cache',
  },

  // Registries
  registries: {
    storageKey: 'zynqos_package_registries',
    defaultRegistries: [
      {
        name: 'Official ZynqOS',
        url: '/apps/store-manifest.json',
        enabled: true,
        priority: 100,
        verified: true,
      },
      {
        name: 'Community',
        url: 'https://raw.githubusercontent.com/zynqos/community-packages/main/manifest.json',
        enabled: false,
        priority: 50,
        verified: false,
      },
    ],
  },

  // Validation
  validation: {
    wasmMagicNumber: [0x00, 0x61, 0x73, 0x6d],
    wasmVersion: 1,
    requiredFields: ['id', 'name', 'description', 'version', 'type', 'author'],
    idPattern: /^[a-z0-9_-]+$/,
    versionPattern: /^\d+\.\d+\.\d+/,
  },

  // Security
  security: {
    allowedTypes: ['wasm', 'wasi', 'web-app', 'native'],
    trustedSources: ['official'],
    checksumAlgorithm: 'SHA-256',
    warnOnPermissions: ['filesystem:full', 'network'],
  },

  // UI
  ui: {
    defaultView: 'browse' as const,
    packagesPerPage: 20,
    searchDebounce: 300, // ms
    installTimeout: 60000, // 60 seconds
    maxTags: 10,
  },

  // Download
  download: {
    timeout: 60000, // 60 seconds
    retries: 3,
    retryDelay: 1000, // 1 second
    chunkSize: 1024 * 1024, // 1MB
  },

  // Features
  features: {
    enableUpload: true,
    enableExport: true,
    enableImport: true,
    enableRatings: false, // Future feature
    enableReviews: false, // Future feature
    enableDependencies: false, // Future feature
    enableSandboxing: false, // Future feature
  },

  // Notifications
  notifications: {
    checkUpdatesOnStartup: true,
    updateCheckInterval: 24 * 60 * 60 * 1000, // 24 hours
    showInstallProgress: true,
    showSuccessMessages: true,
  },

  // Debug
  debug: {
    enableLogging: true,
    logLevel: 'info' as 'debug' | 'info' | 'warn' | 'error',
    logPrefix: '[PackageManager]',
  },
} as const

// Type exports
export type PackageConfig = typeof PACKAGE_CONFIG
export type ViewMode = typeof PACKAGE_CONFIG.ui.defaultView
export type LogLevel = typeof PACKAGE_CONFIG.debug.logLevel

// Helper functions
export function isValidPackageId(id: string): boolean {
  return PACKAGE_CONFIG.validation.idPattern.test(id)
}

export function isValidVersion(version: string): boolean {
  return PACKAGE_CONFIG.validation.versionPattern.test(version)
}

export function isTrustedSource(source: string): boolean {
  return PACKAGE_CONFIG.security.trustedSources.includes(source as any)
}

export function shouldWarnOnPermission(permission: string): boolean {
  return PACKAGE_CONFIG.security.warnOnPermissions.includes(permission as any)
}

export function formatPackageSize(bytes: number): string {
  const { maxPackageSize, warnPackageSize } = PACKAGE_CONFIG.storage
  if (bytes > maxPackageSize) {
    return `${formatBytes(bytes)} ⚠️ Too large`
  } else if (bytes > warnPackageSize) {
    return `${formatBytes(bytes)} ⚠️`
  }
  return formatBytes(bytes)
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

// Export singleton configuration
export default PACKAGE_CONFIG
