/**
 * Package Manager - Main interface for package operations
 * Handles installation, removal, updates, and execution of packages
 */

import type {
  PackageManifest,
  InstalledPackage,
  InstallResult,
  PackageUpload,
  PackageType
} from './types'
import {
  savePackage,
  getPackage,
  getPackageMetadata,
  getPackageBinary,
  listPackages,
  removePackage,
  updatePackageMetadata,
  packageExists
} from './storage'
import { uint8ArrayToBase64 } from '../utils/encoding'
import { registryManager } from './registry'

/**
 * Calculate SHA-256 checksum
 */
async function calculateChecksum(data: Uint8Array): Promise<string> {
  // @ts-ignore - Uint8Array is compatible with BufferSource
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Validate WASM binary
 */
async function validateWasmBinary(binary: Uint8Array): Promise<boolean> {
  try {
    // Check magic number (0x00 0x61 0x73 0x6D)
    if (binary.length < 4) return false
    if (binary[0] !== 0x00 || binary[1] !== 0x61 || binary[2] !== 0x73 || binary[3] !== 0x6D) {
      return false
    }
    
    // Try to compile (doesn't instantiate)
    // @ts-ignore - Uint8Array is compatible with BufferSource
    await WebAssembly.compile(binary)
    return true
  } catch (e) {
    console.error('[PackageManager] WASM validation failed:', e)
    return false
  }
}

/**
 * Download package binary from URL
 */
async function downloadBinary(url: string, onProgress?: (percent: number) => void): Promise<Uint8Array> {
  const response = await fetch(url, {
    mode: 'cors',
    redirect: 'follow',
    referrerPolicy: 'no-referrer'
  })
  
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  }

  const contentLength = response.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0

  if (!response.body) {
    throw new Error('Response body is null')
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedLength = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    chunks.push(value)
    receivedLength += value.length

    if (onProgress && total > 0) {
      onProgress((receivedLength / total) * 100)
    }
  }

  // Concatenate chunks
  const binary = new Uint8Array(receivedLength)
  let position = 0
  for (const chunk of chunks) {
    binary.set(chunk, position)
    position += chunk.length
  }

  return binary
}

/**
 * Install a package from registry
 */
export async function installPackage(
  packageId: string,
  onProgress?: (status: string, percent?: number) => void
): Promise<InstallResult> {
  try {
    // Check if already installed
    if (await packageExists(packageId)) {
      return {
        success: false,
        packageId,
        error: 'Package already installed'
      }
    }

    onProgress?.('Fetching package metadata...', 0)

    // Get package from registry
    const manifest = await registryManager.getPackage(packageId)
    if (!manifest) {
      return {
        success: false,
        packageId,
        error: 'Package not found in registry'
      }
    }

    // Check if it's a system app (shouldn't be installable)
    if (manifest.isSystemApp) {
      return {
        success: false,
        packageId,
        error: 'System apps cannot be installed - they are pre-installed'
      }
    }

    // For web-app type, allow install without a binary download
    let binary: Uint8Array = new Uint8Array()
    if (manifest.type === 'web-app') {
      onProgress?.('Registering web app...', 10)
    } else {
      // Download binary for wasm/wasi and other types
      if (!manifest.downloadUrl) {
        return {
          success: false,
          packageId,
          error: 'Package has no download URL'
        }
      }

      onProgress?.('Downloading package...', 10)
      binary = await downloadBinary(manifest.downloadUrl, (percent) => {
        onProgress?.('Downloading...', 10 + (percent * 0.5))
      })
    }

    // If wasm-bindgen, unzip and extract wasm/js assets
    let jsFiles: { [filename: string]: string } | undefined
    let tsFiles: { [filename: string]: string } | undefined
    let assets: { [filename: string]: string } | undefined
    if (manifest.type === 'wasm-bindgen') {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(binary)

      let wasmFile: Uint8Array | undefined
      const jsFilesMap: { [filename: string]: string } = {}
      const tsFilesMap: { [filename: string]: string } = {}
      const assetsMap: { [filename: string]: string } = {}
      let wasmName = ''

      for (const [filename, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue
        const basename = filename.split('/').pop() || filename

        if (basename.endsWith('.wasm')) {
          wasmFile = await entry.async('uint8array')
          wasmName = basename
        } else if (basename.endsWith('.js')) {
          jsFilesMap[basename] = await entry.async('text')
        } else if (basename.endsWith('.d.ts') || basename.endsWith('.ts')) {
          tsFilesMap[basename] = await entry.async('text')
        } else if (basename.match(/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i)) {
          const arrayBuffer = await entry.async('arraybuffer')
          const base64 = uint8ArrayToBase64(new Uint8Array(arrayBuffer))
          assetsMap[basename] = base64
        } else {
          try {
            const text = await entry.async('text')
            assetsMap[basename] = text
          } catch {
            const arrayBuffer = await entry.async('arraybuffer')
            const base64 = uint8ArrayToBase64(new Uint8Array(arrayBuffer))
            assetsMap[basename] = base64
          }
        }
      }

      if (!wasmFile) {
        return { success: false, packageId, error: 'ZIP must contain a .wasm file' }
      }
      if (Object.keys(jsFilesMap).length === 0) {
        return { success: false, packageId, error: 'ZIP must contain at least one .js file (wasm-bindgen glue code)' }
      }

      console.log('[PackageManager] Extracted wasm-bindgen ZIP', { wasm: wasmName, js: Object.keys(jsFilesMap) })
      binary = wasmFile
      jsFiles = jsFilesMap
      tsFiles = Object.keys(tsFilesMap).length ? tsFilesMap : undefined
      assets = Object.keys(assetsMap).length ? assetsMap : undefined
    }

    // Validate WASM if applicable
    if (manifest.type === 'wasm' || manifest.type === 'wasi' || manifest.type === 'wasm-bindgen') {
      onProgress?.('Validating WASM binary...', 70)
      const isValid = await validateWasmBinary(binary)
      if (!isValid) {
        return {
          success: false,
          packageId,
          error: 'Invalid WASM binary'
        }
      }
    }

    // Verify checksum if provided
    if (manifest.checksum) {
      onProgress?.('Verifying checksum...', 80)
      const actualChecksum = await calculateChecksum(binary)
      if (actualChecksum !== manifest.checksum) {
        return {
          success: false,
          packageId,
          error: 'Checksum mismatch - possible corruption'
        }
      }
    }

    // Create installed package
    const installedPackage: InstalledPackage = {
      ...manifest,
      status: 'installed',
      installDate: new Date().toISOString(),
      size: binary.length,
      jsFiles,
      tsFiles,
      assets
    }

    onProgress?.('Saving package...', 90)
    await savePackage(installedPackage, binary)

    onProgress?.('Installation complete!', 100)
    console.log(`[PackageManager] Installed ${packageId} (${formatBytes(binary.length)})`)

    // Dispatch event for UI updates
    window.dispatchEvent(new CustomEvent('zynqos:package-installed', { detail: { packageId } }))

    return {
      success: true,
      packageId,
      installedPackage
    }
  } catch (error) {
    console.error('[PackageManager] Installation failed:', error)
    return {
      success: false,
      packageId,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Upload and install a user package
 */
export async function uploadPackage(upload: PackageUpload): Promise<InstallResult> {
  try {
    const { file, metadata } = upload

    // Generate ID if not provided
    const packageId = metadata.id || `user-${Date.now()}-${file.name.replace(/\.[^.]+$/, '')}`

    // Check if already exists
    if (await packageExists(packageId)) {
      return {
        success: false,
        packageId,
        error: 'Package ID already exists'
      }
    }

    let binary: Uint8Array
    let jsFiles: { [filename: string]: string } | undefined
    let packageType: PackageType = metadata.type || 'wasm'

    // Handle ZIP files for wasm-bindgen packages
    if (file.name.endsWith('.zip')) {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(file)
      
      // Extract all files
      let wasmFile: Uint8Array | undefined
      const jsFilesMap: { [filename: string]: string } = {}
      const tsFilesMap: { [filename: string]: string } = {}
      const assetsMap: { [filename: string]: string } = {}
      let wasmName = ''
      
      for (const [filename, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue
        
        const basename = filename.split('/').pop() || filename
        
        if (basename.endsWith('.wasm')) {
          wasmFile = await entry.async('uint8array')
          wasmName = basename
        } else if (basename.endsWith('.js')) {
          jsFilesMap[basename] = await entry.async('text')
        } else if (basename.endsWith('.d.ts') || basename.endsWith('.ts')) {
          tsFilesMap[basename] = await entry.async('text')
        } else if (basename.match(/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i)) {
          // Store assets as base64
          const arrayBuffer = await entry.async('arraybuffer')
          const base64 = uint8ArrayToBase64(new Uint8Array(arrayBuffer))
          assetsMap[basename] = base64
        } else {
          // Store other text files as-is
          try {
            const text = await entry.async('text')
            assetsMap[basename] = text
          } catch {
            // Binary file, store as base64
            const arrayBuffer = await entry.async('arraybuffer')
            const base64 = uint8ArrayToBase64(new Uint8Array(arrayBuffer))
            assetsMap[basename] = base64
          }
        }
      }
      
      // Validate required files
      if (!wasmFile) {
        return {
          success: false,
          packageId,
          error: 'ZIP must contain a .wasm file'
        }
      }
      
      if (Object.keys(jsFilesMap).length === 0) {
        return {
          success: false,
          packageId,
          error: 'ZIP must contain at least one .js file (wasm-bindgen glue code)'
        }
      }
      
      binary = wasmFile
      jsFiles = jsFilesMap
      packageType = 'wasm-bindgen'
      
      console.log(`[PackageManager] Extracted from ZIP:`, {
        wasm: wasmName,
        jsFiles: Object.keys(jsFilesMap),
        tsFiles: Object.keys(tsFilesMap),
        assets: Object.keys(assetsMap)
      })
      
      // Store TS files and assets in metadata (will be added below)
      ;(metadata as any).tsFiles = Object.keys(tsFilesMap).length > 0 ? tsFilesMap : undefined
      ;(metadata as any).assets = Object.keys(assetsMap).length > 0 ? assetsMap : undefined
    } else {
      // Single WASM file
      const arrayBuffer = await file.arrayBuffer()
      binary = new Uint8Array(arrayBuffer)
    }

    // Validate WASM if applicable
    if (packageType === 'wasm' || packageType === 'wasi' || packageType === 'wasm-bindgen') {
      const isValid = await validateWasmBinary(binary)
      if (!isValid) {
        return {
          success: false,
          packageId,
          error: 'Invalid WASM binary'
        }
      }
    }

    // Calculate checksum
    const checksum = await calculateChecksum(binary)

    // Create package manifest
    const installedPackage: InstalledPackage = {
      id: packageId,
      name: metadata.name || file.name,
      description: metadata.description || 'User uploaded package',
      longDescription: metadata.longDescription,
      icon: metadata.icon || '📦',
      version: metadata.version || '1.0.0',
      type: packageType,
      source: 'user-uploaded',
      author: metadata.author || 'Unknown',
      license: metadata.license,
      homepage: metadata.homepage,
      repository: metadata.repository,
      tags: metadata.tags || ['user-uploaded'],
      dependencies: metadata.dependencies || [],
      size: binary.length,
      checksum,
      installDate: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      entrypoint: metadata.entrypoint,
      permissions: metadata.permissions,
      status: 'installed',
      jsFiles,
      tsFiles: (metadata as any).tsFiles,
      assets: (metadata as any).assets
    }

    // Save package
    await savePackage(installedPackage, binary)

    console.log(`[PackageManager] Uploaded ${packageId} (${formatBytes(binary.length)})`)

    // Dispatch event for UI updates
    window.dispatchEvent(new CustomEvent('zynqos:package-installed', { detail: { packageId } }))

    return {
      success: true,
      packageId,
      installedPackage
    }
  } catch (error) {
    console.error('[PackageManager] Upload failed:', error)
    return {
      success: false,
      packageId: upload.metadata.id || 'unknown',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Uninstall a package
 */
export async function uninstallPackage(packageId: string): Promise<boolean> {
  try {
    const pkg = await getPackageMetadata(packageId)
    if (!pkg) {
      console.warn(`[PackageManager] Package ${packageId} not found`)
      return false
    }

    await removePackage(packageId)
    console.log(`[PackageManager] Uninstalled ${packageId}`)
    
    // Dispatch event for UI updates
    window.dispatchEvent(new CustomEvent('zynqos:package-uninstalled', { detail: { packageId } }))
    
    return true
  } catch (error) {
    console.error('[PackageManager] Uninstall failed:', error)
    return false
  }
}

/**
 * Get installed package list
 */
export async function getInstalledPackages(): Promise<InstalledPackage[]> {
  return await listPackages()
}

/**
 * Create wasm-bindgen import object for Rust WASM modules
 */
function createWasmBindgenImports(): WebAssembly.Imports {
  return {
    wbg: {
      __wbindgen_throw: (ptr: number, len: number) => {
        throw new Error('WASM error')
      },
      __wbg_alert_4428ba7bb04e86ad: (ptr: number, len: number) => {
        console.log('Alert called from WASM')
      },
      __wbg_log_1d3ae0273d8f4f8a: (ptr: number, len: number) => {
        console.log('Log from WASM')
      }
    }
  }
}

/**
 * Create basic WASI import object for WASI modules
 */
function createWasiImports(): WebAssembly.Imports {
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 256 })
  const buffer = new Uint8Array(1024)
  
  return {
    wasi_snapshot_preview1: {
      // File descriptors
      fd_write: (fd: number, iovs: number, iovsLen: number, nwritten: number) => {
        if (fd === 1 || fd === 2) { // stdout or stderr
          const view = new DataView(memory.buffer)
          let written = 0
          for (let i = 0; i < iovsLen; i++) {
            const ptr = view.getUint32(iovs + i * 8, true)
            const len = view.getUint32(iovs + i * 8 + 4, true)
            const bytes = new Uint8Array(memory.buffer, ptr, len)
            console.log(new TextDecoder().decode(bytes))
            written += len
          }
          view.setUint32(nwritten, written, true)
          return 0
        }
        return 8 // EBADF
      },
      fd_read: () => 0,
      fd_close: () => 0,
      fd_seek: () => 0,
      fd_fdstat_get: () => 0,
      fd_filestat_get: (fd: number, bufPtr: number) => {
        // Write zeroed filestat
        const view = new DataView(memory.buffer)
        // filestat is 64 bytes in wasi snapshot preview1
        for (let i = 0; i < 64; i++) view.setUint8(bufPtr + i, 0)
        return 0
      },
      path_filestat_get: (fd: number, flags: number, pathPtr: number, pathLen: number, bufPtr: number) => {
        const view = new DataView(memory.buffer)
        for (let i = 0; i < 64; i++) view.setUint8(bufPtr + i, 0)
        return 0
      },
      fd_fdstat_set_flags: () => 0,
      fd_prestat_get: () => 8,
      fd_prestat_dir_name: () => 0,
      path_open: () => 8,
      fd_sync: () => 0,
      fd_tell: (fd: number, offsetPtr: number) => {
        const view = new DataView(memory.buffer)
        view.setBigUint64(offsetPtr, 0n, true)
        return 0
      },
      
      // Environment
      environ_sizes_get: (environc: number, environBufSize: number) => {
        const view = new DataView(memory.buffer)
        view.setUint32(environc, 0, true)
        view.setUint32(environBufSize, 0, true)
        return 0
      },
      environ_get: () => 0,
      
      // Args
      args_sizes_get: (argc: number, argvBufSize: number) => {
        const view = new DataView(memory.buffer)
        view.setUint32(argc, 0, true)
        view.setUint32(argvBufSize, 0, true)
        return 0
      },
      args_get: () => 0,
      
      // Process
      proc_exit: (code: number) => {
        console.log(`[WASI] Process exited with code ${code}`)
      },
      
      // Clock
      clock_time_get: (id: number, precision: bigint, time: number) => {
        const view = new DataView(memory.buffer)
        const now = BigInt(Date.now() * 1_000_000)
        view.setBigUint64(time, now, true)
        return 0
      },
      
      // Random
      random_get: (buf: number, bufLen: number) => {
        const view = new Uint8Array(memory.buffer, buf, bufLen)
        crypto.getRandomValues(view)
        return 0
      }
    },
    env: {
      memory
    }
  }
}

/**
 * Load and execute a WASM package
 */
export async function executePackage(
  packageId: string,
  importObject?: WebAssembly.Imports
): Promise<WebAssembly.Instance | null> {
  try {
    const binary = await getPackageBinary(packageId)
    if (!binary) {
      throw new Error('Package binary not found')
    }

    const metadata = await getPackageMetadata(packageId)
    if (!metadata) {
      throw new Error('Package metadata not found')
    }

    // Handle wasm-bindgen packages specially
    if (metadata.type === 'wasm-bindgen' && metadata.jsFiles) {
      console.log('[PackageManager] Executing wasm-bindgen package')
      
      // Get the JS glue code
      const jsFileEntries = Object.entries(metadata.jsFiles)
      if (jsFileEntries.length === 0) {
        throw new Error('wasm-bindgen package missing JS glue code')
      }
      
      // Create blob URLs for assets if any
      const assetUrls: { [filename: string]: string } = {}
      if (metadata.assets) {
        for (const [filename, content] of Object.entries(metadata.assets)) {
          // Detect if it's base64 or text
          if (filename.match(/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i)) {
            // Binary asset, decode base64
            const binaryString = atob(content)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i)
            }
            const blob = new Blob([bytes.buffer])
            assetUrls[filename] = URL.createObjectURL(blob)
          } else {
            // Text asset
            const blob = new Blob([content], { type: 'text/plain' })
            assetUrls[filename] = URL.createObjectURL(blob)
          }
        }
      }
      
      // Create a data URL for the WASM binary
      // Create a new Uint8Array with regular ArrayBuffer to ensure Blob compatibility
      const binaryData = new Uint8Array(binary)
      const wasmBlob = new Blob([binaryData], { type: 'application/wasm' })
      const wasmUrl = URL.createObjectURL(wasmBlob)
      
      // Find the main JS file (usually *_bg.js or the first one)
      const mainJsEntry = jsFileEntries.find(([name]) => name.includes('_bg.js')) || jsFileEntries[0]
      if (!mainJsEntry) {
        throw new Error('No JavaScript files found in wasm-bindgen package')
      }
      const [jsFilename, jsCode] = mainJsEntry
      
      // Modify JS code to use our blob URLs
      let modifiedJs = jsCode
        .replace(/input = new URL\([^)]+\);/g, `input = "${wasmUrl}";`)
        .replace(/import\.meta\.url/g, `"${wasmUrl}"`)
      
      // Replace asset references if any
      for (const [filename, url] of Object.entries(assetUrls)) {
        modifiedJs = modifiedJs.replace(new RegExp(`['"]\\./${filename}['"]`, 'g'), `"${url}"`)
      }
      
      // Create blob URLs for additional JS files
      const additionalJsUrls: { [filename: string]: string } = {}
      for (const [filename, code] of jsFileEntries) {
        if (filename !== jsFilename) {
          const blob = new Blob([code], { type: 'text/javascript' })
          additionalJsUrls[filename] = URL.createObjectURL(blob)
          // Replace imports in main JS
          modifiedJs = modifiedJs.replace(
            new RegExp(`from ['"]\\.\/${filename}['"]`, 'g'),
            `from "${additionalJsUrls[filename]}"`
          )
        }
      }
      
      // Execute the JS module
      const jsBlob = new Blob([modifiedJs], { type: 'text/javascript' })
      const jsUrl = URL.createObjectURL(jsBlob)
      
      try {
        const module = await import(/* @vite-ignore */ jsUrl)
        console.log(`[PackageManager] Loaded wasm-bindgen module`, module)

        // Initialize the module if it exposes the standard wasm-bindgen init entry
        if (typeof module.default === 'function') {
          await module.default(wasmUrl)
        }

        // Optional entrypoint execution
        const entryName = metadata.entrypoint
        const entryFn = entryName && (module as any)[entryName]
        const fallbackEntry = (module as any).run || (module as any).main || (module as any).start
        const toRun = (typeof entryFn === 'function') ? entryFn : (typeof fallbackEntry === 'function' ? fallbackEntry : null)
        if (toRun) {
          await toRun()
        }
        
        // Clean up blob URLs after a delay (keep them alive during execution)
        setTimeout(() => {
          URL.revokeObjectURL(jsUrl)
          URL.revokeObjectURL(wasmUrl)
          Object.values(assetUrls).forEach(url => URL.revokeObjectURL(url))
          Object.values(additionalJsUrls).forEach(url => URL.revokeObjectURL(url))
        }, 30000)
        
        // Return a mock instance (the module is already loaded and executing)
        return { exports: module } as any
      } catch (err) {
        URL.revokeObjectURL(jsUrl)
        URL.revokeObjectURL(wasmUrl)
        Object.values(assetUrls).forEach(url => URL.revokeObjectURL(url))
        Object.values(additionalJsUrls).forEach(url => URL.revokeObjectURL(url))
        throw err
      }
    }

    // Create import object based on package type or auto-detect from module imports
    let imports = importObject
    if (!imports) {
      // Compile the binary to inspect imports
      const module = await WebAssembly.compile(binary.buffer as ArrayBuffer)
      const moduleImports = WebAssembly.Module.imports(module)
      
      // Check what imports the module needs
      const needsWasi = moduleImports.some(imp => imp.module === 'wasi_snapshot_preview1')
      const needsWbg = moduleImports.some(imp => imp.module === 'wbg' || imp.module === './calculator_wasm_bg.js')
      
      if (needsWasi) {
        console.log('[PackageManager] Using WASI imports')
        imports = createWasiImports()
      } else if (needsWbg) {
        console.log('[PackageManager] Using wasm-bindgen imports')
        imports = createWasmBindgenImports()
      } else {
        console.log('[PackageManager] Using empty imports')
        imports = {}
      }
      
      const instance = await WebAssembly.instantiate(module, imports)
      console.log(`[PackageManager] Executed ${packageId}`)
      return instance
    }

    // If custom imports provided, use them
    const module = await WebAssembly.compile(binary.buffer as ArrayBuffer)
    const instance = await WebAssembly.instantiate(module, imports)

    console.log(`[PackageManager] Executed ${packageId}`)
    return instance
  } catch (error) {
    console.error('[PackageManager] Execution failed:', error)
    return null
  }
}

/**
 * Update a package
 */
export async function updatePackage(
  packageId: string,
  onProgress?: (status: string, percent?: number) => void
): Promise<InstallResult> {
  try {
    const installed = await getPackageMetadata(packageId)
    if (!installed) {
      return {
        success: false,
        packageId,
        error: 'Package not installed'
      }
    }

    // Get latest version from registry
    const latest = await registryManager.getPackage(packageId)
    if (!latest) {
      return {
        success: false,
        packageId,
        error: 'Package not found in registry'
      }
    }

    // Check if update needed
    if (installed.version === latest.version) {
      return {
        success: false,
        packageId,
        error: 'Package is already up to date'
      }
    }

    // Remove old version and install new one
    await uninstallPackage(packageId)
    return await installPackage(packageId, onProgress)
  } catch (error) {
    console.error('[PackageManager] Update failed:', error)
    return {
      success: false,
      packageId,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Check for available updates
 */
export async function checkUpdates(): Promise<{ packageId: string; currentVersion: string; latestVersion: string }[]> {
  const installed = await getInstalledPackages()
  const updates: { packageId: string; currentVersion: string; latestVersion: string }[] = []

  for (const pkg of installed) {
    if (pkg.source === 'user-uploaded') continue // Skip user uploads

    const latest = await registryManager.getPackage(pkg.id)
    if (latest && latest.version !== pkg.version) {
      updates.push({
        packageId: pkg.id,
        currentVersion: pkg.version,
        latestVersion: latest.version
      })
    }
  }

  return updates
}

// Utility function
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}
