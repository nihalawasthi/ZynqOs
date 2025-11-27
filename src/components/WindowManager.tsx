import React, { useState } from 'react'
import Window from './Window'
import { v4 as uuidv4 } from 'uuid'

type Win = { id: string; title: string; content: React.ReactNode }

export default function WindowManager() {
  const [windows, setWindows] = useState<Win[]>([])

  function openWindow(title: string, content: React.ReactNode) {
    const id = uuidv4()
    setWindows(w => [...w, { id, title, content }])
  }

  function closeWindow(id: string) {
    setWindows(w => w.filter(x => x.id !== id))
  }

  // expose for quick demo usage
  (window as any).microos_openWindow = openWindow

  return (
    <div className="absolute inset-0 p-6">
      {windows.map(w => (
        <Window key={w.id} title={w.title} onClose={() => closeWindow(w.id)}>
          {w.content}
        </Window>
      ))}
      {windows.length === 0 && (
        <div className="text-slate-400">No windows open. Use the taskbar to launch an app.</div>
      )}
    </div>
  )
}
