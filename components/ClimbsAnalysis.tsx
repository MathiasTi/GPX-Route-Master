import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, TrendingUp, Compass, ArrowRight, Layers, BarChart3, HelpCircle, Star } from 'lucide-react';
import { GPXTrack, MapLayer } from '../types';
import { ClimbMiniMap } from './ClimbMiniMap';

interface ClimbsAnalysisProps {
  track: GPXTrack;
  onClose: () => void;
  activeLayer: MapLayer;
}

export const ClimbsAnalysis: React.FC<ClimbsAnalysisProps> = ({ track, onClose, activeLayer }) => {
  const [selectedClimbIndex, setSelectedClimbIndex] = useState<number | null>(null);

  const climbs = useMemo(() => {
    return track.climbs || [];
  }, [track.climbs]);

  // Calculate difficulty categories
  const getClimbCategory = (ascent: number, avgGrad: number, distM: number) => {
    const score = (ascent * avgGrad) / 10 + (ascent * ascent / distM) * 0.1;
    if (score >= 200) return { label: 'HC (Hors Catégorie)', color: 'bg-black text-white border-slate-900', desc: 'Legendärer Anstieg. Brutal steil und extrem lang.' };
    if (score >= 120) return { label: 'Kategorie 1', color: 'bg-rose-600 text-white border-rose-700', desc: 'Schwerer Anstieg. Lange Auffahrt mit viel Gesamthöhenmetern.' };
    if (score >= 50) return { label: 'Kategorie 2', color: 'bg-orange-500 text-white border-orange-600', desc: 'Moderater Berg. Mittelschwere Steigungsprozente.' };
    if (score >= 20) return { label: 'Kategorie 3', color: 'bg-amber-500 text-slate-900 border-amber-600', desc: 'Leichterer Hügel. Für fitte Sportler gut fahrbar.' };
    return { label: 'Kategorie 4', color: 'bg-blue-500 text-white border-blue-600', desc: 'Kleiner Hügel / kurze Steigung. Perfekt für Antritte.' };
  };

  const climbsDetailed = useMemo(() => {
    return climbs.map((climb, idx) => {
      const segmentPoints = track.points.slice(climb.startIndex, climb.endIndex + 1);
      const cat = getClimbCategory(climb.ascent, climb.avgGradient, climb.distance);
      
      const startEle = segmentPoints[0]?.ele ?? 0;
      const endEle = segmentPoints[segmentPoints.length - 1]?.ele ?? 0;

      return {
        ...climb,
        index: idx,
        points: segmentPoints,
        category: cat,
        startElevation: startEle,
        endElevation: endEle,
      };
    });
  }, [climbs, track.points]);

  const totalClimbAscent = useMemo(() => {
    return climbs.reduce((acc, c) => acc + c.ascent, 0);
  }, [climbs]);

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
        {/* Header banner */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-2xl">
              <TrendingUp size={20} className="animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800 dark:text-slate-100 leading-snug">
                Bergwertungs- & Steigungs-Analyse
              </h2>
              <p className="text-xs text-slate-400 font-bold leading-none mt-1">
                Route: <span className="text-indigo-600 dark:text-indigo-400 font-black">{track.name}</span>
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

        {/* Dynamic Bento stats header */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 bg-slate-50/30 dark:bg-slate-950/10 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="bg-white dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800/80 shadow-sm flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-1">Anzahl Anstiege</span>
            <span className="text-2xl font-black text-slate-800 dark:text-slate-100 font-mono">
              {climbs.length}
            </span>
          </div>
          
          <div className="bg-white dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800/80 shadow-sm flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-1">Climb Höhenmeter</span>
            <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400 font-mono">
              +{Math.round(totalClimbAscent)}m
            </span>
          </div>

          <div className="bg-white dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800/80 shadow-sm flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-1">Routen Höhenmeter</span>
            <span className="text-2xl font-black text-slate-800 dark:text-slate-100 font-mono">
              +{Math.round(track.ascent)}m
            </span>
          </div>

          <div className="bg-white dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800/80 shadow-sm flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-1">Maximalgefälle</span>
            <span className="text-2xl font-black text-rose-600 dark:text-rose-400 font-mono">
              {(track.maxSlope ?? 0).toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Content lists */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-slate-50/30 dark:bg-slate-950/20 p-6">
          {climbsDetailed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="p-4 bg-indigo-50 dark:bg-indigo-950/45 rounded-full text-indigo-500">
                <Compass size={32} />
              </div>
              <h3 className="text-base font-black text-slate-700 dark:text-slate-350">Keine signifikanten Anstiege gefunden</h3>
              <p className="max-w-md text-xs text-slate-400 leading-relaxed">
                Diese Route ist nach den sportlichen Kriterien (mind. 500 Meter Länge und über 3% Steigung) eher flach oder wellig.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {climbsDetailed.map((climb) => (
                <div
                  key={climb.index}
                  className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-xl hover:border-indigo-100 dark:hover:border-indigo-900/40 transition-all flex flex-col overflow-hidden group"
                >
                  {/* Map Crop at top */}
                  <div className="h-44 shrink-0 relative bg-slate-100 dark:bg-slate-950">
                    <ClimbMiniMap 
                      points={climb.points} 
                      color={track.color} 
                      activeLayer={activeLayer} 
                    />
                    
                    {/* Category Overlay tag */}
                    <div className="absolute top-3 left-3 z-[990]">
                      <span className={`px-2.5 py-1 text-[9px] font-black rounded-full uppercase tracking-widest border shadow-md ${climb.category.color}`}>
                        {climb.category.label}
                      </span>
                    </div>

                    <div className="absolute bottom-3 right-3 z-[990]">
                      <span className="bg-slate-900/85 backdrop-blur-md border border-white/10 text-white font-mono text-[10px] font-black px-2 py-1 rounded-xl shadow-lg">
                        #{climb.index + 1} Bergwertung
                      </span>
                    </div>
                  </div>

                  {/* Body Info */}
                  <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                    <div className="space-y-3.5">
                      {/* Grid values including Cum Ascent */}
                      <div className="grid grid-cols-3 gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-3">
                        <div className="text-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Länge</span>
                          <span className="text-xs font-black text-slate-800 dark:text-slate-150 font-mono">
                            {(climb.distance / 1000).toFixed(2)} km
                          </span>
                        </div>
                        <div className="text-center border-x border-slate-100 dark:border-slate-800">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Sektion Hm</span>
                          <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 font-mono">
                            +{Math.round(climb.ascent)}m
                          </span>
                        </div>
                        <div className="text-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Ø Steigung</span>
                          <span className="text-xs font-black text-slate-800 dark:text-slate-150 font-mono">
                            {climb.avgGradient.toFixed(1)}%
                          </span>
                        </div>
                      </div>

                      {/* Elevation Profile representation */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
                          <span>Start: {Math.round(climb.startElevation)}m</span>
                          <span>Max: {climb.maxGradient.toFixed(1)}% Gefälle</span>
                          <span>Ende: {Math.round(climb.endElevation)}m</span>
                        </div>
                        {/* Dynamic mini bar graph as elevation indicator */}
                        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                          <div 
                            className="bg-gradient-to-r from-indigo-500 via-purple-500 to-rose-600 rounded-full h-full"
                            style={{ width: `${Math.min(100, Math.max(10, climb.avgGradient * 8))}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-400 dark:text-slate-500 italic leading-snug">
                      {climb.category.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
