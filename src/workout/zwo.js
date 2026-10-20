/**
 * Import and export of Zwift workout files (.zwo).
 *
 * A .zwo is XML: <workout_file><name/><description/><workout>…steps…</workout></workout_file>.
 * Supported steps: Warmup, Cooldown, Ramp, SteadyState, IntervalsT, FreeRide, MaxEffort.
 * Text events, cadence targets and other attributes are ignored.
 */
import { createId, escapeHtml } from '../core/format.js';

/** Thrown for files that cannot be turned into a workout; `message` is shown to the user. */
export class ZwoError extends Error {}

/** Default XML parser for browsers. Tests pass their own. */
function browserParseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new ZwoError("isn't valid XML");
  return doc;
}

const elementChildren = (node) => Array.from(node.childNodes).filter((n) => n.nodeType === 1);

/** First attribute among `names` that holds a number, else null. */
function numberAttr(el, ...names) {
  for (const name of names) {
    const v = el.getAttribute(name);
    if (v != null && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function stepToBlock(el) {
  const tag = el.tagName.toLowerCase();
  const d = numberAttr(el, 'Duration') || 0;
  switch (tag) {
    case 'warmup':
    case 'cooldown':
    case 'ramp': {
      let lo = numberAttr(el, 'PowerLow', 'Power');
      let hi = numberAttr(el, 'PowerHigh', 'Power');
      if (lo == null) lo = hi ?? 0.5;
      if (hi == null) hi = lo;
      return lo === hi ? { t: 'steady', d, p: lo } : { t: 'ramp', d, p1: lo, p2: hi };
    }
    case 'steadystate': {
      let p = numberAttr(el, 'Power');
      if (p == null) {
        const lo = numberAttr(el, 'PowerLow');
        const hi = numberAttr(el, 'PowerHigh');
        p = lo != null && hi != null ? (lo + hi) / 2 : lo ?? hi ?? 0.6;
      }
      return { t: 'steady', d, p };
    }
    case 'intervalst':
      return {
        t: 'intervals',
        n: Math.max(1, Math.round(numberAttr(el, 'Repeat') || 1)),
        on: numberAttr(el, 'OnDuration') || 0,
        onP: numberAttr(el, 'OnPower', 'PowerOnHigh', 'PowerOnLow') ?? 1,
        off: numberAttr(el, 'OffDuration') || 0,
        offP: numberAttr(el, 'OffPower', 'PowerOffLow', 'PowerOffHigh') ?? 0.5,
      };
    case 'freeride':
    case 'maxeffort':
      return { t: 'free', d };
    default:
      return null; // textevent and unknown tags
  }
}

/**
 * @param {string} text  file contents
 * @param {string} fileName  used as the name when the file has none
 * @param {(text:string) => Document} [parseXml]
 * @returns {import('./model.js').Workout}
 */
export function parseZwo(text, fileName, parseXml = browserParseXml) {
  const doc = parseXml(text);
  const workoutEl = doc.getElementsByTagName('workout')[0];
  if (!workoutEl) throw new ZwoError('has no <workout> section');
  const blocks = elementChildren(workoutEl).map(stepToBlock).filter(Boolean);
  if (!blocks.length) throw new ZwoError('contains no workout steps Erg Room understands');
  const text0 = (tag) => doc.getElementsByTagName(tag)[0]?.textContent.trim() || '';
  return {
    id: createId(),
    name: text0('name') || fileName.replace(/\.[^.]+$/, ''),
    description: text0('description'),
    blocks,
  };
}

const round3 = (v) => Number(v.toFixed(3));

function blockToXml(b, index, count) {
  switch (b.t) {
    case 'steady': return `<SteadyState Duration="${b.d}" Power="${round3(b.p)}"/>`;
    case 'free': return `<FreeRide Duration="${b.d}" FlatRoad="1"/>`;
    case 'intervals':
      return `<IntervalsT Repeat="${b.n}" OnDuration="${b.on}" OffDuration="${b.off}" OnPower="${round3(b.onP)}" OffPower="${round3(b.offP)}"/>`;
    case 'ramp': {
      // Zwift draws a first rising ramp as a warm-up and a last falling one as a cool-down.
      const tag = index === 0 && b.p2 > b.p1 ? 'Warmup' : index === count - 1 && b.p2 < b.p1 ? 'Cooldown' : 'Ramp';
      return `<${tag} Duration="${b.d}" PowerLow="${round3(b.p1)}" PowerHigh="${round3(b.p2)}"/>`;
    }
    default:
      throw new Error(`Unknown block type: ${b.t}`);
  }
}

/** @param {import('./model.js').Workout} workout @returns {string} .zwo XML */
export function toZwo(workout) {
  const steps = workout.blocks.map((b, i) => `    ${blockToXml(b, i, workout.blocks.length)}`).join('\n');
  return [
    '<workout_file>',
    '  <author>Erg Room</author>',
    `  <name>${escapeHtml(workout.name)}</name>`,
    `  <description>${escapeHtml(workout.description || '')}</description>`,
    '  <sportType>bike</sportType>',
    '  <tags/>',
    '  <workout>',
    steps,
    '  </workout>',
    '</workout_file>',
    '',
  ].join('\n');
}
