import React, { useState } from 'react';
import { BarChart2, Compass, Sparkles, Route, Navigation, Target, MoreHorizontal } from 'lucide-react';
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
 * Compact 3-button contextual floating rail for mobile & tablet (< lg).
 * Houses primary map actions directly and groups secondary actions into a clean popover menu.
 */
export const MobileThumbBar: React.FC<MobileThumbBarProps> = React.memo(({
  hasTrack,
  isProfileCollapsed,
  onToggleProfile,
  is3D,
  onToggle3D,
  onFitTrack,
  onOpenAnalytics,
  isCockpitOpen = false,
  isRoutePlannerActive = false,
  onToggleRoutePlanner,
  isLiveNavActive = false,
  onToggleLiveNav
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div
      id="mobile-thumb-bar"
      role="toolbar"
      aria-label="Karten-Schnellaktionen"
      className={`lg:hidden absolute top-2 left-2 ${isMenuOpen ? 'z-[480]' : 'z-[430]'} flex flex-col items-start gap-1.5 pointer-events-none select-none`}
    >
      <div className="relative pointer-events-auto flex items-start gap-2">
        <div className="flex flex-col bg-white/98 dark:bg-slate-900/98 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-lg overflow-hidden divide-y divide-slate-200/70 dark:divide-slate-800 mobile-contain">
          {/* 1. Tap-to-Route Planner */}
          {onToggleRoutePlanner && (
            <button
              id="mobile-thumb-route"
              type="button"
              aria-label="Routenplaner umschalten"
              aria-pressed={isRoutePlannerActive}
              onClick={() => {
                triggerHaptic('light');
                setIsMenuOpen(false);
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

          {/* 2. Elevation Profile Sheet Toggle */}
          {hasTrack && (
            <button
              id="mobile-thumb-profile"
              type="button"
              aria-label={isProfileCollapsed ? 'Höhenprofil einblenden' : 'Höhenprofil ausblenden'}
              aria-pressed={!isProfileCollapsed}
              onClick={() => {
                triggerHaptic('light');
                setIsMenuOpen(false);
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

          {/* 3. More Map Actions Menu Trigger */}
          <button
            id="mobile-thumb-more"
            type="button"
            aria-label="Weitere Karten-Aktionen"
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
            onClick={() => {
              triggerHaptic('light');
              setIsMenuOpen((prev) => !prev);
            }}
            className={`relative min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors touch-manipulation active:scale-95 cursor-pointer ${
              isMenuOpen || isLiveNavActive || is3D
                ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
            title="Live-Navigation, 3D & Cockpit"
          >
            <MoreHorizontal size={19} />
            {(isLiveNavActive || is3D) && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
            )}
          </button>
        </div>

        {isMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-[475]"
              onClick={() => setIsMenuOpen(false)}
              aria-hidden="true"
            />
            <div
              role="menu"
              className="relative z-[485] w-52 bg-white/98 dark:bg-slate-900/98 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-2xl p-1.5 space-y-0.5 text-xs mobile-contain"
            >
              {hasTrack && onToggleLiveNav && (
                <button
                  id="mobile-thumb-live-nav"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    triggerHaptic('medium');
                    setIsMenuOpen(false);
                    onToggleLiveNav();
                  }}
                  className={`w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center justify-between font-bold transition-colors touch-manipulation cursor-pointer ${
                    isLiveNavActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Navigation size={16} />
                    <span>{isLiveNavActive ? 'Navigation beenden' : 'Live-Navigation'}</span>
                  </span>
                </button>
              )}

              <button
                id="mobile-thumb-3d"
                type="button"
                role="menuitem"
                onClick={() => {
                  triggerHaptic('light');
                  setIsMenuOpen(false);
                  onToggle3D();
                }}
                className={`w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center justify-between font-bold transition-colors touch-manipulation cursor-pointer ${
                  is3D
                    ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Compass size={16} />
                  <span>3D-Gelände</span>
                </span>
                {is3D && <span className="text-[10px] font-mono">AKTIV</span>}
              </button>

              {hasTrack && (
                <>
                  <button
                    id="mobile-thumb-analytics"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      triggerHaptic('light');
                      setIsMenuOpen(false);
                      onOpenAnalytics();
                    }}
                    className={`w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center gap-2.5 font-bold transition-colors touch-manipulation cursor-pointer ${
                      isCockpitOpen
                        ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Sparkles size={16} className="text-indigo-500" />
                    <span>Analyse-Cockpit</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      triggerHaptic('light');
                      setIsMenuOpen(false);
                      onFitTrack();
                    }}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center gap-2.5 font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors touch-manipulation cursor-pointer"
                  >
                    <Target size={16} className="text-amber-500" />
                    <span>Route zentrieren</span>
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
});
