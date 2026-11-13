import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Database, AlertCircle, CheckCircle, RefreshCw, Trash2, 
  Heart, Moon, Sparkles, Footprints, Flame, TrendingUp, Info,
  Zap, Key, Activity, Calendar, BarChart2, ShieldCheck,
  Trophy, Award, Timer, Mountain, ArrowUpRight, Sliders
} from 'lucide-react';
import { 
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, 
  Tooltip, CartesianGrid, AreaChart, Area, ScatterChart, Scatter, ZAxis, Legend,
  ComposedChart, ReferenceLine, PieChart, Pie, Cell, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from 'recharts';
import { getApiUrl, apiFetch } from '../utils/api';
import { resolveGarminTrackForMap } from '../utils/garminClient';
import FitnessPerformanceAnalysis from './FitnessPerformanceAnalysis';
import { GarminPersonalApiPanel } from './GarminPersonalApiPanel';
import { GarminActivitiesAnalysis } from './GarminActivitiesAnalysis';

export type GarminDashboardTab =
  | 'overview'
  | 'performance'
  | 'records'
  | 'calendar'
  | 'compare'
  | 'activities'
  | 'analytics'
  | 'sleep'
  | 'rhr'
  | 'steps'
  | 'stress'
  | 'personal-api';

interface GarminDashboardProps {
  onClose?: () => void;
  onLoadTrack?: (track: any) => void;
  onDataSynced?: () => void;
  onTabChange?: (tab: GarminDashboardTab) => void;
  initialTab?: GarminDashboardTab;
  variant?: 'modal' | 'page';
  userWeight?: number;
  userAge?: number;
  userMaxHr?: number;
  ftp?: number;
  onUpdateFtp?: (ftp: number) => void;
  onUpdateMaxHr?: (maxHr: number) => void;
  onUpdateWeight?: (weight: number) => void;
  onUpdateAge?: (age: number) => void;
}

interface SleepRecord {
  date: string;
  duration: number; // minutes
  deep?: number;
  light?: number;
  rem?: number;
  awake?: number;
}

interface WeightRecord {
  date: string;
  weight: number;
  bmi?: number;
  body_fat?: number;
}

interface StressRecord {
  date: string;
  avg_stress: number;
}

interface RhrRecord {
  date: string;
  rhr: number;
}

interface StepsRecord {
  date: string;
  steps: number;
  calories?: number;
  distance?: number;
}

interface GarminActivity {
  id: string;
  name: string;
  type: string;
  date: string;
  distance: number;
  duration: number;
  ascent?: number;
  descent?: number;
  calories?: number;
  avg_hr?: number;
  points_json?: string;
  description?: string;
  location?: string;
}

interface HealthData {
  sleep: SleepRecord[];
  weight: WeightRecord[];
  stress: StressRecord[];
  rhr: RhrRecord[];
  steps: StepsRecord[];
  activities: GarminActivity[];
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

function clampScore(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

function normalizeDateKey(raw: string | undefined): string {
  if (!raw) return '';
  const m = String(raw).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(raw).slice(0, 10);
}

function filterByRange<T extends { date: string }>(items: T[], range: 14 | 30 | 90 | 365 | 'all'): T[] {
  if (items.length === 0 || range === 'all') return items;
  const latestKey = normalizeDateKey(items[items.length - 1].date);
  const latestMs = new Date(`${latestKey}T12:00:00Z`).getTime();
  if (!Number.isFinite(latestMs)) return items.slice(-range);
  const cutoffMs = latestMs - (range - 1) * 86400000;
  return items.filter((item) => {
    const ms = new Date(`${normalizeDateKey(item.date)}T12:00:00Z`).getTime();
    return Number.isFinite(ms) ? ms >= cutoffMs : true;
  });
}

function addRollingAverage<T extends Record<string, any>>(
  items: T[],
  valueKey: keyof T,
  outKey: string,
  windowSize = 7
): Array<T & Record<string, number>> {
  return items.map((item, idx) => {
    const start = Math.max(0, idx - windowSize + 1);
    let sum = 0;
    let count = 0;
    for (let j = start; j <= idx; j++) {
      const val = Number(items[j][valueKey]);
      if (Number.isFinite(val)) {
        sum += val;
        count++;
      }
    }
    return {
      ...item,
      [outKey]: count > 0 ? Number((sum / count).toFixed(1)) : 0
    };
  });
}

function isStrictCyclingActivity(act: GarminActivity): boolean {
  const t = (act.type || '').toLowerCase();
  const n = (act.name || '').toLowerCase();
  if (t.includes('stop_watch') || t.includes('strength') || t.includes('rowing') || t.includes('swim') || t.includes('soccer')) {
    return false;
  }
  return (
    t.includes('cycle') ||
    t.includes('cycling') ||
    t.includes('bike') ||
    t.includes('biking') ||
    t.includes('virtual_ride') ||
    t.includes('spin') ||
    n.includes('radfahrt') ||
    n.includes('fahrrad') ||
    n.includes('cycling') ||
    n.includes('biking') ||
    n.includes('gravel') ||
    n.includes('mtb')
  );
}

function isStrictRunningActivity(act: GarminActivity): boolean {
  const t = (act.type || '').toLowerCase();
  const n = (act.name || '').toLowerCase();
  if (
    t.includes('walk') ||
    t.includes('hike') ||
    t.includes('stop_watch') ||
    t.includes('strength') ||
    t.includes('soccer') ||
    t.includes('rowing') ||
    t.includes('swim')
  ) {
    return false;
  }
  return (
    t.includes('run') ||
    t.includes('laufen') ||
    t.includes('jog') ||
    (t === 'other' && (n.includes('lauf') || n.includes('run') || n.includes('jog')))
  );
}

function formatPaceMinKm(distanceKm: number, durationSec: number): string {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(durationSec) || durationSec <= 0) {
    return '-';
  }
  const paceMin = durationSec / 60 / distanceKm;
  let mins = Math.floor(paceMin);
  let secs = Math.round((paceMin - mins) * 60);
  if (secs === 60) {
    mins += 1;
    secs = 0;
  }
  return `${mins}:${secs.toString().padStart(2, '0')} /km`;
}

function formatDurationHhMm(durationSec: number): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return '-';
  const totalSecs = Math.round(durationSec);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
  }
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

export const GarminDashboard: React.FC<GarminDashboardProps> = ({ 
  onClose, 
  onLoadTrack,
  onDataSynced,
  onTabChange,
  initialTab = 'overview',
  variant = 'modal',
  userWeight = 75,
  userAge = 35,
  userMaxHr = 185,
  ftp = 250,
  onUpdateFtp,
  onUpdateMaxHr,
  onUpdateWeight,
  onUpdateAge
}) => {
  const [data, setData] = useState<HealthData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<React.ReactNode | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<GarminDashboardTab>(initialTab);
  const [activitySearchQuery, setActivitySearchQuery] = useState('');
  const [activitiesVisibleCount, setActivitiesVisibleCount] = useState(100);

  useEffect(() => {
    setActivitiesVisibleCount(100);
  }, [activitySearchQuery]);

  const handleSelectTab = (tab: GarminDashboardTab) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);
  const [selectedCorrelation, setSelectedCorrelation] = useState<'hr_speed' | 'speed_ascent' | 'hr_ascent'>('hr_speed');
  const [healthRangeDays, setHealthRangeDays] = useState<14 | 30 | 90 | 365 | 'all'>(30);
  const [heatmapMetric, setHeatmapMetric] = useState<'distance' | 'duration' | 'ascent' | 'steps'>('distance');
  const [recordsSportFilter, setRecordsSportFilter] = useState<'all' | 'cycling' | 'running'>('all');
  const [recordsYearFilter, setRecordsYearFilter] = useState<string>('all');
  const [showAthleteSettings, setShowAthleteSettings] = useState(false);

  const activityPoints = useMemo(() => {
    return analyticsData?.activityCorrelations?.points || [];
  }, [analyticsData]);

  const correlationDetails = useMemo(() => {
    const corr = analyticsData?.activityCorrelations || {};
    switch (selectedCorrelation) {
      case 'hr_speed':
        return {
          r: corr.hrSpeed ?? 0,
          xKey: 'speedKmh',
          yKey: 'avgHr',
          xLabel: 'Geschwindigkeit (km/h)',
          yLabel: 'Durchschnittspuls (bpm)',
          title: 'Herzfrequenz vs. Geschwindigkeit',
          desc: 'Diese Analyse zeigt, wie deine Herzfrequenz auf unterschiedliche Geschwindigkeiten reagiert. Bei gutem Trainingszustand (aerobe Kapazität) bleibt die Herzfrequenz bei tempo- und ausdauerintensiven Läufen niedriger.'
        };
      case 'speed_ascent':
        return {
          r: corr.speedAscent ?? 0,
          xKey: 'ascent',
          yKey: 'speedKmh',
          xLabel: 'Höhenmeter (m)',
          yLabel: 'Geschwindigkeit (km/h)',
          title: 'Geschwindigkeit vs. Höhenmeter',
          desc: 'Zeigt den Einfluss von Steigungen auf deine Durchschnittsgeschwindigkeit. Mehr Höhenmeter bedeuten typischerweise ein geringeres Gesamttempo durch die zusätzliche Hubarbeit.'
        };
      case 'hr_ascent':
        return {
          r: corr.hrAscent ?? 0,
          xKey: 'ascent',
          yKey: 'avgHr',
          xLabel: 'Höhenmeter (m)',
          yLabel: 'Durchschnittspuls (bpm)',
          title: 'Herzfrequenz vs. Höhenmeter',
          desc: 'Untersucht, ob anspruchsvolle Anstiege mit einem höheren durchschnittlichen Puls einhergehen. Hügelige Strecken fordern Herz und Kreislauf intensiver.'
        };
    }
  }, [selectedCorrelation, analyticsData]);

  const chartData = useMemo(() => {
    const pts = activityPoints;
    if (selectedCorrelation === 'hr_speed' || selectedCorrelation === 'hr_ascent') {
      return pts.filter((p: any) => p.avgHr !== undefined);
    }
    return pts;
  }, [activityPoints, selectedCorrelation]);

  const chartGroupedData = useMemo(() => {
    const pts = chartData;
    const running = pts.filter((pt: any) => {
      const t = pt.type ? pt.type.toLowerCase() : 'other';
      return t.includes('run') || t === 'running';
    });
    const cycling = pts.filter((pt: any) => {
      const t = pt.type ? pt.type.toLowerCase() : 'other';
      return t.includes('cycle') || t.includes('bike') || t === 'cycling';
    });
    const other = pts.filter((pt: any) => {
      const t = pt.type ? pt.type.toLowerCase() : 'other';
      return !t.includes('run') && t !== 'running' && !t.includes('cycle') && !t.includes('bike') && t !== 'cycling';
    });
    return { running, cycling, other };
  }, [chartData]);

  const rhrData = useMemo(() => {
    if (!Array.isArray(data?.rhr)) return [];
    const sorted = data.rhr
      .map((d: any) => ({
        date: normalizeDateKey(d?.date),
        rhr: Number(d?.rhr)
      }))
      .filter((d) => Boolean(d.date) && Number.isFinite(d.rhr) && d.rhr > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    return addRollingAverage(sorted, 'rhr', 'rhr7dAvg', 7);
  }, [data?.rhr]);

  const stepsData = useMemo(() => {
    if (!Array.isArray(data?.steps)) return [];
    const sorted = data.steps
      .map((d: any) => {
        const steps = Number(d?.steps);
        const caloriesRaw = d?.calories !== undefined && d?.calories !== null ? Number(d.calories) : undefined;
        return {
          date: normalizeDateKey(d?.date),
          steps,
          calories: caloriesRaw !== undefined && Number.isFinite(caloriesRaw) && caloriesRaw >= 0 ? caloriesRaw : undefined
        };
      })
      .filter((d) => Boolean(d.date) && Number.isFinite(d.steps) && d.steps >= 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    return addRollingAverage(sorted, 'steps', 'steps7dAvg', 7);
  }, [data?.steps]);

  const stressData = useMemo(() => {
    if (!Array.isArray(data?.stress)) return [];
    const sorted = data.stress
      .map((d: any) => ({
        date: normalizeDateKey(d?.date),
        avg_stress: Number(d?.avg_stress ?? d?.averageStressLevel ?? d?.stressLevel)
      }))
      .filter((d) => Boolean(d.date) && Number.isFinite(d.avg_stress) && d.avg_stress >= 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    return addRollingAverage(sorted, 'avg_stress', 'stress7dAvg', 7);
  }, [data?.stress]);

  const sleepData = useMemo(() => {
    if (!Array.isArray(data?.sleep)) return [];
    const sorted = data.sleep
      .map((d: any) => {
        const duration = Math.max(0, Number(d?.duration || 0));
        const deep = Math.max(0, Number(d?.deep || 0));
        const rem = Math.max(0, Number(d?.rem || 0));
        const light = Math.max(0, Number(d?.light || 0));
        const awake = Math.max(0, Number(d?.awake || 0));
        const totalWithAwake = duration + awake;
        const efficiencyPct = totalWithAwake > 0 ? Math.round((duration / totalWithAwake) * 100) : 100;
        return {
          date: normalizeDateKey(d?.date),
          duration,
          deep,
          rem,
          light,
          awake,
          efficiencyPct
        };
      })
      .filter((d) => Boolean(d.date) && Number.isFinite(d.duration) && d.duration > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    return addRollingAverage(sorted, 'duration', 'sleep7dAvg', 7);
  }, [data?.sleep]);

  const visibleRhrData = useMemo(() => filterByRange(rhrData, healthRangeDays), [rhrData, healthRangeDays]);
  const visibleStepsData = useMemo(() => filterByRange(stepsData, healthRangeDays), [stepsData, healthRangeDays]);
  const visibleStressData = useMemo(() => filterByRange(stressData, healthRangeDays), [stressData, healthRangeDays]);
  const visibleSleepData = useMemo(() => filterByRange(sleepData, healthRangeDays), [sleepData, healthRangeDays]);

  // 14-day Readiness & Recovery Balance
  const readinessSummary = useMemo(() => {
    const rhrMap = new Map(rhrData.map((d) => [d.date, d.rhr]));
    const sleepMap = new Map(sleepData.map((d) => [d.date, d]));
    const stressMap = new Map(stressData.map((d) => [d.date, d.avg_stress]));

    const allDates = Array.from(new Set([...rhrMap.keys(), ...sleepMap.keys(), ...stressMap.keys()])).sort();
    if (allDates.length === 0) {
      return { latestScore: null as number | null, label: 'Keine Daten', tone: 'slate' as const, series: [] as any[], baselineRhr: null as number | null };
    }

    const rhrRecent30 = rhrData.slice(-30);
    const baselineRhr = rhrRecent30.length > 0
      ? rhrRecent30.reduce((sum, r) => sum + r.rhr, 0) / rhrRecent30.length
      : null;

    const recentDates = allDates.slice(-14);
    const series = recentDates.map((date) => {
      const dayRhr = rhrMap.get(date);
      const daySleep = sleepMap.get(date);
      const dayStress = stressMap.get(date);

      const components: Array<{ score: number; weight: number }> = [];
      if (dayRhr !== undefined && baselineRhr !== null) {
        const rhrScore = clampScore(78 + (baselineRhr - dayRhr) * 4.5, 25, 100);
        components.push({ score: rhrScore, weight: 0.35 });
      }
      if (daySleep && daySleep.duration > 0) {
        const durScore = Math.min(70, (daySleep.duration / 480) * 70);
        const qualityRatio = (daySleep.deep + daySleep.rem) / Math.max(1, daySleep.duration);
        const qualScore = Math.min(30, qualityRatio * 68);
        components.push({ score: clampScore(durScore + qualScore, 20, 100), weight: 0.4 });
      }
      if (dayStress !== undefined) {
        components.push({ score: clampScore(100 - dayStress * 0.9, 15, 100), weight: 0.25 });
      }

      const totalWeight = components.reduce((s, c) => s + c.weight, 0);
      const readiness = totalWeight > 0
        ? clampScore(components.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight)
        : 0;

      return {
        date,
        shortDate: date.slice(5),
        readiness,
        rhr: dayRhr ?? null,
        stress: dayStress ?? null,
        sleepHours: daySleep ? Number((daySleep.duration / 60).toFixed(1)) : null
      };
    });

    const validSeries = series.filter((s) => s.readiness > 0);
    const latestScore = validSeries.length > 0 ? validSeries[validSeries.length - 1].readiness : null;
    let label = 'Ausgeglichen — moderates Training ideal';
    let tone: 'emerald' | 'amber' | 'rose' | 'slate' = 'amber';
    if (latestScore !== null) {
      if (latestScore >= 78) {
        label = 'Top erholt — bereit für intensive Belastung';
        tone = 'emerald';
      } else if (latestScore >= 58) {
        label = 'Ausgeglichen — Grundlage & Tempo geeignet';
        tone = 'amber';
      } else {
        label = 'Erhöhte Belastung — Regeneration priorisieren';
        tone = 'rose';
      }
    } else {
      label = 'Nicht genügend Daten';
      tone = 'slate';
    }

    return { latestScore, label, tone, series, baselineRhr: baselineRhr ? Math.round(baselineRhr) : null };
  }, [rhrData, sleepData, stressData]);

  // 365-Day Activity & Consistency Heatmap
  const yearlyHeatmapData = useMemo(() => {
    const acts = data?.activities || [];
    const stepsMap = new Map(stepsData.map((s) => [s.date, s.steps]));
    const dayMap = new Map<string, { distance: number; durationMin: number; ascent: number; steps: number; count: number; names: string[] }>();

    let latestMs = Date.now();
    for (const act of acts) {
      const ymd = normalizeDateKey(act.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
      const ms = new Date(`${ymd}T12:00:00Z`).getTime();
      if (Number.isFinite(ms) && ms > latestMs) latestMs = ms;
      const cur = dayMap.get(ymd) || { distance: 0, durationMin: 0, ascent: 0, steps: stepsMap.get(ymd) || 0, count: 0, names: [] };
      cur.distance += Number(act.distance || 0);
      cur.durationMin += Math.round(Number(act.duration || 0) / 60);
      cur.ascent += Math.round(Number(act.ascent || 0));
      cur.count += 1;
      if (act.name && cur.names.length < 3) cur.names.push(act.name);
      dayMap.set(ymd, cur);
    }

    for (const [ymd, steps] of stepsMap.entries()) {
      if (!dayMap.has(ymd)) {
        dayMap.set(ymd, { distance: 0, durationMin: 0, ascent: 0, steps, count: 0, names: [] });
      }
    }

    // Align grid end to Sunday of the week containing latestDate, covering 52 weeks (364 days)
    const anchorDate = new Date(latestMs);
    const utcDay = anchorDate.getUTCDay(); // 0=Sun..6=Sat
    const daysUntilSunday = utcDay === 0 ? 0 : 7 - utcDay;
    const gridEndMs = latestMs + daysUntilSunday * 86400000;
    const totalCells = 52 * 7;
    const gridStartMs = gridEndMs - (totalCells - 1) * 86400000;

    const cells: Array<{
      date: string;
      weekIndex: number;
      dayOfWeek: number;
      value: number;
      distance: number;
      durationMin: number;
      ascent: number;
      steps: number;
      count: number;
      names: string[];
    }> = [];

    let maxVal = 0;
    let activeDays = 0;
    let totalDistance = 0;
    let totalAscent = 0;
    let currentStreak = 0;
    let longestStreak = 0;

    for (let i = 0; i < totalCells; i++) {
      const cellDate = new Date(gridStartMs + i * 86400000);
      const ymd = cellDate.toISOString().slice(0, 10);
      const entry = dayMap.get(ymd);
      const distance = entry ? Number(entry.distance.toFixed(1)) : 0;
      const durationMin = entry ? entry.durationMin : 0;
      const ascent = entry ? entry.ascent : 0;
      const steps = entry ? entry.steps : 0;
      const count = entry ? entry.count : 0;
      const value =
        heatmapMetric === 'distance'
          ? distance
          : heatmapMetric === 'duration'
          ? durationMin
          : heatmapMetric === 'ascent'
          ? ascent
          : steps;

      if (value > maxVal) maxVal = value;
      if (count > 0 || (heatmapMetric === 'steps' && steps >= 5000)) {
        activeDays++;
        currentStreak++;
        if (currentStreak > longestStreak) longestStreak = currentStreak;
      } else if (i < totalCells - daysUntilSunday) {
        currentStreak = 0;
      }
      totalDistance += distance;
      totalAscent += ascent;

      cells.push({
        date: ymd,
        weekIndex: Math.floor(i / 7),
        dayOfWeek: i % 7,
        value,
        distance,
        durationMin,
        ascent,
        steps,
        count,
        names: entry?.names || []
      });
    }

    const weeks: typeof cells[] = [];
    for (let w = 0; w < 52; w++) {
      weeks.push(cells.slice(w * 7, (w + 1) * 7));
    }

    return { weeks, maxVal, activeDays, longestStreak, totalDistance: Math.round(totalDistance), totalAscent };
  }, [data?.activities, stepsData, heatmapMetric]);

  // Monthly Training Volume & Elevation by Sport
  const monthlyVolumeData = useMemo(() => {
    const acts = data?.activities || [];
    if (acts.length === 0) return [];
    const byMonth = new Map<string, { month: string; label: string; cyclingKm: number; runningKm: number; otherKm: number; ascentM: number; count: number }>();

    for (const act of acts) {
      const ymd = normalizeDateKey(act.date);
      if (!/^\d{4}-\d{2}/.test(ymd)) continue;
      const month = ymd.slice(0, 7);
      const cur = byMonth.get(month) || {
        month,
        label: `${month.slice(5)}/${month.slice(2, 4)}`,
        cyclingKm: 0,
        runningKm: 0,
        otherKm: 0,
        ascentM: 0,
        count: 0
      };
      const dist = Number(act.distance || 0);
      if (isCyclingType(act.type, act.name)) {
        cur.cyclingKm += dist;
      } else if (isRunningType(act.type, act.name)) {
        cur.runningKm += dist;
      } else {
        cur.otherKm += dist;
      }
      cur.ascentM += Math.round(Number(act.ascent || 0));
      cur.count += 1;
      byMonth.set(month, cur);
    }

    return Array.from(byMonth.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12)
      .map((m) => ({
        ...m,
        cyclingKm: Number(m.cyclingKm.toFixed(1)),
        runningKm: Number(m.runningKm.toFixed(1)),
        otherKm: Number(m.otherKm.toFixed(1)),
        totalKm: Number((m.cyclingKm + m.runningKm + m.otherKm).toFixed(1))
      }));
  }, [data?.activities]);

  // Sleep Architecture Donut Breakdown
  const sleepArchitectureData = useMemo(() => {
    if (visibleSleepData.length === 0) return [];
    const n = visibleSleepData.length;
    const avgDeep = visibleSleepData.reduce((s, d) => s + d.deep, 0) / n;
    const avgRem = visibleSleepData.reduce((s, d) => s + d.rem, 0) / n;
    const avgLight = visibleSleepData.reduce((s, d) => s + d.light, 0) / n;
    const avgAwake = visibleSleepData.reduce((s, d) => s + d.awake, 0) / n;
    const total = avgDeep + avgRem + avgLight + avgAwake;
    if (total <= 0) return [];
    return [
      { name: 'Tiefschlaf', value: Math.round(avgDeep), pct: Math.round((avgDeep / total) * 100), color: '#1e40af', target: 'Ziel: 15–25%' },
      { name: 'REM', value: Math.round(avgRem), pct: Math.round((avgRem / total) * 100), color: '#8b5cf6', target: 'Ziel: 20–25%' },
      { name: 'Leichtschlaf', value: Math.round(avgLight), pct: Math.round((avgLight / total) * 100), color: '#3b82f6', target: 'Basisphase' },
      { name: 'Wach', value: Math.round(avgAwake), pct: Math.round((avgAwake / total) * 100), color: '#f59e0b', target: 'Ziel: < 5%' }
    ].filter((seg) => seg.value > 0);
  }, [visibleSleepData]);

  // 5-Axis Athlete Radar (Last 30 days vs Overall Baseline)
  const athleteRadarData = useMemo(() => {
    const acts = data?.activities || [];
    if (acts.length === 0 && sleepData.length === 0 && rhrData.length === 0 && stepsData.length === 0) {
      return [];
    }

    const computeAxes = (actSlice: GarminActivity[], sleepSlice: typeof sleepData, rhrSlice: typeof rhrData, stepsSlice: typeof stepsData, stressSlice: typeof stressData) => {
      const totalDist = actSlice.reduce((s, a) => s + Number(a.distance || 0), 0);
      const totalAscent = actSlice.reduce((s, a) => s + Number(a.ascent || 0), 0);
      const daysSpan = Math.max(7, sleepSlice.length || stepsSlice.length || 30);
      const weeklyKm = (totalDist / daysSpan) * 7;
      const volumeScore = clampScore((weeklyKm / 80) * 100);
      const climbPerKm = totalDist > 0 ? totalAscent / totalDist : 0;
      const climbScore = clampScore((climbPerKm / 20) * 100);

      const meanRhr = rhrSlice.length > 0 ? rhrSlice.reduce((s, r) => s + r.rhr, 0) / rhrSlice.length : 60;
      const cardioScore = clampScore(125 - meanRhr * 1.15);

      const meanSleep = sleepSlice.length > 0 ? sleepSlice.reduce((s, d) => s + d.duration, 0) / sleepSlice.length : 420;
      const sleepScore = clampScore((meanSleep / 480) * 90);

      const meanSteps = stepsSlice.length > 0 ? stepsSlice.reduce((s, d) => s + d.steps, 0) / stepsSlice.length : 6000;
      const meanStress = stressSlice.length > 0 ? stressSlice.reduce((s, d) => s + d.avg_stress, 0) / stressSlice.length : 35;
      const resilienceScore = clampScore((Math.min(1, meanSteps / 10000) * 55) + ((100 - meanStress) * 0.45));

      return { volumeScore, climbScore, cardioScore, sleepScore, resilienceScore };
    };

    const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const recentActs = acts.filter((a) => normalizeDateKey(a.date) >= cutoff30);
    const recent = computeAxes(
      recentActs.length > 0 ? recentActs : acts.slice(-10),
      sleepData.slice(-30),
      rhrData.slice(-30),
      stepsData.slice(-30),
      stressData.slice(-30)
    );
    const baseline = computeAxes(acts, sleepData, rhrData, stepsData, stressData);

    return [
      { axis: 'Umfang', recent: recent.volumeScore, baseline: baseline.volumeScore },
      { axis: 'Bergfestigkeit', recent: recent.climbScore, baseline: baseline.climbScore },
      { axis: 'Kardio-Effizienz', recent: recent.cardioScore, baseline: baseline.cardioScore },
      { axis: 'Schlaf-Qualität', recent: recent.sleepScore, baseline: baseline.sleepScore },
      { axis: 'Resilienz', recent: recent.resilienceScore, baseline: baseline.resilienceScore }
    ];
  }, [data?.activities, sleepData, rhrData, stepsData, stressData]);

  const getCorrBadgeColor = (r: number) => {
    const absR = Math.abs(r);
    if (absR > 0.5) return 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/30';
    if (absR > 0.2) return 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-900/30';
    return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700';
  };

  const getCorrStrengthText = (r: number) => {
    const absR = Math.abs(r);
    let strength = 'Keine';
    if (absR > 0.7) strength = 'Sehr starke';
    else if (absR > 0.5) strength = 'Starke';
    else if (absR > 0.3) strength = 'Moderate';
    else if (absR > 0.1) strength = 'Schwache';
    
    const direction = r > 0 ? 'positive' : r < 0 ? 'negative' : '';
    return `${strength} ${direction} Korrelation`;
  };

  const filteredActivities = useMemo(() => {
    if (!data || !data.activities) return [];
    if (!activitySearchQuery.trim()) return data.activities;
    const query = activitySearchQuery.toLowerCase();
    return data.activities.filter((act) => {
      const nameMatch = act.name?.toLowerCase().includes(query);
      const typeMatch = act.type?.toLowerCase().includes(query);
      const dateMatch = act.date?.toLowerCase().includes(query);
      return nameMatch || typeMatch || dateMatch;
    });
  }, [data, activitySearchQuery]);

  const recordsData = useMemo(() => {
    const allActs = data?.activities || [];
    const yearsSet = new Set<string>();
    for (const a of allActs) {
      const y = normalizeDateKey(a.date).slice(0, 4);
      if (/^\d{4}$/.test(y)) yearsSet.add(y);
    }
    const availableYears = Array.from(yearsSet).sort((a, b) => b.localeCompare(a));

    const filteredByYear =
      recordsYearFilter === 'all'
        ? allActs
        : allActs.filter((a) => normalizeDateKey(a.date).startsWith(recordsYearFilter));

    const validActs = filteredByYear.filter(
      (a) => Number(a.distance || 0) > 0.5 && Number(a.duration || 0) > 60
    );
    const cyclingActs = validActs.filter(isStrictCyclingActivity);
    const runningActs = validActs.filter(isStrictRunningActivity);

    const speedOf = (a: GarminActivity) =>
      a.duration > 0 ? Number(a.distance || 0) / (Number(a.duration || 0) / 3600) : 0;

    const pickMax = (list: GarminActivity[], selector: (a: GarminActivity) => number) => {
      if (list.length === 0) return null;
      return list.reduce((best, cur) => (selector(cur) > selector(best) ? cur : best), list[0]);
    };

    const cyclingTotals = {
      count: cyclingActs.length,
      distanceKm: Number(cyclingActs.reduce((s, a) => s + Number(a.distance || 0), 0).toFixed(1)),
      ascentM: Math.round(cyclingActs.reduce((s, a) => s + Number(a.ascent || 0), 0)),
      hours: Number((cyclingActs.reduce((s, a) => s + Number(a.duration || 0), 0) / 3600).toFixed(1))
    };

    const cyclingRealisticSpeedPool = cyclingActs.filter((a) => {
      const spd = speedOf(a);
      return spd > 5 && spd < 55;
    });
    const cyclingSpeed15Pool = cyclingRealisticSpeedPool.filter((a) => a.distance >= 15);
    const cyclingSpeed80Pool = cyclingRealisticSpeedPool.filter((a) => a.distance >= 80);
    const cyclingSpeed40Pool = cyclingRealisticSpeedPool.filter((a) => a.distance >= 40);

    const cycling = {
      totals: cyclingTotals,
      longestDistance: pickMax(cyclingActs, (a) => Number(a.distance || 0)),
      mostAscent: pickMax(cyclingActs.filter((a) => Number(a.ascent || 0) > 0), (a) => Number(a.ascent || 0)),
      longestDuration: pickMax(cyclingActs, (a) => Number(a.duration || 0)),
      fastestAvgSpeed: pickMax(
        cyclingSpeed15Pool.length > 0 ? cyclingSpeed15Pool : cyclingRealisticSpeedPool,
        speedOf
      ),
      fastestEnduranceSpeed: pickMax(
        cyclingSpeed80Pool.length > 0 ? cyclingSpeed80Pool : cyclingSpeed40Pool,
        speedOf
      ),
      maxCalories: pickMax(cyclingActs.filter((a) => Number(a.calories || 0) > 0), (a) => Number(a.calories || 0)),
      milestones: {
        over50: cyclingActs.filter((a) => a.distance >= 50).length,
        over100: cyclingActs.filter((a) => a.distance >= 100).length,
        over150: cyclingActs.filter((a) => a.distance >= 150).length,
        over200: cyclingActs.filter((a) => a.distance >= 200).length,
        ascent1000: cyclingActs.filter((a) => Number(a.ascent || 0) >= 1000).length,
        ascent2000: cyclingActs.filter((a) => Number(a.ascent || 0) >= 2000).length
      },
      top5Distance: [...cyclingActs].sort((a, b) => Number(b.distance || 0) - Number(a.distance || 0)).slice(0, 5),
      top5Ascent: [...cyclingActs]
        .filter((a) => Number(a.ascent || 0) > 0)
        .sort((a, b) => Number(b.ascent || 0) - Number(a.ascent || 0))
        .slice(0, 5)
    };

    const runningTotals = {
      count: runningActs.length,
      distanceKm: Number(runningActs.reduce((s, a) => s + Number(a.distance || 0), 0).toFixed(1)),
      ascentM: Math.round(runningActs.reduce((s, a) => s + Number(a.ascent || 0), 0)),
      hours: Number((runningActs.reduce((s, a) => s + Number(a.duration || 0), 0) / 3600).toFixed(1))
    };

    const runningRealisticPool = runningActs.filter((a) => {
      const spd = speedOf(a);
      return spd >= 4 && spd <= 22;
    });
    const run3kPool = runningRealisticPool.filter((a) => a.distance >= 3);
    const run5kPool = runningRealisticPool.filter((a) => a.distance >= 5);
    const run10kPool = runningRealisticPool.filter((a) => a.distance >= 10);
    const run20kPool = runningRealisticPool.filter((a) => a.distance >= 20);

    const running = {
      totals: runningTotals,
      longestDistance: pickMax(runningActs, (a) => Number(a.distance || 0)),
      longestDuration: pickMax(runningActs, (a) => Number(a.duration || 0)),
      mostAscent: pickMax(runningActs.filter((a) => Number(a.ascent || 0) > 0), (a) => Number(a.ascent || 0)),
      fastestPaceOverall: pickMax(run3kPool.length > 0 ? run3kPool : runningRealisticPool, speedOf),
      fastest5kPlus: pickMax(run5kPool, speedOf),
      fastest10kPlus: pickMax(run10kPool, speedOf),
      fastestHalfMarathonPlus: pickMax(run20kPool, speedOf),
      milestones: {
        over5: runningActs.filter((a) => a.distance >= 5).length,
        over10: runningActs.filter((a) => a.distance >= 10).length,
        over15: runningActs.filter((a) => a.distance >= 15).length,
        over20: runningActs.filter((a) => a.distance >= 20).length
      },
      top5Distance: [...runningActs].sort((a, b) => Number(b.distance || 0) - Number(a.distance || 0)).slice(0, 5),
      top5Fastest: [...run5kPool].sort((a, b) => speedOf(b) - speedOf(a)).slice(0, 5)
    };

    return { availableYears, cycling, running };
  }, [data?.activities, recordsYearFilter]);

  const last4WeeksActivities = useMemo(() => {
    if (!data || !data.activities || data.activities.length === 0) return [];
    
    const sorted = [...data.activities].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latestDate = new Date(sorted[0].date);
    const fourWeeksAgo = new Date(latestDate.getTime() - 28 * 24 * 60 * 60 * 1000);
    
    return data.activities
      .filter(act => {
        const actDate = new Date(act.date);
        return actDate >= fourWeeksAgo && actDate <= latestDate;
      })
      .map(act => {
        const speedKmh = act.duration > 0 ? (act.distance / (act.duration / 3600)) : 0;
        return {
          ...act,
          formattedDate: new Date(act.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
          avgSpeed: parseFloat(speedKmh.toFixed(1)),
          avgHr: act.avg_hr || 0
        };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [data]);

  // Fetch metrics from backend
  const fetchHealthMetrics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(getApiUrl('/api/health-metrics'));
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || 'Fehler beim Laden der Gesundheitsdaten.');
      }
    } catch (err: any) {
      console.error(err);
      setError('Verbindung zum Server fehlgeschlagen.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch computed health analytics
  const fetchAnalytics = useCallback(async () => {
    setIsAnalyticsLoading(true);
    try {
      const res = await apiFetch(getApiUrl('/api/health-analytics'));
      const json = await res.json();
      if (json.success && json.analytics) {
        setAnalyticsData(json.analytics);
      }
    } catch (err) {
      console.error('Failed to load advanced analytics:', err);
    } finally {
      setIsAnalyticsLoading(false);
    }
  }, []);

  // Load Garmin Activity into current workspace using unified hydration + optional auto-FIT fetch
  const handleLoadActivity = useCallback(async (act: GarminActivity) => {
    if (!onLoadTrack) return;
    try {
      let pointsJson = act.points_json;
      
      // Attempt to load the full, un-downsampled track from the server!
      try {
        const res = await apiFetch(getApiUrl(`/api/activity-track-full?id=${encodeURIComponent(act.id)}`));
        const json = await res.json();
        if (json.success && json.points_json) {
          pointsJson = json.points_json;
        }
      } catch (err) {
        console.error('Failed to fetch full track points, using fallback list track:', err);
      }

      const track = await resolveGarminTrackForMap(
        {
          ...act,
          points_json: pointsJson
        },
        { ftp, userWeight }
      );
      
      onLoadTrack(track);
      setSuccessMsg('Aktivität erfolgreich in den Workspace geladen!');
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err) {
      console.error('Failed to load Garmin activity:', err);
      setError('Konnte Garmin-Aktivität nicht in Workspace laden.');
      setTimeout(() => setError(null), 4000);
    }
  }, [onLoadTrack, ftp, userWeight]);

  const handlePanelDataSynced = useCallback(() => {
    fetchHealthMetrics();
    onDataSynced?.();
  }, [fetchHealthMetrics, onDataSynced]);

  useEffect(() => {
    fetchHealthMetrics();
  }, [fetchHealthMetrics]);

  useEffect(() => {
    if (activeTab === 'analytics') {
      fetchAnalytics();
    }
  }, [activeTab, fetchAnalytics]);

  // Clear all data
  const handleClearData = async () => {
    if (!window.confirm('Möchtest du wirklich alle importierten Garmin-Gesundheitsdaten löschen?')) {
      return;
    }
    setIsLoading(true);
    try {
      const res = await apiFetch(getApiUrl('/api/health-metrics/clear'), { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setData({ sleep: [], weight: [], stress: [], rhr: [], steps: [], activities: [] });
        setSuccessMsg('Gesundheitsdaten erfolgreich zurückgesetzt!');
      } else {
        setError(json.error || 'Fehler beim Löschen der Daten.');
      }
    } catch (err) {
      setError('Fehler beim Zurücksetzen der Daten.');
    } finally {
      setIsLoading(false);
    }
  };

  // Helper formatting values
  const formatMinutes = (mins: number) => {
    const hrs = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return hrs > 0 ? `${hrs} Std. ${m} Min.` : `${m} Min.`;
  };

  // Stats calculation & 7d vs 30d deltas
  const avgRhr = rhrData.length > 0
    ? Math.round(rhrData.reduce((acc, r) => acc + r.rhr, 0) / rhrData.length)
    : null;
  const avgSteps = stepsData.length > 0
    ? Math.round(stepsData.reduce((acc, s) => acc + s.steps, 0) / stepsData.length)
    : null;
  const avgSleep = sleepData.length > 0
    ? Math.round(sleepData.reduce((acc, s) => acc + s.duration, 0) / sleepData.length)
    : null;
  const avgStress = stressData.length > 0
    ? Math.round(stressData.reduce((acc, s) => acc + s.avg_stress, 0) / stressData.length)
    : null;

  const kpiDeltas = useMemo(() => {
    const calcDelta = (arr: number[]) => {
      if (arr.length < 2) return null;
      const last7 = arr.slice(-7);
      const base30 = arr.slice(-30);
      const mean7 = last7.reduce((a, b) => a + b, 0) / last7.length;
      const mean30 = base30.reduce((a, b) => a + b, 0) / base30.length;
      return Math.round(mean7 - mean30);
    };
    return {
      rhrDelta: calcDelta(rhrData.map((d) => d.rhr)),
      stepsDelta: calcDelta(stepsData.map((d) => d.steps)),
      sleepDelta: calcDelta(sleepData.map((d) => d.duration)),
      stressDelta: calcDelta(stressData.map((d) => d.avg_stress))
    };
  }, [rhrData, stepsData, sleepData, stressData]);



  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (variant !== 'modal') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [onClose, variant]);

  const dashboardCard = (
      <motion.div 
        initial={variant === 'modal' ? { opacity: 0, scale: 0.95, y: 15 } : false}
        animate={variant === 'modal' ? { opacity: 1, scale: 1, y: 0 } : undefined}
        exit={variant === 'modal' ? { opacity: 0, scale: 0.95, y: 15 } : undefined}
        className={
          variant === 'page'
            ? 'flex-1 flex flex-col min-h-0 w-full bg-white dark:bg-slate-900 overflow-hidden cursor-default'
            : 'relative w-full max-w-6xl h-[calc(100dvh-1rem)] sm:h-[88vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col cursor-default'
        }
        onClick={variant === 'modal' ? (e) => e.stopPropagation() : undefined}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 bg-slate-50 dark:bg-slate-850 border-b border-slate-100 dark:border-slate-800 shrink-0 gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="p-2 sm:p-2.5 bg-orange-100 dark:bg-orange-950/40 rounded-xl text-orange-600 dark:text-orange-400 shrink-0">
              <Database className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm sm:text-xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2 truncate">
                Garmin Fitness &amp; Gesundheit
                <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider hidden sm:inline-block">
                  Personal API
                </span>
              </h2>
              <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 truncate hidden sm:block">
                Synchronisiere Aktivitäten (.FIT), GPS-Tracks &amp; Gesundheitsdaten direkt über die <b>Garmin Connect Personal API</b>.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowAthleteSettings(prev => !prev)}
              className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                showAthleteSettings
                  ? 'bg-orange-600 text-white border-orange-600 shadow-sm'
                  : 'bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
              }`}
              title="Athleten-Profil bearbeiten (FTP, Gewicht, Alter, Max. Puls)"
            >
              <Sliders className="w-3.5 h-3.5 text-orange-500" style={showAthleteSettings ? { color: '#ffffff' } : undefined} />
              <span className="font-mono tabular-nums">{ftp}W · {userWeight}kg · {userAge}J</span>
            </button>
            <button
              type="button"
              onClick={() => handleSelectTab(activeTab === 'personal-api' ? 'overview' : 'personal-api')}
              className={`px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'personal-api'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'bg-orange-100 hover:bg-orange-200 dark:bg-orange-950/50 dark:hover:bg-orange-900/60 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800/60'
              }`}
            >
              <Key className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{activeTab === 'personal-api' ? 'Zurück zur Übersicht' : 'Garmin Personal API'}</span>
              <span className="sm:hidden">API</span>
            </button>
            {variant === 'modal' && onClose && (
              <button 
                onClick={onClose}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-all text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
                title="Schließen"
                aria-label="Schließen"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {showAthleteSettings && (
          <div className="px-6 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">FTP:</span>
                <div className="flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1">
                  <input
                    type="number"
                    min={50}
                    max={600}
                    value={ftp}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!Number.isNaN(val) && val > 0) onUpdateFtp?.(val);
                    }}
                    className="w-14 text-center font-mono font-extrabold text-xs text-amber-500 bg-transparent focus:outline-none"
                  />
                  <span className="text-[11px] font-bold text-slate-400 ml-1">W</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Gewicht:</span>
                <div className="flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1">
                  <input
                    type="number"
                    min={30}
                    max={250}
                    step="0.5"
                    value={userWeight}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!Number.isNaN(val) && val > 0) onUpdateWeight?.(val);
                    }}
                    className="w-14 text-center font-mono font-extrabold text-xs text-emerald-600 dark:text-emerald-400 bg-transparent focus:outline-none"
                  />
                  <span className="text-[11px] font-bold text-slate-400 ml-1">kg</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Alter:</span>
                <div className="flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1">
                  <input
                    type="number"
                    min={10}
                    max={100}
                    value={userAge}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!Number.isNaN(val) && val > 0) onUpdateAge?.(val);
                    }}
                    className="w-12 text-center font-mono font-extrabold text-xs text-indigo-600 dark:text-indigo-400 bg-transparent focus:outline-none"
                  />
                  <span className="text-[11px] font-bold text-slate-400 ml-1">J</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">HF Max:</span>
                <div className="flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1">
                  <input
                    type="number"
                    min={100}
                    max={230}
                    value={userMaxHr}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!Number.isNaN(val) && val > 0) onUpdateMaxHr?.(val);
                    }}
                    className="w-14 text-center font-mono font-extrabold text-xs text-rose-500 bg-transparent focus:outline-none"
                  />
                  <span className="text-[11px] font-bold text-slate-400 ml-1">bpm</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-xs font-bold bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 px-2.5 py-1 rounded-lg border border-amber-200/70 dark:border-amber-800/50 font-mono">
                Leistungsgewicht: {userWeight > 0 ? (ftp / userWeight).toFixed(2) : '0.00'} W/kg
              </div>
              <button
                type="button"
                onClick={() => setShowAthleteSettings(false)}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
              >
                Schließen
              </button>
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Messages */}
          {error && (
            <div className="flex items-start gap-2.5 p-4 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 rounded-2xl border border-red-200/50 dark:border-red-900/30 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {successMsg && (
            <div className="flex items-start gap-2.5 p-4 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded-2xl border border-emerald-200/50 dark:border-emerald-900/30 text-sm">
              <CheckCircle className="w-5 h-5 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Personal API Sync Panel if no data imported yet */}
          {(!data || (data.sleep.length === 0 && data.stress.length === 0 && data.rhr.length === 0 && data.steps.length === 0 && data.activities.length === 0)) ? (
            <div className="space-y-5">
              <div className="p-5 rounded-3xl bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-slate-900 border border-orange-200 dark:border-orange-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Key className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                    Direkt-Synchronisation über Garmin Connect Personal API
                  </h3>
                  <p className="text-xs text-slate-700 dark:text-slate-300">
                    Verbinde deinen persönlichen Garmin API-Schlüssel, um Aktivitäten (inkl. .FIT GPS-Tracks) und Gesundheitsdaten direkt herunterzuladen.
                  </p>
                </div>
              </div>
              <GarminPersonalApiPanel
                onDataSynced={handlePanelDataSynced}
                onLoadTrack={onLoadTrack}
                onCloseModal={onClose}
              />
            </div>
          ) : (
            /* Main Dashboard View */
            <div className="space-y-6">
              {/* 4 Interactive Bento KPI Cards with 7d Delta & Sparklines (shown on overview) */}
              {activeTab === 'overview' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Steps KPI */}
                <button
                  type="button"
                  onClick={() => handleSelectTab('steps')}
                  className="text-left bg-emerald-50/40 dark:bg-emerald-950/15 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/25 p-4 rounded-2xl border border-emerald-100/60 dark:border-emerald-900/30 transition-all cursor-pointer flex flex-col justify-between gap-2.5 group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl group-hover:scale-105 transition-transform">
                        <Footprints className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider block">Ø Schritte / Tag</span>
                        <span className="text-lg font-black text-slate-800 dark:text-slate-100 font-mono tabular-nums">
                          {avgSteps !== null ? avgSteps.toLocaleString('de-DE') : '-'}
                        </span>
                      </div>
                    </div>
                    {kpiDeltas.stepsDelta !== null && (
                      <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${kpiDeltas.stepsDelta >= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                        {kpiDeltas.stepsDelta >= 0 ? '↑' : '↓'} {Math.abs(kpiDeltas.stepsDelta).toLocaleString('de-DE')} (7T)
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
                      <span>Tagesziel: 10.000</span>
                      <span className="font-mono font-bold">{avgSteps ? Math.min(100, Math.round((avgSteps / 10000) * 100)) : 0}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-emerald-100 dark:bg-emerald-950/60 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${avgSteps ? Math.min(100, Math.round((avgSteps / 10000) * 100)) : 0}%` }} />
                    </div>
                  </div>
                </button>

                {/* RHR KPI */}
                <button
                  type="button"
                  onClick={() => handleSelectTab('rhr')}
                  className="text-left bg-rose-50/40 dark:bg-rose-950/15 hover:bg-rose-50/80 dark:hover:bg-rose-950/25 p-4 rounded-2xl border border-rose-100/60 dark:border-rose-900/30 transition-all cursor-pointer flex flex-col justify-between gap-2.5 group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-xl group-hover:scale-105 transition-transform">
                        <Heart className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider block">Ø Ruhepuls (RHR)</span>
                        <span className="text-lg font-black text-slate-800 dark:text-slate-100 font-mono tabular-nums">
                          {avgRhr !== null ? `${avgRhr} bpm` : '-'}
                        </span>
                      </div>
                    </div>
                    {kpiDeltas.rhrDelta !== null && (
                      <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${kpiDeltas.rhrDelta <= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}`}>
                        {kpiDeltas.rhrDelta <= 0 ? '↓' : '↑'} {Math.abs(kpiDeltas.rhrDelta)} bpm (7T)
                      </span>
                    )}
                  </div>
                  <div className="h-7 w-full">
                    {rhrData.length > 1 && (
                      <ResponsiveContainer width="100%" height={28}>
                        <LineChart data={rhrData.slice(-14)}>
                          <Line type="monotone" dataKey="rhr" stroke="#f43f5e" strokeWidth={2} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </button>

                {/* Sleep KPI */}
                <button
                  type="button"
                  onClick={() => handleSelectTab('sleep')}
                  className="text-left bg-indigo-50/40 dark:bg-indigo-950/15 hover:bg-indigo-50/80 dark:hover:bg-indigo-950/25 p-4 rounded-2xl border border-indigo-100/60 dark:border-indigo-900/30 transition-all cursor-pointer flex flex-col justify-between gap-2.5 group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl group-hover:scale-105 transition-transform">
                        <Moon className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider block">Ø Schlafdauer</span>
                        <span className="text-lg font-black text-slate-800 dark:text-slate-100 font-mono tabular-nums">
                          {avgSleep !== null ? formatMinutes(avgSleep) : '-'}
                        </span>
                      </div>
                    </div>
                    {kpiDeltas.sleepDelta !== null && (
                      <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${kpiDeltas.sleepDelta >= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                        {kpiDeltas.sleepDelta >= 0 ? '+' : ''}{kpiDeltas.sleepDelta}m (7T)
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
                      <span>Ziel: 8 Std. 00 Min.</span>
                      <span className="font-mono font-bold">{avgSleep ? Math.min(100, Math.round((avgSleep / 480) * 100)) : 0}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-indigo-100 dark:bg-indigo-950/60 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${avgSleep ? Math.min(100, Math.round((avgSleep / 480) * 100)) : 0}%` }} />
                    </div>
                  </div>
                </button>

                {/* Stress & Readiness KPI */}
                <button
                  type="button"
                  onClick={() => handleSelectTab('stress')}
                  className="text-left bg-amber-50/40 dark:bg-amber-950/15 hover:bg-amber-50/80 dark:hover:bg-amber-950/25 p-4 rounded-2xl border border-amber-100/60 dark:border-amber-900/30 transition-all cursor-pointer flex flex-col justify-between gap-2.5 group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-xl group-hover:scale-105 transition-transform">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider block">Readiness · Ø Stress</span>
                        <span className="text-lg font-black text-slate-800 dark:text-slate-100 font-mono tabular-nums">
                          {readinessSummary.latestScore !== null ? `${readinessSummary.latestScore}/100` : '-'}
                          <span className="text-xs font-semibold text-slate-500 ml-1.5">
                            ({avgStress !== null ? `Stress ${avgStress}` : '—'})
                          </span>
                        </span>
                      </div>
                    </div>
                    {kpiDeltas.stressDelta !== null && (
                      <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${kpiDeltas.stressDelta <= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}`}>
                        {kpiDeltas.stressDelta <= 0 ? '↓' : '↑'} {Math.abs(kpiDeltas.stressDelta)} Pkt
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
                      <span>Erholungsstatus</span>
                      <span className="font-mono font-bold">{readinessSummary.latestScore !== null ? `${readinessSummary.latestScore}%` : '—'}</span>
                    </div>
                    <div className="w-full h-1.5 bg-amber-100 dark:bg-amber-950/60 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${readinessSummary.tone === 'emerald' ? 'bg-emerald-500' : readinessSummary.tone === 'rose' ? 'bg-rose-500' : 'bg-amber-500'}`}
                        style={{ width: `${readinessSummary.latestScore ?? 0}%` }}
                      />
                    </div>
                  </div>
                </button>
              </div>
              )}

              {/* Grouped 2-Level Navigation + Global Timeframe Switcher */}
              {(() => {
                const groups: Array<{
                  id: 'cockpit' | 'records' | 'health' | 'training' | 'sync';
                  label: string;
                  tabs: Array<{ id: GarminDashboardTab; label: string }>;
                }> = [
                  {
                    id: 'cockpit',
                    label: '📊 Cockpit',
                    tabs: [{ id: 'overview', label: 'Übersicht & Readiness' }]
                  },
                  {
                    id: 'records',
                    label: '🏆 Rekorde',
                    tabs: [{ id: 'records', label: '🏆 Persönliche Rekorde' }]
                  },
                  {
                    id: 'health',
                    label: '❤️ Gesundheit & Schlaf',
                    tabs: [
                      { id: 'sleep', label: '🌙 Schlaf & Phasen' },
                      { id: 'rhr', label: '❤️ Ruhepuls' },
                      { id: 'steps', label: '👣 Schritte & Kalorien' },
                      { id: 'stress', label: '🧘 Stressbelastung' }
                    ]
                  },
                  {
                    id: 'training',
                    label: '⚡ Training & Diagnostik',
                    tabs: [
                      { id: 'performance', label: '⚡ Leistungs-Analyse' },
                      { id: 'analytics', label: '🕸️ Radar & Korrelationen' },
                      { id: 'calendar', label: '📅 Kalender' },
                      { id: 'compare', label: '⚖️ Einheiten-Vergleich' },
                      { id: 'activities', label: '🏅 Aktivitäten-Liste' }
                    ]
                  },
                  {
                    id: 'sync',
                    label: '🔑 Cloud-Sync',
                    tabs: [{ id: 'personal-api', label: '🔑 Personal API & Suche' }]
                  }
                ];
                const activeGroup = groups.find((g) => g.tabs.some((t) => t.id === activeTab)) || groups[0];
                const showRangeSelector = ['overview', 'sleep', 'rhr', 'steps', 'stress'].includes(activeTab);

                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-slate-850 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-800">
                      <div className="flex flex-wrap items-center gap-1">
                        {groups.map((grp) => {
                          const isGrpActive = grp.id === activeGroup.id;
                          return (
                            <button
                              key={grp.id}
                              type="button"
                              onClick={() => handleSelectTab(grp.tabs[0].id)}
                              className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer whitespace-nowrap ${
                                isGrpActive
                                  ? 'bg-orange-600 text-white shadow-sm'
                                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                              }`}
                            >
                              {grp.label}
                            </button>
                          );
                        })}
                      </div>

                      {showRangeSelector && (
                        <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
                          {([
                            { val: 14 as const, label: '14T' },
                            { val: 30 as const, label: '30T' },
                            { val: 90 as const, label: '90T' },
                            { val: 365 as const, label: '1J' },
                            { val: 'all' as const, label: 'Alle' }
                          ]).map((opt) => (
                            <button
                              key={String(opt.val)}
                              type="button"
                              onClick={() => setHealthRangeDays(opt.val)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                                healthRangeDays === opt.val
                                  ? 'bg-indigo-600 text-white'
                                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {activeGroup.tabs.length > 1 && (
                      <div className="flex flex-wrap items-center gap-1.5 px-1">
                        {activeGroup.tabs.map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => handleSelectTab(tab.id)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                              activeTab === tab.id
                                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs'
                                : 'bg-white dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 hover:border-orange-400'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Dynamic Tab Panel */}
              <div className="bg-slate-50/40 dark:bg-slate-900/40 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 min-h-[380px] flex flex-col">
                <AnimatePresence mode="wait">
                  {/* Tab: PERSONAL RECORDS (CYCLING & RUNNING) */}
                  {activeTab === 'records' && (() => {
                    const renderHeroCard = (
                      title: string,
                      value: string,
                      act: GarminActivity | null,
                      subMetric: string,
                      accentClass: string,
                      icon: React.ReactNode
                    ) => (
                      <div className={`p-4 rounded-2xl border shadow-xs flex flex-col justify-between gap-3 ${accentClass}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                              {title}
                            </span>
                            <div className="text-xl sm:text-2xl font-black font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                              {value}
                            </div>
                          </div>
                          <div className="p-2 rounded-xl bg-white/80 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-700/60 shrink-0">
                            {icon}
                          </div>
                        </div>

                        {act ? (
                          <div className="space-y-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/50">
                            <div>
                              <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate" title={act.name}>
                                {act.name}
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                                {normalizeDateKey(act.date)} · {subMetric}
                              </p>
                            </div>
                            {onLoadTrack && (
                              <button
                                type="button"
                                onClick={() => handleLoadActivity(act)}
                                className="inline-flex items-center gap-1 text-[11px] font-bold text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 cursor-pointer"
                              >
                                <span>In Workspace laden</span>
                                <ArrowUpRight className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-200/50 dark:border-slate-800">
                            Noch kein Eintrag in diesem Zeitraum
                          </p>
                        )}
                      </div>
                    );

                    const renderTop5Table = (
                      title: string,
                      rows: GarminActivity[],
                      metricFormatter: (a: GarminActivity) => string,
                      secondaryFormatter: (a: GarminActivity) => string
                    ) => (
                      <div className="bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-3">
                        <h5 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                          <Trophy className="w-3.5 h-3.5 text-amber-500" />
                          <span>{title}</span>
                        </h5>
                        {rows.length === 0 ? (
                          <p className="text-xs text-slate-400 py-4 text-center">Keine Aktivitäten vorhanden.</p>
                        ) : (
                          <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            {rows.map((act, idx) => {
                              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
                              return (
                                <div key={`${act.id}-${idx}`} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <span className="w-6 text-center font-black text-slate-500 shrink-0">{medal}</span>
                                    <div className="min-w-0">
                                      <p className="font-bold text-slate-800 dark:text-slate-100 truncate" title={act.name}>
                                        {act.name}
                                      </p>
                                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                                        {normalizeDateKey(act.date)} · {secondaryFormatter(act)}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="font-black font-mono tabular-nums text-slate-900 dark:text-white">
                                      {metricFormatter(act)}
                                    </span>
                                    {onLoadTrack && (
                                      <button
                                        type="button"
                                        onClick={() => handleLoadActivity(act)}
                                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-orange-100 dark:bg-slate-800 dark:hover:bg-orange-950/60 text-slate-600 hover:text-orange-600 dark:text-slate-300 dark:hover:text-orange-400 transition-colors cursor-pointer"
                                        title="In Workspace laden"
                                      >
                                        <ArrowUpRight className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );

                    const speedStr = (a: GarminActivity) =>
                      a.duration > 0 ? `${(a.distance / (a.duration / 3600)).toFixed(1)} km/h` : '-';

                    return (
                      <motion.div
                        key="records"
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="space-y-6 flex-1"
                      >
                        {/* Header & Filter Bar */}
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs">
                          <div>
                            <h4 className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                              <Trophy className="w-4 h-4 text-amber-500" />
                              Persönliche Rekorde &amp; Bestleistungen
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              Automatisch ausgewertet nach Radfahren ({recordsData.cycling.totals.count} Fahrten) und Laufen ({recordsData.running.totals.count} Läufe).
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                              {[
                                { id: 'all' as const, label: 'Alle Sportarten' },
                                { id: 'cycling' as const, label: `🚴 Rad (${recordsData.cycling.totals.count})` },
                                { id: 'running' as const, label: `🏃 Lauf (${recordsData.running.totals.count})` }
                              ].map((opt) => (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => setRecordsSportFilter(opt.id)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                                    recordsSportFilter === opt.id
                                      ? 'bg-orange-600 text-white shadow-xs'
                                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>

                            <select
                              value={recordsYearFilter}
                              onChange={(e) => setRecordsYearFilter(e.target.value)}
                              className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 cursor-pointer"
                            >
                              <option value="all">All-Time (Alle Jahre)</option>
                              {recordsData.availableYears.map((y) => (
                                <option key={y} value={y}>
                                  Saison {y}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* CYCLING RECORDS SECTION */}
                        {(recordsSportFilter === 'all' || recordsSportFilter === 'cycling') && (
                          <div className="space-y-4">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 rounded-2xl bg-gradient-to-r from-blue-50 to-sky-50 dark:from-blue-950/30 dark:to-slate-900 border border-blue-200/70 dark:border-blue-900/50">
                              <div className="space-y-0.5">
                                <h5 className="text-sm font-black text-blue-950 dark:text-blue-100 flex items-center gap-2">
                                  <span>🚴 Radfahren Rekorde</span>
                                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                                    {recordsData.cycling.totals.count} Fahrten · {recordsData.cycling.totals.distanceKm.toLocaleString('de-DE')} km · +{recordsData.cycling.totals.ascentM.toLocaleString('de-DE')} hm · {recordsData.cycling.totals.hours}h
                                  </span>
                                </h5>
                                <p className="text-[11px] text-blue-700/80 dark:text-blue-300/80">
                                  Umfasst Straßen-, Gravel-, MTB- und Indoor-Cycling-Einheiten.
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                                <span className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-blue-200/60 dark:border-blue-800/50 text-blue-800 dark:text-blue-200">
                                  50+ km: {recordsData.cycling.milestones.over50}x
                                </span>
                                <span className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-blue-200/60 dark:border-blue-800/50 text-blue-800 dark:text-blue-200">
                                  100+ km: {recordsData.cycling.milestones.over100}x
                                </span>
                                <span className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-blue-200/60 dark:border-blue-800/50 text-blue-800 dark:text-blue-200">
                                  150+ km: {recordsData.cycling.milestones.over150}x
                                </span>
                                <span className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-blue-200/60 dark:border-blue-800/50 text-blue-800 dark:text-blue-200">
                                  200+ km: {recordsData.cycling.milestones.over200}x
                                </span>
                                <span className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-blue-200/60 dark:border-blue-800/50 text-amber-700 dark:text-amber-300">
                                  1.000+ hm: {recordsData.cycling.milestones.ascent1000}x
                                </span>
                                <span className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-blue-200/60 dark:border-blue-800/50 text-amber-700 dark:text-amber-300">
                                  2.000+ hm: {recordsData.cycling.milestones.ascent2000}x
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {renderHeroCard(
                                'Längste Radfahrt (Distanz)',
                                recordsData.cycling.longestDistance ? `${recordsData.cycling.longestDistance.distance.toFixed(1)} km` : '-',
                                recordsData.cycling.longestDistance,
                                recordsData.cycling.longestDistance
                                  ? `${formatDurationHhMm(recordsData.cycling.longestDistance.duration)} · +${Math.round(recordsData.cycling.longestDistance.ascent || 0)} hm`
                                  : '',
                                'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200/60 dark:border-blue-900/40',
                                <Award className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                              )}
                              {renderHeroCard(
                                'Königsetappe (Meiste Höhenmeter)',
                                recordsData.cycling.mostAscent ? `+${Math.round(recordsData.cycling.mostAscent.ascent || 0).toLocaleString('de-DE')} hm` : '-',
                                recordsData.cycling.mostAscent,
                                recordsData.cycling.mostAscent
                                  ? `${recordsData.cycling.mostAscent.distance.toFixed(1)} km · ${formatDurationHhMm(recordsData.cycling.mostAscent.duration)}`
                                  : '',
                                'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-900/40',
                                <Mountain className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                              )}
                              {renderHeroCard(
                                'Längste Zeit im Sattel',
                                recordsData.cycling.longestDuration ? formatDurationHhMm(recordsData.cycling.longestDuration.duration) : '-',
                                recordsData.cycling.longestDuration,
                                recordsData.cycling.longestDuration
                                  ? `${recordsData.cycling.longestDuration.distance.toFixed(1)} km · +${Math.round(recordsData.cycling.longestDuration.ascent || 0)} hm`
                                  : '',
                                'bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200/60 dark:border-indigo-900/40',
                                <Timer className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                              )}
                              {renderHeroCard(
                                'Schnellster Schnitt (ab 15 km)',
                                recordsData.cycling.fastestAvgSpeed ? speedStr(recordsData.cycling.fastestAvgSpeed) : '-',
                                recordsData.cycling.fastestAvgSpeed,
                                recordsData.cycling.fastestAvgSpeed
                                  ? `${recordsData.cycling.fastestAvgSpeed.distance.toFixed(1)} km in ${formatDurationHhMm(recordsData.cycling.fastestAvgSpeed.duration)}`
                                  : '',
                                'bg-sky-50/50 dark:bg-sky-950/20 border-sky-200/60 dark:border-sky-900/40',
                                <Zap className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                              )}
                              {renderHeroCard(
                                'Schnellste Langstrecke (ab 80 km)',
                                recordsData.cycling.fastestEnduranceSpeed ? speedStr(recordsData.cycling.fastestEnduranceSpeed) : '-',
                                recordsData.cycling.fastestEnduranceSpeed,
                                recordsData.cycling.fastestEnduranceSpeed
                                  ? `${recordsData.cycling.fastestEnduranceSpeed.distance.toFixed(1)} km in ${formatDurationHhMm(recordsData.cycling.fastestEnduranceSpeed.duration)}`
                                  : '',
                                'bg-teal-50/50 dark:bg-teal-950/20 border-teal-200/60 dark:border-teal-900/40',
                                <TrendingUp className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                              )}
                              {renderHeroCard(
                                'Höchster Kalorienverbrauch',
                                recordsData.cycling.maxCalories ? `${Math.round(recordsData.cycling.maxCalories.calories || 0).toLocaleString('de-DE')} kcal` : '-',
                                recordsData.cycling.maxCalories,
                                recordsData.cycling.maxCalories
                                  ? `${recordsData.cycling.maxCalories.distance.toFixed(1)} km · ${formatDurationHhMm(recordsData.cycling.maxCalories.duration)}`
                                  : '',
                                'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200/60 dark:border-rose-900/40',
                                <Flame className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                              )}
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              {renderTop5Table(
                                'Top 5 Längste Radfahrten',
                                recordsData.cycling.top5Distance,
                                (a) => `${a.distance.toFixed(1)} km`,
                                (a) => `${formatDurationHhMm(a.duration)} · +${Math.round(a.ascent || 0)} hm · ${speedStr(a)}`
                              )}
                              {renderTop5Table(
                                'Top 5 Bergfahrten (Höhenmeter)',
                                recordsData.cycling.top5Ascent,
                                (a) => `+${Math.round(a.ascent || 0).toLocaleString('de-DE')} hm`,
                                (a) => `${a.distance.toFixed(1)} km · ${formatDurationHhMm(a.duration)}`
                              )}
                            </div>
                          </div>
                        )}

                        {/* RUNNING RECORDS SECTION */}
                        {(recordsSportFilter === 'all' || recordsSportFilter === 'running') && (
                          <div className="space-y-4">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 rounded-2xl bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-slate-900 border border-orange-200/70 dark:border-orange-900/50">
                              <div className="space-y-0.5">
                                <h5 className="text-sm font-black text-orange-950 dark:text-orange-100 flex items-center gap-2">
                                  <span>🏃 Laufen Rekorde</span>
                                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/60 text-orange-700 dark:text-orange-300">
                                    {recordsData.running.totals.count} Läufe · {recordsData.running.totals.distanceKm.toLocaleString('de-DE')} km · +{recordsData.running.totals.ascentM.toLocaleString('de-DE')} hm · {recordsData.running.totals.hours}h
                                  </span>
                                </h5>
                                <p className="text-[11px] text-orange-700/80 dark:text-orange-300/80">
                                  Auswertung aller Straßen-, Trail- und Bahnläufe nach Distanz, Dauer und Best-Pace.
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                                <span className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-orange-200/60 dark:border-orange-800/50 text-orange-800 dark:text-orange-200">
                                  5+ km: {recordsData.running.milestones.over5}x
                                </span>
                                <span className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-orange-200/60 dark:border-orange-800/50 text-orange-800 dark:text-orange-200">
                                  10+ km: {recordsData.running.milestones.over10}x
                                </span>
                                <span className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-orange-200/60 dark:border-orange-800/50 text-orange-800 dark:text-orange-200">
                                  15+ km: {recordsData.running.milestones.over15}x
                                </span>
                                <span className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-orange-200/60 dark:border-orange-800/50 text-rose-700 dark:text-rose-300">
                                  20+ km (HM): {recordsData.running.milestones.over20}x
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {renderHeroCard(
                                'Weitester Lauf (Distanz)',
                                recordsData.running.longestDistance ? `${recordsData.running.longestDistance.distance.toFixed(2)} km` : '-',
                                recordsData.running.longestDistance,
                                recordsData.running.longestDistance
                                  ? `${formatDurationHhMm(recordsData.running.longestDistance.duration)} · Ø ${formatPaceMinKm(recordsData.running.longestDistance.distance, recordsData.running.longestDistance.duration)}`
                                  : '',
                                'bg-orange-50/50 dark:bg-orange-950/20 border-orange-200/60 dark:border-orange-900/40',
                                <Award className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                              )}
                              {renderHeroCard(
                                'Längste Laufdauer',
                                recordsData.running.longestDuration ? formatDurationHhMm(recordsData.running.longestDuration.duration) : '-',
                                recordsData.running.longestDuration,
                                recordsData.running.longestDuration
                                  ? `${recordsData.running.longestDuration.distance.toFixed(2)} km · Ø ${formatPaceMinKm(recordsData.running.longestDuration.distance, recordsData.running.longestDuration.duration)}`
                                  : '',
                                'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-900/40',
                                <Timer className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                              )}
                              {renderHeroCard(
                                'Schnellste Pace (ab 3 km)',
                                recordsData.running.fastestPaceOverall
                                  ? formatPaceMinKm(recordsData.running.fastestPaceOverall.distance, recordsData.running.fastestPaceOverall.duration)
                                  : '-',
                                recordsData.running.fastestPaceOverall,
                                recordsData.running.fastestPaceOverall
                                  ? `${recordsData.running.fastestPaceOverall.distance.toFixed(2)} km · ${speedStr(recordsData.running.fastestPaceOverall)}`
                                  : '',
                                'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-900/40',
                                <Zap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              )}
                              {renderHeroCard(
                                'Beste Pace (ab 5 km)',
                                recordsData.running.fastest5kPlus
                                  ? formatPaceMinKm(recordsData.running.fastest5kPlus.distance, recordsData.running.fastest5kPlus.duration)
                                  : '-',
                                recordsData.running.fastest5kPlus,
                                recordsData.running.fastest5kPlus
                                  ? `${recordsData.running.fastest5kPlus.distance.toFixed(2)} km in ${formatDurationHhMm(recordsData.running.fastest5kPlus.duration)}`
                                  : '',
                                'bg-teal-50/50 dark:bg-teal-950/20 border-teal-200/60 dark:border-teal-900/40',
                                <TrendingUp className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                              )}
                              {renderHeroCard(
                                'Beste Pace (ab 10 km)',
                                recordsData.running.fastest10kPlus
                                  ? formatPaceMinKm(recordsData.running.fastest10kPlus.distance, recordsData.running.fastest10kPlus.duration)
                                  : '-',
                                recordsData.running.fastest10kPlus,
                                recordsData.running.fastest10kPlus
                                  ? `${recordsData.running.fastest10kPlus.distance.toFixed(2)} km in ${formatDurationHhMm(recordsData.running.fastest10kPlus.duration)}`
                                  : '',
                                'bg-purple-50/50 dark:bg-purple-950/20 border-purple-200/60 dark:border-purple-900/40',
                                <Trophy className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                              )}
                              {renderHeroCard(
                                recordsData.running.fastestHalfMarathonPlus ? 'Halbmarathon+ Best-Pace (ab 20 km)' : 'Meiste Lauf-Höhenmeter',
                                recordsData.running.fastestHalfMarathonPlus
                                  ? formatPaceMinKm(recordsData.running.fastestHalfMarathonPlus.distance, recordsData.running.fastestHalfMarathonPlus.duration)
                                  : recordsData.running.mostAscent
                                  ? `+${Math.round(recordsData.running.mostAscent.ascent || 0)} hm`
                                  : '-',
                                recordsData.running.fastestHalfMarathonPlus || recordsData.running.mostAscent,
                                recordsData.running.fastestHalfMarathonPlus
                                  ? `${recordsData.running.fastestHalfMarathonPlus.distance.toFixed(2)} km in ${formatDurationHhMm(recordsData.running.fastestHalfMarathonPlus.duration)}`
                                  : recordsData.running.mostAscent
                                  ? `${recordsData.running.mostAscent.distance.toFixed(2)} km · Ø ${formatPaceMinKm(recordsData.running.mostAscent.distance, recordsData.running.mostAscent.duration)}`
                                  : '',
                                'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200/60 dark:border-rose-900/40',
                                <Mountain className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                              )}
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              {renderTop5Table(
                                'Top 5 Weiteste Läufe',
                                recordsData.running.top5Distance,
                                (a) => `${a.distance.toFixed(2)} km`,
                                (a) => `${formatDurationHhMm(a.duration)} · Ø ${formatPaceMinKm(a.distance, a.duration)}`
                              )}
                              {renderTop5Table(
                                'Top 5 Schnellste Läufe (ab 5 km)',
                                recordsData.running.top5Fastest,
                                (a) => formatPaceMinKm(a.distance, a.duration),
                                (a) => `${a.distance.toFixed(2)} km · ${speedStr(a)} · ${formatDurationHhMm(a.duration)}`
                              )}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* Tab: PERSONAL API */}
                  {activeTab === 'personal-api' && (
                    <motion.div
                      key="personal-api"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="w-full flex-1 flex flex-col"
                    >
                      <GarminPersonalApiPanel
                        onDataSynced={handlePanelDataSynced}
                        onLoadTrack={onLoadTrack}
                        onCloseModal={onClose}
                      />
                    </motion.div>
                  )}

                  {/* Tab: PERFORMANCE ANALYSIS */}
                  {activeTab === 'performance' && (
                    <motion.div
                      key="performance"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="w-full flex-1 flex flex-col"
                    >
                      <FitnessPerformanceAnalysis 
                        isEmbedded={true}
                        onClose={onClose}
                        initialActivities={data?.activities}
                        userWeight={userWeight}
                        userAge={userAge}
                        userMaxHr={userMaxHr}
                        ftp={ftp}
                        onUpdateFtp={onUpdateFtp}
                        onUpdateMaxHr={onUpdateMaxHr}
                        onUpdateWeight={onUpdateWeight}
                        onUpdateAge={onUpdateAge}
                      />
                    </motion.div>
                  )}

                  {/* Tab: CALENDAR & COMPARE (GarminActivitiesAnalysis embedded) */}
                  {(activeTab === 'calendar' || activeTab === 'compare') && (
                    <motion.div
                      key={activeTab}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="w-full flex-1 flex flex-col"
                    >
                      <GarminActivitiesAnalysis
                        embedded
                        initialTab={activeTab === 'compare' ? 'compare' : 'calendar'}
                        initialActivities={data?.activities}
                        onDataSynced={handlePanelDataSynced}
                        onLoadTrack={onLoadTrack}
                      />
                    </motion.div>
                  )}

                  {/* Tab 1: OVERVIEW */}
                  {activeTab === 'overview' && (
                    <motion.div 
                      key="overview"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-6 flex-1 flex flex-col justify-between"
                    >
                      {/* New Diagram 2: Tages-Readiness & Recovery Score + 14-Day Balance */}
                      <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800/60 shadow-xs space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                              <ShieldCheck className="w-4 h-4 text-emerald-500" />
                              Erholungs- &amp; Readiness-Score (14-Tage-Balance)
                            </h4>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              Kombiniert Ruhepuls-Abweichung{readinessSummary.baselineRhr ? ` (Basis: ${readinessSummary.baselineRhr} bpm)` : ''}, Schlafdauer/Tief- &amp; REM-Anteil sowie Stressbelastung.
                            </p>
                          </div>
                          {readinessSummary.latestScore !== null && (
                            <span className={`text-xs font-extrabold px-3 py-1 rounded-full self-start sm:self-auto ${
                              readinessSummary.tone === 'emerald'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : readinessSummary.tone === 'rose'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                            }`}>
                              {readinessSummary.label}
                            </span>
                          )}
                        </div>

                        {readinessSummary.series.length === 0 ? (
                          <div className="h-32 flex items-center justify-center text-xs text-slate-400">
                            Synchronisiere Schlaf-, Ruhepuls- oder Stressdaten für den Readiness-Index.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
                            {/* Radial Gauge */}
                            <div className="lg:col-span-3 flex flex-col items-center justify-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
                              <div className="relative w-28 h-28 flex items-center justify-center">
                                <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                                  <circle cx="50" cy="50" r="42" stroke="currentColor" strokeWidth="10" fill="none" className="text-slate-200 dark:text-slate-800" />
                                  <circle
                                    cx="50"
                                    cy="50"
                                    r="42"
                                    stroke={readinessSummary.tone === 'emerald' ? '#10b981' : readinessSummary.tone === 'rose' ? '#f43f5e' : '#f59e0b'}
                                    strokeWidth="10"
                                    strokeLinecap="round"
                                    fill="none"
                                    strokeDasharray={`${2 * Math.PI * 42}`}
                                    strokeDashoffset={`${2 * Math.PI * 42 * (1 - (readinessSummary.latestScore ?? 0) / 100)}`}
                                  />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                  <span className="text-2xl font-black font-mono tabular-nums text-slate-800 dark:text-slate-100">
                                    {readinessSummary.latestScore ?? '-'}
                                  </span>
                                  <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400">
                                    Readiness
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* 14-Day Readiness Trend */}
                            <div className="lg:col-span-9 h-44 w-full min-w-0">
                              <ResponsiveContainer width="100%" height={176} minWidth={0}>
                                <ComposedChart data={readinessSummary.series}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                                  <XAxis dataKey="shortDate" stroke="#94a3b8" fontSize={9} />
                                  <YAxis yAxisId="left" domain={[0, 100]} stroke="#10b981" fontSize={9} />
                                  <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} stroke="#f43f5e" fontSize={9} />
                                  <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '11px' }} />
                                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                                  <ReferenceLine yAxisId="left" y={75} stroke="#10b981" strokeDasharray="4 4" />
                                  <Area yAxisId="left" type="monotone" dataKey="readiness" name="Readiness (0–100)" stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={2.5} />
                                  <Line yAxisId="right" type="monotone" dataKey="rhr" name="Ruhepuls (bpm)" stroke="#f43f5e" strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
                                  <Line yAxisId="left" type="monotone" dataKey="stress" name="Ø Stress" stroke="#f59e0b" strokeWidth={1.8} strokeDasharray="3 3" dot={false} connectNulls />
                                </ComposedChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* New Diagram 1: 365-Day Activity & Consistency Heatmap */}
                      <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800/60 shadow-xs space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-orange-500" />
                              365-Tage Konsistenz-Heatmap
                            </h4>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {yearlyHeatmapData.activeDays} aktive Tage · Längster Streak: <strong>{yearlyHeatmapData.longestStreak} Tage</strong> · {yearlyHeatmapData.totalDistance.toLocaleString('de-DE')} km · +{yearlyHeatmapData.totalAscent.toLocaleString('de-DE')} hm
                            </p>
                          </div>
                          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl self-start sm:self-auto">
                            {([
                              { id: 'distance' as const, label: 'Distanz' },
                              { id: 'duration' as const, label: 'Dauer' },
                              { id: 'ascent' as const, label: 'Höhenmeter' },
                              { id: 'steps' as const, label: 'Schritte' }
                            ]).map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => setHeatmapMetric(m.id)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                                  heatmapMetric === m.id
                                    ? 'bg-orange-600 text-white'
                                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                                }`}
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="overflow-x-auto pb-1">
                          <div className="inline-flex gap-1 min-w-max">
                            <div className="grid grid-rows-7 gap-1 pr-1 text-[9px] text-slate-400 font-semibold items-center">
                              <span>Mo</span><span></span><span>Mi</span><span></span><span>Fr</span><span></span><span>So</span>
                            </div>
                            {yearlyHeatmapData.weeks.map((week, wIdx) => (
                              <div key={wIdx} className="grid grid-rows-7 gap-1">
                                {week.map((cell) => {
                                  const ratio = yearlyHeatmapData.maxVal > 0 ? cell.value / yearlyHeatmapData.maxVal : 0;
                                  const colorClass = cell.value <= 0
                                    ? 'bg-slate-100 dark:bg-slate-800/80'
                                    : ratio < 0.25
                                    ? 'bg-emerald-200 dark:bg-emerald-950'
                                    : ratio < 0.5
                                    ? 'bg-emerald-300 dark:bg-emerald-800'
                                    : ratio < 0.75
                                    ? 'bg-emerald-500 dark:bg-emerald-600'
                                    : 'bg-orange-500 dark:bg-orange-400';
                                  const tooltipText = [
                                    cell.date,
                                    cell.distance > 0 ? `${cell.distance} km · ${cell.durationMin} Min. · +${cell.ascent} hm` : null,
                                    cell.steps > 0 ? `${cell.steps.toLocaleString('de-DE')} Schritte` : null,
                                    cell.names.length > 0 ? cell.names.join(', ') : null
                                  ].filter(Boolean).join(' | ');
                                  return (
                                    <div
                                      key={cell.date}
                                      title={tooltipText}
                                      className={`w-3 h-3 rounded-[3px] ${colorClass} transition-transform hover:scale-125`}
                                    />
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* New Diagram 3: Monthly Volume & Elevation by Sport */}
                      {monthlyVolumeData.length > 0 && (
                        <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800/60 shadow-xs space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <BarChart2 className="w-3.5 h-3.5 text-indigo-500" />
                                Monatliches Trainingsvolumen &amp; Höhenmeter nach Sportart
                              </h4>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                Gestapelte Distanz nach Sportart (km) kombiniert mit monatlichen Gesamthöhenmetern (hm).
                              </p>
                            </div>
                          </div>
                          <div className="h-56 w-full min-w-0">
                            <ResponsiveContainer width="100%" height={224} minWidth={0}>
                              <ComposedChart data={monthlyVolumeData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                                <XAxis dataKey="label" stroke="#94a3b8" fontSize={10} />
                                <YAxis yAxisId="left" stroke="#6366f1" fontSize={9} unit=" km" />
                                <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={9} unit=" m" />
                                <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '11px' }} />
                                <Legend wrapperStyle={{ fontSize: '10px' }} />
                                <Bar yAxisId="left" dataKey="cyclingKm" stackId="vol" name="🚴 Radfahren (km)" fill="#3b82f6" />
                                <Bar yAxisId="left" dataKey="runningKm" stackId="vol" name="🏃 Laufen/Wandern (km)" fill="#f97316" />
                                <Bar yAxisId="left" dataKey="otherKm" stackId="vol" name="🏅 Sonstige (km)" fill="#a855f7" radius={[3, 3, 0, 0]} />
                                <Line yAxisId="right" type="monotone" dataKey="ascentM" name="⛰️ Höhenmeter (hm)" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} />
                              </ComposedChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Ruhepuls & 7d Rolling Average */}
                        <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800/60 shadow-xs">
                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4 flex items-center justify-between">
                            <span>Ruhepuls Trend &amp; 7T-Mittel (bpm)</span>
                            <Heart className="w-3.5 h-3.5 text-rose-500" />
                          </h4>
                          <div className="h-48 w-full min-w-0">
                            {visibleRhrData.length === 0 ? (
                              <div className="h-full flex flex-col items-center justify-center text-center px-4 text-xs text-slate-400 gap-2">
                                <span>Keine Ruhepuls-Daten vorhanden.</span>
                                <button
                                  type="button"
                                  onClick={() => handleSelectTab('personal-api')}
                                  className="text-indigo-500 hover:text-indigo-600 font-semibold underline underline-offset-2"
                                >
                                  Über Garmin Personal API synchronisieren
                                </button>
                              </div>
                            ) : (
                              <ResponsiveContainer width="100%" height={192} minWidth={0}>
                                <LineChart data={visibleRhrData}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                                  <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                                  <YAxis
                                    domain={[(min: number) => Math.max(25, Math.floor(min - 5)), (max: number) => Math.ceil(max + 5)]}
                                    stroke="#94a3b8"
                                    fontSize={9}
                                  />
                                  <Tooltip contentStyle={{ borderRadius: '12px' }} />
                                  {avgRhr && <ReferenceLine y={avgRhr} stroke="#94a3b8" strokeDasharray="4 4" />}
                                  <Line
                                    type="monotone"
                                    dataKey="rhr"
                                    name="Ruhepuls"
                                    stroke="#fda4af"
                                    strokeWidth={1.8}
                                    dot={visibleRhrData.length <= 5 ? { r: 3, fill: '#f43f5e' } : false}
                                  />
                                  <Line
                                    type="monotone"
                                    dataKey="rhr7dAvg"
                                    name="7T-Schnitt"
                                    stroke="#e11d48"
                                    strokeWidth={3}
                                    dot={false}
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                        </div>

                        {/* Schritte Verlauf */}
                        <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800/60 shadow-xs">
                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4 flex items-center justify-between">
                            <span>Tägliche Schritte &amp; 10k-Ziel</span>
                            <Footprints className="w-3.5 h-3.5 text-emerald-500" />
                          </h4>
                          <div className="h-48 w-full min-w-0">
                            {visibleStepsData.length === 0 ? (
                              <div className="h-full flex flex-col items-center justify-center text-center px-4 text-xs text-slate-400 gap-2">
                                <span>Keine Schrittdaten vorhanden.</span>
                                <button
                                  type="button"
                                  onClick={() => handleSelectTab('personal-api')}
                                  className="text-indigo-500 hover:text-indigo-600 font-semibold underline underline-offset-2"
                                >
                                  Über Garmin Personal API synchronisieren
                                </button>
                              </div>
                            ) : (
                              <ResponsiveContainer width="100%" height={192} minWidth={0}>
                                <ComposedChart data={visibleStepsData}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                                  <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                                  <YAxis stroke="#94a3b8" fontSize={9} />
                                  <Tooltip contentStyle={{ borderRadius: '12px' }} />
                                  <ReferenceLine y={10000} stroke="#059669" strokeDasharray="4 4" />
                                  <Bar dataKey="steps" name="Schritte" fill="#10b981" fillOpacity={0.75} radius={[4, 4, 0, 0]} />
                                  <Line type="monotone" dataKey="steps7dAvg" name="7T-Schnitt" stroke="#047857" strokeWidth={2.5} dot={false} />
                                </ComposedChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Personal API sync & data reset footer */}
                      <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                          <Info className="w-4 h-4 text-slate-500 shrink-0" />
                          <span>Aktualisiere deine Aktivitäten und Gesundheitswerte jederzeit direkt über die Garmin Connect Personal API.</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleSelectTab('personal-api')}
                            className="px-3.5 py-1.5 bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/30 dark:hover:bg-orange-950/50 text-orange-700 dark:text-orange-300 border border-orange-200/70 dark:border-orange-800/60 rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5"
                          >
                            <Key className="w-3.5 h-3.5" />
                            Über Personal API synchronisieren
                          </button>
                          <button
                            type="button"
                            onClick={handleClearData}
                            className="px-3.5 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/20 text-red-600 dark:text-red-400 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Daten zurücksetzen
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Tab 2: SLEEP */}
                  {activeTab === 'sleep' && (
                    <motion.div 
                      key="sleep"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-4"
                    >
                      <h4 className="text-sm font-black text-slate-800 dark:text-slate-200">Schlafverlauf, Schlafarchitektur &amp; 7T-Trend</h4>
                      <p className="text-xs text-slate-500">Zeigt deine Schlafdauer im Verhältnis zum 8h-Ziel, den gleitenden 7-Tage-Durchschnitt sowie die Verteilung von Leicht-, Tief- und REM-Schlaf.</p>

                      {visibleSleepData.length === 0 ? (
                        <div className="h-64 bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center text-center text-xs text-slate-400 gap-2">
                          <span>Keine Schlafdaten vorhanden.</span>
                          <button type="button" onClick={() => handleSelectTab('personal-api')} className="text-indigo-500 hover:text-indigo-600 font-semibold underline underline-offset-2">
                            Über Garmin Personal API synchronisieren
                          </button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                          <div className={`lg:col-span-8 ${variant === 'page' ? 'h-80 sm:h-96' : 'h-64'} w-full min-w-0 bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800`}>
                            <ResponsiveContainer width="100%" height={variant === 'page' ? 320 : 224} minWidth={0}>
                              <ComposedChart data={visibleSleepData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} vertical={false} />
                                <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                                <YAxis unit=" Std." tickFormatter={(v) => (v / 60).toFixed(0)} stroke="#94a3b8" fontSize={9} />
                                <Tooltip 
                                  contentStyle={{ borderRadius: '12px' }}
                                  formatter={(value: any, name: any) => [formatMinutes(Number(value)), name]}
                                />
                                <Legend wrapperStyle={{ fontSize: '10px' }} />
                                <ReferenceLine y={480} stroke="#6366f1" strokeDasharray="4 4" label={{ value: '8h Ziel', position: 'insideTopRight', fill: '#6366f1', fontSize: 10 }} />
                                <Bar dataKey="deep" name="Tiefschlaf" stackId="a" fill="#1e3a8a" />
                                <Bar dataKey="rem" name="REM" stackId="a" fill="#8b5cf6" />
                                <Bar dataKey="light" name="Leichtschlaf" stackId="a" fill="#3b82f6" />
                                <Bar dataKey="awake" name="Wach" stackId="a" fill="#f59e0b" />
                                <Line type="monotone" dataKey="sleep7dAvg" name="7T-Schnitt" stroke="#ec4899" strokeWidth={2.5} dot={false} />
                              </ComposedChart>
                            </ResponsiveContainer>
                          </div>

                          {/* Diagram 5: Sleep Architecture Donut */}
                          <div className="lg:col-span-4 bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col justify-between">
                            <div>
                              <h5 className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">Schlafarchitektur (Ø)</h5>
                              <p className="text-[11px] text-slate-500 mt-0.5">Durchschnittliche Phasenverteilung</p>
                            </div>
                            <div className="h-44 w-full">
                              <ResponsiveContainer width="100%" height={176}>
                                <PieChart>
                                  <Pie data={sleepArchitectureData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={66} paddingAngle={3}>
                                    {sleepArchitectureData.map((entry) => (
                                      <Cell key={entry.name} fill={entry.color} />
                                    ))}
                                  </Pie>
                                  <Tooltip formatter={(value: any, name: any) => [formatMinutes(Number(value)), name]} />
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="space-y-1.5 text-[11px]">
                              {sleepArchitectureData.map((seg) => (
                                <div key={seg.name} className="flex items-center justify-between">
                                  <span className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
                                    {seg.name}
                                  </span>
                                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                    {seg.pct}% ({formatMinutes(seg.value)}) · <span className="text-[10px] font-normal text-slate-400">{seg.target}</span>
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* Tab 4: RHR */}
                  {activeTab === 'rhr' && (
                    <motion.div 
                      key="rhr"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-4"
                    >
                      <h4 className="text-sm font-black text-slate-800 dark:text-slate-200">Ruheherzfrequenz (RHR) &amp; 7-Tage-Trend</h4>
                      <p className="text-xs text-slate-500">Ein hervorragender Indikator für deine Regeneration, Ausdauerleistung und Fitnessentwicklung über Zeit.</p>
                      <div className={`${variant === 'page' ? 'h-80 sm:h-96' : 'h-64'} w-full min-w-0 bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800`}>
                        {visibleRhrData.length === 0 ? (
                          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-xs text-slate-400 gap-2">
                            <span>Keine Ruhepuls-Daten vorhanden.</span>
                            <button
                              type="button"
                              onClick={() => handleSelectTab('personal-api')}
                              className="text-indigo-500 hover:text-indigo-600 font-semibold underline underline-offset-2"
                            >
                              Über Garmin Personal API synchronisieren
                            </button>
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height={variant === 'page' ? 320 : 224} minWidth={0}>
                            <ComposedChart data={visibleRhrData}>
                              <defs>
                                <linearGradient id="colorRhr" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.22}/>
                                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} vertical={false} />
                              <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                              <YAxis
                                domain={[(min: number) => Math.max(25, Math.floor(min - 5)), (max: number) => Math.ceil(max + 5)]}
                                stroke="#94a3b8"
                                fontSize={9}
                              />
                              <Tooltip contentStyle={{ borderRadius: '12px' }} />
                              <Legend wrapperStyle={{ fontSize: '10px' }} />
                              {avgRhr && <ReferenceLine y={avgRhr} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: `Basis Ø ${avgRhr}`, position: 'insideTopRight', fill: '#94a3b8', fontSize: 10 }} />}
                              <Area
                                type="monotone"
                                dataKey="rhr"
                                name="Ruhepuls (Tageswert)"
                                stroke="#fda4af"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorRhr)"
                                dot={visibleRhrData.length <= 5 ? { r: 4, fill: '#f43f5e' } : false}
                              />
                              <Line type="monotone" dataKey="rhr7dAvg" name="7T-Schnitt" stroke="#e11d48" strokeWidth={3} dot={false} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Tab 5: STEPS */}
                  {activeTab === 'steps' && (
                    <motion.div 
                      key="steps"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-4"
                    >
                      <h4 className="text-sm font-black text-slate-800 dark:text-slate-200">Schritte, 10k-Ziel &amp; Kalorienverbrauch</h4>
                      <p className="text-xs text-slate-500">Überwache deine tägliche Aktivität im Alltag, den 7-Tage-Durchschnitt und verbrannte Kalorien.</p>
                      <div className={`${variant === 'page' ? 'h-80 sm:h-96' : 'h-64'} w-full min-w-0 bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800`}>
                        {visibleStepsData.length === 0 ? (
                          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-xs text-slate-400 gap-2">
                            <span>Keine Schrittdaten vorhanden.</span>
                            <button
                              type="button"
                              onClick={() => handleSelectTab('personal-api')}
                              className="text-indigo-500 hover:text-indigo-600 font-semibold underline underline-offset-2"
                            >
                              Über Garmin Personal API synchronisieren
                            </button>
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height={variant === 'page' ? 320 : 224} minWidth={0}>
                            <ComposedChart data={visibleStepsData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} vertical={false} />
                              <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                              <YAxis yAxisId="left" stroke="#10b981" fontSize={9} />
                              {visibleStepsData.some((d) => d.calories !== undefined && d.calories > 0) && (
                                <YAxis yAxisId="right" orientation="right" stroke="#ef4444" fontSize={9} unit=" kcal" />
                              )}
                              <Tooltip contentStyle={{ borderRadius: '12px' }} />
                              <Legend wrapperStyle={{ fontSize: '10px' }} />
                              <ReferenceLine yAxisId="left" y={10000} stroke="#059669" strokeDasharray="4 4" label={{ value: '10.000 Ziel', position: 'insideTopRight', fill: '#059669', fontSize: 10 }} />
                              <Bar yAxisId="left" dataKey="steps" name="Schritte" fill="#10b981" fillOpacity={0.8} radius={[3, 3, 0, 0]} />
                              {visibleStepsData.some((d) => d.calories !== undefined && d.calories > 0) && (
                                <Bar yAxisId="right" dataKey="calories" name="Kalorien" fill="#ef4444" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                              )}
                              <Line yAxisId="left" type="monotone" dataKey="steps7dAvg" name="7T-Schnitt Schritte" stroke="#047857" strokeWidth={2.5} dot={false} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Tab 6: STRESS */}
                  {activeTab === 'stress' && (
                    <motion.div 
                      key="stress"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-4"
                    >
                      <h4 className="text-sm font-black text-slate-800 dark:text-slate-200">Tägliche Stressbelastung &amp; 7-Tage-Trend</h4>
                      <p className="text-xs text-slate-500">Dein Stress-Score (0–100) berechnet aus der Herzfrequenzvariabilität (HRV) inkl. 7-Tage-Schnitt.</p>
                      <div className={`${variant === 'page' ? 'h-80 sm:h-96' : 'h-64'} w-full min-w-0 bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800`}>
                        {visibleStressData.length === 0 ? (
                          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-xs text-slate-400 gap-2">
                            <span>Keine Stress-Daten vorhanden.</span>
                            <button
                              type="button"
                              onClick={() => handleSelectTab('personal-api')}
                              className="text-indigo-500 hover:text-indigo-600 font-semibold underline underline-offset-2"
                            >
                              Über Garmin Personal API synchronisieren
                            </button>
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height={variant === 'page' ? 320 : 224} minWidth={0}>
                            <ComposedChart data={visibleStressData}>
                              <defs>
                                <linearGradient id="colorStress" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.22}/>
                                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} vertical={false} />
                              <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                              <YAxis domain={[0, 100]} stroke="#94a3b8" fontSize={9} />
                              <Tooltip contentStyle={{ borderRadius: '12px' }} />
                              <Legend wrapperStyle={{ fontSize: '10px' }} />
                              <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Belastungsschwelle (50)', position: 'insideTopRight', fill: '#f59e0b', fontSize: 10 }} />
                              <Area
                                type="monotone"
                                dataKey="avg_stress"
                                name="Ø Stress-Level"
                                stroke="#fca5a5"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorStress)"
                                dot={visibleStressData.length <= 5 ? { r: 4, fill: '#ef4444' } : false}
                              />
                              <Line type="monotone" dataKey="stress7dAvg" name="7T-Schnitt" stroke="#dc2626" strokeWidth={3} dot={false} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Tab 7: ACTIVITIES */}
                  {activeTab === 'activities' && (
                    <motion.div 
                      key="activities"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-black text-slate-800 dark:text-slate-200">Importierte Aktivitäten</h4>
                          <p className="text-xs text-slate-500">Eine Übersicht über deine über die Garmin Personal API synchronisierten Aktivitäten.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {activitySearchQuery && (
                            <span className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold">
                              Gefunden: {filteredActivities.length} / 
                            </span>
                          )}
                          <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-3 py-1 rounded-full font-bold">
                            Insgesamt: {data?.activities.length || 0}
                          </span>
                        </div>
                      </div>

                      {/* Search Bar */}
                      <div className="relative">
                        <input
                          id="activity-search-input"
                          type="text"
                          value={activitySearchQuery}
                          onChange={(e) => setActivitySearchQuery(e.target.value)}
                          placeholder="Aktivitäten nach Name, Typ oder Datum filtern..."
                          className="w-full px-4 py-2 text-xs bg-slate-50 dark:bg-slate-850 border border-slate-150 dark:border-slate-800 rounded-xl focus:outline-none focus:border-indigo-500 text-slate-700 dark:text-slate-300 placeholder-slate-400"
                        />
                        {activitySearchQuery && (
                          <button
                            id="clear-activity-search"
                            onClick={() => setActivitySearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      <div className={`${variant === 'page' ? 'max-h-[55vh]' : 'max-h-[300px]'} overflow-y-auto border border-slate-150 dark:border-slate-800 rounded-2xl`}>
                        {filteredActivities.length === 0 ? (
                          <div className="p-8 text-center text-xs text-slate-500">
                            Keine Aktivitäten gefunden, die dem Suchbegriff entsprechen.
                          </div>
                        ) : (
                          <>
                            <table className="w-full text-left border-collapse text-xs">
                              <thead className="sticky top-0 z-10">
                                <tr className="bg-slate-50 dark:bg-slate-850 border-b border-slate-150 dark:border-slate-800 text-slate-400 font-bold uppercase tracking-wider">
                                  <th className="p-3">Aktivität</th>
                                  <th className="p-3">Datum</th>
                                  <th className="p-3">Distanz</th>
                                  <th className="p-3">Dauer</th>
                                  <th className="p-3">Höhenmeter</th>
                                  <th className="p-3">Kalorien</th>
                                  <th className="p-3 text-right">Aktion</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                                {filteredActivities.slice(0, activitiesVisibleCount).map((act) => (
                                  <tr key={act.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/40">
                                    <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">
                                      <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span>{isRunningType(act.type, act.name) ? '🏃' : isCyclingType(act.type, act.name) ? '🚴' : '🏅'}</span>
                                          <span>{act.name}</span>
                                          {!act.points_json && (
                                            <span className="text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-normal px-1.5 py-0.5 rounded border border-slate-200/50 dark:border-slate-700/50 cursor-help inline-flex shrink-0" title="Diese Aktivität enthält keine GPS-Spur in der SQLite-Datenbank. Beim Laden wird eine virtuelle Route erzeugt.">
                                              NUR STATS
                                            </span>
                                          )}
                                          {act.location && (
                                            <span className="text-[9px] bg-indigo-55/70 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-bold px-1.5 py-0.5 rounded border border-indigo-100/30 dark:border-indigo-900/30 shrink-0" title="Standort">
                                              📍 {act.location}
                                            </span>
                                          )}
                                        </div>
                                        {act.description && (
                                          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium max-w-md italic tracking-wide mt-0.5">
                                            {act.description}
                                          </p>
                                        )}
                                      </div>
                                    </td>
                                    <td className="p-3 text-slate-500">{act.date}</td>
                                    <td className="p-3">{act.distance.toFixed(1)} km</td>
                                    <td className="p-3">{formatMinutes(act.duration / 60)}</td>
                                    <td className="p-3">
                                      {act.ascent !== undefined && act.ascent !== null ? `+${Math.round(act.ascent)}m` : '-'}
                                    </td>
                                    <td className="p-3">
                                      {act.calories !== undefined && act.calories !== null ? `${Math.round(act.calories)} kcal` : '-'}
                                    </td>
                                    <td className="p-3 text-right">
                                      {onLoadTrack && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleLoadActivity(act);
                                          }}
                                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-md text-[10px] cursor-pointer shadow-xs transition-colors"
                                          title="In Workspace laden"
                                        >
                                          In Workspace laden
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {filteredActivities.length > activitiesVisibleCount && (
                              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-850 border-t border-slate-150 dark:border-slate-800 text-xs text-slate-500">
                                <span>
                                  {Math.min(activitiesVisibleCount, filteredActivities.length)} von {filteredActivities.length} Aktivitäten angezeigt
                                </span>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setActivitiesVisibleCount((c) => c + 100)}
                                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                  >
                                    +100 laden
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setActivitiesVisibleCount(filteredActivities.length)}
                                    className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors"
                                  >
                                    Alle ({filteredActivities.length})
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Tab 8: ERWEITERTE ANALYSE */}
                  {activeTab === 'analytics' && (
                    <motion.div
                      key="analytics"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-6 flex-1"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-black text-slate-850 dark:text-slate-100 flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-orange-500" />
                            Erweiterte Gesundheits- und Leistungsanalyse
                          </h4>
                          <p className="text-xs text-slate-500">
                            Tiefgehende mathematische Analysen und Korrelationen deiner Garmin-Historie.
                          </p>
                        </div>
                        {isAnalyticsLoading && (
                          <div className="flex items-center gap-1.5 text-xs text-orange-600 dark:text-orange-400 font-bold">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            Berechne Korrelationen...
                          </div>
                        )}
                      </div>

                      {/* Diagram 4: 5-Axis Athlete Radar */}
                      {athleteRadarData.length > 0 && (
                        <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-4">
                          <div>
                            <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                              <Activity className="w-3.5 h-3.5 text-orange-500" />
                              5-Achsen Athleten-Radar (Letzte 30 Tage vs. Langzeitschnitt)
                            </h5>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              Normierter Formvergleich (0–100 Pkt.) über Umfang, Bergfestigkeit, Kardio-Effizienz, Schlaf-Qualität und Alltags-Resilienz.
                            </p>
                          </div>
                          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                            <div className="lg:col-span-7 h-64 w-full min-w-0">
                              <ResponsiveContainer width="100%" height={256} minWidth={0}>
                                <RadarChart data={athleteRadarData} cx="50%" cy="50%" outerRadius="74%">
                                  <PolarGrid stroke="#94a3b8" strokeOpacity={0.25} />
                                  <PolarAngleAxis dataKey="axis" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 700 }} />
                                  <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                                  <Radar name="Letzte 30 Tage" dataKey="recent" stroke="#f97316" fill="#f97316" fillOpacity={0.35} strokeWidth={2.5} />
                                  <Radar name="Langzeitschnitt" dataKey="baseline" stroke="#6366f1" fill="#6366f1" fillOpacity={0.18} strokeWidth={2} strokeDasharray="4 4" />
                                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                                  <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '11px' }} />
                                </RadarChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="lg:col-span-5 space-y-2">
                              {athleteRadarData.map((row) => {
                                const diff = row.recent - row.baseline;
                                return (
                                  <div key={row.axis} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                                    <span className="font-bold text-slate-700 dark:text-slate-200">{row.axis}</span>
                                    <div className="flex items-center gap-2 font-mono tabular-nums">
                                      <span className="font-black text-orange-600 dark:text-orange-400">{row.recent}</span>
                                      <span className="text-[10px] text-slate-400">/ Basis {row.baseline}</span>
                                      <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded ${diff >= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'}`}>
                                        {diff >= 0 ? '+' : ''}{diff}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      {!analyticsData ? (
                        <div className="p-12 text-center bg-white dark:bg-slate-850 rounded-3xl border border-slate-150 dark:border-slate-800/80 flex flex-col items-center justify-center space-y-3">
                          <AlertCircle className="w-8 h-8 text-slate-400" />
                          <p className="text-xs text-slate-500 max-w-sm">
                            Nicht genügend Daten für tiefe mathematische Korrelationen vorhanden oder Berechnungen laufen noch.
                          </p>
                          <p className="text-[10px] text-slate-400">
                            Bitte synchronisiere Garmin-Daten über die Personal API, die Schlaf-, Stress- und Aktivitätsdaten enthalten.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-6">
                          {/* Top row: Sleep-Stress Pearson Correlation */}
                          <div className="grid grid-cols-1 gap-6">
                            
                            {/* Card 1: Sleep vs Stress */}
                            <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-4">
                              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/60 pb-2">
                                <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                                  Schlafqualität vs. Alltagsstress
                                </h5>
                                <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                                  Math.abs(analyticsData.sleepStressCorrelation.coefficient) > 0.3 
                                    ? 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400' 
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                }`}>
                                  r = {analyticsData.sleepStressCorrelation.coefficient.toFixed(2)}
                                </span>
                              </div>
                              
                              <p className="text-xs text-slate-600 dark:text-slate-350 leading-relaxed font-medium">
                                <span className="font-bold text-slate-800 dark:text-slate-100">Analyse: </span>
                                {analyticsData.sleepStressCorrelation.interpretation}
                              </p>

                              {/* Small explanatory visual */}
                              <div className="text-[10px] text-slate-400 leading-relaxed bg-slate-50/50 dark:bg-slate-900/20 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                                <p className="font-bold text-slate-500 mb-1">💡 Verständnis:</p>
                                Ein negativer Pearson-Koeffizient (r &lt; 0) bedeutet, dass längere Schlafdauer signifikant mit geringerem durchschnittlichen Stress tagsüber korreliert. Je näher der Wert bei -1 liegt, desto stärker ist dieser beruhigende Effekt.
                              </div>
                            </div>
                          </div>

                          {/* Middle row: Fitness Adaption (RHR vs. Training Volume) */}
                          <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-4">
                            <div>
                              <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                                Aerobe Fitness-Adaption (Wöchentliches Trainingsvolumen vs. Ruhepuls)
                              </h5>
                              <p className="text-[10px] text-slate-400 mt-1">
                                Verfolgt, wie sich ein steigendes wöchentliches Lauf-/Fahrradvolumen langfristig senkend auf deinen durchschnittlichen Ruhepuls (RHR) auswirkt.
                              </p>
                            </div>

                            {analyticsData.weeklyRhrTrainingTrend && analyticsData.weeklyRhrTrainingTrend.length > 0 ? (
                              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-center">
                                <div className="lg:col-span-3 h-48 w-full">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={analyticsData.weeklyRhrTrainingTrend.slice(-12)}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                      <XAxis dataKey="week" stroke="#94a3b8" fontSize={9} />
                                      <YAxis yAxisId="left" stroke="#ef4444" fontSize={9} domain={['dataMin - 2', 'dataMax + 2']} label={{ value: 'Puls (bpm)', angle: -90, position: 'insideLeft', style: {fontSize: 8} }} />
                                      <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={9} label={{ value: 'Aktivität (km)', angle: 90, position: 'insideRight', style: {fontSize: 8} }} />
                                      <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '11px' }} />
                                      <Line yAxisId="left" type="monotone" dataKey="avgRhr" name="Mittel Ruhepuls" stroke="#ef4444" strokeWidth={3} activeDot={{ r: 6 }} />
                                      <Line yAxisId="right" type="monotone" dataKey="totalDistance" name="Gesamtstrecke (km)" stroke="#10b981" strokeWidth={2} dot={true} />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </div>
                                <div className="p-4 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-100 dark:border-slate-800 space-y-3">
                                  <h6 className="text-[11px] font-bold text-slate-700 dark:text-slate-300">📈 Leistungsdiagnostik</h6>
                                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                    Mit zunehmender kardiovaskulärer Fitness vergrößert sich das Schlagvolumen deines Herzens. Dadurch muss es im Ruhezustand seltener schlagen, um den Körper mit Sauerstoff zu versorgen.
                                  </p>
                                  <p className="text-[9px] text-rose-500 dark:text-rose-400 italic">
                                    Tipp: Ein dauerhaft sinkender Ruhepuls bei gleichem oder höherem Trainingsvolumen signalisiert ein verbessertes Fitnesslevel!
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="h-40 bg-slate-50 dark:bg-slate-900/30 rounded-xl flex items-center justify-center text-xs text-slate-400 border border-slate-100 dark:border-slate-800">
                                Keine Trainingsvolumen- oder Pulstrends im Verlauf gefunden.
                              </div>
                            )}
                          </div>

                          {/* Bottom Row: Weekday Trends & Monthly Sleep Trends */}
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            
                            {/* Weekday Trends */}
                            <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-4">
                              <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                                Wochentags-Muster (Aktivität & Belastung)
                              </h5>
                              <div className="h-44 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={analyticsData.weekdayTrends}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                    <XAxis dataKey="dayName" stroke="#94a3b8" fontSize={9} />
                                    <YAxis yAxisId="left" stroke="#10b981" fontSize={8} />
                                    <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={8} domain={[0, 100]} />
                                    <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '10px' }} />
                                    <Bar yAxisId="left" dataKey="avgSteps" name="Mittel Schritte" fill="#10b981" radius={[3, 3, 0, 0]} />
                                    <Line yAxisId="right" type="monotone" dataKey="avgStress" name="Ø Stress-Wert" stroke="#f59e0b" strokeWidth={2} />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            {/* Monthly Sleep Quality Trends */}
                            <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-4">
                              <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                                Monatliche Schlafdauer & Tiefschlaf
                              </h5>
                              {analyticsData.monthlySleepAnalysis && analyticsData.monthlySleepAnalysis.length > 0 ? (
                                <div className="h-44 w-full">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={analyticsData.monthlySleepAnalysis}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                      <XAxis dataKey="month" stroke="#94a3b8" fontSize={9} />
                                      <YAxis unit="h" tickFormatter={(v) => (v / 60).toFixed(0)} stroke="#94a3b8" fontSize={8} />
                                      <Tooltip 
                                        contentStyle={{ borderRadius: '12px', fontSize: '10px' }}
                                        formatter={(val: any, name: any) => [formatMinutes(Number(val)), name]}
                                      />
                                      <Area type="monotone" dataKey="avgDuration" name="Gesamtschlaf" stroke="#6366f1" fill="#818cf8" fillOpacity={0.2} strokeWidth={2.5} />
                                      <Area type="monotone" dataKey="avgDeep" name="Tiefschlaf" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.3} strokeWidth={1.5} />
                                    </AreaChart>
                                  </ResponsiveContainer>
                                </div>
                              ) : (
                                <div className="h-44 bg-slate-50 dark:bg-slate-900/30 rounded-xl flex items-center justify-center text-xs text-slate-400 border border-slate-100 dark:border-slate-800">
                                  Keine historischen Schlafdaten für eine Monatsanalyse vorhanden.
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Row 4: Sport efficiency card */}
                          <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-4">
                            <div>
                              <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                                Sportarten-Effizienz & Kalorienverbrauch
                              </h5>
                              <p className="text-[10px] text-slate-400 mt-1">
                                Vergleich des stündlichen Kalorienverbrauchs (kcal/h) und der durchschnittlichen Herzfrequenz nach Aktivitätstyp.
                              </p>
                            </div>

                            {analyticsData.sportEfficiency && analyticsData.sportEfficiency.length > 0 ? (
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {analyticsData.sportEfficiency.map((sport: any) => (
                                  <div key={sport.type} className="p-4 bg-slate-50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800 rounded-xl space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-black capitalize text-slate-800 dark:text-slate-200">
                                        {sport.type === 'running' ? '🏃 Laufen' : sport.type === 'cycling' ? '🚴 Radfahren' : `🏅 ${sport.type}`}
                                      </span>
                                      <span className="text-[10px] text-slate-400">
                                        {sport.count}x ausgeführt
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                                      <div className="p-2 bg-white dark:bg-slate-950/40 rounded-lg">
                                        <p className="text-slate-400">Verbrennung</p>
                                        <p className="font-extrabold text-orange-600 dark:text-orange-400 text-xs">
                                          {Math.round(sport.calorieBurnRatePerHour)} kcal/h
                                        </p>
                                      </div>
                                      <div className="p-2 bg-white dark:bg-slate-950/40 rounded-lg">
                                        <p className="text-slate-400">Ø Puls</p>
                                        <p className="font-extrabold text-rose-600 dark:text-rose-400 text-xs">
                                          {sport.avgHr ? `${Math.round(sport.avgHr)} bpm` : '-'}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="text-[9px] text-slate-400 pt-1 flex justify-between">
                                      <span>Gesamtdistanz: {sport.totalDistance.toFixed(1)} km</span>
                                      <span>Ø Dauer: {formatMinutes(sport.totalDuration / sport.count / 60)}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="p-6 bg-slate-50 dark:bg-slate-900/30 rounded-xl text-center text-xs text-slate-400 border border-slate-100 dark:border-slate-800">
                                Keine Sportaktivitäten in der Garmin-Datenbank für eine Effizienzanalyse gefunden.
                              </div>
                            )}
                          </div>

                          {/* Row 5: Multi-variable Performance Correlations Scatter plot */}
                          <div className="bg-white dark:bg-slate-850 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-6">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                              <div>
                                <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                                  Multi-Variable Leistungs-Korrelationen
                                </h5>
                                <p className="text-[10px] text-slate-400 mt-1">
                                  Visualisiert die Wechselwirkungen zwischen Puls, Geschwindigkeit und bewältigten Höhenmetern in all deinen importierten Garmin-Aktivitäten.
                                </p>
                              </div>

                              {/* Selected Correlation Selector */}
                              <div className="flex flex-wrap gap-1 bg-slate-50 dark:bg-slate-900/50 p-1 rounded-xl border border-slate-100 dark:border-slate-800">
                                <button
                                  onClick={() => setSelectedCorrelation('hr_speed')}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    selectedCorrelation === 'hr_speed'
                                      ? 'bg-orange-600 text-white shadow-xs'
                                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  Puls vs. Tempo
                                </button>
                                <button
                                  onClick={() => setSelectedCorrelation('speed_ascent')}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    selectedCorrelation === 'speed_ascent'
                                      ? 'bg-orange-600 text-white shadow-xs'
                                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  Tempo vs. Höhenmeter
                                </button>
                                <button
                                  onClick={() => setSelectedCorrelation('hr_ascent')}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    selectedCorrelation === 'hr_ascent'
                                      ? 'bg-orange-600 text-white shadow-xs'
                                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  Puls vs. Höhenmeter
                                </button>
                              </div>
                            </div>

                            {/* Correlation Strength Indicator & Summary */}
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                              {/* Scatter Chart Column */}
                              <div className="lg:col-span-8 flex flex-col space-y-2">
                                {chartData.length === 0 ? (
                                  <div className="h-64 bg-slate-50 dark:bg-slate-900/30 rounded-xl flex flex-col items-center justify-center text-center p-4 border border-slate-150 dark:border-slate-800">
                                    <AlertCircle className="w-7 h-7 text-slate-400 mb-2" />
                                    <p className="text-xs text-slate-500 font-bold">Keine ausreichenden Aktivitätsdaten vorhanden</p>
                                    <p className="text-[10px] text-slate-400 mt-1 max-w-xs">
                                      Für diese Auswertung müssen Aktivitäten mit Pulsdaten (Ø Puls) und Höhendifferenzen in der Garmin-Datenbank hinterlegt sein.
                                    </p>
                                  </div>
                                ) : (
                                  <div className="h-72 w-full bg-slate-50/40 dark:bg-slate-900/10 rounded-xl p-2 border border-slate-100 dark:border-slate-800/80">
                                    <ResponsiveContainer width="100%" height="100%">
                                      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis 
                                          type="number" 
                                          dataKey={correlationDetails.xKey} 
                                          name={correlationDetails.xLabel} 
                                          unit={selectedCorrelation === 'hr_speed' ? ' km/h' : ' m'}
                                          fontSize={9}
                                          stroke="#94a3b8"
                                        />
                                        <YAxis 
                                          type="number" 
                                          dataKey={correlationDetails.yKey} 
                                          name={correlationDetails.yLabel} 
                                          unit={selectedCorrelation === 'speed_ascent' ? ' km/h' : ' bpm'}
                                          fontSize={9}
                                          stroke="#94a3b8"
                                          domain={['auto', 'auto']}
                                        />
                                        <ZAxis type="number" range={[40, 40]} />
                                        <Tooltip content={(props) => {
                                          if (props.active && props.payload && props.payload.length) {
                                            const pt = props.payload[0].payload;
                                            return (
                                              <div className="bg-slate-900/95 text-white p-3 rounded-xl border border-slate-800 shadow-xl text-[11px] space-y-1 max-w-[240px]">
                                                <p className="font-bold text-slate-100 truncate">{pt.name}</p>
                                                <p className="text-[10px] text-slate-400">{pt.date} | {pt.type === 'running' ? '🏃 Laufen' : pt.type === 'cycling' ? '🚴 Radfahren' : pt.type}</p>
                                                <div className="border-t border-slate-800 my-1 pt-1 space-y-0.5">
                                                  <div className="flex justify-between">
                                                    <span className="text-slate-400">Distanz:</span>
                                                    <span className="font-semibold text-slate-200">{pt.distance} km</span>
                                                  </div>
                                                  <div className="flex justify-between">
                                                    <span className="text-slate-400">Dauer:</span>
                                                    <span className="font-semibold text-slate-200">{pt.durationMinutes} min</span>
                                                  </div>
                                                  <div className="flex justify-between">
                                                    <span className="text-slate-400">Tempo:</span>
                                                    <span className="font-bold text-teal-400">{pt.speedKmh} km/h</span>
                                                  </div>
                                                  {pt.avgHr && (
                                                    <div className="flex justify-between">
                                                      <span className="text-slate-400">Ø Puls:</span>
                                                      <span className="font-bold text-rose-400">{pt.avgHr} bpm</span>
                                                    </div>
                                                  )}
                                                  <div className="flex justify-between">
                                                    <span className="text-slate-400">Höhenmeter:</span>
                                                    <span className="font-bold text-amber-400">+{Math.round(pt.ascent)} m</span>
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          }
                                          return null;
                                        }} />
                                        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '10px' }} />
                                        <Scatter name="🏃 Laufen" data={chartGroupedData.running} fill="#f97316" />
                                        <Scatter name="🚴 Radfahren" data={chartGroupedData.cycling} fill="#3b82f6" />
                                        <Scatter name="🏅 Andere" data={chartGroupedData.other} fill="#a855f7" />
                                      </ScatterChart>
                                    </ResponsiveContainer>
                                  </div>
                                )}
                              </div>

                              {/* Interactive Diagnostic / Physiology panel */}
                              <div className="lg:col-span-4 flex flex-col justify-between p-4 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-100 dark:border-slate-800 space-y-4">
                                <div className="space-y-3">
                                  <h6 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase">
                                    {correlationDetails.title}
                                  </h6>

                                  <div className="flex items-center gap-2">
                                    <span className={`text-xs font-extrabold px-2.5 py-1 rounded-lg ${getCorrBadgeColor(correlationDetails.r)}`}>
                                      r = {correlationDetails.r.toFixed(2)}
                                    </span>
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                                      {getCorrStrengthText(correlationDetails.r)}
                                    </span>
                                  </div>

                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                                    {correlationDetails.desc}
                                  </p>
                                </div>

                                <div className="text-[10px] text-orange-600 dark:text-orange-400 leading-relaxed bg-orange-50/20 dark:bg-orange-950/10 p-3 rounded-lg border border-orange-100/50 dark:border-orange-900/20">
                                  <p className="font-bold mb-1">💡 Trainingstipp:</p>
                                  {selectedCorrelation === 'hr_speed' ? (
                                    "Ein flacherer Kurvenverlauf (höheres Tempo bei gleichem oder geringerem Puls) im historischen Vergleich zeigt eine signifikante Ökonomisierung deines Herzkreislaufsystems."
                                  ) : selectedCorrelation === 'speed_ascent' ? (
                                    "Versuche bei stark hügeligen Strecken, deine mechanische Leistung am Berg gezielt zu drosseln, um anaerobe Belastungsspitzen und schnellen Ermüdungsaufbau zu vermeiden."
                                  ) : (
                                    "Achte auf deine Herzfrequenz-Zonen bei langen Anstiegen. Kontrolliertes Klettern in Zone 2 bis 3 schützt vor vorzeitigem Erschöpfen deiner Glykogenspeicher."
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Row 6: 4-Week Training Performance Development Chart */}
                            <div className="bg-white dark:bg-slate-850 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-6">
                              <div>
                                <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                                  Trainingsleistung Entwicklung (Letzte 4 Wochen)
                                </h5>
                                <p className="text-[10px] text-slate-400 mt-1">
                                  Verfolgt deine kardiovaskuläre Effizienz, indem Herzfrequenz- und Geschwindigkeitsentwicklungen über die letzten 4 Wochen basierend auf den importierten Track-Daten korreliert werden.
                                </p>
                              </div>

                              {last4WeeksActivities.length > 0 ? (
                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                                  {/* Chart Section */}
                                  <div className="lg:col-span-8 flex flex-col space-y-2">
                                    <div className="h-72 w-full bg-slate-50/40 dark:bg-slate-900/10 rounded-xl p-2 border border-slate-100 dark:border-slate-800/80">
                                      <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={last4WeeksActivities} margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
                                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                          <XAxis 
                                            dataKey="formattedDate" 
                                            stroke="#94a3b8" 
                                            fontSize={9} 
                                          />
                                          <YAxis 
                                            yAxisId="left" 
                                            stroke="#ef4444" 
                                            fontSize={9} 
                                            domain={['dataMin - 5', 'dataMax + 5']} 
                                            label={{ value: 'Ø Puls (bpm)', angle: -90, position: 'insideLeft', style: {fontSize: 8, fill: '#ef4444'} }} 
                                          />
                                          <YAxis 
                                            yAxisId="right" 
                                            orientation="right" 
                                            stroke="#3b82f6" 
                                            fontSize={9} 
                                            domain={['dataMin - 2', 'dataMax + 2']} 
                                            label={{ value: 'Ø Tempo (km/h)', angle: 90, position: 'insideRight', style: {fontSize: 8, fill: '#3b82f6'} }} 
                                          />
                                          <Tooltip content={(props) => {
                                            if (props.active && props.payload && props.payload.length) {
                                              const pt = props.payload[0].payload;
                                              return (
                                                <div className="bg-slate-900/95 text-white p-3 rounded-xl border border-slate-800 shadow-xl text-[11px] space-y-1">
                                                  <p className="font-bold text-slate-100">{pt.name}</p>
                                                  <p className="text-[10px] text-slate-400">{pt.date}</p>
                                                  <div className="border-t border-slate-800 my-1 pt-1 space-y-0.5">
                                                    <div className="flex justify-between gap-4">
                                                      <span className="text-slate-400">Ø Puls:</span>
                                                      <span className="font-bold text-rose-400">{pt.avgHr > 0 ? `${pt.avgHr} bpm` : 'Keine Pulsdaten'}</span>
                                                    </div>
                                                    <div className="flex justify-between gap-4">
                                                      <span className="text-slate-400">Ø Tempo:</span>
                                                      <span className="font-bold text-blue-400">{pt.avgSpeed} km/h</span>
                                                    </div>
                                                    <div className="flex justify-between gap-4">
                                                      <span className="text-slate-400">Distanz:</span>
                                                      <span className="font-semibold text-slate-200">{pt.distance} km</span>
                                                    </div>
                                                  </div>
                                                </div>
                                              );
                                            }
                                            return null;
                                          }} />
                                          <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '10px' }} />
                                          <Line yAxisId="left" type="monotone" dataKey="avgHr" name="Herzfrequenz (bpm)" stroke="#ef4444" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls />
                                          <Line yAxisId="right" type="monotone" dataKey="avgSpeed" name="Tempo (km/h)" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls />
                                        </LineChart>
                                      </ResponsiveContainer>
                                    </div>
                                  </div>

                                  {/* Physiology Explanation column */}
                                  <div className="lg:col-span-4 flex flex-col justify-between p-4 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-100 dark:border-slate-800 space-y-4">
                                    <div className="space-y-3">
                                      <h6 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase">
                                        Leistungsdiagnostik & Trend
                                      </h6>
                                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                                        Hier siehst du den direkten Verlauf deiner Trainingseinheiten der letzten 4 Wochen. 
                                      </p>
                                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                                        Ein positiver Trainingseffekt wird dadurch angezeigt, dass deine <span className="text-blue-600 dark:text-blue-400 font-bold">Geschwindigkeitskurve ansteigt</span>, während deine <span className="text-rose-600 dark:text-rose-400 font-bold">Herzfrequenzkurve sinkt oder stabil bleibt</span>. Das bedeutet, du läufst oder fährst schneller bei geringerer kardialer Belastung!
                                      </p>
                                    </div>

                                    <div className="text-[10px] text-orange-600 dark:text-orange-400 leading-relaxed bg-orange-50/20 dark:bg-orange-950/10 p-3 rounded-lg border border-orange-100/50 dark:border-orange-900/20">
                                      <p className="font-bold mb-1">📊 Auswertungsdaten:</p>
                                      Es wurden <span className="font-bold">{last4WeeksActivities.length} Aktivitäten</span> in den letzten 4 Wochen analysiert. Nutze den Track-Import oder Garmin-Connect, um weitere Läufe oder Fahrten hinzuzufügen.
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="p-8 text-center bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-100 dark:border-slate-800">
                                  <AlertCircle className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                                  <p className="text-xs text-slate-500 font-bold">Keine Aktivitäten in den letzten 4 Wochen gefunden</p>
                                  <p className="text-[10px] text-slate-400 mt-1 max-w-sm mx-auto">
                                    Es wurden keine Garmin-Aktivitäten mit einem Datum in den letzten 4 Wochen gefunden. Importiere Aktivitäten oder lade Garmin-Daten hoch, um diesen Verlauf zu aktivieren.
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}

                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
      </motion.div>
  );

  if (variant === 'page') {
    return dashboardCard;
  }

  return (
    <div 
      className="fixed inset-0 z-[2000] flex items-center justify-center p-2 sm:p-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-xs cursor-pointer" 
      onClick={onClose}
    >
      {dashboardCard}
    </div>
  );
};
