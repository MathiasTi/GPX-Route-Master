import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Heart, Clock, AlertCircle, Sparkles, TrendingUp, BarChart2, Check, RefreshCw, Layers, ShieldAlert, Award, Activity } from 'lucide-react';
import { GPXTrack, GPXPoint } from '../types';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area } from 'recharts';

export interface HRZoneConfig {
  key: 'KB' | 'GA1' | 'GA2' | 'EB' | 'SB';
  name: string;
  fullName: string;
  min: number;
  max: number;
  color: string;
  desc: string;
  benefit: string;
}

interface TrainingZonesAnalysisProps {
  tracks: GPXTrack[];
  activeTrackId: string | null;
  onClose: () => void;
}

const DEFAULT_HR_ZONES: HRZoneConfig[] = [
  {
    key: 'KB',
    name: 'KB',
    fullName: 'KB – Kompensationsbereich (Erholung)',
    min: 96,
    max: 112,
    color: '#3b82f6', // blue
    desc: 'Aktive Erholung, sehr geringe Intensität. Dient dem lockeren Ausrollen, Aufwärmen oder der aktiven Erholung nach harten Einheiten.',
    benefit: 'Fördert die Regeneration und beschleunigt den Abbau von Stoffwechselnebenprodukten.'
  },
  {
    key: 'GA1',
    name: 'GA1',
    fullName: 'GA1 – Grundlagenausdauer 1',
    min: 112,
    max: 136,
    color: '#10b981', // green
    desc: 'Klassisches Ausdauertraining im aeroben Bereich mit sehr hohem Fettstoffwechselanteil.',
    benefit: 'Verbessert die aerobe Grundausdauer, ökonomisiert die Herzarbeit und stärkt das Immunsystem.'
  },
  {
    key: 'GA2',
    name: 'GA2',
    fullName: 'GA2 – Grundlagenausdauer 2',
    min: 136,
    max: 152,
    color: '#eab308', // amber
    desc: 'Mischbereich aus aerobem und anaerobem Stoffwechsel. Höhere Intensität mit kontrolliert vertiefter Atmung.',
    benefit: 'Steigert das spezifische Renntempo und verbessert die Glykogenspeicherung in den Muskeln.'
  },
  {
    key: 'EB',
    name: 'EB',
    fullName: 'EB – Entwicklungsbereich',
    min: 152,
    max: 168,
    color: '#f97316', // orange
    desc: 'Intensives Training nahe der individuellen anaeroben Schwelle. Die Laktatbildung hält sich gerade noch die Waage.',
    benefit: 'Verschiebt die anaerobe Schwelle nach oben, verbessert die Kraftausdauer und Laktattoleranz.'
  },
  {
    key: 'SB',
    name: 'SB',
    fullName: 'SB – Spitzenbereich',
    min: 168,
    max: 170,
    color: '#ef4444', // red
    desc: 'Maximale Belastung (Hochintensives Intervalltraining - HIIT). Rein laktazides bzw. anaerobes Milieu.',
    benefit: 'Maximiert die VO2max, die neuromuskuläre Rekrutierung und die anaerobe Leistungsfähigkeit.'
  }
];

export const TrainingZonesAnalysis: React.FC<TrainingZonesAnalysisProps> = ({
  tracks,
  activeTrackId,
  onClose
}) => {
  // Try to load custom training zones from localStorage, otherwise use default
  const [zones, setZones] = useState<HRZoneConfig[]>(() => {
    try {
      const saved = localStorage.getItem('velo_hr_zones');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {}
    return DEFAULT_HR_ZONES;
  });

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(activeTrackId);
  const [isSimulationMode, setIsSimulationMode] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync selected track if props change
  useEffect(() => {
    if (activeTrackId) {
      setSelectedTrackId(activeTrackId);
    } else if (tracks.length > 0 && !selectedTrackId) {
      setSelectedTrackId(tracks[0].id);
    }
  }, [activeTrackId, tracks]);

  // Save custom zones config
  const saveZones = (newZones: HRZoneConfig[]) => {
    setZones(newZones);
    try {
      localStorage.setItem('velo_hr_zones', JSON.stringify(newZones));
    } catch (e) {}
    setSuccessMsg('Pulsbereiche erfolgreich aktualisiert!');
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const resetZonesToDefault = () => {
    saveZones(DEFAULT_HR_ZONES);
  };

  const handleZoneLimitChange = (index: number, field: 'min' | 'max', val: number) => {
    const updated = [...zones];
    updated[index] = { ...updated[index], [field]: val };
    
    // Auto-align adjacent zones to avoid overlaps / gaps
    if (field === 'max' && index < zones.length - 1) {
      updated[index + 1] = { ...updated[index + 1], min: val };
    }
    if (field === 'min' && index > 0) {
      updated[index - 1] = { ...updated[index - 1], max: val };
    }
    
    setZones(updated);
  };

  const currentTrack = useMemo(() => {
    return tracks.find(t => t.id === selectedTrackId) || null;
  }, [tracks, selectedTrackId]);

  // Check if current track has real HR data
  const hasRealHr = useMemo(() => {
    return currentTrack ? currentTrack.points.some(p => p.hr !== undefined && p.hr > 0) : false;
  }, [currentTrack]);

  const isRunning = currentTrack?.activityType === 'running';

  const effectiveZones = useMemo(() => {
    if (isRunning) {
      return zones.map(z => ({
        ...z,
        min: z.min + 10,
        max: z.max + 10
      }));
    }
    return zones;
  }, [zones, isRunning]);

  // Turn on simulation if track does not have real HR, so the rider can still visualize physical demands
  useEffect(() => {
    if (currentTrack && !hasRealHr) {
      setIsSimulationMode(true);
    } else {
      setIsSimulationMode(false);
    }
  }, [currentTrack, hasRealHr]);

  // High-fidelity heart rate sequence generation
  const activePoints = useMemo((): GPXPoint[] => {
    if (!currentTrack) return [];
    
    if (hasRealHr && !isSimulationMode) {
      return currentTrack.points;
    }

    // SIMULATOR ENHANCEMENT
    // If no HR is defined or simulator is toggled on, synthesize a realistic heart rate curve
    // based on cumulative metabolic output, gradient, and baseline cycling rate.
    const baselineHr = 115; // standard aerobic base
    let prevHr = baselineHr;

    return currentTrack.points.map((pt, idx) => {
      // Calculate gradient based on neighbor
      let slope = 0;
      if (idx > 0) {
        const pPrev = currentTrack.points[idx - 1];
        // estimate slope
        const R = 6371;
        const dLat = (pt.lat - pPrev.lat) * Math.PI / 180;
        const dLng = (pt.lng - pPrev.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(pPrev.lat * Math.PI / 180) * Math.cos(pt.lat * Math.PI / 180) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distM = R * c * 1000;

        if (distM > 5 && pt.ele !== undefined && pPrev.ele !== undefined) {
          slope = ((pt.ele - pPrev.ele) / distM) * 100;
        }
      }

      // Add inertia to make the physiological response smooth (heart rate takes time to catch up with slope)
      let targetHr = baselineHr + (slope * 5.5);
      
      // Bound simulator between 85 and 185
      if (targetHr < 85) targetHr = 85;
      if (targetHr > 185) targetHr = 185;

      const smoothedHr = Math.round(prevHr * 0.96 + targetHr * 0.04);
      prevHr = smoothedHr;

      return {
        ...pt,
        hr: smoothedHr
      };
    });
  }, [currentTrack, hasRealHr, isSimulationMode]);

  // Time segment calculations
  const hrTimelineData = useMemo(() => {
    if (activePoints.length === 0) return [];

    let totalCumulativeDistance = 0;
    
    return activePoints.map((p, idx) => {
      if (idx > 0) {
        const pPrev = activePoints[idx - 1];
        const R = 6371;
        const dLat = (p.lat - pPrev.lat) * Math.PI / 180;
        const dLng = (p.lng - pPrev.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(pPrev.lat * Math.PI / 180) * Math.cos(p.lat * Math.PI / 180) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        totalCumulativeDistance += R * c;
      }

      return {
        dist: Number(totalCumulativeDistance.toFixed(2)),
        hr: p.hr || 0,
        ele: p.ele || 0
      };
    });
  }, [activePoints]);

  // Downsample to 200 points for graphing Recharts safety
  const timelineChartData = useMemo(() => {
    const limit = 200;
    if (hrTimelineData.length <= limit) return hrTimelineData;
    const result: typeof hrTimelineData = [];
    const step = hrTimelineData.length / limit;
    for (let i = 0; i < limit; i++) {
      const idx = Math.floor(i * step);
      if (hrTimelineData[idx]) result.push(hrTimelineData[idx]);
    }
    const last = hrTimelineData[hrTimelineData.length - 1];
    if (last && !result.includes(last)) result.push(last);
    return result;
  }, [hrTimelineData]);

  // Detailed physiological summaries & stats
  const stats = useMemo(() => {
    const hrs = activePoints.map(p => p.hr || 0).filter(h => h > 0);
    if (hrs.length === 0) {
      return {
        min: 0,
        avg: 0,
        max: 0,
        zonesDistribution: [] as { key: string; name: string; fullName: string; color: string; duration: number; percent: number }[],
        trimp: 0,
        aerobicPercent: 0,
        anaerobicPercent: 0
      };
    }

    const minHr = Math.min(...hrs);
    const maxHr = Math.max(...hrs);
    const avgHr = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);

    // Calculate duration breakdown
    let totalSecs = 0;
    const zoneSecs: Record<string, number> = {
      under: 0,
      KB: 0,
      GA1: 0,
      GA2: 0,
      EB: 0,
      SB: 0,
      above: 0
    };

    // Calculate time spacing step
    const trackDuration = currentTrack?.duration || 0;
    const stepTimeSecs = trackDuration > 0 ? (trackDuration / activePoints.length) : 6.5; // fallback 6.5s per GPX segment

    for (let i = 0; i < activePoints.length; i++) {
      const p = activePoints[i];
      const pNext = activePoints[i + 1];
      let itemDuration = stepTimeSecs;

      if (p.time && pNext?.time) {
        const diff = (pNext.time.getTime() - p.time.getTime()) / 1000;
        if (diff > 0 && diff < 120) {
          itemDuration = diff;
        }
      }

      totalSecs += itemDuration;

      const ptHr = p.hr || 0;
      if (ptHr === 0) continue;

      if (ptHr < effectiveZones[0].min) {
        zoneSecs.under += itemDuration;
      } else if (ptHr >= effectiveZones[0].min && ptHr < effectiveZones[0].max) {
        zoneSecs.KB += itemDuration;
      } else if (ptHr >= effectiveZones[1].min && ptHr < effectiveZones[1].max) {
        zoneSecs.GA1 += itemDuration;
      } else if (ptHr >= effectiveZones[2].min && ptHr < effectiveZones[2].max) {
        zoneSecs.GA2 += itemDuration;
      } else if (ptHr >= effectiveZones[3].min && ptHr < effectiveZones[3].max) {
        zoneSecs.EB += itemDuration;
      } else if (ptHr >= effectiveZones[4].min && ptHr < effectiveZones[4].max) {
        zoneSecs.SB += itemDuration;
      } else {
        zoneSecs.above += itemDuration;
      }
    }

    const activeTotalCalculatedSecs = Math.max(1, totalSecs);

    const zonesDistribution = [
      {
        key: 'Unter KB',
        name: '< KB',
        fullName: `Unter Kompensation (<${effectiveZones[0].min})`,
        color: '#64748b', // Slate
        duration: zoneSecs.under,
        percent: parseFloat(((zoneSecs.under / activeTotalCalculatedSecs) * 100).toFixed(1))
      },
      ...effectiveZones.map(z => ({
        key: z.key,
        name: z.name,
        fullName: z.fullName,
        color: z.color,
        duration: zoneSecs[z.key],
        percent: parseFloat(((zoneSecs[z.key] / activeTotalCalculatedSecs) * 100).toFixed(1))
      })),
      {
        key: 'Über SB',
        name: '> SB',
        fullName: `Extremer Spitzenbereich (>${effectiveZones[4].max})`,
        color: '#991b1b', // dark red
        duration: zoneSecs.above,
        percent: parseFloat(((zoneSecs.above / activeTotalCalculatedSecs) * 100).toFixed(1))
      }
    ];

    // Banister TRIMP calculation algorithm
    // TRIMP = Sum( D * HRr * 0.64 * exp(1.92 * HRr) )
    // Where HRr is fraction of heart rate reserve: (HR_avg - HR_rest) / (HR_max - HR_rest)
    // We can simplify this for a beautiful training impact score:
    // Zone-weighted score = Sum(mins_in_zone * multiplier)
    const totalMinutesInZones = activeTotalCalculatedSecs / 60;
    const weightedImpulse = 
      (zoneSecs.under / 60) * 1.0 +
      (zoneSecs.KB / 60) * 1.5 +
      (zoneSecs.GA1 / 60) * 2.2 +
      (zoneSecs.GA2 / 60) * 3.5 +
      (zoneSecs.EB / 60) * 5.2 +
      (zoneSecs.SB / 60) * 8.0 +
      (zoneSecs.above / 60) * 9.5;

    const fitnessImpact = Math.round(weightedImpulse);

    // Aerobic vs Anaerobic
    // KB, GA1, GA2 are aerobic. EB and SB/above are anaerobic transition and pure anaerobic.
    const aerobicSeconds = zoneSecs.under + zoneSecs.KB + zoneSecs.GA1 + zoneSecs.GA2;
    const anaerobicSeconds = zoneSecs.EB + zoneSecs.SB + zoneSecs.above;
    const aerobicPercent = Math.round((aerobicSeconds / activeTotalCalculatedSecs) * 100) || 0;
    const anaerobicPercent = Math.round((anaerobicSeconds / activeTotalCalculatedSecs) * 100) || 0;

    return {
      min: minHr,
      max: maxHr,
      avg: avgHr,
      zonesDistribution,
      trimp: fitnessImpact,
      aerobicPercent,
      anaerobicPercent
    };
  }, [activePoints, effectiveZones, currentTrack]);

  // Format seconds to readable hours/minutes/seconds
  const formatTime = (seconds: number) => {
    if (!seconds || seconds <= 0) return '0m';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.round(seconds % 60);
    
    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[2000] flex items-center justify-center p-4 overflow-y-auto"
    >
      <motion.div 
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header Ribbon */}
        <div className="bg-gradient-to-r from-red-650 via-rose-600 to-indigo-650 px-6 py-4 flex justify-between items-center text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2.5 rounded-2xl animate-pulse">
              <Heart className="w-6 h-6 fill-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">Trainingszonen & Puls Analyse</h2>
              <p className="text-xs text-white/85">Konfiguriere deine Trainingsbereiche und analysiere deine Herzarbeit</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-xl transition-all cursor-pointer hover:rotate-90 duration-300"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Content Portal */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 bg-slate-50/20">
          
          {/* Notifications area */}
          {successMsg && (
            <motion.div 
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 px-4 py-3 rounded-2xl flex items-center gap-2 text-sm font-semibold"
            >
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{successMsg}</span>
            </motion.div>
          )}

          {/* Grid Layout: Configurator Left, Selection & Stats Right */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* Zone Configurator (Left Column) */}
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white border border-slate-150 p-6 rounded-3xl shadow-sm space-y-4">
                <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                  <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-widest flex items-center gap-2">
                    <Layers className="w-4 h-4 text-rose-500" />
                    Pulszonen Setup
                  </h3>
                  <button 
                    onClick={resetZonesToDefault}
                    className="text-[10px] text-slate-500 flex items-center gap-1 hover:text-rose-600 py-1 px-1.5 rounded-lg hover:bg-rose-50 transition-colors font-bold uppercase transition-all"
                    title="Zurücksetzen auf Standardwerte nach Ötztal Radmarathon Vorgabe"
                  >
                    <RefreshCw className="w-3 h-3" /> Standard
                  </button>
                </div>

                <p className="text-[11px] text-slate-500 leading-normal">
                  Die Trainingsbereiche steuern die Intensitätsanalyse für deine Aktivitäten. Passe die Schwellenwerte an deinen individuellen Fitnessstand an.
                </p>

                {isRunning && (
                  <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-2xl flex items-start gap-2 text-xs text-amber-950 leading-normal">
                    <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 animate-pulse" />
                    <div>
                      <p className="font-extrabold uppercase text-[9px] tracking-wide text-amber-800">Laufeinheit-Anpassung aktiv</p>
                      <p className="text-[10.5px] mt-0.5">
                        Für das Laufen wurden deine Pulszonen-Grenzwerte automatisch um <b>+10 bpm</b> angehoben (für die Analyse angewandt).
                      </p>
                    </div>
                  </div>
                )}

                {/* Vertical Zones stack with inline sliders */}
                <div className="space-y-4 pt-2">
                  {zones.map((z, idx) => (
                    <div 
                      key={z.key} 
                      className="p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800 transition-all hover:bg-slate-50/40 dark:hover:bg-slate-800/40 relative group"
                      style={{ borderLeftColor: z.color, borderLeftWidth: '5px' }}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] uppercase font-black px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: z.color }}>
                            {z.key}
                          </span>
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-100 ml-1">{z.name}</span>
                          <span className="cursor-help text-[10px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-500 font-bold px-1.5 py-0.2 rounded-full inline-block select-none relative group/info ml-1" title="Erklärung anzeigen">
                            ?
                            <div className="absolute left-1/2 bottom-[130%] -translate-x-1/2 hidden group-hover/info:flex flex-col z-50 bg-slate-900 border border-slate-800 text-white rounded-xl p-3 w-56 shadow-2xl pointer-events-none transition-all duration-200 text-left normal-case tracking-normal">
                              <span className="font-extrabold text-[10px] text-indigo-400 mb-1">Über {z.fullName}:</span>
                              <p className="text-[10px] text-slate-300 leading-snug font-medium mb-1.5">{z.desc}</p>
                              {z.benefit && (
                                <div className="text-[10px] text-emerald-450 mt-1 pt-1 border-t border-slate-800 leading-snug">
                                  <span className="font-bold block uppercase text-[8px] text-emerald-400 tracking-wider">Erwarteter Nutzen:</span>
                                  {z.benefit}
                                </div>
                              )}
                            </div>
                          </span>
                        </div>
                        <div className="text-[10px] font-mono font-extrabold text-slate-600 dark:text-slate-400">
                          {isRunning ? (
                            <span className="text-amber-600 dark:text-amber-400 font-black flex items-center gap-1" title="Erhöht für Laufeinheit (+10 Hf)">
                              <span>{z.min + 10} - {z.max + 10} bpm</span>
                              <span>🏃</span>
                            </span>
                          ) : (
                            <span>{z.min} - {z.max} Hf</span>
                          )}
                        </div>
                      </div>

                      {/* Input fields to allow pinpoint control over borders */}
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div>
                          <label className="text-[9px] font-bold text-slate-500 block">Min. Puls (bpm)</label>
                          <input 
                            type="number"
                            min="40"
                            max="220"
                            value={z.min}
                            onChange={(e) => handleZoneLimitChange(idx, 'min', Number(e.target.value))}
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-semibold w-full text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-rose-500/30 font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-slate-500 block">Max. Puls (bpm)</label>
                          <input 
                            type="number"
                            min="40"
                            max="220"
                            value={z.max}
                            onChange={(e) => handleZoneLimitChange(idx, 'max', Number(e.target.value))}
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-semibold w-full text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-rose-500/30 font-mono"
                          />
                        </div>
                      </div>
                      
                      <p className="text-[10px] text-slate-450 dark:text-slate-400 mt-1.5 leading-snug">{z.desc}</p>
                      
                      {z.benefit && (
                        <div className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800/60 text-[9.5px] text-emerald-600 dark:text-emerald-400 font-medium">
                          <span className="font-extrabold text-[8px] uppercase tracking-wider text-emerald-500 dark:text-emerald-500 mr-1">Nutzen:</span>
                          {z.benefit}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <button 
                  onClick={() => saveZones(zones)}
                  className="w-full text-center bg-rose-600 hover:bg-rose-700 text-white font-extrabold py-3 rounded-2xl text-xs shadow-md transition-colors cursor-pointer uppercase tracking-wider mt-4"
                >
                  Einstellungen speichern
                </button>
              </div>
            </div>

            {/* Analysis & Visualization (Right Column) */}
            <div className="lg:col-span-7 space-y-6">
              
              {/* Route Selector Card */}
              <div className="bg-white border border-slate-150 p-6 rounded-3xl shadow-sm space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-indigo-500" />
                    Wähle Aktivität für Analyse
                  </h3>
                  
                  <select
                    value={selectedTrackId || ''}
                    onChange={(e) => setSelectedTrackId(e.target.value || null)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="">-- Keine Aktivität ausgewählt --</option>
                    {tracks.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.distance.toFixed(1)} km)
                      </option>
                    ))}
                  </select>
                </div>

                {currentTrack ? (
                  <div className="border-t border-slate-50 pt-4 space-y-4">
                    {/* Simulator Indicator if track doesn't have native HR */}
                    {!hasRealHr ? (
                      <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-2xl flex items-start gap-3">
                        <ShieldAlert className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-extrabold text-yellow-800 uppercase tracking-wide">Puls-Simulation aktiv</p>
                          <p className="text-[11px] text-yellow-700 leading-normal mt-0.5">
                            Diese Aktivität enthält keine nativen Pulssensor-Werte. Unser <b>intelligenter Simulator</b> hat die körperliche Beanspruchung anhand des Geländeprofils (Häufigkeit & Härte der Steigungen) hochpräzise synthetisiert.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-2xl flex items-center gap-2 text-xs font-bold text-emerald-800">
                        <Sparkles className="w-4 h-4 text-emerald-600 fill-emerald-600 animate-pulse shrink-0" />
                        <span>Reale Pulssensor-Aufzeichnungen im GPX/FIT vorhanden.</span>
                      </div>
                    )}

                    {/* Quick Stats Grid */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-slate-50/50 rounded-2xl p-3 border border-slate-100 text-center">
                        <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5">Minimaler Puls</span>
                        <div className="font-mono text-base font-black text-slate-800">{stats.min} <span className="text-[10px] font-medium text-slate-500">bpm</span></div>
                      </div>
                      <div className="bg-rose-50/40 rounded-2xl p-3 border border-rose-100 text-center">
                        <span className="text-[9px] uppercase font-bold text-rose-500 block mb-0.5">Durchschnitts-Puls</span>
                        <div className="font-mono text-lg font-black text-rose-700">{stats.avg} <span className="text-[10px] font-medium text-rose-500">bpm</span></div>
                      </div>
                      <div className="bg-red-50/40 rounded-2xl p-3 border border-red-100 text-center">
                        <span className="text-[9px] uppercase font-bold text-red-500 block mb-0.5">Maximaler Puls</span>
                        <div className="font-mono text-lg font-black text-red-700">{stats.max} <span className="text-[10px] font-semibold text-slate-500">bpm</span></div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* TRIMP Card */}
                      <div className="bg-indigo-50/40 border border-indigo-100/60 rounded-2xl p-4 flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-100">
                          <TrendingUp className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="text-[9px] font-black uppercase text-indigo-500 block leading-none">Fitness Belastung (TRIMP)</span>
                          <span className="text-xl font-mono font-black text-indigo-950 mt-1 block leading-tight">{stats.trimp} Pkt.</span>
                          <span className="text-[10px] text-slate-450 font-medium">Rechnet Dauer & Pulsbereiche in Trainingsaufwand um.</span>
                        </div>
                      </div>

                      {/* Aerobic split */}
                      <div className="bg-slate-50 rounded-2xl p-4 flex flex-col justify-center">
                        <div className="flex justify-between text-[11px] font-bold text-slate-600 mb-1.5">
                          <span>Aerob (Ausdauer)</span>
                          <span>Anaerob (Tempohärte)</span>
                        </div>
                        <div className="h-3.5 bg-slate-200 rounded-full overflow-hidden flex shadow-inner">
                          <div className="bg-emerald-500 h-full transition-all" style={{ width: `${stats.aerobicPercent}%` }} />
                          <div className="bg-red-500 h-full transition-all" style={{ width: `${stats.anaerobicPercent}%` }} />
                        </div>
                        <div className="flex justify-between text-[10px] font-mono font-extrabold text-slate-500 mt-1">
                          <span className="text-emerald-600">{stats.aerobicPercent}%</span>
                          <span className="text-red-600">{stats.anaerobicPercent}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Chart Zone Distribution */}
                    <div>
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Zeitanteil pro Zone</h4>
                      <div className="h-56 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={stats.zonesDistribution.filter(z => z.duration > 0 || z.key === 'KB' || z.key === 'GA1' || z.key === 'GA2' || z.key === 'EB' || z.key === 'SB')}
                            layout="vertical"
                            margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                            <XAxis type="number" unit="%" tick={{ fontSize: 10, fill: '#64748b' }} stroke="#cbd5e1" />
                            <YAxis dataKey="key" type="category" tick={{ fontSize: 11, fontWeight: 'bold', fill: '#334155' }} stroke="#cbd5e1" width={75} />
                            <Tooltip
                              formatter={(value: number, name: any, propsOnPlotKey: any) => {
                                const payload = propsOnPlotKey.payload;
                                return [`${value}% (${formatTime(payload.duration)})`, 'Anteil'];
                              }}
                              contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px' }}
                            />
                            <Bar dataKey="percent" radius={[0, 8, 8, 0]} maxBarSize={28}>
                              {stats.zonesDistribution.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Line Chart showing heart rate profile over the route */}
                    <div>
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Pulsverlauf über Streckendistanz</h4>
                      <div className="h-44 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={timelineChartData}
                            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                          >
                            <defs>
                              <linearGradient id="colorHr" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4}/>
                                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.01}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis 
                              dataKey="dist" 
                              unit=" km" 
                              tick={{ fontSize: 10, fill: '#64748b' }} 
                              stroke="#cbd5e1"
                            />
                            <YAxis 
                              domain={['dataMin - 10', 'dataMax + 10']} 
                              unit=" bpm" 
                              tick={{ fontSize: 10, fill: '#64748b' }} 
                              stroke="#cbd5e1"
                            />
                            <Tooltip
                              formatter={(value: any, name: any) => [`${value} bpm`, 'Herzfrequenz']}
                              labelFormatter={(label) => `Distanz: ${label} km`}
                              contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px' }}
                            />
                            <Area 
                              type="monotone" 
                              dataKey="hr" 
                              stroke="#f43f5e" 
                              strokeWidth={2.5}
                              fillOpacity={1} 
                              fill="url(#colorHr)" 
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Zone Summary text */}
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex items-start gap-3">
                      <Award className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-slate-800">Trainings-Fazit</p>
                        <p className="text-xs text-slate-500 leading-normal mt-1">
                          Bei diesem Track betrug deine Durchschnittsbelastung <span className="font-bold text-slate-700">{stats.avg} bpm</span>. 
                          {stats.aerobicPercent > 65 ? (
                            <span> Der Schwerpunkt lag im <b>aeroben Grundlagenbereich ({stats.aerobicPercent}%)</b>. Perfekt zur Steigerung der Grundlagenausdauer und Ökonomisierung deines Fettstoffwechsels (GA1/GA2). Erlaubt stundenlanges Bewegen bei stabiler Energielage.</span>
                          ) : stats.anaerobicPercent > 35 ? (
                            <span> Du hast viel Zeit im <b>anaeroben Schwellenbereich (EB &amp; SB: {stats.anaerobicPercent}%)</b> verbracht! Dieses Training schult deine Tempohärte und Laktattoleranz, benötigt jedoch ausreichende Regenerationszeit (KB) im Nachgang.</span>
                          ) : (
                            <span> Das Training wies ein <b>ausgeglichenes Verhältnis</b> zwischen aerober Grundlage und intensiven Segmenten auf. Ein idealer Allround-Reiz für Radmarathon-Athleten.</span>
                          )}
                        </p>
                      </div>
                    </div>

                  </div>
                ) : (
                  <div className="py-20 text-center flex flex-col items-center justify-center space-y-3 bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
                    <Heart className="w-12 h-12 text-slate-300 animate-pulse" />
                    <div>
                      <p className="text-sm font-extrabold text-slate-700">Keine Aktivität geladen</p>
                      <p className="text-xs text-slate-450 max-w-sm mx-auto mt-1">
                        Lade eine GPX- oder FIT-Aktivität im linken Menü hoch, um die Herzfrequenz und Trainingszonen im Detail auf der Karte aufzuschlüsseln.
                      </p>
                    </div>
                  </div>
                )}
              </div>

            </div>

          </div>

        </div>

        {/* Footer actions */}
        <div className="bg-slate-50 border-t border-slate-200/60 px-6 py-4 flex justify-between items-center shrink-0 rounded-b-3xl">
          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase">
            <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
            Ötztal Cycle Engine v2.0
          </div>
          <button
            onClick={onClose}
            className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold px-6 py-2 rounded-xl text-xs transition-colors cursor-pointer uppercase"
          >
            Schließen
          </button>
        </div>

      </motion.div>
    </motion.div>
  );
};
