/**
 * Terrain for the avatar screen: the harder the target, the steeper the road.
 * The same gradient is what the trainer receives in gears mode, so the
 * numbers are gentle (real resistance at a given cadence climbs fast with
 * gradient on a single-cog trainer). Pure logic, no DOM.
 */
import { clamp } from '../core/format.js';
import { fractionAt } from '../workout/model.js';

/** Target (fraction of FTP) that rides as flat road. */
export const FLAT_FRACTION = 0.55;
/** Gradient (percent) per 1.0 FTP above or below the flat fraction. */
export const GRADE_PER_FTP = 6;
/** Terrain never goes beyond this (percent). */
export const TERRAIN_GRADE_RANGE = [-2, 8];
/** Virtual distance covered per second of workout time (m), used for elevation. */
export const SCENE_SPEED_MPS = 8;

/**
 * Road gradient for a target.
 * @param {number|null} fraction  target as a fraction of FTP (intensity applied); null for free ride
 * @returns {number} percent, rounded to 0.1
 */
export function terrainGrade(fraction) {
  if (fraction == null) return 0;
  return Math.round(clamp((fraction - FLAT_FRACTION) * GRADE_PER_FTP, ...TERRAIN_GRADE_RANGE) * 10) / 10;
}

/**
 * Gradient and elevation for every second of a workout, for drawing the road.
 * @param {import('../workout/model.js').Segment[]} segments
 * @param {number} intensity  the session's intensity multiplier
 * @param {number} freeGrade  gradient used for free-ride segments
 * @returns {{total:number, grades:Float64Array, elevation:Float64Array}}
 *   grades[t] percent during second t; elevation[t] metres at the start of second t (elevation has total+1 entries)
 */
export function buildTerrain(segments, intensity = 1, freeGrade = 0) {
  const total = segments.reduce((sum, s) => sum + s.d, 0);
  const grades = new Float64Array(total);
  const elevation = new Float64Array(total + 1);
  let t = 0;
  for (const s of segments) {
    for (let k = 0; k < s.d; k++, t++) {
      const f = fractionAt(s, k + 0.5);
      grades[t] = s.free ? freeGrade : terrainGrade(f * intensity);
      elevation[t + 1] = elevation[t] + (grades[t] / 100) * SCENE_SPEED_MPS;
    }
  }
  return { total, grades, elevation };
}

/**
 * Elevation (m) at a fractional workout time, interpolated; flat beyond the end.
 * @param {{total:number, elevation:Float64Array, grades:Float64Array}} terrain
 */
export function elevationAt(terrain, time) {
  if (time <= 0) return terrain.elevation[0] + (terrain.grades[0] ?? 0) / 100 * SCENE_SPEED_MPS * time;
  if (time >= terrain.total) return terrain.elevation[terrain.total];
  const i = Math.floor(time);
  return terrain.elevation[i] + (terrain.elevation[i + 1] - terrain.elevation[i]) * (time - i);
}
