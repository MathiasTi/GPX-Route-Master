import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, FolderOpen, Calendar, Tag, Activity, X, Check, RefreshCw, Compass, ArrowLeftRight, Navigation, MapPin } from 'lucide-react';
import { GPXTrack } from '../types';
import { getApiUrl } from '../utils/api';
import { calculateElevationStats } from '../utils/gpxUtils';

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
}

export const TrackLibrary: React.FC<TrackLibraryProps> = ({ onLoadTrack, onActiveTrackId, selectionBounds, onClearSelection }) => {
  const [tracks, setTracks] = useState<LibraryTrackThin[]>([]);
  const [boundsTracks, setBoundsTracks] = useState<LibraryTrackThin[]>([]);
  const [isBoundsLoading, setIsBoundsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activityFilter, setActivityFilter] = useState<'all' | 'cycling' | 'running'>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectionBounds) {
      setBoundsTracks([]);
      return;
    }

    const fetchBoundsTracks = async () => {
      setIsBoundsLoading(true);
      try {
        const { minLat, maxLat, minLng, maxLng } = selectionBounds;
        const res = await fetch(getApiUrl(`/api/library/search-by-bounds?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}`));
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

  // Fetch Library Tracks
  const fetchLibrary = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams();
      if (searchQuery.trim()) queryParams.append('q', searchQuery);
      if (activityFilter !== 'all') queryParams.append('activityType', activityFilter);

      const response = await fetch(getApiUrl(`/api/library?${queryParams.toString()}`));
      const data = await response.json();
      if (data.success) {
        setTracks(data.tracks);
      } else {
        setError(data.error || 'Fehler beim Laden der Bibliothek.');
      }
    } catch (err: any) {
      console.error('Failed to fetch library:', err);
      setError('Verbindung zum Server fehlgeschlagen.');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, activityFilter]);

  // Initial and reactive fetch
  useEffect(() => {
    // Basic debounce for search input
    const timer = setTimeout(() => {
      fetchLibrary();
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, activityFilter, fetchLibrary]);

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
                    onClick={() => handleLoadTrack(track.id)}
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
      {/* Search and Filters */}
      <div className="space-y-2.5 shrink-0">
        <div className="relative">
          <input
            type="text"
            placeholder="Suchen nach Name, Beschreibung, Tags..."
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
            className={`flex-1 text-center py-1 rounded text-[10px] font-extrabold transition-all ${
              activityFilter === 'all'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-150 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Alle
          </button>
          <button
            type="button"
            onClick={() => setActivityFilter('cycling')}
            className={`flex-1 text-center py-1 rounded text-[10px] font-extrabold transition-all ${
              activityFilter === 'cycling'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-150 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            🚴 Rad
          </button>
          <button
            type="button"
            onClick={() => setActivityFilter('running')}
            className={`flex-1 text-center py-1 rounded text-[10px] font-extrabold transition-all ${
              activityFilter === 'running'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-150 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            🏃 Lauf
          </button>
        </div>
      </div>

      {/* Library Tracks Listing Container */}
      <div className="flex-1 overflow-y-auto pr-0.5 space-y-2.5 min-h-0 relative">
        {isLoading && tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 space-y-2">
            <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
            <p className="text-[11px] text-slate-500 font-medium">Lade Bibliothek...</p>
          </div>
        ) : error ? (
          <div className="text-center py-10 px-4 bg-red-50/50 border border-red-100 rounded-xl space-y-1">
            <p className="text-xs text-red-650 font-bold">Fehler</p>
            <p className="text-[10px] text-slate-500">{error}</p>
          </div>
        ) : tracks.length === 0 ? (
          <div className="text-center py-16 px-4 bg-slate-50/50 dark:bg-slate-950/35 border border-dashed border-slate-200 dark:border-slate-800/80 rounded-xl space-y-1.5">
            <Compass className="w-6 h-6 text-slate-300 mx-auto" />
            <p className="text-xs font-semibold text-slate-505 dark:text-slate-400">Keine Routen gefunden</p>
            <p className="text-[10px] text-slate-400 max-w-xs mx-auto">
              Lade eine Route hoch und speichere sie, um Deine persönliche Bibliothek anzulegen.
            </p>
          </div>
        ) : (
          tracks.map((track) => {
            const isActive = onActiveTrackId === track.id;
            return (
              <div
                key={track.id}
                onClick={() => handleLoadTrack(track.id)}
                className={`group relative flex flex-col gap-2 rounded-xl p-3 bg-white dark:bg-slate-900 border transition-all cursor-pointer ${
                  isActive
                    ? 'border-blue-550 dark:border-blue-400 ring-2 ring-blue-500/10 shadow-sm bg-blue-50/10 dark:bg-blue-950/20'
                    : 'border-slate-100 dark:border-slate-800/60 hover:border-slate-250 dark:hover:border-slate-700 hover:bg-slate-50/40 dark:hover:bg-slate-850/20 shadow-2xs'
                }`}
              >
                {/* Title Line: Icon Badge + Name */}
                <div className="flex items-center gap-2">
                  <span className="flex items-center justify-center text-xs w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold shrink-0 shadow-3xs leading-none">
                    {track.activityType === 'running' ? '🏃' : '🚴'}
                  </span>
                  <span 
                    className="font-bold text-xs text-slate-800 dark:text-slate-150 truncate flex-1 leading-tight" 
                    title={track.name}
                  >
                    {track.name}
                  </span>
                  
                  {/* Active Badge indicator */}
                  {isActive && (
                    <span className="text-[9px] font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/40 shrink-0">
                      Aktiv
                    </span>
                  )}
                </div>

                {/* Subinfo Line: Date Created & Description Excerpt */}
                <div className="flex flex-col gap-1">
                  {track.dateCreated && (
                    <p className="text-[9px] text-slate-400 dark:text-slate-500 flex items-center gap-1 font-mono font-medium">
                      <Calendar size={9} className="text-slate-400 shrink-0" /> 
                      {track.dateCreated}
                    </p>
                  )}
                  {track.description && (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-normal line-clamp-1 bg-slate-50/50 dark:bg-slate-950/20 px-1.5 py-0.5 rounded text-left">
                      {track.description}
                    </p>
                  )}
                </div>

                {/* Compact Stats Row: Distance, elevation, slope */}
                <div className="grid grid-cols-3 gap-1.5 pt-0.5 text-[10px] font-mono">
                  <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-850/40 rounded-lg px-1.5 py-0.5 flex flex-col items-center justify-center">
                    <span className="text-[8px] text-slate-400 dark:text-slate-500 font-sans font-semibold uppercase tracking-wider">Länge</span>
                    <span className="font-extrabold text-slate-700 dark:text-slate-300">
                      {track.distance.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
                    </span>
                  </div>
                  <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-850/40 rounded-lg px-1.5 py-0.5 flex flex-col items-center justify-center">
                    <span className="text-[8px] text-slate-400 dark:text-slate-500 font-sans font-semibold uppercase tracking-wider">Höhe</span>
                    <span className="font-extrabold text-slate-700 dark:text-slate-300 flex items-center">
                      +{Math.round(track.ascent)}m
                    </span>
                  </div>
                  <div className="bg-slate-50/60 dark:bg-slate-950/30 border border-slate-100/40 dark:border-slate-850/40 rounded-lg px-1.5 py-0.5 flex flex-col items-center justify-center">
                    <span className="text-[8px] text-slate-400 dark:text-slate-500 font-sans font-semibold uppercase tracking-wider">Steigung</span>
                    <span className="font-extrabold text-slate-700 dark:text-slate-300">
                      {Math.round(track.maxSlope ?? 0)}%
                    </span>
                  </div>
                </div>

                {/* Footer Line: Tags list & Compact Action Tools */}
                <div className="flex items-center justify-between gap-2 border-t border-slate-100/60 dark:border-slate-800/40 pt-1.5 mt-0.5">
                  {/* Tags on Left */}
                  <div className="flex flex-wrap gap-1 min-w-0 max-w-[50%] overflow-hidden">
                    {track.tags && track.tags.length > 0 ? (
                      track.tags.slice(0, 2).map((tg, idx) => (
                        <span
                          key={idx}
                          className="text-[9px] font-bold font-sans bg-slate-50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-lg flex items-center gap-0.5 truncate"
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

                  {/* Actions on Right */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleLoadTrack(track.id); }}
                      className="p-1 px-1.5 bg-blue-550 hover:bg-blue-600 text-white rounded-lg transition-all text-[9.5px] font-bold flex items-center gap-1 cursor-pointer"
                      title="In Workspace laden / Aktivieren"
                    >
                      <FolderOpen className="w-3 h-3 text-white" />
                      <span>Laden</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openEditMask(track); }}
                      className="p-1 bg-slate-50 hover:bg-slate-100 active:bg-slate-150 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg transition-all cursor-pointer border border-slate-205"
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
              className="relative w-full max-w-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-900 rounded-2xl shadow-2xl p-5 overflow-hidden"
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
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 px-3 py-2 rounded-lg text-xs text-slate-800 dark:text-slate-100 font-semibold focus:ring-2 focus:ring-blue-500/20"
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
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 px-3 py-2 rounded-lg text-xs text-slate-800 dark:text-slate-100 font-semibold focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                {/* Activity Type Toggle */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block mb-1">Aktivitätstyp</label>
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
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800/40 dark:text-emerald-400'
                          : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-55'
                      }`}
                    >
                      🏃 Laufen
                    </button>
                  </div>
                </div>

                {/* Description Textarea */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block">Beschreibung / Notizen</label>
                  <textarea
                    rows={3}
                    value={editForm.description}
                    onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 px-3 py-2 rounded-lg text-xs text-slate-800 dark:text-slate-100 font-semibold focus:ring-2 focus:ring-blue-500/20 resize-none"
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
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 px-3 py-2 rounded-lg text-xs text-slate-800 dark:text-slate-100 font-semibold focus:ring-2 focus:ring-blue-500/20"
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
