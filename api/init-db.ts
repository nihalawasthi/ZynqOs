import type { VercelRequest, VercelResponse } from '@vercel/node'
import { initDatabase } from './lib/db.js'

// This endpoint initializes the database schema
// Call it once after deployment: curl https://yourdomain.com/api/init-db

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Optional: Add authentication/secret check in production
  const authHeader = req.headers.authorization
  const initSecret = process.env.INIT_DB_SECRET || 'allow-in-dev'
  
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${initSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    await initDatabase()
    return res.status(200).json({
      success: true,
      message: 'Database initialized successfully'
    })
  } catch (error) {
    console.error('Database initialization error:', error)
    return res.status(500).json({
      error: 'Failed to initialize database',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
