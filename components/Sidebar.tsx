
import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GPXTrack, MapLayer, TextMarker } from '../types';
import { AboutModal } from './AboutModal';
import { getApiUrl } from '../utils/api';
import { Upload, Trash2, Combine, Eye, EyeOff, Ruler, Layers, GripVertical, Undo2, TrendingUp, TrendingDown, Box, ChevronLeft, ChevronRight, Menu, Zap, Clock, BarChart2, X, MapPin, Plus, Trophy, GitCompare, Settings, ChevronDown, ChevronUp, Heart, Database, Sun, Moon, FileCode, Download, Share2, Wifi, WifiOff, HardDrive, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Info, Scissors, ExternalLink } from 'lucide-react';
import { calculateDistance, formatPace, getPaceString, findClimbs, exportToGPX } from '../utils/gpxUtils';
import { triggerHaptic, shareTrackNative } from '../utils/haptics';
import { TrackLibrary } from './TrackLibrary';
import { WeatherOverlay } from './WeatherOverlay';
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
  isExpanded?: boolean;
  onToggleExpand?: (id: string) => void;
  onMark: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onRemoveTrack: (id: string) => void;
  onChangeActivityType?: (id: string, type: 'cycling' | 'running') => void;
  estimatedSpeed: number;
  onOpenAnalytics?: (id: string) => void;
  onOpenTrainingZones?: (id: string) => void;
  onOpenClimbs?: (id: string) => void;
  onAnalyzeSurface?: (id: string, force?: boolean) => void;
  onSetTrackSurface?: (id: string, surfaceType: string) => void;
  isAnalyzing?: boolean;
  surfaceStatus?: { status: 'idle' | 'loading' | 'success' | 'error' | 'simulated'; message?: string; source?: 'osm' | 'terrain' | 'manual'; timestamp?: number };
  onSaveTrackToLibrary?: (id: string) => void;
  onOpenRawData?: (id: string) => void;
  onOpenTimeGapAnalysis?: (id: string) => void;
  onSelection?: (bounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null) => void;
}

const SortableTrackItem: React.FC<TrackItemProps> = ({ 
  track, 
  isMarked, 
  isExpanded,
  onToggleExpand,
  onMark, 
  onToggleVisibility, 
  onRemoveTrack, 
  onChangeActivityType, 
  estimatedSpeed, 
  onOpenAnalytics, 
  onOpenTrainingZones,
  onOpenClimbs, 
  onAnalyzeSurface,
  onSetTrackSurface,
  isAnalyzing,
  surfaceStatus,
  onSaveTrackToLibrary,
  onOpenRawData,
  onOpenTimeGapAnalysis,
  onSelection
}) => {
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = isExpanded !== undefined ? isExpanded : localExpanded;

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
      const xml = exportToGPX(track);
      const blob = new Blob([xml], { type: 'application/gpx+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeName = track.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'track';
      link.href = url;
      link.setAttribute('download', `${safeName}.gpx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Error exporting GPX:", e);
    }
  };

  const hasPower = track.points.some(p => p.power !== undefined && p.power !== null && p.power > 0);
  const hasHR = track.points.some(p => p.hr !== undefined && p.hr !== null && p.hr > 0);
  const showAnalyticsAndZones = hasPower && hasHR;

  const trackClimbs = useMemo(() => {
    return track.climbs && track.climbs.length > 0 ? track.climbs : findClimbs(track.points || []);
  }, [track.climbs, track.points]);

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      onClick={() => {
        triggerHaptic('light');
        onMark(track.id);
      }}
      className={`group cursor-pointer bg-white dark:bg-slate-900 border rounded-xl p-2.5 sm:p-3 hover:shadow-md transition-all ${
        isDragging ? 'shadow-xl opacity-50 bg-slate-50 dark:bg-slate-800' : ''
      } ${
        isMarked 
          ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/10 shadow-sm bg-blue-50/10 dark:bg-blue-950/20' 
          : 'border-slate-100 dark:border-slate-800/80 hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50/40 dark:hover:bg-slate-850/10'
      }`}
    >
      <div className="flex items-start gap-2">
        <div {...attributes} {...listeners} onClick={(e) => e.stopPropagation()} className="drag-handle p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 dark:text-slate-500 shrink-0 cursor-grab active:cursor-grabbing mt-0.5">
          <GripVertical className="w-4 h-4" />
        </div>
        
        <div className="flex-1 min-w-0">
          {/* Header row: color dot, title, badges, visibility button, fold/unfold button */}
          <div className="flex items-center justify-between gap-1.5 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
              <div className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs border border-black/10" style={{ backgroundColor: track.color || '#3b82f6' }}></div>
              <span className={`text-xs block truncate leading-tight font-bold ${isMarked ? 'text-blue-700 dark:text-blue-400' : 'text-slate-800 dark:text-slate-200'}`} title={track.name}>
                {track.name}
              </span>
              {track.isVirtual && (
                <span className="shrink-0 text-[8px] bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 font-extrabold px-1 py-0.5 rounded border border-orange-200/40 dark:border-orange-900/30 cursor-help" title="Diese Aktivität enthält keine echten GPS-Koordinaten (nur Leistungs-/Gesundheitsdaten)">
                  ⚠️
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              {track.activityType === 'running' ? (
                <span 
                  className="inline-flex items-center gap-0.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md border border-emerald-200/40 dark:border-emerald-900/30"
                  title="Automatisch erkannt: Laufen"
                >
                  🏃
                </span>
              ) : (
                <span 
                  className="inline-flex items-center gap-0.5 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md border border-blue-200/40 dark:border-blue-900/30"
                  title="Automatisch erkannt: Radsport"
                >
                  🚴
                </span>
              )}

              {/* Quick eye visibility toggle */}
              <button 
                type="button"
                onClick={() => onToggleVisibility(track.id)} 
                className={`p-1 rounded-md border transition-all cursor-pointer flex items-center justify-center ${
                  track.visible 
                    ? 'bg-slate-50 hover:bg-slate-100 text-slate-500 border-slate-200/60 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700' 
                    : 'bg-amber-50 hover:bg-amber-100 text-amber-600 border-amber-200/60 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/50'
                }`}
                title={track.visible ? "Sichtbar (Klicken zum Ausblenden)" : "Ausgeblendet (Klicken zum Einblenden)"}
              >
                {track.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>

              {/* Fold / Unfold chevron toggle button */}
              <button
                type="button"
                onClick={handleToggleExpand}
                className={`p-1 rounded-md border transition-all cursor-pointer flex items-center justify-center ${
                  expanded 
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-200/60 dark:border-blue-900/50' 
                    : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 dark:text-slate-400 border-slate-200/60 dark:border-slate-700'
                }`}
                title={expanded ? "Details einklappen" : "Details ausklappen"}
                aria-expanded={expanded}
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180 text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`} />
              </button>
            </div>
          </div>

          {/* Compact summary bar (Always visible to provide immediate overview) */}
          <div 
            onClick={handleToggleExpand}
            className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400 pt-1.5 mt-1 border-t border-slate-100/60 dark:border-slate-800/60 cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            title={expanded ? "Klicken zum Einklappen" : "Klicken zum Ausklappen der Details"}
          >
            <span className="font-bold text-slate-700 dark:text-slate-300">
              {track.distance.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} km
            </span>
            <span>·</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              +{Math.round(track.ascent)}m
            </span>
            <span>·</span>
            <span>
              {track.duration ? (
                `${Math.floor(track.duration / 3600)}h ${Math.floor((track.duration % 3600) / 60)}m`
              ) : (
                `${Math.floor((track.distance / estimatedSpeed))}h ${Math.floor(((track.distance / estimatedSpeed) * 60) % 60)}m`
              )}
            </span>
            {trackClimbs && trackClimbs.length > 0 && (
              <>
                <span>·</span>
                <span className="text-amber-600 dark:text-amber-400 font-semibold">{trackClimbs.length} ⛰️</span>
              </>
            )}
            <span className="text-[8.5px] font-sans font-bold text-blue-600 dark:text-blue-400 ml-1">
              {expanded ? '▲' : '▼'}
            </span>
          </div>

          {/* Expanded Content Section */}
          {expanded && (
            <div className="pt-2.5 mt-2 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
              {/* Action buttons (Sichtbar, Analyse, Zonen, etc.) */}
              <div className="grid grid-cols-4 gap-1 bg-slate-50/50 dark:bg-slate-900/30 p-1 rounded-xl border border-slate-100 dark:border-slate-800/80" onClick={(e) => e.stopPropagation()}>
                <button 
                  type="button"
                  onClick={() => onToggleVisibility(track.id)} 
                  className={`p-1.5 rounded-lg border transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 text-[9px] font-black ${
                    track.visible 
                      ? 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200/60 dark:bg-slate-900/40 dark:text-slate-350 dark:border-slate-800' 
                      : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200/60 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900'
                  }`}
                  title="Sichtbarkeit umschalten"
                >
                  {track.visible ? <Eye className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" /> : <EyeOff className="w-3.5 h-3.5 text-amber-500" />}
                  <span>{track.visible ? "Sichtbar" : "Ausgebl."}</span>
                </button>
                
                {onOpenAnalytics && (track.powerStats || track.points.some(p => p.hr !== undefined && p.hr > 0)) && (
                  <button 
                    type="button"
                    onClick={() => onOpenAnalytics(track.id)} 
                    className="p-1.5 bg-indigo-50/80 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-350 rounded-lg border border-indigo-250/20 dark:border-indigo-800/40 transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 text-[9px] font-black" 
                    title="Ausführliche Daten- & Leistungsanalyse"
                  >
                    <BarChart2 className="w-3.5 h-3.5 text-indigo-650 dark:text-indigo-400" />
                    <span>Analyse</span>
                  </button>
                )}

                {trackClimbs && trackClimbs.length > 0 && onOpenClimbs && (
                  <button 
                    type="button"
                    onClick={() => onOpenClimbs(track.id)} 
                    className="p-1.5 bg-emerald-55/80 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-355 rounded-lg border border-emerald-250/20 dark:border-emerald-800/40 transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 text-[9px] font-black" 
                    title="Steigungs- & Bergwertungs-Analyse öffnen"
                  >
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Berge ({trackClimbs.length})</span>
                  </button>
                )}

                {onOpenTrainingZones && (track.powerStats || track.points.some(p => p.hr !== undefined && p.hr > 0)) && (
                  <button 
                    type="button"
                    onClick={() => onOpenTrainingZones(track.id)} 
                    className="p-1.5 bg-rose-50/80 hover:bg-rose-100 text-rose-750 dark:bg-rose-950/40 dark:text-rose-350 rounded-lg border border-rose-250/20 dark:border-rose-800/40 transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 text-[9px] font-black" 
                    title="Trainingszonen & Puls-Analyse öffnen"
                  >
                    <Heart className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 fill-rose-50 dark:fill-transparent" />
                    <span>Zonen</span>
                  </button>
                )}

                {onOpenRawData && (
                  <button 
                    type="button"
                    onClick={() => onOpenRawData(track.id)} 
                    className="p-1.5 bg-teal-50/80 hover:bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-350 rounded-lg border border-teal-250/20 dark:border-teal-800/40 transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 text-[9px] font-black" 
                    title="Rohdaten & Telemetrie-Sätze inspizieren"
                  >
                    <FileCode className="w-3.5 h-3.5 text-teal-650 dark:text-teal-400" />
                    <span>Rohdaten</span>
                  </button>
                )}

                {onOpenTimeGapAnalysis && (
                  <button 
                    type="button"
                    onClick={() => onOpenTimeGapAnalysis(track.id)} 
                    className="p-1.5 bg-amber-50/80 hover:bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 rounded-lg border border-amber-250/20 dark:border-amber-900/30 transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 text-[9px] font-black" 
                    title="Zeitlücken > 30s analysieren & Track trennen"
                  >
                    <Scissors className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span>Zeitlücken</span>
                  </button>
                )}

                <button 
                  type="button"
                  onClick={handleExportGPX} 
                  className="p-1.5 bg-sky-50/80 hover:bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 rounded-lg border border-sky-250/20 dark:border-sky-900/30 transition-colors cursor-pointer flex flex-col items-center justify-center gap-0.5 text-[9px] font-black font-sans" 
                  title="Track zurück als GPX-Datei exportieren"
                >
                  <Download className="w-3.5 h-3.5 text-sky-655 dark:text-sky-450" />
                  <span>Export</span>
                </button>

                <button 
                  type="button"
                  onClick={() => {
                    shareTrackNative({
                      title: track.name,
                      text: `🚴 GPX Route: ${track.name}\n📏 Distanz: ${track.distance.toFixed(1)} km\n⛰️ Anstieg: +${Math.round(track.ascent)}m`
                    });
                  }} 
                  className="p-1.5 bg-emerald-50/80 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 rounded-lg border border-emerald-250/20 transition-colors cursor-pointer flex flex-col items-center justify-center gap-0.5 text-[9px] font-black font-sans" 
                  title="Route via Smartphone (WhatsApp, Messages, Strava) teilen"
                >
                  <Share2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Teilen</span>
                </button>

                <button 
                  type="button"
                  onClick={() => onSaveTrackToLibrary?.(track.id)} 
                  className="p-1.5 bg-indigo-50/80 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-350 rounded-lg border border-indigo-200/50 transition-colors cursor-pointer flex flex-col items-center justify-center gap-0.5 text-[9px] font-black animate-none" 
                  title="Aktivität dauerhaft in der SQLite Bibliothek speichern"
                >
                  <Database className="w-3.5 h-3.5 text-indigo-650 dark:text-indigo-400" />
                  <span>Sichern</span>
                </button>

                <button 
                  type="button"
                  onClick={() => onRemoveTrack(track.id)} 
                  className="p-1.5 bg-red-50/80 hover:bg-red-100 text-red-650 dark:bg-rose-950/20 dark:text-rose-300 rounded-lg border border-red-250/20 dark:border-rose-900/30 transition-colors cursor-pointer flex flex-col items-center justify-center gap-0.5 text-[9px] font-black" 
                  title="Track vollständig entfernen"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-650 dark:text-rose-400" />
                  <span>Löschen</span>
                </button>
              </div>
              
              <div className="flex flex-col gap-1.5">
                {/* Bento Grid Row 1: Strecke, Dauer, Pace */}
                <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
                  <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-850/40 rounded-lg px-1.5 py-1 flex flex-col items-center justify-center">
                    <span className="text-[8px] text-slate-400 dark:text-slate-555 font-sans font-semibold uppercase tracking-wider">Strecke</span>
                    <span className="font-extrabold text-slate-700 dark:text-slate-300">
                      {track.distance.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} km
                    </span>
                  </div>
                  <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-850/40 rounded-lg px-1.5 py-1 flex flex-col items-center justify-center">
                    <span className="text-[8px] text-slate-400 dark:text-slate-555 font-sans font-semibold uppercase tracking-wider">Dauer</span>
                    <span className="font-extrabold text-slate-700 dark:text-slate-300">
                      {track.duration ? (
                        `${Math.floor(track.duration / 3600)}h ${Math.floor((track.duration % 3600) / 60)}m`
                      ) : (
                        `${Math.floor((track.distance / estimatedSpeed))}h ${Math.floor(((track.distance / estimatedSpeed) * 60) % 65)}m`
                      )}
                    </span>
                  </div>
                  <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-850/40 rounded-lg px-1.5 py-1 flex flex-col items-center justify-center">
                    <span className="text-[8px] text-slate-400 dark:text-slate-555 font-sans font-semibold uppercase tracking-wider">Tempo</span>
                    <span className="font-extrabold text-slate-700 dark:text-slate-300 truncate max-w-full">
                      {track.duration ? (
                        track.activityType === 'running' 
                          ? formatPace(track.duration, track.distance)
                          : `${(track.distance / (track.duration / 3600)).toFixed(1)} km/h`
                      ) : (
                        track.activityType === 'running'
                          ? getPaceString(estimatedSpeed)
                          : `${estimatedSpeed} km/h`
                      )}
                    </span>
                  </div>
                </div>

                {/* Bento Grid Row 2: Anstieg, Abstieg, Max. Steigung */}
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
                    className="bg-emerald-500/5 dark:bg-emerald-950/10 border border-emerald-100/30 dark:border-emerald-900/20 rounded-lg px-1.5 py-1 flex flex-col items-center justify-center cursor-pointer hover:bg-emerald-100/40 dark:hover:bg-emerald-900/30 transition-colors"
                    title="Klicken zum Zoomen auf Anstiege auf der Karte"
                  >
                    <span className="text-[8px] text-emerald-600 dark:text-emerald-500 font-sans font-semibold uppercase tracking-wider flex items-center gap-0.5">
                      Anstieg 🔍
                    </span>
                    <span className="font-extrabold text-emerald-700 dark:text-emerald-400">
                      +{Math.round(track.ascent).toLocaleString('de-DE')}m
                    </span>
                  </div>
                  <div className="bg-rose-500/5 dark:bg-rose-950/10 border border-rose-100/30 dark:border-rose-900/20 rounded-lg px-1.5 py-1 flex flex-col items-center justify-center">
                    <span className="text-[8px] text-rose-600 dark:text-rose-500 font-sans font-semibold uppercase tracking-wider flex items-center gap-0.5">
                      Abstieg
                    </span>
                    <span className="font-extrabold text-rose-700 dark:text-rose-400">
                      -{Math.round(track.descent).toLocaleString('de-DE')}m
                    </span>
                  </div>
                  <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-850/40 rounded-lg px-1.5 py-1 flex flex-col items-center justify-center">
                    <span className="text-[8px] text-slate-400 dark:text-slate-555 font-sans font-semibold uppercase tracking-wider">Steigung</span>
                    <span className="font-extrabold text-slate-700 dark:text-slate-300">
                      {(track.maxSlope ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                    </span>
                  </div>
                </div>

                {/* Miscellaneous status bar for HR or point length */}
                <div className="flex items-center justify-between text-[9px] text-slate-400 dark:text-slate-500 font-mono border-t border-slate-100/40 dark:border-slate-800/40 pt-1.5 mt-0.5">
                  <span>{track.points.length.toLocaleString('de-DE')} GPX-Punkte</span>
                  {track.points.some(p => p.hr !== undefined && p.hr > 0) && (
                    <span className="flex items-center gap-0.5 text-[9px] font-bold text-rose-600 dark:text-rose-400 bg-rose-500/5 px-1 py-0.5 rounded border border-rose-500/10 shadow-3xs">
                      <Heart className="w-2.5 h-2.5 text-rose-500 fill-rose-500 animate-pulse shrink-0" /> HF-Daten
                    </span>
                  )}
                </div>

                {/* Description/Notes block if present */}
                {track.description && (
                  <div className="bg-indigo-50/50 dark:bg-indigo-950/10 border border-indigo-100/45 dark:border-indigo-900/30 rounded-lg p-2 text-[10px] text-slate-650 dark:text-slate-300 leading-normal font-semibold text-left">
                    <span className="font-bold text-indigo-600 dark:text-indigo-400 block text-[8px] uppercase tracking-wider mb-0.5">Notiz / Kommentar</span>
                    {track.description}
                  </div>
                )}

                {/* Power Stats Widget */}
                {track.powerStats && (
                  <div className="bg-amber-500/5 dark:bg-amber-950/10 border border-amber-100/40 dark:border-amber-900/20 rounded-lg px-2 py-1 flex justify-between items-center text-[10px] font-mono">
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500 font-extrabold text-[8px] uppercase tracking-wider">
                      <Zap className="w-3 h-3 fill-amber-500/10" /> NP Daten
                    </span>
                    <span className="text-slate-300 dark:text-slate-800">|</span>
                    <span className="font-bold text-slate-700 dark:text-slate-350" title="Normalized Power">NP {Math.round(track.powerStats.normalizedPower || 0)}W</span>
                    <span className="font-medium text-slate-500 dark:text-slate-400 text-[9px]">IF {(track.powerStats.intensityFactor || 0).toFixed(2)}</span>
                    <span className="font-medium text-slate-500 dark:text-slate-400 text-[9px]">TSS {Math.round(track.powerStats.tss || 0)}</span>
                  </div>
                )}

                {/* Climb Analysis Info Box & Quick Zoom Chips */}
                {trackClimbs && trackClimbs.length > 0 && (
                  <div className="space-y-1">
                    <div 
                      className="bg-indigo-50/20 dark:bg-indigo-950/15 border border-indigo-100/40 dark:border-indigo-900/25 rounded-lg px-2 py-1 flex justify-between items-center text-[10px] font-mono group/climbs cursor-pointer hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                      onClick={(e) => { e.stopPropagation(); onOpenClimbs?.(track.id); }}
                      title="Bergwertungs-Analyse auf separater Seite öffnen"
                    >
                      <span className="flex items-center gap-1 text-indigo-700 dark:text-indigo-450 font-extrabold text-[8px] uppercase tracking-wider">
                        <TrendingUp className="w-3 h-3 shrink-0 text-indigo-500" />
                        <span>Anstiege / Berganalyse</span>
                      </span>
                      <span className="font-extrabold text-blue-650 dark:text-blue-400 underline hover:no-underline">
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
                          title={`Anstieg #${cIdx + 1} auf Karte anzoomen (${(climb.distance / 1000).toFixed(1)} km · +${Math.round(climb.ascent)}m)`}
                        >
                          <span>🚩 Berg #{cIdx + 1}</span>
                          <span className="text-[8px] text-amber-600 dark:text-amber-400 font-normal">+{Math.round(climb.ascent)}m</span>
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
                        const getSurfColor = (s: string) => {
                          switch (s) {
                            case "Asphalt": return "#2563eb"; // Royal Blue
                            case "Schotter": return "#d97706"; // Amber
                            case "Waldweg": return "#16a34a"; // Forest Green
                            case "Fahrradweg": return "#0284c7"; // Sky Blue
                            case "Kopfsteinpflaster": return "#78350f"; // Brown
                            case "Straße": return "#4f46e5"; // Indigo
                            default: return "#64748b"; // Slate
                          }
                        };
                        return (
                          <div 
                            key={idx} 
                            style={{ width: `${pct}%`, backgroundColor: getSurfColor(surface.type) }} 
                            title={`${surface.type} (${pct.toFixed(1)}%)`} 
                          />
                        );
                      })}
                    </div>
                    <div className="text-[9.5px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-1 font-mono">
                      {track.surfaceStats.map((surface, idx) => {
                        const getSurfColor = (s: string) => {
                          switch (s) {
                            case "Asphalt": return "#2563eb";
                            case "Schotter": return "#d97706";
                            case "Waldweg": return "#16a34a";
                            case "Fahrradweg": return "#0284c7";
                            case "Kopfsteinpflaster": return "#78350f";
                            case "Straße": return "#4f46e5";
                            default: return "#64748b";
                          }
                        };
                        return (
                          <span key={idx} className="bg-slate-50 dark:bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-100 dark:border-slate-800 text-[9px] flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getSurfColor(surface.type) }}></span>
                            {surface.type}: {surface.distance.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
                          </span>
                        );
                      })}
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
                      title="Untergrundtyp manuell festlegen oder per OSM analysieren"
                    >
                      <option value="">Status / Typ wählen...</option>
                      <option value="osm">🌐 Per OpenStreetMap (OSM) analysieren</option>
                      <option value="Asphalt">Asphalt (100%)</option>
                      <option value="Schotter">Schotter / Gravel (100%)</option>
                      <option value="Fahrradweg">Fahrradweg (100%)</option>
                      <option value="Waldweg">Waldweg (100%)</option>
                    </select>
                  </div>

                  {/* Status Feedback Badge / Card */}
                  {surfaceStatus && surfaceStatus.status !== 'idle' && (
                    <div className={`p-1.5 rounded-md text-[10px] flex items-start gap-1.5 border shadow-sm ${
                      surfaceStatus.status === 'loading'
                        ? 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/80 text-blue-800 dark:text-blue-200 animate-pulse'
                        : surfaceStatus.status === 'success'
                        ? 'bg-emerald-50/90 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-200'
                        : surfaceStatus.status === 'simulated'
                        ? 'bg-amber-50/90 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/80 text-amber-800 dark:text-amber-200'
                        : 'bg-rose-50/90 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800/80 text-rose-800 dark:text-rose-200'
                    }`}>
                      {surfaceStatus.status === 'loading' && <Loader2 size={13} className="animate-spin shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />}
                      {surfaceStatus.status === 'success' && <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />}
                      {surfaceStatus.status === 'simulated' && <Info size={13} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />}
                      {surfaceStatus.status === 'error' && <AlertTriangle size={13} className="shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />}

                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-[10px] flex items-center justify-between">
                          <span>
                            {surfaceStatus.status === 'loading' && "Analyse läuft..."}
                            {surfaceStatus.status === 'success' && "OSM-Analyse abgeschlossen"}
                            {surfaceStatus.status === 'simulated' && "Geländeprofil ermittelt"}
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

                      {surfaceStatus.status === 'error' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAnalyzeSurface?.(track.id, true);
                          }}
                          className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[9px] font-bold shrink-0 transition-colors cursor-pointer"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}

                  {/* Permanent action button - always ready so user never needs to click twice */}
                  <button
                    type="button"
                    disabled={isAnalyzing}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAnalyzeSurface?.(track.id, true);
                    }}
                    className={`w-full flex items-center justify-center gap-1.5 text-[10px] font-bold px-2 py-1.5 rounded-md transition-all cursor-pointer select-none border shadow-sm ${
                      isAnalyzing
                        ? "bg-blue-100/60 text-blue-700 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-700 animate-pulse cursor-wait"
                        : "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/60 border-blue-200 dark:border-blue-800/50 hover:border-blue-300 dark:hover:border-blue-700 shadow-blue-500/5 dark:shadow-blue-900/10"
                    }`}
                    title="Straßen- und Geländebeschaffenheit mittels OpenStreetMap (OSM) analysieren"
                  >
                    <RefreshCw size={11} className={isAnalyzing ? "animate-spin text-blue-600 dark:text-blue-400" : ""} />
                    {isAnalyzing ? "Oberflächen-Analyse läuft..." : "Oberflächen-Analyse starten (OSM)"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface SidebarProps {
  tracks: GPXTrack[];
  markedTrackId: string | null;
  onMarkTrack: (id: string) => void;
  onChangeActivityType?: (id: string, type: 'cycling' | 'running') => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleVisibility: (id: string) => void;
  onRemoveTrack: (id: string) => void;
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
  onOpenAnalytics: (id: string) => void;
  onOpenClimbs: (id: string) => void;
  onOpenWeather?: () => void;
  onOpenRawData?: (id: string) => void;
  onOpenTimeGapAnalysis?: (id?: string) => void;
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
  showCyclingHeatmap?: boolean;
  setShowCyclingHeatmap?: (show: boolean) => void;
  showRunningHeatmap?: boolean;
  setShowRunningHeatmap?: (show: boolean) => void;
  showDbCyclingHeatmap?: boolean;
  setShowDbCyclingHeatmap?: (show: boolean) => void;
  showDbRunningHeatmap?: boolean;
  setShowDbRunningHeatmap?: (show: boolean) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  tracks, 
  markedTrackId,
  onMarkTrack,
  onChangeActivityType,
  onUpload, 
  onToggleVisibility, 
  onRemoveTrack, 
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
  onOpenAnalytics,
  onOpenClimbs,
  onOpenWeather,
  onOpenRawData,
  onOpenTimeGapAnalysis,
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
  showCyclingHeatmap = false,
  setShowCyclingHeatmap,
  showRunningHeatmap = false,
  setShowRunningHeatmap,
  showDbCyclingHeatmap = false,
  setShowDbCyclingHeatmap,
  showDbRunningHeatmap = false,
  setShowDbRunningHeatmap
}) => {
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'library'>('active');
  const [isWeatherExpanded, setIsWeatherExpanded] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [latestVersion, setLatestVersion] = useState('1.3.0');
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
        const res = await fetch(getApiUrl('/api/versions'));
        const data = await res.json();
        if (data.success && data.versions.length > 0) {
          setLatestVersion(data.versions[0].version);
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
        console.error('Failed to load latest version in sidebar:', e);
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
  const markedHasPower = markedTrack?.points?.some(p => p.power !== undefined && p.power !== null && p.power > 0) || false;
  const markedHasHR = markedTrack?.points?.some(p => p.hr !== undefined && p.hr !== null && p.hr > 0) || false;
  const markedShowAnalyticsAndZones = markedHasPower && markedHasHR;

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
            onClick={() => setIsMobileMenuOpen(false)}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[70] md:hidden"
          />
        )}
      </AnimatePresence>

      <div className={`
        fixed inset-y-0 left-0 z-[80] transition-all duration-300 transform
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0
        w-[290px] md:w-auto bg-white border-r border-slate-200 shadow-2xl md:shadow-none
        ${isCollapsed ? 'md:w-0 md:border-r-0 md:shadow-none md:bg-transparent' : 'md:w-80 md:shadow-2xl md:bg-white md:border-r md:border-slate-200'}
        h-full flex flex-col overflow-visible
      `}>
        {/* Toggle Collapse Button (remains interactive and visible when collapsed to 0 width) */}
        <button 
          onClick={onToggleCollapse}
          style={{ right: isCollapsed ? '-20px' : '-12px' }}
          className="absolute top-1/2 -translate-y-1/2 w-6 h-12 bg-white border border-slate-200 rounded-full hidden md:flex items-center justify-center shadow-md hover:bg-slate-50 transition-all z-[90] group cursor-pointer"
          title={isCollapsed ? "Menü ausklappen" : "Menü einklappen"}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4 text-slate-600 group-hover:scale-110 transition-transform" /> : <ChevronLeft className="w-4 h-4 text-slate-600 group-hover:scale-110 transition-transform" />}
        </button>

        {/* Inner Content Wrapper */}
        <div className={`w-full md:w-80 h-full flex flex-col relative shrink-0 transition-opacity bg-white duration-300 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] ${isCollapsed ? 'md:opacity-0 md:pointer-events-none' : 'opacity-100'}`}>
          {/* Mobile Close Button */}
          <button 
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden absolute right-4 top-4 p-2 bg-slate-100 rounded-xl text-slate-600 z-50"
          >
            <X size={20} />
          </button>

          {/* AI Generated Background Image */}
          <div 
            className="absolute inset-0 z-0 opacity-60 pointer-events-none"
            style={{
              backgroundImage: 'url("https://images.unsplash.com/photo-1524661135-423995f22d0b?q=80&w=800&auto=format&fit=crop")',
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          />
          <div className="absolute inset-0 z-0 bg-white/60 backdrop-blur-md pointer-events-none" />

          <div className="relative z-10 p-6 bg-slate-900/95 text-white flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Layers className="w-6 h-6 text-blue-400 shrink-0" />
              <div>
                <h1 className="text-xl font-bold whitespace-nowrap">GPX Master</h1>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">OSM Pro Tools</p>
              </div>
            </div>
            
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
          </div>

          <div className="relative z-10 flex-1 overflow-y-auto p-4 space-y-6">
            <section>
              <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-8 h-8 text-slate-400 mb-2" />
                  <p className="text-sm text-slate-500 font-medium">GPX, FIT oder ZIP hochladen</p>
                </div>
                <input type="file" className="hidden" accept=".gpx, .fit, .FIT, .zip, .ZIP, application/gpx+xml, application/octet-stream, application/x-garmin-fit, application/zip, application/x-zip-compressed" multiple onChange={onUpload} />
              </label>
            </section>

            <section className="space-y-3">
              <div className="flex justify-between items-center">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Werkzeuge</h2>
                {canUndo && (
                  <button 
                    onClick={onUndo}
                    className="flex items-center gap-1 text-[10px] text-blue-600 font-bold hover:bg-blue-100 bg-blue-50 px-2 py-1 rounded transition-colors"
                  >
                    <Undo2 className="w-3 h-3" /> RÜCKGÄNGIG
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={onMergeSelected}
                  disabled={tracks.length < 2}
                  className="flex items-center justify-center gap-2 p-3 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <Combine className="w-4 h-4" />
                  Verbinden
                </button>
                <button 
                  onClick={() => setIs3D(!is3D)}
                  className={`flex items-center justify-center gap-2 p-3 rounded-lg text-sm font-semibold transition-all ${is3D ? 'bg-purple-600 text-white shadow-lg shadow-purple-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  <Box className="w-4 h-4" />
                  3D Ansicht {is3D ? 'aktiv' : ''}
                </button>
              </div>
              <button 
                onClick={onOpenComparison}
                disabled={tracks.length < 2}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:hover:bg-indigo-600 disabled:cursor-not-allowed shadow-md shadow-indigo-100 transition-all"
                title={tracks.length < 2 ? "Lade mindestens 2 Aktivitäten hoch, um sie zu vergleichen" : "Aktivitäten vergleichen"}
              >
                <GitCompare className="w-4 h-4" />
                Aktivitäten vergleichen
              </button>

              <button 
                onClick={() => onOpenTimeGapAnalysis?.(markedTrackId || undefined)}
                disabled={tracks.length === 0}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-sm font-bold bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-orange-100 dark:shadow-none transition-all cursor-pointer"
                title="Erkennt Unterbrechungen > 30s und erlaubt das Trennen oder Schließen von Zeitlücken"
              >
                <Scissors className="w-4 h-4 text-amber-200" />
                Zeitlücken & Trennen
              </button>

              {markedTrack && (
                <button 
                  onClick={() => onOpenSummaryReport?.(markedTrackId || undefined)}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-sm font-bold bg-blue-650 hover:bg-blue-700 text-white shadow-md shadow-blue-100 transition-all cursor-pointer"
                  title="Ausführlichen, druckbaren Aktivitäts-Report mit allen Statistiken anzeigen"
                >
                  <BarChart2 className="w-4 h-4" />
                  Zusammenfassung & PDF-Report
                </button>
              )}
              
              {markedShowAnalyticsAndZones && (
                <button 
                  onClick={() => onOpenTrainingZones?.(markedTrackId || undefined)}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-100 transition-all"
                  title="Puls-Trainingsbereiche anzeigen und analysieren"
                >
                  <Heart className="w-4 h-4 fill-white animate-pulse" />
                  Trainingsbereiche & Puls
                </button>
              )}

              <button 
                onClick={onOpenGarminHealth}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-100 transition-all cursor-pointer"
                title="Garmin Connect Fitness- & Gesundheitsdaten anzeigen & SQLite-Import"
              >
                <Database className="w-4 h-4" />
                Garmin Fitness & Gesundheit
              </button>

              {onOpenGarminActivitiesAnalysis && (
                <button 
                  onClick={onOpenGarminActivitiesAnalysis}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-sm font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-md shadow-orange-100 transition-all cursor-pointer"
                  title="Garmin Connect Aktivitäten-Verlauf analysieren & Einheiten vergleichen"
                >
                  <GitCompare className="w-4 h-4" />
                  Garmin Aktivitäten & Vergleich
                </button>
              )}

              <button 
                onClick={onOpenPerformanceAnalysis}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-sm font-bold bg-indigo-650 hover:bg-indigo-700 text-white shadow-md shadow-indigo-105 transition-all cursor-pointer"
                title="Wissenschaftliche Leistungs- & Fitness-Analyse (CTL, ATL, TSB, Leistungskurven)"
              >
                <TrendingUp className="w-4 h-4" />
                Leistungs- & Fitness-Analyse
              </button>
            </section>

            <section className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 transition-all">
                <button
                  onClick={() => setIsWeatherExpanded(!isWeatherExpanded)}
                  className="flex-1 flex items-center gap-2 text-left cursor-pointer"
                >
                  <span className="text-base">🌤️</span>
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100">Wetter & Routen-Prognose</div>
                    <div className="text-[10px] text-slate-400 font-medium">Start, Gipfel & Zielprognose</div>
                  </div>
                </button>
                <div className="flex items-center gap-1">
                  {onOpenWeather && (
                    <button
                      onClick={onOpenWeather}
                      title="Große Wetter-Ansicht öffnen"
                      className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer"
                    >
                      <ExternalLink size={13} />
                    </button>
                  )}
                  <button
                    onClick={() => setIsWeatherExpanded(!isWeatherExpanded)}
                    className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-400 transition-colors cursor-pointer"
                  >
                    {isWeatherExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
              </div>

              {isWeatherExpanded && (
                <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <WeatherOverlay
                    track={markedTrack || tracks.find(t => t.visible) || tracks[0]}
                    allTracks={tracks}
                    onSelectTrack={onMarkTrack}
                    selectedDate={selectedDate}
                    setSelectedDate={setSelectedDate}
                    selectedTime={selectedTime}
                    setSelectedTime={setSelectedTime}
                  />
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Kartentyp</h2>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.values(MapLayer).map((layer) => (
                  <button
                    key={layer}
                    onClick={() => setActiveLayer(layer)}
                    className={`text-left px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${activeLayer === layer ? 'bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 border border-transparent'}`}
                  >
                    {layer}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Beliebtheits-Heatmap Overlays</h2>
              <div className="space-y-2">
                {setShowCyclingHeatmap && (
                  <button
                    onClick={() => setShowCyclingHeatmap(!showCyclingHeatmap)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-[11px] font-bold transition-all cursor-pointer ${
                      showCyclingHeatmap 
                        ? 'bg-amber-500/10 text-amber-600 border-amber-300 dark:border-amber-700/60 dark:text-amber-400' 
                        : 'bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">🚲</span>
                      <span className="text-left leading-tight">Beliebte Radsport-Routen</span>
                    </div>
                    <div className="relative">
                      <div className={`w-8 h-4 rounded-full transition-colors ${showCyclingHeatmap ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                        <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform shadow-sm ${showCyclingHeatmap ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                    </div>
                  </button>
                )}

                {setShowRunningHeatmap && (
                  <button
                    onClick={() => setShowRunningHeatmap(!showRunningHeatmap)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-[11px] font-bold transition-all cursor-pointer ${
                      showRunningHeatmap 
                        ? 'bg-emerald-500/10 text-emerald-600 border-emerald-300 dark:border-emerald-700/60 dark:text-emerald-400' 
                        : 'bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">🏃</span>
                      <span className="text-left leading-tight">Wander- & Laufrouten</span>
                    </div>
                    <div className="relative">
                      <div className={`w-8 h-4 rounded-full transition-colors ${showRunningHeatmap ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                        <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform shadow-sm ${showRunningHeatmap ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                    </div>
                  </button>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Eigene Heatmaps (aus Datenbank)</h2>
              <div className="space-y-2">
                {setShowDbCyclingHeatmap && (
                  <button
                    onClick={() => setShowDbCyclingHeatmap(!showDbCyclingHeatmap)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-[11px] font-bold transition-all cursor-pointer ${
                      showDbCyclingHeatmap 
                        ? 'bg-blue-500/10 text-blue-600 border-blue-300 dark:border-blue-700/60 dark:text-blue-400' 
                        : 'bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">🚴</span>
                      <span className="text-left leading-tight">Eigene Rad-Aktivitäten (DB)</span>
                    </div>
                    <div className="relative">
                      <div className={`w-8 h-4 rounded-full transition-colors ${showDbCyclingHeatmap ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`}>
                        <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform shadow-sm ${showDbCyclingHeatmap ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                    </div>
                  </button>
                )}

                {setShowDbRunningHeatmap && (
                  <button
                    onClick={() => setShowDbRunningHeatmap(!showDbRunningHeatmap)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-[11px] font-bold transition-all cursor-pointer ${
                      showDbRunningHeatmap 
                        ? 'bg-rose-500/10 text-rose-600 border-rose-300 dark:border-rose-700/60 dark:text-rose-400' 
                        : 'bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">🏃</span>
                      <span className="text-left leading-tight">Eigene Lauf-Aktivitäten (DB)</span>
                    </div>
                    <div className="relative">
                      <div className={`w-8 h-4 rounded-full transition-colors ${showDbRunningHeatmap ? 'bg-rose-600' : 'bg-slate-200 dark:bg-slate-700'}`}>
                        <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform shadow-sm ${showDbRunningHeatmap ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                    </div>
                  </button>
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

            <section className="space-y-2 border-t border-slate-100/60 dark:border-slate-800/40 pt-4">
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
                    <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 bg-amber-50 dark:bg-amber-950/30 text-amber-650 dark:text-amber-450 border border-amber-200/50 dark:border-amber-800/50 rounded-md font-mono">
                      {ftp}W
                    </span>
                  )}
                  {showAdvancedSettings ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                </div>
              </button>
              
              {showAdvancedSettings && (
                <div className="space-y-3 p-3 bg-slate-50/50 dark:bg-slate-950/20 rounded-xl border border-slate-200/50 dark:border-slate-800/60 transition-all">
                  <div className="space-y-1.5 focus-within:ring-2 focus-within:ring-blue-500/20 rounded transition-all">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase">FTP (Watt)</label>
                      <span className="text-[11px] font-black text-amber-600 dark:text-amber-500">{ftp} W</span>
                    </div>
                    <input 
                      type="range" 
                      min="100" 
                      max="500" 
                      step="5" 
                      value={ftp} 
                      onChange={(e) => setFtp(Number(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tighter truncate block" title="Gewicht">Gewicht (kg)</label>
                      <input 
                        type="number"
                        value={userWeight}
                        onChange={(e) => setUserWeight(Number(e.target.value))}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500/20 outline-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tighter truncate block" title="Alter">Alter</label>
                      <input 
                        type="number"
                        value={userAge}
                        onChange={(e) => setUserAge(Number(e.target.value))}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500/20 outline-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tighter truncate block" title="Max HR">Max. Puls</label>
                      <input 
                        type="number"
                        value={userMaxHr}
                        onChange={(e) => setUserMaxHr(Number(e.target.value))}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1.5 text-xs font-bold text-rose-650 dark:text-rose-400 focus:ring-2 focus:ring-rose-500/20 outline-none"
                      />
                    </div>
                  </div>

                  {suggestedFtp && Math.abs(suggestedFtp - ftp) > 2 && (
                    <button 
                      onClick={() => setFtp(suggestedFtp)}
                      className="w-full text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-450 px-1.5 py-1 rounded font-black hover:bg-amber-200 transition-colors animate-pulse"
                    >
                      FTP-Vorschlag basierend auf Bestleistung: {suggestedFtp}W
                    </button>
                  )}
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 italic">Diese Daten ermöglichen eine genauere Schätzung von VO2max und Kalorienverbrauch.</p>
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex border-b border-slate-201/80 dark:border-slate-800 pb-0.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('active')}
                  className={`flex-1 pb-2 text-[10px] font-black uppercase tracking-wider text-center border-b-2 transition-all cursor-pointer ${
                    activeTab === 'active'
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-extrabold'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
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
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Bibliothek
                </button>
              </div>

              {activeTab === 'active' && (
                <div className="space-y-2 pb-6">
                  {tracks.length === 0 && (
                    <p className="text-xs text-slate-400 italic text-center py-8 bg-slate-50/50 dark:bg-slate-900/10 rounded-xl border border-dashed border-slate-200 dark:border-slate-850">Noch keine Routen geladen.</p>
                  )}
                  <DndContext 
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext 
                      items={tracks.map(t => t.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {tracks.map((track) => (
                          <SortableTrackItem 
                            key={track.id} 
                            track={track} 
                            isMarked={markedTrackId === track.id}
                            onMark={onMarkTrack}
                            onToggleVisibility={onToggleVisibility} 
                            onRemoveTrack={onRemoveTrack} 
                            onChangeActivityType={onChangeActivityType}
                            estimatedSpeed={estimatedSpeed}
                            onOpenAnalytics={onOpenAnalytics}
                            onOpenTrainingZones={onOpenTrainingZones}
                            onOpenClimbs={onOpenClimbs}
                            onAnalyzeSurface={onAnalyzeSurface}
                            onSetTrackSurface={onSetTrackSurface}
                            isAnalyzing={analyzingSurfaces?.[track.id] || false}
                            surfaceStatus={surfaceAnalysisStatuses?.[track.id]}
                            onSaveTrackToLibrary={onSaveTrackToLibrary}
                            onOpenRawData={onOpenRawData}
                            onOpenTimeGapAnalysis={onOpenTimeGapAnalysis}
                            onSelection={onSelection}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              )}

              {activeTab === 'library' && (
                <div className="pb-6">
                  <TrackLibrary 
                    onLoadTrack={(track) => {
                      onLoadLibraryTrack?.(track);
                      setActiveTab('active');
                    }}
                    onActiveTrackId={markedTrackId}
                    selectionBounds={selectionBounds}
                    onClearSelection={onClearSelection}
                  />
                </div>
              )}
            </section>
          </div>

          <div className="relative z-10 p-4 border-t border-slate-200/50 bg-slate-50/80 backdrop-blur-sm text-[10px] text-slate-500 flex flex-col gap-1 rounded-b-xl">
            <div className="flex justify-between items-center font-medium">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className="font-semibold text-slate-600 dark:text-slate-400">
                  {isOnline ? 'Online (PWA)' : 'Offline (Cache)'}
                </span>
              </div>
              <button
                onClick={() => setIsAboutOpen(true)}
                className="font-mono text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-colors cursor-pointer font-bold flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200/70 dark:border-slate-700 hover:border-blue-300"
                title="Über dieses System / Versionsverlauf & Changelog öffnen"
              >
                <span>v{latestVersion}</span>
                <span className="text-[9px] text-blue-600 dark:text-blue-400 font-semibold underline underline-offset-2">Changelog</span>
              </button>
            </div>
            {latestBuildDate && (
              <div className="text-[9px] text-slate-400 dark:text-slate-500 font-mono text-right mt-0.5 leading-none">
                Build: {latestBuildDate}
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isAboutOpen && (
          <AboutModal 
            onClose={() => setIsAboutOpen(false)} 
            onVersionUpdated={(newVer) => setLatestVersion(newVer)}
          />
        )}
      </AnimatePresence>
    </>
  );
};

export default Sidebar;