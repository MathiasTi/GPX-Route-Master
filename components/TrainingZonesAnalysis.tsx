import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Heart, Clock, AlertCircle, Sparkles, TrendingUp, BarChart2, Check, RefreshCw, Layers, ShieldAlert, Award, Activity, Info, Zap, Gauge, Flame } from 'lucide-react';
import { GPXTrack, GPXPoint } from '../types';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area } from 'recharts';
import { HeartRateZones } from './HeartRateZones';
import { HistoricalHeartRateZones } from './HistoricalHeartRateZones';
import {
  calculateActivityPowerDistribution,
  calculateCyclingPowerZones,
  calculateRunningPowerZones,
  calculateRunningPaceZones,
  formatSecondsToPace
} from '../domain/training/powerZones';

export interface HRZoneConfig {
  key: 'KB' | 'GA1' | 'GA2' | 'EB' | 'SB';
  name: string;
  fullName: string;
  min: number;
  max: number;
  color: string;
  desc: string;
  benefit: string;
}

interface TrainingZonesAnalysisProps {
  tracks: GPXTrack[];
  activeTrackId: string | null;
  onClose: () => void;
  userMaxHr: number;
  onMaxHrChange: (maxHr: number) => void;
}

const DEFAULT_HR_ZONES: HRZoneConfig[] = [
  {
    key: 'KB',
    name: 'KB',
    fullName: 'KB – Kompensationsbereich (Erholung)',
    min: 96,
    max: 112,
    color: '#3b82f6', // blue
    desc: 'Aktive Erholung, sehr geringe Intensität. Dient dem lockeren Ausrollen, Aufwärmen oder der aktiven Erholung nach harten Einheiten.',
    benefit: 'Fördert die Regeneration und beschleunigt den Abbau von Stoffwechselnebenprodukten.'
  },
  {
    key: 'GA1',
    name: 'GA1',
    fullName: 'GA1 – Grundlagenausdauer 1',
    min: 112,
    max: 136,
    color: '#10b981', // green
    desc: 'Klassisches Ausdauertraining im aeroben Bereich mit sehr hohem Fettstoffwechselanteil.',
    benefit: 'Verbessert die aerobe Grundausdauer, ökonomisiert die Herzarbeit und stärkt das Immunsystem.'
  },
  {
    key: 'GA2',
    name: 'GA2',
    fullName: 'GA2 – Grundlagenausdauer 2',
    min: 136,
    max: 152,
    color: '#eab308', // amber
    desc: 'Mischbereich aus aerobem und anaerobem Stoffwechsel. Höhere Intensität mit kontrolliert vertiefter Atmung.',
    benefit: 'Steigert das spezifische Renntempo und verbessert die Glykogenspeicherung in den Muskeln.'
  },
  {
    key: 'EB',
    name: 'EB',
    fullName: 'EB – Entwicklungsbereich',
    min: 152,
    max: 168,
    color: '#f97316', // orange
    desc: 'Intensives Training nahe der individuellen anaeroben Schwelle. Die Laktatbildung hält sich gerade noch die Waage.',
    benefit: 'Verschiebt die anaerobe Schwelle nach oben, verbessert die Kraftausdauer und Laktattoleranz.'
  },
  {
    key: 'SB',
    name: 'SB',
    fullName: 'SB – Spitzenbereich',
    min: 168,
    max: 170,
    color: '#ef4444', // red
    desc: 'Maximale Belastung (Hochintensives Intervalltraining - HIIT). Rein laktazides bzw. anaerobes Milieu.',
    benefit: 'Maximiert die VO2max, die neuromuskuläre Rekrutierung und die anaerobe Leistungsfähigkeit.'
  }
];

export const TrainingZonesAnalysis: React.FC<TrainingZonesAnalysisProps> = ({
  tracks,
  activeTrackId,
  onClose,
  userMaxHr,
  onMaxHrChange
}) => {
  // Try to load custom training zones from localStorage, otherwise use default
  const [zones, setZones] = useState<HRZoneConfig[]>(() => {
    try {
      const saved = localStorage.getItem('velo_hr_zones');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {}
    return DEFAULT_HR_ZONES;
  });

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(activeTrackId);
  const [activityOverride, setActivityOverride] = useState<'cycling' | 'running' | null>(null);

  const currentTrack = useMemo(() => {
    return tracks.find(t => t.id === selectedTrackId) || null;
  }, [tracks, selectedTrackId]);

  // Dynamically synchronize activityType based on the loaded track
  useEffect(() => {
    if (currentTrack?.activityType) {
      setActivityOverride(currentTrack.activityType);
    } else if (currentTrack) {
      setActivityOverride('cycling');
    }
  }, [currentTrack?.id, currentTrack?.activityType]);

  const effectiveActivityType = activityOverride || currentTrack?.activityType || 'cycling';
  const isRunning = effectiveActivityType === 'running';
  const isDetectedFromTrack = currentTrack?.activityType ? activityOverride === currentTrack.activityType : true;

  const [activeAnalysisTab, setActiveAnalysisTab] = useState<'hr' | 'power' | 'dual'>('hr');

  const [isSimulationMode, setIsSimulationMode] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [modalActiveTab, setModalActiveTab] = useState<'comparison' | 'drift' | 'historical'>('comparison');
  
  // Cycling FTP
  const [userFtp, setUserFtp] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('velo_user_ftp');
      if (saved) return parseInt(saved, 10);
    } catch (e) {}
    return 250; // default standard FTP in Watts
  });

  const handleFtpChange = (val: number) => {
    setUserFtp(val);
    try {
      localStorage.setItem('velo_user_ftp', val.toString());
    } catch (e) {}
  };

  // Running Critical Power / Running FTP (rFTPw)
  const [userRunningFtp, setUserRunningFtp] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('velo_user_running_ftp');
      if (saved) return parseInt(saved, 10);
    } catch (e) {}
    return 280; // default standard running FTP / Critical Power in Watts
  });

  const handleRunningFtpChange = (val: number) => {
    setUserRunningFtp(val);
    try {
      localStorage.setItem('velo_user_running_ftp', val.toString());
    } catch (e) {}
  };

  // Running Threshold Pace (seconds per km)
  const [userThresholdPace, setUserThresholdPace] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('velo_threshold_pace');
      if (saved) return parseInt(saved, 10);
    } catch (e) {}
    return 270; // 4:30 min/km in seconds
  });

  const handleThresholdPaceChange = (val: number) => {
    setUserThresholdPace(val);
    try {
      localStorage.setItem('velo_threshold_pace', val.toString());
    } catch (e) {}
  };

  const formatPace = (seconds: number) => {
    return formatSecondsToPace(seconds);
  };

  // Compute domain power distribution dynamically based on sport modality
  const powerAnalysis = useMemo(() => {
    if (!currentTrack || !currentTrack.points || currentTrack.points.length === 0) {
      return null;
    }
    const res = calculateActivityPowerDistribution({
      points: currentTrack.points,
      activityType: effectiveActivityType,
      cyclingFtpWatts: userFtp,
      runningFtpWatts: userRunningFtp,
      thresholdPaceSecPerKm: userThresholdPace,
      trackDurationSec: currentTrack.duration
    });
    return res.success ? res.data : null;
  }, [currentTrack, effectiveActivityType, userFtp, userRunningFtp, userThresholdPace]);

  // Precalculated domain models for reference ladders
  const cyclingPowerZonesList = useMemo(() => {
    const res = calculateCyclingPowerZones(userFtp);
    return res.success ? res.data : [];
  }, [userFtp]);

  const runningPowerZonesList = useMemo(() => {
    const res = calculateRunningPowerZones(userRunningFtp);
    return res.success ? res.data : [];
  }, [userRunningFtp]);

  const runningPaceZonesList = useMemo(() => {
    const res = calculateRunningPaceZones(userThresholdPace);
    return res.success ? res.data : [];
  }, [userThresholdPace]);

  const [selectedCorrLevel, setSelectedCorrLevel] = useState<number>(2);

  const correlationZones = useMemo(() => {
    if (isRunning) {
      return [
        {
          level: 1,
          name: 'Regeneration / Recom',
          hrName: 'Z1 Erholung',
          hrPct: '< 60% HFmax',
          powerName: 'Vance Z1 Recom (<80% rFTPw)',
          powerPct: '> 125% Schwellenzeit',
          color: '#3b82f6', // blue
          bgColor: 'bg-blue-50/40 border-blue-100/60',
          activeBgColor: 'bg-blue-100/60 border-blue-300',
          badgeColor: 'bg-blue-100 text-blue-800 border-blue-200',
          minHr: Math.round(userMaxHr * 0.50),
          maxHr: Math.round(userMaxHr * 0.60),
          minPower: 0,
          maxPower: Math.round(userRunningFtp * 0.80),
          paceStr: `> ${formatSecondsToPace(userThresholdPace * 1.25)}`,
          desc: 'Sehr lockeres Traben, Gehen oder Auslaufen nach Wettkämpfen und harten Einheiten.',
          feeling: 'Federnder Schritt, flüssiges Sprechen in ganzen Sätzen, absolut anstrengungsfrei.',
          energy: 'Lipolyse (Fettstoffwechsel) > 95%, extrem geringe Kohlenhydratverbrennung.',
          duration: '20 - 45 Minuten',
          metabolicEffect: 'Fördert die kapillare Durchblutung und beschleunigt die muskuläre Erholung bei minimaler Gelenkbelastung.'
        },
        {
          level: 2,
          name: 'Lockerer Dauerlauf (GA1)',
          hrName: 'Z2 GA1',
          hrPct: '60% - 70% HFmax',
          powerName: 'Vance Z2 Endurance (81-89% rFTPw)',
          powerPct: '115% - 125% Schwellenzeit',
          color: '#10b981', // emerald
          bgColor: 'bg-emerald-50/40 border-emerald-100/60',
          activeBgColor: 'bg-emerald-100/60 border-emerald-300',
          badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
          minHr: Math.round(userMaxHr * 0.60),
          maxHr: Math.round(userMaxHr * 0.70),
          minPower: Math.round(userRunningFtp * 0.80) + 1,
          maxPower: Math.round(userRunningFtp * 0.89),
          paceStr: `${formatSecondsToPace(userThresholdPace * 1.25)} - ${formatSecondsToPace(userThresholdPace * 1.15)}`,
          desc: 'Das unverzichtbare aerobe Fundament (75-80% des gesamten Laufpensums).',
          feeling: 'Sprechen in vollständigen Sätzen flüssig und durchgehend möglich. Angenehmer Laufrhythmus.',
          energy: 'Lipolyse (Fettstoffwechsel) ~ 80%, Glykolyse (Kohlenhydrate) ~ 20%.',
          duration: '45 Min. - 2.5 Stunden',
          metabolicEffect: 'Vergrößert Mitochondrien-Volumen, Kapillarisierung und Sehnenstabilität gegen Aufprallkräfte.'
        },
        {
          level: 3,
          name: 'Tempodauerlauf / GA2',
          hrName: 'Z3 GA2',
          hrPct: '70% - 80% HFmax',
          powerName: 'Vance Z3 Threshold (90-100% rFTPw)',
          powerPct: '105% - 115% Schwellenzeit',
          color: '#eab308', // amber
          bgColor: 'bg-amber-50/40 border-amber-100/60',
          activeBgColor: 'bg-amber-100/60 border-amber-300',
          badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
          minHr: Math.round(userMaxHr * 0.70),
          maxHr: Math.round(userMaxHr * 0.80),
          minPower: Math.round(userRunningFtp * 0.89) + 1,
          maxPower: Math.round(userRunningFtp * 1.00),
          paceStr: `${formatSecondsToPace(userThresholdPace * 1.15)} - ${formatSecondsToPace(userThresholdPace * 1.05)}`,
          desc: 'Zügiges Reisetempo, Marathontempo (MRT). Kontrolliert vertiefte Atmung.',
          feeling: 'Unterhaltung nur noch in kurzen Sätzen. Hoher Fokus auf Schrittfrequenz (175–185 SPM).',
          energy: 'Ausgeglichenes Verhältnis: Fettstoffwechsel ~ 50%, Kohlenhydratverbrennung ~ 50%.',
          duration: '30 - 75 Minuten',
          metabolicEffect: 'Verbessert die aerobe Tempohärte und ökonomisiert den Glykogenverbrauch bei Renntempo.'
        },
        {
          level: 4,
          name: 'Schwellenlauf / EB',
          hrName: 'Z4 EB / Schwelle',
          hrPct: '80% - 90% HFmax',
          powerName: 'Vance Z4 Interval (101-115% rFTPw)',
          powerPct: '95% - 105% Schwellenzeit',
          color: '#f97316', // orange
          bgColor: 'bg-orange-50/40 border-orange-100/60',
          activeBgColor: 'bg-orange-100/60 border-orange-300',
          badgeColor: 'bg-orange-100 text-orange-800 border-orange-200',
          minHr: Math.round(userMaxHr * 0.80),
          maxHr: Math.round(userMaxHr * 0.90),
          minPower: Math.round(userRunningFtp * 1.00) + 1,
          maxPower: Math.round(userRunningFtp * 1.15),
          paceStr: `${formatSecondsToPace(userThresholdPace * 1.05)} - ${formatSecondsToPace(userThresholdPace * 0.95)}`,
          desc: 'Laufen an der individuellen anaeroben Schwelle (Laktat-Steady-State, 10k–Halbmarathontempo).',
          feeling: 'Brennende Waden, tiefe Atmung, Unterhaltung unmöglich. Hohe mentale Härte.',
          energy: 'Fast reine Kohlenhydratverbrennung: Glykolyse > 85%, minimale Lipolyse.',
          duration: '20 - 45 Minuten',
          metabolicEffect: 'Verschiebt das Schwellentempo nach oben und schult die laktatpuffernde Kompetenz.'
        },
        {
          level: 5,
          name: 'Intervalltempo / VO2max',
          hrName: 'Z5 SB / Spitze',
          hrPct: '90% - 100% HFmax',
          powerName: 'Vance Z5 Sprint (>115% rFTPw)',
          powerPct: '< 95% Schwellenzeit',
          color: '#ef4444', // red
          bgColor: 'bg-rose-50/40 border-rose-100/60',
          activeBgColor: 'bg-rose-100/60 border-rose-300',
          badgeColor: 'bg-rose-100 text-rose-800 border-rose-200',
          minHr: Math.round(userMaxHr * 0.90),
          maxHr: userMaxHr,
          minPower: Math.round(userRunningFtp * 1.15) + 1,
          maxPower: Math.round(userRunningFtp * 1.45),
          paceStr: `< ${formatSecondsToPace(userThresholdPace * 0.95)}`,
          desc: 'Hochintensive Bahn- oder Hügelintervalle (400m–1000m Wiederholungen) und Zielsprints.',
          feeling: 'Vollkommene Ausbelastung, extremes Hecheln, nur wenige Minuten am Stück durchhaltbar.',
          energy: '100% Anaerobe Glykolyse / energiereiche Phosphate.',
          duration: '10 - 25 Minuten (akkumulierte Intervalldauer)',
          metabolicEffect: 'Maximiert Herzminutenvolumen, Schlagvolumen und VO2max.'
        }
      ];
    }

    return [
      {
        level: 1,
        name: 'Regeneration',
        hrName: 'Z1 Erholung',
        hrPct: '50% - 60%',
        powerName: 'L1 Active Recovery',
        powerPct: '< 55%',
        color: '#3b82f6', // blue
        bgColor: 'bg-blue-50/40 border-blue-100/60',
        activeBgColor: 'bg-blue-100/60 border-blue-300',
        badgeColor: 'bg-blue-100 text-blue-800 border-blue-200',
        minHr: Math.round(userMaxHr * 0.50),
        maxHr: Math.round(userMaxHr * 0.60),
        minPower: 0,
        maxPower: Math.floor(userFtp * 0.55),
        paceStr: '',
        desc: 'Aktive Erholung, extrem lockeres Tempo. Erholung nach harten Trainingstagen.',
        feeling: 'Sehr locker, flüssiges Pedalieren ohne Kraftaufwand.',
        energy: 'Lipolyse (Fettstoffwechsel) > 95%, extrem geringe Kohlenhydratverbrennung.',
        duration: '30 - 90 Minuten',
        metabolicEffect: 'Fördert die kapillare Durchblutung und beschleunigt den Abtransport von oxidativem Stress.'
      },
      {
        level: 2,
        name: 'Fettverbrennung / Grundlage 1',
        hrName: 'Z2 GA1',
        hrPct: '60% - 70%',
        powerName: 'L2 Endurance',
        powerPct: '56% - 75%',
        color: '#10b981', // emerald
        bgColor: 'bg-emerald-50/40 border-emerald-100/60',
        activeBgColor: 'bg-emerald-100/60 border-emerald-300',
        badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
        minHr: Math.round(userMaxHr * 0.60),
        maxHr: Math.round(userMaxHr * 0.70),
        minPower: Math.floor(userFtp * 0.55) + 1,
        maxPower: Math.floor(userFtp * 0.75),
        paceStr: '',
        desc: 'Klassische Ausdauerbasis. Hervorragend zur Ökonomisierung des Herz-Kreislauf-Systems.',
        feeling: 'Sprechen in vollständigen Sätzen flüssig und durchgehend möglich.',
        energy: 'Lipolyse (Fettstoffwechsel) ~ 80%, Glykolyse (Kohlenhydrate) ~ 20%.',
        duration: '2 - 6 Stunden',
        metabolicEffect: 'Vergrößert Mitochondrien-Volumen und verbessert die aerobe Enzymkapazität.'
      },
      {
        level: 3,
        name: 'Tempotraining / Aerob-Anaerob',
        hrName: 'Z3 GA2',
        hrPct: '70% - 80%',
        powerName: 'L3 Tempo',
        powerPct: '76% - 90%',
        color: '#eab308', // amber
        bgColor: 'bg-amber-50/40 border-amber-100/60',
        activeBgColor: 'bg-amber-100/60 border-amber-300',
        badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
        minHr: Math.round(userMaxHr * 0.70),
        maxHr: Math.round(userMaxHr * 0.80),
        minPower: Math.floor(userFtp * 0.75) + 1,
        maxPower: Math.floor(userFtp * 0.90),
        paceStr: '',
        desc: 'Zügiges Reisetempo. Erhöhter Glykogenumsatz mit spürbar intensiverer Atmung.',
        feeling: 'Sprechen nur noch in kurzen Sätzen möglich. Fokus erforderlich.',
        energy: 'Ausgeglichenes Verhältnis: Fettstoffwechsel ~ 50%, Kohlenhydratverbrennung ~ 50%.',
        duration: '1.5 - 3 Stunden',
        metabolicEffect: 'Steigert die Glykogenspeicherkapazität der Arbeitsmuskulatur.'
      },
      {
        level: 4,
        name: 'Laktatschwelle / Entwicklungsbereich',
        hrName: 'Z4 EB / Schwelle',
        hrPct: '80% - 90%',
        powerName: 'L4 Threshold',
        powerPct: '91% - 105%',
        color: '#f97316', // orange
        bgColor: 'bg-orange-50/40 border-orange-100/60',
        activeBgColor: 'bg-orange-100/60 border-orange-300',
        badgeColor: 'bg-orange-100 text-orange-800 border-orange-200',
        minHr: Math.round(userMaxHr * 0.80),
        maxHr: Math.round(userMaxHr * 0.90),
        minPower: Math.floor(userFtp * 0.90) + 1,
        maxPower: Math.floor(userFtp * 1.05),
        paceStr: '',
        desc: 'Training an der individuellen anaeroben Schwelle (AnS). Laktat-Aufbau und -Abbau halten sich die Waage.',
        feeling: 'Brennende Beine, tiefe Atmung, Unterhaltung unmöglich.',
        energy: 'Fast reine Kohlenhydratverbrennung: Glykolyse > 85%, minimale Lipolyse.',
        duration: '35 - 90 Minuten',
        metabolicEffect: 'Erhöht die Laktatschwelle (FTP) und schult die laktatpuffernde Kompetenz.'
      },
      {
        level: 5,
        name: 'VO2max / Spitze',
        hrName: 'Z5 SB / Spitze',
        hrPct: '90% - 100%',
        powerName: 'L5 VO2 Max',
        powerPct: '106% - 120%',
        color: '#ef4444', // red
        bgColor: 'bg-rose-50/40 border-rose-100/60',
        activeBgColor: 'bg-rose-100/60 border-rose-300',
        badgeColor: 'bg-rose-100 text-rose-800 border-rose-200',
        minHr: Math.round(userMaxHr * 0.90),
        maxHr: userMaxHr,
        minPower: Math.floor(userFtp * 1.05) + 1,
        maxPower: Math.floor(userFtp * 1.20),
        paceStr: '',
        desc: 'Maximale aerobe Auslastung (HIIT). Reiz zur Optimierung der maximalen Sauerstoffaufnahme.',
        feeling: 'Vollkommene Ausbelastung, extremes Hecheln, nur Minuten durchhaltbar.',
        energy: '100% Anaerobe Glykolyse / energiereiche Phosphate.',
        duration: '10 - 30 Minuten (akkumulierte Intervalldauer)',
        metabolicEffect: 'Maximiert das Herzminutenvolumen, Schlagvolumen und die VO2max.'
      }
    ];
  }, [userMaxHr, userFtp, userRunningFtp, isRunning, userThresholdPace]);

  // Sync selected track if props change
  useEffect(() => {
    if (activeTrackId) {
      setSelectedTrackId(activeTrackId);
    } else if (tracks.length > 0 && !selectedTrackId) {
      setSelectedTrackId(tracks[0].id);
    }
  }, [activeTrackId, tracks]);

  // Save custom zones config
  const saveZones = (newZones: HRZoneConfig[]) => {
    setZones(newZones);
    try {
      localStorage.setItem('velo_hr_zones', JSON.stringify(newZones));
    } catch (e) {}
    setSuccessMsg('Pulsbereiche erfolgreich aktualisiert!');
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const resetZonesToDefault = () => {
    saveZones(DEFAULT_HR_ZONES);
  };

  const handleZoneLimitChange = (index: number, field: 'min' | 'max', val: number) => {
    const updated = [...zones];
    updated[index] = { ...updated[index], [field]: val };
    
    // Auto-align adjacent zones to avoid overlaps / gaps
    if (field === 'max' && index < zones.length - 1) {
      updated[index + 1] = { ...updated[index + 1], min: val };
    }
    if (field === 'min' && index > 0) {
      updated[index - 1] = { ...updated[index - 1], max: val };
    }
    
    setZones(updated);
  };

  // Check if current track has real HR data
  const hasRealHr = useMemo(() => {
    return currentTrack ? currentTrack.points.some(p => p.hr !== undefined && p.hr > 0) : false;
  }, [currentTrack]);

  const effectiveZones = useMemo(() => {
    if (isRunning) {
      return zones.map(z => ({
        ...z,
        min: z.min + 10,
        max: z.max + 10
      }));
    }
    return zones;
  }, [zones, isRunning]);

  // Turn on simulation if track does not have real HR, so the rider can still visualize physical demands
  useEffect(() => {
    if (currentTrack && !hasRealHr) {
      setIsSimulationMode(true);
    } else {
      setIsSimulationMode(false);
    }
  }, [currentTrack, hasRealHr]);

  // High-fidelity heart rate sequence generation
  const activePoints = useMemo((): GPXPoint[] => {
    if (!currentTrack) return [];
    
    if (hasRealHr && !isSimulationMode) {
      return currentTrack.points;
    }

    // SIMULATOR ENHANCEMENT
    // If no HR is defined or simulator is toggled on, synthesize a realistic heart rate curve
    // based on cumulative metabolic output, gradient, and baseline cycling rate.
    const baselineHr = 115; // standard aerobic base
    let prevHr = baselineHr;

    return currentTrack.points.map((pt, idx) => {
      // Calculate gradient based on neighbor
      let slope = 0;
      if (idx > 0) {
        const pPrev = currentTrack.points[idx - 1];
        // estimate slope
        const R = 6371;
        const dLat = (pt.lat - pPrev.lat) * Math.PI / 180;
        const dLng = (pt.lng - pPrev.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(pPrev.lat * Math.PI / 180) * Math.cos(pt.lat * Math.PI / 180) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distM = R * c * 1000;

        if (distM > 5 && pt.ele !== undefined && pPrev.ele !== undefined) {
          slope = ((pt.ele - pPrev.ele) / distM) * 100;
        }
      }

      // Add inertia to make the physiological response smooth (heart rate takes time to catch up with slope)
      let targetHr = baselineHr + (slope * 5.5);
      
      // Bound simulator between 85 and 185
      if (targetHr < 85) targetHr = 85;
      if (targetHr > 185) targetHr = 185;

      const smoothedHr = Math.round(prevHr * 0.96 + targetHr * 0.04);
      prevHr = smoothedHr;

      return {
        ...pt,
        hr: smoothedHr
      };
    });
  }, [currentTrack, hasRealHr, isSimulationMode]);

  // Time segment calculations
  const hrTimelineData = useMemo(() => {
    if (activePoints.length === 0) return [];

    let totalCumulativeDistance = 0;
    
    return activePoints.map((p, idx) => {
      if (idx > 0) {
        const pPrev = activePoints[idx - 1];
        const R = 6371;
        const dLat = (p.lat - pPrev.lat) * Math.PI / 180;
        const dLng = (p.lng - pPrev.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(pPrev.lat * Math.PI / 180) * Math.cos(p.lat * Math.PI / 180) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        totalCumulativeDistance += R * c;
      }

      return {
        dist: Number(totalCumulativeDistance.toFixed(2)),
        hr: p.hr || 0,
        ele: p.ele || 0
      };
    });
  }, [activePoints]);

  // Downsample to 200 points for graphing Recharts safety
  const timelineChartData = useMemo(() => {
    const limit = 200;
    if (hrTimelineData.length <= limit) return hrTimelineData;
    const result: typeof hrTimelineData = [];
    const step = hrTimelineData.length / limit;
    for (let i = 0; i < limit; i++) {
      const idx = Math.floor(i * step);
      if (hrTimelineData[idx]) result.push(hrTimelineData[idx]);
    }
    const last = hrTimelineData[hrTimelineData.length - 1];
    if (last && !result.includes(last)) result.push(last);
    return result;
  }, [hrTimelineData]);

  // Detailed physiological summaries & stats
  const stats = useMemo(() => {
    const hrs = activePoints.map(p => p.hr || 0).filter(h => h > 0);
    if (hrs.length === 0) {
      return {
        min: 0,
        avg: 0,
        max: 0,
        zonesDistribution: [] as { key: string; name: string; fullName: string; color: string; duration: number; percent: number }[],
        trimp: 0,
        aerobicPercent: 0,
        anaerobicPercent: 0
      };
    }

    const minHr = Math.min(...hrs);
    const maxHr = Math.max(...hrs);
    const avgHr = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);

    // Calculate duration breakdown
    let totalSecs = 0;
    const zoneSecs: Record<string, number> = {
      under: 0,
      KB: 0,
      GA1: 0,
      GA2: 0,
      EB: 0,
      SB: 0,
      above: 0
    };

    // Calculate time spacing step
    const trackDuration = currentTrack?.duration || 0;
    const stepTimeSecs = trackDuration > 0 ? (trackDuration / activePoints.length) : 6.5; // fallback 6.5s per GPX segment

    for (let i = 0; i < activePoints.length; i++) {
      const p = activePoints[i];
      const pNext = activePoints[i + 1];
      let itemDuration = stepTimeSecs;

      if (p.time && pNext?.time) {
        const diff = (pNext.time.getTime() - p.time.getTime()) / 1000;
        if (diff > 0 && diff < 120) {
          itemDuration = diff;
        }
      }

      totalSecs += itemDuration;

      const ptHr = p.hr || 0;
      if (ptHr === 0) continue;

      if (ptHr < effectiveZones[0].min) {
        zoneSecs.under += itemDuration;
      } else if (ptHr >= effectiveZones[0].min && ptHr < effectiveZones[0].max) {
        zoneSecs.KB += itemDuration;
      } else if (ptHr >= effectiveZones[1].min && ptHr < effectiveZones[1].max) {
        zoneSecs.GA1 += itemDuration;
      } else if (ptHr >= effectiveZones[2].min && ptHr < effectiveZones[2].max) {
        zoneSecs.GA2 += itemDuration;
      } else if (ptHr >= effectiveZones[3].min && ptHr < effectiveZones[3].max) {
        zoneSecs.EB += itemDuration;
      } else if (ptHr >= effectiveZones[4].min && ptHr < effectiveZones[4].max) {
        zoneSecs.SB += itemDuration;
      } else {
        zoneSecs.above += itemDuration;
      }
    }

    const activeTotalCalculatedSecs = Math.max(1, totalSecs);

    const zonesDistribution = [
      {
        key: 'Unter KB',
        name: '< KB',
        fullName: `Unter Kompensation (<${effectiveZones[0].min})`,
        color: '#64748b', // Slate
        duration: zoneSecs.under,
        percent: parseFloat(((zoneSecs.under / activeTotalCalculatedSecs) * 100).toFixed(1))
      },
      ...effectiveZones.map(z => ({
        key: z.key,
        name: z.name,
        fullName: z.fullName,
        color: z.color,
        duration: zoneSecs[z.key],
        percent: parseFloat(((zoneSecs[z.key] / activeTotalCalculatedSecs) * 100).toFixed(1))
      })),
      {
        key: 'Über SB',
        name: '> SB',
        fullName: `Extremer Spitzenbereich (>${effectiveZones[4].max})`,
        color: '#991b1b', // dark red
        duration: zoneSecs.above,
        percent: parseFloat(((zoneSecs.above / activeTotalCalculatedSecs) * 100).toFixed(1))
      }
    ];

    // Banister TRIMP calculation algorithm
    // TRIMP = Sum( D * HRr * 0.64 * exp(1.92 * HRr) )
    // Where HRr is fraction of heart rate reserve: (HR_avg - HR_rest) / (HR_max - HR_rest)
    // We can simplify this for a beautiful training impact score:
    // Zone-weighted score = Sum(mins_in_zone * multiplier)
    const totalMinutesInZones = activeTotalCalculatedSecs / 60;
    const weightedImpulse = 
      (zoneSecs.under / 60) * 1.0 +
      (zoneSecs.KB / 60) * 1.5 +
      (zoneSecs.GA1 / 60) * 2.2 +
      (zoneSecs.GA2 / 60) * 3.5 +
      (zoneSecs.EB / 60) * 5.2 +
      (zoneSecs.SB / 60) * 8.0 +
      (zoneSecs.above / 60) * 9.5;

    const fitnessImpact = Math.round(weightedImpulse);

    // Aerobic vs Anaerobic
    // KB, GA1, GA2 are aerobic. EB and SB/above are anaerobic transition and pure anaerobic.
    const aerobicSeconds = zoneSecs.under + zoneSecs.KB + zoneSecs.GA1 + zoneSecs.GA2;
    const anaerobicSeconds = zoneSecs.EB + zoneSecs.SB + zoneSecs.above;
    const aerobicPercent = Math.round((aerobicSeconds / activeTotalCalculatedSecs) * 100) || 0;
    const anaerobicPercent = Math.round((anaerobicSeconds / activeTotalCalculatedSecs) * 100) || 0;

    return {
      min: minHr,
      max: maxHr,
      avg: avgHr,
      zonesDistribution,
      trimp: fitnessImpact,
      aerobicPercent,
      anaerobicPercent
    };
  }, [activePoints, effectiveZones, currentTrack]);

  // Format seconds to readable hours/minutes/seconds
  const formatTime = (seconds: number) => {
    if (!seconds || seconds <= 0) return '0m';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.round(seconds % 60);
    
    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [onClose]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[2000] flex items-center justify-center p-2 sm:p-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] overflow-y-auto cursor-pointer"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-5xl h-[calc(100dvh-1rem)] sm:h-[90vh] flex flex-col overflow-hidden cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Ribbon */}
        <div className="bg-gradient-to-r from-red-650 via-rose-600 to-indigo-650 px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center text-white shrink-0 gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="bg-white/20 p-2 sm:p-2.5 rounded-2xl animate-pulse shrink-0">
              <Heart className="w-5 h-5 sm:w-6 sm:h-6 fill-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm sm:text-xl font-bold tracking-tight truncate">Trainingszonen &amp; Puls</h2>
                <button 
                  onClick={() => setIsInfoOpen(true)}
                  className="p-1 hover:bg-white/10 rounded-lg text-white/90 hover:text-white transition-all cursor-pointer inline-flex items-center shrink-0"
                  title="Unterschied zwischen Herzfrequenzzonen und Leistungszonen erklären"
                  id="btn-training-zones-info"
                >
                  <Info className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>
              <p className="text-[10px] sm:text-xs text-white/85 truncate hidden sm:block">Konfiguriere deine Trainingsbereiche und analysiere deine Herzarbeit</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-white/10 rounded-xl transition-all cursor-pointer shrink-0"
            title="Schließen"
            aria-label="Schließen"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Content Portal */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 bg-slate-50/20">
          
          {/* Notifications area */}
          {successMsg && (
            <motion.div 
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 px-4 py-3 rounded-2xl flex items-center gap-2 text-sm font-semibold"
            >
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{successMsg}</span>
            </motion.div>
          )}

          {/* Grid Layout: Configurator Left, Selection & Stats Right */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* Zone Configurator (Left Column) */}
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white border border-slate-150 p-6 rounded-3xl shadow-sm space-y-4">
                <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                  <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-widest flex items-center gap-2">
                    <Layers className="w-4 h-4 text-rose-500" />
                    Pulszonen Setup
                  </h3>
                  <button 
                    onClick={resetZonesToDefault}
                    className="text-[10px] text-slate-500 flex items-center gap-1 hover:text-rose-600 py-1 px-1.5 rounded-lg hover:bg-rose-50 transition-colors font-bold uppercase transition-all"
                    title="Zurücksetzen auf Standardwerte nach Ötztal Radmarathon Vorgabe"
                  >
                    <RefreshCw className="w-3 h-3" /> Standard
                  </button>
                </div>

                <p className="text-[11px] text-slate-500 leading-normal">
                  Die Trainingsbereiche steuern die Intensitätsanalyse für deine Aktivitäten. Passe die Schwellenwerte an deinen individuellen Fitnessstand an.
                </p>

                {isRunning && (
                  <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-2xl flex items-start gap-2 text-xs text-amber-950 leading-normal">
                    <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 animate-pulse" />
                    <div>
                      <p className="font-extrabold uppercase text-[9px] tracking-wide text-amber-800">Laufeinheit-Anpassung aktiv</p>
                      <p className="text-[10.5px] mt-0.5">
                        Für das Laufen wurden deine Pulszonen-Grenzwerte automatisch um <b>+10 bpm</b> angehoben (für die Analyse angewandt).
                      </p>
                    </div>
                  </div>
                )}

                {/* Vertical Zones stack with inline sliders */}
                <div className="space-y-4 pt-2">
                  {zones.map((z, idx) => (
                    <div 
                      key={z.key} 
                      className="p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800 transition-all hover:bg-slate-50/40 dark:hover:bg-slate-800/40 relative group"
                      style={{ borderLeftColor: z.color, borderLeftWidth: '5px' }}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] uppercase font-black px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: z.color }}>
                            {z.key}
                          </span>
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-100 ml-1">{z.name}</span>
                          <span className="cursor-help text-[10px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-500 font-bold px-1.5 py-0.2 rounded-full inline-block select-none relative group/info ml-1" title="Erklärung anzeigen">
                            ?
                            <div className="absolute left-1/2 bottom-[130%] -translate-x-1/2 hidden group-hover/info:flex flex-col z-50 bg-slate-900 border border-slate-800 text-white rounded-xl p-3 w-56 shadow-2xl pointer-events-none transition-all duration-200 text-left normal-case tracking-normal">
                              <span className="font-extrabold text-[10px] text-indigo-400 mb-1">Über {z.fullName}:</span>
                              <p className="text-[10px] text-slate-300 leading-snug font-medium mb-1.5">{z.desc}</p>
                              {z.benefit && (
                                <div className="text-[10px] text-emerald-400 mt-1 pt-1 border-t border-slate-800 leading-snug">
                                  <span className="font-bold block uppercase text-[8px] text-emerald-400 tracking-wider">Erwarteter Nutzen:</span>
                                  {z.benefit}
                                </div>
                              )}
                            </div>
                          </span>
                        </div>
                        <div className="text-[10px] font-mono font-extrabold text-slate-600 dark:text-slate-400">
                          {isRunning ? (
                            <span className="text-amber-600 dark:text-amber-400 font-black flex items-center gap-1" title="Erhöht für Laufeinheit (+10 Hf)">
                              <span>{z.min + 10} - {z.max + 10} bpm</span>
                              <span>🏃</span>
                            </span>
                          ) : (
                            <span>{z.min} - {z.max} Hf</span>
                          )}
                        </div>
                      </div>

                      {/* Input fields to allow pinpoint control over borders */}
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div>
                          <label className="text-[9px] font-bold text-slate-500 block">Min. Puls (bpm)</label>
                          <input 
                            type="number"
                            min="40"
                            max="220"
                            value={z.min}
                            onChange={(e) => handleZoneLimitChange(idx, 'min', Number(e.target.value))}
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-semibold w-full text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-rose-500/30 font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-slate-500 block">Max. Puls (bpm)</label>
                          <input 
                            type="number"
                            min="40"
                            max="220"
                            value={z.max}
                            onChange={(e) => handleZoneLimitChange(idx, 'max', Number(e.target.value))}
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-semibold w-full text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-rose-500/30 font-mono"
                          />
                        </div>
                      </div>
                      
                      <p className="text-[10px] text-slate-450 dark:text-slate-400 mt-1.5 leading-snug">{z.desc}</p>
                      
                      {z.benefit && (
                        <div className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800/60 text-[9.5px] text-emerald-600 dark:text-emerald-400 font-medium">
                          <span className="font-extrabold text-[8px] uppercase tracking-wider text-emerald-500 dark:text-emerald-500 mr-1">Nutzen:</span>
                          {z.benefit}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <button 
                  onClick={() => saveZones(zones)}
                  className="w-full text-center bg-rose-600 hover:bg-rose-700 text-white font-extrabold py-3 rounded-2xl text-xs shadow-md transition-colors cursor-pointer uppercase tracking-wider mt-4"
                >
                  Puls-Einstellungen speichern
                </button>
              </div>

              {/* Dynamic Power & Threshold Configuration Card */}
              <div className="bg-white border border-slate-150 p-6 rounded-3xl shadow-sm space-y-4">
                <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                  <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-widest flex items-center gap-2">
                    <Zap className="w-4 h-4 text-indigo-600" />
                    {isRunning ? 'Lauf-Leistung & Pace Setup' : 'Radsport Leistungszonen (FTP)'}
                  </h3>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700">
                    {isRunning ? 'Vance & Daniels Modell' : 'Coggan 7-Zonen'}
                  </span>
                </div>

                <p className="text-[11px] text-slate-500 leading-normal">
                  {isRunning 
                    ? 'Steuert die 5 Lauf-Leistungsstufen nach Jim Vance (Stryd-Standard) und Jack Daniels Schwellenpace-Zeiten.' 
                    : 'Steuert das Andy Coggan 7-Zonen Leistungsmodell basierend auf deiner anaeroben 60-Minuten-Schwelle.'}
                </p>

                {!isRunning ? (
                  /* Cycling FTP Configuration */
                  <div className="space-y-4 pt-1">
                    <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Functional Threshold Power (FTP)</span>
                        </label>
                        <div className="flex items-center gap-1">
                          <input 
                            type="number"
                            min="100"
                            max="500"
                            value={userFtp}
                            onChange={(e) => handleFtpChange(Math.max(100, Math.min(500, Number(e.target.value) || 250)))}
                            className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold w-16 text-right text-indigo-900 font-mono"
                          />
                          <span className="text-xs font-bold text-slate-500">W</span>
                        </div>
                      </div>
                      <input 
                        type="range"
                        min="100"
                        max="480"
                        step="5"
                        value={userFtp}
                        onChange={(e) => handleFtpChange(Number(e.target.value))}
                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                      <div className="flex justify-between text-[10px] text-slate-450 font-mono">
                        <span>100 W (Einsteiger)</span>
                        <span>{userFtp} W</span>
                        <span>480 W (Elite)</span>
                      </div>
                    </div>

                    {/* Calculated Coggan Power Zone Ladders */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                        Berechnete Coggan Watt-Bereiche:
                      </span>
                      <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto pr-1">
                        {cyclingPowerZonesList.map(z => (
                          <div 
                            key={z.key} 
                            className="flex items-center justify-between p-2 rounded-xl border border-slate-100 text-xs bg-slate-50/50"
                            style={{ borderLeftColor: z.color, borderLeftWidth: '4px' }}
                          >
                            <div>
                              <span className="font-extrabold text-slate-800 mr-1.5">{z.name}</span>
                              <span className="text-[10px] text-slate-500 font-medium">({z.minPercent}% - {z.maxPercent}% FTP)</span>
                            </div>
                            <span className="font-mono font-bold text-slate-700 text-[11px]">{z.minWatts} - {z.maxWatts} W</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Running FTP & Pace Configuration */
                  <div className="space-y-4 pt-1">
                    {/* Running Critical Power */}
                    <div className="bg-amber-50/50 p-3.5 rounded-2xl border border-amber-100 space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-amber-600" />
                          <span>Running Critical Power (rFTPw)</span>
                        </label>
                        <div className="flex items-center gap-1">
                          <input 
                            type="number"
                            min="150"
                            max="500"
                            value={userRunningFtp}
                            onChange={(e) => handleRunningFtpChange(Math.max(150, Math.min(500, Number(e.target.value) || 280)))}
                            className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold w-16 text-right text-amber-900 font-mono"
                          />
                          <span className="text-xs font-bold text-slate-500">W</span>
                        </div>
                      </div>
                      <input 
                        type="range"
                        min="150"
                        max="480"
                        step="5"
                        value={userRunningFtp}
                        onChange={(e) => handleRunningFtpChange(Number(e.target.value))}
                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
                      />
                      <div className="flex justify-between text-[10px] text-slate-450 font-mono">
                        <span>150 W</span>
                        <span>{userRunningFtp} W (Stryd-Schwelle)</span>
                        <span>480 W</span>
                      </div>
                    </div>

                    {/* Running Threshold Pace */}
                    <div className="bg-emerald-50/50 p-3.5 rounded-2xl border border-emerald-100 space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          <Gauge className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Schwellenpace (vAnS / 10k)</span>
                        </label>
                        <span className="font-mono font-bold text-emerald-800 text-xs bg-white px-2 py-0.5 rounded-md border border-slate-200">
                          {formatPace(userThresholdPace)}
                        </span>
                      </div>
                      <input 
                        type="range"
                        min="180"
                        max="420"
                        step="5"
                        value={userThresholdPace}
                        onChange={(e) => handleThresholdPaceChange(Number(e.target.value))}
                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                      />
                      <div className="flex justify-between text-[10px] text-slate-450 font-mono">
                        <span>3:00/km (Pro)</span>
                        <span>{formatPace(userThresholdPace)}</span>
                        <span>7:00/km</span>
                      </div>
                    </div>

                    {/* Calculated Running Vance Zones */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                        Jim Vance Lauf-Leistungsstufen:
                      </span>
                      <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-1">
                        {runningPowerZonesList.map(z => (
                          <div 
                            key={z.key} 
                            className="flex items-center justify-between p-2 rounded-xl border border-slate-100 text-xs bg-slate-50/50"
                            style={{ borderLeftColor: z.color, borderLeftWidth: '4px' }}
                          >
                            <div>
                              <span className="font-extrabold text-slate-800 mr-1.5">{z.name}</span>
                              <span className="text-[10px] text-slate-500 font-medium">({z.minPercent}% - {z.maxPercent}% rFTPw)</span>
                            </div>
                            <span className="font-mono font-bold text-slate-700 text-[11px]">{z.minWatts} - {z.maxWatts} W</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Analysis & Visualization (Right Column) */}
            <div className="lg:col-span-7 space-y-6">
              
              {/* Route Selector Card */}
              <div className="bg-white border border-slate-150 p-6 rounded-3xl shadow-sm space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-indigo-500" />
                      Aktivitäts-Analyse
                    </h3>
                    {currentTrack && (
                      <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border flex items-center gap-1 ${
                        isDetectedFromTrack
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        <Sparkles className="w-3 h-3" />
                        <span>{isDetectedFromTrack ? (isRunning ? 'Track: Laufen 🏃' : 'Track: Radsport 🚴') : 'Manuell geändert'}</span>
                      </span>
                    )}
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Sport Selector Toggle */}
                    <div className="flex bg-slate-100 p-0.5 rounded-xl text-[11px] font-bold">
                      <button
                        type="button"
                        onClick={() => setActivityOverride('cycling')}
                        className={`py-1 px-2.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                          !isRunning
                            ? 'bg-white text-indigo-700 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                        title="Radsport-Modus (Coggan 7-Zonen Leistungsmodell)"
                      >
                        <span>🚴</span>
                        <span>Radsport</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActivityOverride('running')}
                        className={`py-1 px-2.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                          isRunning
                            ? 'bg-white text-amber-700 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                        title="Lauf-Modus (Jim Vance Power & Daniels Pace)"
                      >
                        <span>🏃</span>
                        <span>Laufen</span>
                      </button>
                    </div>

                    <select
                      value={selectedTrackId || ''}
                      onChange={(e) => {
                        setSelectedTrackId(e.target.value || null);
                        setActivityOverride(null); // Dynamic track sync takes over
                      }}
                      className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="">-- Keine Aktivität ausgewählt --</option>
                      {tracks.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.activityType === 'running' ? '🏃' : '🚴'} {t.name} ({t.distance.toFixed(1)} km)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Sub-Tabs View Switcher */}
                {currentTrack && (
                  <div className="flex bg-slate-100 p-1 rounded-2xl text-xs font-bold w-full">
                    <button
                      type="button"
                      onClick={() => setActiveAnalysisTab('hr')}
                      className={`flex-1 py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        activeAnalysisTab === 'hr' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-100" />
                      <span>Herzfrequenz-Zonen</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveAnalysisTab('power')}
                      className={`flex-1 py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        activeAnalysisTab === 'power' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5 text-indigo-500" />
                      <span>{isRunning ? 'Lauf-Power & Pace' : 'Leistungszonen (Coggan)'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveAnalysisTab('dual')}
                      className={`flex-1 py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        activeAnalysisTab === 'dual' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <Activity className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Zonen-Dualanalyse</span>
                    </button>
                  </div>
                )}

                {currentTrack ? (
                  <div className="border-t border-slate-50 pt-4 space-y-4">
                    
                    {/* VIEW 1: HERZFREQUENZ-ZONEN */}
                    {activeAnalysisTab === 'hr' && (
                      <div className="space-y-4">
                        {/* Simulator Indicator if track doesn't have native HR */}
                        {!hasRealHr ? (
                          <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-2xl flex items-start gap-3">
                            <ShieldAlert className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-extrabold text-yellow-800 uppercase tracking-wide">Puls-Simulation aktiv</p>
                              <p className="text-[11px] text-yellow-700 leading-normal mt-0.5">
                                Diese Aktivität enthält keine nativen Pulssensor-Werte. Unser <b>intelligenter Simulator</b> hat die körperliche Beanspruchung anhand des Geländeprofils (Häufigkeit & Härte der Steigungen) hochpräzise synthetisiert.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-2xl flex items-center gap-2 text-xs font-bold text-emerald-800">
                            <Sparkles className="w-4 h-4 text-emerald-600 fill-emerald-600 animate-pulse shrink-0" />
                            <span>Reale Pulssensor-Aufzeichnungen im GPX/FIT vorhanden.</span>
                          </div>
                        )}

                        {/* Quick Stats Grid */}
                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-slate-50/50 rounded-2xl p-3 border border-slate-100 text-center">
                            <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5">Minimaler Puls</span>
                            <div className="font-mono text-base font-black text-slate-800">{stats.min} <span className="text-[10px] font-medium text-slate-500">bpm</span></div>
                          </div>
                          <div className="bg-rose-50/40 rounded-2xl p-3 border border-rose-100 text-center">
                            <span className="text-[9px] uppercase font-bold text-rose-500 block mb-0.5">Durchschnitts-Puls</span>
                            <div className="font-mono text-lg font-black text-rose-700">{stats.avg} <span className="text-[10px] font-medium text-rose-500">bpm</span></div>
                          </div>
                          <div className="bg-red-50/40 rounded-2xl p-3 border border-red-100 text-center">
                            <span className="text-[9px] uppercase font-bold text-red-500 block mb-0.5">Maximaler Puls</span>
                            <div className="font-mono text-lg font-black text-red-700">{stats.max} <span className="text-[10px] font-semibold text-slate-500">bpm</span></div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* TRIMP Card */}
                          <div className="bg-indigo-50/40 border border-indigo-100/60 rounded-2xl p-4 flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-100">
                              <TrendingUp className="w-5 h-5" />
                            </div>
                            <div>
                              <span className="text-[9px] font-black uppercase text-indigo-500 block leading-none">Fitness Belastung (TRIMP)</span>
                              <span className="text-xl font-mono font-black text-indigo-950 mt-1 block leading-tight">{stats.trimp} Pkt.</span>
                              <span className="text-[10px] text-slate-450 font-medium">Rechnet Dauer & Pulsbereiche in Trainingsaufwand um.</span>
                            </div>
                          </div>

                          {/* Aerobic split */}
                          <div className="bg-slate-50 rounded-2xl p-4 flex flex-col justify-center">
                            <div className="flex justify-between text-[11px] font-bold text-slate-600 mb-1.5">
                              <span>Aerob (Ausdauer)</span>
                              <span>Anaerob (Tempohärte)</span>
                            </div>
                            <div className="h-3.5 bg-slate-200 rounded-full overflow-hidden flex shadow-inner">
                              <div className="bg-emerald-500 h-full transition-all" style={{ width: `${stats.aerobicPercent}%` }} />
                              <div className="bg-red-500 h-full transition-all" style={{ width: `${stats.anaerobicPercent}%` }} />
                            </div>
                            <div className="flex justify-between text-[10px] font-mono font-extrabold text-slate-500 mt-1">
                              <span className="text-emerald-600">{stats.aerobicPercent}%</span>
                              <span className="text-red-600">{stats.anaerobicPercent}%</span>
                            </div>
                          </div>
                        </div>

                        {/* Chart Zone Distribution */}
                        <div>
                          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Zeitanteil pro Pulszone</h4>
                          <div className="h-56 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart
                                data={stats.zonesDistribution.filter(z => z.duration > 0 || z.key === 'KB' || z.key === 'GA1' || z.key === 'GA2' || z.key === 'EB' || z.key === 'SB')}
                                layout="vertical"
                                margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                <XAxis type="number" unit="%" tick={{ fontSize: 10, fill: '#64748b' }} stroke="#cbd5e1" />
                                <YAxis dataKey="key" type="category" tick={{ fontSize: 11, fontWeight: 'bold', fill: '#334155' }} stroke="#cbd5e1" width={75} />
                                <Tooltip
                                  formatter={(value: number, name: any, propsOnPlotKey: any) => {
                                    const payload = propsOnPlotKey.payload;
                                    return [`${value}% (${formatTime(payload.duration)})`, 'Anteil'];
                                  }}
                                  contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px' }}
                                />
                                <Bar dataKey="percent" radius={[0, 8, 8, 0]} maxBarSize={28}>
                                  {stats.zonesDistribution.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        {/* Line Chart showing heart rate profile over the route */}
                        <div>
                          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Pulsverlauf über Streckendistanz</h4>
                          <div className="h-44 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart
                                data={timelineChartData}
                                margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                              >
                                <defs>
                                  <linearGradient id="colorHr" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4}/>
                                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.01}/>
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis 
                                  dataKey="dist" 
                                  unit=" km" 
                                  tick={{ fontSize: 10, fill: '#64748b' }} 
                                  stroke="#cbd5e1"
                                />
                                <YAxis 
                                  domain={['dataMin - 10', 'dataMax + 10']} 
                                  unit=" bpm" 
                                  tick={{ fontSize: 10, fill: '#64748b' }} 
                                  stroke="#cbd5e1"
                                />
                                <Tooltip
                                  formatter={(value: any, name: any) => [`${value} bpm`, 'Herzfrequenz']}
                                  labelFormatter={(label) => `Distanz: ${label} km`}
                                  contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px' }}
                                />
                                <Area 
                                  type="monotone" 
                                  dataKey="hr" 
                                  stroke="#f43f5e" 
                                  strokeWidth={2.5}
                                  fillOpacity={1} 
                                  fill="url(#colorHr)" 
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        {/* Zone Summary text */}
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex items-start gap-3">
                          <Award className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-bold text-slate-800">Trainings-Fazit</p>
                            <p className="text-xs text-slate-500 leading-normal mt-1">
                              Bei diesem Track betrug deine Durchschnittsbelastung <span className="font-bold text-slate-700">{stats.avg} bpm</span>. 
                              {stats.aerobicPercent > 65 ? (
                                <span> Der Schwerpunkt lag im <b>aeroben Grundlagenbereich ({stats.aerobicPercent}%)</b>. Perfekt zur Steigerung der Grundlagenausdauer und Ökonomisierung deines Fettstoffwechsels (GA1/GA2). Erlaubt stundenlanges Bewegen bei stabiler Energielage.</span>
                              ) : stats.anaerobicPercent > 35 ? (
                                <span> Du hast viel Zeit im <b>anaeroben Schwellenbereich (EB &amp; SB: {stats.anaerobicPercent}%)</b> verbracht! Dieses Training schult deine Tempohärte und Laktattoleranz, benötigt jedoch ausreichende Regenerationszeit (KB) im Nachgang.</span>
                              ) : (
                                <span> Das Training wies ein <b>ausgeglichenes Verhältnis</b> zwischen aerober Grundlage und intensiven Segmenten auf. Ein idealer Allround-Reiz für {isRunning ? 'Lauf- und Ausdauer-Athleten' : 'Radmarathon-Athleten'}.</span>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Detaillierte Pulszonen-Verteilung (from HeartRateZones) */}
                        <div className="bg-white border border-slate-150 p-6 rounded-3xl shadow-sm space-y-4">
                          <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                            <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500/10" />
                            Detaillierte Pulszonen-Verteilung & Analyse
                          </h3>
                          <HeartRateZones 
                            track={currentTrack}
                            maxHr={userMaxHr}
                            onMaxHrChange={onMaxHrChange}
                            activityType={effectiveActivityType}
                          />
                        </div>
                      </div>
                    )}

                    {/* VIEW 2: LEISTUNGS- & SCHWELLENZONEN (POWER & PACE) */}
                    {activeAnalysisTab === 'power' && (
                      <div className="space-y-6">
                        {/* Power Model Identity Header */}
                        <div className={`p-4 rounded-2xl border flex items-start gap-3 ${
                          isRunning ? 'bg-amber-50/50 border-amber-200' : 'bg-indigo-50/50 border-indigo-200'
                        }`}>
                          <div className={`p-2 rounded-xl text-white shrink-0 ${isRunning ? 'bg-amber-600' : 'bg-indigo-600'}`}>
                            <Zap className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-800">
                                {isRunning ? 'Jim Vance 5-Zonen Running-Power & Daniels Pace' : 'Andy Coggan 7-Zonen Leistungsmodell'}
                              </h4>
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-white border text-slate-700">
                                {isRunning ? `rFTPw: ${userRunningFtp} W | vAnS: ${formatPace(userThresholdPace)}` : `FTP: ${userFtp} W`}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600 leading-normal mt-1">
                              {isRunning 
                                ? 'Berechnet die mechanische Laufleistung (Watt) und Pace-Korrelation. Berücksichtigt Schrittkadenz, Gravitationswiderstand und elastische Energierückgabe.' 
                                : 'Standardisiertes 7-Stufen-Modell für Radsportler. Trennt streng zwischen aerober Fettverbrennung, Schwellenbelastung (FTP) und neuromuskulären Maximalpeaks.'}
                            </p>
                          </div>
                        </div>

                        {/* Power Key Metrics Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="bg-slate-50/70 rounded-2xl p-3 border border-slate-150 text-center">
                            <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5">
                              {isRunning ? 'Ø Laufleistung' : 'Ø Leistung (Power)'}
                            </span>
                            <div className="font-mono text-base font-black text-slate-800">
                              {powerAnalysis?.avgWatts || 0} <span className="text-[10px] font-medium text-slate-500">W</span>
                            </div>
                          </div>

                          <div className="bg-indigo-50/40 rounded-2xl p-3 border border-indigo-150 text-center">
                            <span className="text-[9px] uppercase font-bold text-indigo-500 block mb-0.5">
                              {isRunning ? 'Normalisierte Pace' : 'Normalized Power (NP)'}
                            </span>
                            <div className="font-mono text-base font-black text-indigo-900">
                              {powerAnalysis?.normalizedWatts || 0} <span className="text-[10px] font-medium text-indigo-600">W</span>
                            </div>
                          </div>

                          <div className="bg-amber-50/40 rounded-2xl p-3 border border-amber-150 text-center">
                            <span className="text-[9px] uppercase font-bold text-amber-600 block mb-0.5">
                              Intensity Factor (IF)
                            </span>
                            <div className="font-mono text-base font-black text-amber-900">
                              {powerAnalysis ? powerAnalysis.intensityFactor.toFixed(2) : '0.00'}
                            </div>
                          </div>

                          <div className="bg-rose-50/40 rounded-2xl p-3 border border-rose-150 text-center">
                            <span className="text-[9px] uppercase font-bold text-rose-500 block mb-0.5">
                              {isRunning ? 'Running TSS (rTSS)' : 'Training Stress (TSS)'}
                            </span>
                            <div className="font-mono text-base font-black text-rose-900">
                              {powerAnalysis?.trainingStressScore || 0} <span className="text-[10px] font-medium text-rose-600">Pkt.</span>
                            </div>
                          </div>
                        </div>

                        {/* Power Zone Distribution BarChart */}
                        {powerAnalysis && (
                          <div>
                            <div className="flex justify-between items-center mb-2">
                              <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                                {isRunning ? 'Zeitanteil pro Lauf-Leistungsstufe (Vance)' : 'Zeitanteil pro Coggan Leistungszone'}
                              </h4>
                              <span className="text-[10px] font-mono text-slate-500">
                                Gesamt: {formatTime(powerAnalysis.zonesDistribution.reduce((acc, curr) => acc + curr.durationSec, 0))}
                              </span>
                            </div>
                            <div className="h-64 w-full">
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                  data={powerAnalysis.zonesDistribution}
                                  layout="vertical"
                                  margin={{ top: 5, right: 30, left: 15, bottom: 5 }}
                                >
                                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                  <XAxis type="number" unit="%" tick={{ fontSize: 10, fill: '#64748b' }} stroke="#cbd5e1" />
                                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fontWeight: 'bold', fill: '#334155' }} stroke="#cbd5e1" width={110} />
                                  <Tooltip
                                    formatter={(value: number, name: any, propsOnPlotKey: any) => {
                                      const payload = propsOnPlotKey.payload;
                                      return [
                                        `${value}% (${formatTime(payload.durationSec)}) • Bereich: ${payload.rangeFormatted}`,
                                        'Zeitanteil'
                                      ];
                                    }}
                                    contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px' }}
                                  />
                                  <Bar dataKey="percent" radius={[0, 8, 8, 0]} maxBarSize={24}>
                                    {powerAnalysis.zonesDistribution.map((entry, index) => (
                                      <Cell key={`pcell-${index}`} fill={entry.color} />
                                    ))}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}

                        {/* Detailed Power Zone Formulas Table / Cards */}
                        <div className="space-y-3">
                          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-indigo-500" />
                            <span>Angewandte Leistungsformeln &amp; Physiologische Wirkung</span>
                          </h4>
                          
                          <div className="grid grid-cols-1 gap-2">
                            {isRunning ? (
                              /* Running Vance Zones */
                              runningPowerZonesList.map(z => (
                                <div 
                                  key={z.key} 
                                  className="p-3.5 rounded-2xl border border-slate-100 bg-white hover:bg-slate-50/70 transition-all space-y-1.5"
                                  style={{ borderLeftColor: z.color, borderLeftWidth: '5px' }}
                                >
                                  <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded text-white" style={{ backgroundColor: z.color }}>
                                        {z.key}
                                      </span>
                                      <span className="text-xs font-bold text-slate-800">{z.name}</span>
                                      <span className="text-[10px] font-mono bg-amber-50 text-amber-800 px-2 py-0.5 rounded-md font-semibold border border-amber-200">
                                        Formel: {z.minPercent}% - {z.maxPercent}% rFTPw
                                      </span>
                                    </div>
                                    <span className="font-mono font-black text-xs text-slate-800">{z.minWatts} - {z.maxWatts} W</span>
                                  </div>
                                  <p className="text-[11px] text-slate-600 leading-snug">{z.desc}</p>
                                  <div className="flex flex-wrap items-center gap-3 pt-1 text-[10px] text-slate-500 font-medium">
                                    <span><b>Fokus:</b> {z.benefit}</span>
                                    <span>•</span>
                                    <span><b>Energiesystem:</b> {z.energySystem}</span>
                                    <span>•</span>
                                    <span><b>Dauer:</b> {z.recommendedDuration}</span>
                                  </div>
                                </div>
                              ))
                            ) : (
                              /* Cycling Coggan Zones */
                              cyclingPowerZonesList.map(z => (
                                <div 
                                  key={z.key} 
                                  className="p-3.5 rounded-2xl border border-slate-100 bg-white hover:bg-slate-50/70 transition-all space-y-1.5"
                                  style={{ borderLeftColor: z.color, borderLeftWidth: '5px' }}
                                >
                                  <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded text-white" style={{ backgroundColor: z.color }}>
                                        {z.key}
                                      </span>
                                      <span className="text-xs font-bold text-slate-800">{z.name}</span>
                                      <span className="text-[10px] font-mono bg-indigo-50 text-indigo-800 px-2 py-0.5 rounded-md font-semibold border border-indigo-200">
                                        Formel: {z.minPercent}% - {z.maxPercent}% FTP
                                      </span>
                                    </div>
                                    <span className="font-mono font-black text-xs text-slate-800">{z.minWatts} - {z.maxWatts} W</span>
                                  </div>
                                  <p className="text-[11px] text-slate-600 leading-snug">{z.desc}</p>
                                  <div className="flex flex-wrap items-center gap-3 pt-1 text-[10px] text-slate-500 font-medium">
                                    <span><b>Physiologie:</b> {z.benefit}</span>
                                    <span>•</span>
                                    <span><b>Energiesystem:</b> {z.energySystem}</span>
                                    <span>•</span>
                                    <span><b>Dauer:</b> {z.recommendedDuration}</span>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                      </div>
                    )}

                    {/* VIEW 3: DUAL-ANALYSE & KORRELATION */}
                    {activeAnalysisTab === 'dual' && (
                      <div className="space-y-6">
                        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-150 space-y-2">
                          <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-800 flex items-center gap-2">
                            <Activity className="w-4 h-4 text-emerald-600" />
                            Physiologische vs. Mechanische Belastung
                          </h4>
                          <p className="text-[11px] text-slate-600 leading-relaxed">
                            Die Gegenüberstellung zeigt das Zusammenspiel zwischen <b>innerer Belastung (Herzfrequenz)</b> und <b>äußerer Leistung ({isRunning ? 'Lauf-Power & Pace' : 'Watt'})</b>. 
                            Klicke auf eine Stufe, um Details zur Energiebereitstellung zu sehen.
                          </p>
                        </div>

                        {/* Interactive Ladder */}
                        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
                          {correlationZones.map((z) => {
                            const isSelected = selectedCorrLevel === z.level;
                            return (
                              <button
                                key={z.level}
                                type="button"
                                onClick={() => setSelectedCorrLevel(z.level)}
                                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                                  isSelected 
                                    ? `${z.activeBgColor} shadow-md ring-2 ring-indigo-500/20 scale-[1.02]` 
                                    : `${z.bgColor} hover:bg-slate-50/80 hover:border-slate-300`
                                }`}
                              >
                                <div>
                                  <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border uppercase inline-block mb-1.5 ${z.badgeColor}`}>
                                    Stufe {z.level}
                                  </span>
                                  <h4 className="text-xs font-bold text-slate-800 leading-tight mb-1">{z.name}</h4>
                                  <div className="text-[10px] font-mono text-rose-600 font-bold mb-0.5">
                                    ❤️ {z.hrName} ({z.hrPct})
                                  </div>
                                  <div className="text-[10px] font-mono text-indigo-700 font-bold">
                                    ⚡ {isRunning ? z.paceStr : `${z.minPower} - ${z.maxPower} W`}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {/* Selected Zone Deep Dive */}
                        {correlationZones.find(z => z.level === selectedCorrLevel) && (() => {
                          const activeZ = correlationZones.find(z => z.level === selectedCorrLevel)!;
                          return (
                            <div className="bg-white border border-slate-150 p-5 rounded-3xl shadow-sm space-y-4">
                              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                                <div className="flex items-center gap-2">
                                  <span className={`text-xs font-black px-2.5 py-1 rounded-xl border uppercase ${activeZ.badgeColor}`}>
                                    Stufe {activeZ.level}: {activeZ.name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 text-xs font-mono font-bold">
                                  <span className="text-rose-600">HF: {activeZ.minHr} - {activeZ.maxHr} bpm</span>
                                  <span className="text-indigo-600">{isRunning ? `Pace: ${activeZ.paceStr}` : `Power: ${activeZ.minPower} - ${activeZ.maxPower} W`}</span>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                                <div className="p-3 bg-slate-50 rounded-2xl space-y-1">
                                  <span className="font-bold text-slate-700 block">Körpergefühl &amp; Atmung:</span>
                                  <p className="text-slate-600 text-[11px] leading-relaxed">{activeZ.feeling}</p>
                                </div>
                                <div className="p-3 bg-slate-50 rounded-2xl space-y-1">
                                  <span className="font-bold text-slate-700 block">Energiebereitstellung:</span>
                                  <p className="text-slate-600 text-[11px] leading-relaxed">{activeZ.energy}</p>
                                </div>
                              </div>

                              <div className="p-3 bg-emerald-50/50 border border-emerald-100 rounded-2xl text-[11px] text-emerald-900 leading-normal">
                                <span className="font-bold block uppercase text-[9px] text-emerald-700 tracking-wider mb-0.5">Metabolischer Anpassungsreiz:</span>
                                {activeZ.metabolicEffect}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                  </div>
                ) : (
                  <div className="py-20 text-center flex flex-col items-center justify-center space-y-3 bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
                    <Heart className="w-12 h-12 text-slate-300 animate-pulse" />
                    <div>
                      <p className="text-sm font-extrabold text-slate-700">Keine Aktivität geladen</p>
                      <p className="text-xs text-slate-450 max-w-sm mx-auto mt-1">
                        Wähle oben eine GPX- oder FIT-Aktivität aus, um die Herzfrequenz- und Leistungszonen im Detail zu berechnen.
                      </p>
                    </div>
                  </div>
                )}
              </div>

            </div>

          </div>

        </div>

        {/* Footer actions */}
        <div className="bg-slate-50 border-t border-slate-200/60 px-6 py-4 flex justify-between items-center shrink-0 rounded-b-3xl">
          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase">
            <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
            Ötztal Cycle Engine v2.0
          </div>
          <button
            onClick={onClose}
            className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold px-6 py-2 rounded-xl text-xs transition-colors cursor-pointer uppercase"
          >
            Schließen
          </button>
        </div>

        {/* Info Modal */}
        <AnimatePresence>
          {isInfoOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-[2100] flex items-center justify-center p-3 sm:p-6 cursor-pointer"
              id="modal-training-zones-info-overlay"
              onClick={() => setIsInfoOpen(false)}
            >
              <motion.div 
                initial={{ scale: 0.95, y: 15 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 15 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-3xl border border-slate-100 shadow-2xl max-w-4xl w-full max-h-[calc(100dvh-2rem)] sm:max-h-[90vh] overflow-y-auto p-4 sm:p-8 relative text-left cursor-default"
                id="modal-training-zones-info"
              >
                {/* Decorative background gradients */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-rose-200/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-200/10 rounded-full blur-3xl -ml-20 -mb-20 pointer-events-none" />

                <button 
                  onClick={() => setIsInfoOpen(false)}
                  className="absolute top-3 right-3 sm:top-4 sm:right-4 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all cursor-pointer z-50"
                  id="btn-training-zones-info-close"
                  title="Schließen"
                  aria-label="Schließen"
                >
                  <X className="w-5 h-5" />
                </button>

                <div className="space-y-6 relative z-10">
                  
                  {/* Header */}
                  <div className="flex items-center gap-3">
                    <div className="bg-indigo-50 p-2.5 rounded-2xl">
                      <Sparkles className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="text-xl font-extrabold text-slate-800 tracking-tight">
                        Physiologischer &amp; Mechanischer Zonen-Zusammenhang
                      </h3>
                      <p className="text-xs text-slate-500 font-medium">Interaktive Korrelation von Herzfrequenz- (Puls) und Leistungsbereichen (ftp-relative Watt)</p>
                    </div>
                  </div>

                  {/* Dynamic Athlete Parameters Configuration */}
                  <div className="bg-slate-50 border border-slate-150 p-4 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Sportart &amp; Athletenparameter</span>
                      <div className="flex bg-slate-200/70 p-0.5 rounded-xl text-[11px] font-bold">
                        <button
                          type="button"
                          onClick={() => setActivityOverride('cycling')}
                          className={`py-1 px-2.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                            !isRunning
                              ? 'bg-white text-indigo-700 shadow-xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <span>🚴</span>
                          <span>Radsport</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActivityOverride('running')}
                          className={`py-1 px-2.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                            isRunning
                              ? 'bg-white text-amber-700 shadow-xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <span>🏃</span>
                          <span>Laufen</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 border-t border-slate-200/60">
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-slate-700 flex items-center gap-1.5">
                            <Heart className="w-4 h-4 text-rose-500 fill-rose-100" />
                            Maximalpuls (Max HR)
                          </span>
                          <span className="font-mono font-black text-rose-600">{userMaxHr} bpm</span>
                        </div>
                        <input 
                          type="range"
                          min={130}
                          max={220}
                          value={userMaxHr}
                          onChange={(e) => onMaxHrChange(Number(e.target.value))}
                          className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-rose-500"
                        />
                        <p className="text-[10px] text-slate-450 italic">Bestimmt deine physiologischen Belastungsgrenzen</p>
                      </div>

                      {!isRunning ? (
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-slate-700 flex items-center gap-1.5">
                              <Activity className="w-4 h-4 text-indigo-500" />
                              FTP-Schwellenwert (Watt)
                            </span>
                            <span className="font-mono font-black text-indigo-600">{userFtp} W</span>
                          </div>
                          <input 
                            type="range"
                            min={100}
                            max={500}
                            value={userFtp}
                            onChange={(e) => handleFtpChange(Number(e.target.value))}
                            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                          />
                          <p className="text-[10px] text-slate-450 italic">Bestimmt deine mechanische Schwellenleistung (Functional Threshold Power)</p>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-slate-700 flex items-center gap-1.5">
                              <Activity className="w-4 h-4 text-amber-500" />
                              Schwellenpace (vAnS / 10k Tempo)
                            </span>
                            <span className="font-mono font-black text-amber-600">{formatPace(userThresholdPace)}</span>
                          </div>
                          <input 
                            type="range"
                            min={180}
                            max={420}
                            step={5}
                            value={userThresholdPace}
                            onChange={(e) => handleThresholdPaceChange(Number(e.target.value))}
                            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-500"
                          />
                          <p className="text-[10px] text-slate-450 italic">Deine Schwellengeschwindigkeit für anaerobe Laktat-Gleichgewichte</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Navigation Tabs */}
                  <div className="flex border-b border-slate-100 space-x-2 overflow-x-auto scrollbar-none">
                    <button
                      onClick={() => setModalActiveTab('comparison')}
                      className={`pb-2.5 px-3 md:px-4 text-xs font-bold transition-all cursor-pointer whitespace-nowrap border-b-2 ${
                        modalActiveTab === 'comparison'
                          ? 'border-indigo-600 text-indigo-600'
                          : 'border-transparent text-slate-450 hover:text-slate-650'
                      }`}
                    >
                      Zonen Gegenüberstellung (Live)
                    </button>
                    <button
                      onClick={() => setModalActiveTab('drift')}
                      className={`pb-2.5 px-3 md:px-4 text-xs font-bold transition-all cursor-pointer whitespace-nowrap border-b-2 ${
                        modalActiveTab === 'drift'
                          ? 'border-indigo-600 text-indigo-600'
                          : 'border-transparent text-slate-450 hover:text-slate-650'
                      }`}
                    >
                      Kardiovaskulärer Drift (Decoupling)
                    </button>
                    <button
                      onClick={() => setModalActiveTab('historical')}
                      className={`pb-2.5 px-3 md:px-4 text-xs font-bold transition-all cursor-pointer whitespace-nowrap border-b-2 ${
                        modalActiveTab === 'historical'
                          ? 'border-indigo-600 text-indigo-600'
                          : 'border-transparent text-slate-450 hover:text-slate-650'
                      }`}
                    >
                      Historische Pulszonen (Multi-Aktivität)
                    </button>
                  </div>

                  {/* TAB 1: Comparison Matrix */}
                  {modalActiveTab === 'comparison' && (
                    <div className="space-y-6">
                      <div className="text-xs text-slate-600 leading-relaxed">
                        Die folgende Grafik stellt deine 5 kardiologischen Hauptzonen direkt deinen mechanischen Leistungsbereichen gegenüber. 
                        <strong> Klicke auf ein Zonenpaar</strong>, um die genauen metabolischen Vorgänge, Energieträgernutzungen sowie Trainingsempfehlungen einzusehen.
                      </div>

                      {/* Visual Grid Comparison Bar and Ladders */}
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-3" id="zones-comparison-ladder">
                        {correlationZones.map((z) => {
                          const isSelected = selectedCorrLevel === z.level;
                          return (
                            <button
                              key={z.level}
                              onClick={() => setSelectedCorrLevel(z.level)}
                              className={`p-3.5 rounded-2xl border text-left transition-all duration-300 relative overflow-hidden cursor-pointer flex flex-col justify-between ${
                                isSelected 
                                  ? `${z.activeBgColor} shadow-md ring-2 ring-indigo-500/10 scale-[1.02]` 
                                  : `${z.bgColor} hover:bg-slate-50/80 hover:border-slate-300`
                              }`}
                            >
                              {/* Left colored border stripe */}
                              <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: z.color }} />

                              <div className="pl-1.5 space-y-2">
                                <span className="text-[10px] font-black tracking-wider uppercase opacity-80 block text-slate-500">Stufe {z.level}</span>
                                <h4 className="text-xs font-black text-slate-800 leading-tight truncate">{z.name}</h4>
                                
                                <div className="space-y-1 pt-1 border-t border-slate-100">
                                  <div className="flex items-center justify-between text-[10px] font-medium text-slate-500">
                                    <span>Puls:</span>
                                    <span className="font-bold text-rose-600 font-mono">{z.minHr}-{z.maxHr} bpm</span>
                                  </div>
                                  <div className="flex items-center justify-between text-[10px] font-medium text-slate-500">
                                    <span>{isRunning ? 'Pace:' : 'Watt:'}</span>
                                    <span className="font-bold text-indigo-600 font-mono">
                                      {isRunning ? z.paceStr : `${z.minPower}-${z.maxPower} W`}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Interactive Detail Panel */}
                      {(() => {
                        const activeDetails = correlationZones.find(z => z.level === selectedCorrLevel);
                        if (!activeDetails) return null;
                        return (
                          <motion.div 
                            key={selectedCorrLevel}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-slate-50/60 border border-slate-200/80 rounded-2xl p-5 md:p-6 space-y-4"
                          >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-150">
                              <div className="flex items-center gap-2">
                                <span className="w-3.5 h-3.5 rounded-md shrink-0" style={{ backgroundColor: activeDetails.color }} />
                                <h4 className="font-extrabold text-sm text-slate-800">
                                  Level {activeDetails.level} Detailanalyse: {activeDetails.name}
                                </h4>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <span className="px-2.5 py-1 text-[9px] font-bold rounded-lg bg-rose-50 border border-rose-100 text-rose-700">
                                  Pulsbereich: {activeDetails.hrName} ({activeDetails.hrPct})
                                </span>
                                <span className="px-2.5 py-1 text-[9px] font-bold rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700">
                                  {isRunning ? 'Pace-Bereich' : 'Leistungsbereich'}: {activeDetails.powerName} ({activeDetails.powerPct})
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                              <div className="space-y-3">
                                <div>
                                  <h5 className="font-bold text-slate-700">Allgemeine Definition &amp; Reiz</h5>
                                  <p className="text-[11px] text-slate-600 leading-normal mt-0.5">{activeDetails.desc}</p>
                                </div>
                                <div>
                                  <h5 className="font-bold text-slate-700">Substratnutzung (Energiebereitstellung)</h5>
                                  <p className="text-[11px] text-slate-600 font-medium leading-normal mt-0.5 capitalize">{activeDetails.energy}</p>
                                </div>
                                <div>
                                  <h5 className="font-bold text-slate-700">Zellulärer Trainingseffekt</h5>
                                  <p className="text-[11px] text-slate-500 leading-normal mt-0.5">{activeDetails.metabolicEffect}</p>
                                </div>
                              </div>

                              <div className="bg-white border border-slate-100 rounded-xl p-4 space-y-3">
                                <div>
                                  <h5 className="font-bold text-slate-700 flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                    Subjektives Belastungsgefühl (RPE-Skala)
                                  </h5>
                                  <p className="text-[11px] text-slate-600 mt-0.5 italic">"{activeDetails.feeling}"</p>
                                </div>
                                <div>
                                  <h5 className="font-bold text-slate-700 flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                    Effektive Belastungsdauer
                                  </h5>
                                  <p className="text-[11px] text-slate-600 mt-0.5 font-semibold font-mono">{activeDetails.duration}</p>
                                </div>
                                <div className="bg-slate-50/50 p-2.5 rounded-lg border border-dashed border-slate-200">
                                  <p className="text-[10px] text-slate-500 leading-tight">
                                    <strong>Praxis-Tipp:</strong> {isRunning 
                                      ? 'Bei hügeligem Terrain schwankt die Pace drastisch. Orientiere dich bergauf vorrangig an deiner Herzfrequenz und halte die Schrittfrequenz hoch (175–185 SPM).' 
                                      : 'Pulszonen hinken der Leistung hinterher. Bei Antritten stabilisiert sich der Puls erst nach zirka 45s. Verwende bei Intervallen unter 2 Min. ausschließlich Watt-Zielwerte.'
                                    }
                                  </p>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })()}
                    </div>
                  )}

                  {/* TAB 2: Cardiovascular Drift Chart & Explanation */}
                  {modalActiveTab === 'drift' && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 text-indigo-700 font-extrabold text-sm">
                            <TrendingUp className="w-4 h-4 text-indigo-600" />
                            {isRunning ? 'Kopplungs-Verlust beim Dauerlauf (Pa:Hr)' : 'Kopplungs-Verlust & Aerobic Decoupling (Pw:Hr)'}
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed">
                            {isRunning ? (
                              <>Obwohl Puls- und Pace-Bereiche im ausgeruhten Zustand eng gekoppelt sind, trennen sich beide Werte bei langen Läufen ab 60–90 Minuten. Dieses Phänomen heißt <strong>Kardiovaskulärer Drift (Cardiac Drift)</strong>.</>
                            ) : (
                              <>Obwohl Puls- und Leistungszonen perfekt mathematisch korrelieren, trennen sich beide Werte bei langen Belastungen (ab 90 Minuten). Dieses Phänomen heißt <strong>Kardiovaskulärer Drift (Cardiac Drift)</strong>.</>
                            )}
                          </p>
                          <p className="text-xs text-slate-500 leading-relaxed">
                            {isRunning ? (
                              <>Durch Schwitzen verliert der Körper Blutplasmawasser, was das Schlagvolumen verringert. Um die gleiche Sauerstoffmenge zur Beinmuskulatur zu pumpen, <strong>muss das Herz bei identischer konstanter Laufpace spürbar schneller schlagen</strong>.</>
                            ) : (
                              <>Durch Schwitzen verlierst du Plasmawasser, was dein Blut verdickt. Um das sinkende Schlagvolumen pro Herzschlag zu kompensieren, <strong>muss dein Herz bei absolut GLEICHER konstanter Tretleistung (Watt) deutlich schneller schlagen</strong>.</>
                            )}
                          </p>
                          <div className="p-3 bg-indigo-50 border border-indigo-150 rounded-xl">
                            <span className="font-bold text-[10px] text-indigo-800 uppercase block mb-1">Entkopplungsfaktor (Drift)</span>
                            <p className="text-[10px] text-slate-600 leading-normal text-left">
                              Ein gut trainierter Fettstoffwechsel hält den Drift auf einem 90- bis 120-minütigen Training unter <strong>5%</strong>. Ein höherer Wert deutet auf Dehydrierung, unzureichende Kohlenhydratzufuhr oder Überhitzung hin.
                            </p>
                          </div>
                        </div>

                        {/* Interactive Recharts visual simulation of cardiac drift over steady session */}
                        <div className="bg-slate-50 border border-slate-150 p-4 rounded-2xl relative">
                          <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-wider text-center mb-3">
                            {isRunning ? 'Simulation: Drift über 90 Minuten Dauerlauf' : 'Simulation: Drift over 120 Minutes steady ride'}
                          </h4>
                          
                          <div className="h-44 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart
                                data={isRunning ? [
                                  { min: 0, power: 12, hr: 135 },
                                  { min: 10, power: 12, hr: 138 },
                                  { min: 20, power: 12, hr: 141 },
                                  { min: 30, power: 12, hr: 143 },
                                  { min: 45, power: 12, hr: 147 },
                                  { min: 60, power: 12, hr: 152 },
                                  { min: 75, power: 12, hr: 157 },
                                  { min: 90, power: 12, hr: 161 },
                                ] : [
                                  { min: 0, power: 175, hr: 130 },
                                  { min: 10, power: 175, hr: 131 },
                                  { min: 20, power: 175, hr: 133 },
                                  { min: 30, power: 175, hr: 134 },
                                  { min: 40, power: 175, hr: 136 },
                                  { min: 50, power: 175, hr: 138 },
                                  { min: 65, power: 175, hr: 141 },
                                  { min: 80, power: 175, hr: 143 },
                                  { min: 95, power: 175, hr: 146 },
                                  { min: 110, power: 175, hr: 149 },
                                  { min: 120, power: 175, hr: 152 },
                                ]}
                                margin={{ top: 5, right: 5, left: 0, bottom: 5 }}
                              >
                                <defs>
                                  <linearGradient id="driftPowerGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15}/>
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.01}/>
                                  </linearGradient>
                                  <linearGradient id="driftHrGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.25}/>
                                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.03}/>
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="min" fontSize={8} stroke="#94a3b8" unit=" min" />
                                <YAxis yAxisId="power" domain={isRunning ? [8, 16] : [100, 220]} fontSize={8} stroke="#6366f1" width={24} label={{ value: isRunning ? 'km/h' : 'Watts', angle: -90, position: 'insideLeft', style: {fontSize: 7, fill: '#6366f1'} }} />
                                <YAxis yAxisId="hr" orientation="right" domain={[110, 180]} fontSize={8} stroke="#f43f5e" width={22} label={{ value: 'BPM', angle: 90, position: 'insideRight', style: {fontSize: 7, fill: '#f43f5e'} }} />
                                <Tooltip 
                                  contentStyle={{ fontSize: '9px', borderRadius: '12px', border: '1px solid #e2e8f0' }} 
                                  labelFormatter={(label) => `${label} Minuten`}
                                />
                                <Area 
                                  yAxisId="power"
                                  type="monotone" 
                                  dataKey="power" 
                                  stroke="#6366f1" 
                                  strokeWidth={2}
                                  name={isRunning ? 'Laufgeschwindigkeit (km/h)' : 'Tretleistung (Power)'}
                                  fillOpacity={1} 
                                  fill="url(#driftPowerGrad)" 
                                />
                                <Area 
                                  yAxisId="hr"
                                  type="monotone" 
                                  dataKey="hr" 
                                  stroke="#f43f5e" 
                                  strokeWidth={2.5}
                                  name="Herzfrequenz (Puls)"
                                  fillOpacity={1} 
                                  fill="url(#driftHrGrad)" 
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                          
                          <div className="flex justify-center gap-4 mt-1 text-[9px] font-bold">
                            <span className="flex items-center gap-1 text-indigo-600">
                              <span className="w-2 h-1 bg-indigo-500 rounded-sm inline-block" />
                              {isRunning ? 'Laufpace (Konstant 5:00/km)' : 'Leistung (Konstant 175W)'}
                            </span>
                            <span className="flex items-center gap-1 text-rose-600">
                              <span className="w-2 h-1 bg-rose-500 rounded-sm inline-block animate-pulse" />
                              Herzfrequenz (+17% Drift)
                            </span>
                          </div>
                        </div>

                      </div>
                    </div>
                  )}

                  {/* TAB 3: Historical Heart Rate Zones */}
                  {modalActiveTab === 'historical' && (
                    <div className="space-y-6">
                      <HistoricalHeartRateZones 
                        tracks={tracks}
                        maxHr={userMaxHr}
                        userFtp={userFtp}
                      />
                    </div>
                  )}

                  {/* Summary Callout Footer */}
                  <div className="bg-slate-50 border border-slate-150 p-4 rounded-xl text-xs text-slate-600 leading-relaxed" id="summary-zones-explanation">
                    <strong>Das Zusammenspiel:</strong> Herzfrequenz ist das <em>Einspeisungssignal (physiologische interne Belastung)</em>, während {isRunning ? 'Tempo & Schrittfrequenz die mechanische externe Fortbewegungsleistung' : 'Watt die mechanische externe Triebarbeit'} darstellen. Nur in Kombination beider Werte lässt sich die reale Effizienz deines Körpers akkurat analysieren und steuern.
                  </div>

                  {/* Action */}
                  <div className="flex justify-end pt-2">
                    <button 
                      onClick={() => setIsInfoOpen(false)}
                      className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl tracking-wide shadow-sm hover:shadow transition-all cursor-pointer uppercase"
                      id="btn-training-zones-info-acknowledge"
                    >
                      Verstanden &amp; Sparen
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </motion.div>
  );
};
