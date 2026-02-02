/**
 * Centralized encoding utilities for ZynqOS
 * Handles base64 encoding/decoding with proper binary support
 */

/**
 * Convert Uint8Array to base64 string
 * Works correctly with binary data (unlike plain btoa on strings)
 */
export function uint8ArrayToBase64(data: Uint8Array): string {
  // For large arrays, process in chunks to avoid stack overflow
  const CHUNK_SIZE = 8192;
  if (data.length <= CHUNK_SIZE) {
    return btoa(String.fromCharCode(...data));
  }
  
  let result = '';
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.subarray(i, Math.min(i + CHUNK_SIZE, data.length));
    result += String.fromCharCode(...chunk);
  }
  return btoa(result);
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert string or Uint8Array to base64
 * Automatically handles both text and binary data
 */
export function toBase64(data: string | Uint8Array): string {
  if (typeof data === 'string') {
    // UTF-8 encode string first
    const encoder = new TextEncoder();
    const bytes = encoder.encode(data);
    return uint8ArrayToBase64(bytes);
  } else {
    return uint8ArrayToBase64(data);
  }
}

/**
 * Convert base64 to string (assumes UTF-8 encoding)
 */
export function base64ToString(base64: string): string {
  const bytes = base64ToUint8Array(base64);
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

/**
 * URL-safe base64 encoding (base64url)
 */
export function toBase64Url(data: string | Uint8Array): string {
  const base64 = toBase64(data);
  return base64
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Decode URL-safe base64 (base64url)
 */
export function fromBase64Url(base64url: string): Uint8Array {
  const base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  // Add padding if needed
  const padding = (4 - (base64.length % 4)) % 4;
  const padded = base64 + '='.repeat(padding);
  return base64ToUint8Array(padded);
}

/**
 * Legacy btoa-style encoding for strings (for backwards compatibility)
 * Use toBase64 instead for new code
 */
export function stringToBase64Legacy(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

/**
 * Legacy atob-style decoding for strings (for backwards compatibility)
 * Use base64ToString instead for new code
 */
export function base64ToStringLegacy(base64: string): string {
  return decodeURIComponent(escape(atob(base64)));
}
