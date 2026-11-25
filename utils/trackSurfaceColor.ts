import type { GPXTrack } from '../types';
import { normalizeSurfaceLabel, type SurfaceCategory } from './surfaceAnalyzer';

export type KnownSurfaceCategory = Exclude<SurfaceCategory, 'Unbekannt'>;

export interface PrimarySurfaceInfo {
  surfaceType: KnownSurfaceCategory;
  color: string;
  /** Share of known surface distance/points (0..100). */
  percentage: number;
  /** Share of total track distance/points including unknown (0..100). */
  totalSharePct: number;
  source: 'stats' | 'points';
}

export interface SidebarTrackColorResolution {
  color: string;
  primarySurface: PrimarySurfaceInfo | null;
  isSurfaceColored: boolean;
}

/**
 * Semantic surface color palette:
 * - Paved roads / cycleways -> Green
 * - Gravel / unpaved -> Orange
 * - Forest trails -> Teal
 * - Cobblestone -> Violet
 * - Unknown -> Neutral slate
 */
export const SURFACE_COLOR_PALETTE: Record<SurfaceCategory, string> = {
  Asphalt: '#16a34a',          // Green (paved)
  Fahrradweg: '#10b981',       // Emerald green (paved cycleway)
  Schotter: '#f97316',         // Orange (gravel)
  Unbefestigt: '#ea580c',      // Deep orange (unpaved / dirt)
  Waldweg: '#0d9488',          // Teal (forest trail)
  Kopfsteinpflaster: '#8b5cf6', // Violet (cobblestone)
  Unbekannt: '#94a3b8'         // Slate (unknown)
};

export const SURFACE_COLOR_LEGEND: ReadonlyArray<{
  surfaceType: KnownSurfaceCategory;
  color: string;
}> = [
  { surfaceType: 'Asphalt', color: SURFACE_COLOR_PALETTE.Asphalt },
  { surfaceType: 'Fahrradweg', color: SURFACE_COLOR_PALETTE.Fahrradweg },
  { surfaceType: 'Schotter', color: SURFACE_COLOR_PALETTE.Schotter },
  { surfaceType: 'Unbefestigt', color: SURFACE_COLOR_PALETTE.Unbefestigt },
  { surfaceType: 'Waldweg', color: SURFACE_COLOR_PALETTE.Waldweg },
  { surfaceType: 'Kopfsteinpflaster', color: SURFACE_COLOR_PALETTE.Kopfsteinpflaster }
];

/**
 * Returns the semantic hex color for any raw or normalized surface label.
 */
export function getSurfaceTypeColor(rawSurface?: string | null): string {
  const normalized = normalizeSurfaceLabel(rawSurface);
  return SURFACE_COLOR_PALETTE[normalized] || SURFACE_COLOR_PALETTE.Unbekannt;
}

/**
 * Determines the dominant (primary) known surface type of a track.
 * Checks `track.surfaceStats` first (ignoring 'Unbekannt' whenever known surface data exists),
 * and falls back to point-level `point.surface` annotations when `surfaceStats` is missing.
 * Returns `null` when no known surface metadata is present.
 */
export function getPrimarySurfaceInfo(
  track: Pick<GPXTrack, 'surfaceStats' | 'points' | 'distance'>
): PrimarySurfaceInfo | null {
  // 1. Prefer precomputed distance-weighted surfaceStats
  if (Array.isArray(track.surfaceStats) && track.surfaceStats.length > 0) {
    const knownByCategory = new Map<KnownSurfaceCategory, number>();
    let totalDist = 0;
    let knownDist = 0;

    for (const stat of track.surfaceStats) {
      const dist = Number(stat?.distance);
      if (!Number.isFinite(dist) || dist <= 0) continue;
      totalDist += dist;
      const normalized = normalizeSurfaceLabel(stat?.type);
      if (normalized === 'Unbekannt') continue;
      knownDist += dist;
      knownByCategory.set(normalized, (knownByCategory.get(normalized) || 0) + dist);
    }

    if (knownByCategory.size > 0 && knownDist > 0) {
      let bestType: KnownSurfaceCategory | null = null;
      let bestDist = -1;
      for (const [category, dist] of knownByCategory.entries()) {
        if (dist > bestDist) {
          bestDist = dist;
          bestType = category;
        }
      }
      if (bestType) {
        const denominatorTotal = totalDist > 0 ? totalDist : knownDist;
        return {
          surfaceType: bestType,
          color: SURFACE_COLOR_PALETTE[bestType],
          percentage: Math.max(1, Math.min(100, Math.round((bestDist / knownDist) * 100))),
          totalSharePct: Math.max(1, Math.min(100, Math.round((bestDist / denominatorTotal) * 100))),
          source: 'stats'
        };
      }
    }
  }

  // 2. Fallback: scan point-level surface tags when surfaceStats isn't populated
  if (Array.isArray(track.points) && track.points.length > 0) {
    const knownCounts = new Map<KnownSurfaceCategory, number>();
    let knownTotal = 0;

    for (let i = 0; i < track.points.length; i++) {
      const rawSurface = track.points[i]?.surface;
      if (!rawSurface) continue;
      const normalized = normalizeSurfaceLabel(rawSurface);
      if (normalized === 'Unbekannt') continue;
      knownTotal++;
      knownCounts.set(normalized, (knownCounts.get(normalized) || 0) + 1);
    }

    if (knownCounts.size > 0 && knownTotal > 0) {
      let bestType: KnownSurfaceCategory | null = null;
      let bestCount = -1;
      for (const [category, count] of knownCounts.entries()) {
        if (count > bestCount) {
          bestCount = count;
          bestType = category;
        }
      }
      if (bestType) {
        return {
          surfaceType: bestType,
          color: SURFACE_COLOR_PALETTE[bestType],
          percentage: Math.max(1, Math.min(100, Math.round((bestCount / knownTotal) * 100))),
          totalSharePct: Math.max(
            1,
            Math.min(100, Math.round((bestCount / track.points.length) * 100))
          ),
          source: 'points'
        };
      }
    }
  }

  return null;
}

/**
 * Resolves the display color for a track item in the sidebar list.
 * Priority:
 *  1. Active map-comparison A/B marker colors
 *  2. Primary surface color (when autoColorBySurface is enabled and surface data is available)
 *  3. Original track palette color fallback
 */
export function resolveSidebarTrackColor(
  track: Pick<GPXTrack, 'color' | 'surfaceStats' | 'points' | 'distance'>,
  options: {
    autoColorBySurface: boolean;
    isMapComparing?: boolean;
    isMarked?: boolean;
    isCompared?: boolean;
  }
): SidebarTrackColorResolution {
  const primarySurface = getPrimarySurfaceInfo(track);

  if (options.isMapComparing && options.isMarked) {
    return {
      color: '#2563eb',
      primarySurface,
      isSurfaceColored: false
    };
  }

  if (options.isMapComparing && options.isCompared) {
    return {
      color: '#f97316',
      primarySurface,
      isSurfaceColored: false
    };
  }

  if (options.autoColorBySurface && primarySurface) {
    return {
      color: primarySurface.color,
      primarySurface,
      isSurfaceColored: true
    };
  }

  return {
    color: track.color || '#3b82f6',
    primarySurface,
    isSurfaceColored: false
  };
}
