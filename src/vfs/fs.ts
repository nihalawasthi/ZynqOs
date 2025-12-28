import { openDB } from 'idb'

const DB_NAME = 'ZynqOS-vfs'
// Keep DB version in sync with map.ts (bump to 3 to add missing stores consistently)
const DB_VERSION = 3
const FILE_STORE = 'files'
const MAP_STORE = 'remoteMap'
const QUEUE_STORE = 'uploadQueue'

async function getDB() {
  const open = async () => openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE)
      if (!db.objectStoreNames.contains(MAP_STORE)) db.createObjectStore(MAP_STORE)
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE)
    }
  })

  try {
    let db = await open()

    // If required stores are missing (legacy DB), recreate
    const hasStores = db.objectStoreNames.contains(FILE_STORE)
    if (!hasStores) {
      db.close()
      await indexedDB.deleteDatabase(DB_NAME)
      db = await open()
    }

    return db
  } catch (err: any) {
    // If database is corrupted, delete and recreate
    if (err.name === 'NotFoundError' || err.message?.includes('object store')) {
      console.warn('VFS DB corrupted, attempting to recreate...', err.message)
      const deleteReq = indexedDB.deleteDatabase(DB_NAME)
      await new Promise<void>((resolve, reject) => {
        deleteReq.onsuccess = () => resolve()
        deleteReq.onerror = () => reject(deleteReq.error)
        deleteReq.onblocked = () => {
          console.warn('DB delete blocked - close other tabs or wait')
          setTimeout(() => resolve(), 2000)
        }
      })
      return await open()
    }
    throw err
  }
}

export async function writeFile(path: string, data: Uint8Array | string) {
  const db = await getDB();
  // Always normalize to leading slash
  const normPath = path.startsWith('/') ? path : '/' + path;
  const value = data instanceof Uint8Array ? Array.from(data) : data;
  console.debug('[vfs] writeFile', { path: normPath, type: typeof data, isArray: Array.isArray(data), len: data?.length });
  await db.put(FILE_STORE, value, normPath);
  // Track for sync
  try {
    const { githubSync } = await import('../storage/githubSync');
    const contentStr = typeof value === 'string' ? value : Buffer.from(value).toString('base64');
    await githubSync.trackChange(`files/${path}`, contentStr);
  } catch (e) {
    console.error('Failed to track file change:', e);
  }
}

export async function readFile(path: string): Promise<Uint8Array | string | undefined> {
  const db = await getDB();
  // Always normalize to leading slash
  const normPath = path.startsWith('/') ? path : '/' + path;
  const v = await db.get(FILE_STORE, normPath);
  let debugType = typeof v;
  let debugIsArray = Array.isArray(v);
  let debugLen = v?.length;
  let debugPreview = undefined;
  if (typeof v === 'string') debugPreview = v.slice(0, 100);
  if (Array.isArray(v)) debugPreview = v.slice(0, 10);
  console.debug('[vfs] readFile', { path, type: debugType, isArray: debugIsArray, len: debugLen, preview: debugPreview });
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return new Uint8Array(v);
  return v;
}

export async function readdir(prefix = ''): Promise<string[]> {
  const db = await getDB()
  const keys: string[] = []
  const tx = db.transaction(FILE_STORE, 'readonly')
  const store = tx.objectStore(FILE_STORE)
  let cursor = await store.openCursor()
  // Normalize prefix - always with leading slash
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
  // Always normalize to leading slash
  const normPath = path.startsWith('/') ? path : '/' + path;
  await db.delete(FILE_STORE, normPath)
  
  // Track deletion for sync
  try {
    const { githubSync } = await import('../storage/githubSync');
    await githubSync.trackDeletion(`files/${path.replace(/^\//, '')}`);
  } catch (e) {
    console.error('Failed to track file deletion:', e);
  }
}
