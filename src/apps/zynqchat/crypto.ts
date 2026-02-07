const KEY_STORAGE = 'zynqchat_crypto_key_v1'

type EncryptedPayloadV1 = {
  v: 1
  iv: string
  data: string
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const slice = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return slice as ArrayBuffer
}

async function getOrCreateKey(): Promise<CryptoKey | null> {
  if (!crypto?.subtle) return null

  const cached = localStorage.getItem(KEY_STORAGE)
  if (cached) {
    const raw = base64ToBytes(cached)
    const rawBuffer = toArrayBuffer(raw)
    return crypto.subtle.importKey('raw', rawBuffer, 'AES-GCM', false, ['encrypt', 'decrypt'])
  }

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  localStorage.setItem(KEY_STORAGE, bytesToBase64(rawKey))
  return key
}

export async function encryptJson<T>(value: T): Promise<string> {
  const key = await getOrCreateKey()
  if (!key) {
    return JSON.stringify({ v: 0, data: value })
  }

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  const payload: EncryptedPayloadV1 = {
    v: 1,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher))
  }

  return JSON.stringify(payload)
}

export async function decryptJson<T>(payloadText: string): Promise<T | null> {
  if (!payloadText) return null

  try {
    const parsed = JSON.parse(payloadText)
    if (parsed?.v === 1 && parsed.iv && parsed.data) {
      const key = await getOrCreateKey()
      if (!key) return null

      const iv = base64ToBytes(parsed.iv)
      const data = base64ToBytes(parsed.data)
      const dataBuffer = toArrayBuffer(data)
      const ivBytes = new Uint8Array(toArrayBuffer(iv))
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, dataBuffer)
      return JSON.parse(new TextDecoder().decode(plain)) as T
    }

    if (parsed?.v === 0 && parsed.data) {
      return parsed.data as T
    }

    return parsed as T
  } catch {
    return null
  }
}
