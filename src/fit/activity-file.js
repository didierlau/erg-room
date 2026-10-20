/**
 * Build a FIT activity file (indoor cycling) from a recorded ride.
 *
 * Messages, in order: file_id, event(start), record × n, event(stop),
 * lap × (one per workout step), session, activity. This is the layout
 * Strava, Garmin Connect, intervals.icu and TrainingPeaks expect.
 */
import { FitWriter, toFitTime } from './fit-writer.js';
import { rideStats } from '../ride/stats.js';

// FIT profile message numbers
const MSG = { FILE_ID: 0, SESSION: 18, LAP: 19, RECORD: 20, EVENT: 21, ACTIVITY: 34 };
// FIT profile enum values
const FILE_TYPE_ACTIVITY = 4;
const MANUFACTURER_DEVELOPMENT = 255;
const EVENT = { TIMER: 0, SESSION: 8, LAP: 9, ACTIVITY: 26 };
const EVENT_TYPE = { START: 0, STOP: 1, STOP_ALL: 4 };
const SPORT_CYCLING = 2;
const SUB_SPORT_INDOOR_CYCLING = 6;
const LAP_TRIGGER_TIME = 1;
const SESSION_TRIGGER_ACTIVITY_END = 0;
const ACTIVITY_TYPE_MANUAL = 0;

// Local message types used in this file
const L = { FILE_ID: 0, EVENT: 1, RECORD: 2, LAP: 3, SESSION: 4, ACTIVITY: 5 };

/**
 * Split sample indexes into laps wherever the workout step (`samples.g`) changes.
 * @returns {Array<[number, number]>} inclusive [first, last] sample index per lap
 */
export function lapRanges(stepIndexes) {
  const laps = [];
  let first = 0;
  for (let i = 1; i <= stepIndexes.length; i++) {
    if (i === stepIndexes.length || stepIndexes[i] !== stepIndexes[i - 1]) {
      laps.push([first, i - 1]);
      first = i;
    }
  }
  return laps;
}

function lapSummary(S, first, last) {
  let sumP = 0, maxP = 0, sumH = 0, nH = 0, maxH = 0, sumC = 0, nC = 0;
  for (let i = first; i <= last; i++) {
    sumP += S.p[i];
    maxP = Math.max(maxP, S.p[i]);
    if (S.h[i]) { sumH += S.h[i]; nH++; maxH = Math.max(maxH, S.h[i]); }
    if (S.c[i] > 0) { sumC += S.c[i]; nC++; }
  }
  const count = last - first + 1;
  return {
    count,
    distance: S.d[last] - (first ? S.d[first - 1] : 0),
    kj: sumP / 1000,
    avgPower: sumP / count,
    maxPower: maxP,
    avgHr: nH ? sumH / nH : null,
    maxHr: nH ? maxH : null,
    avgCadence: nC ? sumC / nC : null,
  };
}

/**
 * @param {{start:number, ftp:number, samples:import('../ride/engine.js').Samples}} ride
 * @param {{timezoneOffsetSeconds?: number}} [options]  local time minus UTC; defaults to the device's zone
 * @returns {Uint8Array}
 */
export function buildActivityFit(ride, options = {}) {
  const S = ride.samples;
  const n = S.p.length;
  if (!n) throw new Error('A ride needs at least one sample to export');
  const t0 = toFitTime(ride.start);
  const at = (i) => t0 + S.t[i];
  const tEnd = at(n - 1);
  const stats = rideStats(ride);
  const tz = options.timezoneOffsetSeconds ?? -new Date(ride.start).getTimezoneOffset() * 60;
  const f = new FitWriter();

  f.define(L.FILE_ID, MSG.FILE_ID, [[0, 'enum'], [1, 'uint16'], [2, 'uint16'], [3, 'uint32z'], [4, 'uint32']]);
  f.write(L.FILE_ID, [FILE_TYPE_ACTIVITY, MANUFACTURER_DEVELOPMENT, 1, (t0 % 4e9) + 1, t0]);

  f.define(L.EVENT, MSG.EVENT, [[253, 'uint32'], [0, 'enum'], [1, 'enum'], [4, 'uint8']]);
  f.write(L.EVENT, [t0, EVENT.TIMER, EVENT_TYPE.START, 0]);

  // record: timestamp, power, cadence, heart_rate, speed (mm/s), distance (cm)
  f.define(L.RECORD, MSG.RECORD, [[253, 'uint32'], [7, 'uint16'], [4, 'uint8'], [3, 'uint8'], [6, 'uint16'], [5, 'uint32']]);
  for (let i = 0; i < n; i++) f.write(L.RECORD, [at(i), S.p[i], S.c[i], S.h[i], S.s[i] * 1000, S.d[i] * 100]);

  f.write(L.EVENT, [tEnd, EVENT.TIMER, EVENT_TYPE.STOP_ALL, 0]);

  const laps = lapRanges(S.g);
  f.define(L.LAP, MSG.LAP, [[253, 'uint32'], [254, 'uint16'], [0, 'enum'], [1, 'enum'], [2, 'uint32'], [7, 'uint32'], [8, 'uint32'], [9, 'uint32'],
    [11, 'uint16'], [15, 'uint8'], [16, 'uint8'], [17, 'uint8'], [19, 'uint16'], [20, 'uint16'], [24, 'enum'], [25, 'enum'], [39, 'enum']]);
  laps.forEach(([first, last], index) => {
    const lap = lapSummary(S, first, last);
    const elapsed = at(last) - at(first) + 1;
    f.write(L.LAP, [at(last), index, EVENT.LAP, EVENT_TYPE.STOP, at(first), elapsed * 1000, lap.count * 1000, lap.distance * 100,
      lap.kj, lap.avgHr, lap.maxHr, lap.avgCadence, lap.avgPower, lap.maxPower, LAP_TRIGGER_TIME, SPORT_CYCLING, SUB_SPORT_INDOOR_CYCLING]);
  });

  f.define(L.SESSION, MSG.SESSION, [[253, 'uint32'], [254, 'uint16'], [0, 'enum'], [1, 'enum'], [2, 'uint32'], [5, 'enum'], [6, 'enum'], [7, 'uint32'], [8, 'uint32'],
    [9, 'uint32'], [11, 'uint16'], [14, 'uint16'], [16, 'uint8'], [17, 'uint8'], [18, 'uint8'], [19, 'uint8'], [20, 'uint16'], [21, 'uint16'], [25, 'uint16'],
    [26, 'uint16'], [34, 'uint16'], [28, 'enum']]);
  f.write(L.SESSION, [tEnd, 0, EVENT.SESSION, EVENT_TYPE.STOP, t0, SPORT_CYCLING, SUB_SPORT_INDOOR_CYCLING, (tEnd - t0 + 1) * 1000, n * 1000,
    stats.distance * 100, stats.kj, stats.duration ? (stats.distance / stats.duration) * 1000 : null, stats.avgHr, stats.maxHr,
    stats.avgCadence, stats.maxCadence, stats.avgPower, stats.maxPower, 0, laps.length, stats.normalizedPower, SESSION_TRIGGER_ACTIVITY_END]);

  f.define(L.ACTIVITY, MSG.ACTIVITY, [[253, 'uint32'], [0, 'uint32'], [1, 'uint16'], [2, 'enum'], [3, 'enum'], [4, 'enum'], [5, 'uint32']]);
  f.write(L.ACTIVITY, [tEnd, n * 1000, 1, ACTIVITY_TYPE_MANUAL, EVENT.ACTIVITY, EVENT_TYPE.STOP, tEnd + tz]);

  return f.toBytes();
}
