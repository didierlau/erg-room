/**
 * Minimal writer for the Garmin FIT binary format (little-endian, FIT protocol 2.0).
 *
 * Usage: define a local message type once, then write any number of data
 * messages for it, then call `toBytes()` for the finished file with header
 * and CRCs. Only the base types this app needs are supported.
 *
 * Reference: FIT SDK "Flexible and Interoperable Data Transfer Protocol".
 */
import { clamp } from '../core/format.js';

/** Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
export const FIT_EPOCH_OFFSET = 631065600;

/** Convert a JavaScript millisecond timestamp to a FIT timestamp. */
export const toFitTime = (ms) => Math.floor(ms / 1000) - FIT_EPOCH_OFFSET;

const PROTOCOL_VERSION = 0x20;
const PROFILE_VERSION = 2132;
const HEADER_SIZE = 14;

/** FIT base types: [base type byte, size in bytes, invalid value]. */
const BASE_TYPES = {
  enum: [0x00, 1, 0xff],
  uint8: [0x02, 1, 0xff],
  sint16: [0x83, 2, 0x7fff],
  uint16: [0x84, 2, 0xffff],
  uint32: [0x86, 4, 0xffffffff],
  uint32z: [0x8c, 4, 0],
};

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];

/** FIT CRC-16 over `bytes`, continuing from `crc`. */
export function fitCrc(bytes, crc = 0) {
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

/** Encode `value` (or the type's invalid marker when missing) as little-endian bytes. */
function encodeValue(value, typeName) {
  const [, size, invalid] = BASE_TYPES[typeName];
  let v;
  if (value == null || !Number.isFinite(value)) v = invalid;
  else if (typeName === 'sint16') v = clamp(Math.round(value), -32767, 32766) & 0xffff;
  else if (typeName === 'uint32z') v = clamp(Math.round(value), 1, 2 ** 32 - 2);
  else v = clamp(Math.round(value), 0, 2 ** (size * 8) - 2); // max value is reserved as "invalid"
  const out = [];
  for (let k = 0; k < size; k++) {
    out.push(v % 256);
    v = Math.floor(v / 256);
  }
  return out;
}

export class FitWriter {
  #bytes = [];
  #definitions = new Map();

  /**
   * Write a definition message.
   * @param {number} localType  0–15
   * @param {number} globalMessage  FIT profile message number (e.g. 20 = record)
   * @param {Array<[number, keyof typeof BASE_TYPES]>} fields  [field number, base type]
   */
  define(localType, globalMessage, fields) {
    this.#bytes.push(0x40 | localType, 0, 0, globalMessage & 0xff, globalMessage >> 8, fields.length);
    for (const [num, type] of fields) {
      const [baseType, size] = BASE_TYPES[type];
      this.#bytes.push(num, size, baseType);
    }
    this.#definitions.set(localType, fields.map(([, type]) => type));
  }

  /** Write a data message; `values` follow the field order of the definition. Use null for "no value". */
  write(localType, values) {
    const types = this.#definitions.get(localType);
    if (!types) throw new Error(`Local message type ${localType} has not been defined`);
    if (values.length !== types.length) throw new Error(`Expected ${types.length} values for local type ${localType}, got ${values.length}`);
    this.#bytes.push(localType);
    types.forEach((type, i) => this.#bytes.push(...encodeValue(values[i], type)));
  }

  /** @returns {Uint8Array} the complete .fit file */
  toBytes() {
    const data = this.#bytes;
    const n = data.length;
    const header = [HEADER_SIZE, PROTOCOL_VERSION, PROFILE_VERSION & 0xff, PROFILE_VERSION >> 8,
      n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff, 0x2e, 0x46, 0x49, 0x54]; // ".FIT"
    const headerCrc = fitCrc(header);
    header.push(headerCrc & 0xff, headerCrc >> 8);
    const out = new Uint8Array(header.length + n + 2);
    out.set(header, 0);
    out.set(data, header.length);
    const fileCrc = fitCrc(out.subarray(0, header.length + n));
    out[out.length - 2] = fileCrc & 0xff;
    out[out.length - 1] = fileCrc >> 8;
    return out;
  }
}
