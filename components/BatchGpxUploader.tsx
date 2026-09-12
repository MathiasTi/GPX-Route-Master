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
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 shadow-xs space-y-2.5 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="p-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
            <Upload className="w-3.5 h-3.5" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-none">
              GPX Batch-Import
            </h3>
            <p className="text-[9.5px] text-slate-400 dark:text-slate-500 mt-0.5">
              Mehrere .gpx / .fit / .zip Dateien
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-md border border-slate-200/50 dark:border-slate-700/50">
            Multi-Select
          </span>
        </div>
      </div>

      {/* Drag & Drop Area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (!isUploading && fileInputRef.current) {
            fileInputRef.current.click();
          }
        }}
        className={`relative border-2 border-dashed rounded-xl p-3.5 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-1.5 ${
          isDragOver
            ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/30 ring-2 ring-blue-400/20 scale-[0.99]'
            : isUploading
            ? 'border-amber-400 dark:border-amber-600 bg-amber-50/20 dark:bg-amber-950/10 cursor-default'
            : 'border-slate-200 dark:border-slate-750 hover:border-blue-400 dark:hover:border-blue-500 bg-slate-50/50 dark:bg-slate-850/40 hover:bg-slate-50 dark:hover:bg-slate-850'
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
          <div className="w-full space-y-2 py-1">
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                Importiere...
              </span>
              <span className="font-extrabold text-slate-700 dark:text-slate-300">
                {uploadProgress.percentage}%
              </span>
            </div>

            {/* Visual Progress Bar */}
            <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
              <motion.div
                className="bg-gradient-to-r from-blue-500 to-amber-500 h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${uploadProgress.percentage}%` }}
                transition={{ duration: 0.2 }}
              />
            </div>

            {/* Dynamic Status Text & Current File */}
            <div className="flex flex-col items-center gap-1 pt-0.5">
              <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 text-center line-clamp-1">
                {uploadProgress.statusText}
              </span>
              {uploadProgress.currentFileName && (
                <span className="flex items-center gap-1 text-[9px] text-slate-400 dark:text-slate-500 font-mono max-w-[200px] truncate bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200/60 dark:border-slate-800/60">
                  <FileText className="w-2.5 h-2.5 shrink-0" />
                  {uploadProgress.currentFileName}
                </span>
              )}
            </div>

            <div className="text-[9px] text-slate-400 font-mono text-center">
              Datei {uploadProgress.processedFiles + 1} von {uploadProgress.totalFiles}
            </div>
          </div>
        ) : (
          <>
            <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 flex items-center justify-center transition-transform group-hover:scale-110">
              <Upload className="w-4 h-4" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                {isDragOver ? 'Dateien hier loslassen' : 'Dateien hier ablegen'}
              </p>
              <p className="text-[9.5px] text-slate-400 dark:text-slate-500">
                oder klicken für Dateiauswahl
              </p>
            </div>
          </>
        )}
      </div>

      {/* Action Buttons for Selection Modes */}
      {!isUploading && (
        <div className="grid grid-cols-2 gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic('light');
              if (fileInputRef.current) fileInputRef.current.click();
            }}
            className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/50 text-[10.5px] font-bold transition-all cursor-pointer shadow-3xs"
            title="Wähle mehrere GPX/FIT/ZIP Dateien aus"
          >
            <Upload className="w-3 h-3" />
            <span>Dateien wählen</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic('light');
              if (folderInputRef.current) folderInputRef.current.click();
            }}
            className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 text-[10.5px] font-bold transition-all cursor-pointer shadow-3xs"
            title="Einen ganzen Ordner mit GPX-Dateien importieren"
          >
            <FolderUp className="w-3 h-3 text-amber-500" />
            <span>Ordner wählen</span>
          </button>
        </div>
      )}
    </div>
  );
};
