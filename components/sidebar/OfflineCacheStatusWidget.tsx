import React, { useState, useEffect, useCallback } from 'react';
import { 
  HardDrive, 
  Map as MapIcon, 
  Route, 
  RefreshCw, 
  CheckCircle2, 
  Wifi, 
  WifiOff, 
  ChevronDown, 
  ChevronUp, 
  Trash2,
  Database,
  X
} from 'lucide-react';
import { GPXTrack } from '../../types';
import { 
  OfflineStatusSnapshot, 
  getOfflineStatusSnapshot, 
  purgeTileCache 
} from '../../services/offlineCacheService';
import { 
  formatStorageSize, 
  getStorageWarningLevel 
} from '../../domain/offline/offlineCacheEngine';
import { triggerHaptic } from '../../utils/haptics';

interface OfflineCacheStatusWidgetProps {
  readonly tracks: readonly GPXTrack[];
  readonly isOnline: boolean;
  readonly onClose?: () => void;
}

export const OfflineCacheStatusWidget: React.FC<OfflineCacheStatusWidgetProps> = ({
  tracks,
  isOnline,
  onClose
}) => {
  const [snapshot, setSnapshot] = useState<OfflineStatusSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);

  const fetchStatus = useCallback(async (showIndicator = true) => {
    if (showIndicator) setIsLoading(true);
    const result = await getOfflineStatusSnapshot(tracks, isOnline);
    if (result.success) {
      setSnapshot(result.data);
    }
    if (showIndicator) setIsLoading(false);
  }, [tracks, isOnline]);

  useEffect(() => {
    fetchStatus(false);
    const interval = window.setInterval(() => {
      fetchStatus(false);
    }, 15000); // Periodic 15s refresh

    return () => window.clearInterval(interval);
  }, [fetchStatus]);

  const handleManualRefresh = () => {
    triggerHaptic('light');
    fetchStatus(true);
  };

  const handleClearTiles = async () => {
    triggerHaptic('medium');
    setIsClearing(true);
    await purgeTileCache();
    await fetchStatus(true);
    setIsClearing(false);
  };

  const usagePercent = snapshot?.quota.usagePercentage ?? 0;
  const warningLevel = getStorageWarningLevel(usagePercent);

  const progressBarColor = 
    warningLevel === 'critical' ? 'bg-rose-500' :
    warningLevel === 'elevated' ? 'bg-amber-500' : 
    'bg-emerald-500';

  const syncBadgeConfig = {
    synced: {
      text: 'Synchronisiert',
      bg: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      dot: 'bg-emerald-500'
    },
    syncing: {
      text: 'Synchronisiere...',
      bg: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300 border-sky-200 dark:border-sky-800',
      dot: 'bg-sky-500'
    },
    offline: {
      text: 'Offline-Betrieb',
      bg: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800',
      dot: 'bg-amber-500'
    },
    empty: {
      text: 'Bereit',
      bg: 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700',
      dot: 'bg-slate-400'
    },
    stale: {
      text: 'Aktualisierung nötig',
      bg: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800',
      dot: 'bg-amber-500'
    }
  }[snapshot?.syncState ?? 'empty'];

  return (
    <div 
      id="offline-cache-status-widget"
      className="mx-3 my-2 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 backdrop-blur-xs text-xs select-none shadow-xs transition-all"
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="p-1 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/40">
            <HardDrive size={13} />
          </div>
          <span className="font-semibold text-slate-800 dark:text-slate-200 tracking-tight text-[11px] truncate">
            Offline-Speicher
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Status Badge */}
          <span 
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${syncBadgeConfig.bg}`}
            title={`Status: ${syncBadgeConfig.text}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${syncBadgeConfig.dot} animate-pulse`} />
            <span>{syncBadgeConfig.text}</span>
          </span>

          {/* Refresh Button */}
          <button
            onClick={handleManualRefresh}
            disabled={isLoading}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
            title="Speicherstatus & Cache-Zähler aktualisieren"
            aria-label="Cache-Status aktualisieren"
          >
            <RefreshCw size={11} className={isLoading ? 'animate-spin text-indigo-600' : ''} />
          </button>

          {/* Close / Hide Button */}
          {onClose && (
            <button
              onClick={() => {
                triggerHaptic('light');
                onClose();
              }}
              className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Offline-Speicher ausblenden"
              aria-label="Offline-Speicher schließen"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Storage Quota Progress Bar */}
      <div className="mt-2">
        <div className="flex justify-between items-center text-[10px] text-slate-500 dark:text-slate-400 mb-1">
          <span className="font-medium">Belegungsgrad:</span>
          <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
            {snapshot ? formatStorageSize(snapshot.quota.usageBytes) : '...'} / {snapshot ? formatStorageSize(snapshot.quota.quotaBytes) : '...'} ({usagePercent}%)
          </span>
        </div>
        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div 
            className={`h-full ${progressBarColor} transition-all duration-500 ease-out`}
            style={{ width: `${Math.max(1, Math.min(100, usagePercent))}%` }}
          />
        </div>
      </div>

      {/* Synchronized Resources: Map Tiles & Route Tracks */}
      <div className="grid grid-cols-2 gap-1.5 mt-2">
        {/* Tiles Metric Box */}
        <div className="p-1.5 rounded-lg bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50 flex items-center gap-1.5">
          <MapIcon size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="min-w-0 leading-tight">
            <div className="font-semibold text-slate-700 dark:text-slate-200 text-[10px] truncate">
              {snapshot ? snapshot.tileCount.toLocaleString() : '0'} Kacheln
            </div>
            <div className="text-[9px] text-slate-400 dark:text-slate-500 truncate">
              Karten-Cache
            </div>
          </div>
        </div>

        {/* Tracks Metric Box */}
        <div className="p-1.5 rounded-lg bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50 flex items-center gap-1.5">
          <Route size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
          <div className="min-w-0 leading-tight">
            <div className="font-semibold text-slate-700 dark:text-slate-200 text-[10px] truncate">
              {snapshot ? snapshot.trackCount : tracks.length} Touren
            </div>
            <div className="text-[9px] text-slate-400 dark:text-slate-500 truncate">
              {snapshot ? `${(snapshot.totalPoints / 1000).toFixed(1)}k Pkt.` : '0 Pkt.'}
            </div>
          </div>
        </div>
      </div>

      {/* Collapsible Cache Management Tray */}
      <div className="mt-1 pt-1 border-t border-slate-100 dark:border-slate-800/60">
        <button
          onClick={() => {
            triggerHaptic('light');
            setIsExpanded(prev => !prev);
          }}
          className="w-full flex items-center justify-between text-[9px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 py-0.5 cursor-pointer"
        >
          <span className="flex items-center gap-1 font-medium">
            {isOnline ? (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Wifi size={10} /> PWA Online
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <WifiOff size={10} /> PWA Offline-Modus
              </span>
            )}
          </span>
          <span className="flex items-center gap-0.5">
            Details {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </span>
        </button>

        {isExpanded && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-1.5 text-[9px] text-slate-500 dark:text-slate-400">
            <div className="flex justify-between items-center">
              <span>Strecken-Payload:</span>
              <span className="font-mono text-slate-600 dark:text-slate-300 font-semibold">
                {snapshot ? formatStorageSize(snapshot.tracksPayloadBytes) : '0 B'}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span>PWA App-Shell:</span>
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 size={10} /> Im Cache
              </span>
            </div>

            {/* Clear Tile Cache Action */}
            <div className="pt-1">
              <button
                onClick={handleClearTiles}
                disabled={isClearing || !snapshot || snapshot.tileCount === 0}
                className="w-full flex items-center justify-center gap-1 px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-600 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-700 hover:border-rose-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title="Gecachte Offline-Kartenkacheln freigeben"
              >
                <Trash2 size={10} />
                <span>{isClearing ? 'Bereinige...' : 'Karten-Cache leeren'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
