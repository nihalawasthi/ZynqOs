import React, { useState, useRef, useEffect } from 'react'

type Tab = {
  id: string
  title: string
  active: boolean
  onActivate: () => void
  onClose: () => void
}

export default function Window({
  title,
  children,
  onClose,
  onCloseAll,
  initialPosition = { x: 100, y: 60 },
  noPadding = false,
  tabs
}: {
  title: string
  children: React.ReactNode
  onClose?: () => void
  onCloseAll?: () => void
  initialPosition?: { x: number; y: number }
  noPadding?: boolean
  tabs?: Tab[]
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
      height: '100vh',
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
      className={`absolute select-none will-change-transform bg-[#1F1F1F] flex flex-col
        ${isMaximized ? 'inset-0 rounded-none' : 'rounded-[5px]'}
        ${isDragging || isResizing ? '' : 'transition-all duration-180'}
        backdrop-blur-lg`}
      style={{
        boxShadow: isMaximized
          ? '0 10px 30px rgba(2,6,23,0.45)'
          : '0 6px 30px rgba(11,15,30,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
        border: isMaximized ? 'none' : '1px solid #424242',
        height: isMaximized ? undefined : '400px',
        ...windowStyle
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') toggleMaximize?.()
      }}
    >
      {/* Title bar with integrated tabs */}
      <div
        className={`flex items-center overflow-hidden justify-between gap-[0] px-[0] py-[0]
          ${isMaximized ? 'rounded-t-none' : 'rounded-t-[5px]'}
          cursor-move bg-[#2D2D2D]`}
        onMouseDown={handleMouseDown}
        aria-hidden
      >
        {/* Left side: Tabs or Title */}
        <div className="flex items-center min-w-0 flex-1 overflow-hidden">
          {tabs && tabs.length > 1 ? (
            // Show tabs with S-curve styling
            (() => {
              const activeIndex = tabs.findIndex(t => t.active)
              const activeTab = tabs.find(t => t.active)
              
              return tabs.map((tab, index) => {
                const isLeftOfActive = index === activeIndex - 1
                const isRightOfActive = index === activeIndex + 1
                
                return (
                  <div
                    key={tab.id}
                    className={`group relative flex items-center w-[40%] gap-1 px-4 py-1.5 text-xs cursor-pointer
                      ${tab.active 
                        ? 'bg-[#1F1F1F] text-white rounded-t-lg z-10' 
                        : 'text-gray-400 hover:text-gray-200 hover:bg-[#383838] transition-none'
                      }`}
                    style={tab.active ? { marginLeft: index === 0 ? '0' : '-8px', marginRight: '-8px' } : {}}
                    onClick={(e) => { e.stopPropagation(); tab.onActivate(); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseEnter={() => {
                      if (isLeftOfActive && activeTab) {
                        const circle = document.getElementById(`circle-left-${activeTab.id}`)
                        if (circle) circle.style.backgroundColor = '#383838'
                      }
                      if (isRightOfActive && activeTab) {
                        const circle = document.getElementById(`circle-right-${activeTab.id}`)
                        if (circle) circle.style.backgroundColor = '#383838'
                      }
                    }}
                    onMouseLeave={() => {
                      if (isLeftOfActive && activeTab) {
                        const circle = document.getElementById(`circle-left-${activeTab.id}`)
                        if (circle) circle.style.backgroundColor = '#2D2D2D'
                      }
                      if (isRightOfActive && activeTab) {
                        const circle = document.getElementById(`circle-right-${activeTab.id}`)
                        if (circle) circle.style.backgroundColor = '#2D2D2D'
                      }
                    }}
                  >
                    {/* Left S-curve for active tab */}
                    {tab.active && index > 0 && (
                      <>
                        <div 
                          className="absolute bottom-0 -left-2 w-2 h-2 bg-[#1F1F1F]"
                          style={{ pointerEvents: 'none' }}
                        />
                        <div 
                          className="absolute bottom-0 -left-4 w-4 h-4 rounded-full bg-[#2D2D2D] z-10"
                          style={{ pointerEvents: 'none' }}
                          id={`circle-left-${tab.id}`}
                        />
                      </>
                    )}
                    {/* Right S-curve for active tab */}
                    {tab.active && (
                      <>
                        <div 
                          className="absolute bottom-0 -right-2 w-2 h-2 bg-[#1F1F1F]"
                          style={{ pointerEvents: 'none' }}
                        />
                        <div 
                          className="absolute bottom-0 -right-4 w-4 h-4 rounded-full bg-[#2D2D2D] z-10"
                          style={{ pointerEvents: 'none' }}
                          id={`circle-right-${tab.id}`}
                        />
                      </>
                    )}
                    <span className="truncate flex-1 z-20">{tab.title}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); tab.onClose(); }}
                      className="ml-auto w-4 h-4 flex items-center z-20 justify-center rounded hover:bg-red-600/80 transition flex-shrink-0"
                    >
                      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M6 6l12 12M6 18L18 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                )
              })
            })()
          ) : (
            // Show title only
            <div className="flex items-center gap-2 min-w-0 ml-2 py-1">
              <span className="text-xs text-gray-300 font-medium truncate">{title}</span>
            </div>
          )}
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
<path xmlns="http://www.w3.org/2000/svg" fillRule="evenodd" clipRule="evenodd" d="M23 4C23 2.34315 21.6569 1 20 1H8C6.34315 1 5 2.34315 5 4V5H4C2.34315 5 1 6.34315 1 8V20C1 21.6569 2.34315 23 4 23H16C17.6569 23 19 21.6569 19 20V19H20C21.6569 19 23 17.6569 23 16V4ZM19 17H20C20.5523 17 21 16.5523 21 16V4C21 3.44772 20.5523 3 20 3H8C7.44772 3 7 3.44772 7 4V5H16C17.6569 5 19 6.34315 19 8V17ZM16 7C16.5523 7 17 7.44772 17 8V20C17 20.5523 16.5523 21 16 21H4C3.44772 21 3 20.5523 3 20V8C3 7.44772 3.44772 7 4 7H16Z" fill="white"/>                </svg>
              ) : (
                <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none">
                  <rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              )}
            </button>

            {/* Close — closes entire window */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); (tabs && tabs.length > 1 ? onCloseAll : onClose)?.() }}
              aria-label="Close Window"
              title="Close Window"
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
        className={`bg-gray-700 flex-1 overflow-hidden ${noPadding ? '' : 'p-1'}`}
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
            <path d="M0 10 L10 0 M6 10 L10 6 M2 10 L10 2" stroke="none" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  )
}
