import React, { useEffect, useRef, useState } from 'react'
import { toast } from '../../hooks/use-toast'
import { writeFile } from '../../vfs/fs'

const STORAGE_KEY_SOURCE = 'zynqos_wallpaper_source'
const STORAGE_KEY_SIZE = 'zynqos_background_size'

function applyWallpaperToRoot(source: string, size: string) {
  const root = document.querySelector('.h-screen')
  if (root && root instanceof HTMLElement) {
    root.style.backgroundImage = `url('${source}')`
    root.style.backgroundSize = size
    root.style.backgroundRepeat = 'no-repeat'
    root.style.backgroundPosition = 'center'
  }
}

function persistWallpaper(source: string, size: string) {
  localStorage.setItem(STORAGE_KEY_SOURCE, source)
  localStorage.setItem(STORAGE_KEY_SIZE, size)
}

export default function WallpaperChanger() {
  const [source, setSource] = useState('')
  const [size, setSize] = useState('cover')
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setSource(localStorage.getItem(STORAGE_KEY_SOURCE) || '/assets/wallpaper.png')
    setSize(localStorage.getItem(STORAGE_KEY_SIZE) || 'cover')
  }, [])

  const apply = (s: string, sz: string) => {
    setSource(s)
    setSize(sz)
    applyWallpaperToRoot(s, sz)
    persistWallpaper(s, sz)
  }

  const handleUrl = () => {
    const val = source.trim()
    if (!val) {
      toast({ title: 'Error', description: 'Enter a wallpaper URL', variant: 'destructive' })
      return
    }
    try {
      new URL(val)
      apply(val, size)
      toast({ title: 'Wallpaper updated', variant: 'success' })
    } catch {
      toast({ title: 'Error', description: 'Invalid URL', variant: 'destructive' })
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    try {
      const reader = new FileReader()
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string
        apply(dataUrl, size)
        setLoading(false)
        toast({ title: 'Wallpaper updated from file', variant: 'success' })
      }
      reader.readAsDataURL(file)
    } catch {
      setLoading(false)
      toast({ title: 'Upload failed', description: 'Could not read the image file', variant: 'destructive' })
    }
  }

  const handleReset = () => {
    apply('/assets/wallpaper.png', '60%')
    toast({ title: 'Wallpaper reset to default', variant: 'success' })
  }

  return (
    <div className="h-full bg-[#111] text-gray-200 flex flex-col p-6 overflow-y-auto">
      <div className="max-w-lg w-full mx-auto space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <i className="fas fa-image text-2xl text-blue-400"></i>
          <h1 className="text-xl font-bold text-white">Wallpaper Changer</h1>
        </div>

        {/* Preview */}
        <div className="rounded-xl overflow-hidden border border-gray-700 bg-black aspect-video flex items-center justify-center">
          {source ? (
            <img
              src={source}
              alt="wallpaper preview"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = '/assets/wallpaper.png'
              }}
            />
          ) : (
            <span className="text-gray-500 text-sm">No wallpaper selected</span>
          )}
        </div>

        {/* URL Input */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block font-medium">Image URL</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUrl()}
              placeholder="https://example.com/wallpaper.jpg"
              className="flex-1 bg-gray-900 text-gray-200 px-3 py-2.5 rounded-lg text-sm border border-gray-700 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={handleUrl}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition whitespace-nowrap"
            >
              Apply
            </button>
          </div>
        </div>

        {/* File Upload */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block font-medium">Upload Image</label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleUpload}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            className="w-full px-4 py-2.5 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800/50 disabled:text-gray-500 text-gray-200 text-sm rounded-lg border border-gray-700 transition flex items-center justify-center gap-2"
          >
            <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-upload'}`}></i>
            {loading ? 'Loading...' : 'Choose an image file'}
          </button>
        </div>

        {/* Size Selector */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block font-medium">Fit</label>
          <select
            value={size}
            onChange={(e) => apply(source, e.target.value)}
            className="w-full bg-gray-900 text-gray-200 px-3 py-2.5 rounded-lg text-sm border border-gray-700 focus:border-blue-500 focus:outline-none cursor-pointer"
          >
            <option value="cover">Cover</option>
            <option value="contain">Contain</option>
            <option value="100% 100%">Stretch (Full)</option>
            <option value="60%">Center (60%)</option>
            <option value="repeat">Tile</option>
          </select>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={handleReset}
            className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg border border-gray-700 transition"
          >
            <i className="fas fa-redo mr-2"></i>
            Reset Default
          </button>
        </div>

        <p className="text-xs text-gray-500 text-center pt-2">
          <i className="fas fa-info-circle mr-1"></i>
          Changes are saved automatically. Supported: JPG, PNG, GIF, WebP.
        </p>
      </div>
    </div>
  )
}

;(window as any).__WALLPAPER_CHANGER_UI__ = WallpaperChanger
