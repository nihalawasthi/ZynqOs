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
    <div className="flex flex-col h-full">
      <textarea
        className="w-full h-80 p-3 bg-gray-50 text-black rounded-lg border border-gray-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Start typing..."
      />
      <div className="mt-3 flex items-center gap-3">
        <button 
          onClick={doSave} 
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-medium transition-colors"
        >
          💾 Save
        </button>
        {status && <div className="text-sm text-green-600 font-medium">{status}</div>}
      </div>
    </div>
  )
}

// attach UI for Taskbar to open
window.__TEXT_EDITOR_UI__ = TextEditor
