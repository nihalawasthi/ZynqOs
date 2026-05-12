/**
 * [AI INTEGRATION] — NEW FILE
 * Wednesday AI Service – Client-side module
 * Handles communication with Google Gemini API directly from the client.
 * Manages conversation history for the current session.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GeminiPart {
  text: string
}

export interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

export interface AiResponse {
  reply: string
  error?: string
}

export interface StreamCallbacks {
  onChunk: (text: string) => void
  onDone: (fullText: string) => void
  onError: (error: string) => void
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_HISTORY = 20 // Keep last N exchanges to avoid huge payloads
const LOCAL_KEY_STORAGE = 'zynqos_wednesday_gemini_key'

// ── Service Class ──────────────────────────────────────────────────────────────

class WednesdayAiService {
  private history: GeminiContent[] = []
  private localApiKey: string = ''

  constructor() {
    try {
      this.localApiKey = localStorage.getItem(LOCAL_KEY_STORAGE) ?? ''
    } catch {
      // localStorage may not be available
    }
  }

  /** Store a user-provided Gemini API key (persisted in localStorage) */
  setApiKey(key: string): void {
    this.localApiKey = key.trim()
    try {
      if (this.localApiKey) {
        localStorage.setItem(LOCAL_KEY_STORAGE, this.localApiKey)
      } else {
        localStorage.removeItem(LOCAL_KEY_STORAGE)
      }
    } catch {
      // localStorage may not be available
    }
  }

  /** Get the currently stored API key */
  getApiKey(): string {
    return this.localApiKey
  }

  /** Check whether an API key is configured (client-side) */
  hasApiKey(): boolean {
    return this.localApiKey.length > 0
  }

  /** Clear conversation history */
  clearHistory(): void {
    this.history = []
  }

  /** Get current conversation history length */
  getHistoryLength(): number {
    return this.history.length
  }

  /**
   * Send a message (non-streaming) and receive the full reply.
   * Requires a Gemini API key to be configured.
   */
  async sendMessage(userMessage: string): Promise<AiResponse> {
    if (!this.localApiKey) {
      return { reply: '', error: 'No API key configured. Please set your Gemini API key in ⚙ Settings.' }
    }

    // Add user message to history
    this.history.push({
      role: 'user',
      parts: [{ text: userMessage }],
    })

    // Trim history to prevent excessively large payloads
    this.trimHistory()

    return this.callGeminiDirect(false)
  }

  /**
   * Send a message with streaming response.
   * Returns an AbortController so the caller can cancel.
   */
  sendMessageStreaming(userMessage: string, callbacks: StreamCallbacks): AbortController {
    const controller = new AbortController()

    if (!this.localApiKey) {
      callbacks.onError('No API key configured. Please set your Gemini API key in ⚙ Settings.')
      return controller
    }

    // Add user message to history
    this.history.push({
      role: 'user',
      parts: [{ text: userMessage }],
    })
    this.trimHistory()

    this.streamGeminiDirect(callbacks, controller.signal)

    return controller
  }

  // ── Private: Client-side direct Gemini (non-streaming) ─────────────────────

  private async callGeminiDirect(_streaming: false): Promise<AiResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.localApiKey}`

    try {
      const res: Response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
          },
          contents: this.history,
          generationConfig: {
            temperature: 0.7,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 2048,
          },
        }),
      })

      interface GeminiApiResponse {
        candidates?: Array<{
          content: { parts: Array<{ text: string }>; role: string }
          finishReason: string
        }>
        error?: { message: string; code: number }
      }

      const data: GeminiApiResponse = (await res.json()) as GeminiApiResponse

      if (!res.ok || data.error) {
        const errMsg: string = data.error?.message ?? `Gemini error ${res.status}`
        return { reply: '', error: errMsg }
      }

      const reply: string =
        data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? ''

      this.history.push({
        role: 'model',
        parts: [{ text: reply }],
      })

      return { reply }
    } catch (err: unknown) {
      const message: string = err instanceof Error ? err.message : 'Network error'
      return { reply: '', error: message }
    }
  }

  // ── Private: Streaming via direct Gemini ───────────────────────────────────

  private async streamGeminiDirect(
    callbacks: StreamCallbacks,
    signal: AbortSignal,
  ): Promise<void> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${this.localApiKey}`

    try {
      const res: Response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
          },
          contents: this.history,
          generationConfig: {
            temperature: 0.7,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 2048,
          },
        }),
        signal,
      })

      if (!res.ok) {
        const text: string = await res.text()
        callbacks.onError(text || `Gemini error ${res.status}`)
        return
      }

      await this.processSSEStream(res, callbacks)
    } catch (err: unknown) {
      if (signal.aborted) return
      const message: string = err instanceof Error ? err.message : 'Streaming error'
      callbacks.onError(message)
    }
  }

  // ── Private: SSE stream processor ──────────────────────────────────────────

  private async processSSEStream(
    res: Response,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    const reader = res.body?.getReader()
    if (!reader) {
      callbacks.onError('No readable stream')
      return
    }

    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''

    try {
      let done = false
      while (!done) {
        const result = await reader.read()
        done = result.done

        if (result.value) {
          buffer += decoder.decode(result.value, { stream: true })

          // Parse SSE data lines
          const lines: string[] = buffer.split('\n')
          buffer = lines.pop() ?? '' // Keep incomplete last line

          for (const line of lines) {
            const trimmed: string = line.trim()
            if (!trimmed.startsWith('data: ')) continue

            const jsonStr: string = trimmed.slice(6)
            if (jsonStr === '[DONE]') continue

            try {
              interface SSEChunk {
                candidates?: Array<{
                  content?: { parts?: Array<{ text?: string }> }
                }>
              }

              const chunk: SSEChunk = JSON.parse(jsonStr) as SSEChunk
              const text: string = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
              if (text) {
                fullText += text
                callbacks.onChunk(text)
              }
            } catch {
              // Skip malformed JSON chunks
            }
          }
        }
      }

      // Add assistant reply to history
      if (fullText) {
        this.history.push({
          role: 'model',
          parts: [{ text: fullText }],
        })
      }

      callbacks.onDone(fullText)
    } finally {
      reader.releaseLock()
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private trimHistory(): void {
    // Keep at most MAX_HISTORY entries (each exchange = 2 entries)
    if (this.history.length > MAX_HISTORY * 2) {
      this.history = this.history.slice(-(MAX_HISTORY * 2))
    }
  }

}

// ── System Instruction (shared with direct calls) ────────────────────────────

const SYSTEM_INSTRUCTION = `You are Wednesday, a smart AI assistant built into ZynqOS — a web-based operating system.
You help users with coding, terminal commands, file management, system tasks, and general knowledge.
Keep responses concise and useful. Use markdown formatting when helpful.
If the user asks for terminal commands, prefix them with \`$\` so they can be copy-pasted.
You are friendly, helpful, and technically skilled.`

// ── Singleton Export ─────────────────────────────────────────────────────────

export const wednesdayAi = new WednesdayAiService()
