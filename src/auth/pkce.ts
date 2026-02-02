// PKCE helper functions
import { uint8ArrayToBase64, toBase64Url } from '../utils/encoding'

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
  // Use centralized base64url encoding
  return toBase64Url(uint8ArrayToBase64(new Uint8Array(digest)));
}
