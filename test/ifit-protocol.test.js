import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resistancePackets, parseIfitPacket, INIT_SEQUENCE, POLL_CYCLE, MAX_LEVEL,
} from '../src/ble/ifit-protocol.js';

// QZ nordictrackelliptical::forceResistance, default branch: bytes 11, 12 and 14 of res1…res20.
const QZ_TABLE = [
  [0xc2, 0x01, 0xd9], [0xb6, 0x03, 0xcf], [0xaa, 0x05, 0xc5], [0x9e, 0x07, 0xbb], [0x92, 0x09, 0xb1],
  [0x86, 0x0b, 0xa7], [0x7a, 0x0d, 0x9d], [0x6e, 0x0f, 0x93], [0x62, 0x11, 0x89], [0x56, 0x13, 0x7f],
  [0x4a, 0x15, 0x75], [0x3e, 0x17, 0x6b], [0x32, 0x19, 0x61], [0x26, 0x1b, 0x57], [0x1a, 0x1d, 0x4d],
  [0x0e, 0x1f, 0x43], [0x02, 0x21, 0x39], [0xf6, 0x22, 0x2e], [0xea, 0x24, 0x24], [0xde, 0x26, 0x1a],
];

test('resistance packets match the QZ table for every level', () => {
  assert.equal(MAX_LEVEL, 20);
  QZ_TABLE.forEach(([lo, hi, sum], i) => {
    const [header, body] = resistancePackets(i + 1);
    assert.deepEqual(header, [0xfe, 0x02, 0x0d, 0x02]);
    assert.deepEqual(body, [0xff, 0x0d, 0x02, 0x04, 0x02, 0x09, 0x06, 0x09, 0x02, 0x01,
      0x04, lo, hi, 0x00, sum, 0, 0, 0, 0, 0], `level ${i + 1}`);
  });
});

test('resistance level is clamped to 1–20', () => {
  assert.deepEqual(resistancePackets(0), resistancePackets(1));
  assert.deepEqual(resistancePackets(99), resistancePackets(20));
});

test('every packet is 4 (header) or 20 bytes', () => {
  for (const p of [...INIT_SEQUENCE, ...POLL_CYCLE]) {
    assert.ok(p.length === 4 || p.length === 20, `bad length ${p.length}`);
    assert.ok(p.every((b) => Number.isInteger(b) && b >= 0 && b <= 255));
  }
  assert.equal(INIT_SEQUENCE.length, 28); // QZ default btinit() write count
});

test('parse cadence, speed and resistance packets', () => {
  const cad = new Uint8Array(20); cad.set([0x01, 0x12, 0x3c]); cad[19] = 0x2c;
  assert.deepEqual(parseIfitPacket(cad), { cadence: 60 });

  const spd = new Uint8Array(20); spd.set([0x01, 0x12]); spd[14] = 0xe8; spd[15] = 0x03;
  assert.deepEqual(parseIfitPacket(spd), { speedKmh: 10 });

  const st = new Uint8Array(20); st.set([0x00, 0x12, 0x01, 0x04, 0x02, 0x2e]); st[11] = 0x13;
  assert.deepEqual(parseIfitPacket(st), { resistance: 10, resistanceCode: 0x13 });

  st.fill(0xff, 12, 20);
  assert.equal(parseIfitPacket(st), null, 'all-FF status is ignored');
  assert.equal(parseIfitPacket(new Uint8Array(10)), null);
});

import { frame, findAck, DEFAULT_UNLOCK, PRE_UNLOCK, POST_UNLOCK, CMD } from '../src/ble/ifit-protocol.js';
import { UNLOCK_KEYS } from '../src/ble/ifit-keys.js';

test('frame() reproduces QZ packets (resistance, poll, default unlock)', () => {
  assert.deepEqual(frame(CMD.WRITE_READ, [0x01, 0x04, 0xc2, 0x01, 0x00]), resistancePackets(1));
  const poll = frame(CMD.WRITE_READ, [0x00, 0x0d, 0x3c, 0x9e, 0x31, 0x00, 0x00, 0x40, 0x40, 0x00, 0x80, 0x00, 0x00, 0x00, 0x81]);
  assert.deepEqual(poll, POLL_CYCLE.slice(0, 3));
  const defaultKey = UNLOCK_KEYS.find((k) => k.src.includes('nordictrackelliptical.cpp:initData10') && !k.src.includes('10b'));
  assert.deepEqual(frame(CMD.UNLOCK, defaultKey.data), DEFAULT_UNLOCK);
  assert.equal(PRE_UNLOCK.length + DEFAULT_UNLOCK.length + POST_UNLOCK.length, INIT_SEQUENCE.length);
});

test('all unlock keys frame to 4 packets of the right shape', () => {
  assert.equal(UNLOCK_KEYS.length, 79);
  for (const k of UNLOCK_KEYS) {
    const pk = frame(CMD.UNLOCK, k.data);
    assert.equal(pk.length, 4);
    assert.deepEqual(pk[0], [0xfe, 0x02, 0x2c, 0x04]);
  }
});

test('findAck decodes the 420E replies from the field log', () => {
  const hex = (s) => s.split(' ').map((x) => parseInt(x, 16));
  assert.deepEqual(findAck(hex('ff 09 01 04 02 05 06 05 90 04 9f c0 32 36 34 30 38 2d 50 50')), { cmd: 0x90, status: 0x04 });
  assert.deepEqual(findAck(hex('ff 09 01 04 02 05 06 05 02 08 15 00 ff ff ff ff ff ff ff ff')), { cmd: 0x02, status: 0x08 });
  assert.equal(findAck(hex('00 12 01 04 02 30 06 30 02 02 00 00 1e 00 57 00 00 00 24 00')), null);
});
