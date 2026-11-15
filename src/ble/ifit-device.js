// Web Bluetooth driver for iFit "I_EL…" ellipticals (e.g. ProForm Endurance 420E).
// Same interface as FtmsMachine / SimulatedMachine.
// Protocol details: see ifit-protocol.js (ported from QZ, GPL-3.0).

import {
  IFIT, MAX_LEVEL, PRE_UNLOCK, POST_UNLOCK, POLL_CYCLE, RESISTANCE_SLOT, CMD, STATUS,
  resistancePackets, parseIfitPacket, toHex, frame, findAck,
} from './ifit-protocol.js?v=11';
import { UNLOCK_KEYS } from './ifit-keys.js?v=11';

const KEY_STORE = 'ifit-unlock-key';
const loadKey = () => { try { return localStorage.getItem(KEY_STORE); } catch { return null; } };
const saveKey = (src) => { try { localStorage.setItem(KEY_STORE, src); } catch { /* private mode */ } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class IfitMachine extends EventTarget {
  constructor({ rawLog = false } = {}) {
    super();
    this.kind = 'ifit';
    this.name = 'iFit elliptical';
    this.range = { min: 1, max: MAX_LEVEL, step: 1 };
    this.connected = false;
    this.rawLog = rawLog;
    this._device = null;
    this._write = null;
    this._pendingLevel = null;
    this._machineLevel = null;
    this._state = {};
    this._running = false;
    // Diagnostics (always on during the proof of concept): each distinct
    // packet from the console is logged once, plus a summary every 10 s.
    this._seen = new Set();
    this._rx = 0;
    this._rxParsed = 0;
    this._lastSummary = 0;
    this._ackWaiters = [];
    this.unlocked = false;
  }

  log(msg) { this.dispatchEvent(new CustomEvent('log', { detail: msg })); }

  /** `device` comes from navigator.bluetooth.requestDevice (see connect.js). */
  async connect(device) {
    this._device = device;
    this.name = device.name || this.name;
    device.addEventListener('gattserverdisconnected', () => {
      this._running = false;
      this.connected = false;
      this.log(`Disconnected (received ${this._rx} packets, ${this._rxParsed} understood)`);
      this.dispatchEvent(new Event('disconnect'));
    });

    this.log(`Connecting to ${this.name} (iFit protocol)…`);
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const svc = await server.getPrimaryService(IFIT.SERVICE);
    this._write = await svc.getCharacteristic(IFIT.WRITE);
    const notify = await svc.getCharacteristic(IFIT.NOTIFY);
    notify.addEventListener('characteristicvaluechanged', (e) => this._onNotify(e.target.value));
    await notify.startNotifications();

    this.log('Identifying console…');
    for (const p of PRE_UNLOCK) { await this._send(p); await sleep(400); }

    await this._unlock();

    for (const p of POST_UNLOCK) { await this._send(p); await sleep(400); }
    this.log(`Console ready${this.unlocked ? '' : ' (READ-ONLY: no unlock key accepted)'} – received ${this._rx} packets`);
    this.connected = true;
    this._running = true;
    this._pollLoop();
    return this;
  }

  /** Try known unlock keys until the console acknowledges one (status 02). */
  async _unlock() {
    const cached = loadKey();
    const keys = [...UNLOCK_KEYS].sort((a, b) => (b.src === cached) - (a.src === cached));
    this.log(`Unlocking: trying up to ${keys.length} known iFit keys${cached ? ' (saved key first)' : ''}…`);
    for (let i = 0; i < keys.length && this._device.gatt.connected; i++) {
      const ack = this._waitAck(CMD.UNLOCK, 1500);
      for (const p of frame(CMD.UNLOCK, keys[i].data)) await this._send(p);
      const res = await ack;
      const verdict = res ? STATUS[res.status] ?? `status ${res.status}` : 'no reply';
      if (res?.status === 0x02) {
        this.unlocked = true;
        saveKey(keys[i].src);
        this.log(`✅ Unlock key ${i + 1}/${keys.length} accepted (${keys[i].src})`);
        return;
      }
      this.log(`  key ${i + 1}/${keys.length}: ${verdict}`);
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

  async _send(bytes) {
    const data = new Uint8Array(bytes);
    if (this.rawLog) this.log(`>> ${toHex(data)}`);
    if (this._write.writeValueWithResponse) await this._write.writeValueWithResponse(data);
    else await this._write.writeValue(data);
  }

  async _pollLoop() {
    let step = 0;
    while (this._running) {
      try {
        await this._send(POLL_CYCLE[step]);
        if (step === RESISTANCE_SLOT && this._pendingLevel != null) {
          const level = this._pendingLevel;
          this._pendingLevel = null;
          const pk = resistancePackets(level);
          const ack = this._waitAck(CMD.WRITE_READ, 1500);
          for (const p of pk) await this._send(p);
          ack.then((res) => {
            const verdict = res ? STATUS[res.status] ?? `status ${res.status}` : 'no reply';
            this.lastResistanceAck = verdict;
            this.log(`Set resistance ${level}: ${verdict}`);
          });
        }
      } catch (e) {
        this.log(`Write failed: ${e?.message ?? e} (rx so far: ${this._rx})`);
      }
      step = (step + 1) % POLL_CYCLE.length;
      await sleep(200);
    }
  }

  _onNotify(value) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const hex = toHex(bytes);
    this._rx++;
    if (this.rawLog) this.log(`<< ${hex}`);
    else if (!this._seen.has(hex) && this._seen.size < 300) { this._seen.add(hex); this.log(`<< ${hex}`); }
    const ack = findAck(bytes);
    if (ack) {
      const i = this._ackWaiters.findIndex((w) => w.cmd === ack.cmd);
      if (i >= 0) this._ackWaiters.splice(i, 1)[0].resolve(ack);
    }
    const d = parseIfitPacket(bytes);
    const now = Date.now();
    if (now - this._lastSummary > 10000) {
      this._lastSummary = now;
      this.log(`rx ${this._rx} packets, ${this._rxParsed} understood · console level ${this._machineLevel ?? '?'} · cadence ${this._state.cadence ?? '?'}`);
    }
    if (!d) return;
    this._rxParsed++;
    if (d.resistanceCode != null) this._machineLevel = `${d.resistance ?? '?'} (code ${d.resistanceCode})`;
    Object.assign(this._state, d);
    this.dispatchEvent(new CustomEvent('data', { detail: { ...this._state } }));
  }

  /** Queued and sent at the next resistance slot of the poll cycle (≤1 s). */
  async setResistance(level) {
    const lvl = Math.max(this.range.min, Math.min(this.range.max, Math.round(level)));
    this._pendingLevel = lvl;
    return { ok: true, message: 'queued' };
  }

  async disconnect() {
    this._running = false;
    this._device?.gatt?.disconnect();
    this.connected = false;
  }
}
