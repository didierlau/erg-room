import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FitWriter, fitCrc, toFitTime, FIT_EPOCH_OFFSET } from '../src/fit/fit-writer.js';
import { buildActivityFit, lapRanges } from '../src/fit/activity-file.js';
import { decodeFit } from './helpers/fit-decode.js';

const START = Date.UTC(2026, 9, 20, 18, 0, 0);

function sampleRide(seconds = 900) {
  const S = { t: [], p: [], c: [], h: [], s: [], d: [], g: [] };
  for (let i = 0; i < seconds; i++) {
    S.t.push(i); S.p.push(i < 300 ? 150 : 250); S.c.push(90); S.h.push(i % 60 ? 130 : null);
    S.s.push(8.5); S.d.push(Number(((i + 1) * 8.5).toFixed(1))); S.g.push(Math.floor(i / 300));
  }
  return { start: START, ftp: 250, samples: S };
}

test('CRC matches the FIT SDK check value', () => {
  // CRC of the 12-byte header of a typical file, computed with the FIT SDK algorithm
  assert.equal(fitCrc([]), 0);
  assert.equal(fitCrc(new TextEncoder().encode('123456789')), 0xbb3d); // CRC-16/ARC check value
});

test('toFitTime converts from the Unix epoch', () => {
  assert.equal(toFitTime((FIT_EPOCH_OFFSET + 10) * 1000), 10);
});

test('writer marks missing values as invalid and validates input', () => {
  const w = new FitWriter();
  w.define(0, 20, [[3, 'uint8'], [7, 'uint16'], [9, 'sint16']]);
  w.write(0, [null, 70000, -5]);
  const [msg] = decodeFit(w.toBytes());
  assert.deepEqual(msg.fields, { 3: 0xff, 7: 0xfffe, 9: -5 });
  assert.throws(() => w.write(1, []), /not been defined/);
  assert.throws(() => w.write(0, [1]), /Expected 3 values/);
});

test('lapRanges splits on step changes', () => {
  assert.deepEqual(lapRanges([0, 0, 1, 1, 1, 3]), [[0, 1], [2, 4], [5, 5]]);
  assert.deepEqual(lapRanges([]), []);
});

test('activity file has the expected messages and values', () => {
  const bytes = buildActivityFit(sampleRide(), { timezoneOffsetSeconds: 7200 });
  const messages = decodeFit(bytes); // throws on any CRC or structure problem
  const byType = (g) => messages.filter((m) => m.global === g);
  const t0 = toFitTime(START);

  const [fileId] = byType(0);
  assert.equal(fileId.fields[0], 4); // activity

  const records = byType(20);
  assert.equal(records.length, 900);
  assert.deepEqual(records[400].fields, { 253: t0 + 400, 7: 250, 4: 90, 3: 130, 6: 8500, 5: 401 * 850 });
  assert.equal(records[0].fields[3], 0xff); // missing heart rate is "invalid", not 0

  const laps = byType(19);
  assert.equal(laps.length, 3);
  assert.equal(laps[0].fields[19], 150); // avg power
  assert.equal(laps[1].fields[2], t0 + 300); // start time
  assert.equal(laps[1].fields[8], 300 * 1000); // timer time, ms

  const [session] = byType(18);
  assert.equal(session.fields[5], 2); // cycling
  assert.equal(session.fields[6], 6); // indoor cycling
  assert.equal(session.fields[7], 900 * 1000);
  assert.equal(session.fields[20], Math.round((300 * 150 + 600 * 250) / 900));
  assert.equal(session.fields[26], 3);

  const [activity] = byType(34);
  assert.equal(activity.fields[5], t0 + 899 + 7200); // local timestamp

  const events = byType(21);
  assert.deepEqual(events.map((e) => e.fields[1]), [0, 4]); // start, stop_all
});

test('a ride with no samples cannot be exported', () => {
  assert.throws(() => buildActivityFit({ start: START, ftp: 200, samples: { t: [], p: [], c: [], h: [], s: [], d: [], g: [] } }), /at least one sample/);
});
