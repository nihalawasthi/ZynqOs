import React from 'react'

export default function Taskbar() {
  return (
    <div className="h-12 bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 border-t border-gray-700/50 flex items-center px-4 text-white shadow-2xl backdrop-blur-md">
      <div className="mr-8 font-bold text-lg bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 bg-clip-text text-transparent flex items-center gap-2">
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
        MicroOS
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => (window as any).microos_openWindow?.('File Browser', window.__FILE_BROWSER_UI__ ?? <div>Loading...</div>)}
          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg transition-all hover:scale-105 flex items-center gap-2 border border-gray-700/50 shadow-lg"
        >
          <span>📁</span>
          <span className="text-sm">Files</span>
        </button>
        <button
          onClick={() => (window as any).microos_openWindow?.('Text Editor', window.__TEXT_EDITOR_UI__ ?? <div>Loading Editor...</div>)}
          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg transition-all hover:scale-105 flex items-center gap-2 border border-gray-700/50 shadow-lg"
        >
          <span>📝</span>
          <span className="text-sm">Editor</span>
        </button>
        <button
          onClick={() => (window as any).microos_openWindow?.('Terminal', window.__TERMINAL_UI__ ?? <div>Loading Terminal...</div>)}
          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg transition-all hover:scale-105 flex items-center gap-2 border border-gray-700/50 shadow-lg"
        >
          <span>💻</span>
          <span className="text-sm">Terminal</span>
        </button>
        <button
          onClick={() => (window as any).microos_openWindow?.('Calculator', window.__CALC_UI__ ?? <div>Loading Calculator...</div>)}
          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg transition-all hover:scale-105 flex items-center gap-2 border border-gray-700/50 shadow-lg"
        >
          <span>🔢</span>
          <span className="text-sm">Calc</span>
        </button>
      </div>
      <div className="ml-auto text-sm text-gray-300 font-mono bg-gray-800/50 px-3 py-1 rounded-lg border border-gray-700/50">
        {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  )
}
