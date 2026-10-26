/**
 * Getting data out of the app: .FIT and .zwo downloads, and the Garmin Connect hand-off.
 */
import { localIsoDate, safeFileName } from '../core/format.js';
import { buildActivityFit } from '../fit/activity-file.js';
import { toZwo } from '../workout/zwo.js';
import { downloadBlob } from '../ui/dom.js';

/** Garmin Connect's manual upload page (there is no public upload API for personal apps). */
export const GARMIN_IMPORT_URL = 'https://connect.garmin.com/modern/import-data';

/** File name for a ride's .FIT: "2026-10-26 Sweet Spot.fit". */
export function fitFileName(ride) {
  return `${localIsoDate(new Date(ride.start))} ${safeFileName(ride.name, 'Ride')}.fit`;
}

/** Offer a ride as a .FIT download. */
export function downloadFit(ride) {
  downloadBlob(new Blob([buildActivityFit(ride)], { type: 'application/vnd.ant.fit' }), fitFileName(ride));
}

/** Offer a workout as a .zwo download. */
export function downloadZwo(workout) {
  downloadBlob(new Blob([toZwo(workout)], { type: 'application/xml' }), `${safeFileName(workout.name, 'Workout')}.zwo`);
}

/**
 * Save the .FIT, then open Garmin Connect's import page to pick it.
 * @returns {string} what to tell the rider
 */
export function uploadToGarmin(ride) {
  downloadFit(ride);
  window.open(GARMIN_IMPORT_URL, '_blank', 'noopener');
  return 'The .FIT is saved. On the Garmin page, choose it from your downloads.';
}
