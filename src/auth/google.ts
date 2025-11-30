import { generateCodeVerifier, generateCodeChallenge } from './pkce'

export type GoogleAuthConfig = {
  clientId: string
  redirectUri: string
  scopes?: string[]
}

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
// Token exchange now performed via server endpoint /api/auth/google/exchange

export async function startGoogleOAuth(cfg: GoogleAuthConfig) {
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const scopes = cfg.scopes?.length ? cfg.scopes.join(' ') : 'openid email profile https://www.googleapis.com/auth/drive.file'

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: scopes,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent'
  })

  // Persist verifier temporarily in sessionStorage
  sessionStorage.setItem('google_pkce_verifier', verifier)
  const url = `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`
  return url
}

export async function exchangeGoogleCode(code: string, cfg: GoogleAuthConfig) {
  const verifier = sessionStorage.getItem('google_pkce_verifier') || ''
  const res = await fetch('/api/auth/google/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirectUri: cfg.redirectUri, codeVerifier: verifier })
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Google token exchange failed')
  return json as {
    access_token: string
    refresh_token?: string
    expires_in: number
    token_type: string
    id_token?: string
    scope?: string
  }
}
