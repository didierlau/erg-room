import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RideSession } from '../src/ride/engine.js';

const WORKOUT = { name: 'Test', blocks: [{ t: 'steady', d: 60, p: 0.5 }, { t: 'ramp', d: 60, p1: 0.5, p2: 1.0 }, { t: 'free', d: 30 }] };
const pedal = { fresh: true, power: 150, cadence: 90, speed: 8, hr: 120 };
const still = { fresh: true, power: 0, cadence: 0, speed: 0, hr: 120 };

/** Run the session for `seconds` in 250 ms frames. */
function ride(session, seconds, reading = pedal, clock) {
  for (let i = 0; i < seconds * 4; i++) {
    clock.now += 250;
    clock.wall += 250;
    session.update({ now: clock.now, wall: clock.wall, reading });
  }
}
function setup(ftp = 200) {
  const clock = { now: 0, wall: 1_000_000 };
  const session = new RideSession({ workout: WORKOUT, ftp, startedAt: clock.wall });
  session.update({ now: clock.now, wall: clock.wall, reading: pedal });
  return { session, clock };
}

test('steady target and ramp interpolation', () => {
  const { session, clock } = setup();
  assert.equal(session.targetWatts(), 100);
  ride(session, 90, pedal, clock);
  assert.ok(Math.abs(session.workoutTime - 90) < 1e-6);
  assert.equal(session.targetWatts(), 150); // halfway up the 100→200 W ramp
});

test('workout time only advances while pedalling and not paused; recording follows the wall clock', () => {
  const { session, clock } = setup();
  ride(session, 10, still, clock);
  assert.equal(session.workoutTime, 0);
  assert.equal(session.pedalling, false);
  assert.equal(session.samples.p.length, 11); // seconds 0..10 recorded as zeros
  session.togglePause();
  ride(session, 10, pedal, clock);
  assert.equal(session.workoutTime, 0);
  assert.equal(session.samples.p.length, 11); // nothing recorded while paused
  session.togglePause();
  ride(session, 10, pedal, clock);
  assert.ok(session.workoutTime > 9.5);
  assert.equal(session.samples.t.at(-1), 30);
});

test('stale trainer data counts as not pedalling and records zero power', () => {
  const { session, clock } = setup();
  ride(session, 5, { ...pedal, fresh: false }, clock);
  assert.equal(session.workoutTime, 0);
  assert.equal(session.samples.p.at(-1), 0);
});

test('intensity nudge in ERG, gradient nudge in free ride', () => {
  const { session, clock } = setup();
  assert.deepEqual(session.nudge(1), { kind: 'intensity', value: 1.05 });
  assert.equal(session.targetWatts(), 105);
  for (let i = 0; i < 20; i++) session.nudge(1);
  assert.equal(session.intensity, 1.5);
  session.skip();
  session.skip();
  assert.equal(session.position().segment.free, true);
  assert.equal(session.targetWatts(), null);
  assert.deepEqual(session.nudge(1), { kind: 'grade', value: 1 });
  assert.deepEqual(session.desiredCommand(), { mode: 'sim', grade: 1 });
  ride(session, 40, pedal, clock);
  assert.equal(session.done, true);
  assert.equal(session.takeCompletedEvent(), true);
  assert.equal(session.takeCompletedEvent(), false);
});

test('commands are sent once, ramps are rate-limited, reset forces a resend', () => {
  const { session, clock } = setup();
  assert.deepEqual(session.nextCommand(clock.now), { mode: 'erg', watts: 100 });
  assert.equal(session.nextCommand(clock.now), null);
  ride(session, 70, pedal, clock); // 10 s into the 100→200 W ramp
  const first = session.nextCommand(clock.now);
  assert.equal(first.mode, 'erg');
  clock.now += 250; clock.wall += 250;
  session.update({ now: clock.now, wall: clock.wall, reading: pedal });
  assert.equal(session.nextCommand(clock.now), null, 'within the ramp interval');
  clock.now += 1000; clock.wall += 1000;
  session.update({ now: clock.now, wall: clock.wall, reading: pedal });
  assert.ok(session.nextCommand(clock.now).watts > first.watts);
  session.resetCommands();
  assert.ok(session.nextCommand(clock.now));
  session.togglePause();
  assert.deepEqual(session.nextCommand(clock.now), { mode: 'sim', grade: 0 });
});

test('samples carry step index, distance and trace', () => {
  const { session, clock } = setup();
  ride(session, 65, pedal, clock);
  const S = session.samples;
  assert.equal(S.g[10], 0);
  assert.equal(S.g.at(-1), 1);
  assert.ok(Math.abs(S.d.at(-1) - 65 * 8) < 1);
  assert.equal(session.trace[30], 150);
  const record = session.toRecord();
  assert.equal(record.name, 'Test');
  assert.equal(record.samples, S);
});
