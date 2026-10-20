/**
 * Decides when a ramp test is over. In ERG mode the trainer keeps forcing the
 * target, so the rider's cadence collapsing (or power falling far below target)
 * is the signal that they can no longer hold it.
 */

export const RAMP_FAILURE = Object.freeze({
  cadenceFloor: 55, // rpm
  cadenceSeconds: 5,
  powerRatio: 0.75, // of target
  powerSeconds: 8,
});

export class RampFailureDetector {
  constructor(rules = RAMP_FAILURE) {
    this.rules = rules;
    this._lowCadenceSince = null;
    this._lowPowerSince = null;
  }

  /**
   * @param {{now:number, reading:import('../ride/engine.js').Reading, target:number|null, active:boolean}} frame
   *   active: the rider is past the first steps of the ramp
   * @returns {boolean} true when the rider has failed
   */
  update({ now, reading, target, active }) {
    if (!active || target == null || !reading.fresh) {
      this._lowCadenceSince = this._lowPowerSince = null;
      return false;
    }
    const r = this.rules;
    this._lowCadenceSince = reading.cadence < r.cadenceFloor ? this._lowCadenceSince ?? now : null;
    this._lowPowerSince = reading.power < target * r.powerRatio ? this._lowPowerSince ?? now : null;
    return (this._lowCadenceSince != null && now - this._lowCadenceSince >= r.cadenceSeconds * 1000)
      || (this._lowPowerSince != null && now - this._lowPowerSince >= r.powerSeconds * 1000);
  }
}
