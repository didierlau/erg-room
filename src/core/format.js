/**
 * Small, dependency-free helpers shared across the app.
 * Nothing in here touches the DOM or browser APIs.
 */

/** Limit `value` to the range [min, max]. */
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Format seconds as m:ss, or h:mm:ss from one hour up. Negative values show as 0:00. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** A short random id, unique enough for local records. */
export function createId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for safe insertion into HTML or XML. */
export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Strip characters that are awkward in file names. */
export function safeFileName(name, fallback = 'Untitled') {
  return String(name ?? '').replace(/[^\w\- ]+/g, '').trim() || fallback;
}

/** Local calendar date as YYYY-MM-DD. */
export function localIsoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
