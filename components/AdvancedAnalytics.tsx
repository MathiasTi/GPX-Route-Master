import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Activity, Zap, TrendingUp, BarChart2, Shield, Heart, Clock, Maximize2, Flame, Settings, HelpCircle, Info } from 'lucide-react';
import { GPXTrack, GPXPoint } from '../types';
import { calculatePowerStats, calculateDistance, getPaceString, findClimbs } from '../utils/gpxUtils';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell, LineChart, Line, Legend } from 'recharts';

const formatPaceDecimal = (paceDecimal: number) => {
  if (!paceDecimal || paceDecimal === Infinity || paceDecimal <= 0) return '--:--';
  const mins = Math.floor(paceDecimal);
  const secs = Math.round((paceDecimal - mins) * 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}/km`;
};

interface AdvancedAnalyticsProps {
  track: GPXTrack;
  onClose: () => void;
  ftp: number;
  userWeight: number;
  userAge: number;
  selectionBounds?: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null;
  onSelection?: (bounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null) => void;
}

const METRIC_EXPLANATIONS: Record<string, { title: string; subtitle: string; formula: string; text: string }> = {
  avgPower: {
    title: "Ø Sim-Leistung (Simulierte Leistung)",
    subtitle: "Aerodynamische, mechanische & gravitationelle Leistungsberechnung",
    formula: "P_gesamt = P_steigo + P_roll + P_aero | Multipliziert mit 1.05 Antriebsverlust (Fahrrad)",
    text: "Die physikalische Durchschnittsleistung (in Watt) summiert alle mechanischen Widerstände über jedes einzelne GPS-Segment:\n\n" +
          "• **Gravitationsleistung (Steigung)**:\n  P_steigo = (Körpergewicht + Maschinengewicht) * g * v * sin(arctan(S))\n  S ist das Steigungsverhältnis (Höhenunterschied / Distanz). v ist die Geschwindigkeit in m/s. g ist die Erdbeschleunigung (9.81 m/s²). Bei steilem Gefälle kann dieser Wert negativ sein.\n\n" +
          "• **Rollwiderstand**:\n  P_roll = (Körpergewicht + Maschinengewicht) * g * v * cos(arctan(S)) * C_rr\n  Hierbei fließt der gewählte Reifentyp direkt ein (C_rr für Straße = 0.0040, Gravel = 0.0065, MTB = 0.0090).\n\n" +
          "• **Aero-Luftwiderstand**:\n  P_aero = 0.5 * CdA * rho * (v + v_wind)² * v\n  Die projizierte Stirnfläche mal Luftwiderstandsbeiwert (CdA) bildet deinen Windschatten (Unterlenker = 0.26, Bremsgriffe = 0.32, Aufrechte Sitzposition = 0.40). rho ist die Luftdichte auf Meereshöhe (1.225 kg/m³) und v_wind die Gegenwind-Geschwindigkeit.\n\n" +
          "• **Antriebseffizienz**:\n  Beim Radfahren werden 5% Kraftübertragungsverlust (Drivetrain Loss = 0.95 Effizienz) hinzugerechnet. Beim Laufen wird eine biomechanische Laufleistungskonstante (1.04 * Gewicht * v) und ein Steigungsfaktor verwendet."
  },
  workKj: {
    title: "Physikalische Arbeit (in kJ)",
    subtitle: "Die gesamte an die Kurbel oder Füße übertragene mechanische Energie",
    formula: "Arbeit (kJ) = Summe(Leistung (W) * Dauer (Sekunden)) / 1000",
    text: "Die physikalische Arbeit misst die reine Bewegungsenergie, die du auf die Straße gebracht hast.\n\n" +
          "1 Wattsekunde entspricht exakt 1 Joule. Wenn du beispielsweise 1 Stunde lang mit konstant 200 Watt fährst:\n" +
          "Arbeit = 200 W * 3600 h_sek = 720.000 Joule = 720 Kilojoule (kJ).\n\n" +
          "Die physikalische Arbeit ist extrem wertvoll, da sie ein von Herzfrequenzschwankungen und Tagesform unbeeinflusstes, absolut objektives Maß für den mechanischen Energieaufwand deiner Fahrt darstellt."
  },
  calories: {
    title: "Metabolische Energie (Kalorien in kcal)",
    subtitle: "Der biologische Energieverbrauch (Bruttoumsatz) deines Stoffwechsels",
    formula: "Metabolische kcal = Arbeit (kJ) / (Muskelwirkungsgrad * 4.184)",
    text: "Warum verbraucht man mehr kcal als kJ Arbeit auf der Anzeige stehen?\n\n" +
          "Der menschliche Körper ist thermodynamisch betrachtet kein idealer Motor. Nur etwa 21% bis 23% der im Muskel durch Nahrung (Fett und Glykogen) freigesetzten chemischen Energie können in mechanische Kurbelarbeit umgewandelt werden. Der Rest (77% bis 79%) verpufft ungenutzt als Körperwärme und Schweißverdunstung.\n\n" +
          "• **Radfahren**: Wirkungsgrad von ca. 23% (da der Oberkörper weitgehend stabilisiert und rollend gelagert ist).\n" +
          "• **Laufen**: Wirkungsgrad von ca. 21% (aufgrund zusätzlicher exzentrischer Stoßarbeit und aktiver Halte- und Stützmuskulatur).\n\n" +
          "Da 1 kcal = 4.184 kJ beträgt, ergibt sich durch den Wirkungsgrad von 23%:\n" +
          "kcal = kJ / (0.23 * 4.184) ≈ kJ * 1.04\n" +
          "(Bei 21% Wirkungsgrad sind es ca. kJ * 1.13). Du verbrennst also biologisch in etwa so viele Kilokalorien, wie du mechanische Kilojoule leistest!"
  },
  fatOx: {
    title: "Fettschmelze-Anteil (Fat Oxidation)",
    subtitle: "Die Verbrennungsquote aus freien Fettsäuren zur Energiegewinnung",
    formula: "Fett (g) = (Energetischer Anteil aus Fett in kcal) / 9.3 kcal/g",
    text: "Die Verfeuerung körpereigener Fette (Lipolyse) liefert nahezu unbegrenzte Energie, benötigt jedoch viel Sauerstoff (aerobes System) und läuft bei niedriger Intensität am besten:\n\n" +
          "Der Algorithmus berechnet das Intensitätsverhältnis (Power / FTP) für jede Sekunde:\n" +
          "• **Unter 55% FTP (Regenerativ)**: Der Fettanteil liegt bei ca. 70% der benötigten Energie. Hier schmilzt der Speck optimal!\n" +
          "• **55% bis 75% FTP (GA1)**: Der Fettanteil sinkt auf ca. 52% ab. Kohlenhydrate übernehmen die andere Hälfte.\n" +
          "• **75% bis 90% FTP (GA2 / Schwelle)**: Fett steuert nur noch etwa 30% bei.\n" +
          "• **Über 90% FTP (VO2max / Anaerob)**: Der Fettanteil bricht auf unter 12% bis zu 2% zusammen. Der Körper brennt fast ausschließlich reines Glykogen aus den Speichern ab.\n\n" +
          "Umgerechnet in Gramm: 1 Gramm Fett lagert ca. 9.3 Kilokalorien Energie ein."
  },
  carbOx: {
    title: "Kohlenhydrat-Anteil (Glykogenbeladung)",
    subtitle: "Die Verbrennung von Muskelzucker/Glykogen bei ansteigender Wattzahl",
    formula: "Kohlenhydrate (g) = (Energetischer Anteil aus Carbs in kcal) / 4.1 kcal/g",
    text: "Kohlenhydrate (Glukose) sind der hocheffiziente Treibstoff für dein Gehirn und sportliche Tempoläufe bzw. Sprints.\n\n" +
          "Da sie enzymatisch viel schneller gespalten werden können als Fette und pro Liter verbrauchtem Sauerstoff mehr Energie (ATP) freisetzen, schaltet dein Körper bei mittlerer bis hoher Intensität (> 75% FTP) fast vollständig auf die Verbrennung von Glykogen um.\n\n" +
          "Da deine Glykogenspeicher im Muskel und der Leber sehr begrenzt sind (ca. 400 Gramm beim trainierten Athleten, entsprechend ca. 1600 kcal), leert sich dieser Tank bei Fahrten im roten Bereich rasant.\n\n" +
          "Umgerechnet in Gramm: 1 Gramm Kohlenhydrate besitzt einen physiologischen Brennwert von ca. 4.1 Kilokalorien."
  },
  slopeClassifier: {
    title: "🧗 Steigungs-Klassifizierer",
    subtitle: "Topografische Terraineinstufung nach Verteilungsverteilung",
    formula: "Streckenprofil = F(Gefälle %, Ebene %, Wellig %, Moderat %, Schwer %, Wand %)",
    text: "Der Routen-Klassifizierer teilt jeden Höhenmeter in sechs standardisierte Zonen ein:\n" +
          "1. **Gefälle (< -1.5%)**: Negative Hangabtriebskraft wirkt beschleunigend.\n" +
          "2. **Ebene (-1.5% bis 1.0%)**: Roll- und Luftwiderstand sind die dominanten Bremskräfte.\n" +
          "3. **Wellig (1.0% bis 3.5%)**: Leichtes Ansteigen, auch 'Falsches Flachland' genannt.\n" +
          "4. **Moderat (3.5% bis 6.5%)**: Spürbare Steigung, erfordert Rhythmuswechsel.\n" +
          "5. **Schwere Steigungen (6.5% bis 11.0%)**: Deutlicher Kletteranteil, verlangt Bergübersetzung.\n" +
          "6. **Steilrampe / Wand (> 11.0%)**: Extrem steiler Anstieg, oft Wiegetritt erforderlich.\n\n" +
          "Anhand der prozentualen Verteilungen auf der Gesamtstrecke stufen wir den Charakter des GPX-Tracks ein (Rouleur, Puncheur oder Grimpeur)."
  },
  slopeClassifierAll: {
    title: "Steigungsklassifizierung im Detail",
    subtitle: "Wie Höhenmodelle digital analysiert und berechnet werden",
    formula: "Glättungsfunktion: Gleitendes Mittelwertsfenster (Moving Average k = 11 Punkte)",
    text: "GPX-Rohdaten enthalten oft beträchtliches Höhenrauschen (GPS-Jitter). Ein Teilstück kann barometrisch oder per Satellitenabgleich sprunghaft steigen oder fallen, obwohl der Weg flach ist.\n\n" +
          "Aus diesem Grund wendet unser Algorithmus vor der Zuweisung zu den Steigungsklassen ein intelligentes Glättungsfenster an. Es mittelt jeden Punkt mit seinen jeweils 5 vorhergehenden und 5 nachfolgenden Nachbarn. Nur so wird verhindert, dass mikroskopische GPS-Ungenauigkeiten als scheinbar brutale Steilrampen detektiert werden.\n\n" +
          "Damit entspricht die angezeigte Grafik exakt dem flüssigen Gefühl, das ein Sportler beim Befahren der Strecke wahrnimmt."
  }
};

const AdvancedAnalytics: React.FC<AdvancedAnalyticsProps> = ({ 
  track, 
  onClose, 
  ftp, 
  userWeight, 
  userAge, 
  selectionBounds, 
  onSelection 
}) => {
  const [fullscreenChart, setFullscreenChart] = useState<string | null>(null);
  const [selectedTheoryMetric, setSelectedTheoryMetric] = useState<string | null>(null);
  const [showTheoryHandbook, setShowTheoryHandbook] = useState<boolean>(false);
  const [activeHandbookTab, setActiveHandbookTab] = useState<'aero' | 'energy' | 'substrate' | 'slope'>('aero');
  
  const isRunning = track.activityType === 'running';

  const computedClimbs = useMemo(() => {
    return track.climbs && track.climbs.length > 0 ? track.climbs : findClimbs(track.points || []);
  }, [track.climbs, track.points]);

  // State hooks for local dynamic Laboratory Simulation
  const [labRiderWeight, setLabRiderWeight] = useState<number>(userWeight || 75);
  const [labBikeWeight, setLabBikeWeight] = useState<number>(isRunning ? 1.5 : 9.5);
  const [labWindSpeed, setLabWindSpeed] = useState<number>(0); // Wind speed in km/h
  const [labRollingResistance, setLabRollingResistance] = useState<'road' | 'gravel' | 'mtb'>(
    'road'
  );
  const [labPosition, setLabPosition] = useState<'hoods' | 'drops' | 'upright'>('hoods');

  // Filter points if selection bounds are provided
  const analysisPoints = useMemo(() => {
    if (!selectionBounds) return track.points;
    return track.points.filter(p => 
      p.lat >= selectionBounds.minLat && p.lat <= selectionBounds.maxLat &&
      p.lng >= selectionBounds.minLng && p.lng <= selectionBounds.maxLng
    );
  }, [track.points, selectionBounds]);

  // Combined distance for filtered area
  const filteredDistance = useMemo(() => {
    let dist = 0;
    for (let i = 1; i < analysisPoints.length; i++) {
      dist += calculateDistance(analysisPoints[i - 1], analysisPoints[i]);
    }
    return dist;
  }, [analysisPoints]);

  const useDistance = selectionBounds ? filteredDistance : track.distance;

  const duration = useMemo(() => {
    if (analysisPoints.length < 2) return 0;
    const firstTime = analysisPoints.find(p => p.time !== undefined)?.time;
    const lastTime = [...analysisPoints].reverse().find(p => p.time !== undefined)?.time;
    if (firstTime && lastTime) {
      return (lastTime.getTime() - firstTime.getTime()) / 1000;
    }
    return 0;
  }, [analysisPoints]);

  const durationSecs = duration || (track.duration && !selectionBounds ? track.duration : 0);

  // Time Series points with multiple metrics smoothed for diagram selection
  const enrichedTimelineData = useMemo(() => {
    if (analysisPoints.length === 0) return [];
    
    // Smooth helper with moving average
    const lats = analysisPoints.map(p => p.lat);
    const lngs = analysisPoints.map(p => p.lng);
    
    let currentDist = 0;
    return analysisPoints.map((p, idx) => {
      if (idx > 0) {
        currentDist += calculateDistance(analysisPoints[idx - 1], p);
      }
      
      // Calculate speed
      let speedKmh = 0;
      let slope = 0;
      if (idx > 0) {
        const dStep = calculateDistance(analysisPoints[idx - 1], p);
        if (analysisPoints[idx - 1].time && p.time) {
          const dt = (p.time.getTime() - analysisPoints[idx - 1].time.getTime()) / 1000;
          if (dt > 0 && dt < 12) {
            speedKmh = dStep / (dt / 3600);
          }
        }
        
        // Windowed slope calculation (30 meters lookback) for stable and highly responsive points sloped gradient
        let j = idx;
        let dSum = 0;
        const windowKm = 0.030; // 30 meters window
        while (j > 0 && dSum < windowKm) {
          dSum += calculateDistance(analysisPoints[j - 1], analysisPoints[j]);
          j--;
        }
        
        if (dSum >= 0.010 && p.ele !== undefined && analysisPoints[j].ele !== undefined) {
          slope = ((p.ele - analysisPoints[j].ele!) / (dSum * 1000)) * 100;
          if (Math.abs(slope) > 40) slope = 0; // Filter outlier GPS elevation jumps
        } else if (dStep > 0.0005 && p.ele !== undefined && analysisPoints[idx - 1].ele !== undefined) {
          slope = ((p.ele - analysisPoints[idx - 1].ele!) / (dStep * 1000)) * 100;
          if (Math.abs(slope) > 40) slope = 0;
        }
      }

      const rawCadence = p.cadence || 0;
      // standard step frequency (garmin exports raw values as RPM which needs to be multiplied by 2 for runners SPM)
      const adjustedCadence = isRunning && rawCadence > 0 && rawCadence < 110 ? rawCadence * 2 : rawCadence;

      return {
        index: idx,
        distance: Number(currentDist.toFixed(2)),
        elevation: Math.round(p.ele || 0),
        hr: p.hr || 0,
        power: p.power || 0,
        speed: Number((speedKmh || 0).toFixed(1)),
        pace: speedKmh > 1.5 ? Number((60 / speedKmh).toFixed(2)) : 0, // pace in decimal min/km
        slope: Number((slope || 0).toFixed(1)),
        cadence: Math.round(adjustedCadence)
      };
    });
  }, [analysisPoints, isRunning]);

  // Downsample timeline data for smooth rendering
  const timelineChartData = useMemo(() => {
    const limit = 150;
    if (enrichedTimelineData.length <= limit) return enrichedTimelineData;
    const result: typeof enrichedTimelineData = [];
    const step = enrichedTimelineData.length / limit;
    for (let i = 0; i < limit; i++) {
      const idx = Math.floor(i * step);
      if (enrichedTimelineData[idx]) result.push(enrichedTimelineData[idx]);
    }
    const last = enrichedTimelineData[enrichedTimelineData.length - 1];
    if (last && !result.includes(last)) result.push(last);
    return result;
  }, [enrichedTimelineData]);

  // Selected timeline metric to display in chart
  const [activeTimelineMetric, setActiveTimelineMetric] = useState<string>(
    isRunning ? 'pace' : 'power'
  );

  // Steigungs-Klassifizierer: Berechne Distanz in verschiedenen Steigungsklassen
  const slopeCategorization = useMemo(() => {
    if (analysisPoints.length < 2) return null;

    let distGefaelle = 0;
    let distEbene = 0;
    let distWellig = 0;
    let distModerat = 0;
    let distSteil = 0;
    let distSteilrampe = 0;
    let totalDist = 0;

    // Smooth elevations first to avoid GPS jitter
    const eleSmoothed = new Float64Array(analysisPoints.length);
    const windowHalf = 5;
    for (let i = 0; i < analysisPoints.length; i++) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - windowHalf); j <= Math.min(analysisPoints.length - 1, i + windowHalf); j++) {
        if (analysisPoints[j].ele !== undefined) {
          sum += analysisPoints[j].ele!;
          count++;
        }
      }
      eleSmoothed[i] = count > 0 ? sum / count : (analysisPoints[i].ele ?? 0);
    }

    for (let i = 1; i < analysisPoints.length; i++) {
      const pPrev = analysisPoints[i - 1];
      const pCurr = analysisPoints[i];
      const segmentDist = calculateDistance(pPrev, pCurr); // in km
      if (segmentDist <= 0) continue;

      const eleDiff = eleSmoothed[i] - eleSmoothed[i - 1];
      const slopePercent = (eleDiff / (segmentDist * 1000)) * 100;

      totalDist += segmentDist;

      if (slopePercent < -1.5) {
        distGefaelle += segmentDist;
      } else if (slopePercent >= -1.5 && slopePercent < 1.0) {
        distEbene += segmentDist;
      } else if (slopePercent >= 1.0 && slopePercent < 3.5) {
        distWellig += segmentDist;
      } else if (slopePercent >= 3.5 && slopePercent < 6.5) {
        distModerat += segmentDist;
      } else if (slopePercent >= 6.5 && slopePercent < 11.0) {
        distSteil += segmentDist;
      } else {
        distSteilrampe += segmentDist;
      }
    }

    if (totalDist === 0) return null;

    const percentGefaelle = (distGefaelle / totalDist) * 100;
    const percentEbene = (distEbene / totalDist) * 100;
    const percentWellig = (distWellig / totalDist) * 100;
    const percentModerat = (distModerat / totalDist) * 100;
    const percentSteil = (distSteil / totalDist) * 100;
    const percentSteilrampe = (distSteilrampe / totalDist) * 100;

    // Classify overall track character
    let trackCharacter = 'Ausgewogenes Terrain';
    let trackDesc = 'Eine gute Mischung aus flachen, welligen und ansteigenden Segmenten.';
    if (distEbene + distGefaelle > totalDist * 0.8) {
      trackCharacter = 'Flachetappe (Rouleur)';
      trackDesc = 'Sehr flache Strecke, ideal für Tempobolzer, Zeitfahren und Sprints.';
    } else if (distWellig + distModerat > totalDist * 0.45 && distSteil + distSteilrampe < totalDist * 0.05) {
      trackCharacter = 'Welliges Terrain (Puncheur)';
      trackDesc = 'Kurze, knackige Hügel und welliges Profil, perfekt für hochexplosive Antritte.';
    } else if (distSteil + distSteilrampe > totalDist * 0.12) {
      trackCharacter = 'Kletter-Klassiker (Grimpeur)';
      trackDesc = 'Anspruchsvolles Berggelände mit signifikanten Steigungsanteilen.';
    } else if (computedClimbs && computedClimbs.length >= 3) {
      trackCharacter = 'Gebirgsrunde (Grimpeur)';
      trackDesc = 'Mehrere schwere Bergwertungen verlangen exzellente Ausdauer am Berg.';
    }

    return {
      totalDist,
      categories: [
        { name: 'Gefälle / Bergab', dist: distGefaelle, pct: percentGefaelle, color: 'bg-indigo-500', desc: '< -1.5% Steigung', hex: '#6366f1' },
        { name: 'Flaches Terrain', dist: distEbene, pct: percentEbene, color: 'bg-slate-400', desc: '-1.5% bis 1.0%', hex: '#94a3b8' },
        { name: 'Falsches Flachland / Wellig', dist: distWellig, pct: percentWellig, color: 'bg-amber-400', desc: '1.0% bis 3.5%', hex: '#fbbf24' },
        { name: 'Moderat ansteigend', dist: distModerat, pct: percentModerat, color: 'bg-orange-500', desc: '3.5% bis 6.5%', hex: '#f97316' },
        { name: 'Schwere Steigungen', dist: distSteil, pct: percentSteil, color: 'bg-rose-600', desc: '6.5% bis 11.0%', hex: '#e11d48' },
        { name: 'Steilrampe / Wand', dist: distSteilrampe, pct: percentSteilrampe, color: 'bg-red-800', desc: '> 11.0% Steigung!', hex: '#991b1b' },
      ],
      character: trackCharacter,
      desc: trackDesc
    };
  }, [analysisPoints, computedClimbs]);

  // Advanced Dynamic Performance & Calories Estimations
  const labCalculations = useMemo(() => {
    if (analysisPoints.length < 2) return null;

    const g = 9.81;
    const rho = 1.225; // Luftdichte

    let crrVal = 0.004; // road
    if (labRollingResistance === 'gravel') crrVal = 0.0065;
    if (labRollingResistance === 'mtb') crrVal = 0.009;

    let cdaVal = 0.32; // hoods
    if (labPosition === 'drops') cdaVal = 0.26;
    if (labPosition === 'upright') cdaVal = 0.40;

    let totalEnergyJoules = 0;
    let sumEstPower = 0;
    let pointsCount = 0;
    let totalTimeSec = 0;

    // Categorized metabolic energy (Carb vs Fat)
    let carbJoules = 0;
    let fatJoules = 0;

    // Smooth elevations to reduce GPS noise
    const eleSmoothed = new Float64Array(analysisPoints.length);
    const windowHalf = 5;
    for (let i = 0; i < analysisPoints.length; i++) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - windowHalf); j <= Math.min(analysisPoints.length - 1, i + windowHalf); j++) {
        if (analysisPoints[j].ele !== undefined) {
          sum += analysisPoints[j].ele!;
          count++;
        }
      }
      eleSmoothed[i] = count > 0 ? sum / count : (analysisPoints[i].ele ?? 0);
    }

    for (let i = 1; i < analysisPoints.length; i++) {
      const pPrev = analysisPoints[i - 1];
      const pCurr = analysisPoints[i];
      if (!pPrev.time || !pCurr.time) continue;

      const dt = (pCurr.time.getTime() - pPrev.time.getTime()) / 1000;
      if (dt <= 0 || dt > 120) continue;

      const distM = calculateDistance(pPrev, pCurr) * 1000;
      const speedMs = distM / dt;
      if (speedMs < 0.2) continue;

      const eleDiff = eleSmoothed[i] - eleSmoothed[i - 1];
      const slope = distM > 0 ? eleDiff / distM : 0;

      let power = 0;
      if (isRunning) {
        // running power formula
        const runningFactor = 1.04;
        power = runningFactor * labRiderWeight * speedMs;
        if (slope > 0) {
          power *= (1 + slope * (3.6 + labWindSpeed * 0.05));
        } else if (slope < 0) {
          power *= Math.max(0.60, 1 + slope * 1.5);
        }
      } else {
        // cycling power formula
        const fGrav = (labRiderWeight + labBikeWeight) * g * Math.sin(Math.atan(slope));
        const fRoll = (labRiderWeight + labBikeWeight) * g * Math.cos(Math.atan(slope)) * crrVal;
        
        // headwind vector
        const relativeAirSpeedMs = speedMs + (labWindSpeed / 3.6);
        const fAero = 0.5 * rho * cdaVal * relativeAirSpeedMs * relativeAirSpeedMs;

        const fNet = fGrav + fRoll + fAero;
        let rawPower = fNet * speedMs;
        power = rawPower / 0.95; // drivetrain loss

        if (slope < -0.04) {
          power = 0;
        } else {
          power = Math.max(10, Math.min(1000, power));
        }
      }

      sumEstPower += power;
      totalEnergyJoules += power * dt;
      pointsCount++;
      totalTimeSec += dt;

      // Carb vs. Fat oxidation calculation
      const intensity = power / (ftp || 250);
      let fatPct = 0.60;
      if (intensity < 0.55) {
        fatPct = 0.70;
      } else if (intensity < 0.75) {
        fatPct = 0.52;
      } else if (intensity < 0.90) {
        fatPct = 0.30;
      } else if (intensity < 1.05) {
        fatPct = 0.12;
      } else {
        fatPct = 0.02;
      }

      const totalPctCarb = 1.0 - fatPct;
      fatJoules += (power * dt) * fatPct;
      carbJoules += (power * dt) * totalPctCarb;
    }

    const estimatedAvgPower = pointsCount > 0 ? sumEstPower / pointsCount : 0;
    const workKj = totalEnergyJoules / 1000;

    const metabolicEfficiency = isRunning ? 0.21 : 0.23;
    const totalCal = workKj / (metabolicEfficiency * 4.184);

    const fatCal = (fatJoules / 1000) / (metabolicEfficiency * 4.184);
    const carbCal = (carbJoules / 1000) / (metabolicEfficiency * 4.184);

    const fatGrams = fatCal / 9.3;
    const carbGrams = carbCal / 4.1;

    return {
      avgPower: Math.round(estimatedAvgPower),
      workKj: Math.round(workKj),
      calories: Math.round(totalCal),
      fatCal: Math.round(fatCal),
      carbCal: Math.round(carbCal),
      fatGrams: Number(fatGrams.toFixed(1)),
      carbGrams: Number(carbGrams.toFixed(1)),
      fatPct: Math.round((fatCal / (totalCal || 1)) * 100),
      carbPct: Math.round((carbCal / (totalCal || 1)) * 100),
    };
  }, [analysisPoints, isRunning, labRiderWeight, labBikeWeight, labWindSpeed, labRollingResistance, labPosition, ftp]);

  // Power Stats or Estimates
  const powerStats = useMemo(() => {
    if (!selectionBounds) return track.powerStats;
    return calculatePowerStats(analysisPoints, ftp);
  }, [analysisPoints, ftp, selectionBounds, track.powerStats]);

  // Heat rate stats
  const avgHr = useMemo(() => {
    const hrPoints = analysisPoints.filter(p => p.hr !== undefined).map(p => p.hr!);
    if (hrPoints.length === 0) return null;
    return Math.round(hrPoints.reduce((a, b) => a + b, 0) / hrPoints.length);
  }, [analysisPoints]);

  const maxHr = useMemo(() => {
    const hrPoints = analysisPoints.filter(p => p.hr !== undefined).map(p => p.hr!);
    if (hrPoints.length === 0) return 180;
    return Math.max(...hrPoints);
  }, [analysisPoints]);

  // VO2Max estimations
  const vo2maxEstimate = useMemo(() => {
    if (analysisPoints.length === 0) return null;
    const maxHrCalc = 220 - userAge;
    const weight = userWeight || 75;

    if (isRunning) {
      // ACSM Running Formula: VO2 = (0.2 * speed_m_min) + (0.9 * speed_m_min * grade) + 3.5
      // Let's compute average speed
      const avgSpeedKmh = useDistance > 0 && durationSecs > 0 ? (useDistance / (durationSecs / 3600)) : 10;
      const speedMMin = avgSpeedKmh * 16.667;
      const grade = useDistance > 0 ? ((track.ascent || 0) / (useDistance * 1000)) : 0;
      const calculatedVo2 = (0.2 * speedMMin) + (0.9 * speedMMin * grade) + 3.5;
      
      // Heart rate correction if possible
      if (avgHr && avgHr > 60) {
        // Extrapolate to max heart rate
        const ratio = maxHrCalc / avgHr;
        const estVo2 = calculatedVo2 * ratio;
        return Math.min(Math.max(Math.round(estVo2 * 10) / 10, 20), 85);
      }
      return Math.round(calculatedVo2 * 10) / 10;
    } else {
      // Cycling: Based on FTP vs weight
      const pVo2maxFromFtp = ftp / 0.82;
      const vo2FromFtp = (10.8 * pVo2maxFromFtp / weight) + 7;
      const p5m = powerStats?.best1m ? powerStats.best1m * 0.85 : ftp * 1.15;
      const vo2FromPower = (10.8 * p5m / weight) + 7;

      if (avgHr) {
        const powerAtMaxHr = ((powerStats?.avgPower || ftp * 0.75) / avgHr) * maxHrCalc;
        const vo2Extrapolated = (10.8 * powerAtMaxHr / weight) + 7;
        return Math.min(Math.max(Math.round((vo2FromFtp * 0.3 + vo2FromPower * 0.3 + vo2Extrapolated * 0.4) * 10) / 10, 15), 90);
      }
      return Math.round(vo2FromFtp * 10) / 10;
    }
  }, [analysisPoints, isRunning, ftp, userAge, userWeight, powerStats, useDistance, durationSecs, avgHr, track.ascent]);

  const vo2Category = useMemo(() => {
    if (!vo2maxEstimate) return null;
    if (vo2maxEstimate > 60) return { label: 'Superior (Spitze)', color: 'text-purple-600 dark:text-purple-400' };
    if (vo2maxEstimate > 52) return { label: 'Exzellent', color: 'text-blue-500' };
    if (vo2maxEstimate > 44) return { label: 'Gut', color: 'text-emerald-500' };
    if (vo2maxEstimate > 36) return { label: 'Mittelmäßig', color: 'text-amber-500' };
    return { label: 'Aufbaufähig', color: 'text-rose-500' };
  }, [vo2maxEstimate]);

  // Running Pace Zonen (min/km thresholds based on estimated threshold pace)
  const averagePaceSeconds = useMemo(() => {
    const movingPoints = enrichedTimelineData.filter(p => p.speed > 2);
    if (movingPoints.length === 0) return 360; // 6:00 as default
    const avgPaceDecimal = movingPoints.reduce((sum, p) => sum + p.pace, 0) / movingPoints.length;
    return avgPaceDecimal * 60; // total seconds per km
  }, [enrichedTimelineData]);

  const thresholdPaceSecs = useMemo(() => {
    // Threshold pace usually slightly faster than average training pace, say 95%
    return averagePaceSeconds > 0 ? averagePaceSeconds * 0.94 : 300;
  }, [averagePaceSeconds]);

  // Pace zones calculation
  const paceZones = useMemo(() => {
    const zones = [
      { 
        name: 'KB', 
        fullName: 'KB – Kompensationsbereich (Erholung)',
        min: thresholdPaceSecs * 1.25, 
        max: 9999, 
        color: '#3b82f6', 
        duration: 0,
        desc: 'Vollkommen entspannte Fortbewegung zum lockeren Auslaufen oder Regenerieren.',
        benefit: 'Beschleunigt den Abbau von Stoffwechselprodukten und fördert die aktive Erholung.'
      },
      { 
        name: 'GA1', 
        fullName: 'GA1 – Grundlagenausdauer 1',
        min: thresholdPaceSecs * 1.15, 
        max: thresholdPaceSecs * 1.25, 
        color: '#10b981', 
        duration: 0,
        desc: 'Lockerer Dauerlauf im aeroben Bereich. Optimal zur Steigerung des Fettstoffwechsels.',
        benefit: 'Entwickelt die aerobe Basis-Ausdauer und stärkt das Herz-Kreislauf-System dauerhaft.'
      },
      { 
        name: 'GA2', 
        fullName: 'GA2 – Grundlagenausdauer 2',
        min: thresholdPaceSecs * 1.05, 
        max: thresholdPaceSecs * 1.15, 
        color: '#eab308', 
        duration: 0,
        desc: 'Zügigeres Tempo mit erhöhtem Atemreiz. Mischbereich aus Fett- und Kohlenhydratverbrennung.',
        benefit: 'Steigert das aerobe Leistungsvermögen und schult das spezifische Renntempo.'
      },
      { 
        name: 'EB', 
        fullName: 'EB – Entwicklungsbereich',
        min: thresholdPaceSecs * 0.95, 
        max: thresholdPaceSecs * 1.05, 
        color: '#f97316', 
        duration: 0,
        desc: 'Laufen nahe an der individuellen anaeroben Schwelle. Die Laktatbildung hält sich gerade noch die Waage.',
        benefit: 'Erhöht die Schwellen-Geschwindigkeit und schult das Laufen unter sauren Bedingungen.'
      },
      { 
        name: 'SB', 
        fullName: 'SB – Spitzenbereich',
        min: 0, 
        max: thresholdPaceSecs * 0.95, 
        color: '#ef4444', 
        duration: 0,
        desc: 'Hochintensives Intervalltraining im Bereich der maximalen Sauerstoffaufnahme und anaeroben Sprints.',
        benefit: 'Maximiert VO2Max, neuromuskuläre Rekrutierung und trainiert die Tempohärte unter extremen Bedingungen.'
      },
    ];

    let totalMovingSecs = 0;
    enrichedTimelineData.forEach((p, idx) => {
      if (p.speed > 1.5) {
        let delta = 1;
        if (idx > 0 && analysisPoints[idx].time && analysisPoints[idx - 1].time) {
          delta = (analysisPoints[idx].time!.getTime() - analysisPoints[idx - 1].time!.getTime()) / 1000;
          if (delta <= 0 || delta > 12) delta = 1;
        }

        const match = zones.find(z => p.pace * 60 >= z.min && p.pace * 60 < z.max);
        if (match) {
          match.duration += delta;
          totalMovingSecs += delta;
        }
      }
    });

    return zones.map(z => {
      const mins = Math.floor(z.duration / 60);
      const secs = Math.floor(z.duration % 60);
      return {
        ...z,
        percent: totalMovingSecs > 0 ? (z.duration / totalMovingSecs) * 100 : 0,
        timeStr: mins > 0 ? `${mins}m ${secs}s` : `${secs}s`,
        seconds: Math.floor(z.duration),
        rangeStr: z.max > 9000 
          ? `> ${formatPaceDecimal(z.min / 60)}` 
          : z.min === 0 
            ? `< ${formatPaceDecimal(z.max / 60)}` 
            : `${formatPaceDecimal(z.max / 60)} - ${formatPaceDecimal(z.min / 60)}`
      };
    }).reverse();
  }, [enrichedTimelineData, thresholdPaceSecs, analysisPoints]);

  // Loaded custom training zones base or defaults
  const customHrZonesBase = useMemo(() => {
    try {
      const saved = localStorage.getItem('velo_hr_zones');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 5) {
          return parsed;
        }
      }
    } catch (e) {}
    return [
      { key: 'KB', name: 'KB', fullName: 'KB – Kompensationsbereich (Erholung)', min: 96, max: 112, color: '#3b82f6', desc: 'Aktive Erholung, sehr geringe Intensität. Dient dem lockeren Ausrollen, Aufwärmen oder der aktiven Erholung nach harten Einheiten.', benefit: 'Fördert die Regeneration und beschleunigt den Abbau von Stoffwechselnebenprodukten.' },
      { key: 'GA1', name: 'GA1', fullName: 'GA1 – Grundlagenausdauer 1', min: 112, max: 136, color: '#10b981', desc: 'Klassisches Ausdauertraining im aeroben Bereich mit sehr hohem Fettstoffwechselanteil.', benefit: 'Verbessert die aerobe Grundausdauer, ökonomisiert die Herzarbeit und stärkt das Immunsystem.' },
      { key: 'GA2', name: 'GA2', fullName: 'GA2 – Grundlagenausdauer 2', min: 136, max: 152, color: '#eab308', desc: 'Mischbereich aus aerobem und anaerobem Stoffwechsel. Höhere Intensität mit kontrolliert vertiefter Atmung.', benefit: 'Steigert das spezifische Renntempo und verbessert die Glykogenspeicherung in den Muskeln.' },
      { key: 'EB', name: 'EB', fullName: 'EB – Entwicklungsbereich', min: 152, max: 168, color: '#f97316', desc: 'Intensives Training nahe der individuellen anaeroben Schwelle. Die Laktatbildung hält sich gerade noch die Waage.', benefit: 'Verschiebt die anaerobe Schwelle nach oben, verbessert die Kraftausdauer und Laktattoleranz.' },
      { key: 'SB', name: 'SB', fullName: 'SB – Spitzenbereich', min: 168, max: 170, color: '#ef4444', desc: 'Maximale Belastung (Hochintensives Intervalltraining - HIIT). Rein laktazides bzw. anaerobes Milieu.', benefit: 'Maximiert die VO2max, die neuromuskuläre Rekrutierung und die anaerobe Leistungsfähigkeit.' }
    ];
  }, []);

  const effectiveHrZones = useMemo(() => {
    if (track.activityType === 'running') {
      return customHrZonesBase.map(z => ({
        ...z,
        min: z.min + 10,
        max: z.max + 10
      }));
    }
    return customHrZonesBase;
  }, [customHrZonesBase, track.activityType]);

  // Heart Rate Zones calculation
  const hrZones = useMemo(() => {
    const zones = effectiveHrZones.map((z, idx) => {
      let minVal = z.min;
      let maxVal = z.max;
      if (idx === 0) {
        minVal = 0;
      }
      if (idx === 4) {
        maxVal = 250;
      }
      return {
        key: z.key,
        name: z.key,
        fullName: z.fullName,
        min: minVal,
        max: maxVal,
        color: z.color,
        duration: 0,
        desc: z.desc,
        benefit: z.benefit
      };
    });

    let totalHrSecs = 0;
    analysisPoints.forEach((p, idx) => {
      if (p.hr !== undefined && p.hr > 40) {
        let delta = 1;
        if (idx > 0 && analysisPoints[idx].time && analysisPoints[idx - 1].time) {
          delta = (analysisPoints[idx].time!.getTime() - analysisPoints[idx - 1].time!.getTime()) / 1000;
          if (delta <= 0 || delta > 12) delta = 1;
        }

        const match = zones.find(z => p.hr! >= z.min && p.hr! < z.max);
        if (match) {
          match.duration += delta;
          totalHrSecs += delta;
        }
      }
    });

    return zones.map((z, idx) => {
      const mins = Math.floor(z.duration / 60);
      const secs = Math.floor(z.duration % 60);
      const realMin = effectiveHrZones[idx]?.min ?? z.min;
      const realMax = effectiveHrZones[idx]?.max ?? z.max;
      return {
        ...z,
        percent: totalHrSecs > 0 ? (z.duration / totalHrSecs) * 100 : 0,
        timeStr: mins > 0 ? `${mins}m ${secs}s` : `${secs}s`,
        seconds: Math.floor(z.duration),
        rangeStr: idx === 0 
          ? `< ${Math.round(realMax)} bpm`
          : idx === 4 
            ? `> ${Math.round(realMin)} bpm`
            : `${Math.round(realMin)}-${Math.round(realMax)} bpm`
      };
    });
  }, [effectiveHrZones, analysisPoints]);

  // Cycling Power Zones
  const powerZones = useMemo(() => {
    const zones = [
      { 
        name: 'KB', 
        fullName: 'KB – Kompensationsbereich (Erholung)',
        min: 0, 
        max: 0.55 * ftp, 
        color: '#3b82f6', 
        duration: 0,
        desc: 'Besonders leichtes Kurbeln zur Entlastung des Muskel- und Skelettsystems nach Wettkämpfen.',
        benefit: 'Regeneriert den Muskeltonus und fördert die Durchblutung ohne nennenswerte Ermüdung.'
      },
      { 
        name: 'GA1', 
        fullName: 'GA1 – Grundlagenausdauer 1',
        min: 0.55 * ftp, 
        max: 0.75 * ftp, 
        color: '#10b981', 
        duration: 0,
        desc: 'Klassische Grundlagenausdauer 1. Das Fundament für jeden Radsportler.',
        benefit: 'Erhöht die Mitochondriendichte, verbessert die Sauerstoffnutzung und optimiert die Fettverbrennung.'
      },
      { 
        name: 'GA2', 
        fullName: 'GA2 – Grundlagenausdauer 2',
        min: 0.75 * ftp, 
        max: 0.90 * ftp, 
        color: '#eab308', 
        duration: 0,
        desc: 'Zügiges Reisetempo oder langes Bergfahren bei moderater bis mittlerer Atemanstrengung.',
        benefit: 'Trainiert die Kohlenhydratspeicher-Ökonomie und erhöht die aerobe Ausdauerleistung.'
      },
      { 
        name: 'EB', 
        fullName: 'EB – Entwicklungsbereich',
        min: 0.90 * ftp, 
        max: 1.05 * ftp, 
        color: '#f97316', 
        duration: 0,
        desc: 'Fahren direkt im Bereich der funktionellen Schwellenleistung (FTP). Laktat-Aufbau und -Abbau im Gleichgewicht.',
        benefit: 'Verschiebt die anaerobe Schwelle nach oben, perfekt für lange Alpenpässe oder Zeitfahren.'
      },
      { 
        name: 'SB', 
        fullName: 'SB – Spitzenbereich',
        min: 1.05 * ftp, 
        max: 2500, 
        color: '#ef4444', 
        duration: 0,
        desc: 'Maximale Leistung nahe der maximalen Sauerstoffaufnahme, anaerobe Sprints und neuromuskuläre Spitzenreize.',
        benefit: 'Maximiert VO2max, die neuromuskuläre Rekrutierung, die Laktattoleranz und die anaerobe Sprintkapazität.'
      },
    ];

    let totalEffectiveSeconds = 0;
    analysisPoints.forEach((p, i) => {
      if (p.power !== undefined) {
        let delta = 1;
        if (i > 0 && p.time && analysisPoints[i - 1].time) {
          delta = (p.time.getTime() - analysisPoints[i - 1].time.getTime()) / 1000;
          if (delta <= 0 || delta > 12) delta = 1;
        }
        
        const zone = zones.find(z => p.power! >= z.min && p.power! < z.max);
        if (zone) {
          zone.duration += delta;
          totalEffectiveSeconds += delta;
        }
      }
    });

    return zones.map((z, idx) => {
      const mins = Math.floor(z.duration / 60);
      const secs = Math.floor(z.duration % 60);
      return {
        ...z,
        percent: totalEffectiveSeconds > 0 ? (z.duration / totalEffectiveSeconds) * 100 : 0,
        timeStr: mins > 0 ? `${mins}m ${secs}s` : `${secs}s`,
        seconds: Math.floor(z.duration),
        rangeStr: idx === 0 
          ? `< ${Math.round(0.55 * ftp)} W`
          : idx === 4 
            ? `> ${Math.round(1.05 * ftp)} W`
            : `${Math.round(z.min)}-${Math.round(z.max)} W`
      };
    });
  }, [analysisPoints, ftp]);

  // Active Zones selection (Pace vs HR for runs, Power vs HR for cycling)
  const [activeZoneMetric, setActiveZoneMetric] = useState<'pace' | 'hr' | 'power'>(
    isRunning ? 'pace' : 'power'
  );

  const activeZoneData = useMemo(() => {
    if (activeZoneMetric === 'pace') return paceZones;
    if (activeZoneMetric === 'hr') return hrZones;
    return powerZones;
  }, [activeZoneMetric, paceZones, hrZones, powerZones]);

  const bestPaceDecimal = useMemo(() => {
    const validPaces = enrichedTimelineData.map(p => p.pace).filter(p => p > 2.0 && p < 15.0);
    if (validPaces.length === 0) return 0;
    // take the 5th percentile to offset single-point GPS jitter
    const sorted = [...validPaces].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.05)] || sorted[0];
  }, [enrichedTimelineData]);

  // Estimate Running Cardiac Stress Score "rTSS/hrTSS"
  const cardiacStressScore = useMemo(() => {
    if (durationSecs === 0) return 0;
    const lthr = (220 - userAge) * 0.85;
    const heartIntensity = avgHr ? avgHr / lthr : 0.82;
    // hrTSS formula
    return Math.round((durationSecs / 3600) * heartIntensity * heartIntensity * 100);
  }, [durationSecs, avgHr, userAge]);

  const avgRunningCadence = useMemo(() => {
    const cadPts = analysisPoints.filter(p => p.cadence !== undefined && p.cadence > 0).map(p => p.cadence!);
    if (cadPts.length === 0) return null;
    const rawVal = cadPts.reduce((sum, c) => sum + c, 0) / cadPts.length;
    // convert single stroke back to overall steps per min
    return Math.round(rawVal < 110 ? rawVal * 2 : rawVal);
  }, [analysisPoints]);

  const climbCategory = (ascent: number, avgGrad: number, distM: number) => {
    const score = (ascent * avgGrad) / 10 + (ascent * ascent / distM) * 0.1;
    if (score >= 200) return { label: 'HC (Hors Cat.)', color: 'bg-slate-900 border-slate-950 text-white font-black' };
    if (score >= 100) return { label: 'Kategorie 1', color: 'bg-rose-100 border-rose-200 text-rose-700 font-bold' };
    if (score >= 45) return { label: 'Kategorie 2', color: 'bg-orange-100 border-orange-200 text-orange-700 font-bold' };
    if (score >= 18) return { label: 'Kategorie 3', color: 'bg-yellow-50 border-yellow-200 text-yellow-700 font-bold' };
    return { label: 'Kategorie 4', color: 'bg-emerald-100 border-emerald-200 text-emerald-700' };
  };

  const calculateVAM = (ascent: number, startIndex: number, endIndex: number) => {
    const segment = track.points.slice(startIndex, endIndex + 1);
    const firstTime = segment.find(p => p.time !== undefined)?.time;
    const lastTime = [...segment].reverse().find(p => p.time !== undefined)?.time;
    
    if (firstTime && lastTime) {
      const hours = (lastTime.getTime() - firstTime.getTime()) / 3600000;
      if (hours > 0.005) {
        return Math.round(ascent / hours);
      }
    }
    return null;
  };

  const getClimbAvgPower = (startIndex: number, endIndex: number) => {
    const segment = track.points.slice(startIndex, endIndex + 1);
    const powerPoints = segment.filter(p => p.power !== undefined).map(p => p.power!);
    if (powerPoints.length === 0) return 0;
    return Math.round(powerPoints.reduce((a, b) => a + b, 0) / powerPoints.length);
  };

  const focusOnClimb = (startIndex: number, endIndex: number) => {
    if (!onSelection || startIndex >= track.points.length || endIndex >= track.points.length) return;
    
    const climbPoints = track.points.slice(startIndex, endIndex + 1);
    if (climbPoints.length === 0) return;
    
    const lats = climbPoints.map(p => p.lat);
    const lngs = climbPoints.map(p => p.lng);
    
    onSelection({
      minLat: Math.min(...lats) - 0.002,
      maxLat: Math.max(...lats) + 0.002,
      minLng: Math.min(...lngs) - 0.002,
      maxLng: Math.max(...lngs) + 0.002
    });
  };

  // Human readable labels for chart series
  const timelineMetricsDef = [
    { key: 'pace', name: 'Lauf-Pace', unit: ' min/km', speedAware: true, rOnly: true },
    { key: 'speed', name: 'Geschwindigkeit', unit: ' km/h', speedAware: true },
    { key: 'elevation', name: 'Höhenprofil', unit: ' m' },
    { key: 'hr', name: 'Herzfrequenz', unit: ' bpm' },
    { key: 'power', name: 'Leistung (Power)', unit: ' W' },
    { key: 'slope', name: 'Steigung', unit: '%' },
    { key: 'cadence', name: isRunning ? 'Schrittfrequenz' : 'Trittfrequenz', unit: isRunning ? ' spm' : ' rpm' },
  ];

  const availableTimelineMetrics = timelineMetricsDef.filter(m => {
    if (m.rOnly && !isRunning) return false;
    if (m.key === 'hr' && !track.points.some(p => p.hr !== undefined)) return false;
    if (m.key === 'power' && !track.points.some(p => p.power !== undefined)) return false;
    if (m.key === 'cadence' && !track.points.some(p => p.cadence !== undefined)) return false;
    return true;
  });

  const activeTimelineDef = timelineMetricsDef.find(m => m.key === activeTimelineMetric) || timelineMetricsDef[2];

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      className="fixed inset-0 z-[2000] bg-slate-50 dark:bg-slate-950 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-8 py-3 sm:py-5 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="p-2 sm:p-3 bg-indigo-600 rounded-xl text-white shadow-lg shrink-0">
            <Activity className="w-5 h-5 sm:w-7 sm:h-7" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-2xl font-bold text-slate-900 dark:text-white flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 truncate">
              <span className="truncate">{track.name}</span>
              <div className="flex flex-wrap gap-1 items-center">
                <span className={`text-[9px] sm:text-[11px] font-black uppercase px-2 py-0.5 rounded-full ${isRunning ? 'bg-orange-100 text-orange-700 border border-orange-200 shadow-2xs' : 'bg-blue-100 text-blue-700 border border-blue-200 shadow-2xs'}`}>
                  {isRunning ? '🏃 Laufen' : '🚴 Rad'}
                </span>
                {selectionBounds && (
                  <span className="text-[9px] sm:text-xs bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-350 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                    Auswahl
                  </span>
                )}
              </div>
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-[10px] sm:text-sm font-medium">
              Performance- & {isRunning ? 'Pace-Analyse' : 'Leistungsdaten'}
            </p>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-1.5 sm:p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0 cursor-pointer"
        >
          <X className="w-6 h-6 sm:w-8 sm:h-8" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-7xl mx-auto space-y-8">
          
          {/* Quick Navigation Anchor Bar */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 rounded-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-3 shadow-xs font-sans">
            <span className="text-xs font-black uppercase text-slate-500 tracking-wider flex items-center gap-1.5 px-2">
              <Info size={14} className="text-indigo-600 dark:text-indigo-400" /> Schnellnavigation & Theorie:
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button 
                onClick={() => {
                  const el = document.getElementById('perf-lab');
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
                className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-1 shadow-2xs"
              >
                ⚡ Performance-Labor & Rechner
              </button>
              <button 
                onClick={() => {
                  const el = document.getElementById('slope-classifier');
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
                className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-1 shadow-2xs"
              >
                🧗 Steigungs-Klassifizierer
              </button>
              <button 
                onClick={() => {
                  const el = document.getElementById('elevation-analysis');
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
                className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-1 shadow-2xs"
              >
                ⛰️ Höhenprofil & Steigungen
              </button>
              <button 
                onClick={() => setShowTheoryHandbook(true)}
                className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-1 shadow-2xs"
              >
                📖 Theorie-Handbuch (Physik & Biomechanik)
              </button>
            </div>
          </div>

          {/* Dynamic Metric Cards Grid depending on Activity Type */}
          {isRunning ? (
            <div className="flex sm:grid overflow-x-auto sm:overflow-x-visible pb-1 sm:pb-0 gap-4 sm:grid-cols-2 lg:grid-cols-5 snap-x max-w-full no-scrollbar">
              <MetricCard 
                label="Ø Pace (Tempo)" 
                value={formatPaceDecimal(averagePaceSeconds / 60)} 
                icon={<Clock className="text-orange-500" />}
                subValue={`Beste: ${formatPaceDecimal(bestPaceDecimal)}`}
                color="border-orange-200 bg-orange-50/30 dark:border-orange-900/40 dark:bg-orange-950/10"
                tooltip="Durchschnittliches Tempo in Minuten pro Kilometer. Phasen unter 2 km/h sind automatisch gefiltert, um Pausen nicht fälschlich einzurechnen."
              />
              <MetricCard 
                label="Cardio-Belastung (TSS)" 
                value={cardiacStressScore} 
                icon={<Shield className="text-indigo-500" />}
                subValue="Training Stress Score"
                color="border-indigo-200 bg-indigo-50/30 dark:border-indigo-900/40 dark:bg-indigo-950/10"
                tooltip="Herz-Kreislauf-Belastung geschätzt an deiner maximalen Herzfrequenz. Entspricht der physiologischen Intensität multipliziert mit der Dauer."
              />
              <MetricCard 
                label="VO2max Schätz. (Laufen)" 
                value={vo2maxEstimate || '--'} 
                icon={<Activity className="text-purple-500" />}
                subValue={vo2Category?.label || 'Ausdauerkapazität'}
                color="border-purple-200 bg-purple-50/30 dark:border-purple-900/40 dark:bg-purple-950/10"
                tooltip="Berechnet nach der ACSM Formel für Läufer: VO2 = 0.2 * v + 0.9 * v * Steigung + 3.5. Exponentiell gewichtet und korrigiert basierend auf der HR-Antwort."
              />
              <MetricCard 
                label="Tritt-/Schrittfrequenz" 
                value={avgRunningCadence ? `${avgRunningCadence} spm` : '--'} 
                icon={<TrendingUp className="text-emerald-500" />}
                subValue="Steps Per Minute"
                color="border-emerald-200 bg-emerald-50/30 dark:border-emerald-900/40 dark:bg-emerald-950/10"
                tooltip="Deine durchschnittliche Schrittfrequenz (beide Füße zusammen). Ein optimales Ziel für gesundes Laufen liegt meist bei 170-185 Schritten pro Minute."
              />
              <MetricCard 
                label="Energieverbrauch" 
                value={`${Math.round((avgHr ? 11 : 8.5) * (userWeight || 75) * (durationSecs / 3600))} kcal`} 
                icon={<Zap className="text-rose-500" />}
                subValue="Aktiv-Verbrauch"
                color="border-rose-200 bg-rose-50/30 dark:border-rose-900/40 dark:bg-rose-950/10"
                tooltip="Kalorienberechnung basierend auf dem metabolischen Äquivalent (MET) deiner durchschnittlichen Laufgeschwindigkeit im Verhältnis zur Gesamtzeit und deinem Körpergewicht."
              />
            </div>
          ) : (
            <div className="flex sm:grid overflow-x-auto sm:overflow-x-visible pb-1 sm:pb-0 gap-4 sm:grid-cols-2 lg:grid-cols-5 snap-x max-w-full no-scrollbar">
              <MetricCard 
                label="Normalized Power" 
                value={`${Math.round(powerStats?.normalizedPower || 0)} W`} 
                icon={<Zap className="text-yellow-500" />}
                subValue={`VI: ${(powerStats?.variabilityIndex || 1).toFixed(2)}`}
                color="border-yellow-200 bg-yellow-50/30 dark:border-yellow-905 dark:bg-yellow-950/10"
                tooltip="NP (Coggan): Ein gleitender 30-Sekunden Durchschnitt, der vierte Potenzierung nutzt, um die physiologischen Kosten intensiver Belastungsspitzen genauer abzubilden."
              />
              <MetricCard 
                label="TSS" 
                value={Math.round(powerStats?.tss || 0)} 
                icon={<Shield className="text-indigo-500" />}
                subValue="Training Stress Score"
                color="border-indigo-200 bg-indigo-50/30 dark:border-indigo-905 dark:bg-indigo-950/10"
                tooltip="Gesamtbelastung der Einheit. Formel: (Dauer in s * NP * IF) / (FTP * 3600) * 100. Ein Wert von 100 entspricht einer einstündigen Belastung exakt an der FTP-Grenze."
              />
              <MetricCard 
                label="VO2max Schätz. (Rad)" 
                value={vo2maxEstimate || '--'} 
                icon={<Activity className="text-purple-500" />}
                subValue={vo2Category?.label || 'Ausdauerkapazität'}
                color="border-purple-200 bg-purple-50/30 dark:border-purple-905 dark:bg-purple-950/10"
                tooltip="Geschätzt via ACSM-Leistungsformel: (10.8 * Watt/kg) + 7. Wenn HR-Daten vorliegen, wird zusätzlich die Leistung bei maximaler Herzfrequenz linear extrapoliert für höhere Genauigkeit."
              />
              <MetricCard 
                label="Intensity Factor" 
                value={(powerStats?.intensityFactor || 0).toFixed(2)} 
                icon={<TrendingUp className="text-emerald-500" />}
                subValue={`${Math.round((powerStats?.intensityFactor || 0) * 100)}% von FTP`}
                color="border-emerald-200 bg-emerald-50/30 dark:border-emerald-905 dark:bg-emerald-950/10"
                tooltip="IF = NP / FTP. Beschreibt die relative Intensität. Eine 'gemütliche' Fahrt liegt oft bei 0.6-0.7, ein intensives Rennen bei 0.9-1.05."
              />
              <MetricCard 
                label="Arbeit" 
                value={`${Math.round(powerStats?.work || 0)} kJ`} 
                icon={<Activity className="text-rose-500" />}
                subValue="Gesamtleistung"
                color="border-rose-200 bg-rose-50/30 dark:border-rose-905 dark:bg-rose-950/10"
                tooltip="Die physikalisch geleistete Arbeit in Kilojoule. Da der Wirkungsgrad des Menschen beim Radfahren ca. 20-25% beträgt, entspricht dieser Wert grob den verbrannten Kilokalorien."
              />
            </div>
          )}

          {/* Interactive Plot Controls & Timeline Graph */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Main Interactive Diagram with Selection */}
            <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <BarChart2 size={20} className="text-indigo-600 dark:text-indigo-400" />
                    Werte-Profile über Distanz
                  </h3>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Klicke auf die Tabs unten, um die Metrik im Diagramm zu wechseln.</p>
                </div>
                <button 
                  onClick={() => setFullscreenChart('pd')}
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors self-end sm:self-auto"
                  title="Vollbild"
                >
                  <Maximize2 size={18} />
                </button>
              </div>

              {/* Responsive Tabs instead of a rigid timeline */}
              <div className="flex flex-wrap gap-1.5 mb-6 bg-slate-100 dark:bg-slate-950 p-1 rounded-xl">
                {availableTimelineMetrics.map(m => (
                  <button
                    key={m.key}
                    onClick={() => setActiveTimelineMetric(m.key)}
                    className={`flex-1 min-w-[80px] text-center px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      activeTimelineMetric === m.key 
                        ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' 
                        : 'text-slate-500 hover:text-slate-705 dark:hover:text-slate-300'
                    }`}
                  >
                    {m.name}
                  </button>
                ))}
              </div>

              {/* Chart Plot Area */}
              <div className="h-64 sm:h-72 w-full text-zinc-900">
                {timelineChartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-400">Keine Datenpunkte geladen</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorTimeline" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.12)" />
                      <XAxis 
                        dataKey="distance" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#94a3b8', fontSize: 10 }} 
                        tickFormatter={(val) => `${val}km`}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#94a3b8', fontSize: 10 }}
                        unit={activeTimelineDef.unit}
                        domain={['auto', 'auto']}
                        reversed={activeTimelineMetric === 'pace'} // reverse pace chart so faster is higher
                      />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                        formatter={(value: any) => {
                          if (activeTimelineMetric === 'pace') {
                            return [formatPaceDecimal(Number(value)), 'Pace'];
                          }
                          return [`${value}${activeTimelineDef.unit}`, activeTimelineDef.name];
                        }}
                        labelFormatter={(dist) => `Distanz: ${dist} km`}
                      />
                      <Area 
                        type="monotone" 
                        dataKey={activeTimelineMetric} 
                        stroke="#4f46e5" 
                        strokeWidth={3}
                        fillOpacity={1} 
                        fill="url(#colorTimeline)" 
                        animationDuration={600}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Zone Distribution Profile */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col relative">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Zap size={20} className="text-amber-500" />
                  Zonenverteilung
                </h3>
                <button 
                  onClick={() => setFullscreenChart('zones')}
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  title="Vollbild"
                >
                  <Maximize2 size={16} />
                </button>
              </div>

              {/* Select Zones Metric */}
              <div className="flex border border-slate-200 dark:border-slate-800 p-0.5 rounded-lg mb-4 text-xs font-semibold bg-slate-50 dark:bg-slate-950">
                {isRunning && (
                  <button 
                    onClick={() => setActiveZoneMetric('pace')}
                    className={`flex-1 py-1 text-center rounded ${activeZoneMetric === 'pace' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'}`}
                  >
                    Pace-Zonen
                  </button>
                )}
                {track.points.some(p => p.hr !== undefined) && (
                  <button 
                    onClick={() => setActiveZoneMetric('hr')}
                    className={`flex-1 py-1 text-center rounded ${activeZoneMetric === 'hr' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'}`}
                  >
                    Herz-Zonen
                  </button>
                )}
                {(!isRunning || track.points.some(p => p.power !== undefined)) && (
                  <button 
                    onClick={() => setActiveZoneMetric('power')}
                    className={`flex-1 py-1 text-center rounded ${activeZoneMetric === 'power' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'}`}
                  >
                    Watts/Power
                  </button>
                )}
              </div>

              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activeZoneData} layout="vertical" margin={{ left: -10, right: 10 }}>
                    <XAxis type="number" hide />
                    <YAxis 
                      dataKey="name" 
                      type="category" 
                      axisLine={false} 
                      tickLine={false}
                      width={110}
                      tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                      tickFormatter={(val) => val.split(' ')[0]} // Short Zone Identifier eg Z1
                    />
                    <Tooltip 
                      cursor={{ fill: 'transparent' }}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-white dark:bg-slate-800 p-3 rounded-xl shadow-xl border border-slate-150 dark:border-slate-700">
                              <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1">{data.name}</p>
                              <div className="flex items-baseline gap-2">
                                <span className="text-lg font-black text-slate-900 dark:text-white">{data.percent.toFixed(1)}%</span>
                                <span className="text-xs font-semibold text-slate-400">({data.timeStr})</span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="percent" radius={[0, 4, 4, 0]} barSize={16}>
                      {activeZoneData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Tabular summary with hover explanations */}
              <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2 mt-auto relative">
                <div className="grid grid-cols-4 text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider">
                  <div className="col-span-2">Bereich</div>
                  <div className="text-right">Anteil</div>
                  <div className="text-right">Dauer</div>
                </div>
                {activeZoneData.map((entry, index) => (
                  <div 
                    key={index} 
                    className="relative group grid grid-cols-4 text-xs font-semibold items-center hover:bg-slate-50 dark:hover:bg-slate-800/50 p-1 rounded transition-colors text-slate-700 dark:text-slate-300 cursor-help"
                  >
                    <div className="col-span-2 flex items-center gap-2 overflow-hidden truncate">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                      <span className="font-bold truncate" title={entry.name}>{entry.name}</span>
                      <span className="text-[9px] text-slate-400 dark:text-slate-500 font-mono hidden sm:inline-block">({entry.rangeStr})</span>
                    </div>
                    <div className="text-right font-mono font-bold text-slate-800 dark:text-slate-100">
                      {entry.percent.toFixed(1)}%
                    </div>
                    <div className="text-right font-mono text-slate-400 dark:text-slate-500">
                      {entry.timeStr}
                    </div>

                    {/* Popover Hover Tooltip explanation */}
                    <div className="absolute left-[2%] bottom-[125%] hidden group-hover:flex flex-col z-[3000] bg-slate-900/95 border border-slate-800 text-white rounded-2xl p-4 w-72 shadow-2xl pointer-events-none transition-all duration-200 scale-95 group-hover:scale-100 origin-bottom backdrop-blur-md">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                        <span className="font-extrabold text-xs text-slate-100 tracking-wider">
                          {entry.fullName || entry.name}
                        </span>
                      </div>
                      <div className="text-[9px] font-mono text-slate-400 mb-2">Grenzwerte: {entry.rangeStr}</div>
                      <p className="text-[11px] text-slate-300 leading-relaxed font-semibold">
                        {entry.desc}
                      </p>
                      {entry.benefit && (
                        <div className="mt-2 pt-2 border-t border-slate-800/80 flex flex-col gap-0.5">
                          <span className="text-[9px] font-black uppercase text-emerald-400 tracking-wider">Sportliche Wirkung:</span>
                          <span className="text-[10.5px] text-slate-350 leading-snug font-medium">
                            {entry.benefit}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Running vs Cycling Best Effort Summaries */}
          {isRunning ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-center bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="space-y-2">
                <div className="text-slate-400 dark:text-slate-450 text-sm font-semibold">Durchschnittliches Tempo</div>
                <div className="text-3xl font-black text-slate-905 dark:text-white">
                  {formatPaceDecimal(averagePaceSeconds / 60)}
                </div>
                <div className="text-xs text-orange-500 font-bold uppercase tracking-widest">Ø Training Pace</div>
              </div>
              <div className="space-y-2 border-x border-slate-100 dark:border-slate-800">
                <div className="text-slate-400 dark:text-slate-450 text-sm font-semibold">Beste Pace (Peak Leistung)</div>
                <div className="text-3xl font-black text-slate-905 dark:text-white">
                  {formatPaceDecimal(bestPaceDecimal)}
                </div>
                <div className="text-xs text-emerald-500 font-bold uppercase tracking-widest">Spitzen-Intervall</div>
              </div>
              <div className="space-y-2">
                <div className="text-slate-400 dark:text-slate-450 text-sm font-semibold">Aerobe Schwelle (Puls)</div>
                <div className="text-3xl font-black text-slate-905 dark:text-white">
                  {Math.round((220 - userAge) * 0.82)} bpm
                </div>
                <div className="text-xs text-rose-500 font-bold uppercase tracking-widest">Basierend auf Alter {userAge}</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-center bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="space-y-2">
                <div className="text-slate-400 text-sm font-medium">Beste 60 Sek.</div>
                <div className="text-3xl font-black text-slate-900 dark:text-white">{Math.round(powerStats?.best1m || 0)}W</div>
                <div className="text-xs text-indigo-505 font-bold uppercase tracking-widest">Sprint / Attacke</div>
              </div>
              <div className="space-y-2 border-x border-slate-100 dark:border-slate-800">
                <div className="text-slate-400 text-sm font-medium">Beste 20 Min.</div>
                <div className="text-3xl font-black text-slate-900 dark:text-white">{Math.round(powerStats?.best20m || 0)}W</div>
                <div className="text-xs text-emerald-550 font-bold uppercase tracking-widest">Klettern / TT</div>
              </div>
              <div className="space-y-2">
                <div className="text-slate-400 text-sm font-medium">Geschätztes FTP</div>
                <div className="text-3xl font-black text-slate-900 dark:text-white">{Math.round((powerStats?.best20m || 0) * 0.95)}W</div>
                <div className="text-xs text-rose-505 font-bold uppercase tracking-widest">Basierend auf 20m</div>
              </div>
            </div>
          )}

          {/* GoldenCheetah inspired overview */}
          <div className="bg-indigo-950 dark:bg-slate-900 text-white p-8 rounded-3xl overflow-hidden relative shadow-xl">
             <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-12">
               <div className="space-y-4">
                 <div className="flex items-center gap-2 opacity-80">
                   <Clock size={18} />
                   <span className="text-sm font-bold uppercase tracking-widest">Gesamtzeit</span>
                 </div>
                 <div className="text-4xl font-black">
                   {durationSecs ? `${Math.floor(durationSecs / 3600)}h ${Math.floor((durationSecs % 3600) / 60)}m ${Math.floor(durationSecs % 60)}s` : '--'}
                 </div>
                 <p className="text-indigo-200 text-sm leading-relaxed">Gesamte aufgezeichnete Aktivitätszeit für diesen Bereich.</p>
               </div>
               
               <div className="space-y-4">
                 <div className="flex items-center gap-2 opacity-80">
                   <Heart size={18} />
                   <span className="text-sm font-bold uppercase tracking-widest">Herzfrequenz (Ø)</span>
                 </div>
                 <div className="text-4xl font-black">
                   {avgHr ? `${avgHr} bpm` : '--'}
                 </div>
                 <p className="text-indigo-200 text-sm leading-relaxed">Durchschnittliche Pulsbelastung des Herzens.</p>
               </div>

               <div className="space-y-4">
                 <div className="flex items-center gap-2 opacity-80">
                   <TrendingUp size={18} />
                   <span className="text-sm font-bold uppercase tracking-widest">Strecke</span>
                 </div>
                 <div className="text-4xl font-black">
                   {useDistance.toFixed(2)} km
                 </div>
                 <p className="text-indigo-200 text-sm leading-relaxed">Zurückgelegte Wegstrecke basierend auf GPS-Koordinaten.</p>
               </div>
             </div>
             
             {/* Abstract background decorations */}
             <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -mr-48 -mt-48 blur-3xl pointer-events-none" />
             <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full -ml-32 -mb-32 blur-3xl pointer-events-none" />
          </div>

          {/* Dynamic Performance Laboratory & Terrain Profiler */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* Left: Dynamic Performance Laboratory */}
            <div id="perf-lab" className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-6 scroll-mt-20">
              <div className="space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 rounded-xl text-indigo-600 dark:text-indigo-400">
                    <Settings size={20} className="animate-spin" style={{ animationDuration: '6s' }} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">
                      ⚡ Performance-Labor & Rechner
                    </h3>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Passe Parameter an und sehe die berechnete Durchschnitts-Wattzahl sowie den Kalorienverbrauch in Echtzeit.
                    </p>
                  </div>
                </div>

                {/* Slider / Config Controls Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 bg-slate-50 dark:bg-slate-950/40 p-4 rounded-xl border border-slate-100 dark:border-slate-800/80">
                  
                  {/* Rider Weight Input */}
                  <div className="space-y-1.5 font-sans">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                      <span>Körpergewicht (Gesamt)</span>
                      <span className="font-mono text-slate-700 dark:text-slate-200">{labRiderWeight} kg</span>
                    </div>
                    <input
                      type="range"
                      min="45"
                      max="140"
                      step="1"
                      value={labRiderWeight}
                      onChange={(e) => setLabRiderWeight(Number(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                  </div>

                  {/* Wind speed input */}
                  <div className="space-y-1.5 font-sans">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                      <span>Gegenwind (Durchschnitt)</span>
                      <span className="font-mono text-slate-700 dark:text-slate-200">{labWindSpeed} km/h</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="45"
                      step="1"
                      value={labWindSpeed}
                      onChange={(e) => setLabWindSpeed(Number(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                  </div>

                  {!isRunning ? (
                    <>
                      {/* Bicycle weight input */}
                      <div className="space-y-1.5 font-sans">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                          <span>Fahrrad & Ausrüstung</span>
                          <span className="font-mono text-slate-700 dark:text-slate-200">{labBikeWeight} kg</span>
                        </div>
                        <input
                          type="range"
                          min="5"
                          max="25"
                          step="0.5"
                          value={labBikeWeight}
                          onChange={(e) => setLabBikeWeight(Number(e.target.value))}
                          className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                      </div>

                      {/* Riding Position */}
                      <div className="space-y-1.5 font-sans">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block">Sitzposition (Aero)</span>
                        <div className="grid grid-cols-3 gap-1 bg-white dark:bg-slate-900 p-1 rounded-lg border border-slate-105 dark:border-slate-800">
                          {(['upright', 'hoods', 'drops'] as const).map((pos) => (
                            <button
                              key={pos}
                              type="button"
                              onClick={() => setLabPosition(pos)}
                              className={`py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                                labPosition === pos
                                  ? 'bg-indigo-600 text-white shadow-sm'
                                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              {pos === 'upright' ? 'Aufrecht' : pos === 'hoods' ? 'Griffe' : 'Lenker'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Tire Roll Resistance */}
                      <div className="col-span-1 sm:col-span-2 space-y-1.5 font-sans">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block">Reifentyp & Geländewiderstand</span>
                        <div className="grid grid-cols-3 gap-1 bg-white dark:bg-slate-900 p-1 rounded-lg border border-slate-105 dark:border-slate-800">
                          {(['road', 'gravel', 'mtb'] as const).map((type) => (
                            <button
                              key={type}
                              type="button"
                              onClick={() => setLabRollingResistance(type)}
                              className={`py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                                labRollingResistance === type
                                  ? 'bg-indigo-600 text-white shadow-sm'
                                  : 'text-slate-505 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              {type === 'road' ? 'Road' : type === 'gravel' ? 'Gravel' : 'MTB'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Gear / Clothing weight */}
                      <div className="space-y-1.5 font-sans">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-505 dark:text-slate-405">
                          <span>Ausrüstung & Zusatzgewicht</span>
                          <span className="font-mono text-slate-700 dark:text-slate-200">{labBikeWeight} kg</span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="8"
                          step="0.1"
                          value={labBikeWeight}
                          onChange={(e) => setLabBikeWeight(Number(e.target.value))}
                          className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                      </div>

                      {/* Running Style Eco */}
                      <div className="space-y-1.5 flex flex-col justify-end font-sans">
                        <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-705 dark:text-indigo-300 rounded-xl border border-indigo-100/30 text-[10.5px] leading-relaxed font-semibold">
                          💡 <strong>Lauf-Biomechanik:</strong> Der metabolische Wirkungsgrad wird automatisch an die Steigungen angepasst, um die erhöhte elastische Speichereffizienz thermodynamisch abzubilden.
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Dynamic Lab Results Grid */}
              {labCalculations && (
                <div className="space-y-4 font-sans pt-4 border-t border-slate-100 dark:border-slate-800/80">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-slate-50 dark:bg-slate-950/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800 text-center relative">
                      <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider flex items-center justify-center gap-1">
                        Ø Sim-Leistung
                        <button 
                          onClick={() => setSelectedTheoryMetric('avgPower')}
                          className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition cursor-pointer"
                          title="Physikalische Leistungsformel anzeigen"
                        >
                          <HelpCircle size={11} />
                        </button>
                      </span>
                      <span className="text-base font-black text-slate-800 dark:text-white font-mono">{labCalculations.avgPower} W</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-950/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800 text-center relative animate-pulse" style={{ animationDuration: '4s' }}>
                      <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider flex items-center justify-center gap-1">
                        Phys. Arbeit
                        <button 
                          onClick={() => setSelectedTheoryMetric('workKj')}
                          className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition cursor-pointer"
                          title="Physikalische Arbeit erklären"
                        >
                          <HelpCircle size={11} />
                        </button>
                      </span>
                      <span className="text-base font-black text-indigo-650 dark:text-indigo-400 font-mono">{labCalculations.workKj} kJ</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-950/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800 text-center relative">
                      <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider flex items-center justify-center gap-1">
                        Metabol. Energie
                        <button 
                          onClick={() => setSelectedTheoryMetric('calories')}
                          className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition cursor-pointer"
                          title="Thermodynamischen Wirkungsgrad erklären"
                        >
                          <HelpCircle size={11} />
                        </button>
                      </span>
                      <span className="text-base font-black text-rose-500 font-mono">{labCalculations.calories} kcal</span>
                    </div>
                  </div>

                  {/* Fat vs Carb Oxidation segment */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-950/50 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
                      <span className="flex items-center gap-1">
                        <Flame size={14} className="text-amber-500 animate-pulse" /> 
                        Fettschmelze-Anteil (Fat-Ox)
                        <button 
                          onClick={() => setSelectedTheoryMetric('fatOx')}
                          className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition cursor-pointer"
                          title="Fettverbrennungs-Zusammenhang einblenden"
                        >
                          <HelpCircle size={12} />
                        </button>
                      </span>
                      <span className="flex items-center gap-1">
                        Kohlenhydrate (Glykogen)
                        <button 
                          onClick={() => setSelectedTheoryMetric('carbOx')}
                          className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition cursor-pointer"
                          title="Glykogen-Entleerungs-Modell einblenden"
                        >
                          <HelpCircle size={12} />
                        </button>
                      </span>
                    </div>
                    
                    {/* Double progress bar */}
                    <div className="h-2.5 w-full bg-slate-205 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
                      <div className="bg-amber-500 h-full transition-all" style={{ width: `${labCalculations.fatPct}%` }} />
                      <div className="bg-rose-500 h-full transition-all" style={{ width: `${labCalculations.carbPct}%` }} />
                    </div>

                    <div className="flex items-center justify-between font-mono text-[9.5px] text-slate-400 dark:text-slate-500 font-bold">
                      <span>{labCalculations.fatPct}% ({labCalculations.fatGrams}g Fett)</span>
                      <span>{labCalculations.carbPct}% ({labCalculations.carbGrams}g Carbs)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

             {/* Right: Automatic Slope Classifier */}
            <div id="slope-classifier" className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-6 scroll-mt-20">
              
              <div className="space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-50 dark:bg-emerald-950/60 rounded-xl text-emerald-600 dark:text-emerald-400">
                    <TrendingUp size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                      🧗 Steigungs-Klassifizierer
                      <button 
                        onClick={() => setSelectedTheoryMetric('slopeClassifierAll')}
                        className="p-1 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition cursor-pointer"
                        title="Theorie der Höhenglättung & Einteilung anzeigen"
                      >
                        <HelpCircle size={15} />
                      </button>
                    </h3>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Automatische Analyse der Gradienten-Sektionen und topologische Einstufung der Route.
                    </p>
                  </div>
                </div>

                {slopeCategorization && (
                  <div className="space-y-5 font-sans">
                    {/* Overall Classification Character Card */}
                    <div className="p-4 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 dark:from-emerald-950/10 dark:to-teal-950/10 rounded-xl border border-emerald-500/10 dark:border-emerald-500/10 relative">
                      <div className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400 tracking-wider flex items-center gap-1">
                        Topografische Einstufung:
                        <button 
                          onClick={() => setSelectedTheoryMetric('slopeClassifier')}
                          className="text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition cursor-pointer"
                          title="Berechnungsmethode & Einstufungskriterien anzeigen"
                        >
                          <HelpCircle size={11} />
                        </button>
                      </div>
                      <div className="text-lg font-black text-slate-800 dark:text-slate-100 mt-1">{slopeCategorization.character}</div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 font-semibold leading-relaxed">{slopeCategorization.desc}</p>
                    </div>

                    {/* Gradient stacked progress bar */}
                    <div className="space-y-2">
                      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">Verlauf über die Gesamtstrecke</span>
                      <div className="h-4 w-full bg-slate-100 dark:bg-slate-850 rounded-full flex overflow-hidden shadow-inner font-mono text-[9px] text-white font-extrabold select-none">
                        {slopeCategorization.categories.map((cat, idx) => (
                          cat.pct > 0.01 && (
                            <div
                              key={idx}
                              className={`${cat.color} h-full transition-all flex items-center justify-center cursor-help`}
                              style={{ width: `${cat.pct}%` }}
                              title={`${cat.name}: ${cat.pct.toFixed(1)}% (${cat.dist.toFixed(2)} km)`}
                            >
                              {cat.pct > 7 && `${Math.round(cat.pct)}%`}
                            </div>
                          )
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Categorization list */}
              {slopeCategorization && (
                <div className="grid grid-cols-2 gap-3 mt-6 border-t border-slate-100 dark:border-slate-800 pt-5 text-left font-sans">
                  {slopeCategorization.categories.map((cat, idx) => (
                    <div key={idx} className="flex gap-2.5 items-start">
                      <span className={`w-3 h-3 rounded-full mt-1 shrink-0 ${cat.color}`} />
                      <div className="min-w-0">
                        <div className="text-[11px] font-black text-slate-705 dark:text-slate-350 leading-tight truncate" title={cat.name}>
                          {cat.name}
                        </div>
                        <div className="text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500">
                          {cat.dist.toFixed(2)} km <span className="text-slate-400 dark:text-slate-600">({cat.pct.toFixed(1)}%)</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Elevation PROFILE Analysis */}
          <div id="elevation-analysis" className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 scroll-mt-20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <span className="bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-450 p-2 rounded-xl text-lg block leading-none">
                    ⛰️
                  </span>
                  Höhenprofil- & Steigungsanalyse
                </h3>
                <p className="text-slate-400 dark:text-slate-500 text-sm font-semibold max-w-xl">
                  Klassifizierung nach FIETS-Index, Steigraten (VAM) und Karten-Segmentfokus.
                </p>
              </div>
              {selectionBounds && (
                <button
                  onClick={() => onSelection && onSelection(null)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-705 text-slate-700 dark:text-white rounded-xl text-xs font-bold transition-all border border-slate-200 dark:border-slate-700 cursor-pointer self-start sm:self-auto flex items-center gap-1"
                >
                  <span>✖</span> Fokus zurücksetzen
                </button>
              )}
            </div>

            {!computedClimbs || computedClimbs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 text-center">
                <p className="text-sm font-bold text-slate-500">Keine signifikanten Steilstücke erkannt</p>
                <p className="text-xs max-w-md mt-1 text-slate-400 font-semibold">
                  Auf diesem Track wurden keine Anstiege mit einer Länge über 150 Meter und einer mittleren Steigung von mindestens 1.5% identifiziert.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {computedClimbs.map((climb, idx) => {
                  const cat = climbCategory(climb.ascent, climb.avgGradient, climb.distance);
                  const vam = calculateVAM(climb.ascent, climb.startIndex, climb.endIndex);
                  const avgPower = getClimbAvgPower(climb.startIndex, climb.endIndex);
                  const wKgRatio = (avgPower / (userWeight || 75)).toFixed(2);
                  const climbPoints = track.points.slice(climb.startIndex, climb.endIndex + 1);
                  const climbSpeedTotal = climbPoints.length > 1 && climbPoints[0].time && climbPoints[climbPoints.length - 1].time
                    ? (climb.distance / 1000) / ((climbPoints[climbPoints.length - 1].time!.getTime() - climbPoints[0].time!.getTime()) / 3600000)
                    : null;

                  const climbTimeSec = track.points[climb.endIndex].time && track.points[climb.startIndex].time
                    ? Math.round((track.points[climb.endIndex].time!.getTime() - track.points[climb.startIndex].time!.getTime()) / 1000)
                    : null;

                  const isFocused = selectionBounds && 
                    Math.abs(selectionBounds.minLat - (Math.min(...track.points.slice(climb.startIndex, climb.endIndex + 1).map(p => p.lat)) - 0.002)) < 0.001;

                  return (
                     <div 
                       key={idx}
                       className={`border rounded-2xl p-6 transition-all flex flex-col justify-between relative overflow-hidden ${
                         isFocused 
                           ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20 shadow-md ring-1 ring-indigo-500/30' 
                           : 'border-slate-200 dark:border-slate-800 hover:border-indigo-400 hover:bg-slate-50/50 shadow-sm'
                       }`}
                     >
                       {isFocused && (
                         <div className="absolute top-0 right-0 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-bl-xl">
                           Fokusiert
                         </div>
                       )}

                       <div>
                         <div className="flex items-center justify-between mb-3">
                           <span className="font-extrabold text-slate-900 dark:text-white text-lg">
                             Anstieg #{idx + 1}
                           </span>
                           <span className={`px-2.5 py-1 text-[11px] font-extrabold rounded-full border ${cat.color}`}>
                             {cat.label}
                           </span>
                         </div>

                         <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 my-4 border-y border-slate-100 dark:border-slate-800 py-4 text-xs font-semibold text-slate-600 dark:text-slate-400">
                           <div>
                             <span className="text-[10px] text-slate-400 uppercase tracking-widest block font-bold mb-0.5">Länge</span>
                             <span className="font-black text-slate-900 dark:text-white text-sm">{(climb.distance / 1000).toFixed(2)} km</span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-405 uppercase tracking-widest block font-bold mb-0.5 font-sans">Höhendifferenz</span>
                             <span className="font-black text-rose-600 text-sm">+{Math.round(climb.ascent)} Hm</span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-405 uppercase tracking-widest block font-bold mb-0.5">Steigung (Ø / Max)</span>
                             <span className="font-black text-slate-900 dark:text-white text-sm">{climb.avgGradient.toFixed(1)}% / {climb.maxGradient.toFixed(1)}%</span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-405 uppercase tracking-widest block font-bold mb-0.5">Berggeschw. / Pace</span>
                             <span className="font-black text-slate-900 dark:text-white text-sm">
                               {climbSpeedTotal 
                                 ? isRunning 
                                   ? formatPaceDecimal(60 / climbSpeedTotal) 
                                   : `${climbSpeedTotal.toFixed(1)} km/h`
                                 : '--'
                               }
                             </span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-405 uppercase tracking-widest block font-bold mb-0.5">Steigrate (VAM)</span>
                             <span className="font-black text-indigo-600 dark:text-indigo-400 text-sm">{vam ? `${vam} Hm/h` : '--'}</span>
                           </div>
                           <div>
                             <span className="text-[10px] text-slate-405 uppercase tracking-widest block font-bold mb-0.5">Ø Leistung</span>
                             <span className="font-black text-amber-600 text-sm">
                               {avgPower ? `${avgPower} W` : (isRunning ? 'Wird simuliert' : '--')}
                             </span>
                           </div>
                         </div>
                       </div>

                       <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-bold">
                         {climbTimeSec ? (
                           <span className="text-slate-400 font-medium font-mono text-center sm:text-left">
                             Dauer: {Math.floor(climbTimeSec / 60)}m {climbTimeSec % 60}s
                           </span>
                         ) : (
                           <div />
                         )}
                         <button
                           onClick={() => focusOnClimb(climb.startIndex, climb.endIndex)}
                           className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all font-bold text-center flex items-center justify-center gap-1 shadow-sm cursor-pointer"
                         >
                           <span>🔍</span> Auf Karte zoomen
                         </button>
                       </div>
                     </div>
                   );
                 })}
               </div>
            )}
          </div>

          {/* Fullscreen Modal View for interactive detail graphs */}
          <AnimatePresence>
            {fullscreenChart && (
              <div className="fixed inset-0 z-[400] bg-white dark:bg-slate-950 flex flex-col p-4 sm:p-10 transition-all overflow-hidden">
                <motion.div 
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="flex-1 flex flex-col h-full overflow-hidden"
                >
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                      <div className={`p-4 rounded-2xl ${fullscreenChart === 'pd' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50' : 'bg-amber-50 text-amber-600 dark:bg-amber-950/50'}`}>
                        {fullscreenChart === 'pd' ? <BarChart2 size={32} /> : <Zap size={32} />}
                      </div>
                      <div>
                        <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                          {fullscreenChart === 'pd' ? `Verlaufsprofil: ${activeTimelineDef.name}` : `Detaillierte Zonen: ${activeZoneMetric === 'hr' ? 'Herzrate' : activeZoneMetric === 'pace' ? 'Pace' : 'Watt'}`}
                        </h3>
                        <p className="text-sm font-bold text-slate-450 uppercase tracking-widest">Detail-Analyse im Vollbildmodus</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setFullscreenChart(null)}
                      className="p-4 bg-slate-100 dark:bg-slate-800 rounded-2xl text-slate-600 dark:text-slate-200 hover:bg-slate-200"
                    >
                      <X size={28} />
                    </button>
                  </div>
                  
                  <div className="flex-1 w-full bg-slate-900 rounded-[32px] p-6 sm:p-10 shadow-2xl relative overflow-hidden flex flex-col">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[120px] rounded-full pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/10 blur-[120px] rounded-full pointer-events-none" />
                    
                    <div className="flex-1 w-full min-h-0 text-white">
                      <ResponsiveContainer width="100%" height="100%">
                        {fullscreenChart === 'pd' ? (
                          <AreaChart data={timelineChartData}>
                            <defs>
                              <linearGradient id="pdGradModal" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#818cf8" stopOpacity={0.4}/>
                                <stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                            <XAxis 
                              dataKey="distance" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{fill: 'rgba(255,255,255,0.4)', fontSize: 13}} 
                              tickFormatter={(val) => `${val} km`}
                            />
                            <YAxis 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{fill: 'rgba(255,255,255,0.4)', fontSize: 13}} 
                              unit={activeTimelineDef.unit} 
                              domain={['auto', 'auto']}
                              reversed={activeTimelineMetric === 'pace'}
                            />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#1e293b', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)' }}
                              cursor={{ stroke: '#818cf8', strokeWidth: 1.5 }}
                              formatter={(value: any) => {
                                if (activeTimelineMetric === 'pace') {
                                  return [formatPaceDecimal(Number(value)), 'Pace'];
                                }
                                return [`${value}${activeTimelineDef.unit}`, activeTimelineDef.name];
                              }}
                              labelFormatter={(dist) => `Distanz: ${dist} km`}
                            />
                            <Area type="monotone" dataKey={activeTimelineMetric} stroke="#818cf8" strokeWidth={4} fillOpacity={1} fill="url(#pdGradModal)" />
                          </AreaChart>
                        ) : (
                          <BarChart data={activeZoneData} layout="vertical" margin={{ left: 80, right: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.05)" />
                            <XAxis type="number" hide />
                            <YAxis 
                              dataKey="name" 
                              type="category" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{fill: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 700}} 
                            />
                            <Tooltip 
                              cursor={{fill: 'rgba(255,255,255,0.03)'}}
                              contentStyle={{ backgroundColor: '#1e293b', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)' }}
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const d = payload[0].payload;
                                  return (
                                    <div className="bg-slate-800 p-4 rounded-2xl border border-white/10 max-w-xs">
                                      <p className="text-[10px] font-black text-indigo-400 tracking-widest uppercase mb-1">{d.name}</p>
                                      <div className="flex items-baseline gap-2 mb-2">
                                        <span className="text-2xl font-black text-white">{d.percent.toFixed(1)}%</span>
                                        <span className="text-sm font-bold text-slate-450">({d.timeStr})</span>
                                      </div>
                                      <p className="text-xs text-slate-300 leading-relaxed border-t border-white/5 pt-2 font-medium">{d.desc}</p>
                                      {d.benefit && (
                                        <p className="text-[11px] text-emerald-400 mt-2 font-semibold">
                                          Wirkung: <span className="text-slate-200 font-medium">{d.benefit}</span>
                                        </p>
                                      )}
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <Bar dataKey="percent" radius={[0, 8, 8, 0]} barSize={40}>
                              {activeZoneData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Bar>
                          </BarChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  </div>
                  
                  <div className="mt-8 p-6 bg-slate-50 dark:bg-slate-900 rounded-[20px] border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
                    <div className="max-w-2xl">
                      <h4 className="font-black text-slate-950 dark:text-white uppercase tracking-widest text-xs mb-2">Interpretation & sportliche Bedeutung</h4>
                      <p className="text-slate-600 dark:text-slate-300 font-medium leading-relaxed italic text-sm">
                        {fullscreenChart === 'pd' 
                          ? 'Diese detaillierte Zeitreihe zeigt das Tempoerhalt und Intensitätsschwankungen über verschiedene Segmente deiner Route. Perfekt um Durchhänger oder Leistungshochs zu filtern.' 
                          : 'Der Zeitabschnitt in den Zonen zeigt, ob dein Training aerobe Grundlagen ausgebaut hat (Z1-Z3) oder vorrangig im schwellengebenden anaeroben Tempobereich (Z4-Z5) stattgefunden hat.'}
                      </p>
                    </div>
                    <button 
                      onClick={() => setFullscreenChart(null)}
                      className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition"
                    >
                      Zurück zur Analyse
                    </button>
                  </div>
                </motion.div>
              </div>
            )}

            {/* Individual Metric Explanation Modal */}
            {selectedTheoryMetric && (() => {
              const explanation = METRIC_EXPLANATIONS[selectedTheoryMetric];
              if (!explanation) return null;
              return (
                <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 sm:p-6 select-none">
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setSelectedTheoryMetric(null)}
                    className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
                  />
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 15 }}
                    className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-2xl overflow-hidden text-slate-900 dark:text-slate-100 flex flex-col font-sans max-h-[90vh]"
                  >
                    {/* Header */}
                    <div className="p-6 sm:p-8 bg-slate-50 dark:bg-slate-950 border-b border-slate-150 dark:border-slate-850 flex items-start justify-between gap-4">
                      <div>
                        <span className="text-[10px] font-black tracking-widest uppercase text-indigo-600 dark:text-indigo-400">Wissenschaftliche Erklärung</span>
                        <h4 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950 dark:text-white mt-1">
                          {explanation.title}
                        </h4>
                        <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold mt-1">
                          {explanation.subtitle}
                        </p>
                      </div>
                      <button 
                        onClick={() => setSelectedTheoryMetric(null)}
                        className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition text-slate-450 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                      >
                        <X size={20} />
                      </button>
                    </div>

                    {/* Content Scroll */}
                    <div className="p-6 sm:p-8 space-y-6 overflow-y-auto max-h-[50vh]">
                      {/* Formula Card */}
                      <div className="bg-slate-900 text-slate-100 p-5 rounded-2xl border border-white/5 font-mono text-center">
                        <div className="text-[9px] font-black uppercase text-indigo-400 tracking-widest mb-2.5">Mathematische Formel</div>
                        <div className="text-xs sm:text-sm font-bold text-indigo-200 break-words leading-relaxed select-text select-all">
                          {explanation.formula}
                        </div>
                      </div>

                      {/* Explanation Text */}
                      <div className="space-y-4 text-slate-600 dark:text-slate-350 text-sm leading-relaxed font-medium">
                        {explanation.text.split('\n\n').map((paragraph, pIdx) => (
                          <p key={pIdx} className="whitespace-pre-line">
                            {paragraph}
                          </p>
                        ))}
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="p-6 bg-slate-50 dark:bg-slate-950 border-t border-slate-150 dark:border-slate-850 flex items-center justify-between gap-4">
                      <button 
                        onClick={() => {
                          setSelectedTheoryMetric(null);
                          setShowTheoryHandbook(true);
                          // Auto Switch Tab corresponding to metric types
                          if (selectedTheoryMetric === 'avgPower') setActiveHandbookTab('aero');
                          else if (selectedTheoryMetric === 'workKj' || selectedTheoryMetric === 'calories') setActiveHandbookTab('energy');
                          else if (selectedTheoryMetric === 'fatOx' || selectedTheoryMetric === 'carbOx') setActiveHandbookTab('substrate');
                          else if (selectedTheoryMetric.includes('slope')) setActiveHandbookTab('slope');
                        }}
                        className="text-xs text-indigo-650 dark:text-indigo-400 hover:underline font-bold transition flex items-center gap-1.5"
                      >
                        📖 Ausführliches Theorie-Handbuch öffnen
                      </button>
                      <button 
                        onClick={() => setSelectedTheoryMetric(null)}
                        className="py-2.5 px-6 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-xl font-bold transition-all shadow-sm text-xs cursor-pointer"
                      >
                        Schließen
                      </button>
                    </div>
                  </motion.div>
                </div>
              );
            })()}

            {/* Scientific Theory Handbook Modal */}
            {showTheoryHandbook && (
              <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 sm:p-6 select-none">
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowTheoryHandbook(false)}
                  className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
                />
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 15 }}
                  className="relative w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] shadow-2xl overflow-hidden text-slate-900 dark:text-slate-100 flex flex-col font-sans h-[85vh]"
                >
                  {/* Header Title */}
                  <div className="p-6 sm:p-8 bg-slate-50 dark:bg-slate-950 border-b border-slate-150 dark:border-slate-855/80 flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-rose-50 dark:bg-rose-955/40 text-rose-600 dark:text-rose-400 rounded-2xl">
                        📖
                      </div>
                      <div>
                        <span className="text-[10px] font-black tracking-widest uppercase text-rose-600 dark:text-rose-450">Physikalische Trainingswissenschaft</span>
                        <h3 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950 dark:text-white mt-0.5">
                          Wissenschaftliches Theorie-Handbuch
                        </h3>
                        <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold mt-0.5">
                          Die physikalischen, thermodynamischen und human-biomechanischen Modelle hinter den Simulationen
                        </p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setShowTheoryHandbook(false)}
                      className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition text-slate-455 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <X size={22} />
                    </button>
                  </div>

                  {/* Horizontal Tabs Navigation */}
                  <div className="bg-slate-100 dark:bg-slate-950/60 p-2 border-b border-slate-200 dark:border-slate-850 flex overflow-x-auto gap-1 no-scrollbar shrink-0">
                    <button
                      onClick={() => setActiveHandbookTab('aero')}
                      className={`px-4 py-2.5 font-bold text-xs rounded-xl transition cursor-pointer shrink-0 ${
                        activeHandbookTab === 'aero'
                          ? 'bg-white dark:bg-slate-800 text-indigo-650 dark:text-white shadow-xs'
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      💨 Aerodynamik & Widerstand
                    </button>
                    <button
                      onClick={() => setActiveHandbookTab('energy')}
                      className={`px-4 py-2.5 font-bold text-xs rounded-xl transition cursor-pointer shrink-0 ${
                        activeHandbookTab === 'energy'
                          ? 'bg-white dark:bg-slate-800 text-indigo-650 dark:text-white shadow-xs'
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      ⚡ Thermodynamik & Wirkungsgrad
                    </button>
                    <button
                      onClick={() => setActiveHandbookTab('substrate')}
                      className={`px-4 py-2.5 font-bold text-xs rounded-xl transition cursor-pointer shrink-0 ${
                        activeHandbookTab === 'substrate'
                          ? 'bg-white dark:bg-slate-800 text-indigo-650 dark:text-white shadow-xs'
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      🔥 Fett- & Carbobxidation
                    </button>
                    <button
                      onClick={() => setActiveHandbookTab('slope')}
                      className={`px-4 py-2.5 font-bold text-xs rounded-xl transition cursor-pointer shrink-0 ${
                        activeHandbookTab === 'slope'
                          ? 'bg-white dark:bg-slate-800 text-indigo-650 dark:text-white shadow-xs'
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      🧗 GPS-Profil & Höhenglättung
                    </button>
                  </div>

                  {/* Tab Scroll Content */}
                  <div className="flex-1 p-6 sm:p-8 overflow-y-auto space-y-6 select-text">
                    {activeHandbookTab === 'aero' && (
                      <div className="space-y-6">
                        <div className="space-y-2">
                          <h4 className="text-lg font-black text-slate-900 dark:text-white">💨 Aerodynamik und Strömungswiderstand</h4>
                          <p className="text-slate-600 dark:text-slate-350 text-sm leading-relaxed">
                            Bei Geschwindigkeiten über 15 km/h wird der aerodynamische Widerstand zur dominierenden Bremskraft auf ebener Strecke. Das mathematische Modell berechnet die dafür erforderliche Überwindungsleistung in Watt auf Basis der Strömungsgleichung:
                          </p>
                        </div>

                        <div className="bg-slate-950 p-4 rounded-xl font-mono text-center border border-white/5">
                          <div className="text-xs text-indigo-400 font-bold">P_aero = 0.5 * CdA * rho * (v_speed + v_wind)² * v_speed</div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-slate-50 dark:bg-slate-950/40 p-5 rounded-2xl border border-slate-100 dark:border-slate-850">
                            <h5 className="font-extrabold text-xs text-slate-400 uppercase tracking-widest mb-3">CdA-Werte (Aerodynamischer Widerstandsbeiwert)</h5>
                            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 font-medium">
                              <li className="flex justify-between items-center bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                                <span className="font-bold">Unterlenker (Drops)</span>
                                <span className="font-mono bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded font-black">CdA = 0.26 m²</span>
                              </li>
                              <li className="flex justify-between items-center bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                                <span className="font-bold">Standard Griffe (Hoods)</span>
                                <span className="font-mono bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded font-black">CdA = 0.32 m²</span>
                              </li>
                              <li className="flex justify-between items-center bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                                <span className="font-bold">Aufrechte Position (Upright)</span>
                                <span className="font-mono bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded font-black">CdA = 0.40 m²</span>
                              </li>
                            </ul>
                          </div>

                          <div className="bg-slate-50 dark:bg-slate-950/40 p-5 rounded-2xl border border-slate-100 dark:border-slate-850">
                            <h5 className="font-extrabold text-xs text-slate-400 uppercase tracking-widest mb-3">Cr-Werte (Reifen-Rollwiderstand)</h5>
                            <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed mb-3">
                              Dämpfung und Profilverformung schlucken mechanische Kraft. Je rauer der Reifentyp, desto höher der C_rr:
                            </p>
                            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 font-medium">
                              <li className="flex justify-between items-center bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                                <span className="font-bold">Straßenslicks (Road)</span>
                                <span className="font-mono bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded font-black">C_rr = 0.0040</span>
                              </li>
                              <li className="flex justify-between items-center bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                                <span className="font-bold">Gravel-Noppen (Gravel)</span>
                                <span className="font-mono bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded font-black">C_rr = 0.0065</span>
                              </li>
                              <li className="flex justify-between items-center bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                                <span className="font-bold">Stollenprofil (MTB)</span>
                                <span className="font-mono bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded font-black">C_rr = 0.0090</span>
                              </li>
                            </ul>
                          </div>
                        </div>

                        <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/25 border border-indigo-150 dark:border-indigo-900 rounded-2xl text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed font-semibold">
                          💡 <strong>Zusatzfaktor Gegenwind:</strong> Gegenwind oder Rückenwind fließt quadratisch in die Form ein. Da P_aero mit der dritten Potenz der Gesamtgeschwindigkeit skaliert, bremst dich Gegenwind extrem viel stärker ab, als dich Rückenwind gleicher Stärke beschleunigen kann!
                        </div>
                      </div>
                    )}

                    {activeHandbookTab === 'energy' && (
                      <div className="space-y-6">
                        <div className="space-y-2">
                          <h4 className="text-lg font-black text-slate-900 dark:text-white">⚡ Thermodynamische Erhaltungssätze</h4>
                          <p className="text-slate-600 dark:text-slate-350 text-sm leading-relaxed">
                            Die gesamte Energiebilanz deines Trainings unterliegt dem Ersten Hauptsatz der Thermodynamik. Die Formel ermittelt exakt, wie chemische Energie aus Lebensmitteln in mechanische Fortbewegung umgerechnet wird.
                          </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-slate-950 p-5 rounded-2xl border border-white/5 font-mono space-y-4">
                            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Formel: Mechanische Arbeit</div>
                            <div className="text-sm text-indigo-300 font-bold text-center">Arbeit (kJ) = [ Ø Watt * Sekunden ] / 1000</div>
                            <p className="text-slate-400 text-xs leading-relaxed font-sans">
                              1 Watt ist die Erbringung von 1 Joule mechanischer Arbeit pro Sekunde. Beispielsweise leistet eine Athletin bei einer Fahrt über 2 Stunden (= 7200 Sek) bei durchschnittlich 180 Watt exakt 1.296.000 Joule Arbeit (entspricht 1296 kJ).
                            </p>
                          </div>

                          <div className="bg-slate-950 p-5 rounded-2xl border border-white/5 font-mono space-y-4">
                            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Formel: Biologischer Umsatz</div>
                            <div className="text-sm text-rose-300 font-bold text-center">kcal = Arbeit (kJ) / [ Wirkungsgrad * 4.184 ]</div>
                            <p className="text-slate-400 text-xs leading-relaxed font-sans">
                              Da der menschliche Muskel einen typischen metabolischen Brutto-Wirkungsgrad von ca. 21% bis 23% besitzt, muss das Vierfache an Stoffwechselenergie in Form von verbrannten Kohlenhydraten und Fetten aufgewendet werden. Der Rest verpufft als ungenutzte Abwärme (Heizleistung des Körpers).
                            </p>
                          </div>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-950/40 p-5 rounded-2xl border border-slate-100 dark:border-slate-850 space-y-3">
                          <h5 className="font-extrabold text-xs text-slate-400 uppercase tracking-widest">Wirkungsgrade im Vergleich</h5>
                          <div className="space-y-3 text-xs">
                            <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                              <div className="flex justify-between font-bold mb-1">
                                <span>🚴 Radfahren (ca. 23%)</span>
                                <span className="font-mono text-indigo-600">Faktor: kJ * 1.04</span>
                              </div>
                              <p className="text-slate-500 dark:text-slate-400">Geringere Verlustleistung, da der Sportler passiv auf dem Sattel sitzt und elastische Halte- und Stoßdämpfungsarbeit wegfällt.</p>
                            </div>
                            <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                              <div className="flex justify-between font-bold mb-1">
                                <span>🏃 Laufen (ca. 21%)</span>
                                <span className="font-mono text-rose-600">Faktor: kJ * 1.14</span>
                              </div>
                              <p className="text-slate-500 dark:text-slate-400">Höherer biomechanischer Aufwand. Der Körper muss bei jedem Schritt Stoßbelastungen abfangen, den Schwerpunkt aktiv anheben und Stabilisierungsarbeit verrichten.</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeHandbookTab === 'substrate' && (
                      <div className="space-y-6">
                        <div className="space-y-2">
                          <h4 className="text-lg font-black text-slate-900 dark:text-white">🔥 Bioenergetische Substrat-Partitionierung</h4>
                          <p className="text-slate-600 dark:text-slate-350 text-sm leading-relaxed">
                            Zur Aufrechterhaltung der Zellfunktion spaltet der Muskel Adenosintriphosphat (ATP). Dieses wird aus zwei unterschiedlichen biochemischen Depots regeneriert: freien Fettsäuren (Lipide) und Glykogen (Glucose). Das physiologische Modell berechnet das genaue Verhältnis basierend auf der aktuellen Belastungsintensität zur FTP.
                          </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-semibold">
                          <div className="p-5 bg-amber-500/5 rounded-2xl border border-amber-500/10 space-y-3">
                            <h5 className="font-black text-amber-650 flex items-center gap-1.5"><Flame size={14} /> Lipidstoffwechsel (Fett-Oxidation)</h5>
                            <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-semibold">
                              Fette verfeuern langsam unter hohem Sauerstoffumsatz. Sie liefern enorme Energiemengen (9.3 kcal/g), eignen sich jedoch nur bis zu einer moderaten Belastung von unter 75% FTP. Bei intensivem Schwellentraining bricht die Enzymaktivität der Lipolyse ein, da die Atmungskette im Mitochondrium mit dem Sauerstoffnachschub nicht mehr hinterherkommt.
                            </p>
                          </div>

                          <div className="p-5 bg-rose-500/5 rounded-2xl border border-rose-500/10 space-y-3">
                            <h5 className="font-black text-rose-600 flex items-center gap-1.5">🍭 Kohlenhydratstoffwechsel (Glykogen)</h5>
                            <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-semibold">
                              Glykogen liefert hocheffizient und schnell ATP (Brennwert 4.1 kcal/g). Auch ohne optimalen Sauerstoffüberschuss (anaerobe Glykolyse) kann hieraus rasch Energie gewonnen werden - perfekt für dicke Oberschenkel am Berg, harte Intervalle oder Tempoläufe. Die Depots sind jedoch nach ca. 90-120 Minuten leer.
                            </p>
                          </div>
                        </div>

                        <div className="p-4 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-slate-100 dark:border-slate-850">
                          <h5 className="font-extrabold text-xs text-slate-400 uppercase tracking-widest mb-3">Zusammenhang zwischen Intensität (% FTP) und Fett-Oxidation</h5>
                          <div className="h-28 w-full flex items-end gap-1 font-mono text-[9px] text-slate-400 dark:text-slate-500 font-extrabold pb-2 select-none">
                            <div className="flex-1 flex flex-col items-center">
                              <span className="text-amber-500">70% Fett</span>
                              <div className="w-full bg-amber-500 h-16 rounded mt-1" />
                              <span className="mt-1">Regenerativ ({"<55%"})</span>
                            </div>
                            <div className="flex-1 flex flex-col items-center">
                              <span className="text-amber-500">52% Fett</span>
                              <div className="w-full bg-amber-500 h-12 rounded mt-1" />
                              <span className="mt-1">GA1 (55%-75%)</span>
                            </div>
                            <div className="flex-1 flex flex-col items-center">
                              <span className="text-slate-400">30% Fett</span>
                              <div className="w-full bg-slate-400 h-7 rounded mt-1" />
                              <span className="mt-1">GA2 (75%-90%)</span>
                            </div>
                            <div className="flex-1 flex flex-col items-center">
                              <span className="text-rose-500">2% Fett</span>
                              <div className="w-full bg-rose-500 h-1.5 rounded mt-1" />
                              <span className="mt-1">Anaerob ({">90%"})</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeHandbookTab === 'slope' && (
                      <div className="space-y-6">
                        <div className="space-y-2">
                          <h4 className="text-lg font-black text-slate-900 dark:text-white">🧗 Glättung & Signalbearbeitung digitaler GPX-Dateien</h4>
                          <p className="text-slate-600 dark:text-slate-350 text-sm leading-relaxed">
                            GPS-Empfänger weisen systembedingt bei der Höhenmessung periodenhafte Signalstörungen und Messjitter (Rauschen) auf. Ohne Filterung würden scheinbare 'Mini-Krater' und Steilrampen die Analyse völlig verzerren.
                          </p>
                        </div>

                        <div className="p-5 bg-emerald-500/5 rounded-2xl border border-emerald-500/10 space-y-4 text-sm font-semibold text-slate-650 dark:text-slate-300">
                          <h5 className="font-black text-emerald-600 dark:text-emerald-400">Gleitendes Mittelwert-Filter (Moving Average)</h5>
                          <p className="leading-relaxed">
                            Um das mathematische Höhenprofil zu bereinigen, verwenden wir einen Algorithmus der digitalen Signalverarbeitung (DSP). Jeder Punkt des GPX-Tracks wird mit einem symmetrischen Filterfenster über seine Nachbarpunkte geglättet:
                          </p>
                          <div className="bg-slate-950 p-4 rounded-xl font-mono text-center text-xs text-indigo-400 font-bold border border-white/5">
                            H_geglättet(i) = [ H(i-5) + H(i-4) + ... + H(i) + ... + H(i+5) ] / 11
                          </div>
                          <p className="leading-relaxed">
                            Durch diesen gleitenden Mittelwert über 11 Punkte (entspricht im Schnitt ca. 20-40 Metern an Strecke) werden Messausreißer zuverlässig flachgebügelt. Die Steigungen der verbleibenden Abschnitte werden harmonisch und präzise ausgelesen.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer close */}
                  <div className="p-6 bg-slate-50 dark:bg-slate-950 border-t border-slate-150 dark:border-slate-855 flex items-center justify-end">
                    <button 
                      onClick={() => setShowTheoryHandbook(false)}
                      className="py-3 px-8 bg-slate-950 dark:bg-slate-800 hover:bg-slate-850 dark:hover:bg-slate-700 text-white rounded-2xl font-bold transition-all shadow-sm text-sm cursor-pointer"
                    >
                      Handbuch schließen
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};

// Modular helper component for clean UI card metrics
const MetricCard = ({ 
  label, 
  value, 
  icon, 
  subValue, 
  color, 
  tooltip 
}: { 
  label: string; 
  value: string | number; 
  icon: React.ReactNode; 
  subValue?: string; 
  color: string; 
  tooltip?: string; 
}) => {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <>
      <div className={`p-4 sm:p-6 rounded-2xl border ${color} shadow-sm transition-all hover:shadow-md group relative w-[220px] sm:w-auto shrink-0 snap-center`}>
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-white dark:bg-slate-900 rounded-lg shadow-sm group-hover:scale-110 transition-transform">
            {icon}
          </div>
          {tooltip && (
            <button 
              onClick={() => setShowDetail(true)}
              className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all cursor-pointer"
              title="Informationen anzeigen"
            >
              <Shield size={16} className="opacity-60 group-hover:opacity-100" />
            </button>
          )}
        </div>
        <div className="space-y-1">
          <span className="text-[10px] text-slate-450 dark:text-slate-400 font-bold uppercase tracking-widest block">{label}</span>
          <div className="text-3xl font-black text-slate-900 dark:text-white">{value}</div>
          {subValue && <div className="text-slate-500 dark:text-slate-400 text-sm font-medium">{subValue}</div>}
        </div>
      </div>

      <AnimatePresence>
        {showDetail && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDetail(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden text-zinc-900 dark:text-zinc-100"
            >
              <div className="p-8">
                <div className="flex items-center gap-4 mb-6">
                  <div className={`p-3 rounded-2xl ${color.split(' ')[1] || 'bg-slate-100'}`}>
                    {icon}
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">{label}</h3>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Detail-Interpretation</p>
                  </div>
                </div>
                
                <div className="space-y-6">
                  <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Errechneter Wert</div>
                    <div className="text-3xl font-black text-slate-900 dark:text-white">{value}</div>
                  </div>

                  <div>
                    <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest mb-2 flex items-center gap-2">
                      <Shield size={14} className="text-indigo-505" />
                      Algorithmus & Trainingsauswirkung
                    </h4>
                    <p className="text-slate-650 dark:text-slate-300 text-sm leading-relaxed font-semibold">
                      {tooltip}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                    <button 
                      onClick={() => setShowDetail(false)}
                      className="w-full py-3 bg-slate-900 dark:bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-800 dark:hover:bg-slate-705 transition-colors"
                    >
                      Verstanden
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

export default AdvancedAnalytics;
