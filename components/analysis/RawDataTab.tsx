import React, { useState, useMemo } from 'react';
import { Search, Download, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2, Eye } from 'lucide-react';
import { GPXTrack } from '../../types';
import { calculateDistance } from '../../utils/gpxUtils';
import { triggerHaptic } from '../../utils/haptics';
import { resolveTrackCapabilities, isFitTrackFile } from '../../utils/trackTelemetryCapabilities';
import {
  resolveTrackPointSpeedsKmh,
  formatPaceFromSpeedKmh
} from '../../domain/telemetry/pointMetricsEngine';

interface RawDataTabProps {
  track: GPXTrack;
  onSelectPoint?: (lat: number, lng: number) => void;
}

export const RawDataTab: React.FC<RawDataTabProps> = ({ track, onSelectPoint }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  const capabilities = useMemo(() => resolveTrackCapabilities(track), [track]);

  // Determine cadence multiplier for running single-foot sensors (< 110 stride cycles -> * 2 spm)
  const cadenceMultiplier = useMemo(() => {
    if (!capabilities.isRunning || !capabilities.hasCadence) return 1;
    const rawCads = (track.points || [])
      .map((p) => p.cadence)
      .filter((c): c is number => typeof c === 'number' && Number.isFinite(c) && c > 20 && c < 250)
      .sort((a, b) => a - b);
    if (rawCads.length > 0 && rawCads[Math.floor(rawCads.length / 2)] < 110) {
      return 2;
    }
    return 1;
  }, [capabilities.isRunning, capabilities.hasCadence, track.points]);

  // Enrich points with cumulative distance, slope, and canonical speed
  const enrichedPoints = useMemo(() => {
    const pts = track.points || [];
    const resolvedSpeeds = capabilities.hasPaceOrSpeed
      ? resolveTrackPointSpeedsKmh(pts, {
          isFitFile: isFitTrackFile(track),
          activityType: capabilities.activityType,
          trackDistanceKm: track.distance,
          trackDurationSec: track.duration,
        })
      : [];

    let cumDistKm = 0;
    const result = [];

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let stepDistM = 0;
      let slopePct = 0;

      if (i > 0) {
        const prev = pts[i - 1];
        stepDistM = calculateDistance(prev, p) * 1000;
        cumDistKm += stepDistM / 1000;

        if (capabilities.hasRealElevation && stepDistM > 1 && p.ele !== undefined && prev.ele !== undefined) {
          slopePct = ((p.ele - prev.ele) / stepDistM) * 100;
        }
      }

      const speedKmh = capabilities.hasPaceOrSpeed ? resolvedSpeeds[i] ?? 0 : 0;
      const paceStr =
        capabilities.isRunning && speedKmh >= 1.8
          ? formatPaceFromSpeedKmh(speedKmh) || '–'
          : null;

      const isOutlier =
        (capabilities.hasRealElevation && Math.abs(slopePct) > 35) ||
        (p.lat === 0 && p.lng === 0) ||
        stepDistM > 1500;

      const cadVal =
        p.cadence !== undefined && p.cadence > 0 ? Math.round(p.cadence * cadenceMultiplier) : null;

      result.push({
        index: i + 1,
        distKm: Number(cumDistKm.toFixed(2)),
        ele: capabilities.hasRealElevation && p.ele !== undefined ? Math.round(p.ele) : null,
        slope: Number(slopePct.toFixed(1)),
        speed: Number(speedKmh.toFixed(1)),
        paceStr,
        hr: p.hr || null,
        cadence: cadVal,
        power: p.power || null,
        time: p.time ? new Date(p.time).toLocaleTimeString('de-DE') : '–',
        lat: Number(p.lat.toFixed(6)),
        lng: Number(p.lng.toFixed(6)),
        isOutlier,
      });
    }

    return result;
  }, [track, capabilities, cadenceMultiplier]);

  const filteredPoints = useMemo(() => {
    if (!searchTerm.trim()) return enrichedPoints;
    const q = searchTerm.toLowerCase();
    return enrichedPoints.filter(
      (p) =>
        p.index.toString().includes(q) ||
        p.distKm.toString().includes(q) ||
        (p.ele !== null && p.ele.toString().includes(q)) ||
        p.slope.toString().includes(q) ||
        (p.hr !== null && p.hr.toString().includes(q)) ||
        p.time.toLowerCase().includes(q)
    );
  }, [enrichedPoints, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredPoints.length / pageSize));
  const displayedPoints = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredPoints.slice(start, start + pageSize);
  }, [filteredPoints, currentPage, pageSize]);

  // Export CSV containing only columns with real data
  const handleExportCSV = () => {
    triggerHaptic('medium');
    const headers: string[] = ['Index', 'Distanz_km'];
    if (capabilities.hasRealElevation) {
      headers.push('Hoehe_m', 'Steigung_Prozent');
    }
    if (capabilities.hasPaceOrSpeed) {
      headers.push(capabilities.isRunning ? 'Pace_min_km' : 'Geschwindigkeit_kmh');
    }
    if (capabilities.hasHeartRate) headers.push('Puls_bpm');
    if (capabilities.hasNativePower) headers.push('Leistung_Watt');
    if (capabilities.hasCadence) {
      headers.push(capabilities.isRunning ? 'Schrittfrequenz_spm' : 'Trittfrequenz_rpm');
    }
    if (capabilities.hasTimestamps) headers.push('Zeit');
    headers.push('Breitengrad', 'Laengengrad');

    const rows = enrichedPoints.map((p) => {
      const cols: Array<string | number> = [p.index, p.distKm];
      if (capabilities.hasRealElevation) {
        cols.push(p.ele !== null ? p.ele : '', p.slope);
      }
      if (capabilities.hasPaceOrSpeed) {
        cols.push(capabilities.isRunning ? p.paceStr || '' : p.speed);
      }
      if (capabilities.hasHeartRate) cols.push(p.hr || '');
      if (capabilities.hasNativePower) cols.push(p.power || '');
      if (capabilities.hasCadence) cols.push(p.cadence || '');
      if (capabilities.hasTimestamps) cols.push(`"${p.time}"`);
      cols.push(p.lat, p.lng);
      return cols;
    });

    const csvContent = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${track.name.replace(/[^a-z0-9]/gi, '_')}_telemetrie.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const outlierCount = useMemo(() => {
    return enrichedPoints.filter((p) => p.isOutlier).length;
  }, [enrichedPoints]);

  const activeColumnCount =
    4 +
    (capabilities.hasRealElevation ? 2 : 0) +
    (capabilities.hasPaceOrSpeed ? 1 : 0) +
    (capabilities.hasHeartRate ? 1 : 0) +
    (capabilities.hasNativePower ? 1 : 0) +
    (capabilities.hasCadence ? 1 : 0) +
    (capabilities.hasTimestamps ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Punkte filtern (z. B. km, Höhe, Puls)..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-9 pr-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64"
            />
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400">
            <strong>{filteredPoints.length.toLocaleString()}</strong> von {enrichedPoints.length.toLocaleString()} Datenpunkten
          </div>
        </div>

        <div className="flex items-center gap-2">
          {outlierCount > 0 ? (
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {outlierCount} Auffälligkeit(en)
            </span>
          ) : (
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Daten konsistent
            </span>
          )}

          <button
            type="button"
            onClick={handleExportCSV}
            className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer whitespace-nowrap"
            title="Alle vorhandenen Messpunkte als CSV herunterladen"
          >
            <Download className="w-3.5 h-3.5" />
            CSV Exportieren
          </button>
        </div>
      </div>

      {/* Table Container */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-2.5 px-3">#</th>
                <th className="py-2.5 px-3">Distanz</th>
                {capabilities.hasRealElevation && <th className="py-2.5 px-3">Höhe</th>}
                {capabilities.hasRealElevation && <th className="py-2.5 px-3">Steigung</th>}
                {capabilities.hasPaceOrSpeed && (
                  <th className="py-2.5 px-3">{capabilities.isRunning ? 'Pace' : 'Tempo'}</th>
                )}
                {capabilities.hasHeartRate && <th className="py-2.5 px-3">Puls</th>}
                {capabilities.hasNativePower && <th className="py-2.5 px-3">Watt</th>}
                {capabilities.hasCadence && (
                  <th className="py-2.5 px-3">{capabilities.isRunning ? 'Cadence (spm)' : 'Cadence (rpm)'}</th>
                )}
                {capabilities.hasTimestamps && <th className="py-2.5 px-3">Zeit</th>}
                <th className="py-2.5 px-3">Koordinaten</th>
                <th className="py-2.5 px-3 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px] tabular-nums">
              {displayedPoints.length === 0 ? (
                <tr>
                  <td colSpan={activeColumnCount} className="py-8 text-center text-slate-400 font-sans">
                    Keine Messpunkte gefunden für den Suchbegriff &quot;{searchTerm}&quot;
                  </td>
                </tr>
              ) : (
                displayedPoints.map((p) => (
                  <tr
                    key={p.index}
                    className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                      p.isOutlier ? 'bg-amber-50/30 dark:bg-amber-950/15' : ''
                    }`}
                  >
                    <td className="py-2 px-3 text-slate-400 font-sans">{p.index}</td>
                    <td className="py-2 px-3 font-bold text-slate-800 dark:text-slate-200">{p.distKm} km</td>
                    {capabilities.hasRealElevation && (
                      <td className="py-2 px-3 text-indigo-600 dark:text-indigo-400 font-bold">
                        {p.ele !== null ? `${p.ele} m` : '–'}
                      </td>
                    )}
                    {capabilities.hasRealElevation && (
                      <td className="py-2 px-3">
                        <span
                          className={`font-bold ${
                            p.slope > 10
                              ? 'text-rose-600 dark:text-rose-400'
                              : p.slope > 4
                              ? 'text-amber-600 dark:text-amber-400'
                              : p.slope < -4
                              ? 'text-sky-600 dark:text-sky-400'
                              : 'text-slate-500'
                          }`}
                        >
                          {p.slope > 0 ? `+${p.slope}%` : `${p.slope}%`}
                        </span>
                      </td>
                    )}
                    {capabilities.hasPaceOrSpeed && (
                      <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                        {capabilities.isRunning
                          ? p.paceStr || '–'
                          : p.speed > 0
                          ? `${p.speed} km/h`
                          : '–'}
                      </td>
                    )}
                    {capabilities.hasHeartRate && (
                      <td className="py-2 px-3">
                        {p.hr ? (
                          <span className="text-rose-600 dark:text-rose-400 font-bold">{p.hr} bpm</span>
                        ) : (
                          '–'
                        )}
                      </td>
                    )}
                    {capabilities.hasNativePower && (
                      <td className="py-2 px-3 text-amber-600 dark:text-amber-400 font-bold">
                        {p.power ? `${p.power} W` : '–'}
                      </td>
                    )}
                    {capabilities.hasCadence && (
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                        {p.cadence
                          ? `${p.cadence} ${capabilities.isRunning ? 'spm' : 'rpm'}`
                          : '–'}
                      </td>
                    )}
                    {capabilities.hasTimestamps && (
                      <td className="py-2 px-3 text-slate-500 font-sans text-[10px]">{p.time}</td>
                    )}
                    <td className="py-2 px-3 text-[10px] text-slate-400 truncate max-w-[120px]">
                      {p.lat}, {p.lng}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {onSelectPoint && (
                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic('light');
                            onSelectPoint(p.lat, p.lng);
                          }}
                          className="p-1 rounded hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 transition-colors cursor-pointer"
                          title="Auf Karte zentrieren"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-3 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              Seite {currentPage} von {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => {
                  setCurrentPage((prev) => Math.max(1, prev - 1));
                  triggerHaptic('light');
                }}
                className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => {
                  setCurrentPage((prev) => Math.min(totalPages, prev + 1));
                  triggerHaptic('light');
                }}
                className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
