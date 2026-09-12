import React, { useRef, useState, useEffect, useCallback } from 'react';
import { GPXPoint } from '../../types';
import { computeVirtualWindow } from '../../domain/performance/virtualizer';
import { Heart, Activity } from 'lucide-react';

interface VirtualizedPointsTableProps {
  points: readonly GPXPoint[];
  selectedPointIndex: number;
  onSelectPoint: (index: number) => void;
  formatDate: (date?: Date) => string;
  startIndexOffset?: number;
}

const ROW_HEIGHT_PX = 44;
const VIEWPORT_HEIGHT_PX = 480;

export const VirtualizedPointsTable: React.FC<VirtualizedPointsTableProps> = ({
  points,
  selectedPointIndex,
  onSelectPoint,
  formatDate,
  startIndexOffset = 0
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const windowResult = computeVirtualWindow({
    totalItems: points.length,
    itemHeight: ROW_HEIGHT_PX,
    viewportHeight: VIEWPORT_HEIGHT_PX,
    scrollTop,
    overscan: 4
  });

  const virtualData = windowResult.success
    ? windowResult.data
    : {
        startIndex: 0,
        endIndex: Math.min(points.length - 1, 20),
        startOffsetPx: 0,
        totalHeightPx: points.length * ROW_HEIGHT_PX,
        visibleCount: Math.min(points.length, 20)
      };

  const visibleSlice = points.slice(virtualData.startIndex, virtualData.endIndex + 1);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{ height: `${VIEWPORT_HEIGHT_PX}px` }}
      className="w-full overflow-y-auto relative rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 shadow-inner"
    >
      <div style={{ height: `${virtualData.totalHeightPx}px`, position: 'relative', width: '100%' }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            transform: `translateY(${virtualData.startOffsetPx}px)`
          }}
        >
          <table className="w-full text-left border-collapse text-xs select-none">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-950 text-slate-400 font-black uppercase text-[9px] tracking-wider border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-4 w-16">Status</th>
                <th className="py-2.5 px-4">Zeitstempel</th>
                <th className="py-2.5 px-4">Koordinaten</th>
                <th className="py-2.5 px-4">Höhe</th>
                <th className="py-2.5 px-4 text-center">Puls (HR)</th>
                <th className="py-2.5 px-4 text-center">Trittfrequenz</th>
                <th className="py-2.5 px-4 text-center">Watt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-850 font-semibold text-slate-700 dark:text-slate-350">
              {visibleSlice.map((pt, sliceIdx) => {
                const globalIndex = startIndexOffset + virtualData.startIndex + sliceIdx;
                const isSelected = globalIndex === selectedPointIndex;

                return (
                  <tr
                    key={globalIndex}
                    onClick={() => onSelectPoint(globalIndex)}
                    style={{ height: `${ROW_HEIGHT_PX}px` }}
                    className={`cursor-pointer transition-colors border-l-4 ${
                      isSelected
                        ? 'bg-indigo-50/70 dark:bg-indigo-950/30 border-l-indigo-600 dark:border-l-indigo-500 font-extrabold text-slate-900 dark:text-white'
                        : 'border-l-transparent hover:bg-slate-50/60 dark:hover:bg-slate-900/50 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <td className="py-2 px-4 font-mono text-[10px] font-black whitespace-nowrap">
                      {isSelected ? (
                        <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-ping" />
                          AKTIV
                        </span>
                      ) : (
                        <span className="text-slate-400">#{globalIndex + 1}</span>
                      )}
                    </td>
                    <td className="py-2 px-4 font-mono whitespace-nowrap">{formatDate(pt.time)}</td>
                    <td className="py-2 px-4 font-mono text-[10px] leading-tight text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      <div>{pt.lat.toFixed(5)}°, {pt.lng.toFixed(5)}°</div>
                    </td>
                    <td className="py-2 px-4 font-mono text-indigo-600 dark:text-indigo-400 font-extrabold whitespace-nowrap">
                      {pt.ele !== undefined ? `${Math.round(pt.ele)} m` : '-'}
                    </td>
                    <td className="py-2 px-4 text-center font-mono whitespace-nowrap">
                      {pt.hr !== undefined ? (
                        <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 bg-rose-50/50 dark:bg-rose-950/20 px-1.5 py-0.5 rounded font-black border border-rose-100/40">
                          <Heart size={9} fill="currentColor" />
                          {pt.hr} bpm
                        </span>
                      ) : '-'}
                    </td>
                    <td className="py-2 px-4 text-center font-mono font-bold text-teal-600 dark:text-teal-400 whitespace-nowrap">
                      {pt.cadence !== undefined ? `${pt.cadence} rpm` : '-'}
                    </td>
                    <td className="py-2 px-4 text-center font-mono whitespace-nowrap">
                      {pt.power !== undefined ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20 px-1.5 py-0.5 rounded font-black border border-amber-100/40">
                          <Activity size={9} />
                          {pt.power} W
                        </span>
                      ) : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
