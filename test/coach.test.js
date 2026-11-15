import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CadenceCoach, MovementWatcher } from '../src/workout/coach.js';

test('coach learns the rider baseline and scales targets', () => {
  const c = new CadenceCoach({ learnSeconds: 5 });
  assert.equal(c.targetFor({ cadence: 150 }), null);
  [34, 36, 0, 35, 33, 37].forEach((x) => c.learn(x));   // zero is ignored
  assert.equal(c.baseline, 35);
  assert.equal(c.targetFor({ cadence: 120 }), 35);
  assert.equal(c.targetFor({ cadence: 150 }), 44);
  assert.equal(CadenceCoach.feedback(30, 35), 'faster');
  assert.equal(CadenceCoach.feedback(36, 35), 'ok');
  assert.equal(CadenceCoach.feedback(40, 35), 'slower');
});

test('auto-pause only after real movement was seen', () => {
  const w = new MovementWatcher({ stopAfterS: 8 });
  assert.equal(w.update({ cadence: 0 }, 0), 'unknown');
  assert.equal(w.update({ cadence: 0 }, 60000), 'unknown');   // never moved: never pauses
  assert.equal(w.update({ powerW: 50 }, 61000), 'moving');
  assert.equal(w.update({ powerW: 0 }, 65000), 'moving');
  assert.equal(w.update({ powerW: 0 }, 69000), 'stopped');
  assert.equal(w.update({ speedKmh: 5 }, 70000), 'moving');
});
