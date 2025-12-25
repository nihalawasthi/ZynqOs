export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) || ''
export const GITHUB_CLIENT_ID = (import.meta.env.VITE_GITHUB_CLIENT_ID as string) || ''
// Sanitize redirect URI to origin (strip paths/fragments)
const rawRedirect = (import.meta.env.VITE_AUTH_REDIRECT_URI as string) || window.location.href
let sanitizedOrigin: string
try {
	const u = new URL(rawRedirect)
	sanitizedOrigin = `${u.protocol}//${u.host}`
} catch {
	sanitizedOrigin = window.location.origin
}
export const AUTH_REDIRECT_URI = sanitizedOrigin

// Runtime warnings for misconfig (development only to avoid noise in production)
if (import.meta.env?.DEV) {
	if (!GITHUB_CLIENT_ID) {
		console.warn('[ZynqOS] VITE_GITHUB_CLIENT_ID is missing. GitHub OAuth will fail. Set VITE_GITHUB_CLIENT_ID in your .env.local')
	}
	if (!GOOGLE_CLIENT_ID) {
		console.warn('[ZynqOS] VITE_GOOGLE_CLIENT_ID is missing. Google OAuth will fail. Set VITE_GOOGLE_CLIENT_ID in your .env.local')
	}
	if (!AUTH_REDIRECT_URI) {
		console.warn('[ZynqOS] VITE_AUTH_REDIRECT_URI is missing. Using window.location.origin.')
	}
}
