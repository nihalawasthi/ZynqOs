import React, { useEffect, useState } from 'react'
import StartMenu from './StartMenu'
import MultiWindowIndicator from './MultiWindowIndicator'
import { formatDuration, useSessionTimer, SESSION_IDLE_THRESHOLD_MS } from '../utils/SessionTimer'

export default function Taskbar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const [minimizedWindows, setMinimizedWindows] = useState<Array<{ id: string; title: string; appType: string }>>([])
  const [openedWindows, setOpenedWindows] = useState<Array<{ id: string; title: string; appType: string }>>([])

  useEffect(() => {
    const checkMaximized = () => {
      setIsMaximized((globalThis as any).ZynqOS_isAnyWindowMaximized || false)
      setMinimizedWindows((globalThis as any).ZynqOS_minimizedWindows || [])
      setOpenedWindows((globalThis as any).ZynqOS_openedWindows || [])
    }
    
    const interval = setInterval(checkMaximized, 100)
    return () => clearInterval(interval)
  }, [])

  // Map app types to their display names for checking minimized status
  const appConfigs = [
    { appType: 'file-browser', title: 'File Browser', icon: 'fas fa-folder' },
    { appType: 'store', title: 'Store', icon: 'fa-solid fa-store' },
    { appType: 'phantomsurf', title: 'Phantom Surf', icon: 'fas fa-globe' },
    { appType: 'terminal', title: 'Terminal', icon: 'fa fa-terminal' },
    { appType: 'wednesday', title: 'Wednesday', icon: 'fa-solid fa-wand-magic-sparkles' },
    { appType: 'text-editor', title: 'Files & Zynqpad', icon: 'fas fa-folder' },
    { appType: 'python', title: 'Python', icon: 'fab fa-python' },
    { appType: 'calculator', title: 'Calculator', icon: 'fas fa-calculator' },
    { appType: 'settings', title: 'Settings', icon: 'fas fa-cog' },
    { appType: 'mapp-importer', title: 'Import Package', icon: 'fas fa-download' },
    { appType: 'zynqchat', title: 'ZynqChat', icon: 'fa-solid fa-comments' }
  ]

  const getIconForAppType = (appType: string): string => {
    return appConfigs.find(c => c.appType === appType)?.icon || 'fas fa-window-restore'
  }

  const getTitleForAppType = (appType: string): string => {
    return appConfigs.find(c => c.appType === appType)?.title || appType
  }

  // Get apps that are not in the fixed taskbar
  const fixedAppTypes = ['file-browser', 'store', 'phantomsurf', 'terminal', 'wednesday']
  const dynamicOpenedApps = openedWindows.filter(w => !fixedAppTypes.includes(w.appType))

  const isAppMinimized = (appType: string) => {
    return minimizedWindows.some(win => win.appType === appType)
  }

  const getMinimizedWindowId = (appType: string) => {
    return minimizedWindows.find(win => win.appType === appType)?.id
  }

  const handleAppClick = (appType: string, title: string, content?: any) => {
    const minimizedId = getMinimizedWindowId(appType)
    if (minimizedId) {
      // Restore minimized window
      (globalThis as any).ZynqOS_restoreMinimized?.(minimizedId)
    } else if (content) {
      // Open new window
      (window as any).ZynqOS_openWindow?.(title, content, appType)
    }
  }

  return (
    <div style={{ display: isMaximized ? 'none' : 'flex' }} className="fixed bottom-0 left-0 w-[100%] h-16 max-w-[100vw] p-0 bg-none flex items-center justify-center gap-2 z-40">
      <div className="mr-auto ml-4">
        {/* future components */}
      </div>
      <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2 w-[calc(60%-48px)] max-w-[980px] px-4 py-2 bg-[#1A1A1A] backdrop-blur-md border border-white/10 rounded-full shadow-2xl flex items-center gap-2">
        <StartMenu />

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleAppClick('file-browser', 'File Browser', window.__FILE_BROWSER_UI__ ?? <div>Loading...</div>)}
            title={isAppMinimized('file-browser') ? 'Restore File Browser' : 'File Browser'}
            className={`flex items-center gap-2 px-3 py-1 rounded-[2px] transition text-white border border-gray-300/20 ${isAppMinimized('file-browser') ? 'bg-gray-600/50 opacity-75' : 'bg-transparent hover:bg-gray-200/30'}`}
          >
            <span className="text-lg"><i className="fas fa-folder"></i></span>
            {isAppMinimized('file-browser')}
          </button>
          <button
            onClick={() => handleAppClick('store', 'App Store', window.__STORE_UI__ ?? <div>Loading...</div>)}
            title={isAppMinimized('store') ? 'Restore Store' : 'Store'}
            className={`flex items-center gap-2 px-3 py-1 rounded-[2px] transition text-white border border-gray-300/20 ${isAppMinimized('store') ? 'bg-gray-600/50 opacity-75' : 'bg-transparent hover:bg-gray-200/30'}`}
          >
            <span className="text-lg"><i className="fa-solid fa-store"></i></span>
            {isAppMinimized('store')}
          </button>
          <button
            onClick={() => handleAppClick('phantomsurf', 'Phantom Surf', window.__PHANTOMSURF_UI__ ?? <div>Loading...</div>)}
            title={isAppMinimized('phantomsurf') ? 'Restore Phantom Surf' : 'Phantom Surf'}
            className={`flex items-center gap-2 px-3 py-1 rounded-[2px] transition text-white border border-gray-300/20 ${isAppMinimized('phantomsurf') ? 'bg-gray-600/50 opacity-75' : 'bg-transparent hover:bg-gray-200/30'}`}
          >
            <span className="text-lg"><i className="fas fa-globe"></i></span>
            {isAppMinimized('phantomsurf')}
          </button>
          <button
            onClick={() => handleAppClick('terminal', 'Terminal', window.__TERMINAL_UI__ ?? <div>Loading Terminal...</div>)}
            title={isAppMinimized('terminal') ? 'Restore Terminal' : 'Terminal'}
            className={`flex items-center gap-2 px-3 py-1 rounded-[2px] transition text-white border border-gray-300/20 ${isAppMinimized('terminal') ? 'bg-gray-600/50 opacity-75' : 'bg-transparent hover:bg-gray-200/30'}`}
          >
            <span className="text-lg"><i className="fa fa-terminal"></i></span>
            {isAppMinimized('terminal')}
          </button>
          <button
            onClick={() => handleAppClick('wednesday', 'Wednesday AI', window.__WEDNESDAY_UI__ ?? <div>Loading Wednesday...</div>)}
            title={isAppMinimized('wednesday') ? 'Restore Wednesday' : 'Wednesday'}
            className={`flex items-center gap-2 px-3 py-1 rounded-[2px] transition text-white border border-gray-300/20 ${isAppMinimized('wednesday') ? 'bg-gray-600/50 opacity-75' : 'bg-transparent hover:bg-gray-200/30'}`}
          >
            <span className="text-lg font-thin"><i className="scale-90 fa-solid fa-wand-magic-sparkles"></i></span>
            {isAppMinimized('wednesday')}
          </button>
        </div>

        {/* Dynamic apps (opened but not in fixed taskbar) */}
        {dynamicOpenedApps.length > 0 && (
          <div className="flex items-center gap-2 px-2 border-l border-gray-700/50">
            {dynamicOpenedApps.map(app => (
              <button
                key={app.id}
                onClick={() => handleAppClick(app.appType, app.title)}
                title={isAppMinimized(app.appType) ? `Restore ${app.title}` : app.title}
                className={`flex items-center gap-2 px-3 py-1 rounded-[2px] transition text-white border border-gray-300/20 ${isAppMinimized(app.appType) ? 'bg-gray-600/50 opacity-75' : 'bg-transparent hover:bg-gray-200/30'}`}
              >
                <span className="text-lg"><i className={getIconForAppType(app.appType)}></i></span>
                {isAppMinimized(app.appType)}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Clock />
        </div>
      </div>
      <div className="ml-auto mr-4 flex items-center gap-2">
        <SessionTimerBadge />
        <MultiWindowIndicator />
      </div>
    </div>
  )
}

function SessionTimerBadge() {
  const session = useSessionTimer()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!session) return null

  const isActive =
    now - session.lastActivityTs < SESSION_IDLE_THRESHOLD_MS

  const liveMs =
    session.totalActiveMs +
    (isActive ? Math.max(0, now - session.lastUpdateTs) : 0)

  return (
    <div
      title="Total active time across this session"
      className="text-xs text-gray-100 bg-gray-800/40 px-3 py-1 rounded-full border border-gray-700/30 flex items-center gap-2"
    >
      <span className="opacity-70">Active</span>
      <span className="font-mono">{formatDuration(liveMs)}</span>
    </div>
  )
}

function Clock() {
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="text-sm text-gray-200 font-mono bg-gray-800/40 px-3 py-1 mr-2 rounded-full border border-gray-700/30">
      {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </div>
  )
}
