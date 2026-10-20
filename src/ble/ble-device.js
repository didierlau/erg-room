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
 */

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
   * @param {{label:string, requestOptions:RequestDeviceOptions}} options
   */
  constructor({ label, requestOptions }) {
    super();
    this.label = label;
    this.requestOptions = requestOptions;
    this.device = null;
    this.connected = false;
    this.state = 'off';
    this._userDisconnected = false;
    this._onLost = () => this._handleLost();
  }

  /** Ask the user to pick a device, then connect. Must be called from a user gesture. */
  async connect() {
    this._setState('busy', 'Pick device…');
    let picked;
    try {
      picked = await navigator.bluetooth.requestDevice(this.requestOptions);
    } catch (error) {
      this._setState('off', 'Connect');
      if (error.name === 'NotFoundError') return false; // user closed the chooser
      throw error;
    }
    this.device?.removeEventListener('gattserverdisconnected', this._onLost);
    this.device = picked;
    this.device.addEventListener('gattserverdisconnected', this._onLost);
    this._userDisconnected = false;
    try {
      await this._open();
      return true;
    } catch (error) {
      this._setState('off', 'Connect');
      throw error;
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

  async _open() {
    this._setState('busy', 'Connecting…');
    const server = await this.device.gatt.connect();
    await this.onConnected(server);
    this.connected = true;
    this._setState('on', this.device.name || 'Connected');
    this.dispatchEvent(new Event('connected'));
  }

  async _handleLost() {
    this.connected = false;
    this.onDisconnected();
    this.dispatchEvent(new Event('lost'));
    if (this._userDisconnected) {
      this._setState('off', 'Connect');
      return;
    }
    this._setState('busy', 'Reconnecting…');
    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS && !this._userDisconnected; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(RECONNECT_DELAY_STEP_MS * attempt, RECONNECT_DELAY_MAX_MS)));
      try {
        await this._open();
        return;
      } catch (error) {
        console.warn(`${this.label}: reconnect attempt ${attempt} failed`, error);
      }
    }
    this._setState('off', 'Connect');
  }

  _setState(state, text) {
    this.state = state;
    this.dispatchEvent(new CustomEvent('state', { detail: { state, text } }));
  }
}
