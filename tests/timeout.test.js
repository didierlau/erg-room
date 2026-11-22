import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout, TIMEOUT_ERROR } from '../src/core/timeout.js';

const never = () => new Promise(() => {});

test('withTimeout passes a value through when the promise is quick', async () => {
  assert.equal(await withTimeout(Promise.resolve(42), 50), 42);
});

test('withTimeout passes the original error through', async () => {
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 50), /boom/);
});

test('withTimeout rejects with a TimeoutError when the promise hangs', async () => {
  await assert.rejects(withTimeout(never(), 10, 'too slow'), (error) => error.name === TIMEOUT_ERROR && error.message === 'too slow');
});
