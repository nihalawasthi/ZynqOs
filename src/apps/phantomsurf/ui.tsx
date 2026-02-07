import React, { useEffect, useRef, useState } from 'react'
import clsx from "clsx";
import { readFile, readdir } from '../../vfs/fs'

export default function PhantomSurf() {
  const [showBrowser, setShowBrowser] = useState(false)
  const [url, setUrl] = useState('')
  const [input, setInput] = useState('')
  const [vpnEnabled, setVpnEnabled] = useState(false)
  const [torEnabled, setTorEnabled] = useState(false)
  const [vpn, setVpn] = useState(false)
  const [tor, setTor] = useState(false)
  const [iframeError, setIframeError] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [showVfsOpen, setShowVfsOpen] = useState(false)
  const [vfsPath, setVfsPath] = useState('/home/index.html')
  const [vfsError, setVfsError] = useState<string | null>(null)
  const [vfsFiles, setVfsFiles] = useState<string[]>([])
  const [vfsLoading, setVfsLoading] = useState(false)
  const iframeRef = useRef(null)
  const lastRequestTimeRef = useRef<number>(0)
  const progressIntervalRef = useRef<number | null>(null)
  const REQUEST_THROTTLE_MS = 1000 // 1 second between requests to avoid rate limiting

  const quickLinks = [
    { label: 'Gmail', url: 'https://mail.google.com' },
    { label: 'Images', url: 'https://images.google.com' },
    { label: 'GitHub', url: 'https://github.com' },
    { label: 'YouTube', url: 'https://www.youtube.com' },
  ]

  type UrlBuildResult = { url: string; type: 'url' | 'search' }
  type Suggestion = { id: string; label: string; url: string; value: string; kind: 'primary' | 'history' | 'quick' }

  const isProbablyUrl = (value: string): boolean => {
    const trimmed = value.trim()
    const lower = trimmed.toLowerCase()
    if (!trimmed || /\s/.test(trimmed)) return false
    if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('//')) return true
    if (lower.startsWith('file:') || lower.startsWith('data:') || lower.startsWith('javascript:')) return true
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(trimmed)) return true
    if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/|$)/.test(trimmed)) return true
    if (/^[a-z0-9.-]+:\d+/.test(lower)) return true
    return trimmed.includes('.')
  }

  const buildUrlFromInput = (value: string): UrlBuildResult | null => {
    const trimmed = value.trim()
    if (!trimmed) return null

    if (isProbablyUrl(trimmed)) {
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('file:')) {
        return { url: trimmed, type: 'url' }
      }
      if (trimmed.startsWith('//')) {
        return { url: 'https:' + trimmed, type: 'url' }
      }
      return { url: 'https://' + trimmed, type: 'url' }
    }

    return { url: `https://google.com/search?q=${encodeURIComponent(trimmed)}`, type: 'search' }
  }

  const getSuggestions = (value: string): Suggestion[] => {
    const trimmed = value.trim()
    if (!trimmed) return []

    const lower = trimmed.toLowerCase()
    const suggestions: Suggestion[] = []
    const seen = new Set<string>()

    const primary = buildUrlFromInput(trimmed)
    if (primary) {
      const label = primary.type === 'search' ? `Search "${trimmed}"` : `Go to ${primary.url}`
      suggestions.push({ id: 'primary', label, url: primary.url, value: trimmed, kind: 'primary' })
      seen.add(primary.url)
    }

    const historyMatches = history
      .slice()
      .reverse()
      .filter(item => item.toLowerCase().includes(lower))
      .filter(item => !seen.has(item))
      .slice(0, 4)

    historyMatches.forEach((item, index) => {
      suggestions.push({ id: `history-${index}`, label: item, url: item, value: item, kind: 'history' })
      seen.add(item)
    })

    const quickMatches = quickLinks
      .filter(link => link.label.toLowerCase().includes(lower) || link.url.toLowerCase().includes(lower))
      .filter(link => !seen.has(link.url))
      .slice(0, 3)

    quickMatches.forEach((link, index) => {
      suggestions.push({ id: `quick-${index}`, label: link.label, url: link.url, value: link.url, kind: 'quick' })
    })

    return suggestions
  }

  const clearProgressInterval = () => {
    if (progressIntervalRef.current !== null) {
      window.clearInterval(progressIntervalRef.current)
      progressIntervalRef.current = null
    }
  }

  const startProgress = () => {
    clearProgressInterval()
    setProgress(10)
    progressIntervalRef.current = window.setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) {
          clearProgressInterval()
          return 90
        }
        return prev + Math.random() * 30
      })
    }, 300)
  }

  const isProxyUrl = (value: string) => {
    try {
      const parsed = new URL(value)
      return parsed.pathname === '/api' && parsed.searchParams.get('route') === 'proxy' && !!parsed.searchParams.get('url')
    } catch {
      return value.includes('/api?route=proxy&url=')
    }
  }

  useEffect(() => {
    if (!showBrowser) return

    const intervalId = window.setInterval(() => {
      const iframe = iframeRef.current as HTMLIFrameElement | null
      if (!iframe || !iframe.src) return

      const currentSrc = iframe.src
      if (currentSrc.startsWith('blob:') || currentSrc.startsWith('data:')) return
      if (isProxyUrl(currentSrc)) return

      setIsLoading(true)
      setIframeError(false)
      startProgress()
      setInput(currentSrc)
      setUrl(buildIframeUrl(currentSrc))
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [showBrowser])

  const buildIframeUrl = (target: string) => {
    if (target.startsWith('blob:') || target.startsWith('data:')) return target
    return `/api?route=proxy&url=${encodeURIComponent(target)}`
  }

  const navigateToUrl = (newUrl: string) => {
    // Throttle requests to avoid rate limiting
    const now = Date.now()
    if (now - lastRequestTimeRef.current < REQUEST_THROTTLE_MS) {
      setError(`Please wait ${Math.ceil((REQUEST_THROTTLE_MS - (now - lastRequestTimeRef.current)) / 1000)}s before next request`)
      return
    }
    lastRequestTimeRef.current = now
    setError(null)

    const proxiedUrl = buildIframeUrl(newUrl)
    setIsLoading(true)
    setIframeError(false)
    startProgress()
    
    setUrl(proxiedUrl)
    setInput(newUrl)
    setShowBrowser(true)
    
    // Add to history
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push(newUrl)
      return newHistory
    })
    setHistoryIndex(prev => prev + 1)
  }

  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      const prevUrl = history[newIndex]
      const proxiedUrl = buildIframeUrl(prevUrl)
      setUrl(proxiedUrl)
      setInput(prevUrl)
      setIsLoading(true)
      setIframeError(false)
      startProgress()
    }
  }

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1
      setHistoryIndex(newIndex)
      const nextUrl = history[newIndex]
      const proxiedUrl = buildIframeUrl(nextUrl)
      setUrl(proxiedUrl)
      setInput(nextUrl)
      setIsLoading(true)
      setIframeError(false)
      startProgress()
    }
  }

  const refresh = () => {
    if (url) {
      setIsLoading(true)
      setIframeError(false)
      startProgress()
      // Force reload by triggering onLoad
      if (iframeRef.current) {
        (iframeRef.current as any).src = url
      }
    }
  }

  const goHome = () => {
    setShowBrowser(false)
    setHistory([])
    setHistoryIndex(-1)
    setUrl('')
    setInput('')
    setIframeError(false)
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    const result = buildUrlFromInput(input)
    if (!result) return
    navigateToUrl(result.url)
  }

  const handleQuickLink = (urlLink: string) => {
    navigateToUrl(urlLink)
  }

  const openVfsDialog = () => {
    setVfsError(null)
    setShowVfsOpen(true)
  }

  const normalizeVfsPath = (path: string) => {
    const trimmed = path.trim()
    if (!trimmed) return ''
    if (trimmed.startsWith('~/')) return `/home/${trimmed.slice(2)}`
    if (trimmed.startsWith('/')) return trimmed
    return `/home/${trimmed}`
  }

  useEffect(() => {
    const loadVfsListing = async () => {
      if (!showVfsOpen) return
      setVfsLoading(true)
      try {
        const files = await readdir('/home')
        const htmlFiles = files
          .filter((path) => path.toLowerCase().endsWith('.html') || path.toLowerCase().endsWith('.htm'))
          .sort((a, b) => a.localeCompare(b))
        setVfsFiles(htmlFiles)
      } catch (err: any) {
        setVfsFiles([])
        setVfsError(err?.message || 'Failed to read /home from VFS')
      } finally {
        setVfsLoading(false)
      }
    }

    loadVfsListing()
  }, [showVfsOpen])

  const loadVfsHtml = async () => {
    const path = normalizeVfsPath(vfsPath)
    if (!path) {
      setVfsError('Enter a VFS path like /home/index.html')
      return
    }

    try {
      const data = await readFile(path)
      if (!data) {
        setVfsError(`File not found in VFS: ${path}`)
        return
      }

      const html = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data)
      const blob = new Blob([html], { type: 'text/html' })
      const blobUrl = URL.createObjectURL(blob)

      setUrl(blobUrl)
      setShowBrowser(true)
      setInput(path)
      setHistory([blobUrl])
      setHistoryIndex(0)
      setIframeError(false)
      setShowVfsOpen(false)
      setVfsError(null)
    } catch (err: any) {
      setVfsError(err?.message || 'Failed to read VFS file')
    }
  }

  const vfsModal = showVfsOpen ? (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1200
    }}>
      <div style={{
        width: 420,
        background: '#121212',
        border: '1px solid #333',
        borderRadius: 12,
        padding: 16,
        boxShadow: '0 20px 40px rgba(0,0,0,0.45)'
      }}>
        <div style={{ color: '#fff', fontSize: 16, marginBottom: 8 }}>Open HTML from VFS</div>
        <div style={{ color: '#777', fontSize: 12, marginBottom: 10 }}>Example: /home/index.html</div>
        <input
          value={vfsPath}
          onChange={(e) => setVfsPath(e.target.value)}
          placeholder="/home/index.html"
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid #333',
            background: '#1b1b1b',
            color: '#fff',
            outline: 'none'
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') loadVfsHtml()
          }}
        />
        {vfsError && (
          <div style={{ color: '#ff8a8a', fontSize: 12, marginTop: 8 }}>{vfsError}</div>
        )}
        <div style={{ marginTop: 12, maxHeight: 160, overflowY: 'auto', borderTop: '1px solid #222', paddingTop: 10 }}>
          {vfsLoading ? (
            <div style={{ color: '#777', fontSize: 12 }}>Loading VFS files...</div>
          ) : vfsFiles.length > 0 ? (
            vfsFiles.map((path) => (
              <button
                key={path}
                onClick={() => setVfsPath(path)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid transparent',
                  background: 'transparent',
                  color: '#cfcfcf',
                  cursor: 'pointer'
                }}
              >
                {path}
              </button>
            ))
          ) : (
            <div style={{ color: '#777', fontSize: 12 }}>No HTML files found in /home</div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button
            onClick={() => setShowVfsOpen(false)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #333',
              background: '#1f1f1f',
              color: '#aaa',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={loadVfsHtml}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            Open
          </button>
        </div>
      </div>
    </div>
  ) : null

  interface ToggleButtonProps {
    label: string;
    active: boolean;
    onToggle: () => void;
  }

  const ToggleButton: React.FC<ToggleButtonProps> = ({ label, active, onToggle }) => {
    return (
      <button
        onClick={onToggle}
        className={clsx(
          "relative flex flex-col items-center justify-between",
          "w-[70px] h-[40px] rounded-[4px] px-[6px] py-[8px]",
          "bg-[#2a2a2a] border-t border-[#383838]",
          "transition-all duration-100 ease-linear",
          active &&
          "mt-[6px] rounded-b-[4px] border-green-400 border-2 shadow-[inset_0_-20px_15px_0_rgba(0,0,0,0.5)]"
        )}
        style={{
          transform: active
            ? "perspective(200px)"
            : "perspective(200px)",
          transformOrigin: "50% 40%",
        }}
      >
  {/* Top-right circle */}
  <div
    className={clsx(
      "absolute top-[4px] right-[4px] w-[6px] h-[6px] rounded-full",
      "transition-all duration-150",
      active
        ? "bg-green-400 shadow-[0_0_6px_rgba(37,138,195,0.8)]"
        : "bg-white/20"
    )}
  />
        {/* Title text */}
        <span
          className={clsx(
            "font-extrabold uppercase text-[15px]",
            "transition-all duration-100 ease-linear",
            active
              ? "text-green-400/50 drop-shadow-[0_0_8px_rgb(37,138,195),1px_1px_2px_black]"
              : "text-white/40"
          )}
        >
          {label}
        </span>
      </button>
    );
  };

  const handleBack = () => {
    goBack()
  }

  if (showBrowser) {
    const suggestions = getSuggestions(input)

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1a1a1a' }}>
        {/* Browser Navigation Bar */}
        <div style={{
          padding: '8px 12px',
          background: '#0a0a0a',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <button
            onClick={goBack}
            disabled={historyIndex <= 0}
            className='flex items-center justify-center hover:bg-gray-800 rounded-full p-4'
            style={{
              color: historyIndex <= 0 ? '#555' : '#aaa',
              cursor: historyIndex <= 0 ? 'not-allowed' : 'pointer',
              fontSize: 14,
              opacity: historyIndex <= 0 ? 0.5 : 1,
            }}
          >
            <svg fill="currentColor" height="18px" width="18px" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox="0 0 219.151 219.151" xmlSpace="preserve"><g id="SVGRepo_bgCarrier" strokeWidth="0"></g><g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g><g id="SVGRepo_iconCarrier"> <g> <path d="M109.576,219.151c60.419,0,109.573-49.156,109.573-109.576C219.149,49.156,169.995,0,109.576,0S0.002,49.156,0.002,109.575 C0.002,169.995,49.157,219.151,109.576,219.151z M109.576,15c52.148,0,94.573,42.426,94.574,94.575 c0,52.149-42.425,94.575-94.574,94.576c-52.148-0.001-94.573-42.427-94.573-94.577C15.003,57.427,57.428,15,109.576,15z"></path> <path d="M94.861,156.507c2.929,2.928,7.678,2.927,10.606,0c2.93-2.93,2.93-7.678-0.001-10.608l-28.82-28.819l83.457-0.008 c4.142-0.001,7.499-3.358,7.499-7.502c-0.001-4.142-3.358-7.498-7.5-7.498l-83.46,0.008l28.827-28.825 c2.929-2.929,2.929-7.679,0-10.607c-1.465-1.464-3.384-2.197-5.304-2.197c-1.919,0-3.838,0.733-5.303,2.196l-41.629,41.628 c-1.407,1.406-2.197,3.313-2.197,5.303c0.001,1.99,0.791,3.896,2.198,5.305L94.861,156.507z"></path> </g> </g></svg>
          </button>
          <button
            onClick={goForward}
            disabled={historyIndex >= history.length - 1}
            className='flex items-center justify-center hover:bg-gray-800 rounded-full p-4'
            style={{
              color: historyIndex >= history.length - 1 ? '#555' : '#aaa',
              cursor: historyIndex >= history.length - 1 ? 'not-allowed' : 'pointer',
              fontSize: 14,
              opacity: historyIndex >= history.length - 1 ? 0.5 : 1,
            }}
          >
            <svg fill="currentColor" height="18px" width="18px" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox="0 0 219.151 219.151" xmlSpace="preserve" transform="matrix(-1, 0, 0, 1, 0, 0)"><g id="SVGRepo_bgCarrier" strokeWidth="0"></g><g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g><g id="SVGRepo_iconCarrier"> <g> <path d="M109.576,219.151c60.419,0,109.573-49.156,109.573-109.576C219.149,49.156,169.995,0,109.576,0S0.002,49.156,0.002,109.575 C0.002,169.995,49.157,219.151,109.576,219.151z M109.576,15c52.148,0,94.573,42.426,94.574,94.575 c0,52.149-42.425,94.575-94.574,94.576c-52.148-0.001-94.573-42.427-94.573-94.577C15.003,57.427,57.428,15,109.576,15z"></path> <path d="M94.861,156.507c2.929,2.928,7.678,2.927,10.606,0c2.93-2.93,2.93-7.678-0.001-10.608l-28.82-28.819l83.457-0.008 c4.142-0.001,7.499-3.358,7.499-7.502c-0.001-4.142-3.358-7.498-7.5-7.498l-83.46,0.008l28.827-28.825 c2.929-2.929,2.929-7.679,0-10.607c-1.465-1.464-3.384-2.197-5.304-2.197c-1.919,0-3.838,0.733-5.303,2.196l-41.629,41.628 c-1.407,1.406-2.197,3.313-2.197,5.303c0.001,1.99,0.791,3.896,2.198,5.305L94.861,156.507z"></path> </g> </g></svg>
          </button>
          <button
            onClick={refresh}
            className='flex items-center justify-center hover:bg-gray-800 rounded-full p-4'
            style={{
              color: '#aaa',
              cursor: 'pointer',
              fontSize: 14,
              opacity: 1,
            }}
            title="Refresh page"
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" height="18px" width="18px" transform="matrix(-1, 0, 0, 1, 0, 0)"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M3 3V8M3 8H8M3 8L6 5.29168C7.59227 3.86656 9.69494 3 12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21C7.71683 21 4.13247 18.008 3.22302 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>
          </button>
          <button
            onClick={goHome}
            className='flex items-center justify-center hover:bg-gray-800 rounded-full p-4'
            style={{
              color: '#aaa',
              cursor: 'pointer',
              fontSize: 14,
              opacity: 1,
            }}
            title="Go to home"
          >
            <svg fill="currentColor" height="18px" width="18px" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox="0 0 254.182 254.182" xmlSpace="preserve"><g id="SVGRepo_bgCarrier" strokeWidth="0"></g><g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g><g id="SVGRepo_iconCarrier"> <g> <path d="M211.655,137.102c-4.143,0-7.5,3.358-7.5,7.5v77.064h-41.373v-77.064c0-4.142-3.357-7.5-7.5-7.5H98.903 c-4.143,0-7.5,3.358-7.5,7.5v77.064H50.026v-77.064c0-4.142-3.357-7.5-7.5-7.5c-4.143,0-7.5,3.358-7.5,7.5v84.564 c0,4.142,3.357,7.5,7.5,7.5h56.377h56.379h56.373c4.143,0,7.5-3.358,7.5-7.5v-84.564 C219.155,140.46,215.797,137.102,211.655,137.102z M106.403,221.666v-69.564h41.379v69.564H106.403z"></path> <path d="M251.985,139.298L132.389,19.712c-2.928-2.929-7.677-2.928-10.607,0L2.197,139.298c-2.929,2.929-2.929,7.678,0,10.606 c2.93,2.929,7.678,2.929,10.607,0L127.086,35.622l114.293,114.283c1.464,1.464,3.384,2.196,5.303,2.196 c1.919,0,3.839-0.732,5.304-2.197C254.914,146.976,254.914,142.227,251.985,139.298z"></path> </g> </g></svg>
          </button>
          <form onSubmit={handleSearch} style={{ flex: 1, display: 'flex', gap: 6 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Enter URL or search..."
                style={{
                  width: '100%',
                  padding: '8px 16px',
                  borderRadius: 20,
                  border: '1px solid #444',
                  background: '#222',
                  color: '#fff',
                  outline: 'none'
                }}
              />
              {/* {suggestions.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  left: 0,
                  right: 0,
                  background: '#111',
                  border: '1px solid #333',
                  borderRadius: 10,
                  padding: 6,
                  zIndex: 1000,
                  boxShadow: '0 10px 30px rgba(0,0,0,0.4)'
                }}>
                  {suggestions.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setInput(item.value)
                        navigateToUrl(item.url)
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'transparent',
                        color: '#ddd',
                        cursor: 'pointer'
                      }}
                    >
                      <span style={{ fontSize: 12, color: '#777' }}>
                        {item.kind === 'history' ? 'History' : item.kind === 'quick' ? 'Quick' : 'Go'}
                      </span>
                      <span style={{ fontSize: 13 }}>{item.label}</span>
                    </button>
                  ))}
                </div>
              )} */}
            </div>
            <button
              type="submit"
              style={{
                padding: '8px 20px',
                borderRadius: 20,
                border: 'none',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              Go
            </button>
          </form>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 8 }}>
            <div className="flex items-center gap-[6px] bg-black p-[6px] rounded-[8px] h-[40px] overflow-hidden scale-75 origin-right">
              <ToggleButton label="VPN" active={vpn} onToggle={() => setVpn(!vpn)} />
              <ToggleButton label="TOR" active={tor} onToggle={() => setTor(!tor)} />
            </div>
            <button
              onClick={openVfsDialog}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #444',
                background: '#222',
                color: '#aaa',
                cursor: 'pointer',
                fontSize: 13
              }}
            >
              📁 HTML
            </button>
          </div>
        </div>

        {/* Browser Content */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {/* Progress Bar */}
          {isLoading && progress > 0 && progress < 100 && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: '#333',
              zIndex: 999,
              overflow: 'hidden'
            }}>
              <div style={{
                height: '100%',
                background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
                width: `${progress}%`,
                transition: 'width 0.3s ease',
                boxShadow: '0 0 10px rgba(102, 126, 234, 0.6)'
              }} />
            </div>
          )}
          {error && (
            <div style={{
              padding: '12px 16px',
              background: '#3a2a2a',
              borderBottom: '1px solid #8b5a5a',
              color: '#ff9999',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span>⚠️ {error}</span>
              <button
                onClick={() => setError(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ff9999',
                  cursor: 'pointer',
                  fontSize: 16
                }}
              >
                ✕
              </button>
            </div>
          )}
          {isLoading && progress < 100 && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.3)',
              zIndex: 900,
              backdropFilter: 'blur(2px)',
              pointerEvents: 'none'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 40,
                  height: 40,
                  margin: '0 auto 12px',
                  border: '3px solid rgba(255,255,255,0.2)',
                  borderTop: '3px solid #667eea',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }} />
                <p style={{ color: '#aaa', margin: 0, fontSize: 12 }}>
                  {Math.round(progress)}%
                </p>
              </div>
            </div>
          )}
          {iframeError ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 20,
              padding: 40,
              textAlign: 'center',
              background: '#1a1a1a'
            }}>
              <h2 style={{ color: '#fff', fontSize: 24, margin: 0 }}>⚠️ Website Blocked</h2>
              <p style={{ color: '#aaa', margin: 0, maxWidth: 400 }}>
                This website doesn't allow being embedded in iframes for security reasons. You can still open it in a new window.
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={() => window.open(url, '_blank')}
                  style={{
                    padding: '10px 24px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: '#fff',
                    cursor: 'pointer',
                    fontWeight: 500
                  }}
                >
                  Open in New Window
                </button>
                <button
                  onClick={() => {
                    setShowBrowser(false)
                    setIframeError(false)
                  }}
                  style={{
                    padding: '10px 24px',
                    borderRadius: 6,
                    border: '1px solid #444',
                    background: '#222',
                    color: '#aaa',
                    cursor: 'pointer'
                  }}
                >
                  Go Back
                </button>
              </div>
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              src={url}
              title="PhantomSurf Browser"
              style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
              onError={() => {
                clearProgressInterval()
                setIsLoading(false)
                setProgress(0)
                setIframeError(true)
              }}
              onLoad={() => {
                clearProgressInterval()
                setIframeError(false)
                setIsLoading(false)
                setProgress(100)
                setTimeout(() => setProgress(0), 300)
              }}
              onLoadStart={() => {
                setIsLoading(true)
                setIframeError(false)
              }}
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-presentation"
              allow="accelerometer; camera; geolocation; gyroscope; magnetometer; microphone; payment; usb"
            />
          )}
        </div>
        {vfsModal}
      </div>
    )
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#000000',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* VPN/Tor Status in Header */}
      <div className='scale-[0.8]' style={{
        position: 'absolute',
        top: 10,
        right: 5,
        display: 'flex',
        gap: 12,
        zIndex: 10
      }}>

        <div className="flex items-center gap-[6px] bg-black p-[6px] rounded-[8px] h-[54px] overflow-hidden">
          <ToggleButton label="VPN" active={vpn} onToggle={() => setVpn(!vpn)} />
          <ToggleButton label="TOR" active={tor} onToggle={() => setTor(!tor)} />
        </div>
      </div>

      {/* Main Content */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        gap: 60
      }}>


        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 40, width: '100%' }}>
          {/* Logo/Title */}
          <h1 style={{
            fontSize: 48,
            fontWeight: 700,
            color: '#fff',
            margin: 0,
            textAlign: 'center',
            letterSpacing: 1
          }}>
            PhantomSurf
          </h1>
          <div style={{ width: '100%', maxWidth: 600, padding: '0 20px' }}>
            <div
              className='transition focus-within:ring-2 focus-within:ring-green-500'
              style={{
                display: 'flex',
                alignItems: 'center',
                background: '#222',
                borderRadius: 50,
                border: '1px solid rgba(255,255,255,0.1)',
                gap: 12,
                marginBottom: 24
              }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input type="text" placeholder="Surf Like A Phantom"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch(e as any)}
                  style={{
                    width: '100%',
                    padding: '12px 20px',
                    background: 'transparent',
                    border: 'none',
                    color: '#fff',
                    outline: 'none',
                    fontSize: 14
                  }}
                />
                {getSuggestions(input).length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    left: 0,
                    right: 0,
                    background: '#111',
                    border: '1px solid #333',
                    borderRadius: 10,
                    padding: 6,
                    zIndex: 10,
                    boxShadow: '0 10px 30px rgba(0,0,0,0.4)'
                  }}>
                    {getSuggestions(input).map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setInput(item.value)
                          navigateToUrl(item.url)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: 'none',
                          background: 'transparent',
                          color: '#ddd',
                          cursor: 'pointer'
                        }}
                      >
                        <span style={{ fontSize: 12, color: '#777' }}>
                          {item.kind === 'history' ? 'History' : item.kind === 'quick' ? 'Quick' : 'Go'}
                        </span>
                        <span style={{ fontSize: 13 }}>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{
                width: 36,
                height: 36,
                marginRight: '7px',
                backgroundImage: "url('/assets/PS.png')",
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                borderRadius: '50%',
                cursor: 'pointer'
              }}></div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 20 }}>
              {quickLinks.map(link => (
                <QuickButton
                  key={link.url}
                  icon={link.label === 'Gmail' ? <i className="fa-solid fa-envelope" /> : link.label === 'Images' ? <i className="fa-solid fa-image" /> : link.label === 'GitHub' ? <i className="fa-brands fa-github" /> : <i className="fa-brands fa-youtube" />}
                  label={link.label}
                  onClick={() => handleQuickLink(link.url)}
                />
              ))}
              <QuickButton
                icon={<i className="fa-solid fa-file" />}
                label="Load HTML"
                onClick={openVfsDialog}
              />
            </div>
          </div>
        </div>

        {vfsModal}
      </div>

      {/* Footer */}
      <div style={{
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        fontSize: 12,
        color: '#666'
      }}>
        <span>© 2025 PhantomSurf. All rights reserved.</span>
        <div style={{ display: 'flex', gap: 20 }}>
          <a href="#" style={{ color: '#888', textDecoration: 'none' }}>Terms</a>
          <a href="#" style={{ color: '#888', textDecoration: 'none' }}>Privacy</a>
          <a href="#" style={{ color: '#888', textDecoration: 'none' }}>Contact</a>
        </div>
      </div>
    </div>
  )
}

function QuickButton({ icon, label, onClick }: { icon: string | React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 20px',
        borderRadius: 25,
        border: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(255,255,255,0.05)',
        color: '#aaa',
        cursor: 'pointer',
        fontSize: 14,
        transition: 'all 0.3s',
        backdropFilter: 'blur(10px)'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
        e.currentTarget.style.borderColor = 'rgba(102,126,234,0.3)'
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}


; (window as any).__PHANTOMSURF_UI__ = PhantomSurf