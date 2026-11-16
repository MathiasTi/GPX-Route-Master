import { unzipSync } from 'fflate';
import { GPXTrack } from '../types';
import { parseGPXStream, calculatePowerStats } from '../utils/gpxUtils';
import { parseFIT } from '../utils/fitUtils';

export interface WorkerInputFile {
  name: string;
  buffer: ArrayBuffer;
}

export interface WorkerImportRequest {
  files: WorkerInputFile[];
  ftp: number;
  userWeight: number;
  estimatedSpeed: number;
}

export type WorkerImportMessage =
  | {
      type: 'progress';
      totalFiles: number;
      processedFiles: number;
      currentFileName: string;
      percentage: number;
      statusText: string;
    }
  | {
      type: 'done';
      tracks: GPXTrack[];
      errors: string[];
      fitMeta?: { fitDate: string | null; fitTime: string | null };
    }
  | {
      type: 'fatal';
      error: string;
    };

function postProgress(
  totalFiles: number,
  processedFiles: number,
  currentFileName: string,
  percentage: number,
  statusText: string
) {
  self.postMessage({
    type: 'progress',
    totalFiles,
    processedFiles,
    currentFileName,
    percentage,
    statusText
  } satisfies WorkerImportMessage);
}

function enrichTrackTelemetryFlags(track: GPXTrack): GPXTrack {
  let hasPower = false;
  let hasHR = false;
  const pts = track.points || [];
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    if (!hasPower && pt.power !== undefined && pt.power !== null && pt.power > 0) {
      hasPower = true;
    }
    if (!hasHR && pt.hr !== undefined && pt.hr !== null && pt.hr > 0) {
      hasHR = true;
    }
    if (hasPower && hasHR) break;
  }
  return { ...track, hasPower, hasHR };
}

self.onmessage = async (event: MessageEvent<WorkerImportRequest>) => {
  try {
    const { files, ftp, userWeight, estimatedSpeed } = event.data;
    const tracks: GPXTrack[] = [];
    const errors: string[] = [];

    let fitDate: string | null = null;
    let fitTime: string | null = null;
    let hasAddedFit = false;

    const processFitBuffer = async (buffer: ArrayBuffer, name: string) => {
      const parsed = await parseFIT(buffer, name);
      if (parsed) {
        parsed.powerStats = calculatePowerStats(parsed.points, ftp, userWeight, estimatedSpeed, parsed.activityType);
        tracks.push(enrichTrackTelemetryFlags(parsed));

        const firstPtWithTime = parsed.points.find((p) => p.time !== undefined);
        if (firstPtWithTime?.time) {
          const dt = new Date(firstPtWithTime.time);
          if (!Number.isNaN(dt.getTime())) {
            fitDate = dt.toISOString().split('T')[0];
            const hrs = String(dt.getHours()).padStart(2, '0');
            const mins = String(dt.getMinutes()).padStart(2, '0');
            fitTime = `${hrs}:${mins}`;
            hasAddedFit = true;
          }
        }
      } else {
        errors.push(`${name}: Fehler beim Verarbeiten der FIT-Datei.`);
      }
    };

    const processGpxBuffer = async (buffer: ArrayBuffer, name: string) => {
      // Safety precheck on first 20 KB for DOCTYPE / ENTITY definitions
      const preSlice = new Uint8Array(buffer, 0, Math.min(20000, buffer.byteLength));
      const preText = new TextDecoder('utf-8').decode(preSlice);
      const lowerPre = preText.toLowerCase();
      if (lowerPre.includes('<!entity') || lowerPre.includes('<!doctype') || lowerPre.includes('<!system')) {
        errors.push(`${name}: Sicherheitsfehler: Benutzerdefinierte DOCTYPE- oder ENTITY-Definitionen sind im GPX nicht erlaubt.`);
        return;
      }

      if (!lowerPre.includes('<gpx') && buffer.byteLength < 20000) {
        errors.push(`${name}: Ungültiges GPX-Format (Root-Element <gpx> fehlt).`);
        return;
      }

      const blob = new Blob([buffer], { type: 'application/gpx+xml' });
      const parsed = await parseGPXStream(blob, name);
      if (parsed) {
        parsed.powerStats = calculatePowerStats(parsed.points, ftp, userWeight, estimatedSpeed, parsed.activityType);
        tracks.push(enrichTrackTelemetryFlags(parsed));
      } else {
        errors.push(`${name}: Fehler beim Verarbeiten oder keine gültigen Trackpunkte gefunden.`);
      }
    };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const lowerName = file.name.toLowerCase();
      const percentage = Math.round((i / files.length) * 100);

      postProgress(
        files.length,
        i,
        file.name,
        percentage,
        `Verarbeite Datei ${i + 1} von ${files.length}...`
      );

      try {
        if (lowerName.endsWith('.zip')) {
          if (file.buffer.byteLength > 30 * 1024 * 1024) {
            errors.push(`${file.name}: ZIP-Datei ist zu groß (maximal 30 MB erlaubt).`);
            continue;
          }

          postProgress(
            files.length,
            i,
            file.name,
            percentage,
            `Dekomprimiere ZIP-Archiv: ${file.name}...`
          );

          const unzipped = unzipSync(new Uint8Array(file.buffer));
          let totalUncompressedSize = 0;
          const MAX_UNCOMPRESSED_TOTAL = 100 * 1024 * 1024;
          const entries = Object.entries(unzipped);
          const totalEntries = Math.max(1, entries.length);
          let entryIndex = 0;

          for (const [filepath, fileData] of entries) {
            entryIndex++;
            if (filepath.includes('..') || filepath.split('/').some((part) => part === '..')) {
              continue;
            }
            totalUncompressedSize += fileData.length;
            if (totalUncompressedSize > MAX_UNCOMPRESSED_TOTAL) {
              throw new Error('Decompressions-Limit überschritten (Zip-Bomb-Schutz). Max. unkomprimierte Gesamtgröße ist 100 MB.');
            }

            const baseName = filepath.split('/').pop() || '';
            if (!baseName) continue;
            const entryLowerName = baseName.toLowerCase();
            const innerPercentage = Math.round(((i + entryIndex / totalEntries) / files.length) * 100);

            postProgress(
              files.length,
              i,
              `${file.name} / ${baseName}`,
              innerPercentage,
              `ZIP-Eintrag ${entryIndex} von ${totalEntries} wird importiert: ${baseName}...`
            );

            const entryBuffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
            if (entryLowerName.endsWith('.fit')) {
              await processFitBuffer(entryBuffer, baseName);
            } else if (entryLowerName.endsWith('.gpx')) {
              await processGpxBuffer(entryBuffer, baseName);
            }
          }
        } else if (lowerName.endsWith('.fit')) {
          await processFitBuffer(file.buffer, file.name);
        } else {
          await processGpxBuffer(file.buffer, file.name);
        }
      } catch (err: any) {
        errors.push(`${file.name}: Unerwarteter Fehler (${err?.message || err}).`);
      }
    }

    self.postMessage({
      type: 'done',
      tracks,
      errors,
      fitMeta: hasAddedFit ? { fitDate, fitTime } : undefined
    } satisfies WorkerImportMessage);
  } catch (err: any) {
    self.postMessage({
      type: 'fatal',
      error: err?.message || 'Unbekannter Worker-Fehler beim Dateiimport.'
    } satisfies WorkerImportMessage);
  }
};
