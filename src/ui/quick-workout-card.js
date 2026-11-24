/**
 * "Today's ride" card for the Workouts tab: say how long you have and how your legs
 * feel, get a suggested intensity with the reason, see the generated profile, then
 * ride it straight away or keep it. The intensity can be changed by hand.
 * Renders and reports actions only; the suggestion comes from src/workout/recommend.js
 * and the workout from src/workout/generator.js.
 */
import { drawProfile } from './profile-chart.js';
import { formatDuration } from '../core/format.js';
import { flatten, workoutStats } from '../workout/model.js';
import { DEFAULT_MINUTES, DURATION_CHOICES, LEVELS, generateWorkout, levelById } from '../workout/generator.js';
import { DEFAULT_FEELING, FEELINGS, recommend } from '../workout/recommend.js';

/**
 * @param {{onRide:(workout:object) => void, onSave:(workout:object) => void}} actions
 * @returns {{card:HTMLElement, update:(ftp:number, rides:object[]) => void}}
 *   card stays the same element across renders so the choices are kept; update redraws for an FTP
 *   and re-suggests from the saved rides
 */
export function createQuickWorkoutCard(actions) {
  const card = document.createElement('div');
  card.className = 'card quick';
  card.innerHTML = `
    <div class="row"><h3>Today’s ride</h3><span class="spacer"></span><span class="tag" data-out="tag">Suggested</span></div>
    <div class="qpick">
      <label class="field"><span class="label">Time</span><select data-pick="minutes"></select></label>
      <label class="field"><span class="label">Legs</span><select data-pick="feeling"></select></label>
      <label class="field"><span class="label">Intensity</span><select data-pick="level"></select></label>
    </div>
    <p class="qreason" data-out="reason"></p>
    <canvas></canvas>
    <div class="meta"><span><b data-out="duration"></b></span><span>TSS <b data-out="tss"></b></span><span>IF <b data-out="if"></b></span></div>
    <p class="qdesc" data-out="desc"></p>
    <div class="row">
      <button class="btn primary" data-action="ride">Ride now</button>
      <button class="btn" data-action="save">Save to workouts</button>
    </div>`;
  const minutesSelect = card.querySelector('[data-pick=minutes]');
  const feelingSelect = card.querySelector('[data-pick=feeling]');
  const levelSelect = card.querySelector('[data-pick=level]');
  minutesSelect.replaceChildren(...DURATION_CHOICES.map((m) => new Option(`${m} min`, String(m))));
  feelingSelect.replaceChildren(...FEELINGS.map((f) => new Option(f.name, f.id)));
  levelSelect.replaceChildren(...LEVELS.map((l) => new Option(l.name, l.id)));
  minutesSelect.value = String(DEFAULT_MINUTES);
  feelingSelect.value = DEFAULT_FEELING;

  const out = (name) => card.querySelector(`[data-out=${name}]`);
  let ftp = 0;
  let rides = [];
  let workout = null;
  /** The rider picked an intensity by hand; kept until time or legs change. */
  let manual = false;

  function suggest() {
    const suggestion = recommend({ rides, minutes: Number(minutesSelect.value), feeling: feelingSelect.value, now: Date.now() });
    if (!manual) levelSelect.value = suggestion.level;
    out('reason').textContent = `Suggested: ${levelById(suggestion.level).name}. ${suggestion.reason}`;
    out('tag').textContent = levelSelect.value === suggestion.level ? 'Suggested' : 'Your pick';
  }

  function update(newFtp = ftp, newRides = rides) {
    ftp = newFtp;
    rides = newRides;
    suggest();
    workout = generateWorkout({ minutes: Number(minutesSelect.value), level: levelSelect.value });
    const segments = flatten(workout.blocks);
    const stats = workoutStats(segments, ftp);
    out('duration').textContent = formatDuration(stats.duration);
    out('tss').textContent = String(Math.round(stats.tss));
    out('if').textContent = stats.intensity.toFixed(2);
    out('desc').textContent = workout.description;
    requestAnimationFrame(() => drawProfile(card.querySelector('canvas'), segments));
  }

  const resuggest = () => { manual = false; update(); };
  minutesSelect.addEventListener('change', resuggest);
  feelingSelect.addEventListener('change', resuggest);
  levelSelect.addEventListener('change', () => { manual = true; update(); });
  card.querySelector('[data-action=ride]').addEventListener('click', () => actions.onRide(workout));
  card.querySelector('[data-action=save]').addEventListener('click', () => {
    actions.onSave(workout);
    update(); // a fresh copy, so saving twice gives two separate workouts
  });

  return { card, update };
}
