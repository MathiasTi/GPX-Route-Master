import React, { useCallback } from 'react';
import { Plus, Minus } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';
import {
  FINE_ZOOM_STEP,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  STANDARD_ZOOM_STEP,
  ZoomStep,
  isAtMaxZoom,
  isAtMinZoom
} from '../utils/mapZoom';

interface MapZoomControlsProps {
  currentZoom: number;
  minZoom?: number;
  maxZoom?: number;
  onZoomStep: (direction: 'in' | 'out', step: ZoomStep) => void;
  className?: string;
  idPrefix?: string;
}

export const MapZoomControls: React.FC<MapZoomControlsProps> = ({
  currentZoom,
  minZoom = MAP_MIN_ZOOM,
  maxZoom = MAP_MAX_ZOOM,
  onZoomStep,
  className = '',
  idPrefix = ''
}) => {
  const atMax = isAtMaxZoom(currentZoom, maxZoom);
  const atMin = isAtMinZoom(currentZoom, minZoom);

  const stopEvent = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  const handleZoomIn = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();
      if (atMax) return;
      triggerHaptic('light');
      const step: ZoomStep = e.shiftKey || e.altKey ? FINE_ZOOM_STEP : STANDARD_ZOOM_STEP;
      onZoomStep('in', step);
    },
    [atMax, onZoomStep]
  );

  const handleZoomOut = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();
      if (atMin) return;
      triggerHaptic('light');
      const step: ZoomStep = e.shiftKey || e.altKey ? FINE_ZOOM_STEP : STANDARD_ZOOM_STEP;
      onZoomStep('out', step);
    },
    [atMin, onZoomStep]
  );

  return (
    <div
      className={`flex flex-col rounded-2xl bg-white/95 dark:bg-slate-900/95 border border-slate-200/80 dark:border-slate-800 shadow-xl backdrop-blur-md overflow-hidden select-none pointer-events-auto ${className}`}
      role="group"
      aria-label="Karten-Zoom-Steuerung"
      onClick={stopEvent}
      onDoubleClick={stopEvent}
      onMouseDown={stopEvent}
      onTouchStart={stopEvent}
      onPointerDown={stopEvent}
      onWheel={stopEvent}
    >
      <button
        type="button"
        onClick={handleZoomIn}
        onMouseDown={stopEvent}
        onTouchStart={stopEvent}
        disabled={atMax}
        className="w-11 h-11 flex items-center justify-center border-b border-slate-200/80 dark:border-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-indigo-600 active:text-white dark:active:bg-indigo-600 disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:disabled:hover:bg-transparent transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 touch-manipulation"
        title="Karte vergrößern · Shift- oder Alt-Klick für Feinzoom"
        aria-label="Karte vergrößern"
        id={`${idPrefix}btn-zoom-in`}
      >
        <Plus className="w-5 h-5 stroke-[2.5]" />
      </button>

      <button
        type="button"
        onClick={handleZoomOut}
        onMouseDown={stopEvent}
        onTouchStart={stopEvent}
        disabled={atMin}
        className="w-11 h-11 flex items-center justify-center text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-indigo-600 active:text-white dark:active:bg-indigo-600 disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:disabled:hover:bg-transparent transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 touch-manipulation"
        title="Karte verkleinern · Shift- oder Alt-Klick für Feinzoom"
        aria-label="Karte verkleinern"
        id={`${idPrefix}btn-zoom-out`}
      >
        <Minus className="w-5 h-5 stroke-[2.5]" />
      </button>
    </div>
  );
};
