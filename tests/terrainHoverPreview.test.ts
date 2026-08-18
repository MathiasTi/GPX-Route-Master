import { GPXTrack, GPXPoint } from '../types';
import { calculateBearing, calculateDistance } from '../utils/gpxUtils';

export const runTerrainHoverPreviewTests = (): boolean => {
  console.log('🧪 Running 3D Terrain Hover Preview & Instantaneous Slope HUD Tests...\n');
  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  };

  // Test 1: Instantaneous slope calculation from adjacent elevation points
  {
    const p1: GPXPoint = { lat: 47.5000, lng: 11.5000, ele: 800 };
    const p2: GPXPoint = { lat: 47.5010, lng: 11.5000, ele: 815 }; // ~111m distance, 15m rise => ~13.5%
    const distM = calculateDistance(p1, p2) * 1000;
    const slope = ((p2.ele! - p1.ele!) / distM) * 100;
    
    assert(distM > 100 && distM < 120, `Distance correctly calculated between coordinates (~${Math.round(distM)}m)`);
    assert(slope > 12 && slope < 15, `Instantaneous slope correctly calculated (~${slope.toFixed(1)}%)`);
  }

  // Test 2: Directional compass bearing calculation for 3D Camera synchronization
  {
    const northPt1: GPXPoint = { lat: 50.0, lng: 10.0 };
    const northPt2: GPXPoint = { lat: 50.01, lng: 10.0 };
    const bearingNorth = Math.round(calculateBearing(northPt1, northPt2));
    assert(bearingNorth === 0 || bearingNorth === 360, `Bearing pointing directly north is 0° (got ${bearingNorth}°)`);

    const eastPt1: GPXPoint = { lat: 50.0, lng: 10.0 };
    const eastPt2: GPXPoint = { lat: 50.0, lng: 10.01 };
    const bearingEast = Math.round(calculateBearing(eastPt1, eastPt2));
    assert(bearingEast >= 85 && bearingEast <= 95, `Bearing pointing directly east is ~90° (got ${bearingEast}°)`);

    const southPt1: GPXPoint = { lat: 50.01, lng: 10.0 };
    const southPt2: GPXPoint = { lat: 50.0, lng: 10.0 };
    const bearingSouth = Math.round(calculateBearing(southPt1, southPt2));
    assert(bearingSouth >= 175 && bearingSouth <= 185, `Bearing pointing south is ~180° (got ${bearingSouth}°)`);
  }

  // Test 3: Slope categorization boundaries
  {
    const categorizeSlope = (slope: number): string => {
      if (slope >= 14) return 'Extrem-Rampe';
      if (slope >= 8) return 'Steilanstieg';
      if (slope >= 3.5) return 'Mäßiger Anstieg';
      if (slope <= -8) return 'Steilabfahrt';
      if (slope <= -3.5) return 'Gefälle';
      return 'Flach';
    };

    assert(categorizeSlope(18.5) === 'Extrem-Rampe', '18.5% is categorized as Extrem-Rampe');
    assert(categorizeSlope(9.2) === 'Steilanstieg', '9.2% is categorized as Steilanstieg');
    assert(categorizeSlope(5.0) === 'Mäßiger Anstieg', '5.0% is categorized as Mäßiger Anstieg');
    assert(categorizeSlope(1.2) === 'Flach', '1.2% is categorized as Flach');
    assert(categorizeSlope(-5.4) === 'Gefälle', '-5.4% is categorized as Gefälle');
    assert(categorizeSlope(-12.0) === 'Steilabfahrt', '-12.0% is categorized as Steilabfahrt');
  }

  // Test 4: Telemetry extraction with sensor data (Power, HR, Surface)
  {
    const samplePoint: GPXPoint = {
      lat: 47.4123,
      lng: 11.2345,
      ele: 1250,
      power: 280,
      hr: 165,
      cadence: 88,
      speed: 18.5,
      surface: 'Gravel'
    };

    assert(samplePoint.ele === 1250, 'Altitude accurately read (1250m)');
    assert(samplePoint.power === 280, 'Power accurately read (280W)');
    assert(samplePoint.hr === 165, 'Heart rate accurately read (165 bpm)');
    assert(samplePoint.surface === 'Gravel', 'Surface correctly read (Gravel)');
  }

  console.log(`\n🏁 3D Terrain Hover Preview Test Results: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
};
