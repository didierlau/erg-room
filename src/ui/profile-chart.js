/**
 * Draws a workout profile on a canvas: segments coloured by training zone,
 * a dashed FTP line, optional progress shading and an actual-power trace.
 * Colours come from the CSS custom properties so both themes work.
 */
import { zoneOf, totalDuration } from '../workout/model.js';
import { cssColor, prepareCanvas } from './canvas.js';
import { hrZoneOf } from '../ride/hr-zones.js';

/** Headroom above the highest bar. */
const HEADROOM = 1.06;
/** The chart always shows at least this much (fraction of FTP) so easy workouts are not stretched. */
const MIN_SCALE = 1.25;
/** Height used for free-ride segments. */
const FREE_RIDE_HEIGHT = 0.5;
/** Ramps are drawn as slices this many pixels wide so each slice gets its own zone colour. */
const RAMP_SLICE_PX = 3;
/** The heart-rate line spans this range of the threshold heart rate, bottom to top of the chart. */
const HR_SCALE = [0.5, 1.12];
/** Without a threshold heart rate, the line is scaled between these bpm. */
const HR_SCALE_FALLBACK_BPM = [80, 200];
/** Width of the heart-rate line and of its zone-coloured pieces. */
const HR_LINE_WIDTH = 2.2;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {import('../workout/model.js').Segment[]} segments
 * @param {{progress?:number, trace?:number[], ftp?:number, intensity?:number, labels?:boolean,
 *   hrTrace?:(number|null)[], hrReference?:number|null}} [options]
 *   progress: workout seconds completed; trace: watts by workout second; intensity scales targets;
 *   hrTrace: bpm by workout second, drawn on its own scale and coloured by heart-rate zone when hrReference (LTHR) is known
 */
export function drawProfile(canvas, segments, options = {}) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, w, h } = prepared;
  const { progress, trace, ftp, intensity = 1, labels = false, hrTrace, hrReference } = options;

  const total = Math.max(1, totalDuration(segments));
  let maxF = MIN_SCALE;
  for (const s of segments) if (!s.free) maxF = Math.max(maxF, s.p1 * intensity, s.p2 * intensity);
  if (trace && ftp) for (const v of trace) if (v != null) maxF = Math.max(maxF, v / ftp);
  maxF *= HEADROOM;

  const zones = [null, 1, 2, 3, 4, 5, 6].map((z) => z && cssColor(`--z${z}`));
  const bg = cssColor('--bg');
  const fg = cssColor('--fg');
  const muted = cssColor('--muted');
  const X = (t) => (t / total) * w;
  const Y = (f) => h - (f / maxF) * (h - 2);

  let t = 0;
  for (const s of segments) {
    const x0 = X(t);
    const x1 = X(t + s.d);
    if (s.free) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = muted;
      ctx.fillRect(x0, Y(FREE_RIDE_HEIGHT), x1 - x0, h - Y(FREE_RIDE_HEIGHT));
      ctx.globalAlpha = 1;
    } else {
      const p1 = s.p1 * intensity;
      const p2 = s.p2 * intensity;
      const slices = p1 === p2 ? 1 : Math.max(2, Math.ceil((x1 - x0) / RAMP_SLICE_PX));
      for (let k = 0; k < slices; k++) {
        const a = k / slices;
        const b = (k + 1) / slices;
        const fa = p1 + (p2 - p1) * a;
        const fb = p1 + (p2 - p1) * b;
        const xa = x0 + (x1 - x0) * a;
        const xb = x0 + (x1 - x0) * b + 0.4; // slight overlap hides seams
        ctx.fillStyle = zones[zoneOf((fa + fb) / 2)];
        ctx.beginPath();
        ctx.moveTo(xa, h);
        ctx.lineTo(xa, Y(fa));
        ctx.lineTo(xb, Y(fb));
        ctx.lineTo(xb, h);
        ctx.closePath();
        ctx.fill();
      }
    }
    t += s.d;
    if (x1 - x0 > 2) {
      ctx.fillStyle = bg;
      ctx.fillRect(x1 - 0.5, 0, 1, h);
    }
  }

  ctx.strokeStyle = muted;
  ctx.globalAlpha = 0.7;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, Y(1) + 0.5);
  ctx.lineTo(w, Y(1) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  if (labels) {
    ctx.fillStyle = muted;
    ctx.font = `11px ${cssColor('--body')}`;
    ctx.fillText('FTP', 4, Y(1) - 4);
  }

  if (progress != null) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, X(Math.min(progress, total)), h);
    ctx.globalAlpha = 1;
  }

  if (trace && ftp) {
    ctx.strokeStyle = fg;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let drawing = false;
    const step = Math.max(1, Math.floor(trace.length / (w * 1.5)));
    for (let i = 0; i < trace.length; i += step) {
      const v = trace[i];
      if (v == null) { drawing = false; continue; }
      const x = X(i + 0.5);
      const y = Y(v / ftp);
      if (drawing) ctx.lineTo(x, y);
      else { ctx.moveTo(x, y); drawing = true; }
    }
    ctx.stroke();
  }

  if (hrTrace?.length) drawHeartRate(ctx, hrTrace, { hrReference, X, h, w, zones, muted, bg });

  if (progress != null) {
    ctx.fillStyle = fg;
    ctx.fillRect(X(Math.min(progress, total)) - 1, 0, 2, h);
  }
}

/**
 * Heart rate by workout second as a line on its own vertical scale. Each piece
 * takes the colour of its heart-rate zone (muted without a reference); a halo in
 * the background colour keeps it visible over bars of the same colour.
 */
function drawHeartRate(ctx, hrTrace, { hrReference, X, h, w, zones, muted, bg }) {
  const [low, high] = hrReference ? [hrReference * HR_SCALE[0], hrReference * HR_SCALE[1]] : HR_SCALE_FALLBACK_BPM;
  const Y = (bpm) => h - 2 - ((Math.min(high, Math.max(low, bpm)) - low) / (high - low)) * (h - 4);
  const step = Math.max(1, Math.floor(hrTrace.length / (w * 1.5)));
  const pieces = [];
  let previous = null;
  for (let i = 0; i < hrTrace.length; i += step) {
    const bpm = hrTrace[i];
    if (!bpm) { previous = null; continue; }
    const point = { x: X(i + 0.5), y: Y(bpm) };
    if (previous) pieces.push({ from: previous, to: point, zone: hrZoneOf(bpm, hrReference) });
    previous = point;
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = bg;
  ctx.lineWidth = HR_LINE_WIDTH + 2;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  for (const { from, to } of pieces) { ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = HR_LINE_WIDTH;
  for (const { from, to, zone } of pieces) {
    ctx.strokeStyle = zone ? zones[zone] : muted;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}
