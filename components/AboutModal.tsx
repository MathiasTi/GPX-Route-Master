import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Calendar, GitCommit, Check, Save, Sparkles, RefreshCw, Layers, Terminal, Wifi, WifiOff, HardDrive, Trash2 } from 'lucide-react';
import { getApiUrl } from '../utils/api';
import { getSWCacheStats, clearSWTileCache, SWCacheStats } from '../utils/serviceWorker';

interface AppVersion {
  id: number;
  version: string;
  updated_at: string;
  changelog: string;
}

interface AboutModalProps {
  onClose: () => void;
  onVersionUpdated?: (newVersion: string) => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ onClose, onVersionUpdated }) => {
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [newVersion, setNewVersion] = useState('');
  const [newChangelog, setNewChangelog] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [swStats, setSwStats] = useState<SWCacheStats>({ tileCount: 0, shellCount: 0 });
  const [isClearingCache, setIsClearingCache] = useState(false);

  const fetchSWStats = async () => {
    const stats = await getSWCacheStats();
    setSwStats(stats);
  };

  const handleClearTileCache = async () => {
    setIsClearingCache(true);
    await clearSWTileCache();
    await fetchSWStats();
    setIsClearingCache(false);
  };

  // Fetch versions
  const fetchVersions = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl('/api/versions'));
      const data = await response.json();
      if (data.success) {
        setVersions(data.versions);
        if (data.versions.length > 0 && onVersionUpdated) {
          onVersionUpdated(data.versions[0].version);
        }
      } else {
        setError(data.error || 'Fehler beim Laden des Versionsverlaufs.');
      }
    } catch (err: any) {
      setError(err.message || 'Netzwerkfehler beim Abrufen der Versionsdaten.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchVersions();
    fetchSWStats();

    const updateOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSuccessMsg(null);

    if (!newVersion.trim()) {
      setSubmitError('Bitte geben Sie eine gültige Versionsnummer ein (z.B. v1.3.1).');
      return;
    }
    if (!newChangelog.trim()) {
      setSubmitError('Bitte geben Sie ein detailliertes Changelog für dieses Update ein.');
      return;
    }

    // Basic semver or format validation helper
    const cleanedVersion = newVersion.replace(/^v/i, '').trim();
    if (!/^\d+\.\d+\.\d+$/.test(cleanedVersion)) {
      setSubmitError('Die Version muss dem Format MAJOR.MINOR.PATCH entsprechen (z.B. 1.3.1).');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(getApiUrl('/api/versions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: cleanedVersion, changelog: newChangelog.trim() })
      });
      const data = await response.json();
      if (data.success) {
        setSuccessMsg(`Version v${cleanedVersion} wurde erfolgreich in der SQLite-Datenbank persistiert!`);
        setNewVersion('');
        setNewChangelog('');
        setShowForm(false);
        await fetchVersions();
      } else {
        setSubmitError(data.error || 'Fehler beim Speichern der neuen Version.');
      }
    } catch (err: any) {
      setSubmitError(err.message || 'Verbindung zum Server fehlgeschlagen.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format timestamp helper
  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('de-DE', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200/80 dark:border-slate-800 flex flex-col max-h-[85vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-150 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/25">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-900/40 text-blue-600 dark:text-blue-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                Über GPX Route Master
              </h2>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">
                System-Versionsverlauf & Updates
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Main info card */}
          <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800/80 rounded-xl p-4 flex gap-4 items-start shadow-2xs">
            <div className="p-2.5 rounded-xl bg-orange-50 dark:bg-orange-950/20 text-orange-600 dark:text-orange-400 border border-orange-200/40 dark:border-orange-900/30 shrink-0">
              <Terminal className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                GPX Route Master Engine
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Ein professioneller Full-Stack-Routenmanager mit nahtloser GPX-Modulverkettung, intelligenter Höhenprofilberechnung und tiefer Garmin-SQLite-Datenbankanalyse zur Synchronisierung von Sport- & Gesundheitsmetriken.
              </p>
            </div>
          </div>

          {/* Service Worker & Offline Cache Status Card */}
          <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-lg ${isOnline ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-900/40' : 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-900/40'}`}>
                  {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                </div>
                <div>
                  <h4 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <span>Offline-Modus & Service Worker</span>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${isOnline ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'}`}>
                      {isOnline ? 'Online' : 'Offline'}
                    </span>
                  </h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Kartenkacheln & App-Shell werden automatisch im Browser zwischengespeichert.
                  </p>
                </div>
              </div>
              <button
                onClick={fetchSWStats}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
                title="Cache-Statistik aktualisieren"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200/70 dark:border-slate-800 flex items-center gap-2.5">
                <HardDrive className="w-4 h-4 text-blue-500 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Kartenkacheln Cache</div>
                  <div className="text-xs font-black text-slate-800 dark:text-slate-200">
                    {swStats.tileCount} Kacheln gespeichert
                  </div>
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200/70 dark:border-slate-800 flex items-center gap-2.5">
                <Layers className="w-4 h-4 text-indigo-500 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-400 font-bold uppercase">App Shell Cache</div>
                  <div className="text-xs font-black text-slate-800 dark:text-slate-200">
                    {swStats.shellCount > 0 ? 'Aktiv (Precached)' : 'Bereit'}
                  </div>
                </div>
              </div>
            </div>

            {swStats.tileCount > 0 && (
              <div className="flex justify-end pt-1">
                <button
                  onClick={handleClearTileCache}
                  disabled={isClearingCache}
                  className="px-3 py-1.5 bg-slate-200/70 dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-rose-950/40 text-slate-700 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Kachelspeicher leeren</span>
                </button>
              </div>
            )}
          </div>

          {/* New version registration button / form */}
          <div className="border border-slate-150 dark:border-slate-800/80 rounded-xl overflow-hidden shadow-2xs">
            <button
              onClick={() => {
                setShowForm(!showForm);
                setSubmitError(null);
                setSuccessMsg(null);
              }}
              className="w-full flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-950/25 hover:bg-slate-100 dark:hover:bg-slate-950/50 transition-colors font-semibold text-xs text-slate-700 dark:text-slate-300 uppercase tracking-wider border-b border-slate-100 dark:border-slate-850 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                <span>Neue Systemversion persistieren</span>
              </div>
              <span className="text-[10px] bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 font-extrabold px-2 py-0.5 rounded-full border border-blue-100 dark:border-blue-900/30">
                {showForm ? 'Schließen' : 'Öffnen'}
              </span>
            </button>

            <AnimatePresence>
              {showForm && (
                <motion.form
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  onSubmit={handleSubmit}
                  className="p-4 bg-white dark:bg-slate-900/60 space-y-4 border-t border-slate-100 dark:border-slate-800/40 overflow-hidden"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Versionsnummer *
                      </label>
                      <input
                        type="text"
                        value={newVersion}
                        onChange={(e) => setNewVersion(e.target.value)}
                        placeholder="z.B. 1.3.1"
                        className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950/50 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:border-blue-500 dark:focus:border-blue-400 font-semibold transition-all"
                      />
                    </div>
                    <div className="flex items-end text-[10px] text-slate-400 dark:text-slate-500 font-medium pb-2">
                      Verwenden Sie das semantische Versionierungsformat (MAJOR.MINOR.PATCH).
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Changelog / Release Notes *
                    </label>
                    <textarea
                      value={newChangelog}
                      onChange={(e) => setNewChangelog(e.target.value)}
                      placeholder="Tragen Sie hier ein, welche Features, Fehlerbehebungen oder Optimierungen in dieser Version implementiert wurden..."
                      rows={3}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950/50 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:border-blue-500 dark:focus:border-blue-400 leading-relaxed transition-all"
                    />
                  </div>

                  {submitError && (
                    <p className="text-[10px] text-red-600 dark:text-red-400 font-bold bg-red-50 dark:bg-red-955/20 border border-red-200 dark:border-red-900/40 p-2.5 rounded-lg">
                      ⚠️ {submitError}
                    </p>
                  )}

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      {isSubmitting ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      <span>In SQLite persistieren</span>
                    </button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>
          </div>

          {successMsg && (
            <div className="p-3 bg-green-50 dark:bg-green-955/20 border border-green-200 dark:border-green-900/40 text-green-700 dark:text-green-400 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-2xs">
              <Check className="w-4 h-4 shrink-0 text-green-550" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Version history list */}
          <div className="space-y-3.5">
            <h4 className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-1">
              <GitCommit className="w-4 h-4 text-blue-500" />
              <span>Datenbank-Versionsverlauf</span>
            </h4>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-10 space-y-2">
                <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
                <p className="text-[11px] text-slate-400 font-semibold">Lade Versionshistorie aus SQLite...</p>
              </div>
            ) : error ? (
              <p className="text-xs text-red-500 italic py-4">{error}</p>
            ) : versions.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-4">Keine Versionsdaten gefunden.</p>
            ) : (
              <div className="relative border-l-2 border-slate-100 dark:border-slate-800 ml-2.5 pl-5 space-y-6 py-2">
                {versions.map((ver, idx) => (
                  <div key={ver.id || idx} className="relative">
                    {/* Circle bullet */}
                    <span className="absolute -left-[27px] top-0.5 w-3 h-3 rounded-full bg-blue-500 dark:bg-blue-400 border-2 border-white dark:border-slate-900 ring-4 ring-blue-500/10 shadow-sm" />

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black text-slate-900 dark:text-slate-100 font-mono">
                          v{ver.version}
                        </span>
                        {idx === 0 && (
                          <span className="text-[8px] bg-emerald-50 dark:bg-emerald-955/25 text-emerald-600 dark:text-emerald-400 font-extrabold px-1.5 py-0.5 rounded border border-emerald-150 dark:border-emerald-900/30 uppercase tracking-wider">
                            Aktuell aktiv
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(ver.updated_at)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-650 dark:text-slate-400 leading-relaxed font-medium">
                        {ver.changelog}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-150 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 flex flex-col sm:flex-row justify-between items-center text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wide gap-2">
          <span>Persistenz: SQLite (data/gpx_library.db)</span>
          {(() => {
            const bDate = (typeof process !== 'undefined' && process.env && (process.env as any).VITE_BUILD_DATE) || '';
            return bDate ? (
              <span className="font-mono text-[9px] lowercase normal-case">build: {bDate}</span>
            ) : null;
          })()}
          <span>© 2026 GPX Route Master</span>
        </div>
      </motion.div>
    </div>
  );
};
