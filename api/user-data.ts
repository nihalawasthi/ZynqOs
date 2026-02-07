import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import cookie from 'cookie'
import {
  getOrCreateUser,
  updateUserActiveTime,
  updateUserSettings,
  updateLastSync,
  updateAutoSyncInterval,
  type UserData
} from './lib/db.js'

type ProviderSession = {
  provider: 'google' | 'github' | 'github-app'
  userId?: string
}

function decodeSession(token: string): ProviderSession | null {
  try {
    const secret = process.env.SESSION_SECRET || 'dev-default-session-secret-change-in-production'
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [encodedHeader, encodedPayload, signature] = parts
    const data = `${encodedHeader}.${encodedPayload}`

    const hmac = crypto.createHmac('sha256', secret)
    hmac.update(data)
    const expectedSignature = hmac
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

    if (signature !== expectedSignature) return null

    const padded = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const payloadJson = Buffer.from(padded, 'base64').toString('utf-8')
    const payload = JSON.parse(payloadJson)

    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) return null

    const { iat, exp, ...session } = payload
    return session as ProviderSession
  } catch {
    return null
  }
}

// Helper to get user ID from session
function getUserIdFromSession(req: VercelRequest): { userId: string; provider: 'github' | 'google' } | null {
  const cookies = cookie.parse(req.headers.cookie || '')
  const sessionData = cookies['zynqos_session']

  if (!sessionData) return null

  const session = decodeSession(sessionData)
  if (session?.userId && (session.provider === 'github' || session.provider === 'google')) {
    return { userId: session.userId, provider: session.provider }
  }

  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  const origin = req.headers.origin || ''
  const allowedOrigins = [
    process.env.VITE_AUTH_REDIRECT_URI || '',
    'http://localhost:3000',
    'http://localhost:5173',
    'https://zynqos.vercel.app'
  ].filter(Boolean)

  if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  const userSession = getUserIdFromSession(req)
  
  if (!userSession) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { userId, provider } = userSession
  const action = req.query.action as string

  try {
    switch (action) {
      case 'get': {
        // Get or create user data
        const userData = await getOrCreateUser(userId, provider)
        return res.status(200).json(userData)
      }

      case 'update-active-time': {
        // Update active time from client
        const { activeTimeMs } = req.body
        
        if (typeof activeTimeMs !== 'number') {
          return res.status(400).json({ error: 'Invalid activeTimeMs' })
        }

        await updateUserActiveTime(userId, activeTimeMs)
        return res.status(200).json({ success: true })
      }

      case 'update-settings': {
        // Update user settings
        const { settings } = req.body
        
        if (!settings || typeof settings !== 'object') {
          return res.status(400).json({ error: 'Invalid settings' })
        }

        await updateUserSettings(userId, settings)
        return res.status(200).json({ success: true })
      }

      case 'update-sync': {
        // Update last sync timestamp
        await updateLastSync(userId)
        return res.status(200).json({ success: true })
      }

      case 'update-auto-sync-interval': {
        // Update auto sync interval
        const { intervalMinutes } = req.body
        
        if (intervalMinutes !== null && typeof intervalMinutes !== 'number') {
          return res.status(400).json({ error: 'Invalid intervalMinutes' })
        }

        await updateAutoSyncInterval(userId, intervalMinutes)
        return res.status(200).json({ success: true })
      }

      default:
        return res.status(400).json({ error: 'Invalid action' })
    }
  } catch (error) {
    console.error('User data API error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
