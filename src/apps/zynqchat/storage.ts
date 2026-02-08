import { readFile, writeFile } from '../../vfs/fs'
import { decryptJson, encryptJson } from './crypto'

type ChatKind = 'dm' | 'group'

type ChatPresence = 'online' | 'away' | 'offline'

export type Chat = {
  id: string
  name: string
  kind: ChatKind
  presence?: ChatPresence
  lastMessage?: string
  unreadCount?: number
  members?: number
}

export type Attachment = {
  id: string
  name: string
  mimeType: string
  size: number
  vfsPath: string
  downloadUrl?: string
  serverId?: string
}

export type Message = {
  id: string
  author: string
  body: string
  timestamp: string
  createdAt?: number
  replyToId?: string
  editedAt?: string
  deletedAt?: string
  pinned?: boolean
  reactions?: Record<string, string[]>
  attachments?: Attachment[]
  linkPreviews?: Array<{ url: string; title?: string; description?: string; image?: string }>
  status?: 'sent' | 'seen'
}

export type ZynqChatStore = {
  version: 1
  updatedAt: string
  chats: Chat[]
  messagesByChat: Record<string, Message[]>
}

const STORE_PATH = '/home/.zynqchat/store.json'

export async function loadZynqChatStore(): Promise<ZynqChatStore | null> {
  const raw = await readFile(STORE_PATH)
  if (!raw) return null

  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
  return decryptJson<ZynqChatStore>(text)
}

export async function saveZynqChatStore(store: ZynqChatStore): Promise<void> {
  const payload = await encryptJson(store)
  await writeFile(STORE_PATH, payload)
}
