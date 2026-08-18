import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Printer, Share2, Clipboard, Heart, Activity, Zap,
  Layers, Trophy, Calendar, Clock, Bike, AlertTriangle, Sparkles,
  Navigation, CheckCircle, RefreshCw, Droplets, Flame, ShieldAlert,
  MapPin, Plus, Sliders, Info, ArrowUpRight, Gauge, ChevronRight,
  TrendingUp, Mountain, Compass, Crosshair, BookOpen
} from 'lucide-react';
import { GPXTrack, TextMarker, MapLayer } from '../types';
import {
  performLocalIntensiveAnalysis,
  formatSecondsToTime,
  formatSecondsToDigital,
  IntensiveAnalysisResult,
  IntensiveAnalysisOptions,
  IntensiveClimb,
  getClimbHexColor
} from '../utils/intensiveAnalysis';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceArea, ReferenceLine } from 'recharts';
import { calculateDistance } from '../utils/gpxUtils';
import { triggerHaptic } from '../utils/haptics';

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
          <span className="font-black text-indigo-400">{point.ele} m ü.NN</span>
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
                <span className="font-black text-emerald-400">+{climb.ascentMeters} Hm</span>
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
              Min: {minElevation}m • Max: {maxElevation}m {climbs.length > 0 ? `• ${climbs.length} Bergwertungen farbig markiert` : ''}
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
                  +{climb.ascentMeters}m
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

interface IntensiveTrackAnalysisModalProps {
  track: GPXTrack;
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
}

export const IntensiveTrackAnalysisModal: React.FC<IntensiveTrackAnalysisModalProps> = ({
  track,
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
  onOpenGlossary
}) => {
  // Activity Configuration State
  const [activityType, setActivityType] = useState<'cycling' | 'running'>(
    track.activityType === 'running' ? 'running' : 'cycling'
  );
  const [subType, setSubType] = useState<'road' | 'gravel' | 'mtb' | 'trail'>(
    track.activityType === 'running' ? 'trail' : 'road'
  );
  const [fitnessLevel, setFitnessLevel] = useState<'beginner' | 'moderate' | 'advanced' | 'elite'>('moderate');
  const [customFtp, setCustomFtp] = useState<number>(ftp || 220);
  const [customWeight, setCustomWeight] = useState<number>(userWeight || 75);
  const [customTemp, setCustomTemp] = useState<number>(20);
  const [activeTab, setActiveTab] = useState<'overview' | 'climbs' | 'nutrition' | 'splits' | 'tactics' | 'pois'>('overview');
  const [copied, setCopied] = useState(false);
  const [addedPois, setAddedPois] = useState<Record<string, boolean>>({});
  const [highlightedClimbIndex, setHighlightedClimbIndex] = useState<number | null>(null);
  const [showClimbHighlights, setShowClimbHighlights] = useState<boolean>(true);

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
      ? `\n⛰️ Bergwertungen (${analysis.climbs.length}): ${analysis.totalClimbAscentMeters} Hm in Anstiegen (${analysis.totalClimbDistanceKm} km)`
      : '';
    const text = `📊 INTENSIVE STRECKENANALYSE: ${analysis.trackName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📏 Distanz: ${analysis.totalDistanceKm} km | ⛰️ Höhenmeter: +${analysis.totalAscentMeters}m / -${analysis.totalDescentMeters}m${climbsSummary}
⏱️ Geschätzte Fahr-/Laufzeit: ${formatSecondsToTime(analysis.estimatedMovingTimeSeconds)} (Brutto: ${formatSecondsToTime(analysis.estimatedElapsedTimeSeconds)})
🚀 Ø-Geschwindigkeit: ${analysis.estimatedAverageSpeedKmh} km/h
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
      label: `Start Anstieg #${climb.index + 1} (${climb.startElevationM}m, km ${climb.startKm})`,
      color: '#3b82f6'
    });
    // Peak marker
    onAddTextMarker({
      lat: climb.peakPoint.lat,
      lng: climb.peakPoint.lng,
      label: `Gipfel #${climb.index + 1} (${climb.categoryLabel}: +${climb.ascentMeters}m @ ${climb.avgGradePercent}%)`,
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
      className="fixed inset-0 z-[2000] flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 15 }}
        className="bg-white dark:bg-slate-900 w-full max-w-5xl max-h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800"
        id="intensive-analysis-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-indigo-50/50 via-white to-purple-50/50 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-200 dark:shadow-none">
              <Sparkles className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  Intensive Streckenanalyse
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300">
                  Physics & Nutrition Pro
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                {analysis.trackName} • {analysis.totalDistanceKm} km • +{analysis.totalAscentMeters} Hm
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenGlossary && (
              <button
                onClick={() => onOpenGlossary()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 transition-colors cursor-pointer"
                title="Wissenschaftliches Sport-Metriken Glossar & Rechner öffnen"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Sport-Glossar</span>
              </button>
            )}

            <button
              onClick={handleCopySummary}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              title="Zusammenfassung kopieren"
            >
              {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <Clipboard className="w-3.5 h-3.5" />}
              <span>{copied ? 'Kopiert!' : 'Kopieren'}</span>
            </button>

            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              title="Drucken / PDF"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Drucken</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Dynamic Parameter Ribbon */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
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

            <div className="flex items-center gap-1.5" title="Fahrergewicht">
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
        <div className="flex items-center px-5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'overview'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Gauge className="w-4 h-4" />
            <span>Fahrzeit & Physis</span>
          </button>

          <button
            onClick={() => {
              triggerHaptic();
              setActiveTab('climbs');
            }}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'climbs'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <span>Anstiege & Bergwertungen</span>
            {analysis.climbs.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                {analysis.climbs.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('nutrition')}
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
            onClick={() => setActiveTab('splits')}
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
            onClick={() => setActiveTab('tactics')}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'tactics'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ShieldAlert className="w-4 h-4 text-emerald-500" />
            <span>Taktik & Sicherheit</span>
          </button>

          <button
            onClick={() => setActiveTab('pois')}
            className={`py-3 px-3 border-b-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'pois'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <MapPin className="w-4 h-4 text-purple-500" />
            <span>POIs & Wegpunkte</span>
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
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Reine Fahrzeit (Netto)</span>
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
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Ø-Geschwindigkeit</span>
                    <Activity className="w-4 h-4 text-blue-500" />
                  </div>
                  <div className="text-xl font-black text-slate-900 dark:text-white">
                    {analysis.estimatedAverageSpeedKmh} <span className="text-xs font-normal text-slate-400">km/h</span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Pace: {(60 / analysis.estimatedAverageSpeedKmh).toFixed(2)} min/km
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
                          ? `${analysis.climbs.length} kategorisierte ${analysis.climbs.length === 1 ? 'Bergwertung' : 'Bergwertungen'} erkannt (+${analysis.totalClimbAscentMeters} Hm in Anstiegen)`
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
                          <span>{climb.distanceKm} km • +{climb.ascentMeters} Hm</span>
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
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Abfahrt (&lt; -2.5%)</span>
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
                    Kategorisierte Anstiege & Bergwertungen
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Detaillierte Analyse aller signifikanten Steigungsabschnitte mit Steigleistung (VAM), Zeit- & Wattprognosen.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                    {analysis.climbs.length} {analysis.climbs.length === 1 ? 'Anstieg' : 'Anstiege'} erkannt
                  </span>
                </div>
              </div>

              {/* KPI Ribbon */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Bergwertungen</span>
                  <div className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                    {analysis.climbs.length}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Hm in Anstiegen</span>
                  <div className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                    +{analysis.totalClimbAscentMeters} m
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
                            +{climb.ascentMeters} m
                          </span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                          <span className="text-[10px] text-slate-400 block mb-0.5">Start → Gipfel</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {climb.startElevationM}m → {climb.endElevationM}m
                          </span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                          <span className="text-[10px] text-slate-400 block mb-0.5">Ø / Max Steigung</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {climb.avgGradePercent}% / <span className="text-rose-500 font-black">{climb.maxGradePercent}%</span>
                          </span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                          <span className="text-[10px] text-slate-400 block mb-0.5">Prognose Fahrzeit</span>
                          <span className="font-black text-indigo-600 dark:text-indigo-400 text-sm">
                            {formatSecondsToTime(climb.estimatedTimeSeconds)}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                          <span className="text-[10px] text-slate-400 block mb-0.5">
                            {analysis.activityType === 'cycling' ? 'Zielleistung' : 'Pace'}
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

          {activeTab === 'splits' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Etappen-Splits & Zwischenzeiten
                </h4>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Berechnet auf Basis des Geländeprofils
                </span>
              </div>

              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="p-3">Kilometer</th>
                      <th className="p-3">Abschnitt</th>
                      <th className="p-3">Höhenmeter</th>
                      <th className="p-3">Ø Steigung</th>
                      <th className="p-3">Charakter</th>
                      <th className="p-3">Abschnittszeit</th>
                      <th className="p-3 text-right">Gesamtzeit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                    {analysis.splits.map((split, i) => (
                      <tr
                        key={i}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors text-slate-800 dark:text-slate-200"
                      >
                        <td className="p-3 font-bold text-indigo-600 dark:text-indigo-400">km {split.kmMarker}</td>
                        <td className="p-3">+{split.splitDistanceKm} km</td>
                        <td className="p-3">+{split.splitAscentMeters} m</td>
                        <td className="p-3">{split.splitAvgGradePercent}%</td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              split.splitAvgGradePercent > 5
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                : split.splitAvgGradePercent > 1
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {split.terrainType}
                          </span>
                        </td>
                        <td className="p-3 font-semibold">{formatSecondsToDigital(split.estimatedSplitTimeSeconds)}</td>
                        <td className="p-3 text-right font-black text-slate-900 dark:text-white">
                          {formatSecondsToTime(split.cumulativeTimeSeconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1.5 font-medium">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            <span>Streckenmodell basiert auf physikalischer Gravitations- & Leistungskurve</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl font-bold bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
          >
            Schließen
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
