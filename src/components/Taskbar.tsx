import React, { useEffect, useState } from 'react'

export default function Taskbar() {
  return (
    <div className="fixed bottom-2 left-1/2 transform -translate-x-1/2 w-[calc(65%-48px)] max-w-[980px] px-1 py-1 bg-white/6 backdrop-blur-md border border-white/10 rounded-full shadow-2xl flex items-center gap-4 z-40">
      <div className="flex items-center gap-3">
        <img src="/assets/logo.png" 
        className='aspect-[1/1] h-10 rounded-full ml-2'
        alt="" />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => (window as any).ZynqOS_openWindow?.('File Browser', window.__FILE_BROWSER_UI__ ?? <div>Loading...</div>)}
          className="flex items-center gap-2 px-3 py-1 rounded-[2px] bg-transparent hover:bg-gray-800/70 transition transform hover:scale-105 text-white border border-gray-700/80 shadow"
        >
          <span className="text-lg"><i className="fas fa-folder"></i></span>
        </button>
                <button
          onClick={() => (window as any).ZynqOS_openWindow?.('Store', window.__FILE_BROWSER_UI__ ?? <div>Loading...</div>)}
          className="flex items-center gap-2 px-3 py-1 rounded-[2px] bg-transparent hover:bg-gray-800/70 transition transform hover:scale-105 text-white border border-gray-700/80 shadow"
        >
          <span className="text-lg"><i className="fa-solid fa-store"></i></span>
        </button>
        <button
          onClick={() => (window as any).ZynqOS_openWindow?.('Text Editor', window.__TEXT_EDITOR_UI__ ?? <div>Loading Editor...</div>)}
          className="flex items-center gap-2 px-3 py-1 rounded-[2px] bg-transparent hover:bg-gray-800/70 transition transform hover:scale-105 text-white border border-gray-700/80 shadow"
        >
          <span className="text-lg"><i className="fa fa-file-text"></i></span>
        </button>
        <button
          onClick={() => (window as any).ZynqOS_openWindow?.('Terminal', window.__TERMINAL_UI__ ?? <div>Loading Terminal...</div>)}
          className="flex items-center gap-2 px-3 py-1 rounded-[2px] bg-transparent hover:bg-gray-800/70 transition transform hover:scale-105 text-white border border-gray-700/80 shadow"
        >
          <span className="text-lg"><i className="fa fa-terminal"></i></span>
        </button>
        <button
          onClick={() => (window as any).ZynqOS_openWindow?.('Calculator', window.__CALC_UI__ ?? <div>Loading Calculator...</div>)}
          className="flex items-center gap-2 px-3 py-1 rounded-[2px] bg-transparent hover:bg-gray-800/70 transition transform hover:scale-105 text-white border border-gray-700/80 shadow"
        >
          <span className="text-lg font-thin"><i className="fas">&#xf1ec;</i></span>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Clock />
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
