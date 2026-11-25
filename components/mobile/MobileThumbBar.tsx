import React from 'react';
import { Layers, BarChart2, Compass, Sparkles, Route, Navigation } from 'lucide-react';
import { triggerHaptic } from '../../utils/haptics';

export interface MobileThumbBarProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  hasTrack: boolean;
  isProfileCollapsed: boolean;
  onToggleProfile: () => void;
  mobileProfileSnap?: 'mini' | 'standard' | 'expanded';
  is3D: boolean;
  onToggle3D: () => void;
  onFitTrack: () => void;
  onOpenAnalytics: () => void;
  isCockpitOpen?: boolean;
  trackCount?: number;
  visibleTrackCount?: number;
  isRoutePlannerActive?: boolean;
  onToggleRoutePlanner?: () => void;
  isLiveNavActive?: boolean;
  onToggleLiveNav?: () => void;
}

/**
 * Contextual floating map action rail for mobile & tablet (< lg).
 * Anchored top-left on the map canvas so it never collides with the persistent
 * bottom navigation bar, the draggable elevation sheet, or bottom-right zoom controls.
 */
export const MobileThumbBar: React.FC<MobileThumbBarProps> = React.memo(({
  isSidebarOpen,
  onToggleSidebar,
  hasTrack,
  isProfileCollapsed,
  onToggleProfile,
  is3D,
  onToggle3D,
  onOpenAnalytics,
  isCockpitOpen = false,
  trackCount,
  visibleTrackCount,
  isRoutePlannerActive = false,
  onToggleRoutePlanner,
  isLiveNavActive = false,
  onToggleLiveNav
}) => {
  return (
    <div
      id="mobile-thumb-bar"
      role="toolbar"
      aria-label="Karten-Schnellaktionen"
      className="lg:hidden absolute top-2 left-2 z-[430] flex flex-col items-center gap-1.5 pointer-events-none select-none"
    >
      <div className="pointer-events-auto flex flex-col bg-white/98 dark:bg-slate-900/98 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-lg overflow-hidden divide-y divide-slate-200/70 dark:divide-slate-800 mobile-contain">
        {/* 1. Tracks Drawer */}
        <button
          id="mobile-thumb-tracks"
          type="button"
          aria-label={`Streckenliste öffnen (${trackCount ?? 0} Strecken)`}
          aria-pressed={isSidebarOpen}
          onClick={() => {
            triggerHaptic('light');
            onToggleSidebar();
          }}
          className={`relative min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors touch-manipulation active:scale-95 cursor-pointer ${
            isSidebarOpen
              ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400'
              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
          title="Strecken & Mediathek"
        >
          <Layers size={19} />
          {trackCount !== undefined && trackCount > 0 && (
            <span className="absolute top-1 right-1 font-mono tabular-nums text-[9px] font-bold leading-none text-indigo-600 dark:text-indigo-300">
              {visibleTrackCount !== undefined && visibleTrackCount !== trackCount
                ? `${visibleTrackCount}`
                : trackCount > 99 ? '99+' : trackCount}
            </span>
          )}
        </button>

        {/* 2. Tap-to-Route Planner */}
        {onToggleRoutePlanner && (
          <button
            id="mobile-thumb-route"
            type="button"
            aria-label="Routenplaner umschalten"
            aria-pressed={isRoutePlannerActive}
            onClick={() => {
              triggerHaptic('light');
              onToggleRoutePlanner();
            }}
            className={`min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors touch-manipulation active:scale-95 cursor-pointer ${
              isRoutePlannerActive
                ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
            title="Route auf Karte planen"
          >
            <Route size={19} />
          </button>
        )}

        {/* 2b. Live GPS Follow-Track Navigation */}
        {hasTrack && onToggleLiveNav && (
          <button
            id="mobile-thumb-live-nav"
            type="button"
            aria-label={isLiveNavActive ? 'Live-Navigation beenden' : 'Live GPS-Navigation starten'}
            aria-pressed={isLiveNavActive}
            onClick={() => {
              triggerHaptic('medium');
              onToggleLiveNav();
            }}
            className={`min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors touch-manipulation active:scale-95 cursor-pointer ${
              isLiveNavActive
                ? 'bg-indigo-600 text-white'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
            title="Track live abfahren / folgen"
          >
            <Navigation size={19} />
          </button>
        )}

        {/* 3. Elevation Profile Sheet Toggle */}
        {hasTrack && (
          <button
            id="mobile-thumb-profile"
            type="button"
            aria-label={isProfileCollapsed ? 'Höhenprofil einblenden' : 'Höhenprofil ausblenden'}
            aria-pressed={!isProfileCollapsed}
            onClick={() => {
              triggerHaptic('light');
              onToggleProfile();
            }}
            className={`min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors touch-manipulation active:scale-95 cursor-pointer ${
              !isProfileCollapsed
                ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
            title="Höhenprofil"
          >
            <BarChart2 size={19} />
          </button>
        )}

        {/* 4. 3D Terrain Toggle */}
        <button
          id="mobile-thumb-3d"
          type="button"
          aria-label="3D Gelände-Modus umschalten"
          aria-pressed={is3D}
          onClick={() => {
            triggerHaptic('light');
            onToggle3D();
          }}
          className={`min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors touch-manipulation active:scale-95 cursor-pointer ${
            is3D
              ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
          title="3D Gelände"
        >
          <Compass size={19} />
        </button>

        {/* 5. Analysis Cockpit */}
        {hasTrack && (
          <button
            id="mobile-thumb-analytics"
            type="button"
            aria-label="Analyse-Cockpit öffnen"
            aria-pressed={isCockpitOpen}
            onClick={() => {
              triggerHaptic('light');
              onOpenAnalytics();
            }}
            className={`min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors touch-manipulation active:scale-95 cursor-pointer ${
              isCockpitOpen
                ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
            title="Analyse-Cockpit"
          >
            <Sparkles size={18} />
          </button>
        )}
      </div>
    </div>
  );
});
