import React, { useEffect, useMemo } from 'react';
import { useCrossWindow } from '../hooks/useCrossWindow';

export type DisplaySelectorProps = {
  isVisible: boolean;
  dragPosition?: { x: number; y: number };
  selectedDisplayId?: number | null;
  onDisplaySelect?: (displayId: number) => void;
};

/*
 * DisplaySelector - Visual indicator for selecting which display to transfer a window to
 * Shows all active displays as selectable boxes when dragging near the bottom
 */

export default function DisplaySelector({
  isVisible,
  dragPosition = { x: 0, y: 0 },
  selectedDisplayId = null,
  onDisplaySelect = () => {}
}: DisplaySelectorProps) {
  const { windows, currentWindow } = useCrossWindow(true);

  // Group displays by user (same user can have multiple windows)
  const displays = useMemo(() => {
    return windows.map((win) => ({
      id: win.id,
      position: {
        x: win.shape.x,
        y: win.shape.y,
        w: win.shape.w,
        h: win.shape.h,
      },
      isCurrentDisplay: win.id === currentWindow?.id,
      metaData: win.metaData,
    }));
  }, [windows, currentWindow?.id]);

  // Auto-select the first non-current display when the selector opens
  useEffect(() => {
    if (!isVisible || selectedDisplayId) return;

    const defaultTarget = displays.find((d) => !d.isCurrentDisplay);
    if (defaultTarget) {
      onDisplaySelect(defaultTarget.id);
    }
  }, [isVisible, selectedDisplayId, displays, onDisplaySelect]);

  if (!isVisible || displays.length <= 1) {
    return null;
  }

  return (
    <div className="fixed inset-0 pointer-events-none z-[9998]">
      {/* Semi-transparent overlay */}
      <div className="absolute inset-0 bg-black/10 backdrop-blur-sm" />

      {/* Display selector grid at the bottom */}
      <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 pointer-events-auto z-[9998]">
        <div className="flex gap-3 p-4 bg-black/40 backdrop-blur-lg rounded-lg border border-white/20 shadow-2xl">
          {displays.map((display) => {
            const isSelected = selectedDisplayId === display.id;
            const isCurrentDisplay = display.isCurrentDisplay;

            return (
              <button
                key={display.id}
                onClick={() => onDisplaySelect(display.id)}
                onMouseEnter={() => onDisplaySelect(display.id)}
                className={`relative w-28 h-20 rounded-lg border-2 transition-all cursor-pointer overflow-hidden
                  ${isSelected || isCurrentDisplay
                    ? 'border-blue-500 bg-blue-500/20 shadow-lg shadow-blue-500/50'
                    : 'border-gray-500/50 bg-gray-800/40 hover:border-gray-400 hover:bg-gray-800/60'
                  } ${isCurrentDisplay ? 'ring-2 ring-green-400' : ''}`}
                title={`Display ${display.id}${isCurrentDisplay ? ' (Current)' : ''}`}
              >
                {/* Display content preview */}
                <div className="absolute inset-0 flex flex-col items-center justify-center p-2">
                  <div className="text-xs font-semibold text-white/80">
                    Display {display.id}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1">
                    {display.position.w}x{display.position.h}
                  </div>
                </div>

                {/* Selection indicator */}
                {isSelected && (
                  <div className="absolute inset-0 border-2 border-blue-400 rounded-lg animate-pulse" />
                )}

                {/* Current display indicator */}
                {isCurrentDisplay && (
                  <div className="absolute top-1 right-1 w-2 h-2 bg-green-400 rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Drag hint text */}
        <div className="text-center mt-3 text-xs text-gray-400">
          Select a display to transfer window
        </div>
      </div>

      {/* Drag preview line from window to selected display */}
      {selectedDisplayId && dragPosition && (
        <svg className="fixed inset-0 w-full h-full pointer-events-none" style={{ zIndex: 9997 }}>
          <line
            x1={dragPosition.x}
            y1={dragPosition.y}
            x2={window.innerWidth / 2}
            y2={window.innerHeight - 140}
            stroke="rgba(59, 130, 246, 0.5)"
            strokeWidth="2"
            strokeDasharray="5,5"
          />
        </svg>
      )}
    </div>
  );
}
