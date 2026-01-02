import fs from 'fs'
import path from 'path'

const LOG_DIR = process.env.LOG_DIR || './logs'
const GITHUB_LOG_FILE = path.join(LOG_DIR, 'github-api.log')
const API_LOG_FILE = path.join(LOG_DIR, 'api.log')

// Ensure log directory exists
function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true })
    }
  } catch (e) {
    console.error('Failed to create log directory:', e)
  }
}

function formatTimestamp(): string {
  return new Date().toISOString()
}

function sanitizeObject(obj: any, depth = 0): any {
  if (depth > 5) return '[Deep object]'
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj

  const sensitiveKeys = [
    'accessToken',
    'refreshToken',
    'authorization',
    'password',
    'secret',
    'privateKey',
    'sessionToken',
    'clientSecret'
  ]

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1))
  }

  const sanitized: any = {}
  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
      sanitized[key] = '[REDACTED]'
    } else {
      sanitized[key] = sanitizeObject(value, depth + 1)
    }
  }
  return sanitized
}

export function logGitHubAPI(
  method: string,
  url: string,
  statusCode: number | null,
  requestHeaders?: Record<string, string>,
  responseHeaders?: Record<string, string>,
  responseBody?: string | Record<string, any>,
  error?: string | Error
) {
  ensureLogDir()

  const timestamp = formatTimestamp()
  const urlObj = new URL(url)
  const path = urlObj.pathname + urlObj.search

  // Build log entry
  const logEntry: any = {
    timestamp,
    method,
    endpoint: path,
    fullUrl: url,
    statusCode: statusCode || 'ERROR'
  }

  // Add request headers (sanitized)
  if (requestHeaders) {
    logEntry.requestHeaders = sanitizeObject(requestHeaders)
  }

  // Add response headers
  if (responseHeaders) {
    logEntry.responseHeaders = responseHeaders
  }

  // Add response body
  if (responseBody) {
    if (typeof responseBody === 'string') {
      logEntry.responseBody = responseBody.substring(0, 10000) // Limit to 10KB
    } else {
      logEntry.responseBody = sanitizeObject(responseBody)
    }
  }

  // Add error if present
  if (error) {
    logEntry.error = error instanceof Error ? error.message : String(error)
  }

  const logLine = JSON.stringify(logEntry) + '\n'

  try {
    fs.appendFileSync(GITHUB_LOG_FILE, logLine, 'utf-8')
  } catch (e) {
    console.error('Failed to write GitHub API log:', e)
  }

  // Also console log for immediate visibility in development
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[GitHub API] ${method} ${path} -> ${statusCode || 'ERROR'}`)
    if (error) console.error('  Error:', error)
  }
}

export function logAPIEvent(
  action: string,
  details: Record<string, any>,
  statusCode?: number,
  error?: string | Error
) {
  ensureLogDir()

  const timestamp = formatTimestamp()
  const logEntry: any = {
    timestamp,
    action,
    ...sanitizeObject(details),
    statusCode: statusCode || 200
  }

  if (error) {
    logEntry.error = error instanceof Error ? error.message : String(error)
  }

  const logLine = JSON.stringify(logEntry) + '\n'

  try {
    fs.appendFileSync(API_LOG_FILE, logLine, 'utf-8')
  } catch (e) {
    console.error('Failed to write API log:', e)
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[API Event] ${action} -> ${statusCode || 200}`)
  }
}

export function getLogFilePath(logType: 'github' | 'api' = 'github'): string {
  return logType === 'github' ? GITHUB_LOG_FILE : API_LOG_FILE
}

export function readGitHubLogs(lines: number = 100): string {
  try {
    if (!fs.existsSync(GITHUB_LOG_FILE)) {
      return 'No logs yet'
    }
    const content = fs.readFileSync(GITHUB_LOG_FILE, 'utf-8')
    const logLines = content.split('\n').filter(l => l.trim())
    return logLines.slice(-lines).join('\n')
  } catch (e) {
    return `Error reading logs: ${e instanceof Error ? e.message : String(e)}`
  }
}
