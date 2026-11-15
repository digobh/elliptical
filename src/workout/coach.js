// Guidance during a workout: cadence targets and auto-pause.
//
// Cadence units differ between machines (the ProForm 420E reports ~35 where a
// circuit says 120), so targets are relative: the coach learns the rider's
// normal rhythm during the warm-up and scales each segment's target from it.
// Circuits express cadence around a baseline of 120 ("steady").

export const BASELINE_REF = 120;

export class CadenceCoach {
  constructor({ learnSeconds = 30 } = {}) {
    this.learnSeconds = learnSeconds;
    this.samples = [];
    this.baseline = null;
  }

  /** Feed cadence readings while the rider is warming up (or the first minute). */
  learn(cadence) {
    if (this.baseline != null || !(cadence > 0)) return;
    this.samples.push(cadence);
    if (this.samples.length >= this.learnSeconds) {
      const s = [...this.samples].sort((a, b) => a - b);
      this.baseline = s[Math.floor(s.length / 2)];
    }
  }

  get learning() { return this.baseline == null; }

  /** Target in the machine's own units, or null while still learning. */
  targetFor(segment) {
    if (this.baseline == null || !segment?.cadence) return null;
    return Math.round(this.baseline * (segment.cadence / BASELINE_REF));
  }

  /** 'faster' | 'ok' | 'slower' using a ±10 % band. */
  static feedback(cadence, target) {
    if (target == null || cadence == null) return null;
    if (cadence < target * 0.9) return 'faster';
    if (cadence > target * 1.1) return 'slower';
    return 'ok';
  }
}

/** Detects that the rider stopped (no movement for `stopAfterS`) and started again. */
export class MovementWatcher {
  constructor({ stopAfterS = 8 } = {}) {
    this.stopAfterMs = stopAfterS * 1000;
    this.seenMoving = false;
    this.lastMoveAt = null;
  }

  static isMoving(d) {
    return (d.cadence ?? 0) > 0 || (d.speedKmh ?? 0) > 0.3 || (d.powerW ?? 0) > 0;
  }

  /** Returns 'moving', 'stopped', or 'unknown' (machine never reported movement). */
  update(d, now) {
    if (MovementWatcher.isMoving(d)) {
      this.seenMoving = true;
      this.lastMoveAt = now;
      return 'moving';
    }
    if (!this.seenMoving) return 'unknown';
    return now - this.lastMoveAt >= this.stopAfterMs ? 'stopped' : 'moving';
  }
}
