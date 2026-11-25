import React from 'react';
import {
  AlertTriangle,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  Crosshair,
  Flag,
  LocateFixed,
  Navigation,
  Square,
  Sun,
  TrendingUp,
  Undo2,
  Loader2
} from 'lucide-react';
import type { RouteTurnDirection } from '../../types';
import type { LiveGpsFix, LiveTrackProgress } from '../../utils/liveNavigation';
import { formatTurnDistance, formatTurnInstruction } from '../../utils/liveNavigation';
import { formatRoutePacePerKm } from '../../utils/routePlanner';
import { triggerHaptic } from '../../utils/haptics';

export interface LiveNavigationHUDProps {
  trackName: string;
  activityType?: 'cycling' | 'running';
  gpsStatus: 'acquiring' | 'active' | 'denied' | 'unavailable';
  gpsError: string | null;
  gpsFix: LiveGpsFix | null;
  progress: LiveTrackProgress | null;
  isAutoCenter: boolean;
  onToggleAutoCenter: () => void;
  isWakeLockActive: boolean;
  onStop: () => void;
  language?: 'de' | 'en';
  bottomOffsetClass?: string;
}

const TurnDirectionIcon: React.FC<{ direction: RouteTurnDirection; className?: string }> = ({
  direction,
  className = 'w-6 h-6'
}) => {
  switch (direction) {
    case 'left':
    case 'slight-left':
    case 'sharp-left':
      return <CornerUpLeft className={className} />;
    case 'right':
    case 'slight-right':
    case 'sharp-right':
      return <CornerUpRight className={className} />;
    case 'uturn':
      return <Undo2 className={className} />;
    case 'arrive':
      return <Flag className={className} />;
    case 'start':
      return <Navigation className={className} />;
    default:
      return <ArrowUp className={className} />;
  }
};

export const LiveNavigationHUD: React.FC<LiveNavigationHUDProps> = React.memo(({
  trackName,
  activityType = 'cycling',
  gpsStatus,
  gpsError,
  gpsFix,
  progress,
  isAutoCenter,
  onToggleAutoCenter,
  isWakeLockActive,
  onStop,
  language = 'de',
  bottomOffsetClass = 'bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-4'
}) => {
  const isEn = language === 'en';
  const nextTurn = progress?.nextTurn ?? null;
  const isOffRoute = Boolean(progress?.isOffRoute);

  const liveSpeedKmh =
    gpsFix && typeof gpsFix.speedKmh === 'number' && Number.isFinite(gpsFix.speedKmh) && gpsFix.speedKmh >= 0.5
      ? gpsFix.speedKmh
      : null;

  const tempoDisplay =
    liveSpeedKmh === null
      ? activityType === 'running'
        ? '--:-- /km'
        : '0.0 km/h'
      : activityType === 'running'
      ? formatRoutePacePerKm(liveSpeedKmh)
      : `${liveSpeedKmh.toFixed(1)} km/h`;

  return (
    <>
      {/* Top Turn-by-Turn & Off-Route Banner */}
      <div
        id="live-nav-top-banner"
        role="region"
        aria-label={isEn ? 'Live turn-by-turn guidance' : 'Live-Abbiegehinweise'}
        className="absolute top-2 left-14 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[400px] z-[470] flex flex-col gap-1.5 pointer-events-none select-none map-overlay-layer"
      >
        {/* Main Next-Turn / GPS Status Card */}
        <div className="pointer-events-auto bg-white/98 dark:bg-slate-900/98 lg:backdrop-blur-md border border-slate-200/90 dark:border-slate-700/90 rounded-2xl shadow-xl px-3 py-2.5 text-slate-900 dark:text-slate-100">
          {gpsStatus === 'denied' || gpsStatus === 'unavailable' ? (
            <div className="flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-rose-700 dark:text-rose-300">
                  {gpsStatus === 'denied'
                    ? isEn
                      ? 'GPS permission denied'
                      : 'GPS-Zugriff verweigert'
                    : isEn
                    ? 'GPS unavailable on this device'
                    : 'GPS auf diesem Gerät nicht verfügbar'}
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug mt-0.5">
                  {gpsError ||
                    (isEn
                      ? 'Allow location access in browser settings to follow this track live.'
                      : 'Erlaube den Standortzugriff im Browser, um dem Track live zu folgen.')}
                </p>
              </div>
            </div>
          ) : gpsStatus === 'acquiring' || !progress ? (
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                  {isEn ? 'Acquiring GPS signal…' : 'Suche GPS-Signal…'}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {trackName}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-indigo-600 dark:bg-indigo-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                <TurnDirectionIcon
                  direction={nextTurn ? nextTurn.cue.direction : 'straight'}
                  className="w-6 h-6"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-black font-mono tabular-nums tracking-tight text-slate-950 dark:text-white leading-none">
                    {nextTurn ? formatTurnDistance(nextTurn.distanceToTurnM) : '—'}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                    {nextTurn?.cue.streetName || trackName}
                  </span>
                </div>
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate mt-1">
                  {nextTurn
                    ? nextTurn.cue.instruction ||
                      formatTurnInstruction(nextTurn.cue.direction, language)
                    : isEn
                    ? 'Follow the highlighted route'
                    : 'Der markierten Route folgen'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Off-Route Alert Banner (Icon + Text + High Contrast, never color-only) */}
        {isOffRoute && progress && (
          <div
            id="live-nav-off-route-banner"
            role="alert"
            className="pointer-events-auto flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-amber-500 dark:bg-amber-600 text-slate-950 dark:text-white shadow-lg border border-amber-600/40 dark:border-amber-400/40"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="text-xs font-extrabold truncate">
                {isEn
                  ? `Off route · ${progress.distanceToTrackM} m from track`
                  : `Abseits der Route · ${progress.distanceToTrackM} m vom Track`}
              </span>
            </div>
            <span className="text-[11px] font-mono tabular-nums font-bold shrink-0">
              {progress.bearingBackToTrackDeg}°
            </span>
          </div>
        )}
      </div>

      {/* Bottom Live Telemetry & Controls Strip */}
      <div
        id="live-nav-bottom-bar"
        role="region"
        aria-label={isEn ? 'Live navigation telemetry and controls' : 'Live-Navigation Daten und Steuerung'}
        className={`absolute ${bottomOffsetClass} left-2 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[420px] z-[470] bg-white/98 dark:bg-slate-900/98 lg:backdrop-blur-md border border-slate-200/90 dark:border-slate-700/90 rounded-2xl shadow-2xl px-3 py-2 text-slate-900 dark:text-slate-100 pointer-events-auto select-none map-overlay-layer`}
      >
        <div className="flex items-center justify-between gap-2">
          {/* Unboxed Tabular Remaining Telemetry */}
          <div className="min-w-0 flex-1 flex flex-col">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono tabular-nums text-slate-800 dark:text-slate-100">
              <span className="font-black text-sm text-slate-950 dark:text-white">
                {progress ? `${progress.distanceRemainingKm.toFixed(1)} km` : '— km'}
              </span>
              <span className="text-[10px] font-sans font-semibold text-slate-500 dark:text-slate-400">
                {isEn ? 'left' : 'Rest'}
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
              <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400 font-bold">
                <TrendingUp className="w-3 h-3 shrink-0" />
                +{progress ? progress.ascentRemainingM : 0} m
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {tempoDisplay}
              </span>
            </div>

            <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
              {/* Thin Progress Bar */}
              <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-600 dark:bg-indigo-400 transition-all duration-300"
                  style={{ width: `${Math.max(2, progress?.progressPct ?? 0)}%` }}
                />
              </div>
              <span className="font-mono tabular-nums font-semibold shrink-0">
                {progress ? `${Math.round(progress.progressPct)}%` : '0%'}
              </span>
              {isWakeLockActive && (
                <span
                  className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 font-semibold shrink-0"
                  title={isEn ? 'Screen kept awake' : 'Display bleibt aktiv'}
                >
                  <Sun className="w-3 h-3" />
                  <span className="hidden xs:inline">{isEn ? 'Awake' : 'Wach'}</span>
                </span>
              )}
            </div>
          </div>

          {/* 44x44px Touch Actions: Auto-Center + Stop */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              id="btn-live-nav-autocenter"
              type="button"
              onClick={() => {
                triggerHaptic('light');
                onToggleAutoCenter();
              }}
              aria-pressed={isAutoCenter}
              aria-label={isEn ? 'Toggle GPS auto-center' : 'GPS Auto-Zentrierung umschalten'}
              title={
                isAutoCenter
                  ? isEn
                    ? 'Auto-center active'
                    : 'Auto-Zentrierung aktiv'
                  : isEn
                  ? 'Re-center on GPS'
                  : 'Auf GPS zentrieren'
              }
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border transition-colors cursor-pointer touch-manipulation active:scale-95 ${
                isAutoCenter
                  ? 'bg-indigo-600 text-white border-indigo-500 hover:bg-indigo-700 shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {isAutoCenter ? <LocateFixed className="w-5 h-5" /> : <Crosshair className="w-5 h-5" />}
            </button>

            <button
              id="btn-live-nav-stop"
              type="button"
              onClick={() => {
                triggerHaptic('medium');
                onStop();
              }}
              aria-label={isEn ? 'Stop live navigation' : 'Live-Navigation beenden'}
              title={isEn ? 'Stop navigation' : 'Navigation beenden'}
              className="min-h-[44px] px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer touch-manipulation active:scale-95"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>{isEn ? 'Stop' : 'Stopp'}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
});
