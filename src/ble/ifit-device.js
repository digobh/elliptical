// Web Bluetooth driver for iFit "I_EL…" ellipticals (e.g. ProForm Endurance 420E).
// Same interface as FtmsMachine / SimulatedMachine.
// Protocol details: see ifit-protocol.js (ported from QZ, GPL-3.0).

import {
  IFIT, MAX_LEVEL, INIT_SEQUENCE, POLL_CYCLE, RESISTANCE_SLOT,
  resistancePackets, parseIfitPacket, toHex,
} from './ifit-protocol.js?v=7';

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
  }

  log(msg) { this.dispatchEvent(new CustomEvent('log', { detail: msg })); }

  /** `device` comes from navigator.bluetooth.requestDevice (see connect.js). */
  async connect(device) {
    this._device = device;
    this.name = device.name || this.name;
    device.addEventListener('gattserverdisconnected', () => {
      this._running = false;
      this.connected = false;
      this.log('Disconnected');
      this.dispatchEvent(new Event('disconnect'));
    });

    this.log(`Connecting to ${this.name} (iFit protocol)…`);
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const svc = await server.getPrimaryService(IFIT.SERVICE);
    this._write = await svc.getCharacteristic(IFIT.WRITE);
    const notify = await svc.getCharacteristic(IFIT.NOTIFY);
    notify.addEventListener('characteristicvaluechanged', (e) => this._onNotify(e.target.value));
    await notify.startNotifications();

    this.log(`Initialising console (${INIT_SEQUENCE.length} steps, ~${Math.round(INIT_SEQUENCE.length * 0.4)} s)…`);
    for (let i = 0; i < INIT_SEQUENCE.length; i++) {
      await this._send(INIT_SEQUENCE[i]);
      if (i % 5 === 4) this.log(`  init ${i + 1}/${INIT_SEQUENCE.length}`);
      await sleep(400);
    }
    this.log('Console ready – resistance control active');
    this.connected = true;
    this._running = true;
    this._pollLoop();
    return this;
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
          for (const p of resistancePackets(level)) await this._send(p);
          this.log(`Set resistance ${level}: sent`);
        }
      } catch (e) {
        this.log(`Write failed: ${e?.message ?? e}`);
      }
      step = (step + 1) % POLL_CYCLE.length;
      await sleep(200);
    }
  }

  _onNotify(value) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (this.rawLog) this.log(`<< ${toHex(bytes)}`);
    const d = parseIfitPacket(bytes);
    if (!d) return;
    if (d.resistance != null) this._machineLevel = d.resistance;
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
