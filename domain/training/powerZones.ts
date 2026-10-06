import { Result, ok, err } from '../core/result';

export type ActivityType = 'cycling' | 'running';

export class PowerZoneCalculationError extends Error {
  constructor(message: string, public readonly code: 'INVALID_FTP' | 'INVALID_PACE' | 'INVALID_POINTS') {
    super(message);
    this.name = 'PowerZoneCalculationError';
  }
}

export interface PowerZoneDefinition {
  key: string;
  level: number;
  name: string;
  code: string;
  fullName: string;
  minPercent: number;
  maxPercent: number;
  minWatts: number;
  maxWatts: number;
  color: string;
  desc: string;
  benefit: string;
  energySystem: string;
  rpeScale: string;
  recommendedDuration: string;
}

export interface PaceZoneDefinition {
  key: string;
  level: number;
  name: string;
  code: string;
  fullName: string;
  minPercent: number;
  maxPercent: number;
  minPaceSecPerKm: number; // in seconds/km (smaller = faster)
  maxPaceSecPerKm: number; // in seconds/km (larger = slower)
  paceRangeFormatted: string;
  color: string;
  desc: string;
  benefit: string;
  energySystem: string;
  rpeScale: string;
  recommendedDuration: string;
}

export interface ActivityZoneDistributionItem {
  key: string;
  level: number;
  name: string;
  color: string;
  durationSec: number;
  percent: number;
  rangeFormatted: string;
  targetMetric: 'watts' | 'pace';
}

export interface PowerZonesAnalysisResult {
  activityType: ActivityType;
  thresholdWatts: number;
  thresholdPaceSecPerKm?: number;
  avgWatts: number;
  maxWatts: number;
  normalizedWatts: number;
  intensityFactor: number;
  trainingStressScore: number;
  variabilityIndex: number;
  zonesDistribution: ActivityZoneDistributionItem[];
  aerobicPercent: number;
  anaerobicPercent: number;
  modelName: string;
  modelDescription: string;
}

/**
 * Andy Coggan 7-Zone Power Model for Cycling based on FTP (Functional Threshold Power)
 */
export function calculateCyclingPowerZones(ftpWatts: number): Result<PowerZoneDefinition[], PowerZoneCalculationError> {
  if (!ftpWatts || ftpWatts <= 0 || !isFinite(ftpWatts)) {
    return err(new PowerZoneCalculationError('FTP must be a positive integer in Watts', 'INVALID_FTP'));
  }

  const zones: PowerZoneDefinition[] = [
    {
      key: 'Z1',
      level: 1,
      name: 'Aktive Erholung',
      code: 'L1 Active Recovery',
      fullName: 'Z1: Aktive Erholung / Regeneration',
      minPercent: 0,
      maxPercent: 55,
      minWatts: 0,
      maxWatts: Math.round(ftpWatts * 0.55),
      color: '#3b82f6', // Blue
      desc: 'Lockeres Rollen, geringste Belastung für das Herz-Kreislauf-System.',
      benefit: 'Fördert den Laktatabbau und die kapillare Regeneration ohne Ermüdung.',
      energySystem: 'Reine Lipolyse (Fettstoffwechsel) > 95%',
      rpeScale: '1-2 / 10 (extrem leicht)',
      recommendedDuration: '30 - 90 Min.'
    },
    {
      key: 'Z2',
      level: 2,
      name: 'Grundlagenausdauer',
      code: 'L2 Endurance',
      fullName: 'Z2: Grundlagenausdauer 1 (GA1)',
      minPercent: 56,
      maxPercent: 75,
      minWatts: Math.round(ftpWatts * 0.55) + 1,
      maxWatts: Math.round(ftpWatts * 0.75),
      color: '#10b981', // Emerald
      desc: 'Das aerobe Fundament für lange Distanzen und Marathons.',
      benefit: 'Vermehrung der Mitochondrien, Kapillarisierung und Ökonomisierung des Fettstoffwechsels.',
      energySystem: 'Lipolyse 75-85%, Glykolyse 15-25%',
      rpeScale: '3-4 / 10 (gemächlich, Konversation flüssig)',
      recommendedDuration: '2 - 6 Stunden'
    },
    {
      key: 'Z3',
      level: 3,
      name: 'Tempobereich',
      code: 'L3 Tempo',
      fullName: 'Z3: Grundlagenausdauer 2 (GA2 / Tempo)',
      minPercent: 76,
      maxPercent: 90,
      minWatts: Math.round(ftpWatts * 0.75) + 1,
      maxWatts: Math.round(ftpWatts * 0.90),
      color: '#eab308', // Amber
      desc: 'Zügiges Reisetempo mit kontinuierlicher Konzentration.',
      benefit: 'Erhöhung der Glykogenspeicherkapazität und aeroben Kraftausdauer.',
      energySystem: 'Ausgeglichen: ~50% Fett, ~50% Glykogen',
      rpeScale: '5-6 / 10 (konzentriert, kurze Sätze)',
      recommendedDuration: '1 - 3 Stunden'
    },
    {
      key: 'Z4',
      level: 4,
      name: 'Schwellenbereich',
      code: 'L4 Threshold',
      fullName: 'Z4: Laktatschwelle / FTP-Bereich',
      minPercent: 91,
      maxPercent: 105,
      minWatts: Math.round(ftpWatts * 0.90) + 1,
      maxWatts: Math.round(ftpWatts * 1.05),
      color: '#f97316', // Orange
      desc: 'Maximales Gleichgewicht aus Laktatbildung und -abbau (Lactate Steady State).',
      benefit: 'Hebt die anaerobe Schwelle (FTP) an und steigert die Pufferkapazität.',
      energySystem: 'Überwiegend Glykolyse (> 85%)',
      rpeScale: '7-8 / 10 (hart, rhythmische tiefe Atmung)',
      recommendedDuration: '20 - 60 Min.'
    },
    {
      key: 'Z5',
      level: 5,
      name: 'VO2max',
      code: 'L5 VO2 Max',
      fullName: 'Z5: Maximale Sauerstoffaufnahme',
      minPercent: 106,
      maxPercent: 120,
      minWatts: Math.round(ftpWatts * 1.05) + 1,
      maxWatts: Math.round(ftpWatts * 1.20),
      color: '#ef4444', // Red
      desc: 'Hochintensive Intervalle (HIIT) zur aeroben Leistungsgrenze.',
      benefit: 'Maximiert Herzminutenvolumen, Schlagvolumen und aerobe Spitzenleistung.',
      energySystem: 'Reine anaerobe Glykolyse / Phosphate',
      rpeScale: '9 / 10 (sehr hart, nur Minuten durchhaltbar)',
      recommendedDuration: '3 - 8 Min. pro Intervall'
    },
    {
      key: 'Z6',
      level: 6,
      name: 'Anaerobe Kapazität',
      code: 'L6 Anaerobic',
      fullName: 'Z6: Anaerobe Kapazität (Laktattoleranz)',
      minPercent: 121,
      maxPercent: 150,
      minWatts: Math.round(ftpWatts * 1.20) + 1,
      maxWatts: Math.round(ftpWatts * 1.50),
      color: '#a855f7', // Purple
      desc: 'Kurze, explosive Bergauf-Antritte und Rennausreißversuche.',
      benefit: 'Maximiert die Laktattoleranz und anaerobe Energiereserven.',
      energySystem: 'Alaktazide & Laktazide Energiebereitstellung',
      rpeScale: '10 / 10 (extrem intensiv)',
      recommendedDuration: '30 - 120 Sekunden'
    },
    {
      key: 'Z7',
      level: 7,
      name: 'Neuromuskulär',
      code: 'L7 Neuromuscular',
      fullName: 'Z7: Neuromuskuläre Maximalleistung (Sprint)',
      minPercent: 151,
      maxPercent: 300,
      minWatts: Math.round(ftpWatts * 1.50) + 1,
      maxWatts: Math.round(ftpWatts * 3.0),
      color: '#ec4899', // Pink
      desc: 'All-Out Sprints zur Ziellinie oder Beschleunigungen aus dem Stand.',
      benefit: 'Rekrutierung schnellzuckender Muskelfasern (Typ IIx) und Maximalkraft.',
      energySystem: 'Kreatinphosphat-System (ATP-PCr)',
      rpeScale: 'Maximaler Krafteinsatz',
      recommendedDuration: '5 - 15 Sekunden'
    }
  ];

  return ok(zones);
}

/**
 * Jim Vance / Stryd Running Power 5-Zone Model based on rFTPw (Running FTP / Critical Power in Watts)
 * Unlike cycling where you can coast with 0W, running requires supporting body mass against gravity,
 * so Zone 1 starts around 70-80% of rFTPw.
 */
export function calculateRunningPowerZones(rFtpWatts: number): Result<PowerZoneDefinition[], PowerZoneCalculationError> {
  if (!rFtpWatts || rFtpWatts <= 0 || !isFinite(rFtpWatts)) {
    return err(new PowerZoneCalculationError('Running FTP must be a positive integer in Watts', 'INVALID_FTP'));
  }

  const zones: PowerZoneDefinition[] = [
    {
      key: 'Z1',
      level: 1,
      name: 'Regeneration',
      code: 'Zone 1 Easy / Recovery',
      fullName: 'Z1: Aktive Laufregeneration / Recom',
      minPercent: 0,
      maxPercent: 80,
      minWatts: 0,
      maxWatts: Math.round(rFtpWatts * 0.80),
      color: '#3b82f6',
      desc: 'Sehr lockeres Traben oder Bergablauf-Erholung. Minimaler Aufprallstress.',
      benefit: 'Aktive Durchblutung und Gewebereparatur ohne metabolische Ermüdung.',
      energySystem: 'Lipolyse > 90%',
      rpeScale: '1-2 / 10 (federleicht)',
      recommendedDuration: '20 - 45 Min.'
    },
    {
      key: 'Z2',
      level: 2,
      name: 'Aerobe Ausdauer',
      code: 'Zone 2 Moderate / Endurance',
      fullName: 'Z2: Grundlagenausdauer 1 (Dauerlauf)',
      minPercent: 81,
      maxPercent: 89,
      minWatts: Math.round(rFtpWatts * 0.80) + 1,
      maxWatts: Math.round(rFtpWatts * 0.89),
      color: '#10b981',
      desc: 'Das Hauptvolumen (70-80%) eines gesunden Lauftrainingsplans.',
      benefit: 'Stärkt Sehnen, Bänder und das aerobe Mitochondriennetzwerk.',
      energySystem: 'Fettstoffwechsel 75-85%',
      rpeScale: '3-4 / 10 (flüssiges Reden)',
      recommendedDuration: '45 - 150 Min.'
    },
    {
      key: 'Z3',
      level: 3,
      name: 'Schwellenlauf / Tempo',
      code: 'Zone 3 Threshold',
      fullName: 'Z3: Tempodauerlauf / Halbmarathontempo',
      minPercent: 90,
      maxPercent: 100,
      minWatts: Math.round(rFtpWatts * 0.89) + 1,
      maxWatts: Math.round(rFtpWatts * 1.00),
      color: '#eab308',
      desc: 'Zügiges Laufen an der kritischen Leistungsgrenze (Critical Power).',
      benefit: 'Optimiert die Laufökonomie bei Renntempo und schult die Tempohärte.',
      energySystem: 'Mischstoffwechsel (Glykolyse & Lipolyse)',
      rpeScale: '6-7 / 10 (gefordert, rhythmisch)',
      recommendedDuration: '30 - 60 Min.'
    },
    {
      key: 'Z4',
      level: 4,
      name: 'Intervall / VO2max',
      code: 'Zone 4 Interval',
      fullName: 'Z4: Intervalltraining (10k- / 5k-Renntempo)',
      minPercent: 101,
      maxPercent: 115,
      minWatts: Math.round(rFtpWatts * 1.00) + 1,
      maxWatts: Math.round(rFtpWatts * 1.15),
      color: '#f97316',
      desc: 'Klassische Bahn- und Hügelwiederholungen zur Ausbelastung.',
      benefit: 'Hebt die maximale Sauerstoffaufnahme und die Schwellenleistung.',
      energySystem: 'Überwiegend anaerobe Glykolyse',
      rpeScale: '8-9 / 10 (sehr anstrengend)',
      recommendedDuration: '15 - 30 Min. akkumuliert'
    },
    {
      key: 'Z5',
      level: 5,
      name: 'Wiederholungen / Sprint',
      code: 'Zone 5 Repetition',
      fullName: 'Z5: Anaerobe Wiederholungen & Sprints',
      minPercent: 116,
      maxPercent: 150,
      minWatts: Math.round(rFtpWatts * 1.15) + 1,
      maxWatts: Math.round(rFtpWatts * 1.50),
      color: '#ef4444',
      desc: 'Kurze, kraftvolle Bergsprints oder 200m–400m Überdistanzläufe.',
      benefit: 'Schult Schrittlänge, Schrittfrequenz, Elastizität und anaerobe Kapazität.',
      energySystem: 'Alaktazide & Laktazide Höchstleistung',
      rpeScale: '10 / 10 (All-Out)',
      recommendedDuration: '10 - 60 Sekunden pro Rep'
    }
  ];

  return ok(zones);
}

/**
 * Helper to format seconds/km to mm:ss/km
 */
export function formatSecondsToPace(secondsPerKm: number): string {
  if (!secondsPerKm || secondsPerKm <= 0 || !isFinite(secondsPerKm)) return '-:--/km';
  const mins = Math.floor(secondsPerKm / 60);
  const secs = Math.round(secondsPerKm % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}/km`;
}

/**
 * Jack Daniels VDOT / Schwellenpace Model for Running
 * Threshold pace T_thresh in seconds/km (e.g. 270s = 4:30 min/km)
 */
export function calculateRunningPaceZones(thresholdPaceSecPerKm: number): Result<PaceZoneDefinition[], PowerZoneCalculationError> {
  if (!thresholdPaceSecPerKm || thresholdPaceSecPerKm <= 60 || thresholdPaceSecPerKm > 900) {
    return err(new PowerZoneCalculationError('Threshold pace must be between 1:00 and 15:00 min/km', 'INVALID_PACE'));
  }

  const zones: PaceZoneDefinition[] = [
    {
      key: 'Z1',
      level: 1,
      name: 'Regeneration (Recom)',
      code: 'P1 Recom',
      fullName: 'Z1: Lockeres Auslaufen / Regeneration',
      minPercent: 125,
      maxPercent: 150,
      minPaceSecPerKm: Math.round(thresholdPaceSecPerKm * 1.25),
      maxPaceSecPerKm: Math.round(thresholdPaceSecPerKm * 1.50),
      paceRangeFormatted: `> ${formatSecondsToPace(thresholdPaceSecPerKm * 1.25)}`,
      color: '#3b82f6',
      desc: 'Gemächlicher Trabschritt zur aktiven Wiederherstellung.',
      benefit: 'Fördert den Muskelstoffwechsel ohne Gelenküberlastung.',
      energySystem: 'Fettstoffwechsel > 90%',
      rpeScale: '1-2 / 10',
      recommendedDuration: '20 - 45 Min.'
    },
    {
      key: 'Z2',
      level: 2,
      name: 'Lockerer Dauerlauf (GA1)',
      code: 'P2 Easy / GA1',
      fullName: 'Z2: Grundlagenausdauer 1 Dauerlauf',
      minPercent: 115,
      maxPercent: 125,
      minPaceSecPerKm: Math.round(thresholdPaceSecPerKm * 1.15),
      maxPaceSecPerKm: Math.round(thresholdPaceSecPerKm * 1.25),
      paceRangeFormatted: `${formatSecondsToPace(thresholdPaceSecPerKm * 1.25)} – ${formatSecondsToPace(thresholdPaceSecPerKm * 1.15)}`,
      color: '#10b981',
      desc: 'Der Grundpfeiler des aeroben Laufens. Unterhaltung durchgehend flüssig.',
      benefit: 'Kapillarisierung und Ökonomisierung des Laufschritts.',
      energySystem: 'Fettstoffwechsel 75-80%',
      rpeScale: '3-4 / 10',
      recommendedDuration: '45 - 120 Min.'
    },
    {
      key: 'Z3',
      level: 3,
      name: 'Tempodauerlauf (GA2 / MRT)',
      code: 'P3 Tempo / MRT',
      fullName: 'Z3: Marathontempo (MRT) / Zügiger Dauerlauf',
      minPercent: 105,
      maxPercent: 115,
      minPaceSecPerKm: Math.round(thresholdPaceSecPerKm * 1.05),
      maxPaceSecPerKm: Math.round(thresholdPaceSecPerKm * 1.15),
      paceRangeFormatted: `${formatSecondsToPace(thresholdPaceSecPerKm * 1.15)} – ${formatSecondsToPace(thresholdPaceSecPerKm * 1.05)}`,
      color: '#eab308',
      desc: 'Zügiges Reisetempo mit fokussierter Schrittfrequenz (175–185 SPM).',
      benefit: 'Schult das Gefühl für das Renntempo und steigert die Glykogenspeicherung.',
      energySystem: 'Ausgeglichen aerob/glykolytisch',
      rpeScale: '5-6 / 10',
      recommendedDuration: '30 - 75 Min.'
    },
    {
      key: 'Z4',
      level: 4,
      name: 'Schwellenpace (vAnS / 10k)',
      code: 'P4 Threshold',
      fullName: 'Z4: Individuelle Anaerobe Schwelle (10k- / HM-Pace)',
      minPercent: 95,
      maxPercent: 105,
      minPaceSecPerKm: Math.round(thresholdPaceSecPerKm * 0.95),
      maxPaceSecPerKm: Math.round(thresholdPaceSecPerKm * 1.05),
      paceRangeFormatted: `${formatSecondsToPace(thresholdPaceSecPerKm * 1.05)} – ${formatSecondsToPace(thresholdPaceSecPerKm * 0.95)}`,
      color: '#f97316',
      desc: 'Hartes Laufen am maximalen Laktat-Gleichgewicht (Lactate Steady State).',
      benefit: 'Verschiebt die Schwellengeschwindigkeit nach oben.',
      energySystem: 'Überwiegend Glykolyse (> 85%)',
      rpeScale: '7-8 / 10',
      recommendedDuration: '20 - 45 Min.'
    },
    {
      key: 'Z5',
      level: 5,
      name: 'VO2max-Intervalle (5k / 3k)',
      code: 'P5 VO2 Max',
      fullName: 'Z5: Über-Schwellen-Intervalle (Bahn / Hügel)',
      minPercent: 85,
      maxPercent: 95,
      minPaceSecPerKm: Math.round(thresholdPaceSecPerKm * 0.85),
      maxPaceSecPerKm: Math.round(thresholdPaceSecPerKm * 0.95),
      paceRangeFormatted: `< ${formatSecondsToPace(thresholdPaceSecPerKm * 0.95)}`,
      color: '#ef4444',
      desc: 'Maximale Auslastung des Herz-Kreislauf-Systems.',
      benefit: 'Steigert VO2max und anaerobe Kapazität.',
      energySystem: 'Reine anaerobe Glykolyse',
      rpeScale: '9-10 / 10',
      recommendedDuration: '10 - 25 Min. akkumuliert'
    }
  ];

  return ok(zones);
}

/**
 * Calculates complete power zones distribution for a series of activity points
 */
export function calculateActivityPowerDistribution(params: {
  points: { power?: number; speed?: number; ele?: number; time?: Date }[];
  activityType: ActivityType;
  cyclingFtpWatts?: number;
  runningFtpWatts?: number;
  thresholdPaceSecPerKm?: number;
  trackDurationSec?: number;
}): Result<PowerZonesAnalysisResult, PowerZoneCalculationError> {
  const {
    points,
    activityType,
    cyclingFtpWatts = 250,
    runningFtpWatts = 280,
    thresholdPaceSecPerKm = 270,
    trackDurationSec = 0
  } = params;

  if (!points || points.length === 0) {
    return err(new PowerZoneCalculationError('Points array must not be empty', 'INVALID_POINTS'));
  }

  const isCycling = activityType === 'cycling';
  const effectiveFtp = isCycling ? cyclingFtpWatts : runningFtpWatts;

  // Extract or synthesize power values
  const powerValues: number[] = [];
  const durations: number[] = [];
  const fallbackStepSec = trackDurationSec > 0 ? (trackDurationSec / points.length) : 5.0;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const ptNext = points[i + 1];

    let stepSec = fallbackStepSec;
    if (pt.time && ptNext?.time) {
      const diff = (ptNext.time.getTime() - pt.time.getTime()) / 1000;
      if (diff > 0 && diff < 120) stepSec = diff;
    }

    let power = pt.power;
    if (power === undefined || power === null || power <= 0) {
      // Physically estimate power if not recorded
      if (isCycling) {
        // Cycling physics estimation: baseline 140W on flat, modulated by speed/gradient
        const speedKmh = pt.speed ? pt.speed * 3.6 : 26;
        power = Math.max(0, Math.round(speedKmh * 6.5));
      } else {
        // Running power estimation: body mass ~72kg * speed(m/s) * 1.05
        const speedM_S = pt.speed || (1000 / thresholdPaceSecPerKm);
        power = Math.max(0, Math.round(72 * speedM_S * 1.05));
      }
    }

    powerValues.push(power);
    durations.push(stepSec);
  }

  const totalDurationSec = durations.reduce((a, b) => a + b, 0) || 1;
  const avgWatts = Math.round(powerValues.reduce((sum, p, i) => sum + p * durations[i], 0) / totalDurationSec);
  const maxWatts = Math.round(Math.max(...powerValues));

  // Coggan Normalized Power (NP) 4th power rolling calculation approximation
  let sumFourthPower = 0;
  for (let i = 0; i < powerValues.length; i++) {
    sumFourthPower += Math.pow(powerValues[i], 4) * durations[i];
  }
  const normalizedWatts = Math.round(Math.pow(sumFourthPower / totalDurationSec, 0.25));
  const intensityFactor = parseFloat((normalizedWatts / effectiveFtp).toFixed(2));
  const trainingStressScore = Math.round(((totalDurationSec * normalizedWatts * intensityFactor) / (effectiveFtp * 3600)) * 100);
  const variabilityIndex = avgWatts > 0 ? parseFloat((normalizedWatts / avgWatts).toFixed(2)) : 1.0;

  // Build Zone Distribution
  const distributionItems: ActivityZoneDistributionItem[] = [];

  if (isCycling) {
    const zonesRes = calculateCyclingPowerZones(effectiveFtp);
    if (!zonesRes.success) return err(zonesRes.error);
    const zones = zonesRes.data;

    const zoneSeconds = new Array(zones.length).fill(0);
    for (let i = 0; i < powerValues.length; i++) {
      const p = powerValues[i];
      const d = durations[i];
      let assigned = false;
      for (let zIdx = 0; zIdx < zones.length; zIdx++) {
        if (p <= zones[zIdx].maxWatts || zIdx === zones.length - 1) {
          zoneSeconds[zIdx] += d;
          assigned = true;
          break;
        }
      }
      if (!assigned) zoneSeconds[zones.length - 1] += d;
    }

    for (let zIdx = 0; zIdx < zones.length; zIdx++) {
      const z = zones[zIdx];
      const dur = zoneSeconds[zIdx];
      distributionItems.push({
        key: z.key,
        level: z.level,
        name: z.name,
        color: z.color,
        durationSec: Math.round(dur),
        percent: parseFloat(((dur / totalDurationSec) * 100).toFixed(1)),
        rangeFormatted: `${z.minWatts} – ${z.maxWatts} W`,
        targetMetric: 'watts'
      });
    }
  } else {
    // Running Model (Jim Vance / Stryd standard)
    const zonesRes = calculateRunningPowerZones(effectiveFtp);
    if (!zonesRes.success) return err(zonesRes.error);
    const zones = zonesRes.data;

    const zoneSeconds = new Array(zones.length).fill(0);
    for (let i = 0; i < powerValues.length; i++) {
      const p = powerValues[i];
      const d = durations[i];
      let assigned = false;
      for (let zIdx = 0; zIdx < zones.length; zIdx++) {
        if (p <= zones[zIdx].maxWatts || zIdx === zones.length - 1) {
          zoneSeconds[zIdx] += d;
          assigned = true;
          break;
        }
      }
      if (!assigned) zoneSeconds[zones.length - 1] += d;
    }

    for (let zIdx = 0; zIdx < zones.length; zIdx++) {
      const z = zones[zIdx];
      const dur = zoneSeconds[zIdx];
      distributionItems.push({
        key: z.key,
        level: z.level,
        name: z.name,
        color: z.color,
        durationSec: Math.round(dur),
        percent: parseFloat(((dur / totalDurationSec) * 100).toFixed(1)),
        rangeFormatted: `${z.minWatts} – ${z.maxWatts} W`,
        targetMetric: 'watts'
      });
    }
  }

  // Aerobic vs Anaerobic calculation
  // For cycling: Z1-Z3 are aerobic, Z4 is threshold transition, Z5-Z7 are anaerobic
  // For running: Z1-Z2 are aerobic, Z3 is threshold, Z4-Z5 are anaerobic
  const aerobicSec = isCycling
    ? distributionItems.slice(0, 3).reduce((sum, item) => sum + item.durationSec, 0) + (distributionItems[3]?.durationSec || 0) * 0.5
    : distributionItems.slice(0, 2).reduce((sum, item) => sum + item.durationSec, 0) + (distributionItems[2]?.durationSec || 0) * 0.5;

  const anaerobicSec = totalDurationSec - aerobicSec;
  const aerobicPercent = Math.round((aerobicSec / totalDurationSec) * 100);
  const anaerobicPercent = Math.max(0, 100 - aerobicPercent);

  return ok({
    activityType,
    thresholdWatts: effectiveFtp,
    thresholdPaceSecPerKm: !isCycling ? thresholdPaceSecPerKm : undefined,
    avgWatts,
    maxWatts,
    normalizedWatts,
    intensityFactor,
    trainingStressScore,
    variabilityIndex,
    zonesDistribution: distributionItems,
    aerobicPercent,
    anaerobicPercent,
    modelName: isCycling ? 'Andy Coggan 7-Zonen Leistungsmodell' : 'Jim Vance / Stryd Running-Power 5-Zonen Modell',
    modelDescription: isCycling
      ? 'Berechnet basierend auf deiner Functional Threshold Power (FTP in Watt) mit progressiven Stufen Z1–Z7.'
      : 'Berechnet basierend auf deiner Running Critical Power (rFTPw in Watt) und Schwellenpace (vAnS) für Laufsportler.'
  });
}
