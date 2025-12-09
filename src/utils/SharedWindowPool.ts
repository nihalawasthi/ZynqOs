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
  position?: { x: number; y: number }; // Position in target window
  width?: number; // Width when transferred
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
  private lastProcessedTransferId = ""; // Track the exact transfer we last processed
  private processedTransfers = new Map<string, number>(); // windowId -> timestamp of last processing
  private checkForTransfersInterval: number | null = null;

  constructor(parentWindowId: number) {
    this.parentWindowId = parentWindowId;

    // Listen for window transfers
    window.addEventListener('storage', this.handleStorageChange);
    
    // Also check periodically for transfers in case storage event doesn't fire
    // Check frequently to ensure we catch transfers quickly
    this.checkForTransfersInterval = window.setInterval(() => {
      this.checkForPendingTransfers();
    }, 50);
  }

  private checkForPendingTransfers = () => {
    try {
      const transfers = JSON.parse(localStorage.getItem('zynqos_window_transfers') || '[]') as WindowTransferRequest[];
      const incoming = transfers
        .filter((t) => 
          t.toParentId === this.parentWindowId && 
          t.timestamp > Date.now() - 3000
        )
        .sort((a, b) => b.timestamp - a.timestamp)[0];

      if (incoming && this.transferCallback) {
        const transferId = `${incoming.windowId}-${incoming.fromParentId}-${incoming.timestamp}`;
        
        if (transferId !== this.lastProcessedTransferId) {
          console.log(`[SharedWindowPool] Window ${this.parentWindowId}: Processing pending transfer ${transferId}`);
          this.lastProcessedTransferId = transferId;
          
          this.transferCallback(incoming);
          
          setTimeout(() => this.removeTransfer(incoming), 300);
        }
      }
    } catch (error) {
      console.error('[SharedWindowPool] Error checking for pending transfers:', error);
    }
  };

  private handleStorageChange = (event: StorageEvent) => {
    if (event.key === 'zynqos_window_transfers' && event.newValue) {
      try {
        const transfers = JSON.parse(event.newValue) as WindowTransferRequest[];
        
        // Check for transfers directed to this parent window
        // Look for the MOST RECENT transfer directed to us that we haven't processed yet
        const incoming = transfers
          .filter((t) => 
            t.toParentId === this.parentWindowId && 
            t.timestamp > Date.now() - 3000
          )
          .sort((a, b) => b.timestamp - a.timestamp)[0];

        if (incoming && this.transferCallback) {
          // Create a unique ID for this transfer
          const transferId = `${incoming.windowId}-${incoming.fromParentId}-${incoming.timestamp}`;
          
          // Only process if it's different from the last one we processed
          if (transferId !== this.lastProcessedTransferId) {
            console.log(`[SharedWindowPool] Window ${this.parentWindowId}: Processing transfer ${transferId}`);
            this.lastProcessedTransferId = transferId;
            
            this.transferCallback(incoming);
            
            // Clean up processed transfer after a delay
            setTimeout(() => this.removeTransfer(incoming), 300);
          }
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
      console.log(`[SharedWindowPool] Requesting transfer of window ${windowId} from parent ${this.parentWindowId} to parent ${toParentId}`);
      
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
      console.log(`[SharedWindowPool] Transfer stored. All transfers:`, transfers);
      
      // If transferring to another window, the storage event will be triggered in that window
      // If transferring within same window (shouldn't happen), manually trigger callback
      if (toParentId === this.parentWindowId && this.transferCallback) {
        console.log(`[SharedWindowPool] Same window transfer detected, triggering callback directly`);
        // This shouldn't normally happen, but handle it just in case
      }
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
    threshold: number = 50
  ): { parentId: number; position: { x: number; y: number; w: number; h: number } } | null {
    try {
      const windows = JSON.parse(localStorage.getItem('zynqos_windows') || '[]');
      
      // Get current window position
      const currentWindowX = window.screenX || window.screenLeft || 0;
      const currentWindowY = window.screenY || window.screenTop || 0;
      const currentWindowW = window.innerWidth;
      const currentWindowH = window.innerHeight;

      // Convert drag position to screen coordinates
      const screenX = currentWindowX + dragX;
      const screenY = currentWindowY + dragY;

      // Check all other parent windows
      for (const parent of windows) {
        if (parent.id === this.parentWindowId) continue;

        const pos = parent.shape;
        
        // Check if cursor is inside the other window's bounds
        const insideX = screenX >= pos.x && screenX <= pos.x + pos.w;
        const insideY = screenY >= pos.y && screenY <= pos.y + pos.h;

        if (insideX && insideY) {
          console.log(`[SharedWindowPool] Cursor detected in parent window ${parent.id}. Current: (${currentWindowX}, ${currentWindowY}, ${currentWindowW}x${currentWindowH}), Target: (${pos.x}, ${pos.y}, ${pos.w}x${pos.h}), Cursor: (${screenX}, ${screenY})`);
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
    if (this.checkForTransfersInterval) {
      window.clearInterval(this.checkForTransfersInterval);
    }
  }
}

export default SharedWindowPool;
