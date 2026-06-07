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
  const [track1Id, setTrack1Id] = useState<string>(tracks[0]?.id || '');
  const [track2Id, setTrack2Id] = useState<string>(tracks[1]?.id || tracks[0]?.id || '');

  const track1 = useMemo(() => tracks.find(t => t.id === track1Id), [tracks, track1Id]);
  const track2 = useMemo(() => tracks.find(t => t.id === track2Id), [tracks, track2Id]);

  const stats1 = useMemo(() => {
    if (!track1) return null;
    const points = track1.points;
    const hasElevation = points.some(p => p.ele !== undefined);
    
    const elevations = points.filter(p => p.ele !== undefined).map(p => p.ele!);
    const maxEle = elevations.length > 0 ? Math.max(...elevations) : 0;
    const minEle = elevations.length > 0 ? Math.min(...elevations) : 0;
    const avgEle = elevations.length > 0 ? elevations.reduce((a, b) => a + b, 0) / elevations.length : 0;

    const hrs = points.filter(p => p.hr !== undefined).map(p => p.hr!);
    const maxHr = hrs.length > 0 ? Math.max(...hrs) : 0;
    const avgHr = hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0;

    const cadences = points.filter(p => p.cadence !== undefined && p.cadence > 0).map(p => p.cadence!);
    const avgCadence = cadences.length > 0 ? cadences.reduce((a, b) => a + b, 0) / cadences.length : 0;

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

    const durationSecs = track1.duration || totalMovingTime || (track1.distance / estimatedSpeed) * 3600;
    const avgSpeed = durationSecs > 0 ? (track1.distance / (durationSecs / 3600)) : estimatedSpeed;
    const maxSpeed = speedPoints.length > 0 ? Math.max(...speedPoints) : Math.max(avgSpeed * 1.5, 25);

    const isRunning = track1?.activityType === 'running';
    let met = 4;
    if (isRunning) {
      if (avgSpeed > 12) met = 12.5;
      else if (avgSpeed > 10) met = 11;
      else if (avgSpeed > 8) met = 9;
      else met = 8;
    } else {
      if (avgSpeed > 30) met = 12;
      else if (avgSpeed > 25) met = 10;
      else if (avgSpeed > 20) met = 8;
      else if (avgSpeed > 15) met = 6;
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
  }, [track1, estimatedSpeed, userWeight]);

  const stats2 = useMemo(() => {
    if (!track2) return null;
    const points = track2.points;
    const hasElevation = points.some(p => p.ele !== undefined);
    
    const elevations = points.filter(p => p.ele !== undefined).map(p => p.ele!);
    const maxEle = elevations.length > 0 ? Math.max(...elevations) : 0;
    const minEle = elevations.length > 0 ? Math.min(...elevations) : 0;
    const avgEle = elevations.length > 0 ? elevations.reduce((a, b) => a + b, 0) / elevations.length : 0;

    const hrs = points.filter(p => p.hr !== undefined).map(p => p.hr!);
    const maxHr = hrs.length > 0 ? Math.max(...hrs) : 0;
    const avgHr = hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0;

    const cadences = points.filter(p => p.cadence !== undefined && p.cadence > 0).map(p => p.cadence!);
    const avgCadence = cadences.length > 0 ? cadences.reduce((a, b) => a + b, 0) / cadences.length : 0;

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

    const isRunning = track2?.activityType === 'running';
    let met = 4;
    if (isRunning) {
      if (avgSpeed > 12) met = 12.5;
      else if (avgSpeed > 10) met = 11;
      else if (avgSpeed > 8) met = 9;
      else met = 8;
    } else {
      if (avgSpeed > 30) met = 12;
      else if (avgSpeed > 25) met = 10;
      else if (avgSpeed > 20) met = 8;
      else if (avgSpeed > 15) met = 6;
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

  // Check if either compared track represents a running activity
  const isRunningComp = useMemo(() => {
    return (track1?.activityType === 'running' || track2?.activityType === 'running');
  }, [track1, track2]);

  // Compute sampled chart records
  const chartData1 = useMemo(() => {
    if (!track1) return [];
    let currentDist = 0;
    
    const rawSpeeds = track1.points.map((p, idx) => {
      if (idx === 0) return 0;
      const p1 = track1.points[idx - 1];
      const d = calculateDistance(p1, p);
      if (p1.time && p.time) {
        const dt = (new Date(p.time).getTime() - new Date(p1.time).getTime()) / 1000;
        if (dt > 0 && dt < 120) {
          return d / (dt / 3600);
        }
      }
      return 0;
    });

    const smoothedSpeeds = rawSpeeds.map((_, i) => {
      const window = 2;
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - window); j <= Math.min(track1.points.length - 1, i + window); j++) {
        if (rawSpeeds[j] !== undefined) {
          sum += rawSpeeds[j];
          count++;
        }
      }
      return count > 0 ? sum / count : 0;
    });

    const raw = track1.points.map((p, idx) => {
      if (idx > 0) {
        currentDist += calculateDistance(track1.points[idx - 1], p);
      }
      const speedValue = smoothedSpeeds[idx] || 0;
      const paceValue = speedValue > 2 ? 60 / speedValue : 0;
      return {
        distance: currentDist,
        elevation: p.ele || 0,
        hr: p.hr || 0,
        power: p.power || 0,
        speed: speedValue,
        pace: paceValue
      };
    });
    return samplePoints(raw, 180);
  }, [track1]);

  const chartData2 = useMemo(() => {
    if (!track2) return [];
    let currentDist = 0;

    const rawSpeeds = track2.points.map((p, idx) => {
      if (idx === 0) return 0;
      const p1 = track2.points[idx - 1];
      const d = calculateDistance(p1, p);
      if (p1.time && p.time) {
        const dt = (new Date(p.time).getTime() - new Date(p1.time).getTime()) / 1000;
        if (dt > 0 && dt < 120) {
          return d / (dt / 3600);
        }
      }
      return 0;
    });

    const smoothedSpeeds = rawSpeeds.map((_, i) => {
      const window = 2;
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - window); j <= Math.min(track2.points.length - 1, i + window); j++) {
        if (rawSpeeds[j] !== undefined) {
          sum += rawSpeeds[j];
          count++;
        }
      }
      return count > 0 ? sum / count : 0;
    });

    const raw = track2.points.map((p, idx) => {
      if (idx > 0) {
        currentDist += calculateDistance(track2.points[idx - 1], p);
      }
      const speedValue = smoothedSpeeds[idx] || 0;
      const paceValue = speedValue > 2 ? 60 / speedValue : 0;
      return {
        distance: currentDist,
        elevation: p.ele || 0,
        hr: p.hr || 0,
        power: p.power || 0,
        speed: speedValue,
        pace: paceValue
      };
    });
    return samplePoints(raw, 180);
  }, [track2]);

  // Unified overlay charts for comparative overlay
  const unifiedChartData = useMemo(() => {
    if (chartData1.length === 0 || chartData2.length === 0) return [];
    const pointsCount = 100;
    const data: { 
      percent: number; 
      ele1?: number; ele2?: number; 
      power1?: number; power2?: number; 
      hr1?: number; hr2?: number;
      speed1?: number; speed2?: number;
      pace1?: number; pace2?: number;
    }[] = [];
    
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
        hr2: Math.round(chartData2[index2]?.hr || 0),
        speed1: Number((chartData1[index1]?.speed || 0).toFixed(1)),
        speed2: Number((chartData2[index2]?.speed || 0).toFixed(1)),
        pace1: Number((chartData1[index1]?.pace || 0).toFixed(2)),
        pace2: Number((chartData2[index2]?.pace || 0).toFixed(2)),
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

  const formatPaceDecimal = (paceDecimal: number | undefined) => {
    if (!paceDecimal || paceDecimal === Infinity || paceDecimal <= 0) return '--:--';
    const mins = Math.floor(paceDecimal);
    const secs = Math.round((paceDecimal - mins) * 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}/km`;
  };

  // State to toggle metrics on diagrams
  const [compareChartMetric, setCompareChartMetric] = useState<string>(
    isRunningComp ? 'pace' : 'elevation'
  );

  const [overlayChartMetric, setOverlayChartMetric] = useState<string>(
    isRunningComp ? 'pace' : 'elevation'
  );

  // Available comparison chart metrics definitions
  const chartMetricsDef = [
    { key: 'elevation', label: 'Höhenprofil [m]', color1: '#3b82f6', color2: '#10b981', displayFn: (v: number) => `${v} m` },
    { key: 'pace', label: 'Pace / Tempo [min/km]', color1: '#f97316', color2: '#06b6d4', isPace: true, displayFn: (v: number) => formatPaceDecimal(v) },
    { key: 'speed', label: 'Geschwindigkeit [km/h]', color1: '#a855f7', color2: '#eab308', displayFn: (v: number) => `${v.toFixed(1)} km/h` },
    { key: 'hr', label: 'Herzfrequenz [bpm]', color1: '#ef4444', color2: '#ec4899', displayFn: (v: number) => `${v} bpm` },
    { key: 'power', label: 'Leistung / Watt [W]', color1: '#facc15', color2: '#14b8a6', displayFn: (v: number) => `${v} W` }
  ];

  const allowedMetrics = chartMetricsDef.filter(m => {
    if (m.key === 'hr' && !tracks.some(t => t.points.some(p => p.hr !== undefined))) return false;
    if (m.key === 'power' && !tracks.some(t => t.points.some(p => p.power !== undefined))) return false;
    return true;
  });

  const activeCompareDef = chartMetricsDef.find(m => m.key === compareChartMetric) || chartMetricsDef[0];
  const activeOverlayDef = chartMetricsDef.find(m => m.key === overlayChartMetric) || chartMetricsDef[0];

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm p-4 sm:p-6 md:p-10 flex items-center justify-center overflow-hidden"
    >
      <div className="bg-white dark:bg-slate-900 w-full max-w-6xl h-full rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-900 dark:text-zinc-100">
        
        {/* Header Section */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-100 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400 rounded-2xl">
              <ArrowLeftRight size={24} className="stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Aktivitäten-Vergleich</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest font-extrabold text-indigo-650 dark:text-indigo-400">
                {isRunningComp ? '🏃‍♀️ Lauf- & Sportdatenanalyse' : '🚴‍♀️ Radsport Leistungsanalyse'}
              </p>
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
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: '#2563eb' }} />
                  Aktivität 1 (Blau/Referenz)
                </label>
                <select
                  value={track1Id}
                  onChange={(e) => setTrack1Id(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-xl px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800 dark:text-slate-100"
                >
                  {tracks.map(t => (
                    <option key={t.id} value={t.id} disabled={t.id === track2Id}>
                      {t.name} ({t.distance.toFixed(1)} km - {t.activityType === 'running' ? '🏃 Laufen' : '🚴 Rad'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black tracking-wider text-slate-500 uppercase flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: '#10b981' }} />
                  Aktivität 2 (Grün)
                </label>
                <select
                  value={track2Id}
                  onChange={(e) => setTrack2Id(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-xl px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800 dark:text-slate-100"
                >
                  {tracks.map(t => (
                    <option key={t.id} value={t.id} disabled={t.id === track1Id}>
                      {t.name} ({t.distance.toFixed(1)} km - {t.activityType === 'running' ? '🏃 Laufen' : '🚴 Rad'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Side-by-Side Numerical Stat Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Category: Streckendaten */}
              <div className="bg-slate-50/40 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 p-5 rounded-2xl space-y-4">
                <h4 className="text-xs font-black tracking-wider text-slate-400 uppercase flex items-center gap-1.5 font-sans">
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
                      Ø Pace / Ø Geschwindigkeit
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

              {/* Category: Leistungsanalyse (Power / HR Stats) */}
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

                  {/* Normalized Power */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Normalized Power</span>
                    <div className="grid grid-cols-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                      <div className="p-1">
                        {track1?.powerStats?.normalizedPower ? `${Math.round(track1.powerStats.normalizedPower)} W` : 'Keine Daten'}
                      </div>
                      <div className="p-1 border-l border-slate-100 dark:border-slate-800 pl-2">
                        {track2?.powerStats?.normalizedPower ? `${Math.round(track2.powerStats.normalizedPower)} W` : 'Keine Daten'}
                      </div>
                    </div>
                  </div>

                  {/* Avg Heart Rate */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Ø Heart Rate (Puls)</span>
                    <div className="grid grid-cols-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                      <div className={`p-1 rounded ${stats1 && stats2 && stats1.avgHr >= stats2.avgHr ? 'bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 font-black' : ''}`}>
                        {stats1?.avgHr ? `${Math.round(stats1.avgHr)} bpm` : 'Keine Daten'}
                      </div>
                      <div className={`p-1 rounded border-l border-slate-100 dark:border-slate-800 pl-2 ${stats1 && stats2 && stats2.avgHr > stats1.avgHr ? 'bg-teal-50/50 dark:bg-teal-950/20 text-teal-600 dark:text-teal-400 font-black' : ''}`}>
                        {stats2?.avgHr ? `${Math.round(stats2.avgHr)} bpm` : 'Keine Daten'}
                      </div>
                    </div>
                  </div>

                  {/* Max Heart Rate */}
                  <div className="flex flex-col gap-1 p-2 bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-slate-900 rounded-xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Maximaler Puls</span>
                    <div className="grid grid-cols-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                      <div className="p-1">
                        {stats1?.maxHr ? `${stats1.maxHr} bpm` : 'Keine Daten'}
                      </div>
                      <div className="p-1 border-l border-slate-100 dark:border-slate-800 pl-2">
                        {stats2?.maxHr ? `${stats2.maxHr} bpm` : 'Keine Daten'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Dynamic Diagrams Comparison Suite */}
            <div className="space-y-6 pt-4 border-t border-slate-200 dark:border-slate-800">
              
              {/* Section 1: Side by Side Comparative Diagrams */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                      <Activity className="w-5 h-5 text-indigo-500" />
                      Side-by-Side Diagramm-Vergleich
                    </h3>
                    <p className="text-xs text-slate-400">Vergleiche die Aktivitätsprofile über die absolute Distanz.</p>
                  </div>
                  
                  {/* Selector Tabs matching "Mache zusätzliche Metriken in den Diagrammen verfügbar" */}
                  <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
                    {allowedMetrics.map(m => (
                      <button
                        key={m.key}
                        onClick={() => setCompareChartMetric(m.key)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                          compareChartMetric === m.key 
                            ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-white shadow-xs' 
                            : 'text-slate-500 hover:text-slate-705'
                        }`}
                      >
                        {m.label.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-64 text-zinc-900">
                  {/* Graph 1 */}
                  <div className="border border-slate-200 dark:border-slate-810 bg-white dark:bg-slate-900 p-4 rounded-2xl flex flex-col shadow-sm">
                    <span className="text-xs font-black text-blue-600 dark:text-blue-400 mb-2 truncate">
                      {track1?.name} ({track1?.distance.toFixed(1)} km)
                    </span>
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData1} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="compGrad1" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={activeCompareDef.color1} stopOpacity={0.35}/>
                              <stop offset="95%" stopColor={activeCompareDef.color1} stopOpacity={0.0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.15)" />
                          <XAxis 
                            dataKey="distance" 
                            fontSize={10} 
                            tickLine={false}
                            stroke="rgba(148, 163, 184, 0.6)"
                            tickFormatter={(val) => `${val.toFixed(1)}km`}
                          />
                          <YAxis 
                            fontSize={10} 
                            tickLine={false}
                            stroke="rgba(148, 163, 184, 0.6)"
                            tickFormatter={(val) => activeCompareDef.key === 'pace' ? formatPaceDecimal(val) : `${val}`}
                            domain={['auto', 'auto']}
                            reversed={activeCompareDef.isPace}
                          />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '12px' }}
                            labelStyle={{ color: '#94a3b8', fontSize: '10px' }}
                            itemStyle={{ color: '#fff', fontSize: '12px', fontWeight: 'bold' }}
                            formatter={(value: any) => [activeCompareDef.displayFn(value), activeCompareDef.label.split(' ')[0]]}
                          />
                          <Area type="monotone" dataKey={activeCompareDef.key} stroke={activeCompareDef.color1} strokeWidth={2.5} fillOpacity={1} fill="url(#compGrad1)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Graph 2 */}
                  <div className="border border-slate-200 dark:border-slate-810 bg-white dark:bg-slate-900 p-4 rounded-2xl flex flex-col shadow-sm">
                    <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 mb-2 truncate">
                      {track2?.name} ({track2?.distance.toFixed(1)} km)
                    </span>
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData2} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="compGrad2" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={activeCompareDef.color2} stopOpacity={0.35}/>
                              <stop offset="95%" stopColor={activeCompareDef.color2} stopOpacity={0.0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.15)" />
                          <XAxis 
                            dataKey="distance" 
                            fontSize={10} 
                            tickLine={false}
                            stroke="rgba(148, 163, 184, 0.6)"
                            tickFormatter={(val) => `${val.toFixed(1)}km`}
                          />
                          <YAxis 
                            fontSize={10} 
                            tickLine={false}
                            stroke="rgba(148, 163, 184, 0.6)"
                            tickFormatter={(val) => activeCompareDef.key === 'pace' ? formatPaceDecimal(val) : `${val}`}
                            domain={['auto', 'auto']}
                            reversed={activeCompareDef.isPace}
                          />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '12px' }}
                            labelStyle={{ color: '#94a3b8', fontSize: '10px' }}
                            itemStyle={{ color: '#fff', fontSize: '12px', fontWeight: 'bold' }}
                            formatter={(value: any) => [activeCompareDef.displayFn(value), activeCompareDef.label.split(' ')[0]]}
                          />
                          <Area type="monotone" dataKey={activeCompareDef.key} stroke={activeCompareDef.color2} strokeWidth={2.5} fillOpacity={1} fill="url(#compGrad2)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Unified aligned Overlay Diagram (0% to 100% path) */}
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-2xl space-y-4 shadow-sm text-zinc-900 dark:text-zinc-100">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                  <div>
                    <h4 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                      Direkter Überlagerungsvergleich (Skalierter Routenverlauf 0-100%)
                    </h4>
                    <p className="text-[10px] text-slate-400">Perfekt angeglichener Vergleich über den relativen Fortschritt des Tracks.</p>
                  </div>

                  {/* Selector tab for overlay */}
                  <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800 self-start sm:self-auto">
                    {allowedMetrics.map(m => (
                      <button
                        key={m.key}
                        onClick={() => setOverlayChartMetric(m.key)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                          overlayChartMetric === m.key 
                            ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-white shadow-xs' 
                            : 'text-slate-500 hover:text-slate-705'
                        }`}
                      >
                        {m.label.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={unifiedChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                        tickFormatter={(val) => activeOverlayDef.key === 'pace' ? formatPaceDecimal(val) : `${val}`}
                        domain={['auto', 'auto']}
                        reversed={activeOverlayDef.isPace}
                      />
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.12)" />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '16px', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}
                        labelStyle={{ color: '#94a3b8', fontSize: '10px', fontWeight: 'bold' }}
                        itemStyle={{ fontSize: '12px', fontWeight: 'bold', padding: '2px 0' }}
                        labelFormatter={(pct) => `Relative Position: ${pct}%`}
                      />
                      <Area 
                        type="monotone" 
                        name={`${track1?.name || 'Aktivität 1'}`} 
                        dataKey={activeOverlayDef.key === 'elevation' ? 'ele1' : activeOverlayDef.key + '1'} 
                        stroke={activeOverlayDef.color1} 
                        strokeWidth={2.5} 
                        fill="none" 
                      />
                      <Area 
                        type="monotone" 
                        name={`${track2?.name || 'Aktivität 2'}`} 
                        dataKey={activeOverlayDef.key === 'elevation' ? 'ele2' : activeOverlayDef.key + '2'} 
                        stroke={activeOverlayDef.color2} 
                        strokeWidth={2.5} 
                        fill="none" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800/80 flex justify-end shrink-0 select-none">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-sm transition-all shadow-md active:scale-95 cursor-pointer"
          >
            Fertig
          </button>
        </div>

      </div>
    </motion.div>
  );
};
