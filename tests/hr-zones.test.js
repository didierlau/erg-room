import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hrReference, hrZoneOf } from '../src/ride/hr-zones.js';

test('hrReference prefers LTHR, falls back to 90% of max, else null', () => {
  assert.equal(hrReference({ lthr: 165, maxHr: 190 }), 165);
  assert.equal(hrReference({ lthr: null, maxHr: 190 }), 171);
  assert.equal(hrReference({ lthr: null, maxHr: null }), null);
  assert.equal(hrReference({}), null);
});

test('hrZoneOf maps a reading to zones 1–6', () => {
  const ref = 160;
  assert.equal(hrZoneOf(120, ref), 1); // 75%
  assert.equal(hrZoneOf(136, ref), 2); // 85%
  assert.equal(hrZoneOf(146, ref), 3); // 91%
  assert.equal(hrZoneOf(155, ref), 4); // 97%
  assert.equal(hrZoneOf(162, ref), 5); // 101%
  assert.equal(hrZoneOf(175, ref), 6); // 109%
  assert.equal(hrZoneOf(null, ref), null);
  assert.equal(hrZoneOf(150, null), null);
});
