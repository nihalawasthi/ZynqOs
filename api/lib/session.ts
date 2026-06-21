import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import cookie from 'cookie'
import { ENV } from '../config'

export type ProviderSession = {
  provider: 'google' | 'github'
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  userId?: string
}

const SESSION_COOKIE = 'zynqos_session'
const MAX_AGE = 7 * 24 * 60 * 60 // 7 days

function getSecret(): string {
  return ENV.SESSION_SECRET
}

export function encodeSession(session: ProviderSession): string {
  const json = JSON.stringify(session)
  const data = Buffer.from(json).toString('base64')
  const hmac = crypto.createHmac('sha256', getSecret())
  hmac.update(data)
  const signature = hmac.digest('base64').replace(/=/g, '')
  return `${data}.${signature}`
}

export function decodeSession(encoded: string): ProviderSession | null {
  try {
    const lastDot = encoded.lastIndexOf('.')
    if (lastDot === -1) return null
    const data = encoded.slice(0, lastDot)
    const signature = encoded.slice(lastDot + 1)
    const hmac = crypto.createHmac('sha256', getSecret())
    hmac.update(data)
    const expected = hmac.digest('base64').replace(/=/g, '')
    if (signature !== expected) return null
    const json = Buffer.from(data, 'base64').toString('utf-8')
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
