/**
 * Dashboard ride screen: big power and target numbers, the interval clock,
 * cadence/heart rate/intensity/work, and the workout profile with the
 * rider's power traced over it. This is the default screen.
 */
import { createScreenRoot, loadStylesheet } from '../screen.js';
import { drawProfile } from '../../profile-chart.js';
import { formatDuration } from '../../../core/format.js';
import { zoneOf } from '../../../workout/model.js';
import { describeNext, describeState, describeStep, nudgeStepLabel } from '../../../ride/describe.js';

/** The profile chart is redrawn at most this often (ms); numbers update every frame. */
const CHART_REDRAW_MS = 900;

const TEMPLATE = `
  <div class="rtop">
    <h2 data-el="name">Workout</h2>
    <span class="demo-badge" data-el="demo" hidden>Demo</span>
    <div class="t"><span class="label">Elapsed</span><b data-el="elapsed">0:00</b></div>
    <div class="t"><span class="label">Left</span><b data-el="left">0:00</b></div>
    <button class="btn small" data-el="end">Finish</button>
  </div>
  <div class="rbody">
    <div class="hero">
      <div class="gauge"><span class="label">Power</span><div class="big" data-el="power">—<small>W</small></div><div class="dev" data-el="dev">&nbsp;</div></div>
      <div class="gauge target" data-el="tgauge"><span class="label" data-el="tlabel">Target</span><div class="big" data-el="target">—<small>W</small></div><div class="dev" data-el="tpct">&nbsp;</div></div>
    </div>
    <div class="interval">
      <div class="clock" data-el="clock">0:00</div>
      <div class="what"><strong data-el="what">Steady</strong><span class="next" data-el="next">Next: —</span></div>
    </div>
    <div class="minis">
      <div class="mini"><span class="label">Cadence</span><b data-el="cad">—</b></div>
      <div class="mini"><span class="label">Heart rate</span><b data-el="hr">—</b></div>
      <div class="mini"><span class="label">Intensity</span><b data-el="int">100%</b></div>
      <div class="mini"><span class="label">Work</span><b data-el="kj">0 kJ</b></div>
    </div>
    <div class="profile"><canvas data-el="canvas"></canvas><span class="state" data-el="state" hidden></span></div>
  </div>
  <div class="controls">
    <button class="btn" data-el="minus"><span class="k">−5%</span></button>
    <button class="btn" data-el="pause">Pause</button>
    <button class="btn" data-el="skip">Skip ›</button>
    <button class="btn" data-el="plus"><span class="k">+5%</span></button>
  </div>`;

/**
 * @param {import('../screen.js').RideActions} actions
 * @returns {import('../screen.js').RideScreen}
 */
export function createDashboardScreen(actions) {
  loadStylesheet(new URL('./dashboard.css', import.meta.url));
  const root = createScreenRoot('dashboard', TEMPLATE);
  const el = Object.fromEntries([...root.querySelectorAll('[data-el]')].map((node) => [node.dataset.el, node]));
  let session = null;
  let lastChart = 0;

  el.plus.addEventListener('click', () => actions.onNudge(1));
  el.minus.addEventListener('click', () => actions.onNudge(-1));
  el.pause.addEventListener('click', () => actions.onTogglePause());
  el.skip.addEventListener('click', () => actions.onSkip());
  el.end.addEventListener('click', () => actions.onFinish());

  /** @param {import('../screen.js').RideFrame} frame */
  function render({ session: s, reading, displayPower, now }) {
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
    else el.dev.textContent = power != null && target ? `${power - target >= 0 ? '+' : ''}${power - target} W vs target` : reading.fresh ? ' ' : 'No data from trainer';

    el.clock.textContent = position ? formatDuration(Math.ceil(position.left)) : '0:00';
    el.what.textContent = describeStep(s, position);
    el.next.textContent = describeNext(s, position);
    el.cad.textContent = reading.fresh && reading.cadence ? Math.round(reading.cadence) : '—';
    el.hr.textContent = reading.hr ?? '—';
    el.int.textContent = `${Math.round(s.intensity * 100)}%`;
    el.kj.textContent = `${Math.round(s.work / 1000)} kJ`;
    el.elapsed.textContent = formatDuration(s.elapsedSeconds());
    el.left.textContent = s.test?.protocol === 'ramp' && !s.done ? 'Until you stop' : formatDuration(s.done ? 0 : s.total - s.workoutTime);
    el.pause.textContent = s.paused ? 'Resume' : 'Pause';
    // The +/− buttons change what the current step allows: intensity, effort watts or gradient.
    const step = nudgeStepLabel(position);
    if (el.plus.dataset.step !== step) {
      el.plus.dataset.step = step;
      el.plus.innerHTML = `<span class="k">+${step}</span>`;
      el.minus.innerHTML = `<span class="k">−${step}</span>`;
    }

    const message = describeState(s, reading);
    el.state.hidden = !message;
    el.state.textContent = message;

    if (now - lastChart > CHART_REDRAW_MS) {
      lastChart = now;
      drawProfile(el.canvas, s.segments, { progress: s.workoutTime, trace: s.trace, ftp: s.ftp, intensity: s.intensity });
    }
  }

  return {
    root,
    click: 'nudge',
    start(rideSession) {
      session = rideSession;
      lastChart = 0;
      el.name.textContent = session.name;
      el.demo.hidden = !session.demo && !session.test;
      el.demo.textContent = session.demo && session.test ? 'Demo test' : session.demo ? 'Demo' : 'Test';
    },
    stop() { session = null; },
    render,
    redraw() { lastChart = 0; },
  };
}
