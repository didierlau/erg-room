/**
 * Turns a recorded FTP test (or a history of rides) into an FTP estimate.
 * Pure functions: no DOM, no storage.
 *
 * Every analysis returns either
 *   { ok:true, protocol, ftp, cp?, wPrime?, lthr?, maxHr?, details:[[label, value]], warnings:[string], basis:string }
 * or
 *   { ok:false, error:string }   (the message is shown to the rider)
 */

import { LTHR_FROM_MAX } from '../ride/hr-zones.js';

/** FTP as a fraction of best 1-minute power in a ramp test. */
export const RAMP_FACTOR = 0.75;
/** FTP as a fraction of 20-minute power. */
export const TWENTY_FACTOR = 0.95;
/** LTHR as a fraction of average heart rate in a 20-minute test (Friel). */
export const TWENTY_LTHR_FACTOR = 0.95;
/** FTP as a fraction of Critical Power. CP sits slightly above FTP/MLSS for most riders. */
export const CP_TO_FTP = 0.95;
/** Heart rate is averaged over the end of each submaximal stage, once it has settled. */
export const STAGE_SETTLED_SECONDS = 120;
/** An effort counts only if at least this share of it was recorded. */
const MIN_COMPLETE = 0.9;
/** Plausible W′ range in joules; outside it the efforts were probably not maximal. */
const W_PRIME_RANGE = [5000, 40000];
/** Durations (s) used for the power-duration fit from ride history. */
export const HISTORY_DURATIONS = [180, 300, 480, 720, 1200];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = Math.round;
const kj = (j) => `${(j / 1000).toFixed(1)} kJ`;

/** Highest average over any `window` consecutive samples, or null if the series is too short. */
export function bestAverage(values, window) {
  if (values.length < window || window <= 0) return null;
  let sum = 0;
  for (let i = 0; i < window; i++) sum += values[i];
  let best = sum;
  for (let i = window; i < values.length; i++) {
    sum += values[i] - values[i - window];
    if (sum > best) best = sum;
  }
  return best / window;
}

/** Ordinary least squares y = intercept + slope·x, with R². */
export function linearFit(xs, ys) {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy ? (sxy * sxy) / (sxx * syy) : 1 };
}

/**
 * Two-parameter Critical Power model (Monod & Scherrer): work = CP·t + W′.
 * @param {Array<{seconds:number, watts:number}>} efforts  best average power for each duration
 */
export function fitCriticalPower(efforts) {
  const fit = linearFit(efforts.map((e) => e.seconds), efforts.map((e) => e.watts * e.seconds));
  return { cp: fit.slope, wPrime: fit.intercept, r2: fit.r2 };
}

/** Sample indexes belonging to each segment, keyed by segment index. */
function samplesBySegment(samples) {
  const map = new Map();
  samples.g.forEach((g, i) => {
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(i);
  });
  return map;
}

/** Recorded samples of every segment carrying `tag`, in workout order. */
function taggedSegments(record, tag) {
  const bySegment = samplesBySegment(record.samples);
  return record.segments
    .map((segment, index) => ({ segment, index, samples: bySegment.get(index) ?? [] }))
    .filter((s) => s.segment.tag === tag);
}

const pick = (record, indexes, key) => indexes.map((i) => record.samples[key][i]);
const heartRates = (record, indexes) => pick(record, indexes, 'h').filter((h) => h);

function maxHrOf(record) {
  const hr = record.samples.h.filter((h) => h);
  return hr.length ? Math.max(...hr) : null;
}

function analyzeRamp(record) {
  const steps = taggedSegments(record, 'ramp-step').filter((s) => s.samples.length);
  const indexes = steps.flatMap((s) => s.samples);
  const best = bestAverage(pick(record, indexes, 'p'), 60);
  if (best == null) return { ok: false, error: 'The ramp needs at least one full minute of steps to give a result.' };
  const lastStep = steps.at(-1);
  const maxHr = maxHrOf(record);
  const warnings = [];
  if (steps.length < 8) warnings.push('The test ended within the first few steps. If that was earlier than your limit, repeat it on a fresh day.');
  return {
    ok: true, protocol: 'ramp', ftp: round(best * RAMP_FACTOR), maxHr,
    basis: `${RAMP_FACTOR * 100}% of your best 1-minute power`,
    details: [['Best 1-minute power', `${round(best)} W`], ['Last step reached', `${lastStep.segment.label} · ${round(lastStep.segment.p1 * record.ftp)} W`], ['Max heart rate', maxHr ? `${maxHr} bpm` : '—']],
    warnings: [...warnings, 'Ramp results run high for riders with a strong sprint and low for steady endurance riders. A 20-minute or CP test checks it.'],
  };
}

/** The recorded part of an effort, or an error if too little of it was ridden. */
function completeEffort(record, effort) {
  if (!effort || effort.samples.length < effort.segment.d * MIN_COMPLETE) {
    return { error: `The ${effort?.segment.label?.toLowerCase() ?? 'effort'} wasn’t completed, so there is nothing reliable to measure.` };
  }
  const power = pick(record, effort.samples, 'p');
  return { power, avg: mean(power), hr: heartRates(record, effort.samples) };
}

function analyzeTwenty(record) {
  const [effort] = taggedSegments(record, 'effort');
  const e = completeEffort(record, effort);
  if (e.error) return { ok: false, error: e.error };
  const warnings = [];
  const fiveMin = 300;
  const first = mean(e.power.slice(0, fiveMin));
  const last = mean(e.power.slice(-fiveMin));
  if (first > last * 1.08) warnings.push(`You started ${round((first / last - 1) * 100)}% harder than you finished. Even pacing usually gives a higher, truer result.`);
  if (last > first * 1.1) warnings.push('You finished much stronger than you started, so there was probably more in the tank. The result may be low.');

  let lthr = null;
  const details = [['20-minute power', `${round(e.avg)} W`]];
  if (e.hr.length > e.power.length * 0.8) {
    lthr = round(mean(e.hr) * TWENTY_LTHR_FACTOR);
    details.push(['Average heart rate', `${round(mean(e.hr))} bpm`], ['Threshold heart rate', `${lthr} bpm`]);
    // Aerobic decoupling: power per heartbeat in the second half vs the first half.
    const half = Math.floor(e.power.length / 2);
    const ef = (from, to) => mean(e.power.slice(from, to)) / mean(pick(record, effort.samples.slice(from, to), 'h').filter((h) => h));
    const decoupling = (1 - ef(half, e.power.length) / ef(0, half)) * 100;
    details.push(['Heart-rate drift', `${decoupling.toFixed(1)}%`]);
  } else {
    details.push(['Threshold heart rate', 'No heart-rate data']);
  }
  return { ok: true, protocol: 'twenty', ftp: round(e.avg * TWENTY_FACTOR), lthr, maxHr: maxHrOf(record), basis: `${TWENTY_FACTOR * 100}% of your 20-minute power`, details, warnings };
}

function analyzeCp(record) {
  const efforts = taggedSegments(record, 'effort');
  const done = efforts.map((effort) => ({ effort, result: completeEffort(record, effort) }));
  const failed = done.find((d) => d.result.error);
  if (failed || done.length < 2) return { ok: false, error: failed?.result.error ?? 'Both efforts are needed to calculate Critical Power.' };
  const points = done.map((d) => ({ seconds: d.effort.segment.d, watts: d.result.avg }));
  const { cp, wPrime } = fitCriticalPower(points);
  if (!(cp > 0) || !(wPrime > 0)) {
    return { ok: false, error: 'The longer effort wasn’t clearly easier than the shorter one, so Critical Power can’t be calculated. Both efforts need to be truly all-out.' };
  }
  const warnings = [];
  if (wPrime < W_PRIME_RANGE[0] || wPrime > W_PRIME_RANGE[1]) {
    warnings.push(`W′ came out at ${kj(wPrime)}, outside the usual 5–40 kJ. One of the efforts was probably not maximal, which skews the result.`);
  }
  return {
    ok: true, protocol: 'cp', ftp: round(cp * CP_TO_FTP), cp: round(cp), wPrime: round(wPrime), maxHr: maxHrOf(record),
    basis: `${CP_TO_FTP * 100}% of your Critical Power`,
    details: [...points.map((p) => [`${p.seconds / 60}-minute power`, `${round(p.watts)} W`]), ['Critical Power', `${round(cp)} W`], ['W′ (anaerobic capacity)', kj(wPrime)]],
    warnings,
  };
}

function analyzeSubmax(record, settings) {
  const stages = taggedSegments(record, 'stage');
  const points = [];
  for (const stage of stages) {
    const settled = stage.samples.slice(-STAGE_SETTLED_SECONDS);
    const hr = heartRates(record, settled);
    if (settled.length < STAGE_SETTLED_SECONDS * MIN_COMPLETE || hr.length < settled.length * 0.8) continue;
    points.push({ watts: mean(pick(record, settled, 'p')), hr: mean(hr) });
  }
  if (points.length < 3) return { ok: false, error: 'At least three completed stages with heart-rate data are needed. Check that your heart-rate strap is connected.' };

  const thresholdHr = settings.lthr ?? (settings.maxHr ? settings.maxHr * LTHR_FROM_MAX : null);
  if (!thresholdHr) return { ok: false, error: 'Add your threshold or max heart rate in Settings, then open this ride again from Rides.' };

  const fit = linearFit(points.map((p) => p.watts), points.map((p) => p.hr));
  if (!(fit.slope > 0)) return { ok: false, error: 'Your heart rate didn’t rise with power, so no estimate is possible. A strap that drops out or a very short warm-up can cause this.' };
  const ftp = (thresholdHr - fit.intercept) / fit.slope;
  const warnings = [];
  if (fit.r2 < 0.9) warnings.push(`Heart rate and power didn’t line up well (R² ${fit.r2.toFixed(2)}). Heat, caffeine, fatigue or a loose strap can do this.`);
  const highest = Math.max(...points.map((p) => p.watts));
  if (ftp > highest * 1.3) warnings.push('The estimate is far above your highest stage, so it relies on a long extrapolation.');
  if (!settings.lthr) warnings.push(`No threshold heart rate is set, so ${round(LTHR_FROM_MAX * 100)}% of your max heart rate was used. A 20-minute test measures it properly.`);
  warnings.push('Heart-rate estimates are typically within about 5–10% of a maximal test. Use them between tests, not instead of them.');
  return {
    ok: true, protocol: 'submax', ftp: round(ftp),
    basis: `power where your heart-rate line reaches ${round(thresholdHr)} bpm`,
    details: [...points.map((p, i) => [`Stage ${i + 1}`, `${round(p.watts)} W · ${round(p.hr)} bpm`]), ['Heart rate per 10 W', `${(fit.slope * 10).toFixed(1)} bpm`], ['Fit (R²)', fit.r2.toFixed(2)]],
    warnings,
  };
}

/**
 * @param {{test:{protocol:string}, ftp:number, segments:object[], samples:object}} record  a finished test ride
 * @param {{lthr?:number|null, maxHr?:number|null}} settings
 */
export function analyzeTest(record, settings = {}) {
  switch (record.test?.protocol) {
    case 'ramp': return analyzeRamp(record);
    case 'twenty': return analyzeTwenty(record);
    case 'cp': return analyzeCp(record);
    case 'submax': return analyzeSubmax(record, settings);
    default: return { ok: false, error: 'This ride is not an FTP test.' };
  }
}

/**
 * FTP from recent rides: best power at 3–20 minutes across rides, fitted with the
 * Critical Power model. Only as good as the hardest efforts in those rides.
 * @param {Array<{start:number, samples:{p:number[]}}>} rides
 */
export function estimateFromHistory(rides, { now = Date.now(), days = 90 } = {}) {
  const since = now - days * 86400000;
  const recent = rides.filter((r) => r.start >= since && r.samples?.p?.length);
  const efforts = HISTORY_DURATIONS
    .map((seconds) => ({ seconds, watts: Math.max(0, ...recent.map((r) => bestAverage(r.samples.p, seconds) ?? 0)) }))
    .filter((e) => e.watts > 0);
  if (efforts.length < 3) return { ok: false, error: `Not enough data yet: this needs rides of at least ${HISTORY_DURATIONS[2] / 60} minutes from the last ${days} days.` };
  const { cp, wPrime, r2 } = fitCriticalPower(efforts);
  if (!(cp > 0) || !(wPrime > 0)) return { ok: false, error: 'Your recent rides don’t contain hard enough efforts at different lengths to model your power curve.' };
  const warnings = ['This assumes your recent rides include near-maximal efforts between 3 and 20 minutes. Steady endurance rides give an estimate that is too low.'];
  if (wPrime > W_PRIME_RANGE[1]) warnings.push('The short efforts look much harder than the long ones, which usually means the longer efforts weren’t maximal.');
  return {
    ok: true, protocol: 'history', ftp: round(cp * CP_TO_FTP), cp: round(cp), wPrime: round(wPrime),
    basis: `${CP_TO_FTP * 100}% of Critical Power from your best efforts in ${recent.length} ride${recent.length === 1 ? '' : 's'}`,
    details: [...efforts.map((e) => [`Best ${e.seconds / 60} min`, `${round(e.watts)} W`]), ['Critical Power', `${round(cp)} W`], ['W′', kj(wPrime)], ['Fit (R²)', r2.toFixed(3)]],
    warnings,
  };
}
