export type RemoteProvider = 'google-drive' | 'github'

export type RemoteRoot = {
  provider: RemoteProvider
  id: string // folderId or repo+path
}

export type RemoteFileMeta = {
  provider: RemoteProvider
  providerId: string
  path: string
  mimeType?: string
  size?: number
  modifiedAt?: string
  checksum?: string
  remoteRev?: string
}

export interface StorageProvider {
  initRoot(): Promise<RemoteRoot>
  listChildren(parentId: string): Promise<RemoteFileMeta[]>
  upload(path: string, data: Uint8Array | string, meta?: Partial<RemoteFileMeta>): Promise<RemoteFileMeta>
  download(providerId: string): Promise<Uint8Array | string>
  startChangePolling?(onChange: (changes: RemoteFileMeta[]) => void): void
  disconnect(): Promise<void>
}
