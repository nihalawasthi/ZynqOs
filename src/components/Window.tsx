import React from 'react'

export default function Window({
  title,
  children,
  onClose
}: {
  title: string
  children: React.ReactNode
  onClose?: () => void
}) {
  return (
    <div className="absolute top-16 left-16 w-96 bg-white rounded-lg shadow-lg text-black p-0">
      <div className="flex justify-between items-center p-2 bg-gray-100 rounded-t">
        <div className="font-medium">{title}</div>
        <div className="flex gap-2">
          <button onClick={onClose} className="text-xs px-2 py-1 bg-red-500 text-white rounded">Close</button>
        </div>
      </div>
      <div className="p-2">{children}</div>
    </div>
  )
}
