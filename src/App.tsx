import React from 'react'
import WindowManager from './components/WindowManager'
import Taskbar from './components/Taskbar'
import Launcher from './components/Launcher'

export default function App() {
  return (
    <div className="h-screen bg-slate-900 text-slate-100">
      <div className="p-4">
        <h1 className="text-2xl font-semibold">MicroOS — MVP</h1>
      </div>

      <WindowManager />
      <Taskbar />
      <Launcher />
    </div>
  )
}
