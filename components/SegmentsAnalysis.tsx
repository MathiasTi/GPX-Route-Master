import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Trophy, Medal, Clock, Zap, MapPin, Compass, Trash2, Milestone, ChevronRight, Share2, Flame, AlertCircle, Sliders, Dumbbell, Bike, Sparkles, SlidersHorizontal, Info, ArrowRight } from 'lucide-react';
import { GPXTrack, MapLayer, Segment, LeaderboardEntry } from '../types';
import { calculateEffortForSegment } from '../utils/segmentUtils';
import { ClimbMiniMap } from './ClimbMiniMap';

interface SegmentsAnalysisProps {
  tracks: GPXTrack[];
  activeTrack: GPXTrack | undefined;
  onClose: () => void;
  activeLayer: MapLayer;
  segments: Segment[];
  onDeleteSegment?: (id: string) => void;
  userWeight?: number;
  estimatedSpeed?: number;
  ftp?: number;
}

export const SegmentsAnalysis: React.FC<SegmentsAnalysisProps> = ({
  tracks,
  activeTrack,
  onClose,
  activeLayer,
  segments,
  onDeleteSegment,
  userWeight = 75,
  estimatedSpeed = 15,
  ftp = 250
}) => {
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);

  // Tab control
  const [activePanelTab, setActivePanelTab] = useState<'leaderboard' | 'pacing'>('leaderboard');

  // Pacing Parameter State hook
  const [pacingPower, setPacingPower] = useState<number>(() => {
    if (activeTrack && activeTrack.powerStats && activeTrack.powerStats.avgPower) {
      return activeTrack.powerStats.avgPower;
    }
    return 220;
  });
  const [pacingStrategy, setPacingStrategy] = useState<string>('custom');
  const [pacingAthleteWeight, setPacingAthleteWeight] = useState<number>(userWeight);
  const [pacingBikeWeight, setPacingBikeWeight] = useState<number>(8.5);
  const [pacingCdA, setPacingCdA] = useState<number>(0.32); // Hoods (Bremsgriffe)
  const [pacingCrr, setPacingCrr] = useState<number>(0.0040); // Road (Rennrad Slick)

  // Track state changes to reset defaults
  useEffect(() => {
    if (activeTrack && activeTrack.powerStats && activeTrack.powerStats.avgPower) {
      setPacingPower(activeTrack.powerStats.avgPower);
    } else {
      setPacingPower(220);
    }
    setPacingStrategy('custom');
  }, [activeTrack]);

  useEffect(() => {
    setPacingAthleteWeight(userWeight);
  }, [userWeight]);

  // Helper inside component to format times
  const formatTime = (totalSeconds: number): string => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} h`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')} min`;
  };

  // Process all segments: find efforts matching the user's active track (and optionally other loaded tracks)
  const segmentsWithEfforts = useMemo(() => {
    return segments.map(seg => {
      // 1. Calculate matching effort for active track
      const activeEffort = activeTrack 
        ? calculateEffortForSegment(activeTrack, seg, userWeight, estimatedSpeed) 
        : null;

      // 2. Also calculate efforts for ANY other loaded tracks to allow multi-file leaderboards!
      const otherEfforts: LeaderboardEntry[] = [];
      tracks.forEach(track => {
        if (activeTrack && track.id === activeTrack.id) return; // skip active
        const effort = calculateEffortForSegment(track, seg, userWeight, estimatedSpeed);
        if (effort) {
          otherEfforts.push(effort);
        }
      });

      // 3. Assemble complete leaderboard, combining default preset pros/amateurs + user matching efforts
      let fullLeaderboard = [...seg.leaderboard];
      
      // Inject user efforts
      if (activeEffort) {
        fullLeaderboard.push(activeEffort);
      }
      otherEfforts.forEach(eff => {
        fullLeaderboard.push(eff);
      });

      // Sort full leaderboard by shortest time (ascending order)
      fullLeaderboard.sort((a, b) => a.timeInSeconds - b.timeInSeconds);

      // Re-assign ranks
      fullLeaderboard = fullLeaderboard.map((item, idx) => ({
        ...item,
        rank: idx + 1
      }));

      // Find best user effort (PR)
      const prEffort = fullLeaderboard.find(item => item.isUser);

      // Extract points matching segment from activeTrack for map rendering
      let segmentPoints = [{ lat: seg.startLat, lng: seg.startLng }, { lat: seg.endLat, lng: seg.endLng }];
      let matchesActive = false;

      if (activeTrack) {
        let closestStartIdx = -1;
        let closestStartDist = Infinity;
        let closestEndIdx = -1;
        let closestEndDist = Infinity;

        activeTrack.points.forEach((pt, i) => {
          const dl1 = Math.abs(pt.lat - seg.startLat) + Math.abs(pt.lng - seg.startLng);
          if (dl1 < closestStartDist) {
            closestStartDist = dl1;
            closestStartIdx = i;
          }
          const dl2 = Math.abs(pt.lat - seg.endLat) + Math.abs(pt.lng - seg.endLng);
          if (dl2 < closestEndDist) {
            closestEndDist = dl2;
            closestEndIdx = i;
          }
        });

        // If matched on active route, draw accurate flowing trail
        if (closestStartIdx !== -1 && closestEndIdx !== -1 && closestStartIdx < closestEndIdx && closestStartDist < 0.003 && closestEndDist < 0.003) {
          segmentPoints = activeTrack.points.slice(closestStartIdx, closestEndIdx + 1);
          matchesActive = true;
        }
      }

      return {
        ...seg,
        leaderboard: fullLeaderboard,
        userEffort: activeEffort,
        personalRecord: prEffort,
        segmentPoints,
        matchesActive
      };
    });
  }, [segments, tracks, activeTrack, userWeight, estimatedSpeed]);

  // Set default selected segment on load
  const processedSelectedSegment = useMemo(() => {
    if (!selectedSegmentId && segmentsWithEfforts.length > 0) {
      return segmentsWithEfforts[0];
    }
    return segmentsWithEfforts.find(s => s.id === selectedSegmentId) || segmentsWithEfforts[0];
  }, [segmentsWithEfforts, selectedSegmentId]);

  // ------------------ PACING DISPATCH & CALCULATIONS ------------------
  const pacingResults = useMemo(() => {
    if (!processedSelectedSegment) return null;
    
    const distance = processedSelectedSegment.distanceMeter; // in meters
    const ascent = processedSelectedSegment.ascentMeter; // in meters
    const gradient = processedSelectedSegment.avgGradient; // %
    const totalMass = pacingAthleteWeight + pacingBikeWeight;
    const g = 9.81;
    const rho = 1.2;
    
    // Physics binary search solver for wheel velocity (v in m/s)
    let low = 0.5;
    let high = 40.0; // max speed 144 km/h
    let v = 5.0;
    
    for (let iter = 0; iter < 45; iter++) {
      v = (low + high) / 2;
      const grade = distance > 0 ? (ascent / distance) : 0;
      
      const pGravity = totalMass * g * grade * v;
      const pRolling = pacingCrr * totalMass * g * v;
      const pAir = 0.5 * pacingCdA * rho * Math.pow(v, 3);
      
      // assuming 3% drivetrain energy losses (divide raw mechanics by 0.97 efficiency)
      const pNeeded = (pGravity + pRolling + pAir) / 0.97;
      
      if (pNeeded < pacingPower) {
        low = v;
      } else {
        high = v;
      }
    }
    
    const simSpeedMps = v;
    const simSpeedKmh = simSpeedMps * 3.6;
    const simTimeSec = distance > 0 ? (distance / simSpeedMps) : 0;
    
    // Physical breakdowns of mechanical forces
    const gradeRatio = distance > 0 ? (ascent / distance) : 0;
    const gravityWatts = Math.max(0, totalMass * g * gradeRatio * simSpeedMps);
    const rollingWatts = pacingCrr * totalMass * g * simSpeedMps;
    const airWatts = 0.5 * pacingCdA * rho * Math.pow(simSpeedMps, 3);
    const lossWatts = pacingPower * 0.03;
    
    const totalWattsSum = gravityWatts + rollingWatts + airWatts + lossWatts;
    const gravityPercent = Math.max(0, Math.round((gravityWatts / Math.max(1, totalWattsSum)) * 100));
    const airPercent = Math.max(0, Math.round((airWatts / Math.max(1, totalWattsSum)) * 105)); // stretch slightly for visual calibration
    const rollingPercent = Math.max(0, Math.round((rollingWatts / Math.max(1, totalWattsSum)) * 100));
    
    // ensure total sum is nicely bounded
    let lossPercent = 100 - (gravityPercent + airPercent + rollingPercent);
    if (lossPercent < 0) {
      lossPercent = 3;
    }
    const sumP = gravityPercent + airPercent + rollingPercent + lossPercent;
    const fGravity = Math.round((gravityPercent / sumP) * 100);
    const fAir = Math.round((airPercent / sumP) * 100);
    const fRolling = Math.round((rollingPercent / sumP) * 100);
    const fLoss = 100 - (fGravity + fAir + fRolling);
    
    // Estimate placement rank on the leaderboard
    const leaderboard = processedSelectedSegment.leaderboard || [];
    let simulatedRank = 1;
    let beatenOpponentName = "";
    
    // Sort leaderboard copy to ensure rank comparisons are matching ascending times
    const sortedLeaderboard = [...leaderboard].sort((a, b) => a.timeInSeconds - b.timeInSeconds);
    
    for (let i = 0; i < sortedLeaderboard.length; i++) {
      const entry = sortedLeaderboard[i];
      if (simTimeSec > entry.timeInSeconds) {
        simulatedRank = i + 2; // is below this entry
        if (i < sortedLeaderboard.length - 1) {
          beatenOpponentName = sortedLeaderboard[i + 1]?.athleteName || "";
        }
      } else if (i === 0) {
        // beats the fastest person!
        simulatedRank = 1;
        beatenOpponentName = sortedLeaderboard[0].athleteName;
      }
    }
    
    const intensityPercent = Math.round((pacingPower / ftp) * 100);
    
    let advice = "";
    if (gradient > 3.5) {
      const kgSavedWatts = (g * gradeRatio * simSpeedMps).toFixed(1);
      advice = `Uphill-Sektor (${gradient}% ⌀ Steigung): Die Schwerkraft dominiert mit ${fGravity}% deines Aufwands! Jedes Kilogramm weniger Körper- oder Radgewicht spart dir bei diesem Tempo ${kgSavedWatts} Watt Tretleistung ein.`;
    } else {
      advice = `Flach- oder Sprintschnitt Sektor (${gradient}% ⌀ Steigung): Der Luftwiderstand ist der Hauptbremsfaktor (${fAir}%). Jedes Bisschen optimierte Aerodynamik (Unterlenker-Haltung oder Windschattenfahren) schenkt dir ungemein viel freie Geschwindigkeit.`;
    }
    
    let glycogenTime = "3+ Stunden";
    let tierName = "Regenerativ (GA1)";
    if (intensityPercent < 75) {
      glycogenTime = "3 - 5 Std. (primär Fettverbrennung)";
      tierName = "Grundlagenausdauer (GA1)";
    } else if (intensityPercent < 90) {
      glycogenTime = "1.5 - 2.5 Std. (aerober Kohlenhydratabbau)";
      tierName = "Kraftausdauer-Bereich (GA2)";
    } else if (intensityPercent < 105) {
      glycogenTime = "45 - 60 Min. (anaerobe Schwelle)";
      tierName = "Entwicklungsbereich (Schwellen-Power)";
    } else {
      glycogenTime = "10 - 25 Min. (schnelle Laktatüberfrachtung)";
      tierName = "Spitzenbereich (VO2Max/Intervall)";
    }
    
    return {
      timeSec: simTimeSec,
      speedKmh: simSpeedKmh,
      gravityWatts,
      airWatts,
      rollingWatts,
      lossWatts,
      fGravity,
      fAir,
      fRolling,
      fLoss,
      rank: Math.min(sortedLeaderboard.length + 1, simulatedRank),
      intensityPercent,
      advice,
      glycogenTime,
      tierName,
      beatenOpponentName
    };
  }, [processedSelectedSegment, pacingPower, pacingAthleteWeight, pacingBikeWeight, pacingCdA, pacingCrr, ftp]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[2000] flex items-center justify-center p-4 md:p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 15 }}
        className="bg-white dark:bg-slate-900 w-full max-w-6xl h-[88vh] rounded-3xl overflow-hidden shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header bar */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-yellow-50 dark:bg-yellow-950/40 text-yellow-600 dark:text-yellow-400 rounded-2xl">
              <Trophy size={20} className="animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800 dark:text-slate-100 leading-snug">
                Segment-Analyse & Bestenlisten
              </h2>
              <p className="text-xs text-slate-400 font-bold leading-none mt-1">
                Vergleiche Deine Leistung auf Strava- und Garmin-ähnlichen Sektoren
              </p>
            </div>
          </div>
          
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-250 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Master-Detail view split */}
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT: Sideroad list of segments */}
          <div className="w-80 border-r border-slate-100 dark:border-slate-850 bg-slate-50/40 dark:bg-slate-950/20 overflow-y-auto p-4 shrink-0 flex flex-col gap-3">
            <h3 className="text-[10px] font-extrabold uppercase text-slate-400 dark:text-slate-500 tracking-widest px-2 flex items-center gap-1.5">
              <Milestone className="w-3.5 h-3.5" />
              Sektoren ({segmentsWithEfforts.length})
            </h3>

            {segmentsWithEfforts.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400 dark:text-slate-500">
                <Compass className="w-10 h-10 mb-2 stroke-1.5 animate-spin" />
                <p className="text-xs font-semibold">Keine Segmente</p>
                <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                  Lade einen GPX- oder FIT-Track hoch, um Segmente zu generieren, oder nutze die Kartenauswahl.
                </p>
              </div>
            ) : (
              <div className="space-y-2 flex-1 overflow-y-auto pr-1">
                {segmentsWithEfforts.map(seg => {
                  const isSelected = processedSelectedSegment?.id === seg.id;
                  
                  return (
                    <button
                      key={seg.id}
                      onClick={() => setSelectedSegmentId(seg.id)}
                      className={`w-full text-left p-3 rounded-2xl border transition-all flex flex-col gap-1.5 group cursor-pointer ${
                        isSelected 
                          ? 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 shadow-sm' 
                          : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 border-slate-100 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex justify-between items-start w-full gap-2">
                        <span className="font-bold text-xs text-slate-700 dark:text-slate-200 line-clamp-2 leading-snug group-hover:text-blue-600 dark:group-hover:text-blue-400">
                          {seg.name}
                        </span>
                        {seg.isCustom && (
                          <span className="text-[8px] font-black uppercase bg-violet-50 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded-full border border-violet-100 dark:border-violet-850">
                            Custom
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-mono text-slate-500 dark:text-slate-400 font-medium">
                        <span>{(seg.distanceMeter / 1000).toFixed(2)} km</span>
                        <span>•</span>
                        {seg.ascentMeter > 0 ? (
                          <>
                            <span className="text-emerald-600 font-bold">+{seg.ascentMeter}m</span>
                            <span>•</span>
                            <span className="text-amber-500 font-bold">{seg.avgGradient}%</span>
                          </>
                        ) : (
                          <span className="text-slate-400">Flach</span>
                        )}
                      </div>

                      <div className="flex items-center justify-between w-full mt-1 pt-1.5 border-t border-slate-100/50 dark:border-slate-800/50">
                        {seg.personalRecord ? (
                          <span className="text-[9px] font-bold text-blue-605 dark:text-blue-400 flex items-center gap-1">
                            <Flame className="w-3 h-3 text-orange-500 fill-orange-500 shrink-0" />
                            Deine Zeit: <span className="font-black">{formatTime(seg.personalRecord.timeInSeconds)}</span>
                          </span>
                        ) : (
                          <span className="text-[9px] text-slate-400 font-medium italic">
                            Nicht gefahren
                          </span>
                        )}
                        <ChevronRight className="w-3.5 h-3.5 text-slate-350 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            
            {onDeleteSegment && processedSelectedSegment?.isCustom && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Möchtest Du dieses selbsterstellte Segment wirklich löschen?')) {
                    onDeleteSegment(processedSelectedSegment.id);
                    setSelectedSegmentId(null);
                  }
                }}
                className="w-full mt-auto flex items-center justify-center gap-2 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-2xl text-xs font-bold transition-all border border-red-200/50 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Sektor löschen
              </button>
            )}
          </div>

          {/* RIGHT: Detail & Leaderboard */}
          <div className="flex-1 bg-white dark:bg-slate-900 overflow-y-auto flex flex-col">
            {processedSelectedSegment ? (
              <div className="p-6 flex-1 flex flex-col gap-6 min-h-0">
                {/* Segment detail grid card */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-slate-50/45 dark:bg-slate-950/20 p-5 rounded-3xl border border-slate-100 dark:border-slate-850 shrink-0">
                  {/* Left: Summary Data */}
                  <div className="lg:col-span-8 flex flex-col justify-between space-y-4">
                    <div>
                      <div className="flex items-center gap-2">
                        {processedSelectedSegment.ascentMeter >= 300 ? (
                          <span className="bg-red-500 text-white font-black text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider">Berg HC</span>
                        ) : processedSelectedSegment.ascentMeter > 0 ? (
                          <span className="bg-emerald-500 text-white font-black text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider">Hügel</span>
                        ) : (
                          <span className="bg-blue-500 text-white font-black text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider">Sprint</span>
                        )}
                        <h3 className="text-lg font-black text-slate-850 dark:text-slate-100 leading-tight">
                          {processedSelectedSegment.name}
                        </h3>
                      </div>
                      
                      <p className="text-xs text-slate-400 font-bold mt-2 leading-relaxed font-mono">
                        GPS Start: <span className="text-slate-600 dark:text-slate-300">{processedSelectedSegment.startLat.toFixed(5)}, {processedSelectedSegment.startLng.toFixed(5)}</span> ➔ Ziel: <span className="text-slate-600 dark:text-slate-300">{processedSelectedSegment.endLat.toFixed(5)}, {processedSelectedSegment.endLng.toFixed(5)}</span>
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-white dark:bg-slate-950 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Distanz</span>
                        <span className="text-base font-black text-slate-800 dark:text-slate-100 font-mono">
                          {(processedSelectedSegment.distanceMeter / 1000).toFixed(2)} km
                        </span>
                      </div>
                      
                      <div className="bg-white dark:bg-slate-950 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Höhenmeter</span>
                        <span className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono">
                          +{processedSelectedSegment.ascentMeter}m
                        </span>
                      </div>

                      <div className="bg-white dark:bg-slate-950 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">⌀ Steigung</span>
                        <span className="text-base font-black text-amber-500 font-mono">
                          {processedSelectedSegment.avgGradient}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Map Crop */}
                  <div className="lg:col-span-4 h-36 border border-slate-150 dark:border-slate-800 rounded-2xl overflow-hidden relative shadow-inner bg-slate-150/20">
                    <ClimbMiniMap 
                      points={processedSelectedSegment.segmentPoints}
                      color={processedSelectedSegment.matchesActive ? '#3b82f6' : '#94a3b8'} 
                      activeLayer={activeLayer}
                    />

                    <div className="absolute bottom-2 left-2 z-[990]">
                      <span className="bg-slate-900/85 backdrop-blur-md border border-white/10 text-white font-mono text-[8px] font-black px-1.5 py-0.5 rounded-lg shadow-md">
                        {processedSelectedSegment.matchesActive ? '📍 Folgt Deiner Route' : '🗺️ Sektorkarte'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Tab Switcher for Leaderboard vs Pacing-Planer */}
                <div className="flex border-b border-slate-100 dark:border-slate-800 gap-6 shrink-0 mt-2">
                  <button
                    onClick={() => setActivePanelTab('leaderboard')}
                    className={`pb-3 text-sm font-extrabold transition-all relative cursor-pointer flex items-center gap-2 ${
                      activePanelTab === 'leaderboard' 
                        ? 'text-indigo-600 dark:text-indigo-400 font-extrabold' 
                        : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <Trophy className="w-4 h-4" />
                    Bestenliste (Leaderboard)
                    {activePanelTab === 'leaderboard' && (
                      <motion.div layoutId="activeTabUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400 rounded-full" />
                    )}
                  </button>
                  <button
                    onClick={() => setActivePanelTab('pacing')}
                    className={`pb-3 text-sm font-extrabold transition-all relative cursor-pointer flex items-center gap-2 ${
                      activePanelTab === 'pacing' 
                        ? 'text-indigo-600 dark:text-indigo-400 font-extrabold' 
                        : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    <span>Segment Pacing-Planer</span>
                    <span className="text-[8px] bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-extrabold scale-90">Neu</span>
                    {activePanelTab === 'pacing' && (
                      <motion.div layoutId="activeTabUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400 rounded-full" />
                    )}
                  </button>
                </div>

                <AnimatePresence mode="wait">
                  {activePanelTab === 'leaderboard' ? (
                    <motion.div 
                      key="leaderboard"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="flex-1 flex flex-col gap-3 min-h-0 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl p-5 shadow-sm"
                    >
                      <div className="flex justify-between items-center shrink-0">
                        <h4 className="text-xs font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider flex items-center gap-1.5">
                          <Trophy className="w-4 h-4 text-yellow-500" />
                          Leaderboard (Bestenliste)
                        </h4>
                        <span className="text-[10px] font-medium text-slate-400">
                          Aktives Gewicht: <span className="text-indigo-600 font-bold">{userWeight} kg</span>
                        </span>
                      </div>

                      <div className="flex-1 overflow-y-auto w-full min-h-0">
                        <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                          <thead>
                            <tr className="border-b border-slate-100 dark:border-slate-805 text-slate-400 font-bold text-[10px] uppercase font-mono tracking-wider">
                              <th className="py-2.5 px-3">Platz</th>
                              <th className="py-2.5 px-3">Fahrer:in</th>
                              <th className="py-2.5 px-3">Sektor-Zeit</th>
                              <th className="py-2.5 px-3">⌀ Speed</th>
                              <th className="py-2.5 px-3">⌀ Leistung</th>
                              <th className="py-2.5 px-3">Relative Leistung</th>
                              <th className="py-2.5 px-3 text-right">Datum</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 dark:divide-slate-850">
                            {processedSelectedSegment.leaderboard.map((entry) => {
                              const isGold = entry.rank === 1;
                              const isSilver = entry.rank === 2;
                              const isBronze = entry.rank === 3;
                              
                              // Relative power W/kg calculation (assumes standard 70kg pro rider; or uses active weight for user)
                              const weight = entry.isUser ? userWeight : 70; 
                              const wattPerKg = entry.avgPower ? (entry.avgPower / weight).toFixed(1) : null;

                              return (
                                <tr
                                  key={entry.id}
                                  className={`group transition-all ${
                                    entry.isUser 
                                      ? 'bg-blue-50/60 dark:bg-blue-950/20 font-bold border-y border-blue-100 dark:border-blue-900/50' 
                                      : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/40'
                                  }`}
                                >
                                  <td className="py-3 px-3">
                                    <div className="flex items-center gap-1 font-mono font-black">
                                      {isGold && <span className="text-yellow-500 text-sm">🏆</span>}
                                      {isSilver && <span className="text-slate-400 text-sm">🥈</span>}
                                      {isBronze && <span className="text-orange-500 text-sm">🥉</span>}
                                      {!isGold && !isSilver && !isBronze && <span className="text-slate-400 pl-1">{entry.rank}</span>}
                                    </div>
                                  </td>

                                  <td className="py-3 px-3">
                                    <span className={`flex items-center gap-1.5 ${entry.isUser ? 'text-blue-700 dark:text-blue-400 font-black' : 'text-slate-800 dark:text-slate-200'}`}>
                                      {entry.isUser && <span className="text-[10px] bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded-full uppercase tracking-wider scale-90">Du</span>}
                                      {entry.athleteName}
                                    </span>
                                  </td>

                                  <td className="py-3 px-3 font-semibold font-mono text-slate-850 dark:text-slate-100">
                                    {formatTime(entry.timeInSeconds)}
                                  </td>

                                  <td className="py-3 px-3 font-mono text-slate-500 dark:text-slate-400">
                                    {entry.avgSpeedKmh.toFixed(1)} km/h
                                  </td>

                                  <td className="py-3 px-3 font-mono">
                                    {entry.avgPower ? (
                                      <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                                        <Zap className="w-3.5 h-3.5 text-amber-500" />
                                        {entry.avgPower}W
                                      </span>
                                    ) : (
                                      <span className="text-slate-400">--</span>
                                    )}
                                  </td>

                                  <td className="py-3 px-3 font-mono text-slate-500 dark:text-slate-400">
                                    {wattPerKg ? (
                                      <span className="font-bold text-slate-700 dark:text-slate-300">
                                        {wattPerKg} <span className="text-[9px] text-slate-400 font-normal">W/kg</span>
                                      </span>
                                    ) : (
                                      '--'
                                    )}
                                  </td>

                                  <td className="py-3 px-3 text-right font-mono text-[10px] text-slate-400 px-3">
                                    {entry.date}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="pacing"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="flex-1 overflow-y-auto min-h-0 bg-slate-50/30 dark:bg-slate-950/10 border border-slate-100 dark:border-slate-850 rounded-3xl p-6"
                    >
                      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start h-full">
                        {/* LEFT COLUMN: Controls */}
                        <div className="xl:col-span-7 flex flex-col gap-5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xs">
                          {/* Title & Info */}
                          <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                            <h4 className="text-sm font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                              <Sliders className="w-4 h-4 text-indigo-500" />
                              Pacing-Parameter
                            </h4>
                            <p className="text-xs text-slate-400 font-bold mt-1 leading-snug">
                              Stelle deine Leistungswerte & physikalischen Bedingungen live ein.
                            </p>
                          </div>

                          {/* Strategy selection */}
                          <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                              Intensität & Strategieverhalten
                            </label>
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                              {[
                                { id: 'ga1', name: 'GA1 (65%)', power: Math.round(ftp * 0.65) },
                                { id: 'ga2', name: 'GA2 (85%)', power: Math.round(ftp * 0.85) },
                                { id: 'ftp', name: 'Schwelle (100%)', power: Math.round(ftp * 1.0) },
                                { id: 'vo2', name: 'VO2Max (115%)', power: Math.round(ftp * 1.15) },
                                { id: 'custom', name: 'Individuell', power: pacingPower }
                              ].map((strat) => {
                                const isCurrent = pacingStrategy === strat.id || 
                                  (strat.id !== 'custom' && pacingPower === strat.power && pacingStrategy === 'custom');
                                return (
                                  <button
                                    key={strat.id}
                                    onClick={() => {
                                      setPacingStrategy(strat.id);
                                      if (strat.id !== 'custom') {
                                        setPacingPower(strat.power);
                                      }
                                    }}
                                    className={`px-2 py-2 rounded-xl text-[10px] sm:text-[11px] font-extrabold border transition-all text-center cursor-pointer ${
                                      isCurrent 
                                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs' 
                                        : 'bg-white dark:bg-slate-900 border-slate-150 dark:border-slate-800 text-slate-600 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800'
                                    }`}
                                  >
                                    {strat.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Watt target slider */}
                          <div className="space-y-2 bg-indigo-50/15 dark:bg-indigo-950/10 p-3.5 rounded-xl border border-indigo-100/40 dark:border-indigo-900/10">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-400">
                                Ziel-Leistung (Watt)
                              </span>
                              <div className="flex items-center gap-1">
                                <span className="font-extrabold text-slate-850 dark:text-slate-100 font-mono text-sm">
                                  {pacingPower} W
                                </span>
                                <span className="text-[9px] font-semibold text-slate-400">
                                  ({Math.round((pacingPower / ftp) * 100)}% FTP)
                                </span>
                              </div>
                            </div>
                            <input
                              type="range"
                              min="50"
                              max="600"
                              step="5"
                              value={pacingPower}
                              onChange={(e) => {
                                setPacingPower(parseInt(e.target.value, 10));
                                setPacingStrategy('custom');
                              }}
                              className="w-full highlight-indigo-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none"
                            />
                            <div className="flex justify-between text-[8px] font-mono font-bold text-slate-400 pt-0.5">
                              <span>50W</span>
                              <span>Pace: {ftp}W (100%)</span>
                              <span>600W</span>
                            </div>
                          </div>

                          {/* Athlete & Bike weights */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Athlete weight */}
                            <div className="space-y-2 border border-slate-100 dark:border-slate-800 p-3 rounded-xl">
                              <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                <span className="flex items-center gap-1">
                                  <Dumbbell className="w-3.5 h-3.5 text-slate-400" />
                                  Körpergewicht
                                </span>
                                <span className="font-mono text-slate-800 dark:text-slate-200">{pacingAthleteWeight} kg</span>
                              </div>
                              <input
                                type="range"
                                min="40"
                                max="130"
                                step="1"
                                value={pacingAthleteWeight}
                                onChange={(e) => setPacingAthleteWeight(parseInt(e.target.value, 10))}
                                className="w-full cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg"
                              />
                            </div>

                            {/* Bike weight */}
                            <div className="space-y-2 border border-slate-100 dark:border-slate-800 p-3 rounded-xl">
                              <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                <span className="flex items-center gap-1">
                                  <Bike className="w-3.5 h-3.5 text-slate-400" />
                                  Fahrradgewicht
                                </span>
                                <span className="font-mono text-slate-800 dark:text-slate-200">{pacingBikeWeight.toFixed(1)} kg</span>
                              </div>
                              <input
                                type="range"
                                min="5"
                                max="18"
                                step="0.5"
                                value={pacingBikeWeight}
                                onChange={(e) => setPacingBikeWeight(parseFloat(e.target.value))}
                                className="w-full cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg"
                              />
                            </div>
                          </div>

                          {/* Position (CdA) & Tyres (Crr) */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Riding position */}
                            <div className="space-y-2 border border-slate-100 dark:border-slate-800 p-3.5 rounded-xl">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
                                Fahrhaltung & Aerodynamik (CdA)
                              </label>
                              <div className="flex flex-col gap-1.5">
                                {[
                                  { name: 'Unterlenker (Drops)', cda: 0.26, label: 'CdA: 0.26 (Superschnell)' },
                                  { name: 'Bremsgriffe (Hoods)', cda: 0.32, label: 'CdA: 0.32 (Allround)' },
                                  { name: 'Aufrechte Haltung', cda: 0.40, label: 'CdA: 0.40 (Sehr komfortabel)' }
                                ].map((pos) => {
                                  const isSelected = Math.abs(pacingCdA - pos.cda) < 0.01;
                                  return (
                                    <button
                                      key={pos.cda}
                                      onClick={() => setPacingCdA(pos.cda)}
                                      className={`w-full text-left px-3 py-1.5 rounded-xl border text-xs font-bold transition-all flex justify-between items-center cursor-pointer ${
                                        isSelected
                                          ? 'bg-blue-50/60 dark:bg-blue-950/20 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-400'
                                          : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 text-slate-550 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                                      }`}
                                    >
                                      <span>{pos.name}</span>
                                      <span className="text-[9px] font-mono opacity-80">{pos.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Tyres / rolling resistance */}
                            <div className="space-y-2 border border-slate-100 dark:border-slate-800 p-3.5 rounded-xl">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
                                Bereifung (Crr - Rollwiderstand)
                              </label>
                              <div className="flex flex-col gap-1.5">
                                {[
                                  { name: 'Rennrad Slick (Glatte)', crr: 0.0040, label: 'Crr: 0.004' },
                                  { name: 'Allround Gravel (Profil)', crr: 0.0065, label: 'Crr: 0.006' },
                                  { name: 'MTB-Stollen (Stark)', crr: 0.0090, label: 'Crr: 0.009' }
                                ].map((tyre) => {
                                  const isSelected = Math.abs(pacingCrr - tyre.crr) < 0.0005;
                                  return (
                                    <button
                                      key={tyre.crr}
                                      onClick={() => setPacingCrr(tyre.crr)}
                                      className={`w-full text-left px-3 py-1.5 rounded-xl border text-xs font-bold transition-all flex justify-between items-center cursor-pointer ${
                                        isSelected
                                          ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800 text-emerald-750 dark:text-emerald-405'
                                          : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 text-slate-550 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                                      }`}
                                    >
                                      <span>{tyre.name}</span>
                                      <span className="text-[9px] font-mono opacity-80">{tyre.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* RIGHT COLUMN: Realtime Results */}
                        <div className="xl:col-span-5 flex flex-col gap-5">
                          {pacingResults ? (
                            <>
                              {/* Big simulated stats card */}
                              <div className="bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-955 p-5 rounded-2xl text-white shadow-xl flex flex-col gap-4">
                                <div className="flex justify-between items-start">
                                  <div>
                                    <span className="text-[9px] font-bold tracking-widest text-indigo-300 uppercase block leading-none">
                                      Simulierte Zielzeit
                                    </span>
                                    <h4 className="text-3xl font-black font-mono tracking-tight text-white mt-1.5">
                                      {formatTime(pacingResults.timeSec)}
                                    </h4>
                                  </div>
                                  <div className="bg-white/10 px-3 py-1.5 rounded-xl border border-white/10 text-right">
                                    <span className="text-[8px] font-bold text-indigo-255 uppercase block leading-none">⌀ Speed</span>
                                    <span className="text-sm font-black font-mono text-white mt-0.5 inline-block">
                                      {pacingResults.speedKmh.toFixed(1)} km/h
                                    </span>
                                  </div>
                                </div>

                                {/* Simulated rank medal box */}
                                <div className="bg-black/25 rounded-xl p-3.5 border border-white/5 flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2.5">
                                    <div className="p-2 bg-gradient-to-r from-amber-400 to-yellow-500 rounded-lg text-slate-950 flex items-center justify-center font-bold font-mono text-xs shadow-inner shrink-0">
                                      #{pacingResults.rank}
                                    </div>
                                    <div>
                                      <span className="text-[10px] text-indigo-200 font-extrabold uppercase tracking-wide block">
                                        Prognostizierter Rang
                                      </span>
                                      <p className="text-xs text-white/95 leading-tight font-bold mt-0.5">
                                        {pacingResults.rank === 1 ? (
                                          <span className="text-yellow-405 flex items-center gap-1 font-extrabold animate-bounce">
                                            🔥 Leaderboard Krone errungen!
                                          </span>
                                        ) : pacingCrr > 0.008 ? (
                                          <span>Hervorragend mit Geländereifen!</span>
                                        ) : pacingResults.beatenOpponentName ? (
                                          <span>Hinter dir: {pacingResults.beatenOpponentName}!</span>
                                        ) : (
                                          <span>Perfekt einkalkuliertes Pacing.</span>
                                        )}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Power allocation forces card */}
                              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xs">
                                <h4 className="text-xs font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider mb-3">
                                  Aufteilung Kräfteverlust (Leistung)
                                </h4>

                                {/* Horizontal stacked progress bar */}
                                <div className="w-full flex h-3 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 mb-4 shadow-inner">
                                  <div 
                                    style={{ width: `${pacingResults.fGravity}%` }} 
                                    className="bg-emerald-500 h-full transition-all duration-300" 
                                    title={`Hangabtriebskraft: ${pacingResults.fGravity}%`}
                                  />
                                  <div 
                                    style={{ width: `${pacingResults.fAir}%` }} 
                                    className="bg-blue-500 h-full transition-all duration-300" 
                                    title={`Luftwiderstand: ${pacingResults.fAir}%`}
                                  />
                                  <div 
                                    style={{ width: `${pacingResults.fRolling}%` }} 
                                    className="bg-amber-500 h-full transition-all duration-300" 
                                    title={`Rollwiderstand: ${pacingResults.fRolling}%`}
                                  />
                                  <div 
                                    style={{ width: `${pacingResults.fLoss}%` }} 
                                    className="bg-rose-500 h-full transition-all duration-300" 
                                    title={`Antriebsverlust: ${pacingResults.fLoss}%`}
                                  />
                                </div>

                                <div className="space-y-2 mt-2">
                                  <div className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 block" />
                                      <span className="text-slate-600 dark:text-slate-400 font-bold">⛰️ Hangabtrieb (Steigung)</span>
                                    </div>
                                    <span className="font-mono font-black text-slate-800 dark:text-slate-200">
                                      {pacingResults.fGravity}% <span className="text-[10px] text-slate-400 font-normal">({Math.round(pacingResults.gravityWatts)}W)</span>
                                    </span>
                                  </div>

                                  <div className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2.5 h-2.5 rounded-xs bg-blue-500 block" />
                                      <span className="text-slate-600 dark:text-slate-400 font-bold">💨 Aero-Luftwiderstand</span>
                                    </div>
                                    <span className="font-mono font-black text-slate-800 dark:text-slate-200">
                                      {pacingResults.fAir}% <span className="text-[10px] text-slate-400 font-normal">({Math.round(pacingResults.airWatts)}W)</span>
                                    </span>
                                  </div>

                                  <div className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 block" />
                                      <span className="text-slate-600 dark:text-slate-400 font-bold">🛞 Rollwiderstand</span>
                                    </div>
                                    <span className="font-mono font-black text-slate-800 dark:text-slate-200">
                                      {pacingResults.fRolling}% <span className="text-[10px] text-slate-400 font-normal">({Math.round(pacingResults.rollingWatts)}W)</span>
                                    </span>
                                  </div>

                                  <div className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2.5 h-2.5 rounded-xs bg-rose-500 block" />
                                      <span className="text-slate-600 dark:text-slate-400 font-bold">⚙️ Antriebsverlust (Reibung)</span>
                                    </div>
                                    <span className="font-mono font-black text-slate-800 dark:text-slate-200">
                                      {pacingResults.fLoss}% <span className="text-[10px] text-slate-400 font-normal">({Math.round(pacingResults.lossWatts)}W)</span>
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Pacing recommendation/advisor box */}
                              <div className="bg-amber-55/40 dark:bg-amber-955/10 border border-amber-200/50 dark:border-amber-900/30 p-4 rounded-xl flex items-start gap-3">
                                <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                                <div className="space-y-1">
                                  <span className="text-[10px] font-black uppercase text-amber-700 dark:text-amber-400 tracking-wider">
                                    Dynamischer Renn-Berater
                                  </span>
                                  <p className="text-xs text-slate-750 dark:text-slate-300 leading-relaxed font-semibold">
                                    {pacingResults.advice}
                                  </p>
                                  <p className="text-[10px] text-slate-400 font-bold pt-1">
                                    Intensitätstyp: <span className="text-indigo-600 dark:text-indigo-400">{pacingResults.tierName}</span>. Glykogen-Reserven erschöpfen in: <span className="text-rose-600 dark:text-rose-400 font-black">{pacingResults.glycogenTime}</span>.
                                  </p>
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="p-8 text-center text-slate-400">
                              Lade einen Sektor um Berechnungen durchzuführen.
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-400 dark:text-slate-500">
                <Compass className="w-16 h-16 stroke-1 mb-4" />
                <h4 className="text-base font-bold text-slate-700 dark:text-slate-300">Kein Segment ausgewählt</h4>
                <p className="text-xs text-slate-400 max-w-sm mt-1 leading-relaxed">
                  Bitte wähle links ein Segment aus oder erstelle ein neues auf der Karte.
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
