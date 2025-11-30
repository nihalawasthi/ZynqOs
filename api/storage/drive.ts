import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSessionFromCookie } from '../lib/session'

async function changes(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session || session.provider !== 'google') return res.status(401).json({ error: 'No Google session' })
  const pageToken = req.query.pageToken as string | undefined
  try {
    if (!pageToken) {
      const tokenRes = await fetch('https://www.googleapis.com/drive/v3/changes/startPageToken', { headers: { Authorization: `Bearer ${session.accessToken}` } })
      const tokenJson = await tokenRes.json()
      return res.status(200).json({ startPageToken: tokenJson.startPageToken, changes: [] })
    }
    const changesRes = await fetch(`https://www.googleapis.com/drive/v3/changes?pageToken=${pageToken}&spaces=drive&fields=changes(file(id,name,mimeType,modifiedTime,size,parents)),newStartPageToken,nextPageToken`, { headers: { Authorization: `Bearer ${session.accessToken}` } })
    const json = await changesRes.json()
    if (!changesRes.ok) return res.status(changesRes.status).json({ error: json.error?.message || 'Changes failed' })
    return res.status(200).json({ changes: json.changes || [], newStartPageToken: json.newStartPageToken, nextPageToken: json.nextPageToken })
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Changes error' })
  }
}

async function upload(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const session = getSessionFromCookie(req)
  if (!session || session.provider !== 'google') return res.status(401).json({ error: 'No Google session' })
  const { fileName, content, mimeType, folderId } = req.body || {}
  if (!fileName || !content) return res.status(400).json({ error: 'Missing fileName or content' })
  try {
    const metadata = { name: fileName, parents: folderId ? [folderId] : [] }
    const boundary = 'zynqos_' + Date.now()
    const delimiter = `\r\n--${boundary}\r\n`
    const closeDelim = `\r\n--${boundary}--`
    const contentBuffer = Buffer.from(content, 'base64')
    const parts = [
      delimiter,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      delimiter,
      `Content-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`,
      contentBuffer,
      closeDelim
    ]
    const body = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p))
    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    })
    const json = await uploadRes.json()
    if (!uploadRes.ok) return res.status(uploadRes.status).json({ error: json.error?.message || 'Upload failed' })
    return res.status(200).json({ success: true, fileId: json.id, fileName: json.name, mimeType: json.mimeType, size: json.size })
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Upload error' })
  }
}

async function download(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session || session.provider !== 'google') return res.status(401).json({ error: 'No Google session' })
  const fileId = req.query.fileId as string | undefined
  if (!fileId) return res.status(400).json({ error: 'Missing fileId' })
  try {
    const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${session.accessToken}` } })
    const buf = await dlRes.arrayBuffer()
    if (!dlRes.ok) return res.status(dlRes.status).json({ error: 'Download failed' })
    const base64 = Buffer.from(buf).toString('base64')
    return res.status(200).json({ success: true, content: base64 })
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Download error' })
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = req.query.action as string | undefined
  switch (action) {
    case 'changes': return changes(req, res)
    case 'upload': return upload(req, res)
    case 'download': return download(req, res)
    default: return res.status(400).json({ error: 'Invalid action' })
  }
}
