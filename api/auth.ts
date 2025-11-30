import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSessionFromCookie, setSessionCookie, clearSessionCookie } from './lib/session'

async function exchangeGoogle(req: VercelRequest, res: VercelResponse) {
  const { code, redirectUri, codeVerifier } = req.body || {}
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !code || !redirectUri || !codeVerifier) return res.status(400).json({ error: 'Missing parameters' })
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  })
  if (clientSecret) body.set('client_secret', clientSecret)
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  })
  const json = await tokenRes.json()
  if (json.error) return res.status(400).json(json)
  const expiresAt = json.expires_in ? Date.now() + json.expires_in * 1000 : undefined
  setSessionCookie(res, { provider: 'google', accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt })
  return res.status(200).json({ success: true, provider: 'google', expiresAt })
}

async function exchangeGitHub(req: VercelRequest, res: VercelResponse) {
  const { code, redirectUri } = req.body || {}
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  if (!clientId || !clientSecret || !code) return res.status(400).json({ error: 'Missing parameters' })
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri })
  })
  const json = await tokenRes.json()
  if (json.error) return res.status(400).json(json)
  setSessionCookie(res, { provider: 'github', accessToken: json.access_token })
  return res.status(200).json({ success: true, provider: 'github' })
}

async function status(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(200).json({ connected: false })
  const expired = session.expiresAt ? session.expiresAt < Date.now() : false
  return res.status(200).json({ connected: true, provider: session.provider, expiresAt: session.expiresAt, expired })
}

async function refresh(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session || session.provider !== 'google' || !session.refreshToken) return res.status(400).json({ error: 'No refresh token' })
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId) return res.status(500).json({ error: 'Missing GOOGLE_CLIENT_ID' })
  const body = new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: session.refreshToken })
  if (clientSecret) body.set('client_secret', clientSecret)
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const json = await tokenRes.json()
  if (json.error) return res.status(400).json(json)
  const expiresAt = json.expires_in ? Date.now() + json.expires_in * 1000 : undefined
  setSessionCookie(res, { provider: 'google', accessToken: json.access_token, refreshToken: json.refresh_token || session.refreshToken, expiresAt })
  return res.status(200).json({ success: true, expiresAt })
}

async function disconnect(req: VercelRequest, res: VercelResponse) {
  clearSessionCookie(res)
  return res.status(200).json({ success: true })
}

async function profile(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(200).json({ connected: false })
  try {
    if (session.provider === 'google') {
      const ures = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${session.accessToken}` } })
      const ujson = await ures.json()
      return res.status(200).json({ connected: true, provider: 'google', profile: { name: ujson.name, email: ujson.email, picture: ujson.picture, sub: ujson.sub } })
    } else if (session.provider === 'github') {
      const ures = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/vnd.github+json' } })
      const ujson = await ures.json()
      let email = ujson.email
      if (!email) {
        const eres = await fetch('https://api.github.com/user/emails', { headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/vnd.github+json' } })
        const ejson = await eres.json()
        const primary = Array.isArray(ejson) ? ejson.find((e: any) => e.primary) : null
        email = primary?.email || undefined
      }
      return res.status(200).json({ connected: true, provider: 'github', profile: { name: ujson.name || ujson.login, email, avatar_url: ujson.avatar_url, id: ujson.id } })
    }
    return res.status(400).json({ error: 'Unknown provider' })
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Profile fetch failed' })
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = (req.query.action || req.body?.action) as string | undefined
  try {
    switch (action) {
      case 'exchange_google': return exchangeGoogle(req, res)
      case 'exchange_github': return exchangeGitHub(req, res)
      case 'status': return status(req, res)
      case 'refresh': return refresh(req, res)
      case 'disconnect': return disconnect(req, res)
      case 'profile': return profile(req, res)
      default: return res.status(400).json({ error: 'Invalid action' })
    }
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Auth handler failure' })
  }
}
