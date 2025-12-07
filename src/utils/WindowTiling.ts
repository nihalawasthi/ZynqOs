/**
 * WindowTiling - Grid-based tiling layouts for child windows
 * Provides split-screen and mosaic layouts within the app
 */

export type TilingLayout =
  | 'single' // One window maximized
  | 'split-vertical' // Two windows side-by-side
  | 'split-horizontal' // Two windows stacked
  | 'grid-2x2' // Four windows in 2x2 grid
  | 'triple-left' // One large left, two stacked right
  | 'triple-right' // Two stacked left, one large right
  | 'triple-top' // One large top, two side-by-side bottom
  | 'triple-bottom' // Two side-by-side top, one large bottom
  | 'free'; // No tiling (free positioning)

export type WindowTile = {
  windowId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const TASKBAR_HEIGHT = 64;
const WINDOW_MARGIN = 4; // Gap between windows

/**
 * Calculate window positions for a given tiling layout
 */
export function calculateTilePositions(
  layout: TilingLayout,
  windowIds: string[],
  containerWidth: number,
  containerHeight: number
): WindowTile[] {
  const availableHeight = containerHeight - TASKBAR_HEIGHT;
  const startY = 0;

  switch (layout) {
    case 'single':
      return windowIds.slice(0, 1).map((id) => ({
        windowId: id,
        x: 0,
        y: startY,
        width: containerWidth,
        height: availableHeight,
      }));

    case 'split-vertical': {
      const halfWidth = (containerWidth - WINDOW_MARGIN) / 2;
      return windowIds.slice(0, 2).map((id, index) => ({
        windowId: id,
        x: index === 0 ? 0 : halfWidth + WINDOW_MARGIN,
        y: startY,
        width: halfWidth,
        height: availableHeight,
      }));
    }

    case 'split-horizontal': {
      const halfHeight = (availableHeight - WINDOW_MARGIN) / 2;
      return windowIds.slice(0, 2).map((id, index) => ({
        windowId: id,
        x: 0,
        y: startY + (index === 0 ? 0 : halfHeight + WINDOW_MARGIN),
        width: containerWidth,
        height: halfHeight,
      }));
    }

    case 'grid-2x2': {
      const halfWidth = (containerWidth - WINDOW_MARGIN) / 2;
      const halfHeight = (availableHeight - WINDOW_MARGIN) / 2;
      const positions = [
        { x: 0, y: 0 }, // Top-left
        { x: halfWidth + WINDOW_MARGIN, y: 0 }, // Top-right
        { x: 0, y: halfHeight + WINDOW_MARGIN }, // Bottom-left
        { x: halfWidth + WINDOW_MARGIN, y: halfHeight + WINDOW_MARGIN }, // Bottom-right
      ];

      return windowIds.slice(0, 4).map((id, index) => ({
        windowId: id,
        x: positions[index].x,
        y: startY + positions[index].y,
        width: halfWidth,
        height: halfHeight,
      }));
    }

    case 'triple-left': {
      const leftWidth = (containerWidth * 2 / 3) - WINDOW_MARGIN;
      const rightWidth = containerWidth / 3;
      const halfHeight = (availableHeight - WINDOW_MARGIN) / 2;

      const positions = [
        { x: 0, y: 0, width: leftWidth, height: availableHeight }, // Large left
        { x: leftWidth + WINDOW_MARGIN, y: 0, width: rightWidth, height: halfHeight }, // Top right
        { x: leftWidth + WINDOW_MARGIN, y: halfHeight + WINDOW_MARGIN, width: rightWidth, height: halfHeight }, // Bottom right
      ];

      return windowIds.slice(0, 3).map((id, index) => ({
        windowId: id,
        ...positions[index],
        y: startY + positions[index].y,
      }));
    }

    case 'triple-right': {
      const leftWidth = containerWidth / 3;
      const rightWidth = (containerWidth * 2 / 3) - WINDOW_MARGIN;
      const halfHeight = (availableHeight - WINDOW_MARGIN) / 2;

      const positions = [
        { x: 0, y: 0, width: leftWidth, height: halfHeight }, // Top left
        { x: 0, y: halfHeight + WINDOW_MARGIN, width: leftWidth, height: halfHeight }, // Bottom left
        { x: leftWidth + WINDOW_MARGIN, y: 0, width: rightWidth, height: availableHeight }, // Large right
      ];

      return windowIds.slice(0, 3).map((id, index) => ({
        windowId: id,
        ...positions[index],
        y: startY + positions[index].y,
      }));
    }

    case 'triple-top': {
      const topHeight = (availableHeight * 2 / 3) - WINDOW_MARGIN;
      const bottomHeight = availableHeight / 3;
      const halfWidth = (containerWidth - WINDOW_MARGIN) / 2;

      const positions = [
        { x: 0, y: 0, width: containerWidth, height: topHeight }, // Large top
        { x: 0, y: topHeight + WINDOW_MARGIN, width: halfWidth, height: bottomHeight }, // Bottom left
        { x: halfWidth + WINDOW_MARGIN, y: topHeight + WINDOW_MARGIN, width: halfWidth, height: bottomHeight }, // Bottom right
      ];

      return windowIds.slice(0, 3).map((id, index) => ({
        windowId: id,
        ...positions[index],
        y: startY + positions[index].y,
      }));
    }

    case 'triple-bottom': {
      const topHeight = availableHeight / 3;
      const bottomHeight = (availableHeight * 2 / 3) - WINDOW_MARGIN;
      const halfWidth = (containerWidth - WINDOW_MARGIN) / 2;

      const positions = [
        { x: 0, y: 0, width: halfWidth, height: topHeight }, // Top left
        { x: halfWidth + WINDOW_MARGIN, y: 0, width: halfWidth, height: topHeight }, // Top right
        { x: 0, y: topHeight + WINDOW_MARGIN, width: containerWidth, height: bottomHeight }, // Large bottom
      ];

      return windowIds.slice(0, 3).map((id, index) => ({
        windowId: id,
        ...positions[index],
        y: startY + positions[index].y,
      }));
    }

    case 'free':
    default:
      return []; // No automatic positioning
  }
}

/**
 * Get layout name for display
 */
export function getLayoutName(layout: TilingLayout): string {
  const names: Record<TilingLayout, string> = {
    single: 'Single Window',
    'split-vertical': 'Split Vertical',
    'split-horizontal': 'Split Horizontal',
    'grid-2x2': '2×2 Grid',
    'triple-left': 'Triple (Large Left)',
    'triple-right': 'Triple (Large Right)',
    'triple-top': 'Triple (Large Top)',
    'triple-bottom': 'Triple (Large Bottom)',
    free: 'Free Positioning',
  };

  return names[layout];
}

/**
 * Get suggested layout based on window count
 */
export function suggestLayout(windowCount: number): TilingLayout {
  if (windowCount === 0) return 'free';
  if (windowCount === 1) return 'single';
  if (windowCount === 2) return 'split-vertical';
  if (windowCount === 3) return 'triple-left';
  if (windowCount === 4) return 'grid-2x2';
  return 'free'; // Too many windows for tiling
}

/**
 * Keyboard shortcut for layouts
 */
export function getLayoutFromShortcut(key: string, alt: boolean, shift: boolean): TilingLayout | null {
  if (!alt) return null;

  // Alt+1-9 for layouts
  const layoutMap: Record<string, TilingLayout> = {
    '1': 'single',
    '2': 'split-vertical',
    '3': 'split-horizontal',
    '4': 'grid-2x2',
    '5': 'triple-left',
    '6': 'triple-right',
    '7': 'triple-top',
    '8': 'triple-bottom',
    '0': 'free',
  };

  return layoutMap[key] || null;
}
