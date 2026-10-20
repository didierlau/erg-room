/**
 * FTP test protocols. Each builds a workout from the rider's current FTP; the
 * segments it tags tell the analysis which part of the ride to evaluate.
 *
 *   ramp     1-minute steps that rise until the rider can't hold the target.
 *            FTP = 75% of the best 1-minute power. Short and repeatable; tends to
 *            over-estimate for riders with a big anaerobic capacity.
 *   twenty   Classic 20-minute test (Allen & Coggan). FTP = 95% of 20-minute power.
 *            Also gives lactate-threshold heart rate.
 *   cp       3- and 12-minute maximal efforts → Critical Power and W′ (Monod's
 *            two-parameter model). Separates aerobic power from anaerobic capacity.
 *   submax   Four steady stages; heart rate vs power is fitted and extrapolated to
 *            threshold heart rate. No maximal effort, so it can be done often, but it
 *            is the least precise and needs a heart-rate strap and a known LTHR or max HR.
 *
 * Effort targets are a starting point: the rider paces with +/− (5 W per press).
 */

const warmup = [
  { t: 'ramp', d: 600, p1: 0.45, p2: 0.7 },
  { t: 'intervals', n: 3, on: 60, onP: 1.0, off: 60, offP: 0.5 },
  { t: 'steady', d: 300, p: 0.5 },
];
const cooldown = { t: 'ramp', d: 600, p1: 0.55, p2: 0.4 };

/** Ramp test: start, increment (fraction of FTP per minute) and number of steps. */
export const RAMP = { start: 0.5, step: 0.06, steps: 30 };
/** Submaximal stages as fractions of FTP. */
export const SUBMAX_STAGES = [0.55, 0.65, 0.75, 0.85];
export const SUBMAX_STAGE_SECONDS = 240;

export const PROTOCOLS = Object.freeze([
  {
    id: 'ramp',
    name: 'Ramp test',
    summary: 'One-minute steps that get harder until you can’t hold the target. Stops automatically when your cadence collapses.',
    measures: 'FTP from your best minute',
    needsHeartRate: false,
    blocks: () => [
      { t: 'ramp', d: 300, p1: 0.4, p2: RAMP.start },
      ...Array.from({ length: RAMP.steps }, (_, i) => ({ t: 'steady', d: 60, p: Number((RAMP.start + RAMP.step * i).toFixed(3)), tag: 'ramp-step', label: `Step ${i + 1}` })),
    ],
  },
  {
    id: 'twenty',
    name: '20-minute test',
    summary: 'A thorough warm-up, then 20 minutes as hard as you can sustain. Pace it evenly with + and −.',
    measures: 'FTP and threshold heart rate',
    needsHeartRate: false,
    blocks: () => [...warmup, { t: 'steady', d: 1200, p: 1.03, tag: 'effort', label: '20-minute effort' }, cooldown],
  },
  {
    id: 'cp',
    name: 'Critical Power 3/12',
    summary: 'A 3-minute and a 12-minute maximal effort with 30 minutes easy between. Models your aerobic and anaerobic capacity separately.',
    measures: 'Critical Power, W′ and FTP',
    needsHeartRate: false,
    blocks: () => [
      ...warmup,
      { t: 'steady', d: 180, p: 1.25, tag: 'effort', label: '3-minute effort' },
      { t: 'steady', d: 1800, p: 0.5 },
      { t: 'steady', d: 720, p: 1.05, tag: 'effort', label: '12-minute effort' },
      cooldown,
    ],
  },
  {
    id: 'submax',
    name: 'Heart-rate check',
    summary: 'Four easy-to-moderate steady stages, no all-out effort. Estimates FTP from how your heart rate rises with power.',
    measures: 'FTP estimate from heart rate',
    needsHeartRate: true,
    blocks: () => [
      { t: 'ramp', d: 360, p1: 0.4, p2: 0.55 },
      ...SUBMAX_STAGES.map((p, i) => ({ t: 'steady', d: SUBMAX_STAGE_SECONDS, p, tag: 'stage', label: `Stage ${i + 1} of ${SUBMAX_STAGES.length}` })),
      { t: 'ramp', d: 300, p1: 0.6, p2: 0.4 },
    ],
  },
]);

export const protocolById = (id) => PROTOCOLS.find((p) => p.id === id);

/** The workout to ride for a protocol. */
export function buildTestWorkout(id) {
  const protocol = protocolById(id);
  if (!protocol) throw new Error(`Unknown FTP test: ${id}`);
  return { id: `test-${id}`, name: protocol.name, description: protocol.summary, blocks: protocol.blocks(), test: { protocol: id } };
}
