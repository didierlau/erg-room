/**
 * "What should I ride today?": picks an intensity for the quick-workout generator
 * from the rides saved on this device, the time available and how the legs feel.
 *
 * Built for general fitness and weight loss, around the rider's schedule instead of
 * a calendar: mostly steady riding, at most two hard sessions in any 7 days and never
 * on back-to-back days, easy riding after a break or several days in a row, and
 * nothing that piles up when days are skipped. A daily light commute is treated as
 * normal background and not counted; the "legs" answer covers days it was tiring.
 *
 * How hard a past ride was is read from its power, not its name, so imported and
 * edited workouts count too.
 */

/** Rolling window used to judge sustained power, in samples (seconds). */
const ROLLING_SECONDS = 30;
/** A ride is hard with at least this long at or above this fraction of FTP (rolling average). */
const HARD_POWER = 0.95;
const HARD_SECONDS = 240;
/** Above this fraction of FTP for HARD_SECONDS, a hard ride was VO₂max-type rather than threshold-type. */
const VO2_POWER = 1.08;
/** A ride is moderate (tempo, sweet spot) with at least this long at or above this fraction of FTP. */
const MODERATE_POWER = 0.8;
const MODERATE_SECONDS = 480;

/** Hard sessions allowed in the last 7 days (today excluded). */
const MAX_HARD_PER_WEEK = 2;
const WEEK_DAYS = 7;
/** Days since the last hard session at which another is only chosen when the legs feel fresh. */
const MIN_HARD_GAP = 2;
/** A gap of this many days without riding counts as a break. */
const BREAK_DAYS = 8;
/** Riding days kept easy after a break (or at the very start). */
const EASY_DAYS_AFTER_BREAK = 2;
/** From this many riding days in a row (ending yesterday), today is easy. */
const STREAK_DAYS = 3;
/** Up to this many minutes, a short session: VO₂max when hard, recovery when tired of riding. */
const SHORT_MINUTES = 30;
const MEDIUM_MINUTES = 60;
const STREAK_RECOVERY_MINUTES = 45;
/** Long enough for a sweet-spot session to be worth it when the week's hard sessions are done. */
const LONG_MINUTES = 60;

const DAY_MS = 86400000;

/** How the legs feel, as offered in the card. */
export const FEELINGS = Object.freeze([
  { id: 'fresh', name: 'Fresh' },
  { id: 'normal', name: 'Normal' },
  { id: 'tired', name: 'Tired' },
]);
export const DEFAULT_FEELING = 'normal';

/** Local calendar day number of a wall-clock time, so "yesterday" means the previous date. */
function dayNumber(ms) {
  const d = new Date(ms);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** Seconds where the rolling average power is at or above `watts`. */
function secondsAbove(power, watts) {
  if (power.length < ROLLING_SECONDS) return 0;
  let rolling = 0;
  let count = 0;
  for (let i = 0; i < power.length; i++) {
    rolling += power[i];
    if (i >= ROLLING_SECONDS) rolling -= power[i - ROLLING_SECONDS];
    if (i >= ROLLING_SECONDS - 1 && rolling / ROLLING_SECONDS >= watts) count++;
  }
  return count;
}

/**
 * How hard a saved ride was, from its power trace and the FTP it was ridden at.
 * FTP tests always count as hard.
 * @param {{ftp:number, samples?:{p:number[]}, test?:object}} ride
 * @returns {{effort:'easy'|'moderate'|'hard', kind:'vo2'|'threshold'|null}}
 */
export function classifyRide(ride) {
  const power = ride.samples?.p ?? [];
  const ftp = ride.ftp || 0;
  if (!ftp || !power.length) return { effort: ride.test ? 'hard' : 'easy', kind: null };
  if (ride.test || secondsAbove(power, ftp * HARD_POWER) >= HARD_SECONDS) {
    return { effort: 'hard', kind: secondsAbove(power, ftp * VO2_POWER) >= HARD_SECONDS ? 'vo2' : 'threshold' };
  }
  if (secondsAbove(power, ftp * MODERATE_POWER) >= MODERATE_SECONDS) return { effort: 'moderate', kind: null };
  return { effort: 'easy', kind: null };
}

const RANK = { easy: 0, moderate: 1, hard: 2 };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ago = (days) => (days === 1 ? 'yesterday' : `${days} days ago`);

/**
 * The training picture behind a recommendation, from saved rides.
 * @param {object[]} rides  saved rides with `start` (ms), `ftp`, `samples`
 * @param {number} now  wall-clock time in ms
 */
export function trainingSignals(rides, now) {
  const today = dayNumber(now);
  /** Hardest effort per past riding day (today kept apart). */
  const days = new Map();
  let rodeToday = false;
  let lastHard = null;
  for (const ride of rides) {
    if (!Number.isFinite(ride.start) || ride.start > now) continue;
    const day = dayNumber(ride.start);
    if (day === today) { rodeToday = true; continue; }
    const { effort, kind } = classifyRide(ride);
    if (!days.has(day) || RANK[effort] > RANK[days.get(day)]) days.set(day, effort);
    if (effort === 'hard' && (!lastHard || day >= lastHard.day)) lastHard = { day, kind };
  }
  const ridingDays = [...days.keys()].sort((a, b) => b - a); // newest first
  const inLastWeek = (effort) => ridingDays.filter((d) => d > today - 1 - WEEK_DAYS && days.get(d) === effort).length;

  let streak = 0;
  while (days.has(today - 1 - streak)) streak++;

  // Riding days since the last break; the start of the history counts as a break.
  let daysSinceBreak = 0;
  let previous = today;
  for (const day of ridingDays) {
    if (previous - day >= BREAK_DAYS) break;
    daysSinceBreak++;
    previous = day;
  }

  return {
    rodeToday,
    daysSinceLast: ridingDays.length ? today - ridingDays[0] : null,
    daysSinceHard: lastHard ? today - lastHard.day : null,
    lastHardKind: lastHard?.kind ?? null,
    yesterday: days.get(today - 1) ?? null,
    streak,
    hardThisWeek: inLastWeek('hard'),
    moderateThisWeek: inLastWeek('moderate'),
    daysSinceBreak,
    rideCount: ridingDays.length,
  };
}

/** Hard session that fits the time: short and sharp, at FTP, or long under it. */
function hardSession(minutes, lastHardKind) {
  if (minutes <= SHORT_MINUTES) return 'vo2';
  if (minutes <= MEDIUM_MINUTES) return lastHardKind === 'threshold' ? 'vo2' : 'threshold';
  return 'sweetspot';
}

/**
 * Pick today's intensity.
 * @param {{rides:object[], minutes:number, feeling?:'fresh'|'normal'|'tired', now:number}} input
 * @returns {{level:string, reason:string}}  level is a generator level id (src/workout/generator.js)
 */
export function recommend({ rides, minutes, feeling = DEFAULT_FEELING, now }) {
  const s = trainingSignals(rides, now);
  const pick = (level, reason) => ({ level, reason });

  if (s.rodeToday) return pick('recovery', 'You already rode today, so keep this one easy.');
  if (s.daysSinceBreak < EASY_DAYS_AFTER_BREAK) {
    if (s.rideCount === 0) return pick('endurance', 'A steady ride to start: it builds the base everything else needs.');
    return s.daysSinceLast >= BREAK_DAYS
      ? pick('endurance', `Easing back in after ${plural(s.daysSinceLast, 'day')} off.`)
      : pick('endurance', 'Still easing back in after your break: one more steady ride.');
  }
  if (feeling === 'tired') {
    return s.streak >= 2 || s.daysSinceHard === 1
      ? pick('recovery', 'Tired legs after recent riding: easy spinning helps you recover.')
      : pick('endurance', 'Tired legs: a steady ride, nothing hard.');
  }
  if (s.streak >= STREAK_DAYS) {
    return pick(minutes <= STREAK_RECOVERY_MINUTES ? 'recovery' : 'endurance', `Day ${s.streak + 1} in a row: an easy day lets the work sink in.`);
  }
  if (s.yesterday === 'hard') return pick('endurance', 'Yesterday was hard: steady riding today, hard again later.');
  if (s.yesterday === 'moderate') return pick('endurance', 'Yesterday was a solid session: keep today steady.');
  if (s.hardThisWeek >= MAX_HARD_PER_WEEK) {
    if (minutes >= LONG_MINUTES && s.moderateThisWeek === 0) {
      return pick('sweetspot', `${MAX_HARD_PER_WEEK} hard sessions already this week; sweet spot keeps fitness moving without a third.`);
    }
    return pick('endurance', `${MAX_HARD_PER_WEEK} hard sessions already this week: steady riding burns plenty and adds fitness.`);
  }
  if (feeling !== 'fresh' && s.daysSinceHard === MIN_HARD_GAP && minutes > SHORT_MINUTES) {
    return pick('sweetspot', `Hard session ${ago(s.daysSinceHard)}: sweet spot today. Pick “Fresh” if your legs are up for more.`);
  }
  const level = hardSession(minutes, s.lastHardKind);
  const since = s.daysSinceHard == null ? 'No hard session recorded yet' : `Last hard session ${ago(s.daysSinceHard)}`;
  const week = s.hardThisWeek === 0 ? 'none yet this week' : '1 of 2 this week';
  return pick(level, `${since}, ${week}: a hard session is due.`);
}
