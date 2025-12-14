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
    <div className="p-4 text-sm text-gray-200">
      <h2 className="text-lg font-semibold mb-2">WASM/WASI Runner</h2>
      <p className="mb-3">Select a `.wasm` file or `.zip` (for wasm-bindgen) to upload and run instantly.</p>
      <input type="file" accept=".wasm,.zip" onChange={handleFile} className="mb-3" />
      <div className="text-xs text-gray-400">{status}</div>
    </div>
  )
}

// Register globally
;(window as any).__WASM_RUNNER_UI__ = <WasmRunnerUI />