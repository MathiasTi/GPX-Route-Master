import { GPXPoint, GPXTrack, ValidationIssue, StartPointValidationDetail } from '../types';
import { calculateDistance } from './gpxUtils';

export interface KnownLocation {
  name: string;
  lat: number;
  lng: number;
  type: 'town' | 'pass' | 'trailhead' | 'hub' | 'waypoint';
  aliases: string[];
  toleranceKm: number; // Acceptable radius around the centroid for route starts
}

/**
 * Curated registry of known major town centroids, alpine passes, and route entry hubs.
 * Covers primary Transalp corridors, cycling regions across Germany, Austria, Italy, Switzerland,
 * and key European starting points.
 */
export const KNOWN_CENTROIDS_AND_WAYPOINTS: KnownLocation[] = [
  // --- Bavaria & Germany ---
  { name: 'München', lat: 48.13715, lng: 11.57612, type: 'town', aliases: ['muenchen', 'munich', 'marienplatz', 'karlsplatz', 'stachus'], toleranceKm: 15 },
  { name: 'Holzkirchen', lat: 47.8824, lng: 11.7011, type: 'town', aliases: ['holzkirchen'], toleranceKm: 6 },
  { name: 'Wolfratshausen', lat: 47.9135, lng: 11.4172, type: 'town', aliases: ['wolfratshausen'], toleranceKm: 6 },
  { name: 'Bad Tölz', lat: 47.7607, lng: 11.5583, type: 'town', aliases: ['bad toelz', 'toelz'], toleranceKm: 6 },
  { name: 'Lenggries', lat: 47.6811, lng: 11.5739, type: 'town', aliases: ['lenggries'], toleranceKm: 6 },
  { name: 'Tegernsee', lat: 47.7142, lng: 11.7564, type: 'town', aliases: ['tegernsee', 'rottach-egern'], toleranceKm: 6 },
  { name: 'Wallgau', lat: 47.5217, lng: 11.2819, type: 'town', aliases: ['wallgau'], toleranceKm: 5 },
  { name: 'Krün', lat: 47.5042, lng: 11.2803, type: 'town', aliases: ['kruen'], toleranceKm: 5 },
  { name: 'Mittenwald', lat: 47.4419, lng: 11.2619, type: 'town', aliases: ['mittenwald'], toleranceKm: 5 },
  { name: 'Garmisch-Partenkirchen', lat: 47.4921, lng: 11.0958, type: 'town', aliases: ['garmisch', 'partenkirchen'], toleranceKm: 8 },
  { name: 'Füssen', lat: 47.5696, lng: 10.7004, type: 'town', aliases: ['fuessen'], toleranceKm: 6 },
  { name: 'Oberstdorf', lat: 47.4093, lng: 10.2797, type: 'town', aliases: ['oberstdorf'], toleranceKm: 6 },
  { name: 'Lindau', lat: 47.5463, lng: 9.6843, type: 'town', aliases: ['lindau', 'bodensee'], toleranceKm: 7 },
  { name: 'Augsburg', lat: 48.3705, lng: 10.8978, type: 'town', aliases: ['augsburg'], toleranceKm: 12 },
  { name: 'Rosenheim', lat: 47.8561, lng: 12.1289, type: 'town', aliases: ['rosenheim'], toleranceKm: 8 },

  // --- Austria / Tirol & Vorarlberg ---
  { name: 'Scharnitz', lat: 47.3886, lng: 11.2647, type: 'town', aliases: ['scharnitz', 'porta claudia'], toleranceKm: 5 },
  { name: 'Seefeld in Tirol', lat: 47.3297, lng: 11.1883, type: 'town', aliases: ['seefeld'], toleranceKm: 5 },
  { name: 'Innsbruck', lat: 47.2692, lng: 11.4041, type: 'town', aliases: ['innsbruck', 'goldenes dachl'], toleranceKm: 10 },
  { name: 'Hall in Tirol', lat: 47.2814, lng: 11.5072, type: 'town', aliases: ['hall'], toleranceKm: 5 },
  { name: 'Matrei am Brenner', lat: 47.1306, lng: 11.4542, type: 'town', aliases: ['matrei'], toleranceKm: 5 },
  { name: 'Steinach am Brenner', lat: 47.0919, lng: 11.4678, type: 'town', aliases: ['steinach'], toleranceKm: 5 },
  { name: 'Gries am Brenner', lat: 47.0381, lng: 11.4819, type: 'town', aliases: ['gries'], toleranceKm: 5 },
  { name: 'Sattelbergalm (Brennerpass)', lat: 47.0190, lng: 11.4920, type: 'pass', aliases: ['sattelbergalm', 'sattelberg'], toleranceKm: 4 },
  { name: 'Brennerpass', lat: 47.0067, lng: 11.5056, type: 'pass', aliases: ['brenner', 'passo del brennero'], toleranceKm: 5 },
  { name: 'Landeck', lat: 47.1397, lng: 10.5656, type: 'town', aliases: ['landeck', 'zams'], toleranceKm: 6 },
  { name: 'St. Anton am Arlberg', lat: 47.1306, lng: 10.2689, type: 'town', aliases: ['st. anton', 'st anton', 'arlberg'], toleranceKm: 6 },
  { name: 'Ischgl', lat: 47.0119, lng: 10.2917, type: 'town', aliases: ['ischgl', 'paznaun'], toleranceKm: 5 },
  { name: 'Nauders', lat: 46.8928, lng: 10.5039, type: 'town', aliases: ['nauders', 'reschen'], toleranceKm: 5 },
  { name: 'Sölden', lat: 46.9689, lng: 11.0078, type: 'town', aliases: ['soelden', 'oetztal'], toleranceKm: 6 },
  { name: 'Kitzbühel', lat: 47.4464, lng: 12.3922, type: 'town', aliases: ['kitzbuehel'], toleranceKm: 6 },
  { name: 'Salzburg', lat: 47.8095, lng: 13.0550, type: 'town', aliases: ['salzburg'], toleranceKm: 10 },
  { name: 'Bregenz', lat: 47.5031, lng: 9.7471, type: 'town', aliases: ['bregenz'], toleranceKm: 7 },

  // --- South Tyrol / Trentino / Northern Italy ---
  { name: 'Sterzing', lat: 46.8986, lng: 11.4318, type: 'town', aliases: ['sterzing', 'vipiteno'], toleranceKm: 6 },
  { name: 'Jaufenpass', lat: 46.8400, lng: 11.3200, type: 'pass', aliases: ['jaufenpass', 'passo monte giovo', 'jaufen'], toleranceKm: 4 },
  { name: 'St. Leonhard in Passeier', lat: 46.8119, lng: 11.2458, type: 'town', aliases: ['st. leonhard', 'st leonhard', 'san leonardo in passiria', 'passeier'], toleranceKm: 5 },
  { name: 'Moos in Passeier', lat: 46.8319, lng: 11.1681, type: 'town', aliases: ['moos in passeier', 'moso in passiria'], toleranceKm: 5 },
  { name: 'Meran', lat: 46.6713, lng: 11.1595, type: 'town', aliases: ['meran', 'merano'], toleranceKm: 7 },
  { name: 'Bozen', lat: 46.4983, lng: 11.3548, type: 'town', aliases: ['bozen', 'bolzano'], toleranceKm: 8 },
  { name: 'Brixen', lat: 46.7153, lng: 11.6561, type: 'town', aliases: ['brixen', 'bressanone'], toleranceKm: 6 },
  { name: 'Schlanders', lat: 46.6289, lng: 10.7744, type: 'town', aliases: ['schlanders', 'silandro', 'vinschgau'], toleranceKm: 5 },
  { name: 'Prad am Stilfserjoch', lat: 46.6178, lng: 10.5925, type: 'town', aliases: ['prad am stilfserjoch', 'prad', 'prato allo stelvio'], toleranceKm: 5 },
  { name: 'Glurns', lat: 46.6711, lng: 10.5539, type: 'town', aliases: ['glurns', 'glornoza'], toleranceKm: 4 },
  { name: 'Mals', lat: 46.6881, lng: 10.5458, type: 'town', aliases: ['mals', 'malles venosta'], toleranceKm: 5 },
  { name: 'Stilfser Joch', lat: 46.5286, lng: 10.4531, type: 'pass', aliases: ['stilfser joch', 'stilfserjoch', 'passo dello stelvio', 'stelvio'], toleranceKm: 4 },
  { name: 'Bormio', lat: 46.4685, lng: 10.3725, type: 'town', aliases: ['bormio'], toleranceKm: 5 },
  { name: 'Santa Caterina Valfurva', lat: 46.4132, lng: 10.4938, type: 'town', aliases: ['santa caterina', 'santa catarina', 'valfurva'], toleranceKm: 5 },
  { name: 'Gaviapass', lat: 46.3464, lng: 10.4883, type: 'pass', aliases: ['gaviapass', 'passo di gavia', 'gavia'], toleranceKm: 4 },
  { name: 'Ponte di Legno', lat: 46.2589, lng: 10.5106, type: 'town', aliases: ['ponte di legno'], toleranceKm: 5 },
  { name: 'Tonalepass', lat: 46.2608, lng: 10.5847, type: 'pass', aliases: ['tonalepass', 'passo del tonale', 'tonale'], toleranceKm: 4 },
  { name: 'Dimaro', lat: 46.3267, lng: 10.8711, type: 'town', aliases: ['dimaro', 'val di sole'], toleranceKm: 5 },
  { name: 'Madonna di Campiglio', lat: 46.2294, lng: 10.8268, type: 'town', aliases: ['madonna di campiglio', 'campiglio', 'pinzolo'], toleranceKm: 6 },
  { name: 'Tione di Trento', lat: 46.0347, lng: 10.7289, type: 'town', aliases: ['tione di trento', 'tione'], toleranceKm: 5 },
  { name: 'Arco', lat: 45.9177, lng: 10.8867, type: 'town', aliases: ['arco'], toleranceKm: 5 },
  { name: 'Riva del Garda', lat: 45.8858, lng: 10.8413, type: 'town', aliases: ['riva del garda', 'riva'], toleranceKm: 6 },
  { name: 'Nago-Torbole (Gardasee)', lat: 45.8744, lng: 10.8737, type: 'town', aliases: ['torbole', 'nago-torbole', 'gardasee', 'lago di garda'], toleranceKm: 6 },
  { name: 'Rovereto', lat: 45.8906, lng: 11.0406, type: 'town', aliases: ['rovereto'], toleranceKm: 6 },
  { name: 'Trient / Trento', lat: 46.0679, lng: 11.1211, type: 'town', aliases: ['trento', 'trient'], toleranceKm: 8 },
  { name: 'Verona', lat: 45.4384, lng: 10.9916, type: 'town', aliases: ['verona'], toleranceKm: 12 },

  // --- Switzerland & Western Alps ---
  { name: 'Chur', lat: 46.8508, lng: 9.5319, type: 'town', aliases: ['chur'], toleranceKm: 7 },
  { name: 'Davos', lat: 46.8027, lng: 9.8359, type: 'town', aliases: ['davos'], toleranceKm: 6 },
  { name: 'St. Moritz', lat: 46.4908, lng: 9.8355, type: 'town', aliases: ['st. moritz', 'st moritz', 'engadin'], toleranceKm: 6 },
  { name: 'Livigno', lat: 46.5386, lng: 10.1357, type: 'town', aliases: ['livigno'], toleranceKm: 6 },
  { name: 'Zürich', lat: 47.3769, lng: 8.5417, type: 'town', aliases: ['zuerich', 'zurich'], toleranceKm: 14 }
];

export interface ExpectedRouteEntryPoint {
  name: string;
  coord: { lat: number; lng: number };
  source: 'title' | 'filename' | 'waypoint' | 'description';
  toleranceKm: number;
}

/**
 * Normalizes text for reliable matching against known locations.
 */
function normalizeName(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Attempts to parse the intended starting point from track metadata:
 * - Route title (e.g. "Alpentour Tag 1: von München nach Wallgau" -> "München")
 * - Original filename (e.g. "2026_von_Muenchen_nach_Wallgau.gpx")
 * - Embedded GPX waypoints labeled as start, trailhead, or meeting point
 */
export function extractExpectedRouteEntryPoint(track: GPXTrack): ExpectedRouteEntryPoint | null {
  // 1. Check embedded GPX waypoints for explicit start labels
  const rawRecords = track.rawFileDetails?.metadata?.rawRecords || [];
  for (const record of rawRecords) {
    if (record.type === 'waypoint' && record.data) {
      const wName = String(record.data.name || '').trim();
      const normWName = normalizeName(wName);
      const isStartLabel = normWName.includes('start') || 
                           normWName.includes('beginn') || 
                           normWName.includes('abfahrt') || 
                           normWName.includes('trailhead') || 
                           normWName.includes('einstieg');

      const lat = parseFloat(String(record.data.lat));
      const lng = parseFloat(String(record.data.lon || record.data.lng));

      if (isStartLabel && !isNaN(lat) && !isNaN(lng)) {
        return {
          name: wName,
          coord: { lat, lng },
          source: 'waypoint',
          toleranceKm: 6
        };
      }
    }
  }

  // 2. Extract potential starting location from track name or filename
  const candidatesToSearch = [
    track.name || '',
    track.originalFilename || '',
    track.description || ''
  ];

  for (const candidate of candidatesToSearch) {
    if (!candidate) continue;

    // Pattern A: "von [Startort] nach [Zielort]"
    const matchVonNach = candidate.match(/(?:von|from)\s+([A-Za-zÄÖÜäöüß\s.-]+?)(?:\s+(?:nach|to|über|via|bis)\s+)/i);
    // Pattern B: "[Startort] - [Zielort]" or "[Startort] – [Zielort]"
    const matchHyphen = candidate.match(/([A-Za-zÄÖÜäöüß\s.-]{3,30}?)\s*(?:[-–—]|\sto\s)\s*([A-Za-zÄÖÜäöüß\s.-]{3,30})/i);
    // Pattern C: "Etappe \d+: (?:von )?([A-Za-zÄÖÜäöüß\s.-]+?)(?:\s+(?:nach|über|bis)\s+)"
    const matchEtappe = candidate.match(/Etappe\s*\d+:\s*(?:von\s+)?([A-Za-zÄÖÜäöüß\s.-]+?)(?:\s+(?:nach|über|bis)\s+)/i);

    const extractedText = (matchVonNach && matchVonNach[1]) || 
                          (matchEtappe && matchEtappe[1]) || 
                          (matchHyphen && matchHyphen[1]);

    if (extractedText) {
      const normExtracted = normalizeName(extractedText);

      // Match against known locations
      for (const loc of KNOWN_CENTROIDS_AND_WAYPOINTS) {
        const normLocName = normalizeName(loc.name);
        if (normExtracted.includes(normLocName) || loc.aliases.some(a => normExtracted.includes(normalizeName(a)))) {
          return {
            name: loc.name,
            coord: { lat: loc.lat, lng: loc.lng },
            source: 'title',
            toleranceKm: loc.toleranceKm
          };
        }
      }
    }

    // Direct substring scan in candidate for known centroids
    const normCandidate = normalizeName(candidate);
    for (const loc of KNOWN_CENTROIDS_AND_WAYPOINTS) {
      const normLocName = normalizeName(loc.name);
      // Ensure isolated word match to avoid accidental substring matches
      const wordRegex = new RegExp(`\\b${normLocName}\\b`, 'i');
      if (wordRegex.test(normCandidate)) {
        // If the title also has "nach [Ort]", ensure we only match if this loc appears before "nach"
        const nachIndex = candidate.toLowerCase().indexOf('nach');
        const locIndex = candidate.toLowerCase().indexOf(loc.name.toLowerCase());
        if (nachIndex === -1 || (locIndex !== -1 && locIndex < nachIndex)) {
          return {
            name: loc.name,
            coord: { lat: loc.lat, lng: loc.lng },
            source: 'title',
            toleranceKm: loc.toleranceKm
          };
        }
      }
    }
  }

  return null;
}

/**
 * Finds the closest known town centroid or route entry point for any arbitrary GPS coordinate.
 */
export function findNearestCentroid(point: { lat: number; lng: number }): {
  centroid: KnownLocation;
  distanceKm: number;
} {
  let minDistance = Infinity;
  let nearest = KNOWN_CENTROIDS_AND_WAYPOINTS[0];

  for (const loc of KNOWN_CENTROIDS_AND_WAYPOINTS) {
    const dist = calculateDistance(point, loc);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = loc;
    }
  }

  return {
    centroid: nearest,
    distanceKm: parseFloat(minDistance.toFixed(2))
  };
}

export interface StartPointValidationResult {
  detail: StartPointValidationDetail;
  issue: ValidationIssue | null;
  severity: 'clean' | 'info' | 'warning' | 'error';
}

/**
 * Automated validation check that compares the distance between the first track point
 * and the closest known major waypoint or town centroid, providing an alert if the start
 * point deviates significantly from expected route entry points.
 */
export function validateTrackStartPoint(track: GPXTrack): StartPointValidationResult {
  const points = track.points || [];
  
  // Filter for valid coordinates
  const validPoints = points.filter(p => 
    p && !isNaN(p.lat) && !isNaN(p.lng) && 
    Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && 
    !(Math.abs(p.lat) < 0.0001 && Math.abs(p.lng) < 0.0001)
  );

  if (validPoints.length === 0) {
    return {
      detail: {
        firstPoint: { lat: 0, lng: 0 },
        nearestCentroidName: 'Unbekannt',
        distanceToNearestCentroidKm: 0,
        isSignificantDeviation: false,
        deviationReason: 'Keine gültigen Trackpunkte vorhanden'
      },
      issue: null,
      severity: 'clean'
    };
  }

  const p0 = validPoints[0];
  const p1 = validPoints.length > 1 ? validPoints[1] : null;

  // 1. Determine nearest general centroid
  const nearestResult = findNearestCentroid(p0);
  const nearestCentroid = nearestResult.centroid;
  const distToNearestKm = nearestResult.distanceKm;

  // 2. Determine expected entry point from title, metadata, or explicit start waypoints
  const expectedEntryPoint = extractExpectedRouteEntryPoint(track);

  // 3. Evaluate first-step teleportation jump (e.g. distant waypoint artifact at index 0)
  const firstStepJumpKm = p1 ? parseFloat(calculateDistance(p0, p1).toFixed(2)) : 0;

  let isSignificantDeviation = false;
  let severity: 'clean' | 'info' | 'warning' | 'error' = 'clean';
  let deviationReason = '';
  let suggestedFixStartIndex: number | undefined = undefined;

  // SCENARIO A: Expected route entry point identified (e.g. "von München nach Wallgau")
  if (expectedEntryPoint) {
    const distToExpectedKm = parseFloat(calculateDistance(p0, expectedEntryPoint.coord).toFixed(2));

    if (distToExpectedKm > expectedEntryPoint.toleranceKm) {
      isSignificantDeviation = true;
      severity = distToExpectedKm > 30 ? 'error' : 'warning';
      deviationReason = `Startpunkt liegt ${distToExpectedKm} km vom erwarteten Einstiegsort '${expectedEntryPoint.name}' entfernt (zulässige Toleranz: ${expectedEntryPoint.toleranceKm} km).`;

      // Check if point 1 jumps much closer to the expected entry point (classic waypoint artifact!)
      if (p1) {
        const p1DistToExpected = calculateDistance(p1, expectedEntryPoint.coord);
        if (p1DistToExpected <= expectedEntryPoint.toleranceKm && firstStepJumpKm > 10) {
          suggestedFixStartIndex = 1;
          deviationReason += ` Der nächste Punkt (Index 1) befindet sich bereits im erwarteten Einstiegsgebiet (${p1DistToExpected.toFixed(1)} km). Punkt 0 ist vermutlich ein isolierter Wegpunkt-Ausreißer.`;
        }
      }
    } else {
      severity = 'clean';
      deviationReason = `Startpunkt liegt plausibel im Einstiegsbereich von '${expectedEntryPoint.name}' (${distToExpectedKm} km Abstand).`;
    }

    const detail: StartPointValidationDetail = {
      firstPoint: { lat: p0.lat, lng: p0.lng, ele: p0.ele },
      nearestCentroidName: nearestCentroid.name,
      distanceToNearestCentroidKm: distToNearestKm,
      nearestCentroidType: nearestCentroid.type,
      expectedLocationName: expectedEntryPoint.name,
      expectedLocationCoord: expectedEntryPoint.coord,
      distanceToExpectedKm: distToExpectedKm,
      isSignificantDeviation,
      firstStepJumpKm,
      deviationReason,
      suggestedFixStartIndex
    };

    let issue: ValidationIssue | null = null;
    if (isSignificantDeviation) {
      const issueSeverity: 'info' | 'warning' | 'error' = severity === 'clean' ? 'warning' : severity;
      issue = {
        id: 'issue-start-point-deviation',
        type: 'start_point_deviation',
        severity: issueSeverity,
        title: `Startpunkt weicht von '${expectedEntryPoint.name}' ab`,
        description: deviationReason,
        affectedCount: suggestedFixStartIndex !== undefined ? 1 : 0,
        affectedIndices: suggestedFixStartIndex !== undefined ? [0] : undefined,
        autoFixable: suggestedFixStartIndex !== undefined,
        fixDescription: suggestedFixStartIndex !== undefined
          ? `Entfernt den isolierten Vorlaufpunkt (Index 0), sodass die Route direkt in '${expectedEntryPoint.name}' beginnt.`
          : undefined
      };
    }

    return { detail, issue, severity };
  }

  // SCENARIO B: No explicit entry name found, but point 0 exhibits an anomalous first-step jump
  if (firstStepJumpKm > 15 && p1) {
    const p1Nearest = findNearestCentroid(p1);
    isSignificantDeviation = true;
    severity = firstStepJumpKm > 30 ? 'error' : 'warning';
    suggestedFixStartIndex = 1;
    deviationReason = `Extremer Sprung am Streckenstart: Punkt 0 liegt ${firstStepJumpKm} km von Punkt 1 entfernt (${p1Nearest.centroid.name}). Vermutlich handelt es sich um einen vorangestellten Wegpunkt.`;

    const detail: StartPointValidationDetail = {
      firstPoint: { lat: p0.lat, lng: p0.lng, ele: p0.ele },
      nearestCentroidName: nearestCentroid.name,
      distanceToNearestCentroidKm: distToNearestKm,
      nearestCentroidType: nearestCentroid.type,
      isSignificantDeviation,
      firstStepJumpKm,
      deviationReason,
      suggestedFixStartIndex
    };

    const issue: ValidationIssue = {
      id: 'issue-start-point-deviation',
      type: 'start_point_deviation',
      severity,
      title: 'Anomaler Distanzsprung am Startpunkt',
      description: deviationReason,
      affectedCount: 1,
      affectedIndices: [0],
      autoFixable: true,
      fixDescription: `Entfernt den isolierten Ausreißer an Punkt 0 und setzt den Start auf Punkt 1 (${p1Nearest.centroid.name}).`
    };

    return { detail, issue, severity };
  }

  // SCENARIO C: Routine check against closest known town centroid
  // If track starts > 35 km away from ANY known route hub/town centroid
  if (distToNearestKm > 40) {
    isSignificantDeviation = true;
    severity = 'info';
    deviationReason = `Startpunkt liegt ${distToNearestKm} km von der nächsten bekannten Ortschaft ('${nearestCentroid.name}') entfernt.`;

    const detail: StartPointValidationDetail = {
      firstPoint: { lat: p0.lat, lng: p0.lng, ele: p0.ele },
      nearestCentroidName: nearestCentroid.name,
      distanceToNearestCentroidKm: distToNearestKm,
      nearestCentroidType: nearestCentroid.type,
      isSignificantDeviation: false, // Informational only, not a blocking error
      firstStepJumpKm,
      deviationReason
    };

    return { detail, issue: null, severity: 'clean' };
  }

  // Default: Plausible start point
  const detail: StartPointValidationDetail = {
    firstPoint: { lat: p0.lat, lng: p0.lng, ele: p0.ele },
    nearestCentroidName: nearestCentroid.name,
    distanceToNearestCentroidKm: distToNearestKm,
    nearestCentroidType: nearestCentroid.type,
    isSignificantDeviation: false,
    firstStepJumpKm,
    deviationReason: `Startpunkt liegt ${distToNearestKm} km von '${nearestCentroid.name}' (${nearestCentroid.type}) entfernt.`
  };

  return { detail, issue: null, severity: 'clean' };
}
