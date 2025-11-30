export type StorageStatus = {
  connected: boolean
  provider?: 'google' | 'github'
  expiresAt?: number
  expired?: boolean
}

export async function getStorageStatus(): Promise<StorageStatus> {
  try {
    const res = await fetch('/api?route=auth&action=status', { credentials: 'include' })
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      return await res.json()
    }
    // Dev fallback: Vite may serve raw TS files under /api; treat as disconnected and log
    const text = await res.text()
    console.warn('[ZynqOS] /api/auth/status returned non-JSON (dev?):', text.slice(0, 80))
    return { connected: false }
  } catch (e) {
    console.error('Failed to fetch storage status', e)
    return { connected: false }
  }
}

export async function disconnectStorage(): Promise<boolean> {
  try {
    const res = await fetch('/api?route=auth&action=disconnect', {
      method: 'POST',
      credentials: 'include'
    })
    const json = await res.json()
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
