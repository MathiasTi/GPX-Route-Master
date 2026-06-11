import React, { useMemo } from 'react';
import { Heart, Activity, ShieldAlert, Sparkles, Award, Clock } from 'lucide-react';
import { GPXTrack, GPXPoint } from '../types';

export interface HeartRateZonesProps {
  track: GPXTrack;
  maxHr: number;
  onMaxHrChange: (maxHr: number) => void;
}

export interface ZoneData {
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
  duration: number;
  percent: number;
}

export const HeartRateZones: React.FC<HeartRateZonesProps> = ({
  track,
  maxHr,
  onMaxHrChange
}) => {
  // Check if current track has real HR data
  const hasRealHr = useMemo(() => {
    return track.points.some(p => p.hr !== undefined && p.hr > 0);
  }, [track]);

  // High-fidelity heart rate sequence simulation if needed
  const processedPoints = useMemo((): GPXPoint[] => {
    if (hasRealHr) {
      return track.points;
    }

    // Adaptively simulate HR based on max HR, slope, and terrain
    const baselineHr = Math.round(maxHr * 0.62); // standard aerobic base (~115 bpm for 185 max)
    let prevHr = baselineHr;

    return track.points.map((pt, idx) => {
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

      // Heart rate takes time to catch up with slope (inertia)
      let targetHr = baselineHr + (slope * (maxHr * 0.03));
      
      // Bound simulator between 50% and 100% of max HR
      const minLimit = Math.round(maxHr * 0.48);
      const maxLimit = maxHr;
      if (targetHr < minLimit) targetHr = minLimit;
      if (targetHr > maxLimit) targetHr = maxLimit;

      const smoothedHr = Math.round(prevHr * 0.95 + targetHr * 0.05);
      prevHr = smoothedHr;

      return {
        ...pt,
        hr: smoothedHr
      };
    });
  }, [track, hasRealHr, maxHr]);

  // 5 standard zones of physical exertion based on Max HR
  const zonesConfig = useMemo(() => {
    return [
      {
        key: 1,
        name: 'Z1 Erholung',
        fullName: 'Z1 Kompensation / Aktive Erholung',
        minPercent: 50,
        maxPercent: 60,
        minBpm: Math.round(maxHr * 0.50),
        maxBpm: Math.round(maxHr * 0.60),
        color: '#3b82f6', // blue-500
        textColor: 'text-blue-700 dark:text-blue-400',
        bgColor: 'bg-blue-50 dark:bg-blue-950/20',
        borderColor: 'border-blue-200/50 dark:border-blue-900/30',
        desc: 'Aktive Erholung, extrem lockeres Tempo. Fördert die Sauerstoffversorgung & beschleunigt Regeneration.'
      },
      {
        key: 2,
        name: 'Z2 GA1',
        fullName: 'Z2 Grundlagenausdauer 1',
        minPercent: 60,
        maxPercent: 70,
        minBpm: Math.round(maxHr * 0.60),
        maxBpm: Math.round(maxHr * 0.70),
        color: '#10b981', // emerald-500
        textColor: 'text-emerald-700 dark:text-emerald-400',
        bgColor: 'bg-emerald-50 dark:bg-emerald-950/20',
        borderColor: 'border-emerald-200/50 dark:border-emerald-900/30',
        desc: 'Klassische Fettverbrennungs- & Grundlagenausdauerzone. Ökonomisiert Herzarbeit bei stundenlanger Belastung.'
      },
      {
        key: 3,
        name: 'Z3 GA2',
        fullName: 'Z3 Grundlagenausdauer 2',
        minPercent: 70,
        maxPercent: 80,
        minBpm: Math.round(maxHr * 0.70),
        maxBpm: Math.round(maxHr * 0.80),
        color: '#eab308', // amber-500
        textColor: 'text-amber-700 dark:text-amber-400',
        bgColor: 'bg-amber-50 dark:bg-amber-950/20',
        borderColor: 'border-amber-200/50 dark:border-amber-900/30',
        desc: 'Aerobes Tempotraining. Erhöht das Wohlfühltempo auf längeren Distanzen und steigert die Kraftausdauer.'
      },
      {
        key: 4,
        name: 'Z4 Schwelle',
        fullName: 'Z4 Entwicklungsbereich (EB)',
        minPercent: 80,
        maxPercent: 90,
        minBpm: Math.round(maxHr * 0.80),
        maxBpm: Math.round(maxHr * 0.90),
        color: '#f97316', // orange-500
        textColor: 'text-orange-700 dark:text-orange-400',
        bgColor: 'bg-orange-50 dark:bg-orange-950/20',
        borderColor: 'border-orange-200/50 dark:border-orange-900/30',
        desc: 'Anaerobe Schwelle. Schult die Laktat-Toleranz und verschiebt die Belastungsgrenze nach oben.'
      },
      {
        key: 5,
        name: 'Z5 Spitze',
        fullName: 'Z5 Spitzenbereich (SB)',
        minPercent: 90,
        maxPercent: 100,
        minBpm: Math.round(maxHr * 0.90),
        maxBpm: maxHr,
        color: '#ef4444', // red-500
        textColor: 'text-red-700 dark:text-red-400',
        bgColor: 'bg-red-50 dark:bg-red-950/20',
        borderColor: 'border-red-200/50 dark:border-red-900/30',
        desc: 'Maximale anaerobe Belastung. Verbessert die absolute Sprintfähigkeit, VO2max sowie Muskelrekrutierung.'
      }
    ];
  }, [maxHr]);

  // Process time distribution inside zones
  const stats = useMemo(() => {
    let totalSecs = 0;
    const zoneCounts = [0, 0, 0, 0, 0, 0]; // 0: under Z1, 1-5: Z1-Z5
    const stepDuration = track.duration > 0 ? (track.duration / processedPoints.length) : 6.5;

    for (let i = 0; i < processedPoints.length; i++) {
      const p = processedPoints[i];
      const pNext = processedPoints[i + 1];
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
    }

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

    // Calculate Average and Max Heart Rate of processedPoints
    const hrs = processedPoints.map(p => p.hr || 0).filter(h => h > 0);
    const avgHr = hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0;
    const actualMaxHr = hrs.length > 0 ? Math.max(...hrs) : 0;

    return {
      zones: zonesWithStats,
      underZ1: {
        name: '< Z1 Aktiv',
        duration: underZ1Duration,
        percent: underZ1Percent,
        color: '#64748b' // slate
      },
      avgHr,
      actualMaxHr,
      totalDurationSecs: activeTotalCalculatedSecs
    };
  }, [processedPoints, zonesConfig, track]);

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

  return (
    <div className="space-y-4">
      {/* Simulation Banner if needed */}
      {!hasRealHr && (
        <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
          <div className="text-[10.5px] leading-tight text-amber-800 dark:text-amber-400 font-medium">
            <span className="font-bold block uppercase text-[9px] tracking-wider mb-0.5 text-amber-700 dark:text-amber-500">Puls-Simulation</span>
            Keine echten Sensormessungen vorhanden. Herzarbeit adaptiv aus Geländeprofil simuliert.
          </div>
        </div>
      )}

      {/* User Max HR quick setting slider */}
      <div className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200/60 dark:border-slate-800/60 space-y-2">
        <div className="flex justify-between items-center text-xs">
          <span className="font-bold text-slate-600 dark:text-slate-350 flex items-center gap-1.5">
            <Heart className="w-4 h-4 text-rose-500 fill-rose-500/20" />
            Max. Puls (Max HR)
          </span>
          <span className="font-mono font-extrabold text-rose-600 dark:text-rose-400">{maxHr} bpm</span>
        </div>
        <input
          type="range"
          min="120"
          max="220"
          value={maxHr}
          onChange={(e) => onMaxHrChange(Number(e.target.value))}
          className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
        />
        <p className="text-[9px] text-slate-400 dark:text-slate-500 italic">Ändere den Wert, um die Pulszonengrenzen live anzupassen.</p>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="bg-slate-50/50 dark:bg-slate-950/15 p-2 rounded-xl border border-slate-100 dark:border-slate-850">
          <span className="text-[8px] uppercase tracking-wider font-extrabold text-slate-400 block mb-0.5">Ø Herzfrequenz</span>
          <div className="text-sm font-black text-slate-800 dark:text-slate-300 font-mono">
            {stats.avgHr} <span className="text-[9px] font-medium text-slate-500">bpm</span>
          </div>
          <span className="text-[8px] text-slate-400 font-mono">({Math.round((stats.avgHr / maxHr) * 100)}% Max HR)</span>
        </div>
        <div className="bg-rose-50/30 dark:bg-rose-950/10 p-2 rounded-xl border border-rose-100/40 dark:border-rose-900/20">
          <span className="text-[8px] uppercase tracking-wider font-extrabold text-rose-500 block mb-0.5">Maximaler Puls</span>
          <div className="text-sm font-black text-rose-700 dark:text-rose-400 font-mono">
            {stats.actualMaxHr} <span className="text-[9px] font-medium text-rose-500">bpm</span>
          </div>
          <span className="text-[8px] text-rose-500 font-mono">({Math.round((stats.actualMaxHr / maxHr) * 100)}% Max HR)</span>
        </div>
      </div>

      {/* Multi-segmented stacked progress bar representing workout fingerprint */}
      <div className="space-y-1">
        <div className="flex justify-between items-center text-[9px] font-black text-slate-400 dark:text-slate-500 tracking-wider uppercase">
          <span>Intensitäts-Signatur</span>
          <span>Z1 ➔ Z5</span>
        </div>
        <div className="h-3.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner border border-slate-200/30 dark:border-slate-700/30">
          {stats.underZ1.percent > 0 && (
            <div
              style={{ width: `${stats.underZ1.percent}%` }}
              className="h-full bg-slate-400 transition-all duration-300 relative group cursor-help"
              title={`${stats.underZ1.name}: ${stats.underZ1.percent}% (${formatSeconds(stats.underZ1.duration)})`}
            />
          )}
          {stats.zones.map((z) => {
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
      </div>

      {/* Scrollable list of individual detailed zones */}
      <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
        {stats.zones.map((z) => (
          <div
            key={z.key}
            className={`p-2.5 rounded-xl border ${z.bgColor} ${z.borderColor} transition-all relative flex flex-col gap-1`}
          >
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-1.5 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: z.color }}
                />
                <span className="text-[10.5px] font-bold text-slate-800 dark:text-slate-200 truncate">
                  {z.name}
                </span>
                <span className="text-[9px] text-slate-450 font-mono tracking-tighter shrink-0">
                  ({z.minPercent}-{z.maxPercent}%)
                </span>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] font-mono font-black text-slate-850 dark:text-slate-250">
                  {formatSeconds(z.duration)}
                </div>
                <div className="text-[9px] font-mono text-slate-500 mt-[-2px]">
                  {z.percent}%
                </div>
              </div>
            </div>

            {/* Inner progress bar */}
            <div className="h-1 w-full bg-slate-200/50 dark:bg-slate-800/40 rounded-full overflow-hidden">
              <div
                style={{ width: `${z.percent}%`, backgroundColor: z.color }}
                className="h-full rounded-full transition-all duration-300"
              />
            </div>

            <div className="flex justify-between text-[9px] font-semibold text-slate-500/80 mt-0.5">
              <span>{z.minBpm} - {z.maxBpm} bpm</span>
              <span className="italic truncate max-w-[140px] text-right" title={z.desc}>
                {z.desc.substring(0, 42)}...
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Workout conclusion snippet based on core zone */}
      <div className="bg-indigo-50/40 dark:bg-indigo-950/10 border border-indigo-100/40 dark:border-indigo-900/20 p-3 rounded-xl flex items-start gap-2.5">
        <Award className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
        <div className="text-[10.5px] leading-relaxed text-indigo-950 dark:text-indigo-400">
          <span className="font-extrabold block text-indigo-800 dark:text-indigo-450 uppercase text-[9px] tracking-wider mb-0.5">Fazit & Trainingseffekt</span>
          {stats.zones[3].percent + stats.zones[4].percent > 30 ? (
            <span>Harter anaerober Reiz! Du hast viel Zeit im Schwellen- ({stats.zones[3].percent}%) und Spitzenbereich spendiert. Dies verbessert deine Laktatabbaurate und VO2max massiv. Gönne dir ausreichend Erholung!</span>
          ) : stats.zones[1].percent > 45 ? (
            <span>Klassisches Grundlagen-Ausdauertraining. Ausgeprägter aerober Fokus ({stats.zones[1].percent}% in Z2). Ideal für Fettstoffwechsel-Optimierung und langanhaltende Leistungsstabilität.</span>
          ) : stats.zones[0].percent > 50 ? (
            <span>Kompensationstraining. Sehr geringer Stress auf dein Herz-Kreislauf-System. Perfekt zur aktiven Erholung, Lockerung und Durchblutung der Beine.</span>
          ) : (
            <span>Ein ausgeglichener, vielseitiger Trainingsreiz. Diese Kombination schult die kardiovaskuläre Elastizität und bildet ein hervorragendes Fundament für anspruchsvolle Radrunden & Marathons.</span>
          )}
        </div>
      </div>
    </div>
  );
};
