import React, { useEffect, useState } from 'react'

export default function CalculatorUI() {
  const [result, setResult] = useState('0')
  const [wasmAvailable, setWasmAvailable] = useState(false)
  const [wasmExample, setWasmExample] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const mod = await import('../../../apps/calculator-wasm/pkg/calculator_wasm.js')
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
    <div className="space-y-3 p-2 bg-[var(--bg-color)] transition-colors duration-300">
      <div className="bg-[var(--taskbar-bg)] text-[var(--text-color)] text-right p-5 rounded-xl text-3xl font-mono border border-[var(--border-color)] min-h-[70px] flex items-center justify-end shadow-inner">
        {result}
      </div>
      <div className="flex items-center justify-between text-xs px-1">
        <span className="opacity-60">WASM: <span className={wasmAvailable ? 'text-emerald-500' : 'text-red-500'}>{wasmAvailable ? '✓ Ready' : '✗ Not loaded'}</span></span>
        {wasmExample && <span className="opacity-50">{wasmExample}</span>}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {['7','8','9','4','5','6','1','2','3','0'].map(x => (
          <button 
            key={x} 
            onClick={() => press(x)} 
            className="p-4 bg-[var(--taskbar-bg)] hover:bg-gray-500/20 text-[var(--text-color)] rounded-xl text-xl font-semibold transition-all border border-[var(--border-color)] active:scale-95"
          >
            {x}
          </button>
        ))}
        <button 
          onClick={clear} 
          className="col-span-4 p-4 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-all shadow-lg active:scale-95"
        >
          Clear
        </button>
      </div>
    </div>
  )
}

window.__CALC_UI__ = CalculatorUI