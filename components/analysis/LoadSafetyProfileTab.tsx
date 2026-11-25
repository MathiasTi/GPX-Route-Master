import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Award,
  ShieldCheck,
  Timer,
  TrendingUp
} from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  computeLongitudinalFitnessMetrics,
  formatPaceMinPerKm,
  formatRaceTime,
  type LongitudinalActivityInput,
  type LongitudinalDailyPoint
} from '../../utils/sportsMetricsEngine';

export interface LoadSafetyProfileTabProps {
  activities: LongitudinalActivityInput[];
  dailySeries: LongitudinalDailyPoint[];
  ftp: number;
  weightKg: number;
}

export const LoadSafetyProfileTab: React.FC<LoadSafetyProfileTabProps> = ({
  activities,
  dailySeries,
  ftp,
  weightKg
}) => {
  const [efSportFilter, setEfSportFilter] = useState<'all' | 'cycling' | 'running'>('all');

  const filteredActivities = useMemo(() => {
    if (efSportFilter === 'all') return activities;
    return activities.filter((a) => a.sport === efSportFilter);
  }, [activities, efSportFilter]);

  const metrics = useMemo(
    () =>
      computeLongitudinalFitnessMetrics(filteredActivities, dailySeries, {
        ftp,
        weightKg,
        sportFilter: efSportFilter
      }),
    [filteredActivities, dailySeries, ftp, weightKg, efSportFilter]
  );

  const acwrDisplay = {
    optimal: { label: 'Optimaler Bereich (0.8–1.3)', color: 'text-emerald-600 dark:text-emerald-400' },
    undertraining: { label: 'Unterbelastung (<0.8)', color: 'text-sky-600 dark:text-sky-400' },
    caution: { label: 'Erhöhter Anstieg (1.3–1.5)', color: 'text-amber-600 dark:text-amber-400' },
    high_risk: { label: 'Überlastungsrisiko (>1.5)', color: 'text-rose-600 dark:text-rose-400' },
    insufficient_data: { label: 'Mind. 14 Tage Historie nötig', color: 'text-slate-500 dark:text-slate-400' }
  }[metrics.acwr.status];

  const monotonyDisplay = {
    balanced: { label: 'Abwechslungsreich (≤1.5)', color: 'text-emerald-600 dark:text-emerald-400' },
    elevated: { label: 'Erhöhte Monotonie (1.5–2.0)', color: 'text-amber-600 dark:text-amber-400' },
    high_risk: { label: 'Überlastungsrisiko (>2.0)', color: 'text-rose-600 dark:text-rose-400' },
    insufficient_data: { label: 'Mind. 7 Tage Historie nötig', color: 'text-slate-500 dark:text-slate-400' }
  }[metrics.monotonyStrain.status];

  const rampDisplay = {
    optimal: { label: 'Sicherer Aufbau (+2 bis +7/Wo)', color: 'text-emerald-600 dark:text-emerald-400' },
    steady: { label: 'Erhaltend (-2 bis +2/Wo)', color: 'text-indigo-600 dark:text-indigo-400' },
    detraining: { label: 'Entlastung / Tapering', color: 'text-sky-600 dark:text-sky-400' },
    aggressive: { label: 'Sehr steiler Anstieg (>+7/Wo)', color: 'text-rose-600 dark:text-rose-400' },
    insufficient_data: { label: 'Mind. 8 Tage Historie nötig', color: 'text-slate-500 dark:text-slate-400' }
  }[metrics.rampRate.status];

  const efDirectionDisplay = {
    improving: { label: 'Steigende aerobe Effizienz', color: 'text-emerald-600 dark:text-emerald-400' },
    stable: { label: 'Stabile Effizienz', color: 'text-indigo-600 dark:text-indigo-400' },
    declining: { label: 'Rückläufige Effizienz', color: 'text-amber-600 dark:text-amber-400' },
    insufficient_data: { label: 'Mind. 4 Einheiten mit HF nötig', color: 'text-slate-500 dark:text-slate-400' }
  }[metrics.efTrend.direction];

  const recentAcwrSeries = useMemo(() => metrics.acwr.series.slice(-60), [metrics.acwr.series]);
  const recentEfPoints = useMemo(() => metrics.efTrend.points.slice(-30), [metrics.efTrend.points]);
  const axisBarColors = ['#6366f1', '#0ea5e9', '#16a34a', '#d97706', '#8b5cf6'];

  return (
    <div id="fitness-load-safety-tab" className="space-y-6">
      {/* Header + Sport Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Belastungssicherheit, Effizienz-Trend &amp; Athleten-Profil
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            ACWR-Verletzungsprävention · Foster-Monotonie &amp; Strain · VO2max &amp; Phänotyp
          </p>
        </div>

        <div
          className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 self-start sm:self-auto"
          role="group"
          aria-label="Sportart für Effizienz und Profil filtern"
        >
          {(
            [
              { id: 'all', label: 'Alle' },
              { id: 'cycling', label: 'Radsport' },
              { id: 'running', label: 'Laufen' }
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setEfSportFilter(opt.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                efSportFilter === opt.id
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Row 1: 4 Load Safety KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* ACWR */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>ACWR (7T / 28T)</span>
            {metrics.acwr.status === 'high_risk' ? (
              <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            )}
          </div>
          <div className={`font-mono tabular-nums text-2xl font-bold ${acwrDisplay.color}`}>
            {metrics.acwr.current !== null ? metrics.acwr.current.toFixed(2) : '–'}
          </div>
          <div className={`text-[11px] font-medium ${acwrDisplay.color}`}>{acwrDisplay.label}</div>
          {metrics.acwr.current !== null && (
            <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Akut {metrics.acwr.acuteLoad7d} · Chronisch {metrics.acwr.chronicLoad28d} TSS/T
            </div>
          )}
        </div>

        {/* Foster Monotony & Strain */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Monotonie &amp; Strain (7 Tage)</div>
          <div className={`font-mono tabular-nums text-2xl font-bold ${monotonyDisplay.color}`}>
            {metrics.monotonyStrain.monotony7d !== null
              ? metrics.monotonyStrain.monotony7d.toFixed(2)
              : '–'}
          </div>
          <div className={`text-[11px] font-medium ${monotonyDisplay.color}`}>{monotonyDisplay.label}</div>
          {metrics.monotonyStrain.strain7d !== null && (
            <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Strain {metrics.monotonyStrain.strain7d} · Woche {metrics.monotonyStrain.weeklyLoad} TSS
            </div>
          )}
        </div>

        {/* Weekly CTL Ramp Rate */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>CTL Ramp-Rate (7T)</span>
            <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className={`font-mono tabular-nums text-2xl font-bold ${rampDisplay.color}`}>
            {metrics.rampRate.weeklyCtlDelta !== null
              ? `${metrics.rampRate.weeklyCtlDelta > 0 ? '+' : ''}${metrics.rampRate.weeklyCtlDelta.toFixed(1)}`
              : '–'}
          </div>
          <div className={`text-[11px] font-medium ${rampDisplay.color}`}>{rampDisplay.label}</div>
          <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Aktuell CTL {metrics.rampRate.currentCtl}
          </div>
        </div>

        {/* Recovery Time */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Erholungszeit</span>
            <Timer className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="font-mono tabular-nums text-2xl font-bold text-slate-900 dark:text-slate-100">
            {metrics.recovery.estimatedHours} h
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {metrics.recovery.latestSessionTss > 0
              ? `Letzte Einheit: ${metrics.recovery.latestSessionTss} TSS`
              : 'Aktuell vollständig erholt'}
          </div>
        </div>
      </div>

      {/* Row 2: ACWR Safety-Band Chart + Longitudinal EF Progression */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ACWR History Chart */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                ACWR-Verlauf &amp; Sweet-Spot-Korridor (0.8–1.3)
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Grünes Band = optimaler Aufbau · Rote Linie (1.5) = Überlastungsgrenze
              </p>
            </div>
          </div>

          {recentAcwrSeries.length >= 3 ? (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={recentAcwrSeries} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                  <XAxis dataKey="formattedDate" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={18} />
                  <YAxis domain={[0, 2.2]} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '0.75rem',
                      border: '1px solid #334155',
                      backgroundColor: '#0f172a',
                      color: '#f8fafc',
                      fontSize: '12px'
                    }}
                    formatter={(value: any, name: any) => [
                      name === 'acwr' ? Number(value).toFixed(2) : value,
                      name === 'acwr' ? 'ACWR' : name
                    ]}
                  />
                  <ReferenceArea y1={0.8} y2={1.3} fill="#16a34a" fillOpacity={0.12} />
                  <ReferenceLine y={1.5} stroke="#dc2626" strokeDasharray="4 4" strokeWidth={1.5} />
                  <Area
                    type="monotone"
                    dataKey="acwr"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="#6366f1"
                    fillOpacity={0.12}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg px-4 text-center">
              Für den ACWR-Verlauf werden mindestens 14 Tage Trainingshistorie mit belastungsrelevanten Einheiten benötigt.
            </div>
          )}
        </div>

        {/* Longitudinal Efficiency Factor Trend */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-indigo-500" />
                <span>Effizienz-Faktor Trend (EF)</span>
              </h4>
              <p className={`text-[11px] font-medium mt-0.5 ${efDirectionDisplay.color}`}>
                {efDirectionDisplay.label}
                {metrics.efTrend.changePct !== null && (
                  <span className="font-mono tabular-nums">
                    {' '}
                    ({metrics.efTrend.changePct > 0 ? '+' : ''}
                    {metrics.efTrend.changePct}%)
                  </span>
                )}
              </p>
            </div>
          </div>

          {recentEfPoints.length >= 2 ? (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={recentEfPoints} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                  <XAxis dataKey="formattedDate" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={16} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '0.75rem',
                      border: '1px solid #334155',
                      backgroundColor: '#0f172a',
                      color: '#f8fafc',
                      fontSize: '12px'
                    }}
                    formatter={(value: any, _name: any, item: any) => [
                      `${Number(value).toFixed(2)} ${item?.payload?.unit || ''}`,
                      item?.payload?.name || 'EF'
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="ef"
                    stroke="#16a34a"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#16a34a' }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg px-4 text-center">
              Für den Effizienz-Trend werden Aktivitäten mit Herzfrequenz und Distanz/Leistung (≥10 Min.) benötigt.
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Aggregate VO2max, Race Time Predictor & 5-Axis Athlete Phenotype */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-indigo-500" />
                <span>VO2max-Schätzung &amp; Wettkampf-Prognose</span>
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {metrics.athleteProfile.vo2Source || 'Synchronisiere Aktivitäten für VO2max & Prognosen'}
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono tabular-nums text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                {metrics.athleteProfile.estimatedVo2Max !== null
                  ? metrics.athleteProfile.estimatedVo2Max.toFixed(1)
                  : '–'}
              </div>
              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">ml/kg/min</div>
            </div>
          </div>

          {metrics.athleteProfile.racePredictions.length > 0 && (
            <div className="overflow-x-auto border-t border-slate-100 dark:border-slate-800 pt-2">
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                Lauf-Prognosen (VDOT {metrics.athleteProfile.vdot?.toFixed(1)})
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="py-1.5 text-left font-medium">Distanz</th>
                    <th className="py-1.5 text-right font-medium">Prognose</th>
                    <th className="py-1.5 text-right font-medium">Pace</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {metrics.athleteProfile.racePredictions.map((pred) => (
                    <tr key={pred.id}>
                      <td className="py-1.5 font-medium text-slate-800 dark:text-slate-200">{pred.label}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {formatRaceTime(pred.timeSec)}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatPaceMinPerKm(pred.pacePerKmSec)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {metrics.athleteProfile.cyclingBenchmarks.some((b) => b.watts !== null) && (
            <div className="overflow-x-auto border-t border-slate-100 dark:border-slate-800 pt-2">
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                Radsport W/kg Bestwerte
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="py-1.5 text-left font-medium">Intervall</th>
                    <th className="py-1.5 text-right font-medium">Watt</th>
                    <th className="py-1.5 text-right font-medium">W/kg</th>
                    <th className="py-1.5 text-right font-medium">Stufe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {metrics.athleteProfile.cyclingBenchmarks.map((row) => (
                    <tr key={row.durationSec}>
                      <td className="py-1.5 font-medium text-slate-800 dark:text-slate-200">{row.durationLabel}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {row.watts !== null ? `${row.watts} W` : '–'}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums font-semibold text-indigo-600 dark:text-indigo-400">
                        {row.wkg !== null ? row.wkg.toFixed(2) : '–'}
                      </td>
                      <td className="py-1.5 text-right text-slate-600 dark:text-slate-300">{row.tierLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Aggregate Athlete Phenotype */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Athleten-Phänotyp (Historie)
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {metrics.athleteProfile.phenotype.summary}
              </p>
            </div>
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
              {metrics.athleteProfile.phenotype.primaryLabel}
            </span>
          </div>

          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={metrics.athleteProfile.phenotype.axes}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#94a3b8" strokeOpacity={0.2} />
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={126}
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
                  {metrics.athleteProfile.phenotype.axes.map((axis, idx) => (
                    <Cell key={axis.id} fill={axisBarColors[idx % axisBarColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
