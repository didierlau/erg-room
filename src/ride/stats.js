/**
 * Summary statistics for a recorded ride (one sample per second).
 */

/** Rolling window for Normalized Power, in samples (seconds). */
const NP_WINDOW = 30;

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/**
 * Normalized Power: 30-second rolling average, raised to the 4th power, averaged, 4th root.
 * Rides shorter than the window fall back to average power.
 */
export function normalizedPower(power) {
  if (!power.length) return 0;
  if (power.length < NP_WINDOW) return mean(power);
  let rolling = 0;
  let sumFourth = 0;
  let count = 0;
  for (let i = 0; i < power.length; i++) {
    rolling += power[i];
    if (i >= NP_WINDOW) rolling -= power[i - NP_WINDOW];
    if (i >= NP_WINDOW - 1) {
      sumFourth += (rolling / NP_WINDOW) ** 4;
      count++;
    }
  }
  return (sumFourth / count) ** 0.25;
}

/**
 * @param {{ftp:number, samples:import('./engine.js').Samples}} ride
 */
export function rideStats(ride) {
  const S = ride.samples;
  const n = S.p.length;
  if (!n) {
    return { duration: 0, timerTime: 0, avgPower: 0, normalizedPower: 0, maxPower: 0, kj: 0, avgHr: null, maxHr: null,
      avgCadence: null, maxCadence: null, distance: 0, intensity: 0, tss: 0 };
  }
  const hr = S.h.filter((h) => h);
  const cadence = S.c.filter((c) => c > 0);
  const duration = S.t[n - 1] - S.t[0] + 1;
  const np = normalizedPower(S.p);
  const intensity = ride.ftp ? np / ride.ftp : 0;
  const round = (v) => (v == null ? null : Math.round(v));
  return {
    duration,
    timerTime: n,
    avgPower: Math.round(mean(S.p)),
    normalizedPower: Math.round(np),
    maxPower: Math.max(...S.p),
    kj: Math.round(S.p.reduce((a, b) => a + b, 0) / 1000),
    avgHr: round(mean(hr)),
    maxHr: hr.length ? Math.max(...hr) : null,
    avgCadence: round(mean(cadence)),
    maxCadence: cadence.length ? Math.max(...cadence) : null,
    distance: S.d[n - 1] || 0,
    intensity,
    tss: (duration / 3600) * intensity ** 2 * 100,
  };
}
