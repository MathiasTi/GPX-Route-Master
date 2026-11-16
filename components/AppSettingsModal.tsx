import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  X,
  Palette,
  Languages,
  User,
  SlidersHorizontal,
  Sun,
  Moon,
  Monitor,
  Check,
  RotateCcw,
  Download,
  Heart,
  Zap,
  Sparkles,
  Map as MapIcon,
  Ruler,
  HardDrive,
  Database,
  Trash2,
  RefreshCw,
  Wifi,
  WifiOff,
  CheckCircle2
} from 'lucide-react';
import { GPXTrack, MapLayer } from '../types';
import { formatStorageSize as formatByteSize } from '../domain/offline/offlineCacheEngine';
import {
  getOfflineStatusSnapshot,
  purgeTileCache,
  OfflineStatusSnapshot
} from '../services/offlineCacheService';
import { GarminPersonalApiPanel } from './GarminPersonalApiPanel';
import {
  AppPreferences,
  AppLanguage,
  UiStyleId,
  UiDensity,
  UiRadius,
  ColorMode,
  UnitSystem,
  DefaultWorkspaceView,
  UI_STYLE_PRESETS,
  DEFAULT_APP_PREFERENCES,
  tr
} from '../utils/appSettings';

export type AppSettingsTab = 'style' | 'language' | 'athlete' | 'garmin' | 'workspace' | 'storage';

export interface AppSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: AppSettingsTab;
  preferences: AppPreferences;
  onUpdatePreferences: (partial: Partial<AppPreferences>) => void;
  onResetDefaults: () => void;
  ftp: number;
  onUpdateFtp: (val: number) => void;
  userWeight: number;
  onUpdateWeight: (val: number) => void;
  userAge: number;
  onUpdateAge: (val: number) => void;
  userMaxHr: number;
  onUpdateMaxHr: (val: number) => void;
  estimatedSpeed: number;
  onUpdateEstimatedSpeed: (val: number) => void;
  activeLayer: MapLayer;
  onSelectMapLayer: (layer: MapLayer) => void;
  tracks?: GPXTrack[];
  isOnline?: boolean;
  onGarminDataSynced?: () => void;
  onLoadGarminTrack?: (track: GPXTrack) => void;
}

export const AppSettingsModal: React.FC<AppSettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'style',
  preferences,
  onUpdatePreferences,
  onResetDefaults,
  ftp,
  onUpdateFtp,
  userWeight,
  onUpdateWeight,
  userAge,
  onUpdateAge,
  userMaxHr,
  onUpdateMaxHr,
  estimatedSpeed,
  onUpdateEstimatedSpeed,
  activeLayer,
  onSelectMapLayer,
  tracks = [],
  isOnline = true,
  onGarminDataSynced,
  onLoadGarminTrack
}) => {
  const [activeTab, setActiveTab] = useState<AppSettingsTab>(initialTab);
  const [storageSnapshot, setStorageSnapshot] = useState<OfflineStatusSnapshot | null>(null);
  const [isStorageLoading, setIsStorageLoading] = useState(false);
  const [isPurgingTiles, setIsPurgingTiles] = useState(false);
  const [tilePurgeMessage, setTilePurgeMessage] = useState<string | null>(null);
  const lang: AppLanguage = preferences.language;
  const t = (de: string, en: string) => tr(lang, de, en);

  const loadStorageSnapshot = async () => {
    setIsStorageLoading(true);
    const res = await getOfflineStatusSnapshot(tracks, isOnline);
    if (res.success) {
      setStorageSnapshot(res.data);
    }
    setIsStorageLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setTilePurgeMessage(null);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (isOpen && activeTab === 'storage') {
      void loadStorageSnapshot();
    }
  }, [isOpen, activeTab, tracks.length, isOnline]);

  if (!isOpen) return null;

  const tanakaMaxHr = Math.round(208 - 0.7 * userAge);
  const classicMaxHr = Math.max(120, Math.min(220, 220 - userAge));
  const wattsPerKg = (ftp / Math.max(1, userWeight)).toFixed(2);
  const systemWeight = (userWeight + preferences.bikeWeight).toFixed(1);

  const handlePurgeMapTiles = async () => {
    setIsPurgingTiles(true);
    setTilePurgeMessage(null);
    const res = await purgeTileCache();
    await loadStorageSnapshot();
    setIsPurgingTiles(false);
    if (res.success) {
      setTilePurgeMessage(
        t(
          'Karten-Cache erfolgreich geleert.',
          'Map tile cache cleared successfully.'
        )
      );
    } else {
      setTilePurgeMessage(
        t(
          'Fehler beim Leeren des Karten-Caches.',
          'Failed to clear map tile cache.'
        )
      );
    }
  };

  const handleExportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      preferences,
      athlete: {
        ftp,
        userWeight,
        userAge,
        userMaxHr,
        estimatedSpeed
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gpx-master-settings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const tabs: Array<{ id: AppSettingsTab; label: string; icon: React.ReactNode }> = [
    {
      id: 'style',
      label: t('Design & UI-Stile', 'UI Styles & Theme'),
      icon: <Palette size={15} />
    },
    {
      id: 'language',
      label: t('Sprache & Einheiten', 'Language & Units'),
      icon: <Languages size={15} />
    },
    {
      id: 'athlete',
      label: t('Athlet & Zonen', 'Athlete & Zones'),
      icon: <User size={15} />
    },
    {
      id: 'garmin',
      label: t('Garmin Sync', 'Garmin Sync'),
      icon: <Database size={15} />
    },
    {
      id: 'workspace',
      label: t('Karte & Bereich', 'Map & Workspace'),
      icon: <SlidersHorizontal size={15} />
    },
    {
      id: 'storage',
      label: t('Speicher & Cache', 'Storage & Cache'),
      icon: <HardDrive size={15} />
    }
  ];

  return (
    <div
      className="fixed inset-0 z-[1300] bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
      data-no-translate="true"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 w-full max-w-3xl max-h-[90vh] rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700/80 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
              <SlidersHorizontal size={18} />
            </div>
            <div>
              <h2 className="text-base font-black tracking-tight text-slate-900 dark:text-slate-100">
                {t('Einstellungen & Anpassung', 'Settings & Customization')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t(
                  'Sprache (DE/EN), UI-Stile, Farben, Maßeinheiten & Athleten-Parameter',
                  'Language (EN/DE), UI Styles, Colors, Units & Athlete Physiology'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Schließen', 'Close')}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 pt-3 pb-2 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap gap-1.5 bg-white dark:bg-slate-900 shrink-0">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                  active
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {activeTab === 'style' && (
            <>
              {/* 6 UI Style Presets */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-indigo-500" />
                    <span>{t('UI-Stil auswählen', 'Choose UI Style Preset')}</span>
                  </h3>
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {t('Sofortige Live-Vorschau', 'Instant live preview')}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {UI_STYLE_PRESETS.map((preset) => {
                    const selected = preferences.uiStyle === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => onUpdatePreferences({ uiStyle: preset.id as UiStyleId })}
                        className={`text-left p-3.5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between gap-2.5 ${
                          selected
                            ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40 shadow-sm'
                            : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/50 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black text-slate-900 dark:text-slate-100">
                                {lang === 'en' ? preset.nameEn : preset.nameDe}
                              </span>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                {lang === 'en' ? preset.badgeEn : preset.badgeDe}
                              </span>
                            </div>
                          </div>
                          {selected && (
                            <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                              <Check size={12} />
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                          {lang === 'en' ? preset.descEn : preset.descDe}
                        </p>

                        <div className="flex items-center gap-1.5 pt-1">
                          {preset.swatches.map((hex, i) => (
                            <span
                              key={i}
                              className="h-3.5 flex-1 rounded-md border border-black/10 dark:border-white/10"
                              style={{ backgroundColor: hex }}
                            />
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Color Mode + Density + Corner Radius */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                {/* Color Mode */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                    {t('Farbmodus', 'Color Mode')}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'light', label: t('Hell', 'Light'), icon: <Sun size={14} /> },
                        { id: 'dark', label: t('Dunkel', 'Dark'), icon: <Moon size={14} /> },
                        { id: 'system', label: t('Auto', 'System'), icon: <Monitor size={14} /> }
                      ] as Array<{ id: ColorMode; label: string; icon: React.ReactNode }>
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onUpdatePreferences({ colorMode: m.id })}
                        className={`flex flex-col items-center justify-center gap-1 py-2 px-2 rounded-xl border text-[11px] font-bold cursor-pointer transition-all ${
                          preferences.colorMode === m.id
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {m.icon}
                        <span>{m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Density */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                    {t('UI-Dichte', 'UI Density')}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'compact', label: t('Kompakt', 'Compact') },
                        { id: 'comfortable', label: t('Standard', 'Normal') },
                        { id: 'spacious', label: t('Groß', 'Spacious') }
                      ] as Array<{ id: UiDensity; label: string }>
                    ).map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => onUpdatePreferences({ uiDensity: d.id })}
                        className={`py-2.5 px-2 rounded-xl border text-[11px] font-bold cursor-pointer transition-all ${
                          preferences.uiDensity === d.id
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Radius */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                    {t('Ecken-Stil', 'Corner Style')}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'sharp', label: t('Kantig', 'Sharp') },
                        { id: 'rounded', label: t('Ausgew.', 'Rounded') },
                        { id: 'pill', label: t('Weich', 'Soft Pill') }
                      ] as Array<{ id: UiRadius; label: string }>
                    ).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => onUpdatePreferences({ uiRadius: r.id })}
                        className={`py-2.5 px-2 rounded-xl border text-[11px] font-bold cursor-pointer transition-all ${
                          preferences.uiRadius === r.id
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Animations Toggle */}
              <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
                <div>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 block">
                    {t('Sanfte Übergänge & Animationen', 'Smooth Transitions & Animations')}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t(
                      'Deaktivieren für maximale Reaktionsgeschwindigkeit ohne Bewegungseffekte',
                      'Disable for instant snaps and reduced motion'
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onUpdatePreferences({ enableAnimations: !preferences.enableAnimations })}
                  className={`w-12 h-6.5 rounded-full transition-colors p-0.5 cursor-pointer ${
                    preferences.enableAnimations ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                >
                  <span
                    className={`block w-5.5 h-5.5 rounded-full bg-white shadow transition-transform ${
                      preferences.enableAnimations ? 'translate-x-5.5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </>
          )}

          {activeTab === 'language' && (
            <>
              {/* Language Picker */}
              <div className="space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <Languages size={14} className="text-indigo-500" />
                  <span>{t('Oberflächen-Sprache', 'Interface Language')}</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => onUpdatePreferences({ language: 'de' })}
                    className={`text-left p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      preferences.language === 'de'
                        ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">🇩🇪</span>
                      <div>
                        <span className="text-sm font-black text-slate-900 dark:text-slate-100 block">
                          Deutsch
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Original-Oberfläche (DE)
                        </span>
                      </div>
                    </div>
                    {preferences.language === 'de' && (
                      <span className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                        <Check size={14} />
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => onUpdatePreferences({ language: 'en' })}
                    className={`text-left p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      preferences.language === 'en'
                        ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">🇬🇧</span>
                      <div>
                        <span className="text-sm font-black text-slate-900 dark:text-slate-100 block">
                          English
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Full English Workspace &amp; Telemetry UI (EN)
                        </span>
                      </div>
                    </div>
                    {preferences.language === 'en' && (
                      <span className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                        <Check size={14} />
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Measurement Units */}
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <Ruler size={14} className="text-indigo-500" />
                  <span>{t('Maßeinheiten', 'Measurement Units')}</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(
                    [
                      {
                        id: 'metric',
                        title: t('Metrisch (SI)', 'Metric (SI)'),
                        sub: 'km · hm (m) · km/h · kg · °C'
                      },
                      {
                        id: 'imperial',
                        title: t('Imperial (US/UK)', 'Imperial (US/UK)'),
                        sub: 'mi · ft · mph · lbs · °F'
                      }
                    ] as Array<{ id: UnitSystem; title: string; sub: string }>
                  ).map((u) => {
                    const selected = preferences.unitSystem === u.id;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => onUpdatePreferences({ unitSystem: u.id })}
                        className={`text-left p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                          selected
                            ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:border-slate-300'
                        }`}
                      >
                        <div>
                          <span className="text-sm font-black text-slate-900 dark:text-slate-100 block">
                            {u.title}
                          </span>
                          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            {u.sub}
                          </span>
                        </div>
                        {selected && (
                          <span className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                            <Check size={14} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {activeTab === 'athlete' && (
            <div className="space-y-4">
              {/* Live Summary Strip */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-50 to-indigo-50 dark:from-amber-950/30 dark:to-indigo-950/30 border border-amber-200/70 dark:border-amber-800/50 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center">
                    <Zap size={18} />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                      {t('Relativleistung & Systemgewicht', 'Power-to-Weight & Total System Mass')}
                    </span>
                    <span className="text-sm font-black font-mono text-slate-900 dark:text-slate-100">
                      {wattsPerKg} W/kg · {systemWeight} kg {t('Gesamtmasse', 'total')}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                  HF-Reserve: {Math.max(40, userMaxHr - preferences.rhrBaseline)} bpm
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('FTP-Schwelle (Watt)', 'FTP Threshold (Watts)')}
                  </span>
                  <input
                    type="number"
                    min={50}
                    max={600}
                    value={ftp}
                    onChange={(e) => onUpdateFtp(Math.max(50, Math.min(600, parseInt(e.target.value, 10) || 250)))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-sm font-bold text-amber-600 dark:text-amber-400"
                  />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('Körpergewicht (kg)', 'Body Weight (kg)')}
                  </span>
                  <input
                    type="number"
                    min={30}
                    max={200}
                    step={0.5}
                    value={userWeight}
                    onChange={(e) =>
                      onUpdateWeight(Math.max(30, Math.min(200, parseFloat(e.target.value) || 75)))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-sm font-bold text-slate-900 dark:text-slate-100"
                  />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('Rad & Gepäck (kg)', 'Bike & Gear Weight (kg)')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={40}
                    step={0.5}
                    value={preferences.bikeWeight}
                    onChange={(e) =>
                      onUpdatePreferences({
                        bikeWeight: Math.max(0, Math.min(40, parseFloat(e.target.value) || 0))
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-sm font-bold text-slate-900 dark:text-slate-100"
                  />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('Alter (Jahre)', 'Age (Years)')}
                  </span>
                  <input
                    type="number"
                    min={10}
                    max={100}
                    value={userAge}
                    onChange={(e) =>
                      onUpdateAge(Math.max(10, Math.min(100, parseInt(e.target.value, 10) || 35)))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-sm font-bold text-slate-900 dark:text-slate-100"
                  />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Heart size={12} className="text-rose-500" />
                    <span>{t('Max. Herzfrequenz (bpm)', 'Max Heart Rate (bpm)')}</span>
                  </span>
                  <input
                    type="number"
                    min={100}
                    max={230}
                    value={userMaxHr}
                    onChange={(e) =>
                      onUpdateMaxHr(Math.max(100, Math.min(230, parseInt(e.target.value, 10) || 185)))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-sm font-bold text-rose-600 dark:text-rose-400"
                  />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('Basis-Ruhepuls (bpm)', 'Resting HR Baseline (bpm)')}
                  </span>
                  <input
                    type="number"
                    min={30}
                    max={110}
                    value={preferences.rhrBaseline}
                    onChange={(e) =>
                      onUpdatePreferences({
                        rhrBaseline: Math.max(30, Math.min(110, parseInt(e.target.value, 10) || 55))
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-sm font-bold text-slate-900 dark:text-slate-100"
                  />
                </label>

                <label className="space-y-1.5 block sm:col-span-2 lg:col-span-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('Standard-Planungstempo (km/h)', 'Default Touring Speed (km/h)')}
                  </span>
                  <input
                    type="number"
                    min={5}
                    max={45}
                    step={0.5}
                    value={estimatedSpeed}
                    onChange={(e) =>
                      onUpdateEstimatedSpeed(
                        Math.max(5, Math.min(45, parseFloat(e.target.value) || 15))
                      )
                    }
                    className="w-full sm:w-56 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-sm font-bold text-slate-900 dark:text-slate-100"
                  />
                </label>
              </div>

              {/* 1-Click Max HR Helpers */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-medium">
                  {t('Schnellberechnung HFmax:', 'Quick Max HR formula:')}
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateMaxHr(classicMaxHr)}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-semibold cursor-pointer"
                >
                  220 − {userAge} = {classicMaxHr} bpm
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateMaxHr(tanakaMaxHr)}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-semibold cursor-pointer"
                >
                  Tanaka (208 − 0.7×{userAge}) = {tanakaMaxHr} bpm
                </button>
              </div>
            </div>
          )}

          {activeTab === 'garmin' && (
            <div className="space-y-4">
              <GarminPersonalApiPanel
                onDataSynced={onGarminDataSynced}
                onLoadTrack={(tr) => {
                  onLoadGarminTrack?.(tr);
                  onClose();
                }}
                onCloseModal={onClose}
              />
            </div>
          )}

          {activeTab === 'workspace' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Default Start View */}
                <label className="space-y-1.5 block">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <MapIcon size={14} className="text-indigo-500" />
                    <span>{t('Standard-Startseite', 'Default Start Page')}</span>
                  </span>
                  <select
                    value={preferences.defaultView}
                    onChange={(e) =>
                      onUpdatePreferences({ defaultView: e.target.value as DefaultWorkspaceView })
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-slate-100"
                  >
                    <option value="map">{t('Karte & Workspace', 'Map & Workspace')}</option>
                    <option value="planned">{t('Geplante Touren', 'Planned Tours')}</option>
                    <option value="activities">{t('Aktivitäten-Archiv', 'Activities Archive')}</option>
                    <option value="dashboard">{t('Aktivitäten-Dashboard', 'Activities Dashboard')}</option>
                    <option value="fitness">{t('Fitness & Gesundheit', 'Fitness & Health')}</option>
                  </select>
                </label>

                {/* Default Map Layer */}
                <label className="space-y-1.5 block">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                    {t('Kartenebene (Standard & Aktiv)', 'Map Layer (Default & Active)')}
                  </span>
                  <select
                    value={activeLayer}
                    onChange={(e) => {
                      const nextLayer = e.target.value as MapLayer;
                      onSelectMapLayer(nextLayer);
                      onUpdatePreferences({ defaultMapLayer: nextLayer });
                    }}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-slate-100"
                  >
                    {Object.values(MapLayer).map((layer) => (
                      <option key={layer} value={layer}>
                        {layer}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Workspace Behavior Toggles */}
              <div className="space-y-2.5 pt-1">
                {(
                  [
                    {
                      key: 'autoFitOnLoad',
                      title: t('Tracks beim Laden auf Karte einpassen', 'Auto-Fit Tracks on Map Load'),
                      desc: t(
                        'Zoomt beim Öffnen oder Laden von Touren automatisch auf den Streckenbereich.',
                        'Automatically zooms map bounds when tracks are loaded.'
                      )
                    },
                    {
                      key: 'showElevationProfile',
                      title: t('Höhenprofil standardmäßig einblenden', 'Show Elevation Profile by Default'),
                      desc: t(
                        'Zeigt das interaktive Höhen- und Steigungsprofil beim Start der Kartenansicht.',
                        'Display the interactive elevation and gradient panel when opening Map View.'
                      )
                    },
                    {
                      key: 'autoSurfaceAnalysis',
                      title: t('Automatische OSM-Belagsanalyse', 'Automatic OSM Surface Analysis'),
                      desc: t(
                        'Gleicht neu importierte Touren automatisch mit OpenStreetMap-Wegtypen ab.',
                        'Automatically match newly imported tracks against OpenStreetMap surfaces.'
                      )
                    },
                    {
                      key: 'enableHaptics',
                      title: t('Haptisches Feedback (Mobilgeräte)', 'Haptic Feedback (Mobile)'),
                      desc: t(
                        'Subtile Vibrationen bei Kartenaktionen und Werkzeugwechseln.',
                        'Subtle vibration tactile feedback on supported mobile browsers.'
                      )
                    }
                  ] as const
                ).map((item) => {
                  const enabled = preferences[item.key];
                  return (
                    <div
                      key={item.key}
                      className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700"
                    >
                      <div className="pr-3">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-100 block">
                          {item.title}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {item.desc}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onUpdatePreferences({ [item.key]: !enabled })}
                        className={`w-12 h-6.5 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                          enabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'
                        }`}
                      >
                        <span
                          className={`block w-5.5 h-5.5 rounded-full bg-white shadow transition-transform ${
                            enabled ? 'translate-x-5.5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'storage' && (
            <div className="space-y-4">
              {/* Connection & Quick Refresh Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      isOnline ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      {isOnline ? (
                        <>
                          <Wifi size={14} className="text-emerald-600 dark:text-emerald-400" />
                          <span>{t('Netzwerk verbunden (Online)', 'Network Connected (Online)')}</span>
                        </>
                      ) : (
                        <>
                          <WifiOff size={14} className="text-amber-600 dark:text-amber-400" />
                          <span>{t('Offline-Modus aktiv', 'Offline Mode Active')}</span>
                        </>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t(
                        'Kartenkacheln werden lokal in Browser-IndexedDB mit automatischer LRU-Begrenzung gespeichert.',
                        'Visited map tiles are cached locally in browser IndexedDB with automatic LRU quota enforcement.'
                      )}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void loadStorageSnapshot()}
                  disabled={isStorageLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <RefreshCw size={13} className={isStorageLoading ? 'animate-spin text-indigo-500' : ''} />
                  <span>{t('Aktualisieren', 'Refresh')}</span>
                </button>
              </div>

              {/* IndexedDB Map Tile Cache Card */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/80 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                      <MapIcon size={14} className="text-indigo-500" />
                      <span>{t('Karten-Kachel-Cache (IndexedDB)', 'Map Tile Cache (IndexedDB)')}</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {t(
                        'Ermöglicht sofortiges Karten-Panning und Offline-Nutzung bereits besuchter Kartenausschnitte.',
                        'Enables instant panning and offline viewing for previously visited map regions.'
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    id="btn-settings-clear-tile-cache"
                    onClick={() => void handlePurgeMapTiles()}
                    disabled={isPurgingTiles || (storageSnapshot?.tileCount ?? 0) === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/70 text-xs font-bold transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                  >
                    <Trash2 size={13} />
                    <span>
                      {isPurgingTiles
                        ? t('Leere Cache...', 'Clearing...')
                        : t('Karten-Cache leeren', 'Clear Map Cache')}
                    </span>
                  </button>
                </div>

                {tilePurgeMessage && (
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                    <CheckCircle2 size={14} className="shrink-0" />
                    <span>{tilePurgeMessage}</span>
                  </div>
                )}

                {(() => {
                  const count = storageSnapshot?.tileCount ?? 0;
                  const bytes = storageSnapshot?.tileCacheBytes ?? 0;
                  const maxBytes = storageSnapshot?.maxTileCacheBytes ?? 150 * 1024 * 1024;
                  const pct = Math.min(100, Math.round((bytes / Math.max(1, maxBytes)) * 100));
                  const layersList = Object.entries(storageSnapshot?.tileLayers || {});

                  return (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/70">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            {t('Gespeicherte Kacheln', 'Cached Tiles')}
                          </span>
                          <span className="text-lg font-black font-mono tabular-nums text-slate-900 dark:text-slate-100">
                            {count.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')}
                          </span>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/70">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            {t('Cache-Größe', 'Cache Size')}
                          </span>
                          <span className="text-lg font-black font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
                            {formatByteSize(bytes)}
                          </span>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/70">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            {t('Quota-Limit (LRU)', 'Quota Cap (LRU)')}
                          </span>
                          <span className="text-lg font-black font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {formatByteSize(maxBytes)}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          <span>{t('Auslastung Kachel-Limit', 'Tile Quota Usage')}</span>
                          <span className="font-bold">{pct}%</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              pct >= 90 ? 'bg-amber-500' : 'bg-indigo-600'
                            }`}
                            style={{ width: `${bytes > 0 ? Math.max(2, pct) : 0}%` }}
                          />
                        </div>
                      </div>

                      {layersList.length > 0 && (
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            {t('Nach Kartenebene', 'By Map Layer')}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {layersList.map(([layerName, stats]) => (
                              <div
                                key={layerName}
                                className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 text-[11px]"
                              >
                                <span className="font-semibold text-slate-700 dark:text-slate-200 truncate pr-2">
                                  {layerName}
                                </span>
                                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                                  {stats.count} · {formatByteSize(stats.bytes)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Workspace & Browser Storage Quota */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <Database size={14} className="text-emerald-500" />
                  <span>{t('Browser- & Workspace-Speicher', 'Browser & Workspace Storage')}</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/70">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      {t('Geöffnete Strecken', 'Open Tracks')}
                    </span>
                    <span className="text-base font-black font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {storageSnapshot?.trackCount ?? tracks.length}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/70">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      {t('Trackpunkte gesamt', 'Total Trackpoints')}
                    </span>
                    <span className="text-base font-black font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {(storageSnapshot?.totalPoints ?? 0).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/70">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      {t('Workspace Payload', 'Workspace Payload')}
                    </span>
                    <span className="text-base font-black font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {formatByteSize(storageSnapshot?.tracksPayloadBytes ?? 0)}
                    </span>
                  </div>
                </div>

                {storageSnapshot && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      <span>{t('Browser Origin Speicherbelegung', 'Browser Origin Storage Usage')}</span>
                      <span className="font-bold">
                        {formatByteSize(storageSnapshot.quota.usageBytes)} / {formatByteSize(storageSnapshot.quota.quotaBytes)} ({storageSnapshot.quota.usagePercentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{
                          width: `${
                            storageSnapshot.quota.usageBytes > 0
                              ? Math.max(2, Math.min(100, storageSnapshot.quota.usagePercentage))
                              : 0
                          }%`
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/95 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onResetDefaults}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              title={`${t('Zurücksetzen auf', 'Reset to')} ${DEFAULT_APP_PREFERENCES.uiStyle}`}
            >
              <RotateCcw size={13} />
              <span>{t('Standardwerte', 'Reset Defaults')}</span>
            </button>
            <button
              type="button"
              onClick={handleExportJson}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              <Download size={13} />
              <span>{t('Export JSON', 'Export JSON')}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
          >
            {t('Fertig', 'Done')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default AppSettingsModal;
