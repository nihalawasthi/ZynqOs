// PKCE helper functions
export function generateCodeVerifier(length = 64): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  let verifier = ''
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  for (let i = 0; i < length; i++) {
    verifier += chars[array[i] % chars.length]
  }
  return verifier
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const base64 = btoa(String.fromCharCode(...Array.from(new Uint8Array(digest))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return base64
}
