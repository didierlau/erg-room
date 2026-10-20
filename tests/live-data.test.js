import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveData, TRAINER_STALE_MS, HR_STALE_MS } from '../src/ride/live-data.js';

test('readings go stale', () => {
  const live = new LiveData();
  assert.equal(live.read(0).fresh, false);
  live.updateTrainer({ power: 200, cadence: 90, speed: 9 }, 1000);
  assert.deepEqual(live.read(1500), { fresh: true, power: 200, cadence: 90, speed: 9, hr: null });
  assert.equal(live.read(1000 + TRAINER_STALE_MS).fresh, false);
  live.clearTrainer();
  assert.equal(live.read(1001).fresh, false);
});

test('smoothing averages over the window', () => {
  const live = new LiveData();
  [100, 200, 300].forEach((p, i) => live.updateTrainer({ power: p }, i * 1000));
  assert.equal(live.smoothedPower(1, 2000), 300);
  assert.equal(live.smoothedPower(3, 2000), 200);
  assert.equal(live.smoothedPower(1.5, 2000), 250);
});

test('a heart-rate strap takes priority over trainer-relayed heart rate', () => {
  const live = new LiveData();
  live.updateTrainer({ hr: 100 }, 0);
  assert.equal(live.read(10).hr, 100);
  live.updateHeartRate(140, 20);
  live.updateTrainer({ hr: 100 }, 30);
  assert.equal(live.read(40).hr, 140);
  assert.equal(live.read(20 + HR_STALE_MS).hr, null);
  live.updateHeartRate(null, 50); // strap gone: trainer value is used again
  live.updateTrainer({ hr: 101 }, 60);
  assert.equal(live.read(70).hr, 101);
});
