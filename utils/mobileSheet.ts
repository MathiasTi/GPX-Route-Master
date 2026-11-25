export type MobileSheetSnap = 'mini' | 'standard' | 'expanded';
export type MobileSheetResolution = MobileSheetSnap | 'collapsed';

export interface SheetDragInput {
  currentSnap: MobileSheetSnap;
  /** Positive = dragged downward, Negative = dragged upward (px) */
  deltaY: number;
  /** Positive = flicked downward, Negative = flicked upward (px/ms) */
  velocityY?: number;
  /** Optional viewport height for proportional thresholds */
  viewportHeight?: number;
}

const SNAP_ORDER: readonly MobileSheetSnap[] = ['mini', 'standard', 'expanded'];

/**
 * Pure snap resolver for gesture-draggable mobile bottom sheets.
 * Dragging up moves toward 'expanded'; dragging down moves toward 'mini' or 'collapsed'.
 */
export function resolveBottomSheetSnap({
  currentSnap,
  deltaY,
  velocityY = 0,
  viewportHeight = 800
}: SheetDragInput): MobileSheetResolution {
  const safeHeight = Math.max(480, Number.isFinite(viewportHeight) ? viewportHeight : 800);
  const stepThreshold = Math.max(36, Math.round(safeHeight * 0.065));
  const jumpThreshold = Math.max(130, Math.round(safeHeight * 0.22));
  const fastFlickVelocity = 0.55; // px per ms
  const gentleFlickVelocity = 0.32;

  const currentIdx = SNAP_ORDER.indexOf(currentSnap);

  // Deadzone: tiny accidental movements keep current snap
  if (Math.abs(deltaY) < 24 && Math.abs(velocityY) < gentleFlickVelocity) {
    return currentSnap;
  }

  // Upward drag / flick (negative deltaY / velocityY)
  if (deltaY < 0 || velocityY <= -gentleFlickVelocity) {
    if (velocityY <= -fastFlickVelocity || deltaY <= -jumpThreshold) {
      return 'expanded';
    }
    if (deltaY <= -stepThreshold || velocityY <= -gentleFlickVelocity) {
      return SNAP_ORDER[Math.min(SNAP_ORDER.length - 1, currentIdx + 1)];
    }
    return currentSnap;
  }

  // Downward drag / flick (positive deltaY / velocityY)
  if (deltaY > 0 || velocityY >= gentleFlickVelocity) {
    // Fast downward flick from mini or large downward drag from standard/mini collapses the sheet
    if (currentSnap === 'mini' && (deltaY >= stepThreshold || velocityY >= gentleFlickVelocity)) {
      return 'collapsed';
    }
    if (velocityY >= fastFlickVelocity && deltaY >= stepThreshold) {
      return currentSnap === 'expanded' ? 'mini' : 'collapsed';
    }
    if (deltaY >= jumpThreshold) {
      return currentSnap === 'expanded' ? 'mini' : 'collapsed';
    }
    if (deltaY >= stepThreshold || velocityY >= gentleFlickVelocity) {
      if (currentIdx === 0) return 'collapsed';
      return SNAP_ORDER[currentIdx - 1];
    }
  }

  return currentSnap;
}
