/**
 * The ride engine: plays a workout, decides what the trainer should do and
 * records one sample per second. It has no DOM or Bluetooth code; the caller
 * feeds it time and sensor readings and sends its trainer commands on.
 *
 * Two clocks:
 *  - workout time advances only while pedalling and not paused, like Zwift;
 *  - wall-clock time drives recording, so the file reflects real elapsed time.
 *
 * @typedef {{t:number[], p:number[], c:number[], h:(number|null)[], s:number[], d:number[], g:number[]}} Samples
 *   t seconds since start, p watts, c rpm, h bpm, s m/s, d metres (cumulative), g workout step index
 * @typedef {{fresh:boolean, power:number, cadence:number, speed:number, hr:number|null}} Reading
 * @typedef {{mode:'erg', watts:number} | {mode:'sim', grade:number}} TrainerCommand
 */
import { clamp, createId } from '../core/format.js';
import { flatten, totalDuration, segmentAt, fractionAt } from '../workout/model.js';

export const INTENSITY_STEP = 0.05;
export const INTENSITY_RANGE = [0.5, 1.5];
export const GRADE_RANGE = [-5, 15];
/** Minimum time between ERG updates while a ramp changes the target, in ms. */
const RAMP_UPDATE_INTERVAL_MS = 950;
/** A target change bigger than this (watts) is sent at once, even mid-ramp. */
const IMMEDIATE_CHANGE_WATTS = 15;
/** Longest gap (seconds) credited when integrating distance and work, e.g. after the tab was asleep. */
const MAX_SAMPLE_GAP_S = 5;
/** Longest frame (seconds) credited to workout time. */
const MAX_FRAME_S = 2;

export class RideSession {
  /**
   * @param {{workout:import('../workout/model.js').Workout, ftp:number, demo?:boolean, startedAt:number}} options
   *   startedAt is a wall-clock time in ms (Date.now()).
   */
  constructor({ workout, ftp, demo = false, startedAt }) {
    this.id = createId();
    this.name = workout.name;
    this.ftp = ftp;
    this.demo = demo;
    this.start = startedAt;
    this.segments = flatten(workout.blocks);
    this.total = totalDuration(this.segments);

    this.workoutTime = 0;
    this.intensity = 1;
    this.grade = 0;
    this.paused = false;
    this.done = false;
    this.pedalling = false;
    this.distance = 0;
    this.work = 0;
    /** Watts by whole second of workout time, for drawing over the profile. */
    this.trace = [];
    /** @type {Samples} */
    this.samples = { t: [], p: [], c: [], h: [], s: [], d: [], g: [] };

    this._lastFrame = null;
    this._lastSecond = -1;
    this._lastSampleWall = startedAt;
    this._lastCommand = null;
    this._lastCommandAt = -Infinity;
    this._completedEvent = false;
  }

  /** Where the rider is in the workout, or null once it is complete. */
  position() {
    return segmentAt(this.segments, this.workoutTime);
  }

  /** Current ERG target in watts (intensity applied); null in free ride or after the workout. */
  targetWatts(position = this.position()) {
    if (!position) return null;
    const f = fractionAt(position.segment, position.into);
    return f == null ? null : Math.round(f * this.ftp * this.intensity);
  }

  /** Seconds since the ride started, by wall clock. */
  elapsedSeconds() {
    return Math.max(0, this._lastSecond + 1);
  }

  /**
   * Advance the ride. Call several times per second.
   * @param {{now:number, wall:number, reading:Reading}} frame
   *   now: monotonic ms (performance.now()), wall: Date.now()
   */
  update({ now, wall, reading }) {
    const dt = this._lastFrame == null ? 0 : Math.min(MAX_FRAME_S, (now - this._lastFrame) / 1000);
    this._lastFrame = now;
    this.pedalling = reading.fresh && (reading.power > 0 || reading.cadence > 0);

    if (!this.paused && !this.done && this.pedalling) this.workoutTime += dt;
    if (!this.done && this.workoutTime >= this.total) {
      this.done = true;
      this.workoutTime = this.total;
      this._completedEvent = true;
    }

    const second = Math.floor((wall - this.start) / 1000);
    if (second > this._lastSecond) {
      const gap = Math.min(MAX_SAMPLE_GAP_S, (wall - this._lastSampleWall) / 1000);
      this._lastSampleWall = wall;
      this._lastSecond = second;
      if (!this.paused) this._record(second, gap, reading);
    }
  }

  _record(second, gap, reading) {
    const power = reading.fresh ? Math.round(reading.power) : 0;
    const cadence = reading.fresh ? Math.round(reading.cadence) : 0;
    const speed = reading.fresh ? reading.speed : 0;
    this.distance += speed * gap;
    this.work += power * gap;
    const pos = this.position();
    const S = this.samples;
    S.t.push(second);
    S.p.push(power);
    S.c.push(cadence);
    S.h.push(reading.hr ?? null);
    S.s.push(Number(speed.toFixed(2)));
    S.d.push(Number(this.distance.toFixed(1)));
    S.g.push(pos ? pos.index : this.segments.length);
    if (this.pedalling) this.trace[Math.floor(this.workoutTime)] = power;
  }

  /** True once, right after the last step finishes. */
  takeCompletedEvent() {
    const happened = this._completedEvent;
    this._completedEvent = false;
    return happened;
  }

  /** What the trainer should be doing right now. */
  desiredCommand() {
    const pos = this.position();
    if (this.paused || this.done || !pos || pos.segment.free) return { mode: 'sim', grade: this.paused ? 0 : this.grade };
    return { mode: 'erg', watts: this.targetWatts(pos) };
  }

  /**
   * The command to send now, or null when the trainer already has it.
   * Ramps are rate-limited so the trainer is not flooded with writes.
   * @returns {TrainerCommand | null}
   */
  nextCommand(now) {
    const want = this.desiredCommand();
    const last = this._lastCommand;
    let send;
    if (!last || last.mode !== want.mode) send = true;
    else if (want.mode === 'sim') send = want.grade !== last.grade;
    else send = want.watts !== last.watts && (now - this._lastCommandAt >= RAMP_UPDATE_INTERVAL_MS || Math.abs(want.watts - last.watts) > IMMEDIATE_CHANGE_WATTS);
    if (!send) return null;
    this._lastCommand = want;
    this._lastCommandAt = now;
    return want;
  }

  /** Forget what was last sent, e.g. after the trainer reconnects, so the next command goes out. */
  resetCommands() {
    this._lastCommand = null;
  }

  /**
   * Handle a +/− press: changes intensity during ERG steps, gradient during free ride.
   * @param {1|-1} direction
   * @returns {{kind:'intensity'|'grade', value:number}}
   */
  nudge(direction) {
    const pos = this.position();
    if (this.done || !pos || pos.segment.free) {
      this.grade = clamp(this.grade + direction, ...GRADE_RANGE);
      return { kind: 'grade', value: this.grade };
    }
    this.intensity = clamp(Math.round((this.intensity + direction * INTENSITY_STEP) * 100) / 100, ...INTENSITY_RANGE);
    return { kind: 'intensity', value: this.intensity };
  }

  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }

  /** Jump to the start of the next step. */
  skip() {
    const pos = this.position();
    if (!pos) return false;
    this.workoutTime = pos.startsAt + pos.segment.d + 0.001;
    return true;
  }

  /** Plain object for storage and FIT export. */
  toRecord() {
    return { id: this.id, name: this.name, start: this.start, ftp: this.ftp, segments: this.segments, samples: this.samples, trace: this.trace };
  }
}
