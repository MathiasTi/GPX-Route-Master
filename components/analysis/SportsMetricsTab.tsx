import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Award,
  Droplets,
  Flame,
  Info,
  Mountain,
  ShieldCheck,
  Timer,
  TrendingUp
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { GPXTrack } from '../../types';
import {
  type ClimateCondition,
  computeTrackSportsMetrics,
  formatPaceMinPerKm,
  formatRaceTime
} from '../../utils/sportsMetricsEngine';
import { triggerHaptic } from '../../utils/haptics';

export interface SportsMetricsTabProps {
  track: GPXTrack;
  activityType: 'cycling' | 'running';
  ftp: number;
  weightKg: number;
  maxHr: number;
  estimatedSpeedKmh: number;
  initialTempC?: number;
  onOpenGlossary?: (metricId?: string) => void;
}

function initialClimateFromTemp(tempC?: number): ClimateCondition {
  if (typeof tempC !== 'number' || !Number.isFinite(tempC)) return 'moderate';
  if (tempC < 14) return 'cool';
  if (tempC > 24) return 'warm';
  return 'moderate';
}

export const SportsMetricsTab: React.FC<SportsMetricsTabProps> = ({
  track,
  activityType,
  ftp,
  weightKg,
  maxHr,
  estimatedSpeedKmh,
  initialTempC,
  onOpenGlossary
}) => {
  const [climate, setClimate] = useState<ClimateCondition>(() => initialClimateFromTemp(initialTempC));
  const [hasManualClimate, setHasManualClimate] = useState(false);

  useEffect(() => {
    setHasManualClimate(false);
    setClimate(initialClimateFromTemp(initialTempC));
  }, [track.id]);

  useEffect(() => {
    if (!hasManualClimate) {
      setClimate(initialClimateFromTemp(initialTempC));
    }
  }, [initialTempC, hasManualClimate]);

  const metrics = useMemo(
    () =>
      computeTrackSportsMetrics(track, {
        ftp,
        weightKg,
        maxHr,
        estimatedSpeedKmh,
        climate,
        activityTypeOverride: activityType
      }),
    [track, ftp, weightKg, maxHr, estimatedSpeedKmh, climate, activityType]
  );

  const decouplingTone =
    metrics.efficiency.decouplingStatus === 'stable'
      ? { color: 'text-emerald-600 dark:text-emerald-400', label: 'Stabil (<5%)' }
      : metrics.efficiency.decouplingStatus === 'moderate'
      ? { color: 'text-amber-600 dark:text-amber-400', label: 'Leichter Drift (5–10%)' }
      : metrics.efficiency.decouplingStatus === 'high'
      ? { color: 'text-rose-600 dark:text-rose-400', label: 'Ermüdungs-Drift (>10%)' }
      : { color: 'text-slate-500 dark:text-slate-400', label: 'Nicht verfügbar' };

  const durabilityTone =
    metrics.durability.status === 'strong'
      ? { color: 'text-emerald-600 dark:text-emerald-400', label: 'Hohe Haltbarkeit' }
      : metrics.durability.status === 'moderate'
      ? { color: 'text-amber-600 dark:text-amber-400', label: 'Solide Konstanz' }
      : metrics.durability.status === 'fatigued'
      ? { color: 'text-rose-600 dark:text-rose-400', label: 'Später Leistungsabfall' }
      : { color: 'text-slate-500 dark:text-slate-400', label: 'Nicht verfügbar' };

  const splitTone =
    metrics.climbing.splitType === 'negative'
      ? { color: 'text-emerald-600 dark:text-emerald-400', label: 'Negativer Split (2. Hälfte schneller)' }
      : metrics.climbing.splitType === 'even'
      ? { color: 'text-indigo-600 dark:text-indigo-400', label: 'Gleichmäßiges Pacing' }
      : metrics.climbing.splitType === 'positive'
      ? { color: 'text-amber-600 dark:text-amber-400', label: 'Positiver Split (1. Hälfte schneller)' }
      : { color: 'text-slate-500 dark:text-slate-400', label: 'Nicht verfügbar' };

  const readinessText: Record<typeof metrics.recovery.readinessLabel, { label: string; color: string }> = {
    light: { label: 'Leichte Einheit', color: 'text-emerald-600 dark:text-emerald-400' },
    moderate: { label: 'Moderater Reiz', color: 'text-indigo-600 dark:text-indigo-400' },
    hard: { label: 'Hohe Belastung', color: 'text-amber-600 dark:text-amber-400' },
    very_hard: { label: 'Sehr hohe Belastung', color: 'text-rose-600 dark:text-rose-400' }
  };

  const axisBarColors = ['#6366f1', '#0ea5e9', '#16a34a', '#d97706', '#8b5cf6'];

  return (
    <div id="cockpit-sports-metrics-tab" className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Sport- &amp; Fitness-Metriken
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {metrics.sport === 'running' ? 'Lauf-Analyse (GAP & VDOT)' : 'Radsport-Analyse (Leistung & VAM)'}
            <span aria-hidden="true"> · </span>
            Profil: <span className="font-semibold text-slate-700 dark:text-slate-200">{metrics.performance.phenotype.primaryLabel}</span>
            <span aria-hidden="true"> · </span>
            <span className="font-mono tabular-nums">
              {metrics.distanceKm.toFixed(1)} km · +{Math.round(metrics.ascentM)} hm
            </span>
          </p>
        </div>

        {onOpenGlossary && (
          <button
            type="button"
            onClick={() => onOpenGlossary('efficiency')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 cursor-pointer self-start sm:self-auto whitespace-nowrap shrink-0"
          >
            <Info className="w-3.5 h-3.5" />
            <span>Metriken-Glossar</span>
          </button>
        )}
      </div>

      {/* Section 1: Aerobic Efficiency, Decoupling, Durability & Recovery */}
      <section className="space-y-2.5">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-indigo-500" />
          <span>Aerobe Effizienz, Entkopplung &amp; Ermüdungsresistenz</span>
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Efficiency Factor */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">Effizienz-Faktor (EF)</div>
            <div className="font-mono tabular-nums text-2xl font-bold text-slate-900 dark:text-slate-100">
              {metrics.efficiency.ef !== null ? metrics.efficiency.ef.toFixed(2) : '–'}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {metrics.efficiency.ef !== null ? (
                <>
                  <span className="font-mono">{metrics.efficiency.unit}</span>
                  {metrics.efficiency.avgHr !== null && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="font-mono tabular-nums">Ø {metrics.efficiency.avgHr} bpm</span>
                    </>
                  )}
                </>
              ) : (
                metrics.efficiency.reasonUnavailable || 'Herzfrequenzdaten benötigt'
              )}
            </div>
          </div>

          {/* Aerobic Decoupling */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Aerobe Entkopplung ({metrics.efficiency.decouplingLabel || 'Pw:Hr / Pa:Hr'})
            </div>
            <div className={`font-mono tabular-nums text-2xl font-bold ${decouplingTone.color}`}>
              {metrics.efficiency.decouplingPct !== null
                ? `${metrics.efficiency.decouplingPct > 0 ? '+' : ''}${metrics.efficiency.decouplingPct}%`
                : '–'}
            </div>
            <div className={`text-[11px] font-medium ${decouplingTone.color}`}>
              {metrics.efficiency.decouplingPct !== null ? (
                <>
                  <span>{decouplingTone.label}</span>
                  {metrics.efficiency.firstHalfEf !== null && metrics.efficiency.secondHalfEf !== null && (
                    <span className="block font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
                      H1 {metrics.efficiency.firstHalfEf.toFixed(2)} → H2 {metrics.efficiency.secondHalfEf.toFixed(2)}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-500 dark:text-slate-400 font-normal">
                  {metrics.efficiency.reasonUnavailable || 'Mind. 10 Min. mit HF benötigt'}
                </span>
              )}
            </div>
          </div>

          {/* Durability / Fatigue Resistance */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">Haltbarkeit (Q4 vs. Q1)</div>
            <div className={`font-mono tabular-nums text-2xl font-bold ${durabilityTone.color}`}>
              {metrics.durability.retentionPct !== null ? `${metrics.durability.retentionPct}%` : '–'}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {metrics.durability.retentionPct !== null ? (
                <>
                  <span className={`font-medium ${durabilityTone.color}`}>{durabilityTone.label}</span>
                  {metrics.durability.workPerKg !== null && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="font-mono tabular-nums">{metrics.durability.workPerKg} kJ/kg</span>
                    </>
                  )}
                </>
              ) : (
                metrics.durability.reasonUnavailable || 'Mind. 20 Min. Bewegungszeit nötig'
              )}
            </div>
          </div>

          {/* Recovery Time */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span>Geschätzte Erholung</span>
              <Timer className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="font-mono tabular-nums text-2xl font-bold text-slate-900 dark:text-slate-100">
              {metrics.recovery.estimatedHours} h
            </div>
            <div className="text-[11px]">
              <span className={`font-medium ${readinessText[metrics.recovery.readinessLabel].color}`}>
                {readinessText[metrics.recovery.readinessLabel].label}
              </span>
              <span aria-hidden="true" className="text-slate-400"> · </span>
              <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                TSS {metrics.recovery.sessionTss}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Climbing Intelligence & Climate-Aware Fueling Calculator */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Climbing VAM, W/kg & Pacing Split */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Mountain className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Kletter-Leistung (VAM &amp; W/kg) &amp; Pacing-Split</span>
            </h4>
            <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {metrics.climbing.climbCount} Anstiege
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-1 border-t border-slate-100 dark:border-slate-800">
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Ø VAM Steigrate</div>
              <div className="font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                {metrics.climbing.avgVam !== null ? `${metrics.climbing.avgVam}` : '–'}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                {metrics.climbing.avgVam !== null ? 'm/h (≥3% Steigung)' : 'Flachprofil'}
              </div>
            </div>

            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Peak Berg-VAM</div>
              <div className="font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                {metrics.climbing.peakClimbVam !== null ? `${metrics.climbing.peakClimbVam}` : '–'}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                {metrics.climbing.peakClimbVam !== null ? 'm/h Best-Anstieg' : 'Keine Zeitstempel'}
              </div>
            </div>

            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Kletter-W/kg</div>
              <div className="font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                {metrics.climbing.climbingWkg !== null ? `${metrics.climbing.climbingWkg.toFixed(2)}` : '–'}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                {metrics.climbing.climbingWkgSource === 'power'
                  ? 'W/kg (Powermeter)'
                  : metrics.climbing.climbingWkgSource === 'vam_model'
                  ? 'W/kg (Ferrari-VAM)'
                  : metrics.sport === 'running'
                  ? 'Nur Radsport'
                  : 'Keine Anstiege'}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">Split-Balance (2. vs. 1. Hälfte)</span>
            <span className={`font-semibold ${splitTone.color}`}>
              {metrics.climbing.splitBalancePct !== null ? (
                <>
                  <span className="font-mono tabular-nums">
                    {metrics.climbing.splitBalancePct > 0 ? '+' : ''}
                    {metrics.climbing.splitBalancePct}%
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span>{splitTone.label}</span>
                </>
              ) : (
                splitTone.label
              )}
            </span>
          </div>
        </div>

        {/* Climate-Aware Fueling & Hydration Calculator */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-amber-500" />
              <span>Verpflegungs- &amp; Hydrationsrechner</span>
            </h4>

            {/* Interactive Climate Selector */}
            <div
              className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700"
              role="group"
              aria-label="Temperaturbedingung für Hydrationsrechner"
            >
              {(
                [
                  { id: 'cool', label: 'Kühl (<14°C)' },
                  { id: 'moderate', label: 'Normal' },
                  { id: 'warm', label: 'Warm (>24°C)' }
                ] as Array<{ id: ClimateCondition; label: string }>
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    setHasManualClimate(true);
                    setClimate(opt.id);
                  }}
                  className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    climate === opt.id
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-1 border-t border-slate-100 dark:border-slate-800">
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Kohlenhydrate</div>
              <div className="font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                {metrics.fueling.carbsPerHourG} g/h
              </div>
              <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Gesamt {metrics.fueling.totalCarbsG} g
              </div>
            </div>

            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <Droplets className="w-3 h-3 text-sky-500" />
                <span>Flüssigkeit</span>
              </div>
              <div className="font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                {metrics.fueling.fluidPerHourMl} ml/h
              </div>
              <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Gesamt {(metrics.fueling.totalFluidMl / 1000).toFixed(2)} L
              </div>
            </div>

            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Energieumsatz</div>
              <div className="font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                {metrics.fueling.totalKcal.toLocaleString('de-DE')}
              </div>
              <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                kcal{metrics.fueling.totalKj ? ` · ${metrics.fueling.totalKj} kJ` : ''}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Natrium-Richtwert: <strong className="font-mono tabular-nums text-slate-700 dark:text-slate-200">{metrics.fueling.sodiumPerHourMg} mg/h</strong></span>
            {metrics.fueling.intensityFactor !== null && (
              <span className="font-mono tabular-nums">IF {metrics.fueling.intensityFactor.toFixed(2)}</span>
            )}
          </div>
        </div>
      </section>

      {/* Section 3: VO2max, Race Time Predictor / Benchmarks & 5-Axis Athlete Phenotype */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* VO2max + Race Predictor / Cycling Benchmarks */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-indigo-500" />
                <span>
                  {metrics.sport === 'running'
                    ? 'VO2max (VDOT) & Wettkampf-Prognose'
                    : 'VO2max-Schätzung & Leistungs-Benchmarks'}
                </span>
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {metrics.performance.vo2Method || 'Benötigt aussagekräftige Strecken- oder Leistungsdaten'}
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono tabular-nums text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                {metrics.performance.estimatedVo2Max !== null
                  ? metrics.performance.estimatedVo2Max.toFixed(1)
                  : '–'}
              </div>
              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">ml/kg/min</div>
            </div>
          </div>

          {metrics.sport === 'running' ? (
            metrics.performance.racePredictions.length > 0 ? (
              <div className="overflow-x-auto border-t border-slate-100 dark:border-slate-800 pt-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                      <th className="py-1.5 text-left font-medium">Distanz</th>
                      <th className="py-1.5 text-right font-medium">Prognose-Zeit</th>
                      <th className="py-1.5 text-right font-medium">Ziel-Pace</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {metrics.performance.racePredictions.map((pred) => (
                      <tr key={pred.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2 font-medium text-slate-800 dark:text-slate-200">
                          {pred.label}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {formatRaceTime(pred.timeSec)}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {formatPaceMinPerKm(pred.pacePerKmSec)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
                Mindestens 1,5 km und 4 Min. Laufzeit erforderlich, um VDOT-Wettkampfzeiten abzuleiten.
              </p>
            )
          ) : (
            <div className="overflow-x-auto border-t border-slate-100 dark:border-slate-800 pt-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="py-1.5 text-left font-medium">Intervall</th>
                    <th className="py-1.5 text-right font-medium">Leistung</th>
                    <th className="py-1.5 text-right font-medium">W/kg</th>
                    <th className="py-1.5 text-right font-medium">Stufe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {metrics.performance.cyclingBenchmarks.map((row) => (
                    <tr key={row.durationSec} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 font-medium text-slate-800 dark:text-slate-200">
                        {row.durationLabel}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {row.watts !== null ? `${row.watts} W` : '–'}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums font-semibold text-indigo-600 dark:text-indigo-400">
                        {row.wkg !== null ? row.wkg.toFixed(2) : '–'}
                      </td>
                      <td className="py-2 text-right text-slate-600 dark:text-slate-300">
                        {row.tierLabel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 5-Axis Athlete Phenotype */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Athleten-Phänotyp</span>
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {metrics.performance.phenotype.summary}
              </p>
            </div>
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
              {metrics.performance.phenotype.primaryLabel}
            </span>
          </div>

          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={metrics.performance.phenotype.axes}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#94a3b8" strokeOpacity={0.2} />
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={124}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                  formatter={(value: any, _name: any, item: any) => [
                    `${value}/100 (${item?.payload?.detail || ''})`,
                    'Score'
                  ]}
                  contentStyle={{
                    borderRadius: '0.75rem',
                    border: '1px solid #334155',
                    backgroundColor: '#0f172a',
                    color: '#f8fafc',
                    fontSize: '12px'
                  }}
                />
                <Bar dataKey="score" radius={[0, 6, 6, 0]} barSize={16}>
                  {metrics.performance.phenotype.axes.map((axis, idx) => (
                    <Cell key={axis.id} fill={axisBarColors[idx % axisBarColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
            {metrics.performance.phenotype.axes.map((axis) => (
              <div key={axis.id} className="truncate">
                <span className="text-slate-500 dark:text-slate-400">{axis.label.split(' ')[0]}: </span>
                <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                  {axis.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
