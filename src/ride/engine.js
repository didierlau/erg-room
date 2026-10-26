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
 * @typedef {'erg' | 'gears'} Resistance
 *   erg: the trainer holds the target; gears: simulation mode where the terrain
 *   (from the target) plus the virtual gear set the resistance and the rider paces.
 */
import { clamp, createId } from '../core/format.js';
import { flatten, totalDuration, segmentAt, fractionAt } from '../workout/model.js';
import { VirtualGears } from './gears.js';
import { terrainGrade } from './terrain.js';

export const INTENSITY_STEP = 0.05;
export const INTENSITY_RANGE = [0.5, 1.5];
export const GRADE_RANGE = [-5, 15];
/** Watts per +/− press during a rider-paced test effort. */
export const EFFORT_STEP_W = 5;
/** Minimum time between ERG updates while a ramp changes the target, in ms. */
const RAMP_UPDATE_INTERVAL_MS = 950;
/** A target change bigger than this (watts) is sent at once, even mid-ramp. */
const IMMEDIATE_CHANGE_WATTS = 15;
/** A gradient change of at least this much (percent) is sent at once; smaller ones are rate-limited like ramps. */
const IMMEDIATE_CHANGE_GRADE = 1;
/** Longest gap (seconds) credited when integrating distance and work, e.g. after the tab was asleep. */
const MAX_SAMPLE_GAP_S = 5;
/** Longest frame (seconds) credited to workout time. */
const MAX_FRAME_S = 2;

export class RideSession {
  /**
   * @param {{workout:import('../workout/model.js').Workout & {test?:{protocol:string}}, ftp:number, hrReference?:number|null, demo?:boolean, startedAt:number}} options
   *   startedAt is a wall-clock time in ms (Date.now()). `workout.test` marks an FTP test.
   *   hrReference is the threshold heart rate used to colour heart-rate zones (null when unknown).
   */
  constructor({ workout, ftp, hrReference = null, demo = false, startedAt }) {
    this.id = createId();
    this.name = workout.name;
    this.ftp = ftp;
    this.hrReference = hrReference;
    this.demo = demo;
    this.test = workout.test ?? null;
    this.start = startedAt;
    this.segments = flatten(workout.blocks);
    this.total = totalDuration(this.segments);

    this.workoutTime = 0;
    this.intensity = 1;
    this.grade = 0;
    /** @type {Resistance} */
    this.resistance = 'erg';
    this.gears = new VirtualGears();
    this.paused = false;
    this.done = false;
    this.pedalling = false;
    this.distance = 0;
    this.work = 0;
    /** Watts by whole second of workout time, for drawing over the profile. */
    this.trace = [];
    /** Heart rate (bpm or null) by whole second of workout time. */
    this.hrTrace = [];
    /** @type {Samples} */
    this.samples = { t: [], p: [], c: [], h: [], s: [], d: [], g: [] };
    /** Watts added to each test effort's target by +/− presses, by segment index. */
    this.effortOffsets = {};
    this._stepPower = {};

    this._lastFrame = null;
    this._lastSecond = -1;
    this._lastSampleWall = startedAt;
    this._lastCommand = null;
    this._lastCommandAt = -Infinity;
    this._completedEvent = false;
  }

  /** Where the rider is in the workout, or null once it is complete. */
  position() {
    return this.done ? null : segmentAt(this.segments, this.workoutTime);
  }

  /** Current ERG target in watts (intensity applied); null in free ride or after the workout. */
  targetWatts(position = this.position()) {
    if (!position) return null;
    const f = fractionAt(position.segment, position.into);
    if (f == null) return null;
    if (position.segment.tag === 'effort') return Math.max(0, Math.round(f * this.ftp + (this.effortOffsets[position.index] ?? 0)));
    return Math.round(f * this.ftp * this.intensity);
  }

  /**
   * Road gradient (percent) for the current step: from the target in ERG steps,
   * the rider's own gradient in free ride, flat once the workout is done.
   */
  terrainGrade(position = this.position()) {
    if (!position) return 0;
    if (position.segment.free) return this.grade;
    return terrainGrade(fractionAt(position.segment, position.into) * this.intensity);
  }

  /** Gradient sent to the trainer in gears mode: terrain plus the gear's offset. */
  simGrade(position = this.position()) {
    return Math.round(clamp(this.terrainGrade(position) + this.gears.gradeOffset, ...GRADE_RANGE) * 10) / 10;
  }

  /** Average recorded power so far in workout step `index` (default: the current one). */
  stepAverage(index = this.position()?.index) {
    const acc = this._stepPower[index];
    return acc?.n ? acc.sum / acc.n : null;
  }

  /** End the workout part now (e.g. the rider failed the ramp test). Recording continues until finish. */
  endWorkout() {
    if (this.done) return;
    this.done = true;
    this._completedEvent = true;
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
    if (pos) {
      const acc = (this._stepPower[pos.index] ??= { sum: 0, n: 0 });
      acc.sum += power;
      acc.n++;
    }
    if (this.pedalling) {
      const workoutSecond = Math.floor(this.workoutTime);
      this.trace[workoutSecond] = power;
      this.hrTrace[workoutSecond] = reading.hr ?? null;
    }
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
    if (this.paused) return { mode: 'sim', grade: 0 };
    if (this.resistance === 'gears') return { mode: 'sim', grade: this.simGrade(pos) };
    if (this.done || !pos || pos.segment.free) return { mode: 'sim', grade: this.grade };
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
    const settled = now - this._lastCommandAt >= RAMP_UPDATE_INTERVAL_MS;
    let send;
    if (!last || last.mode !== want.mode) send = true;
    else if (want.mode === 'sim') send = want.grade !== last.grade && (settled || Math.abs(want.grade - last.grade) >= IMMEDIATE_CHANGE_GRADE);
    else send = want.watts !== last.watts && (settled || Math.abs(want.watts - last.watts) > IMMEDIATE_CHANGE_WATTS);
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
   * Handle a +/− press: changes intensity during ERG steps, the target by 5 W
   * during a test effort, and the gradient during free ride.
   * @param {1|-1} direction
   * @returns {{kind:'intensity'|'grade'|'effort', value:number}}
   */
  nudge(direction) {
    const pos = this.position();
    if (pos?.segment.tag === 'effort') {
      this.effortOffsets[pos.index] = (this.effortOffsets[pos.index] ?? 0) + direction * EFFORT_STEP_W;
      return { kind: 'effort', value: this.targetWatts(pos) };
    }
    if (!pos || pos.segment.free) {
      this.grade = clamp(this.grade + direction, ...GRADE_RANGE);
      return { kind: 'grade', value: this.grade };
    }
    this.intensity = clamp(Math.round((this.intensity + direction * INTENSITY_STEP) * 100) / 100, ...INTENSITY_RANGE);
    return { kind: 'intensity', value: this.intensity };
  }

  /**
   * Change virtual gear. In gears mode this changes the trainer's resistance;
   * in ERG mode it only changes the virtual speed shown.
   * @param {1|-1} direction
   * @returns {number} the new gear
   */
  shift(direction) {
    return this.gears.shift(direction);
  }

  /** @param {Resistance} mode */
  setResistance(mode) {
    this.resistance = mode;
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

  /** Plain object for storage and FIT export. hrTrace and hrReference are absent from rides saved before they existed. */
  toRecord() {
    return { id: this.id, name: this.name, start: this.start, ftp: this.ftp, hrReference: this.hrReference, test: this.test, segments: this.segments, samples: this.samples, trace: this.trace, hrTrace: this.hrTrace };
  }
}
