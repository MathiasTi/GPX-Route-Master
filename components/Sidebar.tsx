
import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GPXTrack, MapLayer, TextMarker } from '../types';
import { AboutModal } from './AboutModal';
import { getApiUrl, apiFetch } from '../utils/api';
import { Upload, Trash2, Combine, Eye, EyeOff, Ruler, Layers, GripVertical, Undo2, TrendingUp, TrendingDown, Box, ChevronLeft, ChevronRight, Menu, Zap, Clock, BarChart2, X, MapPin, Plus, Trophy, GitCompare, Settings, ChevronDown, ChevronUp, Heart, Database, Sun, Moon, FileCode, Download, Wifi, WifiOff, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Info, Scissors, ExternalLink, ShieldCheck, Sparkles, BookOpen, Keyboard, Lock, Video, Target, Compass, ArrowLeftRight, CopyCheck, Search, Copy, Check, MoreHorizontal } from 'lucide-react';
import { calculateDistance, formatPace, getPaceString, findClimbs, exportToGPX, downloadTrackAsGPX, calculateElevationStats, findDuplicateTracksByIdenticalGPS } from '../utils/gpxUtils';
import { getKomootSourceMeta } from '../utils/komootVersioning';
import { filterWorkspaceTracks, formatTrackQuickSummary, WorkspaceActivityFilter, WorkspaceSourceFilter } from '../utils/workspaceQoL';
import { validateTrackStartPoint } from '../utils/startPointValidator';
import { resolveTrackCapabilities } from '../utils/trackTelemetryCapabilities';
import {
  getPrimarySurfaceInfo,
  getSurfaceTypeColor,
  resolveSidebarTrackColor,
  SURFACE_COLOR_LEGEND
} from '../utils/trackSurfaceColor';
import { computePauseAwareRunningMetrics } from '../utils/runningMetricsEngine';
import { triggerHaptic } from '../utils/haptics';
import { useAppPreferences } from '../utils/appSettings';
import {
  formatDistance,
  formatElevation,
  formatSpeed,
  formatPaceFromSecPerKm,
  formatPaceFromSpeed
} from '../utils/units';
import { TrackLibrary } from './TrackLibrary';
import { SidebarSportsMetricsCard } from './SidebarSportsMetricsCard';
import { WorkspaceSummaryDashboard } from './WorkspaceSummaryDashboard';
import { BatchGpxUploader, UploadProgressInfo, UrlImportSubmitResult } from './BatchGpxUploader';
import { FreeMetricInput } from './FreeMetricInput';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragEndEvent 
} from '@dnd-kit/core';
import { 
  SortableContext, 
  sortableKeyboardCoordinates, 
  verticalListSortingStrategy,
  useSortable 
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface TrackItemProps {
  track: GPXTrack;
  isMarked: boolean;
  isCompared?: boolean;
  isMapComparing?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (id: string) => void;
  onMark: (id: string) => void;
  onCompareTrackOnMap?: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onRemoveTrack: (id: string) => void;
  onKeepOnlyTrack?: (id: string) => void;
  totalTracks?: number;
  onChangeActivityType?: (id: string, type: 'cycling' | 'running') => void;
  estimatedSpeed: number;
  onOpenAnalytics?: (id: string) => void;
  onOpenIntensiveAnalysis?: (id: string) => void;
  onOpenVideoExport?: (id: string) => void;
  onOpenTrainingZones?: (id: string) => void;
  onOpenClimbs?: (id: string) => void;
  onAnalyzeSurface?: (id: string, force?: boolean) => void;
  onSetTrackSurface?: (id: string, surfaceType: string) => void;
  isAnalyzing?: boolean;
  surfaceStatus?: {
    status: 'idle' | 'loading' | 'success' | 'partial' | 'error';
    message?: string;
    source?: 'valhalla+osm' | 'valhalla' | 'overpass' | 'embedded' | 'osm' | 'manual' | 'unavailable';
    coveragePct?: number;
    cached?: boolean;
    timestamp?: number;
  };
  onSaveTrackToLibrary?: (id: string) => void;
  onOpenRawData?: (id: string) => void;
  onOpenTimeGapAnalysis?: (id: string) => void;
  onReverseTrack?: (id: string) => void;
  onSanitizeTrack?: (id: string) => void;
  onOpenValidation?: (id: string) => void;
  onRefreshKomootTrack?: (id: string) => void;
  isRefreshingKomoot?: boolean;
  isMenuOpen?: boolean;
  onToggleMenu?: (id: string) => void;
  onCloseMenu?: () => void;
  autoColorBySurface?: boolean;
  onSelection?: (bounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null) => void;
}

const SortableTrackItem: React.FC<TrackItemProps> = React.memo(({ 
  track, 
  isMarked, 
  isCompared = false,
  isMapComparing = false,
  isExpanded,
  onToggleExpand,
  onMark, 
  onCompareTrackOnMap,
  onToggleVisibility, 
  onRemoveTrack, 
  onKeepOnlyTrack,
  totalTracks = 1,
  onChangeActivityType, 
  estimatedSpeed, 
  onOpenAnalytics, 
  onOpenIntensiveAnalysis,
  onOpenVideoExport,
  onOpenTrainingZones,
  onOpenClimbs, 
  onAnalyzeSurface,
  onSetTrackSurface,
  isAnalyzing,
  surfaceStatus,
  onSaveTrackToLibrary,
  onOpenRawData,
  onOpenTimeGapAnalysis,
  onReverseTrack,
  onSanitizeTrack,
  onOpenValidation,
  onRefreshKomootTrack,
  isRefreshingKomoot = false,
  isMenuOpen = false,
  onToggleMenu,
  onCloseMenu,
  autoColorBySurface = true,
  onSelection
}) => {
  const appPrefs = useAppPreferences();
  const unitSystem = appPrefs.unitSystem;
  const lang = appPrefs.language;
  const [localExpanded, setLocalExpanded] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const expanded = isExpanded !== undefined ? isExpanded : localExpanded;

  const handleCopySummary = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const summaryText = formatTrackQuickSummary(track, estimatedSpeed);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(summaryText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = summaryText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      triggerHaptic('light');
      setCopiedSummary(true);
      window.setTimeout(() => setCopiedSummary(false), 1800);
    } catch {
      // Ignore clipboard permission denials gracefully
    }
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleExpand) {
      onToggleExpand(track.id);
    } else {
      setLocalExpanded(prev => !prev);
    }
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: track.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
  };

  const handleExportGPX = () => {
    try {
      triggerHaptic('light');
      downloadTrackAsGPX(track);
    } catch (e) {
      console.error("Error exporting GPX:", e);
    }
  };

  const capabilities = useMemo(() => resolveTrackCapabilities(track), [track]);
  const hasHR = capabilities.hasHeartRate;
  const maxSlopeDisplay = useMemo(() => {
    if (!capabilities.hasRealElevation) return 0;
    if (track.maxSlope && track.maxSlope > 0) return track.maxSlope;
    if (track.points && track.points.length > 1) return calculateElevationStats(track.points).maxSlope || 0;
    return 0;
  }, [capabilities.hasRealElevation, track.maxSlope, track.points]);

  const runningSummary = useMemo(() => {
    if (!expanded || !capabilities.isRunning) return null;
    if (!capabilities.hasGapData && !capabilities.hasRtssData && !capabilities.hasPaHrData && !capabilities.hasDbalData && !capabilities.hasCadence) {
      return null;
    }
    return computePauseAwareRunningMetrics(track);
  }, [expanded, capabilities, track]);

  const trackClimbs = useMemo(() => {
    return track.climbs && track.climbs.length > 0 ? track.climbs : findClimbs(track.points || []);
  }, [track.climbs, track.points]);

  const startValidation = useMemo(() => validateTrackStartPoint(track), [track]);
  const komootMeta = useMemo(() => getKomootSourceMeta(track), [track]);
  const colorResolution = useMemo(
    () =>
      resolveSidebarTrackColor(track, {
        autoColorBySurface,
        isMapComparing,
        isMarked,
        isCompared
      }),
    [
      track.color,
      track.surfaceStats,
      track.points,
      track.distance,
      autoColorBySurface,
      isMapComparing,
      isMarked,
      isCompared
    ]
  );

  const cardStyle: React.CSSProperties = colorResolution.isSurfaceColored
    ? { ...style, borderLeftColor: colorResolution.color }
    : style;

  return (
    <div 
      ref={setNodeRef} 
      style={cardStyle}
      data-primary-surface={colorResolution.primarySurface?.surfaceType ?? ''}
      onClick={() => {
        triggerHaptic('light');
        onMark(track.id);
      }}
      className={`group relative cursor-pointer bg-white dark:bg-slate-900 border rounded-xl px-2.5 py-2 transition-colors ${
        colorResolution.isSurfaceColored ? 'border-l-[3px]' : ''
      } ${
        isDragging ? 'shadow-xl opacity-50 bg-slate-50 dark:bg-slate-800' : ''
      } ${
        isMenuOpen ? 'z-30' : 'z-0'
      } ${
        isMarked 
          ? 'border-blue-500/80 dark:border-blue-400/80 bg-blue-50/20 dark:bg-blue-950/20' 
          : isCompared
          ? 'border-orange-500/80 dark:border-orange-400/80 bg-orange-50/20 dark:bg-orange-950/20'
          : 'border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
      }`}
    >
      <div className="flex items-start gap-1.5">
        <div
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="drag-handle p-0.5 mt-0.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-300 group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-400 shrink-0 cursor-grab active:cursor-grabbing transition-colors"
          title="Reihenfolge per Ziehen ändern"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
        
        <div className="flex-1 min-w-0">
          {/* Row 1: Color indicator, full readable title, Visibility + Overflow menu */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                style={{ backgroundColor: colorResolution.color }}
                title={
                  colorResolution.isSurfaceColored && colorResolution.primarySurface
                    ? `Hauptbelag: ${colorResolution.primarySurface.surfaceType} (${colorResolution.primarySurface.percentage}%)`
                    : undefined
                }
              />
              {isMapComparing && isMarked && (
                <span className="shrink-0 text-[9px] font-mono font-bold text-blue-600 dark:text-blue-400">
                  [A]
                </span>
              )}
              {isMapComparing && isCompared && (
                <span className="shrink-0 text-[9px] font-mono font-bold text-orange-600 dark:text-orange-400">
                  [B]
                </span>
              )}
              <span
                className={`text-xs block truncate leading-snug font-semibold ${
                  !track.visible
                    ? 'text-slate-400 dark:text-slate-500 line-through'
                    : isMarked
                    ? 'text-blue-700 dark:text-blue-300'
                    : isCompared
                    ? 'text-orange-700 dark:text-orange-300'
                    : 'text-slate-800 dark:text-slate-100'
                }`}
                title={track.name}
              >
                {track.name}
              </span>
            </div>
            
            <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              {/* Direct Visibility Toggle */}
              <button 
                type="button"
                onClick={() => onToggleVisibility(track.id)} 
                className={`p-1.5 rounded-lg transition-colors cursor-pointer flex items-center justify-center ${
                  track.visible 
                    ? 'text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800' 
                    : 'text-amber-600 bg-amber-50 hover:bg-amber-100 dark:text-amber-400 dark:bg-amber-950/40 dark:hover:bg-amber-900/50'
                }`}
                title={track.visible ? "Auf Karte ausblenden" : "Auf Karte einblenden"}
                aria-label={track.visible ? `"${track.name}" ausblenden` : `"${track.name}" einblenden`}
              >
                {track.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>

              {/* Unified Overflow Actions Menu */}
              <div className="relative" data-sidebar-menu="true">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    onToggleMenu?.(track.id);
                  }}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer flex items-center justify-center ${
                    isMenuOpen
                      ? 'bg-slate-200/80 text-slate-900 dark:bg-slate-700 dark:text-white'
                      : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                  title="Weitere Aktionen"
                  aria-label={`Aktionen für "${track.name}"`}
                  aria-expanded={isMenuOpen}
                  aria-haspopup="menu"
                >
                  {isRefreshingKomoot ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  )}
                </button>

                {isMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full mt-1 w-56 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 shadow-xl py-1 z-50 text-xs max-h-[70vh] overflow-y-auto"
                  >
                    <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Analyse &amp; 3D
                    </div>
                    {onOpenIntensiveAnalysis && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onCloseMenu?.();
                          onOpenIntensiveAnalysis(track.id);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span>Analyse-Cockpit öffnen</span>
                      </button>
                    )}

                    {onOpenVideoExport && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onCloseMenu?.();
                          onOpenVideoExport(track.id);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Video className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>3D-Überflug Studio</span>
                      </button>
                    )}

                    {trackClimbs && trackClimbs.length > 0 && onOpenClimbs && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onCloseMenu?.();
                          onOpenClimbs(track.id);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>Berge ({trackClimbs.length})</span>
                      </button>
                    )}

                    {onOpenAnalytics && capabilities.hasPowerPhysicsTabData && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onCloseMenu?.();
                          onOpenAnalytics(track.id);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <BarChart2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span>{capabilities.isRunning ? 'Laufdaten (GAP/CS)' : 'Leistungsphysik'}</span>
                      </button>
                    )}

                    {onOpenTrainingZones && capabilities.hasZonesTabData && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onCloseMenu?.();
                          onOpenTrainingZones(track.id);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Heart className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        <span>Trainingszonen</span>
                      </button>
                    )}

                    {onOpenRawData && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onCloseMenu?.();
                          onOpenRawData(track.id);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <FileCode className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                        <span>Rohdaten-Inspektor</span>
                      </button>
                    )}

                    <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                    <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Strecke
                    </div>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={(e) => {
                        onCloseMenu?.();
                        handleToggleExpand(e);
                      }}
                      className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {expanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      <span>{expanded ? 'Details einklappen' : 'Details ausklappen'}</span>
                    </button>

                    {onReverseTrack && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onCloseMenu?.();
                          triggerHaptic('medium');
                          onReverseTrack(track.id);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                        <span>Richtung umkehren</span>
                      </button>
                    )}

                    {onOpenTimeGapAnalysis && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onCloseMenu?.();
                          onOpenTimeGapAnalysis(track.id);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Scissors className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span>Zeitlücken analysieren</span>
                      </button>
                    )}

                    {onSanitizeTrack && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onCloseMenu?.();
                          onSanitizeTrack(track.id);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>Track bereinigen</span>
                      </button>
                    )}

                    {onOpenValidation && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onCloseMenu?.();
                          onOpenValidation(track.id);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <span className="flex items-center gap-2">
                          <ShieldCheck className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          <span>GPS prüfen</span>
                        </span>
                        {startValidation.issue && (
                          <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                        )}
                      </button>
                    )}

                    {totalTracks > 1 && !isMarked && onCompareTrackOnMap && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onCloseMenu?.();
                          onCompareTrackOnMap(track.id);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <GitCompare className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                        <span>{isCompared ? 'Vergleich beenden' : 'Auf Karte vergleichen'}</span>
                      </button>
                    )}

                    <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                    <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Datei &amp; Workspace
                    </div>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onCloseMenu?.();
                        handleExportGPX();
                      }}
                      className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                      <span>Als GPX exportieren</span>
                    </button>

                    {onSaveTrackToLibrary && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onCloseMenu?.();
                          onSaveTrackToLibrary(track.id);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Database className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span>In Bibliothek sichern</span>
                      </button>
                    )}

                    <button
                      type="button"
                      role="menuitem"
                      onClick={(e) => {
                        handleCopySummary(e);
                        window.setTimeout(() => onCloseMenu?.(), 350);
                      }}
                      className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {copiedSummary ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      <span>{copiedSummary ? 'Kurzstatistik kopiert' : 'Kurzstatistik kopieren'}</span>
                    </button>

                    {komootMeta && onRefreshKomootTrack && (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={isRefreshingKomoot}
                        onClick={() => {
                          onCloseMenu?.();
                          triggerHaptic('light');
                          onRefreshKomootTrack(track.id);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isRefreshingKomoot ? 'animate-spin' : ''}`} />
                        <span>Komoot aktualisieren (v{komootMeta.version})</span>
                      </button>
                    )}

                    {totalTracks > 1 && onKeepOnlyTrack && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onCloseMenu?.();
                          onKeepOnlyTrack(track.id);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Target className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>Nur diese Tour behalten</span>
                      </button>
                    )}

                    <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onCloseMenu?.();
                        onRemoveTrack(track.id);
                      }}
                      className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Aus Workspace entfernen</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Row 2: Clean unboxed tabular metadata line */}
          <div 
            onClick={handleToggleExpand}
            className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-1 cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            title={expanded ? "Klicken zum Einklappen" : "Klicken zum Ausklappen der Details"}
          >
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {formatDistance(track.distance, unitSystem, lang, 1)}
            </span>
            {capabilities.hasRealElevation && (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatElevation(track.ascent, unitSystem, lang, true)}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span title={track.duration ? 'Aktive Bewegungszeit (ohne Pausen)' : 'Geschätzte Dauer basierend auf Vorgabetempo'}>
              {track.duration ? (
                `${Math.floor(track.duration / 3600)}h ${Math.floor((track.duration % 3600) / 60)}m`
              ) : (
                `~${Math.floor((track.distance / Math.max(0.1, estimatedSpeed)))}h ${Math.floor(((track.distance / Math.max(0.1, estimatedSpeed)) * 60) % 60)}m`
              )}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {track.duration && track.duration > 0 ? (
                track.activityType === 'running'
                  ? formatPaceFromSecPerKm(track.duration / Math.max(0.01, track.distance), unitSystem, true)
                  : formatSpeed(track.distance / (track.duration / 3600), unitSystem, 1)
              ) : (
                track.activityType === 'running'
                  ? `~${formatPaceFromSpeed(estimatedSpeed, unitSystem, true)}`
                  : `~${formatSpeed(estimatedSpeed, unitSystem, 1)}`
              )}
            </span>
            {colorResolution.isSurfaceColored && colorResolution.primarySurface && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className="font-sans font-semibold"
                  style={{ color: colorResolution.primarySurface.color }}
                  title={`Hauptbelag: ${colorResolution.primarySurface.surfaceType} (${colorResolution.primarySurface.percentage}%)`}
                >
                  {colorResolution.primarySurface.surfaceType}
                </span>
              </>
            )}
            {komootMeta && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className="text-emerald-600 dark:text-emerald-400 font-medium"
                  title={`${komootMeta.sourceType === 'komoot' ? 'Komoot-Quelle' : 'GPX-URL-Quelle'} · Version v${komootMeta.version}`}
                >
                  v{komootMeta.version}
                </span>
              </>
            )}
            {startValidation.issue && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onOpenValidation) onOpenValidation(track.id);
                  }}
                  className="text-amber-600 dark:text-amber-400 hover:underline font-sans font-semibold cursor-pointer"
                  title={`Startpunkt-Abweichung: ${startValidation.issue.description}`}
                >
                  Start prüfen
                </button>
              </>
            )}
            {track.isVirtual && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-sans text-orange-600 dark:text-orange-400" title="Keine echten GPS-Koordinaten">
                  Ohne GPS
                </span>
              </>
            )}
          </div>

          {/* Expanded Content Section */}
          {expanded && (
            <div className="pt-2.5 mt-2 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
              {/* Calm 2-Button Quick Strip (Secondary actions live cleanly in the ⋯ menu) */}
              <div className="flex items-center gap-1.5" data-sidebar-menu="true" onClick={(e) => e.stopPropagation()}>
                {onOpenIntensiveAnalysis && (
                  <button
                    type="button"
                    onClick={() => onOpenIntensiveAnalysis(track.id)}
                    className="flex-1 py-1.5 px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 text-[11px] font-semibold"
                    title="Analyse-Cockpit öffnen (Übersicht, Splits, Leistung & Rohdaten)"
                  >
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span>Analyse-Cockpit</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    onToggleMenu?.(track.id);
                  }}
                  className="py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg border border-slate-200/80 dark:border-slate-700 transition-colors cursor-pointer flex items-center justify-center gap-1 text-[11px] font-semibold shrink-0"
                  title="Weitere Aktionen (3D-Flug, Export, Bearbeiten)"
                >
                  <span>Aktionen</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </button>
              </div>
              
              <div className="flex flex-col gap-1.5">
                {/* Bento Grid Row 1: Strecke, Dauer, Pace */}
                <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
                  <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-800/60 rounded-lg px-1.5 py-1 flex flex-col items-center justify-center">
                    <span className="text-[8px] text-slate-400 dark:text-slate-500 font-sans font-semibold uppercase tracking-wider">Strecke</span>
                    <span className="font-extrabold text-slate-700 dark:text-slate-300">
                      {track.distance.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} km
                    </span>
                  </div>
                  <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-800/60 rounded-lg px-1.5 py-1 flex flex-col items-center justify-center">
                    <span className="text-[8px] text-slate-400 dark:text-slate-500 font-sans font-semibold uppercase tracking-wider">Dauer</span>
                    <span className="font-extrabold text-slate-700 dark:text-slate-300">
                      {track.duration ? (
                        `${Math.floor(track.duration / 3600)}h ${Math.floor((track.duration % 3600) / 60)}m`
                      ) : (
                        `${Math.floor((track.distance / estimatedSpeed))}h ${Math.floor(((track.distance / estimatedSpeed) * 60) % 60)}m`
                      )}
                    </span>
                  </div>
                  <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-800/60 rounded-lg px-1.5 py-1 flex flex-col items-center justify-center">
                    <span className="text-[8px] text-slate-400 dark:text-slate-500 font-sans font-semibold uppercase tracking-wider">Tempo</span>
                    <span className="font-extrabold text-slate-700 dark:text-slate-300 truncate max-w-full">
                      {track.duration && track.distance > 0 ? (
                        track.activityType === 'running'
                          ? formatPaceFromSecPerKm(track.duration / track.distance, unitSystem, true)
                          : formatSpeed(track.distance / (track.duration / 3600), unitSystem, 1)
                      ) : (
                        track.activityType === 'running'
                          ? formatPaceFromSpeed(estimatedSpeed, unitSystem, true)
                          : formatSpeed(estimatedSpeed, unitSystem, 1)
                      )}
                    </span>
                  </div>
                </div>

                {/* Bento Grid Row 2: Anstieg, Abstieg, Max. Steigung (only if real elevation exists) */}
                {capabilities.hasRealElevation && (
                  <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
                    <div 
                      onClick={(e) => {
                        e.stopPropagation();
                        const climbs = trackClimbs && trackClimbs.length > 0 ? trackClimbs : findClimbs(track.points || []);
                        if (climbs.length > 0 && onSelection) {
                          const pts = climbs.flatMap(c => track.points.slice(c.startIndex, c.endIndex + 1));
                          if (pts.length > 0) {
                            const lats = pts.map(p => p.lat);
                            const lngs = pts.map(p => p.lng);
                            const minLat = Math.min(...lats);
                            const maxLat = Math.max(...lats);
                            const minLng = Math.min(...lngs);
                            const maxLng = Math.max(...lngs);
                            const latBuf = Math.max((maxLat - minLat) * 0.1, 0.002);
                            const lngBuf = Math.max((maxLng - minLng) * 0.1, 0.002);
                            onSelection({
                              minLat: minLat - latBuf,
                              maxLat: maxLat + latBuf,
                              minLng: minLng - lngBuf,
                              maxLng: maxLng + lngBuf
                            });
                          }
                        }
                      }}
                      className="bg-emerald-500/5 dark:bg-emerald-950/20 border border-emerald-100/50 dark:border-emerald-900/30 rounded-lg px-1.5 py-1 flex flex-col items-center justify-center cursor-pointer hover:bg-emerald-100/40 dark:hover:bg-emerald-900/30 transition-colors"
                      title="Klicken zum Zoomen auf Anstiege auf der Karte"
                    >
                      <span className="text-[8px] text-emerald-600 dark:text-emerald-400 font-sans font-semibold uppercase tracking-wider flex items-center gap-0.5">
                        Anstieg
                      </span>
                      <span className="font-extrabold text-emerald-700 dark:text-emerald-400">
                        {formatElevation(track.ascent, unitSystem, lang, true)}
                      </span>
                    </div>
                    <div className="bg-rose-500/5 dark:bg-rose-950/20 border border-rose-100/50 dark:border-rose-900/30 rounded-lg px-1.5 py-1 flex flex-col items-center justify-center">
                      <span className="text-[8px] text-rose-600 dark:text-rose-400 font-sans font-semibold uppercase tracking-wider flex items-center gap-0.5">
                        Abstieg
                      </span>
                      <span className="font-extrabold text-rose-700 dark:text-rose-400">
                        -{formatElevation(track.descent, unitSystem, lang, false)}
                      </span>
                    </div>
                    <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-800/60 rounded-lg px-1.5 py-1 flex flex-col items-center justify-center">
                      <span className="text-[8px] text-slate-400 dark:text-slate-500 font-sans font-semibold uppercase tracking-wider">Steigung</span>
                      <span className="font-extrabold text-slate-700 dark:text-slate-300">
                        {maxSlopeDisplay.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                      </span>
                    </div>
                  </div>
                )}

                {/* Miscellaneous status bar for HR or point length */}
                <div className="flex items-center justify-between text-[9px] text-slate-400 dark:text-slate-500 font-mono border-t border-slate-100/60 dark:border-slate-800/60 pt-1.5 mt-0.5">
                  <span>{track.points.length.toLocaleString('de-DE')} GPX-Punkte</span>
                  {hasHR && (
                    <span className="flex items-center gap-1 text-[9px] font-semibold text-rose-600 dark:text-rose-400">
                      <Heart className="w-2.5 h-2.5 text-rose-500 fill-rose-500 shrink-0" /> HF-Daten
                    </span>
                  )}
                </div>

                {/* Description/Notes block if present */}
                {track.description && (
                  <div className="bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/60 dark:border-indigo-900/30 rounded-lg p-2 text-[10px] text-slate-700 dark:text-slate-300 leading-normal font-medium text-left">
                    <span className="font-bold text-indigo-600 dark:text-indigo-400 block text-[8px] uppercase tracking-wider mb-0.5">Notiz / Kommentar</span>
                    {track.description}
                  </div>
                )}

                {/* Cycling Power Stats Widget (gated to cycling with power/timing data) */}
                {!capabilities.isRunning && capabilities.hasWbalData && track.powerStats && (
                  <div className="bg-amber-500/5 dark:bg-amber-950/20 border border-amber-100/50 dark:border-amber-900/30 rounded-lg px-2 py-1 flex justify-between items-center text-[10px] font-mono tabular-nums">
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-extrabold text-[8px] uppercase tracking-wider">
                      <Zap className="w-3 h-3 fill-amber-500/10" /> NP Daten
                    </span>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <span className="font-bold text-slate-700 dark:text-slate-200" title="Normalized Power">NP {Math.round(track.powerStats.normalizedPower || 0)}W</span>
                    <span className="font-medium text-slate-500 dark:text-slate-400 text-[9px]">IF {(track.powerStats.intensityFactor || 0).toFixed(2)}</span>
                    <span className="font-medium text-slate-500 dark:text-slate-400 text-[9px]">TSS {Math.round(track.powerStats.tss || 0)}</span>
                  </div>
                )}

                {/* Running Telemetry Strip (gated per real available metric, pause-free) */}
                {capabilities.isRunning && runningSummary?.hasData && (
                  <div className="bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-800/50 rounded-lg px-2 py-1.5 space-y-1 text-[10px] font-mono tabular-nums">
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] font-sans font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                        Lauf-Telemetrie
                      </span>
                      {capabilities.hasRtssData && runningSummary.rTss !== null && runningSummary.rTss > 0 && (
                        <span className="text-[9px] font-bold text-slate-600 dark:text-slate-300" title="Running Training Stress Score (ohne Pausen)">
                          rTSS {Math.round(runningSummary.rTss)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9.5px] text-slate-700 dark:text-slate-200">
                      {capabilities.hasGapData && runningSummary.avgGapPaceFormatted && (
                        <span title="Grade Adjusted Pace (ohne Pausen)">
                          <span className="text-slate-400">GAP </span>
                          <strong>{runningSummary.avgGapPaceFormatted}</strong>
                        </span>
                      )}
                      {capabilities.hasDbalData && (
                        <span title="Critical Speed & minimale D'bal Reserve">
                          <span className="text-slate-400">CS </span>
                          <strong>{runningSummary.criticalPaceFormatted}</strong>
                        </span>
                      )}
                      {capabilities.hasPaHrData && runningSummary.paHrEf !== null && (
                        <span title="Pace-to-HR Efficiency Factor (m/min pro bpm)">
                          <span className="text-slate-400">EF </span>
                          <strong>{runningSummary.paHrEf.toFixed(2)}</strong>
                        </span>
                      )}
                      {capabilities.hasCadence && runningSummary.avgCadenceSpm !== null && (
                        <span title="Durchschnittliche Schrittfrequenz (Schritte/min)">
                          <strong>{Math.round(runningSummary.avgCadenceSpm)} spm</strong>
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Climb Analysis Info Box & Quick Zoom Chips */}
                {trackClimbs && trackClimbs.length > 0 && (
                  <div className="space-y-1">
                    <div 
                      className="bg-indigo-50/30 dark:bg-indigo-950/20 border border-indigo-100/60 dark:border-indigo-900/30 rounded-lg px-2 py-1 flex justify-between items-center text-[10px] font-mono group/climbs cursor-pointer hover:bg-indigo-50/60 dark:hover:bg-indigo-950/30"
                      onClick={(e) => { e.stopPropagation(); onOpenClimbs?.(track.id); }}
                      title="Bergwertungs-Analyse im Cockpit öffnen"
                    >
                      <span className="flex items-center gap-1 text-indigo-700 dark:text-indigo-400 font-extrabold text-[8px] uppercase tracking-wider">
                        <TrendingUp className="w-3 h-3 shrink-0 text-indigo-500" />
                        <span>Anstiege / Berganalyse</span>
                      </span>
                      <span className="font-extrabold text-blue-600 dark:text-blue-400 underline hover:no-underline">
                        {trackClimbs.length} Berge ➔
                      </span>
                    </div>
                    
                    {/* Individual climb quick zoom chips */}
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {trackClimbs.map((climb, cIdx) => (
                        <button
                          key={cIdx}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const climbPts = track.points.slice(climb.startIndex, climb.endIndex + 1);
                            if (climbPts.length > 0 && onSelection) {
                              const lats = climbPts.map(p => p.lat);
                              const lngs = climbPts.map(p => p.lng);
                              const minLat = Math.min(...lats);
                              const maxLat = Math.max(...lats);
                              const minLng = Math.min(...lngs);
                              const maxLng = Math.max(...lngs);
                              const latBuf = Math.max((maxLat - minLat) * 0.1, 0.002);
                              const lngBuf = Math.max((maxLng - minLng) * 0.1, 0.002);
                              onSelection({
                                minLat: minLat - latBuf,
                                maxLat: maxLat + latBuf,
                                minLng: minLng - lngBuf,
                                maxLng: maxLng + lngBuf
                              });
                            }
                          }}
                          className="bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold transition-colors cursor-pointer flex items-center gap-1"
                          title={`Anstieg #${cIdx + 1} auf Karte anzoomen (${formatDistance(climb.distance / 1000, unitSystem, lang, 1)} · +${formatElevation(climb.ascent, unitSystem, lang, false)})`}
                        >
                          <span>🚩 Berg #{cIdx + 1}</span>
                          <span className="text-[8px] text-amber-600 dark:text-amber-400 font-normal">+{formatElevation(climb.ascent, unitSystem, lang, false)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Surface stats presentation */}
                {track.surfaceStats && track.surfaceStats.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-slate-200 dark:bg-slate-800">
                      {track.surfaceStats.map((surface, idx) => {
                        const totalDist = track.surfaceStats!.reduce((sum, s) => sum + s.distance, 0) || 1;
                        const pct = (surface.distance / totalDist) * 100;
                        return (
                          <div 
                            key={idx} 
                            style={{ width: `${pct}%`, backgroundColor: getSurfaceTypeColor(surface.type) }} 
                            title={`${surface.type} (${pct.toFixed(1)}%)`} 
                          />
                        );
                      })}
                    </div>
                    <div className="text-[9.5px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-1 font-mono">
                      {track.surfaceStats.map((surface, idx) => (
                        <span key={idx} className="bg-slate-50 dark:bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-100 dark:border-slate-800 text-[9px] flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getSurfaceTypeColor(surface.type) }}></span>
                          {surface.type}: {surface.distance.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Surface analysis trigger & manual surface override */}
                <div className="pt-1.5 border-t border-slate-100/60 dark:border-slate-800/40 flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 uppercase tracking-wider">
                      <Layers size={10} className="text-slate-400 dark:text-slate-500 stroke-[2.5]" /> Untergrund:
                    </span>
                    <select
                      value={track.surfaceStats && track.surfaceStats.length === 1 ? track.surfaceStats[0].type : ""}
                      onChange={(e) => {
                        e.stopPropagation();
                        if (e.target.value === "osm") {
                          onAnalyzeSurface?.(track.id, true);
                        } else if (e.target.value) {
                          onSetTrackSurface?.(track.id, e.target.value);
                        }
                      }}
                      className="text-[9px] font-medium bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-1 py-0.5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                      title="Untergrundtyp manuell festlegen oder per Valhalla & OSM analysieren"
                    >
                      <option value="">Status / Typ wählen...</option>
                      <option value="osm">🌐 Per Valhalla &amp; OSM analysieren</option>
                      <option value="Asphalt">Asphalt (100%)</option>
                      <option value="Schotter">Schotter / Gravel (100%)</option>
                      <option value="Fahrradweg">Fahrradweg (100%)</option>
                      <option value="Waldweg">Waldweg (100%)</option>
                      <option value="Unbekannt">Unbekannt zurücksetzen</option>
                    </select>
                  </div>

                  {/* Status Feedback Badge / Card */}
                  {surfaceStatus && surfaceStatus.status !== 'idle' && (
                    <div className={`p-1.5 rounded-md text-[10px] flex items-start gap-1.5 border shadow-sm ${
                      surfaceStatus.status === 'loading'
                        ? 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/80 text-blue-800 dark:text-blue-200'
                        : surfaceStatus.status === 'success'
                        ? 'bg-emerald-50/90 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-200'
                        : surfaceStatus.status === 'partial'
                        ? 'bg-amber-50/90 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/80 text-amber-800 dark:text-amber-200'
                        : 'bg-rose-50/90 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800/80 text-rose-800 dark:text-rose-200'
                    }`}>
                      {surfaceStatus.status === 'loading' && <Loader2 size={13} className="animate-spin shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />}
                      {surfaceStatus.status === 'success' && <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />}
                      {surfaceStatus.status === 'partial' && <Info size={13} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />}
                      {surfaceStatus.status === 'error' && <AlertTriangle size={13} className="shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />}

                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-[10px] flex items-center justify-between">
                          <span>
                            {surfaceStatus.status === 'loading' && "Analyse läuft..."}
                            {surfaceStatus.status === 'success' && "Valhalla & OSM abgeschlossen"}
                            {surfaceStatus.status === 'partial' && "Teilweise erfasst"}
                            {surfaceStatus.status === 'error' && "Analyse-Fehler"}
                          </span>
                          {surfaceStatus.timestamp && (
                            <span className="text-[8.5px] font-normal opacity-70 ml-1">
                              {new Date(surfaceStatus.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                        {surfaceStatus.message && (
                          <p className="text-[9px] opacity-90 mt-0.5 leading-tight">{surfaceStatus.message}</p>
                        )}
                      </div>

                      {(surfaceStatus.status === 'error' || (surfaceStatus.status === 'partial' && surfaceStatus.coveragePct === 0)) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAnalyzeSurface?.(track.id, true);
                          }}
                          className={`px-2 py-0.5 text-white rounded text-[9px] font-bold shrink-0 transition-colors cursor-pointer ${
                            surfaceStatus.status === 'error' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'
                          }`}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}

                  {/* Permanent action button */}
                  <button
                    type="button"
                    disabled={isAnalyzing}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAnalyzeSurface?.(track.id, true);
                    }}
                    className={`w-full flex items-center justify-center gap-1.5 text-[10px] font-bold px-2 py-1.5 rounded-md transition-colors cursor-pointer select-none border shadow-xs ${
                      isAnalyzing
                        ? "bg-blue-100/60 text-blue-700 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-700 cursor-wait"
                        : "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/60 border-blue-200 dark:border-blue-800/50"
                    }`}
                    title="Straßen- und Geländebeschaffenheit per Valhalla Map-Matching & OpenStreetMap analysieren"
                  >
                    <RefreshCw size={11} className={isAnalyzing ? "animate-spin text-blue-600 dark:text-blue-400" : ""} />
                    {isAnalyzing ? "Valhalla & OSM läuft..." : "Oberflächen analysieren (Valhalla & OSM)"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

interface SidebarProps {
  tracks: GPXTrack[];
  markedTrackId: string | null;
  compareTrackId?: string | null;
  onStartMapComparison?: (track1Id?: string, track2Id?: string) => void;
  onExitMapComparison?: () => void;
  onMarkTrack: (id: string) => void;
  onChangeActivityType?: (id: string, type: 'cycling' | 'running') => void;
  onUpload: (files: FileList | File[] | React.ChangeEvent<HTMLInputElement>) => Promise<void> | void;
  onImportUrl?: (url: string, options: { saveAsPlannedTour: boolean }) => Promise<UrlImportSubmitResult>;
  uploadProgress?: UploadProgressInfo | null;
  onToggleVisibility: (id: string) => void;
  onRemoveTrack: (id: string) => void;
  onClearAllTracks?: () => void;
  onKeepOnlyTrack?: (id: string) => void;
  onRemoveHiddenTracks?: () => void;
  onRemoveDuplicateTracks?: () => void;
  onMergeSelected: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onReorder: (oldIndex: number, newIndex: number) => void;
  activeLayer: MapLayer;
  setActiveLayer: (layer: MapLayer) => void;
  is3D: boolean;
  setIs3D: (mode: boolean) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
  estimatedSpeed: number;
  setEstimatedSpeed: (speed: number) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  selectedTime: string;
  setSelectedTime: (time: string) => void;
  ftp: number;
  setFtp: (ftp: number) => void;
  userWeight: number;
  setUserWeight: (weight: number) => void;
  userAge: number;
  setUserAge: (age: number) => void;
  userMaxHr: number;
  setUserMaxHr: (maxHr: number) => void;
  suggestedFtp: number | null;
  onOpenComparison: () => void;
  onOpenGarminHealth?: () => void;
  onOpenGarminActivitiesAnalysis?: () => void;
  onOpenPerformanceAnalysis?: () => void;
  onOpenTrainingZones?: (id?: string) => void;
  onOpenSummaryReport?: (id?: string) => void;
  onOpenIntensiveAnalysis?: (id?: string) => void;
  onOpenSportsMetrics?: (id?: string) => void;
  onOpenVideoExport?: (id?: string) => void;
  onOpenGlossary?: (metricId?: string) => void;
  onOpenAnalytics: (id: string) => void;
  onOpenClimbs: (id: string) => void;
  onOpenWeather?: () => void;
  onOpenRawData?: (id: string) => void;
  onOpenTimeGapAnalysis?: (id?: string) => void;
  onReverseTrack?: (id: string) => void;
  onSanitizeTrack?: (id: string) => void;
  onOpenValidation?: (id: string) => void;
  textMarkers: TextMarker[];
  onAddTextMarker: (marker: Omit<TextMarker, 'id'>) => void;
  onDeleteTextMarker: (id: string) => void;
  onUpdateTextMarker: (id: string, updates: Partial<TextMarker>) => void;
  hoveredPoint: any;
  onMapViewChange: (view: {lat: number, lng: number, zoom: number, pitch: number, bearing: number}) => void;
  onAnalyzeSurface?: (id: string, force?: boolean) => void;
  onSetTrackSurface?: (id: string, surfaceType: string) => void;
  analyzingSurfaces?: Record<string, boolean>;
  surfaceAnalysisStatuses?: Record<string, any>;
  onLoadLibraryTrack?: (track: GPXTrack) => void;
  onSaveTrackToLibrary?: (id: string) => void;
  selectionBounds?: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null;
  onSelection?: (bounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null) => void;
  onClearSelection?: () => void;
  isDark?: boolean;
  onToggleTheme?: () => void;
  onOpenShortcuts?: () => void;
  onToggleAllVisibility?: (makeAllVisible: boolean) => void;
  onFitVisibleTracks?: (bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }) => void;
  onLockApp?: () => void;
  onOpenFullActivitiesView?: () => void;
  onOpenPlannedToursView?: () => void;
  onRefreshKomootTrack?: (id: string) => void;
  refreshingKomootTracks?: Record<string, boolean>;
  onRefreshAllKomootTracks?: () => void;
  bulkKomootRefreshProgress?: { active: boolean; current: number; total: number } | null;
  autoColorBySurface?: boolean;
  onToggleAutoColorBySurface?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  tracks, 
  markedTrackId,
  compareTrackId = null,
  onStartMapComparison,
  onExitMapComparison,
  onMarkTrack,
  onChangeActivityType,
  onUpload,
  onImportUrl,
  uploadProgress,
  onToggleVisibility, 
  onRemoveTrack, 
  onClearAllTracks,
  onKeepOnlyTrack,
  onRemoveHiddenTracks,
  onRemoveDuplicateTracks,
  onMergeSelected,
  onUndo,
  canUndo,
  onReorder,
  activeLayer,
  setActiveLayer,
  is3D,
  setIs3D,
  isCollapsed,
  onToggleCollapse,
  isMobileMenuOpen,
  setIsMobileMenuOpen,
  estimatedSpeed,
  setEstimatedSpeed,
  selectedDate,
  setSelectedDate,
  selectedTime,
  setSelectedTime,
  ftp,
  setFtp,
  userWeight,
  setUserWeight,
  userAge,
  setUserAge,
  userMaxHr,
  setUserMaxHr,
  suggestedFtp,
  onOpenComparison,
  onOpenGarminHealth,
  onOpenGarminActivitiesAnalysis,
  onOpenPerformanceAnalysis,
  onOpenTrainingZones,
  onOpenSummaryReport,
  onOpenIntensiveAnalysis,
  onOpenSportsMetrics,
  onOpenVideoExport,
  onOpenGlossary,
  onOpenShortcuts,
  onOpenAnalytics,
  onOpenClimbs,
  onOpenWeather,
  onOpenRawData,
  onOpenTimeGapAnalysis,
  onReverseTrack,
  onSanitizeTrack,
  onOpenValidation,
  textMarkers,
  onAddTextMarker,
  onDeleteTextMarker,
  onUpdateTextMarker,
  hoveredPoint,
  onMapViewChange,
  onAnalyzeSurface,
  onSetTrackSurface,
  analyzingSurfaces,
  surfaceAnalysisStatuses,
  onLoadLibraryTrack,
  onSaveTrackToLibrary,
  selectionBounds,
  onSelection,
  onClearSelection,
  isDark,
  onToggleTheme,
  onToggleAllVisibility,
  onFitVisibleTracks,
  onLockApp,
  onOpenFullActivitiesView,
  onOpenPlannedToursView,
  onRefreshKomootTrack,
  refreshingKomootTracks,
  onRefreshAllKomootTracks,
  bulkKomootRefreshProgress,
  autoColorBySurface = true,
  onToggleAutoColorBySurface
}) => {
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'library'>('active');
  const [expandedTrackMap, setExpandedTrackMap] = useState<Record<string, boolean>>({});
  const [activityFilter, setActivityFilter] = useState<WorkspaceActivityFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<WorkspaceSourceFilter>('all');
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState('');
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-sidebar-menu="true"]')) return;
      setOpenMenuId(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuId(null);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuId]);

  const workspaceTotals = useMemo(() => {
    const totalDist = tracks.reduce((sum, t) => sum + (Number.isFinite(t.distance) ? t.distance : 0), 0);
    const totalAscent = tracks.reduce((sum, t) => sum + (Number.isFinite(t.ascent) ? t.ascent : 0), 0);
    const hiddenCount = tracks.filter((t) => !t.visible).length;
    return { totalDist, totalAscent, hiddenCount };
  }, [tracks]);

  const activeSurfaceLegend = useMemo(() => {
    if (!autoColorBySurface) return [];
    const present = new Set<string>();
    for (const track of tracks) {
      const info = getPrimarySurfaceInfo(track);
      if (info) present.add(info.surfaceType);
    }
    if (present.size === 0) return [];
    return SURFACE_COLOR_LEGEND.filter((item) => present.has(item.surfaceType));
  }, [tracks, autoColorBySurface]);

  const filteredTracks = useMemo(() => {
    return filterWorkspaceTracks(tracks, {
      query: workspaceSearchQuery,
      activityFilter,
      sourceFilter
    });
  }, [tracks, workspaceSearchQuery, activityFilter, sourceFilter]);

  const cyclingCount = useMemo(() => tracks.filter(t => t.activityType === 'cycling').length, [tracks]);
  const runningCount = useMemo(() => tracks.filter(t => t.activityType === 'running').length, [tracks]);
  const komootTrackCount = useMemo(() => tracks.filter(t => Boolean(getKomootSourceMeta(t)?.sourceUrl)).length, [tracks]);
  const hasActiveWorkspaceFilter = workspaceSearchQuery.trim().length > 0 || activityFilter !== 'all' || sourceFilter !== 'all';

  const duplicateAnalysis = useMemo(
    () => findDuplicateTracksByIdenticalGPS(tracks, markedTrackId),
    [tracks, markedTrackId]
  );
  const duplicateTrackCount = duplicateAnalysis.duplicateIds.length;

  const allTracksExpanded = useMemo(() => {
    if (tracks.length === 0) return false;
    return tracks.every(t => expandedTrackMap[t.id] === true);
  }, [tracks, expandedTrackMap]);

  const handleToggleExpandAll = () => {
    if (allTracksExpanded) {
      setExpandedTrackMap({});
    } else {
      const nextMap: Record<string, boolean> = {};
      tracks.forEach(t => { nextMap[t.id] = true; });
      setExpandedTrackMap(nextMap);
    }
  };
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [latestBuildDate, setLatestBuildDate] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  // Load latest version on startup
  useEffect(() => {
    const fetchLatestVersion = async () => {
      try {
        const apiUrl = getApiUrl('/api/versions');
        const res = await apiFetch(apiUrl);
        if (!res.ok) return;
        const text = await res.text();
        if (!text || !text.trim().startsWith('{')) return;
        const data = JSON.parse(text);
        if (data.success && Array.isArray(data.versions) && data.versions.length > 0) {
          try {
            const dateObj = new Date(data.versions[0].updated_at);
            setLatestBuildDate(dateObj.toLocaleString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            }));
          } catch (err) {
            setLatestBuildDate(data.versions[0].updated_at);
          }
        }
      } catch (e) {
        console.warn('Unable to load latest version in sidebar:', e);
      }
    };
    fetchLatestVersion();
  }, []);

  // Auto-switch to Library tab when user draws a selection bound
  useEffect(() => {
    if (selectionBounds) {
      setActiveTab('library');
    }
  }, [selectionBounds]);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const markedTrack = tracks.find(t => t.id === markedTrackId);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = tracks.findIndex(t => t.id === active.id);
      const newIndex = tracks.findIndex(t => t.id === over.id);
      onReorder(oldIndex, newIndex);
    }
  };

  return (
    <>
      {/* Mobile Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setIsMobileMenuOpen(false)}
            className="fixed inset-0 bg-slate-950/55 z-[1050] md:hidden"
          />
        )}
      </AnimatePresence>

      <div className={`
        fixed inset-y-0 left-0 z-[1060] md:z-[80] transition-transform duration-200 ease-out will-change-transform md:transition-[width]
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0
        w-[88vw] max-w-[340px] md:w-auto bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-2xl md:shadow-none
        ${isCollapsed ? 'md:w-0 md:border-r-0 md:shadow-none md:bg-transparent dark:md:bg-transparent' : 'md:w-80 md:shadow-2xl md:bg-white dark:md:bg-slate-900 md:border-r md:border-slate-200 dark:md:border-slate-800'}
        h-full flex flex-col overflow-visible
      `}>
        {/* Toggle Collapse Button (remains interactive and visible when collapsed to 0 width) */}
        <button 
          onClick={onToggleCollapse}
          style={{ right: isCollapsed ? '-20px' : '-12px' }}
          className="absolute top-1/2 -translate-y-1/2 w-6 h-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-full hidden md:flex items-center justify-center shadow-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-all z-[90] group cursor-pointer"
          title={isCollapsed ? "Menü ausklappen" : "Menü einklappen"}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4 text-slate-600 dark:text-slate-300 group-hover:scale-110 transition-transform" /> : <ChevronLeft className="w-4 h-4 text-slate-600 dark:text-slate-300 group-hover:scale-110 transition-transform" />}
        </button>

        {/* Inner Content Wrapper */}
        <div className={`w-full md:w-80 h-full flex flex-col relative shrink-0 transition-opacity bg-white dark:bg-slate-900 duration-300 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] ${isCollapsed ? 'md:opacity-0 md:pointer-events-none' : 'opacity-100'}`}>
          {/* Mobile Close Button */}
          <button 
            type="button"
            aria-label="Menü schließen"
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden absolute right-3 top-3 min-h-[44px] min-w-[44px] flex items-center justify-center p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl z-50 touch-manipulation active:scale-95 shadow-xs"
          >
            <X size={20} />
          </button>

          <div className="relative z-10 pl-5 pr-16 md:hidden py-4 bg-slate-900 text-white flex justify-between items-center border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <Layers className="w-5 h-5 text-blue-400 shrink-0" />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight whitespace-nowrap leading-none">GPX Master</h1>
                <p className="text-[9px] text-slate-400 uppercase tracking-widest mt-1">OSM Pro Tools</p>
              </div>
            </div>
            
            <div className="flex items-center gap-1.5">
              {onToggleTheme && (
                <button 
                  onClick={onToggleTheme}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-all cursor-pointer shadow border border-slate-700/60 flex items-center justify-center group shrink-0"
                  title={isDark ? "In hellen Modus wechseln" : "In dunklen Modus wechseln"}
                >
                  {isDark ? (
                    <Sun className="w-4 h-4 text-amber-400 group-hover:rotate-45 transition-transform" />
                  ) : (
                    <Moon className="w-4 h-4 text-slate-300 group-hover:-rotate-12 transition-transform" />
                  )}
                </button>
              )}
              {onLockApp && (
                <button
                  type="button"
                  onClick={onLockApp}
                  className="p-2 bg-slate-800 hover:bg-rose-950/80 text-slate-300 hover:text-rose-300 rounded-xl transition-all cursor-pointer shadow border border-slate-700/60 hover:border-rose-800/70 flex items-center justify-center shrink-0"
                  title="App sperren (Passwortschutz aktivieren)"
                  aria-label="App sperren"
                  id="btn-sidebar-lock-app"
                >
                  <Lock className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="relative z-10 flex-1 overflow-y-auto p-3.5 space-y-5">
            <section id="section-batch-upload">
              <BatchGpxUploader
                onUpload={onUpload}
                onImportUrl={onImportUrl}
                uploadProgress={uploadProgress}
                isDark={isDark}
              />
            </section>

            {/* Opened Tracks & Library right below compact upload bar */}
            <section id="section-opened-tracks" className="space-y-3">
              <div className="flex border-b border-slate-200 dark:border-slate-800 pb-0.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('active')}
                  className={`flex-1 pb-2 text-[10px] font-black uppercase tracking-wider text-center border-b-2 transition-all cursor-pointer ${
                    activeTab === 'active'
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-extrabold'
                      : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                  }`}
                >
                  Workspace ({tracks.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('library')}
                  className={`flex-1 pb-2 text-[10px] font-black uppercase tracking-wider text-center border-b-2 transition-all cursor-pointer ${
                    activeTab === 'library'
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-extrabold'
                      : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                  }`}
                >
                  Bibliothek
                </button>
              </div>

              {activeTab === 'active' && (
                <div className="space-y-3">
                  {tracks.length > 0 && (
                    <div className="space-y-2">
                      {/* Compact 1-Line Expandable Workspace Summary Strip */}
                      <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setIsSummaryExpanded((prev) => !prev)}
                          className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                          aria-expanded={isSummaryExpanded}
                          id="btn-toggle-workspace-summary"
                        >
                          <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300 min-w-0 truncate">
                            <span className="font-semibold text-slate-800 dark:text-slate-100">
                              {workspaceTotals.totalDist.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>+{Math.round(workspaceTotals.totalAscent).toLocaleString('de-DE')} m</span>
                            {workspaceTotals.hiddenCount > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-sans text-amber-600 dark:text-amber-400">
                                  {workspaceTotals.hiddenCount} verborgen
                                </span>
                              </>
                            )}
                          </div>
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 shrink-0">
                            <span>Übersicht</span>
                            {isSummaryExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </span>
                        </button>

                        {isSummaryExpanded && (
                          <div className="p-2 border-t border-slate-200/70 dark:border-slate-800">
                            <WorkspaceSummaryDashboard
                              tracks={tracks}
                              userWeight={userWeight}
                              estimatedSpeed={estimatedSpeed}
                              variant="sidebar"
                              isDark={isDark}
                              markedTrackId={markedTrackId}
                              compareTrackId={compareTrackId}
                              onMarkTrack={onMarkTrack}
                              onStartMapComparison={onStartMapComparison}
                              onExitMapComparison={onExitMapComparison}
                              onToggleTrackVisibility={onToggleVisibility}
                              onToggleAllVisibility={onToggleAllVisibility}
                              onFitVisibleTracks={onFitVisibleTracks}
                              onClearAllTracks={onClearAllTracks}
                              onOpenIntensiveAnalysis={onOpenIntensiveAnalysis}
                            />
                          </div>
                        )}
                      </div>

                      {/* Streamlined Workspace Header + Unified Bulk Actions Menu */}
                      <div className="flex items-center justify-between gap-2 px-0.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                            Strecken <span className="font-mono tabular-nums text-slate-400">({tracks.length})</span>
                          </span>
                          {bulkKomootRefreshProgress?.active && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              <span>{bulkKomootRefreshProgress.current}/{bulkKomootRefreshProgress.total}</span>
                            </span>
                          )}
                        </div>

                        <div className="relative" data-sidebar-menu="true">
                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic('light');
                              setOpenMenuId((prev) => (prev === 'workspace-bulk' ? null : 'workspace-bulk'));
                            }}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                              openMenuId === 'workspace-bulk'
                                ? 'bg-slate-200/80 text-slate-900 dark:bg-slate-700 dark:text-white'
                                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800'
                            }`}
                            title="Workspace-Aktionen öffnen"
                            aria-label="Workspace-Aktionen"
                            aria-expanded={openMenuId === 'workspace-bulk'}
                            aria-haspopup="menu"
                            id="btn-sidebar-workspace-menu"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>

                          {openMenuId === 'workspace-bulk' && (
                            <div
                              role="menu"
                              className="absolute right-0 top-full mt-1 w-56 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 shadow-xl py-1 z-50 text-xs"
                            >
                              {komootTrackCount > 0 && onRefreshAllKomootTracks && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={Boolean(bulkKomootRefreshProgress?.active)}
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    triggerHaptic('light');
                                    onRefreshAllKomootTracks();
                                  }}
                                  className="w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer disabled:opacity-50"
                                  id="btn-sidebar-refresh-all-komoot"
                                >
                                  <span className="flex items-center gap-2">
                                    <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${bulkKomootRefreshProgress?.active ? 'animate-spin' : ''}`} />
                                    <span>Komoot aktualisieren</span>
                                  </span>
                                  <span className="font-mono tabular-nums text-[11px] opacity-80">{komootTrackCount}</span>
                                </button>
                              )}

                              {onToggleAutoColorBySurface && (
                                <button
                                  type="button"
                                  role="menuitemcheckbox"
                                  aria-checked={autoColorBySurface}
                                  id="btn-sidebar-toggle-surface-color"
                                  onClick={() => {
                                    triggerHaptic('light');
                                    onToggleAutoColorBySurface();
                                  }}
                                  className="w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                >
                                  <span className="flex items-center gap-2">
                                    <Layers className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    <span>Nach Untergrund färben</span>
                                  </span>
                                  {autoColorBySurface && (
                                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                  )}
                                </button>
                              )}

                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  handleToggleExpandAll();
                                }}
                                className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                              >
                                {allTracksExpanded ? (
                                  <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                )}
                                <span>{allTracksExpanded ? 'Alle Details einklappen' : 'Alle Details ausklappen'}</span>
                              </button>

                              {(tracks.some(t => !t.visible) || tracks.length > 1) && (
                                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                              )}

                              {tracks.some(t => !t.visible) && onRemoveHiddenTracks && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    onRemoveHiddenTracks();
                                  }}
                                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors cursor-pointer"
                                >
                                  <EyeOff className="w-3.5 h-3.5 shrink-0" />
                                  <span>Ausgeblendete entfernen</span>
                                </button>
                              )}

                              {tracks.length > 1 && markedTrackId && onKeepOnlyTrack && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    onKeepOnlyTrack(markedTrackId);
                                  }}
                                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                >
                                  <Target className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span>Nur aktive Strecke behalten</span>
                                </button>
                              )}

                              {tracks.length > 1 && onRemoveDuplicateTracks && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  id="btn-sidebar-remove-duplicates"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    triggerHaptic('medium');
                                    onRemoveDuplicateTracks();
                                  }}
                                  className="w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                >
                                  <span className="flex items-center gap-2">
                                    <CopyCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    <span>Duplikate entfernen</span>
                                  </span>
                                  {duplicateTrackCount > 0 && (
                                    <span className="font-mono tabular-nums text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                      {duplicateTrackCount}
                                    </span>
                                  )}
                                </button>
                              )}

                              {onClearAllTracks && (
                                <>
                                  <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                                  <button
                                    type="button"
                                    role="menuitem"
                                    id="btn-sidebar-clear-all-tracks"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      onClearAllTracks();
                                    }}
                                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                    <span>Alle Strecken entfernen</span>
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {activeSurfaceLegend.length > 0 && (
                        <div
                          className="flex items-center flex-wrap gap-x-2.5 gap-y-1 px-0.5 text-[10px] text-slate-500 dark:text-slate-400"
                          aria-label="Belagsfarben"
                          id="sidebar-surface-color-legend"
                        >
                          {activeSurfaceLegend.map((entry) => (
                            <span key={entry.surfaceType} className="inline-flex items-center gap-1">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: entry.color }}
                              />
                              <span>{entry.surfaceType}</span>
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Workspace Search & Quick Filter Bar */}
                      {tracks.length >= 2 && (
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            value={workspaceSearchQuery}
                            onChange={(e) => setWorkspaceSearchQuery(e.target.value)}
                            placeholder={`Workspace durchsuchen (${tracks.length} Tracks)...`}
                            className="w-full pl-8 pr-7 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-lg text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400"
                            aria-label="Workspace-Tracks durchsuchen"
                            id="input-workspace-track-search"
                          />
                          {workspaceSearchQuery && (
                            <button
                              type="button"
                              onClick={() => setWorkspaceSearchQuery('')}
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                              title="Suche leeren"
                              aria-label="Suche leeren"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}

                      {/* Activity & Source Filter Chips */}
                      {((cyclingCount > 0 && runningCount > 0) || komootTrackCount > 0) && tracks.length >= 2 && (
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar select-none">
                          <button
                            type="button"
                            onClick={() => {
                              setActivityFilter('all');
                              setSourceFilter('all');
                            }}
                            className={`min-h-[30px] px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shrink-0 touch-manipulation active:scale-95 cursor-pointer ${
                              activityFilter === 'all' && sourceFilter === 'all'
                                ? 'bg-indigo-600 text-white shadow-xs'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                          >
                            Alle ({tracks.length})
                          </button>
                          {cyclingCount > 0 && runningCount > 0 && (
                            <>
                              <button
                                type="button"
                                onClick={() => setActivityFilter((prev) => (prev === 'cycling' ? 'all' : 'cycling'))}
                                className={`min-h-[30px] px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shrink-0 touch-manipulation active:scale-95 flex items-center gap-1 cursor-pointer ${
                                  activityFilter === 'cycling'
                                    ? 'bg-blue-600 text-white shadow-xs'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                }`}
                              >
                                <span>🚴 Rad</span>
                                <span className="text-[9.5px] opacity-80">({cyclingCount})</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setActivityFilter((prev) => (prev === 'running' ? 'all' : 'running'))}
                                className={`min-h-[30px] px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shrink-0 touch-manipulation active:scale-95 flex items-center gap-1 cursor-pointer ${
                                  activityFilter === 'running'
                                    ? 'bg-emerald-600 text-white shadow-xs'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                }`}
                              >
                                <span>🏃 Lauf</span>
                                <span className="text-[9.5px] opacity-80">({runningCount})</span>
                              </button>
                            </>
                          )}
                          {komootTrackCount > 0 && (
                            <button
                              type="button"
                              onClick={() => setSourceFilter((prev) => (prev === 'komoot' ? 'all' : 'komoot'))}
                              className={`min-h-[30px] px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shrink-0 touch-manipulation active:scale-95 flex items-center gap-1 cursor-pointer ${
                                sourceFilter === 'komoot'
                                  ? 'bg-emerald-600 text-white shadow-xs'
                                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
                              }`}
                            >
                              <span>Komoot</span>
                              <span className="text-[9.5px] opacity-80">({komootTrackCount})</span>
                            </button>
                          )}
                        </div>
                      )}

                      {hasActiveWorkspaceFilter && filteredTracks.length > 0 && (
                        <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 px-0.5">
                          <span>{filteredTracks.length} von {tracks.length} Tracks angezeigt</span>
                          <button
                            type="button"
                            onClick={() => {
                              setWorkspaceSearchQuery('');
                              setActivityFilter('all');
                              setSourceFilter('all');
                            }}
                            className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer"
                          >
                            Filter zurücksetzen
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {tracks.length === 0 && (
                    <div className="text-center py-5 px-4 bg-slate-50/80 dark:bg-slate-900/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 space-y-2">
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Noch keine Routen im Workspace geöffnet.</p>
                      {onOpenPlannedToursView && (
                        <button
                          type="button"
                          onClick={onOpenPlannedToursView}
                          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 rounded-xl shadow-sm transition-all cursor-pointer"
                        >
                          <Compass className="w-4 h-4 text-emerald-100" />
                          Geplante Touren öffnen
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setActiveTab('library')}
                        className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-indigo-700 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200/80 dark:border-indigo-800 active:scale-95 rounded-xl shadow-2xs transition-all cursor-pointer"
                      >
                        <Sparkles className="w-4 h-4 text-indigo-500" />
                        Bibliothek öffnen
                      </button>
                    </div>
                  )}
                  {tracks.length > 0 && filteredTracks.length === 0 && (
                    <div className="text-center py-5 px-3 bg-slate-50/50 dark:bg-slate-900/20 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 space-y-2">
                      <p className="text-xs text-slate-500 dark:text-slate-400">Keine passenden Tracks für die aktuelle Suche/Filterung gefunden.</p>
                      <button
                        type="button"
                        onClick={() => {
                          setWorkspaceSearchQuery('');
                          setActivityFilter('all');
                          setSourceFilter('all');
                        }}
                        className="px-3 py-1 rounded-lg text-[11px] font-bold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/70 transition-colors cursor-pointer"
                      >
                        Filter zurücksetzen
                      </button>
                    </div>
                  )}
                  <DndContext 
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext 
                      items={filteredTracks.map(t => t.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {filteredTracks.map((track) => (
                          <SortableTrackItem 
                            key={track.id} 
                            track={track} 
                            isMarked={markedTrackId === track.id}
                            isCompared={compareTrackId === track.id}
                            isMapComparing={Boolean(compareTrackId)}
                            isExpanded={expandedTrackMap[track.id] || false}
                            onToggleExpand={(id) => setExpandedTrackMap(prev => ({ ...prev, [id]: !prev[id] }))}
                            onMark={onMarkTrack}
                            onCompareTrackOnMap={onStartMapComparison ? (id) => {
                              if (compareTrackId === id && onExitMapComparison) {
                                onExitMapComparison();
                              } else {
                                onStartMapComparison(markedTrackId || undefined, id);
                              }
                            } : undefined}
                            onToggleVisibility={onToggleVisibility} 
                            onRemoveTrack={onRemoveTrack} 
                            onKeepOnlyTrack={onKeepOnlyTrack}
                            totalTracks={tracks.length}
                            onChangeActivityType={onChangeActivityType}
                            estimatedSpeed={estimatedSpeed}
                            onOpenAnalytics={onOpenAnalytics}
                            onOpenIntensiveAnalysis={onOpenIntensiveAnalysis}
                            onOpenVideoExport={onOpenVideoExport}
                            onOpenTrainingZones={onOpenTrainingZones}
                            onOpenClimbs={onOpenClimbs}
                            onAnalyzeSurface={onAnalyzeSurface}
                            onSetTrackSurface={onSetTrackSurface}
                            isAnalyzing={analyzingSurfaces?.[track.id] || false}
                            surfaceStatus={surfaceAnalysisStatuses?.[track.id]}
                            onSaveTrackToLibrary={onSaveTrackToLibrary}
                            onOpenRawData={onOpenRawData}
                            onOpenTimeGapAnalysis={onOpenTimeGapAnalysis}
                            onReverseTrack={onReverseTrack}
                            onSanitizeTrack={onSanitizeTrack}
                            onOpenValidation={onOpenValidation}
                            onRefreshKomootTrack={onRefreshKomootTrack}
                            isRefreshingKomoot={Boolean(refreshingKomootTracks?.[track.id])}
                            isMenuOpen={openMenuId === track.id}
                            onToggleMenu={(id) => setOpenMenuId((prev) => (prev === id ? null : id))}
                            onCloseMenu={() => setOpenMenuId(null)}
                            autoColorBySurface={autoColorBySurface}
                            onSelection={onSelection}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              )}

              {activeTab === 'library' && (
                <div className="pb-3 space-y-2.5">
                  {onOpenFullActivitiesView && (
                    <button
                      type="button"
                      onClick={onOpenFullActivitiesView}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/80 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors cursor-pointer"
                    >
                      <span>Vollbild-Aktivitäten öffnen</span>
                      <ChevronRight size={14} />
                    </button>
                  )}
                  <TrackLibrary 
                    onLoadTrack={(track) => {
                      onLoadLibraryTrack?.(track);
                      setActiveTab('active');
                    }}
                    onActiveTrackId={markedTrackId}
                    selectionBounds={selectionBounds}
                    onClearSelection={onClearSelection}
                    workspaceTracks={tracks}
                    onOpenFullView={onOpenFullActivitiesView}
                  />
                </div>
              )}
            </section>

            {/* Lightweight Sport & Fitness Metrics Quick-Glance Card */}
            {tracks.length > 0 && (
              <SidebarSportsMetricsCard
                track={markedTrack || tracks.find(t => t.visible) || tracks[0]}
                ftp={ftp}
                userWeight={userWeight}
                userMaxHr={userMaxHr}
                estimatedSpeed={estimatedSpeed}
                onOpenFullMetrics={onOpenSportsMetrics || onOpenIntensiveAnalysis}
              />
            )}

            <section className="space-y-2.5 border-t border-slate-100 dark:border-slate-800 pt-3">
              <div className="flex justify-between items-center">
                <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Werkzeuge</h2>
                {canUndo && (
                  <button
                    type="button"
                    onClick={onUndo}
                    className="flex items-center gap-1 text-[10px] text-blue-600 font-bold hover:bg-blue-100 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400 px-2 py-0.5 rounded transition-colors cursor-pointer"
                  >
                    <Undo2 className="w-3 h-3" /> Rückgängig
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 relative" data-sidebar-menu="true">
                {onOpenIntensiveAnalysis && (
                  <button
                    type="button"
                    onClick={() => onOpenIntensiveAnalysis(markedTrackId || undefined)}
                    disabled={tracks.length === 0}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:cursor-not-allowed shadow-xs transition-colors cursor-pointer"
                    title="Analyse-Cockpit & Pacing-Engine öffnen"
                  >
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span>Analyse-Cockpit</span>
                  </button>
                )}

                <button
                  type="button"
                  id="btn-sidebar-tools-menu"
                  onClick={() => {
                    triggerHaptic('light');
                    setOpenMenuId((prev) => (prev === 'sidebar-tools' ? null : 'sidebar-tools'));
                  }}
                  aria-expanded={openMenuId === 'sidebar-tools'}
                  aria-haspopup="menu"
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer shrink-0 ${
                    openMenuId === 'sidebar-tools'
                      ? 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                  title="Weitere Werkzeuge (3D, Vergleich, Export, Wetter)"
                >
                  <span>Werkzeuge</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${openMenuId === 'sidebar-tools' ? 'rotate-180' : ''}`} />
                </button>

                {openMenuId === 'sidebar-tools' && (
                  <div
                    role="menu"
                    className={`absolute right-0 ${tracks.length === 0 ? 'top-full mt-1.5' : 'bottom-full mb-1.5'} w-60 max-h-[60vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl py-1 z-50 text-xs`}
                  >
                    {onOpenVideoExport && (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={tracks.length === 0}
                        id="btn-sidebar-3d-flyover"
                        onClick={() => {
                          setOpenMenuId(null);
                          onOpenVideoExport(markedTrackId || undefined);
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                      >
                        <Video className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>3D-Überflug Video-Studio</span>
                      </button>
                    )}

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpenMenuId(null);
                        setIs3D(!is3D);
                      }}
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Box className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                        <span>3D-Gelände</span>
                      </span>
                      {is3D && <Check className="w-3.5 h-3.5 text-purple-500 shrink-0" />}
                    </button>

                    {onStartMapComparison && (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={tracks.length < 2 && !compareTrackId}
                        id="btn-sidebar-map-compare-2-tracks"
                        onClick={() => {
                          setOpenMenuId(null);
                          if (compareTrackId && onExitMapComparison) {
                            onExitMapComparison();
                          } else {
                            onStartMapComparison();
                          }
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                      >
                        <GitCompare className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                        <span>{compareTrackId ? 'Karten-Vergleich beenden' : '2 Tracks auf Karte vergleichen'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      role="menuitem"
                      disabled={tracks.length < 2}
                      onClick={() => {
                        setOpenMenuId(null);
                        onOpenComparison();
                      }}
                      className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <GitCompare className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span>Aktivitäten vergleichen</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      disabled={tracks.length < 2}
                      onClick={() => {
                        setOpenMenuId(null);
                        onMergeSelected();
                      }}
                      className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <Combine className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span>Tracks verbinden</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      disabled={tracks.length === 0}
                      onClick={() => {
                        setOpenMenuId(null);
                        onOpenTimeGapAnalysis?.(markedTrackId || undefined);
                      }}
                      className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <Scissors className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span>Zeitlücken analysieren</span>
                    </button>

                    {markedTrack && (
                      <>
                        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenuId(null);
                            onOpenSummaryReport?.(markedTrackId || undefined);
                          }}
                          className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <BarChart2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          <span>PDF-Report öffnen</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenuId(null);
                            triggerHaptic('medium');
                            downloadTrackAsGPX(markedTrack, { textMarkers });
                          }}
                          className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                          <span>Aktive Strecke als GPX</span>
                        </button>
                      </>
                    )}

                    {(onOpenWeather || onOpenGlossary) && (
                      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                    )}

                    {onOpenWeather && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenuId(null);
                          onOpenWeather();
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span>Wetter &amp; Routen-Prognose</span>
                      </button>
                    )}

                    {onOpenGlossary && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenuId(null);
                          onOpenGlossary();
                        }}
                        className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>Sport-Glossar (VAM, TSS...)</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>

            {tracks.some(t => !t.hasTimestamps) && (
              <section className="space-y-3">
                <div className="flex justify-between items-center">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Geschwindigkeit</h2>
                  <span className="text-xs font-bold text-blue-600">{estimatedSpeed} km/h</span>
                </div>
                <input 
                  type="range" 
                  min="5" 
                  max="50" 
                  step="1" 
                  value={estimatedSpeed} 
                  onChange={(e) => setEstimatedSpeed(Number(e.target.value))}
                  className="w-full accent-blue-600"
                />
                <p className="text-[10px] text-slate-500">Für die Schätzung der Dauer bei GPX-Dateien ohne Zeitstempel.</p>
              </section>
            )}

            {/* Custom Text Markers / Notes Section */}
            {textMarkers && textMarkers.length > 0 && (
              <section className="space-y-2.5 border-t border-slate-100/60 dark:border-slate-800/40 pt-3">
                <div className="flex justify-between items-center px-1">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-blue-500" />
                    <h2 className="text-xs font-bold text-slate-700 dark:text-slate-300">Notizen & Marker ({textMarkers.length})</h2>
                  </div>
                  <button
                    onClick={() => {
                      triggerHaptic('medium');
                      textMarkers.forEach(m => onDeleteTextMarker(m.id));
                    }}
                    className="text-[10px] font-extrabold text-red-500 hover:text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 px-2 py-0.5 rounded transition-all cursor-pointer flex items-center gap-1 border border-red-200/50 dark:border-red-900/30"
                    title="Alle Marker entfernen"
                    id="btn-remove-all-markers"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                    <span>Alle entfernen</span>
                  </button>
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                  {textMarkers.map((m) => (
                    <div 
                      key={m.id}
                      className="p-2 bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100/80 dark:hover:bg-slate-850 rounded-xl border border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between text-xs transition-all"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs shrink-0">🏷️</span>
                        <div className="min-w-0">
                          <div className="font-extrabold text-slate-800 dark:text-slate-200 text-[11px] truncate">{m.label}</div>
                          <div className="text-[9px] text-slate-400 font-mono">
                            {m.distanceAlongTrack !== undefined ? `km ${m.distanceAlongTrack.toFixed(1)} · ` : ''}
                            {m.lat.toFixed(4)}, {m.lng.toFixed(4)}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          triggerHaptic('light');
                          onDeleteTextMarker(m.id);
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors shrink-0 cursor-pointer"
                        title="Marker entfernen"
                        aria-label={`Marker "${m.label}" entfernen`}
                        id={`btn-sidebar-remove-marker-${m.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-2 border-t border-slate-100/60 dark:border-slate-800/40 pt-4 pb-6">
              <button 
                onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-900/40 transition-all group text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-500 group-hover:bg-blue-50 dark:group-hover:bg-blue-950 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    <Settings size={14} className="stroke-[2.5]" />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold text-slate-600 dark:text-slate-300">FTP & Nutzerdaten</h2>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">Pulszone, VO2max & Watt</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {!showAdvancedSettings && ftp && (
                    <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/50 rounded-md font-mono">
                      {ftp}W
                    </span>
                  )}
                  {showAdvancedSettings ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                </div>
              </button>
              
              {showAdvancedSettings && (
                <div className="space-y-3 p-3 bg-slate-50/50 dark:bg-slate-950/20 rounded-xl border border-slate-200/50 dark:border-slate-800/60 transition-all">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">FTP (Watt)</label>
                      <FreeMetricInput
                        value={ftp}
                        allowDecimal={false}
                        onCommit={setFtp}
                        ariaLabel="FTP (Watt)"
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1.5 text-xs font-mono tabular-nums font-bold text-amber-600 dark:text-amber-400 focus:ring-2 focus:ring-blue-500/20 outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">Gewicht (kg)</label>
                      <FreeMetricInput
                        value={userWeight}
                        allowDecimal={true}
                        precision={1}
                        onCommit={setUserWeight}
                        ariaLabel="Gewicht (kg)"
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1.5 text-xs font-mono tabular-nums font-bold text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500/20 outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">Alter</label>
                      <FreeMetricInput
                        value={userAge}
                        allowDecimal={false}
                        onCommit={setUserAge}
                        ariaLabel="Alter"
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1.5 text-xs font-mono tabular-nums font-bold text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500/20 outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">Max. Puls</label>
                      <FreeMetricInput
                        value={userMaxHr}
                        allowDecimal={false}
                        onCommit={setUserMaxHr}
                        ariaLabel="Max. Puls"
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1.5 text-xs font-mono tabular-nums font-bold text-rose-600 dark:text-rose-400 focus:ring-2 focus:ring-rose-500/20 outline-none"
                      />
                    </div>
                  </div>

                  {suggestedFtp && Math.abs(suggestedFtp - ftp) > 2 && (
                    <button 
                      onClick={() => setFtp(suggestedFtp)}
                      className="w-full text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 px-2 py-1 rounded font-bold hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors cursor-pointer"
                    >
                      FTP-Vorschlag basierend auf Bestleistung: {suggestedFtp}W
                    </button>
                  )}
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 italic">Diese Daten ermöglichen eine genauere Schätzung von VO2max und Kalorienverbrauch.</p>
                </div>
              )}
            </section>
          </div>

          <div className="relative z-10 px-4 py-3 border-t border-slate-200/60 dark:border-slate-800/80 bg-slate-50/95 dark:bg-slate-900/95 text-[10px] text-slate-500 rounded-b-xl">
            <div className="flex justify-between items-center font-medium gap-2">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className="font-semibold text-slate-600 dark:text-slate-400">
                  {isOnline ? 'Online' : 'Offline'}
                </span>
                {onOpenShortcuts && (
                  <button
                    onClick={() => {
                      triggerHaptic('light');
                      onOpenShortcuts();
                    }}
                    className="ml-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 border border-slate-200/70 dark:border-slate-700 font-mono text-[9px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                    title="Tastaturkürzel anzeigen (?)"
                    id="btn-footer-shortcuts"
                  >
                    <Keyboard size={10} />
                    <span>?</span>
                  </button>
                )}
              </div>

              <button
                type="button"
                id="btn-footer-build-changelog"
                onClick={() => setIsAboutOpen(true)}
                className="text-[9.5px] font-mono font-semibold text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 bg-slate-100 hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-blue-950/40 px-2 py-0.5 rounded border border-slate-200/80 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-800 transition-colors cursor-pointer truncate max-w-[175px]"
                title="Versionsverlauf & Changelog öffnen"
              >
                Build: {latestBuildDate || 'Changelog'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isAboutOpen && (
          <AboutModal 
            onClose={() => setIsAboutOpen(false)} 
          />
        )}
      </AnimatePresence>
    </>
  );
};

export default React.memo(Sidebar);