import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { toast } from '../../hooks/use-toast'
import { readFile, readdir, removeFile, writeFile } from '../../vfs/fs'
import { getFileTypeDescription, isEditable, tryDecodeText } from '../../vfs/fileTypes'
import { uploadFile, uploadFiles } from '../../utils/fileUpload'

type FileNode = {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

type FileNodeMap = Record<string, { name: string; path: string; isDir: boolean; children?: FileNodeMap }>

const normalizePath = (path: string) => (path.startsWith('/') ? path : `/${path}`)

const buildTree = (paths: string[], filter: string): FileNode[] => {
  const root: FileNodeMap = {}
  const matchesFilter = (value: string) => value.toLowerCase().includes(filter.toLowerCase())

  paths.forEach(rawPath => {
    const path = normalizePath(rawPath)
    const parts = path.split('/').filter(Boolean)
    let cursor: FileNodeMap = root
    let prefix = ''

    parts.forEach((part, idx) => {
      prefix += `/${part}`
      const isLast = idx === parts.length - 1
      if (!cursor[part]) {
        cursor[part] = { name: part, path: prefix, isDir: !isLast, children: isLast ? undefined : {} }
      }
      if (!isLast && cursor[part].children) {
        cursor = cursor[part].children
      }
    })
  })

  const sortNodes = (nodes: FileNode[]) =>
    [...nodes].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  const toArray = (nodes: FileNodeMap): FileNode[] =>
    sortNodes(
      Object.values(nodes)
        .map(node => {
          if (node.children) {
            return { name: node.name, path: node.path, isDir: node.isDir, children: toArray(node.children) }
          }
          return { name: node.name, path: node.path, isDir: node.isDir }
        })
        .map(node => {
          if (node.isDir && node.children) {
            const filteredChildren = filterTree(node.children)
            if (filteredChildren.length > 0 || matchesFilter(node.name) || matchesFilter(node.path)) {
              return { ...node, children: filteredChildren }
            }
            return null
          }
          return matchesFilter(node.name) || matchesFilter(node.path) || filter === '' ? node : null
        })
        .filter(Boolean) as FileNode[]
    )

  const filterTree = (nodes: FileNode[]): FileNode[] =>
    sortNodes(
      nodes
        .map(node => {
          if (node.isDir && node.children) {
            const filteredChildren = filterTree(node.children)
            if (filteredChildren.length || matchesFilter(node.name) || matchesFilter(node.path)) {
              return { ...node, children: filteredChildren }
            }
            return null
          }
          return matchesFilter(node.name) || matchesFilter(node.path) || filter === '' ? node : null
        })
        .filter(Boolean) as FileNode[]
    )

  return toArray(root)
}

function LineNumbers({ content, innerRef }: { content: string; innerRef?: React.Ref<HTMLDivElement> }) {
  const lines = content.split('\n')
  return (
    <div
      ref={innerRef as any}
      className="w-12 flex flex-col items-end pr-3 pt-4 text-slate-400 dark:text-[#4d6a8b] bg-slate-50 dark:bg-[#111a22] select-none border-r border-slate-200 dark:border-[#233648]/50 shrink-0 overflow-hidden h-full"
    >
      {lines.map((_, idx) => (
        <div key={idx}>{idx + 1}</div>
      ))}
    </div>
  )
}

const getLanguageFromPath = (path: string | null): string => {
  if (!path) return 'plaintext'
  const lower = path.toLowerCase()
  if (lower.endsWith('.tsx') || lower.endsWith('.ts')) return 'typescript'
  if (lower.endsWith('.jsx') || lower.endsWith('.js')) return 'javascript'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.rs')) return 'rust'
  return 'plaintext'
}

const isPreviewableFile = (path: string): boolean => {
  if (!path) return false
  const lower = path.toLowerCase()
  return (
    lower.endsWith('.pdf') ||
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.svg')
  )
}

function FileRow({
  node,
  depth,
  selected,
  onSelect,
  onDelete,
  isExpanded,
  onToggle,
  onDirectorySelect,
}: {
  node: FileNode
  depth: number
  selected: string | null
  onSelect: (path: string) => void
  onDelete: (path: string) => void
  isExpanded: (path: string) => boolean
  onToggle: (path: string) => void
  onDirectorySelect: (path: string) => void
}) {
  const padding = depth * 12
  const iconClass = node.isDir
    ? isExpanded(node.path)
      ? 'fa-folder-open text-yellow-500'
      : 'fa-folder text-yellow-500'
    : 'fa-file-lines text-purple-400'
  const isCurrent = selected === node.path

  const handleClick = () => {
    if (node.isDir) {
      onToggle(node.path)
      onDirectorySelect(node.path)
    } else {
      onSelect(node.path)
    }
  }

  return (
    <div className="space-y-0.5">
      <div
        className={`group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-[#233648] transition-colors ${isCurrent ? 'bg-primary/10 text-primary' : 'text-slate-700 dark:text-[#92adc9]'
          }`}
        style={{ paddingLeft: padding + 8 }}
      >
        <div className="flex items-center gap-2 min-w-0 cursor-pointer" onClick={handleClick}>
          <i className={`fa-solid ${iconClass} text-[18px]`}></i>
          <span className="text-sm truncate font-medium">{node.name}</span>
        </div>
        {!node.isDir && (
          <button
            onClick={() => onDelete(node.path)}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 hover:text-red-500 rounded transition-all"
            title="Delete"
          >
            <i className="fa-solid fa-trash text-[14px]"></i>
          </button>
        )}
      </div>
      {node.isDir && isExpanded(node.path) && node.children && node.children.length > 0 && (
        <div className="border-l border-slate-200 dark:border-[#233648] ml-3.5">
          {node.children.map(child => (
            <FileRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              onDelete={onDelete}
              isExpanded={isExpanded}
              onToggle={onToggle}
              onDirectorySelect={onDirectorySelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Explorer({
  tree,
  selected,
  onSelect,
  onDelete,
  expanded,
  setExpanded,
  onDirectorySelect,
}: {
  tree: FileNode[]
  selected: string | null
  onSelect: (path: string) => void
  onDelete: (path: string) => void
  expanded: Set<string>
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>
  onDirectorySelect: (path: string) => void
}) {
  const isExpanded = (path: string) => expanded.has(path)
  const onToggle = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div className="scrollbar flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
      {tree.length === 0 && <div className="text-sm text-slate-500 dark:text-[#92adc9] px-2 py-4">No files yet</div>}
      {tree.map(node => (
        <FileRow
          key={node.path}
          node={node}
          depth={0}
          selected={selected}
          onSelect={onSelect}
          onDelete={onDelete}
          isExpanded={isExpanded}
          onToggle={onToggle}
          onDirectorySelect={onDirectorySelect}
        />
      ))}
    </div>
  )
}

function EditorPane(
  props: {
    path: string | null
    content: string
    onChange: (value: string) => void
    readOnly: boolean
    textareaRef?: React.RefObject<HTMLTextAreaElement>
    onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
    showLineNumbers?: boolean
    binaryData?: Uint8Array | null
  }
) {
  const { path, content, onChange, readOnly, textareaRef, onKeyDown, showLineNumbers, binaryData } = props
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  const localTextareaRef = React.useRef<HTMLTextAreaElement>(null)
  const actualTextareaRef = textareaRef || localTextareaRef
  const lineNumbersRef = React.useRef<HTMLDivElement>(null)

  const handleTextareaScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop
    }
  }

  if (!path) {
    return (
      <div className="absolute inset-0 bg-white dark:bg-[#111a22] flex flex-col items-center justify-center">
        <div className="w-52 h-52 bg-slate-100 dark:bg-[#1a2632] rounded-full flex items-center justify-center mb-6">
          <i className="fa-regular fa-file-lines text-[48px] text-slate-300 dark:text-[#344c63]"></i>
        </div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">No file selected</h3>
        <p className="text-slate-500 dark:text-[#92adc9] max-w-sm text-center mb-6">Select a file from the explorer on the left to start editing code.</p>
      </div>
    )
  }

  const language = getLanguageFromPath(path)

  // Show image/PDF preview if binary data exists
  if (binaryData && isPreviewableFile(path || '')) {
    const lower = path?.toLowerCase() || ''
    const isPdf = lower.endsWith('.pdf')
    const isImage = lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp') || lower.endsWith('.svg')
    
    if (isImage) {
      const blob = new Blob([binaryData instanceof Uint8Array ? new Uint8Array(binaryData) : binaryData])
      const url = URL.createObjectURL(blob)
      return (
        <div className="flex flex-1 overflow-hidden bg-white dark:bg-[#161f29]">
          <div className="flex-1 flex items-center justify-center overflow-auto">
            <img src={url} alt={path} className="max-w-full max-h-full object-contain" />
          </div>
        </div>
      )
    } else if (isPdf) {
      const arr = binaryData instanceof Uint8Array ? new Uint8Array(binaryData) : new Uint8Array([])
      const blob = new Blob([arr.buffer], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      return (
        <div className="flex flex-1 overflow-hidden bg-slate-100 dark:bg-[#0a0a0a]">
          <iframe 
            src={url}
            className="w-full h-full border-none"
            title={`PDF: ${path}`}
          />
        </div>
      )
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden font-mono text-sm leading-6 relative bg-white dark:bg-[#161f29]">
      <div ref={scrollContainerRef} className="flex h-full w-full overflow-hidden">
        {showLineNumbers && <LineNumbers content={content || '\n'} innerRef={lineNumbersRef} />}
        <div className="flex-1 h-full overflow-hidden">
          <textarea
            ref={actualTextareaRef}
            className={`scrollbar w-full h-[100%] min-h-[74vh] p-4 bg-transparent outline-none resize-none font-mono text-sm whitespace-pre text-slate-800 dark:text-slate-300 language-${language}`}
            value={content}
            readOnly={readOnly}
            onChange={e => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onScroll={handleTextareaScroll}
            spellCheck={false}
            style={{ lineHeight: '1.5rem' }}
          />
        </div>
      </div>
    </div>
  )
}

export default function Workspace() {
  const [paths, setPaths] = useState<string[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [currentDirectory, setCurrentDirectory] = useState<string>('/home')
  const [fileContent, setFileContent] = useState('')
  const [loadedContent, setLoadedContent] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [newFileContent, setNewFileContent] = useState('')
  const [status, setStatus] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['/']))
  const [loading, setLoading] = useState(false)
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [editMenuOpen, setEditMenuOpen] = useState(false)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(256)
  const [isResizing, setIsResizing] = useState(false)
  const [isFolderMode, setIsFolderMode] = useState(false)
  const [showLineNumbers, setShowLineNumbers] = useState(true)
  const [binaryData, setBinaryData] = useState<Uint8Array | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const newEntryInputRef = useRef<HTMLInputElement>(null)

  const hasUnsavedChanges = useMemo(
    () => !!selectedPath && fileContent !== loadedContent,
    [fileContent, loadedContent, selectedPath]
  )

  const tree = useMemo(() => buildTree(paths, searchQuery), [paths, searchQuery])

  const refreshFiles = async () => {
    const all = await readdir('')
    setPaths(all.sort())
    if (selectedPath && !all.includes(selectedPath)) {
      setSelectedPath(null)
      setFileContent('')
      setLoadedContent('')
      setBinaryData(null)
    }
  }

  useEffect(() => {
    refreshFiles().catch(console.error)
    
    // Auto-refresh when sync status changes (especially after pull/push)
    const handleSyncStatusChange = (e: Event) => {
      const detail = (e as CustomEvent).detail
      // Refresh after pull completes or when syncing stops (includes pull operations)
      if (detail && !detail.syncing && !detail.pulling) {
        refreshFiles().catch(console.error)
      }
    }
    
    // Auto-refresh when VFS changes (file write/delete operations)
    const handleVfsChange = () => {
      refreshFiles().catch(console.error)
    }
    
    window.addEventListener('microos:sync-status-changed', handleSyncStatusChange)
    window.addEventListener('microos:vfs-changed', handleVfsChange)
    
    return () => {
      window.removeEventListener('microos:sync-status-changed', handleSyncStatusChange)
      window.removeEventListener('microos:vfs-changed', handleVfsChange)
    }
  }, [])

  const showStatus = (message: string, duration = 2000) => {
    setStatus(message)
    if (duration) setTimeout(() => setStatus(''), duration)
  }

  const openFile = async (path: string) => {
    const normalized = normalizePath(path)
    setLoading(true)
    try {
      const data = await readFile(normalized)
      setSelectedPath(normalized)
      // Debug: log data type and value
      console.debug('[openFile] Data type:', typeof data, 'instanceof Uint8Array:', data instanceof Uint8Array, 'Array.isArray:', Array.isArray(data), 'value:', data)
      if (data === undefined || data === null) {
        console.warn('[openFile] File not found or undefined/null from VFS:', normalized, data)
        setFileContent('[File not found]')
        setLoadedContent('[File not found]')
        setReadOnly(true)
      } else if (typeof data === 'string') {
        setFileContent(data)
        setLoadedContent(data)
        setReadOnly(false)
        showStatus(`Opened ${normalized}`)
      } else if (data instanceof Uint8Array) {
        // Try to decode as text using tryDecodeText
        const decoded = tryDecodeText(data)
        if (decoded !== null) {
          setFileContent(decoded)
          setLoadedContent(decoded)
          setBinaryData(null)
          setReadOnly(false)
          showStatus(`Opened ${normalized} (${getFileTypeDescription(normalized)})`)
        } else if (isPreviewableFile(normalized)) {
          // Store binary data for preview
          setBinaryData(data)
          setFileContent('')
          setLoadedContent('')
          setReadOnly(true)
          showStatus('Preview - read only')
        } else {
          setFileContent(`[Binary file: ${data.length} bytes - ${getFileTypeDescription(normalized)}]`)
          setLoadedContent(`[Binary file: ${data.length} bytes - ${getFileTypeDescription(normalized)}]`)
          setBinaryData(null)
          setReadOnly(true)
          showStatus('Binary preview - read only')
        }
      } else if (Array.isArray(data)) {
        // Handle case where IndexedDB returns an array (should be Uint8Array)
        const arr = new Uint8Array(data)
        const decoded = tryDecodeText(arr)
        if (decoded !== null) {
          setFileContent(decoded)
          setLoadedContent(decoded)
          setBinaryData(null)
          setReadOnly(false)
          showStatus(`Opened ${normalized} (${getFileTypeDescription(normalized)})`)
        } else if (isPreviewableFile(normalized)) {
          // Store binary data for preview
          setBinaryData(arr)
          setFileContent('')
          setLoadedContent('')
          setReadOnly(true)
          showStatus('Preview - read only')
        } else {
          setFileContent(`[Binary file: ${arr.length} bytes - ${getFileTypeDescription(normalized)}]`)
          setLoadedContent(`[Binary file: ${arr.length} bytes - ${getFileTypeDescription(normalized)}]`)
          setBinaryData(null)
          setReadOnly(true)
          showStatus('Binary preview - read only')
        }
      } else {
        // Debug: log unknown data type
        console.error('[openFile] Unknown data type for file:', normalized, data)
        setFileContent('[File not found]')
        setLoadedContent('[File not found]')
        setReadOnly(true)
      }
      setExpanded(prev => new Set(prev).add(normalized.split('/').slice(0, -1).join('/') || '/'))
    } catch (err) {
      console.error('[openFile] Exception:', err)
      showStatus('Unable to open file', 2500)
    } finally {
      setLoading(false)
    }
  }

  const saveFile = async () => {
    if (!selectedPath || readOnly) return
    await writeFile(selectedPath, fileContent)
    setLoadedContent(fileContent)
    showStatus(`Saved ${selectedPath}`)
  }

  const createFile = async () => {
    if (!newFileName.trim()) {
      showStatus('File name required', 2000)
      return
    }
    const path = normalizePath(newFileName.trim())
    if (isFolderMode) {
      // Create folder with a .gitkeep file
      await writeFile(path + '/.gitkeep', '')
      await refreshFiles()
      setNewFileName('')
      setIsFolderMode(false)
      showStatus(`Created folder ${path}`)
    } else {
      await writeFile(path, newFileContent)
      setNewFileName('')
      setNewFileContent('')
      await refreshFiles()
      await openFile(path)
      showStatus(`Created ${path}`)
    }
  }

  const deleteFile = async (path: string) => {
    const { dismiss } = toast({
      title: 'Delete file?',
      description: path,
      action: (
        <button
          onClick={async () => {
            dismiss()
            await removeFile(path)
            if (selectedPath === path) {
              setSelectedPath(null)
              setFileContent('')
              setLoadedContent('')
              setBinaryData(null)
            }
            await refreshFiles()
            showStatus(`Deleted ${path}`)
          }}
          className="px-3 py-1 text-sm bg-red-600 rounded hover:bg-red-700 text-white"
        >
          Delete
        </button>
      ),
    })
  }

  const breadcrumbs = selectedPath
    ? normalizePath(selectedPath).split('/').filter(Boolean)
    : []

  const lines = Math.max(fileContent.split('\n').length, 1)

  const currentDir = selectedPath
    ? normalizePath(selectedPath).split('/').slice(0, -1).join('/') || '/'
    : '/'

  const handleUpload = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files
      if (files && files.length > 0) {
        try {
          showStatus(`Uploading ${files.length} file(s)...`)
          
          // Use the tracked currentDirectory
          const targetDir = currentDirectory || '/home'
          
          // Use the centralized batch upload function
          await uploadFiles(files, targetDir, (current, total, fileName) => {
            showStatus(`Uploading ${current}/${total}: ${fileName}`)
          })
          
          await refreshFiles()
          showStatus(`✓ Uploaded ${files.length} file(s) to ${targetDir}`)
        } catch (error) {
          showStatus(`✗ Upload failed: ${error}`)
          console.error('Upload error:', error)
        }
      }
    }
    input.click()
  }

  const handleCreateFolder = () => {
    setIsFolderMode(true)
    setNewFileName('')
    setTimeout(() => newEntryInputRef.current?.focus(), 50)
  }

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing) {
        const newWidth = Math.max(200, Math.min(e.clientX, 600))
        setSidebarWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isResizing])

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed)
  }

  const downloadFile = async () => {
    if (!selectedPath) return
    try {
      const content = await readFile(selectedPath)
      if (content === undefined) {
        showStatus('File not found')
        return
      }

      let blob: Blob
      if (typeof content === 'string') {
        blob = new Blob([content], { type: 'text/plain' })
      } else if (content instanceof Uint8Array) {
        blob = new Blob([content as any])
      } else if (Array.isArray(content)) {
        blob = new Blob([new Uint8Array(content)])
      } else {
        showStatus('Unable to download file')
        return
      }

      const fileName = selectedPath.split('/').pop() || 'file'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showStatus(`Downloaded ${fileName}`)
    } catch (error) {
      showStatus(`Download failed: ${error}`)
      console.error('Download error:', error)
    }
  }

  // Keyboard shortcut handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ctrl = e.ctrlKey
    const key = e.key.toLowerCase()

    // Close menus on any keypress
    if (fileMenuOpen || editMenuOpen || viewMenuOpen) {
      setFileMenuOpen(false)
      setEditMenuOpen(false)
      setViewMenuOpen(false)
    }

    if (ctrl) {
      switch (key) {
        case 'o': // Open file
          e.preventDefault()
          setIsFolderMode(false)
          newEntryInputRef.current?.focus()
          showStatus('Type file path to open')
          break
        case 's': // Save
          e.preventDefault()
          saveFile()
          break
        case 'f': // Find
          e.preventDefault()
          document.querySelector<HTMLInputElement>('input[placeholder="Search files"]')?.focus()
          break
        case 'g': // Go to line (placeholder for now)
          e.preventDefault()
          const line = prompt('Go to line:')
          if (line && textareaRef.current) {
            const lineNum = parseInt(line, 10) - 1
            if (isNaN(lineNum) || lineNum < 0) break
            const lines = fileContent.split('\n')
            let charCount = 0
            for (let i = 0; i < lineNum && i < lines.length; i++) {
              charCount += lines[i].length + 1 // +1 for newline
            }
            textareaRef.current.focus()
            textareaRef.current.setSelectionRange(charCount, charCount)
          }
          break
        case 'z': // Undo
          e.preventDefault()
          document.execCommand('undo')
          break
        case 'y': // Redo
          e.preventDefault()
          document.execCommand('redo')
          break
        case 'home': // Go to start of document
          e.preventDefault()
          if (textareaRef.current) {
            textareaRef.current.setSelectionRange(0, 0)
            textareaRef.current.scrollTop = 0
          }
          break
        case 'end': // Go to end of document
          e.preventDefault()
          if (textareaRef.current) {
            const len = fileContent.length
            textareaRef.current.setSelectionRange(len, len)
            textareaRef.current.scrollTop = textareaRef.current.scrollHeight
          }
          break
      }
    }
  }, [fileContent, fileMenuOpen, editMenuOpen, viewMenuOpen, saveFile, showStatus])

  return (
    <div className="bg-background-light dark:bg-background-dark font-display text-slate-900 dark:text-white overflow-hidden h-full flex flex-col">
      <header className="flex items-center w-full justify-between whitespace-nowrap border-b border-solid border-slate-200 dark:border-[#233648] px-6 py-3 bg-white dark:bg-[#111a22] shrink-0 z-20">
        <div className="flex items-center gap-4">
          <button
            id='PsideBar'
            onClick={toggleSidebar}
            className="flex items-center gap-2 text-sm text-slate-500 dark:text-[#92adc9] hover:text-primary transition-colors cursor-pointer"
            title="Toggle sidebar"
          >
            <i className={`fa-solid ${sidebarCollapsed ? 'fa-bars' : 'fa-folder-open'} text-[16px]`}></i>
            {!sidebarCollapsed && <span className="truncate max-w-[200px]">{currentDirectory}</span>}
          </button>
        </div>
        <div className="flex flex-1 justify-center max-w-xl px-4">
          <label className="relative flex w-full">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400 dark:text-[#92adc9]">
              <i className="fa-solid fa-magnifying-glass"></i>
            </div>
            <input
              className="block w-full rounded-lg border-none bg-slate-100 dark:bg-[#233648] py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-[#92adc9] focus:ring-2 focus:ring-primary"
              placeholder="Search files"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleUpload}
            className={`pointer flex items-center border-1 border-white gap-2 px-3 py-1.5 rounded font-medium transition-colors ${hasUnsavedChanges && !readOnly ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-[#233648] text-slate-700 dark:text-white opacity-60 cursor-not-allowed'}`}
            title="Upload file"
          >
            <svg
              width="20"
              height="20"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 340.531 419.116"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeWidth="2"
              stroke="#000000"
            >
              <g id="files-new" clipPath="url(#clip-files-new)">
                <path
                  id="Union_2"
                  data-name="Union 2"
                  d="M-2904.708-8.885A39.292,39.292,0,0,1-2944-48.177V-388.708A39.292,39.292,0,0,1-2904.708-428h209.558a13.1,13.1,0,0,1,9.3,3.8l78.584,78.584a13.1,13.1,0,0,1,3.8,9.3V-48.177a39.292,39.292,0,0,1-39.292,39.292Zm-13.1-379.823V-48.177a13.1,13.1,0,0,0,13.1,13.1h261.947a13.1,13.1,0,0,0,13.1-13.1V-323.221h-52.39a26.2,26.2,0,0,1-26.194-26.195v-52.39h-196.46A13.1,13.1,0,0,0-2917.805-388.708Zm146.5,241.621a14.269,14.269,0,0,1-7.883-12.758v-19.113h-68.841c-7.869,0-7.87-47.619,0-47.619h68.842v-18.8a14.271,14.271,0,0,1,7.882-12.758,14.239,14.239,0,0,1,14.925,1.354l57.019,42.764c.242.185.328.485.555.671a13.9,13.9,0,0,1,2.751,3.292,14.57,14.57,0,0,1,.984,1.454,14.114,14.114,0,0,1,1.411,5.987,14.006,14.006,0,0,1-1.411,5.973,14.653,14.653,0,0,1-.984,1.468,13.9,13.9,0,0,1-2.751,3.293c-.228.2-.313.485-.555.671l-57.019,42.764a14.26,14.26,0,0,1-8.558,2.847A14.326,14.326,0,0,1-2771.3-147.087Z"
                  transform="translate(2944 428)"
                  fill="#ffffff"
                ></path>
              </g>
            </svg>
            <span className="hidden sm:inline">Upload</span>
          </button>
          <div className="hidden lg:flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-[#92adc9] relative">
            <div className="relative">
              <button onClick={() => { setFileMenuOpen(!fileMenuOpen); setEditMenuOpen(false); setViewMenuOpen(false) }} className="px-2 py-1 hover:bg-gray-700 dark:hover:bg-[#233648] rounded transition-colors">File</button>
              {fileMenuOpen && (
                <div className="absolute top-full left-0 mt-1 bg-gray-800 dark:bg-gray-800 border border-gray-600 shadow-lg py-1 min-w-[180px] z-50">
                  <button onClick={() => { setFileMenuOpen(false); newEntryInputRef.current?.focus() }} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 flex justify-between text-sm">
                    <span>Open</span><span className="text-gray-400">Ctrl+O</span>
                  </button>
                  <button onClick={() => { saveFile(); setFileMenuOpen(false) }} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 flex justify-between text-sm" disabled={!selectedPath || readOnly}>
                    <span>Save</span><span className="text-gray-400">Ctrl+S</span>
                  </button>
                  <button onClick={() => { saveFile(); setFileMenuOpen(false) }} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 text-sm">
                    <span>Save As...</span>
                  </button>
                </div>
              )}
            </div>
            <div className="relative">
              <button onClick={() => { setEditMenuOpen(!editMenuOpen); setFileMenuOpen(false); setViewMenuOpen(false) }} className="px-2 py-1 hover:bg-gray-700 dark:hover:bg-[#233648] rounded transition-colors">Edit</button>
              {editMenuOpen && (
                <div className="absolute top-full left-0 mt-1 bg-gray-800 dark:bg-gray-800 border border-gray-600 shadow-lg py-1 min-w-[180px] z-50">
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 flex justify-between text-sm">
                    <span>Undo</span><span className="text-gray-400">Ctrl+Z</span>
                  </button>
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 flex justify-between text-sm">
                    <span>Redo</span><span className="text-gray-400">Ctrl+Y</span>
                  </button>
                  <div className="border-t border-gray-600 my-1"></div>
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 flex justify-between text-sm">
                    <span>Cut</span><span className="text-gray-400">Ctrl+X</span>
                  </button>
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 flex justify-between text-sm">
                    <span>Copy</span><span className="text-gray-400">Ctrl+C</span>
                  </button>
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 flex justify-between text-sm">
                    <span>Paste</span><span className="text-gray-400">Ctrl+V</span>
                  </button>
                  <div className="border-t border-gray-600 my-1"></div>
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 flex justify-between text-sm">
                    <span>Find</span><span className="text-gray-400">Ctrl+F</span>
                  </button>
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 flex justify-between text-sm">
                    <span>Replace</span><span className="text-gray-400">Ctrl+H</span>
                  </button>
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 flex justify-between text-sm">
                    <span>Go to Line</span><span className="text-gray-400">Ctrl+G</span>
                  </button>
                </div>
              )}
            </div>
            <div className="relative">
              <button onClick={() => { setViewMenuOpen(!viewMenuOpen); setFileMenuOpen(false); setEditMenuOpen(false) }} className="px-2 py-1 hover:bg-gray-700 dark:hover:bg-[#233648] rounded transition-colors">View</button>
              {viewMenuOpen && (
                <div className="absolute top-full left-0 mt-1 bg-gray-800 dark:bg-gray-800 border border-gray-600 shadow-lg py-1 min-w-[180px] z-50">
                  <button onClick={() => { setViewMenuOpen(false) }} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 flex justify-between text-sm">
                    <span>Help</span><span className="text-gray-400">?</span>
                  </button>
                  <div className="border-t border-gray-600 my-1"></div>
                  <button onClick={() => {
                    const words = fileContent.trim().split(/\s+/).filter(w => w.length > 0).length;
                    const chars = fileContent.length;
                    showStatus(`Words: ${words} | Characters: ${chars} | Lines: ${lines}`);
                    setViewMenuOpen(false);
                  }} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 text-sm">
                    <span>Word Count</span>
                  </button>
                  <button onClick={() => { setShowLineNumbers(v => !v); setViewMenuOpen(false) }} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 text-sm">
                    <span>{showLineNumbers ? 'Hide Line Numbers' : 'Show Line Numbers'}</span>
                  </button>
                  <button onClick={() => { refreshFiles(); setViewMenuOpen(false) }} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 text-sm">
                    <span>Refresh Files</span>
                  </button>
                  <button onClick={() => { toggleSidebar(); setViewMenuOpen(false) }} className="w-full px-3 py-1 text-left text-white hover:bg-blue-600 text-sm">
                    <span>Toggle Sidebar</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={saveFile}
            disabled={!hasUnsavedChanges || readOnly || !selectedPath}
            aria-label="save"
            className={`action_has has_saved flex items-center border-1 border-white gap-2 px-3 py-1.5 rounded font-medium transition-colors ${hasUnsavedChanges && !readOnly ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-[#233648] text-slate-700 dark:text-white opacity-60 cursor-not-allowed'}`}
            title="Save"
          >
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
              fill="none"
            >
              <path
                d="m19,21H5c-1.1,0-2-.9-2-2V5c0-1.1.9-2,2-2h11l5,5v11c0,1.1-.9,2-2,2Z"
                strokeLinejoin="round"
                strokeLinecap="round"
                data-path="box"
              ></path>

              <path
                d="M7 3L7 8L15 8"
                strokeLinejoin="round"
                strokeLinecap="round"
                data-path="line-top"
              ></path>
              <path
                d="M17 20L17 13L7 13L7 20"
                strokeLinejoin="round"
                strokeLinecap="round"
                data-path="line-bottom"
              ></path>
            </svg>
            <span className="hidden sm:inline">Save</span>
          </button>
          <div className="flex gap-2 items-center"></div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {!sidebarCollapsed && (
          <aside
            className="flex flex-col border-r border-slate-200 bg-white dark:bg-[#111a22] dark:border-[#233648] bg-slate-50 dark:bg-sidebar-dark shrink-0 relative"
            style={{ width: `${sidebarWidth}px` }}
          >
            <div className="px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-[#233648]/50">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#92adc9]">Explorer</span>
              <div className='flex gap-0'>
                <button
                  onClick={() => { setIsFolderMode(false); setNewFileName(''); setTimeout(() => newEntryInputRef.current?.focus(), 50) }}
                  className="flex items-center gap-1 p-1 text-s text-slate-600 dark:text-[#92adc9] hover:text-primary transition-colors"
                  title="New file"
                >
                  <i className="fa-solid fa-file-circle-plus"></i>
                </button>
                <button
                  onClick={handleCreateFolder}
                  className="flex items-center gap-1 p-1 text-s text-slate-600 dark:text-[#92adc9] hover:text-primary transition-colors"
                  title="New folder"
                >
                  <i className="fa-solid fa-folder-plus"></i>                </button>
                <button
                  onClick={refreshFiles} title="Refresh"
                  className="flex items-center gap-1 p-1 text-s text-slate-600 dark:text-[#92adc9] hover:text-primary transition-colors">
                  <i className="fa-solid fa-arrows-rotate"></i>                </button>
              </div>
            </div>
            <Explorer
              tree={tree}
              selected={selectedPath}
              onSelect={openFile}
              onDelete={deleteFile}
              expanded={expanded}
              setExpanded={setExpanded}
              onDirectorySelect={setCurrentDirectory}
            />
            <div className="p-3 border-t border-slate-200 dark:border-[#233648] bg-slate-100 dark:bg-[#111a22]">
              <div className="relative">
                <input
                  ref={newEntryInputRef}
                  className="w-full bg-white dark:bg-[#1a2632] border border-slate-300 dark:border-[#344c63] rounded py-1.5 pl-2 pr-8 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                  placeholder={isFolderMode ? "/home/new-folder" : "/home/new-file.txt"}
                  value={newFileName}
                  onChange={e => setNewFileName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createFile()}
                />
                <button className="absolute right-1 top-1.5 p-0.5 text-primary hover:text-blue-400" onClick={createFile} title={isFolderMode ? "Create folder" : "Create file"}>
                  <i className={`fa-solid ${isFolderMode ? 'fa-folder-plus' : 'fa-circle-plus'} text-[18px]`}></i>
                </button>
              </div>
            </div>
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/50 transition-colors"
              onMouseDown={startResize}
            />
          </aside>
        )}

        <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#111a22] relative">
          <div className="flex items-center gap-2 px-4 h-10 border-b border-slate-200 dark:border-[#233648] bg-slate-50 dark:bg-[#111a22]">
            <div className="flex items-center gap-1 text-sm text-slate-500 dark:text-[#92adc9] truncate">
              {breadcrumbs.length === 0 && <span className="text-slate-400">No file</span>}
              {breadcrumbs.map((part, idx) => (
                <React.Fragment key={idx}>
                  <span className="hover:underline cursor-pointer" onClick={() => openFile('/' + breadcrumbs.slice(0, idx + 1).join('/'))}>
                    {part}
                  </span>
                  {idx < breadcrumbs.length - 1 && <span className="text-slate-300 dark:text-[#233648]">/</span>}
                </React.Fragment>
              ))}
            </div>
            {selectedPath && (
              <div className="flex items-center gap-2 ml-auto">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-white bg-slate-200 dark:bg-[#233648] px-3 py-1 rounded-full">
                  <i className="fa-regular fa-file-lines text-[15px] text-blue-500"></i>
                  <span className="truncate max-w-[280px]">{selectedPath}</span>
                  <button className="ml-1 hover:text-red-400 flex items-center" onClick={() => setSelectedPath(null)}>
                    <i className="fa-solid fa-xmark text-[12px]"></i>
                  </button>
                </div>
                <button
                  onClick={downloadFile}
                  className="p-1.5 text-slate-600 dark:text-[#92adc9] hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                  title="Download file"
                >
                  <i className="fa-solid fa-download text-[14px]"></i>
                </button>
              </div>
            )}
          </div>

          <div className="relative flex-1">
            <EditorPane path={selectedPath} content={fileContent} onChange={setFileContent} readOnly={readOnly} textareaRef={textareaRef} onKeyDown={handleKeyDown} showLineNumbers={showLineNumbers} binaryData={binaryData} />
            {loading && (
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center text-white text-sm">Loading...</div>
            )}
          </div>

          <div className="absolute inset-x-0 bottom-0 h-6 bg-[#111A22] text-white flex w-full items-center px-4 justify-between text-xs font-mono shrink-0">
            <div className="flex items-center gap-3 overflow-hidden">
              <span className="truncate max-w-[320px]">{selectedPath || 'No file selected'}</span>
              {readOnly && <span className="uppercase tracking-wide">Read only</span>}
              {hasUnsavedChanges && !readOnly && <span className="uppercase tracking-wide">Unsaved</span>}
              {status && <span className="font-semibold">{status}</span>}
            </div>
            <div className="flex items-center gap-4 opacity-80">
              <span>{lines} lines</span>
              <span>{fileContent.length} chars</span>
              <span>{selectedPath ? getFileTypeDescription(selectedPath) : '-'}</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

// unified registration so both "Files" and "Zynqpad" use the same workspace UI
; (window as any).__FILE_BROWSER_UI__ = Workspace
  ; (window as any).__TEXT_EDITOR_UI__ = Workspace
