import React from 'react'

export default function Launcher() {
  return (
    <div className="fixed top-4 right-4 bg-gray-800/90 backdrop-blur-sm p-4 rounded-lg shadow-xl border border-gray-700">
      <div className="text-sm font-semibold mb-3 text-blue-300">Quick Launch</div>
      <div className="space-y-2">
        <button
          onClick={() => {
            const Comp = window.__MAPP_IMPORTER_UI__
            if (Comp) {
              (window as any).ZynqOS_openWindow?.('Import Package', Comp)
            }
          }}
          className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded text-white text-sm transition-colors"
        >
          📦 Import .mapp
        </button>
      </div>
    </div>
  )
}
