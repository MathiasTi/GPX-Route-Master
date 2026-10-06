// Mobile Quality of Life Utilities: Haptics & Native Web Share API

/**
 * Trigger subtle haptic feedback on supported mobile browsers (Android / iOS web)
 */
export const triggerHaptic = (type: 'light' | 'medium' | 'heavy' | 'success' | 'error' = 'light') => {
  if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
    try {
      switch (type) {
        case 'light':
          navigator.vibrate(10);
          break;
        case 'medium':
          navigator.vibrate(20);
          break;
        case 'heavy':
          navigator.vibrate(40);
          break;
        case 'success':
          navigator.vibrate([15, 50, 20]);
          break;
        case 'error':
          navigator.vibrate([40, 60, 40]);
          break;
      }
    } catch (_) {
      // Ignore vibration errors if not allowed
    }
  }
};

/**
 * Share track info or app link via Android / iOS Native Web Share Sheet
 */
export const shareTrackNative = async (data: { title: string; text: string; url?: string }) => {
  triggerHaptic('medium');
  const rawUrl = data.url || (typeof window !== 'undefined' ? window.location.href : '');
  // Always convert private ais-dev URL to public ais-pre URL so external/shared access never hits Google's 401
  const cleanUrl = rawUrl.replace('ais-dev-', 'ais-pre-');

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: data.title,
        text: data.text,
        url: cleanUrl,
      });
      return true;
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Native share failed:', err);
      }
    }
  }

  // Fallback to clipboard copy
  try {
    const textToCopy = `${data.title}\n${data.text}\n${cleanUrl}`;
    await navigator.clipboard.writeText(textToCopy);
    triggerHaptic('success');
    return 'copied';
  } catch (_) {
    return false;
  }
};
