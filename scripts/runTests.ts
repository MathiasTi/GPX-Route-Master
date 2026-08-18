import { runGpxUtilsTests } from '../tests/gpxUtils.test';
import { runResponsiveAndPerformanceTests } from '../tests/responsiveAndPerformance.test';
import { runStorageAndArchitectureTests } from '../tests/storageAndArchitecture.test';
import { runIntensiveAnalysisTests } from '../tests/intensiveAnalysis.test';
import { runNavigationShortcutsTests } from '../tests/navigationShortcuts.test';
import { runGradientAnomalyTests } from '../tests/gradientAnomaly.test';
import { runRealWorldBenchmarkTests } from '../tests/realWorldBenchmarks.test';
import { runSecurityTests } from '../tests/security.test';
import { runTerrainHoverPreviewTests } from '../tests/terrainHoverPreview.test';
import { runSportMetricsGlossaryTests } from '../tests/sportMetricsGlossary.test';

try {
  console.log('🚀 Running Full GPX Route Master Test Suite...\n');
  const gpxSuccess = runGpxUtilsTests();
  const perfSuccess = runResponsiveAndPerformanceTests();
  const storageResult = runStorageAndArchitectureTests();
  const storageSuccess = storageResult.failed === 0;
  const intensiveSuccess = runIntensiveAnalysisTests();
  const navSuccess = runNavigationShortcutsTests();
  const anomalySuccess = runGradientAnomalyTests();
  const benchmarkSuccess = runRealWorldBenchmarkTests();
  const securitySuccess = runSecurityTests();
  const hoverPreviewSuccess = runTerrainHoverPreviewTests();
  const glossarySuccess = runSportMetricsGlossaryTests();

  if (!gpxSuccess || !perfSuccess || !storageSuccess || !intensiveSuccess || !navSuccess || !anomalySuccess || !benchmarkSuccess || !securitySuccess || !hoverPreviewSuccess || !glossarySuccess) {
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
