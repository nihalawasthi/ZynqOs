// Initialize VFS with sample files on first load
import { readFile, writeFile } from './fs'

export async function initializeVFS() {
  // Check if already initialized
  const marker = await readFile('/.initialized')
  if (marker) return

  console.log('Initializing VFS with sample files...')

  // Create sample input.txt for WASI demos
  await writeFile('/input.txt', 'Hello from the ZynqOS VFS!\nThis file can be read by WASI programs.\n')

  // Create sample home directory file
  await writeFile('/home/demo.txt', 'Welcome to ZynqOS!\n\nThis is a sample text file stored in IndexedDB.\nYou can edit it with the Zynqpad app.\n')

  // Create a welcome file
  await writeFile('/welcome.txt', 'Welcome to ZynqOS - Browser Micro Runtime\n\nFeatures:\n- Virtual File System (IndexedDB)\n- WASI Terminal\n- Zynqpad\n- Calculator (WASM)\n\nTry running: run /apps/wasm/terminal-wasi.wasm\n')

  // Mark as initialized
  await writeFile('/.initialized', 'true')

  console.log('VFS initialized successfully!')
}
