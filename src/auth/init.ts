import ConsentModal from '../storage/ConsentModal'
import { startGoogleOAuth } from './google'
import { startGitHubOAuth } from './github'
import { GOOGLE_CLIENT_ID, GITHUB_CLIENT_ID, AUTH_REDIRECT_URI } from './config'
import { setRemoteRoot } from '../vfs/map'
import { startSync } from '../storage/sync'
import { clearStatusCache } from './storage'

function attachGlobals() {
  (window as any).ZynqOS_startGoogleAuth = async () => {
    const url = await startGoogleOAuth({ clientId: GOOGLE_CLIENT_ID, redirectUri: AUTH_REDIRECT_URI })
    const withState = url + '&state=google'
    location.href = withState
  }
  (window as any).ZynqOS_startGitHubAuth = () => {
    const url = startGitHubOAuth({ clientId: GITHUB_CLIENT_ID, redirectUri: AUTH_REDIRECT_URI })
    const withState = url + '&state=github'
    location.href = withState
  }
  ;(window as any).ZynqOS_openConsent = () => {
    (window as any).ZynqOS_openWindow?.('Connect Storage', ConsentModal, 'modal')
  }

  // Warn if redirect URI does not match current origin
  const currentOrigin = `${location.protocol}//${location.host}`
  if (currentOrigin !== AUTH_REDIRECT_URI) {
    console.warn('[ZynqOS] AUTH_REDIRECT_URI differs from current origin:', AUTH_REDIRECT_URI, '!=', currentOrigin)
  }
}

export async function bootstrapAuthRedirect() {
  attachGlobals()
  
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const storageParam = url.searchParams.get('storage')
  const providerParam = url.searchParams.get('provider')
  
  // Handle GitHub App callback redirect
  if (storageParam === 'connected' && providerParam === 'github-app') {
    try {
      const statusRes = await fetch('/api?route=auth&action=status', { credentials: 'include' })
      const statusJson = await statusRes.json()
      
      if (statusJson.connected) {
        const root = { provider: 'github' as const, id: 'server-session' }
        await setRemoteRoot(root)
        console.log('GitHub App connected via secure session', root)
        startSync().catch(console.error)
        window.dispatchEvent(new CustomEvent('zynqos:storage-connected', { detail: { provider: 'github-app' } }))
      }
    } catch (e) {
      console.error('GitHub App callback handling failed', e)
    } finally {
      // Clean URL
      url.searchParams.delete('storage')
      url.searchParams.delete('provider')
      history.replaceState({}, document.title, url.pathname + url.search + url.hash)
    }
    return
  }
  
  if (!code || !state) return

  try {
    if (state === 'google') {
      clearStatusCache()
      // Server-side exchange preserves confidentiality of client secret (if set)
      const res = await fetch('/api?route=auth&action=exchange_google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirectUri: AUTH_REDIRECT_URI, codeVerifier: sessionStorage.getItem('google_pkce_verifier') || '' })
      })
      let json: any
      const copy1 = res.clone()
      try {
        json = await res.json()
      } catch {
        const text = await copy1.text()
        throw new Error(`Google exchange not JSON: ${text.slice(0,120)}...`)
      }
      if (!res.ok) throw new Error(json.error || 'Google exchange failed')
      
      // Session is now stored in httpOnly cookie
      const statusRes = await fetch('/api?route=auth&action=status', { credentials: 'include' })
      const copy2 = statusRes.clone()
      let statusJson: any
      try { statusJson = await statusRes.json() } catch { const t = await copy2.text(); throw new Error(`Status not JSON: ${t.slice(0,120)}...`) }
      
      if (statusJson.authenticated || statusJson.connected) {
        // Initialize provider using server-side API (will use cookie)
        const root = { provider: 'google-drive' as const, id: 'server-session' }
        await setRemoteRoot(root)
        console.log('Google authenticated via secure session', root)
        // Start background sync only if storage is connected
        if (statusJson.connected) {
          startSync().catch(console.error)
        }
        // Notify UI
        window.dispatchEvent(new CustomEvent('zynqos:storage-connected', { detail: { provider: 'google' } }))
      }
    } else if (state === 'github') {
      clearStatusCache()
      // Exchange via server to avoid exposing secret
      const res = await fetch('/api?route=auth&action=exchange_github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirectUri: AUTH_REDIRECT_URI })
      })
      let json: any
      const copy3 = res.clone()
      try { json = await res.json() } catch { const t = await copy3.text(); throw new Error(`GitHub exchange not JSON: ${t.slice(0,120)}...`) }
      if (!res.ok) throw new Error(json.error || 'GitHub exchange failed')
      
      // Session is now stored in httpOnly cookie
      const statusRes = await fetch('/api?route=auth&action=status', { credentials: 'include' })
      const copy4 = statusRes.clone()
      let statusJson: any
      try { statusJson = await statusRes.json() } catch { const t = await copy4.text(); throw new Error(`Status not JSON: ${t.slice(0,120)}...`) }
      
      if (statusJson.authenticated || statusJson.connected) {
        const root = { provider: 'github' as const, id: 'server-session' }
        await setRemoteRoot(root)
        console.log('GitHub authenticated via secure session', root)
        // Start background sync only if storage is connected
        if (statusJson.connected) {
          startSync().catch(console.error)
        }
        // Notify UI
        window.dispatchEvent(new CustomEvent('zynqos:storage-connected', { detail: { provider: 'github' } }))
      }
    }
  } catch (e) {
    console.error('Auth redirect handling failed', e)
  } finally {
    // Clean URL
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    history.replaceState({}, document.title, url.pathname + url.search + url.hash)
  }
}

// Ensure globals ready even without redirect
attachGlobals()
