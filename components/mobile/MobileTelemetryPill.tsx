import React, { useMemo } from 'react';
import { GPXPoint, GPXTrack } from '../../types';
import { computeHoverPointTelemetry } from '../../domain/telemetry/pointMetricsEngine';
import { X, Heart, Zap, Gauge, Mountain } from 'lucide-react';
import { triggerHaptic } from '../../utils/haptics';

export interface MobileTelemetryPillProps {
  hoveredPoint: GPXPoint | null;
  trackColor?: string;
  userMaxHr?: number;
  tracks?: GPXTrack[];
  onClose: () => void;
}

export const MobileTelemetryPill: React.FC<MobileTelemetryPillProps> = ({
  hoveredPoint,
  trackColor = '#3b82f6',
  userMaxHr = 190,
  tracks,
  onClose
}) => {
  const telemetry = useMemo(() => {
    if (!hoveredPoint) return null;

    let surroundingPts: readonly GPXPoint[] | undefined = undefined;
    if (hoveredPoint.slope === undefined && tracks && tracks.length > 0) {
      const matchTrack = (hoveredPoint as any).trackId
        ? tracks.find(t => t.id === (hoveredPoint as any).trackId)
        : tracks.find(t => t.points && t.points.some(p => Math.abs(p.lat - hoveredPoint.lat) < 0.0001 && Math.abs(p.lng - hoveredPoint.lng) < 0.0001));
      if (matchTrack) {
        surroundingPts = matchTrack.points;
      }
    }

    const result = computeHoverPointTelemetry(
      {
        lat: hoveredPoint.lat,
        lng: hoveredPoint.lng,
        ele: hoveredPoint.ele,
        time: hoveredPoint.time,
        hr: hoveredPoint.hr,
        power: hoveredPoint.power,
        speed: hoveredPoint.speed,
        cadence: hoveredPoint.cadence,
        slope: hoveredPoint.slope,
        dist: hoveredPoint.dist
      },
      surroundingPts,
      { maxHr: userMaxHr }
    );
    return result.success ? result.data : null;
  }, [hoveredPoint, userMaxHr, tracks]);

  if (!hoveredPoint || !telemetry) {
    return null;
  }

  return (
    <div
      id="mobile-telemetry-pill"
      aria-label="Punkt-Telemetrie"
      className="sm:hidden fixed top-[calc(env(safe-area-inset-top,0px)+3.75rem)] left-3 right-3 z-[1050] bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl px-3 py-2 text-white animate-in fade-in slide-in-from-top-2 duration-200"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <div
            className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm ring-1 ring-white/30"
            style={{ backgroundColor: trackColor }}
          />
          <span className="text-[11px] font-black text-slate-200 tracking-tight">
            Punkt-Telemetrie
          </span>
          {hoveredPoint.dist !== undefined && (
            <span className="text-[10.5px] font-semibold text-slate-400">
              bei {(hoveredPoint.dist / 1000).toFixed(2)} km
            </span>
          )}
        </div>

        <button
          type="button"
          aria-label="Telemetrie schließen"
          onClick={() => {
            triggerHaptic('light');
            onClose();
          }}
          className="min-h-[32px] min-w-[32px] flex items-center justify-center p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all touch-manipulation"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1.5 text-center">
        {/* Höhe */}
        <div className="flex flex-col items-center justify-center bg-white/5 rounded-xl py-1 px-1 border border-white/5">
          <div className="flex items-center gap-0.5 text-[10px] text-slate-400 font-medium">
            <Mountain size={11} className="text-sky-400" />
            <span>Höhe</span>
          </div>
          <span className="text-xs font-black text-slate-100 mt-0.5">
            {telemetry.elevationM !== null ? `${Math.round(telemetry.elevationM)} m` : '--'}
          </span>
        </div>

        {/* Steigung */}
        <div
          className="flex flex-col items-center justify-center rounded-xl py-1 px-1 border"
          style={{
            backgroundColor: `${telemetry.slope.colorHex}20`,
            borderColor: `${telemetry.slope.colorHex}40`
          }}
        >
          <div className="text-[10px] font-medium" style={{ color: telemetry.slope.colorHex }}>
            <span>{telemetry.slope.arrow} Steigung</span>
          </div>
          <span
            className="text-xs font-black mt-0.5"
            style={{ color: telemetry.slope.colorHex }}
          >
            {telemetry.slope.formatted}
          </span>
        </div>

        {/* Puls oder Watt */}
        {telemetry.heartRate ? (
          <div
            className="flex flex-col items-center justify-center rounded-xl py-1 px-1 border"
            style={{
              backgroundColor: `${telemetry.heartRate.colorHex}20`,
              borderColor: `${telemetry.heartRate.colorHex}40`
            }}
          >
            <div className="flex items-center gap-0.5 text-[10px] font-medium text-rose-300">
              <Heart size={11} className="text-rose-400 fill-rose-400/40" />
              <span>{telemetry.heartRate.label}</span>
            </div>
            <span className="text-xs font-black text-white mt-0.5">
              {telemetry.heartRate.bpm} bpm
            </span>
          </div>
        ) : telemetry.powerWatts !== null ? (
          <div className="flex flex-col items-center justify-center bg-amber-500/15 border border-amber-500/30 rounded-xl py-1 px-1">
            <div className="flex items-center gap-0.5 text-[10px] font-medium text-amber-300">
              <Zap size={11} className="text-amber-400 fill-amber-400/40" />
              <span>Power</span>
            </div>
            <span className="text-xs font-black text-amber-100 mt-0.5">
              {telemetry.powerWatts} W
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center bg-white/5 rounded-xl py-1 px-1 border border-white/5">
            <div className="flex items-center gap-0.5 text-[10px] text-slate-400 font-medium">
              <Gauge size={11} className="text-slate-400" />
              <span>Puls</span>
            </div>
            <span className="text-xs font-medium text-slate-500 mt-0.5">--</span>
          </div>
        )}

        {/* Tempo / Geschwindigkeit */}
        <div className="flex flex-col items-center justify-center bg-white/5 rounded-xl py-1 px-1 border border-white/5">
          <div className="flex items-center gap-0.5 text-[10px] text-slate-400 font-medium">
            <Gauge size={11} className="text-emerald-400" />
            <span>Tempo</span>
          </div>
          <span className="text-xs font-black text-slate-100 mt-0.5">
            {telemetry.speedKmh !== null && telemetry.speedKmh > 0
              ? `${telemetry.speedKmh.toFixed(1)} km/h`
              : '--'}
          </span>
        </div>
      </div>
    </div>
  );
};
