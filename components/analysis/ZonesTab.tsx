import React, { useState, useMemo } from 'react';
import { Heart, Zap, Sliders, Activity, Clock, ShieldCheck, Award, Info } from 'lucide-react';
import { GPXTrack } from '../../types';
import { triggerHaptic } from '../../utils/haptics';

interface ZonesTabProps {
  track: GPXTrack;
  initialMaxHr?: number;
  initialFtp?: number;
  onOpenGlossary?: (metricId?: string) => void;
}

export const ZonesTab: React.FC<ZonesTabProps> = ({
  track,
  initialMaxHr = 185,
  initialFtp = 220,
  onOpenGlossary
}) => {
  const [maxHr, setMaxHr] = useState<number>(initialMaxHr);
  const [ftp, setFtp] = useState<number>(initialFtp);
  const [zoneView, setZoneView] = useState<'hr' | 'power'>('hr');

  // Check if track has real HR or Power data
  const hasRealHr = useMemo(() => {
    return (track.points || []).some(p => p.hr !== undefined && p.hr > 0);
  }, [track.points]);

  const hasRealPower = useMemo(() => {
    return (track.points || []).some(p => p.power !== undefined && p.power > 0);
  }, [track.points]);

  // Define 5 standard Heart Rate Zones based on Max HR
  const hrZones = useMemo(() => {
    const z1Max = Math.round(maxHr * 0.60);
    const z2Max = Math.round(maxHr * 0.70);
    const z3Max = Math.round(maxHr * 0.80);
    const z4Max = Math.round(maxHr * 0.90);
    const z5Max = maxHr;

    return [
      {
        id: 'z1',
        key: 'KB',
        name: 'KB – Kompensation & Regeneration',
        sub: '< 60% HFmax',
        min: 0,
        max: z1Max,
        color: '#3b82f6',
        desc: 'Sehr leichte Intensität. Aktive Regeneration, Aufwärmen, Ausrollen.',
        benefit: 'Beschleunigt den Laktatabbau und fördert die Durchblutung ohne Ermüdung.'
      },
      {
        id: 'z2',
        key: 'GA1',
        name: 'GA1 – Grundlagenausdauer 1',
        sub: '60% – 70% HFmax',
        min: z1Max + 1,
        max: z2Max,
        color: '#10b981',
        desc: 'Klassisches Grundlagentraining mit maximaler Fettstoffwechsel-Verbrennung.',
        benefit: 'Steigert Mitochondriendichte, Kapillarisierung und Fettverbrennung.'
      },
      {
        id: 'z3',
        key: 'GA2',
        name: 'GA2 – Grundlagenausdauer 2',
        sub: '70% – 80% HFmax',
        min: z2Max + 1,
        max: z3Max,
        color: '#eab308',
        desc: 'Aerob-anaerober Übergangsbereich. Kontrolliert vertiefte Atmung.',
        benefit: 'Erhöht das Reisetempo und verbessert die Glykogenspeicherung.'
      },
      {
        id: 'z4',
        key: 'EB',
        name: 'EB – Entwicklungsbereich',
        sub: '80% – 90% HFmax',
        min: z3Max + 1,
        max: z4Max,
        color: '#f97316',
        desc: 'Intensives Schwellentraining nahe der anaeroben Schwelle (Lactate Threshold).',
        benefit: 'Verschiebt die Schwellenleistung nach oben und erhöht die Laktattoleranz.'
      },
      {
        id: 'z5',
        key: 'SB',
        name: 'SB – Spitzenbereich',
        sub: '90% – 100% HFmax',
        min: z4Max + 1,
        max: z5Max,
        color: '#ef4444',
        desc: 'Maximale Belastung (HIIT, VO2max-Intervalle, Finalsprints).',
        benefit: 'Maximiert die Sauerstoffaufnahme (VO2max) und anaerobe Kapazität.'
      }
    ];
  }, [maxHr]);

  // Define Coggan 7 Power Zones based on FTP
  const powerZones = useMemo(() => {
    return [
      {
        id: 'pz1',
        name: 'Z1 – Aktive Erholung',
        sub: '< 55% FTP',
        min: 0,
        max: Math.round(ftp * 0.55),
        color: '#94a3b8',
        desc: 'Sehr leichtes Kurbeln / Beine ausschütteln.',
        benefit: 'Regeneration nach Intervallen oder Etappen.'
      },
      {
        id: 'pz2',
        name: 'Z2 – Ausdauer (Endurance)',
        sub: '55% – 75% FTP',
        min: Math.round(ftp * 0.55) + 1,
        max: Math.round(ftp * 0.75),
        color: '#3b82f6',
        desc: 'Gesprächstempo für mehrstündige Berg- und Alpintouren.',
        benefit: 'Erhöhung der aeroben Kapazität und Fettverbrennung.'
      },
      {
        id: 'pz3',
        name: 'Z3 – Tempo',
        sub: '75% – 90% FTP',
        min: Math.round(ftp * 0.75) + 1,
        max: Math.round(ftp * 0.90),
        color: '#10b981',
        desc: 'Zügiges Fahren, erhöhte Konzentration, tiefes Atmen.',
        benefit: 'Ökonomisierung der Muskelkontraktionen bei Renntempo.'
      },
      {
        id: 'pz4',
        name: 'Z4 – Schwellenbereich (FTP)',
        sub: '90% – 105% FTP',
        min: Math.round(ftp * 0.90) + 1,
        max: Math.round(ftp * 1.05),
        color: '#eab308',
        desc: 'Dauerhaft maximal für ca. 45–60 Minuten haltbar.',
        benefit: 'Direkte Hebung der anaeroben Schwelle (Leistungssteigerung).'
      },
      {
        id: 'pz5',
        name: 'Z5 – VO2max',
        sub: '105% – 120% FTP',
        min: Math.round(ftp * 1.05) + 1,
        max: Math.round(ftp * 1.20),
        color: '#f97316',
        desc: '3–8 Minuten Intervalle an Steilstücken.',
        benefit: 'Maximale Sauerstoffaufnahme und Herzschlagvolumen.'
      },
      {
        id: 'pz6',
        name: 'Z6 – Anaerobe Kapazität',
        sub: '120% – 150% FTP',
        min: Math.round(ftp * 1.20) + 1,
        max: Math.round(ftp * 1.50),
        color: '#ef4444',
        desc: '30s bis 2 Minuten Vollgas.',
        benefit: 'Laktattoleranz und anaerobe Glykolyse.'
      },
      {
        id: 'pz7',
        name: 'Z7 – Neuromuskuläre Kraft',
        sub: '> 150% FTP',
        min: Math.round(ftp * 1.50) + 1,
        max: 999,
        color: '#9333ea',
        desc: 'Maximale Sprintantritte (< 15 Sekunden).',
        benefit: 'Schnellkraft und Rekrutierung schneller Muskelfasern.'
      }
    ];
  }, [ftp]);

  // Compute time spent in each HR Zone
  const hrDistribution = useMemo(() => {
    const points = track.points || [];
    const totalDurationSec = track.duration || Math.max(1800, (track.distance / 22) * 3600);
    const zoneSeconds = [0, 0, 0, 0, 0];

    if (hasRealHr) {
      let validCount = 0;
      for (let i = 0; i < points.length; i++) {
        const hr = points[i].hr;
        if (hr && hr > 30) {
          validCount++;
          if (hr <= hrZones[0].max) zoneSeconds[0]++;
          else if (hr <= hrZones[1].max) zoneSeconds[1]++;
          else if (hr <= hrZones[2].max) zoneSeconds[2]++;
          else if (hr <= hrZones[3].max) zoneSeconds[3]++;
          else zoneSeconds[4]++;
        }
      }
      if (validCount > 0) {
        // Normalize to total duration
        const factor = totalDurationSec / validCount;
        for (let j = 0; j < 5; j++) {
          zoneSeconds[j] = Math.round(zoneSeconds[j] * factor);
        }
      }
    } else {
      // Realistic simulation based on elevation gain & distance
      const ascent = track.ascent || 500;
      const climbIntensity = Math.min(1.0, ascent / 1500);
      zoneSeconds[0] = Math.round(totalDurationSec * (0.20 - climbIntensity * 0.08)); // KB
      zoneSeconds[1] = Math.round(totalDurationSec * (0.45 - climbIntensity * 0.10)); // GA1
      zoneSeconds[2] = Math.round(totalDurationSec * (0.22 + climbIntensity * 0.06)); // GA2
      zoneSeconds[3] = Math.round(totalDurationSec * (0.10 + climbIntensity * 0.08)); // EB
      zoneSeconds[4] = Math.max(0, totalDurationSec - (zoneSeconds[0] + zoneSeconds[1] + zoneSeconds[2] + zoneSeconds[3])); // SB
    }

    const totalCalculated = Math.max(1, zoneSeconds.reduce((a, b) => a + b, 0));
    return hrZones.map((z, idx) => {
      const secs = zoneSeconds[idx];
      const pct = Math.round((secs / totalCalculated) * 100);
      const mins = Math.floor(secs / 60);
      const hours = Math.floor(mins / 60);
      const remainMins = mins % 60;
      const timeStr = hours > 0 ? `${hours}h ${remainMins}m` : `${remainMins} min`;

      return {
        ...z,
        seconds: secs,
        percent: pct,
        timeStr
      };
    });
  }, [track, hasRealHr, hrZones]);

  // Compute time spent in each Power Zone
  const powerDistribution = useMemo(() => {
    const totalDurationSec = track.duration || Math.max(1800, (track.distance / 22) * 3600);
    const points = track.points || [];
    const zoneSeconds = [0, 0, 0, 0, 0, 0, 0];

    if (hasRealPower) {
      let validCount = 0;
      for (let i = 0; i < points.length; i++) {
        const pwr = points[i].power;
        if (pwr !== undefined && pwr >= 0) {
          validCount++;
          if (pwr <= powerZones[0].max) zoneSeconds[0]++;
          else if (pwr <= powerZones[1].max) zoneSeconds[1]++;
          else if (pwr <= powerZones[2].max) zoneSeconds[2]++;
          else if (pwr <= powerZones[3].max) zoneSeconds[3]++;
          else if (pwr <= powerZones[4].max) zoneSeconds[4]++;
          else if (pwr <= powerZones[5].max) zoneSeconds[5]++;
          else zoneSeconds[6]++;
        }
      }
      if (validCount > 0) {
        const factor = totalDurationSec / validCount;
        for (let j = 0; j < 7; j++) {
          zoneSeconds[j] = Math.round(zoneSeconds[j] * factor);
        }
      }
    } else {
      // Standard endurance ride model
      zoneSeconds[0] = Math.round(totalDurationSec * 0.18); // Z1
      zoneSeconds[1] = Math.round(totalDurationSec * 0.46); // Z2
      zoneSeconds[2] = Math.round(totalDurationSec * 0.20); // Z3
      zoneSeconds[3] = Math.round(totalDurationSec * 0.10); // Z4
      zoneSeconds[4] = Math.round(totalDurationSec * 0.04); // Z5
      zoneSeconds[5] = Math.round(totalDurationSec * 0.015); // Z6
      zoneSeconds[6] = Math.max(0, totalDurationSec - zoneSeconds.slice(0, 6).reduce((a, b) => a + b, 0)); // Z7
    }

    const totalCalc = Math.max(1, zoneSeconds.reduce((a, b) => a + b, 0));
    return powerZones.map((z, idx) => {
      const secs = zoneSeconds[idx];
      const pct = Math.round((secs / totalCalc) * 100);
      const mins = Math.floor(secs / 60);
      const hours = Math.floor(mins / 60);
      const remainMins = mins % 60;
      const timeStr = hours > 0 ? `${hours}h ${remainMins}m` : `${remainMins} min`;

      return {
        ...z,
        seconds: secs,
        percent: pct,
        timeStr
      };
    });
  }, [track, hasRealPower, powerZones]);

  return (
    <div className="space-y-6">
      {/* Sub-Header / Toggle & Parameters */}
      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700/80 pb-3">
          <div className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-rose-500 fill-rose-500 animate-pulse" />
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Trainingszonen & Physiologische Belastung
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {hasRealHr ? 'Exakte Auswertung aus aufgezeichneten Herzfrequenz-Sensordaten' : 'Modellierte physiologische Zonenverteilung für deine Route'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => { setZoneView('hr'); triggerHaptic('light'); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                zoneView === 'hr'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Heart className="w-3.5 h-3.5" />
              Puls-Zonen (5 Zonen)
            </button>
            <button
              type="button"
              onClick={() => { setZoneView('power'); triggerHaptic('light'); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                zoneView === 'power'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Watt-Zonen (Coggan 7 Zonen)
            </button>
          </div>
        </div>

        {/* Live Adjusters for Max HR & FTP */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="space-y-1.5 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <Heart className="w-3.5 h-3.5 text-rose-500" />
                Maximale Herzfrequenz (HFmax):
              </span>
              <span className="font-mono text-rose-600 dark:text-rose-400 font-black">{maxHr} bpm</span>
            </div>
            <input
              type="range"
              min={140}
              max={220}
              step={1}
              value={maxHr}
              onChange={(e) => setMaxHr(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-500"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>140 bpm</span>
              <span>Faustformel: 220 - Alter</span>
              <span>220 bpm</span>
            </div>
          </div>

          <div className="space-y-1.5 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                Schwellenleistung (FTP):
              </span>
              <span className="font-mono text-amber-600 dark:text-amber-400 font-black">{ftp} Watt</span>
            </div>
            <input
              type="range"
              min={100}
              max={500}
              step={5}
              value={ftp}
              onChange={(e) => setFtp(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>100 Watt</span>
              <span>1-Stunden Maximalleistung</span>
              <span>500 Watt</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Zones Visualizer */}
      {zoneView === 'hr' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              5-Zonen Herzfrequenz-Verteilung
            </h4>
            <span className="text-xs text-slate-400 font-medium">
              Aerobe Basis (GA1+GA2): <strong className="text-emerald-600 dark:text-emerald-400 font-mono">
                {(hrDistribution[1].percent + hrDistribution[2].percent)}%
              </strong>
            </span>
          </div>

          <div className="space-y-2.5">
            {hrDistribution.map((zone) => (
              <div 
                key={zone.id}
                className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span 
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: zone.color }}
                    />
                    <div>
                      <span className="font-bold text-xs text-slate-800 dark:text-slate-100 block">
                        {zone.name}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {zone.sub} • {zone.min} bis {zone.max} bpm
                      </span>
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    <span className="text-sm font-black text-slate-800 dark:text-slate-100">
                      {zone.timeStr}
                    </span>
                    <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                      {zone.percent}%
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(2, zone.percent)}%`, backgroundColor: zone.color }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                  <span>{zone.desc}</span>
                  <span className="italic text-[10px] text-slate-400 shrink-0 ml-2">{zone.benefit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Coggan 7-Zonen Watt-Verteilung (FTP: {ftp}W)
            </h4>
            <span className="text-xs text-slate-400 font-medium">
              Ausdaueranteil (Z1–Z3): <strong className="text-indigo-600 dark:text-indigo-400 font-mono">
                {(powerDistribution[0].percent + powerDistribution[1].percent + powerDistribution[2].percent)}%
              </strong>
            </span>
          </div>

          <div className="space-y-2.5">
            {powerDistribution.map((zone) => (
              <div 
                key={zone.id}
                className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span 
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: zone.color }}
                    />
                    <div>
                      <span className="font-bold text-xs text-slate-800 dark:text-slate-100 block">
                        {zone.name}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {zone.sub} • {zone.min} bis {zone.max === 999 ? '∞' : `${zone.max} W`}
                      </span>
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    <span className="text-sm font-black text-slate-800 dark:text-slate-100">
                      {zone.timeStr}
                    </span>
                    <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                      {zone.percent}%
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(2, zone.percent)}%`, backgroundColor: zone.color }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                  <span>{zone.desc}</span>
                  <span className="italic text-[10px] text-slate-400 shrink-0 ml-2">{zone.benefit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
