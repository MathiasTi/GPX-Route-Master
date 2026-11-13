import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  X,
  SlidersHorizontal,
  MapPin,
  Trash2,
  Edit3,
  Check,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Upload,
  Database,
  Loader2,
  AlertTriangle,
  ArrowUpRight,
  CheckSquare,
  Square,
  MinusSquare,
  Calendar,
  Compass
} from 'lucide-react';
import { GPXTrack } from '../types';
import { getApiUrl, apiFetch } from '../utils/api';
import {
  hydrateGarminActivityPayload,
  hydrateLibraryTrackPayload
} from '../utils/activityHydration';

export type CatalogSource = 'library' | 'garmin';
export type CatalogActivityCategory = 'cycling' | 'running' | 'hiking' | 'other';
export type CatalogSortBy =
  | 'date-desc'
  | 'date-asc'
  | 'distance-desc'
  | 'ascent-desc'
  | 'duration-desc'
  | 'name-asc';

export interface CatalogActivityItem {
  key: string;
  source: CatalogSource;
  id: string;
  workspaceTrackId: string;
  name: string;
  rawType: string;
  activityCategory: CatalogActivityCategory;
  timestampIso: string;
  monthKey: string;
  distanceKm: number;
  ascentM: number;
  descentM: number;
  durationSec: number;
  avgHr: number | null;
  calories: number | null;
  location: string;
  description: string;
  tags: string[];
  originalFilename: string;
  color: string;
  hasGps: boolean;
}

interface CatalogMonthSummary {
  monthKey: string;
  count: number;
  totalDistanceKm: number;
  totalAscentM: number;
}

interface CatalogSummaryStats {
  totalDistanceKm: number;
  totalAscentM: number;
  totalDurationSec: number;
  garminCount: number;
  libraryCount: number;
}

type VirtualRow =
  | {
      kind: 'month';
      key: string;
      monthKey: string;
      label: string;
      count: number;
      totalDistanceKm: number;
      totalAscentM: number;
      collapsed: boolean;
      loadedKeysInMonth: string[];
    }
  | {
      kind: 'item';
      key: string;
      item: CatalogActivityItem;
    };

export interface ActivitiesManagerViewProps {
  workspaceTracks: GPXTrack[];
  ftp: number;
  userWeight: number;
  estimatedSpeed: number;
  onLoadTracksToMap: (tracks: GPXTrack[], options?: { jumpToMap?: boolean; fitToTracks?: boolean }) => void;
  onActivityMetadataUpdated?: (workspaceTrackId: string, updates: { name: string; activityType: 'cycling' | 'running'; description?: string; tags?: string[] }) => void;
  onDatabaseCountChange?: (totalCount: number) => void;
  onOpenUploadPicker?: () => void;
  onOpenGarminSync?: () => void;
  onBackToMap: () => void;
}

const PAGE_SIZE = 150;
const MONTH_ROW_HEIGHT = 38;
const ITEM_ROW_HEIGHT = 46;
const OVERSCAN_ROWS = 14;

const GERMAN_MONTHS = [
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

function formatMonthLabel(monthKey: string): string {
  if (!monthKey || monthKey === 'unknown' || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return 'Ohne Datum';
  }
  const [yearStr, monthStr] = monthKey.split('-');
  const monthIdx = parseInt(monthStr, 10) - 1;
  const monthName = GERMAN_MONTHS[monthIdx] || monthStr;
  return `${monthName} ${yearStr}`;
}

function formatDateTimeCompact(iso?: string): { date: string; time: string } {
  if (!iso) return { date: '—', time: '' };
  const normalized = iso.trim().replace('T', ' ');
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}:\d{2}))?/);
  if (match) {
    return {
      date: `${match[3]}.${match[2]}.${match[1]}`,
      time: match[4] || ''
    };
  }
  const dt = new Date(iso);
  if (!isNaN(dt.getTime())) {
    return {
      date: dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      time: dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    };
  }
  return { date: iso.slice(0, 10), time: '' };
}

function formatDurationCompact(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')} h`;
  }
  return `${m}:${String(s).padStart(2, '0')} min`;
}

function formatTempoMetric(item: CatalogActivityItem): string {
  if (!item.durationSec || item.durationSec <= 0 || !item.distanceKm || item.distanceKm <= 0) {
    return item.avgHr ? `${item.avgHr} bpm` : '—';
  }
  const speedKmh = item.distanceKm / (item.durationSec / 3600);
  if (item.activityCategory === 'running' || item.activityCategory === 'hiking') {
    const paceMinPerKm = 60 / Math.max(0.5, speedKmh);
    let mins = Math.floor(paceMinPerKm);
    let secs = Math.round((paceMinPerKm - mins) * 60);
    if (secs === 60) {
      mins += 1;
      secs = 0;
    }
    return `${mins}:${String(secs).padStart(2, '0')} /km`;
  }
  return `${speedKmh.toFixed(1)} km/h`;
}

function formatSportLabel(category: CatalogActivityCategory, rawType?: string): string {
  switch (category) {
    case 'cycling':
      return 'Radsport';
    case 'running':
      return 'Laufen';
    case 'hiking':
      return 'Wandern';
    default:
      return rawType && rawType.trim().length > 0 ? rawType : 'Aktivität';
  }
}

export const ActivitiesManagerView: React.FC<ActivitiesManagerViewProps> = ({
  workspaceTracks,
  ftp,
  userWeight,
  estimatedSpeed,
  onLoadTracksToMap,
  onActivityMetadataUpdated,
  onDatabaseCountChange,
  onOpenUploadPicker,
  onOpenGarminSync,
  onBackToMap
}) => {
  // Search & filters
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | CatalogSource>('all');
  const [activityFilter, setActivityFilter] = useState<'all' | CatalogActivityCategory>('all');
  const [sortBy, setSortBy] = useState<CatalogSortBy>('date-desc');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minDistance, setMinDistance] = useState('');
  const [maxDistance, setMaxDistance] = useState('');
  const [minAscent, setMinAscent] = useState('');
  const [hasGpsOnly, setHasGpsOnly] = useState(false);

  // Data state
  const [items, setItems] = useState<CatalogActivityItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [databaseTotalCount, setDatabaseTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [summaryStats, setSummaryStats] = useState<CatalogSummaryStats>({
    totalDistanceKm: 0,
    totalAscentM: 0,
    totalDurationSec: 0,
    garminCount: 0,
    libraryCount: 0
  });
  const [monthSummaries, setMonthSummaries] = useState<CatalogMonthSummary[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{ text: string; type: 'info' | 'error' } | null>(null);

  // Grouping & selection state
  const [collapsedMonths, setCollapsedMonths] = useState<Record<string, boolean>>({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectAllFiltered, setSelectAllFiltered] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [isBulkExecuting, setIsBulkExecuting] = useState(false);
  const [loadingRowKey, setLoadingRowKey] = useState<string | null>(null);
  const [confirmRowDeleteKey, setConfirmRowDeleteKey] = useState<string | null>(null);

  // Inline Edit Drawer / Modal
  const [editingItem, setEditingItem] = useState<CatalogActivityItem | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    activityType: 'cycling',
    date: '',
    location: '',
    tags: '',
    description: ''
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Virtualization refs & viewport metrics
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);

  // Track active workspace IDs for quick "Auf Karte" recognition
  const activeWorkspaceIds = useMemo(() => {
    return new Set(workspaceTracks.map((t) => t.id));
  }, [workspaceTracks]);

  // Debounce text search (150ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, 150);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Auto-hide status banner
  useEffect(() => {
    if (!statusBanner) return;
    const t = setTimeout(() => setStatusBanner(null), 4500);
    return () => clearTimeout(t);
  }, [statusBanner]);

  // Keyboard "/" shortcut to jump to search input
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Measure virtual scroll container height
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const updateSize = () => {
      setViewportHeight(el.clientHeight || 640);
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const currentFilterParams = useMemo(() => {
    return {
      q: debouncedQuery,
      source: sourceFilter,
      activityType: activityFilter,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      minDistance: minDistance !== '' ? Number(minDistance) : undefined,
      maxDistance: maxDistance !== '' ? Number(maxDistance) : undefined,
      minAscent: minAscent !== '' ? Number(minAscent) : undefined,
      hasGpsOnly,
      sortBy
    };
  }, [
    debouncedQuery,
    sourceFilter,
    activityFilter,
    startDate,
    endDate,
    minDistance,
    maxDistance,
    minAscent,
    hasGpsOnly,
    sortBy
  ]);

  const activeExtendedFilterCount = useMemo(() => {
    let count = 0;
    if (startDate) count++;
    if (endDate) count++;
    if (minDistance !== '') count++;
    if (maxDistance !== '') count++;
    if (minAscent !== '') count++;
    if (hasGpsOnly) count++;
    return count;
  }, [startDate, endDate, minDistance, maxDistance, minAscent, hasGpsOnly]);

  const hasAnyFilter =
    debouncedQuery.length > 0 ||
    sourceFilter !== 'all' ||
    activityFilter !== 'all' ||
    activeExtendedFilterCount > 0;

  const fetchCatalogPage = useCallback(
    async (offset: number, append: boolean) => {
      if (!append) {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();
      }
      const signal = abortControllerRef.current?.signal;

      if (append) {
        setIsLoadingMore(true);
      } else if (items.length === 0) {
        setIsInitialLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setErrorMsg(null);

      try {
        const qs = new URLSearchParams();
        if (currentFilterParams.q) qs.set('q', currentFilterParams.q);
        if (currentFilterParams.source !== 'all') qs.set('source', currentFilterParams.source);
        if (currentFilterParams.activityType !== 'all') qs.set('activityType', currentFilterParams.activityType);
        if (currentFilterParams.startDate) qs.set('startDate', currentFilterParams.startDate);
        if (currentFilterParams.endDate) qs.set('endDate', currentFilterParams.endDate);
        if (currentFilterParams.minDistance !== undefined && !isNaN(currentFilterParams.minDistance)) {
          qs.set('minDistance', String(currentFilterParams.minDistance));
        }
        if (currentFilterParams.maxDistance !== undefined && !isNaN(currentFilterParams.maxDistance)) {
          qs.set('maxDistance', String(currentFilterParams.maxDistance));
        }
        if (currentFilterParams.minAscent !== undefined && !isNaN(currentFilterParams.minAscent)) {
          qs.set('minAscent', String(currentFilterParams.minAscent));
        }
        if (currentFilterParams.hasGpsOnly) qs.set('hasGpsOnly', 'true');
        qs.set('sortBy', currentFilterParams.sortBy);
        qs.set('limit', String(PAGE_SIZE));
        qs.set('offset', String(offset));

        const res = await apiFetch(getApiUrl(`/api/activities/catalog?${qs.toString()}`), {
          signal: append ? undefined : signal
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Katalog konnte nicht geladen werden.');
        }

        const fetchedItems: CatalogActivityItem[] = Array.isArray(data.items) ? data.items : [];
        if (append) {
          setItems((prev) => {
            const seen = new Set(prev.map((i) => i.key));
            const merged = [...prev];
            for (const item of fetchedItems) {
              if (!seen.has(item.key)) merged.push(item);
            }
            return merged;
          });
        } else {
          setItems(fetchedItems);
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
            setScrollTop(0);
          }
        }

        setTotalCount(Number(data.totalCount || 0));
        const dbTotal = Number(data.databaseTotalCount || 0);
        setDatabaseTotalCount(dbTotal);
        onDatabaseCountChange?.(dbTotal);
        setHasMore(Boolean(data.hasMore));
        if (data.summaryStats) setSummaryStats(data.summaryStats);
        if (Array.isArray(data.monthSummaries)) setMonthSummaries(data.monthSummaries);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('Catalog load error:', err);
        setErrorMsg(err?.message || 'Verbindung zur Datenbank fehlgeschlagen.');
      } finally {
        setIsInitialLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
      }
    },
    [currentFilterParams, onDatabaseCountChange] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Trigger fresh load on filter/sort changes
  useEffect(() => {
    setSelectedKeys(new Set());
    setSelectAllFiltered(false);
    setConfirmBulkDelete(false);
    setConfirmRowDeleteKey(null);
    fetchCatalogPage(0, false);
  }, [fetchCatalogPage]);

  // Build month summary lookup
  const monthSummaryMap = useMemo(() => {
    const map = new Map<string, CatalogMonthSummary>();
    for (const m of monthSummaries) {
      map.set(m.monthKey, m);
    }
    return map;
  }, [monthSummaries]);

  // Build flat virtualized list (with sticky-style month headers when sorted chronologically)
  const isChronologicalSort = sortBy === 'date-desc' || sortBy === 'date-asc';

  const virtualRows = useMemo<VirtualRow[]>(() => {
    if (items.length === 0) return [];
    if (!isChronologicalSort) {
      return items.map((item) => ({
        kind: 'item',
        key: item.key,
        item
      }));
    }

    const rows: VirtualRow[] = [];
    const itemsByMonth = new Map<string, CatalogActivityItem[]>();
    const monthOrder: string[] = [];

    for (const item of items) {
      const mKey = item.monthKey || 'unknown';
      if (!itemsByMonth.has(mKey)) {
        itemsByMonth.set(mKey, []);
        monthOrder.push(mKey);
      }
      itemsByMonth.get(mKey)!.push(item);
    }

    for (const mKey of monthOrder) {
      const monthItems = itemsByMonth.get(mKey)!;
      const summary = monthSummaryMap.get(mKey);
      const isCollapsed = !!collapsedMonths[mKey];

      rows.push({
        kind: 'month',
        key: `month:${mKey}`,
        monthKey: mKey,
        label: formatMonthLabel(mKey),
        count: summary ? summary.count : monthItems.length,
        totalDistanceKm: summary
          ? summary.totalDistanceKm
          : monthItems.reduce((acc, i) => acc + i.distanceKm, 0),
        totalAscentM: summary
          ? summary.totalAscentM
          : monthItems.reduce((acc, i) => acc + i.ascentM, 0),
        collapsed: isCollapsed,
        loadedKeysInMonth: monthItems.map((i) => i.key)
      });

      if (!isCollapsed) {
        for (const item of monthItems) {
          rows.push({
            kind: 'item',
            key: item.key,
            item
          });
        }
      }
    }

    return rows;
  }, [items, isChronologicalSort, monthSummaryMap, collapsedMonths]);

  // Precompute prefix offsets for variable row height (month headers vs activity rows)
  const rowLayout = useMemo(() => {
    const offsets: number[] = new Array(virtualRows.length);
    let y = 0;
    for (let i = 0; i < virtualRows.length; i++) {
      offsets[i] = y;
      y += virtualRows[i].kind === 'month' ? MONTH_ROW_HEIGHT : ITEM_ROW_HEIGHT;
    }
    return { offsets, totalHeight: y };
  }, [virtualRows]);

  // Binary search visible window
  const visibleSlice = useMemo(() => {
    const count = virtualRows.length;
    if (count === 0) return { startIdx: 0, endIdx: 0 };

    const { offsets } = rowLayout;
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] + ITEM_ROW_HEIGHT < scrollTop) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const startIdx = Math.max(0, lo - OVERSCAN_ROWS);

    const maxBottom = scrollTop + viewportHeight;
    let end = lo;
    while (end < count && offsets[end] < maxBottom) {
      end++;
    }
    const endIdx = Math.min(count, end + OVERSCAN_ROWS);

    return { startIdx, endIdx };
  }, [virtualRows.length, rowLayout, scrollTop, viewportHeight]);

  // Scroll listener + automatic infinite fetch near bottom
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      setScrollTop(target.scrollTop);

      if (
        hasMore &&
        !isLoadingMore &&
        !isInitialLoading &&
        target.scrollHeight - target.scrollTop - target.clientHeight < 650
      ) {
        fetchCatalogPage(items.length, true);
      }
    },
    [hasMore, isLoadingMore, isInitialLoading, fetchCatalogPage, items.length]
  );

  // Selection helpers
  const toggleRowSelection = useCallback((key: string) => {
    setSelectAllFiltered(false);
    setConfirmBulkDelete(false);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSelectAllLoaded = useCallback(() => {
    setConfirmBulkDelete(false);
    if (items.length === 0) return;
    if (selectedKeys.size === items.length) {
      setSelectedKeys(new Set());
      setSelectAllFiltered(false);
    } else {
      setSelectedKeys(new Set(items.map((i) => i.key)));
    }
  }, [items, selectedKeys.size]);

  const toggleMonthSelection = useCallback((loadedKeysInMonth: string[]) => {
    setSelectAllFiltered(false);
    setConfirmBulkDelete(false);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const allSelected =
        loadedKeysInMonth.length > 0 && loadedKeysInMonth.every((k) => next.has(k));
      if (allSelected) {
        loadedKeysInMonth.forEach((k) => next.delete(k));
      } else {
        loadedKeysInMonth.forEach((k) => next.add(k));
      }
      return next;
    });
  }, []);

  const selectedCount = selectAllFiltered ? totalCount : selectedKeys.size;

  const resolveSelectedRefs = useCallback(() => {
    return Array.from(selectedKeys).map((k) => {
      const sepIdx = k.indexOf(':');
      return {
        source: k.slice(0, sepIdx) as CatalogSource,
        id: k.slice(sepIdx + 1)
      };
    });
  }, [selectedKeys]);

  // Quick-load single or selected tracks and jump to Map
  const executeBulkLoadToMap = useCallback(
    async (opts: { items?: Array<{ source: CatalogSource; id: string }>; selectAll?: boolean; rowKey?: string }) => {
      if (opts.rowKey) setLoadingRowKey(opts.rowKey);
      else setIsBulkExecuting(true);

      try {
        const res = await apiFetch(getApiUrl('/api/activities/bulk-load'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            opts.selectAll
              ? { selectAllFiltered: true, filters: currentFilterParams }
              : { items: opts.items || [] }
          )
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Aktivitäten konnten nicht geladen werden.');
        }

        const hydratedTracks: GPXTrack[] = [];
        if (Array.isArray(data.libraryTracks)) {
          for (const rawLib of data.libraryTracks) {
            hydratedTracks.push(hydrateLibraryTrackPayload(rawLib));
          }
        }
        if (Array.isArray(data.garminActivities)) {
          for (const rawGarmin of data.garminActivities) {
            hydratedTracks.push(
              hydrateGarminActivityPayload(rawGarmin, {
                ftp,
                userWeight,
                estimatedSpeed
              })
            );
          }
        }

        if (hydratedTracks.length === 0) {
          setStatusBanner({ text: 'Keine ladbaren Streckendaten gefunden.', type: 'error' });
          return;
        }

        onLoadTracksToMap(hydratedTracks, { jumpToMap: true, fitToTracks: true });
        if (data.truncatedCount && data.truncatedCount > 0) {
          setStatusBanner({
            text: `Maximal 50 Aktivitäten gleichzeitig auf der Karte geladen (${data.truncatedCount} übersprungen).`,
            type: 'info'
          });
        }
      } catch (err: any) {
        console.error('Error loading activities onto map:', err);
        setStatusBanner({
          text: err?.message || 'Fehler beim Laden in die Karte.',
          type: 'error'
        });
      } finally {
        setLoadingRowKey(null);
        setIsBulkExecuting(false);
      }
    },
    [currentFilterParams, ftp, userWeight, estimatedSpeed, onLoadTracksToMap]
  );

  // Single or bulk delete with inline confirmation
  const executeDelete = useCallback(
    async (opts: { items?: Array<{ source: CatalogSource; id: string }>; selectAll?: boolean }) => {
      setIsBulkExecuting(true);
      try {
        const res = await apiFetch(getApiUrl('/api/activities/bulk-delete'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            opts.selectAll
              ? { selectAllFiltered: true, filters: currentFilterParams }
              : { items: opts.items || [] }
          )
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Löschvorgang fehlgeschlagen.');
        }

        setSelectedKeys(new Set());
        setSelectAllFiltered(false);
        setConfirmBulkDelete(false);
        setConfirmRowDeleteKey(null);
        setStatusBanner({
          text: `${data.deletedCount || 1} Aktivität(en) aus der Datenbank gelöscht.`,
          type: 'info'
        });
        await fetchCatalogPage(0, false);
      } catch (err: any) {
        console.error('Bulk delete failed:', err);
        setStatusBanner({
          text: err?.message || 'Löschen fehlgeschlagen.',
          type: 'error'
        });
      } finally {
        setIsBulkExecuting(false);
      }
    },
    [currentFilterParams, fetchCatalogPage]
  );

  // Inline Metadata Edit Save
  const openEditDrawer = useCallback((item: CatalogActivityItem) => {
    setEditingItem(item);
    setEditForm({
      name: item.name,
      activityType:
        item.activityCategory === 'running' || item.activityCategory === 'hiking'
          ? 'running'
          : 'cycling',
      date: item.timestampIso ? item.timestampIso.slice(0, 19).replace('T', ' ') : '',
      location: item.location || '',
      tags: item.tags.join(', '),
      description: item.description || ''
    });
  }, []);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editForm.name.trim()) return;
    setIsSavingEdit(true);

    try {
      const splitTags = editForm.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await apiFetch(
        getApiUrl(`/api/activities/${editingItem.source}/${encodeURIComponent(editingItem.id)}`),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editForm.name.trim(),
            activityType: editForm.activityType,
            date: editForm.date.trim() || undefined,
            location: editForm.location.trim(),
            tags: splitTags,
            description: editForm.description.trim()
          })
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Änderungen konnten nicht gespeichert werden.');
      }

      onActivityMetadataUpdated?.(editingItem.workspaceTrackId, {
        name: editForm.name.trim(),
        activityType: editForm.activityType === 'running' ? 'running' : 'cycling',
        description: editForm.description.trim(),
        tags: splitTags
      });

      setEditingItem(null);
      setStatusBanner({ text: 'Metadaten aktualisiert.', type: 'info' });
      await fetchCatalogPage(0, false);
    } catch (err: any) {
      setStatusBanner({
        text: err?.message || 'Speichern fehlgeschlagen.',
        type: 'error'
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const applyDatePreset = (preset: '30d' | 'thisYear' | 'lastYear' | 'clear') => {
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    if (preset === '30d') {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      setStartDate(fmt(start));
      setEndDate(fmt(now));
    } else if (preset === 'thisYear') {
      setStartDate(`${now.getFullYear()}-01-01`);
      setEndDate(`${now.getFullYear()}-12-31`);
    } else if (preset === 'lastYear') {
      const y = now.getFullYear() - 1;
      setStartDate(`${y}-01-01`);
      setEndDate(`${y}-12-31`);
    } else {
      setStartDate('');
      setEndDate('');
    }
  };

  const resetAllFilters = () => {
    setSearchInput('');
    setDebouncedQuery('');
    setSourceFilter('all');
    setActivityFilter('all');
    setStartDate('');
    setEndDate('');
    setMinDistance('');
    setMaxDistance('');
    setMinAscent('');
    setHasGpsOnly(false);
    setSortBy('date-desc');
  };

  return (
    <div
      className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 select-none sm:select-auto"
      id="activities-manager-view"
    >
      {/* Top Sticky Search & Filter Command Bar */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3 space-y-2.5 shrink-0">
        <div className="flex flex-col lg:flex-row lg:items-center gap-2.5 justify-between">
          {/* Left: Instant Full-Text Search */}
          <div className="relative flex-1 max-w-2xl">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Blitzsuche über Name, Ort, Notizen, Tags oder Dateiname... (Taste /)"
              aria-label="Aktivitäten durchsuchen"
              className="w-full pl-9 pr-9 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 transition-colors"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Suche leeren"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Right: Source, Sport, Sort & Extended Filters Toggle */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Source Filter */}
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-0.5">
              {(
                [
                  { id: 'all', label: 'Alle' },
                  { id: 'garmin', label: 'Garmin' },
                  { id: 'library', label: 'Bibliothek' }
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSourceFilter(opt.id)}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    sourceFilter === opt.id
                      ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-2xs border border-slate-200/80 dark:border-slate-700'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Sport Category Filter */}
            <select
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value as 'all' | CatalogActivityCategory)}
              aria-label="Sportart filtern"
              className="px-2.5 py-1.5 text-xs font-semibold bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="all">Alle Sportarten</option>
              <option value="cycling">Radsport</option>
              <option value="running">Laufen</option>
              <option value="hiking">Wandern</option>
              <option value="other">Sonstige</option>
            </select>

            {/* Sort Order */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as CatalogSortBy)}
              aria-label="Sortierung"
              className="px-2.5 py-1.5 text-xs font-semibold bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="date-desc">Neueste zuerst</option>
              <option value="date-asc">Älteste zuerst</option>
              <option value="distance-desc">Größte Distanz</option>
              <option value="ascent-desc">Meiste Höhenmeter</option>
              <option value="duration-desc">Längste Dauer</option>
              <option value="name-asc">Name (A–Z)</option>
            </select>

            {/* Extended Filter Toggle */}
            <button
              type="button"
              onClick={() => setShowAdvancedFilters((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showAdvancedFilters || activeExtendedFilterCount > 0
                  ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300'
                  : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900'
              }`}
            >
              <SlidersHorizontal size={13} />
              <span>Filter</span>
              {activeExtendedFilterCount > 0 && (
                <span className="font-mono text-[11px] font-bold">({activeExtendedFilterCount})</span>
              )}
            </button>
          </div>
        </div>

        {/* Collapsible Extended Filter Row */}
        {showAdvancedFilters && (
          <div className="pt-2.5 border-t border-slate-200/80 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Zeitraum von
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Zeitraum bis
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Min. km
                </label>
                <input
                  type="number"
                  min={0}
                  step="1"
                  placeholder="0"
                  value={minDistance}
                  onChange={(e) => setMinDistance(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Max. km
                </label>
                <input
                  type="number"
                  min={0}
                  step="1"
                  placeholder="∞"
                  value={maxDistance}
                  onChange={(e) => setMaxDistance(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Min. Anstieg (hm)
              </label>
              <input
                type="number"
                min={0}
                step="50"
                placeholder="0"
                value={minAscent}
                onChange={(e) => setMinAscent(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => applyDatePreset('30d')}
                className="px-2 py-1.5 text-[11px] font-semibold border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer whitespace-nowrap"
              >
                30 Tage
              </button>
              <button
                type="button"
                onClick={() => applyDatePreset('thisYear')}
                className="px-2 py-1.5 text-[11px] font-semibold border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer whitespace-nowrap"
              >
                Dieses Jahr
              </button>
              <button
                type="button"
                onClick={() => applyDatePreset('lastYear')}
                className="px-2 py-1.5 text-[11px] font-semibold border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer whitespace-nowrap"
              >
                Vorjahr
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasGpsOnly}
                  onChange={(e) => setHasGpsOnly(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Nur GPS-Spuren</span>
              </label>
              {hasAnyFilter && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer whitespace-nowrap"
                >
                  <RotateCcw size={12} />
                  <span>Zurücksetzen</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Metadata Summary Strip + Quick Action Links */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
            <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
              {totalCount.toLocaleString('de-DE')} von {databaseTotalCount.toLocaleString('de-DE')} Aktivitäten
            </span>
            <span>·</span>
            <span className="font-mono tabular-nums">
              {summaryStats.totalDistanceKm.toLocaleString('de-DE', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1
              })}{' '}
              km gesamt
            </span>
            <span>·</span>
            <span className="font-mono tabular-nums">
              +{summaryStats.totalAscentM.toLocaleString('de-DE')} hm
            </span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline font-mono tabular-nums">
              {summaryStats.garminCount.toLocaleString('de-DE')} Garmin ·{' '}
              {summaryStats.libraryCount.toLocaleString('de-DE')} Bibliothek
            </span>
            {isRefreshing && (
              <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 ml-1">
                <Loader2 size={12} className="animate-spin" />
                Aktualisiere...
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {hasAnyFilter && !showAdvancedFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer whitespace-nowrap"
              >
                <RotateCcw size={12} />
                <span>Filter zurücksetzen</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Inline Status / Error Banner */}
      {statusBanner && (
        <div
          className={`px-4 sm:px-6 py-2 text-xs font-semibold border-b flex items-center justify-between ${
            statusBanner.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-900'
              : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200 border-indigo-200 dark:border-indigo-900'
          }`}
        >
          <span>{statusBanner.text}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="p-1 hover:opacity-75 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Contextual Multi-Select Bulk Action Bar */}
      {selectedCount > 0 && (
        <div className="bg-indigo-50 dark:bg-indigo-950/50 border-b border-indigo-200 dark:border-indigo-900 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-bold text-indigo-950 dark:text-indigo-100 font-mono tabular-nums">
              {selectedCount.toLocaleString('de-DE')} ausgewählt
            </span>
            {!selectAllFiltered && totalCount > items.length && selectedKeys.size === items.length && (
              <button
                type="button"
                onClick={() => setSelectAllFiltered(true)}
                className="font-semibold text-indigo-700 dark:text-indigo-300 underline hover:no-underline cursor-pointer"
              >
                Alle {totalCount.toLocaleString('de-DE')} gefilterten auswählen
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSelectedKeys(new Set());
                setSelectAllFiltered(false);
                setConfirmBulkDelete(false);
              }}
              className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 font-medium cursor-pointer"
            >
              Auswahl aufheben
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!confirmBulkDelete ? (
              <>
                <button
                  type="button"
                  disabled={isBulkExecuting}
                  onClick={() =>
                    executeBulkLoadToMap(
                      selectAllFiltered ? { selectAll: true } : { items: resolveSelectedRefs() }
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isBulkExecuting ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <MapPin size={13} />
                  )}
                  <span>Auf Karte laden ({Math.min(50, selectedCount)})</span>
                </button>
                <button
                  type="button"
                  disabled={isBulkExecuting}
                  onClick={() => setConfirmBulkDelete(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/60 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Trash2 size={13} />
                  <span>Auswahl löschen</span>
                </button>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2 bg-rose-100/90 dark:bg-rose-950/90 border border-rose-300 dark:border-rose-800 px-3 py-1 rounded-lg">
                <span className="text-xs font-bold text-rose-900 dark:text-rose-200">
                  Wirklich {selectedCount.toLocaleString('de-DE')} Aktivitäten dauerhaft löschen?
                </span>
                <button
                  type="button"
                  disabled={isBulkExecuting}
                  onClick={() =>
                    executeDelete(
                      selectAllFiltered ? { selectAll: true } : { items: resolveSelectedRefs() }
                    )
                  }
                  className="px-2.5 py-1 text-xs font-bold rounded bg-rose-600 hover:bg-rose-700 text-white cursor-pointer whitespace-nowrap"
                >
                  {isBulkExecuting ? 'Lösche...' : 'Endgültig löschen'}
                </button>
                <button
                  type="button"
                  disabled={isBulkExecuting}
                  onClick={() => setConfirmBulkDelete(false)}
                  className="px-2.5 py-1 text-xs font-semibold rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 cursor-pointer whitespace-nowrap"
                >
                  Abbrechen
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table Column Headers (Desktop md+) */}
      <div className="hidden md:grid grid-cols-[36px_138px_minmax(220px,2.2fr)_140px_92px_86px_92px_96px_150px] items-center gap-2 px-4 sm:px-6 h-9 bg-slate-100/80 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 shrink-0">
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={toggleSelectAllLoaded}
            aria-label="Alle geladenen Zeilen auswählen"
            className="p-1 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
          >
            {items.length > 0 && selectedKeys.size === items.length ? (
              <CheckSquare size={15} className="text-indigo-600 dark:text-indigo-400" />
            ) : selectedKeys.size > 0 ? (
              <MinusSquare size={15} className="text-indigo-600 dark:text-indigo-400" />
            ) : (
              <Square size={15} />
            )}
          </button>
        </div>
        <div>Datum & Zeit</div>
        <div>Aktivität & Details</div>
        <div>Quelle · Sport</div>
        <div className="text-right">Distanz</div>
        <div className="text-right">Anstieg</div>
        <div className="text-right">Dauer</div>
        <div className="text-right">Tempo / HF</div>
        <div className="text-right pr-1">Aktionen</div>
      </div>

      {/* Main Scrollable Virtualized Body */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto relative"
      >
        {errorMsg ? (
          <div className="max-w-lg mx-auto my-12 p-6 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 rounded-xl text-center space-y-3">
            <AlertTriangle size={28} className="mx-auto text-rose-500" />
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Aktivitäten konnten nicht geladen werden
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{errorMsg}</p>
            <button
              type="button"
              onClick={() => fetchCatalogPage(0, false)}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
            >
              Erneut versuchen
            </button>
          </div>
        ) : isInitialLoading ? (
          <div className="divide-y divide-slate-200/70 dark:divide-slate-800/80">
            {Array.from({ length: 12 }).map((_, idx) => (
              <div
                key={idx}
                className="px-4 sm:px-6 h-[46px] flex items-center gap-4 bg-white dark:bg-slate-900 animate-pulse"
              >
                <div className="w-4 h-4 rounded bg-slate-200 dark:bg-slate-800" />
                <div className="w-28 h-3.5 rounded bg-slate-200 dark:bg-slate-800" />
                <div className="flex-1 h-3.5 rounded bg-slate-200 dark:bg-slate-800 max-w-md" />
                <div className="w-20 h-3.5 rounded bg-slate-200 dark:bg-slate-800 hidden sm:block" />
                <div className="w-16 h-3.5 rounded bg-slate-200 dark:bg-slate-800" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="max-w-lg mx-auto my-14 p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center space-y-4">
            <div className="w-11 h-11 mx-auto rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400">
              {hasAnyFilter ? <Search size={20} /> : <Compass size={20} />}
            </div>
            {hasAnyFilter ? (
              <>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Keine passenden Aktivitäten gefunden
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Passe Suchbegriff, Zeitraum oder Metrik-Filter an, um weitere Einträge aus der Datenbank anzuzeigen.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                >
                  <RotateCcw size={13} />
                  <span>Alle Filter zurücksetzen</span>
                </button>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Noch keine Aktivitäten in der Datenbank
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Importiere GPX/FIT-Dateien oder synchronisiere deine Garmin-Aktivitäten, um hier tausende Touren blitzschnell zu verwalten.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                  {onOpenUploadPicker && (
                    <button
                      type="button"
                      onClick={onOpenUploadPicker}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                    >
                      <Upload size={14} />
                      <span>GPX / FIT importieren</span>
                    </button>
                  )}
                  {onOpenGarminSync && (
                    <button
                      type="button"
                      onClick={onOpenGarminSync}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                    >
                      <Database size={14} />
                      <span>Garmin Daten verwalten</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div
            style={{ height: `${rowLayout.totalHeight}px` }}
            className="relative w-full"
          >
            {virtualRows.slice(visibleSlice.startIdx, visibleSlice.endIdx).map((row, localIdx) => {
              const absIdx = visibleSlice.startIdx + localIdx;
              const top = rowLayout.offsets[absIdx];

              if (row.kind === 'month') {
                const allMonthSelected =
                  row.loadedKeysInMonth.length > 0 &&
                  row.loadedKeysInMonth.every((k) => selectedKeys.has(k));

                return (
                  <div
                    key={row.key}
                    style={{ top: `${top}px`, height: `${MONTH_ROW_HEIGHT}px` }}
                    className="absolute inset-x-0 px-4 sm:px-6 flex items-center justify-between bg-slate-100/95 dark:bg-slate-900/95 border-y border-slate-200/80 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => toggleMonthSelection(row.loadedKeysInMonth)}
                        aria-label={`Monat ${row.label} auswählen`}
                        className="p-0.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer shrink-0"
                      >
                        {allMonthSelected ? (
                          <CheckSquare size={14} className="text-indigo-600 dark:text-indigo-400" />
                        ) : (
                          <Square size={14} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedMonths((prev) => ({
                            ...prev,
                            [row.monthKey]: !prev[row.monthKey]
                          }))
                        }
                        className="flex items-center gap-1.5 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer truncate"
                      >
                        {row.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        <Calendar size={13} className="text-slate-400 shrink-0" />
                        <span>{row.label}</span>
                      </button>
                    </div>

                    <div className="font-mono tabular-nums text-[11px] font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                      {row.count.toLocaleString('de-DE')} Touren ·{' '}
                      {row.totalDistanceKm.toLocaleString('de-DE', {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1
                      })}{' '}
                      km · +{row.totalAscentM.toLocaleString('de-DE')} hm
                    </div>
                  </div>
                );
              }

              const { item } = row;
              const isSelected = selectedKeys.has(item.key);
              const isOnMap = activeWorkspaceIds.has(item.workspaceTrackId);
              const dt = formatDateTimeCompact(item.timestampIso);
              const subDetails = [
                item.location,
                item.tags.slice(0, 2).join(', '),
                item.originalFilename
              ]
                .filter(Boolean)
                .join(' · ');
              const isConfirmingRowDelete = confirmRowDeleteKey === item.key;

              return (
                <div
                  key={row.key}
                  style={{ top: `${top}px`, height: `${ITEM_ROW_HEIGHT}px` }}
                  onDoubleClick={() =>
                    executeBulkLoadToMap({
                      items: [{ source: item.source, id: item.id }],
                      rowKey: item.key
                    })
                  }
                  className={`group absolute inset-x-0 px-4 sm:px-6 border-b border-slate-200/70 dark:border-slate-800/70 transition-colors flex md:grid md:grid-cols-[36px_138px_minmax(220px,2.2fr)_140px_92px_86px_92px_96px_150px] items-center justify-between gap-2 ${
                    isSelected
                      ? 'bg-indigo-50/70 dark:bg-indigo-950/35'
                      : 'bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900/70'
                  }`}
                >
                  {/* Checkbox */}
                  <div className="flex items-center justify-center shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRowSelection(item.key);
                      }}
                      aria-label={`${item.name} auswählen`}
                      className="min-w-[32px] min-h-[32px] md:min-w-0 md:min-h-0 flex items-center justify-center text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                    >
                      {isSelected ? (
                        <CheckSquare size={15} className="text-indigo-600 dark:text-indigo-400" />
                      ) : (
                        <Square size={15} />
                      )}
                    </button>
                  </div>

                  {/* Date & Time (Desktop column) */}
                  <div className="hidden md:flex items-baseline gap-1.5 font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    <span>{dt.date}</span>
                    {dt.time && (
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        {dt.time}
                      </span>
                    )}
                  </div>

                  {/* Name & Sub-Metadata */}
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span
                        className="text-sm md:text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400"
                        onClick={() =>
                          executeBulkLoadToMap({
                            items: [{ source: item.source, id: item.id }],
                            rowKey: item.key
                          })
                        }
                        title={item.name}
                      >
                        {item.name}
                      </span>
                      {isOnMap && (
                        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap shrink-0">
                          · Auf Karte
                        </span>
                      )}
                      {!item.hasGps && (
                        <span className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0">
                          · Virtuell
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate pl-4">
                      <span className="md:hidden font-mono tabular-nums">
                        {dt.date} · {item.distanceKm.toFixed(1)} km · +{item.ascentM} hm
                      </span>
                      {subDetails && (
                        <span className="hidden md:inline truncate" title={subDetails}>
                          {subDetails}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Source · Sport (Desktop column) */}
                  <div className="hidden md:block text-xs text-slate-600 dark:text-slate-400 truncate whitespace-nowrap">
                    <span
                      className={
                        item.source === 'garmin'
                          ? 'text-orange-600 dark:text-orange-400 font-medium'
                          : 'text-indigo-600 dark:text-indigo-400 font-medium'
                      }
                    >
                      {item.source === 'garmin' ? 'Garmin' : 'Bibliothek'}
                    </span>
                    <span className="mx-1 text-slate-400">·</span>
                    <span>{formatSportLabel(item.activityCategory, item.rawType)}</span>
                  </div>

                  {/* Distance */}
                  <div className="hidden md:block text-right font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {item.distanceKm.toFixed(1)} km
                  </div>

                  {/* Ascent */}
                  <div className="hidden md:block text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    +{item.ascentM.toLocaleString('de-DE')} m
                  </div>

                  {/* Duration */}
                  <div className="hidden md:block text-right font-mono tabular-nums text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    {formatDurationCompact(item.durationSec)}
                  </div>

                  {/* Pace / Speed / HR */}
                  <div className="hidden md:block text-right font-mono tabular-nums text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    {formatTempoMetric(item)}
                  </div>

                  {/* Row Actions */}
                  <div className="flex items-center justify-end gap-1 shrink-0">
                    {isConfirmingRowDelete ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            executeDelete({
                              items: [{ source: item.source, id: item.id }]
                            })
                          }
                          className="px-2 py-1 text-[11px] font-bold rounded bg-rose-600 hover:bg-rose-700 text-white cursor-pointer whitespace-nowrap"
                        >
                          Löschen
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRowDeleteKey(null)}
                          className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                          title="Abbrechen"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={loadingRowKey === item.key}
                          onClick={() =>
                            executeBulkLoadToMap({
                              items: [{ source: item.source, id: item.id }],
                              rowKey: item.key
                            })
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 md:py-1 text-xs font-semibold rounded-md bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-500 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/80 transition-colors whitespace-nowrap shrink-0 cursor-pointer min-h-[36px] md:min-h-0"
                          title="Aktivität auf Karte laden und direkt zur Karte wechseln"
                        >
                          {loadingRowKey === item.key ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <ArrowUpRight size={13} />
                          )}
                          <span>Karte</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditDrawer(item)}
                          aria-label={`${item.name} bearbeiten`}
                          title="Metadaten bearbeiten"
                          className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRowDeleteKey(item.key)}
                          aria-label={`${item.name} löschen`}
                          title="Aktivität löschen"
                          className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Load-More Footer Indicator */}
        {items.length > 0 && hasMore && (
          <div className="py-4 px-6 flex items-center justify-center border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <button
              type="button"
              disabled={isLoadingMore}
              onClick={() => fetchCatalogPage(items.length, true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
            >
              {isLoadingMore && <Loader2 size={13} className="animate-spin" />}
              <span>
                {isLoadingMore
                  ? 'Lade weitere Aktivitäten...'
                  : `Weitere Aktivitäten laden (${items.length} von ${totalCount})`}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Inline Metadata Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-[120] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Aktivität bearbeiten
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {editingItem.source === 'garmin' ? 'Garmin-Aktivität' : 'Bibliotheks-Route'} · GPS-Rohdaten bleiben unverändert
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Sportart
                  </label>
                  <select
                    value={editForm.activityType}
                    onChange={(e) => setEditForm((f) => ({ ...f, activityType: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    <option value="cycling">Radsport</option>
                    <option value="running">Laufen / Wandern</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Datum / Uhrzeit
                  </label>
                  <input
                    type="text"
                    value={editForm.date}
                    onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                    placeholder="YYYY-MM-DD HH:MM:SS"
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {editingItem.source === 'garmin' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Ort
                  </label>
                  <input
                    type="text"
                    value={editForm.location}
                    onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))}
                    placeholder="z. B. Dortmund"
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tags (kommagetrennt)
                  </label>
                  <input
                    type="text"
                    value={editForm.tags}
                    onChange={(e) => setEditForm((f) => ({ ...f, tags: e.target.value }))}
                    placeholder="Alpen, Tempo, Training"
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Notizen / Beschreibung
                </label>
                <textarea
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 cursor-pointer"
                >
                  {isSavingEdit ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  <span>Speichern</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
