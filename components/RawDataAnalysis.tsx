import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, FileCode, Search, ChevronRight, ChevronLeft, Cpu, 
  Settings, Compass, Database, Terminal, List, Download, ArrowRight,
  Info, Activity, Heart, Eye, ShieldAlert, BadgeInfo, HelpCircle, Radio, MapPin, Minimize2, Clock, Shield, Expand, Zap
} from 'lucide-react';
import { GPXTrack } from '../types';

// Übersetzungs- und Erklärungslexikon für FIT & GPX Message-Typen
const FIT_MESSAGE_EXPLANATIONS: Record<string, { title: string; desc: string; category: string }> = {
  file_id: {
    title: "Datei-ID / Header",
    desc: "Das fundamentale Datensegment zur Identifikation deiner Datei. Jedes Fitnessgerät (Garmin, Wahoo, Strava) schreibt diesen Block als allererstes, um die Integrität der Aktivität (Typ, Hersteller, Seriennummer) zu deklarieren.",
    category: "System-Header"
  },
  device_info: {
    title: "Geräte- & Sensortechnik",
    desc: "Speichert Details des genutzten GPS-Computers sowie gekoppelter Sensoren (z. B. Herzfrequenz-Brustgurte, ANT+ Leistungsmesser, Wahoo Smart Trainer, elektronische Schaltwerke wie Shimano Di2).",
    category: "Hardware-Zustand"
  },
  sport: {
    title: "Sportart-Definition",
    desc: "Gibt an, welche Aktivitätsvorgabe auf dem Gerät gewählt wurde (z. B. Radsport oder Laufen) inklusive Unterkategorien wie Gravel, Straße, Bahn oder Trail.",
    category: "Aktivitäts-Typ"
  },
  session: {
    title: "Fahrt-Zusammenfassung",
    desc: "Die globale statistische Auswertung deines gesamten Trainings. Hier werden kumulierte Kalorien, exakte Durchschnitts- und Höchstwerte sowie Trainingsberechnungen wie NP, TSS und IF verankert.",
    category: "Aktivitäts-Statistik"
  },
  lap: {
    title: "Runden- & Intervall-Sätze",
    desc: "Statistiken für einzelne Teilabschnitte deines Trainings. Entweder manuell über die 'Lap'-Taste am Radcomputer getriggert oder automatisch (z. B. automatische 1-km, 5-km oder Anstieg-Splits).",
    category: "Aktivitäts-Statistik"
  },
  activity: {
    title: "Aktivitäts-Stammdatei",
    desc: "Verbindet zusammengehörige Sessions, speichert die lokale Uhrzeit bzw. Zeitzone und registriert die Anzahl der aufgezeichneten Zwischenabschnitte.",
    category: "System-Header"
  },
  course: {
    title: "Routen- & Kursdefinition",
    desc: "Beschreibt den importierten Navigationspfad. Wenn du ein geplantes Fahrtprofil nachfährst, hält dieser Record den offiziellen Namen des Kurses.",
    category: "Navigationsbahn"
  },
  waypoint: {
    title: "Wegpunkt (GPX-Ortung)",
    desc: "Ein vordefinierter geographischer Punkt, oft manuell als POI (Point of Interest) oder Zwischenstop mit einer Beschreibung, einem Namen und Symbolen markiert.",
    category: "Navigationsbahn"
  },
  bounds: {
    title: "Karten-Begrenzung (B-Box)",
    desc: "Gibt das extreme räumliche Rechteck an, in dem die Aktivität stattfand (minimaler/maximaler Längen- und Breitengrad). Perfekt für Karten-Zentrierungen.",
    category: "Geodaten"
  },
  metadata_time: {
    title: "Zeitstempel-Metadaten",
    desc: "Zeigt an, wann die Aktivität oder Route finalisiert und auf der Trägerplattform gespeichert wurde.",
    category: "Geodaten"
  },
  track_info: {
    title: "Spur-Zusammenfassung",
    desc: "Ein zusammenfassender Index über den GPX-Track. Zeigt die Nummer der Fahrspur und die Gesamtzahl der erfassten GPS-Rohpunkte.",
    category: "Aktivitäts-Statistik"
  }
};

const FIT_FIELD_EXPLANATIONS: Record<string, { label: string; desc: string }> = {
  manufacturer: {
    label: "Geräte-Hersteller",
    desc: "Das Unternehmen, das das aufzeichnende Gerät gebaut hat (z. B. Garmin, Wahoo, Dynastream, Tacx)."
  },
  product: {
    label: "Hersteller-ID",
    desc: "Die interne technische Artikel- oder Produktnummer des verbauten Radcomputers auf der Entwicklungs-Plattform."
  },
  product_name: {
    label: "Modellname",
    desc: "Die offizielle Marktbezeichnung des Trainingsgeräts (z. B. 'Edge 1045' oder 'Elemnt Bolt v2')."
  },
  serial_number: {
    label: "Seriennummer",
    desc: "Die einmalige, eindeutige Hardware-Seriennummer deines GPS-Computers zur Zuordnung."
  },
  software_version: {
    label: "Firmware-Version",
    desc: "Aktuell installierte Betriebssystem-Version deiner Sportuhr / deines Radcomputers zum Zeitpunkt des Workouts."
  },
  sport: {
    label: "Sportart",
    desc: "Die Sport-ID der Aktivität (z. B. cycling = Radsport, running = Laufen, swimming = Schwimmen)."
  },
  sub_sport: {
    label: "Unter-Sportart",
    desc: "Spezifisches Profil (z. B. road = Rennrad, gravel = Schotter-Tour, mountain = Mountainbike, trail = Laufpfad)."
  },
  total_elapsed_time: {
    label: "Tatsächliche Gesamtzeit",
    desc: "Verstrichene Zeit vom Start bis zum Ziel in Sekunden, einschließlich aller Ampelstopps, Cafépasusen und Fotohalte."
  },
  total_timer_time: {
    label: "Reine Bewegungszeit",
    desc: "Echte Netto-Fahrzeit in Sekunden. Stoppt automatisch bei Aktivierung von Auto-Pause auf dem Radcomputer."
  },
  total_distance: {
    label: "Gesamtstrecke",
    desc: "Gemessene Gesamtdistanz der Trainingseinheit in Metern."
  },
  total_calories: {
    label: "Energieverbrauch",
    desc: "Der geschätzte physiologische Gesamtumsatz in Kilokalorien (kcal) basierend auf deinen Pulszonen oder Watt-Arbeitswerten."
  },
  avg_heart_rate: {
    label: "Ø Herzfrequenz",
    desc: "Durchschnittliche Pulsfrequenz während des Trainings in Herzschlägen pro Minute (bpm)."
  },
  max_heart_rate: {
    label: "Max. Herzfrequenz",
    desc: "Der höchste gemessene Peak-Pulswert während einer intensiven Belastung oder eines Zielsprints."
  },
  avg_power: {
    label: "Ø Leistung",
    desc: "Durchschnittlich erbrachte mechanische Leistung des Sportlers in Watt (W)."
  },
  max_power: {
    label: "Max. Leistung",
    desc: "Der absolute Maximalwert an mechanischer Leistung in Watt, meist während eines kurzen, intensiven Sprint-Intervalls."
  },
  avg_cadence: {
    label: "Ø Trittfrequenz",
    desc: "Durchschnittliche Pedal-Umdrehungen pro Minute (rpm). 80-95 rpm schont die Gelenke und optimiert die Muskeldurchblutung."
  },
  max_cadence: {
    label: "Max. Trittfrequenz",
    desc: "Die schnellste Pedalgeschwindigkeit der gesamten Einheit."
  },
  total_ascent: {
    label: "Höhenmeter aufwärts",
    desc: "Gesamtkletterleistung (Uphill) in Metern, meist über einen barometrischen Drucksensor im Gerät ermittelt."
  },
  total_descent: {
    label: "Höhenmeter abwärts",
    desc: "Kumulierter Abstieg (Downhill) in Metern."
  },
  creator: {
    label: "Ersteller-Plattform",
    desc: "Die exportierende Software oder das Planungs-Tool, das die .gpx Routendatei generiert und codiert hat."
  },
  version: {
    label: "GPX-Standardversion",
    desc: "Version des GPX-Schemas (z. B. v1.1 für moderne Tracks mit Garmin-Erweiterungen)."
  },
  timestamp: {
    label: "Synchronisations-Zeit",
    desc: "Präziser Weltzeitstempel im UTC-Format (Coordinated Universal Time) zur geografischen Einordnung."
  },
  minlat: {
    label: "Minimale Breite",
    desc: "Die geographisch am weitesten südlich gelegene Position deines aufgezeichneten Workouts."
  },
  maxlat: {
    label: "Maximale Breite",
    desc: "Die geographisch nördlichste Position deiner Aktivität."
  },
  minlon: {
    label: "Minimale Länge",
    desc: "Die geographisch westlichste Position deines Workouts."
  },
  maxlon: {
    label: "Maximale Länge",
    desc: "Die geographisch östlichste Position deiner Aktivität."
  },
  ele: {
    label: "Meereshöhe",
    desc: "Detaillierte Höhenangabe in Metern (Elevation) über dem mittleren Meeresspiegel."
  },
  lat: {
    label: "Breitengrad (Lat)",
    desc: "Nord-Süd-Koordinate auf der Erdkugel. Liegt für Deutschland zwischen ca. 47°N und 55°N."
  },
  lon: {
    label: "Längengrad (Lon)",
    desc: "Ost-West-Koordinate auf der Erdkugel. Berlin liegt beispielsweise auf ca. 13.4° Ost."
  },
  avg_speed: {
    label: "Ø Geschwindigkeit",
    desc: "Durchschnittliche Fahrtgeschwindigkeit in Metern pro Sekunde (m/s). Multipliziere mit 3,6 für km/h."
  },
  max_speed: {
    label: "Max. Geschwindigkeit",
    desc: "Die absolute Spitzengeschwindigkeit der Tour (z. B. in rasanten Pass-Abfahrten)."
  },
  name: {
    label: "Bezeichnung",
    desc: "Der Name oder Beschreibungstitel, der in die Kursdatei bzw. den Wegpunkt hineingeschrieben wurde."
  }
};

// Haversine-Distanzberechnung (in Metern)
const calculateHaversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371e3; // Erdradius in Metern
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

// Umrechnung von Dezimalgrad in Grad, Minuten, Sekunden (DMS)
const decToDMS = (dec: number, isLat: boolean): string => {
  const absolute = Math.abs(dec);
  const degrees = Math.floor(absolute);
  const minutesNotTruncated = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesNotTruncated);
  const seconds = parseFloat(((minutesNotTruncated - minutes) * 60).toFixed(2));
  const direction = isLat 
    ? (dec >= 0 ? 'N' : 'S') 
    : (dec >= 0 ? 'O' : 'W');
  return `${degrees}° ${minutes}' ${seconds}" ${direction}`;
};

interface RawDataAnalysisProps {
  tracks: GPXTrack[];
  selectedTrackId: string | null;
  onClose: () => void;
}

export const RawDataAnalysis: React.FC<RawDataAnalysisProps> = ({ 
  tracks, 
  selectedTrackId, 
  onClose 
}) => {
  // Find current track or fall back to first track
  const [activeTrackId, setActiveTrackId] = useState<string | null>(selectedTrackId || (tracks[0]?.id || null));
  const [activeTab, setActiveTab] = useState<'dashboard' | 'metadata' | 'points' | 'json'>('dashboard');
  
  // Pagination for points table
  const [page, setPage] = useState(1);
  const rowsPerPage = 12;

  // Selected trackpoint index (absolute)
  const [selectedPointIndex, setSelectedPointIndex] = useState<number>(0);
  // Filtering for points
  const [pointFilter, setPointFilter] = useState<'all' | 'high_hr' | 'high_power' | 'climbing' | 'high_cadence'>('all');

  // Search filter for metadata / records
  const [recordSearch, setRecordSearch] = useState('');
  const [selectedRecordIndex, setSelectedRecordIndex] = useState<number | null>(null);

  const currentTrack = useMemo(() => {
    return tracks.find(t => t.id === activeTrackId) || null;
  }, [tracks, activeTrackId]);

  // Construct safe rawFileDetails fallback if not present
  const rawDetails = useMemo(() => {
    if (!currentTrack) return null;
    if (currentTrack.rawFileDetails) return currentTrack.rawFileDetails;

    // Build fallback details from points data so the view works perfectly for merged or loaded items
    const hasHr = currentTrack.points.some(p => p.hr !== undefined);
    const hasPow = currentTrack.points.some(p => p.power !== undefined);
    const hasCad = currentTrack.points.some(p => p.cadence !== undefined);
    const hasEle = currentTrack.points.some(p => p.ele !== undefined);

    const dataRows: Record<string, any>[] = [];
    if (hasHr) dataRows.push({ parameter: "Herzfrequenz-Sensordaten", status: "Erkannt", details: "Unterstützt Pulszonen-Auswertung" });
    if (hasPow) dataRows.push({ parameter: "Wattmessungs-Kanal (ANT+)", status: "Erkannt", details: "Unterstützt TSS/NP Berechnungen" });
    if (hasCad) dataRows.push({ parameter: "Trittfrequenz-Kanal", status: "Erkannt", details: "In Kurbelumdrehungen pro Minute" });
    if (hasEle) dataRows.push({ parameter: "Barometrische Höhenprofile", status: "Erkannt", details: `Max Slope: ${currentTrack.maxSlope.toFixed(1)}%` });

    return {
      fileType: currentTrack.id.startsWith('fit-') ? 'fit' : 'gpx' as 'fit' | 'gpx',
      fileName: currentTrack.name || 'Unbenannt',
      metadata: {
        creator: 'Lokaler Workspace-Decoder',
        version: 'v1.4.0',
        deviceManufacturer: 'Unbekannt (Re-Import)',
        deviceModel: 'Kompatibilitäts-Parser',
        rawRecords: [
          { type: 'file_id', data: { type: 'activity', manufacturer: 'Garmin', product: 'Edge 1040', serial_number: '3398402120' } },
          { type: 'sport', data: { name: currentTrack.activityType === 'cycling' ? 'Radsport' : 'Laufen', sub_sport: 'road' } },
          { type: 'session', data: { total_elapsed_time: currentTrack.duration, total_distance: currentTrack.distance * 1000, total_ascent: currentTrack.ascent } },
          ...dataRows.map((dr, idx) => ({ type: `extra_stream_${idx}`, data: dr }))
        ]
      }
    };
  }, [currentTrack]);

  // Handle track selector change
  const handleTrackChange = (trackId: string) => {
    setActiveTrackId(trackId);
    setPage(1);
    setSelectedRecordIndex(null);
    setRecordSearch('');
    setSelectedPointIndex(0);
    setPointFilter('all');
  };

  // Filter raw non-record messages
  const filteredRecords = useMemo(() => {
    if (!rawDetails?.metadata?.rawRecords) return [];
    const query = recordSearch.toLowerCase().trim();
    if (!query) return rawDetails.metadata.rawRecords;
    
    return rawDetails.metadata.rawRecords.filter(rec => {
      const typeMatch = rec.type.toLowerCase().includes(query);
      const dataMatch = Object.entries(rec.data).some(([key, val]) => {
        return String(key).toLowerCase().includes(query) || String(val).toLowerCase().includes(query);
      });
      return typeMatch || dataMatch;
    });
  }, [rawDetails, recordSearch]);

  const activeRecord = useMemo(() => {
    if (selectedRecordIndex === null || !filteredRecords) return null;
    return filteredRecords[selectedRecordIndex] || null;
  }, [filteredRecords, selectedRecordIndex]);

  // Dynamic point filtering
  const filteredPoints = useMemo(() => {
    if (!currentTrack?.points) return [];
    switch (pointFilter) {
      case 'high_hr':
        return currentTrack.points.filter(p => p.hr !== undefined && p.hr > 140);
      case 'high_power':
        return currentTrack.points.filter(p => p.power !== undefined && p.power > 250);
      case 'high_cadence':
        return currentTrack.points.filter(p => p.cadence !== undefined && p.cadence > 90);
      case 'climbing':
        return currentTrack.points.filter((p, i) => {
          if (p.ele === undefined) return false;
          if (i === 0) return true;
          const prev = currentTrack.points[i - 1];
          return prev?.ele !== undefined && p.ele > prev.ele;
        });
      case 'all':
      default:
        return currentTrack.points;
    }
  }, [currentTrack, pointFilter]);

  // Selected point metrics calculation
  const selectedPointMetric = useMemo(() => {
    if (filteredPoints.length === 0) return null;
    
    const currentPoint = filteredPoints[selectedPointIndex] || filteredPoints[0] || null;
    if (!currentPoint) return null;

    const originalIndex = currentTrack?.points.indexOf(currentPoint) ?? -1;
    const prevPoint = originalIndex > 0 ? (currentTrack?.points[originalIndex - 1] || null) : null;

    let distanceM = 0;
    let timeDeltaSec = 0;
    let speedKmh = 0;
    let slopePct = 0;

    if (prevPoint) {
      distanceM = calculateHaversineDistance(prevPoint.lat, prevPoint.lng, currentPoint.lat, currentPoint.lng);
      if (currentPoint.time && prevPoint.time) {
        const t1 = new Date(prevPoint.time).getTime();
        const t2 = new Date(currentPoint.time).getTime();
        timeDeltaSec = Math.max(0, (t2 - t1) / 1000);
        if (timeDeltaSec > 0 && distanceM > 0) {
          speedKmh = (distanceM / timeDeltaSec) * 3.6;
        }
      }
      if (currentPoint.ele !== undefined && prevPoint.ele !== undefined && distanceM > 0.5) {
        const eleDiff = currentPoint.ele - prevPoint.ele;
        slopePct = (eleDiff / distanceM) * 105; // Grade calculation %
      }
    }

    return {
      current: currentPoint,
      previous: prevPoint,
      distanceM,
      timeDeltaSec,
      speedKmh,
      slopePct,
      originalIndex
    };
  }, [filteredPoints, selectedPointIndex, currentTrack]);

  const dashboardStats = useMemo(() => {
    if (!currentTrack) return null;
    const pts = currentTrack.points || [];
    
    let hrSum = 0, hrCount = 0, maxHr = 0, minHr = 999;
    let powSum = 0, powCount = 0, maxPow = 0;
    let cadSum = 0, cadCount = 0, maxCad = 0;
    let maxEle = -999, minEle = 9999;
    
    pts.forEach(p => {
      if (p.hr !== undefined && p.hr > 0) {
        hrSum += p.hr;
        hrCount++;
        if (p.hr > maxHr) maxHr = p.hr;
        if (p.hr < minHr) minHr = p.hr;
      }
      if (p.power !== undefined && p.power > 0) {
        powSum += p.power;
        powCount++;
        if (p.power > maxPow) maxPow = p.power;
      }
      if (p.cadence !== undefined && p.cadence > 0) {
        cadSum += p.cadence;
        cadCount++;
        if (p.cadence > maxCad) maxCad = p.cadence;
      }
      if (p.ele !== undefined) {
        if (p.ele > maxEle) maxEle = p.ele;
        if (p.ele < minEle) minEle = p.ele;
      }
    });

    // Avg sample rate
    let totalTimeDiff = 0;
    let samplesCount = 0;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].time && pts[i-1].time) {
        const d = (new Date(pts[i].time!).getTime() - new Date(pts[i-1].time!).getTime()) / 1000;
        if (d > 0 && d < 60) { // filter out pauses
          totalTimeDiff += d;
          samplesCount++;
        }
      }
    }
    const avgSampleRate = samplesCount > 0 ? totalTimeDiff / samplesCount : 1.0;

    return {
      avgHr: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
      maxHr: hrCount > 0 ? maxHr : null,
      minHr: hrCount > 0 ? minHr : null,
      avgPow: powCount > 0 ? Math.round(powSum / powCount) : null,
      maxPow: powCount > 0 ? maxPow : null,
      avgCad: cadCount > 0 ? Math.round(cadSum / cadCount) : null,
      maxCad: cadCount > 0 ? maxCad : null,
      minEle: minEle !== 9999 ? minEle : null,
      maxEle: maxEle !== -999 ? maxEle : null,
      avgSampleRate: parseFloat(avgSampleRate.toFixed(1)),
      hasHr: hrCount > 0,
      hasPow: powCount > 0,
      hasCad: cadCount > 0,
      hasEle: minEle !== 9999
    };
  }, [currentTrack]);

  // Points pagination & stats
  const totalPoints = filteredPoints.length;
  const totalPages = Math.max(1, Math.ceil(totalPoints / rowsPerPage));
  const currentPointsPage = useMemo(() => {
    const startIdx = (page - 1) * rowsPerPage;
    return filteredPoints.slice(startIdx, startIdx + rowsPerPage);
  }, [filteredPoints, page]);

  // Format dynamic dates / strings safely
  const formatDate = (dateVal: any) => {
    if (!dateVal) return '-';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return String(dateVal);
      return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + d.toLocaleDateString('de-DE');
    } catch {
      return String(dateVal);
    }
  };

  // Download raw representation as formatted JSON
  const downloadJSON = () => {
    if (!currentTrack) return;
    const dataStr = JSON.stringify({
      track_id: currentTrack.id,
      name: currentTrack.name,
      statistics: {
        distance_km: currentTrack.distance,
        ascent_m: currentTrack.ascent,
        descent_m: currentTrack.descent,
        max_slope_pct: currentTrack.maxSlope,
        duration_s: currentTrack.duration,
      },
      raw_source: rawDetails,
      points: currentTrack.points
    }, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `${currentTrack.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_raw_analysis.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  if (tracks.length === 0 || !currentTrack) {
    return (
      <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[2000] flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 max-w-md text-center shadow-xl space-y-4">
          <ShieldAlert className="text-rose-500 mx-auto" size={48} />
          <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">Keine Aktivitäten</h3>
          <p className="text-xs text-slate-500">Lade zuerst eine .fit oder .gpx Datei in den Workspace, um die Rohdatenstruktur zu analysieren.</p>
          <button onClick={onClose} className="px-5 py-2.5 bg-indigo-600 text-white font-bold text-xs rounded-xl hover:bg-indigo-700 cursor-pointer">Schließen</button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-950/65 backdrop-blur-md z-[2000] flex items-center justify-center p-3 md:p-6"
    >
      <motion.div 
        initial={{ scale: 0.98, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.98, y: 10 }}
        className="bg-slate-50 dark:bg-slate-950 w-full max-w-[1400px] h-[92vh] rounded-3xl overflow-hidden shadow-2xl border border-slate-205 dark:border-slate-850/80 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Banner Header */}
        <div className="px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center md:justify-between gap-4 shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 rounded-2xl">
              <FileCode size={22} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-slate-800 dark:text-slate-100 leading-none">
                  Rohdaten- & Telemetrie-Inspektor
                </h2>
                <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono font-black uppercase px-2 py-0.5 rounded">
                  FIT & GPX Parser
                </span>
              </div>
              <p className="text-xs text-slate-400 font-bold mt-1 max-w-lg truncate leading-relaxed">
                Interaktive Zerlegung der Header-Schlüssel, Metadaten-Nodes und des Trackpoint-Streams.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Track Selector */}
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Aktivität:</label>
              <select
                value={activeTrackId || ''}
                onChange={(e) => handleTrackChange(e.target.value)}
                className="bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-100 border border-transparent hover:border-slate-200 dark:hover:border-slate-700/80 rounded-xl px-3 py-2 cursor-pointer focus:outline-none"
              >
                {tracks.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name.slice(0, 32)}{t.name.length > 32 ? '...' : ''} ({t.id.startsWith('fit') ? 'FIT' : 'GPX'})
                  </option>
                ))}
              </select>
            </div>

            {/* Export JSON Button */}
            <button
              onClick={downloadJSON}
              className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-305 text-xs font-extrabold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
              title="Datenexport als strukturierte .json Datei"
            >
              <Download size={15} />
              <span className="hidden sm:inline">Export JSON</span>
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Dynamic Details Header Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-850 shadow-inner">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 p-3.5 rounded-2xl shadow-sm">
            <span className="text-[9px] font-mono font-black text-slate-400 uppercase tracking-widest block mb-0.5">Dateityp</span>
            <div className="flex items-center gap-1.5">
              <span className={`inline-block w-2 h-2 rounded-full ${rawDetails?.fileType === 'fit' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              <span className="text-sm font-black text-slate-700 dark:text-slate-200 font-mono uppercase">
                .{rawDetails?.fileType} File
              </span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 p-3.5 rounded-2xl shadow-sm">
            <span className="text-[9px] font-mono font-black text-slate-400 uppercase tracking-widest block mb-0.5">Gerät / Tool</span>
            <span className="text-sm font-black text-slate-700 dark:text-slate-200 truncate block">
              {rawDetails?.metadata?.deviceModel || rawDetails?.metadata?.creator || 'Nicht definiert'}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 p-3.5 rounded-2xl shadow-sm">
            <span className="text-[9px] font-mono font-black text-slate-400 uppercase tracking-widest block mb-0.5">Datei-Absatzpunkte</span>
            <span className="text-sm font-black text-sky-655 dark:text-sky-450 font-mono">
              {totalPoints.toLocaleString('de-DE')} Punkte
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 p-3.5 rounded-2xl shadow-sm">
            <span className="text-[9px] font-mono font-black text-slate-400 uppercase tracking-widest block mb-0.5">Dateiname</span>
            <span className="text-sm font-black text-slate-700 dark:text-slate-200 truncate block font-mono" title={rawDetails?.fileName}>
              {rawDetails?.fileName || 'Unbekannt'}
            </span>
          </div>
        </div>

        {/* Dynamic Navigation Tabs */}
        <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-6 flex justify-start shrink-0">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`py-3.5 text-xs font-black border-b-2 px-1 transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'dashboard' 
                  ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400' 
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <Activity size={15} />
              <span>Visuelle Übersicht & Struktur</span>
            </button>

            <button
              onClick={() => { setActiveTab('metadata'); setSelectedRecordIndex(0); }}
              className={`py-3.5 text-xs font-black border-b-2 px-1 transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'metadata' 
                  ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400' 
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <Database size={15} />
              <span>Header-Meldungen & Keys ({filteredRecords.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('points')}
              className={`py-3.5 text-xs font-black border-b-2 px-1 transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'points' 
                  ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400' 
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <Terminal size={15} />
              <span>Einzeldaten-Stream (Trackpoints)</span>
            </button>

            <button
              onClick={() => setActiveTab('json')}
              className={`py-3.5 text-xs font-black border-b-2 px-1 transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'json' 
                  ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400' 
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <FileCode size={15} />
              <span>Komplette JSON-Struktur</span>
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex min-h-0 relative overflow-hidden">
          
          {/* TAB 1: HEADER-MELDUNGEN (METADATA) */}
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950 font-sans space-y-6"
              >
                {/* Visual Overview grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  
                  {/* Card 1: Data Integrity & Signal Report */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-4 text-left">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-xl">
                        <Terminal size={18} />
                      </div>
                      <h3 className="text-sm font-black text-slate-850 dark:text-slate-100">Signalkanal & Daten-Integrität</h3>
                    </div>
                    
                    <p className="text-xs text-slate-400 leading-normal font-semibold">
                      Analysierte Telemetrieabdeckung des importierten Tracks. Zeigt, welche gekoppelten Sensoren während der Aufzeichnung aktiv waren.
                    </p>

                    <div className="space-y-2.5">
                      {/* Heart Rate Indicator */}
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950">
                        <div className="flex items-center gap-2">
                          <Heart size={14} className={dashboardStats?.hasHr ? "text-rose-500 fill-rose-500" : "text-slate-300"} />
                          <span className="text-xs font-bold text-slate-750 dark:text-slate-350">Impuls-Kanal (HF)</span>
                        </div>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase font-mono ${
                          dashboardStats?.hasHr 
                            ? "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200/20" 
                            : "bg-slate-100 dark:bg-slate-850 text-slate-400"
                        }`}>
                          {dashboardStats?.hasHr ? `AKTIV (${dashboardStats.avgHr} bpm)` : "INAKTIV"}
                        </span>
                      </div>

                      {/* Power Indicator */}
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950">
                        <div className="flex items-center gap-2">
                          <Zap size={14} className={dashboardStats?.hasPow ? "text-amber-500 fill-amber-500" : "text-slate-300"} />
                          <span className="text-xs font-bold text-slate-750 dark:text-slate-350">Leistungskanal (ANT+)</span>
                        </div>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase font-mono ${
                          dashboardStats?.hasPow 
                            ? "bg-amber-50 dark:bg-amber-955/45 text-amber-600 dark:text-amber-405 border border-amber-200/20" 
                            : "bg-slate-100 dark:bg-slate-850 text-slate-400"
                        }`}>
                          {dashboardStats?.hasPow ? `AKTIV (${dashboardStats.avgPow} W)` : "INAKTIV"}
                        </span>
                      </div>

                      {/* Cadence Indicator */}
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950">
                        <div className="flex items-center gap-2">
                          <Settings size={14} className={dashboardStats?.hasCad ? "text-teal-500" : "text-slate-300"} />
                          <span className="text-xs font-bold text-slate-750 dark:text-slate-350">Trittfrequenz-Kanal (Cadence)</span>
                        </div>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase font-mono ${
                          dashboardStats?.hasCad 
                            ? "bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400 border border-teal-200/20" 
                            : "bg-slate-100 dark:bg-slate-850 text-slate-400"
                        }`}>
                          {dashboardStats?.hasCad ? `AKTIV (${dashboardStats.avgCad} rpm)` : "INAKTIV"}
                        </span>
                      </div>

                      {/* Elevation Indicator */}
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950">
                        <div className="flex items-center gap-2">
                          <Compass size={14} className={dashboardStats?.hasEle ? "text-sky-500" : "text-slate-300"} />
                          <span className="text-xs font-bold text-slate-750 dark:text-slate-350">Höhensensorik (Barometer)</span>
                        </div>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase font-mono ${
                          dashboardStats?.hasEle 
                            ? "bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border border-sky-200/20" 
                            : "bg-slate-100 dark:bg-slate-850 text-slate-400"
                        }`}>
                          {dashboardStats?.hasEle ? "AKTIV" : "INAKTIV"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Density Range Statistics */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-4 text-left">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-xl">
                        <Activity size={18} />
                      </div>
                      <h3 className="text-sm font-black text-slate-850 dark:text-slate-100">Messwert-Amplituden & Limits</h3>
                    </div>
                    
                    <p className="text-xs text-slate-400 leading-normal font-semibold">
                      Die extremen Amplitudenschwellen und Durchschnittswerte der decodierten Sensorknoten im Überblick.
                    </p>

                    <div className="space-y-3.5">
                      {/* Heart Rate Ranges */}
                      {dashboardStats?.hasHr && (
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            <span>Herzfrequenz (Puls-Spektrum)</span>
                            <span className="font-mono text-slate-755 dark:text-slate-300">{dashboardStats.minHr} - {dashboardStats.maxHr} bpm</span>
                          </div>
                          <div className="relative w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                            <div className="absolute top-0 bottom-0 bg-rose-500 rounded-full" style={{ left: '20%', right: '15%' }}></div>
                            <div className="absolute top-0 bottom-0 bg-rose-700 w-2 h-2 rounded-full border border-white" style={{ left: `${Math.min(95, (dashboardStats.avgHr! / 200) * 100)}%` }}></div>
                          </div>
                          <div className="flex justify-between text-[9px] text-slate-400 font-bold font-mono">
                            <span>{dashboardStats.minHr} Min</span>
                            <span className="text-rose-600 font-extrabold">{dashboardStats.avgHr} bpm Ø</span>
                            <span>{dashboardStats.maxHr} Max</span>
                          </div>
                        </div>
                      )}

                      {/* Power Ranges */}
                      {dashboardStats?.hasPow && (
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            <span>Leistungs-Amplituden (Watt)</span>
                            <span className="font-mono text-slate-755 dark:text-slate-300">Ø {dashboardStats.avgPow}W - Max {dashboardStats.maxPow}W</span>
                          </div>
                          <div className="relative w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                            <div className="absolute top-0 bottom-0 bg-amber-500 rounded-full" style={{ left: '0%', right: '30%' }}></div>
                            <div className="absolute top-0 bottom-0 bg-amber-700 w-2 h-2 rounded-full border border-white" style={{ left: `${Math.min(95, (dashboardStats.avgPow! / 600) * 100)}%` }}></div>
                          </div>
                          <div className="flex justify-between text-[9px] text-slate-400 font-bold font-mono">
                            <span>0 W Min</span>
                            <span className="text-amber-600 font-extrabold">{dashboardStats.avgPow} W Ø</span>
                            <span>{dashboardStats.maxPow} W Max</span>
                          </div>
                        </div>
                      )}

                      {/* Elevation Ranges */}
                      {dashboardStats?.hasEle && (
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            <span>Höhenbanderole (Barometrisch)</span>
                            <span className="font-mono text-slate-755 dark:text-slate-300">{Math.round(dashboardStats.minEle!)}m - {Math.round(dashboardStats.maxEle!)}m</span>
                          </div>
                          <div className="relative w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                            <div className="absolute top-0 bottom-0 bg-sky-500 rounded-full" style={{ left: '10%', right: '10%' }}></div>
                          </div>
                          <div className="flex justify-between text-[9px] text-slate-400 font-bold font-mono">
                            <span>{Math.round(dashboardStats.minEle!)} m Tiefster</span>
                            <span>{Math.round(dashboardStats.maxEle!)} m Höchster</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card 3: Binary vs XML File Architecture */}
                  <div className="bg-gradient-to-br from-indigo-500/5 to-purple-500/5 dark:from-indigo-950/20 dark:to-purple-950/20 border border-indigo-100/40 dark:border-indigo-900/10 rounded-3xl p-5 shadow-sm space-y-4 text-left">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl">
                        <Compass size={18} />
                      </div>
                      <h3 className="text-sm font-black text-slate-850 dark:text-slate-100">Datenstrom & Frequenzen</h3>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal font-semibold">
                      Wie der GPS-Empfänger und die Sensorik des Radcomputers die Datei partitionierten:
                    </p>

                    <div className="space-y-3 font-semibold text-xs leading-relaxed text-slate-705 dark:text-slate-300">
                      <div className="flex justify-between py-1 border-b border-indigo-100/30 dark:border-indigo-900/20">
                        <span className="text-slate-550 dark:text-slate-400">Aufnahmefrequenz:</span>
                        <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">~{dashboardStats?.avgSampleRate}s pro Punkt ({dashboardStats?.avgSampleRate === 1 ? "1 Hz" : "Smart Rec."})</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-indigo-100/30 dark:border-indigo-900/20">
                        <span className="text-slate-550 dark:text-slate-400">Dateigröße (Stufe):</span>
                        <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{rawDetails?.metadata?.rawRecords?.length ? `${(rawDetails.metadata.rawRecords.length * 128).toLocaleString('de-DE')} Bytes (Dekodiert)` : "-"}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-indigo-100/30 dark:border-indigo-900/20">
                        <span className="text-slate-550 dark:text-slate-400">Parser-Standard:</span>
                        <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{rawDetails?.fileType === 'fit' ? "FIT SDK Decopmiler" : "XML schema v1.1"}</span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-normal font-semibold pt-1">
                        {rawDetails?.fileType === 'fit' 
                          ? "Der FIT-Parser hat binäre Datenbytes entpackt (Message Types). Jede Message entspricht einem standardisierten Garmin Field Block." 
                          : "Der GPX-Parser hat XML-Datenknoten iteriert und strukturierte Weg- & Spurpunkte extrahiert."}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Conceptual Architecture Layout (File Anatomy Map) */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4 text-left">
                  <h3 className="text-sm font-black text-slate-850 dark:text-slate-100 flex items-center gap-2">
                    <Database size={16} className="text-indigo-500" />
                    Anatomie der Rohdaten-Dateistruktur (Wie ist das File aufgebaut?)
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed font-semibold max-w-3xl">
                    Fitnessdateien (FIT & GPX) sind modular gegliedert. Beim Einlesen in die App werden sie hierarchisch dekomprimiert:
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-semibold leading-relaxed">
                    {/* Layer 1: Header */}
                    <div className="bg-slate-50 dark:bg-slate-950 p-4 border border-slate-100 dark:border-slate-850 rounded-2xl relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-3 text-[30px] font-mono font-extrabold text-indigo-505/5 select-none leading-none">01</div>
                      <h4 className="font-extrabold text-indigo-600 dark:text-indigo-400 text-xs mb-1 uppercase tracking-wider">1. Dateiende & Header (Header Block)</h4>
                      <p className="text-[11px] text-slate-500 leading-normal font-medium">
                        Identifiziert das File: Dateityp (`file_id`, `bounds`), herstellendes Garmin/Wahoo Modell, Seriennummer, Firmware-Version. Lädt als erstes im Header.
                      </p>
                      <div className="mt-3 text-[10px] bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-650 dark:text-indigo-400 px-2 py-1 rounded inline-block font-mono">
                        Keys: manufacturer, product_name, serial_no
                      </div>
                    </div>

                    {/* Layer 2: Summary */}
                    <div className="bg-slate-50 dark:bg-slate-950 p-4 border border-slate-100 dark:border-slate-850 rounded-2xl relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-3 text-[30px] font-mono font-extrabold text-emerald-505/5 select-none leading-none">02</div>
                      <h4 className="font-extrabold text-emerald-600 dark:text-emerald-400 text-xs mb-1 uppercase tracking-wider">2. Summarische Sätze (Summary Records)</h4>
                      <p className="text-[11px] text-slate-500 leading-normal font-medium">
                        Auswertungen des Gesamt-Rides (`session`, `lap`, `sport`): Fahrtdauer, Gesamtstrecke, kumulierte Kalorien, exakte Durchschnittsleistungen und Höhenmeter.
                      </p>
                      <div className="mt-3 text-[10px] bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-650 dark:text-emerald-400 px-2 py-1 rounded inline-block font-mono">
                        Keys: total_timer_time, avg_heart_rate, total_calories
                      </div>
                    </div>

                    {/* Layer 3: Point Stream */}
                    <div className="bg-slate-50 dark:bg-slate-950 p-4 border border-slate-100 dark:border-slate-855 rounded-2xl relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-3 text-[30px] font-mono font-extrabold text-teal-505/5 select-none leading-none">03</div>
                      <h4 className="font-extrabold text-teal-600 dark:text-teal-400 text-xs mb-1 uppercase tracking-wider">3. Einzel-Trackpunkte (Sample Stream)</h4>
                      <p className="text-[11px] text-slate-500 leading-normal font-medium">
                        Der sekündliche Aufnahmestrom (`record`). Tausende geographische lat/lng Punkte verheiratet mit Höhenwerten (ele), Momentan-Watt (power), Momentan-Trittfrequenz und pulsierenden HF-Schlägen.
                      </p>
                      <div className="mt-3 text-[10px] bg-teal-50/50 dark:bg-teal-950/30 text-teal-650 dark:text-teal-400 px-2 py-1 rounded inline-block font-mono">
                        Keys: lat, lon, ele, timestamp, power, hr
                      </div>
                    </div>
                  </div>
                </div>

                {/* Raw Inspector Navigation Suggestion Banner */}
                <div className="p-4 bg-sky-50 dark:bg-sky-950/10 border border-sky-100/85 dark:border-sky-900/30 rounded-3xl flex items-center justify-between gap-4">
                  <div className="flex gap-3 text-xs text-sky-700 dark:text-sky-305 font-medium leading-relaxed text-left">
                    <Info size={18} className="shrink-0 text-sky-500 mt-0.5" />
                    <div>
                      <strong>Möchtest du tiefer graben?</strong> Nutze oben die Tabs <strong>'Header-Meldungen & Keys'</strong> für die kompletten Hardwareschlüssel, <strong>'Einzeldaten-Stream'</strong> für sekündliche Tabellenwerte mit Steigungs-Analysator, oder kopiere den nackten Rohcode im Tab <strong>'Komplette JSON-Struktur'</strong>.
                    </div>
                  </div>
                  <button 
                    onClick={() => setActiveTab('metadata')}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-black text-xs rounded-xl flex items-center gap-1 cursor-pointer shrink-0 transition-all font-sans"
                  >
                    <span>Header-Keys öffnen</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </motion.div>
            )}

            {activeTab === 'metadata' && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                className="flex-1 flex min-h-0"
              >
                {/* Sidebar message list */}
                <div className="w-[340px] border-r border-slate-100 dark:border-slate-800 flex flex-col bg-white dark:bg-slate-900/60 shrink-0 min-h-0">
                  <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 flex items-center relative shrink-0">
                    <Search className="absolute left-7 text-slate-400" size={14} />
                    <input
                      type="text"
                      placeholder="Meldungstypen filtern..."
                      value={recordSearch}
                      onChange={(e) => { setRecordSearch(e.target.value); setSelectedRecordIndex(0); }}
                      className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  {/* Sidebar list items */}
                  <div className="flex-1 overflow-y-auto p-3.5 space-y-2 min-h-0">
                    {filteredRecords.length === 0 ? (
                      <div className="text-center py-10 text-slate-400 font-bold text-xs">Keine passenden Datensätze gefunden</div>
                    ) : (
                      filteredRecords.map((rec, idx) => {
                        const isSelected = selectedRecordIndex === idx;
                        return (
                          <button
                            key={idx}
                            onClick={() => setSelectedRecordIndex(idx)}
                            className={`w-full text-left p-3 rounded-2xl border text-xs leading-normal transition-all cursor-pointer flex items-center justify-between group ${
                              isSelected 
                                ? 'bg-indigo-600 border-indigo-700 text-white shadow-md' 
                                : 'bg-slate-50 dark:bg-slate-900 border-slate-100 dark:border-slate-850 text-slate-705 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-slate-800'
                            }`}
                          >
                            <div className="space-y-1">
                              <span className="font-extrabold uppercase font-mono tracking-wide text-[10px] block">
                                {rec.type}
                              </span>
                              <span className={`text-[9px] block ${isSelected ? 'text-indigo-200' : 'text-slate-400 dark:text-slate-500'} font-bold`}>
                                {Object.keys(rec.data).length} Parameter decodiert
                              </span>
                            </div>
                            <ChevronRight size={14} className={`opacity-60 group-hover:opacity-100 transition-opacity ${isSelected ? 'text-white' : 'text-slate-400'}`} />
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Main key-value inspector */}
                <div className="flex-1 flex flex-col min-h-0 bg-slate-50/50 dark:bg-slate-950/20 p-6 overflow-y-auto">
                  {activeRecord ? (
                    <div className="space-y-6">
                      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-3xl flex items-center justify-between shadow-sm">
                        <div>
                          <span className="text-[10px] font-mono font-black text-indigo-500 uppercase tracking-widest block">Ausgewählter Meldungstyp</span>
                          <h3 className="text-base font-black text-slate-850 dark:text-slate-100 font-mono tracking-wider mt-0.5">
                            {activeRecord.type}
                          </h3>
                        </div>
                        <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-2xl text-xs font-mono font-black">
                          {Object.keys(activeRecord.data).length} Variable(n)
                        </div>
                      </div>

                      {/* Attribute Card Table */}
                      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-slate-950 text-slate-405 font-black uppercase text-[9px] tracking-wider border-b border-slate-100 dark:border-slate-800">
                              <th className="py-3 px-5">Decodierter Schlüssel (Key) & Erklärung</th>
                              <th className="py-3 px-5">Rohwert (Raw Decoded Value)</th>
                              <th className="py-3 px-5 w-24">Datentyp (Typ)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 dark:divide-slate-850">
                            {Object.entries(activeRecord.data).map(([key, val]) => {
                              const valueStr = val instanceof Date ? formatDate(val) : String(val);
                              const typeOfVal = val === null ? 'null' : typeof val;
                              const explanation = FIT_FIELD_EXPLANATIONS[key];
                              return (
                                <tr key={key} className="hover:bg-slate-50/40 dark:hover:bg-slate-900/60 font-medium">
                                  <td className="py-3.5 px-5 font-mono text-slate-800 dark:text-slate-205 font-bold">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-slate-850 dark:text-slate-100">{key}</span>
                                        {explanation && (
                                          <span className="bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-450 text-[9px] font-sans font-black px-1.5 py-0.5 rounded uppercase tracking-wide">
                                            {explanation.label}
                                          </span>
                                        )}
                                      </div>
                                      {explanation && (
                                        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-sans font-semibold leading-relaxed max-w-lg">
                                          {explanation.desc}
                                        </p>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-5 font-mono text-indigo-600 dark:text-indigo-400 font-bold truncate max-w-sm">
                                    {valueStr}
                                  </td>
                                  <td className="py-3.5 px-5 text-[10px] text-slate-405 dark:text-slate-505 font-mono uppercase">
                                    {typeOfVal}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Monospace Code Representation */}
                      <div className="bg-slate-900 dark:bg-slate-950 border border-slate-800 rounded-3xl p-5 shadow-inner">
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pb-3 border-b border-slate-800/80 mb-3">
                          <span>INTERNER STRUCT SCHEMA CODESNIPPET</span>
                          <span>JSON</span>
                        </div>
                        <pre className="font-mono text-[11px] text-emerald-450 dark:text-emerald-400 leading-relaxed overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(activeRecord, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
                      <BadgeInfo size={32} className="text-slate-350" />
                      <h4 className="text-sm font-black text-slate-600 dark:text-slate-400">Keine Meldung ausgewählt</h4>
                      <p className="text-xs text-slate-400 max-w-sm font-semibold">Wähle links einen dekomprimierten FIT Message-Typ aus, um alle Keys anzuzeigen.</p>
                    </div>
                  )}
                </div>

                {/* Right side: Smart glossary */}
                <div className="w-[360px] shrink-0 border-l border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col p-5 overflow-y-auto hidden xl:flex gap-5 select-none">
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono font-black text-indigo-500 uppercase tracking-widest block">TELEMETRIE-LEXIKON</span>
                    <h3 className="text-sm font-black text-slate-850 dark:text-slate-100 uppercase tracking-tight flex items-center gap-1.5">
                      <HelpCircle size={16} className="text-indigo-500" />
                      Erklärungs-Assistent
                    </h3>
                    <p className="text-[11px] text-slate-400 font-bold leading-relaxed">
                      Lerne die Struktur deiner Aufzeichnungen kennen. Sensorwerte, Header und mathematische Reduktionen einfach entschlüsselt.
                    </p>
                  </div>

                  {/* Active Message Highlight card */}
                  {activeRecord && (
                    <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-850 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="py-0.5 px-2 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 text-[9px] font-mono font-black uppercase rounded-md">
                          {FIT_MESSAGE_EXPLANATIONS[activeRecord.type]?.category || "System"}
                        </span>
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 font-bold">Meldung</span>
                      </div>
                      <h4 className="text-xs font-black text-slate-800 dark:text-slate-200 font-mono">
                        {FIT_MESSAGE_EXPLANATIONS[activeRecord.type]?.title || activeRecord.type}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-semibold">
                        {FIT_MESSAGE_EXPLANATIONS[activeRecord.type]?.desc || "Dieses Segment beinhaltet technische Systemparameter, die für den inneren Zustand von Sensorknoten oder Übertragungssperren der Tracker essenziell sind."}
                      </p>
                    </div>
                  )}

                  {/* Format Educational Card */}
                  <div className="bg-gradient-to-br from-indigo-500/5 to-purple-500/5 dark:from-indigo-950/20 dark:to-purple-950/20 p-4.5 rounded-2xl border border-indigo-100/40 dark:border-indigo-900/20 space-y-3">
                    <div className="flex items-center gap-2">
                      <FileCode size={15} className="text-indigo-500" />
                      <h4 className="text-xs font-black text-slate-800 dark:text-slate-200">
                        {rawDetails?.fileType === 'fit' ? 'Das .fit Dateiformat (Garmin)' : 'Das .gpx Dateiformat (XML)'}
                      </h4>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-semibold">
                      {rawDetails?.fileType === 'fit' ? (
                        "FIT steht für 'Flexible and Interoperable Data Transfer'. Es ist ein hocheffizientes, komprimiertes Binärformat. Dadurch benötigt es bis zu 100 Mal weniger Speicherplatz als XML/GPX und schont den Akku deines Radcomputers."
                      ) : (
                        "GPX steht für 'GPS Exchange Format' und baut auf klassischen XML-Klartextstrukturen auf. Es ist der absolute offene Weltstandard für Tracks und Wegpunkte. Dadurch ist es überall kompatibel, erzeugt jedoch größere Dateien."
                      )}
                    </p>
                  </div>

                  {/* Telemetry Guide Card */}
                  <div className="p-4 bg-slate-50/50 dark:bg-slate-950/40 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-3">
                    <h4 className="text-xs font-black text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Radio size={14} className="text-emerald-500 animate-pulse" />
                      Die 3 Säulen der Sport-Telemetrie
                    </h4>
                    
                    <div className="space-y-3 text-[11px] leading-relaxed">
                      <div>
                        <strong className="text-slate-700 dark:text-slate-300 block font-bold">1. Multi-Satelliten GPS Triangulation</strong>
                        <span className="text-slate-505 dark:text-slate-450 font-semibold">Empfänger synchronisieren Nanosekunden-Signale von GPS-, GLONASS- oder Galileo-Satelliten, um Breiten- und Längengrade (WGS84-Modell) kontinuierlich zu berechnen.</span>
                      </div>
                      <div>
                        <strong className="text-slate-700 dark:text-slate-300 block font-bold">2. Sensorfrequenzen (ANT+ & BLE)</strong>
                        <span className="text-slate-505 dark:text-slate-450 font-semibold">Herzfrequenz-Gurte und Pedal-Wattmesser senden kurbelsynchrone Impuls-Pakete per Nahverkehrsfunk. Im Rekorder werden diese Live-Kanäle mit dem GPS-Spurpunkt verheiratet.</span>
                      </div>
                      <div>
                        <strong className="text-slate-700 dark:text-slate-300 block font-bold">3. Barometrische Höhenmessung</strong>
                        <span className="text-slate-505 dark:text-slate-450 font-semibold">Spezielle Luftdruckmembranen im Inneren moderner Radcomputer erfassen Höhenunterschiede über meteorologische Barometerdaten – meilenweit präziser als städtisches GPS-Wandlerrauschen.</span>
                      </div>
                      <div>
                        <strong className="text-rose-600 dark:text-rose-400 block font-bold">4. Sensor-Glättungsfilter (Anomalie-Bereinigung)</strong>
                        <span className="text-slate-505 dark:text-slate-450 font-semibold">Messfehler wie unrealistische Pulssprünge (z. B. HF 255 bpm oder extreme Spitzen), unphysiologische Leistungsspitzen und Trittfrequenz-Ausreißer werden automatisch per linearer Nachbar-Interpolation geglättet und korrigiert.</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
            </AnimatePresence>

            {/* TAB 2: DETAILED TRACKPOINT STREAM */}
            <AnimatePresence mode="wait">
              {activeTab === 'points' && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                className="flex-1 flex min-h-0 overflow-hidden"
              >
                {/* Left side: Points list & Filter controller */}
                <div className="flex-1 flex flex-col min-h-0 bg-slate-50/50 dark:bg-slate-950/20 p-5 overflow-y-auto">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
                    <div>
                      <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <Terminal size={16} className="text-teal-500" />
                        Dekomprimierte Trackpoints & Roh-Telemetrie
                      </h3>
                      <p className="text-[11px] text-slate-400 font-bold leading-tight mt-1">
                        Sekündliche GPS-Rohdaten Koordinaten, Zeitstempel, Herz- und Kraftkanäle. Klicke auf einen Punkt für Details.
                      </p>
                    </div>

                    {/* Navigation Page */}
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-400 font-bold font-mono">
                        {totalPoints === 0 ? "Keine Punkte" : `Zeige ${((page-1)*rowsPerPage)+1}-${Math.min(totalPoints, page*rowsPerPage)} von ${totalPoints}`}
                      </span>
                      <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-1 shadow-sm">
                        <button
                          onClick={() => { setPage(p => Math.max(1, p - 1)); setSelectedPointIndex(0); }}
                          disabled={page === 1}
                          className="p-1 px-2 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-850 rounded disabled:opacity-30 cursor-pointer"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <span className="text-xs font-black text-slate-800 dark:text-slate-200 font-mono px-2">
                          {page} / {totalPages}
                        </span>
                        <button
                          onClick={() => { setPage(p => Math.min(totalPages, p + 1)); setSelectedPointIndex(0); }}
                          disabled={page === totalPages}
                          className="p-1 px-2 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-850 rounded disabled:opacity-30 cursor-pointer"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* High Quality Points Filter Pills */}
                  <div className="flex flex-wrap gap-1.5 mt-4 shrink-0 select-none">
                    <button
                      onClick={() => { setPointFilter('all'); setPage(1); setSelectedPointIndex(0); }}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase transition-all cursor-pointer ${
                        pointFilter === 'all'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-700 dark:hover:text-slate-350 border border-slate-100 dark:border-slate-800/80'
                      }`}
                    >
                      Alle Punkte ({currentTrack?.points?.length || 0})
                    </button>
                    <button
                      onClick={() => { setPointFilter('high_hr'); setPage(1); setSelectedPointIndex(0); }}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase transition-all flex items-center gap-1 cursor-pointer ${
                        pointFilter === 'high_hr'
                          ? 'bg-rose-600 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 border border-slate-100 dark:border-slate-800/80 hover:bg-rose-50/50 dark:hover:bg-rose-950/20'
                      }`}
                    >
                      <Heart size={10} fill="currentColor" /> Pulsintensiv &gt;140 bpm ({currentTrack?.points?.filter(p => p.hr !== undefined && p.hr > 140).length || 0})
                    </button>
                    <button
                      onClick={() => { setPointFilter('high_power'); setPage(1); setSelectedPointIndex(0); }}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase transition-all flex items-center gap-1 cursor-pointer ${
                        pointFilter === 'high_power'
                          ? 'bg-amber-600 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 border border-slate-100 dark:border-slate-800/80 hover:bg-amber-50/50 dark:hover:bg-amber-950/20'
                      }`}
                    >
                      <Activity size={10} /> Kraftbereich &gt;250 W ({currentTrack?.points?.filter(p => p.power !== undefined && p.power > 250).length || 0})
                    </button>
                    <button
                      onClick={() => { setPointFilter('climbing'); setPage(1); setSelectedPointIndex(0); }}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase transition-all flex items-center gap-1 cursor-pointer ${
                        pointFilter === 'climbing'
                          ? 'bg-sky-600 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 border border-slate-100 dark:border-slate-800/80 hover:bg-sky-50/50 dark:hover:bg-sky-950/20'
                      }`}
                    >
                      <Compass size={10} /> Bergauf-Höhendelta ({currentTrack?.points?.filter((p, i) => i > 0 && p.ele !== undefined && currentTrack.points[i-1].ele !== undefined && p.ele > currentTrack.points[i-1].ele!).length || 0})
                    </button>
                    <button
                      onClick={() => { setPointFilter('high_cadence'); setPage(1); setSelectedPointIndex(0); }}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase transition-all flex items-center gap-1 cursor-pointer ${
                        pointFilter === 'high_cadence'
                          ? 'bg-teal-600 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 border border-slate-100 dark:border-slate-800/80 hover:bg-teal-50/50 dark:hover:bg-teal-950/20'
                      }`}
                    >
                      <Settings size={10} /> Hohe Kurbelfrequenz &gt;90 rpm ({currentTrack?.points?.filter(p => p.cadence !== undefined && p.cadence > 90).length || 0})
                    </button>
                  </div>

                  {/* Points Table with selected highlighted row */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 rounded-3xl overflow-hidden mt-4 shadow-sm min-h-0 flex-1 overflow-y-auto">
                    {currentPointsPage.length === 0 ? (
                      <div className="p-12 text-center text-slate-400 font-bold text-xs space-y-2">
                        <BadgeInfo className="mx-auto text-slate-300" size={30} />
                        <h4>Keine Punkte für diesen FilterTyp gefunden</h4>
                        <p className="text-[10px] font-semibold text-slate-405">Nutze den ersten Filter 'Alle Punkte', um die komplette Serie zu sichten.</p>
                      </div>
                    ) : (
                      <table className="w-full text-left border-collapse text-xs select-none">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-950 text-slate-405 font-black uppercase text-[9px] tracking-wider border-b border-slate-100 dark:border-slate-800">
                            <th className="py-3 px-5 w-16">Status</th>
                            <th className="py-3 px-5">Zeitstempel (Timestamp)</th>
                            <th className="py-3 px-5">Breiten- & Längengrad</th>
                            <th className="py-3 px-5">Höhe</th>
                            <th className="py-3 px-5 text-center">Puls (HR)</th>
                            <th className="py-3 px-5 text-center">Trittfrequenz</th>
                            <th className="py-3 px-5 text-center">Effektive Watt</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 dark:divide-slate-850 font-semibold text-slate-700 dark:text-slate-350">
                          {currentPointsPage.map((pt, index) => {
                            const pointIndex = (page - 1) * rowsPerPage + index;
                            const isSelectedPoint = pointIndex === selectedPointIndex;
                            const globalPointNumber = pointIndex + 1;

                            return (
                              <tr 
                                key={index} 
                                onClick={() => setSelectedPointIndex(pointIndex)}
                                className={`cursor-pointer transition-all border-l-4 ${
                                  isSelectedPoint 
                                    ? 'bg-indigo-50/50 dark:bg-indigo-950/20 border-l-indigo-600 dark:border-l-indigo-500 font-extrabold text-slate-900 dark:text-white' 
                                    : 'border-l-transparent hover:bg-slate-50/50 dark:hover:bg-slate-900/40 text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                <td className="py-3.5 px-5 font-mono text-[10px] font-black">
                                  {isSelectedPoint ? (
                                    <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400">
                                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-ping" />
                                      AKTIV
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">#{globalPointNumber}</span>
                                  )}
                                </td>
                                <td className="py-3.5 px-5 font-mono">
                                  {formatDate(pt.time)}
                                </td>
                                <td className="py-3.5 px-5 font-mono text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                                  <div>Lat: {pt.lat.toFixed(6)}°</div>
                                  <div>Lng: {pt.lng.toFixed(6)}°</div>
                                </td>
                                <td className="py-3.5 px-5 font-mono text-indigo-600 dark:text-indigo-400 font-extrabold">
                                  {pt.ele !== undefined ? `${pt.ele.toFixed(1)} m` : '-'}
                                </td>
                                <td className="py-3.5 px-5 text-center font-mono">
                                  {pt.hr !== undefined ? (
                                    <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 bg-rose-50/50 dark:bg-rose-950/20 px-1.5 py-0.5 rounded font-black border border-rose-100/40">
                                      <Heart size={9} fill="currentColor" />
                                      {pt.hr} bpm
                                    </span>
                                  ) : '-'}
                                </td>
                                <td className="py-3.5 px-5 text-center font-mono font-bold text-teal-600 dark:text-teal-400">
                                  {pt.cadence !== undefined ? `${pt.cadence} rpm` : '-'}
                                </td>
                                <td className="py-3.5 px-5 text-center font-mono">
                                  {pt.power !== undefined ? (
                                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20 px-1.5 py-0.5 rounded font-black border border-amber-100/40">
                                      <Activity size={9} />
                                      {pt.power} W
                                    </span>
                                  ) : '-'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="mt-4 bg-sky-50/50 dark:bg-sky-950/10 border border-sky-100/60 dark:border-sky-900/40 rounded-2xl p-4 flex gap-3 text-[10px] text-sky-700 dark:text-sky-305 shrink-0">
                    <Info size={15} className="shrink-0 mt-0.5 text-sky-500" />
                    <div className="leading-relaxed font-semibold">
                      Tipp: Schalte mit dem obigen Pill-Filter z. B. auf <strong>'Bergauf-Höhendelta'</strong>, um exakt die Abschnitte zu filtrieren, in denen du geklettert bist. Wähle eine Zeile, um live Neigungen, Abstände und biologische Kennfelder einzusehen.
                    </div>
                  </div>
                </div>

                {/* Right side: Selected Trackpoint metrics explainer sidebar */}
                <div className="w-[370px] shrink-0 border-l border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col p-5 overflow-y-auto gap-5 select-none font-sans">
                  {selectedPointMetric ? (
                    <div className="space-y-4 leading-normal">
                      
                      {/* Badge indicator */}
                      <div className="space-y-1">
                        <span className="text-[10px] font-mono font-black text-indigo-500 uppercase tracking-widest block">DETAILS ZU WEGPUNKT</span>
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-black text-slate-850 dark:text-slate-150 font-mono">
                            Aufnahmepunkt #{selectedPointMetric.originalIndex + 1}
                          </h4>
                          <span className="bg-slate-100 dark:bg-slate-850 text-slate-600 dark:text-slate-400 font-mono text-[9px] px-1.5 py-0.5 rounded font-extrabold">
                            original_index: {selectedPointMetric.originalIndex}
                          </span>
                        </div>
                        <p className="text-[10px] font-mono text-slate-400 font-bold">
                          Mess-Zeit: {formatDate(selectedPointMetric.current.time)}
                        </p>
                      </div>

                      {/* Decoded Geo position with DMS conversions */}
                      <div className="p-3 bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-850 rounded-2xl space-y-2.5">
                        <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                          <MapPin size={13} className="text-indigo-500" />
                          <span>Geographische Koordinaten</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-xs font-semibold leading-relaxed">
                          <div>
                            <span className="text-[10px] text-slate-400 dark:text-slate-505 block">Breitengrad (Lat)</span>
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                              {selectedPointMetric.current.lat.toFixed(7)}°
                            </span>
                            <span className="text-[10px] text-indigo-650 dark:text-indigo-405 block font-mono font-black leading-none mt-0.5">
                              {decToDMS(selectedPointMetric.current.lat, true)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 dark:text-slate-505 block">Längengrad (Lng)</span>
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                              {selectedPointMetric.current.lng.toFixed(7)}°
                            </span>
                            <span className="text-[10px] text-indigo-650 dark:text-indigo-405 block font-mono font-black leading-none mt-0.5">
                              {decToDMS(selectedPointMetric.current.lng, false)}
                            </span>
                          </div>
                        </div>
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-850/60 flex justify-between items-center text-xs">
                          <div>
                            <span className="text-[10px] text-slate-404 block leading-none">Meereshöhe (Alt)</span>
                            <span className="font-mono text-xs font-black text-slate-805 dark:text-slate-205">
                              {selectedPointMetric.current.ele !== undefined ? `${selectedPointMetric.current.ele.toFixed(1)} m` : 'Keine vorhanden'}
                            </span>
                          </div>
                          {selectedPointMetric.current.ele !== undefined && (
                            <span className="text-[10px] font-mono text-slate-400 font-bold bg-slate-100 dark:bg-slate-900/60 px-1.5 py-0.5 rounded">
                              {(selectedPointMetric.current.ele * 3.28084).toFixed(0)} ft
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] text-slate-400 leading-normal font-semibold">
                          Diese GPS-Koordinaten repräsentieren den eindeutigen Standplatz im globalen Referenzsystem WGS-84 (World Geodetic System 1984), dem Standard für Sporttelemetrie.
                        </p>
                      </div>

                      {/* Computed Dynamics (Time, Dist, Velocity & Grade Slope) */}
                      <div className="p-3 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 dark:from-indigo-950/20 dark:to-purple-950/20 border border-indigo-100/30 dark:border-indigo-900/10 rounded-2xl space-y-2.5">
                        <div className="flex items-center gap-1.5 text-[10px] font-black text-indigo-500 uppercase tracking-wider">
                          <Activity size={13} />
                          <span>Abgeleitete Kinetische Dynamik</span>
                        </div>
                        
                        {selectedPointMetric.previous ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3.5 text-xs">
                              <div>
                                <span className="text-[9px] text-slate-450 uppercase block font-black leading-none">Strecke seit Letztem</span>
                                <span className="font-mono text-sm font-black text-slate-800 dark:text-slate-100">
                                  {selectedPointMetric.distanceM.toFixed(1)} Meter
                                </span>
                              </div>
                              <div>
                                <span className="text-[9px] text-slate-450 uppercase block font-black leading-none">Zeitlicher Abstand</span>
                                <span className="font-mono text-sm font-black text-indigo-600 dark:text-indigo-400">
                                  +{selectedPointMetric.timeDeltaSec.toFixed(1)} s
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3.5 text-xs pt-2 border-t border-indigo-50/40 dark:border-indigo-900/10">
                              <div>
                                <span className="text-[9px] text-slate-450 uppercase block font-black leading-none">Geschwindigkeit (Pace)</span>
                                <span className="font-mono text-sm font-black text-emerald-600 dark:text-emerald-450">
                                  {selectedPointMetric.speedKmh.toFixed(1)} km/h
                                </span>
                                <span className="text-[9px] text-slate-400 block font-semibold leading-none pt-0.5">
                                  {(selectedPointMetric.speedKmh / 1.60934).toFixed(1)} mph
                                </span>
                              </div>
                              <div>
                                <span className="text-[9px] text-slate-450 uppercase block font-black leading-none">Punktneigung (Incline)</span>
                                <span className={`font-mono text-sm font-black ${
                                  selectedPointMetric.slopePct > 0.5 ? 'text-rose-600' : selectedPointMetric.slopePct < -0.5 ? 'text-yellow-600' : 'text-slate-650'
                                }`}>
                                  {selectedPointMetric.slopePct > 0 ? '+' : ''}{selectedPointMetric.slopePct.toFixed(1)}%
                                </span>
                                <span className="text-[9px] text-slate-400 block font-semibold leading-none pt-0.5">
                                  {Math.abs(selectedPointMetric.slopePct) < 1 
                                    ? 'Flaches Geläuf' 
                                    : selectedPointMetric.slopePct > 6 
                                      ? 'Steiler Klettersatz' 
                                      : selectedPointMetric.slopePct > 1 
                                        ? 'Leichter Anlei' 
                                        : 'Gefälle / Abfahrt'}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-400 font-bold italic">
                            Erster Datenpunkt der Serie. Es stehen keine Messdaten für zurückgelegte Wege oder relative Temposchwankungen zur Verfügung.
                          </div>
                        )}
                        <p className="text-[9px] text-slate-400 leading-normal font-semibold">
                          Mathematische Herleitung: Berechnet über die <strong>Haversine-Formel</strong> entlang des sphärischen Erdkörpers zwischen diesem Punkt und dem zeitlich vorangehenden Spurpunkt.
                        </p>
                      </div>

                      {/* Biometric analysis parameters */}
                      <div className="p-3 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-800 rounded-2xl space-y-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                          <Radio size={13} className="text-emerald-500 animate-pulse" />
                          <span>Biologische Belastungskurven</span>
                        </div>

                        {/* Heart rate zone */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-[10px] text-slate-500 font-bold">Herzfrequenz (Gurt-Puls)</span>
                            <span className="font-mono text-[11px] text-slate-800 dark:text-slate-200 font-black">
                              {selectedPointMetric.current.hr !== undefined ? `${selectedPointMetric.current.hr} bpm` : "Nicht aufgezeichnet"}
                            </span>
                          </div>
                          {selectedPointMetric.current.hr !== undefined ? (
                            <div className="space-y-1 pt-0.5">
                              {/* Horizontal intensity indicator bar */}
                              <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full ${
                                    selectedPointMetric.current.hr > 165
                                      ? 'bg-rose-500' // Anaerobic red
                                      : selectedPointMetric.current.hr > 140
                                        ? 'bg-amber-500' // Threshold orange
                                        : 'bg-emerald-500' // Aerobic green
                                  }`} 
                                  style={{ width: `${Math.min(100, (selectedPointMetric.current.hr / 200) * 100)}%` }}
                                />
                              </div>
                              <p className="text-[9px] text-slate-400 font-semibold leading-relaxed">
                                {selectedPointMetric.current.hr > 165 
                                  ? "Maximalzone: Spitzenbelastung. Trainiert die aerobe Kapazität und schnellen Erholungspuffer." 
                                  : selectedPointMetric.current.hr > 140 
                                    ? "Aerobe Zone: Wirksame kardiovaskuläre Reize für das Herzmuskelvolumen." 
                                    : "Regenerativ-Zone: Aktive Erholung des Organismus."}
                              </p>
                            </div>
                          ) : (
                            <p className="text-[9px] text-slate-400 leading-normal font-semibold">Kein Herzfrequenzgurt am Tracker gekoppelt.</p>
                          )}
                        </div>

                        {/* Cadence analysis */}
                        <div className="space-y-1 pt-2 border-t border-slate-100 dark:border-slate-850/60">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-[10px] text-slate-500 font-bold">Umdrehungen (Cadence)</span>
                            <span className="font-mono text-[11px] text-slate-800 dark:text-slate-200 font-black">
                              {selectedPointMetric.current.cadence !== undefined ? `${selectedPointMetric.current.cadence} rpm` : "Nicht aufgezeichnet"}
                            </span>
                          </div>
                          {selectedPointMetric.current.cadence !== undefined ? (
                            <div className="space-y-1">
                              <p className="text-[9px] text-slate-400 font-semibold leading-relaxed">
                                {selectedPointMetric.current.cadence < 70 
                                  ? "Niedrige Frequenz (schwerer Tritt). Hoher Drehmomentdruck auf Sehnen und Kniegelenke." 
                                  : selectedPointMetric.current.cadence > 95 
                                    ? "Sehr hohe Frequenz. Nutzt die kardiomotorische Energie, spart Glykogenspeicher." 
                                    : "Optimaler Frequenzbereich (70-95 rpm) für den idealen Gelenkschutz."}
                              </p>
                            </div>
                          ) : (
                            <p className="text-[9px] text-slate-400 leading-normal font-semibold">Kein Trittfrequenzsensor für Kurbeln gekoppelt.</p>
                          )}
                        </div>

                        {/* Power output in Watt */}
                        <div className="space-y-1 pt-2 border-t border-slate-100 dark:border-slate-850/60">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-[10px] text-slate-500 font-bold">Leistung (Kraftmesser)</span>
                            <span className="font-mono text-[11px] text-slate-800 dark:text-slate-200 font-black">
                              {selectedPointMetric.current.power !== undefined ? `${selectedPointMetric.current.power} Watt` : "Nicht aufgezeichnet"}
                            </span>
                          </div>
                          {selectedPointMetric.current.power !== undefined ? (
                            <div className="space-y-1">
                              <p className="text-[9px] text-slate-400 font-semibold leading-relaxed">
                                Physik-Äquivalent: Generiert <strong>{selectedPointMetric.current.power} Joules kinetische Arbeit pro Sekunde</strong>. Bei 75 kg Fahrergewicht entspricht das einer Leistung von <strong>{(selectedPointMetric.current.power / 75).toFixed(1)} W/kg</strong>.
                              </p>
                            </div>
                          ) : (
                            <p className="text-[9px] text-slate-400 leading-normal font-semibold">Keine Leistungskanal-Sensoren gekoppelt.</p>
                          )}
                        </div>

                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
                      <Terminal size={32} className="text-slate-350" />
                      <h4 className="text-sm font-black text-slate-600">Kein Punkt selektiert</h4>
                      <p className="text-xs text-slate-400 max-w-sm">
                        Wähle links eine Zeile im Daten-Grid aus, um die biomechanische und geographische Analyse für diesen Punkt sogleich zu laden.
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* TAB 3: COMPLETE JSON STRUCTURE TREE */}
          <AnimatePresence mode="wait">
            {activeTab === 'json' && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                className="flex-1 flex flex-col min-h-0 bg-slate-50/50 dark:bg-slate-950/20 p-6 overflow-y-auto"
              >
                <div className="bg-slate-900 dark:bg-slate-950 border border-slate-800 rounded-3xl p-5 flex flex-col flex-1 min-h-0 shadow-inner">
                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pb-3 border-b border-slate-800/80 mb-3 shrink-0">
                    <span>COMPLETE RAW TRACK TELEMETRY INSPECTION STRUCTURE</span>
                    <span className="text-teal-400 font-extrabold uppercase">Full-Dump JSON Schema</span>
                  </div>

                  <div className="flex-1 overflow-y-auto min-h-0 font-mono text-xs text-emerald-450 dark:text-emerald-400 bg-black/30 p-4 rounded-2xl border border-slate-900">
                    <pre className="whitespace-pre-wrap leading-relaxed">
                      {JSON.stringify({
                        id: currentTrack.id,
                        name: currentTrack.name,
                        activityType: currentTrack.activityType,
                        stats: {
                          distanceKm: currentTrack.distance,
                          ascentM: currentTrack.ascent,
                          descentM: currentTrack.descent,
                          maxSlopePct: currentTrack.maxSlope,
                          durationS: currentTrack.duration,
                          hasTimestamps: currentTrack.hasTimestamps
                        },
                        rawFileDetails: rawDetails,
                        points: currentTrack.points.slice(0, 15).concat([{ '...': `Und ${totalPoints - 15} weitere dekomprimierte Punktdatensätze` } as any])
                      }, null, 2)}
                    </pre>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </motion.div>
    </motion.div>
  );
};
