import type { VercelRequest, VercelResponse } from '@vercel/node'
import { setSessionCookie } from '../../lib/session.ts'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { code, redirectUri } = req.body || {}
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  if (!clientId || !clientSecret || !code) return res.status(400).json({ error: 'Missing parameters' })

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri })
    })
    const json = await tokenRes.json()
    if (json.error) return res.status(400).json(json)
    
    // Store token in httpOnly cookie
    setSessionCookie(res, {
      provider: 'github',
      accessToken: json.access_token
    })
    
    return res.status(200).json({ success: true, provider: 'github' })
  } catch (e: any) {
    console.error('GitHub exchange error', e)
    return res.status(500).json({ error: e.message || 'Exchange failed' })
  }
}
