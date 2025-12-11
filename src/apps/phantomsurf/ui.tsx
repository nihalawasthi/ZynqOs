import React, { useRef, useState } from 'react'
import clsx from "clsx";

export default function PhantomSurf() {
  const [showBrowser, setShowBrowser] = useState(false)
  const [url, setUrl] = useState('')
  const [input, setInput] = useState('')
  const [vpnEnabled, setVpnEnabled] = useState(false)
  const [torEnabled, setTorEnabled] = useState(false)
  const [vpn, setVpn] = useState(false)
  const [tor, setTor] = useState(false)
  const [iframeError, setIframeError] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const iframeRef = useRef(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    let finalUrl = ''
    if (input.startsWith('http://') || input.startsWith('https://')) {
      finalUrl = input
    } else {
      finalUrl = `https://google.com/search?q=${encodeURIComponent(input)}`
    }
    
    // Use our proxy endpoint to bypass CORS
    const proxiedUrl = `/api?route=proxy&url=${encodeURIComponent(finalUrl)}`
    setIsLoading(true)
    setUrl(proxiedUrl)
    setShowBrowser(true)
  }

  const handleQuickLink = (urlLink: string) => {
    // Use our proxy endpoint to bypass CORS
    const proxiedUrl = `/api?route=proxy&url=${encodeURIComponent(urlLink)}`
    setIsLoading(true)
    setUrl(proxiedUrl)
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

  interface ToggleButtonProps {
    label: string;
    active: boolean;
    onToggle: () => void;
  }

  const ToggleButton: React.FC<ToggleButtonProps> = ({ label, active, onToggle }) => {
    return (
      <button
        onClick={onToggle}
        className={clsx(
          "relative flex flex-col items-center justify-between",
          "w-[70px] h-[40px] rounded-[4px] px-[6px] py-[8px]",
          "bg-[#2a2a2a] border-t border-[#383838]",
          "transition-all duration-100 ease-linear",
          active &&
          "mt-[6px] rounded-b-[4px] border-green-400 border-2 shadow-[inset_0_-20px_15px_0_rgba(0,0,0,0.5)]"
        )}
        style={{
          transform: active
            ? "perspective(200px)"
            : "perspective(200px)",
          transformOrigin: "50% 40%",
        }}
      >
  {/* Top-right circle */}
  <div
    className={clsx(
      "absolute top-[4px] right-[4px] w-[6px] h-[6px] rounded-full",
      "transition-all duration-150",
      active
        ? "bg-green-400 shadow-[0_0_6px_rgba(37,138,195,0.8)]"
        : "bg-white/20"
    )}
  />
        {/* Title text */}
        <span
          className={clsx(
            "font-extrabold uppercase text-[15px]",
            "transition-all duration-100 ease-linear",
            active
              ? "text-green-400/50 drop-shadow-[0_0_8px_rgb(37,138,195),1px_1px_2px_black]"
              : "text-white/40"
          )}
        >
          {label}
        </span>
      </button>
    );
  };

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

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 8 }}>
            <div className="flex items-center gap-[6px] bg-black p-[6px] rounded-[8px] h-[40px] overflow-hidden scale-75 origin-right">
              <ToggleButton label="VPN" active={vpn} onToggle={() => setVpn(!vpn)} />
              <ToggleButton label="TOR" active={tor} onToggle={() => setTor(!tor)} />
            </div>
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
          {isLoading && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.6)',
              zIndex: 1000,
              backdropFilter: 'blur(4px)'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 50,
                  height: 50,
                  margin: '0 auto 16px',
                  border: '4px solid rgba(255,255,255,0.2)',
                  borderTop: '4px solid #667eea',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }} />
                <p style={{ color: '#aaa', margin: 0, fontSize: 14 }}>Loading...</p>
              </div>
            </div>
          )}
          {iframeError ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 20,
              padding: 40,
              textAlign: 'center',
              background: '#1a1a1a'
            }}>
              <h2 style={{ color: '#fff', fontSize: 24, margin: 0 }}>⚠️ Website Blocked</h2>
              <p style={{ color: '#aaa', margin: 0, maxWidth: 400 }}>
                This website doesn't allow being embedded in iframes for security reasons. You can still open it in a new window.
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={() => window.open(url, '_blank')}
                  style={{
                    padding: '10px 24px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: '#fff',
                    cursor: 'pointer',
                    fontWeight: 500
                  }}
                >
                  Open in New Window
                </button>
                <button
                  onClick={() => {
                    setShowBrowser(false)
                    setIframeError(false)
                  }}
                  style={{
                    padding: '10px 24px',
                    borderRadius: 6,
                    border: '1px solid #444',
                    background: '#222',
                    color: '#aaa',
                    cursor: 'pointer'
                  }}
                >
                  Go Back
                </button>
              </div>
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              src={url}
              title="PhantomSurf Browser"
              style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
              onError={() => setIframeError(true)}
              onLoad={() => setIsLoading(false)}
              onLoadStart={() => setIsLoading(true)}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#000000',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* VPN/Tor Status in Header */}
      <div className='scale-[0.8]' style={{
        position: 'absolute',
        top: 10,
        right: 5,
        display: 'flex',
        gap: 12,
        zIndex: 10
      }}>

        <div className="flex items-center gap-[6px] bg-black p-[6px] rounded-[8px] h-[54px] overflow-hidden">
          <ToggleButton label="VPN" active={vpn} onToggle={() => setVpn(!vpn)} />
          <ToggleButton label="TOR" active={tor} onToggle={() => setTor(!tor)} />
        </div>
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


        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 40, width: '100%' }}>
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
          <div style={{ width: '100%', maxWidth: 600, padding: '0 20px' }}>
            <div
              className='transition focus-within:ring-2 focus-within:ring-green-500'
              style={{
                display: 'flex',
                alignItems: 'center',
                background: '#222',
                borderRadius: 50,
                border: '1px solid rgba(255,255,255,0.1)',
                gap: 12,
                marginBottom: 24
              }}>
              <input type="text" placeholder="Surf Like A Phantom"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch(e as any)}
                style={{
                  flex: 1,
                  padding: '12px 20px',
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  outline: 'none',
                  fontSize: 14
                }}
              />
              <div style={{
                width: 36,
                height: 36,
                marginRight: '7px',
                backgroundImage: "url('/assets/PS.png')",
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                borderRadius: '50%',
                cursor: 'pointer'
              }}></div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 20 }}>
              <QuickButton
                icon={<i className="fa-solid fa-envelope" />}
                label="Gmail"
                onClick={() => handleQuickLink('https://mail.google.com')}
              />
              <QuickButton
                icon={<i className="fa-solid fa-image" />}
                label="Images"
                onClick={() => handleQuickLink('https://images.google.com')}
              />
              <QuickButton
                icon={<i className="fa-solid fa-file" />}
                label="Load HTML"
                onClick={() => fileInputRef.current?.click()}
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

function QuickButton({ icon, label, onClick }: { icon: string | React.ReactNode; label: string; onClick: () => void }) {
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


; (window as any).__PHANTOMSURF_UI__ = PhantomSurf