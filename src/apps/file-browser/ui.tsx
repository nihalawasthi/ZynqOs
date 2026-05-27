import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { toast } from '../../hooks/use-toast'
import { readFile, readdir, removeFile, writeFile } from '../../vfs/fs'
import { getFileTypeDescription, isEditable, tryDecodeText } from '../../vfs/fileTypes'
import { uploadFile, uploadFiles } from '../../utils/fileUpload'
import { githubSync } from '../../storage/githubSync'

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
      className="w-12 flex flex-col items-end pr-3 pt-4 text-[var(--text-color)] bg-[var(--bg-color)] select-none border-r border-[var(--border-color)] shrink-0 overflow-hidden h-full opacity-60"
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
        className={`group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-gray-500/20 transition-colors ${
          isCurrent ? 'bg-blue-500/20 text-blue-400' : 'text-[var(--text-color)]'
        }`}
        style={{ paddingLeft: padding + 8 }}
      >
        <div className="flex items-center gap-2 min-w-0 cursor-pointer opacity-90" onClick={handleClick}>
          <i className={`fa-solid ${iconClass} text-[18px]`}></i>
          <span className="text-sm truncate font-medium">{node.name}</span>
        </div>
        <button
          onClick={() => onDelete(node.path)}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 hover:text-red-500 rounded transition-all"
          title={node.isDir ? 'Delete folder' : 'Delete file'}
        >
          <i className="fa-solid fa-trash text-[14px]"></i>
        </button>
      </div>
      {node.isDir && isExpanded(node.path) && node.children && node.children.length > 0 && (
        <div className="border-l border-[var(--border-color)] ml-3.5">
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
      {tree.length === 0 && <div className="text-sm text-[var(--text-color)] opacity-60 px-2 py-4">No files yet</div>}
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
      <div className="absolute inset-0 bg-[var(--bg-color)] flex flex-col items-center justify-center">
        <div className="w-52 h-52 bg-gray-500/10 rounded-full flex items-center justify-center mb-6 border border-[var(--border-color)]">
          <i className="fa-regular fa-file-lines text-[48px] text-[var(--text-color)] opacity-40"></i>
        </div>
        <h3 className="text-lg font-bold text-[var(--text-color)] mb-2">No file selected</h3>
        <p className="text-[var(--text-color)] opacity-60 max-w-sm text-center mb-6">Select a file from the explorer on the left to start editing code.</p>
      </div>
    )
  }

  const language = getLanguageFromPath(path)

  if (binaryData && isPreviewableFile(path || '')) {
    const lower = path?.toLowerCase() || ''
    const isPdf = lower.endsWith('.pdf')
    const isImage = lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp') || lower.endsWith('.svg')

    if (isImage) {
      const blob = new Blob([binaryData instanceof Uint8Array ? new Uint8Array(binaryData) : binaryData])
      const url = URL.createObjectURL(blob)
      return (
        <div className="flex flex-1 overflow-hidden bg-[var(--bg-color)]">
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
        <div className="flex flex-1 overflow-hidden bg-[var(--bg-color)]">
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
    <div className="flex flex-1 overflow-hidden font-mono text-sm leading-6 relative bg-[var(--bg-color)]">
      <div ref={scrollContainerRef} className="flex h-full w-full overflow-hidden">
        {showLineNumbers && <LineNumbers content={content || '\n'} innerRef={lineNumbersRef} />}
        <div className="flex-1 h-full overflow-hidden">
          <textarea
            ref={actualTextareaRef}
            className={`scrollbar w-full h-[100%] min-h-[74vh] p-4 bg-transparent outline-none resize-none font-mono text-sm whitespace-pre text-[var(--text-color)] language-${language}`}
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
  const [isSyncing, setIsSyncing] = useState(false)

  const hasUnsavedChanges = useMemo(
    () => !!selectedPath && fileContent !== loadedContent,
    [fileContent, loadedContent, selectedPath]
  )

  const tree = useMemo(() => buildTree(paths, searchQuery), [paths, searchQuery])

  const refreshFiles = async () => {
    const all = await readdir('')
    setPaths(all.sort())
    const normalizedSet = new Set(all.map(p => normalizePath(p)))
    if (selectedPath && !normalizedSet.has(normalizePath(selectedPath))) {
      setSelectedPath(null)
      setFileContent('')
      setLoadedContent('')
      setBinaryData(null)
    }
  }

  useEffect(() => {
    refreshFiles().catch(console.error)

    const handleSyncStatusChange = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail && !detail.syncing && !detail.pulling) {
        refreshFiles().catch(console.error)
      }
    }

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
      let data = await readFile(normalized)
      if (data === undefined || data === null) {
        const fallbackPath = normalized.startsWith('/') ? normalized.slice(1) : normalized
        if (fallbackPath) {
          data = await readFile(fallbackPath)
        }
      }
      setSelectedPath(normalized)
      
      if (data === undefined || data === null) {
        setFileContent('[File not found]')
        setLoadedContent('[File not found]')
        setReadOnly(true)
      } else if (typeof data === 'string') {
        setFileContent(data)
        setLoadedContent(data)
        setReadOnly(false)
        showStatus(`Opened ${normalized}`)
      } else if (data instanceof Uint8Array) {
        const decoded = tryDecodeText(data)
        if (decoded !== null) {
          setFileContent(decoded)
          setLoadedContent(decoded)
          setBinaryData(null)
          setReadOnly(false)
          showStatus(`Opened ${normalized} (${getFileTypeDescription(normalized)})`)
        } else if (isPreviewableFile(normalized)) {
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
        const arr = new Uint8Array(data)
        const decoded = tryDecodeText(arr)
        if (decoded !== null) {
          setFileContent(decoded)
          setLoadedContent(decoded)
          setBinaryData(null)
          setReadOnly(false)
          showStatus(`Opened ${normalized} (${getFileTypeDescription(normalized)})`)
        } else if (isPreviewableFile(normalized)) {
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
        setFileContent('[File not found]')
        setLoadedContent('[File not found]')
        setReadOnly(true)
      }
      setExpanded(prev => new Set(prev).add(normalized.split('/').slice(0, -1).join('/') || '/'))
    } catch (err) {
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
    const normalizedTarget = normalizePath(path)
    const targetNoSlash = normalizedTarget.slice(1)
    const isDirTarget = paths.some(p => {
      const n = normalizePath(p)
      return n !== normalizedTarget && n.startsWith(normalizedTarget + '/')
    })

    const { dismiss } = toast({
      title: isDirTarget ? 'Delete folder?' : 'Delete file?',
      description: normalizedTarget,
      action: (
        <button
          onClick={async () => {
            dismiss()
            if (isDirTarget) {
              const all = await readdir('')
              const toDelete = all.filter(k => {
                const normalized = normalizePath(k)
                return normalized === normalizedTarget || normalized.startsWith(normalizedTarget + '/')
              })

              for (const key of toDelete) {
                try {
                  await removeFile(key)
                } catch {
                  // ignore
                }
              }

              try { await removeFile(normalizedTarget + '/.keep') } catch { }
              try { await removeFile(targetNoSlash + '/.keep') } catch { }
            } else {
              await removeFile(normalizedTarget)
              try { await removeFile(targetNoSlash) } catch { }
            }

            if (selectedPath && (selectedPath === normalizedTarget || selectedPath.startsWith(normalizedTarget + '/'))) {
              setSelectedPath(null)
              setFileContent('')
              setLoadedContent('')
              setBinaryData(null)
            }
            await refreshFiles()
            showStatus(`Deleted ${normalizedTarget}`)
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
          const targetDir = currentDirectory || '/home'
          await uploadFiles(files, targetDir, (current, total, fileName) => {
            showStatus(`Uploading ${current}/${total}: ${fileName}`)
          })
          await refreshFiles()
          showStatus(`✓ Uploaded ${files.length} file(s) to ${targetDir}`)
        } catch (error) {
          showStatus(`✗ Upload failed: ${error}`)
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
    }
  }

  const handlePush = async () => {
    try {
      setIsSyncing(true)
      if (selectedPath) {
        const content = await readFile(selectedPath)
        if (content !== undefined) {
          await githubSync.syncFileToGitHub(selectedPath, content)
          toast({ title: 'Success', description: `${selectedPath.split('/').pop()} pushed to GitHub`, variant: 'success' })
          showStatus(`Pushed ${selectedPath} to GitHub`)
        }
      } else {
        await githubSync.syncToGitHub()
        toast({ title: 'Success', description: 'All files pushed to GitHub', variant: 'success' })
        showStatus('Pushed to GitHub')
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      toast({ title: 'Push failed', description: errorMsg, variant: 'destructive' })
      showStatus(`Push failed: ${errorMsg}`)
    } finally {
      setIsSyncing(false)
    }
  }

  const handlePull = async () => {
    try {
      setIsSyncing(true)
      if (selectedPath) {
        await githubSync.pullFileFromGitHub(selectedPath)
        const fileName = selectedPath.split('/').pop()
        const content = await readFile(selectedPath)
        if (content !== undefined) {
          if (typeof content === 'string') {
            setFileContent(content)
            setLoadedContent(content)
          } else if (content instanceof Uint8Array || Array.isArray(content)) {
            setBinaryData(content instanceof Uint8Array ? content : new Uint8Array(content))
          }
        }
        toast({ title: 'Success', description: `${fileName} pulled from GitHub`, variant: 'success' })
        showStatus(`Pulled ${selectedPath} from GitHub`)
      } else {
        await githubSync.pullFromGitHub()
        toast({ title: 'Success', description: 'All files pulled from GitHub', variant: 'success' })
        showStatus('Pulled from GitHub')
      }
      await refreshFiles()
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      toast({ title: 'Pull failed', description: errorMsg, variant: 'destructive' })
      showStatus(`Pull failed: ${errorMsg}`)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ctrl = e.ctrlKey
    const key = e.key.toLowerCase()

    if (fileMenuOpen || editMenuOpen || viewMenuOpen) {
      setFileMenuOpen(false)
      setEditMenuOpen(false)
      setViewMenuOpen(false)
    }

    if (ctrl) {
      switch (key) {
        case 'o': 
          e.preventDefault()
          setIsFolderMode(false)
          newEntryInputRef.current?.focus()
          showStatus('Type file path to open')
          break
        case 's': 
          e.preventDefault()
          saveFile()
          break
        case 'f': 
          e.preventDefault()
          document.querySelector<HTMLInputElement>('input[placeholder="Search files"]')?.focus()
          break
        case 'g': 
          e.preventDefault()
          const line = prompt('Go to line:')
          if (line && textareaRef.current) {
            const lineNum = parseInt(line, 10) - 1
            if (isNaN(lineNum) || lineNum < 0) break
            const lines = fileContent.split('\n')
            let charCount = 0
            for (let i = 0; i < lineNum && i < lines.length; i++) {
              charCount += lines[i].length + 1
            }
            textareaRef.current.focus()
            textareaRef.current.setSelectionRange(charCount, charCount)
          }
          break
        case 'z': 
          e.preventDefault()
          document.execCommand('undo')
          break
        case 'y': 
          e.preventDefault()
          document.execCommand('redo')
          break
        case 'home': 
          e.preventDefault()
          if (textareaRef.current) {
            textareaRef.current.setSelectionRange(0, 0)
            textareaRef.current.scrollTop = 0
          }
          break
        case 'end': 
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
    <div className="bg-[var(--bg-color)] font-display text-[var(--text-color)] overflow-hidden h-full flex flex-col">
      <header className="flex items-center w-full justify-between whitespace-nowrap border-b border-solid border-[var(--border-color)] px-6 py-3 bg-[var(--bg-color)] shrink-0 z-20">
        <div className="flex items-center gap-4">
          <button
            id='PsideBar'
            onClick={toggleSidebar}
            className="flex items-center gap-2 text-sm text-[var(--text-color)] opacity-70 hover:opacity-100 transition-colors cursor-pointer"
            title="Toggle sidebar"
          >
            <i className={`fa-solid ${sidebarCollapsed ? 'fa-bars' : 'fa-folder-open'} text-[16px]`}></i>
            {!sidebarCollapsed && <span className="truncate max-w-[200px]">{currentDirectory}</span>}
          </button>
        </div>
        <div className="flex flex-1 justify-center max-w-xl px-4">
          <label className="relative flex w-full">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-[var(--text-color)] opacity-50">
              <i className="fa-solid fa-magnifying-glass"></i>
            </div>
            <input
              className="block w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-color)] py-2 pl-10 pr-4 text-sm text-[var(--text-color)] placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Search files"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleUpload}
            className={`pointer flex items-center border border-[var(--border-color)] gap-2 px-3 py-1.5 rounded font-medium transition-colors ${
              hasUnsavedChanges && !readOnly 
                ? 'bg-blue-600 text-white border-blue-600' 
                : 'bg-transparent text-[var(--text-color)] opacity-60 hover:bg-gray-500/10'
            }`}
            title="Upload file"
          >
            <i className="fa-solid fa-upload"></i>
            <span className="hidden sm:inline">Upload</span>
          </button>
          <div className="hidden lg:flex items-center gap-2 text-sm font-medium text-[var(--text-color)] relative">
            <div className="relative">
              <button onClick={() => { setFileMenuOpen(!fileMenuOpen); setEditMenuOpen(false); setViewMenuOpen(false) }} className="px-2 py-1 hover:bg-gray-500/20 rounded transition-colors">File</button>
              {fileMenuOpen && (
                <div className="absolute top-full left-0 mt-1 bg-[var(--bg-color)] border border-[var(--border-color)] shadow-lg py-1 min-w-[180px] z-50 rounded">
                  <button onClick={() => { setFileMenuOpen(false); newEntryInputRef.current?.focus() }} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white flex justify-between text-sm transition-colors">
                    <span>Open</span><span className="opacity-50">Ctrl+O</span>
                  </button>
                  <button onClick={() => { saveFile(); setFileMenuOpen(false) }} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white flex justify-between text-sm transition-colors" disabled={!selectedPath || readOnly}>
                    <span>Save</span><span className="opacity-50">Ctrl+S</span>
                  </button>
                  <button onClick={() => { saveFile(); setFileMenuOpen(false) }} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white text-sm transition-colors">
                    <span>Save As...</span>
                  </button>
                </div>
              )}
            </div>
            <div className="relative">
              <button onClick={() => { setEditMenuOpen(!editMenuOpen); setFileMenuOpen(false); setViewMenuOpen(false) }} className="px-2 py-1 hover:bg-gray-500/20 rounded transition-colors">Edit</button>
              {editMenuOpen && (
                <div className="absolute top-full left-0 mt-1 bg-[var(--bg-color)] border border-[var(--border-color)] shadow-lg py-1 min-w-[180px] z-50 rounded">
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white flex justify-between text-sm transition-colors">
                    <span>Undo</span><span className="opacity-50">Ctrl+Z</span>
                  </button>
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white flex justify-between text-sm transition-colors">
                    <span>Redo</span><span className="opacity-50">Ctrl+Y</span>
                  </button>
                  <div className="border-t border-[var(--border-color)] my-1"></div>
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white flex justify-between text-sm transition-colors">
                    <span>Cut</span><span className="opacity-50">Ctrl+X</span>
                  </button>
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white flex justify-between text-sm transition-colors">
                    <span>Copy</span><span className="opacity-50">Ctrl+C</span>
                  </button>
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white flex justify-between text-sm transition-colors">
                    <span>Paste</span><span className="opacity-50">Ctrl+V</span>
                  </button>
                  <div className="border-t border-[var(--border-color)] my-1"></div>
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white flex justify-between text-sm transition-colors">
                    <span>Find</span><span className="opacity-50">Ctrl+F</span>
                  </button>
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white flex justify-between text-sm transition-colors">
                    <span>Replace</span><span className="opacity-50">Ctrl+H</span>
                  </button>
                  <button onClick={() => setEditMenuOpen(false)} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white flex justify-between text-sm transition-colors">
                    <span>Go to Line</span><span className="opacity-50">Ctrl+G</span>
                  </button>
                </div>
              )}
            </div>
            <div className="relative">
              <button onClick={() => { setViewMenuOpen(!viewMenuOpen); setFileMenuOpen(false); setEditMenuOpen(false) }} className="px-2 py-1 hover:bg-gray-500/20 rounded transition-colors">View</button>
              {viewMenuOpen && (
                <div className="absolute top-full left-0 mt-1 bg-[var(--bg-color)] border border-[var(--border-color)] shadow-lg py-1 min-w-[180px] z-50 rounded">
                  <button onClick={() => { setViewMenuOpen(false) }} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white flex justify-between text-sm transition-colors">
                    <span>Help</span><span className="opacity-50">?</span>
                  </button>
                  <div className="border-t border-[var(--border-color)] my-1"></div>
                  <button onClick={() => {
                    const words = fileContent.trim().split(/\s+/).filter(w => w.length > 0).length;
                    const chars = fileContent.length;
                    showStatus(`Words: ${words} | Characters: ${chars} | Lines: ${lines}`);
                    setViewMenuOpen(false);
                  }} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white text-sm transition-colors">
                    <span>Word Count</span>
                  </button>
                  <button onClick={() => { setShowLineNumbers(v => !v); setViewMenuOpen(false) }} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white text-sm transition-colors">
                    <span>{showLineNumbers ? 'Hide Line Numbers' : 'Show Line Numbers'}</span>
                  </button>
                  <button onClick={() => { refreshFiles(); setViewMenuOpen(false) }} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white text-sm transition-colors">
                    <span>Refresh Files</span>
                  </button>
                  <button onClick={() => { toggleSidebar(); setViewMenuOpen(false) }} className="w-full px-3 py-1 text-left text-[var(--text-color)] hover:bg-blue-500 hover:text-white text-sm transition-colors">
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
            className={`action_has has_saved flex items-center border gap-2 px-3 py-1.5 rounded font-medium transition-colors ${
              hasUnsavedChanges && !readOnly 
                ? 'bg-blue-600 text-white border-blue-600' 
                : 'bg-transparent border-[var(--border-color)] text-[var(--text-color)] opacity-60 cursor-not-allowed hover:bg-gray-500/10'
            }`}
            title="Save"
          >
            <i className="fa-solid fa-floppy-disk"></i>
            <span className="hidden sm:inline">Save</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {!sidebarCollapsed && (
          <aside
            className="flex flex-col border-r border-[var(--border-color)] bg-[var(--bg-color)] shrink-0 relative"
            style={{ width: `${sidebarWidth}px` }}
          >
            <div className="px-4 py-3 flex items-center justify-between border-b border-[var(--border-color)]">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-color)] opacity-60">Explorer</span>
              <div className='flex gap-0'>
                <button
                  onClick={() => { setIsFolderMode(false); setNewFileName(''); setTimeout(() => newEntryInputRef.current?.focus(), 50) }}
                  className="flex items-center gap-1 p-1 text-s text-[var(--text-color)] opacity-70 hover:opacity-100 transition-colors"
                  title="New file"
                >
                  <i className="fa-solid fa-file-circle-plus"></i>
                </button>
                <button
                  onClick={handleCreateFolder}
                  className="flex items-center gap-1 p-1 text-s text-[var(--text-color)] opacity-70 hover:opacity-100 transition-colors"
                  title="New folder"
                >
                  <i className="fa-solid fa-folder-plus"></i>                </button>
                <button
                  onClick={refreshFiles} title="Refresh"
                  className="flex items-center gap-1 p-1 text-s text-[var(--text-color)] opacity-70 hover:opacity-100 transition-colors">
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
            <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-color)]">
              <div className="relative">
                <input
                  ref={newEntryInputRef}
                  className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded py-1.5 pl-2 pr-8 text-sm text-[var(--text-color)] placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder={isFolderMode ? "/home/new-folder" : "/home/new-file.txt"}
                  value={newFileName}
                  onChange={e => setNewFileName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createFile()}
                />
                <button className="absolute right-1 top-1.5 p-0.5 text-blue-500 hover:text-blue-400" onClick={createFile} title={isFolderMode ? "Create folder" : "Create file"}>
                  <i className={`fa-solid ${isFolderMode ? 'fa-folder-plus' : 'fa-circle-plus'} text-[18px]`}></i>
                </button>
              </div>
            </div>
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors"
              onMouseDown={startResize}
            />
          </aside>
        )}

        <main className="flex-1 flex flex-col min-w-0 bg-[var(--bg-color)] relative">
          <div className="flex items-center gap-2 px-4 h-10 border-b border-[var(--border-color)] bg-[var(--bg-color)]">
            <div className="flex items-center gap-1 text-sm text-[var(--text-color)] opacity-70 truncate">
              {breadcrumbs.length === 0 && <span className="opacity-50">No file</span>}
              {breadcrumbs.map((part, idx) => (
                <React.Fragment key={idx}>
                  <span className="hover:underline cursor-pointer hover:opacity-100" onClick={() => openFile('/' + breadcrumbs.slice(0, idx + 1).join('/'))}>
                    {part}
                  </span>
                  {idx < breadcrumbs.length - 1 && <span className="opacity-40">/</span>}
                </React.Fragment>
              ))}
            </div>
            {selectedPath && (
              <div className="flex items-center gap-2 ml-auto">
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-color)] bg-gray-500/20 px-3 py-1 rounded-full">
                  <i className="fa-regular fa-file-lines text-[15px] text-blue-500"></i>
                  <span className="truncate max-w-[280px]">{selectedPath}</span>
                  <button className="ml-1 hover:text-red-400 flex items-center" onClick={() => setSelectedPath(null)}>
                    <i className="fa-solid fa-xmark text-[12px]"></i>
                  </button>
                </div>

                <button
                  onClick={handlePush}
                  disabled={isSyncing}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded font-medium transition-colors ${
                    isSyncing
                      ? 'bg-transparent border border-[var(--border-color)] text-[var(--text-color)] opacity-50 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                  title="Push files to GitHub"
                >
                  <i className={`${isSyncing ? 'fas fa-spinner fa-spin' : 'fas fa-cloud-upload-alt'}`}></i>
                </button>
                <button
                  onClick={handlePull}
                  disabled={isSyncing}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded font-medium transition-colors ${
                    isSyncing
                      ? 'bg-transparent border border-[var(--border-color)] text-[var(--text-color)] opacity-50 cursor-not-allowed'
                      : 'bg-gray-600 hover:bg-gray-500 text-white'
                  }`}
                  title="Pull files from GitHub"
                >
                  <i className={`${isSyncing ? 'fas fa-spinner fa-spin' : 'fas fa-cloud-download-alt'}`}></i>
                </button>
                <button
                  onClick={downloadFile}
                  className="p-1.5 text-[var(--text-color)] opacity-70 hover:opacity-100 hover:text-blue-500 transition-colors"
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

          <div className="absolute inset-x-0 bottom-0 h-6 border-t border-[var(--border-color)] bg-[var(--bg-color)] text-[var(--text-color)] opacity-80 flex w-full items-center px-4 justify-between text-xs font-mono shrink-0">
            <div className="flex items-center gap-3 overflow-hidden">
              <span className="truncate max-w-[320px]">{selectedPath || 'No file selected'}</span>
              {readOnly && <span className="uppercase tracking-wide">Read only</span>}
              {hasUnsavedChanges && !readOnly && <span className="uppercase tracking-wide text-blue-500">Unsaved</span>}
              {status && <span className="font-semibold">{status}</span>}
            </div>
            <div className="flex items-center gap-4 opacity-70">
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