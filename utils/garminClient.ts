import { GPXTrack } from '../types';
import { apiFetch, getApiUrl } from './api';
import { hydrateGarminActivityPayload, isTwoPointSeedStub } from './activityHydration';
import { getSessionGarminKey } from './garminSessionKey';

/**
 * Checks whether a raw Garmin `points_json` payload is empty, single-point,
 * or a 2-point straight-line seed stub lacking real route telemetry.
 */
export function isGarminPointsStubOrEmpty(pointsJson: unknown, distanceKm: number): boolean {
  if (!pointsJson) return true;
  try {
    const parsed = typeof pointsJson === 'string' ? JSON.parse(pointsJson) : pointsJson;
    if (!Array.isArray(parsed) || parsed.length <= 1) return true;
    return isTwoPointSeedStub(parsed, distanceKm);
  } catch {
    return true;
  }
}

/**
 * Attempts to download and decode the full `.FIT` GPS track via Garmin Personal API
 * when a session API key is active in the current browser tab.
 */
export async function tryFetchGarminFitTrack(activityId: string): Promise<GPXTrack | null> {
  const garminKey = getSessionGarminKey();
  if (!garminKey || !activityId) return null;

  try {
    const fitRes = await apiFetch(
      getApiUrl(`/api/garmin/personal/activity/${encodeURIComponent(String(activityId))}/fit`),
      { headers: { 'x-garmin-personal-key': garminKey } }
    );
    const fitJson = await fitRes.json();
    if (fitRes.ok && fitJson.success && fitJson.track) {
      return {
        ...fitJson.track,
        points: (fitJson.track.points || []).map((pt: any) => ({
          ...pt,
          time: pt.time ? new Date(pt.time) : undefined
        }))
      } as GPXTrack;
    }
  } catch {
    // Fall back to local hydration if FIT endpoint is unavailable
  }
  return null;
}

/**
 * Hydrates a Garmin activity record for map/workspace display, automatically fetching
 * the full `.FIT` track when `points_json` is missing or only a 2-point stub.
 */
export async function resolveGarminTrackForMap(
  act: any,
  options?: { ftp?: number; userWeight?: number; estimatedSpeed?: number; allowAutoFit?: boolean }
): Promise<GPXTrack> {
  if (
    options?.allowAutoFit !== false &&
    isGarminPointsStubOrEmpty(act?.points_json, Number(act?.distance || 0))
  ) {
    const fitTrack = await tryFetchGarminFitTrack(String(act?.id || ''));
    if (fitTrack) return fitTrack;
  }

  return hydrateGarminActivityPayload(act, {
    ftp: options?.ftp,
    userWeight: options?.userWeight,
    estimatedSpeed: options?.estimatedSpeed
  });
}
