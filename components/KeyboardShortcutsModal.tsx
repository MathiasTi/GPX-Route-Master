import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Keyboard, 
  Search, 
  Compass, 
  Eye, 
  Box, 
  Plane, 
  BookOpen, 
  TrendingUp, 
  RotateCcw, 
  Save, 
  Plus, 
  Minus, 
  ArrowLeft, 
  ArrowRight, 
  ArrowUp, 
  ArrowDown, 
  HelpCircle,
  Sparkles,
  Layers,
  Command
} from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';

export interface ShortcutItem {
  id: string;
  category: 'navigation' | 'analysis' | 'actions';
  keys: string[];
  title: string;
  description: string;
  badge?: string;
  icon?: React.ReactNode;
}

export const SHORTCUTS_DATA: ShortcutItem[] = [
  {
    id: 'cycle-tracks',
    category: 'navigation',
    keys: ['C'],
    title: 'Zwischen sichtbaren Tracks wechseln',
    description: 'Wechselt der Reihe nach durch alle im Workspace eingeblendeten Strecken und passt Zoom & Kartenausschnitt optimal an.',
    badge: 'Navigation',
    icon: <Eye className="w-4 h-4 text-blue-500" />
  },
  {
    id: 'map-hover-point',
    category: 'navigation',
    keys: ['M'],
    title: 'Karte auf aktuellen Trackpunkt zentrieren',
    description: 'Zentriert die Leaflet-/3D-Karte sofort auf die genaue Koordinate des aktuellen Cursors auf dem Höhenprofil.',
    badge: 'Präzision',
    icon: <Compass className="w-4 h-4 text-emerald-500" />
  },
  {
    id: 'step-points',
    category: 'navigation',
    keys: ['←', '→'],
    title: 'Punkt-für-Punkt Streckennavigation',
    description: 'Springt bei markiertem Track schrittweise zum vorherigen oder nächsten GPS-Trackpunkt entlang des Höhenprofils.',
    badge: 'Profil',
    icon: <ArrowRight className="w-4 h-4 text-sky-500" />
  },
  {
    id: 'pan-map',
    category: 'navigation',
    keys: ['↑', '↓', '←', '→'],
    title: 'Kartenansicht feinstufig verschieben',
    description: 'Bewegt den Kartenausschnitt ruckelfrei in die gewünschte Himmelsrichtung (dynamisch an die Zoomstufe angepasst).',
    badge: 'Panning',
    icon: <ArrowUp className="w-4 h-4 text-slate-500" />
  },
  {
    id: 'zoom-in-out',
    category: 'navigation',
    keys: ['+', '-'],
    title: 'Zoom vergrößern / verkleinern',
    description: 'Zoomt stufenweise in die Karte hinein oder heraus (+ / = zum Vergrößern, - zum Verkleinern).',
    badge: 'Zoom',
    icon: <Plus className="w-4 h-4 text-indigo-500" />
  },
  {
    id: 'toggle-3d',
    category: 'analysis',
    keys: ['3'],
    title: '3D-Geländeprofil umschalten',
    description: 'Aktiviert oder deaktiviert die echte 3D-MapLibre-Terrain-Ansicht mit 60° Neigungswinkel und Höhenrelief.',
    badge: '3D View',
    icon: <Box className="w-4 h-4 text-purple-500" />
  },
  {
    id: 'toggle-flyover',
    category: 'analysis',
    keys: ['F'],
    title: '3D-Flyover Flugsimulation',
    description: 'Startet oder pausiert den virtuellen Helikopter-Überflug entlang der markierten Route.',
    badge: 'Flugmodus',
    icon: <Plane className="w-4 h-4 text-amber-500" />
  },
  {
    id: 'toggle-dashboard-hud',
    category: 'analysis',
    keys: ['D'],
    title: 'Workspace-Gesamtübersicht (Dashboard) umschalten',
    description: 'Blendet die kumulierte Gesamtdistanz, Höhenmeter (Auf-/Abstieg) und Statistiken aller sichtbaren Strecken auf der Karte ein oder aus.',
    badge: 'Dashboard',
    icon: <Layers className="w-4 h-4 text-indigo-500" />
  },
  {
    id: 'open-intensive-analysis',
    category: 'analysis',
    keys: ['A', 'oder', 'I'],
    title: 'Intensive Strecken- & Steigungsanalyse',
    description: 'Öffnet die detaillierte Bergwertungs-Analyse (Kategorien HC/1-4, VAM, Leistungsprognosen & Streckencharakteristik).',
    badge: 'Analyse',
    icon: <TrendingUp className="w-4 h-4 text-rose-500" />
  },
  {
    id: 'open-glossary',
    category: 'analysis',
    keys: ['G'],
    title: 'Sport-Metriken & Trainingsglossar',
    description: 'Öffnet das wissenschaftliche Nachschlagewerk für VAM, TSS, FTP, EF, VO2max inklusive interaktiver Simulatoren.',
    badge: 'Glossar',
    icon: <BookOpen className="w-4 h-4 text-teal-500" />
  },
  {
    id: 'undo-action',
    category: 'actions',
    keys: ['Ctrl', '+', 'Z'],
    title: 'Letzte Bearbeitung rückgängig machen',
    description: 'Macht Aktionen wie Track-Umkehrung, Filterung, Splitten oder Zeitlücken-Entfernen sofort ungeschehen.',
    badge: 'History',
    icon: <RotateCcw className="w-4 h-4 text-amber-500" />
  },
  {
    id: 'save-library',
    category: 'actions',
    keys: ['Ctrl', '+', 'S'],
    title: 'Track in Bibliothek speichern',
    description: 'Speichert die aktuell markierte Route persistent in die SQLite-Streckenbibliothek.',
    badge: 'Datenbank',
    icon: <Save className="w-4 h-4 text-blue-500" />
  },
  {
    id: 'help-modal',
    category: 'actions',
    keys: ['?'],
    title: 'Tastaturkürzel-Hilfe öffnen',
    description: 'Blendet diese Übersicht aller verfügbaren Tastatur-Shortcuts ein (auch via Shift + / oder F1).',
    badge: 'Hilfe',
    icon: <HelpCircle className="w-4 h-4 text-indigo-500" />
  },
  {
    id: 'escape-close',
    category: 'actions',
    keys: ['Esc'],
    title: 'Dialoge / Flyover schließen',
    description: 'Schließt geöffnete Modale, beendet den 3D-Flugmodus oder hebt eine aktive Gebietsauswahl auf der Karte auf.',
    badge: 'Global',
    icon: <X className="w-4 h-4 text-red-500" />
  }
];

interface KeyboardShortcutsModalProps {
  isOpen?: boolean;
  onClose: () => void;
  isDark?: boolean;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ isOpen = true, onClose, isDark = false }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'navigation' | 'analysis' | 'actions'>('all');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const filteredShortcuts = useMemo(() => {
    return SHORTCUTS_DATA.filter((item) => {
      const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
      if (!matchesCategory) return false;

      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase().trim();
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchDesc = item.description.toLowerCase().includes(q);
      const matchKey = item.keys.some(k => k.toLowerCase().includes(q));
      const matchBadge = item.badge?.toLowerCase().includes(q);

      return matchTitle || matchDesc || matchKey || matchBadge;
    });
  }, [searchQuery, selectedCategory]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[1200] flex items-center justify-center p-2 sm:p-4 md:p-6 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-slate-950/70 backdrop-blur-md animate-fade-in cursor-pointer"
      onClick={() => {
        triggerHaptic('light');
        onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[calc(100dvh-1rem)] sm:max-h-[90vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 flex flex-col overflow-hidden text-slate-800 dark:text-slate-100 cursor-default"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/60 dark:bg-slate-950/40 gap-2 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="p-2 sm:p-2.5 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Keyboard className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 id="shortcuts-modal-title" className="text-sm sm:text-lg font-black tracking-tight text-slate-900 dark:text-white truncate">
                  Tastaturkürzel &amp; Navigation
                </h2>
                <span className="hidden sm:inline-flex px-2 py-0.5 text-[10px] font-extrabold uppercase bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-800/50 rounded-full shrink-0">
                  Quick Access
                </span>
              </div>
              <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 truncate hidden sm:block">
                Steuern Sie GPX-Tracks, Kartenansicht und Analysetools blitzschnell per Tastatur
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              triggerHaptic('light');
              onClose();
            }}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            title="Schließen (Esc)"
            aria-label="Tastaturkürzel-Fenster schließen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Category Filter Bar */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800/80 bg-white dark:bg-slate-900 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Kürzel oder Funktion suchen (z.B. 'C', 'Zoom', '3D', 'Undo')..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {[
              { id: 'all', label: 'Alle Kürzel', count: SHORTCUTS_DATA.length },
              { id: 'navigation', label: 'Navigation & Karte', count: SHORTCUTS_DATA.filter(s => s.category === 'navigation').length },
              { id: 'analysis', label: '3D & Analysen', count: SHORTCUTS_DATA.filter(s => s.category === 'analysis').length },
              { id: 'actions', label: 'Aktionen & Verlauf', count: SHORTCUTS_DATA.filter(s => s.category === 'actions').length },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  triggerHaptic('light');
                  setSelectedCategory(tab.id as any);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
                  selectedCategory === tab.id
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/20'
                    : 'bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200/80 dark:hover:bg-slate-800'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-mono ${
                  selectedCategory === tab.id 
                    ? 'bg-indigo-700/70 text-indigo-100' 
                    : 'bg-slate-200/70 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Shortcuts List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5 divide-y divide-slate-100 dark:divide-slate-800/60">
          {filteredShortcuts.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                <Search className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-slate-600 dark:text-slate-400">
                Keine Tastaturkürzel für "{searchQuery}" gefunden
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                }}
                className="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
              >
                Suche zurücksetzen
              </button>
            </div>
          ) : (
            filteredShortcuts.map((item, idx) => (
              <div 
                key={item.id} 
                className={`pt-2.5 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl transition-all ${
                  idx % 2 === 0 ? 'bg-slate-50/40 dark:bg-slate-950/20' : 'bg-transparent'
                } hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 border border-transparent hover:border-indigo-100 dark:hover:border-indigo-900/30`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="p-2 rounded-xl bg-white dark:bg-slate-800 shadow-2xs border border-slate-100 dark:border-slate-700/60 shrink-0 mt-0.5">
                    {item.icon || <Keyboard className="w-4 h-4 text-indigo-500" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100">
                        {item.title}
                      </span>
                      {item.badge && (
                        <span className="text-[9.5px] font-extrabold uppercase px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-md border border-slate-200/50 dark:border-slate-700/50">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>

                {/* Keyboard Badges */}
                <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-center ml-11 sm:ml-0">
                  {item.keys.map((key, kIdx) => {
                    if (key === 'oder') {
                      return (
                        <span key={kIdx} className="text-[10px] text-slate-400 font-bold px-1">
                          oder
                        </span>
                      );
                    }
                    if (key === '+') {
                      return (
                        <span key={kIdx} className="text-slate-400 font-bold text-xs">
                          +
                        </span>
                      );
                    }
                    return (
                      <kbd
                        key={kIdx}
                        className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 bg-gradient-to-b from-white to-slate-100 dark:from-slate-800 dark:to-slate-850 text-slate-800 dark:text-slate-100 font-mono text-xs font-black rounded-lg border border-slate-300 dark:border-slate-700 shadow-2xs shadow-slate-200/60 dark:shadow-none select-none"
                      >
                        {key}
                      </kbd>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 sm:p-4 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-950/40 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
              Tipp: Drücken Sie jederzeit <kbd className="px-1.5 py-0.5 font-mono text-[10px] bg-slate-200 dark:bg-slate-800 rounded border border-slate-300 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-300">?</kbd> für diese Hilfe
            </span>
          </div>

          <button
            onClick={() => {
              triggerHaptic('light');
              onClose();
            }}
            className="px-5 py-2.5 min-h-[44px] bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold rounded-xl shadow-sm transition-all cursor-pointer flex items-center justify-center shrink-0"
          >
            Fertig
          </button>
        </div>
      </motion.div>
    </div>
  );
};
