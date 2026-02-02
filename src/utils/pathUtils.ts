/**
 * Centralized path normalization utilities for ZynqOS
 * Handles VFS paths, GitHub paths, and file system paths consistently
 */

/**
 * Normalize a path to VFS format (starts with /)
 * @example normalizePath('home/file.txt') => '/home/file.txt'
 * @example normalizePath('/home/file.txt') => '/home/file.txt'
 */
export function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

/**
 * Sanitize path for GitHub sync (remove leading slashes, backslashes, parent refs)
 * @example sanitizeGitHubPath('/home/../file.txt') => 'home/file.txt'
 * @example sanitizeGitHubPath('\\home\\file.txt') => 'home/file.txt'
 */
export function sanitizeGitHubPath(path: string): string {
  let safePath = path
    .replace(/^\/+/, '') // Remove leading slashes
    .replace(/\\/g, '/') // Convert backslashes to forward slashes
    .replace(/\.\./g, '') // Remove parent directory references
  
  // Remove double slashes (global flag)
  safePath = safePath.replace(/\/+/g, '/')
  
  return safePath
}

/**
 * Convert VFS path to GitHub repo path
 * Special paths (logs/, settings.json, audit/) stay at root
 * Other files go under files/ directory
 * 
 * @example vfsToGitHubPath('/home/test.txt') => 'files/home/test.txt'
 * @example vfsToGitHubPath('logs/2024-01-01.json') => 'logs/2024-01-01.json'
 * @example vfsToGitHubPath('settings.json') => 'settings.json'
 */
export function vfsToGitHubPath(vfsPath: string): string {
  const safePath = sanitizeGitHubPath(vfsPath)
  
  // Special paths that stay at repo root
  const isSpecialPath = 
    safePath.startsWith('logs/') || 
    safePath.startsWith('audit/') ||
    safePath === 'settings.json'
  
  return isSpecialPath ? safePath : `files/${safePath}`
}

/**
 * Convert GitHub repo path to VFS path
 * Strips 'files/' prefix but keeps logs/, audit/, settings.json as-is
 * 
 * @example githubToVfsPath('files/home/test.txt') => 'home/test.txt'
 * @example githubToVfsPath('logs/2024-01-01.json') => 'logs/2024-01-01.json'
 */
export function githubToVfsPath(githubPath: string): string {
  let vfsPath = githubPath.replace(/^\/+/, '')
  
  // Strip 'files/' prefix but keep logs/, audit/, settings/ as-is
  if (vfsPath.startsWith('files/')) {
    vfsPath = vfsPath.slice('files/'.length)
  }
  
  return vfsPath
}

/**
 * Normalize terminal/shell path for VFS access
 * Handles ~ expansion, relative paths, and absolute paths
 * 
 * @param path - The path to normalize
 * @param currentDir - Current working directory (e.g., '~' or '~/documents')
 * @returns VFS-compatible path
 * 
 * @example normalizeTerminalPath('~', '~') => ''
 * @example normalizeTerminalPath('~/file.txt', '~') => 'file.txt'
 * @example normalizeTerminalPath('documents', '~/home') => 'home/documents'
 * @example normalizeTerminalPath('/home/file.txt', '~') => 'home/file.txt'
 */
export function normalizeTerminalPath(path: string, currentDir: string = '~'): string {
  // Handle home directory (~)
  if (path === '~') {
    return ''
  }
  
  // Expand tilde prefix
  if (path.startsWith('~/')) {
    return path.slice(2)
  }
  
  // Absolute path (starts with /)
  if (path.startsWith('/')) {
    return path.slice(1)
  }
  
  // Relative path - append to current directory
  if (currentDir === '~') {
    return path
  }
  
  const currentNormalized = currentDir.startsWith('~/')
    ? currentDir.slice(2)
    : currentDir.replace(/^~$/, '')
  
  return currentNormalized ? `${currentNormalized}/${path}` : path
}

/**
 * Join path segments, handling leading/trailing slashes
 * @example joinPaths('/home', 'user', 'file.txt') => '/home/user/file.txt'
 * @example joinPaths('home/', '/user/', '/file.txt') => 'home/user/file.txt'
 */
export function joinPaths(...segments: string[]): string {
  return segments
    .map(seg => seg.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

/**
 * Get the directory name from a path
 * @example dirname('/home/user/file.txt') => '/home/user'
 * @example dirname('file.txt') => '/'
 */
export function dirname(path: string): string {
  const normalized = normalizePath(path)
  const parts = normalized.split('/').filter(Boolean)
  
  if (parts.length <= 1) {
    return '/'
  }
  
  return '/' + parts.slice(0, -1).join('/')
}

/**
 * Get the base filename from a path
 * @example basename('/home/user/file.txt') => 'file.txt'
 * @example basename('/home/user/') => 'user'
 */
export function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

/**
 * Get file extension (including the dot)
 * @example extname('file.txt') => '.txt'
 * @example extname('archive.tar.gz') => '.gz'
 * @example extname('README') => ''
 */
export function extname(path: string): string {
  const name = basename(path)
  const dotIndex = name.lastIndexOf('.')
  
  return dotIndex > 0 ? name.slice(dotIndex) : ''
}
