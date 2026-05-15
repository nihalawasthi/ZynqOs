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

  function backspace() {
    setResult(s => {
      if (s.length <= 1) {
        return '0'
      }
      return s.slice(0, -1)
    })
  }

  function clear() {
    setResult('0')
  }

  function calculate() {
    try {
      // Safe expression evaluation using Function constructor (more secure than eval)
      // This only works for numeric expressions, rejecting any malicious code
      const expression = result
      
      // Validate expression contains only allowed characters
      if (!/^[0-9+\-*/(). ]*$/.test(expression)) {
        setResult('Error')
        return
      }
      
      // Use Function constructor with restricted scope instead of eval
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
    <div className="space-y-3 p-2">
      <div className="bg-gradient-to-b from-gray-900 to-black text-white text-right p-5 rounded-xl text-3xl font-mono border border-gray-700 min-h-[70px] flex items-center justify-end shadow-inner">
        {result}
      </div>
      <div className="flex items-center justify-between text-xs px-1">
        <span className="text-gray-500">
          WASM: <span className={wasmAvailable ? 'text-emerald-500' : 'text-red-500'}>
            {wasmAvailable ? '✓ Ready' : '✗ Not loaded'}
          </span>
        </span>
        {wasmAvailable && wasmModule?.calculate && (
          <button
            onClick={() => {
              const res = wasmModule.calculate(2, 3)
              setResult(String(res))
            }}
            className="text-xs px-2 py-1 bg-blue-600 rounded hover:bg-blue-700"
          >
            Test: 2+3
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {['7','8','9'].map(x => (
          <button 
            key={x} 
            onClick={() => press(x)} 
            className="p-4 bg-gradient-to-b from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-white rounded-xl text-xl font-semibold transition-all shadow-lg border border-gray-600 active:scale-95"
          >
            {x}
          </button>
        ))}
        <button 
          onClick={() => performOperation('/')}
          className="p-4 bg-gradient-to-b from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 text-white rounded-xl text-xl font-semibold transition-all shadow-lg active:scale-95"
        >
          ÷
        </button>
        
        {['4','5','6'].map(x => (
          <button 
            key={x} 
            onClick={() => press(x)} 
            className="p-4 bg-gradient-to-b from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-white rounded-xl text-xl font-semibold transition-all shadow-lg border border-gray-600 active:scale-95"
          >
            {x}
          </button>
        ))}
        <button 
          onClick={() => performOperation('*')}
          className="p-4 bg-gradient-to-b from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 text-white rounded-xl text-xl font-semibold transition-all shadow-lg active:scale-95"
        >
          ×
        </button>
        
        {['1','2','3'].map(x => (
          <button 
            key={x} 
            onClick={() => press(x)} 
            className="p-4 bg-gradient-to-b from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-white rounded-xl text-xl font-semibold transition-all shadow-lg border border-gray-600 active:scale-95"
          >
            {x}
          </button>
        ))}
        <button 
          onClick={() => performOperation('-')}
          className="p-4 bg-gradient-to-b from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 text-white rounded-xl text-xl font-semibold transition-all shadow-lg active:scale-95"
        >
          -
        </button>
        
        <button 
          onClick={() => press('0')}
          className="col-span-2 p-4 bg-gradient-to-b from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-white rounded-xl text-xl font-semibold transition-all shadow-lg border border-gray-600 active:scale-95"
        >
          0
        </button>
        <button 
          onClick={() => press('.')}
          className="p-4 bg-gradient-to-b from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-white rounded-xl text-xl font-semibold transition-all shadow-lg border border-gray-600 active:scale-95"
        >
          .
        </button>
        <button 
          onClick={() => performOperation('+')}
          className="p-4 bg-gradient-to-b from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 text-white rounded-xl text-xl font-semibold transition-all shadow-lg active:scale-95"
        >
          +
        </button>

        <button
          onClick={backspace}
          className="col-span-2 p-4 bg-gradient-to-b from-yellow-600 to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-white rounded-xl font-semibold transition-all shadow-lg active:scale-95"
        >
          ⌫
        </button>
        <button 
          onClick={clear} 
          className="col-span-2 p-4 bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white rounded-xl font-semibold transition-all shadow-lg active:scale-95"
        >
          Clear
        </button>
        <button 
          onClick={calculate} 
          className="col-span-4 p-4 bg-gradient-to-b from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white rounded-xl font-semibold transition-all shadow-lg active:scale-95"
        >
          =
        </button>
      </div>
    </div>
  )
}
