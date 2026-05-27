// Wednesday AI Assistant - ZynqOS AI Assistant App
import React, { useState, useRef, useEffect } from 'react'
import { terminalBridge, isTerminalCommand } from './terminalBridge'

interface Message {
  id: string
  type: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
}

export default function WednesdayUI() {
  const [command, setCommand] = useState('')
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', type: 'system', content: 'Wednesday initialized. How can I help you today? (Configure API keys in settings to use AI models)', timestamp: new Date() }
  ])
  const [currentDir, setCurrentDir] = useState<string>('~')
  const [showSettings, setShowSettings] = useState(false)
  
  const [apiKeys, setApiKeys] = useState(() => {
    try {
      const stored = localStorage.getItem('wednesday_api_keys')
      return stored ? JSON.parse(stored) : { openai: '', gemini: '', anthropic: '', groq: '', ollamaUrl: 'http://localhost:11434' }
    } catch {
      return { openai: '', gemini: '', anthropic: '', groq: '', ollamaUrl: 'http://localhost:11434' }
    }
  })
  
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('wednesday_selected_model') || 'gemini'
  })

  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { inputRef.current?.focus() }, [])

  function saveSettings(keys: any, model: string) {
    setApiKeys(keys)
    setSelectedModel(model)
    localStorage.setItem('wednesday_api_keys', JSON.stringify(keys))
    localStorage.setItem('wednesday_selected_model', model)
    setShowSettings(false)
  }


  function updateDirectoryOnCommand(cmdLine: string, terminalOutput?: string) {
    const trimmed = cmdLine.trim(); if (!trimmed) return
    const parts = trimmed.split(/\s+/); const cmd = parts[0]
    if (cmd === 'cd') {
      const arg = parts[1]
      if (!arg || arg === '~' || arg === '/') { setCurrentDir('~'); return }
      if (arg === '..') { if (currentDir === '~') return; const segs = currentDir.replace(/^~\/?/, '').split('/').filter(Boolean); segs.pop(); setCurrentDir(segs.length ? '~/' + segs.join('/') : '~'); return }
      if (arg.startsWith('/')) { const abs = arg.replace(/^\/+/, ''); setCurrentDir(abs ? '~/' + abs : '~') } else { setCurrentDir(currentDir === '~' ? `~/${arg}` : `${currentDir}/${arg}`) }
      return
    }
    if (cmd === 'pwd' && terminalOutput) {
      const out = terminalOutput.trim(); if (!out) return
      if (out === '/' || out === '~') { setCurrentDir('~'); return }
      if (out.startsWith('/')) { const norm = out.slice(1); setCurrentDir(norm ? '~/' + norm : '~') } else { setCurrentDir(out.startsWith('~') ? out : '~/' + out) }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); if (!command.trim()) return
    const userMsg: Message = { id: Date.now().toString(), type: 'user', content: command, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    const currentCommand = command; setCommand('')
    if (isTerminalCommand(currentCommand)) {
      try {
        const result = await terminalBridge.executeCommand(currentCommand)
        updateDirectoryOnCommand(currentCommand, result.output)
        const assistantMsg: Message = { id: (Date.now() + 1).toString(), type: 'assistant', content: result.output || '(No output)', timestamp: new Date() }
        setMessages(prev => [...prev, assistantMsg])
      } catch (err) {
        const errorMsg: Message = { id: (Date.now() + 1).toString(), type: 'system', content: 'Error executing command: ' + String(err), timestamp: new Date() }
        setMessages(prev => [...prev, errorMsg])
      }
    } else {
      const placeholderId = (Date.now() + 1).toString()
      setMessages(prev => [...prev, { id: placeholderId, type: 'assistant', content: 'Thinking...', timestamp: new Date() }])

      try {
        let aiResponseText = ''
        
        async function fetchWithDetails(url: string, options: RequestInit, provider: string) {
          const res = await fetch(url, options)
          if (!res.ok) {
            let msg = `${res.status} ${res.statusText}`
            try {
              const errBody = await res.json()
              if (errBody.error && errBody.error.message) msg += ` - ${errBody.error.message}`
              else if (errBody.error) msg += ` - ${JSON.stringify(errBody.error)}`
            } catch {
              try { msg += ` - ${await res.text()}` } catch {}
            }
            throw new Error(`${provider} API Error: ${msg}`)
          }
          return res.json()
        }

        if (selectedModel === 'groq' && apiKeys.groq) {
          const data = await fetchWithDetails('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKeys.groq}` },
            body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: currentCommand }] })
          }, 'Groq')
          aiResponseText = data.choices[0].message.content
        } else if (selectedModel === 'gemini' && apiKeys.gemini) {
          const data = await fetchWithDetails(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKeys.gemini}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: currentCommand }] }] })
          }, 'Gemini')
          aiResponseText = data.candidates[0].content.parts[0].text
        } else if (selectedModel === 'openai' && apiKeys.openai) {
          const data = await fetchWithDetails('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKeys.openai}` },
            body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: currentCommand }] })
          }, 'OpenAI')
          aiResponseText = data.choices[0].message.content
        } else if (selectedModel === 'anthropic' && apiKeys.anthropic) {
          const data = await fetchWithDetails('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKeys.anthropic, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
            body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1024, messages: [{ role: 'user', content: currentCommand }] })
          }, 'Anthropic')
          aiResponseText = data.content[0].text
        } else if (selectedModel === 'ollama') {
          const baseUrl = apiKeys.ollamaUrl.replace(/\/$/, '')
          const data = await fetchWithDetails(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama3', prompt: currentCommand, stream: false })
          }, 'Ollama')
          aiResponseText = data.response
        } else {
          aiResponseText = `No API key found for selected model (${selectedModel}). Please open settings to configure.`
        }

        setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, content: aiResponseText } : m))
      } catch (e) {
        setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, content: `Error: ${(e as Error).message}` } : m))
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e as any) }
  function focusInput() { inputRef.current?.focus() }

  function insertAtSign() {
    const el = inputRef.current; if (!el) return
    const start = el.selectionStart ?? command.length; const end = el.selectionEnd ?? command.length
    const newValue = command.slice(0, start) + '@' + command.slice(end)
    setCommand(newValue)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + 1, start + 1) })
  }

  function handleImageClick() { fileInputRef.current?.click() }
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (file) { const fileMsg: Message = { id: Date.now().toString(), type: 'system', content: `📎 Attached file: ${file.name}`, timestamp: new Date() }; setMessages(prev => [...prev, fileMsg]); e.target.value = '' }
  }

  return (
    <div className='h-full bg-[var(--bg-color)] text-[var(--text-color)] flex flex-col font-mono overflow-hidden relative'>
      {showSettings && (
        <div className='absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm'>
          <div className='bg-[var(--bg-color)] border border-[var(--border-color)] rounded-lg p-6 w-full max-w-md shadow-2xl space-y-4'>
            <div className='flex justify-between items-center border-b border-[var(--border-color)] pb-2'>
              <h2 className='text-lg font-bold text-[var(--text-color)] flex items-center gap-2'><i className='fa fa-cog text-blue-500'></i> AI Settings</h2>
              <button onClick={() => setShowSettings(false)} className='text-[var(--text-color)] opacity-50 hover:opacity-100'><i className='fa fa-times'></i></button>
            </div>
            
            <div className='space-y-3'>
              <div>
                <label className='block text-xs text-[var(--text-color)] opacity-70 mb-1'>Primary Model</label>
                <select 
                  value={selectedModel} 
                  onChange={e => setSelectedModel(e.target.value)}
                  className='w-full bg-[var(--taskbar-bg)] border border-[var(--border-color)] rounded p-2 text-sm text-[var(--text-color)] outline-none focus:border-blue-500'
                >
                  <option value='gemini'>Google Gemini</option>
                  <option value='openai'>OpenAI</option>
                  <option value='anthropic'>Anthropic Claude</option>
                  <option value='groq'>Groq</option>
                  <option value='ollama'>Local Ollama</option>
                </select>
              </div>

              {selectedModel === 'openai' && (
                <div>
                  <label className='block text-xs text-[var(--text-color)] opacity-70 mb-1'>OpenAI API Key</label>
                  <input type='password' value={apiKeys.openai} onChange={e => setApiKeys({...apiKeys, openai: e.target.value})} className='w-full bg-[var(--taskbar-bg)] border border-[var(--border-color)] rounded p-2 text-sm text-[var(--text-color)] outline-none focus:border-blue-500' placeholder='sk-...' />
                </div>
              )}

              {selectedModel === 'gemini' && (
                <div>
                  <label className='block text-xs text-[var(--text-color)] opacity-70 mb-1'>Gemini API Key</label>
                  <input type='password' value={apiKeys.gemini} onChange={e => setApiKeys({...apiKeys, gemini: e.target.value})} className='w-full bg-[var(--taskbar-bg)] border border-[var(--border-color)] rounded p-2 text-sm text-[var(--text-color)] outline-none focus:border-blue-500' placeholder='AIza...' />
                </div>
              )}
              
              {selectedModel === 'anthropic' && (
                <div>
                  <label className='block text-xs text-[var(--text-color)] opacity-70 mb-1'>Anthropic API Key</label>
                  <input type='password' value={apiKeys.anthropic} onChange={e => setApiKeys({...apiKeys, anthropic: e.target.value})} className='w-full bg-[var(--taskbar-bg)] border border-[var(--border-color)] rounded p-2 text-sm text-[var(--text-color)] outline-none focus:border-blue-500' placeholder='sk-ant-...' />
                </div>
              )}

              {selectedModel === 'groq' && (
                <div>
                  <label className='block text-xs text-[var(--text-color)] opacity-70 mb-1'>Groq API Key</label>
                  <input type='password' value={apiKeys.groq} onChange={e => setApiKeys({...apiKeys, groq: e.target.value})} className='w-full bg-[var(--taskbar-bg)] border border-[var(--border-color)] rounded p-2 text-sm text-[var(--text-color)] outline-none focus:border-blue-500' placeholder='gsk_...' />
                </div>
              )}

              {selectedModel === 'ollama' && (
                <div>
                  <label className='block text-xs text-[var(--text-color)] opacity-70 mb-1'>Ollama Base URL</label>
                  <input type='text' value={apiKeys.ollamaUrl} onChange={e => setApiKeys({...apiKeys, ollamaUrl: e.target.value})} className='w-full bg-[var(--taskbar-bg)] border border-[var(--border-color)] rounded p-2 text-sm text-[var(--text-color)] outline-none focus:border-blue-500' placeholder='http://localhost:11434' />
                </div>
              )}
            </div>

            <div className='flex justify-end gap-2 pt-2'>
              <button onClick={() => setShowSettings(false)} className='px-4 py-2 text-sm rounded bg-transparent border border-[var(--border-color)] text-[var(--text-color)] hover:bg-gray-500/20 transition-colors'>Cancel</button>
              <button onClick={() => saveSettings(apiKeys, selectedModel)} className='px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors'>Save Settings</button>
            </div>
          </div>
        </div>
      )}
      <div className='flex-1 flex flex-col relative overflow-hidden'>
        {/* Adjusted gradient to use var variables to adapt dynamically if needed */}
        <div className='absolute inset-0 bg-gradient-to-br from-blue-500/5 via-[var(--bg-color)] to-purple-500/5 z-0' />
        <div className='scrollbar flex-1 overflow-y-auto z-10 p-4 space-y-4'>
          {messages.map(m => (
            <div key={m.id} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg p-3 ${
                  m.type === 'user' 
                    ? 'bg-blue-600 text-white' 
                    : m.type === 'system' 
                      ? 'bg-[var(--taskbar-bg)] border border-[var(--border-color)] text-[var(--text-color)] opacity-80 text-sm' 
                      : 'bg-[var(--bg-color)] border border-[var(--border-color)] text-[var(--text-color)]'
                }`}>
                <div className='whitespace-pre-wrap break-words'>{m.content}</div>
                <div className='text-xs opacity-50 mt-1'>{m.timestamp.toLocaleTimeString()}</div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <div className='bg-[var(--bg-color)] border-t border-[var(--border-color)] p-4 pt-2 z-10' onClick={focusInput}>
        <div className='flex flex-col'>
          <div className='flex items-center gap-3 mb-3'>
            <i className='fa fa-folder-open text-[var(--text-color)] opacity-60' />
            <span className='text-sm text-[var(--text-color)]'>{currentDir}</span>
            <span className='text-xs px-2 py-0.5 rounded bg-[var(--taskbar-bg)] text-[var(--text-color)] opacity-80 border border-[var(--border-color)]'>{isTerminalCommand(command) ? 'command' : 'chat'}</span>
            <div className='flex items-center gap-2 ml-auto'>
              <button className='p-1 hover:bg-gray-500/20 rounded' type='button' onClick={() => setShowSettings(true)}>
                <i className='fa fa-cog text-[var(--text-color)] opacity-60 hover:opacity-100 hover:text-blue-500 transition-colors' />
              </button>
              <button className='p-1 hover:bg-gray-500/20 rounded' type='button'>
                <i className='fa fa-microphone text-[var(--text-color)] opacity-60 hover:opacity-100 transition-colors' />
              </button>
              <button className='p-1 hover:bg-gray-500/20 rounded' type='button' onClick={insertAtSign}>
                <i className='fa fa-at text-[var(--text-color)] opacity-60 hover:opacity-100 transition-colors' />
              </button>
              <button className='p-1 hover:bg-gray-500/20 rounded' type='button' onClick={handleImageClick}>
                <i className='fa fa-image text-[var(--text-color)] opacity-60 hover:opacity-100 transition-colors' />
                <input ref={fileInputRef} type='file' className='hidden' onChange={handleFileChange} accept='image/*' />
              </button>
            </div>
          </div>
          <form onSubmit={handleSubmit} className='flex items-center gap-2'>
            <input
              ref={inputRef}
              type='text'
              value={command}
              onChange={e => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='Ask Wednesday or run terminal commands...'
              className='flex-1 bg-transparent text-[var(--text-color)] text-sm outline-none placeholder-gray-500'
            />
            {command && (
              <button type='submit' className='p-1 hover:bg-gray-500/20 rounded text-[var(--text-color)] opacity-60 hover:opacity-100'>
                <i className='fa fa-paper-plane' />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}

// Attach UI for StartMenu to open
; (window as any).__WEDNESDAY_UI__ = WednesdayUI