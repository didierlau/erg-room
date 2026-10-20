/**
 * Runs a ride: owns the frame loop that connects live sensor data, the
 * RideSession engine, the trainer and the ride screen.
 */
import { RideSession } from '../ride/engine.js';
import { DemoRider } from '../ride/demo-rider.js';
import { rideStats } from '../ride/stats.js';
import { createWakeLock, toast } from '../ui/dom.js';

/** Frame loop interval (ms). */
const FRAME_MS = 250;
/** How often an in-progress ride is saved for crash recovery (ms). */
const DRAFT_INTERVAL_MS = 10_000;
/** Rides with fewer samples than this are not worth keeping. */
const MIN_SAMPLES_TO_SAVE = 5;

/**
 * @param {{
 *   trainer: import('../ble/ftms-trainer.js').FtmsTrainer,
 *   live: import('../ride/live-data.js').LiveData,
 *   repository: ReturnType<import('../data/repository.js').createRepository>,
 *   rideView: ReturnType<import('../ui/ride-view.js').createRideView>,
 *   getSettings: () => {ftp:number, smooth:number},
 *   onEnded: (savedRide: object | null) => void,
 * }} deps
 */
export function createRideController({ trainer, live, repository, rideView, getSettings, onEnded }) {
  const wakeLock = createWakeLock();
  let session = null;
  let timer = null;
  let demo = null;
  let lastFrame = 0;
  let lastDraft = 0;

  // After a reconnect or a refused command, make sure the trainer gets the current target again.
  trainer.addEventListener('connected', () => session?.resetCommands());
  trainer.addEventListener('control-lost', () => session?.resetCommands());

  function frame() {
    const now = performance.now();
    const wall = Date.now();
    if (demo) {
      const position = session.position();
      const simulated = demo.step((now - lastFrame) / 1000, { paused: session.paused, target: session.targetWatts(position), grade: session.grade });
      live.updateTrainer(simulated, now);
    }
    lastFrame = now;

    const reading = live.read(now);
    session.update({ now, wall, reading });
    if (session.takeCompletedEvent()) toast('Workout complete. Keep spinning or tap Finish.', 3500);

    const command = session.nextCommand(now);
    if (command && !session.demo) trainer.send(command);

    if (!session.demo && wall - lastDraft >= DRAFT_INTERVAL_MS) {
      lastDraft = wall;
      repository.saveDraft(session.toRecord());
    }
    rideView.render(reading, live.smoothedPower(getSettings().smooth, now), now);
  }

  function start(workout, { demo: isDemo }) {
    session = new RideSession({ workout, ftp: getSettings().ftp, demo: isDemo, startedAt: Date.now() });
    demo = isDemo ? new DemoRider() : null;
    lastFrame = performance.now();
    lastDraft = Date.now();
    rideView.start(session);
    wakeLock.enable();
    clearInterval(timer);
    timer = setInterval(frame, FRAME_MS);
    frame();
  }

  /** @returns {object | null} the saved ride, or null when nothing was saved */
  function finish(save) {
    clearInterval(timer);
    wakeLock.disable();
    if (!session.demo) trainer.send({ mode: 'sim', grade: 0 }); // leave the trainer in an easy, free state
    const record = session.toRecord();
    const wasDemo = session.demo;
    session = null;
    demo = null;
    rideView.stop();

    if (!save || wasDemo || record.samples.p.length < MIN_SAMPLES_TO_SAVE) {
      repository.clearDraft();
      if (save && !wasDemo) toast('Ride too short to save');
      return null;
    }
    return saveRecord(record);
  }

  /** Store a ride record (also used for a recovered draft). */
  function saveRecord(record) {
    const ride = { ...record, stats: rideStats(record) };
    const { saved, dropped } = repository.addRide(ride);
    repository.clearDraft();
    if (!saved) toast('Could not save the ride: browser storage is full or blocked');
    else if (dropped) toast(`Storage was full, so the ${dropped} oldest ride${dropped > 1 ? 's were' : ' was'} removed`);
    return saved ? ride : null;
  }

  return {
    start,
    finish(save) { onEnded(finish(save)); },
    saveRecord,
    get active() { return session != null; },
    nudge(direction) {
      if (!session) return;
      const result = session.nudge(direction);
      toast(result.kind === 'grade' ? `Gradient ${result.value}%` : `Intensity ${Math.round(result.value * 100)}%`);
      rideView.invalidateChart();
      frame();
    },
    togglePause() {
      if (!session) return;
      session.togglePause();
      frame();
    },
    skip() {
      if (session?.skip()) {
        toast('Skipped to next step');
        frame();
      }
    },
  };
}
