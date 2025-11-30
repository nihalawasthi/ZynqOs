import type { VercelRequest, VercelResponse } from '@vercel/node'
import { setSessionCookie } from '../../lib/session.ts'

// Server-side Google token exchange using env-stored client ID/secret.
// IMPORTANT: For a public SPA you can omit the client secret and treat the app as a public client.
// If GOOGLE_CLIENT_SECRET is present we use a confidential flow; otherwise fall back to public PKCE exchange.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { code, redirectUri, codeVerifier } = req.body || {}
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET // optional
  if (!clientId || !code || !redirectUri || !codeVerifier) return res.status(400).json({ error: 'Missing parameters' })
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })
    if (clientSecret) body.set('client_secret', clientSecret)
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    const json = await tokenRes.json()
    if (json.error) return res.status(400).json(json)
    
    // Store tokens in httpOnly cookie
    const expiresAt = json.expires_in ? Date.now() + json.expires_in * 1000 : undefined
    setSessionCookie(res, {
      provider: 'google',
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt
    })
    
    return res.status(200).json({ success: true, provider: 'google', expiresAt })
  } catch (e: any) {
    console.error('Google exchange error', e)
    return res.status(500).json({ error: e.message || 'Exchange failed' })
  }
}
