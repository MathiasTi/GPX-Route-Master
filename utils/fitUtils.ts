import { GPXPoint, GPXTrack } from '../types';
import { calculateElevationStats, calculatePowerStats, generateMockSurfaceStats, getLocationName, detectActivityType, findClimbs, sanitizeGPXPoints } from './gpxUtils';

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

interface LocalDefinition {
  localMessageType: number;
  globalMessageNumber: number;
  fields: { recordNumber: number; size: number; baseType: number }[];
  developerFields?: { field_definition_number: number; size: number; developer_data_index: number }[];
}

function parseRecordHeader(headerByte: number) {
  const result: any = {};
  if ((headerByte & 0b10000000) === 0) {
    // Normal Header
    result.headerType = 'NORMAL';
    result.messageType = (headerByte & 0b1000000) > 0 ? 'DEFINITION' : 'DATA';
    result.developerData = (headerByte & 0b100000) > 0;
    result.localMessageType = headerByte & 0b1111;
  } else {
    // compressed timestamp header
    result.headerType = 'COMPRESSED';
    result.messageType = 'DATA';
    result.localMessageType = (headerByte & 0b1100000) >> 5;
    result.timestampOffset = headerByte & 0b11111;
  }
  return result;
}

function readDataField(baseType: number, view: DataView, pointer: number, size: number, littleEndian: boolean): any {
  if (pointer + size > view.byteLength) return undefined;
  switch (baseType) {
    case 0x00: return view.getUint8(pointer);
    case 0x01: return view.getInt8(pointer);
    case 0x02: return view.getUint8(pointer);
    case 0x83: return view.getInt16(pointer, littleEndian);
    case 0x84: return view.getUint16(pointer, littleEndian);
    case 0x85: return view.getInt32(pointer, littleEndian);
    case 0x86: return view.getUint32(pointer, littleEndian);
    case 0x0A: return view.getUint8(pointer);
    case 0x8B: return view.getUint16(pointer, littleEndian);
    case 0x8C: return view.getUint32(pointer, littleEndian);
    case 0x88: return view.getFloat32(pointer, littleEndian);
    case 0x89: return view.getFloat64(pointer, littleEndian);
    case 0x0D: {
      const res = [];
      for (let i = 0; i < size; i++) res.push(view.getUint8(pointer + i));
      return res;
    }
    case 0x8E: return view.getBigInt64 ? Number(view.getBigInt64(pointer, littleEndian)) : 0;
    case 0x8F: return view.getBigUint64 ? Number(view.getBigUint64(pointer, littleEndian)) : 0;
    case 0x90: return view.getBigUint64 ? Number(view.getBigUint64(pointer, littleEndian)) : 0;
    case 0x07: {
      const res = [];
      for (let i = 0; i < size; i++) {
        const char = view.getUint8(pointer + i);
        if (char) res.push(char);
      }
      return String.fromCharCode(...res);
    }
  }
  return undefined;
}

export const parseFIT = async (arrayBuffer: ArrayBuffer, fileName: string): Promise<GPXTrack | null> => {
  try {
    const fit = new DataView(arrayBuffer);
    const points: GPXPoint[] = [];
    const localMessageDefinitions: Record<number, LocalDefinition> = {};
    let latestTimestamp = 0;

    let fitName: string | undefined = undefined;
    let fitNotes: string | undefined = undefined;
    let deviceManufacturer: string | undefined = undefined;
    let deviceModel: string | undefined = undefined;
    let serialNumber: string | undefined = undefined;
    let softwareVersion: string | undefined = undefined;
    let sportName: string | undefined = undefined;
    let sessionDuration: number | undefined = undefined;
    let sessionDistance: number | undefined = undefined;
    let lapCount = 0;
    const rawRecordsForMeta: { type: string; data: Record<string, any> }[] = [];

    let pointer = 0;
    let littleEndian = true;

    while (pointer < fit.byteLength - 2) {
      if (pointer + 12 > fit.byteLength) break;
      
      // 1. Read Header
      const headerSize = fit.getUint8(pointer);
      if (headerSize < 12 || pointer + headerSize > fit.byteLength) {
        break; 
      }
      
      const protocolVersion = fit.getUint8(pointer + 1);
      const profileVersion = fit.getUint16(pointer + 2, littleEndian);
      const dataSize = fit.getUint32(pointer + 4, littleEndian);
      const dataSignature = String.fromCharCode(...new Uint8Array(arrayBuffer.slice(pointer + 8, pointer + 12)));

      let startOfDataRecords = pointer + headerSize;
      let endOfDataRecords = startOfDataRecords + dataSize;
      if (endOfDataRecords > fit.byteLength - 2) {
        endOfDataRecords = fit.byteLength - 2;
      }

      pointer = startOfDataRecords;

      // 2. Read Records sequentially
      while (pointer < endOfDataRecords) {
        if (pointer >= fit.byteLength) break;
        const headerByte = fit.getUint8(pointer);
        const recordHeader = parseRecordHeader(headerByte);

        if (recordHeader.messageType === 'DEFINITION') {
          if (pointer + 6 > fit.byteLength) break;
          const architecture = fit.getUint8(pointer + 2) === 0 ? 'LE' : 'BE';
          littleEndian = architecture === 'LE';
          const globalMessageNumber = fit.getUint16(pointer + 3, littleEndian);
          const fieldsNumber = fit.getUint8(pointer + 5);

          if (pointer + 6 + fieldsNumber * 3 > fit.byteLength) break;
          const fields: { recordNumber: number; size: number; baseType: number }[] = [];
          for (let i = 0; i < fieldsNumber; i++) {
            fields.push({
              recordNumber: fit.getUint8(pointer + 6 + i * 3),
              size: fit.getUint8(pointer + 7 + i * 3),
              baseType: fit.getUint8(pointer + 8 + i * 3),
            });
          }

          let nextPointer = pointer + 6 + fieldsNumber * 3;

          let devFields: { field_definition_number: number; size: number; developer_data_index: number }[] = [];
          if (recordHeader.developerData && nextPointer < fit.byteLength) {
            const devFieldsNumber = fit.getUint8(nextPointer);
            if (nextPointer + 1 + devFieldsNumber * 3 <= fit.byteLength) {
              for (let i = 0; i < devFieldsNumber; i++) {
                devFields.push({
                  field_definition_number: fit.getUint8(nextPointer + 1 + i * 3),
                  size: fit.getUint8(nextPointer + 2 + i * 3),
                  developer_data_index: fit.getUint8(nextPointer + 3 + i * 3),
                });
              }
              nextPointer += 1 + devFieldsNumber * 3;
            }
          }

          localMessageDefinitions[recordHeader.localMessageType] = {
            localMessageType: recordHeader.localMessageType,
            globalMessageNumber,
            fields,
            developerFields: recordHeader.developerData ? devFields : undefined,
          };

          pointer = nextPointer;
        } else {
          // Parse Data Record
          const recordTemplate = localMessageDefinitions[recordHeader.localMessageType];
          if (!recordTemplate) {
            pointer++;
            continue;
          }

          let recordPointer = pointer + 1;
          const globalMsgNum = recordTemplate.globalMessageNumber;

          // Parse fields
          let lat: number | undefined;
          let lng: number | undefined;
          let ele: number | undefined;
          let time: Date | undefined;
          let power: number | undefined;
          let hr: number | undefined;
          let cad: number | undefined;

          // Temp values for metadata
          let metaManufacturer: string | undefined;
          let metaProduct: string | undefined;
          let metaSerial: string | undefined;
          let metaSoftware: string | undefined;
          let metaSport: string | undefined;
          let metaTotalTime: number | undefined;
          let metaTotalDist: number | undefined;
          let metaComment: string | undefined;

          for (const field of recordTemplate.fields) {
            const val = readDataField(field.baseType, fit, recordPointer, field.size, littleEndian);
            recordPointer += field.size;

            if (field.recordNumber === 253) {
              if (typeof val === 'number') {
                latestTimestamp = val;
                time = new Date((val + 631065600) * 1000);
              }
            }

            if (globalMsgNum === 20) {
              // record
              if (field.recordNumber === 0) {
                if (typeof val === 'number') {
                  lat = val;
                }
              } else if (field.recordNumber === 1) {
                if (typeof val === 'number') {
                  lng = val;
                }
              } else if (field.recordNumber === 2 || field.recordNumber === 131) {
                if (typeof val === 'number') {
                  ele = val;
                }
              } else if (field.recordNumber === 7) {
                if (typeof val === 'number') {
                  power = val;
                }
              } else if (field.recordNumber === 3) {
                if (typeof val === 'number') {
                  hr = val;
                }
              } else if (field.recordNumber === 4) {
                if (typeof val === 'number') {
                  cad = val;
                }
              }
            } else if (globalMsgNum === 0) {
              // file_id
              if (field.recordNumber === 3) metaManufacturer = String(val);
              else if (field.recordNumber === 4) metaProduct = String(val);
              else if (field.recordNumber === 1) metaSerial = String(val);
            } else if (globalMsgNum === 23) {
              // device_info
              if (field.recordNumber === 2) metaManufacturer = String(val);
              else if (field.recordNumber === 4) metaProduct = String(val);
              else if (field.recordNumber === 3) metaSerial = String(val);
              else if (field.recordNumber === 5) metaSoftware = String(val);
            } else if (globalMsgNum === 12) {
              // sport
              if (field.recordNumber === 0 || field.recordNumber === 3) metaSport = String(val);
            } else if (globalMsgNum === 31) {
              // course
              if (field.recordNumber === 5) fitName = String(val).trim();
            } else if (globalMsgNum === 26) {
              // workout
              if (field.recordNumber === 6 || field.recordNumber === 8) fitName = String(val).trim();
            } else if (globalMsgNum === 18) {
              // session
              if (field.recordNumber === 8) metaTotalTime = parseFloat(val);
              else if (field.recordNumber === 9) metaTotalDist = parseFloat(val);
              else if (field.recordNumber === 28) {
                const sName = String(val).trim();
                if (sName && !/session\s+\d+/i.test(sName)) fitName = sName;
              } else if (field.recordNumber === 29 || field.recordNumber === 30) {
                metaComment = String(val).trim();
              }
            } else if (globalMsgNum === 34) {
              // activity
              if (field.recordNumber === 1 || field.recordNumber === 2) {
                const aName = String(val).trim();
                if (aName && !/activity/i.test(aName)) fitName = aName;
              } else if (field.recordNumber === 3 || field.recordNumber === 4) {
                metaComment = String(val).trim();
              }
            }
          }

          if (recordTemplate.developerFields) {
            for (const devField of recordTemplate.developerFields) {
              recordPointer += devField.size;
            }
          }

          if (recordHeader.headerType === 'COMPRESSED') {
            let realTimestamp = (latestTimestamp & 0xFFFFFFE0) + recordHeader.timestampOffset;
            if (recordHeader.timestampOffset < (latestTimestamp & 0x0000001F)) {
              realTimestamp += 0x20;
            }
            time = new Date((realTimestamp + 631065600) * 1000);
          }

          // Save trackpoint if position is valid
          if (globalMsgNum === 20 && lat !== undefined && lng !== undefined) {
            // Convert semicircles to degrees if necessary
            if (Math.abs(lat) > 180) lat = lat * (180 / Math.pow(2, 31));
            if (Math.abs(lng) > 180) lng = lng * (180 / Math.pow(2, 31));

            if (Math.abs(lat - 180) > 0.0001 && Math.abs(lng - 180) > 0.0001) {
              if (ele !== undefined && !isNaN(ele)) {
                if (ele === 65535 || ele === 4294967295) {
                  ele = undefined;
                } else {
                  // Standard FIT altitude scaling: value / 5 - 500
                  ele = ele / 5 - 500;
                }
              }
              points.push({ lat, lng, ele, time, power, hr, cadence: cad });
            }
          }

          // Process meta values
          if (globalMsgNum === 0 || globalMsgNum === 23) {
            if (metaManufacturer) deviceManufacturer = metaManufacturer;
            if (metaProduct) deviceModel = metaProduct;
            if (metaSerial) serialNumber = metaSerial;
            if (metaSoftware) softwareVersion = metaSoftware;
          } else if (globalMsgNum === 12) {
            if (metaSport) sportName = metaSport;
          } else if (globalMsgNum === 18) {
            if (metaTotalTime !== undefined) sessionDuration = metaTotalTime;
            if (metaTotalDist !== undefined) sessionDistance = metaTotalDist;
            if (metaComment) fitNotes = metaComment;
          } else if (globalMsgNum === 34) {
            if (metaComment) fitNotes = metaComment;
          } else if (globalMsgNum === 19) {
            lapCount++;
          }

          if (globalMsgNum !== 20 && rawRecordsForMeta.length < 350) {
            rawRecordsForMeta.push({
              type: String(globalMsgNum),
              data: {
                manufacturer: metaManufacturer,
                product: metaProduct,
                serial: metaSerial,
                software: metaSoftware,
                sport: metaSport,
                total_time: metaTotalTime,
                total_dist: metaTotalDist,
                comment: metaComment,
              }
            });
          }

          pointer = recordPointer;
        }
      }

      pointer += 2; // skip CRC
    }

    const sanitizedPoints = sanitizeGPXPoints(points);

    if (sanitizedPoints.length === 0) {
      console.error("FIT parsing error: No valid position records found");
      return null;
    }

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
      const firstPoint = sanitizedPoints.find(p => p.time !== undefined) || sanitizedPoints[0];
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

    const { ascent, descent, maxSlope, totalDist } = calculateElevationStats(sanitizedPoints);
    const activityType = detectActivityType(sanitizedPoints, name, fileName);
    const powerStats = calculatePowerStats(sanitizedPoints, 250, 75, 15, activityType);
    const surfaceStats = generateMockSurfaceStats(totalDist);
    const climbs = findClimbs(sanitizedPoints);
    
    let duration: number | undefined;
    const hasTimestamps = sanitizedPoints.some(p => p.time !== undefined);
    if (hasTimestamps && sanitizedPoints.length > 1) {
      const firstTime = sanitizedPoints.find(p => p.time !== undefined)?.time;
      const lastTime = [...sanitizedPoints].reverse().find(p => p.time !== undefined)?.time;
      if (firstTime && lastTime) {
        duration = (lastTime.getTime() - firstTime.getTime()) / 1000;
      }
    }

    const color = HIGH_CONTRAST_COLORS[colorIndex % HIGH_CONTRAST_COLORS.length];
    colorIndex++;

    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `fit-${Date.now()}-${Math.random()}`,
      name,
      points: sanitizedPoints,
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
      description: fitNotes || "",
      rawFileDetails: {
        fileType: 'fit',
        fileName,
        metadata: {
          deviceManufacturer,
          deviceModel,
          serialNumber,
          softwareVersion,
          sportName,
          sessionDuration,
          sessionDistance,
          lapCount,
          rawRecords: rawRecordsForMeta
        }
      }
    };
  } catch (error) {
    console.error("Error parsing FIT:", error);
    return null;
  }
};
