import React, { useState, useRef, useEffect } from 'react'
import { detectSnapZone, getSnapPosition, snapToEdge, constrainToBounds, getSnapZoneFromShortcut, type SnapZone } from '../utils/WindowSnap'
import SharedWindowPool from '../utils/SharedWindowPool'
import DisplaySelector from './DisplaySelector'

type Tab = {
  id: string
  title: string
  active: boolean
  onActivate: () => void
  onClose: () => void
}

type ForcedPosition = {
  x: number
  y: number
  width: number
  height: number
}

export default function Window({
  title,
  children,
  onClose,
  onCloseAll,
  initialPosition = { x: 100, y: 60 },
  initialWidth,
  forcedPosition,
  isTiled = false,
  isActive = false,
  onActivate,
  onTransfer,
  windowPool,
  tabs,
  initialMaximized = false,
  initialMinimized = false,
  onMaximizedChange,
  onMinimize
}: {
  title: string
  children: React.ReactNode
  onClose?: () => void
  onCloseAll?: () => void
  initialPosition?: { x: number; y: number }
  initialWidth?: number
  forcedPosition?: ForcedPosition
  isTiled?: boolean
  isActive?: boolean
  onActivate?: () => void
  onTransfer?: (toParentId: number, position: { x: number; y: number }, width: number) => void
  windowPool?: SharedWindowPool | null
  tabs?: Tab[]
  initialMaximized?: boolean
  initialMinimized?: boolean
  onMaximizedChange?: (maximized: boolean) => void
  onMinimize?: () => void
}) {
  const [position, setPosition] = useState(initialPosition)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isResizing, setIsResizing] = useState(false)
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0 })
  const [resizedWidth, setResizedWidth] = useState<number | null>(initialWidth ?? null)
  const [isMaximized, setIsMaximized] = useState(initialMaximized)
  const [isMinimized, setIsMinimized] = useState(initialMinimized)
  const [prevPosition, setPrevPosition] = useState(initialPosition)
  const [snapZone, setSnapZone] = useState<SnapZone>(null)
  const [isSnapped, setIsSnapped] = useState(false)
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 })
  const [isTransferring, setIsTransferring] = useState(false)
  const [showDisplaySelector, setShowDisplaySelector] = useState(false)
  const [selectedDisplayId, setSelectedDisplayId] = useState<number | null>(null)
  const [dragDisplayPosition, setDragDisplayPosition] = useState<{ x: number; y: number } | null>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  const windowIdRef = useRef<string | null>(null)
  const transferredRef = useRef(false) // Prevent multiple transfers in one drag
  const displayTransferInitiatedRef = useRef(false) // Track if display transfer is in progress
  const showDisplaySelectorRef = useRef(false)
  const selectedDisplayIdRef = useRef<number | null>(null)

  // Keep refs in sync with state
  useEffect(() => {
    showDisplaySelectorRef.current = showDisplaySelector
  }, [showDisplaySelector])

  useEffect(() => {
    selectedDisplayIdRef.current = selectedDisplayId
  }, [selectedDisplayId])

  // Sync minimized state from parent
  useEffect(() => {
    setIsMinimized(initialMinimized || false)
  }, [initialMinimized])

  // Apply forced position from tiling layout
  useEffect(() => {
    if (forcedPosition && isTiled) {
      setPosition({ x: forcedPosition.x, y: forcedPosition.y })
      setResizedWidth(forcedPosition.width)
      if (windowRef.current) {
        windowRef.current.style.height = `${forcedPosition.height}px`
      }
    }
  }, [forcedPosition, isTiled])

  useEffect(() => {
    const BOTTOM_THRESHOLD = 150; // Distance from bottom to show display selector
    
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = e.clientX - dragOffset.x
        const newY = e.clientY - dragOffset.y

        // Don't allow dragging when tiled
        if (isTiled) return

        // Check if dragging near bottom of screen (for display transfer)
        const distanceFromBottom = window.innerHeight - e.clientY
        const isNearBottom = distanceFromBottom < BOTTOM_THRESHOLD
        
        if (isNearBottom && !displayTransferInitiatedRef.current && !showDisplaySelector) {
          // Show display selector when dragging near bottom
          setShowDisplaySelector(true)
          setDragDisplayPosition({ x: e.clientX, y: e.clientY })
        }
        
        // Update drag position while selector is visible
        if (showDisplaySelector) {
          setDragDisplayPosition({ x: e.clientX, y: e.clientY })
          // Don't allow normal dragging while selector is active
          return
        }

        // Detect snap zone
        const zone = detectSnapZone(e.clientX, e.clientY, window.innerWidth, window.innerHeight)
        setSnapZone(zone)

        // Apply edge snapping if not in a snap zone
        if (!zone) {
          const snapped = snapToEdge(
            newX,
            newY,
            windowRef.current?.offsetWidth || 600,
            windowRef.current?.offsetHeight || 400,
            window.innerWidth,
            window.innerHeight
          )
          setPosition(snapped)
        } else {
          setPosition({ x: newX, y: newY })
        }
      }
      if (isResizing) {
        if (isTiled) return // Don't allow resizing when tiled
        const deltaX = e.clientX - resizeStart.x
        setResizedWidth(Math.max(300, resizeStart.width + deltaX))
      }
    }

    const handleMouseUp = () => {
      const currentShowSelector = showDisplaySelectorRef.current
      const currentSelectedId = selectedDisplayIdRef.current
      
      if (isDragging) {
        console.log('[Window] MouseUp', {
          showDisplaySelector: currentShowSelector,
          selectedDisplayId: currentSelectedId,
          hasOnTransfer: !!onTransfer,
          hasWindowPool: !!windowPool,
        })
      }

      // Reset transfer flag on drag end
      transferredRef.current = false
      
      // Handle display-based transfer
      if (isDragging && currentShowSelector && currentSelectedId && onTransfer && windowPool) {
        console.log(`[Window] Display transfer initiated to display ${currentSelectedId}`);
        displayTransferInitiatedRef.current = true
        setIsTransferring(true)
        
        // Get target window position
        const targetWindowPos = windowPool.getParentWindowPosition(currentSelectedId)
        console.log(`[Window] Target window position:`, targetWindowPos);
        
        if (targetWindowPos) {
          // Calculate center position in target window
          const relativeX = (targetWindowPos.w - (windowRef.current?.offsetWidth || 600)) / 2
          const relativeY = (targetWindowPos.h - (windowRef.current?.offsetHeight || 400)) / 2
          
          console.log(`[Window] Transferring to display ${currentSelectedId}. Target position: (${relativeX}, ${relativeY})`);
          
          // Call the transfer handler with proper parameters
          onTransfer(currentSelectedId, { x: Math.max(0, relativeX), y: Math.max(0, relativeY) }, windowRef.current?.offsetWidth || 600)
        } else {
          console.warn(`[Window] Could not get target window position for display ${currentSelectedId}`);
        }
      }
      
      // Apply snap if in snap zone
      if (isDragging && snapZone && !isTiled) {
        const snapPos = getSnapPosition(snapZone, window.innerWidth, window.innerHeight)
        if (snapPos) {
          setPosition({ x: snapPos.x, y: snapPos.y })
          setResizedWidth(snapPos.width)
          setPrevPosition({ x: snapPos.x, y: snapPos.y })
          setIsSnapped(true)
          
          // Update window height via custom property
          if (windowRef.current) {
            windowRef.current.style.height = `${snapPos.height}px`
          }
        }
      }
      
      // Reset display selector
      setShowDisplaySelector(false)
      setSelectedDisplayId(null)
      setDragDisplayPosition(null)
      
      setIsDragging(false)
      setIsResizing(false)
      setSnapZone(null)
    }

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, isResizing, dragOffset, resizeStart, snapZone, isTiled, windowPool, onTransfer])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isMaximized && !isTiled && windowRef.current) {
      const rect = windowRef.current.getBoundingClientRect()
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      })
      setDragStartPos({ x: e.clientX, y: e.clientY })
      setIsDragging(true)
      setIsSnapped(false) // Unsnap when starting to drag
      onActivate?.()
    }
  }

  const toggleMaximize = () => {
    if (isMaximized) {
      // Restore
      setPosition(prevPosition)
      setIsMaximized(false)
      setIsSnapped(false)
      onMaximizedChange?.(false)
      if (windowRef.current) {
        windowRef.current.style.height = '400px'
      }
    } else {
      // Maximize
      setPrevPosition(position)
      setPosition({ x: 0, y: 0 })
      setIsMaximized(true)
      setIsSnapped(false)
      onMaximizedChange?.(true)
    }
  }

  const handleMinimize = () => {
    setIsMinimized(true)
    onMinimize?.()
  }

  // Keyboard shortcuts for snapping
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!windowRef.current?.matches(':focus-within')) return

      const zone = getSnapZoneFromShortcut(e.key, e.ctrlKey, e.shiftKey)
      if (zone) {
        e.preventDefault()
        const snapPos = getSnapPosition(zone, window.innerWidth, window.innerHeight)
        if (snapPos) {
          setPosition({ x: snapPos.x, y: snapPos.y })
          setResizedWidth(snapPos.width)
          setPrevPosition({ x: snapPos.x, y: snapPos.y })
          setIsSnapped(true)
          const isNowMaximized = zone === 'maximize'
          setIsMaximized(isNowMaximized)
          onMaximizedChange?.(isNowMaximized)
          
          if (windowRef.current) {
            windowRef.current.style.height = `${snapPos.height}px`
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const windowStyle = isMinimized
    ? { display: 'none' }
    : isMaximized
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
    <>
      <div
        ref={windowRef}
        role="dialog"
        aria-label={title}
        tabIndex={0}
        className={`absolute select-none will-change-transform bg-[#1F1F1F] flex flex-col
          ${isMaximized ? 'inset-0 rounded-none' : 'rounded-[5px]'}
          ${isDragging || isResizing ? '' : 'transition-all duration-300'}
          ${isTransferring ? 'opacity-70' : 'opacity-100'}
          ${isTiled ? 'pointer-events-auto' : ''}
          backdrop-blur-lg`}
        style={{
          boxShadow: isMaximized
            ? '0 10px 30px rgba(2,6,23,0.45)'
            : isActive 
              ? '0 8px 24px rgba(74, 158, 255, 0.2), inset 0 1px 0 rgba(255,255,255,0.06)'
              : '0 6px 20px rgba(11,15,30,0.25), inset 0 1px 0 rgba(255,255,255,0.06)',
          border: isMaximized ? 'none' : (isTiled && isActive) ? '2px solid #4a9eff' : isTiled ? '1px solid #424242' : isActive ? '2px solid #4a9eff' : '1px solid #424242',
          height: isMaximized ? undefined : '400px',
          ...windowStyle
        }}
        onClick={() => onActivate?.()}
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
            {/* Minimize */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleMinimize() }}
              aria-label="Minimize"
              title="Minimize"
              className="w-7 h-7 flex items-center justify-center hover:bg-slate-100/40 active:scale-95 transition"
            >
              <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none">
                <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>

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
        className="bg-gray-700 flex-1 overflow-hidden"
        style={{
          borderBottomLeftRadius: isMaximized ? 0 : 5,
          borderBottomRightRadius: isMaximized ? 0 : 5,
          minHeight: 80
        }}
      >
        {children}
      </div>

      {/* bottom-right diagonal resize affordance */}
      {!isMaximized && !isTiled && (
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
      
      {/* Display Selector for cross-display window transfer */}
      <DisplaySelector 
        isVisible={showDisplaySelector}
        dragPosition={dragDisplayPosition}
        selectedDisplayId={selectedDisplayId}
        onDisplaySelect={(displayId) => setSelectedDisplayId(displayId)}
      />
    </>
  )
}
