import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatten, segmentAt, fractionAt, totalDuration, workoutStats, zoneOf, blockPeak, defaultBlock, BLOCK_TYPES, EXAMPLE_WORKOUTS } from '../src/workout/model.js';

test('flatten expands intervals into on/off pairs and drops empty steps', () => {
  const segs = flatten([{ t: 'steady', d: 60, p: 0.5 }, { t: 'intervals', n: 2, on: 30, onP: 1.2, off: 15, offP: 0.4 }, { t: 'free', d: 0 }]);
  assert.equal(segs.length, 5);
  assert.deepEqual(segs.map((s) => s.d), [60, 30, 15, 30, 15]);
  assert.deepEqual(segs[3], { d: 30, p1: 1.2, p2: 1.2, bi: 1, rep: 2, reps: 2, on: true });
});

test('intervals without recovery have no off segments', () => {
  assert.equal(flatten([{ t: 'intervals', n: 3, on: 20, onP: 1.5, off: 0, offP: 0.5 }]).length, 3);
});

test('segmentAt and fractionAt follow a ramp', () => {
  const segs = flatten([{ t: 'steady', d: 100, p: 0.5 }, { t: 'ramp', d: 100, p1: 0.5, p2: 1.0 }]);
  const pos = segmentAt(segs, 150);
  assert.equal(pos.index, 1);
  assert.equal(pos.into, 50);
  assert.equal(pos.left, 50);
  assert.equal(fractionAt(pos.segment, pos.into), 0.75);
  assert.equal(segmentAt(segs, 200), null);
  assert.equal(totalDuration(segs), 200);
});

test('workoutStats: one hour at FTP is TSS 100, IF 1', () => {
  const st = workoutStats(flatten([{ t: 'steady', d: 3600, p: 1 }]), 250);
  assert.equal(st.duration, 3600);
  assert.ok(Math.abs(st.intensity - 1) < 1e-9);
  assert.ok(Math.abs(st.tss - 100) < 1e-6);
  assert.ok(Math.abs(st.kj - 900) < 1e-6);
});

test('zones', () => {
  assert.deepEqual([0.5, 0.6, 0.75, 0.9, 1.0, 1.1, 1.3].map(zoneOf), [1, 2, 2, 3, 4, 5, 6]);
});

test('every block type has a default and examples are valid', () => {
  for (const t of BLOCK_TYPES) assert.equal(defaultBlock(t).t, t);
  assert.equal(blockPeak({ t: 'free', d: 10 }), null);
  for (const w of EXAMPLE_WORKOUTS) assert.ok(flatten(w.blocks).length > 0, w.name);
});
