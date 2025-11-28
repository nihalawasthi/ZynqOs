import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(200).end()
  }

  const { url } = req.query

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' })
  }

  try {
    // Validate URL
    const targetUrl = new URL(url)
    
    // Basic security: only allow http/https
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return res.status(400).json({ error: 'Invalid protocol' })
    }

    // Fetch the resource
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
    })

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Upstream server returned ${response.status}` 
      })
    }

    // Get content type
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    
    // Get the data as array buffer
    const data = await response.arrayBuffer()

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', data.byteLength.toString())
    
    // Send the data
    return res.status(200).send(Buffer.from(data))
  } catch (error: any) {
    console.error('Proxy error:', error)
    return res.status(500).json({ 
      error: error.message || 'Failed to fetch resource' 
    })
  }
}
