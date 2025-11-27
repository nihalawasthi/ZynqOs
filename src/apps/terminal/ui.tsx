import React, { useState, useRef, useEffect } from 'react'

export default function Terminal() {
  const [out, setOut] = useState<string[]>([])
  const [cmd, setCmd] = useState('')
  const outRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // welcome message
    setOut(o => [...o, 'MicroOS Terminal v0.1', 'Type "help" for commands'])
  }, [])

  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight })
  }, [out])

  function runCommand(c: string) {
    const trimmed = c.trim()
    if (!trimmed) return
    const parts = trimmed.split(/\s+/)
    const cmd0 = parts[0]
    if (cmd0 === 'ls') {
      setOut(o => [...o, '> ls', 'demo.txt', 'notes/'])
    } else if (cmd0 === 'cat') {
      setOut(o => [...o, `> cat ${parts[1] || ''}`, 'This is a demo file.'])
    } else if (cmd0 === 'help') {
      setOut(o => [...o, 'supported: ls cat help run echo clear'])
    } else if (cmd0 === 'echo') {
      setOut(o => [...o, parts.slice(1).join(' ')])
    } else if (cmd0 === 'clear') {
      setOut([])
    } else {
      setOut(o => [...o, `> ${trimmed}`, `unknown command: ${cmd0}`])
    }
  }

  return (
    <div>
      <div ref={outRef} className="bg-black text-green-400 p-2 h-40 overflow-auto rounded">
        {out.map((l, i) => (<div key={i}>{l}</div>))}
      </div>
      <div className="flex mt-2">
        <input
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { runCommand(cmd); setCmd('') } }}
          className="flex-1 p-1 rounded"
        />
        <button onClick={() => { runCommand(cmd); setCmd('') }} className="ml-2 px-2 py-1 bg-slate-700 rounded text-white">Run</button>
      </div>
    </div>
  )
}

// attach for Taskbar quick open
window.__TERMINAL_UI__ = <Terminal />
