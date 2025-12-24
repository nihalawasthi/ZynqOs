// Temporary GitHub App callback handler - merge into api/index.ts
// This handles the GitHub App installation redirect from GitHub
// env MUST set VITE_AUTH_REDIRECT_URI pointing to the callback handler

// After installing, GitHub redirects to:
// https://your-app.com/api?route=auth&action=github_app_callback&installation_id=123&state=xyz

export async function githubAppCallback(req: any, res: any) {
  try {
    const { installation_id, state, setup_action } = req.query
    if (!installation_id || typeof installation_id !== 'string') {
      return res.status(400).json({ error: 'Missing installation_id' })
    }
    
    // Validate CSRF state token if present
    if (state && typeof state === 'string') {
      // Check against installStateMap (shared from main handler)
      // If expired or missing, reject
      const stored = (global as any).__installStateMap?.get(state)
      if (!stored || Date.now() - stored.createdAt > 600_000) {
        return res.status(403).json({ error: 'Invalid or expired state' })
      }
      (global as any).__installStateMap?.delete(state)
    }

    const instIdNum = parseInt(installation_id, 10)
    if (isNaN(instIdNum)) {
      return res.status(400).json({ error: 'Invalid installation_id' })
    }

    // Create installation access token (use helper)
    const { token, expires_at } = await (global as any).createInstallationAccessToken(instIdNum)
    
    // Fetch authenticated user info
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json'
      }
    })
    const userJson = await userRes.json()
    if (!userRes.ok) throw new Error(userJson.message || 'Failed to fetch user')
    
    const expiresAtMs = expires_at ? new Date(expires_at).getTime() : undefined
    
    // Store in session cookie
    const sessionData = {
      provider: 'github-app',
      accessToken: token,
      expiresAt: expiresAtMs,
      userId: String(userJson.id),
      userName: userJson.login || userJson.name,
      userEmail: userJson.email || undefined,
      userAvatar: userJson.avatar_url,
      installationId: instIdNum
    }
    
    // setSessionCookie(res, sessionData)
    // recordAudit(req, res, ...)
    
    // Redirect to app
    const redirectTo = process.env.VITE_AUTH_REDIRECT_URI || 'http://localhost:3000'
    return res.redirect(302, `${redirectTo}?storage=connected&provider=github-app`)
  } catch (e: any) {
    console.error('githubAppCallback error:', e)
    return res.status(500).json({ error: e.message || 'Callback failed' })
  }
}
