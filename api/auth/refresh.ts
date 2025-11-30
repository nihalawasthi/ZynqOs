import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSessionFromCookie, setSessionCookie } from '../lib/session'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  const session = getSessionFromCookie(req)
  if (!session || session.provider !== 'google') {
    return res.status(401).json({ error: 'No Google session found' })
  }
  
  if (!session.refreshToken) {
    return res.status(400).json({ error: 'No refresh token available' })
  }
  
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId) return res.status(500).json({ error: 'Server config error' })
  
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken
    })
    if (clientSecret) body.set('client_secret', clientSecret)
    
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    const json = await tokenRes.json()
    if (json.error) return res.status(400).json(json)
    
    // Update session with new token
    const expiresAt = json.expires_in ? Date.now() + json.expires_in * 1000 : undefined
    setSessionCookie(res, {
      provider: 'google',
      accessToken: json.access_token,
      refreshToken: json.refresh_token || session.refreshToken, // Keep old if new not provided
      expiresAt
    })
    
    return res.status(200).json({ success: true, expiresAt })
  } catch (e: any) {
    console.error('Token refresh error', e)
    return res.status(500).json({ error: e.message || 'Refresh failed' })
  }
}
