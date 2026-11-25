import fs from 'node:fs';
import path from 'node:path';
import type { GPXPoint, GPXTrack } from '../types';
import {
  buildRacePredictions,
  calculateVdotFromEffort,
  computeLongitudinalFitnessMetrics,
  computeTrackSportsMetrics,
  estimateRecoveryFromTss,
  formatRaceTime,
  type LongitudinalActivityInput,
  type LongitudinalDailyPoint
} from '../utils/sportsMetricsEngine';

function buildCyclingClimbTrack(options: {
  durationMin: number;
  basePower: number;
  latePower: number;
  baseHr: number;
  lateHr: number;
  gradePct: number;
}): GPXTrack {
  const points: GPXPoint[] = [];
  const stepSec = 10;
  const totalSteps = Math.round((options.durationMin * 60) / stepSec);
  const startTime = Date.parse('2026-09-10T08:00:00Z');
  const speedMs = 5.0; // 18 km/h
  let lat = 47.4;
  let ele = 700;

  for (let i = 0; i <= totalSteps; i++) {
    const frac = i / totalSteps;
    const distM = speedMs * stepSec;
    if (i > 0) {
      lat += distM / 111_320;
      ele += distM * (options.gradePct / 100);
    }
    const power = frac < 0.5 ? options.basePower : options.latePower;
    const hr = frac < 0.5 ? options.baseHr : options.lateHr;
    points.push({
      lat,
      lng: 11.2,
      ele: Number(ele.toFixed(1)),
      time: new Date(startTime + i * stepSec * 1000),
      power,
      hr
    });
  }

  const distKm = Number(((speedMs * totalSteps * stepSec) / 1000).toFixed(2));
  const ascentM = Math.round(ele - 700);
  return {
    id: 'test-cycling-climb',
    name: 'Pass-Test Cycling',
    points,
    color: '#16a34a',
    visible: true,
    distance: distKm,
    ascent: ascentM,
    descent: 0,
    maxSlope: options.gradePct + 1,
    duration: totalSteps * stepSec,
    activityType: 'cycling'
  };
}

function buildRunningTrack(options: {
  durationMin: number;
  speedMsFirstHalf: number;
  speedMsSecondHalf: number;
  hrFirstHalf?: number;
  hrSecondHalf?: number;
}): GPXTrack {
  const points: GPXPoint[] = [];
  const stepSec = 10;
  const totalSteps = Math.round((options.durationMin * 60) / stepSec);
  const startTime = Date.parse('2026-09-12T07:00:00Z');
  let lat = 48.1;
  let totalDistM = 0;

  for (let i = 0; i <= totalSteps; i++) {
    const frac = i / totalSteps;
    const speedMs = frac < 0.5 ? options.speedMsFirstHalf : options.speedMsSecondHalf;
    if (i > 0) {
      const distM = speedMs * stepSec;
      totalDistM += distM;
      lat += distM / 111_320;
    }
    const hr = frac < 0.5 ? options.hrFirstHalf : options.hrSecondHalf;
    points.push({
      lat,
      lng: 11.55,
      ele: 520,
      time: new Date(startTime + i * stepSec * 1000),
      ...(hr !== undefined ? { hr } : {})
    });
  }

  return {
    id: 'test-running-10k',
    name: 'Tempodauerlauf 10k',
    points,
    color: '#10b981',
    visible: true,
    distance: Number((totalDistM / 1000).toFixed(2)),
    ascent: 0,
    descent: 0,
    maxSlope: 0,
    duration: totalSteps * stepSec,
    activityType: 'running'
  };
}

export function runSportsMetricsEngineTests(): boolean {
  console.log('🧪 Running Sports & Fitness Metrics Engine & 3D Preview Removal Tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Cycling single-track: EF, Pw:Hr decoupling, Durability, VAM, W/kg, VO2max
  const steadyClimb = buildCyclingClimbTrack({
    durationMin: 40,
    basePower: 260,
    latePower: 255,
    baseHr: 152,
    lateHr: 155,
    gradePct: 6
  });
  const steadyMetrics = computeTrackSportsMetrics(steadyClimb, {
    ftp: 270,
    weightKg: 72,
    maxHr: 190,
    climate: 'moderate'
  });

  assert(
    steadyMetrics.sport === 'cycling' &&
      steadyMetrics.efficiency.ef !== null &&
      steadyMetrics.efficiency.ef > 1.5 &&
      steadyMetrics.efficiency.ef < 1.9 &&
      steadyMetrics.efficiency.decouplingLabel === 'Pw:Hr',
    'Cycling track computes power-based Efficiency Factor (W/bpm) and Pw:Hr label'
  );
  assert(
    steadyMetrics.efficiency.decouplingPct !== null &&
      steadyMetrics.efficiency.decouplingPct < 5 &&
      steadyMetrics.efficiency.decouplingStatus === 'stable',
    'Steady cycling track reports stable aerobic decoupling (<5%)'
  );
  assert(
    steadyMetrics.durability.retentionPct !== null &&
      steadyMetrics.durability.retentionPct >= 95 &&
      steadyMetrics.durability.status === 'strong' &&
      steadyMetrics.durability.workPerKg !== null &&
      steadyMetrics.durability.workPerKg > 5,
    'Steady cycling track reports strong Q4/Q1 durability retention and kJ/kg work'
  );
  assert(
    steadyMetrics.climbing.avgVam !== null &&
      steadyMetrics.climbing.avgVam > 950 &&
      steadyMetrics.climbing.avgVam < 1200 &&
      steadyMetrics.climbing.climbingWkg !== null &&
      steadyMetrics.climbing.climbingWkg > 3.2 &&
      steadyMetrics.climbing.climbingWkgSource === 'power',
    'Climbing cycling track computes realistic VAM (~1080 m/h) and power-based W/kg'
  );
  assert(
    steadyMetrics.performance.estimatedVo2Max !== null &&
      steadyMetrics.performance.estimatedVo2Max > 42 &&
      steadyMetrics.performance.cyclingBenchmarks.length === 5 &&
      steadyMetrics.performance.phenotype.axes.length === 5,
    'Cycling track computes VO2max estimate, 5 duration benchmarks, and 5-axis phenotype'
  );

  // 2. Fatigued cycling drift (>10% decoupling) & climate hydration scaling
  const fatiguedRide = buildCyclingClimbTrack({
    durationMin: 40,
    basePower: 260,
    latePower: 210,
    baseHr: 148,
    lateHr: 168,
    gradePct: 4
  });
  const fatiguedCool = computeTrackSportsMetrics(fatiguedRide, { ftp: 270, weightKg: 72, climate: 'cool' });
  const fatiguedWarm = computeTrackSportsMetrics(fatiguedRide, { ftp: 270, weightKg: 72, climate: 'warm' });
  assert(
    fatiguedCool.efficiency.decouplingPct !== null &&
      fatiguedCool.efficiency.decouplingPct > 15 &&
      fatiguedCool.efficiency.decouplingStatus === 'high' &&
      fatiguedCool.durability.status === 'fatigued',
    'Fatigued ride accurately flags high aerobic decoupling (>10%) and fatigued durability'
  );
  assert(
    fatiguedWarm.fueling.fluidPerHourMl > fatiguedCool.fueling.fluidPerHourMl &&
      fatiguedWarm.fueling.sodiumPerHourMg > fatiguedCool.fueling.sodiumPerHourMg,
    'Fueling calculator scales hourly fluid and sodium intake for warm vs. cool conditions'
  );

  // 3. Running track: GAP EF, Pa:Hr, Negative Split, VDOT & Race Predictor
  const negativeSplitRun = buildRunningTrack({
    durationMin: 40,
    speedMsFirstHalf: 4.0, // 4:10/km
    speedMsSecondHalf: 4.3, // 3:52/km
    hrFirstHalf: 158,
    hrSecondHalf: 164
  });
  const runMetrics = computeTrackSportsMetrics(negativeSplitRun, { weightKg: 68, maxHr: 192 });
  assert(
    runMetrics.sport === 'running' &&
      runMetrics.efficiency.decouplingLabel === 'Pa:Hr' &&
      runMetrics.efficiency.ef !== null &&
      runMetrics.climbing.splitType === 'negative',
    'Running track computes Pa:Hr efficiency and detects negative split pacing'
  );
  assert(
    runMetrics.performance.vdot !== null &&
      runMetrics.performance.vdot > 45 &&
      runMetrics.performance.racePredictions.length === 4 &&
      runMetrics.performance.racePredictions[0].timeSec < runMetrics.performance.racePredictions[3].timeSec,
    'Running track derives realistic VDOT and monotonically increasing 5K to Marathon predictions'
  );

  // 4. Direct VDOT sanity check (40:00 10K -> VDOT ~52, Marathon ~3:06-3:12)
  const vdot40Min10k = calculateVdotFromEffort(10_000, 40 * 60);
  const preds40Min = buildRacePredictions(vdot40Min10k);
  assert(
    vdot40Min10k !== null &&
      vdot40Min10k >= 50 &&
      vdot40Min10k <= 54 &&
      preds40Min.length === 4 &&
      formatRaceTime(preds40Min[1].timeSec).startsWith('40:'),
    `Daniels VDOT accurately models 40:00 10K (VDOT ${vdot40Min10k}, 10K pred ${formatRaceTime(preds40Min[1]?.timeSec || 0)})`
  );

  // 5. Missing HR gating (honest null instead of fabricated EF/decoupling)
  const noHrRun = buildRunningTrack({
    durationMin: 30,
    speedMsFirstHalf: 3.5,
    speedMsSecondHalf: 3.5
  });
  const noHrMetrics = computeTrackSportsMetrics(noHrRun, { weightKg: 70 });
  assert(
    noHrMetrics.efficiency.ef === null &&
      noHrMetrics.efficiency.decouplingPct === null &&
      Boolean(noHrMetrics.efficiency.reasonUnavailable),
    'Missing heart rate honestly gates EF and decoupling to null with explanatory reason'
  );

  // 6. Recovery estimation scaling
  const lightRec = estimateRecoveryFromTss(30);
  const hardRec = estimateRecoveryFromTss(190);
  assert(
    lightRec.readinessLabel === 'light' &&
      hardRec.readinessLabel === 'very_hard' &&
      hardRec.estimatedHours > lightRec.estimatedHours,
    'estimateRecoveryFromTss scales recovery hours and readiness labels monotonically with TSS'
  );

  // 7. Longitudinal metrics: ACWR spike, Foster Monotony/Strain, CTL Ramp Rate & Improving EF
  const dailySeries: LongitudinalDailyPoint[] = [];
  const startDay = Date.parse('2026-08-01T00:00:00Z');
  for (let d = 0; d < 35; d++) {
    const dt = new Date(startDay + d * 86_400_000);
    const iso = dt.toISOString().slice(0, 10);
    // First 28 days moderate (~40 TSS/day alternating), final 7 days identical high load (95 TSS/day)
    const tss = d < 28 ? (d % 2 === 0 ? 60 : 20) : 95;
    const ctl = d < 28 ? 38 : 38 + (d - 27) * 1.5;
    const atl = d < 28 ? 40 : 88;
    dailySeries.push({
      date: iso,
      formattedDate: iso.slice(5),
      tss,
      ctl: Math.round(ctl),
      atl: Math.round(atl),
      tsb: Math.round(ctl - atl)
    });
  }

  const longitudinalActs: LongitudinalActivityInput[] = [
    { id: 'a1', name: 'Ride 1', date: '2026-08-05', sport: 'cycling', distanceKm: 50, durationSec: 5400, tss: 70, avgHr: 155, normalizedPower: 210, peaks: { 5: 850, 300: 310, 1200: 265 } },
    { id: 'a2', name: 'Ride 2', date: '2026-08-12', sport: 'cycling', distanceKm: 55, durationSec: 5800, tss: 75, avgHr: 152, normalizedPower: 215, peaks: { 5: 860, 300: 320, 1200: 270 } },
    { id: 'a3', name: 'Ride 3', date: '2026-08-20', sport: 'cycling', distanceKm: 60, durationSec: 6000, tss: 85, avgHr: 148, normalizedPower: 225, peaks: { 5: 880, 300: 335, 1200: 280 } },
    { id: 'a4', name: 'Ride 4', date: '2026-08-28', sport: 'cycling', distanceKm: 65, durationSec: 6300, tss: 95, avgHr: 145, normalizedPower: 232, peaks: { 5: 900, 300: 345, 1200: 288 } }
  ];

  const longMetrics = computeLongitudinalFitnessMetrics(longitudinalActs, dailySeries, {
    ftp: 275,
    weightKg: 74
  });

  assert(
    longMetrics.acwr.current !== null &&
      longMetrics.acwr.current > 1.5 &&
      longMetrics.acwr.status === 'high_risk',
    `Longitudinal ACWR flags overload spike >1.5 (got ${longMetrics.acwr.current})`
  );
  assert(
    longMetrics.monotonyStrain.monotony7d !== null &&
      longMetrics.monotonyStrain.monotony7d > 2.0 &&
      longMetrics.monotonyStrain.status === 'high_risk' &&
      longMetrics.monotonyStrain.strain7d !== null &&
      longMetrics.monotonyStrain.strain7d > 1000,
    'Foster Training Monotony & Strain flag repetitive high-load week (>2.0)'
  );
  assert(
    longMetrics.rampRate.weeklyCtlDelta !== null &&
      longMetrics.rampRate.weeklyCtlDelta > 7 &&
      longMetrics.rampRate.status === 'aggressive',
    `Weekly CTL ramp rate flags aggressive build (>+7/wk, got +${longMetrics.rampRate.weeklyCtlDelta})`
  );
  assert(
    longMetrics.efTrend.points.length === 4 &&
      longMetrics.efTrend.direction === 'improving' &&
      longMetrics.efTrend.changePct !== null &&
      longMetrics.efTrend.changePct > 10,
    'Longitudinal Efficiency Factor detects improving aerobic efficiency trend'
  );

  // 8. Bug Regression: Simulated powerStats must not leak into native cycling benchmarks
  const noPowerRide = buildCyclingClimbTrack({
    durationMin: 30,
    basePower: 220,
    latePower: 220,
    baseHr: 145,
    lateHr: 148,
    gradePct: 4
  });
  noPowerRide.points = noPowerRide.points.map(({ power: _p, ...rest }) => rest);
  noPowerRide.powerStats = {
    avgPower: 215,
    normalizedPower: 225,
    maxPower: 640,
    best20s: 440,
    best1m: 380,
    best20m: 250,
    work: 390,
    intensityFactor: 0.85,
    tss: 45,
    variabilityIndex: 1.05
  };
  const noPowerMetrics = computeTrackSportsMetrics(noPowerRide, { ftp: 260, weightKg: 72 });
  assert(
    noPowerMetrics.efficiency.method !== 'power' &&
      noPowerMetrics.efficiency.normalizedPower === null &&
      noPowerMetrics.performance.cyclingBenchmarks.every((b) => b.watts === null),
    'Simulated powerStats do not leak into native cycling W/kg benchmarks when track has no power sensor'
  );

  // 9. Bug Regression: Mixed-unit longitudinal EF trend isolates a single consistent unit
  const mixedEfActs: LongitudinalActivityInput[] = [
    { id: 'm1', name: 'Ride A', date: '2026-08-01', sport: 'cycling', distanceKm: 50, durationSec: 5400, tss: 70, avgHr: 150, normalizedPower: 210 },
    { id: 'm2', name: 'Ride B', date: '2026-08-05', sport: 'cycling', distanceKm: 55, durationSec: 5600, tss: 75, avgHr: 150, normalizedPower: 212 },
    { id: 'm3', name: 'Ride C', date: '2026-08-10', sport: 'cycling', distanceKm: 52, durationSec: 5500, tss: 72, avgHr: 150, normalizedPower: 214 },
    { id: 'm4', name: 'Ride D', date: '2026-08-15', sport: 'cycling', distanceKm: 58, durationSec: 5900, tss: 80, avgHr: 150, normalizedPower: 216 },
    // Running EF (~1.60 m/min/bpm) and cycling speed EF (~2.00 km/h·10/bpm) would distort W/bpm delta if mixed
    { id: 'm5', name: 'Run X', date: '2026-08-20', sport: 'running', distanceKm: 10, durationSec: 2500, tss: 55, avgHr: 150 }
  ];
  const mixedLongMetrics = computeLongitudinalFitnessMetrics(mixedEfActs, dailySeries, {
    ftp: 260,
    weightKg: 72,
    sportFilter: 'all'
  });
  const uniqueUnits = new Set(mixedLongMetrics.efTrend.points.map((p) => p.unit));
  assert(
    uniqueUnits.size === 1 &&
      mixedLongMetrics.efTrend.points.length === 4 &&
      mixedLongMetrics.efTrend.points[0].unit === 'W/bpm' &&
      mixedLongMetrics.efTrend.changePct !== null &&
      Math.abs(mixedLongMetrics.efTrend.changePct) < 5,
    'Mixed-sport longitudinal EF trend isolates dominant unit instead of comparing incompatible scales'
  );

  // 10. Structural & Removal Verification
  const root = process.cwd();
  const terrainPreviewExists = fs.existsSync(path.join(root, 'components/TerrainHoverPreview3D.tsx'));
  assert(!terrainPreviewExists, 'components/TerrainHoverPreview3D.tsx has been removed');

  const sidebarSrc = fs.readFileSync(path.join(root, 'components/Sidebar.tsx'), 'utf8');
  assert(
    !sidebarSrc.includes('TerrainHoverPreview3D') &&
      sidebarSrc.includes('<SidebarSportsMetricsCard') &&
      sidebarSrc.includes('onOpenSportsMetrics'),
    'Sidebar.tsx removed 3D-Terrain Hover-Vorschau and renders SidebarSportsMetricsCard'
  );

  const cockpitSrc = fs.readFileSync(path.join(root, 'components/IntensiveTrackAnalysisModal.tsx'), 'utf8');
  assert(
    cockpitSrc.includes("id=\"tab-cockpit-sports-metrics\"") &&
      cockpitSrc.includes('<SportsMetricsTab'),
    'IntensiveTrackAnalysisModal.tsx wires dedicated Sport & Fitness metrics tab'
  );

  const fitnessSrc = fs.readFileSync(path.join(root, 'components/FitnessPerformanceAnalysis.tsx'), 'utf8');
  assert(
    fitnessSrc.includes('id="btn-fitness-tab-load-safety"') &&
      fitnessSrc.includes('<LoadSafetyProfileTab'),
    'FitnessPerformanceAnalysis.tsx wires Load Safety & Profil tab'
  );

  console.log(`\n📊 Sports & Fitness Metrics Results: ${passed} passed, ${failed} failed\n`);
  return failed === 0;
}
