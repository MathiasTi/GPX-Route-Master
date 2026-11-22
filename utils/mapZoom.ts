import { safeGetItem, safeSetItem } from './storage';

export const MAP_MIN_ZOOM = 3;
export const MAP_MAX_ZOOM = 19;

export const FINE_ZOOM_STEP = 0.25;
export const MEDIUM_ZOOM_STEP = 0.5;
export const STANDARD_ZOOM_STEP = 1;

export const ZOOM_STEP_OPTIONS = [FINE_ZOOM_STEP, MEDIUM_ZOOM_STEP, STANDARD_ZOOM_STEP] as const;
export type ZoomStep = (typeof ZOOM_STEP_OPTIONS)[number];

export const ZOOM_STEP_STORAGE_KEY = 'velo_map_zoom_step_v1';

export function roundZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MAP_MIN_ZOOM;
  return Math.round(zoom * 100) / 100;
}

export function clampZoom(
  zoom: number,
  minZoom: number = MAP_MIN_ZOOM,
  maxZoom: number = MAP_MAX_ZOOM
): number {
  if (!Number.isFinite(zoom)) return minZoom;
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}

export function computeNextZoom(
  currentZoom: number,
  direction: 'in' | 'out',
  step: number = FINE_ZOOM_STEP,
  minZoom: number = MAP_MIN_ZOOM,
  maxZoom: number = MAP_MAX_ZOOM
): number {
  const safeCurrent = Number.isFinite(currentZoom) ? currentZoom : minZoom;
  const safeStep = Number.isFinite(step) && step > 0 ? step : FINE_ZOOM_STEP;
  const delta = direction === 'in' ? safeStep : -safeStep;
  return roundZoom(clampZoom(safeCurrent + delta, minZoom, maxZoom));
}

export function parseZoomStep(raw: unknown): ZoomStep {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (num === FINE_ZOOM_STEP) return FINE_ZOOM_STEP;
  if (num === MEDIUM_ZOOM_STEP) return MEDIUM_ZOOM_STEP;
  if (num === STANDARD_ZOOM_STEP) return STANDARD_ZOOM_STEP;
  return FINE_ZOOM_STEP;
}

export function loadSavedZoomStep(): ZoomStep {
  return parseZoomStep(safeGetItem(ZOOM_STEP_STORAGE_KEY));
}

export function saveZoomStep(step: ZoomStep): void {
  safeSetItem(ZOOM_STEP_STORAGE_KEY, String(step));
}

export function getNextZoomStep(currentStep: ZoomStep): ZoomStep {
  const idx = ZOOM_STEP_OPTIONS.indexOf(currentStep);
  if (idx === -1) return FINE_ZOOM_STEP;
  return ZOOM_STEP_OPTIONS[(idx + 1) % ZOOM_STEP_OPTIONS.length];
}

export function formatZoomLevel(zoom: number): string {
  return clampZoom(zoom).toFixed(2);
}

export function formatZoomStep(step: ZoomStep): string {
  if (step === FINE_ZOOM_STEP) return '±0.25';
  if (step === MEDIUM_ZOOM_STEP) return '±0.5';
  return '±1';
}

export function getZoomStepLabel(step: ZoomStep): string {
  if (step === FINE_ZOOM_STEP) return 'Fein';
  if (step === MEDIUM_ZOOM_STEP) return 'Mittel';
  return 'Standard';
}

export function isAtMinZoom(zoom: number, minZoom: number = MAP_MIN_ZOOM): boolean {
  return !Number.isFinite(zoom) || zoom <= minZoom + 0.001;
}

export function isAtMaxZoom(zoom: number, maxZoom: number = MAP_MAX_ZOOM): boolean {
  return Number.isFinite(zoom) && zoom >= maxZoom - 0.001;
}

export function resolveEffectiveClickStep(activeStep: ZoomStep, shiftKey: boolean): ZoomStep {
  if (!shiftKey) return activeStep;
  return activeStep === FINE_ZOOM_STEP ? STANDARD_ZOOM_STEP : FINE_ZOOM_STEP;
}

export function resolveKeyboardZoomAction(event: {
  key: string;
  code?: string;
  altKey?: boolean;
}): { direction: 'in' | 'out'; step: number } | null {
  const isZoomInKey =
    event.key === '+' ||
    event.key === '=' ||
    event.key === 'Add' ||
    (Boolean(event.altKey) && (event.code === 'Equal' || event.code === 'NumpadAdd'));

  if (isZoomInKey) {
    return {
      direction: 'in',
      step: event.altKey ? FINE_ZOOM_STEP : STANDARD_ZOOM_STEP
    };
  }

  const isZoomOutKey =
    event.key === '-' ||
    event.key === '_' ||
    event.key === 'Subtract' ||
    (Boolean(event.altKey) && (event.code === 'Minus' || event.code === 'NumpadSubtract'));

  if (isZoomOutKey) {
    return {
      direction: 'out',
      step: event.altKey ? FINE_ZOOM_STEP : STANDARD_ZOOM_STEP
    };
  }

  return null;
}
