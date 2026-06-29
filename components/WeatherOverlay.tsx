import React, { useState, useEffect } from 'react';
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
  Info
} from 'lucide-react';
import { GPXTrack, WeatherData } from '../types';
import { getApiUrl } from '../utils/api';

interface WeatherOverlayProps {
  track: GPXTrack | undefined;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  selectedTime: string;
  setSelectedTime: (time: string) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export const WeatherOverlay: React.FC<WeatherOverlayProps> = ({ 
  track,
  selectedDate,
  setSelectedDate,
  selectedTime,
  setSelectedTime,
  isOpen,
  onOpenChange
}) => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = async (lat: number, lng: number, dateStr: string) => {
    setLoading(true);
    setError(null);
    try {
      const apiUrl = getApiUrl('/api/weather');

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, date: dateStr }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Wetterdaten konnten nicht geladen werden.');
      }

      const data = await response.json();
      setWeather(data);
      
      // Cache-Eintrag für diese Kombination aus Track-ID und Datum hinterlegen
      if (track) {
        try {
          const cacheKey = `weather_cache_${track.id}_${dateStr}`;
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
    if (track) {
      const cacheKey = `weather_cache_${track.id}_${selectedDate}`;
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
    }
    // Den Wetterzustand nullen, damit der Nutzer ihn per Klick anfordern kann if not in cache
    setWeather(null);
    setError(null);
  }, [track?.id, selectedDate]);

  const handleRefresh = () => {
    if (track && track.points && track.points.length > 0) {
      const startPt = track.points[0];
      fetchWeather(startPt.lat, startPt.lng, selectedDate);
    }
  };

  if (!track) return null;

  // Map condition strings to appropriate Lucide Icons
  const getWeatherIcon = (cond: string) => {
    const c = cond.toLowerCase();
    if (c.includes('sun') || c.includes('klar') || c.includes('clear') || c.includes('heiter')) {
      return <Sun className="text-amber-500 animate-[spin_50s_linear_infinite]" size={28} />;
    }
    if (c.includes('rain') || c.includes('regen') || c.includes('schauer') || c.includes('drizzle')) {
      return <CloudRain className="text-blue-400" size={28} />;
    }
    if (c.includes('snow') || c.includes('schnee') || c.includes('eis')) {
      return <CloudSnow className="text-sky-300 animate-pulse" size={28} />;
    }
    if (c.includes('storm') || c.includes('gewitter') || c.includes('thunder')) {
      return <CloudLightning className="text-yellow-400" size={28} />;
    }
    if (c.includes('wind') || c.includes('sturm') || c.includes('böen')) {
      return <Wind className="text-teal-400" size={28} />;
    }
    if (c.includes('part') || c.includes('wolki') || c.includes('teils') || c.includes('bewölkt') || c.includes('cloudy')) {
      return <CloudSun className="text-indigo-400" size={28} />;
    }
    return <Cloud className="text-slate-400" size={28} />;
  };

  return (
    <div className="absolute top-16 sm:top-20 right-4 z-[1040] max-w-sm w-[90vw] md:w-80">
      {/* Mini toggle bar when collapsed */}
      {!isOpen && (
        <button
          onClick={() => onOpenChange(true)}
          className="flex items-center gap-2 px-3 py-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md shadow-lg border border-slate-100 dark:border-slate-800 rounded-2xl text-xs font-black text-slate-700 dark:text-slate-300 hover:scale-105 transition-all cursor-pointer float-right"
        >
          {weather ? getWeatherIcon(weather.condition) : <span className="text-base">🌤️</span>}
          <span>{weather ? `${weather.locationName.split(',')[0]} (Wetter)` : 'Routen-Wetter anzeigen'}</span>
        </button>
      )}

      {/* Main expanded weather card */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -10 }}
            className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md shadow-2xl border border-slate-100 dark:border-slate-800 rounded-3xl overflow-hidden flex flex-col pointer-events-auto"
          >
            {/* Header with Title and Minimize */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
              <div className="flex items-center gap-2">
                <Compass className="text-indigo-600 animate-[spin_10s_linear_infinite]" size={16} />
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  Aktuelles Routen-Wetter 🌟
                </span>
                {weather?.isFallback && (
                  <span className="bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-[8px] px-1.5 py-0.5 rounded-full font-extrabold tracking-wider border border-amber-200/40 uppercase">
                    Schätzung
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleRefresh}
                  disabled={loading}
                  title="Wetter aktualisieren"
                  className="p-1 px-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer"
                >
                  <RefreshCw size={12} className={loading ? 'animate-spin text-indigo-600' : ''} />
                </button>
                <button
                  onClick={() => onOpenChange(false)}
                  title="Einklappen"
                  className="p-1 px-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors font-black text-xs cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Content body */}
            <div className="p-4">
              {loading && (
                <div className="space-y-3 py-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1.5 w-2/3">
                      <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded-md w-full animate-pulse" />
                      <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-md w-1/2 animate-pulse" />
                    </div>
                    <div className="h-12 w-12 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse" />
                  </div>
                  <div className="h-10 bg-slate-50 dark:bg-slate-900 rounded-xl animate-pulse" />
                </div>
              )}

              {error && (
                <div className="text-center py-4 space-y-2">
                  <p className="text-xs text-red-500 font-bold">{error}</p>
                  <button
                    onClick={handleRefresh}
                    className="py-1.5 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-[11px] font-black rounded-xl transition-all cursor-pointer"
                  >
                    Erneut versuchen
                  </button>
                </div>
              )}

              {!loading && !error && !weather && (
                <div className="space-y-4 py-1">
                  <div className="text-xs text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
                    Wetterprognose am Startpunkt ({track.points[0]?.lat.toFixed(4)}, {track.points[0]?.lng.toFixed(4)}) mittels Google Search Grounding abfragen.
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                        Start-Datum 📅
                      </label>
                      <input 
                        type="date" 
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-250 focus:ring-2 focus:ring-indigo-500/20 outline-none cursor-pointer"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                        Startzeit ⏰
                      </label>
                      <input 
                        type="time" 
                        value={selectedTime}
                        onChange={(e) => setSelectedTime(e.target.value)}
                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-250 focus:ring-2 focus:ring-indigo-500/20 outline-none cursor-pointer"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleRefresh}
                    disabled={loading}
                    className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-100 dark:shadow-none hover:translate-y-[-1px] transition-all cursor-pointer"
                  >
                    <span>Wetterbericht abrufen 🌤️</span>
                  </button>
                </div>
              )}

              {!loading && !error && weather && (
                <div className="space-y-4">
                  {/* Location & Conditions Heading */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1 text-slate-800 dark:text-slate-100">
                        <MapPin size={13} className="text-indigo-500 flex-shrink-0" />
                        <h4 className="text-xs font-black truncate max-w-[150px]" title={weather.locationName}>
                          {weather.locationName}
                        </h4>
                      </div>
                      <p className="text-[11px] font-bold text-slate-400 leading-none">
                        {weather.conditionDetail}
                      </p>
                    </div>
                    <div className="flex flex-col items-end">
                      <div className="flex items-center gap-1.5">
                        {getWeatherIcon(weather.condition)}
                        <span className="text-2xl font-black text-slate-800 dark:text-slate-100">
                          {weather.temperature}°
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-bold">
                        H: {weather.tempHigh}°C | L: {weather.tempLow}°C
                      </span>
                    </div>
                  </div>

                  {/* Additional weather stats bento block */}
                  <div className="grid grid-cols-3 gap-2 bg-slate-50/70 dark:bg-slate-950/40 p-2.5 rounded-2xl border border-slate-100/40 dark:border-slate-800/20">
                    <div className="flex flex-col items-center justify-center p-1 text-center">
                      <Droplets className="text-blue-500 mb-1" size={14} />
                      <span className="text-[10px] font-black text-slate-800 dark:text-slate-300">
                        {weather.precipitationProbability !== null && weather.precipitationProbability !== undefined 
                          ? `${weather.precipitationProbability}%` 
                          : 'k.A.'}
                      </span>
                      <span className="text-[8px] text-slate-400 uppercase tracking-wider font-extrabold">Regen</span>
                    </div>

                    <div className="flex flex-col items-center justify-center p-1 text-center border-x border-slate-200/50 dark:border-slate-800/40">
                      <Wind className="text-teal-500 mb-1" size={14} />
                      <span className="text-[10px] font-black text-slate-800 dark:text-slate-300">
                        {weather.windSpeed !== null && weather.windSpeed !== undefined 
                          ? `${weather.windSpeed} km/h` 
                          : 'k.A.'}
                      </span>
                      <span className="text-[8px] text-slate-400 uppercase tracking-wider font-extrabold">Wind</span>
                    </div>

                    <div className="flex flex-col items-center justify-center p-1 text-center">
                      <Info className="text-indigo-500 mb-1" size={14} />
                      <span className="text-[10px] font-black text-slate-800 dark:text-slate-300">
                        {weather.humidity !== null && weather.humidity !== undefined 
                          ? `${weather.humidity}%` 
                          : 'k.A.'}
                      </span>
                      <span className="text-[8px] text-slate-400 uppercase tracking-wider font-extrabold">Feuchte</span>
                    </div>
                  </div>

                  {weather.isFallback && weather.fallbackNotice && (
                    <div className="text-[10px] bg-amber-50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 p-2.5 rounded-2xl border border-amber-100/40 dark:border-amber-950/40 leading-relaxed font-bold">
                      ⚠️ {weather.fallbackNotice}
                    </div>
                  )}

                  {/* Cycling / Running Advisory summary from Search Grounding */}
                  <div className="text-xs bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-950 dark:text-indigo-200/90 p-3 rounded-2xl border border-indigo-100/40 dark:border-indigo-950/40 leading-relaxed font-medium">
                    {weather.forecastSummary}
                  </div>

                  {/* Interaktive Datum- und Startzeitwahl auch im geladenen Zustand */}
                  <div className="flex flex-col gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Start:</span>
                          <input 
                            type="date" 
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="bg-transparent text-[11px] font-black text-indigo-600 dark:text-indigo-400 focus:outline-none cursor-pointer border-b border-dashed border-indigo-200 hover:border-indigo-400"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider sm:ml-1">Zeit:</span>
                          <input 
                            type="time" 
                            value={selectedTime}
                            onChange={(e) => setSelectedTime(e.target.value)}
                            className="bg-transparent text-[11px] font-black text-indigo-600 dark:text-indigo-400 focus:outline-none cursor-pointer border-b border-dashed border-indigo-200 hover:border-indigo-400 w-[45px]"
                          />
                        </div>
                      </div>
                      <button 
                        onClick={handleRefresh}
                        disabled={loading}
                        className="text-[10px] text-indigo-600 hover:text-indigo-700 font-bold bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 px-2 py-1 rounded-lg flex items-center gap-1 transition-all cursor-pointer shrink-0"
                      >
                        <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
                        Aktualisieren
                      </button>
                    </div>
                  </div>

                  {/* Search grounding citation metadata link */}
                  {weather.sourceUrl && (
                    <div className="flex items-center justify-between text-[9px] text-slate-400 font-bold border-t border-slate-100 dark:border-slate-800 pt-2.5">
                      <span>Quelle: Google Search Grounding</span>
                      <a
                        href={weather.sourceUrl}
                        target="_blank"
                        referrerPolicy="no-referrer"
                        rel="noopener noreferrer"
                        className="text-indigo-500 hover:text-indigo-600 flex items-center gap-0.5 hover:underline"
                      >
                        Details <ExternalLink size={8} />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
