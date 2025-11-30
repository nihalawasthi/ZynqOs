import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSessionFromCookie } from '../lib/session.ts'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const session = getSessionFromCookie(req)
  if (!session) return res.status(200).json({ connected: false })

  try {
    if (session.provider === 'google') {
      // Fetch userinfo via OpenID Connect
      const ures = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${session.accessToken}` }
      })
      const ujson = await ures.json()
      return res.status(200).json({ connected: true, provider: 'google', profile: {
        name: ujson.name,
        email: ujson.email,
        picture: ujson.picture,
        sub: ujson.sub
      } })
    } else if (session.provider === 'github') {
      const ures = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${session.accessToken}`, 'Accept': 'application/vnd.github+json' }
      })
      const ujson = await ures.json()
      let email = ujson.email
      if (!email) {
        const eres = await fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${session.accessToken}`, 'Accept': 'application/vnd.github+json' }
        })
        const ejson = await eres.json()
        const primary = Array.isArray(ejson) ? ejson.find((e:any) => e.primary) : null
        email = primary?.email || undefined
      }
      return res.status(200).json({ connected: true, provider: 'github', profile: {
        name: ujson.name || ujson.login,
        email,
        avatar_url: ujson.avatar_url,
        id: ujson.id
      } })
    }
    return res.status(400).json({ error: 'Unknown provider' })
  } catch (e: any) {
    console.error('Profile fetch error', e)
    return res.status(500).json({ error: e.message || 'Profile fetch failed' })
  }
}
