import React, { useEffect, useMemo, useRef, useState } from 'react'
import { type Attachment, type Chat, type Message, loadZynqChatStore, saveZynqChatStore } from './storage.js'
import { connectChatEvents, fetchChatHistory, sendChatMessage, sendPresenceUpdate, sendSeenSignal, sendTypingSignal, updateChatMessage, uploadChatAttachment } from './chatApi.js'
import { readFile, writeFile } from '../../vfs/fs.js'
import { downloadFile } from '../../utils/fileUpload.js'
import { getStorageStatus } from '../../auth/storage.js'

const initialChats: Chat[] = []
const initialMessages: Record<string, Message[]> = {}

export default function ZynqChatUI() {
    const [chats, setChats] = useState<Chat[]>(initialChats)
    const [activeChatId, setActiveChatId] = useState<string>(initialChats[0]?.id || '')
    const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>(initialMessages)
    const [search, setSearch] = useState('')
    const [draft, setDraft] = useState('')
    const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([])
    const [loading, setLoading] = useState(true)
    const [storeError, setStoreError] = useState<string | null>(null)
    const [serverError, setServerError] = useState<string | null>(null)
    const [isSyncing, setIsSyncing] = useState(false)
    const [typingByChat, setTypingByChat] = useState<Record<string, string[]>>({})
    const [replyToId, setReplyToId] = useState<string | null>(null)
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
    const [currentUser, setCurrentUser] = useState('You')
    const [currentUserId, setCurrentUserId] = useState('')
    const [customHandle, setCustomHandle] = useState(() => localStorage.getItem('zynqchat_handle') || '')
    const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'open' | 'error'>('connecting')
    const [reconnectToken, setReconnectToken] = useState(0)
    const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({})
    const [openActionMessageId, setOpenActionMessageId] = useState<string | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const saveTimerRef = useRef<number | null>(null)
    const typingTimerRef = useRef<number | null>(null)
    const activeChatIdRef = useRef(activeChatId)
    const attachmentInputRef = useRef<HTMLInputElement>(null)
    const chatsRef = useRef(chats)
    const messagesByChatRef = useRef(messagesByChat)
    const attachmentPreviewRef = useRef<Record<string, string>>({})
    const reconnectTimerRef = useRef<number | null>(null)

    const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

    const activeChat = chats.find(chat => chat.id === activeChatId)
    const activeMessages = messagesByChat[activeChatId] || []
    const resolvedHandle = customHandle.trim() || currentUser
    const resolvedUserId = currentUserId.trim() || resolvedHandle
    const replyTarget = replyToId ? activeMessages.find(msg => msg.id === replyToId) : null

    const filteredChats = useMemo(() => {
        const query = search.trim().toLowerCase()
        if (!query) return chats
        return chats.filter(chat => chat.name.toLowerCase().includes(query))
    }, [chats, search])

    const directChats = filteredChats.filter(chat => chat.kind === 'dm')
    const groupChats = filteredChats.filter(chat => chat.kind === 'group')

    useEffect(() => {
        activeChatIdRef.current = activeChatId
    }, [activeChatId])

    useEffect(() => {
        chatsRef.current = chats
    }, [chats])

    useEffect(() => {
        messagesByChatRef.current = messagesByChat
    }, [messagesByChat])

    useEffect(() => {
        attachmentPreviewRef.current = attachmentPreviews
    }, [attachmentPreviews])

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [activeChatId, activeMessages.length])

    useEffect(() => {
        const handleClick = () => setOpenActionMessageId(null)
        window.addEventListener('click', handleClick)
        return () => window.removeEventListener('click', handleClick)
    }, [])

    useEffect(() => {
        let cancelled = false

        const buildPreviews = async () => {
            const pending: Array<{ id: string; mimeType: string; vfsPath?: string; downloadUrl?: string }> = []

            for (const message of activeMessages) {
                for (const att of message.attachments || []) {
                    if (!att.mimeType?.startsWith('image/')) continue
                    if (!att.vfsPath && !att.downloadUrl) continue
                    if (attachmentPreviewRef.current[att.id]) continue
                    pending.push({ id: att.id, mimeType: att.mimeType, vfsPath: att.vfsPath, downloadUrl: att.downloadUrl })
                }
            }

            if (!pending.length) return

            const next: Record<string, string> = {}
            for (const item of pending) {
                try {
                    if (item.downloadUrl) {
                        const res = await fetch(item.downloadUrl, { credentials: 'include' })
                        if (!res.ok) continue
                        const blob = await res.blob()
                        next[item.id] = URL.createObjectURL(blob)
                        continue
                    }

                    if (!item.vfsPath) continue
                    const data = await readFile(item.vfsPath)
                    if (cancelled || !data) continue

                    let bytes: Uint8Array | null = null
                    if (data instanceof Uint8Array) {
                        bytes = data
                    } else if (typeof data === 'string') {
                        try {
                            const decoded = atob(data)
                            bytes = new Uint8Array(decoded.length)
                            for (let i = 0; i < decoded.length; i += 1) {
                                bytes[i] = decoded.charCodeAt(i)
                            }
                        } catch {
                            bytes = null
                        }
                    }

                    if (!bytes) continue
                    const blob = new Blob([new Uint8Array(bytes)], { type: item.mimeType })
                    next[item.id] = URL.createObjectURL(blob)
                } catch {
                    // ignore preview errors
                }
            }

            if (!cancelled && Object.keys(next).length) {
                setAttachmentPreviews(prev => ({ ...prev, ...next }))
            }
        }

        buildPreviews()

        return () => {
            cancelled = true
        }
    }, [activeMessages])

    useEffect(() => {
        return () => {
            const urls = Object.values(attachmentPreviewRef.current)
            for (const url of urls) {
                URL.revokeObjectURL(url)
            }
        }
    }, [])

    useEffect(() => {
        let cancelled = false

        async function hydrateStore() {
            try {
                const stored = await loadZynqChatStore()
                if (cancelled) return
                if (stored?.chats?.length) {
                    const cutoff = Date.now() - 24 * 60 * 60 * 1000
                    const filteredMessages: Record<string, Message[]> = {}
                    const sourceMessages = stored.messagesByChat || {}
                    for (const [chatId, items] of Object.entries(sourceMessages)) {
                        filteredMessages[chatId] = items.filter(msg => (msg.createdAt || 0) >= cutoff)
                    }
                    setChats(stored.chats)
                    setMessagesByChat(filteredMessages)
                    if (stored.chats[0]?.id) {
                        setActiveChatId(stored.chats[0].id)
                    }
                } else {
                    await saveZynqChatStore({
                        version: 1,
                        updatedAt: new Date().toISOString(),
                        chats: initialChats,
                        messagesByChat: initialMessages
                    })
                }
            } catch (err) {
                if (!cancelled) {
                    setStoreError(err instanceof Error ? err.message : String(err))
                }
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        hydrateStore()
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        const loadProfile = async () => {
            const status = await getStorageStatus(true)
            const profile = status.profile || {}
            const name = profile.login || profile.name || profile.email || 'You'
            setCurrentUser(name)
            setCurrentUserId(profile.login || profile.id || name)
        }
        loadProfile().catch(() => {
            setCurrentUser('You')
            setCurrentUserId('')
        })

        const handleAuthRefresh = (event: Event) => {
            const customEvent = event as CustomEvent<any>
            const profile = customEvent?.detail?.profile || {}
            const name = profile.login || profile.name || profile.email || 'You'
            setCurrentUser(name)
            setCurrentUserId(profile.login || profile.id || name)
        }
        window.addEventListener('zynqos:auth-initialized', handleAuthRefresh as EventListener)
        return () => window.removeEventListener('zynqos:auth-initialized', handleAuthRefresh as EventListener)
    }, [])

    useEffect(() => {
        const unsubscribe = connectChatEvents((event) => {
            if (event.type === 'presence') {
                setChats(prev => prev.map(chat => (
                    chat.kind === 'dm' && normalizeHandle(chat.name) === normalizeHandle(event.userId)
                        ? { ...chat, presence: event.presence }
                        : chat
                )))
                return
            }

            if (event.type === 'typing') {
                if (event.userId === resolvedUserId || event.userId === resolvedHandle) return
                setTypingByChat(prev => {
                    const existing = prev[event.chatId] || []
                    const next = event.isTyping
                        ? Array.from(new Set([...existing, event.userId]))
                        : existing.filter(name => name !== event.userId)
                    return { ...prev, [event.chatId]: next }
                })
                return
            }

            if (event.type === 'message') {
                const incoming = {
                    ...event.message,
                    status: (event.message.author === resolvedUserId || event.message.author === resolvedHandle)
                        ? (event.message.status || 'sent')
                        : event.message.status
                }
                appendMessage(event.chatId, incoming)
                if (event.chatId === activeChatIdRef.current && incoming.author !== resolvedUserId && incoming.author !== resolvedHandle) {
                    sendSeenSignal(event.chatId, resolvedUserId, incoming.createdAt || Date.now()).catch(() => undefined)
                }
                setChats(prev => {
                    const existing = prev.find(chat => chat.id === event.chatId)
                    if (!existing) {
                        const dmPeer = getDmPeerFromChatId(event.chatId, resolvedUserId) || event.message.author
                        return [{ id: event.chatId, name: normalizeHandle(dmPeer), kind: 'dm', presence: 'offline', lastMessage: event.message.body, unreadCount: 1 }, ...prev]
                    }
                    return prev.map(chat => {
                        if (chat.id !== event.chatId) return chat
                        const unreadCount = chat.id === activeChatIdRef.current ? 0 : (chat.unreadCount || 0) + 1
                        return { ...chat, lastMessage: event.message.body, unreadCount }
                    })
                })
                return
            }

            if (event.type === 'message-update') {
                setMessagesByChat(prev => {
                    const existing = prev[event.chatId] || []
                    const index = existing.findIndex(msg => msg.id === event.message.id)
                    if (index < 0) return prev
                    const next = [...existing]
                    next[index] = event.message
                    return { ...prev, [event.chatId]: next }
                })
            }
        }, () => {
            setServerError('Realtime connection failed')
            setRealtimeStatus('error')
        }, (status) => {
            if (status === 'open') {
                setServerError(null)
                setRealtimeStatus('open')
            } else if (status === 'error') {
                setRealtimeStatus('error')
            }
        })

        return () => {
            unsubscribe()
            if (reconnectTimerRef.current) {
                window.clearTimeout(reconnectTimerRef.current)
                reconnectTimerRef.current = null
            }
        }
    }, [resolvedHandle, resolvedUserId, reconnectToken])

    useEffect(() => {
        if (realtimeStatus !== 'error') return
        if (reconnectTimerRef.current) return

        reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null
            setRealtimeStatus('connecting')
            setReconnectToken(prev => prev + 1)
        }, 3000)
    }, [realtimeStatus])

    useEffect(() => {
        if (realtimeStatus !== 'error') return
        let cancelled = false

        const poll = async () => {
            const currentChats = chatsRef.current
            const currentMessages = messagesByChatRef.current

            try {
                const results = await Promise.all(currentChats.map(async (chat) => {
                    const existing = currentMessages[chat.id] || []
                    const lastCreatedAt = existing.length ? existing[existing.length - 1].createdAt : 0
                    const incoming = await fetchChatHistory(chat.id, lastCreatedAt || undefined)
                    return { chatId: chat.id, incoming }
                }))

                if (cancelled) return

                let hasUpdates = false

                setMessagesByChat(prev => {
                    const next = { ...prev }
                    for (const result of results) {
                        if (!result.incoming.length) continue
                        const existing = next[result.chatId] || []
                        const existingIds = new Set(existing.map(msg => msg.id))
                        const merged = [...existing, ...result.incoming.filter(msg => !existingIds.has(msg.id))]
                        if (merged.length !== existing.length) {
                            next[result.chatId] = merged
                            hasUpdates = true
                        }
                    }
                    return next
                })

                if (hasUpdates) {
                    setChats(prev => prev.map(chat => {
                        const update = results.find(result => result.chatId === chat.id)
                        if (!update || update.incoming.length === 0) return chat
                        const lastMessage = update.incoming[update.incoming.length - 1].body
                        const unreadCount = chat.id === activeChatIdRef.current
                            ? 0
                            : (chat.unreadCount || 0) + update.incoming.length
                        return { ...chat, lastMessage, unreadCount }
                    }))
                }
            } catch {
                // ignore polling errors
            }
        }

        poll()
        const interval = window.setInterval(poll, 8000)
        return () => {
            cancelled = true
            window.clearInterval(interval)
        }
    }, [realtimeStatus])

    useEffect(() => {
        if (loading) return
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = window.setTimeout(() => {
            saveZynqChatStore({
                version: 1,
                updatedAt: new Date().toISOString(),
                chats,
                messagesByChat
            }).catch((err) => {
                setStoreError(err instanceof Error ? err.message : String(err))
            })
        }, 400)
    }, [chats, messagesByChat, loading])

    useEffect(() => {
        if (!activeChatId) return
        let cancelled = false
        setIsSyncing(true)
        fetchChatHistory(activeChatId)
            .then((messages) => {
                if (cancelled) return
                if (messages.length) {
                    setMessagesByChat(prev => ({ ...prev, [activeChatId]: messages }))
                    setChats(prev => prev.map(chat => (
                        chat.id === activeChatId
                            ? { ...chat, lastMessage: messages[messages.length - 1].body }
                            : chat
                    )))
                    const lastMessage = messages[messages.length - 1]
                    if (lastMessage.author !== resolvedUserId && lastMessage.author !== resolvedHandle) {
                        sendSeenSignal(activeChatId, resolvedUserId, lastMessage.createdAt || Date.now()).catch(() => undefined)
                    }
                    return
                }

                if (!activeChat || activeChat.kind !== 'dm') {
                    setMessagesByChat(prev => ({ ...prev, [activeChatId]: messages }))
                    return
                }

                const altChatId = buildDmChatId(resolvedUserId, activeChat.name)
                if (!altChatId || altChatId === activeChatId) {
                    setMessagesByChat(prev => ({ ...prev, [activeChatId]: messages }))
                    return
                }

                fetchChatHistory(altChatId)
                    .then((altMessages) => {
                        if (cancelled) return
                        if (!altMessages.length) {
                            setMessagesByChat(prev => ({ ...prev, [activeChatId]: messages }))
                            return
                        }

                        setMessagesByChat(prev => {
                            const next = { ...prev }
                            delete next[activeChatId]
                            next[altChatId] = altMessages
                            return next
                        })

                        setChats(prev => prev.map(chat => (
                            chat.id === activeChatId
                                ? { ...chat, id: altChatId, lastMessage: altMessages[altMessages.length - 1].body }
                                : chat
                        )))

                        setActiveChatId(altChatId)
                        const lastMessage = altMessages[altMessages.length - 1]
                        if (lastMessage && lastMessage.author !== resolvedUserId && lastMessage.author !== resolvedHandle) {
                            sendSeenSignal(altChatId, resolvedUserId, lastMessage.createdAt || Date.now()).catch(() => undefined)
                        }
                    })
                    .catch(() => {
                        if (!cancelled) setMessagesByChat(prev => ({ ...prev, [activeChatId]: messages }))
                    })
            })
            .catch((err) => {
                if (!cancelled) setServerError(err instanceof Error ? err.message : String(err))
            })
            .finally(() => {
                if (!cancelled) setIsSyncing(false)
            })

        return () => {
            cancelled = true
        }
    }, [activeChatId])

    useEffect(() => {
        if (!resolvedHandle) return
        let mounted = true

        const sendPresence = async (presence: 'online' | 'away' | 'offline') => {
            try {
                await sendPresenceUpdate(resolvedUserId, presence)
            } catch {
                if (mounted) setServerError('Failed to update presence')
            }
        }

        const handleVisibility = () => {
            const next = document.hidden ? 'away' : 'online'
            sendPresence(next)
        }

        sendPresence('online')
        const heartbeat = window.setInterval(() => sendPresence('online'), 30000)
        document.addEventListener('visibilitychange', handleVisibility)
        window.addEventListener('beforeunload', () => sendPresence('offline'))

        return () => {
            mounted = false
            window.clearInterval(heartbeat)
            document.removeEventListener('visibilitychange', handleVisibility)
            sendPresence('offline')
        }
    }, [resolvedHandle, resolvedUserId])

    async function handleSend() {
        const trimmed = draft.trim()
        if ((!trimmed && pendingAttachments.length === 0) || !activeChat) return

        if (editingMessageId) {
            const existing = (messagesByChat[activeChatId] || []).find(msg => msg.id === editingMessageId)
            if (!existing) return
            const updatedMessage = { ...existing, body: trimmed, editedAt: new Date().toISOString() }
            updateMessage(activeChatId, editingMessageId, () => updatedMessage)
            setChats(prev => prev.map(chat => (
                chat.id === activeChatId ? { ...chat, lastMessage: trimmed } : chat
            )))
            try {
                await updateChatMessage(activeChatId, updatedMessage)
            } catch (err) {
                setServerError(err instanceof Error ? err.message : String(err))
            }
            setDraft('')
            setEditingMessageId(null)
            setPendingAttachments([])
            return
        }

        try {
            const sent = await sendChatMessage({
                chatId: activeChatId,
                body: trimmed || '(attachment)',
                author: resolvedHandle,
                replyToId: replyToId || undefined,
                attachments: pendingAttachments.length ? pendingAttachments : undefined
            })

            appendMessage(activeChatId, { ...sent, status: sent.status || 'sent' })

            setChats(prev => prev.map(chat => (
                chat.id === activeChatId ? { ...chat, lastMessage: sent.body, unreadCount: 0 } : chat
            )))

            sendTypingSignal(activeChatId, resolvedUserId, false).catch(() => undefined)
            setDraft('')
            setReplyToId(null)
            setPendingAttachments([])
        } catch (err) {
            setServerError(err instanceof Error ? err.message : String(err))
        }
    }

    function handleSelectChat(chatId: string) {
        setActiveChatId(chatId)
        setChats(prev => prev.map(chat => (
            chat.id === chatId ? { ...chat, unreadCount: 0 } : chat
        )))
        setReplyToId(null)
        setEditingMessageId(null)
        setPendingAttachments([])
    }

    function handleDraftKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    function handleDraftChange(value: string) {
        setDraft(value)
        if (!activeChatId) return
        sendTypingSignal(activeChatId, resolvedUserId, true).catch(() => undefined)

        if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current)
        typingTimerRef.current = window.setTimeout(() => {
            sendTypingSignal(activeChatId, resolvedUserId, false).catch(() => undefined)
        }, 1600)
    }

    function renderPresence(presence?: Chat['presence']) {
        const base = 'inline-block w-2 h-2 rounded-full'
        if (presence === 'online') return <span className={`${base} bg-emerald-400`} />
        if (presence === 'away') return <span className={`${base} bg-amber-400`} />
        return <span className={`${base} bg-zinc-500`} />
    }

    function updateHandle(next: string) {
        const trimmed = next.trim()
        if (!trimmed) return
        localStorage.setItem('zynqchat_handle', trimmed)
        setCustomHandle(trimmed)
    }

    function handleSetHandle() {
        const next = window.prompt('Set your ZynqChat handle', resolvedHandle)
        if (next) updateHandle(next)
    }

    function normalizeHandle(value: string): string {
        return value.replace(/^@/, '').trim().toLowerCase()
    }

    function formatHandle(value: string): string {
        const trimmed = value.trim()
        if (!trimmed) return ''
        return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
    }

    function getDmPeerFromChatId(chatId: string, selfId: string): string | null {
        if (!chatId.startsWith('dm:')) return null
        const parts = chatId.split(':').slice(1)
        if (parts.length < 2) return null
        const normalizedSelf = normalizeHandle(selfId)
        const peer = parts.find(part => normalizeHandle(part) !== normalizedSelf)
        return peer || null
    }

    function buildDmChatId(userA: string, userB: string): string {
        const pair = [normalizeHandle(userA), normalizeHandle(userB)].sort()
        return `dm:${pair[0]}:${pair[1]}`
    }

    function handleNewChat() {
        const target = window.prompt('Start chat with GitHub username or handle')
        if (!target) return
        const chatId = buildDmChatId(resolvedUserId, target)
        const exists = chats.some(chat => chat.id === chatId)
        if (!exists) {
            setChats(prev => ([
                { id: chatId, name: normalizeHandle(target), kind: 'dm', presence: 'offline' },
                ...prev
            ]))
        }
        setActiveChatId(chatId)
    }

    function formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`
        const kb = bytes / 1024
        if (kb < 1024) return `${kb.toFixed(1)} KB`
        return `${(kb / 1024).toFixed(1)} MB`
    }

    function sanitizeFileName(name: string): string {
        return name.replace(/[^a-zA-Z0-9._-]/g, '_')
    }

    function formatMessageTime(message: Message): string {
        if (message.createdAt) {
            return new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
        return message.timestamp || ''
    }

    function bytesToBase64(bytes: Uint8Array): string {
        let binary = ''
        const chunkSize = 0x8000
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
        }
        return btoa(binary)
    }

    async function handleAttachmentChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files || [])
        if (!files.length) return
        e.target.value = ''

        if (!activeChatId) {
            setServerError('Select a chat before attaching files')
            return
        }

        const next: Attachment[] = []
        for (const file of files) {
            if (file.size > MAX_ATTACHMENT_BYTES) {
                setStoreError(`Attachment too large: ${file.name}`)
                continue
            }

            const bytes = new Uint8Array(await file.arrayBuffer())
            const safeName = sanitizeFileName(file.name || 'attachment')
            const stamp = Date.now()
            const vfsPath = `/home/.zynqchat/attachments/${stamp}-${safeName}`
            await writeFile(vfsPath, bytes)
            try {
                const serverAttachment = await uploadChatAttachment({
                    chatId: activeChatId,
                    name: file.name,
                    mimeType: file.type || 'application/octet-stream',
                    size: file.size,
                    base64: bytesToBase64(bytes)
                })
                next.push({
                    ...serverAttachment,
                    vfsPath
                })
            } catch (err) {
                setServerError(err instanceof Error ? err.message : String(err))
                next.push({
                    id: `att-${stamp}-${Math.random().toString(36).slice(2)}`,
                    name: file.name,
                    mimeType: file.type || 'application/octet-stream',
                    size: file.size,
                    vfsPath
                })
            }
        }

        setPendingAttachments(prev => [...prev, ...next])
    }

    async function downloadAttachment(att: Attachment) {
        if (att.downloadUrl) {
            const res = await fetch(att.downloadUrl, { credentials: 'include' })
            if (!res.ok) {
                setServerError('Failed to download attachment')
                return
            }
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = att.name
            document.body.appendChild(link)
            link.click()
            link.remove()
            URL.revokeObjectURL(url)
            return
        }
        await downloadFile(att.vfsPath, att.name)
    }

    function handleRemovePendingAttachment(attachmentId: string) {
        setPendingAttachments(prev => prev.filter(att => att.id !== attachmentId))
    }

    function updateMessage(chatId: string, messageId: string, updater: (message: Message) => Message) {
        setMessagesByChat(prev => {
            const existing = prev[chatId] || []
            const index = existing.findIndex(msg => msg.id === messageId)
            if (index < 0) return prev
            const next = [...existing]
            next[index] = updater(existing[index])
            return { ...prev, [chatId]: next }
        })
    }

    function appendMessage(chatId: string, message: Message) {
        setMessagesByChat(prev => {
            const existing = prev[chatId] || []
            if (existing.some(msg => msg.id === message.id)) return prev
            return { ...prev, [chatId]: [...existing, message] }
        })
    }

    function handleReply(messageId: string) {
        setReplyToId(messageId)
        setEditingMessageId(null)
    }

    function handleEdit(messageId: string, body: string) {
        setEditingMessageId(messageId)
        setReplyToId(null)
        setDraft(body)
        setPendingAttachments([])
    }

    async function handleDelete(messageId: string) {
        const existing = activeMessages.find(msg => msg.id === messageId)
        if (!existing) return
        const updated = {
            ...existing,
            body: '',
            deletedAt: new Date().toISOString(),
            reactions: {},
            attachments: []
        }
        updateMessage(activeChatId, messageId, () => updated)
        try {
            await updateChatMessage(activeChatId, updated)
        } catch (err) {
            setServerError(err instanceof Error ? err.message : String(err))
        }
    }

    function handleQuote(messageId: string) {
        const existing = activeMessages.find(msg => msg.id === messageId)
        if (!existing) return
        const quoted = existing.body || 'Message deleted'
        setDraft(prev => `> ${existing.author}: ${quoted}\n${prev ? `\n${prev}` : ''}`)
        setEditingMessageId(null)
    }

    async function handleTogglePin(messageId: string) {
        const existing = activeMessages.find(msg => msg.id === messageId)
        if (!existing) return
        const updated = { ...existing, pinned: !existing.pinned }
        updateMessage(activeChatId, messageId, () => updated)
        try {
            await updateChatMessage(activeChatId, updated)
        } catch (err) {
            setServerError(err instanceof Error ? err.message : String(err))
        }
    }

    async function handleReaction(messageId: string, reaction: string) {
        const existing = activeMessages.find(msg => msg.id === messageId)
        if (!existing) return
        const current = existing.reactions || {}
        const hasMine = (current[reaction] || []).includes(resolvedHandle)
        const nextReactions: Record<string, string[]> = {}

        for (const [key, users] of Object.entries(current)) {
            const filtered = users.filter(user => user !== resolvedHandle)
            if (filtered.length) nextReactions[key] = filtered
        }

        if (!hasMine) {
            const nextUsers = [...(nextReactions[reaction] || []), resolvedHandle]
            nextReactions[reaction] = nextUsers
        }
        const updated = { ...existing, reactions: nextReactions }
        updateMessage(activeChatId, messageId, () => updated)
        try {
            await updateChatMessage(activeChatId, updated)
        } catch (err) {
            setServerError(err instanceof Error ? err.message : String(err))
        }
    }

    return (
        <div className="h-full w-full bg-[#0b0c0f] text-slate-100 flex overflow-hidden">
            <div className="w-72 min-w-[280px] border-r border-[#1f242c] bg-[#0d1117] flex flex-col">
                <div className="px-4 py-3 border-b border-[#1f242c] flex items-center gap-2">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500/30 via-blue-600/30 to-indigo-600/30 flex items-center justify-center border border-cyan-500/30">
                        <i className="fa-solid fa-comments text-cyan-200"></i>
                    </div>
                    <div>
                        <div className="text-sm font-semibold">ZynqChat</div>
                    </div>
                    <div className="ml-auto flex flex-col items-end gap-1">
                        <div className="text-[16px] text-slate-400">@{resolvedHandle || 'you'}
                            <button className="text-slate-500 hover:text-slate-200" onClick={handleSetHandle}>&nbsp;<i className="fas fa-edit"></i></button></div>
                    </div>
                </div>

                <div className="px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <i className="fa fa-search text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"></i>
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search chats"
                                className="w-full bg-[#0b0f15] border border-[#1f242c] rounded-lg text-sm pl-9 pr-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
                            />
                        </div>
                        <button
                            className="h-9 w-9 flex items-center justify-center rounded-md border border-[#1f242c] text-slate-500 hover:text-slate-200 hover:border-cyan-500/50"
                            onClick={handleNewChat}
                            title="New chat"
                        >
                            <i className="fa-solid fa-plus"></i>
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto scrollbar px-2 pb-4">
                    <div className="px-2 pt-2 pb-1 text-xs uppercase tracking-wider text-slate-500">Direct</div>
                    <div className="space-y-1">
                        {directChats.map(chat => (
                            <button
                                key={chat.id}
                                onClick={() => handleSelectChat(chat.id)}
                                className={`w-full text-left px-3 py-2 rounded-lg border ${activeChatId === chat.id ? 'bg-[#131a24] border-cyan-500/30' : 'border-transparent hover:bg-[#11161f]'}`}
                            >
                                <div className="flex items-center gap-2">
                                    {renderPresence(chat.presence)}
                                    <div className="text-sm font-medium">@{chat.name}</div>
                                    {chat.unreadCount ? (
                                        <span className="ml-auto text-xs bg-cyan-600/30 text-cyan-200 px-2 py-0.5 rounded-full">{chat.unreadCount}</span>
                                    ) : null}
                                </div>
                                <div className="text-xs text-slate-500 truncate">{chat.lastMessage || 'No messages yet'}</div>
                            </button>
                        ))}
                        {!directChats.length && (
                            <div className="px-3 py-3 text-xs text-slate-500">No direct chats yet.</div>
                        )}
                    </div>

                    <div className="px-2 pt-4 pb-1 text-xs uppercase tracking-wider text-slate-500">Groups</div>
                    <div className="space-y-1">
                        {groupChats.map(chat => (
                            <button
                                key={chat.id}
                                onClick={() => handleSelectChat(chat.id)}
                                className={`w-full text-left px-3 py-2 rounded-lg border ${activeChatId === chat.id ? 'bg-[#131a24] border-cyan-500/30' : 'border-transparent hover:bg-[#11161f]'}`}
                            >
                                <div className="flex items-center gap-2">
                                    <i className="fa-solid fa-user-group text-slate-500"></i>
                                    <div className="text-sm font-medium">{chat.name}</div>
                                    {chat.members ? (
                                        <span className="ml-auto text-xs text-slate-500">{chat.members}</span>
                                    ) : null}
                                </div>
                                <div className="text-xs text-slate-500 truncate">{chat.lastMessage || 'No messages yet'}</div>
                            </button>
                        ))}
                        {!groupChats.length && (
                            <div className="px-3 py-3 text-xs text-slate-500">No group chats yet.</div>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0">
                <div className="px-5 py-4 border-b border-[#1f242c] flex items-center gap-3 bg-[#0e1218]">
                    <div className="w-10 h-10 rounded-lg bg-[#151b24] border border-[#1f242c] flex items-center justify-center">
                        {activeChat?.kind === 'group' ? (
                            <i className="fa-solid fa-user-group text-slate-300"></i>
                        ) : (
                            <i className="fa-solid fa-user text-slate-300"></i>
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{activeChat ? (activeChat.kind === 'dm' ? `@${activeChat.name}` : activeChat.name) : 'Select a chat'}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-2">
                            <span>
                                {activeChat?.kind === 'dm' ? `Status: ${activeChat.presence || 'offline'}` : `${activeChat?.members || 0} members`}
                            </span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${realtimeStatus === 'open' ? 'border-emerald-500/30 text-emerald-300' : realtimeStatus === 'connecting' ? 'border-amber-500/30 text-amber-300' : 'border-rose-500/30 text-rose-300'}`}>
                                {realtimeStatus === 'open' ? 'Realtime' : realtimeStatus === 'connecting' ? 'Reconnecting' : 'Offline'}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-slate-400">
                        <button className="p-2 rounded hover:bg-[#141b24]" title="Search">
                            <i className="fa fa-search"></i>
                        </button>
                        <button className="p-2 rounded hover:bg-[#141b24]" title="Pin">
                            <i className="fa fa-thumbtack"></i>
                        </button>
                        <button className="p-2 rounded hover:bg-[#141b24]" title="Info">
                            <i className="fa fa-circle-info"></i>
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto scrollbar px-6 py-5 space-y-4 bg-[#0b0f15]">
                    {loading && (
                        <div className="text-sm text-slate-400">Loading chat history...</div>
                    )}
                    {storeError && (
                        <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                            Storage warning: {storeError}
                        </div>
                    )}
                    {serverError && (
                        <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                            Server warning: {serverError}
                        </div>
                    )}
                    {isSyncing && (
                        <div className="text-xs text-slate-500">Syncing with server...</div>
                    )}
                    {!activeChat && (
                        <div className="text-sm text-slate-500">Start a chat to see messages here.</div>
                    )}
                    {activeMessages.map(message => {
                        const isMine = message.author === resolvedHandle || message.author === 'You'
                        const replyMessage = message.replyToId ? activeMessages.find(msg => msg.id === message.replyToId) : null
                        const reactionEntries = Object.entries(message.reactions || {})
                        const attachmentItems = message.attachments || []
                        const imageAttachments = attachmentItems.filter(att => att.mimeType?.startsWith('image/'))
                        const fileAttachments = attachmentItems.filter(att => !att.mimeType?.startsWith('image/'))
                        const isDeleted = Boolean(message.deletedAt)
                        const isAttachmentOnly = !isDeleted && attachmentItems.length > 0 && (message.body || '').trim() === '(attachment)'
                        const linkPreviews = message.linkPreviews || []
                        const timeLabel = formatMessageTime(message)
                        const deliveryLabel = isDeleted
                            ? 'deleted'
                            : (isMine ? (message.status || 'sent') : (message.status || ''))
                        return (
                            <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[70%] rounded-2xl text-sm border group ${isMine ? 'bg-cyan-600/20 border-cyan-500/30' : 'bg-[#131a24] border-[#1f242c]'} ${isAttachmentOnly ? 'px-2 py-2 w-fit' : 'px-4 py-3'}`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        {!isMine ? (
                                            <div className="text-xs text-slate-400">{formatHandle(message.author)}</div>
                                        ) : (
                                            <div className="text-xs text-slate-400">You</div>
                                        )}
                                        <div className="ml-auto relative">
                                            <button
                                                className="px-2 py-1 rounded hover:bg-[#141b24] text-slate-400 hover:text-slate-200"
                                                onClick={(event) => {
                                                    event.stopPropagation()
                                                    setOpenActionMessageId(prev => (prev === message.id ? null : message.id))
                                                }}
                                                title="Message actions"
                                            >
                                                <i className="fa-solid fa-caret-down"></i>
                                            </button>
                                            {openActionMessageId === message.id ? (
                                                <div
                                                    className={`absolute mt-2 w-45 rounded-lg border border-[#263040] bg-[#0e1218] shadow-lg text-xs text-slate-200 z-10 ${isMine ? 'right-0' : 'left-0'}`}
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <div className="flex gap-0 overflow-x">
                                                        <button className="w-full text-left px-1 py-2 hover:bg-[#141b24]" onClick={() => handleReaction(message.id, '👍')}>👍</button>
                                                        <button className="w-full text-left px-1 py-2 hover:bg-[#141b24]" onClick={() => handleReaction(message.id, '😂')}>😂</button>
                                                        <button className="w-full text-left px-1 py-2 hover:bg-[#141b24]" onClick={() => handleReaction(message.id, '😝')}>😝</button>
                                                        <button className="w-full text-left px-1 py-2 hover:bg-[#141b24]" onClick={() => handleReaction(message.id, '😭')}>😭</button>
                                                        <button className="w-full text-left px-1 py-2 hover:bg-[#141b24]" onClick={() => handleReaction(message.id, '💓')}>💓</button>
                                                        <button className="w-full text-left px-1 py-2 hover:bg-[#141b24]" onClick={() => handleReaction(message.id, '🥹')}>🥹</button>
                                                        <button className="w-full text-left px-1 py-2 hover:bg-[#141b24]" onClick={() => handleReaction(message.id, '😨')}>😨</button>
                                                    </div>
                                                    <div className="border-b border-[#1f242c]" />
                                                    <button className="w-full text-left px-3 py-2 hover:bg-[#141b24]" onClick={() => handleReply(message.id)}>Reply</button>
                                                    <button className="w-full text-left px-3 py-2 hover:bg-[#141b24]" onClick={() => handleQuote(message.id)}>Quote</button>
                                                    {isMine ? (
                                                        <button className="w-full text-left px-3 py-2 hover:bg-[#141b24]" onClick={() => handleEdit(message.id, message.body)}>Edit</button>
                                                    ) : null}
                                                    {isMine ? (
                                                        <button className="w-full text-left px-3 py-2 hover:bg-[#141b24]" onClick={() => handleDelete(message.id)}>Delete</button>
                                                    ) : null}
                                                    <button className="w-full text-left px-3 py-2 hover:bg-[#141b24]" onClick={() => handleTogglePin(message.id)}>{message.pinned ? 'Unpin' : 'Pin'}</button>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                    {replyMessage && (
                                        <div className="text-[11px] text-slate-400 border-l-2 border-cyan-500/40 pl-2 mb-2">
                                            <span className="uppercase text-[10px] text-slate-500">Replying to {replyMessage.author}</span>
                                            <div className="truncate">{replyMessage.body || 'Message deleted'}</div>
                                        </div>
                                    )}
                                    {isDeleted ? (
                                        <div className="whitespace-pre-wrap break-words text-slate-500 italic">
                                            Message deleted
                                        </div>
                                    ) : (!isAttachmentOnly && message.body ? (
                                        <div className="whitespace-pre-wrap break-words text-slate-100">
                                            {message.body}
                                        </div>
                                    ) : null)}
                                    {!isDeleted && attachmentItems.length ? (
                                        <div className={`${isAttachmentOnly ? 'mt-1' : 'mt-2'} space-y-2`}>
                                            {imageAttachments.length ? (
                                                <div className={`${isAttachmentOnly ? 'inline-grid grid-cols-1' : 'grid grid-cols-2'} gap-2`}>
                                                    {imageAttachments.map(att => {
                                                        const preview = attachmentPreviews[att.id]
                                                        return (
                                                            <button
                                                                key={att.id}
                                                                className="group relative overflow-hidden rounded-lg border border-[#263040] hover:border-cyan-500/50"
                                                                onClick={() => downloadAttachment(att)}
                                                                title={att.name}
                                                            >
                                                                {preview ? (
                                                                    <img
                                                                        src={preview}
                                                                        alt={att.name}
                                                                        className={`${isAttachmentOnly ? 'h-32 w-auto max-w-[260px]' : 'h-32 w-full'} object-cover`}
                                                                        loading="lazy"
                                                                    />
                                                                ) : (
                                                                    <div className={`${isAttachmentOnly ? 'h-32 w-56' : 'h-32 w-full'} flex items-center justify-center text-xs text-slate-400`}>
                                                                        Loading image...
                                                                    </div>
                                                                )}
                                                                <div className="absolute inset-x-0 bottom-0 bg-black/50 text-[10px] text-slate-200 px-2 py-1 opacity-0 group-hover:opacity-100 transition">
                                                                    {att.name}
                                                                </div>
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            ) : null}
                                            {fileAttachments.length ? (
                                                <div className="flex flex-wrap gap-2">
                                                    {fileAttachments.map(att => (
                                                        <button
                                                            key={att.id}
                                                            className="flex items-center gap-2 px-2 py-1 rounded border border-[#263040] text-xs text-slate-300 hover:border-cyan-500/50"
                                                            onClick={() => downloadAttachment(att)}
                                                        >
                                                            <i className="fa fa-paperclip"></i>
                                                            <span className="truncate max-w-[160px]">{att.name}</span>
                                                            <span className="text-[10px] text-slate-500">{formatBytes(att.size)}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : null}
                                    {!isDeleted && linkPreviews.length ? (
                                        <div className="mt-3 space-y-2">
                                            {linkPreviews.map(preview => (
                                                <a
                                                    key={preview.url}
                                                    href={preview.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="block border border-[#263040] rounded-lg overflow-hidden hover:border-cyan-500/50"
                                                >
                                                    {preview.image ? (
                                                        <img src={preview.image} alt={preview.title || preview.url} className="w-full max-h-40 object-cover" />
                                                    ) : null}
                                                    <div className="p-3 bg-[#0e1218]">
                                                        <div className="text-xs text-slate-400 truncate">{preview.url}</div>
                                                        {preview.title ? <div className="text-sm text-slate-100 mt-1">{preview.title}</div> : null}
                                                        {preview.description ? <div className="text-xs text-slate-500 mt-1">{preview.description}</div> : null}
                                                    </div>
                                                </a>
                                            ))}
                                        </div>
                                    ) : null}
                                    <div className="text-[10px] text-slate-500 mt-2 flex flex-wrap items-center gap-2">
                                        <span>{timeLabel}</span>
                                        {message.editedAt ? <span>edited</span> : null}
                                        {message.pinned ? <span>pinned</span> : null}
                                        {deliveryLabel ? <span className="uppercase">{deliveryLabel}</span> : null}
                                        {!isDeleted && reactionEntries.length ? (
                                            <div className="flex flex-wrap gap-2">
                                                {reactionEntries.map(([reaction, users]) => (
                                                    <button
                                                        key={reaction}
                                                        onClick={() => handleReaction(message.id, reaction)}
                                                        className={`text-[11px] px-2 py-0.5 rounded-full border ${users.includes('You') ? 'border-cyan-500/50 text-cyan-200' : 'border-[#263040] text-slate-400'}`}
                                                    >
                                                        {reaction} {users.length}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                    {typingByChat[activeChatId]?.length ? (
                        <div className="text-xs text-slate-500">
                            {typingByChat[activeChatId]
                                .slice(0, 2)
                                .map(name => formatHandle(name || ''))
                                .join(', ')}{typingByChat[activeChatId].length > 2 ? ' and others' : ''} typing...
                        </div>
                    ) : null}
                    <div ref={messagesEndRef} />
                </div>

                <div className="border-t border-[#1f242c] bg-[#0e1218] px-5 py-4">
                    {(replyToId || editingMessageId) && (
                        <div className="mb-2 text-xs text-slate-400 border border-[#1f242c] rounded-lg px-3 py-2 flex items-center gap-2">
                            <span>
                                {editingMessageId ? 'Editing message' : replyTarget ? `Replying to ${replyTarget.author}` : 'Replying'}
                            </span>
                            <button
                                className="ml-auto text-slate-500 hover:text-slate-200"
                                onClick={() => {
                                    setReplyToId(null)
                                    setEditingMessageId(null)
                                    if (editingMessageId) setDraft('')
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                    {pendingAttachments.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2">
                            {pendingAttachments.map(att => (
                                <div key={att.id} className="flex items-center gap-2 px-2 py-1 rounded border border-[#263040] text-xs text-slate-300">
                                    <i className={att.mimeType.startsWith('image/') ? 'fa fa-image' : 'fa fa-paperclip'}></i>
                                    <span className="truncate max-w-[160px]">{att.name}</span>
                                    <span className="text-[10px] text-slate-500">{formatBytes(att.size)}</span>
                                    <button className="text-slate-500 hover:text-slate-200" onClick={() => handleRemovePendingAttachment(att.id)}>
                                        Remove
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="zynqchat-message-box">
                        <label className="zynqchat-file-upload" title="Attach">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 337 337" aria-hidden="true">
                                <circle strokeWidth="20" stroke="#6c6c6c" fill="none" r="158.5" cy="168.5" cx="168.5"></circle>
                                <path strokeLinecap="round" strokeWidth="25" stroke="#6c6c6c" d="M167.759 79V259"></path>
                                <path strokeLinecap="round" strokeWidth="25" stroke="#6c6c6c" d="M79 167.138H259"></path>
                            </svg>
                            <span className="zynqchat-tooltip">Add an image</span>
                            <input
                                ref={attachmentInputRef}
                                type="file"
                                multiple
                                className="zynqchat-file-input"
                                onChange={handleAttachmentChange}
                                disabled={!activeChat}
                            />
                        </label>
                        <textarea
                            value={draft}
                            onChange={(e) => handleDraftChange(e.target.value)}
                            onKeyDown={handleDraftKeyDown}
                            placeholder="Message..."
                            rows={1}
                            disabled={!activeChat}
                            className="zynqchat-message-input"
                        />
                        <button
                            onClick={handleSend}
                            disabled={!activeChat || (!draft.trim() && pendingAttachments.length === 0)}
                            className="zynqchat-send-button"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 664 663" aria-hidden="true">
                                <path fill="none" d="M646.293 331.888L17.7538 17.6187L155.245 331.888M646.293 331.888L17.753 646.157L155.245 331.888M646.293 331.888L318.735 330.228L155.245 331.888"></path>
                                <path strokeLinejoin="round" strokeLinecap="round" strokeWidth="33.67" stroke="#6c6c6c" d="M646.293 331.888L17.7538 17.6187L155.245 331.888M646.293 331.888L17.753 646.157L155.245 331.888M646.293 331.888L318.735 330.228L155.245 331.888"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

window.__ZYNQCHAT_UI__ = ZynqChatUI
