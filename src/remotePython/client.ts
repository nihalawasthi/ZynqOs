import { base64ToUint8Array, toBase64 } from '../utils/encoding'
import { getRemotePythonConfig, type RemotePythonConfig } from './config'

type RunResponse = {
  stdout: string
  stderr: string
  exit_code: number
  timed_out: boolean
}

type PipListResponse = {
  packages: Array<{ name: string; version: string }>
}

type FsReadResponse = {
  path: string
  content: string
  encoding: string
  size: number
}

type FsListResponse = {
  path: string
  entries: Array<{ name: string; type: string; size: string }>
}

async function getConfigOrThrow(): Promise<RemotePythonConfig> {
  const config = await getRemotePythonConfig()
  if (!config.enabled) {
    throw new Error('Remote Python is disabled')
  }
  if (!config.baseUrl) {
    throw new Error('Remote Python base URL is not configured')
  }
  return config
}

function buildHeaders(config: RemotePythonConfig, includeJson = true) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  if (config.apiKey) headers['X-Api-Key'] = config.apiKey
  if (config.userId) headers['X-User-Id'] = config.userId
  return headers
}

export async function remotePythonVersion(): Promise<string> {
  const config = await getConfigOrThrow()
  const res = await fetch(`${config.baseUrl}/v1/python/version`, {
    headers: buildHeaders(config, false)
  })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  const json = await res.json()
  return String(json.version || '')
}

export async function remoteRun(code: string, args: string[] = [], timeoutS = 20): Promise<RunResponse> {
  const config = await getConfigOrThrow()
  const res = await fetch(`${config.baseUrl}/v1/run`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({ code, args, timeout_s: timeoutS })
  })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  return res.json()
}

export async function remotePipInstall(packages: string[], upgrade = false): Promise<RunResponse> {
  const config = await getConfigOrThrow()
  const res = await fetch(`${config.baseUrl}/v1/pip/install`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({ packages, upgrade })
  })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  return res.json()
}

export async function remotePipList(): Promise<PipListResponse> {
  const config = await getConfigOrThrow()
  const res = await fetch(`${config.baseUrl}/v1/pip/list`, {
    headers: buildHeaders(config, false)
  })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  return res.json()
}

export async function remoteFsWrite(path: string, content: string | Uint8Array) {
  const config = await getConfigOrThrow()
  const isBinary = content instanceof Uint8Array
  const payload = isBinary
    ? { path, content: toBase64(content), encoding: 'base64', mkdirs: true }
    : { path, content: String(content), encoding: 'utf-8', mkdirs: true }
  const res = await fetch(`${config.baseUrl}/v1/fs/write`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  return res.json()
}

export async function remoteFsRead(path: string, encoding: 'utf-8' | 'base64' = 'base64'): Promise<string | Uint8Array> {
  const config = await getConfigOrThrow()
  const url = new URL(`${config.baseUrl}/v1/fs/read`)
  url.searchParams.set('path', path)
  url.searchParams.set('encoding', encoding)
  const res = await fetch(url, { headers: buildHeaders(config, false) })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  const json = (await res.json()) as FsReadResponse
  if (json.encoding === 'base64') {
    return base64ToUint8Array(json.content)
  }
  return json.content
}

export async function remoteFsList(path = ''): Promise<FsListResponse> {
  const config = await getConfigOrThrow()
  const url = new URL(`${config.baseUrl}/v1/fs/list`)
  url.searchParams.set('path', path)
  const res = await fetch(url, { headers: buildHeaders(config, false) })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  return res.json()
}

export async function remoteFsDelete(path: string) {
  const config = await getConfigOrThrow()
  const res = await fetch(`${config.baseUrl}/v1/fs/delete`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({ path })
  })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  return res.json()
}
