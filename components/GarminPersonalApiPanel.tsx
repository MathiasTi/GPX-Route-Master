import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Key, RefreshCw, Download, Search, CheckCircle, AlertCircle, Trash2,
  Eye, EyeOff, Calendar, Activity, Heart, Moon, Footprints, Scale,
  MapPin, ExternalLink, Sparkles, Clock, Flame, TrendingUp, Filter, ShieldCheck
} from 'lucide-react';
import { getApiUrl, apiFetch } from '../utils/api';
import { calculateElevationStats } from '../utils/gpxUtils';
import {
  getSessionGarminKey,
  setSessionGarminKey,
  clearSessionGarminKey,
  subscribeSessionGarminKey,
  validateGarminSessionKey,
  garminFetch
} from '../utils/garminSessionKey';

export interface GarminPersonalApiPanelProps {
  onDataSynced?: () => void;
  onLoadTrack?: (track: any) => void;
  onCloseModal?: () => void;
}

interface ApiStatus {
  configured: boolean;
  source: 'tab-memory' | 'env' | 'none';
  persistent: boolean;
  encrypted: boolean;
  encryptionAlgorithm: 'RAM (Tab-Sitzung)' | null;
  deletable: boolean;
  hasEnvFallback: boolean;
  maskedKey: string | null;
  baseUrl: string;
  tokenValid: boolean;
  tokenExpiresAt: string | null;
  lastSyncAt: string | null;
}

export const GarminPersonalApiPanel: React.FC<GarminPersonalApiPanelProps> = ({
  onDataSynced,
  onLoadTrack,
  onCloseModal
}) => {
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrlInput, setBaseUrlInput] = useState('https://personal.connectapi.garmin.com');
  const [showAdvancedEndpoint, setShowAdvancedEndpoint] = useState(false);

  // Sync window state
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() - 30 * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [downloadFitRoutes, setDownloadFitRoutes] = useState<boolean>(true);
  const [oldestActivityDate, setOldestActivityDate] = useState<string | null>(null);
  const [totalActivitiesCount, setTotalActivitiesCount] = useState<number>(0);

  // Loading & feedback states
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isTestingToken, setIsTestingToken] = useState(false);
  const [isDeletingKey, setIsDeletingKey] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteSyncedDataWithKey, setDeleteSyncedDataWithKey] = useState(false);
  const [isSyncingActivities, setIsSyncingActivities] = useState(false);
  const [isSyncingHealth, setIsSyncingHealth] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    active: boolean;
    phase: string;
    message: string;
    percent: number;
    updatedAt?: string;
    stats: {
      newActivities: number;
      updatedActivities: number;
      skippedDuplicates: number;
      fitDownloaded: number;
      fitRepaired: number;
      fitFailed: number;
      healthDays: number;
    };
  } | null>(null);
  const [downloadingFitId, setDownloadingFitId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

  // Unified Search & Explorer state
  const [explorerMode, setExplorerMode] = useState<'activities' | 'health'>('activities');
  const [healthCategory, setHealthCategory] = useState<'sleep' | 'rhr' | 'stress' | 'steps'>('sleep');
  const [searchQuery, setSearchQuery] = useState('');
  const [sportFilter, setSportFilter] = useState<'all' | 'cycling' | 'running' | 'hiking'>('all');
  const [minDistance, setMinDistance] = useState<string>('');
  const [maxDistance, setMaxDistance] = useState<string>('');
  const [minAscent, setMinAscent] = useState<string>('');
  const [onlyWithGps, setOnlyWithGps] = useState<boolean>(false);

  const [isSearching, setIsSearching] = useState(false);
  const [searchedActivities, setSearchedActivities] = useState<any[]>([]);
  const [searchedHealth, setSearchedHealth] = useState<{
    sleep: any[];
    rhr: any[];
    stress: any[];
    steps: any[];
  }>({ sleep: [], rhr: [], stress: [], steps: [] });

  const skipNextStatusRefreshRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await garminFetch(getApiUrl('/api/garmin/personal/status'));
      if (!res.ok) {
        return;
      }
      const text = await res.text();
      if (!text || !text.trim().startsWith('{')) {
        return;
      }
      const json = JSON.parse(text);
      if (json.success && json.status) {
        setStatus(json.status);
        if (json.status.baseUrl) {
          setBaseUrlInput(json.status.baseUrl);
        }
      }
    } catch (e: any) {
      console.warn('Garmin Personal API Status konnte nicht geladen werden:', e?.message || e);
    }
  }, []);

  const executeSearch = useCallback(async () => {
    setIsSearching(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (sportFilter !== 'all') params.set('activityType', sportFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (minDistance !== '') params.set('minDistance', minDistance);
      if (maxDistance !== '') params.set('maxDistance', maxDistance);
      if (minAscent !== '') params.set('minAscent', minAscent);
      if (onlyWithGps) params.set('hasGps', 'true');

      const res = await garminFetch(getApiUrl(`/api/garmin/personal/search?${params.toString()}`));
      if (!res.ok) {
        return;
      }
      const text = await res.text();
      if (!text || !text.trim().startsWith('{')) {
        return;
      }
      const json = JSON.parse(text);
      if (json.success) {
        setSearchedActivities(Array.isArray(json.activities) ? json.activities : []);
        setOldestActivityDate(typeof json.oldestActivityDate === 'string' ? json.oldestActivityDate : null);
        setTotalActivitiesCount(typeof json.totalActivitiesCount === 'number' ? json.totalActivitiesCount : 0);
        if (json.health) {
          setSearchedHealth({
            sleep: Array.isArray(json.health.sleep) ? json.health.sleep : [],
            rhr: Array.isArray(json.health.rhr) ? json.health.rhr : [],
            stress: Array.isArray(json.health.stress) ? json.health.stress : [],
            steps: Array.isArray(json.health.steps) ? json.health.steps : []
          });
        }
      }
    } catch (e: any) {
      console.warn('Garmin Personal API Suche fehlgeschlagen:', e?.message || e);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, sportFilter, startDate, endDate, minDistance, maxDistance, minAscent, onlyWithGps]);

  useEffect(() => {
    fetchStatus();
    const unsubscribe = subscribeSessionGarminKey(() => {
      if (skipNextStatusRefreshRef.current) {
        skipNextStatusRefreshRef.current = false;
        return;
      }
      fetchStatus();
    });
    return unsubscribe;
  }, [fetchStatus]);

  useEffect(() => {
    executeSearch();
  }, [executeSearch]);

  useEffect(() => {
    if (!isSyncingActivities && !isSyncingHealth) return;
    let cancelled = false;

    const pollProgress = async () => {
      try {
        const res = await garminFetch(getApiUrl('/api/garmin/personal/sync-progress'));
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json?.success && json.progress) {
          setSyncProgress(json.progress);
        }
      } catch {
        // Ignore transient polling errors
      }
    };

    pollProgress();
    const timer = window.setInterval(pollProgress, 450);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isSyncingActivities, isSyncingHealth]);

  const applyDatePreset = (days: number | 'all') => {
    const end = new Date();
    if (days === 'all') {
      setStartDate('2010-01-01');
      setEndDate(end.toISOString().slice(0, 10));
      return;
    }
    const start = new Date(Date.now() - days * 86400 * 1000);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
  };

  const isValidGarminBaseUrl = (rawUrl: string): boolean => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return true;
    try {
      const parsed = new URL(trimmed);
      const hostname = parsed.hostname.toLowerCase();
      return (
        parsed.protocol === 'https:' &&
        !parsed.username &&
        !parsed.password &&
        (hostname === 'garmin.com' || hostname.endsWith('.garmin.com'))
      );
    } catch {
      return false;
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const activeTabKey = getSessionGarminKey();

    if (!isValidGarminBaseUrl(baseUrlInput)) {
      setFeedback({
        type: 'error',
        message: 'Ungültige Garmin API Base-URL: Aus Sicherheitsgründen (SSRF-Schutz) sind ausschließlich offizielle HTTPS-Domains von garmin.com zulässig.'
      });
      return;
    }

    const validation = validateGarminSessionKey(apiKeyInput || activeTabKey);
    if (!validation.valid) {
      setFeedback({
        type: 'error',
        message: validation.error || 'Bitte gib deinen Garmin Personal API Key für diese Browser-Tab-Sitzung ein.'
      });
      return;
    }

    const effectiveKey = validation.sanitized;

    setIsSavingConfig(true);
    setFeedback(null);
    try {
      const res = await garminFetch(getApiUrl('/api/garmin/personal/config'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Garmin-Personal-Key': effectiveKey
        },
        body: JSON.stringify({
          apiKey: effectiveKey,
          baseUrl: baseUrlInput.trim(),
          persistent: false
        })
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (res.ok && json?.success) {
        if (json.status) {
          setStatus(json.status);
        }
        skipNextStatusRefreshRef.current = true;
        setSessionGarminKey(effectiveKey);
        skipNextStatusRefreshRef.current = false;
        setApiKeyInput('');
        setShowDeleteConfirm(false);

        const removedNotice = json.previousDbKeyRemoved
          ? ' Zuvor gespeicherte Alt-Daten wurden bereinigt.'
          : '';
        if (json.tokenVerified) {
          setFeedback({
            type: 'success',
            message: `Personal API Key temporär im Browser-Tab-Speicher (nicht-persistent) aktiviert und 24h OAuth2 Access-Token erfolgreich verifiziert.${removedNotice}`
          });
        } else if (json.warning) {
          setFeedback({
            type: 'warning',
            message: `API Key im Browser-Tab-Speicher (nicht-persistent) aktiv, aber Token-Austausch meldete: ${json.warning}${removedNotice}`
          });
        } else {
          setFeedback({
            type: 'success',
            message: `Garmin Personal API Key für diesen Browser-Tab (nicht-persistent) aktiviert.${removedNotice}`
          });
        }
      } else {
        setFeedback({
          type: 'error',
          message: json?.error || `Fehler beim Aktivieren des Sitzungs-Keys (HTTP ${res.status}).`
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Netzwerkfehler beim Aktivieren des Sitzungs-Keys.' });
    } finally {
      skipNextStatusRefreshRef.current = false;
      setIsSavingConfig(false);
    }
  };

  const handleTestToken = async () => {
    setIsTestingToken(true);
    setFeedback(null);
    try {
      const res = await garminFetch(getApiUrl('/api/garmin/personal/test-token'), { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setStatus(json.status);
        setFeedback({
          type: 'success',
          message: json.message || 'OAuth2 Access-Token erfolgreich aktualisiert.'
        });
      } else {
        setFeedback({
          type: 'error',
          message: json.error || 'Token-Prüfung fehlgeschlagen.'
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Verbindungsfehler bei der Token-Prüfung.' });
    } finally {
      setIsTestingToken(false);
    }
  };

  const handleConfirmDeleteKey = async () => {
    setIsDeletingKey(true);
    setFeedback(null);
    try {
      clearSessionGarminKey();
      const query = deleteSyncedDataWithKey ? '?clearData=true' : '';
      const res = await garminFetch(getApiUrl(`/api/garmin/personal/config${query}`), { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setStatus(json.status);
        setShowDeleteConfirm(false);
        setDeleteSyncedDataWithKey(false);
        if (json.dataCleared) {
          await executeSearch();
          onDataSynced?.();
          setFeedback({
            type: 'success',
            message: 'Sitzungs-Key aus dem Browser-Tab-Speicher, OAuth2-Token und alle synchronisierten Garmin-Daten wurden vollständig gelöscht.'
          });
        } else {
          setFeedback({
            type: 'success',
            message: 'Nicht-persistenter Garmin Personal API Key wurde aus dem Browser-Tab-Speicher entfernt.'
          });
        }
      } else {
        setFeedback({ type: 'error', message: json.error || 'Fehler beim Entfernen des Sitzungs-Keys.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Fehler beim Entfernen des Sitzungs-Keys.' });
    } finally {
      setIsDeletingKey(false);
    }
  };

  const handleSyncActivities = async (overrideStart?: string, overrideEnd?: string) => {
    const effectiveStart = overrideStart ?? startDate;
    const effectiveEnd = overrideEnd ?? endDate;
    setIsSyncingActivities(true);
    setFeedback(null);
    try {
      const res = await garminFetch(getApiUrl('/api/garmin/personal/sync-activities'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: effectiveStart,
          endDate: effectiveEnd,
          downloadFitRoutes
        })
      });
      const json = await res.json();
      if (json.success) {
        const parts = [
          `${json.newActivities ?? json.syncedCount ?? 0} neu`,
          `${json.updatedActivities ?? 0} aktualisiert`,
          `${json.skippedDuplicates ?? 0} Dupletten übersprungen`,
          `${json.fitDownloadedCount ?? 0} FIT-Routen dekodiert`
        ];
        if ((json.fitRepairedCount ?? 0) > 0) {
          parts.push(`${json.fitRepairedCount} FIT-Dateien repariert`);
        }
        setFeedback({
          type: 'success',
          message: `Aktivitäten-Sync abgeschlossen: ${parts.join(' · ')}.`
        });
        const progRes = await garminFetch(getApiUrl('/api/garmin/personal/sync-progress')).catch(() => null);
        const progJson = progRes ? await progRes.json().catch(() => null) : null;
        if (progJson?.success && progJson.progress) setSyncProgress(progJson.progress);
        await fetchStatus();
        await executeSearch();
        onDataSynced?.();
      } else {
        setFeedback({ type: 'error', message: json.error || 'Aktivitäten-Sync fehlgeschlagen.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Netzwerkfehler beim Aktivitäten-Sync.' });
    } finally {
      setIsSyncingActivities(false);
    }
  };

  const handleSyncOlderActivities = async (daysBack: number) => {
    const anchorStr = oldestActivityDate && oldestActivityDate < startDate ? oldestActivityDate : startDate;
    const anchorMs = new Date(`${anchorStr}T00:00:00Z`).getTime();
    const safeAnchorMs = Number.isFinite(anchorMs) ? anchorMs : Date.now();
    const newEnd = new Date(safeAnchorMs).toISOString().slice(0, 10);
    const newStart = new Date(safeAnchorMs - daysBack * 86400 * 1000).toISOString().slice(0, 10);
    setStartDate(newStart);
    setEndDate(newEnd);
    await handleSyncActivities(newStart, newEnd);
  };

  const handleSyncHealth = async () => {
    setIsSyncingHealth(true);
    setFeedback(null);
    try {
      const res = await garminFetch(getApiUrl('/api/garmin/personal/sync-health'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate })
      });
      const json = await res.json();
      if (json.success) {
        setFeedback({
          type: 'success',
          message: `Gesundheitsdaten synchronisiert: ${json.sleepCount} Schlaf, ${json.rhrCount} Ruhepuls, ${json.stressCount} Stress, ${json.stepsCount} Schritte.`
        });
        await fetchStatus();
        await executeSearch();
        onDataSynced?.();
      } else {
        setFeedback({ type: 'error', message: json.error || 'Gesundheitsdaten-Sync fehlgeschlagen.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Netzwerkfehler beim Gesundheitsdaten-Sync.' });
    } finally {
      setIsSyncingHealth(false);
    }
  };

  const handleFullSync = async () => {
    setIsSyncingActivities(true);
    setIsSyncingHealth(true);
    setFeedback(null);
    try {
      const [actRes, healthRes] = await Promise.all([
        garminFetch(getApiUrl('/api/garmin/personal/sync-activities'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startDate, endDate, downloadFitRoutes })
        }),
        garminFetch(getApiUrl('/api/garmin/personal/sync-health'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startDate, endDate })
        })
      ]);
      const actJson = await actRes.json();
      const healthJson = await healthRes.json();

      if (actJson.success || healthJson.success) {
        const parts: string[] = [];
        if (actJson.success) {
          const dupNote = (actJson.skippedDuplicates ?? 0) > 0 ? `, ${actJson.skippedDuplicates} Dupletten übersprungen` : '';
          const repNote = (actJson.fitRepairedCount ?? 0) > 0 ? `, ${actJson.fitRepairedCount} FIT repariert` : '';
          parts.push(`${actJson.syncedCount} Aktivitäten (${actJson.fitDownloadedCount} FIT${dupNote}${repNote})`);
        }
        if (healthJson.success) {
          parts.push(`${healthJson.sleepCount} Schlaf · ${healthJson.rhrCount} RHR · ${healthJson.stepsCount} Schritte`);
        }
        setFeedback({
          type: 'success',
          message: `Komplett-Synchronisation abgeschlossen: ${parts.join(' | ')}`
        });
        const progRes = await garminFetch(getApiUrl('/api/garmin/personal/sync-progress')).catch(() => null);
        const progJson = progRes ? await progRes.json().catch(() => null) : null;
        if (progJson?.success && progJson.progress) setSyncProgress(progJson.progress);
        await fetchStatus();
        await executeSearch();
        onDataSynced?.();
      } else {
        setFeedback({
          type: 'error',
          message: actJson.error || healthJson.error || 'Synchronisation fehlgeschlagen.'
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Fehler bei der Komplett-Synchronisation.' });
    } finally {
      setIsSyncingActivities(false);
      setIsSyncingHealth(false);
    }
  };

  const handleDownloadAndOpenFit = async (act: any) => {
    setDownloadingFitId(String(act.id));
    setFeedback(null);
    try {
      // First try downloading fresh FIT via Personal API if configured
      if (status?.configured) {
        const res = await garminFetch(getApiUrl(`/api/garmin/personal/activity/${encodeURIComponent(act.id)}/fit`));
        const json = await res.json();
        if (json.success && json.track) {
          const hydratedTrack = {
            ...json.track,
            points: (json.track.points || []).map((pt: any) => ({
              ...pt,
              time: pt.time ? new Date(pt.time) : undefined
            }))
          };
          const repairNote =
            json.integrityStatus === 'repaired' && Array.isArray(json.repairedIssues) && json.repairedIssues.length > 0
              ? ` · Automatisch repariert (${json.repairedIssues.join(', ')})`
              : json.sourceFormat === 'json_details'
              ? ' · JSON-Stream-Fallback'
              : '';
          setFeedback({
            type: json.integrityStatus === 'repaired' ? 'warning' : 'success',
            message: `FIT-Strecke "${hydratedTrack.name}" (${json.pointsCount} GPS-Punkte${repairNote}) geladen.`
          });
          onLoadTrack?.(hydratedTrack);
          onCloseModal?.();
          return;
        }
      }

      // Fallback: load from local SQLite points_json if already stored
      const fullRes = await apiFetch(getApiUrl(`/api/activity-track-full?id=${encodeURIComponent(act.id)}`));
      const fullJson = await fullRes.json();
      const rawPointsStr = fullJson.success && fullJson.points_json ? fullJson.points_json : act.points_json;
      if (rawPointsStr) {
        const pts = JSON.parse(rawPointsStr);
        if (Array.isArray(pts) && pts.length > 0) {
          const mappedPts = pts
            .map((p: any) => ({
              lat: Number(Array.isArray(p) ? p[1] : p.lat ?? p.latitude),
              lng: Number(Array.isArray(p) ? p[0] : p.lng ?? p.longitude),
              ele: Number(Array.isArray(p) ? p[2] || 0 : p.ele ?? p.elevation ?? 0),
              time: p.time ? new Date(p.time) : undefined,
              hr: p.hr ?? p.heart_rate,
              cad: p.cad ?? p.cadence,
              power: p.power
            }))
            .filter((p: any) => !isNaN(p.lat) && !isNaN(p.lng));

          if (mappedPts.length > 0) {
            const eleStats = calculateElevationStats(mappedPts);
            onLoadTrack?.({
              id: `garmin-act-${act.id}`,
              name: act.name || `Garmin Aktivität #${act.id}`,
              points: mappedPts,
              color: '#0284c7',
              distance: act.distance || eleStats.totalDist,
              ascent: act.ascent ?? eleStats.ascent,
              descent: act.descent ?? eleStats.descent,
              maxSlope: eleStats.maxSlope,
              duration: act.duration,
              visible: true,
              activityType: act.type?.includes('run') ? 'running' : 'cycling',
              hasTimestamps: mappedPts.some((p: any) => p.time !== undefined)
            });
            onCloseModal?.();
            return;
          }
        }
      }

      setFeedback({
        type: 'warning',
        message: 'Für diese Aktivität sind noch keine FIT-Koordinaten verfügbar. Bitte prüfe deinen Garmin Personal API Key.'
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Fehler beim Laden der FIT-Strecke.'
      });
    } finally {
      setDownloadingFitId(null);
    }
  };

  const healthSummaryStats = useMemo(() => {
    const avgRhr = searchedHealth.rhr.length > 0
      ? Math.round(searchedHealth.rhr.reduce((acc, r) => acc + Number(r.rhr || 0), 0) / searchedHealth.rhr.length)
      : null;
    const avgSleepMin = searchedHealth.sleep.length > 0
      ? Math.round(searchedHealth.sleep.reduce((acc, s) => acc + Number(s.duration || 0), 0) / searchedHealth.sleep.length)
      : null;
    const avgStress = searchedHealth.stress.length > 0
      ? Math.round(searchedHealth.stress.reduce((acc, s) => acc + Number(s.avg_stress || 0), 0) / searchedHealth.stress.length)
      : null;
    const avgSteps = searchedHealth.steps.length > 0
      ? Math.round(searchedHealth.steps.reduce((acc, s) => acc + Number(s.steps || 0), 0) / searchedHealth.steps.length)
      : null;

    return { avgRhr, avgSleepMin, avgStress, avgSteps };
  }, [searchedHealth]);

  return (
    <div className="space-y-6 text-slate-900 dark:text-slate-100">
      {/* Section 1: Garmin Connect Personal API Connection & OAuth2 Token Bar */}
      <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <Key className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" />
              <h3 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Garmin Connect Personal API
              </h3>
            </div>
            <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">
              Direkter Abruf von Aktivitäten (.FIT &amp; JSON) sowie Gesundheitsdaten über deinen persönlichen API-Schlüssel (OAuth2 Token-Service).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300">
            <span>
              Status:{' '}
              <strong className={status?.configured ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                {status?.configured
                  ? status.source === 'env'
                    ? `Aktiv (${status.maskedKey} via ENV)`
                    : `Temporär im Browser-Tab (${status.maskedKey})`
                  : 'Kein Sitzungs-Key aktiv'}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck
                className={`w-3.5 h-3.5 ${
                  status?.configured
                    ? 'text-sky-600 dark:text-sky-400'
                    : 'text-slate-500'
                }`}
              />
              <span>
                {status?.source === 'env'
                  ? 'Server-Umgebungsvariable (Nicht in DB)'
                  : 'Nicht-persistent (Nur Browser-Tab RAM)'}
              </span>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              OAuth2 Token:{' '}
              <strong className={status?.tokenValid ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'}>
                {status?.tokenValid ? '24h Bearer Aktiv' : 'Bereit zum Abruf'}
              </strong>
            </span>
            {status?.lastSyncAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>Letzter Sync: {new Date(status.lastSyncAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <a
              href="https://developer.garmin.com/gc-developer-program/personal/personal-api"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:underline font-sans font-semibold"
            >
              <span>Garmin Portal</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Non-Persistent Session API Key Form */}
        <form onSubmit={handleSaveConfig} className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
            <div className="lg:col-span-6">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Personal API Key (Nicht-persistent — nur im RAM dieses Browser-Tabs, verfällt beim Schließen des Tabs)
              </label>
              <div className="relative flex items-center">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={
                    status?.configured
                      ? `Temporärer Sitzungs-Key aktiv (${status.maskedKey}) — neuen Key eingeben zum Ersetzen...`
                      : 'Garmin Personal API Key für diese Browser-Tab-Sitzung einfügen...'
                  }
                  className="w-full px-3.5 py-2 pr-10 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(prev => !prev)}
                  className="absolute right-2.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
                  title={showApiKey ? 'API Key verbergen' : 'API Key anzeigen'}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="lg:col-span-6 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={isSavingConfig}
                className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                {isSavingConfig ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                <span>Für diese Sitzung aktivieren</span>
              </button>

              {status?.configured && (
                <button
                  type="button"
                  onClick={handleTestToken}
                  disabled={isTestingToken}
                  className="px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTestingToken ? 'animate-spin text-sky-500' : ''}`} />
                  <span>Token prüfen</span>
                </button>
              )}

              {status?.configured && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(prev => !prev)}
                  className="px-3.5 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  title="Aktiven Sitzungs-Key aus dem Browser-Tab entfernen"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Sitzungs-Key entfernen</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowAdvancedEndpoint(prev => !prev)}
                className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 underline ml-auto cursor-pointer whitespace-nowrap"
              >
                {showAdvancedEndpoint ? 'Endpunkt ausblenden' : 'API-Basis-URL'}
              </button>
            </div>
          </div>

          {showDeleteConfirm && (
            <div className="p-4 rounded-lg bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/70 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-bold text-rose-900 dark:text-rose-200">
                    Nicht-persistenten Garmin Personal API Key aus dem Browser-Tab entfernen?
                  </p>
                  <p className="text-xs text-rose-800 dark:text-rose-300">
                    Der temporäre Schlüssel im Arbeitsspeicher dieses Browser-Tabs sowie der Sitzungsstatus werden sofort gelöscht.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteSyncedDataWithKey(false);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer whitespace-nowrap"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDeleteKey}
                    disabled={isDeletingKey}
                    className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    {isDeletingKey ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    <span>Sitzungs-Key löschen</span>
                  </button>
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-rose-900 dark:text-rose-200 cursor-pointer select-none pt-1 border-t border-rose-200/60 dark:border-rose-800/50 w-full">
                <input
                  type="checkbox"
                  checked={deleteSyncedDataWithKey}
                  onChange={(e) => setDeleteSyncedDataWithKey(e.target.checked)}
                  className="w-4 h-4 rounded border-rose-300 text-rose-600 focus:ring-rose-500"
                />
                <span>Auch alle synchronisierten Garmin-Aktivitäten und Gesundheitsdaten aus der Datenbank löschen</span>
              </label>
            </div>
          )}

          {showAdvancedEndpoint && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                Garmin Personal API Host:
              </label>
              <input
                type="url"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
              <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                Token-Pfad: /personalapitoken-service/personal-api/personal-api-key/token
              </span>
            </div>
          )}
        </form>

        {/* Feedback Banner */}
        {feedback && (
          <div
            className={`p-3 rounded-lg border text-xs font-medium flex items-start gap-2.5 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : feedback.type === 'warning'
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            )}
            <span className="flex-1">{feedback.message}</span>
          </div>
        )}
      </div>

      {/* Section 2: Cloud Synchronisation & Date Range Controls */}
      <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Cloud-Synchronisation &amp; Zeitraum-Auswahl
            </h4>
            <p className="text-xs text-slate-700 dark:text-slate-300">
              Wähle den Synchronisationszeitraum für Aktivitäten (.FIT-Strecken) und tägliche Gesundheitsmetriken.
            </p>
          </div>

          {/* Date Range Presets */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {[
              { label: '7 Tage', days: 7 as const },
              { label: '30 Tage', days: 30 as const },
              { label: '90 Tage', days: 90 as const },
              { label: '365 Tage', days: 365 as const },
              { label: 'Gesamte Historie', days: 'all' as const }
            ].map((preset) => (
              <button
                key={String(preset.days)}
                type="button"
                onClick={() => applyDatePreset(preset.days)}
                className="px-2.5 py-1 text-xs font-semibold rounded-md text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Startdatum (Von)
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Enddatum (Bis)
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex items-center pb-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={downloadFitRoutes}
                onChange={(e) => setDownloadFitRoutes(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <span>.FIT GPS-Routen automatisch dekodieren</span>
            </label>
          </div>
        </div>

        {/* Sync Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={handleFullSync}
            disabled={isSyncingActivities || isSyncingHealth}
            className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncingActivities || isSyncingHealth ? 'animate-spin' : ''}`} />
            <span>Komplett-Sync (Aktivitäten + Gesundheit)</span>
          </button>

          <button
            type="button"
            onClick={() => handleSyncActivities()}
            disabled={isSyncingActivities}
            className="px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Activity className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            <span>Nur Aktivitäten &amp; FIT abrufen</span>
          </button>

          <button
            type="button"
            onClick={handleSyncHealth}
            disabled={isSyncingHealth}
            className="px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Heart className="w-3.5 h-3.5 text-rose-500" />
            <span>Nur Gesundheitsdaten abrufen</span>
          </button>
        </div>

        {/* Historical Backfill Strategy Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
            <Clock className="w-3.5 h-3.5 text-sky-500 shrink-0" />
            {oldestActivityDate ? (
              <span>
                Historie: <strong className="text-slate-800 dark:text-slate-200">{totalActivitiesCount}</strong> Aktivitäten geladen (älteste: <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{oldestActivityDate}</span>)
              </span>
            ) : (
              <span>Noch keine Aktivitäten lokal gespeichert — lade deinen gewünschten Zeitraum oder ältere Blöcke.</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleSyncOlderActivities(90)}
              disabled={isSyncingActivities}
              className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Ältere laden (-90 Tage)</span>
            </button>
            <button
              type="button"
              onClick={() => handleSyncOlderActivities(365)}
              disabled={isSyncingActivities}
              className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Ältere laden (-1 Jahr)</span>
            </button>
          </div>
        </div>

        {/* Live Cloud Sync Status Card */}
        {(isSyncingActivities || isSyncingHealth || syncProgress) && (
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100 min-w-0">
                {isSyncingActivities || isSyncingHealth || syncProgress?.active ? (
                  <RefreshCw className="w-4 h-4 text-sky-500 animate-spin shrink-0" />
                ) : syncProgress?.phase === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                ) : (
                  <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                )}
                <span className="truncate">
                  {syncProgress?.message || 'Synchronisiere mit Garmin Connect Cloud...'}
                </span>
              </div>
              <span className="text-xs font-mono font-bold text-sky-600 dark:text-sky-400 shrink-0">
                {Math.min(100, Math.max(0, syncProgress?.percent ?? (isSyncingActivities || isSyncingHealth ? 15 : 100)))}%
              </span>
            </div>

            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  syncProgress?.phase === 'error'
                    ? 'bg-red-500'
                    : syncProgress?.phase === 'done' && !isSyncingActivities && !isSyncingHealth
                    ? 'bg-emerald-500'
                    : 'bg-sky-500'
                }`}
                style={{
                  width: `${Math.min(100, Math.max(5, syncProgress?.percent ?? (isSyncingActivities || isSyncingHealth ? 15 : 100)))}%`
                }}
              />
            </div>

            {syncProgress?.stats && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                  Neu: {syncProgress.stats.newActivities}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300">
                  Aktualisiert: {syncProgress.stats.updatedActivities}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                  Dupletten übersprungen: {syncProgress.stats.skippedDuplicates}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300">
                  FIT dekodiert: {syncProgress.stats.fitDownloaded}
                </span>
                {syncProgress.stats.fitRepaired > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                    FIT repariert: {syncProgress.stats.fitRepaired}
                  </span>
                )}
                {syncProgress.stats.healthDays > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300">
                    Health-Tage: {syncProgress.stats.healthDays}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 3: Unified Search & Filter Explorer */}
      <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setExplorerMode('activities')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                explorerMode === 'activities'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Aktivitäten durchsuchen ({searchedActivities.length})
            </button>
            <button
              type="button"
              onClick={() => setExplorerMode('health')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                explorerMode === 'health'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Gesundheitsdaten durchsuchen
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 font-mono tabular-nums">
            <span>Zeitraum: {startDate} bis {endDate}</span>
          </div>
        </div>

        {explorerMode === 'activities' ? (
          <div className="space-y-4">
            {/* Activity Filter Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Freitextsuche (Name, Ort, Notiz)
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="z. B. Alpe, Intervall, München..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Sportart
                </label>
                <select
                  value={sportFilter}
                  onChange={(e) => setSportFilter(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="all">Alle Sportarten</option>
                  <option value="cycling">Radsport (Cycling)</option>
                  <option value="running">Laufen (Running)</option>
                  <option value="hiking">Wandern (Hiking)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Min. Distanz (km)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={minDistance}
                  onChange={(e) => setMinDistance(e.target.value)}
                  placeholder="0"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Min. Anstieg (Hm)
                </label>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={minAscent}
                  onChange={(e) => setMinAscent(e.target.value)}
                  placeholder="0"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pb-1">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={onlyWithGps}
                    onChange={(e) => setOnlyWithGps(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-sky-600"
                  />
                  <span>Nur mit GPS</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSportFilter('all');
                    setMinDistance('');
                    setMaxDistance('');
                    setMinAscent('');
                    setOnlyWithGps(false);
                  }}
                  className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white underline cursor-pointer"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Activities Table */}
            {isSearching ? (
              <div className="space-y-2 py-4">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
                ))}
              </div>
            ) : searchedActivities.length === 0 ? (
              <div className="py-10 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Keine Aktivitäten für die gewählten Filter gefunden.
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Klicke oben auf „Komplett-Sync“ oder passe den Datumsbereich an, um Aktivitäten über die Garmin Personal API abzurufen.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-semibold">
                      <th className="py-2.5 px-3">Datum</th>
                      <th className="py-2.5 px-3">Aktivität &amp; Typ</th>
                      <th className="py-2.5 px-3 text-right">Distanz</th>
                      <th className="py-2.5 px-3 text-right">Dauer</th>
                      <th className="py-2.5 px-3 text-right">Anstieg</th>
                      <th className="py-2.5 px-3 text-right">Ø Puls</th>
                      <th className="py-2.5 px-3 text-right">Aktion (.FIT / Karte)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                    {searchedActivities.slice(0, 100).map((act) => {
                      const hasPoints = Boolean(act.points_json && act.points_json.length > 20);
                      const isDownloadingThis = downloadingFitId === String(act.id);
                      const hrs = Math.floor((act.duration || 0) / 3600);
                      const mins = Math.floor(((act.duration || 0) % 3600) / 60);

                      return (
                        <tr
                          key={act.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                        >
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                            {String(act.date || '').slice(0, 10)}
                          </td>
                          <td className="py-2.5 px-3 font-sans">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[260px]">
                              {act.name || `Aktivität #${act.id}`}
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                              <span>{act.type || 'cycling'}</span>
                              {act.location && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{act.location}</span>
                                </>
                              )}
                              <span aria-hidden="true">·</span>
                              <span>{hasPoints ? 'GPS vorhanden' : 'FIT Cloud-Abruf'}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {Number(act.distance || 0).toFixed(2)} km
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`}
                          </td>
                          <td className="py-2.5 px-3 text-right text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                            {act.ascent ? `+${Math.round(act.ascent)} m` : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-rose-600 dark:text-rose-400 whitespace-nowrap">
                            {act.avg_hr ? `${Math.round(act.avg_hr)} bpm` : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-sans whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleDownloadAndOpenFit(act)}
                              disabled={isDownloadingThis}
                              className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                            >
                              {isDownloadingThis ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
                              )}
                              <span>{hasPoints ? 'Auf Karte öffnen' : 'FIT laden & öffnen'}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          /* Health Metrics Explorer */
          <div className="space-y-4">
            {/* Summary KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                <div className="text-xs font-sans font-semibold text-slate-700 dark:text-slate-300">Ø Schlafdauer</div>
                <div className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                  {healthSummaryStats.avgSleepMin
                    ? `${Math.floor(healthSummaryStats.avgSleepMin / 60)}h ${healthSummaryStats.avgSleepMin % 60}m`
                    : '—'}
                </div>
                <div className="text-[11px] font-sans text-slate-600 dark:text-slate-400">
                  {searchedHealth.sleep.length} Tage erfasst
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                <div className="text-xs font-sans font-semibold text-slate-700 dark:text-slate-300">Ø Ruhepuls (RHR)</div>
                <div className="text-base font-bold text-rose-600 dark:text-rose-400 mt-0.5">
                  {healthSummaryStats.avgRhr ? `${healthSummaryStats.avgRhr} bpm` : '—'}
                </div>
                <div className="text-[11px] font-sans text-slate-600 dark:text-slate-400">
                  {searchedHealth.rhr.length} Messungen
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                <div className="text-xs font-sans font-semibold text-slate-700 dark:text-slate-300">Ø Stress-Level</div>
                <div className="text-base font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                  {healthSummaryStats.avgStress ? `${healthSummaryStats.avgStress} / 100` : '—'}
                </div>
                <div className="text-[11px] font-sans text-slate-600 dark:text-slate-400">
                  {searchedHealth.stress.length} Tage erfasst
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                <div className="text-xs font-sans font-semibold text-slate-700 dark:text-slate-300">Ø Schritte / Tag</div>
                <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {healthSummaryStats.avgSteps ? healthSummaryStats.avgSteps.toLocaleString('de-DE') : '—'}
                </div>
                <div className="text-[11px] font-sans text-slate-600 dark:text-slate-400">
                  {searchedHealth.steps.length} Tage erfasst
                </div>
              </div>
            </div>

            {/* Category Selector */}
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-fit">
              {[
                { id: 'sleep', label: `Schlaf (${searchedHealth.sleep.length})` },
                { id: 'rhr', label: `Ruhepuls (${searchedHealth.rhr.length})` },
                { id: 'stress', label: `Stress (${searchedHealth.stress.length})` },
                { id: 'steps', label: `Schritte (${searchedHealth.steps.length})` }
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setHealthCategory(cat.id as any)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    healthCategory === cat.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Health Data Table */}
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 max-h-96">
              <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                <thead className="bg-slate-50 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-sans font-semibold sticky top-0">
                  {healthCategory === 'sleep' && (
                    <tr>
                      <th className="py-2.5 px-3">Datum</th>
                      <th className="py-2.5 px-3 text-right">Gesamtschlaf</th>
                      <th className="py-2.5 px-3 text-right">Tiefschlaf</th>
                      <th className="py-2.5 px-3 text-right">Leichtschlaf</th>
                      <th className="py-2.5 px-3 text-right">REM-Schlaf</th>
                      <th className="py-2.5 px-3 text-right">Wachzeit</th>
                    </tr>
                  )}
                  {healthCategory === 'rhr' && (
                    <tr>
                      <th className="py-2.5 px-3">Datum</th>
                      <th className="py-2.5 px-3 text-right">Ruhepuls (bpm)</th>
                    </tr>
                  )}
                  {healthCategory === 'stress' && (
                    <tr>
                      <th className="py-2.5 px-3">Datum</th>
                      <th className="py-2.5 px-3 text-right">Ø Stress-Index (0–100)</th>
                    </tr>
                  )}
                  {healthCategory === 'steps' && (
                    <tr>
                      <th className="py-2.5 px-3">Datum</th>
                      <th className="py-2.5 px-3 text-right">Schritte</th>
                      <th className="py-2.5 px-3 text-right">Kalorien (kcal)</th>
                      <th className="py-2.5 px-3 text-right">Distanz (km)</th>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                  {healthCategory === 'sleep' &&
                    searchedHealth.sleep.map((row: any, i: number) => (
                      <tr key={`${row.date}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2 px-3">{row.date}</td>
                        <td className="py-2 px-3 text-right font-semibold">
                          {Math.floor((row.duration || 0) / 60)}h {(row.duration || 0) % 60}m
                        </td>
                        <td className="py-2 px-3 text-right">{row.deep ? `${row.deep} min` : '—'}</td>
                        <td className="py-2 px-3 text-right">{row.light ? `${row.light} min` : '—'}</td>
                        <td className="py-2 px-3 text-right">{row.rem ? `${row.rem} min` : '—'}</td>
                        <td className="py-2 px-3 text-right">{row.awake ? `${row.awake} min` : '—'}</td>
                      </tr>
                    ))}
                  {healthCategory === 'rhr' &&
                    searchedHealth.rhr.map((row: any, i: number) => (
                      <tr key={`${row.date}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2 px-3">{row.date}</td>
                        <td className="py-2 px-3 text-right font-semibold text-rose-600 dark:text-rose-400">
                          {row.rhr} bpm
                        </td>
                      </tr>
                    ))}
                  {healthCategory === 'stress' &&
                    searchedHealth.stress.map((row: any, i: number) => (
                      <tr key={`${row.date}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2 px-3">{row.date}</td>
                        <td className="py-2 px-3 text-right font-semibold text-amber-600 dark:text-amber-400">
                          {row.avg_stress}
                        </td>
                      </tr>
                    ))}
                  {healthCategory === 'steps' &&
                    searchedHealth.steps.map((row: any, i: number) => (
                      <tr key={`${row.date}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2 px-3">{row.date}</td>
                        <td className="py-2 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                          {Number(row.steps || 0).toLocaleString('de-DE')}
                        </td>
                        <td className="py-2 px-3 text-right">{row.calories ? `${Math.round(row.calories)} kcal` : '—'}</td>
                        <td className="py-2 px-3 text-right">{row.distance ? `${Number(row.distance).toFixed(2)} km` : '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
