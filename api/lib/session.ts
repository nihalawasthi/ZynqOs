import type { VercelRequest, VercelResponse } from '@vercel/node'
import cookie from 'cookie'

export type ProviderSession = {
  provider: 'google' | 'github'
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  userId?: string
}

const SESSION_COOKIE = 'zynqos_session'
const MAX_AGE = 7 * 24 * 60 * 60 // 7 days

// In production: use encrypted JWT or KV store with session ID
// For now: base64 encoded JSON (NOT PRODUCTION READY - for demo only)
export function encodeSession(session: ProviderSession): string {
  const json = JSON.stringify(session)
  return Buffer.from(json).toString('base64')
}

export function decodeSession(encoded: string): ProviderSession | null {
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf-8')
    return JSON.parse(json)
  } catch {
    return null
  }
}

export function setSessionCookie(res: VercelResponse, session: ProviderSession) {
  const encoded = encodeSession(session)
  const cookieStr = cookie.serialize(SESSION_COOKIE, encoded, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE,
    path: '/'
  })
  res.setHeader('Set-Cookie', cookieStr)
}

export function getSessionFromCookie(req: VercelRequest): ProviderSession | null {
  const cookies = cookie.parse(req.headers.cookie || '')
  const sessionData = cookies[SESSION_COOKIE]
  if (!sessionData) return null
  return decodeSession(sessionData)
}

export function clearSessionCookie(res: VercelResponse) {
  const cookieStr = cookie.serialize(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/'
  })
  res.setHeader('Set-Cookie', cookieStr)
}
