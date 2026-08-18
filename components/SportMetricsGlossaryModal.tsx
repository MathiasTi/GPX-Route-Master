import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Search, 
  BookOpen, 
  Mountain, 
  Zap, 
  TrendingUp, 
  Heart, 
  Activity, 
  Flame, 
  Calculator, 
  ChevronRight, 
  Sparkles, 
  Info, 
  Compass, 
  Award, 
  ArrowUpRight, 
  Scale, 
  Check, 
  Copy,
  RotateCcw,
  Sliders,
  HelpCircle
} from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';

export type MetricCategory = 'all' | 'climbing' | 'power' | 'training_load' | 'cardio' | 'efficiency' | 'nutrition';

export interface GlossaryMetric {
  id: string;
  name: string;
  shortName: string;
  category: 'climbing' | 'power' | 'training_load' | 'cardio' | 'efficiency' | 'nutrition';
  badgeColor: string;
  definition: string;
  formula?: string;
  unit: string;
  origin?: string;
  interpretation: {
    good: string;
    warning?: string;
    pro?: string;
  };
  benchmarks: { label: string; value: string; desc: string }[];
  practicalTips: string[];
  tags: string[];
}

export const GLOSSARY_METRICS: GlossaryMetric[] = [
  // --- CLIMBING & SLOPE ---
  {
    id: 'vam',
    name: 'Velocità Ascensionale Media',
    shortName: 'VAM',
    category: 'climbing',
    badgeColor: 'purple',
    definition: 'Die mittlere vertikale Steiggeschwindigkeit in Höhenmetern pro Stunde (m/h). Entwickelt vom italienischen Sportwissenschaftler Dr. Michele Ferrari, dient sie als universeller Gradmesser für die reine Kletterleistung an Pässen und Steigungen.',
    formula: 'VAM (m/h) = (Höhengewinn in m / Kletterzeit in Sekunden) × 3600',
    unit: 'm/h (Höhenmeter pro Stunde)',
    origin: 'Dr. Michele Ferrari (1990er Jahre)',
    interpretation: {
      good: '900 – 1.200 m/h für ambitionierte Amateure und Gran-Fondo-Fahrer an 7–10 % Steigung.',
      warning: '< 500 m/h an steilen Rampen deutet auf Trittfrequenzprobleme oder Überlastung hin.',
      pro: '1.600 – 1.850 m/h bei Profis an Monumentalanstiegen (z.B. Alpe d\'Huez, Stelvio).'
    },
    benchmarks: [
      { label: 'Hobby / Einsteiger', value: '400 – 700 m/h', desc: 'Grundlegendes Klettern auf Genusstouren' },
      { label: 'Ambitionierter Amateur', value: '900 – 1.250 m/h', desc: 'Top-Platzierungen bei Jedermann-Rennen / Gran Fondos' },
      { label: 'WorldTour Profi', value: '1.500 – 1.800+ m/h', desc: 'Attacken auf Tour de France Bergetappen' }
    ],
    practicalTips: [
      'VAM ist stark steigungsabhängig: An 10 % Steigung ist die VAM deutlich höher als an 4 % (da weniger Leistung gegen Luftwiderstand verloren geht).',
      'Verwende VAM primär für Anstiege mit mindestens 5–7 % konstanter Steigung und über 10 Minuten Dauer.',
      'Aus der VAM lässt sich näherungsweise die relative Leistung berechnen: W/kg ≈ VAM / (200 + 10 × Steigung in %).'
    ],
    tags: ['Klettern', 'Höhenmeter', 'Steigrate', 'Bergpass', 'Alpe d\'Huez', 'VAM']
  },
  {
    id: 'climb_category',
    name: 'Bergwertungs-Kategorien (HC / Kat 1–4)',
    shortName: 'Climb Cat (HC–4)',
    category: 'climbing',
    badgeColor: 'rose',
    definition: 'Offizielle Einstufung von Anstiegen basierend auf der UCI / Tour de France Methodik. Die Klassifizierung gewichtet Kletterdistanz, kumulierte Höhenmeter und die durchschnittliche prozentuale Steigung mathematisch.',
    formula: 'Climb-Score = Höhenmeter (m) × Steigung (%) × √(Distanz in km)',
    unit: 'Kategorie (HC, 1, 2, 3, 4)',
    origin: 'Tour de France / UCI Standard',
    interpretation: {
      good: 'Kat 3–4 für welliges Training, Kat 1–2 für Bergfahrten, HC für Hochgebirgspässe.',
      warning: 'HC-Anstiege erfordern gezieltes Pacing unterhalb der FTP zur Vermeidung des "Hungerastes".',
      pro: 'HC-Pässe verlangen von Profis 40–80 Minuten bei 5,5–6,2 W/kg Dauerleistung.'
    },
    benchmarks: [
      { label: 'Kategorie 4', value: 'Score < 20', desc: 'Kurze Wellen (z.B. 1,5 km @ 5 %, +75 Hm)' },
      { label: 'Kategorie 3', value: 'Score 20 – 49', desc: 'Typische Mittelgebirgsanstiege (z.B. 4 km @ 6 %, +240 Hm)' },
      { label: 'Kategorie 2', value: 'Score 50 – 119', desc: 'Spürbare Pässe (z.B. 8 km @ 6 %, +480 Hm)' },
      { label: 'Kategorie 1', value: 'Score 120 – 199', desc: 'Schwere Alpenpässe (z.B. 12 km @ 7,5 %, +900 Hm)' },
      { label: 'Hors Catégorie (HC)', value: 'Score ≥ 200', desc: 'Monumentalanstiege (z.B. Alpe d\'Huez, Stelvio, Mont Ventoux)' }
    ],
    practicalTips: [
      'Ein HC-Anstieg kann auch kürzer sein, wenn die Durchschnittssteigung extrem steil ist (> 12 %).',
      'Teile schwere Anstiege mental in 3 Abschnitte: Start 5 % unter Schwellenleistung, Mitte konstant, Finale nach Tagesform.'
    ],
    tags: ['Bergwertung', 'HC', 'Kategorie 1', 'Steigung', 'Pässe', 'Tour de France']
  },
  {
    id: 'gradient',
    name: 'Momentane & Durchschnittliche Steigung',
    shortName: 'Steigung (%)',
    category: 'climbing',
    badgeColor: 'amber',
    definition: 'Das Verhältnis von vertikalem Höhengewinn zur horizontalen Distanz entlang der Erdoberfläche in Prozent. 100 % entspricht einem Winkel von 45 Grad (100 m Höhe auf 100 m Horizontaldistanz).',
    formula: 'Steigung (%) = (ΔHöhe / ΔDistanz) × 100',
    unit: '% (Prozent)',
    origin: 'Geodäsie / Straßenbau-Normung',
    interpretation: {
      good: '3–6 % ideales Tempotraining im Sitzen.',
      warning: '> 14 % verlangt angepasste Übersetzung (z.B. 34/32 oder 34/34) um Knieüberlastungen zu meiden.',
      pro: 'An 20 %+ Steilrampen schalten Profis in den Wiegetritt und nutzen Körperschwerpunkt-Verlagerung.'
    },
    benchmarks: [
      { label: 'Flach / Leicht', value: '0 – 3 %', desc: 'Hohe Geschwindigkeiten, aero-relevant' },
      { label: 'Mäßig', value: '4 – 7 %', desc: 'Klassischer Rhythmus-Anstieg' },
      { label: 'Steil', value: '8 – 13 %', desc: 'Hoher Drehmomentbedarf, Schwerkraft dominiert' },
      { label: 'Extrem-Rampe', value: '≥ 14 %', desc: 'Körperschwerpunkt nach vorne, Wiegetritt erforderlich' }
    ],
    practicalTips: [
      'Bei Steigungen über 8 % sinkt der Luftwiderstandsanteil auf unter 10 %; das Systemgewicht (Fahrer + Rad) wird zum dominierenden Faktor.',
      'Achte an steilen Rampen auf eine Trittfrequenz von mindestens 70–75 rpm, um Laktatanhäufung in den Oberschenkeln zu verlangsamen.'
    ],
    tags: ['Steigung', 'Gradient', 'Slope', 'Gefälle', 'Höhenprofil']
  },

  // --- POWER & PACING ---
  {
    id: 'ftp',
    name: 'Functional Threshold Power',
    shortName: 'FTP',
    category: 'power',
    badgeColor: 'amber',
    definition: 'Die höchste durchschnittliche mechanische Leistung in Watt, die ein Athlet über einen Zeitraum von rund 60 Minuten im Zustand eines metabolischen Gleichgewichts (Laktat-Steady-State) aufrechterhalten kann.',
    formula: 'FTP ≈ 95 % der durchschnittlichen 20-Minuten-Bestleistung (20-Min-Test)',
    unit: 'Watt (W) bzw. Watt/kg (W/kg)',
    origin: 'Dr. Andrew Coggan & Hunter Allen',
    interpretation: {
      good: '3,0 – 4,0 W/kg für fitte Hobby- & Amateursportler.',
      warning: 'FTP überschätzt? Wenn Schwellenintervalle (z.B. 3×10 min @ 100%) nicht durchgehalten werden können.',
      pro: '5,8 – 6,6 W/kg bei Grand-Tour-Siegern (z.B. Pogačar, Vingegaard).'
    },
    benchmarks: [
      { label: 'Gelegenheitsfahrer', value: '1,8 – 2,5 W/kg', desc: '150 – 200 W bei 80 kg' },
      { label: 'Trainierter Amateur', value: '3,2 – 4,2 W/kg', desc: '240 – 315 W bei 75 kg' },
      { label: 'Elite / A-Klasse', value: '4,5 – 5,3 W/kg', desc: '320 – 370 W bei 70 kg' },
      { label: 'WorldTour Kletterspezialist', value: '5,8 – 6,5 W/kg', desc: '380 – 430 W bei 65 kg' }
    ],
    practicalTips: [
      'Die FTP bildet das Fundament für alle Coggan-Trainingszonen (Z1 bis Z7) sowie für TSS- und IF-Berechnungen.',
      'Wiederhole FTP-Tests alle 6–8 Wochen oder passe den Wert an, wenn deine Herzfrequenz bei Schwelleneinheiten signifikant sinkt.'
    ],
    tags: ['FTP', 'Watt', 'Schwellenleistung', 'Coggan', 'Leistungsmesser', 'W/kg']
  },
  {
    id: 'np',
    name: 'Normalized Power',
    shortName: 'NP',
    category: 'power',
    badgeColor: 'blue',
    definition: 'Ein mathematisches Modell, das die physiologischen Kosten ungleichmäßiger Belastung erfasst. Da kurze harte Antritte exponentiell mehr Laktat und Glykogen verbrauchen als gleichmäßiges Fahren, berechnet NP einen gewichteten 4.-Potenz-Mittelwert über ein 30-Sekunden-Gleitfenster.',
    formula: 'NP = ⁴√[ Mittelwert( (30s gleitender Watt-Durchschnitt)⁴ ) ]',
    unit: 'Watt (W)',
    origin: 'Dr. Andrew Coggan',
    interpretation: {
      good: 'NP liegt bei gleichmäßigem Zeitfahren sehr nah an der Avg Power (NP/AvgP ≈ 1.02).',
      warning: 'Bei Kriterien oder Fahrten mit vielen Ampelstopps ist NP 15–25 % höher als Avg Power.',
      pro: 'Profis nutzen NP, um das wahre physiologische Belastungsmaß von hügeligen Klassikern zu quantifizieren.'
    },
    benchmarks: [
      { label: 'Perfektes Zeitfahren', value: 'NP ≈ Avg Power + 2%', desc: 'Nahezu perfekte Kraftdosierung' },
      { label: 'Hügeliges Solotraining', value: 'NP ≈ Avg Power + 6–10%', desc: 'Normale Schwankungen an kurzen Anstiegen' },
      { label: 'Kriterium / Gruppenrennen', value: 'NP ≈ Avg Power + 15–25%', desc: 'Extremer Erschöpfungsfaktor durch Kurvenantritte' }
    ],
    practicalTips: [
      'Nutze NP immer dann zur Energie- und Belastungsanalyse, wenn das Profil nicht absolut bretteben war.',
      'Normalized Power erfordert mindestens 20 Minuten kontinuierliche Aufzeichnung, um mathematisch valide zu sein.'
    ],
    tags: ['Normalized Power', 'NP', 'Coggan', 'Leistungsanalyse', 'Watt']
  },
  {
    id: 'if',
    name: 'Intensity Factor',
    shortName: 'IF',
    category: 'power',
    badgeColor: 'indigo',
    definition: 'Das Verhältnis der Normalized Power (NP) zur Functional Threshold Power (FTP). Der Intensity Factor beschreibt, wie intensiv eine Trainingseinheit oder ein Wettkampf relativ zur maximalen Schwellenleistungsfähigkeit des Athleten war.',
    formula: 'IF = Normalized Power (NP) / Functional Threshold Power (FTP)',
    unit: 'Dezimalzahl (dimensionslos)',
    origin: 'Dr. Andrew Coggan',
    interpretation: {
      good: 'IF 0,65 – 0,75 für lange Grundlagenausdauer (Zone 2).',
      warning: 'IF > 1,05 über 60 Minuten bedeutet, dass die hinterlegte FTP zu niedrig eingestellt ist.',
      pro: 'Olympisches Zeitfahren: IF 1,00 – 1,05 über 45–60 Minuten.'
    },
    benchmarks: [
      { label: 'Regeneration (Z1)', value: 'IF < 0,75', desc: 'Aktive Erholung ohne messbare Ermüdung' },
      { label: 'Grundlagenausdauer (Z2)', value: 'IF 0,75 – 0,85', desc: 'Lange Fahrten (3–6 Stunden)' },
      { label: 'Tempo / SweetSpot (Z3/Z4)', value: 'IF 0,85 – 0,95', desc: 'Intensive Trainingseinheiten (1,5–3 Stunden)' },
      { label: 'Schwellen-Rennen / TT', value: 'IF 0,95 – 1,05', desc: 'Maximale All-Out Belastung (45–60 min)' },
      { label: 'Kriterium / Bahn', value: 'IF > 1,05', desc: 'Kurze, extrem explosive Wettkämpfe (< 45 min)' }
    ],
    practicalTips: [
      'Ein IF von 0,80 fühlt sich in der ersten Stunde leicht an, führt aber nach 4 Stunden zu starker muskulärer Erschöpfung.',
      'Kombiniere IF mit TSS, um die Gesamtbelastung einer Ausfahrt präzise zu steuern.'
    ],
    tags: ['Intensity Factor', 'IF', 'Intensität', 'Trainingssteuerung', 'FTP']
  },
  {
    id: 'vi',
    name: 'Variability Index',
    shortName: 'VI',
    category: 'power',
    badgeColor: 'cyan',
    definition: 'Das Verhältnis von Normalized Power (NP) zur einfachen Durchschnittsleistung (Average Power). Der VI misst die Gleichmäßigkeit (Pacing-Effizienz) einer Fahrt.',
    formula: 'VI = Normalized Power (NP) / Average Power (Avg Power)',
    unit: 'Dezimalzahl (z.B. 1.03)',
    origin: 'TrainingPeaks / Coggan',
    interpretation: {
      good: 'VI ≤ 1,05 für Zeitfahren, Triathlons und flache Langstrecken.',
      warning: 'VI > 1,20 im Solotraining deutet auf unökonomisches Pacing (Überpacen an Bergen) hin.',
      pro: 'Bei Kriterien ist ein hoher VI (> 1,25) renntaktisch unvermeidbar.'
    },
    benchmarks: [
      { label: 'Zeitfahren / Ironman', value: '1,00 – 1,05', desc: 'Perfektes Pacing für maximale aerobe Effizienz' },
      { label: 'Hügeliger Gran Fondo', value: '1,06 – 1,12', desc: 'Gute Tempodosierung an Pässen' },
      { label: 'Straßenrennen / MTB', value: '1,15 – 1,30+', desc: 'Aggressives Renngeschehen mit harten Attacken' }
    ],
    practicalTips: [
      'Im Zeitfahren oder Triathlon kostet jeder Antritt mit VI > 1,08 wertvolle Glykogenreserven für den Laufsplit.',
      'Um den VI zu senken: Trete an Kuppen und leichten Gefällestücken moderat weiter, statt komplett auf 0 Watt abzufallen.'
    ],
    tags: ['Variability Index', 'VI', 'Pacing', 'Gleichmäßigkeit', 'Triathlon']
  },
  {
    id: 'w_kg',
    name: 'Leistungsgewicht (Power-to-Weight Ratio)',
    shortName: 'W/kg',
    category: 'power',
    badgeColor: 'emerald',
    definition: 'Die mechanische Wattleistung geteilt durch das Körpergewicht des Sportlers in Kilogramm. Bei Steigungen über 6–7 % ist das Leistungsgewicht der ausschlaggebende Faktor für die Klettergeschwindigkeit.',
    formula: 'W/kg = Leistung (Watt) / Körpergewicht (kg)',
    unit: 'W/kg (Watt pro Kilogramm)',
    origin: 'Klassische Radsport-Biomechanik',
    interpretation: {
      good: '3,5 W/kg Schwellenleistung ermöglicht zügiges Klettern in den Alpen.',
      warning: 'Gewichtsverlust darf nicht auf Kosten von Muskelmasse oder Immunsystem gehen.',
      pro: '> 6,0 W/kg über 30–40 Minuten ist das Maß der Weltklasse an Bergetappen.'
    },
    benchmarks: [
      { label: 'Freizeit', value: '2,0 – 2,5 W/kg', desc: 'Solide Ausdauerbasis' },
      { label: 'Sportlich', value: '3,0 – 3,8 W/kg', desc: 'Top 30% bei Jedermann-Rennen' },
      { label: 'Sehr stark', value: '4,0 – 4,8 W/kg', desc: 'Podiumsfähig in Amateurklassen' },
      { label: 'WorldTour Spitzenkletterer', value: '6,0 – 6,8 W/kg', desc: 'Tour de France Bergankünfte' }
    ],
    practicalTips: [
      'Auf Flachstücken dominiert die absolute Wattleistung geteilt durch die Stirnfläche (W/CdA), am Berg dominiert W/kg.',
      '1 kg Gewichtsverlust spart an einem 1.000-Hm-Anstieg bei gleicher Wattzahl rund 1 Minute Kletterzeit.'
    ],
    tags: ['W/kg', 'Watt pro Kilogramm', 'Leistungsgewicht', 'Klettern', 'Watt']
  },

  // --- TRAINING LOAD & FITNESS MODELING ---
  {
    id: 'tss',
    name: 'Training Stress Score',
    shortName: 'TSS',
    category: 'training_load',
    badgeColor: 'purple',
    definition: 'Ein standardisiertes Maß zur Quantifizierung der gesamten physiologischen Trainingsbelastung einer Einheit. Genau 100 TSS entsprechen einer Stunde All-Out-Fahrt exakt an der Functional Threshold Power (FTP).',
    formula: 'TSS = (Dauer in s × Normalized Power × Intensity Factor) / (FTP × 3600) × 100',
    unit: 'Punkte (TSS)',
    origin: 'Dr. Andrew Coggan',
    interpretation: {
      good: '150 – 250 TSS für lange Wochenendausfahrten.',
      warning: '> 400 TSS an einem Tag erfordert mehrere Tage gezielte Regeneration.',
      pro: 'Tour de France Bergetappen erreichen oft 300 – 450 TSS pro Tag über 3 Wochen.'
    },
    benchmarks: [
      { label: 'Leicht', value: '< 150 TSS', desc: 'Vollständige Erholung meist am nächsten Tag' },
      { label: 'Mittel', value: '150 – 300 TSS', desc: 'Spürbare Ermüdung für 1–2 Tage' },
      { label: 'Hart', value: '300 – 450 TSS', desc: 'Signifikante Erschöpfung für 2–3 Tage' },
      { label: 'Extrem', value: '> 450 TSS', desc: 'Erschöpfung über mehrere Tage / Regenerationswoche nötig' }
    ],
    practicalTips: [
      'TSS wächst quadratisch mit der Intensität: 30 Minuten bei 100 % FTP erzeugen mehr TSS als 60 Minuten bei 50 % FTP.',
      'Verwende TSS als täglichen Baustein zur Berechnung von Fitness (CTL), Ermüdung (ATL) und Form (TSB).'
    ],
    tags: ['TSS', 'Training Stress Score', 'Belastung', 'Coggan', 'Trainingssteuerung']
  },
  {
    id: 'ctl',
    name: 'Chronic Training Load (Fitness)',
    shortName: 'CTL',
    category: 'training_load',
    badgeColor: 'blue',
    definition: 'Ein exponentiell gewichteter gleitender Durchschnitt des täglichen Training Stress Scores (TSS) über die letzten 42 Tage (6 Wochen). CTL repräsentiert deine langfristig aufgebaute Ausdauer-Fitness und Belastungsverträglichkeit.',
    formula: 'CTL_heute = CTL_gestern + (TSS_heute - CTL_gestern) × (1 - e^(-1/42))',
    unit: 'Punkte/Tag (TSS/Tag)',
    origin: 'Dr. Andrew Coggan Performance Management Chart (PMC)',
    interpretation: {
      good: 'Steigerung um 3–7 CTL-Punkte pro Woche ist optimal und nachhaltig.',
      warning: 'Steigerung > 10 Punkte/Woche erhöht das Verletzungs- und Übertrainingsrisiko drastisch.',
      pro: 'WorldTour-Profis halten während der Grand-Tour-Saison eine CTL von 130 – 160+.'
    },
    benchmarks: [
      { label: 'Freizeitsportler', value: '30 – 50 CTL', desc: 'Solide Fitness für Touren bis 3 Stunden' },
      { label: 'Ambitionierter Amateur', value: '70 – 100 CTL', desc: 'Bereit für schwere Gran Fondos und Mehrtagestouren' },
      { label: 'Nationaler Elite-Fahrer', value: '100 – 130 CTL', desc: 'Sehr hohes Trainingsvolumen (15–20 Std./Woche)' },
      { label: 'WorldTour Profi', value: '130 – 165+ CTL', desc: 'Höchstes internationales Wettkampfniveau' }
    ],
    practicalTips: [
      'Eine hohe CTL schützt vor schneller Ermüdung bei langen Etappen.',
      'Plane alle 3–4 Wochen eine Regenerationswoche mit 40–50 % weniger TSS ein, damit sich der Körper anpassen kann.'
    ],
    tags: ['CTL', 'Fitness', 'Ausdauerbasis', 'PMC', 'Periodisierung']
  },
  {
    id: 'atl',
    name: 'Acute Training Load (Ermüdung)',
    shortName: 'ATL',
    category: 'training_load',
    badgeColor: 'rose',
    definition: 'Ein exponentiell gewichteter gleitender Durchschnitt des täglichen TSS über die letzten 7 Tage. ATL bildet die kurzfristige akute Ermüdung und Muskelschöpfung ab.',
    formula: 'ATL_heute = ATL_gestern + (TSS_heute - ATL_gestern) × (1 - e^(-1/7))',
    unit: 'Punkte/Tag (TSS/Tag)',
    origin: 'Dr. Andrew Coggan Performance Management Chart (PMC)',
    interpretation: {
      good: 'Kurzzeitige Spitzen nach einem harten Trainingslager sind normal und erwünscht.',
      warning: 'Wenn ATL dauerhaft mehr als 30–40 Punkte über CTL liegt, droht akutes Übertraining.',
      pro: 'Profis nutzen Tapering-Phasen, um die ATL vor Saisonhöhepunkten gezielt abzubauen.'
    },
    benchmarks: [
      { label: 'Erholt / Ruhewoche', value: 'ATL < CTL - 15', desc: 'Geringe akute Müdigkeit, frische Muskeln' },
      { label: 'Normale Trainingswoche', value: 'ATL ≈ CTL ± 10', desc: 'Gleichgewicht von Reiz und Erholung' },
      { label: 'Intensiv-Block / Camp', value: 'ATL > CTL + 30', desc: 'Sehr hohe akute Müdigkeit' }
    ],
    practicalTips: [
      'ATL reagiert sehr schnell auf harte Tage (z.B. ein 300-TSS-Wochenende lässt ATL sofort nach oben schnellen).',
      'Nutze Schlaf, eiweißreiche Ernährung und Kompression, um die Regeneration bei hoher ATL zu beschleunigen.'
    ],
    tags: ['ATL', 'Ermüdung', 'Fatigue', 'PMC', 'Erholung']
  },
  {
    id: 'tsb',
    name: 'Training Stress Balance (Form & Frische)',
    shortName: 'TSB',
    category: 'training_load',
    badgeColor: 'emerald',
    definition: 'Die mathematische Differenz zwischen langfristiger Fitness (CTL) und akuter Ermüdung (ATL). TSB gibt an, wie "frisch" und wettkampffit der Körper an einem bestimmten Tag ist.',
    formula: 'TSB = CTL (Fitness) - ATL (Ermüdung)',
    unit: 'Punkte (TSB)',
    origin: 'Dr. Andrew Coggan Performance Management Chart (PMC)',
    interpretation: {
      good: 'TSB zwischen +5 und +20 am Wettkampftag signalisiert maximale Topform ("Peak Form").',
      warning: 'TSB < -30 über längere Zeit deutet auf schwere Übermüdung und Infektanfälligkeit hin.',
      pro: 'Im harten Trainingslager liegt der TSB oft bewusst bei -15 bis -25, um Superkompensation auszulösen.'
    },
    benchmarks: [
      { label: 'Wettkampf-Topform (Peak)', value: '+10 bis +25 TSB', desc: 'Maximale Frische, optimal für Bestzeiten' },
      { label: 'Gute Rennform', value: '0 bis +10 TSB', desc: 'Gute Leistungsabgabe für solide Wettkämpfe' },
      { label: 'Optimaler Trainingsreiz', value: '-10 bis -25 TSB', desc: 'Effektiver Fitnessaufbau ohne Übertraining' },
      { label: 'Hohe Überlastung', value: '< -30 TSB', desc: 'Erhöhtes Risiko für Leistungseinbruch und Krankheit' }
    ],
    practicalTips: [
      'Tapering vor einem Event: Reduziere das Volumen um 40–60 %, halte aber kurze, hochintensive Intervalle bei, um den TSB auf +15 zu heben, ohne CTL zu verlieren.',
      'Ein dauerhaft hoher TSB (> +25) bedeutet, dass zu wenig trainiert wird und die Fitness (CTL) abbaut.'
    ],
    tags: ['TSB', 'Form', 'Frische', 'Tapering', 'PMC', 'Superkompensation']
  },

  // --- CARDIOVASCULAR & PHYSIOLOGY ---
  {
    id: 'vo2max',
    name: 'Maximale Sauerstoffaufnahme',
    shortName: 'VO2max',
    category: 'cardio',
    badgeColor: 'rose',
    definition: 'Das maximale Volumen an Sauerstoff in Millilitern, das der Körper während maximaler Ausbelastung pro Minute und pro Kilogramm Körpergewicht aufnehmen und in den Muskelzellen verwerten kann. Das "Bruttokriterium" für Ausdauerleistungsfähigkeit.',
    formula: 'VO2max = (Sauerstoffverbrauch V_O2 in ml/min) / Körpergewicht in kg',
    unit: 'ml/kg/min',
    origin: 'A.V. Hill (Nobelpreisträger) & David B. Dill',
    interpretation: {
      good: '45 – 55 ml/kg/min für sportlich aktive Personen.',
      warning: '< 35 ml/kg/min im jungen Erwachsenenalter deutet auf geringe kardiovaskuläre Fitness hin.',
      pro: '80 – 95 ml/kg/min bei Skilanglauf- und Radsport-Weltmeistern.'
    },
    benchmarks: [
      { label: 'Durchschnitt / Untrainiert', value: '35 – 42 ml/kg/min', desc: 'Gesunder Bevölkerungsdurchschnitt' },
      { label: 'Gut Trainiert', value: '50 – 60 ml/kg/min', desc: 'Regelmäßiger Ausdauersportler' },
      { label: 'Amateur-Rennfahrer', value: '62 – 72 ml/kg/min', desc: 'Top-Amateur / Lizenzfahrer' },
      { label: 'WorldTour Spitzenklasse', value: '82 – 92+ ml/kg/min', desc: 'Absolute physiologische Ausnahmeathleten' }
    ],
    practicalTips: [
      'VO2max-Intervalle (z.B. 4×4 Minuten oder 30/15s Mikro-Intervalle bei 110–120 % FTP) setzen den stärksten Reiz zur Erweiterung des Herzschlagvolumens.',
      'Die VO2max ist zu ca. 50 % genetisch determiniert, lässt sich aber durch gezieltes Training um 15–30 % steigern.'
    ],
    tags: ['VO2max', 'Sauerstoffaufnahme', 'Kardiovaskulär', 'Ausdauer', 'Spiroergometrie']
  },
  {
    id: 'hr_zones',
    name: 'Herzfrequenz-Trainingsbereiche (Z1–Z5)',
    shortName: 'Pulszonen (Z1–Z5)',
    category: 'cardio',
    badgeColor: 'rose',
    definition: 'Physiologisch definierte Zonen basierend auf der maximalen Herzfrequenz (HFmax) oder der Herzfrequenz an der anaeroben Schwelle (LTHR / FTHR). Jede Zone stimuliert spezifische metabolische Anpassungen (Fettstoffwechsel, Kapillarisierung, Laktattoleranz).',
    formula: 'Karvonen-Formel: Ziel-HF = Ruhepuls + (HFmax - Ruhepuls) × Intensität%',
    unit: 'Schläge pro Minute (bpm)',
    origin: 'Dr. Martti Karvonen / Coggan LTHR Modell',
    interpretation: {
      good: '80 % des gesamten Trainingsvolumens sollten in Zone 1 & 2 (polarisierter Ansatz) absolviert werden.',
      warning: 'Ständiges Fahren in Zone 3 ("Graue Zone") erzeugt hohe Ermüdung bei suboptimalem Anpassungsreiz.',
      pro: 'Profis nutzen LTHR (Lactate Threshold Heart Rate) für exakte Schwellenbestimmung.'
    },
    benchmarks: [
      { label: 'Z1 Aktive Regeneration', value: '< 65 % HFmax', desc: 'Erholungsfahrten, Durchblutung der Muskulatur' },
      { label: 'Z2 Grundlagenausdauer 1', value: '65 – 75 % HFmax', desc: 'Maximaler Fettstoffwechsel, Mitochondrien-Aufbau' },
      { label: 'Z3 Tempo / GA2', value: '76 – 85 % HFmax', desc: 'Flotter Rhythmus, Kohlenhydratanteil steigt' },
      { label: 'Z4 Entwicklungsbereich / Schwelle', value: '86 – 92 % HFmax', desc: 'Laktat-Gleichgewicht, Schwellenintervalle' },
      { label: 'Z5 Spitzenbereich / VO2max', value: '> 92 % HFmax', desc: 'Maximale Sauerstoffaufnahme, anaerobe Kapazität' }
    ],
    practicalTips: [
      'Herzfrequenz unterliegt Drift durch Hitze, Dehydration und Koffein (Herz-Kreislauf-Drift).',
      'Kombiniere Wattmesser und Herzfrequenzgurt für die Berechnung des Efficiency Factors (EF).'
    ],
    tags: ['Pulszonen', 'HFmax', 'Herzfrequenz', 'Karvonen', 'Grundlagentraining']
  },
  {
    id: 'hrv',
    name: 'Herzfrequenzvariabilität (HRV / RMSSD)',
    shortName: 'HRV',
    category: 'cardio',
    badgeColor: 'violet',
    definition: 'Die zeitliche Schwankung der Abstände zwischen aufeinanderfolgenden Herzschlägen in Millisekunden (RMSSD). HRV spiegelt die Aktivität des autonomen Nervensystems (Parasympathikus vs. Sympathikus) und damit die Regenerationsbereitschaft wider.',
    formula: 'RMSSD = √[ Mittelwert( (RR_{i+1} - RR_i)² ) ] in ms',
    unit: 'Millisekunden (ms)',
    origin: 'Klinische Kardiologie & Sportmedizin',
    interpretation: {
      good: 'Höhere Werte oder Werte im persönlichen 7-Tage-Durchschnitt zeigen gute Erholung an.',
      warning: 'Ein plötzlicher starker Abfall der HRV signalisiert beginnenden Infekt, Schlafmangel oder Übertraining.',
      pro: 'Profis steuern harte Trainingstage strikt nach dem morgendlichen HRV-Status.'
    },
    benchmarks: [
      { label: 'Niedrig / Erschöpft', value: '< 30 ms', desc: 'Hohe Sympathikus-Aktivität, Ruhetag empfohlen' },
      { label: 'Normal / Ausgeglichen', value: '45 – 85 ms', desc: 'Guter Erholungsstatus, normales Training möglich' },
      { label: 'Sehr hoch / Ausdauersportler', value: '> 100 ms', desc: 'Hoher Parasympathikus-Tonus, maximale Belastbarkeit' }
    ],
    practicalTips: [
      'Vergleiche HRV-Werte immer nur mit deiner eigenen individuellen Baseline, nie mit anderen Personen.',
      'Miss die HRV immer morgens direkt nach dem Aufwachen unter identischen Bedingungen.'
    ],
    tags: ['HRV', 'RMSSD', 'Herzfrequenzvariabilität', 'Regeneration', 'Autonomes Nervensystem']
  },

  // --- EFFICIENCY & PACING DYNAMICS ---
  {
    id: 'ef',
    name: 'Efficiency Factor (Aerobe Effizienz)',
    shortName: 'EF',
    category: 'efficiency',
    badgeColor: 'emerald',
    definition: 'Das Verhältnis der erbrachten Normalized Power (NP) zur durchschnittlichen Herzfrequenz in Zone 2. Der EF misst, wie viele Watt der Körper pro Herzschlag erzeugt. Ein steigender EF über die Saison beweist eine verbesserte aerobe Kondition.',
    formula: 'EF = Normalized Power (NP in Watt) / Durchschnittspuls (Avg HR in bpm)',
    unit: 'W/bpm (Watt pro Herzschlag)',
    origin: 'Joe Friel & Dr. Andrew Coggan',
    interpretation: {
      good: 'Ein Anstieg von z.B. 1,65 auf 1,85 W/bpm über Wochen zeigt echten Formaufbau.',
      warning: 'Sinkender EF bei gleichem Tempo deutet auf Müdigkeit, Hitze oder Dehydration hin.',
      pro: 'WorldTour-Profis erreichen im Grundlagenausdauerbereich EF-Werte von über 2,2 – 2,6 W/bpm.'
    },
    benchmarks: [
      { label: 'Einsteiger', value: '1,1 – 1,4 W/bpm', desc: '150 W bei 130 bpm' },
      { label: 'Gut trainiert', value: '1,6 – 1,9 W/bpm', desc: '230 W bei 135 bpm' },
      { label: 'Amateur-Spitze', value: '1,9 – 2,2 W/bpm', desc: '280 W bei 135 bpm' },
      { label: 'Profi', value: '> 2,3 W/bpm', desc: '320 W bei 130 bpm' }
    ],
    practicalTips: [
      'Vergleiche den EF nur auf ähnlichen Streckenprofilen unter vergleichbaren Außentemperaturen.',
      'Wenn dein EF ansteigt, während deine Ruheherzfrequenz stabil bleibt, arbeitet dein Herzmuskel ökonomischer.'
    ],
    tags: ['EF', 'Efficiency Factor', 'Aerobe Effizienz', 'Watt pro Puls', 'Joe Friel']
  },
  {
    id: 'decoupling',
    name: 'Aerobic Decoupling (Pw:HR Entkopplung)',
    shortName: 'Decoupling (Pw:HR)',
    category: 'efficiency',
    badgeColor: 'amber',
    definition: 'Die prozentuale Veränderung des Verhältnisses von Leistung (Power) zu Herzfrequenz (HR) zwischen der ersten und der zweiten Hälfte einer gleichmäßigen Ausdauerfahrt. Sie misst den "kardiovaskulären Drift".',
    formula: 'Decoupling (%) = [ (EF_erste_Hälfte - EF_zweite_Hälfte) / EF_erste_Hälfte ] × 100',
    unit: '% (Prozent Drift)',
    origin: 'Joe Friel (The Cyclist\'s Training Bible)',
    interpretation: {
      good: '< 5,0 % aerobe Entkopplung bei 2- bis 4-stündigen Grundlagenfahrten.',
      warning: '> 7,5 % deutet auf unzureichende Grundlagenausdauer, Kohlenhydratmangel oder Überhitzung hin.',
      pro: 'Profis halten Decoupling bei 5-stündigen Trainings unter 2,5 %.'
    },
    benchmarks: [
      { label: 'Exzellente Grundlagenausdauer', value: '< 3,0 %', desc: 'Kaum Pulsdrift, hervorragende Fettverbrennung' },
      { label: 'Gute Ausdauerbasis', value: '3,0 – 5,0 %', desc: 'Zielbereich für solide Grundlageneinheiten' },
      { label: 'Grenzbereich / Erschöpfung', value: '5,1 – 8,0 %', desc: 'Spürbarer Leistungsabfall oder Hitzestau' },
      { label: 'Starke Entkopplung', value: '> 8,0 %', desc: 'Ausdauerbasis für diese Distanz noch nicht ausreichend' }
    ],
    practicalTips: [
      'Wenn das Decoupling bei 3 Stunden unter 5 % bleibt, ist deine aerobe Basis bereit für Intervalle oder längere Umfänge.',
      'Trinke ausreichend Elektrolyte: Dehydration von nur 2 % des Körpergewichts lässt den Puls um 5–10 bpm driften.'
    ],
    tags: ['Decoupling', 'Pw:HR', 'Pulsdrift', 'Kardiovaskulärer Drift', 'Joe Friel']
  },

  // --- METABOLISM & NUTRITION ---
  {
    id: 'kj_vs_kcal',
    name: 'Mechanische Arbeit (kJ) vs. Kalorien (kcal)',
    shortName: 'kJ & kcal',
    category: 'nutrition',
    badgeColor: 'amber',
    definition: 'Kilojoules (kJ) messen die reine physikalische Arbeit, die am Pedal geleistet wurde. Da der menschliche Wirkungsgrad auf dem Rad bei ca. 22–24 % liegt (4,184 kJ pro kcal), entspricht 1 kJ mechanische Arbeit am Pedal nahezu 1:1 einer verbrannten Kilokalorie (kcal) Stoffwechselenergie.',
    formula: 'Arbeit (kJ) = (Durchschnittsleistung in Watt × Fahrzeit in Sekunden) / 1000 ≈ Verbrauch in kcal',
    unit: 'kJ (Arbeit) / kcal (Stoffwechselenergie)',
    origin: 'Thermodynamik & Arbeitsphysiologie',
    interpretation: {
      good: 'Ein Leistungsmesser liefert die mit Abstand präziseste Kalorienberechnung im Sport.',
      warning: 'Rein pulsbasierte Kalorienrechner überschätzen den Verbrauch oft um 20–40 %.',
      pro: 'Bei 300 Watt Durchschnittsleistung verbrennt ein Radsportler ca. 1.080 kcal pro Stunde.'
    },
    benchmarks: [
      { label: '2-Stunden-Grundlagenfahrt (180 W)', value: '≈ 1.300 kJ / 1.350 kcal', desc: 'Moderater Energiebedarf' },
      { label: '4-Stunden-Bergetappe (230 W)', value: '≈ 3.300 kJ / 3.450 kcal', desc: 'Sehr hoher Kohlenhydratbedarf' },
      { label: 'Ötztaler Radmarathon / Alpen', value: '≈ 5.500 – 7.000 kJ', desc: 'Extremer Gesamtenergiebedarf' }
    ],
    practicalTips: [
      'Führe bei Fahrten über 90 Minuten 50–70 % der verbrauchten Kohlenhydrate bereits auf dem Rad zu.',
      'Nutze die kJ-Zahl direkt zur Planung deiner Mahlzeiten nach dem Training.'
    ],
    tags: ['Kalorien', 'Kilojoules', 'kJ', 'kcal', 'Energieverbrauch', 'Wirkungsgrad']
  },
  {
    id: 'carbs_intake',
    name: 'Kohlenhydrataufnahme & Pacing-Ernährung',
    shortName: 'Carbs (g/h)',
    category: 'nutrition',
    badgeColor: 'amber',
    definition: 'Die stündlich über Sportgetränke, Gels und Riegel aufgenommene Menge an Kohlenhydraten in Gramm. Kohlenhydrate sind der limitierende Treibstoff für Schwellen- und Kletterleistungen über 75 % FTP.',
    formula: 'Bedarf (g/h) = 30 – 60 g/h (Glukose) oder bis 90 – 120 g/h (2:1 / 1:0.8 Glukose-Fruktose-Mix)',
    unit: 'g/h (Gramm pro Stunde)',
    origin: 'Prof. Asker Jeukendrup (GSSI / Maurten & Wissenschaft)',
    interpretation: {
      good: '60 – 90 g/h bei Ausfahrten über 2,5 Stunden verhindert Leistungseinbrüche ("Hungerast").',
      warning: '> 60 g/h reiner Glukose überlastet den SGLT1-Transporter und führt zu Magenproblemen.',
      pro: 'Moderne WorldTour-Teams trainieren den Magen ("Gut Training") auf 100 – 120 g/h.'
    },
    benchmarks: [
      { label: 'Fahrten < 60 Min', value: '0 – 30 g/h', desc: 'Wasser oder Mundspülung ausreichend' },
      { label: 'Fahrten 1 – 2,5 Std.', value: '30 – 60 g/h', desc: 'Klassische Sportgetränke / Riegel' },
      { label: 'Rennen / Marathons > 2,5 Std.', value: '60 – 90 g/h', desc: 'Glukose-Fruktose-Mischung (2:1)' },
      { label: 'Profi-Bergetappen', value: '90 – 120 g/h', desc: 'Hydrogel-Technologie, gezieltes Darmtraining' }
    ],
    practicalTips: [
      'Beginne bereits in den ersten 15 Minuten der Fahrt mit kleinen Schlucken Kohlenhydratgetränk, nicht erst wenn das Hungergefühl einsetzt.',
      'Trainiere deine Rennverpflegung immer vorab im Training unter vollem Renntempo.'
    ],
    tags: ['Kohlenhydrate', 'Carbs', 'Ernährung', 'Hungerast', 'Gels', 'Magen-Darm']
  }
];

interface SportMetricsGlossaryModalProps {
  onClose: () => void;
  initialMetricId?: string;
  isDark?: boolean;
}

export const SportMetricsGlossaryModal: React.FC<SportMetricsGlossaryModalProps> = ({
  onClose,
  initialMetricId,
  isDark
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<MetricCategory>('all');
  const [selectedMetricId, setSelectedMetricId] = useState<string>(
    initialMetricId || GLOSSARY_METRICS[0].id
  );
  const [activeTab, setActiveTab] = useState<'glossary' | 'calculator'>('glossary');

  // Interactive Calculator State
  const [calcType, setCalcType] = useState<'vam' | 'tss' | 'if_vi' | 'climb_score'>('vam');
  
  // VAM Calculator inputs
  const [calcEleGain, setCalcEleGain] = useState(650);
  const [calcTimeMin, setCalcTimeMin] = useState(38);
  
  // TSS Calculator inputs
  const [calcDurationMin, setCalcDurationMin] = useState(120);
  const [calcNp, setCalcNp] = useState(230);
  const [calcFtp, setCalcFtp] = useState(260);
  const [calcAvgPower, setCalcAvgPower] = useState(210);

  // Climb Score Calculator inputs
  const [calcClimbEle, setCalcClimbEle] = useState(900);
  const [calcClimbDist, setCalcClimbDist] = useState(12.5);

  const filteredMetrics = useMemo(() => {
    return GLOSSARY_METRICS.filter(m => {
      const matchesCat = selectedCategory === 'all' || m.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || 
        m.name.toLowerCase().includes(q) ||
        m.shortName.toLowerCase().includes(q) ||
        m.definition.toLowerCase().includes(q) ||
        m.tags.some(t => t.toLowerCase().includes(q));
      return matchesCat && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  const activeMetric = useMemo(() => {
    return GLOSSARY_METRICS.find(m => m.id === selectedMetricId) || GLOSSARY_METRICS[0];
  }, [selectedMetricId]);

  // Calculations
  const calculatedVam = useMemo(() => {
    if (calcTimeMin <= 0) return 0;
    return Math.round((calcEleGain / (calcTimeMin * 60)) * 3600);
  }, [calcEleGain, calcTimeMin]);

  const calculatedTss = useMemo(() => {
    if (calcFtp <= 0 || calcDurationMin <= 0) return 0;
    const ifVal = calcNp / calcFtp;
    const durationSec = calcDurationMin * 60;
    const tss = ((durationSec * calcNp * ifVal) / (calcFtp * 3600)) * 100;
    return Math.round(tss);
  }, [calcDurationMin, calcNp, calcFtp]);

  const calculatedIf = useMemo(() => {
    if (calcFtp <= 0) return 0;
    return Number((calcNp / calcFtp).toFixed(2));
  }, [calcNp, calcFtp]);

  const calculatedVi = useMemo(() => {
    if (calcAvgPower <= 0) return 0;
    return Number((calcNp / calcAvgPower).toFixed(2));
  }, [calcNp, calcAvgPower]);

  const calculatedClimbScore = useMemo(() => {
    if (calcClimbDist <= 0) return { score: 0, grade: 0, cat: 'Kategorie 4' };
    const grade = (calcClimbEle / (calcClimbDist * 1000)) * 100;
    const score = Math.round(calcClimbEle * (grade / 100) * Math.sqrt(calcClimbDist));
    let cat = 'Kategorie 4';
    if (score >= 200) cat = 'Hors Catégorie (HC)';
    else if (score >= 120) cat = 'Kategorie 1';
    else if (score >= 50) cat = 'Kategorie 2';
    else if (score >= 20) cat = 'Kategorie 3';
    return { score, grade: Number(grade.toFixed(1)), cat };
  }, [calcClimbEle, calcClimbDist]);

  const categories: { id: MetricCategory; label: string; icon: any }[] = [
    { id: 'all', label: 'Alle Metriken', icon: BookOpen },
    { id: 'climbing', label: 'Klettern & Pässe', icon: Mountain },
    { id: 'power', label: 'Watt & Leistung', icon: Zap },
    { id: 'training_load', label: 'Belastung & Form (PMC)', icon: TrendingUp },
    { id: 'cardio', label: 'Puls & Physiologie', icon: Heart },
    { id: 'efficiency', label: 'Effizienz & Pacing', icon: Activity },
    { id: 'nutrition', label: 'Energie & Ernährung', icon: Flame }
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-md overflow-hidden">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-5xl h-[92vh] max-h-[850px] bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden"
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md">
              <BookOpen size={20} className="stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black tracking-tight">Sport-Metriken & Trainingswissenschaftliches Glossar</h2>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                  Wissenschaftlich fundiert
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Präzise Definitionen, Formeln, Schwellenwerte und physiologische Hintergründe (VAM, TSS, FTP, EF, VO2max)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex bg-slate-800 p-0.5 rounded-xl border border-slate-700">
              <button
                onClick={() => { triggerHaptic('light'); setActiveTab('glossary'); }}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'glossary'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <BookOpen size={13} />
                <span>Glossar</span>
              </button>
              <button
                onClick={() => { triggerHaptic('light'); setActiveTab('calculator'); }}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'calculator'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Calculator size={13} />
                <span>Rechner</span>
              </button>
            </div>

            <button
              onClick={() => { triggerHaptic('light'); onClose(); }}
              className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
              title="Schließen (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {activeTab === 'glossary' ? (
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Left Sidebar: Search & Metric Selection List */}
            <div className="w-full md:w-80 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-slate-950/40 shrink-0">
              {/* Search Bar */}
              <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Metrik suchen (z.B. VAM, TSS, FTP)..."
                    className="w-full pl-8 pr-7 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800 dark:text-slate-100 placeholder-slate-400 font-medium"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* Category Pills */}
                <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
                  {categories.map(cat => {
                    const Icon = cat.icon;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => { triggerHaptic('light'); setSelectedCategory(cat.id); }}
                        className={`px-2 py-1 rounded-lg text-[10.5px] font-bold shrink-0 transition-all flex items-center gap-1 cursor-pointer ${
                          selectedCategory === cat.id
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-850'
                        }`}
                      >
                        <Icon size={11} />
                        <span>{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Metrics List */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {filteredMetrics.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    Keine Metriken für "{searchQuery}" gefunden.
                  </div>
                ) : (
                  filteredMetrics.map(m => {
                    const isSelected = m.id === activeMetric.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          triggerHaptic('light');
                          setSelectedMetricId(m.id);
                        }}
                        className={`w-full text-left p-2.5 rounded-xl transition-all flex items-center justify-between group cursor-pointer border ${
                          isSelected
                            ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-800/80 shadow-sm'
                            : 'bg-white dark:bg-slate-900/60 border-slate-200/70 dark:border-slate-800/60 hover:bg-slate-100/80 dark:hover:bg-slate-850'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-black tracking-tight ${isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-800 dark:text-slate-200'}`}>
                              {m.shortName}
                            </span>
                            <span className="text-[9.5px] text-slate-400 dark:text-slate-500 font-mono">
                              [{m.unit.split(' ')[0]}]
                            </span>
                          </div>
                          <p className="text-[10.5px] text-slate-500 dark:text-slate-400 truncate mt-0.5 font-normal">
                            {m.name}
                          </p>
                        </div>
                        <ChevronRight size={14} className={`shrink-0 transition-transform ${isSelected ? 'text-indigo-600 dark:text-indigo-400 translate-x-0.5' : 'text-slate-400 opacity-40 group-hover:opacity-100'}`} />
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Main Panel: Comprehensive Metric Detail View */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-white dark:bg-slate-900">
              {/* Header Title Section */}
              <div className="space-y-1.5 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                      {activeMetric.shortName}
                    </h3>
                    <span className="text-sm font-semibold text-slate-400">·</span>
                    <span className="text-sm font-bold text-slate-600 dark:text-slate-300">
                      {activeMetric.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-bold">
                      Einheit: {activeMetric.unit}
                    </span>
                  </div>
                </div>

                {activeMetric.origin && (
                  <p className="text-xs text-slate-400 flex items-center gap-1">
                    <Info size={12} className="text-indigo-400" />
                    <span>Ursprung / Urheber: <strong className="text-slate-600 dark:text-slate-300">{activeMetric.origin}</strong></span>
                  </p>
                )}
              </div>

              {/* Definition Block */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                  <BookOpen size={13} className="text-indigo-500" />
                  Definition & Wissenschaftliche Bedeutung
                </h4>
                <p>{activeMetric.definition}</p>
              </div>

              {/* Formula Block (if available) */}
              {activeMetric.formula && (
                <div className="p-4 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 space-y-1.5">
                  <h4 className="text-xs font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                    <Calculator size={13} className="text-indigo-600 dark:text-indigo-400" />
                    Mathematische Berechnungsformel
                  </h4>
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-indigo-200/70 dark:border-indigo-900/60 font-mono text-xs font-bold text-indigo-900 dark:text-indigo-200 overflow-x-auto">
                    {activeMetric.formula}
                  </div>
                </div>
              )}

              {/* Benchmark Reference Scale */}
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Scale size={13} className="text-emerald-500" />
                  Leistungsklassen & Referenz-Skala
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {activeMetric.benchmarks.map((b, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 flex flex-col justify-between"
                    >
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {b.label}
                        </span>
                        <div className="text-sm font-black text-indigo-600 dark:text-indigo-400 font-mono mt-0.5">
                          {b.value}
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                        {b.desc}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Interpretation Guidelines */}
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Award size={13} className="text-amber-500" />
                  Interpretation & Trainingspraxis
                </h4>
                <div className="space-y-2 text-xs">
                  {activeMetric.interpretation.good && (
                    <div className="p-3 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200 flex gap-2">
                      <span className="text-base leading-none">🟢</span>
                      <div>
                        <strong className="font-bold">Optimaler Bereich: </strong>
                        <span>{activeMetric.interpretation.good}</span>
                      </div>
                    </div>
                  )}
                  {activeMetric.interpretation.warning && (
                    <div className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 flex gap-2">
                      <span className="text-base leading-none">⚠️</span>
                      <div>
                        <strong className="font-bold">Vorsicht / Warnung: </strong>
                        <span>{activeMetric.interpretation.warning}</span>
                      </div>
                    </div>
                  )}
                  {activeMetric.interpretation.pro && (
                    <div className="p-3 rounded-xl bg-purple-50/80 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/60 text-purple-900 dark:text-purple-200 flex gap-2">
                      <span className="text-base leading-none">🏆</span>
                      <div>
                        <strong className="font-bold">Profi-Niveau: </strong>
                        <span>{activeMetric.interpretation.pro}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Practical Tips */}
              {activeMetric.practicalTips.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Sparkles size={13} className="text-blue-500" />
                    Praxistipps für GPX Route Master
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                    {activeMetric.practicalTips.map((tip, idx) => (
                      <li key={idx} className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-850 border border-slate-200/70 dark:border-slate-800/70">
                        <span className="text-indigo-500 font-bold">•</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Interactive Metric Calculators Tab */
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
              <button
                onClick={() => { triggerHaptic('light'); setCalcType('vam'); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  calcType === 'vam'
                    ? 'bg-purple-600 text-white shadow'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                <Mountain size={13} />
                <span>VAM Rechner</span>
              </button>
              <button
                onClick={() => { triggerHaptic('light'); setCalcType('tss'); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  calcType === 'tss'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                <TrendingUp size={13} />
                <span>TSS Rechner</span>
              </button>
              <button
                onClick={() => { triggerHaptic('light'); setCalcType('if_vi'); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  calcType === 'if_vi'
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                <Zap size={13} />
                <span>IF & VI Pacing</span>
              </button>
              <button
                onClick={() => { triggerHaptic('light'); setCalcType('climb_score'); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  calcType === 'climb_score'
                    ? 'bg-rose-600 text-white shadow'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                <Award size={13} />
                <span>Bergwertungs-Score</span>
              </button>
            </div>

            {calcType === 'vam' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-4">
                  <h4 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                    <Mountain size={16} className="text-purple-500" />
                    VAM Steiggeschwindigkeits-Simulator
                  </h4>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <label className="text-slate-500">Höhenunterschied (m)</label>
                      <span className="text-purple-600 dark:text-purple-400 font-mono font-black">{calcEleGain} m</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="2500"
                      step="25"
                      value={calcEleGain}
                      onChange={(e) => setCalcEleGain(Number(e.target.value))}
                      className="w-full accent-purple-600"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <label className="text-slate-500">Kletterzeit (Minuten)</label>
                      <span className="text-purple-600 dark:text-purple-400 font-mono font-black">{calcTimeMin} min</span>
                    </div>
                    <input
                      type="range"
                      min="3"
                      max="180"
                      step="1"
                      value={calcTimeMin}
                      onChange={(e) => setCalcTimeMin(Number(e.target.value))}
                      className="w-full accent-purple-600"
                    />
                  </div>
                </div>

                <div className="p-6 rounded-2xl bg-gradient-to-br from-purple-900/40 to-indigo-900/40 border border-purple-500/30 flex flex-col justify-center items-center text-center space-y-3">
                  <span className="text-xs font-extrabold uppercase tracking-widest text-purple-300">
                    Ergebnis Steigleistung
                  </span>
                  <div className="text-5xl font-black text-white font-mono tracking-tight">
                    {calculatedVam} <span className="text-xl font-normal text-purple-300">m/h</span>
                  </div>
                  <div className="text-xs text-slate-300 max-w-xs leading-relaxed">
                    {calculatedVam >= 1500 && "🏆 WorldTour Kletterlevel (Grand-Tour Spitzenklasse)"}
                    {calculatedVam >= 1000 && calculatedVam < 1500 && "🔥 Sehr starker Amateur / Gran Fondo Spitzenfeld"}
                    {calculatedVam >= 700 && calculatedVam < 1000 && "🚴 Solider sportlicher Trainingsbereich"}
                    {calculatedVam < 700 && "🌱 Gemütliches Klettern / Grundlagentempo"}
                  </div>
                </div>
              </div>
            )}

            {calcType === 'tss' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-4">
                  <h4 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                    <TrendingUp size={16} className="text-indigo-500" />
                    TSS Belastungs-Kalkulator
                  </h4>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <label className="text-slate-500">Fahrt-Dauer (Minuten)</label>
                      <span className="text-indigo-600 dark:text-indigo-400 font-mono font-black">{calcDurationMin} min ({Math.floor(calcDurationMin / 60)}h {calcDurationMin % 60}m)</span>
                    </div>
                    <input
                      type="range"
                      min="15"
                      max="360"
                      step="5"
                      value={calcDurationMin}
                      onChange={(e) => setCalcDurationMin(Number(e.target.value))}
                      className="w-full accent-indigo-600"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <label className="text-slate-500">Normalized Power (NP)</label>
                      <span className="text-indigo-600 dark:text-indigo-400 font-mono font-black">{calcNp} W</span>
                    </div>
                    <input
                      type="range"
                      min="100"
                      max="450"
                      step="5"
                      value={calcNp}
                      onChange={(e) => setCalcNp(Number(e.target.value))}
                      className="w-full accent-indigo-600"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <label className="text-slate-500">Eigene FTP</label>
                      <span className="text-amber-600 dark:text-amber-400 font-mono font-black">{calcFtp} W</span>
                    </div>
                    <input
                      type="range"
                      min="120"
                      max="450"
                      step="5"
                      value={calcFtp}
                      onChange={(e) => setCalcFtp(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                </div>

                <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-900/40 to-blue-900/40 border border-indigo-500/30 flex flex-col justify-center items-center text-center space-y-4">
                  <div>
                    <span className="text-xs font-extrabold uppercase tracking-widest text-indigo-300">
                      Berechneter Training Stress Score
                    </span>
                    <div className="text-5xl font-black text-white font-mono tracking-tight mt-1">
                      {calculatedTss} <span className="text-xl font-normal text-indigo-300">TSS</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 w-full pt-2 border-t border-indigo-500/20">
                    <div className="p-2.5 rounded-xl bg-slate-900/50">
                      <span className="text-[10px] text-slate-400 block uppercase font-bold">Intensity Factor</span>
                      <span className="text-base font-black text-indigo-300 font-mono">{calculatedIf} IF</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-900/50">
                      <span className="text-[10px] text-slate-400 block uppercase font-bold">Erholungszeit</span>
                      <span className="text-base font-black text-indigo-300 font-mono">
                        {calculatedTss < 150 ? "12–24 Std." : calculatedTss < 300 ? "24–48 Std." : "48–72 Std."}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {calcType === 'if_vi' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-4">
                  <h4 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                    <Zap size={16} className="text-blue-500" />
                    IF & VI Pacing-Gleichmäßigkeitsrechner
                  </h4>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <label className="text-slate-500">Normalized Power (NP)</label>
                      <span className="text-blue-600 dark:text-blue-400 font-mono font-black">{calcNp} W</span>
                    </div>
                    <input
                      type="range"
                      min="100"
                      max="450"
                      step="5"
                      value={calcNp}
                      onChange={(e) => setCalcNp(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <label className="text-slate-500">Average Power (Avg Watt)</label>
                      <span className="text-blue-600 dark:text-blue-400 font-mono font-black">{calcAvgPower} W</span>
                    </div>
                    <input
                      type="range"
                      min="80"
                      max="450"
                      step="5"
                      value={calcAvgPower}
                      onChange={(e) => setCalcAvgPower(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <label className="text-slate-500">FTP</label>
                      <span className="text-amber-600 dark:text-amber-400 font-mono font-black">{calcFtp} W</span>
                    </div>
                    <input
                      type="range"
                      min="120"
                      max="450"
                      step="5"
                      value={calcFtp}
                      onChange={(e) => setCalcFtp(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                </div>

                <div className="p-6 rounded-2xl bg-gradient-to-br from-blue-900/40 to-cyan-900/40 border border-blue-500/30 space-y-4">
                  <div className="text-center">
                    <span className="text-xs font-extrabold uppercase tracking-widest text-cyan-300">
                      Variability Index (VI)
                    </span>
                    <div className="text-4xl font-black text-white font-mono mt-1">
                      {calculatedVi}
                    </div>
                    <p className="text-xs text-slate-300 mt-1">
                      {calculatedVi <= 1.05 && "🎯 Nahezu perfektes, gleichmäßiges Zeitfahr-Pacing"}
                      {calculatedVi > 1.05 && calculatedVi <= 1.15 && "⛰️ Typisches hügeliges Streckenpacing"}
                      {calculatedVi > 1.15 && "⚡ Sehr ungleichmäßiges Kriteriums-/Sprint-Pacing"}
                    </p>
                  </div>

                  <div className="text-center pt-3 border-t border-cyan-500/20">
                    <span className="text-xs font-extrabold uppercase tracking-widest text-blue-300">
                      Intensity Factor (IF)
                    </span>
                    <div className="text-3xl font-black text-white font-mono mt-1">
                      {calculatedIf}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {calcType === 'climb_score' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-4">
                  <h4 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                    <Award size={16} className="text-rose-500" />
                    Bergwertungs-Score Simulator (UCI / Tour de France)
                  </h4>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <label className="text-slate-500">Höhenmeter des Anstiegs</label>
                      <span className="text-rose-600 dark:text-rose-400 font-mono font-black">{calcClimbEle} m</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="2200"
                      step="25"
                      value={calcClimbEle}
                      onChange={(e) => setCalcClimbEle(Number(e.target.value))}
                      className="w-full accent-rose-600"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <label className="text-slate-500">Anstiegslänge (km)</label>
                      <span className="text-rose-600 dark:text-rose-400 font-mono font-black">{calcClimbDist} km</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="35"
                      step="0.5"
                      value={calcClimbDist}
                      onChange={(e) => setCalcClimbDist(Number(e.target.value))}
                      className="w-full accent-rose-600"
                    />
                  </div>
                </div>

                <div className="p-6 rounded-2xl bg-gradient-to-br from-rose-900/40 to-pink-900/40 border border-rose-500/30 flex flex-col justify-center items-center text-center space-y-4">
                  <div>
                    <span className="text-xs font-extrabold uppercase tracking-widest text-rose-300">
                      Klassifizierte Bergwertung
                    </span>
                    <div className="text-3xl font-black text-white tracking-tight mt-1">
                      {calculatedClimbScore.cat}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 w-full pt-2 border-t border-rose-500/20">
                    <div className="p-2.5 rounded-xl bg-slate-900/50">
                      <span className="text-[10px] text-slate-400 block uppercase font-bold">Score</span>
                      <span className="text-base font-black text-rose-300 font-mono">{calculatedClimbScore.score}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-900/50">
                      <span className="text-[10px] text-slate-400 block uppercase font-bold">Ø Steigung</span>
                      <span className="text-base font-black text-rose-300 font-mono">{calculatedClimbScore.grade}%</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
};
