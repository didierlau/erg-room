/**
 * After-ride summary: power chart over the workout profile and key numbers.
 */
import { $ } from './dom.js';
import { drawProfile } from './profile-chart.js';
import { formatDuration } from '../core/format.js';

/** @param {{onDownloadFit:(ride) => void, onBack:() => void}} actions */
export function createSummaryView({ onDownloadFit, onBack }) {
  const root = $('#view-summary');
  let ride = null;

  $('#s-fit').addEventListener('click', () => ride && onDownloadFit(ride));
  $('#s-back').addEventListener('click', () => onBack());

  const draw = () => ride && drawProfile($('#s-canvas'), ride.segments, { trace: ride.trace || [], ftp: ride.ftp, labels: true });

  return {
    root,
    /** @param {{name:string, ftp:number, segments:object[], trace?:number[], stats:object}} savedRide */
    show(savedRide) {
      ride = savedRide;
      const s = ride.stats;
      $('#s-title').textContent = ride.name;
      const items = [
        ['Time', formatDuration(s.duration)], ['Avg power', `${s.avgPower} W`], ['Normalized', `${s.normalizedPower} W`],
        ['Max power', `${s.maxPower} W`], ['Work', `${s.kj} kJ`], ['TSS', Math.round(s.tss)], ['IF', s.intensity.toFixed(2)],
        ['Avg cadence', s.avgCadence ?? '—'], ['Avg HR', s.avgHr ?? '—'], ['Distance', `${(s.distance / 1000).toFixed(1)} km`],
      ];
      $('#s-stats').innerHTML = items.map(([label, value]) => `<div class="stat"><span class="label">${label}</span><b>${value}</b></div>`).join('');
      $('#s-note').textContent = 'Saved on this device under Rides. Distance is the trainer’s virtual speed, and the file is marked as an indoor ride.';
      requestAnimationFrame(draw);
    },
    redraw: draw,
  };
}
