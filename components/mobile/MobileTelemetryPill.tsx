import React, { useMemo } from 'react';
import { GPXPoint, GPXTrack } from '../../types';
import { computeHoverPointTelemetry } from '../../domain/telemetry/pointMetricsEngine';
import { X } from 'lucide-react';
import { triggerHaptic } from '../../utils/haptics';

export interface MobileTelemetryPillProps {
  hoveredPoint: GPXPoint | null;
  trackColor?: string;
  userMaxHr?: number;
  tracks?: GPXTrack[];
  onClose: () => void;
}

export const MobileTelemetryPill: React.FC<MobileTelemetryPillProps> = React.memo(({
  hoveredPoint,
  trackColor = '#3b82f6',
  userMaxHr = 190,
  tracks,
  onClose
}) => {
  const telemetry = useMemo(() => {
    if (!hoveredPoint) return null;

    let surroundingPts: readonly GPXPoint[] | undefined = undefined;
    const matchTrack = (hoveredPoint as any).trackId
      ? tracks?.find(t => t.id === (hoveredPoint as any).trackId)
      : tracks?.find(
          t =>
            t.points &&
            t.points.some(
              p =>
                Math.abs(p.lat - hoveredPoint.lat) < 0.0001 &&
                Math.abs(p.lng - hoveredPoint.lng) < 0.0001
            )
        );

    if (matchTrack) {
      surroundingPts = matchTrack.points;
    }

    const isFit = Boolean(
      matchTrack?.rawFileDetails?.fileType === 'fit' ||
        matchTrack?.originalFilename?.toLowerCase().endsWith('.fit') ||
        matchTrack?.rawFileDetails?.fileName?.toLowerCase().endsWith('.fit') ||
        matchTrack?.name?.toLowerCase().endsWith('.fit') ||
        matchTrack?.id?.startsWith('fit-')
    );

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
      {
        maxHr: userMaxHr,
        isFitFile: isFit,
        activityType: matchTrack?.activityType
      }
    );
    return result.success ? result.data : null;
  }, [hoveredPoint, userMaxHr, tracks]);

  if (!hoveredPoint || !telemetry) {
    return null;
  }

  const paceOrSpeedLabel =
    telemetry.isFitFile || telemetry.activityType === 'running' ? 'Pace' : 'Tempo';
  const paceOrSpeedVal =
    (telemetry.isFitFile || telemetry.activityType === 'running') && telemetry.paceFormatted
      ? telemetry.paceFormatted
      : telemetry.speedKmh !== null && telemetry.speedKmh > 0
      ? `${telemetry.speedKmh.toFixed(1)} km/h`
      : '--';

  return (
    <div
      id="mobile-telemetry-pill"
      aria-label="Punkt-Telemetrie"
      className="lg:hidden fixed top-[calc(env(safe-area-inset-top,0px)+3.75rem)] left-3 right-3 z-[1050] bg-white/98 dark:bg-slate-900/98 border border-slate-200/90 dark:border-slate-700/90 rounded-2xl shadow-xl px-3 py-2 text-slate-900 dark:text-slate-100 mobile-contain"
    >
      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0 text-xs">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: trackColor }}
          />
          <span className="font-bold text-slate-800 dark:text-slate-100 truncate">
            Punkt-Telemetrie
          </span>
          {hoveredPoint.dist !== undefined && (
            <>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
              <span className="font-mono tabular-nums text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0">
                {(hoveredPoint.dist / 1000).toFixed(2)} km
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          aria-label="Telemetrie schließen"
          onClick={() => {
            triggerHaptic('light');
            onClose();
          }}
          className="min-h-[44px] min-w-[44px] -my-2 -mr-2 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-colors touch-manipulation cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2 pt-2 text-center font-mono tabular-nums">
        <div className="flex flex-col items-center">
          <span className="font-sans text-[10px] font-medium text-slate-500 dark:text-slate-400">
            Höhe
          </span>
          <span className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            {telemetry.elevationM !== null ? `${Math.round(telemetry.elevationM)} m` : '--'}
          </span>
        </div>

        <div className="flex flex-col items-center border-l border-slate-100 dark:border-slate-800 pl-1">
          <span className="font-sans text-[10px] font-medium text-slate-500 dark:text-slate-400">
            Steigung
          </span>
          <span
            className="text-xs font-bold mt-0.5"
            style={{ color: telemetry.slope.colorHex }}
          >
            {telemetry.slope.arrow} {telemetry.slope.formatted}
          </span>
        </div>

        <div className="flex flex-col items-center border-l border-slate-100 dark:border-slate-800 pl-1">
          <span className="font-sans text-[10px] font-medium text-slate-500 dark:text-slate-400">
            {telemetry.heartRate
              ? `Puls ${telemetry.heartRate.label}`
              : telemetry.powerWatts !== null
              ? 'Power'
              : 'Puls'}
          </span>
          <span className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            {telemetry.heartRate
              ? `${telemetry.heartRate.bpm} bpm`
              : telemetry.powerWatts !== null
              ? `${telemetry.powerWatts} W`
              : '--'}
          </span>
        </div>

        <div className="flex flex-col items-center border-l border-slate-100 dark:border-slate-800 pl-1">
          <span className="font-sans text-[10px] font-medium text-slate-500 dark:text-slate-400">
            {paceOrSpeedLabel}
          </span>
          <span className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            {paceOrSpeedVal}
          </span>
        </div>
      </div>
    </div>
  );
});
