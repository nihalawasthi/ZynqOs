import React, { useState, useEffect } from 'react'
import { readFile, writeFile } from '../../vfs/fs'

export default function TextEditor() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    (async () => {
      const v = await readFile('/home/demo.txt')
      if (typeof v === 'string') setText(v)
    })()
  }, [])

  async function doSave() {
    await writeFile('/home/demo.txt', text)
    setStatus('Saved')
    setTimeout(() => setStatus(''), 1200)
  }

  return (
    <div>
      <textarea
        className="w-full h-56 p-2 bg-white text-black rounded"
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={doSave} className="px-2 py-1 bg-slate-700 rounded text-white">Save</button>
        <div className="text-sm text-slate-400">{status}</div>
      </div>
    </div>
  )
}

// attach UI for Taskbar to open
import ReactDOM from 'react-dom/client'
window.__TEXT_EDITOR_UI__ = <TextEditor />
