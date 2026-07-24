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
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: data.title,
        text: data.text,
        url: data.url || window.location.href,
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
    const textToCopy = `${data.title}\n${data.text}\n${data.url || window.location.href}`;
    await navigator.clipboard.writeText(textToCopy);
    triggerHaptic('success');
    return 'copied';
  } catch (_) {
    return false;
  }
};
