/* 
 * Window Snap Zones Visual Reference
 * ===================================
 * 
 * This file visualizes all available snap zones in ZynqOS
 * 
 * SCREEN LAYOUT:
 * 
 * ┌─────────────────────────────────────────┐
 * │  TOP-LEFT    │    TOP HALF    │ TOP-RIGHT│  ← Drag to top-left corner
 * │   QUARTER    │                │  QUARTER │  ← Drag to top edge
 * │  Ctrl+Shift+←│    Ctrl+↑      │Ctrl+Shift→│  ← Drag to top-right corner
 * ├──────────────┼────────────────┼──────────┤
 * │              │                │          │
 * │  LEFT HALF   │   MAXIMIZE     │  RIGHT   │  ← Drag to left edge
 * │   Ctrl+←     │Ctrl+Shift+↑    │  HALF    │  ← Drag to right edge
 * │              │                │ Ctrl+→   │
 * ├──────────────┼────────────────┼──────────┤
 * │ BOTTOM-LEFT  │  BOTTOM HALF   │ BOTTOM-  │  ← Drag to bottom-left corner
 * │   QUARTER    │    Ctrl+↓      │  RIGHT   │  ← Drag to bottom edge
 * │              │                │ QUARTER  │  ← Drag to bottom-right corner
 * └─────────────────────────────────────────┘
 *                 TASKBAR (64px)
 * 
 * 
 * EDGE DETECTION ZONES (20px threshold):
 * 
 *    ▼ Top edge (20px)
 *    ┌─────────────────────┐
 *    │                     │ ← Right edge (20px)
 *    │                     │
 *    │      SCREEN         │
 *    │                     │
 * ←  │                     │
 * Left                     │
 * edge                     │
 * (20px)                   │
 *    │                     │
 *    └─────────────────────┘
 *    ▲ Bottom edge (20px)
 * 
 * 
 * KEYBOARD SHORTCUTS:
 * 
 * Half-Screen:
 *   Ctrl + ←  →  Left Half
 *   Ctrl + →  →  Right Half
 *   Ctrl + ↑  →  Top Half
 *   Ctrl + ↓  →  Bottom Half
 * 
 * Quarter-Screen:
 *   Ctrl + Shift + ←  →  Top-Left Quarter
 *   Ctrl + Shift + →  →  Top-Right Quarter
 *   Ctrl + Shift + ↑  →  Maximize
 *   Ctrl + Shift + ↓  →  Center (50% width/height)
 * 
 * Other:
 *   Ctrl + Enter  →  Toggle Maximize
 *   Double-click titlebar  →  Maximize/Restore
 * 
 * 
 * SNAP ZONE DIMENSIONS:
 * 
 * Half-Screen Snaps:
 *   - Width: 50% of screen
 *   - Height: 100% minus taskbar (64px)
 * 
 * Quarter-Screen Snaps:
 *   - Width: 50% of screen
 *   - Height: 50% of available space
 * 
 * Maximize:
 *   - Width: 100% of screen
 *   - Height: 100% minus taskbar
 * 
 * Center:
 *   - Width: 50% of screen (centered)
 *   - Height: 50% of available space (centered)
 * 
 * 
 * VISUAL FEEDBACK:
 * 
 * Active Drag:
 *   ┌─────────────────┐
 *   │ SNAP PREVIEW    │  ← Blue overlay (20% opacity)
 *   │ •           •   │  ← Corner indicators
 *   │                 │
 *   │   Snap Left     │  ← Zone label
 *   │                 │
 *   │ •           •   │
 *   └─────────────────┘
 * 
 * 
 * IMPLEMENTATION FILES:
 * 
 * src/utils/WindowSnap.ts          - Snap calculations
 * src/components/SnapGuides.tsx    - Visual preview
 * src/components/Window.tsx        - Drag & snap logic
 * 
 * 
 * CUSTOMIZATION:
 * 
 * Change snap threshold:
 *   const SNAP_THRESHOLD = 20  // Distance from edge (pixels)
 * 
 * Change taskbar height:
 *   const taskbarHeight = 64   // Reserved bottom space (pixels)
 * 
 * Change grid size:
 *   const GRID_SIZE = 20       // Grid snap increment (pixels)
 * 
 */

// This file is for reference only - no executable code
export {}
