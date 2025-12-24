import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import cookie from 'cookie'
import fs from 'fs'

// Inline session utilities to avoid import issues in Vercel
type ProviderSession = {
  provider: 'google' | 'github' | 'github-app'
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  userId?: string
  userName?: string
  userEmail?: string
  userAvatar?: string
  audit?: AuditEntry[]
  repoFullName?: string
  installationId?: number
}

type AuditEntry = {
  id: string
  ts: number
  ip: string
  route: string
  action?: string
  event: string
  status: 'success' | 'error'
  provider?: ProviderSession['provider']
  message?: string
}

const SESSION_COOKIE = 'zynqos_session'
const MAX_AGE = 7 * 24 * 60 * 60

const AUDIT_LIMIT = 300
const auditLog: AuditEntry[] = []

const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false'
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 20)
const rateBucket = new Map<string, { count: number; resetAt: number }>()

// CSRF state tokens for GitHub App installation flow
const installStateMap = new Map<string, { token: string; createdAt: number }>()
const STATE_TTL_MS = 600_000 // 10 minutes

function logGitHubDebug(label: string, payload: any) {
  const line = `[${new Date().toISOString()}] ${label}: ${JSON.stringify(payload).slice(0, 4000)}`
  console.log(line)
  try {
    fs.appendFileSync('/tmp/github_api.log', line + '\n')
  } catch (e) {
    // Best-effort; ignore write failures in serverless/fileless environments
  }
}

// ===== GitHub App helpers =====
function createGitHubAppJWT(): string {
  const appId = process.env.GITHUB_APP_ID
  const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY
  if (!appId || !privateKeyPem) {
    throw new Error('GitHub App credentials missing')
  }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: appId
  }
  const header = { alg: 'RS256', typ: 'JWT' }
  function b64url(obj: any) {
    return Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  }
  const encHeader = b64url(header)
  const encPayload = b64url(payload)
  const data = `${encHeader}.${encPayload}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(data)
  const signature = signer.sign(privateKeyPem).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${data}.${signature}`
}

async function getRepoInstallationId(owner: string, repo: string): Promise<number> {
  const jwt = createGitHubAppJWT()
  const url = `https://api.github.com/repos/${owner}/${repo}/installation`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json'
    }
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.message || 'Failed to get installation')
  return json.id
}

async function createInstallationAccessToken(installationId: number): Promise<{ token: string; expires_at?: string }> {
  const jwt = createGitHubAppJWT()
  const url = `https://api.github.com/app/installations/${installationId}/access_tokens`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json'
    }
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.message || 'Failed to create access token')
  return { token: json.token, expires_at: json.expires_at }
}

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

function getClientIp(req: VercelRequest): string {
  const xfwd = req.headers['x-forwarded-for']
  if (typeof xfwd === 'string' && xfwd.length > 0) return xfwd.split(',')[0].trim()
  if (Array.isArray(xfwd) && xfwd.length > 0) return xfwd[0]
  const xreal = req.headers['x-real-ip']
  if (typeof xreal === 'string' && xreal.length > 0) return xreal
  const xclient = req.headers['x-client-ip']
  if (typeof xclient === 'string' && xclient.length > 0) return xclient
  const cfip = req.headers['cf-connecting-ip']
  if (typeof cfip === 'string' && cfip.length > 0) return cfip
  return req.socket.remoteAddress || req.connection?.remoteAddress || 'unknown'
}

function recordAudit(req: VercelRequest, res: VercelResponse, entry: Omit<AuditEntry, 'id' | 'ts' | 'ip'>) {
  const ip = getClientIp(req)
  const audit: AuditEntry = { id: crypto.randomUUID(), ts: Date.now(), ip, ...entry }
  auditLog.push(audit)
  if (auditLog.length > AUDIT_LIMIT) auditLog.splice(0, auditLog.length - AUDIT_LIMIT)

  // Persist limited audit trail in the session cookie so entries survive cold starts.
  const session = getSessionFromCookie(req)
  if (session) {
    const trail = Array.isArray(session.audit) ? [...session.audit, audit] : [audit]
    const max = 15
    const trimmed = trail.slice(-max)
    setSessionCookie(res, { ...session, audit: trimmed })
  }
}

function isRateLimited(req: VercelRequest): boolean {
  if (!RATE_LIMIT_ENABLED) return false
  const ip = getClientIp(req)
  const now = Date.now()
  const bucket = rateBucket.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
  if (now > bucket.resetAt) {
    bucket.count = 0
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS
  }
  bucket.count += 1
  rateBucket.set(ip, bucket)
  const limited = bucket.count > RATE_LIMIT_MAX
  if (limited) rateBucket.set(ip, bucket)
  return limited
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
      recordAudit(req, res, { route: 'auth', action: 'exchange_google', event: 'auth.exchange_google', status: 'error', provider: 'google', message: 'Missing GOOGLE_CLIENT_ID' })
      return res.status(500).json({ error: 'Server configuration error: Missing GOOGLE_CLIENT_ID' })
    }
    if (!code) {
      console.error('authExchangeGoogle: Missing code in request body', { body: req.body })
      recordAudit(req, res, { route: 'auth', action: 'exchange_google', event: 'auth.exchange_google', status: 'error', provider: 'google', message: 'Missing code' })
      return res.status(400).json({ error: 'Missing authorization code' })
    }
    if (!redirectUri) {
      console.error('authExchangeGoogle: Missing redirectUri in request body', { body: req.body })
      recordAudit(req, res, { route: 'auth', action: 'exchange_google', event: 'auth.exchange_google', status: 'error', provider: 'google', message: 'Missing redirectUri' })
      return res.status(400).json({ error: 'Missing redirect URI' })
    }
    if (!codeVerifier) {
      console.error('authExchangeGoogle: Missing codeVerifier in request body', { body: req.body })
      recordAudit(req, res, { route: 'auth', action: 'exchange_google', event: 'auth.exchange_google', status: 'error', provider: 'google', message: 'Missing codeVerifier' })
      return res.status(400).json({ error: 'Missing PKCE code verifier' })
    }
    
    const body = new URLSearchParams({ client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier })
    if (clientSecret) body.set('client_secret', clientSecret)
    
    let tokenRes: Response
    try {
      tokenRes = await fetch('https://oauth2.googleapis.com/token', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
        body,
        signal: AbortSignal.timeout(10000) // 10s timeout
      })
    } catch (fetchError: any) {
      console.error('authExchangeGoogle: Fetch failed', fetchError)
      return res.status(500).json({ error: 'Failed to contact Google: ' + (fetchError.message || 'Network error') })
    }
    
    let json: any
    try {
      json = await tokenRes.json()
    } catch (parseError: any) {
      console.error('authExchangeGoogle: JSON parse failed', parseError)
      return res.status(500).json({ error: 'Invalid response from Google' })
    }
    
    if (json.error) {
      console.error('authExchangeGoogle: Google returned error', json)
      recordAudit(req, res, { route: 'auth', action: 'exchange_google', event: 'auth.exchange_google', status: 'error', provider: 'google', message: json.error })
      return res.status(400).json(json)
    }
    if (!json.access_token) {
      console.error('authExchangeGoogle: No access_token in response', json)
      recordAudit(req, res, { route: 'auth', action: 'exchange_google', event: 'auth.exchange_google', status: 'error', provider: 'google', message: 'No access_token' })
      return res.status(400).json({ error: 'No access token received from Google' })
    }
    
    const expiresAt = json.expires_in ? Date.now() + json.expires_in * 1000 : undefined
    
    // Immediately fetch and cache user profile
    let userName: string | undefined
    let userEmail: string | undefined
    let userAvatar: string | undefined
    let userId: string | undefined
    try {
      const ures = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${json.access_token}` }
      })
      if (ures.ok) {
        const ujson = await ures.json()
        userName = ujson.name
        userEmail = ujson.email
        userAvatar = ujson.picture
        userId = ujson.sub
      }
    } catch (e: any) {
      console.error('Failed to fetch Google profile during exchange:', e.message)
    }
    
    setSessionCookie(res, {
      provider: 'google',
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt,
      userId,
      userName,
      userEmail,
      userAvatar
    })
    recordAudit(req, res, { route: 'auth', action: 'exchange_google', event: 'auth.exchange_google', status: 'success', provider: 'google', message: `User: ${userName || 'unknown'}` })
    return res.status(200).json({
      success: true,
      provider: 'google',
      expiresAt
    })
  } catch (e: any) {
    console.error('authExchangeGoogle error:', e)
    recordAudit(req, res, { route: 'auth', action: 'exchange_google', event: 'auth.exchange_google', status: 'error', provider: 'google', message: e?.message || 'Exchange failed' })
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
      recordAudit(req, res, { route: 'auth', action: 'exchange_github', event: 'auth.exchange_github', status: 'error', provider: 'github', message: 'Missing GITHUB_CLIENT_ID' })
      return res.status(500).json({ error: 'Server configuration error: Missing GITHUB_CLIENT_ID' })
    }
    if (!clientSecret) {
      console.error('authExchangeGitHub: Missing GITHUB_CLIENT_SECRET env var')
      recordAudit(req, res, { route: 'auth', action: 'exchange_github', event: 'auth.exchange_github', status: 'error', provider: 'github', message: 'Missing GITHUB_CLIENT_SECRET' })
      return res.status(500).json({ error: 'Server configuration error: Missing GITHUB_CLIENT_SECRET' })
    }
    if (!code) {
      console.error('authExchangeGitHub: Missing code in request body', { body: req.body })
      recordAudit(req, res, { route: 'auth', action: 'exchange_github', event: 'auth.exchange_github', status: 'error', provider: 'github', message: 'Missing code' })
      return res.status(400).json({ error: 'Missing authorization code' })
    }
    
    let tokenRes: Response
    try {
      tokenRes = await fetch('https://github.com/login/oauth/access_token', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, 
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
        signal: AbortSignal.timeout(10000) // 10s timeout
      })
    } catch (fetchError: any) {
      console.error('authExchangeGitHub: Fetch failed', fetchError)
      return res.status(500).json({ error: 'Failed to contact GitHub: ' + (fetchError.message || 'Network error') })
    }
    
    let json: any
    try {
      json = await tokenRes.json()
    } catch (parseError: any) {
      console.error('authExchangeGitHub: JSON parse failed', parseError)
      return res.status(500).json({ error: 'Invalid response from GitHub' })
    }
    
    if (json.error) {
      console.error('authExchangeGitHub: GitHub returned error', json)
      recordAudit(req, res, { route: 'auth', action: 'exchange_github', event: 'auth.exchange_github', status: 'error', provider: 'github', message: json.error })
      return res.status(400).json(json)
    }
    if (!json.access_token) {
      console.error('authExchangeGitHub: No access_token in response', json)
      recordAudit(req, res, { route: 'auth', action: 'exchange_github', event: 'auth.exchange_github', status: 'error', provider: 'github', message: 'No access_token' })
      return res.status(400).json({ error: 'No access token received from GitHub' })
    }
    
    // Immediately fetch and cache user profile
    let userName: string | undefined
    let userEmail: string | undefined
    let userAvatar: string | undefined
    let userId: string | undefined
    try {
      const ures = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${json.access_token}`, Accept: 'application/vnd.github+json' }
      })
      logGitHubDebug('github.user.status', { status: ures.status })
      if (ures.ok) {
        const ujson = await ures.json()
        logGitHubDebug('github.user.payload', { login: ujson.login, name: ujson.name, email: ujson.email, id: ujson.id })
        userName = ujson.login || ujson.name
        userAvatar = ujson.avatar_url
        userEmail = ujson.email
        userId = String(ujson.id)
        // If no public email, fetch private emails
        if (!userEmail) {
          const eres = await fetch('https://api.github.com/user/emails', {
            headers: { Authorization: `Bearer ${json.access_token}`, Accept: 'application/vnd.github+json' }
          })
          logGitHubDebug('github.emails.status', { status: eres.status })
          if (eres.ok) {
            const ejson = await eres.json()
            const primary = Array.isArray(ejson) ? ejson.find((e: any) => e.primary) : null
            logGitHubDebug('github.emails.payload', { primary })
            userEmail = primary?.email
          } else {
            const errText = await eres.text()
            logGitHubDebug('github.emails.error', { status: eres.status, body: errText?.slice(0, 500) })
          }
        }
      } else {
        const errorText = await ures.text()
        logGitHubDebug('github.user.error', { status: ures.status, body: errorText?.slice(0, 500) })
      }
    } catch (e: any) {
      logGitHubDebug('github.user.exception', { message: e?.message })
    }
    
    logGitHubDebug('github.session.set', { userName, userEmail, userAvatar: userAvatar?.slice?.(0, 60), userId })
    setSessionCookie(res, {
      provider: 'github',
      accessToken: json.access_token,
      userId,
      userName,
      userEmail,
      userAvatar
    })
    recordAudit(req, res, { route: 'auth', action: 'exchange_github', event: 'auth.exchange_github', status: 'success', provider: 'github', message: `User: ${userName || 'unknown'}` })
    return res.status(200).json({
      success: true,
      provider: 'github'
    })
  } catch (e: any) {
    console.error('authExchangeGitHub error:', e)
    recordAudit(req, res, { route: 'auth', action: 'exchange_github', event: 'auth.exchange_github', status: 'error', provider: 'github', message: e?.message || 'Exchange failed' })
    return res.status(500).json({ error: e.message || 'Exchange failed' })
  }
}

async function authStatus(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(200).json({ connected: false, authenticated: false })
  
  // Only consider "connected" if github-app is installed (actual storage setup)
  // Regular OAuth (google, github) is just authentication, not storage connection
  const actuallyConnected = session.provider === 'github-app'
  const expired = session.expiresAt ? session.expiresAt < Date.now() : false
  
  // Build profile object
  let profile: any = {}
  if (session.userName || session.userEmail || session.userAvatar) {
    profile = {
      name: session.userName || 'User',
      email: session.userEmail,
      avatar_url: session.userAvatar,
      id: session.userId,
      repoFullName: session.repoFullName
    }
  }
  
  recordAudit(req, res, { route: 'auth', action: 'status', event: 'auth.status', status: 'success', provider: session.provider })
  return res.status(200).json({
    connected: actuallyConnected,
    authenticated: !!session,
    provider: session.provider,
    profile,
    expiresAt: session.expiresAt,
    expired
  })
}

async function authRefresh(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSessionFromCookie(req)
    if (!session || session.provider !== 'google' || !session.refreshToken) {
      recordAudit(req, res, { route: 'auth', action: 'refresh', event: 'auth.refresh', status: 'error', provider: session?.provider, message: 'No refresh token' })
      return res.status(400).json({ error: 'No refresh token' })
    }
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    if (!clientId) {
      recordAudit(req, res, { route: 'auth', action: 'refresh', event: 'auth.refresh', status: 'error', provider: 'google', message: 'Missing GOOGLE_CLIENT_ID' })
      return res.status(500).json({ error: 'Missing GOOGLE_CLIENT_ID' })
    }
    const body = new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: session.refreshToken })
    if (clientSecret) body.set('client_secret', clientSecret)
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    const json = await tokenRes.json()
    if (json.error) {
      recordAudit(req, res, { route: 'auth', action: 'refresh', event: 'auth.refresh', status: 'error', provider: 'google', message: json.error })
      return res.status(400).json(json)
    }
    const expiresAt = json.expires_in ? Date.now() + json.expires_in * 1000 : undefined
    setSessionCookie(res, { provider: 'google', accessToken: json.access_token, refreshToken: json.refresh_token || session.refreshToken, expiresAt })
    recordAudit(req, res, { route: 'auth', action: 'refresh', event: 'auth.refresh', status: 'success', provider: 'google', message: 'Token refreshed' })
    return res.status(200).json({ success: true, expiresAt })
  } catch (e: any) {
    console.error('authRefresh error:', e)
    recordAudit(req, res, { route: 'auth', action: 'refresh', event: 'auth.refresh', status: 'error', provider: 'google', message: e?.message || 'Refresh failed' })
    return res.status(500).json({ error: e.message || 'Refresh failed' })
  }
}

async function authDisconnect(req: VercelRequest, res: VercelResponse) {
  clearSessionCookie(res)
  recordAudit(req, res, { route: 'auth', action: 'disconnect', event: 'auth.disconnect', status: 'success', message: 'Session cleared' })
  return res.status(200).json({ success: true })
}

async function githubAppExchangeRepo(req: VercelRequest, res: VercelResponse) {
  try {
    const { repoUrl } = req.body || {}
    if (!repoUrl || typeof repoUrl !== 'string') return res.status(400).json({ error: 'Missing repoUrl' })
    // Parse owner/repo from URL
    let owner: string | undefined
    let repo: string | undefined
    try {
      const u = new URL(repoUrl)
      const parts = u.pathname.replace(/^\//, '').split('/')
      owner = parts[0]
      repo = parts[1]
    } catch {
      return res.status(400).json({ error: 'Invalid repo URL' })
    }
    if (!owner || !repo) return res.status(400).json({ error: 'Invalid repo URL' })

    const installationId = await getRepoInstallationId(owner, repo)
    const { token, expires_at } = await createInstallationAccessToken(installationId)
    const expiresAtMs = expires_at ? new Date(expires_at).getTime() : undefined
    
    // Fetch user info with installation token
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    })
    const userJson = await userRes.json()
    if (!userRes.ok) throw new Error(userJson.message || 'Failed to fetch user')
    
    setSessionCookie(res, {
      provider: 'github-app',
      accessToken: token,
      expiresAt: expiresAtMs,
      userId: String(userJson.id),
      userName: userJson.login || userJson.name,
      userEmail: userJson.email,
      userAvatar: userJson.avatar_url,
      installationId,
      repoFullName: `${owner}/${repo}`
    })
    recordAudit(req, res, { route: 'auth', action: 'github_app_exchange_repo', event: 'auth.github_app_repo', status: 'success', provider: 'github', message: `${owner}/${repo}` })
    return res.status(200).json({ success: true, provider: 'github', installationId, repo: `${owner}/${repo}`, expiresAt: expiresAtMs, user: userJson.login })
  } catch (e: any) {
    console.error('githubAppExchangeRepo error:', e)
    recordAudit(req, res, { route: 'auth', action: 'github_app_exchange_repo', event: 'auth.github_app_repo', status: 'error', provider: 'github', message: e?.message || 'Exchange failed' })
    return res.status(500).json({ error: e.message || 'Exchange failed' })
  }
}

async function githubAppCallback(req: VercelRequest, res: VercelResponse) {
  console.log('githubAppCallback called with params:', req.query)
  try {
    const { installation_id, state, setup_action } = req.query
    if (!installation_id || typeof installation_id !== 'string') {
      recordAudit(req, res, { route: 'auth', action: 'github_app_callback', event: 'auth.github_app_callback', status: 'error', provider: 'github-app', message: 'Missing installation_id' })
      return res.status(400).json({ error: 'Missing installation_id' })
    }
    
    // Validate CSRF state token if present
    if (state && typeof state === 'string') {
      const stored = installStateMap.get(state)
      if (!stored || Date.now() - stored.createdAt > STATE_TTL_MS) {
        recordAudit(req, res, { route: 'auth', action: 'github_app_callback', event: 'auth.github_app_callback', status: 'error', provider: 'github-app', message: 'Invalid or expired state token' })
        return res.status(403).json({ error: 'Invalid or expired state' })
      }
      installStateMap.delete(state)
    }

    const instIdNum = parseInt(installation_id, 10)
    if (isNaN(instIdNum)) {
      recordAudit(req, res, { route: 'auth', action: 'github_app_callback', event: 'auth.github_app_callback', status: 'error', provider: 'github-app', message: 'Invalid installation_id format' })
      return res.status(400).json({ error: 'Invalid installation_id' })
    }

    // Create installation access token
    const { token, expires_at } = await createInstallationAccessToken(instIdNum)
    
    // Fetch authenticated user info using the installation token
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json'
      }
    })
    const userJson = await userRes.json()
    if (!userRes.ok) throw new Error(userJson.message || 'Failed to fetch user')
    
    const expiresAtMs = expires_at ? new Date(expires_at).getTime() : undefined
    const userEmail = userJson.email || undefined
    
    setSessionCookie(res, {
      provider: 'github-app',
      accessToken: token,
      expiresAt: expiresAtMs,
      userId: String(userJson.id),
      userName: userJson.login || userJson.name,
      userEmail,
      userAvatar: userJson.avatar_url,
      installationId: instIdNum
    })
    
    recordAudit(req, res, {
      route: 'auth',
      action: 'github_app_callback',
      event: 'auth.github_app_callback',
      status: 'success',
      provider: 'github-app',
      message: `User: ${userJson.login}, Installation: ${instIdNum}, Action: ${setup_action}`
    })
    
    // Redirect to app with success message
    const redirectTo = process.env.VITE_AUTH_REDIRECT_URI || 'http://localhost:3000'
    return res.redirect(302, `${redirectTo}?storage=connected&provider=github-app`)
  } catch (e: any) {
    console.error('githubAppCallback error:', e)
    recordAudit(req, res, { route: 'auth', action: 'github_app_callback', event: 'auth.github_app_callback', status: 'error', provider: 'github-app', message: e?.message || 'Callback failed' })
    return res.status(500).json({ error: e.message || 'Callback failed' })
  }
}

async function authAudit(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(401).json({ error: 'Not authenticated' })
  recordAudit(req, res, { route: 'auth', action: 'audit', event: 'auth.audit_read', status: 'success', provider: session.provider })
  const limit = Math.min(Number(req.query.limit || 100), AUDIT_LIMIT)
  const memoryEntries = auditLog.slice(-limit)
  const sessionEntries = Array.isArray(session.audit) ? session.audit.slice(-limit) : []
  const combined = [...memoryEntries, ...sessionEntries]
  // Deduplicate by id, favor newest
  const dedup = new Map<string, AuditEntry>()
  for (const entry of combined.sort((a, b) => b.ts - a.ts)) {
    if (!dedup.has(entry.id)) dedup.set(entry.id, entry)
  }
  const entries = Array.from(dedup.values()).sort((a, b) => b.ts - a.ts).slice(0, limit)
  return res.status(200).json({ entries })
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
    if (!session || (session.provider !== 'github' && session.provider !== 'github-app')) return res.status(401).json({ error: 'No GitHub session' })
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
    if (!session || (session.provider !== 'github' && session.provider !== 'github-app')) return res.status(401).json({ error: 'No GitHub session' })
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
    contentType: req.headers['content-type'],
    ip: getClientIp(req)
  })
  
  try {
    if (route === 'auth' && isRateLimited(req)) {
      recordAudit(req, res, { route: 'auth', action: typeof action === 'string' ? action : undefined, event: 'auth.rate_limit', status: 'error', message: 'Rate limit exceeded' })
      res.setHeader('Retry-After', Math.ceil(RATE_LIMIT_WINDOW_MS / 1000).toString())
      return res.status(429).json({ error: 'Too many requests' })
    }

    // Route-based dispatch
    if (route === 'proxy') return proxy(req, res)
    if (route === 'auth') {
      switch (action) {
        case 'exchange_google': return authExchangeGoogle(req, res)
        case 'exchange_github': return authExchangeGitHub(req, res)
        case 'status': return authStatus(req, res)
        case 'github_app_install_url':
          return res.status(200).json({ url: process.env.VITE_GITHUB_APP_INSTALL_URL || process.env.GITHUB_APP_INSTALL_URL || '' })
        case 'github_app_setup_info':
          // Info for configuring GitHub App Setup URL
          const redirectUri = process.env.VITE_AUTH_REDIRECT_URI || 'http://localhost:3000'
          return res.status(200).json({
            setupUrl: `${redirectUri}/api?route=auth&action=github_app_callback`,
            redirectUri: redirectUri,
            appId: process.env.GITHUB_APP_ID || 'Not set',
            note: 'Configure this Setup URL in your GitHub App settings > General > Setup URL'
          })
        case 'github_app_exchange_repo':
          return githubAppExchangeRepo(req, res)
        case 'github_app_callback':
          return githubAppCallback(req, res)
        case 'env_status':
          return res.status(200).json({
            google: {
              clientId: !!process.env.GOOGLE_CLIENT_ID,
              clientSecret: !!process.env.GOOGLE_CLIENT_SECRET
            },
            github: {
              clientId: !!process.env.GITHUB_CLIENT_ID,
              clientSecret: !!process.env.GITHUB_CLIENT_SECRET
            }
          })
        case 'refresh': return authRefresh(req, res)
        case 'disconnect': return authDisconnect(req, res)
        case 'audit': return authAudit(req, res)
        case 'debug_session':
          // Debug endpoint to inspect session state
          const session = getSessionFromCookie(req)
          return res.status(200).json({
            hasSession: !!session,
            sessionData: session ? {
              provider: session.provider,
              userId: session.userId,
              userName: session.userName,
              userEmail: session.userEmail,
              userAvatar: session.userAvatar?.substring?.(0, 50),
              repoFullName: session.repoFullName,
              installationId: session.installationId,
              expiresAt: session.expiresAt,
              audit: session.audit?.length || 0
            } : null,
            cookieValue: null
          })
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
