/**
 * Canvas helpers shared by the charts and the avatar scene.
 */

/** Read a CSS custom property from :root, e.g. cssColor('--z4'). */
export function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Resize the backing store to the element's CSS size; returns a 2D context in CSS pixels,
 * or null when the canvas has no size yet (hidden).
 * @param {HTMLCanvasElement} canvas
 * @returns {{ctx:CanvasRenderingContext2D, w:number, h:number} | null}
 */
export function prepareCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
