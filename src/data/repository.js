/**
 * Everything the app persists, in one place: settings, workouts, finished
 * rides and the in-progress ride draft used for crash recovery.
 *
 * Data lives in the browser's localStorage on each device. The schema version
 * lets future releases migrate stored data instead of breaking on it.
 */
import { EXAMPLE_WORKOUTS, cloneWorkout } from '../workout/model.js';

export const SCHEMA_VERSION = 1;

const KEYS = {
  schema: 'schema',
  settings: 'settings',
  workouts: 'workouts',
  rides: 'rides',
  draft: 'live',
};

export const DEFAULT_SETTINGS = Object.freeze({ ftp: 200, smooth: 3 });

/** @param {ReturnType<import('../core/storage.js').createStorage>} storage */
export function createRepository(storage) {
  migrate(storage);

  return {
    loadSettings() {
      return { ...DEFAULT_SETTINGS, ...storage.get(KEYS.settings, {}) };
    },
    saveSettings(settings) {
      return storage.set(KEYS.settings, settings);
    },

    /** First run seeds the example workouts so the library is never empty. */
    loadWorkouts() {
      const stored = storage.get(KEYS.workouts, null);
      if (Array.isArray(stored)) return stored;
      const seeded = EXAMPLE_WORKOUTS.map(cloneWorkout);
      storage.set(KEYS.workouts, seeded);
      return seeded;
    },
    saveWorkouts(workouts) {
      return storage.set(KEYS.workouts, workouts);
    },

    loadRides() {
      return storage.get(KEYS.rides, []);
    },
    /**
     * Append a ride. When storage is full, the oldest rides are dropped until it fits.
     * @returns {{saved: boolean, dropped: number}}
     */
    addRide(ride) {
      const rides = [...storage.get(KEYS.rides, []), ride];
      let dropped = 0;
      while (!storage.set(KEYS.rides, rides)) {
        if (rides.length <= 1) return { saved: false, dropped };
        rides.shift();
        dropped++;
      }
      return { saved: true, dropped };
    },
    deleteRide(id) {
      return storage.set(KEYS.rides, storage.get(KEYS.rides, []).filter((r) => r.id !== id));
    },

    loadDraft() {
      return storage.get(KEYS.draft, null);
    },
    saveDraft(record) {
      return storage.set(KEYS.draft, record);
    },
    clearDraft() {
      storage.remove(KEYS.draft);
    },
  };
}

/** Bring stored data up to SCHEMA_VERSION. Add a step here whenever the stored format changes. */
function migrate(storage) {
  const version = storage.get(KEYS.schema, 0);
  if (version === SCHEMA_VERSION) return;
  // v0 -> v1: same format as the first release; only the version marker is new.
  storage.set(KEYS.schema, SCHEMA_VERSION);
}
