/**
 * User identification utilities
 * Handles username generation from GitHub login or temporary sequential IDs
 */

const USER_COUNTER_KEY = 'zynqos_user_counter'
const USER_ID_KEY = 'zynqos_temp_user_id'

/**
 * Get or assign a temporary sequential user ID (User1, User2, etc.)
 * Uses localStorage to persist the ID across sessions
 */
function getOrAssignTempUserId(): string {
  // Check if user already has a temporary ID
  const existing = localStorage.getItem(USER_ID_KEY)
  if (existing) {
    return existing
  }

  // Get global counter from localStorage
  const counterStr = localStorage.getItem(USER_COUNTER_KEY)
  const counter = counterStr ? parseInt(counterStr, 10) : 0
  const nextCounter = counter + 1

  // Assign new ID
  const newId = `User${nextCounter}`
  
  // Store the new ID and update counter
  localStorage.setItem(USER_ID_KEY, newId)
  localStorage.setItem(USER_COUNTER_KEY, nextCounter.toString())

  return newId
}

/**
 * Get username from profile (GitHub login preferred) or temporary ID
 * Priority: GitHub username > display name > email > temporary User ID
 */
export function getUsername(profile?: {
  login?: string
  name?: string
  email?: string
  [key: string]: any
}): string {
  if (!profile) {
    return getOrAssignTempUserId()
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

  // No profile info available, use temporary ID
  return getOrAssignTempUserId()
}

/**
 * Clear the temporary user ID (e.g., when user logs in)
 */
export function clearTempUserId(): void {
  localStorage.removeItem(USER_ID_KEY)
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
