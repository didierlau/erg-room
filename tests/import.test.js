import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importWorkoutFiles, importSummary } from '../src/workout/import.js';

const file = (name, text) => ({ name, text: async () => text });
const parse = (text, name) => {
  if (text.includes('bad')) throw new Error("isn't a workout");
  return { name: name.replace(/\.zwo$/, ''), text };
};

test('imports every readable file and reports the failures by name', async () => {
  const { workouts, errors } = await importWorkoutFiles([file('a.zwo', 'ok'), file('b.zwo', 'bad'), file('c.zwo', 'ok')], parse);
  assert.deepEqual(workouts.map((w) => w.name), ['a', 'c']);
  assert.deepEqual(errors, ["b.zwo isn't a workout"]);
});

test('an empty selection imports nothing', async () => {
  assert.deepEqual(await importWorkoutFiles([], parse), { workouts: [], errors: [] });
});

test('importSummary counts workouts', () => {
  assert.equal(importSummary(0), null);
  assert.equal(importSummary(1), 'Workout imported');
  assert.equal(importSummary(3), '3 workouts imported');
});
