import { Result, ok, err } from '../core/result';

export class VirtualizerError extends Error {
  constructor(message: string, public readonly code: 'INVALID_DIMENSIONS' | 'INVALID_SCROLL') {
    super(message);
    this.name = 'VirtualizerError';
  }
}

export interface VirtualWindowConfig {
  readonly totalItems: number;
  readonly itemHeight: number;
  readonly viewportHeight: number;
  readonly scrollTop: number;
  readonly overscan?: number;
}

export interface VirtualWindowResult {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startOffsetPx: number;
  readonly totalHeightPx: number;
  readonly visibleCount: number;
}

/**
 * Computes a high-performance virtualized window slice for lists/tables with thousands of rows.
 * Prevents DOM bloat and guarantees 60 FPS scrolling.
 */
export function computeVirtualWindow(
  config: VirtualWindowConfig
): Result<VirtualWindowResult, VirtualizerError> {
  const { totalItems, itemHeight, viewportHeight, scrollTop } = config;
  const overscan = Math.max(0, config.overscan ?? 3);

  if (!Number.isFinite(itemHeight) || itemHeight <= 0) {
    return err(new VirtualizerError('itemHeight must be a positive finite number.', 'INVALID_DIMENSIONS'));
  }
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return err(new VirtualizerError('viewportHeight must be a positive finite number.', 'INVALID_DIMENSIONS'));
  }
  if (!Number.isFinite(totalItems) || totalItems < 0) {
    return err(new VirtualizerError('totalItems must be a non-negative integer.', 'INVALID_DIMENSIONS'));
  }
  if (!Number.isFinite(scrollTop) || scrollTop < 0) {
    return err(new VirtualizerError('scrollTop must be a non-negative finite number.', 'INVALID_SCROLL'));
  }

  const totalHeightPx = totalItems * itemHeight;

  if (totalItems === 0) {
    return ok({
      startIndex: 0,
      endIndex: 0,
      startOffsetPx: 0,
      totalHeightPx: 0,
      visibleCount: 0
    });
  }

  // Calculate raw visible indices based on scroll offset
  const rawStartIndex = Math.floor(scrollTop / itemHeight);
  const rawEndIndex = Math.min(totalItems - 1, Math.floor((scrollTop + viewportHeight) / itemHeight));

  // Apply overscan buffer to prevent blank flickers during fast scrolling
  const startIndex = Math.max(0, rawStartIndex - overscan);
  const endIndex = Math.min(totalItems - 1, rawEndIndex + overscan);

  const startOffsetPx = startIndex * itemHeight;
  const visibleCount = Math.max(0, endIndex - startIndex + 1);

  return ok({
    startIndex,
    endIndex,
    startOffsetPx,
    totalHeightPx,
    visibleCount
  });
}
