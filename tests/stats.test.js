import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizedPower, rideStats } from '../src/ride/stats.js';

test('normalized power of constant power equals that power', () => {
  assert.ok(Math.abs(normalizedPower(new Array(600).fill(200)) - 200) < 1e-9);
});

test('normalized power is above average for variable power', () => {
  const p = Array.from({ length: 1200 }, (_, i) => (Math.floor(i / 60) % 2 ? 350 : 100));
  assert.ok(normalizedPower(p) > 225 + 20);
});

test('short rides fall back to the average', () => {
  assert.equal(normalizedPower([100, 200]), 150);
  assert.equal(normalizedPower([]), 0);
});

test('rideStats summary', () => {
  const n = 3600;
  const samples = { t: [], p: [], c: [], h: [], s: [], d: [], g: [] };
  for (let i = 0; i < n; i++) {
    samples.t.push(i); samples.p.push(250); samples.c.push(i % 2 ? 90 : 0); samples.h.push(i < 10 ? null : 140);
    samples.s.push(10); samples.d.push((i + 1) * 10); samples.g.push(0);
  }
  const s = rideStats({ ftp: 250, samples });
  assert.equal(s.duration, 3600);
  assert.equal(s.avgPower, 250);
  assert.equal(s.normalizedPower, 250);
  assert.equal(s.kj, 900);
  assert.equal(s.avgHr, 140);
  assert.equal(s.avgCadence, 90);
  assert.equal(s.distance, 36000);
  assert.ok(Math.abs(s.tss - 100) < 1e-6);
  assert.equal(rideStats({ ftp: 250, samples: { t: [], p: [], c: [], h: [], s: [], d: [], g: [] } }).avgPower, 0);
});
