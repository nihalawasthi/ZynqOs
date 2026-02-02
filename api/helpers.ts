/**
 * Centralized API Response Helpers
 * Eliminates repetitive response.status().json() patterns
 */
import type { VercelResponse } from '@vercel/node'
import { HTTP, ERRORS } from './config'

/**
 * Send success response
 */
export function sendSuccess(res: VercelResponse, data?: any, status = HTTP.OK) {
  return res.status(status).json(data || { success: true })
}

/**
 * Send error response
 */
export function sendError(res: VercelResponse, message: string, status = HTTP.BAD_REQUEST) {
  return res.status(status).json({ error: message })
}

/**
 * Send unauthorized error
 */
export function sendUnauthorized(res: VercelResponse, message = ERRORS.NOT_AUTHENTICATED) {
  return res.status(HTTP.UNAUTHORIZED).json({ error: message })
}

/**
 * Send validation error
 */
export function sendValidationError(res: VercelResponse, message: string) {
  return res.status(HTTP.BAD_REQUEST).json({ error: message })
}

/**
 * Send not found error
 */
export function sendNotFound(res: VercelResponse, message = ERRORS.NOT_FOUND) {
  return res.status(HTTP.NOT_FOUND).json({ error: message })
}

/**
 * Send rate limit error
 */
export function sendRateLimit(res: VercelResponse, retryAfterSeconds = 60) {
  res.setHeader('Retry-After', retryAfterSeconds.toString())
  return res.status(HTTP.RATE_LIMIT).json({ error: ERRORS.RATE_LIMITED })
}

/**
 * Send upstream error (proxy failure)
 */
export function sendUpstreamError(res: VercelResponse, status: number) {
  return res.status(status).json({ error: ERRORS.UPSTREAM_ERROR(status) })
}

/**
 * Send server error
 */
export function sendServerError(res: VercelResponse, message = 'Internal server error', error?: any) {
  if (error) {
    console.error('Server error:', error)
  }
  return res.status(HTTP.SERVER_ERROR).json({ error: message })
}

/**
 * Validate required parameter
 */
export function validateRequired(value: any, paramName: string): string | null {
  if (!value || typeof value !== 'string') {
    return ERRORS.MISSING_PARAM(paramName)
  }
  return null
}

/**
 * Validate parameter exists
 */
export function requireParam(res: VercelResponse, value: any, paramName: string): value is string {
  if (!value || typeof value !== 'string') {
    sendValidationError(res, ERRORS.MISSING_PARAM(paramName))
    return false
  }
  return true
}

/**
 * Require authenticated session
 */
export function requireSession<T>(res: VercelResponse, session: T | null): session is T {
  if (!session) {
    sendUnauthorized(res)
    return false
  }
  return true
}

/**
 * Require specific provider
 */
export function requireProvider(res: VercelResponse, session: any, requiredProvider: string): boolean {
  if (!session || session.provider !== requiredProvider) {
    sendValidationError(res, `${requiredProvider} storage required`)
    return false
  }
  return true
}
