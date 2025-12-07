/**
 * SharedStateSync - Synchronizes application state across browser windows
 * Uses localStorage events to broadcast state changes
 */

type StateChangeCallback<T> = (newState: T) => void;

export class SharedStateSync<T = any> {
  private storageKey: string;
  private listeners: Set<StateChangeCallback<T>> = new Set();
  private currentState: T | null = null;

  constructor(storageKey: string, initialState?: T) {
    this.storageKey = `zynqos_shared_${storageKey}`;

    // Listen for changes from other windows
    window.addEventListener('storage', this.handleStorageChange);

    // Load initial state
    if (initialState !== undefined) {
      this.setState(initialState, false); // Don't broadcast initial state
    } else {
      this.loadState();
    }
  }

  private handleStorageChange = (event: StorageEvent) => {
    if (event.key === this.storageKey && event.newValue) {
      try {
        const newState = JSON.parse(event.newValue) as T;
        this.currentState = newState;
        this.notifyListeners(newState);
      } catch (error) {
        console.error('Failed to parse shared state:', error);
      }
    }
  };

  private notifyListeners(state: T) {
    this.listeners.forEach((listener) => listener(state));
  }

  /**
   * Load state from localStorage
   */
  private loadState() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        this.currentState = JSON.parse(stored) as T;
      }
    } catch (error) {
      console.error('Failed to load shared state:', error);
    }
  }

  /**
   * Get current state
   */
  getState(): T | null {
    return this.currentState;
  }

  /**
   * Set state and optionally broadcast to other windows
   */
  setState(newState: T, broadcast: boolean = true) {
    this.currentState = newState;

    if (broadcast) {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(newState));
        // Also notify local listeners immediately
        this.notifyListeners(newState);
      } catch (error) {
        console.error('Failed to set shared state:', error);
      }
    }
  }

  /**
   * Subscribe to state changes
   */
  subscribe(callback: StateChangeCallback<T>): () => void {
    this.listeners.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Cleanup
   */
  destroy() {
    window.removeEventListener('storage', this.handleStorageChange);
    this.listeners.clear();
  }
}

/**
 * React hook for shared state across windows
 */
import { useState, useEffect, useCallback } from 'react';

export function useSharedState<T>(
  storageKey: string,
  initialState: T
): [T, (newState: T) => void] {
  const [state, setState] = useState<T>(initialState);
  const [sync] = useState(() => new SharedStateSync<T>(storageKey, initialState));

  useEffect(() => {
    // Load initial state
    const stored = sync.getState();
    if (stored !== null) {
      setState(stored);
    }

    // Subscribe to changes
    const unsubscribe = sync.subscribe((newState) => {
      setState(newState);
    });

    return () => {
      unsubscribe();
      sync.destroy();
    };
  }, [sync]);

  const updateState = useCallback(
    (newState: T) => {
      sync.setState(newState);
      setState(newState);
    },
    [sync]
  );

  return [state, updateState];
}

export default SharedStateSync;
