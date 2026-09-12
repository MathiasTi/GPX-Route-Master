/**
 * Safe Time and Timestamp Utilities
 * 
 * Provides robust, type-safe conversions between Date instances, ISO strings,
 * and epoch millisecond timestamps, preventing runtime crashes from calling .getTime()
 * on raw string representations loaded from JSON or storage.
 */

/**
 * Safely extracts epoch milliseconds from a Date, ISO string, or numeric timestamp.
 * Returns undefined if the input is missing, invalid, or produces NaN.
 */
export function toValidTimestampMs(
  time: Date | string | number | undefined | null
): number | undefined {
  if (time === undefined || time === null || time === '') {
    return undefined;
  }

  if (typeof time === 'number') {
    return isNaN(time) || !isFinite(time) ? undefined : time;
  }

  if (time instanceof Date) {
    const ms = time.getTime();
    return isNaN(ms) ? undefined : ms;
  }

  if (typeof time === 'string') {
    const parsed = Date.parse(time);
    return isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
}

/**
 * Safely converts an input into a valid Date object, or undefined if invalid.
 */
export function toValidDate(
  time: Date | string | number | undefined | null
): Date | undefined {
  const ms = toValidTimestampMs(time);
  return ms !== undefined ? new Date(ms) : undefined;
}

/**
 * Safely calculates the elapsed seconds between two timestamps.
 * Returns undefined if either timestamp is invalid or if the delta is negative.
 * If maxAllowedGapSec is provided and delta exceeds it, returns undefined.
 */
export function calculateTimeDeltaSec(
  tEnd: Date | string | number | undefined | null,
  tStart: Date | string | number | undefined | null,
  maxAllowedGapSec?: number
): number | undefined {
  const endMs = toValidTimestampMs(tEnd);
  const startMs = toValidTimestampMs(tStart);

  if (endMs === undefined || startMs === undefined) {
    return undefined;
  }

  const deltaSec = (endMs - startMs) / 1000;
  if (deltaSec < 0 || isNaN(deltaSec) || !isFinite(deltaSec)) {
    return undefined;
  }

  if (maxAllowedGapSec !== undefined && deltaSec > maxAllowedGapSec) {
    return undefined;
  }

  return deltaSec;
}
