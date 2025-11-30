import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import cookie from 'cookie'

// Inline session utilities to avoid import issues in Vercel
type ProviderSession = {
  provider: 'google' | 'github'
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  userId?: string
}

const SESSION_COOKIE = 'zynqos_session'
const MAX_AGE = 7 * 24 * 60 * 60

function encodeSession(session: ProviderSession): string {
  const json = JSON.stringify(session)
  return Buffer.from(json).toString('base64')
}

function decodeSession(encoded: string): ProviderSession | null {
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf-8')
    return JSON.parse(json)
  } catch {
    return null
  }
}

function setSessionCookie(res: VercelResponse, session: ProviderSession) {
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

function getSessionFromCookie(req: VercelRequest): ProviderSession | null {
  const cookies = cookie.parse(req.headers.cookie || '')
  const sessionData = cookies[SESSION_COOKIE]
  if (!sessionData) return null
  return decodeSession(sessionData)
}

function clearSessionCookie(res: VercelResponse) {
  const cookieStr = cookie.serialize(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/'
  })
  res.setHeader('Set-Cookie', cookieStr)
}

// ========== PROXY ==========
async function proxy(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(200).end()
  }
  const { url } = req.query
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' })
  try {
    const targetUrl = new URL(url)
    if (!['http:', 'https:'].includes(targetUrl.protocol)) return res.status(400).json({ error: 'Invalid protocol' })
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' } })
    if (!response.ok) return res.status(response.status).json({ error: `Upstream ${response.status}` })
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const data = await response.arrayBuffer()
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', contentType)
    return res.status(200).send(Buffer.from(data))
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Proxy failed' })
  }
}

// ========== AUTH ==========
async function authExchangeGoogle(req: VercelRequest, res: VercelResponse) {
  try {
    const { code, redirectUri, codeVerifier } = req.body || {}
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    
    // Detailed validation logging
    if (!clientId) {
      console.error('authExchangeGoogle: Missing GOOGLE_CLIENT_ID env var')
      return res.status(500).json({ error: 'Server configuration error: Missing GOOGLE_CLIENT_ID' })
    }
    if (!code) {
      console.error('authExchangeGoogle: Missing code in request body', { body: req.body })
      return res.status(400).json({ error: 'Missing authorization code' })
    }
    if (!redirectUri) {
      console.error('authExchangeGoogle: Missing redirectUri in request body', { body: req.body })
      return res.status(400).json({ error: 'Missing redirect URI' })
    }
    if (!codeVerifier) {
      console.error('authExchangeGoogle: Missing codeVerifier in request body', { body: req.body })
      return res.status(400).json({ error: 'Missing PKCE code verifier' })
    }
    const body = new URLSearchParams({ client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier })
    if (clientSecret) body.set('client_secret', clientSecret)
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    const json = await tokenRes.json()
    if (json.error) return res.status(400).json(json)
    const expiresAt = json.expires_in ? Date.now() + json.expires_in * 1000 : undefined
    setSessionCookie(res, { provider: 'google', accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt })
    return res.status(200).json({ success: true, provider: 'google', expiresAt })
  } catch (e: any) {
    console.error('authExchangeGoogle error:', e)
    return res.status(500).json({ error: e.message || 'Exchange failed' })
  }
}

async function authExchangeGitHub(req: VercelRequest, res: VercelResponse) {
  try {
    const { code, redirectUri } = req.body || {}
    const clientId = process.env.GITHUB_CLIENT_ID
    const clientSecret = process.env.GITHUB_CLIENT_SECRET
    
    // Detailed validation logging
    if (!clientId) {
      console.error('authExchangeGitHub: Missing GITHUB_CLIENT_ID env var')
      return res.status(500).json({ error: 'Server configuration error: Missing GITHUB_CLIENT_ID' })
    }
    if (!clientSecret) {
      console.error('authExchangeGitHub: Missing GITHUB_CLIENT_SECRET env var')
      return res.status(500).json({ error: 'Server configuration error: Missing GITHUB_CLIENT_SECRET' })
    }
    if (!code) {
      console.error('authExchangeGitHub: Missing code in request body', { body: req.body })
      return res.status(400).json({ error: 'Missing authorization code' })
    }
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }) })
    const json = await tokenRes.json()
    if (json.error) return res.status(400).json(json)
    setSessionCookie(res, { provider: 'github', accessToken: json.access_token })
    return res.status(200).json({ success: true, provider: 'github' })
  } catch (e: any) {
    console.error('authExchangeGitHub error:', e)
    return res.status(500).json({ error: e.message || 'Exchange failed' })
  }
}

async function authStatus(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(200).json({ connected: false })
  const expired = session.expiresAt ? session.expiresAt < Date.now() : false
  return res.status(200).json({ connected: true, provider: session.provider, expiresAt: session.expiresAt, expired })
}

async function authRefresh(req: VercelRequest, res: VercelResponse) {
  try {
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
  } catch (e: any) {
    console.error('authRefresh error:', e)
    return res.status(500).json({ error: e.message || 'Refresh failed' })
  }
}

async function authDisconnect(req: VercelRequest, res: VercelResponse) {
  clearSessionCookie(res)
  return res.status(200).json({ success: true })
}

async function authProfile(req: VercelRequest, res: VercelResponse) {
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

// ========== STORAGE: DRIVE ==========
async function driveChanges(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSessionFromCookie(req)
    if (!session || session.provider !== 'google') return res.status(401).json({ error: 'No Google session' })
    const pageToken = req.query.pageToken as string | undefined
    try {
      if (!pageToken) {
        const tokenRes = await fetch('https://www.googleapis.com/drive/v3/changes/startPageToken', { headers: { Authorization: `Bearer ${session.accessToken}` } })
        const tokenJson = await tokenRes.json()
        return res.status(200).json({ startPageToken: tokenJson.startPageToken, changes: [] })
      }
      const changesRes = await fetch(`https://www.googleapis.com/drive/v3/changes?pageToken=${pageToken}&spaces=drive&fields=changes(file(id,name,mimeType,modifiedTime,size,parents)),newStartPageToken,nextPageToken`, { headers: { Authorization: `Bearer ${session.accessToken}` } })
      const json = await changesRes.json()
      if (!changesRes.ok) return res.status(changesRes.status).json({ error: json.error?.message || 'Changes failed' })
      return res.status(200).json({ changes: json.changes || [], newStartPageToken: json.newStartPageToken, nextPageToken: json.nextPageToken })
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'Changes error' })
    }
  } catch (e: any) {
    console.error('driveChanges error:', e)
    return res.status(500).json({ error: e.message || 'Drive changes failed' })
  }
}

async function driveUpload(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const session = getSessionFromCookie(req)
    if (!session || session.provider !== 'google') return res.status(401).json({ error: 'No Google session' })
    const { fileName, content, mimeType, folderId } = req.body || {}
    if (!fileName || !content) return res.status(400).json({ error: 'Missing fileName or content' })
    try {
      const metadata = { name: fileName, parents: folderId ? [folderId] : [] }
      const boundary = 'zynqos_' + Date.now()
      const delimiter = `\r\n--${boundary}\r\n`
      const closeDelim = `\r\n--${boundary}--`
      const contentBuffer = Buffer.from(content, 'base64')
      const parts = [delimiter, 'Content-Type: application/json; charset=UTF-8\r\n\r\n', JSON.stringify(metadata), delimiter, `Content-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`, contentBuffer, closeDelim]
      const body = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p))
      const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body })
      const json = await uploadRes.json()
      if (!uploadRes.ok) return res.status(uploadRes.status).json({ error: json.error?.message || 'Upload failed' })
      return res.status(200).json({ success: true, fileId: json.id, fileName: json.name, mimeType: json.mimeType, size: json.size })
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'Upload error' })
    }
  } catch (e: any) {
    console.error('driveUpload error:', e)
    return res.status(500).json({ error: e.message || 'Drive upload failed' })
  }
}

async function driveDownload(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSessionFromCookie(req)
    if (!session || session.provider !== 'google') return res.status(401).json({ error: 'No Google session' })
    const fileId = req.query.fileId as string | undefined
    if (!fileId) return res.status(400).json({ error: 'Missing fileId' })
    try {
      const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${session.accessToken}` } })
      const buf = await dlRes.arrayBuffer()
      if (!dlRes.ok) return res.status(dlRes.status).json({ error: 'Download failed' })
      const base64 = Buffer.from(buf).toString('base64')
      return res.status(200).json({ success: true, content: base64 })
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'Download error' })
    }
  } catch (e: any) {
    console.error('driveDownload error:', e)
    return res.status(500).json({ error: e.message || 'Drive download failed' })
  }
}

// ========== STORAGE: GITHUB ==========
async function githubUpload(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const session = getSessionFromCookie(req)
    if (!session || session.provider !== 'github') return res.status(401).json({ error: 'No GitHub session' })
    const { owner, repo, path, content, message, sha } = req.body || {}
    if (!owner || !repo || !path || !content) return res.status(400).json({ error: 'Missing fields' })
    const body: any = { message: message || `Update ${path}`, content }
    if (sha) body.sha = sha
    const upRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await upRes.json()
    if (!upRes.ok) return res.status(upRes.status).json({ error: json.message || 'Upload failed' })
    return res.status(200).json({ success: true, sha: json.content?.sha, path: json.content?.path })
  } catch (e: any) {
    console.error('githubUpload error:', e)
    return res.status(500).json({ error: e.message || 'GitHub upload failed' })
  }
}

async function githubDownload(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSessionFromCookie(req)
    if (!session || session.provider !== 'github') return res.status(401).json({ error: 'No GitHub session' })
    const { owner, repo, path } = req.query
    if (!owner || !repo || !path) return res.status(400).json({ error: 'Missing owner/repo/path' })
    const dlRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/vnd.github+json' } })
    const json = await dlRes.json()
    if (!dlRes.ok) return res.status(dlRes.status).json({ error: json.message || 'Download failed' })
    return res.status(200).json({ success: true, content: json.content, sha: json.sha })
  } catch (e: any) {
    console.error('githubDownload error:', e)
    return res.status(500).json({ error: e.message || 'GitHub download failed' })
  }
}

async function githubWebhook(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const secret = process.env.GITHUB_WEBHOOK_SECRET
    if (!secret) return res.status(500).json({ error: 'Webhook secret not configured' })
    const signature = req.headers['x-hub-signature-256'] as string
    const event = req.headers['x-github-event'] as string
    if (!signature || !event) return res.status(400).json({ error: 'Missing GitHub headers' })
    const payload = JSON.stringify(req.body)
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    const digest = 'sha256=' + hmac
    if (signature !== digest) return res.status(401).json({ error: 'Invalid signature' })
    if (event === 'push') {
      const { repository, commits } = req.body as any
      console.log('GitHub push received', { repo: repository?.full_name, commits: commits?.length, ref: (req.body as any).ref })
      return res.status(200).json({ success: true, event, processed: commits?.length || 0 })
    }
    return res.status(200).json({ success: true, event })
  } catch (e: any) {
    console.error('githubWebhook error:', e)
    return res.status(500).json({ error: e.message || 'Webhook failed' })
  }
}

// ========== ROUTER ==========
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { route, action } = req.query
  
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    return res.status(200).end()
  }
  
  // Add CORS headers to all responses
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  
  // Log request details for debugging
  console.log('API Request:', {
    method: req.method,
    route,
    action,
    hasBody: !!req.body,
    bodyKeys: req.body ? Object.keys(req.body) : [],
    contentType: req.headers['content-type']
  })
  
  try {
    // Route-based dispatch
    if (route === 'proxy') return proxy(req, res)
    if (route === 'auth') {
      switch (action) {
        case 'exchange_google': return authExchangeGoogle(req, res)
        case 'exchange_github': return authExchangeGitHub(req, res)
        case 'status': return authStatus(req, res)
        case 'refresh': return authRefresh(req, res)
        case 'disconnect': return authDisconnect(req, res)
        case 'profile': return authProfile(req, res)
        default: return res.status(400).json({ error: 'Invalid auth action' })
      }
    }
    if (route === 'storage') {
      const provider = req.query.provider as string | undefined
      if (provider === 'drive') {
        switch (action) {
          case 'changes': return driveChanges(req, res)
          case 'upload': return driveUpload(req, res)
          case 'download': return driveDownload(req, res)
          default: return res.status(400).json({ error: 'Invalid drive action' })
        }
      }
      if (provider === 'github') {
        switch (action) {
          case 'upload': return githubUpload(req, res)
          case 'download': return githubDownload(req, res)
          case 'webhook': return githubWebhook(req, res)
          default: return res.status(400).json({ error: 'Invalid github action' })
        }
      }
      return res.status(400).json({ error: 'Invalid provider' })
    }
    return res.status(400).json({ error: 'Invalid route' })
  } catch (e: any) {
    console.error('API handler error', e)
    return res.status(500).json({ error: e.message || 'Handler failure' })
  }
}
