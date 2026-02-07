import type { Message } from './storage'

type PresenceState = 'online' | 'away' | 'offline'

type RealtimeEvent =
  | { type: 'presence'; userId: string; presence: PresenceState; sourceId?: string }
  | { type: 'typing'; chatId: string; userId: string; isTyping: boolean; sourceId?: string }
  | { type: 'message'; chatId: string; message: Message; sourceId?: string }
  | { type: 'message-update'; chatId: string; message: Message; sourceId?: string }

type Listener = (event: RealtimeEvent) => void

const listeners = new Set<Listener>()
const channelName = 'zynqchat-rt-v1'
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null
const clientId = crypto?.randomUUID?.() ?? `client-${Math.random().toString(36).slice(2)}`

if (channel) {
  channel.onmessage = (ev) => {
    const event = ev.data as RealtimeEvent
    listeners.forEach(listener => listener(event))
  }
}

export function subscribeRealtime(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishRealtime(event: RealtimeEvent): void {
  const enriched = { ...event, sourceId: event.sourceId || clientId }
  listeners.forEach(listener => listener(enriched))
  channel?.postMessage(enriched)
}

export function getRealtimeClientId(): string {
  return clientId
}

export function startMockPresence(users: string[], intervalMs = 6500): () => void {
  if (!users.length) return () => {}

  const states: PresenceState[] = ['online', 'away', 'offline']
  const userStates = new Map<string, PresenceState>()

  users.forEach((user) => userStates.set(user, 'offline'))

  const timer = window.setInterval(() => {
    const target = users[Math.floor(Math.random() * users.length)]
    const next = states[Math.floor(Math.random() * states.length)]
    userStates.set(target, next)
    publishRealtime({ type: 'presence', userId: target, presence: next })
  }, intervalMs)

  return () => window.clearInterval(timer)
}
