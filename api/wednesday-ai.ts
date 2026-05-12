/**
 * [AI INTEGRATION] — NEW FILE
 * Wednesday AI – Vercel serverless endpoint
 * Proxies chat requests to Google Gemini (generativelanguage.googleapis.com)
 *
 * Environment variable: GEMINI_API_KEY
 *
 * POST /api/wednesday-ai
 * Body: { messages: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>, stream?: boolean }
 * Returns: { reply: string } or an SSE stream
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

// ── Types ──────────────────────────────────────────────────────────────────────

interface GeminiPart {
  text: string
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

interface GeminiCandidate {
  content: {
    parts: GeminiPart[]
    role: string
  }
  finishReason: string
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  error?: { message: string; code: number }
}

interface RequestBody {
  messages: GeminiContent[]
  stream?: boolean
}

// ── Constants ──────────────────────────────────────────────────────────────────

const GEMINI_MODEL = 'gemini-2.0-flash'
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

const SYSTEM_INSTRUCTION = `You are Wednesday, a smart AI assistant built into ZynqOS — a web-based operating system.
You help users with coding, terminal commands, file management, system tasks, and general knowledge.
Keep responses concise and useful. Use markdown formatting when helpful.
If the user asks for terminal commands, prefix them with \`$\` so they can be copy-pasted.
You are friendly, helpful, and technically skilled.`

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CORS pre-flight
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey: string = process.env.GEMINI_API_KEY ?? ''
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server' })
    return
  }

  // Parse body
  const body: RequestBody | null = parseBody(req)
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: 'Missing or invalid "messages" array in request body' })
    return
  }

  const shouldStream: boolean = body.stream === true

  try {
    if (shouldStream) {
      await handleStreaming(apiKey, body.messages, res)
    } else {
      await handleNonStreaming(apiKey, body.messages, res)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Wednesday AI] Error:', message)
    if (!res.headersSent) {
      res.status(502).json({ error: `AI service error: ${message}` })
    }
  }
}

// ── Non-streaming ──────────────────────────────────────────────────────────────

async function handleNonStreaming(
  apiKey: string,
  messages: GeminiContent[],
  res: VercelResponse,
): Promise<void> {
  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  const geminiRes: Response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: messages,
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 2048,
      },
    }),
  })

  const data: GeminiResponse = (await geminiRes.json()) as GeminiResponse

  if (!geminiRes.ok || data.error) {
    const errMsg: string = data.error?.message ?? `Gemini returned ${geminiRes.status}`
    res.status(geminiRes.status).json({ error: errMsg })
    return
  }

  const reply: string =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? ''

  res.status(200).json({ reply })
}

// ── Streaming ──────────────────────────────────────────────────────────────────

async function handleStreaming(
  apiKey: string,
  messages: GeminiContent[],
  res: VercelResponse,
): Promise<void> {
  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`

  const geminiRes: Response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: messages,
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 2048,
      },
    }),
  })

  if (!geminiRes.ok) {
    const errText: string = await geminiRes.text()
    res.status(geminiRes.status).json({ error: errText })
    return
  }

  // Forward SSE stream
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const reader = geminiRes.body?.getReader()
  if (!reader) {
    res.status(502).json({ error: 'No readable stream from Gemini' })
    return
  }

  const decoder = new TextDecoder()

  try {
    let done = false
    while (!done) {
      const result = await reader.read()
      done = result.done
      if (result.value) {
        const chunk: string = decoder.decode(result.value, { stream: true })
        res.write(chunk)
      }
    }
  } finally {
    reader.releaseLock()
    res.end()
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseBody(req: VercelRequest): RequestBody | null {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as RequestBody
    } catch {
      return null
    }
  }
  return req.body as RequestBody | null
}
