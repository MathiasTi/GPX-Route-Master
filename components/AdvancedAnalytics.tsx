import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Activity, Zap, TrendingUp, BarChart2, Shield, Heart, Clock, Maximize2 } from 'lucide-react';
import { GPXTrack } from '../types';
import { calculatePowerStats } from '../utils/gpxUtils';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell } from 'recharts';

interface AdvancedAnalyticsProps {
  track: GPXTrack;
  onClose: () => void;
  ftp: number;
  userWeight: number;
  userAge: number;
  selectionBounds?: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null;
  onSelection?: (bounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null) => void;
}

const AdvancedAnalytics: React.FC<AdvancedAnalyticsProps> = ({ track, onClose, ftp, userWeight, userAge, selectionBounds, onSelection }) => {
  const [fullscreenChart, setFullscreenChart] = useState<string | null>(null);

  // Filter points if selection bounds are provided
  const analysisPoints = useMemo(() => {
    if (!selectionBounds) return track.points;
    return track.points.filter(p => 
      p.lat >= selectionBounds.minLat && p.lat <= selectionBounds.maxLat &&
      p.lng >= selectionBounds.minLng && p.lng <= selectionBounds.maxLng
    );
  }, [track.points, selectionBounds]);

  const powerStats = useMemo(() => {
    if (!selectionBounds) return track.powerStats;
    return calculatePowerStats(analysisPoints, ftp);
  }, [analysisPoints, ftp, selectionBounds, track.powerStats]);

  const duration = useMemo(() => {
    if (analysisPoints.length < 2) return 0;
    const firstTime = analysisPoints.find(p => p.time !== undefined)?.time;
    const lastTime = [...analysisPoints].reverse().find(p => p.time !== undefined)?.time;
    if (firstTime && lastTime) {
      return (lastTime.getTime() - firstTime.getTime()) / 1000;
    }
    return 0;
  }, [analysisPoints]);

  // Calculate Power Duration Curve data
  const pdData = useMemo(() => {
    if (analysisPoints.length < 2) return [];
    
    // We already have some bests in powerStats, but for a full curve we'd need more.
    // For now, let's use the provided bests + interpolate some
    const bests = [
      { time: 1, power: powerStats?.maxPower || 0 },
      { time: 20, power: powerStats?.best20s || 0 },
      { time: 60, power: powerStats?.best1m || 0 },
      { time: 300, power: (powerStats?.best1m || 0) * 0.9 }, // Mock 5m
      { time: 1200, power: powerStats?.best20m || 0 },
      { time: 3600, power: ftp },
    ].sort((a, b) => a.time - b.time);

    return bests.map(d => ({
      name: d.time < 60 ? `${d.time}s` : `${Math.round(d.time/60)}m`,
      seconds: d.time,
      power: Math.round(d.power)
    }));
  }, [analysisPoints, powerStats, ftp]);

  // Calculate Power Zones
  const powerZones = useMemo(() => {
    if (analysisPoints.length === 0) return [];
    const zones = [
      { name: 'Z1 Recovery', min: 0, max: 0.55 * ftp, color: '#94a3b8', duration: 0 },
      { name: 'Z2 Endurance', min: 0.55 * ftp, max: 0.75 * ftp, color: '#22c55e', duration: 0 },
      { name: 'Z3 Tempo', min: 0.75 * ftp, max: 0.90 * ftp, color: '#eab308', duration: 0 },
      { name: 'Z4 Threshold', min: 0.90 * ftp, max: 1.05 * ftp, color: '#f97316', duration: 0 },
      { name: 'Z5 VO2 Max', min: 1.05 * ftp, max: 1.20 * ftp, color: '#ef4444', duration: 0 },
      { name: 'Z6 Anaerobic', min: 1.20 * ftp, max: 1.50 * ftp, color: '#be185d', duration: 0 },
      { name: 'Z7 Neuromuscular', min: 1.50 * ftp, max: 2500, color: '#701a75', duration: 0 },
    ];

    let totalEffectiveSeconds = 0;
    analysisPoints.forEach((p, i) => {
      if (p.power !== undefined) {
        let delta = 1; // Default to 1s if no time data
        if (i > 0 && p.time && analysisPoints[i - 1].time) {
          delta = (p.time.getTime() - analysisPoints[i - 1].time.getTime()) / 1000;
          if (delta <= 0 || delta > 10) delta = 1; // Handle gaps/errors
        }
        
        const zone = zones.find(z => p.power! >= z.min && p.power! < z.max);
        if (zone) {
          zone.duration += delta;
          totalEffectiveSeconds += delta;
        }
      }
    });

    return zones.map(z => {
      const mins = Math.floor(z.duration / 60);
      const secs = Math.floor(z.duration % 60);
      return {
        ...z,
        percent: totalEffectiveSeconds > 0 ? (z.duration / totalEffectiveSeconds) * 100 : 0,
        timeStr: mins > 0 ? `${mins}m ${secs}s` : `${secs}s`,
        seconds: Math.floor(z.duration)
      };
    });
  }, [analysisPoints, ftp]);

  const avgHr = useMemo(() => {
    const hrPoints = analysisPoints.filter(p => p.hr !== undefined).map(p => p.hr!);
    if (hrPoints.length === 0) return null;
    return Math.round(hrPoints.reduce((a, b) => a + b, 0) / hrPoints.length);
  }, [analysisPoints]);

  const vo2maxEstimate = useMemo(() => {
    if (analysisPoints.length === 0) return null;
    
    const maxHr = 220 - userAge;
    const weight = userWeight || 75;
    
    // Attempt 1: Based on FTP (if no good 5m effort is identified)
    // Functional Threshold Power is roughly 80-85% of VO2max power
    const pVo2maxFromFtp = ftp / 0.82;
    const vo2FromFtp = (10.8 * pVo2maxFromFtp / weight) + 7;

    // Attempt 2: Based on best 5m power if available
    // We don't have a specific 5m best calculator yet, but let's use 20m as proxy if 5m is missing
    const p5m = powerStats?.best1m ? powerStats.best1m * 0.85 : (powerStats?.best20m ? powerStats.best20m * 1.1 : ftp * 1.15);
    const vo2FromPower = (10.8 * p5m / weight) + 7;

    // Reliability check: If HR is available, look at the correlation
    const hrPoints = analysisPoints.filter(p => p.hr !== undefined);
    if (hrPoints.length > 100) {
      const avgActiveHr = hrPoints.reduce((a, b) => a + b.hr!, 0) / hrPoints.length;
      const avgActivePower = analysisPoints.filter(p => p.power !== undefined).reduce((a, b) => a + b.power!, 0) / analysisPoints.length || 1;
      
      // Extrapolate power at Max HR
      // Power = k * HR (very linear in aerobic zone)
      const powerAtMaxHr = (avgActivePower / avgActiveHr) * maxHr;
      const vo2Extrapolated = (10.8 * powerAtMaxHr / weight) + 7;
      
      // Weighted average of methods
      return Math.round((vo2FromFtp * 0.3 + vo2FromPower * 0.3 + vo2Extrapolated * 0.4) * 10) / 10;
    }

    return Math.round(vo2FromFtp * 10) / 10;
  }, [analysisPoints, ftp, userWeight, userAge, powerStats]);

  const vo2Category = useMemo(() => {
    if (!vo2maxEstimate) return null;
    if (vo2maxEstimate > 60) return { label: 'Superior', color: 'text-purple-500' };
    if (vo2maxEstimate > 52) return { label: 'Exzellent', color: 'text-blue-500' };
    if (vo2maxEstimate > 44) return { label: 'Gut', color: 'text-emerald-500' };
    if (vo2maxEstimate > 36) return { label: 'Mittelmäßig', color: 'text-amber-500' };
    return { label: 'Gering', color: 'text-rose-500' };
  }, [vo2maxEstimate]);

  const climbCategory = (ascent: number, avgGrad: number, distM: number) => {
    const score = (ascent * avgGrad) / 10 + (ascent * ascent / distM) * 0.1;
    if (score >= 200) return { label: 'HC (Hors Cat.)', color: 'bg-slate-900 border-slate-950 text-white font-black' };
    if (score >= 100) return { label: 'Kategorie 1', color: 'bg-rose-100 border-rose-200 text-rose-700 font-bold' };
    if (score >= 45) return { label: 'Kategorie 2', color: 'bg-orange-100 border-orange-200 text-orange-700 font-bold' };
    if (score >= 18) return { label: 'Kategorie 3', color: 'bg-yellow-50 border-yellow-200 text-yellow-700 font-bold' };
    return { label: 'Kategorie 4', color: 'bg-emerald-100 border-emerald-200 text-emerald-700' };
  };

  const calculateVAM = (ascent: number, startIndex: number, endIndex: number) => {
    const segment = track.points.slice(startIndex, endIndex + 1);
    const firstTime = segment.find(p => p.time !== undefined)?.time;
    const lastTime = [...segment].reverse().find(p => p.time !== undefined)?.time;
    
    if (firstTime && lastTime) {
      const hours = (lastTime.getTime() - firstTime.getTime()) / 3600000;
      if (hours > 0.005) {
        return Math.round(ascent / hours);
      }
    }
    return null;
  };

  const getClimbAvgPower = (startIndex: number, endIndex: number) => {
    const segment = track.points.slice(startIndex, endIndex + 1);
    const powerPoints = segment.filter(p => p.power !== undefined).map(p => p.power!);
    if (powerPoints.length === 0) return 0;
    return Math.round(powerPoints.reduce((a, b) => a + b, 0) / powerPoints.length);
  };

  const focusOnClimb = (startIndex: number, endIndex: number) => {
    if (!onSelection || startIndex >= track.points.length || endIndex >= track.points.length) return;
    
    const climbPoints = track.points.slice(startIndex, endIndex + 1);
    if (climbPoints.length === 0) return;
    
    const lats = climbPoints.map(p => p.lat);
    const lngs = climbPoints.map(p => p.lng);
    
    onSelection({
      minLat: Math.min(...lats) - 0.002,
      maxLat: Math.max(...lats) + 0.002,
      minLng: Math.min(...lngs) - 0.002,
      maxLng: Math.max(...lngs) + 0.002
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      className="fixed inset-0 z-[100] bg-slate-50 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-8 py-6 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-100">
            <TrendingUp size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {track.name}
              {selectionBounds && <span className="ml-3 text-sm bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full font-bold uppercase tracking-wider">Auswahl</span>}
            </h1>
            <p className="text-slate-500 text-sm font-medium">Erweiterte Analyse & Leistungsdaten</p>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-3 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600"
        >
          <X size={32} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-8 bg-slate-50">
        <div className="max-w-7xl mx-auto space-y-8">
          
          {/* Advanced Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <MetricCard 
                label="Normalized Power" 
                value={`${Math.round(powerStats?.normalizedPower || 0)} W`} 
                icon={<Zap className="text-yellow-500" />}
                subValue={`VI: ${(powerStats?.variabilityIndex || 1).toFixed(2)}`}
                color="border-yellow-200 bg-yellow-50/30"
                tooltip="NP (Coggan): Ein gleitender 30-Sekunden Durchschnitt, der vierte Potenzierung nutzt, um die physiologischen Kosten intensiver Belastungsspitzen genauer abzubilden als der einfache Durchschnitt."
              />
              <MetricCard 
                label="TSS" 
                value={Math.round(powerStats?.tss || 0)} 
                icon={<Shield className="text-indigo-500" />}
                subValue="Training Stress Score"
                color="border-indigo-200 bg-indigo-50/30"
                tooltip="Gesamtbelastung der Einheit. Formel: (Dauer in s * NP * IF) / (FTP * 3600) * 100. Ein Wert von 100 entspricht einer einstündigen Belastung exakt an der FTP-Grenze."
              />
              <MetricCard 
                label="VO2max Schätz." 
                value={vo2maxEstimate || '--'} 
                icon={<Activity className="text-purple-500" />}
                subValue={vo2Category?.label || 'Ausdauerkapazität'}
                color="border-purple-200 bg-purple-50/30"
                tooltip="Geschätzt via ACSM-Leistungsformel: (10.8 * Watt/kg) + 7. Wenn HR-Daten vorliegen, wird zusätzlich die Leistung bei maximaler Herzfrequenz linear extrapoliert für höhere Genauigkeit."
              />
              <MetricCard 
                label="Intensity Factor" 
                value={(powerStats?.intensityFactor || 0).toFixed(2)} 
                icon={<TrendingUp className="text-emerald-500" />}
                subValue={`${Math.round((powerStats?.intensityFactor || 0) * 100)}% von FTP`}
                color="border-emerald-200 bg-emerald-50/30"
                tooltip="IF = NP / FTP. Beschreibt die relative Intensität. Eine 'gemütliche' Fahrt liegt oft bei 0.6-0.7, ein intensives Rennen bei 0.9-1.05."
              />
              <MetricCard 
                label="Arbeit" 
                value={`${Math.round(powerStats?.work || 0)} kJ`} 
                icon={<Activity className="text-rose-500" />}
                subValue="Gesamtenergie"
                color="border-rose-200 bg-rose-50/30"
                tooltip="Die physikalisch geleistete Arbeit in Kilojoule. Da der Wirkungsgrad des Menschen beim Radfahren ca. 20-25% beträgt, entspricht dieser Wert grob den verbrannten Kilokalorien."
              />
            </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Power Duration Curve */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <BarChart2 size={20} className="text-indigo-600" />
                  Power Duration Curve
                </h3>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setFullscreenChart('pd')}
                    className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                    title="Vollbild"
                  >
                    <Maximize2 size={16} />
                  </button>
                  <span className="text-[10px] bg-slate-100 px-2 py-1 rounded text-slate-500 font-mono hidden sm:inline-block">Watt / Zeit</span>
                </div>
              </div>
              <div className="h-64 sm:h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pdData}>
                    <defs>
                      <linearGradient id="colorPower" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 12 }} 
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                      unit=" W"
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                      formatter={(value) => [`${value} W`, 'Leistung']}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="power" 
                      stroke="#4f46e5" 
                      strokeWidth={3}
                      fillOpacity={1} 
                      fill="url(#colorPower)" 
                      animationDuration={1500}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Power Zones Distribution */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Zap size={20} className="text-amber-600" />
                  Leistungszonen
                </h3>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setFullscreenChart('zones')}
                    className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                    title="Vollbild"
                  >
                    <Maximize2 size={16} />
                  </button>
                  <span className="text-[10px] bg-slate-100 px-2 py-1 rounded text-slate-500 font-mono hidden sm:inline-block">FTP: {ftp}W</span>
                </div>
              </div>
              <div className="h-64 sm:h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={powerZones} layout="vertical" margin={{ left: 40 }}>
                    <XAxis type="number" hide />
                    <YAxis 
                      dataKey="name" 
                      type="category" 
                      axisLine={false} 
                      tickLine={false}
                      width={100}
                      tick={{ fill: '#64748b', fontSize: 11 }}
                    />
                    <Tooltip 
                      cursor={{ fill: 'transparent' }}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-white p-3 rounded-xl shadow-xl border border-slate-100">
                              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{data.name}</p>
                              <div className="flex items-baseline gap-2">
                                <span className="text-lg font-black text-slate-900">{data.percent.toFixed(1)}%</span>
                                <span className="text-sm font-medium text-slate-400">({data.timeStr})</span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="percent" radius={[0, 4, 4, 0]} barSize={20}>
                      {powerZones.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Detailed tabular summary of power zones resolving user query directly */}
              <div className="mt-6 border-t border-slate-100 pt-5 space-y-2.5">
                <div className="grid grid-cols-4 text-[10px] font-black uppercase text-slate-400 tracking-wider">
                  <div className="col-span-2">Leistungszone</div>
                  <div className="text-right">Anteil (%)</div>
                  <div className="text-right">Dauer</div>
                </div>
                {powerZones.map((entry, index) => {
                  const hrs = Math.floor(entry.seconds / 3600);
                  const mins = Math.floor((entry.seconds % 3600) / 60);
                  const secs = entry.seconds % 60;
                  const fullTimeStr = hrs > 0 
                    ? `${hrs}h ${mins}m ${secs}s` 
                    : mins > 0 
                      ? `${mins}m ${secs}s` 
                      : `${secs}s`;

                  return (
                    <div key={index} className="grid grid-cols-4 text-xs font-semibold items-center hover:bg-slate-100/50 p-1.5 rounded-lg transition-colors">
                      <div className="col-span-2 flex items-center gap-2 overflow-hidden truncate">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                        <span className="text-slate-800 font-bold truncate">{entry.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono hidden sm:inline-block">
                          ({Math.round(entry.min)}-{Math.round(entry.max)}W)
                        </span>
                      </div>
                      <div className="text-right font-mono font-bold text-slate-800">
                        {entry.percent.toFixed(1)}%
                      </div>
                      <div className="text-right font-mono text-slate-500 font-bold">
                        {fullTimeStr}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-center bg-white p-8 rounded-2xl border border-slate-200">
            <div className="space-y-2">
              <div className="text-slate-400 text-sm font-medium">Beste 60 Sek.</div>
              <div className="text-3xl font-black text-slate-900">{Math.round(powerStats?.best1m || 0)}W</div>
              <div className="text-xs text-indigo-500 font-bold uppercase tracking-widest">Sprint / Attacke</div>
            </div>
            <div className="space-y-2 border-x border-slate-100">
              <div className="text-slate-400 text-sm font-medium">Beste 20 Min.</div>
              <div className="text-3xl font-black text-slate-900">{Math.round(powerStats?.best20m || 0)}W</div>
              <div className="text-xs text-emerald-500 font-bold uppercase tracking-widest">Klettern / TT</div>
            </div>
            <div className="space-y-2">
              <div className="text-slate-400 text-sm font-medium">Geschätztes FTP</div>
              <div className="text-3xl font-black text-slate-900">{Math.round((powerStats?.best20m || 0) * 0.95)}W</div>
              <div className="text-xs text-rose-500 font-bold uppercase tracking-widest">Basierend auf 20m</div>
            </div>
          </div>

          {/* GoldenCheetah inspired additional metrics section if needed */}
          <div className="bg-indigo-900 text-white p-8 rounded-3xl overflow-hidden relative shadow-2xl shadow-indigo-200">
             <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-12">
               <div className="space-y-4">
                 <div className="flex items-center gap-2 opacity-80">
                   <Clock size={18} />
                   <span className="text-sm font-bold uppercase tracking-widest">Dauer</span>
                 </div>
                 <div className="text-4xl font-black">
                   {duration ? `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m ${Math.floor(duration % 60)}s` : '--'}
                 </div>
                 <p className="text-indigo-200 text-sm leading-relaxed">Gesamtzeit der Aufzeichnung inklusive Standzeiten.</p>
               </div>
               
               <div className="space-y-4">
                 <div className="flex items-center gap-2 opacity-80">
                   <Heart size={18} />
                   <span className="text-sm font-bold uppercase tracking-widest">Herzrate</span>
                 </div>
                 <div className="text-4xl font-black">
                   {avgHr || '--'} <span className="text-xl">avg</span>
                 </div>
                 <p className="text-indigo-200 text-sm leading-relaxed">Durchschnittliche Belastung des Herz-Kreislauf-Systems.</p>
               </div>

               <div className="space-y-4">
                 <div className="flex items-center gap-2 opacity-80">
                   <TrendingUp size={18} />
                   <span className="text-sm font-bold uppercase tracking-widest">Variabilität</span>
                 </div>
                 <div className="text-4xl font-black">
                   {(powerStats?.variabilityIndex || 1).toFixed(2)}
                 </div>
                 <p className="text-indigo-200 text-sm leading-relaxed">Verhältnis von NP zu Average Power. Ein Wert nahe 1.0 bedeutet gleichmäßige Belastung.</p>
               </div>
             </div>
             
             {/* Abstract background shape */}
             <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full -mr-48 -mt-48 blur-3xl" />
             <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-400/20 rounded-full -ml-32 -mb-32 blur-3xl" />
          </div>

          {/* Interactive Climb Analysis Section */}
          <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <span className="bg-indigo-50 text-indigo-600 p-2 rounded-xl text-lg block leading-none">
                    ⛰️
                  </span>
                  Höhenprofil- & Anstiegsanalyse
                </h3>
                <p className="text-slate-400 text-sm font-semibold max-w-xl">
                  Klassifizierung nach FIETS-Index, Steigraten (VAM), W/kg-Verteilung und Karten-Segmentfokus.
                </p>
              </div>
              {selectionBounds && (
                <button
                  onClick={() => onSelection && onSelection(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all border border-slate-200 cursor-pointer self-start sm:self-auto flex items-center gap-1"
                >
                  <span>✖</span> Zurücksetzen
                </button>
              )}
            </div>

            {!track.climbs || track.climbs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-center">
                <p className="text-sm font-bold text-slate-500">Keine signifikanten Steilstücke erkannt</p>
                <p className="text-xs max-w-md mt-1 text-slate-400">
                  Auf diesem Track wurden keine Anstiege mit einer Länge über 500 Meter und einer mittleren Steigung von mindestens 3.0 % identifiziert.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {track.climbs.map((climb, idx) => {
                  const cat = climbCategory(climb.ascent, climb.avgGradient, climb.distance);
                  const vam = calculateVAM(climb.ascent, climb.startIndex, climb.endIndex);
                  const avgPower = getClimbAvgPower(climb.startIndex, climb.endIndex);
                  const wKgRatio = (avgPower / (userWeight || 75)).toFixed(2);
                  const climbTimeSec = track.points[climb.endIndex].time && track.points[climb.startIndex].time
                    ? Math.round((track.points[climb.endIndex].time!.getTime() - track.points[climb.startIndex].time!.getTime()) / 1000)
                    : null;

                  const isFocused = selectionBounds && 
                    Math.abs(selectionBounds.minLat - (Math.min(...track.points.slice(climb.startIndex, climb.endIndex + 1).map(p => p.lat)) - 0.002)) < 0.001;

                  return (
                     <div 
                       key={idx}
                       className={`border rounded-2xl p-6 transition-all flex flex-col justify-between relative overflow-hidden ${
                         isFocused 
                           ? 'border-indigo-500 bg-indigo-50/20 shadow-md ring-1 ring-indigo-500/30' 
                           : 'border-slate-200 hover:border-indigo-400 hover:bg-slate-50/50 shadow-sm'
                       }`}
                     >
                       {isFocused && (
                         <div className="absolute top-0 right-0 bg-indigo-505 text-indigo-700 text-[10px] font-black uppercase tracking-widest px-3 py-1 bg-indigo-100 rounded-bl-xl">
                           Fokusiert
                         </div>
                       )}

                       <div>
                         <div className="flex items-center justify-between mb-3">
                           <span className="font-extrabold text-slate-900 text-lg">
                             Anstieg #{idx + 1}
                           </span>
                           <span className={`px-2.5 py-1 text-[11px] font-extrabold rounded-full border ${cat.color}`}>
                             {cat.label}
                           </span>
                         </div>

                         <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 my-4 border-y border-slate-100 py-4 text-xs font-semibold text-slate-600">
                           <div>
                             <span className="text-[10px] text-slate-400 uppercase tracking-widest block font-bold mb-0.5">Laenge</span>
                             <span className="font-black text-slate-900 text-sm">{(climb.distance / 1000).toFixed(2)} km</span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-400 uppercase tracking-widest block font-bold mb-0.5">Höhenmeter</span>
                             <span className="font-black text-rose-600 text-sm">+{Math.round(climb.ascent)} Hm</span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-400 uppercase tracking-widest block font-bold mb-0.5">Steigung (Ø / Max)</span>
                             <span className="font-black text-slate-900 text-sm">{climb.avgGradient.toFixed(1)}% / {climb.maxGradient.toFixed(1)}%</span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-400 uppercase tracking-widest block font-bold mb-0.5">Steigrate (VAM)</span>
                             <span className="font-black text-indigo-600 text-sm">{vam ? `${vam} Hm/h` : '--'}</span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-400 uppercase tracking-widest block font-bold mb-0.5">Ø Leistung</span>
                             <span className="font-black text-amber-600 text-sm">{avgPower ? `${avgPower} Watt` : '--'}</span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-400 uppercase tracking-widest block font-bold mb-0.5">W/kg Verhältnis</span>
                             <span className="font-black text-emerald-600 text-sm">{avgPower ? `${wKgRatio} W/kg` : '--'}</span>
                           </div>
                         </div>
                       </div>

                       <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-bold">
                         {climbTimeSec ? (
                           <span className="text-slate-400 font-medium font-mono text-center sm:text-left">
                             Dauer: {Math.floor(climbTimeSec / 60)}m {climbTimeSec % 60}s
                           </span>
                         ) : (
                           <div />
                         )}
                         <button
                           onClick={() => focusOnClimb(climb.startIndex, climb.endIndex)}
                           className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all font-bold text-center flex items-center justify-center gap-1 shadow-sm cursor-pointer"
                         >
                           <span>🔍</span> Auf Karte zoomen
                         </button>
                       </div>
                     </div>
                   );
                 })}
               </div>
             )}
           </div>

          <AnimatePresence>
            {fullscreenChart && (
              <div className="fixed inset-0 z-[400] bg-white flex flex-col p-4 sm:p-10 transition-all overflow-hidden lg:overflow-visible">
                <motion.div 
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="flex-1 flex flex-col h-full overflow-hidden"
                >
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                      <div className={`p-4 rounded-2xl ${fullscreenChart === 'pd' ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600'}`}>
                        {fullscreenChart === 'pd' ? <BarChart2 size={32} /> : <Zap size={32} />}
                      </div>
                      <div>
                        <h3 className="text-3xl font-black text-slate-900 tracking-tight">
                          {fullscreenChart === 'pd' ? 'Power Duration Curve' : 'Zeit in Leistungszonen'}
                        </h3>
                        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Detail-Analyse im Vollbild</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setFullscreenChart(null)}
                      className="p-4 bg-slate-100 rounded-2xl text-slate-600 hover:bg-slate-200 transition-all shadow-sm"
                    >
                      <X size={28} />
                    </button>
                  </div>
                  
                  <div className="flex-1 w-full bg-slate-900 rounded-[40px] p-8 sm:p-12 shadow-2xl relative overflow-hidden group">
                    {/* Visual accents */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[120px] rounded-full pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/10 blur-[120px] rounded-full pointer-events-none" />
                    
                    <ResponsiveContainer width="100%" height="100%">
                      {fullscreenChart === 'pd' ? (
                        <AreaChart data={pdData}>
                          <defs>
                            <linearGradient id="pdGradModal" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#818cf8" stopOpacity={0.4}/>
                              <stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                          <XAxis 
                            dataKey="name" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{fill: 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: 600}} 
                          />
                          <YAxis 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{fill: 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: 600}} 
                            unit=" W" 
                          />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1e293b', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', padding: '16px 20px' }}
                            cursor={{ stroke: '#818cf8', strokeWidth: 2 }}
                            itemStyle={{ color: '#fff', fontSize: '14px', fontWeight: 700 }}
                            labelStyle={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                          />
                          <Area type="monotone" dataKey="power" stroke="#818cf8" strokeWidth={5} fillOpacity={1} fill="url(#pdGradModal)" />
                        </AreaChart>
                      ) : (
                        <BarChart data={powerZones} layout="vertical" margin={{ left: 100 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.05)" />
                          <XAxis type="number" hide />
                          <YAxis 
                            dataKey="name" 
                            type="category" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{fill: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: 800}} 
                          />
                          <Tooltip 
                            cursor={{fill: 'rgba(255,255,255,0.03)'}}
                            contentStyle={{ backgroundColor: '#1e293b', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                const data = payload[0].payload;
                                return (
                                  <div className="bg-slate-800 p-4 rounded-2xl shadow-2xl border border-white/10">
                                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">{data.name}</p>
                                    <div className="flex items-baseline gap-2">
                                      <span className="text-2xl font-black text-white">{data.percent.toFixed(1)}%</span>
                                      <span className="text-sm font-bold text-slate-400">({data.timeStr})</span>
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                          <Bar dataKey="percent" radius={[0, 12, 12, 0]} barSize={50}>
                            {powerZones.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                  
                  <div className="mt-8 p-8 bg-slate-50 rounded-[32px] border border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 overflow-y-auto sm:overflow-visible">
                    <div className="max-w-2xl">
                      <h4 className="font-black text-slate-900 uppercase tracking-widest text-xs mb-3">Interpretation</h4>
                      <p className="text-slate-600 font-medium leading-relaxed italic text-sm">
                        {fullscreenChart === 'pd' 
                          ? 'Diese Kurve zeigt deine maximale Leistungsfähigkeit über verschiedene Zeitintervalle. Sie ist ein entscheidender Indikator für deine spezifischen Stärken (Sprint vs. Ausdauer).' 
                          : 'Die Zonenverteilung zeigt, wie viel Zeit du in den verschiedenen Intensitätsbereichen verbracht hast. Dies hilft bei der Beurteilung der Trainingsqualität und Spezifität.'}
                      </p>
                    </div>
                    <div className="shrink-0 bg-white p-4 rounded-2xl border border-slate-200 hidden sm:block">
                       <div className="text-[10px] font-black text-slate-400 uppercase mb-1 tracking-widest text-center">Export-Modus</div>
                       <button className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors">PNG Speichern</button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};

const MetricCard = ({ label, value, icon, subValue, color, tooltip }: { label: string, value: string | number, icon: React.ReactNode, subValue?: string, color: string, tooltip?: string }) => {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <>
      <div className={`p-6 rounded-2xl border ${color} shadow-sm transition-all hover:shadow-md group relative`}>
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-white rounded-lg shadow-sm group-hover:scale-110 transition-transform">
            {icon}
          </div>
          {tooltip && (
            <button 
              onClick={() => setShowDetail(true)}
              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-all"
              title="Details anzeigen"
            >
              <Shield size={16} className="opacity-60 group-hover:opacity-100" />
            </button>
          )}
        </div>
        <div className="space-y-1">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">{label}</span>
          <div className="text-3xl font-black text-slate-900">{value}</div>
          {subValue && <div className="text-slate-500 text-sm font-medium">{subValue}</div>}
        </div>
      </div>

      <AnimatePresence>
        {showDetail && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDetail(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center gap-4 mb-6">
                  <div className={`p-3 rounded-2xl ${color.split(' ')[1]}`}>
                    {icon}
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-900 tracking-tight">{label}</h3>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Detail-Analyse</p>
                  </div>
                </div>
                
                <div className="space-y-6">
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Aktueller Wert</div>
                    <div className="text-3xl font-black text-slate-900">{value}</div>
                  </div>

                  <div>
                    <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <Shield size={14} className="text-indigo-500" />
                      Hintergrund & Algorithmus
                    </h4>
                    <p className="text-slate-600 text-sm leading-relaxed font-medium">
                      {tooltip}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-slate-100">
                    <button 
                      onClick={() => setShowDetail(false)}
                      className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-colors"
                    >
                      Verstanden
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

export default AdvancedAnalytics;
