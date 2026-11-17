import React, { useState, useMemo } from 'react';
import {
  Zap,
  Wind,
  Flame,
  Scale,
  Activity,
  ArrowUpRight,
  BatteryCharging,
  Crosshair,
  AlertTriangle,
  Gauge,
  HeartPulse,
  Footprints,
  HelpCircle,
  Timer
} from 'lucide-react';
import { GPXTrack } from '../../types';
import {
  calculateDistance,
  estimateMedianSamplingIntervalSec,
  isRecordingPauseGap,
  calculatePowerStats
} from '../../utils/gpxUtils';
import { computeTrackWbal } from '../../utils/wbalEngine';
import { resolveTrackCapabilities, isFitTrackFile, computeTrackAvgSpeedKmh } from '../../utils/trackTelemetryCapabilities';
import {
  computePauseAwareRunningMetrics,
  deriveDefaultCriticalSpeedMs,
  formatPaceSeconds
} from '../../utils/runningMetricsEngine';
import { resolveTrackPointSpeedsKmh } from '../../domain/telemetry/pointMetricsEngine';
import { NumericProfileInput } from '../NumericProfileInput';
import { triggerHaptic } from '../../utils/haptics';

interface PowerPhysicsTabProps {
  track: GPXTrack;
  activityType: 'cycling' | 'running';
  initialWeight?: number;
  initialFtp?: number;
  onOpenGlossary?: (metricId?: string) => void;
  onSelectTrackPoint?: (lat: number, lng: number) => void;
}

export const PowerPhysicsTab: React.FC<PowerPhysicsTabProps> = ({
  track,
  activityType,
  initialWeight = 75,
  initialFtp = 220,
  onOpenGlossary,
  onSelectTrackPoint
}) => {
  const capabilities = useMemo(() => resolveTrackCapabilities({ ...track, activityType }), [track, activityType]);

  // Cycling parameters
  const [riderWeight, setRiderWeight] = useState<number>(initialWeight);
  const [bikeType, setBikeType] = useState<'road' | 'gravel' | 'mtb'>('road');
  const [ridingPosition, setRidingPosition] = useState<'drops' | 'hoods' | 'tops'>('hoods');
  const [windSpeedKmh, setWindSpeedKmh] = useState<number>(0);
  const [ftpValue, setFtpValue] = useState<number>(initialFtp);
  const [wPrimeKj, setWPrimeKj] = useState<number>(20);
  const [bikeWeight, setBikeWeight] = useState<number>(bikeType === 'road' ? 8.5 : bikeType === 'gravel' ? 10.5 : 12.5);
  const [hoverWbalIdx, setHoverWbalIdx] = useState<number | null>(null);

  // Running parameters (Critical Speed in sec/km & D' in meters)
  const defaultCsPaceSec = useMemo(() => {
    const csMs = deriveDefaultCriticalSpeedMs(track);
    return Math.max(165, Math.min(480, Math.round(1000 / csMs)));
  }, [track]);
  const [criticalPaceSecKm, setCriticalPaceSecKm] = useState<number>(defaultCsPaceSec);
  const [dPrimeMeters, setDPrimeMeters] = useState<number>(200);
  const [hoverDbalIdx, setHoverDbalIdx] = useState<number | null>(null);

  // Sync default CS when switching tracks
  React.useEffect(() => {
    setCriticalPaceSecKm(defaultCsPaceSec);
  }, [defaultCsPaceSec]);

  const handleBikeTypeChange = (type: 'road' | 'gravel' | 'mtb') => {
    setBikeType(type);
    setBikeWeight(type === 'road' ? 8.5 : type === 'gravel' ? 10.5 : 12.5);
    triggerHaptic('light');
  };

  // Running metrics computation (pause-aware)
  const runningMetrics = useMemo(() => {
    if (!capabilities.isRunning || !capabilities.hasPowerPhysicsTabData) return null;
    return computePauseAwareRunningMetrics(track, {
      criticalPaceSecKm,
      dPrimeMeters,
    });
  }, [capabilities.isRunning, capabilities.hasPowerPhysicsTabData, track, criticalPaceSecKm, dPrimeMeters]);

  const trackAvgSpeedKmh = useMemo(() => computeTrackAvgSpeedKmh(track), [track]);

  // Native running power (only if Stryd/watch recorded real wattage)
  const nativeRunningPower = useMemo(() => {
    if (!capabilities.isRunning || !capabilities.hasNativePower) return null;
    return calculatePowerStats(track.points, ftpValue, riderWeight, trackAvgSpeedKmh || 11, 'running') || null;
  }, [capabilities.isRunning, capabilities.hasNativePower, track.points, ftpValue, riderWeight, trackAvgSpeedKmh]);

  // Cycling W'bal (strictly cycling + real power or timestamps)
  const wbalAnalysis = useMemo(() => {
    if (!capabilities.hasWbalData) return null;
    const cpWatts = Math.max(80, Math.round(ftpValue * 0.96));
    return computeTrackWbal(track, {
      cpWatts,
      wPrimeKj,
      riderWeightKg: riderWeight,
      bikeWeightKg: bikeWeight,
      estimatedSpeedKmh: trackAvgSpeedKmh || 24,
    });
  }, [capabilities.hasWbalData, track, ftpValue, wPrimeKj, riderWeight, bikeWeight, trackAvgSpeedKmh]);

  // Cycling pause-aware drag & resistance modeling
  const physics = useMemo(() => {
    if (!capabilities.isCycling || !capabilities.hasPowerPhysicsTabData) return null;
    const points = track.points || [];
    if (points.length < 2) return null;

    const g = 9.81;
    const airDensity = 1.225;
    const totalMassKg = riderWeight + bikeWeight;

    let crr = 0.004;
    if (bikeType === 'gravel') crr = 0.0065;
    if (bikeType === 'mtb') crr = 0.009;

    let cda = 0.32;
    if (ridingPosition === 'drops') cda = 0.27;
    if (ridingPosition === 'tops') cda = 0.38;

    const windSpeedMs = (windSpeedKmh * 1000) / 3600;
    const medianDtSec = estimateMedianSamplingIntervalSec(points);
    const resolvedSpeeds = resolveTrackPointSpeedsKmh(points, {
      isFitFile: isFitTrackFile(track),
      activityType: 'cycling',
      trackDistanceKm: track.distance,
      trackDurationSec: track.duration,
    });

    let totalMovingSec = 0;
    let sumWorkClimbJ = 0;
    let sumWorkAeroJ = 0;
    let sumWorkRollJ = 0;
    let sumNativeWorkJ = 0;
    let nativeCount = 0;
    const power1sBuffer: number[] = [];

    const defaultSpeedMs = ((trackAvgSpeedKmh && trackAvgSpeedKmh > 5 ? trackAvgSpeedKmh : 24) * 1000) / 3600;

    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];
      const distKm = calculateDistance(p1, p2);
      const distM = distKm * 1000;
      if (distM <= 0.2) continue;

      let dtSec = 0;
      if (capabilities.hasTimestamps && p1.time && p2.time) {
        const diff = (new Date(p2.time).getTime() - new Date(p1.time).getTime()) / 1000;
        if (diff > 0) {
          if (diff >= 600 || isRecordingPauseGap(diff, distKm, medianDtSec)) {
            continue; // Exclude recording pause gaps from active work & averages
          }
          dtSec = diff;
        }
      }
      if (dtSec <= 0) {
        const spKmh = resolvedSpeeds[i];
        const vEst = spKmh && spKmh >= 1.6 ? spKmh / 3.6 : defaultSpeedMs;
        dtSec = distM / vEst;
      }

      const v = distM / dtSec;
      if (v * 3.6 < 1.6) {
        continue; // Exclude standstill
      }

      totalMovingSec += dtSec;

      const dEle = capabilities.hasRealElevation ? (p2.ele || 0) - (p1.ele || 0) : 0;
      const grade = Math.max(-0.25, Math.min(0.28, dEle / distM));

      const fClimb = totalMassKg * g * Math.sin(Math.atan(grade));
      const pClimb = Math.max(0, fClimb * v);
      const pRoll = crr * totalMassKg * g * Math.cos(Math.atan(grade)) * v;
      const vAir = v + windSpeedMs;
      const fAero = 0.5 * airDensity * cda * vAir * Math.abs(vAir);
      const pAero = Math.max(0, fAero * v);

      const pTotalWheel = pClimb + pRoll + pAero;
      const pModeled = grade < -0.04 ? 0 : pTotalWheel / 0.975;
      const pMech =
        capabilities.hasNativePower && typeof p2.power === 'number' && Number.isFinite(p2.power)
          ? p2.power
          : pModeled;

      if (capabilities.hasNativePower && typeof p2.power === 'number') {
        sumNativeWorkJ += p2.power * dtSec;
        nativeCount++;
      }

      sumWorkClimbJ += pClimb * dtSec;
      sumWorkAeroJ += pAero * dtSec;
      sumWorkRollJ += pRoll * dtSec;

      const secSteps = Math.max(1, Math.min(30, Math.round(dtSec)));
      for (let s = 0; s < secSteps; s++) {
        power1sBuffer.push(pMech);
      }
    }

    if (totalMovingSec <= 0) return null;

    const durationHrs = Math.max(0.1, totalMovingSec / 3600);
    const modeledMechanicalJoules = sumWorkClimbJ + sumWorkAeroJ + sumWorkRollJ;
    const totalMechanicalJoules =
      capabilities.hasNativePower && nativeCount > 10 && sumNativeWorkJ > 0
        ? sumNativeWorkJ
        : modeledMechanicalJoules;
    const workKj = Math.round(totalMechanicalJoules / 1000);
    const caloriesKcal = Math.round(totalMechanicalJoules / 4184 / 0.23);
    const avgPowerWatts = Math.round(totalMechanicalJoules / Math.max(1, totalMovingSec));

    // Normalized Power (30s rolling 4th-power over active moving seconds)
    let npWatts = avgPowerWatts;
    if (power1sBuffer.length >= 30) {
      let rollSum = 0;
      for (let i = 0; i < 30; i++) rollSum += power1sBuffer[i];
      let pow4Sum = Math.pow(rollSum / 30, 4);
      let pow4Count = 1;
      for (let i = 30; i < power1sBuffer.length; i++) {
        rollSum += power1sBuffer[i] - power1sBuffer[i - 30];
        pow4Sum += Math.pow(rollSum / 30, 4);
        pow4Count++;
      }
      npWatts = Math.round(Math.pow(pow4Sum / pow4Count, 0.25));
    }
    npWatts = Math.max(avgPowerWatts, Math.min(Math.round(avgPowerWatts * 1.4), npWatts));

    const intensityFactor = Number((npWatts / Math.max(100, ftpValue)).toFixed(2));
    const tss = Math.round(((totalMovingSec * npWatts * intensityFactor) / (ftpValue * 3600)) * 100);
    const variabilityIndex = Number((npWatts / Math.max(1, avgPowerWatts)).toFixed(2));

    const pClimbAvg = Math.round(sumWorkClimbJ / Math.max(1, totalMovingSec));
    const pAeroAvg = Math.round(sumWorkAeroJ / Math.max(1, totalMovingSec));
    const pRollAvg = Math.round(sumWorkRollJ / Math.max(1, totalMovingSec));
    const pLossAvg = Math.max(0, Math.round(avgPowerWatts - (pClimbAvg + pAeroAvg + pRollAvg)));

    const sumP = Math.max(1, pClimbAvg + pAeroAvg + pRollAvg + pLossAvg);
    const pClimbPct = Math.round((pClimbAvg / sumP) * 100);
    const pAeroPct = Math.round((pAeroAvg / sumP) * 100);
    const pRollPct = Math.round((pRollAvg / sumP) * 100);
    const pLossPct = Math.max(0, 100 - (pClimbPct + pAeroPct + pRollPct));

    const fatFraction = Math.max(0.1, Math.min(0.7, 0.95 - intensityFactor * 0.8));
    const carbFraction = 1.0 - fatFraction;
    const fatGrams = Math.round((caloriesKcal * fatFraction) / 9.3);
    const carbGrams = Math.round((caloriesKcal * carbFraction) / 4.1);
    const fatPct = Math.round(fatFraction * 100);
    const carbPct = Math.round(carbFraction * 100);
    const gelsCount = Math.max(1, Math.round(carbGrams / 25));
    const gelsPerHour = (gelsCount / durationHrs).toFixed(1);

    return {
      avgPowerWatts,
      normalizedPowerWatts: npWatts,
      intensityFactor,
      tss,
      variabilityIndex,
      workKj,
      caloriesKcal,
      powerClimbWatts: pClimbAvg,
      powerAeroWatts: pAeroAvg,
      powerRollWatts: pRollAvg,
      powerLossWatts: pLossAvg,
      pClimbPct,
      pAeroPct,
      pRollPct,
      pLossPct,
      fatGrams,
      carbGrams,
      fatPct,
      carbPct,
      gelsCount,
      gelsPerHour,
      wKgAvg: (avgPowerWatts / riderWeight).toFixed(2),
      wKgFtp: (ftpValue / riderWeight).toFixed(2)
    };
  }, [capabilities, track, riderWeight, bikeType, ridingPosition, windSpeedKmh, ftpValue, bikeWeight]);

  const formatShortDur = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.round(sec % 60);
    if (h > 0) return `${h}h ${m}m`;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  // Empty state if neither cycling nor running has authentic telemetry
  if (!capabilities.hasPowerPhysicsTabData) {
    return (
      <div className="p-8 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-center space-y-2">
        <Activity className="w-8 h-8 text-slate-400 mx-auto" />
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
          Keine Leistungs- oder Zeitstempel-Telemetrie vorhanden
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
          {capabilities.isRunning
            ? 'Für laufspezifische Kennzahlen (GAP, Critical Speed, D\'bal, rTSS, Pa:HR, Schrittfrequenz) werden aufgezeichnete Zeitstempel oder Lauf-Sensordaten benötigt.'
            : 'Für Leistungs-, W\'bal- und Widerstandsanalysen werden aufgezeichnete Zeitstempel oder Powermeter-Daten benötigt. Geplante Routen können im Taktik-Simulator geplant werden.'}
        </p>
      </div>
    );
  }

  // =========================================================================
  // RUNNING MODE: Critical Speed, D'bal, GAP/NGP, rTSS, Pa:HR, Cadence (spm)
  // =========================================================================
  if (capabilities.isRunning && runningMetrics) {
    return (
      <div className="space-y-6">
        {/* Critical Speed & D' Configuration Card */}
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700/80 pb-3">
            <div className="flex items-center gap-2">
              <Gauge className="w-5 h-5 text-emerald-500" />
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Lauf-Telemetrie · Critical Speed (CS) &amp; D&apos;bal Modell
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Pausenbereinigte Auswertung · Pausen zählen physiologisch als Erholung, verzerren aber keine Pace- oder Belastungswerte
                </p>
              </div>
            </div>

            {onOpenGlossary && (
              <button
                type="button"
                onClick={() => onOpenGlossary('critical_speed_dbal')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                Laufmetriken im Glossar
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            {/* Critical Speed Slider */}
            <div className="space-y-1.5 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-emerald-500" />
                  Critical Speed (CS-Pace):
                </span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-black tabular-nums">
                  {formatPaceSeconds(criticalPaceSecKm)} min/km ({(3600 / criticalPaceSecKm).toFixed(1)} km/h)
                </span>
              </div>
              <input
                type="range"
                min={165}
                max={480}
                step={5}
                value={criticalPaceSecKm}
                onChange={(e) => setCriticalPaceSecKm(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-mono tabular-nums">
                <span>2:45 min/km</span>
                <span>Laktat-/Belastungsschwelle Laufen</span>
                <span>8:00 min/km</span>
              </div>
            </div>

            {/* D' Prime Capacity Slider */}
            <div className="space-y-1.5 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <BatteryCharging className="w-3.5 h-3.5 text-violet-500" />
                  Anaerobe Distanzreserve (D&apos;):
                </span>
                <div className="flex items-center gap-1.5">
                  <NumericProfileInput
                    value={dPrimeMeters}
                    min={80}
                    max={500}
                    step={10}
                    onChange={setDPrimeMeters}
                    className="w-16 px-2 py-0.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono font-bold text-violet-600 dark:text-violet-400 text-center tabular-nums"
                  />
                  <span className="text-slate-400 font-mono">m</span>
                </div>
              </div>
              <input
                type="range"
                min={80}
                max={450}
                step={10}
                value={dPrimeMeters}
                onChange={(e) => setDPrimeMeters(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-mono tabular-nums">
                <span>80 m (Marathonläufer)</span>
                <span>200 m (Standard)</span>
                <span>450 m (Bahnsprinter)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Running KPI Row — strictly gated by available data */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {runningMetrics.avgPaceFormatted && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Ø Pace (Bewegung)</span>
                <Timer className="w-4 h-4 text-sky-500" />
              </div>
              <div className="text-2xl font-black text-slate-900 dark:text-white font-mono tabular-nums">
                {runningMetrics.avgPaceFormatted} <span className="text-xs font-sans font-bold text-slate-500">min/km</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                {runningMetrics.avgSpeedKmh} km/h
                {runningMetrics.pauseTimeSec > 0 && ` · Pause ${formatShortDur(runningMetrics.pauseTimeSec)}`}
              </div>
            </div>
          )}

          {capabilities.hasGapData && runningMetrics.avgGapPaceFormatted && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <button
                  type="button"
                  onClick={() => onOpenGlossary?.('gap')}
                  className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-indigo-500 flex items-center gap-1 cursor-pointer"
                >
                  GAP (Minetti) <HelpCircle className="w-3 h-3" />
                </button>
                <ArrowUpRight className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                {runningMetrics.avgGapPaceFormatted} <span className="text-xs font-sans font-bold text-slate-500">min/km</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                {runningMetrics.ngpPaceFormatted
                  ? `NGP: ${runningMetrics.ngpPaceFormatted} min/km`
                  : `${runningMetrics.avgGapSpeedKmh} km/h flach-äquiv.`}
              </div>
            </div>
          )}

          {capabilities.hasRtssData && runningMetrics.rTss !== null && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <button
                  type="button"
                  onClick={() => onOpenGlossary?.('rtss')}
                  className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-indigo-500 flex items-center gap-1 cursor-pointer"
                >
                  Lauf-Belastung (rTSS) <HelpCircle className="w-3 h-3" />
                </button>
                <Flame className="w-4 h-4 text-rose-500" />
              </div>
              <div className="text-2xl font-black text-rose-600 dark:text-rose-400 font-mono tabular-nums">
                {runningMetrics.rTss} <span className="text-xs font-sans font-bold text-slate-500">rTSS</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                IF: {runningMetrics.intensityFactor?.toFixed(2)} vs. CS ({runningMetrics.criticalPaceFormatted})
              </div>
            </div>
          )}

          {capabilities.hasPaHrData && runningMetrics.paHrEf !== null && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <button
                  type="button"
                  onClick={() => onOpenGlossary?.('pa_hr')}
                  className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-indigo-500 flex items-center gap-1 cursor-pointer"
                >
                  Pa:HR Effizienz <HelpCircle className="w-3 h-3" />
                </button>
                <HeartPulse className="w-4 h-4 text-rose-500" />
              </div>
              <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400 font-mono tabular-nums">
                {runningMetrics.paHrEf.toFixed(2)} <span className="text-xs font-sans font-bold text-slate-500">EF</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                {runningMetrics.hasValidDecoupling && runningMetrics.aerobicDecouplingPct !== null
                  ? `Drift: ${runningMetrics.aerobicDecouplingPct >= 0 ? '+' : ''}${runningMetrics.aerobicDecouplingPct}%`
                  : 'm/min pro Herzschlag'}
              </div>
            </div>
          )}
        </div>

        {/* D'bal Reserve & Anaerobic Running Matches (only when pace/speed exists) */}
        {capabilities.hasDbalData && runningMetrics.series.length > 2 && (
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
                  <BatteryCharging className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                    D&apos;bal &amp; Anaerobe Lauf-Reserve (Critical-Speed-Modell)
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Entleerung in Metern über Critical Speed ({capabilities.hasRealElevation ? 'GAP-basiert' : 'Pace-basiert'}) · Erholung bei &lt; CS und in Pausen
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
                <span className="text-slate-500">
                  CS: <strong className="text-slate-900 dark:text-white">{runningMetrics.criticalPaceFormatted} min/km</strong>
                </span>
                <span className="text-slate-300 dark:text-slate-700">|</span>
                <span className="text-slate-500">
                  D&apos;: <strong className="text-violet-600 dark:text-violet-400">{runningMetrics.dPrimeMeters} m</strong>
                </span>
              </div>
            </div>

            {/* D'bal KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Min. D&apos;bal Reserve</span>
                <div
                  className={`text-lg font-black font-mono tabular-nums mt-0.5 ${
                    runningMetrics.minDbalPct < 25
                      ? 'text-rose-600 dark:text-rose-400'
                      : runningMetrics.minDbalPct < 50
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {runningMetrics.minDbalPct}%{' '}
                  <span className="text-xs font-normal text-slate-500">({runningMetrics.minDbalMeters} m)</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                  Tiefpunkt bei km {runningMetrics.minDbalDistKm}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Tempoverschärfungen</span>
                <div className="text-lg font-black text-violet-600 dark:text-violet-400 font-mono tabular-nums mt-0.5">
                  {runningMetrics.matches.length}{' '}
                  <span className="text-xs font-sans font-semibold text-slate-500">Surges</span>
                </div>
                <span className="text-[10px] text-slate-400">Ab &ge;15% D&apos;-Entleerung über CS</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Zeit über CS</span>
                <div className="text-lg font-black text-slate-900 dark:text-white font-mono tabular-nums mt-0.5">
                  {formatShortDur(runningMetrics.timeAboveCsSec)}
                </div>
                <span className="text-[10px] text-slate-400">Überschwellige Laufzeit</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Distanz über CS</span>
                <div className="text-lg font-black text-amber-600 dark:text-amber-400 font-mono tabular-nums mt-0.5">
                  {runningMetrics.distAboveCsM} m
                </div>
                <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                  {(runningMetrics.distAboveCsM / Math.max(1, runningMetrics.dPrimeMeters)).toFixed(1)}× D&apos;-Reserve umgesetzt
                </span>
              </div>
            </div>

            {/* Interactive D'bal & GAP Speed SVG Chart */}
            {(() => {
              const series = runningMetrics.series;
              const maxDist = Math.max(0.1, series[series.length - 1].distanceKm);
              const minEle = Math.min(...series.map((p) => p.ele));
              const maxEle = Math.max(minEle + 20, ...series.map((p) => p.ele));
              const maxGapKmh = Math.max(runningMetrics.criticalSpeedKmh * 1.4, ...series.map((p) => p.gapSpeedKmh));

              const width = 760;
              const height = 175;
              const padL = 36;
              const padR = 36;
              const padT = 14;
              const padB = 24;
              const plotW = width - padL - padR;
              const plotH = height - padT - padB;

              const xForDist = (d: number) => padL + (d / maxDist) * plotW;
              const yForPct = (pct: number) => padT + ((100 - Math.max(0, Math.min(100, pct))) / 100) * plotH;
              const yForEle = (e: number) => padT + plotH - ((e - minEle) / (maxEle - minEle)) * (plotH * 0.65);
              const yForSpeed = (kmh: number) => padT + plotH - (Math.min(maxGapKmh, kmh) / maxGapKmh) * plotH;

              const elePolygon = capabilities.hasRealElevation
                ? [
                    `${padL},${padT + plotH}`,
                    ...series.map((p) => `${xForDist(p.distanceKm).toFixed(1)},${yForEle(p.ele).toFixed(1)}`),
                    `${padL + plotW},${padT + plotH}`
                  ].join(' ')
                : '';

              const gapPolyline = series
                .map((p) => `${xForDist(p.distanceKm).toFixed(1)},${yForSpeed(p.gapSpeedKmh).toFixed(1)}`)
                .join(' ');

              const dbalPolyline = series
                .map((p) => `${xForDist(p.distanceKm).toFixed(1)},${yForPct(p.dbalPct).toFixed(1)}`)
                .join(' ');

              const hoveredPt = hoverDbalIdx !== null && series[hoverDbalIdx] ? series[hoverDbalIdx] : null;

              return (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 font-bold text-violet-600 dark:text-violet-400">
                        <span className="w-3 h-0.5 bg-violet-500 inline-block" /> D&apos;bal Reserve (%)
                      </span>
                      <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                        <span className="w-3 h-0.5 bg-emerald-500/80 inline-block" />{' '}
                        {capabilities.hasGapData ? 'GAP Geschwindigkeit' : 'Laufgeschwindigkeit'}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-rose-500">
                        <span className="w-3 h-0.5 border-t border-dashed border-rose-500 inline-block" /> Kritische Reserve (25%)
                      </span>
                    </div>
                    {hoveredPt && (
                      <div className="font-mono text-[11px] tabular-nums bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-lg text-slate-700 dark:text-slate-200">
                        km {hoveredPt.distanceKm.toFixed(1)} ·{' '}
                        <strong className="text-violet-600 dark:text-violet-400">
                          D&apos;bal {hoveredPt.dbalPct.toFixed(0)}% ({hoveredPt.dbalMeters} m)
                        </strong>{' '}
                        · {hoveredPt.gapPaceSecKm ? `${formatPaceSeconds(hoveredPt.gapPaceSecKm)}/km` : 'Pause'}
                        {capabilities.hasRealElevation ? ` · ${hoveredPt.ele} m` : ''}
                      </div>
                    )}
                  </div>

                  <div className="relative rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
                    <svg
                      viewBox={`0 0 ${width} ${height}`}
                      className="w-full h-44 block select-none cursor-crosshair"
                      onMouseMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const relX = ((e.clientX - rect.left) / rect.width) * width;
                        const ratio = Math.max(0, Math.min(1, (relX - padL) / plotW));
                        const targetDist = ratio * maxDist;
                        let bestIdx = 0;
                        let bestDiff = Infinity;
                        for (let i = 0; i < series.length; i++) {
                          const d = Math.abs(series[i].distanceKm - targetDist);
                          if (d < bestDiff) {
                            bestDiff = d;
                            bestIdx = i;
                          }
                        }
                        setHoverDbalIdx(bestIdx);
                      }}
                      onMouseLeave={() => setHoverDbalIdx(null)}
                      onClick={() => {
                        if (hoveredPt && onSelectTrackPoint) {
                          triggerHaptic('light');
                          onSelectTrackPoint(hoveredPt.lat, hoveredPt.lng);
                        }
                      }}
                    >
                      {[100, 75, 50, 25, 0].map((pct) => {
                        const y = yForPct(pct);
                        const isCrit = pct === 25;
                        return (
                          <g key={pct}>
                            <line
                              x1={padL}
                              y1={y}
                              x2={width - padR}
                              y2={y}
                              stroke={isCrit ? '#f43f5e' : '#1e293b'}
                              strokeWidth={isCrit ? 1 : 0.75}
                              strokeDasharray={isCrit ? '4 3' : undefined}
                            />
                            <text
                              x={padL - 5}
                              y={y + 3}
                              textAnchor="end"
                              className={`text-[9px] font-mono ${isCrit ? 'fill-rose-400 font-bold' : 'fill-slate-500'}`}
                            >
                              {pct}%
                            </text>
                          </g>
                        );
                      })}

                      {elePolygon && <polygon points={elePolygon} fill="rgba(148, 163, 184, 0.14)" />}

                      <polyline
                        fill="none"
                        stroke="rgba(16, 185, 129, 0.55)"
                        strokeWidth="1.25"
                        points={gapPolyline}
                      />

                      <polyline
                        fill="none"
                        stroke="#a855f7"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={dbalPolyline}
                      />

                      {runningMetrics.matches.map((m) => (
                        <circle
                          key={m.id}
                          cx={xForDist(m.endKm)}
                          cy={yForPct(m.minDbalPct)}
                          r={4}
                          fill="#f43f5e"
                          stroke="#0f172a"
                          strokeWidth={1.5}
                        />
                      ))}

                      {hoveredPt && (
                        <g>
                          <line
                            x1={xForDist(hoveredPt.distanceKm)}
                            y1={padT}
                            x2={xForDist(hoveredPt.distanceKm)}
                            y2={padT + plotH}
                            stroke="#e2e8f0"
                            strokeWidth={1}
                            strokeDasharray="2 2"
                          />
                          <circle
                            cx={xForDist(hoveredPt.distanceKm)}
                            cy={yForPct(hoveredPt.dbalPct)}
                            r={4.5}
                            fill="#a855f7"
                            stroke="#ffffff"
                            strokeWidth={1.5}
                          />
                        </g>
                      )}

                      {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
                        const d = r * maxDist;
                        return (
                          <text
                            key={i}
                            x={xForDist(d)}
                            y={height - 6}
                            textAnchor="middle"
                            className="fill-slate-400 text-[9px] font-mono"
                          >
                            {d.toFixed(1)} km
                          </text>
                        );
                      })}
                    </svg>
                  </div>
                </div>
              );
            })()}

            {runningMetrics.matches.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <span>Erkannte Tempoverschärfungen über CS ({runningMetrics.matches.length})</span>
                  <span className="font-normal text-slate-500">Klick zentriert Surge auf der Karte</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {runningMetrics.matches.slice(0, 9).map((m) => (
                    <div
                      key={m.id}
                      onClick={() => {
                        if (onSelectTrackPoint) {
                          triggerHaptic('light');
                          onSelectTrackPoint(m.lat, m.lng);
                        }
                      }}
                      className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-violet-50/60 dark:hover:bg-violet-950/30 border border-slate-200 dark:border-slate-800 transition-colors cursor-pointer flex items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-1.5 font-mono font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                          <span className="text-rose-600 dark:text-rose-400 font-black text-[11px]">#{m.matchNumber}</span>
                          <span>· km {m.startKm}–{m.endKm}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                          {formatShortDur(m.durationSec)} · Ø {m.avgGapPaceFormatted} (Peak {m.peakGapPaceFormatted})
                        </div>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <div className="font-black text-rose-600 dark:text-rose-400">
                          -{m.metersBurned} m ({m.pctDPrimeBurned}%)
                        </div>
                        <div className="text-[10px] text-slate-500 flex items-center justify-end gap-1">
                          <span>Rest: {m.minDbalPct}%</span>
                          {onSelectTrackPoint && <Crosshair className="w-3 h-3 text-indigo-500" />}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Konstant aerobes Tempo: Keine tiefen D&apos;-Einbrüche (&ge;15%) über deiner Critical Speed ({runningMetrics.criticalPaceFormatted} min/km).
                </span>
              </div>
            )}
          </div>
        )}

        {/* Pa:HR & Aerobic Decoupling Card (only if both Speed/Pace and Heart Rate exist) */}
        {capabilities.hasPaHrData && runningMetrics.paHrEf !== null && (
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <HeartPulse className="w-4 h-4 text-rose-500" />
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                  Pa:HR Ökonomie &amp; Aerobische Entkopplung (Cardiac Drift)
                </h4>
              </div>
              {runningMetrics.hasValidDecoupling && runningMetrics.aerobicDecouplingPct !== null ? (
                <span
                  className={`text-xs font-mono font-black tabular-nums ${
                    runningMetrics.aerobicDecouplingPct <= 5
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : runningMetrics.aerobicDecouplingPct <= 8
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  Drift: {runningMetrics.aerobicDecouplingPct >= 0 ? '+' : ''}
                  {runningMetrics.aerobicDecouplingPct}% ({runningMetrics.aerobicDecouplingPct <= 5 ? 'Sehr stabil' : 'Erhöhter Pulsdrift'})
                </span>
              ) : (
                <span className="text-[11px] text-slate-400">Drift-Auswertung ab 10 Min. Laufzeit</span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Gesamt Efficiency Factor (EF)</span>
                <div className="text-lg font-black text-indigo-600 dark:text-indigo-400 font-mono tabular-nums mt-0.5">
                  {runningMetrics.paHrEf.toFixed(2)} <span className="text-[11px] font-sans font-normal text-slate-500">m/min/bpm</span>
                </div>
                <span className="text-[10px] text-slate-400">
                  {capabilities.hasGapData ? 'Basis: GAP-Geschwindigkeit / Puls' : 'Basis: Pace / Puls'}
                </span>
              </div>

              {runningMetrics.paHrFirstHalfEf !== null && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">1. Laufhälfte</span>
                  <div className="text-base font-black text-slate-900 dark:text-white font-mono tabular-nums mt-0.5">
                    EF {runningMetrics.paHrFirstHalfEf.toFixed(2)}
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                    {runningMetrics.paHrFirstHalfPaceFormatted}/km · Ø {runningMetrics.paHrFirstHalfAvgHr} bpm
                  </span>
                </div>
              )}

              {runningMetrics.paHrSecondHalfEf !== null && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">2. Laufhälfte</span>
                  <div className="text-base font-black text-slate-900 dark:text-white font-mono tabular-nums mt-0.5">
                    EF {runningMetrics.paHrSecondHalfEf.toFixed(2)}
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                    {runningMetrics.paHrSecondHalfPaceFormatted}/km · Ø {runningMetrics.paHrSecondHalfAvgHr} bpm
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Running Cadence (spm) Breakdown (only when real cadence exists) */}
        {capabilities.hasCadence && runningMetrics.avgCadenceSpm !== null && (
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <Footprints className="w-4 h-4 text-sky-500" />
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                  Schrittfrequenz-Analyse (Cadence in spm)
                </h4>
              </div>
              {runningMetrics.wasNormalizedFromCycles && (
                <span className="text-[11px] text-slate-400">
                  Beidbeinig normalisiert (×2 Schritte/Min.)
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                <span className="font-sans text-[10px] font-bold uppercase text-slate-400 block">Ø Schrittfrequenz</span>
                <div className="text-lg font-black text-sky-600 dark:text-sky-400 mt-0.5">
                  {runningMetrics.avgCadenceSpm} <span className="text-xs font-sans text-slate-500">spm</span>
                </div>
              </div>
              {runningMetrics.maxCadenceSpm !== null && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                  <span className="font-sans text-[10px] font-bold uppercase text-slate-400 block">Maximum</span>
                  <div className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                    {runningMetrics.maxCadenceSpm} <span className="text-xs font-sans text-slate-500">spm</span>
                  </div>
                </div>
              )}
              {runningMetrics.flatCadenceSpm !== null && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                  <span className="font-sans text-[10px] font-bold uppercase text-slate-400 block">Flach (&plusmn;2%)</span>
                  <div className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {runningMetrics.flatCadenceSpm} <span className="text-xs font-sans text-slate-500">spm</span>
                  </div>
                </div>
              )}
              {runningMetrics.uphillCadenceSpm !== null && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                  <span className="font-sans text-[10px] font-bold uppercase text-slate-400 block">Bergauf (&gt;3%)</span>
                  <div className="text-lg font-black text-amber-600 dark:text-amber-400 mt-0.5">
                    {runningMetrics.uphillCadenceSpm} <span className="text-xs font-sans text-slate-500">spm</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Native Running Power Card (ONLY when real Powermeter / Stryd data exists) */}
        {capabilities.hasNativePower && nativeRunningPower && (
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
              <Zap className="w-4 h-4 text-amber-500" />
              Echte Laufleistung (Aufgezeichnete Wattdaten)
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs font-mono tabular-nums pt-1">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <span className="font-sans text-[10px] uppercase font-bold text-slate-400 block">Ø Laufleistung</span>
                <span className="text-base font-black text-slate-900 dark:text-white">
                  {Math.round(nativeRunningPower.avgPower)} W
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <span className="font-sans text-[10px] uppercase font-bold text-slate-400 block">Max. Leistung</span>
                <span className="text-base font-black text-amber-600 dark:text-amber-400">
                  {Math.round(nativeRunningPower.maxPower)} W
                </span>
              </div>
              {nativeRunningPower.normalizedPower !== undefined && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                  <span className="font-sans text-[10px] uppercase font-bold text-slate-400 block">Normalized Power</span>
                  <span className="text-base font-black text-indigo-600 dark:text-indigo-400">
                    {Math.round(nativeRunningPower.normalizedPower)} W
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // CYCLING MODE: Power Physics, Resistance Decomposition & W'bal
  // =========================================================================
  return (
    <div className="space-y-6">
      {/* Simulation Controls Card */}
      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700/80 pb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Physikalisches Leistungs- &amp; Widerstandsmodell
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {capabilities.hasNativePower
                  ? 'Echte Powermeter-Daten kombiniert mit Steigungs-, Luft- & Rollwiderstand (pausenbereinigt)'
                  : 'Berechnung nach Newtonschen Gesetzen: Steigungskraft, Luftwiderstand, Rollreibung & W\'bal'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">FTP:</span>
              <NumericProfileInput
                value={ftpValue}
                min={100}
                max={550}
                step={5}
                onChange={setFtpValue}
                className="w-16 px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono font-bold text-slate-800 dark:text-slate-200 text-center focus:ring-2 focus:ring-amber-500 focus:outline-none tabular-nums"
              />
              <span className="text-xs text-slate-400">W</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300" title="Anaerobe Arbeitskapazität W' über Critical Power">W&apos;:</span>
              <NumericProfileInput
                value={wPrimeKj}
                min={8}
                max={45}
                step={0.5}
                onChange={setWPrimeKj}
                className="w-14 px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono font-bold text-violet-600 dark:text-violet-400 text-center focus:ring-2 focus:ring-violet-500 focus:outline-none tabular-nums"
              />
              <span className="text-xs text-slate-400">kJ</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          {/* Rider Weight & Bike Weight */}
          <div className="space-y-1.5">
            <div className="flex justify-between font-medium text-slate-600 dark:text-slate-300">
              <span className="flex items-center gap-1">
                <Scale className="w-3.5 h-3.5 text-indigo-500" />
                Fahrergewicht:
              </span>
              <span className="font-mono font-bold tabular-nums">{riderWeight} kg</span>
            </div>
            <input
              type="range"
              min={50}
              max={120}
              step={1}
              value={riderWeight}
              onChange={(e) => setRiderWeight(parseInt(e.target.value, 10))}
              className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400 tabular-nums">
              <span>50 kg</span>
              <span>System: {riderWeight + bikeWeight} kg</span>
              <span>120 kg</span>
            </div>
          </div>

          {/* Bike & Tire Type */}
          <div className="space-y-1.5">
            <label className="block font-medium text-slate-600 dark:text-slate-300">Rad- &amp; Reifentyp (Crr):</label>
            <div className="grid grid-cols-3 gap-1">
              {(['road', 'gravel', 'mtb'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleBikeTypeChange(t)}
                  className={`py-1.5 px-2 rounded-lg font-bold text-[11px] transition-colors cursor-pointer text-center ${
                    bikeType === t
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {t === 'road' ? 'Rennrad' : t === 'gravel' ? 'Gravel' : 'MTB'}
                </button>
              ))}
            </div>
          </div>

          {/* Riding Position */}
          <div className="space-y-1.5">
            <label className="block font-medium text-slate-600 dark:text-slate-300">Sitzhaltung (CdA):</label>
            <div className="grid grid-cols-3 gap-1">
              {[
                { key: 'drops' as const, label: 'Unterlenker', title: 'Unterlenker / Aero (CdA 0.27)' },
                { key: 'hoods' as const, label: 'Bremsgriffe', title: 'Bremsgriffe (CdA 0.32)' },
                { key: 'tops' as const, label: 'Aufrecht', title: 'Oberlenker / Aufrecht (CdA 0.38)' }
              ].map((pos) => (
                <button
                  key={pos.key}
                  type="button"
                  onClick={() => {
                    setRidingPosition(pos.key);
                    triggerHaptic('light');
                  }}
                  className={`py-1.5 px-1.5 rounded-lg font-bold text-[10px] transition-colors cursor-pointer text-center ${
                    ridingPosition === pos.key
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                  }`}
                  title={pos.title}
                >
                  {pos.label}
                </button>
              ))}
            </div>
          </div>

          {/* Wind Speed */}
          <div className="space-y-1.5">
            <div className="flex justify-between font-medium text-slate-600 dark:text-slate-300">
              <span className="flex items-center gap-1">
                <Wind className="w-3.5 h-3.5 text-sky-500" />
                Wind:
              </span>
              <span className="font-mono font-bold tabular-nums">
                {windSpeedKmh > 0 ? `+${windSpeedKmh} km/h` : windSpeedKmh < 0 ? `${windSpeedKmh} km/h` : '0 km/h'}
              </span>
            </div>
            <input
              type="range"
              min={-20}
              max={20}
              step={2}
              value={windSpeedKmh}
              onChange={(e) => setWindSpeedKmh(parseInt(e.target.value, 10))}
              className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>-20 (Rücken)</span>
              <span>0</span>
              <span>+20 (Gegen)</span>
            </div>
          </div>
        </div>
      </div>

      {physics && (
        <>
          {/* KPI Power Metrics Overview */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {capabilities.hasNativePower ? 'Ø Leistung (Sensor)' : 'Ø Leistung (Modell)'}
                </span>
                <Zap className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-2xl font-black text-slate-900 dark:text-white font-mono tabular-nums">
                {physics.avgPowerWatts} <span className="text-sm font-sans font-bold text-slate-500">Watt</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Spezifisch: <span className="font-bold text-slate-700 dark:text-slate-300 font-mono tabular-nums">{physics.wKgAvg} W/kg</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Normalized Power (NP)</span>
                <Activity className="w-4 h-4 text-indigo-500" />
              </div>
              <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400 font-mono tabular-nums">
                {physics.normalizedPowerWatts} <span className="text-sm font-sans font-bold text-slate-500">Watt</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                VI (Variability): <span className="font-bold text-slate-700 dark:text-slate-300 font-mono tabular-nums">{physics.variabilityIndex}</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Intensitätsfaktor (IF)</span>
                <ArrowUpRight className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                {physics.intensityFactor}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                FTP: <span className="font-bold text-slate-700 dark:text-slate-300 font-mono tabular-nums">{ftpValue}W ({physics.wKgFtp} W/kg)</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Training Stress Score</span>
                <Flame className="w-4 h-4 text-rose-500" />
              </div>
              <div className="text-2xl font-black text-rose-600 dark:text-rose-400 font-mono tabular-nums">
                {physics.tss} <span className="text-sm font-sans font-bold text-slate-500">TSS</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {physics.tss > 250 ? 'Sehr hohe Ermüdung' : physics.tss > 150 ? 'Mittlere bis hohe Belastung' : 'Gute Regeneration'}
              </div>
            </div>
          </div>

          {/* W'bal & Anaerobic Match-Burner */}
          {wbalAnalysis && (
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
                    <BatteryCharging className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                        W&apos;bal &amp; Anaerober Match-Burner (Skiba-Modell)
                      </h4>
                      <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                        · {wbalAnalysis.hasNativePower ? 'Echte Wattdaten' : 'Physik-Power'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Modelliert Entleerung (&gt; CP) und exponentielle Erholung (&lt; CP &amp; in Pausen) deiner anaeroben Batterie
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
                  <span className="text-slate-500">
                    CP: <strong className="text-slate-900 dark:text-white">{wbalAnalysis.cpWatts} W</strong> ({(wbalAnalysis.cpWatts / riderWeight).toFixed(2)} W/kg)
                  </span>
                  <span className="text-slate-300 dark:text-slate-700">|</span>
                  <span className="text-slate-500">
                    W&apos;: <strong className="text-violet-600 dark:text-violet-400">{wbalAnalysis.wPrimeKj.toFixed(1)} kJ</strong>
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Min. W&apos;bal Reserve</span>
                  <div className={`text-lg font-black font-mono tabular-nums mt-0.5 ${
                    wbalAnalysis.minWbalPct < 25 ? 'text-rose-600 dark:text-rose-400' : wbalAnalysis.minWbalPct < 50 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {wbalAnalysis.minWbalPct.toFixed(1)}% <span className="text-xs font-normal text-slate-500">({wbalAnalysis.minWbalKj.toFixed(1)} kJ)</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono tabular-nums">Tiefpunkt bei km {wbalAnalysis.minWbalDistKm}</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Gebrannte Matches</span>
                  <div className="text-lg font-black text-violet-600 dark:text-violet-400 font-mono tabular-nums mt-0.5">
                    {wbalAnalysis.matches.length} <span className="text-xs font-sans font-semibold text-slate-500">Attacken / Anstiege</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Ab &ge;16% W&apos;-Entleerung über CP</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Zeit über CP ({wbalAnalysis.cpWatts}W)</span>
                  <div className="text-lg font-black text-slate-900 dark:text-white font-mono tabular-nums mt-0.5">
                    {formatShortDur(wbalAnalysis.timeAboveCpSec)}
                  </div>
                  <span className="text-[10px] text-slate-400">Anaerobe Belastungsdauer</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Arbeit über CP</span>
                  <div className="text-lg font-black text-amber-600 dark:text-amber-400 font-mono tabular-nums mt-0.5">
                    {wbalAnalysis.workAboveCpKj.toFixed(1)} kJ
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                    {(wbalAnalysis.workAboveCpKj / Math.max(1, wbalAnalysis.wPrimeKj)).toFixed(1)}× W&apos;-Kapazität umgesetzt
                  </span>
                </div>
              </div>

              {wbalAnalysis.series.length > 2 && (() => {
                const series = wbalAnalysis.series;
                const maxDist = Math.max(0.1, series[series.length - 1].distanceKm);
                const minEle = Math.min(...series.map(p => p.ele));
                const maxEle = Math.max(minEle + 20, ...series.map(p => p.ele));
                const maxPower = Math.max(wbalAnalysis.cpWatts * 1.5, ...series.map(p => p.powerW));

                const width = 760;
                const height = 175;
                const padL = 36;
                const padR = 36;
                const padT = 14;
                const padB = 24;
                const plotW = width - padL - padR;
                const plotH = height - padT - padB;

                const xForDist = (d: number) => padL + (d / maxDist) * plotW;
                const yForPct = (pct: number) => padT + ((100 - Math.max(0, Math.min(100, pct))) / 100) * plotH;
                const yForEle = (e: number) => padT + plotH - ((e - minEle) / (maxEle - minEle)) * (plotH * 0.65);
                const yForPower = (w: number) => padT + plotH - (Math.min(maxPower, w) / maxPower) * plotH;

                const elePolygon = capabilities.hasRealElevation
                  ? [
                      `${padL},${padT + plotH}`,
                      ...series.map(p => `${xForDist(p.distanceKm).toFixed(1)},${yForEle(p.ele).toFixed(1)}`),
                      `${padL + plotW},${padT + plotH}`
                    ].join(' ')
                  : '';

                const powerPolyline = series
                  .map(p => `${xForDist(p.distanceKm).toFixed(1)},${yForPower(p.powerW).toFixed(1)}`)
                  .join(' ');

                const wbalPolyline = series
                  .map(p => `${xForDist(p.distanceKm).toFixed(1)},${yForPct(p.wbalPct).toFixed(1)}`)
                  .join(' ');

                const hoveredPt = hoverWbalIdx !== null && series[hoverWbalIdx] ? series[hoverWbalIdx] : null;

                return (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1.5 font-bold text-violet-600 dark:text-violet-400">
                          <span className="w-3 h-0.5 bg-violet-500 inline-block" /> W&apos;bal Reserve (%)
                        </span>
                        <span className="inline-flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400">
                          <span className="w-3 h-0.5 bg-amber-500/80 inline-block" /> Leistung (W)
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-rose-500">
                          <span className="w-3 h-0.5 border-t border-dashed border-rose-500 inline-block" /> Kritische Reserve (25%)
                        </span>
                      </div>
                      {hoveredPt && (
                        <div className="font-mono text-[11px] tabular-nums bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-lg text-slate-700 dark:text-slate-200">
                          km {hoveredPt.distanceKm.toFixed(1)} · <strong className="text-violet-600 dark:text-violet-400">W&apos;bal {hoveredPt.wbalPct.toFixed(0)}% ({hoveredPt.wbalKj.toFixed(1)} kJ)</strong> · {hoveredPt.powerW} W{capabilities.hasRealElevation ? ` · ${hoveredPt.ele} m` : ''}
                        </div>
                      )}
                    </div>

                    <div className="relative rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
                      <svg
                        viewBox={`0 0 ${width} ${height}`}
                        className="w-full h-44 block select-none cursor-crosshair"
                        onMouseMove={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const relX = ((e.clientX - rect.left) / rect.width) * width;
                          const ratio = Math.max(0, Math.min(1, (relX - padL) / plotW));
                          const targetDist = ratio * maxDist;
                          let bestIdx = 0;
                          let bestDiff = Infinity;
                          for (let i = 0; i < series.length; i++) {
                            const d = Math.abs(series[i].distanceKm - targetDist);
                            if (d < bestDiff) {
                              bestDiff = d;
                              bestIdx = i;
                            }
                          }
                          setHoverWbalIdx(bestIdx);
                        }}
                        onMouseLeave={() => setHoverWbalIdx(null)}
                        onClick={() => {
                          if (hoveredPt && onSelectTrackPoint) {
                            triggerHaptic('light');
                            onSelectTrackPoint(hoveredPt.lat, hoveredPt.lng);
                          }
                        }}
                      >
                        {[100, 75, 50, 25, 0].map(pct => {
                          const y = yForPct(pct);
                          const isCrit = pct === 25;
                          return (
                            <g key={pct}>
                              <line
                                x1={padL}
                                y1={y}
                                x2={width - padR}
                                y2={y}
                                stroke={isCrit ? '#f43f5e' : '#1e293b'}
                                strokeWidth={isCrit ? 1 : 0.75}
                                strokeDasharray={isCrit ? '4 3' : undefined}
                              />
                              <text
                                x={padL - 5}
                                y={y + 3}
                                textAnchor="end"
                                className={`text-[9px] font-mono ${isCrit ? 'fill-rose-400 font-bold' : 'fill-slate-500'}`}
                              >
                                {pct}%
                              </text>
                            </g>
                          );
                        })}

                        {elePolygon && <polygon points={elePolygon} fill="rgba(148, 163, 184, 0.14)" />}

                        <polyline
                          fill="none"
                          stroke="rgba(245, 158, 11, 0.55)"
                          strokeWidth="1.25"
                          points={powerPolyline}
                        />

                        <polyline
                          fill="none"
                          stroke="#a855f7"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={wbalPolyline}
                        />

                        {wbalAnalysis.matches.map((m) => (
                          <circle
                            key={m.id}
                            cx={xForDist(m.endKm)}
                            cy={yForPct(m.minWbalPct)}
                            r={4}
                            fill="#f43f5e"
                            stroke="#0f172a"
                            strokeWidth={1.5}
                          />
                        ))}

                        {hoveredPt && (
                          <g>
                            <line
                              x1={xForDist(hoveredPt.distanceKm)}
                              y1={padT}
                              x2={xForDist(hoveredPt.distanceKm)}
                              y2={padT + plotH}
                              stroke="#e2e8f0"
                              strokeWidth={1}
                              strokeDasharray="2 2"
                            />
                            <circle
                              cx={xForDist(hoveredPt.distanceKm)}
                              cy={yForPct(hoveredPt.wbalPct)}
                              r={4.5}
                              fill="#a855f7"
                              stroke="#ffffff"
                              strokeWidth={1.5}
                            />
                          </g>
                        )}

                        {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
                          const d = r * maxDist;
                          return (
                            <text
                              key={i}
                              x={xForDist(d)}
                              y={height - 6}
                              textAnchor="middle"
                              className="fill-slate-400 text-[9px] font-mono"
                            >
                              {d.toFixed(1)} km
                            </text>
                          );
                        })}
                      </svg>
                    </div>
                  </div>
                );
              })()}

              {wbalAnalysis.matches.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <span>Erkannte Anaerobe Matches ({wbalAnalysis.matches.length})</span>
                    <span className="font-normal text-slate-500">Klick zentriert Match auf der Karte</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {wbalAnalysis.matches.slice(0, 9).map((m) => (
                      <div
                        key={m.id}
                        onClick={() => {
                          if (onSelectTrackPoint) {
                            triggerHaptic('light');
                            onSelectTrackPoint(m.lat, m.lng);
                          }
                        }}
                        className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-violet-50/60 dark:hover:bg-violet-950/30 border border-slate-200 dark:border-slate-800 transition-colors cursor-pointer flex items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-black text-[11px] text-rose-600 dark:text-rose-400">
                              Match #{m.matchNumber}
                            </span>
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                              · km {m.startKm}–{m.endKm}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                            {formatShortDur(m.durationSec)} · Ø {m.avgPowerW}W (Max {m.peakPowerW}W)
                          </div>
                        </div>

                        <div className="text-right font-mono tabular-nums shrink-0">
                          <div className="font-black text-rose-600 dark:text-rose-400">
                            -{m.kjBurned} kJ ({m.pctWPrimeBurned}%)
                          </div>
                          <div className="text-[10px] text-slate-500 flex items-center justify-end gap-1">
                            <span>Rest: {m.minWbalPct}%</span>
                            {onSelectTrackPoint && <Crosshair className="w-3 h-3 text-indigo-500" />}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Gleichmäßiges aerobes Pacing: Keine tiefen anaeroben Matches (&ge;16% W&apos;-Verbrauch) über Critical Power ({wbalAnalysis.cpWatts} W) erkannt.</span>
                </div>
              )}
            </div>
          )}

          {/* Resistance Force Decomposition Bar */}
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Aufteilung der Fahrwiderstände (Watt &amp; Prozent)
              </h4>
              <span className="text-xs text-slate-400">
                Gesamt-Arbeit: <strong className="text-slate-700 dark:text-slate-200 font-mono tabular-nums">{physics.workKj} kJ</strong>
              </span>
            </div>

            <div className="h-4 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
              <div style={{ width: `${physics.pClimbPct}%` }} className="bg-emerald-500" title={`Steigungsarbeit: ${physics.powerClimbWatts}W`} />
              <div style={{ width: `${physics.pAeroPct}%` }} className="bg-sky-500" title={`Luftwiderstand: ${physics.powerAeroWatts}W`} />
              <div style={{ width: `${physics.pRollPct}%` }} className="bg-amber-500" title={`Rollreibung: ${physics.powerRollWatts}W`} />
              <div style={{ width: `${physics.pLossPct}%` }} className="bg-slate-400" title={`Antriebsverlust: ${physics.powerLossWatts}W`} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                <div className="min-w-0">
                  <span className="font-semibold text-slate-700 dark:text-slate-200 block text-[11px]">Hub- / Höhenarbeit</span>
                  <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 text-[11px] tabular-nums">{physics.powerClimbWatts} W ({physics.pClimbPct}%)</span>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2 rounded-lg bg-sky-50/60 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shrink-0" />
                <div className="min-w-0">
                  <span className="font-semibold text-slate-700 dark:text-slate-200 block text-[11px]">Luftwiderstand</span>
                  <span className="font-mono font-bold text-sky-700 dark:text-sky-400 text-[11px] tabular-nums">{physics.powerAeroWatts} W ({physics.pAeroPct}%)</span>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                <div className="min-w-0">
                  <span className="font-semibold text-slate-700 dark:text-slate-200 block text-[11px]">Rollreibung</span>
                  <span className="font-mono font-bold text-amber-700 dark:text-amber-400 text-[11px] tabular-nums">{physics.powerRollWatts} W ({physics.pRollPct}%)</span>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-100/60 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />
                <div className="min-w-0">
                  <span className="font-semibold text-slate-700 dark:text-slate-200 block text-[11px]">Kettentrieb / Verluste</span>
                  <span className="font-mono font-bold text-slate-600 dark:text-slate-400 text-[11px] tabular-nums">{physics.powerLossWatts} W ({physics.pLossPct}%)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Energy & Substrate Oxidation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-orange-500" />
                  Biologischer Kalorienumsatz
                </h4>
                <span className="text-[11px] font-semibold text-slate-500">Wirkungsgrad: ~23%</span>
              </div>

              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-black text-slate-900 dark:text-white font-mono tabular-nums">
                  {physics.caloriesKcal.toLocaleString('de-DE')}
                </span>
                <span className="text-sm font-bold text-slate-500">kcal metabolisch verbrannt</span>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between text-xs font-medium">
                <span className="text-slate-500">Mechanische Arbeit am Pedal:</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200 tabular-nums">{physics.workKj} kJ</span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Substrat-Verstoffwechselung (FatOx vs. Glykogen)
                </h4>
                <span className="text-[11px] text-slate-500">Intensitätsgesteuert</span>
              </div>

              <div className="h-3.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
                <div style={{ width: `${physics.fatPct}%` }} className="bg-amber-400" />
                <div style={{ width: `${physics.carbPct}%` }} className="bg-rose-500" />
              </div>

              <div className="flex justify-between text-xs font-mono font-bold tabular-nums">
                <span className="text-amber-600 dark:text-amber-400 inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                  {physics.fatPct}% Fett ({physics.fatGrams}g)
                </span>
                <span className="text-rose-600 dark:text-rose-400 inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                  {physics.carbPct}% Carbs ({physics.carbGrams}g)
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-100 block">Energie-Gels Empfehlung</span>
                    <span className="text-[10px] text-slate-500">Basis: 25g Kohlenhydrate pro Gel</span>
                  </div>
                </div>
                <div className="text-right font-mono tabular-nums">
                  <span className="text-sm font-black text-rose-600 dark:text-rose-400">{physics.gelsCount} Gels</span>
                  <span className="block text-[10px] text-slate-400">~{physics.gelsPerHour} Gels / Std.</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
