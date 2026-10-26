/**
 * Composition root: creates the devices, storage and views, and wires them together.
 * App state (settings, workouts) lives here; views only render and report actions.
 */
import { createStorage } from './core/storage.js';
import { createId } from './core/format.js';
import { createRepository } from './data/repository.js';
import { validateSettingsPatch, withFtpResult } from './data/settings.js';
import { importSummary, importWorkoutFiles } from './workout/import.js';
import { LiveData } from './ride/live-data.js';
import { bluetoothSupport } from './ble/ble-device.js';
import { FtmsTrainer } from './ble/ftms-trainer.js';
import { ZwiftClick } from './ble/zwift-click.js';
import { HeartRateMonitor } from './ble/heart-rate-monitor.js';
import { $, createWakeLock, showDialog, toast } from './ui/dom.js';
import { bindDeviceChip } from './ui/device-chips.js';
import { bindRideKeys } from './ui/ride-keys.js';
import { createLibraryView } from './ui/library-view.js';
import { createBuilderView } from './ui/builder-view.js';
import { RIDE_SCREENS, rideScreenById } from './ui/ride/screens.js';
import { createSummaryView } from './ui/summary-view.js';
import { createRideController } from './app/ride-controller.js';
import { downloadFit, downloadZwo, uploadToGarmin } from './app/exports.js';
import { buildTestWorkout, protocolById, testStartRequirement } from './ftp/protocols.js';
import { analyzeTest, estimateFromHistory } from './ftp/analysis.js';
import { renderFtpResult } from './ui/ftp-result.js';

/** A recovered draft is only worth offering when it has at least this many samples. */
const MIN_DRAFT_SAMPLES = 5;

const repository = createRepository(createStorage(globalThis.localStorage));
const state = {
  settings: repository.loadSettings(),
  workouts: repository.loadWorkouts(),
};

const trainer = new FtmsTrainer();
const click = new ZwiftClick();
const heartRate = new HeartRateMonitor();
const live = new LiveData();

/* ---------- navigation ---------- */
let current = 'library';
function show(view) {
  current = view;
  for (const name of ['library', 'builder', 'summary', 'ride']) views[name].root.hidden = name !== view;
  $('.top').hidden = view === 'ride';
  if (view === 'library') renderLibrary();
  window.scrollTo(0, 0);
}
const renderLibrary = () => library.render({ workouts: state.workouts, rides: repository.loadRides(), settings: state.settings });

/* ---------- workouts ---------- */
function saveWorkouts() {
  if (!repository.saveWorkouts(state.workouts)) toast('Could not save: browser storage is full or blocked');
}

async function importFiles(files) {
  const { workouts, errors } = await importWorkoutFiles(files);
  state.workouts.unshift(...workouts);
  saveWorkouts();
  renderLibrary();
  if (errors.length) showDialog({ title: 'Some files were not imported', text: `${errors.join('. ')}.`, actions: [{ label: 'OK', style: 'primary' }] });
  else if (workouts.length) toast(importSummary(workouts.length));
}

function saveFromBuilder(draft, original) {
  // Editing an example keeps the example and saves a personal copy.
  if (original && !original.example) state.workouts[state.workouts.indexOf(original)] = draft;
  else state.workouts.unshift(original?.example ? { ...draft, id: createId() } : draft);
  saveWorkouts();
  show('library');
  toast('Workout saved');
}

/* ---------- settings and FTP ---------- */
function changeSettings(patch) {
  const check = validateSettingsPatch(patch);
  if (!check.ok) toast(check.error);
  else {
    Object.assign(state.settings, patch);
    repository.saveSettings(state.settings);
    if ('ftp' in patch) toast(`FTP set to ${patch.ftp} W`);
    if ('rideScreen' in patch) useRideScreen(patch.rideScreen);
  }
  renderLibrary();
}

/** Apply an FTP result to settings and remember where it came from. */
function applyFtpResult(patch, result) {
  state.settings = withFtpResult(state.settings, patch, result.protocol, Date.now());
  repository.saveSettings(state.settings);
  toast(`FTP set to ${patch.ftp} W`);
}

const resultOptions = (canApply, extra = {}) => ({
  currentFtp: state.settings.ftp, maxHr: state.settings.maxHr, canApply, onApply: applyFtpResult, ...extra,
});

function estimateFromRides() {
  library.showHistoryResult((container) => renderFtpResult(container, estimateFromHistory(repository.loadRides()), resultOptions(true, {
    onDismiss: library.hideHistoryResult,
    onApply: (patch, result) => { applyFtpResult(patch, result); renderLibrary(); },
  })));
}

function startTest(protocolId) {
  const begin = () => startRide(buildTestWorkout(protocolId));
  const requirement = testStartRequirement(protocolById(protocolId), state.settings, heartRate.connected);
  if (requirement === 'ready') begin();
  else if (requirement === 'needs-threshold') {
    showDialog({
      title: 'Threshold or max heart rate needed',
      text: 'The heart-rate check estimates FTP from where your heart rate reaches threshold. Enter your threshold or max heart rate in Settings first.',
      actions: [{ label: 'OK', style: 'primary', onClick: () => $('#set-lthr').focus() }],
    });
  } else {
    showDialog({
      title: 'Connect a heart-rate strap',
      text: 'This test needs heart rate. Connect your strap now, or start anyway if your trainer passes heart rate on.',
      actions: [
        { label: 'Start anyway', style: 'ghost', onClick: begin },
        { label: 'Connect strap', style: 'primary', onClick: () => connectThen(heartRate, begin) },
      ],
    });
  }
}

/* ---------- riding ---------- */
/** Connect a device from a button press, then run `next` if the rider picked one. */
async function connectThen(device, next) {
  try {
    if (await device.connect()) next();
  } catch (error) {
    toast(`${device.label}: ${error.message}`);
  }
}

function startRide(workout) {
  const begin = (demo) => { rides.start(workout, { demo }); show('ride'); };
  if (trainer.connected) return begin(false);
  showDialog({
    title: 'No trainer connected',
    text: 'Connect your Zwift Hub to ride with ERG. Demo mode simulates power so you can try the screen; demo rides are not saved.',
    actions: [
      { label: 'Demo mode', style: 'ghost', onClick: () => begin(true) },
      { label: 'Connect trainer', style: 'primary', onClick: () => connectThen(trainer, () => begin(false)) },
    ],
  });
  return undefined;
}

/* ---------- views ---------- */
const library = createLibraryView({
  onRide: startRide,
  onEdit: (w) => { builder.open(w); show('builder'); },
  onNew: () => { builder.open(null); show('builder'); },
  onExportZwo: downloadZwo,
  onDeleteWorkout: (w) => { state.workouts = state.workouts.filter((x) => x !== w); saveWorkouts(); renderLibrary(); },
  onImportFiles: importFiles,
  onDownloadFit: downloadFit,
  onUploadGarmin: (ride) => toast(uploadToGarmin(ride), 4500),
  onOpenRide: (ride) => { summary.show(ride); show('summary'); },
  onStartTest: startTest,
  onEstimateFromRides: estimateFromRides,
  onDeleteRide: (ride) => { repository.deleteRide(ride.id); renderLibrary(); },
  onSettingsChange: changeSettings,
}, { rideScreens: RIDE_SCREENS });

const builder = createBuilderView({
  getFtp: () => state.settings.ftp,
  onCancel: () => show('library'),
  onSave: saveFromBuilder,
});

const summary = createSummaryView({
  onDownloadFit: downloadFit,
  onUploadGarmin: (ride) => toast(uploadToGarmin(ride), 4500),
  onBack: () => show('library'),
  renderTestResult: (container, ride) => renderFtpResult(container, analyzeTest(ride, state.settings), resultOptions(!ride.demo)),
});

/* ---------- ride screens ---------- */
function confirmFinish() {
  showDialog({
    title: 'Finish this ride?',
    text: rides.demo ? 'Demo rides are not saved.' : 'Your ride will be saved and ready to download as a .FIT file.',
    actions: [
      { label: 'Keep riding', style: 'ghost' },
      { label: 'Discard', style: 'danger', onClick: () => rides.finish(false) },
      { label: 'Finish & save', style: 'primary', onClick: () => rides.finish(true) },
    ],
  });
}
const rideActions = {
  onNudge: (dir) => rides.nudge(dir),
  onShift: (dir) => rides.shift(dir),
  onSetResistance: (mode) => rides.setResistance(mode),
  onTogglePause: () => rides.togglePause(),
  onSkip: () => rides.skip(),
  onFinish: confirmFinish,
};
// The Click and the keyboard do whatever +/− means on the current screen.
bindRideKeys({ isRiding: () => current === 'ride' && rides.active, ...rideActions, onNudge: (dir) => rides.press(dir) });

/** One instance per screen, created on first use; the chosen one is mounted. */
const screens = new Map();
let rideScreen = null;
function useRideScreen(id) {
  const entry = rideScreenById(id);
  if (!screens.has(entry.id)) {
    const screen = entry.create(rideActions);
    $('#modal').before(screen.root);
    screens.set(entry.id, screen);
  }
  rideScreen = screens.get(entry.id);
}
useRideScreen(state.settings.rideScreen);

const rides = createRideController({
  trainer, live, repository,
  getScreen: () => rideScreen,
  wakeLock: createWakeLock(),
  getSettings: () => state.settings,
  notify: toast,
  onEnded: (saved) => {
    if (saved) {
      if (!saved.demo) library.showTab('rides');
      summary.show(saved);
      show('summary');
    } else show('library');
  },
});

const views = { library, builder, summary, get ride() { return rideScreen; } };

/* ---------- devices ---------- */
const support = bluetoothSupport();
if (!support.ok) library.showBluetoothWarning(support.reason);
const onUnsupported = () => library.showBluetoothWarning(bluetoothSupport().reason ?? 'unsupported');
bindDeviceChip($('#chip-trainer'), trainer, { onUnsupported });
bindDeviceChip($('#chip-click'), click, { onUnsupported });
bindDeviceChip($('#chip-hr'), heartRate, { onUnsupported });

trainer.addEventListener('data', (e) => live.updateTrainer(e.detail, performance.now()));
trainer.addEventListener('lost', () => live.clearTrainer());
heartRate.addEventListener('hr', (e) => live.updateHeartRate(e.detail.bpm, performance.now()));
heartRate.addEventListener('lost', () => live.updateHeartRate(null, performance.now()));
click.addEventListener('button', (e) => library.showButton(e.detail.button, e.detail.down));
click.addEventListener('press', (e) => rides.active && rides.press(e.detail.button === 'plus' ? 1 : -1));

/* ---------- start-up ---------- */
const draft = repository.loadDraft();
if (draft?.samples?.p?.length >= MIN_DRAFT_SAMPLES) {
  library.showRecovery(draft, {
    onSave: () => { if (rides.saveRecord(draft)) { toast('Ride saved'); library.showTab('rides'); } renderLibrary(); },
    onDiscard: () => repository.clearDraft(),
  });
}

window.addEventListener('resize', () => views[current]?.redraw?.());

show('library');
