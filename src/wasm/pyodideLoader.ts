import type { PyodideInterface } from 'pyodide'
import { readFile } from '../vfs/fs'

let worker: Worker | null = null
let readyPromise: Promise<void> | null = null
let reqId = 0
type PendingReq = { resolve: (v: any) => void; reject: (e: any) => void; onData?: (chunk: string, stream: 'stdout'|'stderr') => void; timeout?: any }
const pending = new Map<number, PendingReq>()
const DEFAULT_TIMEOUT_MS = 10000

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
      try { entry.onData?.(String(msg.data ?? ''), msg.stream) } catch {}
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

function callWorker<T=any>(message: any, timeoutMs = DEFAULT_TIMEOUT_MS, onData?: (chunk: string, stream: 'stdout'|'stderr') => void): Promise<T> {
  return new Promise(async (resolve, reject) => {
    try {
      await startWorker()
    } catch (e) {
      return reject(e)
    }
    const id = ++reqId
    const timeout = setTimeout(() => {
      pending.delete(id)
      // Kill and restart worker on timeout (likely infinite loop)
      try { worker?.terminate() } catch {}
      worker = null
      readyPromise = null
      reject(new Error('Python execution timed out'))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timeout, onData })
    worker!.postMessage({ ...message, id })
  })
}

/**
 * Load Pyodide runtime (singleton pattern)
 */
export async function getPyodide(): Promise<PyodideInterface | any> {
  await startWorker()
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
  return resp.ok ? resp.message : `Error installing ${packageName}: ${resp.error || 'failed'}`
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
