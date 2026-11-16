import React, { useState, useRef, useCallback } from 'react';
import { Upload, FolderUp, FileText, CheckCircle2, AlertCircle, RefreshCw, X, Layers, Plus, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { triggerHaptic } from '../utils/haptics';

export interface UploadProgressInfo {
  totalFiles: number;
  processedFiles: number;
  currentFileName: string;
  percentage: number;
  statusText: string;
}

interface BatchGpxUploaderProps {
  onUpload: (files: FileList | File[] | React.ChangeEvent<HTMLInputElement>) => Promise<void> | void;
  uploadProgress?: UploadProgressInfo | null;
  isDark?: boolean;
}

export const BatchGpxUploader: React.FC<BatchGpxUploaderProps> = ({
  onUpload,
  uploadProgress,
  isDark = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isFolderMode, setIsFolderMode] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  }, [isDragOver]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(file => {
      const name = file.name.toLowerCase();
      return name.endsWith('.gpx') || name.endsWith('.fit') || name.endsWith('.zip');
    });

    if (droppedFiles.length === 0) return;

    triggerHaptic('medium');
    await onUpload(droppedFiles);
  }, [onUpload]);

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      triggerHaptic('light');
      await onUpload(e);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const isUploading = !!uploadProgress;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`border rounded-xl p-2.5 space-y-2 transition-all ${
        isDragOver
          ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/35 ring-2 ring-blue-400/25'
          : isUploading
          ? 'border-amber-400 dark:border-amber-600 bg-amber-50/30 dark:bg-amber-950/15'
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xs'
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".gpx, .fit, .FIT, .zip, .ZIP, application/gpx+xml, application/octet-stream, application/x-garmin-fit, application/zip, application/x-zip-compressed"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        disabled={isUploading}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-ignore
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        disabled={isUploading}
      />

      {isUploading ? (
        <div className="w-full space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1 truncate">
              <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
              <span className="truncate">{uploadProgress.statusText || 'Importiere...'}</span>
            </span>
            <span className="font-extrabold text-slate-700 dark:text-slate-300 shrink-0 ml-2">
              {uploadProgress.percentage}% ({uploadProgress.processedFiles + 1}/{uploadProgress.totalFiles})
            </span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <motion.div
              className="bg-gradient-to-r from-blue-500 to-amber-500 h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${uploadProgress.percentage}%` }}
              transition={{ duration: 0.2 }}
            />
          </div>
          {uploadProgress.currentFileName && (
            <div className="flex items-center gap-1 text-[9px] text-slate-400 font-mono truncate">
              <FileText className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{uploadProgress.currentFileName}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer group"
            title="Dateien per Klick auswählen oder per Drag & Drop ablegen (.gpx / .fit / .zip)"
          >
            <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 shrink-0 group-hover:scale-105 transition-transform">
              <Upload className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-slate-800 dark:text-slate-100 leading-tight truncate">
                {isDragOver ? 'Hier loslassen' : 'GPX / FIT Import'}
              </div>
              <div className="text-[9.5px] text-slate-400 dark:text-slate-500 leading-tight truncate">
                Dropzone oder auswählen
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic('light');
                fileInputRef.current?.click();
              }}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Mehrere GPX/FIT/ZIP Dateien auswählen"
            >
              <Upload className="w-3 h-3" />
              <span>Dateien</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic('light');
                folderInputRef.current?.click();
              }}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 text-[10px] font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Ganzen Ordner mit GPX-Dateien importieren"
            >
              <FolderUp className="w-3 h-3 text-amber-500" />
              <span>Ordner</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
