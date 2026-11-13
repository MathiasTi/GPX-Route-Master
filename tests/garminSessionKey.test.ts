import assert from 'node:assert/strict';
import {
  sanitizeGarminSessionKey,
  isValidHttpHeaderValue,
  validateGarminSessionKey,
  setSessionGarminKey,
  getSessionGarminKey,
  clearSessionGarminKey,
  garminFetch
} from '../utils/garminSessionKey';

export async function runGarminSessionKeyTests(): Promise<boolean> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      passed++;
    } catch (err: any) {
      failed++;
      console.error(`❌ [GarminSessionKey] ${name}:`, err?.message || err);
    }
  };

  await test('sanitizeGarminSessionKey strips copy-paste artifacts and newlines', () => {
    const dirty = '\uFEFF  abc123\u200B-\r\ndef_456\u00AD  \n';
    assert.equal(sanitizeGarminSessionKey(dirty), 'abc123-def_456');
  });

  await test('validateGarminSessionKey accepts ASCII keys and rejects non-ASCII characters', () => {
    const ok = validateGarminSessionKey('Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig');
    assert.equal(ok.valid, true);

    const badBullets = validateGarminSessionKey('ab••••cd');
    assert.equal(badBullets.valid, false);
    assert.ok(badBullets.error && badBullets.error.length > 0);

    const badUmlaut = validateGarminSessionKey('schlüssel-123');
    assert.equal(badUmlaut.valid, false);
  });

  await test('setSessionGarminKey refuses invalid header characters and stores valid ASCII keys', () => {
    clearSessionGarminKey();
    setSessionGarminKey('bad-key-••••');
    assert.equal(getSessionGarminKey(), '');

    setSessionGarminKey('  valid_ascii_key_123\r\n');
    assert.equal(getSessionGarminKey(), 'valid_ascii_key_123');
    clearSessionGarminKey();
  });

  await test('isValidHttpHeaderValue blocks control chars and non-ASCII', () => {
    assert.equal(isValidHttpHeaderValue('valid-token_123.XYZ'), true);
    assert.equal(isValidHttpHeaderValue('bad\nvalue'), false);
    assert.equal(isValidHttpHeaderValue('bad•value'), false);
    assert.equal(isValidHttpHeaderValue(''), false);
  });

  await test('garminFetch never throws synchronously on header setup', async () => {
    setSessionGarminKey('valid_key_abc');
    const promise = garminFetch('http://127.0.0.1:0/api/garmin/personal/status');
    assert.ok(promise instanceof Promise);
    try {
      await promise;
    } catch {
      // Network connection refused to port 0 is expected in unit test; key assertion is no synchronous TypeError on Headers.set
    } finally {
      clearSessionGarminKey();
    }
  });

  console.log(`✅ [GarminSessionKey] ${passed} passed, ${failed} failed`);
  return failed === 0;
}
