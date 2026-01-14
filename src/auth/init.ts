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
    const withState = url + '&state=google&popup=1'
    const popup = window.open(withState, 'oauth-google', 'width=640,height=760,menubar=no,toolbar=no,location=yes,status=no')
    // If popup blocked, fall back to same-page redirect
    if (!popup) {
      location.href = withState
    } else {
      popup.focus()
    }
  }
  (window as any).ZynqOS_startGitHubAuth = () => {
    const url = startGitHubOAuth({ clientId: GITHUB_CLIENT_ID, redirectUri: AUTH_REDIRECT_URI })
    const withState = url + '&state=github&popup=1'
    const popup = window.open(withState, 'oauth-github', 'width=640,height=760,menubar=no,toolbar=no,location=yes,status=no')
    if (!popup) {
      location.href = withState
    } else {
      popup.focus()
    }
  }
  ;(window as any).ZynqOS_openConsent = () => {
    (window as any).ZynqOS_openWindow?.('Connect Storage', ConsentModal, 'modal')
  }

  // Warn if redirect URI does not match current origin
  const currentOrigin = `${location.protocol}//${location.host}`
  if (currentOrigin !== AUTH_REDIRECT_URI) {
    console.warn('[ZynqOS] AUTH_REDIRECT_URI differs from current origin:', AUTH_REDIRECT_URI, '!=', currentOrigin)
  }

  // Listen for popup auth completion and initialize storage without reloading
  window.addEventListener('message', async (event: MessageEvent) => {
    const data: any = (event && (event as any).data) || {}
    if (data && data.type === 'zynqos-auth-complete') {
      try {
        clearStatusCache()
        const statusRes = await fetch('/api?route=auth&action=status', { credentials: 'include' })
        const statusJson = await statusRes.json()
        if (statusJson.connected || statusJson.authenticated) {
          // Map provider label
          const prov = data.provider === 'google' ? ('google-drive' as const) : ('github' as const)
          const root = { provider: prov, id: 'server-session' }
          await setRemoteRoot(root)
          if (statusJson.connected) startSync().catch(console.error)
          window.dispatchEvent(new CustomEvent('zynqos:storage-connected', { detail: { provider: data.provider } }))
        }
      } catch (e) {
        console.error('[Auth] Failed to finalize after popup auth', e)
      }
    }
  })
}

export async function bootstrapAuthRedirect() {
  attachGlobals()
  
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const storageParam = url.searchParams.get('storage')
  const providerParam = url.searchParams.get('provider')
  const installationId = url.searchParams.get('installation_id')
  const setupAction = url.searchParams.get('setup_action')
  
  // Handle GitHub App installation callback (code + installation_id)
  if (code && installationId) {
    try {
      const res = await fetch('/api?route=auth&action=exchange_github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          code, 
          redirectUri: AUTH_REDIRECT_URI, 
          installation_id: installationId 
        })
      })
      
      const json = await res.json()
      
      if (res.ok && json.success) {
        // Clean URL
        url.searchParams.delete('code')
        url.searchParams.delete('installation_id')
        url.searchParams.delete('setup_action')
        history.replaceState({}, document.title, url.pathname + url.search + url.hash)
        
        // Refresh status and notify
        clearStatusCache()
        const statusRes = await fetch('/api?route=auth&action=status', { credentials: 'include' })
        const statusJson = await statusRes.json()
        
        const root = { provider: 'github' as const, id: 'server-session' }
        await setRemoteRoot(root)
        console.log('GitHub App authenticated via secure session', root)
        
        if (statusJson.connected) {
          startSync().catch(console.error)
        }
        
        window.dispatchEvent(new CustomEvent('zynqos:auth-initialized', { detail: statusJson }))
        window.dispatchEvent(new CustomEvent('zynqos:storage-connected', { detail: { provider: 'github-app' } }))
        // Close popup if this flow was initiated in a popup
        if (url.searchParams.get('popup') === '1') {
          try { window.opener?.postMessage({ type: 'zynqos-auth-complete', provider: 'github-app' }, '*') } catch {}
          window.close()
          return
        }
        return
      } else {
        console.error('[Auth] GitHub App installation failed:', json)
      }
    } catch (e) {
      console.error('[Auth] GitHub App installation error:', e)
    }
  }
  
  // Handle GitHub App callback redirect (legacy server-side redirect)
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
    if (url.searchParams.get('popup') === '1') {
      try { window.opener?.postMessage({ type: 'zynqos-auth-complete', provider: 'github-app' }, '*') } catch {}
      window.close()
      return
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
        if (url.searchParams.get('popup') === '1') {
          try { window.opener?.postMessage({ type: 'zynqos-auth-complete', provider: 'google' }, '*') } catch {}
          window.close()
          return
        }
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
        if (url.searchParams.get('popup') === '1') {
          try { window.opener?.postMessage({ type: 'zynqos-auth-complete', provider: 'github' }, '*') } catch {}
          window.close()
          return
        }
      }
    }
  } catch (e) {
    console.error('Auth redirect handling failed', e)
  } finally {
    // Clean URL
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    url.searchParams.delete('popup')
    history.replaceState({}, document.title, url.pathname + url.search + url.hash)
  }
}

// Ensure globals ready even without redirect
attachGlobals()
