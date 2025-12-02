import React, { useEffect, useState } from 'react'
import { getPyodide, runPython, runPythonFile, cancelPythonExecution, requestPythonCancel } from '../../wasm/pyodideLoader'

export default function PythonUI() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('print("Hello from Python")')
  const [output, setOutput] = useState('')
  const [scriptPath, setScriptPath] = useState('/home/demo.py')
  const [running, setRunning] = useState(false)
  const [timeoutMs, setTimeoutMs] = useState(8000)
  const [stopRequested, setStopRequested] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        await getPyodide()
        setLoading(false)
      } catch (e: any) {
        setError(String(e))
        setLoading(false)
      }
    })()
  }, [])

  async function handleRunCode() {
    setRunning(true)
    setOutput('')
    setStopRequested(false)
    try {
      let gotStream = false
      const result = await runPython(code, timeoutMs, (chunk, stream) => {
        gotStream = true
        setOutput(prev => prev + (chunk === '' ? '\n' : chunk + '\n'))
      })
      // Merge final buffer (result) even if we streamed
      setOutput(prev => {
        const normalizedPrev = prev
        const finalNormalized = result.endsWith('\n') ? result : result + '\n'
        if (normalizedPrev && finalNormalized.startsWith(normalizedPrev)) {
          return finalNormalized
        }
        // Append missing part if some overlap
        return normalizedPrev.includes(finalNormalized) ? normalizedPrev : (normalizedPrev + finalNormalized)
      })
      if (stopRequested) {
        setOutput(prev => prev + '[stopped]\n')
      }
    } catch (e: any) {
      setOutput(`Error: ${String(e)}`)
    } finally {
      setRunning(false)
    }
  }

  async function handleRunScript() {
    setRunning(true)
    setOutput('')
    setStopRequested(false)
    try {
      let gotStream = false
      const result = await runPythonFile(scriptPath, (chunk, stream) => {
        gotStream = true
        setOutput(prev => prev + (chunk === '' ? '\n' : chunk + '\n'))
      }, timeoutMs)
      setOutput(prev => {
        const normalizedPrev = prev
        const finalNormalized = result.endsWith('\n') ? result : result + '\n'
        if (normalizedPrev && finalNormalized.startsWith(normalizedPrev)) {
          return finalNormalized
        }
        return normalizedPrev.includes(finalNormalized) ? normalizedPrev : (normalizedPrev + finalNormalized)
      })
      if (stopRequested) {
        setOutput(prev => prev + '[stopped]\n')
      }
    } catch (e: any) {
      setOutput(`Error: ${String(e)}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="h-full w-full bg-[#0f0f0f] text-[#e0e0e0] p-4 grid grid-cols-2 gap-4 overflow-hidden">
      {/* Left: Editor */}
      <div className="flex flex-col gap-3 min-h-0">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Python</div>
          <button
            className={`px-3 py-1 rounded disabled:opacity-50 ${running ? 'bg-red-600' : 'bg-green-600'}`}
            onClick={async () => {
              if (running) {
                setStopRequested(true)
                const ok = await requestPythonCancel()
                if (!ok) {
                  cancelPythonExecution()
                  setOutput(prev => prev ? prev + '\n[stopped]\n' : '[stopped]\n')
                  setRunning(false)
                }
              } else {
                handleRunCode()
              }
            }}
            disabled={loading || stopRequested}
          >{running ? 'Stop' : 'Run Code'}</button>
          {loading && <div className="text-yellow-400">Loading Pyodide...</div>}
          {error && <div className="text-red-400">{error}</div>}
        </div>
        <textarea
          className="flex-1 min-h-[260px] font-mono text-sm bg-[#151515] border border-[#333] rounded p-3"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            // Auto-indentation and Tab handling
            const el = e.currentTarget
            const start = el.selectionStart ?? 0
            const end = el.selectionEnd ?? 0

            // Insert 4 spaces on Tab
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              const indent = e.shiftKey ? '' : '    '
              const before = code.slice(0, start)
              const after = code.slice(end)
              const newPos = start + indent.length
              const updated = before + indent + after
              setCode(updated)
              // restore caret
              setTimeout(() => {
                el.selectionStart = newPos
                el.selectionEnd = newPos
              }, 0)
              return
            }

            // Auto indent on Enter based on previous line
            if (e.key === 'Enter') {
              e.preventDefault()
              // Get text before caret and current line
              const before = code.slice(0, start)
              const after = code.slice(end)
              const lastNewline = before.lastIndexOf('\n')
              const currentLine = lastNewline >= 0 ? before.slice(lastNewline + 1) : before
              const leadingSpacesMatch = currentLine.match(/^[ \t]*/)
              const leading = leadingSpacesMatch ? leadingSpacesMatch[0].replace(/\t/g, '    ') : ''
              const trimmed = currentLine.trim()

              // If previous line ends with ':' increase indent by 4 spaces
              const needsExtra = trimmed.endsWith(':')
              // If line starts with dedent keywords, reduce indent (else, elif, except, finally)
              const dedentKeywords = ['else:', 'elif', 'except', 'finally:']
              const startsWithDedent = dedentKeywords.some(k => trimmed.startsWith(k))
              let newIndent = leading
              if (needsExtra) newIndent = leading + '    '
              if (startsWithDedent && leading.length >= 4) newIndent = leading.slice(0, leading.length - 4)

              const insert = '\n' + newIndent
              const updated = before + insert + after
              const newPos = (before + insert).length
              setCode(updated)
              setTimeout(() => {
                el.selectionStart = newPos
                el.selectionEnd = newPos
              }, 0)
              return
            }
          }}
          placeholder="Enter Python code here"
        />
        <div className="flex gap-2 items-center">
          <label className="text-xs text-gray-400">Timeout (ms)</label>
          <input
            className="w-24 bg-[#151515] border border-[#333] rounded px-2 py-1 text-sm"
            type="number"
            min={1000}
            step={1000}
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(parseInt(e.target.value || '8000', 10))}
          />
          <div className="flex items-center gap-2 ml-auto">
            <input
              className="flex-1 bg-[#151515] border border-[#333] rounded px-2 py-1 text-sm"
              value={scriptPath}
              onChange={(e) => setScriptPath(e.target.value)}
              placeholder="/home/demo.py"
            />
            <button
              className={`px-3 py-1 rounded disabled:opacity-50 ${running ? 'bg-red-600' : 'bg-blue-600'}`}
              onClick={async () => {
                if (running) {
                  setStopRequested(true)
                  const ok = await requestPythonCancel()
                  if (!ok) {
                    cancelPythonExecution()
                    setOutput(prev => prev ? prev + '\n[stopped]\n' : '[stopped]\n')
                    setRunning(false)
                  }
                } else {
                  handleRunScript()
                }
              }}
              disabled={loading || stopRequested}
            >{running ? 'Stop' : 'Run Script'}</button>
          </div>
        </div>
      </div>

      {/* Right: Output */}
      <div className="flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">Output</div>
          <div className="flex items-center gap-2">
            {copied && <span className="text-xs text-green-400">Copied</span>}
            <button
              className="px-2 py-1 text-xs bg-[#222] border border-[#444] rounded"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(output)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                } catch {}
              }}
              disabled={!output}
            >Copy</button>
          </div>
        </div>
        <pre className="flex-1 min-h-0 max-h-full font-mono text-sm bg-[#111] border border-[#333] rounded p-3 whitespace-pre-wrap select-text overflow-y-auto scrollbar">{output || (running ? 'Running…' : 'No output')}</pre>
      </div>
    </div>
  )
}

// Register globally
// Replace terminal-based UI with simple Python runner
;(window as any).__PYTHON_UI__ = PythonUI
