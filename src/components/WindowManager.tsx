import React, { useState } from 'react'
import Window from './Window'
import { v4 as uuidv4 } from 'uuid'

type Win = { id: string; title: string; content: React.ReactNode | (() => React.ReactElement) }

export default function WindowManager() {
  const [windows, setWindows] = useState<Win[]>([])

  function openWindow(title: string, content: React.ReactNode | (() => React.ReactElement)) {
    const id = uuidv4()
    setWindows(w => [...w, { id, title, content }])
  }

  function closeWindow(id: string) {
    setWindows(w => w.filter(x => x.id !== id))
  }

  // expose for quick demo usage
  (window as any).microos_openWindow = openWindow

  return (
    <div className="flex-1 relative overflow-hidden">
      {windows.map((w, idx) => (
        <Window 
          key={w.id} 
          title={w.title} 
          onClose={() => closeWindow(w.id)}
          initialPosition={{ x: 100 + idx * 30, y: 60 + idx * 30 }}
          noPadding={w.title === 'Terminal'}
        >
          {typeof w.content === 'function' ? <w.content /> : w.content}
        </Window>
      ))}
    </div>
  )
}
