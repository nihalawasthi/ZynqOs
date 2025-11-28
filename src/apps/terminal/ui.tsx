// src/apps/terminal/ui.tsx
import React, { useEffect, useRef, useState } from 'react'
import { readFile } from '../../vfs/fs'

// Browser WASI shim - pure JS implementation
import { WASI, File, OpenFile, PreopenDirectory, Directory } from '@bjorn3/browser_wasi_shim'

// Buffer polyfill for browser
import { Buffer } from 'buffer'

type OutputLine = string | { type: 'prompt'; username: string; dir: string } | { type: 'command'; text: string }

type Props = {}

export default function TerminalWasi(_: Props) {
  const [out, setOut] = useState<OutputLine[]>([])
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [currentdirectory, setCurrentdirectory] = useState('~')
  const outRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const username = 'nihal' // hardcoded for demo

  // Command suggestions database
  const commands = [
    'run /apps/wasm/shell.wasm',
    'run /apps/wasm/ls.wasm',
    'run /apps/wasm/cat.wasm',
    'run /apps/wasm/mkdir.wasm',
    'run /apps/wasm/rm.wasm',
    'run /apps/wasm/touch.wasm',
    'upload',
    'clear',
    'help',
  ]

  const shellCommands = [
    'run /apps/wasm/shell.wasm help',
    'run /apps/wasm/shell.wasm ls /',
    'run /apps/wasm/shell.wasm cat /input.txt',
    'run /apps/wasm/shell.wasm pwd',
    'run /apps/wasm/shell.wasm echo',
    'run /apps/wasm/shell.wasm stat',
    'run /apps/wasm/shell.wasm version',
  ]

  useEffect(() => {
    setOut(o => [...o, 'ZynqOS WASI Terminal v0.3', 'Type "help" for commands', ''])
  }, [])

  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight })
  }, [out])

  // Focus input when clicking anywhere in terminal
  useEffect(() => {
    const handleClick = () => inputRef.current?.focus()
    const terminal = outRef.current
    terminal?.addEventListener('click', handleClick)
    return () => terminal?.removeEventListener('click', handleClick)
  }, [])

  // helper to append output
  function appendLine(line: OutputLine) {
    setOut(o => [...o, line])
  }

  // Normalize a path for VFS operations: remove leading/trailing slashes
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

  // Given an array of keys (may be full paths or relative), return immediate children
  function extractImmediateChildren(keys: string[], parentNorm: string) {
    const set = new Set<string>()
    const prefix = parentNorm ? parentNorm + '/' : ''
    for (let k of keys) {
      if (!k) continue
      if (k.startsWith('/')) k = k.slice(1)
      if (!parentNorm) {
        const first = k.split('/')[0]
        if (!first) continue
        const isDir = k.includes('/')
        set.add(isDir ? `${first}/` : first)
      } else {
        if (k === parentNorm) continue
        if (!k.startsWith(prefix)) continue
        const remainder = k.slice(prefix.length)
        const child = remainder.split('/')[0]
        if (!child) continue
        const isDir = remainder.includes('/')
        set.add(isDir ? `${child}/` : child)
      }
    }
    return Array.from(set).sort()
  }

  // Handle keyboard navigation for history and autocomplete
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (cmd.trim()) {
        // Show command with full prompt in output (preserving colors)
        setOut(o => [...o, 
          { type: 'prompt', username, dir: currentdirectory },
          { type: 'command', text: cmd }
        ])
        setHistory(h => [...h, cmd])
        setHistoryIndex(-1)
        handleCommandLine(cmd)
        setCmd('')
      }
      setSuggestions([])
    } else if (e.key === 'Tab') {
      e.preventDefault()
      // Get suggestions
      const allCommands = [...commands, ...shellCommands]
      const matches = allCommands.filter(c => c.startsWith(cmd))
      
      if (matches.length === 1) {
        // Single match - autocomplete
        setCmd(matches[0])
        setSuggestions([])
      } else if (matches.length > 1) {
        // Multiple matches - show suggestions
        setSuggestions(matches)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length > 0) {
        const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1)
        setHistoryIndex(newIndex)
        setCmd(history[newIndex])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex >= 0) {
        const newIndex = historyIndex + 1
        if (newIndex >= history.length) {
          setHistoryIndex(-1)
          setCmd('')
        } else {
          setHistoryIndex(newIndex)
          setCmd(history[newIndex])
        }
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault()
      setCmd('')
      appendLine('^C')
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      setOut([])
    } else {
      // Clear suggestions on other keys
      setSuggestions([])
    }
  }

  // Sync modified files from WASI filesystem back to VFS
  async function syncFilesystemToVFS(rootFiles: Map<string, File | Directory>) {
    const { writeFile: writeVfsFile } = await import('../../vfs/fs')
    
    // Helper to recursively sync files
    async function syncDir(files: Map<string, any>, basePath: string) {
      for (const [name, entry] of files) {
        const fullPath = basePath + name
        
        // Check if it's a File (has .data property)
        if (entry && 'data' in entry && entry.data instanceof Uint8Array) {
          // Sync file to VFS
          try {
            await writeVfsFile(fullPath, entry.data)
            // appendLine(`synced ${fullPath}`)  // Uncomment for debugging
          } catch (e) {
            console.error(`Error syncing ${fullPath}:`, e)
          }
        } else if (entry && 'contents' in entry) {
          // Recursively sync subdirectory
          await syncDir(entry.contents, fullPath + '/')
        }
      }
    }
    
    await syncDir(rootFiles, '/')
  }

  // run a WASI module that is available via a URL (can be local path served by Vite)
  async function runWasiFromUrl(url: string, args: string[] = []) {
    appendLine(`> run ${url} ${args.join(' ')}`)
    try {
      appendLine('fetching wasm...')
      const res = await fetch(url)
      if (!res.ok) {
        appendLine(`fetch failed: ${res.status} ${res.statusText}`)
        return
      }
      const bytes = await res.arrayBuffer()
      await runWasiFromBytes(new Uint8Array(bytes), url, args)
    } catch (e: any) {
      appendLine(`error fetching or running wasm: ${String(e)}`)
      console.error(e)
    }
  }

  // run a WASI module from raw bytes
  async function runWasiFromBytes(bytes: Uint8Array, originLabel = '<wasm>', args: string[] = []) {
    appendLine(`starting ${originLabel}`)
    try {
      // Create output buffers
      let stdoutText = ''
      let stderrText = ''

      // --- Load files from VFS to mount in WASI filesystem ---
      const queued: string[] = (window as any).__ZynqOS_WASMFS_SEED_PATHS__ || []
      const filesToMount = ['/input.txt', '/home/demo.txt', ...queued]
      
      const vfsFiles: Map<string, Uint8Array> = new Map()
      
      for (const vfsPath of filesToMount) {
        try {
          const data = await readFile(vfsPath)
          if (data) {
            const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data))
            vfsFiles.set(vfsPath, bytes)
            appendLine(`loaded ${vfsPath} from VFS`)
          }
        } catch (e) {
          // File doesn't exist, skip
        }
      }

      // Create in-memory files using browser_wasi_shim
      // We need to organize files by directory structure
      const rootFiles: Map<string, File | Directory> = new Map()
      const homeDirFiles: Map<string, File | Directory> = new Map()
      
      for (const [path, data] of vfsFiles) {
        const file = new File(data)
        
        // Parse the path to determine which directory it belongs to
        if (path === '/input.txt' || path === 'input.txt') {
          rootFiles.set('input.txt', file)
          appendLine(`mounted ${path}`)
        } else if (path.startsWith('/home/')) {
          const filename = path.substring('/home/'.length)
          homeDirFiles.set(filename, file)
          appendLine(`mounted ${path}`)
        } else if (path.startsWith('/')) {
          // Other root-level files
          rootFiles.set(path.substring(1), file)
          appendLine(`mounted ${path}`)
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
      stdout.fd_write = function(data: Uint8Array) {
        stdoutText += textDecoder.decode(data)
        return originalStdoutWrite(data)
      }

      const stderr = new OpenFile(new File(new Uint8Array()))
      const originalStderrWrite = stderr.fd_write.bind(stderr)
      stderr.fd_write = function(data: Uint8Array) {
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
      await syncFilesystemToVFS(rootFiles)

      // Display captured output
      if (stdoutText) {
        stdoutText.split('\n').forEach(line => appendLine(line))
      }
      if (stderrText) {
        appendLine('--- stderr ---')
        stderrText.split('\n').forEach(line => appendLine(line))
      }

      appendLine(`program ${originLabel} finished`)
    } catch (e: any) {
      appendLine(`runtime error: ${String(e)}`)
      console.error(e)
    }
  }

  // run a wasm blob stored in the ZynqOS VFS at /apps/...
  async function runWasiFromVfs(path: string, args: string[] = []) {
    appendLine(`> run-vfs ${path}`)
    try {
      const b = await readFile(path)
      if (!b) {
        appendLine(`file not found in VFS: ${path}`)
        return
      }
      let bytes: Uint8Array
      if (typeof b === 'string') {
        // text file — convert to bytes
        bytes = new TextEncoder().encode(b)
      } else {
        bytes = b as Uint8Array
      }
      await runWasiFromBytes(bytes, path, args)
    } catch (e: any) {
      appendLine(`error reading VFS: ${String(e)}`)
    }
  }

  // allow user file upload (select a local .wasm file and run it)
  async function runWasiFromFile(file: globalThis.File) {
    appendLine(`> upload-run ${file.name}`)
    const buf = new Uint8Array(await file.arrayBuffer())
    await runWasiFromBytes(buf, file.name, [])
  }

  // parse and run user-entered command
  async function handleCommandLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return
    setCmd('')
    const parts = trimmed.split(/\s+/)
    const c = parts[0]
    
    if (c === 'help') {
      appendLine('ZynqOS Terminal - Available Commands:')
      appendLine('')
      appendLine('File System:')
      appendLine('  ls [path]                       # list directory contents')
      appendLine('  cd <path>                       # change directory')
      appendLine('  pwd                             # print working directory')
      appendLine('  cat <file>                      # display file contents')
      appendLine('  mkdir <dir>                     # create directory')
      appendLine('  touch <file>                    # create empty file')
      appendLine('  rm <path>                       # remove file/directory')
      appendLine('  tree [path]                     # show directory tree')
      appendLine('')
      appendLine('WASI Programs:')
      appendLine('  run <path> [args...]            # run WASI binary')
      appendLine('  upload                          # upload and run .wasm file')
      appendLine('')
      appendLine('System:')
      appendLine('  echo <text>                     # print text')
      appendLine('  clear                           # clear terminal')
      appendLine('  whoami                          # show current user')
      appendLine('  date                            # show current date/time')
      appendLine('  uname                           # show system info')
      appendLine('  help                            # show this help')
    } else if (c === 'ls') {
      const path = parts[1] || currentdirectory
      try {
        const { readdir } = await import('../../vfs/fs')
        const requestedNorm = normalizePathForVfs(path === '~' ? '' : path)
        const keys = await readdir(requestedNorm)
        // Always show . and .. (aligned with other entries)
        appendLine('  .')
        appendLine('  ..')
        // Derive immediate children and display only names (append / for dirs)
        const children = extractImmediateChildren(keys, requestedNorm)
        if (children.length === 0) {
          // nothing else
        } else {
          children.forEach(ch => appendLine(`  ${ch}`))
        }
      } catch (e) {
        appendLine(`ls: cannot access '${path}': ${String(e)}`)
      }
    } else if (c === 'cd') {
      const path = parts[1]
      if (!path) {
        setCurrentdirectory('~')
        return
      }

      // Handle special cases
      if (path === '.') return
      if (path === '~') { setCurrentdirectory('~'); return }

      // Resolve to normalized target (no leading slash)
      const currentNorm = normalizePathForVfs(currentdirectory === '~' ? '' : currentdirectory)
      let targetNorm = ''
      if (path.startsWith('/')) {
        targetNorm = normalizePathForVfs(path)
      } else {
        // relative resolution
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

      // Validate existence by checking parent entries
      try {
        const { readdir } = await import('../../vfs/fs')
        const parent = parentDir(targetNorm)
        const keys = await readdir(parent)
        const children = extractImmediateChildren(keys, parent)
        const baseName = targetNorm ? targetNorm.split('/').pop() || '' : ''
        const hasDir = children.includes(baseName + '/') || children.includes(baseName)
        if (targetNorm === '' || hasDir) {
          setCurrentdirectory(targetNorm === '' ? '~' : '/' + targetNorm)
        } else {
          appendLine(`cd: ${path}: No such file or directory`)
        }
      } catch (e) {
        appendLine(`cd: ${path}: No such file or directory`)
      }
    } else if (c === 'pwd') {
      appendLine(currentdirectory === '~' ? '/home/user' : currentdirectory)
    } else if (c === 'cat') {
      const p = parts[1]
      if (!p) {
        appendLine('usage: cat <file>')
        return
      }
      try {
        const { readFile } = await import('../../vfs/fs')
        const v = await readFile(p)
        if (!v) {
          appendLine(`cat: ${p}: No such file`)
          return
        }
        if (v instanceof Uint8Array) {
          try {
            const txt = new TextDecoder().decode(v)
            appendLine(txt)
          } catch {
            appendLine(`(binary file, ${v.length} bytes)`)
          }
        } else {
          appendLine(String(v))
        }
      } catch (e) {
        appendLine(`cat: ${p}: ${String(e)}`)
      }
    } else if (c === 'mkdir') {
      const dir = parts[1]
      if (!dir) {
        appendLine('usage: mkdir <directory>')
        return
      }
      try {
        const { writeFile } = await import('../../vfs/fs')
        // Create a marker file to represent the directory
        await writeFile(`${dir}/.keep`, '')
        appendLine(`mkdir: created directory '${dir}'`)
      } catch (e) {
        appendLine(`mkdir: cannot create directory '${dir}': ${String(e)}`)
      }
    } else if (c === 'touch') {
      const file = parts[1]
      if (!file) {
        appendLine('usage: touch <file>')
        return
      }
      try {
        const { writeFile } = await import('../../vfs/fs')
        await writeFile(file, '')
        appendLine(`touch: created '${file}'`)
      } catch (e) {
        appendLine(`touch: cannot touch '${file}': ${String(e)}`)
      }
    } else if (c === 'echo') {
      const text = parts.slice(1).join(' ')
      appendLine(text)
    } else if (c === 'whoami') {
      appendLine(username)
    } else if (c === 'date') {
      appendLine(new Date().toString())
    } else if (c === 'uname') {
      appendLine('ZynqOS v0.3 (Browser WASI Runtime)')
    } else if (c === 'tree') {
      const path = parts[1] || currentdirectory
      try {
        const { readdir } = await import('../../vfs/fs')
        const keys = await readdir(path === '~' ? '' : path)
        appendLine(path)
        keys.forEach((k, i) => {
          const isLast = i === keys.length - 1
          appendLine(`${isLast ? '└──' : '├──'} ${k}`)
        })
      } catch (e) {
        appendLine(`tree: ${path}: ${String(e)}`)
      }
    } else if (c === 'rm') {
      // Support flags like -r, -f, -rf
      const args = parts.slice(1)
      let recursive = false
      let force = false
      const targets: string[] = []

      for (const a of args) {
        if (a.startsWith('-')) {
          if (a.includes('r')) recursive = true
          if (a.includes('f')) force = true
        } else {
          targets.push(a)
        }
      }

      if (targets.length === 0) {
        appendLine('usage: rm [-r] <file|directory>')
        return
      }

      try {
        const { readdir, removeFile } = await import('../../vfs/fs')

        for (const t of targets) {
          const targetNorm = normalizePathForVfs(t)
          const prefixes = [targetNorm, targetNorm ? '/' + targetNorm : '/']

          // Gather matching keys under both prefix styles
          const allMatches: string[] = []
          for (const p of prefixes) {
            try {
              const keys = await readdir(p)
              keys.forEach(k => allMatches.push(k))
            } catch {
              // ignore
            }
          }

          // If recursive, delete everything that matches the prefixes
          if (recursive) {
            // Remove duplicates
            const unique = Array.from(new Set(allMatches))
            if (unique.length === 0 && !force) {
              appendLine(`rm: cannot remove '${t}': No such file or directory`)
              continue
            }
            for (const k of unique) {
              try {
                await removeFile(k)
              } catch (e) {
                if (!force) appendLine(`rm: failed to remove '${k}': ${String(e)}`)
              }
            }
            // Also try exact keys for both styles
            try { await removeFile(targetNorm) } catch {} 
            try { await removeFile('/' + targetNorm) } catch {}
            appendLine(`rm: removed '${t}'`)
            continue
          }

          // Non-recursive: ensure target is not a directory
          // Check if any match has children (i.e., is a directory)
          const uniq = Array.from(new Set(allMatches))
          const hasChildren = uniq.some(k => {
            const nk = k.startsWith('/') ? k.slice(1) : k
            const norm = targetNorm
            return nk !== norm && nk.startsWith(norm + '/')
          })
          if (hasChildren) {
            appendLine(`rm: cannot remove '${t}': Is a directory (use 'rm -r' for directories)`)
            continue
          }

          // Try deleting exact keys (no-leading and leading)
          let deleted = false
          try { await removeFile(targetNorm); deleted = true } catch {}
          try { await removeFile('/' + targetNorm); deleted = true } catch {}

          if (!deleted) {
            if (!force) appendLine(`rm: cannot remove '${t}': No such file or directory`)
          } else {
            appendLine(`rm: removed '${t}'`)
          }
        }
      } catch (e) {
        appendLine(`rm: cannot remove: ${String(e)}`)
      }
    } else if (c === 'clear') {
      setOut([])
    } else {
      appendLine(`unknown command: ${c}`)
    }
  }

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Terminal output and input combined */}
      <div 
        ref={outRef} 
        className="flex-1 overflow-auto p-3 font-mono text-sm text-green-400 cursor-text"
        style={{ minHeight: 0 }}
      >
        {/* Previous output */}
        {out.map((l, i) => {
          if (typeof l === 'object' && l !== null && l.type === 'prompt') {
            return (
              <div key={i} className="text-cyan-400">
                ┌──({l.username}㉿Nyx)-[{l.dir}]
              </div>
            )
          } else if (typeof l === 'object' && l !== null && l.type === 'command') {
            return (
              <div key={i} className="flex">
                <span className="text-cyan-400">└$</span>
                <span className="text-green-400 ml-2">{l.text}</span>
              </div>
            )
          } else {
            return (
              <div key={i}>
                <pre style={{margin:0,whiteSpace:'pre-wrap'}}>{String(l)}</pre>
              </div>
            )
          }
        })}
        
        {/* Autocomplete suggestions inline */}
        {suggestions.length > 0 && (
          <div className="my-2 pl-2 border-l-2 border-gray-700">
            {suggestions.map((s, i) => (
              <div
                key={i}
                onClick={() => { setCmd(s); setSuggestions([]); inputRef.current?.focus() }}
                className="text-gray-500 hover:text-green-400 hover:bg-gray-900 px-2 py-0.5 cursor-pointer"
              >
                {s}
              </div>
            ))}
          </div>
        )}
        
        {/* Current input line */}
        <div>
          <div className="text-cyan-400 select-none">┌──({username}㉿Nyx)-[{currentdirectory}]</div>
          <div className="flex items-start">
            <span className="text-cyan-400 mr-2 select-none">└$</span>
            <input
              ref={inputRef}
              type="text"
              value={cmd}
              onChange={e => setCmd(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent text-white-400 outline-none border-none font-mono caret-white-400"
              style={{ caretShape: 'block' }}
              autoFocus
              spellCheck={false}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// attach for Taskbar quick open (keeps parity with other apps)
window.__TERMINAL_UI__ = TerminalWasi
