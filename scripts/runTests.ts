import { runGpxUtilsTests } from '../tests/gpxUtils.test';
import { runResponsiveAndPerformanceTests } from '../tests/responsiveAndPerformance.test';

try {
  console.log('🚀 Running Full GPX Route Master Test Suite...\n');
  const gpxSuccess = runGpxUtilsTests();
  const perfSuccess = runResponsiveAndPerformanceTests();

  if (!gpxSuccess || !perfSuccess) {
    console.error('❌ One or more test suites failed.');
    process.exit(1);
  } else {
    console.log('🎉 All test suites passed successfully (100% GREEN)!');
    process.exit(0);
  }
} catch (err) {
  console.error('Fatal error running unit tests:', err);
  process.exit(1);
}
