import React from 'react'
import WindowManager from './components/WindowManager'
import Taskbar from './components/Taskbar'
import MultiWindowIndicator from './components/MultiWindowIndicator'
import RemoteCursors from './components/RemoteCursors'

export default function App() {
  return (
    <div className="h-screen bg-[url(/assets/wallpaper.png)] bg-[length:60%_60%] bg-no-repeat bg-center bg-black text-slate-100 flex flex-col overflow-hidden relative">
      {/* Subtle grid pattern overlay */}
      <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
      <MultiWindowIndicator />
      <RemoteCursors />
      <WindowManager />
      <Taskbar />
    </div>
  )
}
