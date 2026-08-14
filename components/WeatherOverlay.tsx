import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  CloudSun, 
  Sun, 
  Cloud, 
  CloudRain, 
  CloudSnow, 
  Wind, 
  CloudLightning, 
  Droplets, 
  RefreshCw, 
  ExternalLink,
  MapPin,
  Compass,
  Info,
  Mountain,
  Flag,
  Calendar,
  Clock,
  ChevronRight,
  Sparkles,
  AlertTriangle,
  Layers
} from 'lucide-react';
import { GPXTrack, WeatherData, GPXPoint } from '../types';
import { getApiUrl } from '../utils/api';

interface WeatherOverlayProps {
  track: GPXTrack | undefined;
  allTracks?: GPXTrack[];
  onSelectTrack?: (trackId: string) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  selectedTime: string;
  setSelectedTime: (time: string) => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  hide?: boolean;
}

type WaypointType = 'start' | 'summit' | 'end';

export const WeatherOverlay: React.FC<WeatherOverlayProps> = ({ 
  track: propTrack,
  allTracks = [],
  onSelectTrack,
  selectedDate,
  setSelectedDate,
  selectedTime,
  setSelectedTime,
  isOpen = true,
  onOpenChange,
  onClose,
  hide
}) => {
  // If propTrack is undefined, fall back to first visible or first available track
  const effectiveTrack = useMemo(() => {
    if (propTrack) return propTrack;
    if (allTracks && allTracks.length > 0) {
      return allTracks.find(t => t.visible && t.points && t.points.length > 0) || allTracks[0];
    }
    return undefined;
  }, [propTrack, allTracks]);

  const [selectedWaypointType, setSelectedWaypointType] = useState<WaypointType>('start');
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compute waypoint coordinates (Start, Summit, End)
  const waypoints = useMemo(() => {
    if (!effectiveTrack || !effectiveTrack.points || effectiveTrack.points.length === 0) {
      return { start: null, summit: null, end: null };
    }

    const validPoints: GPXPoint[] = [];
    for (const p of effectiveTrack.points) {
      if (!p) continue;
      const lat = typeof p.lat === 'number' ? p.lat : parseFloat(p.lat as any);
      const lng = typeof p.lng === 'number' ? p.lng : parseFloat(p.lng as any);
      const ele = typeof p.ele === 'number' ? p.ele : (p.ele ? parseFloat(p.ele as any) : undefined);
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      validPoints.push({ ...p, lat, lng, ele });
    }

    if (validPoints.length === 0) {
      return { start: null, summit: null, end: null };
    }

    const start = validPoints[0];
    const end = validPoints[validPoints.length - 1];

    // Find summit (highest elevation)
    let summit: (GPXPoint & { lat: number; lng: number; ele?: number }) | null = null;
    let maxEle = -Infinity;
    for (const p of validPoints) {
      if (p.ele !== undefined && !isNaN(p.ele) && p.ele > maxEle) {
        maxEle = p.ele;
        summit = p;
      }
    }

    // Only consider summit distinct if it is not start/end or has meaningful elevation difference
    const hasDistinctSummit = summit !== null && maxEle > -Infinity && 
      (Math.abs(summit.lat - start.lat) > 0.005 || Math.abs(summit.lng - start.lng) > 0.005);

    return {
      start,
      summit: hasDistinctSummit ? summit : null,
      end: validPoints.length > 1 ? end : null
    };
  }, [effectiveTrack]);

  // Current target point for weather query
  const targetPoint = useMemo(() => {
    if (selectedWaypointType === 'summit' && waypoints.summit) {
      return waypoints.summit;
    }
    if (selectedWaypointType === 'end' && waypoints.end) {
      return waypoints.end;
    }
    return waypoints.start;
  }, [selectedWaypointType, waypoints]);

  // Original activity date if available in GPX track
  const originalTrackDate = useMemo(() => {
    if (!effectiveTrack) return null;
    const trackAny = effectiveTrack as any;
    if (trackAny.date) {
      try {
        const d = new Date(trackAny.date);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
      } catch (e) {}
    }
    if (effectiveTrack.points && effectiveTrack.points.length > 0) {
      const firstTime = effectiveTrack.points[0]?.time;
      if (firstTime) {
        try {
          const d = new Date(firstTime);
          if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        } catch (e) {}
      }
    }
    return null;
  }, [effectiveTrack]);

  const fetchWeather = async (lat: number, lng: number, dateStr: string, waypointType: WaypointType) => {
    setLoading(true);
    setError(null);
    try {
      const safeDate = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) 
        ? dateStr 
        : new Date().toISOString().split('T')[0];

      const apiUrl = getApiUrl('/api/weather');

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, date: safeDate }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Wetterdaten konnten nicht geladen werden.');
      }

      const data: WeatherData = await response.json();
      data.pointType = waypointType;
      if (targetPoint?.ele !== undefined) {
        data.elevation = Math.round(targetPoint.ele);
      }
      setWeather(data);
      
      // Cache entry for track + waypoint + date
      if (effectiveTrack) {
        try {
          const cacheKey = `weather_cache_${effectiveTrack.id}_${waypointType}_${safeDate}`;
          localStorage.setItem(cacheKey, JSON.stringify(data));
        } catch (cacheErr) {
          console.warn('Could not save weather to localStorage:', cacheErr);
        }
      }
    } catch (err: any) {
      console.error('Error in WeatherOverlay:', err);
      setError(err?.message || 'Fehler beim Abrufen der Wetterdaten.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (effectiveTrack && targetPoint) {
      const safeDate = selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
        ? selectedDate
        : new Date().toISOString().split('T')[0];

      const cacheKey = `weather_cache_${effectiveTrack.id}_${selectedWaypointType}_${safeDate}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          setWeather(parsed);
          setError(null);
          return;
        } catch (e) {
          console.warn('Stale cache, purging...', e);
          localStorage.removeItem(cacheKey);
        }
      }
      
      fetchWeather(targetPoint.lat, targetPoint.lng, safeDate, selectedWaypointType);
      return;
    }
    setWeather(null);
    setError(null);
  }, [effectiveTrack?.id, targetPoint?.lat, targetPoint?.lng, selectedDate, selectedWaypointType]);

  const handleRefresh = () => {
    if (targetPoint) {
      const safeDate = selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
        ? selectedDate
        : new Date().toISOString().split('T')[0];
      fetchWeather(targetPoint.lat, targetPoint.lng, safeDate, selectedWaypointType);
    }
  };

  const setDatePreset = (daysOffset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  if (hide) return null;

  // Map condition strings to appropriate Lucide Icons
  const getWeatherIcon = (cond: string) => {
    const c = (cond || '').toLowerCase();
    if (c.includes('sun') || c.includes('klar') || c.includes('clear') || c.includes('heiter')) {
      return <Sun className="text-amber-500 animate-[spin_50s_linear_infinite]" size={26} />;
    }
    if (c.includes('rain') || c.includes('regen') || c.includes('schauer') || c.includes('drizzle')) {
      return <CloudRain className="text-blue-500" size={26} />;
    }
    if (c.includes('snow') || c.includes('schnee') || c.includes('eis')) {
      return <CloudSnow className="text-sky-400 animate-pulse" size={26} />;
    }
    if (c.includes('storm') || c.includes('gewitter') || c.includes('thunder')) {
      return <CloudLightning className="text-yellow-500" size={26} />;
    }
    if (c.includes('wind') || c.includes('sturm') || c.includes('böen')) {
      return <Wind className="text-teal-500" size={26} />;
    }
    if (c.includes('part') || c.includes('wolki') || c.includes('teils') || c.includes('bewölkt') || c.includes('cloudy')) {
      return <CloudSun className="text-indigo-500" size={26} />;
    }
    return <Cloud className="text-slate-400" size={26} />;
  };

  return (
    <div className="w-full text-slate-800 dark:text-slate-100 text-xs">
      {!effectiveTrack ? (
        <div className="p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200/60 dark:border-slate-800 text-center space-y-2">
          <span className="text-3xl block">🌤️</span>
          <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
            Keine Route im Workspace
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            Lade oder erstelle eine GPX/FIT-Route, um die präzise Wetterprognose entlang der Strecke abzurufen.
          </p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {/* Header row & Track selector */}
          <div className="space-y-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Compass className="text-indigo-600 dark:text-indigo-400 shrink-0" size={15} />
                <span className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">
                  {effectiveTrack.name || 'Aktive Route'}
                </span>
              </div>
              <button
                onClick={handleRefresh}
                disabled={loading}
                title="Wetterprognose aktualisieren"
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer shrink-0"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin text-indigo-600' : ''} />
              </button>
            </div>

            {/* If multiple tracks exist in workspace, allow quick route switching */}
            {allTracks && allTracks.length > 1 && onSelectTrack && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <Layers size={12} className="text-slate-400 shrink-0" />
                {allTracks.map(t => (
                  <button
                    key={`tr-switch-${t.id}`}
                    onClick={() => onSelectTrack(t.id)}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap transition-all cursor-pointer ${
                      t.id === effectiveTrack.id 
                        ? 'bg-indigo-600 text-white shadow-xs' 
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Waypoint Switcher (Start, Summit, End) */}
          <div className="space-y-1">
            <label className="text-[9px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
              Streckenabschnitt
            </label>
            <div className="grid grid-cols-3 gap-1 bg-slate-100/80 dark:bg-slate-900/60 p-1 rounded-xl border border-slate-200/60 dark:border-slate-800">
              <button
                onClick={() => setSelectedWaypointType('start')}
                className={`py-1.5 px-2 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 transition-all cursor-pointer ${
                  selectedWaypointType === 'start'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <MapPin size={11} className="shrink-0" />
                <span>Start</span>
              </button>

              <button
                onClick={() => setSelectedWaypointType('summit')}
                disabled={!waypoints.summit}
                className={`py-1.5 px-2 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 transition-all cursor-pointer ${
                  selectedWaypointType === 'summit'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : !waypoints.summit
                    ? 'opacity-40 cursor-not-allowed text-slate-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Mountain size={11} className="shrink-0" />
                <span>Gipfel{waypoints.summit?.ele ? ` (${Math.round(waypoints.summit.ele)}m)` : ''}</span>
              </button>

              <button
                onClick={() => setSelectedWaypointType('end')}
                disabled={!waypoints.end}
                className={`py-1.5 px-2 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 transition-all cursor-pointer ${
                  selectedWaypointType === 'end'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : !waypoints.end
                    ? 'opacity-40 cursor-not-allowed text-slate-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Flag size={11} className="shrink-0" />
                <span>Ziel</span>
              </button>
            </div>
          </div>

          {/* Date & Time Selectors with Quick Presets */}
          <div className="bg-slate-50/80 dark:bg-slate-900/50 p-2.5 rounded-xl border border-slate-200/60 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between gap-1 flex-wrap">
              <span className="text-[9px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Zeitraum
              </span>
              {/* Quick Date Presets */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setDatePreset(0)}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                >
                  Heute
                </button>
                <button
                  onClick={() => setDatePreset(1)}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                >
                  Morgen
                </button>
                {originalTrackDate && (
                  <button
                    onClick={() => setSelectedDate(originalTrackDate)}
                    title={`Auf GPX-Aufnahmedatum (${originalTrackDate}) setzen`}
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 transition-colors cursor-pointer"
                  >
                    Aktivität ({originalTrackDate})
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <input 
                  type="date" 
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 outline-none cursor-pointer"
                />
              </div>
              <div>
                <input 
                  type="time" 
                  value={selectedTime}
                  onChange={(e) => setSelectedTime(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 outline-none cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Loading Indicator */}
          {loading && (
            <div className="py-6 text-center text-slate-400 space-y-2">
              <RefreshCw size={22} className="animate-spin mx-auto text-indigo-500" />
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Lade meteorologische Daten...</p>
              <p className="text-[10px] text-slate-400">Open-Meteo & OpenStreetMap Geocoding</p>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200/70 dark:border-red-900/60 rounded-xl text-center space-y-2">
              <div className="flex items-center justify-center gap-1.5 text-red-600 dark:text-red-400 font-black text-xs">
                <AlertTriangle size={14} />
                <span>Wetterabruf fehlgeschlagen</span>
              </div>
              <p className="text-[11px] text-red-700 dark:text-red-300 font-medium">{error}</p>
              <button
                onClick={handleRefresh}
                className="py-1 px-3 bg-red-600 hover:bg-red-700 text-white text-[10px] font-black rounded-lg transition-colors cursor-pointer shadow-xs"
              >
                Erneut versuchen
              </button>
            </div>
          )}

          {/* Weather Content */}
          {!loading && !error && weather && (
            <div className="space-y-3 animate-fade-in">
              {/* Location & Main Temperature Card */}
              <div className="bg-gradient-to-br from-indigo-50/70 via-sky-50/40 to-white dark:from-indigo-950/40 dark:via-slate-900 dark:to-slate-900 p-3 rounded-2xl border border-indigo-100/60 dark:border-indigo-900/40 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <MapPin size={13} className="text-indigo-500 shrink-0" />
                      <span className="font-black text-xs text-slate-800 dark:text-slate-100 truncate">
                        {weather.locationName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                        {selectedWaypointType === 'start' ? '📍 Startpunkt' : selectedWaypointType === 'summit' ? '⛰️ Höchster Punkt' : '🏁 Zielort'}
                      </span>
                      {weather.elevation !== undefined && (
                        <span className="text-[10px] text-slate-400 font-medium">
                          ({weather.elevation} m ü. M.)
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 font-semibold mt-1">
                      {weather.conditionDetail}
                    </p>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <div className="flex items-center gap-2">
                      {getWeatherIcon(weather.condition)}
                      <span className="text-2xl font-black text-slate-900 dark:text-white">
                        {weather.temperature}°C
                      </span>
                    </div>
                    <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1 mt-0.5">
                      <span className="text-emerald-600 dark:text-emerald-400">H: {weather.tempHigh}°</span>
                      <span>•</span>
                      <span className="text-sky-600 dark:text-sky-400">T: {weather.tempLow}°</span>
                    </div>
                  </div>
                </div>

                {weather.feelsLike !== undefined && (
                  <div className="mt-2 pt-2 border-t border-indigo-100/40 dark:border-slate-800 flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                    <span>Gefühlte Temperatur: <strong className="text-slate-700 dark:text-slate-200">{weather.feelsLike}°C</strong></span>
                    {weather.uvIndex !== undefined && (
                      <span>UV-Index: <strong className={`${weather.uvIndex >= 6 ? 'text-amber-600 font-black' : 'text-slate-700 dark:text-slate-200'}`}>{weather.uvIndex}</strong></span>
                    )}
                  </div>
                )}
              </div>

              {/* Bento Grid Metrics */}
              <div className="grid grid-cols-3 gap-1.5 text-center bg-slate-50/90 dark:bg-slate-900/60 p-2 rounded-xl border border-slate-200/60 dark:border-slate-800">
                <div className="p-1.5">
                  <Droplets className="text-blue-500 mx-auto mb-1" size={14} />
                  <span className="text-xs font-black block text-slate-800 dark:text-slate-100">
                    {weather.precipitationProbability ?? 'k.A.'}%
                  </span>
                  <span className="text-[8px] text-slate-400 font-extrabold uppercase">Regenrisiko</span>
                </div>
                <div className="p-1.5 border-x border-slate-200/60 dark:border-slate-800">
                  <Wind className="text-teal-500 mx-auto mb-1" size={14} />
                  <span className="text-xs font-black block text-slate-800 dark:text-slate-100">
                    {weather.windSpeed ?? 'k.A.'} <span className="text-[9px] font-bold">km/h</span>
                  </span>
                  <span className="text-[8px] text-slate-400 font-extrabold uppercase">Windstärke</span>
                </div>
                <div className="p-1.5">
                  <Info className="text-indigo-500 mx-auto mb-1" size={14} />
                  <span className="text-xs font-black block text-slate-800 dark:text-slate-100">
                    {weather.humidity ?? 65}%
                  </span>
                  <span className="text-[8px] text-slate-400 font-extrabold uppercase">Luftfeuchte</span>
                </div>
              </div>

              {/* Sports / Training Advisory Summary */}
              <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-xl border border-slate-200/60 dark:border-slate-800 space-y-1">
                <div className="flex items-center gap-1 text-[9px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  <Sparkles size={11} className="text-indigo-500" />
                  <span>Sport- & Ausrüstungsempfehlung</span>
                </div>
                <p className="text-[11px] leading-relaxed font-medium text-slate-700 dark:text-slate-300">
                  {weather.forecastSummary}
                </p>
              </div>

              {/* Fallback Notice or Open-Meteo Source attribution */}
              {weather.isFallback ? (
                <div className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-200/50 dark:border-amber-900/50 font-medium">
                  ℹ️ {weather.fallbackNotice || 'Echtzeit-Schätzung basierend auf topographischen Klimadaten.'}
                </div>
              ) : weather.sourceUrl && (
                <div className="flex items-center justify-between text-[9px] text-slate-400 px-1">
                  <span>Datenquelle: Open-Meteo & OSM</span>
                  <a 
                    href={weather.sourceUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 text-indigo-500 hover:underline font-bold cursor-pointer"
                  >
                    <span>Details</span>
                    <ExternalLink size={9} />
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

