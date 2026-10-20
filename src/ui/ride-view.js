/**
 * The full-screen ride display. Renders a RideSession plus the latest
 * readings; buttons and keys are reported through callbacks.
 */
import { $, showDialog } from './dom.js';
import { drawProfile } from './profile-chart.js';
import { formatDuration } from '../core/format.js';
import { zoneOf } from '../workout/model.js';

/** The profile chart is redrawn at most this often (ms); numbers update every frame. */
const CHART_REDRAW_MS = 900;

/**
 * @param {{onNudge:(dir:1|-1) => void, onTogglePause:() => void, onSkip:() => void, onFinish:(save:boolean) => void}} actions
 */
export function createRideView(actions) {
  const root = $('#view-ride');
  const el = Object.fromEntries(['name', 'demo', 'elapsed', 'left', 'power', 'dev', 'tgauge', 'tlabel', 'target', 'tpct', 'clock', 'what', 'next',
    'cad', 'hr', 'int', 'kj', 'canvas', 'state', 'pause', 'plus', 'minus'].map((id) => [id, $(`#r-${id}`)]));
  let session = null;
  let lastChart = 0;

  $('#r-plus').addEventListener('click', () => actions.onNudge(1));
  $('#r-minus').addEventListener('click', () => actions.onNudge(-1));
  el.pause.addEventListener('click', () => actions.onTogglePause());
  $('#r-skip').addEventListener('click', () => actions.onSkip());
  $('#r-end').addEventListener('click', () => showDialog({
    title: 'Finish this ride?',
    text: session?.demo ? 'Demo rides are not saved.' : 'Your ride will be saved and ready to download as a .FIT file.',
    actions: [
      { label: 'Keep riding', style: 'ghost' },
      { label: 'Discard', style: 'danger', onClick: () => actions.onFinish(false) },
      { label: 'Finish & save', style: 'primary', onClick: () => actions.onFinish(true) },
    ],
  }));

  document.addEventListener('keydown', (e) => {
    if (!session || root.hidden || e.target.tagName === 'INPUT' || !$('#modal').hidden) return;
    const keys = { '+': () => actions.onNudge(1), '=': () => actions.onNudge(1), ArrowUp: () => actions.onNudge(1),
      '-': () => actions.onNudge(-1), ArrowDown: () => actions.onNudge(-1), ' ': () => actions.onTogglePause(), ArrowRight: () => actions.onSkip() };
    if (keys[e.key]) {
      keys[e.key]();
      e.preventDefault();
    }
  });

  function describeStep(position) {
    if (!position) return session.test ? 'Test done · spin easy' : 'Cool down as you like';
    const s = position.segment;
    if (s.tag === 'ramp-step') return `Ramp · ${s.label}`;
    if (s.label) return s.label;
    if (s.free) return 'Free ride';
    if (s.reps) return `${s.on ? 'Interval' : 'Recovery'} ${s.rep} of ${s.reps}`;
    if (s.p1 !== s.p2) return s.p2 > s.p1 ? 'Ramp up' : 'Ramp down';
    return 'Steady';
  }

  function describeNext(position) {
    if (!position) return 'Tap Finish to save your ride';
    const next = session.segments[position.index + 1];
    if (!next) return 'Next: finish';
    const pct = (f) => Math.round(f * session.intensity * 100);
    if (next.tag === 'ramp-step') return `Next: ${Math.round(next.p1 * session.ftp * session.intensity)} W. Hold it as long as you can`;
    if (next.tag === 'effort') return `Next: ${next.label}, as hard as you can sustain`;
    if (next.free) return `Next: ${formatDuration(next.d)} free ride`;
    if (next.p1 !== next.p2) return `Next: ${formatDuration(next.d)} ramp ${pct(next.p1)}→${pct(next.p2)}%`;
    return `Next: ${formatDuration(next.d)} at ${Math.round(next.p1 * session.ftp * session.intensity)} W`;
  }

  /**
   * @param {import('../ride/engine.js').Reading} reading
   * @param {number|null} displayPower  smoothed watts for the big number
   * @param {number} now  monotonic ms
   */
  function render(reading, displayPower, now) {
    const s = session;
    const position = s.position();
    const target = s.targetWatts(position);
    const power = reading.fresh ? Math.round(displayPower) : null;

    el.power.innerHTML = `${power ?? '—'}<small>W</small>`;
    if (target != null) {
      el.tlabel.textContent = 'Target';
      el.target.innerHTML = `${target}<small>W</small>`;
      el.tgauge.style.setProperty('--zc', `var(--z${zoneOf(target / s.ftp)})`);
      el.tpct.textContent = `${Math.round((target / s.ftp) * 100)}% of FTP ${s.ftp} W`;
    } else {
      el.tlabel.textContent = s.done ? 'Workout' : 'Gradient';
      el.target.innerHTML = s.done ? 'Done' : `${s.grade}<small>%</small>`;
      el.tgauge.style.setProperty('--zc', 'var(--line)');
      el.tpct.textContent = s.done ? 'All intervals complete' : 'ERG off. Click changes gradient.';
    }
    const effort = position?.segment.tag === 'effort';
    const stepAvg = effort ? s.stepAverage(position.index) : null;
    if (effort) el.dev.textContent = `Effort average ${stepAvg == null ? '—' : Math.round(stepAvg)} W`;
    else el.dev.textContent = power != null && target ? `${power - target >= 0 ? '+' : ''}${power - target} W vs target` : reading.fresh ? ' ' : 'No data from trainer';

    el.clock.textContent = position ? formatDuration(Math.ceil(position.left)) : '0:00';
    el.what.textContent = describeStep(position);
    el.next.textContent = describeNext(position);
    el.cad.textContent = reading.fresh && reading.cadence ? Math.round(reading.cadence) : '—';
    el.hr.textContent = reading.hr ?? '—';
    el.int.textContent = `${Math.round(s.intensity * 100)}%`;
    el.kj.textContent = `${Math.round(s.work / 1000)} kJ`;
    el.elapsed.textContent = formatDuration(s.elapsedSeconds());
    el.left.textContent = s.test?.protocol === 'ramp' && !s.done ? 'Until you stop' : formatDuration(s.done ? 0 : s.total - s.workoutTime);
    el.pause.textContent = s.paused ? 'Resume' : 'Pause';
    // The +/− buttons change what the current step allows: intensity, effort watts or gradient.
    const step = effort ? '5 W' : !position || position.segment.free ? '1%' : '5%';
    if (el.plus.dataset.step !== step) {
      el.plus.dataset.step = step;
      el.plus.innerHTML = `<span class="k">+${step}</span>`;
      el.minus.innerHTML = `<span class="k">−${step}</span>`;
    }

    let message = '';
    if (s.paused) message = 'Paused';
    else if (!s.pedalling && !s.done) message = reading.fresh ? 'Start pedalling to continue' : 'Waiting for trainer data';
    el.state.hidden = !message;
    el.state.textContent = message;

    if (now - lastChart > CHART_REDRAW_MS) {
      lastChart = now;
      drawProfile(el.canvas, s.segments, { progress: s.workoutTime, trace: s.trace, ftp: s.ftp, intensity: s.intensity });
    }
  }

  return {
    root,
    /** @param {import('../ride/engine.js').RideSession} rideSession */
    start(rideSession) {
      session = rideSession;
      lastChart = 0;
      el.name.textContent = session.name;
      el.demo.hidden = !session.demo && !session.test;
      el.demo.textContent = session.demo && session.test ? 'Demo test' : session.demo ? 'Demo' : 'Test';
    },
    stop() { session = null; },
    render,
    /** Redraw the chart on the next render (after a resize or intensity change). */
    invalidateChart() { lastChart = 0; },
  };
}
