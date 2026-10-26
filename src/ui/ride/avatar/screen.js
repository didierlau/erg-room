/**
 * Avatar ride screen: a cyclist on a road whose slope follows the target
 * power, with virtual gears on the Click. A toggle picks what the trainer
 * does: hold the target (ERG) or set resistance from terrain and gear.
 */
import { createScreenRoot, loadStylesheet } from '../screen.js';
import { drawScene } from './scene.js';
import { formatDuration } from '../../../core/format.js';
import { zoneOf } from '../../../workout/model.js';
import { buildTerrain } from '../../../ride/terrain.js';
import { GEAR_COUNT } from '../../../ride/gears.js';
import { describeNext, describeState, describeStep, nudgeStepLabel } from '../../../ride/describe.js';

/** With reduced motion, the scene is only drawn on the 4 Hz ride frames. */
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const TEMPLATE = `
  <div class="rtop">
    <h2 data-el="name">Workout</h2>
    <span class="demo-badge" data-el="demo" hidden>Demo</span>
    <div class="t"><span class="label">Elapsed</span><b data-el="elapsed">0:00</b></div>
    <div class="t"><span class="label">Left</span><b data-el="left">0:00</b></div>
    <button class="btn small" data-el="end">Finish</button>
  </div>
  <div class="scene">
    <canvas data-el="canvas"></canvas>
    <div class="hud power"><span class="label">Power</span><b data-el="power">—<small>W</small></b><span data-el="dev">&nbsp;</span></div>
    <div class="hud target" data-el="tbox"><span class="label" data-el="tlabel">Target</span><b data-el="target">—<small>W</small></b><span data-el="tpct">&nbsp;</span></div>
    <div class="hud gear"><span class="label">Gear</span><b data-el="gear">7</b><span data-el="grade">0.0%</span></div>
    <div class="hud minis">
      <span><i>rpm</i><b data-el="cad">—</b></span>
      <span><i>bpm</i><b data-el="hr">—</b></span>
      <span><i>km/h</i><b data-el="spd">—</b></span>
    </div>
    <span class="state" data-el="state" hidden></span>
  </div>
  <div class="interval">
    <div class="clock" data-el="clock">0:00</div>
    <div class="what"><strong data-el="what">Steady</strong><span class="next" data-el="next">Next: —</span></div>
  </div>
  <div class="moderow">
    <span class="seg" role="group" aria-label="Trainer mode">
      <button data-el="mode-erg" aria-pressed="true">ERG holds target</button>
      <button data-el="mode-gears" aria-pressed="false">Gears set resistance</button>
    </span>
    <span class="nudge" data-el="nudgebox">
      <button class="btn small" data-el="nminus">−5%</button>
      <span class="val"><span class="label" data-el="nlabel">Intensity</span><b data-el="nvalue">100%</b></span>
      <button class="btn small" data-el="nplus">+5%</button>
    </span>
  </div>
  <div class="controls">
    <button class="btn" data-el="down"><span class="k">▼</span>Gear</button>
    <button class="btn" data-el="pause">Pause</button>
    <button class="btn" data-el="skip">Skip ›</button>
    <button class="btn" data-el="up"><span class="k">▲</span>Gear</button>
  </div>`;

/**
 * @param {import('../screen.js').RideActions} actions
 * @returns {import('../screen.js').RideScreen}
 */
export function createAvatarScreen(actions) {
  loadStylesheet(new URL('./avatar.css', import.meta.url));
  const root = createScreenRoot('avatar', TEMPLATE);
  const el = Object.fromEntries([...root.querySelectorAll('[data-el]')].map((node) => [node.dataset.el, node]));
  let session = null;
  let terrain = null;
  let terrainKey = '';
  let latest = null;
  let crankAngle = 0;
  let wheelAngle = 0;
  let lastAnimation = 0;
  let animationFrame = 0;

  el.up.addEventListener('click', () => actions.onShift(1));
  el.down.addEventListener('click', () => actions.onShift(-1));
  el.nplus.addEventListener('click', () => actions.onNudge(1));
  el.nminus.addEventListener('click', () => actions.onNudge(-1));
  el['mode-erg'].addEventListener('click', () => actions.onSetResistance('erg'));
  el['mode-gears'].addEventListener('click', () => actions.onSetResistance('gears'));
  el.pause.addEventListener('click', () => actions.onTogglePause());
  el.skip.addEventListener('click', () => actions.onSkip());
  el.end.addEventListener('click', () => actions.onFinish());

  /** Terrain depends on the segments, the intensity and the free-ride gradient; rebuild when any changes. */
  function terrainFor(s) {
    const key = `${s.intensity}|${s.grade}`;
    if (!terrain || key !== terrainKey) {
      terrain = buildTerrain(s.segments, s.intensity, s.grade);
      terrainKey = key;
    }
    return terrain;
  }

  /** Advance the pedalling animation and draw the scene. Runs every animation frame while riding. */
  function animate(now) {
    if (!session || !latest) return;
    const { reading } = latest;
    const dt = lastAnimation ? Math.min(0.1, (now - lastAnimation) / 1000) : 0;
    lastAnimation = now;
    if (!session.paused && reading.fresh && reading.cadence > 0) {
      const turns = (reading.cadence / 60) * dt;
      crankAngle += turns * Math.PI * 2;
      wheelAngle += turns * Math.PI * 2 * session.gears.wheelTurnsPerCrank;
    }
    drawScene(el.canvas, { terrain: terrainFor(session), segments: session.segments, intensity: session.intensity,
      time: session.workoutTime, grade: session.terrainGrade(), crankAngle, wheelAngle });
  }

  function loop(now) {
    animate(now);
    animationFrame = requestAnimationFrame(loop);
  }

  /** @param {import('../screen.js').RideFrame} frame */
  function render(frame) {
    latest = frame;
    const { session: s, reading, displayPower } = frame;
    const position = s.position();
    const target = s.targetWatts(position);
    const power = reading.fresh ? Math.round(displayPower) : null;
    const gears = s.resistance === 'gears';

    el.power.innerHTML = `${power ?? '—'}<small>W</small>`;
    el.dev.textContent = power != null && target ? `${power - target >= 0 ? '+' : ''}${power - target} W` : reading.fresh ? ' ' : 'No data';
    if (target != null) {
      el.tlabel.textContent = gears ? 'Aim for' : 'Target';
      el.target.innerHTML = `${target}<small>W</small>`;
      el.tbox.style.setProperty('--zc', `var(--z${zoneOf(target / s.ftp)})`);
      el.tpct.textContent = `${Math.round((target / s.ftp) * 100)}% FTP`;
    } else {
      el.tlabel.textContent = s.done ? 'Workout' : 'Free ride';
      el.target.innerHTML = s.done ? 'Done' : `${s.grade}<small>%</small>`;
      el.tbox.style.setProperty('--zc', 'var(--line)');
      el.tpct.textContent = s.done ? 'Spin easy' : 'your gradient';
    }
    el.gear.textContent = `${s.gears.gear}`;
    el.gear.dataset.top = s.gears.gear === GEAR_COUNT ? '1' : '';
    const grade = gears ? s.simGrade(position) : s.terrainGrade(position);
    el.grade.textContent = `${grade > 0 ? '+' : ''}${grade.toFixed(1)}%${gears ? ' to trainer' : ''}`;
    el.cad.textContent = reading.fresh && reading.cadence ? Math.round(reading.cadence) : '—';
    el.hr.textContent = reading.hr ?? '—';
    el.spd.textContent = reading.fresh && reading.cadence ? s.gears.speedKmh(reading.cadence).toFixed(1) : '—';

    el.clock.textContent = position ? formatDuration(Math.ceil(position.left)) : '0:00';
    el.what.textContent = describeStep(s, position);
    el.next.textContent = describeNext(s, position);
    el.elapsed.textContent = formatDuration(s.elapsedSeconds());
    el.left.textContent = s.test?.protocol === 'ramp' && !s.done ? 'Until you stop' : formatDuration(s.done ? 0 : s.total - s.workoutTime);
    el.pause.textContent = s.paused ? 'Resume' : 'Pause';

    el['mode-erg'].setAttribute('aria-pressed', String(!gears));
    el['mode-gears'].setAttribute('aria-pressed', String(gears));
    // The intensity / effort / gradient nudge from the dashboard stays available here as on-screen buttons.
    const effort = position?.segment.tag === 'effort';
    const free = !position || position.segment.free;
    const step = nudgeStepLabel(position);
    el.nminus.textContent = `−${step}`;
    el.nplus.textContent = `+${step}`;
    el.nlabel.textContent = effort ? 'Effort' : free ? 'Gradient' : 'Intensity';
    el.nvalue.textContent = effort ? `${target} W` : free ? `${s.grade}%` : `${Math.round(s.intensity * 100)}%`;
    el.nudgebox.hidden = s.done;

    const message = describeState(s, reading);
    el.state.hidden = !message;
    el.state.textContent = message;
    if (reducedMotion()) animate(performance.now());
  }

  return {
    root,
    click: 'shift',
    start(rideSession) {
      session = rideSession;
      terrain = null;
      latest = null;
      lastAnimation = 0;
      el.name.textContent = session.name;
      el.demo.hidden = !session.demo && !session.test;
      el.demo.textContent = session.demo && session.test ? 'Demo test' : session.demo ? 'Demo' : 'Test';
      cancelAnimationFrame(animationFrame);
      if (!reducedMotion()) animationFrame = requestAnimationFrame(loop);
    },
    stop() {
      cancelAnimationFrame(animationFrame);
      session = null;
      latest = null;
    },
    render,
    redraw() { terrain = null; },
  };
}
