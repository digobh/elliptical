import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveSession, loadSession, clearSession, MAX_AGE_MS } from '../src/workout/session.js';
import { WorkoutRecorder } from '../src/workout/recorder.js';
import { CIRCUITS } from '../src/workout/circuits.js';

test('session round-trip, expiry and clear', () => {
  const circuit = CIRCUITS[1];
  const rec = new WorkoutRecorder({ circuit, difficulty: 'advanced', machineKind: 'ifit' });
  for (let t = 0; t < 10; t++) rec.add(t, 5, { powerW: 80 });
  saveSession({ baseId: circuit.id, difficulty: 'advanced', circuit, ceiling: 12, elapsed: 754, recorder: rec.toJSON() }, 1000);
  const s = loadSession(2000);
  assert.equal(s.elapsed, 754);
  assert.equal(s.ceiling, 12);
  const back = WorkoutRecorder.fromJSON(JSON.parse(JSON.stringify(s.recorder)), circuit);
  assert.equal(back.samples.length, 10);
  assert.equal(back.summary().avgPowerW, 80);
  assert.equal(loadSession(1000 + MAX_AGE_MS + 1), null);
  clearSession();
  assert.equal(loadSession(2000), null);
});
