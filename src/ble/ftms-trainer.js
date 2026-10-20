/**
 * Smart trainer over the Bluetooth Fitness Machine Service (FTMS, 0x1826).
 * The Zwift Hub supports this for third-party apps.
 *
 * Reads Indoor Bike Data (0x2AD2) and writes to the Fitness Machine Control
 * Point (0x2AD9): request control, start, set target power (ERG) and indoor
 * bike simulation (gradient).
 *
 * Events: 'data' detail {power?, cadence?, speed?, hr?}, 'control-lost'
 * (the trainer refused a command; the caller should resend its current target),
 * plus the BleDevice events.
 */
import { BleDevice } from './ble-device.js';
import { clamp } from '../core/format.js';

export const FTMS_SERVICE = 0x1826;
const INDOOR_BIKE_DATA = 0x2ad2;
const CONTROL_POINT = 0x2ad9;

export const OPCODE = {
  REQUEST_CONTROL: 0x00,
  SET_TARGET_POWER: 0x05,
  START_OR_RESUME: 0x07,
  SET_SIMULATION: 0x11,
  RESPONSE: 0x80,
};
const RESULT = { SUCCESS: 0x01, CONTROL_NOT_PERMITTED: 0x05 };

/** Rolling resistance and wind coefficients sent with simulation commands (typical road bike). */
const SIM_CRR = 0.004;
const SIM_CW = 0.51;

/**
 * Parse an Indoor Bike Data notification (FTMS spec 4.9).
 * @param {DataView} view
 * @returns {{speed?:number, cadence?:number, power?:number, hr?:number}} speed in m/s, cadence rpm, power W, hr bpm
 */
export function parseIndoorBikeData(view) {
  const flags = view.getUint16(0, true);
  const out = {};
  let o = 2;
  if (!(flags & 0x0001)) { out.speed = view.getUint16(o, true) / 100 / 3.6; o += 2; } // bit 0 = "more data": speed absent
  if (flags & 0x0002) o += 2;                                                       // average speed
  if (flags & 0x0004) { out.cadence = view.getUint16(o, true) / 2; o += 2; }
  if (flags & 0x0008) o += 2;                                                       // average cadence
  if (flags & 0x0010) o += 3;                                                       // total distance
  if (flags & 0x0020) o += 2;                                                       // resistance level
  if (flags & 0x0040) { out.power = view.getInt16(o, true); o += 2; }
  if (flags & 0x0080) o += 2;                                                       // average power
  if (flags & 0x0100) o += 5;                                                       // expended energy
  if (flags & 0x0200) { out.hr = view.getUint8(o) || undefined; o += 1; }
  return out;
}

/** Control point payload for an ERG target. */
export function encodeTargetPower(watts) {
  const w = clamp(Math.round(watts), 0, 2000);
  return [OPCODE.SET_TARGET_POWER, w & 0xff, (w >> 8) & 0xff];
}

/** Control point payload for simulation mode at `gradePercent` (no wind). */
export function encodeSimulation(gradePercent) {
  const g = Math.round(clamp(gradePercent, -10, 20) * 100) & 0xffff; // 0.01 % units, signed
  return [OPCODE.SET_SIMULATION, 0, 0, g & 0xff, g >> 8, Math.round(SIM_CRR * 10000), Math.round(SIM_CW * 100)];
}

export class FtmsTrainer extends BleDevice {
  constructor() {
    super({
      label: 'Trainer',
      requestOptions: { filters: [{ services: [FTMS_SERVICE] }, { namePrefix: 'Zwift Hub' }], optionalServices: [FTMS_SERVICE, 'device_information'] },
    });
    this._controlPoint = null;
    this._queue = Promise.resolve();
  }

  async onConnected(server) {
    const service = await server.getPrimaryService(FTMS_SERVICE);
    const data = await service.getCharacteristic(INDOOR_BIKE_DATA);
    data.addEventListener('characteristicvaluechanged', (e) => {
      this.dispatchEvent(new CustomEvent('data', { detail: parseIndoorBikeData(e.target.value) }));
    });
    await data.startNotifications();

    this._controlPoint = await service.getCharacteristic(CONTROL_POINT);
    this._controlPoint.addEventListener('characteristicvaluechanged', (e) => this._onResponse(e.target.value));
    await this._controlPoint.startNotifications();
    this._queue = Promise.resolve();
    await this._write([OPCODE.REQUEST_CONTROL]);
    await this._write([OPCODE.START_OR_RESUME]);
  }

  onDisconnected() {
    this._controlPoint = null;
  }

  /** @param {import('../ride/engine.js').TrainerCommand} command */
  send(command) {
    return this._write(command.mode === 'erg' ? encodeTargetPower(command.watts) : encodeSimulation(command.grade));
  }

  _onResponse(view) {
    if (view.getUint8(0) !== OPCODE.RESPONSE) return;
    const result = view.getUint8(2);
    if (result === RESULT.SUCCESS) return;
    console.warn(`FTMS: opcode 0x${view.getUint8(1).toString(16)} returned ${result}`);
    if (result === RESULT.CONTROL_NOT_PERMITTED) {
      this._write([OPCODE.REQUEST_CONTROL]);
      this.dispatchEvent(new Event('control-lost'));
    }
  }

  /** Writes are queued: GATT allows one operation at a time. Failures are logged, not thrown. */
  _write(bytes) {
    this._queue = this._queue
      .then(() => {
        const cp = this._controlPoint;
        if (!cp || !this.device?.gatt?.connected) return undefined;
        const payload = new Uint8Array(bytes);
        return cp.writeValueWithResponse ? cp.writeValueWithResponse(payload) : cp.writeValue(payload);
      })
      .catch((error) => console.warn('FTMS write failed', error));
    return this._queue;
  }
}
