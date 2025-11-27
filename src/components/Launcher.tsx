import React from 'react'

export default function Launcher() {
  return (
    <div className="fixed top-4 right-4 bg-white/5 p-3 rounded">
      <div className="text-sm">Launcher</div>
      <div className="mt-2">
        <button
          onClick={async () => {
            // load the calculator UI component (client dynamic import)
            try {
              const mod = await import('../apps/calculator/ui')
              // default export is a React component function
              const Comp = mod.default
              // attach global reference for Taskbar quick open
              window.__CALC_UI__ = <Comp />
              (window as any).microos_openWindow?.('Calculator', <Comp />)
            } catch (e) {
              console.error('Failed to load calculator UI', e);
              (window as any).microos_openWindow?.('Calculator', <div>Calculator UI failed to load</div>)
            }
          }}
          className="px-2 py-1 bg-slate-700 rounded text-white"
        >
          Open Calculator (WASM)
        </button>
      </div>
    </div>
  )
}
