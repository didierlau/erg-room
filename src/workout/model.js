/**
 * Workout data model.
 *
 * A workout is a list of *blocks* as the user edits them. Power is always a
 * fraction of FTP (0.9 = 90%), durations are whole seconds.
 *
 *   steady    { t:'steady',    d, p }
 *   ramp      { t:'ramp',      d, p1, p2 }
 *   intervals { t:'intervals', n, on, onP, off, offP }
 *   free      { t:'free',      d }                 ERG off, rider controls effort
 *
 * For riding and drawing, blocks are flattened into *segments*: one per
 * continuous piece of the workout, so intervals expand into on/off pairs.
 *
 *   segment { d, p1, p2, free?, bi, rep?, reps?, on? }
 *
 * @typedef {{t:'steady', d:number, p:number}} SteadyBlock
 * @typedef {{t:'ramp', d:number, p1:number, p2:number}} RampBlock
 * @typedef {{t:'intervals', n:number, on:number, onP:number, off:number, offP:number}} IntervalsBlock
 * @typedef {{t:'free', d:number}} FreeBlock
 * @typedef {SteadyBlock | RampBlock | IntervalsBlock | FreeBlock} Block
 * @typedef {{id:string, name:string, description?:string, example?:boolean, blocks:Block[]}} Workout
 * @typedef {{d:number, p1?:number, p2?:number, free?:boolean, bi:number, rep?:number, reps?:number, on?:boolean}} Segment
 */
import { createId } from '../core/format.js';

export const BLOCK_TYPES = ['steady', 'ramp', 'intervals', 'free'];
export const BLOCK_LABELS = { steady: 'Steady', ramp: 'Ramp', intervals: 'Intervals', free: 'Free ride' };

/** Upper bounds (fraction of FTP) of training zones 1–5; anything above is zone 6. */
export const ZONE_UPPER_BOUNDS = [0.6, 0.76, 0.91, 1.06, 1.21];

/** Power assumed for free-ride time when estimating load. */
const FREE_RIDE_ESTIMATE = 0.6;

/** Training zone 1–6 for a fraction of FTP. */
export function zoneOf(fraction) {
  const i = ZONE_UPPER_BOUNDS.findIndex((upper) => fraction < upper);
  return i === -1 ? 6 : i + 1;
}

/** @returns {Segment[]} */
export function flatten(blocks) {
  const out = [];
  blocks.forEach((b, bi) => {
    switch (b.t) {
      case 'steady':
        out.push({ d: b.d, p1: b.p, p2: b.p, bi });
        break;
      case 'ramp':
        out.push({ d: b.d, p1: b.p1, p2: b.p2, bi });
        break;
      case 'free':
        out.push({ d: b.d, free: true, bi });
        break;
      case 'intervals':
        for (let i = 0; i < b.n; i++) {
          out.push({ d: b.on, p1: b.onP, p2: b.onP, bi, rep: i + 1, reps: b.n, on: true });
          if (b.off > 0) out.push({ d: b.off, p1: b.offP, p2: b.offP, bi, rep: i + 1, reps: b.n, on: false });
        }
        break;
      default:
        throw new Error(`Unknown block type: ${b.t}`);
    }
  });
  return out.filter((s) => s.d > 0);
}

export const totalDuration = (segments) => segments.reduce((sum, s) => sum + s.d, 0);

/**
 * Locate workout time `t` (seconds) in the segment list.
 * @returns {{index:number, segment:Segment, into:number, left:number, startsAt:number} | null}
 *          null once `t` is past the end.
 */
export function segmentAt(segments, t) {
  let startsAt = 0;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (t < startsAt + segment.d) return { index, segment, into: t - startsAt, left: startsAt + segment.d - t, startsAt };
    startsAt += segment.d;
  }
  return null;
}

/** Target as a fraction of FTP at `into` seconds into a segment; null for free ride. */
export function fractionAt(segment, into) {
  if (segment.free) return null;
  return segment.p1 + (segment.p2 - segment.p1) * (into / segment.d);
}

/**
 * Estimated duration, intensity factor, TSS and work for a workout ridden exactly as prescribed.
 * Uses 5-second steps; IF is the fourth-power mean, as Normalized Power is.
 */
export function workoutStats(segments, ftp) {
  let duration = 0;
  let sumFourth = 0;
  let joules = 0;
  for (const s of segments) {
    const steps = Math.max(1, Math.round(s.d / 5));
    const dt = s.d / steps;
    for (let k = 0; k < steps; k++) {
      const f = s.free ? FREE_RIDE_ESTIMATE : fractionAt(s, ((k + 0.5) / steps) * s.d);
      sumFourth += f ** 4 * dt;
      joules += f * ftp * dt;
    }
    duration += s.d;
  }
  const intensity = duration ? (sumFourth / duration) ** 0.25 : 0;
  return { duration, intensity, tss: (duration / 3600) * intensity ** 2 * 100, kj: joules / 1000 };
}

/** Highest prescribed fraction in a block, used to colour it; null for free ride. */
export function blockPeak(block) {
  switch (block.t) {
    case 'steady': return block.p;
    case 'ramp': return Math.max(block.p1, block.p2);
    case 'intervals': return block.onP;
    default: return null;
  }
}

/** A sensible new block of the given type for the builder. */
export function defaultBlock(type) {
  switch (type) {
    case 'steady': return { t: 'steady', d: 300, p: 0.75 };
    case 'ramp': return { t: 'ramp', d: 300, p1: 0.5, p2: 0.8 };
    case 'intervals': return { t: 'intervals', n: 4, on: 240, onP: 1.05, off: 120, offP: 0.5 };
    case 'free': return { t: 'free', d: 600 };
    default: throw new Error(`Unknown block type: ${type}`);
  }
}

export function newWorkout() {
  return {
    id: createId(),
    name: '',
    description: '',
    blocks: [{ t: 'ramp', d: 600, p1: 0.5, p2: 0.75 }, { t: 'steady', d: 1200, p: 0.75 }, { t: 'ramp', d: 300, p1: 0.6, p2: 0.45 }],
  };
}

export const cloneWorkout = (w) => structuredClone(w);

export const EXAMPLE_WORKOUTS = Object.freeze([
  {
    id: 'ex-ss', example: true, name: 'Sweet Spot 3×10',
    description: 'Three 10-minute blocks at 90% with 5 minutes easy between.',
    blocks: [{ t: 'ramp', d: 600, p1: 0.5, p2: 0.75 }, { t: 'intervals', n: 3, on: 600, onP: 0.9, off: 300, offP: 0.55 }, { t: 'ramp', d: 300, p1: 0.6, p2: 0.45 }],
  },
  {
    id: 'ex-vo2', example: true, name: 'VO₂ 5×3',
    description: 'Five 3-minute efforts at 115% with equal recovery.',
    blocks: [{ t: 'ramp', d: 600, p1: 0.5, p2: 0.75 }, { t: 'steady', d: 180, p: 0.6 }, { t: 'intervals', n: 5, on: 180, onP: 1.15, off: 180, offP: 0.5 }, { t: 'ramp', d: 420, p1: 0.6, p2: 0.4 }],
  },
  {
    id: 'ex-end', example: true, name: 'Endurance 60',
    description: 'An hour of steady zone 2.',
    blocks: [{ t: 'ramp', d: 300, p1: 0.5, p2: 0.65 }, { t: 'steady', d: 3000, p: 0.68 }, { t: 'ramp', d: 300, p1: 0.6, p2: 0.45 }],
  },
]);
