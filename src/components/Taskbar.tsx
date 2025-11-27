import React from 'react'

export default function Taskbar() {
  return (
    <div className="fixed bottom-0 left-0 right-0 h-12 bg-gray-800 flex items-center px-4 text-white">
      <div className="mr-4 font-semibold">MicroOS</div>
      <div className="flex gap-3">
        <button
          onClick={() => (window as any).microos_openWindow?.('Text Editor', window.__TEXT_EDITOR_UI__ ?? <div>Loading Editor...</div>)}
          className="px-3 py-1 bg-slate-700 rounded"
        >
          Editor
        </button>
        <button
          onClick={() => (window as any).microos_openWindow?.('Terminal', window.__TERMINAL_UI__ ?? <div>Loading Terminal...</div>)}
          className="px-3 py-1 bg-slate-700 rounded"
        >
          Terminal
        </button>
        <button
          onClick={() => (window as any).microos_openWindow?.('Calculator', window.__CALC_UI__ ?? <div>Loading Calculator...</div>)}
          className="px-3 py-1 bg-slate-700 rounded"
        >
          Calc
        </button>
      </div>
    </div>
  )
}
