/**
 * Zwift Click handlebar controller.
 *
 * The protocol is not officially published. This follows what open-source
 * projects (BikeControl / SwiftControl, zwiftplay) use:
 *  - custom service 00000001-19ca-4651-86e5-fa29dcdd09d1 (newer devices: 0xFC82)
 *  - write "RideOn" to the control point to start button notifications
 *  - notifications start with a message type byte followed by protobuf fields
 *      0x37 Click keypad: field 1 = plus, field 2 = minus; value 0 = pressed, 1 = released
 *      0x23 Ride keypad (Click v2 / Zwift Ride): field 1 = button bitmap, a cleared bit = pressed
 *
 * Events: 'press' detail {button:'plus'|'minus'} on each new press,
 *         'button' detail {button, down} on every change. Plus the BleDevice events.
 */
import { BleDevice } from './ble-device.js';

const SERVICE = '00000001-19ca-4651-86e5-fa29dcdd09d1';
const SERVICE_V2 = '0000fc82-0000-1000-8000-00805f9b34fb';
const ASYNC = '00000002-19ca-4651-86e5-fa29dcdd09d1';
const CONTROL = '00000003-19ca-4651-86e5-fa29dcdd09d1';
const RESPONSE = '00000004-19ca-4651-86e5-fa29dcdd09d1';
const ZWIFT_COMPANY_ID = 0x094a;
const HANDSHAKE = 'RideOn';

const MSG_CLICK_KEYPAD = 0x37;
const MSG_RIDE_KEYPAD = 0x23;
const PRESSED = 0;
// Ride keypad bitmap: shift up/down on the left and right controllers
const RIDE_SHIFT_UP = 0x0200 | 0x2000;
const RIDE_SHIFT_DOWN = 0x0400 | 0x4000;

/**
 * Read top-level protobuf fields. Varints are returned; other wire types are skipped.
 * @param {Uint8Array} bytes
 * @returns {Record<number, number>} first value per field number
 */
export function readProtobufFields(bytes) {
  const fields = {};
  let i = 0;
  const varint = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      if (i >= bytes.length) throw new RangeError('truncated varint');
      byte = bytes[i++];
      result += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return result;
  };
  try {
    while (i < bytes.length) {
      const key = varint();
      const field = Math.floor(key / 8);
      const wireType = key & 7;
      if (wireType === 0) { const v = varint(); if (!(field in fields)) fields[field] = v; }
      else if (wireType === 1) i += 8;
      else if (wireType === 2) { const length = varint(); i += length; } // read the length before moving i
      else if (wireType === 5) i += 4;
      else break;
    }
  } catch {
    /* keep the fields read before the message was cut short */
  }
  return fields;
}

/**
 * Button state from one notification, or null if it is not a button message.
 * @param {Uint8Array} bytes
 * @returns {{plus:boolean, minus:boolean} | null}
 */
export function parseButtons(bytes) {
  if (!bytes.length) return null;
  const fields = readProtobufFields(bytes.subarray(1));
  if (bytes[0] === MSG_CLICK_KEYPAD) return { plus: fields[1] === PRESSED, minus: fields[2] === PRESSED };
  if (bytes[0] === MSG_RIDE_KEYPAD && fields[1] != null) {
    const pressed = ~fields[1];
    return { plus: Boolean(pressed & RIDE_SHIFT_UP), minus: Boolean(pressed & RIDE_SHIFT_DOWN) };
  }
  return null; // keep-alive, battery and other messages
}

/** Turns successive button states into press events (rising edges only). */
export class ButtonTracker {
  constructor() {
    this.down = { plus: false, minus: false };
  }

  /** @returns {{changes:Array<{button:string, down:boolean}>, presses:string[]}} */
  update(state) {
    const changes = [];
    const presses = [];
    for (const button of ['plus', 'minus']) {
      if (state[button] === this.down[button]) continue;
      if (state[button]) presses.push(button);
      this.down[button] = state[button];
      changes.push({ button, down: state[button] });
    }
    return { changes, presses };
  }
}

export class ZwiftClick extends BleDevice {
  constructor() {
    super({
      label: 'Click',
      requestOptions: {
        filters: [{ namePrefix: 'Zwift Click' }, { namePrefix: 'Zwift Ride' }, { namePrefix: 'Zwift Play' }, { manufacturerData: [{ companyIdentifier: ZWIFT_COMPANY_ID }] }],
        optionalServices: [SERVICE, SERVICE_V2, 'battery_service'],
      },
    });
    this._tracker = new ButtonTracker();
  }

  async onConnected(server) {
    let service;
    try {
      service = await server.getPrimaryService(SERVICE);
    } catch {
      service = await server.getPrimaryService(SERVICE_V2);
    }
    const onValue = (e) => this._onNotification(e.target.value);
    const async = await service.getCharacteristic(ASYNC);
    async.addEventListener('characteristicvaluechanged', onValue);
    await async.startNotifications();
    try {
      const response = await service.getCharacteristic(RESPONSE);
      response.addEventListener('characteristicvaluechanged', onValue);
      await response.startNotifications();
    } catch {
      /* optional characteristic; buttons arrive on ASYNC */
    }
    const control = await service.getCharacteristic(CONTROL);
    await control.writeValue(new TextEncoder().encode(HANDSHAKE));
  }

  _onNotification(view) {
    const state = parseButtons(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    if (!state) return;
    const { changes, presses } = this._tracker.update(state);
    changes.forEach((detail) => this.dispatchEvent(new CustomEvent('button', { detail })));
    presses.forEach((button) => this.dispatchEvent(new CustomEvent('press', { detail: { button } })));
  }
}
