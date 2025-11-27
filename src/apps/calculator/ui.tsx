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
        const mod = await import('/apps/calculator-wasm/pkg/calculator_wasm.js')
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
    <div>
      <div className="bg-gray-100 text-black p-4 rounded">{result}</div>
      <div className="text-xs text-slate-400 mt-1">WASM: {wasmAvailable ? 'available' : 'not available'}</div>
      <div className="text-sm text-slate-400 mt-1">{wasmExample}</div>
      <div className="grid grid-cols-4 gap-2 mt-2">
        {['7','8','9','4','5','6','1','2','3','0'].map(x => (
          <button key={x} onClick={() => press(x)} className="p-2 bg-slate-700 text-white rounded">{x}</button>
        ))}
        <button onClick={clear} className="col-span-4 p-2 bg-red-600 text-white rounded">Clear</button>
      </div>
    </div>
  )
}

// attach for quick open via Taskbar
import ReactDOM from 'react-dom/client'
window.__CALC_UI__ = <CalculatorUI />
