// History page: Day / Week / Month views of saved workouts.
import {
  period, shift, inRange, totals, change, weekDays, monthCalendar, monthWeeks, streaks, records, dayKey, startOfDay,
  previousComparable, rangeLabel,
} from '../workout/stats.js?v=30';
import { renderSummaryChart } from './summary-chart.js?v=30';

const fmtTime = (s) => {
  s = Math.round(s ?? 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s % 60).padStart(2, '0')}`;
};
/** Totals: "58 min", "1h 05m". */
const fmtDur = (s) => {
  const m = Math.round((s ?? 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
};
const fmtKm = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m ?? 0)} m`);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const delta = (pct) => (pct == null ? '' : pct > 0 ? `▲ ${pct}%` : pct < 0 ? `▼ ${-pct}%` : '= same');

function tiles(items) {
  const grid = el('div', 'metrics h-tiles');
  for (const [k, v, sub, cls] of items) {
    const t = el('div', 'metric');
    t.append(el('span', 'v', v), el('span', 'k', k));
    if (sub) t.append(el('span', `delta ${cls ?? ''}`, sub));
    grid.append(t);
  }
  return grid;
}

export class HistoryView {
  /**
   * opts: { root, labels: { difficulty: key → label }, onOpen(workout) }
   */
  constructor({ root, difficultyLabel, onOpen }) {
    this.root = root;
    this.difficultyLabel = difficultyLabel;
    this.onOpen = onOpen;
    this.view = 'week';
    this.anchor = new Date();
    root.querySelector('#h-prev').onclick = () => { this.anchor = shift(this.view, this.anchor, -1); this.render(); };
    root.querySelector('#h-next').onclick = () => { this.anchor = shift(this.view, this.anchor, 1); this.render(); };
    root.querySelector('#h-today').onclick = () => { this.anchor = new Date(); this.render(); };
  }

  show(list) { this.list = list; this.render(); }

  goto(view, date) { this.view = view; this.anchor = date; this.render(); }

  render() {
    const list = this.list ?? [];
    const tabs = this.root.querySelector('#h-tabs');
    tabs.replaceChildren(...['day', 'week', 'month'].map((v) => {
      const b = el('button', v === this.view ? 'on' : '', v[0].toUpperCase() + v.slice(1));
      b.type = 'button';
      b.onclick = () => { this.view = v; this.render(); };
      return b;
    }));
    const p = period(this.view, this.anchor);
    this.root.querySelector('#h-label').textContent = p.label;
    this.root.querySelector('#h-next').disabled = p.end > new Date();
    const body = this.root.querySelector('#h-body');
    body.replaceChildren();
    if (!list.length) {
      body.append(el('p', 'muted', 'No workouts yet. Finish a circuit and it will show up here.'));
      return;
    }
    const items = inRange(list, p).sort((a, b) => new Date(a.date) - new Date(b.date));
    if (this.view === 'day') this.renderDay(body, items);
    if (this.view === 'week') this.renderWeek(body, items, p);
    if (this.view === 'month') this.renderMonth(body, items, p);
    this.renderHighlights(body, list);
  }

  // ---- Day: every workout in detail
  renderDay(body, items) {
    const t = totals(items);
    body.append(tiles([
      ['Workouts', t.workouts], ['Time', fmtDur(t.durationS)], ['kcal', t.kcal], ['Distance', fmtKm(t.distanceM)],
    ]));
    if (!items.length) { body.append(el('p', 'muted h-empty', 'Rest day – no workouts.')); return; }
    for (const w of items) {
      const card = el('div', 'card h-workout');
      const head = el('div', 'h-wtitle');
      head.append(el('strong', '', w.circuit), el('span', 'muted small',
        `${this.difficultyLabel(w.difficulty)} · ${new Date(w.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` +
        `${w.completion != null && w.completion < 0.99 ? ` · ${Math.round(w.completion * 100)}% done` : ''}`));
      card.append(head, tiles([
        ['Time', fmtTime(w.durationS)], ['Distance', fmtKm(w.distanceM)], [w.kcalEstimated ? 'kcal (est.)' : 'kcal', w.kcal],
        ['Avg watts', w.avgPowerW ?? '–'], ['Avg level', w.avgLevel ?? '–'], ['On pace', w.cadenceZonePct != null ? `${w.cadenceZonePct}%` : '–'],
      ]));
      if (w.series?.length > 1) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'summary-chart h-mini');
        card.append(svg);
        requestAnimationFrame(() => renderSummaryChart(svg, w.series, { maxLevel: w.maxMachineLevel ?? 16 }));
      }
      const open = el('button', 'btn small-btn', 'Open summary →');
      open.onclick = () => this.onOpen(w);
      card.append(open);
      body.append(card);
    }
  }

  // ---- Week: totals vs last week, Mon–Sun bars, compact rows
  renderWeek(body, items, p) {
    const t = totals(items);
    const cmp = previousComparable('week', p);
    const prev = totals(inRange(this.list, cmp));
    const dk = change(t.kcal, prev.kcal), dd = change(t.distanceM, prev.distanceM);
    body.append(tiles([
      ['kcal', t.kcal, delta(dk), dk > 0 ? 'up' : dk < 0 ? 'down' : ''],
      ['Distance', fmtKm(t.distanceM), delta(dd), dd > 0 ? 'up' : dd < 0 ? 'down' : ''],
      ['Time', fmtDur(t.durationS)],
      ['Workouts', t.workouts, `${t.activeDays} active day${t.activeDays === 1 ? '' : 's'}`],
    ]));
    body.append(el('div', 'muted small h-vs', cmp.partial ? 'Compared with the same days last week' : 'Compared with the previous week'));

    const days = weekDays(this.list, p.start);
    const max = Math.max(1, ...days.map((d) => d.kcal));
    const chart = el('div', 'card h-bars');
    const today = dayKey(new Date());
    for (const d of days) {
      const col = el('button', `h-bar${d.key === today ? ' today' : ''}`);
      col.type = 'button';
      const bar = el('div', 'fill');
      bar.style.height = `${Math.max(d.kcal ? 6 : 2, (d.kcal / max) * 100)}%`;
      col.append(el('span', 'val small', d.kcal ? d.kcal : ''), el('div', 'track'), el('span', 'lbl small', d.date.toLocaleDateString([], { weekday: 'narrow' })));
      col.querySelector('.track').append(bar);
      col.title = `${d.date.toLocaleDateString()} – ${d.kcal} kcal, ${fmtKm(d.distanceM)}`;
      col.onclick = () => this.goto('day', d.date);
      chart.append(col);
    }
    body.append(el('div', 'muted small h-caption', 'kcal per day – tap a day for details'), chart);
    this.rows(body, items);
  }

  // ---- Month: totals, calendar heatmap, weekly breakdown, best day
  renderMonth(body, items, p) {
    const t = totals(items);
    const cmp = previousComparable('month', p);
    const prev = totals(inRange(this.list, cmp));
    const dk = change(t.kcal, prev.kcal), dd = change(t.distanceM, prev.distanceM);
    body.append(tiles([
      ['kcal', t.kcal, delta(dk), dk > 0 ? 'up' : dk < 0 ? 'down' : ''],
      ['Distance', fmtKm(t.distanceM), delta(dd), dd > 0 ? 'up' : dd < 0 ? 'down' : ''],
      ['Time', fmtDur(t.durationS)],
      ['Active days', t.activeDays, `${t.workouts} workout${t.workouts === 1 ? '' : 's'}`],
    ]));
    body.append(el('div', 'muted small h-vs', cmp.partial ? 'Compared with the same days last month' : 'Compared with the previous month'));

    const cal = el('div', 'card h-cal');
    for (const d of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) cal.append(el('div', 'h-dow small muted', d));
    const today = dayKey(new Date());
    for (const week of monthCalendar(this.list, p.start)) {
      for (const d of week) {
        if (!d) { cal.append(el('div', 'h-day pad')); continue; }
        const mins = d.durationS / 60;
        const lvl = !d.workouts ? 0 : mins < 15 ? 1 : mins < 30 ? 2 : mins < 45 ? 3 : 4;
        const cell = el('button', `h-day h${lvl}${d.key === today ? ' today' : ''}`, String(d.date.getDate()));
        cell.type = 'button';
        cell.title = d.workouts ? `${d.workouts} workout(s) · ${Math.round(mins)} min · ${d.kcal} kcal` : 'Rest day';
        cell.onclick = () => this.goto('day', d.date);
        cal.append(cell);
      }
    }
    body.append(el('div', 'muted small h-caption', 'Minutes per day – tap a day for details'), cal,
      el('div', 'h-legend small muted', 'less ▢▢▢▢ more'));
    body.querySelector('.h-legend').innerHTML = 'less <i class="h1"></i><i class="h2"></i><i class="h3"></i><i class="h4"></i> more';

    const wk = el('div', 'card h-weeks');
    wk.append(el('h3', '', 'By week'));
    for (const x of monthWeeks(this.list, p.start)) {
      const row = el('button', 'h-row');
      row.type = 'button';
      const range = rangeLabel(x.start, x.end);
      row.append(el('span', '', range), el('span', 'muted small', x.workouts ? `${x.workouts}× · ${x.kcal} kcal · ${fmtKm(x.distanceM)}` : '–'));
      row.onclick = () => this.goto('week', x.start);
      wk.append(row);
    }
    body.append(wk);

    const best = monthCalendar(this.list, p.start).flat().filter(Boolean).reduce((b, d) => (d.kcal > (b?.kcal ?? 0) ? d : b), null);
    if (best) body.append(el('p', 'muted small', `Best day: ${best.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} – ${best.kcal} kcal, ${fmtKm(best.distanceM)}.`));
  }

  /** Compact one-line rows (week view). */
  rows(body, items) {
    if (!items.length) { body.append(el('p', 'muted h-empty', 'No workouts this week.')); return; }
    const box = el('div', 'card h-list');
    for (const w of [...items].reverse()) {
      const row = el('button', 'h-row');
      row.type = 'button';
      const left = el('span');
      left.append(el('strong', '', w.circuit), el('span', 'muted small', ` · ${new Date(w.date).toLocaleDateString([], { weekday: 'short' })} ${new Date(w.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));
      row.append(left, el('span', 'muted small', `${fmtTime(w.durationS)} · ${w.kcal} kcal · ${fmtKm(w.distanceM)}`));
      row.onclick = () => this.onOpen(w);
      box.append(row);
    }
    body.append(box);
  }

  // ---- Streak + personal records (all views)
  renderHighlights(body, list) {
    const s = streaks(list);
    const r = records(list);
    const card = el('div', 'card h-high');
    card.append(el('h3', '', 'Highlights'));
    const line = (label, value, w) => {
      const row = el(w ? 'button' : 'div', 'h-row');
      if (w) { row.type = 'button'; row.onclick = () => this.onOpen(w); }
      row.append(el('span', '', label), el('span', 'muted small', value));
      card.append(row);
    };
    line('🔥 Current streak', `${s.current} day${s.current === 1 ? '' : 's'} (best ${s.best})`);
    if (r.longest) line('⏱ Longest workout', `${fmtTime(r.longest.durationS)} · ${r.longest.circuit}`, r.longest);
    if (r.mostKcal) line('🔥 Most kcal', `${r.mostKcal.kcal} kcal · ${new Date(r.mostKcal.date).toLocaleDateString()}`, r.mostKcal);
    if (r.farthest) line('📏 Farthest', `${fmtKm(r.farthest.distanceM)} · ${new Date(r.farthest.date).toLocaleDateString()}`, r.farthest);
    if (r.bestPower?.avgPowerW) line('⚡ Best avg watts', `${r.bestPower.avgPowerW} W · ${r.bestPower.circuit}`, r.bestPower);
    body.append(card);
  }
}

export { startOfDay };
