import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, createMemoryBackend } from '../src/core/storage.js';
import { createRepository, DEFAULT_SETTINGS, SCHEMA_VERSION } from '../src/data/repository.js';
import { EXAMPLE_WORKOUTS } from '../src/workout/model.js';

test('first run seeds examples and default settings', () => {
  const storage = createStorage(createMemoryBackend());
  const repo = createRepository(storage);
  assert.deepEqual(repo.loadSettings(), DEFAULT_SETTINGS);
  const workouts = repo.loadWorkouts();
  assert.equal(workouts.length, EXAMPLE_WORKOUTS.length);
  workouts[0].name = 'changed';
  assert.notEqual(EXAMPLE_WORKOUTS[0].name, 'changed', 'seeded copies are independent');
  assert.equal(storage.get('schema'), SCHEMA_VERSION);
});

test('settings, workouts and drafts round-trip', () => {
  const repo = createRepository(createStorage(createMemoryBackend()));
  repo.saveSettings({ ftp: 260, smooth: 1 });
  assert.deepEqual(repo.loadSettings(), { ...DEFAULT_SETTINGS, ftp: 260, smooth: 1 }, 'new settings get their defaults');
  repo.saveWorkouts([]);
  assert.deepEqual(repo.loadWorkouts(), []);
  repo.saveDraft({ id: 'd' });
  assert.deepEqual(repo.loadDraft(), { id: 'd' });
  repo.clearDraft();
  assert.equal(repo.loadDraft(), null);
});

test('when storage is full the oldest rides are dropped', () => {
  const repo = createRepository(createStorage(createMemoryBackend({ quotaBytes: 700 })));
  repo.saveWorkouts([]);
  const ride = (id) => ({ id, payload: 'x'.repeat(250) });
  assert.deepEqual(repo.addRide(ride('a')), { saved: true, dropped: 0 });
  repo.addRide(ride('b'));
  const result = repo.addRide(ride('c'));
  assert.equal(result.saved, true);
  assert.ok(result.dropped >= 1);
  assert.equal(repo.loadRides().at(-1).id, 'c');
  repo.deleteRide('c');
  assert.ok(!repo.loadRides().some((r) => r.id === 'c'));
});

test('unavailable storage never throws', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const repo = createRepository(createStorage(broken));
  assert.equal(repo.loadWorkouts().length, EXAMPLE_WORKOUTS.length);
  assert.equal(repo.addRide({ id: 'x' }).saved, false);
  assert.doesNotThrow(() => repo.clearDraft());
});
