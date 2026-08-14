import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  ShieldCheck, 
  AlertTriangle, 
  AlertOctagon, 
  CheckCircle2, 
  Wrench, 
  ArrowRight, 
  MapPin, 
  Mountain, 
  Activity, 
  Trash2, 
  Check, 
  Layers, 
  Info,
  Sparkles,
  RefreshCw
} from 'lucide-react';
import { GPXTrack, TrackValidationReport, ValidationIssue } from '../types';
import { analyzeTrackValidation, autoFixTrackValidation } from '../utils/gpxUtils';
import { triggerHaptic } from '../utils/haptics';

interface TrackValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Pending tracks to validate (can be newly uploaded or workspace tracks)
  pendingTracks: GPXTrack[];
  // Callback when user confirms import of tracks (either cleaned or raw)
  onConfirmTracks: (approvedTracks: GPXTrack[]) => void;
  // Callback when user cancels/skips
  onCancel?: () => void;
  isPreCheck?: boolean; // True if shown during upload pre-check flow
  ftp?: number;
  userWeight?: number;
  estimatedSpeed?: number;
}

export const TrackValidationModal: React.FC<TrackValidationModalProps> = ({
  isOpen,
  onClose,
  pendingTracks,
  onConfirmTracks,
  onCancel,
  isPreCheck = true,
  ftp = 250,
  userWeight = 75,
  estimatedSpeed = 25
}) => {
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0);
  const [autoFixMap, setAutoFixMap] = useState<Record<string, boolean>>({});

  // Generate validation reports for all pending tracks
  const reports = useMemo(() => {
    return pendingTracks.map(t => analyzeTrackValidation(t));
  }, [pendingTracks]);

  // Keep selected index within bounds
  const currentTrack = pendingTracks[selectedTrackIndex] || pendingTracks[0];
  const currentReport = reports[selectedTrackIndex] || reports[0];

  // Aggregate stats across all tracks
  const summaryStats = useMemo(() => {
    let totalIssues = 0;
    let errorCount = 0;
    let warningCount = 0;
    let cleanCount = 0;

    for (const r of reports) {
      if (r.status === 'clean') cleanCount++;
      else if (r.status === 'error') errorCount++;
      else warningCount++;
      totalIssues += r.issues.length;
    }

    return { totalIssues, errorCount, warningCount, cleanCount, totalTracks: reports.length };
  }, [reports]);

  if (!isOpen || pendingTracks.length === 0 || !currentTrack || !currentReport) {
    return null;
  }

  // Handle auto-fix toggle for a specific track
  const toggleAutoFixForTrack = (trackId: string) => {
    triggerHaptic();
    setAutoFixMap(prev => ({
      ...prev,
      [trackId]: !prev[trackId]
    }));
  };

  // Confirm single track with choice of auto-fix
  const handleConfirmSingle = (applyFix: boolean) => {
    triggerHaptic();
    const finalTrack = applyFix 
      ? autoFixTrackValidation(currentTrack, ftp, userWeight, estimatedSpeed)
      : currentTrack;

    onConfirmTracks([finalTrack]);
    onClose();
  };

  // Confirm all pending tracks
  const handleConfirmAll = (applyFixToAll: boolean) => {
    triggerHaptic();
    const processed = pendingTracks.map(t => {
      const shouldFix = applyFixToAll || autoFixMap[t.id];
      return shouldFix 
        ? autoFixTrackValidation(t, ftp, userWeight, estimatedSpeed)
        : t;
    });

    onConfirmTracks(processed);
    onClose();
  };

  const handleSkipCurrentTrack = () => {
    triggerHaptic();
    if (pendingTracks.length === 1) {
      if (onCancel) onCancel();
      onClose();
    } else {
      const remainingTracks = pendingTracks.filter((_, idx) => idx !== selectedTrackIndex);
      if (remainingTracks.length > 0) {
        setSelectedTrackIndex(0);
        onConfirmTracks(remainingTracks);
      }
      onClose();
    }
  };

  const getStatusIcon = (status: 'clean' | 'info' | 'warning' | 'error') => {
    switch (status) {
      case 'error':
        return <AlertOctagon className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-500 dark:text-amber-400 shrink-0" />;
      case 'info':
        return <Info className="w-5 h-5 text-sky-500 dark:text-sky-400 shrink-0" />;
      case 'clean':
      default:
        return <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />;
    }
  };

  const getStatusBadge = (status: 'clean' | 'info' | 'warning' | 'error') => {
    switch (status) {
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
            <AlertOctagon className="w-3.5 h-3.5" />
            Kritische Fehler
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
            <AlertTriangle className="w-3.5 h-3.5" />
            Auffälligkeiten
          </span>
        );
      case 'info':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60">
            <Info className="w-3.5 h-3.5" />
            Hinweis
          </span>
        );
      case 'clean':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Einwandfrei
          </span>
        );
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative w-full max-w-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 rounded-xl">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  Track-Validierung & Plausibilitätsprüfung
                  {isPreCheck && (
                    <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300 rounded">
                      Pre-Check
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Prüft GPS-Koordinaten, Null-Island-Ausreißer, Teleportationssprünge und Höhenkonsistenz vor dem Workspace-Import.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              title="Schließen"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Multi-Track Tabs if > 1 track */}
          {pendingTracks.length > 1 && (
            <div className="flex items-center gap-2 px-6 py-2.5 bg-slate-100/70 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
                Tracks ({pendingTracks.length}):
              </span>
              {pendingTracks.map((t, idx) => {
                const rep = reports[idx];
                const isSelected = idx === selectedTrackIndex;
                return (
                  <button
                    key={t.id || idx}
                    onClick={() => {
                      triggerHaptic();
                      setSelectedTrackIndex(idx);
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                      isSelected
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm border border-slate-200 dark:border-slate-700 font-semibold'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    {getStatusIcon(rep.status)}
                    <span className="max-w-[140px] truncate">{t.name}</span>
                    {rep.issues.length > 0 && (
                      <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                        {rep.issues.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Main Content Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Active Track Header Card */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {currentTrack.name}
                  </h3>
                  {getStatusBadge(currentReport.status)}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {currentReport.stats.totalPoints.toLocaleString()} Trackpunkte • {currentTrack.distance.toFixed(1)} km • +{Math.round(currentTrack.ascent)}m Höhenmeter
                </p>
              </div>

              {/* Status Action recommendation */}
              {currentReport.issues.length > 0 ? (
                <div className="text-right">
                  <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    Auto-Fix verfügbar
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {currentReport.issues.filter(i => i.autoFixable).length} von {currentReport.issues.length} Problemen automatisch reparierbar
                  </p>
                </div>
              ) : (
                <div className="text-right">
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    Perfekte Datenintegrität
                  </span>
                </div>
              )}
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mb-1">
                  <Activity className="w-3.5 h-3.5 text-slate-400" />
                  Punkte gesamt
                </div>
                <div className="text-base font-bold text-slate-800 dark:text-slate-100">
                  {currentReport.stats.totalPoints.toLocaleString()}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mb-1">
                  <Mountain className="w-3.5 h-3.5 text-amber-500" />
                  Höhendaten
                </div>
                <div className="text-base font-bold text-slate-800 dark:text-slate-100">
                  {currentReport.stats.missingElevationCount === 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400">100% vollständig</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">
                      {currentReport.stats.missingElevationCount} Punkte fehlen
                    </span>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mb-1">
                  <MapPin className="w-3.5 h-3.5 text-indigo-500" />
                  GPS-Ausreißer
                </div>
                <div className="text-base font-bold text-slate-800 dark:text-slate-100">
                  {currentReport.stats.outlierCoordinateCount === 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400">0 Ausreißer</span>
                  ) : (
                    <span className="text-rose-600 dark:text-rose-400">
                      {currentReport.stats.outlierCoordinateCount} fehlerhaft
                    </span>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mb-1">
                  <Mountain className="w-3.5 h-3.5 text-emerald-500" />
                  Höhenbereich
                </div>
                <div className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">
                  {currentReport.stats.minElevation !== undefined && currentReport.stats.maxElevation !== undefined ? (
                    `${Math.round(currentReport.stats.minElevation)}m – ${Math.round(currentReport.stats.maxElevation)}m`
                  ) : (
                    <span className="text-slate-400">Keine Angaben</span>
                  )}
                </div>
              </div>
            </div>

            {/* Issues Breakdown List */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-between">
                <span>Gefundene Prüfpunkte ({currentReport.issues.length})</span>
                {currentReport.issues.length === 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400 font-normal normal-case">
                    Keine Beanstandungen gefunden
                  </span>
                )}
              </h4>

              {currentReport.issues.length === 0 ? (
                <div className="p-6 rounded-xl border border-dashed border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/20 text-center space-y-2">
                  <div className="w-10 h-10 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-300 flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h5 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Keine Koordinaten- oder Höhenanomalien erkannt
                  </h5>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                    Alle Trackpunkte besitzen gültige GPS-Koordinaten ohne extreme Sprünge und ein vollständiges, plausibles Höhenprofil.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {currentReport.issues.map((issue) => (
                    <div
                      key={issue.id}
                      className={`p-4 rounded-xl border transition-all ${
                        issue.severity === 'error'
                          ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40'
                          : issue.severity === 'warning'
                          ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40'
                          : 'bg-sky-50/50 dark:bg-sky-950/20 border-sky-200 dark:border-sky-900/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5">
                            {issue.severity === 'error' && (
                              <AlertOctagon className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                            )}
                            {issue.severity === 'warning' && (
                              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                            )}
                            {issue.severity === 'info' && (
                              <Info className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                            )}
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h5 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                {issue.title}
                              </h5>
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-white/80 dark:bg-slate-900/80 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800">
                                {issue.affectedCount} Punkt{issue.affectedCount !== 1 ? 'e' : ''} betroffen
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300">
                              {issue.description}
                            </p>
                            {issue.fixDescription && (
                              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 mt-2">
                                <Wrench className="w-3.5 h-3.5 shrink-0" />
                                <span>Korrekturvorschlag: {issue.fixDescription}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-850/80 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              {isPreCheck && (
                <button
                  type="button"
                  onClick={handleSkipCurrentTrack}
                  className="px-3.5 py-2 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 rounded-xl transition-colors cursor-pointer"
                >
                  Diesen Track verwerfen
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
              {/* Import Raw / Unchanged */}
              <button
                type="button"
                onClick={() => handleConfirmSingle(false)}
                className="px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750 rounded-xl transition-all shadow-sm cursor-pointer"
              >
                Unverändert importieren
              </button>

              {/* Auto-Fix & Import */}
              {currentReport.issues.length > 0 ? (
                <button
                  type="button"
                  onClick={() => handleConfirmSingle(true)}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Bereinigen & Importieren
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleConfirmSingle(false)}
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  In Workspace laden
                </button>
              )}

              {/* If multiple tracks, show batch button */}
              {pendingTracks.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleConfirmAll(true)}
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-700 hover:bg-indigo-600 rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" />
                  Alle ({pendingTracks.length}) bereinigen & laden
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
