import type { StorageProvider, RemoteRoot, RemoteFileMeta } from './provider'

export class GoogleDriveProvider implements StorageProvider {
  private accessToken: string
  private folderId: string | null = null
  constructor(accessToken: string) {
    this.accessToken = accessToken
  }

  async initRoot(): Promise<RemoteRoot> {
    // Search for ZynqOS folder
    const search = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent("name='ZynqOS' and mimeType='application/vnd.google-apps.folder'"), {
      headers: { Authorization: `Bearer ${this.accessToken}` }
    })
    const sjson = await search.json()
    if (sjson.files?.length) {
      this.folderId = sjson.files[0].id
    } else {
      // Create folder
      const res = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ZynqOS', mimeType: 'application/vnd.google-apps.folder' })
      })
      const json = await res.json()
      this.folderId = json.id
    }
    return { provider: 'google-drive', id: this.folderId! }
  }

  async listChildren(parentId: string): Promise<RemoteFileMeta[]> {
    const res = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(`'${parentId}' in parents`), {
      headers: { Authorization: `Bearer ${this.accessToken}` }
    })
    const json = await res.json()
    return (json.files || []).map((f: any) => ({
      provider: 'google-drive',
      providerId: f.id,
      path: f.name,
      mimeType: f.mimeType,
      size: f.size,
      modifiedAt: f.modifiedTime,
      remoteRev: f.version?.toString()
    }))
  }

  async upload(path: string, data: Uint8Array | string, meta?: Partial<RemoteFileMeta>): Promise<RemoteFileMeta> {
    if (!this.folderId) throw new Error('Root not initialized')
    const metadata = { name: path.split('/').pop(), parents: [this.folderId] }
    const boundary = 'foo_bar_baz_' + Date.now()
    const delimiter = `\r\n--${boundary}\r\n`
    const closeDelim = `\r\n--${boundary}--`
    const metaPart = JSON.stringify(metadata)
    const dataBlob = data instanceof Uint8Array
      ? (() => { const copy = new Uint8Array(data.length); copy.set(data); return new Blob([copy.buffer]) })()
      : new Blob([data], { type: meta?.mimeType || 'text/plain' })
    const body = new Blob([
      delimiter,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      metaPart,
      delimiter,
      `Content-Type: ${meta?.mimeType || 'application/octet-stream'}\r\n\r\n`,
      dataBlob,
      closeDelim
    ])
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    })
    const json = await res.json()
    return {
      provider: 'google-drive',
      providerId: json.id,
      path,
      mimeType: meta?.mimeType,
      size: json.size,
      modifiedAt: json.modifiedTime,
      remoteRev: json.version?.toString()
    }
  }

  async download(fileId: string): Promise<Uint8Array | string> {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${this.accessToken}` }
    })
    const buf = await res.arrayBuffer()
    return new Uint8Array(buf)
  }

  startChangePolling(onChange: (changes: RemoteFileMeta[]) => void) {
    // Simple polling example (production: use startPageToken + changes.list)
    const interval = setInterval(async () => {
      if (!this.folderId) return
      const changes = await this.listChildren(this.folderId)
      onChange(changes)
    }, 30000)
    ;(window as any).__ZYNQOS_DRIVE_POLL__ = interval
  }

  async disconnect(): Promise<void> {
    // No-op for now; rely on OAuth revoke in client
  }
}
