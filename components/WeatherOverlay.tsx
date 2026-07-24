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
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  hide?: boolean;
}

export const WeatherOverlay: React.FC<WeatherOverlayProps> = ({ 
  track,
  selectedDate,
  setSelectedDate,
  selectedTime,
  setSelectedTime,
  isOpen = true,
  onOpenChange,
  hide
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
      // Auto-fetch if first track and no cache
      if (track.points && track.points.length > 0) {
        const startPt = track.points[0];
        fetchWeather(startPt.lat, startPt.lng, selectedDate);
        return;
      }
    }
    setWeather(null);
    setError(null);
  }, [track?.id, selectedDate]);

  const handleRefresh = () => {
    if (track && track.points && track.points.length > 0) {
      const startPt = track.points[0];
      fetchWeather(startPt.lat, startPt.lng, selectedDate);
    }
  };

  if (hide) return null;

  // Map condition strings to appropriate Lucide Icons
  const getWeatherIcon = (cond: string) => {
    const c = cond.toLowerCase();
    if (c.includes('sun') || c.includes('klar') || c.includes('clear') || c.includes('heiter')) {
      return <Sun className="text-amber-500 animate-[spin_50s_linear_infinite]" size={24} />;
    }
    if (c.includes('rain') || c.includes('regen') || c.includes('schauer') || c.includes('drizzle')) {
      return <CloudRain className="text-blue-400" size={24} />;
    }
    if (c.includes('snow') || c.includes('schnee') || c.includes('eis')) {
      return <CloudSnow className="text-sky-300 animate-pulse" size={24} />;
    }
    if (c.includes('storm') || c.includes('gewitter') || c.includes('thunder')) {
      return <CloudLightning className="text-yellow-400" size={24} />;
    }
    if (c.includes('wind') || c.includes('sturm') || c.includes('böen')) {
      return <Wind className="text-teal-400" size={24} />;
    }
    if (c.includes('part') || c.includes('wolki') || c.includes('teils') || c.includes('bewölkt') || c.includes('cloudy')) {
      return <CloudSun className="text-indigo-400" size={24} />;
    }
    return <Cloud className="text-slate-400" size={24} />;
  };

  return (
    <div className="w-full text-slate-800 dark:text-slate-100 text-xs">
      {!track ? (
        <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200/60 dark:border-slate-800 text-center space-y-2">
          <span className="text-2xl block">🌤️</span>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            Wähle oder lade eine Route im Workspace geladen, um das Wetter für die Strecke abzurufen.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Header row */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5 min-w-0">
              <Compass className="text-indigo-500 shrink-0" size={14} />
              <span className="text-[11px] font-black text-slate-700 dark:text-slate-200 truncate">
                {track.name}
              </span>
            </div>
            <button
              onClick={handleRefresh}
              disabled={loading}
              title="Wetter aktualisieren"
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer shrink-0"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin text-indigo-600' : ''} />
            </button>
          </div>

          {/* Date and Time selectors */}
          <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-900/40 p-2 rounded-xl border border-slate-100 dark:border-slate-800">
            <div>
              <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase block mb-0.5">
                Datum
              </label>
              <input 
                type="date" 
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase block mb-0.5">
                Startzeit
              </label>
              <input 
                type="time" 
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
              />
            </div>
          </div>

          {loading && (
            <div className="py-4 text-center text-slate-400 space-y-2">
              <RefreshCw size={18} className="animate-spin mx-auto text-indigo-500" />
              <p className="text-[10px] font-bold">Lade Wetterbericht...</p>
            </div>
          )}

          {error && (
            <div className="p-2.5 bg-red-50 dark:bg-red-950/30 border border-red-200/50 dark:border-red-900/50 rounded-xl text-center space-y-1.5">
              <p className="text-[11px] text-red-600 dark:text-red-400 font-bold">{error}</p>
              <button
                onClick={handleRefresh}
                className="py-1 px-2.5 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 text-[10px] font-black rounded-lg cursor-pointer"
              >
                Erneut versuchen
              </button>
            </div>
          )}

          {!loading && !error && weather && (
            <div className="space-y-3">
              {/* Location & Temp */}
              <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-indigo-50/50 to-sky-50/50 dark:from-indigo-950/30 dark:to-sky-950/30 p-2.5 rounded-xl border border-indigo-100/40 dark:border-indigo-900/30">
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <MapPin size={12} className="text-indigo-500 shrink-0" />
                    <span className="font-extrabold text-xs truncate max-w-[130px]">{weather.locationName}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{weather.conditionDetail}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {getWeatherIcon(weather.condition)}
                  <span className="text-xl font-black">{weather.temperature}°C</span>
                </div>
              </div>

              {/* Bento stats */}
              <div className="grid grid-cols-3 gap-1.5 text-center bg-slate-50/80 dark:bg-slate-900/50 p-2 rounded-xl border border-slate-100 dark:border-slate-800">
                <div className="p-1">
                  <Droplets className="text-blue-500 mx-auto mb-0.5" size={13} />
                  <span className="text-[10px] font-black block">{weather.precipitationProbability ?? 'k.A.'}%</span>
                  <span className="text-[8px] text-slate-400 font-extrabold uppercase">Regen</span>
                </div>
                <div className="p-1 border-x border-slate-200/50 dark:border-slate-800">
                  <Wind className="text-teal-500 mx-auto mb-0.5" size={13} />
                  <span className="text-[10px] font-black block">{weather.windSpeed ?? 'k.A.'} km/h</span>
                  <span className="text-[8px] text-slate-400 font-extrabold uppercase">Wind</span>
                </div>
                <div className="p-1">
                  <Info className="text-indigo-500 mx-auto mb-0.5" size={13} />
                  <span className="text-[10px] font-black block">{weather.humidity ?? 'k.A.'}%</span>
                  <span className="text-[8px] text-slate-400 font-extrabold uppercase">Feuchte</span>
                </div>
              </div>

              {/* Summary text */}
              <p className="text-[11px] bg-slate-50 dark:bg-slate-900/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 leading-relaxed font-medium text-slate-600 dark:text-slate-300">
                {weather.forecastSummary}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
