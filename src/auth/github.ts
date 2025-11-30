export type GitHubAuthConfig = {
  clientId: string
  redirectUri: string
  scopes?: string[]
}

// GitHub OAuth flow (client-side code flow; PKCE not universally supported for OAuth apps)
// Recommended: use a backend to exchange code and store refresh tokens securely.

const GITHUB_AUTH_ENDPOINT = 'https://github.com/login/oauth/authorize'

export function startGitHubOAuth(cfg: GitHubAuthConfig) {
  // Include user:email to fetch primary email after auth
  const scopes = cfg.scopes?.length ? cfg.scopes.join(' ') : 'repo user:email'
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: scopes,
    allow_signup: 'true'
  })
  return `${GITHUB_AUTH_ENDPOINT}?${params.toString()}`
}

// Token exchange should be done server-side via /api/auth/github/exchange
