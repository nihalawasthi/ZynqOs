/**
 * CrossWindowCursor - Synchronizes cursor position across browser windows
 * Enables cursor to "travel" between windows like multi-monitor setup
 */

export type CursorPosition = {
  x: number;
  y: number;
  windowId: number;
  timestamp: number;
};

export type RemoteCursor = CursorPosition & {
  windowShape: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
};

type CursorUpdateCallback = (cursors: RemoteCursor[]) => void;

class CrossWindowCursor {
  private windowId: number = 0;
  private updateInterval: number | null = null;
  private cursorCallback: CursorUpdateCallback | null = null;
  private lastPosition: { x: number; y: number } = { x: 0, y: 0 };
  private windowShape = { x: 0, y: 0, w: 0, h: 0 };

  constructor(windowId: number) {
    this.windowId = windowId;
    this.updateWindowShape();

    // Listen for cursor updates from other windows
    window.addEventListener('storage', this.handleStorageChange);

    // Track local cursor movement
    document.addEventListener('mousemove', this.handleMouseMove);

    // Update window position periodically
    this.updateInterval = window.setInterval(() => {
      this.updateWindowShape();
    }, 100);

    // Cleanup on window close
    window.addEventListener('beforeunload', this.cleanup);
  }

  private updateWindowShape = () => {
    this.windowShape = {
      x: window.screenX || window.screenLeft || 0,
      y: window.screenY || window.screenTop || 0,
      w: window.innerWidth,
      h: window.innerHeight,
    };
  };

  private handleMouseMove = (e: MouseEvent) => {
    this.lastPosition = {
      x: e.clientX,
      y: e.clientY,
    };

    // Broadcast cursor position
    this.broadcastCursor(e.clientX, e.clientY);
  };

  private handleStorageChange = (event: StorageEvent) => {
    if (event.key === 'zynqos_cursors' && event.newValue) {
      try {
        const allCursors = JSON.parse(event.newValue) as Record<number, CursorPosition>;
        const remoteCursors = this.getRemoteCursors(allCursors);

        if (this.cursorCallback) {
          this.cursorCallback(remoteCursors);
        }
      } catch (error) {
        console.error('Failed to parse cursor data:', error);
      }
    }
  };

  private broadcastCursor(x: number, y: number) {
    try {
      const stored = localStorage.getItem('zynqos_cursors');
      const allCursors: Record<number, CursorPosition> = stored ? JSON.parse(stored) : {};

      allCursors[this.windowId] = {
        x,
        y,
        windowId: this.windowId,
        timestamp: Date.now(),
      };

      // Clean up stale cursors (>2 seconds old)
      const now = Date.now();
      Object.keys(allCursors).forEach((key) => {
        const id = parseInt(key);
        if (now - allCursors[id].timestamp > 2000) {
          delete allCursors[id];
        }
      });

      localStorage.setItem('zynqos_cursors', JSON.stringify(allCursors));
    } catch (error) {
      console.error('Failed to broadcast cursor:', error);
    }
  }

  private getRemoteCursors(allCursors: Record<number, CursorPosition>): RemoteCursor[] {
    const windows = JSON.parse(localStorage.getItem('zynqos_windows') || '[]');
    const remoteCursors: RemoteCursor[] = [];

    Object.values(allCursors).forEach((cursor) => {
      if (cursor.windowId !== this.windowId) {
        const window = windows.find((w: any) => w.id === cursor.windowId);
        if (window) {
          remoteCursors.push({
            ...cursor,
            windowShape: window.shape,
          });
        }
      }
    });

    return remoteCursors;
  }

  /**
   * Convert remote cursor position to this window's coordinate system
   */
  getRelativePosition(remoteCursor: RemoteCursor): { x: number; y: number; isVisible: boolean } {
    const remoteAbsoluteX = remoteCursor.windowShape.x + remoteCursor.x;
    const remoteAbsoluteY = remoteCursor.windowShape.y + remoteCursor.y;

    const relativeX = remoteAbsoluteX - this.windowShape.x;
    const relativeY = remoteAbsoluteY - this.windowShape.y;

    const isVisible =
      relativeX >= 0 &&
      relativeX <= this.windowShape.w &&
      relativeY >= 0 &&
      relativeY <= this.windowShape.h;

    return {
      x: relativeX,
      y: relativeY,
      isVisible,
    };
  }

  /**
   * Set callback for cursor updates
   */
  onCursorUpdate(callback: CursorUpdateCallback) {
    this.cursorCallback = callback;
  }

  /**
   * Get cursor position in screen coordinates
   */
  getScreenPosition(): { x: number; y: number } {
    return {
      x: this.windowShape.x + this.lastPosition.x,
      y: this.windowShape.y + this.lastPosition.y,
    };
  }

  private cleanup = () => {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    window.removeEventListener('storage', this.handleStorageChange);
    document.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('beforeunload', this.cleanup);

    // Remove this cursor from storage
    try {
      const stored = localStorage.getItem('zynqos_cursors');
      if (stored) {
        const allCursors = JSON.parse(stored);
        delete allCursors[this.windowId];
        localStorage.setItem('zynqos_cursors', JSON.stringify(allCursors));
      }
    } catch (error) {
      console.error('Failed to cleanup cursor:', error);
    }
  };

  destroy() {
    this.cleanup();
  }
}

export default CrossWindowCursor;
