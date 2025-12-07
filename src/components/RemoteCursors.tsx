import React, { useEffect, useState } from 'react';
import CrossWindowCursor, { RemoteCursor } from '../utils/CrossWindowCursor';
import { useCrossWindow } from '../hooks/useCrossWindow';

/**
 * RemoteCursors - Displays cursors from other browser windows
 * Shows where cursors are in other windows, like a multi-monitor setup
 */
export default function RemoteCursors() {
  const { currentWindow, hasMultipleWindows } = useCrossWindow(true);
  const [cursors, setCursors] = useState<RemoteCursor[]>([]);
  const [cursorManager, setCursorManager] = useState<CrossWindowCursor | null>(null);

  useEffect(() => {
    if (!currentWindow || !hasMultipleWindows) return;

    const manager = new CrossWindowCursor(currentWindow.id);
    manager.onCursorUpdate((remoteCursors) => {
      setCursors(remoteCursors);
    });

    setCursorManager(manager);

    return () => {
      manager.destroy();
    };
  }, [currentWindow?.id, hasMultipleWindows]);

  if (!hasMultipleWindows || !cursorManager) {
    return null;
  }

  return (
    <>
      {cursors.map((cursor) => {
        const position = cursorManager.getRelativePosition(cursor);

        if (!position.isVisible) {
          return null;
        }

        return (
          <div
            key={cursor.windowId}
            className="fixed pointer-events-none z-[99999] transition-all duration-75"
            style={{
              left: `${position.x}px`,
              top: `${position.y}px`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            {/* Cursor pointer */}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              className="drop-shadow-lg"
            >
              <path
                d="M5 3L19 12L12 14L9 21L5 3Z"
                fill="#FF6B6B"
                stroke="#FFF"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>

            {/* Ripple effect */}
            <div className="absolute inset-0 animate-ping">
              <div className="w-3 h-3 bg-red-500/30 rounded-full"></div>
            </div>
          </div>
        );
      })}
    </>
  );
}
