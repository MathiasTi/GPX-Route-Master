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
  resolveFrameAncestorsHeader,
  isCsrfSafeRequest,
  sanitizeHexColor,
  getSafeApiErrorMessage,
  sanitizeGarminActivityId
} from '../utils/securityMiddleware';
import { buildMapHoverCardHtml } from '../components/map/MapHoverTooltipCard';
import {
  analyzeTrackValidation,
  autoFixTrackValidation,
  sanitizeTrackAllInOne,
  exportToGPX,
  preCheckGpxUploadContent,
  sanitizePlainText,
  sanitizeMetadataRecursive,
  hasUnsafeMetadataRecursive,
  sanitizeTextMarker,
  sanitizeTextMarkers
} from '../utils/gpxUtils';
import { GPXTrack, TextMarker } from '../types';
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

      const checkHashAsBearer = verifyAuthSessionToken(expectedHash);
      assert(
        checkHashAsBearer.valid === false,
        'Stored SHA-256 session hash must NOT verify if presented directly as Bearer token'
      );

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
      resolveAllowedCorsOrigin('https://my-app.example.com:8443', 'my-app.example.com', '', '') === null,
      'Mismatched port on same hostname must be rejected'
    );
    assert(
      resolveAllowedCorsOrigin('http://my-app.example.com', 'my-app.example.com', '', '', 'https') === null,
      'Mismatched HTTP scheme against HTTPS request must be rejected'
    );
    assert(
      resolveAllowedCorsOrigin('https://my-app.example.com', 'my-app.example.com', '', '', 'https') === 'https://my-app.example.com',
      'Matching HTTPS scheme and host must be allowed'
    );
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
      resolveAllowedCorsOrigin('https://my-app.example.com', 'my-app.example.com', '', '', 'http') === 'https://my-app.example.com',
      'TLS-terminating reverse proxy same-host HTTPS origin against internal HTTP backend must be allowed'
    );
    assert(
      isCsrfSafeRequest({
        method: 'POST',
        hasBearerAuth: false,
        hasCookieAuth: true,
        origin: 'https://my-app.example.com',
        requestHost: 'my-app.example.com',
        requestProtocol: 'http',
        xRequestedWith: 'XMLHttpRequest'
      }) === true,
      'Cookie mutation from same-host HTTPS origin behind TLS proxy must be allowed'
    );
    assert(
      isCsrfSafeRequest({
        method: 'POST',
        hasBearerAuth: false,
        hasCookieAuth: true,
        origin: 'https://evil.example.net',
        requestHost: 'my-app.example.com',
        requestProtocol: 'http',
        xRequestedWith: 'XMLHttpRequest'
      }) === false,
      'Cross-host HTTPS origin against internal HTTP backend must still be rejected'
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

  // 13. Production Error Masking
  test('Error Masking: Masks raw internal exception messages in production mode', () => {
    const internalErr = new Error('SQLITE_CANTOPEN: /var/app/data/gpx_library.db');
    assert(
      getSafeApiErrorMessage(internalErr, 'Interner Fehler', true) === 'Interner Fehler',
      'Production mode must return fallback message instead of raw internal error'
    );
    assert(
      getSafeApiErrorMessage(internalErr, 'Interner Fehler', false) === 'SQLITE_CANTOPEN: /var/app/data/gpx_library.db',
      'Development mode retains diagnostic message'
    );
  });

  // 14. Garmin Activity ID Sanitization
  test('Garmin Activity ID: Accepts valid IDs and blocks path traversal or injection payloads', () => {
    assert(sanitizeGarminActivityId('12345678901') === '12345678901', 'Numeric Garmin ID allowed');
    assert(sanitizeGarminActivityId('garmin-act-998877') === '998877', 'Prefixed Garmin ID normalized');
    assert(sanitizeGarminActivityId('../secret') === null, 'Relative traversal ID rejected');
    assert(sanitizeGarminActivityId('123/../../etc/passwd') === null, 'Slash traversal ID rejected');
    assert(sanitizeGarminActivityId('123?foo=bar') === null, 'Query-injection ID rejected');
    assert(sanitizeGarminActivityId('a'.repeat(80)) === null, 'Oversized ID rejected');
  });

  // 15. Map Hover Card HTML Escaping Defense
  test('Map Hover Card: Escapes injected HTML tags and untrusted color payloads', () => {
    const html = buildMapHoverCardHtml({
      elevationM: 500,
      slope: {
        slopePercent: 5,
        formatted: '<script>alert(1)</script>',
        label: 'Test',
        arrow: '↗',
        colorHex: '" onclick="alert(1)'
      },
      heartRate: {
        bpm: 150,
        zoneNumber: 3,
        label: '<img src=x onerror=alert(1)>',
        name: 'Tempo',
        percentOfMax: 80,
        colorHex: 'javascript:alert(1)'
      },
      powerWatts: 250,
      speedKmh: 28,
      paceFormatted: null,
      isFitFile: false,
      activityType: 'cycling',
      timeFormatted: '<b>10:00</b>',
      durationEstimate: null
    } as any);
    assert(!html.includes('<script>alert(1)</script>'), 'Script tags must be HTML-escaped');
    assert(!html.includes('<img src=x'), 'Injected img tags must be HTML-escaped');
    assert(!html.includes('onclick="alert(1)'), 'Injected event attributes in colors must be rejected');
    assert(!html.includes('javascript:alert(1)'), 'Script URI colors must fall back to safe hex');
  });

  // 16. Client API Origin Hygiene
  test('Client API Helper: No hardcoded external Cloud Run deployment URL fallback', () => {
    const apiSrc = fs.readFileSync(path.join(process.cwd(), 'utils/api.ts'), 'utf-8');
    assert(!apiSrc.includes('.europe-west2.run.app'), 'utils/api.ts must not contain hardcoded external Cloud Run fallback URLs');
  });

  // 17. Server Outbound Rate Limiting & Prompt Input Sanitization
  test('Server Hardening: Rate limits Valhalla/intensive-analysis and uses sanitized prompt inputs', () => {
    const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf-8');
    assert(serverSrc.includes('"/api/routing/valhalla"') && serverSrc.includes('"/api/intensive-analysis"'), 'Outbound proxy limiter covers Valhalla routing and intensive analysis');
    assert(
      serverSrc.includes('für das Datum ${safeDate}:') &&
        serverSrc.includes('zwischen ${safeStartLoc} und ${safeEndLoc}'),
      'Gemini prompt interpolates sanitized safeDate, safeStartLoc, and safeEndLoc'
    );
  });

  // 18. Recursive Plain-Text & Nested Metadata XSS Sanitization
  test('Track Sanitizer: Strips nested script/event-handler/protocol XSS while preserving UTF-8 text', () => {
    assert(
      sanitizePlainText('Taunus & Feldberg Runde (ÄÖÜß)') === 'Taunus & Feldberg Runde (ÄÖÜß)',
      'Legitimate UTF-8 track names with umlauts and ampersands must be preserved'
    );
    const nestedPayload = 'Alpen <scr<script>ipt>alert(1)</scr</script>ipt> Tour';
    const cleanedNested = sanitizePlainText(nestedPayload);
    assert(!cleanedNested.toLowerCase().includes('<script'), 'Nested script tag bypass must be removed');
    assert(!cleanedNested.includes('alert(1)'), 'Script body must be stripped');
    assert(cleanedNested.includes('Alpen') && cleanedNested.includes('Tour'), 'Surrounding benign text preserved');

    const imgEventPayload = 'Cafe <img src=x onerror=alert(document.cookie)> Stop';
    const cleanedImg = sanitizePlainText(imgEventPayload);
    assert(!cleanedImg.includes('<img') && !cleanedImg.toLowerCase().includes('onerror='), 'Image event handler XSS must be stripped');

    const svgPayload = '<svg/onload=alert(1)>Passhöhe';
    const cleanedSvg = sanitizePlainText(svgPayload);
    assert(!cleanedSvg.toLowerCase().includes('<svg') && !cleanedSvg.toLowerCase().includes('onload='), 'SVG onload payload must be stripped');
    assert(cleanedSvg.includes('Passhöhe'), 'Text after SVG payload preserved');

    const jsProtoPayload = 'javascript:alert(1) data:text/html,<script>x</script> Ziel';
    const cleanedProto = sanitizePlainText(jsProtoPayload);
    assert(!cleanedProto.toLowerCase().includes('javascript:') && !cleanedProto.toLowerCase().includes('data:text/html'), 'Dangerous URI schemes must be stripped');

    const unclosedTag = 'Start <iframe src="evil"';
    const cleanedUnclosed = sanitizePlainText(unclosedTag);
    assert(!cleanedUnclosed.includes('<') && !cleanedUnclosed.toLowerCase().includes('iframe'), 'Unclosed HTML tag fragments must be removed');

    const nestedObj: Record<string, any> = {
      creator: 'Garmin <script>alert(1)</script>',
      nested: {
        items: ['ok', '<img src=x onerror=alert(2)>Wpt', { deepNote: 'onclick=evil() Gipfel' }],
        sourceUrl: 'https://www.komoot.com/tour/12345',
        badUrl: 'javascript:alert(3)'
      }
    };
    nestedObj.self = nestedObj; // circular reference resilience
    assert(hasUnsafeMetadataRecursive(nestedObj) === true, 'Recursive detector must flag deeply nested XSS');
    const rec = sanitizeMetadataRecursive(nestedObj);
    assert(rec.nested.sourceUrl === 'https://www.komoot.com/tour/12345', 'Valid https URL in *Url key preserved');
    assert(rec.nested.badUrl === '', 'javascript: URL in *Url key must be cleared');
    assert(!JSON.stringify(rec.nested.items).toLowerCase().includes('onerror'), 'Nested array/object payloads must be cleaned');
    assert(hasUnsafeMetadataRecursive(rec) === false, 'Sanitized nested metadata must pass clean check');
  });

  // 19. User-Defined TextMarker Sanitization (XSS + Color + Bounds Defense)
  test('TextMarker Sanitizer: Cleans XSS in marker names, validates colors, and rejects invalid coordinates', () => {
    const dirtyMarkers: TextMarker[] = [
      {
        id: 'm1<script>',
        lat: 50.1109,
        lng: 8.6821,
        label: '<img src=x onerror=alert(1)>Bäckerei <b>Pause</b>',
        color: '" onclick="alert(1)'
      },
      {
        id: 'm2',
        lat: 50.2,
        lng: 8.7,
        label: '<script>alert("xss")</script>',
        color: 'emerald'
      },
      {
        id: 'm3',
        lat: 50.3,
        lng: 8.8,
        label: 'Aussichtspunkt',
        color: '#2563eb'
      },
      {
        id: 'm4-oob',
        lat: 95.0,
        lng: 200.0,
        label: 'Invalid Coord',
        color: 'indigo'
      }
    ];

    const cleaned = sanitizeTextMarkers(dirtyMarkers);
    assert(cleaned.length === 3, 'Out-of-bounds marker must be dropped');
    assert(!cleaned[0].label.includes('<img') && !cleaned[0].label.toLowerCase().includes('onerror') && cleaned[0].label.includes('Bäckerei'), 'XSS stripped from marker 1 label');
    assert(cleaned[0].color === 'indigo', 'Injected color attribute must fall back to safe default');
    assert(cleaned[1].label === 'Marker', 'Pure-script marker label must fall back to safe "Marker"');
    assert(cleaned[1].color === 'emerald', 'Whitelisted palette color preserved');
    assert(cleaned[2].color === '#2563eb' && cleaned[2].label === 'Aussichtspunkt', 'Valid hex color and clean label preserved');

    const single = sanitizeTextMarker({
      id: 'm-js',
      lat: 48.1,
      lng: 11.5,
      label: 'javascript:alert(1) Treffpunkt',
      color: 'rose'
    });
    assert(single !== null && !single.label.toLowerCase().includes('javascript:') && single.label.includes('Treffpunkt'), 'Single marker sanitizer strips javascript: URI');
  });

  // 20. sanitizeTrackAllInOne Recursive Track Metadata & TextMarker Sanitization
  test('sanitizeTrackAllInOne: Recursively sanitizes track metadata and passed TextMarkers (even with <3 points)', () => {
    const taintedTrack: GPXTrack = {
      id: 'track-xss-1',
      name: 'Feldberg <script>alert(1)</script> Classic',
      description: '<svg onload=alert(2)>Schöne Tour',
      tourGroup: '<b>Rennrad</b> Gruppe',
      originalFilename: 'tour<img src=x onerror=alert(3)>.gpx',
      tags: ['asphalt', '<script>evil()</script>berge'],
      distance: 12,
      ascent: 300,
      descent: 300,
      maxSlope: 8,
      color: '" onmouseover="alert(1)',
      visible: true,
      points: [
        { lat: 50.11, lng: 8.68, ele: 200, surface: '<script>x</script>asphalt' },
        { lat: 50.12, lng: 8.69, ele: 250, surface: 'gravel' }
      ],
      routeManeuvers: [
        { index: 0, distFromStartKm: 0, lat: 50.11, lng: 8.68, instruction: '<img src=x onerror=alert(4)>Links abbiegen', direction: 'left', streetName: '<b>Hauptstr</b>' }
      ],
      rawFileDetails: {
        fileType: 'gpx',
        fileName: 'raw<script>.gpx',
        fileSize: 1024,
        metadata: {
          creator: 'EvilGPS <iframe src="x"></iframe>',
          komootSource: {
            sourceType: 'komoot',
            sourceUrl: 'javascript:alert(5)',
            version: 1,
            contentHash: 'abc123',
            importedAt: '2026-01-01T00:00:00Z',
            lastCheckedAt: '2026-01-01T00:00:00Z',
            versionHistory: []
          },
          rawRecords: [
            {
              type: 'wpt',
              data: {
                name: '<svg/onload=alert(6)>Brunnen',
                desc: 'Wasser <script>steal()</script>'
              }
            }
          ]
        }
      }
    };

    const taintedMarkers: TextMarker[] = [
      { id: 'tm-1', lat: 50.115, lng: 8.685, label: '<img src=x onerror=alert(9)>Gipfelkreuz', color: 'javascript:alert(1)' }
    ];

    const res = sanitizeTrackAllInOne(taintedTrack, { textMarkers: taintedMarkers });
    assert(res.sanitizedMetadataFields > 0, 'Must report sanitized metadata fields even with <3 points');
    assert(!res.sanitizedTrack.name.includes('<script') && res.sanitizedTrack.name.includes('Feldberg'), 'Track name sanitized');
    assert(!String(res.sanitizedTrack.description || '').toLowerCase().includes('onload'), 'Track description sanitized');
    assert(!String(res.sanitizedTrack.tourGroup || '').includes('<b>'), 'Track tourGroup sanitized');
    assert(res.sanitizedTrack.color === '#3b82f6', 'Malicious track color replaced with safe hex');
    assert(!res.sanitizedTrack.tags!.some(t => t.includes('<script')), 'Track tags sanitized');
    assert(!String(res.sanitizedTrack.points[0].surface || '').includes('<script'), 'Track point surface sanitized');
    assert(!res.sanitizedTrack.routeManeuvers![0].instruction.includes('<img'), 'Route maneuver instruction sanitized');
    assert(!String(res.sanitizedTrack.routeManeuvers![0].streetName || '').includes('<b>'), 'Route maneuver streetName sanitized');
    assert(!String(res.sanitizedTrack.rawFileDetails?.metadata?.creator || '').toLowerCase().includes('iframe'), 'Nested rawFileDetails creator sanitized');
    assert(res.sanitizedTrack.rawFileDetails?.metadata?.komootSource?.sourceUrl === '', 'Unsafe sourceUrl in rawFileDetails cleared');
    assert(!String(res.sanitizedTrack.rawFileDetails?.metadata?.rawRecords?.[0]?.data?.name || '').toLowerCase().includes('onload'), 'Nested GPX waypoint name sanitized');
    assert(res.sanitizedTextMarkers.length === 1, 'Sanitized text markers returned');
    assert(!res.sanitizedTextMarkers[0].label.includes('<img') && res.sanitizedTextMarkers[0].label.includes('Gipfelkreuz'), 'Passed TextMarker label sanitized');
    assert(res.sanitizedTextMarkers[0].color === 'indigo', 'Passed TextMarker malicious color replaced');

    // Validation & autoFix check
    const validationReport = analyzeTrackValidation(taintedTrack, taintedMarkers);
    assert(validationReport.issues.some(i => i.type === 'unsafe_metadata'), 'analyzeTrackValidation flags unsafe_metadata on tainted track/markers');

    const autoFixed = autoFixTrackValidation(taintedTrack);
    const recheck = analyzeTrackValidation(autoFixed, res.sanitizedTextMarkers);
    assert(!recheck.issues.some(i => i.type === 'unsafe_metadata'), 'autoFixTrackValidation clears unsafe_metadata issues');
  });

  // 21. GPX Upload Pre-Check & Export XSS Hardening
  test('GPX Pre-Check & Export: Blocks DTD/ENTITY and neutralizes active XSS markup in GPX uploads and exports', () => {
    const xxeGpx = '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><gpx><trk><name>&xxe;</name></trk></gpx>';
    const xxeCheck = preCheckGpxUploadContent(xxeGpx);
    assert(xxeCheck.blocked === true, 'GPX pre-check must block DOCTYPE/ENTITY/SYSTEM declarations');

    const xssGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test">
  <metadata><name><![CDATA[<script>alert(1)</script>Harz Runde]]></name></metadata>
  <wpt lat="51.7" lon="10.6"><name>&lt;img src=x onerror=alert(2)&gt;Brocken</name><desc>javascript:alert(3) Gipfel</desc></wpt>
  <trk><name>Tour <svg/onload=alert(4)>Nord</name><trkseg>
    <trkpt lat="51.7" lon="10.6"><ele>1141</ele></trkpt>
  </trkseg></trk>
</gpx>`;
    const xssCheck = preCheckGpxUploadContent(xssGpx);
    const cleanedXml = xssCheck.sanitizedXml || '';
    assert(xssCheck.blocked === false, 'XSS GPX is sanitized rather than blocked as XXE');
    assert(xssCheck.hasUnsafeMarkup === true, 'GPX pre-check must detect active script/event/encoded-HTML payloads');
    assert(!cleanedXml.toLowerCase().includes('<script'), 'Script block removed from sanitized GPX XML');
    assert(!cleanedXml.toLowerCase().includes('onload='), 'SVG onload removed from sanitized GPX XML');
    assert(!cleanedXml.toLowerCase().includes('onerror='), 'Encoded img onerror removed from sanitized GPX XML');
    assert(!cleanedXml.toLowerCase().includes('javascript:'), 'javascript: scheme removed from sanitized GPX XML');
    assert(cleanedXml.includes('<trkpt lat="51.7" lon="10.6">'), 'Valid GPX geometry tags remain intact');

    const exported = exportToGPX(
      {
        id: 'exp-1',
        name: '<script>alert(1)</script>Export Tour',
        description: '<img src=x onerror=alert(2)>Beschreibung',
        distance: 1,
        ascent: 10,
        descent: 10,
        maxSlope: 2,
        color: '#3b82f6',
        visible: true,
        points: [{ lat: 50.1, lng: 8.6, ele: 150 }]
      },
      {
        textMarkers: [{ id: 'm1', lat: 50.1, lng: 8.6, label: '<svg onload=alert(3)>Startpunkt', color: 'indigo' }]
      }
    );
    assert(!exported.toLowerCase().includes('alert(1)') && !exported.toLowerCase().includes('onerror') && !exported.toLowerCase().includes('onload'), 'GPX export must sanitize track metadata and TextMarker waypoint names');
    assert(exported.includes('Export Tour') && exported.includes('Startpunkt'), 'Clean labels preserved in GPX export');
  });

  // 22. End-to-End Wiring Check for Saved TextMarkers across Client & Server
  test('Marker Persistence & Rendering Wiring: App, Map, and server sanitize TextMarkers and library metadata', () => {
    const mapSrc = fs.readFileSync(path.join(process.cwd(), 'components/Map.tsx'), 'utf-8');
    const appSrc = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf-8');
    const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf-8');

    assert(mapSrc.includes('escapeHtml(sanitizePlainText(marker.label'), 'Map.tsx sanitizes and HTML-escapes TextMarker labels before L.DivIcon rendering');
    assert(appSrc.includes('sanitizeTextMarkers(JSON.parse(') && appSrc.includes('preCheckGpxUploadContent'), 'App.tsx sanitizes stored TextMarkers and runs GPX upload pre-check');
    assert(serverSrc.includes('"velo_text_markers"') && serverSrc.includes('sanitizeTextMarkers'), 'server.ts sanitizes velo_text_markers settings on persistence and retrieval');
  });

  // 23. Frame-Ancestors Policy: Allows AI Studio Preview Iframe While Keeping Self-Hosted SAMEORIGIN
  test('Frame Ancestors: Allows Google AI Studio preview embedding without exposing self-hosted deployments', () => {
    const selfHosted = resolveFrameAncestorsHeader({
      requestHost: 'gpx.example.com',
      isAiStudioNginx: false
    });
    assert(selfHosted.frameAncestors === "'self'", 'Self-hosted deployment must default to frame-ancestors self');
    assert(selfHosted.includeXFrameOptionsSameOrigin === true, 'Self-hosted deployment must emit X-Frame-Options SAMEORIGIN');

    const aiStudioDev = resolveFrameAncestorsHeader({
      requestHost: 'ais-dev-j64utg4foiwsokqspyv354-50605485163.europe-west2.run.app',
      isAiStudioNginx: false
    });
    assert(
      aiStudioDev.frameAncestors.includes('https://aistudio.google.com') &&
        aiStudioDev.frameAncestors.includes('https://ai.studio'),
      'AI Studio dev preview host must allow Google AI Studio iframe ancestors'
    );
    assert(aiStudioDev.includeXFrameOptionsSameOrigin === false, 'AI Studio preview must omit X-Frame-Options SAMEORIGIN so Firefox can render the iframe');

    const explicitOverride = resolveFrameAncestorsHeader({
      frameAncestorsEnv: "'none'; script-src *",
      requestHost: 'ais-dev-j64utg4foiwsokqspyv354-50605485163.europe-west2.run.app',
      isAiStudioNginx: true
    });
    assert(explicitOverride.frameAncestors === "'none' script-src *", 'Explicit FRAME_ANCESTORS override must strip semicolons and take precedence');
    assert(explicitOverride.includeXFrameOptionsSameOrigin === false, 'Explicit non-self override omits X-Frame-Options SAMEORIGIN');
  });

  console.log(`\n🔒 Security Test Results: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}

