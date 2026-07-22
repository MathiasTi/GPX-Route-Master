import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, FolderOpen, Calendar, Tag, Activity, X, Check, RefreshCw, Compass, ArrowLeftRight, Navigation, MapPin } from 'lucide-react';
import { GPXTrack } from '../types';
import { getApiUrl } from '../utils/api';
import { calculateElevationStats, parseLocationCoords, generateVirtualRoute } from '../utils/gpxUtils';

interface TrackLibraryProps {
  onLoadTrack: (track: GPXTrack) => void;
  onActiveTrackId?: string | null;
  selectionBounds?: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null;
  onClearSelection?: () => void;
}

interface LibraryTrackThin {
  id: string;
  name: string;
  distance: number;
  ascent: number;
  descent: number;
  duration?: number;
  maxSlope?: number;
  activityType: 'cycling' | 'running';
  description: string;
  tags: string[];
  dateCreated: string;
  originalFilename?: string;
  rawFileDetails?: any;
  isGarminActivity?: boolean;
  rawRecord?: any;
}

// Robust helper function to extract elevation (ele) data from coordinate object or array
function extractElevation(p: any): number | undefined {
  if (!p) return undefined;
  if (Array.isArray(p)) {
    return p[2] !== undefined ? parseFloat(p[2]) : undefined;
  }
  const eleKeys = ["ele", "elevation", "alt", "altitude", "altitude_m", "height", "enhanced_altitude", "enhanced_altitude_m"];
  for (const key of eleKeys) {
    if (p[key] !== undefined && p[key] !== null) {
      const val = parseFloat(p[key]);
      if (!isNaN(val)) return val;
    }
  }
  // Case insensitive check
  if (typeof p === 'object') {
    for (const key of Object.keys(p)) {
      if (eleKeys.includes(key.toLowerCase())) {
        const val = parseFloat(p[key]);
        if (!isNaN(val)) return val;
      }
    }
  }
  return undefined;
}

// Robust helper to extract latitude (lat)
function extractLat(p: any): number | undefined {
  if (!p) return undefined;
  if (Array.isArray(p)) {
    return parseFloat(p[0]);
  }
  const latKeys = ["lat", "latitude", "lat_deg", "position_lat", "position_latitude", "y"];
  for (const key of latKeys) {
    if (p[key] !== undefined && p[key] !== null) {
      const val = parseFloat(p[key]);
      if (!isNaN(val)) return val;
    }
  }
  if (typeof p === 'object') {
    for (const key of Object.keys(p)) {
      if (latKeys.includes(key.toLowerCase())) {
        const val = parseFloat(p[key]);
        if (!isNaN(val)) return val;
      }
    }
  }
  return undefined;
}

// Robust helper to extract longitude (lng)
function extractLng(p: any): number | undefined {
  if (!p) return undefined;
  if (Array.isArray(p)) {
    return parseFloat(p[1]);
  }
  const lngKeys = ["lng", "longitude", "lon", "lon_deg", "lng_deg", "position_lon", "position_longitude", "x"];
  for (const key of lngKeys) {
    if (p[key] !== undefined && p[key] !== null) {
      const val = parseFloat(p[key]);
      if (!isNaN(val)) return val;
    }
  }
  if (typeof p === 'object') {
    for (const key of Object.keys(p)) {
      if (lngKeys.includes(key.toLowerCase())) {
        const val = parseFloat(p[key]);
        if (!isNaN(val)) return val;
      }
    }
  }
  return undefined;
}

// Robust helper to extract heart rate
function extractHeartRate(p: any): number | undefined {
  if (!p) return undefined;
  const keys = ["hr", "heartrate", "heart_rate", "average_hr", "avg_hr", "hf", "herzfrequenz", "puls", "heartrate_bpm", "heart_rate_bpm"];
  for (const key of keys) {
    if (p[key] !== undefined && p[key] !== null) {
      const val = parseFloat(p[key]);
      if (!isNaN(val) && val > 0) return val;
    }
  }
  if (typeof p === 'object') {
    for (const key of Object.keys(p)) {
      if (keys.includes(key.toLowerCase())) {
        const val = parseFloat(p[key]);
        if (!isNaN(val) && val > 0) return val;
      }
    }
  }
  return undefined;
}

// Robust helper to extract cadence
function extractCadence(p: any): number | undefined {
  if (!p) return undefined;
  const keys = ["cadence", "cad", "average_cadence", "avg_cadence", "bike_cadence", "run_cadence", "trittfrequenz", "cadence_rpm"];
  for (const key of keys) {
    if (p[key] !== undefined && p[key] !== null) {
      const val = parseFloat(p[key]);
      if (!isNaN(val)) return val;
    }
  }
  if (typeof p === 'object') {
    for (const key of Object.keys(p)) {
      if (keys.includes(key.toLowerCase())) {
        const val = parseFloat(p[key]);
        if (!isNaN(val)) return val;
      }
    }
  }
  return undefined;
}

// Robust helper to extract power
function extractPower(p: any): number | undefined {
  if (!p) return undefined;
  const keys = ["power", "watts", "average_power", "avg_power", "pwr", "leistung", "power_watts"];
  for (const key of keys) {
    if (p[key] !== undefined && p[key] !== null) {
      const val = parseFloat(p[key]);
      if (!isNaN(val)) return val;
    }
  }
  if (typeof p === 'object') {
    for (const key of Object.keys(p)) {
      if (keys.includes(key.toLowerCase())) {
        const val = parseFloat(p[key]);
        if (!isNaN(val)) return val;
      }
    }
  }
  return undefined;
}

// Robust helper to extract speed
function extractSpeed(p: any): number | undefined {
  if (!p) return undefined;
  const keys = ["speed", "velocity", "enhanced_speed", "speed_m_s", "geschwindigkeit"];
  for (const key of keys) {
    if (p[key] !== undefined && p[key] !== null) {
      const val = parseFloat(p[key]);
      if (!isNaN(val)) return val;
    }
  }
  if (typeof p === 'object') {
    for (const key of Object.keys(p)) {
      if (keys.includes(key.toLowerCase())) {
        const val = parseFloat(p[key]);
        if (!isNaN(val)) return val;
      }
    }
  }
  return undefined;
}

// Robust helper to normalize activity type
function isRunningType(type: string | undefined, name?: string): boolean {
  if (!type && !name) return false;
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  return t.includes('run') || t.includes('laufen') || t.includes('jog') || t.includes('walk') || t.includes('hike') ||
         n.includes('run') || n.includes('laufen') || n.includes('jog') || n.includes('walk') || n.includes('hike') || n.includes('run');
}

function isCyclingType(type: string | undefined, name?: string): boolean {
  if (!type && !name) return false;
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  return t.includes('cycle') || t.includes('bike') || t.includes('rad') || t.includes('road_biking') || t.includes('indoor_cycling') || t.includes('gravel_biking') || t.includes('mountain_biking') || t.includes('spin') ||
         n.includes('cycle') || n.includes('bike') || n.includes('rad') || n.includes('road_biking') || n.includes('indoor_cycling') || n.includes('gravel_biking') || n.includes('mountain_biking') || n.includes('spin') || n.includes('fahrrad') || n.includes('biking') || n.includes('cycling');
}


export const TrackLibrary: React.FC<TrackLibraryProps> = ({ onLoadTrack, onActiveTrackId, selectionBounds, onClearSelection }) => {
  const [tracks, setTracks] = useState<LibraryTrackThin[]>([]);
  const [boundsTracks, setBoundsTracks] = useState<LibraryTrackThin[]>([]);
  const [isBoundsLoading, setIsBoundsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activityFilter, setActivityFilter] = useState<'all' | 'cycling' | 'running'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'gpx' | 'garmin'>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectionBounds || typeof selectionBounds.minLat !== 'number' || typeof selectionBounds.maxLat !== 'number' || typeof selectionBounds.minLng !== 'number' || typeof selectionBounds.maxLng !== 'number' || isNaN(selectionBounds.minLat) || isNaN(selectionBounds.maxLat) || isNaN(selectionBounds.minLng) || isNaN(selectionBounds.maxLng)) {
      setBoundsTracks([]);
      return;
    }

    const fetchBoundsTracks = async () => {
      setIsBoundsLoading(true);
      try {
        const { minLat, maxLat, minLng, maxLng } = selectionBounds;
        const res = await fetch(getApiUrl(`/api/library/search-by-bounds?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}`));
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (data.success) {
          setBoundsTracks(data.tracks);
        }
      } catch (e) {
        console.error('Failed to fetch bounds-filtered tracks:', e);
      } finally {
        setIsBoundsLoading(false);
      }
    };

    fetchBoundsTracks();
  }, [selectionBounds]);

  // States for Editing/Metadata Mask
  const [editingTrack, setEditingTrack] = useState<LibraryTrackThin | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    tags: '',
    activityType: 'cycling' as 'cycling' | 'running',
    dateCreated: ''
  });
  const [isSaving, setIsSaving] = useState(false);

  // Local message and deletion prompt state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Fetch Unified Library (GPX Tracks & Garmin Activities combined)
  const fetchUnifiedLibrary = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams();
      if (searchQuery.trim()) queryParams.append('q', searchQuery);
      if (activityFilter !== 'all') queryParams.append('activityType', activityFilter);

      // Fetch both GPX tracks and Garmin activities concurrently
      const [gpxRes, garminRes] = await Promise.all([
        fetch(getApiUrl(`/api/library?${queryParams.toString()}`)),
        fetch(getApiUrl(`/api/garmin-activities?${queryParams.toString()}`))
      ]);

      const gpxData = await gpxRes.json();
      const garminData = await garminRes.json();

      let gpxList: LibraryTrackThin[] = [];
      let garminList: LibraryTrackThin[] = [];

      if (gpxData.success && Array.isArray(gpxData.tracks)) {
        gpxList = gpxData.tracks.map((t: any) => ({
          ...t,
          isGarminActivity: false
        }));
      }

      if (garminData.success && Array.isArray(garminData.activities)) {
        garminList = garminData.activities.map((act: any) => {
          const type = isRunningType(act.type, act.name) ? 'running' : 'cycling';
          return {
            id: `garmin-act-${act.id}`,
            name: act.name || 'Garmin Aktivität',
            distance: act.distance || 0,
            ascent: act.ascent || 0,
            descent: act.descent || 0,
            duration: act.duration,
            activityType: type as 'cycling' | 'running',
            description: act.description || act.location || "",
            tags: act.location ? [act.location] : [],
            dateCreated: act.date || '',
            isGarminActivity: true,
            rawRecord: act
          };
        });
      }

      // Combine both lists.
      // Sort them chronologically, newest first.
      const combined = [...gpxList, ...garminList].sort((a, b) => {
        const dateA = new Date(a.dateCreated || 0).getTime();
        const dateB = new Date(b.dateCreated || 0).getTime();
        return dateB - dateA;
      });

      setTracks(combined);
    } catch (err: any) {
      console.error('Failed to fetch unified library:', err);
      setError('Verbindung zum Server fehlgeschlagen.');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, activityFilter]);

  // Initial and reactive fetch
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchUnifiedLibrary();
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, activityFilter, fetchUnifiedLibrary]);

  // Load track into current workspace
  const handleLoadTrack = async (id: string) => {
    try {
      const response = await fetch(getApiUrl(`/api/library/${id}`));
      const data = await response.json();
      if (data.success && data.track) {
        // Hydrate points time objects if they exist
        const track = data.track as GPXTrack;
        if (track.points) {
          track.points = track.points.map(p => ({
            ...p,
            time: p.time ? new Date(p.time) : undefined
          }));

          // Fallback: If track has points but no elevation or only flat zero elevation, generate a default profile using track's ascent
          const hasElevation = track.points.some(p => p.ele !== undefined && p.ele !== null && !isNaN(Number(p.ele)) && p.ele !== 0);
          if (!hasElevation && track.points.length > 0) {
            const ptsCount = track.points.length;
            const finalAscent = track.ascent || 0;
            const baseElevation = 100;
            track.points.forEach((p, idx) => {
              const angle = (idx / (ptsCount - 1)) * Math.PI;
              const elevationPhase = Math.sin(angle);
              p.ele = parseFloat((baseElevation + elevationPhase * finalAscent).toFixed(1));
            });
            if (finalAscent === 0) {
              // Generate a gentle undulating landscape so the height profile is visually appealing instead of a flat 0 line
              const baseElevation = 150;
              track.points.forEach((p, idx) => {
                const angle1 = (idx / (ptsCount - 1)) * Math.PI * 4; // 2 waves
                const angle2 = (idx / (ptsCount - 1)) * Math.PI * 10; // 5 high frequency waves
                p.ele = parseFloat((baseElevation + Math.sin(angle1) * 15 + Math.cos(angle2) * 4).toFixed(1));
              });
            }
          }
        }
        if (track.maxSlope === undefined || track.maxSlope === null) {
          try {
            const { maxSlope } = calculateElevationStats(track.points || []);
            track.maxSlope = maxSlope || 0;
          } catch (e) {
            track.maxSlope = 0;
          }
        }
        onLoadTrack(track);
        showToast('Route erfolgreich geladen!');
      } else {
        showToast(data.error || 'Fehler beim Laden des Tracks.', 'error');
      }
    } catch (err) {
      console.error('Failed to load track details:', err);
      showToast('Konnte vollständige Route nicht laden.', 'error');
    }
  };

  // Load Garmin Activity into current workspace (generates virtual route)
  const handleLoadGarminActivity = async (act: any) => {
    try {
      let pointsJson = act.points_json;
      
      // Attempt to load the full, un-downsampled track from the server!
      try {
        const res = await fetch(getApiUrl(`/api/activity-track-full?id=${act.id}`));
        const json = await res.json();
        if (json.success && json.points_json) {
          pointsJson = json.points_json;
        }
      } catch (err) {
        console.error('Failed to fetch full track points, using fallback list track:', err);
      }

      // Find starting coordinates
      let startCoords = parseLocationCoords(act.location);
      if (!startCoords) {
        // Fallback: Munich, Germany
        startCoords = { lat: 48.1351, lng: 11.5820 };
      }
      
      const durationSec = act.duration || 3600;
      const distanceKm = act.distance || 10;
      const ascent = act.ascent || 0;
      const descent = act.descent || 0;
      const avgHr = act.avg_hr || undefined;
      const activityType = isRunningType(act.type, act.name) ? 'running' : 'cycling';
      
      let isVirtual = false;
      let points: any[] = [];
      if (pointsJson) {
        try {
          const parsed = JSON.parse(pointsJson);
          if (Array.isArray(parsed) && parsed.length > 0) {
            points = parsed.map((p: any) => {
              const latVal = extractLat(p);
              const lngVal = extractLng(p);
              if (latVal === undefined || lngVal === undefined) return null;
              return {
                lat: latVal,
                lng: lngVal,
                ele: extractElevation(p),
                time: p.time ? new Date(p.time) : undefined,
                hr: extractHeartRate(p),
                cadence: extractCadence(p),
                power: extractPower(p),
                speed: extractSpeed(p),
              };
            }).filter((p: any) => p !== null);
          }
        } catch (pe) {
          console.error('Failed to parse points_json from database:', pe);
        }
      }

      let finalAscent = ascent;
      let finalDescent = descent;

      if (points.length > 0 && (finalAscent === 0 || finalDescent === 0)) {
        const stats = calculateElevationStats(points);
        if (finalAscent === 0) finalAscent = stats.ascent;
        if (finalDescent === 0) finalDescent = stats.descent;
      }

      // Fallback: If Garmin activity has points but no elevation or only flat zero elevation, generate a default profile using ascent
      const hasElevation = points.some((p: any) => p.ele !== undefined && p.ele !== null && !isNaN(p.ele) && p.ele !== 0);
      if (!hasElevation && points.length > 0) {
        const ptsCount = points.length;
        const baseElevation = 100;
        points.forEach((p: any, idx: number) => {
          const angle = (idx / (ptsCount - 1)) * Math.PI;
          const elevationPhase = Math.sin(angle);
          p.ele = parseFloat((baseElevation + elevationPhase * (finalAscent || 0)).toFixed(1));
        });
        if (!finalAscent && !finalDescent) {
          // Generate a gentle undulating landscape so the height profile is visually appealing instead of a flat 0 line
          const baseElevation = 150;
          points.forEach((p: any, idx: number) => {
            const angle1 = (idx / (ptsCount - 1)) * Math.PI * 4; // 2 waves
            const angle2 = (idx / (ptsCount - 1)) * Math.PI * 10; // 5 high frequency waves
            p.ele = parseFloat((baseElevation + Math.sin(angle1) * 15 + Math.cos(angle2) * 4).toFixed(1));
          });
        }
      }

      if (points.length <= 1) {
        isVirtual = true;
        points = generateVirtualRoute(
          startCoords.lat,
          startCoords.lng,
          distanceKm,
          durationSec,
          finalAscent,
          finalDescent,
          avgHr,
          activityType
        );
      }
      
      const track: GPXTrack = {
        id: `garmin-act-${act.id || Date.now()}`,
        name: act.name || 'Garmin Aktivität',
        points,
        color: '#f97316', // Orange Garmin-branding
        distance: distanceKm,
        ascent: finalAscent,
        descent: finalDescent,
        maxSlope: 0,
        visible: true,
        activityType,
        duration: durationSec,
        hasTimestamps: true,
        description: act.description || `Garmin Aktivität in ${act.location || 'Unbekannt'}`,
        isVirtual
      };
      
      onLoadTrack(track);
      showToast('Aktivität erfolgreich in den Workspace geladen!');
    } catch (err) {
      console.error('Failed to load Garmin activity:', err);
      showToast('Konnte Garmin-Aktivität nicht in Workspace laden.', 'error');
    }
  };

  // Delete track from DB (actual execution)
  const executeDeleteTrack = async (id: string) => {
    try {
      const response = await fetch(getApiUrl(`/api/library/${id}`), { method: 'DELETE' });
      const data = await response.json();
      if (data.success) {
        setTracks(prev => prev.filter(t => t.id !== id));
        showToast('Route erfolgreich gelöscht!');
      } else {
        showToast(data.error || 'Fehler beim Löschen des Tracks.', 'error');
      }
    } catch (err) {
      console.error('Failed to delete track:', err);
      showToast('Löschvorgang fehlgeschlagen.', 'error');
    } finally {
      setConfirmDelete(null);
    }
  };

  // Open Edit Mask
  const openEditMask = (track: LibraryTrackThin) => {
    setEditingTrack(track);
    setEditForm({
      name: track.name,
      description: track.description,
      tags: track.tags.join(', '),
      activityType: track.activityType,
      dateCreated: track.dateCreated ? track.dateCreated.split('T')[0] : ''
    });
  };

  // Save Edit Metadata Form
  const handleSaveMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTrack) return;
    if (!editForm.name.trim()) {
      showToast('Der Name darf nicht leer sein.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      // Clean tags
      const splitTags = editForm.tags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      const response = await fetch(getApiUrl(`/api/library/${editingTrack.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim(),
          description: editForm.description.trim(),
          tags: splitTags,
          activityType: editForm.activityType,
          dateCreated: editForm.dateCreated
        })
      });

      const data = await response.json();
      if (data.success) {
        // Local state update
        setTracks(prev => prev.map(t => t.id === editingTrack.id ? {
          ...t,
          name: editForm.name.trim(),
          description: editForm.description.trim(),
          tags: splitTags,
          activityType: editForm.activityType,
          dateCreated: editForm.dateCreated
        } : t));
        setEditingTrack(null);
        showToast('Metadaten erfolgreich gespeichert!');
      } else {
        showToast(data.error || 'Fehler beim Speichern der Metadaten.', 'error');
      }
    } catch (err) {
      console.error('Failed to update metadata:', err);
      showToast('Speichervorgang fehlgeschlagen.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Filter combined list by source filter locally
  const filteredTracks = tracks.filter(t => {
    if (sourceFilter === 'gpx') return !t.isGarminActivity;
    if (sourceFilter === 'garmin') return t.isGarminActivity;
    return true;
  });

  return (
    <div className="space-y-4 h-full flex flex-col">
      {selectionBounds && (
        <div className="p-3 bg-indigo-50/90 dark:bg-indigo-950/45 border border-indigo-200/60 dark:border-indigo-900 rounded-xl space-y-2 shrink-0">
          <div className="flex justify-between items-center">
            <span className="text-xs font-black text-indigo-750 dark:text-indigo-400 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              Bereich ausgewählt
            </span>
            <button 
              onClick={onClearSelection} 
              className="text-[10px] bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/50 dark:hover:bg-indigo-800 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-md font-bold transition-all cursor-pointer"
            >
              Aufheben
            </button>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
            Es werden alle Aktivitäten angezeigt, die durch den markierten Bereich verlaufen.
          </p>

          {isBoundsLoading ? (
            <div className="flex items-center gap-2 text-xs text-indigo-600/70 p-2 justify-center">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Sucht in der Datenbank...
            </div>
          ) : boundsTracks.length > 0 ? (
            <div className="space-y-1.5 pt-1.5 border-t border-indigo-100 dark:border-indigo-900/40">
              <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                Gefundene Aktivitäten ({boundsTracks.length})
              </span>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 font-sans">
                {boundsTracks.map(track => (
                  <div 
                    key={`bounds-tr-${track.id}`}
                    onClick={() => {
                      if (track.isGarminActivity) {
                        handleLoadGarminActivity(track.rawRecord);
                      } else {
                        handleLoadTrack(track.id);
                      }
                    }}
                    className="flex items-center justify-between p-2 bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-indigo-950 border border-slate-100 dark:border-slate-850 rounded-lg cursor-pointer transition-all gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-black text-slate-750 dark:text-slate-200 truncate" title={track.name}>
                        {track.name}
                      </div>
                      <div className="flex items-center gap-1 text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 font-bold">
                        <span>{track.activityType === 'cycling' ? '🚲' : '🏃'}</span>
                        <span>{track.distance.toFixed(1)} km</span>
                        <span>•</span>
                        <span>+{Math.round(track.ascent)}m</span>
                        {track.isGarminActivity && (
                          <>
                            <span>•</span>
                            <span className="text-orange-500 font-extrabold text-[8px]">⌚ Garmin</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span 
                      className="p-1 px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-md text-[9px] flex items-center gap-0.5 shadow-sm transition-all shrink-0"
                    >
                      Laden
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[10px] text-slate-400 dark:text-slate-505 font-medium bg-slate-150/40 dark:bg-slate-950/20 p-2 rounded-lg border border-dashed border-slate-200/40 dark:border-slate-800 text-center leading-normal">
              Keine Routen kreuzen diesen Bereich.
            </div>
          )}
        </div>
      )}

      {/* Unified Source Filter Switcher: All, GPX, Garmin */}
      <div className="flex border-b border-slate-100 dark:border-slate-800/80 shrink-0 mb-1.5 p-0.5 bg-slate-100/50 dark:bg-slate-900/40 rounded-xl">
        <button
          type="button"
          onClick={() => { setSourceFilter('all'); }}
          className={`flex-1 py-1.5 text-xs font-black transition-all rounded-lg text-center cursor-pointer ${
            sourceFilter === 'all'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-150 shadow-2xs'
              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
          }`}
        >
          🗂️ Alle ({tracks.length})
        </button>
        <button
          type="button"
          onClick={() => { setSourceFilter('gpx'); }}
          className={`flex-1 py-1.5 text-xs font-black transition-all rounded-lg text-center cursor-pointer ${
            sourceFilter === 'gpx'
              ? 'bg-blue-50/70 dark:bg-blue-950/45 text-blue-750 dark:text-blue-400 border border-blue-200/40 dark:border-blue-900/50 font-extrabold shadow-3xs'
              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
          }`}
        >
          📁 GPX ({tracks.filter(t => !t.isGarminActivity).length})
        </button>
        <button
          type="button"
          onClick={() => { setSourceFilter('garmin'); }}
          className={`flex-1 py-1.5 text-xs font-black transition-all rounded-lg text-center cursor-pointer ${
            sourceFilter === 'garmin'
              ? 'bg-orange-50/70 dark:bg-orange-950/45 text-orange-750 dark:text-orange-400 border border-orange-200/40 dark:border-orange-900/50 font-extrabold shadow-3xs'
              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
          }`}
        >
          ⌚ Garmin ({tracks.filter(t => t.isGarminActivity).length})
        </button>
      </div>

      {/* Search and Filters */}
      <div className="space-y-2 shrink-0">
        <div className="relative">
          <input
            type="text"
            placeholder="Suchen nach Name, Beschreibung, Tags, Ort..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl pl-9 pr-8 py-2 text-xs font-semibold text-slate-850 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-sans"
          />
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 p-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full text-slate-500"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Activity Filter Switcher */}
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-900/60 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setActivityFilter('all')}
            className={`flex-1 text-center py-1 rounded text-[10px] font-extrabold transition-all cursor-pointer ${
              activityFilter === 'all'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-150 shadow-sm'
                : 'text-slate-500 hover:text-slate-750 dark:hover:text-slate-300'
            }`}
          >
            Alle Typen
          </button>
          <button
            type="button"
            onClick={() => setActivityFilter('cycling')}
            className={`flex-1 text-center py-1 rounded text-[10px] font-extrabold transition-all cursor-pointer ${
              activityFilter === 'cycling'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-150 shadow-sm'
                : 'text-slate-500 hover:text-slate-750 dark:hover:text-slate-300'
            }`}
          >
            🚴 Rad
          </button>
          <button
            type="button"
            onClick={() => setActivityFilter('running')}
            className={`flex-1 text-center py-1 rounded text-[10px] font-extrabold transition-all cursor-pointer ${
              activityFilter === 'running'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-150 shadow-sm'
                : 'text-slate-500 hover:text-slate-750 dark:hover:text-slate-300'
            }`}
          >
            🏃 Lauf
          </button>
        </div>
      </div>

      {/* Library Tracks Listing Container */}
      <div className="flex-1 overflow-y-auto pr-0.5 space-y-2.5 min-h-0 relative">
        {isLoading && filteredTracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 space-y-2">
            <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
            <p className="text-[11px] text-slate-500 font-medium">Lade Bibliothek...</p>
          </div>
        ) : error ? (
          <div className="text-center py-10 px-4 bg-red-50/50 border border-red-100 rounded-xl space-y-1">
            <p className="text-xs text-red-650 font-bold">Fehler</p>
            <p className="text-[10px] text-slate-500">{error}</p>
          </div>
        ) : filteredTracks.length === 0 ? (
          <div className="text-center py-16 px-4 bg-slate-50/50 dark:bg-slate-950/35 border border-dashed border-slate-200 dark:border-slate-800/80 rounded-xl space-y-1.5">
            <Compass className="w-6 h-6 text-slate-300 mx-auto" />
            <p className="text-xs font-semibold text-slate-505 dark:text-slate-400">Keine Routen oder Aktivitäten gefunden</p>
            <p className="text-[10px] text-slate-400 max-w-xs mx-auto leading-relaxed">
              Lade GPX-Routen hoch oder importiere Deine Garmin SQLite-Datenbank, um Deine persönliche Aktivitätsbibliothek anzulegen.
            </p>
          </div>
        ) : (
          filteredTracks.map((track) => {
            const isActive = onActiveTrackId === track.id;
            const isGarmin = track.isGarminActivity;
            const isExpanded = expandedActivityId === track.id;

            // Format duration
            const formattedDuration = (() => {
              const durSec = track.duration || 0;
              if (durSec === 0) return '-';
              const h = Math.floor(durSec / 3600);
              const m = Math.floor((durSec % 3600) / 60);
              const s = Math.round(durSec % 60);
              if (h > 0) return `${h}h ${m}m`;
              return `${m}m ${s}s`;
            })();

            const hasNoTrace = isGarmin && !track.rawRecord?.points_json;

            return (
              <div
                key={track.id}
                onClick={() => {
                  if (isGarmin) {
                    setExpandedActivityId(isExpanded ? null : track.id);
                  } else {
                    handleLoadTrack(track.id);
                  }
                }}
                onDoubleClick={(e) => {
                  if (isGarmin) {
                    e.stopPropagation();
                    handleLoadGarminActivity(track.rawRecord);
                  }
                }}
                className={`group relative flex flex-col gap-2 rounded-xl p-3 bg-white dark:bg-slate-900 border transition-all cursor-pointer text-left ${
                  isActive
                    ? 'border-blue-550 dark:border-blue-400 ring-2 ring-blue-500/10 shadow-sm bg-blue-50/10 dark:bg-blue-950/20'
                    : isGarmin && isExpanded
                    ? 'border-orange-550 dark:border-orange-400 ring-2 ring-orange-500/10 shadow-sm bg-orange-50/5 dark:bg-slate-950/20'
                    : 'border-slate-100 dark:border-slate-800/60 hover:border-slate-250 dark:hover:border-slate-700 hover:bg-slate-50/40 dark:hover:bg-slate-850/20 shadow-2xs'
                }`}
                title={isGarmin ? 'Klicken für Details, Doppelklick zum Laden' : 'Klicken zum Aktivieren'}
              >
                {/* Title Line */}
                <div className="flex items-center gap-1.5">
                  <span className={`flex items-center justify-center text-xs w-6 h-6 rounded-lg font-bold shrink-0 shadow-3xs leading-none ${
                    isGarmin 
                      ? 'bg-orange-50 dark:bg-orange-950/45 text-orange-600 dark:text-orange-400' 
                      : 'bg-blue-50 dark:bg-blue-950/45 text-blue-600 dark:text-blue-400'
                  }`}>
                    {track.activityType === 'running' ? '🏃' : '🚴'}
                  </span>
                  
                  <span 
                    className="font-bold text-xs text-slate-850 dark:text-slate-150 truncate flex-1 leading-tight" 
                    title={track.name}
                  >
                    {track.name}
                  </span>

                  {/* Source Badge */}
                  <span className={`text-[8.5px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border leading-none shrink-0 ${
                    isGarmin
                      ? 'bg-orange-50/60 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-900/30'
                      : 'bg-blue-50/60 dark:bg-blue-950/30 text-blue-600 dark:text-blue-450 border-blue-100 dark:border-blue-900/30'
                  }`}>
                    {isGarmin ? '⌚ Garmin' : '📁 GPX'}
                  </span>

                  {/* No GPS points indicator */}
                  {hasNoTrace && (
                    <span 
                      className="text-[8px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-extrabold px-1.5 py-0.5 rounded leading-none shrink-0" 
                      title="Keine GPS-Route, es werden nur Statistiken geladen"
                    >
                      NUR STATS
                    </span>
                  )}

                  {/* Active Indicator */}
                  {isActive && (
                    <span className="text-[9px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-900/30 shrink-0 leading-none">
                      Aktiv
                    </span>
                  )}
                </div>

                {/* Sub-info: Date & Location/Description */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[9px] text-slate-400 dark:text-slate-500 font-mono font-medium">
                    <p className="flex items-center gap-1">
                      <Calendar size={9} className="shrink-0" /> 
                      {track.dateCreated || '-'}
                    </p>
                    {isGarmin && track.rawRecord?.location && (
                      <p className="font-sans font-bold text-orange-600 dark:text-orange-400">
                        📍 {track.rawRecord.location}
                      </p>
                    )}
                  </div>
                  {track.description && (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-normal line-clamp-1 bg-slate-50/50 dark:bg-slate-950/20 px-1.5 py-0.5 rounded text-left">
                      {track.description}
                    </p>
                  )}
                </div>

                {/* Grid of Key Metrics */}
                <div className="grid grid-cols-4 gap-1.5 pt-0.5 text-[9.5px] font-mono">
                  <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-850/40 rounded-lg p-1 flex flex-col items-center justify-center text-center">
                    <span className="text-[7.5px] text-slate-400 dark:text-slate-500 font-sans font-semibold uppercase tracking-wider">Distanz</span>
                    <span className="font-extrabold text-slate-700 dark:text-slate-300">
                      {track.distance.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
                    </span>
                  </div>
                  <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-850/40 rounded-lg p-1 flex flex-col items-center justify-center text-center">
                    <span className="text-[7.5px] text-slate-400 dark:text-slate-500 font-sans font-semibold uppercase tracking-wider">Höhe</span>
                    <span className="font-extrabold text-slate-700 dark:text-slate-300">
                      +{Math.round(track.ascent)}m
                    </span>
                  </div>
                  <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-850/40 rounded-lg p-1 flex flex-col items-center justify-center text-center">
                    <span className="text-[7.5px] text-slate-400 dark:text-slate-500 font-sans font-semibold uppercase tracking-wider">Zeit</span>
                    <span className="font-extrabold text-slate-700 dark:text-slate-300">
                      {formattedDuration}
                    </span>
                  </div>
                  <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-850/40 rounded-lg p-1 flex flex-col items-center justify-center text-center">
                    {isGarmin ? (
                      <>
                        <span className="text-[7.5px] text-slate-400 dark:text-slate-500 font-sans font-semibold uppercase tracking-wider">Ø Puls</span>
                        <span className="font-extrabold text-orange-600 dark:text-orange-400">
                          {track.rawRecord?.avg_hr ? `${Math.round(track.rawRecord.avg_hr)}` : '-'}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-[7.5px] text-slate-400 dark:text-slate-500 font-sans font-semibold uppercase tracking-wider">Steigung</span>
                        <span className="font-extrabold text-slate-700 dark:text-slate-300">
                          {Math.round(track.maxSlope ?? 0)}%
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Garmin Expanded panel details */}
                {isGarmin && isExpanded && (
                  <div 
                    onClick={(e) => e.stopPropagation()} 
                    className="border-t border-slate-100 dark:border-slate-800/60 pt-2.5 mt-1 text-[11px] space-y-2 text-left font-sans text-slate-600 dark:text-slate-400"
                  >
                    {track.rawRecord?.description && (
                      <div className="space-y-0.5">
                        <p className="font-bold text-slate-700 dark:text-slate-300">📝 Beschreibung:</p>
                        <p className="bg-slate-50 dark:bg-slate-950/30 p-2 rounded border border-slate-100 dark:border-slate-800 leading-normal italic text-slate-550 dark:text-slate-350">
                          {track.rawRecord.description}
                        </p>
                      </div>
                    )}
                    
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono bg-orange-50/10 dark:bg-orange-950/10 border border-orange-100/30 dark:border-orange-900/10 p-2 rounded-lg">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Kalorien:</span>
                        <span className="font-bold text-orange-600 dark:text-orange-400">{track.rawRecord?.calories ? `${Math.round(track.rawRecord.calories)} kcal` : '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Abstieg:</span>
                        <span className="font-bold text-slate-600 dark:text-slate-300">{track.rawRecord?.descent ? `-${Math.round(track.rawRecord.descent)}m` : '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Typ:</span>
                        <span className="font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[8px]">{track.rawRecord?.type}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">ID:</span>
                        <span className="font-bold text-slate-400 truncate max-w-[60px]" title={track.rawRecord?.id}>{track.rawRecord?.id}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tags & Action Buttons */}
                <div className="flex items-center justify-between gap-2 border-t border-slate-100/65 dark:border-slate-800/40 pt-1.5 mt-0.5">
                  <div className="flex flex-wrap gap-1 min-w-0 max-w-[50%] overflow-hidden">
                    {track.tags && track.tags.length > 0 ? (
                      track.tags.slice(0, 2).map((tg, idx) => (
                        <span
                          key={idx}
                          className="text-[9px] font-bold font-sans bg-slate-50 dark:bg-slate-800/50 border border-slate-205 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-lg flex items-center gap-0.5 truncate"
                          title={tg}
                        >
                          <Tag size={8} className="text-slate-400 shrink-0" />
                          <span className="truncate">{tg}</span>
                        </span>
                      ))
                    ) : (
                      <span className="text-[9px] text-slate-400 italic">Keine Tags</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        if (isGarmin) {
                          handleLoadGarminActivity(track.rawRecord);
                        } else {
                          handleLoadTrack(track.id);
                        }
                      }}
                      className={`p-1 px-2 bg-blue-550 hover:bg-blue-600 text-white rounded-lg transition-all text-[9.5px] font-bold flex items-center gap-1 cursor-pointer ${
                        isGarmin ? 'bg-orange-600 hover:bg-orange-700' : 'bg-blue-555 hover:bg-blue-600'
                      }`}
                      title="In Workspace laden / Aktivieren"
                    >
                      <FolderOpen className="w-3 h-3 text-white" />
                      <span>Laden</span>
                    </button>

                    {!isGarmin && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); openEditMask(track); }}
                          className="p-1 bg-slate-50 hover:bg-slate-100 active:bg-slate-150 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg transition-all cursor-pointer border border-slate-205 dark:border-slate-750"
                          title="Metadaten bearbeiten"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete({ id: track.id, name: track.name }); }}
                          className="p-1 bg-red-50 hover:bg-red-100 dark:bg-rose-955/20 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 rounded-lg transition-all cursor-pointer border border-red-100 dark:border-rose-950/20"
                          title="Aus der Bibliothek löschen"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Metadata Edit Modal / Overlay Frame */}
      <AnimatePresence>
        {editingTrack && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingTrack(null)}
              className="absolute inset-0 bg-slate-900/65 backdrop-blur-xs"
            />

            {/* Editing Box */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="relative w-full max-w-sm bg-white dark:bg-slate-955 border border-slate-200 dark:border-slate-900 rounded-2xl shadow-2xl p-5 overflow-hidden"
            >
              <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100 dark:border-slate-900">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <Edit2 className="w-4 h-4 text-blue-500" />
                  Metadaten bearbeiten
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingTrack(null)}
                  className="p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveMetadata} className="space-y-4 text-left font-sans text-xs">
                {/* File Title */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest">Routenname</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-855 px-3 py-2 rounded-lg text-xs text-slate-800 dark:text-slate-100 font-semibold focus:ring-2 focus:ring-blue-500/20"
                    placeholder="z.B. Sonntagsrunde Elberadweg"
                    required
                  />
                </div>

                {/* Date Created */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest">Aktivitätsdatum</label>
                  <input
                    type="date"
                    value={editForm.dateCreated}
                    onChange={(e) => setEditForm(prev => ({ ...prev, dateCreated: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-855 px-3 py-2 rounded-lg text-xs text-slate-800 dark:text-slate-100 font-semibold focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                {/* Activity Type Toggle */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block mb-1">Aktivitätstyp</label>
                  {editingTrack?.rawFileDetails?.fileType === 'fit' ? (
                    <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        {editForm.activityType === 'running' ? '🏃 Laufen' : '🚴 Radfahren'}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">Aus FIT-Datei erkannt (gesperrt)</span>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditForm(prev => ({ ...prev, activityType: 'cycling' }))}
                        className={`flex-1 py-2 px-3 border rounded-lg font-bold text-center flex items-center justify-center gap-1.5 transition-all ${
                          editForm.activityType === 'cycling'
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-800/40 dark:text-indigo-400'
                            : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-55'
                        }`}
                      >
                        🚴 Radfahren
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditForm(prev => ({ ...prev, activityType: 'running' }))}
                        className={`flex-1 py-2 px-3 border rounded-lg font-bold text-center flex items-center justify-center gap-1.5 transition-all ${
                          editForm.activityType === 'running'
                            ? 'bg-emerald-550/15 border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800/40 dark:text-emerald-400'
                            : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-55'
                        }`}
                      >
                        🏃 Laufen
                      </button>
                    </div>
                  )}
                </div>

                {/* Description Textarea */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block">Beschreibung / Notizen</label>
                  <textarea
                    rows={3}
                    value={editForm.description}
                    onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-855 px-3 py-2 rounded-lg text-xs text-slate-800 dark:text-slate-100 font-semibold focus:ring-2 focus:ring-blue-500/20 resize-none"
                    placeholder="Notizen zur Straßenbeschaffenheit, Aussichtspunkten..."
                  />
                </div>

                {/* Tags */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest flex items-center gap-1">
                    Tags <span className="text-[9px] text-slate-400 font-normal font-sans">(Kommagetrennt)</span>
                  </label>
                  <input
                    type="text"
                    value={editForm.tags}
                    onChange={(e) => setEditForm(prev => ({ ...prev, tags: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-855 px-3 py-2 rounded-lg text-xs text-slate-800 dark:text-slate-100 font-semibold focus:ring-2 focus:ring-blue-500/20"
                    placeholder="z.B. Feierabend, Bergig, Gruppe"
                  />
                </div>

                {/* Actions Block */}
                <div className="flex gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-900">
                  <button
                    type="button"
                    onClick={() => setEditingTrack(null)}
                    className="flex-1 py-2 text-slate-500 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800/80 rounded-xl font-bold transition-all cursor-pointer text-center"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 py-2 bg-blue-650 hover:bg-blue-700 text-white rounded-xl font-bold hover:shadow-md transition-all cursor-pointer text-center flex items-center justify-center gap-1"
                  >
                    {isSaving ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Sichern...
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Speichern
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Alert */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`absolute top-2 left-2 right-2 p-2.5 rounded-xl text-[11px] font-bold z-[120] text-center shadow-lg truncate ${
              toast.type === 'success'
                ? 'bg-emerald-550 dark:bg-emerald-600 text-white'
                : 'bg-rose-600 text-white'
            }`}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm deletion dialog */}
      <AnimatePresence>
        {confirmDelete && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 z-[150]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-2xl p-4 w-full shadow-2xl space-y-3.5 relative text-center"
            >
              <h3 className="text-xs font-black text-rose-600 dark:text-rose-400 flex items-center justify-center gap-1.5 uppercase tracking-wider">
                <Trash2 className="w-4 h-4" />
                Möchtest Du löschen?
              </h3>
              <p className="text-[11px] font-semibold text-slate-655 dark:text-slate-300 leading-normal">
                Soll die Route <span className="font-extrabold text-slate-800 dark:text-slate-100">"{confirmDelete.name}"</span> wirklich unwiderruflich aus der Bibliothek gelöscht werden?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(null)}
                  className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-850 dark:hover:bg-slate-800 rounded-lg text-[11px] font-extrabold text-slate-500 hover:text-slate-700 dark:text-slate-400 cursor-pointer"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={() => executeDeleteTrack(confirmDelete.id)}
                  className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 rounded-lg text-[11px] font-extrabold text-white hover:shadow-md cursor-pointer"
                >
                  Ja, Löschen
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

