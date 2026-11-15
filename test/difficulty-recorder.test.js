import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDifficulty, DIFFICULTY_KEYS } from '../src/workout/difficulty.js';
import { WorkoutRecorder } from '../src/workout/recorder.js';
import { CIRCUITS, totalDuration } from '../src/workout/circuits.js';

const hiit = CIRCUITS.find((c) => c.id === 'hiit-30-30');

test('intermediate is the circuit unchanged', () => {
  const c = applyDifficulty(hiit, 'intermediate');
  assert.deepEqual(c.segments.map((s) => [s.pct, s.duration]), hiit.segments.map((s) => [s.pct, s.duration]));
  assert.equal(c.difficulty, 'intermediate');
});

test('beginner is easier and shorter, advanced harder and longer', () => {
  const b = applyDifficulty(hiit, 'beginner');
  const a = applyDifficulty(hiit, 'advanced');
  const sprint = (c) => c.segments.find((s) => s.label === 'Sprint');
  assert.ok(sprint(b).pct < sprint(hiit).pct && sprint(hiit).pct < sprint(a).pct);
  assert.ok(sprint(b).duration < 30 && sprint(a).duration > 30);
  assert.ok(totalDuration(b) < totalDuration(hiit));
  assert.ok(totalDuration(a) > totalDuration(hiit));
  // warm-up length is unchanged
  assert.equal(b.segments[0].duration, hiit.segments[0].duration);
});

test('every circuit × difficulty stays valid', () => {
  for (const c of CIRCUITS) {
    for (const k of DIFFICULTY_KEYS) {
      for (const s of applyDifficulty(c, k).segments) {
        assert.ok(s.pct >= 0 && s.pct <= 100 && s.duration >= 5 && s.duration % 5 === 0, `${c.id}/${k}/${s.label}`);
      }
    }
  }
});

test('recorder summary: distance, kcal, power, cadence zone', () => {
  const r = new WorkoutRecorder({ circuit: hiit, difficulty: 'beginner', machineKind: 'sim' });
  for (let t = 0; t <= 60; t++) {
    r.add(t, t < 30 ? 3 : 8, { powerW: 100, cadence: t < 30 ? 120 : 90, speedKmh: 12 }, { targetCadence: 120 });
  }
  const s = r.summary({ total: 120 });
  assert.equal(s.durationS, 60);
  assert.equal(s.completion, 0.5);
  assert.equal(s.distanceM, 200);           // 12 km/h for 60 s
  assert.equal(s.kcal, 6);                  // 6000 J / 4184 / 0.24 ≈ 5.98
  assert.equal(s.kcalEstimated, true);
  assert.equal(s.avgPowerW, 100);
  assert.equal(s.maxLevel, 8);
  assert.equal(s.cadenceZonePct, 49);       // 30 of 61 samples on target
  assert.ok(r.series().length > 0);
});

test('recorder uses machine odometer and calorie counter when present', () => {
  const r = new WorkoutRecorder({ circuit: hiit, difficulty: 'intermediate', machineKind: 'ifit' });
  r.add(0, 5, { distanceM: 1000, kcal: 50 });
  r.add(10, 5, { distanceM: 1040, kcal: 52 });
  const s = r.summary();
  assert.equal(s.distanceM, 40);
  assert.equal(s.kcal, 2);
  assert.equal(s.kcalEstimated, false);
});
