import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { X, Trophy, Zap, Heart, Clock, TrendingUp, TrendingDown, ArrowLeftRight, Activity, Percent, Compass, Navigation, Dumbbell, Flame } from 'lucide-react';
import { GPXTrack, GPXPoint } from '../types';
import { calculateDistance, formatPace, getPaceString } from '../utils/gpxUtils';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface TrackComparisonProps {
  tracks: GPXTrack[];
  onClose: () => void;
  ftp: number;
  userWeight: number;
  userAge: number;
  estimatedSpeed: number;
}

function samplePoints<T>(points: T[], limit: number): T[] {
  if (points.length <= limit) return points;
  const result: T[] = [];
  const step = points.length / limit;
  for (let i = 0; i < limit; i++) {
    const idx = Math.floor(i * step);
    if (points[idx]) result.push(points[idx]);
  }
  const lastPoint = points[points.length - 1];
  if (lastPoint && !result.includes(lastPoint)) {
    result.push(lastPoint);
  }
  return result;
}

export const TrackComparison: React.FC<TrackComparisonProps> = ({
  tracks,
  onClose,
  ftp,
  userWeight,
  userAge,
  estimatedSpeed
}) => {
  // We need at least 2 tracks to offer a valid dropdown comparison
  const [track1Id, setTrack1Id] = useState<string>(tracks[0]?.id || '');
  const [track2Id, setTrack2Id] = useState<string>(tracks[1]?.id || tracks[0]?.id || '');

  const track1 = useMemo(() => tracks.find(t => t.id === track1Id), [tracks, track1Id]);
  const track2 = useMemo(() => tracks.find(t => t.id === track2Id), [tracks, track2Id]);

  // Compute rich metrics for Track 1
  const stats1 = useMemo(() => {
    if (!track1) return null;
    const points = track1.points;
    const hasElevation = points.some(p => p.ele !== undefined);
    
    // Altitude metrics
    const elevations = points.filter(p => p.ele !== undefined).map(p => p.ele!);
    const maxEle = elevations.length > 0 ? Math.max(...elevations) : 0;
    const minEle = elevations.length > 0 ? Math.min(...elevations) : 0;
    const avgEle = elevations.length > 0 ? elevations.reduce((a, b) => a + b, 0) / elevations.length : 0;

    // Heart rate metrics
    const hrs = points.filter(p => p.hr !== undefined).map(p => p.hr!);
    const maxHr = hrs.length > 0 ? Math.max(...hrs) : 0;
    const avgHr = hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0;

    // Cadence metrics
    const cadences = points.filter(p => p.cadence !== undefined && p.cadence > 0).map(p => p.cadence!);
    const avgCadence = cadences.length > 0 ? cadences.reduce((a, b) => a + b, 0) / cadences.length : 0;

    // Calculate speed metrics
    let totalDist = 0;
    let totalMovingTime = 0;
    const speedPoints: number[] = [];
    
    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];
      const distStep = calculateDistance(p1, p2);
      totalDist += distStep;

      if (p1.time && p2.time) {
        const dt = (new Date(p2.time).getTime() - new Date(p1.time).getTime()) / 1000;
        if (dt > 0 && dt < 120) {
          totalMovingTime += dt;
          const s = distStep / (dt / 3600);
          if (s > 1 && s < 120) { // filter realistic motion
            speedPoints.push(s);
          }
        }
      }
    }

    const durationSecs = track1.duration || totalMovingTime || (track1.distance / estimatedSpeed) * 3600;
    const avgSpeed = durationSecs > 0 ? (track1.distance / (durationSecs / 3600)) : estimatedSpeed;
    const maxSpeed = speedPoints.length > 0 ? Math.max(...speedPoints) : Math.max(avgSpeed * 1.5, 25);

    // Fat / Calories estimations based on MET (Metabolic Equivalent of Task)
    const isRunning = track1?.activityType === 'running';
    let met = 4; // default light cycling
    if (isRunning) {
      const speedKmh = avgSpeed;
      if (speedKmh > 12) met = 12.5;
      else if (speedKmh > 10) met = 11;
      else if (speedKmh > 8) met = 9;
      else met = 8;
    } else {
      const speedKmh = avgSpeed;
      if (speedKmh > 30) met = 12;
      else if (speedKmh > 25) met = 10;
      else if (speedKmh > 20) met = 8;
      else if (speedKmh > 15) met = 6;
    }
    
    // Calories = MET * weight_kg * duration_hours
    const durationHours = durationSecs / 3600;
    const calories = Math.round(met * userWeight * durationHours);

    return {
      hasElevation,
      maxEle,
      minEle,
      avgEle,
      maxHr,
      avgHr,
      avgCadence,
      avgSpeed,
      maxSpeed,
      calories,
      durationSecs
    };
  }, [track1, estimatedSpeed, userWeight]);

  // Compute rich metrics for Track 2
  const stats2 = useMemo(() => {
    if (!track2) return null;
    const points = track2.points;
    const hasElevation = points.some(p => p.ele !== undefined);
    
    // Altitude metrics
    const elevations = points.filter(p => p.ele !== undefined).map(p => p.ele!);
    const maxEle = elevations.length > 0 ? Math.max(...elevations) : 0;
    const minEle = elevations.length > 0 ? Math.min(...elevations) : 0;
    const avgEle = elevations.length > 0 ? elevations.reduce((a, b) => a + b, 0) / elevations.length : 0;

    // Heart rate metrics
    const hrs = points.filter(p => p.hr !== undefined).map(p => p.hr!);
    const maxHr = hrs.length > 0 ? Math.max(...hrs) : 0;
    const avgHr = hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0;

    // Cadence metrics
    const cadences = points.filter(p => p.cadence !== undefined && p.cadence > 0).map(p => p.cadence!);
    const avgCadence = cadences.length > 0 ? cadences.reduce((a, b) => a + b, 0) / cadences.length : 0;

    // Calculate speed metrics
    let totalDist = 0;
    let totalMovingTime = 0;
    const speedPoints: number[] = [];
    
    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];
      const distStep = calculateDistance(p1, p2);
      totalDist += distStep;

      if (p1.time && p2.time) {
        const dt = (new Date(p2.time).getTime() - new Date(p1.time).getTime()) / 1000;
        if (dt > 0 && dt < 120) {
          totalMovingTime += dt;
          const s = distStep / (dt / 3600);
          if (s > 1 && s < 120) {
            speedPoints.push(s);
          }
        }
      }
    }

    const durationSecs = track2.duration || totalMovingTime || (track2.distance / estimatedSpeed) * 3600;
    const avgSpeed = durationSecs > 0 ? (track2.distance / (durationSecs / 3600)) : estimatedSpeed;
    const maxSpeed = speedPoints.length > 0 ? Math.max(...speedPoints) : Math.max(avgSpeed * 1.5, 25);

    // Fat / Calories estimations
    const isRunning = track2?.activityType === 'running';
    let met = 4;
    if (isRunning) {
      const speedKmh = avgSpeed;
      if (speedKmh > 12) met = 12.5;
      else if (speedKmh > 10) met = 11;
      else if (speedKmh > 8) met = 9;
      else met = 8;
    } else {
      const speedKmh = avgSpeed;
      if (speedKmh > 30) met = 12;
      else if (speedKmh > 25) met = 10;
      else if (speedKmh > 20) met = 8;
      else if (speedKmh > 15) met = 6;
    }
    
    const durationHours = durationSecs / 3600;
    const calories = Math.round(met * userWeight * durationHours);

    return {
      hasElevation,
      maxEle,
      minEle,
      avgEle,
      maxHr,
      avgHr,
      avgCadence,
      avgSpeed,
      maxSpeed,
      calories,
      durationSecs
    };
  }, [track2, estimatedSpeed, userWeight]);

  // Compute sampled chart records
  const chartData1 = useMemo(() => {
    if (!track1) return [];
    let currentDist = 0;
    const raw = track1.points.map((p, idx) => {
      if (idx > 0) {
        currentDist += calculateDistance(track1.points[idx - 1], p);
      }
      return {
        distance: currentDist,
        elevation: p.ele || 0,
        hr: p.hr || 0,
        power: p.power || 0
      };
    });
    return samplePoints(raw, 180);
  }, [track1]);

  const chartData2 = useMemo(() => {
    if (!track2) return [];
    let currentDist = 0;
    const raw = track2.points.map((p, idx) => {
      if (idx > 0) {
        currentDist += calculateDistance(track2.points[idx - 1], p);
      }
      return {
        distance: currentDist,
        elevation: p.ele || 0,
        hr: p.hr || 0,
        power: p.power || 0
      };
    });
    return samplePoints(raw, 180);
  }, [track2]);

  // Unified overlay charts for comparative overlay
  // Align them on 0% to 100% axis to compare profiles easily side-by-side or on same plot
  const unifiedChartData = useMemo(() => {
    if (chartData1.length === 0 || chartData2.length === 0) return [];
    const pointsCount = 100;
    const data: { percent: number; ele1?: number; ele2?: number; power1?: number; power2?: number; hr1?: number; hr2?: number }[] = [];
    
    for (let i = 0; i <= pointsCount; i++) {
      const pct = i;
      const index1 = Math.min(chartData1.length - 1, Math.floor((i / pointsCount) * (chartData1.length - 1)));
      const index2 = Math.min(chartData2.length - 1, Math.floor((i / pointsCount) * (chartData2.length - 1)));
      
      data.push({
        percent: pct,
        ele1: Math.round(chartData1[index1]?.elevation || 0),
        ele2: Math.round(chartData2[index2]?.elevation || 0),
        power1: Math.round(chartData1[index1]?.power || 0),
        power2: Math.round(chartData2[index2]?.power || 0),
        hr1: Math.round(chartData1[index1]?.hr || 0),
        hr2: Math.round(chartData2[index2]?.hr || 0)
      });
    }
    return data;
  }, [chartData1, chartData2]);

  const formatDuration = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    return `${h} Std. ${m} Min. ${s} Sek.`;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 15 }}
      className="fixed inset-0 bg-slate-900/45 backdrop-blur-md z-[200] flex items-center justify-center p-4 md:p-8"
    >
      <div className="bg-white dark:bg-slate-950 rounded-3xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800">
        
        {/* Header Section */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-100 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400 rounded-2xl">
              <ArrowLeftRight size={24} className="stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Aktivitäten-Vergleich</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest font-extrabold">Side-by-Side Leistungsanalyse</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-xl transition-all"
            title="Schließen"
          >
            <X size={20} />
          </button>
        </div>

        {/* Drodown Selectors & Check */}
        {tracks.length < 2 ? (
          <div className="flex-1 p-12 text-center flex flex-col items-center justify-center space-y-4">
            <Trophy className="w-16 h-16 text-slate-350" />
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Nicht genügend Aktivitäten</h3>
              <p className="text-sm text-slate-500 max-w-md">
                Lade mindestens zwei GPX- oder FIT-Dateien hoch, um detaillierte Steigungen, Leistungswerte und Geschwindigkeiten nebeneinander vergleichen zu können.
              </p>
            </div>
            <button 
              onClick={onClose}
              className="mt-4 bg-slate-100 font-bold text-xs text-slate-700 px-5 py-2.5 rounded-xl border border-slate-200 transition-colors hover:bg-slate-200"
            >
              Abbrechen
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            
            {/* Action Selector Bar */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-900/30 p-4 border border-slate-200/60 dark:border-slate-800 rounded-2xl">
              <div className="space-y-1">
                <label className="text-[10px] font-black tracking-wider text-slate-500 uppercase flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: track1?.color || '#3b82f6' }} />
                  Aktivität 1 (Blau/Referenz)
                </label>
                <select
                  value={track1Id}
                  onChange={(e) => setTrack1Id(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-xl px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800 dark:text-slate-100"
                >
                  {tracks.map(t => (
                    <option key={t.id} value={t.id} disabled={t.id === track2Id}>
                      {t.name} ({t.distance.toFixed(1)} km)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black tracking-wider text-slate-500 uppercase flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: track2?.color || '#10b981' }} />
                  Aktivität 2 (Grün)
                </label>
                <select
                  value={track2Id}
                  onChange={(e) => setTrack2Id(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-xl px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800 dark:text-slate-100"
                >
                  {tracks.map(t => (
                    <option key={t.id} value={t.id} disabled={t.id === track1Id}>
                      {t.name} ({t.distance.toFixed(1)} km)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Side-by-Side Numerical Stat Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Category: Streckendaten */}
              <div className="bg-slate-50/40 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 p-5 rounded-2xl space-y-4">
                <h4 className="text-xs font-black tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
                  <Compass size={14} className="text-blue-500" />
                  Routendaten & Distanz
                </h4>
                
                <div className="space-y-3 font-sans">
                  {/* Distance */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Distanz</span>
                    <div className="grid grid-cols-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                      <div className={`p-1 rounded ${track1 && track2 && track1.distance >= track2.distance ? 'bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 font-black' : ''}`}>
                        {track1?.distance.toFixed(2)} km
                      </div>
                      <div className={`p-1 rounded border-l border-slate-100 dark:border-slate-800 pl-2 ${track1 && track2 && track2.distance > track1.distance ? 'bg-teal-50/50 dark:bg-teal-950/20 text-teal-600 dark:text-teal-400 font-black' : ''}`}>
                        {track2?.distance.toFixed(2)} km
                      </div>
                    </div>
                  </div>

                  {/* Duration */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Aktivitätszeit</span>
                    <div className="grid grid-cols-2 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      <div className="p-1">
                        {stats1 ? formatDuration(stats1.durationSecs) : '--'}
                      </div>
                      <div className="p-1 border-l border-slate-100 dark:border-slate-800 pl-2">
                        {stats2 ? formatDuration(stats2.durationSecs) : '--'}
                      </div>
                    </div>
                  </div>

                  {/* Average Speed / Pace */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">
                      { (track1?.activityType === 'running' || track2?.activityType === 'running') ? "Ø Pace / Ø Geschwindigkeit" : "Ø Geschwindigkeit" }
                    </span>
                    <div className="grid grid-cols-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                      <div className={`p-1 rounded ${stats1 && stats2 && stats1.avgSpeed >= stats2.avgSpeed ? 'bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 font-black' : ''}`}>
                        {track1?.activityType === 'running'
                          ? getPaceString(stats1?.avgSpeed || 0)
                          : `${stats1?.avgSpeed.toFixed(1)} km/h`
                        }
                      </div>
                      <div className={`p-1 rounded border-l border-slate-100 dark:border-slate-800 pl-2 ${stats1 && stats2 && stats2.avgSpeed > stats1.avgSpeed ? 'bg-teal-50/50 dark:bg-teal-950/20 text-teal-600 dark:text-teal-400 font-black' : ''}`}>
                        {track2?.activityType === 'running'
                          ? getPaceString(stats2?.avgSpeed || 0)
                          : `${stats2?.avgSpeed.toFixed(1)} km/h`
                        }
                      </div>
                    </div>
                  </div>

                  {/* Calories */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Energieverbrauch (geschätzt)</span>
                    <div className="grid grid-cols-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                      <div className="p-1 flex items-center gap-1">
                        <Flame className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                        <span>{stats1?.calories} kcal</span>
                      </div>
                      <div className="p-1 border-l border-slate-100 dark:border-slate-800 pl-2 flex items-center gap-1">
                        <Flame className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                        <span>{stats2?.calories} kcal</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Category: Höhenprofil & Klettern */}
              <div className="bg-slate-50/40 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 p-5 rounded-2xl space-y-4">
                <h4 className="text-xs font-black tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
                  <TrendingUp size={14} className="text-emerald-500" />
                  Steigungs- & Höhendaten
                </h4>

                <div className="space-y-3 font-sans">
                  {/* Ascent / Gain */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Höhenmeter Gewinn (Anstieg)</span>
                    <div className="grid grid-cols-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                      <div className={`p-1 rounded ${track1 && track2 && track1.ascent >= track2.ascent ? 'bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 font-black' : ''}`}>
                        +{Math.round(track1?.ascent ?? 0).toLocaleString('de-DE')} m
                      </div>
                      <div className={`p-1 rounded border-l border-slate-100 dark:border-slate-800 pl-2 ${track1 && track2 && track2.ascent > track1.ascent ? 'bg-teal-50/50 dark:bg-teal-950/20 text-teal-600 dark:text-teal-400 font-black' : ''}`}>
                        +{Math.round(track2?.ascent ?? 0).toLocaleString('de-DE')} m
                      </div>
                    </div>
                  </div>

                  {/* Descent / Loss */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Höhenmeter Verlust (Abstieg)</span>
                    <div className="grid grid-cols-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                      <div className="p-1">
                        -{Math.round(track1?.descent ?? 0).toLocaleString('de-DE')} m
                      </div>
                      <div className="p-1 border-l border-slate-100 dark:border-slate-800 pl-2">
                        -{Math.round(track2?.descent ?? 0).toLocaleString('de-DE')} m
                      </div>
                    </div>
                  </div>

                  {/* Max Elevation */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Maximale Höhe</span>
                    <div className="grid grid-cols-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                      <div className={`p-1 rounded ${stats1 && stats2 && stats1.maxEle >= stats2.maxEle ? 'bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 font-black' : ''}`}>
                        {Math.round(stats1?.maxEle ?? 0)} m
                      </div>
                      <div className={`p-1 rounded border-l border-slate-100 dark:border-slate-800 pl-2 ${stats1 && stats2 && stats2.maxEle > stats1.maxEle ? 'bg-teal-50/50 dark:bg-teal-950/20 text-teal-600 dark:text-teal-400 font-black' : ''}`}>
                        {Math.round(stats2?.maxEle ?? 0)} m
                      </div>
                    </div>
                  </div>

                  {/* Max Slope */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Maximale Steigung</span>
                    <div className="grid grid-cols-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                      <div className={`p-1 rounded ${track1 && track2 && track1.maxSlope >= track2.maxSlope ? 'bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 font-black' : ''}`}>
                        {track1?.maxSlope.toFixed(1)}%
                      </div>
                      <div className={`p-1 rounded border-l border-slate-100 dark:border-slate-800 pl-2 ${track1 && track2 && track2.maxSlope > track1.maxSlope ? 'bg-teal-50/50 dark:bg-teal-950/20 text-teal-600 dark:text-teal-400 font-black' : ''}`}>
                        {track2?.maxSlope.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Category: Leistungsanalyse (FIT / Power / HR Stats) */}
              <div className="bg-slate-50/40 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 p-5 rounded-2xl space-y-4">
                <h4 className="text-xs font-black tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
                  <Zap size={14} className="text-amber-500" />
                  Leistungsdaten (Power & Puls)
                </h4>

                <div className="space-y-3 font-sans">
                  {/* Avg Power */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Durchschnitts-Leistung</span>
                    <div className="grid grid-cols-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                      <div className={`p-1 rounded ${track1?.powerStats && track2?.powerStats && track1.powerStats.avgPower >= track2.powerStats.avgPower ? 'bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 font-black' : ''}`}>
                        {track1?.powerStats ? `${Math.round(track1.powerStats.avgPower)} W` : 'Keine Daten'}
                      </div>
                      <div className={`p-1 rounded border-l border-slate-100 dark:border-slate-800 pl-2 ${track1?.powerStats && track2?.powerStats && track2.powerStats.avgPower > track1.powerStats.avgPower ? 'bg-teal-50/50 dark:bg-teal-950/20 text-teal-600 dark:text-teal-400 font-black' : ''}`}>
                        {track2?.powerStats ? `${Math.round(track2.powerStats.avgPower)} W` : 'Keine Daten'}
                      </div>
                    </div>
                  </div>

                  {/* NP (Normalized Power) */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Normalized Power (NP)</span>
                    <div className="grid grid-cols-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                      <div className={`p-1 rounded ${track1?.powerStats?.normalizedPower && track2?.powerStats?.normalizedPower && track1.powerStats.normalizedPower >= track2.powerStats.normalizedPower ? 'bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 font-black' : ''}`}>
                        {track1?.powerStats?.normalizedPower ? `${Math.round(track1.powerStats.normalizedPower)} W` : 'Keine Daten'}
                      </div>
                      <div className={`p-1 rounded border-l border-slate-100 dark:border-slate-800 pl-2 ${track1?.powerStats?.normalizedPower && track2?.powerStats?.normalizedPower && track2.powerStats.normalizedPower > track1.powerStats.normalizedPower ? 'bg-teal-50/50 dark:bg-teal-950/20 text-teal-600 dark:text-teal-400 font-black' : ''}`}>
                        {track2?.powerStats?.normalizedPower ? `${Math.round(track2.powerStats.normalizedPower)} W` : 'Keine Daten'}
                      </div>
                    </div>
                  </div>

                  {/* Avg Heart Rate */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Ø Herzfrequenz</span>
                    <div className="grid grid-cols-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                      <div className="p-1 flex items-center gap-1">
                        {stats1 && stats1.avgHr > 0 ? (
                          <>
                            <Heart className="w-3.5 h-3.5 text-rose-500 shrink-0 fill-rose-500/10" />
                            <span>{Math.round(stats1.avgHr)} bpm</span>
                          </>
                        ) : 'Keine Daten'}
                      </div>
                      <div className="p-1 border-l border-slate-100 dark:border-slate-800 pl-2 flex items-center gap-1">
                        {stats2 && stats2.avgHr > 0 ? (
                          <>
                            <Heart className="w-3.5 h-3.5 text-rose-500 shrink-0 fill-rose-500/10" />
                            <span>{Math.round(stats2.avgHr)} bpm</span>
                          </>
                        ) : 'Keine Daten'}
                      </div>
                    </div>
                  </div>

                  {/* Avg Cadence */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Ø Trittfrequenz</span>
                    <div className="grid grid-cols-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                      <div className="p-1">
                        {stats1 && stats1.avgCadence > 0 ? `${Math.round(stats1.avgCadence)} rpm` : 'Keine Daten'}
                      </div>
                      <div className="p-1 border-l border-slate-100 dark:border-slate-800 pl-2">
                        {stats2 && stats2.avgCadence > 0 ? `${Math.round(stats2.avgCadence)} rpm` : 'Keine Daten'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Side-by-Side Altitude & Elevation Graphs */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-indigo-500" />
                  Höhenprofil-Vergleich (Relative Distanz 0-100%)
                </h3>
                <span className="text-[10px] text-slate-500 font-bold bg-slate-100 dark:bg-slate-900 border px-2 py-1 rounded">
                  Zeigt die Profile beider Routen skaliert auf die Gesamtlänge
                </span>
              </div>

              {/* Side-by-side Elevation Profiles */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-64">
                {/* Graph Track 1 */}
                <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 rounded-2xl flex flex-col shadow-sm">
                  <span className="text-xs font-extrabold text-blue-600 mb-2 truncate">
                    {track1?.name} ({track1?.distance.toFixed(1)} km)
                  </span>
                  <div className="flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData1} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorEle1" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.15)" />
                        <XAxis 
                          dataKey="distance" 
                          stroke="#94a3b8" 
                          fontSize={10} 
                          tickLine={false}
                          tickFormatter={(val) => `${val.toFixed(1)}km`}
                        />
                        <YAxis 
                          stroke="#94a3b8" 
                          fontSize={10} 
                          tickLine={false}
                          tickFormatter={(val) => `${val}m`}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '12px' }}
                          labelStyle={{ color: '#94a3b8', fontSize: '10px' }}
                          itemStyle={{ color: '#fff', fontSize: '12px', fontWeight: 'bold' }}
                          formatter={(value: any) => [`${value} m`, 'Höhe']}
                        />
                        <Area type="monotone" dataKey="elevation" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorEle1)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Graph Track 2 */}
                <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 rounded-2xl flex flex-col shadow-sm">
                  <span className="text-xs font-extrabold text-emerald-600 mb-2 truncate">
                    {track2?.name} ({track2?.distance.toFixed(1)} km)
                  </span>
                  <div className="flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData2} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorEle2" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0.0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.15)" />
                        <XAxis 
                          dataKey="distance" 
                          stroke="#94a3b8" 
                          fontSize={10} 
                          tickLine={false}
                          tickFormatter={(val) => `${val.toFixed(1)}km`}
                        />
                        <YAxis 
                          stroke="#94a3b8" 
                          fontSize={10} 
                          tickLine={false}
                          tickFormatter={(val) => `${val}m`}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '12px' }}
                          labelStyle={{ color: '#94a3b8', fontSize: '10px' }}
                          itemStyle={{ color: '#fff', fontSize: '12px', fontWeight: 'bold' }}
                          formatter={(value: any) => [`${value} m`, 'Höhe']}
                        />
                        <Area type="monotone" dataKey="elevation" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorEle2)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>

            {/* Combined/Aligned Chart Overlay */}
            <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 rounded-2xl space-y-3 shadow-sm">
              <div className="flex flex-col">
                <h4 className="text-xs font-bold text-slate-850 dark:text-slate-200 uppercase tracking-wide">
                  Überlagerungs-Höhenprofil (0% bis 100% Verlauf)
                </h4>
                <p className="text-[10px] text-slate-400">Nutze dieses Diagramm, um das Profil und die Steigungsmuster der beiden Strecken direkt aufeinander abgeglichen zu vergleichen.</p>
              </div>

              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={unifiedChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                    <XAxis 
                      dataKey="percent" 
                      stroke="#94a3b8" 
                      fontSize={10} 
                      tickLine={false}
                      tickFormatter={(val) => `${val}%`}
                    />
                    <YAxis 
                      stroke="#94a3b8" 
                      fontSize={10} 
                      tickLine={false}
                      tickFormatter={(val) => `${val}m`}
                      domain={['auto', 'auto']}
                    />
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.12)" />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '16px', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}
                      labelStyle={{ color: '#94a3b8', fontSize: '10px', fontWeight: 'bold' }}
                      itemStyle={{ fontSize: '12px', fontWeight: 'bold', padding: '2px 0' }}
                      labelFormatter={(pct) => `Routenverlauf: ${pct}%`}
                    />
                    <Area 
                      type="monotone" 
                      name={`${track1?.name || 'Aktivität 1'}`} 
                      dataKey="ele1" 
                      stroke="#3b82f6" 
                      strokeWidth={2.5} 
                      fill="none" 
                    />
                    <Area 
                      type="monotone" 
                      name={`${track2?.name || 'Aktivität 2'}`} 
                      dataKey="ele2" 
                      stroke="#10b981" 
                      strokeWidth={2.5} 
                      fill="none" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>
        )}

        {/* Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800/80 flex justify-end shrink-0 select-none">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-sm transition-all shadow-md active:scale-95"
          >
            Fertig
          </button>
        </div>

      </div>
    </motion.div>
  );
};
