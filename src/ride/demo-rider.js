/**
 * Simulated rider for demo mode: follows the ERG target with a little lag
 * and noise so the ride screen can be tried without a trainer.
 */
export class DemoRider {
  constructor(random = Math.random) {
    this._power = 120;
    this._random = random;
  }

  /**
   * @param {number} dt  seconds since last step
   * @param {{paused:boolean, target:number|null, grade:number, limit?:number}} state
   *   limit: watts the simulated rider can't sustain; above it cadence collapses (ends a demo ramp test)
   * @returns {{power:number, cadence:number, speed:number, hr:number}}
   */
  step(dt, { paused, target, grade, limit = Infinity }) {
    const want = paused ? 0 : target ?? 150 + grade * 25;
    this._power += (want - this._power) * Math.min(1, dt * 1.5);
    const power = Math.max(0, Math.round(this._power + (this._random() - 0.5) * 12));
    return {
      power,
      cadence: paused ? 0 : target != null && target > limit ? 45 : Math.round(88 + this._random() * 6),
      speed: paused ? 0 : 7 + power / 60,
      hr: Math.round(95 + power / 3.2),
    };
  }
}
