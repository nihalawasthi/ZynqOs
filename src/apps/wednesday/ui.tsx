// Wednesday AI Assistant - ZynqOS AI Assistant App
// [AI INTEGRATION] — REWRITTEN FILE: Added real Gemini AI chat, streaming, settings panel, markdown rendering
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { terminalBridge, isTerminalCommand } from './terminalBridge'
import { wednesdayAi } from './aiService' // [AI INTEGRATION] — AI service import
import type { StreamCallbacks } from './aiService' // [AI INTEGRATION] — streaming callback types

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  type: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  isStreaming?: boolean
}

type SettingsView = 'chat' | 'settings'

// ── Component ──────────────────────────────────────────────────────────────────

export default function WednesdayUI(): React.JSX.Element {
  const [command, setCommand] = useState<string>('')
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'system',
      content: '🤖 Wednesday initialized. Ask me anything or run terminal commands!\n\n💡 *I work out of the box! For full AI conversations, optionally set a Gemini API key in ⚙ Settings.*',
      timestamp: new Date(),
    },
  ])
  const [currentDir, setCurrentDir] = useState<string>('~')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [view, setView] = useState<SettingsView>('chat')
  const [apiKey, setApiKey] = useState<string>('') // [AI INTEGRATION] — Gemini API key state
  const [apiKeySaved, setApiKeySaved] = useState<boolean>(false) // [AI INTEGRATION] — save confirmation

  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
    // Load saved API key
    const savedKey: string = wednesdayAi.getApiKey()
    if (savedKey) {
      setApiKey(savedKey)
      setApiKeySaved(true)
    }
  }, [])

  // ── Directory tracking ─────────────────────────────────────────────────────

  const updateDirectoryOnCommand = useCallback(
    (cmdLine: string, terminalOutput?: string): void => {
      const trimmed: string = cmdLine.trim()
      if (!trimmed) return

      const parts: string[] = trimmed.split(/\s+/)
      const cmd: string = parts[0]

      if (cmd === 'cd') {
        const arg: string | undefined = parts[1]
        if (!arg || arg === '~' || arg === '/') {
          setCurrentDir('~')
          return
        }
        if (arg === '..') {
          if (currentDir === '~') return
          const segs: string[] = currentDir
            .replace(/^~\/?/, '')
            .split('/')
            .filter(Boolean)
          segs.pop()
          setCurrentDir(segs.length ? '~/' + segs.join('/') : '~')
          return
        }
        if (arg.startsWith('/')) {
          const abs: string = arg.replace(/^\/+/, '')
          setCurrentDir(abs ? '~/' + abs : '~')
        } else {
          setCurrentDir(currentDir === '~' ? `~/${arg}` : `${currentDir}/${arg}`)
        }
        return
      }

      if (cmd === 'pwd' && terminalOutput) {
        const out: string = terminalOutput.trim()
        if (!out) return
        if (out === '/' || out === '~') {
          setCurrentDir('~')
          return
        }
        if (out.startsWith('/')) {
          const norm: string = out.slice(1)
          setCurrentDir(norm ? '~/' + norm : '~')
        } else {
          setCurrentDir(out.startsWith('~') ? out : '~/' + out)
        }
      }
    },
    [currentDir],
  )

  // ── Message helpers ────────────────────────────────────────────────────────

  const addMessage = useCallback(
    (type: Message['type'], content: string, isStreaming?: boolean): string => {
      const id: string = Date.now().toString() + Math.random().toString(36).slice(2)
      const msg: Message = { id, type, content, timestamp: new Date(), isStreaming }
      setMessages((prev) => [...prev, msg])
      return id
    },
    [],
  )

  const updateMessage = useCallback((id: string, content: string, isStreaming?: boolean): void => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content, isStreaming } : m)),
    )
  }, [])

  // ── Submit handler ─────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (e: React.FormEvent): Promise<void> => {
      e.preventDefault()
      const trimmed: string = command.trim()
      if (!trimmed || isLoading) return

      addMessage('user', trimmed)
      setCommand('')

      if (isTerminalCommand(trimmed)) {
        // Terminal command mode
        setIsLoading(true)
        try {
          const result = await terminalBridge.executeCommand(trimmed)
          updateDirectoryOnCommand(trimmed, result.output)
          addMessage('assistant', result.output || '(No output)')
        } catch (err: unknown) {
          const errMsg: string = err instanceof Error ? err.message : String(err)
          addMessage('system', '❌ Error executing command: ' + errMsg)
        } finally {
          setIsLoading(false)
        }
      } else {
        // [AI INTEGRATION] — AI chat mode: sends user message to Gemini with SSE streaming
        setIsLoading(true)
        const assistantId: string = addMessage('assistant', '', true)

        const callbacks: StreamCallbacks = {
          onChunk: (text: string) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + text, isStreaming: true }
                  : m,
              ),
            )
          },
          onDone: (_fullText: string) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, isStreaming: false } : m,
              ),
            )
            setIsLoading(false)
          },
          onError: (error: string) => {
            // If streaming fails, fall back to non-streaming
            handleNonStreamingFallback(trimmed, assistantId).catch(() => {
              updateMessage(assistantId, `⚠️ AI Error: ${error}`)
              setIsLoading(false)
            })
          },
        }

        // Override onChunk to accumulate properly
        const streamCallbacks: StreamCallbacks = {
          onChunk: (text: string) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + text, isStreaming: true }
                  : m,
              ),
            )
          },
          onDone: callbacks.onDone,
          onError: callbacks.onError,
        }

        abortRef.current = wednesdayAi.sendMessageStreaming(trimmed, streamCallbacks)
      }
    },
    [command, isLoading, addMessage, updateMessage, updateDirectoryOnCommand],
  )

  /** Non-streaming fallback when SSE streaming is unavailable */
  const handleNonStreamingFallback = useCallback(
    async (userMessage: string, assistantMsgId: string): Promise<void> => {
      // Clear history to avoid duplicating the user message (already added by streaming attempt)
      // Just call the non-streaming endpoint with the history already in place
      try {
        const response = await wednesdayAi.sendMessage(userMessage)
        if (response.error) {
          updateMessage(
            assistantMsgId,
            `⚠️ ${response.error}\n\n*💡 Make sure you've set a Gemini API key in Settings, or that the server has GEMINI_API_KEY configured.*`,
          )
        } else {
          updateMessage(assistantMsgId, response.reply)
        }
      } catch {
        updateMessage(assistantMsgId, '⚠️ Failed to get AI response. Check your API key or network connection.')
      } finally {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, isStreaming: false } : m,
          ),
        )
        setIsLoading(false)
      }
    },
    [updateMessage],
  )

  // ── Event handlers ─────────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        handleSubmit(e as unknown as React.FormEvent).catch(console.error)
      }
    },
    [handleSubmit],
  )

  const focusInput = useCallback((): void => {
    inputRef.current?.focus()
  }, [])

  const insertAtSign = useCallback((): void => {
    const el: HTMLInputElement | null = inputRef.current
    if (!el) return
    const start: number = el.selectionStart ?? command.length
    const end: number = el.selectionEnd ?? command.length
    const newValue: string = command.slice(0, start) + '@' + command.slice(end)
    setCommand(newValue)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + 1, start + 1)
    })
  }, [command])

  const handleImageClick = useCallback((): void => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      const file: File | undefined = e.target.files?.[0]
      if (file) {
        addMessage('system', `📎 Attached file: ${file.name}`)
        e.target.value = ''
      }
    },
    [addMessage],
  )

  const handleCancelStream = useCallback((): void => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsLoading(false)
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false, content: m.content + '\n\n*(cancelled)*' } : m)),
    )
  }, [])

  const handleClearChat = useCallback((): void => {
    wednesdayAi.clearHistory()
    setMessages([
      {
        id: Date.now().toString(),
        type: 'system',
        content: '🔄 Chat cleared. Conversation history reset.',
        timestamp: new Date(),
      },
    ])
  }, [])

  // [AI INTEGRATION] — Save user's Gemini API key to localStorage via aiService
  const handleSaveApiKey = useCallback((): void => {
    wednesdayAi.setApiKey(apiKey)
    setApiKeySaved(true)
    setTimeout(() => setApiKeySaved(false), 2000)
  }, [apiKey])

  // ── Render helpers ─────────────────────────────────────────────────────────

  /** Simple markdown-like rendering for code blocks and bold text */
  const renderContent = useCallback((content: string): React.JSX.Element => {
    const parts: React.JSX.Element[] = []
    const lines: string[] = content.split('\n')
    let inCodeBlock = false
    let codeContent = ''
    let codeLang = ''
    let blockIndex = 0

    for (let i = 0; i < lines.length; i++) {
      const line: string = lines[i]

      if (line.startsWith('```')) {
        if (inCodeBlock) {
          // End code block
          parts.push(
            <div key={`code-${blockIndex++}`} className="my-2 rounded-lg overflow-hidden">
              {codeLang && (
                <div className="bg-zinc-700 px-3 py-1 text-xs text-zinc-400 font-mono">
                  {codeLang}
                </div>
              )}
              <pre className="bg-zinc-800 p-3 text-sm overflow-x-auto font-mono text-green-400">
                <code>{codeContent}</code>
              </pre>
            </div>,
          )
          codeContent = ''
          codeLang = ''
          inCodeBlock = false
        } else {
          inCodeBlock = true
          codeLang = line.slice(3).trim()
        }
        continue
      }

      if (inCodeBlock) {
        codeContent += (codeContent ? '\n' : '') + line
        continue
      }

      // Inline formatting
      const formatted: string = line
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code class="bg-zinc-700 px-1.5 py-0.5 rounded text-sm font-mono text-emerald-400">$1</code>')

      parts.push(
        <div
          key={`line-${i}`}
          className={line === '' ? 'h-3' : ''}
          dangerouslySetInnerHTML={{ __html: formatted || '&nbsp;' }}
        />,
      )
    }

    // Handle unclosed code block
    if (inCodeBlock && codeContent) {
      parts.push(
        <pre key={`code-${blockIndex}`} className="bg-zinc-800 p-3 text-sm overflow-x-auto rounded-lg font-mono text-green-400 my-2">
          <code>{codeContent}</code>
        </pre>,
      )
    }

    return <>{parts}</>
  }, [])

  // [AI INTEGRATION] — Settings Panel: API key management, model info, actions

  if (view === 'settings') {
    return (
      <div className="h-full bg-black text-white flex flex-col font-mono overflow-hidden">
        <div className="flex-1 flex flex-col relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-black to-blue-900/20 z-0" />
          <div className="flex-1 overflow-y-auto z-10 p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
              <button
                className="p-2 hover:bg-zinc-700 rounded-lg transition-colors"
                onClick={() => setView('chat')}
              >
                <i className="fa fa-arrow-left text-zinc-400" />
              </button>
              <h2 className="text-lg font-semibold text-white">Wednesday Settings</h2>
            </div>

            {/* API Key Section */}
            <div className="bg-zinc-900/80 border border-zinc-700 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <i className="fa fa-key text-purple-400" />
                <h3 className="text-sm font-semibold text-zinc-200">Gemini API Key</h3>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Get a free API key from{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300 underline"
                >
                  Google AI Studio
                </a>
                . Your key is stored locally in your browser and never sent to our servers.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value)
                    setApiKeySaved(false)
                  }}
                  placeholder="AIzaSy..."
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-purple-500 transition-colors"
                />
                <button
                  onClick={handleSaveApiKey}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    apiKeySaved
                      ? 'bg-green-600 text-white'
                      : 'bg-purple-600 hover:bg-purple-500 text-white'
                  }`}
                >
                  {apiKeySaved ? '✓ Saved' : 'Save'}
                </button>
              </div>
              {apiKey && (
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-green-400">
                    Direct mode: AI calls go straight to Gemini (faster, no server needed)
                  </span>
                </div>
              )}
              {!apiKey && (
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-2 h-2 rounded-full bg-yellow-500" />
                  <span className="text-yellow-400">
                    Proxy mode: AI calls go through the server (requires GEMINI_API_KEY env var)
                  </span>
                </div>
              )}
            </div>

            {/* Model Info */}
            <div className="bg-zinc-900/80 border border-zinc-700 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <i className="fa fa-microchip text-blue-400" />
                <h3 className="text-sm font-semibold text-zinc-200">Model</h3>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-zinc-800 rounded-lg p-3">
                  <div className="text-zinc-400">Provider</div>
                  <div className="text-white font-medium mt-1">Google Gemini</div>
                </div>
                <div className="bg-zinc-800 rounded-lg p-3">
                  <div className="text-zinc-400">Model</div>
                  <div className="text-white font-medium mt-1">gemini-2.0-flash</div>
                </div>
                <div className="bg-zinc-800 rounded-lg p-3">
                  <div className="text-zinc-400">Streaming</div>
                  <div className="text-white font-medium mt-1">Enabled (SSE)</div>
                </div>
                <div className="bg-zinc-800 rounded-lg p-3">
                  <div className="text-zinc-400">History</div>
                  <div className="text-white font-medium mt-1">{wednesdayAi.getHistoryLength()} messages</div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="bg-zinc-900/80 border border-zinc-700 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <i className="fa fa-cog text-zinc-400" />
                <h3 className="text-sm font-semibold text-zinc-200">Actions</h3>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleClearChat}
                  className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm transition-colors"
                >
                  🗑 Clear Chat History
                </button>
                <button
                  onClick={() => {
                    setApiKey('')
                    wednesdayAi.setApiKey('')
                  }}
                  className="px-4 py-2 bg-zinc-700 hover:bg-red-600/50 rounded-lg text-sm transition-colors"
                >
                  🔑 Remove API Key
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Chat View ──────────────────────────────────────────────────────────────

  return (
    <div className="h-full bg-black text-white flex flex-col font-mono overflow-hidden">
      <div className="flex-1 flex flex-col relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-black to-blue-900/20 z-0" />

        {/* Header bar */}
        <div className="z-10 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-purple-400">Wednesday</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/50 text-purple-300 border border-purple-700/50">
              AI
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleClearChat}
              className="p-1.5 hover:bg-zinc-700 rounded-lg transition-colors"
              title="Clear chat"
            >
              <i className="fa fa-trash text-xs text-zinc-500 hover:text-zinc-300" />
            </button>
            <button
              onClick={() => setView('settings')}
              className="p-1.5 hover:bg-zinc-700 rounded-lg transition-colors"
              title="Settings"
            >
              <i className="fa fa-cog text-xs text-zinc-500 hover:text-zinc-300" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="scrollbar flex-1 overflow-y-auto z-10 p-4 space-y-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-xl p-3 ${
                  m.type === 'user'
                    ? 'bg-purple-600/80 text-white border border-purple-500/30'
                    : m.type === 'system'
                      ? 'bg-zinc-800/80 text-zinc-300 text-sm border border-zinc-700/50'
                      : 'bg-zinc-900/80 text-white border border-zinc-700/50'
                }`}
              >
                {m.type === 'assistant' ? (
                  <div className="text-sm leading-relaxed">
                    {renderContent(m.content)}
                    {m.isStreaming && (
                      <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-0.5 rounded-sm" />
                    )}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap break-words text-sm">{m.content}</div>
                )}
                <div className="text-[10px] opacity-40 mt-1.5 select-none">
                  {m.timestamp.toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="bg-zinc-900 border-t border-zinc-800 p-4 pt-2 z-10" onClick={focusInput}>
        <div className="flex flex-col">
          <div className="flex items-center gap-3 mb-3">
            <i className="fa fa-folder-open text-zinc-400" />
            <span className="text-sm text-zinc-300">{currentDir}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full border ${
                isTerminalCommand(command)
                  ? 'bg-green-900/30 text-green-400 border-green-700/50'
                  : 'bg-purple-900/30 text-purple-400 border-purple-700/50'
              }`}
            >
              {isTerminalCommand(command) ? '⌘ terminal' : '✨ AI'}
            </span>

            {/* Loading / Cancel button */}
            {isLoading && (
              <button
                onClick={handleCancelStream}
                className="ml-auto text-xs px-2 py-1 rounded bg-red-900/50 text-red-400 border border-red-700/50 hover:bg-red-800/50 transition-colors"
              >
                ■ Stop
              </button>
            )}

            <div className={`flex items-center gap-2 ${isLoading ? '' : 'ml-auto'}`}>
              <button className="p-1 hover:bg-zinc-700 rounded" type="button">
                <i className="fa fa-microphone text-zinc-500 hover:text-zinc-300" />
              </button>
              <button className="p-1 hover:bg-zinc-700 rounded" type="button" onClick={insertAtSign}>
                <i className="fa fa-at text-zinc-500 hover:text-zinc-300" />
              </button>
              <button className="p-1 hover:bg-zinc-700 rounded" type="button" onClick={handleImageClick}>
                <i className="fa fa-image text-zinc-500 hover:text-zinc-300" />
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileChange}
                  accept="image/*"
                />
              </button>
            </div>
          </div>
          <form onSubmit={(e) => { handleSubmit(e).catch(console.error) }} className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isLoading ? 'Wednesday is thinking...' : 'Ask Wednesday or run terminal commands...'}
              disabled={isLoading}
              className="flex-1 bg-transparent text-white text-sm outline-none placeholder-zinc-500 disabled:opacity-50"
            />
            {command && !isLoading && (
              <button type="submit" className="p-1.5 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors">
                <i className="fa fa-paper-plane" />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}

// Attach UI for StartMenu to open
;(window as unknown as Record<string, unknown>).__WEDNESDAY_UI__ = WednesdayUI
