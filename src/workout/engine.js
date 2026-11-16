// Workout engine: plays a circuit against a machine.
// It owns the clock, decides which segment is active and pushes the matching
// resistance to the machine. The UI (and later the 3D world) only listen to events.
//
// Events:
//   'state'    { state: 'idle'|'running'|'paused'|'finished' }
//   'segment'  { index, segment, level }
//   'tick'     { elapsed, total, index, segmentElapsed, segmentRemaining, level }

import { totalDuration, pctToLevel } from './circuits.js?v=23';

export class WorkoutEngine extends EventTarget {
  constructor(machine, { now = () => performance.now() } = {}) {
    super();
    this.machine = machine;
    this.now = now;
    this.circuit = null;
    this.state = 'idle';
    this.scale = 1;   // global difficulty multiplier
    this.ceiling = null; // highest level the circuit is scaled to (null = machine max)
    this.offset = 0;  // manual +/- levels for the current segment
    this.index = -1;
    this._elapsedBefore = 0; // seconds accumulated before the last resume
    this._resumedAt = 0;
  }

  load(circuit) {
    this.circuit = circuit;
    this.total = totalDuration(circuit);
    this._starts = [];
    let t = 0;
    for (const s of circuit.segments) { this._starts.push(t); t += s.duration; }
    this.index = -1;
    this._elapsedBefore = 0;
    this._setState('idle');
  }

  get elapsed() {
    const live = this.state === 'running' ? (this.now() - this._resumedAt) / 1000 : 0;
    return Math.min(this.total ?? 0, this._elapsedBefore + live);
  }

  levelFor(index) {
    const seg = this.circuit.segments[index];
    const r = this.machine.range;
    const base = pctToLevel(seg.pct, { ...r, max: this.ceiling ?? r.max }, this.scale);
    const step = this.machine.range.step || 1;
    const lvl = base + this.offset * step;
    return Math.min(this.machine.range.max, Math.max(this.machine.range.min, Math.round(lvl * 10) / 10));
  }

  start() {
    if (!this.circuit) throw new Error('No circuit loaded');
    if (this.state === 'running') return;
    if (this.state === 'finished') this.load(this.circuit);
    this._resumedAt = this.now();
    this._setState('running');
    this.update();
  }

  pause() {
    if (this.state !== 'running') return;
    this._elapsedBefore = this.elapsed;
    this._setState('paused');
  }

  stop() {
    this._elapsedBefore = this.elapsed;
    this._setState('finished');
  }

  /** Jump to the start of the next segment. */
  skip() {
    if (!this.circuit || this.index < 0) return;
    const next = this.index + 1;
    const target = next < this._starts.length ? this._starts[next] : this.total;
    this._elapsedBefore = target;
    this._resumedAt = this.now();
    this.update();
  }

  /**
   * Jump to any time in the circuit (timeline tap, or resuming a saved session).
   * Before the workout has started this leaves it paused at that point.
   */
  seek(seconds) {
    if (!this.circuit) return;
    const t = Math.max(0, Math.min(this.total - 1, seconds));
    this._elapsedBefore = t;
    this._resumedAt = this.now();
    this.index = -1;                       // force the segment's level to be (re)sent
    if (this.state === 'idle' || this.state === 'finished') this._setState('paused');
    this.update();
  }

  /** Send the current segment's level again (e.g. after a Bluetooth reconnect). */
  reapply() {
    if (this.index >= 0) this._apply();
  }

  /** Manual nudge from the rider; resets when the next segment begins. */
  nudge(delta) {
    if (this.index < 0) return;
    this.offset += delta;
    this._apply();
  }

  /** Change the level ceiling (e.g. mid-workout); re-applies the current segment. */
  setCeiling(level) {
    const r = this.machine.range;
    this.ceiling = level == null ? null : Math.max(r.min + 1, Math.min(r.max, level));
    if (this.index >= 0) this._apply();
    return this.ceiling;
  }

  setScale(scale) {
    this.scale = scale;
    if (this.index >= 0) this._apply();
  }

  segmentIndexAt(t) {
    for (let i = this._starts.length - 1; i >= 0; i--) if (t >= this._starts[i]) return i;
    return 0;
  }

  /** Call regularly (the app does it ~4×/s). Safe to call any time. */
  update() {
    if (!this.circuit || this.state === 'idle') return;
    // (also runs while paused, so a seek updates the segment and level)
    const elapsed = this.elapsed;
    if (elapsed >= this.total && this.state === 'running') {
      this._elapsedBefore = this.total;
      this._setState('finished');
    }
    const idx = this.segmentIndexAt(Math.min(elapsed, this.total - 0.001));
    if (idx !== this.index) {
      this.index = idx;
      this.offset = 0;
      this._apply();
    }
    const segStart = this._starts[this.index];
    const seg = this.circuit.segments[this.index];
    this.dispatchEvent(new CustomEvent('tick', {
      detail: {
        elapsed,
        total: this.total,
        index: this.index,
        segmentElapsed: elapsed - segStart,
        segmentRemaining: Math.max(0, seg.duration - (elapsed - segStart)),
        level: this.levelFor(this.index),
      },
    }));
  }

  _apply() {
    const level = this.levelFor(this.index);
    this.dispatchEvent(new CustomEvent('segment', {
      detail: { index: this.index, segment: this.circuit.segments[this.index], level },
    }));
    // Fire-and-forget: a slow BLE write must never stall the clock.
    Promise.resolve(this.machine.setResistance(level)).catch((e) =>
      this.dispatchEvent(new CustomEvent('error', { detail: e })));
  }

  _setState(state) {
    this.state = state;
    this.dispatchEvent(new CustomEvent('state', { detail: { state } }));
  }
}
