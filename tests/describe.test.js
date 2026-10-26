import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RideSession } from '../src/ride/engine.js';
import { segmentAt } from '../src/workout/model.js';
import { describeNext, describeNudge, describeState, describeStep, nudgeStepLabel } from '../src/ride/describe.js';

const WORKOUT = {
  name: 'Mixed',
  blocks: [
    { t: 'steady', d: 60, p: 0.5 },
    { t: 'ramp', d: 60, p1: 0.5, p2: 1.0 },
    { t: 'intervals', n: 2, on: 30, onP: 1.2, off: 30, offP: 0.5 },
    { t: 'free', d: 30 },
    { t: 'steady', d: 60, p: 1.0, tag: 'effort', label: '1-minute effort' },
    { t: 'steady', d: 60, p: 0.56, tag: 'ramp-step', label: 'step 2' },
  ],
};
const pedal = { fresh: true, power: 150, cadence: 90, speed: 8, hr: 120 };

function session(ftp = 200) {
  return new RideSession({ workout: WORKOUT, ftp, startedAt: 0 });
}
const at = (s, t) => segmentAt(s.segments, t);

test('describeStep names each kind of step', () => {
  const s = session();
  assert.equal(describeStep(s, at(s, 0)), 'Steady');
  assert.equal(describeStep(s, at(s, 60)), 'Ramp up');
  assert.equal(describeStep(s, at(s, 120)), 'Interval 1 of 2');
  assert.equal(describeStep(s, at(s, 150)), 'Recovery 1 of 2');
  assert.equal(describeStep(s, at(s, 240)), 'Free ride');
  assert.equal(describeStep(s, at(s, 270)), '1-minute effort');
  assert.equal(describeStep(s, at(s, 330)), 'Ramp · step 2');
  assert.equal(describeStep(s, null), 'Cool down as you like');
  s.test = { protocol: 'ramp' };
  assert.equal(describeStep(s, null), 'Test done · spin easy');
});

test('describeNext previews the following step with intensity applied', () => {
  const s = session(200);
  assert.equal(describeNext(s, at(s, 0)), 'Next: 1:00 ramp 50→100%');
  assert.equal(describeNext(s, at(s, 60)), 'Next: 0:30 at 240 W');
  s.intensity = 1.1;
  assert.equal(describeNext(s, at(s, 60)), 'Next: 0:30 at 264 W');
  assert.equal(describeNext(s, at(s, 210)), 'Next: 0:30 free ride');
  assert.equal(describeNext(s, at(s, 240)), 'Next: 1-minute effort, as hard as you can sustain');
  assert.equal(describeNext(s, at(s, 270)), 'Next: 123 W. Hold it as long as you can');
  assert.equal(describeNext(s, at(s, 330)), 'Next: finish');
  assert.equal(describeNext(s, null), 'Tap Finish to save your ride');
});

test('nudgeStepLabel follows what +/− changes', () => {
  const s = session();
  assert.equal(nudgeStepLabel(at(s, 0)), '5%');
  assert.equal(nudgeStepLabel(at(s, 240)), '1%');
  assert.equal(nudgeStepLabel(at(s, 270)), '5 W');
  assert.equal(nudgeStepLabel(null), '1%');
});

test('describeState reports pause, no pedalling and missing data', () => {
  const s = session();
  s.update({ now: 0, wall: 0, reading: { ...pedal, power: 0, cadence: 0 } });
  assert.equal(describeState(s, pedal), 'Start pedalling to continue');
  assert.equal(describeState(s, { ...pedal, fresh: false }), 'Waiting for trainer data');
  s.update({ now: 250, wall: 250, reading: pedal });
  assert.equal(describeState(s, pedal), '');
  s.togglePause();
  assert.equal(describeState(s, pedal), 'Paused');
});

test('describeNudge formats each kind of change', () => {
  assert.equal(describeNudge({ kind: 'intensity', value: 1.05 }), 'Intensity 105%');
  assert.equal(describeNudge({ kind: 'grade', value: 3 }), 'Gradient 3%');
  assert.equal(describeNudge({ kind: 'effort', value: 255 }), 'Target 255 W');
});
