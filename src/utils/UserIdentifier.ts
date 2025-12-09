/**
 * UserIdentifier - Generates and manages unique user identification
 * For logged-in users: uses their account ID
 * For non-logged-in users: generates a device-based identifier based on:
 * - WebGL renderer (GPU info)
 * - User agent
 * - Screen resolution
 * - Timezone
 * - Language
 */

/**
 * Generate a device fingerprint for non-logged-in users
 * This creates a stable identifier that persists across sessions
 */
function generateDeviceFingerprint(): string {
  try {
    // Get GPU info from WebGL
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as any;
    const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
    const gpuInfo = debugInfo ? gl?.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown';

    // Collect device info
    const deviceInfo = {
      gpu: gpuInfo || 'unknown',
      userAgent: navigator.userAgent,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      screenDepth: window.screen.colorDepth,
      timezone: new Date().getTimezoneOffset(),
      language: navigator.language,
      hardwareConcurrency: navigator.hardwareConcurrency || 1,
      deviceMemory: (navigator as any).deviceMemory || 'unknown',
      platform: navigator.platform,
    };

    // Create a simple hash of the device info
    const fingerprint = JSON.stringify(deviceInfo);
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      const char = fingerprint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }

    return `device_${Math.abs(hash).toString(16)}`;
  } catch (error) {
    console.warn('[UserIdentifier] Failed to generate device fingerprint:', error);
    return `device_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Get or create a unique user identifier
 * Returns the logged-in user ID if available, otherwise uses device fingerprint
 */
export async function getUserIdentifier(): Promise<string> {
  try {
    // Check if user is logged in by checking storage status
    const response = await fetch('/api?route=auth&action=status', { credentials: 'include' });
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      const status = await response.json();
      if (status.connected && status.user?.id) {
        // User is logged in - use their account ID
        return `user_${status.user.id}`;
      }
    }
  } catch (error) {
    console.warn('[UserIdentifier] Failed to check auth status:', error);
  }

  // User is not logged in - use device fingerprint
  const existingId = localStorage.getItem('zynqos_device_id');
  if (existingId) {
    return existingId;
  }

  const deviceId = generateDeviceFingerprint();
  localStorage.setItem('zynqos_device_id', deviceId);
  return deviceId;
}

/**
 * Get the current device identifier without async check
 * Useful for quick access when auth status doesn't need to be re-verified
 */
export function getDeviceIdentifierSync(): string {
  const existing = localStorage.getItem('zynqos_device_id');
  if (existing) {
    return existing;
  }

  const deviceId = generateDeviceFingerprint();
  localStorage.setItem('zynqos_device_id', deviceId);
  return deviceId;
}

/**
 * Clear the stored device identifier (e.g., on logout)
 */
export function clearDeviceIdentifier(): void {
  localStorage.removeItem('zynqos_device_id');
}
