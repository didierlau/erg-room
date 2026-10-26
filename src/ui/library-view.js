/**
 * Home screen: workout cards, ride history and settings.
 * Holds no state of its own; it renders what it is given and reports user actions.
 */
import { $, showDialog } from './dom.js';
import { drawProfile } from './profile-chart.js';
import { escapeHtml, formatDuration } from '../core/format.js';
import { flatten, workoutStats } from '../workout/model.js';
import { PROTOCOLS, buildTestWorkout } from '../ftp/protocols.js';
import { methodName } from './ftp-result.js';

/**
 * @param {{
 *   onRide:(w) => void, onEdit:(w) => void, onNew:() => void, onExportZwo:(w) => void, onDeleteWorkout:(w) => void,
 *   onImportFiles:(files:File[]) => void, onDownloadFit:(ride) => void, onUploadGarmin:(ride) => void, onDeleteRide:(ride) => void,
 *   onOpenRide:(ride) => void, onStartTest:(protocolId:string) => void, onEstimateFromRides:() => void,
 *   onSettingsChange:(patch:object) => void,
 * }} actions
 * @param {{rideScreens:Array<{id:string, name:string, description:string}>}} options  choices for the ride-screen setting
 */
export function createLibraryView(actions, { rideScreens }) {
  const root = $('#view-library');
  const workoutList = $('#workout-list');
  const rideList = $('#ride-list');
  const ftpInput = $('#set-ftp');
  const smoothSelect = $('#set-smooth');
  const lthrInput = $('#set-lthr');
  const maxHrInput = $('#set-maxhr');
  const testList = $('#test-list');
  const screenSelect = $('#set-screen');
  const tabs = [...root.querySelectorAll('#tabs [data-tab]')];
  let lastState = null;

  /** Show one section at a time so each fits a phone screen. */
  function showTab(name) {
    for (const button of tabs) button.setAttribute('aria-selected', String(button.dataset.tab === name));
    for (const panel of root.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== name;
    window.scrollTo(0, 0);
    if (lastState) render(lastState); // canvases in a hidden panel have no size, so draw them now
  }
  tabs.forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab)));

  screenSelect.replaceChildren(...rideScreens.map((screen) => new Option(screen.name, screen.id)));
  screenSelect.addEventListener('change', () => actions.onSettingsChange({ rideScreen: screenSelect.value }));

  $('#zwo-input').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) actions.onImportFiles(files);
  });
  $('#new-workout').addEventListener('click', () => actions.onNew());
  ftpInput.addEventListener('change', () => actions.onSettingsChange({ ftp: Math.round(Number(ftpInput.value)) }));
  smoothSelect.addEventListener('change', () => actions.onSettingsChange({ smooth: Number(smoothSelect.value) }));
  const optionalNumber = (input) => (input.value.trim() === '' ? null : Math.round(Number(input.value)));
  lthrInput.addEventListener('change', () => actions.onSettingsChange({ lthr: optionalNumber(lthrInput) }));
  maxHrInput.addEventListener('change', () => actions.onSettingsChange({ maxHr: optionalNumber(maxHrInput) }));

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

  function testCard(protocol, ftp) {
    const segments = flatten(buildTestWorkout(protocol.id).blocks);
    const duration = protocol.id === 'ramp' ? 'Usually 20–30 min' : formatDuration(workoutStats(segments, ftp).duration);
    const card = document.createElement('div');
    card.className = 'card test';
    card.innerHTML = `
      <div class="row"><h3>${escapeHtml(protocol.name)}</h3><span class="spacer"></span>${protocol.needsHeartRate ? '<span class="tag">Needs heart rate</span>' : ''}</div>
      <canvas></canvas>
      <div class="meta"><span><b>${duration}</b></span><span>${escapeHtml(protocol.measures)}</span></div>
      <p class="desc">${escapeHtml(protocol.summary)}</p>
      <div class="row"><button class="btn primary" data-action="start">Start test</button></div>`;
    card.querySelector('[data-action=start]').addEventListener('click', () => actions.onStartTest(protocol.id));
    return { card, segments };
  }

  function historyCard() {
    const card = document.createElement('div');
    card.className = 'card test';
    card.innerHTML = `
      <div class="row"><h3>From your rides</h3></div>
      <div class="meta"><span><b>No riding needed</b></span><span>Critical Power from your power curve</span></div>
      <p class="desc">Fits your best 3- to 20-minute efforts from the last 90 days. Only as good as the hardest efforts in those rides.</p>
      <div class="row"><button class="btn" data-action="estimate">Estimate FTP</button></div>`;
    card.querySelector('[data-action=estimate]').addEventListener('click', () => actions.onEstimateFromRides());
    return card;
  }

  function rideCard(ride) {
    const s = ride.stats;
    const date = new Date(ride.start);
    const card = document.createElement('div');
    card.className = 'card ride';
    card.innerHTML = `
      <div class="row"><h3>${escapeHtml(ride.name)}</h3><span class="spacer"></span><span class="when">${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="meta"><span><b>${formatDuration(s.duration)}</b></span><span>Avg <b>${s.avgPower} W</b></span><span>NP <b>${s.normalizedPower} W</b></span><span><b>${s.kj}</b> kJ</span><span>HR <b>${s.avgHr ?? '—'}</b></span></div>
      <div class="row">
        <button class="btn small primary" data-action="garmin">Garmin</button>
        <button class="btn small" data-action="fit">.FIT</button>
        ${ride.test ? '<button class="btn small" data-action="open">Result</button>' : ''}
        <span class="spacer"></span>
        <button class="btn small ghost danger" data-action="delete">Delete</button>
      </div>`;
    card.querySelector('[data-action=garmin]').addEventListener('click', () => actions.onUploadGarmin(ride));
    card.querySelector('[data-action=fit]').addEventListener('click', () => actions.onDownloadFit(ride));
    card.querySelector('[data-action=open]')?.addEventListener('click', () => actions.onOpenRide(ride));
    card.querySelector('[data-action=delete]').addEventListener('click', () => showDialog({
      title: 'Delete ride?',
      text: 'The recording will be removed from this device. Download the .FIT first if you want to keep it.',
      actions: [{ label: 'Cancel', style: 'ghost' }, { label: 'Delete', style: 'danger', onClick: () => actions.onDeleteRide(ride) }],
    }));
    return card;
  }

  /** @param {{workouts:object[], rides:object[], settings:{ftp:number, smooth:number}}} state */
  function render(state) {
    lastState = state;
    const cards = state.workouts.map((w) => workoutCard(w, state.settings.ftp));
    workoutList.replaceChildren(...cards.map((c) => c.card));
    if (!cards.length) workoutList.innerHTML = '<div class="empty card">No workouts yet. Import a .zwo file or build one.</div>';
    requestAnimationFrame(() => cards.forEach(({ card, segments }) => drawProfile(card.querySelector('canvas'), segments)));

    const tests = PROTOCOLS.map((p) => testCard(p, state.settings.ftp));
    testList.replaceChildren(...tests.map((t) => t.card), historyCard());
    requestAnimationFrame(() => tests.forEach(({ card, segments }) => drawProfile(card.querySelector('canvas'), segments)));
    const last = state.settings.ftpHistory?.at(-1);
    $('#ftp-current').textContent = `Current FTP ${state.settings.ftp} W${last ? ` · set ${new Date(last.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} from ${methodName(last.method)}` : ''}`;

    rideList.replaceChildren(...state.rides.slice().reverse().map(rideCard));
    if (!state.rides.length) rideList.innerHTML = '<div class="empty card">No rides yet. Finished workouts appear here.</div>';

    ftpInput.value = state.settings.ftp;
    smoothSelect.value = String(state.settings.smooth);
    screenSelect.value = state.settings.rideScreen;
    $('#screen-hint').textContent = rideScreens.find((screen) => screen.id === state.settings.rideScreen)?.description ?? '';
    lthrInput.value = state.settings.lthr ?? '';
    maxHrInput.value = state.settings.maxHr ?? '';
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

  /** @param {(container:HTMLElement) => void} fill  renders a result into the history panel */
  function showHistoryResult(fill) {
    const panel = $('#history-result');
    fill(panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const hideHistoryResult = () => { $('#history-result').hidden = true; };

  return {
    root,
    render,
    showTab,
    showHistoryResult,
    hideHistoryResult,
    redraw: () => lastState && render(lastState),
    showButton,
    showBluetoothWarning,
    showRecovery,
  };
}
