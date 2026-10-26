import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEAR_COUNT, GEAR_GRADE_STEP, NEUTRAL_GEAR, VirtualGears } from '../src/ride/gears.js';
import { buildTerrain, elevationAt, terrainGrade, TERRAIN_GRADE_RANGE, FLAT_FRACTION } from '../src/ride/terrain.js';
import { RideSession } from '../src/ride/engine.js';

test('gears shift within range and the neutral gear adds no gradient', () => {
  const gears = new VirtualGears();
  assert.equal(gears.gear, NEUTRAL_GEAR);
  assert.equal(gears.gradeOffset, 0);
  assert.equal(gears.shift(1), NEUTRAL_GEAR + 1);
  assert.equal(gears.gradeOffset, GEAR_GRADE_STEP);
  for (let i = 0; i < 30; i++) gears.shift(1);
  assert.equal(gears.gear, GEAR_COUNT);
  for (let i = 0; i < 30; i++) gears.shift(-1);
  assert.equal(gears.gear, 1);
  assert.ok(gears.gradeOffset < 0);
});

test('a longer gear means a higher virtual speed at the same cadence', () => {
  const low = new VirtualGears(1);
  const high = new VirtualGears(GEAR_COUNT);
  assert.ok(high.speedKmh(90) > low.speedKmh(90));
  assert.ok(high.wheelTurnsPerCrank > low.wheelTurnsPerCrank);
  const neutral = new VirtualGears(NEUTRAL_GEAR);
  assert.ok(Math.abs(neutral.speedKmh(90) - 27.5) < 1, 'neutral gear is a believable road speed');
});

test('terrain: flat at the flat fraction, steeper with harder targets, clamped', () => {
  assert.equal(terrainGrade(FLAT_FRACTION), 0);
  assert.equal(terrainGrade(null), 0);
  assert.ok(terrainGrade(1.0) > terrainGrade(0.8));
  assert.ok(terrainGrade(0.3) < 0);
  assert.equal(terrainGrade(5), TERRAIN_GRADE_RANGE[1]);
  assert.equal(terrainGrade(-5), TERRAIN_GRADE_RANGE[0]);
});

test('buildTerrain integrates elevation per second and follows intensity', () => {
  const segments = [{ d: 10, p1: 1.0, p2: 1.0 }, { d: 10, free: true }, { d: 10, p1: 0.4, p2: 0.4 }];
  const terrain = buildTerrain(segments, 1, 2);
  assert.equal(terrain.total, 30);
  assert.equal(terrain.grades.length, 30);
  assert.equal(terrain.elevation.length, 31);
  assert.equal(terrain.grades[0], terrainGrade(1.0));
  assert.equal(terrain.grades[15], 2, 'free ride uses the given gradient');
  assert.ok(terrain.grades[25] < 0);
  assert.ok(terrain.elevation[10] > 0 && terrain.elevation[10] > terrain.elevation[5]);
  assert.ok(elevationAt(terrain, 5.5) > elevationAt(terrain, 5) && elevationAt(terrain, 5.5) < elevationAt(terrain, 6));
  assert.equal(elevationAt(terrain, 99), terrain.elevation[30], 'flat after the end');
  const harder = buildTerrain(segments, 1.2);
  assert.ok(harder.grades[0] > terrain.grades[0]);
});

const WORKOUT = { name: 'G', blocks: [{ t: 'steady', d: 60, p: 1.0 }, { t: 'free', d: 60 }] };
const pedal = { fresh: true, power: 200, cadence: 90, speed: 8, hr: 130 };

test('gears mode sends simulation commands built from terrain and gear; ERG mode is unchanged', () => {
  const s = new RideSession({ workout: WORKOUT, ftp: 200, startedAt: 0 });
  s.update({ now: 0, wall: 0, reading: pedal });
  assert.deepEqual(s.desiredCommand(), { mode: 'erg', watts: 200 });
  s.setResistance('gears');
  assert.deepEqual(s.desiredCommand(), { mode: 'sim', grade: terrainGrade(1.0) });
  s.shift(1);
  s.shift(1);
  assert.deepEqual(s.desiredCommand(), { mode: 'sim', grade: terrainGrade(1.0) + 2 * GEAR_GRADE_STEP });
  s.togglePause();
  assert.deepEqual(s.desiredCommand(), { mode: 'sim', grade: 0 });
  s.togglePause();
  s.setResistance('erg');
  assert.deepEqual(s.desiredCommand(), { mode: 'erg', watts: 200 });
});

test('in gears mode a free-ride step uses the rider gradient plus the gear', () => {
  const s = new RideSession({ workout: WORKOUT, ftp: 200, startedAt: 0 });
  s.setResistance('gears');
  s.skip();
  s.nudge(1);
  s.nudge(1);
  s.shift(-1);
  assert.equal(s.terrainGrade(), 2);
  assert.deepEqual(s.desiredCommand(), { mode: 'sim', grade: 2 - GEAR_GRADE_STEP });
});

test('small gradient changes are rate-limited; a full gear step goes out at once', () => {
  const s = new RideSession({ workout: { name: 'R', blocks: [{ t: 'ramp', d: 60, p1: 0.5, p2: 1.5 }] }, ftp: 200, startedAt: 0 });
  s.setResistance('gears');
  let now = 0;
  const step = (ms) => { now += ms; s.update({ now, wall: now, reading: pedal }); return s.nextCommand(now); };
  assert.equal(step(0).mode, 'sim');
  let sent = 0;
  for (let i = 0; i < 40; i++) if (step(250)) sent++; // 10 s of a steep ramp: gradient rises 0.1% a second
  assert.ok(sent >= 5 && sent <= 12, `about one update per second, got ${sent}`);
  const before = s.simGrade();
  s.shift(1);
  s.shift(1);
  const command = s.nextCommand(now + 1);
  assert.ok(command && command.grade >= before + 2 * GEAR_GRADE_STEP - 0.01, 'two gears up is sent immediately');
});
