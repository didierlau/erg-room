/**
 * Draws the avatar scene: a side view of the road ahead, coloured by training
 * zone and sloped by the target, with a cyclist riding it. Nothing here knows
 * about sessions; it is given plain numbers and arrays.
 *
 * The road is laid out in workout time: every second of the workout is
 * PX_PER_SECOND wide, and elevation comes from ride/terrain.js.
 */
import { cssColor, prepareCanvas } from '../../canvas.js';
import { elevationAt, SCENE_SPEED_MPS } from '../../../ride/terrain.js';
import { zoneOf } from '../../../workout/model.js';

/** Horizontal scale of the road. */
const PX_PER_SECOND = 4;
/** Slopes are drawn this many times steeper than they are, so a 5% climb looks like a climb. */
const VISUAL_EXAGGERATION = 6;
/** Where the rider sits across the width (fraction). */
const RIDER_X = 0.3;
/** Where the road under the rider sits down the height (fraction). */
const RIDER_Y = 0.7;
/** Wheel radius as a fraction of the canvas height, with limits in px. */
const WHEEL_RADIUS = { fraction: 0.06, min: 12, max: 40 };
/** Distant hills: how much of the elevation they echo, and how far back they sit. */
const HILLS_SCALE = 0.35;
const HILLS_Y = 0.5;
/** Upper and lower leg lengths, in wheel radii. */
const THIGH = 1.35;
const SHIN = 1.3;

const PX_PER_METRE = (PX_PER_SECOND * VISUAL_EXAGGERATION) / SCENE_SPEED_MPS;

/**
 * @typedef {object} SceneState
 * @property {{total:number, grades:Float64Array, elevation:Float64Array}} terrain
 * @property {import('../../../workout/model.js').Segment[]} segments
 * @property {number} intensity
 * @property {number} time  workout seconds
 * @property {number} grade  road gradient under the rider (percent)
 * @property {number} crankAngle  radians
 * @property {number} wheelAngle  radians
 */

/**
 * Short label for a segment on the road: "90%", "60→80%" or "Free".
 * @param {import('../../../workout/model.js').Segment} s
 */
export function roadLabel(s, intensity) {
  if (s.free) return 'Free';
  const pct = (f) => Math.round(f * intensity * 100);
  return s.p1 === s.p2 ? `${pct(s.p1)}%` : `${pct(s.p1)}→${pct(s.p2)}%`;
}

/**
 * Draw one frame.
 * @param {HTMLCanvasElement} canvas
 * @param {SceneState} state
 */
export function drawScene(canvas, state) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, w, h } = prepared;
  const { terrain, segments, intensity, time, grade, crankAngle, wheelAngle } = state;
  const colors = {
    bg: cssColor('--bg'), surface: cssColor('--surface2'), fg: cssColor('--fg'), muted: cssColor('--muted'),
    line: cssColor('--line'), kit: cssColor('--z4'), zones: [null, 1, 2, 3, 4, 5, 6].map((z) => z && cssColor(`--z${z}`)),
    body: cssColor('--body'),
  };

  const riderX = w * RIDER_X;
  const riderY = h * RIDER_Y;
  const timeAt = (x) => time + (x - riderX) / PX_PER_SECOND;
  const xAt = (t) => riderX + (t - time) * PX_PER_SECOND;
  const baseElevation = elevationAt(terrain, time);
  const roadY = (t) => riderY - (elevationAt(terrain, t) - baseElevation) * PX_PER_METRE;

  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, colors.surface);
  sky.addColorStop(1, colors.bg);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Distant hills: the same terrain, flattened and moving at half speed.
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 4) {
    const t = (time + (x - riderX) / PX_PER_SECOND) * 0.5;
    ctx.lineTo(x, h * HILLS_Y - (elevationAt(terrain, t) - elevationAt(terrain, time * 0.5)) * PX_PER_METRE * HILLS_SCALE);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = colors.muted;
  ctx.globalAlpha = 0.18;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Road, one filled band per segment in the window, coloured by zone.
  const firstT = timeAt(0);
  const lastT = timeAt(w);
  let t0 = 0;
  const boundaries = [];
  for (const s of segments) {
    const t1 = t0 + s.d;
    if (t1 >= firstT && t0 <= lastT) {
      fillRoad(ctx, Math.max(t0, firstT), Math.min(t1, lastT), xAt, roadY, h, s.free ? colors.muted : colors.zones[zoneOf(((s.p1 + s.p2) / 2) * intensity)]);
      boundaries.push({ t: t0, label: roadLabel(s, intensity) });
    }
    t0 = t1;
  }
  if (t0 <= lastT) fillRoad(ctx, Math.max(t0, firstT), lastT, xAt, roadY, h, colors.muted); // after the workout
  if (firstT < 0) fillRoad(ctx, firstT, Math.min(0, lastT), xAt, roadY, h, colors.muted); // before the start

  // Ridden part is dimmed; the surface line is drawn on top.
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, Math.max(0, Math.min(w, xAt(Math.min(time, terrain.total)))), h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 2) ctx.lineTo(x, roadY(timeAt(x)));
  ctx.stroke();

  // Step boundaries and labels for what is coming.
  ctx.font = `600 11px ${colors.body}`;
  ctx.textBaseline = 'bottom';
  for (const { t, label } of boundaries) {
    const x = xAt(t);
    if (x < 0 || x > w) continue;
    const y = roadY(t);
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
    if (x > riderX - 10 && x < w - 40) {
      ctx.fillStyle = colors.fg;
      ctx.globalAlpha = 0.85;
      ctx.fillText(label, x + 5, y - 6);
      ctx.globalAlpha = 1;
    }
  }

  drawCyclist(ctx, { x: riderX, y: riderY, angle: -Math.atan((grade / 100) * VISUAL_EXAGGERATION), crankAngle, wheelAngle,
    radius: Math.min(WHEEL_RADIUS.max, Math.max(WHEEL_RADIUS.min, h * WHEEL_RADIUS.fraction)), colors });
}

function fillRoad(ctx, tStart, tEnd, xAt, roadY, h, color) {
  const x0 = xAt(tStart);
  const x1 = xAt(tEnd);
  if (x1 - x0 < 0.5) return;
  ctx.beginPath();
  ctx.moveTo(x0, h);
  for (let x = x0; x < x1; x += 2) ctx.lineTo(x, roadY(tStart + (x - x0) / PX_PER_SECOND));
  ctx.lineTo(x1, roadY(tEnd));
  ctx.lineTo(x1, h);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Knee position for a hip, pedal and two bone lengths; the knee points forward. */
export function kneeFor(hip, pedal, thigh, shin) {
  const dx = pedal.x - hip.x;
  const dy = pedal.y - hip.y;
  const d = Math.max(1e-6, Math.min(Math.hypot(dx, dy), thigh + shin - 1e-3));
  const a = (thigh ** 2 - shin ** 2 + d ** 2) / (2 * d);
  const height = Math.sqrt(Math.max(0, thigh ** 2 - a ** 2));
  const mx = hip.x + (a * dx) / d;
  const my = hip.y + (a * dy) / d;
  const k1 = { x: mx + (height * -dy) / d, y: my + (height * dx) / d };
  const k2 = { x: mx - (height * -dy) / d, y: my - (height * dx) / d };
  return k1.x >= k2.x ? k1 : k2;
}

/**
 * A stylised cyclist: origin at the road under the bottom bracket, x forward, y down.
 * Units are wheel radii; line widths too. Rotated by `angle` to follow the road.
 */
function drawCyclist(ctx, { x, y, angle, crankAngle, wheelAngle, radius: R, colors }) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(R, R);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const line = (a, b, width, color, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  const rear = { x: -1.5, y: -1 };
  const front = { x: 1.5, y: -1 };
  const bb = { x: 0.05, y: -0.85 };
  const seat = { x: -0.85, y: -2.55 };
  const bars = { x: 1.15, y: -2.35 };
  const hip = { x: -0.7, y: -2.6 };
  const shoulder = { x: 0.45, y: -3.3 };
  const elbow = { x: 0.95, y: -2.85 };
  const head = { x: 0.85, y: -3.62 };

  for (const wheel of [rear, front]) {
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.arc(wheel.x, wheel.y, 0.96, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 0.03;
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < 6; i++) {
      const a = wheelAngle + (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(wheel.x, wheel.y);
      ctx.lineTo(wheel.x + 0.92 * Math.cos(a), wheel.y + 0.92 * Math.sin(a));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // frame: seat tube, down tube, top tube, seat stay, chain stay, fork; then saddle and stem
  for (const [a, b] of [[bb, seat], [bb, bars], [seat, bars], [seat, rear], [bb, rear], [bars, front]]) line(a, b, 0.1, colors.fg);
  line({ x: seat.x - 0.28, y: seat.y }, { x: seat.x + 0.18, y: seat.y }, 0.13, colors.fg);
  line(bars, { x: bars.x + 0.3, y: bars.y + 0.12 }, 0.1, colors.fg);

  // legs: far leg first, dimmed; cranks are 0.5 long
  const pedal = (a) => ({ x: bb.x + 0.5 * Math.cos(a), y: bb.y + 0.5 * Math.sin(a) });
  for (const [a, alpha] of [[crankAngle + Math.PI, 0.45], [crankAngle, 1]]) {
    const p = pedal(a);
    const knee = kneeFor(hip, p, THIGH, SHIN);
    line(bb, p, 0.06, colors.fg, alpha);
    line(hip, knee, 0.22, colors.kit, alpha);
    line(knee, p, 0.17, colors.kit, alpha);
  }

  // torso, arm, head
  line(hip, shoulder, 0.3, colors.kit);
  line(shoulder, elbow, 0.15, colors.kit);
  line(elbow, bars, 0.15, colors.kit);
  ctx.fillStyle = colors.fg;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
