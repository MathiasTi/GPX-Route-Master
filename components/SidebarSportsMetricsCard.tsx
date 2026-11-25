import React, { useMemo } from 'react';
import { Activity, ArrowUpRight, Flame, Mountain, Timer } from 'lucide-react';
import type { GPXTrack } from '../types';
import { computeTrackSportsMetrics } from '../utils/sportsMetricsEngine';
import { triggerHaptic } from '../utils/haptics';

export interface SidebarSportsMetricsCardProps {
  track: GPXTrack;
  ftp: number;
  userWeight: number;
  userMaxHr: number;
  estimatedSpeed: number;
  onOpenFullMetrics?: (trackId: string) => void;
}

export const SidebarSportsMetricsCard: React.FC<SidebarSportsMetricsCardProps> = React.memo(
  ({ track, ftp, userWeight, userMaxHr, estimatedSpeed, onOpenFullMetrics }) => {
    const metrics = useMemo(
      () =>
        computeTrackSportsMetrics(track, {
          ftp,
          weightKg: userWeight,
          maxHr: userMaxHr,
          estimatedSpeedKmh: estimatedSpeed
        }),
      [track, ftp, userWeight, userMaxHr, estimatedSpeed]
    );

    const driftToneClass =
      metrics.efficiency.decouplingStatus === 'stable'
        ? 'text-emerald-600 dark:text-emerald-400'
        : metrics.efficiency.decouplingStatus === 'moderate'
        ? 'text-amber-600 dark:text-amber-400'
        : metrics.efficiency.decouplingStatus === 'high'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-slate-400 dark:text-slate-500';

    const driftStatusText =
      metrics.efficiency.decouplingStatus === 'stable'
        ? 'Stabil'
        : metrics.efficiency.decouplingStatus === 'moderate'
        ? 'Leichter Drift'
        : metrics.efficiency.decouplingStatus === 'high'
        ? 'Ermüdung'
        : 'HR benötigt';

    const thirdMetricLabel =
      metrics.climbing.avgVam !== null
        ? 'VAM Steigrate'
        : metrics.performance.estimatedVo2Max !== null
        ? 'VO2max (Est.)'
        : 'Haltbarkeit';

    const thirdMetricValue =
      metrics.climbing.avgVam !== null
        ? `${metrics.climbing.avgVam}`
        : metrics.performance.estimatedVo2Max !== null
        ? `${metrics.performance.estimatedVo2Max.toFixed(1)}`
        : metrics.durability.retentionPct !== null
        ? `${metrics.durability.retentionPct}%`
        : '–';

    const thirdMetricUnit =
      metrics.climbing.avgVam !== null
        ? metrics.climbing.climbingWkg !== null
          ? `m/h · ${metrics.climbing.climbingWkg} W/kg`
          : 'm/h'
        : metrics.performance.estimatedVo2Max !== null
        ? 'ml/kg/min'
        : metrics.durability.retentionPct !== null
        ? 'Q4 vs Q1'
        : 'Flach / Kurz';

    return (
      <section
        id="sidebar-sports-metrics-card"
        aria-label="Sport- und Fitness-Metriken"
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-tight">
              Sport- &amp; Fitness-Metriken
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
              {metrics.sport === 'running' ? 'Laufen' : 'Radsport'}
              <span aria-hidden="true"> · </span>
              {metrics.performance.phenotype.primaryLabel}
            </p>
          </div>
          {onOpenFullMetrics && (
            <button
              type="button"
              id="btn-sidebar-open-sports-metrics"
              onClick={() => {
                triggerHaptic('light');
                onOpenFullMetrics(track.id);
              }}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Alle Sport- & Fitness-Metriken im Cockpit öffnen"
            >
              <span>Cockpit</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 2x2 Flat Hairline Grid */}
        <div className="grid grid-cols-2 gap-px bg-slate-200/80 dark:bg-slate-800 rounded-lg overflow-hidden border border-slate-200/80 dark:border-slate-800">
          <div className="bg-slate-50/70 dark:bg-slate-950/50 p-2.5">
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>Effizienz (EF)</span>
              <Activity className="w-3 h-3 text-slate-400 shrink-0" />
            </div>
            <div className="mt-1 font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-slate-100">
              {metrics.efficiency.ef !== null ? metrics.efficiency.ef.toFixed(2) : '–'}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              {metrics.efficiency.ef !== null ? metrics.efficiency.unit : 'HR benötigt'}
            </div>
          </div>

          <div className="bg-slate-50/70 dark:bg-slate-950/50 p-2.5">
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>{metrics.efficiency.decouplingLabel || 'Entkopplung'}</span>
            </div>
            <div className={`mt-1 font-mono tabular-nums text-sm font-bold ${driftToneClass}`}>
              {metrics.efficiency.decouplingPct !== null
                ? `${metrics.efficiency.decouplingPct > 0 ? '+' : ''}${metrics.efficiency.decouplingPct}%`
                : '–'}
            </div>
            <div className={`text-[10px] font-medium truncate ${driftToneClass}`}>
              {driftStatusText}
            </div>
          </div>

          <div className="bg-slate-50/70 dark:bg-slate-950/50 p-2.5">
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span className="truncate">{thirdMetricLabel}</span>
              <Mountain className="w-3 h-3 text-slate-400 shrink-0" />
            </div>
            <div className="mt-1 font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-slate-100">
              {thirdMetricValue}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              {thirdMetricUnit}
            </div>
          </div>

          <div className="bg-slate-50/70 dark:bg-slate-950/50 p-2.5">
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>Erholung</span>
              <Timer className="w-3 h-3 text-slate-400 shrink-0" />
            </div>
            <div className="mt-1 font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-slate-100">
              {metrics.recovery.estimatedHours} h
            </div>
            <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
              TSS {metrics.recovery.sessionTss}
            </div>
          </div>
        </div>

        {/* Quiet 1-line Fueling & Hydration summary */}
        <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] text-slate-600 dark:text-slate-300 font-mono tabular-nums">
          <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
            <Flame className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>{metrics.fueling.carbsPerHourG} g/h KH</span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            <span>{metrics.fueling.fluidPerHourMl} ml/h</span>
          </span>
          <span className="text-slate-500 dark:text-slate-400 shrink-0">
            {metrics.fueling.totalKcal.toLocaleString('de-DE')} kcal
          </span>
        </div>
      </section>
    );
  }
);
