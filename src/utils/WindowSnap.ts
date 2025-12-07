/**
 * WindowSnap - Utilities for snapping child windows to edges and grid
 */

export type SnapZone = 
  | 'left-half'
  | 'right-half'
  | 'top-half'
  | 'bottom-half'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'maximize'
  | 'center'
  | null;

export type SnapPosition = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const SNAP_THRESHOLD = 20; // pixels from edge to trigger snap
const GRID_SIZE = 20; // grid snap size

/**
 * Detect which snap zone the cursor is in
 */
export function detectSnapZone(x: number, y: number, containerWidth: number, containerHeight: number): SnapZone {
  const leftEdge = x < SNAP_THRESHOLD;
  const rightEdge = x > containerWidth - SNAP_THRESHOLD;
  const topEdge = y < SNAP_THRESHOLD;
  const bottomEdge = y > containerHeight - SNAP_THRESHOLD;

  // Corners (higher priority)
  if (topEdge && leftEdge) return 'top-left';
  if (topEdge && rightEdge) return 'top-right';
  if (bottomEdge && leftEdge) return 'bottom-left';
  if (bottomEdge && rightEdge) return 'bottom-right';

  // Edges
  if (leftEdge) return 'left-half';
  if (rightEdge) return 'right-half';
  if (topEdge) return 'top-half';
  if (bottomEdge) return 'bottom-half';

  return null;
}

/**
 * Get snap position for a given zone
 */
export function getSnapPosition(
  zone: SnapZone,
  containerWidth: number,
  containerHeight: number,
  taskbarHeight: number = 64 // Reserve space for taskbar
): SnapPosition | null {
  if (!zone) return null;

  const availableHeight = containerHeight - taskbarHeight;
  const startY = 0;

  switch (zone) {
    case 'maximize':
      return {
        x: 0,
        y: startY,
        width: containerWidth,
        height: availableHeight,
      };

    case 'left-half':
      return {
        x: 0,
        y: startY,
        width: containerWidth / 2,
        height: availableHeight,
      };

    case 'right-half':
      return {
        x: containerWidth / 2,
        y: startY,
        width: containerWidth / 2,
        height: availableHeight,
      };

    case 'top-half':
      return {
        x: 0,
        y: startY,
        width: containerWidth,
        height: availableHeight / 2,
      };

    case 'bottom-half':
      return {
        x: 0,
        y: startY + availableHeight / 2,
        width: containerWidth,
        height: availableHeight / 2,
      };

    case 'top-left':
      return {
        x: 0,
        y: startY,
        width: containerWidth / 2,
        height: availableHeight / 2,
      };

    case 'top-right':
      return {
        x: containerWidth / 2,
        y: startY,
        width: containerWidth / 2,
        height: availableHeight / 2,
      };

    case 'bottom-left':
      return {
        x: 0,
        y: startY + availableHeight / 2,
        width: containerWidth / 2,
        height: availableHeight / 2,
      };

    case 'bottom-right':
      return {
        x: containerWidth / 2,
        y: startY + availableHeight / 2,
        width: containerWidth / 2,
        height: availableHeight / 2,
      };

    case 'center':
      return {
        x: containerWidth / 4,
        y: startY + availableHeight / 4,
        width: containerWidth / 2,
        height: availableHeight / 2,
      };

    default:
      return null;
  }
}

/**
 * Snap position to grid
 */
export function snapToGrid(x: number, y: number, gridSize: number = GRID_SIZE): { x: number; y: number } {
  return {
    x: Math.round(x / gridSize) * gridSize,
    y: Math.round(y / gridSize) * gridSize,
  };
}

/**
 * Check if position is near edge (for edge snapping)
 */
export function snapToEdge(
  x: number,
  y: number,
  width: number,
  height: number,
  containerWidth: number,
  containerHeight: number,
  threshold: number = SNAP_THRESHOLD
): { x: number; y: number } {
  let newX = x;
  let newY = y;

  // Snap to left edge
  if (x < threshold && x > -threshold) {
    newX = 0;
  }

  // Snap to right edge
  if (x + width > containerWidth - threshold && x + width < containerWidth + threshold) {
    newX = containerWidth - width;
  }

  // Snap to top edge
  if (y < threshold && y > -threshold) {
    newY = 0;
  }

  // Snap to bottom edge (accounting for taskbar)
  const taskbarHeight = 64;
  const bottomLimit = containerHeight - taskbarHeight;
  if (y + height > bottomLimit - threshold && y + height < bottomLimit + threshold) {
    newY = bottomLimit - height;
  }

  return { x: newX, y: newY };
}

/**
 * Keep window within bounds
 */
export function constrainToBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  containerWidth: number,
  containerHeight: number,
  taskbarHeight: number = 64
): { x: number; y: number } {
  const minX = 0;
  const maxX = containerWidth - width;
  const minY = 0;
  const maxY = containerHeight - taskbarHeight - height;

  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y)),
  };
}

/**
 * Generate keyboard shortcut for snap zones
 */
export function getSnapZoneFromShortcut(key: string, ctrl: boolean, shift: boolean): SnapZone {
  if (!ctrl) return null;

  // Ctrl+Arrow for half-screen snaps
  switch (key) {
    case 'ArrowLeft':
      return shift ? 'top-left' : 'left-half';
    case 'ArrowRight':
      return shift ? 'top-right' : 'right-half';
    case 'ArrowUp':
      return shift ? 'maximize' : 'top-half';
    case 'ArrowDown':
      return shift ? 'center' : 'bottom-half';
    default:
      return null;
  }
}
