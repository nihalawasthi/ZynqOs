import type { Attachment, Message } from './storage.js'

type ChatEvent =
  | { type: 'message'; chatId: string; message: Message }
  | { type: 'message-update'; chatId: string; message: Message }
  | { type: 'typing'; chatId: string; userId: string; isTyping: boolean }
  | { type: 'presence'; userId: string; presence: 'online' | 'away' | 'offline' }

type SendPayload = {
  chatId: string
  body: string
  author: string
  replyToId?: string
  attachments?: Attachment[]
}

type UploadPayload = {
  chatId: string
  name: string
  mimeType: string
  size: number
  base64: string
}

export function connectChatEvents(
  onEvent: (event: ChatEvent) => void,
  onError?: (err: Event) => void,
  onStatus?: (status: 'open' | 'error' | 'closed') => void
): () => void {
  const source = new EventSource('/api?route=chat&action=events', { withCredentials: true })

  source.onopen = () => {
    onStatus?.('open')
  }

  source.onmessage = (ev) => {
    if (!ev.data) return
    try {
      const event = JSON.parse(ev.data) as ChatEvent
      onEvent(event)
    } catch {
      // ignore malformed events
    }
  }

  source.onerror = (err) => {
    onStatus?.('error')
    onError?.(err)
  }

  return () => {
    source.close()
    onStatus?.('closed')
  }
}

export async function fetchChatHistory(chatId: string, since?: number): Promise<Message[]> {
  const params = new URLSearchParams({ route: 'chat', action: 'history', chatId })
  if (since) params.set('since', String(since))
  const res = await fetch(`/api?${params.toString()}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch chat history')
  const json = await res.json()
  return Array.isArray(json.messages) ? json.messages : []
}

export async function sendChatMessage(payload: SendPayload): Promise<Message> {
  const res = await fetch('/api?route=chat&action=send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error || 'Failed to send message')
  return json.message as Message
}

export async function updateChatMessage(chatId: string, message: Message): Promise<Message> {
  const res = await fetch('/api?route=chat&action=update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ chatId, message })
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error || 'Failed to update message')
  return json.message as Message
}

export async function uploadChatAttachment(payload: UploadPayload): Promise<Attachment> {
  const res = await fetch('/api?route=chat&action=upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error || 'Failed to upload attachment')
  return json.attachment as Attachment
}

export async function fetchLinkPreview(url: string) {
  const params = new URLSearchParams({ route: 'chat', action: 'preview', url })
  const res = await fetch(`/api?${params.toString()}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch link preview')
  return res.json()
}

export async function sendTypingSignal(chatId: string, userId: string, isTyping: boolean): Promise<void> {
  await fetch('/api?route=chat&action=typing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ chatId, userId, isTyping })
  })
}

export async function sendPresenceUpdate(userId: string, presence: 'online' | 'away' | 'offline'): Promise<void> {
  await fetch('/api?route=chat&action=presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ userId, presence })
  })
}
