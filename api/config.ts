/**
 * Centralized API Configuration and Constants
 * Eliminates scattered environment variable access and magic strings
 */

// ===== Environment Variables =====
export const ENV = {
  // Node environment
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  IS_DEV: process.env.NODE_ENV !== 'production',

  // OAuth Providers
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || '',
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || '',

  // GitHub App
  GITHUB_APP_ID: process.env.GITHUB_APP_ID || '',
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY || '',
  GITHUB_APP_INSTALL_URL: process.env.VITE_GITHUB_APP_INSTALL_URL || process.env.GITHUB_APP_INSTALL_URL || '',
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET || '',

  // Session & Security
  SESSION_SECRET: process.env.SESSION_SECRET || '',
  VITE_AUTH_REDIRECT_URI: process.env.VITE_AUTH_REDIRECT_URI || 'http://localhost:3000',

  // Rate limiting
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== 'false',
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX || 20),
  RATE_LIMIT_WINDOW_MS: 60_000,

  // Database
  LOG_DIR: process.env.LOG_DIR || './logs',
  INIT_DB_SECRET: process.env.INIT_DB_SECRET || 'allow-in-dev',
  CRON_SECRET: process.env.CRON_SECRET || 'dev-secret-change-in-production',
  POSTGRES_URL: process.env.POSTGRES_URL,
  POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING,

  // [AI INTEGRATION] — Added for Wednesday AI Assistant
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
}

// ===== API Constants =====
export const API = {
  SESSION_COOKIE: 'zynqos_session',
  MAX_AGE: 30 * 24 * 60 * 60, // 30 days session cookie
  AUDIT_LIMIT: 300,
  STATE_TTL_MS: 600_000, // 10 minutes for CSRF state tokens
}

// ===== HTTP Status Codes =====
export const HTTP = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMIT: 429,
  SERVER_ERROR: 500,
}

// ===== Error Messages =====
export const ERRORS = {
  NOT_AUTHENTICATED: 'Not authenticated',
  UNAUTHORIZED: 'Unauthorized',
  INVALID_REQUEST: 'Invalid request',
  MISSING_PARAM: (param: string) => `Missing ${param}`,
  INVALID_PARAM: (param: string) => `Invalid ${param}`,
  NOT_FOUND: 'Not found',
  RATE_LIMITED: 'Too many requests',
  UPSTREAM_ERROR: (status: number) => `Upstream ${status}`,
  MISSING_CREDENTIALS: 'Missing credentials',
  INVALID_PROVIDER: 'Invalid provider',
}

// ===== Provider Configs =====
export const PROVIDERS = {
  GOOGLE: 'google',
  GITHUB: 'github',
  GITHUB_APP: 'github-app',
  GOOGLE_DRIVE: 'google-drive',
} as const

// ===== OAuth URLs =====
export const OAUTH_URLS = {
  GOOGLE_TOKEN: 'https://oauth2.googleapis.com/token',
  GOOGLE_USER: 'https://www.googleapis.com/oauth2/v1/userinfo',
  GITHUB_TOKEN: 'https://github.com/login/oauth/access_token',
  GITHUB_USER: 'https://api.github.com/user',
  GITHUB_EMAILS: 'https://api.github.com/user/emails',
  GITHUB_API: 'https://api.github.com',
  GITHUB_DRIVE_CHANGES: 'https://www.googleapis.com/drive/v3/changes',
  GITHUB_DRIVE_FILES: 'https://www.googleapis.com/drive/v3/files',
} as const

// ===== Route Constants =====
export const ROUTES = {
  AUTH: 'auth',
  STORAGE: 'storage',
  PROXY: 'proxy',
  USER_DATA: 'user-data',
} as const

// ===== Action Constants =====
export const ACTIONS = {
  // Auth actions
  STATUS: 'status',
  LOGIN: 'login',
  LOGOUT: 'logout',
  EXCHANGE_GOOGLE: 'exchange_google',
  EXCHANGE_GITHUB: 'exchange_github',
  GITHUB_APP_SETUP: 'github_app_setup_info',
  GITHUB_APP_EXCHANGE_REPO: 'github_app_exchange_repo',
  GITHUB_APP_CALLBACK: 'github_app_callback',
  REFRESH: 'refresh',
  DISCONNECT: 'disconnect',
  AUDIT: 'audit',
  AUDIT_SYNC: 'audit_sync',
  AUDIT_HISTORY: 'audit_history',
  ENV_STATUS: 'env_status',

  // Storage provider actions (drive/github)
  CHANGES: 'changes',
  UPLOAD: 'upload',
  DOWNLOAD: 'download',
  DELETE: 'delete',
  LIST: 'list',
} as const

// ===== Validation Utilities =====
export function isValidProvider(provider: any): provider is typeof PROVIDERS[keyof typeof PROVIDERS] {
  return Object.values(PROVIDERS).includes(provider)
}

export function getProviderFromSession(session: any): string | null {
  if (!session || !session.provider) return null
  return session.provider
}

// ===== CORS Configuration =====
export const ALLOWED_ORIGINS = () => [
  ENV.VITE_AUTH_REDIRECT_URI,
  'http://localhost:3000',
  'http://localhost:5173',
].filter(Boolean)

export function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS().some(allowed => origin.startsWith(allowed))
}
