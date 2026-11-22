/**
 * Wording for the live readings shown on the device chips in the top bar.
 * Nothing in here touches the DOM or browser APIs.
 */

/** At or below this battery level the chip warns. */
export const LOW_BATTERY_PERCENT = 20;

/**
 * Heart rate for a chip, split so small screens can drop the unit.
 * Shows "--" while the strap has no reading (no skin contact).
 * @returns {{value:string, unit:string}}
 */
export function formatChipHeartRate(bpm) {
  return { value: bpm > 0 ? String(Math.round(bpm)) : '--', unit: 'bpm' };
}

/**
 * Battery for a chip.
 * @param {number|null|undefined} percent
 * @returns {{text:string, low:boolean}|null} null when the level is unknown
 */
export function describeBattery(percent) {
  if (percent == null || !Number.isFinite(percent)) return null;
  const rounded = Math.round(percent);
  return { text: `${rounded}%`, low: rounded <= LOW_BATTERY_PERCENT };
}
