import React, { useState, useRef, useCallback } from 'react';
import { Upload, FolderUp, FileText, RefreshCw, X, Link2, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { triggerHaptic } from '../utils/haptics';

export interface UploadProgressInfo {
  totalFiles: number;
  processedFiles: number;
  currentFileName: string;
  percentage: number;
  statusText: string;
}

export interface UrlImportSubmitResult {
  success: boolean;
  error?: string;
  message?: string;
}

interface BatchGpxUploaderProps {
  onUpload: (files: FileList | File[] | React.ChangeEvent<HTMLInputElement>) => Promise<void> | void;
  onImportUrl?: (url: string, options?: { saveAsPlannedTour?: boolean }) => Promise<UrlImportSubmitResult>;
  uploadProgress?: UploadProgressInfo | null;
  isDark?: boolean;
}

export const BatchGpxUploader: React.FC<BatchGpxUploaderProps> = ({
  onUpload,
  onImportUrl,
  uploadProgress,
  isDark = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showUrlPanel, setShowUrlPanel] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [isImportingUrl, setIsImportingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlSuccess, setUrlSuccess] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

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

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onImportUrl || isImportingUrl) return;
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setUrlError('Bitte gib eine Komoot- oder GPX-URL ein.');
      return;
    }

    setUrlError(null);
    setUrlSuccess(null);
    setIsImportingUrl(true);
    triggerHaptic('light');

    try {
      const result = await onImportUrl(trimmed);
      if (result.success) {
        triggerHaptic('success');
        setUrlInput('');
        setUrlSuccess(result.message || 'Route geladen');
        setTimeout(() => {
          setUrlSuccess(null);
        }, 2500);
      } else {
        setUrlError(result.error || 'URL-Import fehlgeschlagen.');
      }
    } catch (err: any) {
      setUrlError(err?.message || 'URL-Import fehlgeschlagen.');
    } finally {
      setIsImportingUrl(false);
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
        <>
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
                  Dropzone oder URL
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0 relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerHaptic('light');
                  fileInputRef.current?.click();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10.5px] font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                title="GPX/FIT/ZIP Dateien auswählen"
              >
                <Upload className="w-3 h-3" />
                <span>Import</span>
              </button>

              {onImportUrl && (
                <button
                  type="button"
                  id="btn-sidebar-url-import-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHaptic('light');
                    setShowImportMenu(false);
                    setUrlError(null);
                    setShowUrlPanel((prev) => {
                      const next = !prev;
                      if (next) {
                        setTimeout(() => urlInputRef.current?.focus(), 60);
                      }
                      return next;
                    });
                  }}
                  className={`inline-flex items-center justify-center p-1.5 rounded-lg border text-[10px] font-bold transition-colors cursor-pointer shrink-0 ${
                    showUrlPanel
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-700'
                  }`}
                  title="Komoot-Tour, Collection oder GPX-URL importieren"
                  aria-label="URL / Komoot importieren"
                  aria-expanded={showUrlPanel}
                >
                  <Link2 className={`w-3.5 h-3.5 ${showUrlPanel ? 'text-white' : 'text-emerald-500'}`} />
                </button>
              )}

              <button
                type="button"
                id="btn-sidebar-import-options"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerHaptic('light');
                  setShowImportMenu((prev) => !prev);
                }}
                className={`inline-flex items-center justify-center p-1.5 rounded-lg border text-[10px] font-bold transition-colors cursor-pointer shrink-0 ${
                  showImportMenu
                    ? 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white'
                    : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-700'
                }`}
                title="Weitere Import-Optionen (Ordner, URL)"
                aria-label="Weitere Import-Optionen"
                aria-expanded={showImportMenu}
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showImportMenu ? 'rotate-180' : ''}`} />
              </button>

              {showImportMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowImportMenu(false);
                    }}
                  />
                  <div
                    role="menu"
                    className="absolute right-0 top-full mt-1 w-48 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl py-1 z-50 text-xs"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowImportMenu(false);
                        triggerHaptic('light');
                        fileInputRef.current?.click();
                      }}
                      className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span>Dateien wählen…</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowImportMenu(false);
                        triggerHaptic('light');
                        folderInputRef.current?.click();
                      }}
                      className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <FolderUp className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span>Ganzen Ordner laden…</span>
                    </button>
                    {onImportUrl && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowImportMenu(false);
                          triggerHaptic('light');
                          setUrlError(null);
                          setShowUrlPanel(true);
                          setTimeout(() => urlInputRef.current?.focus(), 60);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <Link2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>Komoot / GPX URL…</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <AnimatePresence initial={false}>
            {showUrlPanel && onImportUrl && (
              <motion.form
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.16 }}
                onSubmit={handleUrlSubmit}
                className="overflow-hidden pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2"
              >
                <div className="flex items-center gap-1.5">
                  <input
                    ref={urlInputRef}
                    id="input-sidebar-url-import"
                    type="url"
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      if (urlError) setUrlError(null);
                    }}
                    placeholder="Komoot Tour / Collection oder GPX-URL"
                    disabled={isImportingUrl}
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[11px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    id="btn-sidebar-url-import-submit"
                    disabled={isImportingUrl || !urlInput.trim()}
                    className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-bold transition-colors cursor-pointer shrink-0"
                  >
                    {isImportingUrl ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <span>Import</span>
                    )}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                    Komoot-Touren, Collections &amp; .gpx-Links
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      setShowUrlPanel(false);
                      setUrlError(null);
                    }}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 cursor-pointer"
                    title="URL-Import schließen"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {urlError && (
                  <div className="flex items-start gap-1.5 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 text-[10px] text-rose-700 dark:text-rose-300 leading-snug">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{urlError}</span>
                  </div>
                )}

                {urlSuccess && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{urlSuccess}</span>
                  </div>
                )}
              </motion.form>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
};
