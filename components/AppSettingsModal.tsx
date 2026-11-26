import React, { useState, useEffect, useRef } from 'react';
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
  Upload,
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
  CheckCircle2,
  AlertCircle,
  Layers,
  Clock
} from 'lucide-react';
import { GPXTrack, MapLayer } from '../types';
import { formatStorageSize as formatByteSize } from '../domain/offline/offlineCacheEngine';
import {
  getOfflineStatusSnapshot,
  purgeTileCache,
  OfflineStatusSnapshot
} from '../services/offlineCacheService';
import { enforceTileCacheQuota } from '../utils/tileCacheDb';
import { apiFetch, getApiUrl } from '../utils/api';
import { garminFetch } from '../utils/garminSessionKey';
import {
  calculateFtpFromFieldTest,
  FtpFieldTestType,
  FtpEstimationReport
} from '../utils/ftpEstimator';
import { GarminPersonalApiPanel } from './GarminPersonalApiPanel';
import { FreeMetricInput } from './FreeMetricInput';
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
  ImportedSettingsPayload,
  parseImportedSettingsJson,
  tr
} from '../utils/appSettings';
import { formatWeight, formatSpeed } from '../utils/units';

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
  onImportSettings?: (payload: ImportedSettingsPayload) => void;
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
  onLoadGarminTrack,
  onImportSettings
}) => {
  const [activeTab, setActiveTab] = useState<AppSettingsTab>(initialTab);
  const [storageSnapshot, setStorageSnapshot] = useState<OfflineStatusSnapshot | null>(null);
  const [isStorageLoading, setIsStorageLoading] = useState(false);
  const [isPurgingTiles, setIsPurgingTiles] = useState(false);
  const [isPruningTiles, setIsPruningTiles] = useState(false);
  const [tilePurgeMessage, setTilePurgeMessage] = useState<string | null>(null);
  const [surfaceStats, setSurfaceStats] = useState<{
    enabled: boolean;
    ttlDays: number;
    maxEntries: number;
    entryCount: number;
    payloadBytes: number;
    oldestCreatedAt: number | null;
    newestCreatedAt: number | null;
  } | null>(null);
  const [isSavingSurfaceCache, setIsSavingSurfaceCache] = useState(false);
  const [isPurgingSurfaceCache, setIsPurgingSurfaceCache] = useState(false);
  const [surfaceCacheMessage, setSurfaceCacheMessage] = useState<string | null>(null);
  const lang: AppLanguage = preferences.language;
  const t = (de: string, en: string) => tr(lang, de, en);

  const loadStorageSnapshot = async () => {
    setIsStorageLoading(true);
    const [res, surfaceRes] = await Promise.all([
      getOfflineStatusSnapshot(tracks, isOnline),
      apiFetch(getApiUrl('/api/cache/surface'))
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    ]);
    if (res.success) {
      setStorageSnapshot(res.data);
    }
    if (surfaceRes?.success && surfaceRes.stats) {
      setSurfaceStats(surfaceRes.stats);
      if (
        surfaceRes.stats.enabled !== preferences.surfaceCacheEnabled ||
        surfaceRes.stats.ttlDays !== preferences.surfaceCacheTtlDays ||
        surfaceRes.stats.maxEntries !== preferences.surfaceCacheMaxEntries
      ) {
        onUpdatePreferences({
          surfaceCacheEnabled: Boolean(surfaceRes.stats.enabled),
          surfaceCacheTtlDays: Number(surfaceRes.stats.ttlDays),
          surfaceCacheMaxEntries: Number(surfaceRes.stats.maxEntries)
        });
      }
    }
    setIsStorageLoading(false);
  };

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isFetchingGarminAthlete, setIsFetchingGarminAthlete] = useState(false);
  const [garminAthleteFeedback, setGarminAthleteFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    summary: string;
    details: Array<{ label: string; value: string; source: string }>;
    needsGarminConnect?: boolean;
  } | null>(null);
  const [isCalculatingFtp, setIsCalculatingFtp] = useState(false);
  const [ftpEstimateReport, setFtpEstimateReport] = useState<FtpEstimationReport | null>(null);
  const [ftpEstimateError, setFtpEstimateError] = useState<string | null>(null);
  const [fieldTestType, setFieldTestType] = useState<FtpFieldTestType>('20min');
  const [fieldTestWatts, setFieldTestWatts] = useState<number>(Math.round(ftp / 0.95));

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setTilePurgeMessage(null);
      setSurfaceCacheMessage(null);
      setImportError(null);
      setGarminAthleteFeedback(null);
      setFtpEstimateError(null);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (isOpen && activeTab === 'storage') {
      void loadStorageSnapshot();
    }
  }, [isOpen, activeTab, tracks.length, isOnline]);

  if (!isOpen) return null;

  const tanakaMaxHr = Math.max(1, Math.round(208 - 0.7 * userAge));
  const classicMaxHr = Math.max(1, Math.round(220 - userAge));
  const wattsPerKg = (ftp / Math.max(0.1, userWeight)).toFixed(2);
  const systemWeightNum = userWeight + preferences.bikeWeight;
  const systemWeight = systemWeightNum.toFixed(1);

  const handleFetchGarminAthleteProfile = async () => {
    setIsFetchingGarminAthlete(true);
    setGarminAthleteFeedback(null);
    try {
      const res = await garminFetch(getApiUrl('/api/garmin/personal/athlete-profile'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeLocalFallback: true })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setGarminAthleteFeedback({
          type: 'error',
          summary: data?.error || t('Athletenwerte konnten nicht aus Garmin geladen werden.', 'Failed to load athlete metrics from Garmin.'),
          details: [],
          needsGarminConnect: true
        });
        return;
      }

      const profile = data.profile || {};
      const sources = data.sources || {};
      const details: Array<{ label: string; value: string; source: string }> = [];

      if (typeof profile.ftp === 'number' && Number.isFinite(profile.ftp)) {
        onUpdateFtp(profile.ftp);
        details.push({
          label: 'FTP',
          value: `${profile.ftp} W`,
          source: sources.ftp?.detail || 'Garmin'
        });
      }
      if (typeof profile.userWeight === 'number' && Number.isFinite(profile.userWeight)) {
        onUpdateWeight(profile.userWeight);
        details.push({
          label: t('Gewicht', 'Weight'),
          value: `${profile.userWeight} kg`,
          source: sources.userWeight?.detail || 'Garmin'
        });
      }
      if (typeof profile.userAge === 'number' && Number.isFinite(profile.userAge)) {
        onUpdateAge(profile.userAge);
        details.push({
          label: t('Alter', 'Age'),
          value: `${profile.userAge}`,
          source: sources.userAge?.detail || 'Garmin'
        });
      }
      if (typeof profile.userMaxHr === 'number' && Number.isFinite(profile.userMaxHr)) {
        onUpdateMaxHr(profile.userMaxHr);
        details.push({
          label: 'HF max',
          value: `${profile.userMaxHr} bpm`,
          source: sources.userMaxHr?.detail || 'Garmin'
        });
      }
      if (typeof profile.rhrBaseline === 'number' && Number.isFinite(profile.rhrBaseline)) {
        onUpdatePreferences({ rhrBaseline: profile.rhrBaseline });
        details.push({
          label: t('Ruhepuls', 'Resting HR'),
          value: `${profile.rhrBaseline} bpm`,
          source: sources.rhrBaseline?.detail || 'Garmin'
        });
      }
      if (typeof profile.estimatedSpeed === 'number' && Number.isFinite(profile.estimatedSpeed)) {
        onUpdateEstimatedSpeed(profile.estimatedSpeed);
        details.push({
          label: t('Ø Rad-Tempo', 'Avg Cycling Speed'),
          value: `${profile.estimatedSpeed} km/h`,
          source: sources.estimatedSpeed?.detail || 'Garmin'
        });
      }

      if (details.length > 0) {
        const cloudNote = !data.cloudConnected
          ? t(
              ' (aus synchronisierter Garmin-DB; für Live-Cloud-Werte Garmin Personal API verbinden)',
              ' (from synced Garmin DB; connect Garmin Personal API for live cloud profile fields)'
            )
          : '';
        setGarminAthleteFeedback({
          type: data.cloudConnected ? 'success' : 'warning',
          summary: `${details.length} ${t('Athletenwerte aus Garmin übernommen', 'athlete metrics loaded from Garmin')}${cloudNote}.`,
          details,
          needsGarminConnect: !data.cloudConnected
        });
      } else {
        setGarminAthleteFeedback({
          type: 'warning',
          summary: data.cloudConnected
            ? t(
                'Garmin Cloud verbunden, aber keine Athleten-Stammdaten (FTP/Gewicht/Alter/HF) gefunden.',
                'Garmin Cloud connected, but no athlete profile metrics (FTP/weight/age/HR) were returned.'
              )
            : t(
                'Keine Garmin-Verbindung aktiv und noch keine synchronisierten Garmin-Daten vorhanden.',
                'No active Garmin connection and no synced Garmin health/activity data available yet.'
              ),
          details: [],
          needsGarminConnect: !data.cloudConnected
        });
      }
    } catch {
      setGarminAthleteFeedback({
        type: 'error',
        summary: t('Verbindungsfehler beim Laden der Garmin-Athletenwerte.', 'Network error while fetching Garmin athlete metrics.'),
        details: []
      });
    } finally {
      setIsFetchingGarminAthlete(false);
    }
  };

  const handleCalculateFtpFromActivities = async () => {
    setIsCalculatingFtp(true);
    setFtpEstimateError(null);
    try {
      const res = await apiFetch(getApiUrl('/api/athlete/estimate-ftp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userWeight,
          bikeWeight: preferences.bikeWeight,
          lookbackDays: 90
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setFtpEstimateError(data?.error || t('FTP-Berechnung fehlgeschlagen.', 'FTP calculation failed.'));
        return;
      }
      setFtpEstimateReport(data as FtpEstimationReport);
    } catch {
      setFtpEstimateError(t('Verbindungsfehler bei der FTP-Berechnung.', 'Network error during FTP calculation.'));
    } finally {
      setIsCalculatingFtp(false);
    }
  };

  const fieldTestPreview = calculateFtpFromFieldTest(fieldTestType, fieldTestWatts, userWeight);

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError(null);
    try {
      const text = await file.text();
      const payload = parseImportedSettingsJson(text);
      if (onImportSettings) {
        onImportSettings(payload);
      } else {
        onUpdatePreferences(payload.preferences);
      }
    } catch (err: any) {
      setImportError(err?.message || t('Fehler beim Importieren der JSON-Datei.', 'Failed to import settings JSON file.'));
    }
  };

  const handleApplyTileCacheLimits = async (nextMb: number, nextCount: number) => {
    setIsPruningTiles(true);
    setTilePurgeMessage(null);
    try {
      const evicted = await enforceTileCacheQuota(
        Math.max(25, nextMb) * 1024 * 1024,
        Math.max(250, nextCount)
      );
      await loadStorageSnapshot();
      if (evicted > 0) {
        setTilePurgeMessage(
          t(
            `${evicted} ältere Kacheln gemäß neuem Limit bereinigt.`,
            `Trimmed ${evicted} older tiles to match updated quota.`
          )
        );
      }
    } finally {
      setIsPruningTiles(false);
    }
  };

  const handleUpdateSurfaceCacheConfig = async (
    partial: Partial<{ enabled: boolean; ttlDays: number; maxEntries: number }>
  ) => {
    setIsSavingSurfaceCache(true);
    setSurfaceCacheMessage(null);
    onUpdatePreferences({
      ...(partial.enabled !== undefined ? { surfaceCacheEnabled: partial.enabled } : {}),
      ...(partial.ttlDays !== undefined ? { surfaceCacheTtlDays: partial.ttlDays } : {}),
      ...(partial.maxEntries !== undefined ? { surfaceCacheMaxEntries: partial.maxEntries } : {})
    });
    try {
      const res = await apiFetch(getApiUrl('/api/cache/surface/config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial)
      });
      const data = await res.json();
      if (data?.success && data.stats) {
        setSurfaceStats(data.stats);
      }
    } catch {
      setSurfaceCacheMessage(
        t('Cache-Regeln lokal gemerkt (Server nicht erreichbar).', 'Saved locally (server unreachable).')
      );
    } finally {
      setIsSavingSurfaceCache(false);
    }
  };

  const handlePurgeSurfaceCache = async () => {
    setIsPurgingSurfaceCache(true);
    setSurfaceCacheMessage(null);
    try {
      const res = await apiFetch(getApiUrl('/api/cache/surface'), {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data?.success) {
        if (data.stats) setSurfaceStats(data.stats);
        setSurfaceCacheMessage(
          t(
            `Oberflächen-Cache geleert (${data.deletedCount ?? 0} Einträge entfernt).`,
            `Surface cache cleared (${data.deletedCount ?? 0} entries removed).`
          )
        );
      } else {
        setSurfaceCacheMessage(
          t('Fehler beim Leeren des Oberflächen-Caches.', 'Failed to clear surface cache.')
        );
      }
    } catch {
      setSurfaceCacheMessage(
        t('Verbindungsfehler beim Leeren des Oberflächen-Caches.', 'Network error clearing surface cache.')
      );
    } finally {
      setIsPurgingSurfaceCache(false);
    }
  };

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
                      {wattsPerKg} W/kg · {systemWeight} kg {preferences.unitSystem === 'imperial' ? `(${formatWeight(systemWeightNum, 'imperial', 1)})` : ''} {t('Gesamtmasse', 'total')}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-mono tabular-nums font-bold px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                  HF-Reserve: {Math.max(0, Math.round(userMaxHr - preferences.rhrBaseline))} bpm
                </span>
              </div>

              {/* Download Athlete Values from Garmin */}
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                      {t('Athletenwerte aus Garmin herunterladen', 'Download Athlete Values from Garmin')}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t(
                        'Lädt FTP, Körpergewicht, Alter, HF max, Ruhepuls und Rad-Tempo direkt aus deinem Garmin-Profil oder synchronisierten Garmin-Daten.',
                        'Fetches FTP, weight, age, max HR, resting HR, and cycling speed from your Garmin profile or synced Garmin data.'
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    id="btn-fetch-garmin-athlete"
                    onClick={handleFetchGarminAthleteProfile}
                    disabled={isFetchingGarminAthlete}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold transition-colors cursor-pointer shrink-0 shadow-sm"
                  >
                    {isFetchingGarminAthlete ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    <span>
                      {isFetchingGarminAthlete
                        ? t('Lade Garmin-Daten…', 'Loading from Garmin…')
                        : t('Aus Garmin laden', 'Load from Garmin')}
                    </span>
                  </button>
                </div>

                {garminAthleteFeedback && (
                  <div
                    className={`p-2.5 rounded-xl border text-[11px] space-y-1.5 ${
                      garminAthleteFeedback.type === 'success'
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-200'
                        : garminAthleteFeedback.type === 'warning'
                        ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200'
                        : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-semibold">
                        {garminAthleteFeedback.type === 'success' ? (
                          <CheckCircle2 size={14} className="shrink-0" />
                        ) : (
                          <AlertCircle size={14} className="shrink-0" />
                        )}
                        <span>{garminAthleteFeedback.summary}</span>
                      </span>
                      {garminAthleteFeedback.needsGarminConnect && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('garmin')}
                          className="px-2 py-0.5 rounded-md bg-white/90 dark:bg-slate-900 border border-current/30 font-bold text-[10px] hover:opacity-90 cursor-pointer shrink-0"
                        >
                          {t('Garmin verbinden', 'Connect Garmin')}
                        </button>
                      )}
                    </div>
                    {garminAthleteFeedback.details.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {garminAthleteFeedback.details.map((d) => (
                          <span
                            key={d.label}
                            title={d.source}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/80 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-700 font-mono text-[10px]"
                          >
                            <span className="font-bold">{d.label}:</span>
                            <span>{d.value}</span>
                            <span className="text-slate-400">({d.source})</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Multi-Method FTP Calculator */}
              <div className="p-3.5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-800/50 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                      <Zap size={13} className="text-amber-500" />
                      <span>{t('FTP berechnen (Powermeter, Critical Power & Steigungs-Physik)', 'Calculate FTP (Power Meter, Critical Power & Climbing Physics)')}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t(
                        'Analysiert 60-Min / 20-Min / 8-Min-Leistungspeaks, Critical Power oder lange Bergfahrten aus deinen synchronisierten Aktivitäten.',
                        'Analyzes 60-min / 20-min / 8-min power peaks, Critical Power, or sustained climbs from your synced activities.'
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    id="btn-calculate-ftp-activities"
                    onClick={handleCalculateFtpFromActivities}
                    disabled={isCalculatingFtp}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 text-xs font-bold transition-colors cursor-pointer shrink-0 shadow-sm"
                  >
                    {isCalculatingFtp ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Zap size={14} />
                    )}
                    <span>
                      {isCalculatingFtp
                        ? t('Berechne FTP…', 'Calculating FTP…')
                        : t('Aus Aktivitäten berechnen', 'Calculate from Activities')}
                    </span>
                  </button>
                </div>

                {ftpEstimateError && (
                  <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-[11px] text-rose-700 dark:text-rose-300 font-semibold">
                    {ftpEstimateError}
                  </div>
                )}

                {ftpEstimateReport && (
                  <div className="p-2.5 rounded-xl bg-white/90 dark:bg-slate-900/80 border border-amber-200/70 dark:border-amber-800/50 space-y-2 text-[11px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-800 dark:text-slate-100">
                          {ftpEstimateReport.summary}
                        </span>
                        {ftpEstimateReport.confidence !== 'none' && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                              ftpEstimateReport.confidence === 'high'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : ftpEstimateReport.confidence === 'medium'
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {ftpEstimateReport.confidence}
                          </span>
                        )}
                      </div>
                      {ftpEstimateReport.recommendedFtp !== null && (
                        <button
                          type="button"
                          onClick={() => onUpdateFtp(ftpEstimateReport.recommendedFtp!)}
                          className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-[11px] cursor-pointer shrink-0"
                        >
                          {t('FTP übernehmen', 'Apply FTP')} ({ftpEstimateReport.recommendedFtp} W)
                        </button>
                      )}
                    </div>

                    {ftpEstimateReport.candidates.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {ftpEstimateReport.candidates.map((cand) => (
                          <button
                            key={cand.method}
                            type="button"
                            onClick={() => onUpdateFtp(cand.ftpWatts)}
                            title={`${cand.basisValue}${cand.activityName ? ` · ${cand.activityName}` : ''}`}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-amber-100/70 dark:hover:bg-amber-900/30 border border-slate-200/80 dark:border-slate-700 font-mono text-[10px] text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                          >
                            <span className="font-bold text-amber-600 dark:text-amber-400">{cand.ftpWatts} W</span>
                            <span>{cand.label}</span>
                            <span className="text-slate-400">({cand.wkg} W/kg)</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Compact Field Test Calculator */}
                <div className="pt-2 border-t border-amber-200/50 dark:border-amber-800/40 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-bold text-slate-600 dark:text-slate-300">
                    {t('Feldtest-Rechner', 'Field Test Calculator')}:
                  </span>
                  <select
                    aria-label={t('Feldtest-Typ', 'Field test type')}
                    value={fieldTestType}
                    onChange={(e) => setFieldTestType(e.target.value as FtpFieldTestType)}
                    className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
                  >
                    <option value="20min">20-Min-Test (×0.95)</option>
                    <option value="8min">8-Min-Test (×0.90)</option>
                    <option value="ramp">Ramp-Test MAP (×0.75)</option>
                    <option value="60min">60-Min TT (×1.00)</option>
                  </select>
                  <FreeMetricInput
                    value={fieldTestWatts}
                    allowDecimal={false}
                    onCommit={(val) => setFieldTestWatts(val)}
                    ariaLabel={t('Testleistung (Watt)', 'Test power (Watts)')}
                    className="w-20 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono font-bold text-xs text-slate-900 dark:text-slate-100 text-center"
                  />
                  <span className="text-slate-500 font-mono">W</span>
                  {fieldTestPreview && (
                    <>
                      <span className="font-mono font-black text-amber-600 dark:text-amber-400">
                        = {fieldTestPreview.ftpWatts} W ({fieldTestPreview.wkg} W/kg)
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateFtp(fieldTestPreview.ftpWatts)}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold text-[10px] hover:opacity-90 cursor-pointer"
                      >
                        {t('Übernehmen', 'Apply')}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('FTP-Schwelle (Watt)', 'FTP Threshold (Watts)')}
                  </span>
                  <FreeMetricInput
                    value={ftp}
                    allowDecimal={false}
                    onCommit={onUpdateFtp}
                    ariaLabel={t('FTP-Schwelle (Watt)', 'FTP Threshold (Watts)')}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-bold text-amber-600 dark:text-amber-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400"
                  />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('Körpergewicht (kg)', 'Body Weight (kg)')}
                  </span>
                  <FreeMetricInput
                    value={userWeight}
                    allowDecimal={true}
                    precision={1}
                    onCommit={onUpdateWeight}
                    ariaLabel={t('Körpergewicht (kg)', 'Body Weight (kg)')}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400"
                  />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('Rad & Gepäck (kg)', 'Bike & Gear Weight (kg)')}
                  </span>
                  <FreeMetricInput
                    value={preferences.bikeWeight}
                    allowZero={true}
                    allowDecimal={true}
                    precision={1}
                    onCommit={(val) => onUpdatePreferences({ bikeWeight: val })}
                    ariaLabel={t('Rad & Gepäck (kg)', 'Bike & Gear Weight (kg)')}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400"
                  />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('Alter (Jahre)', 'Age (Years)')}
                  </span>
                  <FreeMetricInput
                    value={userAge}
                    allowDecimal={false}
                    onCommit={onUpdateAge}
                    ariaLabel={t('Alter (Jahre)', 'Age (Years)')}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400"
                  />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Heart size={12} className="text-rose-500" />
                    <span>{t('Max. Herzfrequenz (bpm)', 'Max Heart Rate (bpm)')}</span>
                  </span>
                  <FreeMetricInput
                    value={userMaxHr}
                    allowDecimal={false}
                    onCommit={onUpdateMaxHr}
                    ariaLabel={t('Max. Herzfrequenz (bpm)', 'Max Heart Rate (bpm)')}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-bold text-rose-600 dark:text-rose-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400"
                  />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('Basis-Ruhepuls (bpm)', 'Resting HR Baseline (bpm)')}
                  </span>
                  <FreeMetricInput
                    value={preferences.rhrBaseline}
                    allowDecimal={false}
                    onCommit={(val) => onUpdatePreferences({ rhrBaseline: val })}
                    ariaLabel={t('Basis-Ruhepuls (bpm)', 'Resting HR Baseline (bpm)')}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400"
                  />
                </label>

                <label className="space-y-1.5 block sm:col-span-2 lg:col-span-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('Standard-Planungstempo (km/h)', 'Default Touring Speed (km/h)')}
                    {preferences.unitSystem === 'imperial' && (
                      <span className="ml-1.5 text-indigo-600 dark:text-indigo-400 font-mono">
                        ({formatSpeed(estimatedSpeed, 'imperial')})
                      </span>
                    )}
                  </span>
                  <FreeMetricInput
                    value={estimatedSpeed}
                    allowDecimal={true}
                    precision={1}
                    onCommit={onUpdateEstimatedSpeed}
                    ariaLabel={t('Standard-Planungstempo (km/h)', 'Default Touring Speed (km/h)')}
                    className="w-full sm:w-56 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400"
                  />
                </label>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t(
                  'Alle Werte lassen sich frei eingeben (Punkt oder Komma) und werden mit Enter oder beim Verlassen des Feldes übernommen.',
                  'All values can be typed freely and are applied on Enter or when leaving the field.'
                )}
              </p>

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
                      key: 'autoColorTracksBySurface',
                      title: t('Tracks in der Liste nach Untergrund färben', 'Auto-Color Sidebar Tracks by Surface'),
                      desc: t(
                        'Färbt Strecken in der Seitenleiste automatisch nach Hauptbelag (z. B. Grün für Asphalt, Orange für Schotter).',
                        'Automatically colors tracks in the sidebar list by primary surface (e.g. green for paved, orange for gravel).'
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
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/80 space-y-3.5">
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

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdatePreferences({ tileCacheEnabled: !preferences.tileCacheEnabled })
                      }
                      className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                        preferences.tileCacheEnabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                      title={t('Kachel-Cache umschalten', 'Toggle Tile Cache')}
                      aria-label={t('Karten-Kachel-Cache aktivieren', 'Enable Map Tile Cache')}
                    >
                      <span
                        className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
                          preferences.tileCacheEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>

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
                </div>

                {/* Configurable Tile Cache Quota Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/70 dark:border-slate-700/70">
                  <label className="space-y-1.5 block">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-slate-700 dark:text-slate-200">
                        {t('Speicherlimit (MB)', 'Size Limit (MB)')}
                      </span>
                      <span className="font-mono font-black text-indigo-600 dark:text-indigo-400 tabular-nums">
                        {preferences.tileCacheMaxMb} MB
                      </span>
                    </div>
                    <input
                      type="range"
                      min={25}
                      max={1000}
                      step={25}
                      value={preferences.tileCacheMaxMb}
                      onChange={(e) => {
                        const val = Math.max(25, Math.min(1000, Number(e.target.value) || 150));
                        onUpdatePreferences({ tileCacheMaxMb: val });
                      }}
                      onMouseUp={() =>
                        void handleApplyTileCacheLimits(
                          preferences.tileCacheMaxMb,
                          preferences.tileCacheMaxCount
                        )
                      }
                      onTouchEnd={() =>
                        void handleApplyTileCacheLimits(
                          preferences.tileCacheMaxMb,
                          preferences.tileCacheMaxCount
                        )
                      }
                      className="w-full accent-indigo-600 cursor-pointer"
                    />
                  </label>

                  <label className="space-y-1.5 block">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-slate-700 dark:text-slate-200">
                        {t('Max. Kachel-Anzahl', 'Max Tile Count')}
                      </span>
                      <span className="font-mono font-black text-indigo-600 dark:text-indigo-400 tabular-nums">
                        {preferences.tileCacheMaxCount.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={250}
                      max={25000}
                      step={250}
                      value={preferences.tileCacheMaxCount}
                      onChange={(e) => {
                        const val = Math.max(250, Math.min(25000, Number(e.target.value) || 3500));
                        onUpdatePreferences({ tileCacheMaxCount: val });
                      }}
                      onMouseUp={() =>
                        void handleApplyTileCacheLimits(
                          preferences.tileCacheMaxMb,
                          preferences.tileCacheMaxCount
                        )
                      }
                      onTouchEnd={() =>
                        void handleApplyTileCacheLimits(
                          preferences.tileCacheMaxMb,
                          preferences.tileCacheMaxCount
                        )
                      }
                      className="w-full accent-indigo-600 cursor-pointer"
                    />
                  </label>

                  <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>
                      {preferences.tileCacheEnabled
                        ? t(
                            'Älteste Kacheln (LRU) werden automatisch bereinigt, wenn das Limit sinkt.',
                            'Oldest tiles (LRU) are automatically evicted when lowering quotas.'
                          )
                        : t(
                            'Kachel-Cache pausiert – Kacheln werden direkt vom Server geladen.',
                            'Tile caching paused — map tiles load directly from the network.'
                          )}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void handleApplyTileCacheLimits(
                          preferences.tileCacheMaxMb,
                          preferences.tileCacheMaxCount
                        )
                      }
                      disabled={isPruningTiles}
                      className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer disabled:opacity-50"
                    >
                      {isPruningTiles
                        ? t('Bereinige...', 'Applying...')
                        : t('Limit jetzt prüfen', 'Enforce Quota Now')}
                    </button>
                  </div>
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
                  const maxBytes = preferences.tileCacheMaxMb * 1024 * 1024;
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
                            <span className="text-xs font-semibold text-slate-400">
                              {' '}
                              / {preferences.tileCacheMaxCount.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')}
                            </span>
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

              {/* Surface Analysis SQLite Cache Card */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/80 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                      <Layers size={14} className="text-emerald-500" />
                      <span>{t('Oberflächen-Analyse-Cache (SQLite)', 'Surface Analysis Cache (SQLite)')}</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {t(
                        'Speichert Valhalla- & Overpass-Belagsanalysen nach Routen-Signatur, um erneute API-Abfragen zu sparen.',
                        'Caches Valhalla & Overpass surface results by route signature to avoid repeated lookups.'
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void handleUpdateSurfaceCacheConfig({
                          enabled: !preferences.surfaceCacheEnabled
                        })
                      }
                      disabled={isSavingSurfaceCache}
                      className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                        preferences.surfaceCacheEnabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                      title={t('Oberflächen-Cache umschalten', 'Toggle Surface Cache')}
                      aria-label={t('Oberflächen-Cache aktivieren', 'Enable Surface Cache')}
                    >
                      <span
                        className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
                          preferences.surfaceCacheEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>

                    <button
                      type="button"
                      id="btn-settings-clear-surface-cache"
                      onClick={() => void handlePurgeSurfaceCache()}
                      disabled={isPurgingSurfaceCache || (surfaceStats?.entryCount ?? 0) === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/70 text-xs font-bold transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                    >
                      <Trash2 size={13} />
                      <span>
                        {isPurgingSurfaceCache
                          ? t('Leere Cache...', 'Clearing...')
                          : t('Analyse-Cache leeren', 'Clear Surface Cache')}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Configurable Surface Cache Rules */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/70 dark:border-slate-700/70">
                  <label className="space-y-1.5 block">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                        <Clock size={12} className="text-emerald-500" />
                        <span>{t('Aufbewahrungsdauer (TTL)', 'Retention TTL (Days)')}</span>
                      </span>
                      <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {preferences.surfaceCacheTtlDays} {t('Tage', 'days')}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={365}
                      step={1}
                      value={preferences.surfaceCacheTtlDays}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(365, Number(e.target.value) || 30));
                        onUpdatePreferences({ surfaceCacheTtlDays: val });
                      }}
                      onMouseUp={() =>
                        void handleUpdateSurfaceCacheConfig({
                          ttlDays: preferences.surfaceCacheTtlDays
                        })
                      }
                      onTouchEnd={() =>
                        void handleUpdateSurfaceCacheConfig({
                          ttlDays: preferences.surfaceCacheTtlDays
                        })
                      }
                      className="w-full accent-emerald-600 cursor-pointer"
                    />
                  </label>

                  <label className="space-y-1.5 block">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-slate-700 dark:text-slate-200">
                        {t('Max. gespeicherte Routen', 'Max Cached Routes')}
                      </span>
                      <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {preferences.surfaceCacheMaxEntries.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={50}
                      max={2000}
                      step={50}
                      value={preferences.surfaceCacheMaxEntries}
                      onChange={(e) => {
                        const val = Math.max(50, Math.min(2000, Number(e.target.value) || 400));
                        onUpdatePreferences({ surfaceCacheMaxEntries: val });
                      }}
                      onMouseUp={() =>
                        void handleUpdateSurfaceCacheConfig({
                          maxEntries: preferences.surfaceCacheMaxEntries
                        })
                      }
                      onTouchEnd={() =>
                        void handleUpdateSurfaceCacheConfig({
                          maxEntries: preferences.surfaceCacheMaxEntries
                        })
                      }
                      className="w-full accent-emerald-600 cursor-pointer"
                    />
                  </label>
                </div>

                {surfaceCacheMessage && (
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                    <CheckCircle2 size={14} className="shrink-0" />
                    <span>{surfaceCacheMessage}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/70">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      {t('Gespeicherte Routen', 'Cached Routes')}
                    </span>
                    <span className="text-lg font-black font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {(surfaceStats?.entryCount ?? 0).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')}
                      <span className="text-xs font-semibold text-slate-400">
                        {' '}
                        / {preferences.surfaceCacheMaxEntries.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')}
                      </span>
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/70">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      {t('SQLite-Payload', 'SQLite Payload')}
                    </span>
                    <span className="text-lg font-black font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatByteSize(surfaceStats?.payloadBytes ?? 0)}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/70">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      {t('Cache-Status', 'Cache Mode')}
                    </span>
                    <span
                      className={`text-sm font-black block mt-0.5 ${
                        preferences.surfaceCacheEnabled
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {preferences.surfaceCacheEnabled
                        ? t(`Aktiv (${preferences.surfaceCacheTtlDays}d TTL)`, `Active (${preferences.surfaceCacheTtlDays}d TTL)`)
                        : t('Deaktiviert (Live)', 'Disabled (Live Only)')}
                    </span>
                  </div>
                </div>
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

              {/* Multi-Method FTP Calculator */}
              <div className="p-3.5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-800/50 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                      <Zap size={13} className="text-amber-500" />
                      <span>{t('FTP berechnen (Powermeter, Critical Power & Steigungs-Physik)', 'Calculate FTP (Power Meter, Critical Power & Climbing Physics)')}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t(
                        'Analysiert 60-Min / 20-Min / 8-Min-Leistungspeaks, Critical Power oder lange Bergfahrten aus deinen synchronisierten Aktivitäten.',
                        'Analyzes 60-min / 20-min / 8-min power peaks, Critical Power, or sustained climbs from your synced activities.'
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    id="btn-calculate-ftp-activities"
                    onClick={handleCalculateFtpFromActivities}
                    disabled={isCalculatingFtp}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 text-xs font-bold transition-colors cursor-pointer shrink-0 shadow-sm"
                  >
                    {isCalculatingFtp ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Zap size={14} />
                    )}
                    <span>
                      {isCalculatingFtp
                        ? t('Berechne FTP…', 'Calculating FTP…')
                        : t('Aus Aktivitäten berechnen', 'Calculate from Activities')}
                    </span>
                  </button>
                </div>

                {ftpEstimateError && (
                  <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-[11px] text-rose-700 dark:text-rose-300 font-semibold">
                    {ftpEstimateError}
                  </div>
                )}

                {ftpEstimateReport && (
                  <div className="p-2.5 rounded-xl bg-white/90 dark:bg-slate-900/80 border border-amber-200/70 dark:border-amber-800/50 space-y-2 text-[11px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-800 dark:text-slate-100">
                          {ftpEstimateReport.summary}
                        </span>
                        {ftpEstimateReport.confidence !== 'none' && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                              ftpEstimateReport.confidence === 'high'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : ftpEstimateReport.confidence === 'medium'
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {ftpEstimateReport.confidence}
                          </span>
                        )}
                      </div>
                      {ftpEstimateReport.recommendedFtp !== null && (
                        <button
                          type="button"
                          onClick={() => onUpdateFtp(ftpEstimateReport.recommendedFtp!)}
                          className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-[11px] cursor-pointer shrink-0"
                        >
                          {t('FTP übernehmen', 'Apply FTP')} ({ftpEstimateReport.recommendedFtp} W)
                        </button>
                      )}
                    </div>

                    {ftpEstimateReport.candidates.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {ftpEstimateReport.candidates.map((cand) => (
                          <button
                            key={cand.method}
                            type="button"
                            onClick={() => onUpdateFtp(cand.ftpWatts)}
                            title={`${cand.basisValue}${cand.activityName ? ` · ${cand.activityName}` : ''}`}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-amber-100/70 dark:hover:bg-amber-900/30 border border-slate-200/80 dark:border-slate-700 font-mono text-[10px] text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                          >
                            <span className="font-bold text-amber-600 dark:text-amber-400">{cand.ftpWatts} W</span>
                            <span>{cand.label}</span>
                            <span className="text-slate-400">({cand.wkg} W/kg)</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Compact Field Test Calculator */}
                <div className="pt-2 border-t border-amber-200/50 dark:border-amber-800/40 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-bold text-slate-600 dark:text-slate-300">
                    {t('Feldtest-Rechner', 'Field Test Calculator')}:
                  </span>
                  <select
                    aria-label={t('Feldtest-Typ', 'Field test type')}
                    value={fieldTestType}
                    onChange={(e) => setFieldTestType(e.target.value as FtpFieldTestType)}
                    className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
                  >
                    <option value="20min">20-Min-Test (×0.95)</option>
                    <option value="8min">8-Min-Test (×0.90)</option>
                    <option value="ramp">Ramp-Test MAP (×0.75)</option>
                    <option value="60min">60-Min TT (×1.00)</option>
                  </select>
                  <FreeMetricInput
                    value={fieldTestWatts}
                    allowDecimal={false}
                    onCommit={(val) => setFieldTestWatts(val)}
                    ariaLabel={t('Testleistung (Watt)', 'Test power (Watts)')}
                    className="w-20 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono font-bold text-xs text-slate-900 dark:text-slate-100 text-center"
                  />
                  <span className="text-slate-500 font-mono">W</span>
                  {fieldTestPreview && (
                    <>
                      <span className="font-mono font-black text-amber-600 dark:text-amber-400">
                        = {fieldTestPreview.ftpWatts} W ({fieldTestPreview.wkg} W/kg)
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateFtp(fieldTestPreview.ftpWatts)}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold text-[10px] hover:opacity-90 cursor-pointer"
                      >
                        {t('Übernehmen', 'Apply')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/95 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportJsonFile}
            className="hidden"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onResetDefaults();
                void handleUpdateSurfaceCacheConfig({
                  enabled: DEFAULT_APP_PREFERENCES.surfaceCacheEnabled,
                  ttlDays: DEFAULT_APP_PREFERENCES.surfaceCacheTtlDays,
                  maxEntries: DEFAULT_APP_PREFERENCES.surfaceCacheMaxEntries
                });
              }}
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
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              <Upload size={13} />
              <span>{t('Import JSON', 'Import JSON')}</span>
            </button>
            {importError && (
              <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                {importError}
              </span>
            )}
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
