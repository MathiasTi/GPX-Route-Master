import React, { useState } from 'react';
import {
  Bike,
  Compass,
  Footprints,
  Mountain,
  Undo2,
  ArrowLeftRight,
  Repeat,
  Trash2,
  Check,
  X,
  Route,
  Loader2,
  WifiOff,
  Waypoints,
  TrendingUp
} from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';
import {
  ROUTE_PROFILE_META,
  RoutePreview,
  RouteProfile,
  RouteWaypoint,
  formatRouteDuration
} from '../utils/routePlanner';

export interface RoutePlannerDockProps {
  profile: RouteProfile;
  onChangeProfile: (profile: RouteProfile) => void;
  snapToRoads: boolean;
  onToggleSnapToRoads: () => void;
  isSnapping?: boolean;
  snapFallbackNote?: string | null;
  waypoints: readonly RouteWaypoint[];
  preview: RoutePreview;
  canUndo: boolean;
  onUndo: () => void;
  onReverse: () => void;
  onCloseLoop: () => void;
  onClear: () => void;
  onSave: (options: { name: string; saveToPlannedLibrary: boolean }) => void;
  onClose: () => void;
  language?: 'de' | 'en';
  bottomOffsetClass?: string;
}

const PROFILE_BUTTONS: Array<{
  id: RouteProfile;
  icon: React.FC<{ size?: number }>;
  activeClass: string;
}> = [
  {
    id: 'road',
    icon: Bike,
    activeClass: 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
  },
  {
    id: 'gravel',
    icon: Compass,
    activeClass: 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow-xs'
  },
  {
    id: 'mtb',
    icon: Mountain,
    activeClass: 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-xs'
  },
  {
    id: 'running',
    icon: Footprints,
    activeClass: 'bg-white dark:bg-slate-900 text-orange-600 dark:text-orange-300 shadow-xs'
  }
];

export const RoutePlannerDock: React.FC<RoutePlannerDockProps> = React.memo(({
  profile,
  onChangeProfile,
  snapToRoads,
  onToggleSnapToRoads,
  isSnapping = false,
  snapFallbackNote = null,
  waypoints,
  preview,
  canUndo,
  onUndo,
  onReverse,
  onCloseLoop,
  onClear,
  onSave,
  onClose,
  language = 'de',
  bottomOffsetClass = 'bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] lg:bottom-4'
}) => {
  const [customName, setCustomName] = useState('');
  const [saveToPlannedLibrary, setSaveToPlannedLibrary] = useState(true);
  const isEn = language === 'en';
  const canSave = waypoints.length >= 2;
  const activeMeta = ROUTE_PROFILE_META[profile] || ROUTE_PROFILE_META.road;

  return (
    <div
      id="route-planner-dock"
      role="region"
      aria-label={isEn ? 'Tap-to-Route Planner' : 'Routenplaner'}
      className={`absolute ${bottomOffsetClass} left-2 right-2 sm:left-4 sm:right-auto sm:w-[404px] z-[460] bg-white/98 dark:bg-slate-900/98 lg:backdrop-blur-md border border-slate-200/90 dark:border-slate-700/90 rounded-2xl shadow-2xl p-3 text-slate-900 dark:text-slate-100 pointer-events-auto select-none map-overlay-layer`}
    >
      {/* Row 1: Header + Snap/Direct Toggle + Close */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Route
            size={16}
            style={{ color: activeMeta.colorHex }}
            className="shrink-0"
          />
          <span className="text-xs font-bold tracking-tight truncate">
            {isEn ? 'Route Planner' : 'Routenplaner'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Snap to Roads/Trails vs Direct Toggle */}
          <button
            id="btn-route-snap-toggle"
            type="button"
            aria-pressed={snapToRoads}
            onClick={() => {
              triggerHaptic('light');
              onToggleSnapToRoads();
            }}
            title={
              snapToRoads
                ? isEn
                  ? 'Snapping to OSM roads & trails (tap for direct line)'
                  : 'Folgt Straßen & Wegen via OSM (tippen für Luftlinie)'
                : isEn
                ? 'Direct point-to-point mode (tap to snap to roads)'
                : 'Direktlinie / Offline-Modus (tippen für Straßen-Routing)'
            }
            className={`min-h-[36px] sm:min-h-[32px] px-2.5 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer touch-manipulation whitespace-nowrap ${
              snapToRoads
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/80'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
            }`}
          >
            {isSnapping ? (
              <Loader2 size={13} className="animate-spin shrink-0" />
            ) : (
              <Waypoints size={13} className="shrink-0" />
            )}
            <span>
              {snapToRoads
                ? isEn
                  ? 'Road Snap'
                  : 'Wege-Snap'
                : isEn
                ? 'Direct'
                : 'Luftlinie'}
            </span>
          </button>

          <button
            id="btn-route-planner-close"
            type="button"
            onClick={() => {
              triggerHaptic('light');
              onClose();
            }}
            aria-label={isEn ? 'Close route planner' : 'Routenplaner schließen'}
            className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] -mr-1.5 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer touch-manipulation"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Row 2: 4-Profile Segmented Selector (Road / Gravel / MTB / Running) */}
      <div
        className="mt-2 grid grid-cols-4 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/70"
        role="group"
        aria-label={isEn ? 'Routing profile' : 'Routenprofil'}
      >
        {PROFILE_BUTTONS.map(({ id, icon: Icon, activeClass }) => {
          const meta = ROUTE_PROFILE_META[id];
          const isActive = profile === id;
          return (
            <button
              key={id}
              id={`btn-route-profile-${id}`}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                triggerHaptic('light');
                onChangeProfile(id);
              }}
              className={`min-h-[38px] sm:min-h-[32px] px-1.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer touch-manipulation whitespace-nowrap ${
                isActive
                  ? activeClass
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Icon size={13} />
              <span className="truncate">{isEn ? meta.labelEn : meta.labelDe}</span>
            </button>
          );
        })}
      </div>

      {/* Row 3: Live Metrics Strip (unboxed tabular metadata with · separators) */}
      <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        {waypoints.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
            {isEn
              ? 'Tap on the map to place start and waypoints. Roads & trails snap automatically.'
              : 'Tippe auf die Karte für Start & Wegpunkte. Straßen & Wege rasten automatisch ein.'}
          </p>
        ) : waypoints.length === 1 ? (
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug">
            {isEn
              ? 'Start point placed · Tap again to route to your next point.'
              : 'Startpunkt gesetzt · Tippe weiter für den nächsten Wegpunkt.'}
          </p>
        ) : (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-200">
              <span className="font-bold text-slate-950 dark:text-white">
                {preview.totalDistanceKm.toFixed(2)} km
              </span>
              {(preview.elevationAvailable || preview.ascentM > 0) && (
                <>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="inline-flex items-center gap-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
                    <TrendingUp size={12} />
                    +{Math.round(preview.ascentM)} m
                  </span>
                </>
              )}
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
              <span>~{formatRouteDuration(preview.estimatedDurationSec)}</span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
              <span>
                {profile === 'running'
                  ? preview.pacePerKmFormatted
                  : `${preview.estimatedSpeedKmh.toFixed(0)} km/h`}
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
              <span className="text-slate-500 dark:text-slate-400">
                {waypoints.length} {isEn ? 'pts' : 'Pkt'}
              </span>
            </div>

            {isSnapping && (
              <div className="flex items-center gap-1.5 text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                <Loader2 size={12} className="animate-spin shrink-0" />
                <span>
                  {isEn ? 'Snapping to OSM roads & trails…' : 'Berechne Route über Straßen & Wege…'}
                </span>
              </div>
            )}

            {!isSnapping && snapFallbackNote && (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                <WifiOff size={12} className="shrink-0" />
                <span className="truncate">{snapFallbackNote}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row 4: Optional Route Name + Save to Planned Tours toggle (shown once >= 2 waypoints) */}
      {canSave && (
        <div className="mt-2.5 flex flex-col gap-2">
          <input
            id="input-route-planner-name"
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder={
              isEn
                ? `Name (e.g. Morning ${activeMeta.labelEn})`
                : `Routenname (optional, z.B. Hausrunde)`
            }
            className="w-full min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
          <label className="inline-flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={saveToPlannedLibrary}
              onChange={(e) => setSaveToPlannedLibrary(e.target.checked)}
              className="w-4 h-4 rounded accent-emerald-600 cursor-pointer"
            />
            <span>
              {isEn ? 'Also save in Planned Tours library' : 'Auch in „Geplante Touren“ speichern'}
            </span>
          </label>
        </div>
      )}

      {/* Row 5: One-handed Action Bar (44px+ hitboxes on mobile) */}
      <div className="mt-2.5 flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1">
          <button
            id="btn-route-undo"
            type="button"
            disabled={!canUndo}
            onClick={() => {
              triggerHaptic('light');
              onUndo();
            }}
            title={isEn ? 'Undo last point' : 'Letzten Punkt rückgängig'}
            aria-label={isEn ? 'Undo last point' : 'Rückgängig'}
            className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer touch-manipulation active:scale-95"
          >
            <Undo2 size={16} />
          </button>
          <button
            id="btn-route-reverse"
            type="button"
            disabled={waypoints.length < 2}
            onClick={() => {
              triggerHaptic('light');
              onReverse();
            }}
            title={isEn ? 'Reverse route direction' : 'Richtung umkehren'}
            aria-label={isEn ? 'Reverse route' : 'Richtung umkehren'}
            className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer touch-manipulation active:scale-95"
          >
            <ArrowLeftRight size={16} />
          </button>
          <button
            id="btn-route-close-loop"
            type="button"
            disabled={waypoints.length < 2}
            onClick={() => {
              triggerHaptic('light');
              onCloseLoop();
            }}
            title={isEn ? 'Close loop back to start' : 'Rundkurs zum Start schließen'}
            aria-label={isEn ? 'Close loop' : 'Rundkurs schließen'}
            className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer touch-manipulation active:scale-95"
          >
            <Repeat size={16} />
          </button>
          <button
            id="btn-route-clear"
            type="button"
            disabled={waypoints.length === 0}
            onClick={() => {
              triggerHaptic('light');
              onClear();
            }}
            title={isEn ? 'Clear all waypoints' : 'Alle Wegpunkte löschen'}
            aria-label={isEn ? 'Clear waypoints' : 'Leeren'}
            className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer touch-manipulation active:scale-95"
          >
            <Trash2 size={16} />
          </button>
        </div>

        <button
          id="btn-route-save"
          type="button"
          disabled={!canSave || isSnapping}
          onClick={() => {
            triggerHaptic('medium');
            onSave({ name: customName, saveToPlannedLibrary });
            setCustomName('');
          }}
          style={canSave && !isSnapping ? { backgroundColor: activeMeta.colorHex } : undefined}
          className={`min-h-[44px] sm:min-h-[36px] px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer touch-manipulation active:scale-95 whitespace-nowrap ${
            canSave && !isSnapping
              ? 'text-white shadow-md hover:brightness-95'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
          }`}
        >
          <Check size={15} />
          <span>{isEn ? 'Save Route' : 'Übernehmen'}</span>
        </button>
      </div>
    </div>
  );
});
