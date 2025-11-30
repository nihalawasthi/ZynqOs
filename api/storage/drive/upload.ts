import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSessionFromCookie } from '../../lib/session'

// Upload file to Google Drive
// Uses multipart upload for simplicity; supports resumable uploads via client-initiated session
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  const session = getSessionFromCookie(req)
  if (!session || session.provider !== 'google') {
    return res.status(401).json({ error: 'No Google session found' })
  }
  
  const { fileName, content, mimeType, folderId } = req.body || {}
  if (!fileName || !content) {
    return res.status(400).json({ error: 'Missing fileName or content' })
  }
  
  try {
    const metadata = { name: fileName, parents: folderId ? [folderId] : [] }
    const boundary = 'zynqos_upload_' + Date.now()
    const delimiter = `\r\n--${boundary}\r\n`
    const closeDelim = `\r\n--${boundary}--`
    
    // Convert base64 content to buffer if needed
    const contentBuffer = Buffer.from(content, 'base64')
    
    const multipartBody = Buffer.concat([
      Buffer.from(delimiter),
      Buffer.from('Content-Type: application/json; charset=UTF-8\r\n\r\n'),
      Buffer.from(JSON.stringify(metadata)),
      Buffer.from(delimiter),
      Buffer.from(`Content-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`),
      contentBuffer,
      Buffer.from(closeDelim)
    ])
    
    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': multipartBody.length.toString()
      },
      body: multipartBody
    })
    
    if (!uploadRes.ok) {
      const error = await uploadRes.json()
      return res.status(uploadRes.status).json({ error: error.error?.message || 'Upload failed' })
    }
    
    const fileJson = await uploadRes.json()
    
    return res.status(200).json({
      success: true,
      fileId: fileJson.id,
      fileName: fileJson.name,
      mimeType: fileJson.mimeType,
      size: fileJson.size
    })
  } catch (e: any) {
    console.error('Drive upload error', e)
    return res.status(500).json({ error: e.message || 'Upload failed' })
  }
}
