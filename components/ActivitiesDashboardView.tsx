import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart3,
  Bike,
  Footprints,
  Mountain,
  Clock,
  Zap,
  Flame,
  Heart,
  Calendar,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ArrowUpRight,
  Award,
  Loader2,
  MapPin,
  SlidersHorizontal
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { GPXTrack } from '../types';
import { getApiUrl, apiFetch } from '../utils/api';
import { hydrateGarminActivityPayload } from '../utils/activityHydration';
import {
  isGarminPointsStubOrEmpty,
  tryFetchGarminFitTrack
} from '../utils/garminClient';
import { getSessionGarminKey } from '../utils/garminSessionKey';
import { hasRealGpsData } from '../utils/gpxUtils';
import type {
  CatalogActivityItem,
  CatalogActivityCategory,
  CatalogSource
} from './ActivitiesManagerView';

export type DashboardGranularity = 'week' | 'month' | 'year' | 'all';
export type DashboardSportFilter = 'all' | 'cycling' | 'running' | 'hiking_other';
export type HistoricalMetricMode = 'cyclingKm' | 'totalKm' | 'ascentM' | 'hours' | 'count';
export type DashboardTableSort = 'date-desc' | 'distance-desc' | 'ascent-desc' | 'duration-desc' | 'speed-desc';

export interface ActivitiesDashboardViewProps {
  workspaceTracks: GPXTrack[];
  ftp: number;
  userWeight: number;
  estimatedSpeed: number;
  onLoadTracksToMap: (
    tracks: GPXTrack[],
    options?: { jumpToMap?: boolean; fitToTracks?: boolean; openStatsModal?: boolean }
  ) => void;
  onOpenActivitiesArchive: () => void;
  onOpenUploadPicker?: () => void;
  onOpenGarminSync?: () => void;
  onBackToMap: () => void;
}

interface PeriodOption {
  key: string;
  label: string;
  shortLabel: string;
  startYmd: string;
  endYmd: string;
  totalDays: number;
  hasData: boolean;
}

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

const GERMAN_MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mär',
  'Apr',
  'Mai',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Okt',
  'Nov',
  'Dez'
];

const WEEKDAY_NAMES_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function extractYmd(iso?: string): string | null {
  if (!iso) return null;
  const trimmed = iso.trim();
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseUtcNoon(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1, 12, 0, 0));
}

function formatUtcYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDeShortDate(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${d}.${m}.`;
}

function formatDeFullDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}

function getIsoWeekInfo(ymd: string): {
  weekKey: string;
  isoYear: number;
  isoWeek: number;
  mondayYmd: string;
  sundayYmd: string;
  label: string;
  shortLabel: string;
} {
  const date = parseUtcNoon(ymd);
  const dayNum = date.getUTCDay() || 7; // 1=Mon..7=Sun
  const thu = new Date(date.getTime());
  thu.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const isoYear = thu.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1, 12, 0, 0));
  const isoWeek = Math.ceil(((thu.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const monday = new Date(date.getTime());
  monday.setUTCDate(date.getUTCDate() - (dayNum - 1));
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const mondayYmd = formatUtcYmd(monday);
  const sundayYmd = formatUtcYmd(sunday);
  const weekStr = String(isoWeek).padStart(2, '0');
  const weekKey = `${isoYear}-W${weekStr}`;
  return {
    weekKey,
    isoYear,
    isoWeek,
    mondayYmd,
    sundayYmd,
    label: `KW ${weekStr} · ${isoYear} (${formatDeShortDate(mondayYmd)} – ${formatDeFullDate(sundayYmd)})`,
    shortLabel: `KW ${weekStr}/${String(isoYear).slice(2)}`
  };
}

function isoWeekKeyToMonday(weekKey: string): Date {
  const m = weekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return parseUtcNoon(formatUtcYmd(new Date()));
  const isoYear = parseInt(m[1], 10);
  const isoWeek = parseInt(m[2], 10);
  const jan4 = new Date(Date.UTC(isoYear, 0, 4, 12, 0, 0));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (jan4Day - 1) * 86400000);
  return new Date(week1Monday.getTime() + (isoWeek - 1) * 7 * 86400000);
}

function getPreviousWeekKey(weekKey: string): string {
  const monday = isoWeekKeyToMonday(weekKey);
  const prevMonday = new Date(monday.getTime() - 7 * 86400000);
  return getIsoWeekInfo(formatUtcYmd(prevMonday)).weekKey;
}

function getDaysInMonth(monthKey: string): number {
  const [yStr, mStr] = monthKey.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 30;
  return new Date(Date.UTC(y, m, 0, 12, 0, 0)).getUTCDate();
}

function getPreviousMonthKey(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return monthKey;
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function matchesSportFilter(cat: CatalogActivityCategory, filter: DashboardSportFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'cycling') return cat === 'cycling';
  if (filter === 'running') return cat === 'running';
  return cat === 'hiking' || cat === 'other';
}

function formatDurationHoursMin(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00 h';
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')} h`;
}

function formatPacePerKm(distanceKm: number, durationSec: number): string {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(durationSec) || durationSec <= 0) {
    return '—';
  }
  const paceMin = durationSec / 60 / distanceKm;
  let mins = Math.floor(paceMin);
  let secs = Math.round((paceMin - mins) * 60);
  if (secs === 60) {
    mins += 1;
    secs = 0;
  }
  return `${mins}:${String(secs).padStart(2, '0')} /km`;
}

function formatDeltaKm(current: number, prev: number): { text: string; positive: boolean; neutral: boolean } {
  if (prev <= 0 && current <= 0) return { text: '±0 km', positive: true, neutral: true };
  const diff = current - prev;
  const pct = prev > 0 ? Math.round((diff / prev) * 100) : null;
  const sign = diff >= 0 ? '+' : '';
  const pctStr = pct !== null ? ` (${diff >= 0 ? '+' : ''}${pct}%)` : '';
  return {
    text: `${sign}${diff.toFixed(1)} km${pctStr}`,
    positive: diff >= 0,
    neutral: Math.abs(diff) < 0.05
  };
}

interface PeriodStats {
  count: number;
  totalKm: number;
  cyclingKm: number;
  cyclingCount: number;
  cyclingDurationSec: number;
  runningKm: number;
  runningCount: number;
  runningDurationSec: number;
  otherKm: number;
  otherCount: number;
  ascentM: number;
  descentM: number;
  durationSec: number;
  caloriesKcal: number;
  avgHr: number | null;
  hrCount: number;
  avgSpeedKmh: number;
  cyclingAvgSpeedKmh: number;
  runningPaceLabel: string;
  activeDays: number;
  longestStreakDays: number;
  longestActivity: CatalogActivityItem | null;
  mostAscentActivity: CatalogActivityItem | null;
  fastestActivity: CatalogActivityItem | null;
}

function computePeriodStats(items: CatalogActivityItem[], startYmd?: string, endYmd?: string): PeriodStats {
  let totalKm = 0;
  let cyclingKm = 0;
  let cyclingCount = 0;
  let cyclingDurationSec = 0;
  let runningKm = 0;
  let runningCount = 0;
  let runningDurationSec = 0;
  let otherKm = 0;
  let otherCount = 0;
  let ascentM = 0;
  let descentM = 0;
  let durationSec = 0;
  let caloriesKcal = 0;
  let hrSum = 0;
  let hrCount = 0;
  const activeDaySet = new Set<string>();

  let longestActivity: CatalogActivityItem | null = null;
  let mostAscentActivity: CatalogActivityItem | null = null;
  let fastestActivity: CatalogActivityItem | null = null;
  let bestSpeedKmh = 0;

  for (const it of items) {
    const dist = Number(it.distanceKm || 0);
    const asc = Math.round(Number(it.ascentM || 0));
    const desc = Math.round(Number(it.descentM || 0));
    const dur = Math.round(Number(it.durationSec || 0));

    totalKm += dist;
    ascentM += asc;
    descentM += desc;
    durationSec += dur;
    if (it.calories && it.calories > 0) caloriesKcal += Math.round(it.calories);
    if (it.avgHr && it.avgHr > 20 && it.avgHr < 230) {
      hrSum += it.avgHr;
      hrCount++;
    }

    const ymd = extractYmd(it.timestampIso);
    if (ymd) activeDaySet.add(ymd);

    if (it.activityCategory === 'cycling') {
      cyclingKm += dist;
      cyclingCount++;
      cyclingDurationSec += dur;
    } else if (it.activityCategory === 'running') {
      runningKm += dist;
      runningCount++;
      runningDurationSec += dur;
    } else {
      otherKm += dist;
      otherCount++;
    }

    if (!longestActivity || dist > longestActivity.distanceKm) {
      longestActivity = it;
    }
    if (asc > 0 && (!mostAscentActivity || asc > mostAscentActivity.ascentM)) {
      mostAscentActivity = it;
    }
    if (dist >= 0.5 && dur >= 60) {
      const spd = dist / (dur / 3600);
      if (spd < 65 && spd > bestSpeedKmh) {
        bestSpeedKmh = spd;
        fastestActivity = it;
      }
    }
  }

  // Compute longest consecutive day streak within the period (or across active days)
  let longestStreakDays = 0;
  const sortedDays = Array.from(activeDaySet).sort();
  if (sortedDays.length > 0) {
    let run = 1;
    longestStreakDays = 1;
    for (let i = 1; i < sortedDays.length; i++) {
      const prevMs = parseUtcNoon(sortedDays[i - 1]).getTime();
      const curMs = parseUtcNoon(sortedDays[i]).getTime();
      if (Math.round((curMs - prevMs) / 86400000) === 1) {
        run++;
        if (run > longestStreakDays) longestStreakDays = run;
      } else {
        run = 1;
      }
    }
  }

  // If start/end supplied, clamp activeDays within range cleanly
  let activeDays = activeDaySet.size;
  if (startYmd && endYmd) {
    let bounded = 0;
    for (const d of activeDaySet) {
      if (d >= startYmd && d <= endYmd) bounded++;
    }
    activeDays = bounded;
  }

  return {
    count: items.length,
    totalKm: Number(totalKm.toFixed(1)),
    cyclingKm: Number(cyclingKm.toFixed(1)),
    cyclingCount,
    cyclingDurationSec,
    runningKm: Number(runningKm.toFixed(1)),
    runningCount,
    runningDurationSec,
    otherKm: Number(otherKm.toFixed(1)),
    otherCount,
    ascentM,
    descentM,
    durationSec,
    caloriesKcal,
    avgHr: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
    hrCount,
    avgSpeedKmh: durationSec > 0 ? Number((totalKm / (durationSec / 3600)).toFixed(1)) : 0,
    cyclingAvgSpeedKmh:
      cyclingDurationSec > 0 ? Number((cyclingKm / (cyclingDurationSec / 3600)).toFixed(1)) : 0,
    runningPaceLabel: formatPacePerKm(runningKm, runningDurationSec),
    activeDays,
    longestStreakDays,
    longestActivity,
    mostAscentActivity,
    fastestActivity
  };
}

export const ActivitiesDashboardView: React.FC<ActivitiesDashboardViewProps> = ({
  ftp,
  userWeight,
  estimatedSpeed,
  onLoadTracksToMap
}) => {
  const [catalogItems, setCatalogItems] = useState<CatalogActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadingTrackKey, setLoadingTrackKey] = useState<string | null>(null);
  const [isLoadingPeriodTracks, setIsLoadingPeriodTracks] = useState(false);

  // Filter & Dropdown State
  const [granularity, setGranularity] = useState<DashboardGranularity>('month');
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string>('');
  const [sportFilter, setSportFilter] = useState<DashboardSportFilter>('all');
  const [historicalMetric, setHistoricalMetric] = useState<HistoricalMetricMode>('cyclingKm');
  const [tableSort, setTableSort] = useState<DashboardTableSort>('date-desc');

  const fetchCatalog = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch(getApiUrl('/api/activities/catalog?source=garmin&limit=5000&sortBy=date-desc'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Aktivitäten konnten nicht geladen werden.');
      setCatalogItems(Array.isArray(json.items) ? json.items : []);
    } catch (err: any) {
      console.error('ActivitiesDashboardView load error:', err);
      setErrorMsg(err?.message || 'Verbindung zum Server fehlgeschlagen.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  // Dashboard counts ONLY Garmin activities (GPX tracks belong strictly to Karte & Geplante Touren)
  const allActivities = useMemo(() => {
    return catalogItems.filter((item) => item.source === 'garmin');
  }, [catalogItems]);

  // Enrich each activity with parsed date keys (YMD, ISO week, month, year)
  const indexedActivities = useMemo(() => {
    return allActivities.map((item) => {
      const ymd = extractYmd(item.timestampIso);
      const weekInfo = ymd ? getIsoWeekInfo(ymd) : null;
      return {
        item,
        ymd,
        weekKey: weekInfo?.weekKey || null,
        monthKey: ymd ? ymd.slice(0, 7) : null,
        yearKey: ymd ? ymd.slice(0, 4) : null
      };
    });
  }, [allActivities]);

  // Build available dropdown options for selected granularity (sorted newest-first)
  const periodOptions = useMemo<PeriodOption[]>(() => {
    const todayYmd = formatUtcYmd(new Date());
    if (granularity === 'all') {
      const validYmds = indexedActivities
        .map((r) => r.ymd)
        .filter((d): d is string => Boolean(d))
        .sort();
      const startYmd = validYmds[0] || todayYmd;
      const endYmd = validYmds[validYmds.length - 1] || todayYmd;
      const spanDays = Math.max(
        1,
        Math.round((parseUtcNoon(endYmd).getTime() - parseUtcNoon(startYmd).getTime()) / 86400000) + 1
      );
      return [
        {
          key: 'all',
          label: `Gesamtzeitraum (${formatDeFullDate(startYmd)} – ${formatDeFullDate(endYmd)})`,
          shortLabel: 'Gesamt',
          startYmd,
          endYmd,
          totalDays: spanDays,
          hasData: indexedActivities.length > 0
        }
      ];
    }

    if (granularity === 'week') {
      const weekSet = new Set<string>();
      const dataWeeks = new Set<string>();
      const todayWeek = getIsoWeekInfo(todayYmd).weekKey;
      weekSet.add(todayWeek);
      for (const r of indexedActivities) {
        if (r.weekKey) {
          weekSet.add(r.weekKey);
          dataWeeks.add(r.weekKey);
        }
      }
      return Array.from(weekSet)
        .sort((a, b) => b.localeCompare(a))
        .map((wk) => {
          const monday = isoWeekKeyToMonday(wk);
          const info = getIsoWeekInfo(formatUtcYmd(monday));
          return {
            key: wk,
            label: info.label,
            shortLabel: info.shortLabel,
            startYmd: info.mondayYmd,
            endYmd: info.sundayYmd,
            totalDays: 7,
            hasData: dataWeeks.has(wk)
          };
        });
    }

    if (granularity === 'month') {
      const monthSet = new Set<string>();
      const dataMonths = new Set<string>();
      monthSet.add(todayYmd.slice(0, 7));
      for (const r of indexedActivities) {
        if (r.monthKey && /^\d{4}-\d{2}$/.test(r.monthKey)) {
          monthSet.add(r.monthKey);
          dataMonths.add(r.monthKey);
        }
      }
      return Array.from(monthSet)
        .sort((a, b) => b.localeCompare(a))
        .map((mk) => {
          const [yStr, mStr] = mk.split('-');
          const mIdx = parseInt(mStr, 10) - 1;
          const totalDays = getDaysInMonth(mk);
          const mName = GERMAN_MONTHS[mIdx] || mStr;
          const mShort = GERMAN_MONTHS_SHORT[mIdx] || mStr;
          return {
            key: mk,
            label: `${mName} ${yStr}`,
            shortLabel: `${mShort} ${yStr.slice(2)}`,
            startYmd: `${mk}-01`,
            endYmd: `${mk}-${String(totalDays).padStart(2, '0')}`,
            totalDays,
            hasData: dataMonths.has(mk)
          };
        });
    }

    // granularity === 'year'
    const yearSet = new Set<string>();
    const dataYears = new Set<string>();
    yearSet.add(todayYmd.slice(0, 4));
    for (const r of indexedActivities) {
      if (r.yearKey && /^\d{4}$/.test(r.yearKey)) {
        yearSet.add(r.yearKey);
        dataYears.add(r.yearKey);
      }
    }
    return Array.from(yearSet)
      .sort((a, b) => b.localeCompare(a))
      .map((yk) => {
        const yNum = parseInt(yk, 10);
        return {
          key: yk,
          label: `Jahr ${yk}`,
          shortLabel: yk,
          startYmd: `${yk}-01-01`,
          endYmd: `${yk}-12-31`,
          totalDays: isLeapYear(yNum) ? 366 : 365,
          hasData: dataYears.has(yk)
        };
      });
  }, [indexedActivities, granularity]);

  // Keep selectedPeriodKey valid and pick newest period with activities when switching granularity
  useEffect(() => {
    if (periodOptions.length === 0) return;
    const stillExists = periodOptions.some((opt) => opt.key === selectedPeriodKey);
    if (!stillExists) {
      const latestWithData = periodOptions.find((opt) => opt.hasData) || periodOptions[0];
      setSelectedPeriodKey(latestWithData.key);
    }
  }, [periodOptions, selectedPeriodKey]);

  const activePeriodOption = useMemo(() => {
    return periodOptions.find((opt) => opt.key === selectedPeriodKey) || periodOptions[0] || null;
  }, [periodOptions, selectedPeriodKey]);

  const currentPeriodIndex = useMemo(() => {
    if (!activePeriodOption) return -1;
    return periodOptions.findIndex((o) => o.key === activePeriodOption.key);
  }, [periodOptions, activePeriodOption]);

  // Sport-filtered activities across all dates
  const sportFilteredRows = useMemo(() => {
    return indexedActivities.filter((r) => matchesSportFilter(r.item.activityCategory, sportFilter));
  }, [indexedActivities, sportFilter]);

  // Previous period key for delta calculation
  const previousPeriodKey = useMemo(() => {
    if (!activePeriodOption || granularity === 'all') return null;
    if (granularity === 'week') return getPreviousWeekKey(activePeriodOption.key);
    if (granularity === 'month') return getPreviousMonthKey(activePeriodOption.key);
    const y = parseInt(activePeriodOption.key, 10);
    return Number.isFinite(y) ? String(y - 1) : null;
  }, [activePeriodOption, granularity]);

  // Activities belonging to active period and previous period
  const { periodActivities, prevPeriodActivities } = useMemo(() => {
    if (!activePeriodOption) {
      return { periodActivities: [] as CatalogActivityItem[], prevPeriodActivities: [] as CatalogActivityItem[] };
    }
    if (granularity === 'all') {
      return {
        periodActivities: sportFilteredRows.map((r) => r.item),
        prevPeriodActivities: [] as CatalogActivityItem[]
      };
    }

    const matchKey = (r: (typeof sportFilteredRows)[number], targetKey: string) => {
      if (granularity === 'week') return r.weekKey === targetKey;
      if (granularity === 'month') return r.monthKey === targetKey;
      return r.yearKey === targetKey;
    };

    const current: CatalogActivityItem[] = [];
    const prev: CatalogActivityItem[] = [];
    for (const r of sportFilteredRows) {
      if (matchKey(r, activePeriodOption.key)) current.push(r.item);
      else if (previousPeriodKey && matchKey(r, previousPeriodKey)) prev.push(r.item);
    }
    return { periodActivities: current, prevPeriodActivities: prev };
  }, [sportFilteredRows, activePeriodOption, granularity, previousPeriodKey]);

  const periodStats = useMemo(
    () => computePeriodStats(periodActivities, activePeriodOption?.startYmd, activePeriodOption?.endYmd),
    [periodActivities, activePeriodOption]
  );

  const prevStats = useMemo(
    () => computePeriodStats(prevPeriodActivities),
    [prevPeriodActivities]
  );

  // Main timeline breakdown buckets inside the selected period + cumulative progression
  const timelineBuckets = useMemo(() => {
    if (!activePeriodOption) return [];

    type Bucket = {
      key: string;
      label: string;
      cyclingKm: number;
      runningKm: number;
      otherKm: number;
      totalKm: number;
      ascentM: number;
      durationMin: number;
      count: number;
      cumCyclingKm: number;
      cumTotalKm: number;
    };

    const buckets: Bucket[] = [];
    const bucketMap = new Map<string, Bucket>();

    if (granularity === 'week') {
      const monday = parseUtcNoon(activePeriodOption.startYmd);
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday.getTime() + i * 86400000);
        const ymd = formatUtcYmd(d);
        const b: Bucket = {
          key: ymd,
          label: `${WEEKDAY_NAMES_SHORT[i]} ${formatDeShortDate(ymd).slice(0, 5)}`,
          cyclingKm: 0,
          runningKm: 0,
          otherKm: 0,
          totalKm: 0,
          ascentM: 0,
          durationMin: 0,
          count: 0,
          cumCyclingKm: 0,
          cumTotalKm: 0
        };
        buckets.push(b);
        bucketMap.set(ymd, b);
      }
      for (const it of periodActivities) {
        const ymd = extractYmd(it.timestampIso);
        const target = ymd ? bucketMap.get(ymd) : undefined;
        if (!target) continue;
        const dist = Number(it.distanceKm || 0);
        if (it.activityCategory === 'cycling') target.cyclingKm += dist;
        else if (it.activityCategory === 'running') target.runningKm += dist;
        else target.otherKm += dist;
        target.totalKm += dist;
        target.ascentM += Math.round(Number(it.ascentM || 0));
        target.durationMin += Math.round(Number(it.durationSec || 0) / 60);
        target.count += 1;
      }
    } else if (granularity === 'month') {
      const daysCount = activePeriodOption.totalDays;
      const prefix = activePeriodOption.key;
      for (let d = 1; d <= daysCount; d++) {
        const dayStr = String(d).padStart(2, '0');
        const ymd = `${prefix}-${dayStr}`;
        const b: Bucket = {
          key: ymd,
          label: `${dayStr}.`,
          cyclingKm: 0,
          runningKm: 0,
          otherKm: 0,
          totalKm: 0,
          ascentM: 0,
          durationMin: 0,
          count: 0,
          cumCyclingKm: 0,
          cumTotalKm: 0
        };
        buckets.push(b);
        bucketMap.set(ymd, b);
      }
      for (const it of periodActivities) {
        const ymd = extractYmd(it.timestampIso);
        const target = ymd ? bucketMap.get(ymd) : undefined;
        if (!target) continue;
        const dist = Number(it.distanceKm || 0);
        if (it.activityCategory === 'cycling') target.cyclingKm += dist;
        else if (it.activityCategory === 'running') target.runningKm += dist;
        else target.otherKm += dist;
        target.totalKm += dist;
        target.ascentM += Math.round(Number(it.ascentM || 0));
        target.durationMin += Math.round(Number(it.durationSec || 0) / 60);
        target.count += 1;
      }
    } else if (granularity === 'year') {
      const y = activePeriodOption.key;
      for (let m = 1; m <= 12; m++) {
        const mk = `${y}-${String(m).padStart(2, '0')}`;
        const b: Bucket = {
          key: mk,
          label: GERMAN_MONTHS_SHORT[m - 1],
          cyclingKm: 0,
          runningKm: 0,
          otherKm: 0,
          totalKm: 0,
          ascentM: 0,
          durationMin: 0,
          count: 0,
          cumCyclingKm: 0,
          cumTotalKm: 0
        };
        buckets.push(b);
        bucketMap.set(mk, b);
      }
      for (const it of periodActivities) {
        const ymd = extractYmd(it.timestampIso);
        const mk = ymd ? ymd.slice(0, 7) : null;
        const target = mk ? bucketMap.get(mk) : undefined;
        if (!target) continue;
        const dist = Number(it.distanceKm || 0);
        if (it.activityCategory === 'cycling') target.cyclingKm += dist;
        else if (it.activityCategory === 'running') target.runningKm += dist;
        else target.otherKm += dist;
        target.totalKm += dist;
        target.ascentM += Math.round(Number(it.ascentM || 0));
        target.durationMin += Math.round(Number(it.durationSec || 0) / 60);
        target.count += 1;
      }
    } else {
      // 'all' -> group ascending by year
      const yearMap = new Map<string, Bucket>();
      for (const it of periodActivities) {
        const ymd = extractYmd(it.timestampIso);
        const yk = ymd ? ymd.slice(0, 4) : 'Ohne';
        let target = yearMap.get(yk);
        if (!target) {
          target = {
            key: yk,
            label: yk,
            cyclingKm: 0,
            runningKm: 0,
            otherKm: 0,
            totalKm: 0,
            ascentM: 0,
            durationMin: 0,
            count: 0,
            cumCyclingKm: 0,
            cumTotalKm: 0
          };
          yearMap.set(yk, target);
        }
        const dist = Number(it.distanceKm || 0);
        if (it.activityCategory === 'cycling') target.cyclingKm += dist;
        else if (it.activityCategory === 'running') target.runningKm += dist;
        else target.otherKm += dist;
        target.totalKm += dist;
        target.ascentM += Math.round(Number(it.ascentM || 0));
        target.durationMin += Math.round(Number(it.durationSec || 0) / 60);
        target.count += 1;
      }
      const sortedYears = Array.from(yearMap.values()).sort((a, b) => a.key.localeCompare(b.key));
      buckets.push(...sortedYears);
    }

    let runningCumCyc = 0;
    let runningCumTotal = 0;
    return buckets.map((b) => {
      const cyc = Number(b.cyclingKm.toFixed(1));
      const run = Number(b.runningKm.toFixed(1));
      const oth = Number(b.otherKm.toFixed(1));
      const tot = Number(b.totalKm.toFixed(1));
      runningCumCyc += cyc;
      runningCumTotal += tot;
      return {
        ...b,
        cyclingKm: cyc,
        runningKm: run,
        otherKm: oth,
        totalKm: tot,
        cumCyclingKm: Number(runningCumCyc.toFixed(1)),
        cumTotalKm: Number(runningCumTotal.toFixed(1))
      };
    });
  }, [activePeriodOption, granularity, periodActivities]);

  // Historical comparison across up to 12 surrounding/preceding periods
  const historicalSeries = useMemo(() => {
    const effectiveGranularity: Exclude<DashboardGranularity, 'all'> =
      granularity === 'all' ? 'year' : granularity;

    // Group sportFilteredRows by period key
    const aggMap = new Map<
      string,
      { cyclingKm: number; totalKm: number; ascentM: number; durationSec: number; count: number }
    >();

    for (const r of sportFilteredRows) {
      const pKey =
        effectiveGranularity === 'week'
          ? r.weekKey
          : effectiveGranularity === 'month'
          ? r.monthKey
          : r.yearKey;
      if (!pKey) continue;
      const cur = aggMap.get(pKey) || {
        cyclingKm: 0,
        totalKm: 0,
        ascentM: 0,
        durationSec: 0,
        count: 0
      };
      const dist = Number(r.item.distanceKm || 0);
      if (r.item.activityCategory === 'cycling') cur.cyclingKm += dist;
      cur.totalKm += dist;
      cur.ascentM += Math.round(Number(r.item.ascentM || 0));
      cur.durationSec += Math.round(Number(r.item.durationSec || 0));
      cur.count += 1;
      aggMap.set(pKey, cur);
    }

    let targetKeys: string[] = [];
    if (granularity === 'all') {
      targetKeys = Array.from(aggMap.keys()).sort();
    } else if (activePeriodOption) {
      // Build 12 contiguous periods ending at the selected period (for week/month) or all years
      if (effectiveGranularity === 'week') {
        let k = activePeriodOption.key;
        const seq: string[] = [];
        for (let i = 0; i < 12; i++) {
          seq.unshift(k);
          k = getPreviousWeekKey(k);
        }
        targetKeys = seq;
      } else if (effectiveGranularity === 'month') {
        let k = activePeriodOption.key;
        const seq: string[] = [];
        for (let i = 0; i < 12; i++) {
          seq.unshift(k);
          k = getPreviousMonthKey(k);
        }
        targetKeys = seq;
      } else {
        targetKeys = periodOptions.map((o) => o.key).sort();
      }
    }

    return targetKeys.map((pKey) => {
      const entry = aggMap.get(pKey) || {
        cyclingKm: 0,
        totalKm: 0,
        ascentM: 0,
        durationSec: 0,
        count: 0
      };
      let shortLabel = pKey;
      if (effectiveGranularity === 'week') {
        const m = pKey.match(/^(\d{4})-W(\d{2})$/);
        if (m) shortLabel = `KW${m[2]}`;
      } else if (effectiveGranularity === 'month') {
        const [y, mStr] = pKey.split('-');
        const mIdx = parseInt(mStr, 10) - 1;
        shortLabel = `${GERMAN_MONTHS_SHORT[mIdx] || mStr} ${y.slice(2)}`;
      }
      const hours = Number((entry.durationSec / 3600).toFixed(1));
      const cyclingKm = Number(entry.cyclingKm.toFixed(1));
      const totalKm = Number(entry.totalKm.toFixed(1));
      const value =
        historicalMetric === 'cyclingKm'
          ? cyclingKm
          : historicalMetric === 'totalKm'
          ? totalKm
          : historicalMetric === 'ascentM'
          ? entry.ascentM
          : historicalMetric === 'hours'
          ? hours
          : entry.count;

      return {
        key: pKey,
        label: shortLabel,
        isSelected: activePeriodOption ? pKey === activePeriodOption.key : false,
        cyclingKm,
        totalKm,
        ascentM: entry.ascentM,
        hours,
        count: entry.count,
        value
      };
    });
  }, [sportFilteredRows, granularity, activePeriodOption, periodOptions, historicalMetric]);

  // Sport breakdown Donut + Distance classes
  const { sportDonutData, distanceBucketsData } = useMemo(() => {
    const donut = [
      { name: 'Radfahren', value: periodStats.cyclingKm, count: periodStats.cyclingCount, color: '#2563eb' },
      { name: 'Laufen', value: periodStats.runningKm, count: periodStats.runningCount, color: '#f97316' },
      { name: 'Wandern & Sonst.', value: periodStats.otherKm, count: periodStats.otherCount, color: '#10b981' }
    ].filter((s) => s.value > 0 || s.count > 0);

    const b1 = { label: '< 20 km', count: 0, km: 0, color: '#94a3b8' };
    const b2 = { label: '20 – 50 km', count: 0, km: 0, color: '#38bdf8' };
    const b3 = { label: '50 – 100 km', count: 0, km: 0, color: '#2563eb' };
    const b4 = { label: '100+ km', count: 0, km: 0, color: '#f97316' };

    for (const it of periodActivities) {
      const d = Number(it.distanceKm || 0);
      const bucket = d < 20 ? b1 : d < 50 ? b2 : d < 100 ? b3 : b4;
      bucket.count++;
      bucket.km += d;
    }

    return {
      sportDonutData: donut,
      distanceBucketsData: [b1, b2, b3, b4].map((b) => ({
        ...b,
        km: Number(b.km.toFixed(1))
      }))
    };
  }, [periodStats, periodActivities]);

  // Sorted activities table for the period
  const sortedPeriodActivities = useMemo(() => {
    const list = [...periodActivities];
    const speedOf = (a: CatalogActivityItem) =>
      a.durationSec > 0 ? a.distanceKm / (a.durationSec / 3600) : 0;

    list.sort((a, b) => {
      switch (tableSort) {
        case 'distance-desc':
          return b.distanceKm - a.distanceKm;
        case 'ascent-desc':
          return b.ascentM - a.ascentM;
        case 'duration-desc':
          return b.durationSec - a.durationSec;
        case 'speed-desc':
          return speedOf(b) - speedOf(a);
        case 'date-desc':
        default:
          return String(b.timestampIso || '').localeCompare(String(a.timestampIso || ''));
      }
    });
    return list;
  }, [periodActivities, tableSort]);

  // Load 1 or multiple activities onto map
  const handleLoadItemsToMap = useCallback(
    async (itemsToLoad: CatalogActivityItem[], singleKey?: string) => {
      if (itemsToLoad.length === 0) return;
      if (singleKey) setLoadingTrackKey(singleKey);
      else setIsLoadingPeriodTracks(true);

      try {
        const dbRefs: Array<{ source: CatalogSource; id: string }> = [];

        for (const it of itemsToLoad.slice(0, 50)) {
          dbRefs.push({ source: it.source, id: it.id });
        }

        const hydratedTracks: GPXTrack[] = [];
        if (dbRefs.length > 0) {
          const res = await apiFetch(getApiUrl('/api/activities/bulk-load'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: dbRefs })
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Aktivitäten konnten nicht geladen werden.');
          }
          if (Array.isArray(data.garminActivities)) {
            const garminKey = getSessionGarminKey();
            let autoFitRemaining = 10;
            for (const rawGarmin of data.garminActivities) {
              const needsFit = isGarminPointsStubOrEmpty(
                rawGarmin.points_json,
                Number(rawGarmin.distance || 0)
              );
              if (needsFit && garminKey && autoFitRemaining > 0) {
                autoFitRemaining--;
                const fitTrack = await tryFetchGarminFitTrack(rawGarmin.id);
                if (fitTrack) {
                  hydratedTracks.push(fitTrack);
                  continue;
                }
              }
              hydratedTracks.push(
                hydrateGarminActivityPayload(rawGarmin, {
                  ftp,
                  userWeight,
                  estimatedSpeed
                })
              );
            }
          }
        }

        if (hydratedTracks.length > 0) {
          const hasAnyGps = hydratedTracks.some((tr) => hasRealGpsData(tr));
          onLoadTracksToMap(hydratedTracks, {
            jumpToMap: hasAnyGps,
            fitToTracks: hasAnyGps,
            openStatsModal: !hasAnyGps
          });
        }
      } catch (err: any) {
        console.error('Error loading dashboard tracks:', err);
        setErrorMsg(err?.message || 'Fehler beim Laden in die Karte.');
      } finally {
        setLoadingTrackKey(null);
        setIsLoadingPeriodTracks(false);
      }
    },
    [ftp, userWeight, estimatedSpeed, onLoadTracksToMap]
  );

  const periodCompareNoun =
    granularity === 'week'
      ? 'Vorwoche'
      : granularity === 'month'
      ? 'Vormonat'
      : granularity === 'year'
      ? 'Vorjahr'
      : '';

  const historicalMetricMeta = useMemo(() => {
    switch (historicalMetric) {
      case 'totalKm':
        return { label: 'Gesamt-km', unit: ' km', color: '#6366f1' };
      case 'ascentM':
        return { label: 'Höhenmeter (hm)', unit: ' hm', color: '#10b981' };
      case 'hours':
        return { label: 'Bewegungszeit (h)', unit: ' h', color: '#8b5cf6' };
      case 'count':
        return { label: 'Einheiten', unit: 'x', color: '#f59e0b' };
      case 'cyclingKm':
      default:
        return { label: 'Gefahrene Rad-km', unit: ' km', color: '#2563eb' };
    }
  }, [historicalMetric]);

  const canGoPrevPeriod =
    granularity !== 'all' && currentPeriodIndex >= 0 && currentPeriodIndex < periodOptions.length - 1;
  const canGoNextPeriod = granularity !== 'all' && currentPeriodIndex > 0;

  return (
    <div
      id="activities-dashboard-view"
      className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 select-none sm:select-auto"
    >
      {/* Top Sticky Control & Dropdown Filter Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-2.5 space-y-2.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/40 shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
            <h2 className="text-base font-black tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2 truncate">
              <span>Garmin Aktivitäten-Dashboard</span>
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 tabular-nums">
                {allActivities.length.toLocaleString('de-DE')}
              </span>
            </h2>
          </div>

          <button
            type="button"
            onClick={fetchCatalog}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-60"
            title="Garmin-Aktivitäten neu laden"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-500' : ''}`} />
            <span className="hidden sm:inline">Aktualisieren</span>
          </button>
        </div>

        {/* Period Dropdown Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            {/* Dropdown 1: Granularität (Woche / Monat / Jahr / Gesamt) */}
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="dashboard-granularity-select"
                className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 hidden sm:inline"
              >
                Ansicht:
              </label>
              <select
                id="dashboard-granularity-select"
                aria-label="Zeitraum-Ansicht (Woche, Monat, Jahr)"
                value={granularity}
                onChange={(e) => {
                  setGranularity(e.target.value as DashboardGranularity);
                  setSelectedPeriodKey('');
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-extrabold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-500 cursor-pointer shadow-2xs"
              >
                <option value="week">Woche</option>
                <option value="month">Monat</option>
                <option value="year">Jahr</option>
                <option value="all">Gesamtzeitraum</option>
              </select>
            </div>

            {/* Dropdown 2: Konkrete Woche / Monat / Jahr + Prev/Next */}
            {granularity !== 'all' && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!canGoPrevPeriod}
                  onClick={() => canGoPrevPeriod && setSelectedPeriodKey(periodOptions[currentPeriodIndex + 1].key)}
                  className="p-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title={`Vorherige ${granularity === 'week' ? 'Woche' : granularity === 'month' ? 'Monat' : 'Jahr'}`}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <select
                  id="dashboard-period-select"
                  aria-label="Konkreten Zeitraum auswählen"
                  value={activePeriodOption?.key || ''}
                  onChange={(e) => setSelectedPeriodKey(e.target.value)}
                  className="px-3 py-1.5 rounded-xl text-xs font-extrabold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-500 cursor-pointer shadow-2xs max-w-[260px] sm:max-w-[320px]"
                >
                  {periodOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}{opt.hasData ? '' : ' (keine Aktivitäten)'}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  disabled={!canGoNextPeriod}
                  onClick={() => canGoNextPeriod && setSelectedPeriodKey(periodOptions[currentPeriodIndex - 1].key)}
                  className="p-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title={`Nächste ${granularity === 'week' ? 'Woche' : granularity === 'month' ? 'Monat' : 'Jahr'}`}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                {periodOptions.length > 0 && currentPeriodIndex !== 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedPeriodKey(periodOptions[0].key)}
                    className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200/70 dark:border-blue-800/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 cursor-pointer whitespace-nowrap"
                  >
                    Aktuell
                  </button>
                )}
              </div>
            )}

            {/* Dropdown 3: Sportart */}
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="dashboard-sport-select"
                className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 hidden lg:inline"
              >
                Sportart:
              </label>
              <select
                id="dashboard-sport-select"
                aria-label="Sportart auswählen"
                value={sportFilter}
                onChange={(e) => setSportFilter(e.target.value as DashboardSportFilter)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer shadow-2xs"
              >
                <option value="all">Alle Sportarten</option>
                <option value="cycling">🚴 Radfahren</option>
                <option value="running">🏃 Laufen</option>
                <option value="hiking_other">🥾 Wandern &amp; Sonstige</option>
              </select>
            </div>
          </div>

          {periodActivities.length > 0 && (
            <button
              type="button"
              disabled={isLoadingPeriodTracks}
              onClick={() => handleLoadItemsToMap(periodActivities)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer transition-colors disabled:opacity-60 whitespace-nowrap"
              title="Aktivitäten dieses Zeitraums gemeinsam auf der Karte laden (max. 50)"
            >
              {isLoadingPeriodTracks ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <MapPin className="w-3.5 h-3.5" />
              )}
              <span>Zeitraum auf Karte laden ({Math.min(periodActivities.length, 50)})</span>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Dashboard Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {errorMsg && (
          <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        {isLoading && allActivities.length === 0 ? (
          <div className="h-72 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <span className="text-sm font-semibold">Lade Aktivitäten-Dashboard...</span>
          </div>
        ) : (
          <>
            {/* 8-Card KPI Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" id="activities-dashboard-kpis">
              {/* 1. Gefahrene Kilometer (Rad) */}
              {(() => {
                const delta = granularity !== 'all' ? formatDeltaKm(periodStats.cyclingKm, prevStats.cyclingKm) : null;
                return (
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-blue-200/80 dark:border-blue-900/50 shadow-xs flex flex-col justify-between gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                          <Bike className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Gefahrene Kilometer (Rad)
                          </span>
                          <span className="text-xl font-black font-mono tabular-nums text-blue-700 dark:text-blue-300">
                            {periodStats.cyclingKm.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
                          </span>
                        </div>
                      </div>
                      {delta && (
                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full font-mono ${
                            delta.positive
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                          }`}
                        >
                          {delta.text}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span>{periodStats.cyclingCount} Ausfahrten</span>
                      <span>
                        Ø {periodStats.cyclingCount > 0 ? (periodStats.cyclingKm / periodStats.cyclingCount).toFixed(1) : '0.0'} km/Tour
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* 2. Gesamt-Kilometer */}
              {(() => {
                const delta = granularity !== 'all' ? formatDeltaKm(periodStats.totalKm, prevStats.totalKm) : null;
                return (
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col justify-between gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                          <TrendingUp className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Gesamt-Kilometer
                          </span>
                          <span className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                            {periodStats.totalKm.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
                          </span>
                        </div>
                      </div>
                      {delta && (
                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full font-mono ${
                            delta.positive
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                          }`}
                        >
                          {delta.text}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span>{periodStats.count} Einheiten gesamt</span>
                      {periodCompareNoun && <span>vs. {periodCompareNoun}</span>}
                    </div>
                  </div>
                );
              })()}

              {/* 3. Gelaufene Kilometer */}
              {(() => {
                const delta = granularity !== 'all' ? formatDeltaKm(periodStats.runningKm, prevStats.runningKm) : null;
                return (
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-orange-200/80 dark:border-orange-900/50 shadow-xs flex flex-col justify-between gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400">
                          <Footprints className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Gelaufene Kilometer
                          </span>
                          <span className="text-xl font-black font-mono tabular-nums text-orange-700 dark:text-orange-300">
                            {periodStats.runningKm.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
                          </span>
                        </div>
                      </div>
                      {delta && (
                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full font-mono ${
                            delta.positive
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                          }`}
                        >
                          {delta.text}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span>{periodStats.runningCount} Läufe</span>
                      <span>Ø Pace {periodStats.runningPaceLabel}</span>
                    </div>
                  </div>
                );
              })()}

              {/* 4. Höhenmeter & Steigquote */}
              {(() => {
                const ascDiff = periodStats.ascentM - prevStats.ascentM;
                const hmPerKm = periodStats.totalKm > 0 ? (periodStats.ascentM / periodStats.totalKm).toFixed(1) : '0.0';
                const vam = periodStats.durationSec > 0 ? Math.round(periodStats.ascentM / (periodStats.durationSec / 3600)) : 0;
                return (
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-emerald-200/80 dark:border-emerald-900/50 shadow-xs flex flex-col justify-between gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                          <Mountain className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Höhenmeter (Anstieg)
                          </span>
                          <span className="text-xl font-black font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
                            +{periodStats.ascentM.toLocaleString('de-DE')} hm
                          </span>
                        </div>
                      </div>
                      {granularity !== 'all' && (
                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full font-mono ${
                            ascDiff >= 0
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                          }`}
                        >
                          {ascDiff >= 0 ? '+' : ''}{ascDiff.toLocaleString('de-DE')} hm
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span>-{periodStats.descentM.toLocaleString('de-DE')} hm Abstieg</span>
                      <span>{hmPerKm} hm/km · {vam} VAM</span>
                    </div>
                  </div>
                );
              })()}

              {/* 5. Trainingsdauer */}
              {(() => {
                const durDiff = periodStats.durationSec - prevStats.durationSec;
                const avgDurSec = periodStats.count > 0 ? periodStats.durationSec / periodStats.count : 0;
                return (
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col justify-between gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-violet-100 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400">
                          <Clock className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Bewegungszeit
                          </span>
                          <span className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                            {formatDurationHoursMin(periodStats.durationSec)}
                          </span>
                        </div>
                      </div>
                      {granularity !== 'all' && (
                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full font-mono ${
                            durDiff >= 0
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                          }`}
                        >
                          {durDiff >= 0 ? '+' : '-'}{formatDurationHoursMin(Math.abs(durDiff))}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span>Ø Einheit: {formatDurationHoursMin(avgDurSec)}</span>
                      <span>{(periodStats.durationSec / 3600).toFixed(1)} Std.</span>
                    </div>
                  </div>
                );
              })()}

              {/* 6. Tempo & Bestwert */}
              {(() => {
                const fastestKmh =
                  periodStats.fastestActivity && periodStats.fastestActivity.durationSec > 0
                    ? (periodStats.fastestActivity.distanceKm / (periodStats.fastestActivity.durationSec / 3600)).toFixed(1)
                    : null;
                return (
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col justify-between gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400">
                          <Zap className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Ø Rad-Tempo &amp; Pace
                          </span>
                          <span className="text-xl font-black font-mono tabular-nums text-sky-700 dark:text-sky-300">
                            {periodStats.cyclingAvgSpeedKmh > 0
                              ? `${periodStats.cyclingAvgSpeedKmh.toFixed(1)} km/h`
                              : `${periodStats.avgSpeedKmh.toFixed(1)} km/h`}
                          </span>
                        </div>
                      </div>
                      {fastestKmh && (
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300 font-mono">
                          Peak {fastestKmh} km/h
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span>Gesamt Ø: {periodStats.avgSpeedKmh.toFixed(1)} km/h</span>
                      <span>Lauf Ø: {periodStats.runningPaceLabel}</span>
                    </div>
                  </div>
                );
              })()}

              {/* 7. Kalorien & Herzfrequenz */}
              {(() => {
                const kcalPerHour =
                  periodStats.durationSec > 0 && periodStats.caloriesKcal > 0
                    ? Math.round(periodStats.caloriesKcal / (periodStats.durationSec / 3600))
                    : null;
                return (
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col justify-between gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400">
                          <Flame className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Energie &amp; Herzfrequenz
                          </span>
                          <span className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                            {periodStats.caloriesKcal > 0
                              ? `${periodStats.caloriesKcal.toLocaleString('de-DE')} kcal`
                              : '— kcal'}
                          </span>
                        </div>
                      </div>
                      {periodStats.avgHr && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 font-mono">
                          <Heart className="w-3 h-3" /> {periodStats.avgHr} bpm
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span>{kcalPerHour ? `${kcalPerHour} kcal/h` : 'Keine Kaloriendaten'}</span>
                      <span>{periodStats.hrCount}x mit HF</span>
                    </div>
                  </div>
                );
              })()}

              {/* 8. Konsistenz & Aktive Tage */}
              {(() => {
                const periodDays = activePeriodOption?.totalDays || 30;
                const activePct = Math.min(100, Math.round((periodStats.activeDays / Math.max(1, periodDays)) * 100));
                const avgKmPerDay = (periodStats.totalKm / Math.max(1, periodDays)).toFixed(1);
                return (
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col justify-between gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Aktive Tage &amp; Konsistenz
                          </span>
                          <span className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                            {periodStats.activeDays} / {periodDays}{' '}
                            <span className="text-xs font-bold text-slate-400">({activePct}%)</span>
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 font-mono">
                        Streak {periodStats.longestStreakDays}T
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span>Ø {avgKmPerDay} km/Kalendertag</span>
                      <span>
                        Ø {periodStats.activeDays > 0 ? (periodStats.totalKm / periodStats.activeDays).toFixed(1) : '0.0'} km/Aktivtag
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Row 2: Main Period Timeline + Cumulative Km Progression */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left 8 cols: Stacked Distance & Ascent within selected period */}
              <div className="lg:col-span-8 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Kilometer &amp; Höhenmeter – {activePeriodOption?.label || 'Zeitraum'}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Verteilung nach Sportart (gestapelte km) und Höhenmeter (hm) innerhalb des gewählten Zeitraums.
                    </p>
                  </div>
                  <div className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">
                    🚴 {periodStats.cyclingKm.toLocaleString('de-DE')} km · Gesamt {periodStats.totalKm.toLocaleString('de-DE')} km
                  </div>
                </div>

                <div className="h-72 w-full min-w-0">
                  {timelineBuckets.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      Keine Aktivitäten im ausgewählten Zeitraum.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={288} minWidth={0}>
                      <ComposedChart data={timelineBuckets}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                        <XAxis dataKey="label" stroke="#94a3b8" fontSize={10} interval={granularity === 'month' ? 1 : 0} />
                        <YAxis yAxisId="left" stroke="#2563eb" fontSize={10} unit=" km" width={48} />
                        <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={10} unit=" m" width={46} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const pt = payload[0].payload;
                            return (
                              <div className="bg-slate-900/95 text-white p-3 rounded-xl border border-slate-700 shadow-xl text-xs space-y-1">
                                <div className="font-bold border-b border-slate-700 pb-1">
                                  {pt.label} ({pt.count} Einheiten)
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px]">
                                  <span className="text-blue-300">🚴 Radfahren:</span>
                                  <span className="text-right font-bold">{pt.cyclingKm} km</span>
                                  <span className="text-orange-300">🏃 Laufen:</span>
                                  <span className="text-right font-bold">{pt.runningKm} km</span>
                                  <span className="text-emerald-300">🥾 Sonstige:</span>
                                  <span className="text-right font-bold">{pt.otherKm} km</span>
                                  <span className="text-amber-300">⛰️ Höhenmeter:</span>
                                  <span className="text-right font-bold">+{pt.ascentM} hm</span>
                                  <span className="text-slate-300">∑ Kumuliert:</span>
                                  <span className="text-right font-bold">{pt.cumTotalKm} km</span>
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        <Bar yAxisId="left" dataKey="cyclingKm" stackId="km" name="🚴 Radfahren (km)" fill="#2563eb" isAnimationActive={false} />
                        <Bar yAxisId="left" dataKey="runningKm" stackId="km" name="🏃 Laufen (km)" fill="#f97316" isAnimationActive={false} />
                        <Bar yAxisId="left" dataKey="otherKm" stackId="km" name="🥾 Sonstige (km)" fill="#10b981" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                        <Line yAxisId="right" type="monotone" dataKey="ascentM" name="⛰️ Höhenmeter (hm)" stroke="#f59e0b" strokeWidth={2.2} dot={{ r: 2.5 }} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Right 4 cols: Cumulative Kilometers Progression */}
              <div className="lg:col-span-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3 min-w-0">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Kumulierte Kilometer-Kurve
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Aufsummierter Verlauf der gefahrenen und gesamten Kilometer.
                  </p>
                </div>

                <div className="h-72 w-full min-w-0">
                  {timelineBuckets.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      Keine Verlaufsdaten vorhanden.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={288} minWidth={0}>
                      <AreaChart data={timelineBuckets}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                        <XAxis dataKey="label" stroke="#94a3b8" fontSize={9} minTickGap={16} />
                        <YAxis stroke="#94a3b8" fontSize={10} unit=" km" width={48} />
                        <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '11px' }} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        <Area
                          type="monotone"
                          dataKey="cumTotalKm"
                          name="Gesamt kum. (km)"
                          stroke="#6366f1"
                          fill="#6366f1"
                          fillOpacity={0.14}
                          strokeWidth={2}
                          isAnimationActive={false}
                        />
                        <Area
                          type="monotone"
                          dataKey="cumCyclingKm"
                          name="Rad kum. (km)"
                          stroke="#2563eb"
                          fill="#2563eb"
                          fillOpacity={0.2}
                          strokeWidth={2.5}
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            {/* Row 3: Historical Comparison + Sport Donut & Distance Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left 8 cols: Historical Period Comparison */}
              <div className="lg:col-span-8 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Perioden-Vergleich ({granularity === 'week' ? 'Letzte 12 Wochen' : granularity === 'month' ? 'Letzte 12 Monate' : 'Jahres-Trend'})
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Vergleicht den ausgewählten Zeitraum (orange markiert) direkt mit vorherigen Perioden. Klick auf Balken wechselt Zeitraum.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                    {(
                      [
                        { id: 'cyclingKm', label: 'Rad-km' },
                        { id: 'totalKm', label: 'Gesamt-km' },
                        { id: 'ascentM', label: 'Höhenmeter' },
                        { id: 'hours', label: 'Stunden' },
                        { id: 'count', label: 'Einheiten' }
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setHistoricalMetric(m.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                          historicalMetric === m.id
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-64 w-full min-w-0">
                  {historicalSeries.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      Keine historischen Vergleichsdaten vorhanden.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={256} minWidth={0}>
                      <BarChart
                        data={historicalSeries}
                        onClick={(state: any) => {
                          const clickedKey = state?.activePayload?.[0]?.payload?.key;
                          if (clickedKey && granularity !== 'all') {
                            setSelectedPeriodKey(clickedKey);
                          }
                        }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                        <XAxis dataKey="label" stroke="#94a3b8" fontSize={10} />
                        <YAxis stroke="#94a3b8" fontSize={10} width={48} unit={historicalMetricMeta.unit} />
                        <Tooltip
                          contentStyle={{ borderRadius: '12px', fontSize: '11px' }}
                          formatter={(val: any) => [`${val}${historicalMetricMeta.unit}`, historicalMetricMeta.label]}
                        />
                        <Bar
                          dataKey="value"
                          name={historicalMetricMeta.label}
                          radius={[6, 6, 0, 0]}
                          cursor={granularity !== 'all' ? 'pointer' : undefined}
                          isAnimationActive={false}
                        >
                          {historicalSeries.map((entry) => (
                            <Cell
                              key={entry.key}
                              fill={entry.isSelected ? '#ea580c' : historicalMetricMeta.color}
                              fillOpacity={entry.isSelected ? 1 : 0.72}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Right 4 cols: Sport Split Donut & Distance Buckets */}
              <div className="lg:col-span-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4 min-w-0 flex flex-col justify-between">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Sportarten-Split &amp; Distanz-Klassen
                  </h3>
                  {sportDonutData.length === 0 ? (
                    <div className="h-36 flex items-center justify-center text-xs text-slate-400">
                      Keine Sportdaten im Zeitraum.
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 mt-2">
                      <div className="w-28 h-28 shrink-0">
                        <ResponsiveContainer width="100%" height={112} minWidth={0}>
                          <PieChart>
                            <Pie
                              data={sportDonutData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={28}
                              outerRadius={46}
                              paddingAngle={3}
                              isAnimationActive={false}
                            >
                              {sportDonutData.map((entry) => (
                                <Cell key={entry.name} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(val: any) => `${Number(val).toFixed(1)} km`} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex-1 space-y-1.5 text-xs">
                        {sportDonutData.map((s) => (
                          <div key={s.name} className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300 truncate">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                              {s.name}
                            </span>
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-100 shrink-0">
                              {s.value.toFixed(1)} km <span className="text-[10px] text-slate-400">({s.count}x)</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Distance Class Distribution */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-blue-500" />
                    Distanz-Klassen ({periodStats.count} Einheiten)
                  </div>
                  <div className="space-y-1.5">
                    {distanceBucketsData.map((b) => {
                      const pct = periodStats.count > 0 ? Math.round((b.count / periodStats.count) * 100) : 0;
                      return (
                        <div key={b.label} className="space-y-0.5 text-[11px]">
                          <div className="flex justify-between font-mono">
                            <span className="font-sans font-semibold text-slate-600 dark:text-slate-300">{b.label}</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {b.count}x · {b.km.toFixed(0)} km ({pct}%)
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${b.count > 0 ? Math.max(4, pct) : 0}%`, backgroundColor: b.color }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Row 4: Period Highlights (Best Performances in Selected Period) */}
            {periodActivities.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    title: 'Längste Aktivität im Zeitraum',
                    act: periodStats.longestActivity,
                    metric: periodStats.longestActivity ? `${periodStats.longestActivity.distanceKm.toFixed(1)} km` : '—',
                    badgeClass: 'bg-blue-50/70 dark:bg-blue-950/25 border-blue-200/70 dark:border-blue-900/40',
                    icon: <Award className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  },
                  {
                    title: 'Meiste Höhenmeter im Zeitraum',
                    act: periodStats.mostAscentActivity,
                    metric: periodStats.mostAscentActivity ? `+${periodStats.mostAscentActivity.ascentM.toLocaleString('de-DE')} hm` : '—',
                    badgeClass: 'bg-emerald-50/70 dark:bg-emerald-950/25 border-emerald-200/70 dark:border-emerald-900/40',
                    icon: <Mountain className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  },
                  {
                    title: 'Schnellstes Tempo im Zeitraum',
                    act: periodStats.fastestActivity,
                    metric:
                      periodStats.fastestActivity && periodStats.fastestActivity.durationSec > 0
                        ? `${(periodStats.fastestActivity.distanceKm / (periodStats.fastestActivity.durationSec / 3600)).toFixed(1)} km/h`
                        : '—',
                    badgeClass: 'bg-orange-50/70 dark:bg-orange-950/25 border-orange-200/70 dark:border-orange-900/40',
                    icon: <Zap className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                  }
                ].map((card) => (
                  <div key={card.title} className={`p-4 rounded-2xl border shadow-xs flex flex-col justify-between gap-2 ${card.badgeClass}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                          {card.title}
                        </span>
                        <div className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                          {card.metric}
                        </div>
                      </div>
                      <div className="p-2 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/60 dark:border-slate-700/60">
                        {card.icon}
                      </div>
                    </div>
                    {card.act ? (
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/50 text-xs">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 dark:text-slate-100 truncate" title={card.act.name}>
                            {card.act.name}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">
                            {formatDeFullDate(extractYmd(card.act.timestampIso) || '')} · {card.act.distanceKm.toFixed(1)} km · {formatDurationHoursMin(card.act.durationSec)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleLoadItemsToMap([card.act!], card.act!.key)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 hover:bg-blue-600 hover:text-white text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-[11px] font-bold transition-colors cursor-pointer shrink-0"
                        >
                          <span>Auf Karte</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">Kein Eintrag vorhanden.</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Row 5: Period Activities Table */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Aktivitäten im Zeitraum ({sortedPeriodActivities.length})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {activePeriodOption?.label}
                  </p>
                </div>

                <select
                  aria-label="Aktivitäten sortieren"
                  value={tableSort}
                  onChange={(e) => setTableSort(e.target.value as DashboardTableSort)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <option value="date-desc">Neueste zuerst</option>
                  <option value="distance-desc">Größte Distanz</option>
                  <option value="ascent-desc">Meiste Höhenmeter</option>
                  <option value="duration-desc">Längste Dauer</option>
                  <option value="speed-desc">Höchstes Tempo</option>
                </select>
              </div>

              {sortedPeriodActivities.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-400">
                  In diesem Zeitraum liegen für den gewählten Filter keine Aktivitäten vor. Wähle über das Dropdown eine andere Woche, einen anderen Monat oder ein anderes Jahr.
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[420px]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="py-2.5 px-4">Aktivität</th>
                        <th className="py-2.5 px-3">Datum</th>
                        <th className="py-2.5 px-3 text-right">Distanz</th>
                        <th className="py-2.5 px-3 text-right">Höhenmeter</th>
                        <th className="py-2.5 px-3 text-right">Dauer</th>
                        <th className="py-2.5 px-3 text-right">Ø Tempo / Pace</th>
                        <th className="py-2.5 px-3 text-right">HF / kcal</th>
                        <th className="py-2.5 px-4 text-right">Aktion</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {sortedPeriodActivities.map((item) => {
                        const ymd = extractYmd(item.timestampIso);
                        const speedKmh = item.durationSec > 0 ? item.distanceKm / (item.durationSec / 3600) : 0;
                        const tempoStr =
                          item.durationSec > 0 && item.distanceKm > 0
                            ? item.activityCategory === 'running' || item.activityCategory === 'hiking'
                              ? formatPacePerKm(item.distanceKm, item.durationSec)
                              : `${speedKmh.toFixed(1)} km/h`
                            : '—';
                        const isItemLoading = loadingTrackKey === item.key;

                        return (
                          <tr key={item.key} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-100 max-w-[260px]">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="shrink-0">
                                  {item.activityCategory === 'cycling'
                                    ? '🚴'
                                    : item.activityCategory === 'running'
                                    ? '🏃'
                                    : '🥾'}
                                </span>
                                <span className="truncate" title={item.name}>
                                  {item.name}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {ymd ? formatDeFullDate(ymd) : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900 dark:text-white whitespace-nowrap">
                              {item.distanceKm.toFixed(1)} km
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                              {item.ascentM > 0 ? `+${item.ascentM.toLocaleString('de-DE')} hm` : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                              {formatDurationHoursMin(item.durationSec)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                              {tempoStr}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {item.avgHr ? `${Math.round(item.avgHr)} bpm` : ''}
                              {item.avgHr && item.calories ? ' · ' : ''}
                              {item.calories ? `${Math.round(item.calories)} kcal` : !item.avgHr ? '—' : ''}
                            </td>
                            <td className="py-2.5 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                disabled={isItemLoading}
                                onClick={() => handleLoadItemsToMap([item], item.key)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-600 dark:hover:text-white font-bold text-[11px] transition-colors cursor-pointer disabled:opacity-60"
                              >
                                {isItemLoading ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <>
                                    <span>Auf Karte</span>
                                    <ArrowUpRight className="w-3 h-3" />
                                  </>
                                )}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ActivitiesDashboardView;
