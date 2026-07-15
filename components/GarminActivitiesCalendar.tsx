import React, { useState, useMemo } from 'react';
import { 
  Calendar, Download, FileText, Check, MapPin, 
  ArrowLeft, ArrowRight, Activity, Clock, Flame, 
  Heart, ArrowUpRight, Info, HelpCircle, FileSpreadsheet, FileCode, Sliders, Bell
} from 'lucide-react';
import { motion } from 'motion/react';

interface GarminActivity {
  id: string;
  name: string;
  type: string;
  date: string;
  distance: number;
  duration: number;
  ascent?: number;
  descent?: number;
  calories?: number;
  avg_hr?: number;
  description?: string;
  location?: string;
  points_json?: string;
}

interface GarminActivitiesCalendarProps {
  activities: GarminActivity[];
  onLoadActivity: (activity: GarminActivity) => void;
}

function isRunningType(type: string | undefined, name?: string): boolean {
  if (!type && !name) return false;
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  return t.includes('run') || t.includes('laufen') || t.includes('jog') || t.includes('walk') || t.includes('hike') ||
         n.includes('run') || n.includes('laufen') || n.includes('jog') || n.includes('walk') || n.includes('hike');
}

function isCyclingType(type: string | undefined, name?: string): boolean {
  if (!type && !name) return false;
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  return t.includes('cycle') || t.includes('bike') || t.includes('rad') || t.includes('road_biking') || t.includes('indoor_cycling') || t.includes('gravel_biking') || t.includes('mountain_biking') || t.includes('spin') ||
         n.includes('cycle') || n.includes('bike') || n.includes('rad') || n.includes('road_biking') || n.includes('indoor_cycling') || n.includes('gravel_biking') || n.includes('mountain_biking') || n.includes('spin') || n.includes('fahrrad') || n.includes('biking') || n.includes('cycling');
}

export const GarminActivitiesCalendar: React.FC<GarminActivitiesCalendarProps> = ({ 
  activities, 
  onLoadActivity 
}) => {
  // Use metadata-provided current date as reference, or maximum activity date
  const referenceDate = useMemo(() => {
    // 2026-07-15 is the user's current sandbox time, let's use that as primary reference for "last 30 days"
    const metaDate = new Date("2026-07-15T04:43:32-07:00");
    
    // Self-healing check: if activities are historical (e.g. from 2024 or 2025), let's set the reference to the latest activity date
    if (activities.length > 0) {
      const sorted = [...activities]
        .filter(a => a.date)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      if (sorted.length > 0) {
        const latestActDate = new Date(sorted[0].date);
        // If the latest activity is older than the sandbox time, use the latest activity's date so the user gets relevant "last 30 days"
        if (latestActDate.getTime() > metaDate.getTime() || (metaDate.getTime() - latestActDate.getTime()) > 60 * 24 * 60 * 60 * 1000) {
          return latestActDate;
        }
      }
    }
    return metaDate;
  }, [activities]);

  // Compute 30 days window start
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - 30);
    return d;
  }, [referenceDate]);

  // Filter activities in the last 30 days for top-bar statistics
  const last30DaysActivities = useMemo(() => {
    return activities.filter(act => {
      if (!act.date) return false;
      const actDate = new Date(act.date);
      return actDate >= thirtyDaysAgo && actDate <= referenceDate;
    });
  }, [activities, thirtyDaysAgo, referenceDate]);

  // Calendar State
  const [currentYear, setCurrentYear] = useState(referenceDate.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(referenceDate.getMonth()); // 0-11
  const [selectedDayStr, setSelectedDayStr] = useState<string | null>(
    referenceDate.toISOString().split('T')[0]
  );
  
  // Export Konfigurator States
  const [exportFormat, setExportFormat] = useState<'ics' | 'csv' | 'md' | 'json'>('ics');
  const [exportRange, setExportRange] = useState<'30days' | 'current_month' | 'all'>('30days');
  const [exportSport, setExportSport] = useState<'all' | 'running' | 'cycling'>('all');
  const [icsReminder, setIcsReminder] = useState<string>('-PT15M'); // 15 mins before by default
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Month names
  const monthNames = [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember"
  ];

  // Calendar Generation
  const daysInMonth = useMemo(() => {
    return new Date(currentYear, currentMonth + 1, 0).getDate();
  }, [currentYear, currentMonth]);

  const firstDayOfWeek = useMemo(() => {
    // 0 = Sunday, 1 = Monday ... 6 = Saturday
    const day = new Date(currentYear, currentMonth, 1).getDay();
    // Adjust to Monday = 0, Sunday = 6
    return day === 0 ? 6 : day - 1;
  }, [currentYear, currentMonth]);

  // Activities mapped to dates for quick lookup
  const activitiesByDate = useMemo(() => {
    const map = new Map<string, GarminActivity[]>();
    activities.forEach(act => {
      if (!act.date) return;
      const dStr = act.date.split('T')[0];
      const existing = map.get(dStr) || [];
      existing.push(act);
      map.set(dStr, existing);
    });
    return map;
  }, [activities]);

  // Select day handler
  const handleDayClick = (day: number) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const dStr = `${currentYear}-${pad(currentMonth + 1)}-${pad(day)}`;
    setSelectedDayStr(dStr);
  };

  // Nav month
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonth(prev => prev + 1);
    }
  };

  // Helper to escape special characters in ICS strings to comply with RFC 5545
  const escapeIcsText = (text: string | undefined): string => {
    if (!text) return '';
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '');
  };

  // Safe Date parsing helper for ICS export
  const parseActivityDate = (dateStr: string): Date => {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return new Date(year, month, day, 10, 0, 0); // default to 10:00 AM local
    }
    return new Date();
  };

  // Format Date for ICS: YYYYMMDDTHHMMSSZ (UTC)
  const formatIcsDate = (date: Date): string => {
    const pad = (num: number) => String(num).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    const mm = pad(date.getUTCMonth() + 1);
    const dd = pad(date.getUTCDate());
    const hh = pad(date.getUTCHours());
    const min = pad(date.getUTCMinutes());
    const ss = pad(date.getUTCSeconds());
    return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`;
  };

  // Format Duration for description: e.g. "1 Std. 12 Min."
  const formatDurationText = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs} Std. ${mins} Min.`;
    return `${mins} Min. ${secs} Sek.`;
  };

  // Generate VEVENT block with optional custom Alarm/Reminder
  const generateVEventWithAlarm = (act: GarminActivity, reminderCode: string): string => {
    const startDate = parseActivityDate(act.date);
    const endDate = new Date(startDate.getTime() + (act.duration || 3600) * 1000);
    const stamp = formatIcsDate(new Date());
    const startStr = formatIcsDate(startDate);
    const endStr = formatIcsDate(endDate);

    const descLines = [
      `Sportart: ${escapeIcsText(act.type || 'Aktivität')}`,
      `Distanz: ${act.distance.toFixed(2)} km`,
      `Dauer: ${formatDurationText(act.duration)}`,
      act.calories ? `Kalorien: ${act.calories} kcal` : '',
      act.avg_hr ? `Ø Puls: ${act.avg_hr} bpm` : '',
      act.ascent ? `Höhenmeter: +${Math.round(act.ascent)}m` : '',
      act.description ? `Beschreibung: ${escapeIcsText(act.description)}` : '',
      act.location ? `Ort: ${escapeIcsText(act.location)}` : ''
    ].filter(Boolean).join('\\n');

    let alarmBlock = '';
    if (reminderCode !== 'none') {
      let reminderText = 'Training anstehend!';
      if (reminderCode === '-PT15M') reminderText = 'In 15 Minuten: Training anstehend!';
      if (reminderCode === '-PT1H') reminderText = 'In 1 Stunde: Training anstehend!';
      if (reminderCode === '-P1D') reminderText = 'Morgen: Training anstehend!';
      
      alarmBlock = [
        'BEGIN:VALARM',
        `TRIGGER:${reminderCode}`,
        'ACTION:DISPLAY',
        `DESCRIPTION:Erinnerung: ${escapeIcsText(act.name || 'Training')} (${act.distance.toFixed(1)} km) - ${reminderText}`,
        'END:VALARM'
      ].join('\r\n') + '\r\n';
    }

    return [
      'BEGIN:VEVENT',
      `UID:garmin-activity-${act.id}@gpxroutemaster.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${startStr}`,
      `DTEND:${endStr}`,
      `SUMMARY:${escapeIcsText(act.name || 'Garmin Aktivität')}`,
      `DESCRIPTION:${descLines}`,
      `LOCATION:${escapeIcsText(act.location || '')}`,
      alarmBlock ? alarmBlock.trim() : '',
      'END:VEVENT'
    ].filter(Boolean).join('\r\n');
  };

  // Export SINGLE activity as .ics (uses 15 min reminder by default)
  const exportSingleIcs = (act: GarminActivity) => {
    const event = generateVEventWithAlarm(act, '-PT15M');
    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//GPX Route Master//Garmin Activities//DE',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      event,
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    // Generate clean filename
    const sanitizedName = (act.name || 'aktivitaet').toLowerCase().replace(/[^a-z0-9]/g, '_');
    link.setAttribute('download', `garmin_${act.date.split('T')[0]}_${sanitizedName}.ics`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);
    
    setExportSuccess(`Einzeltermin "${act.name}" erfolgreich exportiert!`);
    setTimeout(() => setExportSuccess(null), 3000);
  };

  // Excel / CSV Export helper
  const exportToCsv = (acts: GarminActivity[]) => {
    const headers = ["ID", "Datum", "Name", "Sportart", "Distanz (km)", "Dauer (Sekunden)", "Dauer (Formatiert)", "Kalorien (kcal)", "Puls (Avg)", "Ort", "Beschreibung"];
    const rows = acts.map(act => [
      act.id,
      act.date.split('T')[0],
      `"${(act.name || '').replace(/"/g, '""')}"`,
      act.type || 'Aktivität',
      act.distance.toFixed(2),
      act.duration,
      formatDurationText(act.duration),
      act.calories || '',
      act.avg_hr || '',
      `"${(act.location || '').replace(/"/g, '""')}"`,
      `"${(act.description || '').replace(/"/g, '""')}"`
    ]);
    
    // Join with semicolon for standard European Excel compatibility
    const csvContent = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    // Write UTF-8 BOM to make sure German Umlaute like 'März', 'Aktivität', 'Höhenmeter' display correctly in Excel
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `garmin_trainingsplan_export_${new Date().toISOString().split('T')[0]}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);
  };

  // Markdown Trainings-Report Export helper
  const exportToMarkdown = (acts: GarminActivity[]) => {
    const totalDistance = acts.reduce((sum, a) => sum + a.distance, 0);
    const totalDuration = acts.reduce((sum, a) => sum + a.duration, 0);
    const totalCalories = acts.reduce((sum, a) => sum + (a.calories || 0), 0);
    const runActs = acts.filter(a => isRunningType(a.type, a.name));
    const bikeActs = acts.filter(a => isCyclingType(a.type, a.name));
    
    const mdLines = [
      `# 🏃 GARMIN CONNECT TRAININGSPLAN & AKTIVITÄTEN-BERICHT`,
      `**Erstellt am**: ${new Date().toLocaleDateString('de-DE')} um ${new Date().toLocaleTimeString('de-DE')}`,
      `**Exportierte Einheiten**: ${acts.length}`,
      ``,
      `## 📊 ZUSAMMENFASSUNG`,
      `- **Gesamtdistanz**: ${totalDistance.toFixed(2)} km`,
      `- **Gesamtdauer**: ${formatDurationText(totalDuration)}`,
      `- **Energieverbrauch**: ${totalCalories.toLocaleString('de-DE')} kcal`,
      `- **Laufeinheiten**: ${runActs.length} (${runActs.reduce((s, a) => s + a.distance, 0).toFixed(1)} km)`,
      `- **Radeinheiten**: ${bikeActs.length} (${bikeActs.reduce((s, a) => s + a.distance, 0).toFixed(1)} km)`,
      ``,
      `## 🗓️ DETAIL-PLAN DER EINHEITEN`,
      `| Datum | Sportart | Name der Einheit | Distanz | Dauer | Puls (Ø) | Ort / Location |`,
      `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`
    ];
    
    // Sort chronologically
    const sortedActs = [...acts].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    sortedActs.forEach(act => {
      const typeStr = isRunningType(act.type, act.name) ? '🏃 Laufen' : isCyclingType(act.type, act.name) ? '🚴 Radsport' : '⏱️ Andere';
      mdLines.push(`| ${act.date.split('T')[0]} | ${typeStr} | ${act.name || 'Einheit'} | ${act.distance.toFixed(2)} km | ${formatDurationText(act.duration)} | ${act.avg_hr ? `${act.avg_hr} bpm` : '-'} | ${act.location || '-'} |`);
    });
    
    mdLines.push(
      ``,
      `---`,
      `*Dieser Bericht wurde automatisch aus Ihrem Garmin-Aktivitätsverlauf generiert. Viel Erfolg beim Training!*`
    );
    
    const mdContent = mdLines.join('\n');
    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `garmin_trainingsbericht_${new Date().toISOString().split('T')[0]}.md`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);
  };

  // JSON Raw Data Export helper
  const exportToJson = (acts: GarminActivity[]) => {
    const jsonContent = JSON.stringify(acts, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `garmin_trainingsdaten_${new Date().toISOString().split('T')[0]}.json`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);
  };

  // Helper filters to apply the range
  const applyRangeFilter = (acts: GarminActivity[], rangeType: '30days' | 'current_month' | 'all') => {
    if (rangeType === 'all') return acts;
    if (rangeType === '30days') {
      return acts.filter(act => {
        if (!act.date) return false;
        const actDate = new Date(act.date);
        return actDate >= thirtyDaysAgo && actDate <= referenceDate;
      });
    }
    if (rangeType === 'current_month') {
      return acts.filter(act => {
        if (!act.date) return false;
        const actDate = new Date(act.date);
        return actDate.getFullYear() === currentYear && actDate.getMonth() === currentMonth;
      });
    }
    return acts;
  };

  const applySportFilter = (acts: GarminActivity[], sportType: 'all' | 'running' | 'cycling') => {
    if (sportType === 'all') return acts;
    if (sportType === 'running') {
      return acts.filter(a => isRunningType(a.type, a.name));
    }
    if (sportType === 'cycling') {
      return acts.filter(a => isCyclingType(a.type, a.name));
    }
    return acts;
  };

  // Main Unified Export Trigger
  const handleConfiguredExport = () => {
    let filtered = applyRangeFilter(activities, exportRange);
    filtered = applySportFilter(filtered, exportSport);

    if (filtered.length === 0) {
      setExportError("Keine Aktivitäten für diese Filterkombination gefunden.");
      setTimeout(() => setExportError(null), 4000);
      return;
    }

    if (exportFormat === 'ics') {
      const events = filtered.map(act => generateVEventWithAlarm(act, icsReminder)).join('\r\n');
      const icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//GPX Route Master//Garmin Activities//DE',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        events,
        'END:VCALENDAR'
      ].join('\r\n');

      const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      let rangeName = 'gesamt';
      if (exportRange === '30days') rangeName = 'letzte_30_tage';
      if (exportRange === 'current_month') rangeName = `${monthNames[currentMonth].toLowerCase()}_${currentYear}`;
      
      link.setAttribute('download', `garmin_trainingsplan_${rangeName}.ics`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 100);

      setExportSuccess(`Trainingsplan im Kalender-Format (.ics) mit ${filtered.length} Einheiten erfolgreich exportiert!`);
    } 
    else if (exportFormat === 'csv') {
      exportToCsv(filtered);
      setExportSuccess(`Trainingsdaten im Excel-Format (.csv) mit ${filtered.length} Einheiten exportiert!`);
    } 
    else if (exportFormat === 'md') {
      exportToMarkdown(filtered);
      setExportSuccess(`Trainingsbericht im Markdown-Format (.md) mit ${filtered.length} Einheiten exportiert!`);
    } 
    else if (exportFormat === 'json') {
      exportToJson(filtered);
      setExportSuccess(`Trainingsdaten im JSON-Format mit ${filtered.length} Einheiten exportiert!`);
    }

    setTimeout(() => setExportSuccess(null), 4000);
  };

  // Selected Day info and activities
  const selectedDayActivities = useMemo(() => {
    if (!selectedDayStr) return [];
    return activitiesByDate.get(selectedDayStr) || [];
  }, [selectedDayStr, activitiesByDate]);

  const formattedSelectedDate = useMemo(() => {
    if (!selectedDayStr) return '';
    const d = new Date(selectedDayStr);
    return d.toLocaleDateString('de-DE', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  }, [selectedDayStr]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
      {/* LEFT: Calendar view (8 cols) */}
      <div className="lg:col-span-8 flex flex-col space-y-4">
        {/* Top Controls Bar */}
        <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-2">
            <button 
              onClick={handlePrevMonth}
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer border border-slate-150 dark:border-slate-850"
            >
              <ArrowLeft className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            </button>
            <h2 className="text-sm font-black text-slate-800 dark:text-slate-100 min-w-[140px] text-center font-sans uppercase tracking-wider">
              {monthNames[currentMonth]} {currentYear}
            </h2>
            <button 
              onClick={handleNextMonth}
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer border border-slate-150 dark:border-slate-850"
            >
              <ArrowRight className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[11px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-orange-500" />
              <span>Letzte 30 Tage: <strong>{last30DaysActivities.length}</strong> Einheiten</span>
            </div>
            
            {/* Quick action linked to config panel */}
            <a
              href="#export-settings-card"
              className="px-3 py-1.5 rounded-xl text-[10px] bg-orange-500 text-white hover:bg-orange-600 shadow-sm shadow-orange-500/15 font-black uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer"
              title="Direkt zum konfigurierbaren Trainingsplan-Export springen"
            >
              <Download className="w-3.5 h-3.5" />
              Trainingsplan Exportieren
            </a>
          </div>
        </div>

        {/* Calendar Grid Container */}
        <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-3xl overflow-hidden shadow-xs flex-1 min-h-[420px] flex flex-col">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b border-slate-150 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 text-center font-sans font-black text-[10px] uppercase tracking-wider text-slate-400 py-3 shrink-0">
            <div>Mo</div>
            <div>Di</div>
            <div>Mi</div>
            <div>Do</div>
            <div>Fr</div>
            <div>Sa</div>
            <div>So</div>
          </div>

          {/* Grid Cells */}
          <div className="grid grid-cols-7 grid-rows-6 flex-1 divide-x divide-y divide-slate-100 dark:divide-slate-800/80 border-t border-slate-100 dark:border-slate-800/80">
            {/* Empty cells before the first day of month */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div 
                key={`empty-start-${i}`} 
                className="bg-slate-50/30 dark:bg-slate-950/10 min-h-[60px]"
              />
            ))}

            {/* Days of the month */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const pad = (n: number) => String(n).padStart(2, '0');
              const cellDateStr = `${currentYear}-${pad(currentMonth + 1)}-${pad(day)}`;
              const dayActs = activitiesByDate.get(cellDateStr) || [];
              const isSelected = selectedDayStr === cellDateStr;
              
              // Determine if this cell date is within the "last 30 days" window
              const cellDateObj = new Date(cellDateStr);
              const isIn30Days = cellDateObj >= thirtyDaysAgo && cellDateObj <= referenceDate;

              return (
                <div
                  key={`day-${day}`}
                  onClick={() => handleDayClick(day)}
                  className={`p-1.5 flex flex-col justify-between cursor-pointer transition-all hover:bg-slate-50/60 dark:hover:bg-slate-850/10 relative min-h-[65px] ${
                    isSelected 
                      ? 'ring-2 ring-orange-500/85 z-10 bg-orange-500/[0.03] dark:bg-orange-500/[0.01]' 
                      : ''
                  } ${
                    isIn30Days 
                      ? 'border-orange-500/15 bg-slate-50/[0.15]' 
                      : 'opacity-55 hover:opacity-100'
                  }`}
                >
                  {/* Day Indicator */}
                  <div className="flex justify-between items-center">
                    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${
                      isSelected
                        ? 'bg-orange-500 text-white font-black'
                        : isIn30Days
                        ? 'text-slate-850 dark:text-slate-150 font-bold bg-orange-50 dark:bg-orange-950/20'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}>
                      {day}
                    </span>

                    {/* Badge showing sum distance if multiple activities */}
                    {dayActs.length > 1 && (
                      <span className="text-[8px] font-black font-mono px-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded">
                        x{dayActs.length}
                      </span>
                    )}
                  </div>

                  {/* Day Activities List (Pills) */}
                  <div className="flex-1 flex flex-col justify-end space-y-1 mt-1.5">
                    {dayActs.slice(0, 3).map((act, idx) => {
                      const isRun = isRunningType(act.type, act.name);
                      const isBike = isCyclingType(act.type, act.name);
                      
                      let badgeBg = "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300";
                      if (isRun) {
                        badgeBg = "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-l-2 border-emerald-500";
                      } else if (isBike) {
                        badgeBg = "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border-l-2 border-blue-500";
                      }

                      return (
                        <div 
                          key={`${act.id}-${idx}`}
                          className={`text-[8px] font-bold px-1 py-0.5 rounded truncate ${badgeBg}`}
                          title={`${act.name}: ${act.distance.toFixed(1)} km`}
                        >
                          {isRun ? '🏃' : isBike ? '🚴' : '⏱️'} {act.distance > 0 ? `${act.distance.toFixed(1)}k` : act.name}
                        </div>
                      );
                    })}

                    {dayActs.length > 3 && (
                      <div className="text-[7px] font-black text-center text-slate-400">
                        +{dayActs.length - 3} weitere
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Empty cells at the end to complete the calendar grid */}
            {Array.from({ length: (42 - (daysInMonth + firstDayOfWeek)) % 7 }).map((_, i) => (
              <div 
                key={`empty-end-${i}`} 
                className="bg-slate-50/30 dark:bg-slate-950/10 min-h-[60px]"
              />
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT: Selected Day Panel & Trainingsplan-Export-Center (4 cols) */}
      <div className="lg:col-span-4 flex flex-col space-y-4 h-full">
        {/* Selected Day Panel */}
        <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-5 rounded-3xl shadow-xs flex-1 flex flex-col overflow-hidden min-h-[280px]">
          {/* Header info */}
          <div className="border-b border-slate-150 dark:border-slate-800 pb-4 shrink-0">
            <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Details für ausgewählten Tag
            </span>
            <h3 className="text-sm font-extrabold text-slate-850 dark:text-slate-100 mt-1 font-sans">
              {formattedSelectedDate}
            </h3>
          </div>

          {/* Activities list on that day */}
          <div className="flex-1 overflow-y-auto py-3 space-y-3">
            {selectedDayActivities.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4">
                <div className="p-3 bg-slate-50 dark:bg-slate-850 text-slate-400 rounded-full mb-3">
                  <Calendar className="w-6 h-6 stroke-1" />
                </div>
                <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400">
                  Keine Aktivitäten
                </h4>
                <p className="text-[10px] text-slate-400 max-w-[200px] mt-1 leading-relaxed">
                  Wähle einen anderen Tag im Kalender aus, der markiert ist, um die aufgezeichneten Einheiten anzuzeigen.
                </p>
              </div>
            ) : (
              selectedDayActivities.map((act) => {
                const isRun = isRunningType(act.type, act.name);
                const isBike = isCyclingType(act.type, act.name);

                return (
                  <div 
                    key={act.id}
                    className="p-4 rounded-2xl border border-slate-150 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/10 hover:bg-slate-50 dark:hover:bg-slate-850/20 transition-all flex flex-col space-y-3"
                  >
                    {/* Activity title */}
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-center gap-2">
                        <div className={`p-2 rounded-xl text-white ${
                          isRun ? 'bg-emerald-500' : isBike ? 'bg-blue-500' : 'bg-slate-500'
                        }`}>
                          {isRun ? (
                            <span className="text-xs font-black">🏃</span>
                          ) : isBike ? (
                            <span className="text-xs font-black">🚴</span>
                          ) : (
                            <Activity className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <div>
                          <h4 className="text-xs font-black text-slate-800 dark:text-slate-150 leading-tight truncate max-w-[130px]" title={act.name}>
                            {act.name}
                          </h4>
                          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                            {act.type || 'Aktivität'}
                          </span>
                        </div>
                      </div>

                      {/* Location */}
                      {act.location && (
                        <span className="text-[9px] font-bold text-slate-400 flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md truncate max-w-[100px]" title={act.location}>
                          <MapPin className="w-2.5 h-2.5" />
                          {act.location}
                        </span>
                      )}
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-2 rounded-xl flex flex-col">
                        <span className="text-[8px] font-sans font-extrabold uppercase tracking-wider text-slate-400">Distanz</span>
                        <span className="text-xs font-black text-slate-800 dark:text-slate-200 mt-0.5">
                          {act.distance.toLocaleString('de-DE', { minimumFractionDigits: 1 })} km
                        </span>
                      </div>
                      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-2 rounded-xl flex flex-col">
                        <span className="text-[8px] font-sans font-extrabold uppercase tracking-wider text-slate-400">Dauer</span>
                        <span className="text-xs font-black text-slate-800 dark:text-slate-200 mt-0.5">
                          {formatDurationText(act.duration)}
                        </span>
                      </div>
                      {act.calories && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-2 rounded-xl flex flex-col">
                          <span className="text-[8px] font-sans font-extrabold uppercase tracking-wider text-slate-400">Kalorien</span>
                          <span className="text-xs font-black text-orange-600 dark:text-orange-400 mt-0.5">
                            {Math.round(act.calories)} kcal
                          </span>
                        </div>
                      )}
                      {act.avg_hr && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-2 rounded-xl flex flex-col">
                          <span className="text-[8px] font-sans font-extrabold uppercase tracking-wider text-slate-400">Ø Puls</span>
                          <span className="text-xs font-black text-rose-500 mt-0.5">
                            {Math.round(act.avg_hr)} bpm
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Actions on this item */}
                    <div className="grid grid-cols-2 gap-2 pt-1.5">
                      <button
                        onClick={() => exportSingleIcs(act)}
                        className="py-1.5 bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/20 dark:hover:bg-orange-950/40 text-orange-700 dark:text-orange-400 text-[10px] font-black uppercase rounded-xl border border-orange-200/30 dark:border-orange-900/20 transition-all flex items-center justify-center gap-1 cursor-pointer"
                        title="Diesen einzelnen Termin als .ics herunterladen"
                      >
                        <Download className="w-3.5 h-3.5" />
                        ICS Export
                      </button>

                      <button
                        onClick={() => onLoadActivity(act)}
                        className="py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-[10px] font-black uppercase rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer"
                        title="Aktivität auf Karte laden"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" />
                        Workspace
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Export Success Message Overlay */}
          {exportSuccess && (
            <div className="bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-350 px-4 py-3 rounded-2xl flex items-center gap-2 text-[10px] font-bold shadow-xs shrink-0 mt-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0 stroke-[3]" />
              <span>{exportSuccess}</span>
            </div>
          )}

          {/* Export Error Message Overlay */}
          {exportError && (
            <div className="bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/40 text-rose-800 dark:text-rose-350 px-4 py-3 rounded-2xl flex items-center gap-2 text-[10px] font-bold shadow-xs shrink-0 mt-2">
              <Info className="w-4 h-4 text-rose-500 shrink-0 stroke-[2]" />
              <span>{exportError}</span>
            </div>
          )}
        </div>

        {/* NEW: Trainingsplan-Export-Center Configurator */}
        <div id="export-settings-card" className="bg-slate-900 text-white border border-slate-800 p-5 rounded-3xl shadow-lg flex flex-col space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Sliders className="w-4 h-4 text-orange-500" />
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider font-sans text-slate-100">
                Trainingsplan Export-Center
              </h4>
              <p className="text-[10px] text-slate-400 leading-none mt-1">
                Individuelle Formate & Filter zusammenstellen
              </p>
            </div>
          </div>

          {/* Format Selection */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Export-Format</label>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => setExportFormat('ics')}
                className={`py-2 px-1 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer ${
                  exportFormat === 'ics' 
                    ? 'bg-orange-500 text-white font-black scale-[1.03] shadow-sm shadow-orange-500/20' 
                    : 'bg-slate-800/65 hover:bg-slate-800 text-slate-300 text-slate-400'
                }`}
                title="iCalendar Kalenderdatei (.ics) für Apple, Google, Outlook"
              >
                <Calendar className="w-4 h-4 mb-1 text-slate-200" />
                <span className="text-[9px] font-bold uppercase">ICS</span>
              </button>

              <button
                type="button"
                onClick={() => setExportFormat('csv')}
                className={`py-2 px-1 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer ${
                  exportFormat === 'csv' 
                    ? 'bg-orange-500 text-white font-black scale-[1.03] shadow-sm shadow-orange-500/20' 
                    : 'bg-slate-800/65 hover:bg-slate-800 text-slate-300 text-slate-400'
                }`}
                title="Semicolon-Separated CSV für Microsoft Excel oder Google Sheets"
              >
                <FileSpreadsheet className="w-4 h-4 mb-1 text-slate-200" />
                <span className="text-[9px] font-bold uppercase">Excel</span>
              </button>

              <button
                type="button"
                onClick={() => setExportFormat('md')}
                className={`py-2 px-1 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer ${
                  exportFormat === 'md' 
                    ? 'bg-orange-500 text-white font-black scale-[1.03] shadow-sm shadow-orange-500/20' 
                    : 'bg-slate-800/65 hover:bg-slate-800 text-slate-300 text-slate-400'
                }`}
                title="Schöner Markdown-Zusammenfassungsbericht (.md) für Notizen-Apps"
              >
                <FileText className="w-4 h-4 mb-1 text-slate-200" />
                <span className="text-[9px] font-bold uppercase">Report</span>
              </button>

              <button
                type="button"
                onClick={() => setExportFormat('json')}
                className={`py-2 px-1 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer ${
                  exportFormat === 'json' 
                    ? 'bg-orange-500 text-white font-black scale-[1.03] shadow-sm shadow-orange-500/20' 
                    : 'bg-slate-800/65 hover:bg-slate-800 text-slate-300 text-slate-400'
                }`}
                title="Strukturierte JSON-Rohdaten (.json) für Programmierer & Backups"
              >
                <FileCode className="w-4 h-4 mb-1 text-slate-200" />
                <span className="text-[9px] font-bold uppercase">JSON</span>
              </button>
            </div>
          </div>

          {/* Range Selection */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Zeitraum</label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setExportRange('30days')}
                className={`py-1.5 px-1 text-[9px] font-black rounded-lg uppercase transition-all cursor-pointer ${
                  exportRange === '30days' 
                    ? 'bg-slate-100 text-slate-900' 
                    : 'bg-slate-800/50 hover:bg-slate-800 text-slate-300'
                }`}
              >
                30 Tage
              </button>
              <button
                type="button"
                onClick={() => setExportRange('current_month')}
                className={`py-1.5 px-1 text-[9px] font-black rounded-lg uppercase transition-all cursor-pointer ${
                  exportRange === 'current_month' 
                    ? 'bg-slate-100 text-slate-900' 
                    : 'bg-slate-800/50 hover:bg-slate-800 text-slate-300'
                }`}
                title={`Nur Aktivitäten aus ${monthNames[currentMonth]} ${currentYear} exportieren`}
              >
                Aktiv. Monat
              </button>
              <button
                type="button"
                onClick={() => setExportRange('all')}
                className={`py-1.5 px-1 text-[9px] font-black rounded-lg uppercase transition-all cursor-pointer ${
                  exportRange === 'all' 
                    ? 'bg-slate-100 text-slate-900' 
                    : 'bg-slate-800/50 hover:bg-slate-800 text-slate-300'
                }`}
              >
                Alle ({activities.length})
              </button>
            </div>
          </div>

          {/* Sportart Selection */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Sportart filtern</label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setExportSport('all')}
                className={`py-1.5 px-1 text-[9px] font-black rounded-lg uppercase transition-all cursor-pointer ${
                  exportSport === 'all' 
                    ? 'bg-orange-500/15 border border-orange-500/50 text-orange-400' 
                    : 'bg-slate-800/50 hover:bg-slate-800 text-slate-300 border border-transparent'
                }`}
              >
                Alle
              </button>
              <button
                type="button"
                onClick={() => setExportSport('running')}
                className={`py-1.5 px-1 text-[9px] font-black rounded-lg uppercase transition-all flex items-center justify-center gap-0.5 cursor-pointer ${
                  exportSport === 'running' 
                    ? 'bg-emerald-500/15 border border-emerald-500/50 text-emerald-400' 
                    : 'bg-slate-800/50 hover:bg-slate-800 text-slate-300 border border-transparent'
                }`}
              >
                🏃 Laufen
              </button>
              <button
                type="button"
                onClick={() => setExportSport('cycling')}
                className={`py-1.5 px-1 text-[9px] font-black rounded-lg uppercase transition-all flex items-center justify-center gap-0.5 cursor-pointer ${
                  exportSport === 'cycling' 
                    ? 'bg-blue-500/15 border border-blue-500/50 text-blue-400' 
                    : 'bg-slate-800/50 hover:bg-slate-800 text-slate-300 border border-transparent'
                }`}
              >
                🚴 Rad
              </button>
            </div>
          </div>

          {/* ICS specific options: Reminder */}
          {exportFormat === 'ics' && (
            <div className="space-y-1.5 bg-slate-850/50 p-2.5 rounded-xl border border-slate-800">
              <label className="text-[9px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Bell className="w-3 h-3 text-orange-400" />
                <span>Kalender-Erinnerung (Alarm)</span>
              </label>
              <select
                value={icsReminder}
                onChange={(e) => setIcsReminder(e.target.value)}
                className="w-full text-[10px] bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 outline-none focus:border-orange-500 cursor-pointer"
              >
                <option value="none">Keine Erinnerung</option>
                <option value="-PT15M">15 Minuten vorher</option>
                <option value="-PT1H">1 Stunde vorher</option>
                <option value="-P1D">1 Tag vorher</option>
              </select>
            </div>
          )}

          {/* Download button */}
          <button
            onClick={handleConfiguredExport}
            className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 shadow-md shadow-orange-500/10 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Jetzt Exportieren</span>
          </button>
        </div>

        {/* Legend Panel */}
        <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-4 rounded-3xl shadow-xs text-xs">
          <h4 className="font-extrabold text-slate-850 dark:text-slate-150 mb-2 flex items-center gap-1">
            <Info className="w-3.5 h-3.5 text-slate-400" />
            <span>Erklärung & Legende</span>
          </h4>
          <div className="space-y-2 text-slate-500 leading-relaxed text-[10px]">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-emerald-500 rounded" />
              <span><strong>Laufsport</strong> (Joggen, Trail, Wandern)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded" />
              <span><strong>Radsport</strong> (Rennrad, Gravel, MTB, Indoor)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-slate-400 rounded" />
              <span><strong>Andere Einheiten</strong> (Kraftsport, Cardio, Yoga)</span>
            </div>
            <p className="border-t border-slate-100 dark:border-slate-800 pt-2 mt-2">
              Das <strong>orange umrandete 30-Tage-Fenster</strong> basiert auf dem Datum Ihrer aktuellsten aufgezeichneten Garmin-Einheit.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
