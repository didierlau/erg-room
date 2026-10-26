import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSettingsPatch, withFtpResult } from '../src/data/settings.js';

test('FTP must be within range', () => {
  assert.deepEqual(validateSettingsPatch({ ftp: 250 }), { ok: true });
  assert.equal(validateSettingsPatch({ ftp: 49 }).ok, false);
  assert.equal(validateSettingsPatch({ ftp: 601 }).ok, false);
  assert.equal(validateSettingsPatch({ ftp: NaN }).ok, false);
  assert.match(validateSettingsPatch({ ftp: 0 }).error, /between 50 and 600/);
});

test('heart rates are optional but must be plausible when given', () => {
  assert.deepEqual(validateSettingsPatch({ lthr: null }), { ok: true });
  assert.deepEqual(validateSettingsPatch({ maxHr: null }), { ok: true });
  assert.deepEqual(validateSettingsPatch({ lthr: 165, maxHr: 190 }), { ok: true });
  assert.equal(validateSettingsPatch({ lthr: 99 }).ok, false);
  assert.equal(validateSettingsPatch({ maxHr: 231 }).ok, false);
  assert.match(validateSettingsPatch({ maxHr: 50 }).error, /120 and 230/);
});

test('patches without constrained fields pass', () => {
  assert.deepEqual(validateSettingsPatch({ smooth: 3 }), { ok: true });
  assert.deepEqual(validateSettingsPatch({}), { ok: true });
});

test('withFtpResult applies the patch and appends to the history without mutating', () => {
  const before = { ftp: 200, lthr: null, maxHr: null, ftpHistory: [{ date: 1, ftp: 200, method: 'ramp' }] };
  const after = withFtpResult(before, { ftp: 230, lthr: 168 }, 'twenty', 2);
  assert.equal(after.ftp, 230);
  assert.equal(after.lthr, 168);
  assert.equal(after.maxHr, null);
  assert.deepEqual(after.ftpHistory, [{ date: 1, ftp: 200, method: 'ramp' }, { date: 2, ftp: 230, method: 'twenty' }]);
  assert.equal(before.ftp, 200);
  assert.equal(before.ftpHistory.length, 1);
});

test('withFtpResult tolerates settings without a history', () => {
  const after = withFtpResult({ ftp: 200 }, { ftp: 210 }, 'history', 5);
  assert.deepEqual(after.ftpHistory, [{ date: 5, ftp: 210, method: 'history' }]);
});
