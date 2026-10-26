/**
 * Keyboard shortcuts during a ride (laptops): +/−/arrows nudge, space pauses,
 * right arrow skips. An input source like the Click; it only calls actions.
 */
import { isDialogOpen } from './dom.js';

/**
 * @param {{isRiding:() => boolean, onNudge:(dir:1|-1) => void, onTogglePause:() => void, onSkip:() => void}} options
 *   isRiding: true while the ride screen is showing a ride
 * @returns {() => void} unbind
 */
export function bindRideKeys({ isRiding, onNudge, onTogglePause, onSkip }) {
  const keys = {
    '+': () => onNudge(1), '=': () => onNudge(1), ArrowUp: () => onNudge(1),
    '-': () => onNudge(-1), ArrowDown: () => onNudge(-1),
    ' ': () => onTogglePause(),
    ArrowRight: () => onSkip(),
  };
  const onKeyDown = (e) => {
    if (!isRiding() || e.target.tagName === 'INPUT' || isDialogOpen() || !keys[e.key]) return;
    keys[e.key]();
    e.preventDefault();
  };
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}
