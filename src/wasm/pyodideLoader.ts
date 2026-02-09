import type { PyodideInterface } from 'pyodide'
import { readFile, writeFile } from '../vfs/fs'

let worker: Worker | null = null
let readyPromise: Promise<void> | null = null
let reqId = 0
type PendingReq = { 
  resolve: (v: any) => void; 
  reject: (e: any) => void; 
  onData?: (chunk: string, stream: 'stdout'|'stderr') => void; 
  timeout?: any;
  accumulatedOut?: string;
  accumulatedErr?: string;
}
const pending = new Map<number, PendingReq>()
const DEFAULT_TIMEOUT_MS = 10000
const INSTALLED_PACKAGES_PATH = '/.python/installed.json'
let restorePromise: Promise<void> | null = null

async function readInstalledPackagesFromVfs(): Promise<string[]> {
  try {
    const content = await readFile(INSTALLED_PACKAGES_PATH)
    if (!content) return []
    const text = content instanceof Uint8Array
      ? new TextDecoder('utf-8', { fatal: false }).decode(content)
      : String(content)
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    const normalized = parsed.map(v => String(v).trim()).filter(Boolean)
    return Array.from(new Set(normalized))
  } catch {
    return []
  }
}

async function writeInstalledPackagesToVfs(packages: string[]): Promise<void> {
  const unique = Array.from(new Set(packages.map(v => String(v).trim()).filter(Boolean)))
  await writeFile(INSTALLED_PACKAGES_PATH, JSON.stringify(unique))
}

async function rememberInstalledPackage(name: string): Promise<void> {
  const list = await readInstalledPackagesFromVfs()
  if (list.includes(name)) return
  list.push(name)
  await writeInstalledPackagesToVfs(list)
}

async function restoreInstalledPackages(): Promise<void> {
  if (restorePromise) return restorePromise
  restorePromise = (async () => {
    const packages = await readInstalledPackagesFromVfs()
    if (packages.length === 0) return
    for (const name of packages) {
      try {
        await callWorker({ type: 'install', name }, DEFAULT_TIMEOUT_MS)
      } catch {
        // Ignore restore failures; user can reinstall manually.
      }
    }
  })()
  return restorePromise
}

function startWorker(): Promise<void> {
  if (readyPromise) return readyPromise
  worker = new Worker('/pyodide-worker.js')
  readyPromise = new Promise<void>((resolve, reject) => {
    const id = ++reqId
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data || {}
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!
        pending.delete(msg.id)
        clearTimeout(p.timeout)
        p.resolve(msg)
        return
      }
      // Resolve init
      if (msg.type === 'inited') {
        worker?.removeEventListener('message', onMessage)
        resolve(void 0)
      }
    }
    const onError = (e: any) => {
      worker?.removeEventListener('message', onMessage)
      reject(e)
    }
    worker!.addEventListener('message', onMessage)
    worker!.addEventListener('error', onError, { once: true })
    worker!.postMessage({ id, type: 'init' })
  })
  // generic response handler
  worker.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data || {}
    const id = msg.id
    if (!id) return
    const entry = pending.get(id)
    if (!entry) return
    // Handle streaming messages without resolving
    if (msg.type === 'stream') {
      try { 
        entry.onData?.(String(msg.data ?? ''), msg.stream) 
        // Accumulate for partial output on termination
        if (msg.stream === 'stdout') {
          entry.accumulatedOut = (entry.accumulatedOut || '') + (msg.data === '' ? '\n' : String(msg.data) + '\n')
        } else if (msg.stream === 'stderr') {
          entry.accumulatedErr = (entry.accumulatedErr || '') + (msg.data === '' ? '\n' : String(msg.data) + '\n')
        }
      } catch {}
      return
    }
    if (msg.type === 'stream-end') {
      // allow future handling if needed; do not resolve yet
      return
    }
    pending.delete(id)
    clearTimeout(entry.timeout)
    entry.resolve(msg)
  })
  return readyPromise
}

export function warmPyodide(): Promise<void> {
  return startWorker().catch(() => {})
}

function callWorker<T=any>(message: any, timeoutMs = DEFAULT_TIMEOUT_MS, onData?: (chunk: string, stream: 'stdout'|'stderr') => void): Promise<T> {
  return new Promise(async (resolve, reject) => {
    try {
      await startWorker()
    } catch (e) {
      return reject(e)
    }
    const id = ++reqId
    const timeout = setTimeout(() => {
      const entry = pending.get(id)
      pending.delete(id)
      // Resolve with accumulated output instead of rejecting on timeout
      if (entry) {
        entry.resolve({ 
          ok: true, 
          stdout: entry.accumulatedOut || '', 
          stderr: entry.accumulatedErr || '' 
        })
      }
      // Kill and restart worker on timeout (likely infinite loop)
      try { worker?.terminate() } catch {}
      worker = null
      readyPromise = null
    }, timeoutMs)
    pending.set(id, { resolve, reject, timeout, onData, accumulatedOut: '', accumulatedErr: '' })
    worker!.postMessage({ ...message, id })
  })
}

/**
 * Load Pyodide runtime (singleton pattern)
 */
export async function getPyodide(): Promise<PyodideInterface | any> {
  await startWorker()
  await restoreInstalledPackages()
  // Return a minimal stub to keep existing call sites happy
  return { worker: true }
}

/**
 * Setup VFS integration so Python can access ZynqOS files
 */
// VFS helper removed in worker mode; runPythonFile reads from VFS on main thread and sends code to worker

/**
 * Execute Python code and return output
 */
export async function runPython(code: string, timeoutMs?: number, onData?: (chunk: string, stream: 'stdout'|'stderr') => void): Promise<string> {
  const resp: any = await callWorker({ type: 'run', code }, timeoutMs, onData)
  if (resp.ok) {
    const out = `${resp.stdout || ''}${resp.stderr || ''}`
    return out || '(no output)'
  }
  return `Error: ${resp.error || 'Python execution failed'}`
}

/**
 * Install a Python package using micropip
 */
export async function installPackage(packageName: string): Promise<string> {
  const resp: any = await callWorker({ type: 'install', name: packageName }, DEFAULT_TIMEOUT_MS)
  if (resp.ok) {
    await rememberInstalledPackage(packageName)
    return resp.message
  }
  return `Error installing ${packageName}: ${resp.error || 'failed'}`
}

/**
 * Run a Python file from VFS
 */
export async function runPythonFile(path: string, onData?: (chunk: string, stream: 'stdout'|'stderr') => void, timeoutMs?: number): Promise<string> {
  const content = await readFile(path)
  
  if (typeof content === 'string') {
    return runPython(content, timeoutMs, onData)
  }
  // If stored as Uint8Array, try to decode as text (UTF-8, then Latin1 fallback)
  if (content instanceof Uint8Array) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(content)
      return runPython(text, timeoutMs, onData)
    } catch {
      try {
        const text = new TextDecoder('latin1').decode(content)
        return runPython(text, timeoutMs, onData)
      } catch {
        throw new Error(`Cannot execute binary file: ${path}`)
      }
    }
  }
  throw new Error(`File not found: ${path}`)
}

/**
 * Check if Pyodide is loaded
 */
export function isPyodideLoaded(): boolean {
  return !!worker
}

/**
 * List installed packages
 */
export async function listPackages(): Promise<string[]> {
  const resp: any = await callWorker({ type: 'list' }, DEFAULT_TIMEOUT_MS)
  return resp.ok ? (resp.packages || []) : []
}

export function cancelPythonExecution() {
  // Resolve any pending requests with their accumulated output before terminating
  for (const [id, req] of pending.entries()) {
    clearTimeout(req.timeout)
    req.resolve({ 
      ok: true, 
      stdout: req.accumulatedOut || '', 
      stderr: req.accumulatedErr || '' 
    })
  }
  pending.clear()
  if (worker) {
    try { worker.terminate() } catch {}
  }
  worker = null
  readyPromise = null
}

export async function requestPythonCancel(): Promise<boolean> {
  if (!worker) return false
  try {
    const id = ++reqId
    worker.postMessage({ id, type: 'cancel' })
    // Fire and forget; cooperative stop will occur on next print
    return true
  } catch {
    return false
  }
}
