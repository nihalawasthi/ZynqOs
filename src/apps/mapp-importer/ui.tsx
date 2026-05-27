import React, { useState } from 'react'
import { loadMapp } from '../../wasm/mappLoader'

export default function MappImporter() {
  const [status, setStatus] = useState('')
  const [lastImported, setLastImported] = useState<any>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setStatus('Importing...')
    try {
      const manifest = await loadMapp(file)
      setLastImported(manifest)
      setStatus(`✓ Successfully imported: ${manifest.name}`)
    } catch (err: any) {
      setStatus(`✗ Error: ${err.message}`)
    }
  }

  const triggerFileSelect = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.mapp,application/zip'
    input.onchange = handleFileSelect as any
    input.click()
  }

  return (
    <div className="flex flex-col h-full p-4 bg-[var(--bg-color)] text-[var(--text-color)] transition-colors duration-300">
      <div className="mb-4">
        <h2 className="text-xl font-bold mb-2">Import .mapp Package</h2>
        <p className="text-sm opacity-70">
          .mapp files are bundled applications that can be loaded into ZynqOS VFS
        </p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-[var(--border-color)] rounded-lg hover:border-blue-500/50 transition-colors">
        <div className="text-center">
          <div className="text-6xl mb-4 opacity-80">📦</div>
          <button
            onClick={triggerFileSelect}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-semibold transition-all shadow-lg shadow-blue-600/20 active:scale-95"
          >
            Select .mapp File
          </button>
        </div>
      </div>

      {status && (
        <div className={`mt-4 p-3 rounded border ${
          status.startsWith('✓') ? 'bg-green-500/10 text-green-600 border-green-500/20' : 
          status.startsWith('✗') ? 'bg-red-500/10 text-red-600 border-red-500/20' : 
          'bg-blue-500/10 text-blue-600 border-blue-500/20'
        }`}>
          {status}
        </div>
      )}

      {lastImported && (
        <div className="mt-4 p-3 bg-[var(--taskbar-bg)] border border-[var(--border-color)] rounded">
          <div className="font-semibold mb-2">Last Imported Package:</div>
          <div className="text-sm space-y-1 opacity-80">
            <div><strong>Name:</strong> {lastImported.name}</div>
            {lastImported.version && <div><strong>Version:</strong> {lastImported.version}</div>}
            {lastImported.description && <div><strong>Description:</strong> {lastImported.description}</div>}
          </div>
        </div>
      )}

      <div className="mt-4 text-sm opacity-60">
        <div className="font-semibold mb-2">What happens when you import?</div>
        <ul className="list-disc list-inside space-y-1">
          <li>Files are extracted from the .mapp (zip) archive</li>
          <li>All files are stored in VFS under <code className="bg-[var(--taskbar-bg)] px-1 rounded">/apps/&#123;name&#125;/</code></li>
          <li>WASM binaries become accessible to the Terminal</li>
          <li>Assets become available to all apps</li>
        </ul>
      </div>
    </div>
  )
}

// Register globally
window.__MAPP_IMPORTER_UI__ = MappImporter