import { GPXTrack, GPXPoint, TextMarker } from '../types';
import { calculateDistance, findClimbs, getActiveClimbCriteria } from './gpxUtils';

export interface IntensiveClimb {
  index: number;
  startIndex: number;
  endIndex: number;
  startKm: number;
  endKm: number;
  distanceKm: number;
  ascentMeters: number;
  startElevationM: number;
  endElevationM: number;
  avgGradePercent: number;
  maxGradePercent: number;
  estimatedTimeSeconds: number;
  estimatedPowerWatts?: number;
  categoryLabel: string;
  categoryColor: string;
  hexColor: string;
  categoryDescription: string;
  vam: number; // Vertical Ascent in m/h
  startPoint: { lat: number; lng: number };
  peakPoint: { lat: number; lng: number };
  points: GPXPoint[];
}

export function getClimbHexColor(categoryLabel: string): string {
  if (!categoryLabel) return '#10b981';
  if (categoryLabel.includes('HC')) return '#9333ea'; // Purple / HC
  if (categoryLabel.includes('Kategorie 1') || categoryLabel.includes('Kat 1')) return '#e11d48'; // Rose
  if (categoryLabel.includes('Kategorie 2') || categoryLabel.includes('Kat 2')) return '#f97316'; // Orange
  if (categoryLabel.includes('Kategorie 3') || categoryLabel.includes('Kat 3')) return '#f59e0b'; // Amber
  if (categoryLabel.includes('Kategorie 4') || categoryLabel.includes('Kat 4')) return '#3b82f6'; // Blue
  return '#10b981'; // Emerald
}

export interface IntensiveAnalysisOptions {
  date?: string;
  activityType?: 'cycling' | 'running';
  subType?: 'road' | 'gravel' | 'mtb' | 'trail' | 'track';
  fitnessLevel?: 'beginner' | 'moderate' | 'advanced' | 'elite';
  userWeightKg?: number;
  equipmentWeightKg?: number;
  targetFtp?: number;
  targetPaceMinPerKm?: number;
  temperatureC?: number;
  headwindKmh?: number;
}

export interface IntensiveAnalysisResult {
  trackId: string;
  trackName: string;
  totalDistanceKm: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
  minElevation: number;
  maxElevation: number;
  maxGradePercent: number;
  avgGradePercent: number;
  activityType: 'cycling' | 'running';
  subType: string;
  
  // Physical & Performance Estimates
  estimatedMovingTimeSeconds: number;
  estimatedElapsedTimeSeconds: number;
  estimatedAverageSpeedKmh: number;
  estimatedNormalizedPowerWatts?: number;
  estimatedAveragePowerWatts?: number;
  estimatedAverageHeartRateBpm: number;
  
  // Energy & Nutrition
  totalCaloriesKcal: number;
  carbsBurnedGrams: number;
  fatBurnedGrams: number;
  hourlyCarbIntakeRecommendedGrams: number;
  totalFluidRecommendedLiters: number;
  sodiumRecommendedMg: number;

  // Grade & Terrain Distribution
  flatDistanceKm: number;
  climbingDistanceKm: number;
  steepClimbDistanceKm: number;
  descentDistanceKm: number;
  difficultyScore: number; // 1 - 10

  // Climbs & Categorized Ascents
  climbs: IntensiveClimb[];
  totalClimbAscentMeters: number;
  totalClimbDistanceKm: number;
  
  // Tactical recommendations & insights
  tacticalTips: {
    category: 'pacing' | 'nutrition' | 'gear' | 'safety' | 'climbing';
    title: string;
    description: string;
    urgency: 'info' | 'warning' | 'critical';
  }[];

  // Splits / Mile markers
  splits: {
    kmMarker: number;
    splitDistanceKm: number;
    splitAscentMeters: number;
    splitAvgGradePercent: number;
    estimatedSplitTimeSeconds: number;
    cumulativeTimeSeconds: number;
    terrainType: string;
  }[];

  // Potential Road/Event Closures or Caution Zones
  cautionZones: {
    kmStart: number;
    kmEnd: number;
    reason: string;
    severity: 'low' | 'medium' | 'high';
    advice: string;
  }[];

  // Discovered or nearby POIs (Water, Rest, Peak, Viewpoint)
  poiRecommendations: {
    kmLocation: number;
    type: 'water' | 'summit' | 'caution_descent' | 'photo_spot' | 'refuel';
    title: string;
    description: string;
    lat: number;
    lng: number;
  }[];

  // Optional Geolocation & Enrichment fields
  locationStart?: string;
  locationSummit?: string;
  locationEnd?: string;
  maxSlopePercent?: number;
  fitnessLevel?: string;
  foodAndWaterPOIs?: any[];
  dateEventsAndAlerts?: any[];
  aiSummary?: string;
  isAiEnhanced?: boolean;
}

/**
 * Calculates cumulative distance array for GPX points
 */
export function calculateCumulativeDistances(points: GPXPoint[]): number[] {
  let accum = 0;
  return points.map((p, i) => {
    if (i > 0) {
      accum += calculateDistance(points[i - 1], p);
    }
    return Number(accum.toFixed(3));
  });
}

/**
 * Formats seconds into HH:MM or MM:SS
 */
export function formatSecondsToTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) {
    return `${h}h ${m < 10 ? '0' : ''}${m}m`;
  }
  return `${m}m ${Math.floor(seconds % 60)}s`;
}

/**
 * Formats seconds into HH:MM:SS
 */
export function formatSecondsToDigital(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  if (h > 0) {
    return `${h}:${pad(m)}:${pad(s)}`;
  }
  return `${m}:${pad(s)}`;
}

/**
 * Deterministic physics-based track analysis algorithm
 */
export function performLocalIntensiveAnalysis(
  track: GPXTrack,
  options: IntensiveAnalysisOptions = {},
  existingMarkers: TextMarker[] = []
): IntensiveAnalysisResult {
  const points = track.points || [];
  const isCycling = (options.activityType || track.activityType || 'cycling') !== 'running';
  const subType = options.subType || (isCycling ? 'road' : 'trail');
  const userWeight = options.userWeightKg || 75;
  const bikeWeight = options.equipmentWeightKg || (isCycling ? 9.5 : 0.8);
  const totalWeight = userWeight + bikeWeight;
  const ftp = options.targetFtp || 220;
  const fitnessLevel = options.fitnessLevel || 'moderate';
  const temperature = options.temperatureC || 20;

  // Calculate cumulative distances
  const cumDists = calculateCumulativeDistances(points);
  const totalDist = cumDists.length > 0 ? cumDists[cumDists.length - 1] : track.distance || 0;

  let totalAscent = 0;
  let totalDescent = 0;
  let minEle = points.length > 0 && points[0].ele !== undefined ? points[0].ele : 0;
  let maxEle = minEle;

  let flatDist = 0;
  let climbingDist = 0;
  let steepClimbDist = 0;
  let descentDist = 0;
  let maxGrade = 0;
  let gradeSum = 0;
  let segmentCount = 0;

  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    const segDist = cumDists[i] - cumDists[i - 1];
    if (segDist <= 0) continue;

    const ele1 = p1.ele || 0;
    const ele2 = p2.ele || 0;
    const eleDiff = ele2 - ele1;

    if (ele2 > maxEle) maxEle = ele2;
    if (ele2 < minEle) minEle = ele2;

    if (eleDiff > 0) totalAscent += eleDiff;
    else totalDescent += Math.abs(eleDiff);

    const grade = (eleDiff / (segDist * 1000)) * 100;
    if (grade > maxGrade) maxGrade = grade;
    gradeSum += Math.abs(grade);
    segmentCount++;

    if (grade > 8) steepClimbDist += segDist;
    else if (grade > 2.5) climbingDist += segDist;
    else if (grade < -2.5) descentDist += segDist;
    else flatDist += segDist;
  }

  const finalAscent = track.ascent && track.ascent > 0 ? track.ascent : Math.round(totalAscent);
  const finalDescent = track.descent && track.descent > 0 ? track.descent : Math.round(totalDescent);
  const avgGrade = segmentCount > 0 ? Number((gradeSum / segmentCount).toFixed(1)) : 2.0;

  // Physics-based speed model
  let totalMovingSeconds = 0;
  let totalWorkJoules = 0;

  const fitnessPowerMultiplier = {
    beginner: 0.65,
    moderate: 0.80,
    advanced: 0.95,
    elite: 1.15
  }[fitnessLevel];

  const targetPower = isCycling ? ftp * fitnessPowerMultiplier : 0;

  for (let i = 1; i < points.length; i++) {
    const segDistKm = cumDists[i] - cumDists[i - 1];
    if (segDistKm <= 0) continue;
    const segDistM = segDistKm * 1000;
    const ele1 = points[i - 1].ele || 0;
    const ele2 = points[i].ele || 0;
    const grade = Math.max(-25, Math.min(30, ((ele2 - ele1) / segDistM) * 100));

    let speedKmh = 25;

    if (isCycling) {
      // Simplified physics for cycling:
      // P = F_gravity + F_roll + F_aero
      // On steep climbing: Speed determined by W/kg
      if (grade > 10) {
        speedKmh = Math.max(5.5, (targetPower / (totalWeight * 9.81 * (grade / 100))) * 3.6 * 0.85);
      } else if (grade > 4) {
        speedKmh = Math.max(8.0, 24 - grade * 1.5);
      } else if (grade > 0) {
        speedKmh = Math.max(16, 28 - grade * 1.8);
      } else if (grade < -6) {
        speedKmh = Math.min(58, 38 + Math.abs(grade) * 2.2);
      } else {
        speedKmh = Math.min(42, 32 + Math.abs(grade) * 1.5);
      }

      // Surface penalty
      if (subType === 'gravel') speedKmh *= 0.88;
      if (subType === 'mtb') speedKmh *= 0.76;
    } else {
      // Running / Trail model (Minetti energetic cost of running on slopes)
      let basePaceMinPerKm = 5.2; // 5:12 min/km
      if (fitnessLevel === 'beginner') basePaceMinPerKm = 6.5;
      if (fitnessLevel === 'advanced') basePaceMinPerKm = 4.3;
      if (fitnessLevel === 'elite') basePaceMinPerKm = 3.6;

      let slopeFactor = 1.0;
      if (grade > 0) slopeFactor = 1 + (grade / 100) * 3.5;
      else slopeFactor = Math.max(0.75, 1 - Math.abs(grade / 100) * 1.2);

      const segmentPace = basePaceMinPerKm * slopeFactor;
      speedKmh = Math.max(3.2, 60 / segmentPace);

      if (subType === 'trail') speedKmh *= 0.85;
    }

    const segTimeSec = (segDistKm / speedKmh) * 3600;
    totalMovingSeconds += segTimeSec;

    if (isCycling) {
      totalWorkJoules += targetPower * segTimeSec;
    }
  }

  if (totalMovingSeconds <= 0) {
    totalMovingSeconds = Math.round((totalDist / (isCycling ? 24 : 10)) * 3600);
  }

  // Elapsed time with rest factor
  const restFactor = totalDist > 80 ? 1.15 : totalDist > 40 ? 1.08 : 1.04;
  const totalElapsedSeconds = Math.round(totalMovingSeconds * restFactor);
  const avgSpeedKmh = Number((totalDist / (totalMovingSeconds / 3600)).toFixed(1));

  // Energy & Nutrition Calculations
  // Cycling: 1 Watt for 1 second = 1 Joule = 0.239 cal / gross human mechanical efficiency (~22%) -> 1 kJ work ~ 1.08 kcal
  // Running: ~1 kcal per kg per km * elevation factor
  let totalCalories = 0;
  if (isCycling) {
    if (totalWorkJoules > 0) {
      totalCalories = Math.round(totalWorkJoules / (1000 * 0.22 * 4.184)); // standard metabolic conversion from pedal work
    } else {
      totalCalories = Math.round(totalDist * 28 + finalAscent * 0.8);
    }
    if (totalCalories < totalDist * 22) totalCalories = Math.round(totalDist * 28 + finalAscent * 0.8);
  } else {
    totalCalories = Math.round(totalDist * userWeight * 1.036 * (1 + finalAscent / 1000 * 0.35));
  }

  // Carb / Fat Burn partition based on intensity
  const carbRatio = fitnessLevel === 'elite' ? 0.65 : 0.72;
  const carbsBurned = Math.round((totalCalories * carbRatio) / 4); // 4 kcal per gram carb
  const fatBurned = Math.round((totalCalories * (1 - carbRatio)) / 9); // 9 kcal per gram fat

  // Hydration & Electrolytes
  // Base sweat rate ~ 500-900ml/hr based on temp and effort
  const sweatRatePerHourL = 0.55 + (temperature > 24 ? (temperature - 24) * 0.04 : 0);
  const totalFluidLiters = Number(((totalMovingSeconds / 3600) * sweatRatePerHourL).toFixed(1));
  const hourlyCarbIntake = totalDist > 50 || totalMovingSeconds > 5400 ? (isCycling ? 60 : 45) : 30;
  const totalSodiumMg = Math.round((totalMovingSeconds / 3600) * 550);

  // Difficulty calculation (Score 1-10)
  // Distance factor + Elevation factor
  const distFactor = isCycling ? totalDist / 20 : totalDist / 5;
  const climbFactor = finalAscent / 250;
  const rawDifficulty = 1 + (distFactor * 0.4 + climbFactor * 0.6);
  const difficultyScore = Math.min(10, Math.max(1, Math.round(rawDifficulty)));

  // Generate Stage Splits (every 5km or 10km depending on track length)
  const splitIntervalKm = totalDist > 70 ? 10 : totalDist > 25 ? 5 : 2;
  const splits: IntensiveAnalysisResult['splits'] = [];
  let curSplitDist = 0;
  let curSplitAscent = 0;
  let curSplitTime = 0;
  let splitStartIdx = 0;

  for (let i = 1; i < points.length; i++) {
    const segDist = cumDists[i] - cumDists[i - 1];
    const eleDiff = (points[i].ele || 0) - (points[i - 1].ele || 0);
    curSplitDist += segDist;
    if (eleDiff > 0) curSplitAscent += eleDiff;

    const segTime = (segDist / avgSpeedKmh) * 3600;
    curSplitTime += segTime;

    if (curSplitDist >= splitIntervalKm || i === points.length - 1) {
      const splitAvgGrade = curSplitDist > 0 ? Number(((curSplitAscent / (curSplitDist * 1000)) * 100).toFixed(1)) : 0;
      let terrain = 'Flach / Rolleur';
      if (splitAvgGrade > 6) terrain = 'Steiler Anstieg';
      else if (splitAvgGrade > 2) terrain = 'Wellig / Ansteigend';
      else if (splitAvgGrade < -2) terrain = 'Abfahrt / Flow';

      splits.push({
        kmMarker: Number(cumDists[i].toFixed(1)),
        splitDistanceKm: Number(curSplitDist.toFixed(1)),
        splitAscentMeters: Math.round(curSplitAscent),
        splitAvgGradePercent: splitAvgGrade,
        estimatedSplitTimeSeconds: Math.round(curSplitTime),
        cumulativeTimeSeconds: Math.round((cumDists[i] / totalDist) * totalMovingSeconds),
        terrainType: terrain
      });

      curSplitDist = 0;
      curSplitAscent = 0;
      curSplitTime = 0;
      splitStartIdx = i;
    }
  }

  // Tactical recommendations
  const tacticalTips: IntensiveAnalysisResult['tacticalTips'] = [];

  if (steepClimbDist > 3 || finalAscent > 800) {
    tacticalTips.push({
      category: 'climbing',
      title: 'Bergauf-Pacing & Trittfrequenz',
      description: `Es stehen ${Math.round(finalAscent)} Hm und ${steepClimbDist.toFixed(1)} km Steigungen über 8% an. Fahre/Laufe die ersten Anstiege strikt unterhalb deiner anaeroben Schwelle (Zone 3/untere Z4), um spätere Einbrüche zu vermeiden.`,
      urgency: 'critical'
    });
  } else if (finalAscent > 200) {
    tacticalTips.push({
      category: 'climbing',
      title: 'Rhythmisches Bergauf-Pacing',
      description: `Mit ${Math.round(finalAscent)} Hm bietet die Strecke spürbare Höhenmeter. Halte an den Wellen eine gleichmäßige Trittfrequenz (85–95 U/min) und dosiere deinen Krafteinsatz.`,
      urgency: 'info'
    });
  } else {
    tacticalTips.push({
      category: 'pacing',
      title: 'Aerodynamik & Tempoführung',
      description: `Flaches Streckenprofil: Achte auf eine aerodynamische Haltung und kontinuierliches Pacing, um den Windwiderstand zu minimieren.`,
      urgency: 'info'
    });
  }

  if (totalFluidLiters >= 1.2) {
    tacticalTips.push({
      category: 'nutrition',
      title: 'Hydrations- & Elektrolyt-Strategie',
      description: `Gesamtbedarf ca. ${totalFluidLiters} Liter Flüssigkeit und ~${totalSodiumMg} mg Natrium. Plane feste Trinkintervalle alle 15–20 Minuten (ca. 150-200 ml).`,
      urgency: 'warning'
    });
  } else {
    tacticalTips.push({
      category: 'nutrition',
      title: 'Flüssigkeitszufuhr',
      description: `Für diese Distanz reicht 1 Trinkflasche (ca. ${totalFluidLiters} L). Regelmäßig kleine Schlucke trinken.`,
      urgency: 'info'
    });
  }

  if (totalMovingSeconds > 5400) {
    tacticalTips.push({
      category: 'nutrition',
      title: 'Kohlenhydrat-Versorgung',
      description: `Bei einer Dauer von ${formatSecondsToTime(totalMovingSeconds)} benötigst du ca. ${hourlyCarbIntake}g Kohlenhydrate pro Stunde (z.B. Riegel, Gels oder Sportgetränk), um einen Hungerast zu verhindern.`,
      urgency: 'info'
    });
  }

  if (maxGrade > 14) {
    tacticalTips.push({
      category: 'gear',
      title: 'Übersetzung & Bremsen-Check',
      description: `Maximale Steigung/Gefälle von bis zu ${Math.round(maxGrade)}% registriert. Stelle sicher, dass Bremsbeläge intakt sind und für lange Abfahrten dosiert gebremst wird (Intervallbremsen gegen Fading).`,
      urgency: 'warning'
    });
  }

  // Caution zones & heuristic checks
  const cautionZones: IntensiveAnalysisResult['cautionZones'] = [];
  if (steepClimbDist > 0) {
    cautionZones.push({
      kmStart: Math.max(0, Number((totalDist * 0.35).toFixed(1))),
      kmEnd: Number((totalDist * 0.45).toFixed(1)),
      reason: 'Steilstufe & kurvige Bergpassage',
      severity: 'medium',
      advice: 'Vorausschauend fahren, Gegenverkehr und Rollsplitt in Kehren beachten.'
    });
  }

  // POIs (Highest Point, Halfway, Water points)
  const poiRecommendations: IntensiveAnalysisResult['poiRecommendations'] = [];
  
  // Find highest point
  let highestIdx = 0;
  let highestEle = -Infinity;
  points.forEach((p, idx) => {
    if (p.ele !== undefined && p.ele > highestEle) {
      highestEle = p.ele;
      highestIdx = idx;
    }
  });

  if (highestEle > -Infinity && points[highestIdx]) {
    poiRecommendations.push({
      kmLocation: cumDists[highestIdx] || 0,
      type: 'summit',
      title: `Höchster Punkt (${Math.round(highestEle)} m)`,
      description: 'Streckenscheitelpunkt. Idealer Ort für Windweste anziehen vor der Abfahrt.',
      lat: points[highestIdx].lat,
      lng: points[highestIdx].lng
    });
  }

  // Halfway point
  const halfIdx = Math.floor(points.length / 2);
  if (points[halfIdx]) {
    poiRecommendations.push({
      kmLocation: Number((totalDist / 2).toFixed(1)),
      type: 'refuel',
      title: 'Halbzeit / Verpflegung',
      description: '50% der Distanz erreicht. Trinkflaschenstand prüfen und Energie nachladen.',
      lat: points[halfIdx].lat,
      lng: points[halfIdx].lng
    });
  }

  // Calculate climbs and categorized ascents
  const rawClimbs = track.climbs && track.climbs.length > 0
    ? track.climbs
    : findClimbs(points, getActiveClimbCriteria());

  const intensiveClimbs: IntensiveClimb[] = rawClimbs.map((climb, idx) => {
    const startKm = Number(cumDists[climb.startIndex]?.toFixed(2) || '0');
    const endKm = Number(cumDists[climb.endIndex]?.toFixed(2) || '0');
    const distanceKm = Number((climb.distance / 1000).toFixed(2));
    const ascentMeters = Math.round(climb.ascent);
    const startEle = Math.round(points[climb.startIndex]?.ele ?? 0);
    const endEle = Math.round(points[climb.endIndex]?.ele ?? 0);
    const avgGrad = Number(climb.avgGradient.toFixed(1));
    const maxGrad = Number(climb.maxGradient.toFixed(1));

    // Physics-based time estimation on the specific climb
    let climbSpeedKmh = 12;
    if (isCycling) {
      if (avgGrad > 10) {
        climbSpeedKmh = Math.max(5.0, (targetPower / (totalWeight * 9.81 * (avgGrad / 100))) * 3.6 * 0.85);
      } else if (avgGrad > 6) {
        climbSpeedKmh = Math.max(7.5, 22 - avgGrad * 1.5);
      } else {
        climbSpeedKmh = Math.max(12.0, 26 - avgGrad * 1.4);
      }
      if (subType === 'gravel') climbSpeedKmh *= 0.88;
      if (subType === 'mtb') climbSpeedKmh *= 0.76;
    } else {
      let basePace = fitnessLevel === 'elite' ? 4.0 : fitnessLevel === 'advanced' ? 4.8 : 5.8;
      const slopeFactor = 1 + (avgGrad / 100) * 3.5;
      const climbPace = basePace * slopeFactor;
      climbSpeedKmh = Math.max(3.0, 60 / climbPace);
      if (subType === 'trail') climbSpeedKmh *= 0.85;
    }

    const estTimeSec = Math.max(30, Math.round((distanceKm / climbSpeedKmh) * 3600));
    const vam = estTimeSec > 0 ? Math.round((ascentMeters / estTimeSec) * 3600) : 0;

    // Difficulty score and categorization
    const score = (ascentMeters * avgGrad) / 10 + ((ascentMeters * ascentMeters) / Math.max(100, climb.distance)) * 0.1;
    let catLabel = 'Kategorie 4';
    let catColor = 'bg-blue-600 text-white dark:bg-blue-600/90';
    let catDesc = 'Kurzer Hügel / Rampe. Ideal für spritzige Antritte.';

    if (score >= 200) {
      catLabel = 'HC (Hors Catégorie)';
      catColor = 'bg-slate-950 text-amber-400 border border-amber-400/40 dark:bg-black dark:text-amber-300';
      catDesc = 'Monumentaler Pass. Extrem steil und konditionell fordernd.';
    } else if (score >= 120) {
      catLabel = 'Kategorie 1';
      catColor = 'bg-rose-600 text-white dark:bg-rose-700';
      catDesc = 'Schwerer Alpen-/Mittelgebirgs-Pass mit vielen Gesamthöhenmetern.';
    } else if (score >= 50) {
      catLabel = 'Kategorie 2';
      catColor = 'bg-orange-500 text-white dark:bg-orange-600';
      catDesc = 'Mittelschwerer Anstieg. Erfordert gleichmäßigen Krafteinsatz.';
    } else if (score >= 20) {
      catLabel = 'Kategorie 3';
      catColor = 'bg-amber-500 text-slate-950 dark:bg-amber-600 dark:text-slate-950';
      catDesc = 'Klassischer Hügel / Bergaufpassage mit moderater Steigung.';
    }

    return {
      index: idx,
      startIndex: climb.startIndex,
      endIndex: climb.endIndex,
      startKm,
      endKm,
      distanceKm,
      ascentMeters,
      startElevationM: startEle,
      endElevationM: endEle,
      avgGradePercent: avgGrad,
      maxGradePercent: maxGrad,
      estimatedTimeSeconds: estTimeSec,
      estimatedPowerWatts: isCycling ? Math.round(targetPower) : undefined,
      categoryLabel: catLabel,
      categoryColor: catColor,
      hexColor: getClimbHexColor(catLabel),
      categoryDescription: catDesc,
      vam,
      startPoint: { lat: points[climb.startIndex]?.lat || 0, lng: points[climb.startIndex]?.lng || 0 },
      peakPoint: { lat: points[climb.endIndex]?.lat || 0, lng: points[climb.endIndex]?.lng || 0 },
      points: points.slice(climb.startIndex, climb.endIndex + 1)
    };
  });

  const totalClimbAscentMeters = intensiveClimbs.reduce((acc, c) => acc + c.ascentMeters, 0);
  const totalClimbDistanceKm = Number(intensiveClimbs.reduce((acc, c) => acc + c.distanceKm, 0).toFixed(2));

  return {
    trackId: track.id,
    trackName: track.name || 'Unbenannte Route',
    totalDistanceKm: Number(totalDist.toFixed(2)),
    totalAscentMeters: finalAscent,
    totalDescentMeters: finalDescent,
    minElevation: Math.round(minEle),
    maxElevation: Math.round(maxEle),
    maxGradePercent: Number(maxGrade.toFixed(1)),
    avgGradePercent: avgGrade,
    activityType: isCycling ? 'cycling' : 'running',
    subType,
    estimatedMovingTimeSeconds: Math.round(totalMovingSeconds),
    estimatedElapsedTimeSeconds: totalElapsedSeconds,
    estimatedAverageSpeedKmh: avgSpeedKmh,
    estimatedAveragePowerWatts: isCycling ? Math.round(targetPower) : undefined,
    estimatedAverageHeartRateBpm: fitnessLevel === 'elite' ? 142 : fitnessLevel === 'advanced' ? 148 : 155,
    totalCaloriesKcal: totalCalories,
    carbsBurnedGrams: carbsBurned,
    fatBurnedGrams: fatBurned,
    hourlyCarbIntakeRecommendedGrams: hourlyCarbIntake,
    totalFluidRecommendedLiters: totalFluidLiters,
    sodiumRecommendedMg: totalSodiumMg,
    flatDistanceKm: Number(flatDist.toFixed(1)),
    climbingDistanceKm: Number(climbingDist.toFixed(1)),
    steepClimbDistanceKm: Number(steepClimbDist.toFixed(1)),
    descentDistanceKm: Number(descentDist.toFixed(1)),
    difficultyScore,
    climbs: intensiveClimbs,
    totalClimbAscentMeters,
    totalClimbDistanceKm,
    tacticalTips,
    splits,
    cautionZones,
    poiRecommendations
  };
}
