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
    { id: '1', type: 'system', content: 'Wednesday initialized. How can I help you today?', timestamp: new Date() }
  ])
  const [currentDir, setCurrentDir] = useState<string>('~')
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { inputRef.current?.focus() }, [])

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
      const aiPlaceholder: Message = { id: (Date.now() + 1).toString(), type: 'assistant', content: `Processing: ${currentCommand}\n\n(Placeholder AI response – model integration pending)`, timestamp: new Date() }
      setMessages(prev => [...prev, aiPlaceholder])
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
    <div className='h-full bg-black text-white flex flex-col font-mono overflow-hidden'>
      <div className='flex-1 flex flex-col relative overflow-hidden'>
        <div className='absolute inset-0 bg-gradient-to-br from-purple-900/20 via-black to-blue-900/20 z-0' />
        <div className='flex-1 overflow-y-auto z-10 p-4 space-y-4'>
          {messages.map(m => (
            <div key={m.id} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg p-3 ${m.type === 'user' ? 'bg-blue-600 text-white' : m.type === 'system' ? 'bg-zinc-800 text-zinc-300 text-sm' : 'bg-zinc-900 text-white border border-zinc-700'}`}>
                <div className='whitespace-pre-wrap break-words'>{m.content}</div>
                <div className='text-xs opacity-50 mt-1'>{m.timestamp.toLocaleTimeString()}</div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <div className='bg-zinc-900 border-t border-zinc-800 p-4 pt-2 z-10' onClick={focusInput}>
        <div className='flex flex-col'>
          <div className='flex items-center gap-3 mb-3'>
            <i className='fa fa-folder-open text-zinc-400' />
            <span className='text-sm text-zinc-300'>{currentDir}</span>
            <span className='text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700'>{isTerminalCommand(command) ? 'command' : 'chat'}</span>
            <div className='flex items-center gap-2 ml-auto'>
              <button className='p-1 hover:bg-zinc-700 rounded' type='button'>
                <i className='fa fa-microphone text-zinc-500 hover:text-zinc-300' />
              </button>
              <button className='p-1 hover:bg-zinc-700 rounded' type='button' onClick={insertAtSign}>
                <i className='fa fa-at text-zinc-500 hover:text-zinc-300' />
              </button>
              <button className='p-1 hover:bg-zinc-700 rounded' type='button' onClick={handleImageClick}>
                <i className='fa fa-image text-zinc-500 hover:text-zinc-300' />
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
              className='flex-1 bg-transparent text-white text-sm outline-none placeholder-zinc-500'
            />
            {command && (
              <button type='submit' className='p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white'>
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
window.__WEDNESDAY_UI__ = WednesdayUI
