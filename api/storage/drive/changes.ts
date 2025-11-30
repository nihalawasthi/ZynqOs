import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSessionFromCookie } from '../../lib/session'

// Google Drive changes polling endpoint
// Uses Drive API v3 changes.list with startPageToken for incremental sync
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  
  const session = getSessionFromCookie(req)
  if (!session || session.provider !== 'google') {
    return res.status(401).json({ error: 'No Google session found' })
  }
  
  const { pageToken } = req.query
  
  try {
    // If no pageToken provided, get the current startPageToken first
    if (!pageToken) {
      const tokenRes = await fetch('https://www.googleapis.com/drive/v3/changes/startPageToken', {
        headers: { Authorization: `Bearer ${session.accessToken}` }
      })
      const tokenJson = await tokenRes.json()
      return res.status(200).json({ startPageToken: tokenJson.startPageToken, changes: [] })
    }
    
    // Fetch changes since the given pageToken
    const changesRes = await fetch(
      `https://www.googleapis.com/drive/v3/changes?pageToken=${pageToken}&spaces=drive&fields=changes(file(id,name,mimeType,modifiedTime,size,parents)),newStartPageToken,nextPageToken`,
      { headers: { Authorization: `Bearer ${session.accessToken}` } }
    )
    
    if (!changesRes.ok) {
      const error = await changesRes.json()
      return res.status(changesRes.status).json({ error: error.error?.message || 'Failed to fetch changes' })
    }
    
    const changesJson = await changesRes.json()
    
    return res.status(200).json({
      changes: changesJson.changes || [],
      newStartPageToken: changesJson.newStartPageToken,
      nextPageToken: changesJson.nextPageToken
    })
  } catch (e: any) {
    console.error('Drive changes polling error', e)
    return res.status(500).json({ error: e.message || 'Changes polling failed' })
  }
}
