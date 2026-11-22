import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatChipHeartRate, describeBattery, LOW_BATTERY_PERCENT } from '../src/core/device-status.js';
import { parseBatteryLevel } from '../src/ble/battery.js';

const view = (bytes) => new DataView(Uint8Array.from(bytes).buffer);

test('chip heart rate shows bpm, or dashes while the strap has no contact', () => {
  assert.deepEqual(formatChipHeartRate(142), { value: '142', unit: 'bpm' });
  assert.deepEqual(formatChipHeartRate(141.6), { value: '142', unit: 'bpm' });
  assert.deepEqual(formatChipHeartRate(0), { value: '--', unit: 'bpm' });
  assert.deepEqual(formatChipHeartRate(null), { value: '--', unit: 'bpm' });
});

test('battery wording and low warning', () => {
  assert.deepEqual(describeBattery(80), { text: '80%', low: false });
  assert.deepEqual(describeBattery(LOW_BATTERY_PERCENT), { text: `${LOW_BATTERY_PERCENT}%`, low: true });
  assert.equal(describeBattery(null), null);
  assert.equal(describeBattery(undefined), null);
});

test('Battery Level parser accepts 0–100 and rejects junk', () => {
  assert.equal(parseBatteryLevel(view([87])), 87);
  assert.equal(parseBatteryLevel(view([0])), 0);
  assert.equal(parseBatteryLevel(view([0xff])), null);
  assert.equal(parseBatteryLevel(view([])), null);
});
