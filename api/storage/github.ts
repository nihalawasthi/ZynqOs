import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSessionFromCookie } from '../lib/session'
import crypto from 'crypto'

async function upload(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const session = getSessionFromCookie(req)
  if (!session || session.provider !== 'github') return res.status(401).json({ error: 'No GitHub session' })
  const { owner, repo, path, content, message, sha } = req.body || {}
  if (!owner || !repo || !path || !content) return res.status(400).json({ error: 'Missing fields' })
  const body: any = { message: message || `Update ${path}`, content }
  if (sha) body.sha = sha
  const upRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
  const json = await upRes.json()
  if (!upRes.ok) return res.status(upRes.status).json({ error: json.message || 'Upload failed' })
  return res.status(200).json({ success: true, sha: json.content?.sha, path: json.content?.path })
}

async function download(req: VercelRequest, res: VercelResponse) {
  const session = getSessionFromCookie(req)
  if (!session || session.provider !== 'github') return res.status(401).json({ error: 'No GitHub session' })
  const { owner, repo, path } = req.query
  if (!owner || !repo || !path) return res.status(400).json({ error: 'Missing owner/repo/path' })
  const dlRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/vnd.github+json' } })
  const json = await dlRes.json()
  if (!dlRes.ok) return res.status(dlRes.status).json({ error: json.message || 'Download failed' })
  return res.status(200).json({ success: true, content: json.content, sha: json.sha })
}

async function webhook(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) return res.status(500).json({ error: 'Webhook secret not configured' })
  const signature = req.headers['x-hub-signature-256'] as string
  const event = req.headers['x-github-event'] as string
  if (!signature || !event) return res.status(400).json({ error: 'Missing GitHub headers' })
  const payload = JSON.stringify(req.body)
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  const digest = 'sha256=' + hmac
  if (signature !== digest) return res.status(401).json({ error: 'Invalid signature' })
  if (event === 'push') {
    const { repository, commits } = req.body as any
    console.log('GitHub push received', { repo: repository?.full_name, commits: commits?.length, ref: (req.body as any).ref })
    return res.status(200).json({ success: true, event, processed: commits?.length || 0 })
  }
  return res.status(200).json({ success: true, event })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = req.query.action as string | undefined
  switch (action) {
    case 'upload': return upload(req, res)
    case 'download': return download(req, res)
    case 'webhook': return webhook(req, res)
    default: return res.status(400).json({ error: 'Invalid action' })
  }
}
