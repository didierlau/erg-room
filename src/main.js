/**
 * Composition root: creates the devices, storage and views, and wires them together.
 * App state (settings, workouts) lives here; views only render and report actions.
 */
import { createStorage } from './core/storage.js';
import { createId, localIsoDate, safeFileName } from './core/format.js';
import { createRepository } from './data/repository.js';
import { parseZwo, toZwo } from './workout/zwo.js';
import { buildActivityFit } from './fit/activity-file.js';
import { LiveData } from './ride/live-data.js';
import { bluetoothSupport } from './ble/ble-device.js';
import { FtmsTrainer } from './ble/ftms-trainer.js';
import { ZwiftClick } from './ble/zwift-click.js';
import { HeartRateMonitor } from './ble/heart-rate-monitor.js';
import { $, downloadBlob, showDialog, toast } from './ui/dom.js';
import { bindDeviceChip } from './ui/device-chips.js';
import { createLibraryView } from './ui/library-view.js';
import { createBuilderView } from './ui/builder-view.js';
import { createRideView } from './ui/ride-view.js';
import { createSummaryView } from './ui/summary-view.js';
import { createRideController } from './app/ride-controller.js';

const FTP_RANGE = [50, 600];

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
  for (const v of [library, builder, summary, rideView]) v.root.hidden = v !== views[view];
  $('.top').hidden = view === 'ride';
  if (view === 'library') renderLibrary();
  window.scrollTo(0, 0);
}
const renderLibrary = () => library.render({ workouts: state.workouts, rides: repository.loadRides(), settings: state.settings });

/* ---------- actions ---------- */
function saveWorkouts() {
  if (!repository.saveWorkouts(state.workouts)) toast('Could not save: browser storage is full or blocked');
}

function downloadFit(ride) {
  const name = `${localIsoDate(new Date(ride.start))} ${safeFileName(ride.name, 'Ride')}.fit`;
  downloadBlob(new Blob([buildActivityFit(ride)], { type: 'application/vnd.ant.fit' }), name);
}

async function importFiles(files) {
  const errors = [];
  let imported = 0;
  for (const file of files) {
    try {
      state.workouts.unshift(parseZwo(await file.text(), file.name));
      imported++;
    } catch (error) {
      errors.push(`${file.name} ${error.message}`);
    }
  }
  saveWorkouts();
  renderLibrary();
  if (errors.length) showDialog({ title: 'Some files were not imported', text: `${errors.join('. ')}.`, actions: [{ label: 'OK', style: 'primary' }] });
  else if (imported) toast(imported === 1 ? 'Workout imported' : `${imported} workouts imported`);
}

function startRide(workout) {
  if (trainer.connected) {
    rides.start(workout, { demo: false });
    show('ride');
    return;
  }
  showDialog({
    title: 'No trainer connected',
    text: 'Connect your Zwift Hub to ride with ERG. Demo mode simulates power so you can try the screen; demo rides are not saved.',
    actions: [
      { label: 'Demo mode', style: 'ghost', onClick: () => { rides.start(workout, { demo: true }); show('ride'); } },
      {
        label: 'Connect trainer', style: 'primary',
        onClick: async () => {
          try {
            if (await trainer.connect()) { rides.start(workout, { demo: false }); show('ride'); }
          } catch (error) {
            toast(`Trainer: ${error.message}`);
          }
        },
      },
    ],
  });
}

/* ---------- views ---------- */
const library = createLibraryView({
  onRide: startRide,
  onEdit: (w) => { builder.open(w); show('builder'); },
  onNew: () => { builder.open(null); show('builder'); },
  onExportZwo: (w) => downloadBlob(new Blob([toZwo(w)], { type: 'application/xml' }), `${safeFileName(w.name, 'Workout')}.zwo`),
  onDeleteWorkout: (w) => { state.workouts = state.workouts.filter((x) => x !== w); saveWorkouts(); renderLibrary(); },
  onImportFiles: importFiles,
  onDownloadFit: downloadFit,
  onDeleteRide: (ride) => { repository.deleteRide(ride.id); renderLibrary(); },
  onSettingsChange: (patch) => {
    if ('ftp' in patch && !(patch.ftp >= FTP_RANGE[0] && patch.ftp <= FTP_RANGE[1])) {
      toast(`Enter an FTP between ${FTP_RANGE[0]} and ${FTP_RANGE[1]} W`);
      renderLibrary();
      return;
    }
    Object.assign(state.settings, patch);
    repository.saveSettings(state.settings);
    if ('ftp' in patch) toast(`FTP set to ${patch.ftp} W`);
    renderLibrary();
  },
});

const builder = createBuilderView({
  getFtp: () => state.settings.ftp,
  onCancel: () => show('library'),
  onSave: (draft, original) => {
    // Editing an example keeps the example and saves a personal copy.
    if (original && !original.example) state.workouts[state.workouts.indexOf(original)] = draft;
    else state.workouts.unshift(original?.example ? { ...draft, id: createId() } : draft);
    saveWorkouts();
    show('library');
    toast('Workout saved');
  },
});

const summary = createSummaryView({ onDownloadFit: downloadFit, onBack: () => show('library') });

const rideView = createRideView({
  onNudge: (dir) => rides.nudge(dir),
  onTogglePause: () => rides.togglePause(),
  onSkip: () => rides.skip(),
  onFinish: (save) => rides.finish(save),
});

const rides = createRideController({
  trainer, live, repository, rideView,
  getSettings: () => state.settings,
  onEnded: (saved) => {
    if (saved) { summary.show(saved); show('summary'); } else show('library');
  },
});

const views = { library, builder, summary, ride: rideView };

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
click.addEventListener('press', (e) => rides.active && rides.nudge(e.detail.button === 'plus' ? 1 : -1));

/* ---------- start-up ---------- */
const draft = repository.loadDraft();
if (draft?.samples?.p?.length >= 5) {
  library.showRecovery(draft, {
    onSave: () => { if (rides.saveRecord(draft)) toast('Ride saved'); renderLibrary(); },
    onDiscard: () => repository.clearDraft(),
  });
}

window.addEventListener('resize', () => {
  if (current === 'ride') rideView.invalidateChart();
  else if (current === 'library') library.redraw();
  else if (current === 'builder') builder.redraw();
  else if (current === 'summary') summary.redraw();
});

show('library');
