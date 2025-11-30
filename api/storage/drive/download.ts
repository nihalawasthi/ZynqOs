import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSessionFromCookie } from '../../lib/session'

// Download file from Google Drive
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  
  const session = getSessionFromCookie(req)
  if (!session || session.provider !== 'google') {
    return res.status(401).json({ error: 'No Google session found' })
  }
  
  const { fileId } = req.query
  if (!fileId || typeof fileId !== 'string') {
    return res.status(400).json({ error: 'Missing fileId' })
  }
  
  try {
    const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    })
    
    if (!downloadRes.ok) {
      const error = await downloadRes.json()
      return res.status(downloadRes.status).json({ error: error.error?.message || 'Download failed' })
    }
    
    const buffer = await downloadRes.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    
    return res.status(200).json({
      success: true,
      content: base64
    })
  } catch (e: any) {
    console.error('Drive download error', e)
    return res.status(500).json({ error: e.message || 'Download failed' })
  }
}
