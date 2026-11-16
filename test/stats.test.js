import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  previousComparable, rangeLabel, period, shift, inRange, totals, change, weekDays, monthCalendar, monthWeeks, streaks, records, dayKey,
} from '../src/workout/stats.js';

const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h, 0).toISOString();
const w = (date, durationS, kcal, distanceM, extra = {}) => ({ date, durationS, kcal, distanceM, ...extra });

// Mon 9 Nov – Sun 22 Nov 2026 (16 Nov 2026 is a Monday)
const list = [
  w(at(2026, 11, 9), 1200, 150, 3000, { avgPowerW: 100, cadenceZonePct: 80 }),
  w(at(2026, 11, 11), 1800, 220, 4500, { avgPowerW: 120 }),
  w(at(2026, 11, 16, 7), 600, 60, 1500),
  w(at(2026, 11, 16, 19), 1500, 200, 4000, { avgPowerW: 140, cadenceZonePct: 90 }),
  w(at(2026, 11, 17), 1320, 180, 3600),
  w(at(2026, 11, 30), 900, 100, 2500),
];

test('periods start on Monday and shift correctly', () => {
  const wk = period('week', new Date(2026, 10, 18));         // a Wednesday
  assert.equal(dayKey(wk.start), '2026-11-16');
  assert.equal(dayKey(wk.end), '2026-11-23');
  assert.equal(dayKey(shift('week', wk.start, -1)), '2026-11-09');
  const mo = period('month', new Date(2026, 10, 18));
  assert.equal(dayKey(mo.start), '2026-11-01');
  assert.equal(dayKey(mo.end), '2026-12-01');
  assert.equal(dayKey(shift('month', mo.start, 1)), '2026-12-01');
  assert.equal(dayKey(shift('day', new Date(2026, 10, 30), 1)), '2026-12-01');
});

test('totals, week bars and week-over-week change', () => {
  const thisWeek = inRange(list, period('week', new Date(2026, 10, 16)));
  const lastWeek = inRange(list, period('week', new Date(2026, 10, 9)));
  const t = totals(thisWeek);
  assert.deepEqual([t.workouts, t.durationS, t.kcal, t.distanceM, t.activeDays], [3, 3420, 440, 9100, 2]);
  assert.equal(t.avgPowerW, 140);                              // only one workout reported watts
  assert.equal(change(t.kcal, totals(lastWeek).kcal), 19);     // 440 vs 370
  const bars = weekDays(list, period('week', new Date(2026, 10, 16)).start);
  assert.deepEqual(bars.map((d) => d.kcal), [260, 180, 0, 0, 0, 0, 0]);
});

test('month calendar and weekly breakdown', () => {
  const cal = monthCalendar(list, new Date(2026, 10, 1));
  assert.equal(cal[0].findIndex(Boolean), 6);                  // 1 Nov 2026 is a Sunday
  assert.equal(cal.flat().filter(Boolean).length, 30);
  assert.equal(cal.flat().find((c) => c?.key === '2026-11-16').workouts, 2);
  const weeks = monthWeeks(list, new Date(2026, 10, 1));
  assert.equal(weeks.length, 6);                               // 1 | 2–8 | 9–15 | 16–22 | 23–29 | 30
  assert.deepEqual(weeks.map((x) => x.kcal), [0, 0, 370, 440, 0, 100]);
});

test('streaks and records', () => {
  assert.deepEqual(streaks(list, new Date(2026, 10, 17, 20)), { current: 2, best: 2 });
  assert.deepEqual(streaks(list, new Date(2026, 10, 18, 9)), { current: 2, best: 2 });  // today not done yet
  assert.equal(streaks(list, new Date(2026, 10, 20)).current, 0);
  const r = records(list);
  assert.equal(r.longest.durationS, 1800);
  assert.equal(r.mostKcal.kcal, 220);
  assert.equal(r.bestPower.avgPowerW, 140);
});

test('in-progress periods compare like for like', () => {
  const p = period('month', new Date(2026, 10, 18));
  const cmp = previousComparable('month', p, new Date(2026, 10, 18, 20));
  assert.equal(cmp.partial, true);
  assert.equal(dayKey(cmp.start), '2026-10-01');
  assert.equal(dayKey(cmp.end), '2026-10-19');                  // Oct 1–18 vs Nov 1–18
  const done = previousComparable('month', period('month', new Date(2026, 9, 5)), new Date(2026, 10, 18));
  assert.equal(done.partial, false);
  assert.equal(dayKey(done.end), '2026-10-01');                 // September in full
});

test('range labels', () => {
  assert.equal(rangeLabel(new Date(2026, 10, 1), new Date(2026, 10, 1)).replace(/\s/g, ' '), 'Nov 1');
  assert.match(rangeLabel(new Date(2026, 10, 16), new Date(2026, 10, 22)), /Nov 16\s*–\s*22/);
});
