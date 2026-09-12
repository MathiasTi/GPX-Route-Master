import React from 'react';
import { Printer, Download, MapPin, Calendar, Clock, Mountain, TrendingUp, Flame, Droplets, CheckCircle2, Shield } from 'lucide-react';
import { GPXTrack } from '../../types';
import { IntensiveAnalysisResult, formatSecondsToTime } from '../../utils/intensiveAnalysis';
import { triggerHaptic } from '../../utils/haptics';

interface PrintReportTabProps {
  track: GPXTrack;
  analysis: IntensiveAnalysisResult;
}

export const PrintReportTab: React.FC<PrintReportTabProps> = ({ track, analysis }) => {
  const handlePrint = () => {
    triggerHaptic('medium');
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Print Action Banner */}
      <div className="flex items-center justify-between p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 print:hidden">
        <div className="flex items-center gap-2.5">
          <Printer className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              Druck- & PDF-Report
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Optimiert für den standardisierten A4-Ausdruck und den PDF-Export deiner Tour
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handlePrint}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2 shadow-md transition-all cursor-pointer"
        >
          <Printer className="w-4 h-4" />
          Report drucken / PDF speichern
        </button>
      </div>

      {/* Printable Sheet Card */}
      <div 
        id="printable-activity-report" 
        className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6 print:border-none print:shadow-none print:p-0"
      >
        {/* Document Header */}
        <div className="border-b border-slate-200 dark:border-slate-800 pb-5 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-1">
              <span>Alpentour • Offizieller Aktivitätsbericht</span>
              <span>•</span>
              <span>{analysis.activityType === 'cycling' ? 'Radsport' : 'Laufen'}</span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {analysis.trackName}
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Erstellt am {new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })} • Berechnet mit GPX Route Master Pro
            </p>
          </div>

          <div className="text-right">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-mono font-bold">
              Schwierigkeit: {analysis.difficultyScore}/10
            </div>
          </div>
        </div>

        {/* 6 Key Stats Grid */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/70 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Distanz</span>
            <span className="text-lg font-black text-slate-900 dark:text-white font-mono">{analysis.totalDistanceKm} km</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/70 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Höhenmeter</span>
            <span className="text-lg font-black text-emerald-600 dark:text-emerald-400 font-mono">+{Math.round(analysis.totalAscentMeters)} m</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/70 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Abstieg</span>
            <span className="text-lg font-black text-rose-600 dark:text-rose-400 font-mono">-{Math.round(analysis.totalDescentMeters)} m</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/70 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Fahrzeit (Netto)</span>
            <span className="text-lg font-black text-slate-900 dark:text-white font-mono">
              {formatSecondsToTime(analysis.estimatedMovingTimeSeconds)}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/70 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Ø-Tempo</span>
            <span className="text-lg font-black text-indigo-600 dark:text-indigo-400 font-mono">{analysis.estimatedAverageSpeedKmh} km/h</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/70 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Höchster Punkt</span>
            <span className="text-lg font-black text-slate-900 dark:text-white font-mono">{Math.round(analysis.maxElevation)} m ü.NN</span>
          </div>
        </div>

        {/* Climbs Breakdown Table */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Mountain className="w-4 h-4 text-amber-500" />
            Identifizierte Bergwertungen & Pässe ({analysis.climbs.length})
          </h3>

          {analysis.climbs.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-2">Keine nennenswerten Passanstiege auf dieser Teilstrecke identifiziert.</p>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Kategorie</th>
                    <th className="py-2 px-3">Streckenabschnitt</th>
                    <th className="py-2 px-3">Länge</th>
                    <th className="py-2 px-3">Höhengewinn</th>
                    <th className="py-2 px-3">Ø Steigung</th>
                    <th className="py-2 px-3">Max. Rampe</th>
                    <th className="py-2 px-3">VAM Steigrate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                  {analysis.climbs.map((climb) => (
                    <tr key={climb.index}>
                      <td className="py-2 px-3 font-sans font-bold">#{climb.index + 1}</td>
                      <td className="py-2 px-3 font-sans">
                        <span 
                          className="px-2 py-0.5 rounded text-[10px] font-black text-white"
                          style={{ backgroundColor: climb.hexColor }}
                        >
                          {climb.categoryLabel}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-700 dark:text-slate-300">km {climb.startKm} → km {climb.endKm}</td>
                      <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{climb.distanceKm} km</td>
                      <td className="py-2 px-3 text-emerald-600 dark:text-emerald-400 font-bold">+{Math.round(climb.ascentMeters)} m</td>
                      <td className="py-2 px-3 text-amber-600 dark:text-amber-400 font-bold">{climb.avgGradePercent}%</td>
                      <td className="py-2 px-3 text-rose-600 dark:text-rose-400 font-bold">{climb.maxGradePercent}%</td>
                      <td className="py-2 px-3 text-indigo-600 dark:text-indigo-400 font-bold">{climb.vam} m/h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Nutrition & Energy Plan */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/70 dark:border-slate-800 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-orange-500" />
              Energie- & Verpflegungsbedarf
            </h4>
            <div className="grid grid-cols-3 gap-2 text-xs font-mono pt-1">
              <div>
                <span className="text-[10px] text-slate-400 block font-sans">Kalorien</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{analysis.totalCaloriesKcal} kcal</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-sans">Kohlenhydrate</span>
                <span className="font-bold text-rose-600 dark:text-rose-400">{analysis.carbsBurnedGrams} g</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-sans">Fettverbrennung</span>
                <span className="font-bold text-amber-600 dark:text-amber-400">{analysis.fatBurnedGrams} g</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 pt-1">
              Empfohlene stündliche Kohlenhydratzufuhr: <strong>{analysis.hourlyCarbIntakeRecommendedGrams}g / Stunde</strong>.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/70 dark:border-slate-800 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Droplets className="w-3.5 h-3.5 text-sky-500" />
              Hydratation & Elektrolyte
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1">
              <div>
                <span className="text-[10px] text-slate-400 block font-sans">Flüssigkeit</span>
                <span className="font-bold text-sky-600 dark:text-sky-400">{analysis.totalFluidRecommendedLiters} Liter</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-sans">Natrium / Salze</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">~{analysis.sodiumRecommendedMg} mg</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 pt-1">
              Bei Steigungen & Sommerhitze alle 15–20 Minuten ca. 150–200 ml elektrolytreiche Flüssigkeit trinken.
            </p>
          </div>
        </div>

        {/* Footer info */}
        <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex items-center justify-between text-[10px] text-slate-400">
          <span>GPX Route Master Pro • Alpentour GPS Navigator</span>
          <span>Seite 1 von 1</span>
        </div>
      </div>
    </div>
  );
};
