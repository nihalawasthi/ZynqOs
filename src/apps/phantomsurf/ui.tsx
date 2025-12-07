import React, { useRef, useState } from 'react'

export default function PhantomSurf() {
  const [showBrowser, setShowBrowser] = useState(false)
  const [url, setUrl] = useState('')
  const [input, setInput] = useState('')
  const [vpnEnabled, setVpnEnabled] = useState(false)
  const [torEnabled, setTorEnabled] = useState(false)
  const iframeRef = useRef(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    
    if (input.startsWith('http://') || input.startsWith('https://')) {
      setUrl(input)
    } else {
      setUrl(`https://www.google.com/search?q=${encodeURIComponent(input)}`)
    }
    setShowBrowser(true)
  }

  const handleQuickLink = (urlLink: string) => {
    setUrl(urlLink)
    setInput(urlLink)
    setShowBrowser(true)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const html = ev.target.result as string
        const blob = new Blob([html], { type: 'text/html' })
        setUrl(URL.createObjectURL(blob))
        setShowBrowser(true)
      }
      reader.readAsText(file)
    }
  }

  const handleBack = () => {
    setShowBrowser(false)
    setInput('')
  }

  if (showBrowser) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1a1a1a' }}>
        {/* Browser Navigation Bar */}
        <div style={{ 
          padding: '8px 12px', 
          background: '#0a0a0a', 
          borderBottom: '1px solid #333',
          display: 'flex', 
          alignItems: 'center', 
          gap: 8 
        }}>
          <button 
            onClick={handleBack}
            style={{ 
              padding: '6px 12px', 
              borderRadius: 6, 
              border: '1px solid #444', 
              background: '#222', 
              color: '#aaa',
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            ← Back
          </button>
          <form onSubmit={handleSearch} style={{ flex: 1, display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Enter URL or search..."
              style={{ 
                flex: 1, 
                padding: '8px 16px', 
                borderRadius: 20, 
                border: '1px solid #444', 
                background: '#222',
                color: '#fff',
                outline: 'none'
              }}
            />
            <button 
              type="submit" 
              style={{ 
                padding: '8px 20px', 
                borderRadius: 20, 
                border: 'none', 
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              Go
            </button>
          </form>
          
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginLeft: 8 }}>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 6, 
              cursor: 'pointer',
              fontSize: 13,
              color: vpnEnabled ? '#4ade80' : '#888'
            }}>
              <input 
                type="checkbox" 
                checked={vpnEnabled} 
                onChange={e => setVpnEnabled(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>🔒 VPN</span>
            </label>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 6, 
              cursor: 'pointer',
              fontSize: 13,
              color: torEnabled ? '#a78bfa' : '#888'
            }}>
              <input 
                type="checkbox" 
                checked={torEnabled} 
                onChange={e => setTorEnabled(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>🧅 Tor</span>
            </label>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #444',
                background: '#222',
                color: '#aaa',
                cursor: 'pointer',
                fontSize: 13
              }}
            >
              📁 HTML
            </button>
            <input 
              ref={fileInputRef}
              type="file" 
              accept=".html,.htm" 
              onChange={handleFileChange} 
              style={{ display: 'none' }} 
            />
          </div>
        </div>

        {/* Browser Content */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <iframe
            ref={iframeRef}
            src={url}
            title="PhantomSurf Browser"
            style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      </div>
    )
  }

  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* VPN/Tor Status in Header */}
      <div style={{ 
        position: 'absolute', 
        top: 20, 
        right: 20, 
        display: 'flex', 
        gap: 12,
        zIndex: 10
      }}>
        <label style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 6, 
          cursor: 'pointer',
          padding: '8px 12px',
          borderRadius: 20,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          fontSize: 13,
          color: vpnEnabled ? '#4ade80' : '#888',
          transition: 'all 0.3s'
        }}>
          <input 
            type="checkbox" 
            checked={vpnEnabled} 
            onChange={e => setVpnEnabled(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <span>🔒 VPN</span>
        </label>
        <label style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 6, 
          cursor: 'pointer',
          padding: '8px 12px',
          borderRadius: 20,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          fontSize: 13,
          color: torEnabled ? '#a78bfa' : '#888',
          transition: 'all 0.3s'
        }}>
          <input 
            type="checkbox" 
            checked={torEnabled} 
            onChange={e => setTorEnabled(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <span>🧅 Tor</span>
        </label>
      </div>

      {/* Main Content */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center',
        padding: 20,
        gap: 60
      }}>
        {/* Logo/Title */}
        <h1 style={{ 
          fontSize: 48, 
          fontWeight: 700, 
          color: '#fff',
          margin: 0,
          textAlign: 'center',
          letterSpacing: 1
        }}>
          PhantomSurf
        </h1>

        {/* Search Box */}
        <div style={{ width: '100%', maxWidth: 600 }}>
          <form onSubmit={handleSearch} style={{ position: 'relative' }}>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Surf Like A Phantom"
              autoFocus
              style={{ 
                width: '100%',
                padding: '18px 60px 18px 24px', 
                borderRadius: 50, 
                border: '1px solid rgba(255,255,255,0.1)', 
                background: 'rgba(255,255,255,0.05)',
                color: '#fff',
                fontSize: 16,
                outline: 'none',
                backdropFilter: 'blur(10px)',
                transition: 'all 0.3s',
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
              }}
              onFocus={(e) => {
                e.target.style.background = 'rgba(255,255,255,0.08)'
                e.target.style.borderColor = 'rgba(102,126,234,0.5)'
              }}
              onBlur={(e) => {
                e.target.style.background = 'rgba(255,255,255,0.05)'
                e.target.style.borderColor = 'rgba(255,255,255,0.1)'
              }}
            />
            <button 
              type="submit"
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 42,
                height: 42,
                borderRadius: '50%',
                border: 'none',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                transition: 'transform 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-50%) scale(1.05)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(-50%) scale(1)'}
            >
              🔍
            </button>
          </form>
        </div>

        {/* Quick Access Buttons */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
          <QuickButton 
            icon="📧" 
            label="Gmail" 
            onClick={() => handleQuickLink('https://mail.google.com')}
          />
          <QuickButton 
            icon="🖼️" 
            label="Images" 
            onClick={() => handleQuickLink('https://images.google.com')}
          />
          <QuickButton 
            icon="🔧" 
            label="Tools" 
            onClick={() => fileInputRef.current?.click()}
          />
          <QuickButton 
            icon="📱" 
            label="Apps" 
            onClick={() => handleQuickLink('https://www.google.com/intl/en/about/products')}
          />
          <input 
            ref={fileInputRef}
            type="file" 
            accept=".html,.htm" 
            onChange={handleFileChange} 
            style={{ display: 'none' }} 
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{ 
        padding: '16px 24px', 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        fontSize: 12,
        color: '#666'
      }}>
        <span>© 2025 PhantomSurf. All rights reserved.</span>
        <div style={{ display: 'flex', gap: 20 }}>
          <a href="#" style={{ color: '#888', textDecoration: 'none' }}>Terms</a>
          <a href="#" style={{ color: '#888', textDecoration: 'none' }}>Privacy</a>
          <a href="#" style={{ color: '#888', textDecoration: 'none' }}>Contact</a>
        </div>
      </div>
    </div>
  )
}

function QuickButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 20px',
        borderRadius: 25,
        border: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(255,255,255,0.05)',
        color: '#aaa',
        cursor: 'pointer',
        fontSize: 14,
        transition: 'all 0.3s',
        backdropFilter: 'blur(10px)'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
        e.currentTarget.style.borderColor = 'rgba(102,126,234,0.3)'
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}


;(window as any).__PHANTOMSURF_UI__ = PhantomSurf