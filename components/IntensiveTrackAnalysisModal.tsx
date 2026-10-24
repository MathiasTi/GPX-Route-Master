import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Printer, Share2, Clipboard, Heart, Activity, Zap,
  Layers, Trophy, Calendar, Clock, Bike, AlertTriangle, Sparkles,
  Navigation, CheckCircle, RefreshCw, Droplets, Flame, ShieldAlert,
  MapPin, Plus, Sliders, Info, ArrowUpRight, Gauge, ChevronRight, ChevronLeft, ChevronDown,
  TrendingUp, Mountain, Compass, Crosshair, BookOpen, Table, FileText
} from 'lucide-react';
import { GPXTrack, TextMarker, MapLayer } from '../types';
import {
  performLocalIntensiveAnalysis,
  formatSecondsToTime,
  formatSecondsToDigital,
  computeRealTrackSplits,
  RealTrackSplit,
  IntensiveAnalysisResult,
  IntensiveAnalysisOptions,
  IntensiveClimb,
  getClimbHexColor
} from '../utils/intensiveAnalysis';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceArea, ReferenceLine } from 'recharts';
import { calculateDistance, detectActivityType, detectTrackPauses } from '../utils/gpxUtils';
import { triggerHaptic } from '../utils/haptics';
import { PowerPhysicsTab } from './analysis/PowerPhysicsTab';
import { ZonesTab } from './analysis/ZonesTab';
import { RawDataTab } from './analysis/RawDataTab';
import { PrintReportTab } from './analysis/PrintReportTab';

interface IntensiveElevationChartProps {
  data: Array<{
    dist: number;
    ele: number;
    lat: number;
    lng: number;
    isClimb: boolean;
    climbIndex: number | null;
    climbLabel: string | null;
    climbAscent: number | null;
    climbAvgGrade: number | null;
    climbMaxGrade: number | null;
    climbVam: number | null;
    climbHexColor: string | null;
    climbEle: number | null;
  }>;
  climbs: IntensiveClimb[];
  minElevation: number;
  maxElevation: number;
  highlightedClimbIndex: number | null;
  onSelectClimb: (climbIndex: number | null) => void;
  showClimbHighlights: boolean;
  onToggleClimbHighlights: () => void;
  title?: string;
}

const CustomElevationTooltip = ({ active, payload, climbs }: any) => {
  if (active && payload && payload.length) {
    const point = payload[0].payload;
    const climb = point.climbIndex !== null && point.climbIndex !== undefined && climbs && climbs[point.climbIndex]
      ? climbs[point.climbIndex]
      : null;

    return (
      <div className="p-3 rounded-xl bg-slate-900/95 text-white shadow-2xl border border-slate-700/80 text-xs backdrop-blur-md min-w-[210px] space-y-2 pointer-events-none z-50">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-1.5">
          <span className="font-bold text-slate-300">Distanz: {point.dist} km</span>
          <span className="font-black text-indigo-400">{point.ele !== undefined ? `${Math.round(point.ele)} m ü.NN` : '-'}</span>
        </div>

        {climb ? (
          <div className="space-y-1.5 pt-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Mountain className="w-3.5 h-3.5 text-amber-400" />
                Anstieg #{climb.index + 1}
              </span>
              <span
                className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider text-white"
                style={{ backgroundColor: climb.hexColor || getClimbHexColor(climb.categoryLabel) }}
              >
                {climb.categoryLabel}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-2.5 gap-y-1 text-[11px] bg-slate-800/80 p-2 rounded-lg border border-slate-700/50">
              <div>
                <span className="text-slate-400 block text-[9px]">Höhengewinn</span>
                <span className="font-black text-emerald-400">+{Math.round(climb.ascentMeters)} Hm</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9px]">Ø Steigung</span>
                <span className="font-black text-amber-400">{climb.avgGradePercent}%</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9px]">Max. Rampe</span>
                <span className="font-black text-rose-400">{climb.maxGradePercent}%</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9px]">VAM Steigrate</span>
                <span className="font-black text-indigo-300">{climb.vam} m/h</span>
              </div>
            </div>

            <div className="text-[10px] text-slate-400 italic">
              km {climb.startKm} bis km {climb.endKm} ({climb.distanceKm} km Länge)
            </div>
          </div>
        ) : (
          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-slate-500" />
            <span>Regulärer Streckenabschnitt</span>
          </div>
        )}
      </div>
    );
  }
  return null;
};

const IntensiveElevationChart: React.FC<IntensiveElevationChartProps> = ({
  data,
  climbs,
  minElevation,
  maxElevation,
  highlightedClimbIndex,
  onSelectClimb,
  showClimbHighlights,
  onToggleClimbHighlights,
  title = "Höhenprofil & Streckencharakteristik"
}) => {
  return (
    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
              {title}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Min: {Math.round(minElevation)}m • Max: {Math.round(maxElevation)}m {climbs.length > 0 ? `• ${climbs.length} Bergwertungen farbig markiert` : ''}
            </p>
          </div>
        </div>

        {/* Legend & Toggle Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {climbs.length > 0 && (
            <button
              onClick={onToggleClimbHighlights}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                showClimbHighlights
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}
              title="Farbige Bergwertungs-Markierungen ein-/ausblenden"
            >
              <Mountain className="w-3.5 h-3.5" />
              <span>{showClimbHighlights ? 'Anstiege aktiv' : 'Anstiege ausblenden'}</span>
            </button>
          )}

          {/* Category color badges */}
          <div className="hidden lg:flex items-center gap-2 text-[10px] text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-purple-600"></span> HC
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-600"></span> Kat 1
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-orange-500"></span> Kat 2
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span> Kat 3
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span> Kat 4
            </span>
          </div>
        </div>
      </div>

      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 12, right: 12, left: -20, bottom: 0 }}
            onClick={(e: any) => {
              if (e && e.activePayload && e.activePayload.length) {
                const pt = e.activePayload[0].payload;
                if (pt.climbIndex !== null && pt.climbIndex !== undefined) {
                  triggerHaptic();
                  onSelectClimb(pt.climbIndex === highlightedClimbIndex ? null : pt.climbIndex);
                }
              }
            }}
          >
            <defs>
              <linearGradient id="eleIntensiveGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" opacity={0.2} />
            <XAxis dataKey="dist" unit="km" tick={{ fontSize: 10 }} />
            <YAxis domain={['auto', 'auto']} unit="m" tick={{ fontSize: 10 }} />

            <Tooltip content={<CustomElevationTooltip climbs={climbs} />} />

            {/* Colored Reference Areas for each identified climb */}
            {showClimbHighlights && climbs.map((climb) => {
              const isSelected = highlightedClimbIndex === climb.index;
              const color = climb.hexColor || getClimbHexColor(climb.categoryLabel);
              return (
                <ReferenceArea
                  key={`climb-ref-${climb.index}`}
                  x1={climb.startKm}
                  x2={climb.endKm}
                  y1={minElevation}
                  fill={color}
                  fillOpacity={isSelected ? 0.45 : 0.22}
                  stroke={color}
                  strokeOpacity={isSelected ? 0.95 : 0.6}
                  strokeWidth={isSelected ? 2 : 1}
                  strokeDasharray={isSelected ? undefined : '3 3'}
                />
              );
            })}

            {/* Start & Peak Reference Lines */}
            {showClimbHighlights && climbs.map((climb) => {
              const isSelected = highlightedClimbIndex === climb.index;
              const color = climb.hexColor || getClimbHexColor(climb.categoryLabel);
              return (
                <React.Fragment key={`climb-lines-${climb.index}`}>
                  <ReferenceLine
                    x={climb.startKm}
                    stroke={color}
                    strokeWidth={isSelected ? 1.5 : 1}
                    strokeDasharray="2 2"
                    strokeOpacity={0.7}
                  />
                  <ReferenceLine
                    x={climb.endKm}
                    stroke={color}
                    strokeWidth={isSelected ? 2 : 1.5}
                    label={{
                      value: `#${climb.index + 1}`,
                      position: 'insideTopRight',
                      fill: color,
                      fontSize: 10,
                      fontWeight: 'bold'
                    }}
                  />
                </React.Fragment>
              );
            })}

            {/* Base Track Elevation Area */}
            <Area
              type="monotone"
              dataKey="ele"
              stroke="#6366f1"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#eleIntensiveGrad)"
              isAnimationActive={false}
            />

            {/* Climb specific highlighted stroke */}
            {showClimbHighlights && (
              <Area
                type="monotone"
                dataKey="climbEle"
                stroke="#f43f5e"
                strokeWidth={3}
                fill="none"
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Quick Climb Select Chips */}
      {climbs.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 shrink-0">
            Anstiege:
          </span>
          {climbs.map((climb) => {
            const isSelected = highlightedClimbIndex === climb.index;
            const color = climb.hexColor || getClimbHexColor(climb.categoryLabel);
            return (
              <button
                key={climb.index}
                onClick={() => {
                  triggerHaptic();
                  onSelectClimb(isSelected ? null : climb.index);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-all flex items-center gap-1.5 cursor-pointer ${
                  isSelected
                    ? 'ring-2 ring-indigo-500 shadow-md bg-indigo-600 text-white'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:border-slate-400'
                }`}
                title={`Anstieg #${climb.index + 1} (${climb.categoryLabel}) im Profil hervorheben`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span>#{climb.index + 1} {climb.categoryLabel}</span>
                <span className={isSelected ? 'text-indigo-200' : 'text-emerald-600 dark:text-emerald-400'}>
                  +{Math.round(climb.ascentMeters)}m
                </span>
                <span className={isSelected ? 'text-indigo-200' : 'text-slate-400'}>
                  ({climb.startKm}–{climb.endKm} km)
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export type AnalysisTab = 'overview' | 'power' | 'climbs' | 'zones' | 'nutrition' | 'splits' | 'tactics' | 'pauses' | 'rawdata' | 'report' | 'pois';

export interface IntensiveTrackAnalysisModalProps {
  track: GPXTrack;
  allTracks?: GPXTrack[];
  onSelectTrack?: (trackId: string) => void;
  initialTab?: AnalysisTab;
  onClose: () => void;
  ftp?: number;
  userWeight?: number;
  userAge?: number;
  userMaxHr?: number;
  estimatedSpeed?: number;
  textMarkers?: TextMarker[];
  activeLayer?: MapLayer;
  selectionBounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
  onSelection?: (bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null) => void;
  onAddTextMarker?: (marker: Omit<TextMarker, 'id'>) => void;
  onSelectTrackPoint?: (lat: number, lng: number) => void;
  onOpenGlossary?: (metricId?: string) => void;
  onReverseTrack?: (trackId: string) => void;
  onSanitizeTrack?: (trackId: string) => void;
}

export const IntensiveTrackAnalysisModal: React.FC<IntensiveTrackAnalysisModalProps> = ({
  track,
  allTracks,
  onSelectTrack,
  initialTab = 'overview',
  onClose,
  ftp = 220,
  userWeight = 75,
  userAge = 35,
  userMaxHr = 185,
  estimatedSpeed = 24,
  textMarkers = [],
  activeLayer,
  selectionBounds,
  onSelection,
  onAddTextMarker,
  onSelectTrackPoint,
  onOpenGlossary,
  onReverseTrack,
  onSanitizeTrack
}) => {
  // Activity Configuration State
  const initialDetected = useMemo<'cycling' | 'running'>(() => {
    if (track.activityType === 'running' || track.activityType === 'cycling') {
      return track.activityType;
    }
    return detectActivityType(track.points || [], track.name || '', track.name || '');
  }, [track.activityType, track.points, track.name]);

  const [activityType, setActivityType] = useState<'cycling' | 'running'>(initialDetected);
  const [subType, setSubType] = useState<'road' | 'gravel' | 'mtb' | 'trail'>(
    initialDetected === 'running' ? 'trail' : 'road'
  );
  const [fitnessLevel, setFitnessLevel] = useState<'beginner' | 'moderate' | 'advanced' | 'elite'>('moderate');
  const [customFtp, setCustomFtp] = useState<number>(ftp || 220);
  const [customWeight, setCustomWeight] = useState<number>(userWeight || 75);
  const [customTemp, setCustomTemp] = useState<number>(20);
  const [activeTab, setActiveTab] = useState<AnalysisTab>(initialTab || 'overview');

  useEffect(() => {
    setActivityType(initialDetected);
    setSubType(initialDetected === 'running' ? 'trail' : 'road');
  }, [track.id, initialDetected]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const [copied, setCopied] = useState(false);
  const [addedPois, setAddedPois] = useState<Record<string, boolean>>({});
  const [highlightedClimbIndex, setHighlightedClimbIndex] = useState<number | null>(null);
  const [showClimbHighlights, setShowClimbHighlights] = useState<boolean>(true);
  const [splitIntervalKm, setSplitIntervalKm] = useState<1 | 5 | 10>(1);
  const [isMobileParamsExpanded, setIsMobileParamsExpanded] = useState<boolean>(false);

  // Automatic Pause & Net Time Analysis
  const pauseAnalysis = useMemo(() => {
    return detectTrackPauses(track);
  }, [track]);

  // Compute Analysis
  const analysis: IntensiveAnalysisResult = useMemo(() => {
    return performLocalIntensiveAnalysis(
      track,
      {
        activityType,
        subType,
        fitnessLevel,
        targetFtp: customFtp,
        userWeightKg: customWeight,
        temperatureC: customTemp
      },
      textMarkers
    );
  }, [track, activityType, subType, fitnessLevel, customFtp, customWeight, customTemp, textMarkers]);

  const realSplits: RealTrackSplit[] = useMemo(() => {
    return computeRealTrackSplits(
      { ...track, activityType },
      splitIntervalKm,
      analysis.estimatedAverageSpeedKmh || estimatedSpeed
    );
  }, [track, activityType, splitIntervalKm, analysis.estimatedAverageSpeedKmh, estimatedSpeed]);

  // Downsample profile data for elevation & grade chart with climb mapping
  const elevationData = useMemo(() => {
    if (!track.points || track.points.length === 0) return [];
    let accumDist = 0;
    const sampled = [];
    const step = Math.max(1, Math.floor(track.points.length / 150));

    for (let i = 0; i < track.points.length; i += step) {
      const p = track.points[i];
      if (i > 0) {
        accumDist += calculateDistance(track.points[Math.max(0, i - step)], p);
      }
      const distKm = Number(accumDist.toFixed(2));
      const ele = p.ele !== undefined ? Math.round(p.ele) : 0;

      // Find matching climb segment
      const climb = analysis.climbs.find(c => distKm >= c.startKm && distKm <= c.endKm);

      sampled.push({
        dist: distKm,
        ele: ele,
        lat: p.lat,
        lng: p.lng,
        isClimb: !!climb,
        climbIndex: climb ? climb.index : null,
        climbLabel: climb ? climb.categoryLabel : null,
        climbAscent: climb ? climb.ascentMeters : null,
        climbAvgGrade: climb ? climb.avgGradePercent : null,
        climbMaxGrade: climb ? climb.maxGradePercent : null,
        climbVam: climb ? climb.vam : null,
        climbHexColor: climb ? (climb.hexColor || getClimbHexColor(climb.categoryLabel)) : null,
        climbEle: climb ? ele : null
      });
    }
    return sampled;
  }, [track.points, analysis.climbs]);

  const handleCopySummary = () => {
    triggerHaptic();
    const climbsSummary = analysis.climbs.length > 0
      ? `\n⛰️ ${activityType === 'running' ? 'Trail-Steigungen' : 'Bergwertungen'} (${analysis.climbs.length}): ${Math.round(analysis.totalClimbAscentMeters)} Hm in Anstiegen (${analysis.totalClimbDistanceKm} km)`
      : '';
    const text = `📊 INTENSIVE STRECKENANALYSE: ${analysis.trackName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📏 Distanz: ${analysis.totalDistanceKm} km | ⛰️ Höhenmeter: +${Math.round(analysis.totalAscentMeters)}m / -${Math.round(analysis.totalDescentMeters)}m${climbsSummary}
⏱️ Geschätzte ${activityType === 'running' ? 'Laufzeit' : 'Fahrzeit'}: ${formatSecondsToTime(analysis.estimatedMovingTimeSeconds)} (Brutto: ${formatSecondsToTime(analysis.estimatedElapsedTimeSeconds)})
🚀 ${activityType === 'running' ? `Ø-Pace: ${(60 / analysis.estimatedAverageSpeedKmh).toFixed(2)} min/km (Tempo: ${analysis.estimatedAverageSpeedKmh} km/h)` : `Ø-Geschwindigkeit: ${analysis.estimatedAverageSpeedKmh} km/h`}
🔥 Kalorienverbrauch: ${analysis.totalCaloriesKcal} kcal (${analysis.carbsBurnedGrams}g KH / ${analysis.fatBurnedGrams}g Fett)
💧 Flüssigkeitsbedarf: ${analysis.totalFluidRecommendedLiters} Liter | 🧂 Natrium: ~${analysis.sodiumRecommendedMg} mg
🎯 Schwierigkeitsgrad: ${analysis.difficultyScore}/10
━━━━━━━━━━━━━━━━━━━━━━━━━━━
GPX Route Master Pro`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleAddPoiToMap = (poi: IntensiveAnalysisResult['poiRecommendations'][0], idx: number) => {
    if (!onAddTextMarker) return;
    triggerHaptic();
    onAddTextMarker({
      lat: poi.lat,
      lng: poi.lng,
      label: `${poi.title} (km ${poi.kmLocation})`,
      color: poi.type === 'summit' ? '#ef4444' : poi.type === 'water' ? '#06b6d4' : '#f59e0b'
    });
    setAddedPois(prev => ({ ...prev, [idx]: true }));
  };

  const handleFocusClimb = (climb: IntensiveClimb) => {
    triggerHaptic('medium');
    if (onSelection && climb.points && climb.points.length > 0) {
      const lats = climb.points.map(p => p.lat);
      const lngs = climb.points.map(p => p.lng);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const latBuf = Math.max((maxLat - minLat) * 0.18, 0.004);
      const lngBuf = Math.max((maxLng - minLng) * 0.18, 0.004);
      onSelection({
        minLat: minLat - latBuf,
        maxLat: maxLat + latBuf,
        minLng: minLng - lngBuf,
        maxLng: maxLng + lngBuf
      });
    } else if (onSelectTrackPoint) {
      onSelectTrackPoint(climb.peakPoint.lat, climb.peakPoint.lng);
    }
  };

  const handleAddClimbMarkers = (climb: IntensiveClimb) => {
    if (!onAddTextMarker) return;
    triggerHaptic('success');
    // Start marker
    onAddTextMarker({
      lat: climb.startPoint.lat,
      lng: climb.startPoint.lng,
      label: `Start Anstieg #${climb.index + 1} (${Math.round(climb.startElevationM)}m, km ${climb.startKm})`,
      color: '#3b82f6'
    });
    // Peak marker
    onAddTextMarker({
      lat: climb.peakPoint.lat,
      lng: climb.peakPoint.lng,
      label: `Gipfel #${climb.index + 1} (${climb.categoryLabel}: +${Math.round(climb.ascentMeters)}m @ ${climb.avgGradePercent}%)`,
      color: '#ef4444'
    });
    setAddedPois(prev => ({ ...prev, [`climb-${climb.index}`]: true }));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[2000] flex items-center justify-center p-2 sm:p-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-xs cursor-pointer"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 15 }}
        className="bg-white dark:bg-slate-900 w-full max-w-5xl max-h-[calc(100dvh-1rem)] sm:max-h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800 cursor-default"
        id="intensive-analysis-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 sm:px-5 py-3 sm:py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-indigo-50/50 via-white to-purple-50/50 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/30 gap-2 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-200 dark:shadow-none shrink-0">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-amber-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight truncate">
                  {activityType === 'running' ? 'Intensive Laufanalyse' : 'Intensive Streckenanalyse'}
                </h2>
                <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 shrink-0">
                  Physics & Nutrition Pro
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-0.5">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate">
                  {analysis.trackName} • {analysis.totalDistanceKm} km • +{Math.round(analysis.totalAscentMeters)} Hm
                </span>

                {allTracks && allTracks.length > 1 && onSelectTrack && (
                  <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 shrink-0">
                    <button
                      type="button"
                      disabled={allTracks.findIndex(t => t.id === track.id) <= 0}
                      onClick={() => {
                        const idx = allTracks.findIndex(t => t.id === track.id);
                        if (idx > 0) {
                          triggerHaptic('light');
                          onSelectTrack(allTracks[idx - 1].id);
                        }
                      }}
                      className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-600 dark:text-slate-300"
                      title="Vorherige Etappe / Track"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <select
                      value={track.id}
                      onChange={(e) => {
                        triggerHaptic('light');
                        onSelectTrack(e.target.value);
                      }}
                      className="bg-transparent text-[11px] font-bold text-slate-800 dark:text-slate-200 cursor-pointer focus:outline-none max-w-[140px] sm:max-w-[210px] truncate"
                      title="Zu anderer Etappe / Route wechseln"
                    >
                      {allTracks.map((t, idx) => (
                        <option key={t.id} value={t.id} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                          {idx + 1}. {t.name} ({t.distance.toFixed(1)} km)
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={allTracks.findIndex(t => t.id === track.id) >= allTracks.length - 1}
                      onClick={() => {
                        const idx = allTracks.findIndex(t => t.id === track.id);
                        if (idx < allTracks.length - 1) {
                          triggerHaptic('light');
                          onSelectTrack(allTracks[idx + 1].id);
                        }
                      }}
                      className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-600 dark:text-slate-300"
                      title="Nächste Etappe / Track"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {onOpenGlossary && (
              <button
                onClick={() => onOpenGlossary()}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 transition-colors cursor-pointer"
                title="Wissenschaftliches Sport-Metriken Glossar & Rechner öffnen"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Sport-Glossar</span>
              </button>
            )}

            <button
              onClick={handleCopySummary}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              title="Zusammenfassung kopieren"
            >
              {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <Clipboard className="w-3.5 h-3.5" />}
              <span>{copied ? 'Kopiert!' : 'Kopieren'}</span>
            </button>

            <button
              onClick={() => window.print()}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              title="Drucken / PDF"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Drucken</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-colors cursor-pointer shrink-0 shadow-xs"
              aria-label="Schließen"
              title="Schließen (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mobile Compact Parameter Ribbon (< 640px) */}
        <div className="flex sm:hidden items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200/80 dark:border-slate-800 text-xs">
          <div className="flex items-center gap-1.5 truncate">
            <span className="font-bold flex items-center gap-1 text-slate-800 dark:text-slate-200 shrink-0">
              {activityType === 'cycling' ? <Bike className="w-3.5 h-3.5 text-indigo-500 shrink-0" /> : <Activity className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
              <span>
                {activityType === 'cycling' 
                  ? (subType === 'road' ? 'Rennrad' : subType === 'gravel' ? 'Gravel' : 'MTB') 
                  : (subType === 'trail' ? 'Trail' : 'Lauf')}
              </span>
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600 dark:text-slate-300 font-mono text-[11px] font-semibold truncate">
              {activityType === 'cycling' ? `${customFtp}W` : fitnessLevel} · {customWeight}kg · {customTemp}°C
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              triggerHaptic('light');
              setIsMobileParamsExpanded(prev => !prev);
            }}
            className="flex items-center gap-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800/60 shrink-0 cursor-pointer touch-manipulation active:scale-95 transition-transform"
          >
            <span>{isMobileParamsExpanded ? 'Weniger' : 'Parameter'}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isMobileParamsExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Dynamic Parameter Ribbon (Desktop full, Mobile collapsible) */}
        <div className={`${isMobileParamsExpanded ? 'flex' : 'hidden sm:flex'} px-3 sm:px-5 py-2.5 sm:py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 flex-wrap items-center justify-between gap-3 sm:gap-4 text-xs transition-all`}>
          <div className="flex flex-wrap items-center gap-3">
            {/* Activity Switch */}
            <div className="flex items-center bg-white dark:bg-slate-900 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700 shadow-2xs">
              <button
                onClick={() => setActivityType('cycling')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                  activityType === 'cycling'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Bike className="w-3.5 h-3.5" />
                <span>Radsport</span>
              </button>
              <button
                onClick={() => setActivityType('running')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                  activityType === 'running'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Laufen/Trail</span>
              </button>
            </div>

            {/* SubType Select */}
            <select
              value={subType}
              onChange={(e) => setSubType(e.target.value as any)}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 font-semibold text-slate-700 dark:text-slate-300 cursor-pointer shadow-2xs"
            >
              {activityType === 'cycling' ? (
                <>
                  <option value="road">Rennrad (Asphalt)</option>
                  <option value="gravel">Gravel / Allroad</option>
                  <option value="mtb">Mountainbike / Trail</option>
                </>
              ) : (
                <>
                  <option value="trail">Trailrunning / Berg</option>
                  <option value="road">Straßenlauf / Asphalt</option>
                </>
              )}
            </select>

            {/* Fitness Level */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 dark:text-slate-400 font-medium">Fitness:</span>
              <select
                value={fitnessLevel}
                onChange={(e) => setFitnessLevel(e.target.value as any)}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 font-semibold text-slate-700 dark:text-slate-300 cursor-pointer shadow-2xs"
              >
                <option value="beginner">Einsteiger (65% FTP/Tempo)</option>
                <option value="moderate">Fortgeschritten (80%)</option>
                <option value="advanced">Sportlich (95%)</option>
                <option value="elite">Elite / Wettkampf (115%)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-4 text-slate-600 dark:text-slate-300 font-semibold">
            {activityType === 'cycling' && (
              <div className="flex items-center gap-1.5" title="Schwellenleistung in Watt">
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                <span>FTP:</span>
                <input
                  type="number"
                  value={customFtp}
                  onChange={(e) => setCustomFtp(Math.max(100, Math.min(500, Number(e.target.value))))}
                  className="w-14 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 text-center font-bold text-slate-800 dark:text-slate-200"
                />
                <span className="text-[11px] text-slate-400">W</span>
              </div>
            )}

            <div className="flex items-center gap-1.5" title={activityType === 'running' ? "Läufergewicht" : "Fahrergewicht"}>
              <Gauge className="w-3.5 h-3.5 text-indigo-500" />
              <span>Gewicht:</span>
              <input
                type="number"
                value={customWeight}
                onChange={(e) => setCustomWeight(Math.max(40, Math.min(150, Number(e.target.value))))}
                className="w-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 text-center font-bold text-slate-800 dark:text-slate-200"
              />
              <span className="text-[11px] text-slate-400">kg</span>
            </div>

            <div className="flex items-center gap-1.5" title="Erwartete Temperatur">
              <Droplets className="w-3.5 h-3.5 text-blue-500" />
              <span>Temp:</span>
              <input
                type="number"
                value={customTemp}
                onChange={(e) => setCustomTemp(Math.max(-10, Math.min(45, Number(e.target.value))))}
                className="w-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 text-center font-bold text-slate-800 dark:text-slate-200"
              />
              <span className="text-[11px] text-slate-400">°C</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center px-5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 gap-1 overflow-x-auto">
          <button
            onClick={() => {
              triggerHaptic('light');
              setActiveTab('overview');
            }}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'overview'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Gauge className="w-4 h-4" />
            <span>{activityType === 'running' ? 'Laufzeit & Physis' : 'Fahrzeit & Physis'}</span>
          </button>

          <button
            onClick={() => {
              triggerHaptic('light');
              setActiveTab('power');
            }}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'power'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Zap className="w-4 h-4 text-amber-500" />
            <span>Leistung & Physik</span>
          </button>

          <button
            onClick={() => {
              triggerHaptic('light');
              setActiveTab('climbs');
            }}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'climbs'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <span>Anstiege & Berge</span>
            {analysis.climbs.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                {analysis.climbs.length}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              triggerHaptic('light');
              setActiveTab('zones');
            }}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'zones'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Heart className="w-4 h-4 text-rose-500" />
            <span>Trainingszonen</span>
          </button>

          <button
            onClick={() => {
              triggerHaptic('light');
              setActiveTab('nutrition');
            }}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'nutrition'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Flame className="w-4 h-4 text-orange-500" />
            <span>Kalorien & Verpflegung</span>
          </button>

          <button
            onClick={() => {
              triggerHaptic('light');
              setActiveTab('splits');
            }}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'splits'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4 text-blue-500" />
            <span>Etappen-Splits</span>
          </button>

          <button
            onClick={() => {
              triggerHaptic('light');
              setActiveTab('tactics');
            }}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'tactics'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ShieldAlert className="w-4 h-4 text-emerald-500" />
            <span>Taktik & Pacing</span>
          </button>

          <button
            onClick={() => {
              triggerHaptic('light');
              setActiveTab('pauses');
            }}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'pauses'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Clock className="w-4 h-4 text-amber-500" />
            <span>Pausen & Stopps</span>
            {pauseAnalysis.pauses.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {pauseAnalysis.pauses.length}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              triggerHaptic('light');
              setActiveTab('rawdata');
            }}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'rawdata'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Table className="w-4 h-4 text-indigo-500" />
            <span>Telemetrie & Rohdaten</span>
          </button>

          <button
            onClick={() => {
              triggerHaptic('light');
              setActiveTab('report');
            }}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'report'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <FileText className="w-4 h-4 text-slate-500" />
            <span>Druck-Report</span>
          </button>

          <button
            onClick={() => {
              triggerHaptic('light');
              setActiveTab('pois');
            }}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'pois'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <MapPin className="w-4 h-4 text-purple-500" />
            <span>POIs & Wegpunkte</span>
            {analysis.poiRecommendations.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-black bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                {analysis.poiRecommendations.length}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Primary KPI Card Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {activityType === 'running' ? 'Reine Laufzeit (Netto)' : 'Reine Fahrzeit (Netto)'}
                    </span>
                    <Clock className="w-4 h-4 text-indigo-500" />
                  </div>
                  <div className="text-xl font-black text-slate-900 dark:text-white">
                    {formatSecondsToTime(analysis.estimatedMovingTimeSeconds)}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Brutto inkl. Pausen: {formatSecondsToTime(analysis.estimatedElapsedTimeSeconds)}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {activityType === 'running' ? 'Ø-Laufpace' : 'Ø-Geschwindigkeit'}
                    </span>
                    <Activity className="w-4 h-4 text-blue-500" />
                  </div>
                  <div className="text-xl font-black text-slate-900 dark:text-white">
                    {activityType === 'running' ? (
                      <>
                        {(60 / analysis.estimatedAverageSpeedKmh).toFixed(2)} <span className="text-xs font-normal text-slate-400">min/km</span>
                      </>
                    ) : (
                      <>
                        {analysis.estimatedAverageSpeedKmh} <span className="text-xs font-normal text-slate-400">km/h</span>
                      </>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    {activityType === 'running'
                      ? `Tempo: ${analysis.estimatedAverageSpeedKmh} km/h`
                      : `Pace: ${(60 / analysis.estimatedAverageSpeedKmh).toFixed(2)} min/km`}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Energieverbrauch</span>
                    <Flame className="w-4 h-4 text-orange-500" />
                  </div>
                  <div className="text-xl font-black text-slate-900 dark:text-white">
                    {analysis.totalCaloriesKcal} <span className="text-xs font-normal text-slate-400">kcal</span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    ~{analysis.carbsBurnedGrams}g Carbs / {analysis.fatBurnedGrams}g Fett
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Schwierigkeits-Score</span>
                    <Trophy className="w-4 h-4 text-amber-500" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-xl font-black text-slate-900 dark:text-white">
                      {analysis.difficultyScore}<span className="text-xs text-slate-400">/10</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      analysis.difficultyScore > 7
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                        : analysis.difficultyScore > 4
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    }`}>
                      {analysis.difficultyScore > 7 ? 'Sehr fordernd' : analysis.difficultyScore > 4 ? 'Mittel' : 'Moderat'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Max. Steigung: {analysis.maxGradePercent}%
                  </div>
                </div>
              </div>

              {/* Elevation & Grade Chart with Colored Climb Segments */}
              <IntensiveElevationChart
                data={elevationData}
                climbs={analysis.climbs}
                minElevation={analysis.minElevation}
                maxElevation={analysis.maxElevation}
                highlightedClimbIndex={highlightedClimbIndex}
                onSelectClimb={setHighlightedClimbIndex}
                showClimbHighlights={showClimbHighlights}
                onToggleClimbHighlights={() => setShowClimbHighlights(prev => !prev)}
                title="Höhenprofil & Streckencharakteristik"
              />

              {/* Climbs & Key Ascents Highlight Banner */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-indigo-500/10 border border-emerald-500/20 dark:border-emerald-500/30">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-emerald-500 text-white shadow-xs">
                      <Mountain className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                        Bergwertungen & Anstiegs-Fokus
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {analysis.climbs.length > 0
                          ? `${analysis.climbs.length} kategorisierte ${analysis.climbs.length === 1 ? 'Bergwertung' : 'Bergwertungen'} erkannt (+${Math.round(analysis.totalClimbAscentMeters)} Hm in Anstiegen)`
                          : 'Keine steilen kategorisierten Passagen auf diesem Streckenabschnitt'}
                      </p>
                    </div>
                  </div>

                  {analysis.climbs.length > 0 && (
                    <button
                      onClick={() => {
                        triggerHaptic();
                        setActiveTab('climbs');
                      }}
                      className="flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 bg-emerald-100/80 dark:bg-emerald-950/80 hover:bg-emerald-200/80 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shrink-0"
                    >
                      <span>Alle Anstiege im Detail ({analysis.climbs.length})</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {analysis.climbs.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                    {analysis.climbs.slice(0, 3).map((climb, i) => (
                      <div
                        key={i}
                        onClick={() => {
                          triggerHaptic();
                          setActiveTab('climbs');
                        }}
                        className="p-2.5 rounded-lg bg-white/80 dark:bg-slate-900/80 border border-slate-200/60 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-emerald-600 transition-all cursor-pointer shadow-xs group"
                      >
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-xs font-black text-slate-800 dark:text-slate-200 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                            #{climb.index + 1} km {climb.startKm} → {climb.endKm}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-black tracking-tight ${climb.categoryColor}`}>
                            {climb.categoryLabel}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center justify-between">
                          <span>{climb.distanceKm} km • +{Math.round(climb.ascentMeters)} Hm</span>
                          <span className="font-bold text-slate-900 dark:text-white">Ø {climb.avgGradePercent}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Das Höhenprofil weist keine steilen Anstiege über den Bergwertungs-Schwellenwerten auf. Ein gleichmäßiges Ausdauer-Pacing wird empfohlen.
                  </p>
                )}
              </div>

              {/* Terrain & Slope Distribution */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-3">
                  Steigungs- & Geländeverteilung
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Flach (&lt; 2.5%)</span>
                    <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                      {analysis.flatDistanceKm} km
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Ansteigend (2.5–8%)</span>
                    <div className="text-base font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                      {analysis.climbingDistanceKm} km
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Steilstufe (&gt; 8%)</span>
                    <div className="text-base font-bold text-rose-600 dark:text-rose-400 mt-0.5">
                      {analysis.steepClimbDistanceKm} km
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {activityType === 'running' ? 'Gefälle / Bergab (< -2.5%)' : 'Abfahrt (< -2.5%)'}
                    </span>
                    <div className="text-base font-bold text-blue-600 dark:text-blue-400 mt-0.5">
                      {analysis.descentDistanceKm} km
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'climbs' && (
            <div className="space-y-5">
              {/* Header & Quick stats */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    {activityType === 'running' ? 'Kategorisierte Anstiege & Berglauf-Profile' : 'Kategorisierte Anstiege & Bergwertungen'}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {activityType === 'running'
                      ? 'Detaillierte Analyse aller signifikanten Steigungsabschnitte mit Steigleistung (VAM), Laufzeit- & Paceprognosen.'
                      : 'Detaillierte Analyse aller signifikanten Steigungsabschnitte mit Steigleistung (VAM), Zeit- & Wattprognosen.'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                    {analysis.climbs.length} {analysis.climbs.length === 1 ? (activityType === 'running' ? 'Trail-Anstieg' : 'Anstieg') : (activityType === 'running' ? 'Trail-Anstiege' : 'Anstiege')} erkannt
                  </span>
                </div>
              </div>

              {/* KPI Ribbon */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {activityType === 'running' ? 'Steigungs-Segmente' : 'Bergwertungen'}
                  </span>
                  <div className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                    {analysis.climbs.length}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Hm in Anstiegen</span>
                  <div className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                    +{Math.round(analysis.totalClimbAscentMeters)} m
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {analysis.totalAscentMeters > 0 ? Math.round((analysis.totalClimbAscentMeters / analysis.totalAscentMeters) * 100) : 0}% der Gesamthöhe
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Distanz bergauf</span>
                  <div className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                    {analysis.totalClimbDistanceKm} km
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {analysis.totalDistanceKm > 0 ? Math.round((analysis.totalClimbDistanceKm / analysis.totalDistanceKm) * 100) : 0}% der Strecke
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Max. Steigung</span>
                  <div className="text-lg font-black text-rose-600 dark:text-rose-400 mt-0.5">
                    {analysis.maxGradePercent}%
                  </div>
                  <div className="text-[10px] text-slate-400">Steilste Rampe</div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Ø Steigrate (VAM)</span>
                  <div className="text-lg font-black text-indigo-600 dark:text-indigo-400 mt-0.5">
                    {analysis.climbs.length > 0
                      ? `~${Math.round(analysis.climbs.reduce((acc, c) => acc + c.vam, 0) / analysis.climbs.length)}`
                      : '0'}{' '}
                    <span className="text-xs font-normal">m/h</span>
                  </div>
                  <div className="text-[10px] text-slate-400">Vertikal-Speed</div>
                </div>
              </div>

              {/* Interactive Elevation Chart in Climbs Tab */}
              {analysis.climbs.length > 0 && (
                <IntensiveElevationChart
                  data={elevationData}
                  climbs={analysis.climbs}
                  minElevation={analysis.minElevation}
                  maxElevation={analysis.maxElevation}
                  highlightedClimbIndex={highlightedClimbIndex}
                  onSelectClimb={setHighlightedClimbIndex}
                  showClimbHighlights={showClimbHighlights}
                  onToggleClimbHighlights={() => setShowClimbHighlights(prev => !prev)}
                  title="Höhenprofil & Bergwertungen"
                />
              )}

              {/* Climbs Card List */}
              {analysis.climbs.length > 0 ? (
                <div className="space-y-3.5">
                  {analysis.climbs.map((climb, idx) => {
                    const isSelected = highlightedClimbIndex === climb.index;
                    return (
                      <div
                        key={idx}
                        className={`p-4 rounded-2xl bg-white dark:bg-slate-900 border transition-all shadow-xs space-y-3 ${
                          isSelected
                            ? 'ring-2 ring-indigo-500 border-indigo-500 bg-indigo-50/15 dark:bg-indigo-950/25'
                            : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                      {/* Climb Card Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-black text-xs flex items-center justify-center shrink-0">
                            #{climb.index + 1}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h5 className="text-sm font-black text-slate-900 dark:text-white">
                                Anstieg #{climb.index + 1}
                              </h5>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-black tracking-tight ${climb.categoryColor}`}>
                                {climb.categoryLabel}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              km {climb.startKm} → km {climb.endKm} ({climb.distanceKm} km Streckenlänge)
                            </p>
                          </div>
                        </div>

                        {/* Interactive Buttons */}
                        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0 flex-wrap">
                          <button
                            onClick={() => {
                              triggerHaptic();
                              setHighlightedClimbIndex(isSelected ? null : climb.index);
                            }}
                            className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                            }`}
                            title="Anstieg im Höhenprofil markieren"
                          >
                            <TrendingUp className="w-3.5 h-3.5" />
                            <span>{isSelected ? 'Hervorgehoben' : 'Im Profil zeigen'}</span>
                          </button>

                          <button
                            onClick={() => handleFocusClimb(climb)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                            title="Auf Karte zentrieren & anzoomen"
                          >
                            <Crosshair className="w-3.5 h-3.5 text-indigo-500" />
                            <span>Auf Karte zeigen</span>
                          </button>

                          {onAddTextMarker && (
                            <button
                              onClick={() => handleAddClimbMarkers(climb)}
                              disabled={addedPois[`climb-${climb.index}`]}
                              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                addedPois[`climb-${climb.index}`]
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
                              }`}
                              title="Start- und Gipfelmarker auf Karte setzen"
                            >
                              {addedPois[`climb-${climb.index}`] ? (
                                <>
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  <span>Marker gesetzt</span>
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Als POI-Marker</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Climb Metrics Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                          <span className="text-[10px] text-slate-400 block mb-0.5">Höhenunterschied</span>
                          <span className="font-black text-emerald-600 dark:text-emerald-400 text-sm">
                            +{Math.round(climb.ascentMeters)} m
                          </span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                          <span className="text-[10px] text-slate-400 block mb-0.5">Start → Gipfel</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {Math.round(climb.startElevationM)}m → {Math.round(climb.endElevationM)}m
                          </span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                          <span className="text-[10px] text-slate-400 block mb-0.5">Ø / Max Steigung</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {climb.avgGradePercent}% / <span className="text-rose-500 font-black">{climb.maxGradePercent}%</span>
                          </span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                          <span className="text-[10px] text-slate-400 block mb-0.5">
                            {(activityType === 'running' || analysis.activityType === 'running') ? 'Prognose Laufzeit' : 'Prognose Fahrzeit'}
                          </span>
                          <span className="font-black text-indigo-600 dark:text-indigo-400 text-sm">
                            {formatSecondsToTime(climb.estimatedTimeSeconds)}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                          <span className="text-[10px] text-slate-400 block mb-0.5">
                            {(activityType === 'cycling' && analysis.activityType !== 'running') ? 'Zielleistung' : 'Lauf-Pace'}
                          </span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {climb.estimatedPowerWatts ? `~${climb.estimatedPowerWatts} W` : 'Pacing Z3'}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                          <span className="text-[10px] text-slate-400 block mb-0.5">Steigrate (VAM)</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            ~{climb.vam} m/h
                          </span>
                        </div>
                      </div>

                      {/* Visual Gradient Bar & Description */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="italic">{climb.categoryDescription}</span>
                          <span className="font-bold text-slate-700 dark:text-slate-300">
                            Steigungsprofil {climb.avgGradePercent}%
                          </span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                          <div
                            className={`h-full rounded-full transition-all ${
                              climb.avgGradePercent > 10
                                ? 'bg-gradient-to-r from-rose-500 to-red-600'
                                : climb.avgGradePercent > 6
                                ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                                : 'bg-gradient-to-r from-emerald-500 to-amber-500'
                            }`}
                            style={{ width: `${Math.min(100, (climb.avgGradePercent / 15) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              ) : (
                <div className="p-8 text-center rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-slate-200 dark:bg-slate-700 text-slate-500 flex items-center justify-center mx-auto mb-2">
                    <Mountain className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    Keine signifikanten Bergwertungen erkannt
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                    Die gewählte Route verläuft weitgehend flach oder über milde Wellen, sodass keine Abschnitte die Kriterien einer Bergwertung (z.B. min. 200m Länge und &gt;3% Steigung) überschreiten.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'nutrition' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Fluid Plan */}
                <div className="p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/80 dark:border-blue-900/50">
                  <div className="flex items-center gap-2 mb-2 text-blue-700 dark:text-blue-300 font-bold">
                    <Droplets className="w-5 h-5 text-blue-600" />
                    <h4>Hydrations-Masterplan</h4>
                  </div>
                  <div className="text-2xl font-black text-blue-900 dark:text-blue-100">
                    {analysis.totalFluidRecommendedLiters} <span className="text-sm font-normal">Liter</span>
                  </div>
                  <p className="text-xs text-blue-700/80 dark:text-blue-300/80 mt-2 leading-relaxed">
                    Empfehlung: Alle 15–20 Minuten ca. 150–200 ml trinken. Bei {customTemp}°C entspricht dies ca.{' '}
                    {(analysis.totalFluidRecommendedLiters / (analysis.estimatedMovingTimeSeconds / 3600)).toFixed(2)} l/h.
                  </p>
                </div>

                {/* Carbohydrates Plan */}
                <div className="p-4 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/50">
                  <div className="flex items-center gap-2 mb-2 text-amber-700 dark:text-amber-300 font-bold">
                    <Flame className="w-5 h-5 text-amber-600" />
                    <h4>Kohlenhydrate & Energie</h4>
                  </div>
                  <div className="text-2xl font-black text-amber-900 dark:text-amber-100">
                    {analysis.hourlyCarbIntakeRecommendedGrams} <span className="text-sm font-normal">g / Stunde</span>
                  </div>
                  <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-2 leading-relaxed">
                    Gesamt verbrannt: ~{analysis.carbsBurnedGrams}g Carbs. Zufuhr deckt den Glykogenspeicher (z.B. 1 Gel
                    + 1/2 Riegel pro Stunde).
                  </p>
                </div>

                {/* Electrolytes */}
                <div className="p-4 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200/80 dark:border-purple-900/50">
                  <div className="flex items-center gap-2 mb-2 text-purple-700 dark:text-purple-300 font-bold">
                    <Zap className="w-5 h-5 text-purple-600" />
                    <h4>Elektrolyte & Salze</h4>
                  </div>
                  <div className="text-2xl font-black text-purple-900 dark:text-purple-100">
                    ~{analysis.sodiumRecommendedMg} <span className="text-sm font-normal">mg Natrium</span>
                  </div>
                  <p className="text-xs text-purple-700/80 dark:text-purple-300/80 mt-2 leading-relaxed">
                    Verhindert Krämpfe und Hyponatriämie. Bei schweißtreibenden Anstiegen Salztabletten oder
                    isotonisches Getränk nutzen.
                  </p>
                </div>
              </div>

              {/* Nutrition Timing Timeline */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-3">
                  Verpflegungs-Zeitplan für die Aktivität
                </h4>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center font-black text-xs shrink-0">
                      T-30
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">Pre-Start (30 min vorher)</div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        300–400 ml Wasser mit Elektrolyten trinken. Leicht verdaulicher Snack (z.B. Banane oder Reiswaffel).
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-600 flex items-center justify-center font-black text-xs shrink-0">
                      1h+
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">Im Rhythmus während der Belastung</div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Alle 20 min trinken. Ab Kilometer {Math.round(analysis.totalDistanceKm * 0.3)} vor den schweren
                        Anstiegen gezielt 30–40g schnelle Kohlenhydrate zuführen.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-950 text-purple-600 flex items-center justify-center font-black text-xs shrink-0">
                      Post
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">Regeneration (innerhalb 45 min)</div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        25–30g Protein zur Muskelreparatur + 1g Kohlenhydrate/kg Körpergewicht zum Wiederauffüllen der
                        Speicher.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'splits' && (() => {
            const isRunningMode = activityType === 'running';
            const fullSplits = realSplits.filter(s => s.distanceKm >= splitIntervalKm * 0.65);
            const poolForBest = fullSplits.length > 0 ? fullSplits : realSplits;
            const fastestSplit = poolForBest.length > 0
              ? poolForBest.reduce((best, s) => (s.avgSpeedKmh > best.avgSpeedKmh ? s : best), poolForBest[0])
              : null;
            const steepestClimbSplit = realSplits.length > 0
              ? realSplits.reduce((steep, s) => (s.ascentMeters > steep.ascentMeters ? s : steep), realSplits[0])
              : null;
            const maxSpeedInSplits = realSplits.length > 0
              ? Math.max(...realSplits.map(s => s.avgSpeedKmh), 1)
              : 1;
            const hasAnyHr = realSplits.some(s => s.avgHr !== undefined && s.avgHr > 0);
            const hasAnyPower = realSplits.some(s => s.avgPower !== undefined && s.avgPower > 0);
            const hasRealTiming = realSplits.some(s => s.isRealTiming);

            return (
              <div className="space-y-4">
                {/* Header & Interval Switcher */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100">
                        Kilometer-Splits & Intervall-Analyse ({isRunningMode ? 'Lauf-Pace & km/h' : 'Radsport km/h & Pace'})
                      </h4>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        hasRealTiming
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-800'
                          : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300 border border-indigo-300/60 dark:border-indigo-800'
                      }`}>
                        {hasRealTiming ? 'Echte GPS/FIT-Zeitstempel' : 'Physik-Pacing-Prognose'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Klicke auf „Auf Karte", um den jeweiligen Kilometerabschnitt direkt im Karten- und Höhenprofil-Fokus zu markieren.
                    </p>
                  </div>

                  {/* 1 km | 5 km | 10 km Switcher */}
                  <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-700 self-start sm:self-auto shrink-0">
                    {([1, 5, 10] as const).map((kmVal) => (
                      <button
                        key={kmVal}
                        type="button"
                        onClick={() => {
                          triggerHaptic('light');
                          setSplitIntervalKm(kmVal);
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-black font-mono tabular-nums transition-all cursor-pointer ${
                          splitIntervalKm === kmVal
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {kmVal} km
                      </button>
                    ))}
                  </div>
                </div>

                {/* Split KPI Summary Strip */}
                {realSplits.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono tabular-nums">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                      <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-slate-400 block">
                        Schnellster Split
                      </span>
                      <div className="text-sm font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                        {fastestSplit
                          ? isRunningMode
                            ? `${fastestSplit.paceFormatted} /km (${fastestSplit.avgSpeedKmh} km/h)`
                            : `${fastestSplit.avgSpeedKmh} km/h (${fastestSplit.paceFormatted} /km)`
                          : '-'}
                      </div>
                      <span className="text-[10px] font-sans text-slate-500">
                        {fastestSplit ? `Abschnitt #${fastestSplit.splitIndex} (km ${fastestSplit.startKm}–${fastestSplit.endKm})` : ''}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                      <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-slate-400 block">
                        Ø Strecken-Tempo / Pace
                      </span>
                      <div className="text-sm font-black text-indigo-600 dark:text-indigo-400 mt-0.5">
                        {isRunningMode
                          ? `${ computeRealTrackSplits({ ...track, activityType }, Math.max(10, splitIntervalKm) as 10, analysis.estimatedAverageSpeedKmh)[0]?.paceFormatted || '-:--' } /km`
                          : `${analysis.estimatedAverageSpeedKmh} km/h`}
                      </div>
                      <span className="text-[10px] font-sans text-slate-500">
                        {isRunningMode ? `Ø ${analysis.estimatedAverageSpeedKmh} km/h` : `${realSplits.length} Intervalle à ${splitIntervalKm} km`}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                      <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-slate-400 block">
                        Härtestes Berg-Intervall
                      </span>
                      <div className="text-sm font-black text-amber-600 dark:text-amber-400 mt-0.5">
                        {steepestClimbSplit ? `+${steepestClimbSplit.ascentMeters} Hm (${steepestClimbSplit.avgGradePercent}%)` : '-'}
                      </div>
                      <span className="text-[10px] font-sans text-slate-500">
                        {steepestClimbSplit ? `km ${steepestClimbSplit.startKm}–${steepestClimbSplit.endKm}` : ''}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                      <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-slate-400 block">
                        Intervalle Gesamt
                      </span>
                      <div className="text-sm font-black text-slate-800 dark:text-slate-100 mt-0.5">
                        {realSplits.length} Splits
                      </div>
                      <span className="text-[10px] font-sans text-slate-500">
                        Gesamtzeit {formatSecondsToTime(realSplits[realSplits.length - 1]?.cumulativeSeconds || 0)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Splits Table */}
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                  <table className="w-full text-left text-xs font-mono tabular-nums">
                    <thead className="bg-slate-100 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 font-sans font-bold border-b border-slate-200 dark:border-slate-800 text-[11px]">
                      <tr>
                        <th className="p-2.5"># / km</th>
                        <th className="p-2.5">{isRunningMode ? 'Pace & Tempo' : 'Tempo & Pace'}</th>
                        <th className="p-2.5 w-36 hidden md:table-cell">Intensitäts-Profil</th>
                        <th className="p-2.5">±Hm / Ø %</th>
                        {hasAnyHr && <th className="p-2.5">Ø Puls</th>}
                        {hasAnyPower && <th className="p-2.5">Ø Watt</th>}
                        <th className="p-2.5">Dauer</th>
                        <th className="p-2.5">Kumuliert</th>
                        <th className="p-2.5 text-right">Karten-Fokus</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                      {realSplits.map((split) => {
                        const isFastest = fastestSplit && fastestSplit.splitIndex === split.splitIndex;
                        const pctBar = Math.min(100, Math.max(12, Math.round((split.avgSpeedKmh / maxSpeedInSplits) * 100)));

                        return (
                          <tr
                            key={split.splitIndex}
                            className={`transition-colors text-slate-800 dark:text-slate-200 ${
                              isFastest
                                ? 'bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/35'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <td className="p-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-black text-indigo-600 dark:text-indigo-400">
                                  #{split.splitIndex}
                                </span>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {split.startKm.toFixed(1)}–{split.endKm.toFixed(1)} km
                                </span>
                                {isFastest && (
                                  <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-sans text-[9px] font-black uppercase">
                                    Best
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="p-2.5">
                              {isRunningMode ? (
                                <div>
                                  <span className="font-black text-slate-900 dark:text-white">
                                    {split.paceFormatted} /km
                                  </span>
                                  <span className="text-[10px] text-slate-400 block">
                                    {split.avgSpeedKmh.toFixed(1)} km/h
                                  </span>
                                </div>
                              ) : (
                                <div>
                                  <span className="font-black text-slate-900 dark:text-white">
                                    {split.avgSpeedKmh.toFixed(1)} km/h
                                  </span>
                                  <span className="text-[10px] text-slate-400 block">
                                    {split.paceFormatted} min/km
                                  </span>
                                </div>
                              )}
                            </td>

                            <td className="p-2.5 hidden md:table-cell">
                              <div className="w-full bg-slate-200/70 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    isFastest
                                      ? 'bg-emerald-500'
                                      : split.avgGradePercent > 4
                                      ? 'bg-amber-500'
                                      : 'bg-indigo-500'
                                  }`}
                                  style={{ width: `${pctBar}%` }}
                                />
                              </div>
                              <span className="font-sans text-[9px] text-slate-400 block mt-0.5">
                                {split.terrainType}
                              </span>
                            </td>

                            <td className="p-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                  +{split.ascentMeters}m
                                </span>
                                <span className="text-rose-500 dark:text-rose-400 text-[10px]">
                                  -{split.descentMeters}m
                                </span>
                              </div>
                              <span className={`text-[10px] font-bold ${
                                split.avgGradePercent > 4
                                  ? 'text-rose-500'
                                  : split.avgGradePercent > 1
                                  ? 'text-amber-500'
                                  : 'text-slate-400'
                              }`}>
                                Ø {split.avgGradePercent >= 0 ? '+' : ''}{split.avgGradePercent}%
                                {split.vam ? ` · ${split.vam} Hm/h` : ''}
                              </span>
                            </td>

                            {hasAnyHr && (
                              <td className="p-2.5">
                                {split.avgHr ? (
                                  <span className="text-rose-600 dark:text-rose-400 font-bold">
                                    {split.avgHr} <span className="text-[10px] font-normal">bpm</span>
                                  </span>
                                ) : (
                                  <span className="text-slate-400">-</span>
                                )}
                              </td>
                            )}

                            {hasAnyPower && (
                              <td className="p-2.5">
                                {split.avgPower ? (
                                  <span className="text-amber-600 dark:text-amber-400 font-bold">
                                    {split.avgPower} <span className="text-[10px] font-normal">W</span>
                                  </span>
                                ) : (
                                  <span className="text-slate-400">-</span>
                                )}
                              </td>
                            )}

                            <td className="p-2.5 font-semibold">
                              {formatSecondsToDigital(split.durationSeconds)}
                            </td>

                            <td className="p-2.5 font-black text-slate-900 dark:text-white">
                              {formatSecondsToTime(split.cumulativeSeconds)}
                            </td>

                            <td className="p-2.5 text-right font-sans">
                              <button
                                type="button"
                                onClick={() => {
                                  triggerHaptic('light');
                                  if (onSelection) {
                                    onSelection(split.bounds);
                                  }
                                  onClose();
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/70 transition-colors cursor-pointer"
                                title={`Kilometer-Abschnitt km ${split.startKm}–${split.endKm} auf Karte & im Höhenprofil markieren`}
                              >
                                <Crosshair className="w-3 h-3" />
                                <span>Fokus</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {activeTab === 'tactics' && (
            <div className="space-y-4">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Taktische Routen-Tipps & Sicherheitshinweise
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {analysis.tacticalTips.map((tip, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-xl border ${
                      tip.urgency === 'critical'
                        ? 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40'
                        : tip.urgency === 'warning'
                        ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40'
                        : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      {tip.urgency === 'critical' ? (
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      ) : tip.urgency === 'warning' ? (
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      ) : (
                        <Info className="w-4 h-4 text-indigo-600 shrink-0" />
                      )}
                      <h5 className="text-xs font-bold text-slate-900 dark:text-white">{tip.title}</h5>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{tip.description}</p>
                  </div>
                ))}
              </div>

              {analysis.cautionZones.length > 0 && (
                <div className="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-bold text-xs mb-2">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Aufmerksamkeits- & Gefahrenzonen</span>
                  </div>
                  {analysis.cautionZones.map((cz, i) => (
                    <div key={i} className="text-xs text-slate-700 dark:text-slate-300">
                      <strong>km {cz.kmStart} – {cz.kmEnd}:</strong> {cz.reason} — <em>{cz.advice}</em>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'pauses' && (
            <div className="space-y-5">
              {/* Top Banner & Pro Tools */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-500" />
                    Automatische Standzeit- & Netto-Zeit-Erkennung
                  </h4>
                  <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                    Erkennt GPS-Aufzeichnungslücken und Standphasen unter 1.6 km/h. Vergleicht Brutto-Gesamtzeit mit echter Netto-Bewegungszeit.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {onSanitizeTrack && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('medium');
                        onSanitizeTrack(track.id);
                      }}
                      className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer active:scale-95"
                      title="1-Click Track-Sanitizer (GPS-Ausreißer & Glättung)"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Track bereinigen</span>
                    </button>
                  )}
                  {onReverseTrack && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('medium');
                        onReverseTrack(track.id);
                      }}
                      className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                      title="Streckenrichtung umkehren"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-violet-500" />
                      <span>Route umkehren</span>
                    </button>
                  )}
                </div>
              </div>

              {/* KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Netto-Bewegung</div>
                  <div className="text-lg font-black text-slate-900 dark:text-slate-100 font-mono mt-1">
                    {formatSecondsToTime(pauseAnalysis.netMovingSeconds || analysis.estimatedMovingTimeSeconds)}
                  </div>
                  <div className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">Reine Fahrzeit</div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Brutto-Gesamtzeit</div>
                  <div className="text-lg font-black text-slate-900 dark:text-slate-100 font-mono mt-1">
                    {formatSecondsToTime(pauseAnalysis.grossElapsedSeconds || analysis.estimatedElapsedTimeSeconds)}
                  </div>
                  <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 mt-0.5">Inkl. aller Pausen</div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Stand- & Pausenzeit</div>
                  <div className="text-lg font-black text-amber-600 dark:text-amber-400 font-mono mt-1">
                    {formatSecondsToTime(pauseAnalysis.totalPauseSeconds)}
                  </div>
                  <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 mt-0.5">{pauseAnalysis.pauses.length} Stopps erkannt</div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Bewegungsanteil</div>
                  <div className="text-lg font-black text-slate-900 dark:text-slate-100 font-mono mt-1">
                    {pauseAnalysis.movingRatioPercent.toFixed(1)}%
                  </div>
                  <div className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 mt-0.5">Fahreffizienz</div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Ø Netto-Tempo</div>
                  <div className="text-lg font-black text-slate-900 dark:text-slate-100 font-mono mt-1">
                    {pauseAnalysis.averageMovingSpeedKmh > 0 ? pauseAnalysis.averageMovingSpeedKmh.toFixed(1) : analysis.estimatedAverageSpeedKmh.toFixed(1)} <span className="text-xs font-normal">km/h</span>
                  </div>
                  <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 mt-0.5">In Bewegung</div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Ø Brutto-Tempo</div>
                  <div className="text-lg font-black text-slate-900 dark:text-slate-100 font-mono mt-1">
                    {pauseAnalysis.averageGrossSpeedKmh > 0 ? pauseAnalysis.averageGrossSpeedKmh.toFixed(1) : (analysis.totalDistanceKm / (analysis.estimatedElapsedTimeSeconds / 3600)).toFixed(1)} <span className="text-xs font-normal">km/h</span>
                  </div>
                  <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 mt-0.5">Über Gesamtzeit</div>
                </div>
              </div>

              {/* Pause List Table */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3">
                <h5 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center justify-between">
                  <span>Erkannte Stopps & Stillstände ({pauseAnalysis.pauses.length})</span>
                  <span className="text-[11px] font-normal text-slate-600 dark:text-slate-400">Klick auf Zeile zoomt zum Stopp auf der Karte</span>
                </h5>

                {pauseAnalysis.pauses.length === 0 ? (
                  <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-xs">
                    <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                    Keine signifikanten Standpausen oder Zeitlücken in diesem Track festgestellt.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 uppercase font-black text-[10px] border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Typ</th>
                          <th className="py-2.5 px-3">Kilometer</th>
                          <th className="py-2.5 px-3">Dauer</th>
                          <th className="py-2.5 px-3">Höhe</th>
                          <th className="py-2.5 px-3 text-right">Aktion</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200 font-medium font-sans">
                        {pauseAnalysis.pauses.map((p, idx) => (
                          <tr 
                            key={p.id}
                            onClick={() => {
                              triggerHaptic('light');
                              onSelectTrackPoint?.(p.lat, p.lng);
                            }}
                            className="hover:bg-indigo-50/60 dark:hover:bg-indigo-950/40 cursor-pointer transition-colors"
                          >
                            <td className="py-2.5 px-3 font-bold font-mono">#{idx + 1}</td>
                            <td className="py-2.5 px-3">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                p.type === 'stopped'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                  : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                              }`}>
                                {p.type === 'stopped' ? 'Standpause / Ampel' : 'Aufzeichnungslücke'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                              km {p.startKm.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-amber-600 dark:text-amber-400">
                              {formatSecondsToTime(p.durationSeconds)}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                              {Math.round(p.elevationM)} m
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  triggerHaptic('medium');
                                  onSelectTrackPoint?.(p.lat, p.lng);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-[10px] font-bold transition-all inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Crosshair className="w-3 h-3" />
                                <span>Auf Karte</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'pois' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Wichtige Streckenpunkte & Verpflegungsstationen
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Füge empfohlene Schlüsselpunkte mit einem Klick zu deinen Kartenmarkern hinzu.
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                {analysis.poiRecommendations.map((poi, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                        <MapPin className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">{poi.title}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            km {poi.kmLocation}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{poi.description}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {onSelectTrackPoint && (
                        <button
                          onClick={() => onSelectTrackPoint(poi.lat, poi.lng)}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                        >
                          Auf Karte zeigen
                        </button>
                      )}

                      {onAddTextMarker && (
                        <button
                          onClick={() => handleAddPoiToMap(poi, idx)}
                          disabled={addedPois[idx]}
                          className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            addedPois[idx]
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
                          }`}
                        >
                          {addedPois[idx] ? (
                            <>
                              <CheckCircle className="w-3.5 h-3.5" />
                              <span>Hinzugefügt</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5" />
                              <span>Als Marker</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'power' && (
            <PowerPhysicsTab
              track={track}
              activityType={activityType}
              initialWeight={customWeight}
              initialFtp={customFtp}
              onOpenGlossary={onOpenGlossary}
            />
          )}

          {activeTab === 'zones' && (
            <ZonesTab
              track={track}
              activityType={activityType}
              initialMaxHr={userMaxHr}
              initialFtp={customFtp}
              initialWeight={customWeight}
              onOpenGlossary={onOpenGlossary}
            />
          )}

          {activeTab === 'rawdata' && (
            <RawDataTab
              track={track}
              onSelectPoint={onSelectTrackPoint}
            />
          )}

          {activeTab === 'report' && (
            <PrintReportTab
              track={track}
              analysis={analysis}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1.5 font-medium">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            <span>
              {activityType === 'running'
                ? 'Laufmodell basiert auf biomechanischer Gravitations- & Leistungskurve'
                : 'Streckenmodell basiert auf physikalischer Gravitations- & Leistungskurve'}
            </span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 min-h-[44px] min-w-[90px] flex items-center justify-center rounded-xl font-bold bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors cursor-pointer shrink-0"
          >
            Schließen
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
