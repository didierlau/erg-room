import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorkout, LEVELS, DURATION_CHOICES, MIN_MINUTES, MAX_MINUTES, levelById } from '../src/workout/generator.js';
import { flatten, totalDuration, workoutStats, zoneOf } from '../src/workout/model.js';

const lengthOf = (workout) => totalDuration(flatten(workout.blocks));

test('every level and offered duration lasts exactly the requested time', () => {
  for (const level of LEVELS) {
    for (const minutes of [...DURATION_CHOICES, 25, 50, 100, 180]) {
      const workout = generateWorkout({ minutes, level: level.id });
      assert.equal(lengthOf(workout), minutes * 60, `${level.id} ${minutes} min`);
    }
  }
});

test('all durations are whole positive seconds', () => {
  for (const level of LEVELS) {
    for (let minutes = MIN_MINUTES; minutes <= MAX_MINUTES; minutes += 5) {
      for (const s of flatten(generateWorkout({ minutes, level: level.id }).blocks)) {
        assert.ok(Number.isInteger(s.d) && s.d > 0, `${level.id} ${minutes}: ${s.d}`);
      }
    }
  }
});

test('starts with a warm-up ramp and ends with a cool-down ramp', () => {
  const { blocks } = generateWorkout({ minutes: 60, level: 'threshold' });
  assert.equal(blocks[0].t, 'ramp');
  assert.ok(blocks[0].p2 > blocks[0].p1);
  assert.equal(blocks.at(-1).t, 'ramp');
  assert.ok(blocks.at(-1).p2 < blocks.at(-1).p1);
});

test('60-minute sweet spot: 9 min warm-up, 6 min cool-down, 3 × 10 min with leftover as easy riding', () => {
  const w = generateWorkout({ minutes: 60, level: 'sweetspot' });
  assert.equal(w.name, 'Sweet spot 60 min');
  assert.deepEqual(w.blocks.map((b) => b.t), ['ramp', 'intervals', 'ramp']);
  assert.equal(w.blocks[0].d, 540);
  assert.equal(w.blocks[2].d, 360);
  assert.deepEqual(w.blocks[1], { t: 'intervals', n: 3, on: 600, onP: 0.9, off: 300, offP: 0.55 });
  assert.match(w.description, /3 × 10 min at 90%/);
});

test('leftover time that does not fit a whole repetition becomes easy riding before the intervals', () => {
  const w = generateWorkout({ minutes: 45, level: 'threshold' });
  // 45 min: warm-up 7, cool-down 5, main 33 = 2 × (8 + 4) with 9 minutes left over
  const intervals = w.blocks.find((b) => b.t === 'intervals');
  const settle = w.blocks.find((b) => b.t === 'steady');
  assert.equal(intervals.n, 2);
  assert.equal(settle.d, 33 * 60 - 2 * 720);
  assert.ok(zoneOf(settle.p) <= 2, 'settle-in block is easy');
});

test('a main set too short for one repetition gets one shortened repetition', () => {
  const w = generateWorkout({ minutes: 20, level: 'tempo' }); // main 10 min, tempo rep is 20 min
  const intervals = w.blocks.find((b) => b.t === 'intervals');
  assert.equal(intervals.n, 1);
  assert.equal(intervals.on + intervals.off, 600);
  assert.equal(intervals.onP, 0.83);
  assert.equal(lengthOf(w), 1200);
});

test('harder levels give a higher intensity factor', () => {
  const ifs = LEVELS.map((l) => workoutStats(flatten(generateWorkout({ minutes: 60, level: l.id }).blocks), 250).intensity);
  for (let i = 1; i < ifs.length; i++) assert.ok(ifs[i] > ifs[i - 1], `${LEVELS[i].id} harder than ${LEVELS[i - 1].id}`);
});

test('easy levels are a single steady block', () => {
  for (const id of ['recovery', 'endurance']) {
    const { blocks } = generateWorkout({ minutes: 90, level: id });
    assert.deepEqual(blocks.map((b) => b.t), ['ramp', 'steady', 'ramp']);
  }
});

test('duration is clamped and rounded; unknown levels are refused', () => {
  assert.equal(lengthOf(generateWorkout({ minutes: 5, level: 'endurance' })), MIN_MINUTES * 60);
  assert.equal(lengthOf(generateWorkout({ minutes: 999, level: 'endurance' })), MAX_MINUTES * 60);
  assert.equal(lengthOf(generateWorkout({ minutes: 44.6, level: 'vo2' })), 45 * 60);
  assert.throws(() => generateWorkout({ minutes: 60, level: 'sprint' }), /Unknown intensity/);
  assert.throws(() => levelById('nope'));
});

test('each call gets a fresh id', () => {
  const a = generateWorkout({ minutes: 30, level: 'vo2' });
  const b = generateWorkout({ minutes: 30, level: 'vo2' });
  assert.notEqual(a.id, b.id);
});
