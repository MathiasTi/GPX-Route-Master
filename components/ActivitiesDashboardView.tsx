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
  Activity,
  Target,
  Layers,
  Sparkles,
  X,
  Filter
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  ZAxis,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
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
import { hasRealGpsData, isStopWatchType } from '../utils/gpxUtils';
import type {
  CatalogActivityItem,
  CatalogActivityCategory,
  CatalogSource
} from './ActivitiesManagerView';

export type DashboardGranularity = 'week' | 'month' | 'year' | 'all';
export type DashboardSportFilter = 'all' | 'cycling' | 'running' | 'hiking_other';
export type DashboardTableSort = 'date-desc' | 'distance-desc' | 'ascent-desc' | 'duration-desc' | 'speed-desc';

export type DashboardChartFilter =
  | { type: 'weekday'; dayIndex: number; label: string }
  | { type: 'week'; weekKey: string; label: string }
  | { type: 'date'; ymd: string; label: string }
  | { type: 'activity'; key: string; label: string };

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
  vam: number;
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
  let distanceDurationSec = 0;
  let climbingDurationSec = 0;
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
    if (dist > 0.05 && dur > 0) distanceDurationSec += dur;
    if (asc > 0 && dur > 0) climbingDurationSec += dur;
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
    avgSpeedKmh: distanceDurationSec > 0 ? Number((totalKm / (distanceDurationSec / 3600)).toFixed(1)) : 0,
    cyclingAvgSpeedKmh:
      cyclingDurationSec > 0 ? Number((cyclingKm / (cyclingDurationSec / 3600)).toFixed(1)) : 0,
    runningPaceLabel: formatPacePerKm(runningKm, runningDurationSec),
    vam: climbingDurationSec > 0 ? Math.round(ascentM / (climbingDurationSec / 3600)) : 0,
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
  const [tableSort, setTableSort] = useState<DashboardTableSort>('date-desc');
  const [chartFilter, setChartFilter] = useState<DashboardChartFilter | null>(null);
  const [efficiencyScope, setEfficiencyScope] = useState<'period' | 'all'>('all');

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
    return catalogItems.filter((item) => item.source === 'garmin' && !isStopWatchType(item.rawType));
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

  // 1. Rolling Training Load (7d Acute ATL, 28d Chronic CTL, TSB Form Balance) across trailing 16 ISO weeks
  const trainingLoadModel = useMemo(() => {
    const datedRows = sportFilteredRows.filter((r) => Boolean(r.ymd)) as Array<
      (typeof sportFilteredRows)[number] & { ymd: string; weekKey: string }
    >;
    if (datedRows.length === 0) {
      return {
        weeks: [] as Array<{
          weekKey: string;
          label: string;
          ctl: number;
          atl: number;
          tsb: number;
          weeklyLoad: number;
          weeklyKm: number;
          count: number;
        }>,
        latestCtl: 0,
        latestAtl: 0,
        latestTsb: 0,
        acwr: null as number | null
      };
    }

    const dailyLoadMap = new Map<string, number>();
    const weeklyAggMap = new Map<string, { km: number; count: number; load: number }>();
    let minYmd = datedRows[0].ymd;
    let maxYmd = datedRows[0].ymd;

    for (const r of datedRows) {
      if (r.ymd < minYmd) minYmd = r.ymd;
      if (r.ymd > maxYmd) maxYmd = r.ymd;

      const durH = Math.max(0, Number(r.item.durationSec || 0) / 3600);
      const ascM = Math.max(0, Number(r.item.ascentM || 0));
      const hr = r.item.avgHr && r.item.avgHr > 35 && r.item.avgHr < 230 ? r.item.avgHr : null;
      const sessionLoad = hr ? durH * (hr / 145) * 65 : durH * 52 + ascM * 0.035;

      dailyLoadMap.set(r.ymd, (dailyLoadMap.get(r.ymd) || 0) + sessionLoad);

      if (r.weekKey) {
        const curW = weeklyAggMap.get(r.weekKey) || { km: 0, count: 0, load: 0 };
        curW.km += Number(r.item.distanceKm || 0);
        curW.count += 1;
        curW.load += sessionLoad;
        weeklyAggMap.set(r.weekKey, curW);
      }
    }

    const todayYmd = formatUtcYmd(new Date());
    const anchorEndYmd =
      activePeriodOption && activePeriodOption.endYmd <= todayYmd
        ? activePeriodOption.endYmd
        : maxYmd > todayYmd
        ? maxYmd
        : todayYmd;

    // Limit simulation window to max 730 days before anchorEndYmd so EMA warms up accurately and runs instantaneously
    const endDate = parseUtcNoon(anchorEndYmd);
    const earliestSimMs = endDate.getTime() - 730 * 86400000;
    const minMs = Math.max(parseUtcNoon(minYmd).getTime(), earliestSimMs);

    let atl = 0;
    let ctl = 0;
    const sundaySnapshots = new Map<string, { ctl: number; atl: number; tsb: number }>();

    for (let ms = minMs; ms <= endDate.getTime(); ms += 86400000) {
      const ymd = formatUtcYmd(new Date(ms));
      const load = dailyLoadMap.get(ymd) || 0;
      const tsbBefore = ctl - atl;
      atl = atl + (load - atl) / 7;
      ctl = ctl + (load - ctl) / 28;
      const dayOfWeek = new Date(ms).getUTCDay(); // 0 = Sunday
      if (dayOfWeek === 0 || ms + 86400000 > endDate.getTime()) {
        const wk = getIsoWeekInfo(ymd).weekKey;
        sundaySnapshots.set(wk, {
          ctl: Number(ctl.toFixed(1)),
          atl: Number(atl.toFixed(1)),
          tsb: Number(tsbBefore.toFixed(1))
        });
      }
    }

    // Collect trailing 16 ISO weeks ending at anchorEndYmd
    const endWeekKey = getIsoWeekInfo(anchorEndYmd).weekKey;
    const weekKeys: string[] = [];
    let cursorWk = endWeekKey;
    for (let i = 0; i < 16; i++) {
      weekKeys.unshift(cursorWk);
      cursorWk = getPreviousWeekKey(cursorWk);
    }

    const weeks = weekKeys.map((wk) => {
      const snap = sundaySnapshots.get(wk) || { ctl: 0, atl: 0, tsb: 0 };
      const agg = weeklyAggMap.get(wk) || { km: 0, count: 0, load: 0 };
      const m = wk.match(/^(\d{4})-W(\d{2})$/);
      const label = m ? `KW${m[2]}` : wk;
      return {
        weekKey: wk,
        label,
        ctl: snap.ctl,
        atl: snap.atl,
        tsb: snap.tsb,
        weeklyLoad: Math.round(agg.load),
        weeklyKm: Number(agg.km.toFixed(1)),
        count: agg.count
      };
    });

    const latestCtl = Number(ctl.toFixed(1));
    const latestAtl = Number(atl.toFixed(1));
    const latestTsb = Number((ctl - atl).toFixed(1));
    const acwr = latestCtl >= 4 ? Number((latestAtl / latestCtl).toFixed(2)) : null;

    return { weeks, latestCtl, latestAtl, latestTsb, acwr };
  }, [sportFilteredRows, activePeriodOption]);

  // 2. Aerobic Efficiency Scatter Matrix (HR vs Speed + EF trend)
  const efficiencyModel = useMemo(() => {
    const sourceList =
      efficiencyScope === 'period'
        ? periodActivities
        : sportFilteredRows.map((r) => r.item);

    type ScatterPoint = {
      key: string;
      name: string;
      ymd: string;
      category: CatalogActivityCategory;
      avgHr: number;
      speedKmh: number;
      distanceKm: number;
      durationSec: number;
      ef: number;
    };

    const points: ScatterPoint[] = [];
    for (const it of sourceList) {
      const hr = Number(it.avgHr || 0);
      const dur = Number(it.durationSec || 0);
      const dist = Number(it.distanceKm || 0);
      if (hr <= 45 || hr >= 225 || dur < 300 || dist < 0.8) continue;
      const speedKmh = dist / (dur / 3600);
      if (speedKmh <= 2 || speedKmh > 65) continue;
      const ef = (speedKmh * 1000) / 60 / hr; // meters/min per bpm
      points.push({
        key: it.key,
        name: it.name,
        ymd: extractYmd(it.timestampIso) || '',
        category: it.activityCategory,
        avgHr: Math.round(hr),
        speedKmh: Number(speedKmh.toFixed(1)),
        distanceKm: Number(dist.toFixed(1)),
        durationSec: dur,
        ef: Number(ef.toFixed(2))
      });
    }

    const sortedChrono = [...points].sort((a, b) => a.ymd.localeCompare(b.ymd));
    const avgEf =
      sortedChrono.length > 0
        ? Number((sortedChrono.reduce((s, p) => s + p.ef, 0) / sortedChrono.length).toFixed(2))
        : null;

    let efDeltaPct: number | null = null;
    if (sortedChrono.length >= 6) {
      const mid = Math.floor(sortedChrono.length / 2);
      const firstHalf = sortedChrono.slice(0, mid);
      const secondHalf = sortedChrono.slice(mid);
      const avg1 = firstHalf.reduce((s, p) => s + p.ef, 0) / firstHalf.length;
      const avg2 = secondHalf.reduce((s, p) => s + p.ef, 0) / secondHalf.length;
      if (avg1 > 0) {
        efDeltaPct = Number((((avg2 - avg1) / avg1) * 100).toFixed(1));
      }
    }

    return {
      points: sortedChrono.slice(-160),
      cyclingPoints: sortedChrono.slice(-160).filter((p) => p.category === 'cycling'),
      runningPoints: sortedChrono.slice(-160).filter((p) => p.category === 'running'),
      otherPoints: sortedChrono
        .slice(-160)
        .filter((p) => p.category !== 'cycling' && p.category !== 'running'),
      avgEf,
      efDeltaPct,
      totalMatchedCount: sortedChrono.length
    };
  }, [efficiencyScope, periodActivities, sportFilteredRows]);

  // 3. Year-over-Year Cumulative Distance Overlay (Jan - Dec) + YTD Delta
  const yoyModel = useMemo(() => {
    const yearMonthKm = new Map<string, number[]>();
    for (const r of sportFilteredRows) {
      if (!r.ymd || !r.yearKey) continue;
      const m = parseInt(r.ymd.slice(5, 7), 10);
      if (!Number.isFinite(m) || m < 1 || m > 12) continue;
      if (!yearMonthKm.has(r.yearKey)) {
        yearMonthKm.set(r.yearKey, Array(12).fill(0));
      }
      yearMonthKm.get(r.yearKey)![m - 1] += Number(r.item.distanceKm || 0);
    }

    const yearsDesc = Array.from(yearMonthKm.keys())
      .filter((y) => /^\d{4}$/.test(y))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 4);

    const now = new Date();
    const currentYearStr = String(now.getUTCFullYear());
    const currentMonthIdx = now.getUTCMonth(); // 0..11
    const todayMmDd = formatUtcYmd(now).slice(5); // MM-DD

    const monthlySeries = GERMAN_MONTHS_SHORT.map((mLabel, mIdx) => {
      const row: Record<string, any> = { month: mLabel, monthIndex: mIdx + 1 };
      for (const yr of yearsDesc) {
        if (yr === currentYearStr && mIdx > currentMonthIdx) {
          row[yr] = null;
          continue;
        }
        const arr = yearMonthKm.get(yr)!;
        let cum = 0;
        for (let k = 0; k <= mIdx; k++) cum += arr[k];
        row[yr] = Number(cum.toFixed(1));
      }
      return row;
    });

    // Exact YTD comparison between newest year with data and its prior year up to same MM-DD
    const focusYear = yearsDesc.includes(currentYearStr) ? currentYearStr : yearsDesc[0] || currentYearStr;
    const prevYear = String(parseInt(focusYear, 10) - 1);
    const cutoffMmDd = focusYear === currentYearStr ? todayMmDd : '12-31';

    let focusYtdKm = 0;
    let prevYtdKm = 0;
    let hasPrevYearData = false;
    for (const r of sportFilteredRows) {
      if (!r.ymd || !r.yearKey) continue;
      const mmdd = r.ymd.slice(5);
      if (r.yearKey === focusYear && mmdd <= cutoffMmDd) {
        focusYtdKm += Number(r.item.distanceKm || 0);
      } else if (r.yearKey === prevYear && mmdd <= cutoffMmDd) {
        prevYtdKm += Number(r.item.distanceKm || 0);
        hasPrevYearData = true;
      }
    }

    const ytdDiffKm = Number((focusYtdKm - prevYtdKm).toFixed(1));
    const ytdDiffPct = prevYtdKm > 0 ? Math.round(((focusYtdKm - prevYtdKm) / prevYtdKm) * 100) : null;

    return {
      years: yearsDesc,
      series: monthlySeries,
      focusYear,
      prevYear,
      focusYtdKm: Number(focusYtdKm.toFixed(1)),
      prevYtdKm: Number(prevYtdKm.toFixed(1)),
      hasPrevYearData,
      ytdDiffKm,
      ytdDiffPct
    };
  }, [sportFilteredRows]);

  // 4. Weekday & Intensity Consistency Heatmap (12 ISO weeks x 7 weekdays) + Compact Sport Split
  const consistencyModel = useMemo(() => {
    const todayYmd = formatUtcYmd(new Date());
    const anchorYmd =
      activePeriodOption && activePeriodOption.endYmd <= todayYmd
        ? activePeriodOption.endYmd
        : todayYmd;

    const endWeekKey = getIsoWeekInfo(anchorYmd).weekKey;
    const weekKeys: string[] = [];
    let wk = endWeekKey;
    for (let i = 0; i < 12; i++) {
      weekKeys.unshift(wk);
      wk = getPreviousWeekKey(wk);
    }

    const dayMap = new Map<string, { km: number; durationSec: number; count: number }>();
    const weekdayTotals = Array.from({ length: 7 }, (_, i) => ({
      dayIndex: i,
      label: WEEKDAY_NAMES_SHORT[i],
      km: 0,
      count: 0,
      durationSec: 0
    }));

    for (const r of sportFilteredRows) {
      if (!r.ymd) continue;
      const d = parseUtcNoon(r.ymd);
      const dayIdx = (d.getUTCDay() + 6) % 7; // 0=Mo..6=So
      const dist = Number(r.item.distanceKm || 0);
      const dur = Number(r.item.durationSec || 0);

      weekdayTotals[dayIdx].km += dist;
      weekdayTotals[dayIdx].count += 1;
      weekdayTotals[dayIdx].durationSec += dur;

      const cur = dayMap.get(r.ymd) || { km: 0, durationSec: 0, count: 0 };
      cur.km += dist;
      cur.durationSec += dur;
      cur.count += 1;
      dayMap.set(r.ymd, cur);
    }

    let maxCellKm = 1;
    const weekColumns = weekKeys.map((wKey) => {
      const monday = isoWeekKeyToMonday(wKey);
      const days = Array.from({ length: 7 }, (_, dIdx) => {
        const ymd = formatUtcYmd(new Date(monday.getTime() + dIdx * 86400000));
        const stats = dayMap.get(ymd) || { km: 0, durationSec: 0, count: 0 };
        if (stats.km > maxCellKm) maxCellKm = stats.km;
        return {
          ymd,
          dayIndex: dIdx,
          km: Number(stats.km.toFixed(1)),
          durationSec: stats.durationSec,
          count: stats.count,
          isFuture: ymd > todayYmd
        };
      });
      const m = wKey.match(/^(\d{4})-W(\d{2})$/);
      return {
        weekKey: wKey,
        shortLabel: m ? `${m[2]}` : wKey,
        fullLabel: m ? `KW ${m[2]}/${m[1].slice(2)}` : wKey,
        days
      };
    });

    const totalAllKm = weekdayTotals.reduce((s, w) => s + w.km, 0);
    const peakWeekday = [...weekdayTotals].sort((a, b) => b.km - a.km)[0];
    const peakSharePct =
      totalAllKm > 0 && peakWeekday ? Math.round((peakWeekday.km / totalAllKm) * 100) : 0;

    const sportSplit = [
      {
        label: 'Radfahren',
        km: periodStats.cyclingKm,
        count: periodStats.cyclingCount,
        color: '#2563eb'
      },
      {
        label: 'Laufen',
        km: periodStats.runningKm,
        count: periodStats.runningCount,
        color: '#f97316'
      },
      {
        label: 'Wandern & Sonst.',
        km: periodStats.otherKm,
        count: periodStats.otherCount,
        color: '#10b981'
      }
    ].filter((s) => s.km > 0 || s.count > 0);

    return {
      weekColumns,
      maxCellKm,
      weekdayTotals,
      peakWeekday,
      peakSharePct,
      sportSplit
    };
  }, [sportFilteredRows, activePeriodOption, periodStats]);

  // Apply interactive chart cross-filter to Activities Table
  const tableActivities = useMemo(() => {
    if (!chartFilter) return periodActivities;

    if (chartFilter.type === 'weekday') {
      return periodActivities.filter((it) => {
        const ymd = extractYmd(it.timestampIso);
        if (!ymd) return false;
        const dIdx = (parseUtcNoon(ymd).getUTCDay() + 6) % 7;
        return dIdx === chartFilter.dayIndex;
      });
    }

    if (chartFilter.type === 'week') {
      return sportFilteredRows
        .filter((r) => r.weekKey === chartFilter.weekKey)
        .map((r) => r.item);
    }

    if (chartFilter.type === 'date') {
      return sportFilteredRows
        .filter((r) => r.ymd === chartFilter.ymd)
        .map((r) => r.item);
    }

    return sportFilteredRows
      .filter((r) => r.item.key === chartFilter.key)
      .map((r) => r.item);
  }, [chartFilter, periodActivities, sportFilteredRows]);

  // Sorted activities table for the period (with optional chart cross-filter)
  const sortedPeriodActivities = useMemo(() => {
    const list = [...tableActivities];
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
  }, [tableActivities, tableSort]);

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
                const vam = periodStats.vam;
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

            {/* Smart Auto-Insights Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
              {/* Insight 1: ACWR / Form Status */}
              {(() => {
                const acwr = trainingLoadModel.acwr;
                const statusText =
                  acwr === null
                    ? 'Zu wenig Historie'
                    : acwr > 1.35
                    ? 'Hohe Aufbaulast'
                    : acwr >= 0.8
                    ? 'Optimaler Bereich'
                    : 'Erholungs-Phase';
                const statusColor =
                  acwr === null
                    ? 'text-slate-500'
                    : acwr > 1.35
                    ? 'text-amber-600 dark:text-amber-400'
                    : acwr >= 0.8
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-sky-600 dark:text-sky-400';
                return (
                  <div className="bg-white dark:bg-slate-900 px-4 py-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        <Activity className="w-3 h-3 text-indigo-500 shrink-0" />
                        <span>Load-Ratio (ACWR 7d/28d)</span>
                      </div>
                      <div className="text-base font-black font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                        {acwr !== null ? acwr.toFixed(2) : '—'}{' '}
                        <span className={`text-[11px] font-sans font-bold ${statusColor}`}>· {statusText}</span>
                      </div>
                    </div>
                    <div className="text-right font-mono text-[10px] text-slate-500 shrink-0">
                      <div>CTL {trainingLoadModel.latestCtl}</div>
                      <div>TSB {trainingLoadModel.latestTsb >= 0 ? `+${trainingLoadModel.latestTsb}` : trainingLoadModel.latestTsb}</div>
                    </div>
                  </div>
                );
              })()}

              {/* Insight 2: Aerobic Efficiency Trend */}
              <div className="bg-white dark:bg-slate-900 px-4 py-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <Heart className="w-3 h-3 text-rose-500 shrink-0" />
                    <span>Aerobe Effizienz (EF)</span>
                  </div>
                  <div className="text-base font-black font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                    {efficiencyModel.avgEf !== null ? `${efficiencyModel.avgEf.toFixed(2)}` : '—'}{' '}
                    <span className="text-[11px] font-sans font-semibold text-slate-400">m/min/bpm</span>
                  </div>
                </div>
                {efficiencyModel.efDeltaPct !== null ? (
                  <span
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono shrink-0 ${
                      efficiencyModel.efDeltaPct >= 0
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                    }`}
                  >
                    {efficiencyModel.efDeltaPct >= 0 ? `+${efficiencyModel.efDeltaPct}%` : `${efficiencyModel.efDeltaPct}%`}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400 font-mono shrink-0">{efficiencyModel.totalMatchedCount} HF</span>
                )}
              </div>

              {/* Insight 3: YoY YTD Delta */}
              <div className="bg-white dark:bg-slate-900 px-4 py-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-blue-500 shrink-0" />
                    <span>Jahres-Pace ({yoyModel.focusYear} YTD)</span>
                  </div>
                  <div className="text-base font-black font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                    {yoyModel.focusYtdKm.toLocaleString('de-DE')} km
                  </div>
                </div>
                {yoyModel.hasPrevYearData ? (
                  <span
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono shrink-0 ${
                      yoyModel.ytdDiffKm >= 0
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                    }`}
                  >
                    {yoyModel.ytdDiffKm >= 0 ? `+${yoyModel.ytdDiffKm}` : yoyModel.ytdDiffKm} km
                    {yoyModel.ytdDiffPct !== null ? ` (${yoyModel.ytdDiffPct >= 0 ? '+' : ''}${yoyModel.ytdDiffPct}%)` : ''}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400 shrink-0">vs. {yoyModel.prevYear}</span>
                )}
              </div>

              {/* Insight 4: Peak Training Weekday (clickable filter) */}
              <button
                type="button"
                onClick={() => {
                  if (!consistencyModel.peakWeekday || consistencyModel.peakWeekday.count === 0) return;
                  const p = consistencyModel.peakWeekday;
                  setChartFilter((prev) =>
                    prev?.type === 'weekday' && prev.dayIndex === p.dayIndex
                      ? null
                      : { type: 'weekday', dayIndex: p.dayIndex, label: `Wochentag ${p.label}` }
                  );
                }}
                className={`text-left bg-white dark:bg-slate-900 px-4 py-3 rounded-2xl border transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                  chartFilter?.type === 'weekday' && chartFilter.dayIndex === consistencyModel.peakWeekday?.dayIndex
                    ? 'border-blue-500 ring-1 ring-blue-500/30'
                    : 'border-slate-200/80 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700'
                }`}
                title="Klicken um Aktivitäten nach diesem Wochentag zu filtern"
              >
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />
                    <span>Stärkster Trainingstag</span>
                  </div>
                  <div className="text-base font-black font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                    {consistencyModel.peakWeekday && consistencyModel.peakWeekday.count > 0
                      ? `${consistencyModel.peakWeekday.label} · ${Math.round(consistencyModel.peakWeekday.km).toLocaleString('de-DE')} km`
                      : '—'}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-black font-mono bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 shrink-0">
                  {consistencyModel.peakSharePct}% Vol.
                </span>
              </button>
            </div>

            {/* Row 2: Rolling Training Load Curve (7 cols) + Aerobic Efficiency Scatter (5 cols) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left 7 cols: Rolling Training Load & Recovery Curve */}
              <div className="lg:col-span-7 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Belastung &amp; Erholung (7d Akut vs. 28d Fitness)</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Exponentielle Last-Kurven der letzten 16 Wochen mit Form-Index (TSB). Klick auf Woche filtert die Tabelle.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono font-bold shrink-0">
                    <span className="text-blue-600 dark:text-blue-400">CTL {trainingLoadModel.latestCtl}</span>
                    <span className="text-slate-300 dark:text-slate-700">|</span>
                    <span className="text-amber-600 dark:text-amber-400">ATL {trainingLoadModel.latestAtl}</span>
                    <span className="text-slate-300 dark:text-slate-700">|</span>
                    <span className={trainingLoadModel.latestTsb >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                      TSB {trainingLoadModel.latestTsb >= 0 ? `+${trainingLoadModel.latestTsb}` : trainingLoadModel.latestTsb}
                    </span>
                  </div>
                </div>

                <div className="h-72 w-full min-w-0">
                  {trainingLoadModel.weeks.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      Keine Garmin-Trainingsdaten für die Lastberechnung vorhanden.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={288} minWidth={0}>
                      <ComposedChart
                        data={trainingLoadModel.weeks}
                        onClick={(state: any) => {
                          const payload = state?.activePayload?.[0]?.payload;
                          if (payload?.weekKey) {
                            setChartFilter((prev) =>
                              prev?.type === 'week' && prev.weekKey === payload.weekKey
                                ? null
                                : { type: 'week', weekKey: payload.weekKey, label: `Trainingswoche ${payload.label}` }
                            );
                          }
                        }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                        <XAxis dataKey="label" stroke="#94a3b8" fontSize={10} />
                        <YAxis yAxisId="load" stroke="#6366f1" fontSize={10} width={38} />
                        <YAxis yAxisId="tsb" orientation="right" stroke="#10b981" fontSize={10} width={38} />
                        <ReferenceLine yAxisId="tsb" y={0} stroke="#64748b" strokeDasharray="3 3" strokeOpacity={0.6} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const pt = payload[0].payload;
                            return (
                              <div className="bg-slate-900/95 text-white p-3 rounded-xl border border-slate-700 shadow-xl text-xs space-y-1">
                                <div className="font-bold border-b border-slate-700 pb-1">
                                  {pt.label} · {pt.count} Einheiten ({pt.weeklyKm} km)
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px]">
                                  <span className="text-blue-300">28d Fitness (CTL):</span>
                                  <span className="text-right font-bold">{pt.ctl}</span>
                                  <span className="text-amber-300">7d Ermüdung (ATL):</span>
                                  <span className="text-right font-bold">{pt.atl}</span>
                                  <span className={pt.tsb >= 0 ? 'text-emerald-300' : 'text-rose-300'}>Form (TSB):</span>
                                  <span className="text-right font-bold">{pt.tsb >= 0 ? `+${pt.tsb}` : pt.tsb}</span>
                                  <span className="text-slate-300">Wochen-Last:</span>
                                  <span className="text-right font-bold">{pt.weeklyLoad}</span>
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        <Bar yAxisId="tsb" dataKey="tsb" name="Form-Balance (TSB)" radius={[3, 3, 0, 0]} cursor="pointer" isAnimationActive={false}>
                          {trainingLoadModel.weeks.map((entry) => {
                            const isFiltered = chartFilter?.type === 'week' && chartFilter.weekKey === entry.weekKey;
                            return (
                              <Cell
                                key={entry.weekKey}
                                fill={entry.tsb >= 0 ? '#10b981' : '#f43f5e'}
                                fillOpacity={isFiltered ? 0.95 : 0.35}
                              />
                            );
                          })}
                        </Bar>
                        <Line yAxisId="load" type="monotone" dataKey="ctl" name="28d Fitness (CTL)" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 2 }} isAnimationActive={false} />
                        <Line yAxisId="load" type="monotone" dataKey="atl" name="7d Akut (ATL)" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Right 5 cols: Aerobic Efficiency HR vs Speed Scatter */}
              <div className="lg:col-span-5 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5 text-rose-500" />
                      <span>Aerobe Effizienz (HF vs. Tempo)</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Punktgröße = Distanz. Klick auf Punkt isoliert die Einheit.
                    </p>
                  </div>

                  <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-[10px] font-bold shrink-0">
                    <button
                      type="button"
                      onClick={() => setEfficiencyScope('period')}
                      className={`px-2 py-1 rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                        efficiencyScope === 'period'
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      Zeitraum
                    </button>
                    <button
                      type="button"
                      onClick={() => setEfficiencyScope('all')}
                      className={`px-2 py-1 rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                        efficiencyScope === 'all'
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      Alle HF-Daten
                    </button>
                  </div>
                </div>

                <div className="h-72 w-full min-w-0">
                  {efficiencyModel.points.length < 2 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2 text-xs text-slate-400">
                      <Heart className="w-6 h-6 text-slate-300 dark:text-slate-600" />
                      <span>
                        Mindestens 2 Garmin-Aktivitäten mit Herzfrequenz im gewählten Umfang nötig.
                      </span>
                      {efficiencyScope === 'period' && (
                        <button
                          type="button"
                          onClick={() => setEfficiencyScope('all')}
                          className="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-[11px] cursor-pointer"
                        >
                          Gesamte Historie anzeigen
                        </button>
                      )}
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={288} minWidth={0}>
                      <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                        <XAxis type="number" dataKey="avgHr" name="Ø HF" unit=" bpm" domain={['dataMin - 5', 'dataMax + 5']} stroke="#94a3b8" fontSize={10} />
                        <YAxis type="number" dataKey="speedKmh" name="Ø Tempo" unit=" km/h" domain={['dataMin - 2', 'dataMax + 2']} stroke="#94a3b8" fontSize={10} />
                        <ZAxis type="number" dataKey="distanceKm" range={[45, 260]} name="Distanz" />
                        <Tooltip
                          cursor={{ strokeDasharray: '3 3' }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const pt = payload[0].payload;
                            return (
                              <div className="bg-slate-900/95 text-white p-3 rounded-xl border border-slate-700 shadow-xl text-xs space-y-1 max-w-[230px]">
                                <div className="font-bold truncate border-b border-slate-700 pb-1">{pt.name}</div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px]">
                                  <span className="text-slate-400">Datum:</span>
                                  <span className="text-right">{formatDeFullDate(pt.ymd)}</span>
                                  <span className="text-rose-300">Ø Puls:</span>
                                  <span className="text-right font-bold">{pt.avgHr} bpm</span>
                                  <span className="text-blue-300">Ø Tempo:</span>
                                  <span className="text-right font-bold">{pt.speedKmh} km/h</span>
                                  <span className="text-emerald-300">Distanz:</span>
                                  <span className="text-right font-bold">{pt.distanceKm} km</span>
                                  <span className="text-amber-300">EF-Index:</span>
                                  <span className="text-right font-bold">{pt.ef}</span>
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        {efficiencyModel.cyclingPoints.length > 0 && (
                          <Scatter
                            name="Radfahren"
                            data={efficiencyModel.cyclingPoints}
                            fill="#2563eb"
                            fillOpacity={0.78}
                            cursor="pointer"
                            isAnimationActive={false}
                            onClick={(node: any) => {
                              const p = node?.payload ?? node;
                              if (p?.key) {
                                setChartFilter((prev) =>
                                  prev?.type === 'activity' && prev.key === p.key
                                    ? null
                                    : { type: 'activity', key: p.key, label: p.name }
                                );
                              }
                            }}
                          />
                        )}
                        {efficiencyModel.runningPoints.length > 0 && (
                          <Scatter
                            name="Laufen"
                            data={efficiencyModel.runningPoints}
                            fill="#f97316"
                            fillOpacity={0.82}
                            cursor="pointer"
                            isAnimationActive={false}
                            onClick={(node: any) => {
                              const p = node?.payload ?? node;
                              if (p?.key) {
                                setChartFilter((prev) =>
                                  prev?.type === 'activity' && prev.key === p.key
                                    ? null
                                    : { type: 'activity', key: p.key, label: p.name }
                                );
                              }
                            }}
                          />
                        )}
                        {efficiencyModel.otherPoints.length > 0 && (
                          <Scatter
                            name="Sonstige"
                            data={efficiencyModel.otherPoints}
                            fill="#10b981"
                            fillOpacity={0.78}
                            cursor="pointer"
                            isAnimationActive={false}
                            onClick={(node: any) => {
                              const p = node?.payload ?? node;
                              if (p?.key) {
                                setChartFilter((prev) =>
                                  prev?.type === 'activity' && prev.key === p.key
                                    ? null
                                    : { type: 'activity', key: p.key, label: p.name }
                                );
                              }
                            }}
                          />
                        )}
                      </ScatterChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            {/* Row 3: Year-over-Year Cumulative Distance (6 cols) + 12-Week Consistency Heatmap & Sport Split (6 cols) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left 6 cols: Year-over-Year Cumulative Distance Overlay */}
              <div className="lg:col-span-6 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-blue-500" />
                      <span>Jahres-Overlay (Kumulierte km Jan–Dez)</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Saisonaler Volumen-Vergleich zwischen deinen letzten Kalenderjahren.
                    </p>
                  </div>
                  {yoyModel.hasPrevYearData && (
                    <div className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-200 shrink-0">
                      {yoyModel.focusYear}: {yoyModel.focusYtdKm.toLocaleString('de-DE')} vs. {yoyModel.prevYear}: {yoyModel.prevYtdKm.toLocaleString('de-DE')} km
                    </div>
                  )}
                </div>

                <div className="h-64 w-full min-w-0">
                  {yoyModel.years.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      Keine Jahresdaten vorhanden.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={256} minWidth={0}>
                      <LineChart data={yoyModel.series}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                        <XAxis dataKey="month" stroke="#94a3b8" fontSize={10} />
                        <YAxis stroke="#94a3b8" fontSize={10} unit=" km" width={52} />
                        <Tooltip
                          contentStyle={{ borderRadius: '12px', fontSize: '11px', backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc' }}
                          formatter={(val: any, name: any) => [`${Number(val).toLocaleString('de-DE')} km`, String(name)]}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        {yoyModel.years.map((yr, idx) => {
                          const palette = ['#2563eb', '#f59e0b', '#10b981', '#8b5cf6'];
                          return (
                            <Line
                              key={yr}
                              type="monotone"
                              dataKey={yr}
                              name={yr}
                              stroke={palette[idx % palette.length]}
                              strokeWidth={idx === 0 ? 3 : 2}
                              strokeDasharray={idx >= 2 ? '4 3' : undefined}
                              dot={idx === 0 ? { r: 2.5 } : false}
                              connectNulls={false}
                              isAnimationActive={false}
                            />
                          );
                        })}
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Right 6 cols: Weekday & Intensity Consistency Heatmap + Compact Sport Split */}
              <div className="lg:col-span-6 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-4 min-w-0 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-emerald-500" />
                        <span>12-Wochen Konsistenz-Matrix</span>
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Klick auf Wochentag (Mo–So), KW oder Tag filtert die Aktivitäten-Tabelle.
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 shrink-0">
                      <span>Weniger</span>
                      <span className="w-2.5 h-2.5 rounded-xs bg-slate-100 dark:bg-slate-800" />
                      <span className="w-2.5 h-2.5 rounded-xs bg-emerald-200 dark:bg-emerald-900/70" />
                      <span className="w-2.5 h-2.5 rounded-xs bg-emerald-400 dark:bg-emerald-700" />
                      <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 dark:bg-emerald-500" />
                      <span>Mehr</span>
                    </div>
                  </div>

                  {/* Heatmap Matrix: 12 columns (weeks) + left weekday labels */}
                  <div className="overflow-x-auto">
                    <div className="min-w-[380px] space-y-1">
                      {/* Header Row: Week Numbers */}
                      <div className="grid grid-cols-[28px_repeat(12,minmax(0,1fr))] gap-1 items-center">
                        <div />
                        {consistencyModel.weekColumns.map((col) => {
                          const isSelectedWeek = chartFilter?.type === 'week' && chartFilter.weekKey === col.weekKey;
                          return (
                            <button
                              key={col.weekKey}
                              type="button"
                              onClick={() =>
                                setChartFilter((prev) =>
                                  prev?.type === 'week' && prev.weekKey === col.weekKey
                                    ? null
                                    : { type: 'week', weekKey: col.weekKey, label: col.fullLabel }
                                )
                              }
                              className={`text-[9px] font-mono font-bold text-center py-0.5 rounded-xs cursor-pointer transition-colors ${
                                isSelectedWeek
                                  ? 'bg-blue-600 text-white'
                                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                              }`}
                              title={`${col.fullLabel} filtern`}
                            >
                              {col.shortLabel}
                            </button>
                          );
                        })}
                      </div>

                      {/* 7 Weekday Rows */}
                      {WEEKDAY_NAMES_SHORT.map((dayName, dayIdx) => {
                        const isSelectedDayName = chartFilter?.type === 'weekday' && chartFilter.dayIndex === dayIdx;
                        return (
                          <div key={dayName} className="grid grid-cols-[28px_repeat(12,minmax(0,1fr))] gap-1 items-center">
                            <button
                              type="button"
                              onClick={() =>
                                setChartFilter((prev) =>
                                  prev?.type === 'weekday' && prev.dayIndex === dayIdx
                                    ? null
                                    : { type: 'weekday', dayIndex: dayIdx, label: `Wochentag ${dayName}` }
                                )
                              }
                              className={`text-[10px] font-bold text-left px-1 py-0.5 rounded-xs cursor-pointer transition-colors ${
                                isSelectedDayName
                                  ? 'bg-blue-600 text-white'
                                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                              }`}
                              title={`Alle ${dayName}-Aktivitäten im Zeitraum filtern`}
                            >
                              {dayName}
                            </button>

                            {consistencyModel.weekColumns.map((col) => {
                              const cell = col.days[dayIdx];
                              const ratio = cell.km > 0 ? cell.km / consistencyModel.maxCellKm : 0;
                              const isSelectedDate = chartFilter?.type === 'date' && chartFilter.ymd === cell.ymd;
                              const colorClass = cell.isFuture
                                ? 'bg-transparent border border-dashed border-slate-200 dark:border-slate-800 opacity-40'
                                : cell.count === 0
                                ? 'bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700'
                                : ratio > 0.66
                                ? 'bg-emerald-600 dark:bg-emerald-500 text-white'
                                : ratio > 0.33
                                ? 'bg-emerald-400 dark:bg-emerald-600 text-white'
                                : 'bg-emerald-200 dark:bg-emerald-900/70 text-emerald-900 dark:text-emerald-100';

                              return (
                                <button
                                  key={cell.ymd}
                                  type="button"
                                  disabled={cell.isFuture || cell.count === 0}
                                  onClick={() => {
                                    if (cell.count === 0) return;
                                    setChartFilter((prev) =>
                                      prev?.type === 'date' && prev.ymd === cell.ymd
                                        ? null
                                        : { type: 'date', ymd: cell.ymd, label: formatDeFullDate(cell.ymd) }
                                    );
                                  }}
                                  title={
                                    cell.count > 0
                                      ? `${formatDeFullDate(cell.ymd)}: ${cell.count} Einh. · ${cell.km} km`
                                      : `${formatDeFullDate(cell.ymd)}: Ruhetag`
                                  }
                                  className={`h-5 rounded-sm transition-all ${colorClass} ${
                                    cell.count > 0 ? 'cursor-pointer' : 'cursor-default'
                                  } ${isSelectedDate ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900' : ''}`}
                                />
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Compact Sport Split Bar inside right card */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold uppercase tracking-wider text-slate-400">
                      Sportarten-Verteilung ({activePeriodOption?.shortLabel})
                    </span>
                    <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                      {periodStats.totalKm.toLocaleString('de-DE')} km gesamt
                    </span>
                  </div>
                  {consistencyModel.sportSplit.length === 0 ? (
                    <div className="text-xs text-slate-400">Keine Sportdaten im gewählten Zeitraum.</div>
                  ) : (
                    <>
                      <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                        {consistencyModel.sportSplit.map((s) => {
                          const wPct = periodStats.totalKm > 0 ? (s.km / periodStats.totalKm) * 100 : 0;
                          return (
                            <div
                              key={s.label}
                              style={{ width: `${Math.max(2, wPct)}%`, backgroundColor: s.color }}
                              title={`${s.label}: ${s.km.toFixed(1)} km (${s.count}x)`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                        {consistencyModel.sportSplit.map((s) => (
                          <span key={s.label} className="inline-flex items-center gap-1.5 font-mono text-slate-600 dark:text-slate-300">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                            <span className="font-sans font-semibold">{s.label}:</span>
                            <span className="font-bold text-slate-900 dark:text-white">{s.km.toFixed(1)} km</span>
                            <span className="text-slate-400">({s.count}x)</span>
                          </span>
                        ))}
                      </div>
                    </>
                  )}
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
                <div className="flex flex-wrap items-center gap-2.5">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Aktivitäten im Zeitraum ({sortedPeriodActivities.length})
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      {activePeriodOption?.label}
                    </p>
                  </div>

                  {chartFilter && (
                    <button
                      type="button"
                      onClick={() => setChartFilter(null)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-[11px] font-bold cursor-pointer transition-colors whitespace-nowrap"
                      title="Diagramm-Filter aufheben"
                    >
                      <Filter className="w-3 h-3" />
                      <span>Filter: {chartFilter.label}</span>
                      <X className="w-3 h-3" />
                    </button>
                  )}
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
                <div className="p-10 text-center text-xs text-slate-400 space-y-2">
                  <div>
                    {chartFilter
                      ? 'Keine Aktivitäten für den aktiven Diagramm-Filter im Zeitraum gefunden.'
                      : 'In diesem Zeitraum liegen für den gewählten Filter keine Aktivitäten vor. Wähle über das Dropdown eine andere Woche, einen anderen Monat oder ein anderes Jahr.'}
                  </div>
                  {chartFilter && (
                    <button
                      type="button"
                      onClick={() => setChartFilter(null)}
                      className="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-[11px] cursor-pointer"
                    >
                      Diagramm-Filter aufheben
                    </button>
                  )}
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
