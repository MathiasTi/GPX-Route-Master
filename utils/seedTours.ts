import fs from 'fs';
import path from 'path';
import { GPXTrack, GPXPoint } from '../types';
import { 
  calculateElevationStats, 
  calculateSurfaceStatsFromPoints, 
  findClimbs, 
  hydratePointsWithSurface,
  calculatePowerStats,
  interpolateMissingElevations,
  detectActivityType
} from './gpxUtils';

const STAGE_COLORS = [
  '#2563eb', // Stage 1: Blue
  '#0284c7', // Stage 2: Sky Blue
  '#0d9488', // Stage 3: Teal
  '#16a34a', // Stage 4: Green
  '#d97706', // Stage 5: Amber
  '#ea580c', // Stage 6: Orange
  '#dc2626', // Stage 7: Red
  '#7c3aed', // Extra: Purple
];

/**
 * Robust server-side XML extractor for GPX files (Node.js compatible, zero browser DOM dependency)
 */
export function parseGpxXmlString(xmlContent: string, fileName: string): GPXTrack | null {
  try {
    // 1. Extract Track Name
    let name = '';
    const trkNameMatch = xmlContent.match(/<trk>[\s\S]*?<name>([^<]+)<\/name>/i);
    if (trkNameMatch && trkNameMatch[1]) {
      name = trkNameMatch[1].trim();
    } else {
      const metaNameMatch = xmlContent.match(/<metadata>[\s\S]*?<name>([^<]+)<\/name>/i);
      if (metaNameMatch && metaNameMatch[1]) {
        name = metaNameMatch[1].trim();
      } else {
        name = fileName.replace(/\.gpx$/i, '').replace(/^[0-9_-]+/, '').trim() || fileName;
      }
    }

    // 2. Extract Description & Activity Type
    let description = '';
    const descMatch = xmlContent.match(/<desc>([^<]+)<\/desc>/i);
    if (descMatch && descMatch[1]) {
      description = descMatch[1].trim();
    }

    let activityTypeRaw = '';
    const typeMatch = xmlContent.match(/<type>([^<]+)<\/type>/i);
    if (typeMatch && typeMatch[1]) {
      activityTypeRaw = typeMatch[1].trim();
    }

    // 3. Extract Track Points
    // CRITICAL: Standalone waypoints (<wpt>) are points of interest (cafés, passes, viewpoints)
    // and MUST NOT be prepended as track points. Only use <trkpt> (or <rtept> for routes).
    let ptRegex = /<trkpt\s+([^>]+?)(?:>([\s\S]*?)<\/trkpt>|\/>)/gi;
    if (!xmlContent.match(/<trkpt/i)) {
      ptRegex = /<rtept\s+([^>]+?)(?:>([\s\S]*?)<\/rtept>|\/>)/gi;
      if (!xmlContent.match(/<rtept/i)) {
        ptRegex = /<wpt\s+([^>]+?)(?:>([\s\S]*?)<\/wpt>|\/>)/gi;
      }
    }

    const points: GPXPoint[] = [];
    let ptMatch: RegExpExecArray | null;
    while ((ptMatch = ptRegex.exec(xmlContent)) !== null) {
      const attrStr = ptMatch[1];
      const innerXml = ptMatch[2] || '';

      const latMatch = attrStr.match(/lat=["']([0-9.-]+)["']/i);
      const lonMatch = attrStr.match(/(?:lon|lng)=["']([0-9.-]+)["']/i);

      if (!latMatch || !lonMatch) continue;

      const lat = parseFloat(latMatch[1]);
      const lng = parseFloat(lonMatch[1]);

      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        continue;
      }

      // Elevation
      let ele: number | undefined = undefined;
      const eleMatch = innerXml.match(/<ele>([0-9.-]+)<\/ele>/i);
      if (eleMatch && eleMatch[1]) {
        const parsedEle = parseFloat(eleMatch[1]);
        if (!isNaN(parsedEle)) {
          ele = parseFloat(parsedEle.toFixed(1));
        }
      }

      // Time
      let time: Date | undefined = undefined;
      const timeMatch = innerXml.match(/<time>([^<]+)<\/time>/i);
      if (timeMatch && timeMatch[1]) {
        const d = new Date(timeMatch[1].trim());
        if (!isNaN(d.getTime())) {
          time = d;
        }
      }

      // Heart Rate
      let hr: number | undefined = undefined;
      const hrMatch = innerXml.match(/<(?:gpxtpx:hr|hr)>([0-9]+)<\/(?:gpxtpx:hr|hr)>/i);
      if (hrMatch && hrMatch[1]) {
        const parsedHr = parseInt(hrMatch[1], 10);
        if (!isNaN(parsedHr) && parsedHr > 30 && parsedHr < 240) {
          hr = parsedHr;
        }
      }

      // Power
      let power: number | undefined = undefined;
      const powerMatch = innerXml.match(/<(?:power|watts)>([0-9]+)<\/(?:power|watts)>/i);
      if (powerMatch && powerMatch[1]) {
        const parsedPwr = parseInt(powerMatch[1], 10);
        if (!isNaN(parsedPwr) && parsedPwr >= 0 && parsedPwr < 2500) {
          power = parsedPwr;
        }
      }

      // Cadence
      let cadence: number | undefined = undefined;
      const cadMatch = innerXml.match(/<(?:gpxtpx:cad|cad)>([0-9]+)<\/(?:gpxtpx:cad|cad)>/i);
      if (cadMatch && cadMatch[1]) {
        const parsedCad = parseInt(cadMatch[1], 10);
        if (!isNaN(parsedCad) && parsedCad >= 0 && parsedCad < 250) {
          cadence = parsedCad;
        }
      }

      points.push({
        lat,
        lng,
        ele,
        time,
        hr,
        power,
        cadence
      });
    }

    // Extract any <wpt> into rawRecords so POIs are preserved in file metadata
    const rawRecords: { type: string; data: Record<string, any> }[] = [];
    const wptRegex = /<wpt\s+([^>]+?)>([\s\S]*?)<\/wpt>/gi;
    let wptMatch: RegExpExecArray | null;
    let wptIdx = 1;
    while ((wptMatch = wptRegex.exec(xmlContent)) !== null && wptIdx <= 100) {
      const wAttr = wptMatch[1];
      const wInner = wptMatch[2];
      const latM = wAttr.match(/lat=["']([0-9.-]+)["']/i);
      const lonM = wAttr.match(/(?:lon|lng)=["']([0-9.-]+)["']/i);
      if (latM && lonM) {
        const nameM = wInner.match(/<name>([^<]+)<\/name>/i);
        const eleM = wInner.match(/<ele>([0-9.-]+)<\/ele>/i);
        const descM = wInner.match(/<desc>([^<]+)<\/desc>/i);
        const symM = wInner.match(/<sym>([^<]+)<\/sym>/i);
        rawRecords.push({
          type: 'waypoint',
          data: {
            name: nameM ? nameM[1].trim() : `Wegpunkt #${wptIdx}`,
            lat: latM[1],
            lon: lonM[1],
            ele: eleM ? eleM[1] : undefined,
            desc: descM ? descM[1].trim() : undefined,
            sym: symM ? symM[1].trim() : undefined
          }
        });
        wptIdx++;
      }
    }

    if (points.length < 2) {
      console.warn(`[GPX Parser] File "${fileName}" contained less than 2 valid GPS trackpoints.`);
      return null;
    }

    // 4. Interpolate any missing elevations
    interpolateMissingElevations(points);

    // 5. Calculate elevation & distance metrics
    const stats = calculateElevationStats(points);
    const distanceKm = stats.totalDist;
    const ascentM = stats.ascent;
    const descentM = stats.descent;
    const maxSlope = stats.maxSlope;

    // 6. Calculate Duration
    let durationSec = 0;
    const firstTime = points[0]?.time;
    const lastTime = points[points.length - 1]?.time;
    if (firstTime && lastTime) {
      durationSec = Math.max(0, Math.round((lastTime.getTime() - firstTime.getTime()) / 1000));
    }
    if (durationSec === 0 && distanceKm > 0) {
      // Estimated duration at ~16 km/h avg speed
      durationSec = Math.round((distanceKm / 16) * 3600);
    }

    // 7. Activity Type
    let activityType: 'cycling' | 'running' = 'cycling';
    if (activityTypeRaw) {
      const lower = activityTypeRaw.toLowerCase();
      if (lower.includes('run') || lower.includes('lauf') || lower.includes('hike') || lower.includes('walk')) {
        activityType = 'running';
      } else {
        activityType = 'cycling';
      }
    } else {
      activityType = detectActivityType(points, name, fileName);
    }

    // 8. Surface Profiling
    let surfaceStats = calculateSurfaceStatsFromPoints(points);
    if (surfaceStats.length === 0) {
      // Estimate realistic surface based on stage ascent and filename
      const isAlpPass = name.toLowerCase().includes('pass') || name.toLowerCase().includes('joch') || name.toLowerCase().includes('gavia') || name.toLowerCase().includes('stilfser');
      if (isAlpPass) {
        surfaceStats = [
          { type: 'Asphalt', distance: Math.round(distanceKm * 0.78 * 10) / 10 },
          { type: 'Schotter', distance: Math.round(distanceKm * 0.16 * 10) / 10 },
          { type: 'Waldweg', distance: Math.round(distanceKm * 0.06 * 10) / 10 }
        ];
      } else {
        surfaceStats = [
          { type: 'Asphalt', distance: Math.round(distanceKm * 0.65 * 10) / 10 },
          { type: 'Fahrradweg', distance: Math.round(distanceKm * 0.20 * 10) / 10 },
          { type: 'Schotter', distance: Math.round(distanceKm * 0.15 * 10) / 10 }
        ];
      }
    }
    hydratePointsWithSurface(points, surfaceStats, distanceKm);

    // 9. Climbs & Power Calculations
    const climbs = findClimbs(points);
    const powerStats = calculatePowerStats(points, 250, 75, 15, activityType);

    // 10. Generate clean stage-aware ID and Tags
    const stageMatch = (name + ' ' + fileName).match(/Tag\s*(\d+)/i) || (name + ' ' + fileName).match(/Etappe\s*(\d+)/i);
    const stageNum = stageMatch ? parseInt(stageMatch[1], 10) : 0;
    
    const cleanId = stageNum > 0 
      ? `gpx-alpentour-tag-${stageNum}` 
      : 'gpx-' + fileName.toLowerCase().replace(/\.gpx$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    // Assign consecutive stage dates for stage tour (starting on Aug 14, 2026)
    let dateCreated = '2026-08-14';
    if (stageNum >= 1 && stageNum <= 20) {
      const baseDate = new Date('2026-08-14T08:00:00Z');
      baseDate.setUTCDate(baseDate.getUTCDate() + (stageNum - 1));
      dateCreated = baseDate.toISOString().split('T')[0];
    } else if (firstTime) {
      dateCreated = firstTime.toISOString().split('T')[0];
    }

    // Tags
    const tags = ['Alpentour', 'Transalp'];
    if (stageNum > 0) tags.push(`Etappe ${stageNum}`);
    if (name.includes('München') || fileName.includes('München') || fileName.includes('München')) tags.push('München');
    if (name.includes('Brenner') || fileName.includes('Brenner')) tags.push('Brennerpass');
    if (name.includes('Jaufenpass') || fileName.includes('Jaufenpass')) tags.push('Jaufenpass');
    if (name.includes('Passeier') || fileName.includes('Passeier')) tags.push('Passeier');
    if (name.includes('Stilfser') || fileName.includes('Stilfser')) tags.push('Stilfser Joch');
    if (name.includes('Gavia') || fileName.includes('Gavia')) tags.push('Gaviapass');
    if (name.includes('Tonale') || fileName.includes('Tonale')) tags.push('Tonalepass');
    if (name.includes('Madonna') || fileName.includes('Madonna')) tags.push('Madonna di Campiglio');
    if (name.includes('Gardasee') || name.includes('Torbole') || fileName.includes('Gardasee') || fileName.includes('Torbole')) tags.push('Gardasee', 'Torbole');

    const defaultColor = stageNum > 0 ? STAGE_COLORS[(stageNum - 1) % STAGE_COLORS.length] : STAGE_COLORS[0];

    return {
      id: cleanId,
      name,
      distance: distanceKm,
      ascent: ascentM,
      descent: descentM,
      duration: durationSec,
      activityType,
      description: description || `Original GPX-Tour aus /gpx: ${fileName}`,
      tags,
      dateCreated,
      originalFilename: fileName,
      points,
      powerStats,
      surfaceStats,
      climbs,
      maxSlope,
      color: defaultColor,
      hasTimestamps: points.some(p => p.time !== undefined),
      rawFileDetails: {
        fileType: 'gpx',
        fileName,
        metadata: {
          rawRecords
        }
      },
      visible: true
    };
  } catch (err: any) {
    console.error(`[GPX Parser] Error parsing "${fileName}":`, err.message);
    return null;
  }
}

/**
 * Extracts stage/tag number from filename or track name for natural sequencing
 */
function extractStageNumber(filename: string): number {
  const match = filename.match(/Tag\s*(\d+)/i) || filename.match(/Etappe\s*(\d+)/i) || filename.match(/Stage\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : 999;
}

/**
 * Loads all real GPX files located in the /gpx directory in natural stage order
 */
export function getGpxFolderTours(): GPXTrack[] {
  const gpxDir = path.join(process.cwd(), 'gpx');
  if (!fs.existsSync(gpxDir)) {
    console.warn(`[GPX Loader] Directory "${gpxDir}" does not exist.`);
    return [];
  }

  // Sort files by natural stage sequence (Tag 1, Tag 2, Tag 3, ...)
  const files = fs.readdirSync(gpxDir)
    .filter(f => f.toLowerCase().endsWith('.gpx'))
    .sort((a, b) => {
      const stageA = extractStageNumber(a);
      const stageB = extractStageNumber(b);
      if (stageA !== stageB) return stageA - stageB;
      return a.localeCompare(b, undefined, { numeric: true });
    });

  console.log(`[GPX Loader] Found ${files.length} GPX files in /gpx.`);

  const tracks: GPXTrack[] = [];

  files.forEach((file, index) => {
    try {
      const fullPath = path.join(gpxDir, file);
      const xmlContent = fs.readFileSync(fullPath, 'utf8');
      const track = parseGpxXmlString(xmlContent, file);
      if (track) {
        // Stage-accurate color matching: Tag 1 -> Blue, Tag 2 -> Sky Blue, Tag 3 -> Teal, etc.
        const stageMatch = file.match(/Tag\s*(\d+)/i);
        const stageNum = stageMatch ? parseInt(stageMatch[1], 10) : index + 1;
        track.color = STAGE_COLORS[(stageNum - 1) % STAGE_COLORS.length];
        tracks.push(track);
      }
    } catch (err: any) {
      console.error(`[GPX Loader] Failed to read "${file}":`, err.message);
    }
  });

  return tracks;
}

/**
 * Backward-compatible alias for database seeder
 */
export function getCuratedSeedTours(): GPXTrack[] {
  return getGpxFolderTours();
}
