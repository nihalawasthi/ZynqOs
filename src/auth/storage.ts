export type StorageStatus = {
  connected: boolean
  authenticated?: boolean
  provider?: 'google' | 'github' | 'github-app'
  expiresAt?: number
  expired?: boolean
  profile?: any
}

let statusCache: { ts: number; value: StorageStatus } | null = null
let statusInFlight: Promise<StorageStatus> | null = null
const STATUS_CACHE_KEY = 'zynqos_auth_status_cache'
const STATUS_TTL_MS = 5 * 60 * 1000 // 5 minutes - persist in localStorage

function loadCacheFromStorage(): StorageStatus | null {
  try {
    const cached = localStorage.getItem(STATUS_CACHE_KEY)
    if (!cached) return null
    const data = JSON.parse(cached)
    const now = Date.now()
    if (now - data.ts > STATUS_TTL_MS) {
      localStorage.removeItem(STATUS_CACHE_KEY)
      return null
    }
    return data.value
  } catch {
    return null
  }
}

function saveCacheToStorage(value: StorageStatus) {
  try {
    localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify({ ts: Date.now(), value }))
  } catch (e) {
    console.warn('Failed to save auth status cache to localStorage', e)
  }
}

export async function getStorageStatus(forceRefresh = false): Promise<StorageStatus> {
  const now = Date.now()
  
  // Skip cache if force refresh requested
  if (!forceRefresh) {
    // Check memory cache first
    if (statusCache && now - statusCache.ts < 10_000) return statusCache.value
    
    // Check localStorage cache
    const stored = loadCacheFromStorage()
    if (stored) {
      statusCache = { ts: Date.now(), value: stored }
      return stored
    }
  }
  
  // Return in-flight request if already loading
  if (statusInFlight) return statusInFlight

  statusInFlight = (async () => {
    try {
      const res = await fetch('/api?route=auth&action=status', { credentials: 'include' })
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const json = await res.json()
        statusCache = { ts: Date.now(), value: json }
        saveCacheToStorage(json)
        return json
      }
      const text = await res.text()
      console.warn('[ZynqOS] /api/auth/status returned non-JSON (dev?):', text.slice(0, 80))
      const value = { connected: false }
      statusCache = { ts: Date.now(), value }
      return value
    } catch (e) {
      console.error('Failed to fetch storage status', e)
      const value = { connected: false }
      statusCache = { ts: Date.now(), value }
      return value
    } finally {
      statusInFlight = null
    }
  })()

  return statusInFlight
}

export function clearStatusCache() {
  statusCache = null
  statusInFlight = null
  try {
    localStorage.removeItem(STATUS_CACHE_KEY)
  } catch {}
}

export async function disconnectStorage(): Promise<boolean> {
  try {
    const res = await fetch('/api?route=auth&action=disconnect', {
      method: 'POST',
      credentials: 'include'
    })
    const json = await res.json()
    if (json.success) {
      clearStatusCache()
    }
    return json.success === true
  } catch (e) {
    console.error('Failed to disconnect storage', e)
    return false
  }
}

export async function refreshToken(): Promise<boolean> {
  try {
    const res = await fetch('/api?route=auth&action=refresh', {
      method: 'POST',
      credentials: 'include'
    })
    const json = await res.json()
    return json.success === true
  } catch (e) {
    console.error('Failed to refresh token', e)
    return false
  }
}

export async function connectGitHubRepo(repoUrl: string): Promise<{ success: boolean; provider?: string; repo?: string } | null> {
  try {
    const res = await fetch('/api?route=auth&action=github_app_exchange_repo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ repoUrl })
    })
    const json = await res.json()
    if (!res.ok) return null
    return json
  } catch (e) {
    console.error('Failed to connect GitHub repo', e)
    return null
  }
}
