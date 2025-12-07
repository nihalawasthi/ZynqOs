/**
 * SharedWindowPool - Allows transferring child windows between parent windows
 * Uses localStorage to sync window data across browser windows
 */

export type SharedWindowData = {
  id: string;
  title: string;
  appType: string;
  contentSnapshot?: string; // Serialized content if transferable
  ownerWindowId: number; // Which parent window owns it
  timestamp: number;
};

export type WindowTransferRequest = {
  windowId: string;
  fromParentId: number;
  toParentId: number;
  timestamp: number;
};

type TransferCallback = (request: WindowTransferRequest) => void;

class SharedWindowPool {
  private parentWindowId: number;
  private transferCallback: TransferCallback | null = null;

  constructor(parentWindowId: number) {
    this.parentWindowId = parentWindowId;

    // Listen for window transfers
    window.addEventListener('storage', this.handleStorageChange);
  }

  private handleStorageChange = (event: StorageEvent) => {
    if (event.key === 'zynqos_window_transfers' && event.newValue) {
      try {
        const transfers = JSON.parse(event.newValue) as WindowTransferRequest[];
        
        // Check for transfers directed to this parent window
        const incoming = transfers.find(
          (t) => t.toParentId === this.parentWindowId && t.timestamp > Date.now() - 1000
        );

        if (incoming && this.transferCallback) {
          this.transferCallback(incoming);
          
          // Clean up processed transfer
          this.removeTransfer(incoming);
        }
      } catch (error) {
        console.error('Failed to process window transfer:', error);
      }
    }
  };

  /**
   * Request to transfer a window to another parent window
   */
  requestTransfer(windowId: string, toParentId: number, windowData: SharedWindowData) {
    try {
      // Store window data in shared pool
      this.storeWindowData(windowData);

      // Create transfer request
      const transfers = this.getTransfers();
      transfers.push({
        windowId,
        fromParentId: this.parentWindowId,
        toParentId,
        timestamp: Date.now(),
      });

      localStorage.setItem('zynqos_window_transfers', JSON.stringify(transfers));
    } catch (error) {
      console.error('Failed to request window transfer:', error);
    }
  }

  /**
   * Get window data from shared pool
   */
  getWindowData(windowId: string): SharedWindowData | null {
    try {
      const poolKey = 'zynqos_window_pool';
      const poolData = localStorage.getItem(poolKey);
      if (!poolData) return null;

      const pool = JSON.parse(poolData) as Record<string, SharedWindowData>;
      return pool[windowId] || null;
    } catch (error) {
      console.error('Failed to get window data:', error);
      return null;
    }
  }

  /**
   * Store window data in shared pool
   */
  private storeWindowData(windowData: SharedWindowData) {
    try {
      const poolKey = 'zynqos_window_pool';
      const poolData = localStorage.getItem(poolKey);
      const pool: Record<string, SharedWindowData> = poolData ? JSON.parse(poolData) : {};

      pool[windowData.id] = windowData;

      localStorage.setItem(poolKey, JSON.stringify(pool));
    } catch (error) {
      console.error('Failed to store window data:', error);
    }
  }

  /**
   * Remove window data from pool after transfer
   */
  removeWindowData(windowId: string) {
    try {
      const poolKey = 'zynqos_window_pool';
      const poolData = localStorage.getItem(poolKey);
      if (!poolData) return;

      const pool = JSON.parse(poolData) as Record<string, SharedWindowData>;
      delete pool[windowId];

      localStorage.setItem(poolKey, JSON.stringify(pool));
    } catch (error) {
      console.error('Failed to remove window data:', error);
    }
  }

  /**
   * Get all pending transfers
   */
  private getTransfers(): WindowTransferRequest[] {
    try {
      const transfers = localStorage.getItem('zynqos_window_transfers');
      if (!transfers) return [];

      const parsed = JSON.parse(transfers) as WindowTransferRequest[];
      
      // Filter out stale transfers (>5 seconds old)
      const now = Date.now();
      return parsed.filter((t) => now - t.timestamp < 5000);
    } catch (error) {
      console.error('Failed to get transfers:', error);
      return [];
    }
  }

  /**
   * Remove a processed transfer
   */
  private removeTransfer(transfer: WindowTransferRequest) {
    try {
      const transfers = this.getTransfers();
      const filtered = transfers.filter(
        (t) => !(t.windowId === transfer.windowId && t.timestamp === transfer.timestamp)
      );

      localStorage.setItem('zynqos_window_transfers', JSON.stringify(filtered));
    } catch (error) {
      console.error('Failed to remove transfer:', error);
    }
  }

  /**
   * Listen for incoming window transfers
   */
  onTransfer(callback: TransferCallback) {
    this.transferCallback = callback;
  }

  /**
   * Get screen position of another parent window
   */
  getParentWindowPosition(parentId: number): { x: number; y: number; w: number; h: number } | null {
    try {
      const windows = JSON.parse(localStorage.getItem('zynqos_windows') || '[]');
      const parent = windows.find((w: any) => w.id === parentId);
      return parent ? parent.shape : null;
    } catch {
      return null;
    }
  }

  /**
   * Check if window is near another parent window's boundary
   */
  isNearParentWindow(
    dragX: number,
    dragY: number,
    threshold: number = 100
  ): { parentId: number; position: { x: number; y: number; w: number; h: number } } | null {
    try {
      const windows = JSON.parse(localStorage.getItem('zynqos_windows') || '[]');
      const currentWindowShape = {
        x: window.screenX || window.screenLeft || 0,
        y: window.screenY || window.screenTop || 0,
        w: window.innerWidth,
        h: window.innerHeight,
      };

      // Convert drag position to screen coordinates
      const screenX = currentWindowShape.x + dragX;
      const screenY = currentWindowShape.y + dragY;

      // Check all other parent windows
      for (const parent of windows) {
        if (parent.id === this.parentWindowId) continue;

        const pos = parent.shape;
        
        // Check if cursor is actually inside the other window's bounds
        const insideHorizontal = screenX >= pos.x && screenX <= pos.x + pos.w;
        const insideVertical = screenY >= pos.y && screenY <= pos.y + pos.h;

        if (insideHorizontal && insideVertical) {
          return { parentId: parent.id, position: pos };
        }
        
        // Also check if near any edge of this parent window (with threshold)
        const nearLeft = Math.abs(screenX - pos.x) < threshold;
        const nearRight = Math.abs(screenX - (pos.x + pos.w)) < threshold;
        const nearTop = Math.abs(screenY - pos.y) < threshold;
        const nearBottom = Math.abs(screenY - (pos.y + pos.h)) < threshold;

        const withinVertical = screenY >= pos.y - threshold && screenY <= pos.y + pos.h + threshold;
        const withinHorizontal = screenX >= pos.x - threshold && screenX <= pos.x + pos.w + threshold;

        if ((nearLeft || nearRight) && withinVertical || (nearTop || nearBottom) && withinHorizontal) {
          return { parentId: parent.id, position: pos };
        }
      }

      return null;
    } catch (error) {
      console.error('Error detecting parent window:', error);
      return null;
    }
  }

  /**
   * Cleanup
   */
  destroy() {
    window.removeEventListener('storage', this.handleStorageChange);
  }
}

export default SharedWindowPool;
