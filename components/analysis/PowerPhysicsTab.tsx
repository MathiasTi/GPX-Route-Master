import React, { useState, useMemo } from 'react';
import { Zap, Wind, Bike, Flame, Scale, HelpCircle, Activity, ArrowUpRight, Check, Droplets, Info } from 'lucide-react';
import { GPXTrack } from '../../types';
import { calculateDistance } from '../../utils/gpxUtils';
import { triggerHaptic } from '../../utils/haptics';

interface PowerPhysicsTabProps {
  track: GPXTrack;
  activityType: 'cycling' | 'running';
  initialWeight?: number;
  initialFtp?: number;
  onOpenGlossary?: (metricId?: string) => void;
}

export const PowerPhysicsTab: React.FC<PowerPhysicsTabProps> = ({
  track,
  activityType,
  initialWeight = 75,
  initialFtp = 220,
  onOpenGlossary
}) => {
  // Configurable physics simulation parameters
  const [riderWeight, setRiderWeight] = useState<number>(initialWeight);
  const [bikeType, setBikeType] = useState<'road' | 'gravel' | 'mtb'>('road');
  const [ridingPosition, setRidingPosition] = useState<'drops' | 'hoods' | 'tops'>('hoods');
  const [windSpeedKmh, setWindSpeedKmh] = useState<number>(0); // -25 (tailwind) to +25 (headwind)
  const [ftpValue, setFtpValue] = useState<number>(initialFtp);
  const [bikeWeight, setBikeWeight] = useState<number>(bikeType === 'road' ? 8.5 : bikeType === 'gravel' ? 10.5 : 12.5);

  // Update bike weight when bike type changes
  const handleBikeTypeChange = (type: 'road' | 'gravel' | 'mtb') => {
    setBikeType(type);
    setBikeWeight(type === 'road' ? 8.5 : type === 'gravel' ? 10.5 : 12.5);
    triggerHaptic('light');
  };

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
    let weightedPowerArray: number[] = [];

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
    // 1 kcal = 4184 Joules. Efficiency = E_mech / E_metab
    // E_metab (kcal) = (E_mech_J / 4184) / efficiency
    const efficiency = activityType === 'running' ? 0.21 : 0.23;
    const caloriesKcal = Math.round((totalMechanicalJoules / 4184) / efficiency);

    const avgPowerWatts = Math.round(totalMechanicalJoules / Math.max(1, totalDurationSec));

    // Normalized Power (NP) via 30s rolling fourth-power average algorithm
    let npWatts = avgPowerWatts;
    if (weightedPowerArray.length > 30) {
      let sumFourthPower = 0;
      for (let i = 0; i < weightedPowerArray.length; i++) {
        sumFourthPower += Math.pow(weightedPowerArray[i], 4);
      }
      const meanFourth = sumFourthPower / weightedPowerArray.length;
      npWatts = Math.round(Math.pow(meanFourth, 0.25));
    }
    // Safeguard NP reasonable bounds
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
    // At IF <= 0.6: 60% fat, 40% carbs. At IF >= 1.0: 10% fat, 90% carbs
    let fatFraction = Math.max(0.1, Math.min(0.7, 0.95 - intensityFactor * 0.8));
    let carbFraction = 1.0 - fatFraction;

    const fatKcal = caloriesKcal * fatFraction;
    const carbKcal = caloriesKcal * carbFraction;

    // 1g fat = 9.3 kcal, 1g carb = 4.1 kcal
    const fatGrams = Math.round(fatKcal / 9.3);
    const carbGrams = Math.round(carbKcal / 4.1);
    const fatPct = Math.round(fatFraction * 100);
    const carbPct = Math.round(carbFraction * 100);

    // Gels required (25g carbs each)
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
                Präzise Berechnung nach Newtonschen Gesetzen: Steigungskraft, Luftwiderstand & Rollreibung
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">FTP:</span>
            <input
              type="number"
              value={ftpValue}
              min={100}
              max={550}
              step={5}
              onChange={(e) => setFtpValue(Math.max(100, Math.min(550, parseInt(e.target.value) || 220)))}
              className="w-20 px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono font-bold text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-amber-500 focus:outline-none"
            />
            <span className="text-xs text-slate-400">Watt</span>
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
              <span className="font-mono font-bold">{riderWeight} kg</span>
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
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>50 kg</span>
              <span>System: {riderWeight + bikeWeight} kg</span>
              <span>120 kg</span>
            </div>
          </div>

          {/* Bike & Tire Type */}
          <div className="space-y-1.5">
            <label className="block font-medium text-slate-600 dark:text-slate-300">
              Rad- & Reifentyp (Crr):
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
                Rennrad
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
                Gravel
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
                MTB
              </button>
            </div>
          </div>

          {/* Riding Position */}
          <div className="space-y-1.5">
            <label className="block font-medium text-slate-600 dark:text-slate-300">
              Sitzhaltung (CdA):
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
                title="Unterlenker / Aero (CdA 0.27)"
              >
                Unterlenker
              </button>
              <button
                type="button"
                onClick={() => { setRidingPosition('hoods'); triggerHaptic('light'); }}
                className={`py-1.5 px-1.5 rounded-lg font-bold text-[10px] transition-colors cursor-pointer text-center ${
                  ridingPosition === 'hoods'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
                title="Bremsgriffe (CdA 0.32)"
              >
                Bremsgriffe
              </button>
              <button
                type="button"
                onClick={() => { setRidingPosition('tops'); triggerHaptic('light'); }}
                className={`py-1.5 px-1.5 rounded-lg font-bold text-[10px] transition-colors cursor-pointer text-center ${
                  ridingPosition === 'tops'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
                title="Oberlenker / Aufrecht (CdA 0.38)"
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
              <span className="font-mono font-bold">
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
          <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
            {physics.avgPowerWatts} <span className="text-sm font-sans font-bold text-slate-500">Watt</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Spezifisch: <span className="font-bold text-slate-700 dark:text-slate-300 font-mono">{physics.wKgAvg} W/kg</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Normalized Power (NP)</span>
            <Activity className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400 font-mono">
            {physics.normalizedPowerWatts} <span className="text-sm font-sans font-bold text-slate-500">Watt</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            VI (Variability): <span className="font-bold text-slate-700 dark:text-slate-300 font-mono">{physics.variabilityIndex}</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Intensitätsfaktor (IF)</span>
            <ArrowUpRight className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
            {physics.intensityFactor}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            FTP: <span className="font-bold text-slate-700 dark:text-slate-300 font-mono">{ftpValue}W ({physics.wKgFtp} W/kg)</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Training Stress Score</span>
            <Flame className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-black text-rose-600 dark:text-rose-400 font-mono">
            {physics.tss} <span className="text-sm font-sans font-bold text-slate-500">TSS</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            {physics.tss > 250 ? 'Sehr hohe Ermüdung' : physics.tss > 150 ? 'Mittlere bis hohe Belastung' : 'Gute Regeneration'}
          </div>
        </div>
      </div>

      {/* Resistance Force Decomposition Bar */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Aufteilung der Fahrwiderstände (Watt & Prozent)
          </h4>
          <span className="text-xs text-slate-400">Gesamt-Arbeit: <strong className="text-slate-700 dark:text-slate-200 font-mono">{physics.workKj} kJ</strong></span>
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
            title={`Rollreibung: ${physics.powerRollWatts}W (${physics.pRollPct}%)`}
          />
          <div 
            style={{ width: `${physics.pLossPct}%` }}
            className="bg-slate-400 hover:opacity-90 transition-all cursor-pointer"
            title={`Antriebsverlust: ${physics.powerLossWatts}W (${physics.pLossPct}%)`}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
            <div className="min-w-0">
              <span className="font-semibold text-slate-700 dark:text-slate-200 block text-[11px]">Hub- / Höhenarbeit</span>
              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 text-[11px]">{physics.powerClimbWatts} W ({physics.pClimbPct}%)</span>
            </div>
          </div>

          <div className="flex items-center gap-2 p-2 rounded-lg bg-sky-50/60 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shrink-0" />
            <div className="min-w-0">
              <span className="font-semibold text-slate-700 dark:text-slate-200 block text-[11px]">Luftwiderstand</span>
              <span className="font-mono font-bold text-sky-700 dark:text-sky-400 text-[11px]">{physics.powerAeroWatts} W ({physics.pAeroPct}%)</span>
            </div>
          </div>

          <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
            <div className="min-w-0">
              <span className="font-semibold text-slate-700 dark:text-slate-200 block text-[11px]">Rollreibung</span>
              <span className="font-mono font-bold text-amber-700 dark:text-amber-400 text-[11px]">{physics.powerRollWatts} W ({physics.pRollPct}%)</span>
            </div>
          </div>

          <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-100/60 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />
            <div className="min-w-0">
              <span className="font-semibold text-slate-700 dark:text-slate-200 block text-[11px]">Kettentrieb / Verluste</span>
              <span className="font-mono font-bold text-slate-600 dark:text-slate-400 text-[11px]">{physics.powerLossWatts} W ({physics.pLossPct}%)</span>
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
            <span className="text-3xl font-black text-slate-900 dark:text-white font-mono">
              {physics.caloriesKcal.toLocaleString('de-DE')}
            </span>
            <span className="text-sm font-bold text-slate-500">kcal metabolisch verbrannt</span>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Der menschliche Muskel wandelt ca. 23% der aufgenommenen Nahrungsenergie in mechanischen Vortrieb um. Die übrigen 77% werden als Körperwärme über Schweiß und Atmung abgegeben.
          </p>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between text-xs font-medium">
            <span className="text-slate-500">Mechanische Arbeit am Pedal:</span>
            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{physics.workKj} kJ</span>
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

          <div className="flex justify-between text-xs font-mono font-bold">
            <span className="text-amber-600 dark:text-amber-400">
              🟡 {physics.fatPct}% Fett ({physics.fatGrams}g)
            </span>
            <span className="text-rose-600 dark:text-rose-400">
              🔴 {physics.carbPct}% Carbs ({physics.carbGrams}g)
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚡</span>
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-100 block">Energie-Gels Empfehlung</span>
                <span className="text-[10px] text-slate-500">Basis: 25g Kohlenhydrate pro Gel</span>
              </div>
            </div>
            <div className="text-right font-mono">
              <span className="text-sm font-black text-rose-600 dark:text-rose-400">{physics.gelsCount} Gels</span>
              <span className="block text-[10px] text-slate-400">~{physics.gelsPerHour} Gels / Std.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
