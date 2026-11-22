import React, { useState, useCallback, useEffect, useRef } from 'react';
import { GPXTrack, GPXPoint, TextMarker, MapLayer, TimeGap } from './types';
import Sidebar from './components/Sidebar';
import { PasswordGate } from './components/PasswordGate';
import Map from './components/Map';
import Map3D from './components/Map3D';
import ElevationProfile from './components/ElevationProfile';
import { ActivitiesManagerView } from './components/ActivitiesManagerView';
import { ActivitiesDashboardView } from './components/ActivitiesDashboardView';
import { PlannedToursView } from './components/PlannedToursView';
import { Activity, BarChart2, BarChart3, Menu, RefreshCw, FileText, WifiOff, X, Map as MapIcon, ListFilter, Sun, Moon, Lock, Compass, Settings as SettingsIcon, Languages, ChevronDown, MoreHorizontal } from 'lucide-react';
import {
  AppPreferences,
  DEFAULT_APP_PREFERENCES,
  loadAppPreferences,
  saveAppPreferences,
  sanitizeAppPreferences,
  resolveEffectiveTheme,
  applyPreferencesToDom,
  tr,
  useDomLanguageSync
} from './utils/appSettings';
import { AppSettingsModal, AppSettingsTab } from './components/AppSettingsModal';
import { parseGPX, mergeTracks, validateGPX, calculatePowerStats, calculateDistance, parseGPXStream, hydratePointsWithSurface, calculateSurfaceStatsFromPoints, checkTrackDuplicateGPS, findDuplicateTracksByIdenticalGPS, detectTimeGaps, splitTrackAtIndex, sliceTrackRange, closeTimeGapInTrack, reverseTrack, shiftLoopStartTrack, sanitizeTrackAllInOne, analyzeTrackValidation, autoFixTrackValidation, calculateTrackCenterAndBounds, repairTrackGradientAnomalies, applyElevationFilterToTrack, ElevationFilterStrength, hasRealGpsData } from './utils/gpxUtils';
import { TimeGapAnalysisModal } from './components/TimeGapAnalysisModal';
import { TrackValidationModal } from './components/TrackValidationModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { parseFIT } from './utils/fitUtils';
import { unzipSync } from 'fflate';
import { arrayMove } from '@dnd-kit/sortable';
import { TrackComparison } from './components/TrackComparison';
import { AnimatePresence, motion } from 'motion/react';
import { VideoExportModal } from './components/VideoExportModal';
import { WeatherOverlay } from './components/WeatherOverlay';
import { IntensiveTrackAnalysisModal, AnalysisTab } from './components/IntensiveTrackAnalysisModal';
import { SportMetricsGlossaryModal } from './components/SportMetricsGlossaryModal';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { GarminDashboard, GarminDashboardTab } from './components/GarminDashboard';
import { MobileThumbBar } from './components/mobile/MobileThumbBar';
import { MobileTelemetryPill } from './components/mobile/MobileTelemetryPill';
import { getApiUrl, apiFetch, setSessionToken, clearSessionToken } from './utils/api';
import { triggerHaptic } from './utils/haptics';
import { loadWorkspaceTracks, saveWorkspaceTracks, safeGetItem, safeSetItem, safeRemoveItem, isDefaultCuratedTrack } from './utils/storage';
import { safeStringifyOrFallback } from './domain/serialization/safeJson';
import {
  KomootCollectionImportModal,
  KomootCollectionPreviewData,
  KomootCollectionImportCompletion
} from './components/KomootCollectionImportModal';
import {
  attachKomootSourceToTrack,
  applyKomootRefreshToTrack,
  findMatchingExistingKomootTrack,
  getKomootSourceMeta
} from './utils/komootVersioning';
import {
  computeNextZoom,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  resolveKeyboardZoomAction
} from './utils/mapZoom';

const VALID_FITNESS_TABS: readonly GarminDashboardTab[] = [
  'overview',
  'personal-api',
  'performance',
  'records',
  'calendar',
  'compare',
  'activities',
  'analytics',
  'sleep',
  'rhr',
  'steps',
  'stress'
];

type WorkspaceView = 'map' | 'planned' | 'activities' | 'dashboard' | 'fitness';

function parseWorkspaceHash(hash: string): { view: WorkspaceView; fitnessTab?: GarminDashboardTab } {
  const cleaned = hash.replace(/^#\/?/, '').trim().toLowerCase();
  if (cleaned === 'planned' || cleaned.startsWith('planned/') || cleaned === 'tours' || cleaned.startsWith('tours/')) {
    return { view: 'planned' };
  }
  if (cleaned === 'activities' || cleaned.startsWith('activities/')) {
    return { view: 'activities' };
  }
  if (
    cleaned === 'dashboard' ||
    cleaned === 'activity-dashboard' ||
    cleaned.startsWith('dashboard/')
  ) {
    return { view: 'dashboard' };
  }
  if (cleaned === 'fitness' || cleaned.startsWith('fitness/')) {
    const rawTab = cleaned.slice('fitness'.length).replace(/^\//, '');
    const normalizedTab = rawTab === 'cockpit' ? 'overview' : rawTab;
    const fitnessTab = VALID_FITNESS_TABS.includes(normalizedTab as GarminDashboardTab)
      ? (normalizedTab as GarminDashboardTab)
      : 'overview';
    return { view: 'fitness', fitnessTab };
  }
  return { view: 'map' };
}

function computeTightTrackBounds(targetTracks: GPXTrack[]): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const t of targetTracks) {
    if (!hasRealGpsData(t)) continue;
    for (const p of t.points || []) {
      if (p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))) {
        const lat = Number(p.lat);
        const lng = Number(p.lng);
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }
    }
  }
  if (minLat === Infinity || maxLat === -Infinity) return null;
  return { minLat, maxLat, minLng, maxLng };
}

const App: React.FC = () => {
  // --- Password Lock State ---
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
  const [authSetupRequired, setAuthSetupRequired] = useState<boolean>(false);
  const [authChecking, setAuthChecking] = useState<boolean>(true);

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

  const [appPrefs, setAppPrefs] = useState<AppPreferences>(() => loadAppPreferences());
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<AppSettingsTab>('style');

  const [activeLayer, setActiveLayer] = useState<MapLayer>(() => {
    try {
      const saved = safeGetItem('velo_workspace_active_layer');
      if (saved && Object.values(MapLayer).includes(saved as MapLayer)) {
        return saved as MapLayer;
      }
    } catch (e) {}
    return loadAppPreferences().defaultMapLayer;
  });

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const prefs = loadAppPreferences();
      if (prefs.colorMode === 'system') {
        return resolveEffectiveTheme('system');
      }
      const saved = safeGetItem('gpx_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      return resolveEffectiveTheme(prefs.colorMode);
    } catch (e) {}
    return 'light';
  });

  const [selectionBounds, setSelectionBounds] = useState<{minLat: number, maxLat: number, minLng: number, maxLng: number} | null>(null);
  const [markedTrackId, setMarkedTrackId] = useState<string | null>(() => {
    return safeGetItem('velo_workspace_marked_track');
  });
  const [compareTrackId, setCompareTrackId] = useState<string | null>(null);

  const [is3D, setIs3D] = useState(false);
  const [ftp, setFtp] = useState(250);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [intensiveAnalysisOpen, setIntensiveAnalysisOpen] = useState(false);
  const [intensiveAnalysisTab, setIntensiveAnalysisTab] = useState<AnalysisTab>('overview');
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [initialGlossaryMetricId, setInitialGlossaryMetricId] = useState<string | undefined>(undefined);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [weatherOpen, setWeatherOpen] = useState(false);
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
  const [mobileNavMenuOpen, setMobileNavMenuOpen] = useState(false);
  const [mobileToolsMenuOpen, setMobileToolsMenuOpen] = useState(false);
  const [activeWorkspaceView, setActiveWorkspaceView] = useState<WorkspaceView>(() => {
    const rawHash = window.location.hash.replace(/^#\/?/, '').trim();
    if (rawHash) {
      return parseWorkspaceHash(window.location.hash).view;
    }
    return loadAppPreferences().defaultView;
  });
  const [fitnessPageInitialTab, setFitnessPageInitialTab] = useState<GarminDashboardTab>(() =>
    parseWorkspaceHash(window.location.hash).fitnessTab ?? 'overview'
  );

  const syncWorkspaceHash = useCallback((view: WorkspaceView, tab?: GarminDashboardTab) => {
    const nextHash = view === 'fitness' ? `#fitness/${tab || 'overview'}` : `#${view}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, []);

  const navigateWorkspace = useCallback((view: WorkspaceView, tab?: GarminDashboardTab) => {
    setIsMobileMenuOpen(false);
    setMobileNavMenuOpen(false);
    setMobileToolsMenuOpen(false);
    if (view === 'fitness') {
      const resolvedTab = tab ?? 'overview';
      setFitnessPageInitialTab(resolvedTab);
      setActiveWorkspaceView('fitness');
      syncWorkspaceHash('fitness', resolvedTab);
      return;
    }
    setActiveWorkspaceView(view);
    syncWorkspaceHash(view);
    if (view === 'map') {
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }
  }, [syncWorkspaceHash]);

  const openFitnessPage = useCallback((tab: GarminDashboardTab = 'overview') => {
    navigateWorkspace('fitness', tab);
  }, [navigateWorkspace]);

  const handleFitnessTabChange = useCallback((tab: GarminDashboardTab) => {
    setFitnessPageInitialTab(tab);
    syncWorkspaceHash('fitness', tab);
  }, [syncWorkspaceHash]);

  useEffect(() => {
    const handleHashChange = () => {
      const parsed = parseWorkspaceHash(window.location.hash);
      if (parsed.fitnessTab) {
        setFitnessPageInitialTab(parsed.fitnessTab);
      }
      setActiveWorkspaceView(parsed.view);
      if (parsed.view === 'map') {
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
  const [catalogTotalCount, setCatalogTotalCount] = useState<number | null>(null);
  const [plannedToursCount, setPlannedToursCount] = useState<number | null>(null);
  const [isProfileCollapsed, setIsProfileCollapsed] = useState(() => !loadAppPreferences().showElevationProfile);
  const [mobileProfileSnap, setMobileProfileSnap] = useState<'mini' | 'standard' | 'expanded'>('standard');
  const [showHint, setShowHint] = useState(false);
  const [userWeight, setUserWeight] = useState(75);
  const [userAge, setUserAge] = useState(35);
  const [userMaxHr, setUserMaxHr] = useState<number>(() => {
    try {
      const saved = safeGetItem('velo_user_max_hr');
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

  const [analyzingSurfaces, setAnalyzingSurfaces] = useState<Record<string, boolean>>({});
  const [surfaceAnalysisStatuses, setSurfaceAnalysisStatuses] = useState<
    Record<
      string,
      {
        status: 'idle' | 'loading' | 'success' | 'partial' | 'error';
        message?: string;
        source?: 'valhalla+osm' | 'valhalla' | 'overpass' | 'embedded' | 'osm' | 'manual' | 'unavailable';
        coveragePct?: number;
        cached?: boolean;
        timestamp?: number;
      }
    >
  >({});

  // --- Refs ---
  const analysisAttempted = useRef<Set<string>>(new Set());
  const topbarUploadInputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    if (compareTrackId && !tracks.some(t => t.id === compareTrackId)) {
      setCompareTrackId(null);
    } else if (compareTrackId && markedTrackId && compareTrackId === markedTrackId) {
      setCompareTrackId(null);
    }
  }, [tracks, compareTrackId, markedTrackId]);

  const timeGapsCacheRef = useRef<WeakMap<GPXPoint[], TimeGap[]>>(new WeakMap());

  const activeTimeGaps = React.useMemo(() => {
    const list: TimeGap[] = [];
    for (const track of tracks) {
      if (track.visible) {
        let gaps = timeGapsCacheRef.current.get(track.points);
        if (!gaps) {
          gaps = detectTimeGaps(track, 30);
          timeGapsCacheRef.current.set(track.points, gaps);
        }
        list.push(...gaps);
      }
    }
    return list;
  }, [tracks]);

  // --- Helper Handlers ---
  const updateAppPreferences = useCallback((partial: Partial<AppPreferences>) => {
    setAppPrefs((prev) => {
      const next = saveAppPreferences({ ...prev, ...partial });
      if (partial.colorMode !== undefined) {
        setTheme(resolveEffectiveTheme(partial.colorMode));
      }
      if (partial.showElevationProfile !== undefined) {
        setIsProfileCollapsed(!partial.showElevationProfile);
      }
      return next;
    });
  }, []);

  const handleToggleThemeQuick = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      setAppPrefs((p) => saveAppPreferences({ ...p, colorMode: next }));
      return next;
    });
  }, []);

  const openSettingsModal = useCallback((tab: AppSettingsTab = 'style') => {
    setSettingsInitialTab(tab);
    setSettingsModalOpen(true);
  }, []);

  const handleResetAppPreferences = useCallback(() => {
    const resetPrefs = saveAppPreferences({ ...DEFAULT_APP_PREFERENCES });
    setAppPrefs(resetPrefs);
    setTheme(resolveEffectiveTheme(resetPrefs.colorMode));
    setFtp(250);
    setUserWeight(75);
    setUserAge(35);
    setUserMaxHr(185);
    safeSetItem('velo_user_max_hr', '185');
    setEstimatedSpeed(15);
    setActiveLayer(resetPrefs.defaultMapLayer);
    setIsProfileCollapsed(!resetPrefs.showElevationProfile);
    setSuccessMessage(
      tr(
        resetPrefs.language,
        'Einstellungen auf Standardwerte zurückgesetzt.',
        'Settings reset to defaults.'
      )
    );
  }, []);

  const handleMaxHrChange = useCallback((newMaxHr: number) => {
    setUserMaxHr(newMaxHr);
    safeSetItem('velo_user_max_hr', String(newMaxHr));
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

  const handleOpenTrackAnalysis = useCallback((trackId?: string, tab: AnalysisTab = 'overview') => {
    if (trackId) {
      setMarkedTrackId(trackId);
    }
    setIntensiveAnalysisTab(tab);
    setIntensiveAnalysisOpen(true);
  }, []);

  // --- Password Lock Lifecycle (30-Day Session Verification) ---
  useEffect(() => {
    let mounted = true;
    const verifySession = async () => {
      try {
        const res = await apiFetch(getApiUrl('/api/auth/me'));
        if (res.ok) {
          const data = await res.json();
          if (mounted) {
            setAuthSetupRequired(Boolean(data?.setupRequired));
            if (data?.authenticated) {
              setIsUnlocked(true);
            } else {
              clearSessionToken();
              setIsUnlocked(false);
            }
          }
        } else if (mounted) {
          clearSessionToken();
          setIsUnlocked(false);
        }
      } catch {
        if (mounted) {
          setIsUnlocked(false);
        }
      } finally {
        if (mounted) {
          setAuthChecking(false);
        }
      }
    };

    verifySession();

    const handleUnauthorized = () => {
      clearSessionToken();
      setIsUnlocked(false);
    };
    window.addEventListener('velo:auth-unauthorized', handleUnauthorized);
    return () => {
      mounted = false;
      window.removeEventListener('velo:auth-unauthorized', handleUnauthorized);
    };
  }, []);

  const handleUnlocked = useCallback((token?: string) => {
    if (token) {
      setSessionToken(token);
    }
    setAuthSetupRequired(false);
    setSettingsLoaded(false);
    setIsUnlocked(true);
  }, []);

  const handleLockApp = useCallback(async () => {
    try {
      await apiFetch(getApiUrl('/api/auth/logout'), { method: 'POST' });
    } catch {
      // ignore network error on lock
    }
    clearSessionToken();
    setIsUnlocked(false);
    setSettingsLoaded(false);
  }, []);

  // --- Lifecycle Effects ---
  // Auto-save workspace tracks with debounced safe storage and flush on page unload
  const unhydratedTracksRef = useRef(unhydratedTracks);
  unhydratedTracksRef.current = unhydratedTracks;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveWorkspaceTracks(unhydratedTracksRef.current);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [unhydratedTracks]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      saveWorkspaceTracks(unhydratedTracksRef.current);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const refreshCatalogTotalCount = useCallback(() => {
    if (!isUnlocked) return;
    apiFetch(getApiUrl('/api/activities/catalog?source=garmin&limit=10&offset=0'))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && typeof data.databaseTotalCount === 'number') {
          setCatalogTotalCount(data.databaseTotalCount);
        }
      })
      .catch(() => {});

    apiFetch(getApiUrl('/api/library'))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && Array.isArray(data.tracks)) {
          const count = data.tracks.filter((t: any) => {
            const idLower = String(t.id || '').toLowerCase();
            if (idLower.startsWith('garmin-')) return false;
            if (t.rawFileDetails?.fileType === 'fit') return false;
            if (t.originalFilename && String(t.originalFilename).toLowerCase().endsWith('.fit')) return false;
            return true;
          }).length;
          setPlannedToursCount(count);
        }
      })
      .catch(() => {});
  }, [isUnlocked]);

  const [pendingKomootCollection, setPendingKomootCollection] =
    useState<KomootCollectionPreviewData | null>(null);
  const [refreshingKomootTracks, setRefreshingKomootTracks] =
    useState<Record<string, boolean>>({});

  // Fetch initial catalog total count once unlocked so TopNavBar shows accurate DB count
  useEffect(() => {
    refreshCatalogTotalCount();
  }, [refreshCatalogTotalCount]);

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

  // Sync text markers with safe storage
  useEffect(() => {
    safeSetItem('velo_text_markers', safeStringifyOrFallback(textMarkers, '[]'));
  }, [textMarkers]);

  // Sync active layer with safe storage
  useEffect(() => {
    safeSetItem('velo_workspace_active_layer', activeLayer);
  }, [activeLayer]);

  // Sync UI language (DE / EN) across rendered DOM text and tooltips
  useDomLanguageSync(appPrefs.language);

  // Sync UI style, density, radius, language & color theme with document & safe storage
  useEffect(() => {
    applyPreferencesToDom(appPrefs, theme);
    safeSetItem('gpx_theme', theme);
  }, [appPrefs, theme]);

  // Listen to OS dark mode changes when colorMode === 'system'
  useEffect(() => {
    if (appPrefs.colorMode !== 'system' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? 'dark' : 'light');
    };
    setTheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [appPrefs.colorMode]);

  // Sync marked track ID with safe storage
  useEffect(() => {
    if (markedTrackId) {
      safeSetItem('velo_workspace_marked_track', markedTrackId);
    } else {
      safeRemoveItem('velo_workspace_marked_track');
    }
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
    const saved = safeGetItem('velo_user_max_hr');
    if (!saved) {
      setUserMaxHr(220 - userAge);
    }
  }, [userAge]);

  // Load settings on startup from SQLite database via API once unlocked
  useEffect(() => {
    if (!isUnlocked) return;
    const loadSettings = async () => {
      try {
        const apiUrl = getApiUrl('/api/settings');
        const response = await apiFetch(apiUrl);
        if (response.ok) {
          const text = await response.text();
          if (text && text.trim().startsWith('{')) {
            const data = JSON.parse(text);
            if (data.success && data.settings) {
              const s = data.settings;
              if (s.ftp) setFtp(Number(s.ftp));
              if (s.userWeight) setUserWeight(Number(s.userWeight));
              if (s.userAge) setUserAge(Number(s.userAge));
              if (s.userMaxHr) setUserMaxHr(Number(s.userMaxHr));
              if (s.estimatedSpeed) setEstimatedSpeed(Number(s.estimatedSpeed));
              if (s.app_preferences) {
                try {
                  const parsedPrefs = sanitizeAppPreferences(JSON.parse(s.app_preferences));
                  const synced = saveAppPreferences(parsedPrefs);
                  setAppPrefs(synced);
                  setTheme(resolveEffectiveTheme(synced.colorMode));
                } catch {}
              } else if (s.theme) {
                setTheme(s.theme === 'dark' ? 'dark' : 'light');
              }
              if (s.velo_text_markers) {
                try {
                  setTextMarkers(JSON.parse(s.velo_text_markers));
                } catch (e) {}
              }
            }
          }
        }
      } catch (e) {
        console.warn('Unable to load settings from DB:', e);
      } finally {
        setSettingsLoaded(true);
      }
    };
    loadSettings();
  }, [isUnlocked]);

  // Save settings when they change
  useEffect(() => {
    if (!isUnlocked || !settingsLoaded) return;
    const saveSettings = async () => {
      try {
        await apiFetch(getApiUrl('/api/settings'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settings: {
              ftp: String(ftp),
              userWeight: String(userWeight),
              userAge: String(userAge),
              userMaxHr: String(userMaxHr),
              estimatedSpeed: String(estimatedSpeed),
              theme: theme,
              app_preferences: JSON.stringify(appPrefs),
              velo_text_markers: safeStringifyOrFallback(textMarkers, '[]')
            }
          })
        });
      } catch (e) {
        console.warn('Unable to save settings to DB:', e);
      }
    };
    
    const timeout = setTimeout(saveSettings, 1000);
    return () => clearTimeout(timeout);
  }, [isUnlocked, ftp, userWeight, userAge, userMaxHr, estimatedSpeed, theme, appPrefs, textMarkers, settingsLoaded]);

  // Keep default curated reference tours in the Library, not in the active Workspace
  useEffect(() => {
    if (safeGetItem('velo_defaults_moved_to_library_v1') !== 'true') {
      const hasDefaults = unhydratedTracks.some(t => isDefaultCuratedTrack(t));
      if (hasDefaults) {
        setTracks(prev => {
          const filtered = prev.filter(t => !isDefaultCuratedTrack(t));
          saveWorkspaceTracks(filtered);
          return filtered;
        });
      }
      safeSetItem('velo_defaults_moved_to_library_v1', 'true');
    }
  }, [unhydratedTracks]);

  // Recalculate power stats when FTP, weight, or estimated Speed changes (debounced to keep typing fluid)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTracks(prev => prev.map(track => {
        const powerStats = calculatePowerStats(track.points, ftp, userWeight, estimatedSpeed, track.activityType);
        return { ...track, powerStats };
      }));
    }, 250);
    return () => window.clearTimeout(timer);
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
      [trackId]: { status: 'loading', message: 'Valhalla Map-Matching & OSM-Korridor wird abgefragt...' }
    }));

    try {
      const apiUrl = getApiUrl("/api/analyze-surface");
      let result: Response;
      
      const requestPayload = safeStringifyOrFallback({
        points: pointsToAnalyze,
        name: trackName,
        activityType: activityType,
        force
      }, '{}');

      const requestHeaders = {
        "Content-Type": "application/json"
      };

      try {
        result = await apiFetch(apiUrl, {
          method: "POST",
          headers: requestHeaders,
          body: requestPayload
        });
      } catch (firstErr) {
        // Fall back to relative URL if absolute constructed URL threw a DOMException/network error
        if (apiUrl !== "/api/analyze-surface") {
          result = await apiFetch("/api/analyze-surface", {
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
              surface: data.surfaces[idx] || "Unbekannt"
            }));
            return {
              ...t,
              points: updatedPoints,
              surfaceStats: data.surfaceStats
            };
          }
          return t;
        }));

        const coveragePct = typeof data.coveragePct === 'number' ? data.coveragePct : 100;
        const source = (data.source || 'valhalla+osm') as 'valhalla+osm' | 'valhalla' | 'overpass' | 'embedded' | 'unavailable';
        const sourceLabel =
          source === 'valhalla+osm'
            ? 'Valhalla + OSM'
            : source === 'valhalla'
            ? 'Valhalla Map-Matching'
            : source === 'overpass'
            ? 'OSM-Korridor'
            : source === 'embedded'
            ? 'GPX-Metadaten'
            : 'Keine OSM-/Valhalla-Daten';

        const cacheSuffix = data.cached ? ' · Cache' : '';

        if (coveragePct === 0 || source === 'unavailable') {
          setSurfaceAnalysisStatuses(prev => ({
            ...prev,
            [trackId]: {
              status: 'partial',
              source: 'unavailable',
              coveragePct: 0,
              cached: Boolean(data.cached),
              message: data.notice || 'Keine OSM-/Valhalla-Daten gefunden — Strecke als Unbekannt markiert.',
              timestamp: Date.now()
            }
          }));
        } else if (coveragePct < 100) {
          setSurfaceAnalysisStatuses(prev => ({
            ...prev,
            [trackId]: {
              status: 'partial',
              source,
              coveragePct,
              cached: Boolean(data.cached),
              message: `${sourceLabel}: ${coveragePct}% erfasst · übrige Abschnitte Unbekannt${cacheSuffix}`,
              timestamp: Date.now()
            }
          }));
        } else {
          setSurfaceAnalysisStatuses(prev => ({
            ...prev,
            [trackId]: {
              status: 'success',
              source,
              coveragePct: 100,
              cached: Boolean(data.cached),
              message: `${sourceLabel}: 100% verifiziert (${data.surfaceStats.length} Belagsarten)${cacheSuffix}`,
              timestamp: Date.now()
            }
          }));
        }
      } else {
        throw new Error("Daten von Valhalla / OpenStreetMap sind unvollständig.");
      }
    } catch (err: any) {
      console.error("[Surface Analyzer] Error for track", trackId, err);
      setSurfaceAnalysisStatuses(prev => ({
        ...prev,
        [trackId]: {
          status: 'error',
          message: err.message || 'Verbindung zu Valhalla / OpenStreetMap fehlgeschlagen.',
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

  const handleExtractSubTrack = useCallback((startKm: number, endKm: number) => {
    const active = tracks.find(t => t.id === markedTrackId) || tracks[0];
    if (!active) return;

    const extracted = sliceTrackRange(
      active,
      startKm,
      endKm,
      `${active.name} (km ${startKm.toFixed(1)}–${endKm.toFixed(1)})`,
      ftp,
      userWeight,
      estimatedSpeed
    );
    if (!extracted) return;

    saveToHistory();
    setTracks(prev => [...prev, extracted]);
    setMarkedTrackId(extracted.id);
    setSelectionBounds(null);
    setSuccessMessage(`Teil-Track "${extracted.name}" (${extracted.distance} km, +${Math.round(extracted.ascent)} m) als eigene Route erstellt!`);
  }, [tracks, markedTrackId, ftp, userWeight, estimatedSpeed, saveToHistory]);

  const handleCropTrack = useCallback((startKm: number, endKm: number) => {
    const active = tracks.find(t => t.id === markedTrackId) || tracks[0];
    if (!active) return;

    const cropped = sliceTrackRange(
      active,
      startKm,
      endKm,
      `${active.name} (Zugeschnitten km ${startKm.toFixed(1)}–${endKm.toFixed(1)})`,
      ftp,
      userWeight,
      estimatedSpeed
    );
    if (!cropped) return;

    saveToHistory();
    const updatedTrack: GPXTrack = {
      ...cropped,
      id: active.id
    };
    setTracks(prev => prev.map(t => t.id === active.id ? updatedTrack : t));
    setSelectionBounds(null);
    setSuccessMessage(`Track auf Abschnitt km ${startKm.toFixed(1)}–${endKm.toFixed(1)} (${updatedTrack.distance} km) zugeschnitten! (Rückgängig mit Strg+Z)`);
  }, [tracks, markedTrackId, ftp, userWeight, estimatedSpeed, saveToHistory]);

  const handleReverseTrack = useCallback((trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    saveToHistory();
    const reversed = reverseTrack(track, ftp, userWeight, estimatedSpeed);
    setTracks(prev => prev.map(t => t.id === trackId ? reversed : t));
    setSuccessMessage(`Route "${reversed.name}" erfolgreich umgekehrt! (Gegenrichtung aktiv)`);
    triggerHaptic('success');
  }, [tracks, ftp, userWeight, estimatedSpeed, saveToHistory]);

  const handleShiftLoopStart = useCallback((trackId: string, pointIndex: number) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    saveToHistory();
    const shifted = shiftLoopStartTrack(track, pointIndex, ftp, userWeight, estimatedSpeed);
    setTracks(prev => prev.map(t => t.id === trackId ? shifted : t));
    setSuccessMessage(`Startpunkt der Route auf Punkt #${pointIndex + 1} verlegt!`);
    triggerHaptic('success');
  }, [tracks, ftp, userWeight, estimatedSpeed, saveToHistory]);

  const handleSanitizeTrack = useCallback((trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    saveToHistory();
    const res = sanitizeTrackAllInOne(track, { removeSpikes: true, smoothElevation: true, simplifyPoints: true }, ftp, userWeight, estimatedSpeed);
    setTracks(prev => prev.map(t => t.id === trackId ? res.sanitizedTrack : t));
    const msg = `Track bereinigt: ${res.removedOutliers} GPS-Ausreißer entfernt, ${res.fixedSpikes} Höhen-Spikes geglättet, ${res.reducedPoints} Punkte reduziert.`;
    setSuccessMessage(msg);
    triggerHaptic('success');
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
 
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement> | { target?: { files?: FileList | File[] | null; value?: string } } | FileList | File[]) => {
    let files: FileList | File[] | null = null;
    if (Array.isArray(e)) {
      files = e;
    } else if (typeof FileList !== 'undefined' && e instanceof FileList) {
      files = e;
    } else if (e && 'target' in e && e.target && e.target.files) {
      files = e.target.files;
    } else if (e && 'files' in (e as any)) {
      files = (e as any).files;
    }
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
    if (e && typeof e === 'object' && 'target' in e && e.target && 'value' in e.target) {
      (e.target as any).value = '';
    }
  }, [tracks, saveToHistory, ftp, userWeight, estimatedSpeed, setSelectedDate, setSelectedTime]);

  const commitApprovedTracks = useCallback((approvedTracks: GPXTrack[], fitMeta?: { fitDate: string | null; fitTime: string | null }) => {
    if (approvedTracks.length === 0) return;
    saveToHistory();
    setTracks(prev => [...prev, ...approvedTracks]);
    
    if (fitMeta && fitMeta.fitDate && fitMeta.fitTime) {
      setSelectedDate(fitMeta.fitDate);
      setSelectedTime(fitMeta.fitTime);
    } else if (approvedTracks[0]?.dateCreated) {
      const dt = new Date(approvedTracks[0].dateCreated);
      if (!isNaN(dt.getTime())) {
        setSelectedDate(dt.toISOString().split('T')[0]);
        const hours = String(dt.getHours()).padStart(2, '0');
        const minutes = String(dt.getMinutes()).padStart(2, '0');
        setSelectedTime(`${hours}:${minutes}`);
      }
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

    if (appPrefs.autoSurfaceAnalysis) {
      for (const tr of approvedTracks) {
        if (hasRealGpsData(tr)) {
          setTimeout(() => analyzeTrackSurface(tr.id, false), 120);
        }
      }
    }
  }, [saveToHistory, setSelectedDate, setSelectedTime, appPrefs.autoSurfaceAnalysis, analyzeTrackSurface]);

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

  const handleToggleAllVisibility = useCallback((makeAllVisible: boolean) => {
    setTracks(prev => prev.map(t => ({ ...t, visible: makeAllVisible })));
  }, []);

  const handleFitVisibleTracks = useCallback((fallbackBounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number }) => {
    const visibleGpsTracks = tracksRef.current.filter(t => t.visible && hasRealGpsData(t));
    const tightBounds = computeTightTrackBounds(visibleGpsTracks) || fallbackBounds || null;
    if (!tightBounds) return;

    if (is3D) {
      const latDiff = Math.max(0.002, tightBounds.maxLat - tightBounds.minLat);
      const lngDiff = Math.max(0.002, tightBounds.maxLng - tightBounds.minLng);
      const maxDelta = Math.max(latDiff, lngDiff);
      let estimatedZoom = Math.floor(Math.log2(360 / maxDelta));
      estimatedZoom = Math.min(18, Math.max(6, estimatedZoom));

      setMapView(prev => ({
        ...prev,
        lat: (tightBounds.minLat + tightBounds.maxLat) / 2,
        lng: (tightBounds.minLng + tightBounds.maxLng) / 2,
        zoom: estimatedZoom
      }));
    } else {
      window.dispatchEvent(new CustomEvent('fit-active-track', { detail: tightBounds }));
    }

    triggerHaptic('light');
  }, [is3D]);
 
  const removeTrack = useCallback((id: string) => {
    saveToHistory();
    setTracks(prev => {
      const next = prev.filter(t => t.id !== id);
      if (markedTrackId === id) {
        setMarkedTrackId(next[0]?.id ?? null);
      }
      return next;
    });
    if (compareTrackId === id) {
      setCompareTrackId(null);
    }
  }, [saveToHistory, markedTrackId, compareTrackId]);

  const clearWorkspaceTracks = useCallback(() => {
    if (tracks.length === 0) return;
    saveToHistory();
    setTracks([]);
    setMarkedTrackId(null);
    setCompareTrackId(null);
  }, [tracks.length, saveToHistory]);

  const keepOnlyTrack = useCallback((id: string) => {
    if (tracks.length <= 1) return;
    saveToHistory();
    setTracks(prev => prev.filter(t => t.id === id));
    setMarkedTrackId(id);
    setCompareTrackId(null);
  }, [tracks.length, saveToHistory]);

  const removeHiddenTracks = useCallback(() => {
    if (!tracks.some(t => !t.visible)) return;
    saveToHistory();
    setTracks(prev => prev.filter(t => t.visible));
  }, [tracks, saveToHistory]);

  const removeDuplicateTracks = useCallback(() => {
    const analysis = findDuplicateTracksByIdenticalGPS(tracks, markedTrackId);
    if (analysis.duplicateIds.length === 0) {
      triggerHaptic('light');
      setSuccessMessage('Keine doppelten Strecken mit identischen GPS-Koordinaten gefunden.');
      return;
    }

    saveToHistory();
    const removeSet = new Set(analysis.duplicateIds);
    setTracks(analysis.uniqueTracks);

    if (markedTrackId && removeSet.has(markedTrackId)) {
      setMarkedTrackId(analysis.uniqueTracks[0]?.id ?? null);
    }
    if (compareTrackId && removeSet.has(compareTrackId)) {
      setCompareTrackId(null);
    }

    triggerHaptic('medium');
    const count = analysis.duplicateIds.length;
    setSuccessMessage(
      `${count} doppelte ${count === 1 ? 'Strecke' : 'Strecken'} mit identischen GPS-Koordinaten entfernt (Strg+Z für Rückgängig).`
    );
  }, [tracks, markedTrackId, compareTrackId, saveToHistory]);

  const hydrateTrackSurface = useCallback((tr: GPXTrack): GPXTrack => {
    if (tr.points && tr.points.length > 0) {
      const calcStats = calculateSurfaceStatsFromPoints(tr.points);
      const surfaceStats = calcStats.length > 0 ? calcStats : (tr.surfaceStats && tr.surfaceStats.length > 0 ? tr.surfaceStats : []);
      const nextTrack = { ...tr, surfaceStats, visible: true };
      hydratePointsWithSurface(nextTrack.points, surfaceStats, nextTrack.distance);
      return nextTrack;
    }
    return { ...tr, visible: true };
  }, []);

  const replaceWorkspaceWithTracks = useCallback((incomingTracks: GPXTrack[], jumpToMap = true) => {
    if (!incomingTracks || incomingTracks.length === 0) return;
    const prepared = incomingTracks.map(hydrateTrackSurface);
    saveToHistory();
    setTracks(prepared);
    const primary = prepared[0];
    setMarkedTrackId(primary?.id ?? null);
    setCompareTrackId(null);
    setIsProfileCollapsed(!appPrefs.showElevationProfile);

    const gpsTracks = prepared.filter(tr => hasRealGpsData(tr));
    if (jumpToMap) {
      navigateWorkspace('map');
    }
    const tightBounds = appPrefs.autoFitOnLoad ? computeTightTrackBounds(gpsTracks) : null;
    if (tightBounds) {
      if (is3D) {
        const latDiff = Math.max(0.002, tightBounds.maxLat - tightBounds.minLat);
        const lngDiff = Math.max(0.002, tightBounds.maxLng - tightBounds.minLng);
        const maxDelta = Math.max(latDiff, lngDiff);
        let estimatedZoom = Math.floor(Math.log2(360 / maxDelta));
        estimatedZoom = Math.min(18, Math.max(6, estimatedZoom));
        setMapView(prev => ({
          ...prev,
          lat: (tightBounds.minLat + tightBounds.maxLat) / 2,
          lng: (tightBounds.minLng + tightBounds.maxLng) / 2,
          zoom: estimatedZoom
        }));
      } else {
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
          window.dispatchEvent(new CustomEvent('fit-active-track', { detail: tightBounds }));
        }, 40);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('fit-active-track', { detail: tightBounds }));
        }, 260);
      }
    }
    triggerHaptic('success');
  }, [hydrateTrackSurface, saveToHistory, navigateWorkspace, is3D, appPrefs.showElevationProfile, appPrefs.autoFitOnLoad]);
 
  const handleMerge = useCallback(() => {
    if (tracks.length < 2) return;
    saveToHistory();
    const merged = mergeTracks(tracks);
    merged.powerStats = calculatePowerStats(merged.points, ftp, userWeight, estimatedSpeed);
    setTracks([merged]);
    setMarkedTrackId(merged.id);
    setCompareTrackId(null);
    setSuccessMessage(`${tracks.length} Abschnitte erfolgreich zu einer Gesamttour zusammengeführt!`);
    triggerHaptic('medium');
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
    const preparedTrack = hydrateTrackSurface(track);
    const dupCheck = checkTrackDuplicateGPS(preparedTrack, tracks);

    setTracks(prev => {
      if (prev.some(t => t.id === preparedTrack.id)) {
        return prev.map(t => t.id === preparedTrack.id ? { ...t, visible: true } : t);
      }
      if (dupCheck.isDuplicate && dupCheck.matchedTrackId) {
        return prev.map(t => t.id === dupCheck.matchedTrackId ? { ...t, visible: true } : t);
      }
      return [...prev, preparedTrack];
    });

    if (dupCheck.matchedTrackId) {
      setMarkedTrackId(dupCheck.matchedTrackId);
    } else {
      setMarkedTrackId(preparedTrack.id);
    }

    const tightBounds = appPrefs.autoFitOnLoad ? computeTightTrackBounds([preparedTrack]) : null;
    if (tightBounds) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('fit-active-track', { detail: tightBounds }));
      }, 40);
    }
  }, [tracks, hydrateTrackSurface, appPrefs.autoFitOnLoad]);

  const handleLoadCatalogTracksToMap = useCallback((
    loadedTracks: GPXTrack[],
    options?: { jumpToMap?: boolean; fitToTracks?: boolean; openStatsModal?: boolean }
  ) => {
    if (!loadedTracks || loadedTracks.length === 0) return;

    const hydratedPrepared = loadedTracks.map((tr) => {
      if (tr.points && tr.points.length > 0) {
        const calcStats = calculateSurfaceStatsFromPoints(tr.points);
        const surfaceStats = calcStats.length > 0 ? calcStats : (tr.surfaceStats && tr.surfaceStats.length > 0 ? tr.surfaceStats : []);
        const nextTrack = { ...tr, surfaceStats, visible: true };
        hydratePointsWithSurface(nextTrack.points, surfaceStats, nextTrack.distance);
        return nextTrack;
      }
      return { ...tr, visible: true };
    });

    let primaryTrackId: string | null = null;
    let addedCount = 0;

    setTracks((prev) => {
      const next = [...prev];
      for (const incoming of hydratedPrepared) {
        const byIdIdx = next.findIndex((t) => t.id === incoming.id);
        if (byIdIdx !== -1) {
          const prevTrack = next[byIdIdx];
          const incomingMeta = getKomootSourceMeta(incoming);
          const prevMeta = getKomootSourceMeta(prevTrack);
          if (incomingMeta && (!prevMeta || incomingMeta.version >= prevMeta.version)) {
            next[byIdIdx] = { ...incoming, visible: true };
          } else {
            next[byIdIdx] = { ...prevTrack, visible: true };
          }
          if (!primaryTrackId) primaryTrackId = next[byIdIdx].id;
          continue;
        }
        const dup = checkTrackDuplicateGPS(incoming, next);
        if (dup.isDuplicate && dup.matchedTrackId) {
          const matchIdx = next.findIndex((t) => t.id === dup.matchedTrackId);
          if (matchIdx !== -1) {
            next[matchIdx] = { ...next[matchIdx], visible: true };
            if (!primaryTrackId) primaryTrackId = next[matchIdx].id;
          }
          continue;
        }
        next.push(incoming);
        addedCount++;
        if (!primaryTrackId) primaryTrackId = incoming.id;
      }
      return next;
    });

    if (primaryTrackId) {
      setMarkedTrackId(primaryTrackId);
      setIsProfileCollapsed(!appPrefs.showElevationProfile);
    }

    const gpsTracks = hydratedPrepared.filter((tr) => hasRealGpsData(tr));

    if (options?.jumpToMap !== false && !options?.openStatsModal && gpsTracks.length > 0) {
      navigateWorkspace('map');
    } else if (options?.openStatsModal || gpsTracks.length === 0) {
      setIntensiveAnalysisTab('overview');
      setIntensiveAnalysisOpen(true);
    }

    if (options?.fitToTracks !== false && appPrefs.autoFitOnLoad && gpsTracks.length > 0) {
      const tightBounds = computeTightTrackBounds(gpsTracks);
      if (tightBounds) {
        if (is3D) {
          handleFitVisibleTracks(tightBounds);
        } else {
          setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
            window.dispatchEvent(new CustomEvent('fit-active-track', { detail: tightBounds }));
          }, 50);
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('fit-active-track', { detail: tightBounds }));
          }, 260);
        }
      }
    }

    triggerHaptic('success');
  }, [handleFitVisibleTracks, navigateWorkspace, is3D, appPrefs.showElevationProfile, appPrefs.autoFitOnLoad]);

  const handleCatalogActivityMetadataUpdated = useCallback((
    workspaceTrackId: string,
    updates: { name: string; activityType: 'cycling' | 'running'; description?: string; tags?: string[] }
  ) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.id === workspaceTrackId
          ? {
              ...t,
              name: updates.name,
              activityType: updates.activityType,
              description: updates.description ?? t.description,
              tags: updates.tags ?? t.tags
            }
          : t
      )
    );
  }, []);

  const handleSaveTrackToLibrary = useCallback(async (id: string) => {
    const track = tracks.find(t => t.id === id);
    if (!track) return;

    try {
      const response = await apiFetch(getApiUrl('/api/library'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: safeStringifyOrFallback(track, '{}')
      });
      const data = await response.json();
      if (data.success) {
        setSuccessMessage(`"${track.name}" wurde erfolgreich in der SQLite-Bibliothek gespeichert!`);
        refreshCatalogTotalCount();
      } else {
        setErrorMessage(data.error || 'Fehler beim Speichern in der Bibliothek.');
      }
    } catch (err) {
      console.error('Failed to save track to library:', err);
      setErrorMessage('Speichern in der Bibliothek fehlgeschlagen.');
    }
  }, [tracks, refreshCatalogTotalCount]);

  const handleImportFromUrl = useCallback(async (
    url: string,
    options?: { saveAsPlannedTour?: boolean }
  ): Promise<{ success: boolean; error?: string; message?: string }> => {
    const trimmedUrl = String(url || '').trim();
    if (!trimmedUrl) {
      return { success: false, error: 'Bitte gib eine gültige URL ein.' };
    }

    try {
      const response = await apiFetch(getApiUrl('/api/import-url'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmedUrl })
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        return {
          success: false,
          error: data?.error || `URL-Import fehlgeschlagen (HTTP ${response.status}).`
        };
      }

      if (data.kind === 'collection' && Array.isArray(data.tours)) {
        setPendingKomootCollection({
          collectionId: String(data.collectionId || ''),
          title: String(data.title || 'Komoot Collection'),
          sourceUrl: String(data.sourceUrl || trimmedUrl),
          tours: data.tours
        });
        setIsMobileMenuOpen(false);
        triggerHaptic('light');
        return {
          success: true,
          message: `${data.tours.length} Touren gefunden`
        };
      }

      if (!data.gpxContent) {
        return {
          success: false,
          error: 'Die abgerufene URL enthielt keine GPX-Daten.'
        };
      }

      const validation = validateGPX(data.gpxContent);
      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error || 'Die abgerufene Datei enthält keine gültigen GPX-Daten.'
        };
      }

      const fallbackFileName = `${data.suggestedName || 'URL-Route'}.gpx`;
      const parsed = await parseGPX(data.gpxContent, fallbackFileName);
      if (!parsed || !parsed.points || parsed.points.length < 2) {
        return {
          success: false,
          error: 'Es konnten keine gültigen GPS-Trackpunkte aus dieser URL geladen werden.'
        };
      }

      if (data.suggestedName && (!parsed.name || parsed.name === fallbackFileName.replace(/\.gpx$/i, ''))) {
        parsed.name = String(data.suggestedName).trim();
      }
      if (data.activityType === 'running') {
        parsed.activityType = 'running';
      }

      parsed.powerStats = calculatePowerStats(parsed.points, ftp, userWeight, estimatedSpeed, parsed.activityType);
      const surfStats = calculateSurfaceStatsFromPoints(parsed.points);
      if (surfStats.length > 0) {
        parsed.surfaceStats = surfStats;
        hydratePointsWithSurface(parsed.points, surfStats, parsed.distance);
      }

      const baseTags = Array.isArray(parsed.tags) ? [...parsed.tags] : [];
      if (data.sourceType === 'komoot' && !baseTags.includes('Komoot')) {
        baseTags.push('Komoot');
      }
      if (options?.saveAsPlannedTour && !baseTags.includes('Geplante Tour')) {
        baseTags.push('Geplante Tour');
      }
      parsed.tags = baseTags;

      const sourceAttachParams = {
        sourceType: (data.sourceType === 'komoot' ? 'komoot' : 'gpx') as 'komoot' | 'gpx',
        sourceUrl: String(data.sourceUrl || trimmedUrl),
        komootTourId: typeof data.komootTourId === 'string' ? data.komootTourId : undefined,
        komootShareToken: data.komootShareToken ?? null,
        remoteUpdatedAt: typeof data.remoteUpdatedAt === 'string' ? data.remoteUpdatedAt : undefined
      };

      const currentTracks = tracksRef.current;
      const sourceMatch = findMatchingExistingKomootTrack(currentTracks, {
        komootTourId: sourceAttachParams.komootTourId,
        sourceUrl: sourceAttachParams.sourceUrl
      });

      let activeTargetTrack: GPXTrack;
      let statusSummary = '';

      if (sourceMatch) {
        const refreshRes = applyKomootRefreshToTrack(sourceMatch, parsed, sourceAttachParams);
        activeTargetTrack = { ...refreshRes.track, visible: true };
        if (refreshRes.updated) {
          saveToHistory();
          statusSummary = `"${activeTargetTrack.name}" auf v${refreshRes.newVersion} aktualisiert!`;
        } else {
          statusSummary = `"${activeTargetTrack.name}" ist bereits aktuell (v${refreshRes.newVersion}).`;
        }
        setTracks((prev) =>
          prev.map((t) => (t.id === sourceMatch.id ? activeTargetTrack : t))
        );
        setMarkedTrackId(sourceMatch.id);
      } else {
        activeTargetTrack = attachKomootSourceToTrack(parsed, sourceAttachParams);
        const dupCheck = checkTrackDuplicateGPS(activeTargetTrack, currentTracks);
        if (dupCheck.isDuplicate && dupCheck.matchedTrackId) {
          const existing = currentTracks.find((t) => t.id === dupCheck.matchedTrackId);
          if (existing) {
            const refreshRes = applyKomootRefreshToTrack(existing, activeTargetTrack, sourceAttachParams);
            activeTargetTrack = { ...refreshRes.track, visible: true };
            setTracks((prev) =>
              prev.map((t) => (t.id === existing.id ? activeTargetTrack : t))
            );
            setMarkedTrackId(existing.id);
            statusSummary = refreshRes.updated
              ? `"${activeTargetTrack.name}" auf v${refreshRes.newVersion} aktualisiert!`
              : `"${activeTargetTrack.name}" bereits geladen (v${refreshRes.newVersion}).`;
          }
        } else {
          commitApprovedTracks([activeTargetTrack]);
          setMarkedTrackId(activeTargetTrack.id);
          statusSummary = `"${activeTargetTrack.name}" per URL (v1) auf Karte geladen!`;
        }
      }

      if (options?.saveAsPlannedTour) {
        try {
          const libRes = await apiFetch(getApiUrl('/api/library'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: safeStringifyOrFallback(activeTargetTrack, '{}')
          });
          const libData = await libRes.json();
          if (libData?.success) {
            refreshCatalogTotalCount();
          }
        } catch (saveErr) {
          console.warn('Saving URL-imported track as Planned Tour failed:', saveErr);
        }
      }

      setCompareTrackId(null);
      setIsMobileMenuOpen(false);
      setIsProfileCollapsed(!appPrefs.showElevationProfile);
      navigateWorkspace('map');

      if (appPrefs.autoFitOnLoad && hasRealGpsData(activeTargetTrack)) {
        const tightBounds = computeTightTrackBounds([activeTargetTrack]);
        if (tightBounds) {
          if (is3D) {
            handleFitVisibleTracks(tightBounds);
          } else {
            setTimeout(() => {
              window.dispatchEvent(new Event('resize'));
              window.dispatchEvent(new CustomEvent('fit-active-track', { detail: tightBounds }));
            }, 50);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('fit-active-track', { detail: tightBounds }));
            }, 260);
          }
        }
      }

      triggerHaptic('success');
      setSuccessMessage(statusSummary);
      setTimeout(() => setSuccessMessage(null), 4500);

      return { success: true };
    } catch (err: any) {
      console.error('URL import error:', err);
      return {
        success: false,
        error: err?.message || 'Netzwerkfehler beim Importieren der URL.'
      };
    }
  }, [
    ftp,
    userWeight,
    estimatedSpeed,
    commitApprovedTracks,
    saveToHistory,
    refreshCatalogTotalCount,
    appPrefs.showElevationProfile,
    appPrefs.autoFitOnLoad,
    navigateWorkspace,
    is3D,
    handleFitVisibleTracks
  ]);

  const handleRefreshTrackFromKomoot = useCallback(async (trackId: string) => {
    const existing = tracksRef.current.find((t) => t.id === trackId);
    if (!existing) return;

    const komootMeta = getKomootSourceMeta(existing);
    if (!komootMeta?.sourceUrl) {
      setErrorMessage('Dieser Track besitzt keine verknüpfte Komoot- oder URL-Quelle.');
      setTimeout(() => setErrorMessage(null), 4000);
      return;
    }

    setRefreshingKomootTracks((prev) => ({ ...prev, [trackId]: true }));
    try {
      const response = await apiFetch(getApiUrl('/api/import-url'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: komootMeta.sourceUrl })
      });
      const data = await response.json();
      if (!response.ok || !data?.success || !data.gpxContent) {
        throw new Error(data?.error || `Aktualisierung fehlgeschlagen (HTTP ${response.status}).`);
      }

      const validation = validateGPX(data.gpxContent);
      if (!validation.isValid) {
        throw new Error(validation.error || 'Die abgerufenen GPX-Daten sind ungültig.');
      }

      const fallbackFileName = `${data.suggestedName || existing.name || 'Komoot-Tour'}.gpx`;
      const parsed = await parseGPX(data.gpxContent, fallbackFileName);
      if (!parsed || !parsed.points || parsed.points.length < 2) {
        throw new Error('Es konnten keine gültigen GPS-Koordinaten geladen werden.');
      }

      if (data.suggestedName && (!parsed.name || parsed.name === fallbackFileName.replace(/\.gpx$/i, ''))) {
        parsed.name = String(data.suggestedName).trim();
      }
      if (data.activityType === 'running') {
        parsed.activityType = 'running';
      }

      parsed.powerStats = calculatePowerStats(parsed.points, ftp, userWeight, estimatedSpeed, parsed.activityType);
      const surfStats = calculateSurfaceStatsFromPoints(parsed.points);
      if (surfStats.length > 0) {
        parsed.surfaceStats = surfStats;
        hydratePointsWithSurface(parsed.points, surfStats, parsed.distance);
      }

      const refreshRes = applyKomootRefreshToTrack(existing, parsed, {
        sourceType: (data.sourceType === 'gpx' ? 'gpx' : 'komoot'),
        sourceUrl: String(data.sourceUrl || komootMeta.sourceUrl),
        komootTourId: typeof data.komootTourId === 'string' ? data.komootTourId : komootMeta.komootTourId,
        komootShareToken: data.komootShareToken ?? komootMeta.komootShareToken ?? null,
        komootCollectionId: komootMeta.komootCollectionId,
        komootCollectionTitle: komootMeta.komootCollectionTitle,
        komootCollectionUrl: komootMeta.komootCollectionUrl,
        remoteUpdatedAt: typeof data.remoteUpdatedAt === 'string' ? data.remoteUpdatedAt : undefined
      });

      if (refreshRes.updated) {
        saveToHistory();
      }

      setTracks((prev) =>
        prev.map((t) => (t.id === trackId ? refreshRes.track : t))
      );

      // Keep Planned Tours DB copy synchronized if this track is already stored in the library
      try {
        const existsRes = await apiFetch(getApiUrl(`/api/library/${encodeURIComponent(existing.id)}`));
        if (existsRes.ok) {
          await apiFetch(getApiUrl('/api/library'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: safeStringifyOrFallback(refreshRes.track, '{}')
          });
          refreshCatalogTotalCount();
        }
      } catch {
        // Non-fatal: workspace track is still updated
      }

      triggerHaptic('success');
      setSuccessMessage(
        refreshRes.updated
          ? `"${refreshRes.track.name}" auf v${refreshRes.newVersion} aktualisiert!`
          : `"${refreshRes.track.name}" ist bereits auf dem neuesten Stand (v${refreshRes.newVersion}).`
      );
      setTimeout(() => setSuccessMessage(null), 4500);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Komoot-Aktualisierung fehlgeschlagen.');
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setRefreshingKomootTracks((prev) => {
        const next = { ...prev };
        delete next[trackId];
        return next;
      });
    }
  }, [ftp, userWeight, estimatedSpeed, saveToHistory, refreshCatalogTotalCount]);

  const handleSyncRefreshedTracksToWorkspace = useCallback((refreshedTracks: GPXTrack[]) => {
    if (!refreshedTracks || refreshedTracks.length === 0) return;
    const byId = new globalThis.Map(refreshedTracks.map((tr) => [tr.id, tr]));
    setTracks((prev) => {
      let changed = false;
      const next = prev.map((existing) => {
        const updated = byId.get(existing.id);
        if (!updated) return existing;
        changed = true;
        return {
          ...updated,
          visible: existing.visible,
          color: existing.color || updated.color
        };
      });
      return changed ? next : prev;
    });
  }, []);

  const handleKomootCollectionComplete = useCallback((result: KomootCollectionImportCompletion) => {
    setPendingKomootCollection(null);

    if (result.savedToPlanned) {
      refreshCatalogTotalCount();
    }

    if (result.openOnMap && result.importedTracks.length > 0) {
      handleLoadCatalogTracksToMap(result.importedTracks, {
        jumpToMap: true,
        fitToTracks: true
      });
    }

    const count = result.importedTracks.length;
    const parts: string[] = [
      `${count} ${count === 1 ? 'Tour' : 'Touren'} aus „${result.collectionTitle}“ importiert`
    ];
    if (result.updatedCount && result.updatedCount > 0) {
      parts.push(`${result.updatedCount} aktualisiert`);
    }
    if (result.savedToPlanned) parts.push('in Geplante Touren gruppiert');
    if (result.openOnMap) parts.push('auf Karte geöffnet');
    if (result.failedCount > 0) {
      parts.push(`${result.failedCount} übersprungen`);
    }

    setSuccessMessage(`${parts.join(' · ')}!`);
    setTimeout(() => setSuccessMessage(null), 5000);
  }, [refreshCatalogTotalCount, handleLoadCatalogTracksToMap]);

  const handleStartMapComparison = useCallback((track1Id?: string, track2Id?: string) => {
    const currentTracks = tracksRef.current;
    if (currentTracks.length < 2) {
      setErrorMessage('Bitte lade mindestens 2 Strecken in den Workspace, um sie auf der Karte zu vergleichen.');
      return;
    }

    const resolved1 = (track1Id && currentTracks.find(t => t.id === track1Id))
      || (markedTrackId && currentTracks.find(t => t.id === markedTrackId))
      || currentTracks.find(t => t.visible)
      || currentTracks[0];

    const resolved2 = (track2Id && track2Id !== resolved1?.id && currentTracks.find(t => t.id === track2Id))
      || (compareTrackId && compareTrackId !== resolved1?.id && currentTracks.find(t => t.id === compareTrackId))
      || currentTracks.find(t => t.id !== resolved1?.id && t.visible)
      || currentTracks.find(t => t.id !== resolved1?.id);

    if (!resolved1 || !resolved2 || resolved1.id === resolved2.id) {
      setErrorMessage('Es müssen zwei unterschiedliche Strecken für den Karten-Vergleich ausgewählt sein.');
      return;
    }

    setTracks(prev => prev.map(t =>
      (t.id === resolved1.id || t.id === resolved2.id) && !t.visible
        ? { ...t, visible: true }
        : t
    ));

    setMarkedTrackId(resolved1.id);
    setCompareTrackId(resolved2.id);
    setIs3D(false);
    setIsMobileMenuOpen(false);
    setIsProfileCollapsed(false);
    navigateWorkspace('map');

    const pairBounds = computeTightTrackBounds([resolved1, resolved2].filter(t => hasRealGpsData(t)));
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new CustomEvent('fit-active-track', pairBounds ? { detail: pairBounds } : undefined));
    }, 60);
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('fit-active-track', pairBounds ? { detail: pairBounds } : undefined));
    }, 280);

    triggerHaptic('medium');
  }, [markedTrackId, compareTrackId, navigateWorkspace]);

  const handleExitMapComparison = useCallback(() => {
    setCompareTrackId(null);
  }, []);

  const handleCompareTwoToursOnMap = useCallback((tour1: GPXTrack, tour2: GPXTrack) => {
    const prepared1 = hydrateTrackSurface(tour1);
    const prepared2 = hydrateTrackSurface(tour2);

    const existing = tracksRef.current;
    const findOrNewId = (tr: GPXTrack, list: GPXTrack[]): string => {
      const byId = list.find(t => t.id === tr.id);
      if (byId) return byId.id;
      const dup = checkTrackDuplicateGPS(tr, list);
      if (dup.isDuplicate && dup.matchedTrackId) return dup.matchedTrackId;
      return tr.id;
    };

    const id1 = findOrNewId(prepared1, existing);
    const id2 = findOrNewId(prepared2, [...existing, prepared1]);

    setTracks(prev => {
      const next = [...prev];
      const upsert = (tr: GPXTrack, targetId: string) => {
        const idx = next.findIndex(t => t.id === targetId);
        if (idx !== -1) {
          next[idx] = { ...next[idx], visible: true };
        } else {
          next.push(tr);
        }
      };
      upsert(prepared1, id1);
      upsert(prepared2, id2);
      return next;
    });

    setMarkedTrackId(id1);
    setCompareTrackId(id1 !== id2 ? id2 : null);
    setIs3D(false);
    setIsProfileCollapsed(false);
    navigateWorkspace('map');

    const pairBounds = computeTightTrackBounds([prepared1, prepared2].filter(t => hasRealGpsData(t)));
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new CustomEvent('fit-active-track', pairBounds ? { detail: pairBounds } : undefined));
    }, 60);
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('fit-active-track', pairBounds ? { detail: pairBounds } : undefined));
    }, 280);

    triggerHaptic('success');
  }, [hydrateTrackSurface, navigateWorkspace]);

  const markedTrack = tracks.find(t => t.id === markedTrackId) || tracks[0];
  const suggestedFtp = markedTrack?.powerStats?.best20m ? Math.round(markedTrack.powerStats.best20m * 0.95) : null;

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
        if (pendingKomootCollection) { setPendingKomootCollection(null); return; }
        if (settingsModalOpen) { setSettingsModalOpen(false); return; }
        if (shortcutsModalOpen) { setShortcutsModalOpen(false); return; }
        if (glossaryOpen) { setGlossaryOpen(false); return; }
        if (intensiveAnalysisOpen) { setIntensiveAnalysisOpen(false); return; }
        if (comparisonOpen) { setComparisonOpen(false); return; }
        if (weatherOpen) { setWeatherOpen(false); return; }
        if (timeGapModalOpen) { setTimeGapModalOpen(false); return; }
        if (validationModalOpen) { setValidationModalOpen(false); return; }
        if (isExportModalOpen) { setIsExportModalOpen(false); return; }
        if (selectionBounds) { setSelectionBounds(null); return; }
        return;
      }

      // ',' shortcut: Open Settings & UI Style Menu
      if (e.key === ',' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        triggerHaptic('light');
        openSettingsModal('style');
        return;
      }

      // Help / Keyboard shortcuts: '?' or 'Shift + /' or 'F1'
      if (e.key === '?' || (e.key === '/' && e.shiftKey) || e.key === 'F1') {
        e.preventDefault();
        triggerHaptic('light');
        setShortcutsModalOpen(prev => !prev);
        return;
      }

      // '3' shortcut: Toggle 3D Terrain mode
      if (e.key === '3' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        triggerHaptic('medium');
        setIs3D(prev => {
          const next = !prev;
          setSuccessMessage(next ? '3D-Geländemodus aktiviert (Taste 3)' : 'Standard 2D-Kartenansicht aktiviert (Taste 3)');
          return next;
        });
        return;
      }

      // 'G' shortcut: Toggle Sport Metrics Glossary
      if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        triggerHaptic('light');
        setGlossaryOpen(prev => !prev);
        return;
      }

      // 'A' or 'I' shortcut: Open Intensive Track Analysis
      if ((e.key === 'a' || e.key === 'A' || e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        triggerHaptic('light');
        setIntensiveAnalysisOpen(prev => !prev);
        return;
      }

      // 'P' shortcut: Toggle Fitness & Performance Analysis Page
      if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        triggerHaptic('light');
        if (activeWorkspaceView === 'fitness') {
          navigateWorkspace('map');
        } else {
          openFitnessPage('overview');
        }
        return;
      }

      // 'W' shortcut: Open Weather Forecast
      if ((e.key === 'w' || e.key === 'W') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        triggerHaptic('light');
        setWeatherOpen(prev => !prev);
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

          const trackBounds = computeTightTrackBounds([targetTrack]);
          if (trackBounds) {
            if (is3D) {
              const latDiff = Math.max(0.002, trackBounds.maxLat - trackBounds.minLat);
              const lngDiff = Math.max(0.002, trackBounds.maxLng - trackBounds.minLng);
              const maxDelta = Math.max(latDiff, lngDiff);
              let estimatedZoom = Math.floor(Math.log2(360 / maxDelta));
              estimatedZoom = Math.min(18, Math.max(6, estimatedZoom));

              setMapView(prev => ({
                ...prev,
                lat: (trackBounds.minLat + trackBounds.maxLat) / 2,
                lng: (trackBounds.minLng + trackBounds.maxLng) / 2,
                zoom: estimatedZoom
              }));
            } else {
              window.dispatchEvent(new CustomEvent('fit-active-track', { detail: trackBounds }));
            }
          }

          triggerHaptic('light');
        }
        return;
      }

      // Zoom shortcuts: + / = to zoom in, - to zoom out (hold Alt for fine-grained ±0.25 steps)
      const zoomAction = resolveKeyboardZoomAction(e);
      if (zoomAction) {
        e.preventDefault();
        setMapView(prev => ({
          ...prev,
          zoom: computeNextZoom(prev.zoom, zoomAction.direction, zoomAction.step, MAP_MIN_ZOOM, MAP_MAX_ZOOM)
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
    settingsModalOpen,
    openSettingsModal,
    shortcutsModalOpen,
    glossaryOpen,
    intensiveAnalysisOpen,
    validationModalOpen,
    comparisonOpen,
    activeWorkspaceView,
    navigateWorkspace,
    openFitnessPage,
    weatherOpen,
    timeGapModalOpen,
    isExportModalOpen,
    selectionBounds,
    is3D
  ]);


  if (authChecking) {
    return (
      <div className="min-h-screen w-full bg-slate-950 text-slate-400 flex items-center justify-center font-mono text-xs">
        Workspace wird geladen...
      </div>
    );
  }

  if (!isUnlocked) {
    return <PasswordGate onUnlocked={handleUnlocked} setupRequired={authSetupRequired} />;
  }

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-50" id="app-workspace-root">
      {/* Hidden File Input for Topbar GPX/FIT Quick Import */}
      <input
        ref={topbarUploadInputRef}
        type="file"
        multiple
        accept=".gpx,.fit,.zip"
        className="hidden"
        onChange={(e) => {
          handleFileUpload(e);
          e.target.value = '';
        }}
      />

      {/* Clean Responsive Top Navigation Bar (Single compact mobile row + full desktop bar) */}
      <header className="h-[52px] lg:h-auto lg:min-h-12 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-2.5 sm:px-4 py-1 lg:py-1.5 flex items-center justify-between gap-2 shrink-0 z-[90] relative">
        {/* Brand + Mobile Sidebar Toggle */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {activeWorkspaceView === 'map' && (
            <button
              type="button"
              aria-label="Menü und Streckenliste öffnen"
              onClick={() => {
                triggerHaptic('medium');
                setMobileNavMenuOpen(false);
                setMobileToolsMenuOpen(false);
                setIsMobileMenuOpen(true);
              }}
              className="md:hidden min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer shrink-0 active:scale-95 transition-transform"
              title="Seitenleiste öffnen"
            >
              <Menu size={18} />
            </button>
          )}

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200/80 dark:border-indigo-800/80 flex items-center justify-center">
              <Activity className="text-indigo-600 dark:text-indigo-400" size={15} />
            </div>
            <span className="font-black tracking-tight text-xs sm:text-sm text-slate-950 dark:text-slate-100 whitespace-nowrap">
              GPX Master
            </span>
          </div>
        </div>

        {/* Mobile/Tablet Active View Switcher Dropdown (< lg) */}
        <div className="lg:hidden relative min-w-0 flex-1 flex justify-center">
          <button
            type="button"
            id="btn-mobile-nav-switcher"
            onClick={() => {
              triggerHaptic('light');
              setMobileToolsMenuOpen(false);
              setMobileNavMenuOpen((prev) => !prev);
            }}
            aria-expanded={mobileNavMenuOpen}
            aria-label={tr(appPrefs.language, 'Ansicht wechseln', 'Switch View')}
            className={`min-h-[40px] max-w-full px-2.5 py-1 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              mobileNavMenuOpen
                ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {activeWorkspaceView === 'map' && <MapIcon size={14} className="text-indigo-500 shrink-0" />}
            {activeWorkspaceView === 'planned' && <Compass size={14} className="text-emerald-500 shrink-0" />}
            {activeWorkspaceView === 'activities' && <ListFilter size={14} className="text-indigo-500 shrink-0" />}
            {activeWorkspaceView === 'dashboard' && <BarChart3 size={14} className="text-indigo-500 shrink-0" />}
            {activeWorkspaceView === 'fitness' && <Activity size={14} className="text-orange-500 shrink-0" />}
            <span className="truncate">
              {activeWorkspaceView === 'map' && tr(appPrefs.language, 'Karte', 'Map')}
              {activeWorkspaceView === 'planned' && tr(appPrefs.language, 'Geplante Touren', 'Planned Tours')}
              {activeWorkspaceView === 'activities' && tr(appPrefs.language, 'Aktivitäten', 'Activities')}
              {activeWorkspaceView === 'dashboard' && tr(appPrefs.language, 'Dashboard', 'Dashboard')}
              {activeWorkspaceView === 'fitness' && tr(appPrefs.language, 'Fitness', 'Fitness')}
            </span>
            {activeWorkspaceView === 'map' && tracks.length > 0 && (
              <span className="font-mono tabular-nums text-[10.5px] text-slate-400 dark:text-slate-500 shrink-0">
                {tracks.length}
              </span>
            )}
            {activeWorkspaceView === 'planned' && plannedToursCount !== null && (
              <span className="font-mono tabular-nums text-[10.5px] text-slate-400 dark:text-slate-500 shrink-0">
                {plannedToursCount}
              </span>
            )}
            {activeWorkspaceView === 'activities' && catalogTotalCount !== null && (
              <span className="font-mono tabular-nums text-[10.5px] text-slate-400 dark:text-slate-500 shrink-0">
                {catalogTotalCount}
              </span>
            )}
            <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform ${mobileNavMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {mobileNavMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-[1190]"
                onClick={() => setMobileNavMenuOpen(false)}
              />
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 w-64 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-1.5 z-[1200] space-y-0.5">
                <button
                  type="button"
                  onClick={() => navigateWorkspace('map')}
                  className={`w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center justify-between text-xs font-bold transition-colors cursor-pointer ${
                    activeWorkspaceView === 'map'
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <MapIcon size={15} className="text-indigo-500" />
                    <span>{tr(appPrefs.language, 'Karte', 'Map')}</span>
                  </span>
                  {tracks.length > 0 && (
                    <span className="font-mono tabular-nums text-[11px] text-slate-400">{tracks.length}</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => navigateWorkspace('planned')}
                  className={`w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center justify-between text-xs font-bold transition-colors cursor-pointer ${
                    activeWorkspaceView === 'planned'
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Compass size={15} className="text-emerald-500" />
                    <span>{tr(appPrefs.language, 'Geplante Touren', 'Planned Tours')}</span>
                  </span>
                  {plannedToursCount !== null && (
                    <span className="font-mono tabular-nums text-[11px] text-slate-400">
                      {plannedToursCount.toLocaleString(appPrefs.language === 'en' ? 'en-US' : 'de-DE')}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => navigateWorkspace('activities')}
                  className={`w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center justify-between text-xs font-bold transition-colors cursor-pointer ${
                    activeWorkspaceView === 'activities'
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <ListFilter size={15} className="text-indigo-500" />
                    <span>{tr(appPrefs.language, 'Aktivitäten', 'Activities')}</span>
                  </span>
                  {catalogTotalCount !== null && (
                    <span className="font-mono tabular-nums text-[11px] text-slate-400">
                      {catalogTotalCount.toLocaleString(appPrefs.language === 'en' ? 'en-US' : 'de-DE')}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => navigateWorkspace('dashboard')}
                  className={`w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center justify-between text-xs font-bold transition-colors cursor-pointer ${
                    activeWorkspaceView === 'dashboard'
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <BarChart3 size={15} className="text-indigo-500" />
                    <span>{tr(appPrefs.language, 'Aktivitäten-Dashboard', 'Activities Dashboard')}</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => openFitnessPage('overview')}
                  className={`w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center justify-between text-xs font-bold transition-colors cursor-pointer ${
                    activeWorkspaceView === 'fitness'
                      ? 'bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Activity size={15} className="text-orange-500" />
                    <span>{tr(appPrefs.language, 'Fitness & Gesundheit', 'Fitness & Health')}</span>
                  </span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Desktop All 5 Pages Inline Navigation (lg+) */}
        <nav
          aria-label={tr(appPrefs.language, 'Hauptnavigation', 'Main Navigation')}
          className="hidden lg:flex items-center gap-1 min-w-0"
        >
          <button
            type="button"
            onClick={() => navigateWorkspace('map')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeWorkspaceView === 'map'
                ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-100 border border-transparent'
            }`}
          >
            <MapIcon size={14} />
            <span>{tr(appPrefs.language, 'Karte', 'Map')}</span>
            {tracks.length > 0 && (
              <span className="font-mono tabular-nums text-[11px] text-slate-400 dark:text-slate-500">
                {tracks.length}
              </span>
            )}
          </button>

          <button
            type="button"
            id="nav-tab-planned-tours"
            onClick={() => navigateWorkspace('planned')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeWorkspaceView === 'planned'
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-100 border border-transparent'
            }`}
          >
            <Compass size={14} />
            <span>{tr(appPrefs.language, 'Geplante Touren', 'Planned Tours')}</span>
            {plannedToursCount !== null && (
              <span className="font-mono tabular-nums text-[11px] text-slate-400 dark:text-slate-500">
                {plannedToursCount.toLocaleString(appPrefs.language === 'en' ? 'en-US' : 'de-DE')}
              </span>
            )}
          </button>

          <button
            type="button"
            id="nav-tab-activities-manager"
            onClick={() => navigateWorkspace('activities')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeWorkspaceView === 'activities'
                ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-100 border border-transparent'
            }`}
          >
            <ListFilter size={14} />
            <span>{tr(appPrefs.language, 'Aktivitäten', 'Activities')}</span>
            {catalogTotalCount !== null && (
              <span className="font-mono tabular-nums text-[11px] text-slate-400 dark:text-slate-500">
                {catalogTotalCount.toLocaleString(appPrefs.language === 'en' ? 'en-US' : 'de-DE')}
              </span>
            )}
          </button>

          <button
            type="button"
            id="nav-tab-activities-dashboard"
            onClick={() => navigateWorkspace('dashboard')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeWorkspaceView === 'dashboard'
                ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-100 border border-transparent'
            }`}
          >
            <BarChart3 size={14} />
            <span>{tr(appPrefs.language, 'Aktivitäten-Dashboard', 'Activities Dashboard')}</span>
          </button>

          <button
            type="button"
            id="nav-tab-fitness-health"
            onClick={() => openFitnessPage('overview')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeWorkspaceView === 'fitness'
                ? 'bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border border-orange-200/80 dark:border-orange-800'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-100 border border-transparent'
            }`}
          >
            <Activity size={14} />
            <span>{tr(appPrefs.language, 'Fitness & Gesundheit', 'Fitness & Health')}</span>
          </button>
        </nav>

        {/* Right Quick Actions (Desktop Controls / Mobile Overflow Menu) */}
        <div className="relative flex items-center gap-1.5 shrink-0">
          {/* Desktop-only Secondary Controls */}
          <div className="hidden lg:flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-no-translate="true"
              id="btn-language-toggle"
              onClick={() => {
                triggerHaptic('light');
                updateAppPreferences({ language: appPrefs.language === 'de' ? 'en' : 'de' });
              }}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
              title={appPrefs.language === 'de' ? 'Switch interface to English (EN)' : 'Sprache auf Deutsch wechseln (DE)'}
              aria-label={appPrefs.language === 'de' ? 'Switch interface to English' : 'Sprache auf Deutsch wechseln'}
            >
              <Languages size={14} className="text-indigo-500" />
              <span className="font-mono">{appPrefs.language.toUpperCase()}</span>
            </button>

            <button
              type="button"
              id="btn-open-settings"
              onClick={() => {
                triggerHaptic('light');
                openSettingsModal('style');
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                settingsModalOpen
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
              title={tr(appPrefs.language, 'Einstellungen, Sprache & UI-Stile (,)', 'Settings, Language & UI Styles (,)')}
              aria-label={tr(appPrefs.language, 'Einstellungen öffnen', 'Open Settings')}
            >
              <SettingsIcon size={14} className="text-indigo-500" />
              <span>{tr(appPrefs.language, 'Einstellungen', 'Settings')}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleThemeQuick}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
              title={theme === 'dark' ? tr(appPrefs.language, 'Hellen Modus aktivieren', 'Enable Light Mode') : tr(appPrefs.language, 'Dunklen Modus aktivieren', 'Enable Dark Mode')}
              aria-label={tr(appPrefs.language, 'Theme umschalten', 'Toggle Theme')}
            >
              {theme === 'dark' ? <Sun size={15} className="text-amber-400" /> : <Moon size={15} />}
            </button>

            <button
              type="button"
              onClick={handleLockApp}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
              title={tr(appPrefs.language, 'App sperren', 'Lock App')}
              aria-label={tr(appPrefs.language, 'App sperren', 'Lock App')}
            >
              <Lock size={15} />
            </button>
          </div>

          {/* Mobile Overflow Tools Button (< lg) */}
          <div className="lg:hidden relative">
            <button
              type="button"
              id="btn-mobile-overflow-menu"
              onClick={() => {
                triggerHaptic('light');
                setMobileNavMenuOpen(false);
                setMobileToolsMenuOpen((prev) => !prev);
              }}
              aria-expanded={mobileToolsMenuOpen}
              aria-label={tr(appPrefs.language, 'Weitere Aktionen', 'More Actions')}
              className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border transition-colors cursor-pointer ${
                mobileToolsMenuOpen
                  ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
              title={tr(appPrefs.language, 'Weitere Aktionen', 'More Actions')}
            >
              <MoreHorizontal size={18} />
            </button>

            {mobileToolsMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-[1190]"
                  onClick={() => setMobileToolsMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1.5 w-64 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-1.5 z-[1200] space-y-0.5">
                  <button
                    type="button"
                    data-no-translate="true"
                    onClick={() => {
                      triggerHaptic('light');
                      updateAppPreferences({ language: appPrefs.language === 'de' ? 'en' : 'de' });
                    }}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <span className="flex items-center gap-2.5">
                      <Languages size={15} className="text-indigo-500" />
                      <span>{tr(appPrefs.language, 'Sprache', 'Language')}</span>
                    </span>
                    <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-300">
                      {appPrefs.language.toUpperCase()}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      handleToggleThemeQuick();
                    }}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <span className="flex items-center gap-2.5">
                      {theme === 'dark' ? <Sun size={15} className="text-amber-400" /> : <Moon size={15} className="text-slate-500" />}
                      <span>{tr(appPrefs.language, 'Design', 'Appearance')}</span>
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {theme === 'dark' ? tr(appPrefs.language, 'Dunkel', 'Dark') : tr(appPrefs.language, 'Hell', 'Light')}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('light');
                      setMobileToolsMenuOpen(false);
                      openSettingsModal('style');
                    }}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center gap-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <SettingsIcon size={15} className="text-indigo-500" />
                    <span>{tr(appPrefs.language, 'Einstellungen & Speicher', 'Settings & Storage')}</span>
                  </button>

                  <div className="border-t border-slate-100 dark:border-slate-800 my-1" />

                  <button
                    type="button"
                    onClick={() => {
                      setMobileToolsMenuOpen(false);
                      handleLockApp();
                    }}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center gap-2.5 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                  >
                    <Lock size={15} />
                    <span>{tr(appPrefs.language, 'App sperren', 'Lock App')}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Body */}
      <div className="relative flex-1 flex min-h-0 overflow-hidden">
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

        {/* Full-Screen Planned Tours (Komoot-Style Library) */}
        {activeWorkspaceView === 'planned' && (
          <PlannedToursView
            workspaceTracks={tracks}
            ftp={ftp}
            userWeight={userWeight}
            estimatedSpeed={estimatedSpeed}
            onOpenTourSolo={(tr) => replaceWorkspaceWithTracks([tr], true)}
            onOpenToursBatch={(batchTracks, replaceWorkspace) => {
              if (replaceWorkspace) {
                replaceWorkspaceWithTracks(batchTracks, true);
              } else {
                handleLoadCatalogTracksToMap(batchTracks, { jumpToMap: true, fitToTracks: true });
              }
            }}
            onAddTourToWorkspace={handleLoadLibraryTrack}
            onRemoveTourFromWorkspace={removeTrack}
            onSyncRefreshedTracksToWorkspace={handleSyncRefreshedTracksToWorkspace}
            onCompareTwoToursOnMap={handleCompareTwoToursOnMap}
            onNavigateToMap={() => navigateWorkspace('map')}
            onLibraryCountChange={setPlannedToursCount}
          />
        )}

        {/* Full-Screen Activities Manager Workspace */}
        {activeWorkspaceView === 'activities' && (
          <ActivitiesManagerView
            workspaceTracks={tracks}
            ftp={ftp}
            userWeight={userWeight}
            estimatedSpeed={estimatedSpeed}
            onLoadTracksToMap={handleLoadCatalogTracksToMap}
            onActivityMetadataUpdated={handleCatalogActivityMetadataUpdated}
            onDatabaseCountChange={setCatalogTotalCount}
            onOpenDashboard={() => navigateWorkspace('dashboard')}
            onOpenUploadPicker={() => topbarUploadInputRef.current?.click()}
            onOpenGarminSync={() => openSettingsModal('garmin')}
            onBackToMap={() => navigateWorkspace('map')}
          />
        )}

        {/* Full-Screen Activities Dashboard Workspace */}
        {activeWorkspaceView === 'dashboard' && (
          <ActivitiesDashboardView
            workspaceTracks={tracks}
            ftp={ftp}
            userWeight={userWeight}
            estimatedSpeed={estimatedSpeed}
            onLoadTracksToMap={handleLoadCatalogTracksToMap}
            onOpenActivitiesArchive={() => navigateWorkspace('activities')}
            onOpenUploadPicker={() => topbarUploadInputRef.current?.click()}
            onOpenGarminSync={() => openSettingsModal('garmin')}
            onBackToMap={() => navigateWorkspace('map')}
          />
        )}

        {/* Full-Screen Fitness & Health Workspace */}
        {activeWorkspaceView === 'fitness' && (
          <GarminDashboard
            variant="page"
            initialTab={fitnessPageInitialTab}
            onTabChange={handleFitnessTabChange}
            onClose={() => navigateWorkspace('map')}
            onLoadTrack={(tr) => {
              handleLoadLibraryTrack(tr);
              if (hasRealGpsData(tr)) {
                navigateWorkspace('map');
              } else {
                setIntensiveAnalysisTab('overview');
                setIntensiveAnalysisOpen(true);
              }
            }}
            onDataSynced={refreshCatalogTotalCount}
            userWeight={userWeight}
            userAge={userAge}
            userMaxHr={userMaxHr}
            ftp={ftp}
            onUpdateFtp={setFtp}
            onUpdateWeight={setUserWeight}
            onUpdateAge={setUserAge}
            onUpdateMaxHr={handleMaxHrChange}
          />
        )}

        {/* Map Workspace (kept mounted when switching to preserve map camera & loaded layers) */}
        <div className={activeWorkspaceView === 'map' ? 'flex-1 flex min-h-0 overflow-hidden' : 'hidden'}>
          <Sidebar 
            tracks={tracks} 
            markedTrackId={markedTrackId}
            compareTrackId={compareTrackId}
            onStartMapComparison={handleStartMapComparison}
            onExitMapComparison={handleExitMapComparison}
            onMarkTrack={(id) => {
              if (compareTrackId && id === compareTrackId && markedTrackId && markedTrackId !== id) {
                setCompareTrackId(markedTrackId);
                setMarkedTrackId(id);
              } else {
                setMarkedTrackId(id);
              }
              setIsMobileMenuOpen(false);
              setIsProfileCollapsed(false);
            }}
            onChangeActivityType={handleChangeActivityType}
            onUpload={handleFileUpload}
            onImportUrl={handleImportFromUrl}
            uploadProgress={trackUploadProgress}
            onToggleVisibility={toggleVisibility} 
            onRemoveTrack={removeTrack} 
            onClearAllTracks={clearWorkspaceTracks}
            onKeepOnlyTrack={keepOnlyTrack}
            onRemoveHiddenTracks={removeHiddenTracks}
            onRemoveDuplicateTracks={removeDuplicateTracks}
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
            onOpenGarminHealth={() => openFitnessPage('overview')}
            onOpenGarminActivitiesAnalysis={() => openFitnessPage('compare')}
            onOpenPerformanceAnalysis={() => openFitnessPage('performance')}
            onOpenTrainingZones={(id) => {
              handleOpenTrackAnalysis(id, 'zones');
              setIsMobileMenuOpen(false);
            }}
            onOpenSummaryReport={(id) => {
              handleOpenTrackAnalysis(id, 'report');
              setIsMobileMenuOpen(false);
            }}
            onOpenIntensiveAnalysis={(id) => {
              handleOpenTrackAnalysis(id, 'overview');
              setIsMobileMenuOpen(false);
            }}
            onOpenVideoExport={(id) => {
              if (id) {
                setMarkedTrackId(id);
              }
              setIsExportModalOpen(true);
              setIsMobileMenuOpen(false);
            }}
            onOpenGlossary={(metricId) => {
              setInitialGlossaryMetricId(metricId);
              setGlossaryOpen(true);
              setIsMobileMenuOpen(false);
            }}
            onOpenShortcuts={() => {
              setShortcutsModalOpen(true);
              setIsMobileMenuOpen(false);
            }}
            onOpenAnalytics={(id) => {
              handleOpenTrackAnalysis(id, 'power');
              setIsMobileMenuOpen(false);
            }}
            onOpenClimbs={(id) => {
              handleOpenTrackAnalysis(id, 'climbs');
              setIsMobileMenuOpen(false);
            }}
            onOpenWeather={() => {
              setWeatherOpen(true);
              setIsMobileMenuOpen(false);
            }}
            onOpenRawData={(id) => {
              handleOpenTrackAnalysis(id, 'rawdata');
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
            onReverseTrack={handleReverseTrack}
            onSanitizeTrack={handleSanitizeTrack}
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
            analyzingSurfaces={analyzingSurfaces}
            surfaceAnalysisStatuses={surfaceAnalysisStatuses}
            selectionBounds={selectionBounds}
            onSelection={setSelectionBounds}
            onClearSelection={() => setSelectionBounds(null)}
            isDark={theme === 'dark'}
            onToggleTheme={handleToggleThemeQuick}
            onToggleAllVisibility={handleToggleAllVisibility}
            onFitVisibleTracks={handleFitVisibleTracks}
            onLockApp={handleLockApp}
            onOpenFullActivitiesView={() => navigateWorkspace('activities')}
            onOpenPlannedToursView={() => navigateWorkspace('planned')}
            onRefreshKomootTrack={handleRefreshTrackFromKomoot}
            refreshingKomootTracks={refreshingKomootTracks}
          />
          <main className="flex-1 flex flex-col relative overflow-hidden">
            {!isOnline && (
              <div className="bg-amber-500 text-slate-950 px-4 py-2 text-xs font-bold flex items-center justify-between shadow-md z-[70] border-b border-amber-600">
                <div className="flex items-center gap-2">
                  <WifiOff size={16} className="shrink-0" />
                  <span>
                    <strong>Offline-Modus:</strong> Kartenkacheln und zuvor geladene GPX-Routen werden aus dem lokalen Browser-Cache (IndexedDB) bereitgestellt.
                  </span>
                </div>
              </div>
            )}
            {/* Mobile Telemetry Floating Pill */}
            <MobileTelemetryPill
              hoveredPoint={hoveredPoint}
              trackColor={markedTrack?.color}
              tracks={tracks}
              onClose={() => setHoveredPoint(null)}
            />

        <div className="flex-1 relative">
          <div className="w-full h-full relative isolate z-10">
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
                />
              ) : (
                <Map 
                  tracks={tracks} 
                  activeLayer={activeLayer}
                  markedTrackId={markedTrackId}
                  compareTrackId={compareTrackId}
                  onStartMapComparison={handleStartMapComparison}
                  onExitMapComparison={handleExitMapComparison}
                  onOpenComparisonModal={() => setComparisonOpen(true)}
                  onMarkTrack={setMarkedTrackId}
                  hoveredPoint={hoveredPoint}
                  onHoverPoint={setHoveredPoint}
                  selectionBounds={selectionBounds}
                  onSelection={setSelectionBounds}
                  mapView={mapView}
                  onMapViewChange={setMapView}
                  estimatedSpeed={estimatedSpeed}
                  ftp={ftp}
                  textMarkers={textMarkers}
                  onAddTextMarker={handleAddTextMarker}
                  onDeleteTextMarker={handleDeleteTextMarker}
                  hideLegend={weatherOpen || comparisonOpen || intensiveAnalysisOpen}
                  isDark={theme === 'dark'}
                  onAnalyzeSurface={analyzeTrackSurface}
                  onOpenIntensiveAnalysis={(id) => {
                    handleOpenTrackAnalysis(id, 'overview');
                  }}
                  analyzingSurfaces={analyzingSurfaces}
                  surfaceAnalysisStatuses={surfaceAnalysisStatuses}
                  timeGaps={activeTimeGaps}
                  selectedGapId={selectedGapId}
                  onSelectGap={handleFocusGapOnMap}
                  onSplitGap={handleSplitTrack}
                  onCloseGap={handleCloseGap}
                  onOpenShortcuts={() => setShortcutsModalOpen(true)}
                  isSidebarOpen={isMobileMenuOpen}
                  isBottomBarObscuring={!markedTrack || isProfileCollapsed}
                />
              )}
            </ErrorBoundary>
          </div>

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
                initialTrack1Id={markedTrackId}
                initialTrack2Id={compareTrackId}
                onCompareOnMap={(id1, id2) => {
                  setComparisonOpen(false);
                  handleStartMapComparison(id1, id2);
                }}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {intensiveAnalysisOpen && (markedTrack || tracks.find(t => t.visible) || tracks[0]) && (
              <IntensiveTrackAnalysisModal
                key={`intensive-analysis-modal-${(markedTrack || tracks.find(t => t.visible) || tracks[0]).id}`}
                track={markedTrack || tracks.find(t => t.visible) || tracks[0]}
                allTracks={tracks}
                onSelectTrack={(id) => setMarkedTrackId(id)}
                initialTab={intensiveAnalysisTab}
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
                onSelection={(bounds) => {
                  setSelectionBounds(bounds);
                  if (bounds && is3D) {
                    const latDiff = Math.max(0.002, bounds.maxLat - bounds.minLat);
                    const lngDiff = Math.max(0.002, bounds.maxLng - bounds.minLng);
                    const maxDelta = Math.max(latDiff, lngDiff);
                    const estimatedZoom = Math.min(18, Math.max(11, Math.floor(Math.log2(360 / maxDelta))));
                    setMapView(prev => ({
                      ...prev,
                      lat: (bounds.minLat + bounds.maxLat) / 2,
                      lng: (bounds.minLng + bounds.maxLng) / 2,
                      zoom: estimatedZoom
                    }));
                  }
                }}
                onReverseTrack={handleReverseTrack}
                onSanitizeTrack={handleSanitizeTrack}
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
            {shortcutsModalOpen && (
              <KeyboardShortcutsModal
                isOpen={shortcutsModalOpen}
                onClose={() => setShortcutsModalOpen(false)}
              />
            )}
          </AnimatePresence>

          <KomootCollectionImportModal
            collection={pendingKomootCollection}
            ftp={ftp}
            userWeight={userWeight}
            estimatedSpeed={estimatedSpeed}
            existingWorkspaceTracks={tracks}
            defaultSaveAsPlanned={true}
            defaultOpenOnMap={true}
            onComplete={handleKomootCollectionComplete}
            onClose={() => setPendingKomootCollection(null)}
          />
          
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
        </div>

        {markedTrack && (
          <div className={`${
            isProfileCollapsed
              ? 'h-0 overflow-hidden py-0 border-t-0 shadow-none'
              : mobileProfileSnap === 'mini'
              ? 'h-[214px] sm:h-52 md:h-60 pb-[calc(5.25rem+env(safe-area-inset-bottom,0px))] sm:pb-2'
              : mobileProfileSnap === 'expanded'
              ? 'h-[58vh] min-h-[340px] sm:h-72 md:h-80 pb-[calc(5.25rem+env(safe-area-inset-bottom,0px))] sm:pb-2'
              : 'h-[38vh] min-h-[260px] max-h-[360px] sm:h-60 md:h-68 md:max-h-none pb-[calc(5.25rem+env(safe-area-inset-bottom,0px))] sm:pb-2'
          } bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-2 sm:px-4 md:px-6 pt-1 sm:py-2 md:py-2.5 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)] z-20 transition-all duration-300 relative`}>
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
                onOpenIntensiveAnalysis={() => handleOpenTrackAnalysis(markedTrack.id, 'overview')}
                onOpenVideoExport={() => setIsExportModalOpen(true)}
                ftp={ftp}
                textMarkers={textMarkers}
                onAddTextMarker={handleAddTextMarker}
                onDeleteTextMarker={handleDeleteTextMarker}
                onRepairAnomalies={handleRepairTrackAnomalies}
                onApplyElevationFilter={handleApplyElevationFilter}
                onAnalyzeSurface={analyzeTrackSurface}
                isAnalyzingSurface={markedTrack ? !!analyzingSurfaces[markedTrack.id] : false}
                onExtractSubTrack={handleExtractSubTrack}
                onCropTrack={handleCropTrack}
                onReverseTrack={handleReverseTrack}
                onShiftLoopStart={handleShiftLoopStart}
                onSanitizeTrack={handleSanitizeTrack}
                mobileProfileSnap={mobileProfileSnap}
                onMobileProfileSnapChange={setMobileProfileSnap}
                onCollapse={() => setIsProfileCollapsed(true)}
              />
            </ErrorBoundary>
          </div>
        )}

        {markedTrack && isProfileCollapsed && (
          <button
            onClick={() => setIsProfileCollapsed(false)}
            className="hidden sm:flex fixed bottom-4 right-4 z-[99] bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-full shadow-2xl items-center gap-1.5 font-bold text-xs transition-all cursor-pointer border border-indigo-500 hover:scale-105 active:scale-95 animate-fade-in"
            title="Höhenprofil anzeigen"
          >
            <BarChart2 size={14} />
            <span>Höhenprofil einblenden</span>
          </button>
        )}

        {/* Mobile Ergonomic Thumb-Zone Navigation (Map Workspace only) */}
        {activeWorkspaceView === 'map' && (
          <MobileThumbBar
            isSidebarOpen={isMobileMenuOpen}
            onToggleSidebar={() => setIsMobileMenuOpen(prev => !prev)}
            hasTrack={!!markedTrack}
            isProfileCollapsed={isProfileCollapsed}
            onToggleProfile={() => setIsProfileCollapsed(prev => !prev)}
            mobileProfileSnap={mobileProfileSnap}
            is3D={is3D}
            onToggle3D={() => setIs3D(prev => !prev)}
            onFitTrack={() => {
              if (markedTrack) {
                const bounds = calculateTrackCenterAndBounds(markedTrack);
                if (bounds) {
                  window.dispatchEvent(new CustomEvent('fit-active-track', { detail: bounds }));
                }
              }
            }}
            onOpenAnalytics={() => handleOpenTrackAnalysis(markedTrack?.id, 'overview')}
            isCockpitOpen={intensiveAnalysisOpen}
            trackCount={tracks.length}
            visibleTrackCount={tracks.filter(t => t.visible).length}
          />
        )}

        <VideoExportModal
          track={markedTrack || tracks.find(t => t.visible) || tracks[0] || null}
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          userWeight={userWeight}
          estimatedSpeed={estimatedSpeed}
        />
          </main>
        </div>
      </div>

      {/* Global Success Toast */}
      {successMessage && (
        <div className="fixed bottom-4 right-4 z-[1350] bg-emerald-600/95 backdrop-blur-sm text-white px-4 py-2.5 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2.5 max-w-sm border border-emerald-400/40">
          <span className="w-2 h-2 rounded-full bg-emerald-200 shrink-0" />
          <span className="flex-1">{successMessage}</span>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-100 hover:text-white cursor-pointer"
            aria-label={tr(appPrefs.language, 'Schließen', 'Close')}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Global Settings & UI Style Customization Modal */}
      <AnimatePresence>
        {settingsModalOpen && (
          <AppSettingsModal
            isOpen={settingsModalOpen}
            onClose={() => setSettingsModalOpen(false)}
            initialTab={settingsInitialTab}
            preferences={appPrefs}
            onUpdatePreferences={updateAppPreferences}
            onResetDefaults={handleResetAppPreferences}
            ftp={ftp}
            onUpdateFtp={setFtp}
            userWeight={userWeight}
            onUpdateWeight={setUserWeight}
            userAge={userAge}
            onUpdateAge={setUserAge}
            userMaxHr={userMaxHr}
            onUpdateMaxHr={handleMaxHrChange}
            estimatedSpeed={estimatedSpeed}
            onUpdateEstimatedSpeed={setEstimatedSpeed}
            activeLayer={activeLayer}
            onSelectMapLayer={setActiveLayer}
            tracks={tracks}
            isOnline={isOnline}
            onGarminDataSynced={refreshCatalogTotalCount}
            onLoadGarminTrack={(tr) => {
              handleLoadLibraryTrack(tr);
              if (hasRealGpsData(tr)) {
                navigateWorkspace('map');
              } else {
                setIntensiveAnalysisTab('overview');
                setIntensiveAnalysisOpen(true);
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
