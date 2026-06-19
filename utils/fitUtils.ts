
import { GPXPoint, GPXTrack } from '../types';
import { calculateElevationStats, calculatePowerStats, generateMockSurfaceStats, getLocationName, detectActivityType, findClimbs } from './gpxUtils';
import { fit2json, parseRecords } from 'fit-decoder';

const HIGH_CONTRAST_COLORS = [
  '#FF00FF', // Magenta
  '#FF4500', // Orange Red
  '#FFD700', // Gold
  '#00FFFF', // Cyan
  '#FF1493', // Deep Pink
  '#8A2BE2', // Blue Violet
  '#FF0000', // Red
  '#00FF00', // Lime
];

let colorIndex = 0;

export const parseFIT = async (arrayBuffer: ArrayBuffer, fileName: string): Promise<GPXTrack | null> => {
  try {
    const fitRaw = fit2json(arrayBuffer);
    const fitData = parseRecords(fitRaw);
    
    if (!fitData || !fitData.records || fitData.records.length === 0) {
      console.error("FIT parsing error: No records found");
      return null;
    }

    const points: GPXPoint[] = fitData.records
      .filter((record: any) => record.type === 'record' && record.data.position_lat !== undefined && record.data.position_long !== undefined)
      .map((record: any) => {
        let lat = record.data.position_lat;
        let lng = record.data.position_long;
        
        // Convert semicircles to degrees if necessary
        // 1 semicircle = 180 / 2^31 degrees
        if (Math.abs(lat) > 180) lat = lat * (180 / Math.pow(2, 31));
        if (Math.abs(lng) > 180) lng = lng * (180 / Math.pow(2, 31));

        // Check for invalid coordinates (0x7FFFFFFF converted to degrees is ~180)
        if (Math.abs(lat - 180) < 0.0001 || Math.abs(lng - 180) < 0.0001) {
          return null;
        }

        let ele = record.data.enhanced_altitude;
        if (ele === undefined) ele = record.data.altitude;
        
        // fit-decoder usually applies scale and offset correctly.
        if (ele !== undefined && !isNaN(ele)) {
          // Check for FIT invalid values (if not handled by decoder)
          if (ele === 65535 || ele === 4294967295 || Math.abs(ele - 655.35) < 0.01 || Math.abs(ele - 42949672.95) < 0.01) {
            ele = undefined;
          } else {
            // Apply standard FIT scaling correction: fit-decoder returns ele divided by 100
            // Standard FIT altitude uses scale of 5 and offset of 500 (value = (meters + 500) * 5)
            // So meters = (ele_reported * 100) / 5 - 500 = ele_reported * 20 - 500
            ele = ele * 20 - 500;
          }
        } else {
          ele = undefined;
        }
        
        const time = record.data.timestamp; // Already a Date from parseRecords
        const power = record.data.power !== undefined ? record.data.power : record.data.instantaneous_power;
        const hr = record.data.heart_rate !== undefined ? record.data.heart_rate : record.data.heartRate;
        const cad = record.data.cadence !== undefined ? record.data.cadence : record.data.instantaneous_cadence;
        
        return { lat, lng, ele, time, power, hr, cadence: cad };
      })
      .filter((p: any) => p !== null) as GPXPoint[];

    if (points.length === 0) {
      console.error("FIT parsing error: No valid position records found");
      return null;
    }

    // Try to extract name and description/notes from the FIT records
    let fitName: string | undefined = undefined;
    let fitNotes: string | undefined = undefined;

    if (fitData && Array.isArray(fitData.records)) {
      for (const record of fitData.records) {
        if (!record || !record.data) continue;

        // Extract Course Name (very common if created from route creator or course file)
        if (record.type === 'course' && record.data.name) {
          const rawName = String(record.data.name).trim();
          if (rawName && !fitName) {
            fitName = rawName;
          }
        }

        // Extract Workout Name
        if (record.type === 'workout') {
          const rawWName = (record.data.workout_name || record.data.name);
          if (rawWName) {
            const trimmed = String(rawWName).trim();
            if (trimmed && !fitName) {
              fitName = trimmed;
            }
          }
        }

        // Extract Session names and comments
        if (record.type === 'session') {
          if (record.data.name) {
            const rawSName = String(record.data.name).trim();
            // Ignore generic session names like "Session 1"
            if (rawSName && !/session\s+\d+/i.test(rawSName) && !fitName) {
              fitName = rawSName;
            }
          }
          if (record.data.comment) {
            const rawComment = String(record.data.comment).trim();
            if (rawComment && !fitNotes) {
              fitNotes = rawComment;
            }
          }
          if (record.data.description) {
            const rawDesc = String(record.data.description).trim();
            if (rawDesc && !fitNotes) {
              fitNotes = rawDesc;
            }
          }
        }

        // Extract Activity names and descriptions
        if (record.type === 'activity') {
          if (record.data.name) {
            const rawAName = String(record.data.name).trim();
            if (rawAName && !/activity/i.test(rawAName) && !fitName) {
              fitName = rawAName;
            }
          }
          if (record.data.description) {
            const rawDesc = String(record.data.description).trim();
            if (rawDesc && !fitNotes) {
              fitNotes = rawDesc;
            }
          }
          if (record.data.comment) {
            const rawComment = String(record.data.comment).trim();
            if (rawComment && !fitNotes) {
              fitNotes = rawComment;
            }
          }
        }

        // General fallback/generic check for common descriptive fields
        if (record.data.description && typeof record.data.description === 'string') {
          const d = record.data.description.trim();
          if (d && !fitNotes) fitNotes = d;
        }
        if (record.data.comment && typeof record.data.comment === 'string') {
          const c = record.data.comment.trim();
          if (c && !fitNotes) fitNotes = c;
        }
        if (record.data.notes && typeof record.data.notes === 'string') {
          const n = record.data.notes.trim();
          if (n && !fitNotes) fitNotes = n;
        }
      }
    }

    // Clean up generic/unwanted name strings
    if (fitName) {
      const lower = fitName.toLowerCase();
      if (lower === 'activity' || lower === 'course' || lower === 'unnamed' || lower === 'workout') {
        fitName = undefined;
      }
    }

    let name = '';
    if (fitName) {
      name = fitName;
    } else {
      const firstPoint = points.find(p => p.time !== undefined) || points[0];
      const startDate = firstPoint?.time || new Date();
      const dateStr = startDate.toLocaleDateString('de-DE', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
      });
      const timeStr = startDate.toLocaleTimeString('de-DE', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      
      name = `${dateStr}, ${timeStr}`;
      if (firstPoint?.lat !== undefined && firstPoint?.lng !== undefined) {
        const location = await getLocationName(firstPoint.lat, firstPoint.lng);
        name += ` (${location})`;
      } else {
        name += ` - ${fileName.replace(/\.[^/.]+$/, "")}`;
      }
    }

    const { ascent, descent, maxSlope, totalDist } = calculateElevationStats(points);
    const activityType = detectActivityType(points, name, fileName);
    const powerStats = calculatePowerStats(points, 250, 75, 15, activityType);
    const surfaceStats = generateMockSurfaceStats(totalDist);
    const climbs = findClimbs(points);
    
    let duration: number | undefined;
    const hasTimestamps = points.some(p => p.time !== undefined);
    if (hasTimestamps && points.length > 1) {
      const firstTime = points.find(p => p.time !== undefined)?.time;
      const lastTime = [...points].reverse().find(p => p.time !== undefined)?.time;
      if (firstTime && lastTime) {
        duration = (lastTime.getTime() - firstTime.getTime()) / 1000;
      }
    }

    const color = HIGH_CONTRAST_COLORS[colorIndex % HIGH_CONTRAST_COLORS.length];
    colorIndex++;

    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `fit-${Date.now()}-${Math.random()}`,
      name,
      points,
      color,
      distance: totalDist,
      ascent,
      descent,
      maxSlope,
      visible: true,
      activityType,
      powerStats,
      surfaceStats,
      duration,
      hasTimestamps,
      climbs,
      description: fitNotes || ""
    };
  } catch (error) {
    console.error("Error parsing FIT:", error);
    return null;
  }
};
