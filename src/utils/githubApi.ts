/**
 * Centralized GitHub API operations for ZynqOS
 * Eliminates duplicate fetch calls across sync services
 */

import { base64ToUint8Array, uint8ArrayToBase64, stringToBase64Legacy } from './encoding'

export type GitHubFileResponse = {
  content?: string
  sha?: string
  size?: number
}

export type GitHubUploadOptions = {
  owner: string
  repo: string
  path: string
  content: string | Uint8Array
  message: string
  sha?: string
}

export type GitHubDeleteOptions = {
  owner: string
  repo: string
  path: string
  sha: string
  message: string
}

/**
 * Fetch file content and SHA from GitHub
 * Returns null if file doesn't exist (404)
 */
export async function fetchGitHubFile(
  owner: string,
  repo: string,
  path: string
): Promise<GitHubFileResponse | null> {
  try {
    const res = await fetch(
      `/api?route=storage&provider=github&action=download&owner=${owner}&repo=${repo}&path=${encodeURIComponent(path)}`,
      { credentials: 'include' }
    )

    if (res.status === 404) {
      return null
    }

    if (res.status === 401) {
      throw new Error('GitHub session expired. Please re-authenticate.')
    }

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status}`)
    }

    return await res.json()
  } catch (error) {
    console.error('[GitHub] Fetch file error:', error)
    throw error
  }
}

/**
 * Download and decode file content from GitHub
 * Returns Uint8Array for binary content, string for text
 */
export async function downloadGitHubFile(
  owner: string,
  repo: string,
  path: string
): Promise<{ content: Uint8Array | string; sha: string } | null> {
  const response = await fetchGitHubFile(owner, repo, path)
  
  if (!response || !response.content) {
    return null
  }

  // Try to detect if it's binary or text based on path
  const isBinary = /\.(pdf|png|jpg|jpeg|gif|webp|zip|tar|gz|bin|wasm|exe)$/i.test(path)
  
  const content = isBinary
    ? base64ToUint8Array(response.content)
    : atob(response.content)

  return {
    content,
    sha: response.sha || ''
  }
}

/**
 * Upload file to GitHub with automatic content encoding
 */
export async function uploadGitHubFile(options: GitHubUploadOptions): Promise<void> {
  const { owner, repo, path, content, message, sha } = options

  // Encode content to base64
  const base64Content = typeof content === 'string'
    ? stringToBase64Legacy(content)
    : uint8ArrayToBase64(content)

  const res = await fetch('/api?route=storage&provider=github&action=upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      owner,
      repo,
      path,
      content: base64Content,
      message,
      ...(sha ? { sha } : {})
    })
  })

  if (res.status === 401) {
    throw new Error('GitHub session expired. Please re-authenticate.')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }))
    throw new Error(err.error || `Upload failed with status ${res.status}`)
  }
}

/**
 * Delete file from GitHub
 */
export async function deleteGitHubFile(options: GitHubDeleteOptions): Promise<void> {
  const { owner, repo, path, sha, message } = options

  const res = await fetch('/api?route=storage&provider=github&action=delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      owner,
      repo,
      path,
      sha,
      message
    })
  })

  if (res.status === 401) {
    throw new Error('GitHub session expired. Please re-authenticate.')
  }

  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({ error: 'Delete failed' }))
    throw new Error(err.error || `Delete failed with status ${res.status}`)
  }
}

/**
 * List files in GitHub repository directory
 */
export async function listGitHubFiles(
  owner: string,
  repo: string,
  path?: string
): Promise<Array<{ path: string; type: string; sha?: string }>> {
  const url = path
    ? `/api?route=storage&provider=github&action=list&owner=${owner}&repo=${repo}&path=${encodeURIComponent(path)}`
    : `/api?route=storage&provider=github&action=list&owner=${owner}&repo=${repo}`

  const res = await fetch(url, { credentials: 'include' })

  if (res.status === 401) {
    throw new Error('GitHub session expired. Please re-authenticate.')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'List failed' }))
    throw new Error(err.error || 'Failed to list files')
  }

  const json = await res.json()
  return Array.isArray(json.tree) ? json.tree : []
}

/**
 * Fetch file SHA only (lightweight operation for checking if file exists)
 */
export async function fetchGitHubFileSha(
  owner: string,
  repo: string,
  path: string
): Promise<string | null> {
  const response = await fetchGitHubFile(owner, repo, path)
  return response?.sha || null
}

/**
 * Check if GitHub session is valid
 */
export async function checkGitHubSession(): Promise<boolean> {
  try {
    const res = await fetch('/api?route=auth&action=status', { credentials: 'include' })
    if (!res.ok) return false
    
    const json = await res.json()
    return json.connected && (json.provider === 'github' || json.provider === 'github-app')
  } catch {
    return false
  }
}
