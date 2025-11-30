import { openDB } from 'idb'

const DB_NAME = 'ZynqOS-vfs'
// Keep DB version in sync with map.ts (currently 2) to avoid VersionError
// Previously this was 1 while map.ts used 2, causing: VersionError: requested version (1) < existing version (2)
const DB_VERSION = 2
const STORE = 'files'

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
  })
}

export async function writeFile(path: string, data: Uint8Array | string) {
  const db = await getDB()
  const value = data instanceof Uint8Array ? Array.from(data) : data
  await db.put(STORE, value, path)
}

export async function readFile(path: string): Promise<Uint8Array | string | undefined> {
  const db = await getDB()
  const v = await db.get(STORE, path)
  if (v === undefined) return undefined
  if (Array.isArray(v)) return new Uint8Array(v)
  return v
}

export async function readdir(prefix = ''): Promise<string[]> {
  const db = await getDB()
  const keys: string[] = []
  const tx = db.transaction(STORE, 'readonly')
  const store = tx.objectStore(STORE)
  let cursor = await store.openCursor()
  
  // Normalize prefix - handle both with and without leading slash
  const normalizedPrefix = prefix.startsWith('/') ? prefix : (prefix ? '/' + prefix : '')
  const prefixWithoutSlash = prefix.startsWith('/') ? prefix.slice(1) : prefix
  
  while (cursor) {
    const key = cursor.key.toString()
    // Match keys that start with either format of the prefix
    if (prefix === '' || 
        key.startsWith(normalizedPrefix) || 
        key.startsWith(prefixWithoutSlash) ||
        (normalizedPrefix && key.startsWith(normalizedPrefix + '/')) ||
        (prefixWithoutSlash && key.startsWith(prefixWithoutSlash + '/'))) {
      keys.push(key)
    }
    cursor = await cursor.continue()
  }
  await tx.done
  return keys
}

export async function removeFile(path: string) {
  const db = await getDB()
  await db.delete(STORE, path)
}
