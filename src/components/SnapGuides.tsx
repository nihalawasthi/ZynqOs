import React from 'react';
import { SnapZone, getSnapPosition } from '../utils/WindowSnap';

type SnapGuidesProps = {
  activeZone: SnapZone;
  containerWidth: number;
  containerHeight: number;
  taskbarHeight?: number;
};

/**
 * SnapGuides - Visual preview of where window will snap
 */
export default function SnapGuides({ 
  activeZone, 
  containerWidth, 
  containerHeight, 
  taskbarHeight = 64 
}: SnapGuidesProps) {
  if (!activeZone) return null;

  const snapPos = getSnapPosition(activeZone, containerWidth, containerHeight, taskbarHeight);
  if (!snapPos) return null;

  return (
    <div
      className="fixed pointer-events-none z-[9998] bg-blue-500/20 border-2 border-blue-500/60 rounded-lg transition-all duration-150 animate-pulse"
      style={{
        left: `${snapPos.x}px`,
        top: `${snapPos.y}px`,
        width: `${snapPos.width}px`,
        height: `${snapPos.height}px`,
      }}
    >
      {/* Corner indicators */}
      <div className="absolute top-2 left-2 w-3 h-3 bg-blue-500 rounded-full"></div>
      <div className="absolute top-2 right-2 w-3 h-3 bg-blue-500 rounded-full"></div>
      <div className="absolute bottom-2 left-2 w-3 h-3 bg-blue-500 rounded-full"></div>
      <div className="absolute bottom-2 right-2 w-3 h-3 bg-blue-500 rounded-full"></div>

      {/* Label */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg">
        {formatZoneName(activeZone)}
      </div>
    </div>
  );
}

function formatZoneName(zone: SnapZone): string {
  if (!zone) return '';
  
  const names: Record<string, string> = {
    'left-half': 'Snap Left',
    'right-half': 'Snap Right',
    'top-half': 'Snap Top',
    'bottom-half': 'Snap Bottom',
    'top-left': 'Top Left Quarter',
    'top-right': 'Top Right Quarter',
    'bottom-left': 'Bottom Left Quarter',
    'bottom-right': 'Bottom Right Quarter',
    'maximize': 'Maximize',
    'center': 'Center',
  };

  return names[zone] || zone;
}
