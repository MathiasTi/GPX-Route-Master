import {
  FINE_ZOOM_STEP,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  MEDIUM_ZOOM_STEP,
  STANDARD_ZOOM_STEP,
  clampZoom,
  computeNextZoom,
  formatZoomLevel,
  formatZoomStep,
  getNextZoomStep,
  getZoomStepLabel,
  isAtMaxZoom,
  isAtMinZoom,
  parseZoomStep,
  resolveEffectiveClickStep,
  resolveKeyboardZoomAction
} from '../utils/mapZoom';

export function runMapZoomTests(): boolean {
  console.log('🧪 Running Fine-Grained Map Zoom Controls Test Suite...');
  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      passed++;
      console.log(`  ✅ [PASS] ${msg}`);
    } else {
      failed++;
      console.error(`  ❌ [FAIL] ${msg}`);
    }
  };

  // Test 1: Fine-grained ±0.25 increments and decrements
  assert(
    computeNextZoom(12, 'in', FINE_ZOOM_STEP) === 12.25,
    'Zooms in by fine step +0.25 (12 -> 12.25)'
  );
  assert(
    computeNextZoom(12.25, 'in', FINE_ZOOM_STEP) === 12.5,
    'Zooms in sequentially by +0.25 (12.25 -> 12.5)'
  );
  assert(
    computeNextZoom(12.5, 'out', FINE_ZOOM_STEP) === 12.25,
    'Zooms out by fine step -0.25 (12.5 -> 12.25)'
  );
  assert(
    computeNextZoom(13, 'in', MEDIUM_ZOOM_STEP) === 13.5,
    'Zooms in by medium step +0.5 (13 -> 13.5)'
  );
  assert(
    computeNextZoom(13, 'out', STANDARD_ZOOM_STEP) === 12,
    'Zooms out by standard step -1 (13 -> 12)'
  );

  // Test 2: Clamping at min/max bounds
  assert(
    computeNextZoom(MAP_MAX_ZOOM - 0.1, 'in', FINE_ZOOM_STEP) === MAP_MAX_ZOOM,
    `Clamps zoom in cleanly at MAP_MAX_ZOOM (${MAP_MAX_ZOOM})`
  );
  assert(
    computeNextZoom(MAP_MIN_ZOOM + 0.1, 'out', FINE_ZOOM_STEP) === MAP_MIN_ZOOM,
    `Clamps zoom out cleanly at MAP_MIN_ZOOM (${MAP_MIN_ZOOM})`
  );
  assert(clampZoom(NaN) === MAP_MIN_ZOOM, 'Clamps NaN zoom safely to MAP_MIN_ZOOM');
  assert(isAtMinZoom(MAP_MIN_ZOOM) === true, 'Detects min zoom boundary accurately');
  assert(isAtMinZoom(MAP_MIN_ZOOM + 0.25) === false, 'Does not falsely flag min zoom above boundary');
  assert(isAtMaxZoom(MAP_MAX_ZOOM) === true, 'Detects max zoom boundary accurately');
  assert(isAtMaxZoom(MAP_MAX_ZOOM - 0.25) === false, 'Does not falsely flag max zoom below boundary');

  // Test 3: Repeated fractional zoom stability without floating-point drift
  let z = 10;
  for (let i = 0; i < 12; i++) {
    z = computeNextZoom(z, 'in', FINE_ZOOM_STEP);
  }
  assert(z === 13, `12 consecutive +0.25 steps reach exact 13 (got ${z})`);

  // Test 4: Step cycling, parsing, and Shift-click modifier
  assert(getNextZoomStep(FINE_ZOOM_STEP) === MEDIUM_ZOOM_STEP, 'Cycles 0.25 -> 0.5');
  assert(getNextZoomStep(MEDIUM_ZOOM_STEP) === STANDARD_ZOOM_STEP, 'Cycles 0.5 -> 1');
  assert(getNextZoomStep(STANDARD_ZOOM_STEP) === FINE_ZOOM_STEP, 'Cycles 1 -> 0.25');
  assert(parseZoomStep('0.5') === MEDIUM_ZOOM_STEP, 'Parses persisted 0.5 step');
  assert(parseZoomStep('invalid') === FINE_ZOOM_STEP, 'Falls back to 0.25 fine step for invalid storage');
  assert(
    resolveEffectiveClickStep(FINE_ZOOM_STEP, false) === FINE_ZOOM_STEP,
    'Normal click keeps active fine step'
  );
  assert(
    resolveEffectiveClickStep(FINE_ZOOM_STEP, true) === STANDARD_ZOOM_STEP,
    'Shift+click in fine mode temporarily uses standard ±1 step'
  );
  assert(
    resolveEffectiveClickStep(STANDARD_ZOOM_STEP, true) === FINE_ZOOM_STEP,
    'Shift+click in standard mode temporarily uses fine ±0.25 step'
  );

  // Test 5: Formatting helpers
  assert(formatZoomLevel(13) === '13.00', 'Formats integer zoom with fixed 2 decimals for tabular alignment');
  assert(formatZoomLevel(13.25) === '13.25', 'Formats fractional zoom with 2 decimals');
  assert(formatZoomStep(FINE_ZOOM_STEP) === '±0.25', 'Formats fine step label');
  assert(formatZoomStep(MEDIUM_ZOOM_STEP) === '±0.5', 'Formats medium step label');
  assert(formatZoomStep(STANDARD_ZOOM_STEP) === '±1', 'Formats standard step label');
  assert(getZoomStepLabel(FINE_ZOOM_STEP) === 'Fein', 'Returns German fine label');

  // Test 6: Keyboard shortcut resolution (standard & Alt fine-grained)
  const plusStd = resolveKeyboardZoomAction({ key: '+' });
  assert(plusStd?.direction === 'in' && plusStd?.step === STANDARD_ZOOM_STEP, 'Resolves "+" to standard zoom in');

  const minusStd = resolveKeyboardZoomAction({ key: '-' });
  assert(minusStd?.direction === 'out' && minusStd?.step === STANDARD_ZOOM_STEP, 'Resolves "-" to standard zoom out');

  const altPlusFine = resolveKeyboardZoomAction({ key: '+', altKey: true });
  assert(altPlusFine?.direction === 'in' && altPlusFine?.step === FINE_ZOOM_STEP, 'Resolves "Alt++" to fine zoom in (±0.25)');

  const altMinusFine = resolveKeyboardZoomAction({ key: '-', altKey: true });
  assert(altMinusFine?.direction === 'out' && altMinusFine?.step === FINE_ZOOM_STEP, 'Resolves "Alt+-" to fine zoom out (±0.25)');

  const macAltPlusFine = resolveKeyboardZoomAction({ key: '≠', code: 'Equal', altKey: true });
  assert(macAltPlusFine?.direction === 'in' && macAltPlusFine?.step === FINE_ZOOM_STEP, 'Resolves macOS Alt+= via code to fine zoom in');

  const macAltMinusFine = resolveKeyboardZoomAction({ key: '–', code: 'Minus', altKey: true });
  assert(macAltMinusFine?.direction === 'out' && macAltMinusFine?.step === FINE_ZOOM_STEP, 'Resolves macOS Alt+- via code to fine zoom out');

  assert(resolveKeyboardZoomAction({ key: 'a' }) === null, 'Ignores non-zoom keys');

  console.log(`\n📊 Map Zoom Controls Test Results: ${passed} passed, ${failed} failed\n`);
  return failed === 0;
}
