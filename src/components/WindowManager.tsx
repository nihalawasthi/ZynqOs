import React, { useState, useEffect, useMemo } from 'react'
import Window from './Window'
import { v4 as uuidv4 } from 'uuid'
import { useCrossWindow } from '../hooks/useCrossWindow'
import SharedWindowPool, { type SharedWindowData } from '../utils/SharedWindowPool'
import { calculateTilePositions, suggestLayout, type TilingLayout, type WindowTile } from '../utils/WindowTiling'
import { getDeviceIdentifierSync } from '../utils/UserIdentifier'

type Win = { 
  id: string
  title: string
  content: React.ReactNode | (() => React.ReactElement)
  appType: string  // For grouping tabs (e.g., 'text-editor', 'terminal', 'file-browser')
  position?: { x: number; y: number }
  width?: number
  maximized?: boolean
  minimized?: boolean
}

type WindowGroup = {
  id: string
  appType: string
  windows: Win[]
  activeTabId: string
}

export default function WindowManager() {
  const [windowGroups, setWindowGroups] = useState<WindowGroup[]>([])
  const [tilingLayout, setTilingLayout] = useState<TilingLayout>('free')
  const [windowPool, setWindowPool] = useState<SharedWindowPool | null>(null)
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null)
  const [isAnyWindowMaximized, setIsAnyWindowMaximized] = useState(false)
  
  // Ref to store current windowGroups for use in exposed functions
  const windowGroupsRef = React.useRef<WindowGroup[]>([])
  const setWindowGroupsRef = React.useRef<typeof setWindowGroups | null>(null)
  
  // Store setState functions in refs so they're accessible everywhere
  React.useEffect(() => {
    windowGroupsRef.current = windowGroups
  }, [windowGroups])
  
  React.useEffect(() => {
    setWindowGroupsRef.current = setWindowGroups
  }, [])
  
  // Add device identifier to metadata for cross-window identification
  const userIdentifier = getDeviceIdentifierSync()
  const { currentWindow } = useCrossWindow(true, { userId: userIdentifier, timestamp: Date.now() })
  const processingWindowsRef = React.useRef(new Set<string>()) // Track windows being processed
  const maximizedWindowsRef = React.useRef(new Set<string>()) // Track which windows are maximized
  const wasMaximizedOnMinimizeRef = React.useRef(new Set<string>()) // Track groups minimized while maximized

  // Initialize shared window pool
  useEffect(() => {
    if (currentWindow) {
      const pool = new SharedWindowPool(currentWindow.id)
      
      // Listen for incoming window transfers
      pool.onTransfer((request) => {
        // Skip if already processing this window
        if (processingWindowsRef.current.has(request.windowId)) {
          console.log(`[WindowManager] Window ${request.windowId} already being processed, skipping`);
          return
        }
        
        console.log(`[WindowManager] Window ${currentWindow.id}: Received transfer request for window ${request.windowId}`);
        processingWindowsRef.current.add(request.windowId);
        
        const windowData = pool.getWindowData(request.windowId)
        console.log(`[WindowManager] Window data retrieved:`, windowData);
        if (windowData) {
          console.log(`[WindowManager] Window data found, recreating with ID ${request.windowId}`);
          
          // Try to retrieve the original content first from the content snapshot key
          let content = null
          if (windowData.contentSnapshot) {
            content = globalThis[windowData.contentSnapshot]
            console.log(`[WindowManager] Retrieved content from snapshot key: ${windowData.contentSnapshot}`, !!content);
          }
          
          // Fallback to UI key if content snapshot not available
          if (!content) {
            const uiKey = `__${windowData.appType.toUpperCase().replace(/-/g, '_')}_UI__`
            console.log(`[WindowManager] Looking for UI with key: ${uiKey}`);
            content = globalThis[uiKey]
            
            if (!content) {
              console.warn(`[WindowManager] UI not found at key: ${uiKey}. Available globals:`, Object.keys(globalThis).filter(k => k.includes('UI')));
            }
          }
          
          openWindow(windowData.title, content || <div>App Loading...</div>, windowData.appType, windowData.position, windowData.width, request.windowId)
          
          // Clean up transferred window data
          pool.removeWindowData(request.windowId)
          
          // Remove from processing set after cleanup
          setTimeout(() => processingWindowsRef.current.delete(request.windowId), 500)
        } else {
          console.warn(`[WindowManager] Window data NOT found for window ${request.windowId}`);
          processingWindowsRef.current.delete(request.windowId);
        }
      })

      setWindowPool(pool)

      return () => {
        pool.destroy()
      }
    }
  }, [currentWindow?.id])

  function openWindow(title: string, content: React.ReactNode | (() => React.ReactElement), appType?: string, initialPos?: { x: number; y: number }, initialWidth?: number, preserveId?: string, maximized?: boolean) {
    const id = preserveId || uuidv4()
    const newWindow: Win = { id, title, content, appType: appType || title, position: initialPos, width: initialWidth, maximized, minimized: false }
    
    // Check if this is a transferred window by checking if the ID already exists somewhere
    const existingWindowLocation = windowGroupsRef.current.find(g => g.windows.some(w => w.id === id))
    if (existingWindowLocation) {
      // This window is being transferred - don't create a duplicate
      console.log(`[WindowManager] Window ${id} already exists, skipping duplicate creation`);
      return
    }
    
    // Check if there's an existing group for this app type
    const existingGroupIndex = windowGroupsRef.current.findIndex(g => g.appType === newWindow.appType && !preserveId)
    
    if (existingGroupIndex >= 0 && !preserveId) {
      // Add to existing group as a new tab (only if NOT a transferred window)
      setWindowGroupsRef.current?.(groups => groups.map((g, idx) => 
        idx === existingGroupIndex 
          ? { ...g, windows: [...g.windows, newWindow], activeTabId: id }
          : g
      ))
    } else {
      // Create new group (either first window of this type or a transferred window)
      const groupId = uuidv4()
      setWindowGroupsRef.current?.(groups => [...groups, {
        id: groupId,
        appType: newWindow.appType,
        windows: [newWindow],
        activeTabId: id
      }])
    }
  }

  function closeWindow(groupId: string, windowId: string) {
    setWindowGroups(groups => {
      const group = groups.find(g => g.id === groupId)
      if (!group) return groups

      const newWindows = group.windows.filter(w => w.id !== windowId)
      
      if (newWindows.length === 0) {
        // Close entire group - remove from maximized set
        maximizedWindowsRef.current.delete(groupId)
        setIsAnyWindowMaximized(maximizedWindowsRef.current.size > 0)
        return groups.filter(g => g.id !== groupId)
      }
      
      // Update group with remaining windows
      return groups.map(g => 
        g.id === groupId 
          ? { 
              ...g, 
              windows: newWindows,
              activeTabId: g.activeTabId === windowId 
                ? newWindows[newWindows.length - 1].id 
                : g.activeTabId
            }
          : g
      )
    })
  }

  function setActiveTab(groupId: string, tabId: string) {
    setWindowGroups(groups => groups.map(g => 
      g.id === groupId ? { ...g, activeTabId: tabId } : g
    ))
  }

  function closeWindowGroup(groupId: string) {
    // Remove from maximized set when closing
    maximizedWindowsRef.current.delete(groupId)
    setIsAnyWindowMaximized(maximizedWindowsRef.current.size > 0)
    setWindowGroups(groups => groups.filter(g => g.id !== groupId))
  }

  // Handle window transfer to another parent window
  function transferWindow(windowId: string, groupId: string, toParentId: number, transferPosition?: { x: number; y: number }, transferWidth?: number) {
    if (!windowPool || !currentWindow) return

    const group = windowGroups.find(g => g.id === groupId)
    const windowToTransfer = group?.windows.find(w => w.id === windowId)
    if (!windowToTransfer) return

    // Store the actual content in a global registry that can be accessed across windows
    const contentKey = `__WINDOW_CONTENT_${windowId}__`
    globalThis[contentKey] = windowToTransfer.content

    const windowData: SharedWindowData = {
      id: windowId,
      title: windowToTransfer.title,
      appType: windowToTransfer.appType,
      ownerWindowId: currentWindow.id,
      timestamp: Date.now(),
      position: transferPosition,
      width: transferWidth,
      contentSnapshot: contentKey, // Store the key to retrieve content
    }

    windowPool.requestTransfer(windowId, toParentId, windowData)
    
    // Remove from current parent window
    closeWindow(groupId, windowId)
  }

  // Apply tiling layout
  function applyTiling(layout: TilingLayout) {
    setTilingLayout(layout)
  }

  // Handle window maximized state changes
  function handleWindowMaximizedChange(groupId: string, isMaximized: boolean) {
    if (isMaximized) {
      maximizedWindowsRef.current.add(groupId)
    } else {
      maximizedWindowsRef.current.delete(groupId)
    }
    setIsAnyWindowMaximized(maximizedWindowsRef.current.size > 0)
  }

  // Handle window minimize
  function handleWindowMinimize(groupId: string) {
    setWindowGroups(groups => groups.map(g =>
      g.id === groupId ? { ...g, windows: g.windows.map(w => ({ ...w, minimized: true })) } : g
    ))
    // If this was a maximized window being minimized, check if we should show UI again
    if (maximizedWindowsRef.current.has(groupId)) {
      // Remember that this group was maximized when minimized
      wasMaximizedOnMinimizeRef.current.add(groupId)
      setIsAnyWindowMaximized(false)
      maximizedWindowsRef.current.delete(groupId)
    }
  }

  // Restore minimized window
  function restoreMinimizedWindow(groupId: string) {
    setWindowGroups(groups => groups.map(g =>
      g.id === groupId ? { ...g, windows: g.windows.map(w => ({ ...w, minimized: false })) } : g
    ))
    setActiveWindowId(groupId)
    // If it was maximized when minimized, restore maximized state so taskbar/snap menu hide correctly
    if (wasMaximizedOnMinimizeRef.current.has(groupId)) {
      wasMaximizedOnMinimizeRef.current.delete(groupId)
      maximizedWindowsRef.current.add(groupId)
      setIsAnyWindowMaximized(true)
    }
  }

  // Calculate tiled positions
  let tilePositions = new Map<string, WindowTile>()
  
  if (tilingLayout !== 'free') {
    const allWindowIds = windowGroups.map(g => g.id)
    const tiles = calculateTilePositions(
      tilingLayout,
      allWindowIds,
      globalThis.innerWidth,
      globalThis.innerHeight
    )

    if (Array.isArray(tiles)) {
      tilePositions = new Map(tiles.map(tile => [tile.windowId, tile]))
    } else {
      console.error('calculateTilePositions did not return an array:', tiles)
    }
  }

  // expose for quick demo usage
  // Expose openWindow and setTiling on mount
  useEffect(() => {
    (globalThis as any).ZynqOS_openWindow = openWindow;
    (globalThis as any).ZynqOS_setTiling = applyTiling;
  }, [])

  useEffect(() => {
    // Build minimized windows list
    const minimizedList = Array.isArray(windowGroups)
      ? windowGroups.filter(g => g.windows.some(w => w.minimized)).map(g => ({
            id: g.id,
            title: g.windows[0]?.title || 'Window',
            appType: g.appType
          }))
      : [];

    // Build opened windows list (all windows - both minimized and non-minimized)
    const openedList = Array.isArray(windowGroups)
      ? windowGroups.map(g => ({
            id: g.id,
            title: g.windows[0]?.title || 'Window',
            appType: g.appType
          }))
      : [];

    (globalThis as any).ZynqOS_isAnyWindowMaximized = isAnyWindowMaximized;
    (globalThis as any).ZynqOS_minimizedWindows = minimizedList;
    (globalThis as any).ZynqOS_openedWindows = openedList;
    (globalThis as any).ZynqOS_restoreMinimized = restoreMinimizedWindow;
  }, [isAnyWindowMaximized, windowGroups])

  return (
    <div className="flex-1 relative overflow-hidden">
      {/* Tiling Controls - Always visible on hover (hidden when maximized) */}
      {!isAnyWindowMaximized && (
        <div className="fixed top-2 left-2 z-[9999] bg-black/80 backdrop-blur-sm rounded-lg p-2 flex gap-1 opacity-0 hover:opacity-100 transition-opacity duration-300">
          <button
            onClick={() => applyTiling('free')}
            className={`px-2 py-1 text-xs rounded transition ${tilingLayout === 'free' ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            title="Free positioning"
          >
            <i className="fas fa-th"></i>
          </button>
          <button
            onClick={() => applyTiling('split-vertical')}
            className={`px-2 py-1 text-xs rounded transition ${tilingLayout === 'split-vertical' ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            title="Split vertical"
          >
            <i className="fas fa-columns"></i>
          </button>
          <button
            onClick={() => applyTiling('split-horizontal')}
            className={`px-2 py-1 text-xs rounded transition ${tilingLayout === 'split-horizontal' ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            title="Split horizontal"
          >
            <i className="fas fa-bars rotate-90"></i>
          </button>
          <button
            onClick={() => applyTiling('grid-2x2')}
            className={`px-2 py-1 text-xs rounded transition ${tilingLayout === 'grid-2x2' ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            title="2×2 Grid"
          >
            <i className="fas fa-th-large"></i>
          </button>
          <button
            onClick={() => applyTiling(suggestLayout(windowGroups.length))}
            className="px-2 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-500 transition"
            title="Auto layout"
          >
            <i className="fas fa-magic"></i>
          </button>
        </div>
      )}

      {Array.isArray(windowGroups) && windowGroups.length > 0 ? (
        windowGroups.map((group, idx) => {
        const activeWindow = group.windows.find(w => w.id === group.activeTabId) || group.windows[0]
        const hasTabs = group.windows.length > 1
        const tilePos = tilePositions.get(group.id)
        const isActive = activeWindowId === group.id
        
        // Use transferred position if available, otherwise use default or tiled position
        const initialPos = activeWindow.position || (tilePos ? { x: tilePos.x, y: tilePos.y } : { x: 100 + idx * 30, y: 60 + idx * 30 })
        
        return (
          <Window 
            key={group.id} 
            title={activeWindow.title} 
            onClose={() => closeWindow(group.id, activeWindow.id)}
            onCloseAll={() => closeWindowGroup(group.id)}
            initialPosition={initialPos}
            initialWidth={activeWindow.width}
            forcedPosition={tilePos ? { x: tilePos.x, y: tilePos.y, width: tilePos.width, height: tilePos.height } : undefined}
            isTiled={tilingLayout !== 'free'}
            isActive={isActive}
            onActivate={() => setActiveWindowId(group.id)}
            onTransfer={windowPool && currentWindow ? (toParentId, position, width) => transferWindow(activeWindow.id, group.id, toParentId, position, width) : undefined}
            windowPool={windowPool}
            tabs={hasTabs ? group.windows.map(w => ({
              id: w.id,
              title: w.title,
              active: w.id === group.activeTabId,
              onActivate: () => setActiveTab(group.id, w.id),
              onClose: () => closeWindow(group.id, w.id)
            })) : undefined}
            initialMaximized={activeWindow.maximized}
            initialMinimized={activeWindow.minimized || false}
            onMaximizedChange={(isMaximized) => handleWindowMaximizedChange(group.id, isMaximized)}
            onMinimize={() => handleWindowMinimize(group.id)}
          >
            {typeof activeWindow.content === 'function' ? <activeWindow.content /> : activeWindow.content}
          </Window>
        )
      })
      ) : null}
    </div>
  )
}
