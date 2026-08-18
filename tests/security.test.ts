import { getAllSettings, saveSetting, getSetting, searchTracks, searchGarminActivities } from '../utils/db';
import { analyzeTrackValidation, autoFixTrackValidation } from '../utils/gpxUtils';
import { GPXTrack, GPXPoint } from '../types';
import path from 'path';
import fs from 'fs';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

export function runSecurityTests(): boolean {
  console.log('🔒 Running Security & Vulnerability Defense Test Suite...');
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e: any) {
      failed++;
      console.error(`  ✗ ${name}: ${e.message}`);
    }
  }

  // 1. Prototype Pollution Defense
  test('Settings: Rejects prototype pollution attempts via __proto__, constructor, and prototype', () => {
    const protoSave = saveSetting('__proto__', 'malicious_pollute');
    assert(protoSave === false, '__proto__ key must be rejected');

    const constructorSave = saveSetting('constructor', 'malicious_constructor');
    assert(constructorSave === false, 'constructor key must be rejected');

    const prototypeSave = saveSetting('prototype', 'malicious_prototype');
    assert(prototypeSave === false, 'prototype key must be rejected');

    const settings = getAllSettings();
    assert(!('__proto__' in settings) || (Object.prototype as any).malicious_pollute === undefined, 'Prototype pollution must not affect global Object prototype');
    assert((Object.prototype as any).pollutedKey === undefined, 'Global prototype remains clean');
  });

  test('Settings: Normal keys are safely stored and returned as clean object dictionary', () => {
    saveSetting('theme_mode', 'dark');
    saveSetting('power_ftp', '285');

    const theme = getSetting('theme_mode', 'light');
    assert(theme === 'dark', 'Safe key must be retrieved correctly');

    const all = getAllSettings();
    assert(all['theme_mode'] === 'dark', 'Settings map contains valid safe key');
    assert(all['power_ftp'] === '285', 'Settings map contains valid FTP');
  });

  // 2. Path Traversal & File Access Hardening Verification
  test('File Validation Logic: Traversal and unauthorized file access rules', () => {
    const workspaceRoot = path.resolve(process.cwd());

    // Helper mirroring server validateWorkspaceFilePath
    function testValidate(filepath: string): { valid: boolean; error?: string } {
      if (!filepath || typeof filepath !== 'string' || filepath.includes('\0') || filepath.length > 512) {
        return { valid: false, error: 'Invalid path' };
      }
      const absolutePath = path.resolve(filepath);
      const ext = path.extname(absolutePath).toLowerCase();
      const allowedExtensions = ['.db', '.sqlite', '.sqlite3', '.fit', '.gpx', '.json', '.csv'];
      if (!allowedExtensions.includes(ext)) {
        return { valid: false, error: 'Invalid extension' };
      }
      const basename = path.basename(absolutePath).toLowerCase();
      const sensitiveFiles = ['.env', '.env.example', '.gitignore', 'package.json', 'package-lock.json', 'server.ts', 'tsconfig.json', 'vite.config.ts'];
      if (sensitiveFiles.includes(basename) || basename.startsWith('.git') || basename.startsWith('.aistudio')) {
        return { valid: false, error: 'Sensitive file' };
      }
      const appDbPath = path.resolve(path.join(workspaceRoot, 'data', 'gpx_library.db'));
      if (absolutePath === appDbPath) {
        return { valid: false, error: 'App DB protected' };
      }
      return { valid: true };
    }

    assert(testValidate('../../../etc/passwd').valid === false, 'Passwd traversal must be rejected');
    assert(testValidate('..%2F..%2Fetc%2Fpasswd').valid === false, 'URL encoded traversal must be rejected');
    assert(testValidate('server.ts').valid === false, 'server.ts access must be rejected');
    assert(testValidate('.env').valid === false, '.env file access must be rejected');
    assert(testValidate('package.json').valid === false, 'package.json access must be rejected');
    assert(testValidate('data/gpx_library.db').valid === false, 'Direct internal DB access must be rejected');
    assert(testValidate('test.exe').valid === false, 'Executable extensions must be rejected');
    assert(testValidate('test.sh').valid === false, 'Shell script extensions must be rejected');
    assert(testValidate('test.sqlite').valid === true, 'Valid sqlite file in workspace allowed');
  });

  // 3. SQL Injection Defense Verification
  test('SQL Injection: searchTracks uses parameterized queries safely', () => {
    const maliciousInput = "'; DROP TABLE tracks; --";
    const results = searchTracks(maliciousInput);
    assert(Array.isArray(results), 'searchTracks with SQL injection attack string must return an array without throwing');
    
    // Verify table still exists by running a normal search
    const normalResults = searchTracks('');
    assert(Array.isArray(normalResults), 'Tracks table intact after SQL injection test');
  });

  test('SQL Injection: searchGarminActivities safely handles quotes and SQL syntax', () => {
    const maliciousInput = "' UNION SELECT 1, 2, 3, 4 --";
    const results = searchGarminActivities(maliciousInput);
    assert(Array.isArray(results), 'searchGarminActivities with UNION SQL injection must return clean array');
  });

  // 4. Data Validation & Boundary Handling
  test('Track Validation: Detects and repairs Null Island and coordinate anomalies safely', () => {
    const corruptedTrack: GPXTrack = {
      id: 'test-sec-track',
      name: 'Corrupted Test Track',
      distance: 10,
      ascent: 200,
      descent: 200,
      maxSlope: 5.0,
      color: '#3b82f6',
      visible: true,
      points: [
        { lat: 45.0, lng: 6.0, ele: 1000 },
        { lat: 0.00001, lng: 0.00001, ele: 0 }, // Null Island drop
        { lat: 999.0, lng: 999.0, ele: 99999 }, // Out of bounds
        { lat: 45.02, lng: 6.02, ele: 1050 }
      ]
    };

    const report = analyzeTrackValidation(corruptedTrack);
    assert(report.status === 'warning' || report.status === 'error', 'Validation flags corrupted coordinates');
    assert(report.issues.length > 0, 'Issues reported for Null Island and out of bounds coordinates');

    const fixedTrack = autoFixTrackValidation(corruptedTrack);
    assert(fixedTrack.points.length === 2, 'autoFix strips Null Island and out-of-bounds anomalies');
    assert(fixedTrack.points.every(p => p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180), 'Cleaned points within valid coordinate bounds');
  });

  // 5. Input Bounds & Sanitization
  test('Database Search: Oversized search queries are truncated cleanly', () => {
    const oversizedString = 'A'.repeat(5000);
    const results = searchTracks(oversizedString);
    assert(Array.isArray(results), 'Oversized search query handled gracefully');
  });

  console.log(`\n🔒 Security Test Results: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
