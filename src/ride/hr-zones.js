/**
 * Heart-rate zones relative to threshold heart rate (LTHR), the usual
 * five-zone scheme (Friel/Coggan). Pure logic, no DOM.
 */

/** Upper bounds (fraction of LTHR) of heart-rate zones 1–5; anything above is zone 6 (well over threshold). */
export const HR_ZONE_UPPER_BOUNDS = [0.81, 0.89, 0.93, 0.99, 1.05];
/** LTHR assumed as a fraction of max HR when only max HR is known. */
export const LTHR_FROM_MAX = 0.9;

/**
 * The threshold heart rate to base zones on, from the rider's settings.
 * @param {{lthr?:number|null, maxHr?:number|null}} settings
 * @returns {number|null} bpm, or null when neither value is set
 */
export function hrReference({ lthr, maxHr } = {}) {
  if (lthr) return lthr;
  if (maxHr) return Math.round(maxHr * LTHR_FROM_MAX);
  return null;
}

/**
 * Heart-rate zone 1–6 for a reading, or null when there is no reference.
 * @param {number|null} bpm
 * @param {number|null} reference  threshold heart rate (see hrReference)
 */
export function hrZoneOf(bpm, reference) {
  if (!bpm || !reference) return null;
  const f = bpm / reference;
  const i = HR_ZONE_UPPER_BOUNDS.findIndex((upper) => f < upper);
  return i === -1 ? 6 : i + 1;
}
