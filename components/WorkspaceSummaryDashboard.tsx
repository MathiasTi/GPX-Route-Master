import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Layers,
  TrendingUp,
  TrendingDown,
  Navigation,
  Clock,
  Flame,
  Mountain,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Activity,
  Bike,
  Sparkles,
  BarChart3,
  X,
  Target
} from 'lucide-react';
import { GPXTrack, GPXPoint } from '../types';

export interface WorkspaceSummaryStats {
  totalTracks: number;
  visibleTracksCount: number;
  hiddenTracksCount: number;
  totalDistanceKm: number;
  totalAscentM: number;
  totalDescentM: number;
  netElevationM: number;
  totalDurationSeconds: number;
  formattedDuration: string;
  totalPointsCount: number;
  minElevationM: number | null;
  maxElevationM: number | null;
  avgGradientAscentMPerKm: number;
  estimatedCaloriesKcal: number;
  activityBreakdown: {
    cycling: number;
    running: number;
  };
  visibleTracks: GPXTrack[];
}

/**
 * Pure calculation function for visible tracks summary stats.
 * Enables deterministic testing and zero-overhead recalculation.
 */
export function calculateWorkspaceSummary(
  tracks: GPXTrack[],
  userWeight: number = 75,
  estimatedSpeed: number = 25
): WorkspaceSummaryStats {
  const visibleTracks = (tracks || []).filter(t => t && t.visible);
  const totalTracks = tracks ? tracks.length : 0;
  const visibleTracksCount = visibleTracks.length;
  const hiddenTracksCount = totalTracks - visibleTracksCount;

  let totalDistanceKm = 0;
  let totalAscentM = 0;
  let totalDescentM = 0;
  let totalPointsCount = 0;
  let totalDurationSeconds = 0;
  let minElevationM: number | null = null;
  let maxElevationM: number | null = null;
  let totalCalories = 0;

  let cyclingCount = 0;
  let runningCount = 0;

  for (const track of visibleTracks) {
    const dist = Math.max(0, Number(track.distance) || 0);
    const asc = Math.max(0, Math.round(Number(track.ascent) || 0));
    const desc = Math.max(0, Math.round(Number(track.descent) || 0));

    totalDistanceKm += dist;
    totalAscentM += asc;
    totalDescentM += desc;

    if (track.activityType === 'running') {
      runningCount++;
    } else {
      cyclingCount++;
    }

    if (track.points && Array.isArray(track.points)) {
      totalPointsCount += track.points.length;
      for (const p of track.points) {
        if (p && typeof p.ele === 'number' && !isNaN(p.ele)) {
          if (minElevationM === null || p.ele < minElevationM) {
            minElevationM = p.ele;
          }
          if (maxElevationM === null || p.ele > maxElevationM) {
            maxElevationM = p.ele;
          }
        }
      }
    }

    // Duration calculation
    if (track.duration && track.duration > 0) {
      totalDurationSeconds += track.duration;
    } else if (dist > 0) {
      const spd = track.activityType === 'running' ? 10 : (estimatedSpeed || 25);
      totalDurationSeconds += Math.round((dist / spd) * 3600);
    }

    // Caloric expenditure estimation
    const isRunning = track.activityType === 'running';
    const baseMetabolicFactor = isRunning ? 0.95 : 0.42; // kcal per kg per km
    const climbingFactor = 0.021; // kcal per kg per 10m ascent
    const trackKcal = (dist * userWeight * baseMetabolicFactor) + ((asc / 10) * userWeight * climbingFactor);
    totalCalories += trackKcal;
  }

  // Format Duration String
  const hours = Math.floor(totalDurationSeconds / 3600);
  const minutes = Math.floor((totalDurationSeconds % 3600) / 60);
  let formattedDuration = '0 Min.';
  if (hours > 0) {
    formattedDuration = `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  } else if (minutes > 0) {
    formattedDuration = `${minutes} Min.`;
  }

  const netElevationM = totalAscentM - totalDescentM;
  const avgGradientAscentMPerKm = totalDistanceKm > 0 ? (totalAscentM / totalDistanceKm) : 0;

  return {
    totalTracks,
    visibleTracksCount,
    hiddenTracksCount,
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    totalAscentM: Math.round(totalAscentM),
    totalDescentM: Math.round(totalDescentM),
    netElevationM: Math.round(netElevationM),
    totalDurationSeconds,
    formattedDuration,
    totalPointsCount,
    minElevationM: minElevationM !== null ? Math.round(minElevationM) : null,
    maxElevationM: maxElevationM !== null ? Math.round(maxElevationM) : null,
    avgGradientAscentMPerKm: Number(avgGradientAscentMPerKm.toFixed(1)),
    estimatedCaloriesKcal: Math.round(totalCalories),
    activityBreakdown: {
      cycling: cyclingCount,
      running: runningCount
    },
    visibleTracks
  };
}

/**
 * Calculates a bounding box encompassing all points of the visible tracks.
 */
export function getVisibleTracksBoundingBox(tracks: GPXTrack[]): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} | null {
  const visible = tracks.filter(t => t.visible && t.points && t.points.length > 0);
  if (visible.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let pointCount = 0;

  for (const track of visible) {
    for (const p of track.points) {
      if (p && typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat) && !isNaN(p.lng)) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
        pointCount++;
      }
    }
  }

  if (pointCount === 0 || minLat === Infinity) return null;

  // Add 10% padding
  const latBuf = Math.max((maxLat - minLat) * 0.08, 0.005);
  const lngBuf = Math.max((maxLng - minLng) * 0.08, 0.005);

  return {
    minLat: minLat - latBuf,
    maxLat: maxLat + latBuf,
    minLng: minLng - lngBuf,
    maxLng: maxLng + lngBuf
  };
}

interface WorkspaceSummaryDashboardProps {
  tracks: GPXTrack[];
  userWeight?: number;
  estimatedSpeed?: number;
  variant?: 'sidebar' | 'map-hud' | 'modal';
  isDark?: boolean;
  markedTrackId?: string | null;
  onMarkTrack?: (trackId: string) => void;
  onToggleTrackVisibility?: (trackId: string) => void;
  onToggleAllVisibility?: (makeAllVisible: boolean) => void;
  onFitVisibleTracks?: (bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }) => void;
  onClose?: () => void;
  onOpenIntensiveAnalysis?: (trackId?: string) => void;
}

export const WorkspaceSummaryDashboard: React.FC<WorkspaceSummaryDashboardProps> = ({
  tracks,
  userWeight = 75,
  estimatedSpeed = 25,
  variant = 'sidebar',
  isDark = false,
  markedTrackId,
  onMarkTrack,
  onToggleTrackVisibility,
  onToggleAllVisibility,
  onFitVisibleTracks,
  onClose,
  onOpenIntensiveAnalysis
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showTrackBreakdown, setShowTrackBreakdown] = useState(false);
  const [isHudMinimized, setIsHudMinimized] = useState(false);

  const stats = useMemo(() => {
    return calculateWorkspaceSummary(tracks, userWeight, estimatedSpeed);
  }, [tracks, userWeight, estimatedSpeed]);

  const allVisible = stats.totalTracks > 0 && stats.visibleTracksCount === stats.totalTracks;
  const noneVisible = stats.totalTracks > 0 && stats.visibleTracksCount === 0;

  const handleFitAll = () => {
    if (!onFitVisibleTracks) return;
    const bounds = getVisibleTracksBoundingBox(tracks);
    if (bounds) {
      onFitVisibleTracks(bounds);
    }
  };

  const handleToggleAll = () => {
    if (!onToggleAllVisibility) return;
    onToggleAllVisibility(!allVisible);
  };

  if (stats.totalTracks === 0) {
    return null;
  }

  // MAP HUD VARIANT (Floating over Map)
  if (variant === 'map-hud') {
    return (
      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-[400] select-none font-sans pointer-events-auto max-w-[calc(100vw-80px)] sm:max-w-md">
        <div
          className={`rounded-2xl border shadow-xl backdrop-blur-md transition-all duration-300 overflow-hidden ${
            isDark
              ? 'bg-slate-900/90 border-slate-800 text-slate-100 shadow-slate-950/50'
              : 'bg-white/95 border-slate-200/80 text-slate-900 shadow-slate-200/60'
          }`}
        >
          {/* HUD Header Bar */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200/60 dark:border-slate-800/80 gap-2 bg-slate-50/50 dark:bg-slate-800/30">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="p-1 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <Layers className="w-3.5 h-3.5" />
              </div>
              <div className="flex items-center gap-1.5 truncate">
                <span className="text-xs font-black tracking-tight truncate">
                  Gesamtübersicht ({stats.visibleTracksCount}/{stats.totalTracks})
                </span>
                {stats.visibleTracksCount > 0 && (
                  <span className="text-[9.5px] px-1.5 py-0.5 rounded-full font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 font-mono">
                    {stats.totalDistanceKm} km
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {stats.visibleTracksCount > 0 && onFitVisibleTracks && (
                <button
                  type="button"
                  onClick={handleFitAll}
                  className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Alle sichtbaren Strecken auf der Karte zentrieren"
                >
                  <Target className="w-3.5 h-3.5" />
                </button>
              )}
              {onToggleAllVisibility && (
                <button
                  type="button"
                  onClick={handleToggleAll}
                  className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title={allVisible ? "Alle Strecken ausblenden" : "Alle Strecken einblenden"}
                >
                  {allVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsHudMinimized(!isHudMinimized)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title={isHudMinimized ? "Dashboard aufklappen" : "Dashboard minimieren"}
              >
                {isHudMinimized ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Schließen"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* HUD Content when expanded */}
          {!isHudMinimized && (
            <div className="p-3 space-y-2.5">
              {stats.visibleTracksCount === 0 ? (
                <div className="text-center py-3 text-xs text-slate-400 italic">
                  Keine Strecken sichtbar. Klicke auf{' '}
                  <button
                    type="button"
                    onClick={handleToggleAll}
                    className="underline text-indigo-500 font-bold hover:text-indigo-600"
                  >
                    Alle einblenden
                  </button>
                  .
                </div>
              ) : (
                <>
                  {/* Top 3 Combined Metrics */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <div className="p-2 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-center flex flex-col items-center">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight flex items-center gap-0.5">
                        <Navigation className="w-2.5 h-2.5 text-blue-500 shrink-0" /> Strecke
                      </span>
                      <span className="font-mono font-black text-xs sm:text-sm text-slate-800 dark:text-slate-100 mt-0.5">
                        {stats.totalDistanceKm.toLocaleString('de-DE', { minimumFractionDigits: 1 })} km
                      </span>
                    </div>

                    <div className="p-2 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100/60 dark:border-emerald-900/30 text-center flex flex-col items-center">
                      <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-tight flex items-center gap-0.5">
                        <TrendingUp className="w-2.5 h-2.5 shrink-0" /> Anstieg
                      </span>
                      <span className="font-mono font-black text-xs sm:text-sm text-emerald-600 dark:text-emerald-400 mt-0.5">
                        +{stats.totalAscentM.toLocaleString('de-DE')} m
                      </span>
                    </div>

                    <div className="p-2 rounded-xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-100/60 dark:border-rose-900/30 text-center flex flex-col items-center">
                      <span className="text-[9px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-tight flex items-center gap-0.5">
                        <TrendingDown className="w-2.5 h-2.5 shrink-0" /> Abstieg
                      </span>
                      <span className="font-mono font-black text-xs sm:text-sm text-rose-600 dark:text-rose-400 mt-0.5">
                        -{stats.totalDescentM.toLocaleString('de-DE')} m
                      </span>
                    </div>
                  </div>

                  {/* Secondary Metrics Strip */}
                  <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-slate-100/60 dark:bg-slate-800/40 text-[10px] font-mono text-slate-600 dark:text-slate-300">
                    <span className="flex items-center gap-1" title="Geschätzte oder gemessene Gesamtdauer">
                      <Clock className="w-3 h-3 text-indigo-500" />
                      {stats.formattedDuration}
                    </span>
                    {stats.maxElevationM !== null && (
                      <span className="flex items-center gap-1" title="Höchster Gipfel / Culmination Point">
                        <Mountain className="w-3 h-3 text-amber-500" />
                        Max {stats.maxElevationM}m
                      </span>
                    )}
                    <span className="flex items-center gap-1" title="Geschätzter Gesamt-Kalorienverbrauch">
                      <Flame className="w-3 h-3 text-orange-500" />
                      ~{stats.estimatedCaloriesKcal.toLocaleString('de-DE')} kcal
                    </span>
                  </div>

                  {/* Multi-Track Segmented Color Bar */}
                  {stats.visibleTracks.length > 1 && (
                    <div className="space-y-1">
                      <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden flex">
                        {stats.visibleTracks.map(t => {
                          const pct = stats.totalDistanceKm > 0 ? (t.distance / stats.totalDistanceKm) * 100 : 0;
                          return (
                            <div
                              key={t.id}
                              style={{ width: `${pct}%`, backgroundColor: t.color || '#3b82f6' }}
                              className="h-full transition-all duration-300"
                              title={`${t.name}: ${t.distance.toFixed(1)}km (${pct.toFixed(0)}%)`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // SIDEBAR / WORKSPACE CARD VARIANT (Embedded inside the sidebar above tracks)
  return (
    <div
      className={`rounded-2xl border transition-all duration-300 overflow-hidden select-none font-sans ${
        isDark
          ? 'bg-slate-900/90 border-slate-800 text-slate-100 shadow-md shadow-slate-950/40'
          : 'bg-gradient-to-b from-white to-slate-50 border-slate-200/90 text-slate-900 shadow-xs'
      }`}
      id="workspace-summary-dashboard-card"
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between p-3 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-black tracking-tight text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
              <span>Sichtbare Strecken</span>
              <span className="px-1.5 py-0.2 text-[9px] font-mono font-bold rounded-full bg-indigo-100/70 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-300">
                {stats.visibleTracksCount}/{stats.totalTracks}
              </span>
            </h3>
            <p className="text-[9.5px] text-slate-400 font-medium leading-none mt-0.5">
              Kumulierte Workspace-Gesamtsumme
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {stats.visibleTracksCount > 0 && onFitVisibleTracks && (
            <button
              type="button"
              onClick={handleFitAll}
              className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Auf alle sichtbaren Strecken zoomen"
              id="btn-fit-visible-tracks"
            >
              <Target className="w-3.5 h-3.5" />
            </button>
          )}
          {onToggleAllVisibility && (
            <button
              type="button"
              onClick={handleToggleAll}
              className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title={allVisible ? "Alle ausblenden" : "Alle einblenden"}
              id="btn-toggle-all-visibility"
            >
              {allVisible ? <Eye className="w-3.5 h-3.5 text-indigo-500" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title={isExpanded ? "Übersicht einklappen" : "Übersicht ausklappen"}
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="p-3 space-y-3">
          {stats.visibleTracksCount === 0 ? (
            <div className="text-center py-4 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
              <EyeOff className="w-5 h-5 text-slate-400 mx-auto mb-1.5 opacity-60" />
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Keine sichtbaren Strecken</p>
              <button
                type="button"
                onClick={handleToggleAll}
                className="mt-2 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 px-3 py-1 rounded-lg transition-colors cursor-pointer"
              >
                Alle Strecken einblenden
              </button>
            </div>
          ) : (
            <>
              {/* Primary Key Stats Grid */}
              <div className="grid grid-cols-3 gap-2">
                {/* Cumulative Distance */}
                <div className="p-2.5 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100/60 dark:border-blue-900/30 flex flex-col items-center text-center">
                  <span className="text-[9.5px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-tight flex items-center gap-1">
                    <Navigation className="w-3 h-3" /> Distanz
                  </span>
                  <span className="font-mono font-black text-sm text-slate-850 dark:text-slate-100 mt-1">
                    {stats.totalDistanceKm.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                    <span className="text-[10px] font-bold ml-0.5 text-slate-400">km</span>
                  </span>
                </div>

                {/* Cumulative Ascent */}
                <div className="p-2.5 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100/60 dark:border-emerald-900/30 flex flex-col items-center text-center">
                  <span className="text-[9.5px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-tight flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> Anstieg
                  </span>
                  <span className="font-mono font-black text-sm text-emerald-600 dark:text-emerald-400 mt-1">
                    +{stats.totalAscentM.toLocaleString('de-DE')}
                    <span className="text-[10px] font-bold ml-0.5">m</span>
                  </span>
                </div>

                {/* Cumulative Descent */}
                <div className="p-2.5 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100/60 dark:border-rose-900/30 flex flex-col items-center text-center">
                  <span className="text-[9.5px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-tight flex items-center gap-1">
                    <TrendingDown className="w-3 h-3" /> Abstieg
                  </span>
                  <span className="font-mono font-black text-sm text-rose-600 dark:text-rose-400 mt-1">
                    -{stats.totalDescentM.toLocaleString('de-DE')}
                    <span className="text-[10px] font-bold ml-0.5">m</span>
                  </span>
                </div>
              </div>

              {/* Extended Secondary Metrics */}
              <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between font-mono">
                  <span className="text-slate-400 flex items-center gap-1 font-sans">
                    <Clock className="w-3 h-3 text-indigo-500" /> Zeit (ca.)
                  </span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">
                    {stats.formattedDuration}
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between font-mono">
                  <span className="text-slate-400 flex items-center gap-1 font-sans">
                    <Flame className="w-3 h-3 text-orange-500" /> Energie
                  </span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">
                    ~{stats.estimatedCaloriesKcal.toLocaleString('de-DE')} kcal
                  </span>
                </div>

                {stats.maxElevationM !== null && (
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between font-mono">
                    <span className="text-slate-400 flex items-center gap-1 font-sans">
                      <Mountain className="w-3 h-3 text-amber-500" /> Gipfel/Höhe
                    </span>
                    <span className="font-bold text-slate-700 dark:text-slate-200">
                      {stats.minElevationM}m – {stats.maxElevationM}m
                    </span>
                  </div>
                )}

                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between font-mono">
                  <span className="text-slate-400 flex items-center gap-1 font-sans">
                    <BarChart3 className="w-3 h-3 text-purple-500" /> Steigquote
                  </span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">
                    {stats.avgGradientAscentMPerKm} m/km
                  </span>
                </div>
              </div>

              {/* Segmented Color Track Proportion Bar */}
              {stats.visibleTracks.length > 1 && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between items-center text-[9.5px] text-slate-400 font-bold uppercase tracking-wider">
                    <span>Streckenanteile ({stats.visibleTracks.length})</span>
                    <button
                      type="button"
                      onClick={() => setShowTrackBreakdown(!showTrackBreakdown)}
                      className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5 cursor-pointer lowercase"
                    >
                      {showTrackBreakdown ? 'weniger' : 'aufschlüsseln'}
                    </button>
                  </div>

                  <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
                    {stats.visibleTracks.map(track => {
                      const pct = stats.totalDistanceKm > 0 ? (track.distance / stats.totalDistanceKm) * 100 : 0;
                      const isMarked = markedTrackId === track.id;
                      return (
                        <div
                          key={track.id}
                          onClick={() => onMarkTrack?.(track.id)}
                          style={{
                            width: `${pct}%`,
                            backgroundColor: track.color || '#3b82f6'
                          }}
                          className={`h-full transition-all duration-200 cursor-pointer hover:opacity-80 ${
                            isMarked ? 'ring-1 ring-white dark:ring-slate-900 z-10' : ''
                          }`}
                          title={`${track.name}: ${track.distance.toFixed(1)} km (${pct.toFixed(0)}%) – Klicken zum Markieren`}
                        />
                      );
                    })}
                  </div>

                  {/* Individual Breakdown List */}
                  {showTrackBreakdown && (
                    <div className="space-y-1 pt-1 max-h-36 overflow-y-auto pr-1">
                      {stats.visibleTracks.map(track => {
                        const isMarked = markedTrackId === track.id;
                        return (
                          <div
                            key={track.id}
                            onClick={() => onMarkTrack?.(track.id)}
                            className={`flex items-center justify-between p-1.5 rounded-lg text-[10.5px] transition-all cursor-pointer ${
                              isMarked
                                ? 'bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/80 font-bold'
                                : 'hover:bg-slate-100/70 dark:hover:bg-slate-800/50 border border-transparent'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs"
                                style={{ backgroundColor: track.color || '#3b82f6' }}
                              />
                              <span className="truncate max-w-[130px] text-slate-800 dark:text-slate-200">
                                {track.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 font-mono text-[10px] shrink-0">
                              <span className="text-slate-600 dark:text-slate-400">
                                {track.distance.toFixed(1)} km
                              </span>
                              <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                +{Math.round(track.ascent)}m
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkspaceSummaryDashboard;
