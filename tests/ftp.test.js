import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatten } from '../src/workout/model.js';
import { PROTOCOLS, buildTestWorkout, RAMP, protocolById, testStartRequirement } from '../src/ftp/protocols.js';
import { analyzeTest, estimateFromHistory, bestAverage, linearFit, fitCriticalPower } from '../src/ftp/analysis.js';
import { RampFailureDetector } from '../src/ftp/ramp-failure.js';
import { RideSession } from '../src/ride/engine.js';

const FTP = 250;

/**
 * Simulate a recorded test: one sample per second through the workout's segments.
 * `ride(segment, index, secondInSegment)` returns {p, h} or null to stop recording there.
 */
function record(protocol, ride) {
  const workout = buildTestWorkout(protocol);
  const segments = flatten(workout.blocks);
  const S = { t: [], p: [], c: [], h: [], s: [], d: [], g: [] };
  let t = 0;
  outer: for (const [index, segment] of segments.entries()) {
    for (let k = 0; k < segment.d; k++) {
      const sample = ride(segment, index, k);
      if (!sample) break outer;
      S.t.push(t); S.p.push(sample.p); S.c.push(90); S.h.push(sample.h == null ? null : Math.round(sample.h)); S.s.push(8); S.d.push(t * 8); S.g.push(index);
      t++;
    }
  }
  return { test: workout.test, ftp: FTP, segments, samples: S };
}
const target = (segment) => (segment.free ? 150 : segment.p1 * FTP);

test('every protocol builds a tagged workout', () => {
  for (const p of PROTOCOLS) {
    const w = buildTestWorkout(p.id);
    assert.equal(w.test.protocol, p.id);
    assert.ok(flatten(w.blocks).some((s) => s.tag), p.id);
  }
  assert.throws(() => buildTestWorkout('nope'), /Unknown FTP test/);
});

test('testStartRequirement only asks for heart rate when the protocol needs it', () => {
  const none = { lthr: null, maxHr: null };
  assert.equal(testStartRequirement(protocolById('ramp'), none, false), 'ready');
  assert.equal(testStartRequirement(protocolById('submax'), none, true), 'needs-threshold');
  assert.equal(testStartRequirement(protocolById('submax'), { lthr: 165, maxHr: null }, false), 'needs-strap');
  assert.equal(testStartRequirement(protocolById('submax'), { lthr: null, maxHr: 190 }, true), 'ready');
});

test('helpers: bestAverage, linearFit, fitCriticalPower', () => {
  assert.equal(bestAverage([1, 5, 5, 1], 2), 5);
  assert.equal(bestAverage([1], 2), null);
  const fit = linearFit([1, 2, 3], [3, 5, 7]);
  assert.ok(Math.abs(fit.slope - 2) < 1e-9 && Math.abs(fit.intercept - 1) < 1e-9 && Math.abs(fit.r2 - 1) < 1e-9);
  // A rider with CP 280 W and W′ 20 kJ
  const efforts = [180, 720].map((s) => ({ seconds: s, watts: 280 + 20000 / s }));
  const cp = fitCriticalPower(efforts);
  assert.ok(Math.abs(cp.cp - 280) < 1e-6 && Math.abs(cp.wPrime - 20000) < 1e-6);
});

test('ramp: 75% of best minute, stops where the rider failed', () => {
  // Rider holds every step up to 400 W, then stops.
  const r = record('ramp', (seg) => (seg.tag === 'ramp-step' && target(seg) > 400 ? null : { p: target(seg), h: 120 + target(seg) / 4 }));
  const result = analyzeTest(r);
  assert.equal(result.ok, true);
  const bestStep = RAMP.start + RAMP.step * Math.floor((400 / FTP - RAMP.start) / RAMP.step);
  assert.equal(result.ftp, Math.round(bestStep * FTP * 0.75));
  assert.equal(result.maxHr, Math.round(120 + (bestStep * FTP) / 4));
});

test('ramp: too short gives an error', () => {
  const r = record('ramp', (seg, i, k) => (seg.tag === 'ramp-step' && k > 30 ? null : { p: 100 }));
  assert.equal(analyzeTest(r).ok, false);
});

test('20-minute: 95% of the effort, LTHR, pacing warning', () => {
  const even = record('twenty', (seg) => ({ p: seg.tag === 'effort' ? 280 : target(seg), h: seg.tag === 'effort' ? 168 : 130 }));
  const res = analyzeTest(even);
  assert.equal(res.ok, true);
  assert.equal(res.ftp, Math.round(280 * 0.95));
  assert.equal(res.lthr, Math.round(168 * 0.95));
  assert.deepEqual(res.warnings, []);

  const fadeOut = record('twenty', (seg, i, k) => ({ p: seg.tag === 'effort' ? (k < 300 ? 330 : 260) : target(seg), h: 160 }));
  assert.match(analyzeTest(fadeOut).warnings[0], /started \d+% harder/);

  const quit = record('twenty', (seg, i, k) => (seg.tag === 'effort' && k > 600 ? null : { p: 280 }));
  assert.equal(analyzeTest(quit).ok, false);
});

test('CP 3/12: recovers CP and W′', () => {
  const cp = 280, wPrime = 18000;
  const r = record('cp', (seg) => ({ p: seg.tag === 'effort' ? cp + wPrime / seg.d : target(seg) }));
  const res = analyzeTest(r);
  assert.equal(res.ok, true);
  assert.equal(res.cp, cp);
  assert.equal(res.wPrime, wPrime);
  assert.equal(res.ftp, Math.round(cp * 0.95));

  const sameEfforts = record('cp', (seg) => ({ p: seg.tag === 'effort' ? 250 : target(seg) }));
  assert.equal(analyzeTest(sameEfforts).ok, false);
});

test('submax: extrapolates heart rate to threshold', () => {
  // HR = 60 + 0.4·W  →  at LTHR 170 bpm, power = 275 W
  const hr = (w) => 60 + 0.4 * w;
  const r = record('submax', (seg) => ({ p: target(seg), h: hr(target(seg)) }));
  const withLthr = analyzeTest(r, { lthr: 170 });
  assert.equal(withLthr.ok, true);
  assert.equal(withLthr.ftp, 275);
  const withMax = analyzeTest(r, { maxHr: 190 }); // LTHR ≈ 171
  assert.equal(withMax.ftp, Math.round((190 * 0.9 - 60) / 0.4));
  assert.ok(withMax.warnings.some((w) => /max heart rate was used/.test(w)));
  assert.equal(analyzeTest(r, {}).ok, false);
  const noHr = record('submax', (seg) => ({ p: target(seg) }));
  assert.match(analyzeTest(noHr, { lthr: 170 }).error, /heart-rate data/);
});

test('history: fits CP from best efforts across rides', () => {
  const cp = 260, wPrime = 15000;
  const effortRide = (seconds, start) => {
    const p = [...new Array(600).fill(150), ...new Array(seconds).fill(cp + wPrime / seconds), ...new Array(600).fill(150)];
    return { start, samples: { p } };
  };
  const now = Date.UTC(2026, 9, 20);
  const rides = [180, 300, 720, 1200].map((s, i) => effortRide(s, now - i * 86400000));
  const res = estimateFromHistory(rides, { now });
  assert.equal(res.ok, true);
  assert.ok(Math.abs(res.cp - cp) <= 2, `cp ${res.cp}`);
  assert.equal(estimateFromHistory([], { now }).ok, false);
  assert.equal(estimateFromHistory(rides, { now: now + 200 * 86400000 }).ok, false, 'old rides are ignored');
});

test('ramp failure detector', () => {
  const d = new RampFailureDetector();
  const reading = (cadence, power) => ({ fresh: true, cadence, power, speed: 0, hr: null });
  assert.equal(d.update({ now: 0, reading: reading(40, 300), target: 300, active: false }), false);
  assert.equal(d.update({ now: 1000, reading: reading(40, 300), target: 300, active: true }), false);
  assert.equal(d.update({ now: 5000, reading: reading(40, 300), target: 300, active: true }), false);
  assert.equal(d.update({ now: 6100, reading: reading(40, 300), target: 300, active: true }), true);
  const d2 = new RampFailureDetector();
  assert.equal(d2.update({ now: 0, reading: reading(90, 200), target: 300, active: true }), false);
  assert.equal(d2.update({ now: 4000, reading: reading(90, 300), target: 300, active: true }), false, 'recovered');
  assert.equal(d2.update({ now: 9000, reading: reading(90, 200), target: 300, active: true }), false);
  assert.equal(d2.update({ now: 17000, reading: reading(90, 200), target: 300, active: true }), true);
});

test('engine: effort targets move in 5 W steps and endWorkout stops the workout', () => {
  const s = new RideSession({ workout: buildTestWorkout('twenty'), ftp: FTP, startedAt: 0 });
  const effortStart = s.segments.findIndex((x) => x.tag === 'effort');
  s.workoutTime = s.segments.slice(0, effortStart).reduce((a, x) => a + x.d, 0) + 1;
  assert.equal(s.targetWatts(), Math.round(1.03 * FTP));
  assert.deepEqual(s.nudge(1), { kind: 'effort', value: Math.round(1.03 * FTP) + 5 });
  s.nudge(-1); s.nudge(-1);
  assert.equal(s.targetWatts(), Math.round(1.03 * FTP) - 5);
  assert.equal(s.intensity, 1, 'intensity untouched');
  s.endWorkout();
  assert.equal(s.position(), null);
  assert.deepEqual(s.desiredCommand(), { mode: 'sim', grade: 0 });
  assert.equal(s.toRecord().test.protocol, 'twenty');
});
