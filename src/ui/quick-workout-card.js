/**
 * "Quick workout" card for the Workouts tab: pick a duration and an intensity,
 * see the generated profile, ride it straight away or keep it.
 * Renders and reports actions only; the workout itself comes from src/workout/generator.js.
 */
import { drawProfile } from './profile-chart.js';
import { formatDuration } from '../core/format.js';
import { flatten, workoutStats } from '../workout/model.js';
import { DEFAULT_LEVEL, DEFAULT_MINUTES, DURATION_CHOICES, LEVELS, generateWorkout } from '../workout/generator.js';

/**
 * @param {{onRide:(workout:object) => void, onSave:(workout:object) => void}} actions
 * @returns {{card:HTMLElement, update:(ftp:number) => void}}
 *   card stays the same element across renders so the choices are kept; update redraws for an FTP
 */
export function createQuickWorkoutCard(actions) {
  const card = document.createElement('div');
  card.className = 'card quick';
  card.innerHTML = `
    <div class="row"><h3>Quick workout</h3><span class="spacer"></span><span class="tag">Generated</span></div>
    <div class="qpick">
      <label class="field"><span class="label">Duration</span><select data-pick="minutes"></select></label>
      <label class="field"><span class="label">Intensity</span><select data-pick="level"></select></label>
    </div>
    <canvas></canvas>
    <div class="meta"><span><b data-out="duration"></b></span><span>TSS <b data-out="tss"></b></span><span>IF <b data-out="if"></b></span></div>
    <p class="qdesc" data-out="desc"></p>
    <div class="row">
      <button class="btn primary" data-action="ride">Ride now</button>
      <button class="btn" data-action="save">Save to workouts</button>
    </div>`;
  const minutesSelect = card.querySelector('[data-pick=minutes]');
  const levelSelect = card.querySelector('[data-pick=level]');
  minutesSelect.replaceChildren(...DURATION_CHOICES.map((m) => new Option(`${m} min`, String(m))));
  levelSelect.replaceChildren(...LEVELS.map((l) => new Option(l.name, l.id)));
  minutesSelect.value = String(DEFAULT_MINUTES);
  levelSelect.value = DEFAULT_LEVEL;

  const out = (name) => card.querySelector(`[data-out=${name}]`);
  let ftp = 0;
  let workout = null;

  function update(newFtp = ftp) {
    ftp = newFtp;
    workout = generateWorkout({ minutes: Number(minutesSelect.value), level: levelSelect.value });
    const segments = flatten(workout.blocks);
    const stats = workoutStats(segments, ftp);
    out('duration').textContent = formatDuration(stats.duration);
    out('tss').textContent = String(Math.round(stats.tss));
    out('if').textContent = stats.intensity.toFixed(2);
    out('desc').textContent = workout.description;
    requestAnimationFrame(() => drawProfile(card.querySelector('canvas'), segments));
  }

  minutesSelect.addEventListener('change', () => update());
  levelSelect.addEventListener('change', () => update());
  card.querySelector('[data-action=ride]').addEventListener('click', () => actions.onRide(workout));
  card.querySelector('[data-action=save]').addEventListener('click', () => {
    actions.onSave(workout);
    update(); // a fresh copy, so saving twice gives two separate workouts
  });

  return { card, update };
}
