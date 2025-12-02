import React, { useState, useEffect } from 'react'
import { readFile, writeFile, removeFile, readdir } from '../../vfs/fs'
import { isEditable, tryDecodeText, getFileTypeDescription } from '../../vfs/fileTypes'

export default function FileBrowser() {
  const [files, setFiles] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [newFileName, setNewFileName] = useState('')
  const [newFileContent, setNewFileContent] = useState('')
  const [status, setStatus] = useState('')

  const loadFiles = async () => {
    const allFiles = await readdir('')
    setFiles(allFiles.sort())
  }

  useEffect(() => {
    loadFiles()
  }, [])

  const handleFileClick = async (path: string) => {
    setSelectedFile(path)
    const content = await readFile(path)
    if (typeof content === 'string') {
      setFileContent(content)
    } else if (content instanceof Uint8Array) {
      // Try to decode as text
      const decoded = tryDecodeText(content)
      if (decoded !== null && isEditable(path, content)) {
        setFileContent(decoded)
      } else {
        setFileContent(`[Binary file: ${content.length} bytes - ${getFileTypeDescription(path)}]`)
      }
    } else {
      setFileContent('[File not found]')
    }
  }

  const handleCreateFile = async () => {
    if (!newFileName) {
      setStatus('Error: File name required')
      return
    }
    const path = newFileName.startsWith('/') ? newFileName : `/${newFileName}`
    await writeFile(path, newFileContent || '')
    setStatus(`Created: ${path}`)
    setNewFileName('')
    setNewFileContent('')
    await loadFiles()
    setTimeout(() => setStatus(''), 2000)
  }

  const handleDeleteFile = async (path: string) => {
    if (confirm(`Delete ${path}?`)) {
      await removeFile(path)
      setStatus(`Deleted: ${path}`)
      if (selectedFile === path) {
        setSelectedFile(null)
        setFileContent('')
      }
      await loadFiles()
      setTimeout(() => setStatus(''), 2000)
    }
  }

  const handleSaveFile = async () => {
    if (!selectedFile) return
    await writeFile(selectedFile, fileContent)
    setStatus(`Saved: ${selectedFile}`)
    setTimeout(() => setStatus(''), 2000)
  }

  return (
    <div className="flex flex-col h-full bg-gray-700">
      <div className="flex gap-3 h-full">
        {/* File List */}
        <div className="w-1/3 flex flex-col border-r border-gray-300 pr-3">
          <div className="font-semibold mb-2 text-sm">Files ({files.length})</div>
          <div className="flex-1 overflow-auto bg-gray-800 rounded border border-gray-300 p-2">
            {files.map(file => (
              <div
                key={file}
                className={`px-2 py-1 rounded cursor-pointer hover:bg-blue-100 text-sm flex justify-between items-center ${
                  selectedFile === file ? 'bg-blue-200' : ''
                }`}
              >
                <span onClick={() => handleFileClick(file)} className="flex-1 truncate">
                  📄 {file}
                </span>
                <button
                  onClick={() => handleDeleteFile(file)}
                  className="ml-2 text-red-600 hover:text-red-800 text-xs"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            ))}
            {files.length === 0 && (
              <div className="text-gray-400 text-sm text-center py-4">No files</div>
            )}
          </div>
        </div>

        {/* File Content */}
        <div className="flex-1 flex flex-col">
          {selectedFile ? (
            <>
              <div className="font-semibold mb-2 text-sm">
                Editing: <span className="text-blue-600">{selectedFile}</span>
              </div>
              <textarea
                className="flex-1 p-2 bg-gray-50 text-black rounded border border-gray-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                value={fileContent}
                onChange={e => setFileContent(e.target.value)}
              />
              <div className="mt-2">
                <button
                  onClick={handleSaveFile}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-white text-sm font-medium transition-colors"
                >
                  💾 Save
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              Select a file to edit
            </div>
          )}
        </div>
      </div>

      {/* Create New File */}
      <div className="mt-3 pt-3 border-t border-gray-300">
        <div className="font-semibold mb-2 text-sm">Create New File</div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="File path (e.g., /home/myfile.txt)"
            value={newFileName}
            onChange={e => setNewFileName(e.target.value)}
            className="flex-1 px-2 py-1 rounded border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            placeholder="Initial content (optional)"
            value={newFileContent}
            onChange={e => setNewFileContent(e.target.value)}
            className="flex-1 px-2 py-1 rounded border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleCreateFile}
            className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-white text-sm font-medium transition-colors"
          >
            ➕ Create
          </button>
        </div>
        {status && (
          <div className="mt-2 text-sm text-green-600 font-medium">{status}</div>
        )}
      </div>
    </div>
  )
}

// Register globally
window.__FILE_BROWSER_UI__ = FileBrowser
