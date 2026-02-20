// src/wasm/wasmerBash.ts
// Wasmer SDK integration for running bash shell and scripts in the browser

import { init, Wasmer, Instance, Directory as WasmerDirectory } from '@wasmer/sdk'

let wasmerInitialized = false
let wasmerInitializing = false // Prevent concurrent initialization
let wasmerInitError: string | null = null
let bashPackage: any = null
let coreutilsPackage: any = null
let preloadPromise: Promise<{ success: boolean; error?: string }> | null = null

/**
 * Initialize the Wasmer SDK (must be called before any other function)
 */
export async function initWasmer(): Promise<boolean> {
  if (wasmerInitialized) return true
  if (wasmerInitError) return false // Don't retry if we already failed
  if (wasmerInitializing) {
    // Wait for ongoing initialization
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (!wasmerInitializing) {
          clearInterval(check)
          resolve(true)
        }
      }, 50)
    })
    return wasmerInitialized
  }

  wasmerInitializing = true

  try {
    // Check prerequisites first
    const coiCheck = checkCrossOriginIsolation()
    if (!coiCheck.supported) {
      wasmerInitError = coiCheck.reason || 'Cross-origin isolation not available'
      console.error('[Wasmer] Cannot initialize:', wasmerInitError)
      return false
    }

    await init()
    wasmerInitialized = true
    wasmerInitError = null
    console.log('[Wasmer] SDK initialized successfully')
    return true
  } catch (error: any) {
    wasmerInitError = error?.message || String(error)
    console.error('[Wasmer] Failed to initialize SDK:', error)
    return false
  } finally {
    wasmerInitializing = false
  }
}

/**
 * Get the initialization error if any
 */
export function getWasmerInitError(): string | null {
  return wasmerInitError
}

/**
 * Check if SharedArrayBuffer is available (required for Wasmer)
 */
export function checkCrossOriginIsolation(): { supported: boolean; reason?: string } {
  if (typeof SharedArrayBuffer === 'undefined') {
    return {
      supported: false,
      reason: 'SharedArrayBuffer is not available. COOP/COEP headers may be missing.',
    }
  }
  if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated) {
    return {
      supported: false,
      reason: 'Page is not cross-origin isolated. Add COOP/COEP headers.',
    }
  }
  return { supported: true }
}

/**
 * Load the bash package from Wasmer registry (cached)
 */
export async function loadBash(): Promise<any> {
  if (bashPackage) return bashPackage

  if (!wasmerInitialized) {
    const ok = await initWasmer()
    if (!ok) {
      throw new Error(`Wasmer SDK not initialized: ${wasmerInitError || 'Unknown error'}`)
    }
  }

  console.log('[Wasmer] Loading bash from registry...')
  bashPackage = await Wasmer.fromRegistry('wasmer/bash')
  console.log('[Wasmer] Bash loaded')
  return bashPackage
}

/**
 * Load coreutils package from Wasmer registry (cached)
 * Using sharrattj/coreutils which has better GNU compatibility
 */
export async function loadCoreutils(): Promise<any> {
  if (coreutilsPackage) return coreutilsPackage

  if (!wasmerInitialized) {
    const ok = await initWasmer()
    if (!ok) throw new Error('Wasmer SDK not initialized')
  }

  console.log('[Wasmer] Loading coreutils from registry...')
  // Using sharrattj/coreutils which provides better GNU coreutils compatibility
  coreutilsPackage = await Wasmer.fromRegistry('sharrattj/coreutils')
  return coreutilsPackage
}

/**
 * Preload Wasmer SDK, bash, and coreutils in the background
 * Call this when terminal launches to avoid delays when running commands
 * Returns cached promise if already preloading to prevent race conditions
 */
export async function preloadWasmerPackages(
  onProgress?: (message: string) => void
): Promise<{ success: boolean; error?: string }> {
  // Return existing promise if already preloading
  if (preloadPromise) {
    return preloadPromise
  }

  const report = (msg: string) => {
    console.log(`[Wasmer] ${msg}`)
    onProgress?.(msg)
  }

  preloadPromise = (async () => {
    try {
      // Check cross-origin isolation first
      const coiCheck = checkCrossOriginIsolation()
      if (!coiCheck.supported) {
        report(`Skipping preload: ${coiCheck.reason}`)
        return { success: false, error: coiCheck.reason }
      }

      // Initialize SDK
      report('Initializing Wasmer SDK...')
      const sdkOk = await initWasmer()
      if (!sdkOk) {
        return { success: false, error: wasmerInitError || 'SDK init failed' }
      }
      report('Wasmer SDK ready')

      // Load packages sequentially to avoid race conditions in Wasmer SDK
      report('Loading bash from registry...')
      await loadBash()
      
      report('Loading coreutils from registry...')
      await loadCoreutils()

      report('Packages loaded successfully')
      return { success: true }
    } catch (error: any) {
      const errMsg = error?.message || String(error)
      report(`Preload failed: ${errMsg}`)
      return { success: false, error: errMsg }
    }
  })()

  return preloadPromise
}

/**
 * Result of running a bash command or script
 */
export interface BashResult {
  stdout: string
  stderr: string
  exitCode: number
  success: boolean
}

/**
 * Options for running bash commands
 */
export interface BashRunOptions {
  /** Current working directory */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Files to mount in the virtual filesystem (path -> content) */
  files?: Map<string, Uint8Array | string>
  /** Stdin input */
  stdin?: string
  /** Timeout in milliseconds */
  timeout?: number
}

/**
 * Safely decode output to string
 */
function decodeOutput(data: any): string {
  if (!data) return ''
  
  // If it's already a string, return it
  if (typeof data === 'string') return data
  
  // If it's a Uint8Array or ArrayBuffer, decode it
  if (data instanceof Uint8Array) {
    return new TextDecoder().decode(data)
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data))
  }
  
  // If it has a buffer property (TypedArray view)
  if (data.buffer instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  }
  
  // Try to convert to string as fallback
  try {
    return String(data)
  } catch {
    return ''
  }
}

/**
 * Run a bash command string
 */
export async function runBashCommand(
  command: string,
  options: BashRunOptions = {}
): Promise<BashResult> {
  const bash = await loadBash()

  const instance = await bash.entrypoint!.run({
    args: ['-c', command],
    env: options.env,
    stdin: options.stdin ? new TextEncoder().encode(options.stdin) : undefined,
  })

  const output = await instance.wait()
  const stdout = decodeOutput(output.stdout)
  const stderr = decodeOutput(output.stderr)

  return {
    stdout,
    stderr,
    exitCode: output.code,
    success: output.ok,
  }
}

/**
 * Run a bash script from string content
 * Supports mounting VFS files so scripts can access them
 * Files are mounted at /vfs/ and the script runs with /vfs as the working directory
 */
export async function runBashScript(
  scriptContent: string,
  args: string[] = [],
  options: BashRunOptions & { vfsFiles?: Map<string, Uint8Array | string> } = {}
): Promise<BashResult> {
  const bash = await loadBash()

  // Build mount configuration
  // Mount VFS files at /vfs/ so they're accessible
  const mountConfig: Record<string, any> = {
    '/tmp': {
      'script.sh': scriptContent,
    },
    '/vfs': {} as Record<string, any>,
  }

  // Build path mapping for rewriting the script
  const pathMapping = new Map<string, string>()

  // Add VFS files to mount config at /vfs/
  if (options.vfsFiles && options.vfsFiles.size > 0) {
    for (const [path, content] of options.vfsFiles) {
      // Normalize path - strip leading slash for consistency
      let normalizedPath = path.startsWith('/') ? path.slice(1) : path
      
      // For simple filenames, mount directly in /vfs/
      // For paths with directories, flatten them
      const filename = normalizedPath.replace(/\//g, '_')
      mountConfig['/vfs'][filename] = content
      
      // Map the original filename to the mounted path
      const mountedPath = `/vfs/${filename}`
      const justFilename = normalizedPath.split('/').pop() || normalizedPath
      pathMapping.set(justFilename, mountedPath)
      pathMapping.set(normalizedPath, mountedPath)
      pathMapping.set('/' + normalizedPath, mountedPath)
    }
  }

  // Rewrite file references in the script to use mounted paths
  // We need to be careful to replace whole words/paths, not partial matches
  let rewrittenScript = scriptContent
  
  // Sort by length descending so longer paths are replaced first
  const sortedMappings = Array.from(pathMapping.entries()).sort((a, b) => b[0].length - a[0].length)
  
  for (const [original, mounted] of sortedMappings) {
    // Use word boundary matching - but handle filenames with extensions
    // Match the filename when it's:
    // - At start of string or after whitespace/quote
    // - At end of string or before whitespace/quote/semicolon
    const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Simpler approach: just match when surrounded by spaces, quotes, or at boundaries
    const patterns = [
      new RegExp(`(^|\\s|"|')${escapedOriginal}($|\\s|"|'|;)`, 'g'),
    ]
    
    for (const regex of patterns) {
      rewrittenScript = rewrittenScript.replace(regex, (match, prefix, suffix) => {
        return `${prefix}${mounted}${suffix}`
      })
    }
  }
  
  // Update the script in mount config
  mountConfig['/tmp']['script.sh'] = rewrittenScript

  console.log(`[Wasmer] Running bash script (rewritten):`, rewrittenScript)
  console.log(`[Wasmer] Mount config:`, Object.keys(mountConfig['/vfs'] || {}))

  // Run bash with the script
  const instance = await bash.entrypoint!.run({
    args: ['/tmp/script.sh', ...args],
    env: options.env,
    stdin: options.stdin ? new TextEncoder().encode(options.stdin) : undefined,
    mount: mountConfig,
  })

  const output = await instance.wait()
  const stdout = decodeOutput(output.stdout)
  const stderr = decodeOutput(output.stderr)

  return {
    stdout,
    stderr,
    exitCode: output.code,
    success: output.ok,
  }
}

/**
 * Run a coreutils command (ls, cat, cp, mv, etc.)
 * VFS files are mounted at /vfs/ and args are rewritten to point there
 */
export async function runCoreutil(
  command: string,
  args: string[] = [],
  options: BashRunOptions & { vfsFiles?: Map<string, Uint8Array | string> } = {}
): Promise<BashResult> {
  const coreutils = await loadCoreutils()

  // Get the specific command entrypoint
  const cmd = coreutils.commands[command]
  if (!cmd) {
    return {
      stdout: '',
      stderr: `coreutils: command not found: ${command}`,
      exitCode: 127,
      success: false,
    }
  }

  // Build mount object from VFS files - mount at /vfs directory
  // Also build a map of original paths to mounted paths for arg rewriting
  let mountConfig: Record<string, any> | undefined
  const pathMapping = new Map<string, string>() // original path -> mounted path
  
  if (options.vfsFiles && options.vfsFiles.size > 0) {
    mountConfig = { '/vfs': {} as Record<string, any> }
    
    for (const [path, content] of options.vfsFiles) {
      // Normalize path
      let normalizedPath = path.startsWith('/') ? path.slice(1) : path
      
      // Handle nested directories by flattening for now (or create structure)
      const filename = normalizedPath.replace(/\//g, '_') // Flatten: /dir/file.txt -> dir_file.txt
      
      // Store the content at /vfs/filename
      mountConfig['/vfs'][filename] = content
      
      // Map various ways the file might be referenced to the mounted path
      const mountedPath = `/vfs/${filename}`
      pathMapping.set(path, mountedPath)
      pathMapping.set('/' + normalizedPath, mountedPath)
      pathMapping.set(normalizedPath, mountedPath)
      // Also handle just the filename for simple cases like "welcome.txt"
      const justFilename = normalizedPath.split('/').pop() || normalizedPath
      if (!pathMapping.has(justFilename)) {
        pathMapping.set(justFilename, mountedPath)
      }
    }
  }

  // Rewrite args to use mounted paths
  const rewrittenArgs = args.map(arg => {
    // Don't rewrite flags
    if (arg.startsWith('-')) return arg
    
    // Check if this arg is a file path we have mounted
    const mountedPath = pathMapping.get(arg) || pathMapping.get('/' + arg)
    if (mountedPath) {
      return mountedPath
    }
    
    return arg
  })

  console.log(`[Wasmer] Running coreutils ${command} with args:`, rewrittenArgs, 'mount:', mountConfig)

  const instance = await cmd.run({
    args: rewrittenArgs,
    env: options.env,
    stdin: options.stdin ? new TextEncoder().encode(options.stdin) : undefined,
    ...(mountConfig && { mount: mountConfig }),
  })

  const output = await instance.wait()
  const stdout = decodeOutput(output.stdout)
  const stderr = decodeOutput(output.stderr)

  return {
    stdout,
    stderr,
    exitCode: output.code,
    success: output.ok,
  }
}

/**
 * Interactive bash shell session
 */
export class InteractiveBashSession {
  private instance: Instance | null = null
  private stdin: WritableStreamDefaultWriter<Uint8Array> | null = null
  private stdoutReader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private stderrReader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private running = false
  private onOutput: ((data: string) => void) | null = null
  private onError: ((data: string) => void) | null = null
  private onExit: ((code: number) => void) | null = null

  /**
   * Start an interactive bash session
   */
  async start(options: {
    onOutput?: (data: string) => void
    onError?: (data: string) => void
    onExit?: (code: number) => void
    env?: Record<string, string>
    files?: Map<string, Uint8Array | string>
  } = {}): Promise<void> {
    if (this.running) {
      throw new Error('Session already running')
    }

    this.onOutput = options.onOutput || null
    this.onError = options.onError || null
    this.onExit = options.onExit || null

    const bash = await loadBash()

    // Start bash in interactive mode
    const instance = await bash.entrypoint!.run({
      args: ['--norc', '--noprofile', '-i'],
      env: {
        TERM: 'xterm-256color',
        HOME: '/home/user',
        USER: 'user',
        SHELL: '/bin/bash',
        PS1: '\\u@zynqos:\\w\\$ ',
        ...options.env,
      },
    })

    this.instance = instance
    this.running = true

    // Set up stdin writer
    if (instance.stdin) {
      this.stdin = instance.stdin.getWriter()
    }

    // Read stdout
    if (instance.stdout) {
      this.stdoutReader = instance.stdout.getReader()
      this.readStream(this.stdoutReader, (data) => {
        if (this.onOutput) this.onOutput(data)
      })
    }

    // Read stderr
    if (instance.stderr) {
      this.stderrReader = instance.stderr.getReader()
      this.readStream(this.stderrReader, (data) => {
        if (this.onError) this.onError(data)
      })
    }

    // Wait for exit
    instance.wait().then((output) => {
      this.running = false
      if (this.onExit) this.onExit(output.code)
    })
  }

  private async readStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    callback: (data: string) => void
  ): Promise<void> {
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          callback(decoder.decode(value))
        }
      }
    } catch (e) {
      // Stream closed
    }
  }

  /**
   * Send input to the bash session
   */
  async write(input: string): Promise<void> {
    if (!this.stdin) {
      throw new Error('Session not started or stdin not available')
    }
    await this.stdin.write(new TextEncoder().encode(input))
  }

  /**
   * Send a line (with newline) to bash
   */
  async writeLine(line: string): Promise<void> {
    await this.write(line + '\n')
  }

  /**
   * Check if the session is running
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Terminate the session
   */
  async terminate(): Promise<void> {
    if (this.stdin) {
      try {
        await this.stdin.close()
      } catch (e) {
        // Ignore close errors
      }
    }
    this.running = false
  }
}

/**
 * List available coreutils commands
 */
export async function listCoreutilsCommands(): Promise<string[]> {
  const coreutils = await loadCoreutils()
  return Object.keys(coreutils.commands || {})
}

/**
 * Check if a command is available in coreutils (without loading if not already loaded)
 */
export function isCoreutilsCommand(command: string): boolean {
  if (!coreutilsPackage) return false
  return command in (coreutilsPackage.commands || {})
}

/**
 * Get list of coreutils commands if already loaded (sync, no network)
 */
export function getLoadedCoreutilsCommands(): string[] {
  if (!coreutilsPackage) return []
  return Object.keys(coreutilsPackage.commands || {})
}

/**
 * Common coreutils commands that ARE ACTUALLY available in wasmer/coreutils
 * Note: grep, sed, awk are NOT in coreutils - they need to run via bash
 */
export const KNOWN_COREUTILS_COMMANDS = [
  // File operations
  'ls', 'cat', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'ln',
  // Text processing (coreutils only - NOT grep/sed/awk)
  'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'paste', 'tr', 'fold',
  // File info
  'stat', 'du', 'df',
  // Output
  'echo', 'printf', 'yes', 'seq', 'tee',
  // Utilities
  'basename', 'dirname', 'realpath', 'pwd', 'env', 'printenv',
  'whoami', 'id', 'hostname', 'uname', 'date', 'sleep',
  // Checksums
  'md5sum', 'sha1sum', 'sha256sum', 'sha512sum',
  // Other
  'true', 'false', 'test', 'expr', 'factor', 'nproc',
]

/**
 * Commands that were originally marked as "bash only" but actually don't exist in wasmer packages
 * These are now implemented in JavaScript
 */
export const JS_IMPLEMENTED_COMMANDS = [
  'grep', 'sed', 'awk', 'find', 'wget',
]

/**
 * Commands that would need bash but aren't available (and not implemented in JS)
 */
export const BASH_ONLY_COMMANDS = [
  'xargs', 'file',
]

/**
 * JavaScript implementation of find command
 * Supports: find [path] -name "pattern", find [path] -type f/d
 */
export function jsFind(
  args: string[],
  allFiles: string[],
  isDirectory: (path: string) => boolean
): BashResult {
  let searchPath = '.'
  let namePattern: RegExp | null = null
  let typeFilter: 'f' | 'd' | null = null
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-name' && args[i + 1]) {
      // Convert glob to regex
      const glob = args[i + 1]
      const regexPattern = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
      namePattern = new RegExp(`^${regexPattern}$`, 'i')
      i++
    } else if (arg === '-type' && args[i + 1]) {
      typeFilter = args[i + 1] as 'f' | 'd'
      i++
    } else if (arg === '--help' || arg === '-h') {
      return {
        stdout: `Usage: find [path] [options]
Options:
  -name "pattern"   Match filename pattern (supports * and ? wildcards)
  -type f           Find only files
  -type d           Find only directories
  --help            Show this help`,
        stderr: '',
        exitCode: 0,
        success: true,
      }
    } else if (!arg.startsWith('-')) {
      searchPath = arg
    }
  }
  
  // Normalize search path
  if (searchPath === '~' || searchPath === '.') searchPath = ''
  if (searchPath.startsWith('/')) searchPath = searchPath.slice(1)
  
  // Filter files
  const results: string[] = []
  for (const file of allFiles) {
    // Check if file is under search path
    const normalizedFile = file.startsWith('/') ? file.slice(1) : file
    if (searchPath && !normalizedFile.startsWith(searchPath)) continue
    
    // Check type filter
    const isDir = isDirectory(file)
    if (typeFilter === 'f' && isDir) continue
    if (typeFilter === 'd' && !isDir) continue
    
    // Check name pattern
    if (namePattern) {
      const filename = normalizedFile.split('/').pop() || normalizedFile
      if (!namePattern.test(filename)) continue
    }
    
    results.push('/' + normalizedFile)
  }
  
  return {
    stdout: results.join('\n'),
    stderr: '',
    exitCode: results.length > 0 ? 0 : 1,
    success: true,
  }
}

/**
 * JavaScript implementation of wget (using fetch API)
 * Returns the fetched content or saves to file
 */
export async function jsWget(
  args: string[],
  saveFile: (path: string, content: Uint8Array) => Promise<void>
): Promise<BashResult> {
  let url = ''
  let outputFile = ''
  let quiet = false
  let useProxy = false
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if ((arg === '-O' || arg === '-o' || arg === '--output-document') && args[i + 1]) {
      outputFile = args[i + 1]
      i++
    } else if (arg === '-q' || arg === '--quiet') {
      quiet = true
    } else if (arg === '-x' || arg === '--proxy') {
      useProxy = true
    } else if (arg === '--help' || arg === '-h') {
      return {
        stdout: `Usage: wget [options] URL
Options:
  -O file           Save to specified file
  -q, --quiet       Quiet mode
  -x, --proxy       Use CORS proxy (for cross-origin requests)
  --help            Show this help

Note: Due to browser security (CORS), most external websites cannot be
fetched directly. Use -x to route through a CORS proxy, or download from
CORS-enabled servers.

Examples:
  wget https://example.com/file.txt
  wget -x https://example.com/file.pdf    # Use proxy for CORS-blocked sites
  wget -O output.txt https://example.com/file.txt`,
        stderr: '',
        exitCode: 0,
        success: true,
      }
    } else if (!arg.startsWith('-')) {
      url = arg
    }
  }
  
  if (!url) {
    return {
      stdout: '',
      stderr: 'wget: missing URL',
      exitCode: 1,
      success: false,
    }
  }
  
  // Ensure URL has protocol
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url
  }
  
  try {
    let fetchUrl = url
    
    // Use CORS proxy if requested - try our own proxy first, then fallbacks
    if (useProxy) {
      // List of CORS proxies to try (in order)
      // First try our own Vercel serverless proxy, then public fallbacks
      const proxies = [
        (u: string) => `/api/proxy?url=${encodeURIComponent(u)}`,  // Our own proxy
        (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
      ]
      
      let lastError = ''
      for (const proxyFn of proxies) {
        fetchUrl = proxyFn(url)
        try {
          const response = await fetch(fetchUrl)
          if (response.ok) {
            const data = new Uint8Array(await response.arrayBuffer())
            
            // Determine output filename
            if (!outputFile) {
              const urlObj = new URL(url)
              outputFile = urlObj.pathname.split('/').pop() || 'index.html'
            }
            
            await saveFile('/' + outputFile, data)
            const message = quiet ? '' : `'${outputFile}' saved [${data.length} bytes]`
            
            return {
              stdout: message,
              stderr: '',
              exitCode: 0,
              success: true,
            }
          }
          lastError = `${response.status} ${response.statusText}`
        } catch (e: any) {
          lastError = e.message || 'network error'
          continue // Try next proxy
        }
      }
      
      return {
        stdout: '',
        stderr: `wget: all proxies failed. Last error: ${lastError}\nNote: Some URLs may be blocked by proxy services.`,
        exitCode: 1,
        success: false,
      }
    }
    
    const response = await fetch(fetchUrl)
    if (!response.ok) {
      return {
        stdout: '',
        stderr: `wget: server returned ${response.status} ${response.statusText}`,
        exitCode: 1,
        success: false,
      }
    }
    
    const data = new Uint8Array(await response.arrayBuffer())
    
    // Determine output filename
    if (!outputFile) {
      // Extract filename from URL
      const urlObj = new URL(url)
      outputFile = urlObj.pathname.split('/').pop() || 'index.html'
    }
    
    // Save file
    await saveFile('/' + outputFile, data)
    
    const message = quiet ? '' : `'${outputFile}' saved [${data.length} bytes]`
    
    return {
      stdout: message,
      stderr: '',
      exitCode: 0,
      success: true,
    }
  } catch (error: any) {
    // Check if it's likely a CORS error
    const errorMsg = error.message || 'network error'
    if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError') || errorMsg.includes('CORS')) {
      return {
        stdout: '',
        stderr: `wget: Failed to fetch (CORS blocked)\nTip: Try using -x flag to use a CORS proxy:\n  wget -x ${url}`,
        exitCode: 1,
        success: false,
      }
    }
    return {
      stdout: '',
      stderr: `wget: ${errorMsg}`,
      exitCode: 1,
      success: false,
    }
  }
}

/**
 * JavaScript implementation of basic grep functionality
 * Supports: grep pattern file, grep -i (case insensitive), grep -v (invert match), grep -n (line numbers)
 */
export function jsGrep(args: string[], fileContent: string): BashResult {
  // Check for help flag first
  if (args.includes('--help') || args.includes('-h')) {
    return {
      stdout: `Usage: grep [options] PATTERN [FILE]
Options:
  -i            Case insensitive matching
  -v            Invert match (show non-matching lines)
  -n            Show line numbers
  -c            Count matching lines only
  --help        Show this help

Examples:
  grep "error" logfile.txt
  grep -i "warning" logfile.txt
  grep -n "TODO" *.js`,
      stderr: '',
      exitCode: 0,
      success: true,
    }
  }

  let pattern = ''
  let caseInsensitive = false
  let invertMatch = false
  let showLineNumbers = false
  let countOnly = false
  
  // Parse arguments
  const nonFlagArgs: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-i') {
      caseInsensitive = true
    } else if (arg === '-v') {
      invertMatch = true
    } else if (arg === '-n') {
      showLineNumbers = true
    } else if (arg === '-c') {
      countOnly = true
    } else if (arg.startsWith('-')) {
      // Handle combined flags like -iv
      for (const char of arg.slice(1)) {
        if (char === 'i') caseInsensitive = true
        else if (char === 'v') invertMatch = true
        else if (char === 'n') showLineNumbers = true
        else if (char === 'c') countOnly = true
      }
    } else {
      nonFlagArgs.push(arg)
    }
  }
  
  // First non-flag arg is the pattern
  pattern = nonFlagArgs[0] || ''
  
  if (!pattern) {
    return {
      stdout: '',
      stderr: 'grep: no pattern specified',
      exitCode: 2,
      success: false,
    }
  }
  
  // Build regex
  let regex: RegExp
  try {
    regex = new RegExp(pattern, caseInsensitive ? 'i' : '')
  } catch (e) {
    return {
      stdout: '',
      stderr: `grep: invalid regex: ${pattern}`,
      exitCode: 2,
      success: false,
    }
  }
  
  // Process file content
  const lines = fileContent.split('\n')
  const matches: string[] = []
  let matchCount = 0
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const isMatch = regex.test(line)
    const include = invertMatch ? !isMatch : isMatch
    
    if (include) {
      matchCount++
      if (!countOnly) {
        if (showLineNumbers) {
          matches.push(`${i + 1}:${line}`)
        } else {
          matches.push(line)
        }
      }
    }
  }
  
  if (countOnly) {
    return {
      stdout: String(matchCount),
      stderr: '',
      exitCode: matchCount > 0 ? 0 : 1,
      success: matchCount > 0,
    }
  }
  
  return {
    stdout: matches.join('\n'),
    stderr: '',
    exitCode: matches.length > 0 ? 0 : 1,
    success: matches.length > 0,
  }
}

/**
 * JavaScript implementation of basic sed functionality  
 * Supports: sed 's/pattern/replacement/g' file
 */
export function jsSed(args: string[], fileContent: string): BashResult {
  // Very basic sed: only supports s/pattern/replacement/flags
  const script = args[0] || ''
  
  // Parse s/pattern/replacement/flags
  const match = script.match(/^s(.)(.*?)\1(.*?)\1([gi]*)$/)
  if (!match) {
    return {
      stdout: '',
      stderr: `sed: invalid script: ${script}`,
      exitCode: 1,
      success: false,
    }
  }
  
  const [, , pattern, replacement, flags] = match
  const globalReplace = flags.includes('g')
  const caseInsensitive = flags.includes('i')
  
  let regex: RegExp
  try {
    const regexFlags = (globalReplace ? 'g' : '') + (caseInsensitive ? 'i' : '')
    regex = new RegExp(pattern, regexFlags)
  } catch (e) {
    return {
      stdout: '',
      stderr: `sed: invalid regex: ${pattern}`,
      exitCode: 1,
      success: false,
    }
  }
  
  const result = fileContent.replace(regex, replacement)
  
  return {
    stdout: result,
    stderr: '',
    exitCode: 0,
    success: true,
  }
}

/**
 * JavaScript implementation of basic awk functionality
 * Supports: awk '{print $N}' file, awk -F'delimiter' '{print $N}' file
 */
export function jsAwk(args: string[], fileContent: string): BashResult {
  let fieldSeparator = /\s+/
  let program = ''
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-F' && args[i + 1]) {
      fieldSeparator = new RegExp(args[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      i++
    } else if (args[i].startsWith('-F')) {
      const sep = args[i].slice(2)
      fieldSeparator = new RegExp(sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    } else if (!program) {
      program = args[i]
    }
  }
  
  if (!program) {
    return {
      stdout: '',
      stderr: 'awk: no program specified',
      exitCode: 1,
      success: false,
    }
  }
  
  // Very basic awk: only support {print $N} or {print $N, $M}
  const printMatch = program.match(/^\{?\s*print\s+(.+?)\s*\}?$/)
  if (!printMatch) {
    return {
      stdout: '',
      stderr: `awk: unsupported program (only {print $N} supported): ${program}`,
      exitCode: 1,
      success: false,
    }
  }
  
  const printExpr = printMatch[1]
  const fieldRefs = printExpr.match(/\$\d+/g) || []
  const fieldIndices = fieldRefs.map(ref => parseInt(ref.slice(1), 10))
  
  const outputLines: string[] = []
  const lines = fileContent.split('\n')
  
  for (const line of lines) {
    if (!line.trim()) continue
    
    const fields = line.split(fieldSeparator)
    const outputFields: string[] = []
    
    for (const idx of fieldIndices) {
      if (idx === 0) {
        outputFields.push(line) // $0 is the whole line
      } else {
        outputFields.push(fields[idx - 1] || '')
      }
    }
    
    outputLines.push(outputFields.join(' '))
  }
  
  return {
    stdout: outputLines.join('\n'),
    stderr: '',
    exitCode: 0,
    success: true,
  }
}

/**
 * JavaScript implementation of zip command using JSZip
 * Supports: zip archive.zip file1 file2 ...
 */
export async function jsZip(
  args: string[],
  readFile: (path: string) => Promise<Uint8Array | string | null>,
  saveFile: (path: string, content: Uint8Array) => Promise<void>,
  listDir: (path: string) => Promise<string[]>
): Promise<BashResult> {
  // Dynamic import JSZip
  const JSZip = (await import('jszip')).default
  
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    return {
      stdout: `Usage: zip [options] archive.zip file1 [file2 ...]
Options:
  -r            Recurse into directories
  --help        Show this help

Examples:
  zip archive.zip file1.txt file2.txt
  zip -r archive.zip folder/`,
      stderr: '',
      exitCode: args.length === 0 ? 1 : 0,
      success: args.length > 0,
    }
  }
  
  let recursive = false
  const filesToZip: string[] = []
  let archiveName = ''
  
  for (const arg of args) {
    if (arg === '-r') {
      recursive = true
    } else if (!archiveName) {
      archiveName = arg
    } else {
      filesToZip.push(arg)
    }
  }
  
  if (!archiveName || filesToZip.length === 0) {
    return {
      stdout: '',
      stderr: 'zip: missing archive name or files',
      exitCode: 1,
      success: false,
    }
  }
  
  // Ensure .zip extension
  if (!archiveName.endsWith('.zip')) {
    archiveName += '.zip'
  }
  
  const zip = new JSZip()
  let fileCount = 0
  
  // Helper to add files recursively
  async function addToZip(path: string, zipPath: string) {
    const normalizedPath = path.startsWith('/') ? path : '/' + path
    const content = await readFile(normalizedPath)
    
    if (content !== null) {
      // It's a file
      const data = content instanceof Uint8Array ? content : new TextEncoder().encode(content)
      zip.file(zipPath, data)
      fileCount++
    } else if (recursive) {
      // Try as directory
      try {
        const entries = await listDir(normalizedPath.slice(1))
        for (const entry of entries) {
          const entryName = entry.endsWith('/') ? entry.slice(0, -1) : entry
          const fullPath = normalizedPath + '/' + entryName
          const fullZipPath = zipPath + '/' + entryName
          await addToZip(fullPath, fullZipPath)
        }
      } catch {
        // Not a directory or doesn't exist
      }
    }
  }
  
  try {
    for (const file of filesToZip) {
      // Validate file exists first
      const normalizedPath = file.startsWith('/') ? file : '/' + file
      const content = await readFile(normalizedPath)
      
      if (content === null || content === undefined) {
        // File doesn't exist - error out
        return {
          stdout: '',
          stderr: `zip: ${file}: No such file or directory`,
          exitCode: 1,
          success: false,
        }
      }
      
      const zipEntryName = file.startsWith('/') ? file.slice(1) : file
      await addToZip(file, zipEntryName)
    }
    
    if (fileCount === 0) {
      return {
        stdout: '',
        stderr: 'zip: no files added to archive',
        exitCode: 1,
        success: false,
      }
    }
    
    // Generate zip file
    const zipData = await zip.generateAsync({ type: 'uint8array' })
    const savePath = archiveName.startsWith('/') ? archiveName : '/' + archiveName
    await saveFile(savePath, zipData)
    
    return {
      stdout: `  adding: ${fileCount} file(s)\ncreated: ${archiveName} (${zipData.length} bytes)`,
      stderr: '',
      exitCode: 0,
      success: true,
    }
  } catch (error: any) {
    return {
      stdout: '',
      stderr: `zip: ${error.message || 'error creating archive'}`,
      exitCode: 1,
      success: false,
    }
  }
}

/**
 * JavaScript implementation of unzip command using JSZip
 * Supports: unzip archive.zip [-d directory]
 */
export async function jsUnzip(
  args: string[],
  readFile: (path: string) => Promise<Uint8Array | string | null>,
  saveFile: (path: string, content: Uint8Array) => Promise<void>,
  mkdir: (path: string) => Promise<void>
): Promise<BashResult> {
  // Dynamic import JSZip
  const JSZip = (await import('jszip')).default
  
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    return {
      stdout: `Usage: unzip [options] archive.zip
Options:
  -d dir          Extract to specified directory
  -l              List contents only (don't extract)
  --help          Show this help

Examples:
  unzip archive.zip
  unzip archive.zip -d output/
  unzip -l archive.zip`,
      stderr: '',
      exitCode: args.length === 0 ? 1 : 0,
      success: args.length > 0,
    }
  }
  
  let archiveName = ''
  let outputDir = ''
  let listOnly = false
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-d' && args[i + 1]) {
      outputDir = args[i + 1]
      i++
    } else if (arg === '-l') {
      listOnly = true
    } else if (!arg.startsWith('-')) {
      archiveName = arg
    }
  }
  
  if (!archiveName) {
    return {
      stdout: '',
      stderr: 'unzip: missing archive name',
      exitCode: 1,
      success: false,
    }
  }
  
  try {
    // Read zip file
    const zipPath = archiveName.startsWith('/') ? archiveName : '/' + archiveName
    const zipContent = await readFile(zipPath)
    
    if (!zipContent) {
      return {
        stdout: '',
        stderr: `unzip: cannot find ${archiveName}`,
        exitCode: 1,
        success: false,
      }
    }
    
    const zipData = zipContent instanceof Uint8Array ? zipContent : new TextEncoder().encode(zipContent)
    const zip = await JSZip.loadAsync(zipData)
    
    if (listOnly) {
      // List contents
      const lines: string[] = ['Archive: ' + archiveName, '  Length      Name', '---------  ----']
      let totalSize = 0
      
      for (const [name, file] of Object.entries(zip.files)) {
        if (!file.dir) {
          const content = await file.async('uint8array')
          totalSize += content.length
          lines.push(`  ${content.length.toString().padStart(7)}  ${name}`)
        }
      }
      
      lines.push('---------  ----')
      lines.push(`  ${totalSize.toString().padStart(7)}  ${Object.keys(zip.files).length} file(s)`)
      
      return {
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
        success: true,
      }
    }
    
    // Extract files
    const outputBase = outputDir ? (outputDir.startsWith('/') ? outputDir : '/' + outputDir) : ''
    const extracted: string[] = []
    
    for (const [name, file] of Object.entries(zip.files)) {
      const outPath = outputBase + '/' + name
      
      if (file.dir) {
        // Create directory
        await mkdir(outPath)
      } else {
        // Extract file
        const content = await file.async('uint8array')
        
        // Ensure parent directory exists
        const parentDir = outPath.substring(0, outPath.lastIndexOf('/'))
        if (parentDir) {
          await mkdir(parentDir)
        }
        
        await saveFile(outPath, content)
        extracted.push(name)
      }
    }
    
    return {
      stdout: `Archive: ${archiveName}\n` + extracted.map(f => `  extracting: ${f}`).join('\n'),
      stderr: '',
      exitCode: 0,
      success: true,
    }
  } catch (error: any) {
    return {
      stdout: '',
      stderr: `unzip: ${error.message || 'error extracting archive'}`,
      exitCode: 1,
      success: false,
    }
  }
}

/**
 * Get Wasmer status info
 */
export function getWasmerStatus(): {
  initialized: boolean
  bashLoaded: boolean
  coreutilsLoaded: boolean
  crossOriginIsolated: boolean
} {
  return {
    initialized: wasmerInitialized,
    bashLoaded: bashPackage !== null,
    coreutilsLoaded: coreutilsPackage !== null,
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
  }
}
