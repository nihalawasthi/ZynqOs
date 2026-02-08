import React, { useState, useEffect } from 'react'
import { clearStatusCache } from '../auth/storage'

export default function ConsentModal({ onClose }: { onClose?: () => void }) {
  const [provider, setProvider] = useState<'google' | 'github' | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [pollCount, setPollCount] = useState(0)
  const [envStatus, setEnvStatus] = useState<any>(null)

  const closeModal = () => {
    if (typeof onClose === 'function') {
      onClose()
      return
    }
    ;(window as any).ZynqOS_closeActiveWindow?.()
  }

  const notifyAuthReady = (status: any) => {
    window.dispatchEvent(new CustomEvent('zynqos:auth-initialized', { detail: status }))
    if (status?.connected) {
      window.dispatchEvent(new CustomEvent('zynqos:storage-connected', { detail: { provider: status.provider } }))
    }
  }

  useEffect(() => {
    // Check what credentials are available
    fetch('/api?route=auth&action=env_status', { credentials: 'include' })
      .then(res => res.json())
      .then(data => setEnvStatus(data))
      .catch(e => console.error('[ConsentModal] Failed to fetch env status', e))
  }, [])

  useEffect(() => {
    if (!waiting) return

    const checkAuth = async () => {
      try {
        const res = await fetch('/api?route=auth&action=status', { credentials: 'include' })
        const json = await res.json()
        if (json.connected || json.authenticated) {
          clearStatusCache()
          setWaiting(false)
          notifyAuthReady(json)
          closeModal()
        }
      } catch (e) {
        console.error('[ConsentModal] Poll failed', e)
      }
    }

    // Poll every 5 seconds
    const interval = setInterval(() => {
      setPollCount(prev => prev + 1)
      checkAuth()
    }, 5000)

    // Also listen for message from popup
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'zynqos-auth-complete') {
        setWaiting(false)
        fetch('/api?route=auth&action=status', { credentials: 'include' })
          .then(res => res.json())
          .then((json) => {
            clearStatusCache()
            notifyAuthReady(json)
          })
          .catch(() => undefined)
          .finally(() => closeModal())
      }
    }
    window.addEventListener('message', handleMessage)

    return () => {
      clearInterval(interval)
      window.removeEventListener('message', handleMessage)
    }
  }, [waiting, onClose])

  if (waiting) {
    return (
      <div className="p-6 text-[#e0e0e0] bg-[#1a1a1a] w-[520px]">
        <h2 className="text-xl font-semibold mb-2">Waiting for authentication...</h2>
        <div className="flex flex-col items-center justify-center py-8">
          <div className="w-16 h-16 border-4 border-[#4a9eff] border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-sm text-[#808080]">Please complete the authentication in the popup window.</p>
          <p className="text-xs text-[#606060] mt-2">Checking every 5 seconds...</p>
        </div>
        <button onClick={() => { setWaiting(false); closeModal() }} className="w-full px-4 py-2 rounded bg-[#2a2a2a] hover:bg-[#333] mt-4">Cancel</button>
      </div>
    )
  }

  return (
    <div className="p-6 text-[#e0e0e0] bg-[#1a1a1a] w-[520px]">
      <h2 className="text-xl font-semibold mb-2">Connect Storage</h2>
      <p className="text-sm text-[#808080] mb-4">ZynqOS will create and manage a dedicated storage namespace in your provider. We request the minimum scopes needed.</p>

      <div className="space-y-3">
        <button 
          onClick={() => setProvider('google')} 
          disabled={!envStatus?.google?.clientId}
          className={`w-full px-4 py-2 rounded-lg border ${
            provider==='google'?'border-[#4a9eff]':'border-[#333]'
          } bg-[#0d0d0d] hover:bg-[#2a2a2a] text-left disabled:opacity-50 disabled:cursor-not-allowed`}> 
          <span className="mr-2"><i className="fab fa-google"></i></span> 
          {envStatus?.google?.clientId ? 'Google Drive (drive.file)' : 'Google Drive - Coming Soon'}
        </button>
        <button onClick={() => setProvider('github')} className={`w-full px-4 py-2 rounded-lg border ${provider==='github'?'border-[#4a9eff]':'border-[#333]'} bg-[#0d0d0d] hover:bg-[#2a2a2a] text-left`}> 
          <span className="mr-2"><i className="fab fa-github"></i></span> GitHub (private repo)
        </button>
      </div>

      <div className="mt-4 text-xs text-[#808080]">
        <p>We will:</p>
        <ul className="list-disc ml-5">
          <li>Create a folder named ZynqOS in Drive or a private repo named zynqos</li>
          <li>Read/write files you create via ZynqOS only</li>
          <li>Sync local IndexedDB with your provider</li>
          <li>Let you disconnect anytime (optional cleanup)</li>
        </ul>
      </div>

      <div className="mt-4 flex gap-2">
        <button onClick={closeModal} className="px-4 py-2 rounded bg-[#2a2a2a] hover:bg-[#333]">Cancel</button>
        <button onClick={() => {
          if (provider === 'google') {
            if (!envStatus?.google?.clientId) {
              return
            }
            setWaiting(true)
            ;(window as any).ZynqOS_startGoogleAuth?.()
          } else if (provider === 'github') {
            setWaiting(true)
            ;(window as any).ZynqOS_startGitHubAuth?.()
          }
        }} disabled={!provider || (provider === 'google' && !envStatus?.google?.clientId)} className="px-4 py-2 rounded bg-[#4a9eff] hover:bg-[#3a8eef] text-black font-medium disabled:opacity-50 disabled:cursor-not-allowed">Continue</button>
      </div>
    </div>
  )
}
