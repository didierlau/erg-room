/**
 * Runs a ride: owns the frame loop that connects live sensor data, the
 * RideSession engine, the trainer and the ride screen.
 */
import { RideSession } from '../ride/engine.js';
import { DemoRider } from '../ride/demo-rider.js';
import { rideStats } from '../ride/stats.js';
import { RampFailureDetector } from '../ftp/ramp-failure.js';
import { describeNudge, describeResistance } from '../ride/describe.js';
import { hrReference } from '../ride/hr-zones.js';

/** Frame loop interval (ms). */
const FRAME_MS = 250;
/** How often an in-progress ride is saved for crash recovery (ms). */
const DRAFT_INTERVAL_MS = 10_000;
/** Rides with fewer samples than this are not worth keeping. */
const MIN_SAMPLES_TO_SAVE = 5;
/** Ramp-test failure is only detected from this step on (the first steps are easy). */
const RAMP_DETECT_FROM_STEP = 4;
/** The demo rider "fails" a ramp test at this multiple of FTP. */
const DEMO_RAMP_LIMIT = 1.3;

/**
 * @param {{
 *   trainer: import('../ble/ftms-trainer.js').FtmsTrainer,
 *   live: import('../ride/live-data.js').LiveData,
 *   repository: ReturnType<import('../data/repository.js').createRepository>,
 *   getScreen: () => import('../ui/ride/screen.js').RideScreen,  the screen chosen in Settings, read when a ride starts
 *   wakeLock: {enable:() => void, disable:() => void},
 *   getSettings: () => {ftp:number, smooth:number},
 *   notify: (message:string, durationMs?:number) => void,  short message for the rider (a toast)
 *   onEnded: (savedRide: object | null) => void,
 * }} deps
 */
export function createRideController({ trainer, live, repository, getScreen, wakeLock, getSettings, notify, onEnded }) {
  let session = null;
  let screen = null;
  let timer = null;
  let demo = null;
  let rampDetector = null;
  let lastFrame = 0;
  let lastDraft = 0;

  // After a reconnect or a refused command, make sure the trainer gets the current target again.
  trainer.addEventListener('connected', () => session?.resetCommands());
  trainer.addEventListener('control-lost', () => session?.resetCommands());

  function frame() {
    const now = performance.now();
    const wall = Date.now();
    if (demo) {
      // The demo rider responds to what the trainer would be told: ERG target or simulated gradient.
      const want = session.desiredCommand();
      const simulated = demo.step((now - lastFrame) / 1000, {
        paused: session.paused,
        target: want.mode === 'erg' ? want.watts : null,
        grade: want.mode === 'sim' ? want.grade : 0,
        limit: session.ftp * DEMO_RAMP_LIMIT,
      });
      live.updateTrainer(simulated, now);
    }
    lastFrame = now;

    const reading = live.read(now);
    session.update({ now, wall, reading });
    if (rampDetector) {
      const pos = session.position();
      const active = pos?.segment.tag === 'ramp-step' && pos.index >= RAMP_DETECT_FROM_STEP && !session.paused;
      if (rampDetector.update({ now, reading, target: session.targetWatts(pos), active })) {
        session.endWorkout();
        session.takeCompletedEvent();
        rampDetector = null;
        notify('Ramp test complete. Spin easy, then tap Finish to see your FTP.', 5000);
      }
    }
    if (session.takeCompletedEvent()) notify(session.test ? 'Test complete. Spin easy, then tap Finish to see your result.' : 'Workout complete. Keep spinning or tap Finish.', 4000);

    const command = session.nextCommand(now);
    if (command && !session.demo) trainer.send(command);

    if (!session.demo && wall - lastDraft >= DRAFT_INTERVAL_MS) {
      lastDraft = wall;
      repository.saveDraft(session.toRecord());
    }
    screen.render({ session, reading, displayPower: live.smoothedPower(getSettings().smooth, now), now });
  }

  function start(workout, { demo: isDemo }) {
    const settings = getSettings();
    session = new RideSession({ workout, ftp: settings.ftp, hrReference: hrReference(settings), demo: isDemo, startedAt: Date.now() });
    demo = isDemo ? new DemoRider() : null;
    rampDetector = session.test?.protocol === 'ramp' ? new RampFailureDetector() : null;
    lastFrame = performance.now();
    lastDraft = Date.now();
    screen = getScreen();
    screen.start(session);
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
    screen.stop();
    screen = null;

    repository.clearDraft();
    if (!save || record.samples.p.length < MIN_SAMPLES_TO_SAVE) {
      if (save) notify('Ride too short to save');
      return null;
    }
    // Demo rides are shown in the summary (so a demo test shows its result) but never stored.
    if (wasDemo) return { ...record, stats: rideStats(record), demo: true };
    return saveRecord(record);
  }

  /** Store a ride record (also used for a recovered draft). */
  function saveRecord(record) {
    const ride = { ...record, stats: rideStats(record) };
    const { saved, dropped } = repository.addRide(ride);
    repository.clearDraft();
    if (!saved) notify('Could not save the ride: browser storage is full or blocked');
    else if (dropped) notify(`Storage was full, so the ${dropped} oldest ride${dropped > 1 ? 's were' : ' was'} removed`);
    return saved ? ride : null;
  }

  return {
    start,
    finish(save) { onEnded(finish(save)); },
    saveRecord,
    get active() { return session != null; },
    /** True while the current ride is a demo (nothing will be saved). */
    get demo() { return Boolean(session?.demo); },
    nudge(direction) {
      if (!session) return;
      notify(describeNudge(session.nudge(direction)));
      screen.redraw();
      frame();
    },
    /** Change virtual gear (avatar screen). */
    shift(direction) {
      if (!session) return;
      session.shift(direction);
      screen.redraw();
      frame();
    },
    /** A +/− from the Click or keyboard: whatever the current screen uses them for. */
    press(direction) {
      if (screen?.click === 'shift') this.shift(direction);
      else this.nudge(direction);
    },
    /** @param {import('../ride/engine.js').Resistance} mode */
    setResistance(mode) {
      if (!session || session.resistance === mode) return;
      session.setResistance(mode);
      notify(describeResistance(mode), 3000);
      screen.redraw();
      frame();
    },
    togglePause() {
      if (!session) return;
      session.togglePause();
      frame();
    },
    skip() {
      if (session?.skip()) {
        notify('Skipped to next step');
        frame();
      }
    },
  };
}
