/**
 * Latest sensor readings from the trainer and heart-rate strap, with
 * staleness checks and display smoothing. Times are monotonic ms
 * (performance.now()), passed in so the logic is testable.
 */

/** Trainer data older than this is treated as missing. */
export const TRAINER_STALE_MS = 3000;
/** Heart rate older than this is treated as missing. */
export const HR_STALE_MS = 5000;
/** Power history kept for smoothing. */
const HISTORY_MS = 6000;

export class LiveData {
  constructor() {
    this.power = 0;
    this.cadence = 0;
    this.speed = 0;
    this.hr = null;
    this._trainerAt = -Infinity;
    this._hrAt = -Infinity;
    this._hrFromStrap = false;
    /** @type {Array<[number, number]>} [time, watts] */
    this._history = [];
  }

  /** @param {{power?:number, cadence?:number, speed?:number, hr?:number}} data  parsed trainer data */
  updateTrainer(data, now) {
    if (data.speed != null) this.speed = data.speed;
    if (data.cadence != null) this.cadence = data.cadence;
    if (data.power != null) {
      this.power = Math.max(0, data.power);
      this._history.push([now, this.power]);
      while (this._history.length && now - this._history[0][0] > HISTORY_MS) this._history.shift();
    }
    // Some trainers relay a heart-rate strap; a directly connected strap takes priority.
    if (data.hr && !this._hrFromStrap) this._setHr(data.hr, now);
    this._trainerAt = now;
  }

  /** Heart rate from a directly connected strap. Pass null when the strap disconnects. */
  updateHeartRate(bpm, now) {
    this._hrFromStrap = bpm != null;
    this._setHr(bpm, now);
  }

  _setHr(bpm, now) {
    this.hr = bpm || null;
    this._hrAt = now;
  }

  /** Mark trainer data as missing, e.g. after a disconnect. */
  clearTrainer() {
    this._trainerAt = -Infinity;
  }

  /** Average power over the last `seconds` for display (1 = latest value). */
  smoothedPower(seconds, now) {
    if (seconds <= 1) return this.power;
    const window = this._history.filter(([t]) => now - t <= seconds * 1000);
    return window.length ? window.reduce((sum, [, w]) => sum + w, 0) / window.length : this.power;
  }

  /** @returns {import('./engine.js').Reading} */
  read(now) {
    return {
      fresh: now - this._trainerAt < TRAINER_STALE_MS,
      power: this.power,
      cadence: this.cadence,
      speed: this.speed,
      hr: now - this._hrAt < HR_STALE_MS ? this.hr : null,
    };
  }
}
