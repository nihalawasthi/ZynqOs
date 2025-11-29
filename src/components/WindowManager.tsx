import React, { useState } from 'react'
import Window from './Window'
import { v4 as uuidv4 } from 'uuid'

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

  // expose for quick demo usage
  (window as any).ZynqOS_openWindow = openWindow

  return (
    <div className="flex-1 relative overflow-hidden">
      {windowGroups.map((group, idx) => {
        const activeWindow = group.windows.find(w => w.id === group.activeTabId) || group.windows[0]
        const hasTabs = group.windows.length > 1
        const noPadding = group.appType === 'Terminal' || group.appType === 'Zynqpad' || group.appType === 'terminal' || group.appType === 'text-editor'
        
        return (
          <Window 
            key={group.id} 
            title={activeWindow.title} 
            onClose={() => closeWindow(group.id, activeWindow.id)}
            onCloseAll={() => closeWindowGroup(group.id)}
            initialPosition={{ x: 100 + idx * 30, y: 60 + idx * 30 }}
            noPadding={noPadding}
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
