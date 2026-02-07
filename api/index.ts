import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import cookie from 'cookie'
import fs from 'fs'
import {
  initChatDatabase,
  insertChatMessage,
  insertAttachment,
  listChatMessages,
  updateChatMessage as updateChatMessageDb,
  getAttachment,
  getLinkPreview,
  upsertLinkPreview
} from './lib/chatDb.ts'

// ===== Configuration Constants =====
const ENV = {
  // Node environment
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  IS_DEV: process.env.NODE_ENV !== 'production',

  // OAuth Providers
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || '',
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || '',

  // GitHub App
  GITHUB_APP_ID: process.env.GITHUB_APP_ID || '',
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY || '',
  GITHUB_APP_INSTALL_URL: process.env.VITE_GITHUB_APP_INSTALL_URL || process.env.GITHUB_APP_INSTALL_URL || '',
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET || '',

  // Session & Security
  SESSION_SECRET: process.env.SESSION_SECRET || '',
  VITE_AUTH_REDIRECT_URI: process.env.VITE_AUTH_REDIRECT_URI || 'http://localhost:3000',

  // Rate limiting
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== 'false',
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX || 20),
  RATE_LIMIT_WINDOW_MS: 60_000,
}

const API = {
  SESSION_COOKIE: 'zynqos_session',
  MAX_AGE: 30 * 24 * 60 * 60, // 30 days session cookie
  AUDIT_LIMIT: 300,
  STATE_TTL_MS: 600_000, // 10 minutes for CSRF state tokens
}

const HTTP = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMIT: 429,
  SERVER_ERROR: 500,
}

// Helper function for allowed origins
function isAllowedOrigin(origin: string): boolean {
  const allowedOrigins = [
    ENV.VITE_AUTH_REDIRECT_URI,
    'http://localhost:3000',
    'http://localhost:5173',
  ].filter(Boolean)
  return allowedOrigins.some(allowed => origin.startsWith(allowed))
}

// Logger functions - gracefully handle if module not available
let logGitHubAPI: any = null
let logAPIEvent: any = null
try {
  // Try to import logger if available
  const logger = require('./logger')
  logGitHubAPI = logger.logGitHubAPI || (() => {})
  logAPIEvent = logger.logAPIEvent || (() => {})
} catch (e) {
  // Fallback: silent functions if logger not available
  logGitHubAPI = () => {}
  logAPIEvent = () => {}
}

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

const auditLog: AuditEntry[] = []
const rateBucket = new Map<string, { count: number; resetAt: number }>()

// CSRF state tokens for GitHub App installation flow
const installStateMap = new Map<string, { token: string; createdAt: number }>()

// Periodic cleanup of expired state tokens to prevent memory leaks
function cleanupExpiredStates() {
  const now = Date.now()
  const expiredStates: string[] = []
  
  for (const [key, value] of installStateMap.entries()) {
    if (now - value.createdAt > API.STATE_TTL_MS) {
      expiredStates.push(key)
    }
  }
  
  expiredStates.forEach(key => installStateMap.delete(key))
  if (expiredStates.length > 0) {
    console.log(`Cleaned up ${expiredStates.length} expired CSRF state tokens`)
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupExpiredStates, 10 * 60 * 1000)

function logGitHubDebug(label: string, payload: any) {
  // Only log in development, never write sensitive data to disk
  if (ENV.IS_DEV) {
    console.log(`[${new Date().toISOString()}] ${label}:`, payload)
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let timeoutId: NodeJS.Timeout | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Timeout')), timeoutMs)
  })

  try {
    if (process.platform === 'win32') {
      return await Promise.race([fetch(url, init), timeoutPromise])
    }

    const controller = new AbortController()
    const response = await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      timeoutPromise
    ])
    return response as Response
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

// ===== Session token refresh helpers =====
async function refreshGoogleAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number } | null> {
  try {
    if (!ENV.GOOGLE_CLIENT_ID || !ENV.GOOGLE_CLIENT_SECRET) {
      console.error('[Token Refresh] Missing Google credentials for refresh')
      return null
    }
    
    const body = new URLSearchParams({
      client_id: ENV.GOOGLE_CLIENT_ID,
      client_secret: ENV.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
    
    const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    }, 10000)
    
    const json = await res.json()
    
    if (!res.ok || json.error) {
      console.error('[Token Refresh] Google token refresh failed:', json.error)
      return null
    }
    
    return {
      accessToken: json.access_token,
      expiresIn: json.expires_in || 3600
    };
  } catch (e: any) {
    console.error('[Token Refresh] Google refresh error:', e.message);
    return null;
  }
}

async function refreshGitHubToken(installationId: number): Promise<{ accessToken: string; expiresAt: string } | null> {
  try {
    // Create new installation access token (they expire in 1 hour)
    const result = await createInstallationAccessToken(installationId);
    return {
      accessToken: result.token,
      expiresAt: result.expires_at || new Date(Date.now() + 3600000).toISOString()
    };
  } catch (e: any) {
    console.error('[Token Refresh] GitHub token refresh failed:', e.message);
    return null;
  }
}

// Helper to check if token needs refresh (used before making API calls)
function shouldRefreshToken(expiresAt?: number): boolean {
  if (!expiresAt) return false;
  const now = Date.now();
  const timeUntilExpiry = expiresAt - now;
  // Refresh if less than 5 minutes remaining
  return timeUntilExpiry < 5 * 60 * 1000;
}

// ===== GitHub App helpers =====
// JWT cache to avoid regenerating valid tokens
let jwtCache: { token: string; expiresAt: number } | null = null

function createGitHubAppJWT(): string {
  // Return cached JWT if still valid (with 60s buffer)
  if (jwtCache && jwtCache.expiresAt > Date.now() + 60000) {
    return jwtCache.token
  }

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
  const token = `${data}.${signature}`
  
  // Cache the token
  jwtCache = {
    token,
    expiresAt: (now + 600) * 1000 // Convert to milliseconds
  }
  
  return token
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

// Installation token cache
const installTokenCache = new Map<number, { token: string; expiresAt: number }>()

async function createInstallationAccessToken(installationId: number): Promise<{ token: string; expires_at?: string }> {
  // Check cache first (with 5 minute buffer before expiry)
  const cached = installTokenCache.get(installationId)
  if (cached && cached.expiresAt > Date.now() + 300000) {
    return { token: cached.token, expires_at: new Date(cached.expiresAt).toISOString() }
  }

  const jwt = createGitHubAppJWT()
  const url = `https://api.github.com/app/installations/${installationId}/access_tokens`
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json'
    }
  }, 10000)
  const json = await res.json()
  if (!res.ok) throw new Error(json.message || 'Failed to create access token')
  
  // Cache the token
  if (json.expires_at) {
    installTokenCache.set(installationId, {
      token: json.token,
      expiresAt: new Date(json.expires_at).getTime()
    })
  }
  
  return { token: json.token, expires_at: json.expires_at }
}

function encodeSession(session: ProviderSession): string {
  // Use JWT with HS256 encryption instead of plain base64
  // Use ENV.SESSION_SECRET which is stable, fallback to a hardcoded dev default
  const secret = ENV.SESSION_SECRET || 'dev-default-session-secret-change-in-production';
  
  // JWT header
  const header = { alg: 'HS256', typ: 'JWT' };
  
  // JWT payload with expiration
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    ...session,
    iat: now,
    exp: now + API.MAX_AGE
  };
  
  // Encode to base64url
  function b64url(obj: any) {
    return Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }
  
  const encodedHeader = b64url(header);
  const encodedPayload = b64url(payload);
  const data = `${encodedHeader}.${encodedPayload}`;
  
  // Create HMAC signature
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(data);
  const signature = hmac
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  
  return `${data}.${signature}`;
}

function decodeSession(token: string): ProviderSession | null {
  try {
    // Use ENV.SESSION_SECRET which is stable, fallback to a hardcoded dev default
    const secret = ENV.SESSION_SECRET || 'dev-default-session-secret-change-in-production';
    const parts = token.split('.');
    
    if (parts.length !== 3) {
      console.warn('[Auth] Invalid JWT format');
      return null;
    }
    
    const [encodedHeader, encodedPayload, signature] = parts;
    
    // Verify signature
    function b64urlDecode(str: string) {
      const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(b64, 'base64').toString('utf-8');
    }
    
    const data = `${encodedHeader}.${encodedPayload}`;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(data);
    const expectedSignature = hmac
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    
    if (signature !== expectedSignature) {
      console.warn('[Auth] JWT signature mismatch - possible tampering');
      return null;
    }
    
    // Decode payload
    const payloadJson = b64urlDecode(encodedPayload);
    const payload = JSON.parse(payloadJson);
    
    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      console.warn('[Auth] JWT token expired');
      return null;
    }
    
    // Remove JWT-specific fields from session
    const { iat, exp, ...session } = payload;
    return session as ProviderSession;
  } catch (error) {
    console.error('[Auth] JWT decode error:', error);
    return null;
  }
}

function setSessionCookie(res: VercelResponse, session: ProviderSession) {
  const encoded = encodeSession(session)
  const cookieStr = cookie.serialize(API.SESSION_COOKIE, encoded, {
    httpOnly: true,
    secure: true, // Always enforce HTTPS
    sameSite: 'lax',
    maxAge: API.MAX_AGE,
    path: '/'
  })
  res.setHeader('Set-Cookie', cookieStr)
}

function getSessionFromCookie(req: VercelRequest): ProviderSession | null {
  const cookies = cookie.parse(req.headers.cookie || '')
  const sessionData = cookies[API.SESSION_COOKIE]
  if (!sessionData) return null
  return decodeSession(sessionData)
}

function invalidateGitHubToken(res: VercelResponse) {
  // Preserve session metadata (user info) but invalidate the GitHub token
  // This ensures user details are still visible but GitHub operations fail gracefully
  // User will be prompted to re-authenticate
  // In a real implementation, you might want to completely clear the session
  const cookieStr = cookie.serialize(API.SESSION_COOKIE, '', {
    httpOnly: true,
    secure: ENV.IS_PRODUCTION,
    sameSite: 'lax',
    maxAge: 0,
    path: '/'
  })
  res.setHeader('Set-Cookie', cookieStr)
}

function clearSessionCookie(res: VercelResponse) {
  const cookieStr = cookie.serialize(API.SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true, // Always enforce HTTPS
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
  if (auditLog.length > API.AUDIT_LIMIT) auditLog.splice(0, auditLog.length - API.AUDIT_LIMIT)

  // Persist limited audit trail in the session cookie so entries survive cold starts.
  // BUT: if a session cookie was already set in this response (e.g., from GitHub App flow),
  // don't overwrite it. Only update the session from request cookie if no response cookie exists.
  const existingSetCookie = res.getHeader('Set-Cookie')
  if (existingSetCookie) {
    return
  }
  
  const session = getSessionFromCookie(req)
  if (session) {
    const trail = Array.isArray(session.audit) ? [...session.audit, audit] : [audit]
    const max = 15
    const trimmed = trail.slice(-max)
    setSessionCookie(res, { ...session, audit: trimmed })
  }
}

function isRateLimited(req: VercelRequest): boolean {
  if (!ENV.RATE_LIMIT_ENABLED) return false
  const ip = getClientIp(req)
  const now = Date.now()
  const bucket = rateBucket.get(ip) || { count: 0, resetAt: now + ENV.RATE_LIMIT_WINDOW_MS }
  if (now > bucket.resetAt) {
    bucket.count = 0
    bucket.resetAt = now + ENV.RATE_LIMIT_WINDOW_MS
  }
  bucket.count += 1
  const limited = bucket.count > ENV.RATE_LIMIT_MAX
  rateBucket.set(ip, bucket)
  return limited
}

// ========== CHAT (IN-MEMORY REALTIME) ==========
type ChatAttachment = {
  id: string
  name: string
  mimeType: string
  size: number
  vfsPath: string
  downloadUrl?: string
}

type ChatMessage = {
  id: string
  chatId: string
  author: string
  body: string
  timestamp: string
  createdAt: number
  replyToId?: string
  editedAt?: string
  deletedAt?: string
  pinned?: boolean
  reactions?: Record<string, string[]>
  attachments?: ChatAttachment[]
  linkPreviews?: Array<{ url: string; title?: string; description?: string; image?: string }>
}

type ChatEvent =
  | { type: 'message'; chatId: string; message: ChatMessage }
  | { type: 'message-update'; chatId: string; message: ChatMessage }
  | { type: 'typing'; chatId: string; userId: string; isTyping: boolean }
  | { type: 'presence'; userId: string; presence: 'online' | 'away' | 'offline' }

const chatPresence = new Map<string, { presence: 'online' | 'away' | 'offline'; updatedAt: number }>()
const chatClients = new Map<VercelResponse, NodeJS.Timeout>()
let chatDbReady = false

async function ensureChatDb() {
  if (!chatDbReady) {
    await initChatDatabase()
    chatDbReady = true
  }
}

function parseJsonBody(req: VercelRequest): any {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return null
    }
  }
  return req.body
}

function writeSse(res: VercelResponse, event: ChatEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function publishChatEvent(event: ChatEvent) {
  for (const [res] of chatClients) {
    writeSse(res, event)
  }
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)]+/gi) || []
  return Array.from(new Set(matches)).slice(0, 3)
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim()
}

async function fetchLinkPreview(url: string): Promise<{ url: string; title?: string; description?: string; image?: string }> {
  const cached = await getLinkPreview(url)
  if (cached) return cached

  try {
    const res = await fetchWithTimeout(url, { method: 'GET', headers: { 'User-Agent': 'ZynqChatPreview/1.0' } }, 5000)
    const text = await res.text()
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i)
    const ogTitleMatch = text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    const descMatch = text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    const ogDescMatch = text.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    const ogImageMatch = text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)

    const preview = {
      url,
      title: stripTags((ogTitleMatch?.[1] || titleMatch?.[1] || '').slice(0, 140)),
      description: stripTags((ogDescMatch?.[1] || descMatch?.[1] || '').slice(0, 200)),
      image: ogImageMatch?.[1]
    }

    await upsertLinkPreview(preview)
    return preview
  } catch {
    return { url }
  }
}

async function chatSend(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  await ensureChatDb()

  const body = parseJsonBody(req) || {}
  const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : ''
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  const author = typeof body.author === 'string' && body.author.trim()
    ? body.author.trim()
    : (session.userName || session.userId || 'unknown')

  if (!chatId || !text) return res.status(400).json({ error: 'Missing chatId or body' })

  const urls = extractUrls(text)
  const linkPreviews = urls.length ? await Promise.all(urls.map(fetchLinkPreview)) : []

  const message: ChatMessage = {
    id: crypto.randomUUID(),
    chatId,
    author,
    body: text,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    createdAt: Date.now(),
    replyToId: typeof body.replyToId === 'string' ? body.replyToId : undefined,
    attachments: Array.isArray(body.attachments)
      ? body.attachments.map((att: any) => ({
          id: att.id,
          name: att.name,
          mimeType: att.mimeType,
          size: att.size,
          vfsPath: att.vfsPath || att.downloadUrl,
          downloadUrl: att.downloadUrl || att.vfsPath
        }))
      : undefined,
    linkPreviews: linkPreviews.length ? linkPreviews : undefined
  }

  await insertChatMessage({
    id: message.id,
    chatId: message.chatId,
    author: message.author,
    createdAt: message.createdAt,
    timestamp: message.timestamp,
    payload: {
      body: message.body,
      replyToId: message.replyToId,
      attachments: message.attachments?.map(att => ({
        id: att.id,
        name: att.name,
        mimeType: att.mimeType,
        size: att.size,
        downloadUrl: (att as any).downloadUrl || att.vfsPath
      })),
      linkPreviews: message.linkPreviews
    }
  })

  publishChatEvent({ type: 'message', chatId, message })

  return res.status(200).json({ message })
}

async function chatUpdate(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  await ensureChatDb()

  const body = parseJsonBody(req) || {}
  const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : ''
  const message = body.message as ChatMessage | undefined
  if (!chatId || !message?.id) return res.status(400).json({ error: 'Missing chatId or message' })

  const urls = extractUrls(message.body || '')
  const linkPreviews = urls.length ? await Promise.all(urls.map(fetchLinkPreview)) : []

  const updated: ChatMessage = {
    ...message,
    attachments: Array.isArray(message.attachments)
      ? message.attachments.map((att: any) => ({
          id: att.id,
          name: att.name,
          mimeType: att.mimeType,
          size: att.size,
          vfsPath: att.vfsPath || att.downloadUrl,
          downloadUrl: att.downloadUrl || att.vfsPath
        }))
      : message.attachments,
    linkPreviews: linkPreviews.length ? linkPreviews : message.linkPreviews
  }

  await updateChatMessageDb({
    id: updated.id,
    chatId: updated.chatId,
    author: updated.author,
    createdAt: updated.createdAt,
    timestamp: updated.timestamp,
    payload: {
      body: updated.body,
      replyToId: updated.replyToId,
      editedAt: updated.editedAt,
      deletedAt: updated.deletedAt,
      pinned: updated.pinned,
      reactions: updated.reactions,
      attachments: updated.attachments?.map(att => ({
        id: att.id,
        name: att.name,
        mimeType: att.mimeType,
        size: att.size,
        downloadUrl: (att as any).downloadUrl || att.vfsPath
      })),
      linkPreviews: updated.linkPreviews
    }
  })

  publishChatEvent({ type: 'message-update', chatId, message: updated })

  return res.status(200).json({ message: updated })
}

async function chatHistory(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  await ensureChatDb()

  const chatId = typeof req.query.chatId === 'string' ? req.query.chatId : ''
  if (!chatId) return res.status(400).json({ error: 'Missing chatId' })

  const since = typeof req.query.since === 'string' ? Number(req.query.since) : 0
  const records = await listChatMessages(chatId, since || undefined)
  const messages = records.map(record => ({
    id: record.id,
    chatId: record.chatId,
    author: record.author,
    createdAt: record.createdAt,
    timestamp: record.timestamp,
    body: record.payload.body,
    replyToId: record.payload.replyToId,
    editedAt: record.payload.editedAt,
    deletedAt: record.payload.deletedAt,
    pinned: record.payload.pinned,
    reactions: record.payload.reactions,
    attachments: record.payload.attachments?.map(att => ({
      id: att.id,
      name: att.name,
      mimeType: att.mimeType,
      size: att.size,
      vfsPath: att.downloadUrl,
      downloadUrl: att.downloadUrl,
      serverId: att.id
    })),
    linkPreviews: record.payload.linkPreviews
  }))

  return res.status(200).json({ messages })
}

function chatTyping(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  const body = parseJsonBody(req) || {}
  const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : ''
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const isTyping = Boolean(body.isTyping)
  if (!chatId || !userId) return res.status(400).json({ error: 'Missing chatId or userId' })

  publishChatEvent({ type: 'typing', chatId, userId, isTyping })
  return res.status(200).json({ success: true })
}

function chatPresenceUpdate(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  const body = parseJsonBody(req) || {}
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const presence = body.presence as 'online' | 'away' | 'offline'
  if (!userId || !presence) return res.status(400).json({ error: 'Missing userId or presence' })

  chatPresence.set(userId, { presence, updatedAt: Date.now() })
  publishChatEvent({ type: 'presence', userId, presence })
  return res.status(200).json({ success: true })
}

async function chatUploadAttachment(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  await ensureChatDb()

  const body = parseJsonBody(req) || {}
  const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : ''
  const name = typeof body.name === 'string' ? body.name : 'attachment'
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'application/octet-stream'
  const size = typeof body.size === 'number' ? body.size : 0
  const base64 = typeof body.base64 === 'string' ? body.base64 : ''
  if (!chatId || !base64) return res.status(400).json({ error: 'Missing chatId or data' })

  const bytes = Buffer.from(base64, 'base64')
  const record = await insertAttachment({ chatId, name, mimeType, size: size || bytes.length, bytes })
  const downloadUrl = `/api?route=chat&action=attachment&id=${record.id}`

  return res.status(200).json({
    attachment: {
      id: record.id,
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
      vfsPath: downloadUrl,
      downloadUrl,
      serverId: record.id
    }
  })
}

async function chatDownloadAttachment(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  await ensureChatDb()

  const attachmentId = typeof req.query.id === 'string' ? req.query.id : ''
  if (!attachmentId) return res.status(400).json({ error: 'Missing attachment id' })

  const result = await getAttachment(attachmentId)
  if (!result) return res.status(404).json({ error: 'Attachment not found' })

  res.setHeader('Content-Type', result.record.mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="${result.record.name}"`)
  res.status(200).send(result.bytes)
}

async function chatPreview(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  await ensureChatDb()

  const url = typeof req.query.url === 'string' ? req.query.url : ''
  if (!url) return res.status(400).json({ error: 'Missing url' })

  const preview = await fetchLinkPreview(url)
  return res.status(200).json({ preview })
}

function chatEvents(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  for (const [userId, entry] of chatPresence.entries()) {
    writeSse(res, { type: 'presence', userId, presence: entry.presence })
  }

  const pingTimer = setInterval(() => {
    res.write(': ping\n\n')
  }, 25000)

  chatClients.set(res, pingTimer)

  req.on('close', () => {
    const timer = chatClients.get(res)
    if (timer) clearInterval(timer)
    chatClients.delete(res)
  })
}

// ========== PROXY ==========

function stripSecurityMeta(html: string): string {
  return html
    .replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '')
    .replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '')
    .replace(/<meta[^>]+content=["'][^"']*frame-ancestors[^"']*["'][^>]*>/gi, '')
}

function injectProxyScript(html: string): string {
  if (html.includes('data-zynqos-proxy')) return html

  const script = `<script data-zynqos-proxy>
(function(){
  function getTargetBase(){
    try {
      var current = new URL(window.location.href);
      var param = current.searchParams.get('url');
      if (param) return param;
    } catch (e) {}
    return window.location.href;
  }
  function proxify(u){
    try {
      if (!u) return u;
      if (u.startsWith('blob:') || u.startsWith('data:')) return u;
      if (u.startsWith('/api?route=proxy&url=')) return u;
      var abs = new URL(u, getTargetBase());
      if (abs.protocol === 'http:' || abs.protocol === 'https:') {
        return '/api?route=proxy&url=' + encodeURIComponent(abs.toString());
      }
    } catch (e) {}
    return u;
  }
  var assign = window.location.assign.bind(window.location);
  var replace = window.location.replace.bind(window.location);
  window.location.assign = function(u){ return assign(proxify(u)); };
  window.location.replace = function(u){ return replace(proxify(u)); };
  var origOpen = window.open;
  window.open = function(u){ return origOpen ? origOpen(proxify(u)) : null; };
  var origPush = history.pushState;
  var origReplace = history.replaceState;
  history.pushState = function(state, title, url){ return origPush.call(this, state, title, proxify(url)); };
  history.replaceState = function(state, title, url){ return origReplace.call(this, state, title, proxify(url)); };
  document.addEventListener('submit', function(e){
    var form = e.target;
    if (!form || !form.action) return;
    try {
      var method = (form.method || 'GET').toUpperCase();
      if (method === 'GET') {
        e.preventDefault();
        var formData = new FormData(form);
        var params = new URLSearchParams();
        formData.forEach(function(value, key){
          if (typeof value === 'string') params.append(key, value);
        });
        var target = form.action + (form.action.indexOf('?') === -1 ? '?' : '&') + params.toString();
        window.location.assign(proxify(target));
      } else {
        form.action = proxify(form.action);
      }
    } catch (_) {}
  }, true);
  document.addEventListener('click', function(e){
    var link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (link && link.href) { link.href = proxify(link.href); }
  }, true);
})();
</script>`

  if (html.includes('</head>')) return html.replace('</head>', `${script}</head>`)
  if (html.includes('</body>')) return html.replace('</body>', `${script}</body>`)
  return script + html
}

function rewriteUrlsInCss(css: string, baseUrl: string): string {
  return css.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi, (match, quote, url) => {
    const absoluteUrl = resolveUrl(url, baseUrl)
    if (absoluteUrl && !absoluteUrl.startsWith('data:')) {
      return `url("${encodeProxyUrl(absoluteUrl)}")`
    }
    return match
  })
}

// Rewrite URLs in HTML content to route through proxy
function rewriteUrlsInHtml(html: string, baseUrl: string): string {
  try {
    html = stripSecurityMeta(html)
    html = injectProxyScript(html)

    // Parse base URL safely
    let baseUrlObj: URL
    try {
      baseUrlObj = new URL(baseUrl)
    } catch {
      return html
    }

    // Rewrite img src - both quoted and unquoted
    html = html.replace(/(<img[^>]+src\s*=\s*)["']?([^"'\s>]+)["']?/gi, (match, prefix, url) => {
      const absoluteUrl = resolveUrl(url, baseUrl)
      if (absoluteUrl && !absoluteUrl.startsWith('data:')) {
        return `${prefix}"${encodeProxyUrl(absoluteUrl)}"`
      }
      return match
    })

    // Rewrite script src
    html = html.replace(/(<script[^>]+src\s*=\s*)["']?([^"'\s>]+)["']?/gi, (match, prefix, url) => {
      const absoluteUrl = resolveUrl(url, baseUrl)
      if (absoluteUrl && !absoluteUrl.startsWith('data:')) {
        return `${prefix}"${encodeProxyUrl(absoluteUrl)}"`
      }
      return match
    })

    // Rewrite iframe/frame src
    html = html.replace(/(<(?:iframe|frame)[^>]+src\s*=\s*)["']?([^"'\s>]+)["']?/gi, (match, prefix, url) => {
      const absoluteUrl = resolveUrl(url, baseUrl)
      if (absoluteUrl && !absoluteUrl.startsWith('data:')) {
        return `${prefix}"${encodeProxyUrl(absoluteUrl)}"`
      }
      return match
    })

    // Rewrite media src (video, audio, source)
    html = html.replace(/(<(?:video|audio|source)[^>]+src\s*=\s*)["']?([^"'\s>]+)["']?/gi, (match, prefix, url) => {
      const absoluteUrl = resolveUrl(url, baseUrl)
      if (absoluteUrl && !absoluteUrl.startsWith('data:')) {
        return `${prefix}"${encodeProxyUrl(absoluteUrl)}"`
      }
      return match
    })

    // Rewrite href for links (but not javascript: links)
    html = html.replace(/(<(?:a|link)[^>]+href\s*=\s*)["']?([^"'\s>]+)["']?/gi, (match, prefix, url) => {
      if (!url.includes('javascript:')) {
        const absoluteUrl = resolveUrl(url, baseUrl)
        if (absoluteUrl && !absoluteUrl.startsWith('data:') && absoluteUrl.startsWith('http')) {
          return `${prefix}"${encodeProxyUrl(absoluteUrl)}"`
        }
      }
      return match
    })

    // Rewrite srcset for responsive images
    html = html.replace(/srcset\s*=\s*"([^"]+)"/gi, (match, srcset) => {
      const rewritten = srcset.split(',').map(item => {
        const parts = item.trim().split(/\s+/)
        const url = parts[0]
        const size = parts.slice(1).join(' ')
        const absoluteUrl = resolveUrl(url, baseUrl)
        return absoluteUrl ? `${encodeProxyUrl(absoluteUrl)}${size ? ' ' + size : ''}` : item
      }).join(', ')
      return `srcset="${rewritten}"`
    })

    // Rewrite background-image in inline styles
    html = html.replace(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
      const absoluteUrl = resolveUrl(url, baseUrl)
      if (absoluteUrl && !absoluteUrl.startsWith('data:')) {
        return `background-image: url("${encodeProxyUrl(absoluteUrl)}")`
      }
      return match
    })

    // Rewrite picture source srcset
    html = html.replace(/(<source[^>]+srcset\s*=\s*)["']?([^"'\s>]+)["']?/gi, (match, prefix, url) => {
      const absoluteUrl = resolveUrl(url, baseUrl)
      if (absoluteUrl && !absoluteUrl.startsWith('data:')) {
        return `${prefix}"${encodeProxyUrl(absoluteUrl)}"`
      }
      return match
    })

    // Rewrite form action
    html = html.replace(/(<form[^>]+action\s*=\s*)["']?([^"'\s>]+)["']?/gi, (match, prefix, url) => {
      if (!url.includes('javascript:')) {
        const absoluteUrl = resolveUrl(url, baseUrl)
        if (absoluteUrl && !absoluteUrl.startsWith('data:')) {
          return `${prefix}"${encodeProxyUrl(absoluteUrl)}"`
        }
      }
      return match
    })

    // Rewrite meta refresh URLs
    html = html.replace(/(<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=)([^"'>\s]+)([^"']*["'][^>]*>)/gi, (match, prefix, url, suffix) => {
      const absoluteUrl = resolveUrl(url, baseUrl)
      if (absoluteUrl && !absoluteUrl.startsWith('data:')) {
        return `${prefix}${encodeProxyUrl(absoluteUrl)}${suffix}`
      }
      return match
    })

    return html
  } catch (e) {
    console.error('URL rewriting error:', e)
    return html
  }
}

function resolveUrl(url: string, baseUrl: string): string {
  try {
    // Skip empty or special URLs
    if (!url || url.startsWith('#') || url.startsWith('javascript:') || url.startsWith('data:')) {
      return ''
    }

    // Already absolute
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }
    // Protocol-relative
    if (url.startsWith('//')) {
      const baseUrlObj = new URL(baseUrl)
      return `${baseUrlObj.protocol}${url}`
    }
    // Relative to base
    return new URL(url, baseUrl).href
  } catch {
    return ''
  }
}

function encodeProxyUrl(url: string): string {
  return `/api?route=proxy&url=${encodeURIComponent(url)}`
}

async function proxy(req: VercelRequest, res: VercelResponse) {
  // Disable proxy in production - security risk
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Proxy disabled in production' })
  }
  
  const origin = req.headers.origin || ''
  const allowedOrigins = [
    process.env.VITE_AUTH_REDIRECT_URI || '',
    'http://localhost:3000',
    'http://localhost:5173'
  ].filter(Boolean)
  
  const isAllowedOrigin = allowedOrigins.some(allowed => origin.startsWith(allowed))
  
  if (req.method === 'OPTIONS') {
    if (isAllowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(200).end()
  }
  
  const { url } = req.query
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' })
  
  try {
    const targetUrl = new URL(url)
    if (!['http:', 'https:'].includes(targetUrl.protocol)) return res.status(400).json({ error: 'Invalid protocol' })
    
    // Real browser headers to avoid bot detection - optimized for images
    const browserHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
      'Upgrade-Insecure-Requests': '1',
      'DNT': '1',
      'Connection': 'keep-alive'
    }
    
    // Add referer for authenticity
    if (targetUrl.hostname && !targetUrl.hostname.includes('localhost')) {
      browserHeaders['Referer'] = `${targetUrl.protocol}//${targetUrl.hostname}/`
    }
    
    const fetchOpts: RequestInit = {
      headers: browserHeaders,
      redirect: 'follow'
    }
    
    const response = await fetchWithTimeout(url, fetchOpts, 30000)
    if (!response.ok) return res.status(response.status).json({ error: `Upstream ${response.status}` })
    
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    let contentLength = response.headers.get('content-length')
    
    // Handle different content types
    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      let data = await response.text()
      data = rewriteUrlsInHtml(data, url)
      
      if (isAllowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
      }
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'public, max-age=3600')
      return res.status(200).send(data)
    } else if (contentType.includes('text/css')) {
      let data = await response.text()
      data = rewriteUrlsInCss(data, url)

      if (isAllowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
      }
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'public, max-age=86400')
      return res.status(200).send(data)
    } else {
      // For images, CSS, JS - stream directly without rewriting
      const data = await response.arrayBuffer()
      
      if (isAllowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
      }
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'public, max-age=86400') // Cache images for 24h
      if (contentLength) {
        res.setHeader('Content-Length', contentLength)
      }
      return res.status(200).send(Buffer.from(data))
    }
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
      tokenRes = await fetchWithTimeout('https://oauth2.googleapis.com/token', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
        body
      }, 10000)
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
    const { code, redirectUri, installation_id } = req.body || {}
    
    // If installation_id is present, use GitHub App flow
    if (installation_id && typeof installation_id === 'string') {
      const instIdNum = parseInt(installation_id, 10)
      if (isNaN(instIdNum)) {
        recordAudit(req, res, { route: 'auth', action: 'exchange_github', event: 'auth.exchange_github', status: 'error', provider: 'github-app', message: 'Invalid installation_id format' })
        return res.status(400).json({ error: 'Invalid installation_id' })
      }

      try {
        // First, get installation details to get account info
        const jwt = createGitHubAppJWT()
        const instRes = await fetch(`https://api.github.com/app/installations/${instIdNum}`, {
          headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: 'application/vnd.github+json'
          }
        })
        const instJson = await instRes.json()
        if (!instRes.ok) throw new Error(instJson.message || 'Failed to get installation details')
        
        // Get account info from installation
        const account = instJson.account
        if (!account) throw new Error('No account info in installation')
        
        // Create installation access token
        const { token, expires_at } = await createInstallationAccessToken(instIdNum)
        
        const expiresAtMs = expires_at ? new Date(expires_at).getTime() : undefined
        const repoFullName = `${account.login}/.zynqos_storage`
        
        setSessionCookie(res, {
          provider: 'github-app',
          accessToken: token,
          expiresAt: expiresAtMs,
          userId: String(account.id),
          userName: account.login,
          userEmail: undefined, // App tokens don't have access to email
          userAvatar: account.avatar_url,
          installationId: instIdNum,
          repoFullName
        })
        
        recordAudit(req, res, {
          route: 'auth',
          action: 'exchange_github',
          event: 'auth.exchange_github',
          status: 'success',
          provider: 'github-app',
          message: `GitHub App Installation: ${instIdNum}, User: ${account.login}`
        })
        
        // Return success for frontend to handle
        return res.status(200).json({
          success: true,
          provider: 'github-app',
          installationId: instIdNum,
          user: account.login,
          repoFullName
        })
      } catch (e: any) {
        console.error('GitHub App token exchange error:', e)
        recordAudit(req, res, { route: 'auth', action: 'exchange_github', event: 'auth.exchange_github', status: 'error', provider: 'github-app', message: e?.message || 'App token exchange failed' })
        return res.status(500).json({ error: e.message || 'GitHub App authentication failed' })
      }
    }
    
    // Regular GitHub OAuth flow
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
      tokenRes = await fetchWithTimeout('https://github.com/login/oauth/access_token', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, 
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri })
      }, 10000)
    } catch (fetchError: any) {
      console.error('authExchangeGitHub: Fetch failed', fetchError)
      logAPIEvent('github.oauth.token_exchange', { error: fetchError.message }, 500)
      return res.status(500).json({ error: 'Failed to contact GitHub: ' + (fetchError.message || 'Network error') })
    }
    
    let json: any
    try {
      json = await tokenRes.json()
    } catch (parseError: any) {
      console.error('authExchangeGitHub: JSON parse failed', parseError)
      logAPIEvent('github.oauth.token_exchange', { parseError: parseError.message }, 500)
      return res.status(500).json({ error: 'Invalid response from GitHub' })
    }
    
    logGitHubAPI('POST', 'https://github.com/login/oauth/access_token', tokenRes.status, undefined, undefined, json)
    
    if (json.error) {
      console.error('authExchangeGitHub: GitHub returned error', json)
      logAPIEvent('github.oauth.token_exchange', { error: json.error, error_description: json.error_description }, 400)
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
      const userBody = await ures.json()
      logGitHubAPI('GET', 'https://api.github.com/user', ures.status, undefined, Object.fromEntries(ures.headers.entries()), userBody)
      logGitHubDebug('github.user.status', { status: ures.status })
      if (ures.ok) {
        const ujson = userBody
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
          const emailsBody = await eres.json()
          logGitHubAPI('GET', 'https://api.github.com/user/emails', eres.status, undefined, Object.fromEntries(eres.headers.entries()), emailsBody)
          logGitHubDebug('github.emails.status', { status: eres.status })
          if (eres.ok) {
            const ejson = emailsBody
            const primary = Array.isArray(ejson) ? ejson.find((e: any) => e.primary) : null
            logGitHubDebug('github.emails.payload', { primary })
            userEmail = primary?.email
          } else {
            const errText = JSON.stringify(emailsBody)
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
    // Return success for frontend to handle
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
  let session = getSessionFromCookie(req);
  if (!session) return res.status(200).json({ connected: false, authenticated: false });
  
  // Check if token needs refresh
  if (shouldRefreshToken(session.expiresAt)) {
    console.log('[Auth] Token approaching expiration, attempting refresh');
    
    if (session.provider === 'google' && session.refreshToken) {
      const refreshed = await refreshGoogleAccessToken(session.refreshToken);
      if (refreshed) {
        const expiresAt = Date.now() + refreshed.expiresIn * 1000;
        session = {
          ...session,
          accessToken: refreshed.accessToken,
          expiresAt
        };
        setSessionCookie(res, session);
        console.log('[Auth] Google token refreshed successfully');
      } else {
        console.warn('[Auth] Failed to refresh Google token, will attempt later');
      }
    } else if (session.provider === 'github-app' && session.installationId) {
      const refreshed = await refreshGitHubToken(session.installationId);
      if (refreshed) {
        const expiresAt = new Date(refreshed.expiresAt).getTime();
        session = {
          ...session,
          accessToken: refreshed.accessToken,
          expiresAt
        };
        setSessionCookie(res, session);
        console.log('[Auth] GitHub App token refreshed successfully');
      } else {
        console.warn('[Auth] Failed to refresh GitHub App token');
      }
    }
  }
  
  // Consider storage "connected" when GitHub OAuth or GitHub App is active.
  // Google is auth-only unless paired with Drive storage.
  const actuallyConnected = session.provider === 'github-app' || session.provider === 'github';
  const expired = session.expiresAt ? session.expiresAt < Date.now() : false;
  
  // Build profile object
  let profile: any = {};
  if (session.userName || session.userEmail || session.userAvatar) {
    profile = {
      name: session.userName || 'User',
      email: session.userEmail,
      avatar_url: session.userAvatar,
      id: session.userId,
      repoFullName: session.repoFullName
    };
  }
  
  recordAudit(req, res, { route: 'auth', action: 'status', event: 'auth.status', status: 'success', provider: session.provider });
  return res.status(200).json({
    connected: actuallyConnected,
    authenticated: !!session,
    provider: session.provider,
    profile,
    expiresAt: session.expiresAt,
    expired
  });
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
      if (!stored || Date.now() - stored.createdAt > API.STATE_TTL_MS) {
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
    
    // Use default repo name - sync service will infer full path from login
    const repoFullName = `${userJson.login}/.zynqos_storage`
    
    setSessionCookie(res, {
      provider: 'github-app',
      accessToken: token,
      expiresAt: expiresAtMs,
      userId: String(userJson.id),
      userName: userJson.login || userJson.name,
      userEmail,
      userAvatar: userJson.avatar_url,
      installationId: instIdNum,
      repoFullName
    })
    
    recordAudit(req, res, {
      route: 'auth',
      action: 'github_app_callback',
      event: 'auth.github_app_callback',
      status: 'success',
      provider: 'github-app',
      message: `User: ${userJson.login}, Installation: ${instIdNum}, Action: ${setup_action}`
    })
    
    // Return JSON instead of redirect for frontend handling
    return res.status(200).json({ 
      success: true, 
      provider: 'github-app', 
      installationId: instIdNum,
      user: userJson.login,
      repo: repoFullName 
    })
  } catch (e: any) {
    console.error('githubAppCallback error:', e)
    recordAudit(req, res, { route: 'auth', action: 'github_app_callback', event: 'auth.github_app_callback', status: 'error', provider: 'github-app', message: e?.message || 'Callback failed' })
    return res.status(500).json({ error: e.message || 'Callback failed' })
  }
}

async function authAudit(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session) return res.status(401).json({ error: 'Not authenticated' })
  // Do NOT log audit events for audit log fetches
  const limit = Math.min(Number(req.query.limit || 100), API.AUDIT_LIMIT)
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

async function auditSync(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSessionFromCookie(req)
    if (!session) return res.status(401).json({ error: 'Not authenticated' })
    if (session.provider !== 'github' && session.provider !== 'github-app') {
      return res.status(400).json({ error: 'GitHub storage required for audit sync' })
    }
    
    // Get recent audit entries from memory + session
    const memoryEntries = auditLog.slice(-100)
    const sessionEntries = Array.isArray(session.audit) ? session.audit : []
    const allEntries = [...memoryEntries, ...sessionEntries]
    
    // Deduplicate
    const dedup = new Map<string, AuditEntry>()
    for (const entry of allEntries) {
      if (!dedup.has(entry.id)) dedup.set(entry.id, entry)
    }
    // Do NOT log audit events for audit sync fetches
    return res.status(200).json({ entries: Array.from(dedup.values()), count: dedup.size })
  } catch (e: any) {
    console.error('auditSync error:', e)
    return res.status(500).json({ error: e.message || 'Sync failed' })
  }
}

async function auditHistory(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSessionFromCookie(req)
    if (!session) return res.status(401).json({ error: 'Not authenticated' })
    if (session.provider !== 'github' && session.provider !== 'github-app') {
      return res.status(400).json({ error: 'GitHub storage required for audit history' })
    }
    
    const { startDate, endDate, date } = req.query
    
    // If specific date requested, return that date's logs
    if (date && typeof date === 'string') {
      // Do NOT log audit events for audit history fetches
      return res.status(200).json({ date, message: 'Use client-side auditSync service to fetch logs' })
    }
    // Return available dates info
    // Do NOT log audit events for audit history fetches
    return res.status(200).json({ message: 'Use client-side auditSync service to fetch historical logs' })
  } catch (e: any) {
    console.error('auditHistory error:', e)
    return res.status(500).json({ error: e.message || 'History failed' })
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
    if (!session || (session.provider !== 'github' && session.provider !== 'github-app')) return res.status(401).json({ error: 'No GitHub session' })
    const { owner, repo, path, content, message, sha } = req.body || {}
    if (!owner || !repo || !path || content === undefined || content === null) return res.status(400).json({ error: 'Missing fields' })
    
    // Validate parameters
    if (
      typeof owner !== 'string' || typeof repo !== 'string' || typeof path !== 'string' ||
      owner.length === 0 || repo.length === 0 || path.length === 0 ||
      /[^\w.-]/.test(owner) || /[^\w.-]/.test(repo) ||
      path.startsWith('/') || path.includes('..') || path.includes('\\') || /[\r\n]/.test(path)
    ) {
      return res.status(400).json({ error: 'Invalid parameters' })
    }
    
    // Sanitize commit message to prevent injection
    const sanitizedMessage = (typeof message === 'string' ? message : `Update ${path}`).slice(0, 500).replace(/[\r\n]/g, ' ')
    
    const body: any = { message: sanitizedMessage, content }
    if (sha && typeof sha === 'string') body.sha = sha
    const upRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const uploadBody = await upRes.json()
    logGitHubAPI('PUT', `https://api.github.com/repos/${owner}/${repo}/contents/${path}`, upRes.status, { Authorization: 'Bearer [REDACTED]' }, Object.fromEntries(upRes.headers.entries()), uploadBody)
    const json = uploadBody
    if (!upRes.ok) {
      logAPIEvent('github.sync.upload', { owner, repo, path, status: upRes.status, error: json.message || 'Upload failed' }, upRes.status)
      return res.status(upRes.status).json({ error: json.message || 'Upload failed' })
    }
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
    
    // Validate path parameters to prevent path traversal
    if (
      typeof owner !== 'string' || typeof repo !== 'string' || typeof path !== 'string' ||
      owner.length === 0 || repo.length === 0 || path.length === 0 ||
      /[^\w.-]/.test(owner) || /[^\w.-]/.test(repo) ||
      path.startsWith('/') || path.includes('..') || path.includes('\\') || /[\r\n]/.test(path)
    ) {
      return res.status(400).json({ error: 'Invalid path parameters' })
    }
    
    const dlRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/vnd.github+json' } })
    const json = await dlRes.json()
    logGitHubAPI('GET', `https://api.github.com/repos/${owner}/${repo}/contents/${path}`, dlRes.status, { Authorization: 'Bearer [REDACTED]' }, Object.fromEntries(dlRes.headers.entries()), json)
    if (!dlRes.ok) {
      logAPIEvent('github.sync.download', { owner, repo, path, status: dlRes.status, error: json.message || 'Download failed' }, dlRes.status)
      return res.status(dlRes.status).json({ error: json.message || 'Download failed' })
    }
    return res.status(200).json({ success: true, content: json.content, sha: json.sha })
  } catch (e: any) {
    console.error('githubDownload error:', e)
    return res.status(500).json({ error: e.message || 'GitHub download failed' })
  }
}

async function githubDelete(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const session = getSessionFromCookie(req)
    if (!session || (session.provider !== 'github' && session.provider !== 'github-app')) return res.status(401).json({ error: 'No GitHub session' })
    const { owner, repo, path, sha, message } = req.body || {}
    if (!owner || !repo || !path || !sha) return res.status(400).json({ error: 'Missing fields' })
    
    // Validate parameters
    if (
      typeof owner !== 'string' || typeof repo !== 'string' || typeof path !== 'string' || typeof sha !== 'string' ||
      owner.length === 0 || repo.length === 0 || path.length === 0 || sha.length === 0 ||
      /[^\w.-]/.test(owner) || /[^\w.-]/.test(repo) ||
      path.startsWith('/') || path.includes('..') || path.includes('\\') || /[\r\n]/.test(path)
    ) {
      return res.status(400).json({ error: 'Invalid parameters' })
    }
    
    // Sanitize commit message
    const sanitizedMessage = (typeof message === 'string' ? message : `Delete ${path}`).slice(0, 500).replace(/[\r\n]/g, ' ')
    
    const delRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: sanitizedMessage,
        sha
      })
    })
    const json = await delRes.json()
    logGitHubAPI('DELETE', `https://api.github.com/repos/${owner}/${repo}/contents/${path}`, delRes.status, { Authorization: 'Bearer [REDACTED]' }, Object.fromEntries(delRes.headers.entries()), json)
    if (!delRes.ok) {
      logAPIEvent('github.sync.delete', { owner, repo, path, status: delRes.status, error: json.message || 'Delete failed' }, delRes.status)
      return res.status(delRes.status).json({ error: json.message || 'Delete failed' })
    }
    return res.status(200).json({ success: true, path })
  } catch (e: any) {
    console.error('githubDelete error:', e)
    return res.status(500).json({ error: e.message || 'GitHub delete failed' })
  }
}

async function githubList(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSessionFromCookie(req)
    if (!session || (session.provider !== 'github' && session.provider !== 'github-app')) return res.status(401).json({ error: 'No GitHub session' })
    const { owner, repo, branch } = req.query
    if (!owner || !repo) return res.status(400).json({ error: 'Missing owner/repo' })
    
    // Validate parameters
    if (
      typeof owner !== 'string' || typeof repo !== 'string' ||
      owner.length === 0 || repo.length === 0 ||
      /[^\w.-]/.test(owner) || /[^\w.-]/.test(repo)
    ) {
      return res.status(400).json({ error: 'Invalid owner/repo' })
    }
    
    let targetBranch = 'main'
    if (typeof branch === 'string' && branch.length > 0) {
      // Validate branch name - prevent path traversal
      if (/[^\w\-./]/.test(branch) || branch.startsWith('/') || branch.includes('..')) {
        return res.status(400).json({ error: 'Invalid branch name' })
      }
      targetBranch = branch
    }
    
    const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${targetBranch}?recursive=1`, {
      headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/vnd.github+json' }
    })
    const json = await treeRes.json()
    logGitHubAPI('GET', `https://api.github.com/repos/${owner}/${repo}/git/trees/${targetBranch}?recursive=1`, treeRes.status, { Authorization: 'Bearer [REDACTED]' }, Object.fromEntries(treeRes.headers.entries()), { truncated: json.truncated, tree_count: Array.isArray(json.tree) ? json.tree.length : 0 })
    if (!treeRes.ok) {
      logAPIEvent('github.sync.list_files', { owner, repo, branch: targetBranch, status: treeRes.status, error: json.message || 'List failed' }, treeRes.status)
      return res.status(treeRes.status).json({ error: json.message || 'List failed' })
    }
    return res.status(200).json({ tree: json.tree || [], truncated: json.truncated || false })
  } catch (e: any) {
    console.error('githubList error:', e)
    return res.status(500).json({ error: e.message || 'GitHub list failed' })
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
  
  // CORS preflight - restrict to allowed origins only
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin || ''
    const allowedOrigins = [
      process.env.VITE_AUTH_REDIRECT_URI || '',
      'http://localhost:3000',
      'http://localhost:5173'
    ].filter(Boolean)
    const isAllowedOrigin = allowedOrigins.some(allowed => origin.startsWith(allowed))
    if (isAllowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(200).end()
  }
  
  // Add CORS headers to all responses - restrict to allowed origins
  const origin = req.headers.origin || ''
  const allowedOrigins = [
    process.env.VITE_AUTH_REDIRECT_URI || '',
    'http://localhost:3000',
    'http://localhost:5173',
    'https://zynqos.vercel.app'
  ].filter(Boolean)
  const isAllowedOrigin = allowedOrigins.some(allowed => origin.startsWith(allowed))
  if (isAllowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  
  // Log only auth and storage mutations for debugging (skip frequent status/list checks)
  if (route === 'auth' && action !== 'status' && action !== 'audit') {
    console.log('API Request:', {
      method: req.method,
      route,
      action,
      hasBody: !!req.body,
      bodyKeys: req.body ? Object.keys(req.body) : [],
      contentType: req.headers['content-type'],
      ip: getClientIp(req)
    })
  } else if (route === 'storage' && (action === 'upload' || action === 'delete')) {
    console.log('API Request:', {
      method: req.method,
      route,
      action,
      bodyKeys: req.body ? Object.keys(req.body) : []
    })
  }
  
  try {
    if (route === 'auth' && isRateLimited(req)) {
      recordAudit(req, res, { route: 'auth', action: typeof action === 'string' ? action : undefined, event: 'auth.rate_limit', status: 'error', message: 'Rate limit exceeded' })
      res.setHeader('Retry-After', Math.ceil(ENV.RATE_LIMIT_WINDOW_MS / 1000).toString())
      return res.status(429).json({ error: 'Too many requests' })
    }

    // Route-based dispatch
    if (route === 'proxy') return proxy(req, res)
    // Back-compat: /api?route=status
    if (route === 'status') return authStatus(req, res)
    if (route === 'chat') {
      switch (action) {
        case 'send': return chatSend(req, res)
        case 'update': return chatUpdate(req, res)
        case 'history': return chatHistory(req, res)
        case 'typing': return chatTyping(req, res)
        case 'presence': return chatPresenceUpdate(req, res)
        case 'events': return chatEvents(req, res)
        case 'upload': return chatUploadAttachment(req, res)
        case 'attachment': return chatDownloadAttachment(req, res)
        case 'preview': return chatPreview(req, res)
        default: return res.status(400).json({ error: 'Invalid chat action' })
      }
    }
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
        case 'audit_sync': return auditSync(req, res)
        case 'audit_history': return auditHistory(req, res)
        // debug_session endpoint removed - information disclosure vulnerability
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
          case 'delete': return githubDelete(req, res)
          case 'list': return githubList(req, res)
          case 'webhook': return githubWebhook(req, res)
          default: return res.status(400).json({ error: 'Invalid github action' })
        }
      }
      return res.status(400).json({ error: 'Invalid provider' })
    }
    if (route === 'logs') {
      // Only available in development or with auth
      if (process.env.NODE_ENV === 'production') {
        const session = getSessionFromCookie(req)
        if (!session) return res.status(401).json({ error: 'Unauthorized' })
      }
      // Logs endpoint - use view-logs.js script instead
      return res.status(200).json({ 
        message: 'Use "node view-logs.js" command to view logs',
        path: './logs/github-api.log'
      })
    }
    return res.status(400).json({ error: 'Invalid route' })
  } catch (e: any) {
    console.error('API handler error', e)
    return res.status(500).json({ error: e.message || 'Handler failure' })
  }
}
