import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { initializeVFS } from './vfs/init'

// Global polyfills for WASI/browser compatibility
import { Buffer } from 'buffer'
;(window as any).Buffer = Buffer

// Import apps to register them globally
import './apps/calculator/ui'
import './apps/terminal/ui'
import './apps/text-editor/ui'
import './apps/file-browser/ui'
import './apps/mapp-importer/ui'
import './apps/store/ui'
import './apps/wednesday/ui'
import './apps/python/ui'
import './apps/phantomsurf/ui'
// Initialize VFS with sample files
initializeVFS().catch(console.error)

// Auth helpers and redirect bootstrap
import { bootstrapAuthRedirect } from './auth/init'
bootstrapAuthRedirect().catch(console.error)

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
