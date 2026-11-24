import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRide, recommend, trainingSignals } from '../src/workout/recommend.js';
import { generateWorkout, LEVELS } from '../src/workout/generator.js';
import { flatten, fractionAt } from '../src/workout/model.js';

const FTP = 250;
/** Tuesday 24 November 2026, 18:00 local time. */
const NOW = new Date(2026, 10, 24, 18, 0).getTime();
const at = (daysAgo, hour = 18) => new Date(2026, 10, 24 - daysAgo, hour, 0).getTime();

/** A saved ride of a generated workout, ridden exactly on target with a little noise. */
function ride(daysAgo, level, minutes = 60, extra = {}) {
  const segments = flatten(generateWorkout({ minutes, level }).blocks);
  const p = [];
  for (const segment of segments) {
    for (let t = 0; t < segment.d; t++) p.push(Math.round(fractionAt(segment, t) * FTP + ((t % 3) - 1) * 4));
  }
  return { start: at(daysAgo), ftp: FTP, samples: { p }, ...extra };
}

const levelIds = LEVELS.map((l) => l.id);
const pick = (rides, minutes = 60, feeling) => recommend({ rides, minutes, feeling, now: NOW });

test('classifyRide reads effort from power at every generated level and length', () => {
  const expected = { recovery: 'easy', endurance: 'easy', tempo: 'moderate', sweetspot: 'moderate', threshold: 'hard', vo2: 'hard' };
  for (const level of levelIds) {
    for (const minutes of [30, 45, 60, 90]) {
      assert.equal(classifyRide(ride(1, level, minutes)).effort, expected[level], `${level} ${minutes} min`);
    }
  }
  assert.equal(classifyRide(ride(1, 'vo2', 45)).kind, 'vo2');
  assert.equal(classifyRide(ride(1, 'threshold', 60)).kind, 'threshold');
});

test('classifyRide: FTP tests are hard, rides without power or FTP are easy', () => {
  assert.equal(classifyRide(ride(1, 'endurance', 30, { test: { protocol: 'ramp' } })).effort, 'hard');
  assert.equal(classifyRide({ start: at(1), ftp: 0, samples: { p: [300, 300] } }).effort, 'easy');
  assert.equal(classifyRide({ start: at(1), ftp: FTP }).effort, 'easy');
});

test('no history: a steady ride to start', () => {
  assert.equal(pick([]).level, 'endurance');
  assert.equal(pick([ride(2, 'endurance')]).level, 'endurance'); // second ride ever is still easy
});

test('after a break of a week or more, the first two rides back are steady', () => {
  const before = [ride(20, 'threshold'), ride(18, 'endurance'), ride(16, 'vo2')];
  assert.match(pick(before, 45, 'fresh').reason, /16 days off/);
  assert.equal(pick(before, 45, 'fresh').level, 'endurance');
  assert.equal(pick([...before, ride(2, 'endurance')], 45, 'fresh').level, 'endurance');
  assert.notEqual(pick([...before, ride(4, 'endurance'), ride(2, 'endurance')], 45, 'fresh').level, 'endurance');
});

test('a hard session is due when the week is light and legs are fine', () => {
  const rides = [ride(9, 'endurance'), ride(6, 'endurance'), ride(3, 'endurance')];
  assert.equal(pick(rides, 30).level, 'vo2');
  assert.equal(pick(rides, 60).level, 'threshold');
  assert.equal(pick(rides, 90).level, 'sweetspot');
  assert.match(pick(rides, 60).reason, /hard session is due/);
});

test('45–60 minute hard sessions alternate between threshold and VO₂max', () => {
  const base = [ride(12, 'endurance'), ride(10, 'endurance')];
  assert.equal(pick([...base, ride(4, 'threshold')], 60).level, 'vo2');
  assert.equal(pick([...base, ride(4, 'vo2', 45)], 60).level, 'threshold');
});

test('never hard on back-to-back days, and a solid day is followed by a steady one', () => {
  const base = [ride(10, 'endurance'), ride(8, 'endurance'), ride(5, 'endurance')];
  assert.equal(pick([...base, ride(1, 'vo2')], 30, 'fresh').level, 'endurance');
  assert.equal(pick([...base, ride(1, 'sweetspot')], 60, 'fresh').level, 'endurance');
});

test('two days after a hard session: sweet spot unless the legs feel fresh', () => {
  const rides = [ride(10, 'endurance'), ride(6, 'endurance'), ride(2, 'threshold')];
  assert.equal(pick(rides, 60, 'normal').level, 'sweetspot');
  assert.equal(pick(rides, 60, 'fresh').level, 'vo2');
  assert.equal(pick(rides, 30, 'normal').level, 'vo2'); // too short for sweet spot to pay off
});

test('at most two hard sessions in 7 days; then one sweet spot, then steady', () => {
  const rides = [ride(12, 'endurance'), ride(6, 'threshold'), ride(4, 'endurance'), ride(3, 'vo2')];
  assert.equal(pick(rides, 30, 'fresh').level, 'endurance');
  assert.equal(pick(rides, 60, 'fresh').level, 'sweetspot');
  assert.equal(pick([...rides.slice(0, 2), ride(5, 'tempo'), ...rides.slice(2)], 60, 'fresh').level, 'endurance');
  // Three days later the first hard session has dropped out of the 7 days.
  assert.equal(recommend({ rides, minutes: 60, feeling: 'fresh', now: NOW + 3 * 86400000 }).level, 'threshold');
});

test('three days in a row: an easy day', () => {
  const rides = [ride(10, 'endurance'), ride(3, 'endurance'), ride(2, 'endurance'), ride(1, 'endurance')];
  assert.equal(pick(rides, 30, 'fresh').level, 'recovery');
  assert.equal(pick(rides, 90, 'fresh').level, 'endurance');
  assert.match(pick(rides).reason, /Day 4 in a row/);
});

test('tired legs: never hard', () => {
  const rested = [ride(10, 'endurance'), ride(6, 'endurance'), ride(4, 'endurance')];
  assert.equal(pick(rested, 60, 'tired').level, 'endurance');
  const busy = [ride(10, 'endurance'), ride(2, 'endurance'), ride(1, 'endurance')];
  assert.equal(pick(busy, 60, 'tired').level, 'recovery');
});

test('a second ride on the same day is recovery', () => {
  const rides = [ride(10, 'endurance'), ride(5, 'endurance'), { ...ride(0, 'endurance', 30), start: at(0, 7) }];
  assert.equal(pick(rides, 60, 'fresh').level, 'recovery');
});

test('every recommendation is a generator level with a reason', () => {
  const histories = [[], [ride(3, 'vo2'), ride(1, 'endurance')], [ride(5, 'threshold'), ride(3, 'vo2'), ride(2, 'endurance')]];
  for (const rides of histories) {
    for (const minutes of [20, 30, 45, 60, 75, 90, 120]) {
      for (const feeling of ['fresh', 'normal', 'tired']) {
        const result = pick(rides, minutes, feeling);
        assert.ok(levelIds.includes(result.level), result.level);
        assert.ok(result.reason.length > 10);
      }
    }
  }
});

test('trainingSignals ignores rides in the future and counts riding days, not rides', () => {
  const s = trainingSignals([ride(1, 'endurance'), { ...ride(1, 'vo2', 30), start: at(1, 7) }, { ...ride(0, 'vo2'), start: NOW + 3600000 }], NOW);
  assert.equal(s.rodeToday, false);
  assert.equal(s.yesterday, 'hard');
  assert.equal(s.hardThisWeek, 1);
  assert.equal(s.rideCount, 1);
});
