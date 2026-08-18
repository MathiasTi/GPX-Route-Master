
import React, { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Map from './components/Map';
import Map3D from './components/Map3D';
import ElevationProfile from './components/ElevationProfile';
import { Activity, BarChart2, Menu, RefreshCw, FileText, WifiOff, X } from 'lucide-react';
import { GPXTrack, GPXPoint, MapLayer, TextMarker, TimeGap } from './types';
import { parseGPX, mergeTracks, validateGPX, calculatePowerStats, calculateDistance, parseGPXStream, hydratePointsWithSurface, calculateSurfaceStatsFromPoints, checkTrackDuplicateGPS, detectTimeGaps, splitTrackAtIndex, closeTimeGapInTrack, reverseTrack, analyzeTrackValidation, autoFixTrackValidation, calculateTrackCenterAndBounds, repairTrackGradientAnomalies, applyElevationFilterToTrack, ElevationFilterStrength } from './utils/gpxUtils';
import { TimeGapAnalysisModal } from './components/TimeGapAnalysisModal';
import { TrackValidationModal } from './components/TrackValidationModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { parseFIT } from './utils/fitUtils';
import { unzipSync } from 'fflate';
import { arrayMove } from '@dnd-kit/sortable';
import AdvancedAnalytics from './components/AdvancedAnalytics';
import { TrackComparison } from './components/TrackComparison';
import { RawDataAnalysis } from './components/RawDataAnalysis';
import { AnimatePresence, motion } from 'motion/react';
import { VideoExportModal } from './components/VideoExportModal';
import { WeatherOverlay } from './components/WeatherOverlay';
import { ClimbsAnalysis } from './components/ClimbsAnalysis';
import { TrainingZonesAnalysis } from './components/TrainingZonesAnalysis';
import { SummaryReportModal } from './components/SummaryReportModal';
import { IntensiveTrackAnalysisModal } from './components/IntensiveTrackAnalysisModal';
import { SportMetricsGlossaryModal } from './components/SportMetricsGlossaryModal';
import { GarminDashboard } from './components/GarminDashboard';
import { GarminActivitiesAnalysis } from './components/GarminActivitiesAnalysis';
import FitnessPerformanceAnalysis from './components/FitnessPerformanceAnalysis';
import { getApiUrl } from './utils/api';
import { triggerHaptic } from './utils/haptics';
import { loadWorkspaceTracks, saveWorkspaceTracks, safeGetItem, safeSetItem } from './utils/storage';

const App: React.FC = () => {
  // --- Core State Declarations ---
  const [unhydratedTracks, setTracks] = useState<GPXTrack[]>(() => {
    return loadWorkspaceTracks();
  });

  const [history, setHistory] = useState<GPXTrack[][]>([]);
  const [textMarkers, setTextMarkers] = useState<TextMarker[]>(() => {
    try {
      const saved = safeGetItem('velo_text_markers');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  const [activeLayer, setActiveLayer] = useState<MapLayer>(() => {
    try {
      const saved = safeGetItem('velo_workspace_active_layer');
      if (saved && Object.values(MapLayer).includes(saved as MapLayer)) {
        return saved as MapLayer;
      }
    } catch (e) {}
    return MapLayer.OSM;
  });

  const [showCyclingHeatmap, setShowCyclingHeatmap] = useState(false);
  const [showRunningHeatmap, setShowRunningHeatmap] = useState(false);
  const [showDbCyclingHeatmap, setShowDbCyclingHeatmap] = useState(false);
  const [showDbRunningHeatmap, setShowDbRunningHeatmap] = useState(false);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = safeGetItem('gpx_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch (e) {}
    return 'light';
  });

  const [selectionBounds, setSelectionBounds] = useState<{minLat: number, maxLat: number, minLng: number, maxLng: number} | null>(null);
  const [markedTrackId, setMarkedTrackId] = useState<string | null>(() => {
    return safeGetItem('velo_workspace_marked_track');
  });

  const [is3D, setIs3D] = useState(false);
  const [ftp, setFtp] = useState(250);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [garminHealthOpen, setGarminHealthOpen] = useState(false);
  const [garminActivitiesAnalysisOpen, setGarminActivitiesAnalysisOpen] = useState(false);
  const [performanceAnalysisOpen, setPerformanceAnalysisOpen] = useState(false);
  const [climbsOpen, setClimbsOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [trainingZonesOpen, setTrainingZonesOpen] = useState(false);
  const [summaryReportOpen, setSummaryReportOpen] = useState(false);
  const [intensiveAnalysisOpen, setIntensiveAnalysisOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [initialGlossaryMetricId, setInitialGlossaryMetricId] = useState<string | undefined>(undefined);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [rawDataOpen, setRawDataOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [timeGapModalOpen, setTimeGapModalOpen] = useState(false);
  const [timeGapTrackId, setTimeGapTrackId] = useState<string | null>(null);
  const [selectedGapId, setSelectedGapId] = useState<string | null>(null);
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [pendingValidationTracks, setPendingValidationTracks] = useState<GPXTrack[]>([]);
  const [isValidationPreCheck, setIsValidationPreCheck] = useState(true);

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
  const [trackUploadProgress, setTrackUploadProgress] = useState<{
    totalFiles: number;
    processedFiles: number;
    currentFileName: string;
    percentage: number;
    statusText: string;
  } | null>(null);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(window.innerWidth < 768);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileCollapsed, setIsProfileCollapsed] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [userWeight, setUserWeight] = useState(75);
  const [userAge, setUserAge] = useState(35);
  const [userMaxHr, setUserMaxHr] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('velo_user_max_hr');
      if (saved) return Number(saved);
    } catch (e) {}
    return 220 - 35; // default 185
  });

  const [settingsLoaded, setSettingsLoaded] = useState(false);
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

  const [analyzingSurfaces, setAnalyzingSurfaces] = useState<Record<string, boolean>>({});
  const [surfaceAnalysisStatuses, setSurfaceAnalysisStatuses] = useState<Record<string, { status: 'idle' | 'loading' | 'success' | 'error' | 'simulated'; message?: string; source?: 'osm' | 'terrain' | 'manual'; timestamp?: number }>>({});

  // --- Refs ---
  const analysisAttempted = useRef<Set<string>>(new Set());

  // --- Memoized Values ---
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

  const tracksRef = useRef(tracks);
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  const activeTimeGaps = React.useMemo(() => {
    const list: TimeGap[] = [];
    for (const track of tracks) {
      if (track.visible) {
        const gaps = detectTimeGaps(track, 30);
        list.push(...gaps);
      }
    }
    return list;
  }, [tracks]);

  // --- Helper Handlers ---
  const handleMaxHrChange = useCallback((newMaxHr: number) => {
    setUserMaxHr(newMaxHr);
    try {
      localStorage.setItem('velo_user_max_hr', String(newMaxHr));
    } catch (e) {}
  }, []);

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

  const handleToggle3D = useCallback((mode: boolean) => {
    setIs3D(mode);
    if (mode) {
      setMapView(prev => ({ ...prev, pitch: 60 }));
    } else {
      setMapView(prev => ({ ...prev, pitch: 0, bearing: 0 }));
    }
  }, []);

  // --- Lifecycle Effects ---
  // Auto-save workspace tracks with safe storage and quota management
  useEffect(() => {
    saveWorkspaceTracks(unhydratedTracks);
  }, [unhydratedTracks]);

  // Online / Offline tracking
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync text markers with localStorage
  useEffect(() => {
    localStorage.setItem('velo_text_markers', JSON.stringify(textMarkers));
  }, [textMarkers]);

  // Sync active layer with localStorage
  useEffect(() => {
    try {
      localStorage.setItem('velo_workspace_active_layer', activeLayer);
    } catch (e) {}
  }, [activeLayer]);

  // Sync theme with document & localStorage
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('gpx_theme', theme);
  }, [theme]);

  // Sync marked track ID with localStorage
  useEffect(() => {
    try {
      if (markedTrackId) {
        localStorage.setItem('velo_workspace_marked_track', markedTrackId);
      } else {
        localStorage.removeItem('velo_workspace_marked_track');
      }
    } catch (e) {}
  }, [markedTrackId]);

  // Auto-dismiss success messages
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Update max HR if userAge changes and no custom max HR saved
  useEffect(() => {
    try {
      const saved = localStorage.getItem('velo_user_max_hr');
      if (!saved) {
        setUserMaxHr(220 - userAge);
      }
    } catch (e) {}
  }, [userAge]);

  // Load settings on startup from SQLite database via API
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch(getApiUrl('/api/settings'));
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.settings) {
            const s = data.settings;
            if (s.ftp) setFtp(Number(s.ftp));
            if (s.userWeight) setUserWeight(Number(s.userWeight));
            if (s.userAge) setUserAge(Number(s.userAge));
            if (s.userMaxHr) setUserMaxHr(Number(s.userMaxHr));
            if (s.theme) {
              setTheme(s.theme === 'dark' ? 'dark' : 'light');
            }
            if (s.velo_text_markers) {
              try {
                setTextMarkers(JSON.parse(s.velo_text_markers));
              } catch (e) {}
            }
          }
        }
      } catch (e) {
        console.error('Failed to load settings from DB:', e);
      } finally {
        setSettingsLoaded(true);
      }
    };
    loadSettings();
  }, []);

  // Save settings when they change
  useEffect(() => {
    if (!settingsLoaded) return;
    const saveSettings = async () => {
      try {
        await fetch(getApiUrl('/api/settings'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settings: {
              ftp: String(ftp),
              userWeight: String(userWeight),
              userAge: String(userAge),
              userMaxHr: String(userMaxHr),
              theme: theme,
              velo_text_markers: JSON.stringify(textMarkers)
            }
          })
        });
      } catch (e) {
        console.error('Failed to save settings to DB:', e);
      }
    };
    
    const timeout = setTimeout(saveSettings, 1000);
    return () => clearTimeout(timeout);
  }, [ftp, userWeight, userAge, userMaxHr, theme, textMarkers, settingsLoaded]);

  // Recalculate power stats when FTP, weight, or estimated Speed changes
  useEffect(() => {
    setTracks(prev => prev.map(track => {
      const powerStats = calculatePowerStats(track.points, ftp, userWeight, estimatedSpeed, track.activityType);
      return { ...track, powerStats };
    }));
  }, [ftp, userWeight, estimatedSpeed]);

  const analyzeTrackSurface = useCallback(async (trackId: string, force = false) => {
    if (analyzingSurfaces[trackId]) return;
    if (!force && analysisAttempted.current.has(trackId)) return;
    
    analysisAttempted.current.add(trackId);

    const track = tracksRef.current.find(t => t.id === trackId);
    if (!track || !track.points || track.points.length === 0) {
      setSurfaceAnalysisStatuses(prev => ({
        ...prev,
        [trackId]: { status: 'error', message: 'Keine Punkte im Track vorhanden.' }
      }));
      return;
    }

    const pointsToAnalyze = track.points.map(p => ({ 
      lat: Number(p.lat), 
      lng: Number(p.lng), 
      ele: p.ele !== undefined ? Number(p.ele) : undefined, 
      surface: p.surface 
    })).filter(p => !isNaN(p.lat) && !isNaN(p.lng));

    const trackName = track.name;
    const activityType = track.activityType;

    setAnalyzingSurfaces(prev => ({ ...prev, [trackId]: true }));
    setSurfaceAnalysisStatuses(prev => ({
      ...prev,
      [trackId]: { status: 'loading', message: 'Strecke wird mit OpenStreetMap abgeglichen...' }
    }));

    try {
      const apiUrl = getApiUrl("/api/analyze-surface");
      let result: Response;
      
      const requestPayload = JSON.stringify({
        points: pointsToAnalyze,
        name: trackName,
        activityType: activityType
      });

      const requestHeaders = {
        "Content-Type": "application/json"
      };

      try {
        result = await fetch(apiUrl, {
          method: "POST",
          headers: requestHeaders,
          body: requestPayload
        });
      } catch (firstErr) {
        // Fall back to relative URL if absolute constructed URL threw a DOMException/network error
        if (apiUrl !== "/api/analyze-surface") {
          result = await fetch("/api/analyze-surface", {
            method: "POST",
            headers: requestHeaders,
            body: requestPayload
          });
        } else {
          throw firstErr;
        }
      }

      if (!result.ok) throw new Error(`Server lieferte Status-Code ${result.status}`);
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

        const isSimulated = data.isFallback === true;
        setSurfaceAnalysisStatuses(prev => ({
          ...prev,
          [trackId]: {
            status: isSimulated ? 'simulated' : 'success',
            source: isSimulated ? 'terrain' : 'osm',
            message: isSimulated
              ? (data.fallbackNotice || 'Geländebeschaffenheit anhand von Steigung & Höhe berechnet.')
              : `Erfolgreich von OpenStreetMap ermittelt (${data.surfaceStats.length} Belagsarten)`,
            timestamp: Date.now()
          }
        }));
      } else {
        throw new Error("Daten von OpenStreetMap sind unvollständig.");
      }
    } catch (err: any) {
      console.error("[Surface Analyzer] Error for track", trackId, err);
      setSurfaceAnalysisStatuses(prev => ({
        ...prev,
        [trackId]: {
          status: 'error',
          message: err.message || 'Verbindung zu OpenStreetMap fehlgeschlagen.',
          timestamp: Date.now()
        }
      }));
    } finally {
      setAnalyzingSurfaces(prev => ({ ...prev, [trackId]: false }));
    }
  }, [analyzingSurfaces]);

  const handleSetTrackSurface = useCallback((trackId: string, surfaceType: string) => {
    setTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        const updatedPoints = t.points.map(p => ({
          ...p,
          surface: surfaceType
        }));
        const updatedStats = [{ type: surfaceType, distance: t.distance }];
        return {
          ...t,
          points: updatedPoints,
          surfaceStats: updatedStats
        };
      }
      return t;
    }));
    setSurfaceAnalysisStatuses(prev => ({
      ...prev,
      [trackId]: {
        status: 'success',
        source: 'manual',
        message: `Oberfläche manuell auf ${surfaceType} gesetzt.`,
        timestamp: Date.now()
      }
    }));
  }, []);

  const saveToHistory = useCallback(() => {
    setHistory(prev => [...prev, [...tracks]].slice(-10));
  }, [tracks]);

  const handleReverseTrack = useCallback((trackId: string) => {
    saveToHistory();
    setTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        return reverseTrack(t, ftp, userWeight, estimatedSpeed);
      }
      return t;
    }));
    setSuccessMessage('Streckenverlauf erfolgreich umgekehrt!');
    triggerHaptic('medium');
  }, [ftp, userWeight, estimatedSpeed, saveToHistory]);

  const handleRepairTrackAnomalies = useCallback((trackId: string) => {
    saveToHistory();
    setTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        return repairTrackGradientAnomalies(t, ftp, userWeight, estimatedSpeed);
      }
      return t;
    }));
    triggerHaptic('medium');
    setSuccessMessage('Steigungsanomalien und GPS-Sprünge erfolgreich korrigiert!');
  }, [ftp, userWeight, estimatedSpeed, saveToHistory]);

  const handleApplyElevationFilter = useCallback((trackId: string, strength: ElevationFilterStrength) => {
    saveToHistory();
    setTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        return applyElevationFilterToTrack(t, strength, ftp, userWeight, estimatedSpeed);
      }
      return t;
    }));
    triggerHaptic('light');
    setSuccessMessage(`Höhendaten-Filter (${strength}) erfolgreich im Streckenprofil gesichert!`);
  }, [ftp, userWeight, estimatedSpeed, saveToHistory]);
 
  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const previousState = history[history.length - 1];
    setTracks(previousState);
    setHistory(prev => prev.slice(0, -1));
  }, [history]);

  const handleOpenTimeGapAnalysis = useCallback((trackId?: string) => {
    setTimeGapTrackId(trackId || markedTrackId || tracks[0]?.id || null);
    setTimeGapModalOpen(true);
  }, [markedTrackId, tracks]);

  const handleFocusGapOnMap = useCallback((gap: TimeGap) => {
    setSelectedGapId(gap.id);
    setMapView(prev => ({
      ...prev,
      lat: gap.startPoint.lat,
      lng: gap.startPoint.lng,
      zoom: 16
    }));
  }, []);

  const handleSplitTrack = useCallback((originalTrackId: string, splitIndex: number) => {
    const track = tracks.find(t => t.id === originalTrackId);
    if (!track) return;

    saveToHistory();

    const result = splitTrackAtIndex(track, splitIndex, ftp, userWeight, estimatedSpeed);
    if (!result) return;

    setTracks(prev => {
      const idx = prev.findIndex(t => t.id === originalTrackId);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1, result.track1, result.track2);
      return next;
    });

    setMarkedTrackId(result.track1.id);
    setSuccessMessage(`Track in 2 Abschnitte getrennt: "${result.track1.name}" & "${result.track2.name}"`);
  }, [tracks, ftp, userWeight, estimatedSpeed, saveToHistory]);

  const handleCloseGap = useCallback((originalTrackId: string, gap: TimeGap) => {
    const track = tracks.find(t => t.id === originalTrackId);
    if (!track) return;

    saveToHistory();

    const updatedTrack = closeTimeGapInTrack(track, gap, 0, ftp, userWeight, estimatedSpeed);

    setTracks(prev => prev.map(t => t.id === originalTrackId ? updatedTrack : t));
    setSuccessMessage('Zeitlücke erfolgreich entfernt und Punkte zusammengeführt');
  }, [tracks, ftp, userWeight, estimatedSpeed, saveToHistory]);

  const handleBatchSplit = useCallback((originalTrackId: string, minSeconds: number) => {
    const track = tracks.find(t => t.id === originalTrackId);
    if (!track) return;

    const gaps = detectTimeGaps(track, minSeconds);
    if (gaps.length === 0) return;

    saveToHistory();

    let currentTracks: GPXTrack[] = [track];

    for (let i = gaps.length - 1; i >= 0; i--) {
      const gap = gaps[i];
      const targetTrack = currentTracks[0];
      const res = splitTrackAtIndex(targetTrack, gap.startIndex, ftp, userWeight, estimatedSpeed);
      if (res) {
        currentTracks = [res.track1, res.track2, ...currentTracks.slice(1)];
      }
    }

    setTracks(prev => {
      const idx = prev.findIndex(t => t.id === originalTrackId);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1, ...currentTracks);
      return next;
    });

    setSuccessMessage(`Track an allen ${gaps.length} Zeitlücken in ${currentTracks.length} Abschnitte getrennt`);
  }, [tracks, ftp, userWeight, estimatedSpeed, saveToHistory]);

  const handleBatchCloseGaps = useCallback((originalTrackId: string, minSeconds: number) => {
    const track = tracks.find(t => t.id === originalTrackId);
    if (!track) return;

    const gaps = detectTimeGaps(track, minSeconds);
    if (gaps.length === 0) return;

    saveToHistory();

    let updatedTrack = track;
    for (let i = gaps.length - 1; i >= 0; i--) {
      updatedTrack = closeTimeGapInTrack(updatedTrack, gaps[i], 0, ftp, userWeight, estimatedSpeed);
    }

    setTracks(prev => prev.map(t => t.id === originalTrackId ? updatedTrack : t));
    setSuccessMessage(`Alle ${gaps.length} Zeitlücken erfolgreich aus dem Track entfernt`);
  }, [tracks, ftp, userWeight, estimatedSpeed, saveToHistory]);
 
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setTrackUploadProgress({
      totalFiles: files.length,
      processedFiles: 0,
      currentFileName: files[0].name,
      percentage: 0,
      statusText: 'Analysiere hochgeladene Dateien...'
    });

    const processFitBuffer = async (bufferOrBlob: ArrayBuffer | Blob, name: string) => {
      let buffer: ArrayBuffer;
      if (bufferOrBlob instanceof Blob) {
        buffer = await bufferOrBlob.arrayBuffer();
      } else {
        buffer = bufferOrBlob;
      }

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

    const processGpxFileOrText = async (fileOrText: Blob | string, name: string) => {
      let parsed: GPXTrack | null = null;
      if (typeof fileOrText === 'string') {
        const validation = validateGPX(fileOrText);
        if (!validation.isValid) {
          errors.push(`${name}: ${validation.error}`);
          return;
        }
        parsed = await parseGPX(fileOrText, name);
      } else {
        // Direct GPX Blob/File streaming
        // Simple security pre-check: read first 20KB for DOCTYPE / ENTITY
        try {
          const preCheckBlob = fileOrText.slice(0, 20000);
          const preCheckText = await preCheckBlob.text();
          const lowerPre = preCheckText.toLowerCase();
          if (lowerPre.includes('<!entity') || lowerPre.includes('<!doctype') || lowerPre.includes('<!system')) {
            errors.push(`${name}: Sicherheitsfehler: Benutzerdefinierte DOCTYPE- oder ENTITY-Definitionen sind im GPX nicht erlaubt.`);
            return;
          }
        } catch (e) {
          console.error("GPX safety precheck error", e);
        }

        parsed = await parseGPXStream(fileOrText, name);
      }

      if (parsed) {
        parsed.powerStats = calculatePowerStats(parsed.points, ftp, userWeight, estimatedSpeed);
        newTracks.push(parsed);
      } else {
        errors.push(`${name}: Fehler beim Verarbeiten oder keine gültigen Trackpunkte gefunden.`);
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

      const percentage = Math.round((i / files.length) * 100);
      setTrackUploadProgress({
        totalFiles: files.length,
        processedFiles: i,
        currentFileName: file.name,
        percentage,
        statusText: `Verarbeite Datei ${i + 1} von ${files.length}...`
      });

      try {
        if (isZip) {
          // Zip-Bomb Protection: limit zip file size to 30 MB
          if (file.size > 30 * 1024 * 1024) {
            errors.push(`${file.name}: ZIP-Datei ist zu groß (maximal 30 MB erlaubt).`);
            continue;
          }

          setTrackUploadProgress({
            totalFiles: files.length,
            processedFiles: i,
            currentFileName: file.name,
            percentage,
            statusText: `Dekomprimiere ZIP-Archiv: ${file.name}...`
          });

          const arrayBuffer = await file.arrayBuffer();
          const zipUint8 = new Uint8Array(arrayBuffer);
          const unzipped = unzipSync(zipUint8);
          
          let totalUncompressedSize = 0;
          const MAX_UNCOMPRESSED_TOTAL = 100 * 1024 * 1024; // 100 MB max uncompressed

          const entries = Object.entries(unzipped);
          const totalEntries = entries.length;
          let entryIndex = 0;

          for (const [filepath, fileData] of entries) {
            entryIndex++;
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
            const innerPercentage = Math.round(((i + (entryIndex / totalEntries)) / files.length) * 100);
            
            setTrackUploadProgress({
              totalFiles: files.length,
              processedFiles: i,
              currentFileName: `${file.name} / ${baseName}`,
              percentage: innerPercentage,
              statusText: `ZIP-Eintrag ${entryIndex} von ${totalEntries} wird importiert: ${baseName}...`
            });

            if (entryLowerName.endsWith('.fit')) {
              const buffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
              await processFitBuffer(buffer, baseName);
            } else if (entryLowerName.endsWith('.gpx')) {
              const textDecoder = new TextDecoder('utf-8');
              const text = textDecoder.decode(fileData);
              await processGpxFileOrText(text, baseName);
            }
          }
        } else if (isFit) {
          await processFitBuffer(file, file.name);
        } else {
          await processGpxFileOrText(file, file.name);
        }
      } catch (err: any) {
        errors.push(`${file.name}: Unerwarteter Fehler (${err.message || err}).`);
        console.error(err);
      }
    }

    setTrackUploadProgress({
      totalFiles: files.length,
      processedFiles: files.length,
      currentFileName: 'Fertigstellung',
      percentage: 100,
      statusText: 'Validiere Duplikate und integriere in Karte...'
    });
 
    if (errors.length > 0) {
      setErrorMessage(errors.join("\n"));
      // Clear error after 5 seconds
      setTimeout(() => setErrorMessage(null), 5000);
    }
 
    if (newTracks.length > 0) {
      const duplicateReasons: string[] = [];
      const uniqueNewTracks: GPXTrack[] = [];

      for (const nt of newTracks) {
        const dupCheck = checkTrackDuplicateGPS(nt, [...tracks, ...uniqueNewTracks]);

        if (dupCheck.isDuplicate) {
          duplicateReasons.push(`• "${nt.name}": ${dupCheck.reason || 'Identischer GPX-Verlauf'}`);
        } else {
          uniqueNewTracks.push(nt);
        }
      }

      if (duplicateReasons.length > 0) {
        setErrorMessage(`Hinweis: ${duplicateReasons.length} Aktivität(en) ignoriert (GPS-Musterduplikat):\n${duplicateReasons.join("\n")}`);
        setTimeout(() => setErrorMessage(null), 10000);
      }

      if (uniqueNewTracks.length > 0) {
        // Run validation pre-check on newly uploaded tracks
        const tracksWithAnomalies = uniqueNewTracks.filter(nt => {
          const rep = analyzeTrackValidation(nt);
          return rep.status === 'warning' || rep.status === 'error';
        });

        if (tracksWithAnomalies.length > 0) {
          // Trigger Validation Pre-Check Modal before processing into workspace
          setPendingValidationTracks(uniqueNewTracks);
          setIsValidationPreCheck(true);
          setValidationModalOpen(true);
        } else {
          // Seamlessly commit clean tracks directly into workspace
          commitApprovedTracks(uniqueNewTracks, hasAddedFit ? { fitDate, fitTime } : undefined);
        }
      }
    }
    setTrackUploadProgress(null);
    e.target.value = '';
  }, [tracks, saveToHistory, ftp, userWeight, estimatedSpeed, setSelectedDate, setSelectedTime]);

  const commitApprovedTracks = useCallback((approvedTracks: GPXTrack[], fitMeta?: { fitDate: string | null; fitTime: string | null }) => {
    if (approvedTracks.length === 0) return;
    saveToHistory();
    setTracks(prev => [...prev, ...approvedTracks]);
    
    if (fitMeta && fitMeta.fitDate && fitMeta.fitTime) {
      setSelectedDate(fitMeta.fitDate);
      setSelectedTime(fitMeta.fitTime);
    } else {
      const today = new Date();
      const formattedDate = today.toISOString().split('T')[0];
      const hours = String(today.getHours()).padStart(2, '0');
      const minutes = String(today.getMinutes()).padStart(2, '0');
      setSelectedDate(formattedDate);
      setSelectedTime(`${hours}:${minutes}`);
    }

    setSuccessMessage(`${approvedTracks.length} Aktivität(en) erfolgreich in den Workspace übernommen`);
    setTimeout(() => setSuccessMessage(null), 4000);
  }, [saveToHistory, setSelectedDate, setSelectedTime]);

  const handleOpenValidation = useCallback((trackId: string) => {
    const target = tracks.find(t => t.id === trackId);
    if (target) {
      setPendingValidationTracks([target]);
      setIsValidationPreCheck(false);
      setValidationModalOpen(true);
    }
  }, [tracks]);

  const handleConfirmValidationTracks = useCallback((confirmedTracks: GPXTrack[]) => {
    if (isValidationPreCheck) {
      commitApprovedTracks(confirmedTracks);
    } else {
      saveToHistory();
      setTracks(prev => {
        let updated = [...prev];
        for (const ct of confirmedTracks) {
          updated = updated.map(t => t.id === ct.id ? ct : t);
        }
        return updated;
      });
      setSuccessMessage(`Validierung abgeschlossen: ${confirmedTracks.length} Track(s) aktualisiert`);
      setTimeout(() => setSuccessMessage(null), 4000);
    }
    setValidationModalOpen(false);
    setPendingValidationTracks([]);
  }, [isValidationPreCheck, commitApprovedTracks, saveToHistory]);
 
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
    if (track && track.points && track.points.length > 0) {
      const calcStats = calculateSurfaceStatsFromPoints(track.points);
      const surfaceStats = calcStats.length > 0 ? calcStats : (track.surfaceStats && track.surfaceStats.length > 0 ? track.surfaceStats : []);
      track.surfaceStats = surfaceStats;
      hydratePointsWithSurface(track.points, surfaceStats, track.distance);
    }

    const dupCheck = checkTrackDuplicateGPS(track, tracks);
    const alreadyExists = dupCheck.isDuplicate;

    setTracks(prev => {
      if (prev.some(t => t.id === track.id)) {
        return prev.map(t => t.id === track.id ? { ...t, visible: true } : t);
      }
      if (dupCheck.isDuplicate && dupCheck.matchedTrackId) {
        return prev.map(t => t.id === dupCheck.matchedTrackId ? { ...t, visible: true } : t);
      }
      return [...prev, { ...track, visible: true }];
    });

    if (dupCheck.matchedTrackId) {
      setMarkedTrackId(dupCheck.matchedTrackId);
    } else {
      setMarkedTrackId(track.id);
    }

    if (alreadyExists) {
      setSuccessMessage(`Hinweis: "${track.name}" ist bereits im Workspace geladen (${dupCheck.reason || 'Identischer GPX-Verlauf'}).`);
    } else {
      setSuccessMessage(`Aktivität "${track.name}" wurde erfolgreich in den Workspace geladen.`);
    }
  }, [tracks]);

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

      // 2. Check if a duplicate exists in the workspace (excluding self)
      const workspaceOthers = tracks.filter(t => t.id !== track.id);
      const dupCheck = checkTrackDuplicateGPS(track, workspaceOthers);

      if (isAlreadyInLibrary) {
        setErrorMessage(`Die Aktivität "${track.name}" befindet sich bereits in der Bibliothek.`);
        return;
      }

      if (dupCheck.isDuplicate) {
        setErrorMessage(`Die Aktivität "${track.name}" befindet sich bereits als Duplikat im Workspace (${dupCheck.reason}).`);
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

  const markedTrack = tracks.find(t => t.id === markedTrackId) || tracks[0];
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

      // Escape key: close any open modal or clear active selection/flight
      if (e.key === 'Escape') {
        if (intensiveAnalysisOpen) { setIntensiveAnalysisOpen(false); return; }
        if (analyticsOpen) { setAnalyticsOpen(false); return; }
        if (garminHealthOpen) { setGarminHealthOpen(false); return; }
        if (garminActivitiesAnalysisOpen) { setGarminActivitiesAnalysisOpen(false); return; }
        if (performanceAnalysisOpen) { setPerformanceAnalysisOpen(false); return; }
        if (climbsOpen) { setClimbsOpen(false); return; }
        if (comparisonOpen) { setComparisonOpen(false); return; }
        if (trainingZonesOpen) { setTrainingZonesOpen(false); return; }
        if (summaryReportOpen) { setSummaryReportOpen(false); return; }
        if (weatherOpen) { setWeatherOpen(false); return; }
        if (rawDataOpen) { setRawDataOpen(false); return; }
        if (timeGapModalOpen) { setTimeGapModalOpen(false); return; }
        if (validationModalOpen) { setValidationModalOpen(false); return; }
        if (isExportModalOpen) { setIsExportModalOpen(false); return; }
        if (isFlying) { setIsFlying(false); return; }
        if (selectionBounds) { setSelectionBounds(null); return; }
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

      // 'M' shortcut: Pan to current hovered track point
      if (e.key === 'm' || e.key === 'M') {
        if (hoveredPoint && typeof hoveredPoint.lat === 'number' && typeof hoveredPoint.lng === 'number') {
          e.preventDefault();
          setMapView(prev => ({
            ...prev,
            lat: hoveredPoint.lat,
            lng: hoveredPoint.lng
          }));
          triggerHaptic('light');
          setSuccessMessage('Kartenansicht auf aktuellen Trackpunkt fokussiert (Taste M)');
        }
        return;
      }

      // 'C' shortcut: Cycle through all visible tracks to center them
      if (e.key === 'c' || e.key === 'C') {
        const visibleTracks = tracks.filter(t => t.visible && t.points && t.points.length > 0);
        if (visibleTracks.length > 0) {
          e.preventDefault();
          
          let nextTrackIndex = 0;
          if (markedTrackId) {
            const currentIdx = visibleTracks.findIndex(t => t.id === markedTrackId);
            if (currentIdx !== -1) {
              nextTrackIndex = (currentIdx + 1) % visibleTracks.length;
            }
          }
          
          const targetTrack = visibleTracks[nextTrackIndex];
          setMarkedTrackId(targetTrack.id);

          const trackBounds = calculateTrackCenterAndBounds(targetTrack);
          if (trackBounds) {
            // Compute an appropriate zoom level that comfortably frames the track bounding box
            const latDiff = Math.max(0.002, trackBounds.maxLat - trackBounds.minLat);
            const lngDiff = Math.max(0.002, trackBounds.maxLng - trackBounds.minLng);
            const maxDelta = Math.max(latDiff, lngDiff);
            
            // Approximate Web Mercator zoom from bounding box delta (in degrees)
            let estimatedZoom = Math.floor(Math.log2(360 / maxDelta));
            estimatedZoom = Math.min(17, Math.max(6, estimatedZoom - 1));

            setMapView(prev => ({
              ...prev,
              lat: trackBounds.centerLat,
              lng: trackBounds.centerLng,
              zoom: estimatedZoom
            }));
          }

          triggerHaptic('light');
          setSuccessMessage(`Fokus auf Strecke gewechselt (${nextTrackIndex + 1}/${visibleTracks.length}): "${targetTrack.name}"`);
        }
        return;
      }

      // Zoom shortcuts: + / = to zoom in, - to zoom out (when not typing in inputs)
      if (e.key === '+' || e.key === '=' || e.key === 'Add') {
        e.preventDefault();
        setMapView(prev => ({
          ...prev,
          zoom: Math.min(19, prev.zoom + 1)
        }));
        return;
      }
      if (e.key === '-' || e.key === '_' || e.key === 'Subtract') {
        e.preventDefault();
        setMapView(prev => ({
          ...prev,
          zoom: Math.max(3, prev.zoom - 1)
        }));
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
    setMapView,
    analyticsOpen,
    garminHealthOpen,
    garminActivitiesAnalysisOpen,
    performanceAnalysisOpen,
    climbsOpen,
    comparisonOpen,
    trainingZonesOpen,
    summaryReportOpen,
    weatherOpen,
    rawDataOpen,
    timeGapModalOpen,
    isExportModalOpen,
    isFlying,
    selectionBounds
  ]);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-slate-105 dark:bg-slate-900 font-sans text-slate-900 dark:text-slate-50">
      {/* Visual Progress Bar Overlay for GPX/FIT/ZIP Uploads */}
      <AnimatePresence>
        {trackUploadProgress && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-md flex flex-col items-center justify-center p-4 text-center"
          >
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-150 dark:border-slate-800 space-y-6">
              <div className="flex justify-center">
                <div className="p-4 bg-orange-50 dark:bg-orange-950/20 text-orange-600 dark:text-orange-400 rounded-2xl">
                  <RefreshCw className="w-8 h-8 animate-spin" />
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                  Verarbeite Aktivitäten...
                </h3>
                <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed min-h-[3rem] flex flex-col justify-center items-center gap-1.5">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {trackUploadProgress.statusText}
                  </span>
                  {trackUploadProgress.currentFileName && (
                    <span className="flex items-center gap-1.5 text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2.5 py-1 rounded-lg border border-slate-200/40 dark:border-slate-700/40 max-w-full truncate">
                      <FileText className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      {trackUploadProgress.currentFileName}
                    </span>
                  )}
                </div>
              </div>

              {/* Progress Bar Container */}
              <div className="space-y-1.5">
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3.5 overflow-hidden border border-slate-200/50 dark:border-slate-700/50">
                  <motion.div 
                    className="bg-gradient-to-r from-orange-500 to-amber-500 h-full rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${trackUploadProgress.percentage}%` }}
                    transition={{ duration: 0.15 }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                  <span>Datei {trackUploadProgress.processedFiles + 1} von {trackUploadProgress.totalFiles}</span>
                  <span>{trackUploadProgress.percentage}%</span>
                </div>
              </div>

              <div className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                Bitte lassen Sie dieses Fenster geöffnet, bis die Aktivitätsanalyse abgeschlossen ist.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
        onOpenGarminHealth={() => {
          setGarminHealthOpen(true);
          setIsMobileMenuOpen(false);
        }}
        onOpenGarminActivitiesAnalysis={() => {
          setGarminActivitiesAnalysisOpen(true);
          setIsMobileMenuOpen(false);
        }}
        onOpenPerformanceAnalysis={() => {
          setPerformanceAnalysisOpen(true);
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
        onOpenIntensiveAnalysis={(id) => {
          if (id) {
            setMarkedTrackId(id);
          }
          setIntensiveAnalysisOpen(true);
          setIsMobileMenuOpen(false);
        }}
        onOpenGlossary={(metricId) => {
          setInitialGlossaryMetricId(metricId);
          setGlossaryOpen(true);
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
        onOpenWeather={() => {
          setWeatherOpen(true);
          setIsMobileMenuOpen(false);
        }}
        onOpenRawData={(id) => {
          if (id) {
            setMarkedTrackId(id);
          }
          setRawDataOpen(true);
          setIsMobileMenuOpen(false);
        }}
        onOpenTimeGapAnalysis={(id) => {
          if (id) {
            setMarkedTrackId(id);
          }
          handleOpenTimeGapAnalysis(id);
          setIsMobileMenuOpen(false);
        }}
        onOpenValidation={handleOpenValidation}
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
        onSetTrackSurface={handleSetTrackSurface}
        onReverseTrack={handleReverseTrack}
        analyzingSurfaces={analyzingSurfaces}
        surfaceAnalysisStatuses={surfaceAnalysisStatuses}
        selectionBounds={selectionBounds}
        onSelection={setSelectionBounds}
        onClearSelection={() => setSelectionBounds(null)}
        isDark={theme === 'dark'}
        onToggleTheme={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
        showCyclingHeatmap={showCyclingHeatmap}
        setShowCyclingHeatmap={setShowCyclingHeatmap}
        showRunningHeatmap={showRunningHeatmap}
        setShowRunningHeatmap={setShowRunningHeatmap}
        showDbCyclingHeatmap={showDbCyclingHeatmap}
        setShowDbCyclingHeatmap={setShowDbCyclingHeatmap}
        showDbRunningHeatmap={showDbRunningHeatmap}
        setShowDbRunningHeatmap={setShowDbRunningHeatmap}
      />
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {!isOnline && (
          <div className="bg-amber-500 text-slate-950 px-4 py-2 text-xs font-bold flex items-center justify-between shadow-md z-[70] border-b border-amber-600">
            <div className="flex items-center gap-2">
              <WifiOff size={16} className="shrink-0" />
              <span>
                <strong>Offline-Modus:</strong> Kartenkacheln und zuvor geladene GPX-Routen werden aus dem Service-Worker-Cache bereitgestellt.
              </span>
            </div>
          </div>
        )}
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 z-[60]">
          <div className="flex items-center gap-2">
            <Activity className="text-indigo-600 dark:text-indigo-400" size={24} />
            <span className="font-black tracking-tight text-lg text-slate-950 dark:text-slate-100">VeloAnalytics</span>
          </div>
          <button 
            onClick={() => {
              triggerHaptic('medium');
              setIsMobileMenuOpen(true);
            }}
            className="p-2.5 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer active:scale-95 transition-transform"
            title="Menü öffnen"
          >
            <BarChart2 size={24} />
          </button>
        </div>
        <div className="flex-1 relative">
          <ErrorBoundary fallbackTitle="Kartenansicht konnte nicht geladen werden" fallbackMessage="Beim Rendern der interaktiven Karte ist ein Problem aufgetreten.">
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
                showDbCyclingHeatmap={showDbCyclingHeatmap}
                showDbRunningHeatmap={showDbRunningHeatmap}
                onAnalyzeSurface={analyzeTrackSurface}
                onOpenIntensiveAnalysis={(id) => {
                  setMarkedTrackId(id);
                  setIntensiveAnalysisOpen(true);
                }}
                analyzingSurfaces={analyzingSurfaces}
                surfaceAnalysisStatuses={surfaceAnalysisStatuses}
                timeGaps={activeTimeGaps}
                selectedGapId={selectedGapId}
                onSelectGap={handleFocusGapOnMap}
                onSplitGap={handleSplitTrack}
                onCloseGap={handleCloseGap}
              />
            )}
          </ErrorBoundary>

          <AnimatePresence>
            {timeGapModalOpen && (
              <TimeGapAnalysisModal
                isOpen={timeGapModalOpen}
                tracks={tracks}
                selectedTrackId={timeGapTrackId}
                onClose={() => setTimeGapModalOpen(false)}
                onSplitTrack={handleSplitTrack}
                onCloseGap={handleCloseGap}
                onBatchSplit={handleBatchSplit}
                onBatchCloseGaps={handleBatchCloseGaps}
                onFocusGapOnMap={handleFocusGapOnMap}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {validationModalOpen && pendingValidationTracks.length > 0 && (
              <TrackValidationModal
                isOpen={validationModalOpen}
                pendingTracks={pendingValidationTracks}
                onClose={() => {
                  setValidationModalOpen(false);
                  setPendingValidationTracks([]);
                }}
                onConfirmTracks={handleConfirmValidationTracks}
                onCancel={() => {
                  setValidationModalOpen(false);
                  setPendingValidationTracks([]);
                }}
                isPreCheck={isValidationPreCheck}
                ftp={ftp}
                userWeight={userWeight}
                estimatedSpeed={estimatedSpeed}
              />
            )}
          </AnimatePresence>

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
                selectionBounds={selectionBounds}
                onSelection={setSelectionBounds}
                onClose={() => setClimbsOpen(false)} 
              />
            )}
          </AnimatePresence>


          
          <AnimatePresence>
            {weatherOpen && (
              <div className="fixed inset-0 z-[1000] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[90vh] flex flex-col"
                >
                  <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">🌤️</span>
                      <div>
                        <h2 className="text-sm font-black text-slate-800 dark:text-slate-100">Wetter & Routen-Prognose</h2>
                        <p className="text-[10px] text-slate-400 font-medium">Meteorologische Bedingungen & Empfehlungen</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setWeatherOpen(false)}
                      className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="p-4 overflow-y-auto max-h-[calc(90vh-70px)]">
                    <WeatherOverlay
                      track={markedTrack || tracks.find(t => t.visible) || tracks[0]}
                      allTracks={tracks}
                      onSelectTrack={(id) => setMarkedTrackId(id)}
                      selectedDate={selectedDate}
                      setSelectedDate={setSelectedDate}
                      selectedTime={selectedTime}
                      setSelectedTime={setSelectedTime}
                      onClose={() => setWeatherOpen(false)}
                    />
                  </div>
                </motion.div>
              </div>
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
            {garminHealthOpen && (
              <GarminDashboard 
                initialTab="overview"
                onClose={() => setGarminHealthOpen(false)}
                onLoadTrack={handleLoadLibraryTrack}
                userWeight={userWeight}
                userAge={userAge}
                userMaxHr={userMaxHr}
                ftp={ftp}
                onUpdateFtp={setFtp}
                onUpdateMaxHr={handleMaxHrChange}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {garminActivitiesAnalysisOpen && (
              <GarminActivitiesAnalysis 
                onClose={() => setGarminActivitiesAnalysisOpen(false)}
                onLoadTrack={handleLoadLibraryTrack}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {performanceAnalysisOpen && (
              <GarminDashboard 
                initialTab="performance"
                onClose={() => setPerformanceAnalysisOpen(false)}
                onLoadTrack={handleLoadLibraryTrack}
                userWeight={userWeight}
                userAge={userAge}
                userMaxHr={userMaxHr}
                ftp={ftp}
                onUpdateFtp={setFtp}
                onUpdateMaxHr={handleMaxHrChange}
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
                onAnalyzeSurface={analyzeTrackSurface}
                isAnalyzing={analyzingSurfaces[markedTrack.id] || false}
                onSelection={setSelectionBounds}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {intensiveAnalysisOpen && (markedTrack || tracks.find(t => t.visible) || tracks[0]) && (
              <IntensiveTrackAnalysisModal
                key="intensive-analysis-modal"
                track={markedTrack || tracks.find(t => t.visible) || tracks[0]}
                onClose={() => setIntensiveAnalysisOpen(false)}
                ftp={ftp}
                userWeight={userWeight}
                userAge={userAge}
                userMaxHr={userMaxHr}
                estimatedSpeed={estimatedSpeed}
                textMarkers={textMarkers}
                onAddTextMarker={handleAddTextMarker}
                onSelectTrackPoint={(lat, lng) => {
                  setMapView(prev => ({ ...prev, lat, lng, zoom: Math.max(prev.zoom, 14) }));
                }}
                onOpenGlossary={(metricId) => {
                  setInitialGlossaryMetricId(metricId);
                  setGlossaryOpen(true);
                }}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {glossaryOpen && (
              <SportMetricsGlossaryModal
                onClose={() => {
                  setGlossaryOpen(false);
                  setInitialGlossaryMetricId(undefined);
                }}
                initialMetricId={initialGlossaryMetricId}
                isDark={theme === 'dark'}
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
          <div className={`${isProfileCollapsed ? 'h-0 overflow-hidden py-0 border-t-0 shadow-none' : 'h-44 sm:h-48 md:h-56'} bg-white border-t border-slate-200 px-2 sm:px-4 md:px-6 py-1.5 sm:py-2 md:py-3 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)] z-20 transition-all duration-300 relative`}>
            <ErrorBoundary fallbackTitle="Höhenprofil konnte nicht geladen werden">
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
                onOpenIntensiveAnalysis={() => setIntensiveAnalysisOpen(true)}
                onOpenVideoExport={() => setIsExportModalOpen(true)}
                ftp={ftp}
                textMarkers={textMarkers}
                onAddTextMarker={handleAddTextMarker}
                onDeleteTextMarker={handleDeleteTextMarker}
                onRepairAnomalies={handleRepairTrackAnomalies}
                onApplyElevationFilter={handleApplyElevationFilter}
                onAnalyzeSurface={analyzeTrackSurface}
                isAnalyzingSurface={markedTrack ? !!analyzingSurfaces[markedTrack.id] : false}
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
            </ErrorBoundary>
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
