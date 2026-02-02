/**
 * OAuth Credential Validation and Helper Functions
 * Centralizes credential checks and common OAuth patterns
 */
import { ENV, ERRORS, OAUTH_URLS } from './config'
import { VercelResponse } from '@vercel/node'
import { sendValidationError, sendError } from './helpers'

type OAuthProvider = 'google' | 'github'

/**
 * Validate that OAuth credentials are configured
 */
export function validateOAuthCredentials(provider: OAuthProvider): string | null {
  if (provider === 'google') {
    if (!ENV.GOOGLE_CLIENT_ID || !ENV.GOOGLE_CLIENT_SECRET) {
      return 'Google OAuth credentials not configured'
    }
  } else if (provider === 'github') {
    if (!ENV.GITHUB_CLIENT_ID || !ENV.GITHUB_CLIENT_SECRET) {
      return 'GitHub OAuth credentials not configured'
    }
  }
  return null
}

/**
 * Require Google credentials
 */
export function requireGoogleCredentials(res: VercelResponse): boolean {
  const error = validateOAuthCredentials('google')
  if (error) {
    sendError(res, error, 500)
    return false
  }
  return true
}

/**
 * Require GitHub credentials
 */
export function requireGitHubCredentials(res: VercelResponse): boolean {
  const error = validateOAuthCredentials('github')
  if (error) {
    sendError(res, error, 500)
    return false
  }
  return true
}

/**
 * Get Google OAuth URL for authorization
 */
export function getGoogleAuthURL(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: ENV.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email https://www.googleapis.com/auth/drive',
    state,
    access_type: 'offline',
    prompt: 'consent'
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

/**
 * Get GitHub OAuth URL for authorization
 */
export function getGitHubAuthURL(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: ENV.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'repo,user',
    state,
    allow_signup: 'true'
  })
  return `https://github.com/login/oauth/authorize?${params}`
}

/**
 * Exchange authorization code for access token (Google)
 */
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<any> {
  const body = new URLSearchParams({
    code,
    client_id: ENV.GOOGLE_CLIENT_ID,
    client_secret: ENV.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  })

  const res = await fetch(OAUTH_URLS.GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })

  return res.json()
}

/**
 * Exchange authorization code for access token (GitHub)
 */
export async function exchangeGitHubCode(code: string, state: string, redirectUri: string): Promise<any> {
  const body = new URLSearchParams({
    code,
    client_id: ENV.GITHUB_CLIENT_ID,
    client_secret: ENV.GITHUB_CLIENT_SECRET,
    redirect_uri: redirectUri,
    state
  })

  const res = await fetch(OAUTH_URLS.GITHUB_TOKEN, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })

  return res.json()
}

/**
 * Fetch Google user profile
 */
export async function fetchGoogleUserProfile(accessToken: string): Promise<any> {
  const res = await fetch(OAUTH_URLS.GOOGLE_USER, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  return res.json()
}

/**
 * Fetch GitHub user profile
 */
export async function fetchGitHubUserProfile(accessToken: string): Promise<any> {
  const res = await fetch(OAUTH_URLS.GITHUB_USER, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json'
    }
  })
  return res.json()
}

/**
 * Fetch GitHub user emails
 */
export async function fetchGitHubUserEmails(accessToken: string): Promise<any[]> {
  const res = await fetch(OAUTH_URLS.GITHUB_EMAILS, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json'
    }
  })
  return res.json()
}
