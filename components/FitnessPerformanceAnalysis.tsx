import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Activity, Zap, Heart, TrendingUp, Calendar, Filter, Award, 
  Info, BarChart2, CheckCircle2, ChevronRight, Play, Maximize2,
  Database, RefreshCw, Layers, Sparkles, Sliders, AlertTriangle,
  Upload, Target, Trash2, Plus, FileText
} from 'lucide-react';
import { 
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine, ScatterChart, Scatter
} from 'recharts';
import { getApiUrl } from '../utils/api';
import { parseGPX } from '../utils/gpxUtils';

interface FitnessPerformanceAnalysisProps {
  onClose: () => void;
  userWeight: number;
  userAge: number;
  userMaxHr: number;
  ftp: number;
  onUpdateFtp?: (ftp: number) => void;
  onUpdateMaxHr?: (maxHr: number) => void;
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

export default function FitnessPerformanceAnalysis({
  onClose,
  userWeight,
  userAge,
  userMaxHr: initialMaxHr,
  ftp: initialFtp,
  onUpdateFtp,
  onUpdateMaxHr
}: FitnessPerformanceAnalysisProps) {
  // Local adjustable sports metrics
  const [ftp, setFtp] = useState(initialFtp || 250);
  const [maxHr, setMaxHr] = useState(initialMaxHr || 185);
  const [rhr, setRhr] = useState(55); // Default Resting Heart Rate for calculations

  const [activities, setActivities] = useState<GarminActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // UI filter states
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Selected single activity for detail inspection
  const [selectedActivity, setSelectedActivity] = useState<GarminActivity | null>(null);
  const [activityPoints, setActivityPoints] = useState<any[]>([]);
  const [loadingPoints, setLoadingPoints] = useState(false);

  // Active sub-tabs in the science dashboard
  // "ctl" = CTL/ATL/TSB Fitness Model
  // "power" = Power Duration MMP Curve
  // "zones" = Training Zone Polarisation
  // "activities" = Detailed list
  // "goals" = Goals & Training Plan
  const [activeTab, setActiveTab] = useState<'ctl' | 'power' | 'zones' | 'activities' | 'goals'>('ctl');

  // Goal and Trainingsplan States
  const [goalType, setGoalType] = useState<'marathon' | 'halfmarathon' | 'tour'>('marathon');
  const [goalName, setGoalName] = useState('Saison-Highlight');
  const [goalDistance, setGoalDistance] = useState<number>(42.2);
  const [goalElevation, setGoalElevation] = useState<number>(300);
  const [goalSport, setGoalSport] = useState<'running' | 'cycling'>('running');
  const [uploadedGpxTracks, setUploadedGpxTracks] = useState<any[]>([]);
  const [gpxLoading, setGpxLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [planDuration, setPlanDuration] = useState<4 | 8 | 12>(8);
  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number>(0);
  const [historyAnalysisRange, setHistoryAnalysisRange] = useState<'1week' | '4weeks' | 'all'>('4weeks');
  const [libraryTracks, setLibraryTracks] = useState<any[]>([]);
  const [performanceMetric, setPerformanceMetric] = useState<'speed' | 'hr' | 'both'>('both');

  // Sync default presets when goalType changes
  useEffect(() => {
    if (goalType === 'marathon') {
      setGoalName('Mein Marathon');
      setGoalDistance(42.2);
      setGoalElevation(300);
      setGoalSport('running');
    } else if (goalType === 'halfmarathon') {
      setGoalName('Mein Halbmarathon');
      setGoalDistance(21.1);
      setGoalElevation(150);
      setGoalSport('running');
    } else if (goalType === 'tour') {
      setGoalName('Alpenpass-Herausforderung / Radtour');
      setGoalDistance(100);
      setGoalElevation(1500);
      setGoalSport('cycling');
    }
  }, [goalType]);

  // Handle Drag & Drop for GPX
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processGpxFiles(Array.from(e.dataTransfer.files));
    }
  };

  const processGpxFiles = async (files: File[]) => {
    setGpxLoading(true);
    const loadedTracks: any[] = [];
    let addedDistance = 0;
    let addedElevation = 0;

    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.gpx')) continue;
      try {
        const text = await file.text();
        const parsed = await parseGPX(text, file.name);
        if (parsed) {
          loadedTracks.push({
            id: parsed.id,
            name: parsed.name || file.name.replace(/\.[^/.]+$/, ""),
            distance: parsed.distance,
            ascent: parsed.ascent,
            descent: parsed.descent,
            maxSlope: parsed.maxSlope,
            pointsCount: parsed.points.length
          });
          addedDistance += parsed.distance;
          addedElevation += parsed.ascent;
        }
      } catch (err) {
        console.error("Error reading GPX file for goal:", err);
      }
    }

    if (loadedTracks.length > 0) {
      setUploadedGpxTracks(prev => [...prev, ...loadedTracks]);
      // If first upload of custom tour, we can set values directly. Otherwise we add them.
      setGoalDistance(prev => {
        if (uploadedGpxTracks.length === 0) return parseFloat(addedDistance.toFixed(1));
        return parseFloat((prev + addedDistance).toFixed(1));
      });
      setGoalElevation(prev => {
        if (uploadedGpxTracks.length === 0) return Math.round(addedElevation);
        return Math.round(prev + addedElevation);
      });
      // Automatically toggle sport type if it detects activity type or long distance
      const hasCycling = loadedTracks.some(t => t.name.toLowerCase().includes('cycle') || t.name.toLowerCase().includes('bike') || t.distance > 30);
      if (hasCycling) {
        setGoalSport('cycling');
      } else {
        setGoalSport('running');
      }
    }
    setGpxLoading(false);
  };

  const handleGpxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    await processGpxFiles(Array.from(files));
  };

  const removeUploadedTrack = (id: string) => {
    const trackToRemove = uploadedGpxTracks.find(t => t.id === id);
    if (!trackToRemove) return;
    setUploadedGpxTracks(prev => prev.filter(t => t.id !== id));
    setGoalDistance(prev => Math.max(0, parseFloat((prev - trackToRemove.distance).toFixed(1))));
    setGoalElevation(prev => Math.max(0, Math.round(prev - trackToRemove.ascent)));
  };

  // Load activities on mount
  const fetchHealthMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(getApiUrl("/api/health-metrics"));
      if (!response.ok) throw new Error("Konnte Daten nicht laden");
      const result = await response.json();
      if (result.success && result.data && result.data.activities) {
        setActivities(result.data.activities);
      } else {
        throw new Error("Fehler beim Verarbeiten der Server-Antwort");
      }

      // Also fetch library tracks for a complete view of loaded track data
      const libResponse = await fetch(getApiUrl("/api/library"));
      if (libResponse.ok) {
        const libResult = await libResponse.json();
        if (libResult.success && libResult.tracks) {
          setLibraryTracks(libResult.tracks);
        }
      }
    } catch (err: any) {
      console.error("Error loading activities for science:", err);
      setError(err.message || "Verbindung zum Server fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealthMetrics();
  }, [fetchHealthMetrics]);

  // Sync props to state if they change
  useEffect(() => {
    if (initialFtp) setFtp(initialFtp);
  }, [initialFtp]);

  useEffect(() => {
    if (initialMaxHr) setMaxHr(initialMaxHr);
  }, [initialMaxHr]);

  // Handle saving FTP / Max HR changes to parents
  const handleSaveFtp = (val: number) => {
    setFtp(val);
    if (onUpdateFtp) onUpdateFtp(val);
  };

  const handleSaveMaxHr = (val: number) => {
    setMaxHr(val);
    if (onUpdateMaxHr) onUpdateMaxHr(val);
  };

  // Detailed points loader for inspector
  useEffect(() => {
    if (!selectedActivity) {
      setActivityPoints([]);
      return;
    }
    
    if (selectedActivity.points_json) {
      try {
        setActivityPoints(JSON.parse(selectedActivity.points_json));
        return;
      } catch (e) {
        console.error("Error parsing points_json direct:", e);
      }
    }

    // Fallback: fetch single activity (if server supports it or points list)
    setActivityPoints([]);
  }, [selectedActivity]);

  // Fast power curve sliding window peak pre-calculation per activity
  const calculatedActivities = useMemo(() => {
    return activities.map(act => {
      let points: any[] = [];
      if (act.points_json) {
        try {
          points = JSON.parse(act.points_json);
        } catch (e) {}
      }

      const powerVals = points.map(p => p.power).filter(p => p !== undefined && p !== null);
      const hrVals = points.map(p => p.hr).filter(p => p !== undefined && p !== null);
      
      let calculatedTss = 0;
      let calculatedNp = 0;
      let calculatedIf = 0.7;
      let calculatedVi = 1.0;
      let hasPower = powerVals.length > 5;
      let hasHr = hrVals.length > 5;

      // Peak powers calculation for this activity
      const peaks: Record<number, number> = {};
      if (hasPower) {
        // Calculate NP (Normalized Power)
        let rollSum = 0;
        const windowSize = 30;
        const power30s: number[] = [];
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          const pwr = p.power || 0;
          rollSum += pwr;
          if (i >= windowSize) {
            rollSum -= points[i - windowSize].power || 0;
            power30s.push(rollSum / windowSize);
          } else {
            power30s.push(rollSum / (i + 1));
          }
        }
        const sum4th = power30s.reduce((sum, p) => sum + Math.pow(p, 4), 0);
        calculatedNp = Math.round(Math.pow(sum4th / power30s.length, 0.25));
        const avgPower = powerVals.reduce((a, b) => a + b, 0) / powerVals.length;
        calculatedVi = avgPower > 0 ? calculatedNp / avgPower : 1.0;
        
        calculatedIf = ftp > 0 ? calculatedNp / ftp : 0.7;
        calculatedTss = ftp > 0 ? ((act.duration * calculatedNp * calculatedIf) / (ftp * 3600)) * 100 : 60;

        // Sliding window peaks for Power Duration MMP (1s, 5s, 15s, 1m, 5m, 20m, 1h)
        const durations = [1, 5, 15, 60, 300, 1200, 3600];
        const powers = points.map(p => p.power || 0);
        for (const d of durations) {
          if (powers.length < d) continue;
          let currentSum = 0;
          for (let i = 0; i < d; i++) currentSum += powers[i];
          let maxSum = currentSum;
          for (let i = d; i < powers.length; i++) {
            currentSum += powers[i] - powers[i - d];
            if (currentSum > maxSum) maxSum = currentSum;
          }
          peaks[d] = Math.round(maxSum / d);
        }
      } else if (act.avg_hr || hrVals.length > 0) {
        // TRIMP or hrTSS approximation
        const avgHr = act.avg_hr || (hrVals.reduce((a, b) => a + b, 0) / hrVals.length);
        const lthr = maxHr * 0.85; // Est Lactate Threshold HR
        calculatedIf = avgHr / lthr;
        const durationHours = act.duration / 3600;
        // hrTSS estimate
        calculatedTss = durationHours * Math.pow(calculatedIf, 2) * 100;
      } else {
        // Default estimate based on type
        const isCycling = act.type.toLowerCase().includes('cycle') || act.type.toLowerCase().includes('bike');
        const intensity = isCycling ? 45 : 65; 
        calculatedTss = (act.duration / 3600) * intensity;
      }

      return {
        ...act,
        tss: Math.round(calculatedTss),
        np: calculatedNp,
        intensityFactor: calculatedIf,
        variabilityIndex: calculatedVi,
        hasPower,
        hasHr,
        peaks,
        pointsCount: points.length
      };
    });
  }, [activities, ftp, maxHr]);

  // Combine Garmin activities and Track Library tracks for a unified training performance dataset
  const combinedTrainings = useMemo(() => {
    const list: {
      id: string;
      name: string;
      type: string;
      date: string;
      distance: number;
      duration: number;
      avg_hr?: number;
      ascent?: number;
      isTrackLibraryItem: boolean;
    }[] = [];

    // Add Garmin activities
    activities.forEach(act => {
      list.push({
        id: act.id,
        name: act.name,
        type: act.type || 'running',
        date: act.date,
        distance: act.distance,
        duration: act.duration,
        avg_hr: act.avg_hr,
        ascent: act.ascent,
        isTrackLibraryItem: false
      });
    });

    // Add Track Library tracks (if they are not already in activities by ID)
    libraryTracks.forEach(track => {
      if (!list.some(item => item.id === track.id)) {
        const trackDate = track.dateCreated ? track.dateCreated.split('T')[0] : new Date().toISOString().split('T')[0];
        list.push({
          id: track.id,
          name: track.name,
          type: track.activityType || 'running',
          date: trackDate,
          distance: track.distance,
          duration: track.duration,
          avg_hr: undefined,
          ascent: track.ascent,
          isTrackLibraryItem: true
        });
      }
    });

    return list;
  }, [activities, libraryTracks]);

  // Performance Trend Data over the last 4 weeks (28 days relative to the latest session)
  const performanceTrendData = useMemo(() => {
    if (combinedTrainings.length === 0) return [];

    // Sort ascending by date
    const sorted = [...combinedTrainings]
      .filter(t => t.date && t.distance > 0 && t.duration > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (sorted.length === 0) return [];

    // Find the latest date in the set
    const latestDateStr = sorted[sorted.length - 1].date;
    const latestDate = new Date(latestDateStr);

    // Cutoff date is 28 days before latestDate
    const cutoffDate = new Date(latestDate);
    cutoffDate.setDate(cutoffDate.getDate() - 28);

    // Filter items in the last 4 weeks (28 days)
    const last4Weeks = sorted.filter(item => new Date(item.date) >= cutoffDate);

    return last4Weeks.map(item => {
      const speed = (item.distance * 3600) / item.duration; // in km/h
      
      // Pace: min/km
      const paceMinDec = item.distance > 0 ? (item.duration / 60) / item.distance : 0;
      const paceMin = Math.floor(paceMinDec);
      const paceSec = Math.round((paceMinDec - paceMin) * 60);
      const formattedPace = item.distance > 0 ? `${paceMin}:${paceSec < 10 ? '0' : ''}${paceSec}` : '-';

      return {
        id: item.id,
        name: item.name,
        date: item.date,
        formattedDate: new Date(item.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
        distance: parseFloat(item.distance.toFixed(1)),
        duration: item.duration,
        avg_hr: item.avg_hr || null,
        speed: parseFloat(speed.toFixed(1)),
        pace: parseFloat(paceMinDec.toFixed(2)),
        formattedPace,
        type: item.type,
        isTrack: item.isTrackLibraryItem
      };
    });
  }, [combinedTrainings]);

  // Performance trends statistics
  const performanceStats = useMemo(() => {
    if (performanceTrendData.length === 0) {
      return {
        avgSpeed: 0,
        avgHr: 0,
        totalDistance: 0,
        workoutCount: 0,
        speedTrend: 'stable',
        hrTrend: 'stable',
        efficiencyTrend: 'stable',
        efficiencyPercent: 0,
        speedDiff: 0,
        hrDiff: 0
      };
    }

    const workouts = performanceTrendData;
    const count = workouts.length;
    
    const totalDist = workouts.reduce((sum, w) => sum + w.distance, 0);
    const totalHr = workouts.filter(w => w.avg_hr).reduce((sum, w) => sum + (w.avg_hr || 0), 0);
    const hrCount = workouts.filter(w => w.avg_hr).length;
    
    const avgSpeed = workouts.reduce((sum, w) => sum + w.speed, 0) / count;
    const avgHr = hrCount > 0 ? totalHr / hrCount : 0;

    // Divide into 2 halves for trend comparison: Recent 14 days and Previous 14 days
    const sorted = [...workouts].sort((a, b) => b.date.localeCompare(a.date));
    const latestDate = new Date(sorted[0].date);
    const midCutoff = new Date(latestDate);
    midCutoff.setDate(midCutoff.getDate() - 14);

    const recentHalf = workouts.filter(w => new Date(w.date) >= midCutoff);
    const previousHalf = workouts.filter(w => new Date(w.date) < midCutoff);

    let speedTrend = 'stable';
    let hrTrend = 'stable';
    let efficiencyTrend = 'stable';
    
    let speedDiff = 0;
    let hrDiff = 0;
    let efficiencyPercent = 0;

    if (recentHalf.length > 0 && previousHalf.length > 0) {
      const recentAvgSpeed = recentHalf.reduce((sum, w) => sum + w.speed, 0) / recentHalf.length;
      const prevAvgSpeed = previousHalf.reduce((sum, w) => sum + w.speed, 0) / previousHalf.length;
      
      speedDiff = recentAvgSpeed - prevAvgSpeed;
      if (speedDiff > 0.3) speedTrend = 'up';
      else if (speedDiff < -0.3) speedTrend = 'down';

      const recentHrActs = recentHalf.filter(w => w.avg_hr);
      const prevHrActs = previousHalf.filter(w => w.avg_hr);

      if (recentHrActs.length > 0 && prevHrActs.length > 0) {
        const recentAvgHr = recentHrActs.reduce((sum, w) => sum + (w.avg_hr || 0), 0) / recentHrActs.length;
        const prevAvgHr = prevHrActs.reduce((sum, w) => sum + (w.avg_hr || 0), 0) / prevHrActs.length;
        
        hrDiff = recentAvgHr - prevAvgHr;
        if (hrDiff > 1.5) hrTrend = 'up';
        else if (hrDiff < -1.5) hrTrend = 'down';

        // Efficiency Factor = Speed / HR
        const recentEf = recentAvgSpeed / recentAvgHr;
        const prevEf = prevAvgSpeed / prevAvgHr;
        
        if (prevEf > 0) {
          efficiencyPercent = ((recentEf - prevEf) / prevEf) * 100;
          if (efficiencyPercent > 1) efficiencyTrend = 'up';
          else if (efficiencyPercent < -1) efficiencyTrend = 'down';
        }
      }
    }

    return {
      avgSpeed: parseFloat(avgSpeed.toFixed(1)),
      avgHr: Math.round(avgHr),
      totalDistance: parseFloat(totalDist.toFixed(1)),
      workoutCount: count,
      speedTrend,
      hrTrend,
      efficiencyTrend,
      efficiencyPercent: parseFloat(efficiencyPercent.toFixed(1)),
      speedDiff: parseFloat(speedDiff.toFixed(1)),
      hrDiff: Math.round(hrDiff)
    };
  }, [performanceTrendData]);

  // Scientific Fitness Model (CTL / ATL / TSB) daily calculation
  const fitnessTrendData = useMemo(() => {
    if (calculatedActivities.length === 0) return [];

    // Sort ascending by date to calculate timeline chronologically
    const sortedActs = [...calculatedActivities].sort((a, b) => a.date.localeCompare(b.date));
    
    const firstDateStr = sortedActs[0].date;
    const lastDateStr = sortedActs[sortedActs.length - 1].date;
    
    const start = new Date(firstDateStr);
    const end = new Date(lastDateStr);
    
    // Add 7 days cushion before first activity and after last activity to smooth out
    start.setDate(start.getDate() - 30); // 30 days buffer to let CTL ramp up
    end.setDate(end.getDate() + 3);

    const dateList: string[] = [];
    let current = new Date(start);
    while (current <= end) {
      dateList.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }

    // Map of date -> total TSS
    const dailyTssMap: Record<string, number> = {};
    dateList.forEach(d => { dailyTssMap[d] = 0; });
    
    sortedActs.forEach(act => {
      if (dailyTssMap[act.date] !== undefined) {
        dailyTssMap[act.date] += act.tss;
      } else {
        dailyTssMap[act.date] = act.tss;
      }
    });

    // Run Banister EWMA Filter
    // CTL_today = CTL_yesterday * e^(-1/42) + TSS_today * (1 - e^(-1/42))
    // ATL_today = ATL_yesterday * e^(-1/7) + TSS_today * (1 - e^(-1/7))
    // TSB_today = CTL_yesterday - ATL_yesterday
    let ctl = 0;
    let atl = 0;
    
    const ctlLambda = Math.exp(-1 / 42);
    const atlLambda = Math.exp(-1 / 7);

    return dateList.map(date => {
      const tss = dailyTssMap[date] || 0;
      
      const prevCtl = ctl;
      const prevAtl = atl;

      ctl = prevCtl * ctlLambda + tss * (1 - ctlLambda);
      atl = prevAtl * atlLambda + tss * (1 - atlLambda);
      
      // TSB is Form at the start of the day (yesterday's balance)
      const tsb = prevCtl - prevAtl;
      
      // Acute to Chronic Workload Ratio (ACWR): Sweet spot is 0.8 - 1.3, danger > 1.5
      const acwr = prevCtl > 10 ? prevAtl / prevCtl : 1.0;

      // Format date for display (de-DE)
      const dObj = new Date(date);
      const formattedDate = dObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

      return {
        date,
        formattedDate,
        tss: Math.round(tss),
        ctl: Math.round(ctl),
        atl: Math.round(atl),
        tsb: Math.round(tsb),
        acwr: parseFloat(acwr.toFixed(2))
      };
    }).filter(d => {
      // Filter out the initial 25 days of buffering so the user doesn't see synthetic zero ramp-up
      const bufferCutoff = new Date(start);
      bufferCutoff.setDate(bufferCutoff.getDate() + 25);
      return new Date(d.date) >= bufferCutoff;
    });
  }, [calculatedActivities]);

  // Current Fitness values (last day in timeline)
  const currentFitness = useMemo(() => {
    if (fitnessTrendData.length === 0) return { ctl: 0, atl: 0, tsb: 0, acwr: 1.0 };
    return fitnessTrendData[fitnessTrendData.length - 1];
  }, [fitnessTrendData]);

  // All-time Power Curve Peak Values (across all cycling activities with power)
  const allTimePowerCurve = useMemo(() => {
    const durations = [1, 5, 15, 60, 300, 1200, 3600];
    const maxPeaks: Record<number, { power: number; activityName: string; date: string }> = {};
    
    durations.forEach(d => {
      maxPeaks[d] = { power: 0, activityName: '', date: '' };
    });

    calculatedActivities.forEach(act => {
      if (!act.hasPower || !act.peaks) return;
      durations.forEach(d => {
        const val = act.peaks[d] || 0;
        if (val > maxPeaks[d].power) {
          maxPeaks[d] = {
            power: val,
            activityName: act.name,
            date: act.date
          };
        }
      });
    });

    return durations.map(d => {
      let label = `${d}s`;
      if (d === 60) label = "1m";
      if (d === 300) label = "5m";
      if (d === 1200) label = "20m";
      if (d === 3600) label = "1h";

      const peakInfo = maxPeaks[d];
      const relPower = peakInfo.power / userWeight;

      return {
        duration: d,
        label,
        power: peakInfo.power,
        relPower: parseFloat(relPower.toFixed(2)),
        activityName: peakInfo.activityName || 'Keine Daten',
        date: peakInfo.date ? new Date(peakInfo.date).toLocaleDateString('de-DE') : ''
      };
    });
  }, [calculatedActivities, userWeight]);

  // Overall training polarization & zones aggregation
  const trainingZonesAggr = useMemo(() => {
    let totalDurationSeconds = 0;
    
    // Heart Rate Zones (Z1-Z5 based on user max HR)
    // Z1: Active Recovery (<60% maxHr)
    // Z2: Aerobic Endurance (60%-70% maxHr)
    // Z3: Tempo/Intersensity (70%-80% maxHr)
    // Z4: Threshold (80%-90% maxHr)
    // Z5: Anaerobic (>90% maxHr)
    const hrZonesSeconds = [0, 0, 0, 0, 0];

    // Power Zones (Z1-Z6 Coggan based on FTP)
    // Z1: Active Recovery (<55% FTP)
    // Z2: Endurance (55%-75% FTP)
    // Z3: Tempo (75%-90% FTP)
    // Z4: Threshold (90%-105% FTP)
    // Z5: VO2 Max (105%-120% FTP)
    // Z6: Anaerobic Capacity (>120% FTP)
    const pwrZonesSeconds = [0, 0, 0, 0, 0, 0];

    calculatedActivities.forEach(act => {
      let points: any[] = [];
      if (act.points_json) {
        try {
          points = JSON.parse(act.points_json);
        } catch (e) {}
      }

      // If no points, we split overall duration proportionally using avg heart rate / power
      if (points.length === 0) {
        if (act.avg_hr) {
          const hr = act.avg_hr;
          const ratio = hr / maxHr;
          let zoneIdx = 0;
          if (ratio < 0.60) zoneIdx = 0;
          else if (ratio < 0.70) zoneIdx = 1;
          else if (ratio < 0.80) zoneIdx = 2;
          else if (ratio < 0.90) zoneIdx = 3;
          else zoneIdx = 4;
          hrZonesSeconds[zoneIdx] += act.duration;
        }
        if (act.hasPower && act.np) {
          const pwr = act.np;
          const ratio = pwr / ftp;
          let zoneIdx = 0;
          if (ratio < 0.55) zoneIdx = 0;
          else if (ratio < 0.75) zoneIdx = 1;
          else if (ratio < 0.90) zoneIdx = 2;
          else if (ratio < 1.05) zoneIdx = 3;
          else if (ratio < 1.20) zoneIdx = 4;
          else zoneIdx = 5;
          pwrZonesSeconds[zoneIdx] += act.duration;
        }
        return;
      }

      // We have point-by-point data!
      points.forEach(p => {
        const pwr = p.power;
        const hr = p.hr;

        if (hr) {
          const ratio = hr / maxHr;
          let zoneIdx = 0;
          if (ratio < 0.60) zoneIdx = 0;
          else if (ratio < 0.70) zoneIdx = 1;
          else if (ratio < 0.80) zoneIdx = 2;
          else if (ratio < 0.90) zoneIdx = 3;
          else zoneIdx = 4;
          hrZonesSeconds[zoneIdx]++;
        }

        if (pwr !== undefined && pwr !== null) {
          const ratio = pwr / ftp;
          let zoneIdx = 0;
          if (ratio < 0.55) zoneIdx = 0;
          else if (ratio < 0.75) zoneIdx = 1;
          else if (ratio < 0.90) zoneIdx = 2;
          else if (ratio < 1.05) zoneIdx = 3;
          else if (ratio < 1.20) zoneIdx = 4;
          else zoneIdx = 5;
          pwrZonesSeconds[zoneIdx]++;
        }
      });
    });

    const hrTotal = hrZonesSeconds.reduce((a, b) => a + b, 0);
    const pwrTotal = pwrZonesSeconds.reduce((a, b) => a + b, 0);

    const hrLabels = [
      'Z1 Kompensationsbereich (KB) <60%',
      'Z2 Grundlagenausdauer 1 (GA1) 60-70%',
      'Z3 Grundlagenausdauer 2 (GA2) 70-80%',
      'Z4 Entwicklungsbereich (EB) 80-90%',
      'Z5 Spitzenbereich (SB) >90%'
    ];

    const pwrLabels = [
      'Z1 Aktive Erholung <55% FTP',
      'Z2 Ausdauer 55-75% FTP',
      'Z3 Tempo 75-90% FTP',
      'Z4 Laktatschwelle 90-105% FTP',
      'Z5 VO2max 105-120% FTP',
      'Z6 Anaerobe Kapazität >120% FTP'
    ];

    const hrData = hrZonesSeconds.map((secs, idx) => ({
      name: hrLabels[idx],
      percent: hrTotal > 0 ? parseFloat(((secs / hrTotal) * 100).toFixed(1)) : 0,
      hours: parseFloat((secs / 3600).toFixed(1))
    }));

    const pwrData = pwrZonesSeconds.map((secs, idx) => ({
      name: pwrLabels[idx],
      percent: pwrTotal > 0 ? parseFloat(((secs / pwrTotal) * 100).toFixed(1)) : 0,
      hours: parseFloat((secs / 3600).toFixed(1))
    }));

    // Polarization classification (Polarized vs Pyramidal vs Threshold)
    // Polarized: High Z1/2 (Endurance), Low Z3, Med Z5 (SB/EB) (80/0/20)
    // Pyramidal: Z1/2 > Z3 > Z4/5
    let classification = "Mischtraining / Nicht klassifiziert";
    if (hrTotal > 0) {
      const lowIntensityPct = hrData[0].percent + hrData[1].percent; // Z1 + Z2
      const midIntensityPct = hrData[2].percent; // Z3
      const highIntensityPct = hrData[3].percent + hrData[4].percent; // Z4 + Z5

      if (lowIntensityPct > 70 && highIntensityPct > 10 && midIntensityPct < 15) {
        classification = "Polarisiert (Optimal für aerobe Kapazität)";
      } else if (lowIntensityPct > 60 && midIntensityPct > highIntensityPct) {
        classification = "Pyramidal (Klassischer Strukturaufbau)";
      } else if (midIntensityPct + highIntensityPct > 50) {
        classification = "Schwellentraining (Viel Sweetspot & Tempo)";
      }
    }

    return { hrData, pwrData, classification };
  }, [calculatedActivities, maxHr, ftp]);

  // Form (TSB) classification feedback
  const formStatus = useMemo(() => {
    const tsb = currentFitness.tsb;
    if (tsb > 10) return {
      label: 'Frisch (Saisonhöhepunkt)',
      color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/30',
      desc: 'Hervorragender Status für Wettkämpfe oder Bestzeitversuche. Dein Körper ist erholt und voll leistungsfähig.'
    };
    if (tsb >= -10 && tsb <= 10) return {
      label: 'Übergang / Regeneration',
      color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/30',
      desc: 'Ausgeglichener Trainingsreiz. Ideal für Erhaltungsreize oder den sanften Einstieg in eine neue Belastungsphase.'
    };
    if (tsb < -10 && tsb >= -30) return {
      label: 'Optimaler Trainingsreiz',
      color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30',
      desc: 'Hervorragende Belastungsphase (Überlastungsreiz). Hier findet die eigentliche Superkompensation und Fitnesssteigerung statt.'
    };
    return {
      label: 'Überlastung / Erschöpfung',
      color: 'text-rose-500 bg-rose-50 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900/30',
      desc: 'Hohes Risiko für Übertraining oder Verletzungen! Schiebe dringend aktive Regenerationstage oder eine Entlastungswoche ein.'
    };
  }, [currentFitness.tsb]);

  // List filter logic
  const filteredActivitiesList = useMemo(() => {
    return calculatedActivities.filter(act => {
      const typeMatch = filterType === 'all' || 
        (filterType === 'cycling' && (act.type.toLowerCase().includes('cycle') || act.type.toLowerCase().includes('bike'))) ||
        (filterType === 'running' && act.type.toLowerCase().includes('run'));
      
      const searchMatch = searchQuery.trim() === '' || 
        act.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (act.location && act.location.toLowerCase().includes(searchQuery.toLowerCase()));

      return typeMatch && searchMatch;
    });
  }, [calculatedActivities, filterType, searchQuery]);

  // Scientific Recommendations computation
  const trainingRecommendations = useMemo(() => {
    const userCtl = currentFitness.ctl || 25; // fallback to 25 if zero
    const classification = trainingZonesAggr.classification;

    // 1. Calculate estimated requirements for the target
    let expectedSpeed = goalSport === 'running' ? 10 : 22; // km/h
    // Adjust speed based on elevation: lose speed if there's significant climbing
    const elevDensity = goalDistance > 0 ? (goalElevation / goalDistance) : 0; // m of climbing per km
    if (goalSport === 'running') {
      expectedSpeed = Math.max(6, 11 - (elevDensity * 0.05));
    } else {
      expectedSpeed = Math.max(12, 24 - (elevDensity * 0.2));
    }

    const estDurationHours = goalDistance / expectedSpeed;
    
    // Estimate Event TSS:
    // Marathon is around 250-320 TSS
    // Half Marathon is around 130-170 TSS
    // Cycling tour depends heavily on duration & elevation. Average IF of 0.72.
    let estTss = 100;
    if (goalType === 'marathon') {
      estTss = 280;
    } else if (goalType === 'halfmarathon') {
      estTss = 140;
    } else {
      // Custom cycling/running tour
      const estimatedIf = goalSport === 'running' ? 0.82 : 0.70;
      estTss = Math.round(estDurationHours * Math.pow(estimatedIf, 2) * 100);
    }

    // 2. CTL targets
    let targetCtl = 40;
    if (goalType === 'marathon') targetCtl = 60;
    else if (goalType === 'halfmarathon') targetCtl = 40;
    else {
      // custom tour based on estimated TSS
      targetCtl = Math.max(30, Math.round(estTss / 4.5));
    }

    const ctlGap = Math.max(0, targetCtl - userCtl);
    const weeklyTssTarget = Math.round(userCtl * 7 * 0.95 + ctlGap * 18);

    // 3. Readiness / preparation index
    let readinessScore = 50;
    if (userCtl >= targetCtl) {
      readinessScore = 95;
    } else {
      readinessScore = Math.max(15, Math.round((userCtl / targetCtl) * 100));
    }

    return {
      estDurationHours: parseFloat(estDurationHours.toFixed(1)),
      estTss,
      targetCtl,
      ctlGap,
      weeklyTssTargetRange: [Math.max(100, weeklyTssTarget - 50), weeklyTssTarget + 50],
      readinessScore,
      userCtlLevel: userCtl < 35 ? 'Einsteiger' : userCtl < 70 ? 'Fortgeschritten' : 'Profi / Leistungssportler',
      acwrWarning: currentFitness.acwr > 1.5
    };
  }, [currentFitness.ctl, goalDistance, goalElevation, goalSport, goalType, trainingZonesAggr.classification]);

  // Scientific Activity Background Profiler
  const activityProfile = useMemo(() => {
    if (!calculatedActivities || calculatedActivities.length === 0) {
      return {
        avgWeeklySessions: 0,
        avgWeeklyDistance: 0,
        avgWeeklyDuration: 0,
        hasRecentRunning: false,
        hasRecentCycling: false,
        isTrained: false,
        filteredCount: 0,
        historyRangeLabel: 'Ganze Historie'
      };
    }

    const allDates = calculatedActivities.map(a => new Date(a.date).getTime());
    const latestDateMs = Math.max(...allDates);

    let filtered = calculatedActivities;
    let diffWeeks = 4; // default
    let rangeLabel = 'Letzte 4 Wochen';

    if (historyAnalysisRange === '1week') {
      const cutoff = latestDateMs - 7 * 24 * 60 * 60 * 1000;
      filtered = calculatedActivities.filter(a => new Date(a.date).getTime() >= cutoff);
      diffWeeks = 1;
      rangeLabel = 'Letzte 1 Woche';
    } else if (historyAnalysisRange === '4weeks') {
      const cutoff = latestDateMs - 28 * 24 * 60 * 60 * 1000;
      filtered = calculatedActivities.filter(a => new Date(a.date).getTime() >= cutoff);
      diffWeeks = 4;
      rangeLabel = 'Letzte 4 Wochen';
    } else {
      const minDate = Math.min(...allDates);
      const diffDays = Math.max(7, (latestDateMs - minDate) / (1000 * 60 * 60 * 24));
      diffWeeks = diffDays / 7;
      rangeLabel = 'Ganze Historie';
    }

    // Fallback if filtering results in 0 activities
    if (filtered.length === 0) {
      filtered = calculatedActivities.slice(-3); // fallback to last 3
      const dates = filtered.map(a => new Date(a.date).getTime());
      const minDate = Math.min(...dates);
      const maxDate = Math.max(...dates);
      const diffDays = Math.max(7, (maxDate - minDate) / (1000 * 60 * 60 * 24));
      diffWeeks = diffDays / 7;
    }

    const totalSessions = filtered.length;
    const totalDistance = filtered.reduce((sum, a) => sum + (a.distance || 0), 0);
    const totalDuration = filtered.reduce((sum, a) => sum + (a.duration || 0), 0) / 3600; // hours

    const hasRecentRunning = filtered.some(a => a.type.toLowerCase().includes('run'));
    const hasRecentCycling = filtered.some(a => a.type.toLowerCase().includes('cycle') || a.type.toLowerCase().includes('bike'));

    const avgWeeklySessions = totalSessions / diffWeeks;
    const avgWeeklyDistance = totalDistance / diffWeeks;
    const avgWeeklyDuration = totalDuration / diffWeeks;

    return {
      avgWeeklySessions: parseFloat(avgWeeklySessions.toFixed(1)),
      avgWeeklyDistance: parseFloat(avgWeeklyDistance.toFixed(1)),
      avgWeeklyDuration: parseFloat(avgWeeklyDuration.toFixed(1)),
      hasRecentRunning,
      hasRecentCycling,
      isTrained: (currentFitness.ctl || 0) > 35 || avgWeeklySessions >= 2.5,
      filteredCount: totalSessions,
      historyRangeLabel: rangeLabel
    };
  }, [calculatedActivities, currentFitness.ctl, historyAnalysisRange]);

  // Helper inside component to generate workouts for a given week index
  const generateWorkoutsForWeek = useCallback((
    weekIdx: number, 
    totalWeeks: number, 
    phase: string, 
    weekTss: number, 
    sport: 'running' | 'cycling',
    distance: number,
    elevation: number
  ) => {
    const isCycling = sport === 'cycling';
    const isDeload = phase.toLowerCase().includes('del') || phase.toLowerCase().includes('erhol');
    const isTaper = phase.toLowerCase().includes('taper');
    const isPeak = phase.toLowerCase().includes('peak');
    const isBuild = phase.toLowerCase().includes('build') || phase.toLowerCase().includes('temp');

    // Workout 1: The Intensity Key Session (Intervals or threshold)
    let workout1: any;
    if (isCycling) {
      if (isDeload || isTaper) {
        workout1 = {
          title: `Kurze Schwellenreize W${weekIdx + 1}`,
          description: "Erhalt der neuromuskulären Anspannung bei deutlich reduziertem Volumen zur Entlastung.",
          tss: Math.round(weekTss * 0.35),
          steps: [
            { name: "Warm-up (GA1)", durationMinutes: 10, targetFtpPercent: 55, targetHrPercent: 65 },
            { name: "Schwellen-Intervall", durationMinutes: 4, targetFtpPercent: 95, targetHrPercent: 85, reps: 3, restDurationMinutes: 3 },
            { name: "Cool-down", durationMinutes: 10, targetFtpPercent: 50, targetHrPercent: 60 }
          ]
        };
      } else if (isPeak) {
        workout1 = {
          title: `VO2max Power-Intervalle W${weekIdx + 1}`,
          description: "Entwicklung der maximalen Sauerstoffaufnahme und Erhöhung des kardiovaskulären Limits.",
          tss: Math.round(weekTss * 0.40),
          steps: [
            { name: "Warm-up (GA1)", durationMinutes: 15, targetFtpPercent: 60, targetHrPercent: 68 },
            { name: "VO2max Intervall", durationMinutes: 4, targetFtpPercent: 115, targetHrPercent: 95, reps: 5, restDurationMinutes: 4 },
            { name: "Cool-down", durationMinutes: 15, targetFtpPercent: 50, targetHrPercent: 60 }
          ]
        };
      } else if (isBuild) {
        workout1 = {
          title: `Sweet Spot Schwellen-Sitzung W${weekIdx + 1}`,
          description: "Hocheffiziente Steigerung der anaeroben Schwelle (SST) bei gut tolerierbarer Ermüdung.",
          tss: Math.round(weekTss * 0.38),
          steps: [
            { name: "Warm-up (GA1)", durationMinutes: 15, targetFtpPercent: 60, targetHrPercent: 68 },
            { name: "SST Intervall", durationMinutes: 15, targetFtpPercent: 90, targetHrPercent: 88, reps: 2, restDurationMinutes: 5 },
            { name: "Cool-down", durationMinutes: 15, targetFtpPercent: 52, targetHrPercent: 60 }
          ]
        };
      } else { // Base
        workout1 = {
          title: `Trittfrequenz-Aktivierung W${weekIdx + 1}`,
          description: "Verbesserung der Bewegungseffizienz durch High-Cadence Reize.",
          tss: Math.round(weekTss * 0.30),
          steps: [
            { name: "Warm-up (GA1)", durationMinutes: 15, targetFtpPercent: 55, targetHrPercent: 65 },
            { name: "High-Cadence-Intervall", durationMinutes: 5, targetFtpPercent: 80, targetHrPercent: 78, reps: 3, restDurationMinutes: 5 },
            { name: "Cool-down", durationMinutes: 10, targetFtpPercent: 50, targetHrPercent: 60 }
          ]
        };
      }
    } else { // Running
      if (isDeload || isTaper) {
        workout1 = {
          title: `Kurze Tempo-Aktivierung W${weekIdx + 1}`,
          description: "Neuromuskuläre Spritzigkeit erhalten durch kurze Belastungsreize.",
          tss: Math.round(weekTss * 0.35),
          steps: [
            { name: "Warm-up (Lockerer Trab)", durationMinutes: 10, targetHrPercent: 65 },
            { name: "Renntempo-Intervall", durationMinutes: 3, targetHrPercent: 85, reps: 3, restDurationMinutes: 3 },
            { name: "Cool-down", durationMinutes: 10, targetHrPercent: 60 }
          ]
        };
      } else if (isPeak) {
        workout1 = {
          title: `VO2max Intervalle W${weekIdx + 1}`,
          description: "Peak-Sauerstoffaufnahme durch klassische Intervalle zur Erreichung der Topform.",
          tss: Math.round(weekTss * 0.40),
          steps: [
            { name: "Einlaufen (GA1)", durationMinutes: 12, targetHrPercent: 68 },
            { name: "VO2max Intervall", durationMinutes: 3, targetHrPercent: 93, reps: 5, restDurationMinutes: 3 },
            { name: "Auslaufen", durationMinutes: 10, targetHrPercent: 60 }
          ]
        };
      } else if (isBuild) {
        workout1 = {
          title: `Schwellen-Tempowechsel W${weekIdx + 1}`,
          description: "Förderung der Laktatpufferung im angestrebten Wettkampftempo.",
          tss: Math.round(weekTss * 0.38),
          steps: [
            { name: "Einlaufen (GA1)", durationMinutes: 15, targetHrPercent: 70 },
            { name: "Tempo-Intervall", durationMinutes: 8, targetHrPercent: 88, reps: 3, restDurationMinutes: 4 },
            { name: "Auslaufen", durationMinutes: 10, targetHrPercent: 62 }
          ]
        };
      } else { // Base
        workout1 = {
          title: `Steigerungslauf W${weekIdx + 1}`,
          description: "Lockerer Einstieg in intensivere Tempobereiche mit Fokus auf Laufökonomie.",
          tss: Math.round(weekTss * 0.32),
          steps: [
            { name: "Warm-up", durationMinutes: 15, targetHrPercent: 65 },
            { name: "Steigerungs-Intervall", durationMinutes: 1.5, targetHrPercent: 80, reps: 5, restDurationMinutes: 2 },
            { name: "Cool-down", durationMinutes: 10, targetHrPercent: 60 }
          ]
        };
      }
    }

    // Workout 2: The Endurance Builder (The Long Ride / Run)
    let workout2: any;
    const enduranceTss = Math.round(weekTss * (isDeload ? 0.40 : 0.45));
    if (isCycling) {
      const baseHrs = isDeload ? 1.5 : isTaper ? 1.5 : isPeak ? 3.5 : isBuild ? 3.0 : 2.0;
      const hours = Math.max(1.2, baseHrs + (elevation / 1000) * 0.4);
      workout2 = {
        title: `Grundlagen-Dauerfahrt W${weekIdx + 1}`,
        description: `Stärkung des Fettstoffwechsels und Schulung des Stehvermögens über ${hours.toFixed(1)} Std.`,
        tss: enduranceTss,
        steps: [
          { name: "Warm-up", durationMinutes: 10, targetFtpPercent: 50, targetHrPercent: 60 },
          { name: "GA1 Dauerbereich", durationMinutes: Math.round(hours * 60), targetFtpPercent: 65, targetHrPercent: 70 },
          { name: "Cool-down", durationMinutes: 10, targetFtpPercent: 50, targetHrPercent: 58 }
        ]
      };
    } else { // Running
      const baseKms = isDeload ? 10 : isTaper ? 12 : isPeak ? Math.max(14, distance * 0.65) : isBuild ? Math.max(12, distance * 0.55) : Math.max(10, distance * 0.45);
      const estimatedMinutes = Math.round(baseKms * 6); // 6 min/km pace
      workout2 = {
        title: `Langer GA1 Dauerlauf W${weekIdx + 1}`,
        description: `Wichtige orthopädische Gewöhnung über geplante ${baseKms.toFixed(1)} km im aeroben Wohlfühltempo.`,
        tss: enduranceTss,
        steps: [
          { name: "Einlaufen", durationMinutes: 10, targetHrPercent: 62 },
          { name: "GA1 Dauerlauf", durationMinutes: estimatedMinutes, targetHrPercent: 72 },
          { name: "Auslaufen", durationMinutes: 10, targetHrPercent: 62 }
        ]
      };
    }

    // Workout 3: Active Recovery / Light Support Session
    let workout3: any;
    const recoveryTss = Math.round(weekTss * 0.17);
    if (isCycling) {
      workout3 = {
        title: `Regeneratives Kurbeln W${weekIdx + 1}`,
        description: "Aktiver Laktatabbau und Entlastung der Muskulatur nach harten Belastungstagen.",
        tss: recoveryTss,
        steps: [
          { name: "Aktive Erholung", durationMinutes: 45, targetFtpPercent: 48, targetHrPercent: 55 }
        ]
      };
    } else { // Running
      workout3 = {
        title: `Regenerativer DL oder Walk W${weekIdx + 1}`,
        description: "Förderung der Durchblutung zur Beschleunigung der zellulären Erholung.",
        tss: recoveryTss,
        steps: [
          { name: "Erholungslauf", durationMinutes: 30, targetHrPercent: 60 }
        ]
      };
    }

    return [workout1, workout2, workout3];
  }, []);

  // Scientific Training Plan Generator
  const generatedPlan = useMemo(() => {
    const weeksCount = planDuration;
    const userCtl = currentFitness.ctl || 25;
    const baseTss = Math.max(120, userCtl * 7 * 0.95);
    
    const plan: any[] = [];
    
    for (let w = 0; w < weeksCount; w++) {
      let phase = '';
      let phaseDesc = '';
      let loadMultiplier = 1.0;
      
      if (weeksCount === 8) {
        if (w < 2) {
          phase = 'Base (Fundament)';
          phaseDesc = 'Aufbau des aeroben Herz-Kreislauf-Systems und orthopädische Festigung.';
          loadMultiplier = 1.0 + (w * 0.08);
        } else if (w < 3) {
          phase = 'Build (Kraftausdauer)';
          phaseDesc = 'Einführung längerer Reize nahe der anaeroben Schwelle zur Steigerung des maximalen Laktatumsatzes.';
          loadMultiplier = 1.22;
        } else if (w < 4) {
          phase = 'Deload (Erholung)';
          phaseDesc = 'Superkompensation: Aktive Regeneration zur Absorption des vorherigen Belastungsblocks.';
          loadMultiplier = 0.72;
        } else if (w < 6) {
          phase = 'Peak (Spezifische Belastung)';
          phaseDesc = 'Maximaler Reiz: Hochintensive Reize im Schwellen- und VO2max-Bereich für den letzten Schliff.';
          loadMultiplier = 1.38;
        } else if (w < 7) {
          phase = 'Tapering I';
          phaseDesc = 'Beginnende Volumenreduktion bei gleichbleibender Intensität, um Ermüdung abzubauen.';
          loadMultiplier = 0.82;
        } else {
          phase = 'Tapering II & Event';
          phaseDesc = 'Maximale Frische am Wettkampftag. Kurze, spritzige Intervalle gefolgt von voller Erholung.';
          loadMultiplier = 0.48;
        }
      } else if (weeksCount === 4) {
        if (w === 0) {
          phase = 'Build (Belastungsaufbau)';
          phaseDesc = 'Fokus auf Sweet-Spot- und Laktatschwellenintervalle zur Festigung der Tempohärte.';
          loadMultiplier = 1.15;
        } else if (w === 1) {
          phase = 'Peak (Hauptbelastung)';
          phaseDesc = 'Härtester Wochenblock mit wettkampfspezifischer Intervalldichte.';
          loadMultiplier = 1.35;
        } else if (w === 2) {
          phase = 'Tapering (Regeneration)';
          phaseDesc = 'Drastische Verringerung des Volumens für volle Kohlenhydratspeicher und Muskelregeneration.';
          loadMultiplier = 0.75;
        } else {
          phase = 'Wettkampf-Woche';
          phaseDesc = 'Kurze neuromuscularer Aktivierungen vor dem eigentlichen Hauptlauf.';
          loadMultiplier = 0.45;
        }
      } else { // 12 Weeks
        if (w < 3) {
          phase = 'Base I (Fundament)';
          phaseDesc = 'Gleichmäßiger aerober Aufbau, Optimierung der mitochondrialen Dichte und Fettsäureoxidation.';
          loadMultiplier = 0.95 + (w * 0.06);
        } else if (w === 3) {
          phase = 'Deload (Anpassung)';
          phaseDesc = 'Superkompensation für den Übergang in den ersten echten Schwellenblock.';
          loadMultiplier = 0.70;
        } else if (w < 7) {
          phase = 'Build I (Schwellenverschiebung)';
          phaseDesc = 'Intensive Kraftausdauereinheiten und gesteigerte Dauerläufe zur Verschiebung des Ermüdungspunkts.';
          loadMultiplier = 1.15 + ((w - 4) * 0.05);
        } else if (w === 7) {
          phase = 'Deload (Anpassung)';
          phaseDesc = 'Zelluläre Regeneration vor dem härtesten Peak-Belastungsblock.';
          loadMultiplier = 0.74;
        } else if (w < 10) {
          phase = 'Peak (Wettkampfsimulation)';
          phaseDesc = 'Extrem spezifisches Renntempo-Training und VO2max-Reize für maximale aerobe Leistung.';
          loadMultiplier = 1.38;
        } else if (w === 10) {
          phase = 'Tapering I';
          phaseDesc = 'Volumenreduktion um 35%. Der Körper beginnt, die tiefe Muskelmüdigkeit abzustreifen.';
          loadMultiplier = 0.85;
        } else {
          phase = 'Tapering II & Wettkampf';
          phaseDesc = 'Voll aufgeladene Glykogenspeicher und höchste neurale Spannkraft für deine Höchstleistung.';
          loadMultiplier = 0.50;
        }
      }
      
      const startTssScale = activityProfile.isTrained ? baseTss : Math.min(baseTss, 210);
      const targetTss = Math.round(startTssScale * loadMultiplier);
      const workouts = generateWorkoutsForWeek(w, weeksCount, phase, targetTss, goalSport, goalDistance, goalElevation);
      
      plan.push({
        weekNumber: w + 1,
        phase,
        phaseDesc,
        targetTss,
        workouts
      });
    }
    
    return plan;
  }, [planDuration, currentFitness.ctl, goalSport, goalDistance, goalElevation, activityProfile.isTrained, generateWorkoutsForWeek]);

  // Garmin Target TCX Generator
  const exportToTcx = useCallback((workout: any) => {
    const sport = goalSport === 'running' ? 'Running' : 'Biking';
    
    // Simple helper inside exportToTcx scope to generate Target XML
    const getTcxTargetXml = (step: any, sportType: string) => {
      if (sportType === 'Biking' && step.targetFtpPercent) {
        const targetWatts = Math.round((ftp * step.targetFtpPercent) / 100);
        const lowWatts = Math.round(targetWatts * 0.93);
        const highWatts = Math.round(targetWatts * 1.07);
        return `        <Target xsi:type="CustomPower_t">
          <CustomPowerZone xsi:type="CustomPowerZone_t">
            <Low>${lowWatts}</Low>
            <High>${highWatts}</High>
          </CustomPowerZone>
        </Target>\n`;
      } else if (step.targetHrPercent) {
        const targetBpm = Math.round((maxHr * step.targetHrPercent) / 100);
        const lowHr = Math.round(targetBpm * 0.93);
        const highHr = Math.round(targetBpm * 1.07);
        return `        <Target xsi:type="HeartRate_t">
          <HeartRateZone xsi:type="HeartRateAboveZone_t">
            <Min xsi:type="HeartRateInBeatsPerMinute_t">
              <Value>${lowHr}</Value>
            </Min>
            <Max xsi:type="HeartRateInBeatsPerMinute_t">
              <Value>${highHr}</Value>
            </Max>
          </HeartRateZone>
        </Target>\n`;
      } else {
        return `        <Target xsi:type="None_t"/>\n`;
      }
    };

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase 
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" 
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Workouts>
    <Workout Sport="${sport}">
      <Name>${workout.title.substring(0, 15).replace(/[^a-zA-Z0-9 ]/g, '')}</Name>
      <Notes>${workout.description || 'Wissenschaftlicher Trainingsplan'}</Notes>
`;

    let stepId = 1;
    
    workout.steps.forEach((step: any) => {
      if (step.reps && step.reps > 1) {
        for (let r = 0; r < step.reps; r++) {
          xml += `      <Step xsi:type="Step_t">
        <StepId>${stepId++}</StepId>
        <Name>${step.name.substring(0, 10)} ${r + 1}</Name>
        <Intensity>Active</Intensity>
        <Duration xsi:type="Time_t">
          <Seconds>${step.durationMinutes * 60}</Seconds>
        </Duration>
`;
          xml += getTcxTargetXml(step, sport);
          xml += `      </Step>\n`;

          if (step.restDurationMinutes) {
            xml += `      <Step xsi:type="Step_t">
        <StepId>${stepId++}</StepId>
        <Name>Pause</Name>
        <Intensity>Resting</Intensity>
        <Duration xsi:type="Time_t">
          <Seconds>${step.restDurationMinutes * 60}</Seconds>
        </Duration>
`;
            xml += getTcxTargetXml({ name: "Pause", durationMinutes: step.restDurationMinutes, targetHrPercent: 60, targetFtpPercent: 50 }, sport);
            xml += `      </Step>\n`;
          }
        }
      } else {
        xml += `      <Step xsi:type="Step_t">
        <StepId>${stepId++}</StepId>
        <Name>${step.name.substring(0, 15)}</Name>
        <Intensity>${step.name.toLowerCase().includes('warm') ? 'Warmup' : step.name.toLowerCase().includes('cool') || step.name.toLowerCase().includes('auslauf') ? 'Cooldown' : 'Active'}</Intensity>
        <Duration xsi:type="Time_t">
          <Seconds>${step.durationMinutes * 60}</Seconds>
        </Duration>
`;
        xml += getTcxTargetXml(step, sport);
        xml += `      </Step>\n`;
      }
    });

    xml += `    </Workout>
  </Workouts>
</TrainingCenterDatabase>`;

    const blob = new Blob([xml], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Garmin_${workout.title.replace(/[^a-zA-Z0-9]/g, '_')}.tcx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [goalSport, ftp, maxHr]);

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-md flex items-center justify-center p-0 md:p-4 overflow-hidden">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="w-full h-full md:max-w-7xl md:h-[92vh] bg-white dark:bg-slate-900 md:rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-100 dark:border-slate-800"
      >
        {/* Header */}
        <div className="bg-slate-550 border-b border-slate-100 dark:border-slate-800 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500/10 p-2 rounded-xl border border-amber-500/20">
              <Zap className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2">
                Leistungs- & Fitness-Analyse
                <span className="bg-amber-500/10 text-amber-500 text-[10px] px-2 py-0.5 rounded-full font-mono font-bold border border-amber-500/20">
                  SPORTWISSENSCHAFT
                </span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Wissenschaftliche CTL/ATL/TSB-Trainingsmodelle & Power-Duration-Leistungskurven aus SQLite-Datenbanken
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Settings Box & Key Stats Banner */}
        <div className="bg-slate-50/50 dark:bg-slate-950/20 border-b border-slate-100 dark:border-slate-800 p-4 md:px-6 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Athlete physiological parameters */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Funktionelle Leistungsschwelle (FTP):</span>
              <div className="flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 shadow-2xs">
                <input 
                  type="number" 
                  value={ftp} 
                  onChange={e => handleSaveFtp(parseInt(e.target.value) || 0)}
                  className="w-14 text-center font-mono font-extrabold text-sm text-amber-500 focus:outline-none"
                />
                <span className="text-xs font-bold text-slate-400 ml-1">W</span>
              </div>
            </div>
            
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Maximalpuls (HF Max):</span>
              <div className="flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 shadow-2xs">
                <input 
                  type="number" 
                  value={maxHr} 
                  onChange={e => handleSaveMaxHr(parseInt(e.target.value) || 0)}
                  className="w-14 text-center font-mono font-extrabold text-sm text-rose-500 focus:outline-none"
                />
                <span className="text-xs font-bold text-slate-400 ml-1">bpm</span>
              </div>
            </div>

            <div className="text-[10px] bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 px-2.5 py-1 rounded-lg font-medium border border-indigo-100/50 dark:border-indigo-900/30">
              Körpergewicht: <span className="font-extrabold">{userWeight} kg</span> | Alter: <span className="font-extrabold">{userAge} Jahre</span>
            </div>
          </div>

          <button 
            onClick={fetchHealthMetrics}
            className="self-end md:self-auto flex items-center gap-1.5 text-xs font-extrabold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100/60 dark:bg-indigo-950/30 dark:hover:bg-indigo-900/40 px-3 py-1.5 rounded-lg border border-indigo-150/40 transition-all cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Aktualisieren
          </button>
        </div>

        {/* Main Workspace */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
            <p className="text-sm text-slate-500 font-bold">Lade SQLite-Aktivitäten & berechne sportwissenschaftliche Modelle...</p>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
            <AlertTriangle className="w-12 h-12 text-rose-500 mb-2" />
            <h3 className="text-base font-black text-slate-800 dark:text-white uppercase">Konnte Fitness-Daten nicht laden</h3>
            <p className="text-xs text-slate-500 mt-1 mb-4">{error}</p>
            <button 
              onClick={fetchHealthMetrics}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all"
            >
              Erneut versuchen
            </button>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
            <Database className="w-16 h-16 text-slate-300 dark:text-slate-700 mb-3 animate-pulse" />
            <h3 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-tight">Keine Garmin-Aktivitäten in SQLite gefunden</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
              Für eine sportwissenschaftliche Fitness-Analyse müssen zuerst Garmin-Aktivitäten importiert werden. 
              Klicke im Hauptfenster auf <strong>'Garmin Fitness & Gesundheit'</strong> und lade deine SQLite Garmin-Backup-Datei (.db) oder synchronisiere die Tabellen direkt im Workspace.
            </p>
            <div className="mt-6 flex gap-3">
              <button 
                onClick={onClose}
                className="bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all cursor-pointer"
              >
                Schließen
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Left Nav Tabs */}
            <div className="w-full md:w-56 bg-slate-50 dark:bg-slate-950/20 border-b md:border-b-0 md:border-r border-slate-100 dark:border-slate-800 p-3 flex flex-row md:flex-col gap-1.5 overflow-x-auto shrink-0 scrollbar-none">
              <button
                onClick={() => { setActiveTab('ctl'); setSelectedActivity(null); }}
                className={`w-full flex items-center justify-center md:justify-start gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase transition-all cursor-pointer border whitespace-nowrap shrink-0 ${activeTab === 'ctl' ? 'bg-amber-500 border-amber-500 text-white shadow-md' : 'bg-white hover:bg-slate-100 dark:bg-slate-800 border-slate-200/50 dark:border-slate-700/50 text-slate-700 dark:text-slate-300'}`}
              >
                <TrendingUp className="w-4 h-4" />
                Fitness-Trend (CTL/TSB)
              </button>
              
              <button
                onClick={() => { setActiveTab('power'); setSelectedActivity(null); }}
                className={`w-full flex items-center justify-center md:justify-start gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase transition-all cursor-pointer border whitespace-nowrap shrink-0 ${activeTab === 'power' ? 'bg-amber-500 border-amber-500 text-white shadow-md' : 'bg-white hover:bg-slate-100 dark:bg-slate-800 border-slate-200/50 dark:border-slate-700/50 text-slate-700 dark:text-slate-300'}`}
              >
                <Zap className="w-4 h-4" />
                Power-Duration (MMP)
              </button>
              
              <button
                onClick={() => { setActiveTab('zones'); setSelectedActivity(null); }}
                className={`w-full flex items-center justify-center md:justify-start gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase transition-all cursor-pointer border whitespace-nowrap shrink-0 ${activeTab === 'zones' ? 'bg-amber-500 border-amber-500 text-white shadow-md' : 'bg-white hover:bg-slate-100 dark:bg-slate-800 border-slate-200/50 dark:border-slate-700/50 text-slate-700 dark:text-slate-300'}`}
              >
                <Heart className="w-4 h-4" />
                Puls- & Wattbereiche
              </button>

              <button
                onClick={() => { setActiveTab('goals'); setSelectedActivity(null); }}
                className={`w-full flex items-center justify-center md:justify-start gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase transition-all cursor-pointer border whitespace-nowrap shrink-0 ${activeTab === 'goals' ? 'bg-amber-500 border-amber-500 text-white shadow-md' : 'bg-white hover:bg-slate-100 dark:bg-slate-800 border-slate-200/50 dark:border-slate-700/50 text-slate-700 dark:text-slate-300'}`}
              >
                <Target className="w-4 h-4" />
                Ziele & Trainingsplan
              </button>
              
              <button
                onClick={() => { setActiveTab('activities'); }}
                className={`w-full flex items-center justify-center md:justify-start gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase transition-all cursor-pointer border whitespace-nowrap shrink-0 ${activeTab === 'activities' ? 'bg-amber-500 border-amber-500 text-white shadow-md' : 'bg-white hover:bg-slate-100 dark:bg-slate-800 border-slate-200/50 dark:border-slate-700/50 text-slate-700 dark:text-slate-300'}`}
              >
                <BarChart2 className="w-4 h-4" />
                Einzel-Aktivitäten ({activities.length})
              </button>
            </div>

            {/* Right Work Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-white dark:bg-slate-900">
              
              {/* TAB 1: CTL / ATL / TSB Training Load Trends */}
              {activeTab === 'ctl' && (
                <div className="space-y-6">
                  {/* Banner / Current status cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700 p-4 rounded-2xl">
                      <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider">Fitness (CTL)</span>
                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                      </div>
                      <div className="text-2xl font-black text-slate-800 dark:text-white font-mono flex items-baseline gap-1">
                        {currentFitness.ctl}
                        <span className="text-xs text-slate-400 font-bold">Wurzel</span>
                      </div>
                      <p className="text-[9px] text-slate-400 leading-normal mt-1">42-Tage-Durchschnitt der Belastung.</p>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700 p-4 rounded-2xl">
                      <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider">Müdigkeit (ATL)</span>
                        <Activity className="w-4 h-4 text-rose-500" />
                      </div>
                      <div className="text-2xl font-black text-slate-800 dark:text-white font-mono flex items-baseline gap-1">
                        {currentFitness.atl}
                        <span className="text-xs text-slate-400 font-bold">Punkte</span>
                      </div>
                      <p className="text-[9px] text-slate-400 leading-normal mt-1">7-Tage-Durchschnitt deiner Belastung.</p>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700 p-4 rounded-2xl">
                      <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider">Form (TSB)</span>
                        <Zap className="w-4 h-4 text-amber-500" />
                      </div>
                      <div className={`text-2xl font-black font-mono flex items-baseline gap-1 ${currentFitness.tsb >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {currentFitness.tsb > 0 ? `+${currentFitness.tsb}` : currentFitness.tsb}
                        <span className="text-xs text-slate-400 font-bold">Form</span>
                      </div>
                      <p className="text-[9px] text-slate-400 leading-normal mt-1">Differenz aus Fitness und Müdigkeit.</p>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700 p-4 rounded-2xl">
                      <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider">ACWR-Sicherheitsindex</span>
                        <Info className="w-4 h-4 text-indigo-500" />
                      </div>
                      <div className={`text-2xl font-black font-mono flex items-baseline gap-1 ${currentFitness.acwr > 1.5 ? 'text-rose-500' : currentFitness.acwr >= 0.8 && currentFitness.acwr <= 1.3 ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {currentFitness.acwr}
                        <span className="text-xs text-slate-400 font-bold">Quotient</span>
                      </div>
                      <p className="text-[9px] text-slate-400 leading-normal mt-1">Verhältnis Kurzzeit- zu Langzeitbelastung.</p>
                    </div>
                  </div>

                  {/* Form Evaluation Callout */}
                  <div className={`border p-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 ${formStatus.color}`}>
                    <div>
                      <div className="flex items-center gap-1.5 font-black text-xs uppercase">
                        <Sparkles className="w-4 h-4 animate-spin-slow" />
                        Aktueller Zustand: {formStatus.label}
                      </div>
                      <p className="text-xs mt-1 leading-relaxed opacity-90">{formStatus.desc}</p>
                    </div>
                    {currentFitness.acwr > 1.5 && (
                      <div className="flex items-center gap-2 bg-red-500/10 text-red-600 border border-red-500/20 px-3 py-2 rounded-xl text-xs font-bold max-w-sm">
                        <AlertTriangle className="w-5 h-5 shrink-0" />
                        Achtung: ACWR über 1.5! Du steigerst die Belastung zu schnell. Erhöhtes Verletzungsrisiko!
                      </div>
                    )}
                  </div>

                  {/* Graph */}
                  <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-200/50 dark:border-slate-800 rounded-3xl p-4">
                    <h3 className="text-xs font-black text-slate-700 dark:text-slate-350 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-amber-500" />
                      Trainingsstress-Verlauf & Formkurve (CTL / ATL / TSB)
                    </h3>
                    
                    <div className="h-80 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={fitnessTrendData}
                          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="colorCtl" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="colorAtl" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.15}/>
                              <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="colorTsb" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15}/>
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                          <XAxis 
                            dataKey="formattedDate" 
                            stroke="#888888" 
                            fontSize={10}
                            tickLine={false} 
                          />
                          <YAxis 
                            stroke="#888888" 
                            fontSize={10}
                            tickLine={false}
                          />
                          <Tooltip 
                            contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: 'none', borderRadius: '12px', fontSize: '11px', color: '#fff' }}
                            labelStyle={{ fontWeight: 'bold', color: '#94a3b8' }}
                          />
                          <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                          <Area type="monotone" name="Fitness (CTL)" dataKey="ctl" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorCtl)" />
                          <Area type="monotone" name="Erschöpfung (ATL)" dataKey="atl" stroke="#f43f5e" strokeWidth={1.5} fillOpacity={1} fill="url(#colorAtl)" />
                          <Area type="monotone" name="Form (TSB)" dataKey="tsb" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorTsb)" />
                          <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
                          <ReferenceLine y={-30} label={{ value: 'Überlastungsgrenze', fill: '#f43f5e', fontSize: 9, position: 'bottom' }} stroke="#f43f5e" strokeDasharray="3 3" opacity={0.3} />
                          <ReferenceLine y={10} label={{ value: 'Frischegrenze', fill: '#10b981', fontSize: 9, position: 'top' }} stroke="#10b981" strokeDasharray="3 3" opacity={0.3} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* TAB 1 - SECTION 2: Training Performance Development (Last 4 Weeks) */}
                  <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-200/50 dark:border-slate-800 rounded-3xl p-4 md:p-6 space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <h3 className="text-xs font-black text-slate-700 dark:text-slate-350 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                          <Activity className="w-4 h-4 text-emerald-500" />
                          Trainingsleistung & Entwicklung (Letzte 4 Wochen)
                        </h3>
                        <p className="text-[11px] text-slate-500 leading-normal">
                          Visualisierung deiner durchschnittlichen Herzfrequenz und Geschwindigkeit aller geladenen Aktivitäten.
                        </p>
                      </div>

                      {/* Metric Toggle Buttons */}
                      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl self-start md:self-center">
                        <button
                          type="button"
                          onClick={() => setPerformanceMetric('both')}
                          className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center gap-1 ${performanceMetric === 'both' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                          <Layers className="w-3.5 h-3.5 text-indigo-500" />
                          Kombiniert
                        </button>
                        <button
                          type="button"
                          onClick={() => setPerformanceMetric('speed')}
                          className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center gap-1 ${performanceMetric === 'speed' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                          Tempo
                        </button>
                        <button
                          type="button"
                          onClick={() => setPerformanceMetric('hr')}
                          className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center gap-1 ${performanceMetric === 'hr' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                          <Heart className="w-3.5 h-3.5 text-rose-500" />
                          Puls
                        </button>
                      </div>
                    </div>

                    {performanceTrendData.length === 0 ? (
                      <div className="h-64 flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                        <Info className="w-8 h-8 text-slate-400 mb-2" />
                        <p className="text-xs font-bold text-slate-600 dark:text-slate-400">Keine Aktivitätsdaten aus den letzten 4 Wochen vorhanden</p>
                        <p className="text-[10px] text-slate-400 mt-1 max-w-sm">Importiere GPX-Tracks im Dashboard oder lade Trainingsdateien, um den Leistungstrend zu visualisieren.</p>
                      </div>
                    ) : (
                      <>
                        {/* Chart Container */}
                        <div className="h-72 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart
                              data={performanceTrendData}
                              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                              <XAxis 
                                dataKey="formattedDate" 
                                stroke="#888888" 
                                fontSize={9}
                                tickLine={false} 
                              />
                              
                              {/* Left Y-Axis for Heart Rate */}
                              {(performanceMetric === 'hr' || performanceMetric === 'both') && (
                                <YAxis 
                                  yAxisId="left"
                                  domain={['dataMin - 10', 'dataMax + 10']}
                                  stroke="#f43f5e" 
                                  fontSize={9}
                                  tickLine={false}
                                  label={{ value: 'Puls (bpm)', angle: -90, position: 'insideLeft', style: { fill: '#f43f5e', fontSize: 9, fontWeight: 'bold' } }}
                                />
                              )}

                              {/* Right Y-Axis for Speed */}
                              {(performanceMetric === 'speed' || performanceMetric === 'both') && (
                                <YAxis 
                                  yAxisId="right"
                                  orientation="right"
                                  domain={['dataMin - 2', 'dataMax + 2']}
                                  stroke="#10b981" 
                                  fontSize={9}
                                  tickLine={false}
                                  label={{ value: 'Geschwindigkeit (km/h)', angle: 90, position: 'insideRight', style: { fill: '#10b981', fontSize: 9, fontWeight: 'bold' } }}
                                />
                              )}

                              <Tooltip 
                                content={({ active, payload }) => {
                                  if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                      <div className="bg-slate-900/95 text-white p-3 rounded-xl border border-slate-700/50 shadow-xl text-xs space-y-1.5 max-w-xs">
                                        <p className="font-extrabold text-[11px] truncate text-slate-200">{data.name}</p>
                                        <p className="text-[10px] text-slate-400 font-bold">{data.date} • {data.type === 'cycling' ? 'Radsport' : 'Laufsport'}</p>
                                        <div className="border-t border-slate-800 my-1 pt-1 space-y-1 text-[10px]">
                                          <div className="flex justify-between gap-4">
                                            <span className="text-slate-400">Distanz:</span>
                                            <span className="font-mono font-bold text-white">{data.distance} km</span>
                                          </div>
                                          <div className="flex justify-between gap-4">
                                            <span className="text-slate-400">Dauer:</span>
                                            <span className="font-mono font-bold text-white">
                                              {Math.floor(data.duration / 3600)}h {Math.floor((data.duration % 3600) / 60)}m
                                            </span>
                                          </div>
                                          <div className="flex justify-between gap-4">
                                            <span className="text-slate-400">Geschwindigkeit:</span>
                                            <span className="font-mono font-bold text-emerald-400">{data.speed} km/h</span>
                                          </div>
                                          <div className="flex justify-between gap-4">
                                            <span className="text-slate-400">Pace:</span>
                                            <span className="font-mono font-bold text-teal-400">{data.formattedPace} min/km</span>
                                          </div>
                                          {data.avg_hr && (
                                            <div className="flex justify-between gap-4">
                                              <span className="text-slate-400">⌀ Puls:</span>
                                              <span className="font-mono font-bold text-rose-400">{data.avg_hr} bpm</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  }
                                  return null;
                                }}
                              />

                              <Legend wrapperStyle={{ fontSize: '9px', paddingTop: '8px' }} />

                              {/* Heart Rate Line */}
                              {(performanceMetric === 'hr' || performanceMetric === 'both') && (
                                <Line 
                                  yAxisId="left"
                                  type="monotone" 
                                  name="Durchschnittspuls (bpm)" 
                                  dataKey="avg_hr" 
                                  stroke="#f43f5e" 
                                  strokeWidth={2} 
                                  dot={{ r: 3, fill: '#f43f5e' }}
                                  activeDot={{ r: 5 }}
                                  connectNulls
                                />
                              )}

                              {/* Speed Line */}
                              {(performanceMetric === 'speed' || performanceMetric === 'both') && (
                                <Line 
                                  yAxisId="right"
                                  type="monotone" 
                                  name="Geschwindigkeit (km/h)" 
                                  dataKey="speed" 
                                  stroke="#10b981" 
                                  strokeWidth={2} 
                                  dot={{ r: 3, fill: '#10b981' }}
                                  activeDot={{ r: 5 }}
                                />
                              )}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Summary Cards */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 p-3 rounded-2xl flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 shrink-0">
                              <Calendar className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Workouts</p>
                              <p className="text-sm font-black text-slate-800 dark:text-white font-mono">{performanceStats.workoutCount}</p>
                            </div>
                          </div>

                          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 p-3 rounded-2xl flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500 shrink-0">
                              <Target className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Gesamtdistanz</p>
                              <p className="text-sm font-black text-slate-800 dark:text-white font-mono">{performanceStats.totalDistance} km</p>
                            </div>
                          </div>

                          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 p-3 rounded-2xl flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 shrink-0">
                              <TrendingUp className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">⌀ Geschwindigkeit</p>
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-sm font-black text-slate-800 dark:text-white font-mono">{performanceStats.avgSpeed} <span className="text-[10px] font-bold text-slate-400">km/h</span></span>
                                {performanceStats.speedDiff !== 0 && (
                                  <span className={`text-[9px] font-black flex items-center ${performanceStats.speedTrend === 'up' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    {performanceStats.speedDiff > 0 ? `+${performanceStats.speedDiff}` : performanceStats.speedDiff}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 p-3 rounded-2xl flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500 shrink-0">
                              <Heart className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">⌀ Herzfrequenz</p>
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-sm font-black text-slate-800 dark:text-white font-mono">{performanceStats.avgHr > 0 ? `${performanceStats.avgHr} bpm` : '--'}</span>
                                {performanceStats.avgHr > 0 && performanceStats.hrDiff !== 0 && (
                                  <span className={`text-[9px] font-black flex items-center ${performanceStats.hrTrend === 'down' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    {performanceStats.hrDiff > 0 ? `+${performanceStats.hrDiff}` : performanceStats.hrDiff}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Scientific Insights */}
                        <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900/50 border border-slate-150 dark:border-slate-800 text-[11px] leading-relaxed text-slate-600 dark:text-slate-350 flex items-start gap-3">
                          <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5 animate-spin-slow" />
                          <div>
                            <span className="font-extrabold text-slate-700 dark:text-white uppercase tracking-wider text-[9px] block mb-1">Leistungs-Analyse & Effizienztrend</span>
                            {performanceStats.avgHr === 0 ? (
                              <p>
                                Deine durchschnittliche Geschwindigkeit beträgt <strong>{performanceStats.avgSpeed} km/h</strong>. 
                                {performanceStats.speedDiff > 0 ? (
                                  <span> Sie hat sich im Vergleich zur ersten Hälfte der 4 Wochen um <strong>{performanceStats.speedDiff} km/h gesteigert</strong> – ein exzellenter Trend!</span>
                                ) : performanceStats.speedDiff < 0 ? (
                                  <span> Sie ist im Vergleich zur ersten Hälfte um <strong>{Math.abs(performanceStats.speedDiff)} km/h gesunken</strong>. Achte darauf, dein Trainingsvolumen anzupassen.</span>
                                ) : (
                                  <span> Deine Leistung bleibt über die letzten 4 Wochen konstant stabil.</span>
                                )}
                              </p>
                            ) : (
                              <p>
                                {performanceStats.efficiencyTrend === 'up' && (
                                  <span>
                                    🚀 <strong>Hervorragend!</strong> Deine aerobe Effizienz (Geschwindigkeit im Verhältnis zur Herzfrequenz) hat sich in den letzten 14 Tagen um <strong>{performanceStats.efficiencyPercent}% verbessert</strong>. 
                                    Das bedeutet, du erreichst dieselbe Geschwindigkeit bei einem niedrigeren Puls – ein klassischer Beleg für gesteigerte kardiovaskuläre Fitness!
                                  </span>
                                )}
                                {performanceStats.efficiencyTrend === 'down' && (
                                  <span>
                                    ⚠️ <strong>Erhöhte Belastung:</strong> Deine Trainingseffizienz ist um <strong>{Math.abs(performanceStats.efficiencyPercent)}% gesunken</strong>. 
                                    Dies kann auf akute Müdigkeit, unzureichende Erholung, Stress oder einen Infekt hindeuten. Reduziere die Intensität für 2–3 Tage.
                                  </span>
                                )}
                                {performanceStats.efficiencyTrend === 'stable' && (
                                  <span>
                                    ⚖️ <strong>Konsolidierungsphase:</strong> Deine aerobe Effizienz ist mit <strong>{performanceStats.efficiencyPercent}% Veränderung stabil</strong>. 
                                    Dein Körper hat sich gut an das aktuelle Trainingsniveau angepasst. Ein neuer Reiz (z. B. Intervalle) könnte neue Leistungszuwächse triggern.
                                  </span>
                                )}
                              </p>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Science explanation */}
                  <div className="bg-slate-50 dark:bg-slate-800/20 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400 space-y-2">
                    <h4 className="font-extrabold text-slate-700 dark:text-slate-350 uppercase tracking-wide flex items-center gap-1.5 text-[10px]">
                      <Info className="w-3.5 h-3.5 text-indigo-500" />
                      Hintergrund des Banister-Modells (Coggan-Algorithmus)
                    </h4>
                    <p>
                      Dieses Cockpit berechnet deine aerobe Leistungsfähigkeit mittels der <strong>Drei-Parameter-Systemtheorie</strong> nach Dr. Andrew Coggan.
                      Jedes Mal, wenn du trainierst, erzeugst du einen <strong>TSS (Training Stress Score)</strong>. Jedes Training hat zwei gegensätzliche Wirkungen: 
                      Es steigert deine Fitness (Langzeit-Belastung CTL, gedämpft über 42 Tage) und erzeugt gleichzeitig Müdigkeit (Kurzzeit-Erschöpfung ATL, gedämpft über 7 Tage).
                    </p>
                    <p>
                      Deine tatsächliche tagesaktuelle <strong>Form (TSB, Training Stress Balance)</strong> ergibt sich aus der Differenz deiner gestrigen Fitness abzüglich der gestrigen Müdigkeit. 
                      Optimales Training findet statt, wenn du dich kontinuierlich in einer <i>Überlastungs-Superkompensation</i> (TSB von -10 bis -30) befindest, ohne die kritische Schwelle von -30 zu durchbrechen, was ein Übertraining auslösen würde.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 2: Power-Duration MMP Curve */}
              {activeTab === 'power' && (
                <div className="space-y-6">
                  <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-200/50 dark:border-slate-800 rounded-3xl p-4 md:p-6">
                    <h3 className="text-xs font-black text-slate-700 dark:text-slate-350 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Zap className="w-4 h-4 text-amber-500 animate-pulse" />
                      All-time Mean Maximal Power (MMP) - Leistungskurve
                    </h3>
                    <p className="text-xs text-slate-500 mb-6">
                      Zeigt deine historisch besten Leistungspeaks (Watt) über verschiedene Belastungszeiträume hinweg.
                    </p>

                    <div className="h-80 w-full mb-6">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={allTimePowerCurve}
                          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                          <XAxis 
                            dataKey="label" 
                            stroke="#888888" 
                            fontSize={10}
                            tickLine={false} 
                          />
                          <YAxis 
                            stroke="#888888" 
                            fontSize={10}
                            tickLine={false}
                            label={{ value: 'Absolute Leistung (W)', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#888888' }}
                          />
                          <Tooltip 
                            contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: 'none', borderRadius: '12px', fontSize: '11px', color: '#fff' }}
                            formatter={(value: any, name: any, props: any) => {
                              if (name === "Absolute Power") return [`${value} W (${props.payload.relPower} W/kg)`, name];
                              return [value, name];
                            }}
                          />
                          <Line 
                            type="monotone" 
                            name="Absolute Power" 
                            dataKey="power" 
                            stroke="#f59e0b" 
                            strokeWidth={3} 
                            activeDot={{ r: 6 }} 
                            dot={{ stroke: '#f59e0b', strokeWidth: 2, r: 4, fill: '#fff' }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Peak Values Cards with source reference */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                      {allTimePowerCurve.filter(item => [1, 5, 60, 1200].includes(item.duration)).map((item) => (
                        <div key={item.duration} className="bg-white dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700 p-4 rounded-2xl shadow-sm">
                          <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">
                            Peak {item.duration === 1 ? '1 Sekunde (Sprint)' : item.duration === 5 ? '5 Sekunden (Sprint)' : item.duration === 60 ? '1 Minute (Anaerob)' : '20 Minuten (Schwelle / FTP)'}
                          </span>
                          <div className="text-xl font-black text-slate-800 dark:text-white font-mono mt-1">
                            {item.power} W
                          </div>
                          <div className="text-xs font-bold text-slate-500 font-mono mt-0.5">
                            {item.relPower} W/kg
                          </div>
                          <div className="text-[9px] text-slate-400 mt-2 truncate font-semibold" title={item.activityName}>
                            🚴 {item.activityName || 'N/A'}
                          </div>
                          <div className="text-[8px] text-slate-400 font-mono mt-0.5">
                            {item.date || 'N/A'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Sport Science context */}
                  <div className="bg-slate-50 dark:bg-slate-800/20 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400 space-y-2">
                    <h4 className="font-extrabold text-slate-700 dark:text-slate-350 uppercase tracking-wide flex items-center gap-1.5 text-[10px]">
                      <Award className="w-3.5 h-3.5 text-amber-500" />
                      Athletenprofil & Trainingsimplikationen
                    </h4>
                    <p>
                      Die Leistungskurve ordnet dich in physiologische Kategorien ein:
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-1">
                      <li><strong>5s Peak &gt; 10 W/kg:</strong> Starke neuromuskuläre Rekrutierung (Sprinter-Profil).</li>
                      <li><strong>1m Peak &gt; 6 W/kg:</strong> Hohe anaerobe Kapazität (Kriteriums-Spezialist / Puncheur).</li>
                      <li><strong>5m Peak &gt; 4.5 W/kg:</strong> Exzellente maximale Sauerstoffaufnahme (VO2 Max, Klassik-Profil).</li>
                      <li><strong>20m Peak &gt; 3.5 W/kg:</strong> Starke Laktatschwelle (Zeitfahrer- / Bergfahrer-Profil). FTP entspricht ca. 95% deines 20-Minuten-Peaks.</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* TAB 3: Zones & Polarization Analysis */}
              {activeTab === 'zones' && (
                <div className="space-y-6">
                  {/* Polarization classification */}
                  <div className="bg-indigo-500/5 border border-indigo-150 rounded-2xl p-4 flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-extrabold text-indigo-500 uppercase tracking-wider block">Verteilung & Struktur</span>
                      <h4 className="text-sm font-black text-slate-800 dark:text-white mt-1">
                        Klassifizierung: <span className="text-indigo-600 dark:text-indigo-400">{trainingZonesAggr.classification}</span>
                      </h4>
                    </div>
                    <Layers className="w-8 h-8 text-indigo-500 opacity-60" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Heart Rate Zones Chart */}
                    <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-200/50 dark:border-slate-800 rounded-3xl p-4">
                      <h3 className="text-xs font-black text-slate-700 dark:text-slate-350 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                        <Heart className="w-4 h-4 text-rose-500 animate-pulse" />
                        Pulsbereiche (HF) - Gesamtverteilung
                      </h3>

                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            layout="vertical"
                            data={trainingZonesAggr.hrData}
                            margin={{ top: 10, right: 10, left: 30, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                            <XAxis type="number" stroke="#888888" fontSize={9} tickLine={false} unit="%" />
                            <YAxis type="category" dataKey="name" stroke="#888888" fontSize={9} width={60} tickLine={false} />
                            <Tooltip contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: 'none', borderRadius: '10px', fontSize: '10px', color: '#fff' }} />
                            <Bar dataKey="percent" name="Prozentanteil" fill="#f43f5e" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="mt-4 space-y-2">
                        {trainingZonesAggr.hrData.map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs">
                            <span className="text-slate-500 font-semibold">{item.name.split(' (')[0]}</span>
                            <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                              {item.percent}% ({item.hours}h)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Power Zones Chart */}
                    <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-200/50 dark:border-slate-800 rounded-3xl p-4">
                      <h3 className="text-xs font-black text-slate-700 dark:text-slate-350 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                        <Zap className="w-4 h-4 text-amber-500" />
                        Leistungsbereiche (Power) - Gesamtverteilung
                      </h3>

                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            layout="vertical"
                            data={trainingZonesAggr.pwrData}
                            margin={{ top: 10, right: 10, left: 30, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                            <XAxis type="number" stroke="#888888" fontSize={9} tickLine={false} unit="%" />
                            <YAxis type="category" dataKey="name" stroke="#888888" fontSize={9} width={60} tickLine={false} />
                            <Tooltip contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: 'none', borderRadius: '10px', fontSize: '10px', color: '#fff' }} />
                            <Bar dataKey="percent" name="Prozentanteil" fill="#fbbf24" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="mt-4 space-y-2">
                        {trainingZonesAggr.pwrData.map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs">
                            <span className="text-slate-500 font-semibold">{item.name.split(' <')[0].split(' 55')[0].split(' 75')[0].split(' 90')[0].split(' 105')[0].split(' 120')[0]}</span>
                            <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                              {item.percent}% ({item.hours}h)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: Interactive Goals & Sports Science Training Advisor */}
              {activeTab === 'goals' && (
                <div className="space-y-6">
                  {/* Banner Header */}
                  <div className="bg-gradient-to-r from-indigo-600 to-indigo-800 text-white p-6 rounded-3xl shadow-lg relative overflow-hidden">
                    <div className="absolute right-0 top-0 translate-x-12 -translate-y-6 opacity-10 pointer-events-none">
                      <Target className="w-64 h-64 text-white" />
                    </div>
                    <div className="relative z-10 max-w-2xl">
                      <span className="bg-white/20 text-white text-[10px] uppercase font-black tracking-widest px-2.5 py-1 rounded-full border border-white/10">
                        Wissenschaftlicher Trainingsberater (EWMA-Modell)
                      </span>
                      <h2 className="text-xl font-black mt-2 uppercase tracking-tight">
                        Dein individueller Trainingsrechner
                      </h2>
                      <p className="text-xs text-indigo-100 mt-1 leading-relaxed">
                        Berechne präzise wöchentliche Trainingsstress-Zielwerte (TSS) und spezifische Schlüsseleinheiten basierend auf deiner aktuellen Fitness (CTL) und deinem individuellen Ziel.
                      </p>
                    </div>
                  </div>

                  {/* Main Work Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* LEFT PANEL: Goal definition & GPX Parser */}
                    <div className="lg:col-span-5 space-y-6">
                      <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-200/50 dark:border-slate-800 p-5 rounded-3xl space-y-5">
                        <h3 className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                          <Sliders className="w-4 h-4 text-indigo-500" />
                          1. Ziel-Konfiguration
                        </h3>

                        {/* Presets */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Ziel-Schablone wählen</label>
                          <div className="grid grid-cols-3 gap-2">
                            <button
                              onClick={() => setGoalType('halfmarathon')}
                              className={`py-2 px-1 rounded-xl text-xs font-extrabold transition-all border ${goalType === 'halfmarathon' ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs' : 'bg-white hover:bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'}`}
                            >
                              Halbmarathon
                            </button>
                            <button
                              onClick={() => setGoalType('marathon')}
                              className={`py-2 px-1 rounded-xl text-xs font-extrabold transition-all border ${goalType === 'marathon' ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs' : 'bg-white hover:bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'}`}
                            >
                              Marathon
                            </button>
                            <button
                              onClick={() => setGoalType('tour')}
                              className={`py-2 px-1 rounded-xl text-xs font-extrabold transition-all border ${goalType === 'tour' ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs' : 'bg-white hover:bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'}`}
                            >
                              Eigene Tour
                            </button>
                          </div>
                        </div>

                        {/* Goal Name */}
                        <div className="space-y-1">
                          <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Name des Ziels</label>
                          <input
                            type="text"
                            value={goalName}
                            onChange={e => setGoalName(e.target.value)}
                            placeholder="Z.B. Hamburg Marathon"
                            className="w-full px-3 py-2 text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 text-slate-800 dark:text-white"
                          />
                        </div>

                        {/* Sport Selector */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Sportart</label>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setGoalSport('running')}
                              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-1.5 ${goalSport === 'running' ? 'bg-emerald-500/10 border-emerald-500 text-emerald-500' : 'bg-white border-slate-200 dark:bg-slate-800 dark:border-slate-700 text-slate-600 dark:text-slate-400'}`}
                            >
                              🏃 Laufen
                            </button>
                            <button
                              onClick={() => setGoalSport('cycling')}
                              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-1.5 ${goalSport === 'cycling' ? 'bg-amber-500/10 border-amber-500 text-amber-500' : 'bg-white border-slate-200 dark:bg-slate-800 dark:border-slate-700 text-slate-600 dark:text-slate-400'}`}
                            >
                              🚴 Radsport
                            </button>
                          </div>
                        </div>

                        {/* Distance & Elevation inputs */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Distanz (km)</label>
                            <div className="relative">
                              <input
                                type="number"
                                step="0.1"
                                value={goalDistance}
                                onChange={e => setGoalDistance(Math.max(0, parseFloat(e.target.value) || 0))}
                                className="w-full pl-3 pr-8 py-2 text-xs font-mono font-extrabold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 text-slate-800 dark:text-white"
                              />
                              <span className="absolute right-3 top-2.5 text-[9px] font-bold text-slate-400 uppercase">km</span>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Höhenmeter (hm)</label>
                            <div className="relative">
                              <input
                                type="number"
                                value={goalElevation}
                                onChange={e => setGoalElevation(Math.max(0, parseInt(e.target.value) || 0))}
                                className="w-full pl-3 pr-8 py-2 text-xs font-mono font-extrabold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 text-slate-800 dark:text-white"
                              />
                              <span className="absolute right-3 top-2.5 text-[9px] font-bold text-slate-400 uppercase">m</span>
                            </div>
                          </div>
                        </div>

                        {/* GPX Upload Zone */}
                        <div className="space-y-2">
                          <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
                            GPX-Dateien laden (Optional für exakte Strecke)
                          </label>
                          <div
                            onDragEnter={handleDrag}
                            onDragOver={handleDrag}
                            onDragLeave={handleDrag}
                            onDrop={handleDrop}
                            className={`border-2 border-dashed rounded-2xl p-4 text-center transition-all relative ${dragActive ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'} hover:border-indigo-500/50 cursor-pointer`}
                          >
                            <input
                              type="file"
                              multiple
                              accept=".gpx"
                              onChange={handleGpxUpload}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              id="gpx-goal-uploader"
                            />
                            <div className="flex flex-col items-center justify-center gap-1">
                              <Upload className="w-5 h-5 text-indigo-500 mb-1 animate-pulse" />
                              <p className="text-[10px] font-black text-slate-700 dark:text-slate-300">
                                GPX-Dateien hier hineinziehen oder klicken
                              </p>
                              <p className="text-[8px] text-slate-400">
                                Ermittelt Höhenprofil & Distanz mehrerer GPX-Abschnitte dynamisch
                              </p>
                            </div>
                          </div>

                          {gpxLoading && (
                            <div className="text-center py-2 text-[10px] font-bold text-slate-400 flex items-center justify-center gap-1.5">
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                              Lese GPX-Tracks ein...
                            </div>
                          )}

                          {/* Uploaded GPX Tracks list */}
                          {uploadedGpxTracks.length > 0 && (
                            <div className="space-y-1.5 pt-2">
                              <div className="flex justify-between items-center">
                                <span className="text-[9px] font-extrabold text-slate-400 uppercase">Geladene Route ({uploadedGpxTracks.length})</span>
                                <button
                                  onClick={() => {
                                    setUploadedGpxTracks([]);
                                    setGoalDistance(goalType === 'marathon' ? 42.2 : goalType === 'halfmarathon' ? 21.1 : 100);
                                    setGoalElevation(goalType === 'marathon' ? 300 : goalType === 'halfmarathon' ? 150 : 1500);
                                  }}
                                  className="text-[8px] font-bold text-rose-500 hover:underline cursor-pointer"
                                >
                                  Alle löschen
                                </button>
                              </div>
                              <div className="max-h-36 overflow-y-auto space-y-1 pr-1 border border-slate-100 dark:border-slate-800 rounded-xl p-1.5 bg-white dark:bg-slate-900">
                                {uploadedGpxTracks.map((track) => (
                                  <div key={track.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 p-1.5 rounded-lg border border-slate-100 dark:border-slate-800 text-[10px]">
                                    <div className="truncate flex-1 pr-2">
                                      <span className="font-extrabold text-slate-700 dark:text-slate-300 block truncate">{track.name}</span>
                                      <span className="font-mono text-slate-400 text-[8px] font-medium">
                                        {track.distance.toFixed(1)} km | ▲ {Math.round(track.ascent)} hm | {track.pointsCount} Punkte
                                      </span>
                                    </div>
                                    <button
                                      onClick={() => removeUploadedTrack(track.id)}
                                      className="text-slate-400 hover:text-rose-500 p-1 transition-colors cursor-pointer"
                                      title="Track entfernen"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* RIGHT PANEL: Sports Science Recommendations */}
                    <div className="lg:col-span-7 space-y-6">
                      {/* Vorbereitungs Score Card */}
                      <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-200/50 dark:border-slate-800 p-5 rounded-3xl space-y-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Berechnete Bereitschaft</span>
                            <h3 className="text-sm font-black text-slate-800 dark:text-white mt-0.5">
                              Ziel-Vorbereitungsindex
                            </h3>
                          </div>
                          <div className={`text-xl font-mono font-black ${trainingRecommendations.readinessScore >= 80 ? 'text-emerald-500' : trainingRecommendations.readinessScore >= 50 ? 'text-amber-500' : 'text-rose-500'}`}>
                            {trainingRecommendations.readinessScore}%
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ${trainingRecommendations.readinessScore >= 80 ? 'bg-emerald-500' : trainingRecommendations.readinessScore >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                            style={{ width: `${trainingRecommendations.readinessScore}%` }}
                          />
                        </div>

                        {/* Comparison blocks */}
                        <div className="grid grid-cols-2 gap-4 pt-2">
                          <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-150 dark:border-slate-750">
                            <span className="block text-[8px] font-extrabold text-slate-400 uppercase">Aktuelle Fitness (CTL)</span>
                            <span className="text-base font-mono font-black text-slate-800 dark:text-white">{currentFitness.ctl}</span>
                          </div>
                          <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-150 dark:border-slate-750">
                            <span className="block text-[8px] font-extrabold text-slate-400 uppercase">Empfohlene Fitness (Ziel-CTL)</span>
                            <span className="text-base font-mono font-black text-indigo-500">{trainingRecommendations.targetCtl}</span>
                          </div>
                        </div>

                        {/* Text callout feedback based on readiness */}
                        <div className="text-xs leading-relaxed text-slate-500 dark:text-slate-400 pt-1">
                          {trainingRecommendations.readinessScore >= 90 ? (
                            <div className="flex gap-2 items-start bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border border-emerald-500/10 p-3 rounded-2xl">
                              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                              <p>
                                <strong>Hervorragend vorbereitet!</strong> Dein aerobes CTL-Belastungsniveau ist stark genug, um das Ziel <strong>'{goalName}'</strong> souverän und gesund zu bewältigen. Halte dieses Level stabil und vermeide extreme Erhöhungen vor dem Event.
                              </p>
                            </div>
                          ) : trainingRecommendations.readinessScore >= 60 ? (
                            <div className="flex gap-2 items-start bg-amber-500/5 text-amber-600 dark:text-amber-400 border border-amber-500/10 p-3 rounded-2xl">
                              <Award className="w-4 h-4 shrink-0 mt-0.5" />
                              <p>
                                <strong>Solide Zwischenbasis!</strong> Du bist bereits auf einem guten Weg. Um das Risiko für muskuläre Übermüdung oder Krämpfe zu minimieren, solltest du deine Fitness durch progressive Steigerungen um weitere <strong>{trainingRecommendations.ctlGap} CTL-Punkte</strong> ausbauen.
                              </p>
                            </div>
                          ) : (
                            <div className="flex gap-2 items-start bg-rose-500/5 text-rose-600 dark:text-rose-400 border border-rose-500/10 p-3 rounded-2xl">
                              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                              <p>
                                <strong>Intensiver Trainingsaufbau empfohlen!</strong> Deine aktuelle Fitness (CTL = {currentFitness.ctl}) liegt deutlich unter dem sportwissenschaftlichen Zielkorridor. Um Verletzungen der Sehnen oder Gelenke zu verhindern, solltest du ein strukturiertes Ausdauertraining beginnen.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Bento grid metrics */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-750 p-3 rounded-2xl">
                          <span className="block text-[8px] font-extrabold text-slate-400 uppercase">Wochen-TSS Ziel</span>
                          <span className="text-sm font-mono font-black text-slate-800 dark:text-white block mt-0.5">
                            {trainingRecommendations.weeklyTssTargetRange[0]} - {trainingRecommendations.weeklyTssTargetRange[1]}
                          </span>
                          <span className="text-[7.5px] font-bold text-slate-400">Punkte Trainingsstress</span>
                        </div>

                        <div className="bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-750 p-3 rounded-2xl">
                          <span className="block text-[8px] font-extrabold text-slate-400 uppercase">Est. Event-Dauer</span>
                          <span className="text-sm font-mono font-black text-indigo-500 block mt-0.5">
                            {trainingRecommendations.estDurationHours} Std
                          </span>
                          <span className="text-[7.5px] font-bold text-slate-400">Unter Belastung</span>
                        </div>

                        <div className="bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-750 p-3 rounded-2xl">
                          <span className="block text-[8px] font-extrabold text-slate-400 uppercase">Est. Event-Stress</span>
                          <span className="text-sm font-mono font-black text-amber-500 block mt-0.5">
                            {trainingRecommendations.estTss} TSS
                          </span>
                          <span className="text-[7.5px] font-bold text-slate-400">Einzeltagesreiz</span>
                        </div>

                        <div className="bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-750 p-3 rounded-2xl">
                          <span className="block text-[8px] font-extrabold text-slate-400 uppercase">Sichere Steigerung</span>
                          <span className="text-sm font-mono font-black text-emerald-500 block mt-0.5">
                            +3 bis +5 CTL
                          </span>
                          <span className="text-[7.5px] font-bold text-slate-400">max. pro Woche (ACWR)</span>
                        </div>
                      </div>

                      {/* SCIENTIFIC PERIODIZED TRAINING PLAN */}
                      <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-200/50 dark:border-slate-800 p-5 rounded-3xl space-y-5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <h4 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                              <Calendar className="w-4 h-4 text-indigo-500" />
                              3. Dein Wissenschaftlicher Trainingsplan
                            </h4>
                            <span className="text-[9px] text-slate-400 font-bold block mt-0.5">
                              Periodisiertes Ausdauermodell (Base &gt; Build &gt; Peak &gt; Taper)
                            </span>
                          </div>
                          
                          {/* Duration Selectors */}
                          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                            {([4, 8, 12] as const).map((d) => (
                              <button
                                key={d}
                                onClick={() => {
                                  setPlanDuration(d);
                                  setSelectedWeekIndex(0);
                                }}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold transition-all ${planDuration === d ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}
                              >
                                {d} Wochen
                              </button>
                            ))}
                          </div>
                        </div>

                         {/* Activity Profile Adaptation Badge & Database History Selector */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-750 p-4 rounded-2xl space-y-4">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                            <div>
                              <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider block">
                                SQLite Datenbank-Analysefenster
                              </span>
                              <span className="text-[11px] text-slate-600 dark:text-slate-300 font-bold block mt-0.5">
                                Zeitraum für die Ermittlung deines Ist-Zustands:
                              </span>
                            </div>
                            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl self-start sm:self-auto">
                              <button
                                onClick={() => setHistoryAnalysisRange('1week')}
                                className={`px-2 py-1 rounded-lg text-[9px] font-extrabold transition-all cursor-pointer ${historyAnalysisRange === '1week' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}
                              >
                                Letzte Woche
                              </button>
                              <button
                                onClick={() => setHistoryAnalysisRange('4weeks')}
                                className={`px-2 py-1 rounded-lg text-[9px] font-extrabold transition-all cursor-pointer ${historyAnalysisRange === '4weeks' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}
                              >
                                Letzte 4 Wochen
                              </button>
                              <button
                                onClick={() => setHistoryAnalysisRange('all')}
                                className={`px-2 py-1 rounded-lg text-[9px] font-extrabold transition-all cursor-pointer ${historyAnalysisRange === 'all' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}
                              >
                                Ganze Historie
                              </button>
                            </div>
                          </div>

                          <div className="flex gap-3 items-start">
                            <div className="bg-emerald-500/10 p-1.5 rounded-xl border border-emerald-500/20 text-emerald-500 shrink-0">
                              <Activity className="w-4 h-4" />
                            </div>
                            <div className="text-[11px] leading-relaxed">
                              <strong className="text-slate-700 dark:text-slate-300 block">
                                Analyse: {activityProfile.historyRangeLabel} ({activityProfile.filteredCount} von {activities.length} Aktivitäten geladen)
                              </strong>
                              <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                                Im ausgewählten Zeitraum zeigt deine Trainingshistorie durchschnittlich <strong className="text-indigo-500">{activityProfile.avgWeeklySessions} Einheiten</strong> mit <strong className="text-indigo-500">{activityProfile.avgWeeklyDistance} km</strong> pro Woche. 
                                {activityProfile.isTrained ? (
                                  <span className="text-emerald-500 font-medium"> Aufgrund deiner stabilen sportlichen Basis startet dein Trainingsplan direkt mit anspruchsvollen Schwellenreizen.</span>
                                ) : (
                                  <span className="text-amber-500 font-medium"> Aufgrund des geringeren aktuellen Volumens wurde die Intensität gedämpft, um eine Gelenk- und Sehnenüberlastung zu vermeiden.</span>
                                )}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Horizontal Week Timeline Picker */}
                        <div className="space-y-2">
                          <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Woche auswählen</label>
                          <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-thin">
                            {generatedPlan.map((week, idx) => (
                              <button
                                key={week.weekNumber}
                                onClick={() => setSelectedWeekIndex(idx)}
                                className={`shrink-0 py-2 px-3.5 rounded-xl text-center border transition-all cursor-pointer ${selectedWeekIndex === idx ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white hover:bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'}`}
                              >
                                <span className="block text-[10px] font-black uppercase">W{week.weekNumber}</span>
                                <span className="block text-[8px] font-mono opacity-80 mt-0.5">{week.targetTss} TSS</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Active Week Details Card */}
                        {generatedPlan[selectedWeekIndex] && (
                          <div className="space-y-4 pt-1">
                            {/* Phase Theory Box */}
                            <div className="bg-indigo-500/5 border border-indigo-500/10 p-4 rounded-2xl space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="bg-indigo-600 text-white text-[9px] px-2 py-0.5 rounded-md font-extrabold uppercase tracking-wide">
                                  {generatedPlan[selectedWeekIndex].phase}
                                </span>
                                <span className="text-xs font-mono font-extrabold text-indigo-600 dark:text-indigo-400">
                                  Soll: {generatedPlan[selectedWeekIndex].targetTss} TSS
                                </span>
                              </div>
                              <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-350 pt-1">
                                {generatedPlan[selectedWeekIndex].phaseDesc}
                              </p>
                            </div>

                            {/* 3 Workouts Container */}
                            <div className="space-y-3.5">
                              {generatedPlan[selectedWeekIndex].workouts.map((workout: any, wIdx: number) => (
                                <div 
                                  key={wIdx} 
                                  className="bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-750 rounded-2xl p-4 space-y-3 shadow-xs hover:border-indigo-500/30 transition-all"
                                >
                                  {/* Workout Header */}
                                  <div className="flex justify-between items-start gap-2">
                                    <div>
                                      <span className="text-[8px] font-mono font-extrabold px-1.5 py-0.5 rounded-md uppercase bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-950">
                                        Einheit {wIdx + 1} • {workout.tss} TSS
                                      </span>
                                      <h5 className="text-xs font-extrabold text-slate-800 dark:text-white mt-1.5">
                                        {workout.title}
                                      </h5>
                                    </div>
                                    <button
                                      onClick={() => exportToTcx(workout)}
                                      className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-slate-900 font-extrabold px-2.5 py-1 rounded-lg text-[9px] transition-all cursor-pointer shadow-xs shrink-0"
                                      title="Als TCX Workout für Garmin Uhr/Radcomputer downloaden"
                                    >
                                      <FileText className="w-3 h-3" />
                                      Garmin Export
                                    </button>
                                  </div>

                                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                    {workout.description}
                                  </p>

                                  {/* Workout Steps */}
                                  <div className="border-t border-slate-100 dark:border-slate-755 pt-2.5 space-y-1.5">
                                    <span className="text-[8px] font-extrabold text-slate-400 uppercase tracking-wider block">
                                      Geplante Abschnitte (Workouts-Struktur)
                                    </span>
                                    <div className="space-y-1">
                                      {workout.steps.map((step: any, sIdx: number) => (
                                        <div 
                                          key={sIdx} 
                                          className="flex items-center justify-between text-[10px] bg-slate-50 dark:bg-slate-800/65 p-1.5 rounded-lg border border-slate-100/50 dark:border-slate-800"
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className="font-mono text-slate-400 text-[8px]">{sIdx + 1}.</span>
                                            <span className="font-bold text-slate-700 dark:text-slate-300">
                                              {step.name} {step.reps && step.reps > 1 ? `(${step.reps}x)` : ''}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-2 font-mono">
                                            <span className="text-slate-500 font-bold">
                                              {step.durationMinutes} Min
                                            </span>
                                            {step.restDurationMinutes ? (
                                              <span className="text-slate-400 text-[9px]">
                                                (+{step.restDurationMinutes}m Pause)
                                              </span>
                                            ) : null}
                                            <span className="text-slate-300">|</span>
                                            {goalSport === 'cycling' && step.targetFtpPercent ? (
                                              <span className="text-amber-500 font-black">
                                                {Math.round((ftp * step.targetFtpPercent) / 100)} W ({step.targetFtpPercent}% FTP)
                                              </span>
                                            ) : step.targetHrPercent ? (
                                              <span className="text-emerald-500 font-black">
                                                {Math.round((maxHr * step.targetHrPercent) / 100)} bpm ({step.targetHrPercent}% HF)
                                              </span>
                                            ) : (
                                              <span className="text-slate-400 font-medium">Locker</span>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Garmin Import Guide */}
                            <div className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 text-[10px] text-slate-500 dark:text-slate-400 space-y-1.5">
                              <h6 className="font-extrabold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1 text-[9px]">
                                <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                Wie lade ich das Training auf meine Garmin Uhr?
                              </h6>
                              <ol className="list-decimal list-inside space-y-1 pl-1">
                                <li>Lade das Workout über die <strong className="text-amber-500 font-bold">Garmin Export</strong> Buttons als <strong className="font-bold">.TCX</strong> herunter.</li>
                                <li>Gehe auf <a href="https://connect.garmin.com" target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline font-bold">connect.garmin.com</a> im Browser.</li>
                                <li>Öffne im Menü links <strong className="font-semibold">"Training & Planung" &gt; "Trainings"</strong>.</li>
                                <li>Klicke ganz oben rechts auf <strong className="font-semibold">"Training importieren"</strong> und wähle die heruntergeladene Datei aus.</li>
                                <li>Das Training erscheint jetzt in deiner Garmin Connect Bibliothek und kann an dein Garmin Gerät (Fenix, Forerunner, Edge etc.) übertragen werden!</li>
                              </ol>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: Comprehensive Activity List & Inspector */}
              {activeTab === 'activities' && !selectedActivity && (
                <div className="space-y-4">
                  {/* Search and Filters */}
                  <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                    <div className="relative w-full sm:w-72">
                      <input 
                        type="text"
                        placeholder="Aktivität suchen..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-3 pr-3 py-2 bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    
                    <div className="flex gap-2 w-full sm:w-auto overflow-x-auto">
                      <button
                        onClick={() => setFilterType('all')}
                        className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${filterType === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-50 hover:bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                      >
                        Alle Sportarten
                      </button>
                      <button
                        onClick={() => setFilterType('cycling')}
                        className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${filterType === 'cycling' ? 'bg-amber-500 text-white' : 'bg-slate-50 hover:bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                      >
                        🚴 Radsport
                      </button>
                      <button
                        onClick={() => setFilterType('running')}
                        className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${filterType === 'running' ? 'bg-emerald-500 text-white' : 'bg-slate-50 hover:bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                      >
                        🏃 Laufen
                      </button>
                    </div>
                  </div>

                  {/* List Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredActivitiesList.map((act) => {
                      const isCycling = act.type.toLowerCase().includes('cycle') || act.type.toLowerCase().includes('bike');
                      
                      return (
                        <div 
                          key={act.id}
                          onClick={() => setSelectedActivity(act)}
                          className="bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-750 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-amber-500/30 transition-all cursor-pointer group flex flex-col justify-between h-44"
                        >
                          <div>
                            <div className="flex justify-between items-start gap-1">
                              <span className="text-[10px] font-mono text-slate-400 font-bold">
                                {new Date(act.date).toLocaleDateString('de-DE')}
                              </span>
                              <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-md uppercase border ${isCycling ? 'bg-amber-500/5 text-amber-500 border-amber-500/10' : 'bg-emerald-500/5 text-emerald-500 border-emerald-500/10'}`}>
                                {isCycling ? '🚴 Radsport' : '🏃 Laufen'}
                              </span>
                            </div>
                            
                            <h4 className="text-xs font-extrabold text-slate-800 dark:text-white mt-2 group-hover:text-amber-500 transition-colors line-clamp-1">
                              {act.name}
                            </h4>
                            
                            {act.location && (
                              <p className="text-[9px] text-slate-400 font-semibold mt-0.5">
                                📍 {act.location}
                              </p>
                            )}

                            {/* Mini metrics bar */}
                            <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                              <div className="bg-slate-50 dark:bg-slate-900/60 p-1 rounded-lg">
                                <span className="block text-[8px] text-slate-400 uppercase font-bold">Distanz</span>
                                <span className="text-xs font-black font-mono text-slate-700 dark:text-slate-300">{act.distance.toFixed(1)} km</span>
                              </div>
                              <div className="bg-slate-50 dark:bg-slate-900/60 p-1 rounded-lg">
                                <span className="block text-[8px] text-slate-400 uppercase font-bold">Dauer</span>
                                <span className="text-xs font-black font-mono text-slate-700 dark:text-slate-300">
                                  {Math.floor(act.duration / 3600)}h {Math.floor((act.duration % 3600) / 60)}m
                                </span>
                              </div>
                              <div className="bg-slate-50 dark:bg-slate-900/60 p-1 rounded-lg">
                                <span className="block text-[8px] text-slate-400 uppercase font-bold">Belastung</span>
                                <span className="text-xs font-black font-mono text-amber-500">{act.tss} TSS</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                            <span>Wissenschaftlich analysieren</span>
                            <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 4-B: Detailed Activity Deep-Dive Inspector */}
              {activeTab === 'activities' && selectedActivity && (
                <div className="space-y-6">
                  {/* Back button */}
                  <button 
                    onClick={() => setSelectedActivity(null)}
                    className="flex items-center gap-1.5 text-xs font-extrabold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 px-3.5 py-2 rounded-xl transition-all cursor-pointer"
                  >
                    ← Zurück zur Übersicht
                  </button>

                  <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-200/50 dark:border-slate-800 rounded-3xl p-5 space-y-6">
                    {/* Activity metadata */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-200/40">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-slate-400 font-bold">
                            {new Date(selectedActivity.date).toLocaleDateString('de-DE')}
                          </span>
                          <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-md uppercase border ${selectedActivity.type.toLowerCase().includes('cycle') || selectedActivity.type.toLowerCase().includes('bike') ? 'bg-amber-500/5 text-amber-500 border-amber-500/10' : 'bg-emerald-500/5 text-emerald-500 border-emerald-500/10'}`}>
                            {selectedActivity.type.toLowerCase().includes('cycle') || selectedActivity.type.toLowerCase().includes('bike') ? '🚴 Radsport' : '🏃 Laufen'}
                          </span>
                        </div>
                        <h2 className="text-base font-black text-slate-800 dark:text-white mt-1">
                          {selectedActivity.name}
                        </h2>
                        {selectedActivity.location && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            📍 {selectedActivity.location}
                          </p>
                        )}
                      </div>

                      {/* Advanced sports metrics */}
                      <div className="flex flex-wrap gap-2">
                        <div className="bg-amber-500/5 text-amber-500 border border-amber-500/10 rounded-2xl px-3.5 py-2 text-center shadow-2xs">
                          <span className="block text-[8px] font-extrabold uppercase tracking-wider text-amber-600">Normalized Power</span>
                          <span className="text-lg font-black font-mono">
                            {(selectedActivity as any).np > 0 ? `${(selectedActivity as any).np} W` : 'Keine Daten'}
                          </span>
                        </div>
                        
                        <div className="bg-indigo-500/5 text-indigo-500 border border-indigo-500/10 rounded-2xl px-3.5 py-2 text-center shadow-2xs">
                          <span className="block text-[8px] font-extrabold uppercase tracking-wider text-indigo-600">Intensitätsfaktor (IF)</span>
                          <span className="text-lg font-black font-mono">
                            {(selectedActivity as any).intensityFactor ? (selectedActivity as any).intensityFactor.toFixed(2) : '0.00'}
                          </span>
                        </div>

                        <div className="bg-emerald-500/5 text-emerald-500 border border-emerald-500/10 rounded-2xl px-3.5 py-2 text-center shadow-2xs">
                          <span className="block text-[8px] font-extrabold uppercase tracking-wider text-emerald-600">Stress-Score (TSS)</span>
                          <span className="text-lg font-black font-mono">
                            {(selectedActivity as any).tss} TSS
                          </span>
                        </div>

                        <div className="bg-rose-500/5 text-rose-500 border border-rose-500/10 rounded-2xl px-3.5 py-2 text-center shadow-2xs">
                          <span className="block text-[8px] font-extrabold uppercase tracking-wider text-rose-600">Variabilitätsindex (VI)</span>
                          <span className="text-lg font-black font-mono">
                            {(selectedActivity as any).variabilityIndex ? (selectedActivity as any).variabilityIndex.toFixed(2) : '1.00'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Simple summary cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                      <div className="bg-white dark:bg-slate-800 p-3.5 rounded-2xl border border-slate-200/50">
                        <span className="text-[9px] text-slate-400 font-extrabold uppercase block mb-0.5">Distanz</span>
                        <span className="text-lg font-black font-mono text-slate-800 dark:text-white">{selectedActivity.distance.toFixed(2)} km</span>
                      </div>
                      
                      <div className="bg-white dark:bg-slate-800 p-3.5 rounded-2xl border border-slate-200/50">
                        <span className="text-[9px] text-slate-400 font-extrabold uppercase block mb-0.5">Dauer</span>
                        <span className="text-lg font-black font-mono text-slate-800 dark:text-white">
                          {Math.floor(selectedActivity.duration / 3600)}h {Math.floor((selectedActivity.duration % 3600) / 60)}m {Math.floor(selectedActivity.duration % 60)}s
                        </span>
                      </div>

                      <div className="bg-white dark:bg-slate-800 p-3.5 rounded-2xl border border-slate-200/50">
                        <span className="text-[9px] text-slate-400 font-extrabold uppercase block mb-0.5">Höhenmeter</span>
                        <span className="text-lg font-black font-mono text-slate-800 dark:text-white">
                          ▲ {Math.round(selectedActivity.ascent || 0)} m | ▼ {Math.round(selectedActivity.descent || 0)} m
                        </span>
                      </div>

                      <div className="bg-white dark:bg-slate-800 p-3.5 rounded-2xl border border-slate-200/50">
                        <span className="text-[9px] text-slate-400 font-extrabold uppercase block mb-0.5">Kalorien & Herzfrequenz</span>
                        <span className="text-sm font-black font-mono text-slate-800 dark:text-white block mt-0.5">
                          🔥 {selectedActivity.calories || 0} kcal
                        </span>
                        <span className="text-[9px] font-bold text-slate-400 font-mono block mt-0.5">
                          Ø Puls: {selectedActivity.avg_hr || 'N/A'} bpm
                        </span>
                      </div>
                    </div>

                    {/* Dual-Axis Telemetry Chart */}
                    {activityPoints.length > 5 ? (
                      <div className="bg-white dark:bg-slate-800 border border-slate-250/50 rounded-2xl p-4">
                        <h3 className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-4">
                          Detailliertes Telemetrie-Diagramm
                        </h3>

                        <div className="h-72 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart
                              data={activityPoints}
                              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                              <XAxis 
                                dataKey="time" 
                                stroke="#888888" 
                                fontSize={8}
                                tickFormatter={(val) => {
                                  if (!val) return '';
                                  try {
                                    const d = new Date(val);
                                    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                                  } catch (e) {
                                    return '';
                                  }
                                }}
                                tickLine={false} 
                              />
                              <YAxis 
                                yAxisId="left"
                                stroke="#888888" 
                                fontSize={8}
                                tickLine={false}
                                label={{ value: 'Puls / Watt', angle: -90, position: 'insideLeft', fontSize: 8 }}
                              />
                              <YAxis 
                                yAxisId="right"
                                orientation="right"
                                stroke="#888888" 
                                fontSize={8}
                                tickLine={false}
                                label={{ value: 'Höhe (m)', angle: 90, position: 'insideRight', fontSize: 8 }}
                              />
                              <Tooltip 
                                contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: 'none', borderRadius: '12px', fontSize: '10px', color: '#fff' }}
                              />
                              
                              <Line yAxisId="left" type="monotone" name="Puls (bpm)" dataKey="hr" stroke="#f43f5e" strokeWidth={1.5} dot={false} />
                              <Line yAxisId="left" type="monotone" name="Leistung (W)" dataKey="power" stroke="#fbbf24" strokeWidth={1.5} dot={false} />
                              <Line yAxisId="right" type="monotone" name="Höhe (m)" dataKey="ele" stroke="#3b82f6" strokeWidth={1} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white dark:bg-slate-800 border border-slate-250/50 rounded-2xl p-6 text-center text-xs text-slate-500">
                        Keine detaillierten GPX/FIT-Verlaufspunkte vorhanden (Aktivität hat eventuell nur Zusammenfassungsdaten).
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
