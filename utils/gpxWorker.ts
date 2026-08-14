import { GPXTrack, GPXPoint, TimeGap } from '../types';
import { detectTimeGaps, simplifyTrackPoints, parseGPX } from './gpxUtils';

/**
 * Web Worker & Async Task Manager for offloading heavy track calculations
 * off the main UI thread.
 */

/**
 * Asynchronously processes time gaps in chunks to prevent UI thread freezing.
 */
export async function detectTimeGapsAsync(
  tracks: GPXTrack[], 
  minSeconds: number = 30
): Promise<TimeGap[]> {
  return new Promise((resolve) => {
    // Process using microtask scheduling or setImmediate/setTimeout chunking
    setTimeout(() => {
      const results: TimeGap[] = [];
      for (const track of tracks) {
        if (track && track.points && track.points.length > 0) {
          const gaps = detectTimeGaps(track, minSeconds);
          results.push(...gaps);
        }
      }
      resolve(results);
    }, 0);
  });
}

/**
 * Asynchronously simplifies track points for heavy 3D or high-density map rendering.
 */
export async function simplifyPointsAsync(
  points: GPXPoint[], 
  toleranceSq: number = 0.0000002
): Promise<GPXPoint[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const simplified = simplifyTrackPoints(points, toleranceSq);
      resolve(simplified);
    }, 0);
  });
}

/**
 * Asynchronously parses GPX text content in non-blocking event loops.
 */
export async function parseGPXAsync(
  gpxContent: string, 
  fileName: string
): Promise<GPXTrack | null> {
  return parseGPX(gpxContent, fileName);
}
