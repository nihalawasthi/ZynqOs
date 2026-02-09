import { readFile, readdir, writeFile } from '../vfs/fs'
import { getRemotePythonConfig } from './config'
import { remoteFsDelete, remoteFsList, remoteFsRead, remoteFsWrite } from './client'

const HOME_PREFIX = '/home/'
const SETTINGS_PATH = '/settings.json'

let configCache = {
  enabled: false,
  baseUrl: '',
  userId: '',
  apiKey: '',
  overwriteOnPull: false,
  pullIntervalSec: 60
}

let suppressEvents = 0
const pendingTimers = new Map<string, number>()
let initialSyncDone = false
let listenersAttached = false
let pullIntervalId: number | null = null
let pullInProgress = false
let lastPullAt: number | null = null

function shouldSyncPath(path: string) {
  return path.startsWith(HOME_PREFIX)
}

function toRemotePath(path: string) {
  return path.startsWith(HOME_PREFIX) ? path.slice(HOME_PREFIX.length) : path
}

async function refreshConfig() {
  configCache = await getRemotePythonConfig()
}

function schedulePeriodicPull() {
  if (pullIntervalId !== null) {
    window.clearInterval(pullIntervalId)
    pullIntervalId = null
  }
  if (!configCache.enabled || !configCache.baseUrl) return
  if (!configCache.pullIntervalSec || configCache.pullIntervalSec <= 0) return

  pullIntervalId = window.setInterval(async () => {
    if (pullInProgress) return
    try {
      pullInProgress = true
      await pullRemoteHome(configCache.overwriteOnPull)
    } catch (e) {
      console.warn('[RemotePython] Periodic pull failed', e)
    } finally {
      pullInProgress = false
    }
  }, configCache.pullIntervalSec * 1000)
}

function toUint8Array(content: string | Uint8Array): Uint8Array {
  if (content instanceof Uint8Array) return content
  return new TextEncoder().encode(String(content))
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function buildConflictPath(path: string): string {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
  return `${path}.remote-${stamp}`
}

async function listRemoteFiles(path = ''): Promise<string[]> {
  const entries = await remoteFsList(path)
  const files: string[] = []
  for (const entry of entries.entries) {
    const nextPath = path ? `${path}/${entry.name}` : entry.name
    if (entry.type === 'dir') {
      const nested = await listRemoteFiles(nextPath)
      files.push(...nested)
    } else {
      files.push(nextPath)
    }
  }
  return files
}

async function pullRemoteHome(overwrite = false) {
  const files = await listRemoteFiles('')
  if (files.length === 0) return
  suppressEvents += 1
  try {
    for (const relPath of files) {
      const vfsPath = `${HOME_PREFIX}${relPath}`
      const existing = await readFile(vfsPath)
      const content = await remoteFsRead(relPath, 'base64')
      const remoteBytes = content as Uint8Array

      if (existing === undefined) {
        await writeFile(vfsPath, remoteBytes)
        continue
      }

      const localBytes = toUint8Array(existing)
      if (sameBytes(localBytes, remoteBytes)) continue

      if (overwrite) {
        await writeFile(vfsPath, remoteBytes)
      } else {
        const conflictPath = buildConflictPath(vfsPath)
        await writeFile(conflictPath, remoteBytes)
      }
    }
  } finally {
    suppressEvents -= 1
    lastPullAt = Date.now()
  }
}

export async function getRemotePythonSyncStatus() {
  const keys = await readdir('')
  const conflicts = keys.filter((k) => k.startsWith(HOME_PREFIX) && /\.remote-\d{14}$/.test(k))
  return {
    lastPullAt,
    conflictCount: conflicts.length
  }
}

async function pushLocalHomeFile(path: string) {
  const content = await readFile(path)
  if (content === undefined) return
  const remotePath = toRemotePath(path)
  await remoteFsWrite(remotePath, content)
}

async function deleteRemoteHomeFile(path: string) {
  const remotePath = toRemotePath(path)
  await remoteFsDelete(remotePath)
}

async function pushAllLocalHomeFiles() {
  const keys = await readdir('')
  const homeFiles = keys.filter((k) => k.startsWith(HOME_PREFIX) && !k.endsWith('/'))
  for (const path of homeFiles) {
    try {
      await pushLocalHomeFile(path)
    } catch {
      // ignore individual failures
    }
  }
}

function schedulePush(path: string, action: 'write' | 'delete') {
  if (pendingTimers.has(path)) {
    window.clearTimeout(pendingTimers.get(path))
  }
  const timer = window.setTimeout(async () => {
    pendingTimers.delete(path)
    try {
      if (action === 'delete') {
        await deleteRemoteHomeFile(path)
      } else {
        await pushLocalHomeFile(path)
      }
    } catch (e) {
      console.warn('[RemotePython] Sync failed for', path, e)
    }
  }, 800)
  pendingTimers.set(path, timer)
}

function handleVfsChange(e: Event) {
  if (suppressEvents > 0) return
  if (!configCache.enabled || !configCache.baseUrl) return
  const ev = e as CustomEvent
  const detail = ev.detail || {}
  const path = String(detail.path || '')
  const type = String(detail.type || '')
  if (!shouldSyncPath(path)) return
  if (type === 'delete') {
    schedulePush(path, 'delete')
  } else if (type === 'write') {
    schedulePush(path, 'write')
  }
}

export async function initRemotePythonSync() {
  try {
    await refreshConfig()
  } catch (e) {
    console.warn('[RemotePython] Failed to load config:', e)
    return
  }
  schedulePeriodicPull()
  if (!listenersAttached) {
    window.addEventListener('microos:vfs-changed', handleVfsChange as EventListener)
    window.addEventListener('microos:vfs-changed', async (e: Event) => {
      const ev = e as CustomEvent
      const detail = ev.detail || {}
      const path = String(detail.path || '')
      if (path === SETTINGS_PATH) {
        await refreshConfig()
        schedulePeriodicPull()
        if (configCache.enabled && configCache.baseUrl && !initialSyncDone) {
          try {
            await pullRemoteHome(false)
            await pushAllLocalHomeFiles()
            initialSyncDone = true
          } catch (err) {
            console.warn('[RemotePython] Initial sync failed:', err)
          }
        }
      }
    })
    listenersAttached = true
  }

  if (configCache.enabled && configCache.baseUrl && !initialSyncDone) {
    try {
      await pullRemoteHome(false)
      await pushAllLocalHomeFiles()
      initialSyncDone = true
    } catch (err) {
      console.warn('[RemotePython] Initial sync failed:', err)
    }
  }
}
