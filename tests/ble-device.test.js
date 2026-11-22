// Connection behaviour of the Bluetooth base class, using a fake heart-rate strap.
// Regression: a strap that never answered left the chip on "Connecting…" forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeartRateMonitor } from '../src/ble/heart-rate-monitor.js';
import { TIMEOUT_ERROR } from '../src/core/timeout.js';

const TIMEOUT_MS = 20;
const never = () => new Promise(() => {});

/**
 * A fake strap whose gatt.connect() follows `plan`: 'hang' or 'ok' per attempt.
 * With `batteryPercent` it also offers the Battery Service.
 */
function fakeStrap(plan, { batteryPercent } = {}) {
  const measurement = Object.assign(new EventTarget(), { startNotifications: async () => {} });
  const batteryLevel = Object.assign(new EventTarget(), {
    properties: { notify: true },
    readValue: async () => new DataView(Uint8Array.from([batteryPercent]).buffer),
    startNotifications: async () => {},
  });
  const server = {
    getPrimaryService: async (uuid) => {
      if (uuid === 'battery_service') {
        if (batteryPercent == null) throw new Error('NotFoundError');
        return { getCharacteristic: async () => batteryLevel };
      }
      return { getCharacteristic: async () => measurement };
    },
  };
  const device = Object.assign(new EventTarget(), { name: 'HRM-Pro', connectCalls: 0, disconnectCalls: 0 });
  device.gatt = {
    connect: () => (plan[device.connectCalls++] === 'ok' ? Promise.resolve(server) : never()),
    disconnect: () => { device.disconnectCalls++; device.dispatchEvent(new Event('gattserverdisconnected')); },
  };
  const bluetooth = { requestDevice: async () => device };
  return { device, measurement, batteryLevel, bluetooth };
}

/** Collects the 'state' and 'lost' events a monitor emits. */
function watch(monitor) {
  const seen = { states: [], lost: 0 };
  monitor.addEventListener('state', (e) => seen.states.push(e.detail.state));
  monitor.addEventListener('lost', () => seen.lost++);
  return seen;
}

test('a strap that never answers gives up with a helpful TimeoutError', async () => {
  const { device, bluetooth } = fakeStrap(['hang', 'hang']);
  const monitor = new HeartRateMonitor({ bluetooth, connectTimeoutMs: TIMEOUT_MS });
  const seen = watch(monitor);
  await assert.rejects(monitor.connect(), (error) => error.name === TIMEOUT_ERROR && /did not answer/.test(error.message) && /another app/.test(error.message));
  assert.equal(device.connectCalls, 2, 'tries twice');
  assert.equal(device.disconnectCalls, 2, 'cancels each hanging attempt');
  assert.equal(monitor.state, 'off');
  assert.equal(monitor.connected, false);
  assert.equal(seen.lost, 0, 'an aborted attempt is not a dropped connection');
});

test('connects on the second attempt when the first one hangs', async () => {
  const { device, bluetooth } = fakeStrap(['hang', 'ok']);
  const monitor = new HeartRateMonitor({ bluetooth, connectTimeoutMs: TIMEOUT_MS });
  assert.equal(await monitor.connect(), true);
  assert.equal(device.connectCalls, 2);
  assert.equal(monitor.state, 'on');
  assert.equal(monitor.connected, true);
});

test('after connecting, measurements arrive as hr events', async () => {
  const { measurement, bluetooth } = fakeStrap(['ok']);
  const monitor = new HeartRateMonitor({ bluetooth, connectTimeoutMs: TIMEOUT_MS });
  await monitor.connect();
  const bpms = [];
  monitor.addEventListener('hr', (e) => bpms.push(e.detail.bpm));
  const event = new Event('characteristicvaluechanged');
  Object.defineProperty(event, 'target', { value: { value: new DataView(Uint8Array.from([0x00, 142]).buffer) } });
  measurement.dispatchEvent(event);
  assert.deepEqual(bpms, [142]);
});

test('a user disconnect after connecting reports lost and does not reconnect', async () => {
  const { device, bluetooth } = fakeStrap(['ok']);
  const monitor = new HeartRateMonitor({ bluetooth, connectTimeoutMs: TIMEOUT_MS });
  const seen = watch(monitor);
  await monitor.connect();
  monitor.disconnect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.lost, 1);
  assert.equal(monitor.state, 'off');
  assert.equal(device.connectCalls, 1);
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A characteristicvaluechanged event carrying `bytes`. */
function valueEvent(bytes) {
  const event = new Event('characteristicvaluechanged');
  Object.defineProperty(event, 'target', { value: { value: new DataView(Uint8Array.from(bytes).buffer) } });
  return event;
}

test('reports the strap battery after connecting, follows changes, clears it on a drop', async () => {
  const { device, batteryLevel, bluetooth } = fakeStrap(['ok'], { batteryPercent: 76 });
  const monitor = new HeartRateMonitor({ bluetooth, connectTimeoutMs: TIMEOUT_MS });
  const levels = [];
  monitor.addEventListener('battery', (e) => levels.push(e.detail.percent));
  await monitor.connect();
  await settle();
  batteryLevel.dispatchEvent(valueEvent([75]));
  assert.equal(monitor.battery, 75);
  monitor.disconnect();
  await settle();
  assert.deepEqual(levels, [76, 75, null]);
  assert.equal(device.connectCalls, 1);
});

test('a strap without a battery service still connects and reports no battery', async () => {
  const { bluetooth } = fakeStrap(['ok']);
  const monitor = new HeartRateMonitor({ bluetooth, connectTimeoutMs: TIMEOUT_MS });
  const levels = [];
  monitor.addEventListener('battery', (e) => levels.push(e.detail.percent));
  assert.equal(await monitor.connect(), true);
  await settle();
  assert.equal(monitor.state, 'on');
  assert.equal(monitor.battery, null);
  assert.deepEqual(levels, []);
});

test('the heart-rate strap asks Chrome for battery access', () => {
  const monitor = new HeartRateMonitor();
  assert.ok(monitor.requestOptions.optionalServices.includes('battery_service'));
});
