/**
 * The ride screens the rider can choose from in Settings. Adding a screen
 * means adding a folder under src/ui/ride/ and one entry here.
 */
import { createDashboardScreen } from './dashboard/screen.js';

export const DEFAULT_RIDE_SCREEN = 'dashboard';

/** @type {ReadonlyArray<{id:string, name:string, description:string, create:(actions:import('./screen.js').RideActions) => import('./screen.js').RideScreen}>} */
export const RIDE_SCREENS = Object.freeze([
  { id: 'dashboard', name: 'Dashboard', description: 'Big numbers and the workout profile.', create: createDashboardScreen },
]);

/** The screen entry for an id, falling back to the default for unknown or missing ids. */
export function rideScreenById(id) {
  return RIDE_SCREENS.find((s) => s.id === id) ?? RIDE_SCREENS.find((s) => s.id === DEFAULT_RIDE_SCREEN);
}
