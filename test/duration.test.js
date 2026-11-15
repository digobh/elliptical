import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDuration, durationLimits } from '../src/workout/duration.js';
import { applyDifficulty } from '../src/workout/difficulty.js';
import { CIRCUITS, totalDuration } from '../src/workout/circuits.js';

test('suggested time leaves the circuit untouched', () => {
  const c = CIRCUITS[1];
  assert.equal(applyDuration(c, totalDuration(c)), c);
  assert.equal(applyDuration(c, null), c);
});

test('every circuit × difficulty hits a chosen time exactly and keeps its shape', () => {
  for (const base of CIRCUITS) {
    for (const k of ['beginner', 'intermediate', 'advanced']) {
      const c = applyDifficulty(base, k);
      const { min, max } = durationLimits(totalDuration(c));
      for (const minutes of [min, Math.round((min + max) / 2), max]) {
        const out = applyDuration(c, minutes * 60);
        assert.equal(totalDuration(out), minutes * 60, `${base.id}/${k}/${minutes}`);
        assert.equal(out.segments.length, c.segments.length);
        assert.ok(out.segments.every((s, i) => s.duration >= 5 && s.pct === c.segments[i].pct));
      }
    }
  }
});

test('a 22-minute circuit stretched to 33 minutes scales segments ~1.5×', () => {
  const hills = CIRCUITS.find((c) => c.id === 'rolling-hills');
  const out = applyDuration(hills, 33 * 60);
  assert.equal(out.segments[0].duration, 270);   // 3-min warm-up → 4:30
  assert.equal(totalDuration(out), 1980);
});
