// iFit (ICON Health & Fitness) proprietary BLE protocol for ellipticals that
// advertise as "I_EL…" — e.g. ProForm Endurance 420E.
//
// Ported from QZ / qdomyos-zwift (GPL-3.0), src/devices/nordictrackelliptical,
// default variant (the one QZ uses for I_EL machines). Copyright (c) Roberto Viola
// and the QZ contributors. https://github.com/cagnulein/qdomyos-zwift
//
// Pure data + parsing, no browser APIs, so it is unit-tested in Node.

export const IFIT = {
  SERVICE: '00001533-1412-efde-1523-785feabcd123',
  WRITE: '00001534-1412-efde-1523-785feabcd123',
  NOTIFY: '00001535-1412-efde-1523-785feabcd123',
};

export const MAX_LEVEL = 20;

const pad20 = (bytes) => [...bytes, ...Array(20 - bytes.length).fill(0)];

/** Init sequence, sent once after connecting (QZ waits 400 ms between writes). */
const I1 = [0xfe, 0x02, 0x08, 0x02];
const I5 = [0xfe, 0x02, 0x0a, 0x02];
const N1 = [0xfe, 0x02, 0x19, 0x03];
const N4 = [0xfe, 0x02, 0x17, 0x03];
export const INIT_SEQUENCE = [
  I1, pad20([0xff, 0x08, 0x02, 0x04, 0x02, 0x04, 0x02, 0x04, 0x81, 0x87]),
  I1, pad20([0xff, 0x08, 0x02, 0x04, 0x02, 0x04, 0x06, 0x04, 0x80, 0x8a]),
  I1, pad20([0xff, 0x08, 0x02, 0x04, 0x02, 0x04, 0x06, 0x04, 0x88, 0x92]),
  I5, pad20([0xff, 0x0a, 0x02, 0x04, 0x02, 0x06, 0x02, 0x06, 0x82, 0x00, 0x00, 0x8a]),
  I5, pad20([0xff, 0x0a, 0x02, 0x04, 0x02, 0x06, 0x02, 0x06, 0x84, 0x00, 0x00, 0x8c]),
  I1, pad20([0xff, 0x08, 0x02, 0x04, 0x02, 0x04, 0x02, 0x04, 0x95, 0x9b]),
  [0xfe, 0x02, 0x2c, 0x04],
  [0x00, 0x12, 0x02, 0x04, 0x02, 0x28, 0x06, 0x28, 0x90, 0x04, 0x00, 0x2e, 0x44, 0x50, 0x6a, 0x82, 0xa8, 0xb4, 0xd6, 0xf6],
  [0x01, 0x12, 0x2c, 0x48, 0x62, 0x9a, 0xd0, 0xfc, 0x0e, 0x5e, 0x94, 0xa0, 0xfa, 0x32, 0x78, 0x84, 0xc6, 0x06, 0x7c, 0xb8],
  pad20([0xff, 0x08, 0xf2, 0x2a, 0xa0, 0x80, 0x02, 0x00, 0x00, 0xda]),
  N1, pad20([0x00, 0x12, 0x02, 0x04, 0x02, 0x15, 0x06, 0x15, 0x02, 0x0e]),
  pad20([0xff, 0x07, 0x00, 0x00, 0x00, 0x10, 0x01, 0x00, 0x3c]),
  N4, pad20([0x00, 0x12, 0x02, 0x04, 0x02, 0x13, 0x06, 0x13, 0x02, 0x0c]),
  pad20([0xff, 0x05, 0x00, 0x80, 0x01, 0x00, 0xa8]),
  N4, [0x00, 0x12, 0x02, 0x04, 0x02, 0x13, 0x06, 0x13, 0x02, 0x00, 0x0d, 0x00, 0x10, 0x00, 0xc0, 0x1c, 0x4c, 0x00, 0x00, 0xe0],
  pad20([0xff, 0x05, 0x00, 0x00, 0x00, 0x10, 0x50]),
  N4, pad20([0x00, 0x12, 0x02, 0x04, 0x02, 0x13, 0x06, 0x13, 0x02, 0x0c]),
  pad20([0xff, 0x05, 0x00, 0x80, 0x01, 0x00, 0xa8]),
];

/** Steps 0–11: identify the console. Steps 12–15: QZ's default unlock (0x90). Rest: start-up reads. */
export const PRE_UNLOCK = INIT_SEQUENCE.slice(0, 12);
export const DEFAULT_UNLOCK = INIT_SEQUENCE.slice(12, 16);
export const POST_UNLOCK = INIT_SEQUENCE.slice(16);

export const DEVICE = 0x06; // elliptical console address on the iFit bus
export const CMD = { WRITE_READ: 0x02, UNLOCK: 0x90 };
export const STATUS = { 0x02: 'accepted', 0x04: 'rejected (4)', 0x08: 'rejected (8)' };

/**
 * Frame an iFit message into BLE packets.
 * Message: 02 04 02 L | dev L cmd data… checksum   (L = 3 + data + 1, checksum = sum(dev…data))
 * Packets: fe 02 <total> <count incl. header>, then 18-byte chunks "00 12 …", "01 12 …",
 * the last chunk is "ff <n> …"; every packet is padded to 20 bytes except the header.
 */
export function frame(cmd, data, dev = DEVICE) {
  const L = data.length + 4;
  const body = [dev, L, cmd, ...data];
  const msg = [0x02, 0x04, 0x02, L, ...body, body.reduce((a, b) => a + b, 0) & 0xff];
  const chunks = [];
  for (let i = 0; i < msg.length; i += 18) chunks.push(msg.slice(i, i + 18));
  const packets = chunks.map((c, i) => pad20([i === chunks.length - 1 ? 0xff : i, c.length, ...c]));
  return [[0xfe, 0x02, msg.length, chunks.length + 1], ...packets];
}

/**
 * Find a short console reply "06 L <cmd> <status> … <checksum>" (L = 5 or 6) inside a
 * notification. Rejections are 5 bytes ("06 05 90 04 9f"); an accepted unlock is 6
 * ("06 06 90 02 08 a6", recorded from the iFit app).
 */
export function findAck(bytes) {
  for (let i = 0; i + 4 < bytes.length; i++) {
    const L = bytes[i + 1];
    if (bytes[i] !== DEVICE || (L !== 5 && L !== 6) || i + L > bytes.length) continue;
    let sum = 0;
    for (let j = i; j < i + L - 1; j++) sum += bytes[j];
    if ((sum & 0xff) === bytes[i + L - 1]) return { cmd: bytes[i + 2], status: bytes[i + 3] };
  }
  return null;
}

/** Keep-alive / data-request cycle, one packet every 200 ms. */
export const POLL_CYCLE = [
  [0xfe, 0x02, 0x17, 0x03],
  [0x00, 0x12, 0x02, 0x04, 0x02, 0x13, 0x06, 0x13, 0x02, 0x00, 0x0d, 0x3c, 0x9e, 0x31, 0x00, 0x00, 0x40, 0x40, 0x00, 0x80],
  pad20([0xff, 0x05, 0x00, 0x00, 0x00, 0x81, 0xb4]),
  [0xfe, 0x02, 0x0d, 0x02],
  pad20([0xff, 0x0d, 0x02, 0x04, 0x02, 0x09, 0x06, 0x09, 0x02, 0x00, 0x03, 0x80, 0x00, 0x40, 0xd4]),
];
/** QZ sends a pending resistance change right after this poll step. */
export const RESISTANCE_SLOT = 4;

/**
 * Two packets that set resistance level 1–20. The raw value is 500·level − 50
 * (little endian) and the last byte is a checksum of bytes 6–13. Verified in the
 * tests against every entry of QZ's hard-coded table.
 */
export function resistancePackets(level) {
  const lvl = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)));
  const raw = 500 * lvl - 50;
  const p = [0xff, 0x0d, 0x02, 0x04, 0x02, 0x09, 0x06, 0x09, 0x02, 0x01, 0x04, raw & 0xff, (raw >> 8) & 0xff, 0x00];
  const checksum = p.slice(6, 14).reduce((a, b) => a + b, 0) & 0xff;
  return [[0xfe, 0x02, 0x0d, 0x02], pad20([...p, checksum])];
}

/** Byte 11 of a status packet → console resistance level (QZ lookup table). */
const RES_CODES = {
  0x01: 1, 0x03: 2, 0x05: 3, 0x07: 4, 0x08: 4, 0x09: 5, 0x0b: 6, 0x0c: 7, 0x0d: 7,
  0x0f: 8, 0x11: 9, 0x13: 10, 0x14: 11, 0x15: 11, 0x17: 12, 0x19: 13, 0x1a: 13,
  0x1b: 14, 0x1d: 15, 0x1f: 16, 0x21: 17, 0x22: 18, 0x23: 18, 0x24: 19, 0x25: 19,
  0x26: 20, 0x27: 20,
};

/**
 * Parse one 20-byte notification. Returns a partial data object (same field
 * names as the FTMS parser) or null if the packet carries nothing we use.
 */
export function parseIfitPacket(data) {
  const b = data instanceof Uint8Array ? data
    : new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength);
  if (b.length !== 20) return null;

  // Cadence packet: 01 12 <cadence> … 2C
  if (b[0] === 0x01 && b[1] === 0x12 && b[19] === 0x2c) return { cadence: b[2] };

  // Speed packet: 01 12 … speed (0.01 km/h) in bytes 14–15
  if (b[0] === 0x01 && b[1] === 0x12) return { speedKmh: (b[14] | (b[15] << 8)) / 100 };

  // Status packet: 00|01 12 01 04 02 (2e|30|31) … resistance code in byte 11
  const isStatus = b[0] === 0x00 && b[1] === 0x12 && b[2] === 0x01 && b[3] === 0x04 && b[4] === 0x02 &&
    [0x2e, 0x30, 0x31].includes(b[5]);
  const allFF = b.slice(12, 20).every((x) => x === 0xff);
  if (isStatus && !allFF && b[11] !== 0) {
    return { resistance: RES_CODES[b[11]] ?? null, resistanceCode: b[11] };
  }

  return null;
}

export const toHex = (bytes) => [...bytes].map((x) => x.toString(16).padStart(2, '0')).join(' ');

// ---------------------------------------------------------------------------
// Message-level helpers (used by the 420E profile, recorded from the iFit app).

/** Split one complete message (02 04 02 L …) into BLE packets, like frame(). */
export function packetize(msg) {
  const chunks = [];
  for (let i = 0; i < msg.length; i += 18) chunks.push(msg.slice(i, i + 18));
  return [[0xfe, 0x02, msg.length, chunks.length + 1],
    ...chunks.map((c, i) => pad20([i === chunks.length - 1 ? 0xff : i, c.length, ...c]))];
}

/** Build a complete message: 02 04 02 L | dev L cmd data… checksum. */
export function message(cmd, data, dev = DEVICE) {
  const L = data.length + 4;
  const body = [dev, L, cmd, ...data];
  return [0x02, 0x04, 0x02, L, ...body, body.reduce((a, b) => a + b, 0) & 0xff];
}

/** Resistance write as the iFit app sends it: cmd 02, field mask 01 04, u16 value, no reads. */
export function resistanceMessage(level, { levels, rawPerLevel }) {
  const lvl = Math.max(1, Math.min(levels, Math.round(level)));
  const raw = rawPerLevel * lvl - 1;
  return message(CMD.WRITE_READ, [0x01, 0x04, raw & 0xff, (raw >> 8) & 0xff, 0x00]);
}

/**
 * Reassembles console notifications into messages. Packets: a header
 * "fe 02 <total> <count>" then chunks "<idx|ff> <n> bytes…" (rest is stale padding).
 */
export class Reassembler {
  constructor() { this.buf = null; }
  /** Returns a complete message (array of bytes) or null. */
  push(bytes) {
    const b = [...bytes];
    if (b[0] === 0xfe && b[1] === 0x02) { this.buf = { total: b[2], bytes: [] }; return null; }
    if (!this.buf) return null;
    this.buf.bytes.push(...b.slice(2, 2 + b[1]));
    if (b[0] !== 0xff) return null;
    const msg = this.buf.bytes;
    this.buf = null;
    return msg;
  }
}

/** Reply header: 01 04 02 L dev L cmd status … */
export const replyInfo = (msg) => (msg.length >= 8 ? { cmd: msg[6], status: msg[7] } : null);

/**
 * Decode the 420E's reply to poll A (49 bytes). Field offsets found by lining
 * the recording up with the resistance changes the iFit app made.
 */
export function parsePollA(msg, { rawPerLevel }) {
  if (msg.length < 30 || msg[6] !== CMD.WRITE_READ || msg[7] !== 0x02) return null;
  const d = msg.slice(8);
  const u16 = (i) => d[i] | (d[i + 1] << 8);
  const raw = u16(0);
  return {
    resistance: Math.round((raw + 1) / rawPerLevel),
    resistanceRaw: raw,
    powerW: u16(2),
    distanceM: u16(4) | (u16(6) << 16),
    cadence: u16(8),
    mode: d[15],
    elapsedS: u16(16),
    speedKmh: u16(18) / 100,
  };
}
