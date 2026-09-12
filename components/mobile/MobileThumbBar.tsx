import React from 'react';
import { Layers, BarChart2, Compass, Activity, Focus } from 'lucide-react';
import { triggerHaptic } from '../../utils/haptics';

export interface MobileThumbBarProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  hasTrack: boolean;
  isProfileCollapsed: boolean;
  onToggleProfile: () => void;
  is3D: boolean;
  onToggle3D: () => void;
  onFitTrack: () => void;
  onOpenAnalytics: () => void;
  trackCount?: number;
  visibleTrackCount?: number;
}

export const MobileThumbBar: React.FC<MobileThumbBarProps> = ({
  isSidebarOpen,
  onToggleSidebar,
  hasTrack,
  isProfileCollapsed,
  onToggleProfile,
  is3D,
  onToggle3D,
  onFitTrack,
  onOpenAnalytics,
  trackCount,
  visibleTrackCount
}) => {
  return (
    <nav
      id="mobile-thumb-bar"
      aria-label="Mobile Schnellzugriff"
      className="sm:hidden fixed bottom-2 left-3 right-3 z-[95] bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-2xl px-1.5 py-1 flex items-center justify-around text-white select-none pb-[calc(0.45rem+env(safe-area-inset-bottom,0px))]"
    >
      {/* 1. Tracklist / Sidebar */}
      <button
        id="mobile-thumb-tracks"
        type="button"
        aria-label={`Streckenliste öffnen (${trackCount ?? 0} Strecken)`}
        aria-pressed={isSidebarOpen}
        onClick={() => {
          triggerHaptic('light');
          onToggleSidebar();
        }}
        className={`relative flex flex-col items-center justify-center min-h-[48px] min-w-[50px] px-2 py-1.5 rounded-xl transition-all touch-manipulation active:scale-95 ${
          isSidebarOpen
            ? 'text-indigo-400 font-bold bg-indigo-500/25 ring-1 ring-indigo-400/40'
            : 'text-slate-300 hover:text-white hover:bg-white/5'
        }`}
        title="Strecken & Mediathek"
      >
        <div className="relative">
          <Layers size={20} />
          {trackCount !== undefined && trackCount > 0 && (
            <span className="absolute -top-1.5 -right-2.5 bg-indigo-500 text-white font-black text-[9px] min-w-[15px] h-[15px] rounded-full flex items-center justify-center px-0.5 shadow-sm">
              {visibleTrackCount !== undefined && visibleTrackCount !== trackCount
                ? `${visibleTrackCount}/${trackCount}`
                : trackCount}
            </span>
          )}
        </div>
        <span className="text-[9.5px] mt-0.5 font-semibold tracking-tight">Tracks</span>
      </button>

      {/* 2. Elevation Profile */}
      <button
        id="mobile-thumb-profile"
        type="button"
        disabled={!hasTrack}
        aria-label={isProfileCollapsed ? "Höhenprofil einblenden" : "Höhenprofil minimieren"}
        aria-pressed={!isProfileCollapsed}
        onClick={() => {
          triggerHaptic('light');
          onToggleProfile();
        }}
        className={`flex flex-col items-center justify-center min-h-[48px] min-w-[50px] px-2 py-1.5 rounded-xl transition-all touch-manipulation active:scale-95 ${
          !hasTrack
            ? 'opacity-30 cursor-not-allowed text-slate-500'
            : !isProfileCollapsed
            ? 'text-indigo-400 font-bold bg-indigo-500/25 ring-1 ring-indigo-400/40'
            : 'text-slate-300 hover:text-white hover:bg-white/5'
        }`}
        title="Höhenprofil ein/ausblenden"
      >
        <BarChart2 size={20} />
        <span className="text-[9.5px] mt-0.5 font-semibold tracking-tight">Profil</span>
      </button>

      {/* 3. Fit Map View */}
      <button
        id="mobile-thumb-fit"
        type="button"
        disabled={!hasTrack}
        aria-label="Aktive Strecke auf Karte zentrieren"
        onClick={() => {
          triggerHaptic('light');
          onFitTrack();
        }}
        className={`flex flex-col items-center justify-center min-h-[48px] min-w-[50px] px-2 py-1.5 rounded-xl transition-all touch-manipulation active:scale-95 ${
          !hasTrack
            ? 'opacity-30 cursor-not-allowed text-slate-500'
            : 'text-slate-300 hover:text-white hover:bg-white/5'
        }`}
        title="Strecke zentrieren"
      >
        <Focus size={20} />
        <span className="text-[9.5px] mt-0.5 font-semibold tracking-tight">Zentrieren</span>
      </button>

      {/* 4. 3D Terrain */}
      <button
        id="mobile-thumb-3d"
        type="button"
        aria-label="3D Gelände-Modus umschalten"
        aria-pressed={is3D}
        onClick={() => {
          triggerHaptic('light');
          onToggle3D();
        }}
        className={`flex flex-col items-center justify-center min-h-[48px] min-w-[50px] px-2 py-1.5 rounded-xl transition-all touch-manipulation active:scale-95 ${
          is3D
            ? 'text-amber-400 font-bold bg-amber-500/25 ring-1 ring-amber-400/40'
            : 'text-slate-300 hover:text-white hover:bg-white/5'
        }`}
        title="3D Gelände-Modus umschalten"
      >
        <Compass size={20} />
        <span className="text-[9.5px] mt-0.5 font-semibold tracking-tight">3D</span>
      </button>

      {/* 5. Analytics */}
      <button
        id="mobile-thumb-analytics"
        type="button"
        disabled={!hasTrack}
        aria-label="Ausführliche Datenanalyse öffnen"
        onClick={() => {
          triggerHaptic('light');
          onOpenAnalytics();
        }}
        className={`flex flex-col items-center justify-center min-h-[48px] min-w-[50px] px-2 py-1.5 rounded-xl transition-all touch-manipulation active:scale-95 ${
          !hasTrack
            ? 'opacity-30 cursor-not-allowed text-slate-500'
            : 'text-slate-300 hover:text-white hover:bg-white/5'
        }`}
        title="Analyse öffnen"
      >
        <Activity size={20} />
        <span className="text-[9.5px] mt-0.5 font-semibold tracking-tight">Analyse</span>
      </button>
    </nav>
  );
};
