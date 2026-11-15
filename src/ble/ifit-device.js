// Web Bluetooth driver for iFit "I_EL…" ellipticals (e.g. ProForm Endurance 420E).
// Same interface as FtmsMachine / SimulatedMachine.
//
// Two paths:
//  1. Known console (ProForm Endurance 420E): replay exactly what the official
//     iFit app does (ifit-420e.js, recorded from a Bluetooth log): identify →
//     unlock with the recorded key → setup → "start workout" → poll every 250 ms.
//  2. Other I_EL consoles: QZ's default driver (GPL-3.0) plus a search through
//     every unlock key QZ knows (ifit-keys.js).

import {
  IFIT, MAX_LEVEL, PRE_UNLOCK, POST_UNLOCK, POLL_CYCLE, RESISTANCE_SLOT, CMD, STATUS,
  resistancePackets, parseIfitPacket, toHex, frame, findAck,
  packetize, message, resistanceMessage, Reassembler, replyInfo, parsePollA,
} from './ifit-protocol.js?v=16';
import { UNLOCK_KEYS } from './ifit-keys.js?v=16';
import { PROFILE_420E } from './ifit-420e.js?v=16';

const KEY_STORE = 'ifit-unlock-key';
const loadKey = () => { try { return localStorage.getItem(KEY_STORE); } catch { return null; } };
const saveKey = (src) => { try { localStorage.setItem(KEY_STORE, src); } catch { /* private mode */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const verdictOf = (status) => STATUS[status] ?? `status ${status}`;

export class IfitMachine extends EventTarget {
  constructor({ rawLog = false } = {}) {
    super();
    this.kind = 'ifit';
    this.name = 'iFit elliptical';
    this.range = { min: 1, max: MAX_LEVEL, step: 1 };
    this.connected = false;
    this.unlocked = false;
    this.profile = null; // PROFILE_420E when the recorded key is accepted
    this.rawLog = rawLog;
    this.lastResistanceAck = null;
    this._device = null;
    this._write = null;
    this._pendingLevel = null;
    this._state = {};
    this._running = false;
    this._started = false; // console in workout mode (420E path)
    this._reasm = new Reassembler();
    this._replyQueue = []; // FIFO of resolvers: the console answers every message in order
    this._ackWaiters = []; // QZ path: packet-level acknowledgements
    this._seen = new Set();
    this._rx = 0;
    this._lastSummary = 0;
  }

  log(msg) { this.dispatchEvent(new CustomEvent('log', { detail: msg })); }

  /** `device` comes from navigator.bluetooth.requestDevice (see connect.js). */
  async connect(device) {
    this._device = device;
    this.name = device.name || this.name;
    device.addEventListener('gattserverdisconnected', () => {
      this._running = false;
      this.connected = false;
      this.log(`Disconnected (received ${this._rx} packets)`);
      this.dispatchEvent(new Event('disconnect'));
    });

    this.log(`Connecting to ${this.name} (iFit protocol)…`);
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const svc = await server.getPrimaryService(IFIT.SERVICE);
    this._write = await svc.getCharacteristic(IFIT.WRITE);
    const notify = await svc.getCharacteristic(IFIT.NOTIFY);
    notify.addEventListener('characteristicvaluechanged', (e) => this._onNotify(e.target.value));
    await notify.startNotifications();

    // 1. Identify the console, exactly like the iFit app.
    this.log('Identifying console…');
    for (const m of PROFILE_420E.identify) { await this._request(m); await sleep(100); }

    // 2. Unlock: recorded 420E key first.
    const res = await this._request(message(CMD.UNLOCK, PROFILE_420E.unlockKey));
    if (res && res.status === 0x02) {
      this.profile = PROFILE_420E;
      this.unlocked = true;
      this.range = { min: 1, max: PROFILE_420E.levels, step: 1 };
      this.log(`✅ Unlocked as ${PROFILE_420E.name} (${PROFILE_420E.levels} resistance levels)`);
      for (const m of PROFILE_420E.setup) { await this._request(m); await sleep(150); }
      this.log('Console ready');
      this.connected = true;
      this._running = true;
      this._poll420E();
      return this;
    }
    this.log(`420E key: ${res ? verdictOf(res.status) : 'no reply'} – trying other known consoles…`);

    // 3. Fallback: QZ default driver + key search.
    this._qzMode = true;
    for (const p of PRE_UNLOCK) { await this._send(p); await sleep(400); }
    await this._unlockQz();
    for (const p of POST_UNLOCK) { await this._send(p); await sleep(400); }
    this.log(`Console ready${this.unlocked ? '' : ' (READ-ONLY: no unlock key accepted)'}`);
    this.connected = true;
    this._running = true;
    this._pollQz();
    return this;
  }

  // ---------------------------------------------------------------- 420E path

  /** Send one complete message and resolve with the console's reply info (or null). */
  async _request(msg, timeoutMs = 1500) {
    const reply = new Promise((resolve) => {
      const entry = { resolve };
      this._replyQueue.push(entry);
      setTimeout(() => {
        const i = this._replyQueue.indexOf(entry);
        if (i >= 0) { this._replyQueue.splice(i, 1); resolve(null); }
      }, timeoutMs);
    });
    for (const p of packetize(msg)) await this._send(p);
    return reply;
  }

  async _poll420E() {
    const P = this.profile;
    let flip = false;
    while (this._running) {
      try {
        if (this._pendingLevel != null) {
          if (!this._started) await this.startWorkout();
          const level = this._pendingLevel;
          this._pendingLevel = null;
          const r = await this._request(resistanceMessage(level, P));
          this.lastResistanceAck = r ? verdictOf(r.status) : 'no reply';
          this.log(`Set resistance ${level}: ${this.lastResistanceAck}`);
        }
        await this._request((flip = !flip) ? P.pollA : P.pollB);
      } catch (e) {
        this.log(`Write failed: ${e?.message ?? e}`);
      }
      await sleep(200);
    }
  }

  /** What the iFit app sends when a workout starts (ends with mode = running). */
  async startWorkout() {
    if (!this.profile || this._started) return;
    this._started = true;
    this.log('Starting workout on the console…');
    for (const m of this.profile.start) {
      const r = await this._request(m);
      if (r && r.status !== 0x02) this.log(`  start step: ${verdictOf(r.status)}`);
      await sleep(150);
    }
  }

  /** iFit sends "mode = 13" when a workout ends. */
  async endWorkout() {
    if (!this.profile || !this._started || !this._running) return;
    this._started = false;
    await this._request(this.profile.stop);
    this.log('Workout ended on the console');
  }

  // ------------------------------------------------------------------ QZ path

  async _unlockQz() {
    const cached = loadKey();
    const keys = [...UNLOCK_KEYS].sort((a, b) => (b.src === cached) - (a.src === cached));
    this.log(`Trying ${keys.length} other known iFit keys…`);
    for (let i = 0; i < keys.length && this._device.gatt.connected; i++) {
      const ack = this._waitAck(CMD.UNLOCK, 1500);
      for (const p of frame(CMD.UNLOCK, keys[i].data)) await this._send(p);
      const res = await ack;
      if (res?.status === 0x02) {
        this.unlocked = true;
        saveKey(keys[i].src);
        this.log(`✅ Unlock key ${i + 1}/${keys.length} accepted (${keys[i].src})`);
        return;
      }
      this.log(`  key ${i + 1}/${keys.length}: ${res ? verdictOf(res.status) : 'no reply'}`);
      await sleep(150);
    }
    this.log('❌ No known unlock key was accepted. Live data still works; resistance control will not.');
  }

  _waitAck(cmd, timeoutMs) {
    return new Promise((resolve) => {
      const w = { cmd, resolve };
      this._ackWaiters.push(w);
      setTimeout(() => {
        const i = this._ackWaiters.indexOf(w);
        if (i >= 0) { this._ackWaiters.splice(i, 1); resolve(null); }
      }, timeoutMs);
    });
  }

  async _pollQz() {
    let step = 0;
    while (this._running) {
      try {
        await this._send(POLL_CYCLE[step]);
        if (step === RESISTANCE_SLOT && this._pendingLevel != null) {
          const level = this._pendingLevel;
          this._pendingLevel = null;
          const ack = this._waitAck(CMD.WRITE_READ, 1500);
          for (const p of resistancePackets(level)) await this._send(p);
          ack.then((res) => {
            this.lastResistanceAck = res ? verdictOf(res.status) : 'no reply';
            this.log(`Set resistance ${level}: ${this.lastResistanceAck}`);
          });
        }
      } catch (e) {
        this.log(`Write failed: ${e?.message ?? e}`);
      }
      step = (step + 1) % POLL_CYCLE.length;
      await sleep(200);
    }
  }

  // ------------------------------------------------------------------ common

  async _send(bytes) {
    const data = new Uint8Array(bytes);
    if (this.rawLog) this.log(`>> ${toHex(data)}`);
    if (this._write.writeValueWithResponse) await this._write.writeValueWithResponse(data);
    else await this._write.writeValue(data);
  }

  _onNotify(value) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this._rx++;
    if (this.rawLog) this.log(`<< ${toHex(bytes)}`);
    else if (this._qzMode && !this._seen.has(toHex(bytes)) && this._seen.size < 300) {
      this._seen.add(toHex(bytes));
      this.log(`<< ${toHex(bytes)}`);
    }

    // Message level (420E path and identification).
    const msg = this._reasm.push(bytes);
    if (msg) {
      const info = replyInfo(msg);
      this._replyQueue.shift()?.resolve(info);
      if (this.profile) {
        const d = parsePollA(msg, this.profile);
        if (d && msg.length >= 40) this._emit(d);
      }
    }

    // Packet level (QZ path).
    if (this._qzMode) {
      const ack = findAck(bytes);
      if (ack) {
        const i = this._ackWaiters.findIndex((w) => w.cmd === ack.cmd);
        if (i >= 0) this._ackWaiters.splice(i, 1)[0].resolve(ack);
      }
      const d = parseIfitPacket(bytes);
      if (d) this._emit(d);
    }
  }

  _emit(d) {
    Object.assign(this._state, d);
    const now = Date.now();
    if (now - this._lastSummary > 15000) {
      this._lastSummary = now;
      this.log(`console: level ${this._state.resistance ?? '?'} · ${this._state.powerW ?? '?'} W · ${this._state.speedKmh ?? '?'} km/h`);
    }
    this.dispatchEvent(new CustomEvent('data', { detail: { ...this._state } }));
  }

  /** Queued and sent before the next poll (≤ 0.5 s). */
  async setResistance(level) {
    const lvl = Math.max(this.range.min, Math.min(this.range.max, Math.round(level)));
    this._pendingLevel = lvl;
    return { ok: true, message: 'queued' };
  }

  async disconnect() {
    try { await this.endWorkout(); } catch { /* ignore */ }
    this._running = false;
    this._device?.gatt?.disconnect();
    this.connected = false;
  }
}
