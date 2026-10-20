/**
 * Workout builder: edit name, description and the list of blocks, with a
 * live profile preview. Works on a copy; nothing changes until Save.
 */
import { $, toast } from './dom.js';
import { drawProfile } from './profile-chart.js';
import { clamp, formatDuration } from '../core/format.js';
import { BLOCK_LABELS, blockPeak, cloneWorkout, defaultBlock, flatten, newWorkout, workoutStats, zoneOf } from '../workout/model.js';

/** Per block type: which inputs to show. kind: 'dur' seconds, 'pwr' fraction of FTP, 'count' integer. */
const FIELDS = {
  steady: [['d', 'dur', 'Duration'], ['p', 'pwr', 'Power']],
  ramp: [['d', 'dur', 'Duration'], ['p1', 'pwr', 'From'], ['p2', 'pwr', 'To']],
  free: [['d', 'dur', 'Duration']],
  intervals: [['n', 'count', 'Repeats'], ['on', 'dur', 'On'], ['onP', 'pwr', 'On'], ['off', 'dur', 'Off'], ['offP', 'pwr', 'Off']],
};

/**
 * @param {{getFtp:() => number, onSave:(workout, original) => void, onCancel:() => void}} options
 */
export function createBuilderView({ getFtp, onSave, onCancel }) {
  const root = $('#view-builder');
  const list = $('#b-blocks');
  const canvas = $('#b-canvas');
  let draft = null;
  let original = null;
  let showWatts = false;

  const borderFor = (block) => {
    const peak = blockPeak(block);
    return peak == null ? 'var(--muted)' : `var(--z${zoneOf(peak)})`;
  };

  function fieldHtml(block, [key, kind, label]) {
    if (kind === 'count') {
      return `<label class="bf"><span>${label}</span><input type="number" inputmode="numeric" data-key="${key}" data-kind="count" value="${block[key]}" min="1" max="50"></label>`;
    }
    if (kind === 'pwr') {
      const shown = showWatts ? Math.round(block[key] * getFtp()) : Math.round(block[key] * 100);
      return `<label class="bf"><span>${label} ${showWatts ? 'W' : '%'}</span><input type="number" inputmode="numeric" data-key="${key}" data-kind="pwr" value="${shown}" min="0"></label>`;
    }
    const v = block[key];
    return `<div class="bf"><span>${label}</span><div class="dur">
      <input type="number" inputmode="numeric" data-key="${key}" data-kind="min" value="${Math.floor(v / 60)}" min="0" aria-label="${label} minutes"><i>min</i>
      <input type="number" inputmode="numeric" data-key="${key}" data-kind="sec" value="${v % 60}" min="0" max="59" aria-label="${label} seconds"><i>s</i></div></div>`;
  }

  function readField(el, block, input) {
    const { key, kind } = input.dataset;
    const value = Math.max(0, Number(input.value) || 0);
    if (kind === 'pwr') block[key] = showWatts ? value / getFtp() : value / 100;
    else if (kind === 'count') block[key] = Math.max(1, Math.round(value));
    else {
      const minutes = Number(el.querySelector(`input[data-key="${key}"][data-kind=min]`).value) || 0;
      const seconds = clamp(Number(el.querySelector(`input[data-key="${key}"][data-kind=sec]`).value) || 0, 0, 59);
      block[key] = Math.round(minutes * 60 + seconds);
    }
  }

  function blockElement(block, index) {
    const el = document.createElement('div');
    el.className = 'block';
    el.style.borderLeftColor = borderFor(block);
    const last = draft.blocks.length - 1;
    el.innerHTML = `
      <div class="bt"><strong>${BLOCK_LABELS[block.t]}</strong>
        <button class="iconbtn" data-move="up" aria-label="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="iconbtn" data-move="down" aria-label="Move down" ${index === last ? 'disabled' : ''}>↓</button>
        <button class="iconbtn" data-move="copy" aria-label="Duplicate">⧉</button>
        <button class="iconbtn" data-move="remove" aria-label="Remove">✕</button></div>
      <div class="bfields">${FIELDS[block.t].map((f) => fieldHtml(block, f)).join('')}
        ${block.t === 'free' ? '<span class="note">Trainer leaves ERG; the Click changes the gradient.</span>' : ''}</div>`;
    el.querySelectorAll('[data-move]').forEach((button) => button.addEventListener('click', () => {
      const blocks = draft.blocks;
      switch (button.dataset.move) {
        case 'up': [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]]; break;
        case 'down': [blocks[index + 1], blocks[index]] = [blocks[index], blocks[index + 1]]; break;
        case 'copy': blocks.splice(index + 1, 0, structuredClone(block)); break;
        case 'remove': blocks.splice(index, 1); break;
      }
      renderBlocks();
    }));
    el.querySelectorAll('input[data-key]').forEach((input) => input.addEventListener('input', () => {
      readField(el, block, input);
      el.style.borderLeftColor = borderFor(block);
      updatePreview();
    }));
    return el;
  }

  function renderBlocks() {
    list.replaceChildren(...draft.blocks.map(blockElement));
    if (!draft.blocks.length) list.innerHTML = '<div class="empty card">Add a step to start building.</div>';
    updatePreview();
  }

  function updatePreview() {
    const segments = flatten(draft.blocks);
    const stats = workoutStats(segments, getFtp());
    $('#b-dur').textContent = formatDuration(stats.duration);
    $('#b-tss').textContent = Math.round(stats.tss);
    $('#b-if').textContent = stats.intensity.toFixed(2);
    $('#b-kj').textContent = Math.round(stats.kj);
    drawProfile(canvas, segments, { labels: true });
  }

  function setUnits(watts) {
    showWatts = watts;
    $('#u-w').setAttribute('aria-pressed', String(watts));
    $('#u-pct').setAttribute('aria-pressed', String(!watts));
    renderBlocks();
  }

  root.querySelectorAll('[data-add]').forEach((button) => button.addEventListener('click', () => {
    draft.blocks.push(defaultBlock(button.dataset.add));
    renderBlocks();
    setTimeout(() => list.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30);
  }));
  $('#u-pct').addEventListener('click', () => setUnits(false));
  $('#u-w').addEventListener('click', () => setUnits(true));
  $('#b-cancel').addEventListener('click', () => onCancel());
  $('#b-save').addEventListener('click', () => {
    draft.name = $('#b-name').value.trim() || 'Untitled workout';
    draft.description = $('#b-desc').value.trim();
    if (!flatten(draft.blocks).length) {
      toast('Add at least one step with a duration');
      return;
    }
    onSave(draft, original);
  });

  return {
    root,
    /** @param {import('../workout/model.js').Workout | null} workout  null for a new workout */
    open(workout) {
      original = workout;
      draft = workout ? cloneWorkout(workout) : newWorkout();
      delete draft.example;
      $('#b-title').textContent = workout ? 'Edit workout' : 'New workout';
      $('#b-name').value = draft.name;
      $('#b-desc').value = draft.description || '';
      renderBlocks();
    },
    redraw: () => draft && updatePreview(),
  };
}
