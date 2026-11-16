import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Deck, CoachTalk, isHard } from '../src/workout/talk.js';
import { CLIPS } from '../tools/voice-script.mjs';

// Deterministic random numbers.
const rngFrom = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('deck: every item before repeats, never the same twice in a row', () => {
  const d = new Deck(['a', 'b', 'c', 'd'], rngFrom(7));
  const seq = Array.from({ length: 40 }, () => d.next());
  for (let i = 0; i < 40; i += 4) assert.deepEqual([...seq.slice(i, i + 4)].sort(), ['a', 'b', 'c', 'd']);
  for (let i = 1; i < 40; i++) assert.notEqual(seq[i], seq[i - 1]);
});

/** Ride a whole workout second by second and collect what the coach says. */
function ride(segments, feedbackAt = () => 'ok') {
  const talk = new CoachTalk({ rng: rngFrom(3) });
  const total = segments.reduce((a, s) => a + s.duration, 0);
  const said = [];
  let start = 0;
  segments.forEach((seg, index) => {
    talk.spoke(start); // segment announcement
    for (let e = 0; e < seg.duration; e++) {
      const t = start + e;
      const out = talk.tick({ t, total, index, seg, segElapsed: e, segRemaining: seg.duration - e,
        isLast: index === segments.length - 1, feedback: feedbackAt(t, seg), moving: true });
      if (out) said.push({ t, out });
    }
    start += seg.duration;
  });
  return said;
}

const workout = [
  { label: 'Warm-up', kind: 'warmup', pct: 15, duration: 120 },
  { label: 'Climb', kind: 'work', pct: 45, duration: 180 },
  { label: 'Sprint', kind: 'work', pct: 80, duration: 60 },
  { label: 'Recover', kind: 'recover', pct: 20, duration: 120 },
  { label: 'Cool-down', kind: 'cooldown', pct: 10, duration: 120 },
];

test('chatty but never stepping on itself; milestones once', () => {
  const said = ride(workout);
  const flat = said.flatMap((x) => x.out);
  const motivation = flat.filter((x) => x.startsWith('motivate'));
  assert.ok(motivation.length >= 5 && motivation.length <= 9, `motivation lines: ${motivation.length}`);
  assert.equal(flat.filter((x) => x === 'halfway-workout').length, 1);
  assert.equal(flat.filter((x) => x === 'one-minute').length, 1);
  assert.equal(flat.filter((x) => x === 'ten-seconds').length, 1);   // the 60 s sprint
  assert.equal(flat.filter((x) => x.startsWith('boost')).length, 1);
  // every id is a real clip
  for (const id of flat) assert.ok(id in CLIPS, id);
  // at least 6 s between ordinary lines
  const ordinary = said.filter((x) => !['ten-seconds', 'one-minute'].includes(x.out[0]));
  for (let i = 1; i < ordinary.length; i++) assert.ok(ordinary[i].t - ordinary[i - 1].t >= 6);
});

test('pace: behind → nudge after 8 s, then "back on track" once recovered', () => {
  // too slow between 200 and 230 s (in the Climb), on pace otherwise
  const said = ride(workout, (t) => (t >= 200 && t < 230 ? 'faster' : 'ok'));
  const behind = said.find((x) => x.out[0].startsWith('behind'));
  const back = said.find((x) => x.out[0].startsWith('ontrack'));
  assert.ok(behind && behind.t >= 207 && behind.t < 215, `behind at ${behind?.t}`);
  assert.ok(back && back.t >= 233 && back.t < 245, `back on track at ${back?.t}`);
});

test('no pace nagging in warm-up', () => {
  const said = ride(workout, (t) => (t < 120 ? 'faster' : 'ok'));
  assert.equal(said.filter((x) => x.t < 120 && x.out[0].startsWith('behind')).length, 0);
});

test('hard segment detection', () => {
  assert.equal(isHard({ label: 'Sprint', kind: 'work', pct: 50 }), true);
  assert.equal(isHard({ label: 'Step 3', kind: 'work', pct: 75 }), true);
  assert.equal(isHard({ label: 'Recover', kind: 'recover', pct: 80 }), false);
});
