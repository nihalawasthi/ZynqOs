import { useEffect, useState, useCallback } from 'react';
import CrossWindowManager, { BrowserWindowData } from '../utils/CrossWindowManager';

let globalWindowManager: CrossWindowManager | null = null;

/**
 * React hook for cross-window synchronization
 * Manages multiple browser windows running ZynqOS
 */
export function useCrossWindow(enabled: boolean = true, metaData?: any) {
  const [windows, setWindows] = useState<BrowserWindowData[]>([]);
  const [currentWindow, setCurrentWindow] = useState<BrowserWindowData | null>(null);
  const [hasMultipleWindows, setHasMultipleWindows] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    // Initialize or reuse global window manager
    if (!globalWindowManager) {
      globalWindowManager = new CrossWindowManager();
      globalWindowManager.init(metaData);
    }

    const manager = globalWindowManager;

    // Set up callbacks
    const handleWindowsUpdate = () => {
      const allWindows = manager.getWindows();
      setWindows(allWindows);
      setCurrentWindow(manager.getThisWindowData());
      setHasMultipleWindows(manager.hasMultipleWindows());
    };

    const handleShapeChange = () => {
      setCurrentWindow(manager.getThisWindowData());
    };

    manager.setWinChangeCallback(handleWindowsUpdate);
    manager.setWinShapeChangeCallback(handleShapeChange);

    // Initial update
    handleWindowsUpdate();

    // Poll occasionally in case storage events are missed (keeps display list fresh)
    const syncInterval = window.setInterval(() => {
      handleWindowsUpdate();
    }, 500);

    // Cleanup on unmount
    return () => {
      // Don't destroy the manager, just clean up callbacks
      // The manager will clean up on window unload
      window.clearInterval(syncInterval);
    };
  }, [enabled, metaData]);

  const openNewWindow = useCallback((url?: string) => {
    const targetUrl = url || window.location.href;
    const newWindow = window.open(
      targetUrl,
      '_blank',
      'width=1200,height=800,menubar=no,toolbar=no,location=no'
    );
    return newWindow;
  }, []);

  const getWindowManager = useCallback(() => {
    return globalWindowManager;
  }, []);

  return {
    windows,
    currentWindow,
    hasMultipleWindows,
    windowCount: windows.length,
    openNewWindow,
    getWindowManager,
  };
}

export default useCrossWindow;
