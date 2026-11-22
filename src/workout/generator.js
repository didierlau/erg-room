/**
 * Quick workout generator: a duration and an intensity in, a ready-to-ride workout out.
 *
 * Every workout is warm-up ramp + main set + cool-down ramp and lasts exactly the
 * requested time. The main set is one steady block for the easy levels and
 * intervals for the harder ones. Intervals keep their prescribed length; time
 * that does not fit a whole repetition becomes an easy steady block before the
 * first one (a longer warm-up). If not even one repetition fits, the single
 * repetition is shortened to fill the main set.
 */
import { clamp, createId } from '../core/format.js';

/** Shortest and longest workout the generator makes, in minutes. */
export const MIN_MINUTES = 20;
export const MAX_MINUTES = 180;
/** Durations offered in the picker, in minutes. */
export const DURATION_CHOICES = [20, 30, 45, 60, 75, 90, 120];

/** Warm-up is this share of the workout, between the limits below (seconds). */
const WARMUP_SHARE = 0.15;
const WARMUP_LIMITS = [300, 900];
/** Cool-down is this share of the workout, between the limits below (seconds). */
const COOLDOWN_SHARE = 0.1;
const COOLDOWN_LIMITS = [300, 600];
/** Warm-up and cool-down lengths are rounded to whole minutes. */
const MINUTE = 60;

/**
 * Intensity levels, easiest first. Powers are fractions of FTP, durations seconds.
 * `main` is either a steady power or an interval pattern.
 * @typedef {{id:string, name:string, summary:string, warmup:[number, number], cooldown:[number, number],
 *   main:{steady:number} | {on:number, onP:number, off:number, offP:number}}} Level
 * @type {ReadonlyArray<Level>}
 */
export const LEVELS = Object.freeze([
  { id: 'recovery', name: 'Recovery', summary: 'Very easy spinning', warmup: [0.4, 0.5], cooldown: [0.5, 0.4], main: { steady: 0.5 } },
  { id: 'endurance', name: 'Endurance', summary: 'Steady zone 2', warmup: [0.45, 0.65], cooldown: [0.6, 0.45], main: { steady: 0.68 } },
  { id: 'tempo', name: 'Tempo', summary: 'Long blocks in zone 3', warmup: [0.45, 0.7], cooldown: [0.6, 0.45], main: { on: 900, onP: 0.83, off: 300, offP: 0.6 } },
  { id: 'sweetspot', name: 'Sweet spot', summary: 'Just under threshold', warmup: [0.45, 0.75], cooldown: [0.6, 0.45], main: { on: 600, onP: 0.9, off: 300, offP: 0.55 } },
  { id: 'threshold', name: 'Threshold', summary: 'Efforts at FTP', warmup: [0.45, 0.75], cooldown: [0.6, 0.45], main: { on: 480, onP: 1.0, off: 240, offP: 0.55 } },
  { id: 'vo2', name: 'VO₂max', summary: 'Short hard efforts', warmup: [0.45, 0.75], cooldown: [0.6, 0.4], main: { on: 180, onP: 1.15, off: 180, offP: 0.5 } },
]);

export const DEFAULT_LEVEL = 'endurance';
export const DEFAULT_MINUTES = 60;

/** @returns {Level} */
export const levelById = (id) => {
  const level = LEVELS.find((l) => l.id === id);
  if (!level) throw new Error(`Unknown intensity: ${id}`);
  return level;
};

/** Length in seconds of a share of the workout, whole minutes, within limits. */
const portion = (total, share, [min, max]) => clamp(Math.round((total * share) / MINUTE) * MINUTE, min, max);

const pct = (fraction) => `${Math.round(fraction * 100)}%`;

/** "10 min" or "90 s" for interval lengths. */
function shortDuration(seconds) {
  return seconds % MINUTE === 0 ? `${seconds / MINUTE} min` : `${seconds} s`;
}

/** Main-set blocks and their description for an interval level. */
function intervalSet({ on, onP, off, offP }, seconds, settle) {
  const reps = Math.floor(seconds / (on + off));
  if (reps === 0) {
    // Too short for one full repetition: shorten it, keeping the on/off proportion.
    const shortOn = Math.round((seconds * on) / (on + off));
    const block = { t: 'intervals', n: 1, on: shortOn, onP, off: seconds - shortOn, offP };
    return { blocks: [block], text: `1 × ${shortDuration(shortOn)} at ${pct(onP)}` };
  }
  const blocks = [];
  const extra = seconds - reps * (on + off);
  if (extra > 0) blocks.push({ t: 'steady', d: extra, p: settle });
  blocks.push({ t: 'intervals', n: reps, on, onP, off, offP });
  return { blocks, text: `${reps} × ${shortDuration(on)} at ${pct(onP)}, ${shortDuration(off)} easy between` };
}

/**
 * Build a workout of exactly `minutes` minutes at the given intensity.
 * @param {{minutes:number, level:string}} options  minutes is clamped to MIN_MINUTES–MAX_MINUTES
 * @returns {import('./model.js').Workout}
 */
export function generateWorkout({ minutes, level: levelId }) {
  const level = levelById(levelId);
  const wholeMinutes = clamp(Math.round(Number(minutes) || DEFAULT_MINUTES), MIN_MINUTES, MAX_MINUTES);
  const total = wholeMinutes * MINUTE;
  const warmup = portion(total, WARMUP_SHARE, WARMUP_LIMITS);
  const cooldown = portion(total, COOLDOWN_SHARE, COOLDOWN_LIMITS);
  const mainSeconds = total - warmup - cooldown;

  const { main } = level;
  const set = 'steady' in main
    ? { blocks: [{ t: 'steady', d: mainSeconds, p: main.steady }], text: `${shortDuration(mainSeconds)} steady at ${pct(main.steady)}` }
    : intervalSet(main, mainSeconds, level.warmup[1]);

  return {
    id: createId(),
    name: `${level.name} ${wholeMinutes} min`,
    description: `${set.text}. Warm-up ${shortDuration(warmup)}, cool-down ${shortDuration(cooldown)}.`,
    blocks: [
      { t: 'ramp', d: warmup, p1: level.warmup[0], p2: level.warmup[1] },
      ...set.blocks,
      { t: 'ramp', d: cooldown, p1: level.cooldown[0], p2: level.cooldown[1] },
    ],
  };
}
