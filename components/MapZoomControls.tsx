import React, { useState, useCallback } from 'react';
import { Plus, Minus } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';
import {
  FINE_ZOOM_STEP,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  ZoomStep,
  formatZoomLevel,
  formatZoomStep,
  getNextZoomStep,
  getZoomStepLabel,
  isAtMaxZoom,
  isAtMinZoom,
  loadSavedZoomStep,
  resolveEffectiveClickStep,
  saveZoomStep
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
  const [zoomStep, setZoomStep] = useState<ZoomStep>(() => loadSavedZoomStep());

  const atMax = isAtMaxZoom(currentZoom, maxZoom);
  const atMin = isAtMinZoom(currentZoom, minZoom);
  const isFineStep = zoomStep === FINE_ZOOM_STEP;

  const stopEvent = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  const handleZoomIn = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();
      if (atMax) return;
      triggerHaptic('light');
      const effectiveStep = resolveEffectiveClickStep(zoomStep, e.shiftKey);
      onZoomStep('in', effectiveStep);
    },
    [atMax, zoomStep, onZoomStep]
  );

  const handleZoomOut = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();
      if (atMin) return;
      triggerHaptic('light');
      const effectiveStep = resolveEffectiveClickStep(zoomStep, e.shiftKey);
      onZoomStep('out', effectiveStep);
    },
    [atMin, zoomStep, onZoomStep]
  );

  const handleCycleStep = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();
      triggerHaptic('light');
      setZoomStep((prev) => {
        const next = getNextZoomStep(prev);
        saveZoomStep(next);
        return next;
      });
    },
    []
  );

  const stepLabel = getZoomStepLabel(zoomStep);
  const stepText = formatZoomStep(zoomStep);
  const zoomText = formatZoomLevel(currentZoom);

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
        className="w-12 h-11 flex items-center justify-center text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-indigo-600 active:text-white dark:active:bg-indigo-600 disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:disabled:hover:bg-transparent transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 touch-manipulation"
        title={`Karte vergrößern (+${zoomStep} · ${stepLabel}) · Tastatur: + oder Alt++`}
        aria-label={`Karte vergrößern (+${zoomStep})`}
        id={`${idPrefix}btn-zoom-in`}
      >
        <Plus className="w-5 h-5 stroke-[2.75]" />
      </button>

      <button
        type="button"
        onClick={handleCycleStep}
        onMouseDown={stopEvent}
        onTouchStart={stopEvent}
        className="w-12 py-1.5 px-1 flex flex-col items-center justify-center border-y border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 hover:bg-indigo-50/80 dark:hover:bg-indigo-950/40 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 touch-manipulation"
        title={`Zoomstufe ${zoomText} · Schrittweite: ${stepText} (${stepLabel}) – Klicken zum Wechseln (±0.25 / ±0.5 / ±1)`}
        aria-label={`Zoomstufe ${zoomText}, Schrittweite ${stepText} wechseln`}
        id={`${idPrefix}btn-zoom-step-toggle`}
      >
        <span
          className="font-mono tabular-nums text-[11px] font-black leading-none text-slate-800 dark:text-slate-100"
          data-testid="zoom-level-readout"
        >
          {zoomText}
        </span>
        <span
          className={`font-mono tabular-nums text-[9px] font-extrabold leading-none mt-1 ${
            isFineStep
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
          data-testid="zoom-step-readout"
        >
          {stepText}
        </span>
      </button>

      <button
        type="button"
        onClick={handleZoomOut}
        onMouseDown={stopEvent}
        onTouchStart={stopEvent}
        disabled={atMin}
        className="w-12 h-11 flex items-center justify-center text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-indigo-600 active:text-white dark:active:bg-indigo-600 disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:disabled:hover:bg-transparent transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 touch-manipulation"
        title={`Karte verkleinern (-${zoomStep} · ${stepLabel}) · Tastatur: - oder Alt+-`}
        aria-label={`Karte verkleinern (-${zoomStep})`}
        id={`${idPrefix}btn-zoom-out`}
      >
        <Minus className="w-5 h-5 stroke-[2.75]" />
      </button>
    </div>
  );
};
