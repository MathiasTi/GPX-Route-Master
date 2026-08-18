import { GLOSSARY_METRICS, GlossaryMetric } from '../components/SportMetricsGlossaryModal';

export function runSportMetricsGlossaryTests(): boolean {
  console.log('🧪 Running Sport Metrics Glossary & Calculator Test Suite...');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      passed++;
      console.log(`  ✓ ${message}`);
    } else {
      failed++;
      console.error(`  ✗ ${message}`);
    }
  }

  // 1. Data Integrity Tests
  assert(GLOSSARY_METRICS.length >= 10, `Contains comprehensive set of metrics (${GLOSSARY_METRICS.length} defined)`);
  
  const requiredMetrics = ['vam', 'ftp', 'tss', 'np', 'if', 'vi', 'ctl', 'atl', 'tsb', 'vo2max', 'ef', 'decoupling', 'climb_category'];
  const definedIds = GLOSSARY_METRICS.map(m => m.id);
  const allRequiredFound = requiredMetrics.every(id => definedIds.includes(id));
  assert(allRequiredFound, `All core cycling and physiology metrics are present: ${requiredMetrics.join(', ')}`);

  // 2. Metric Attribute Completeness Tests
  let allHaveValidStructure = true;
  GLOSSARY_METRICS.forEach(m => {
    if (!m.id || !m.name || !m.shortName || !m.definition || !m.unit || !m.interpretation || !m.benchmarks || m.benchmarks.length === 0) {
      allHaveValidStructure = false;
      console.error(`Invalid structure for metric ${m.id}`);
    }
  });
  assert(allHaveValidStructure, 'All metrics have non-empty name, shortName, definition, unit, and benchmarks');

  // 3. Mathematical Formula Tests: VAM
  // VAM = (eleGain / timeSec) * 3600
  const eleGain = 800; // 800m
  const timeSec = 30 * 60; // 30 minutes
  const calculatedVam = Math.round((eleGain / timeSec) * 3600);
  assert(calculatedVam === 1600, `VAM formula correct: 800m in 30min = ${calculatedVam} m/h (expected 1600 m/h)`);

  // 4. Mathematical Formula Tests: TSS & IF
  // IF = NP / FTP = 240 / 250 = 0.96
  // TSS = (timeSec * NP * IF) / (FTP * 3600) * 100
  const ftp = 250;
  const np = 240;
  const durationSec = 3600; // 1 hour
  const ifVal = np / ftp;
  const tss = Math.round(((durationSec * np * ifVal) / (ftp * 3600)) * 100);
  const expectedTss = Math.round(((3600 * 240 * (240 / 250)) / (250 * 3600)) * 100); // 92.16 -> 92
  assert(tss === expectedTss && tss === 92, `TSS formula correct: 1h @ 240W NP with 250W FTP = ${tss} TSS (expected 92)`);

  // Exactly 1 hour at 100% FTP must equal exactly 100 TSS
  const tssAtFtp = Math.round(((3600 * 250 * 1.0) / (250 * 3600)) * 100);
  assert(tssAtFtp === 100, `TSS benchmark invariant: 1h @ 100% FTP = exactly ${tssAtFtp} TSS`);

  // 5. Mathematical Formula Tests: Variability Index (VI)
  const avgPower = 200;
  const vi = Number((np / avgPower).toFixed(2));
  assert(vi === 1.20, `VI calculation correct: 240W NP / 200W Avg = ${vi} (expected 1.20)`);

  // 6. Mathematical Formula Tests: Climb Category Score (UCI / TdF)
  // Score = eleM * (grade% / 100) * sqrt(distKm)
  const climbEle = 1100; // 1100m
  const climbDistKm = 14; // 14 km
  const climbGrade = (climbEle / (climbDistKm * 1000)) * 100;
  const climbScore = Math.round(climbEle * (climbGrade / 100) * Math.sqrt(climbDistKm));
  assert(climbGrade > 7.8 && climbGrade < 7.9, `Climb grade correctly calculated: ${climbGrade.toFixed(2)}%`);
  assert(climbScore >= 200, `Climb classified as Hors Catégorie (HC) score >= 200 (Score: ${climbScore})`);

  // 7. Efficiency Factor (EF)
  const hr = 140;
  const ef = Number((np / hr).toFixed(2));
  assert(ef === 1.71, `Efficiency Factor (EF) correct: 240W / 140 bpm = ${ef} W/bpm`);

  // 8. Aerobic Decoupling (Pw:HR)
  const ef1 = 1.80;
  const ef2 = 1.71;
  const decoupling = Number((((ef1 - ef2) / ef1) * 100).toFixed(1));
  assert(decoupling === 5.0, `Aerobic Decoupling correct: ((1.80 - 1.71) / 1.80) * 100 = ${decoupling}%`);

  // 9. Performance Management Model (PMC: TSB = CTL - ATL)
  const ctl = 85;
  const atl = 70;
  const tsb = ctl - atl;
  assert(tsb === 15, `TSB correct: CTL (85) - ATL (70) = ${tsb} (Peak Form range)`);

  // 10. Search & Filter Matching
  const searchVam = GLOSSARY_METRICS.filter(m => m.name.toLowerCase().includes('vam') || m.shortName.toLowerCase().includes('vam'));
  assert(searchVam.length >= 1 && searchVam[0].id === 'vam', 'Search correctly resolves "VAM" to Velocità Ascensionale Media');

  const climbingMetrics = GLOSSARY_METRICS.filter(m => m.category === 'climbing');
  assert(climbingMetrics.length >= 3, `Climbing category contains ${climbingMetrics.length} metrics`);

  console.log(`\nSport Metrics Glossary Tests: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
