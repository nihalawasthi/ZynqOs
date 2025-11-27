import React, { useEffect, useState } from 'react'

export default function CalculatorUI() {
  const [result, setResult] = useState('0')
  const [wasmAvailable, setWasmAvailable] = useState(false)
  const [wasmExample, setWasmExample] = useState<string | null>(null)

  useEffect(() => {
    // try loading the wasm package built by wasm-pack at /apps/calculator-wasm/pkg
    (async () => {
      try {
        // path for wasm-pack target web default file name
        // it generates e.g. calculator_wasm.js and calculator_wasm_bg.wasm
        const mod = await import('../../../apps/calculator-wasm/pkg/calculator_wasm.js')
        // Initialize the WASM module first
        await mod.default()
        if (mod && typeof mod.calculate === 'function') {
          const r = mod.calculate(2, 3)
          setWasmExample(`calculate(2,3) = ${r}`)
          setWasmAvailable(true)
        }
      } catch (e) {
        console.warn('WASM not loaded', e)
        setWasmAvailable(false)
      }
    })()
  }, [])

  function press(n: string) {
    setResult(s => (s === '0' ? n : s + n))
  }

  function clear() {
    setResult('0')
  }

  return (
    <div className="space-y-3 p-2">
      <div className="bg-gradient-to-b from-gray-900 to-black text-white text-right p-5 rounded-xl text-3xl font-mono border border-gray-700 min-h-[70px] flex items-center justify-end shadow-inner">
        {result}
      </div>
      <div className="flex items-center justify-between text-xs px-1">
        <span className="text-gray-500">WASM: <span className={wasmAvailable ? 'text-emerald-500' : 'text-red-500'}>{wasmAvailable ? '✓ Ready' : '✗ Not loaded'}</span></span>
        {wasmExample && <span className="text-gray-400">{wasmExample}</span>}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {['7','8','9','4','5','6','1','2','3','0'].map(x => (
          <button 
            key={x} 
            onClick={() => press(x)} 
            className="p-4 bg-gradient-to-b from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-white rounded-xl text-xl font-semibold transition-all shadow-lg border border-gray-600 active:scale-95"
          >
            {x}
          </button>
        ))}
        <button 
          onClick={clear} 
          className="col-span-4 p-4 bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white rounded-xl font-semibold transition-all shadow-lg active:scale-95"
        >
          Clear
        </button>
      </div>
    </div>
  )
}

// attach UI for Taskbar to open
window.__CALC_UI__ = CalculatorUI
