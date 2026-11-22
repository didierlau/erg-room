/**
 * Base class for a Web Bluetooth peripheral: lets the user pick it, connects,
 * and reconnects automatically after an unexpected drop.
 *
 * Subclasses implement `onConnected(server)` to discover services and start
 * notifications, and may override `onDisconnected()`.
 *
 * Events (EventTarget):
 *   'state'      detail {state:'off'|'busy'|'on', text:string}
 *   'connected'  after setup succeeded (also after each reconnect)
 *   'lost'       the link dropped (before any reconnect attempt)
 *   'battery'    detail {percent:number|null} (devices created with `battery: true`;
 *                null when the link drops)
 */

import { withTimeout, TIMEOUT_ERROR } from '../core/timeout.js';
import { watchBattery } from './battery.js';

/** How long one connection attempt may take before we give up on it. */
export const CONNECT_TIMEOUT_MS = 15000;
/** Attempts after picking a device: Android often hangs on the first try and connects on the second. */
const CONNECT_ATTEMPTS = 2;
const MAX_RECONNECT_ATTEMPTS = 8;
const RECONNECT_DELAY_STEP_MS = 1000;
const RECONNECT_DELAY_MAX_MS = 5000;

/** Whether this page can use Web Bluetooth, with a reason when it cannot. */
export function bluetoothSupport(nav = globalThis.navigator, secure = globalThis.isSecureContext) {
  if (!secure) return { ok: false, reason: 'insecure' };
  if (!nav?.bluetooth) return { ok: false, reason: 'unsupported' };
  return { ok: true };
}

export class BleDevice extends EventTarget {
  /**
   * @param {{label:string, requestOptions:RequestDeviceOptions, connectHint?:string,
   *   battery?:boolean, connectTimeoutMs?:number, bluetooth?:Bluetooth}} options
   *   connectHint: what to tell the user when the device does not answer.
   *   battery: report the battery level ('battery_service' must be in requestOptions.optionalServices).
   *   connectTimeoutMs, bluetooth: for tests.
   */
  constructor({ label, requestOptions, connectHint = '', battery = false, connectTimeoutMs = CONNECT_TIMEOUT_MS, bluetooth }) {
    super();
    this.label = label;
    this.requestOptions = requestOptions;
    this.connectHint = connectHint;
    this.reportsBattery = battery;
    this.battery = null;
    this.connectTimeoutMs = connectTimeoutMs;
    this._bluetooth = bluetooth;
    this.device = null;
    this.connected = false;
    this.state = 'off';
    this._userDisconnected = false;
    this._reconnecting = false;
    this._onLost = () => this._handleLost();
  }

  /**
   * Ask the user to pick a device, then connect. Must be called from a user gesture.
   * Rejects with a TimeoutError (message includes `connectHint`) if the device never answers.
   */
  async connect() {
    this._setState('busy', 'Pick device…');
    let picked;
    try {
      picked = await (this._bluetooth ?? navigator.bluetooth).requestDevice(this.requestOptions);
    } catch (error) {
      this._setState('off', 'Connect');
      if (error.name === 'NotFoundError') return false; // user closed the chooser
      throw error;
    }
    this.device?.removeEventListener('gattserverdisconnected', this._onLost);
    this.device = picked;
    this.device.addEventListener('gattserverdisconnected', this._onLost);
    this._userDisconnected = false;
    for (let attempt = 1; ; attempt++) {
      try {
        await this._open();
        return true;
      } catch (error) {
        const timedOut = error.name === TIMEOUT_ERROR;
        if (timedOut && attempt < CONNECT_ATTEMPTS && !this._userDisconnected) continue;
        this._setState('off', 'Connect');
        if (timedOut) error.message = `${this.label} did not answer.${this.connectHint ? ` ${this.connectHint}` : ''}`;
        throw error;
      }
    }
  }

  disconnect() {
    this._userDisconnected = true;
    this.device?.gatt?.disconnect();
  }

  /** @abstract @param {BluetoothRemoteGATTServer} server */
  async onConnected(server) { // eslint-disable-line no-unused-vars
    throw new Error('onConnected must be implemented');
  }

  onDisconnected() {}

  /** Connect and set up, giving up (and dropping the half-open link) after connectTimeoutMs. */
  async _open() {
    this._setState('busy', 'Connecting…');
    const device = this.device;
    let server;
    const setUp = async () => {
      server = await device.gatt.connect();
      await this.onConnected(server);
    };
    try {
      await withTimeout(setUp(), this.connectTimeoutMs, `${this.label}: connection timed out`);
    } catch (error) {
      // Cancel a hanging or half-finished attempt so the next one starts clean.
      device.gatt?.disconnect();
      throw error;
    }
    this.connected = true;
    this._setState('on', this.device.name || 'Connected');
    this.dispatchEvent(new Event('connected'));
    // Best effort and not part of the connection: a missing battery service is fine.
    if (this.reportsBattery) watchBattery(server, (percent) => { if (this.connected) this._setBattery(percent); });
  }

  async _handleLost() {
    // Drops during a connect or reconnect attempt are handled by that attempt.
    if (!this.connected || this._reconnecting) return;
    this.connected = false;
    this.onDisconnected();
    if (this.battery != null) this._setBattery(null);
    this.dispatchEvent(new Event('lost'));
    if (this._userDisconnected) {
      this._setState('off', 'Connect');
      return;
    }
    this._setState('busy', 'Reconnecting…');
    this._reconnecting = true;
    try {
      for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS && !this._userDisconnected; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(RECONNECT_DELAY_STEP_MS * attempt, RECONNECT_DELAY_MAX_MS)));
        if (this._userDisconnected) break;
        try {
          await this._open();
          return;
        } catch (error) {
          console.warn(`${this.label}: reconnect attempt ${attempt} failed`, error);
        }
      }
      this._setState('off', 'Connect');
    } finally {
      this._reconnecting = false;
    }
  }

  _setBattery(percent) {
    this.battery = percent;
    this.dispatchEvent(new CustomEvent('battery', { detail: { percent } }));
  }

  _setState(state, text) {
    this.state = state;
    this.dispatchEvent(new CustomEvent('state', { detail: { state, text } }));
  }
}
