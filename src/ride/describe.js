/**
 * Plain-language descriptions of where the rider is in a workout, shared by
 * every ride screen. Pure functions of the session: no DOM.
 */
import { formatDuration } from '../core/format.js';
import { EFFORT_STEP_W, INTENSITY_STEP } from './engine.js';

/** Gradient change per +/− press in free ride, in percent. */
export const GRADE_STEP = 1;

/**
 * What the current step is, e.g. "Interval 2 of 5" or "Ramp up".
 * @param {import('./engine.js').RideSession} session
 * @param {ReturnType<import('../workout/model.js').segmentAt>} position  null once the workout is done
 */
export function describeStep(session, position) {
  if (!position) return session.test ? 'Test done · spin easy' : 'Cool down as you like';
  const s = position.segment;
  if (s.tag === 'ramp-step') return `Ramp · ${s.label}`;
  if (s.label) return s.label;
  if (s.free) return 'Free ride';
  if (s.reps) return `${s.on ? 'Interval' : 'Recovery'} ${s.rep} of ${s.reps}`;
  if (s.p1 !== s.p2) return s.p2 > s.p1 ? 'Ramp up' : 'Ramp down';
  return 'Steady';
}

/**
 * What comes after the current step, e.g. "Next: 5:00 at 230 W".
 * @param {import('./engine.js').RideSession} session
 * @param {ReturnType<import('../workout/model.js').segmentAt>} position
 */
export function describeNext(session, position) {
  if (!position) return 'Tap Finish to save your ride';
  const next = session.segments[position.index + 1];
  if (!next) return 'Next: finish';
  const watts = (f) => Math.round(f * session.ftp * session.intensity);
  const pct = (f) => Math.round(f * session.intensity * 100);
  if (next.tag === 'ramp-step') return `Next: ${watts(next.p1)} W. Hold it as long as you can`;
  if (next.tag === 'effort') return `Next: ${next.label}, as hard as you can sustain`;
  if (next.free) return `Next: ${formatDuration(next.d)} free ride`;
  if (next.p1 !== next.p2) return `Next: ${formatDuration(next.d)} ramp ${pct(next.p1)}→${pct(next.p2)}%`;
  return `Next: ${formatDuration(next.d)} at ${watts(next.p1)} W`;
}

/**
 * What one +/− press changes in the current step: the label to show on the buttons.
 * @param {ReturnType<import('../workout/model.js').segmentAt>} position
 * @returns {'5 W' | '1%' | '5%'}
 */
export function nudgeStepLabel(position) {
  if (position?.segment.tag === 'effort') return `${EFFORT_STEP_W} W`;
  if (!position || position.segment.free) return `${GRADE_STEP}%`;
  return `${Math.round(INTENSITY_STEP * 100)}%`;
}

/**
 * Status line shown over the chart, or '' when riding normally.
 * @param {import('./engine.js').RideSession} session
 * @param {import('./engine.js').Reading} reading
 */
export function describeState(session, reading) {
  if (session.paused) return 'Paused';
  if (!session.pedalling && !session.done) return reading.fresh ? 'Start pedalling to continue' : 'Waiting for trainer data';
  return '';
}

/**
 * The toast shown after a +/− press.
 * @param {{kind:'intensity'|'grade'|'effort', value:number}} result  from RideSession.nudge
 */
export function describeNudge(result) {
  const messages = {
    grade: `Gradient ${result.value}%`,
    effort: `Target ${result.value} W`,
    intensity: `Intensity ${Math.round(result.value * 100)}%`,
  };
  return messages[result.kind];
}
