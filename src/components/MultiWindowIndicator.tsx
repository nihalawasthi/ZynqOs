import React, { useState } from 'react';
import { useCrossWindow } from '../hooks/useCrossWindow';

/**
 * Visual indicator showing when multiple browser windows are running
 * Displays window count (displays) and allows selecting which display to view
 */
export default function MultiWindowIndicator() {
    const { windows, currentWindow } = useCrossWindow(true);
    const [showDisplayList, setShowDisplayList] = useState(false);

    const displayCount = windows.length;
    const hasMultiple = displayCount > 1;

    if (displayCount === 0) return null;

    return (
        <div className="relative flex items-center gap-2">
            {/* Display count badge with dropdown */}
            <div 
                className="relative"
                onMouseEnter={() => setShowDisplayList(true)}
                onMouseLeave={() => setShowDisplayList(false)}
            >
                <button
                    onClick={() => setShowDisplayList(!showDisplayList)}
                    className="bg-black text-white px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-2 backdrop-blur-sm hover:bg-gray-800 transition-colors cursor-pointer"
                    title={`${displayCount} active display${displayCount !== 1 ? 's' : ''}`}
                >
                    <i className="fa-slab-press fa-regular fa-copy"></i>
                    <span className="text-sm font-medium">{displayCount}</span>
                    {hasMultiple && (
                        <i className={`fa fa-chevron-${showDisplayList ? 'up' : 'down'} text-xs transition-transform`}></i>
                    )}
                </button>

                {/* Display list dropdown */}
                {showDisplayList && hasMultiple && (
                    <div className="absolute bottom-full right-0 mb-2 bg-gray-900/95 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-xl overflow-hidden w-56">
                        <div className="p-2 text-xs text-gray-400 font-semibold px-3 py-2 border-b border-gray-700/30">
                            Active Displays
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                            {windows.map((win, idx) => {
                                const isCurrentDisplay = win.id === currentWindow?.id;
                                return (
                                    <button
                                        key={win.id}
                                        onClick={() => {
                                            // Could potentially focus the window here if needed
                                            setShowDisplayList(false);
                                        }}
                                        className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2
                                            ${isCurrentDisplay 
                                                ? 'bg-blue-600/40 text-blue-200 border-l-2 border-blue-500' 
                                                : 'text-gray-300 hover:bg-gray-800/60 border-l-2 border-transparent'
                                            }`}
                                    >
                                        <span className="flex-1 truncate">
                                            Display {win.id}
                                        </span>
                                        <span className="text-gray-500 text-[10px] whitespace-nowrap">
                                            {win.shape.w}×{win.shape.h}
                                        </span>
                                        {isCurrentDisplay && (
                                            <i className="fa fa-check text-blue-400"></i>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="text-xs text-gray-500 px-3 py-2 border-t border-gray-700/30 text-center">
                            Drag window to bottom to transfer between displays
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
