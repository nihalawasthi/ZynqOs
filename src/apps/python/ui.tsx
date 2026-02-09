import React, { useEffect, useRef, useState } from 'react'
import { getPyodide, runPython, runPythonFile, cancelPythonExecution, requestPythonCancel } from '../../wasm/pyodideLoader'
import { getRemotePythonConfig, setRemotePythonEnabled } from '../../remotePython/config'
import { remoteRun } from '../../remotePython/client'
import { readFile as readVfsFile, readdir } from '../../vfs/fs'

export default function PythonUI() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('print("Hello from Python")')
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [timeoutMs, setTimeoutMs] = useState(8000)
  const [stopRequested, setStopRequested] = useState(false)
  const [remoteEnabled, setRemoteEnabled] = useState(false)
  const [remoteBaseUrl, setRemoteBaseUrl] = useState('')
  const [remoteUserId, setRemoteUserId] = useState('')
  const [copied, setCopied] = useState(false)
  const [showFilePicker, setShowFilePicker] = useState(false)
  const [vfsFiles, setVfsFiles] = useState<string[]>([])
  const [scriptPath, setScriptPath] = useState<string>('')
  const runningRef = useRef(false)

  useEffect(() => { runningRef.current = running }, [running])

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

  useEffect(() => {
    const loadRemote = async () => {
      try {
        const cfg = await getRemotePythonConfig()
        setRemoteEnabled(cfg.enabled)
        setRemoteBaseUrl(cfg.baseUrl)
        setRemoteUserId(cfg.userId)
      } catch {
        // ignore
      }
    }

    loadRemote()

    const handleVfsChange = (e: Event) => {
      const ev = e as CustomEvent
      const detail = ev.detail || {}
      if (detail.path === '/settings.json') {
        loadRemote()
      }
    }
    window.addEventListener('microos:vfs-changed', handleVfsChange as EventListener)
    return () => window.removeEventListener('microos:vfs-changed', handleVfsChange as EventListener)
  }, [])

  async function handleRunCode() {
    setRunning(true)
    setStopRequested(false)
    let streamedOutput = ''
    setOutput('')
    try {
      if (remoteEnabled) {
        const result = await remoteRun(code, [], Math.ceil(timeoutMs / 1000))
        const combined = `${result.stdout || ''}${result.stderr || ''}`
        setOutput(combined || '(no output)')
        return
      }

      const result = await runPython(code, timeoutMs, (chunk, stream) => {
        const line = chunk === '' ? '\n' : chunk + '\n'
        streamedOutput += line
        setOutput(prev => prev + line)
      })
      // On stop, prefer final accumulated output if non-empty; otherwise keep streamed content
      if (stopRequested) {
        const trimmed = (result || '').trim()
        if (trimmed && trimmed !== '(no output)') {
          const finalNormalized = result.endsWith('\n') ? result : result + '\n'
          setOutput(finalNormalized)
        } // else keep already-streamed output
      } else if (result && result !== '(no output)') {
        // If result is non-empty, merge it; otherwise keep streamed output
        setOutput(prev => {
          const normalizedPrev = prev
          const finalNormalized = result.endsWith('\n') ? result : result + '\n'
          if (normalizedPrev && finalNormalized.startsWith(normalizedPrev)) {
            return finalNormalized
          }
          return normalizedPrev.includes(finalNormalized) ? normalizedPrev : (normalizedPrev + finalNormalized)
        })
      }
      // If stopped early and we have streamed output, keep it
    } catch (e: any) {
      setOutput(prev => prev || `Error: ${String(e)}`)
    } finally {
      setRunning(false)
    }
  }

  async function handleRunScript() {
    setRunning(true)
    setOutput('')
    setStopRequested(false)
    try {
      if (!scriptPath) {
        setRunning(false)
        setOutput('')
        return
      }
      if (remoteEnabled) {
        const content = await readVfsFile(scriptPath)
        if (content === undefined) {
          throw new Error(`File not found: ${scriptPath}`)
        }
        const codeText = content instanceof Uint8Array ? new TextDecoder().decode(content) : String(content)
        const result = await remoteRun(codeText, [], Math.ceil(timeoutMs / 1000))
        const combined = `${result.stdout || ''}${result.stderr || ''}`
        setOutput(combined || '(no output)')
        return
      }

      let gotStream = false
      const result = await runPythonFile(scriptPath, (chunk, stream) => {
        gotStream = true
        setOutput(prev => prev + (chunk === '' ? '\n' : chunk + '\n'))
      }, timeoutMs)
      if (stopRequested) {
        const trimmed = (result || '').trim()
        if (trimmed && trimmed !== '(no output)') {
          const finalNormalized = result.endsWith('\n') ? result : result + '\n'
          setOutput(finalNormalized)
        }
      } else {
        setOutput(prev => {
          const normalizedPrev = prev
          const finalNormalized = result.endsWith('\n') ? result : result + '\n'
          if (normalizedPrev && finalNormalized.startsWith(normalizedPrev)) {
            return finalNormalized
          }
          return normalizedPrev.includes(finalNormalized) ? normalizedPrev : (normalizedPrev + finalNormalized)
        })
      }
    } catch (e: any) {
      setOutput(`Error: ${String(e)}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="h-full w-full bg-black text-[#e0e0e0] p-4 m-0 grid grid-cols-2 gap-4 overflow-hidden">
      {/* Left: Editor */}
      <div className="flex flex-col gap-3 min-h-0">
        <div className="flex items-center justify-between">
          <button
            className="px-3 py-1 bg-purple-600 rounded disabled:opacity-50"
            onClick={async () => {
              const files = await readdir('')
              setVfsFiles(files.filter(f => f.endsWith('.py') || !f.includes('.')))
              setShowFilePicker(true)
            }}
            disabled={loading || running}
          >Import</button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Runtime</span>
            <button
              className={`px-2 py-1 text-xs rounded border ${remoteEnabled ? 'bg-blue-700 border-blue-500' : 'bg-[#222] border-[#444]'}`}
              onClick={async () => {
                try {
                  const cfg = await setRemotePythonEnabled(!remoteEnabled)
                  setRemoteEnabled(cfg.enabled)
                  setRemoteBaseUrl(cfg.baseUrl)
                  setRemoteUserId(cfg.userId)
                } catch (e: any) {
                  setOutput(`Error: ${String(e)}`)
                }
              }}
              disabled={running}
            >{remoteEnabled ? 'Remote' : 'Local'}</button>
            {remoteEnabled && !remoteBaseUrl && (
              <span className="text-xs text-yellow-400">Set URL in Settings</span>
            )}
            {remoteEnabled && remoteUserId && (
              <span className="text-xs text-gray-400">User: {remoteUserId}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Timeout (ms)</label>
            <input
              className="w-24 bg-[#151515] border border-[#333] rounded px-2 py-1 text-sm"
              type="number"
              min={1000}
              step={1000}
              value={timeoutMs}
              onChange={(e) => {
                const val = parseInt((e.target as HTMLInputElement).value || '8000', 10)
                setTimeoutMs(isNaN(val) || val < 1000 ? 8000 : val)
              }}
            />
          </div>
          <button
            className={`px-3 py-1 rounded disabled:opacity-50 ${running ? 'bg-red-600' : 'bg-green-600'}`}
            onClick={async () => {
              if (running) {
                if (remoteEnabled) {
                  setOutput(prev => prev || 'Remote runtime does not support cancel')
                  return
                }
                setStopRequested(true)
                try { await requestPythonCancel() } catch {}
                // Give the worker a moment to return final buffers;
                // if still running after the grace period, force-cancel.
                setTimeout(() => {
                  if (runningRef.current) {
                    cancelPythonExecution()
                  }
                }, 500)
              } else {
                handleRunCode()
              }
            }}
            disabled={loading}
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

      {/* File Picker Modal */}
      {showFilePicker && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowFilePicker(false)}>
          <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-4 w-96 max-h-[60vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-lg">Import Python File</div>
              <button onClick={() => setShowFilePicker(false)} className="text-gray-400 hover:text-white">
                <i className="fas fa-times"></i>
              </button>
            </div>
            {vfsFiles.length === 0 ? (
              <div className="text-gray-500 text-center py-8">No Python files found in VFS</div>
            ) : (
              <div className="space-y-1">
                {vfsFiles.map(file => (
                  <button
                    key={file}
                    className="w-full text-left px-3 py-2 rounded bg-[#222] hover:bg-[#2a2a2a] transition text-sm"
                    onClick={async () => {
                      try {
                        const content = await readVfsFile(file)
                        if (content === undefined) {
                          setError(`File not found: ${file}`)
                          setShowFilePicker(false)
                          return
                        }
                        if (content instanceof Uint8Array) {
                          try {
                            setCode(new TextDecoder('utf-8', { fatal: true }).decode(content))
                          } catch {
                            setCode(new TextDecoder('latin1').decode(content))
                          }
                        } else {
                          setCode(content)
                        }
                        setOutput('')
                        setError(null)
                        setShowFilePicker(false)
                      } catch (e: any) {
                        setError(String(e))
                        setShowFilePicker(false)
                      }
                    }}
                  >
                    <i className="fas fa-file-code mr-2 text-purple-400"></i>
                    {file}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Register globally
// Replace terminal-based UI with simple Python runner
;(window as any).__PYTHON_UI__ = PythonUI
