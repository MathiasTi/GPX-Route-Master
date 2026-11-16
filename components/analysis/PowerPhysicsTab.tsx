import React, { useState, useMemo } from 'react';
import { Zap, Wind, Flame, Scale, Activity, ArrowUpRight, BatteryCharging, Crosshair, AlertTriangle } from 'lucide-react';
import { GPXTrack } from '../../types';
import { calculateDistance } from '../../utils/gpxUtils';
import { computeTrackWbal } from '../../utils/wbalEngine';
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
  onSelectTrackPoint
}) => {
  // Configurable physics simulation parameters
  const [riderWeight, setRiderWeight] = useState<number>(initialWeight);
  const [bikeType, setBikeType] = useState<'road' | 'gravel' | 'mtb'>('road');
  const [ridingPosition, setRidingPosition] = useState<'drops' | 'hoods' | 'tops'>('hoods');
  const [windSpeedKmh, setWindSpeedKmh] = useState<number>(0); // -25 (tailwind) to +25 (headwind)
  const [ftpValue, setFtpValue] = useState<number>(initialFtp);
  const [wPrimeKj, setWPrimeKj] = useState<number>(20); // 8 to 40 kJ anaerobic work capacity
  const [bikeWeight, setBikeWeight] = useState<number>(bikeType === 'road' ? 8.5 : bikeType === 'gravel' ? 10.5 : 12.5);
  const [hoverWbalIdx, setHoverWbalIdx] = useState<number | null>(null);

  // Update bike weight when bike type changes
  const handleBikeTypeChange = (type: 'road' | 'gravel' | 'mtb') => {
    setBikeType(type);
    setBikeWeight(type === 'road' ? 8.5 : type === 'gravel' ? 10.5 : 12.5);
    triggerHaptic('light');
  };

  // Perform W'bal & Match Burner differential analysis (Skiba model)
  const wbalAnalysis = useMemo(() => {
    const cpWatts = Math.max(80, Math.round(ftpValue * 0.96));
    return computeTrackWbal(track, {
      cpWatts,
      wPrimeKj,
      riderWeightKg: riderWeight,
      bikeWeightKg: activityType === 'cycling' ? bikeWeight : 0.8
    });
  }, [track, ftpValue, wPrimeKj, riderWeight, bikeWeight, activityType]);

  // Perform physical drag & resistance modeling
  const physics = useMemo(() => {
    const points = track.points || [];
    if (points.length < 2) {
      return {
        avgPowerWatts: 180,
        normalizedPowerWatts: 195,
        intensityFactor: 0.88,
        tss: 120,
        variabilityIndex: 1.08,
        workKj: 1500,
        caloriesKcal: 1550,
        powerClimbWatts: 100,
        powerAeroWatts: 50,
        powerRollWatts: 25,
        powerLossWatts: 5,
        pClimbPct: 55,
        pAeroPct: 28,
        pRollPct: 14,
        pLossPct: 3,
        fatGrams: 45,
        carbGrams: 280,
        fatPct: 35,
        carbPct: 65,
        gelsCount: 11,
        gelsPerHour: '2.2',
        wKgAvg: (180 / riderWeight).toFixed(2),
        wKgFtp: (ftpValue / riderWeight).toFixed(2)
      };
    }

    // Physical constants
    const g = 9.81;
    const airDensity = 1.225; // kg/m^3 at sea level & 15°C
    const totalMassKg = riderWeight + (activityType === 'cycling' ? bikeWeight : 0.8);

    // Rolling resistance coefficient
    let crr = 0.004; // High-end road tire
    if (bikeType === 'gravel') crr = 0.0065;
    if (bikeType === 'mtb') crr = 0.009;

    // Aerodynamic drag area (CdA in m^2)
    let cda = 0.32; // hoods
    if (ridingPosition === 'drops') cda = 0.27; // drops / aero
    if (ridingPosition === 'tops') cda = 0.38; // upright / tops
    if (activityType === 'running') cda = 0.45;

    const windSpeedMs = (windSpeedKmh * 1000) / 3600;

    let totalDurationSec = 0;
    let sumWorkClimbJ = 0;
    let sumWorkAeroJ = 0;
    let sumWorkRollJ = 0;
    const weightedPowerArray: number[] = [];

    let hasActualTimestamps = false;
    for (let i = 0; i < Math.min(20, points.length); i++) {
      if (points[i].time) {
        hasActualTimestamps = true;
        break;
      }
    }

    // Estimate speed if durations not recorded
    const defaultSpeedKmh = activityType === 'running' ? 10.5 : 24.0;
    const defaultSpeedMs = (defaultSpeedKmh * 1000) / 3600;

    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];
      const distM = calculateDistance(p1, p2) * 1000;
      if (distM <= 0.5) continue;

      let dtSec = 0;
      if (hasActualTimestamps && p1.time && p2.time) {
        dtSec = (new Date(p2.time).getTime() - new Date(p1.time).getTime()) / 1000;
      }
      if (dtSec <= 0 || dtSec > 600) {
        dtSec = distM / defaultSpeedMs;
      }
      totalDurationSec += dtSec;

      const v = Math.max(0.5, distM / dtSec); // velocity in m/s
      const dEle = (p2.ele || 0) - (p1.ele || 0);
      const grade = dEle / distM; // sin(alpha) approximation for small angles

      // Gravity force / power
      const fClimb = totalMassKg * g * grade;
      const pClimb = Math.max(0, fClimb * v); // only positive climbing work counted for propulsion

      // Rolling friction
      const fRoll = crr * totalMassKg * g;
      const pRoll = fRoll * v;

      // Aero resistance
      const vAir = Math.max(0, v + windSpeedMs);
      const fAero = 0.5 * airDensity * cda * Math.pow(vAir, 2);
      const pAero = fAero * v;

      // Mechanical propulsion power at wheel / legs
      const pTotalWheel = pClimb + pRoll + pAero;
      // Drivetrain efficiency: 97.5% mechanical transfer
      const pMech = activityType === 'cycling' ? pTotalWheel / 0.975 : pTotalWheel * 1.05;

      sumWorkClimbJ += pClimb * dtSec;
      sumWorkAeroJ += pAero * dtSec;
      sumWorkRollJ += pRoll * dtSec;

      weightedPowerArray.push(pMech);
    }

    const durationHrs = Math.max(0.1, totalDurationSec / 3600);
    const totalMechanicalJoules = sumWorkClimbJ + sumWorkAeroJ + sumWorkRollJ;
    const workKj = Math.round(totalMechanicalJoules / 1000);

    // Biological efficiency: cycling ~23%, running ~21%
    const efficiency = activityType === 'running' ? 0.21 : 0.23;
    const caloriesKcal = Math.round((totalMechanicalJoules / 4184) / efficiency);

    const avgPowerWatts = Math.round(totalMechanicalJoules / Math.max(1, totalDurationSec));

    // Normalized Power (NP) via fourth-power average algorithm
    let npWatts = avgPowerWatts;
    if (weightedPowerArray.length > 30) {
      let sumFourthPower = 0;
      for (let i = 0; i < weightedPowerArray.length; i++) {
        sumFourthPower += Math.pow(weightedPowerArray[i], 4);
      }
      const meanFourth = sumFourthPower / weightedPowerArray.length;
      npWatts = Math.round(Math.pow(meanFourth, 0.25));
    }
    npWatts = Math.max(avgPowerWatts, Math.min(Math.round(avgPowerWatts * 1.35), npWatts));

    const intensityFactor = Number((npWatts / Math.max(100, ftpValue)).toFixed(2));
    const tss = Math.round((totalDurationSec * npWatts * intensityFactor) / (ftpValue * 3600) * 100);
    const variabilityIndex = Number((npWatts / Math.max(1, avgPowerWatts)).toFixed(2));

    const pClimbAvg = Math.round(sumWorkClimbJ / Math.max(1, totalDurationSec));
    const pAeroAvg = Math.round(sumWorkAeroJ / Math.max(1, totalDurationSec));
    const pRollAvg = Math.round(sumWorkRollJ / Math.max(1, totalDurationSec));
    const pLossAvg = Math.round(avgPowerWatts - (pClimbAvg + pAeroAvg + pRollAvg));

    const sumP = Math.max(1, pClimbAvg + pAeroAvg + pRollAvg + Math.max(0, pLossAvg));
    const pClimbPct = Math.round((pClimbAvg / sumP) * 100);
    const pAeroPct = Math.round((pAeroAvg / sumP) * 100);
    const pRollPct = Math.round((pRollAvg / sumP) * 100);
    const pLossPct = Math.max(0, 100 - (pClimbPct + pAeroPct + pRollPct));

    // Substrate Oxidation (Fat vs Carb) based on Intensity Factor
    const fatFraction = Math.max(0.1, Math.min(0.7, 0.95 - intensityFactor * 0.8));
    const carbFraction = 1.0 - fatFraction;

    const fatKcal = caloriesKcal * fatFraction;
    const carbKcal = caloriesKcal * carbFraction;

    const fatGrams = Math.round(fatKcal / 9.3);
    const carbGrams = Math.round(carbKcal / 4.1);
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
      powerLossWatts: Math.max(0, pLossAvg),
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
  }, [track, activityType, riderWeight, bikeType, ridingPosition, windSpeedKmh, ftpValue, bikeWeight]);

  // Format duration helper
  const formatShortDur = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="space-y-6">
      {/* Simulation Controls Card */}
      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700/80 pb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Physikalisches Leistungs- & Widerstandsmodell
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Präzise Berechnung nach Newtonschen Gesetzen: Steigungskraft, Luftwiderstand, Rollreibung & W&apos;bal
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
                {activityType === 'running' ? 'Läufergewicht:' : 'Fahrergewicht:'}
              </span>
              <span className="font-mono font-bold tabular-nums">{riderWeight} kg</span>
            </div>
            <input
              type="range"
              min={50}
              max={120}
              step={1}
              value={riderWeight}
              onChange={(e) => setRiderWeight(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400 tabular-nums">
              <span>50 kg</span>
              <span>{activityType === 'running' ? `Körper: ${riderWeight} kg` : `System: ${riderWeight + bikeWeight} kg`}</span>
              <span>120 kg</span>
            </div>
          </div>

          {/* Bike & Tire Type */}
          <div className="space-y-1.5">
            <label className="block font-medium text-slate-600 dark:text-slate-300">
              {activityType === 'running' ? 'Schuh- & Untergrundtyp:' : 'Rad- & Reifentyp (Crr):'}
            </label>
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => handleBikeTypeChange('road')}
                className={`py-1.5 px-2 rounded-lg font-bold text-[11px] transition-colors cursor-pointer text-center ${
                  bikeType === 'road'
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {activityType === 'running' ? 'Asphalt' : 'Rennrad'}
              </button>
              <button
                type="button"
                onClick={() => handleBikeTypeChange('gravel')}
                className={`py-1.5 px-2 rounded-lg font-bold text-[11px] transition-colors cursor-pointer text-center ${
                  bikeType === 'gravel'
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {activityType === 'running' ? 'Trail/Kies' : 'Gravel'}
              </button>
              <button
                type="button"
                onClick={() => handleBikeTypeChange('mtb')}
                className={`py-1.5 px-2 rounded-lg font-bold text-[11px] transition-colors cursor-pointer text-center ${
                  bikeType === 'mtb'
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {activityType === 'running' ? 'Wald/Gras' : 'MTB'}
              </button>
            </div>
          </div>

          {/* Riding Position */}
          <div className="space-y-1.5">
            <label className="block font-medium text-slate-600 dark:text-slate-300">
              {activityType === 'running' ? 'Laufhaltung (CdA):' : 'Sitzhaltung (CdA):'}
            </label>
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => { setRidingPosition('drops'); triggerHaptic('light'); }}
                className={`py-1.5 px-1.5 rounded-lg font-bold text-[10px] transition-colors cursor-pointer text-center ${
                  ridingPosition === 'drops'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
                title={activityType === 'running' ? "Geduckt / Sprint (CdA 0.38)" : "Unterlenker / Aero (CdA 0.27)"}
              >
                {activityType === 'running' ? 'Aero/Sprint' : 'Unterlenker'}
              </button>
              <button
                type="button"
                onClick={() => { setRidingPosition('hoods'); triggerHaptic('light'); }}
                className={`py-1.5 px-1.5 rounded-lg font-bold text-[10px] transition-colors cursor-pointer text-center ${
                  ridingPosition === 'hoods'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
                title={activityType === 'running' ? "Kompakte Laufhaltung (CdA 0.45)" : "Bremsgriffe (CdA 0.32)"}
              >
                {activityType === 'running' ? 'Kompakt' : 'Bremsgriffe'}
              </button>
              <button
                type="button"
                onClick={() => { setRidingPosition('tops'); triggerHaptic('light'); }}
                className={`py-1.5 px-1.5 rounded-lg font-bold text-[10px] transition-colors cursor-pointer text-center ${
                  ridingPosition === 'tops'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
                title={activityType === 'running' ? "Aufrecht / Berglauf (CdA 0.52)" : "Oberlenker / Aufrecht (CdA 0.38)"}
              >
                Aufrecht
              </button>
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
                {windSpeedKmh > 0 ? `+${windSpeedKmh} km/h (Gegenwind)` : windSpeedKmh < 0 ? `${windSpeedKmh} km/h (Rückenwind)` : 'Windstill (0)'}
              </span>
            </div>
            <input
              type="range"
              min={-20}
              max={20}
              step={2}
              value={windSpeedKmh}
              onChange={(e) => setWindSpeedKmh(parseInt(e.target.value))}
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

      {/* KPI Power Metrics Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Ø Leistung (Simuliert)</span>
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

      {/* W'bal & Anaerobic Match-Burner (GoldenCheetah / Skiba Differential Model) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
              <BatteryCharging className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                  W&apos;bal & Anaerober Match-Burner (Skiba-Modell)
                </h4>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                  {wbalAnalysis.hasNativePower ? 'Echte Wattdaten' : 'Physik-Power'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Modelliert Entleerung (&gt; CP) und exponentielle Erholung (&lt; CP) deiner anaeroben Batterie entlang der Route
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

        {/* W'bal KPI Row */}
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
            <span className="text-[10px] text-slate-400">Ab &ge;15% W&apos;-Entleerung über CP</span>
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

        {/* Interactive W'bal & Power SVG Chart */}
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

          const elePolygon = [
            `${padL},${padT + plotH}`,
            ...series.map(p => `${xForDist(p.distanceKm).toFixed(1)},${yForEle(p.ele).toFixed(1)}`),
            `${padL + plotW},${padT + plotH}`
          ].join(' ');

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
                    km {hoveredPt.distanceKm.toFixed(1)} · <strong className="text-violet-600 dark:text-violet-400">W&apos;bal {hoveredPt.wbalPct.toFixed(0)}% ({hoveredPt.wbalKj.toFixed(1)} kJ)</strong> · {hoveredPt.powerW} W · {hoveredPt.ele} m
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
                  {/* Horizontal Grid Lines (100%, 50%, 25% Critical) */}
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

                  {/* Elevation Backdrop */}
                  <polygon points={elePolygon} fill="rgba(148, 163, 184, 0.14)" />

                  {/* Power Trace */}
                  <polyline
                    fill="none"
                    stroke="rgba(245, 158, 11, 0.55)"
                    strokeWidth="1.25"
                    points={powerPolyline}
                  />

                  {/* W'bal Differential Curve */}
                  <polyline
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={wbalPolyline}
                  />

                  {/* Match Burner Peak Depletion Dots */}
                  {wbalAnalysis.matches.map((m) => {
                    const cx = xForDist(m.endKm);
                    const cy = yForPct(m.minWbalPct);
                    return (
                      <g key={m.id}>
                        <circle
                          cx={cx}
                          cy={cy}
                          r={4}
                          fill="#f43f5e"
                          stroke="#0f172a"
                          strokeWidth={1.5}
                        />
                      </g>
                    );
                  })}

                  {/* Hover Hairline */}
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

                  {/* X-Axis Distance Labels */}
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

        {/* Match Burner List */}
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
                      <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400 font-mono font-black text-[10px]">
                        Match #{m.matchNumber}
                      </span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                        km {m.startKm}–{m.endKm}
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
            <span>Gleichmäßiges aerobes Pacing: Keine tiefen anaeroben Matches (&ge;15% W&apos;-Verbrauch) über Critical Power ({wbalAnalysis.cpWatts} W) erkannt.</span>
          </div>
        )}
      </div>

      {/* Resistance Force Decomposition Bar */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {activityType === 'running' ? 'Aufteilung der Laufwiderstände (Watt & Prozent)' : 'Aufteilung der Fahrwiderstände (Watt & Prozent)'}
          </h4>
          <span className="text-xs text-slate-400">Gesamt-Arbeit: <strong className="text-slate-700 dark:text-slate-200 font-mono tabular-nums">{physics.workKj} kJ</strong></span>
        </div>

        <div className="h-4 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
          <div 
            style={{ width: `${physics.pClimbPct}%` }}
            className="bg-emerald-500 hover:opacity-90 transition-all cursor-pointer"
            title={`Steigungsarbeit: ${physics.powerClimbWatts}W (${physics.pClimbPct}%)`}
          />
          <div 
            style={{ width: `${physics.pAeroPct}%` }}
            className="bg-sky-500 hover:opacity-90 transition-all cursor-pointer"
            title={`Luftwiderstand: ${physics.powerAeroWatts}W (${physics.pAeroPct}%)`}
          />
          <div 
            style={{ width: `${physics.pRollPct}%` }}
            className="bg-amber-500 hover:opacity-90 transition-all cursor-pointer"
            title={`${activityType === 'running' ? 'Bodenreibung' : 'Rollreibung'}: ${physics.powerRollWatts}W (${physics.pRollPct}%)`}
          />
          <div 
            style={{ width: `${physics.pLossPct}%` }}
            className="bg-slate-400 hover:opacity-90 transition-all cursor-pointer"
            title={`${activityType === 'running' ? 'Biomechanikverlust' : 'Antriebsverlust'}: ${physics.powerLossWatts}W (${physics.pLossPct}%)`}
          />
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
              <span className="font-semibold text-slate-700 dark:text-slate-200 block text-[11px]">{activityType === 'running' ? 'Bodenreibung' : 'Rollreibung'}</span>
              <span className="font-mono font-bold text-amber-700 dark:text-amber-400 text-[11px] tabular-nums">{physics.powerRollWatts} W ({physics.pRollPct}%)</span>
            </div>
          </div>

          <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-100/60 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />
            <div className="min-w-0">
              <span className="font-semibold text-slate-700 dark:text-slate-200 block text-[11px]">{activityType === 'running' ? 'Biomechanik / Dämpfung' : 'Kettentrieb / Verluste'}</span>
              <span className="font-mono font-bold text-slate-600 dark:text-slate-400 text-[11px] tabular-nums">{physics.powerLossWatts} W ({physics.pLossPct}%)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Energy & Substrate Oxidation (FatOx vs CarbOx) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Metabolic Energy Card */}
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

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Der menschliche Muskel wandelt ca. 23% der aufgenommenen Nahrungsenergie in mechanischen Vortrieb um. Die übrigen 77% werden als Körperwärme über Schweiß und Atmung abgegeben.
          </p>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between text-xs font-medium">
            <span className="text-slate-500">Mechanische Arbeit am Pedal:</span>
            <span className="font-mono font-bold text-slate-800 dark:text-slate-200 tabular-nums">{physics.workKj} kJ</span>
          </div>
        </div>

        {/* Substrate Oxidation (Fat vs Glycogen) */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Substrat-Verstoffwechselung (FatOx vs. Glykogen)
            </h4>
            <span className="text-[11px] text-slate-500">Intensitätsgesteuert</span>
          </div>

          <div className="h-3.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
            <div 
              style={{ width: `${physics.fatPct}%` }}
              className="bg-amber-400 transition-all"
              title={`Fettverbrennung: ${physics.fatPct}% (${physics.fatGrams}g)`}
            />
            <div 
              style={{ width: `${physics.carbPct}%` }}
              className="bg-rose-500 transition-all"
              title={`Kohlenhydratverbrennung: ${physics.carbPct}% (${physics.carbGrams}g)`}
            />
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
              <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4" />
              </div>
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
    </div>
  );
};

