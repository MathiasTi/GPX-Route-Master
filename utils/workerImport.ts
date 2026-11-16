import { GPXTrack } from '../types';
import type { WorkerImportMessage, WorkerImportRequest } from '../workers/importWorker';

export interface ImportProgressUpdate {
  totalFiles: number;
  processedFiles: number;
  currentFileName: string;
  percentage: number;
  statusText: string;
}

export interface WorkerImportResult {
  tracks: GPXTrack[];
  errors: string[];
  fitMeta?: { fitDate: string | null; fitTime: string | null };
}

/**
 * Offloads GPX, FIT, and ZIP parsing to a dedicated Web Worker with zero-copy
 * ArrayBuffer transfers so large multi-file imports never stall the UI thread.
 * Resolves null if Web Workers are unsupported so callers can gracefully fall back.
 */
export async function parseFilesInWorker(
  files: File[],
  options: { ftp: number; userWeight: number; estimatedSpeed: number },
  onProgress?: (progress: ImportProgressUpdate) => void
): Promise<WorkerImportResult | null> {
  if (typeof Worker === 'undefined' || files.length === 0) {
    return null;
  }

  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('../workers/importWorker.ts', import.meta.url), {
      type: 'module'
    });
  } catch {
    return null;
  }

  try {
    const buffers = await Promise.all(
      files.map(async (f) => ({
        name: f.name,
        buffer: await f.arrayBuffer()
      }))
    );

    const transferable = buffers.map((b) => b.buffer);

    return await new Promise<WorkerImportResult | null>((resolve) => {
      if (!worker) {
        resolve(null);
        return;
      }

      worker.onmessage = (e: MessageEvent<WorkerImportMessage>) => {
        const msg = e.data;
        if (!msg) return;

        if (msg.type === 'progress') {
          onProgress?.({
            totalFiles: msg.totalFiles,
            processedFiles: msg.processedFiles,
            currentFileName: msg.currentFileName,
            percentage: msg.percentage,
            statusText: msg.statusText
          });
        } else if (msg.type === 'done') {
          worker?.terminate();
          resolve({
            tracks: msg.tracks,
            errors: msg.errors,
            fitMeta: msg.fitMeta
          });
        } else if (msg.type === 'fatal') {
          worker?.terminate();
          resolve(null);
        }
      };

      worker.onerror = () => {
        worker?.terminate();
        resolve(null);
      };

      const payload: WorkerImportRequest = {
        files: buffers,
        ftp: options.ftp,
        userWeight: options.userWeight,
        estimatedSpeed: options.estimatedSpeed
      };
      worker.postMessage(payload, transferable);
    });
  } catch {
    worker?.terminate();
    return null;
  }
}
