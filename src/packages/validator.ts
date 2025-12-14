/**
 * Package Validator
 * Validates package integrity, security, and compatibility
 */

import type { PackageManifest, InstalledPackage } from './types'

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validate package manifest
 */
export function validateManifest(manifest: Partial<PackageManifest>): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Required fields
  if (!manifest.id) errors.push('Missing required field: id')
  if (!manifest.name) errors.push('Missing required field: name')
  if (!manifest.description) errors.push('Missing required field: description')
  if (!manifest.version) errors.push('Missing required field: version')
  if (!manifest.type) errors.push('Missing required field: type')
  if (!manifest.author) errors.push('Missing required field: author')
  if (!manifest.tags || manifest.tags.length === 0) {
    warnings.push('No tags specified')
  }

  // Validate ID format (alphanumeric, hyphens, underscores)
  if (manifest.id && !/^[a-z0-9_-]+$/.test(manifest.id)) {
    errors.push('Invalid ID format (use lowercase letters, numbers, hyphens, underscores)')
  }

  // Validate version format (semantic versioning)
  if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    warnings.push('Version should follow semantic versioning (e.g., 1.0.0)')
  }

  // Validate URLs
  if (manifest.downloadUrl && !isValidUrl(manifest.downloadUrl)) {
    errors.push('Invalid download URL')
  }
  if (manifest.homepage && !isValidUrl(manifest.homepage)) {
    warnings.push('Invalid homepage URL')
  }
  if (manifest.repository && !isValidUrl(manifest.repository)) {
    warnings.push('Invalid repository URL')
  }

  // Validate package type
  const validTypes = ['wasm', 'wasi', 'web-app', 'native']
  if (manifest.type && !validTypes.includes(manifest.type)) {
    errors.push(`Invalid package type. Must be one of: ${validTypes.join(', ')}`)
  }

  // Validate size
  if (manifest.size !== undefined) {
    if (manifest.size < 0) {
      errors.push('Package size cannot be negative')
    }
    if (manifest.size > 100 * 1024 * 1024) { // 100MB
      warnings.push('Package size exceeds 100MB - may cause performance issues')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Validate WASM binary format
 */
export async function validateWasmBinary(binary: Uint8Array): Promise<ValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  try {
    // Check minimum size
    if (binary.length < 8) {
      errors.push('Binary is too small to be a valid WASM file')
      return { valid: false, errors, warnings }
    }

    // Check magic number (0x00 0x61 0x73 0x6D)
    if (binary[0] !== 0x00 || binary[1] !== 0x61 || binary[2] !== 0x73 || binary[3] !== 0x6D) {
      errors.push('Invalid WASM magic number - not a WebAssembly file')
      return { valid: false, errors, warnings }
    }

    // Check version (current version is 1)
    const version = binary[4] | (binary[5] << 8) | (binary[6] << 16) | (binary[7] << 24)
    if (version !== 1) {
      warnings.push(`WASM version ${version} detected - may not be compatible`)
    }

    // Try to compile (validates structure)
    // @ts-ignore - Uint8Array is compatible with BufferSource
    await WebAssembly.compile(binary)

    // Check size
    if (binary.length > 50 * 1024 * 1024) { // 50MB
      warnings.push('Large WASM binary (>50MB) - may cause slow loading')
    }

  } catch (error) {
    errors.push(`WASM compilation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Validate checksum
 */
export async function validateChecksum(
  binary: Uint8Array,
  expectedChecksum: string
): Promise<ValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  try {
    // @ts-ignore - Uint8Array is compatible with BufferSource
    const hashBuffer = await crypto.subtle.digest('SHA-256', binary)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const actualChecksum = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    if (actualChecksum !== expectedChecksum) {
      errors.push('Checksum mismatch - file may be corrupted or tampered with')
    }
  } catch (error) {
    errors.push(`Checksum validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Check for security issues
 */
export function checkSecurity(manifest: PackageManifest, binary?: Uint8Array): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check for suspicious permissions
  if (manifest.permissions) {
    if (manifest.permissions.filesystem === 'full') {
      warnings.push('Package requests full filesystem access')
    }
    if (manifest.permissions.network) {
      warnings.push('Package requests network access')
    }
  }

  // Check source
  if (manifest.source === 'user-uploaded') {
    warnings.push('User-uploaded package - not verified by official sources')
  } else if (manifest.source === 'community' && !manifest.verified) {
    warnings.push('Community package - use at your own risk')
  }

  // Check for missing security fields
  if (!manifest.checksum && binary) {
    warnings.push('No checksum provided - integrity cannot be verified')
  }

  // Check license
  if (!manifest.license) {
    warnings.push('No license specified')
  }

  // Check for suspicious URLs
  if (manifest.downloadUrl && manifest.downloadUrl.startsWith('http://')) {
    warnings.push('Download URL uses insecure HTTP protocol')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Check dependencies
 */
export async function checkDependencies(
  manifest: PackageManifest,
  installedPackages: InstalledPackage[]
): Promise<ValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  if (manifest.dependencies && manifest.dependencies.length > 0) {
    const installedIds = new Set(installedPackages.map(p => p.id))
    
    for (const depId of manifest.dependencies) {
      if (!installedIds.has(depId)) {
        errors.push(`Missing dependency: ${depId}`)
      }
    }

    if (manifest.dependencies.length > 10) {
      warnings.push('Package has many dependencies - installation may take longer')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Comprehensive package validation
 */
export async function validatePackage(
  manifest: PackageManifest,
  binary?: Uint8Array,
  installedPackages?: InstalledPackage[]
): Promise<ValidationResult> {
  const allErrors: string[] = []
  const allWarnings: string[] = []

  // Validate manifest
  const manifestValidation = validateManifest(manifest)
  allErrors.push(...manifestValidation.errors)
  allWarnings.push(...manifestValidation.warnings)

  // Validate binary if provided
  if (binary && (manifest.type === 'wasm' || manifest.type === 'wasi')) {
    const binaryValidation = await validateWasmBinary(binary)
    allErrors.push(...binaryValidation.errors)
    allWarnings.push(...binaryValidation.warnings)

    // Validate checksum
    if (manifest.checksum) {
      const checksumValidation = await validateChecksum(binary, manifest.checksum)
      allErrors.push(...checksumValidation.errors)
      allWarnings.push(...checksumValidation.warnings)
    }
  }

  // Check security
  const securityCheck = checkSecurity(manifest, binary)
  allErrors.push(...securityCheck.errors)
  allWarnings.push(...securityCheck.warnings)

  // Check dependencies
  if (installedPackages) {
    const depsCheck = await checkDependencies(manifest, installedPackages)
    allErrors.push(...depsCheck.errors)
    allWarnings.push(...depsCheck.warnings)
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings
  }
}

// Helper functions
function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}
