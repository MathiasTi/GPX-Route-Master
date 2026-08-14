import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Clock, Scissors, Combine, MapPin, AlertCircle, CheckCircle2, Sliders, ChevronRight, Zap, Info, ArrowRight } from 'lucide-react';
import { GPXTrack, TimeGap } from '../types';
import { detectTimeGaps, splitTrackAtIndex, closeTimeGapInTrack, formatGapDuration, mergeTracks, calculatePowerStats } from '../utils/gpxUtils';
import { triggerHaptic } from '../utils/haptics';

interface TimeGapAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  tracks: GPXTrack[];
  selectedTrackId?: string | null;
  onSelectTrack?: (id: string) => void;
  onFocusGapOnMap: (gap: TimeGap) => void;
  onSplitTrack: (originalTrackId: string, splitIndex: number) => void;
  onCloseGap: (originalTrackId: string, gap: TimeGap) => void;
  onBatchSplit: (originalTrackId: string, minSeconds: number) => void;
  onBatchCloseGaps: (originalTrackId: string, minSeconds: number) => void;
  onMergeTracks?: () => void;
  selectedGapId?: string | null;
  ftp?: number;
  userWeight?: number;
}

export const TimeGapAnalysisModal: React.FC<TimeGapAnalysisModalProps> = ({
  isOpen,
  onClose,
  tracks,
  selectedTrackId,
  onSelectTrack,
  onFocusGapOnMap,
  onSplitTrack,
  onCloseGap,
  onBatchSplit,
  onBatchCloseGaps,
  onMergeTracks,
  selectedGapId,
  ftp = 250,
  userWeight = 75
}) => {
  const [activeTrackId, setActiveTrackId] = useState<string>(selectedTrackId || (tracks[0]?.id || 'all'));
  const [minGapSeconds, setMinGapSeconds] = useState<number>(30);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Sync active track ID if prop changes
  React.useEffect(() => {
    if (selectedTrackId) {
      setActiveTrackId(selectedTrackId);
    } else if (tracks.length > 0 && (!activeTrackId || activeTrackId === 'all')) {
      setActiveTrackId(tracks[0].id);
    }
  }, [selectedTrackId, tracks]);

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    triggerHaptic();
    setTimeout(() => setSuccessToast(null), 4000);
  };

  // Determine which tracks to analyze
  const targetTracks = useMemo(() => {
    if (activeTrackId === 'all') return tracks;
    const found = tracks.find(t => t.id === activeTrackId);
    return found ? [found] : tracks;
  }, [tracks, activeTrackId]);

  // Compute all time gaps for selected tracks
  const allGaps = useMemo(() => {
    const list: TimeGap[] = [];
    for (const track of targetTracks) {
      const gaps = detectTimeGaps(track, minGapSeconds);
      list.push(...gaps);
    }
    return list;
  }, [targetTracks, minGapSeconds]);

  // Filter gaps by search query
  const filteredGaps = useMemo(() => {
    if (!searchQuery.trim()) return allGaps;
    const q = searchQuery.toLowerCase();
    return allGaps.filter(g => 
      g.trackName.toLowerCase().includes(q) ||
      formatGapDuration(g.gapSeconds).toLowerCase().includes(q) ||
      g.distanceFromStartKm.toString().includes(q)
    );
  }, [allGaps, searchQuery]);

  // Summary Metrics
  const summaryStats = useMemo(() => {
    const totalGapsCount = allGaps.length;
    let totalPauseSeconds = 0;
    let maxGapSeconds = 0;

    for (const gap of allGaps) {
      totalPauseSeconds += gap.gapSeconds;
      if (gap.gapSeconds > maxGapSeconds) {
        maxGapSeconds = gap.gapSeconds;
      }
    }

    return {
      totalGapsCount,
      totalPauseSeconds,
      maxGapSeconds,
      avgGapSeconds: totalGapsCount > 0 ? Math.round(totalPauseSeconds / totalGapsCount) : 0
    };
  }, [allGaps]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div 
        onClick={onClose}
        className="fixed inset-0 z-[120] flex items-center justify-center p-3 md:p-6 bg-slate-950/70 backdrop-blur-md cursor-pointer"
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-slate-800 dark:text-slate-100 cursor-default"
        >
          {/* Header */}
          <div className="relative p-5 md:p-6 bg-gradient-to-r from-amber-600 via-orange-600 to-red-600 text-white flex justify-between items-start shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/15 backdrop-blur-md rounded-xl border border-white/20 shadow-inner">
                <Scissors className="w-6 h-6 text-amber-200" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
                  Zeitlücken-Analyse & Trennen / Zusammenfügen
                </h2>
                <p className="text-xs text-amber-100/90 font-medium mt-0.5">
                  Erkennt automatische Unterbrechungen, Signalpausen & Zeitaufzeichnungen &gt; 30 Sekunden
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 bg-black/20 hover:bg-black/30 text-white rounded-xl transition-all cursor-pointer border border-white/20"
              title="Schließen"
            >
              <X size={20} />
            </button>
          </div>

          {/* Toast Notification */}
          <AnimatePresence>
            {successToast && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mx-6 mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-300 text-xs font-bold flex items-center gap-2 shadow-sm shrink-0"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{successToast}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-6">
            
            {/* Filter & Controls Bar */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-50 dark:bg-slate-950/60 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800">
              
              {/* Track Selection */}
              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Aktivität / Track wählen
                </label>
                <select
                  value={activeTrackId}
                  onChange={(e) => {
                    setActiveTrackId(e.target.value);
                    if (onSelectTrack && e.target.value !== 'all') {
                      onSelectTrack(e.target.value);
                    }
                  }}
                  className="w-full text-xs font-bold p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-orange-500 outline-none"
                >
                  {tracks.length > 1 && (
                    <option value="all">Alle geladenen Tracks ({tracks.length})</option>
                  )}
                  {tracks.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.distance.toFixed(1)} km)
                    </option>
                  ))}
                </select>
              </div>

              {/* Threshold Selector */}
              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Mindest-Zeitlücke (Schwelle)
                </label>
                <select
                  value={minGapSeconds}
                  onChange={(e) => setMinGapSeconds(Number(e.target.value))}
                  className="w-full text-xs font-bold p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-orange-500 outline-none"
                >
                  <option value={30}>⏱️ Grösser als 30 Sekunden (Standard)</option>
                  <option value={60}>⏱️ Grösser als 1 Minute</option>
                  <option value={120}>⏱️ Grösser als 2 Minuten</option>
                  <option value={300}>⏱️ Grösser als 5 Minuten</option>
                  <option value={600}>⏱️ Grösser als 10 Minuten</option>
                  <option value={1800}>⏱️ Grösser als 30 Minuten</option>
                </select>
              </div>

              {/* Search input */}
              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  In Lücken suchen
                </label>
                <input
                  type="text"
                  placeholder="Z.B. km 14, 5 Min..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs font-medium p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-orange-500 outline-none"
                />
              </div>

            </div>

            {/* Summary Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 p-3.5 rounded-xl flex flex-col justify-center">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  Erkannte Lücken
                </span>
                <span className="text-2xl font-black text-amber-900 dark:text-amber-200 mt-0.5">
                  {summaryStats.totalGapsCount}
                </span>
              </div>

              <div className="bg-orange-50/70 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900/50 p-3.5 rounded-xl flex flex-col justify-center">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-orange-700 dark:text-orange-400">
                  Max. Pausenlücke
                </span>
                <span className="text-xl font-black text-orange-900 dark:text-orange-200 mt-0.5">
                  {summaryStats.maxGapSeconds > 0 ? formatGapDuration(summaryStats.maxGapSeconds) : '0 Sek'}
                </span>
              </div>

              <div className="bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 p-3.5 rounded-xl flex flex-col justify-center">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-700 dark:text-rose-400">
                  Gesamte Pausenzeit
                </span>
                <span className="text-xl font-black text-rose-900 dark:text-rose-200 mt-0.5">
                  {summaryStats.totalPauseSeconds > 0 ? formatGapDuration(summaryStats.totalPauseSeconds) : '0 Sek'}
                </span>
              </div>

              <div className="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 p-3.5 rounded-xl flex flex-col justify-center">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-700 dark:text-blue-400">
                  Ø Lücken-Dauer
                </span>
                <span className="text-xl font-black text-blue-900 dark:text-blue-200 mt-0.5">
                  {summaryStats.avgGapSeconds > 0 ? formatGapDuration(summaryStats.avgGapSeconds) : '0 Sek'}
                </span>
              </div>
            </div>

            {/* Batch Action Bar */}
            {allGaps.length > 0 && activeTrackId !== 'all' && (
              <div className="bg-slate-100 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                  <Zap className="w-4 h-4 text-orange-500" />
                  <span>Sammel-Aktionen für ausgewählten Track:</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => {
                      onBatchSplit(activeTrackId, minGapSeconds);
                      showToast(`Track an allen ${allGaps.length} Lücken getrennt!`);
                    }}
                    className="flex-1 sm:flex-initial px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                    title="Trennt den Track an allen erkannten Lücken auf einmal in einzelne Teil-Tracks"
                  >
                    <Scissors size={14} />
                    <span>An allen Lücken trennen ({allGaps.length})</span>
                  </button>

                  <button
                    onClick={() => {
                      onBatchCloseGaps(activeTrackId, minGapSeconds);
                      showToast(`Alle Zeitlücken im Track geschlossen!`);
                    }}
                    className="flex-1 sm:flex-initial px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                    title="Korrigiert die Zeitstempel im Track, sodass alle künstlichen Pausen entfernt werden"
                  >
                    <Clock size={14} />
                    <span>Alle Lücken korrigieren</span>
                  </button>
                </div>
              </div>
            )}

            {/* If tracks exist and can be merged */}
            {tracks.length >= 2 && onMergeTracks && (
              <div className="bg-indigo-50 dark:bg-indigo-950/40 p-3.5 rounded-xl border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-900 dark:text-indigo-300">
                  <Combine className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span>Getrennte oder geladene Tracks wieder zusammenfügen?</span>
                </div>
                <button
                  onClick={() => {
                    onMergeTracks();
                    showToast("Tracks erfolgreich zusammengefügt!");
                  }}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 shadow-sm"
                >
                  Alle Tracks verbinden
                </button>
              </div>
            )}

            {/* Main Gaps List */}
            <div className="space-y-3">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <span>Erkannte Zeitlücken</span>
                <span className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] px-2 py-0.5 rounded-full font-bold">
                  {filteredGaps.length}
                </span>
              </h3>

              {filteredGaps.length === 0 ? (
                <div className="text-center py-12 px-4 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                  <Clock className="w-10 h-10 mx-auto text-slate-400 dark:text-slate-600 mb-2" />
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    Keine Zeitlücken &gt; {minGapSeconds} Sekunden gefunden
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                    Die ausgewählten Tracks weisen keine Pausen oder Signalunterbrechungen auf, die diese Schwelle überschreiten. Try lowering the threshold or selecting another track.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                  {filteredGaps.map((gap, idx) => {
                    const isSelected = selectedGapId === gap.id;

                    return (
                      <div
                        key={gap.id}
                        className={`p-4 rounded-2xl border transition-all ${
                          isSelected
                            ? 'bg-orange-50/90 dark:bg-orange-950/40 border-orange-400 dark:border-orange-600 shadow-md ring-2 ring-orange-400/30'
                            : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/80 border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                          
                          {/* Gap info */}
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center gap-1 bg-gradient-to-r from-amber-500 to-orange-600 text-white text-xs font-black px-2.5 py-1 rounded-lg shadow-sm">
                                ⏱️ {formatGapDuration(gap.gapSeconds)}
                              </span>

                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                {gap.trackName}
                              </span>

                              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                                bei km {gap.distanceFromStartKm.toFixed(1)}
                              </span>

                              {gap.distanceMeters > 5 && (
                                <span className="text-[11px] font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-2 py-0.5 rounded-md border border-red-200/50 dark:border-red-900/30">
                                  Sprung: {gap.distanceMeters} m
                                </span>
                              )}
                            </div>

                            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 pt-0.5 font-mono">
                              <span>
                                {gap.startTime ? gap.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Unbekannt'}
                              </span>
                              <ArrowRight size={12} className="text-slate-400" />
                              <span>
                                {gap.endTime ? gap.endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Unbekannt'}
                              </span>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800">
                            
                            {/* Focus on map */}
                            <button
                              onClick={() => onFocusGapOnMap(gap)}
                              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                              title="Auf der Karte fokussieren"
                            >
                              <MapPin size={13} className="text-amber-500" />
                              <span>Anzeigen</span>
                            </button>

                            {/* Split Track */}
                            <button
                              onClick={() => {
                                onSplitTrack(gap.trackId, gap.startIndex);
                                showToast(`Track am km ${gap.distanceFromStartKm.toFixed(1)} in 2 Teile getrennt!`);
                              }}
                              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                              title="Hier schneiden: Trennt die Strecke an diesem Punkt in zwei eigenständige GPX-Tracks"
                            >
                              <Scissors size={13} />
                              <span>Hier trennen</span>
                            </button>

                            {/* Close / Join Gap */}
                            <button
                              onClick={() => {
                                onCloseGap(gap.trackId, gap);
                                showToast(`Zeitlücke von ${formatGapDuration(gap.gapSeconds)} geschlossen!`);
                              }}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                              title="Schließt diese Zeitlücke und verschiebt nachfolgende Zeitstempel"
                            >
                              <Clock size={13} />
                              <span>Lücke schließen</span>
                            </button>

                          </div>

                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

          {/* Footer Info */}
          <div className="p-4 bg-slate-50 dark:bg-slate-950/80 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <Info size={14} className="text-amber-500 shrink-0" />
              <span>
                Tipp: Alle Trennungen und Zusammenfügungen können mit dem <strong>RÜCKGÄNGIG</strong>-Button jederzeit rückgängig gemacht werden.
              </span>
            </div>

            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
            >
              Fertig / Schließen
            </button>
          </div>

        </motion.div>
      </div>
    </AnimatePresence>
  );
};
