import { calculateDistance, findClimbs, calculatePowerStats } from '../utils/gpxUtils';
import { performLocalIntensiveAnalysis } from '../utils/intensiveAnalysis';
import { GPXTrack, GPXPoint } from '../types';

/**
 * Creates synthetic yet mathematically and geographically exact GPX route points
 * with specified length in kilometers and elevation ascent.
 */
function createExactBenchmarkRoute(
  totalDistanceKm: number,
  startEle: number,
  endEle: number,
  numPoints: number = 100,
  startLat: number = 45.0,
  startLng: number = 6.0,
  startTime: Date = new Date('2026-07-20T09:00:00.000Z')
): GPXPoint[] {
  const points: GPXPoint[] = [];
  const stepDistKm = totalDistanceKm / (numPoints - 1);
  const eleStep = (endEle - startEle) / (numPoints - 1);
  
  // 1 degree latitude = 111.19 km on earth sphere
  const latStep = stepDistKm / 111.19;
  const startMs = startTime.getTime();
  const estimatedSeconds = (totalDistanceKm / 18.0) * 3600; // avg climbing speed ~18 km/h
  const timeStepMs = (estimatedSeconds * 1000) / (numPoints - 1);

  for (let i = 0; i < numPoints; i++) {
    const lat = startLat + i * latStep;
    const lng = startLng;
    const ele = Number((startEle + i * eleStep).toFixed(1));
    const time = new Date(startMs + i * timeStepMs);
    points.push({ lat, lng, ele, time });
  }

  return points;
}

export function runRealWorldBenchmarkTests(): boolean {
  console.log('🏔️ Running Real-World Benchmark & Scientific Calculation Test Suite...');
  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      failed++;
      console.error(`  ✗ ${msg}`);
    }
  };

  // =========================================================================
  // 1. Geodetic Haversine Distance Benchmarks (Known Real-World Geodesics)
  // =========================================================================
  console.log('\n  --- 1. Geodetic Distance Verification against Standard Benchmarks ---');

  // Benchmark A: Munich Marienplatz to Garmisch-Partenkirchen (Known Geodesic: 80.20 km)
  const munich: GPXPoint = { lat: 48.13743, lng: 11.57549, ele: 520 };
  const garmisch: GPXPoint = { lat: 47.49209, lng: 11.09576, ele: 710 };
  const distMunichGarmisch = calculateDistance(munich, garmisch);
  assert(
    Math.abs(distMunichGarmisch - 80.20) < 0.5,
    `Munich to Garmisch geodesic distance accurate: ${distMunichGarmisch.toFixed(2)} km (expected ~80.20 km)`
  );

  // Benchmark B: Berlin Brandenburger Tor to Potsdam Sanssouci (Known Geodesic: 26.14 km)
  const berlin: GPXPoint = { lat: 52.51627, lng: 13.37770, ele: 35 };
  const potsdam: GPXPoint = { lat: 52.40420, lng: 13.03850, ele: 40 };
  const distBerlinPotsdam = calculateDistance(berlin, potsdam);
  assert(
    Math.abs(distBerlinPotsdam - 26.14) < 0.5,
    `Berlin to Potsdam geodesic distance accurate: ${distBerlinPotsdam.toFixed(2)} km (expected ~26.14 km)`
  );

  // Benchmark C: 1 degree of Latitude along a meridian (Exact WGS-84 Sphere: 111.19 km)
  const latP1: GPXPoint = { lat: 45.0, lng: 10.0, ele: 100 };
  const latP2: GPXPoint = { lat: 46.0, lng: 10.0, ele: 100 };
  const dist1DegLat = calculateDistance(latP1, latP2);
  assert(
    Math.abs(dist1DegLat - 111.19) < 0.5,
    `1° Latitude meridian step accurate: ${dist1DegLat.toFixed(2)} km (expected ~111.19 km)`
  );

  // =========================================================================
  // 2. Real-World World-Class HC Climbs (Tour de France / Giro d'Italia)
  // =========================================================================
  console.log('\n  --- 2. World-Class HC Climb Benchmarks ---');

  // Benchmark 2A: Alpe d'Huez (13.8 km, 740m -> 1850m, +1,110m ascent, 8.04% avg grade)
  const alpePoints = createExactBenchmarkRoute(13.8, 740, 1850, 138, 45.0560, 6.0300);
  const alpeTrack: GPXTrack = {
    id: 'benchmark-alpe-dhuez',
    name: 'Alpe d Huez HC Benchmark',
    points: alpePoints,
    distance: 13.8,
    ascent: 1110,
    descent: 0,
    maxSlope: 11.5,
    color: '#3b82f6',
    visible: true,
    activityType: 'cycling'
  };

  const alpeAnalysis = performLocalIntensiveAnalysis(alpeTrack, {
    activityType: 'cycling',
    subType: 'road',
    fitnessLevel: 'advanced',
    userWeightKg: 75,
    equipmentWeightKg: 8.5,
    targetFtp: 280
  });

  assert(alpeAnalysis.climbs.length >= 1, `Alpe d'Huez detected as climb segment (${alpeAnalysis.climbs.length} detected)`);
  if (alpeAnalysis.climbs.length > 0) {
    const mainClimb = alpeAnalysis.climbs[0];
    assert(mainClimb.categoryLabel.includes('HC'), `Alpe d'Huez correctly categorized as HC (got: ${mainClimb.categoryLabel})`);
    assert(mainClimb.ascentMeters >= 1050, `Alpe d'Huez elevation gain validated: ${mainClimb.ascentMeters} m (expected ~1110m)`);
    assert(mainClimb.avgGradePercent >= 7.5 && mainClimb.avgGradePercent <= 8.5, `Alpe d'Huez avg grade in 7.5-8.5% range (${mainClimb.avgGradePercent}%)`);
    assert(mainClimb.vam >= 750 && mainClimb.vam <= 1600, `Alpe d'Huez VAM in realistic climbing range: ${mainClimb.vam} m/h`);
    assert(mainClimb.hexColor === '#9333ea', `Alpe d'Huez climb assigned HC purple hex color: ${mainClimb.hexColor}`);
  }
  assert(alpeAnalysis.totalCaloriesKcal >= 600 && alpeAnalysis.totalCaloriesKcal <= 1800, `Alpe d'Huez energy expenditure realistic (${alpeAnalysis.totalCaloriesKcal} kcal)`);

  // Benchmark 2B: Passo dello Stelvio (Prato side: 24.3 km, 950m -> 2758m, +1,808m ascent, 7.44% avg grade)
  const stelvioPoints = createExactBenchmarkRoute(24.3, 950, 2758, 243, 46.6186, 10.5936);
  const stelvioTrack: GPXTrack = {
    id: 'benchmark-stelvio',
    name: 'Passo dello Stelvio HC Benchmark',
    points: stelvioPoints,
    distance: 24.3,
    ascent: 1808,
    descent: 0,
    maxSlope: 12.0,
    color: '#e11d48',
    visible: true,
    activityType: 'cycling'
  };

  const stelvioAnalysis = performLocalIntensiveAnalysis(stelvioTrack, {
    activityType: 'cycling',
    subType: 'road',
    fitnessLevel: 'elite',
    userWeightKg: 72,
    targetFtp: 300
  });

  assert(stelvioAnalysis.climbs.length >= 1, `Passo dello Stelvio detected as climb`);
  if (stelvioAnalysis.climbs.length > 0) {
    const mainClimb = stelvioAnalysis.climbs[0];
    assert(mainClimb.categoryLabel.includes('HC'), `Stelvio categorized as HC (got: ${mainClimb.categoryLabel})`);
    assert(mainClimb.ascentMeters >= 1700, `Stelvio climb ascent accurate: ${mainClimb.ascentMeters} m (expected ~1808m)`);
  }

  // Benchmark 2C: Col de la Madeleine (19.2 km, 480m -> 2000m, +1,520m ascent, 7.92% avg grade)
  const madeleinePoints = createExactBenchmarkRoute(19.2, 480, 2000, 192, 45.4389, 6.3761);
  const madeleineTrack: GPXTrack = {
    id: 'benchmark-madeleine',
    name: 'Col de la Madeleine HC Benchmark',
    points: madeleinePoints,
    distance: 19.2,
    ascent: 1520,
    descent: 0,
    maxSlope: 8.0,
    color: '#9333ea',
    visible: true,
    activityType: 'cycling'
  };
  const madeleineAnalysis = performLocalIntensiveAnalysis(madeleineTrack);
  assert(madeleineAnalysis.climbs.length > 0, 'Col de la Madeleine detected');
  if (madeleineAnalysis.climbs.length > 0) {
    assert(madeleineAnalysis.climbs[0].categoryLabel.includes('HC'), `Madeleine categorized as HC (got: ${madeleineAnalysis.climbs[0].categoryLabel})`);
  }

  // =========================================================================
  // 3. Graded Category 1, 2, 3, 4 Benchmarks
  // =========================================================================
  console.log('\n  --- 3. Category 1, 2, 3, 4 Graded Climb Classification Benchmarks ---');

  // Benchmark 3A: Category 1 Pass (6.0 km, 320m gain, 5.33% grade -> Score ~172 >= 120, < 200)
  const cat1Points = createExactBenchmarkRoute(6.0, 400, 720, 60, 47.2, 11.3);
  const cat1Track: GPXTrack = {
    id: 'cat1-track',
    name: 'Category 1 Test Pass',
    points: cat1Points,
    distance: 6.0,
    ascent: 320,
    descent: 0,
    maxSlope: 5.5,
    color: '#e11d48',
    visible: true,
    activityType: 'cycling'
  };
  const cat1Analysis = performLocalIntensiveAnalysis(cat1Track);
  assert(cat1Analysis.climbs.length > 0, 'Cat 1 climb found');
  if (cat1Analysis.climbs.length > 0) {
    assert(cat1Analysis.climbs[0].categoryLabel === 'Kategorie 1', `Pass categorized as 'Kategorie 1' (got: ${cat1Analysis.climbs[0].categoryLabel})`);
    assert(cat1Analysis.climbs[0].hexColor === '#e11d48', 'Cat 1 assigned rose hex color (#e11d48)');
  }

  // Benchmark 3B: Category 2 Pass (4.0 km, 190m gain, 4.75% grade -> Score ~91 >= 50, < 120)
  const cat2Points = createExactBenchmarkRoute(4.0, 300, 490, 40, 47.3, 11.4);
  const cat2Track: GPXTrack = {
    id: 'cat2-track',
    name: 'Category 2 Test Hill',
    points: cat2Points,
    distance: 4.0,
    ascent: 190,
    descent: 0,
    maxSlope: 5.0,
    color: '#f97316',
    visible: true,
    activityType: 'cycling'
  };
  const cat2Analysis = performLocalIntensiveAnalysis(cat2Track);
  assert(cat2Analysis.climbs.length > 0, 'Cat 2 climb found');
  if (cat2Analysis.climbs.length > 0) {
    assert(cat2Analysis.climbs[0].categoryLabel === 'Kategorie 2', `Pass categorized as 'Kategorie 2' (got: ${cat2Analysis.climbs[0].categoryLabel})`);
    assert(cat2Analysis.climbs[0].hexColor === '#f97316', 'Cat 2 assigned orange hex color (#f97316)');
  }

  // Benchmark 3C: Category 3 Hill (2.5 km, 95m gain, 3.8% grade -> Score ~36.5 >= 20, < 50)
  const cat3Points = createExactBenchmarkRoute(2.5, 200, 295, 25, 47.4, 11.5);
  const cat3Track: GPXTrack = {
    id: 'cat3-track',
    name: 'Category 3 Test Hill',
    points: cat3Points,
    distance: 2.5,
    ascent: 95,
    descent: 0,
    maxSlope: 4.0,
    color: '#f59e0b',
    visible: true,
    activityType: 'cycling'
  };
  const cat3Analysis = performLocalIntensiveAnalysis(cat3Track);
  assert(cat3Analysis.climbs.length > 0, 'Cat 3 climb found');
  if (cat3Analysis.climbs.length > 0) {
    assert(cat3Analysis.climbs[0].categoryLabel === 'Kategorie 3', `Hill categorized as 'Kategorie 3' (got: ${cat3Analysis.climbs[0].categoryLabel})`);
    assert(cat3Analysis.climbs[0].hexColor === '#f59e0b', 'Cat 3 assigned amber hex color (#f59e0b)');
  }

  // Benchmark 3D: Category 4 Short Ramp (1.2 km, 40m gain, 3.33% grade -> Score ~13.4 < 20)
  const cat4Points = createExactBenchmarkRoute(1.2, 100, 140, 15, 47.5, 11.6);
  const cat4Track: GPXTrack = {
    id: 'cat4-track',
    name: 'Category 4 Test Ramp',
    points: cat4Points,
    distance: 1.2,
    ascent: 40,
    descent: 0,
    maxSlope: 3.5,
    color: '#3b82f6',
    visible: true,
    activityType: 'cycling'
  };
  const cat4Analysis = performLocalIntensiveAnalysis(cat4Track);
  assert(cat4Analysis.climbs.length > 0, 'Cat 4 climb found');
  if (cat4Analysis.climbs.length > 0) {
    assert(cat4Analysis.climbs[0].categoryLabel === 'Kategorie 4', `Ramp categorized as 'Kategorie 4' (got: ${cat4Analysis.climbs[0].categoryLabel})`);
    assert(cat4Analysis.climbs[0].hexColor === '#3b82f6', 'Cat 4 assigned blue hex color (#3b82f6)');
  }

  // =========================================================================
  // 4. Multi-Pass Stage Isolation (Double Alpine Pass Stage)
  // =========================================================================
  console.log('\n  --- 4. Multi-Pass Alpine Stage (Pass 1 + Valley Descent + Pass 2) ---');

  const pass1 = createExactBenchmarkRoute(12.0, 500, 1500, 50, 46.0, 10.0);
  const descent = createExactBenchmarkRoute(8.0, 1500, 600, 30, 46.108, 10.0);
  const pass2 = createExactBenchmarkRoute(15.0, 600, 2000, 60, 46.18, 10.0);
  const multiPassPoints = [...pass1, ...descent.slice(1), ...pass2.slice(1)];

  const detectedClimbs = findClimbs(multiPassPoints);
  assert(detectedClimbs.length === 2, `findClimbs identifies exactly 2 distinct mountain passes (got: ${detectedClimbs.length})`);
  if (detectedClimbs.length === 2) {
    assert(detectedClimbs[0].ascent >= 950, `First pass ascent >= 950m (got: ${detectedClimbs[0].ascent}m)`);
    assert(detectedClimbs[1].ascent >= 1350, `Second pass ascent >= 1350m (got: ${detectedClimbs[1].ascent}m)`);
  }

  // =========================================================================
  // 5. Aerodynamic Power Simulation & Physics Model Validation
  // =========================================================================
  console.log('\n  --- 5. Aerodynamic & Metabolic Physics Benchmarks ---');

  // Flat 40 km Time Trial at 40 km/h (11.11 m/s) with 75kg rider + 8.5kg bike (total 83.5kg)
  const flatTtPoints = createExactBenchmarkRoute(40.0, 400, 400, 400, 48.0, 11.0);
  // Assign 1 hour duration
  const startMs = new Date('2026-06-15T10:00:00Z').getTime();
  flatTtPoints.forEach((p, idx) => {
    p.time = new Date(startMs + (idx / (flatTtPoints.length - 1)) * 3600 * 1000);
  });

  const flatPowerStats = calculatePowerStats(flatTtPoints, 300, 75, 40, 'cycling');
  assert(
    flatPowerStats.avgPower >= 280 && flatPowerStats.avgPower <= 380,
    `40 km/h Flat Time Trial aerodynamic power realistic: ${flatPowerStats.avgPower.toFixed(1)} W (expected ~340 W)`
  );
  assert(
    flatPowerStats.work >= 1000 && flatPowerStats.work <= 1400,
    `Mechanical work output realistic: ${flatPowerStats.work.toFixed(1)} kJ`
  );

  // Running 10 km at 5:00 min/km (12 km/h) for 70kg runner
  const runPoints = createExactBenchmarkRoute(10.0, 500, 520, 100, 48.1, 11.5);
  const runTrack: GPXTrack = {
    id: 'running-10k-benchmark',
    name: '10K Road Run Benchmark',
    points: runPoints,
    distance: 10.0,
    ascent: 20,
    descent: 0,
    maxSlope: 1.5,
    color: '#10b981',
    visible: true,
    activityType: 'running'
  };

  const runAnalysis = performLocalIntensiveAnalysis(runTrack, {
    activityType: 'running',
    userWeightKg: 70,
    fitnessLevel: 'advanced'
  });

  assert(
    runAnalysis.totalCaloriesKcal >= 600 && runAnalysis.totalCaloriesKcal <= 850,
    `10K Running Caloric expenditure validated: ${runAnalysis.totalCaloriesKcal} kcal (expected ~700 kcal)`
  );

  console.log(`\n🏁 Real-World Benchmark Tests: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
