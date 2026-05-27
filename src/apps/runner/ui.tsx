import React, { useState } from 'react'
import { executePackage, uploadPackage } from '../../packages/manager'

export default function WasmRunnerUI() {
  const [status, setStatus] = useState('')

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus('Uploading...')
    const res = await uploadPackage({
      file,
      metadata: {
        name: file.name,
        type: 'wasi',
        tags: ['user-uploaded']
      }
    })
    if (res.success) {
      setStatus('Uploaded. Executing...')
      const instance = await executePackage(res.packageId)
      setStatus(instance ? 'Executed successfully' : 'Execution failed')
      // Close after run
      setTimeout(() => (window as any).ZynqOS_closeActiveWindow?.(), 1500)
    } else {
      setStatus('Upload failed: ' + res.error)
    }
  }

  return (
    <div className="p-4 text-sm text-[var(--text-color)] bg-[var(--bg-color)] h-full transition-colors duration-300">
      <h2 className="text-lg font-semibold mb-2">WASM/WASI Runner</h2>
      <p className="mb-3 opacity-80">
        Select a `.wasm` file or `.zip` (for wasm-bindgen) to upload and run instantly.
      </p>
      <input 
        type="file" 
        accept=".wasm,.zip" 
        onChange={handleFile} 
        className="mb-3 block w-full text-sm text-[var(--text-color)]
          file:mr-4 file:py-2 file:px-4
          file:rounded-md file:border-0
          file:text-sm file:font-semibold
          file:bg-blue-600 file:text-white
          hover:file:bg-blue-700
          cursor-pointer" 
      />
      <div className="text-xs opacity-60 font-mono">{status}</div>
    </div>
  )
}

// Register globally
;(window as any).__WASM_RUNNER_UI__ = <WasmRunnerUI />