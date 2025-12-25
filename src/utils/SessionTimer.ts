import { useEffect, useState } from 'react'

export type SessionTimerState = {
  sessionStartMs: number
  totalActiveMs: number
  lastActivityTs: number
  lastUpdateTs: number
}

const STORAGE_KEY = 'zynqos_session_timer'
const LEADER_KEY = 'zynqos_session_leader'
export const SESSION_IDLE_THRESHOLD_MS = 60_000 // 1 minute of inactivity breaks active streak
const BACKEND_SYNC_INTERVAL_MS = 300_000 // Sync to backend every 5 minutes

function nowMs() {
  return Date.now()
}

function createInitialState(): SessionTimerState {
  const now = nowMs()
  return {
    sessionStartMs: now,
    totalActiveMs: 0,
    lastActivityTs: now,
    lastUpdateTs: now,
  }
}

class SessionTimer {
  private idleThresholdMs = SESSION_IDLE_THRESHOLD_MS
  private leaderTtlMs = 5_000
  private tickMs = 1_000
  private instanceId: string
  private tickHandle: number | null = null
  private listeners = new Set<(state: SessionTimerState) => void>()
  private cachedState: SessionTimerState
  private lastBackendSync: number = 0

  constructor() {
    const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined
    this.instanceId = cryptoObj?.randomUUID?.() ?? `session-${Math.random().toString(36).slice(2)}`
    this.cachedState = this.ensureState()

    window.addEventListener('storage', this.handleStorage)
    this.attachActivityListeners()
    this.tickHandle = window.setInterval(this.tick, this.tickMs)

    // Initial backend sync (delayed to avoid blocking)
    setTimeout(() => this.syncToBackend(), 5000)
  }

  private handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try {
      const next = JSON.parse(event.newValue) as SessionTimerState
      this.cachedState = next
      this.notify(next)
    } catch {
      // ignore malformed payloads
    }
  }

  private attachActivityListeners() {
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']
    const activityHandler = () => this.recordActivity()

    activityEvents.forEach((evt) => window.addEventListener(evt, activityHandler, { passive: true }))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.recordActivity()
      }
    })
  }

  private ensureState(): SessionTimerState {
    const existing = this.loadState()
    if (existing) return existing

    const initial = createInitialState()
    this.persist(initial)
    return initial
  }

  private loadState(): SessionTimerState | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) return null
      return JSON.parse(stored) as SessionTimerState
    } catch {
      return null
    }
  }

  private persist(next: SessionTimerState) {
    this.cachedState = next
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // best-effort; keep cached state anyway
    }
    this.notify(next)
  }

  private notify(state: SessionTimerState) {
    this.listeners.forEach((listener) => listener(state))
  }

  private recordActivity() {
    const state = this.ensureState()
    const now = nowMs()

    if (now <= state.lastActivityTs) return

    const updated: SessionTimerState = {
      ...state,
      lastActivityTs: now,
    }

    this.persist(updated)
  }

  private claimLeadership(now: number): boolean {
    try {
      const raw = localStorage.getItem(LEADER_KEY)
      const leader = raw ? JSON.parse(raw) as { instanceId: string; expiresAt: number } : null
      const expired = !leader || leader.expiresAt < now

      if (expired || leader.instanceId === this.instanceId) {
        localStorage.setItem(LEADER_KEY, JSON.stringify({ instanceId: this.instanceId, expiresAt: now + this.leaderTtlMs }))
        return true
      }
    } catch {
      // If anything goes wrong, keep working as non-leader
    }

    return false
  }

  private tick = () => {
    const now = nowMs()
    const isLeader = this.claimLeadership(now)
    if (!isLeader) return

    const state = this.ensureState()
    const delta = Math.max(0, now - state.lastUpdateTs)
    const isActive = now - state.lastActivityTs < this.idleThresholdMs

    const nextState: SessionTimerState = {
      ...state,
      totalActiveMs: state.totalActiveMs + (isActive ? delta : 0),
      lastUpdateTs: now,
    }

    this.persist(nextState)

    // Sync to backend periodically
    if (now - this.lastBackendSync > BACKEND_SYNC_INTERVAL_MS) {
      this.syncToBackend()
    }
  }

  private syncToBackend = async () => {
    const now = nowMs()
    this.lastBackendSync = now

    try {
      const state = this.cachedState
      const res = await fetch('/api/user-data?action=update-active-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          activeTimeMs: state.totalActiveMs
        })
      })

      if (!res.ok) {
        // Only warn on server errors; ignore 401/403 when unauthenticated
        if (res.status >= 500) {
          console.warn('Failed to sync session timer to backend:', res.status)
        }
      }
    } catch (error) {
      // Silently fail - user might not be logged in
    }
  }

  subscribe(listener: (state: SessionTimerState) => void) {
    this.listeners.add(listener)
    listener(this.cachedState)

    return () => {
      this.listeners.delete(listener)
    }
  }

  getState(): SessionTimerState {
    return this.cachedState
  }

  destroy() {
    if (this.tickHandle) {
      clearInterval(this.tickHandle)
    }
    window.removeEventListener('storage', this.handleStorage)
    this.listeners.clear()
  }
}

export const sessionTimer = new SessionTimer()

export function useSessionTimer(): SessionTimerState {
  const [state, setState] = useState<SessionTimerState>(() => sessionTimer.getState())

  useEffect(() => sessionTimer.subscribe(setState), [])

  return state
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const h = hours.toString().padStart(2, '0')
  const m = minutes.toString().padStart(2, '0')
  const s = seconds.toString().padStart(2, '0')

  return `${h}:${m}:${s}`
}
