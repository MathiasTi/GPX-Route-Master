import React, { useState, useMemo } from 'react';
import { Search, Download, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2, FileSpreadsheet, MapPin, Eye } from 'lucide-react';
import { GPXTrack, GPXPoint } from '../../types';
import { calculateDistance } from '../../utils/gpxUtils';
import { triggerHaptic } from '../../utils/haptics';

interface RawDataTabProps {
  track: GPXTrack;
  onSelectPoint?: (lat: number, lng: number) => void;
}

export const RawDataTab: React.FC<RawDataTabProps> = ({ track, onSelectPoint }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  // Enrich points with cumulative distance, slope, speed
  const enrichedPoints = useMemo(() => {
    const pts = track.points || [];
    let cumDistKm = 0;
    const result = [];

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let stepDistM = 0;
      let slopePct = 0;
      let speedKmh = p.speed !== undefined ? p.speed * 3.6 : 0;

      if (i > 0) {
        const prev = pts[i - 1];
        stepDistM = calculateDistance(prev, p) * 1000;
        cumDistKm += stepDistM / 1000;

        if (stepDistM > 1 && p.ele !== undefined && prev.ele !== undefined) {
          slopePct = ((p.ele - prev.ele) / stepDistM) * 100;
        }

        if (speedKmh === 0 && p.time && prev.time) {
          const dtSec = (new Date(p.time).getTime() - new Date(prev.time).getTime()) / 1000;
          if (dtSec > 0 && dtSec < 120) {
            speedKmh = (stepDistM / dtSec) * 3.6;
          }
        }
      }

      // Check for anomalies
      const isOutlier = Math.abs(slopePct) > 35 || (p.lat === 0 && p.lng === 0) || stepDistM > 1500;

      result.push({
        index: i + 1,
        distKm: Number(cumDistKm.toFixed(2)),
        ele: p.ele !== undefined ? Math.round(p.ele) : null,
        slope: Number(slopePct.toFixed(1)),
        speed: Number(speedKmh.toFixed(1)),
        hr: p.hr || null,
        cadence: p.cadence || null,
        power: p.power || null,
        time: p.time ? new Date(p.time).toLocaleTimeString() : '–',
        lat: Number(p.lat.toFixed(6)),
        lng: Number(p.lng.toFixed(6)),
        isOutlier
      });
    }

    return result;
  }, [track.points]);

  // Filter based on search query
  const filteredPoints = useMemo(() => {
    if (!searchTerm.trim()) return enrichedPoints;
    const q = searchTerm.toLowerCase();
    return enrichedPoints.filter(p => 
      p.index.toString().includes(q) ||
      p.distKm.toString().includes(q) ||
      (p.ele !== null && p.ele.toString().includes(q)) ||
      p.slope.toString().includes(q) ||
      (p.hr !== null && p.hr.toString().includes(q)) ||
      p.time.toLowerCase().includes(q)
    );
  }, [enrichedPoints, searchTerm]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredPoints.length / pageSize));
  const displayedPoints = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredPoints.slice(start, start + pageSize);
  }, [filteredPoints, currentPage, pageSize]);

  // Export to CSV
  const handleExportCSV = () => {
    triggerHaptic('medium');
    const headers = ['Index', 'Distanz_km', 'Hoehe_m', 'Steigung_Prozent', 'Geschwindigkeit_kmh', 'Puls_bpm', 'Leistung_Watt', 'Trittfrequenz_rpm', 'Zeit', 'Breitengrad', 'Laengengrad'];
    const rows = enrichedPoints.map(p => [
      p.index,
      p.distKm,
      p.ele !== null ? p.ele : '',
      p.slope,
      p.speed,
      p.hr || '',
      p.power || '',
      p.cadence || '',
      `"${p.time}"`,
      p.lat,
      p.lng
    ]);

    const csvContent = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${track.name.replace(/[^a-z0-9]/gi, '_')}_telemetrie.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const outlierCount = useMemo(() => {
    return enrichedPoints.filter(p => p.isOutlier).length;
  }, [enrichedPoints]);

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
            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {outlierCount} Auffälligkeit(en)
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Daten konsistent
            </span>
          )}

          <button
            type="button"
            onClick={handleExportCSV}
            className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            title="Alle Messpunkte als CSV herunterladen"
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
                <th className="py-2.5 px-3">Höhe</th>
                <th className="py-2.5 px-3">Steigung</th>
                <th className="py-2.5 px-3">Tempo</th>
                <th className="py-2.5 px-3">Puls</th>
                <th className="py-2.5 px-3">Watt</th>
                <th className="py-2.5 px-3">Cadence</th>
                <th className="py-2.5 px-3">Zeit</th>
                <th className="py-2.5 px-3">Koordinaten</th>
                <th className="py-2.5 px-3 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
              {displayedPoints.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-400 font-sans">
                    Keine Messpunkte gefunden für den Suchbegriff "{searchTerm}"
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
                    <td className="py-2 px-3 text-indigo-600 dark:text-indigo-400 font-bold">
                      {p.ele !== null ? `${p.ele} m` : '–'}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`font-bold ${
                        p.slope > 10 ? 'text-rose-600 dark:text-rose-400' :
                        p.slope > 4 ? 'text-amber-600 dark:text-amber-400' :
                        p.slope < -4 ? 'text-sky-600 dark:text-sky-400' : 'text-slate-500'
                      }`}>
                        {p.slope > 0 ? `+${p.slope}%` : `${p.slope}%`}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                      {p.speed > 0 ? `${p.speed} km/h` : '–'}
                    </td>
                    <td className="py-2 px-3">
                      {p.hr ? (
                        <span className="text-rose-600 dark:text-rose-400 font-bold flex items-center gap-0.5">
                          {p.hr} bpm
                        </span>
                      ) : '–'}
                    </td>
                    <td className="py-2 px-3 text-amber-600 dark:text-amber-400 font-bold">
                      {p.power ? `${p.power} W` : '–'}
                    </td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                      {p.cadence ? `${p.cadence} rpm` : '–'}
                    </td>
                    <td className="py-2 px-3 text-slate-500 font-sans text-[10px]">{p.time}</td>
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
                          className="p-1 rounded hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 transition-colors"
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
                  setCurrentPage(prev => Math.max(1, prev - 1));
                  triggerHaptic('light');
                }}
                className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => {
                  setCurrentPage(prev => Math.min(totalPages, prev + 1));
                  triggerHaptic('light');
                }}
                className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
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
