import React from 'react';
import WindowManager from './components/WindowManager';
import Taskbar from './components/Taskbar';
import { useTheme } from './hooks/useTheme';

export default function App() {
  // Initialize the theme the moment the OS boots!
  useTheme();

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      {/* Subtle grid pattern overlay */}
      <div className="absolute inset-0 bg-grid-pattern opacity-5 pointer-events-none"></div>
      
      <WindowManager />
      <Taskbar />
    </div>
  );
}