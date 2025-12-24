import React, { useState, useEffect } from 'react'

export default function GitHubAppInstallPrompt({ provider, onClose }: { provider?: string; onClose: () => void }) {
  const [setupUrl, setSetupUrl] = useState<string>('')

  useEffect(() => {
    // Fetch setup URL info
    fetch('/api?route=auth&action=github_app_setup_info', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setSetupUrl(data.setupUrl || '')
      })
      .catch(e => console.error('Failed to fetch setup info:', e))
  }, [])

  const installUrl = (import.meta as any).env?.VITE_GITHUB_APP_INSTALL_URL || 'https://github.com/apps/zynq-os/installations/new'

  return (
    <div className="p-6 text-[#e0e0e0] bg-[#1a1a1a] w-[520px] space-y-4">
      <div>
        <h2 className="text-xl font-semibold mb-2">Enable Decentralized Storage</h2>
        <p className="text-sm text-[#808080]">You're now signed in with {provider === 'github' ? 'GitHub' : 'Google'}. Let's set up decentralized storage for your data.</p>
      </div>

      <div className="bg-black/40 rounded p-3 space-y-2">
        <p className="text-gray-200 text-sm font-semibold">Setup GitHub App for Storage</p>
        <ol className="list-decimal list-inside text-gray-400 text-xs space-y-1">
          <li>Create a new private repo on GitHub for your ZynqOS data</li>
          <li>Click "Install GitHub App" below to authorize</li>
          <li>Select the repo during installation and authorize</li>
          <li>You'll be redirected back with your storage connected</li>
        </ol>
        <p className="text-gray-300 text-xs mt-2">
          All your files, settings, and audit logs will sync to your repo. Your data stays in your control—ZynqOS cannot access it without authorization.
        </p>
      </div>

      <div className="bg-black/20 border border-gray-700/30 rounded p-2 text-xs text-gray-400">
        <p className="font-mono text-gray-500">Setup URL: <span className="text-gray-400">{setupUrl || 'Loading...'}</span></p>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={onClose}
          className="flex-1 px-4 py-2 rounded bg-[#2a2a2a] hover:bg-[#333] text-white transition"
        >
          Maybe Later
        </button>
        <a
          href={installUrl}
          target="_blank"
          rel="noreferrer"
          className="flex-1 px-4 py-2 rounded bg-green-600/80 hover:bg-green-700/80 text-white text-center transition font-semibold"
        >
          Install GitHub App
        </a>
      </div>
    </div>
  )
}
