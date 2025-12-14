/**
 * ZynqOS Package Manager
 * Main entry point for the package management system
 */

// Export types
export * from './types'

// Export storage functions
export * from './storage'

// Export registry manager
export { registryManager, RegistryManager } from './registry'

// Export package manager functions
export * from './manager'

// Export validator functions
export * from './validator'

/**
 * Package Manager System Overview
 * 
 * This package management system provides AUR-like functionality for ZynqOS:
 * 
 * 1. **Storage** (storage.ts)
 *    - IndexedDB-based storage for packages and binaries
 *    - Separate stores for metadata and large binaries
 *    - Efficient querying and search capabilities
 * 
 * 2. **Registry** (registry.ts)
 *    - Fetches packages from multiple registries
 *    - Caching mechanism for performance
 *    - Support for official, community, and user registries
 * 
 * 3. **Manager** (manager.ts)
 *    - Install packages from registries
 *    - Upload custom WASM files
 *    - Update and uninstall packages
 *    - Execute WASM packages
 * 
 * 4. **Validator** (validator.ts)
 *    - Validate package manifests
 *    - Verify WASM binaries
 *    - Checksum validation
 *    - Security checks
 * 
 * 5. **Types** (types.ts)
 *    - TypeScript definitions for all data structures
 * 
 * Usage Example:
 * ```typescript
 * import { installPackage, uploadPackage, getInstalledPackages } from './packages'
 * 
 * // Install from registry
 * const result = await installPackage('calculator-wasm', (status, percent) => {
 *   console.log(`${status}: ${percent}%`)
 * })
 * 
 * // Upload custom package
 * const uploadResult = await uploadPackage({
 *   file: wasmFile,
 *   metadata: {
 *     name: 'My App',
 *     description: 'Custom application',
 *     version: '1.0.0',
 *     type: 'wasm'
 *   }
 * })
 * 
 * // List installed packages
 * const installed = await getInstalledPackages()
 * ```
 */

// Version
export const PACKAGE_MANAGER_VERSION = '1.0.0'
