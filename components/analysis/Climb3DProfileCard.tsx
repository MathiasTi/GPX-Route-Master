import React, { useMemo, useState } from 'react';
import { GPXPoint } from '../../types';
import { calculateDistance } from '../../utils/gpxUtils';
import { IntensiveClimb } from '../../utils/intensiveAnalysis';
import { Mountain, Compass, Zap, TrendingUp } from 'lucide-react';

interface Climb3DProfileCardProps {
  climb: IntensiveClimb;
  trackPoints: GPXPoint[];
  ftp: number;
  riderWeight: number;
  onHoverSegment?: (lat: number, lng: number) => void;
}

interface ClimbSlice {
  index: number;
  startKm: number;
  endKm: number;
  lengthKm: number;
  startEle: number;
  endEle: number;
  gradePct: number;
  colorFront: string;
  colorTop: string;
  colorSide: string;
  labelColor: string;
  lat: number;
  lng: number;
}

function getSlopePalette(gradePct: number): {
  front: string;
  top: string;
  side: string;
  label: string;
} {
  if (gradePct >= 14) {
    return { front: '#991b1b', top: '#dc2626', side: '#450a0a', label: '#f87171' }; // Deep Crimson (>14%)
  }
  if (gradePct >= 10) {
    return { front: '#dc2626', top: '#ef4444', side: '#7f1d1d', label: '#ef4444' }; // Red (10-14%)
  }
  if (gradePct >= 7) {
    return { front: '#ea580c', top: '#f97316', side: '#9a3412', label: '#f97316' }; // Orange (7-10%)
  }
  if (gradePct >= 4) {
    return { front: '#d97706', top: '#f59e0b', side: '#78350f', label: '#f59e0b' }; // Amber (4-7%)
  }
  return { front: '#059669', top: '#10b981', side: '#064e3b', label: '#10b981' }; // Emerald (<4%)
}

/**
 * Veloviewer-inspired isometric 3D Climb Profile Wall ("3D-Bergprofil").
 * Slices a climb into uniform sub-segments and renders extruded 3D gradient slabs
 * with interactive hover telemetry and adjustable isometric camera projection.
 */
export const Climb3DProfileCard: React.FC<Climb3DProfileCardProps> = ({
  climb,
  trackPoints,
  ftp,
  riderWeight,
  onHoverSegment
}) => {
  const [sliceTargetCount, setSliceTargetCount] = useState<number>(18);
  const [isoAngle, setIsoAngle] = useState<'standard' | 'steep' | 'flat'>('standard');
  const [hoveredSliceIdx, setHoveredSliceIdx] = useState<number | null>(null);

  const slices = useMemo<ClimbSlice[]>(() => {
    const startIdx = Math.max(0, climb.startIndex);
    const endIdx = Math.min(trackPoints.length - 1, climb.endIndex);
    const subPoints = trackPoints.slice(startIdx, endIdx + 1);
    if (subPoints.length < 2) return [];

    // Build cumulative distance array for the climb
    const cumDists: number[] = [0];
    for (let i = 1; i < subPoints.length; i++) {
      const d = calculateDistance(subPoints[i - 1], subPoints[i]);
      cumDists.push(cumDists[i - 1] + (Number.isFinite(d) && d > 0 ? d : 0));
    }

    const totalClimbKm = Math.max(0.15, cumDists[cumDists.length - 1]);
    const numSlices = Math.max(6, Math.min(28, sliceTargetCount));
    const stepKm = totalClimbKm / numSlices;

    const interpolateAtKm = (targetKm: number): { ele: number; lat: number; lng: number } => {
      if (targetKm <= 0) {
        return { ele: subPoints[0].ele || 0, lat: subPoints[0].lat, lng: subPoints[0].lng };
      }
      if (targetKm >= totalClimbKm) {
        const last = subPoints[subPoints.length - 1];
        return { ele: last.ele || 0, lat: last.lat, lng: last.lng };
      }
      for (let i = 1; i < cumDists.length; i++) {
        if (cumDists[i] >= targetKm) {
          const d0 = cumDists[i - 1];
          const d1 = cumDists[i];
          const ratio = d1 > d0 ? (targetKm - d0) / (d1 - d0) : 0;
          const p0 = subPoints[i - 1];
          const p1 = subPoints[i];
          return {
            ele: (p0.ele || 0) + ((p1.ele || 0) - (p0.ele || 0)) * ratio,
            lat: p0.lat + (p1.lat - p0.lat) * ratio,
            lng: p0.lng + (p1.lng - p0.lng) * ratio
          };
        }
      }
      const last = subPoints[subPoints.length - 1];
      return { ele: last.ele || 0, lat: last.lat, lng: last.lng };
    };

    const result: ClimbSlice[] = [];
    for (let s = 0; s < numSlices; s++) {
      const dStart = s * stepKm;
      const dEnd = (s + 1) * stepKm;
      const pStart = interpolateAtKm(dStart);
      const pEnd = interpolateAtKm(dEnd);
      const dMeters = (dEnd - dStart) * 1000;
      const gradePct = dMeters > 1 ? Number((((pEnd.ele - pStart.ele) / dMeters) * 100).toFixed(1)) : 0;
      const palette = getSlopePalette(gradePct);

      result.push({
        index: s,
        startKm: Number((climb.startKm + dStart).toFixed(2)),
        endKm: Number((climb.startKm + dEnd).toFixed(2)),
        lengthKm: Number((dEnd - dStart).toFixed(2)),
        startEle: Math.round(pStart.ele),
        endEle: Math.round(pEnd.ele),
        gradePct,
        colorFront: palette.front,
        colorTop: palette.top,
        colorSide: palette.side,
        labelColor: palette.label,
        lat: (pStart.lat + pEnd.lat) / 2,
        lng: (pStart.lng + pEnd.lng) / 2
      });
    }
    return result;
  }, [climb, trackPoints, sliceTargetCount]);

  if (slices.length === 0) return null;

  const minEle = Math.min(...slices.map((s) => Math.min(s.startEle, s.endEle)));
  const maxEle = Math.max(...slices.map((s) => Math.max(s.startEle, s.endEle)), minEle + 20);
  const eleSpan = Math.max(25, maxEle - minEle);

  // Isometric projection offsets
  const dxDepth = isoAngle === 'steep' ? 26 : isoAngle === 'flat' ? 12 : 20;
  const dyDepth = isoAngle === 'steep' ? -22 : isoAngle === 'flat' ? -9 : -15;

  const svgWidth = 760;
  const svgHeight = 250;
  const padLeft = 42;
  const padRight = 46;
  const baseBottomY = 212;
  const maxWallHeight = 135;

  const usableWidth = svgWidth - padLeft - padRight - dxDepth;
  const sliceWidth = usableWidth / slices.length;

  const toY = (ele: number) => {
    const norm = (ele - minEle) / eleSpan;
    return baseBottomY - 14 - norm * maxWallHeight;
  };

  const activeSlice = hoveredSliceIdx !== null ? slices[hoveredSliceIdx] : null;
  const targetClimbWatts = Math.round(ftp * 0.98);
  const targetWkg = (targetClimbWatts / Math.max(35, riderWeight)).toFixed(2);

  return (
    <div className="mt-3 rounded-xl bg-slate-950 text-slate-100 border border-slate-800 p-3.5 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <Mountain className="w-4 h-4 text-orange-400 shrink-0" />
          <span className="text-xs font-bold tracking-tight text-white">
            3D-Bergprofil · {climb.categoryLabel} Anstieg #{climb.index + 1}
          </span>
          <span className="text-[11px] font-mono tabular-nums text-slate-400">
            km {climb.startKm}–{climb.endKm} · +{Math.round(climb.ascentMeters)} m · Ø {climb.avgGradePercent}% (Max {climb.maxGradePercent}%)
          </span>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <div className="inline-flex items-center rounded-lg bg-slate-900 border border-slate-800 p-0.5">
            {([
              { id: 12, label: 'Grob' },
              { id: 18, label: 'Standard' },
              { id: 26, label: 'Fein' }
            ] as const).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSliceTargetCount(opt.id)}
                className={`px-2 py-0.5 rounded-md font-semibold cursor-pointer transition-colors ${
                  sliceTargetCount === opt.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center rounded-lg bg-slate-900 border border-slate-800 p-0.5">
            {([
              { id: 'flat', label: 'Flach' },
              { id: 'standard', label: '3D Iso' },
              { id: 'steep', label: 'Steil' }
            ] as const).map((cam) => (
              <button
                key={cam.id}
                type="button"
                onClick={() => setIsoAngle(cam.id)}
                className={`px-2 py-0.5 rounded-md font-semibold cursor-pointer transition-colors ${
                  isoAngle === cam.id
                    ? 'bg-slate-800 text-amber-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {cam.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Isometric 3D Climb Canvas */}
      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto min-w-[520px] select-none"
          onMouseLeave={() => setHoveredSliceIdx(null)}
        >
          {/* Background elevation grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
            const eleVal = Math.round(minEle + t * eleSpan);
            const yPos = baseBottomY - 14 - t * maxWallHeight + dyDepth;
            return (
              <g key={idx}>
                <line
                  x1={padLeft + dxDepth}
                  y1={yPos}
                  x2={padLeft + usableWidth + dxDepth}
                  y2={yPos}
                  stroke="#1e293b"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
                <text
                  x={padLeft + dxDepth - 6}
                  y={yPos + 3}
                  textAnchor="end"
                  className="fill-slate-500 text-[9px] font-mono"
                >
                  {eleVal}m
                </text>
              </g>
            );
          })}

          {/* 3D Extruded Slabs (rendered left-to-right so right side face of last slice is visible) */}
          {slices.map((s, idx) => {
            const x0 = padLeft + idx * sliceWidth;
            const x1 = x0 + sliceWidth;
            const y0 = toY(s.startEle);
            const y1 = toY(s.endEle);
            const isHovered = hoveredSliceIdx === idx;

            // Front face polygon
            const frontPoints = `${x0},${baseBottomY} ${x0},${y0} ${x1},${y1} ${x1},${baseBottomY}`;
            // Top road ribbon polygon (extruded by dxDepth, dyDepth)
            const topPoints = `${x0},${y0} ${x0 + dxDepth},${y0 + dyDepth} ${x1 + dxDepth},${y1 + dyDepth} ${x1},${y1}`;
            // Right-side wall polygon
            const sidePoints = `${x1},${baseBottomY} ${x1},${y1} ${x1 + dxDepth},${y1 + dyDepth} ${x1 + dxDepth},${baseBottomY + dyDepth}`;

            return (
              <g
                key={s.index}
                className="cursor-pointer transition-opacity"
                opacity={hoveredSliceIdx !== null && !isHovered ? 0.65 : 1}
                onMouseEnter={() => {
                  setHoveredSliceIdx(idx);
                  onHoverSegment?.(s.lat, s.lng);
                }}
                onClick={() => onHoverSegment?.(s.lat, s.lng)}
              >
                {/* Side wall */}
                <polygon
                  points={sidePoints}
                  fill={s.colorSide}
                  stroke="#0f172a"
                  strokeWidth={0.6}
                />
                {/* Front gradient wall */}
                <polygon
                  points={frontPoints}
                  fill={s.colorFront}
                  stroke={isHovered ? '#ffffff' : '#0f172a'}
                  strokeWidth={isHovered ? 1.4 : 0.7}
                />
                {/* Top 3D road deck */}
                <polygon
                  points={topPoints}
                  fill={s.colorTop}
                  stroke={isHovered ? '#ffffff' : '#0f172a'}
                  strokeWidth={isHovered ? 1.4 : 0.8}
                />
                {/* Center white road line on top deck */}
                <line
                  x1={x0 + dxDepth * 0.5}
                  y1={y0 + dyDepth * 0.5}
                  x2={x1 + dxDepth * 0.5}
                  y2={y1 + dyDepth * 0.5}
                  stroke="rgba(255,255,255,0.45)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />

                {/* Slope % label floating above top deck */}
                {(slices.length <= 20 || idx % 2 === 0 || isHovered) && (
                  <text
                    x={(x0 + x1) * 0.5 + dxDepth * 0.6}
                    y={Math.min(y0, y1) + dyDepth - 5}
                    textAnchor="middle"
                    fill={isHovered ? '#ffffff' : s.labelColor}
                    className="text-[9px] font-mono font-bold"
                  >
                    {s.gradePct.toFixed(0)}%
                  </text>
                )}

                {/* Distance tick at bottom */}
                {(idx === 0 || idx === slices.length - 1 || idx % 3 === 0) && (
                  <text
                    x={x0}
                    y={baseBottomY + 14}
                    textAnchor="middle"
                    className="fill-slate-400 text-[9px] font-mono"
                  >
                    {s.startKm.toFixed(1)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Final km tick */}
          <text
            x={padLeft + usableWidth}
            y={baseBottomY + 14}
            textAnchor="middle"
            className="fill-slate-300 text-[9px] font-mono font-bold"
          >
            {climb.endKm.toFixed(1)} km
          </text>
        </svg>
      </div>

      {/* Bottom Legend + Interactive Segment Readout */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] font-mono tabular-nums border-t border-slate-800/80">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" /> &lt;4%
          </span>
          <span className="inline-flex items-center gap-1 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" /> 4–7%
          </span>
          <span className="inline-flex items-center gap-1 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-xs bg-orange-500 inline-block" /> 7–10%
          </span>
          <span className="inline-flex items-center gap-1 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-xs bg-red-500 inline-block" /> 10–14%
          </span>
          <span className="inline-flex items-center gap-1 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-xs bg-red-800 inline-block" /> &gt;14%
          </span>
        </div>

        {activeSlice ? (
          <div className="flex items-center gap-2 text-slate-200 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-700">
            <Compass className="w-3.5 h-3.5 text-indigo-400" />
            <span>
              Abschnitt #{activeSlice.index + 1}: km {activeSlice.startKm}–{activeSlice.endKm} ·{' '}
              <strong className="text-white">{activeSlice.gradePct}%</strong> · {activeSlice.startEle}m → {activeSlice.endEle}m
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              Ziel-Pacing: <strong className="text-slate-200">{targetClimbWatts} W</strong> ({targetWkg} W/kg)
            </span>
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              VAM: <strong className="text-slate-200">{climb.vam} Hm/h</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
