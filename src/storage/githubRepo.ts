import type { StorageProvider, RemoteRoot, RemoteFileMeta } from './provider'

export class GitHubRepoProvider implements StorageProvider {
  private token: string
  private owner: string
  private repo: string | null = null

  constructor(token: string, owner: string) {
    this.token = token
    this.owner = owner
  }

  async initRoot(): Promise<RemoteRoot> {
    // Create repo if not exists
    const name = 'zynqos'
    const res = await fetch(`https://api.github.com/repos/${this.owner}/${name}`, {
      headers: { Authorization: `Bearer ${this.token}`, 'Accept': 'application/vnd.github+json' }
    })
    if (res.status === 404) {
      const createRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Accept': 'application/vnd.github+json' },
        body: JSON.stringify({ name, private: true, description: 'ZynqOS storage' })
      })
      const cjson = await createRes.json()
      this.repo = cjson.name
    } else {
      const j = await res.json()
      this.repo = j.name
    }
    return { provider: 'github', id: `${this.owner}/${this.repo}` }
  }

  async listChildren(parentPath: string): Promise<RemoteFileMeta[]> {
    if (!this.repo) throw new Error('Root not initialized')
    const res = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}/contents/${parentPath || ''}`, {
      headers: { Authorization: `Bearer ${this.token}`, 'Accept': 'application/vnd.github+json' }
    })
    const json = await res.json()
    if (!Array.isArray(json)) return []
    return json.map((f: any) => ({
      provider: 'github',
      providerId: f.sha,
      path: f.path,
      mimeType: f.type,
      size: f.size,
      modifiedAt: f.git_url,
      remoteRev: f.sha
    }))
  }

  async upload(path: string, data: Uint8Array | string): Promise<RemoteFileMeta> {
    if (!this.repo) throw new Error('Root not initialized')
    const content = data instanceof Uint8Array ? btoa(String.fromCharCode(...data)) : btoa(unescape(encodeURIComponent(data)))
    const res = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${this.token}`, 'Accept': 'application/vnd.github+json' },
      body: JSON.stringify({ message: `Upload ${path}`, content })
    })
    const json = await res.json()
    return {
      provider: 'github',
      providerId: json.content.sha,
      path,
      mimeType: 'file',
      size: json.content.size,
      modifiedAt: json.commit.sha,
      remoteRev: json.content.sha
    }
  }

  async download(path: string): Promise<Uint8Array | string> {
    if (!this.repo) throw new Error('Root not initialized')
    const res = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`, {
      headers: { Authorization: `Bearer ${this.token}`, 'Accept': 'application/vnd.github+json' }
    })
    const json = await res.json()
    const content = atob(json.content)
    return new TextEncoder().encode(content)
  }

  startChangePolling(onChange: (changes: RemoteFileMeta[]) => void) {
    // Polling stub – production: webhook to backend
    const interval = setInterval(async () => {
      const changes = await this.listChildren('')
      onChange(changes)
    }, 60000)
    ;(window as any).__ZYNQOS_GH_POLL__ = interval
  }

  async disconnect(): Promise<void> {}
}
