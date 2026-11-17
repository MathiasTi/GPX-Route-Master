import React, { useState, useMemo, useEffect } from 'react';
import { Heart, Zap, Clock, Gauge, Info } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { GPXTrack, GPXPoint } from '../../types';
import { triggerHaptic } from '../../utils/haptics';
import {
  estimateTrackPower,
  calculateDistance,
  estimateMedianSamplingIntervalSec,
  isRecordingPauseGap,
  computeActiveTrackStats
} from '../../utils/gpxUtils';
import { resolveTrackCapabilities, isFitTrackFile } from '../../utils/trackTelemetryCapabilities';
import { resolveTrackPointSpeedsKmh } from '../../domain/telemetry/pointMetricsEngine';

interface ZonesTabProps {
  track: GPXTrack;
  activityType?: 'cycling' | 'running';
  initialMaxHr?: number;
  onMaxHrChange?: (newMaxHr: number) => void;
  initialFtp?: number;
  initialWeight?: number;
  onOpenGlossary?: (metricId?: string) => void;
}

export const ZonesTab: React.FC<ZonesTabProps> = ({
  track,
  activityType,
  initialMaxHr = 185,
  onMaxHrChange,
  initialFtp = 220,
  initialWeight = 75
}) => {
  const effectiveActivityType = activityType || track.activityType || 'cycling';
  const isRunning = effectiveActivityType === 'running';
  const capabilities = useMemo(
    () => resolveTrackCapabilities({ ...track, activityType: effectiveActivityType }),
    [track, effectiveActivityType]
  );

  const canShowPace = isRunning && capabilities.hasPaceOrSpeed;
  const canShowHr = capabilities.hasHeartRate;
  const canShowPower = isRunning
    ? capabilities.hasNativePower
    : capabilities.hasNativePower || capabilities.hasTimestamps;

  const [maxHr, setMaxHr] = useState<number>(initialMaxHr);
  const [ftp, setFtp] = useState<number>(initialFtp);

  useEffect(() => {
    if (initialMaxHr && Number.isFinite(initialMaxHr)) {
      setMaxHr(initialMaxHr);
    }
  }, [initialMaxHr]);

  useEffect(() => {
    if (initialFtp && Number.isFinite(initialFtp)) {
      setFtp(initialFtp);
    }
  }, [initialFtp]);

  const activeTrackStats = useMemo(() => {
    if (!capabilities.hasTimestamps || !track.points || track.points.length < 2) return null;
    return computeActiveTrackStats(track.points);
  }, [capabilities.hasTimestamps, track.points]);

  const resolvedSpeedsKmh = useMemo(() => {
    if (!capabilities.hasPaceOrSpeed || !track.points || track.points.length < 2) return [];
    return resolveTrackPointSpeedsKmh(track.points, {
      isFitFile: isFitTrackFile(track),
      activityType: effectiveActivityType,
      trackDistanceKm: track.distance,
      trackDurationSec: track.duration,
    });
  }, [capabilities.hasPaceOrSpeed, track, effectiveActivityType]);

  // Compute detected average running pace from pause-aware track metrics or resolved speeds
  const detectedAvgPaceSec = useMemo(() => {
    const activeDuration = activeTrackStats?.activeDurationSeconds || track.duration;
    if (track.distance > 0 && activeDuration && activeDuration > 0) {
      const p = activeDuration / track.distance;
      if (p >= 150 && p <= 900) return p;
    }
    const validSpeeds = resolvedSpeedsKmh.filter(
      (s): s is number => typeof s === 'number' && Number.isFinite(s) && s >= 2.5 && s < 26
    );
    if (validSpeeds.length > 0) {
      const avgSpd = validSpeeds.reduce((a, b) => a + b, 0) / validSpeeds.length;
      const paceFromSpd = 3600 / avgSpd;
      if (paceFromSpd >= 150 && paceFromSpd <= 900) return paceFromSpd;
    }
    return 330; // 5:30 min/km default
  }, [activeTrackStats, track.duration, track.distance, resolvedSpeedsKmh]);

  // Running threshold pace (in seconds per km, e.g. 270 = 4:30 min/km)
  const [thresholdPace, setThresholdPace] = useState<number>(() => {
    return Math.round(detectedAvgPaceSec * 0.94);
  });

  useEffect(() => {
    if (isRunning) {
      setThresholdPace(Math.round(detectedAvgPaceSec * 0.94));
    }
  }, [track.id, isRunning, detectedAvgPaceSec]);

  const [zoneView, setZoneView] = useState<'pace' | 'hr' | 'power'>(() => {
    if (canShowPace) return 'pace';
    if (canShowHr) return 'hr';
    return 'power';
  });

  // Ensure zoneView stays on an available tab when switching track/sport
  useEffect(() => {
    const valid =
      (zoneView === 'pace' && canShowPace) ||
      (zoneView === 'hr' && canShowHr) ||
      (zoneView === 'power' && canShowPower);
    if (!valid) {
      if (canShowPace) setZoneView('pace');
      else if (canShowHr) setZoneView('hr');
      else if (canShowPower) setZoneView('power');
    }
  }, [zoneView, canShowPace, canShowHr, canShowPower]);

  const hasRealHr = capabilities.hasHeartRate;
  const hasRealPower = capabilities.hasNativePower;

  // Helper to format pace in mm:ss min/km
  const formatPace = (secsPerKm: number): string => {
    if (!isFinite(secsPerKm) || secsPerKm <= 0) return '--:--';
    const m = Math.floor(secsPerKm / 60);
    const s = Math.round(secsPerKm % 60);
    return `${m}:${s < 10 ? '0' : ''}${s} min/km`;
  };

  // Define 5 running pace zones (based on threshold pace)
  const paceZones = useMemo(() => {
    const z1Min = Math.round(thresholdPace * 1.25);
    const z2Min = Math.round(thresholdPace * 1.15);
    const z2Max = z1Min;
    const z3Min = Math.round(thresholdPace * 1.05);
    const z3Max = z2Min;
    const z4Min = Math.round(thresholdPace * 0.95);
    const z4Max = z3Min;
    const z5Max = z4Min;

    return [
      {
        id: 'pace_z1',
        key: 'KB',
        name: 'Z1 – Kompensation & Recom (Erholung)',
        sub: '> 125% Schwellenpace',
        rangeStr: `> ${formatPace(z1Min)}`,
        minSec: z1Min,
        maxSec: 9999,
        color: '#3b82f6',
        desc: 'Sehr lockerer Regenerationslauf, Aufwärmen oder entspanntes Auslaufen.',
        benefit: 'Fördert den Laktatabbau, schont Gelenke und beschleunigt die aktive Erholung.'
      },
      {
        id: 'pace_z2',
        key: 'GA1',
        name: 'Z2 – Lockerer Dauerlauf (DL1 / GA1)',
        sub: '115% – 125% Schwellenpace',
        rangeStr: `${formatPace(z2Max)} bis ${formatPace(z2Min)}`,
        minSec: z2Min,
        maxSec: z2Max,
        color: '#10b981',
        desc: 'Basis-Dauerlauf im aeroben Bereich. Hauptanteil (75–80%) eines soliden Lauftrainings.',
        benefit: 'Mitochondriendichte, Kapillarisierung und Stärkung des Band- und Sehnenapparats.'
      },
      {
        id: 'pace_z3',
        key: 'GA2',
        name: 'Z3 – Zügiger Dauerlauf (DL2 / GA2)',
        sub: '105% – 115% Schwellenpace',
        rangeStr: `${formatPace(z3Max)} bis ${formatPace(z3Min)}`,
        minSec: z3Min,
        maxSec: z3Max,
        color: '#eab308',
        desc: 'Marathontempo (MRT) und zügiger Dauerlauf mit vertiefter, kontrollierter Atmung.',
        benefit: 'Schult das spezifische Renntempo und ökonomisiert den Glykogenverbrauch.'
      },
      {
        id: 'pace_z4',
        key: 'EB',
        name: 'Z4 – Schwellenlauf / Tempodauerlauf (TDL)',
        sub: '95% – 105% Schwellenpace',
        rangeStr: `${formatPace(z4Max)} bis ${formatPace(z4Min)}`,
        minSec: z4Min,
        maxSec: z4Max,
        color: '#f97316',
        desc: 'Laufen an der anaeroben Schwelle (Laktat-Steady-State, 10k–Halbmarathontempo).',
        benefit: 'Hebt die Schwellengeschwindigkeit dauerhaft an und erhöht die Laktattoleranz.'
      },
      {
        id: 'pace_z5',
        key: 'SB',
        name: 'Z5 – Intervalle & Spitzenbereich (VO2max)',
        sub: '< 95% Schwellenpace',
        rangeStr: `< ${formatPace(z5Max)}`,
        minSec: 0,
        maxSec: z5Max,
        color: '#ef4444',
        desc: 'Hochintensives Intervalltraining (z. B. 400m–1000m Intervalle auf Bahn oder Hügel).',
        benefit: 'Maximiert VO2max, neuromuskuläre Schrittfrequenz und anaerobe Kapazität.'
      }
    ];
  }, [thresholdPace]);

  // Compute time spent in each Pace Zone (pause-aware!)
  const paceDistribution = useMemo(() => {
    const points = track.points || [];
    const zoneSeconds = [0, 0, 0, 0, 0];

    if (canShowPace && points.length > 1) {
      const medianDtSec = estimateMedianSamplingIntervalSec(points);
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const pt = points[i];
        const distKm = calculateDistance(prev, pt);
        let dt = 0;

        if (capabilities.hasTimestamps && pt.time && prev.time) {
          const diff = (new Date(pt.time).getTime() - new Date(prev.time).getTime()) / 1000;
          if (diff <= 0 || diff >= 600 || isRecordingPauseGap(diff, distKm, medianDtSec)) {
            continue;
          }
          dt = diff;
        } else {
          const sp = resolvedSpeedsKmh[i] ?? 10;
          dt = distKm > 0 ? (distKm / Math.max(2, sp)) * 3600 : 1;
        }

        const speedKmh = resolvedSpeedsKmh[i];
        if (!speedKmh || speedKmh < 1.8 || speedKmh > 32) {
          continue; // Exclude standstill & GPS spikes
        }
        const paceSec = 3600 / speedKmh;

        if (paceSec >= paceZones[0].minSec) {
          zoneSeconds[0] += dt;
        } else if (paceSec >= paceZones[1].minSec) {
          zoneSeconds[1] += dt;
        } else if (paceSec >= paceZones[2].minSec) {
          zoneSeconds[2] += dt;
        } else if (paceSec >= paceZones[3].minSec) {
          zoneSeconds[3] += dt;
        } else {
          zoneSeconds[4] += dt;
        }
      }
    }

    const totalCalculated = Math.max(1, zoneSeconds.reduce((a, b) => a + b, 0));
    return paceZones.map((z, idx) => {
      const secs = Math.round(zoneSeconds[idx]);
      const pct = Math.round((secs / totalCalculated) * 100);
      const mins = Math.floor(secs / 60);
      const hours = Math.floor(mins / 60);
      const remainMins = mins % 60;
      const timeStr = hours > 0 ? `${hours}h ${remainMins}m` : `${remainMins} min`;

      return {
        ...z,
        seconds: secs,
        percent: pct,
        timeStr
      };
    });
  }, [canShowPace, capabilities.hasTimestamps, track.points, resolvedSpeedsKmh, paceZones]);

  // Define 5 standard Heart Rate Zones based on Max HR (adapted for Running vs Cycling)
  const hrZones = useMemo(() => {
    // In running, whole-body upright recruitment typically leads to higher HR thresholds
    const z1Max = Math.round(maxHr * 0.60);
    const z2Max = Math.round(maxHr * 0.70);
    const z3Max = Math.round(maxHr * 0.80);
    const z4Max = Math.round(maxHr * 0.90);
    const z5Max = maxHr;

    if (isRunning) {
      return [
        {
          id: 'z1',
          key: 'KB',
          name: 'Z1 – Kompensation & Recom (Erholung)',
          sub: '< 60% HFmax • Erholungslauf',
          min: 0,
          max: z1Max,
          color: '#3b82f6',
          desc: 'Sehr lockeres Traben oder Gehen. Regenerationslauf nach Wettkämpfen.',
          benefit: 'Beschleunigt den Laktatabbau und fördert die Durchblutung bei minimalem Gelenkstress.'
        },
        {
          id: 'z2',
          key: 'GA1',
          name: 'Z2 – Lockerer Dauerlauf (GA1)',
          sub: '60% – 70% HFmax • Aerobe Basis',
          min: z1Max + 1,
          max: z2Max,
          color: '#10b981',
          desc: 'Sprechen flüssig möglich. Das unverzichtbare Ausdauerfundament für jede Laufdistanz.',
          benefit: 'Verbessert die Fettverbrennung, Kapillarisierung und Sehnenstabilität gegen Aufprallkräfte.'
        },
        {
          id: 'z3',
          key: 'GA2',
          name: 'Z3 – Tempodauerlauf / GA2',
          sub: '70% – 80% HFmax • Zügiges Tempo',
          min: z2Max + 1,
          max: z3Max,
          color: '#eab308',
          desc: 'Marathontempo. Atmung tiefer im 2:2-Schrittrhythmus. Fokus auf Laufökonomie.',
          benefit: 'Erhöht das Reisetempo und schult die Glykogenspeicherung bei Renngeschwindigkeit.'
        },
        {
          id: 'z4',
          key: 'EB',
          name: 'Z4 – Schwellenlauf (Laktatschwelle / EB)',
          sub: '80% – 90% HFmax • Schwellenbereich',
          min: z3Max + 1,
          max: z4Max,
          color: '#f97316',
          desc: 'Laufen an der anaeroben Schwelle (Lauf-FTP). Maximales Tempo für 45–60 Minuten.',
          benefit: 'Verschiebt die Schwellenleistung nach oben und steigert die Laktat-Pufferkapazität.'
        },
        {
          id: 'z5',
          key: 'SB',
          name: 'Z5 – Spitzenbereich (Intervalle & VO2max)',
          sub: '90% – 100% HFmax • Maximalbereich',
          min: z4Max + 1,
          max: z5Max,
          color: '#ef4444',
          desc: 'Maximale Belastung bei Bahnintervallen oder Zielsprints. Extrem hohe Laktatflutung.',
          benefit: 'Maximiert das Schlagvolumen des Herzens und die maximale Sauerstoffaufnahme (VO2max).'
        }
      ];
    }

    return [
      {
        id: 'z1',
        key: 'KB',
        name: 'KB – Kompensation & Regeneration',
        sub: '< 60% HFmax',
        min: 0,
        max: z1Max,
        color: '#3b82f6',
        desc: 'Sehr leichte Intensität. Aktive Regeneration, Aufwärmen, Ausrollen.',
        benefit: 'Beschleunigt den Laktatabbau und fördert die Durchblutung ohne Ermüdung.'
      },
      {
        id: 'z2',
        key: 'GA1',
        name: 'GA1 – Grundlagenausdauer 1',
        sub: '60% – 70% HFmax',
        min: z1Max + 1,
        max: z2Max,
        color: '#10b981',
        desc: 'Klassisches Grundlagentraining mit maximaler Fettstoffwechsel-Verbrennung.',
        benefit: 'Steigert Mitochondriendichte, Kapillarisierung und Fettverbrennung.'
      },
      {
        id: 'z3',
        key: 'GA2',
        name: 'GA2 – Grundlagenausdauer 2',
        sub: '70% – 80% HFmax',
        min: z2Max + 1,
        max: z3Max,
        color: '#eab308',
        desc: 'Aerob-anaerober Übergangsbereich. Kontrolliert vertiefte Atmung.',
        benefit: 'Erhöht das Reisetempo und verbessert die Glykogenspeicherung.'
      },
      {
        id: 'z4',
        key: 'EB',
        name: 'EB – Entwicklungsbereich',
        sub: '80% – 90% HFmax',
        min: z3Max + 1,
        max: z4Max,
        color: '#f97316',
        desc: 'Intensives Schwellentraining nahe der anaeroben Schwelle (Lactate Threshold).',
        benefit: 'Verschiebt die Schwellenleistung nach oben und erhöht die Laktattoleranz.'
      },
      {
        id: 'z5',
        key: 'SB',
        name: 'SB – Spitzenbereich',
        sub: '90% – 100% HFmax',
        min: z4Max + 1,
        max: z5Max,
        color: '#ef4444',
        desc: 'Maximale Belastung (HIIT, VO2max-Intervalle, Finalsprints).',
        benefit: 'Maximiert die Sauerstoffaufnahme (VO2max) und anaerobe Kapazität.'
      }
    ];
  }, [maxHr, isRunning]);

  // Define Coggan 7 Power Zones based on FTP according to Dr. Andrew Coggan & Hunter Allen
  const powerZones = useMemo(() => {
    const z1Max = Math.floor(ftp * 0.55); // < 55% (z.B. 250W -> 137W)
    const z2Max = Math.floor(ftp * 0.75); // 56% - 75% (z.B. 250W -> 187W)
    const z3Max = Math.floor(ftp * 0.90); // 76% - 90% (z.B. 250W -> 225W)
    const z4Max = Math.floor(ftp * 1.05); // 91% - 105% (z.B. 250W -> 262W)
    const z5Max = Math.floor(ftp * 1.20); // 106% - 120% (z.B. 250W -> 300W)
    const z6Max = Math.floor(ftp * 1.50); // 121% - 150% (z.B. 250W -> 375W)

    return [
      {
        id: 'pz1',
        name: 'Z1 – Aktive Erholung',
        sub: '< 55% FTP',
        min: 0,
        max: z1Max,
        rangeStr: `< ${z1Max + 1} W`,
        color: '#94a3b8',
        desc: 'Sehr leichtes Kurbeln / Beine ausschütteln.',
        benefit: 'Regeneration nach Intervallen oder Etappen.'
      },
      {
        id: 'pz2',
        name: 'Z2 – Ausdauer (Endurance)',
        sub: '56% – 75% FTP',
        min: z1Max + 1,
        max: z2Max,
        rangeStr: `${z1Max + 1} – ${z2Max} W`,
        color: '#3b82f6',
        desc: 'Gesprächstempo für mehrstündige Berg- und Alpintouren.',
        benefit: 'Erhöhung der aeroben Kapazität und Fettverbrennung.'
      },
      {
        id: 'pz3',
        name: 'Z3 – Tempo',
        sub: '76% – 90% FTP',
        min: z2Max + 1,
        max: z3Max,
        rangeStr: `${z2Max + 1} – ${z3Max} W`,
        color: '#10b981',
        desc: isRunning ? 'Zügiges Laufen (Tempodauerlauf), erhöhte Konzentration, tiefes Atmen.' : 'Zügiges Fahren, erhöhte Konzentration, tiefes Atmen.',
        benefit: 'Ökonomisierung der Muskelkontraktionen bei Renntempo.'
      },
      {
        id: 'pz4',
        name: 'Z4 – Schwellenbereich (FTP)',
        sub: '91% – 105% FTP',
        min: z3Max + 1,
        max: z4Max,
        rangeStr: `${z3Max + 1} – ${z4Max} W`,
        color: '#eab308',
        desc: 'Dauerhaft maximal für ca. 45–60 Minuten haltbar.',
        benefit: 'Direkte Hebung der anaeroben Schwelle (Leistungssteigerung).'
      },
      {
        id: 'pz5',
        name: 'Z5 – VO2max',
        sub: '106% – 120% FTP',
        min: z4Max + 1,
        max: z5Max,
        rangeStr: `${z4Max + 1} – ${z5Max} W`,
        color: '#f97316',
        desc: '3–8 Minuten Intervalle an Steilstücken.',
        benefit: 'Maximale Sauerstoffaufnahme und Herzschlagvolumen.'
      },
      {
        id: 'pz6',
        name: 'Z6 – Anaerobe Kapazität',
        sub: '121% – 150% FTP',
        min: z5Max + 1,
        max: z6Max,
        rangeStr: `${z5Max + 1} – ${z6Max} W`,
        color: '#ef4444',
        desc: '30s bis 2 Minuten Vollgas.',
        benefit: 'Laktattoleranz und anaerobe Glykolyse.'
      },
      {
        id: 'pz7',
        name: 'Z7 – Neuromuskuläre Kraft',
        sub: '> 150% FTP',
        min: z6Max + 1,
        max: Infinity,
        rangeStr: `> ${z6Max} W`,
        color: '#9333ea',
        desc: 'Maximale Sprintantritte (< 15 Sekunden).',
        benefit: 'Schnellkraft und Rekrutierung schneller Muskelfasern.'
      }
    ];
  }, [ftp]);

  // Compute time spent in each HR Zone (strictly from real HR sensor data, pause-aware!)
  const hrDistribution = useMemo(() => {
    const points = track.points || [];
    const zoneSeconds = [0, 0, 0, 0, 0];

    if (canShowHr && points.length > 1) {
      const medianDtSec = estimateMedianSamplingIntervalSec(points);
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const pt = points[i];
        const hr = pt.hr;
        if (!hr || hr <= 35 || hr > 245) continue;

        let dt = 1;
        if (capabilities.hasTimestamps && pt.time && prev.time) {
          const diff = (new Date(pt.time).getTime() - new Date(prev.time).getTime()) / 1000;
          const distKm = calculateDistance(prev, pt);
          if (diff <= 0 || diff >= 600 || isRecordingPauseGap(diff, distKm, medianDtSec)) {
            continue;
          }
          dt = diff;
        }

        if (hr <= hrZones[0].max) zoneSeconds[0] += dt;
        else if (hr <= hrZones[1].max) zoneSeconds[1] += dt;
        else if (hr <= hrZones[2].max) zoneSeconds[2] += dt;
        else if (hr <= hrZones[3].max) zoneSeconds[3] += dt;
        else zoneSeconds[4] += dt;
      }
    }

    const totalCalculated = Math.max(1, zoneSeconds.reduce((a, b) => a + b, 0));
    return hrZones.map((z, idx) => {
      const secs = Math.round(zoneSeconds[idx]);
      const pct = Math.round((secs / totalCalculated) * 100);
      const mins = Math.floor(secs / 60);
      const hours = Math.floor(mins / 60);
      const remainMins = mins % 60;
      const timeStr = hours > 0 ? `${hours}h ${remainMins}m` : `${remainMins} min`;

      return {
        ...z,
        seconds: secs,
        percent: pct,
        timeStr
      };
    });
  }, [canShowHr, capabilities.hasTimestamps, track.points, hrZones]);

  // Compute time spent in each Power Zone (strictly gated, pause-aware!)
  const powerDistribution = useMemo(() => {
    const points = track.points || [];
    const zoneSeconds = [0, 0, 0, 0, 0, 0, 0];

    if (canShowPower && points.length > 1) {
      let processedPoints: GPXPoint[] = [];
      if (hasRealPower) {
        processedPoints = points;
      } else if (!isRunning && capabilities.hasTimestamps) {
        const activeDur = activeTrackStats?.activeDurationSeconds || track.duration || 1800;
        const avgSpeedKmh = track.distance > 0 && activeDur > 0 ? track.distance / (activeDur / 3600) : 22;
        processedPoints = estimateTrackPower(points, initialWeight, avgSpeedKmh, 'cycling');
      }

      if (processedPoints.length > 1) {
        const medianDtSec = estimateMedianSamplingIntervalSec(processedPoints);
        for (let i = 1; i < processedPoints.length; i++) {
          const prev = processedPoints[i - 1];
          const pt = processedPoints[i];
          const pwr = pt.power;
          if (pwr === undefined || isNaN(pwr) || pwr < 0) continue;

          let dt = 1;
          if (capabilities.hasTimestamps && pt.time && prev.time) {
            const diff = (new Date(pt.time).getTime() - new Date(prev.time).getTime()) / 1000;
            const distKm = calculateDistance(prev, pt);
            if (diff <= 0 || diff >= 600 || isRecordingPauseGap(diff, distKm, medianDtSec)) {
              continue;
            }
            dt = diff;
          }

          if (pwr <= powerZones[0].max) zoneSeconds[0] += dt;
          else if (pwr <= powerZones[1].max) zoneSeconds[1] += dt;
          else if (pwr <= powerZones[2].max) zoneSeconds[2] += dt;
          else if (pwr <= powerZones[3].max) zoneSeconds[3] += dt;
          else if (pwr <= powerZones[4].max) zoneSeconds[4] += dt;
          else if (pwr <= powerZones[5].max) zoneSeconds[5] += dt;
          else zoneSeconds[6] += dt;
        }
      }
    }

    const totalCalc = Math.max(1, zoneSeconds.reduce((a, b) => a + b, 0));
    return powerZones.map((z, idx) => {
      const secs = Math.round(zoneSeconds[idx]);
      const pct = Math.round((secs / totalCalc) * 100);
      const mins = Math.floor(secs / 60);
      const hours = Math.floor(mins / 60);
      const remainMins = mins % 60;
      const timeStr = hours > 0 ? `${hours}h ${remainMins}m` : `${remainMins} min`;

      return {
        ...z,
        seconds: secs,
        percent: pct,
        timeStr
      };
    });
  }, [canShowPower, isRunning, capabilities.hasTimestamps, track, hasRealPower, powerZones, initialWeight]);

  if (!capabilities.hasZonesTabData) {
    return (
      <div className="p-8 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-center space-y-2">
        <Info className="w-8 h-8 text-slate-400 mx-auto" />
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
          Keine Zonen-Telemetrie vorhanden
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
          {isRunning
            ? 'Für Pace- oder Puls-Zonen werden aufgezeichnete Zeitstempel, Geschwindigkeits- oder Herzfrequenzdaten benötigt.'
            : 'Für Watt- oder Puls-Zonen werden aufgezeichnete Zeitstempel, Powermeter- oder Herzfrequenzdaten benötigt.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sport Activity Badge */}
      <div className={`px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center justify-between shadow-xs ${
        isRunning 
          ? 'bg-amber-500/10 text-amber-900 dark:text-amber-200 border border-amber-300/40 dark:border-amber-700/40'
          : 'bg-indigo-500/10 text-indigo-900 dark:text-indigo-200 border border-indigo-300/40 dark:border-indigo-700/40'
      }`}>
        <div className="flex items-center gap-2.5">
          <span className="text-lg select-none">{isRunning ? '🏃' : '🚴'}</span>
          <div>
            <div className="font-bold flex items-center gap-1.5">
              <span>{isRunning ? 'Lauf-Modus aktiv' : 'Radsport-Modus aktiv'}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono uppercase bg-white/70 dark:bg-slate-800/80 font-black">
                {effectiveActivityType}
              </span>
            </div>
            <p className="text-[11px] opacity-80 font-normal">
              {isRunning
                ? 'Auswertung automatisch auf Schwellenpace (min/km), Schrittkadenz und laufspezifische Herzfrequenzbereiche eingestellt.'
                : 'Auswertung automatisch auf Coggan 7-Zonen Watt-Verteilung (FTP) und radspezifische Herzfrequenzbereiche eingestellt.'}
            </p>
          </div>
        </div>
      </div>

      {/* Sub-Header / Toggle & Parameters */}
      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700/80 pb-3">
          <div className="flex items-center gap-2">
            {zoneView === 'pace' ? (
              <Gauge className="w-5 h-5 text-emerald-500" />
            ) : zoneView === 'hr' ? (
              <Heart className="w-5 h-5 text-rose-500 fill-rose-500" />
            ) : (
              <Zap className="w-5 h-5 text-amber-500" />
            )}
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {zoneView === 'pace' 
                  ? 'Lauf-Pacezonen (min/km)' 
                  : zoneView === 'hr' 
                  ? (isRunning ? 'Pulsbereiche Laufen (HF)' : 'Pulsbereiche Radsport (HF)') 
                  : (isRunning ? 'Laufleistung (Watt / Stryd)' : 'Coggan 7-Zonen Watt-Verteilung')}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {zoneView === 'pace'
                  ? 'Geschwindigkeitsverteilung gegliedert nach deiner Schwellenpace (min/km)'
                  : zoneView === 'hr'
                  ? (hasRealHr ? 'Exakte Auswertung aus aufgezeichneten Herzfrequenz-Sensordaten' : 'Modellierte physiologische Zonenverteilung für deine Route')
                  : (hasRealPower ? 'Exakte Auswertung aus aufgezeichneten Powermeter-Sensordaten' : 'Physikalisch modellierte Watt-Verteilung (Steigung, Speed, Masse & FTP)')}
              </p>
            </div>
          </div>

          {/* Tab Switcher — strictly gated by available real telemetry */}
          <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            {canShowPace && (
              <button
                type="button"
                onClick={() => { setZoneView('pace'); triggerHaptic('light'); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  zoneView === 'pace'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Gauge className="w-3.5 h-3.5" />
                Pace-Zonen (min/km)
              </button>
            )}

            {canShowHr && (
              <button
                type="button"
                onClick={() => { setZoneView('hr'); triggerHaptic('light'); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  zoneView === 'hr'
                    ? 'bg-rose-500 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Heart className="w-3.5 h-3.5" />
                Puls-Zonen (5 Zonen)
              </button>
            )}

            {canShowPower && (
              <button
                type="button"
                onClick={() => { setZoneView('power'); triggerHaptic('light'); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  zoneView === 'power'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                {isRunning ? 'Laufleistung (Watt)' : 'Watt-Zonen (Coggan 7)'}
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Adjusters based on available dimensions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {canShowHr && (
            <div className="space-y-1.5 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Heart className="w-3.5 h-3.5 text-rose-500" />
                  Maximale Herzfrequenz (HFmax):
                </span>
                <span className="font-mono text-rose-600 dark:text-rose-400 font-black tabular-nums">{maxHr} bpm</span>
              </div>
              <input
                type="range"
                min={140}
                max={220}
                step={1}
                value={maxHr}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setMaxHr(v);
                  onMaxHrChange?.(v);
                }}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-500"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>140 bpm</span>
                <span>{isRunning ? 'Laufen: ca. +5 bis 8 bpm vs. Rad' : 'Faustformel: 220 - Alter'}</span>
                <span>220 bpm</span>
              </div>
            </div>
          )}

          {canShowPace ? (
            <div className="space-y-1.5 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-emerald-500" />
                  Schwellenpace (Lauf-Schwelle / TDL):
                </span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-black tabular-nums">
                  {formatPace(thresholdPace)}
                </span>
              </div>
              <input
                type="range"
                min={180}
                max={480}
                step={5}
                value={thresholdPace}
                onChange={(e) => setThresholdPace(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>3:00 min/km</span>
                <span>Tempo an der anaeroben Schwelle</span>
                <span>8:00 min/km</span>
              </div>
            </div>
          ) : canShowPower ? (
            <div className="space-y-1.5 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  Schwellenleistung (FTP):
                </span>
                <span className="font-mono text-amber-600 dark:text-amber-400 font-black tabular-nums">{ftp} Watt</span>
              </div>
              <input
                type="range"
                min={100}
                max={500}
                step={5}
                value={ftp}
                onChange={(e) => setFtp(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>100 Watt</span>
                <span>1-Stunden Maximalleistung</span>
                <span>500 Watt</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Main Zones Visualizer */}
      {zoneView === 'pace' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              5-Zonen Pace-Verteilung (Schwelle: {formatPace(thresholdPace)})
            </h4>
            <span className="text-xs text-slate-400 font-medium">
              Grundlagenanteil (Z1+Z2): <strong className="text-emerald-600 dark:text-emerald-400 font-mono">
                {(paceDistribution[0].percent + paceDistribution[1].percent)}%
              </strong>
            </span>
          </div>

          <div className="space-y-2.5">
            {paceDistribution.map((zone) => (
              <div 
                key={zone.id}
                className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span 
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: zone.color }}
                    />
                    <div>
                      <span className="font-bold text-xs text-slate-800 dark:text-slate-100 block">
                        {zone.name}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {zone.sub} • {zone.rangeStr}
                      </span>
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    <span className="text-sm font-black text-slate-800 dark:text-slate-100">
                      {zone.timeStr}
                    </span>
                    <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                      {zone.percent}%
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(2, zone.percent)}%`, backgroundColor: zone.color }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                  <span>{zone.desc}</span>
                  <span className="italic text-[10px] text-slate-400 shrink-0 ml-2">{zone.benefit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : zoneView === 'hr' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              5-Zonen Herzfrequenz-Verteilung {isRunning ? '(Lauf-Physiologie)' : '(Radsport-Physiologie)'} • HFmax: {maxHr} bpm
            </h4>
            <span className="text-xs text-slate-400 font-medium">
              Aerobe Basis (GA1+GA2): <strong className="text-emerald-600 dark:text-emerald-400 font-mono">
                {(hrDistribution[1].percent + hrDistribution[2].percent)}%
              </strong>
            </span>
          </div>

          {/* Visual Time-in-Zone Chart Card */}
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 dark:text-slate-200">
                Zeit in Pulsbereichen (Minuten &amp; %-Anteil)
              </span>
              <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Schwelle/VO2max (Z4+Z5): {hrDistribution[3].percent + hrDistribution[4].percent}%
              </span>
            </div>

            <div className="h-3 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex p-0.5 gap-0.5">
              {hrDistribution.map((z) =>
                z.percent > 0 ? (
                  <div
                    key={`hr-stack-${z.id}`}
                    style={{ width: `${Math.max(2, z.percent)}%`, backgroundColor: z.color }}
                    className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-300"
                    title={`${z.name}: ${z.timeStr} (${z.percent}%)`}
                  />
                ) : null
              )}
            </div>

            <div className="h-48 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={hrDistribution.map((z) => ({
                    ...z,
                    minutes: Number((z.seconds / 60).toFixed(1)),
                    shortName: `${z.id.toUpperCase()} (${z.key})`
                  }))}
                  margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" opacity={0.2} />
                  <XAxis dataKey="shortName" tick={{ fontSize: 11, fontWeight: 700 }} />
                  <YAxis unit="m" tick={{ fontSize: 10 }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const z = payload[0].payload;
                      return (
                        <div className="p-2.5 rounded-xl bg-slate-900/95 text-white shadow-xl border border-slate-700 text-xs space-y-1 font-mono tabular-nums">
                          <div className="font-sans font-bold text-white flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: z.color }} />
                            {z.name}
                          </div>
                          <div className="text-slate-300">
                            Zeit: <strong className="text-white">{z.timeStr}</strong> ({z.percent}%)
                          </div>
                          <div className="text-rose-300 text-[11px]">
                            Bereich: {z.min}–{z.max} bpm ({z.sub})
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="minutes" radius={[6, 6, 0, 0]} maxBarSize={48} isAnimationActive={false}>
                    {hrDistribution.map((entry) => (
                      <Cell key={`hr-bar-${entry.id}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="space-y-2.5">
            {hrDistribution.map((zone) => (
              <div 
                key={zone.id}
                className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span 
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: zone.color }}
                    />
                    <div>
                      <span className="font-bold text-xs text-slate-800 dark:text-slate-100 block">
                        {zone.name}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {zone.sub} • {zone.min} bis {zone.max} bpm
                      </span>
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    <span className="text-sm font-black text-slate-800 dark:text-slate-100">
                      {zone.timeStr}
                    </span>
                    <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                      {zone.percent}%
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(2, zone.percent)}%`, backgroundColor: zone.color }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                  <span>{zone.desc}</span>
                  <span className="italic text-[10px] text-slate-400 shrink-0 ml-2">{zone.benefit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {isRunning ? `Laufleistung (Watt / Stryd - Modell: ${ftp}W CP)` : `Coggan 7-Zonen Watt-Verteilung (FTP: ${ftp}W)`}
            </h4>
            <span className="text-xs text-slate-400 font-medium">
              Ausdaueranteil (Z1–Z3): <strong className="text-indigo-600 dark:text-indigo-400 font-mono">
                {(powerDistribution[0].percent + powerDistribution[1].percent + powerDistribution[2].percent)}%
              </strong>
            </span>
          </div>

          <div className="space-y-2.5">
            {powerDistribution.map((zone) => (
              <div 
                key={zone.id}
                className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span 
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: zone.color }}
                    />
                    <div>
                      <span className="font-bold text-xs text-slate-800 dark:text-slate-100 block">
                        {zone.name}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {zone.sub} • {zone.rangeStr}
                      </span>
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    <span className="text-sm font-black text-slate-800 dark:text-slate-100">
                      {zone.timeStr}
                    </span>
                    <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                      {zone.percent}%
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(2, zone.percent)}%`, backgroundColor: zone.color }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                  <span>{zone.desc}</span>
                  <span className="italic text-[10px] text-slate-400 shrink-0 ml-2">{zone.benefit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
