import React, { useState, useEffect, useRef, useCallback } from 'react'
import { readFile, writeFile } from '../../vfs/fs'

interface SearchState {
  active: boolean
  query: string
  lastIndex: number
  highlightIndex: number // Position of highlighted match (not selected)
}

interface ReplaceState {
  active: boolean
  searchQuery: string
  replaceQuery: string
  step: 'search' | 'replace'
}

interface HistoryState {
  text: string
  cursorPos: number
}

interface MenuState {
  open: string | null // 'file' | 'edit' | 'view' | null
}

export default function TextEditor() {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('/home/demo.txt')
  const [status, setStatus] = useState('')
  const [modified, setModified] = useState(false)
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 })
  const [showHelp, setShowHelp] = useState(false)
  const [search, setSearch] = useState<SearchState>({ active: false, query: '', lastIndex: -1, highlightIndex: -1 })
  const [replace, setReplace] = useState<ReplaceState>({ active: false, searchQuery: '', replaceQuery: '', step: 'search' })
  const [showGoto, setShowGoto] = useState(false)
  const [gotoLine, setGotoLine] = useState('')
  const [showOpenFile, setShowOpenFile] = useState(false)
  const [openFilePath, setOpenFilePath] = useState('')
  const [showSaveAs, setShowSaveAs] = useState(false)
  const [saveAsPath, setSaveAsPath] = useState('')
  const [cutBuffer, setCutBuffer] = useState('')
  const [menu, setMenu] = useState<MenuState>({ open: null })

  // Undo/Redo history
  const [history, setHistory] = useState<HistoryState[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const isUndoRedo = useRef(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const gotoInputRef = useRef<HTMLInputElement>(null)
  const openFileInputRef = useRef<HTMLInputElement>(null)
  const saveAsInputRef = useRef<HTMLInputElement>(null)

  // Load file on mount
  useEffect(() => {
    loadFile(fileName)
  }, [])

  // Focus search input when search is active
  useEffect(() => {
    if (search.active && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [search.active])

  // Focus replace input when replace is active
  useEffect(() => {
    if (replace.active && replaceInputRef.current) {
      replaceInputRef.current.focus()
    }
  }, [replace.active])

  // Focus goto input when goto is active
  useEffect(() => {
    if (showGoto && gotoInputRef.current) {
      gotoInputRef.current.focus()
    }
  }, [showGoto])

  // Focus open file input
  useEffect(() => {
    if (showOpenFile && openFileInputRef.current) {
      openFileInputRef.current.focus()
    }
  }, [showOpenFile])

  // Focus save as input
  useEffect(() => {
    if (showSaveAs && saveAsInputRef.current) {
      saveAsInputRef.current.focus()
    }
  }, [showSaveAs])

  async function loadFile(path: string) {
    try {
      const v = await readFile(path)
      if (typeof v === 'string') {
        setText(v)
        setFileName(path)
        setModified(false)
        showStatusMessage(`Loaded ${path}`)
      }
    } catch {
      setText('')
      setModified(false)
      showStatusMessage(`New file: ${path}`)
    }
  }

  function showStatusMessage(msg: string, duration = 2000) {
    setStatus(msg)
    setTimeout(() => setStatus(''), duration)
  }

  async function doSave() {
    try {
      await writeFile(fileName, text)
      setModified(false)
      showStatusMessage(`Saved: ${fileName}`)
    } catch (err) {
      console.error('Save failed:', err)
      showStatusMessage(`Error saving file: ${err}`, 3000)
    }
  }

  async function doSaveAs(path: string) {
    await writeFile(path, text)
    setFileName(path)
    setModified(false)
    setShowSaveAs(false)
    setSaveAsPath('')
    showStatusMessage(`Wrote ${text.split('\n').length} lines to ${path}`)
  }

  function updateCursorPosition(target: HTMLTextAreaElement) {
    const pos = target.selectionStart
    const lines = target.value.substring(0, pos).split('\n')
    setCursorPos({ line: lines.length, col: lines[lines.length - 1].length + 1 })
  }

  // Add to history for undo/redo
  const addToHistory = useCallback((newText: string, cursorPosition: number) => {
    if (isUndoRedo.current) {
      isUndoRedo.current = false
      return
    }
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push({ text: newText, cursorPos: cursorPosition })
      // Limit history to 100 entries
      if (newHistory.length > 100) newHistory.shift()
      return newHistory
    })
    setHistoryIndex(prev => Math.min(prev + 1, 99))
  }, [historyIndex])

  // Update text with history tracking
  const updateText = useCallback((newText: string, cursorPosition?: number) => {
    setText(newText)
    setModified(true)
    const pos = cursorPosition ?? textareaRef.current?.selectionStart ?? 0
    addToHistory(newText, pos)
  }, [addToHistory])

  // Undo
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      isUndoRedo.current = true
      const prevState = history[historyIndex - 1]
      setText(prevState.text)
      setHistoryIndex(historyIndex - 1)
      setModified(true)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(prevState.cursorPos, prevState.cursorPos)
          textareaRef.current.focus()
        }
      }, 0)
      showStatusMessage('Undo')
    } else {
      showStatusMessage('Nothing to undo')
    }
  }, [history, historyIndex])

  // Redo
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      isUndoRedo.current = true
      const nextState = history[historyIndex + 1]
      setText(nextState.text)
      setHistoryIndex(historyIndex + 1)
      setModified(true)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(nextState.cursorPos, nextState.cursorPos)
          textareaRef.current.focus()
        }
      }, 0)
      showStatusMessage('Redo')
    } else {
      showStatusMessage('Nothing to redo')
    }
  }, [history, historyIndex])

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newText = e.target.value
    const cursorPos = e.target.selectionStart
    setText(newText)
    setModified(true)
    addToHistory(newText, cursorPos)
    updateCursorPosition(e.target)
  }

  // Search forward - highlights found text using selection
  const searchForward = useCallback(() => {
    if (!search.query || !textareaRef.current) return
    const textarea = textareaRef.current
    const startPos = search.lastIndex >= 0 ? search.lastIndex + 1 : 0
    const idx = text.toLowerCase().indexOf(search.query.toLowerCase(), startPos)
    if (idx !== -1) {
      setSearch(prev => ({ ...prev, lastIndex: idx, highlightIndex: idx }))
      // Select the found text to highlight it
      textarea.focus()
      textarea.setSelectionRange(idx, idx + search.query.length)
      // Scroll to the found position
      const linesBefore = text.substring(0, idx).split('\n').length
      const lineHeight = 20
      textarea.scrollTop = Math.max(0, (linesBefore - 5) * lineHeight)
      showStatusMessage(`Found at line ${linesBefore}`)
      // Return focus to search input after a brief moment
      setTimeout(() => searchInputRef.current?.focus(), 50)
    } else {
      // Wrap around
      const wrapIdx = text.toLowerCase().indexOf(search.query.toLowerCase(), 0)
      if (wrapIdx !== -1) {
        setSearch(prev => ({ ...prev, lastIndex: wrapIdx, highlightIndex: wrapIdx }))
        textarea.focus()
        textarea.setSelectionRange(wrapIdx, wrapIdx + search.query.length)
        const linesBefore = text.substring(0, wrapIdx).split('\n').length
        const lineHeight = 20
        textarea.scrollTop = Math.max(0, (linesBefore - 5) * lineHeight)
        showStatusMessage('Search wrapped')
        setTimeout(() => searchInputRef.current?.focus(), 50)
      } else {
        setSearch(prev => ({ ...prev, highlightIndex: -1 }))
        showStatusMessage(`"${search.query}" not found`)
      }
    }
  }, [search.query, search.lastIndex, text])

  // Search backward
  const searchBackward = useCallback(() => {
    if (!search.query || !textareaRef.current) return
    const textarea = textareaRef.current
    const endPos = search.lastIndex >= 0 ? search.lastIndex : text.length
    const idx = text.toLowerCase().lastIndexOf(search.query.toLowerCase(), endPos - 1)
    if (idx !== -1) {
      setSearch(prev => ({ ...prev, lastIndex: idx, highlightIndex: idx }))
      textarea.focus()
      textarea.setSelectionRange(idx, idx + search.query.length)
      const linesBefore = text.substring(0, idx).split('\n').length
      const lineHeight = 20
      textarea.scrollTop = Math.max(0, (linesBefore - 5) * lineHeight)
      showStatusMessage(`Found at line ${linesBefore}`)
      setTimeout(() => searchInputRef.current?.focus(), 50)
    } else {
      // Wrap around to end
      const wrapIdx = text.toLowerCase().lastIndexOf(search.query.toLowerCase())
      if (wrapIdx !== -1) {
        setSearch(prev => ({ ...prev, lastIndex: wrapIdx, highlightIndex: wrapIdx }))
        textarea.focus()
        textarea.setSelectionRange(wrapIdx, wrapIdx + search.query.length)
        const linesBefore = text.substring(0, wrapIdx).split('\n').length
        const lineHeight = 20
        textarea.scrollTop = Math.max(0, (linesBefore - 5) * lineHeight)
        showStatusMessage('Search wrapped')
        setTimeout(() => searchInputRef.current?.focus(), 50)
      } else {
        setSearch(prev => ({ ...prev, highlightIndex: -1 }))
        showStatusMessage(`"${search.query}" not found`)
      }
    }
  }, [search.query, search.lastIndex, text])

  // Replace current occurrence
  const doReplace = useCallback(() => {
    if (!replace.searchQuery || !textareaRef.current) return
    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = text.substring(start, end)
    
    if (selectedText.toLowerCase() === replace.searchQuery.toLowerCase()) {
      const newText = text.substring(0, start) + replace.replaceQuery + text.substring(end)
      setText(newText)
      setModified(true)
      showStatusMessage('Replaced 1 occurrence')
      // Find next
      setTimeout(() => {
        const nextIdx = newText.toLowerCase().indexOf(replace.searchQuery.toLowerCase(), start + replace.replaceQuery.length)
        if (nextIdx !== -1 && textareaRef.current) {
          textareaRef.current.setSelectionRange(nextIdx, nextIdx + replace.searchQuery.length)
          textareaRef.current.focus()
        }
      }, 10)
    } else {
      // Find first
      const idx = text.toLowerCase().indexOf(replace.searchQuery.toLowerCase())
      if (idx !== -1) {
        textarea.setSelectionRange(idx, idx + replace.searchQuery.length)
        textarea.focus()
      } else {
        showStatusMessage(`"${replace.searchQuery}" not found`)
      }
    }
  }, [replace.searchQuery, replace.replaceQuery, text])

  // Replace all occurrences
  const doReplaceAll = useCallback(() => {
    if (!replace.searchQuery) return
    const regex = new RegExp(replace.searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const matches = text.match(regex)
    if (matches && matches.length > 0) {
      const newText = text.replace(regex, replace.replaceQuery)
      setText(newText)
      setModified(true)
      showStatusMessage(`Replaced ${matches.length} occurrences`)
    } else {
      showStatusMessage(`"${replace.searchQuery}" not found`)
    }
  }, [replace.searchQuery, replace.replaceQuery, text])

  // Go to line
  const goToLine = useCallback((lineNum: number) => {
    if (!textareaRef.current) return
    const lines = text.split('\n')
    const targetLine = Math.max(1, Math.min(lineNum, lines.length))
    let pos = 0
    for (let i = 0; i < targetLine - 1; i++) {
      pos += lines[i].length + 1
    }
    // Close dialog first, then focus and set cursor
    setShowGoto(false)
    setGotoLine('')
    setCursorPos({ line: targetLine, col: 1 })
    // Use setTimeout to ensure dialog is closed before focusing
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(pos, pos)
        // Scroll to line
        const lineHeight = 20
        textareaRef.current.scrollTop = Math.max(0, (targetLine - 5) * lineHeight)
      }
    }, 0)
    showStatusMessage(`Line ${targetLine}`)
  }, [text])

  // Uncut (paste cut buffer) - now uses updateText for undo support
  const uncutLine = useCallback(() => {
    if (!textareaRef.current || !cutBuffer) return
    const textarea = textareaRef.current
    const pos = textarea.selectionStart
    const newText = text.substring(0, pos) + cutBuffer + text.substring(pos)
    updateText(newText, pos + cutBuffer.length)
    showStatusMessage('Pasted text')
  }, [text, cutBuffer, updateText])

  // Copy to clipboard
  const copyText = useCallback(async () => {
    if (!textareaRef.current) return
    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    if (start !== end) {
      const selected = text.substring(start, end)
      setCutBuffer(selected) // Also store in local buffer
      try {
        await navigator.clipboard.writeText(selected)
        showStatusMessage('Copied to clipboard')
      } catch (err) {
        // Fallback: execCommand might work if textarea is focused
        textarea.focus()
        textarea.setSelectionRange(start, end)
        const success = document.execCommand('copy')
        if (success) {
          showStatusMessage('Copied to clipboard')
        } else {
          showStatusMessage('Copied to local buffer')
        }
      }
    } else {
      showStatusMessage('Nothing selected to copy')
    }
  }, [text])

  // Cut selected text or current line
  const cutText = useCallback(() => {
    if (!textareaRef.current) return
    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    
    if (start !== end) {
      // Cut selection
      const selected = text.substring(start, end)
      navigator.clipboard?.writeText(selected)
      setCutBuffer(selected)
      const newText = text.substring(0, start) + text.substring(end)
      updateText(newText, start)
      showStatusMessage('Cut selection')
    } else {
      // Cut current line
      const lines = text.split('\n')
      let currentPos = 0
      let lineIndex = 0
      
      for (let i = 0; i < lines.length; i++) {
        if (currentPos + lines[i].length >= start) {
          lineIndex = i
          break
        }
        currentPos += lines[i].length + 1
      }
      
      const cutLineText = lines[lineIndex] + (lineIndex < lines.length - 1 ? '\n' : '')
      navigator.clipboard?.writeText(cutLineText)
      setCutBuffer(cutLineText)
      lines.splice(lineIndex, 1)
      const newText = lines.join('\n')
      updateText(newText, currentPos)
      showStatusMessage('Cut line')
    }
  }, [text, updateText])

  // Paste from clipboard
  const pasteText = useCallback(async () => {
    if (!textareaRef.current) return
    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    
    // First try clipboard API
    try {
      const clipText = await navigator.clipboard.readText()
      if (clipText) {
        const newText = text.substring(0, start) + clipText + text.substring(end)
        updateText(newText, start + clipText.length)
        // Set cursor position after paste
        setTimeout(() => {
          if (textareaRef.current) {
            const newPos = start + clipText.length
            textareaRef.current.setSelectionRange(newPos, newPos)
            textareaRef.current.focus()
          }
        }, 0)
        showStatusMessage('Pasted')
        return
      }
    } catch (err) {
      // Clipboard API failed - this is expected when clicking button
      console.log('Clipboard API failed, using fallback:', err)
    }
    
    // Fallback: use local cut buffer (from our cut/copy operations)
    if (cutBuffer) {
      const newText = text.substring(0, start) + cutBuffer + text.substring(end)
      updateText(newText, start + cutBuffer.length)
      setTimeout(() => {
        if (textareaRef.current) {
          const newPos = start + cutBuffer.length
          textareaRef.current.setSelectionRange(newPos, newPos)
          textareaRef.current.focus()
        }
      }, 0)
      showStatusMessage('Pasted from buffer')
    } else {
      // Try execCommand paste as last resort (focus textarea first)
      textarea.focus()
      const success = document.execCommand('paste')
      if (!success) {
        showStatusMessage('Paste failed - try Ctrl+V')
      }
    }
  }, [text, cutBuffer, updateText])

  // Justify/format paragraph - with undo support
  const justifyParagraph = useCallback(() => {
    if (!textareaRef.current) return
    const textarea = textareaRef.current
    const pos = textarea.selectionStart
    const lines = text.split('\n')
    let currentPos = 0
    let lineIndex = 0
    
    for (let i = 0; i < lines.length; i++) {
      if (currentPos + lines[i].length >= pos) {
        lineIndex = i
        break
      }
      currentPos += lines[i].length + 1
    }
    
    // Find paragraph bounds
    let startLine = lineIndex
    let endLine = lineIndex
    
    while (startLine > 0 && lines[startLine - 1].trim() !== '') startLine--
    while (endLine < lines.length - 1 && lines[endLine + 1].trim() !== '') endLine++
    
    // Join and rewrap
    const paragraph = lines.slice(startLine, endLine + 1).join(' ').replace(/\s+/g, ' ')
    const words = paragraph.split(' ')
    const wrapped: string[] = []
    let currentLine = ''
    
    for (const word of words) {
      if ((currentLine + ' ' + word).trim().length <= 72) {
        currentLine = (currentLine + ' ' + word).trim()
      } else {
        if (currentLine) wrapped.push(currentLine)
        currentLine = word
      }
    }
    if (currentLine) wrapped.push(currentLine)
    
    lines.splice(startLine, endLine - startLine + 1, ...wrapped)
    updateText(lines.join('\n'), pos)
    showStatusMessage('Justified paragraph')
  }, [text, updateText])

  // Handle keyboard shortcuts - using standard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ctrl = e.ctrlKey
    const key = e.key.toLowerCase()

    // Close menu on any keypress
    if (menu.open) {
      setMenu({ open: null })
    }

    // Ctrl shortcuts (standard)
    if (ctrl) {
      switch (key) {
        case 'o': // Open file
          e.preventDefault()
          setShowOpenFile(true)
          break
        case 's': // Save
          e.preventDefault()
          doSave()
          break
        case 'g': // Go to line
          e.preventDefault()
          setShowGoto(true)
          break
        case 'f': // Find/Search
          e.preventDefault()
          setSearch({ active: true, query: '', lastIndex: -1, highlightIndex: -1 })
          break
        case 'h': // Replace
          e.preventDefault()
          setReplace({ active: true, searchQuery: '', replaceQuery: '', step: 'search' })
          break
        case 'x': // Cut (standard)
          e.preventDefault()
          cutText()
          break
        case 'c': // Copy (standard) - let browser handle it, onCopy will store in buffer
          // Don't prevent default - let native copy work
          break
        case 'v': // Paste (standard) - let browser handle it, onPaste will process
          // Don't prevent default - let native paste work (onPaste handles it)
          break
        case 'z': // Undo (standard)
          e.preventDefault()
          undo()
          break
        case 'y': // Redo (standard)
          e.preventDefault()
          redo()
          break
        case 'a': // Select all (standard)
          // Let default select all work
          break
        case 'j': // Justify paragraph
          e.preventDefault()
          justifyParagraph()
          break
        case 'home': // Go to start of document
          e.preventDefault()
          if (textareaRef.current) {
            textareaRef.current.setSelectionRange(0, 0)
            textareaRef.current.scrollTop = 0
            setCursorPos({ line: 1, col: 1 })
          }
          break
        case 'end': // Go to end of document
          e.preventDefault()
          if (textareaRef.current) {
            textareaRef.current.setSelectionRange(text.length, text.length)
            textareaRef.current.scrollTop = textareaRef.current.scrollHeight
          }
          break
      }
    }

    // Ctrl+Shift shortcuts
    if (ctrl && e.shiftKey) {
      switch (key) {
        case 'z': // Redo (alternative)
          e.preventDefault()
          redo()
          break
      }
    }
  }, [text, doSave, cutText, pasteText, undo, redo, justifyParagraph, menu.open])

  // Help panel
  const HelpPanel = () => (
    <div className="absolute inset-0 bg-gray-900 bg-opacity-95 z-50 overflow-auto p-4 text-green-400 font-mono text-xs">
      <div className="mb-4 text-center text-white font-bold">Zynqpad Help - Press Esc to close</div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-yellow-400 mb-2">File Operations</div>
          <div>Ctrl+O  Open File</div>
          <div>Ctrl+S  Save</div>
        </div>
        <div>
          <div className="text-yellow-400 mb-2">Navigation</div>
          <div>Ctrl+G  Go to line</div>
          <div>Ctrl+Home  Start of file</div>
          <div>Ctrl+End  End of file</div>
        </div>
        <div>
          <div className="text-yellow-400 mb-2">Search/Replace</div>
          <div>Ctrl+F  Find</div>
          <div>Ctrl+H  Replace</div>
        </div>
        <div>
          <div className="text-yellow-400 mb-2">Editing</div>
          <div>Ctrl+X  Cut</div>
          <div>Ctrl+C  Copy</div>
          <div>Ctrl+V  Paste</div>
          <div>Ctrl+Z  Undo</div>
          <div>Ctrl+Y  Redo</div>
          <div>Ctrl+Shift+Z  Redo</div>
          <div>Ctrl+A  Select All</div>
          <div>Ctrl+J  Justify paragraph</div>
        </div>
      </div>
    </div>
  )

  return (
    <div 
      className="flex flex-col h-full bg-gray-900 text-white font-mono relative"
      onKeyDown={(e) => {
        // Prevent Escape from closing the window
        if (e.key === 'Escape') {
          e.stopPropagation()
        }
      }}
    >
      {/* Help panel */}
      {showHelp && <HelpPanel />}

      {/* Menu bar - Notepad style */}
      <div className="bg-[#1F1F1F] px-1 py-0.5 text-xs flex gap-0 relative">
        {/* File menu */}
        <div className="relative">
          <button
            className={`px-3 py-1 hover:bg-gray-700 ${menu.open === 'file' ? 'bg-gray-700' : ''}`}
            onClick={() => setMenu({ open: menu.open === 'file' ? null : 'file' })}
          >
            File
          </button>
          {menu.open === 'file' && (
            <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-lg min-w-32 z-50">
              <button className="w-full px-3 py-1 text-left hover:bg-blue-600 flex justify-between" onClick={() => { setShowOpenFile(true); setMenu({ open: null }); }}>
                <span>Open</span><span className="text-gray-400">Ctrl+O</span>
              </button>
              <button className="w-full px-3 py-1 text-left hover:bg-blue-600 flex justify-between" onClick={() => { doSave(); setMenu({ open: null }); }}>
                <span>Save</span><span className="text-gray-400">Ctrl+S</span>
              </button>
              <button className="w-full px-3 py-1 text-left hover:bg-blue-600 flex justify-between" onClick={() => { setShowSaveAs(true); setMenu({ open: null }); }}>
                <span>Save As...</span><span className="text-gray-400"></span>
              </button>
            </div>
          )}
        </div>

        {/* Edit menu */}
        <div className="relative">
          <button
            className={`px-3 py-1 hover:bg-gray-700 ${menu.open === 'edit' ? 'bg-gray-700' : ''}`}
            onClick={() => setMenu({ open: menu.open === 'edit' ? null : 'edit' })}
          >
            Edit
          </button>
          {menu.open === 'edit' && (
            <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-lg min-w-40 z-50">
              <button className="w-full px-3 py-1 text-left hover:bg-blue-600 flex justify-between" onClick={() => { undo(); setMenu({ open: null }); }}>
                <span>Undo</span><span className="text-gray-400">Ctrl+Z</span>
              </button>
              <button className="w-full px-3 py-1 text-left hover:bg-blue-600 flex justify-between" onClick={() => { redo(); setMenu({ open: null }); }}>
                <span>Redo</span><span className="text-gray-400">Ctrl+Y</span>
              </button>
              <div className="border-t border-gray-600 my-1"></div>
              <button className="w-full px-3 py-1 text-left hover:bg-blue-600 flex justify-between" onClick={() => { cutText(); setMenu({ open: null }); }}>
                <span>Cut</span><span className="text-gray-400">Ctrl+X</span>
              </button>
              <button className="w-full px-3 py-1 text-left hover:bg-blue-600 flex justify-between" onClick={() => { copyText(); setMenu({ open: null }); }}>
                <span>Copy</span><span className="text-gray-400">Ctrl+C</span>
              </button>
              <button className="w-full px-3 py-1 text-left hover:bg-blue-600 flex justify-between" onClick={() => { pasteText(); setMenu({ open: null }); }}>
                <span>Paste</span><span className="text-gray-400">Ctrl+V</span>
              </button>
              <div className="border-t border-gray-600 my-1"></div>
              <button className="w-full px-3 py-1 text-left hover:bg-blue-600 flex justify-between" onClick={() => { setSearch({ active: true, query: '', lastIndex: -1, highlightIndex: -1 }); setMenu({ open: null }); }}>
                <span>Find</span><span className="text-gray-400">Ctrl+F</span>
              </button>
              <button className="w-full px-3 py-1 text-left hover:bg-blue-600 flex justify-between" onClick={() => { setReplace({ active: true, searchQuery: '', replaceQuery: '', step: 'search' }); setMenu({ open: null }); }}>
                <span>Replace</span><span className="text-gray-400">Ctrl+H</span>
              </button>
              <button className="w-full px-3 py-1 text-left hover:bg-blue-600 flex justify-between" onClick={() => { setShowGoto(true); setMenu({ open: null }); }}>
                <span>Go to Line</span><span className="text-gray-400">Ctrl+G</span>
              </button>
            </div>
          )}
        </div>

        {/* View menu */}
        <div className="relative">
          <button
            className={`px-3 py-1 hover:bg-gray-700 ${menu.open === 'view' ? 'bg-gray-700' : ''}`}
            onClick={() => setMenu({ open: menu.open === 'view' ? null : 'view' })}
          >
            View
          </button>
          {menu.open === 'view' && (
            <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-lg min-w-40 z-50">
              <button className="w-full px-3 py-1 text-left hover:bg-blue-600 flex justify-between" onClick={() => { setShowHelp(true); setMenu({ open: null }); }}>
                <span>Help</span><span className="text-gray-400">?</span>
              </button>
              <div className="border-t border-gray-600 my-1"></div>
              <button className="w-full px-3 py-1 text-left hover:bg-blue-600" onClick={() => { 
                const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
                const chars = text.length;
                const lines = text.split('\n').length;
                showStatusMessage(`Words: ${words} | Characters: ${chars} | Lines: ${lines}`);
                setMenu({ open: null });
              }}>
                <span>Word Count</span>
              </button>
              <button className="w-full px-3 py-1 text-left hover:bg-blue-600" onClick={() => { justifyParagraph(); setMenu({ open: null }); }}>
                <span>Justify Paragraph</span>
              </button>
            </div>
          )}
        </div>

        {/* Click outside to close menu */}
        {menu.open && (
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setMenu({ open: null })}
          />
        )}
      </div>

      {/* Main editor */}
      <div className="flex-1 min-h-[200px] relative overflow-hidden">
        <textarea
          ref={textareaRef}
          className="absolute inset-0 w-full h-full p-2 scrollbar bg-black text-gray-400 font-mono text-sm focus:outline-none resize-none border-none overflow-auto"
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onScroll={() => updateCursorPosition(textareaRef.current!)}
          onPaste={(e) => {
            e.preventDefault()
            const clipText = e.clipboardData.getData('text/plain')
            if (clipText && textareaRef.current) {
              const start = textareaRef.current.selectionStart
              const end = textareaRef.current.selectionEnd
              const newText = text.substring(0, start) + clipText + text.substring(end)
              updateText(newText, start + clipText.length)
              setTimeout(() => {
                if (textareaRef.current) {
                  const newPos = start + clipText.length
                  textareaRef.current.setSelectionRange(newPos, newPos)
                }
              }, 0)
              showStatusMessage('Pasted')
            }
          }}
          onCopy={(e) => {
            // Let default copy work but also store in cut buffer
            if (textareaRef.current) {
              const start = textareaRef.current.selectionStart
              const end = textareaRef.current.selectionEnd
              if (start !== end) {
                const selected = text.substring(start, end)
                setCutBuffer(selected)
              }
            }
          }}
          onClick={(e) => updateCursorPosition(e.currentTarget)}
          onKeyUp={(e) => updateCursorPosition(e.currentTarget)}
          spellCheck={false}
        />
      </div>

      {/* Search bar */}
      {search.active && (
        <div className="bg-gray-800 px-2 py-1 flex items-center gap-2 border-t border-gray-700">
          <span className="text-white">Find:</span>
          <input
            ref={searchInputRef}
            type="text"
            className="flex-1 bg-gray-700 text-white px-2 py-0.5 text-sm focus:outline-none"
            value={search.query}
            onChange={(e) => setSearch(prev => ({ ...prev, query: e.target.value, lastIndex: -1, highlightIndex: -1 }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                searchForward()
                // Keep focus in search input - highlight is shown via overlay
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setSearch({ active: false, query: '', lastIndex: -1, highlightIndex: -1 })
                textareaRef.current?.focus()
              } else if (e.ctrlKey && e.key.toLowerCase() === 'r') {
                e.preventDefault()
                searchBackward()
                // Keep focus in search input - highlight is shown via overlay
              }
            }}
            placeholder="Enter search term..."
          />
          <span className="text-xs text-gray-400">Enter=Next ^R=Prev Esc=Cancel</span>
        </div>
      )}

      {/* Replace bar */}
      {replace.active && (
        <div className="bg-gray-800 px-2 py-1 border-t border-gray-700">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white">Search:</span>
            <input
              ref={replaceInputRef}
              type="text"
              className="flex-1 bg-gray-700 text-white px-2 py-0.5 text-sm focus:outline-none"
              value={replace.searchQuery}
              onChange={(e) => setReplace(prev => ({ ...prev, searchQuery: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setReplace(prev => ({ ...prev, step: 'replace' }))
                  setTimeout(() => {
                    const replaceInput = document.querySelector<HTMLInputElement>('[data-replace-input]')
                    replaceInput?.focus()
                  }, 10)
                } else if (e.key === 'Escape') {
                  e.stopPropagation()
                  setReplace({ active: false, searchQuery: '', replaceQuery: '', step: 'search' })
                  textareaRef.current?.focus()
                }
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-white">Replace:</span>
            <input
              data-replace-input
              type="text"
              className="flex-1 bg-gray-700 text-white px-2 py-0.5 text-sm focus:outline-none"
              value={replace.replaceQuery}
              onChange={(e) => setReplace(prev => ({ ...prev, replaceQuery: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  doReplace()
                } else if (e.key === 'Escape') {
                  e.stopPropagation()
                  setReplace({ active: false, searchQuery: '', replaceQuery: '', step: 'search' })
                  textareaRef.current?.focus()
                } else if (e.ctrlKey && e.key.toLowerCase() === 'a') {
                  e.preventDefault()
                  doReplaceAll()
                }
              }}
            />
            <span className="text-xs text-gray-400">Enter=Replace ^A=All Esc=Cancel</span>
          </div>
        </div>
      )}

      {/* Go to line bar */}
      {showGoto && (
        <div className="bg-gray-800 px-2 py-1 flex items-center gap-2 border-t border-gray-700">
          <span className="text-white">Enter line number:</span>
          <input
            ref={gotoInputRef}
            type="text"
            className="w-24 bg-gray-700 text-white px-2 py-0.5 text-sm focus:outline-none"
            value={gotoLine}
            onChange={(e) => setGotoLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const num = parseInt(gotoLine)
                if (!isNaN(num)) goToLine(num)
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setShowGoto(false)
                setGotoLine('')
                textareaRef.current?.focus()
              }
            }}
          />
          <span className="text-xs text-gray-400">Enter=Go Esc=Cancel</span>
        </div>
      )}

      {/* Open file bar */}
      {showOpenFile && (
        <div className="bg-gray-800 px-2 py-1 flex items-center gap-2 border-t border-gray-700">
          <span className="text-white">File to open:</span>
          <input
            ref={openFileInputRef}
            type="text"
            className="flex-1 bg-gray-700 text-white px-2 py-0.5 text-sm focus:outline-none"
            value={openFilePath}
            onChange={(e) => setOpenFilePath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                loadFile(openFilePath || '/home/demo.txt')
                setShowOpenFile(false)
                setOpenFilePath('')
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setShowOpenFile(false)
                setOpenFilePath('')
                textareaRef.current?.focus()
              }
            }}
            placeholder="/home/demo.txt"
          />
          <span className="text-xs text-gray-400">Enter=Open Esc=Cancel</span>
        </div>
      )}

      {/* Save as bar */}
      {showSaveAs && (
        <div className="bg-gray-800 px-2 py-1 flex items-center gap-2 border-t border-gray-700">
          <span className="text-white">File name to write:</span>
          <input
            ref={saveAsInputRef}
            type="text"
            className="flex-1 bg-gray-700 text-white px-2 py-0.5 text-sm focus:outline-none"
            value={saveAsPath}
            onChange={(e) => setSaveAsPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && saveAsPath) {
                doSaveAs(saveAsPath)
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setShowSaveAs(false)
                setSaveAsPath('')
                textareaRef.current?.focus()
              }
            }}
            placeholder={fileName}
          />
          <span className="text-xs text-gray-400">Enter=Save Esc=Cancel</span>
        </div>
      )}

      {/* Status bar */}
      <div className="bg-[#1F1F1F] px-2 text-xs border-t border-gray-700 flex justify-between">
        <span className={status ? 'text-yellow-400' : 'text-gray-500'}>
          {status || `[ line ${cursorPos.line}, col ${cursorPos.col} ]`}
        </span>
        <span className="text-gray-500">
          {text.split('\n').length} lines
        </span>
      </div>
    </div>
  )
}

// attach UI for Taskbar to open
window.__TEXT_EDITOR_UI__ = TextEditor
