import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Check,
  Search,
  Compass,
  Bike,
  Footprints,
  Folder,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Map as MapIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GPXTrack } from '../types';
import { getApiUrl, apiFetch } from '../utils/api';
import {
  parseGPX,
  validateGPX,
  calculatePowerStats,
  calculateSurfaceStatsFromPoints,
  hydratePointsWithSurface
} from '../utils/gpxUtils';
import {
  attachKomootSourceToTrack,
  applyKomootRefreshToTrack,
  findMatchingExistingKomootTrack
} from '../utils/komootVersioning';
import { triggerHaptic } from '../utils/haptics';

export interface KomootCollectionTourItem {
  id: string;
  name: string;
  sport?: string;
  activityType: 'cycling' | 'running';
  distanceKm?: number;
  ascentM?: number;
  durationSec?: number;
  tourUrl: string;
  shareToken?: string | null;
}

export interface KomootCollectionPreviewData {
  collectionId: string;
  title: string;
  sourceUrl: string;
  tours: KomootCollectionTourItem[];
}

export interface KomootCollectionImportCompletion {
  importedTracks: GPXTrack[];
  savedToPlanned: boolean;
  openOnMap: boolean;
  collectionTitle: string;
  failedCount: number;
  updatedCount?: number;
  unchangedCount?: number;
}

interface KomootCollectionImportModalProps {
  collection: KomootCollectionPreviewData | null;
  ftp: number;
  userWeight: number;
  estimatedSpeed: number;
  existingWorkspaceTracks?: GPXTrack[];
  defaultSaveAsPlanned?: boolean;
  defaultOpenOnMap?: boolean;
  onComplete: (result: KomootCollectionImportCompletion) => void | Promise<void>;
  onClose: () => void;
}

type TourImportStatus = 'idle' | 'loading' | 'done' | 'error';

function formatDurationShort(sec?: number): string | null {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return null;
  const totalMin = Math.round(sec / 60);
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')} Std.`;
}

export const KomootCollectionImportModal: React.FC<KomootCollectionImportModalProps> = ({
  collection,
  ftp,
  userWeight,
  estimatedSpeed,
  existingWorkspaceTracks = [],
  defaultSaveAsPlanned = true,
  defaultOpenOnMap = true,
  onComplete,
  onClose
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [groupByCollection, setGroupByCollection] = useState(true);
  const [groupTitle, setGroupTitle] = useState('');
  const [saveAsPlanned, setSaveAsPlanned] = useState(defaultSaveAsPlanned);
  const [openOnMap, setOpenOnMap] = useState(defaultOpenOnMap);

  const [isImporting, setIsImporting] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalToImport, setTotalToImport] = useState(0);
  const [rowStatuses, setRowStatuses] = useState<Record<string, { status: TourImportStatus; error?: string }>>({});
  const [batchError, setBatchError] = useState<string | null>(null);

  const cancelRef = useRef(false);

  useEffect(() => {
    if (!collection) return;
    setSelectedIds(new Set(collection.tours.map((t) => t.id)));
    setSearchQuery('');
    setGroupByCollection(true);
    setGroupTitle(collection.title || `Komoot Collection ${collection.collectionId}`);
    setSaveAsPlanned(defaultSaveAsPlanned);
    setOpenOnMap(defaultOpenOnMap);
    setIsImporting(false);
    setProcessedCount(0);
    setTotalToImport(0);
    setRowStatuses({});
    setBatchError(null);
    cancelRef.current = false;
  }, [collection, defaultSaveAsPlanned, defaultOpenOnMap]);

  const filteredTours = useMemo(() => {
    if (!collection) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return collection.tours;
    return collection.tours.filter((t) => t.name.toLowerCase().includes(q));
  }, [collection, searchQuery]);

  const selectionSummary = useMemo(() => {
    if (!collection) return { count: 0, distanceKm: 0, ascentM: 0 };
    let count = 0;
    let distanceKm = 0;
    let ascentM = 0;
    for (const t of collection.tours) {
      if (selectedIds.has(t.id)) {
        count++;
        if (t.distanceKm) distanceKm += t.distanceKm;
        if (t.ascentM) ascentM += t.ascentM;
      }
    }
    return { count, distanceKm, ascentM };
  }, [collection, selectedIds]);

  const allFilteredSelected = useMemo(() => {
    if (filteredTours.length === 0) return false;
    return filteredTours.every((t) => selectedIds.has(t.id));
  }, [filteredTours, selectedIds]);

  const toggleTour = (id: string) => {
    if (isImporting) return;
    triggerHaptic('light');
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleAllFiltered = () => {
    if (isImporting) return;
    triggerHaptic('light');
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const t of filteredTours) next.delete(t.id);
      } else {
        for (const t of filteredTours) next.add(t.id);
      }
      return next;
    });
  };

  const handleStartImport = async () => {
    if (!collection || isImporting) return;
    const chosenTours = collection.tours.filter((t) => selectedIds.has(t.id));
    if (chosenTours.length === 0) {
      setBatchError('Bitte wähle mindestens eine Tour aus.');
      return;
    }
    if (!saveAsPlanned && !openOnMap) {
      setBatchError('Bitte wähle mindestens „Auf Karte öffnen“ oder „Als Geplante Tour speichern“.');
      return;
    }

    setBatchError(null);
    setIsImporting(true);
    setProcessedCount(0);
    setTotalToImport(chosenTours.length);
    cancelRef.current = false;

    const initialStatuses: Record<string, { status: TourImportStatus; error?: string }> = {};
    for (const t of chosenTours) {
      initialStatuses[t.id] = { status: 'idle' };
    }
    setRowStatuses(initialStatuses);

    const resolvedGroupName =
      groupByCollection && groupTitle.trim() ? groupTitle.trim().slice(0, 120) : undefined;
    const effectiveSpeed = Math.max(8, estimatedSpeed || 20);

    // Fetch existing planned tours so re-importing the same Collection updates versions instead of creating duplicates
    let existingLibraryMetas: Array<{ id: string; rawFileDetails?: { metadata?: Record<string, unknown> } }> = [];
    if (saveAsPlanned) {
      try {
        const libRes = await apiFetch(getApiUrl('/api/library?tags=Geplante%20Tour'));
        const libData = await libRes.json();
        if (libData?.success && Array.isArray(libData.tracks)) {
          existingLibraryMetas = libData.tracks;
        }
      } catch {
        // Non-fatal: proceed as fresh import if library lookup fails
      }
    }

    const importedByIndex: Array<GPXTrack | null> = new Array(chosenTours.length).fill(null);
    let failedCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let cursor = 0;
    const CONCURRENCY = Math.min(2, chosenTours.length);

    const worker = async () => {
      while (!cancelRef.current) {
        const idx = cursor++;
        if (idx >= chosenTours.length) break;
        const stub = chosenTours[idx];

        setRowStatuses((prev) => ({
          ...prev,
          [stub.id]: { status: 'loading' }
        }));

        try {
          const res = await apiFetch(getApiUrl('/api/import-url'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: stub.tourUrl })
          });
          const data = await res.json();

          if (!res.ok || !data?.success || !data.gpxContent) {
            throw new Error(data?.error || `HTTP ${res.status}`);
          }

          const validation = validateGPX(data.gpxContent);
          if (!validation.isValid) {
            throw new Error(validation.error || 'Ungültige GPX-Daten');
          }

          const fallbackName = `${stub.name || data.suggestedName || `Komoot Tour ${stub.id}`}.gpx`;
          const parsed = await parseGPX(data.gpxContent, fallbackName);
          if (!parsed || !parsed.points || parsed.points.length < 2) {
            throw new Error('Keine GPS-Punkte gefunden');
          }

          if (stub.name && (!parsed.name || parsed.name.startsWith('Komoot Tour'))) {
            parsed.name = stub.name;
          } else if (data.suggestedName && !parsed.name) {
            parsed.name = String(data.suggestedName).trim();
          }
          if (stub.activityType === 'running' || data.activityType === 'running') {
            parsed.activityType = 'running';
          }

          parsed.powerStats = calculatePowerStats(
            parsed.points,
            ftp,
            userWeight,
            effectiveSpeed,
            parsed.activityType
          );
          const surfStats = calculateSurfaceStatsFromPoints(parsed.points);
          if (surfStats.length > 0) {
            parsed.surfaceStats = surfStats;
            hydratePointsWithSurface(parsed.points, surfStats, parsed.distance);
          }

          const tags = Array.isArray(parsed.tags) ? [...parsed.tags] : [];
          if (!tags.includes('Komoot')) tags.push('Komoot');
          if (saveAsPlanned && !tags.includes('Geplante Tour')) tags.push('Geplante Tour');
          parsed.tags = tags;

          if (resolvedGroupName) {
            parsed.tourGroup = resolvedGroupName;
          }

          const attachParams = {
            sourceType: 'komoot' as const,
            sourceUrl: String(data.sourceUrl || stub.tourUrl),
            komootTourId: String(data.komootTourId || stub.id),
            komootShareToken: data.komootShareToken ?? stub.shareToken ?? null,
            komootCollectionId: collection.collectionId,
            komootCollectionTitle: resolvedGroupName || collection.title,
            komootCollectionUrl: collection.sourceUrl,
            remoteUpdatedAt: typeof data.remoteUpdatedAt === 'string' ? data.remoteUpdatedAt : undefined
          };

          // Match existing saved library track or workspace track by komootTourId / sourceUrl
          let finalTrack: GPXTrack;
          const matchedLibMeta = findMatchingExistingKomootTrack(existingLibraryMetas, {
            komootTourId: attachParams.komootTourId,
            sourceUrl: attachParams.sourceUrl
          });
          let matchedFullTrack: GPXTrack | null = null;

          if (matchedLibMeta) {
            const wsMatch = existingWorkspaceTracks.find((t) => t.id === matchedLibMeta.id);
            if (wsMatch && wsMatch.points && wsMatch.points.length > 1) {
              matchedFullTrack = wsMatch;
            } else {
              try {
                const fullRes = await apiFetch(
                  getApiUrl(`/api/library/${encodeURIComponent(matchedLibMeta.id)}`)
                );
                const fullData = await fullRes.json();
                if (fullData?.success && fullData.track) {
                  matchedFullTrack = fullData.track as GPXTrack;
                }
              } catch {
                // fallback to fresh attach if detail fetch fails
              }
            }
          } else {
            matchedFullTrack = findMatchingExistingKomootTrack(existingWorkspaceTracks, {
              komootTourId: attachParams.komootTourId,
              sourceUrl: attachParams.sourceUrl
            });
          }

          if (matchedFullTrack) {
            const refreshRes = applyKomootRefreshToTrack(matchedFullTrack, parsed, attachParams);
            finalTrack = refreshRes.track;
            if (refreshRes.updated) {
              updatedCount++;
            } else {
              unchangedCount++;
            }
          } else {
            finalTrack = attachKomootSourceToTrack(parsed, attachParams);
          }

          importedByIndex[idx] = finalTrack;
          setRowStatuses((prev) => ({
            ...prev,
            [stub.id]: { status: 'done' }
          }));
        } catch (err: any) {
          failedCount++;
          setRowStatuses((prev) => ({
            ...prev,
            [stub.id]: { status: 'error', error: err?.message || 'Import fehlgeschlagen' }
          }));
        } finally {
          setProcessedCount((prev) => prev + 1);
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    if (cancelRef.current) {
      setIsImporting(false);
      return;
    }

    const succeededTracks = importedByIndex.filter((tr): tr is GPXTrack => tr !== null);
    if (succeededTracks.length === 0) {
      setBatchError(
        'Keine der ausgewählten Touren konnte importiert werden. Prüfe, ob die Touren in Komoot öffentlich sind.'
      );
      setIsImporting(false);
      return;
    }

    let savedSuccessfully = false;
    if (saveAsPlanned) {
      try {
        const saveRes = await apiFetch(getApiUrl('/api/library/save-batch'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: succeededTracks })
        });
        const saveData = await saveRes.json();
        if (saveRes.ok && saveData?.success) {
          savedSuccessfully = true;
        } else {
          setBatchError(saveData?.error || 'Touren konnten nicht in Geplante Touren gespeichert werden.');
        }
      } catch (saveErr: any) {
        setBatchError(saveErr?.message || 'Speichern in Geplante Touren fehlgeschlagen.');
      }
    }

    setIsImporting(false);
    triggerHaptic('success');

    await onComplete({
      importedTracks: succeededTracks,
      savedToPlanned: savedSuccessfully,
      openOnMap,
      collectionTitle: resolvedGroupName || collection.title,
      failedCount,
      updatedCount,
      unchangedCount
    });
  };

  if (!collection) return null;

  const progressPct = totalToImport > 0 ? Math.round((processedCount / totalToImport) * 100) : 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        className="fixed inset-0 z-[1200] bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="komoot-collection-modal-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 8 }}
          transition={{ duration: 0.18 }}
          className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <Compass className="w-3.5 h-3.5 shrink-0" />
                <span>Komoot Collection</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{collection.tours.length} Touren gefunden</span>
              </div>
              <h2
                id="komoot-collection-modal-title"
                className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5 truncate"
              >
                {collection.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                if (isImporting) cancelRef.current = true;
                onClose();
              }}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              aria-label="Modal schließen"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Group Assignment & Search Controls */}
          <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer select-none shrink-0">
                <input
                  type="checkbox"
                  checked={groupByCollection}
                  onChange={(e) => setGroupByCollection(e.target.checked)}
                  disabled={isImporting}
                  className="rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                />
                <Folder className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Als Tourengruppe organisieren:</span>
              </label>
              <input
                type="text"
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                disabled={isImporting || !groupByCollection}
                placeholder="Gruppenname..."
                maxLength={120}
                className="flex-1 min-w-0 px-3 py-1.5 rounded-xl text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Touren in dieser Collection filtern..."
                  disabled={isImporting}
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {selectionSummary.count} ausgewählt
                  {selectionSummary.distanceKm > 0 && (
                    <>
                      {' · '}
                      {selectionSummary.distanceKm.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km
                    </>
                  )}
                  {selectionSummary.ascentM > 0 && (
                    <>
                      {' · +'}
                      {Math.round(selectionSummary.ascentM).toLocaleString('de-DE')} hm
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleToggleAllFiltered}
                  disabled={isImporting || filteredTours.length === 0}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {allFilteredSelected ? 'Keine auswählen' : 'Alle auswählen'}
                </button>
              </div>
            </div>
          </div>

          {/* Tour Checklist */}
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {filteredTours.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                Keine Touren für „{searchQuery}“ gefunden.
              </div>
            ) : (
              filteredTours.map((tour) => {
                const isSelected = selectedIds.has(tour.id);
                const rowState = rowStatuses[tour.id];
                const durationLabel = formatDurationShort(tour.durationSec);

                return (
                  <div
                    key={tour.id}
                    onClick={() => toggleTour(tour.id)}
                    className={`px-5 py-3 min-h-[52px] flex items-center gap-3.5 transition-colors ${
                      isImporting ? 'cursor-default' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTour(tour.id);
                      }}
                      disabled={isImporting}
                      aria-checked={isSelected}
                      role="checkbox"
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="text-xs sm:text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {tour.name}
                      </div>
                      <div className="flex items-center flex-wrap gap-1.5 mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        <span className="inline-flex items-center gap-1 font-sans">
                          {tour.activityType === 'running' ? (
                            <Footprints className="w-3 h-3 text-amber-500" />
                          ) : (
                            <Bike className="w-3 h-3 text-emerald-500" />
                          )}
                          {tour.activityType === 'running' ? 'Laufen' : 'Rad'}
                        </span>
                        {tour.distanceKm !== undefined && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{tour.distanceKm.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km</span>
                          </>
                        )}
                        {tour.ascentM !== undefined && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>+{Math.round(tour.ascentM).toLocaleString('de-DE')} hm</span>
                          </>
                        )}
                        {durationLabel && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{durationLabel}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {rowState && rowState.status !== 'idle' && (
                      <div className="shrink-0 text-[11px] font-medium flex items-center gap-1.5">
                        {rowState.status === 'loading' && (
                          <span className="text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Lädt...</span>
                          </span>
                        )}
                        {rowState.status === 'done' && (
                          <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Bereit</span>
                          </span>
                        )}
                        {rowState.status === 'error' && (
                          <span
                            className="text-rose-600 dark:text-rose-400 inline-flex items-center gap-1 max-w-[160px] truncate"
                            title={rowState.error}
                          >
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{rowState.error || 'Fehler'}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Progress & Error Feedback */}
          {(isImporting || batchError) && (
            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 space-y-2 bg-slate-50/70 dark:bg-slate-950/40">
              {isImporting && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    <span className="inline-flex items-center gap-1.5 font-sans font-medium">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                      <span>Importiere ausgewählte Komoot-Touren...</span>
                    </span>
                    <span>
                      {processedCount} / {totalToImport} ({progressPct}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 rounded-full transition-all duration-200"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              {batchError && (
                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-700 dark:text-rose-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{batchError}</span>
                </div>
              )}
            </div>
          )}

          {/* Footer Destinations & Primary CTA */}
          <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700 dark:text-slate-300">
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none font-medium">
                <input
                  type="checkbox"
                  checked={openOnMap}
                  onChange={(e) => setOpenOnMap(e.target.checked)}
                  disabled={isImporting}
                  className="rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                />
                <MapIcon className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span>Auf Karte öffnen</span>
              </label>

              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none font-medium">
                <input
                  type="checkbox"
                  checked={saveAsPlanned}
                  onChange={(e) => setSaveAsPlanned(e.target.checked)}
                  disabled={isImporting}
                  className="rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                />
                <Compass className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>Als Geplante Tour speichern</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (isImporting) cancelRef.current = true;
                  onClose();
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Abbrechen
              </button>
              <button
                type="button"
                id="btn-komoot-collection-confirm-import"
                onClick={handleStartImport}
                disabled={isImporting || selectionSummary.count === 0 || (!openOnMap && !saveAsPlanned)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow-sm transition-colors cursor-pointer whitespace-nowrap"
              >
                {isImporting
                  ? `Importiere (${processedCount}/${totalToImport})...`
                  : `${selectionSummary.count} ${selectionSummary.count === 1 ? 'Tour' : 'Touren'} importieren`}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
