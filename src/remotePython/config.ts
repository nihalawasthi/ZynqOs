import { readFile, writeFile } from '../vfs/fs'
import { githubSync } from '../storage/githubSync'

const SETTINGS_PATH = 'settings.json'
const API_KEY_STORAGE = 'zynqos_remote_python_api_key'

export type RemotePythonConfig = {
  enabled: boolean
  baseUrl: string
  userId: string
  apiKey: string
  overwriteOnPull: boolean
  pullIntervalSec: number
}

type StoredSettings = {
  remotePython?: {
    enabled?: boolean
    baseUrl?: string
    userId?: string
    overwriteOnPull?: boolean
    pullIntervalSec?: number
  }
}

const DEFAULT_REMOTE = {
  enabled: false,
  baseUrl: '',
  userId: '',
  overwriteOnPull: false,
  pullIntervalSec: 60
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `http://${trimmed}`
}

function loadApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) || ''
  } catch {
    return ''
  }
}

function saveApiKey(value: string) {
  try {
    if (value) {
      localStorage.setItem(API_KEY_STORAGE, value)
    } else {
      localStorage.removeItem(API_KEY_STORAGE)
    }
  } catch {
    // ignore storage errors
  }
}

async function loadSettings(): Promise<StoredSettings> {
  try {
    const data = await readFile(SETTINGS_PATH)
    if (data && typeof data === 'string') {
      return JSON.parse(data) as StoredSettings
    }
  } catch {
    // ignore
  }
  return {}
}

async function saveSettings(settings: StoredSettings) {
  const json = JSON.stringify(settings, null, 2)
  await writeFile(SETTINGS_PATH, json)
  await githubSync.trackChange(SETTINGS_PATH, json)
}

export async function getRemotePythonConfig(): Promise<RemotePythonConfig> {
  const settings = await loadSettings()
  const remote = settings.remotePython || {}
  return {
    enabled: remote.enabled ?? DEFAULT_REMOTE.enabled,
    baseUrl: normalizeBaseUrl(remote.baseUrl ?? DEFAULT_REMOTE.baseUrl),
    userId: remote.userId ?? DEFAULT_REMOTE.userId,
    apiKey: loadApiKey(),
    overwriteOnPull: remote.overwriteOnPull ?? DEFAULT_REMOTE.overwriteOnPull,
    pullIntervalSec: remote.pullIntervalSec ?? DEFAULT_REMOTE.pullIntervalSec
  }
}

export async function setRemotePythonEnabled(enabled: boolean): Promise<RemotePythonConfig> {
  const settings = await loadSettings()
  const remote = settings.remotePython || {}
  settings.remotePython = {
    enabled,
    baseUrl: normalizeBaseUrl(remote.baseUrl ?? DEFAULT_REMOTE.baseUrl),
    userId: remote.userId ?? DEFAULT_REMOTE.userId,
    overwriteOnPull: remote.overwriteOnPull ?? DEFAULT_REMOTE.overwriteOnPull,
    pullIntervalSec: remote.pullIntervalSec ?? DEFAULT_REMOTE.pullIntervalSec
  }
  await saveSettings(settings)
  return getRemotePythonConfig()
}

export async function updateRemotePythonConfig(update: Partial<Omit<RemotePythonConfig, 'apiKey'>> & { apiKey?: string }) {
  const settings = await loadSettings()
  const remote = settings.remotePython || {}
  settings.remotePython = {
    enabled: update.enabled ?? remote.enabled ?? DEFAULT_REMOTE.enabled,
    baseUrl: normalizeBaseUrl(update.baseUrl ?? remote.baseUrl ?? DEFAULT_REMOTE.baseUrl),
    userId: update.userId ?? remote.userId ?? DEFAULT_REMOTE.userId,
    overwriteOnPull: update.overwriteOnPull ?? remote.overwriteOnPull ?? DEFAULT_REMOTE.overwriteOnPull,
    pullIntervalSec: update.pullIntervalSec ?? remote.pullIntervalSec ?? DEFAULT_REMOTE.pullIntervalSec
  }
  await saveSettings(settings)
  if (update.apiKey !== undefined) {
    saveApiKey(update.apiKey)
  }
  return getRemotePythonConfig()
}
