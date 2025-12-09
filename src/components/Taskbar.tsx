import React, { useEffect, useState } from 'react'
import StartMenu from './StartMenu'
import MultiWindowIndicator from './MultiWindowIndicator'

export default function Taskbar() {
  return (
    <div className="fixed bottom-0 left-0 w-[100%] h-16 max-w-[100vw] p-0 bg-none flex items-center justify-center gap-2 z-40">
      <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2 w-[calc(60%-48px)] max-w-[980px] px-4 py-2 bg-white/10 backdrop-blur-md border border-white/10 rounded-full shadow-2xl flex items-center gap-2">
        <StartMenu />

        <div className="flex items-center gap-2">
          <button
            onClick={() => (window as any).ZynqOS_openWindow?.('File Browser', window.__FILE_BROWSER_UI__ ?? <div>Loading...</div>, 'file-browser')}
            title='Files'
            className="flex items-center gap-2 px-3 py-1 rounded-[2px] bg-transparent hover:bg-gray-200/30 transition text-white border border-gray-300/20"
          >
            <span className="text-lg"><i className="fas fa-folder"></i></span>
          </button>
          <button
            onClick={() => (window as any).ZynqOS_openWindow?.('Store', window.__STORE_UI__ ?? <div>Loading...</div>, 'store')}
            title='Store'
            className="flex items-center gap-2 px-3 py-1 rounded-[2px] bg-transparent hover:bg-gray-200/30 transition text-white border border-gray-300/20"
          >
            <span className="text-lg"><i className="fa-solid fa-store"></i></span>
          </button>
          <button
            onClick={() => (window as any).ZynqOS_openWindow?.('Zynqpad', window.__TEXT_EDITOR_UI__ ?? <div>Loading Editor...</div>, 'text-editor')}
            title='Zynqpad'
            className="flex items-center gap-2 px-3 py-1 rounded-[2px] bg-transparent hover:bg-gray-200/30 transition text-white border border-gray-300/20"
          >
            <span className="text-lg"><i className="fa fa-file-text"></i></span>
          </button>
          <button
            onClick={() => (window as any).ZynqOS_openWindow?.('Terminal', window.__TERMINAL_UI__ ?? <div>Loading Terminal...</div>, 'terminal')}
            title='Terminal'
            className="flex items-center gap-2 px-3 py-1 rounded-[2px] bg-transparent hover:bg-gray-200/30 transition text-white border border-gray-300/20"
          >
            <span className="text-lg"><i className="fa fa-terminal"></i></span>
          </button>
          <button
            onClick={() => (window as any).ZynqOS_openWindow?.('Wednesday', window.__WEDNESDAY_UI__ ?? <div>Loading Wednesday...</div>, 'wednesday')}
            title='Wednesday'
            className="flex items-center gap-2 px-3 py-1 rounded-[2px] bg-transparent hover:bg-gray-200/30 transition text-white border border-gray-300/20"
          >
            <span className="text-lg font-thin"><i className="scale-90 fa-solid fa-wand-magic-sparkles"></i></span>
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Clock />
        </div>
      </div>
      <div className="ml-auto mr-4">
        <MultiWindowIndicator />
      </div>
    </div>
  )
}

function Clock() {
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="text-sm text-gray-200 font-mono bg-gray-800/40 px-3 py-1 mr-2 rounded-full border border-gray-700/30">
      {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </div>
  )
}
