/**
 * Bluetooth heart-rate strap (Heart Rate Service 0x180D).
 * Events: 'hr' detail {bpm}, 'battery' detail {percent}, plus the BleDevice events.
 */
import { BleDevice } from './ble-device.js';
import { BATTERY_SERVICE } from './battery.js';

const HEART_RATE_SERVICE = 0x180d;
const HEART_RATE_MEASUREMENT = 0x2a37;
const CONNECT_HINT = 'Put the strap on with damp pads so it wakes up, and make sure it is not connected to another app, a watch or your phone\'s Bluetooth settings. Then try again.';

/** Parse a Heart Rate Measurement value: flag bit 0 selects a 16-bit value. */
export function parseHeartRate(view) {
  const flags = view.getUint8(0);
  return flags & 0x01 ? view.getUint16(1, true) : view.getUint8(1);
}

export class HeartRateMonitor extends BleDevice {
  /** @param {{connectTimeoutMs?:number, bluetooth?:Bluetooth}} [testOptions] */
  constructor(testOptions = {}) {
    super({ label: 'Heart rate', requestOptions: { filters: [{ services: [HEART_RATE_SERVICE] }], optionalServices: [BATTERY_SERVICE] },
      connectHint: CONNECT_HINT, battery: true, ...testOptions });
  }

  async onConnected(server) {
    const service = await server.getPrimaryService(HEART_RATE_SERVICE);
    const measurement = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
    measurement.addEventListener('characteristicvaluechanged', (e) => {
      this.dispatchEvent(new CustomEvent('hr', { detail: { bpm: parseHeartRate(e.target.value) } }));
    });
    await measurement.startNotifications();
  }
}
