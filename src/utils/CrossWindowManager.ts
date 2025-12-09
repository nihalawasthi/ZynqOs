/**
 * CrossWindowManager - Synchronizes state across multiple browser windows
 * Inspired by multipleWindow3dScene project
 * 
 * This allows ZynqOS to run in multiple physical browser windows
 * while maintaining synchronized state via localStorage
 */

export type BrowserWindowShape = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BrowserWindowData = {
  id: number;
  shape: BrowserWindowShape;
  metaData?: any;
  lastUpdate: number;
};

type WindowShapeChangeCallback = () => void;
type WindowChangeCallback = () => void;

class CrossWindowManager {
  private windows: BrowserWindowData[] = [];
  private count: number = 0;
  private id: number = 0;
  private winData: BrowserWindowData | null = null;
  private winShapeChangeCallback: WindowShapeChangeCallback | null = null;
  private winChangeCallback: WindowChangeCallback | null = null;
  private updateInterval: number | null = null;
  private cleanupInterval: number | null = null;

  constructor() {
    // Listen for localStorage changes from other windows
    window.addEventListener('storage', (event) => {
      if (event.key === 'zynqos_windows') {
        const newWindows = JSON.parse(event.newValue || '[]') as BrowserWindowData[];
        const winChange = this.didWindowsChange(this.windows, newWindows);

        this.windows = newWindows;

        if (winChange && this.winChangeCallback) {
          this.winChangeCallback();
        }
      }
    });

    // Clean up this window on close
    window.addEventListener('beforeunload', () => {
      const index = this.getWindowIndexFromId(this.id);
      if (index >= 0) {
        this.windows.splice(index, 1);
        this.updateWindowsLocalStorage();
      }
    });

    // Periodically clean up stale windows (not updated in last 5 seconds)
    this.cleanupInterval = window.setInterval(() => {
      this.cleanupStaleWindows();
    }, 5000);
  }

  /**
   * Check if there are any changes to the window list
   */
  private didWindowsChange(pWins: BrowserWindowData[], nWins: BrowserWindowData[]): boolean {
    if (pWins.length !== nWins.length) {
      return true;
    }

    for (let i = 0; i < pWins.length; i++) {
      if (pWins[i].id !== nWins[i].id) {
        return true;
      }
    }

    return false;
  }

  /**
   * Initialize the current window
   */
  init(metaData?: any) {
    this.windows = JSON.parse(localStorage.getItem('zynqos_windows') || '[]');
    this.count = parseInt(localStorage.getItem('zynqos_window_count') || '0');
    this.count++;

    this.id = this.count;
    const shape = this.getWinShape();
    this.winData = {
      id: this.id,
      shape,
      metaData,
      lastUpdate: Date.now(),
    };
    this.windows.push(this.winData);

    localStorage.setItem('zynqos_window_count', this.count.toString());
    this.updateWindowsLocalStorage();

    // Start periodic updates
    this.updateInterval = window.setInterval(() => {
      this.update();
    }, 100); // Update 10 times per second
  }

  /**
   * Get the current window's shape (position and size)
   */
  getWinShape(): BrowserWindowShape {
    return {
      x: window.screenX || window.screenLeft || 0,
      y: window.screenY || window.screenTop || 0,
      w: window.innerWidth,
      h: window.innerHeight,
    };
  }

  /**
   * Find window index by ID
   */
  private getWindowIndexFromId(id: number): number {
    return this.windows.findIndex((w) => w.id === id);
  }

  /**
   * Update localStorage with current windows
   */
  private updateWindowsLocalStorage() {
    localStorage.setItem('zynqos_windows', JSON.stringify(this.windows));
  }

  /**
   * Remove windows that haven't been updated recently
   */
  private cleanupStaleWindows() {
    const now = Date.now();
    const staleThreshold = 5000; // 5 seconds — avoid dropping active windows when tabs are throttled

    const initialLength = this.windows.length;
    this.windows = this.windows.filter((win) => {
      // Don't remove current window
      if (win.id === this.id) return true;
      // Remove if last update was too long ago
      return now - win.lastUpdate < staleThreshold;
    });

    if (this.windows.length !== initialLength) {
      this.updateWindowsLocalStorage();
      if (this.winChangeCallback) {
        this.winChangeCallback();
      }
    }
  }

  /**
   * Update current window's position/size
   */
  update() {
    if (!this.winData) return;

    const winShape = this.getWinShape();

    if (
      winShape.x !== this.winData.shape.x ||
      winShape.y !== this.winData.shape.y ||
      winShape.w !== this.winData.shape.w ||
      winShape.h !== this.winData.shape.h
    ) {
      this.winData.shape = winShape;
      this.winData.lastUpdate = Date.now();

      const index = this.getWindowIndexFromId(this.id);
      if (index >= 0) {
        this.windows[index].shape = winShape;
        this.windows[index].lastUpdate = Date.now();
      }

      if (this.winShapeChangeCallback) {
        this.winShapeChangeCallback();
      }
      this.updateWindowsLocalStorage();
    } else {
      // Even if shape didn't change, update timestamp
      this.winData.lastUpdate = Date.now();
      const index = this.getWindowIndexFromId(this.id);
      if (index >= 0) {
        this.windows[index].lastUpdate = Date.now();
        this.updateWindowsLocalStorage();
      }
    }
  }

  /**
   * Set callback for when window shape changes
   */
  setWinShapeChangeCallback(callback: WindowShapeChangeCallback) {
    this.winShapeChangeCallback = callback;
  }

  /**
   * Set callback for when window list changes
   */
  setWinChangeCallback(callback: WindowChangeCallback) {
    this.winChangeCallback = callback;
  }

  /**
   * Get all windows
   */
  getWindows(): BrowserWindowData[] {
    return this.windows;
  }

  /**
   * Get this window's data
   */
  getThisWindowData(): BrowserWindowData | null {
    return this.winData;
  }

  /**
   * Get this window's ID
   */
  getThisWindowID(): number {
    return this.id;
  }

  /**
   * Check if multiple windows are open
   */
  hasMultipleWindows(): boolean {
    return this.windows.length > 1;
  }

  /**
   * Cleanup on destroy
   */
  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    const index = this.getWindowIndexFromId(this.id);
    if (index >= 0) {
      this.windows.splice(index, 1);
      this.updateWindowsLocalStorage();
    }
  }
}

export default CrossWindowManager;
