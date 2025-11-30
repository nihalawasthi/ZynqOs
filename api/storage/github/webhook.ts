import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'

// GitHub webhook receiver for repo changes
// Validates signature and processes push events
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  const signature = req.headers['x-hub-signature-256'] as string
  const event = req.headers['x-github-event'] as string
  
  if (!signature || !event) {
    return res.status(400).json({ error: 'Missing GitHub headers' })
  }
  
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) {
    return res.status(500).json({ error: 'Webhook secret not configured' })
  }
  
  // Verify signature
  const payload = JSON.stringify(req.body)
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(payload)
  const digest = 'sha256=' + hmac.digest('hex')
  
  if (signature !== digest) {
    return res.status(401).json({ error: 'Invalid signature' })
  }
  
  // Process push event
  if (event === 'push') {
    const { repository, commits } = req.body
    
    // Log the push event
    console.log('GitHub push received', {
      repo: repository?.full_name,
      commits: commits?.length,
      ref: req.body.ref
    })
    
    // In production: trigger sync, notify connected clients via WebSocket/SSE
    // For now: acknowledge receipt
    return res.status(200).json({ 
      success: true, 
      event,
      processed: commits?.length || 0
    })
  }
  
  // Acknowledge other events
  return res.status(200).json({ success: true, event })
}
