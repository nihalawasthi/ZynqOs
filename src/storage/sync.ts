// Client-side sync helpers for background polling and upload queue processing
import { getRemoteRoot, getFileMeta, setFileMeta, listUploadQueue, clearUploadQueueItem, enqueueUpload } from '../vfs/map'
import { readFile } from '../vfs/fs'

export type SyncChange = {
  path: string
  action: 'upload' | 'download' | 'delete'
  fileId?: string
  sha?: string
}

let pollingInterval: NodeJS.Timeout | null = null
let drivePageToken: string | null = null

export async function startSync() {
  // Get remote root to determine provider
  const root = await getRemoteRoot()
  if (!root) {
    console.log('No remote storage connected')
    return
  }
  
  if (root.provider === 'google-drive') {
    startDrivePolling()
  } else if (root.provider === 'github') {
    // GitHub uses webhooks; client polling not needed but can check commits
    console.log('GitHub sync relies on webhooks')
  }
  
  // Start upload queue processor
  processUploadQueue()
}

export function stopSync() {
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
}

async function startDrivePolling() {
  // Get initial startPageToken
  const res = await fetch('/api/storage/drive/changes', { credentials: 'include' })
  const json = await res.json()
  drivePageToken = json.startPageToken
  
  // Poll every 30 seconds
  pollingInterval = setInterval(async () => {
    if (!drivePageToken) return
    try {
      const changesRes = await fetch(`/api/storage/drive/changes?pageToken=${drivePageToken}`, { credentials: 'include' })
      const changesJson = await changesRes.json()
      
      if (changesJson.changes?.length > 0) {
        console.log('Drive changes detected:', changesJson.changes.length)
        // Process changes: download new/modified files
        for (const change of changesJson.changes) {
          // TODO: Download and merge into VFS
          console.log('Change:', change.file?.name)
        }
      }
      
      // Update token
      if (changesJson.newStartPageToken) {
        drivePageToken = changesJson.newStartPageToken
      }
    } catch (e) {
      console.error('Drive polling error', e)
    }
  }, 30000)
}

async function processUploadQueue() {
  const queue = await listUploadQueue()
  console.log('Upload queue:', queue.length, 'items')
  
  for (const path of queue) {
    try {
      const content = await readFile(path)
      if (content === undefined) continue
      
      const base64 = content instanceof Uint8Array
        ? btoa(String.fromCharCode(...content))
        : btoa(content)
      
      // Determine provider and upload
      const root = await getRemoteRoot()
      if (!root) continue
      
      if (root.provider === 'google-drive') {
        const res = await fetch('/api/storage/drive/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            fileName: path.split('/').pop(),
            content: base64,
            mimeType: 'application/octet-stream',
            folderId: root.id === 'server-session' ? undefined : root.id
          })
        })
        const json = await res.json()
        if (json.success) {
          await setFileMeta(path, {
            provider: 'google-drive',
            providerId: json.fileId,
            path,
            mimeType: json.mimeType,
            size: json.size
          })
          await clearUploadQueueItem(path)
          console.log('Uploaded to Drive:', path)
        }
      }
      // TODO: GitHub upload
    } catch (e) {
      console.error('Upload failed for', path, e)
    }
  }
}
