/**
 * The ride screens the rider can choose from in Settings. Adding a screen
 * means adding a folder under src/ui/ride/ and one entry here.
 */
import { createDashboardScreen } from './dashboard/screen.js';
import { createAvatarScreen } from './avatar/screen.js';

export const DEFAULT_RIDE_SCREEN = 'dashboard';

/** @type {ReadonlyArray<{id:string, name:string, description:string, create:(actions:import('./screen.js').RideActions) => import('./screen.js').RideScreen}>} */
export const RIDE_SCREENS = Object.freeze([
  { id: 'dashboard', name: 'Dashboard', description: 'Big numbers and the workout profile. The Click changes intensity.', create: createDashboardScreen },
  { id: 'avatar', name: 'Avatar', description: 'A rider on a road that climbs with the target. The Click shifts virtual gears; a toggle sets whether ERG holds the target or the gears set the resistance.', create: createAvatarScreen },
]);

/** The screen entry for an id, falling back to the default for unknown or missing ids. */
export function rideScreenById(id) {
  return RIDE_SCREENS.find((s) => s.id === id) ?? RIDE_SCREENS.find((s) => s.id === DEFAULT_RIDE_SCREEN);
}
