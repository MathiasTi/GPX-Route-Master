import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Printer, Share2, Clipboard, Heart, Activity, Zap, 
  Layers, Trophy, Calendar, Clock, Bike, AlertTriangle, Sparkles, Navigation, CheckCircle
} from 'lucide-react';
import { GPXTrack } from '../types';
import { calculateDistance, formatPace, getPaceString, findClimbs } from '../utils/gpxUtils';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface SummaryReportModalProps {
  track: GPXTrack;
  onClose: () => void;
  ftp: number;
}

export const SummaryReportModal: React.FC<SummaryReportModalProps> = ({ track, onClose, ftp }) => {
  const [copied, setCopied] = useState(false);

  // Parse activity and stats
  const isCycling = track.activityType !== 'running';
  
  const estimatedSpeed = isCycling ? 22 : 10;
  const durationInSeconds = track.duration || Math.round((track.distance / estimatedSpeed) * 3600);
  
  const formattedDuration = useMemo(() => {
    const hrs = Math.floor(durationInSeconds / 3600);
    const mins = Math.floor((durationInSeconds % 3600) / 60);
    const secs = durationInSeconds % 60;
    return hrs > 0 ? `${hrs}h ${mins}m ${secs}s` : `${mins}m ${secs}s`;
  }, [durationInSeconds]);

  const avgSpeedKmh = useMemo(() => {
    const hours = durationInSeconds / 3600;
    return hours > 0 ? Number((track.distance / hours).toFixed(2)) : 0;
  }, [track.distance, durationInSeconds]);

  const formattedPace = useMemo(() => {
    return formatPace(durationInSeconds, track.distance);
  }, [durationInSeconds, track.distance]);

  // Compute climbs of the track
  const trackClimbs = useMemo(() => {
    return track.climbs && track.climbs.length > 0 ? track.climbs : findClimbs(track.points || []);
  }, [track.climbs, track.points]);

  // Prepare downsampled point data for high performance elevation chart
  const chartData = useMemo(() => {
    if (!track.points || track.points.length === 0) return [];
    
    let accumDist = 0;
    const pointsWithDist = track.points.map((p, idx) => {
      if (idx > 0) {
        const prev = track.points[idx - 1];
        accumDist += calculateDistance(prev, p);
      }
      return {
        dist: Number(accumDist.toFixed(2)),
        ele: p.ele !== undefined ? Math.round(p.ele) : 0,
        hr: p.hr !== undefined && p.hr > 0 ? p.hr : null,
        power: p.power !== undefined && p.power > 0 ? p.power : null
      };
    });

    const targetPointsCount = 120;
    if (pointsWithDist.length <= targetPointsCount) {
      return pointsWithDist;
    }
    
    const step = Math.max(1, Math.floor(pointsWithDist.length / targetPointsCount));
    const downsampled: typeof pointsWithDist = [];
    for (let i = 0; i < pointsWithDist.length; i += step) {
      downsampled.push(pointsWithDist[i]);
    }
    
    if (downsampled[downsampled.length - 1].dist !== pointsWithDist[pointsWithDist.length - 1].dist) {
      downsampled.push(pointsWithDist[pointsWithDist.length - 1]);
    }
    return downsampled;
  }, [track.points]);

  // Core elevation calculations
  const minEle = useMemo(() => {
    const elevations = track.points.map(p => p.ele).filter((e): e is number => e !== undefined);
    return elevations.length > 0 ? Math.round(Math.min(...elevations)) : 0;
  }, [track.points]);

  const maxEle = useMemo(() => {
    const elevations = track.points.map(p => p.ele).filter((e): e is number => e !== undefined);
    return elevations.length > 0 ? Math.round(Math.max(...elevations)) : 0;
  }, [track.points]);

  // Surface stats integration
  const totalSurfaceStatsDistance = useMemo(() => {
    return track.surfaceStats?.reduce((acc, s) => acc + s.distance, 0) || 0;
  }, [track.surfaceStats]);

  // Handle triggering window.print()
  const handlePrint = () => {
    window.print();
  };

  // Create a markdown report draft to share
  const handleCopyReport = () => {
    const typeLabel = isCycling ? 'Rennrad / Radsport' : 'Laufen / Trailrunning';
    let text = `📊 **GPX MASTER - AKTIVITÄTS-ZUSAMMENFASSUNG** 📊\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    text += `🏔️ **Name**: ${track.name}\n`;
    text += `🚴 **Typ**: ${typeLabel}\n`;
    text += `🗺️ **Distanz**: ${track.distance.toFixed(2)} km\n`;
    text += `⏱️ **Aktivitätszeit**: ${formattedDuration}\n`;
    text += `⚡ **Geschwindigkeit**: ${avgSpeedKmh} km/h (${formattedPace})\n\n`;
    
    text += `📈 **HÖHENPROFIL & ANSTIEGE**\n`;
    text += `🔺 **Anstieg (Aufstieg)**: +${Math.round(track.ascent)}m\n`;
    text += `🔻 **Abstieg**: -${Math.round(track.descent)}m\n`;
    text += `🗻 **Höhenbereich**: ${minEle}m - ${maxEle}m\n`;
    text += `📐 **Max. Steigung**: ${(track.maxSlope ?? 0).toFixed(1)}%\n`;
    text += `⛰️ **Berge/Climbs**: ${trackClimbs.length} kategorisierte Steigungen gefunden\n\n`;

    if (track.powerStats) {
      text += `⚡ **LEISTUNGSWERTE (WATT)**\n`;
      text += `⏱️ **FTP-Einstellung**: ${ftp} W\n`;
      text += `🔥 **Normalized Power (NP)**: ${Math.round(track.powerStats.normalizedPower || 0)} W\n`;
      text += `🏋️ **Durchschnitt (AP)**: ${Math.round(track.powerStats.avgPower || 0)} W\n`;
      text += `📈 **Max. Leistung**: ${track.powerStats.maxPower || 0} W\n`;
      text += `🔋 **TSS (Stress Score)**: ${Math.round(track.powerStats.tss || 0)}\n`;
      text += `⚡ **IF (Intensity Factor)**: ${(track.powerStats.intensityFactor || 0).toFixed(2)}\n`;
      text += `🥛 **VI (Variabilitätsindex)**: ${(track.powerStats.variabilityIndex || 0).toFixed(2)}\n\n`;
    }

    if (track.surfaceStats && track.surfaceStats.length > 0) {
      text += `🛤️ **WEGBESCHAFFENHEIT (OSM GROUND)**\n`;
      track.surfaceStats.forEach(s => {
        const pct = totalSurfaceStatsDistance > 0 ? ((s.distance / totalSurfaceStatsDistance) * 100).toFixed(1) : '0';
        text += `- **${s.type}**: ${s.distance.toFixed(1)} km (${pct}%)\n`;
      });
      text += `\n`;
    }

    text += `✨ Generiert mit GPX Master - Professionelle Streckenanalyse`;
    
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-[2200] flex items-center justify-center p-3 md:p-6 overflow-y-auto" id="modal-summary-report-overlay">
      
      {/* Print Specific CSS Stylesheet Injection */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
            background: white !important;
            color: black !important;
          }
          #print-area, #print-area * {
            visibility: visible;
          }
          #print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            background-color: white !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <motion.div 
        initial={{ opacity: 0, scale: 0.98, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 15 }}
        className="bg-white rounded-3xl border border-slate-100 shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden text-left"
        id="modal-summary-report"
      >
        
        {/* Header - Non printable control panel */}
        <div className="p-4 md:p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 relative z-10 no-print">
          <div className="flex items-center gap-2.5">
            <div className="bg-blue-600 p-2 rounded-2xl text-white shadow-md shadow-blue-500/10">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
                Aktivitäts-Zusammenfassung &amp; Report
              </h3>
              <p className="text-xs text-slate-400">Exportfertiges Datenblatt deiner absolvierten Strecke</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-blue-650 hover:bg-blue-700 text-white rounded-xl text-xs font-black shadow-md hover:shadow transition-all flex items-center gap-1.5 cursor-pointer"
              title="Report an Drucker senden oder als PDF speichern"
              id="btn-print-report"
            >
              <Printer className="w-3.5 h-3.5" />
              Drucken / PDF
            </button>
            <button
              onClick={handleCopyReport}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer border ${
                copied 
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                  : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700 shadow-sm'
              }`}
              title="Kopiert eine strukturierte Zusammenfassung in die Zwischenablage"
              id="btn-copy-report"
            >
              {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> : <Clipboard className="w-3.5 h-3.5 text-slate-500" />}
              {copied ? 'Kopiert!' : 'Kopieren'}
            </button>
            <button 
              onClick={onClose}
              className="p-2 text-slate-450 hover:text-slate-650 hover:bg-slate-100 rounded-xl transition-all cursor-pointer border border-transparent hover:border-slate-200"
              id="btn-close-report"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* PRINTABLE AREA CONTENT */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 relative" id="print-area">
          
          {/* Decorative subtle background accents */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-blue-100/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-12 left-10 w-80 h-80 bg-indigo-100/10 rounded-full blur-3xl pointer-events-none" />

          {/* Report Top Row Header (Printed Title and Metadata) */}
          <div className="border-b-2 border-slate-900 pb-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                  isCycling ? 'bg-indigo-100 text-indigo-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {isCycling ? 'Radsport / Cycling' : 'Laufsport / Running'}
                </span>
                <span className="text-[10px] font-bold text-slate-400 font-mono">
                  {track.points.length.toLocaleString('de-DE')} GPS-Punkte
                </span>
              </div>
              <h1 className="text-2xl md:text-3xl font-black text-slate-800 tracking-tight leading-tight">
                {track.name}
              </h1>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-4">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" /> 
                  Aktivitätsreport vom: {new Date().toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
              </p>
            </div>
            
            <div className="font-mono text-xs text-slate-500 border-l-0 md:border-l border-slate-250 md:pl-6 space-y-1 self-start md:self-auto shrink-0">
              <div className="flex md:block flex-wrap gap-x-3">
                <div className="font-bold text-slate-700">GPX-MASTER-SYSTEM REPORT</div>
                <div>Startpunkt: Lat {track.points[0]?.lat.toFixed(4)}, Lng {track.points[0]?.lng.toFixed(4)}</div>
                <div>Status: Ausgewertet / Verifiziert</div>
              </div>
            </div>
          </div>

          {/* Bento-Grid Stats Dashboard Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Distance Card */}
            <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-150">
              <span className="text-[9px] font-black tracking-wider uppercase text-slate-400 flex items-center gap-1">
                <Navigation className="w-3 h-3 text-blue-500" /> STATS / DISTANZ
              </span>
              <div className="mt-1 font-mono font-black text-2xl text-slate-800 tracking-tight">
                {track.distance.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} <span className="text-xs uppercase font-bold text-slate-500">km</span>
              </div>
              <p className="text-[10px] text-slate-450 mt-1 italic">Vollständige Streckenlänge</p>
            </div>

            {/* Time Card */}
            <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-150">
              <span className="text-[9px] font-black tracking-wider uppercase text-slate-400 flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-500" /> STATS / DAUER
              </span>
              <div className="mt-1 font-mono font-black text-2xl text-slate-800 tracking-tight">
                {formattedDuration}
              </div>
              <p className="text-[10px] text-slate-450 mt-1">Bruttozeit (gemessen)</p>
            </div>

            {/* Ascent Card */}
            <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-100">
              <span className="text-[9px] font-black tracking-wider uppercase text-emerald-600 flex items-center gap-1">
                <Trophy className="w-3 h-3 text-emerald-500" /> HÖHENMETER UP
              </span>
              <div className="mt-1 font-mono font-black text-2xl text-emerald-700 tracking-tight">
                +{Math.round(track.ascent).toLocaleString('de-DE')} <span className="text-xs uppercase font-bold text-emerald-600">m</span>
              </div>
              <p className="text-[10px] text-slate-450 mt-1">Kummulierter Höhengewinn</p>
            </div>

            {/* Descent Card */}
            <div className="bg-rose-500/5 p-4 rounded-2xl border border-rose-100">
              <span className="text-[9px] font-black tracking-wider uppercase text-rose-600 flex items-center gap-1">
                <Activity className="w-3 h-3 text-rose-500" /> HÖHENMETER DOWN
              </span>
              <div className="mt-1 font-mono font-black text-2xl text-rose-700 tracking-tight">
                -{Math.round(track.descent).toLocaleString('de-DE')} <span className="text-xs uppercase font-bold text-rose-600">m</span>
              </div>
              <p className="text-[10px] text-slate-450 mt-1">Kummulierter Höhenverlust</p>
            </div>
          </div>

          {/* Sub-bento-grid row: Tempo, Max slope, elevations */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-1">
            <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-150">
              <span className="text-[9px] font-black tracking-wider uppercase text-slate-400">DURCHSCHNITTSTEMPO</span>
              <div className="mt-1 font-mono font-extrabold text-lg text-slate-800">
                {avgSpeedKmh} <span className="text-[10px] text-slate-500">km/h</span>
              </div>
              <p className="text-[9px] text-slate-450 mt-0.5">Entspricht Pace: {formattedPace}</p>
            </div>

            <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-150">
              <span className="text-[9px] font-black tracking-wider uppercase text-slate-400 font-sans">MAX. STEIGUNG</span>
              <div className="mt-1 font-mono font-extrabold text-lg text-slate-800">
                {(track.maxSlope ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
              </div>
              <p className="text-[9px] text-slate-450 mt-0.5">Steilster Fahrbahnschnitt</p>
            </div>

            <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-150">
              <span className="text-[9px] font-black tracking-wider uppercase text-slate-400 font-sans">HÖHE (MIN)</span>
              <div className="mt-1 font-mono font-extrabold text-lg text-slate-800">
                {minEle} <span className="text-[10px] text-slate-400">m ü. NHN</span>
              </div>
              <p className="text-[9px] text-slate-450 mt-0.5">Tiefster Routenpunkt</p>
            </div>

            <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-150">
              <span className="text-[9px] font-black tracking-wider uppercase text-slate-400 font-sans">HÖHE (MAX)</span>
              <div className="mt-1 font-mono font-extrabold text-lg text-slate-800">
                {maxEle} <span className="text-[10px] text-slate-400">m ü. NHN</span>
              </div>
              <p className="text-[9px] text-slate-450 mt-0.5">Höchster Routenpunkt</p>
            </div>
          </div>

          {/* Power Stats Section (Dynamic - Only shown if available) */}
          {track.powerStats && (
            <div className="bg-amber-500/5 border border-amber-100 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-amber-100 pb-2.5">
                <Zap className="w-5 h-5 text-amber-600 fill-amber-300/30" />
                <div>
                  <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">Physikalische Leistungs-Analytik (Power Stats)</h4>
                  <p className="text-[10px] text-slate-500 font-medium">Basiert auf gemessener Tretleistung der Aktivität im Verhältnis zu deinen FTP-Schwellenwert ({ftp} Watt)</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-6 gap-4 font-mono">
                <div className="bg-white border border-slate-100 p-3 rounded-xl flex flex-col justify-center text-center shadow-xs">
                  <span className="text-[8px] text-slate-400 font-sans font-bold uppercase">Normalized Power</span>
                  <span className="text-lg font-black text-slate-700 mt-0.5">{Math.round(track.powerStats.normalizedPower || 0)}W</span>
                </div>
                <div className="bg-white border border-slate-100 p-3 rounded-xl flex flex-col justify-center text-center shadow-xs">
                  <span className="text-[8px] text-slate-400 font-sans font-bold uppercase">Avg Power (AP)</span>
                  <span className="text-lg font-black text-slate-700 mt-0.5">{Math.round(track.powerStats.avgPower || 0)}W</span>
                </div>
                <div className="bg-white border border-slate-100 p-3 rounded-xl flex flex-col justify-center text-center shadow-xs">
                  <span className="text-[8px] text-slate-400 font-sans font-bold uppercase">Max. Power</span>
                  <span className="text-lg font-black text-slate-700 mt-0.5">{track.powerStats.maxPower || 0}W</span>
                </div>
                <div className="bg-white border border-slate-100 p-3 rounded-xl flex flex-col justify-center text-center shadow-xs">
                  <span className="text-[8px] text-slate-400 font-sans font-bold uppercase">Training Stress (TSS)</span>
                  <span className="text-lg font-black text-amber-700 mt-0.5">{Math.round(track.powerStats.tss || 0)}</span>
                </div>
                <div className="bg-white border border-slate-100 p-3 rounded-xl flex flex-col justify-center text-center shadow-xs">
                  <span className="text-[8px] text-slate-400 font-sans font-bold uppercase">Intensity Factor (IF)</span>
                  <span className="text-lg font-black text-slate-700 mt-0.5">{(track.powerStats.intensityFactor || 0).toFixed(2)}</span>
                </div>
                <div className="bg-white border border-slate-100 p-3 rounded-xl flex flex-col justify-center text-center shadow-xs">
                  <span className="text-[8px] text-slate-400 font-sans font-bold uppercase">Variability (VI)</span>
                  <span className="text-lg font-black text-slate-700 mt-0.5">{(track.powerStats.variabilityIndex || 0).toFixed(2)}</span>
                </div>
              </div>

              {/* Power curve highlights */}
              {(track.powerStats.best1m || track.powerStats.best20m) && (
                <div className="bg-white/80 p-3 rounded-xl border border-dashed border-amber-200 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  {track.powerStats.best20s && (
                    <div className="flex justify-between items-center px-2">
                      <span className="font-bold text-slate-650">Beste 20s Power:</span>
                      <span className="font-mono font-black text-slate-800">{track.powerStats.best20s} W</span>
                    </div>
                  )}
                  {track.powerStats.best1m && (
                    <div className="flex justify-between items-center px-2 md:border-x md:border-amber-100">
                      <span className="font-bold text-slate-650">Beste 1 Min Power:</span>
                      <span className="font-mono font-black text-slate-800">{track.powerStats.best1m} W</span>
                    </div>
                  )}
                  {track.powerStats.best20m && (
                    <div className="flex justify-between items-center px-2">
                      <span className="font-bold text-slate-650">Beste 20 Min Power:</span>
                      <span className="font-mono font-black text-slate-800">{track.powerStats.best20m} W</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Elevation Profile Visualization Map Section */}
          {chartData.length > 0 && (
            <div className="bg-slate-50/50 p-5 rounded-3xl border border-slate-150 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black tracking-wider uppercase text-slate-500">PROFILVERLAUF &amp; GELÄNDEPROFILE</span>
                <span className="text-[10px] text-slate-400 font-sans italic">Vertikales Profil aufgetragen über Distanz ({track.distance.toFixed(1)} km)</span>
              </div>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                    <defs>
                      <linearGradient id="summaryEleGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.01}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="dist" fontSize={8} stroke="#94a3b8" unit=" km" />
                    <YAxis domain={['auto', 'auto']} fontSize={8} stroke="#94a3b8" />
                    <Tooltip 
                      contentStyle={{ fontSize: '9px', borderRadius: '12px', border: '1px solid #e2e8f0', backgroundColor: 'white' }} 
                      labelFormatter={(label) => `Km ${label}`}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="ele" 
                      stroke="#2563eb" 
                      strokeWidth={2}
                      name="Höhe (m)"
                      fillOpacity={1} 
                      fill="url(#summaryEleGrad)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Half Column layouts: Surface stats on left, Categorized climbs on right */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            
            {/* COLUMN 1: OpenStreetMap Ground Surfaces */}
            <div className="bg-slate-50/20 border border-slate-200/60 p-5 rounded-2xl space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-200/60 pb-2">
                <Layers className="w-5 h-5 text-blue-650" />
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">OSM Wegbeschaffenheit &amp; Bodennutzung</h4>
              </div>

              {track.surfaceStats && track.surfaceStats.length > 0 ? (
                <div className="space-y-3.5">
                  <p className="text-[11px] text-slate-500 leading-normal">
                    Die Bodenanalyse aus OpenStreetMap schlüsselt Straßentypen und Schotter-/Trail-Anteile der GPX-Strecke exakt auf:
                  </p>

                  <div className="space-y-2.5">
                    {track.surfaceStats.map((s, idx) => {
                      const pct = totalSurfaceStatsDistance > 0 ? (s.distance / totalSurfaceStatsDistance) * 100 : 0;
                      return (
                        <div key={idx} className="space-y-1">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-slate-700 text-[11px] capitalize">{s.type}</span>
                            <span className="font-mono text-[10px] text-slate-500">
                              {s.distance.toFixed(1)} km <span className="font-semibold text-slate-400">({pct.toFixed(1)}%)</span>
                            </span>
                          </div>
                          {/* visual progress bar */}
                          <div className="w-full bg-slate-200/50 rounded-full h-2 overflow-hidden">
                            <div 
                              className="bg-blue-650 h-full rounded-full transition-all duration-500"
                              style={{ width: `${pct}%`, opacity: 0.85 - (idx * 0.12) }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="bg-blue-50/50 border border-dashed border-blue-150 p-4 rounded-xl text-center flex flex-col items-center justify-center space-y-1.5 min-h-[140px]">
                  <AlertTriangle className="w-6 h-6 text-blue-600 mb-1" />
                  <h5 className="font-bold text-slate-700 text-xs">Keine Bodenbeschaffenheits-Daten geladen</h5>
                  <p className="text-[10px] text-slate-500 max-w-xs leading-normal">
                    Klicke im Track-Panel auf der Hauptseite auf <strong>"OSM ermitteln"</strong>, um Wegoberflächen von OpenStreetMap abzurufen!
                  </p>
                </div>
              )}
            </div>

            {/* COLUMN 2: Mountain Climbs Analyzed */}
            <div className="bg-slate-50/20 border border-slate-200/60 p-5 rounded-2xl space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-200/60 pb-2">
                <Trophy className="w-5 h-5 text-indigo-600" />
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Kategorisierte Anstiege (Berge)</h4>
              </div>

              {trackClimbs && trackClimbs.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-[11px] text-slate-500 leading-normal">
                    Automatisch ermittelte Steigungssektoren dieser Tour ({trackClimbs.length} Steigungen identifiziert):
                  </p>
                  
                  <div className="max-h-[220px] overflow-y-auto space-y-2 pr-1">
                    {trackClimbs.map((climb, index) => (
                      <div 
                        key={index} 
                        className="bg-white border border-slate-100 p-2.5 rounded-xl text-xs flex justify-between items-center transition-all hover:bg-slate-50 font-sans"
                      >
                        <div>
                          <span className="font-extrabold text-slate-800 text-[11px] block">Bergwertungs-Sektor #{index + 1}</span>
                          <span className="text-[10px] text-slate-400 font-medium">Länge: {Math.round(climb.distance).toLocaleString('de-DE')} m | Aufstieg: +{Math.round(climb.ascent)} m</span>
                        </div>
                        <div className="text-right font-mono">
                          <span className="font-black text-slate-700 block text-[11px]">{climb.avgGradient.toFixed(1)}% <span className="text-[9px] text-slate-400 font-normal">Ø</span></span>
                          <span className="text-[9px] text-red-650 font-bold font-mono">Max: {climb.maxGradient.toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-150 rounded-xl p-6 text-center text-slate-450 text-[11px] italic min-h-[140px] flex items-center justify-center">
                  Keine kategorialen Steigungs-Sektoren auf dieser flachen Strecke detektiert.
                </div>
              )}
            </div>

          </div>

          {/* Dynamic Heart Rate Zones Analysis callout if heart rate exists */}
          {track.points.some(p => p.hr !== undefined && p.hr > 0) && (
            <div className="bg-rose-50/30 border border-rose-100 p-4 rounded-xl flex items-start gap-3">
              <div className="bg-rose-100/50 p-2 rounded-lg shrink-0 mt-0.5">
                <Heart className="w-4 h-4 text-rose-600 fill-rose-100" />
              </div>
              <div className="space-y-1">
                <h5 className="font-bold text-xs text-rose-800">Pulszonen &amp; Kardiologische Auswertung</h5>
                <p className="text-[10px] text-slate-650 leading-relaxed">
                  Deine Herzfrequenzdaten werden dauerhaft überwacht. Für eine exzellente, detailreiche physiologische Auswertung kannst du die kardiologischen 5er-Zonen (von regenerativ bis anaerobe Leistungsspitze) über das separate Werkzeug <strong>"Trainingsbereiche &amp; Puls"</strong> konfigurieren.
                </p>
              </div>
            </div>
          )}

          {/* Professional Footer Credentials */}
          <div className="pt-6 border-t border-slate-200/85 mt-4 text-[9px] text-slate-400 flex flex-col md:flex-row justify-between items-center gap-2">
            <span>© 2026 GPX Master Pro - All rights reserved. Powered by OpenStreetMap Cloud &amp; Sports Science Engine.</span>
            <span className="font-mono bg-slate-100/80 border border-slate-200 text-slate-600 px-2 py-0.5 rounded font-semibold uppercase">Systembericht ID: {track.id.substring(0, 8).toUpperCase()}</span>
          </div>

        </div>

      </motion.div>
    </div>
  );
};
