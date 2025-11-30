import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSessionFromCookie } from '../../lib/session'

// GitHub file download via Contents API
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  
  const session = getSessionFromCookie(req)
  if (!session || session.provider !== 'github') {
    return res.status(401).json({ error: 'No GitHub session found' })
  }
  
  const { owner, repo, path } = req.query
  if (!owner || !repo || !path || typeof owner !== 'string' || typeof repo !== 'string' || typeof path !== 'string') {
    return res.status(400).json({ error: 'Missing owner, repo, or path' })
  }
  
  try {
    const downloadRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Accept': 'application/vnd.github+json'
        }
      }
    )
    
    if (!downloadRes.ok) {
      const error = await downloadRes.json()
      return res.status(downloadRes.status).json({ error: error.message || 'Download failed' })
    }
    
    const fileJson = await downloadRes.json()
    
    return res.status(200).json({
      success: true,
      content: fileJson.content, // base64
      sha: fileJson.sha,
      size: fileJson.size,
      path: fileJson.path
    })
  } catch (e: any) {
    console.error('GitHub download error', e)
    return res.status(500).json({ error: e.message || 'Download failed' })
  }
}
