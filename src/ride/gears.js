/**
 * Virtual gears for a single-cog trainer (Zwift Cog). The trainer has no real
 * gears and FTMS has no "shift" command, so a gear is emulated two ways:
 *  - resistance: in simulation mode, each gear adds or removes a little gradient
 *    on top of the terrain, so a harder gear feels like a bigger gear;
 *  - display: the gear sets a development (metres per crank turn) used for the
 *    virtual speed and how fast the avatar's wheels turn.
 * Pure logic, no DOM.
 */
import { clamp } from '../core/format.js';

export const GEAR_COUNT = 13;
/** The gear a ride starts in: no gradient offset. */
export const NEUTRAL_GEAR = 7;
/** Gradient added per gear above neutral (percent); subtracted below it. */
export const GEAR_GRADE_STEP = 0.5;
/** Metres travelled per crank turn in the neutral gear (about a 34×14 on 700c). */
const NEUTRAL_DEVELOPMENT_M = 5.1;
/** Each gear is this much longer than the one below. */
const GEAR_RATIO_STEP = 1.07;

export class VirtualGears {
  constructor(gear = NEUTRAL_GEAR) {
    this.gear = clamp(gear, 1, GEAR_COUNT);
  }

  /**
   * Shift up (+1) or down (−1).
   * @param {1|-1} direction
   * @returns {number} the new gear
   */
  shift(direction) {
    this.gear = clamp(this.gear + direction, 1, GEAR_COUNT);
    return this.gear;
  }

  /** Gradient (percent) this gear adds to the terrain in simulation mode. */
  get gradeOffset() {
    return (this.gear - NEUTRAL_GEAR) * GEAR_GRADE_STEP;
  }

  /** Metres per crank turn in this gear. */
  get development() {
    return NEUTRAL_DEVELOPMENT_M * GEAR_RATIO_STEP ** (this.gear - NEUTRAL_GEAR);
  }

  /** Virtual speed in km/h at a cadence (rpm). */
  speedKmh(cadence) {
    return (cadence / 60) * this.development * 3.6;
  }

  /** How many wheel turns per crank turn, for animating the avatar. */
  get wheelTurnsPerCrank() {
    return this.development / NEUTRAL_DEVELOPMENT_M;
  }
}
