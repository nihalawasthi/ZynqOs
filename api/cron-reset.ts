import type { VercelRequest, VercelResponse } from '@vercel/node'
import { initDatabase } from './lib/db.js'

// DEPRECATED: Daily reset is now handled by database trigger
// This endpoint is kept for backward compatibility only

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET || 'dev-secret-change-in-production'
  
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    // Ensure database is initialized with trigger
    await initDatabase()
    
    return res.status(200).json({
      success: true,
      message: 'Daily reset is handled by database trigger',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Cron endpoint error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
