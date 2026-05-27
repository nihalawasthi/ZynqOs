import React, { useEffect, useState } from 'react'

interface CalculatorUIProps {
  wasmModule?: any
}

export default function CalculatorUI({ wasmModule }: CalculatorUIProps) {
  const [result, setResult] = useState('0')
  const [wasmAvailable, setWasmAvailable] = useState(false)

  useEffect(() => {
    if (wasmModule?.calculate) {
      setWasmAvailable(true)
    }
  }, [wasmModule])

  function press(n: string) {
    setResult(s => (s === '0' ? n : s + n))
  }

  function clear() {
    setResult('0')
  }

  function calculate() {
    try {
      const expression = result
      if (!/^[0-9+\-*/(). ]*$/.test(expression)) {
        setResult('Error')
        return
      }
      const computeFunc = new Function('return (' + expression + ')')
      const computed = computeFunc()
      setResult(String(computed))
    } catch {
      setResult('Error')
    }
  }

  function performOperation(op: string) {
    setResult(s => s + op)
  }

  return (
    <div className="space-y-3 p-2 bg-[var(--bg-color)] text-[var(--text-color)] transition-colors duration-300">
      <div className="bg-[var(--taskbar-bg)] text-[var(--text-color)] text-right p-5 rounded-xl text-3xl font-mono border border-[var(--border-color)] min-h-[70px] flex items-center justify-end shadow-inner">
        {result}
      </div>
      <div className="flex items-center justify-between text-xs px-1 opacity-70">
        <span>
          WASM: <span className={wasmAvailable ? 'text-emerald-500' : 'text-red-500'}>
            {wasmAvailable ? '✓ Ready' : '✗ Not loaded'}
          </span>
        </span>
        {wasmAvailable && wasmModule?.calculate && (
          <button
            onClick={() => setResult(String(wasmModule.calculate(2, 3)))}
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Test: 2+3
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {['7','8','9'].map(x => (
          <button key={x} onClick={() => press(x)} className="p-4 bg-[var(--taskbar-bg)] hover:bg-gray-500/20 border border-[var(--border-color)] rounded-xl text-xl font-semibold transition-all active:scale-95">
            {x}
          </button>
        ))}
        <button onClick={() => performOperation('/')} className="p-4 bg-orange-600/90 hover:bg-orange-600 text-white rounded-xl text-xl font-semibold transition-all active:scale-95">÷</button>
        
        {['4','5','6'].map(x => (
          <button key={x} onClick={() => press(x)} className="p-4 bg-[var(--taskbar-bg)] hover:bg-gray-500/20 border border-[var(--border-color)] rounded-xl text-xl font-semibold transition-all active:scale-95">
            {x}
          </button>
        ))}
        <button onClick={() => performOperation('*')} className="p-4 bg-orange-600/90 hover:bg-orange-600 text-white rounded-xl text-xl font-semibold transition-all active:scale-95">×</button>
        
        {['1','2','3'].map(x => (
          <button key={x} onClick={() => press(x)} className="p-4 bg-[var(--taskbar-bg)] hover:bg-gray-500/20 border border-[var(--border-color)] rounded-xl text-xl font-semibold transition-all active:scale-95">
            {x}
          </button>
        ))}
        <button onClick={() => performOperation('-')} className="p-4 bg-orange-600/90 hover:bg-orange-600 text-white rounded-xl text-xl font-semibold transition-all active:scale-95">-</button>
        
        <button onClick={() => press('0')} className="col-span-2 p-4 bg-[var(--taskbar-bg)] hover:bg-gray-500/20 border border-[var(--border-color)] rounded-xl text-xl font-semibold transition-all active:scale-95">0</button>
        <button onClick={() => press('.')} className="p-4 bg-[var(--taskbar-bg)] hover:bg-gray-500/20 border border-[var(--border-color)] rounded-xl text-xl font-semibold transition-all active:scale-95">.</button>
        <button onClick={() => performOperation('+')} className="p-4 bg-orange-600/90 hover:bg-orange-600 text-white rounded-xl text-xl font-semibold transition-all active:scale-95">+</button>
        
        <button onClick={clear} className="col-span-2 p-4 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-all active:scale-95">Clear</button>
        <button onClick={calculate} className="col-span-2 p-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold transition-all active:scale-95">=</button>
      </div>
    </div>
  )
}