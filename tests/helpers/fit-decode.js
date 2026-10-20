// Independent FIT reader used by the tests: checks header and CRCs and returns raw field values.
import { fitCrc } from '../../src/fit/fit-writer.js';

const SIGNED = new Set([0x83]);

export function decodeFit(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = bytes[0];
  const dataSize = view.getUint32(4, true);
  const signature = String.fromCharCode(...bytes.subarray(8, 12));
  if (signature !== '.FIT') throw new Error(`bad signature ${signature}`);
  if (fitCrc(bytes.subarray(0, 12)) !== view.getUint16(12, true)) throw new Error('bad header CRC');
  if (bytes.length !== headerSize + dataSize + 2) throw new Error('size mismatch');
  if (fitCrc(bytes.subarray(0, bytes.length - 2)) !== view.getUint16(bytes.length - 2, true)) throw new Error('bad file CRC');

  const defs = new Map();
  const messages = [];
  let o = headerSize;
  const end = headerSize + dataSize;
  while (o < end) {
    const header = bytes[o++];
    const local = header & 0x0f;
    if (header & 0x40) {
      const global = view.getUint16(o + 2, true);
      const count = bytes[o + 4];
      o += 5;
      const fields = [];
      for (let i = 0; i < count; i++, o += 3) fields.push({ num: bytes[o], size: bytes[o + 1], type: bytes[o + 2] });
      defs.set(local, { global, fields });
    } else {
      const def = defs.get(local);
      if (!def) throw new Error(`data for undefined local type ${local}`);
      const fields = {};
      for (const f of def.fields) {
        let v = 0;
        for (let k = f.size - 1; k >= 0; k--) v = v * 256 + bytes[o + k];
        if (SIGNED.has(f.type) && v >= 2 ** (f.size * 8 - 1)) v -= 2 ** (f.size * 8);
        fields[f.num] = v;
        o += f.size;
      }
      messages.push({ global: def.global, fields });
    }
  }
  return messages;
}
