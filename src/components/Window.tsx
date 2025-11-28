import React, { useState, useRef, useEffect } from 'react'

export default function Window({
  title,
  children,
  onClose,
  initialPosition = { x: 100, y: 60 },
  noPadding = false
}: {
  title: string
  children: React.ReactNode
  onClose?: () => void
  initialPosition?: { x: number; y: number }
  noPadding?: boolean
}) {
  const [position, setPosition] = useState(initialPosition)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isResizing, setIsResizing] = useState(false)
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0 })
  const [resizedWidth, setResizedWidth] = useState<number | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const [prevPosition, setPrevPosition] = useState(initialPosition)
  const windowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y
        })
      }
      if (isResizing) {
        const deltaX = e.clientX - resizeStart.x
        setResizedWidth(Math.max(300, resizeStart.width + deltaX))
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(false)
    }

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, isResizing, dragOffset, resizeStart])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isMaximized && windowRef.current) {
      const rect = windowRef.current.getBoundingClientRect()
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      })
      setIsDragging(true)
    }
  }

  const toggleMaximize = () => {
    if (isMaximized) {
      // Restore
      setPosition(prevPosition)
      setIsMaximized(false)
    } else {
      // Maximize
      setPrevPosition(position)
      setPosition({ x: 0, y: 0 })
      setIsMaximized(true)
    }
  }

  const windowStyle = isMaximized
    ? {
      left: '0',
      top: '0',
      width: '100vw',
      height: 'calc(100vh - 48px)',
      zIndex: 10
    }
    : {
      left: `${position.x}px`,
      top: `${position.y}px`,
      width: resizedWidth ? `${resizedWidth}px` : '600px',
      maxWidth: '90vw',
      zIndex: 10
    }

  return (
    <div
      ref={windowRef}
      role="dialog"
      aria-label={title}
      tabIndex={0}
      className={`absolute select-none will-change-transform bg-[#1F1F1F]
        ${isMaximized ? 'inset-0 rounded-none' : 'rounded-[5px]'}
        ${isDragging || isResizing ? '' : 'transition-all duration-180'}
        backdrop-blur-lg`}
      style={{
        boxShadow: isMaximized
          ? '0 10px 30px rgba(2,6,23,0.45)'
          : '0 6px 30px rgba(11,15,30,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
        border: isMaximized ? 'none' : '1px solid #424242',
        ...windowStyle
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose?.()
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') toggleMaximize?.()
      }}
    >
      {/* Slim titlebar */}
      <div
        className={`flex items-center overflow-hidden justify-between gap-[0] px-[0] py-[0]
          ${isMaximized ? 'rounded-t-none' : 'rounded-t-[5px]'}
          cursor-move`}
        onMouseDown={handleMouseDown}
        aria-hidden
      >
        {/* Left */}
        <div className="flex items-center gap-2 min-w-0 ml-2">
          <span className="text-xs text-gray-300 font-medium truncate">{title}</span>
        </div>

        {/* Right: borderless nav buttons (Win11 style) */}
        <div className="flex items-center gap-[0]">
          <div className="flex items-center gap-[0] ml-[0]">
            {/* Maximize */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleMaximize?.() }}
              aria-pressed={isMaximized}
              aria-label={isMaximized ? 'Restore' : 'Maximize'}
              title={isMaximized ? 'Restore' : 'Maximize'}
              className="w-7 h-7 flex items-center justify-center hover:bg-slate-100/40 active:scale-95 transition"
            >
              {isMaximized ? (
                <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none">
<path xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd" clip-rule="evenodd" d="M23 4C23 2.34315 21.6569 1 20 1H8C6.34315 1 5 2.34315 5 4V5H4C2.34315 5 1 6.34315 1 8V20C1 21.6569 2.34315 23 4 23H16C17.6569 23 19 21.6569 19 20V19H20C21.6569 19 23 17.6569 23 16V4ZM19 17H20C20.5523 17 21 16.5523 21 16V4C21 3.44772 20.5523 3 20 3H8C7.44772 3 7 3.44772 7 4V5H16C17.6569 5 19 6.34315 19 8V17ZM16 7C16.5523 7 17 7.44772 17 8V20C17 20.5523 16.5523 21 16 21H4C3.44772 21 3 20.5523 3 20V8C3 7.44772 3.44772 7 4 7H16Z" fill="white"/>                </svg>
              ) : (
                <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none">
                  <rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              )}
            </button>

            {/* Close — subtle but visible */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClose?.() }}
              aria-label="Close"
              title="Close"
              className="w-7 h-7 flex items-center text-white justify-center hover:bg-red-600/80 hover:text-white transition"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M6 6l12 12M6 18L18 6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Content area — glass sheet with subtle border */}
      <div
        className={`bg-gray-700 ${isMaximized ? 'h-full' : (noPadding ? '' : 'p-4')} overflow-auto`}
        style={{
          borderBottomLeftRadius: isMaximized ? 0 : 5,
          borderBottomRightRadius: isMaximized ? 0 : 5,
          minHeight: 80
        }}
      >
        {children}
      </div>

      {/* bottom-right diagonal resize affordance */}
      {!isMaximized && (
        <div
          onMouseDown={(e) => {
            e.preventDefault()
            setIsResizing(true)
            setResizeStart({
              x: e.clientX,
              y: e.clientY,
              width: windowRef.current?.offsetWidth || 600
            })
          }}
          className="absolute right-1 bottom-1 w-3 h-3 cursor-se-resize opacity-60 hover:opacity-100 transition"
          title="Resize"
          aria-hidden
        >
          <svg className="w-3 h-3 text-slate-400" viewBox="0 0 10 10" fill="none">
            <path d="M0 10 L10 0 M6 10 L10 6 M2 10 L10 2" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  )
}
