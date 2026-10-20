import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIndoorBikeData, encodeTargetPower, encodeSimulation, OPCODE } from '../src/ble/ftms-trainer.js';
import { parseButtons, readProtobufFields, ButtonTracker } from '../src/ble/zwift-click.js';
import { parseHeartRate } from '../src/ble/heart-rate-monitor.js';

const view = (bytes) => new DataView(Uint8Array.from(bytes).buffer);

test('Indoor Bike Data: speed, cadence, power', () => {
  // flags 0x0044 = cadence + power present (speed present because bit 0 is clear)
  // speed 3240 (32.40 km/h), cadence 180 (90 rpm), power 250 W
  const d = parseIndoorBikeData(view([0x44, 0x00, 0xa8, 0x0c, 0xb4, 0x00, 0xfa, 0x00]));
  assert.ok(Math.abs(d.speed - 9) < 1e-9);
  assert.equal(d.cadence, 90);
  assert.equal(d.power, 250);
});

test('Indoor Bike Data: "more data" split packet and skipped fields', () => {
  // flags 0x0261: more data (no speed), resistance, power, heart rate
  const d = parseIndoorBikeData(view([0x61, 0x02, 0x10, 0x00, 0x2c, 0x01, 0x8c]));
  assert.equal(d.speed, undefined);
  assert.equal(d.power, 300);
  assert.equal(d.hr, 140);
});

test('control point payloads', () => {
  assert.deepEqual(encodeTargetPower(260), [OPCODE.SET_TARGET_POWER, 0x04, 0x01]);
  assert.deepEqual(encodeTargetPower(5000), [OPCODE.SET_TARGET_POWER, 0xd0, 0x07]); // clamped to 2000
  assert.deepEqual(encodeSimulation(-2.5), [OPCODE.SET_SIMULATION, 0, 0, 0x06, 0xff, 40, 51]); // -250 as int16
});

test('protobuf reader handles multi-byte varints and skips other wire types', () => {
  // field 1 = 300 (varint), field 2 = bytes "ab", field 3 = 1
  assert.deepEqual(readProtobufFields(Uint8Array.from([0x08, 0xac, 0x02, 0x12, 0x02, 0x61, 0x62, 0x18, 0x01])), { 1: 300, 3: 1 });
  assert.deepEqual(readProtobufFields(Uint8Array.from([0x08, 0x80])), {}); // truncated
});

test('Click keypad messages', () => {
  assert.deepEqual(parseButtons(Uint8Array.from([0x37, 0x08, 0x00, 0x10, 0x01])), { plus: true, minus: false });
  assert.deepEqual(parseButtons(Uint8Array.from([0x37, 0x08, 0x01, 0x10, 0x00])), { plus: false, minus: true });
  assert.deepEqual(parseButtons(Uint8Array.from([0x37, 0x08, 0x01, 0x10, 0x01])), { plus: false, minus: false });
  assert.equal(parseButtons(Uint8Array.from([0x15])), null); // keep-alive
  assert.equal(parseButtons(new Uint8Array()), null);
});

test('Ride keypad bitmap (Click v2)', () => {
  const bitmap = 0xffffffff & ~0x2000; // right shift-up pressed
  const bytes = [0x23, 0x08];
  let v = bitmap >>> 0;
  while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
  bytes.push(v);
  assert.deepEqual(parseButtons(Uint8Array.from(bytes)), { plus: true, minus: false });
});

test('button tracker reports presses only on the way down', () => {
  const t = new ButtonTracker();
  assert.deepEqual(t.update({ plus: true, minus: false }).presses, ['plus']);
  assert.deepEqual(t.update({ plus: true, minus: false }), { changes: [], presses: [] });
  assert.deepEqual(t.update({ plus: false, minus: false }), { changes: [{ button: 'plus', down: false }], presses: [] });
});

test('heart rate, 8- and 16-bit', () => {
  assert.equal(parseHeartRate(view([0x00, 72])), 72);
  assert.equal(parseHeartRate(view([0x01, 0x2c, 0x01])), 300);
});
