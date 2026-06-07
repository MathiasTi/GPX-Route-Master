import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Trophy, Medal, Clock, Zap, MapPin, Compass, Trash2, Milestone, ChevronRight, Share2, Flame, AlertCircle } from 'lucide-react';
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
}

export const SegmentsAnalysis: React.FC<SegmentsAnalysisProps> = ({
  tracks,
  activeTrack,
  onClose,
  activeLayer,
  segments,
  onDeleteSegment,
  userWeight = 75,
  estimatedSpeed = 15
}) => {
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);

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

                {/* Leaderboard Table Container */}
                <div className="flex-1 flex flex-col gap-3 min-h-0 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl p-5 shadow-sm">
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
                </div>
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
