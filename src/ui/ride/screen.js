/**
 * What every ride screen provides. A screen owns its own markup and stylesheet,
 * renders a RideSession, and reports taps through the shared ride actions.
 * The ride controller drives it; it never talks to devices or storage itself.
 *
 * @typedef {object} RideFrame
 * @property {import('../../ride/engine.js').RideSession} session
 * @property {import('../../ride/engine.js').Reading} reading  latest sensor data
 * @property {number|null} displayPower  smoothed watts for the headline number
 * @property {number} now  monotonic ms (performance.now())
 *
 * @typedef {object} RideActions
 * @property {(dir:1|-1) => void} onNudge  +/− pressed
 * @property {() => void} onTogglePause
 * @property {() => void} onSkip
 * @property {() => void} onFinish  the rider asked to finish; the app confirms and saves
 *
 * @typedef {object} RideScreen
 * @property {HTMLElement} root  full-screen element, hidden when not riding
 * @property {(session:import('../../ride/engine.js').RideSession) => void} start
 * @property {(frame:RideFrame) => void} render  called every frame (4×/s)
 * @property {() => void} stop
 * @property {() => void} redraw  force a full redraw on the next render (resize, intensity change)
 */

/** Add a screen's stylesheet next to its module, once. */
export function loadStylesheet(url) {
  const href = String(url);
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

/** Create the full-screen root for a screen. */
export function createScreenRoot(id, html) {
  const root = document.createElement('section');
  root.id = `ride-${id}`;
  root.className = `ride-screen ride-${id}`;
  root.hidden = true;
  root.innerHTML = html;
  return root;
}
