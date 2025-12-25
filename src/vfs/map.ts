import { openDB } from 'idb'
import type { RemoteFileMeta, RemoteRoot } from '../storage/provider'

const DB_NAME = 'ZynqOS-vfs'
const DB_VERSION = 3
const MAP_STORE = 'remoteMap'
const QUEUE_STORE = 'uploadQueue'
const FILE_STORE = 'files'

export async function getDB() {
  const open = () => openDB(DB_NAME, DB_VERSION, {
    upgrade(upgradeDb) {
      if (!upgradeDb.objectStoreNames.contains(FILE_STORE)) upgradeDb.createObjectStore(FILE_STORE)
      if (!upgradeDb.objectStoreNames.contains(MAP_STORE)) upgradeDb.createObjectStore(MAP_STORE)
      if (!upgradeDb.objectStoreNames.contains(QUEUE_STORE)) upgradeDb.createObjectStore(QUEUE_STORE)
    }
  })

  let db = await open()

  // Safety: if stores are missing (legacy DB), recreate database to avoid NotFoundError.
  const hasStores = db.objectStoreNames.contains(MAP_STORE) && db.objectStoreNames.contains(QUEUE_STORE) && db.objectStoreNames.contains(FILE_STORE)
  if (!hasStores) {
    db.close()
    await indexedDB.deleteDatabase(DB_NAME)
    db = await open()
  }

  return db
}

export async function setRemoteRoot(root: RemoteRoot) {
  const db = await getDB()
  await db.put(MAP_STORE, root, 'remoteRoot')
}

export async function getRemoteRoot(): Promise<RemoteRoot | undefined> {
  const db = await getDB()
  return db.get(MAP_STORE, 'remoteRoot')
}

export async function setFileMeta(path: string, meta: RemoteFileMeta) {
  const db = await getDB()
  await db.put(MAP_STORE, meta, `meta:${path}`)
}

export async function getFileMeta(path: string): Promise<RemoteFileMeta | undefined> {
  const db = await getDB()
  return db.get(MAP_STORE, `meta:${path}`)
}

export async function enqueueUpload(path: string) {
  const db = await getDB()
  await db.put(QUEUE_STORE, Date.now(), path)
}

export async function listUploadQueue(): Promise<string[]> {
  const db = await getDB()
  const keys: string[] = []
  const tx = db.transaction(QUEUE_STORE, 'readonly')
  const store = tx.objectStore(QUEUE_STORE)
  let cursor = await store.openCursor()
  while (cursor) {
    keys.push(cursor.key.toString())
    cursor = await cursor.continue()
  }
  await tx.done
  return keys
}

export async function clearUploadQueueItem(path: string) {
  const db = await getDB()
  await db.delete(QUEUE_STORE, path)
}
