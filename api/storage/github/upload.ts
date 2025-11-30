import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSessionFromCookie } from '../../lib/session'

// GitHub file upload (create or update file via Contents API)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  const session = getSessionFromCookie(req)
  if (!session || session.provider !== 'github') {
    return res.status(401).json({ error: 'No GitHub session found' })
  }
  
  const { owner, repo, path, content, message, sha } = req.body || {}
  if (!owner || !repo || !path || !content) {
    return res.status(400).json({ error: 'Missing required fields' })
  }
  
  try {
    const body: any = {
      message: message || `Update ${path}`,
      content // should be base64
    }
    if (sha) body.sha = sha // for updates
    
    const uploadRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    )
    
    if (!uploadRes.ok) {
      const error = await uploadRes.json()
      return res.status(uploadRes.status).json({ error: error.message || 'Upload failed' })
    }
    
    const uploadJson = await uploadRes.json()
    
    return res.status(200).json({
      success: true,
      sha: uploadJson.content?.sha,
      path: uploadJson.content?.path,
      commitSha: uploadJson.commit?.sha
    })
  } catch (e: any) {
    console.error('GitHub upload error', e)
    return res.status(500).json({ error: e.message || 'Upload failed' })
  }
}
