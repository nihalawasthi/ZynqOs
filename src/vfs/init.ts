// Initialize VFS with sample files on first load
import { readFile, writeFile } from './fs'

export async function initializeVFS() {
  // Check initialization marker
  const marker = await readFile('/.initialized')
  const isInitialized = !!marker

  if (!isInitialized) {
    console.log('Initializing VFS with sample files...')

    // Create sample input.txt for WASI demos
    await writeFile('/input.txt', 'Hello from the ZynqOS VFS!\nThis file can be read by WASI programs.\n')

    // Create sample home directory file
    await writeFile('/home/demo.txt', 'Welcome to ZynqOS!\n\nThis is a sample text file stored in IndexedDB.\nYou can edit it with the Zynqpad app.\n')

    // Create a welcome file
    await writeFile('/welcome.txt', 'Welcome to ZynqOS - Browser Micro Runtime\n\nFeatures:\n- Virtual File System (IndexedDB)\n- WASI Terminal\n- Zynqpad\n- Calculator (WASM)\n- Python (Pyodide)\n\nTry running: run /apps/wasm/terminal-wasi.wasm\n')

    // Create sample Python script (ensure no leading indentation)
    const demoPy = [
      '#!/usr/bin/env python3',
      '"""Sample Python script for ZynqOS"""',
      '',
      'def main():',
      '    print("🐍 Hello from Python on ZynqOS!")',
      '    print("=" * 40)',
      '',
      '    # Demo calculations',
      '    numbers = [1, 2, 3, 4, 5]',
      '    print(f"Sum of {numbers} = {sum(numbers)}")',
      '    print(f"Squares: {[x**2 for x in numbers]}")',
      '',
      '    # Demo VFS integration',
      '    print("\\nTry: python /home/demo.py")',
      '    print("Or start REPL with: python")',
      '',
      'if __name__ == "__main__":',
      '    main()',
      ''
    ].join('\n')
    await writeFile('/home/demo.py', demoPy)

    // Mark as initialized
    await writeFile('/.initialized', 'true')

    console.log('VFS initialized successfully!')
  } else {
    // Migrations / ensure essential sample files exist and fix indentation
    const py = await readFile('/home/demo.py')
    const demoPy = [
      '#!/usr/bin/env python3',
      '"""Sample Python script for ZynqOS"""',
      '',
      'def main():',
      '    print("🐍 Hello from Python on ZynqOS!")',
      '    print("=" * 40)',
      '',
      '    # Demo calculations',
      '    numbers = [1, 2, 3, 4, 5]',
      '    print(f"Sum of {numbers} = {sum(numbers)}")',
      '    print(f"Squares: {[x**2 for x in numbers]}")',
      '',
      '    # Demo VFS integration',
      '    print("\\nTry: python /home/demo.py")',
      '    print("Or start REPL with: python")',
      '',
      'if __name__ == "__main__":',
      '    main()',
      ''
    ].join('\n')
    if (!py || (typeof py === 'string' && py.includes('Sample Python script for ZynqOS'))) {
      await writeFile('/home/demo.py', demoPy)
      console.log('VFS migration: ensured /home/demo.py with proper indentation')
    }
  }
}
