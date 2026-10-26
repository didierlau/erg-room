/**
 * Small DOM utilities shared by the views: lookup, toast, dialog, file download, wake lock.
 */

export const $ = (selector, root = document) => root.querySelector(selector);

let toastTimer;
/** Show a short message at the bottom of the screen. */
export function toast(message, durationMs = 2200) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, durationMs);
}

/**
 * Modal dialog with buttons. Each action closes the dialog, then runs its callback.
 * @param {{title:string, text?:string, actions:Array<{label:string, style?:'primary'|'ghost'|'danger', onClick?:() => void}>}} options
 */
export function showDialog({ title, text = '', actions }) {
  const modal = $('#modal');
  $('#m-title').textContent = title;
  $('#m-text').textContent = text;
  const row = $('#m-actions');
  row.replaceChildren(...actions.map(({ label, style, onClick }) => {
    const button = document.createElement('button');
    button.className = `btn ${style ?? ''}`;
    button.textContent = label;
    button.addEventListener('click', () => {
      modal.hidden = true;
      onClick?.();
    });
    return button;
  }));
  modal.hidden = false;
  row.lastElementChild?.focus();
}

/** True while a dialog is showing, so keyboard shortcuts stay quiet. */
export const isDialogOpen = () => !$('#modal').hidden;

/** Offer a generated file to the user. */
export function downloadBlob(blob, fileName) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 2000);
}

/** Keeps the screen on while active; re-acquires the lock when the page becomes visible again. */
export function createWakeLock() {
  let lock = null;
  let wanted = false;
  const acquire = async () => {
    try {
      lock = await navigator.wakeLock?.request('screen');
    } catch {
      lock = null; // not supported or refused; the ride still works
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') acquire();
  });
  return {
    enable() { wanted = true; acquire(); },
    disable() {
      wanted = false;
      lock?.release().catch(() => {});
      lock = null;
    },
  };
}
