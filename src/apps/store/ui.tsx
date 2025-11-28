import React, { useEffect, useState } from 'react'

type AppManifest = {
  id: string
  name: string
  description: string
  icon?: string
  version?: string
  author?: string
  releaseUrl?: string
  tags?: string[]
  size?: string
}

const STORAGE_KEY = 'zynqos_installed_apps'

function readInstalled(): Record<string, AppManifest> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch (e) {
    return {}
  }
}

function writeInstalled(map: Record<string, AppManifest>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

export default function StoreUI() {
  const [apps, setApps] = useState<AppManifest[]>([])
  const [installed, setInstalled] = useState<Record<string, AppManifest>>(() => readInstalled())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch('/apps/store-manifest.json')
      .then((r) => r.json())
      .then((list: AppManifest[]) => setApps(list))
      .catch((err) => console.error('Failed fetching manifest', err))
      .finally(() => setLoading(false))
  }, [])

  function install(app: AppManifest) {
    // Store minimal metadata locally. In a real implementation, you'd
    // download the artifact (wasm/docker image) and store it in IndexedDB
    // or use a registry. Here we persist metadata so the app appears installed.
    const current = readInstalled()
    current[app.id] = app
    writeInstalled(current)
    setInstalled({ ...current })
  }

  function uninstall(id: string) {
    const current = readInstalled()
    delete current[id]
    writeInstalled(current)
    setInstalled({ ...current })
  }

  function open(id: string) {
    // Example: try to open using global window API if available
    const app = installed[id]
    if (!app) return
    ;(window as any).ZynqOS_openWindow?.(app.name, <div>Launching {app.name}…</div>)
  }

  return (
    <div className="p-4">
      <h2 className="text-xl font-semibold mb-3">App Store</h2>
      {loading && <div className="text-sm text-gray-400">Loading apps…</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {apps.map((a) => {
          const isInstalled = !!installed[a.id]
          return (
            <div key={a.id} className="p-3 bg-gray-800/40 rounded-md border border-gray-700/30">
              <div className="flex items-start gap-3">
                <div className="text-2xl">{a.icon ?? '📦'}</div>
                <div className="flex-1">
                  <div className="font-semibold">{a.name}</div>
                  <div className="text-xs text-gray-300">{a.description}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="text-xs text-gray-400">{a.version ?? '—'}</div>
                    <div className="text-xs text-gray-400">{a.size ?? ''}</div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {!isInstalled ? (
                    <button
                      className="px-2 py-1 bg-green-600/80 rounded text-sm hover:brightness-110"
                      onClick={() => install(a)}
                    >
                      Install
                    </button>
                  ) : (
                    <div className="flex flex-col items-end gap-2">
                      <button className="px-2 py-1 bg-blue-600/80 rounded text-sm" onClick={() => open(a.id)}>
                        Open
                      </button>
                      <button className="px-2 py-1 bg-red-700/70 rounded text-sm" onClick={() => uninstall(a.id)}>
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-6">
        <h3 className="font-semibold">Installed</h3>
        <div className="mt-2">{Object.keys(installed).length === 0 ? <div className="text-sm text-gray-400">No apps installed.</div> : null}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.values(installed).map((a) => (
            <div key={a.id} className="px-2 py-1 bg-gray-800/30 rounded text-sm flex items-center gap-2">
              <span>{a.icon}</span>
              <span>{a.name}</span>
              <button className="ml-2 text-xs text-blue-300 underline" onClick={() => open(a.id)}>
                Open
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
window.__STORE_UI__ = StoreUI