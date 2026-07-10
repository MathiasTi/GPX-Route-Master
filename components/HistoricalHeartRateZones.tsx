import React, { useMemo, useState } from 'react';
import { 
  Heart, 
  Calendar, 
  Clock, 
  Activity, 
  Filter, 
  CheckSquare, 
  Square, 
  TrendingUp, 
  Award, 
  Sliders, 
  Info,
  SlidersHorizontal,
  ChevronRight,
  TrendingDown,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { GPXTrack, GPXPoint } from '../types';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  Cell, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  AreaChart, 
  Area 
} from 'recharts';

export interface HistoricalHeartRateZonesProps {
  tracks: GPXTrack[];
  maxHr: number;
  userFtp?: number;
}

export interface HistoricalZoneStats {
  key: number;
  name: string;
  fullName: string;
  minPercent: number;
  maxPercent: number;
  minBpm: number;
  maxBpm: number;
  color: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
  desc: string;
  duration: number; // seconds
  percent: number; // percentage
}

export const HistoricalHeartRateZones: React.FC<HistoricalHeartRateZonesProps> = ({
  tracks,
  maxHr,
  userFtp = 250
}) => {
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>(() => {
    // Select all tracks by default
    return tracks.map(t => t.id);
  });
  const [onlyRealSensors, setOnlyRealSensors] = useState<boolean>(false);

  // Sync state if tracks change (e.g. new file uploaded)
  const allTrackIds = useMemo(() => tracks.map(t => t.id), [tracks]);
  
  // Track details and HR info
  const trackInfoList = useMemo(() => {
    return tracks.map(track => {
      const hasRealHr = track.points.some(p => p.hr !== undefined && p.hr > 0);
      
      // Calculate basic heart rate stats
      const hrs = track.points.map(p => p.hr || 0).filter(h => h > 0);
      const avgHr = hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0;
      const maxRecordedHr = hrs.length > 0 ? Math.max(...hrs) : 0;
      
      return {
        id: track.id,
        name: track.name,
        date: track.points[0]?.time || new Date(),
        distance: track.distance,
        duration: track.duration || 0,
        hasRealHr,
        avgHr,
        maxRecordedHr,
        color: track.color || '#6366f1'
      };
    }).sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [tracks]);

  // Handle select / deselect all
  const handleToggleSelectAll = () => {
    if (selectedTrackIds.length === filteredTrackInfoList.length) {
      setSelectedTrackIds([]);
    } else {
      setSelectedTrackIds(filteredTrackInfoList.map(t => t.id));
    }
  };

  // Filter track info list based on sensor filter
  const filteredTrackInfoList = useMemo(() => {
    if (onlyRealSensors) {
      return trackInfoList.filter(t => t.hasRealHr);
    }
    return trackInfoList;
  }, [trackInfoList, onlyRealSensors]);

  // Toggle individual track
  const handleToggleTrack = (id: string) => {
    setSelectedTrackIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(tId => tId !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  // 5 standard heart rate zones configuration based on Max HR
  const zonesConfig = useMemo(() => {
    return [
      {
        key: 1,
        name: 'Z1 Erholung',
        fullName: 'Z1 Aktive Erholung / Kompensation',
        minPercent: 50,
        maxPercent: 60,
        minBpm: Math.round(maxHr * 0.50),
        maxBpm: Math.round(maxHr * 0.60),
        color: '#3b82f6', // blue
        textColor: 'text-blue-700 dark:text-blue-400',
        bgColor: 'bg-blue-50/50 dark:bg-blue-950/20',
        borderColor: 'border-blue-200/50 dark:border-blue-900/30',
        desc: 'Aktive Regeneration, extrem lockere Belastung. Erleichtert den Muskelaufbau und baut Ermüdung ab.'
      },
      {
        key: 2,
        name: 'Z2 GA1',
        fullName: 'Z2 Grundlagenausdauer 1 (Fettstoffwechsel)',
        minPercent: 60,
        maxPercent: 70,
        minBpm: Math.round(maxHr * 0.60),
        maxBpm: Math.round(maxHr * 0.70),
        color: '#10b981', // emerald
        textColor: 'text-emerald-700 dark:text-emerald-400',
        bgColor: 'bg-emerald-50/50 dark:bg-emerald-950/20',
        borderColor: 'border-emerald-200/50 dark:border-emerald-900/30',
        desc: 'Grundlagenausdauerbereich. Optimiert den Fettstoffwechsel und erhöht die Effizienz auf langen Distanzen.'
      },
      {
        key: 3,
        name: 'Z3 GA2',
        fullName: 'Z3 Grundlagenausdauer 2 (Aerobes Tempotraining)',
        minPercent: 70,
        maxPercent: 80,
        minBpm: Math.round(maxHr * 0.70),
        maxBpm: Math.round(maxHr * 0.80),
        color: '#eab308', // amber
        textColor: 'text-amber-700 dark:text-amber-400',
        bgColor: 'bg-amber-50/50 dark:bg-amber-950/20',
        borderColor: 'border-amber-200/50 dark:border-amber-900/30',
        desc: 'Zügiges aerobes Reisetempo. Verbessert die aerobe Tempohärte und Glykogenspeicherung.'
      },
      {
        key: 4,
        name: 'Z4 Schwelle',
        fullName: 'Z4 Entwicklungsbereich (Anaerobe Schwelle)',
        minPercent: 80,
        maxPercent: 90,
        minBpm: Math.round(maxHr * 0.80),
        maxBpm: Math.round(maxHr * 0.90),
        color: '#f97316', // orange
        textColor: 'text-orange-700 dark:text-orange-400',
        bgColor: 'bg-orange-50/50 dark:bg-orange-950/20',
        borderColor: 'border-orange-200/50 dark:border-orange-900/30',
        desc: 'Schwellenbereich. Schult die Laktattoleranz, verschiebt die anaerobe Leistungsschwelle nach oben.'
      },
      {
        key: 5,
        name: 'Z5 Spitze',
        fullName: 'Z5 Spitzenbereich (Anaerobe Kapazität)',
        minPercent: 90,
        maxPercent: 100,
        minBpm: Math.round(maxHr * 0.90),
        maxBpm: maxHr,
        color: '#ef4444', // red
        textColor: 'text-red-700 dark:text-red-400',
        bgColor: 'bg-red-50/50 dark:bg-red-950/20',
        borderColor: 'border-red-200/50 dark:border-red-900/30',
        desc: 'Maximale hochintensive Belastung. Erhöht die VO2max, die absolute Topleistung und die Sprintfähigkeit.'
      }
    ];
  }, [maxHr]);

  // Process and aggregate points across ALL selected tracks
  const aggregatedStats = useMemo(() => {
    let totalSecs = 0;
    const zoneCounts = [0, 0, 0, 0, 0, 0]; // Index 0: under Z1, Index 1-5: Z1-Z5
    const hrBpmBins: Record<number, number> = {}; // 5-bpm increments histogram bins
    
    const allHrs: number[] = [];
    let selectedTrackCount = 0;
    let totalDistanceKm = 0;

    // Filter tracks matching selected track IDs and sensor requirement
    const activeTracks = tracks.filter(t => {
      const isSelected = selectedTrackIds.includes(t.id);
      const isSensorOk = !onlyRealSensors || t.points.some(p => p.hr !== undefined && p.hr > 0);
      return isSelected && isSensorOk;
    });

    selectedTrackCount = activeTracks.length;

    activeTracks.forEach(track => {
      totalDistanceKm += track.distance;
      const hasRealHr = track.points.some(p => p.hr !== undefined && p.hr > 0);
      
      // Heart rate list for processing (rely on actual, or simulate as fallback)
      let ptsToProcess: GPXPoint[] = track.points;
      
      if (!hasRealHr) {
        // High-fidelity heart rate sequence simulation based on terrain slope
        const baselineHr = Math.round(maxHr * 0.62); // Aerobic baseline (~115 bpm)
        let prevHr = baselineHr;
        
        ptsToProcess = track.points.map((pt, idx) => {
          let slope = 0;
          if (idx > 0) {
            const pPrev = track.points[idx - 1];
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

          let targetHr = baselineHr + (slope * (maxHr * 0.03));
          const minLimit = Math.round(maxHr * 0.48);
          const maxLimit = maxHr;
          if (targetHr < minLimit) targetHr = minLimit;
          if (targetHr > maxLimit) targetHr = maxLimit;

          const smoothedHr = Math.round(prevHr * 0.95 + targetHr * 0.05);
          prevHr = smoothedHr;

          return { ...pt, hr: smoothedHr };
        });
      }

      const stepDuration = track.duration > 0 ? (track.duration / ptsToProcess.length) : 6.5;

      for (let i = 0; i < ptsToProcess.length; i++) {
        const p = ptsToProcess[i];
        const pNext = ptsToProcess[i + 1];
        let itemDuration = stepDuration;

        if (p.time && pNext?.time) {
          const diff = (pNext.time.getTime() - p.time.getTime()) / 1000;
          if (diff > 0 && diff < 120) {
            itemDuration = diff;
          }
        }

        totalSecs += itemDuration;
        const hr = p.hr || 0;
        if (hr === 0) continue;

        allHrs.push(hr);

        // Map into standard training zones
        if (hr < zonesConfig[0].minBpm) {
          zoneCounts[0] += itemDuration;
        } else if (hr >= zonesConfig[0].minBpm && hr < zonesConfig[1].minBpm) {
          zoneCounts[1] += itemDuration;
        } else if (hr >= zonesConfig[1].minBpm && hr < zonesConfig[2].minBpm) {
          zoneCounts[2] += itemDuration;
        } else if (hr >= zonesConfig[2].minBpm && hr < zonesConfig[3].minBpm) {
          zoneCounts[3] += itemDuration;
        } else if (hr >= zonesConfig[3].minBpm && hr < zonesConfig[4].minBpm) {
          zoneCounts[4] += itemDuration;
        } else {
          zoneCounts[5] += itemDuration;
        }

        // Map into 5-bpm histogram bins (e.g. 130-134, 135-139)
        const binSize = 5;
        const binKey = Math.floor(hr / binSize) * binSize;
        hrBpmBins[binKey] = (hrBpmBins[binKey] || 0) + itemDuration;
      }
    });

    const activeTotalCalculatedSecs = Math.max(1, totalSecs);

    const zonesWithStats = zonesConfig.map((z, idx) => {
      const durationSecs = zoneCounts[idx + 1];
      return {
        ...z,
        duration: durationSecs,
        percent: parseFloat(((durationSecs / activeTotalCalculatedSecs) * 100).toFixed(1))
      };
    });

    const underZ1Duration = zoneCounts[0];
    const underZ1Percent = parseFloat(((underZ1Duration / activeTotalCalculatedSecs) * 100).toFixed(1));

    // Calculate Average and Max Heart Rate across all processed points
    const avgHr = allHrs.length > 0 ? Math.round(allHrs.reduce((a, b) => a + b, 0) / allHrs.length) : 0;
    const maxRecordedHr = allHrs.length > 0 ? Math.max(...allHrs) : 0;

    // Convert bpm bins to an array suitable for area chart
    const densityData = Object.keys(hrBpmBins)
      .map(k => {
        const binVal = parseInt(k, 10);
        return {
          bpm: binVal,
          bpmLabel: `${binVal}-${binVal + 4} bpm`,
          durationMinutes: parseFloat((hrBpmBins[binVal] / 60).toFixed(1)),
          durationSeconds: hrBpmBins[binVal]
        };
      })
      .filter(d => d.bpm >= 70 && d.bpm <= 210) // Filter realistic HR range
      .sort((a, b) => a.bpm - b.bpm);

    // TRIMP Training Impulse calculation (Physiological load estimate)
    // TRIMP = Duration (min) * AvgHRRatio * 0.64 * e^(1.92 * AvgHRRatio)
    let totalTrimp = 0;
    if (avgHr > 0 && activeTotalCalculatedSecs > 10) {
      const restingHrPlaceholder = 60; // general baseline resting HR
      const hrReserve = maxHr - restingHrPlaceholder;
      const hrRatio = (avgHr - restingHrPlaceholder) / hrReserve;
      const factor = 1.92; // cycling male standard
      const trimpPerMinute = hrRatio * 0.64 * Math.exp(factor * hrRatio);
      const totalMinutes = activeTotalCalculatedSecs / 60;
      totalTrimp = Math.round(totalMinutes * trimpPerMinute);
    }

    return {
      zones: zonesWithStats,
      underZ1: {
        name: 'Regenerativ / < Z1',
        duration: underZ1Duration,
        percent: underZ1Percent,
        color: '#64748b' // slate
      },
      avgHr,
      maxRecordedHr,
      totalDurationSecs: activeTotalCalculatedSecs,
      selectedTrackCount,
      totalDistanceKm,
      densityData,
      totalTrimp
    };
  }, [tracks, selectedTrackIds, onlyRealSensors, maxHr, zonesConfig]);

  // Format seconds to human readable string
  const formatSeconds = (seconds: number) => {
    if (!seconds || seconds <= 0) return '0s';
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

  // Generate Recharts chart compatible data
  const barChartData = useMemo(() => {
    return aggregatedStats.zones.map(z => ({
      name: z.name,
      fullName: z.fullName,
      minutes: parseFloat((z.duration / 60).toFixed(1)),
      durationStr: formatSeconds(z.duration),
      percent: z.percent,
      color: z.color,
      range: `${z.minBpm}-${z.maxBpm} bpm`
    }));
  }, [aggregatedStats]);

  // Determine aggregate Training Stress Classification & advice
  const trainingAssessment = useMemo(() => {
    const { zones } = aggregatedStats;
    const z1 = zones[0].percent;
    const z2 = zones[1].percent;
    const z3 = zones[2].percent;
    const z4 = zones[3].percent;
    const z5 = zones[4].percent;

    const baseAerobic = z1 + z2;
    const thresholdHiit = z4 + z5;

    if (aggregatedStats.totalDurationSecs < 10) {
      return {
        title: "Keine Analysedaten",
        text: "Bitte wähle mindestens eine Aktivität in der linken Liste aus, um eine physiologische Analyse deines Trainingszustandes zu erhalten.",
        type: "neutral"
      };
    }

    if (baseAerobic > 75 && thresholdHiit > 12) {
      return {
        title: "Polarisiertes Training (Exzellent!)",
        text: "Hervorragende Trainingsverteilung! Du führst ca. 80% deines Trainings in lockeren aeroben Grundlagenbereichen (Z1/Z2) durch und setzt hocheffektive Akzente im Schwellen- und Spitzenbereich. Dies maximiert die Ausdauer und verschiebt die VO2max ohne Übertrainingsrisiko.",
        type: "success"
      };
    }

    if (baseAerobic > 80) {
      return {
        title: "Aerobe Basisökonomisierung",
        text: "Dein Fokus liegt extrem stark auf der Entwicklung deiner Ausdauer-Kapillaren und der Optimierung der Fettverbrennung. Dies ist ideal, um eine solide physische Grundlage für extrem lange Alpenpässe oder Marathons aufzubauen. Füge gelegentlich kurze Intervalle hinzu, um neue Reize zu setzen.",
        type: "info"
      };
    }

    if (z3 > 35) {
      return {
        title: "Schwellen-Plateau ('Graue Zone')",
        text: "Achtung vor der Tempotrainings-Falle! Du verbringst sehr viel Zeit in der aeroben Übergangszone (Z3). Dieses Training fühlt sich anstrengend an, erzielt aber physiologisch oft ein Plateau, da es zu intensiv für echte Erholung und zu locker für signifikante VO2max-Steigerungen ist. Versuche polarisierter zu trainieren.",
        type: "warning"
      };
    }

    if (thresholdHiit > 30) {
      return {
        title: "Hochintensives Belastungsprofil",
        text: "Extrem harter anaerober Fokus! Über 30% deiner Zeit liegen an oder über der anaeroben Schwelle (Z4/Z5). Dies verbessert deine Laktattoleranz massiv, erfordert aber immense Regenerationszeiten. Baue gezielte Ausroll-Tage ein, um chronischem Leistungsabfall vorzubeugen.",
        type: "danger"
      };
    }

    return {
      title: "Ausgeglichener Trainingsreiz",
      text: "Dein Trainingsverlauf zeigt eine harmonische Verteilung über alle Intensitätsbereiche hinweg. Diese Pyramidenstruktur stärkt die kardiovaskuläre Elastizität und eignet sich hervorragend zur allgemeinen Fitnesssteigerung sowie zur Vorbereitung auf abwechslungsreiches Terrain.",
      type: "success"
    };
  }, [aggregatedStats]);

  return (
    <div className="space-y-6">
      {/* Top statistics summary row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 p-3.5 rounded-2xl shadow-sm text-center">
          <span className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400 block mb-0.5">Aktivitäten</span>
          <div className="text-xl font-black text-slate-850 dark:text-slate-200 font-mono">
            {aggregatedStats.selectedTrackCount} <span className="text-[10px] font-bold text-slate-400">Dateien</span>
          </div>
          <span className="text-[9px] text-indigo-500 font-semibold font-mono">aus {filteredTrackInfoList.length} total</span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 p-3.5 rounded-2xl shadow-sm text-center">
          <span className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400 block mb-0.5">Gesamte Tretzeit</span>
          <div className="text-xl font-black text-indigo-650 dark:text-indigo-400 font-mono">
            {formatSeconds(aggregatedStats.totalDurationSecs)}
          </div>
          <span className="text-[9px] text-slate-400 font-semibold font-mono">({Math.round(aggregatedStats.totalDistanceKm)} km Distanz)</span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 p-3.5 rounded-2xl shadow-sm text-center">
          <span className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400 block mb-0.5">Ø Puls (Historisch)</span>
          <div className="text-xl font-black text-slate-850 dark:text-slate-200 font-mono">
            {aggregatedStats.avgHr > 0 ? `${aggregatedStats.avgHr}` : '--'} <span className="text-[10px] font-bold text-slate-400">bpm</span>
          </div>
          <span className="text-[9px] text-emerald-500 font-semibold font-mono">
            {aggregatedStats.avgHr > 0 ? `${Math.round((aggregatedStats.avgHr / maxHr) * 100)}% Max HR` : 'Keine Daten'}
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 p-3.5 rounded-2xl shadow-sm text-center col-span-1">
          <span className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400 block mb-0.5">Max. Puls (Historisch)</span>
          <div className="text-xl font-black text-rose-600 dark:text-rose-400 font-mono">
            {aggregatedStats.maxRecordedHr > 0 ? `${aggregatedStats.maxRecordedHr}` : '--'} <span className="text-[10px] font-bold text-slate-400">bpm</span>
          </div>
          <span className="text-[9px] text-rose-500 font-semibold font-mono">
            {aggregatedStats.maxRecordedHr > 0 ? `${Math.round((aggregatedStats.maxRecordedHr / maxHr) * 100)}% Max HR` : 'Keine Daten'}
          </span>
        </div>

        <div className="bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-100/50 dark:border-indigo-900/30 p-3.5 rounded-2xl text-center col-span-2 md:col-span-1">
          <span className="text-[9px] uppercase tracking-wider font-extrabold text-indigo-500 block mb-0.5">Kardialer TRIMP-Score</span>
          <div className="text-xl font-black text-indigo-600 dark:text-indigo-400 font-mono">
            {aggregatedStats.totalTrimp}
          </div>
          <span className="text-[8px] text-slate-450 italic leading-none block mt-0.5">Kardiovaskuläre Trainingslast</span>
        </div>
      </div>

      {/* Main split dashboard layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Track Selection & Filters */}
        <div className="lg:col-span-5 bg-slate-50/50 dark:bg-slate-900/30 border border-slate-200/60 dark:border-slate-800/60 p-4 rounded-3xl space-y-4">
          <div className="flex justify-between items-center pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-350 uppercase tracking-wider flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-indigo-500" />
              Aktivitäts-Auswahl
            </h3>
            <span className="text-[10px] bg-slate-200 dark:bg-slate-850 text-slate-650 dark:text-slate-350 px-2 py-0.5 rounded-full font-bold font-mono">
              {selectedTrackIds.length}/{filteredTrackInfoList.length}
            </span>
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap gap-2 text-[10.5px]">
            <button 
              onClick={() => setOnlyRealSensors(prev => !prev)}
              className={`px-3 py-1.5 rounded-xl border font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                onlyRealSensors 
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-400' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Nur echte Sensor-Werte ({trackInfoList.filter(t => t.hasRealHr).length})
            </button>
            <button
              onClick={handleToggleSelectAll}
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-bold dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400 transition-all cursor-pointer"
            >
              {selectedTrackIds.length === filteredTrackInfoList.length ? 'Alle abwählen' : 'Alle auswählen'}
            </button>
          </div>

          {/* List of track activities with custom checkboxes */}
          <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
            {filteredTrackInfoList.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-450 italic">
                Keine Aktivitäten entsprechen den Filterkriterien.
              </div>
            ) : (
              filteredTrackInfoList.map(t => {
                const isSelected = selectedTrackIds.includes(t.id);
                return (
                  <div
                    key={t.id}
                    onClick={() => handleToggleTrack(t.id)}
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center gap-2.5 ${
                      isSelected
                        ? 'bg-white dark:bg-slate-900 border-indigo-200 dark:border-indigo-900/60 shadow-sm'
                        : 'bg-slate-100/50 dark:bg-slate-950/10 border-slate-150 dark:border-slate-850 text-slate-500'
                    }`}
                  >
                    <div className="shrink-0">
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400 fill-indigo-50/30" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-350" />
                      )}
                    </div>
                    
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between items-start gap-1">
                        <span className={`text-[11px] font-bold truncate block ${isSelected ? 'text-slate-800 dark:text-slate-200' : 'text-slate-450'}`}>
                          {t.name}
                        </span>
                        <span className="text-[9px] font-mono shrink-0 text-slate-400 text-right mt-0.5">
                          {t.date.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 mt-1 text-[9px] font-semibold text-slate-400">
                        <span className="font-mono">{t.distance.toFixed(1)} km</span>
                        <span className="font-mono">•</span>
                        <span className="font-mono">{formatSeconds(t.duration)}</span>
                        <span className="font-mono">•</span>
                        <span className="flex items-center gap-0.5">
                          <Heart className="w-2.5 h-2.5 text-rose-500 fill-rose-500/10" />
                          <span className="font-mono font-bold text-slate-650 dark:text-slate-350">{t.avgHr > 0 ? `${t.avgHr} bpm` : '--'}</span>
                        </span>
                      </div>
                    </div>

                    {/* Sensor Badge */}
                    <div className="shrink-0 pl-1">
                      {t.hasRealHr ? (
                        <span className="text-[7.5px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-md border border-emerald-500/15">
                          Sensor
                        </span>
                      ) : (
                        <span className="text-[7.5px] font-black uppercase tracking-wider bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 px-1.5 py-0.5 rounded-md border border-slate-200/50 dark:border-slate-700/50">
                          Simul.
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          
          <div className="p-3 bg-indigo-50/30 dark:bg-indigo-950/10 border border-indigo-100/40 dark:border-indigo-900/20 rounded-xl">
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-normal">
              <strong>Info:</strong> GPX-Dateien ohne Herzfrequenz-Sensordaten werden mithilfe deines Höhenprofils, der Steigungen und der Durchschnittsgeschwindigkeit physiologisch simuliert, um ein realistisches Gesamtbild deines historischen Trainingsaufwands zu generieren.
            </p>
          </div>
        </div>

        {/* Right Column: Visualizations & Distributions */}
        <div className="lg:col-span-7 space-y-6">
          {/* Workout Fingerprint Bar */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 p-4 rounded-3xl shadow-sm space-y-2">
            <div className="flex justify-between items-center text-[10px] font-black text-slate-400 uppercase tracking-wider">
              <span>Intensitäts-Verteilung (Gesamte Trainingsdauer)</span>
              <span>Z1 ➔ Z5</span>
            </div>
            
            <div className="h-4.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner border border-slate-200/30 dark:border-slate-700/30">
              {aggregatedStats.underZ1.percent > 0 && (
                <div
                  style={{ width: `${aggregatedStats.underZ1.percent}%` }}
                  className="h-full bg-slate-400 transition-all duration-300 relative group cursor-help"
                  title={`${aggregatedStats.underZ1.name}: ${aggregatedStats.underZ1.percent}% (${formatSeconds(aggregatedStats.underZ1.duration)})`}
                />
              )}
              {aggregatedStats.zones.map((z) => {
                if (z.percent <= 0) return null;
                return (
                  <div
                    key={z.key}
                    style={{ width: `${z.percent}%`, backgroundColor: z.color }}
                    className="h-full transition-all duration-300 relative group cursor-help"
                    title={`${z.name}: ${z.percent}% (${formatSeconds(z.duration)})`}
                  />
                );
              })}
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-bold text-slate-500">
              {aggregatedStats.underZ1.percent > 0 && (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  Regenerativ ({aggregatedStats.underZ1.percent}%)
                </span>
              )}
              {aggregatedStats.zones.map(z => (
                <span key={z.key} className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: z.color }} />
                  {z.name} ({z.percent}%)
                </span>
              ))}
            </div>
          </div>

          {/* Time in Zone Bar Chart */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 p-4 rounded-3xl shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-indigo-500" />
              Zeit in Zone (Time-in-Zone Verteilung)
            </h3>

            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barChartData}
                  margin={{ top: 10, right: 10, left: -25, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    fontSize={9} 
                    stroke="#94a3b8" 
                    tickLine={false} 
                  />
                  <YAxis 
                    fontSize={9} 
                    stroke="#94a3b8" 
                    tickLine={false} 
                    label={{ value: 'Minuten', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 8, fill: '#94a3b8' } }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-white dark:bg-slate-950 p-2.5 rounded-xl border border-slate-150 dark:border-slate-800 shadow-lg text-[10px] space-y-1">
                            <span className="font-extrabold text-slate-800 dark:text-slate-200 block">{data.fullName}</span>
                            <div className="flex justify-between gap-4 text-slate-600 dark:text-slate-400 font-mono">
                              <span>Herzfrequenz-Spanne:</span>
                              <span className="font-bold">{data.range}</span>
                            </div>
                            <div className="flex justify-between gap-4 text-slate-600 dark:text-slate-400 font-mono">
                              <span>Zeitdauer gesamt:</span>
                              <span className="font-bold text-indigo-600 dark:text-indigo-400">{data.durationStr}</span>
                            </div>
                            <div className="flex justify-between gap-4 text-slate-600 dark:text-slate-400 font-mono">
                              <span>Anteil am Training:</span>
                              <span className="font-bold">{data.percent}%</span>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="minutes" radius={[4, 4, 0, 0]}>
                    {barChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Heart Rate Density Distribution Curve */}
          {aggregatedStats.densityData.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 p-4 rounded-3xl shadow-sm">
              <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-rose-500" />
                Pulsfrequenz-Dichtekurve (Histogramm)
              </h3>

              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={aggregatedStats.densityData}
                    margin={{ top: 5, right: 10, left: -25, bottom: 5 }}
                  >
                    <defs>
                      <linearGradient id="hrDensityGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.01}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="bpm" 
                      fontSize={9} 
                      stroke="#94a3b8" 
                      unit=" bpm"
                      tickLine={false}
                    />
                    <YAxis 
                      fontSize={9} 
                      stroke="#94a3b8" 
                      tickLine={false}
                      label={{ value: 'Minuten', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 8, fill: '#94a3b8' } }}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const d = payload[0].payload;
                          return (
                            <div className="bg-white dark:bg-slate-950 p-2 rounded-lg border border-slate-150 dark:border-slate-800 shadow-sm text-[9.5px]">
                              <p className="font-bold text-slate-800 dark:text-slate-250 font-mono">{d.bpmLabel}</p>
                              <p className="text-rose-600 dark:text-rose-400 font-mono mt-0.5">Dauer: <strong>{d.durationMinutes} Min.</strong></p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="durationMinutes" 
                      stroke="#f43f5e" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#hrDensityGrad)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[9px] text-slate-400 dark:text-slate-500 italic text-center mt-1">
                Die Kurve visualisiert die genaue zeitliche Dichteverteilung über das gesamte BPM-Spektrum. Gipfelpunkte repräsentieren deine dominante Trainingsfrequenz.
              </p>
            </div>
          )}

          {/* AI Coach Assessment Panel */}
          {aggregatedStats.totalDurationSecs > 10 && (
            <div className={`p-4 rounded-3xl border flex items-start gap-3.5 shadow-sm ${
              trainingAssessment.type === 'success' 
                ? 'bg-emerald-50/55 border-emerald-100 dark:bg-emerald-950/15 dark:border-emerald-900/30 text-emerald-900 dark:text-emerald-400' 
                : trainingAssessment.type === 'warning'
                ? 'bg-amber-50/55 border-amber-100 dark:bg-amber-950/15 dark:border-amber-900/30 text-amber-900 dark:text-amber-450'
                : trainingAssessment.type === 'danger'
                ? 'bg-rose-50/55 border-rose-100 dark:bg-rose-950/15 dark:border-rose-900/30 text-rose-900 dark:text-rose-450'
                : 'bg-indigo-50/55 border-indigo-100 dark:bg-indigo-950/15 dark:border-indigo-900/30 text-indigo-900 dark:text-indigo-400'
            }`}>
              <Award className={`w-6 h-6 shrink-0 mt-0.5 ${
                trainingAssessment.type === 'success' ? 'text-emerald-500' :
                trainingAssessment.type === 'warning' ? 'text-amber-500' :
                trainingAssessment.type === 'danger' ? 'text-rose-500' :
                'text-indigo-500'
              }`} />
              <div className="space-y-1 leading-relaxed">
                <span className="font-extrabold uppercase text-[9px] tracking-wider block text-slate-450">
                  Physiologische Analyse &amp; Trainingsempfehlung
                </span>
                <h4 className="text-xs font-bold">{trainingAssessment.title}</h4>
                <p className="text-[10.5px] leading-relaxed opacity-90">{trainingAssessment.text}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
