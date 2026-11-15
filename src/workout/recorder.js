// Records one sample per second during a workout and turns them into a summary.
// Pure logic (no DOM) so it is unit-tested; history storage is in history.js.

export class WorkoutRecorder {
  constructor({ circuit, difficulty, machineKind }) {
    this.meta = { circuit: circuit.name, circuitId: circuit.id, difficulty, machineKind };
    this.samples = [];
    this.startedAt = null;
  }

  /**
   * One sample. `t` = workout elapsed seconds; `planned` = level the app set;
   * `data` = latest machine data (speedKmh, cadence, powerW, resistance, …).
   */
  add(t, planned, data, { targetCadence = null, moving = true } = {}) {
    this.startedAt ??= Date.now();
    this.samples.push({
      t,
      planned,
      level: data.resistance ?? null,
      powerW: data.powerW ?? null,
      cadence: data.cadence ?? null,
      speedKmh: data.speedKmh ?? null,
      heartRate: data.heartRate || null,
      distanceM: data.distanceM ?? null,
      kcal: data.kcal ?? null,
      targetCadence,
      moving,
    });
  }

  summary({ total } = {}) {
    const s = this.samples;
    const vals = (k, onlyMoving = true) => s.filter((x) => x[k] != null && (!onlyMoving || x.moving)).map((x) => x[k]);
    const avg = (a) => (a.length ? a.reduce((p, c) => p + c, 0) / a.length : null);
    const max = (a) => (a.length ? Math.max(...a) : null);
    const span = (k) => {
      const a = vals(k, false);
      return a.length >= 2 ? Math.max(0, a[a.length - 1] - a[0]) : null;
    };

    const duration = s.length ? s[s.length - 1].t - s[0].t : 0;
    const power = vals('powerW');
    const speed = vals('speedKmh');

    // Distance: machine odometer if it moved, else integrate speed.
    let distanceM = span('distanceM');
    if (!distanceM) {
      distanceM = 0;
      for (let i = 1; i < s.length; i++) distanceM += ((s[i].speedKmh ?? 0) / 3.6) * (s[i].t - s[i - 1].t);
    }
    // Calories: machine counter if available, else from work done (≈24 % efficiency).
    let kcal = span('kcal');
    let kcalEstimated = false;
    if (!kcal) {
      let joules = 0;
      for (let i = 1; i < s.length; i++) joules += (s[i].powerW ?? 0) * (s[i].t - s[i - 1].t);
      kcal = joules / 4184 / 0.24;
      kcalEstimated = true;
    }

    // Time in cadence zone (±10 % of target), over samples that had a target.
    const withTarget = s.filter((x) => x.moving && x.targetCadence && x.cadence != null);
    const inZone = withTarget.filter((x) => Math.abs(x.cadence - x.targetCadence) <= x.targetCadence * 0.1);

    return {
      ...this.meta,
      date: new Date(this.startedAt ?? Date.now()).toISOString(),
      durationS: Math.round(duration),
      plannedS: total ?? null,
      completion: total ? Math.min(1, duration / total) : null,
      distanceM: Math.round(distanceM),
      kcal: Math.round(kcal),
      kcalEstimated,
      avgPowerW: avg(power) != null ? Math.round(avg(power)) : null,
      maxPowerW: max(power),
      avgCadence: avg(vals('cadence')) != null ? Math.round(avg(vals('cadence'))) : null,
      avgSpeedKmh: avg(speed) != null ? Math.round(avg(speed) * 10) / 10 : null,
      avgLevel: avg(vals('planned', false)) != null ? Math.round(avg(vals('planned', false)) * 10) / 10 : null,
      maxLevel: max(vals('planned', false)),
      avgHeartRate: avg(vals('heartRate')) != null ? Math.round(avg(vals('heartRate'))) : null,
      cadenceZonePct: withTarget.length ? Math.round((inZone.length / withTarget.length) * 100) : null,
    };
  }

  /** Down-sampled series for the summary chart (≤ 300 points). */
  series() {
    const step = Math.max(1, Math.ceil(this.samples.length / 300));
    return this.samples.filter((_, i) => i % step === 0)
      .map(({ t, planned, level, powerW, cadence }) => ({ t, planned, level, powerW, cadence }));
  }
}
