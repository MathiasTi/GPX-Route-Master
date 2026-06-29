
import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Map from './components/Map';
import Map3D from './components/Map3D';
import ElevationProfile from './components/ElevationProfile';
import { Activity, BarChart2, Menu } from 'lucide-react';
import { GPXTrack, GPXPoint, MapLayer, TextMarker } from './types';
import { parseGPX, mergeTracks, validateGPX, calculatePowerStats, calculateDistance } from './utils/gpxUtils';
import { parseFIT } from './utils/fitUtils';
import { unzipSync } from 'fflate';
import { arrayMove } from '@dnd-kit/sortable';
import AdvancedAnalytics from './components/AdvancedAnalytics';
import { TrackComparison } from './components/TrackComparison';
import { RawDataAnalysis } from './components/RawDataAnalysis';
import { AnimatePresence } from 'motion/react';
import { VideoExportModal } from './components/VideoExportModal';
import { WeatherOverlay } from './components/WeatherOverlay';
import { ClimbsAnalysis } from './components/ClimbsAnalysis';
import { TrainingZonesAnalysis } from './components/TrainingZonesAnalysis';
import { SummaryReportModal } from './components/SummaryReportModal';
import { getApiUrl } from './utils/api';

const App: React.FC = () => {
  const [unhydratedTracks, setTracks] = useState<GPXTrack[]>([]);

  const tracks = React.useMemo(() => {
    return unhydratedTracks.map(t => {
      const needsPointsHydration = t.points && t.points.some(p => p.time && typeof p.time === 'string');
      const needsDateHydration = (t as any).date && typeof (t as any).date === 'string';
      
      if (!needsPointsHydration && !needsDateHydration) return t;
      
      return {
        ...t,
        date: (t as any).date ? new Date((t as any).date) : (t as any).date,
        points: t.points.map(p => p.time && typeof p.time === 'string' ? { ...p, time: new Date(p.time) } : p)
      };
    });
  }, [unhydratedTracks]);
  const [history, setHistory] = useState<GPXTrack[][]>([]);
  const [textMarkers, setTextMarkers] = useState<TextMarker[]>(() => {
    try {
      const saved = localStorage.getItem('velo_text_markers');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Sync with localStorage
  useEffect(() => {
    localStorage.setItem('velo_text_markers', JSON.stringify(textMarkers));
  }, [textMarkers]);

  const handleAddTextMarker = useCallback((newMarker: Omit<TextMarker, 'id'>) => {
    const marker: TextMarker = {
      ...newMarker,
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11)
    };
    setTextMarkers(prev => [...prev, marker]);
  }, []);

  const handleDeleteTextMarker = useCallback((id: string) => {
    setTextMarkers(prev => prev.filter(m => m.id !== id));
  }, []);

  const handleUpdateTextMarker = useCallback((id: string, updates: Partial<TextMarker>) => {
    setTextMarkers(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);
  const [activeLayer, setActiveLayer] = useState<MapLayer>(MapLayer.OSM);
  const [showCyclingHeatmap, setShowCyclingHeatmap] = useState(false);
  const [showRunningHeatmap, setShowRunningHeatmap] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('gpx_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch (e) {}
    return 'light';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('gpx_theme', theme);
  }, [theme]);

  const [selectionBounds, setSelectionBounds] = useState<{minLat: number, maxLat: number, minLng: number, maxLng: number} | null>(null);
  const [markedTrackId, setMarkedTrackId] = useState<string | null>(null);
  const [is3D, setIs3D] = useState(false);
  const [ftp, setFtp] = useState(250);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [climbsOpen, setClimbsOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [trainingZonesOpen, setTrainingZonesOpen] = useState(false);
  const [summaryReportOpen, setSummaryReportOpen] = useState(false);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [rawDataOpen, setRawDataOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [mapView, setMapView] = useState({
    lat: 51.1657,
    lng: 10.4515,
    zoom: 6,
    pitch: 60,
    bearing: 0
  });
  const [hoveredPoint, setHoveredPoint] = useState<GPXPoint | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(window.innerWidth < 768);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileCollapsed, setIsProfileCollapsed] = useState(false);
  const [userWeight, setUserWeight] = useState(75);
  const [userAge, setUserAge] = useState(35);
  const [userMaxHr, setUserMaxHr] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('velo_user_max_hr');
      if (saved) return Number(saved);
    } catch (e) {}
    return 220 - 35; // default 185
  });

  const handleMaxHrChange = (newMaxHr: number) => {
    setUserMaxHr(newMaxHr);
    try {
      localStorage.setItem('velo_user_max_hr', String(newMaxHr));
    } catch (e) {}
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem('velo_user_max_hr');
      if (!saved) {
        setUserMaxHr(220 - userAge);
      }
    } catch (e) {}
  }, [userAge]);
  const [estimatedSpeed, setEstimatedSpeed] = useState(15); // km/h
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [selectedTime, setSelectedTime] = useState<string>(() => {
    const today = new Date();
    const hours = String(today.getHours()).padStart(2, '0');
    const minutes = String(today.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  });
  const [isFlying, setIsFlying] = useState(false);
  const [flyProgress, setFlyProgress] = useState(0); // 0 to 1
  const [flySpeed, setFlySpeed] = useState(1); // multiplier
 
  // Recalculate power stats when FTP, weight, or estimated Speed changes
  useEffect(() => {
    setTracks(prev => prev.map(track => {
      const powerStats = calculatePowerStats(track.points, ftp, userWeight, estimatedSpeed);
      return { ...track, powerStats };
    }));
  }, [ftp, userWeight, estimatedSpeed]);

  const handleToggle3D = useCallback((mode: boolean) => {
    setIs3D(mode);
    if (mode) {
      setMapView(prev => ({ ...prev, pitch: 60 }));
    } else {
      setMapView(prev => ({ ...prev, pitch: 0, bearing: 0 }));
    }
  }, []);

  const [analyzingSurfaces, setAnalyzingSurfaces] = useState<Record<string, boolean>>({});

  const analyzeTrackSurface = useCallback(async (trackId: string) => {
    if (analyzingSurfaces[trackId]) return;

    let pointsToAnalyze: any[] = [];
    setTracks(currentTracks => {
      const track = currentTracks.find(t => t.id === trackId);
      if (track) {
        pointsToAnalyze = track.points.map(p => ({ lat: p.lat, lng: p.lng, ele: p.ele }));
      }
      return currentTracks;
    });

    if (pointsToAnalyze.length === 0) return;

    setAnalyzingSurfaces(prev => ({ ...prev, [trackId]: true }));
    try {
      const apiUrl = getApiUrl("/api/analyze-surface");

      const result = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          points: pointsToAnalyze
        })
      });

      if (!result.ok) throw new Error("Surface analyzer API error");
      const data = await result.json();

      if (data.surfaces && data.surfaceStats) {
        setTracks(prev => prev.map(t => {
          if (t.id === trackId) {
            const updatedPoints = t.points.map((p, idx) => ({
              ...p,
              surface: data.surfaces[idx] || "Asphalt"
            }));
            return {
              ...t,
              points: updatedPoints,
              surfaceStats: data.surfaceStats
            };
          }
          return t;
        }));
      }
    } catch (err) {
      console.error("[Surface Analyzer] Error for track", trackId, err);
    } finally {
      setAnalyzingSurfaces(prev => ({ ...prev, [trackId]: false }));
    }
  }, [analyzingSurfaces]);

  useEffect(() => {
    if (markedTrackId) {
      const track = tracks.find(t => t.id === markedTrackId);
      if (track && track.points.length > 0) {
        const hasSurfaces = track.points.some(p => p.surface && p.surface !== "Asphalt");
        if (!hasSurfaces && !analyzingSurfaces[markedTrackId]) {
          analyzeTrackSurface(markedTrackId);
        }
      }
    }
  }, [markedTrackId, tracks, analyzeTrackSurface, analyzingSurfaces]);
 
  // Auto-select first track if none is selected and tracks exist
  useEffect(() => {
    if (tracks.length > 0 && !markedTrackId) {
      setMarkedTrackId(tracks[0].id);
    } else if (tracks.length === 0) {
      setMarkedTrackId(null);
    }
  }, [tracks, markedTrackId]);
 
  const saveToHistory = useCallback(() => {
    setHistory(prev => [...prev, [...tracks]].slice(-10));
  }, [tracks]);
 
  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const previousState = history[history.length - 1];
    setTracks(previousState);
    setHistory(prev => prev.slice(0, -1));
  }, [history]);
 
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const processFitBuffer = async (buffer: ArrayBuffer, name: string) => {
      const parsed = await parseFIT(buffer, name);
      if (parsed) {
        parsed.powerStats = calculatePowerStats(parsed.points, ftp, userWeight, estimatedSpeed);
        newTracks.push(parsed);
        
        // Extract date of the FIT file
        const firstPtWithTime = parsed.points.find(p => p.time !== undefined);
        if (firstPtWithTime && firstPtWithTime.time) {
          const dt = new Date(firstPtWithTime.time);
          fitDate = dt.toISOString().split('T')[0];
          const hrs = String(dt.getHours()).padStart(2, '0');
          const mins = String(dt.getMinutes()).padStart(2, '0');
          fitTime = `${hrs}:${mins}`;
          hasAddedFit = true;
        }
      } else {
        errors.push(`${name}: Fehler beim Verarbeiten der FIT-Datei.`);
      }
    };

    const processGpxText = async (text: string, name: string) => {
      const validation = validateGPX(text);
      if (!validation.isValid) {
        errors.push(`${name}: ${validation.error}`);
        return;
      }

      const parsed = await parseGPX(text, name);
      if (parsed) {
        parsed.powerStats = calculatePowerStats(parsed.points, ftp, userWeight, estimatedSpeed);
        newTracks.push(parsed);
      } else {
        errors.push(`${name}: Fehler beim Verarbeiten der GPX-Datei.`);
      }
    };
 
    setErrorMessage(null);
    const newTracks: GPXTrack[] = [];
    const errors: string[] = [];
    
    let fitDate: string | null = null;
    let fitTime: string | null = null;
    let hasAddedFit = false;
 
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const lowerName = file.name.toLowerCase();
      const isFit = lowerName.endsWith('.fit');
      const isZip = lowerName.endsWith('.zip');

      try {
        if (isZip) {
          // Zip-Bomb Protection: limit zip file size to 30 MB
          if (file.size > 30 * 1024 * 1024) {
            errors.push(`${file.name}: ZIP-Datei ist zu groß (maximal 30 MB erlaubt).`);
            continue;
          }

          const arrayBuffer = await file.arrayBuffer();
          const zipUint8 = new Uint8Array(arrayBuffer);
          const unzipped = unzipSync(zipUint8);
          
          let totalUncompressedSize = 0;
          const MAX_UNCOMPRESSED_TOTAL = 100 * 1024 * 1024; // 100 MB max uncompressed

          for (const [filepath, fileData] of Object.entries(unzipped)) {
            // Zip-Slip (Directory Traversal) protection
            if (filepath.includes('..') || filepath.split('/').some(part => part === '..')) {
              console.warn(`Sicherheitswarnung: Pfad-Traversierung in ZIP ignoriert: ${filepath}`);
              continue;
            }

            // Decompression security: tracking total decompressed bytes to avoid exhausting memory
            totalUncompressedSize += fileData.length;
            if (totalUncompressedSize > MAX_UNCOMPRESSED_TOTAL) {
              throw new Error("Decompressions-Limit überschritten (Zip-Bomb-Schutz). Max. unkomprimierte Gesamtgröße ist 100 MB.");
            }

            const baseName = filepath.split('/').pop() || '';
            if (!baseName) continue; // skip directories

            const entryLowerName = baseName.toLowerCase();
            if (entryLowerName.endsWith('.fit')) {
              const buffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
              await processFitBuffer(buffer, baseName);
            } else if (entryLowerName.endsWith('.gpx')) {
              const textDecoder = new TextDecoder('utf-8');
              const text = textDecoder.decode(fileData);
              await processGpxText(text, baseName);
            }
          }
        } else if (isFit) {
          const buffer = await file.arrayBuffer();
          await processFitBuffer(buffer, file.name);
        } else {
          const text = await file.text();
          await processGpxText(text, file.name);
        }
      } catch (err: any) {
        errors.push(`${file.name}: Unerwarteter Fehler (${err.message || err}).`);
        console.error(err);
      }
    }
 
    if (errors.length > 0) {
      setErrorMessage(errors.join("\n"));
      // Clear error after 5 seconds
      setTimeout(() => setErrorMessage(null), 5000);
    }
 
    if (newTracks.length > 0) {
      const duplicates: string[] = [];
      const uniqueNewTracks: GPXTrack[] = [];

      for (const nt of newTracks) {
        const isDuplicate = tracks.some(t => {
          const samePointsCount = t.points.length === nt.points.length;
          const veryCloseDistance = Math.abs(t.distance - nt.distance) < 0.01;
          const sameName = t.name.toLowerCase() === nt.name.toLowerCase();
          return (samePointsCount && veryCloseDistance) || (sameName && veryCloseDistance);
        }) || uniqueNewTracks.some(t => {
          const samePointsCount = t.points.length === nt.points.length;
          const veryCloseDistance = Math.abs(t.distance - nt.distance) < 0.01;
          const sameName = t.name.toLowerCase() === nt.name.toLowerCase();
          return (samePointsCount && veryCloseDistance) || (sameName && veryCloseDistance);
        });

        if (isDuplicate) {
          duplicates.push(nt.name);
        } else {
          uniqueNewTracks.push(nt);
        }
      }

      if (duplicates.length > 0) {
        setErrorMessage(`Hinweis: ${duplicates.length} Aktivität(en) wurden ignoriert, da sie bereits geladen sind: ${duplicates.join(", ")}`);
        setTimeout(() => setErrorMessage(null), 8000);
      }

      if (uniqueNewTracks.length > 0) {
        saveToHistory();
        setTracks(prev => [...prev, ...uniqueNewTracks]);
        
        if (hasAddedFit && fitDate && fitTime) {
          setSelectedDate(fitDate);
          setSelectedTime(fitTime);
        } else {
          const today = new Date();
          const formattedDate = today.toISOString().split('T')[0];
          const hours = String(today.getHours()).padStart(2, '0');
          const minutes = String(today.getMinutes()).padStart(2, '0');
          setSelectedDate(formattedDate);
          setSelectedTime(`${hours}:${minutes}`);
        }
      }
    }
    e.target.value = '';
  }, [tracks, saveToHistory, ftp, userWeight, estimatedSpeed, setSelectedDate, setSelectedTime]);
 
  const toggleVisibility = useCallback((id: string) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, visible: !t.visible } : t));
  }, []);
 
  const removeTrack = useCallback((id: string) => {
    saveToHistory();
    setTracks(prev => prev.filter(t => t.id !== id));
    if (markedTrackId === id) setMarkedTrackId(null);
  }, [saveToHistory, markedTrackId]);
 
  const handleMerge = useCallback(() => {
    if (tracks.length < 2) return;
    saveToHistory();
    const merged = mergeTracks(tracks);
    merged.powerStats = calculatePowerStats(merged.points, ftp, userWeight, estimatedSpeed);
    setTracks([merged]);
    setMarkedTrackId(merged.id);
  }, [tracks, saveToHistory, ftp, userWeight, estimatedSpeed]);
 
  const handleReorder = useCallback((oldIndex: number, newIndex: number) => {
    setTracks(prev => arrayMove(prev, oldIndex, newIndex));
  }, []);
 
  const handleChangeActivityType = useCallback((id: string, type: 'cycling' | 'running') => {
    saveToHistory();
    setTracks(prev => prev.map(t => {
      if (t.id === id) {
        const powerStats = calculatePowerStats(t.points, ftp, userWeight, estimatedSpeed, type);
        return { ...t, activityType: type, powerStats };
      }
      return t;
    }));
  }, [saveToHistory, ftp, userWeight, estimatedSpeed]);

  const handleLoadLibraryTrack = useCallback((track: GPXTrack) => {
    let alreadyExists = false;
    setTracks(prev => {
      if (prev.some(t => t.id === track.id)) {
        alreadyExists = true;
        return prev.map(t => t.id === track.id ? { ...t, visible: true } : t);
      }
      return [...prev, { ...track, visible: true }];
    });
    setMarkedTrackId(track.id);
    if (alreadyExists) {
      setSuccessMessage(`Aktivität "${track.name}" ist bereits im Workspace geladen.`);
    }
  }, []);

  const handleSaveTrackToLibrary = useCallback(async (id: string) => {
    const track = tracks.find(t => t.id === id);
    if (!track) return;

    try {
      // 1. Fetch library to see if it is already stored there
      const libResponse = await fetch(getApiUrl('/api/library'));
      const libData = await libResponse.json();
      let isAlreadyInLibrary = false;
      
      if (libData.success && Array.isArray(libData.tracks)) {
        isAlreadyInLibrary = libData.tracks.some((t: any) => 
          t.id === track.id || 
          (t.name === track.name && Math.abs(t.distance - track.distance) < 0.05) ||
          (t.pointsLength === track.points?.length && Math.abs(t.distance - track.distance) < 0.05)
        );
      }

      // 2. Check if a duplicate exists in the workspace
      const isDuplicateInWorkspace = tracks.some(t => 
        t.id !== track.id && 
        t.name === track.name &&
        Math.abs(t.distance - track.distance) < 0.05
      );

      if (isAlreadyInLibrary) {
        setErrorMessage(`Die Aktivität "${track.name}" befindet sich bereits in der Bibliothek.`);
        return;
      }

      if (isDuplicateInWorkspace) {
        setErrorMessage(`Die Aktivität "${track.name}" befindet sich bereits im Workspace.`);
        return;
      }

      const response = await fetch(getApiUrl('/api/library'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(track)
      });
      const data = await response.json();
      if (data.success) {
        setSuccessMessage(`"${track.name}" wurde erfolgreich in der Bibliothek gespeichert!`);
      } else {
        setErrorMessage(data.error || 'Fehler beim Speichern in der Bibliothek.');
      }
    } catch (err) {
      console.error('Failed to save track to library:', err);
      setErrorMessage('Speichern in der Bibliothek fehlgeschlagen.');
    }
  }, [tracks]);

  const markedTrack = tracks.find(t => t.id === markedTrackId);
  const suggestedFtp = markedTrack?.powerStats?.best20m ? Math.round(markedTrack.powerStats.best20m * 0.95) : null;
 
  // Flyover Animation Logic
  useEffect(() => {
    let animationFrame: number;
    let lastTimestamp = 0;
    
    const animate = (timestamp: number) => {
      if (isFlying && markedTrack) {
        if (!lastTimestamp) lastTimestamp = timestamp;
        const delta = timestamp - lastTimestamp;
        lastTimestamp = timestamp;

        setFlyProgress(prev => {
          // Consistent speed: base speed increased for better scaling
          // 150km/h base provides better range up to 1500km/h at 10x
          const targetSpeedKmh = 150 * flySpeed;
          const targetSpeedKmMs = targetSpeedKmh / 3600000;
          const distanceStep = targetSpeedKmMs * delta;
          const progressStep = distanceStep / (markedTrack.distance || 1);
          
          const next = prev + progressStep;
          if (next >= 1) {
            setIsFlying(false);
            return 0;
          }
          return next;
        });
      }
      animationFrame = requestAnimationFrame(animate);
    };
    
    if (isFlying) {
      animationFrame = requestAnimationFrame(animate);
    }
    
    return () => {
      cancelAnimationFrame(animationFrame);
      lastTimestamp = 0;
    };
  }, [isFlying, markedTrack, flySpeed]);

  // Sync flyProgress to hoveredPoint
  useEffect(() => {
    if (isFlying && markedTrack && markedTrack.points.length > 0) {
      const index = Math.floor(flyProgress * (markedTrack.points.length - 1));
      const point = markedTrack.points[index];
      // Only update if the point actually changed to avoid redundant renders
      setHoveredPoint(prev => prev === point ? prev : point);
    }
  }, [flyProgress, isFlying, markedTrack]);

  // Global keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Guard against typing in active input fields
      const activeEl = document.activeElement;
      if (activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.getAttribute('contenteditable') === 'true'
      )) {
        return;
      }

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      // Ctrl + Z: Undo
      if (isCtrlOrMeta && e.key.toLowerCase() === 'z') {
        if (history.length > 0) {
          e.preventDefault();
          handleUndo();
        }
        return;
      }

      // Ctrl + S: Save to library
      if (isCtrlOrMeta && e.key.toLowerCase() === 's') {
        if (markedTrackId) {
          e.preventDefault();
          handleSaveTrackToLibrary(markedTrackId);
        }
        return;
      }

      // Arrow keys: fine-tuning map or navigating points
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const markedTrack = tracks.find(t => t.id === markedTrackId);

        // Point navigation: Left/Right when a track is marked and not holding Shift/Alt
        if (
          (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
          markedTrack &&
          markedTrack.points &&
          markedTrack.points.length > 0 &&
          !e.shiftKey &&
          !e.altKey
        ) {
          e.preventDefault();
          
          let currentIndex = -1;
          if (hoveredPoint) {
            currentIndex = markedTrack.points.findIndex(
              p => p.lat === hoveredPoint.lat && p.lng === hoveredPoint.lng
            );
          }

          let nextIndex = currentIndex;
          if (e.key === 'ArrowLeft') {
            if (currentIndex === -1) {
              nextIndex = markedTrack.points.length - 1;
            } else {
              nextIndex = currentIndex - 1;
              if (nextIndex < 0) nextIndex = markedTrack.points.length - 1;
            }
          } else {
            if (currentIndex === -1) {
              nextIndex = 0;
            } else {
              nextIndex = currentIndex + 1;
              if (nextIndex >= markedTrack.points.length) nextIndex = 0;
            }
          }
          setHoveredPoint(markedTrack.points[nextIndex]);
        } else {
          // Fine-tuning the map view
          e.preventDefault();
          
          const currentZoom = mapView.zoom;
          // Step gets smaller as zoom increases, allowing fine-tuned, precise panning
          const step = 0.05 / Math.pow(2, currentZoom - 6);
          
          let dLat = 0;
          let dLng = 0;

          if (e.key === 'ArrowUp') {
            dLat = step;
          } else if (e.key === 'ArrowDown') {
            dLat = -step;
          } else if (e.key === 'ArrowLeft') {
            dLng = -step;
          } else if (e.key === 'ArrowRight') {
            dLng = step;
          }

          setMapView(prev => ({
            ...prev,
            lat: prev.lat + dLat,
            lng: prev.lng + dLng
          }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    history,
    markedTrackId,
    handleUndo,
    handleSaveTrackToLibrary,
    tracks,
    hoveredPoint,
    mapView.zoom,
    setHoveredPoint,
    setMapView
  ]);

  const [showHint, setShowHint] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-105 dark:bg-slate-900 font-sans text-slate-900 dark:text-slate-50">
      <Sidebar 
        tracks={tracks}
        markedTrackId={markedTrackId}
        onMarkTrack={(id) => {
          setMarkedTrackId(id);
          setIsMobileMenuOpen(false);
          setIsProfileCollapsed(false);
        }}
        onChangeActivityType={handleChangeActivityType}
        onUpload={handleFileUpload}
        onToggleVisibility={toggleVisibility}
        onRemoveTrack={removeTrack}
        onMergeSelected={handleMerge}
        onUndo={handleUndo}
        canUndo={history.length > 0}
        onReorder={handleReorder}
        activeLayer={activeLayer}
        setActiveLayer={setActiveLayer}
        is3D={is3D}
        setIs3D={handleToggle3D}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
        estimatedSpeed={estimatedSpeed}
        setEstimatedSpeed={setEstimatedSpeed}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        selectedTime={selectedTime}
        setSelectedTime={setSelectedTime}
        ftp={ftp}
        setFtp={setFtp}
        userWeight={userWeight}
        setUserWeight={setUserWeight}
        userAge={userAge}
        setUserAge={setUserAge}
        userMaxHr={userMaxHr}
        setUserMaxHr={handleMaxHrChange}
        suggestedFtp={suggestedFtp}
        onLoadLibraryTrack={handleLoadLibraryTrack}
        onSaveTrackToLibrary={handleSaveTrackToLibrary}
        onOpenComparison={() => {
          setComparisonOpen(true);
          setIsMobileMenuOpen(false);
         }}
        onOpenTrainingZones={(id) => {
          if (id) {
            setMarkedTrackId(id);
          }
          setTrainingZonesOpen(true);
          setIsMobileMenuOpen(false);
        }}
        onOpenSummaryReport={(id) => {
          if (id) {
            setMarkedTrackId(id);
          }
          setSummaryReportOpen(true);
          setIsMobileMenuOpen(false);
        }}
        onOpenAnalytics={() => {
          setAnalyticsOpen(true);
          setIsMobileMenuOpen(false);
        }}
        onOpenClimbs={() => {
          setClimbsOpen(true);
          setIsMobileMenuOpen(false);
        }}
        onOpenRawData={(id) => {
          if (id) {
            setMarkedTrackId(id);
          }
          setRawDataOpen(true);
          setIsMobileMenuOpen(false);
        }}
        textMarkers={textMarkers}
        onAddTextMarker={handleAddTextMarker}
        onDeleteTextMarker={handleDeleteTextMarker}
        onUpdateTextMarker={handleUpdateTextMarker}
        hoveredPoint={hoveredPoint}
        onMapViewChange={(view) => {
          setMapView({
            lat: view.lat,
            lng: view.lng,
            zoom: view.zoom,
            pitch: view.pitch,
            bearing: view.bearing
          });
        }}
        onAnalyzeSurface={analyzeTrackSurface}
        analyzingSurfaces={analyzingSurfaces}
        selectionBounds={selectionBounds}
        onClearSelection={() => setSelectionBounds(null)}
        isDark={theme === 'dark'}
        onToggleTheme={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
        showCyclingHeatmap={showCyclingHeatmap}
        setShowCyclingHeatmap={setShowCyclingHeatmap}
        showRunningHeatmap={showRunningHeatmap}
        setShowRunningHeatmap={setShowRunningHeatmap}
      />
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 z-[60]">
          <div className="flex items-center gap-2">
            <Activity className="text-indigo-600 dark:text-indigo-400" size={24} />
            <span className="font-black tracking-tight text-lg text-slate-950 dark:text-slate-100">VeloAnalytics</span>
          </div>
          <button 
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2.5 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700"
          >
            <BarChart2 size={24} />
          </button>
        </div>
        <div className="flex-1 relative">
          {is3D ? (
            <Map3D 
              tracks={tracks} 
              activeLayer={activeLayer}
              markedTrackId={markedTrackId}
              onMarkTrack={setMarkedTrackId}
              hoveredPoint={hoveredPoint}
              onHoverPoint={setHoveredPoint}
              selectionBounds={selectionBounds}
              onSelection={setSelectionBounds}
              mapView={mapView}
              onMapViewChange={setMapView}
              estimatedSpeed={estimatedSpeed}
              flySpeed={flySpeed}
              isFlying={isFlying}
            />
          ) : (
            <Map 
              tracks={tracks} 
              activeLayer={activeLayer}
              markedTrackId={markedTrackId}
              onMarkTrack={setMarkedTrackId}
              hoveredPoint={hoveredPoint}
              onHoverPoint={setHoveredPoint}
              selectionBounds={selectionBounds}
              onSelection={setSelectionBounds}
              mapView={mapView}
              onMapViewChange={setMapView}
              estimatedSpeed={estimatedSpeed}
              isFlying={isFlying}
              ftp={ftp}
              textMarkers={textMarkers}
              onAddTextMarker={handleAddTextMarker}
              onDeleteTextMarker={handleDeleteTextMarker}
              hideLegend={trainingZonesOpen || weatherOpen || analyticsOpen || climbsOpen || comparisonOpen}
              isDark={theme === 'dark'}
              showCyclingHeatmap={showCyclingHeatmap}
              showRunningHeatmap={showRunningHeatmap}
            />
          )}

          <WeatherOverlay 
            track={markedTrack}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            selectedTime={selectedTime}
            setSelectedTime={setSelectedTime}
            isOpen={weatherOpen}
            onOpenChange={setWeatherOpen}
          />

          <AnimatePresence>
            {analyticsOpen && markedTrack && (
              <AdvancedAnalytics 
                track={markedTrack} 
                ftp={ftp} 
                userWeight={userWeight}
                userAge={userAge}
                selectionBounds={selectionBounds}
                onSelection={setSelectionBounds}
                onClose={() => setAnalyticsOpen(false)} 
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {climbsOpen && markedTrack && (
              <ClimbsAnalysis 
                track={markedTrack} 
                activeLayer={activeLayer}
                onClose={() => setClimbsOpen(false)} 
              />
            )}
          </AnimatePresence>


          
          <AnimatePresence>
            {comparisonOpen && (
              <TrackComparison 
                tracks={tracks}
                onClose={() => setComparisonOpen(false)}
                ftp={ftp}
                userWeight={userWeight}
                userAge={userAge}
                estimatedSpeed={estimatedSpeed}
              />
            )}
          </AnimatePresence>
          
          <AnimatePresence>
            {trainingZonesOpen && (
              <TrainingZonesAnalysis 
                tracks={tracks}
                activeTrackId={markedTrackId}
                onClose={() => setTrainingZonesOpen(false)}
                userMaxHr={userMaxHr}
                onMaxHrChange={handleMaxHrChange}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {summaryReportOpen && markedTrack && (
              <SummaryReportModal 
                track={markedTrack}
                onClose={() => setSummaryReportOpen(false)}
                ftp={ftp}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {rawDataOpen && (
              <RawDataAnalysis 
                tracks={tracks}
                selectedTrackId={markedTrackId}
                onClose={() => setRawDataOpen(false)}
              />
            )}
          </AnimatePresence>
          
          {showHint && (
            <div 
              className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-indigo-600/90 backdrop-blur-md text-white px-6 py-3 rounded-2xl shadow-2xl text-sm font-medium transition-all hover:bg-indigo-700 flex items-center gap-4 max-w-[90vw] md:max-w-none"
            >
              <div className="flex items-center gap-2">
                <span className="bg-white/20 p-1.5 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                </span>
                <span className="leading-tight">Auswahl: Nutze den Auswahl-Button links auf der Karte, um einen Bereich zu markieren.</span>
              </div>
              <button 
                onClick={() => setShowHint(false)}
                className="bg-white/10 hover:bg-white/20 p-2 rounded-xl transition-colors group"
                title="Hinweis dauerhaft ausblenden"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          )}

          {errorMessage && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1001] bg-red-500/90 backdrop-blur-sm text-white px-6 py-3 rounded-xl shadow-xl text-sm font-medium animate-bounce-in max-w-md whitespace-pre-line text-center">
              <div className="flex items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{errorMessage}</span>
                <button onClick={() => setErrorMessage(null)} className="ml-2 hover:opacity-70">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {successMessage && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1001] bg-emerald-550/95 dark:bg-emerald-600/90 backdrop-blur-sm text-white px-6 py-3 rounded-xl shadow-xl text-xs md:text-sm font-bold animate-bounce-in max-w-md text-center">
              <div className="flex items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span>{successMessage}</span>
                <button onClick={() => setSuccessMessage(null)} className="ml-2 hover:opacity-70">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>

        {markedTrack && (
          <div className={`${isProfileCollapsed ? 'h-0 overflow-hidden py-0 border-t-0 shadow-none' : 'h-52 md:h-56'} bg-white border-t border-slate-200 px-3 md:px-6 py-2 md:py-3 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)] z-20 transition-all duration-300 relative`}>
            <ElevationProfile 
              track={markedTrack} 
              onHoverPoint={setHoveredPoint} 
              hoveredPoint={hoveredPoint}
              selectionBounds={selectionBounds}
              onSelection={setSelectionBounds}
              estimatedSpeed={estimatedSpeed}
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              isFlying={isFlying}
              flySpeed={flySpeed}
              onFlySpeedChange={setFlySpeed}
              onOpenAnalytics={() => setAnalyticsOpen(true)}
              onOpenVideoExport={() => setIsExportModalOpen(true)}
              ftp={ftp}
              onToggleFlyover={() => {
                if (isFlying) {
                  setIsFlying(false);
                } else {
                  setFlyProgress(0);
                  setIsFlying(true);
                }
              }}
              onCollapse={() => setIsProfileCollapsed(true)}
            />
          </div>
        )}

        {markedTrack && isProfileCollapsed && (
          <button
            onClick={() => setIsProfileCollapsed(false)}
            className="fixed bottom-4 right-4 z-[99] bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-1.5 font-bold text-xs transition-all cursor-pointer border border-indigo-500 hover:scale-105 active:scale-95 animate-fade-in"
            title="Höhenprofil anzeigen"
          >
            <BarChart2 size={14} />
            <span>Höhenprofil einblenden</span>
          </button>
        )}

        <VideoExportModal
          track={markedTrack}
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          userWeight={userWeight}
          estimatedSpeed={estimatedSpeed}
        />
      </main>
    </div>
  );
};

export default App;
