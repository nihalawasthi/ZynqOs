/**
 * Quiet Authentication - Open login in popup, refresh token in background
 * Avoids disrupting user activity on the main page
 */

import { AUTH_REDIRECT_URI, GITHUB_CLIENT_ID, GOOGLE_CLIENT_ID } from './config'
import { startGitHubOAuth } from './github'
import { startGoogleOAuth } from './google'
import { clearStatusCache } from './storage'

type AuthProvider = 'github' | 'google' | 'github-app'

/**
 * Check if session is still valid
 */
export async function checkSessionValidity(): Promise<boolean> {
  try {
    const res = await fetch('/api?route=auth&action=status', { credentials: 'include' })
    if (!res.ok) return false
    
    const status = await res.json()
    return status.authenticated || status.connected
  } catch {
    return false
  }
}

/**
 * Open authentication in a popup window
 * Returns promise that resolves when auth succeeds or fails
 */
export function quietAuth(provider: AuthProvider): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const width = 600
    const height = 700
    const left = window.screen.width / 2 - width / 2
    const top = window.screen.height / 2 - height / 2
    
    // Generate auth URL based on provider
    let authUrl: string
    if (provider === 'github' || provider === 'github-app') {
      authUrl = startGitHubOAuth({ 
        clientId: GITHUB_CLIENT_ID, 
        redirectUri: AUTH_REDIRECT_URI 
      }) + '&state=github'
    } else {
      // Google OAuth URL generation (async, but we can start the URL generation)
      startGoogleOAuth({ 
        clientId: GOOGLE_CLIENT_ID, 
        redirectUri: AUTH_REDIRECT_URI 
      }).then(url => {
        authUrl = url + '&state=google'
        openPopup(authUrl)
      }).catch(err => {
        resolve({ success: false, error: err.message })
      })
      return // Exit early for Google since URL is async
    }
    
    openPopup(authUrl)
    
    function openPopup(url: string) {
      const popup = window.open(
        url,
        'ZynqOS Login',
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,location=no`
      )
      
      if (!popup) {
        resolve({ success: false, error: 'Popup blocked. Please allow popups for this site.' })
        return
      }
      
      // Poll for popup close or successful auth
      const pollInterval = setInterval(async () => {
        try {
          // Check if popup is closed
          if (popup.closed) {
            clearInterval(pollInterval)
            
            // Check if auth succeeded by querying status
            const isValid = await checkSessionValidity()
            if (isValid) {
              clearStatusCache()
              // Notify UI of auth success
              window.dispatchEvent(new CustomEvent('zynqos:auth-refreshed', { detail: { provider } }))
              resolve({ success: true })
            } else {
              resolve({ success: false, error: 'Authentication cancelled or failed' })
            }
          }
        } catch (err) {
          // Ignore errors during polling
        }
      }, 500)
      
      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval)
        if (!popup.closed) {
          popup.close()
        }
        resolve({ success: false, error: 'Authentication timed out' })
      }, 5 * 60 * 1000)
    }
  })
}

/**
 * Automatically check and refresh authentication if needed
 * Call this periodically (e.g., on app focus or every few hours)
 */
export async function autoRefreshAuth(currentProvider?: AuthProvider): Promise<void> {
  const isValid = await checkSessionValidity()
  
  if (!isValid && currentProvider) {
    console.log('[QuietAuth] Session expired, opening quiet re-authentication...')
    const result = await quietAuth(currentProvider)
    
    if (result.success) {
      console.log('[QuietAuth] Re-authentication successful')
    } else {
      console.warn('[QuietAuth] Re-authentication failed:', result.error)
    }
  }
}
