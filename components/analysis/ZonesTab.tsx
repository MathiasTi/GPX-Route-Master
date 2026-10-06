import React, { useState, useMemo, useEffect } from 'react';
import { Heart, Zap, Sliders, Activity, Clock, ShieldCheck, Award, Info, Gauge } from 'lucide-react';
import { GPXTrack, GPXPoint } from '../../types';
import { triggerHaptic } from '../../utils/haptics';
import { estimateTrackPower } from '../../utils/gpxUtils';

interface ZonesTabProps {
  track: GPXTrack;
  activityType?: 'cycling' | 'running';
  initialMaxHr?: number;
  initialFtp?: number;
  initialWeight?: number;
  onOpenGlossary?: (metricId?: string) => void;
}

export const ZonesTab: React.FC<ZonesTabProps> = ({
  track,
  activityType,
  initialMaxHr = 185,
  initialFtp = 220,
  initialWeight = 75,
  onOpenGlossary
}) => {
  const effectiveActivityType = activityType || track.activityType || 'cycling';
  const isRunning = effectiveActivityType === 'running';

  const [maxHr, setMaxHr] = useState<number>(initialMaxHr);
  const [ftp, setFtp] = useState<number>(initialFtp);

  // Compute detected average running pace from track
  const detectedAvgPaceSec = useMemo(() => {
    if (track.distance > 0 && track.duration && track.duration > 0) {
      const p = track.duration / track.distance;
      if (p >= 150 && p <= 900) return p;
    }
    const pts = track.points || [];
    const speeds = pts.map(p => p.speed).filter(s => s !== undefined && s > 2 && s < 25) as number[];
    if (speeds.length > 0) {
      const avgSpd = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      const paceFromSpd = 3600 / avgSpd;
      if (paceFromSpd >= 150 && paceFromSpd <= 900) return paceFromSpd;
    }
    return 330; // 5:30 min/km default
  }, [track]);

  // Running threshold pace (in seconds per km, e.g. 270 = 4:30 min/km)
  const [thresholdPace, setThresholdPace] = useState<number>(() => {
    return Math.round(detectedAvgPaceSec * 0.94);
  });

  // Re-sync threshold pace when track or activityType changes
  useEffect(() => {
    if (isRunning) {
      setThresholdPace(Math.round(detectedAvgPaceSec * 0.94));
    }
  }, [track.id, isRunning, detectedAvgPaceSec]);

  // Default view mode: 'pace' for running, 'power' for cycling
  const [zoneView, setZoneView] = useState<'pace' | 'hr' | 'power'>(
    isRunning ? 'pace' : 'power'
  );

  // Auto-switch view when activityType changes
  useEffect(() => {
    if (isRunning && zoneView === 'power' && !track.points?.some(p => p.power !== undefined && p.power > 0)) {
      setZoneView('pace');
    } else if (!isRunning && zoneView === 'pace') {
      setZoneView('power');
    }
  }, [isRunning]);

  // Check if track has real HR or Power data
  const hasRealHr = useMemo(() => {
    return (track.points || []).some(p => p.hr !== undefined && p.hr > 0);
  }, [track.points]);

  const hasRealPower = useMemo(() => {
    return (track.points || []).some(p => p.power !== undefined && p.power > 0);
  }, [track.points]);

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

  // Compute time spent in each Pace Zone
  const paceDistribution = useMemo(() => {
    const points = track.points || [];
    const totalDurationSec = track.duration || Math.max(1800, (track.distance / 10) * 3600);
    const zoneSeconds = [0, 0, 0, 0, 0];

    if (points.length > 1) {
      let validPaceSecs = 0;
      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        let dt = 1;
        if (i > 0 && pt.time && points[i - 1].time) {
          const diff = (new Date(pt.time).getTime() - new Date(points[i - 1].time!).getTime()) / 1000;
          if (diff > 0 && diff <= 30) dt = diff;
        }

        let paceSec = 0;
        if (pt.speed && pt.speed > 1.5 && pt.speed < 30) {
          paceSec = 3600 / pt.speed;
        } else if (i > 0) {
          // calculate from lat/lng
          const pPrev = points[i - 1];
          const R = 6371000;
          const dLat = (pt.lat - pPrev.lat) * Math.PI / 180;
          const dLng = (pt.lng - pPrev.lng) * Math.PI / 180;
          const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(pPrev.lat * Math.PI / 180) * Math.cos(pt.lat * Math.PI / 180) *
                    Math.sin(dLng / 2) * Math.sin(dLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distM = R * c;
          if (distM > 1 && dt > 0) {
            const spdKmh = (distM / dt) * 3.6;
            if (spdKmh > 1.5 && spdKmh < 30) {
              paceSec = 3600 / spdKmh;
            }
          }
        }

        if (paceSec > 0) {
          validPaceSecs += dt;
          // Assign to zone: lower sec/km = faster speed
          if (paceSec >= paceZones[0].minSec) {
            zoneSeconds[0] += dt; // Z1 KB
          } else if (paceSec >= paceZones[1].minSec) {
            zoneSeconds[1] += dt; // Z2 GA1
          } else if (paceSec >= paceZones[2].minSec) {
            zoneSeconds[2] += dt; // Z3 GA2
          } else if (paceSec >= paceZones[3].minSec) {
            zoneSeconds[3] += dt; // Z4 EB
          } else {
            zoneSeconds[4] += dt; // Z5 SB
          }
        }
      }

      if (validPaceSecs > 0) {
        const factor = totalDurationSec / validPaceSecs;
        for (let j = 0; j < 5; j++) {
          zoneSeconds[j] = Math.round(zoneSeconds[j] * factor);
        }
      }
    } else {
      // Fallback model for running based on elevation/distance
      const ascent = track.ascent || 100;
      const climbIntensity = Math.min(1.0, ascent / 400);
      zoneSeconds[0] = Math.round(totalDurationSec * 0.15);
      zoneSeconds[1] = Math.round(totalDurationSec * (0.50 - climbIntensity * 0.10));
      zoneSeconds[2] = Math.round(totalDurationSec * (0.22 + climbIntensity * 0.05));
      zoneSeconds[3] = Math.round(totalDurationSec * (0.10 + climbIntensity * 0.04));
      zoneSeconds[4] = Math.max(0, totalDurationSec - zoneSeconds.slice(0, 4).reduce((a, b) => a + b, 0));
    }

    const totalCalculated = Math.max(1, zoneSeconds.reduce((a, b) => a + b, 0));
    return paceZones.map((z, idx) => {
      const secs = zoneSeconds[idx];
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
  }, [track, paceZones]);

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

  // Compute time spent in each HR Zone
  const hrDistribution = useMemo(() => {
    const points = track.points || [];
    const totalDurationSec = track.duration || Math.max(1800, (track.distance / 22) * 3600);
    const zoneSeconds = [0, 0, 0, 0, 0];

    if (hasRealHr) {
      let validCount = 0;
      for (let i = 0; i < points.length; i++) {
        const hr = points[i].hr;
        if (hr && hr > 30) {
          validCount++;
          if (hr <= hrZones[0].max) zoneSeconds[0]++;
          else if (hr <= hrZones[1].max) zoneSeconds[1]++;
          else if (hr <= hrZones[2].max) zoneSeconds[2]++;
          else if (hr <= hrZones[3].max) zoneSeconds[3]++;
          else zoneSeconds[4]++;
        }
      }
      if (validCount > 0) {
        // Normalize to total duration
        const factor = totalDurationSec / validCount;
        for (let j = 0; j < 5; j++) {
          zoneSeconds[j] = Math.round(zoneSeconds[j] * factor);
        }
      }
    } else {
      // Realistic simulation based on elevation gain & distance
      const ascent = track.ascent || 500;
      const climbIntensity = Math.min(1.0, ascent / 1500);
      zoneSeconds[0] = Math.round(totalDurationSec * (0.20 - climbIntensity * 0.08)); // KB
      zoneSeconds[1] = Math.round(totalDurationSec * (0.45 - climbIntensity * 0.10)); // GA1
      zoneSeconds[2] = Math.round(totalDurationSec * (0.22 + climbIntensity * 0.06)); // GA2
      zoneSeconds[3] = Math.round(totalDurationSec * (0.10 + climbIntensity * 0.08)); // EB
      zoneSeconds[4] = Math.max(0, totalDurationSec - (zoneSeconds[0] + zoneSeconds[1] + zoneSeconds[2] + zoneSeconds[3])); // SB
    }

    const totalCalculated = Math.max(1, zoneSeconds.reduce((a, b) => a + b, 0));
    return hrZones.map((z, idx) => {
      const secs = zoneSeconds[idx];
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
  }, [track, hasRealHr, hrZones]);

  // Compute time spent in each Power Zone
  const powerDistribution = useMemo(() => {
    const totalDurationSec = track.duration || Math.max(1800, (track.distance / 22) * 3600);
    const points = track.points || [];
    const zoneSeconds = [0, 0, 0, 0, 0, 0, 0];

    // Determine points to analyze
    let processedPoints: GPXPoint[] = [];
    if (hasRealPower) {
      processedPoints = points;
    } else if (points.length > 0) {
      // Calculate realistic physical power profile based on terrain, gradients, weight, and speed
      const avgSpeedKmh = track.distance > 0 && totalDurationSec > 0
        ? (track.distance / (totalDurationSec / 3600))
        : 20;
      processedPoints = estimateTrackPower(points, initialWeight, avgSpeedKmh, track.activityType);
    }

    if (processedPoints.length > 0) {
      let totalValidSecs = 0;
      for (let i = 0; i < processedPoints.length; i++) {
        const pt = processedPoints[i];
        const pwr = pt.power;
        if (pwr !== undefined && !isNaN(pwr) && pwr >= 0) {
          let dt = 1;
          if (i > 0 && pt.time && processedPoints[i - 1].time) {
            const tPrev = new Date(processedPoints[i - 1].time!).getTime();
            const tCurr = new Date(pt.time).getTime();
            const diff = (tCurr - tPrev) / 1000;
            if (diff > 0 && diff <= 60) {
              dt = diff;
            }
          }
          totalValidSecs += dt;

          if (pwr <= powerZones[0].max) zoneSeconds[0] += dt;
          else if (pwr <= powerZones[1].max) zoneSeconds[1] += dt;
          else if (pwr <= powerZones[2].max) zoneSeconds[2] += dt;
          else if (pwr <= powerZones[3].max) zoneSeconds[3] += dt;
          else if (pwr <= powerZones[4].max) zoneSeconds[4] += dt;
          else if (pwr <= powerZones[5].max) zoneSeconds[5] += dt;
          else zoneSeconds[6] += dt;
        }
      }

      if (totalValidSecs > 0) {
        const factor = totalDurationSec / totalValidSecs;
        for (let j = 0; j < 7; j++) {
          zoneSeconds[j] = Math.round(zoneSeconds[j] * factor);
        }
      }
    } else {
      // Fallback only if no GPS points exist: dynamically scale based on FTP and elevation profile
      const ascent = track.ascent || 0;
      const climbFactor = Math.min(1.5, Math.max(0.6, ascent / 800));
      const ftpRatio = 250 / Math.max(120, ftp);
      
      zoneSeconds[0] = Math.round(totalDurationSec * Math.max(0.06, 0.18 / ftpRatio));
      zoneSeconds[1] = Math.round(totalDurationSec * Math.max(0.18, 0.46 / (climbFactor * 0.9)));
      zoneSeconds[2] = Math.round(totalDurationSec * 0.20 * ftpRatio);
      zoneSeconds[3] = Math.round(totalDurationSec * 0.10 * climbFactor * ftpRatio);
      zoneSeconds[4] = Math.round(totalDurationSec * 0.04 * climbFactor * ftpRatio);
      zoneSeconds[5] = Math.round(totalDurationSec * 0.015 * climbFactor * ftpRatio);
      zoneSeconds[6] = Math.max(0, totalDurationSec - zoneSeconds.slice(0, 6).reduce((a, b) => a + b, 0));
    }

    const totalCalc = Math.max(1, zoneSeconds.reduce((a, b) => a + b, 0));
    return powerZones.map((z, idx) => {
      const secs = zoneSeconds[idx];
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
  }, [track, hasRealPower, powerZones, initialWeight, ftp]);

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
              <Gauge className="w-5 h-5 text-emerald-500 animate-pulse" />
            ) : zoneView === 'hr' ? (
              <Heart className="w-5 h-5 text-rose-500 fill-rose-500 animate-pulse" />
            ) : (
              <Zap className="w-5 h-5 text-amber-500 animate-pulse" />
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

          {/* Tab Switcher */}
          <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            {isRunning && (
              <button
                type="button"
                onClick={() => { setZoneView('pace'); triggerHaptic('light'); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  zoneView === 'pace'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Gauge className="w-3.5 h-3.5" />
                Pace-Zonen (min/km)
              </button>
            )}

            <button
              type="button"
              onClick={() => { setZoneView('hr'); triggerHaptic('light'); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                zoneView === 'hr'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Heart className="w-3.5 h-3.5" />
              Puls-Zonen (5 Zonen)
            </button>

            <button
              type="button"
              onClick={() => { setZoneView('power'); triggerHaptic('light'); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                zoneView === 'power'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              {isRunning ? 'Laufleistung (Watt)' : 'Watt-Zonen (Coggan 7)'}
            </button>
          </div>
        </div>

        {/* Dynamic Adjusters based on Sport (Running vs Cycling) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {/* Max HR Slider */}
          <div className="space-y-1.5 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <Heart className="w-3.5 h-3.5 text-rose-500" />
                Maximale Herzfrequenz (HFmax):
              </span>
              <span className="font-mono text-rose-600 dark:text-rose-400 font-black">{maxHr} bpm</span>
            </div>
            <input
              type="range"
              min={140}
              max={220}
              step={1}
              value={maxHr}
              onChange={(e) => setMaxHr(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-500"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>140 bpm</span>
              <span>{isRunning ? 'Laufen: ca. +5 bis 8 bpm vs. Rad' : 'Faustformel: 220 - Alter'}</span>
              <span>220 bpm</span>
            </div>
          </div>

          {/* Sport-Specific Secondary Parameter: Threshold Pace (Running) vs FTP (Cycling) */}
          {isRunning ? (
            <div className="space-y-1.5 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-emerald-500" />
                  Schwellenpace (Lauf-Schwelle / TDL):
                </span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-black">
                  {formatPace(thresholdPace)}
                </span>
              </div>
              <input
                type="range"
                min={180}
                max={480}
                step={5}
                value={thresholdPace}
                onChange={(e) => setThresholdPace(parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>3:00 min/km</span>
                <span>Tempo an der anaeroben Schwelle</span>
                <span>8:00 min/km</span>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  Schwellenleistung (FTP):
                </span>
                <span className="font-mono text-amber-600 dark:text-amber-400 font-black">{ftp} Watt</span>
              </div>
              <input
                type="range"
                min={100}
                max={500}
                step={5}
                value={ftp}
                onChange={(e) => setFtp(parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>100 Watt</span>
                <span>1-Stunden Maximalleistung</span>
                <span>500 Watt</span>
              </div>
            </div>
          )}
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
              5-Zonen Herzfrequenz-Verteilung {isRunning ? '(Lauf-Physiologie)' : '(Radsport-Physiologie)'}
            </h4>
            <span className="text-xs text-slate-400 font-medium">
              Aerobe Basis (GA1+GA2): <strong className="text-emerald-600 dark:text-emerald-400 font-mono">
                {(hrDistribution[1].percent + hrDistribution[2].percent)}%
              </strong>
            </span>
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
