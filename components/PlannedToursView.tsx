import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Compass,
  Search,
  Bike,
  Footprints,
  TrendingUp,
  Ruler,
  Plus,
  Trash2,
  Edit2,
  Download,
  Upload,
  Check,
  X,
  RefreshCw,
  LayoutGrid,
  List,
  Save,
  ArrowUpDown,
  Layers,
  ArrowRight,
  Tag,
  CheckSquare,
  Square,
  SlidersHorizontal,
  GitCompare,
  Folder,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  Pencil,
  Link2,
  AlertCircle
} from 'lucide-react';
import { GPXTrack, SurfaceSegment } from '../types';
import { getApiUrl, apiFetch } from '../utils/api';
import {
  parseGPX,
  parseGPXStream,
  validateGPX,
  downloadTrackAsGPX,
  calculateSurfaceStatsFromPoints,
  hydratePointsWithSurface,
  calculatePowerStats,
  hasRealGpsData
} from '../utils/gpxUtils';
import {
  KomootCollectionImportModal,
  KomootCollectionPreviewData,
  KomootCollectionImportCompletion
} from './KomootCollectionImportModal';
import {
  attachKomootSourceToTrack,
  applyKomootRefreshToTrack,
  findMatchingExistingKomootTrack,
  getKomootSourceMeta
} from '../utils/komootVersioning';

export interface PlannedTourMeta {
  id: string;
  name: string;
  distance: number;
  ascent: number;
  descent: number;
  duration?: number;
  maxSlope?: number;
  color?: string;
  activityType: 'cycling' | 'running';
  description: string;
  tags: string[];
  dateCreated: string;
  tourGroup?: string;
  addedAt?: number;
  originalFilename?: string;
  hasTimestamps?: boolean;
  surfaceStats?: SurfaceSegment[];
  rawFileDetails?: {
    fileType?: 'fit' | 'gpx';
    fileName?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface PlannedToursViewProps {
  workspaceTracks: GPXTrack[];
  ftp: number;
  userWeight: number;
  estimatedSpeed: number;
  onOpenTourSolo: (track: GPXTrack) => void;
  onOpenToursBatch: (tracks: GPXTrack[], replaceWorkspace: boolean) => void;
  onAddTourToWorkspace: (track: GPXTrack) => void;
  onRemoveTourFromWorkspace: (id: string) => void;
  onSyncRefreshedTracksToWorkspace?: (tracks: GPXTrack[]) => void;
  onCompareTwoToursOnMap?: (tour1: GPXTrack, tour2: GPXTrack) => void;
  onNavigateToMap: () => void;
  onLibraryCountChange?: (count: number) => void;
}

type DifficultyLevel = 'leicht' | 'mittel' | 'schwer';
type SortOption = 'added-desc' | 'stage-asc' | 'dist-desc' | 'ascent-desc' | 'difficulty-desc' | 'date-desc' | 'name-asc';
type GroupByOption = 'none' | 'custom' | 'sport' | 'difficulty' | 'month';
type DistanceFilterOption = 'all' | 'lt40' | '40-80' | '80-130' | 'gt130';
type AscentFilterOption = 'all' | 'lt500' | '500-1200' | 'gt1200';

const UNGROUPED_KEY = '__ungrouped__';
const MONTH_LABELS_DE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember'
];

function formatMonthGroup(dateStr?: string): { key: string; label: string } {
  const clean = String(dateStr || '').trim();
  const match = clean.match(/^(\d{4})-(\d{2})/);
  if (!match) {
    return { key: 'month-unknown', label: 'Ohne Datum' };
  }
  const year = match[1];
  const monthIdx = parseInt(match[2], 10) - 1;
  const monthName = MONTH_LABELS_DE[monthIdx] || match[2];
  return { key: `${year}-${match[2]}`, label: `${monthName} ${year}` };
}

function isPlannedTourItem(item: PlannedTourMeta): boolean {
  const idLower = (item.id || '').toLowerCase();
  if (
    idLower.startsWith('garmin-fit-') ||
    idLower.startsWith('garmin-act-') ||
    idLower.startsWith('garmin-')
  ) {
    return false;
  }
  if (item.rawFileDetails?.fileType === 'fit') {
    return false;
  }
  if (item.originalFilename && item.originalFilename.toLowerCase().endsWith('.fit')) {
    return false;
  }
  return true;
}

function extractStageNumber(name: string): number | null {
  const match = name.match(/(?:etappe|tag|stage|day)\s*0*(\d+)/i) || name.match(/^0*(\d+)[\s.:_-]/);
  if (!match) return null;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeTourDifficulty(tour: PlannedTourMeta): {
  level: DifficultyLevel;
  label: string;
  score: number;
} {
  const dist = Math.max(0, tour.distance || 0);
  const asc = Math.max(0, tour.ascent || 0);
  const slope = Math.max(0, tour.maxSlope || 0);

  if (tour.activityType === 'running') {
    const score = dist / 8 + asc / 220 + Math.max(0, slope - 8) * 0.1;
    if (score < 2.0) return { level: 'leicht', label: 'Leicht', score };
    if (score < 4.0) return { level: 'mittel', label: 'Mittel', score };
    return { level: 'schwer', label: 'Schwer', score };
  }

  const score = dist / 28 + asc / 380 + Math.max(0, slope - 6) * 0.12;
  if (score < 2.2) return { level: 'leicht', label: 'Leicht', score };
  if (score < 4.5) return { level: 'mittel', label: 'Mittel', score };
  return { level: 'schwer', label: 'Schwer', score };
}

function estimateTourDurationSeconds(tour: PlannedTourMeta, cyclingSpeedKmh: number): number {
  const dist = Math.max(0, tour.distance || 0);
  const asc = Math.max(0, tour.ascent || 0);
  const safeSpeed = Math.max(8, cyclingSpeedKmh);

  if (tour.activityType === 'running') {
    // Running planning pace scaled reasonably from planning slider (approx 9-13 km/h flat)
    const runSpeed = Math.max(6, Math.min(15, safeSpeed * 0.48));
    const flatHours = dist / runSpeed;
    const climbPenaltyHours = asc / 600;
    return Math.round((flatHours + climbPenaltyHours) * 3600);
  }

  const flatHours = dist / safeSpeed;
  const climbPenaltyHours = asc / 800; // Alpine climb vertical gain penalty (~800 Hm/h extra resistance)
  return Math.round((flatHours + climbPenaltyHours) * 3600);
}

function formatDurationCompact(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const totalMins = Math.round(seconds / 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function getSurfaceColorHex(type: string): string {
  const s = (type || '').toLowerCase();
  if (s.includes('asphalt') || s.includes('paved') || s.includes('beton') || s.includes('road')) return '#3b82f6';
  if (s.includes('fahrrad') || s.includes('radweg') || s.includes('cycleway')) return '#0ea5e9';
  if (s.includes('schotter') || s.includes('gravel') || s.includes('kies') || s.includes('compacted')) return '#f59e0b';
  if (s.includes('wald') || s.includes('trail') || s.includes('pfad') || s.includes('natur') || s.includes('earth')) return '#10b981';
  if (s.includes('pflaster') || s.includes('cobble')) return '#8b5cf6';
  return '#94a3b8';
}

interface TourMiniPreviewSvgProps {
  track?: GPXTrack;
  accentColor?: string;
}

const TourMiniPreviewSvg: React.FC<TourMiniPreviewSvgProps> = React.memo(({ track, accentColor }) => {
  const geometry = useMemo(() => {
    if (!track || !hasRealGpsData(track)) return null;
    const pts = track.points.filter(
      (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
    );
    if (pts.length < 2) return null;

    const maxSamples = 140;
    const step = pts.length > maxSamples ? (pts.length - 1) / (maxSamples - 1) : 1;
    const sampled: typeof pts = [];
    for (let i = 0; i < (pts.length > maxSamples ? maxSamples : pts.length); i++) {
      const idx = pts.length > maxSamples ? Math.min(pts.length - 1, Math.round(i * step)) : i;
      sampled.push(pts[idx]);
    }

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minEle = Infinity;
    let maxEle = -Infinity;
    let hasEle = false;

    for (const p of sampled) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      if (typeof p.ele === 'number' && Number.isFinite(p.ele)) {
        hasEle = true;
        if (p.ele < minEle) minEle = p.ele;
        if (p.ele > maxEle) maxEle = p.ele;
      }
    }

    const avgLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
    const cosLat = Math.max(0.2, Math.cos(avgLatRad));
    const width = 320;
    const height = 136;
    const padX = 22;
    const padTop = 18;
    const padBottom = hasEle ? 36 : 18;
    const innerW = width - padX * 2;
    const innerH = height - padTop - padBottom;

    const spanLng = Math.max(0.001, (maxLng - minLng) * cosLat);
    const spanLat = Math.max(0.001, maxLat - minLat);
    const scale = Math.min(innerW / spanLng, innerH / spanLat);
    const drawnW = spanLng * scale;
    const drawnH = spanLat * scale;
    const offsetX = padX + (innerW - drawnW) / 2;
    const offsetY = padTop + (innerH - drawnH) / 2;

    const routeCoords = sampled.map((p) => {
      const x = offsetX + (p.lng - minLng) * cosLat * scale;
      const y = offsetY + drawnH - (p.lat - minLat) * scale;
      return { x, y };
    });

    const routePath = routeCoords
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
      .join(' ');

    let eleAreaPath = '';
    let eleLinePath = '';
    if (hasEle && maxEle > minEle) {
      const eleBaseY = height;
      const eleTopY = height - 28;
      const eleRange = maxEle - minEle;
      const eleCoords = sampled.map((p, idx) => {
        const x = (idx / Math.max(1, sampled.length - 1)) * width;
        const eleVal = typeof p.ele === 'number' && Number.isFinite(p.ele) ? p.ele : minEle;
        const y = eleBaseY - ((eleVal - minEle) / eleRange) * (eleBaseY - eleTopY) - 2;
        return { x, y };
      });
      eleLinePath = eleCoords
        .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
        .join(' ');
      eleAreaPath = `${eleLinePath} L${width},${height} L0,${height} Z`;
    }

    return {
      width,
      height,
      routePath,
      start: routeCoords[0],
      end: routeCoords[routeCoords.length - 1],
      eleAreaPath,
      eleLinePath,
      minEle: hasEle ? Math.round(minEle) : null,
      maxEle: hasEle ? Math.round(maxEle) : null
    };
  }, [track]);

  const stroke = accentColor && accentColor !== '#000000' ? accentColor : '#10b981';

  if (!geometry) {
    return (
      <div className="w-full h-32 bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950/90 flex flex-col items-center justify-center text-slate-400 gap-1.5">
        <Compass className="w-6 h-6 text-emerald-400/60 animate-pulse" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
          Vorschau wird geladen...
        </span>
      </div>
    );
  }

  return (
    <div className="w-full h-32 relative bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/80 overflow-hidden">
      {/* Subtle topographic grid */}
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        className="w-full h-full block"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <pattern id={`topo-${track?.id || 'default'}`} width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(148, 163, 184, 0.08)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={geometry.width} height={geometry.height} fill={`url(#topo-${track?.id || 'default'})`} />

        {geometry.eleAreaPath && (
          <>
            <path d={geometry.eleAreaPath} fill="rgba(16, 185, 129, 0.14)" />
            <path d={geometry.eleLinePath} fill="none" stroke="rgba(52, 211, 153, 0.45)" strokeWidth="1.2" />
          </>
        )}

        {/* Outer glow + crisp route polyline */}
        <path
          d={geometry.routePath}
          fill="none"
          stroke={stroke}
          strokeOpacity="0.28"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={geometry.routePath}
          fill="none"
          stroke={stroke}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* End marker */}
        <circle
          cx={geometry.end.x}
          cy={geometry.end.y}
          r="4.5"
          fill="#f43f5e"
          stroke="#ffffff"
          strokeWidth="1.5"
        />
        {/* Start marker */}
        <circle
          cx={geometry.start.x}
          cy={geometry.start.y}
          r="5"
          fill="#10b981"
          stroke="#ffffff"
          strokeWidth="1.5"
        />
      </svg>

      {geometry.maxEle !== null && geometry.minEle !== null && (
        <div className="absolute bottom-1.5 right-2 px-1.5 py-0.5 rounded bg-slate-950/75 border border-white/10 text-[9px] font-mono text-emerald-300 backdrop-blur-xs">
          {geometry.minEle}–{geometry.maxEle} m
        </div>
      )}
    </div>
  );
});

export const PlannedToursView: React.FC<PlannedToursViewProps> = ({
  workspaceTracks,
  ftp,
  userWeight,
  estimatedSpeed,
  onOpenTourSolo,
  onOpenToursBatch,
  onAddTourToWorkspace,
  onRemoveTourFromWorkspace,
  onSyncRefreshedTracksToWorkspace,
  onCompareTwoToursOnMap,
  onNavigateToMap,
  onLibraryCountChange
}) => {
  const [tours, setTours] = useState<PlannedTourMeta[]>([]);
  const [hydratedTracks, setHydratedTracks] = useState<Record<string, GPXTrack>>({});
  const hydratedTracksRef = useRef<Record<string, GPXTrack>>({});
  hydratedTracksRef.current = hydratedTracks;

  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [sportFilter, setSportFilter] = useState<'all' | 'cycling' | 'running'>('all');
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | DifficultyLevel>('all');
  const [distanceFilter, setDistanceFilter] = useState<DistanceFilterOption>('all');
  const [ascentFilter, setAscentFilter] = useState<AscentFilterOption>('all');
  const [activeCollection, setActiveCollection] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortOption>('added-desc');
  const [groupBy, setGroupBy] = useState<GroupByOption>(() => {
    try {
      const saved = window.localStorage.getItem('velo_planned_group_by');
      if (saved === 'none' || saved === 'custom' || saved === 'sport' || saved === 'difficulty' || saved === 'month') {
        return saved;
      }
    } catch {}
    return 'none';
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [renamingGroupKey, setRenamingGroupKey] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState('');
  const [isRenamingGroup, setIsRenamingGroup] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [batchAssignTarget, setBatchAssignTarget] = useState<string>('');
  const [batchNewGroupName, setBatchNewGroupName] = useState<string>('');
  const [isAssigningBatchGroup, setIsAssigningBatchGroup] = useState(false);

  const effectivePlanningSpeed = Math.max(8, estimatedSpeed || 20);

  useEffect(() => {
    try {
      window.localStorage.setItem('velo_planned_group_by', groupBy);
    } catch {}
  }, [groupBy]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Edit metadata modal
  const [editingTour, setEditingTour] = useState<PlannedTourMeta | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    tags: '',
    tourGroup: '',
    activityType: 'cycling' as 'cycling' | 'running',
    dateCreated: ''
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [showUrlImportPanel, setShowUrlImportPanel] = useState(false);
  const [urlImportInput, setUrlImportInput] = useState('');
  const [isImportingUrl, setIsImportingUrl] = useState(false);
  const [urlImportError, setUrlImportError] = useState<string | null>(null);
  const [urlSaveAsPlanned, setUrlSaveAsPlanned] = useState(true);
  const [urlOpenOnMap, setUrlOpenOnMap] = useState(true);
  const [pendingKomootCollection, setPendingKomootCollection] =
    useState<KomootCollectionPreviewData | null>(null);
  const [refreshingTourId, setRefreshingTourId] = useState<string | null>(null);
  const [refreshingGroupKey, setRefreshingGroupKey] = useState<string | null>(null);
  const [groupRefreshProgress, setGroupRefreshProgress] = useState<{ done: number; total: number } | null>(null);

  const gpxUploadInputRef = useRef<HTMLInputElement | null>(null);
  const urlImportInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Seed hydrated cache from active workspaceTracks whenever available
  useEffect(() => {
    if (!workspaceTracks || workspaceTracks.length === 0) return;
    setHydratedTracks((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const tr of workspaceTracks) {
        if (tr.id && tr.points && tr.points.length > 1 && !next[tr.id]) {
          next[tr.id] = tr;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [workspaceTracks]);

  const fetchPlannedTours = useCallback(async () => {
    setIsLoading(true);
    try {
      const [libRes, fullRes] = await Promise.all([
        apiFetch(getApiUrl('/api/library')),
        apiFetch(getApiUrl('/api/tracks'))
      ]);

      const libData = await libRes.json();
      const fullData = fullRes.ok ? await fullRes.json() : null;

      if (fullData?.success && Array.isArray(fullData.tracks)) {
        setHydratedTracks((prev) => {
          const next = { ...prev };
          for (const tr of fullData.tracks as GPXTrack[]) {
            if (tr.id && Array.isArray(tr.points) && tr.points.length > 0) {
              next[tr.id] = tr;
            }
          }
          return next;
        });
      }

      if (libData.success && Array.isArray(libData.tracks)) {
        const plannedOnly: PlannedTourMeta[] = (libData.tracks as PlannedTourMeta[]).filter(isPlannedTourItem);
        setTours(plannedOnly);
        onLibraryCountChange?.(plannedOnly.length);
      }
    } catch (err) {
      console.error('Fehler beim Laden geplanter Touren:', err);
      showToast('Geplante Touren konnten nicht geladen werden.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [onLibraryCountChange, showToast]);

  useEffect(() => {
    fetchPlannedTours();
  }, [fetchPlannedTours]);

  // Background queue to hydrate geometry for tours not covered by /api/tracks (limit 25)
  useEffect(() => {
    const missingIds = tours
      .map((t) => t.id)
      .filter((id) => !hydratedTracksRef.current[id]);
    if (missingIds.length === 0) return;

    let cancelled = false;
    let cursor = 0;

    const worker = async () => {
      while (!cancelled && cursor < missingIds.length) {
        const idx = cursor++;
        const id = missingIds[idx];
        try {
          const res = await apiFetch(getApiUrl(`/api/library/${encodeURIComponent(id)}`));
          if (!res.ok) continue;
          const data = await res.json();
          if (!cancelled && data?.success && data.track) {
            setHydratedTracks((prev) => ({
              ...prev,
              [id]: data.track as GPXTrack
            }));
          }
        } catch {
          // ignore background preview hydration failures
        }
      }
    };

    const workers = Array.from({ length: Math.min(3, missingIds.length) }, () => worker());
    Promise.all(workers);

    return () => {
      cancelled = true;
    };
  }, [tours]);

  const workspaceTrackIdSet = useMemo(
    () => new Set(workspaceTracks.map((t) => t.id)),
    [workspaceTracks]
  );

  // Build detected collection tags, custom groups & smart filter buckets
  const collections = useMemo(() => {
    const tagCounts = new Map<string, number>();
    const groupCounts = new Map<string, number>();
    let alpineStageCount = 0;

    for (const tour of tours) {
      if (extractStageNumber(tour.name) !== null || tour.name.toLowerCase().includes('alpentour')) {
        alpineStageCount++;
      }
      const grp = String(tour.tourGroup || '').trim();
      if (grp) {
        groupCounts.set(grp, (groupCounts.get(grp) || 0) + 1);
      }
      for (const rawTag of tour.tags || []) {
        const clean = rawTag.trim();
        if (!clean || clean.toLowerCase() === 'indoor/virtuell') continue;
        tagCounts.set(clean, (tagCounts.get(clean) || 0) + 1);
      }
    }

    const sortedGroups = Array.from(groupCounts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], 'de', { numeric: true })
    );

    const sortedTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'))
      .slice(0, 8);

    return {
      alpineStageCount,
      groups: sortedGroups,
      tags: sortedTags
    };
  }, [tours]);

  const filteredAndSortedTours = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const filtered = tours.filter((tour) => {
      if (sportFilter !== 'all' && tour.activityType !== sportFilter) return false;
      if (difficultyFilter !== 'all' && computeTourDifficulty(tour).level !== difficultyFilter) return false;

      const dist = Number(tour.distance || 0);
      if (distanceFilter === 'lt40' && !(dist < 40)) return false;
      if (distanceFilter === '40-80' && !(dist >= 40 && dist <= 80)) return false;
      if (distanceFilter === '80-130' && !(dist > 80 && dist <= 130)) return false;
      if (distanceFilter === 'gt130' && !(dist > 130)) return false;

      const asc = Number(tour.ascent || 0);
      if (ascentFilter === 'lt500' && !(asc < 500)) return false;
      if (ascentFilter === '500-1200' && !(asc >= 500 && asc <= 1200)) return false;
      if (ascentFilter === 'gt1200' && !(asc > 1200)) return false;

      const tourGroupClean = String(tour.tourGroup || '').trim();
      if (activeCollection === '__workspace__') {
        if (!workspaceTrackIdSet.has(tour.id)) return false;
      } else if (activeCollection === '__stages__') {
        if (extractStageNumber(tour.name) === null && !tour.name.toLowerCase().includes('alpentour')) {
          return false;
        }
      } else if (activeCollection === '__ungrouped__') {
        if (tourGroupClean.length > 0) return false;
      } else if (activeCollection.startsWith('group:')) {
        const targetGroup = activeCollection.slice('group:'.length);
        if (tourGroupClean !== targetGroup) return false;
      } else if (activeCollection !== 'all') {
        if (!(tour.tags || []).some((t) => t.trim().toLowerCase() === activeCollection.toLowerCase())) {
          return false;
        }
      }

      if (q) {
        const haystack = [
          tour.name,
          tour.description,
          tour.tourGroup,
          tour.originalFilename,
          ...(tour.tags || [])
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'added-desc') {
        const addedDiff = (b.addedAt || 0) - (a.addedAt || 0);
        if (addedDiff !== 0) return addedDiff;
        const dateDiff = new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime();
        if (dateDiff !== 0) return dateDiff;
        return a.name.localeCompare(b.name, 'de', { numeric: true });
      }
      if (sortBy === 'stage-asc') {
        const stageA = extractStageNumber(a.name);
        const stageB = extractStageNumber(b.name);
        if (stageA !== null && stageB !== null && stageA !== stageB) {
          return stageA - stageB;
        }
        if (stageA !== null && stageB === null) return -1;
        if (stageA === null && stageB !== null) return 1;
        return a.name.localeCompare(b.name, 'de', { numeric: true });
      }
      if (sortBy === 'dist-desc') return (b.distance || 0) - (a.distance || 0);
      if (sortBy === 'ascent-desc') return (b.ascent || 0) - (a.ascent || 0);
      if (sortBy === 'difficulty-desc') {
        return computeTourDifficulty(b).score - computeTourDifficulty(a).score;
      }
      if (sortBy === 'date-desc') {
        return new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime();
      }
      return a.name.localeCompare(b.name, 'de', { numeric: true });
    });

    return sorted;
  }, [
    tours,
    searchQuery,
    sportFilter,
    difficultyFilter,
    distanceFilter,
    ascentFilter,
    activeCollection,
    sortBy,
    workspaceTrackIdSet
  ]);

  const groupedSections = useMemo(() => {
    if (groupBy === 'none') {
      return [
        {
          key: '__all__',
          label: 'Alle Touren',
          editable: false,
          tours: filteredAndSortedTours,
          totalDist: filteredAndSortedTours.reduce((acc, t) => acc + (t.distance || 0), 0),
          totalAscent: filteredAndSortedTours.reduce((acc, t) => acc + (t.ascent || 0), 0)
        }
      ];
    }

    const bucketMap = new Map<
      string,
      { key: string; label: string; editable: boolean; orderHint: string; tours: PlannedTourMeta[] }
    >();

    for (const tour of filteredAndSortedTours) {
      let key = '';
      let label = '';
      let editable = false;
      let orderHint = '';

      if (groupBy === 'custom') {
        const grp = String(tour.tourGroup || '').trim();
        if (grp) {
          key = `custom:${grp}`;
          label = grp;
          editable = true;
          orderHint = `0_${grp.toLowerCase()}`;
        } else {
          key = UNGROUPED_KEY;
          label = 'Ohne Gruppe';
          editable = false;
          orderHint = '9_ungrouped';
        }
      } else if (groupBy === 'sport') {
        if (tour.activityType === 'running') {
          key = 'sport:running';
          label = 'Lauftouren';
          orderHint = '1_running';
        } else {
          key = 'sport:cycling';
          label = 'Radtouren';
          orderHint = '0_cycling';
        }
      } else if (groupBy === 'difficulty') {
        const diff = computeTourDifficulty(tour);
        key = `diff:${diff.level}`;
        label = `Schwierigkeit: ${diff.label}`;
        orderHint = diff.level === 'leicht' ? '0' : diff.level === 'mittel' ? '1' : '2';
      } else {
        const m = formatMonthGroup(tour.dateCreated);
        key = `month:${m.key}`;
        label = m.label;
        orderHint = m.key === 'month-unknown' ? '0000-00' : m.key;
      }

      if (!bucketMap.has(key)) {
        bucketMap.set(key, { key, label, editable, orderHint, tours: [] });
      }
      bucketMap.get(key)!.tours.push(tour);
    }

    const sections = Array.from(bucketMap.values()).sort((a, b) => {
      if (groupBy === 'month') {
        return b.orderHint.localeCompare(a.orderHint);
      }
      return a.orderHint.localeCompare(b.orderHint, 'de', { numeric: true });
    });

    return sections.map((sec) => ({
      key: sec.key,
      label: sec.label,
      editable: sec.editable,
      tours: sec.tours,
      totalDist: sec.tours.reduce((acc, t) => acc + (t.distance || 0), 0),
      totalAscent: sec.tours.reduce((acc, t) => acc + (t.ascent || 0), 0)
    }));
  }, [filteredAndSortedTours, groupBy]);

  const summaryStats = useMemo(() => {
    let totalDist = 0;
    let totalAscent = 0;
    let cyclingCount = 0;
    let runningCount = 0;
    let inWorkspaceCount = 0;

    for (const t of tours) {
      totalDist += t.distance || 0;
      totalAscent += t.ascent || 0;
      if (t.activityType === 'running') runningCount++;
      else cyclingCount++;
      if (workspaceTrackIdSet.has(t.id)) inWorkspaceCount++;
    }

    return {
      totalCount: tours.length,
      totalDist,
      totalAscent,
      cyclingCount,
      runningCount,
      inWorkspaceCount
    };
  }, [tours, workspaceTrackIdSet]);

  const resolveFullTrack = useCallback(async (meta: PlannedTourMeta): Promise<GPXTrack | null> => {
    const cached = hydratedTracksRef.current[meta.id];
    if (cached && cached.points && cached.points.length > 0) {
      return cached;
    }

    const fromWorkspace = workspaceTracks.find((t) => t.id === meta.id);
    if (fromWorkspace && fromWorkspace.points && fromWorkspace.points.length > 0) {
      return fromWorkspace;
    }

    const res = await apiFetch(getApiUrl(`/api/library/${encodeURIComponent(meta.id)}`));
    const data = await res.json();
    if (!data?.success || !data.track) {
      return null;
    }
    const track = data.track as GPXTrack;
    setHydratedTracks((prev) => ({ ...prev, [meta.id]: track }));
    return track;
  }, [workspaceTracks]);

  const handleOpenSolo = async (tour: PlannedTourMeta) => {
    setLoadingTrackId(tour.id);
    try {
      const full = await resolveFullTrack(tour);
      if (!full) {
        showToast('Tourdaten konnten nicht geladen werden.', 'error');
        return;
      }
      onOpenTourSolo({ ...full, visible: true });
    } catch (err) {
      console.error('Error loading solo tour:', err);
      showToast('Fehler beim Laden der Tour.', 'error');
    } finally {
      setLoadingTrackId(null);
    }
  };

  const handleToggleWorkspaceMembership = async (tour: PlannedTourMeta) => {
    if (workspaceTrackIdSet.has(tour.id)) {
      onRemoveTourFromWorkspace(tour.id);
      return;
    }
    setLoadingTrackId(tour.id);
    try {
      const full = await resolveFullTrack(tour);
      if (!full) {
        showToast('Tourdaten konnten nicht geladen werden.', 'error');
        return;
      }
      onAddTourToWorkspace({ ...full, visible: true });
      showToast(`"${tour.name}" zum Karten-Workspace hinzugefügt.`, 'success');
    } catch (err) {
      console.error('Error adding tour to workspace:', err);
      showToast('Fehler beim Hinzufügen der Tour.', 'error');
    } finally {
      setLoadingTrackId(null);
    }
  };

  const handleDownloadTourGpx = async (tour: PlannedTourMeta) => {
    setLoadingTrackId(tour.id);
    try {
      const full = await resolveFullTrack(tour);
      if (!full) {
        showToast('GPX-Daten konnten nicht geladen werden.', 'error');
        return;
      }
      downloadTrackAsGPX(full);
    } catch (err) {
      console.error('GPX export error:', err);
      showToast('GPX-Download fehlgeschlagen.', 'error');
    } finally {
      setLoadingTrackId(null);
    }
  };

  const handleUploadGpxFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setIsUploading(true);
    const parsedTracks: GPXTrack[] = [];
    const errors: string[] = [];

    try {
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        try {
          if (file.size < 200_000) {
            const text = await file.text();
            const validation = validateGPX(text);
            if (!validation.isValid) {
              errors.push(`${file.name}: ${validation.error}`);
              continue;
            }
            const tr = await parseGPX(text, file.name);
            if (tr) {
              tr.powerStats = calculatePowerStats(tr.points, ftp, userWeight, effectivePlanningSpeed);
              const surfStats = calculateSurfaceStatsFromPoints(tr.points);
              if (surfStats.length > 0) {
                tr.surfaceStats = surfStats;
                hydratePointsWithSurface(tr.points, surfStats, tr.distance);
              }
              if (!tr.tags || tr.tags.length === 0) {
                tr.tags = ['Geplante Tour'];
              }
              parsedTracks.push(tr);
            }
          } else {
            const tr = await parseGPXStream(file, file.name);
            if (tr) {
              tr.powerStats = calculatePowerStats(tr.points, ftp, userWeight, effectivePlanningSpeed);
              const surfStats = calculateSurfaceStatsFromPoints(tr.points);
              if (surfStats.length > 0) {
                tr.surfaceStats = surfStats;
                hydratePointsWithSurface(tr.points, surfStats, tr.distance);
              }
              if (!tr.tags || tr.tags.length === 0) {
                tr.tags = ['Geplante Tour'];
              }
              parsedTracks.push(tr);
            }
          }
        } catch (err: any) {
          errors.push(`${file.name}: ${err?.message || 'Fehler beim Parsen'}`);
        }
      }

      if (parsedTracks.length > 0) {
        const res = await apiFetch(getApiUrl('/api/library/save-batch'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: parsedTracks })
        });
        const data = await res.json();
        if (data.success) {
          showToast(
            `${data.savedCount ?? parsedTracks.length} GPX-Tour(en) in "Geplante Touren" gespeichert.`,
            'success'
          );
          await fetchPlannedTours();
        } else {
          showToast(data.error || 'Fehler beim Speichern der GPX-Touren.', 'error');
        }
      }

      if (errors.length > 0) {
        showToast(errors[0], 'error');
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleImportUrlTour = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isImportingUrl) return;
    const trimmed = urlImportInput.trim();
    if (!trimmed) {
      setUrlImportError('Bitte gib eine Komoot-Tour-URL oder einen direkten GPX-Link ein.');
      return;
    }
    if (!urlSaveAsPlanned && !urlOpenOnMap) {
      setUrlImportError('Bitte wähle mindestens „Auf Karte öffnen“ oder „Als Geplante Tour speichern“.');
      return;
    }

    setUrlImportError(null);
    setIsImportingUrl(true);

    try {
      const res = await apiFetch(getApiUrl('/api/import-url'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed })
      });
      const data = await res.json();

      if (!res.ok || !data?.success) {
        setUrlImportError(data?.error || `URL-Import fehlgeschlagen (HTTP ${res.status}).`);
        return;
      }

      if (data.kind === 'collection' && Array.isArray(data.tours)) {
        setPendingKomootCollection({
          collectionId: String(data.collectionId || ''),
          title: String(data.title || 'Komoot Collection'),
          sourceUrl: String(data.sourceUrl || trimmed),
          tours: data.tours
        });
        setUrlImportInput('');
        return;
      }

      if (!data.gpxContent) {
        setUrlImportError('Die abgerufene URL enthielt keine GPX-Daten.');
        return;
      }

      const validation = validateGPX(data.gpxContent);
      if (!validation.isValid) {
        setUrlImportError(validation.error || 'Die abgerufene Datei enthält keine gültigen GPX-Daten.');
        return;
      }

      const fallbackFileName = `${data.suggestedName || 'URL-Tour'}.gpx`;
      const parsed = await parseGPX(data.gpxContent, fallbackFileName);
      if (!parsed || !parsed.points || parsed.points.length < 2) {
        setUrlImportError('Es konnten keine gültigen GPS-Trackpunkte gefunden werden.');
        return;
      }

      if (data.suggestedName && (!parsed.name || parsed.name === fallbackFileName.replace(/\.gpx$/i, ''))) {
        parsed.name = String(data.suggestedName).trim();
      }
      if (data.activityType === 'running') {
        parsed.activityType = 'running';
      }

      parsed.powerStats = calculatePowerStats(
        parsed.points,
        ftp,
        userWeight,
        effectivePlanningSpeed,
        parsed.activityType
      );
      const surfStats = calculateSurfaceStatsFromPoints(parsed.points);
      if (surfStats.length > 0) {
        parsed.surfaceStats = surfStats;
        hydratePointsWithSurface(parsed.points, surfStats, parsed.distance);
      }

      const tags = Array.isArray(parsed.tags) ? [...parsed.tags] : [];
      if (data.sourceType === 'komoot' && !tags.includes('Komoot')) {
        tags.push('Komoot');
      }
      if (urlSaveAsPlanned && !tags.includes('Geplante Tour')) {
        tags.push('Geplante Tour');
      }
      parsed.tags = tags;

      const sourceAttachParams = {
        sourceType: (data.sourceType === 'komoot' ? 'komoot' : 'gpx') as 'komoot' | 'gpx',
        sourceUrl: String(data.sourceUrl || trimmed),
        komootTourId: typeof data.komootTourId === 'string' ? data.komootTourId : undefined,
        komootShareToken: data.komootShareToken ?? null,
        remoteUpdatedAt: typeof data.remoteUpdatedAt === 'string' ? data.remoteUpdatedAt : undefined
      };

      let finalTrack: GPXTrack = attachKomootSourceToTrack(parsed, sourceAttachParams);
      let matchedExistingMeta: PlannedTourMeta | null = null;
      let wasUpdatedVersion = false;
      let targetVersion = 1;

      if (urlSaveAsPlanned) {
        matchedExistingMeta = findMatchingExistingKomootTrack(tours, {
          komootTourId: sourceAttachParams.komootTourId,
          sourceUrl: sourceAttachParams.sourceUrl
        });

        if (matchedExistingMeta) {
          const existingFull = await resolveFullTrack(matchedExistingMeta);
          if (existingFull) {
            const refreshRes = applyKomootRefreshToTrack(existingFull, parsed, sourceAttachParams);
            finalTrack = refreshRes.track;
            wasUpdatedVersion = refreshRes.updated;
            targetVersion = refreshRes.newVersion;
          }
        }

        const saveRes = await apiFetch(getApiUrl('/api/library/save-batch'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: [finalTrack] })
        });
        const saveData = await saveRes.json();
        if (!saveRes.ok || !saveData?.success) {
          setUrlImportError(saveData?.error || 'Tour konnte nicht in "Geplante Touren" gespeichert werden.');
          return;
        }
        setHydratedTracks((prev) => ({ ...prev, [finalTrack.id]: finalTrack }));
        onSyncRefreshedTracksToWorkspace?.([finalTrack]);
        await fetchPlannedTours();
      }

      setUrlImportInput('');

      if (urlOpenOnMap) {
        onAddTourToWorkspace(finalTrack);
        onNavigateToMap();
      } else {
        if (matchedExistingMeta) {
          showToast(
            wasUpdatedVersion
              ? `"${finalTrack.name}" auf v${targetVersion} aktualisiert.`
              : `"${finalTrack.name}" ist bereits aktuell (v${targetVersion}).`,
            'success'
          );
        } else {
          showToast(`"${finalTrack.name}" (v1) als Geplante Tour importiert.`, 'success');
        }
      }
    } catch (err: any) {
      setUrlImportError(err?.message || 'Netzwerkfehler beim URL-Import.');
    } finally {
      setIsImportingUrl(false);
    }
  };

  const handleRefreshSingleTour = async (tour: PlannedTourMeta) => {
    const komootMeta = getKomootSourceMeta(tour);
    if (!komootMeta?.sourceUrl) {
      showToast('Diese Tour besitzt keine verknüpfte Komoot- oder URL-Quelle.', 'error');
      return;
    }

    setRefreshingTourId(tour.id);
    try {
      const existingFull = await resolveFullTrack(tour);
      if (!existingFull) {
        showToast('Tourdaten konnten nicht geladen werden.', 'error');
        return;
      }

      const res = await apiFetch(getApiUrl('/api/import-url'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: komootMeta.sourceUrl })
      });
      const data = await res.json();
      if (!res.ok || !data?.success || !data.gpxContent) {
        throw new Error(data?.error || `Aktualisierung fehlgeschlagen (HTTP ${res.status}).`);
      }

      const validation = validateGPX(data.gpxContent);
      if (!validation.isValid) {
        throw new Error(validation.error || 'Die abgerufene GPX-Datei ist ungültig.');
      }

      const fallbackFileName = `${data.suggestedName || tour.name || 'Komoot-Tour'}.gpx`;
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

      parsed.powerStats = calculatePowerStats(
        parsed.points,
        ftp,
        userWeight,
        effectivePlanningSpeed,
        parsed.activityType
      );
      const surfStats = calculateSurfaceStatsFromPoints(parsed.points);
      if (surfStats.length > 0) {
        parsed.surfaceStats = surfStats;
        hydratePointsWithSurface(parsed.points, surfStats, parsed.distance);
      }

      const refreshRes = applyKomootRefreshToTrack(existingFull, parsed, {
        sourceType: data.sourceType === 'gpx' ? 'gpx' : 'komoot',
        sourceUrl: String(data.sourceUrl || komootMeta.sourceUrl),
        komootTourId:
          typeof data.komootTourId === 'string' ? data.komootTourId : komootMeta.komootTourId,
        komootShareToken: data.komootShareToken ?? komootMeta.komootShareToken ?? null,
        komootCollectionId: komootMeta.komootCollectionId,
        komootCollectionTitle: komootMeta.komootCollectionTitle,
        komootCollectionUrl: komootMeta.komootCollectionUrl,
        remoteUpdatedAt:
          typeof data.remoteUpdatedAt === 'string' ? data.remoteUpdatedAt : undefined
      });

      const saveRes = await apiFetch(getApiUrl('/api/library/save-batch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: [refreshRes.track] })
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || !saveData?.success) {
        throw new Error(saveData?.error || 'Aktualisierte Version konnte nicht gespeichert werden.');
      }

      setHydratedTracks((prev) => ({ ...prev, [refreshRes.track.id]: refreshRes.track }));
      onSyncRefreshedTracksToWorkspace?.([refreshRes.track]);
      await fetchPlannedTours();

      showToast(
        refreshRes.updated
          ? `"${refreshRes.track.name}" auf v${refreshRes.newVersion} aktualisiert!`
          : `"${refreshRes.track.name}" ist bereits aktuell (v${refreshRes.newVersion}).`,
        'success'
      );
    } catch (err: any) {
      showToast(err?.message || 'Aktualisierung fehlgeschlagen.', 'error');
    } finally {
      setRefreshingTourId(null);
    }
  };

  const handleRefreshCollectionGroup = async (
    sectionKey: string,
    sectionLabel: string,
    sectionTours: PlannedTourMeta[]
  ) => {
    const linkedTours = sectionTours.filter((t) => Boolean(getKomootSourceMeta(t)));
    if (linkedTours.length === 0) {
      showToast('In dieser Gruppe sind keine Komoot-/URL-Tracks verknüpft.', 'error');
      return;
    }

    setRefreshingGroupKey(sectionKey);
    setGroupRefreshProgress({ done: 0, total: linkedTours.length });

    try {
      // Check if any track records a Komoot Collection URL to refresh tokens and discover new collection tours
      const collectionMeta = linkedTours
        .map((t) => getKomootSourceMeta(t))
        .find((m) => Boolean(m?.komootCollectionUrl));

      const remoteStubByTourId = new Map<string, any>();
      const newStubs: any[] = [];

      if (collectionMeta?.komootCollectionUrl) {
        try {
          const colRes = await apiFetch(getApiUrl('/api/import-url'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: collectionMeta.komootCollectionUrl })
          });
          const colData = await colRes.json();
          if (colRes.ok && colData?.success && colData.kind === 'collection' && Array.isArray(colData.tours)) {
            const existingTourIds = new Set(
              linkedTours
                .map((t) => getKomootSourceMeta(t)?.komootTourId)
                .filter((id): id is string => Boolean(id))
            );
            for (const stub of colData.tours) {
              if (!stub?.id) continue;
              remoteStubByTourId.set(String(stub.id), stub);
              if (!existingTourIds.has(String(stub.id))) {
                newStubs.push({
                  ...stub,
                  collectionId: String(colData.collectionId || collectionMeta.komootCollectionId || ''),
                  collectionTitle: sectionLabel,
                  collectionUrl: String(colData.sourceUrl || collectionMeta.komootCollectionUrl)
                });
              }
            }
          }
        } catch {
          // Non-fatal: continue refreshing individual linked tracks directly
        }
      }

      const totalTasks = linkedTours.length + newStubs.length;
      setGroupRefreshProgress({ done: 0, total: totalTasks });

      const tracksToSave: GPXTrack[] = [];
      let updatedCount = 0;
      let unchangedCount = 0;
      let addedNewCount = 0;
      let failedCount = 0;
      let doneCount = 0;

      const CONCURRENCY = 2;

      type RefreshTask =
        | { kind: 'existing'; meta: PlannedTourMeta }
        | { kind: 'new'; stub: any };

      const tasks: RefreshTask[] = [
        ...linkedTours.map((meta) => ({ kind: 'existing' as const, meta })),
        ...newStubs.map((stub) => ({ kind: 'new' as const, stub }))
      ];

      let cursor = 0;
      const worker = async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= tasks.length) break;
          const task = tasks[idx];

          try {
            if (task.kind === 'existing') {
              const tourMeta = task.meta;
              const kMeta = getKomootSourceMeta(tourMeta);
              const existingFull = await resolveFullTrack(tourMeta);
              if (!kMeta?.sourceUrl || !existingFull) {
                failedCount++;
                continue;
              }
              const stubOverride = kMeta.komootTourId
                ? remoteStubByTourId.get(kMeta.komootTourId)
                : undefined;
              const fetchUrl = stubOverride?.tourUrl || kMeta.sourceUrl;

              const res = await apiFetch(getApiUrl('/api/import-url'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: fetchUrl })
              });
              const data = await res.json();
              if (!res.ok || !data?.success || !data.gpxContent) {
                failedCount++;
                continue;
              }
              const validation = validateGPX(data.gpxContent);
              if (!validation.isValid) {
                failedCount++;
                continue;
              }
              const parsed = await parseGPX(
                data.gpxContent,
                `${data.suggestedName || tourMeta.name}.gpx`
              );
              if (!parsed || !parsed.points || parsed.points.length < 2) {
                failedCount++;
                continue;
              }
              if (data.suggestedName && (!parsed.name || parsed.name.startsWith('Komoot Tour'))) {
                parsed.name = String(data.suggestedName).trim();
              }
              if (data.activityType === 'running') {
                parsed.activityType = 'running';
              }
              parsed.powerStats = calculatePowerStats(
                parsed.points,
                ftp,
                userWeight,
                effectivePlanningSpeed,
                parsed.activityType
              );
              const surfStats = calculateSurfaceStatsFromPoints(parsed.points);
              if (surfStats.length > 0) {
                parsed.surfaceStats = surfStats;
                hydratePointsWithSurface(parsed.points, surfStats, parsed.distance);
              }

              const refreshRes = applyKomootRefreshToTrack(existingFull, parsed, {
                sourceType: data.sourceType === 'gpx' ? 'gpx' : 'komoot',
                sourceUrl: String(data.sourceUrl || fetchUrl),
                komootTourId:
                  typeof data.komootTourId === 'string'
                    ? data.komootTourId
                    : kMeta.komootTourId,
                komootShareToken:
                  data.komootShareToken ?? stubOverride?.shareToken ?? kMeta.komootShareToken ?? null,
                komootCollectionId: kMeta.komootCollectionId,
                komootCollectionTitle: kMeta.komootCollectionTitle || sectionLabel,
                komootCollectionUrl: kMeta.komootCollectionUrl,
                remoteUpdatedAt:
                  typeof data.remoteUpdatedAt === 'string' ? data.remoteUpdatedAt : undefined
              });

              tracksToSave.push(refreshRes.track);
              if (refreshRes.updated) updatedCount++;
              else unchangedCount++;
            } else {
              const stub = task.stub;
              const res = await apiFetch(getApiUrl('/api/import-url'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: stub.tourUrl })
              });
              const data = await res.json();
              if (!res.ok || !data?.success || !data.gpxContent) {
                failedCount++;
                continue;
              }
              const validation = validateGPX(data.gpxContent);
              if (!validation.isValid) {
                failedCount++;
                continue;
              }
              const parsed = await parseGPX(
                data.gpxContent,
                `${stub.name || data.suggestedName || `Komoot Tour ${stub.id}`}.gpx`
              );
              if (!parsed || !parsed.points || parsed.points.length < 2) {
                failedCount++;
                continue;
              }
              if (stub.name && (!parsed.name || parsed.name.startsWith('Komoot Tour'))) {
                parsed.name = stub.name;
              }
              if (stub.activityType === 'running' || data.activityType === 'running') {
                parsed.activityType = 'running';
              }
              parsed.powerStats = calculatePowerStats(
                parsed.points,
                ftp,
                userWeight,
                effectivePlanningSpeed,
                parsed.activityType
              );
              const surfStats = calculateSurfaceStatsFromPoints(parsed.points);
              if (surfStats.length > 0) {
                parsed.surfaceStats = surfStats;
                hydratePointsWithSurface(parsed.points, surfStats, parsed.distance);
              }
              parsed.tags = ['Komoot', 'Geplante Tour'];
              if (sectionLabel && sectionLabel !== 'Ohne Gruppe') {
                parsed.tourGroup = sectionLabel;
              }

              const withSource = attachKomootSourceToTrack(parsed, {
                sourceType: 'komoot',
                sourceUrl: String(data.sourceUrl || stub.tourUrl),
                komootTourId: String(data.komootTourId || stub.id),
                komootShareToken: data.komootShareToken ?? stub.shareToken ?? null,
                komootCollectionId: stub.collectionId || undefined,
                komootCollectionTitle: sectionLabel,
                komootCollectionUrl: stub.collectionUrl || undefined,
                remoteUpdatedAt:
                  typeof data.remoteUpdatedAt === 'string' ? data.remoteUpdatedAt : undefined
              });
              tracksToSave.push(withSource);
              addedNewCount++;
            }
          } catch {
            failedCount++;
          } finally {
            doneCount++;
            setGroupRefreshProgress({ done: doneCount, total: totalTasks });
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker()));

      if (tracksToSave.length > 0) {
        const saveRes = await apiFetch(getApiUrl('/api/library/save-batch'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: tracksToSave })
        });
        const saveData = await saveRes.json();
        if (!saveRes.ok || !saveData?.success) {
          throw new Error(saveData?.error || 'Aktualisierte Collection konnte nicht gespeichert werden.');
        }

        setHydratedTracks((prev) => {
          const next = { ...prev };
          for (const tr of tracksToSave) {
            next[tr.id] = tr;
          }
          return next;
        });
        onSyncRefreshedTracksToWorkspace?.(tracksToSave);
        await fetchPlannedTours();
      }

      const parts: string[] = [];
      if (updatedCount > 0) parts.push(`${updatedCount} aktualisiert`);
      if (addedNewCount > 0) parts.push(`${addedNewCount} neu importiert`);
      if (unchangedCount > 0) parts.push(`${unchangedCount} unverändert`);
      if (failedCount > 0) parts.push(`${failedCount} fehlgeschlagen`);

      showToast(
        `„${sectionLabel}“: ${parts.length > 0 ? parts.join(' · ') : 'Keine Änderungen'}`,
        failedCount > 0 && updatedCount === 0 && addedNewCount === 0 && unchangedCount === 0
          ? 'error'
          : 'success'
      );
    } catch (err: any) {
      showToast(err?.message || 'Collection-Aktualisierung fehlgeschlagen.', 'error');
    } finally {
      setRefreshingGroupKey(null);
      setGroupRefreshProgress(null);
    }
  };

  const handleKomootCollectionComplete = async (result: KomootCollectionImportCompletion) => {
    setPendingKomootCollection(null);

    if (result.importedTracks.length > 0) {
      setHydratedTracks((prev) => {
        const next = { ...prev };
        for (const tr of result.importedTracks) {
          next[tr.id] = tr;
        }
        return next;
      });
      onSyncRefreshedTracksToWorkspace?.(result.importedTracks);
    }

    if (result.savedToPlanned) {
      if (groupBy === 'none') {
        setGroupBy('custom');
      }
      await fetchPlannedTours();
    }

    if (result.openOnMap && result.importedTracks.length > 0) {
      onOpenToursBatch(result.importedTracks, false);
    } else {
      const count = result.importedTracks.length;
      const updateSuffix =
        result.updatedCount && result.updatedCount > 0
          ? ` (${result.updatedCount} auf neue Version aktualisiert)`
          : '';
      showToast(
        `${count} ${count === 1 ? 'Tour' : 'Touren'} aus „${result.collectionTitle}“ importiert${updateSuffix}.`,
        'success'
      );
    }
  };

  const handleSaveWorkspaceToPlanned = async () => {
    const candidates = workspaceTracks.filter(
      (t) =>
        t.points &&
        t.points.length > 1 &&
        !t.id.startsWith('garmin-fit-') &&
        !t.id.startsWith('garmin-act-')
    );
    if (candidates.length === 0) {
      showToast('Keine GPX-Touren im aktuellen Karten-Workspace gefunden.', 'error');
      return;
    }

    setIsSavingWorkspace(true);
    try {
      const prepared = candidates.map((t) => ({
        ...t,
        tags: t.tags && t.tags.length > 0 ? t.tags : ['Geplante Tour']
      }));
      const res = await apiFetch(getApiUrl('/api/library/save-batch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: prepared })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`${data.savedCount ?? prepared.length} Workspace-Tour(en) gespeichert!`, 'success');
        await fetchPlannedTours();
      } else {
        showToast(data.error || 'Speichern fehlgeschlagen.', 'error');
      }
    } catch (err) {
      console.error('Failed to save workspace tours:', err);
      showToast('Verbindungsfehler beim Speichern.', 'error');
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const handleDeleteTour = async (id: string) => {
    try {
      const res = await apiFetch(getApiUrl(`/api/library/${encodeURIComponent(id)}`), {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        setTours((prev) => prev.filter((t) => t.id !== id));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setConfirmDeleteId(null);
        showToast('Geplante Tour gelöscht.', 'success');
      } else {
        showToast(data.error || 'Löschen fehlgeschlagen.', 'error');
      }
    } catch (err) {
      console.error('Failed to delete planned tour:', err);
      showToast('Verbindungsfehler beim Löschen.', 'error');
    }
  };

  const handleOpenEdit = (tour: PlannedTourMeta) => {
    setEditingTour(tour);
    setEditForm({
      name: tour.name || '',
      description: tour.description || '',
      tags: (tour.tags || []).join(', '),
      tourGroup: tour.tourGroup || '',
      activityType: tour.activityType || 'cycling',
      dateCreated: tour.dateCreated ? String(tour.dateCreated).split('T')[0] : ''
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTour || !editForm.name.trim()) return;
    setIsSavingEdit(true);
    try {
      const tagsArray = editForm.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const cleanGroup = editForm.tourGroup.trim();
      const res = await apiFetch(getApiUrl(`/api/library/${encodeURIComponent(editingTour.id)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim(),
          description: editForm.description,
          tags: tagsArray,
          tourGroup: cleanGroup,
          activityType: editForm.activityType,
          dateCreated: editForm.dateCreated || undefined
        })
      });
      const data = await res.json();
      if (data.success) {
        setTours((prev) =>
          prev.map((t) =>
            t.id === editingTour.id
              ? {
                  ...t,
                  name: editForm.name.trim(),
                  description: editForm.description,
                  tags: tagsArray,
                  tourGroup: cleanGroup,
                  activityType: editForm.activityType,
                  dateCreated: editForm.dateCreated || t.dateCreated
                }
              : t
          )
        );
        setEditingTour(null);
        showToast('Tour-Details aktualisiert.', 'success');
      } else {
        showToast(data.error || 'Aktualisieren fehlgeschlagen.', 'error');
      }
    } catch (err) {
      console.error('Failed to update tour:', err);
      showToast('Speichern fehlgeschlagen.', 'error');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const toggleGroupCollapsed = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const handleStartRenameGroup = (groupKey: string, currentName: string) => {
    setRenamingGroupKey(groupKey);
    setRenameGroupValue(currentName);
  };

  const handleCommitRenameGroup = async (oldName: string) => {
    const newName = renameGroupValue.trim();
    if (!newName || newName === oldName) {
      setRenamingGroupKey(null);
      return;
    }
    setIsRenamingGroup(true);
    try {
      const res = await apiFetch(getApiUrl('/api/library/groups/rename'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldName, newName })
      });
      const data = await res.json();
      if (data?.success) {
        setTours((prev) =>
          prev.map((t) => (String(t.tourGroup || '').trim() === oldName ? { ...t, tourGroup: newName } : t))
        );
        if (activeCollection === `group:${oldName}`) {
          setActiveCollection(`group:${newName}`);
        }
        setRenamingGroupKey(null);
        showToast(`Gruppe "${oldName}" in "${newName}" umbenannt.`, 'success');
      } else {
        showToast(data?.error || 'Umbenennen der Gruppe fehlgeschlagen.', 'error');
      }
    } catch {
      showToast('Verbindungsfehler beim Umbenennen der Gruppe.', 'error');
    } finally {
      setIsRenamingGroup(false);
    }
  };

  const handleBatchAssignGroup = async (targetGroupName: string) => {
    const ids = Array.from(selectedIds);
    const cleanGroup = targetGroupName.trim();
    if (ids.length === 0) return;

    setIsAssigningBatchGroup(true);
    try {
      const res = await apiFetch(getApiUrl('/api/library/groups/assign'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, tourGroup: cleanGroup })
      });
      const data = await res.json();
      if (data?.success) {
        const idSet = new Set(ids);
        setTours((prev) =>
          prev.map((t) => (idSet.has(t.id) ? { ...t, tourGroup: cleanGroup } : t))
        );
        if (cleanGroup && groupBy === 'none') {
          setGroupBy('custom');
        }
        setBatchAssignTarget('');
        setBatchNewGroupName('');
        showToast(
          cleanGroup
            ? `${ids.length} Tour(en) Gruppe "${cleanGroup}" zugewiesen.`
            : `${ids.length} Tour(en) aus Gruppe gelöst.`,
          'success'
        );
      } else {
        showToast(data?.error || 'Gruppenzuweisung fehlgeschlagen.', 'error');
      }
    } catch {
      showToast('Verbindungsfehler bei der Gruppenzuweisung.', 'error');
    } finally {
      setIsAssigningBatchGroup(false);
    }
  };

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    const visibleIds = filteredAndSortedTours.map((t) => t.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const handleOpenSelectedBatch = async (replaceWorkspace: boolean) => {
    const chosen = filteredAndSortedTours.filter((t) => selectedIds.has(t.id));
    if (chosen.length === 0) return;

    const resolved: GPXTrack[] = [];
    for (const meta of chosen) {
      const full = await resolveFullTrack(meta);
      if (full) resolved.push({ ...full, visible: true });
    }
    if (resolved.length === 0) {
      showToast('Ausgewählte Touren konnten nicht geladen werden.', 'error');
      return;
    }
    onOpenToursBatch(resolved, replaceWorkspace);
    setSelectedIds(new Set());
  };

  const handleCompareSelectedPair = async () => {
    if (!onCompareTwoToursOnMap || selectedIds.size !== 2) return;
    const chosen = filteredAndSortedTours.filter((t) => selectedIds.has(t.id));
    if (chosen.length !== 2) return;

    const [full1, full2] = await Promise.all([
      resolveFullTrack(chosen[0]),
      resolveFullTrack(chosen[1])
    ]);
    if (!full1 || !full2) {
      showToast('Ausgewählte Touren konnten nicht geladen werden.', 'error');
      return;
    }
    setSelectedIds(new Set());
    onCompareTwoToursOnMap({ ...full1, visible: true }, { ...full2, visible: true });
  };

  const handleBulkDeleteSelected = async () => {
    const idsToDelete = Array.from(selectedIds);
    if (idsToDelete.length === 0) return;
    let deleted = 0;
    for (const id of idsToDelete) {
      try {
        const res = await apiFetch(getApiUrl(`/api/library/${encodeURIComponent(id)}`), {
          method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) deleted++;
      } catch {
        // continue
      }
    }
    setConfirmBulkDelete(false);
    setSelectedIds(new Set());
    showToast(`${deleted} Tour(en) aus "Geplante Touren" entfernt.`, 'success');
    await fetchPlannedTours();
  };

  const allVisibleSelected =
    filteredAndSortedTours.length > 0 &&
    filteredAndSortedTours.every((t) => selectedIds.has(t.id));

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <input
        ref={gpxUploadInputRef}
        type="file"
        multiple
        accept=".gpx"
        className="hidden"
        onChange={(e) => {
          handleUploadGpxFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Top Header & KPI Overview */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-4 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
              <Compass className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-black tracking-tight text-slate-900 dark:text-white">
                  Geplante Touren
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/70">
                  {summaryStats.totalCount} gespeichert
                </span>
                {summaryStats.inWorkspaceCount > 0 && (
                  <button
                    type="button"
                    onClick={onNavigateToMap}
                    className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/70 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <Layers className="w-3 h-3" />
                    {summaryStats.inWorkspaceCount} auf Karte aktiv
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Komoot-Bibliothek für geplante GPX-Routen &amp; Etappen – getrennt von aufgezeichneten Aktivitäten.
              </p>
            </div>
          </div>

          {/* Primary Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => gpxUploadInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all cursor-pointer disabled:opacity-50"
            >
              {isUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              <span>GPX-Tour planen / importieren</span>
            </button>

            <button
              type="button"
              id="btn-planned-url-import-toggle"
              onClick={() => {
                setUrlImportError(null);
                setShowUrlImportPanel((prev) => {
                  const next = !prev;
                  if (next) {
                    setTimeout(() => urlImportInputRef.current?.focus(), 60);
                  }
                  return next;
                });
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border shadow-sm transition-all cursor-pointer ${
                showUrlImportPanel
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-400 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <Link2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>URL / Komoot importieren</span>
            </button>

            {workspaceTracks.length > 0 && (
              <button
                type="button"
                onClick={handleSaveWorkspaceToPlanned}
                disabled={isSavingWorkspace}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all cursor-pointer disabled:opacity-50"
                title="Aktuell auf der Karte geöffnete Strecken dauerhaft hier speichern"
              >
                {isSavingWorkspace ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Workspace sichern ({workspaceTracks.length})</span>
              </button>
            )}
          </div>
        </div>

        {/* Inline Expandable URL / Komoot Import Strip */}
        {showUrlImportPanel && (
          <form
            onSubmit={handleImportUrlTour}
            className="max-w-7xl mx-auto mt-3 p-3 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200/80 dark:border-emerald-800/60 space-y-2.5"
          >
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Link2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={urlImportInputRef}
                  id="input-planned-url-import"
                  type="url"
                  value={urlImportInput}
                  onChange={(e) => {
                    setUrlImportInput(e.target.value);
                    if (urlImportError) setUrlImportError(null);
                  }}
                  placeholder="https://www.komoot.com/tour/... , /collection/... oder .gpx-Link"
                  disabled={isImportingUrl}
                  className="w-full pl-9 pr-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="submit"
                  id="btn-planned-url-import-submit"
                  disabled={isImportingUrl || !urlImportInput.trim()}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow-sm transition-colors cursor-pointer"
                >
                  {isImportingUrl ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Importiere...</span>
                    </>
                  ) : (
                    <span>Route laden</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUrlImportPanel(false);
                    setUrlImportError(null);
                  }}
                  className="p-2 rounded-xl text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-800 cursor-pointer"
                  title="Schließen"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600 dark:text-slate-300">
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none font-medium">
                <input
                  type="checkbox"
                  checked={urlOpenOnMap}
                  onChange={(e) => setUrlOpenOnMap(e.target.checked)}
                  disabled={isImportingUrl}
                  className="rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5"
                />
                <span>Auf Karte öffnen</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none font-medium">
                <input
                  type="checkbox"
                  checked={urlSaveAsPlanned}
                  onChange={(e) => setUrlSaveAsPlanned(e.target.checked)}
                  disabled={isImportingUrl}
                  className="rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5"
                />
                <span>Als Geplante Tour speichern</span>
              </label>
              <span className="text-[10.5px] text-slate-400 dark:text-slate-500">
                Unterstützt öffentliche Komoot-Touren, Collections (inkl. share_token) &amp; direkte GPX-Links
              </span>
            </div>

            {urlImportError && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-700 dark:text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{urlImportError}</span>
              </div>
            )}
          </form>
        )}

        {/* Summary KPI Strip & Filter Toolbar */}
        <div className="max-w-7xl mx-auto mt-4 flex flex-col gap-3">
          {/* Quick Summary KPI Pills (without Plan-Tempo slider; global Settings speed used) */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl px-3.5 py-2.5">
            <div className="flex items-center gap-4 sm:gap-6 flex-wrap text-xs">
              <div className="flex items-center gap-1.5">
                <Ruler className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-slate-500 dark:text-slate-400">Gesamtdistanz:</span>
                <strong className="font-mono text-slate-900 dark:text-white">
                  {summaryStats.totalDist.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km
                </strong>
              </div>
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-slate-500 dark:text-slate-400">Anstieg gesamt:</span>
                <strong className="font-mono text-slate-900 dark:text-white">
                  +{Math.round(summaryStats.totalAscent).toLocaleString('de-DE')} hm
                </strong>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>🚴 {summaryStats.cyclingCount} Rad</span>
                <span>·</span>
                <span>🏃 {summaryStats.runningCount} Lauf</span>
              </div>
            </div>

            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {filteredAndSortedTours.length} / {tours.length} Touren angezeigt
            </div>
          </div>

          {/* Search, Filters, Grouping & View Controls */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-2.5">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Touren durchsuchen (Name, Gruppe, Tags, Notizen)..."
                className="w-full pl-9 pr-8 py-2 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Sport Filter */}
              <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200/80 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setSportFilter('all')}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                    sportFilter === 'all'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  Alle
                </button>
                <button
                  type="button"
                  onClick={() => setSportFilter('cycling')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                    sportFilter === 'cycling'
                      ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <Bike className="w-3.5 h-3.5" />
                  Rad
                </button>
                <button
                  type="button"
                  onClick={() => setSportFilter('running')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                    sportFilter === 'running'
                      ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <Footprints className="w-3.5 h-3.5" />
                  Lauf
                </button>
              </div>

              {/* Difficulty Filter */}
              <select
                value={difficultyFilter}
                onChange={(e) => setDifficultyFilter(e.target.value as 'all' | DifficultyLevel)}
                className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                aria-label="Schwierigkeit filtern"
              >
                <option value="all">Schwierigkeit: Alle</option>
                <option value="leicht">🟢 Leicht</option>
                <option value="mittel">🟡 Mittel</option>
                <option value="schwer">🔴 Schwer</option>
              </select>

              {/* Distance Filter */}
              <select
                value={distanceFilter}
                onChange={(e) => setDistanceFilter(e.target.value as DistanceFilterOption)}
                className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                aria-label="Distanz filtern"
              >
                <option value="all">Distanz: Alle</option>
                <option value="lt40">&lt; 40 km</option>
                <option value="40-80">40–80 km</option>
                <option value="80-130">80–130 km</option>
                <option value="gt130">&gt; 130 km</option>
              </select>

              {/* Ascent Filter */}
              <select
                value={ascentFilter}
                onChange={(e) => setAscentFilter(e.target.value as AscentFilterOption)}
                className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                aria-label="Anstieg filtern"
              >
                <option value="all">Anstieg: Alle</option>
                <option value="lt500">&lt; 500 hm</option>
                <option value="500-1200">500–1.200 hm</option>
                <option value="gt1200">&gt; 1.200 hm</option>
              </select>

              {/* Grouping Dropdown */}
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <Folder className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupByOption)}
                  className="bg-transparent text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer focus:outline-none"
                  aria-label="Touren gruppieren"
                >
                  <option value="none">Gruppierung: Keine</option>
                  <option value="custom">Eigene Gruppen</option>
                  <option value="sport">Nach Sportart</option>
                  <option value="difficulty">Nach Schwierigkeit</option>
                  <option value="month">Nach Monat</option>
                </select>
              </div>

              {/* Sort Dropdown (Default: Zuletzt hinzugefügt) */}
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="bg-transparent text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer focus:outline-none"
                  aria-label="Touren sortieren"
                >
                  <option value="added-desc">Zuletzt hinzugefügt</option>
                  <option value="stage-asc">Etappe / Name (1 → 7)</option>
                  <option value="dist-desc">Distanz (längste zuerst)</option>
                  <option value="ascent-desc">Höhenmeter (meiste zuerst)</option>
                  <option value="difficulty-desc">Schwierigkeit (schwer → leicht)</option>
                  <option value="date-desc">Zuletzt geplant</option>
                  <option value="name-asc">Alphabetisch (A → Z)</option>
                </select>
              </div>

              {/* View Mode Switcher */}
              <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200/80 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setViewMode('cards')}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    viewMode === 'cards'
                      ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                  title="Komoot Karten-Ansicht"
                  aria-label="Karten-Ansicht"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    viewMode === 'table'
                      ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                  title="Kompakte Etappen-Tabelle"
                  aria-label="Tabellen-Ansicht"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Collections, Custom Groups & Tags Filter Bar */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => setActiveCollection('all')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                  activeCollection === 'all'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                Alle Touren ({tours.length})
              </button>

              {collections.groups.map(([groupName, count]) => (
                <button
                  key={`grp-${groupName}`}
                  type="button"
                  onClick={() => setActiveCollection(`group:${groupName}`)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                    activeCollection === `group:${groupName}`
                      ? 'bg-teal-600 text-white'
                      : 'bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 border border-teal-200/70 dark:border-teal-800/60 hover:bg-teal-100 dark:hover:bg-teal-900/50'
                  }`}
                >
                  <Folder className="w-3 h-3" />
                  {groupName} ({count})
                </button>
              ))}

              {collections.alpineStageCount > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveCollection('__stages__')}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                    activeCollection === '__stages__'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  🏔️ Mehrtagestour / Etappen ({collections.alpineStageCount})
                </button>
              )}

              {summaryStats.inWorkspaceCount > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveCollection('__workspace__')}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                    activeCollection === '__workspace__'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
                  }`}
                >
                  Auf Karte geladen ({summaryStats.inWorkspaceCount})
                </button>
              )}

              {collections.tags.map(([tagName, count]) => (
                <button
                  key={tagName}
                  type="button"
                  onClick={() => setActiveCollection(tagName)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    activeCollection === tagName
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <Tag className="w-3 h-3 opacity-70" />
                  {tagName} ({count})
                </button>
              ))}
            </div>

            {filteredAndSortedTours.length > 0 && (
              <button
                type="button"
                onClick={handleSelectAllVisible}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 cursor-pointer px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                {allVisibleSelected ? (
                  <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
                <span>{allVisibleSelected ? 'Auswahl aufheben' : 'Alle sichtbaren auswählen'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Inline Toast Feedback (stays inside Planned Tours page, never covers the map) */}
      {toast && (
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 pt-3 shrink-0">
          <div
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between border ${
              toast.type === 'error'
                ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
            }`}
          >
            <span>{toast.message}</span>
            <button type="button" onClick={() => setToast(null)} className="cursor-pointer opacity-70 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Multi-Select Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="bg-emerald-900 dark:bg-emerald-950 text-white px-4 sm:px-6 py-2.5 border-b border-emerald-700/60 shrink-0">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold">
              <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950 font-mono">
                {selectedIds.size}
              </span>
              <span>Tour(en) ausgewählt</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Batch Group Assign */}
              <div className="inline-flex items-center gap-1.5 bg-emerald-800/80 border border-emerald-600/60 rounded-lg px-2 py-1">
                <FolderPlus className="w-3.5 h-3.5 text-emerald-200 shrink-0" />
                <select
                  value={batchAssignTarget}
                  disabled={isAssigningBatchGroup}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__new__') {
                      setBatchAssignTarget('__new__');
                      setBatchNewGroupName('');
                    } else if (val === '__clear__') {
                      void handleBatchAssignGroup('');
                    } else if (val) {
                      void handleBatchAssignGroup(val);
                    }
                  }}
                  className="bg-transparent text-xs font-bold text-white cursor-pointer focus:outline-none"
                  aria-label="Auswahl einer Gruppe zuweisen"
                >
                  <option value="" className="text-slate-900">
                    Gruppe zuweisen...
                  </option>
                  {collections.groups.map(([grp]) => (
                    <option key={grp} value={grp} className="text-slate-900">
                      {grp}
                    </option>
                  ))}
                  <option value="__new__" className="text-slate-900">
                    + Neue Gruppe erstellen...
                  </option>
                  <option value="__clear__" className="text-slate-900">
                    Aus Gruppe entfernen
                  </option>
                </select>
                {batchAssignTarget === '__new__' && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (batchNewGroupName.trim()) {
                        void handleBatchAssignGroup(batchNewGroupName);
                      }
                    }}
                    className="inline-flex items-center gap-1 ml-1"
                  >
                    <input
                      type="text"
                      value={batchNewGroupName}
                      onChange={(e) => setBatchNewGroupName(e.target.value)}
                      placeholder="Gruppenname..."
                      autoFocus
                      className="px-2 py-0.5 rounded bg-white text-slate-900 text-xs font-semibold w-32 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!batchNewGroupName.trim() || isAssigningBatchGroup}
                      className="px-2 py-0.5 rounded bg-emerald-500 text-slate-950 font-extrabold text-[11px] cursor-pointer disabled:opacity-50"
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      onClick={() => setBatchAssignTarget('')}
                      className="text-emerald-200 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </form>
                )}
              </div>

              {selectedIds.size === 2 && onCompareTwoToursOnMap && (
                <button
                  type="button"
                  onClick={handleCompareSelectedPair}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold bg-orange-500 hover:bg-orange-600 text-white shadow-sm transition-colors cursor-pointer"
                >
                  <GitCompare className="w-3.5 h-3.5" />
                  <span>2 Touren auf Karte vergleichen</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => handleOpenSelectedBatch(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-emerald-950 hover:bg-emerald-50 transition-colors cursor-pointer"
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Nur Auswahl auf Karte öffnen</span>
              </button>
              <button
                type="button"
                onClick={() => handleOpenSelectedBatch(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-700 hover:bg-emerald-600 text-white transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Zu Workspace hinzufügen</span>
              </button>
              {confirmBulkDelete ? (
                <div className="inline-flex items-center gap-1.5 bg-rose-700 px-2.5 py-1 rounded-lg text-xs">
                  <span className="font-bold">Wirklich löschen?</span>
                  <button
                    type="button"
                    onClick={handleBulkDeleteSelected}
                    className="px-2 py-0.5 bg-white text-rose-800 rounded font-extrabold cursor-pointer"
                  >
                    Ja
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBulkDelete(false)}
                    className="px-2 py-0.5 bg-rose-800 text-white rounded font-semibold cursor-pointer"
                  >
                    Nein
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmBulkDelete(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-rose-600/90 hover:bg-rose-600 text-white transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Löschen</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelectedIds(new Set());
                  setConfirmBulkDelete(false);
                }}
                className="px-2 py-1 text-xs text-emerald-200 hover:text-white cursor-pointer"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
        <div className="max-w-7xl mx-auto">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-72 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse"
                />
              ))}
            </div>
          ) : filteredAndSortedTours.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center space-y-4 max-w-xl mx-auto mt-6">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                <Compass className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                  {tours.length === 0 ? 'Noch keine geplanten Touren gespeichert' : 'Keine passenden Touren gefunden'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {tours.length === 0
                    ? 'Importiere GPX-Dateien direkt hierher oder speichere Touren aus deinem Karten-Workspace.'
                    : 'Passe Suche, Sportart oder Schwierigkeitsfilter an.'}
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
                <button
                  type="button"
                  onClick={() => gpxUploadInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  GPX-Tour importieren
                </button>
                {tours.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSportFilter('all');
                      setDifficultyFilter('all');
                      setDistanceFilter('all');
                      setAscentFilter('all');
                      setActiveCollection('all');
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    Filter zurücksetzen
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {groupedSections.map((section) => {
                const isGroupedMode = groupBy !== 'none';
                const isCollapsed = isGroupedMode && collapsedGroups.has(section.key);
                const isRenamingThis = renamingGroupKey === section.key;

                const renderCardsGrid = (sectionTours: PlannedTourMeta[]) => (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {sectionTours.map((tour) => {
                      const hydrated = hydratedTracks[tour.id];
                      const diff = computeTourDifficulty(tour);
                      const estSeconds = estimateTourDurationSeconds(tour, effectivePlanningSpeed);
                      const stageNum = extractStageNumber(tour.name);
                      const inWorkspace = workspaceTrackIdSet.has(tour.id);
                      const isSelected = selectedIds.has(tour.id);
                      const isBusy = loadingTrackId === tour.id;

                      const diffBadgeClass =
                        diff.level === 'leicht'
                          ? 'bg-emerald-500/90 text-white'
                          : diff.level === 'mittel'
                          ? 'bg-amber-500/90 text-slate-950'
                          : 'bg-rose-500/90 text-white';

                      const surfaceTotal = (tour.surfaceStats || []).reduce((acc, s) => acc + (s.distance || 0), 0);

                      return (
                        <article
                          key={tour.id}
                          className={`group rounded-2xl bg-white dark:bg-slate-900 border transition-all overflow-hidden flex flex-col shadow-xs hover:shadow-md ${
                            inWorkspace
                              ? 'border-indigo-400 dark:border-indigo-600 ring-1 ring-indigo-400/30'
                              : isSelected
                              ? 'border-emerald-500 ring-1 ring-emerald-500/40'
                              : 'border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          {/* Preview Header */}
                          <div className="relative">
                            <TourMiniPreviewSvg track={hydrated} accentColor={tour.color} />

                            {/* Top Overlay Controls */}
                            <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none">
                              <div className="flex items-center gap-1.5 pointer-events-auto">
                                <button
                                  type="button"
                                  onClick={() => toggleSelectId(tour.id)}
                                  className={`w-6 h-6 rounded-lg flex items-center justify-center border backdrop-blur-md transition-colors cursor-pointer ${
                                    isSelected
                                      ? 'bg-emerald-500 border-emerald-400 text-white'
                                      : 'bg-slate-950/60 border-white/20 text-white/80 hover:bg-slate-900'
                                  }`}
                                  title={isSelected ? 'Auswahl aufheben' : 'Für Stapelaktion auswählen'}
                                >
                                  {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                </button>

                                {stageNum !== null && (
                                  <span className="px-2 py-0.5 rounded-lg bg-slate-950/75 text-white text-[10px] font-black tracking-wide border border-white/15 backdrop-blur-md">
                                    Etappe {stageNum}
                                  </span>
                                )}

                                <span
                                  className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold tracking-wide backdrop-blur-md ${diffBadgeClass}`}
                                >
                                  {diff.label}
                                </span>
                              </div>

                              <div className="flex items-center gap-1 pointer-events-auto">
                                {(() => {
                                  const kMeta = getKomootSourceMeta(tour);
                                  if (!kMeta) return null;
                                  return (
                                    <span
                                      className="px-2 py-0.5 rounded-lg bg-emerald-600/90 text-white text-[10px] font-mono font-extrabold tabular-nums shadow-sm backdrop-blur-md"
                                      title={`${kMeta.sourceType === 'komoot' ? 'Komoot-Quelle' : 'GPX-URL-Quelle'} · Version v${kMeta.version} · Zuletzt geprüft: ${new Date(kMeta.lastCheckedAt).toLocaleString('de-DE')}`}
                                    >
                                      v{kMeta.version}
                                    </span>
                                  );
                                })()}
                                {inWorkspace && (
                                  <span className="px-2 py-0.5 rounded-lg bg-indigo-600/95 text-white text-[10px] font-bold shadow-sm">
                                    Auf Karte
                                  </span>
                                )}
                                <span className="w-6 h-6 rounded-lg bg-slate-950/70 text-white flex items-center justify-center border border-white/15 backdrop-blur-md text-xs">
                                  {tour.activityType === 'running' ? '🏃' : '🚴'}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Card Content */}
                          <div className="p-4 flex-1 flex flex-col gap-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h3
                                  className="font-black text-sm text-slate-900 dark:text-white leading-snug truncate"
                                  title={tour.name}
                                >
                                  {tour.name}
                                </h3>
                                {tour.description ? (
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                                    {tour.description}
                                  </p>
                                ) : (
                                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                                    {tour.activityType === 'running' ? 'Geplante Lauftour' : 'Geplante Radtour'}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* 4 Key Komoot KPI Boxes */}
                            <div className="grid grid-cols-4 gap-1.5 text-center">
                              <div className="rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800 px-1.5 py-2">
                                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Distanz</div>
                                <div className="font-mono font-black text-xs text-slate-900 dark:text-white mt-0.5">
                                  {tour.distance.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km
                                </div>
                              </div>
                              <div className="rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100/70 dark:border-emerald-900/30 px-1.5 py-2">
                                <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                  Anstieg
                                </div>
                                <div className="font-mono font-black text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
                                  +{Math.round(tour.ascent)} m
                                </div>
                              </div>
                              <div className="rounded-xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100/70 dark:border-rose-900/30 px-1.5 py-2">
                                <div className="text-[9px] font-bold uppercase tracking-wider text-rose-500">Abstieg</div>
                                <div className="font-mono font-black text-xs text-rose-600 dark:text-rose-400 mt-0.5">
                                  -{Math.round(tour.descent)} m
                                </div>
                              </div>
                              <div className="rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/70 dark:border-indigo-900/30 px-1.5 py-2">
                                <div className="text-[9px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                                  Dauer (ca.)
                                </div>
                                <div className="font-mono font-black text-xs text-indigo-700 dark:text-indigo-300 mt-0.5">
                                  {formatDurationCompact(estSeconds)}
                                </div>
                              </div>
                            </div>

                            {/* Waytypes / Surface Bar */}
                            {surfaceTotal > 0 && tour.surfaceStats && tour.surfaceStats.length > 0 && (
                              <div className="space-y-1">
                                <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-800">
                                  {tour.surfaceStats.map((seg, i) => {
                                    const pct = (seg.distance / surfaceTotal) * 100;
                                    if (pct < 1) return null;
                                    return (
                                      <div
                                        key={`${seg.type}-${i}`}
                                        style={{
                                          width: `${pct}%`,
                                          backgroundColor: getSurfaceColorHex(seg.type)
                                        }}
                                        title={`${seg.type}: ${pct.toFixed(0)}%`}
                                      />
                                    );
                                  })}
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                                  <span className="truncate">
                                    {tour.surfaceStats
                                      .slice(0, 2)
                                      .map((s) => `${s.type} ${Math.round((s.distance / surfaceTotal) * 100)}%`)
                                      .join(' · ')}
                                  </span>
                                  {typeof tour.maxSlope === 'number' && tour.maxSlope > 0 && (
                                    <span className="font-mono font-semibold shrink-0 ml-2">
                                      max. {tour.maxSlope.toFixed(0)}%
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Group & Tags */}
                            {(tour.tourGroup || (tour.tags && tour.tags.length > 0)) && (
                              <div className="flex items-center gap-1 flex-wrap">
                                {tour.tourGroup && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/60 border border-teal-200/70 dark:border-teal-800/60 text-[10px] font-bold text-teal-700 dark:text-teal-300">
                                    <Folder className="w-2.5 h-2.5" />
                                    {tour.tourGroup}
                                  </span>
                                )}
                                {(tour.tags || []).slice(0, 4).map((tag) => (
                                  <span
                                    key={tag}
                                    className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-300"
                                  >
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Action Footer */}
                            <div className="pt-2 mt-auto border-t border-slate-100 dark:border-slate-800 flex flex-col gap-2">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleOpenSolo(tour)}
                                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
                                  title="Workspace ersetzen und diese Tour groß auf der Karte öffnen"
                                >
                                  {isBusy ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <ArrowRight className="w-3.5 h-3.5" />
                                  )}
                                  <span>Auf Karte öffnen</span>
                                </button>

                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleToggleWorkspaceMembership(tour)}
                                  className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer disabled:opacity-50 ${
                                    inWorkspace
                                      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800 hover:bg-rose-100'
                                      : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-indigo-50 hover:text-indigo-700'
                                  }`}
                                  title={
                                    inWorkspace
                                      ? 'Aus dem aktuellen Karten-Workspace entfernen'
                                      : 'Zusätzlich in den Karten-Workspace laden'
                                  }
                                >
                                  {inWorkspace ? 'Entfernen' : '+ Workspace'}
                                </button>
                              </div>

                              <div className="flex items-center justify-between text-[11px] text-slate-400">
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadTourGpx(tour)}
                                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-emerald-600 transition-colors cursor-pointer"
                                    title="Als GPX-Datei herunterladen"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                  {getKomootSourceMeta(tour) && (
                                    <button
                                      type="button"
                                      disabled={refreshingTourId === tour.id || refreshingGroupKey !== null}
                                      onClick={() => void handleRefreshSingleTour(tour)}
                                      className="inline-flex items-center gap-1 px-1.5 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 transition-colors cursor-pointer disabled:opacity-50 text-[10px] font-bold"
                                      title={`Komoot / URL-Quelle auf Updates prüfen (v${getKomootSourceMeta(tour)!.version})`}
                                    >
                                      <RefreshCw
                                        className={`w-3.5 h-3.5 ${refreshingTourId === tour.id ? 'animate-spin' : ''}`}
                                      />
                                      <span>Update</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEdit(tour)}
                                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer"
                                    title="Tour-Details bearbeiten"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {confirmDeleteId === tour.id ? (
                                  <div className="flex items-center gap-1 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-lg px-2 py-0.5">
                                    <span className="text-[10px] font-bold text-rose-700 dark:text-rose-300">Löschen?</span>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteTour(tour.id)}
                                      className="text-[10px] font-black text-rose-700 dark:text-rose-300 hover:underline cursor-pointer px-1"
                                    >
                                      Ja
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteId(null)}
                                      className="text-[10px] font-semibold text-slate-500 hover:underline cursor-pointer px-1"
                                    >
                                      Nein
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(tour.id)}
                                    className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                    title="Aus Geplanten Touren löschen"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                );

                const renderStagesTable = (sectionTours: PlannedTourMeta[]) => (
                  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-x-auto shadow-xs">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 text-[10px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400">
                          <th className="py-3 px-3 w-8">
                            <button
                              type="button"
                              onClick={handleSelectAllVisible}
                              className="cursor-pointer flex items-center justify-center"
                              title="Alle auswählen"
                            >
                              {allVisibleSelected ? (
                                <CheckSquare className="w-4 h-4 text-emerald-600" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                          </th>
                          <th className="py-3 px-3">Tour / Etappe</th>
                          <th className="py-3 px-3">Level</th>
                          <th className="py-3 px-3 text-right">Distanz</th>
                          <th className="py-3 px-3 text-right">Anstieg</th>
                          <th className="py-3 px-3 text-right">Abstieg</th>
                          <th className="py-3 px-3 text-right">Plan-Zeit</th>
                          <th className="py-3 px-3 text-right">Aktionen</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                        {sectionTours.map((tour) => {
                          const diff = computeTourDifficulty(tour);
                          const estSeconds = estimateTourDurationSeconds(tour, effectivePlanningSpeed);
                          const inWorkspace = workspaceTrackIdSet.has(tour.id);
                          const isSelected = selectedIds.has(tour.id);
                          const isBusy = loadingTrackId === tour.id;

                          return (
                            <tr
                              key={tour.id}
                              className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${
                                inWorkspace ? 'bg-indigo-50/40 dark:bg-indigo-950/20' : ''
                              }`}
                            >
                              <td className="py-2.5 px-3">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleSelectId(tour.id)}
                                  className="rounded accent-emerald-600 cursor-pointer"
                                />
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-2">
                                  <span>{tour.activityType === 'running' ? '🏃' : '🚴'}</span>
                                  <div>
                                    <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                                      <span>{tour.name}</span>
                                      {(() => {
                                        const kMeta = getKomootSourceMeta(tour);
                                        if (!kMeta) return null;
                                        return (
                                          <span
                                            className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60 text-[9px] font-mono font-extrabold tabular-nums"
                                            title={`Version v${kMeta.version} · Zuletzt geprüft: ${new Date(kMeta.lastCheckedAt).toLocaleString('de-DE')}`}
                                          >
                                            v{kMeta.version}
                                          </span>
                                        );
                                      })()}
                                      {tour.tourGroup && (
                                        <span className="px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 text-[9px] font-bold">
                                          {tour.tourGroup}
                                        </span>
                                      )}
                                      {inWorkspace && (
                                        <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-[9px] font-extrabold">
                                          Auf Karte
                                        </span>
                                      )}
                                    </div>
                                    {tour.description && (
                                      <div className="text-[11px] text-slate-400 line-clamp-1 max-w-md">
                                        {tour.description}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                    diff.level === 'leicht'
                                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                      : diff.level === 'mittel'
                                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                      : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                  }`}
                                >
                                  {diff.label}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold">
                                {tour.distance.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                +{Math.round(tour.ascent)} m
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-500">
                                -{Math.round(tour.descent)} m
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                                {formatDurationCompact(estSeconds)}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => handleOpenSolo(tour)}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] cursor-pointer disabled:opacity-50"
                                  >
                                    Öffnen
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => handleToggleWorkspaceMembership(tour)}
                                    className={`px-2 py-1 rounded-lg border font-semibold text-[11px] cursor-pointer ${
                                      inWorkspace
                                        ? 'border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400'
                                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                                    }`}
                                  >
                                    {inWorkspace ? 'Entfernen' : '+ Karte'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadTourGpx(tour)}
                                    className="p-1 text-slate-400 hover:text-emerald-600 cursor-pointer"
                                    title="GPX Export"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                  {getKomootSourceMeta(tour) && (
                                    <button
                                      type="button"
                                      disabled={refreshingTourId === tour.id || refreshingGroupKey !== null}
                                      onClick={() => void handleRefreshSingleTour(tour)}
                                      className="p-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded cursor-pointer disabled:opacity-50"
                                      title={`Komoot / URL-Quelle aktualisieren (v${getKomootSourceMeta(tour)!.version})`}
                                    >
                                      <RefreshCw
                                        className={`w-3.5 h-3.5 ${refreshingTourId === tour.id ? 'animate-spin' : ''}`}
                                      />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEdit(tour)}
                                    className="p-1 text-slate-400 hover:text-indigo-600 cursor-pointer"
                                    title="Bearbeiten"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      confirmDeleteId === tour.id
                                        ? handleDeleteTour(tour.id)
                                        : setConfirmDeleteId(tour.id)
                                    }
                                    className={`p-1 cursor-pointer ${
                                      confirmDeleteId === tour.id
                                        ? 'text-rose-600 font-black'
                                        : 'text-slate-400 hover:text-rose-600'
                                    }`}
                                    title={confirmDeleteId === tour.id ? 'Nochmal klicken zum Löschen' : 'Löschen'}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );

                return (
                  <section key={section.key} className="space-y-3">
                    {isGroupedMode && (
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={() => toggleGroupCollapsed(section.key)}
                            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                            aria-label={isCollapsed ? 'Gruppe aufklappen' : 'Gruppe einklappen'}
                          >
                            {isCollapsed ? (
                              <ChevronRight className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>

                          <Folder className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />

                          {isRenamingThis ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                void handleCommitRenameGroup(section.label);
                              }}
                              className="flex items-center gap-1.5"
                            >
                              <input
                                type="text"
                                value={renameGroupValue}
                                onChange={(e) => setRenameGroupValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    setRenamingGroupKey(null);
                                  }
                                }}
                                autoFocus
                                className="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-950 border border-emerald-500 text-xs font-bold text-slate-900 dark:text-white focus:outline-none"
                              />
                              <button
                                type="submit"
                                disabled={isRenamingGroup || !renameGroupValue.trim()}
                                className="p-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                                title="Gruppennamen speichern"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setRenamingGroupKey(null)}
                                className="p-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 cursor-pointer"
                                title="Abbrechen"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </form>
                          ) : (
                            <div className="flex items-center gap-1.5 min-w-0">
                              <button
                                type="button"
                                onClick={() => toggleGroupCollapsed(section.key)}
                                className="text-sm font-black text-slate-900 dark:text-white truncate cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400"
                              >
                                {section.label}
                              </button>
                              {section.editable && (
                                <button
                                  type="button"
                                  onClick={() => handleStartRenameGroup(section.key, section.label)}
                                  className="p-1 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                  title="Gruppennamen bearbeiten"
                                  aria-label="Gruppennamen bearbeiten"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-3 flex-wrap text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {section.tours.some((t) => Boolean(getKomootSourceMeta(t))) && (
                            <button
                              type="button"
                              disabled={refreshingGroupKey !== null}
                              onClick={() =>
                                void handleRefreshCollectionGroup(section.key, section.label, section.tours)
                              }
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200/80 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300 font-sans font-bold text-[11px] transition-colors cursor-pointer disabled:opacity-50"
                              title="Alle Komoot-/URL-Touren dieser Collection auf Updates prüfen und neue Versionen laden"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${refreshingGroupKey === section.key ? 'animate-spin' : ''}`}
                              />
                              <span>
                                {refreshingGroupKey === section.key && groupRefreshProgress
                                  ? `Aktualisiere (${groupRefreshProgress.done}/${groupRefreshProgress.total})...`
                                  : 'Collection aktualisieren'}
                              </span>
                            </button>
                          )}
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-bold text-slate-700 dark:text-slate-200">
                            {section.tours.length} {section.tours.length === 1 ? 'Tour' : 'Touren'}
                          </span>
                          <span>
                            {section.totalDist.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km
                          </span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                            +{Math.round(section.totalAscent).toLocaleString('de-DE')} hm
                          </span>
                        </div>
                      </div>
                    )}

                    {!isCollapsed &&
                      (viewMode === 'cards' ? renderCardsGrid(section.tours) : renderStagesTable(section.tours))}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Metadata Edit Modal */}
      {editingTour && (
        <div className="fixed inset-0 z-[1200] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-emerald-600" />
                Geplante Tour bearbeiten
              </h3>
              <button
                type="button"
                onClick={() => setEditingTour(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="p-5 space-y-3.5 text-xs">
              <label className="block space-y-1">
                <span className="font-bold text-slate-600 dark:text-slate-300">Tourname</span>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-semibold"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="font-bold text-slate-600 dark:text-slate-300">Sportart</span>
                  <select
                    value={editForm.activityType}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, activityType: e.target.value as 'cycling' | 'running' }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-semibold"
                  >
                    <option value="cycling">🚴 Radtour</option>
                    <option value="running">🏃 Lauftour</option>
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="font-bold text-slate-600 dark:text-slate-300">Geplantes Datum</span>
                  <input
                    type="date"
                    value={editForm.dateCreated}
                    onChange={(e) => setEditForm((f) => ({ ...f, dateCreated: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="font-bold text-slate-600 dark:text-slate-300">Gruppe (optional)</span>
                <input
                  type="text"
                  list="planned-tour-group-options"
                  value={editForm.tourGroup}
                  onChange={(e) => setEditForm((f) => ({ ...f, tourGroup: e.target.value }))}
                  placeholder="z.B. Alpentour 2026, Wochenendrunden..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                />
                <datalist id="planned-tour-group-options">
                  {collections.groups.map(([grp]) => (
                    <option key={grp} value={grp} />
                  ))}
                </datalist>
              </label>

              <label className="block space-y-1">
                <span className="font-bold text-slate-600 dark:text-slate-300">Tags / Kollektion (kommagetrennt)</span>
                <input
                  type="text"
                  value={editForm.tags}
                  onChange={(e) => setEditForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="z.B. Alpentour, Transalp, Sommer"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                />
              </label>

              <label className="block space-y-1">
                <span className="font-bold text-slate-600 dark:text-slate-300">Notizen / Beschreibung</span>
                <textarea
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Highlights, Verpflegungspunkte, Startzeit..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 resize-none"
                />
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingTour(null)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold cursor-pointer"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  {isSavingEdit ? 'Speichere...' : 'Änderungen speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <KomootCollectionImportModal
        collection={pendingKomootCollection}
        ftp={ftp}
        userWeight={userWeight}
        estimatedSpeed={effectivePlanningSpeed}
        existingWorkspaceTracks={workspaceTracks}
        defaultSaveAsPlanned={true}
        defaultOpenOnMap={true}
        onComplete={handleKomootCollectionComplete}
        onClose={() => setPendingKomootCollection(null)}
      />
    </div>
  );
};

export default PlannedToursView;
