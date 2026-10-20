/**
 * Home screen: workout cards, ride history and settings.
 * Holds no state of its own; it renders what it is given and reports user actions.
 */
import { $, showDialog } from './dom.js';
import { drawProfile } from './profile-chart.js';
import { escapeHtml, formatDuration } from '../core/format.js';
import { flatten, workoutStats } from '../workout/model.js';

/**
 * @param {{
 *   onRide:(w) => void, onEdit:(w) => void, onNew:() => void, onExportZwo:(w) => void, onDeleteWorkout:(w) => void,
 *   onImportFiles:(files:File[]) => void, onDownloadFit:(ride) => void, onDeleteRide:(ride) => void,
 *   onSettingsChange:(patch:object) => void,
 * }} actions
 */
export function createLibraryView(actions) {
  const root = $('#view-library');
  const workoutList = $('#workout-list');
  const rideList = $('#ride-list');
  const ftpInput = $('#set-ftp');
  const smoothSelect = $('#set-smooth');
  let lastState = null;

  $('#zwo-input').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) actions.onImportFiles(files);
  });
  $('#new-workout').addEventListener('click', () => actions.onNew());
  ftpInput.addEventListener('change', () => actions.onSettingsChange({ ftp: Math.round(Number(ftpInput.value)) }));
  smoothSelect.addEventListener('change', () => actions.onSettingsChange({ smooth: Number(smoothSelect.value) }));

  function workoutCard(workout, ftp) {
    const segments = flatten(workout.blocks);
    const stats = workoutStats(segments, ftp);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="row"><h3>${escapeHtml(workout.name)}</h3><span class="spacer"></span>${workout.example ? '<span class="tag">Example</span>' : ''}</div>
      <canvas></canvas>
      <div class="meta"><span><b>${formatDuration(stats.duration)}</b></span><span>TSS <b>${Math.round(stats.tss)}</b></span><span>IF <b>${stats.intensity.toFixed(2)}</b></span></div>
      ${workout.description ? `<p class="desc">${escapeHtml(workout.description)}</p>` : ''}
      <div class="row">
        <button class="btn primary" data-action="ride">Ride</button>
        <button class="btn" data-action="edit">Edit</button>
        <span class="spacer"></span>
        <button class="btn small ghost" data-action="zwo">.zwo</button>
        <button class="btn small ghost danger" data-action="delete">Delete</button>
      </div>`;
    const on = (name, fn) => card.querySelector(`[data-action=${name}]`).addEventListener('click', fn);
    on('ride', () => actions.onRide(workout));
    on('edit', () => actions.onEdit(workout));
    on('zwo', () => actions.onExportZwo(workout));
    on('delete', () => showDialog({
      title: 'Delete workout?',
      text: `“${workout.name}” will be removed from this device.`,
      actions: [{ label: 'Cancel', style: 'ghost' }, { label: 'Delete', style: 'danger', onClick: () => actions.onDeleteWorkout(workout) }],
    }));
    return { card, segments };
  }

  function rideRow(ride) {
    const s = ride.stats;
    const date = new Date(ride.start);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(ride.name)}</td>
      <td>${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
      <td>${formatDuration(s.duration)}</td><td>${s.avgPower} W</td><td>${s.normalizedPower} W</td><td>${s.kj}</td><td>${s.avgHr ?? '—'}</td>
      <td><button class="btn small" data-action="fit">.FIT</button> <button class="btn small ghost danger" data-action="delete">Delete</button></td>`;
    tr.querySelector('[data-action=fit]').addEventListener('click', () => actions.onDownloadFit(ride));
    tr.querySelector('[data-action=delete]').addEventListener('click', () => showDialog({
      title: 'Delete ride?',
      text: 'The recording will be removed from this device. Download the .FIT first if you want to keep it.',
      actions: [{ label: 'Cancel', style: 'ghost' }, { label: 'Delete', style: 'danger', onClick: () => actions.onDeleteRide(ride) }],
    }));
    return tr;
  }

  /** @param {{workouts:object[], rides:object[], settings:{ftp:number, smooth:number}}} state */
  function render(state) {
    lastState = state;
    const cards = state.workouts.map((w) => workoutCard(w, state.settings.ftp));
    workoutList.replaceChildren(...cards.map((c) => c.card));
    if (!cards.length) workoutList.innerHTML = '<div class="empty card">No workouts yet. Import a .zwo file or build one.</div>';
    requestAnimationFrame(() => cards.forEach(({ card, segments }) => drawProfile(card.querySelector('canvas'), segments)));

    rideList.replaceChildren(...state.rides.slice().reverse().map(rideRow));
    if (!state.rides.length) rideList.innerHTML = '<tr><td colspan="8" class="empty">No rides yet. Finished workouts appear here.</td></tr>';

    ftpInput.value = state.settings.ftp;
    smoothSelect.value = String(state.settings.smooth);
  }

  /** Light up the Click test keys in Settings. */
  function showButton(button, down) {
    $(`#key-${button}`).classList.toggle('lit', down);
    if (down) $('#click-hint').textContent = `Last press: ${button === 'plus' ? '+' : '−'} button`;
  }

  /** @param {'insecure'|'unsupported'} reason */
  function showBluetoothWarning(reason) {
    $('#bt-warn').hidden = false;
    $('#bt-warn-text').textContent = reason === 'insecure'
      ? 'Bluetooth only works when this page is opened from an https:// address. Open the hosted app instead of a local copy.'
      : 'This browser cannot connect to Bluetooth devices. Use Chrome on Android, or Chrome or Edge on Windows. On iPhone, the free Bluefy browser works.';
  }

  /** Offer to save or discard an unfinished ride found at start-up. */
  function showRecovery(draft, { onSave, onDiscard }) {
    const banner = $('#recover');
    banner.hidden = false;
    $('#recover-text').textContent = `An unfinished ride “${draft.name}” from ${new Date(draft.start).toLocaleString()} was found (${formatDuration(draft.samples.p.length)} recorded).`;
    $('#recover-save').onclick = () => { banner.hidden = true; onSave(); };
    $('#recover-discard').onclick = () => { banner.hidden = true; onDiscard(); };
  }

  return {
    root,
    render,
    redraw: () => lastState && render(lastState),
    showButton,
    showBluetoothWarning,
    showRecovery,
  };
}
