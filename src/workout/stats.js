// History statistics: day / week / month periods, totals, week bars, month
// calendar, streaks and personal records. Pure functions on the saved workout
// list (history.js). Weeks start on Monday; all dates are local time.

const DAY = 86400000;

export const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const startOfWeek = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const startOfMonth = (d) => { const x = startOfDay(d); x.setDate(1); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n, 1); return x; };

/** "Nov 16 – 22" / "Oct 26 – Nov 1" in the user's locale. */
export function rangeLabel(a, b) {
  const f = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' });
  if (dayKey(a) === dayKey(b)) return f.format(a);
  try { return f.formatRange(a, b); } catch { return `${f.format(a)} – ${f.format(b)}`; }
}

/** { start, end (exclusive), label } for 'day' | 'week' | 'month' around `anchor`. */
export function period(view, anchor) {
  if (view === 'day') {
    const start = startOfDay(anchor);
    return { start, end: addDays(start, 1), label: start.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) };
  }
  if (view === 'week') {
    const start = startOfWeek(anchor), end = addDays(start, 7);
    return { start, end, label: rangeLabel(start, addDays(start, 6)) };
  }
  const start = startOfMonth(anchor);
  return { start, end: addMonths(start, 1), label: start.toLocaleDateString([], { month: 'long', year: 'numeric' }) };
}

/** Move the anchor one period back (-1) or forward (+1). */
export function shift(view, anchor, dir) {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  return addMonths(anchor, dir);
}

export const inRange = (list, { start, end }) =>
  list.filter((w) => { const t = new Date(w.date).getTime(); return t >= start.getTime() && t < end.getTime(); });

/** Totals for a list of workouts. */
export function totals(list) {
  const sum = (k) => list.reduce((a, w) => a + (w[k] ?? 0), 0);
  const withPower = list.filter((w) => w.avgPowerW != null);
  const pace = list.filter((w) => w.cadenceZonePct != null);
  return {
    workouts: list.length,
    durationS: sum('durationS'),
    distanceM: sum('distanceM'),
    kcal: sum('kcal'),
    avgPowerW: withPower.length ? Math.round(withPower.reduce((a, w) => a + w.avgPowerW * w.durationS, 0) / Math.max(1, withPower.reduce((a, w) => a + w.durationS, 0))) : null,
    onPacePct: pace.length ? Math.round(pace.reduce((a, w) => a + w.cadenceZonePct, 0) / pace.length) : null,
    activeDays: new Set(list.map((w) => dayKey(w.date))).size,
  };
}

/**
 * The previous period to compare with. For a period still in progress, only the
 * same elapsed part of the previous one ("this month so far" vs "the same days
 * of last month"), so a half-finished month isn't compared with a full one.
 */
export function previousComparable(view, p, now = new Date()) {
  const prev = period(view, shift(view, p.start, -1));
  if (now >= p.end || now < p.start) return { ...prev, partial: false };
  const elapsed = startOfDay(now).getTime() + DAY - p.start.getTime();
  const end = new Date(Math.min(prev.end.getTime(), prev.start.getTime() + elapsed));
  return { start: prev.start, end, partial: true };
}

/** % change from `before` to `now` (null when there is nothing to compare). */
export const change = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);

/** Seven entries Mon..Sun with totals for the week starting at `weekStart`. */
export function weekDays(list, weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const start = addDays(weekStart, i);
    const day = inRange(list, { start, end: addDays(start, 1) });
    return { date: start, key: dayKey(start), ...totals(day) };
  });
}

/** Calendar grid for a month: weeks (Mon-first) of days, null for padding. */
export function monthCalendar(list, monthStart) {
  const first = startOfMonth(monthStart);
  const days = [];
  for (let d = first; d.getMonth() === first.getMonth(); d = addDays(d, 1)) {
    const day = inRange(list, { start: d, end: addDays(d, 1) });
    days.push({ date: d, key: dayKey(d), ...totals(day) });
  }
  const pad = (first.getDay() + 6) % 7;
  const cells = [...Array(pad).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Totals per calendar week overlapping the month (for the compact breakdown). */
export function monthWeeks(list, monthStart) {
  const { start, end } = period('month', monthStart);
  const out = [];
  for (let w = startOfWeek(start); w < end; w = addDays(w, 7)) {
    const s = w < start ? start : w;
    const e = addDays(w, 7) > end ? end : addDays(w, 7);
    out.push({ start: s, end: addDays(e, -1), ...totals(inRange(list, { start: s, end: e })) });
  }
  return out;
}

/** Consecutive days with at least one workout: current (ending today or yesterday) and best. */
export function streaks(list, today = new Date()) {
  const days = new Set(list.map((w) => dayKey(w.date)));
  let best = 0, run = 0, prev = null;
  for (const k of [...days].sort()) {
    const t = new Date(`${k}T12:00:00`).getTime();
    run = prev != null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  let current = 0;
  let d = startOfDay(today);
  if (!days.has(dayKey(d))) d = addDays(d, -1); // today not done yet: streak still alive
  while (days.has(dayKey(d))) { current++; d = addDays(d, -1); }
  return { current, best };
}

/** Personal records across all workouts. */
export function records(list) {
  const top = (k) => list.reduce((b, w) => ((w[k] ?? -1) > (b?.[k] ?? -1) ? w : b), null);
  return {
    longest: top('durationS'),
    mostKcal: top('kcal'),
    farthest: top('distanceM'),
    bestPower: top('avgPowerW'),
  };
}
