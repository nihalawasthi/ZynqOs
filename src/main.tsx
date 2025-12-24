import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { initializeVFS } from './vfs/init'
import LoadingOverlay from './components/LoadingOverlay'
import { getPyodide } from './wasm/pyodideLoader'
import { preloadWasmerPackages } from './wasm/wasmerBash'
import { Toaster } from './components/ui/toaster'
import { toast } from './hooks/use-toast'

// Global polyfills for WASI/browser compatibility
import { Buffer } from 'buffer'
;(window as any).Buffer = Buffer

// Import apps to register them globally
import './apps/terminal/ui'
import './apps/text-editor/ui'
import './apps/file-browser/ui'
import './apps/mapp-importer/ui'
import './apps/runner/ui'
import './apps/store/ui'
import './apps/wednesday/ui'
import './apps/python/ui'
import './apps/phantomsurf/ui'
import './apps/settings/ui'

// Auth helpers and redirect bootstrap
import { bootstrapAuthRedirect } from './auth/init'
import { getStorageStatus } from './auth/storage'

// Apply saved wallpaper on load
function applySavedWallpaper() {
  const savedWallpaper = localStorage.getItem('zynqos_wallpaper_source')
  const savedSize = localStorage.getItem('zynqos_background_size')
  
  if (savedWallpaper || savedSize) {
    // Wait for root to be available
    setTimeout(() => {
      const root = document.querySelector('.h-screen')
      if (root && root instanceof HTMLElement) {
        if (savedWallpaper) {
          root.style.backgroundImage = `url('${savedWallpaper}')`
        }
        if (savedSize) {
          root.style.backgroundSize = savedSize
        }
        root.style.backgroundRepeat = 'no-repeat'
        root.style.backgroundPosition = 'center'
      }
    }, 100)
  }
}

const MIN_LOADER_MS = 5000

async function bootstrap(report: (msg: string) => void) {
  report('Booting ZynqOS core')
  await initializeVFS()

  report('Syncing auth and session')
  await bootstrapAuthRedirect()

  report('Preloading Python (Pyodide)')
  await getPyodide()

  report('Preloading terminal runtime (Wasmer + bash/coreutils)')
  await preloadWasmerPackages((m) => report(m))

  report('Finalizing session startup')
}

function Root() {
  const [ready, setReady] = React.useState(false)
  const [error, setError] = React.useState<Error | null>(null)
  const [statusMessages, setStatusMessages] = React.useState<string[]>(['Booting ZynqOS core'])

  React.useEffect(() => {
    const { dismiss } = toast({
      title: 'Development build notice',
      description: 'ZynqOS is still in Development Phase and could have many bugs. Please use cautiously.',
      variant: 'warning',
      hideClose: true,
      action: (
        <button
          onClick={() => dismiss()}
          className="px-3 py-1 text-xs font-medium bg-yellow-500/20 text-yellow-100 rounded-lg border border-yellow-500/40 hover:bg-yellow-500/30 transition"
        >
          I understand
        </button>
      ),
    })

    return () => dismiss()
  }, [])

  React.useEffect(() => {
    let cancelled = false
    const startedAt = performance.now()
    const report = (msg: string) => {
      setStatusMessages((prev) => (prev[prev.length - 1] === msg ? prev : [...prev, msg]))
    }

    bootstrap(report)
      .then(() => {
        const elapsed = performance.now() - startedAt
        const remaining = Math.max(MIN_LOADER_MS - elapsed, 0)
        setTimeout(() => {
          if (!cancelled) {
            setReady(true)
          }
        }, remaining)
      })
      .catch((err) => {
        console.error('Bootstrap error', err)
        const elapsed = performance.now() - startedAt
        const remaining = Math.max(MIN_LOADER_MS - elapsed, 0)
        setTimeout(() => {
          if (!cancelled) {
            setError(err as Error)
            setReady(true)
          }
        }, remaining)
      })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    if (ready) {
      applySavedWallpaper()
      // Initialize auth status cache after app is ready (force fresh fetch, not cached)
      getStorageStatus(true).then(status => {
        // Dispatch event so UI components update with fresh data
        window.dispatchEvent(new CustomEvent('zynqos:auth-initialized', { detail: status }))
      }).catch(err => console.error('Failed to initialize auth status', err))
    }
  }, [ready])

  if (!ready) {
    return (
      <>
        <div className="h-screen w-screen bg-black">
          <LoadingOverlay messages={statusMessages} />
        </div>
        <Toaster />
      </>
    )
  }

  return (
    <>
      <React.StrictMode>
        <App />
        {error && <div className="sr-only">Bootstrap error: {error.message}</div>}
      </React.StrictMode>
      <Toaster />
    </>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<Root />)
