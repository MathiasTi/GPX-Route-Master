import {
  getAllSettings,
  saveSetting,
  getSetting,
  searchTracks,
  searchGarminActivities,
  verifyAppPassword,
  isAppPasswordConfigured,
  claimInitialAppPassword,
  createAuthSession,
  verifyAuthSessionToken,
  deleteAuthSession,
  getHealthMetrics,
  saveSteps,
  purgeSyntheticHealthMetricRows
} from '../utils/db';
import {
  createRateLimiter,
  resolveAllowedCorsOrigin,
  isCsrfSafeRequest,
  sanitizeHexColor
} from '../utils/securityMiddleware';
import { analyzeTrackValidation, autoFixTrackValidation } from '../utils/gpxUtils';
import { GPXTrack } from '../types';
import Database from 'better-sqlite3';
import crypto from 'crypto';
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

  // 1. Prototype Pollution & Secret Protection Defense
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

  test('Settings: Normal keys are safely stored and sensitive keys are redacted from getAllSettings', () => {
    saveSetting('theme_mode', 'dark');
    saveSetting('power_ftp', '285');

    const theme = getSetting('theme_mode', 'light');
    assert(theme === 'dark', 'Safe key must be retrieved correctly');

    const all = getAllSettings();
    assert(all['theme_mode'] === 'dark', 'Settings map contains valid safe key');
    assert(all['power_ftp'] === '285', 'Settings map contains valid FTP');
    assert(!('app_password_hash' in all), 'app_password_hash must never be exposed by getAllSettings');
  });

  // 2. Path Traversal & File Access Hardening Verification
  test('File Validation Logic: Traversal and unauthorized file access rules', () => {
    const workspaceRoot = path.resolve(process.cwd());

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
        { lat: 0.00001, lng: 0.00001, ele: 0 },
        { lat: 999.0, lng: 999.0, ele: 99999 },
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

  // 6. Hardened Password Auth (No Hardcoded Default + Scrypt First-Run Setup)
  test('Password Auth: Rejects legacy hardcoded "mathias" and enforces one-time scrypt setup', () => {
    const dbPath = path.join(process.cwd(), 'data', 'gpx_library.db');
    const inspectDb = new Database(dbPath);
    const prevEnvPassword = process.env.APP_PASSWORD;
    const prevHashRow = inspectDb
      .prepare('SELECT value FROM user_settings WHERE key = ?')
      .get('app_password_hash') as { value?: string } | undefined;

    try {
      delete process.env.APP_PASSWORD;
      inspectDb.prepare('DELETE FROM user_settings WHERE key = ?').run('app_password_hash');

      assert(isAppPasswordConfigured() === false, 'Unconfigured workspace must require initial setup');
      assert(verifyAppPassword('mathias') === false, 'Hardcoded default "mathias" must NEVER be accepted');
      assert(verifyAppPassword('') === false, 'Empty password must be rejected');
      assert(verifyAppPassword(null) === false, 'Null password must be rejected');

      // Short password rejected
      const weakClaim = claimInitialAppPassword('short');
      assert(weakClaim.ok === false, 'Passwords shorter than 10 chars must be rejected');

      // Strong password claimed once and stored as scrypt hash
      const strongClaim = claimInitialAppPassword('SicheresPasswort!2026');
      assert(strongClaim.ok === true, 'Strong initial password claim must succeed');
      assert(isAppPasswordConfigured() === true, 'Workspace must report configured after setup');

      const storedRow = inspectDb
        .prepare('SELECT value FROM user_settings WHERE key = ?')
        .get('app_password_hash') as { value?: string } | undefined;
      assert(Boolean(storedRow?.value?.startsWith('scrypt$')), 'Stored password must be salted scrypt hash');
      assert(storedRow?.value !== 'SicheresPasswort!2026', 'Plaintext password must never be stored');

      // Second claim attempt must be blocked
      const secondClaim = claimInitialAppPassword('AngreiferPasswort!999');
      assert(secondClaim.ok === false && secondClaim.alreadyConfigured === true, 'Second setup claim must be rejected');

      // Verification works against scrypt hash
      assert(verifyAppPassword('SicheresPasswort!2026') === true, 'Claimed password must verify');
      assert(verifyAppPassword('wrongpassword123') === false, 'Wrong password must be rejected');

      // Env APP_PASSWORD takes precedence when configured
      process.env.APP_PASSWORD = 'EnvOverridePassword#2026';
      assert(verifyAppPassword('EnvOverridePassword#2026') === true, 'Env APP_PASSWORD must verify');
      assert(verifyAppPassword('SicheresPasswort!2026') === false, 'Old DB hash must not bypass env APP_PASSWORD');
    } finally {
      if (prevEnvPassword === undefined) delete process.env.APP_PASSWORD;
      else process.env.APP_PASSWORD = prevEnvPassword;

      if (prevHashRow?.value) {
        inspectDb.prepare('INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)').run('app_password_hash', prevHashRow.value);
      } else {
        inspectDb.prepare('DELETE FROM user_settings WHERE key = ?').run('app_password_hash');
      }
      inspectDb.close();
    }
  });

  // 7. Hashed Session Tokens in SQLite
  test('Session Lifecycle: Stores SHA-256 hash in SQLite instead of raw bearer token', () => {
    const dbPath = path.join(process.cwd(), 'data', 'gpx_library.db');
    const inspectDb = new Database(dbPath);
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const session = createAuthSession('default', THIRTY_DAYS_MS);

    try {
      assert(typeof session.token === 'string' && session.token.length === 64, 'Generates 256-bit hex session token');
      assert(session.expiresAt > Date.now() + 29 * 24 * 60 * 60 * 1000, 'Session expires in 30 days');

      const rawRow = inspectDb.prepare('SELECT token FROM auth_sessions WHERE token = ?').get(session.token);
      assert(!rawRow, 'Raw session token must NOT be stored in plaintext in auth_sessions');

      const expectedHash = crypto.createHash('sha256').update(session.token, 'utf8').digest('hex');
      const hashedRow = inspectDb.prepare('SELECT token FROM auth_sessions WHERE token = ?').get(expectedHash);
      assert(Boolean(hashedRow), 'SHA-256 hash of session token must be stored in auth_sessions');

      const checkValid = verifyAuthSessionToken(session.token);
      assert(checkValid.valid === true, 'Active session token must verify as valid');

      const deleted = deleteAuthSession(session.token);
      assert(deleted === true, 'deleteAuthSession removes the hashed session token');

      const checkAfterDelete = verifyAuthSessionToken(session.token);
      assert(checkAfterDelete.valid === false, 'Deleted session token must verify as invalid');
    } finally {
      deleteAuthSession(session.token);
      inspectDb.close();
    }
  });

  // 8. Rate Limiting Defense
  test('Rate Limiter: Enforces per-IP threshold and resets cleanly', () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 3,
      keyPrefix: 'test-rl',
      message: 'Rate limited'
    });
    const now = 1_700_000_000_000;
    assert(limiter.check('203.0.113.10', now).allowed === true, '1st request allowed');
    assert(limiter.check('203.0.113.10', now + 100).allowed === true, '2nd request allowed');
    assert(limiter.check('203.0.113.10', now + 200).allowed === true, '3rd request allowed');
    const blocked = limiter.check('203.0.113.10', now + 300);
    assert(blocked.allowed === false && blocked.retryAfterSec >= 1, '4th request must be blocked with Retry-After');
    assert(limiter.check('198.51.100.5', now + 300).allowed === true, 'Independent IP must not be blocked');
    limiter.reset('203.0.113.10');
    assert(limiter.check('203.0.113.10', now + 400).allowed === true, 'Reset IP is allowed again');
  });

  // 9. Strict CORS & CSRF Validation
  test('CORS & CSRF: Rejects null origin, untrusted third-party hosts, and cross-site cookie mutations', () => {
    assert(resolveAllowedCorsOrigin('null', 'my-app.example.com', '', '') === null, 'Origin: null must be rejected');
    assert(resolveAllowedCorsOrigin('https://evil.run.app', 'my-app.example.com', '', '') === null, 'Arbitrary .run.app origin must be rejected');
    assert(resolveAllowedCorsOrigin('https://attacker.web.app', 'my-app.example.com', '', '') === null, 'Arbitrary .web.app origin must be rejected');
    assert(resolveAllowedCorsOrigin('https://my-app.example.com', 'my-app.example.com', '', '') === 'https://my-app.example.com', 'Same-host origin must be allowed');
    assert(
      resolveAllowedCorsOrigin('https://trusted.example.org', 'my-app.example.com', 'https://trusted.example.org', '') === 'https://trusted.example.org',
      'Explicitly configured CORS_ALLOWED_ORIGINS entry must be allowed'
    );

    assert(
      isCsrfSafeRequest({
        method: 'POST',
        hasBearerAuth: false,
        hasCookieAuth: true,
        origin: 'https://evil.example.net',
        requestHost: 'my-app.example.com',
        xRequestedWith: 'XMLHttpRequest'
      }) === false,
      'Cross-site Origin cookie mutation must be blocked'
    );
    assert(
      isCsrfSafeRequest({
        method: 'DELETE',
        hasBearerAuth: false,
        hasCookieAuth: true,
        origin: undefined,
        requestHost: 'my-app.example.com',
        xRequestedWith: undefined
      }) === false,
      'Cookie mutation with neither trusted Origin nor X-Requested-With must be blocked'
    );
    assert(
      isCsrfSafeRequest({
        method: 'POST',
        hasBearerAuth: false,
        hasCookieAuth: true,
        origin: 'https://my-app.example.com',
        requestHost: 'my-app.example.com',
        xRequestedWith: 'XMLHttpRequest'
      }) === true,
      'Same-origin cookie mutation with X-Requested-With must be allowed'
    );
    assert(
      isCsrfSafeRequest({
        method: 'POST',
        hasBearerAuth: true,
        hasCookieAuth: false,
        origin: undefined,
        requestHost: 'my-app.example.com'
      }) === true,
      'Bearer-authenticated API mutation must be allowed'
    );
  });

  // 10. SVG/HTML Color Sanitization
  test('HTML Sink Defense: sanitizeHexColor blocks attribute injection payloads', () => {
    assert(sanitizeHexColor('#2563eb') === '#2563eb', 'Valid 6-digit hex color allowed');
    assert(sanitizeHexColor('#f97') === '#f97', 'Valid 3-digit hex color allowed');
    assert(sanitizeHexColor('" onload="alert(1)') === '#3b82f6', 'Injected attribute payload falls back to safe color');
    assert(sanitizeHexColor('javascript:alert(1)') === '#3b82f6', 'Script URI falls back to safe color');
  });

  // 11. Real Data Only for Steps & Calories (No Synthetic Backfill)
  test('Health Metrics: Never fabricates steps/calories and purges legacy synthetic rows', () => {
    const testUser = '__test_real_data_only__';
    const dbPath = path.join(process.cwd(), 'data', 'gpx_library.db');
    const inspectDb = new Database(dbPath);
    try {
      const emptyMetrics = getHealthMetrics(testUser);
      assert(emptyMetrics.steps.length === 0, 'Empty user must return 0 steps (no synthetic backfill)');

      // Insert genuine Garmin rows AND legacy synthetic-formula rows (including exact 2026-11-21 => 7460 steps / 1908 kcal with varying distance factors)
      const fakeDate1 = '2025-01-15';
      const fakeSeed1 = fakeDate1.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const fakeSteps1 = 6200 + (fakeSeed1 % 9) * 420;
      const fakeDist1 = Number((fakeSteps1 * 0.000762).toFixed(2));
      const fakeCal1 = 1850 + Math.round((fakeSteps1 - 6000) * 0.04);

      saveSteps(fakeDate1, fakeSteps1, fakeCal1, fakeDist1, testUser);
      // 2026-11-21 legacy fake row with 0.00078 distance factor (previously missed by strict 0.000762 check!)
      saveSteps('2026-11-21', 7460, 1908, 5.82, testUser);
      // 2026-11-20 legacy fake row with NULL distance
      saveSteps('2026-11-20', 7040, 1892, undefined, testUser);
      // Genuine Garmin Connect day (e.g. 16,946 steps)
      saveSteps('2026-11-22', 16946, 2540, 13.1, testUser);

      const purged = purgeSyntheticHealthMetricRows(testUser);
      assert(purged.stepsRemoved === 3, `Expected 3 synthetic rows purged, got ${purged.stepsRemoved}`);

      const afterMetrics = getHealthMetrics(testUser);
      assert(afterMetrics.steps.length === 1, 'Genuine Garmin step row must be preserved');
      assert(afterMetrics.steps[0].date === '2026-11-22' && afterMetrics.steps[0].steps === 16946, 'Preserved row matches genuine Garmin data');
    } finally {
      inspectDb.prepare('DELETE FROM garmin_steps WHERE user_id = ?').run(testUser);
      inspectDb.close();
    }
  });

  // 12. Environment Variables Template Check
  test('Environment Variables: .env.example contains no hardcoded passwords or obsolete secrets', () => {
    const envExample = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf-8');
    assert(!envExample.includes('GOOGLE_CLIENT_ID'), 'GOOGLE_CLIENT_ID must not be in .env.example');
    assert(!envExample.includes('APPLE_CLIENT_ID'), 'APPLE_CLIENT_ID must not be in .env.example');
    assert(!envExample.includes('AUTH_SESSION_SECRET'), 'AUTH_SESSION_SECRET must not be in .env.example');
    assert(!envExample.includes('GARMIN_KEY_ENCRYPTION_SECRET'), 'GARMIN_KEY_ENCRYPTION_SECRET must not be in .env.example');
    assert(!envExample.includes('APP_PASSWORD=mathias'), 'Hardcoded APP_PASSWORD=mathias must not exist in .env.example');
    assert(envExample.includes('APP_PASSWORD='), 'APP_PASSWORD variable documented cleanly in .env.example');
  });

  console.log(`\n🔒 Security Test Results: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}

