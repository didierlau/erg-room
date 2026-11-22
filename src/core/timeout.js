/**
 * Give up on a promise that takes too long.
 * Nothing in here touches the DOM or browser APIs.
 */

/** Name of the error thrown when time runs out, so callers can tell it apart. */
export const TIMEOUT_ERROR = 'TimeoutError';

/**
 * Resolve or reject like `promise`, but reject with a TimeoutError if it has
 * not settled within `ms` milliseconds. The timer is always cleared.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} [message]
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, message = `Timed out after ${ms} ms`) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.name = TIMEOUT_ERROR;
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
