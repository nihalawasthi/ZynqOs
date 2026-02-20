/**
 * User identification utilities
 * Handles username generation from GitHub login or device fingerprint hash
 */

import { getDeviceIdentifierSync } from './UserIdentifier'

/**
 * Get device fingerprint hash as temporary username
 * Format: dev_a3f2c8 (7-8 hex chars from device fingerprint)
 */
function getDeviceTempUsername(): string {
  const deviceId = getDeviceIdentifierSync() // e.g., "device_a3f2c8ab"
  
  // Extract the hash part and shorten to 7-8 chars
  if (deviceId.startsWith('device_')) {
    const hash = deviceId.replace('device_', '')
    // Take first 8 chars of hash for username
    return `dev_${hash.substring(0, 8)}`
  }
  
  // Fallback for unexpected format
  return deviceId.substring(0, 12)
}

/**
 * Get username from profile (GitHub login preferred) or device fingerprint
 * Priority: GitHub username > display name > email > device fingerprint hash
 */
export function getUsername(profile?: {
  login?: string
  name?: string
  email?: string
  [key: string]: any
}): string {
  if (!profile) {
    return getDeviceTempUsername()
  }

  // Prefer GitHub username (login field from GitHub API)
  if (profile.login) {
    return profile.login
  }

  // Fallback to display name
  if (profile.name) {
    return profile.name
  }

  // Fallback to email
  if (profile.email) {
    return profile.email
  }

  // No profile info available, use device fingerprint
  return getDeviceTempUsername()
}

/**
 * Get the full profile with login field properly extracted
 * Handles both GitHub App and regular GitHub OAuth responses
 */
export async function getAuthProfile(): Promise<{
  login?: string
  name?: string
  email?: string
  id?: string
  avatar?: string
} | null> {
  try {
    const res = await fetch('/api?route=auth&action=status', { credentials: 'include' })
    const contentType = res.headers.get('content-type') || ''
    
    if (!contentType.includes('application/json')) {
      return null
    }

    const status = await res.json()
    if (!status.connected && !status.authenticated) {
      return null
    }

    const profile = status.profile || {}
    
    // GitHub username is stored in 'name' field by the API
    // but we want to expose it as 'login' for consistency
    return {
      login: profile.name, // GitHub username comes from session.userName which is login
      name: profile.name,
      email: profile.email,
      id: profile.id,
      avatar: profile.avatar_url
    }
  } catch (error) {
    console.warn('[userUtils] Failed to fetch auth profile:', error)
    return null
  }
}
