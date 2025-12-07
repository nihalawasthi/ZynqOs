import React, { useState, useEffect, useMemo } from 'react'
import Window from './Window'
import { v4 as uuidv4 } from 'uuid'
import { useCrossWindow } from '../hooks/useCrossWindow'
import SharedWindowPool, { type SharedWindowData } from '../utils/SharedWindowPool'
import { calculateTilePositions, suggestLayout, type TilingLayout, type WindowTile } from '../utils/WindowTiling'

type Win = { 
  id: string
  title: string
  content: React.ReactNode | (() => React.ReactElement)
  appType: string  // For grouping tabs (e.g., 'text-editor', 'terminal', 'file-browser')
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
  const { currentWindow } = useCrossWindow(true)

  // Initialize shared window pool
  useEffect(() => {
    if (currentWindow) {
      const pool = new SharedWindowPool(currentWindow.id)
      
      // Listen for incoming window transfers
      pool.onTransfer((request) => {
        const windowData = pool.getWindowData(request.windowId)
        if (windowData) {
          // Recreate window in this parent window
          const content = globalThis[`__${windowData.appType.toUpperCase().replace(/-/g, '_')}_UI__`] || <div>Loading...</div>
          openWindow(windowData.title, content, windowData.appType)
          
          // Clean up transferred window data
          pool.removeWindowData(request.windowId)
        }
      })

      setWindowPool(pool)

      return () => {
        pool.destroy()
      }
    }
  }, [currentWindow?.id])

  function openWindow(title: string, content: React.ReactNode | (() => React.ReactElement), appType?: string) {
    const id = uuidv4()
    const newWindow: Win = { id, title, content, appType: appType || title }
    
    // Check if there's an existing group for this app type
    const existingGroupIndex = windowGroups.findIndex(g => g.appType === newWindow.appType)
    
    if (existingGroupIndex >= 0) {
      // Add to existing group as a new tab
      setWindowGroups(groups => groups.map((g, idx) => 
        idx === existingGroupIndex 
          ? { ...g, windows: [...g.windows, newWindow], activeTabId: id }
          : g
      ))
    } else {
      // Create new group
      const groupId = uuidv4()
      setWindowGroups(groups => [...groups, {
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
        // Close entire group
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
    setWindowGroups(groups => groups.filter(g => g.id !== groupId))
  }

  // Handle window transfer to another parent window
  function transferWindow(windowId: string, groupId: string, toParentId: number) {
    if (!windowPool || !currentWindow) return

    const group = windowGroups.find(g => g.id === groupId)
    const windowToTransfer = group?.windows.find(w => w.id === windowId)
    if (!windowToTransfer) return

    const windowData: SharedWindowData = {
      id: windowId,
      title: windowToTransfer.title,
      appType: windowToTransfer.appType,
      ownerWindowId: currentWindow.id,
      timestamp: Date.now(),
    }

    windowPool.requestTransfer(windowId, toParentId, windowData)
    
    // Remove from current parent window
    closeWindow(groupId, windowId)
  }

  // Apply tiling layout
  function applyTiling(layout: TilingLayout) {
    setTilingLayout(layout)
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
  useEffect(() => {
    (globalThis as any).ZynqOS_openWindow = openWindow;
    (globalThis as any).ZynqOS_setTiling = applyTiling
  })

  return (
    <div className="flex-1 relative overflow-hidden">
      {/* Tiling Controls - Always visible on hover */}
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

      {windowGroups.map((group, idx) => {
        const activeWindow = group.windows.find(w => w.id === group.activeTabId) || group.windows[0]
        const hasTabs = group.windows.length > 1
        const tilePos = tilePositions.get(group.id)
        const isActive = activeWindowId === group.id
        
        return (
          <Window 
            key={group.id} 
            title={activeWindow.title} 
            onClose={() => closeWindow(group.id, activeWindow.id)}
            onCloseAll={() => closeWindowGroup(group.id)}
            initialPosition={tilePos ? { x: tilePos.x, y: tilePos.y } : { x: 100 + idx * 30, y: 60 + idx * 30 }}
            forcedPosition={tilePos ? { x: tilePos.x, y: tilePos.y, width: tilePos.width, height: tilePos.height } : undefined}
            isTiled={tilingLayout !== 'free'}
            isActive={isActive}
            onActivate={() => setActiveWindowId(group.id)}
            onTransfer={windowPool && currentWindow ? (toParentId) => transferWindow(activeWindow.id, group.id, toParentId) : undefined}
            windowPool={windowPool}
            tabs={hasTabs ? group.windows.map(w => ({
              id: w.id,
              title: w.title,
              active: w.id === group.activeTabId,
              onActivate: () => setActiveTab(group.id, w.id),
              onClose: () => closeWindow(group.id, w.id)
            })) : undefined}
          >
            {typeof activeWindow.content === 'function' ? <activeWindow.content /> : activeWindow.content}
          </Window>
        )
      })}
    </div>
  )
}
