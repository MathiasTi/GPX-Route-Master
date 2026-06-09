import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Activity, Zap, TrendingUp, BarChart2, Shield, Heart, Clock, Maximize2 } from 'lucide-react';
import { GPXTrack, GPXPoint } from '../types';
import { calculatePowerStats, calculateDistance, getPaceString } from '../utils/gpxUtils';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell, LineChart, Line, Legend } from 'recharts';

const formatPaceDecimal = (paceDecimal: number) => {
  if (!paceDecimal || paceDecimal === Infinity || paceDecimal <= 0) return '--:--';
  const mins = Math.floor(paceDecimal);
  const secs = Math.round((paceDecimal - mins) * 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}/km`;
};

interface AdvancedAnalyticsProps {
  track: GPXTrack;
  onClose: () => void;
  ftp: number;
  userWeight: number;
  userAge: number;
  selectionBounds?: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null;
  onSelection?: (bounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null) => void;
}

const AdvancedAnalytics: React.FC<AdvancedAnalyticsProps> = ({ 
  track, 
  onClose, 
  ftp, 
  userWeight, 
  userAge, 
  selectionBounds, 
  onSelection 
}) => {
  const [fullscreenChart, setFullscreenChart] = useState<string | null>(null);
  const isRunning = track.activityType === 'running';

  // Filter points if selection bounds are provided
  const analysisPoints = useMemo(() => {
    if (!selectionBounds) return track.points;
    return track.points.filter(p => 
      p.lat >= selectionBounds.minLat && p.lat <= selectionBounds.maxLat &&
      p.lng >= selectionBounds.minLng && p.lng <= selectionBounds.maxLng
    );
  }, [track.points, selectionBounds]);

  // Combined distance for filtered area
  const filteredDistance = useMemo(() => {
    let dist = 0;
    for (let i = 1; i < analysisPoints.length; i++) {
      dist += calculateDistance(analysisPoints[i - 1], analysisPoints[i]);
    }
    return dist;
  }, [analysisPoints]);

  const useDistance = selectionBounds ? filteredDistance : track.distance;

  const duration = useMemo(() => {
    if (analysisPoints.length < 2) return 0;
    const firstTime = analysisPoints.find(p => p.time !== undefined)?.time;
    const lastTime = [...analysisPoints].reverse().find(p => p.time !== undefined)?.time;
    if (firstTime && lastTime) {
      return (lastTime.getTime() - firstTime.getTime()) / 1000;
    }
    return 0;
  }, [analysisPoints]);

  const durationSecs = duration || (track.duration && !selectionBounds ? track.duration : 0);

  // Time Series points with multiple metrics smoothed for diagram selection
  const enrichedTimelineData = useMemo(() => {
    if (analysisPoints.length === 0) return [];
    
    // Smooth helper with moving average
    const lats = analysisPoints.map(p => p.lat);
    const lngs = analysisPoints.map(p => p.lng);
    
    let currentDist = 0;
    return analysisPoints.map((p, idx) => {
      if (idx > 0) {
        currentDist += calculateDistance(analysisPoints[idx - 1], p);
      }
      
      // Calculate speed
      let speedKmh = 0;
      let slope = 0;
      if (idx > 0) {
        const dStep = calculateDistance(analysisPoints[idx - 1], p);
        if (analysisPoints[idx - 1].time && p.time) {
          const dt = (p.time.getTime() - analysisPoints[idx - 1].time.getTime()) / 1000;
          if (dt > 0 && dt < 12) {
            speedKmh = dStep / (dt / 3600);
          }
        }
        if (dStep > 0.002 && p.ele !== undefined && analysisPoints[idx - 1].ele !== undefined) {
          slope = ((p.ele - analysisPoints[idx - 1].ele!) / (dStep * 1000)) * 100;
          if (Math.abs(slope) > 35) slope = 0; // Filter outlier GPS elevation jumps
        }
      }

      const rawCadence = p.cadence || 0;
      // standard step frequency (garmin exports raw values as RPM which needs to be multiplied by 2 for runners SPM)
      const adjustedCadence = isRunning && rawCadence > 0 && rawCadence < 110 ? rawCadence * 2 : rawCadence;

      return {
        index: idx,
        distance: Number(currentDist.toFixed(2)),
        elevation: Math.round(p.ele || 0),
        hr: p.hr || 0,
        power: p.power || 0,
        speed: Number((speedKmh || 0).toFixed(1)),
        pace: speedKmh > 1.5 ? Number((60 / speedKmh).toFixed(2)) : 0, // pace in decimal min/km
        slope: Number((slope || 0).toFixed(1)),
        cadence: Math.round(adjustedCadence)
      };
    });
  }, [analysisPoints, isRunning]);

  // Downsample timeline data for smooth rendering
  const timelineChartData = useMemo(() => {
    const limit = 150;
    if (enrichedTimelineData.length <= limit) return enrichedTimelineData;
    const result: typeof enrichedTimelineData = [];
    const step = enrichedTimelineData.length / limit;
    for (let i = 0; i < limit; i++) {
      const idx = Math.floor(i * step);
      if (enrichedTimelineData[idx]) result.push(enrichedTimelineData[idx]);
    }
    const last = enrichedTimelineData[enrichedTimelineData.length - 1];
    if (last && !result.includes(last)) result.push(last);
    return result;
  }, [enrichedTimelineData]);

  // Selected timeline metric to display in chart
  const [activeTimelineMetric, setActiveTimelineMetric] = useState<string>(
    isRunning ? 'pace' : 'power'
  );

  // Power Stats or Estimates
  const powerStats = useMemo(() => {
    if (!selectionBounds) return track.powerStats;
    return calculatePowerStats(analysisPoints, ftp);
  }, [analysisPoints, ftp, selectionBounds, track.powerStats]);

  // Heat rate stats
  const avgHr = useMemo(() => {
    const hrPoints = analysisPoints.filter(p => p.hr !== undefined).map(p => p.hr!);
    if (hrPoints.length === 0) return null;
    return Math.round(hrPoints.reduce((a, b) => a + b, 0) / hrPoints.length);
  }, [analysisPoints]);

  const maxHr = useMemo(() => {
    const hrPoints = analysisPoints.filter(p => p.hr !== undefined).map(p => p.hr!);
    if (hrPoints.length === 0) return 180;
    return Math.max(...hrPoints);
  }, [analysisPoints]);

  // VO2Max estimations
  const vo2maxEstimate = useMemo(() => {
    if (analysisPoints.length === 0) return null;
    const maxHrCalc = 220 - userAge;
    const weight = userWeight || 75;

    if (isRunning) {
      // ACSM Running Formula: VO2 = (0.2 * speed_m_min) + (0.9 * speed_m_min * grade) + 3.5
      // Let's compute average speed
      const avgSpeedKmh = useDistance > 0 && durationSecs > 0 ? (useDistance / (durationSecs / 3600)) : 10;
      const speedMMin = avgSpeedKmh * 16.667;
      const grade = useDistance > 0 ? ((track.ascent || 0) / (useDistance * 1000)) : 0;
      const calculatedVo2 = (0.2 * speedMMin) + (0.9 * speedMMin * grade) + 3.5;
      
      // Heart rate correction if possible
      if (avgHr && avgHr > 60) {
        // Extrapolate to max heart rate
        const ratio = maxHrCalc / avgHr;
        const estVo2 = calculatedVo2 * ratio;
        return Math.min(Math.max(Math.round(estVo2 * 10) / 10, 20), 85);
      }
      return Math.round(calculatedVo2 * 10) / 10;
    } else {
      // Cycling: Based on FTP vs weight
      const pVo2maxFromFtp = ftp / 0.82;
      const vo2FromFtp = (10.8 * pVo2maxFromFtp / weight) + 7;
      const p5m = powerStats?.best1m ? powerStats.best1m * 0.85 : ftp * 1.15;
      const vo2FromPower = (10.8 * p5m / weight) + 7;

      if (avgHr) {
        const powerAtMaxHr = ((powerStats?.avgPower || ftp * 0.75) / avgHr) * maxHrCalc;
        const vo2Extrapolated = (10.8 * powerAtMaxHr / weight) + 7;
        return Math.min(Math.max(Math.round((vo2FromFtp * 0.3 + vo2FromPower * 0.3 + vo2Extrapolated * 0.4) * 10) / 10, 15), 90);
      }
      return Math.round(vo2FromFtp * 10) / 10;
    }
  }, [analysisPoints, isRunning, ftp, userAge, userWeight, powerStats, useDistance, durationSecs, avgHr, track.ascent]);

  const vo2Category = useMemo(() => {
    if (!vo2maxEstimate) return null;
    if (vo2maxEstimate > 60) return { label: 'Superior (Spitze)', color: 'text-purple-600 dark:text-purple-400' };
    if (vo2maxEstimate > 52) return { label: 'Exzellent', color: 'text-blue-500' };
    if (vo2maxEstimate > 44) return { label: 'Gut', color: 'text-emerald-500' };
    if (vo2maxEstimate > 36) return { label: 'Mittelmäßig', color: 'text-amber-500' };
    return { label: 'Aufbaufähig', color: 'text-rose-500' };
  }, [vo2maxEstimate]);

  // Running Pace Zonen (min/km thresholds based on estimated threshold pace)
  const averagePaceSeconds = useMemo(() => {
    const movingPoints = enrichedTimelineData.filter(p => p.speed > 2);
    if (movingPoints.length === 0) return 360; // 6:00 as default
    const avgPaceDecimal = movingPoints.reduce((sum, p) => sum + p.pace, 0) / movingPoints.length;
    return avgPaceDecimal * 60; // total seconds per km
  }, [enrichedTimelineData]);

  const thresholdPaceSecs = useMemo(() => {
    // Threshold pace usually slightly faster than average training pace, say 95%
    return averagePaceSeconds > 0 ? averagePaceSeconds * 0.94 : 300;
  }, [averagePaceSeconds]);

  // Pace zones calculation
  const paceZones = useMemo(() => {
    const zones = [
      { 
        name: 'KB', 
        fullName: 'KB – Kompensationsbereich (Erholung)',
        min: thresholdPaceSecs * 1.25, 
        max: 9999, 
        color: '#3b82f6', 
        duration: 0,
        desc: 'Vollkommen entspannte Fortbewegung zum lockeren Auslaufen oder Regenerieren.',
        benefit: 'Beschleunigt den Abbau von Stoffwechselprodukten und fördert die aktive Erholung.'
      },
      { 
        name: 'GA1', 
        fullName: 'GA1 – Grundlagenausdauer 1',
        min: thresholdPaceSecs * 1.15, 
        max: thresholdPaceSecs * 1.25, 
        color: '#10b981', 
        duration: 0,
        desc: 'Lockerer Dauerlauf im aeroben Bereich. Optimal zur Steigerung des Fettstoffwechsels.',
        benefit: 'Entwickelt die aerobe Basis-Ausdauer und stärkt das Herz-Kreislauf-System dauerhaft.'
      },
      { 
        name: 'GA2', 
        fullName: 'GA2 – Grundlagenausdauer 2',
        min: thresholdPaceSecs * 1.05, 
        max: thresholdPaceSecs * 1.15, 
        color: '#eab308', 
        duration: 0,
        desc: 'Zügigeres Tempo mit erhöhtem Atemreiz. Mischbereich aus Fett- und Kohlenhydratverbrennung.',
        benefit: 'Steigert das aerobe Leistungsvermögen und schult das spezifische Renntempo.'
      },
      { 
        name: 'EB', 
        fullName: 'EB – Entwicklungsbereich',
        min: thresholdPaceSecs * 0.95, 
        max: thresholdPaceSecs * 1.05, 
        color: '#f97316', 
        duration: 0,
        desc: 'Laufen nahe an der individuellen anaeroben Schwelle. Die Laktatbildung hält sich gerade noch die Waage.',
        benefit: 'Erhöht die Schwellen-Geschwindigkeit und schult das Laufen unter sauren Bedingungen.'
      },
      { 
        name: 'SB', 
        fullName: 'SB – Spitzenbereich',
        min: 0, 
        max: thresholdPaceSecs * 0.95, 
        color: '#ef4444', 
        duration: 0,
        desc: 'Hochintensives Intervalltraining im Bereich der maximalen Sauerstoffaufnahme und anaeroben Sprints.',
        benefit: 'Maximiert VO2Max, neuromuskuläre Rekrutierung und trainiert die Tempohärte unter extremen Bedingungen.'
      },
    ];

    let totalMovingSecs = 0;
    enrichedTimelineData.forEach((p, idx) => {
      if (p.speed > 1.5) {
        let delta = 1;
        if (idx > 0 && analysisPoints[idx].time && analysisPoints[idx - 1].time) {
          delta = (analysisPoints[idx].time!.getTime() - analysisPoints[idx - 1].time!.getTime()) / 1000;
          if (delta <= 0 || delta > 12) delta = 1;
        }

        const match = zones.find(z => p.pace * 60 >= z.min && p.pace * 60 < z.max);
        if (match) {
          match.duration += delta;
          totalMovingSecs += delta;
        }
      }
    });

    return zones.map(z => {
      const mins = Math.floor(z.duration / 60);
      const secs = Math.floor(z.duration % 60);
      return {
        ...z,
        percent: totalMovingSecs > 0 ? (z.duration / totalMovingSecs) * 100 : 0,
        timeStr: mins > 0 ? `${mins}m ${secs}s` : `${secs}s`,
        seconds: Math.floor(z.duration),
        rangeStr: z.max > 9000 
          ? `> ${formatPaceDecimal(z.min / 60)}` 
          : z.min === 0 
            ? `< ${formatPaceDecimal(z.max / 60)}` 
            : `${formatPaceDecimal(z.max / 60)} - ${formatPaceDecimal(z.min / 60)}`
      };
    }).reverse();
  }, [enrichedTimelineData, thresholdPaceSecs, analysisPoints]);

  // Loaded custom training zones base or defaults
  const customHrZonesBase = useMemo(() => {
    try {
      const saved = localStorage.getItem('velo_hr_zones');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 5) {
          return parsed;
        }
      }
    } catch (e) {}
    return [
      { key: 'KB', name: 'KB', fullName: 'KB – Kompensationsbereich (Erholung)', min: 96, max: 112, color: '#3b82f6', desc: 'Aktive Erholung, sehr geringe Intensität. Dient dem lockeren Ausrollen, Aufwärmen oder der aktiven Erholung nach harten Einheiten.', benefit: 'Fördert die Regeneration und beschleunigt den Abbau von Stoffwechselnebenprodukten.' },
      { key: 'GA1', name: 'GA1', fullName: 'GA1 – Grundlagenausdauer 1', min: 112, max: 136, color: '#10b981', desc: 'Klassisches Ausdauertraining im aeroben Bereich mit sehr hohem Fettstoffwechselanteil.', benefit: 'Verbessert die aerobe Grundausdauer, ökonomisiert die Herzarbeit und stärkt das Immunsystem.' },
      { key: 'GA2', name: 'GA2', fullName: 'GA2 – Grundlagenausdauer 2', min: 136, max: 152, color: '#eab308', desc: 'Mischbereich aus aerobem und anaerobem Stoffwechsel. Höhere Intensität mit kontrolliert vertiefter Atmung.', benefit: 'Steigert das spezifische Renntempo und verbessert die Glykogenspeicherung in den Muskeln.' },
      { key: 'EB', name: 'EB', fullName: 'EB – Entwicklungsbereich', min: 152, max: 168, color: '#f97316', desc: 'Intensives Training nahe der individuellen anaeroben Schwelle. Die Laktatbildung hält sich gerade noch die Waage.', benefit: 'Verschiebt die anaerobe Schwelle nach oben, verbessert die Kraftausdauer und Laktattoleranz.' },
      { key: 'SB', name: 'SB', fullName: 'SB – Spitzenbereich', min: 168, max: 170, color: '#ef4444', desc: 'Maximale Belastung (Hochintensives Intervalltraining - HIIT). Rein laktazides bzw. anaerobes Milieu.', benefit: 'Maximiert die VO2max, die neuromuskuläre Rekrutierung und die anaerobe Leistungsfähigkeit.' }
    ];
  }, []);

  const effectiveHrZones = useMemo(() => {
    if (track.activityType === 'running') {
      return customHrZonesBase.map(z => ({
        ...z,
        min: z.min + 10,
        max: z.max + 10
      }));
    }
    return customHrZonesBase;
  }, [customHrZonesBase, track.activityType]);

  // Heart Rate Zones calculation
  const hrZones = useMemo(() => {
    const zones = effectiveHrZones.map((z, idx) => {
      let minVal = z.min;
      let maxVal = z.max;
      if (idx === 0) {
        minVal = 0;
      }
      if (idx === 4) {
        maxVal = 250;
      }
      return {
        key: z.key,
        name: z.key,
        fullName: z.fullName,
        min: minVal,
        max: maxVal,
        color: z.color,
        duration: 0,
        desc: z.desc,
        benefit: z.benefit
      };
    });

    let totalHrSecs = 0;
    analysisPoints.forEach((p, idx) => {
      if (p.hr !== undefined && p.hr > 40) {
        let delta = 1;
        if (idx > 0 && analysisPoints[idx].time && analysisPoints[idx - 1].time) {
          delta = (analysisPoints[idx].time!.getTime() - analysisPoints[idx - 1].time!.getTime()) / 1000;
          if (delta <= 0 || delta > 12) delta = 1;
        }

        const match = zones.find(z => p.hr! >= z.min && p.hr! < z.max);
        if (match) {
          match.duration += delta;
          totalHrSecs += delta;
        }
      }
    });

    return zones.map((z, idx) => {
      const mins = Math.floor(z.duration / 60);
      const secs = Math.floor(z.duration % 60);
      const realMin = effectiveHrZones[idx]?.min ?? z.min;
      const realMax = effectiveHrZones[idx]?.max ?? z.max;
      return {
        ...z,
        percent: totalHrSecs > 0 ? (z.duration / totalHrSecs) * 100 : 0,
        timeStr: mins > 0 ? `${mins}m ${secs}s` : `${secs}s`,
        seconds: Math.floor(z.duration),
        rangeStr: idx === 0 
          ? `< ${Math.round(realMax)} bpm`
          : idx === 4 
            ? `> ${Math.round(realMin)} bpm`
            : `${Math.round(realMin)}-${Math.round(realMax)} bpm`
      };
    });
  }, [effectiveHrZones, analysisPoints]);

  // Cycling Power Zones
  const powerZones = useMemo(() => {
    const zones = [
      { 
        name: 'KB', 
        fullName: 'KB – Kompensationsbereich (Erholung)',
        min: 0, 
        max: 0.55 * ftp, 
        color: '#3b82f6', 
        duration: 0,
        desc: 'Besonders leichtes Kurbeln zur Entlastung des Muskel- und Skelettsystems nach Wettkämpfen.',
        benefit: 'Regeneriert den Muskeltonus und fördert die Durchblutung ohne nennenswerte Ermüdung.'
      },
      { 
        name: 'GA1', 
        fullName: 'GA1 – Grundlagenausdauer 1',
        min: 0.55 * ftp, 
        max: 0.75 * ftp, 
        color: '#10b981', 
        duration: 0,
        desc: 'Klassische Grundlagenausdauer 1. Das Fundament für jeden Radsportler.',
        benefit: 'Erhöht die Mitochondriendichte, verbessert die Sauerstoffnutzung und optimiert die Fettverbrennung.'
      },
      { 
        name: 'GA2', 
        fullName: 'GA2 – Grundlagenausdauer 2',
        min: 0.75 * ftp, 
        max: 0.90 * ftp, 
        color: '#eab308', 
        duration: 0,
        desc: 'Zügiges Reisetempo oder langes Bergfahren bei moderater bis mittlerer Atemanstrengung.',
        benefit: 'Trainiert die Kohlenhydratspeicher-Ökonomie und erhöht die aerobe Ausdauerleistung.'
      },
      { 
        name: 'EB', 
        fullName: 'EB – Entwicklungsbereich',
        min: 0.90 * ftp, 
        max: 1.05 * ftp, 
        color: '#f97316', 
        duration: 0,
        desc: 'Fahren direkt im Bereich der funktionellen Schwellenleistung (FTP). Laktat-Aufbau und -Abbau im Gleichgewicht.',
        benefit: 'Verschiebt die anaerobe Schwelle nach oben, perfekt für lange Alpenpässe oder Zeitfahren.'
      },
      { 
        name: 'SB', 
        fullName: 'SB – Spitzenbereich',
        min: 1.05 * ftp, 
        max: 2500, 
        color: '#ef4444', 
        duration: 0,
        desc: 'Maximale Leistung nahe der maximalen Sauerstoffaufnahme, anaerobe Sprints und neuromuskuläre Spitzenreize.',
        benefit: 'Maximiert VO2max, die neuromuskuläre Rekrutierung, die Laktattoleranz und die anaerobe Sprintkapazität.'
      },
    ];

    let totalEffectiveSeconds = 0;
    analysisPoints.forEach((p, i) => {
      if (p.power !== undefined) {
        let delta = 1;
        if (i > 0 && p.time && analysisPoints[i - 1].time) {
          delta = (p.time.getTime() - analysisPoints[i - 1].time.getTime()) / 1000;
          if (delta <= 0 || delta > 12) delta = 1;
        }
        
        const zone = zones.find(z => p.power! >= z.min && p.power! < z.max);
        if (zone) {
          zone.duration += delta;
          totalEffectiveSeconds += delta;
        }
      }
    });

    return zones.map((z, idx) => {
      const mins = Math.floor(z.duration / 60);
      const secs = Math.floor(z.duration % 60);
      return {
        ...z,
        percent: totalEffectiveSeconds > 0 ? (z.duration / totalEffectiveSeconds) * 100 : 0,
        timeStr: mins > 0 ? `${mins}m ${secs}s` : `${secs}s`,
        seconds: Math.floor(z.duration),
        rangeStr: idx === 0 
          ? `< ${Math.round(0.55 * ftp)} W`
          : idx === 4 
            ? `> ${Math.round(1.05 * ftp)} W`
            : `${Math.round(z.min)}-${Math.round(z.max)} W`
      };
    });
  }, [analysisPoints, ftp]);

  // Active Zones selection (Pace vs HR for runs, Power vs HR for cycling)
  const [activeZoneMetric, setActiveZoneMetric] = useState<'pace' | 'hr' | 'power'>(
    isRunning ? 'pace' : 'power'
  );

  const activeZoneData = useMemo(() => {
    if (activeZoneMetric === 'pace') return paceZones;
    if (activeZoneMetric === 'hr') return hrZones;
    return powerZones;
  }, [activeZoneMetric, paceZones, hrZones, powerZones]);

  const bestPaceDecimal = useMemo(() => {
    const validPaces = enrichedTimelineData.map(p => p.pace).filter(p => p > 2.0 && p < 15.0);
    if (validPaces.length === 0) return 0;
    // take the 5th percentile to offset single-point GPS jitter
    const sorted = [...validPaces].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.05)] || sorted[0];
  }, [enrichedTimelineData]);

  // Estimate Running Cardiac Stress Score "rTSS/hrTSS"
  const cardiacStressScore = useMemo(() => {
    if (durationSecs === 0) return 0;
    const lthr = (220 - userAge) * 0.85;
    const heartIntensity = avgHr ? avgHr / lthr : 0.82;
    // hrTSS formula
    return Math.round((durationSecs / 3600) * heartIntensity * heartIntensity * 100);
  }, [durationSecs, avgHr, userAge]);

  const avgRunningCadence = useMemo(() => {
    const cadPts = analysisPoints.filter(p => p.cadence !== undefined && p.cadence > 0).map(p => p.cadence!);
    if (cadPts.length === 0) return null;
    const rawVal = cadPts.reduce((sum, c) => sum + c, 0) / cadPts.length;
    // convert single stroke back to overall steps per min
    return Math.round(rawVal < 110 ? rawVal * 2 : rawVal);
  }, [analysisPoints]);

  const climbCategory = (ascent: number, avgGrad: number, distM: number) => {
    const score = (ascent * avgGrad) / 10 + (ascent * ascent / distM) * 0.1;
    if (score >= 200) return { label: 'HC (Hors Cat.)', color: 'bg-slate-900 border-slate-950 text-white font-black' };
    if (score >= 100) return { label: 'Kategorie 1', color: 'bg-rose-100 border-rose-200 text-rose-700 font-bold' };
    if (score >= 45) return { label: 'Kategorie 2', color: 'bg-orange-100 border-orange-200 text-orange-700 font-bold' };
    if (score >= 18) return { label: 'Kategorie 3', color: 'bg-yellow-50 border-yellow-200 text-yellow-700 font-bold' };
    return { label: 'Kategorie 4', color: 'bg-emerald-100 border-emerald-200 text-emerald-700' };
  };

  const calculateVAM = (ascent: number, startIndex: number, endIndex: number) => {
    const segment = track.points.slice(startIndex, endIndex + 1);
    const firstTime = segment.find(p => p.time !== undefined)?.time;
    const lastTime = [...segment].reverse().find(p => p.time !== undefined)?.time;
    
    if (firstTime && lastTime) {
      const hours = (lastTime.getTime() - firstTime.getTime()) / 3600000;
      if (hours > 0.005) {
        return Math.round(ascent / hours);
      }
    }
    return null;
  };

  const getClimbAvgPower = (startIndex: number, endIndex: number) => {
    const segment = track.points.slice(startIndex, endIndex + 1);
    const powerPoints = segment.filter(p => p.power !== undefined).map(p => p.power!);
    if (powerPoints.length === 0) return 0;
    return Math.round(powerPoints.reduce((a, b) => a + b, 0) / powerPoints.length);
  };

  const focusOnClimb = (startIndex: number, endIndex: number) => {
    if (!onSelection || startIndex >= track.points.length || endIndex >= track.points.length) return;
    
    const climbPoints = track.points.slice(startIndex, endIndex + 1);
    if (climbPoints.length === 0) return;
    
    const lats = climbPoints.map(p => p.lat);
    const lngs = climbPoints.map(p => p.lng);
    
    onSelection({
      minLat: Math.min(...lats) - 0.002,
      maxLat: Math.max(...lats) + 0.002,
      minLng: Math.min(...lngs) - 0.002,
      maxLng: Math.max(...lngs) + 0.002
    });
  };

  // Human readable labels for chart series
  const timelineMetricsDef = [
    { key: 'pace', name: 'Lauf-Pace', unit: ' min/km', speedAware: true, rOnly: true },
    { key: 'speed', name: 'Geschwindigkeit', unit: ' km/h', speedAware: true },
    { key: 'elevation', name: 'Höhenprofil', unit: ' m' },
    { key: 'hr', name: 'Herzfrequenz', unit: ' bpm' },
    { key: 'power', name: 'Leistung (Power)', unit: ' W' },
    { key: 'slope', name: 'Steigung', unit: '%' },
    { key: 'cadence', name: isRunning ? 'Schrittfrequenz' : 'Trittfrequenz', unit: isRunning ? ' spm' : ' rpm' },
  ];

  const availableTimelineMetrics = timelineMetricsDef.filter(m => {
    if (m.rOnly && !isRunning) return false;
    if (m.key === 'hr' && !track.points.some(p => p.hr !== undefined)) return false;
    if (m.key === 'power' && !track.points.some(p => p.power !== undefined)) return false;
    if (m.key === 'cadence' && !track.points.some(p => p.cadence !== undefined)) return false;
    return true;
  });

  const activeTimelineDef = timelineMetricsDef.find(m => m.key === activeTimelineMetric) || timelineMetricsDef[2];

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      className="fixed inset-0 z-[2000] bg-slate-50 dark:bg-slate-950 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-8 py-3 sm:py-5 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="p-2 sm:p-3 bg-indigo-600 rounded-xl text-white shadow-lg shrink-0">
            <Activity className="w-5 h-5 sm:w-7 sm:h-7" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-2xl font-bold text-slate-900 dark:text-white flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 truncate">
              <span className="truncate">{track.name}</span>
              <div className="flex flex-wrap gap-1 items-center">
                <span className={`text-[9px] sm:text-[11px] font-black uppercase px-2 py-0.5 rounded-full ${isRunning ? 'bg-orange-100 text-orange-700 border border-orange-200 shadow-2xs' : 'bg-blue-100 text-blue-700 border border-blue-200 shadow-2xs'}`}>
                  {isRunning ? '🏃 Laufen' : '🚴 Rad'}
                </span>
                {selectionBounds && (
                  <span className="text-[9px] sm:text-xs bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-350 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                    Auswahl
                  </span>
                )}
              </div>
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-[10px] sm:text-sm font-medium">
              Performance- & {isRunning ? 'Pace-Analyse' : 'Leistungsdaten'}
            </p>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-1.5 sm:p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0 cursor-pointer"
        >
          <X className="w-6 h-6 sm:w-8 sm:h-8" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-7xl mx-auto space-y-8">
          
          {/* Dynamic Metric Cards Grid depending on Activity Type */}
          {isRunning ? (
            <div className="flex sm:grid overflow-x-auto sm:overflow-x-visible pb-1 sm:pb-0 gap-4 sm:grid-cols-2 lg:grid-cols-5 snap-x max-w-full no-scrollbar">
              <MetricCard 
                label="Ø Pace (Tempo)" 
                value={formatPaceDecimal(averagePaceSeconds / 60)} 
                icon={<Clock className="text-orange-500" />}
                subValue={`Beste: ${formatPaceDecimal(bestPaceDecimal)}`}
                color="border-orange-200 bg-orange-50/30 dark:border-orange-900/40 dark:bg-orange-950/10"
                tooltip="Durchschnittliches Tempo in Minuten pro Kilometer. Phasen unter 2 km/h sind automatisch gefiltert, um Pausen nicht fälschlich einzurechnen."
              />
              <MetricCard 
                label="Cardio-Belastung (TSS)" 
                value={cardiacStressScore} 
                icon={<Shield className="text-indigo-500" />}
                subValue="Training Stress Score"
                color="border-indigo-200 bg-indigo-50/30 dark:border-indigo-900/40 dark:bg-indigo-950/10"
                tooltip="Herz-Kreislauf-Belastung geschätzt an deiner maximalen Herzfrequenz. Entspricht der physiologischen Intensität multipliziert mit der Dauer."
              />
              <MetricCard 
                label="VO2max Schätz. (Laufen)" 
                value={vo2maxEstimate || '--'} 
                icon={<Activity className="text-purple-500" />}
                subValue={vo2Category?.label || 'Ausdauerkapazität'}
                color="border-purple-200 bg-purple-50/30 dark:border-purple-900/40 dark:bg-purple-950/10"
                tooltip="Berechnet nach der ACSM Formel für Läufer: VO2 = 0.2 * v + 0.9 * v * Steigung + 3.5. Exponentiell gewichtet und korrigiert basierend auf der HR-Antwort."
              />
              <MetricCard 
                label="Tritt-/Schrittfrequenz" 
                value={avgRunningCadence ? `${avgRunningCadence} spm` : '--'} 
                icon={<TrendingUp className="text-emerald-500" />}
                subValue="Steps Per Minute"
                color="border-emerald-200 bg-emerald-50/30 dark:border-emerald-900/40 dark:bg-emerald-950/10"
                tooltip="Deine durchschnittliche Schrittfrequenz (beide Füße zusammen). Ein optimales Ziel für gesundes Laufen liegt meist bei 170-185 Schritten pro Minute."
              />
              <MetricCard 
                label="Energieverbrauch" 
                value={`${Math.round((avgHr ? 11 : 8.5) * (userWeight || 75) * (durationSecs / 3600))} kcal`} 
                icon={<Zap className="text-rose-500" />}
                subValue="Aktiv-Verbrauch"
                color="border-rose-200 bg-rose-50/30 dark:border-rose-900/40 dark:bg-rose-950/10"
                tooltip="Kalorienberechnung basierend auf dem metabolischen Äquivalent (MET) deiner durchschnittlichen Laufgeschwindigkeit im Verhältnis zur Gesamtzeit und deinem Körpergewicht."
              />
            </div>
          ) : (
            <div className="flex sm:grid overflow-x-auto sm:overflow-x-visible pb-1 sm:pb-0 gap-4 sm:grid-cols-2 lg:grid-cols-5 snap-x max-w-full no-scrollbar">
              <MetricCard 
                label="Normalized Power" 
                value={`${Math.round(powerStats?.normalizedPower || 0)} W`} 
                icon={<Zap className="text-yellow-500" />}
                subValue={`VI: ${(powerStats?.variabilityIndex || 1).toFixed(2)}`}
                color="border-yellow-200 bg-yellow-50/30 dark:border-yellow-905 dark:bg-yellow-950/10"
                tooltip="NP (Coggan): Ein gleitender 30-Sekunden Durchschnitt, der vierte Potenzierung nutzt, um die physiologischen Kosten intensiver Belastungsspitzen genauer abzubilden."
              />
              <MetricCard 
                label="TSS" 
                value={Math.round(powerStats?.tss || 0)} 
                icon={<Shield className="text-indigo-500" />}
                subValue="Training Stress Score"
                color="border-indigo-200 bg-indigo-50/30 dark:border-indigo-905 dark:bg-indigo-950/10"
                tooltip="Gesamtbelastung der Einheit. Formel: (Dauer in s * NP * IF) / (FTP * 3600) * 100. Ein Wert von 100 entspricht einer einstündigen Belastung exakt an der FTP-Grenze."
              />
              <MetricCard 
                label="VO2max Schätz. (Rad)" 
                value={vo2maxEstimate || '--'} 
                icon={<Activity className="text-purple-500" />}
                subValue={vo2Category?.label || 'Ausdauerkapazität'}
                color="border-purple-200 bg-purple-50/30 dark:border-purple-905 dark:bg-purple-950/10"
                tooltip="Geschätzt via ACSM-Leistungsformel: (10.8 * Watt/kg) + 7. Wenn HR-Daten vorliegen, wird zusätzlich die Leistung bei maximaler Herzfrequenz linear extrapoliert für höhere Genauigkeit."
              />
              <MetricCard 
                label="Intensity Factor" 
                value={(powerStats?.intensityFactor || 0).toFixed(2)} 
                icon={<TrendingUp className="text-emerald-500" />}
                subValue={`${Math.round((powerStats?.intensityFactor || 0) * 100)}% von FTP`}
                color="border-emerald-200 bg-emerald-50/30 dark:border-emerald-905 dark:bg-emerald-950/10"
                tooltip="IF = NP / FTP. Beschreibt die relative Intensität. Eine 'gemütliche' Fahrt liegt oft bei 0.6-0.7, ein intensives Rennen bei 0.9-1.05."
              />
              <MetricCard 
                label="Arbeit" 
                value={`${Math.round(powerStats?.work || 0)} kJ`} 
                icon={<Activity className="text-rose-500" />}
                subValue="Gesamtleistung"
                color="border-rose-200 bg-rose-50/30 dark:border-rose-905 dark:bg-rose-950/10"
                tooltip="Die physikalisch geleistete Arbeit in Kilojoule. Da der Wirkungsgrad des Menschen beim Radfahren ca. 20-25% beträgt, entspricht dieser Wert grob den verbrannten Kilokalorien."
              />
            </div>
          )}

          {/* Interactive Plot Controls & Timeline Graph */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Main Interactive Diagram with Selection */}
            <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <BarChart2 size={20} className="text-indigo-600 dark:text-indigo-400" />
                    Werte-Profile über Distanz
                  </h3>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Klicke auf die Tabs unten, um die Metrik im Diagramm zu wechseln.</p>
                </div>
                <button 
                  onClick={() => setFullscreenChart('pd')}
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors self-end sm:self-auto"
                  title="Vollbild"
                >
                  <Maximize2 size={18} />
                </button>
              </div>

              {/* Responsive Tabs instead of a rigid timeline */}
              <div className="flex flex-wrap gap-1.5 mb-6 bg-slate-100 dark:bg-slate-950 p-1 rounded-xl">
                {availableTimelineMetrics.map(m => (
                  <button
                    key={m.key}
                    onClick={() => setActiveTimelineMetric(m.key)}
                    className={`flex-1 min-w-[80px] text-center px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      activeTimelineMetric === m.key 
                        ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' 
                        : 'text-slate-500 hover:text-slate-705 dark:hover:text-slate-300'
                    }`}
                  >
                    {m.name}
                  </button>
                ))}
              </div>

              {/* Chart Plot Area */}
              <div className="h-64 sm:h-72 w-full text-zinc-900">
                {timelineChartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-400">Keine Datenpunkte geladen</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorTimeline" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.12)" />
                      <XAxis 
                        dataKey="distance" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#94a3b8', fontSize: 10 }} 
                        tickFormatter={(val) => `${val}km`}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#94a3b8', fontSize: 10 }}
                        unit={activeTimelineDef.unit}
                        domain={['auto', 'auto']}
                        reversed={activeTimelineMetric === 'pace'} // reverse pace chart so faster is higher
                      />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                        formatter={(value: any) => {
                          if (activeTimelineMetric === 'pace') {
                            return [formatPaceDecimal(Number(value)), 'Pace'];
                          }
                          return [`${value}${activeTimelineDef.unit}`, activeTimelineDef.name];
                        }}
                        labelFormatter={(dist) => `Distanz: ${dist} km`}
                      />
                      <Area 
                        type="monotone" 
                        dataKey={activeTimelineMetric} 
                        stroke="#4f46e5" 
                        strokeWidth={3}
                        fillOpacity={1} 
                        fill="url(#colorTimeline)" 
                        animationDuration={600}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Zone Distribution Profile */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col relative">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Zap size={20} className="text-amber-500" />
                  Zonenverteilung
                </h3>
                <button 
                  onClick={() => setFullscreenChart('zones')}
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  title="Vollbild"
                >
                  <Maximize2 size={16} />
                </button>
              </div>

              {/* Select Zones Metric */}
              <div className="flex border border-slate-200 dark:border-slate-800 p-0.5 rounded-lg mb-4 text-xs font-semibold bg-slate-50 dark:bg-slate-950">
                {isRunning && (
                  <button 
                    onClick={() => setActiveZoneMetric('pace')}
                    className={`flex-1 py-1 text-center rounded ${activeZoneMetric === 'pace' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'}`}
                  >
                    Pace-Zonen
                  </button>
                )}
                {track.points.some(p => p.hr !== undefined) && (
                  <button 
                    onClick={() => setActiveZoneMetric('hr')}
                    className={`flex-1 py-1 text-center rounded ${activeZoneMetric === 'hr' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'}`}
                  >
                    Herz-Zonen
                  </button>
                )}
                {(!isRunning || track.points.some(p => p.power !== undefined)) && (
                  <button 
                    onClick={() => setActiveZoneMetric('power')}
                    className={`flex-1 py-1 text-center rounded ${activeZoneMetric === 'power' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'}`}
                  >
                    Watts/Power
                  </button>
                )}
              </div>

              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activeZoneData} layout="vertical" margin={{ left: -10, right: 10 }}>
                    <XAxis type="number" hide />
                    <YAxis 
                      dataKey="name" 
                      type="category" 
                      axisLine={false} 
                      tickLine={false}
                      width={110}
                      tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                      tickFormatter={(val) => val.split(' ')[0]} // Short Zone Identifier eg Z1
                    />
                    <Tooltip 
                      cursor={{ fill: 'transparent' }}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-white dark:bg-slate-800 p-3 rounded-xl shadow-xl border border-slate-150 dark:border-slate-700">
                              <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1">{data.name}</p>
                              <div className="flex items-baseline gap-2">
                                <span className="text-lg font-black text-slate-900 dark:text-white">{data.percent.toFixed(1)}%</span>
                                <span className="text-xs font-semibold text-slate-400">({data.timeStr})</span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="percent" radius={[0, 4, 4, 0]} barSize={16}>
                      {activeZoneData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Tabular summary with hover explanations */}
              <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2 mt-auto relative">
                <div className="grid grid-cols-4 text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider">
                  <div className="col-span-2">Bereich</div>
                  <div className="text-right">Anteil</div>
                  <div className="text-right">Dauer</div>
                </div>
                {activeZoneData.map((entry, index) => (
                  <div 
                    key={index} 
                    className="relative group grid grid-cols-4 text-xs font-semibold items-center hover:bg-slate-50 dark:hover:bg-slate-800/50 p-1 rounded transition-colors text-slate-700 dark:text-slate-300 cursor-help"
                  >
                    <div className="col-span-2 flex items-center gap-2 overflow-hidden truncate">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                      <span className="font-bold truncate" title={entry.name}>{entry.name}</span>
                      <span className="text-[9px] text-slate-400 dark:text-slate-500 font-mono hidden sm:inline-block">({entry.rangeStr})</span>
                    </div>
                    <div className="text-right font-mono font-bold text-slate-800 dark:text-slate-100">
                      {entry.percent.toFixed(1)}%
                    </div>
                    <div className="text-right font-mono text-slate-400 dark:text-slate-500">
                      {entry.timeStr}
                    </div>

                    {/* Popover Hover Tooltip explanation */}
                    <div className="absolute left-[2%] bottom-[125%] hidden group-hover:flex flex-col z-[3000] bg-slate-900/95 border border-slate-800 text-white rounded-2xl p-4 w-72 shadow-2xl pointer-events-none transition-all duration-200 scale-95 group-hover:scale-100 origin-bottom backdrop-blur-md">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                        <span className="font-extrabold text-xs text-slate-100 tracking-wider">
                          {entry.fullName || entry.name}
                        </span>
                      </div>
                      <div className="text-[9px] font-mono text-slate-400 mb-2">Grenzwerte: {entry.rangeStr}</div>
                      <p className="text-[11px] text-slate-300 leading-relaxed font-semibold">
                        {entry.desc}
                      </p>
                      {entry.benefit && (
                        <div className="mt-2 pt-2 border-t border-slate-800/80 flex flex-col gap-0.5">
                          <span className="text-[9px] font-black uppercase text-emerald-400 tracking-wider">Sportliche Wirkung:</span>
                          <span className="text-[10.5px] text-slate-350 leading-snug font-medium">
                            {entry.benefit}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Running vs Cycling Best Effort Summaries */}
          {isRunning ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-center bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="space-y-2">
                <div className="text-slate-400 dark:text-slate-450 text-sm font-semibold">Durchschnittliches Tempo</div>
                <div className="text-3xl font-black text-slate-905 dark:text-white">
                  {formatPaceDecimal(averagePaceSeconds / 60)}
                </div>
                <div className="text-xs text-orange-500 font-bold uppercase tracking-widest">Ø Training Pace</div>
              </div>
              <div className="space-y-2 border-x border-slate-100 dark:border-slate-800">
                <div className="text-slate-400 dark:text-slate-450 text-sm font-semibold">Beste Pace (Peak Leistung)</div>
                <div className="text-3xl font-black text-slate-905 dark:text-white">
                  {formatPaceDecimal(bestPaceDecimal)}
                </div>
                <div className="text-xs text-emerald-500 font-bold uppercase tracking-widest">Spitzen-Intervall</div>
              </div>
              <div className="space-y-2">
                <div className="text-slate-400 dark:text-slate-450 text-sm font-semibold">Aerobe Schwelle (Puls)</div>
                <div className="text-3xl font-black text-slate-905 dark:text-white">
                  {Math.round((220 - userAge) * 0.82)} bpm
                </div>
                <div className="text-xs text-rose-500 font-bold uppercase tracking-widest">Basierend auf Alter {userAge}</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-center bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="space-y-2">
                <div className="text-slate-400 text-sm font-medium">Beste 60 Sek.</div>
                <div className="text-3xl font-black text-slate-900 dark:text-white">{Math.round(powerStats?.best1m || 0)}W</div>
                <div className="text-xs text-indigo-505 font-bold uppercase tracking-widest">Sprint / Attacke</div>
              </div>
              <div className="space-y-2 border-x border-slate-100 dark:border-slate-800">
                <div className="text-slate-400 text-sm font-medium">Beste 20 Min.</div>
                <div className="text-3xl font-black text-slate-900 dark:text-white">{Math.round(powerStats?.best20m || 0)}W</div>
                <div className="text-xs text-emerald-550 font-bold uppercase tracking-widest">Klettern / TT</div>
              </div>
              <div className="space-y-2">
                <div className="text-slate-400 text-sm font-medium">Geschätztes FTP</div>
                <div className="text-3xl font-black text-slate-900 dark:text-white">{Math.round((powerStats?.best20m || 0) * 0.95)}W</div>
                <div className="text-xs text-rose-505 font-bold uppercase tracking-widest">Basierend auf 20m</div>
              </div>
            </div>
          )}

          {/* GoldenCheetah inspired overview */}
          <div className="bg-indigo-950 dark:bg-slate-900 text-white p-8 rounded-3xl overflow-hidden relative shadow-xl">
             <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-12">
               <div className="space-y-4">
                 <div className="flex items-center gap-2 opacity-80">
                   <Clock size={18} />
                   <span className="text-sm font-bold uppercase tracking-widest">Gesamtzeit</span>
                 </div>
                 <div className="text-4xl font-black">
                   {durationSecs ? `${Math.floor(durationSecs / 3600)}h ${Math.floor((durationSecs % 3600) / 60)}m ${Math.floor(durationSecs % 60)}s` : '--'}
                 </div>
                 <p className="text-indigo-200 text-sm leading-relaxed">Gesamte aufgezeichnete Aktivitätszeit für diesen Bereich.</p>
               </div>
               
               <div className="space-y-4">
                 <div className="flex items-center gap-2 opacity-80">
                   <Heart size={18} />
                   <span className="text-sm font-bold uppercase tracking-widest">Herzfrequenz (Ø)</span>
                 </div>
                 <div className="text-4xl font-black">
                   {avgHr ? `${avgHr} bpm` : '--'}
                 </div>
                 <p className="text-indigo-200 text-sm leading-relaxed">Durchschnittliche Pulsbelastung des Herzens.</p>
               </div>

               <div className="space-y-4">
                 <div className="flex items-center gap-2 opacity-80">
                   <TrendingUp size={18} />
                   <span className="text-sm font-bold uppercase tracking-widest">Strecke</span>
                 </div>
                 <div className="text-4xl font-black">
                   {useDistance.toFixed(2)} km
                 </div>
                 <p className="text-indigo-200 text-sm leading-relaxed">Zurückgelegte Wegstrecke basierend auf GPS-Koordinaten.</p>
               </div>
             </div>
             
             {/* Abstract background decorations */}
             <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -mr-48 -mt-48 blur-3xl pointer-events-none" />
             <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full -ml-32 -mb-32 blur-3xl pointer-events-none" />
          </div>

          {/* Elevation PROFILE Analysis */}
          <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <span className="bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-450 p-2 rounded-xl text-lg block leading-none">
                    ⛰️
                  </span>
                  Höhenprofil- & Steigungsanalyse
                </h3>
                <p className="text-slate-400 dark:text-slate-500 text-sm font-semibold max-w-xl">
                  Klassifizierung nach FIETS-Index, Steigraten (VAM) und Karten-Segmentfokus.
                </p>
              </div>
              {selectionBounds && (
                <button
                  onClick={() => onSelection && onSelection(null)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-705 text-slate-700 dark:text-white rounded-xl text-xs font-bold transition-all border border-slate-200 dark:border-slate-700 cursor-pointer self-start sm:self-auto flex items-center gap-1"
                >
                  <span>✖</span> Fokus zurücksetzen
                </button>
              )}
            </div>

            {!track.climbs || track.climbs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 text-center">
                <p className="text-sm font-bold text-slate-500">Keine signifikanten Steilstücke erkannt</p>
                <p className="text-xs max-w-md mt-1 text-slate-400">
                  Auf diesem Track wurden keine Anstiege mit einer Länge über 500 Meter und einer mittleren Steigung von mindestens 3.0 % identifiziert.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {track.climbs.map((climb, idx) => {
                  const cat = climbCategory(climb.ascent, climb.avgGradient, climb.distance);
                  const vam = calculateVAM(climb.ascent, climb.startIndex, climb.endIndex);
                  const avgPower = getClimbAvgPower(climb.startIndex, climb.endIndex);
                  const wKgRatio = (avgPower / (userWeight || 75)).toFixed(2);
                  const climbPoints = track.points.slice(climb.startIndex, climb.endIndex + 1);
                  const climbSpeedTotal = climbPoints.length > 1 && climbPoints[0].time && climbPoints[climbPoints.length - 1].time
                    ? (climb.distance / 1000) / ((climbPoints[climbPoints.length - 1].time!.getTime() - climbPoints[0].time!.getTime()) / 3600000)
                    : null;

                  const climbTimeSec = track.points[climb.endIndex].time && track.points[climb.startIndex].time
                    ? Math.round((track.points[climb.endIndex].time!.getTime() - track.points[climb.startIndex].time!.getTime()) / 1000)
                    : null;

                  const isFocused = selectionBounds && 
                    Math.abs(selectionBounds.minLat - (Math.min(...track.points.slice(climb.startIndex, climb.endIndex + 1).map(p => p.lat)) - 0.002)) < 0.001;

                  return (
                     <div 
                       key={idx}
                       className={`border rounded-2xl p-6 transition-all flex flex-col justify-between relative overflow-hidden ${
                         isFocused 
                           ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20 shadow-md ring-1 ring-indigo-500/30' 
                           : 'border-slate-200 dark:border-slate-800 hover:border-indigo-400 hover:bg-slate-50/50 shadow-sm'
                       }`}
                     >
                       {isFocused && (
                         <div className="absolute top-0 right-0 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-bl-xl">
                           Fokusiert
                         </div>
                       )}

                       <div>
                         <div className="flex items-center justify-between mb-3">
                           <span className="font-extrabold text-slate-900 dark:text-white text-lg">
                             Anstieg #{idx + 1}
                           </span>
                           <span className={`px-2.5 py-1 text-[11px] font-extrabold rounded-full border ${cat.color}`}>
                             {cat.label}
                           </span>
                         </div>

                         <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 my-4 border-y border-slate-100 dark:border-slate-800 py-4 text-xs font-semibold text-slate-600 dark:text-slate-400">
                           <div>
                             <span className="text-[10px] text-slate-400 uppercase tracking-widest block font-bold mb-0.5">Länge</span>
                             <span className="font-black text-slate-900 dark:text-white text-sm">{(climb.distance / 1000).toFixed(2)} km</span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-405 uppercase tracking-widest block font-bold mb-0.5 font-sans">Höhendifferenz</span>
                             <span className="font-black text-rose-600 text-sm">+{Math.round(climb.ascent)} Hm</span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-405 uppercase tracking-widest block font-bold mb-0.5">Steigung (Ø / Max)</span>
                             <span className="font-black text-slate-900 dark:text-white text-sm">{climb.avgGradient.toFixed(1)}% / {climb.maxGradient.toFixed(1)}%</span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-405 uppercase tracking-widest block font-bold mb-0.5">Berggeschw. / Pace</span>
                             <span className="font-black text-slate-900 dark:text-white text-sm">
                               {climbSpeedTotal 
                                 ? isRunning 
                                   ? formatPaceDecimal(60 / climbSpeedTotal) 
                                   : `${climbSpeedTotal.toFixed(1)} km/h`
                                 : '--'
                               }
                             </span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-405 uppercase tracking-widest block font-bold mb-0.5">Steigrate (VAM)</span>
                             <span className="font-black text-indigo-600 dark:text-indigo-400 text-sm">{vam ? `${vam} Hm/h` : '--'}</span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-405 uppercase tracking-widest block font-bold mb-0.5">Ø Leistung</span>
                             <span className="font-black text-amber-600 text-sm">
                               {avgPower ? `${avgPower} W` : (isRunning ? 'Wird simuliert' : '--')}
                             </span>
                           </div>
                         </div>
                       </div>

                       <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-bold">
                         {climbTimeSec ? (
                           <span className="text-slate-400 font-medium font-mono text-center sm:text-left">
                             Dauer: {Math.floor(climbTimeSec / 60)}m {climbTimeSec % 60}s
                           </span>
                         ) : (
                           <div />
                         )}
                         <button
                           onClick={() => focusOnClimb(climb.startIndex, climb.endIndex)}
                           className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all font-bold text-center flex items-center justify-center gap-1 shadow-sm cursor-pointer"
                         >
                           <span>🔍</span> Auf Karte zoomen
                         </button>
                       </div>
                     </div>
                   );
                 })}
               </div>
            )}
          </div>

          {/* Fullscreen Modal View for interactive detail graphs */}
          <AnimatePresence>
            {fullscreenChart && (
              <div className="fixed inset-0 z-[400] bg-white dark:bg-slate-950 flex flex-col p-4 sm:p-10 transition-all overflow-hidden">
                <motion.div 
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="flex-1 flex flex-col h-full overflow-hidden"
                >
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                      <div className={`p-4 rounded-2xl ${fullscreenChart === 'pd' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50' : 'bg-amber-50 text-amber-600 dark:bg-amber-950/50'}`}>
                        {fullscreenChart === 'pd' ? <BarChart2 size={32} /> : <Zap size={32} />}
                      </div>
                      <div>
                        <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                          {fullscreenChart === 'pd' ? `Verlaufsprofil: ${activeTimelineDef.name}` : `Detaillierte Zonen: ${activeZoneMetric === 'hr' ? 'Herzrate' : activeZoneMetric === 'pace' ? 'Pace' : 'Watt'}`}
                        </h3>
                        <p className="text-sm font-bold text-slate-450 uppercase tracking-widest">Detail-Analyse im Vollbildmodus</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setFullscreenChart(null)}
                      className="p-4 bg-slate-100 dark:bg-slate-800 rounded-2xl text-slate-600 dark:text-slate-200 hover:bg-slate-200"
                    >
                      <X size={28} />
                    </button>
                  </div>
                  
                  <div className="flex-1 w-full bg-slate-900 rounded-[32px] p-6 sm:p-10 shadow-2xl relative overflow-hidden flex flex-col">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[120px] rounded-full pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/10 blur-[120px] rounded-full pointer-events-none" />
                    
                    <div className="flex-1 w-full min-h-0 text-white">
                      <ResponsiveContainer width="100%" height="100%">
                        {fullscreenChart === 'pd' ? (
                          <AreaChart data={timelineChartData}>
                            <defs>
                              <linearGradient id="pdGradModal" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#818cf8" stopOpacity={0.4}/>
                                <stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                            <XAxis 
                              dataKey="distance" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{fill: 'rgba(255,255,255,0.4)', fontSize: 13}} 
                              tickFormatter={(val) => `${val} km`}
                            />
                            <YAxis 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{fill: 'rgba(255,255,255,0.4)', fontSize: 13}} 
                              unit={activeTimelineDef.unit} 
                              domain={['auto', 'auto']}
                              reversed={activeTimelineMetric === 'pace'}
                            />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#1e293b', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)' }}
                              cursor={{ stroke: '#818cf8', strokeWidth: 1.5 }}
                              formatter={(value: any) => {
                                if (activeTimelineMetric === 'pace') {
                                  return [formatPaceDecimal(Number(value)), 'Pace'];
                                }
                                return [`${value}${activeTimelineDef.unit}`, activeTimelineDef.name];
                              }}
                              labelFormatter={(dist) => `Distanz: ${dist} km`}
                            />
                            <Area type="monotone" dataKey={activeTimelineMetric} stroke="#818cf8" strokeWidth={4} fillOpacity={1} fill="url(#pdGradModal)" />
                          </AreaChart>
                        ) : (
                          <BarChart data={activeZoneData} layout="vertical" margin={{ left: 80, right: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.05)" />
                            <XAxis type="number" hide />
                            <YAxis 
                              dataKey="name" 
                              type="category" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{fill: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 700}} 
                            />
                            <Tooltip 
                              cursor={{fill: 'rgba(255,255,255,0.03)'}}
                              contentStyle={{ backgroundColor: '#1e293b', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)' }}
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const d = payload[0].payload;
                                  return (
                                    <div className="bg-slate-800 p-4 rounded-2xl border border-white/10 max-w-xs">
                                      <p className="text-[10px] font-black text-indigo-400 tracking-widest uppercase mb-1">{d.name}</p>
                                      <div className="flex items-baseline gap-2 mb-2">
                                        <span className="text-2xl font-black text-white">{d.percent.toFixed(1)}%</span>
                                        <span className="text-sm font-bold text-slate-450">({d.timeStr})</span>
                                      </div>
                                      <p className="text-xs text-slate-300 leading-relaxed border-t border-white/5 pt-2 font-medium">{d.desc}</p>
                                      {d.benefit && (
                                        <p className="text-[11px] text-emerald-400 mt-2 font-semibold">
                                          Wirkung: <span className="text-slate-200 font-medium">{d.benefit}</span>
                                        </p>
                                      )}
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <Bar dataKey="percent" radius={[0, 8, 8, 0]} barSize={40}>
                              {activeZoneData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Bar>
                          </BarChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  </div>
                  
                  <div className="mt-8 p-6 bg-slate-50 dark:bg-slate-900 rounded-[20px] border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
                    <div className="max-w-2xl">
                      <h4 className="font-black text-slate-950 dark:text-white uppercase tracking-widest text-xs mb-2">Interpretation & sportliche Bedeutung</h4>
                      <p className="text-slate-600 dark:text-slate-300 font-medium leading-relaxed italic text-sm">
                        {fullscreenChart === 'pd' 
                          ? 'Diese detaillierte Zeitreihe zeigt das Tempoerhalt und Intensitätsschwankungen über verschiedene Segmente deiner Route. Perfekt um Durchhänger oder Leistungshochs zu filtern.' 
                          : 'Der Zeitabschnitt in den Zonen zeigt, ob dein Training aerobe Grundlagen ausgebaut hat (Z1-Z3) oder vorrangig im schwellengebenden anaeroben Tempobereich (Z4-Z5) stattgefunden hat.'}
                      </p>
                    </div>
                    <button 
                      onClick={() => setFullscreenChart(null)}
                      className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition"
                    >
                      Zurück zur Analyse
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};

// Modular helper component for clean UI card metrics
const MetricCard = ({ 
  label, 
  value, 
  icon, 
  subValue, 
  color, 
  tooltip 
}: { 
  label: string; 
  value: string | number; 
  icon: React.ReactNode; 
  subValue?: string; 
  color: string; 
  tooltip?: string; 
}) => {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <>
      <div className={`p-4 sm:p-6 rounded-2xl border ${color} shadow-sm transition-all hover:shadow-md group relative w-[220px] sm:w-auto shrink-0 snap-center`}>
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-white dark:bg-slate-900 rounded-lg shadow-sm group-hover:scale-110 transition-transform">
            {icon}
          </div>
          {tooltip && (
            <button 
              onClick={() => setShowDetail(true)}
              className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all cursor-pointer"
              title="Informationen anzeigen"
            >
              <Shield size={16} className="opacity-60 group-hover:opacity-100" />
            </button>
          )}
        </div>
        <div className="space-y-1">
          <span className="text-[10px] text-slate-450 dark:text-slate-400 font-bold uppercase tracking-widest block">{label}</span>
          <div className="text-3xl font-black text-slate-900 dark:text-white">{value}</div>
          {subValue && <div className="text-slate-500 dark:text-slate-400 text-sm font-medium">{subValue}</div>}
        </div>
      </div>

      <AnimatePresence>
        {showDetail && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDetail(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden text-zinc-900 dark:text-zinc-100"
            >
              <div className="p-8">
                <div className="flex items-center gap-4 mb-6">
                  <div className={`p-3 rounded-2xl ${color.split(' ')[1] || 'bg-slate-100'}`}>
                    {icon}
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">{label}</h3>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Detail-Interpretation</p>
                  </div>
                </div>
                
                <div className="space-y-6">
                  <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Errechneter Wert</div>
                    <div className="text-3xl font-black text-slate-900 dark:text-white">{value}</div>
                  </div>

                  <div>
                    <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest mb-2 flex items-center gap-2">
                      <Shield size={14} className="text-indigo-505" />
                      Algorithmus & Trainingsauswirkung
                    </h4>
                    <p className="text-slate-650 dark:text-slate-300 text-sm leading-relaxed font-semibold">
                      {tooltip}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                    <button 
                      onClick={() => setShowDetail(false)}
                      className="w-full py-3 bg-slate-900 dark:bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-800 dark:hover:bg-slate-705 transition-colors"
                    >
                      Verstanden
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

export default AdvancedAnalytics;
