import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSessionFromCookie } from '../lib/session'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  
  const session = getSessionFromCookie(req)
  if (!session) {
    return res.status(200).json({ connected: false })
  }
  
  // Check if token is expired
  const isExpired = session.expiresAt && session.expiresAt < Date.now()
  
  return res.status(200).json({
    connected: true,
    provider: session.provider,
    expiresAt: session.expiresAt,
    expired: isExpired || false
  })
}
