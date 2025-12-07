import React from 'react';
import { useCrossWindow } from '../hooks/useCrossWindow';

/**
 * Visual indicator showing when multiple browser windows are running
 * Displays window count and allows opening new windows
 */
export default function MultiWindowIndicator() {
    const { windows, currentWindow, hasMultipleWindows, openNewWindow } = useCrossWindow(true);

    if (!hasMultipleWindows) {
        return null;
    }

    return (
        <div className="fixed bottom-2 right-2 z-[9999] flex items-center gap-2">
            {/* Window count badge */}
            <div className="bg-black text-white px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-2 backdrop-blur-sm">
                <i className="fa-slab-press fa-regular fa-copy"></i>
                <span className="text-sm font-medium">{windows.length}</span>
            </div>

            {/* New window button */}
            {/* <button
        onClick={() => openNewWindow()}
        className="bg-green-500/90 hover:bg-green-600/90 text-white px-3 py-1.5 rounded-lg shadow-lg backdrop-blur-sm transition-colors"
        title="Open new window"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
      </button> */}
        </div>
    );
}
