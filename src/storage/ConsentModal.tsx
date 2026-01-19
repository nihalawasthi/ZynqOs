import React, { useState, useEffect } from 'react'

export default function ConsentModal({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState<'google' | 'github' | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [pollCount, setPollCount] = useState(0)

  useEffect(() => {
    if (!waiting) return

    const checkAuth = async () => {
      try {
        const res = await fetch('/api?route=auth&action=status', { credentials: 'include' })
        const json = await res.json()
        if (json.connected || json.authenticated) {
          setWaiting(false)
          onClose()
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
        onClose()
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
        <button onClick={() => { setWaiting(false); onClose() }} className="w-full px-4 py-2 rounded bg-[#2a2a2a] hover:bg-[#333] mt-4">Cancel</button>
      </div>
    )
  }

  return (
    <div className="p-6 text-[#e0e0e0] bg-[#1a1a1a] w-[520px]">
      <h2 className="text-xl font-semibold mb-2">Connect Storage</h2>
      <p className="text-sm text-[#808080] mb-4">ZynqOS will create and manage a dedicated storage namespace in your provider. We request the minimum scopes needed.</p>

      <div className="space-y-3">
        <button onClick={() => setProvider('google')} className={`w-full px-4 py-2 rounded-lg border ${provider==='google'?'border-[#4a9eff]':'border-[#333]'} bg-[#0d0d0d] hover:bg-[#2a2a2a] text-left`}> 
          <span className="mr-2"><i className="fab fa-google"></i></span> Google Drive (drive.file)
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
        <button onClick={onClose} className="px-4 py-2 rounded bg-[#2a2a2a] hover:bg-[#333]">Cancel</button>
        <button onClick={() => {
          if (provider === 'google') {
            setWaiting(true)
            ;(window as any).ZynqOS_startGoogleAuth?.()
          } else if (provider === 'github') {
            setWaiting(true)
            ;(window as any).ZynqOS_startGitHubAuth?.()
          }
        }} disabled={!provider} className="px-4 py-2 rounded bg-[#4a9eff] hover:bg-[#3a8eef] text-black font-medium disabled:opacity-50 disabled:cursor-not-allowed">Continue</button>
      </div>
    </div>
  )
}
