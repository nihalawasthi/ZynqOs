import { getRemotePythonConfig, type RemotePythonConfig } from '../remotePython/config'

type RunResponse = {
  stdout: string
  stderr: string
  exit_code: number
  timed_out: boolean
}

type ToolsListResponse = {
  tools: string[]
  apt_packages: string[]
}

type ToolRunOptions = {
  cwd?: string
  timeoutS?: number
  env?: Record<string, string>
}

async function getConfigOrThrow(): Promise<RemotePythonConfig> {
  const config = await getRemotePythonConfig()
  if (!config.enabled) {
    throw new Error('Remote tools are disabled')
  }
  if (!config.baseUrl) {
    throw new Error('Remote tools base URL is not configured')
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

async function handleErrorResponse(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const json = JSON.parse(text)
    if (json.detail) {
      return json.detail
    }
  } catch {
    // Not JSON, return as-is
  }
  return text || `HTTP ${res.status}`
}

export async function remoteToolsList(): Promise<ToolsListResponse> {
  const config = await getConfigOrThrow()
  const res = await fetch(`${config.baseUrl}/v1/tools/list`, {
    headers: buildHeaders(config, false)
  })
  if (!res.ok) {
    const detail = await handleErrorResponse(res)
    throw new Error(detail)
  }
  return res.json()
}

export async function remoteToolsRun(command: string, args: string[] = [], options: ToolRunOptions = {}): Promise<RunResponse> {
  const config = await getConfigOrThrow()
  const payload = {
    command,
    args,
    cwd: options.cwd,
    timeout_s: options.timeoutS ?? 30,
    env: options.env || {}
  }
  const res = await fetch(`${config.baseUrl}/v1/tools/run`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const detail = await handleErrorResponse(res)
    throw new Error(detail)
  }
  return res.json()
}

export async function remoteToolsInstall(packages: string[], manager: 'apt' = 'apt'): Promise<RunResponse> {
  const config = await getConfigOrThrow()
  const res = await fetch(`${config.baseUrl}/v1/tools/install`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({ manager, packages })
  })
  if (!res.ok) {
    const detail = await handleErrorResponse(res)
    throw new Error(detail)
  }
  return res.json()
}
