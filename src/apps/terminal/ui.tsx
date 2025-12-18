// src/apps/terminal/ui.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { readFile } from '../../vfs/fs'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

// Browser WASI shim - pure JS implementation
import { WASI, File, OpenFile, PreopenDirectory, Directory } from '@bjorn3/browser_wasi_shim'

// Wasmer SDK for bash shell support
import {
  initWasmer,
  checkCrossOriginIsolation,
  runBashCommand,
  runBashScript,
  runCoreutil,
  listCoreutilsCommands,
  getWasmerStatus,
  InteractiveBashSession,
  loadBash,
  loadCoreutils,
  isCoreutilsCommand,
  getLoadedCoreutilsCommands,
  KNOWN_COREUTILS_COMMANDS,
  BASH_ONLY_COMMANDS,
  JS_IMPLEMENTED_COMMANDS,
  jsGrep,
  jsSed,
  jsAwk,
  jsFind,
  jsWget,
  jsZip,
  jsUnzip,
  preloadWasmerPackages,
} from '../../wasm/wasmerBash'

// Buffer polyfill for browser
import { Buffer } from 'buffer'

type Props = {}

export default function TerminalWasi(_: Props) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [currentDirectory, setCurrentDirectory] = useState('~')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const currentLineRef = useRef('')
  const currentDirRef = useRef('~')
  const bashSessionRef = useRef<InteractiveBashSession | null>(null)
  const inBashModeRef = useRef(false)
  const inPythonModeRef = useRef(false)
  const wasmerReadyRef = useRef(false)

  const username = 'nihal'

  // Keep currentDirRef in sync
  useEffect(() => {
    currentDirRef.current = currentDirectory
  }, [currentDirectory])

  // Command suggestions database (built-in + coreutils + JS implemented)
  const commands = [
    // Built-in ZynqOS commands
    'ls', 'cat', 'mkdir', 'rm', 'touch', 'upload', 'clear', 'help',
    'cd', 'pwd', 'echo', 'whoami', 'date', 'uname', 'tree', 'run',
    'bash', 'sh', 'bash-status', 'coreutils',
    // Coreutils (available via Wasmer)
    'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'tr', 'tee',
    'cp', 'mv', 'ln', 'stat', 'basename', 'dirname', 'seq', 'env', 'sleep',
    // JS-implemented commands
    'grep', 'sed', 'awk', 'find', 'wget', 'zip', 'unzip',
  ]

  // Helper functions for VFS
  function normalizePathForVfs(p: string): string {
    if (!p) return ''
    if (p === '~' || p === '/') return ''
    let s = p
    if (s.startsWith('/')) s = s.slice(1)
    if (s.endsWith('/')) s = s.slice(0, -1)
    return s
  }

  function parentDir(normPath: string): string {
    if (!normPath) return ''
    const parts = normPath.split('/').filter(Boolean)
    parts.pop()
    return parts.length ? parts.join('/') : ''
  }

  function extractImmediateChildren(keys: string[], parentNorm: string) {
    const set = new Set<string>()
    const prefix = parentNorm ? parentNorm + '/' : ''
    const prefixWithSlash = parentNorm ? '/' + parentNorm + '/' : '/'
    
    for (let k of keys) {
      if (!k) continue
      
      // Normalize the key - remove leading slash for consistent comparison
      let normalizedKey = k.startsWith('/') ? k.slice(1) : k
      
      if (!parentNorm) {
        // Root level - get first path component
        const first = normalizedKey.split('/')[0]
        if (!first) continue
        const isDir = normalizedKey.includes('/')
        set.add(isDir ? `${first}/` : first)
      } else {
        // Check if key is exactly the parent (skip it)
        if (normalizedKey === parentNorm || normalizedKey === parentNorm + '/') continue
        
        // Check if key starts with parent prefix
        if (!normalizedKey.startsWith(prefix)) continue
        
        const remainder = normalizedKey.slice(prefix.length)
        if (!remainder) continue
        
        const child = remainder.split('/')[0]
        if (!child) continue
        
        const isDir = remainder.includes('/')
        set.add(isDir ? `${child}/` : child)
      }
    }
    return Array.from(set).sort()
  }

  // Write prompt to terminal
  const writePrompt = useCallback((term: Terminal) => {
    const dir = currentDirRef.current
    term.write(`\r\n\x1b[36m┌──(${username}㉿Nyx)-[${dir}]\x1b[0m\r\n`)
    term.write(`\x1b[36m└$\x1b[0m `)
  }, [username])

  // Write a line of output
  const writeLine = useCallback((term: Terminal, text: string) => {
    term.write(`${text}\r\n`)
  }, [])

  // Sync modified files from WASI filesystem back to VFS
  async function syncFilesystemToVFS(rootFiles: Map<string, File | Directory>, term: Terminal) {
    const { writeFile: writeVfsFile } = await import('../../vfs/fs')

    async function syncDir(files: Map<string, any>, basePath: string) {
      for (const [name, entry] of files) {
        const fullPath = basePath + name
        if (entry && 'data' in entry && entry.data instanceof Uint8Array) {
          try {
            await writeVfsFile(fullPath, entry.data)
          } catch (e) {
            console.error(`Error syncing ${fullPath}:`, e)
          }
        } else if (entry && 'contents' in entry) {
          await syncDir(entry.contents, fullPath + '/')
        }
      }
    }

    await syncDir(rootFiles, '/')
  }

  // run a WASI module that is available via a URL
  async function runWasiFromUrl(term: Terminal, url: string, args: string[] = []) {
    writeLine(term, `> run ${url} ${args.join(' ')}`)
    try {
      writeLine(term, 'fetching wasm...')
      const res = await fetch(url)
      if (!res.ok) {
        writeLine(term, `fetch failed: ${res.status} ${res.statusText}`)
        return
      }
      const bytes = await res.arrayBuffer()
      await runWasiFromBytes(term, new Uint8Array(bytes), url, args)
    } catch (e: any) {
      writeLine(term, `error fetching or running wasm: ${String(e)}`)
      console.error(e)
    }
  }

  // run a WASI module from raw bytes
  async function runWasiFromBytes(term: Terminal, bytes: Uint8Array, originLabel = '<wasm>', args: string[] = []) {
    writeLine(term, `starting ${originLabel}`)
    try {
      let stdoutText = ''
      let stderrText = ''

      const queued: string[] = (window as any).__ZynqOS_WASMFS_SEED_PATHS__ || []
      const filesToMount = ['/input.txt', '/home/demo.txt', ...queued]

      const vfsFiles: Map<string, Uint8Array> = new Map()

      for (const vfsPath of filesToMount) {
        try {
          const data = await readFile(vfsPath)
          if (data) {
            const fileBytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data))
            vfsFiles.set(vfsPath, fileBytes)
            writeLine(term, `loaded ${vfsPath} from VFS`)
          }
        } catch (e) {
          // File doesn't exist, skip
        }
      }

      // Create in-memory files using browser_wasi_shim
      const rootFiles: Map<string, File | Directory> = new Map()
      const homeDirFiles: Map<string, File | Directory> = new Map()

      for (const [path, data] of vfsFiles) {
        const file = new File(data)

        if (path === '/input.txt' || path === 'input.txt') {
          rootFiles.set('input.txt', file)
          writeLine(term, `mounted ${path}`)
        } else if (path.startsWith('/home/')) {
          const filename = path.substring('/home/'.length)
          homeDirFiles.set(filename, file)
          writeLine(term, `mounted ${path}`)
        } else if (path.startsWith('/')) {
          rootFiles.set(path.substring(1), file)
          writeLine(term, `mounted ${path}`)
        }
      }

      // Create /home subdirectory
      const homeDir = new Directory(homeDirFiles)
      rootFiles.set('home', homeDir)

      // Create preopened root directory with our files and subdirectories
      const rootDir = new PreopenDirectory('/', rootFiles)

      // Create stdout/stderr handlers
      const textDecoder = new TextDecoder()
      const stdout = new OpenFile(new File(new Uint8Array()))
      const originalStdoutWrite = stdout.fd_write.bind(stdout)
      stdout.fd_write = function (data: Uint8Array) {
        stdoutText += textDecoder.decode(data)
        return originalStdoutWrite(data)
      }

      const stderr = new OpenFile(new File(new Uint8Array()))
      const originalStderrWrite = stderr.fd_write.bind(stderr)
      stderr.fd_write = function (data: Uint8Array) {
        stderrText += textDecoder.decode(data)
        return originalStderrWrite(data)
      }

      // Create WASI instance with browser_wasi_shim
      // The constructor signature is: WASI(args, env, fds, options)
      // fds should be an array starting with [stdin, stdout, stderr, ...preopened_dirs]
      const wasi = new WASI(
        [originLabel, ...args],                    // args
        [],                                         // env
        [
          new OpenFile(new File(new Uint8Array())), // stdin (fd 0)
          stdout,                                   // stdout (fd 1)
          stderr,                                   // stderr (fd 2)
          rootDir,                                  // preopened root (fd 3)
        ],
        { debug: false }                           // options
      )

      // Compile and instantiate the WASM module
      const wasmModule = await WebAssembly.compile(bytes.buffer as ArrayBuffer)
      const instance = await WebAssembly.instantiate(wasmModule, {
        wasi_snapshot_preview1: wasi.wasiImport,
      })

      // Start the WASI program
      wasi.start(instance as any)

      // Sync filesystem changes back to VFS
      await syncFilesystemToVFS(rootFiles, term)

      // Display captured output
      if (stdoutText) {
        stdoutText.split('\n').forEach(line => writeLine(term, line))
      }
      if (stderrText) {
        writeLine(term, '--- stderr ---')
        stderrText.split('\n').forEach(line => writeLine(term, line))
      }

      writeLine(term, `program ${originLabel} finished`)
    } catch (e: any) {
      writeLine(term, `runtime error: ${String(e)}`)
      console.error(e)
    }
  }

  // run a wasm blob stored in the ZynqOS VFS at /apps/...
  async function runWasiFromVfs(term: Terminal, path: string, args: string[] = []) {
    writeLine(term, `> run-vfs ${path}`)
    try {
      const b = await readFile(path)
      if (!b) {
        writeLine(term, `file not found in VFS: ${path}`)
        return
      }
      let wasmBytes: Uint8Array
      if (typeof b === 'string') {
        wasmBytes = new TextEncoder().encode(b)
      } else {
        wasmBytes = b as Uint8Array
      }
      await runWasiFromBytes(term, wasmBytes, path, args)
    } catch (e: any) {
      writeLine(term, `error reading VFS: ${String(e)}`)
    }
  }

  // allow user file upload (select a local .wasm file and run it)
  async function runWasiFromFile(term: Terminal, file: globalThis.File) {
    writeLine(term, `> upload-run ${file.name}`)
    const buf = new Uint8Array(await file.arrayBuffer())
    await runWasiFromBytes(term, buf, file.name, [])
  }

  // Parse command line respecting quotes (like a shell)
  function parseCommandLine(line: string): string[] {
    const args: string[] = []
    let current = ''
    let inSingleQuote = false
    let inDoubleQuote = false
    let escaped = false
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      
      if (escaped) {
        current += char
        escaped = false
        continue
      }
      
      if (char === '\\' && !inSingleQuote) {
        escaped = true
        continue
      }
      
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote
        continue
      }
      
      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote
        continue
      }
      
      if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
        if (current) {
          args.push(current)
          current = ''
        }
        continue
      }
      
      current += char
    }
    
    if (current) {
      args.push(current)
    }
    
    return args
  }

  // parse and run user-entered command
  async function handleCommandLine(term: Terminal, line: string) {
    const trimmed = line.trim()
    if (!trimmed) return
    const parts = parseCommandLine(trimmed)
    const c = parts[0]

    if (c === 'help') {
      writeLine(term, 'ZynqOS Terminal - Available Commands:')
      writeLine(term, '')
      writeLine(term, '\x1b[1;36mFile System:\x1b[0m')
      writeLine(term, '  ls [path]                       # list directory contents')
      writeLine(term, '  cd <path>                       # change directory')
      writeLine(term, '  pwd                             # print working directory')
      writeLine(term, '  cat <file>                      # display file contents')
      writeLine(term, '  mkdir <dir>                     # create directory')
      writeLine(term, '  touch <file>                    # create empty file')
      writeLine(term, '  rm <path>                       # remove file/directory')
      writeLine(term, '  tree [path]                     # show directory tree')
      writeLine(term, '')
      writeLine(term, '\x1b[1;36mText Processing:\x1b[0m')
      writeLine(term, '  grep <pattern> <file>           # search for pattern in file')
      writeLine(term, '  sed \'s/old/new/g\' <file>        # stream editor')
      writeLine(term, '  awk \'{print $1}\' <file>         # pattern processing')
      writeLine(term, '  head -n N <file>                # show first N lines')
      writeLine(term, '  tail -n N <file>                # show last N lines')
      writeLine(term, '  wc -l <file>                    # count lines/words/chars')
      writeLine(term, '  sort <file>                     # sort lines')
      writeLine(term, '')
      writeLine(term, '\x1b[1;36mFile Search & Transfer:\x1b[0m')
      writeLine(term, '  find [path] -name "*.txt"       # search for files')
      writeLine(term, '  wget <url>                      # download file from URL')
      writeLine(term, '  wget -x <url>                   # download via CORS proxy')
      writeLine(term, '  wget -O file.txt <url>          # download and save as')
      writeLine(term, '')
      writeLine(term, '\x1b[1;36mCompression:\x1b[0m')
      writeLine(term, '  zip archive.zip file1 file2     # create zip archive')
      writeLine(term, '  zip -r archive.zip folder/      # zip folder recursively')
      writeLine(term, '  unzip archive.zip               # extract zip archive')
      writeLine(term, '  unzip -l archive.zip            # list zip contents')
      writeLine(term, '')
      writeLine(term, '\x1b[1;35mPython (Pyodide):\x1b[0m')
      writeLine(term, '  python                          # start interactive Python REPL')
      writeLine(term, '  python <script.py>              # run a Python script')
      writeLine(term, '  python -c "print(\'Hello\')"      # execute Python code')
      writeLine(term, '  pip install <package>           # install Python package')
      writeLine(term, '  pip list                        # list installed packages')
      writeLine(term, '')
      writeLine(term, '\x1b[1;36mApps:\x1b[0m')
      writeLine(term, '  Launch by name: files (alias: zynqpad) | terminal | python | calculator | store | wednesday')
      writeLine(term, '')
      writeLine(term, '\x1b[1;36mWASI Programs:\x1b[0m')
      writeLine(term, '  run <path> [args...]            # run WASI binary')
      writeLine(term, '  upload                          # upload and run .wasm file')
      writeLine(term, '')
      writeLine(term, '\x1b[1;33mBash Shell (Wasmer):\x1b[0m')
      writeLine(term, '  bash                            # start interactive bash shell')
      writeLine(term, '  bash <script.sh> [args...]      # run a bash script')
      writeLine(term, '  coreutils <cmd> [args...]       # run GNU coreutils command')
      writeLine(term, '  bash-status                     # check bash/wasmer status')
      writeLine(term, '')
      writeLine(term, '\x1b[1;36mSystem:\x1b[0m')
      writeLine(term, '  echo <text>                     # print text')
      writeLine(term, '  clear                           # clear terminal')
      writeLine(term, '  whoami                          # show current user')
      writeLine(term, '  date                            # show current date/time')
      writeLine(term, '  uname                           # show system info')
      writeLine(term, '  help                            # show this help')
      writeLine(term, '')
      writeLine(term, '\x1b[90mTip: Use <command> --help for detailed usage\x1b[0m')
    } else if (c === 'ls') {
      const path = parts[1] || currentDirRef.current
      try {
        const { readdir } = await import('../../vfs/fs')
        const requestedNorm = normalizePathForVfs(path === '~' ? '' : path)
        const keys = await readdir(requestedNorm)
        writeLine(term, '  .')
        writeLine(term, '  ..')
        const children = extractImmediateChildren(keys, requestedNorm)
        if (children.length > 0) {
          children.forEach(ch => writeLine(term, `  ${ch}`))
        }
      } catch (e) {
        writeLine(term, `ls: cannot access '${path}': ${String(e)}`)
      }
    } else if (c === 'cd') {
      const path = parts[1]
      if (!path) {
        currentDirRef.current = '~'
        setCurrentDirectory('~')
        return
      }

      if (path === '.') return
      if (path === '~') { currentDirRef.current = '~'; setCurrentDirectory('~'); return }

      const currentNorm = normalizePathForVfs(currentDirRef.current === '~' ? '' : currentDirRef.current)
      let targetNorm = ''
      if (path.startsWith('/')) {
        targetNorm = normalizePathForVfs(path)
      } else {
        const curParts = currentNorm ? currentNorm.split('/').filter(Boolean) : []
        const relParts = path.split('/').filter(Boolean)
        for (const p of relParts) {
          if (p === '..') {
            curParts.pop()
          } else if (p === '.') {
            // noop
          } else {
            curParts.push(p)
          }
        }
        targetNorm = curParts.join('/')
      }

      try {
        const { readdir } = await import('../../vfs/fs')
        const parent = parentDir(targetNorm)
        const keys = await readdir(parent)
        const children = extractImmediateChildren(keys, parent)
        const baseName = targetNorm ? targetNorm.split('/').pop() || '' : ''
        const hasDir = children.includes(baseName + '/') || children.includes(baseName)
        if (targetNorm === '' || hasDir) {
          const newDir = targetNorm === '' ? '~' : '/' + targetNorm
          currentDirRef.current = newDir
          setCurrentDirectory(newDir)
        } else {
          writeLine(term, `cd: ${path}: No such file or directory`)
        }
      } catch (e) {
        writeLine(term, `cd: ${path}: No such file or directory`)
      }
    } else if (c === 'pwd') {
      writeLine(term, currentDirRef.current === '~' ? '/home/user' : currentDirRef.current)
    } else if (c === 'cat') {
      const p = parts[1]
      if (!p) {
        writeLine(term, 'usage: cat <file>')
        return
      }
      try {
        const { readFile } = await import('../../vfs/fs')
        // Try multiple path formats since VFS might store with or without leading slash
        const withSlash = p.startsWith('/') ? p : '/' + p
        const withoutSlash = p.startsWith('/') ? p.slice(1) : p
        
        let v = await readFile(withSlash)
        if (v === null || v === undefined) {
          v = await readFile(withoutSlash)
        }
        
        if (v === null || v === undefined) {
          writeLine(term, `cat: ${p}: No such file`)
          return
        }
        if (v instanceof Uint8Array) {
          try {
            const txt = new TextDecoder().decode(v)
            // Split by newlines and write each line properly
            txt.split('\n').forEach(line => writeLine(term, line))
          } catch {
            writeLine(term, `(binary file, ${v.length} bytes)`)
          }
        } else {
          // Split by newlines and write each line properly
          String(v).split('\n').forEach(line => writeLine(term, line))
        }
      } catch (e) {
        writeLine(term, `cat: ${p}: ${String(e)}`)
      }
    } else if (c === 'mkdir') {
      const dir = parts[1]
      if (!dir) {
        writeLine(term, 'usage: mkdir <directory>')
        return
      }
      try {
        const { writeFile } = await import('../../vfs/fs')
        // Always store with leading slash for consistency
        const normalizedPath = dir.startsWith('/') ? dir : '/' + dir
        await writeFile(`${normalizedPath}/.keep`, '')
        writeLine(term, `mkdir: created directory '${dir}'`)
      } catch (e) {
        writeLine(term, `mkdir: cannot create directory '${dir}': ${String(e)}`)
      }
    } else if (c === 'touch') {
      const file = parts[1]
      if (!file) {
        writeLine(term, 'usage: touch <file>')
        return
      }
      try {
        const { readFile, writeFile } = await import('../../vfs/fs')
        // Always store with leading slash for consistency
        const normalizedPath = file.startsWith('/') ? file : '/' + file
        // Check if file already exists (try both formats)
        let existing = await readFile(normalizedPath)
        if (existing === null || existing === undefined) {
          existing = await readFile(normalizedPath.slice(1))
        }
        if (existing !== null && existing !== undefined) {
          writeLine(term, `touch: '${file}'`)
        } else {
          await writeFile(normalizedPath, '')
          writeLine(term, `touch: created '${file}'`)
        }
      } catch (e) {
        writeLine(term, `touch: cannot touch '${file}': ${String(e)}`)
      }
    } else if (c === 'echo') {
      const text = parts.slice(1).join(' ')
      writeLine(term, text)
    } else if (c === 'whoami') {
      writeLine(term, username)
    } else if (c === 'date') {
      writeLine(term, new Date().toString())
    } else if (c === 'uname') {
      writeLine(term, 'ZynqOS v0.3 (Browser WASI Runtime)')
    } else if (c === 'tree') {
      const path = parts[1] || currentDirRef.current
      try {
        const { readdir } = await import('../../vfs/fs')
        const keys = await readdir(path === '~' ? '' : path)
        writeLine(term, path)
        keys.forEach((k, i) => {
          const isLast = i === keys.length - 1
          writeLine(term, `${isLast ? '└──' : '├──'} ${k}`)
        })
      } catch (e) {
        writeLine(term, `tree: ${path}: ${String(e)}`)
      }
    } else if (c === 'rm') {
      const cmdArgs = parts.slice(1)
      let recursive = false
      let force = false
      const targets: string[] = []

      for (const a of cmdArgs) {
        if (a.startsWith('-')) {
          if (a.includes('r')) recursive = true
          if (a.includes('f')) force = true
        } else {
          targets.push(a)
        }
      }

      if (targets.length === 0) {
        writeLine(term, 'usage: rm [-r] <file|directory>')
        return
      }

      try {
        const { readdir, removeFile } = await import('../../vfs/fs')

        for (const t of targets) {
          const targetNorm = normalizePathForVfs(t)
          const prefixes = [targetNorm, targetNorm ? '/' + targetNorm : '/']

          const allMatches: string[] = []
          for (const p of prefixes) {
            try {
              const keys = await readdir(p)
              keys.forEach(k => allMatches.push(k))
            } catch {
              // ignore
            }
          }

          if (recursive) {
            const unique = Array.from(new Set(allMatches))
            if (unique.length === 0 && !force) {
              writeLine(term, `rm: cannot remove '${t}': No such file or directory`)
              continue
            }
            for (const k of unique) {
              try {
                await removeFile(k)
              } catch (e) {
                if (!force) writeLine(term, `rm: failed to remove '${k}': ${String(e)}`)
              }
            }
            try { await removeFile(targetNorm) } catch { }
            try { await removeFile('/' + targetNorm) } catch { }
            writeLine(term, `rm: removed '${t}'`)
            continue
          }

          const uniq = Array.from(new Set(allMatches))
          const hasChildren = uniq.some(k => {
            const nk = k.startsWith('/') ? k.slice(1) : k
            const norm = targetNorm
            return nk !== norm && nk.startsWith(norm + '/')
          })
          if (hasChildren) {
            writeLine(term, `rm: cannot remove '${t}': Is a directory (use 'rm -r' for directories)`)
            continue
          }

          let deleted = false
          try { await removeFile(targetNorm); deleted = true } catch { }
          try { await removeFile('/' + targetNorm); deleted = true } catch { }

          if (!deleted) {
            if (!force) writeLine(term, `rm: cannot remove '${t}': No such file or directory`)
          } else {
            writeLine(term, `rm: removed '${t}'`)
          }
        }
      } catch (e) {
        writeLine(term, `rm: cannot remove: ${String(e)}`)
      }
    } else if (c === 'run') {
      const wasmPath = parts[1]
      const wasmArgs = parts.slice(2)
      if (!wasmPath) {
        writeLine(term, 'usage: run <path.wasm> [args...]')
        return
      }
      if (wasmPath.startsWith('/apps/') || wasmPath.startsWith('http')) {
        await runWasiFromUrl(term, wasmPath, wasmArgs)
      } else {
        await runWasiFromVfs(term, wasmPath, wasmArgs)
      }
    } else if (c === 'bash' || c === 'sh') {
      // Execute a .sh script file or start interactive bash
      const scriptPath = parts[1]
      const scriptArgs = parts.slice(2)

      // Check cross-origin isolation first
      const coiCheck = checkCrossOriginIsolation()
      if (!coiCheck.supported) {
        writeLine(term, `\x1b[31mbash: ${coiCheck.reason}\x1b[0m`)
        writeLine(term, 'Bash requires Cross-Origin Isolation (COOP/COEP headers).')
        writeLine(term, 'If running locally, restart the dev server.')
        return
      }

      if (!scriptPath) {
        // Start interactive bash session
        writeLine(term, '\x1b[33mStarting interactive bash shell...\x1b[0m')
        writeLine(term, 'Loading bash from Wasmer registry (this may take a moment)...')

        try {
          await loadBash()
          await loadCoreutils()

          inBashModeRef.current = true
          const session = new InteractiveBashSession()
          bashSessionRef.current = session

          await session.start({
            onOutput: (data) => {
              // Handle output from bash
              term.write(data.replace(/\n/g, '\r\n'))
            },
            onError: (data) => {
              term.write(`\x1b[31m${data.replace(/\n/g, '\r\n')}\x1b[0m`)
            },
            onExit: (code) => {
              inBashModeRef.current = false
              bashSessionRef.current = null
              writeLine(term, `\r\n\x1b[33mBash exited with code ${code}\x1b[0m`)
              writePrompt(term)
            },
            env: {
              USER: username,
              HOME: '/home/' + username,
              PWD: currentDirRef.current === '~' ? '/home/' + username : currentDirRef.current,
            },
          })

          writeLine(term, '\x1b[32mBash shell started. Type "exit" to return to ZynqOS terminal.\x1b[0m')
        } catch (e: any) {
          writeLine(term, `\x1b[31mbash: failed to start: ${String(e)}\x1b[0m`)
          inBashModeRef.current = false
          bashSessionRef.current = null
        }
        return
      }

      // Execute a script file
      writeLine(term, `\x1b[36mExecuting script: ${scriptPath}\x1b[0m`)

      try {
        // Try to read the script from VFS
        const { readFile: readVfsFile } = await import('../../vfs/fs')
        const withSlash = scriptPath.startsWith('/') ? scriptPath : '/' + scriptPath
        const withoutSlash = scriptPath.startsWith('/') ? scriptPath.slice(1) : scriptPath

        let scriptContent = await readVfsFile(withSlash)
        if (scriptContent === null || scriptContent === undefined) {
          scriptContent = await readVfsFile(withoutSlash)
        }

        if (scriptContent === null || scriptContent === undefined) {
          writeLine(term, `\x1b[31mbash: ${scriptPath}: No such file\x1b[0m`)
          return
        }

        let scriptText: string
        if (scriptContent instanceof Uint8Array) {
          scriptText = new TextDecoder().decode(scriptContent)
        } else {
          scriptText = String(scriptContent)
        }

        writeLine(term, 'Running script with bash...')

        // Load all VFS files that the script might need
        const { readdir } = await import('../../vfs/fs')
        const vfsFiles = new Map<string, Uint8Array | string>()
        
        try {
          // Get all files from VFS root
          const allKeys = await readdir('')
          for (const key of allKeys) {
            if (!key || key.endsWith('/')) continue // Skip directories
            try {
              const filePath = key.startsWith('/') ? key : '/' + key
              const content = await readVfsFile(filePath)
              if (content !== null && content !== undefined) {
                if (content instanceof Uint8Array) {
                  vfsFiles.set(filePath, content)
                } else {
                  vfsFiles.set(filePath, String(content))
                }
              }
            } catch {
              // Skip files that can't be read
            }
          }
        } catch (e) {
          console.warn('[bash] Could not load VFS files:', e)
        }

        // Show how many files were loaded
        if (vfsFiles.size > 0) {
          writeLine(term, `\x1b[90mMounted ${vfsFiles.size} VFS file(s)\x1b[0m`)
        }

        const result = await runBashScript(scriptText, scriptArgs, {
          env: {
            USER: username,
            HOME: '/home/' + username,
            PWD: currentDirRef.current === '~' ? '/home/' + username : currentDirRef.current,
          },
          vfsFiles,
        })

        if (result.stdout) {
          result.stdout.split('\n').forEach(line => {
            if (line) writeLine(term, line)
          })
        }
        if (result.stderr) {
          result.stderr.split('\n').forEach(line => {
            if (line) writeLine(term, `\x1b[31m${line}\x1b[0m`)
          })
        }

        if (!result.success) {
          writeLine(term, `\x1b[33mScript exited with code ${result.exitCode}\x1b[0m`)
          // Show stderr if no output was shown
          if (!result.stdout && !result.stderr) {
            writeLine(term, `\x1b[33mNo output. The script may have failed silently.\x1b[0m`)
          }
        }
      } catch (e: any) {
        writeLine(term, `\x1b[31mbash: error: ${String(e)}\x1b[0m`)
      }
    } else if (c === 'bash-status') {
      // Show bash/wasmer status
      const coiCheck = checkCrossOriginIsolation()
      const status = getWasmerStatus()

      writeLine(term, '\x1b[1;36mBash Shell Status:\x1b[0m')
      writeLine(term, `  Cross-Origin Isolated: ${coiCheck.supported ? '\x1b[32m✓ Yes\x1b[0m' : '\x1b[31m✗ No\x1b[0m'}`)
      if (!coiCheck.supported) {
        writeLine(term, `    \x1b[33m${coiCheck.reason}\x1b[0m`)
      }
      writeLine(term, `  Wasmer SDK Initialized: ${status.initialized ? '\x1b[32m✓ Yes\x1b[0m' : '\x1b[33m○ No\x1b[0m'}`)
      writeLine(term, `  Bash Package Loaded: ${status.bashLoaded ? '\x1b[32m✓ Yes\x1b[0m' : '\x1b[33m○ No\x1b[0m'}`)
      writeLine(term, `  Coreutils Loaded: ${status.coreutilsLoaded ? '\x1b[32m✓ Yes\x1b[0m' : '\x1b[33m○ No\x1b[0m'}`)
      writeLine(term, '')
      writeLine(term, 'To use bash, run: \x1b[1mbash\x1b[0m (interactive) or \x1b[1mbash script.sh\x1b[0m')
    } else if (c === 'coreutils') {
      // Run a GNU coreutils command via Wasmer
      const utilCmd = parts[1]
      const utilArgs = parts.slice(2)

      if (!utilCmd || utilCmd === '--help') {
        writeLine(term, '\x1b[1;36mGNU Coreutils via Wasmer:\x1b[0m')
        writeLine(term, 'Usage: coreutils <command> [args...]')
        writeLine(term, '')

        const coiCheck = checkCrossOriginIsolation()
        if (!coiCheck.supported) {
          writeLine(term, `\x1b[31mNote: ${coiCheck.reason}\x1b[0m`)
          return
        }

        try {
          writeLine(term, 'Available commands:')
          const cmds = await listCoreutilsCommands()
          // Display in columns
          const cols = 6
          for (let i = 0; i < cmds.length; i += cols) {
            const row = cmds.slice(i, i + cols).map(c => c.padEnd(12)).join('')
            writeLine(term, `  ${row}`)
          }
        } catch (e) {
          writeLine(term, 'Run \x1b[1mcoreutils --help\x1b[0m after loading bash to see available commands.')
        }
        return
      }

      const coiCheck = checkCrossOriginIsolation()
      if (!coiCheck.supported) {
        writeLine(term, `\x1b[31mcoreutils: ${coiCheck.reason}\x1b[0m`)
        return
      }

      try {
        // Load VFS files for the command
        const vfsFiles = new Map<string, Uint8Array | string>()
        const { readFile: readVfsFile } = await import('../../vfs/fs')
        
        for (const arg of utilArgs) {
          if (arg.startsWith('-')) continue
          const filePath = arg.startsWith('/') ? arg : '/' + arg
          try {
            const content = await readVfsFile(filePath)
            if (content !== null && content !== undefined) {
              if (content instanceof Uint8Array) {
                vfsFiles.set(filePath, content)
              } else {
                vfsFiles.set(filePath, String(content))
              }
            }
          } catch {
            // File doesn't exist, coreutils will handle error
          }
        }

        const result = await runCoreutil(utilCmd, utilArgs, { vfsFiles })

        if (result.stdout) {
          result.stdout.split('\n').forEach(line => {
            if (line) writeLine(term, line)
          })
        }
        if (result.stderr) {
          result.stderr.split('\n').forEach(line => {
            if (line) writeLine(term, `\x1b[31m${line}\x1b[0m`)
          })
        }
      } catch (e: any) {
        writeLine(term, `\x1b[31mcoreutils: ${String(e)}\x1b[0m`)
      }
    } else if (c === 'clear') {
      term.clear()
    } else if (c === 'python' || c === 'python3' || c === 'py') {
      // Python REPL or script execution
      const args = parts.slice(1)
      
      if (args.length === 0) {
        // Interactive REPL
        writeLine(term, '\x1b[1;33mPython REPL - Enter Python code (type "exit()" to quit)\x1b[0m')
        writeLine(term, 'Loading Pyodide...')
        
        try {
          const { getPyodide, runPython } = await import('../../wasm/pyodideLoader')
          await getPyodide() // Load Pyodide
          writeLine(term, '\x1b[1;32m✓ Pyodide loaded. Type your Python code:\x1b[0m')
          
          // Enter Python REPL mode
          inPythonModeRef.current = true
          term.write('\r\n>>> ')
        } catch (e: any) {
          writeLine(term, `\x1b[31mError loading Python: ${String(e)}\x1b[0m`)
        }
      } else if (args[0] === '-c' && args.length > 1) {
        // Execute code from command line
        const code = args.slice(1).join(' ')
        writeLine(term, 'Running Python code...')
        
        try {
          const { runPython } = await import('../../wasm/pyodideLoader')
          let streamed = false
          const result = await runPython(code, undefined, (chunk, stream) => {
            streamed = true
            chunk.split('\n').forEach(line => writeLine(term, line))
          })
          if (!streamed && result) {
            result.split('\n').forEach(line => writeLine(term, line))
          }
        } catch (e: any) {
          writeLine(term, `\x1b[31m${String(e)}\x1b[0m`)
        }
      } else {
        // Execute Python file
        const scriptPath = args[0]
        const filePath = scriptPath.startsWith('/') ? scriptPath : '/' + scriptPath
        
        writeLine(term, `Running ${filePath}...`)
        
        try {
          const { runPythonFile } = await import('../../wasm/pyodideLoader')
          let streamed = false
          const result = await runPythonFile(filePath, (chunk, stream) => {
            streamed = true
            chunk.split('\n').forEach(line => writeLine(term, line))
          })
          if (!streamed && result) {
            result.split('\n').forEach(line => writeLine(term, line))
          }
        } catch (e: any) {
          writeLine(term, `\x1b[31m${String(e)}\x1b[0m`)
        }
      }
    } else if (['files','terminal','zynqpad','text-editor','python','calculator','store','wednesday'].includes(c)) {
      const openWindow = (window as any).ZynqOS_openWindow
      const mappings: Record<string, {title: string, comp?: any, key: string}> = {
        'files': { title: 'Files & Zynqpad', comp: (window as any).__FILE_BROWSER_UI__, key: 'file-browser' },
        'terminal': { title: 'Terminal', comp: (window as any).__TERMINAL_UI__, key: 'terminal' },
        'zynqpad': { title: 'Files & Zynqpad', comp: (window as any).__FILE_BROWSER_UI__, key: 'file-browser' },
        'text-editor': { title: 'Files & Zynqpad', comp: (window as any).__FILE_BROWSER_UI__, key: 'file-browser' },
        'python': { title: 'Python REPL', comp: (window as any).__PYTHON_UI__, key: 'python' },
        'calculator': { title: 'Calculator', comp: (window as any).__CALC_UI__, key: 'calculator' },
        'store': { title: 'App Store', comp: (window as any).__STORE_UI__, key: 'store' },
        'wednesday': { title: 'Wednesday AI', comp: (window as any).__WEDNESDAY_UI__, key: 'wednesday' },
      }
      const m = mappings[c]
      if (!m || !m.comp) { writeLine(term, `${c}: app not available`) ; return }
      openWindow?.(m.title, m.comp, m.key)
      writeLine(term, `opened: ${m.title}`)
    } else if (c === 'pip' || c === 'pip3') {
      // Package installation
      const args = parts.slice(1)
      
      if (args[0] === 'install' && args.length > 1) {
        const packageName = args[1]
        writeLine(term, `Installing ${packageName} via micropip...`)
        
        try {
          const { installPackage } = await import('../../wasm/pyodideLoader')
          const result = await installPackage(packageName)
          writeLine(term, result)
        } catch (e: any) {
          writeLine(term, `\x1b[31m${String(e)}\x1b[0m`)
        }
      } else if (args[0] === 'list') {
        writeLine(term, 'Installed Python packages:')
        
        try {
          const { listPackages } = await import('../../wasm/pyodideLoader')
          const packages = await listPackages()
          packages.forEach(pkg => writeLine(term, `  ${pkg}`))
        } catch (e: any) {
          writeLine(term, `\x1b[31m${String(e)}\x1b[0m`)
        }
      } else {
        writeLine(term, 'Usage:')
        writeLine(term, '  pip install <package>  # Install a Python package')
        writeLine(term, '  pip list               # List installed packages')
      }
    } else {
      // Check if it might be a .sh file being executed directly
      if (c.endsWith('.sh')) {
        // Try to execute as a bash script
        const coiCheck = checkCrossOriginIsolation()
        if (coiCheck.supported) {
          await handleCommandLine(term, `bash ${trimmed}`)
          return
        }
      }

      // Try to run as a coreutils/bash command if cross-origin isolation is available
      const coiCheck = checkCrossOriginIsolation()
      if (coiCheck.supported) {
        // Check if this is a known coreutils command
        const isKnownCoreutil = KNOWN_COREUTILS_COMMANDS.includes(c) || isCoreutilsCommand(c)
        
        if (isKnownCoreutil) {
          // Run directly via coreutils with VFS file mounting
          try {
            // Extract file paths from arguments and load them from VFS
            const vfsFiles = new Map<string, Uint8Array | string>()
            const cmdArgs = parts.slice(1)
            
            // Try to load any file arguments from VFS
            const { readFile: readVfsFile, readdir } = await import('../../vfs/fs')
            for (const arg of cmdArgs) {
              // Skip flags (starting with -)
              if (arg.startsWith('-')) continue
              
              // Try to read the file from VFS
              const filePath = arg.startsWith('/') ? arg : '/' + arg
              try {
                const content = await readVfsFile(filePath)
                if (content !== null && content !== undefined) {
                  if (content instanceof Uint8Array) {
                    vfsFiles.set(filePath, content)
                  } else {
                    vfsFiles.set(filePath, String(content))
                  }
                }
              } catch {
                // File doesn't exist in VFS, that's OK - coreutils will report error
              }
            }
            
            const result = await runCoreutil(c, cmdArgs, { vfsFiles })
            
            if (result.stdout) {
              result.stdout.split('\n').forEach(line => {
                if (line) writeLine(term, line)
              })
            }
            if (result.stderr) {
              result.stderr.split('\n').forEach(line => {
                if (line) writeLine(term, `\x1b[31m${line}\x1b[0m`)
              })
            }
            
            // If command wasn't found in coreutils, show error
            if (result.exitCode === 127) {
              writeLine(term, `\x1b[33mCommand '${c}' not available. Try: help\x1b[0m`)
            }
            return
          } catch (e: any) {
            writeLine(term, `\x1b[31m${c}: ${String(e)}\x1b[0m`)
            return
          }
        }

        // Check if this is a JS-implemented command (grep, sed, awk, find, wget, zip, unzip)
        const isJsImplementedCmd = JS_IMPLEMENTED_COMMANDS.includes(c) || ['zip', 'unzip'].includes(c)
        
        if (isJsImplementedCmd) {
          // Run using JavaScript implementation
          try {
            const { readFile: readVfsFile, writeFile: writeVfsFile, readdir } = await import('../../vfs/fs')
            const cmdArgs = parts.slice(1)
            
            // Handle special commands that don't need file content upfront
            if (c === 'find') {
              // find needs all file paths
              const allFiles = await readdir('')
              const isDirectory = (path: string) => {
                const normalized = path.startsWith('/') ? path.slice(1) : path
                return allFiles.some(f => f.startsWith(normalized + '/'))
              }
              const result = jsFind(cmdArgs, allFiles, isDirectory)
              if (result.stdout) {
                result.stdout.split('\n').forEach(line => {
                  if (line) writeLine(term, line)
                })
              }
              if (result.stderr) {
                result.stderr.split('\n').forEach(line => {
                  if (line) writeLine(term, `\x1b[31m${line}\x1b[0m`)
                })
              }
              return
            }
            
            if (c === 'wget') {
              writeLine(term, `\x1b[90mDownloading...\x1b[0m`)
              const result = await jsWget(cmdArgs, async (path, content) => {
                await writeVfsFile(path, content)
              })
              if (result.stdout) {
                result.stdout.split('\n').forEach(line => {
                  if (line) writeLine(term, line)
                })
              }
              if (result.stderr) {
                result.stderr.split('\n').forEach(line => {
                  if (line) writeLine(term, `\x1b[31m${line}\x1b[0m`)
                })
              }
              return
            }
            
            if (c === 'zip') {
              const result = await jsZip(
                cmdArgs,
                async (path) => {
                  const content = await readVfsFile(path)
                  return content
                },
                async (path, content) => {
                  await writeVfsFile(path, content)
                },
                async (path) => {
                  return await readdir(path)
                }
              )
              if (result.stdout) {
                result.stdout.split('\n').forEach(line => {
                  if (line) writeLine(term, line)
                })
              }
              if (result.stderr) {
                result.stderr.split('\n').forEach(line => {
                  if (line) writeLine(term, `\x1b[31m${line}\x1b[0m`)
                })
              }
              return
            }
            
            if (c === 'unzip') {
              const result = await jsUnzip(
                cmdArgs,
                async (path) => {
                  const content = await readVfsFile(path)
                  return content
                },
                async (path, content) => {
                  await writeVfsFile(path, content)
                },
                async (_path) => {
                  // VFS creates directories implicitly when files are written
                  // So mkdir is a no-op
                }
              )
              if (result.stdout) {
                result.stdout.split('\n').forEach(line => {
                  if (line) writeLine(term, line)
                })
              }
              if (result.stderr) {
                result.stderr.split('\n').forEach(line => {
                  if (line) writeLine(term, `\x1b[31m${line}\x1b[0m`)
                })
              }
              return
            }
            
            // For grep/sed/awk: need to read file content
            // Find the file argument (last non-flag argument)
            let fileArg = ''
            let nonFlagArgs: string[] = []
            for (const arg of cmdArgs) {
              if (!arg.startsWith('-')) {
                nonFlagArgs.push(arg)
              }
            }
            
            // Check for help flag first
            if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) {
              let result
              if (c === 'grep') result = jsGrep(['--help'], '')
              else if (c === 'sed') result = jsSed(['--help'], '')
              else if (c === 'awk') result = jsAwk(['--help'], '')
              else result = { stdout: `${c}: no help available`, stderr: '', exitCode: 0, success: true }
              
              if (result.stdout) writeLine(term, result.stdout)
              return
            }
            
            // For grep/sed: pattern is first non-flag, file is second (or stdin)
            // For awk: program is first non-flag (in quotes), file is second
            if (c === 'grep') {
              fileArg = nonFlagArgs[1] || ''
            } else if (c === 'sed' || c === 'awk') {
              fileArg = nonFlagArgs[1] || ''
            }
            
            // Read file content
            let fileContent = ''
            if (fileArg) {
              const filePath = fileArg.startsWith('/') ? fileArg : '/' + fileArg
              try {
                const content = await readVfsFile(filePath)
                if (content !== null && content !== undefined) {
                  if (content instanceof Uint8Array) {
                    fileContent = new TextDecoder().decode(content)
                  } else {
                    fileContent = String(content)
                  }
                } else {
                  // File exists but is empty or null
                  fileContent = ''
                }
                console.log(`[${c}] Read file ${filePath}, content length: ${fileContent.length}`)
              } catch (e) {
                console.error(`[${c}] Error reading file ${filePath}:`, e)
                writeLine(term, `\x1b[31m${c}: ${fileArg}: No such file or directory\x1b[0m`)
                return
              }
            } else {
              writeLine(term, `\x1b[31m${c}: no input file specified\x1b[0m`)
              return
            }
            
            // Run the JS implementation
            let result
            if (c === 'grep') {
              console.log(`[grep] Pattern: "${cmdArgs[0]}", file content length: ${fileContent.length}`)
              result = jsGrep(cmdArgs, fileContent)
            } else if (c === 'sed') {
              result = jsSed(cmdArgs, fileContent)
            } else if (c === 'awk') {
              result = jsAwk(cmdArgs, fileContent)
            } else {
              writeLine(term, `\x1b[31m${c}: not implemented\x1b[0m`)
              return
            }
            
            console.log(`[${c}] Result:`, result)
            
            if (result.stdout) {
              result.stdout.split('\n').forEach(line => {
                writeLine(term, line)
              })
            }
            if (result.stderr) {
              result.stderr.split('\n').forEach(line => {
                if (line) writeLine(term, `\x1b[31m${line}\x1b[0m`)
              })
            }
            return
          } catch (e: any) {
            writeLine(term, `\x1b[31m${c}: ${String(e)}\x1b[0m`)
            return
          }
        }

        // Check if this is a bash-only command (find, xargs, etc.)
        const isBashOnlyCmd = BASH_ONLY_COMMANDS.includes(c)
        
        // Try running as a bash command (for built-in bash commands or complex expressions)
        if (isBashOnlyCmd || trimmed.includes('|') || trimmed.includes('>') || trimmed.includes('<') || 
            trimmed.includes('&&') || trimmed.includes('||') || trimmed.includes(';') ||
            trimmed.includes('$') || trimmed.includes('`')) {
          // This needs to run via bash
          try {
            // Load VFS files for bash command
            const { readFile: readVfsFile, readdir } = await import('../../vfs/fs')
            const vfsFiles = new Map<string, Uint8Array | string>()
            
            // Extract potential file paths from the command
            const cmdArgs = parts.slice(1)
            for (const arg of cmdArgs) {
              if (arg.startsWith('-')) continue
              const filePath = arg.startsWith('/') ? arg : '/' + arg
              try {
                const content = await readVfsFile(filePath)
                if (content !== null && content !== undefined) {
                  if (content instanceof Uint8Array) {
                    vfsFiles.set(filePath, content)
                  } else {
                    vfsFiles.set(filePath, String(content))
                  }
                }
              } catch {
                // File doesn't exist
              }
            }

            if (isBashOnlyCmd) {
              writeLine(term, `\x1b[90m[running '${c}' via bash]\x1b[0m`)
            }
            
            const result = await runBashScript(trimmed, [], {
              env: {
                USER: username,
                HOME: '/home/' + username,
                PWD: currentDirRef.current === '~' ? '/home/' + username : currentDirRef.current,
              },
              vfsFiles,
            })
            
            if (result.stdout) {
              result.stdout.split('\n').forEach(line => {
                if (line) writeLine(term, line)
              })
            }
            if (result.stderr) {
              result.stderr.split('\n').forEach(line => {
                if (line) writeLine(term, `\x1b[31m${line}\x1b[0m`)
              })
            }
            return
          } catch (e: any) {
            writeLine(term, `\x1b[31mbash: ${String(e)}\x1b[0m`)
            return
          }
        }
      }

      writeLine(term, `unknown command: ${c}`)
      writeLine(term, `\x1b[90mTip: Type 'help' for available commands${coiCheck.supported ? " or try running via 'bash -c \"command\"'" : ''}\x1b[0m`)
    }
  }

  // Initialize xterm.js
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.2,
      theme: {
        background: '#000000',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: '#264f78',
        black: '#0d1117',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#c9d1d9',
        brightBlack: '#484f58',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      allowTransparency: true,
      scrollback: 10000,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)

    term.open(terminalRef.current)
    
    // Wait for DOM to settle before fitting
    setTimeout(() => {
      try {
        fitAddon.fit()
      } catch (err) {
        console.warn('Initial fit failed, will retry on resize:', err)
      }
    }, 0)

    // Apply custom scrollbar width via JS (CSS doesn't always work with xterm)
    const viewport = terminalRef.current.querySelector('.xterm-viewport') as HTMLElement
    if (viewport) {
      viewport.style.setProperty('scrollbar-width', 'thin', 'important')
    }

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // Welcome message
    term.writeln('\x1b[1;32mZynqOS WASI Terminal v0.5\x1b[0m')
    term.writeln('Type \x1b[1;33mhelp\x1b[0m for available commands.')
    term.writeln('Bash shell available: type \x1b[1;33mbash\x1b[0m for interactive shell or \x1b[1;33mbash script.sh\x1b[0m to run scripts.')
    
    // Preload Wasmer packages in the background
    const coiCheck = checkCrossOriginIsolation()
    if (coiCheck.supported) {
      term.writeln('\x1b[90mLoading bash environment...\x1b[0m')
      preloadWasmerPackages((msg) => {
        // Update terminal with loading progress
        if (msg.includes('ready') || msg.includes('loaded') || msg.includes('successfully')) {
          term.writeln(`\x1b[32m✓ ${msg}\x1b[0m`)
        }
      }).then((result) => {
        if (result.success) {
          wasmerReadyRef.current = true
          term.writeln('\x1b[32m✓ Bash environment ready\x1b[0m')
        } else if (result.error) {
          term.writeln(`\x1b[33m⚠ Bash not available: ${result.error}\x1b[0m`)
        }
        writePrompt(term)
      }).catch(() => {
        writePrompt(term)
      })
    } else {
      term.writeln(`\x1b[33m⚠ Bash not available: ${coiCheck.reason}\x1b[0m`)
      writePrompt(term)
    }

    // Handle input
    let localHistory: string[] = []
    let localHistoryIndex = -1
    let tabMatches: string[] = []
    let tabIndex = -1
    let lastTabPartial = ''

    term.onData(async data => {
      // If in interactive bash mode, send all input directly to bash
      if (inBashModeRef.current && bashSessionRef.current) {
        try {
          await bashSessionRef.current.write(data)
        } catch (e) {
          // Session may have ended
          inBashModeRef.current = false
          bashSessionRef.current = null
        }
        return
      }

      const code = data.charCodeAt(0)

      // Reset tab state on non-tab keys
      if (code !== 9) {
        tabMatches = []
        tabIndex = -1
        lastTabPartial = ''
      }

      if (code === 13) { // Enter
        const line = currentLineRef.current
        term.write('\r\n')

        // Handle Python REPL mode
        if (inPythonModeRef.current) {
          if (line.trim() === 'exit()' || line.trim() === 'quit()') {
            inPythonModeRef.current = false
            writeLine(term, 'Exiting Python REPL...')
            currentLineRef.current = ''
            writePrompt(term)
            return
          }
          
          if (line.trim()) {
            try {
              const { runPython } = await import('../../wasm/pyodideLoader')
              let streamed = false
              const result = await runPython(line, undefined, (chunk, stream) => {
                streamed = true
                chunk.split('\n').forEach(l => writeLine(term, l))
              })
              if (!streamed && result && result !== '(no output)') {
                result.split('\n').forEach(l => writeLine(term, l))
              }
            } catch (e: any) {
              writeLine(term, `\x1b[31m${String(e)}\x1b[0m`)
            }
          }
          
          currentLineRef.current = ''
          term.write('>>> ')
          return
        }

        if (line.trim()) {
          localHistory.push(line)
          localHistoryIndex = -1
          setHistory(h => [...h, line])
          await handleCommandLine(term, line)
        }

        // Only show prompt if not in bash or python mode
        if (!inBashModeRef.current && !inPythonModeRef.current) {
          currentLineRef.current = ''
          writePrompt(term)
        }
      } else if (code === 127) { // Backspace
        if (currentLineRef.current.length > 0) {
          currentLineRef.current = currentLineRef.current.slice(0, -1)
          term.write('\b \b')
        }
      } else if (code === 27) { // Escape sequences (arrows, etc.)
        if (data === '\x1b[A') { // Up arrow
          if (localHistory.length > 0) {
            const newIndex = localHistoryIndex === -1
              ? localHistory.length - 1
              : Math.max(0, localHistoryIndex - 1)
            localHistoryIndex = newIndex

            // Clear current line
            const clearLen = currentLineRef.current.length
            term.write('\b \b'.repeat(clearLen))

            // Write history item
            currentLineRef.current = localHistory[newIndex]
            term.write(currentLineRef.current)
          }
        } else if (data === '\x1b[B') { // Down arrow
          if (localHistoryIndex >= 0) {
            const clearLen = currentLineRef.current.length
            term.write('\b \b'.repeat(clearLen))

            const newIndex = localHistoryIndex + 1
            if (newIndex >= localHistory.length) {
              localHistoryIndex = -1
              currentLineRef.current = ''
            } else {
              localHistoryIndex = newIndex
              currentLineRef.current = localHistory[newIndex]
              term.write(currentLineRef.current)
            }
          }
        }
      } else if (code === 3) { // Ctrl+C
        term.write('^C')
        currentLineRef.current = ''
        writePrompt(term)
      } else if (code === 12) { // Ctrl+L
        term.clear()
        writePrompt(term)
      } else if (code === 9) { // Tab - autocomplete with cycling
        const partial = currentLineRef.current

        // If this is a new tab sequence or partial changed, get fresh matches
        if (tabMatches.length === 0 || lastTabPartial !== partial) {
          tabMatches = commands.filter(c => c.startsWith(partial))
          tabIndex = -1
          lastTabPartial = partial
        }

        if (tabMatches.length === 1) {
          // Single match - autocomplete directly
          const clearLen = currentLineRef.current.length
          term.write('\b \b'.repeat(clearLen))
          currentLineRef.current = tabMatches[0] + ' '
          term.write(tabMatches[0] + ' ')
          tabMatches = []
          tabIndex = -1
        } else if (tabMatches.length > 1) {
          // Multiple matches - cycle through them
          tabIndex = (tabIndex + 1) % tabMatches.length

          // Clear current line and write the match
          const clearLen = currentLineRef.current.length
          term.write('\b \b'.repeat(clearLen))
          currentLineRef.current = tabMatches[tabIndex]
          term.write(tabMatches[tabIndex])
        }
      } else if (code >= 32) { // Printable characters
        currentLineRef.current += data
        term.write(data)
      }
    })

    // Handle resize
    const handleResize = () => {
      try {
        fitAddon.fit()
      } catch (e) {
        // ignore fit errors during rapid resize
      }
    }

    window.addEventListener('resize', handleResize)

    // Use ResizeObserver for container resize with debounce to prevent infinite loop
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        handleResize()
      }, 50)
    })
    resizeObserver.observe(terminalRef.current)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeObserver.disconnect()
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [writePrompt])

  // Fit terminal when container changes
  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        fitAddonRef.current?.fit()
      } catch (err) {
        console.warn('Delayed fit failed:', err)
      }
    }, 100)
    return () => clearTimeout(timeout)
  }, [])

  return (
    <div className="flex flex-col h-full bg-black pb-2 overflow-hidden">
      <div
        ref={terminalRef}
        className="flex-1 p-2 pr-0 terminal-scrollbar overflow-hidden"
        style={{ minHeight: 0, maxHeight: '100%' }}
      />
    </div>
  )
}

// attach for Taskbar quick open (keeps parity with other apps)
window.__TERMINAL_UI__ = TerminalWasi
