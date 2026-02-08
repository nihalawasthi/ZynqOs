import crypto from 'crypto'
import { sql } from '@vercel/postgres'

const HAS_DB = !!process.env.POSTGRES_URL || !!process.env.POSTGRES_URL_NON_POOLING

type LinkPreview = {
  url: string
  title?: string
  description?: string
  image?: string
}

export type ChatAttachmentRecord = {
  id: string
  chatId: string
  name: string
  mimeType: string
  size: number
  dataEnc: string
  dataIv: string
  dataTag: string
  createdAt: number
}

export type ChatMessageRecord = {
  id: string
  chatId: string
  author: string
  createdAt: number
  timestamp: string
  payloadEnc: string
  payloadIv: string
  payloadTag: string
}

export type ChatMessagePayload = {
  body: string
  replyToId?: string
  editedAt?: string
  deletedAt?: string
  status?: 'sent' | 'seen'
  pinned?: boolean
  reactions?: Record<string, string[]>
  attachments?: Array<{
    id: string
    name: string
    mimeType: string
    size: number
    downloadUrl: string
  }>
  linkPreviews?: LinkPreview[]
}

const memoryMessages = new Map<string, ChatMessageRecord[]>()
const memoryAttachments = new Map<string, ChatAttachmentRecord>()
const memoryLinkPreviews = new Map<string, { preview: LinkPreview; fetchedAt: number }>()

const CHAT_KEY = process.env.CHAT_ENC_KEY || process.env.SESSION_SECRET || 'dev-chat-key'
const KEY_BYTES = crypto.createHash('sha256').update(CHAT_KEY).digest()

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(base64: string): Buffer {
  return Buffer.from(base64, 'base64')
}

function encryptPayload(payload: object): { data: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY_BYTES, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return { data: toBase64(encrypted), iv: toBase64(iv), tag: toBase64(tag) }
}

function decryptPayload<T>(data: string, iv: string, tag: string): T {
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY_BYTES, fromBase64(iv))
  decipher.setAuthTag(fromBase64(tag))
  const decrypted = Buffer.concat([decipher.update(fromBase64(data)), decipher.final()])
  return JSON.parse(decrypted.toString('utf-8')) as T
}

export async function initChatDatabase() {
  if (!HAS_DB) return
  await sql`
    CREATE TABLE IF NOT EXISTS zynqchat_messages (
      message_id UUID PRIMARY KEY,
      chat_id TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      timestamp TEXT NOT NULL,
      payload_enc TEXT NOT NULL,
      payload_iv TEXT NOT NULL,
      payload_tag TEXT NOT NULL
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS zynqchat_attachments (
      attachment_id UUID PRIMARY KEY,
      chat_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size BIGINT NOT NULL,
      data_enc TEXT NOT NULL,
      data_iv TEXT NOT NULL,
      data_tag TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS zynqchat_link_previews (
      url TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      image TEXT,
      fetched_at BIGINT NOT NULL
    )
  `
}

export async function insertChatMessage(message: Omit<ChatMessageRecord, 'payloadEnc' | 'payloadIv' | 'payloadTag'> & { payload: ChatMessagePayload }): Promise<ChatMessageRecord> {
  const encrypted = encryptPayload(message.payload)
  const record: ChatMessageRecord = {
    id: message.id,
    chatId: message.chatId,
    author: message.author,
    createdAt: message.createdAt,
    timestamp: message.timestamp,
    payloadEnc: encrypted.data,
    payloadIv: encrypted.iv,
    payloadTag: encrypted.tag
  }

  if (!HAS_DB) {
    const list = memoryMessages.get(record.chatId) || []
    memoryMessages.set(record.chatId, [...list, record])
    return record
  }

  await sql`
    INSERT INTO zynqchat_messages (message_id, chat_id, author, created_at, timestamp, payload_enc, payload_iv, payload_tag)
    VALUES (${record.id}, ${record.chatId}, ${record.author}, ${record.createdAt}, ${record.timestamp}, ${record.payloadEnc}, ${record.payloadIv}, ${record.payloadTag})
  `

  return record
}

export async function updateChatMessage(message: Omit<ChatMessageRecord, 'payloadEnc' | 'payloadIv' | 'payloadTag'> & { payload: ChatMessagePayload }): Promise<ChatMessageRecord> {
  const encrypted = encryptPayload(message.payload)
  const record: ChatMessageRecord = {
    id: message.id,
    chatId: message.chatId,
    author: message.author,
    createdAt: message.createdAt,
    timestamp: message.timestamp,
    payloadEnc: encrypted.data,
    payloadIv: encrypted.iv,
    payloadTag: encrypted.tag
  }

  if (!HAS_DB) {
    const list = memoryMessages.get(record.chatId) || []
    const idx = list.findIndex(item => item.id === record.id)
    if (idx >= 0) {
      const next = [...list]
      next[idx] = record
      memoryMessages.set(record.chatId, next)
    } else {
      memoryMessages.set(record.chatId, [...list, record])
    }
    return record
  }

  await sql`
    UPDATE zynqchat_messages
    SET payload_enc = ${record.payloadEnc}, payload_iv = ${record.payloadIv}, payload_tag = ${record.payloadTag}
    WHERE message_id = ${record.id}
  `

  return record
}

export async function listChatMessages(chatId: string, since?: number): Promise<Array<ChatMessageRecord & { payload: ChatMessagePayload }>> {
  if (!HAS_DB) {
    const list = memoryMessages.get(chatId) || []
    const filtered = since ? list.filter(item => item.createdAt > since) : list
    return filtered.map(item => ({
      ...item,
      payload: decryptPayload<ChatMessagePayload>(item.payloadEnc, item.payloadIv, item.payloadTag)
    }))
  }

  const result = since
    ? await sql`
        SELECT message_id, chat_id, author, created_at, timestamp, payload_enc, payload_iv, payload_tag
        FROM zynqchat_messages
        WHERE chat_id = ${chatId} AND created_at > ${since}
        ORDER BY created_at ASC
      `
    : await sql`
        SELECT message_id, chat_id, author, created_at, timestamp, payload_enc, payload_iv, payload_tag
        FROM zynqchat_messages
        WHERE chat_id = ${chatId}
        ORDER BY created_at ASC
      `

  return result.rows.map(row => ({
    id: row.message_id,
    chatId: row.chat_id,
    author: row.author,
    createdAt: Number(row.created_at),
    timestamp: row.timestamp,
    payloadEnc: row.payload_enc,
    payloadIv: row.payload_iv,
    payloadTag: row.payload_tag,
    payload: decryptPayload<ChatMessagePayload>(row.payload_enc, row.payload_iv, row.payload_tag)
  }))
}

export async function deleteOldChatMessages(cutoff: number): Promise<void> {
  if (!HAS_DB) {
    for (const [chatId, list] of memoryMessages.entries()) {
      const filtered = list.filter(item => item.createdAt >= cutoff)
      if (filtered.length) {
        memoryMessages.set(chatId, filtered)
      } else {
        memoryMessages.delete(chatId)
      }
    }

    for (const [attachmentId, record] of memoryAttachments.entries()) {
      if (record.createdAt < cutoff) {
        memoryAttachments.delete(attachmentId)
      }
    }
    return
  }

  await sql`
    DELETE FROM zynqchat_messages
    WHERE created_at < ${cutoff}
  `
  await sql`
    DELETE FROM zynqchat_attachments
    WHERE created_at < ${cutoff}
  `
}

export async function insertAttachment(input: { chatId: string; name: string; mimeType: string; size: number; bytes: Uint8Array }): Promise<ChatAttachmentRecord> {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY_BYTES, iv)
  const encrypted = Buffer.concat([cipher.update(Buffer.from(input.bytes)), cipher.final()])
  const tag = cipher.getAuthTag()
  const record: ChatAttachmentRecord = {
    id: crypto.randomUUID(),
    chatId: input.chatId,
    name: input.name,
    mimeType: input.mimeType,
    size: input.size,
    dataEnc: toBase64(encrypted),
    dataIv: toBase64(iv),
    dataTag: toBase64(tag),
    createdAt: Date.now()
  }

  if (!HAS_DB) {
    memoryAttachments.set(record.id, record)
    return record
  }

  await sql`
    INSERT INTO zynqchat_attachments (attachment_id, chat_id, name, mime_type, size, data_enc, data_iv, data_tag, created_at)
    VALUES (${record.id}, ${record.chatId}, ${record.name}, ${record.mimeType}, ${record.size}, ${record.dataEnc}, ${record.dataIv}, ${record.dataTag}, ${record.createdAt})
  `

  return record
}

export async function getAttachment(attachmentId: string): Promise<{ record: ChatAttachmentRecord; bytes: Buffer } | null> {
  if (HAS_DB) {
    const row = (await sql`
      SELECT attachment_id, chat_id, name, mime_type, size, data_enc, data_iv, data_tag, created_at
      FROM zynqchat_attachments
      WHERE attachment_id = ${attachmentId}
    `).rows[0] as any

    if (!row) return null

    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY_BYTES, fromBase64(row.data_iv))
    decipher.setAuthTag(fromBase64(row.data_tag))
    const decrypted = Buffer.concat([decipher.update(fromBase64(row.data_enc)), decipher.final()])

    return {
      record: {
        id: row.attachment_id,
        chatId: row.chat_id,
        name: row.name,
        mimeType: row.mime_type,
        size: Number(row.size),
        dataEnc: row.data_enc,
        dataIv: row.data_iv,
        dataTag: row.data_tag,
        createdAt: Number(row.created_at)
      },
      bytes: decrypted
    }
  }

  const record = memoryAttachments.get(attachmentId)
  if (!record) return null

  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY_BYTES, fromBase64(record.dataIv))
  decipher.setAuthTag(fromBase64(record.dataTag))
  const decrypted = Buffer.concat([decipher.update(fromBase64(record.dataEnc)), decipher.final()])

  return { record, bytes: decrypted }
}

export async function getLinkPreview(url: string): Promise<LinkPreview | null> {
  if (HAS_DB) {
    const row = (await sql`
      SELECT url, title, description, image, fetched_at
      FROM zynqchat_link_previews
      WHERE url = ${url}
    `).rows[0] as any

    if (!row) return null
    return {
      url: row.url,
      title: row.title || undefined,
      description: row.description || undefined,
      image: row.image || undefined
    }
  }

  const cached = memoryLinkPreviews.get(url)
  if (!cached) return null
  return cached.preview
}

export async function upsertLinkPreview(preview: LinkPreview) {
  const fetchedAt = Date.now()
  if (!HAS_DB) {
    memoryLinkPreviews.set(preview.url, { preview, fetchedAt })
    return
  }

  await sql`
    INSERT INTO zynqchat_link_previews (url, title, description, image, fetched_at)
    VALUES (${preview.url}, ${preview.title || null}, ${preview.description || null}, ${preview.image || null}, ${fetchedAt})
    ON CONFLICT (url) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      image = EXCLUDED.image,
      fetched_at = EXCLUDED.fetched_at
  `
}
