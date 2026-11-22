/**
 * Standard Bluetooth Battery Service (0x180F), offered by most heart-rate
 * straps and by Zwift controllers.
 */

export const BATTERY_SERVICE = 'battery_service';
const BATTERY_LEVEL = 'battery_level';
const MAX_PERCENT = 100;

/** Parse a Battery Level value (one byte, 0–100 %). Returns null for out-of-range values. */
export function parseBatteryLevel(view) {
  if (!view || view.byteLength < 1) return null;
  const percent = view.getUint8(0);
  return percent <= MAX_PERCENT ? percent : null;
}

/**
 * Read the battery level once and follow changes if the device sends them.
 * Never throws: devices without a battery service simply report nothing.
 * @param {BluetoothRemoteGATTServer} server
 * @param {(percent:number) => void} onLevel
 */
export async function watchBattery(server, onLevel) {
  try {
    const service = await server.getPrimaryService(BATTERY_SERVICE);
    const level = await service.getCharacteristic(BATTERY_LEVEL);
    const report = (view) => {
      const percent = parseBatteryLevel(view);
      if (percent != null) onLevel(percent);
    };
    report(await level.readValue());
    if (level.properties?.notify) {
      level.addEventListener('characteristicvaluechanged', (e) => report(e.target.value));
      await level.startNotifications();
    }
  } catch (error) {
    console.info('Battery level not available', error);
  }
}
