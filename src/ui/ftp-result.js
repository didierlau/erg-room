/**
 * Renders an FTP analysis result (see ftp/analysis.js) with an "apply" button.
 */
import { escapeHtml } from '../core/format.js';

const METHOD_NAMES = { ramp: 'Ramp test', twenty: '20-minute test', cp: 'Critical Power 3/12', submax: 'Heart-rate check', history: 'From your rides' };

/** What applying the result would change, as settings patch. */
export function settingsPatch(result) {
  const patch = { ftp: result.ftp };
  if (result.lthr) patch.lthr = result.lthr;
  if (result.maxHr) patch.maxHr = result.maxHr;
  return patch;
}

/**
 * @param {HTMLElement} container
 * @param {object} result
 * @param {{currentFtp:number, maxHr?:number|null, canApply:boolean, onApply:(patch:object, result:object) => void, onDismiss?:() => void}} options
 */
export function renderFtpResult(container, result, { currentFtp, maxHr, canApply, onApply, onDismiss }) {
  container.hidden = false;
  container.classList.toggle('error', !result.ok);
  if (!result.ok) {
    container.innerHTML = `<div class="headline"><b>No result</b></div><p>${escapeHtml(result.error)}</p>
      ${onDismiss ? '<div class="row"><button class="btn ghost" data-act="dismiss">Close</button></div>' : ''}`;
    container.querySelector('[data-act=dismiss]')?.addEventListener('click', onDismiss);
    return;
  }
  const diff = result.ftp - currentFtp;
  const change = diff === 0 ? 'Same as your current FTP' : `${diff > 0 ? '+' : ''}${diff} W vs your current ${currentFtp} W`;
  const patch = settingsPatch(result);
  // Only offer a higher max HR than the one already set.
  if (patch.maxHr && maxHr && patch.maxHr <= maxHr) delete patch.maxHr;
  const extras = [patch.lthr && `threshold HR ${patch.lthr} bpm`, patch.maxHr && `max HR ${patch.maxHr} bpm`].filter(Boolean);
  container.innerHTML = `
    <span class="label">${METHOD_NAMES[result.protocol] ?? 'FTP estimate'} · estimated FTP</span>
    <div class="headline"><b>${result.ftp}<small>W</small></b><span class="change ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${change}</span></div>
    <span>Based on ${escapeHtml(result.basis)}.</span>
    <dl>${result.details.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
    ${result.warnings.length ? `<ul>${result.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
    <div class="row">
      ${canApply ? `<button class="btn primary" data-act="apply">Set FTP to ${result.ftp} W${extras.length ? ` and ${extras.join(', ')}` : ''}</button>` : ''}
      ${onDismiss ? '<button class="btn ghost" data-act="dismiss">Close</button>' : ''}
    </div>`;
  const applyButton = container.querySelector('[data-act=apply]');
  applyButton?.addEventListener('click', () => {
    onApply(patch, result);
    applyButton.disabled = true;
    applyButton.textContent = `FTP set to ${result.ftp} W`;
  });
  container.querySelector('[data-act=dismiss]')?.addEventListener('click', onDismiss);
}

export const methodName = (protocol) => METHOD_NAMES[protocol] ?? protocol;
