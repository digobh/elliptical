import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkoutEngine } from '../src/workout/engine.js';
import { CIRCUITS, pctToLevel, totalDuration } from '../src/workout/circuits.js';

function fakeMachine(range = { min: 1, max: 24, step: 1 }) {
  return { range, sent: [], setResistance(l) { this.sent.push(l); return Promise.resolve({ ok: true }); } };
}

function setup(circuit) {
  let t = 0;
  const m = fakeMachine();
  const e = new WorkoutEngine(m, { now: () => t });
  e.load(circuit);
  return { m, e, advance: (s) => { t += s * 1000; e.update(); } };
}

const tiny = {
  id: 't', name: 't',
  segments: [
    { label: 'A', duration: 10, pct: 0 },
    { label: 'B', duration: 10, pct: 50 },
    { label: 'C', duration: 10, pct: 100 },
  ],
};

test('pctToLevel maps onto any machine range', () => {
  assert.equal(pctToLevel(0, { min: 1, max: 24, step: 1 }), 1);
  assert.equal(pctToLevel(100, { min: 1, max: 24, step: 1 }), 24);
  assert.equal(pctToLevel(50, { min: 1, max: 22, step: 1 }), 12);
  assert.equal(pctToLevel(80, { min: 1, max: 24, step: 1 }, 1.5), 24); // scale clamps
});

test('engine sends resistance at each segment change', () => {
  const { m, e, advance } = setup(tiny);
  e.start();
  assert.deepEqual(m.sent, [1]);
  advance(9);
  assert.deepEqual(m.sent, [1]);
  advance(1.5);
  assert.deepEqual(m.sent, [1, 13]);
  advance(10);
  assert.deepEqual(m.sent, [1, 13, 24]);
  advance(20);
  assert.equal(e.state, 'finished');
});

test('pause freezes the clock; skip jumps to next segment', () => {
  const { m, e, advance } = setup(tiny);
  e.start();
  advance(5);
  e.pause();
  advance(100);
  assert.equal(e.elapsed, 5);
  e.start();
  e.skip();
  assert.equal(e.index, 1);
  assert.deepEqual(m.sent, [1, 13]);
});

test('nudge adjusts current level and resets on next segment', () => {
  const { m, e, advance } = setup(tiny);
  e.start();
  e.nudge(+2);
  assert.deepEqual(m.sent, [1, 3]);
  advance(11);
  assert.deepEqual(m.sent, [1, 3, 13]);
});

test('every built-in circuit is valid', () => {
  for (const c of CIRCUITS) {
    assert.ok(c.segments.length > 0, c.id);
    assert.ok(totalDuration(c) > 0, c.id);
    for (const s of c.segments) {
      assert.ok(s.duration > 0 && s.pct >= 0 && s.pct <= 100, `${c.id}/${s.label}`);
    }
  }
});

test('ceiling scales levels and can change mid-workout', () => {
  let t = 0;
  const m = { range: { min: 1, max: 16, step: 1 }, sent: [], setResistance(l) { this.sent.push(l); return Promise.resolve({ ok: true }); } };
  const e = new WorkoutEngine(m, { now: () => t });
  e.load({ id: 'x', name: 'x', segments: [{ label: 'A', duration: 10, pct: 50 }, { label: 'B', duration: 10, pct: 100 }] });
  e.setCeiling(10);
  e.start();
  assert.deepEqual(m.sent, [6]);           // 1 + 9 × 50 % = 5.5 → 6
  e.setCeiling(8);                          // too heavy: lower the max
  assert.deepEqual(m.sent, [6, 5]);         // re-applied immediately (1 + 7 × 50 % = 4.5 → 5)
  t += 11000; e.update();
  assert.deepEqual(m.sent, [6, 5, 8]);      // 100 % = the new ceiling
  assert.equal(e.setCeiling(99), 16);       // clamped to the machine
});

test('seek jumps to a time, applies that segment and keeps state sensible', () => {
  let t = 0;
  const m = fakeMachine();
  const e = new WorkoutEngine(m, { now: () => t });
  e.load(tiny);
  e.seek(25);                               // before starting: paused at 25 s
  assert.equal(e.state, 'paused');
  assert.equal(e.index, 2);
  assert.deepEqual(m.sent, [24]);
  e.start();
  t += 2000; e.update();
  assert.equal(Math.round(e.elapsed), 27);
  e.seek(3);                                // jump back while running
  assert.equal(e.state, 'running');
  assert.deepEqual(m.sent, [24, 1]);
  e.reapply();
  assert.deepEqual(m.sent, [24, 1, 1]);
});
