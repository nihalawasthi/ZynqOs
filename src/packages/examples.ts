/**
 * Package Manager Examples
 * Demonstrates various ways to use the ZynqOS package management system
 */

import {
  installPackage,
  uploadPackage,
  uninstallPackage,
  getInstalledPackages,
  executePackage,
  updatePackage,
  checkUpdates,
  registryManager,
  getStorageStats,
  searchPackages,
  exportPackage,
  importPackage
} from './index'

// Example 1: Install a package from the registry
export async function exampleInstallPackage() {
  console.log('=== Installing Package ===')
  
  const result = await installPackage('calculator-wasm', (status, percent) => {
    console.log(`Status: ${status}${percent !== undefined ? ` (${percent.toFixed(1)}%)` : ''}`)
  })

  if (result.success) {
    console.log('✅ Installation successful!')
    console.log('Package:', result.installedPackage)
  } else {
    console.error('❌ Installation failed:', result.error)
  }

  return result
}

// Example 2: Upload a custom WASM file
export async function exampleUploadPackage(wasmBlob: Blob) {
  console.log('=== Uploading Custom Package ===')

  const file = new File([wasmBlob], 'my-custom-app.wasm', {
    type: 'application/wasm'
  })

  const result = await uploadPackage({
    file,
    metadata: {
      name: 'My Custom App',
      description: 'A custom WebAssembly application',
      author: 'Developer Name',
      version: '1.0.0',
      type: 'wasm',
      license: 'MIT',
      tags: ['custom', 'user-uploaded'],
      icon: '🎨'
    }
  })

  if (result.success) {
    console.log('✅ Upload successful!')
    console.log('Package ID:', result.packageId)
  } else {
    console.error('❌ Upload failed:', result.error)
  }

  return result
}

// Example 3: List all installed packages
export async function exampleListInstalled() {
  console.log('=== Listing Installed Packages ===')

  const packages = await getInstalledPackages()
  
  console.log(`Found ${packages.length} installed packages:\n`)
  
  packages.forEach(pkg => {
    console.log(`• ${pkg.name} (${pkg.id})`)
    console.log(`  Version: ${pkg.version}`)
    console.log(`  Type: ${pkg.type}`)
    console.log(`  Size: ${formatBytes(pkg.size)}`)
    console.log(`  Installed: ${new Date(pkg.installDate!).toLocaleDateString()}`)
    console.log('')
  })

  return packages
}

// Example 4: Execute a WASM package
export async function exampleExecutePackage(packageId: string) {
  console.log('=== Executing Package ===')

  const instance = await executePackage(packageId, {
    // Provide WebAssembly imports if needed
    env: {
      memory: new WebAssembly.Memory({ initial: 256, maximum: 512 }),
      log: (value: number) => console.log('WASM Log:', value)
    }
  })

  if (instance) {
    console.log('✅ Package executed successfully!')
    console.log('Exports:', Object.keys(instance.exports))
    return instance
  } else {
    console.error('❌ Execution failed')
    return null
  }
}

// Example 5: Check for updates
export async function exampleCheckUpdates() {
  console.log('=== Checking for Updates ===')

  const updates = await checkUpdates()
  
  if (updates.length === 0) {
    console.log('✅ All packages are up to date!')
  } else {
    console.log(`Found ${updates.length} update(s):\n`)
    
    updates.forEach(update => {
      console.log(`• ${update.packageId}`)
      console.log(`  Current: ${update.currentVersion}`)
      console.log(`  Latest: ${update.latestVersion}`)
      console.log('')
    })
  }

  return updates
}

// Example 6: Update a package
export async function exampleUpdatePackage(packageId: string) {
  console.log('=== Updating Package ===')

  const result = await updatePackage(packageId, (status, percent) => {
    console.log(`Status: ${status}${percent !== undefined ? ` (${percent.toFixed(1)}%)` : ''}`)
  })

  if (result.success) {
    console.log('✅ Update successful!')
  } else {
    console.error('❌ Update failed:', result.error)
  }

  return result
}

// Example 7: Uninstall a package
export async function exampleUninstallPackage(packageId: string) {
  console.log('=== Uninstalling Package ===')

  const success = await uninstallPackage(packageId)

  if (success) {
    console.log('✅ Package uninstalled successfully!')
  } else {
    console.error('❌ Uninstall failed')
  }

  return success
}

// Example 8: Search packages in storage
export async function exampleSearchPackages(query: string) {
  console.log(`=== Searching for "${query}" ===`)

  const results = await searchPackages(query)

  console.log(`Found ${results.length} result(s):\n`)
  
  results.forEach(pkg => {
    console.log(`• ${pkg.name} (${pkg.id})`)
    console.log(`  ${pkg.description}`)
    console.log('')
  })

  return results
}

// Example 9: Browse registry packages
export async function exampleBrowseRegistry() {
  console.log('=== Browsing Registry ===')

  const packages = await registryManager.fetchAllPackages()

  console.log(`Found ${packages.length} available packages:\n`)

  // Group by type
  const byType: Record<string, typeof packages> = {}
  packages.forEach(pkg => {
    if (!byType[pkg.type]) byType[pkg.type] = []
    byType[pkg.type].push(pkg)
  })

  Object.entries(byType).forEach(([type, pkgs]) => {
    console.log(`${type.toUpperCase()} (${pkgs.length}):`)
    pkgs.forEach(pkg => {
      console.log(`  • ${pkg.name} - ${pkg.description}`)
    })
    console.log('')
  })

  return packages
}

// Example 10: Get storage statistics
export async function exampleStorageStats() {
  console.log('=== Storage Statistics ===')

  const stats = await getStorageStats()

  console.log(`Total Packages: ${stats.totalPackages}`)
  console.log(`Total Size: ${formatBytes(stats.totalSize)}`)
  console.log('')
  
  console.log('By Type:')
  Object.entries(stats.byType).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`)
  })
  console.log('')

  console.log('By Source:')
  Object.entries(stats.bySource).forEach(([source, count]) => {
    console.log(`  ${source}: ${count}`)
  })

  return stats
}

// Example 11: Add custom registry
export async function exampleAddRegistry() {
  console.log('=== Adding Custom Registry ===')

  registryManager.addRegistry({
    name: 'My Custom Registry',
    url: 'https://example.com/packages/manifest.json',
    enabled: true,
    verified: false
  })

  const registries = registryManager.getRegistries()
  console.log(`Total registries: ${registries.length}`)
  
  registries.forEach(reg => {
    console.log(`• ${reg.name} (${reg.url})`)
    console.log(`  Enabled: ${reg.enabled}, Verified: ${reg.verified}`)
  })

  return registries
}

// Example 12: Export and import packages
export async function exampleExportImportPackage(packageId: string) {
  console.log('=== Export/Import Package ===')

  // Export
  const blob = await exportPackage(packageId)
  console.log(`✅ Exported package: ${formatBytes(blob.size)}`)

  // In a real scenario, you might save this to a file
  // or send it to another device

  // Import
  const imported = await importPackage(blob)
  console.log(`✅ Imported package: ${imported.name}`)

  return { blob, imported }
}

// Example 13: Complete workflow
export async function exampleCompleteWorkflow() {
  console.log('=== Complete Package Management Workflow ===\n')

  // 1. Browse available packages
  console.log('Step 1: Browsing registry...')
  const available = await registryManager.fetchAllPackages()
  console.log(`Found ${available.length} packages\n`)

  // 2. Install a package
  if (available.length > 0) {
    const packageToInstall = available[0]
    console.log(`Step 2: Installing ${packageToInstall.name}...`)
    await installPackage(packageToInstall.id)
    console.log('')
  } else {
    console.log('Step 2: No packages available to install\n')
  }

  // 3. List installed
  console.log('Step 3: Listing installed packages...')
  const installed = await getInstalledPackages()
  console.log(`Total installed: ${installed.length}\n`)

  // 4. Check for updates
  console.log('Step 4: Checking for updates...')
  const updates = await checkUpdates()
  console.log(`Updates available: ${updates.length}\n`)

  // 5. Get statistics
  console.log('Step 5: Getting storage stats...')
  const stats = await getStorageStats()
  console.log(`Total storage used: ${formatBytes(stats.totalSize)}\n`)

  console.log('✅ Workflow complete!')
}

// Utility function
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

// Export all examples
export const examples = {
  installPackage: exampleInstallPackage,
  uploadPackage: exampleUploadPackage,
  listInstalled: exampleListInstalled,
  executePackage: exampleExecutePackage,
  checkUpdates: exampleCheckUpdates,
  updatePackage: exampleUpdatePackage,
  uninstallPackage: exampleUninstallPackage,
  searchPackages: exampleSearchPackages,
  browseRegistry: exampleBrowseRegistry,
  storageStats: exampleStorageStats,
  addRegistry: exampleAddRegistry,
  exportImportPackage: exampleExportImportPackage,
  completeWorkflow: exampleCompleteWorkflow
}

// Make examples available in console
if (typeof window !== 'undefined') {
  ;(window as any).packageExamples = examples
  console.log('💡 Package manager examples loaded! Try: packageExamples.completeWorkflow()')
}
