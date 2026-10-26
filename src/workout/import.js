/**
 * Turns a batch of picked files into workouts, keeping going when one fails.
 */
import { parseZwo } from './zwo.js';

/**
 * @param {Iterable<{name:string, text:() => Promise<string>}>} files  File objects from an <input type=file>
 * @param {(text:string, fileName:string) => object} [parse]  defaults to the .zwo parser
 * @returns {Promise<{workouts:object[], errors:string[]}>}  errors are messages ready to show, one per failed file
 */
export async function importWorkoutFiles(files, parse = parseZwo) {
  const workouts = [];
  const errors = [];
  for (const file of files) {
    try {
      workouts.push(parse(await file.text(), file.name));
    } catch (error) {
      errors.push(`${file.name} ${error.message}`);
    }
  }
  return { workouts, errors };
}

/** Short confirmation for a successful import, or null when nothing was imported. */
export function importSummary(count) {
  if (!count) return null;
  return count === 1 ? 'Workout imported' : `${count} workouts imported`;
}
