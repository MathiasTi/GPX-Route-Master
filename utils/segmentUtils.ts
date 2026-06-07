import { GPXTrack, GPXPoint, Segment, LeaderboardEntry } from '../types';
import { calculateDistance } from './gpxUtils';

/**
 * Basic Haversine distance calculation in kilometers between two lat/lng pairs
 */
const getDistanceKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const p1: GPXPoint = { lat: lat1, lng: lng1 };
  const p2: GPXPoint = { lat: lat2, lng: lng2 };
  return calculateDistance(p1, p2);
};

/**
 * Estimates power in Watts using basic physics:
 * P = P_gravity + P_air + P_rolling
 */
export const estimatePower = (
  weightKg: number,
  avgSpeedKmh: number,
  ascentMeter: number,
  timeSec: number
): number => {
  const mass = weightKg + 8.5; // weight + bicycle weight (approx)
  const g = 9.81;
  const speedMs = avgSpeedKmh / 3.6;
  
  // Power to overcome gravity: m * g * vertical_speed
  const verticalSpeed = timeSec > 0 ? ascentMeter / timeSec : 0;
  const pGravity = mass * g * verticalSpeed;

  // Power to overcome air resistance: 0.5 * CdA * rho * v^3
  // Standard road bike on hoods: CdA ≈ 0.32, air density approx 1.2
  const pAir = 0.5 * 0.32 * 1.2 * Math.pow(speedMs, 3);

  // Power to overcome rolling resistance: Crr * mass * g * v
  // Crr ≈ 0.004
  const pRolling = 0.004 * mass * g * speedMs;

  const totalPower = pGravity + pAir + pRolling;
  
  // Return a realistic physical estimate (never less than 5W)
  return Math.max(5, Math.round(totalPower));
};

/**
 * Checks if a track covers a segment, and calculates the athlete's effort if so.
 */
export const calculateEffortForSegment = (
  track: GPXTrack,
  segment: Segment,
  userWeightKg: number = 75,
  fallbackSpeedKmh: number = 15
): LeaderboardEntry | null => {
  if (track.points.length < 2) return null;

  let closestStartIdx = -1;
  let closestStartDist = Infinity;
  let closestEndIdx = -1;
  let closestEndDist = Infinity;

  // Find closest track point to segment starting point
  for (let i = 0; i < track.points.length; i++) {
    const pt = track.points[i];
    const dist = getDistanceKm(pt.lat, pt.lng, segment.startLat, segment.startLng);
    if (dist < closestStartDist) {
      closestStartDist = dist;
      closestStartIdx = i;
    }
  }

  // Find closest track point to segment ending point
  for (let i = 0; i < track.points.length; i++) {
    const pt = track.points[i];
    const dist = getDistanceKm(pt.lat, pt.lng, segment.endLat, segment.endLng);
    if (dist < closestEndDist) {
      closestEndDist = dist;
      closestEndIdx = i;
    }
  }

  // Threshold: segment start and end points must be within 200 meters of the track
  const MATCH_THRESHOLD_KM = 0.2; 
  if (
    closestStartIdx === -1 || 
    closestEndIdx === -1 || 
    closestStartDist > MATCH_THRESHOLD_KM || 
    closestEndDist > MATCH_THRESHOLD_KM ||
    closestStartIdx >= closestEndIdx
  ) {
    return null;
  }

  // Segment matches! Now calculate the stats
  const effortPoints = track.points.slice(closestStartIdx, closestEndIdx + 1);
  
  // Calculate total distance along the track for this sector
  let actualDistKm = 0;
  let calculatedAscent = 0;
  let powerSum = 0;
  let powerCount = 0;

  for (let i = 1; i < effortPoints.length; i++) {
    const p1 = effortPoints[i - 1];
    const p2 = effortPoints[i];
    actualDistKm += calculateDistance(p1, p2);
    
    if (p2.ele !== undefined && p1.ele !== undefined) {
      const diff = p2.ele - p1.ele;
      if (diff > 0) calculatedAscent += diff;
    }

    if (p2.power !== undefined) {
      powerSum += p2.power;
      powerCount++;
    }
  }

  // Handle segment timing
  const startPt = effortPoints[0];
  const endPt = effortPoints[effortPoints.length - 1];
  let timeInSeconds = 0;

  if (startPt.time && endPt.time) {
    const tStart = new Date(startPt.time).getTime();
    const tEnd = new Date(endPt.time).getTime();
    timeInSeconds = (tEnd - tStart) / 1000;
  }

  // Fallback for tracks without timestamps
  if (timeInSeconds <= 0) {
    timeInSeconds = (actualDistKm / fallbackSpeedKmh) * 3600;
  }

  const avgSpeedKmh = timeInSeconds > 0 ? (actualDistKm / (timeInSeconds / 3600)) : fallbackSpeedKmh;
  
  // Average power
  let avgPower = powerCount > 0 ? Math.round(powerSum / powerCount) : undefined;
  if (avgPower === undefined || avgPower === 0) {
    avgPower = estimatePower(userWeightKg, avgSpeedKmh, calculatedAscent, timeInSeconds);
  }

  return {
    id: `effort-${track.id}-${segment.id}`,
    rank: 0, // Assigned later when placing in leaderboard
    athleteName: `Du (${track.name.replace(/\.[^/.]+$/, "")})`,
    timeInSeconds: Math.round(timeInSeconds),
    avgSpeedKmh: parseFloat(avgSpeedKmh.toFixed(1)),
    avgPower,
    date: startPt.time ? new Date(startPt.time).toLocaleDateString('de-DE') : new Date().toLocaleDateString('de-DE'),
    isUser: true
  };
};

/**
 * Famous cycling segments around the world
 */
export const getFamousSegments = (): Segment[] => {
  return [
    {
      id: 'alpe-dhuez',
      name: 'Alpe d\'Huez (Legendärer Anstieg)',
      startLat: 45.1119,
      startLng: 6.0232,
      endLat: 45.0921,
      endLng: 6.0691,
      distanceMeter: 13800,
      ascentMeter: 1070,
      avgGradient: 7.8,
      leaderboard: [
        { id: 'lh-1', rank: 1, athleteName: 'Marco Pantani (ITA - 1995)', timeInSeconds: 2200, avgPower: 450, avgSpeedKmh: 22.5, date: '16.07.1995' },
        { id: 'lh-2', rank: 2, athleteName: 'Tadej Pogačar (SLO)', timeInSeconds: 2280, avgPower: 440, avgSpeedKmh: 21.8, date: '14.07.2022' },
        { id: 'lh-3', rank: 3, athleteName: 'Lance Armstrong (USA)', timeInSeconds: 2295, avgPower: 435, avgSpeedKmh: 21.6, date: '17.07.2001' },
        { id: 'lh-4', rank: 4, athleteName: 'Jonas Vingegaard (DEN)', timeInSeconds: 2315, avgPower: 428, avgSpeedKmh: 21.4, date: '14.07.2022' },
        { id: 'lh-5', rank: 5, athleteName: 'Geraint Thomas (GBR)', timeInSeconds: 2472, avgPower: 395, avgSpeedKmh: 20.1, date: '19.07.2018' },
        { id: 'lh-6', rank: 6, athleteName: 'Wout van Aert (BEL)', timeInSeconds: 2600, avgPower: 390, avgSpeedKmh: 19.1, date: '14.07.2022' },
        { id: 'lh-7', rank: 7, athleteName: 'Local Legend Jens', timeInSeconds: 3200, avgPower: 290, avgSpeedKmh: 15.5, date: '15.08.2025' }
      ]
    },
    {
      id: 'sa-calobra',
      name: 'Sa Calobra - Coll dels Reis (Mallorca)',
      startLat: 39.8458,
      startLng: 2.7607,
      endLat: 39.8315,
      endLng: 2.7937,
      distanceMeter: 9400,
      ascentMeter: 670,
      avgGradient: 7.1,
      leaderboard: [
        { id: 'sc-1', rank: 1, athleteName: 'Tom Pidcock (GBR)', timeInSeconds: 1345, avgPower: 430, avgSpeedKmh: 25.2, date: '14.12.2023' },
        { id: 'sc-2', rank: 2, athleteName: 'Remco Evenepoel (BEL)', timeInSeconds: 1370, avgPower: 425, avgSpeedKmh: 24.7, date: '18.01.2024' },
        { id: 'sc-3', rank: 3, athleteName: 'Mathieu van der Poel (NED)', timeInSeconds: 1420, avgPower: 410, avgSpeedKmh: 23.8, date: '21.01.2024' },
        { id: 'sc-4', rank: 4, athleteName: 'Bradley Wiggins (GBR)', timeInSeconds: 1475, avgPower: 390, avgSpeedKmh: 22.9, date: '05.04.2012' },
        { id: 'sc-5', rank: 5, athleteName: 'Christian (Club-Fahrer Oberland)', timeInSeconds: 1950, avgPower: 280, avgSpeedKmh: 17.4, date: '02.05.2025' }
      ]
    },
    {
      id: 'kesselberg',
      name: 'Kesselberg Passhöhe (Kochelsee ➔ Walchensee)',
      startLat: 47.6253,
      startLng: 11.3653,
      endLat: 47.6272,
      endLng: 11.3524,
      distanceMeter: 4800,
      ascentMeter: 240,
      avgGradient: 5.0,
      leaderboard: [
        { id: 'kb-1', rank: 1, athleteName: 'Emanuel Buchmann (GER)', timeInSeconds: 610, avgPower: 420, avgSpeedKmh: 28.3, date: '24.06.2020' },
        { id: 'kb-2', rank: 2, athleteName: 'Simon Geschke (GER)', timeInSeconds: 642, avgPower: 400, avgSpeedKmh: 26.9, date: '12.05.2021' },
        { id: 'kb-3', rank: 3, athleteName: 'Marcus Burghardt (GER)', timeInSeconds: 675, avgPower: 395, avgSpeedKmh: 25.6, date: '11.08.2019' },
        { id: 'kb-4', rank: 4, athleteName: 'Münchner Mountain-Flyer', timeInSeconds: 840, avgPower: 310, avgSpeedKmh: 20.6, date: '18.09.2025' },
        { id: 'kb-5', rank: 5, athleteName: 'Stadtradeln-König Bayern', timeInSeconds: 980, avgPower: 260, avgSpeedKmh: 17.6, date: '04.07.2025' }
      ]
    }
  ];
};

/**
 * Dynamically extract climbing or high-intensity segments from a track to act as custom segments.
 */
export const extractSegmentsFromTrack = (track: GPXTrack): Segment[] => {
  const segments: Segment[] = [];
  if (!track.points || track.points.length < 50) return [];

  // 1. Check existing climbs
  if (track.climbs && track.climbs.length > 0) {
    track.climbs.forEach((climb, index) => {
      const pStart = track.points[climb.startIndex];
      const pEnd = track.points[climb.endIndex];
      
      segments.push({
        id: `auto-climb-${track.id}-${index}`,
        name: `🔥 Bergsegment #${index + 1}: ${track.name.replace(/\.[^/.]+$/, "")}`,
        startLat: pStart.lat,
        startLng: pStart.lng,
        endLat: pEnd.lat,
        endLng: pEnd.lng,
        distanceMeter: Math.round(climb.distance),
        ascentMeter: Math.round(climb.ascent),
        avgGradient: parseFloat(climb.avgGradient.toFixed(1)),
        leaderboard: generateProLeaderboard(climb.distance, climb.ascent)
      });
    });
  }

  // 2. Fallback or addition: Sprint segments (flat 1.5km sections in first and last third)
  if (segments.length < 2 && track.points.length > 200) {
    const startIdx = Math.floor(track.points.length * 0.2);
    const endIdx = startIdx + 80; // around 1-2km depending on rate
    
    const pStart = track.points[startIdx];
    const pEnd = track.points[endIdx];

    let distMeter = 0;
    let ascent = 0;
    for (let i = startIdx + 1; i <= endIdx; i++) {
      distMeter += calculateDistance(track.points[i - 1], track.points[i]) * 1000;
      const hDiff = (track.points[i].ele || 0) - (track.points[i - 1].ele || 0);
      if (hDiff > 0) ascent += hDiff;
    }

    segments.push({
      id: `auto-sprint-${track.id}`,
      name: `⚡ Power Sprint Zone: ${track.name.replace(/\.[^/.]+$/, "")}`,
      startLat: pStart.lat,
      startLng: pStart.lng,
      endLat: pEnd.lat,
      endLng: pEnd.lng,
      distanceMeter: Math.round(distMeter),
      ascentMeter: Math.round(ascent),
      avgGradient: parseFloat(((ascent / distMeter) * 100).toFixed(1)),
      leaderboard: generateProLeaderboard(distMeter, ascent, true)
    });
  }

  return segments;
};

/**
 * Generate a realistic leaderboard with pro riders and local legends for a specific distance & slope
 */
export const generateProLeaderboard = (
  distanceMeter: number,
  ascentMeter: number,
  isSprint: boolean = false
): LeaderboardEntry[] => {
  const proRiders = [
    { name: 'Tadej Pogačar (SLO)', climbingFactor: 0.9, flatFactor: 0.92 },
    { name: 'Jonas Vingegaard (DEN)', climbingFactor: 0.91, flatFactor: 0.95 },
    { name: 'Mathieu van der Poel (NED)', climbingFactor: 1.05, flatFactor: 0.8 },
    { name: 'Wout van Aert (BEL)', climbingFactor: 1.02, flatFactor: 0.82 },
    { name: 'Remco Evenepoel (BEL)', climbingFactor: 0.94, flatFactor: 0.85 },
    { name: 'Sepp Kuss (USA)', climbingFactor: 0.92, flatFactor: 1.15 },
    { name: 'Local Legend Tom', climbingFactor: 1.25, flatFactor: 1.1 },
    { name: 'Radgott aus Garmisch', climbingFactor: 1.4, flatFactor: 1.25 }
  ];

  // Baseline time estimation in seconds:
  // Flat rolling speed = 42 km/h (sprint is faster, e.g. 52 km/h)
  // Climbing speed decreases with slope (power of approx 6W/kg)
  const baseSpeedKmh = isSprint ? 50 : 36;
  let baseTime = (distanceMeter / 1000 / baseSpeedKmh) * 3600;

  // Add gravity impact: Vam (Vertical Ascent Speed) of about 1400-1600m/hour for pro climbs
  if (ascentMeter > 30) {
    const verticalTimeSecs = (ascentMeter / 1500) * 3600; // 1500m per hour
    baseTime += verticalTimeSecs;
  }

  const entries: LeaderboardEntry[] = proRiders.map((pro, index) => {
    const speedFactor = isSprint ? pro.flatFactor : pro.climbingFactor;
    // adding some random variation (+- 3%)
    const variation = 0.97 + Math.random() * 0.06;
    const finalTime = Math.max(10, Math.round(baseTime * speedFactor * variation));
    
    const finalDistKm = distanceMeter / 1000;
    const avgSpeed = finalTime > 0 ? (finalDistKm / (finalTime / 3600)) : baseSpeedKmh;
    
    // Estimate power based on pro scale
    const pGravity = (70 + 8.5) * 9.81 * (ascentMeter / finalTime);
    const pAir = 0.5 * 0.3 * 1.2 * Math.pow(avgSpeed / 3.6, 3);
    const estPower = Math.round(Math.max(120, pGravity + pAir + 15));

    return {
      id: `pro-effort-${index}-${Math.random().toString(36).substring(4, 8)}`,
      rank: 0,
      athleteName: pro.name,
      timeInSeconds: finalTime,
      avgSpeedKmh: parseFloat(avgSpeed.toFixed(1)),
      avgPower: estPower,
      date: new Date(Date.now() - (index + 1) * 2 * 24 * 60 * 60 * 1000).toLocaleDateString('de-DE')
    };
  });

  // Sort and apply rank
  entries.sort((a, b) => a.timeInSeconds - b.timeInSeconds);
  entries.forEach((entry, idx) => {
    entry.rank = idx + 1;
  });

  return entries;
};
