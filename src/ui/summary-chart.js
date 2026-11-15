// Summary chart: resistance level (filled steps) with watts and cadence lines.
// Each series is scaled to its own range; the left axis shows levels.

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

export function renderSummaryChart(svg, series, { maxLevel }) {
  svg.replaceChildren();
  // Draw in real pixels so text stays readable on a phone.
  const W = Math.max(280, Math.round(svg.getBoundingClientRect().width) || 600);
  const H = 180, padL = 22, padB = 16, padT = 6;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (series.length < 2) return;

  const t0 = series[0].t, t1 = series[series.length - 1].t || 1;
  const x = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - 4);
  const yFor = (max) => (v) => H - padB - (v / (max || 1)) * (H - padB - padT);

  // Levels: step area of the planned level.
  const yl = yFor(maxLevel);
  let d = `M ${x(t0)} ${H - padB}`;
  series.forEach((p, i) => {
    const lvl = p.planned ?? 0;
    if (i > 0) d += ` L ${x(p.t)} ${yl(series[i - 1].planned ?? 0)}`;
    d += ` L ${x(p.t)} ${yl(lvl)}`;
  });
  d += ` L ${x(t1)} ${H - padB} Z`;
  svg.append(el('path', { d, class: 'lvl' }));

  const line = (key, cls) => {
    const vals = series.map((p) => p[key]).filter((v) => v != null);
    if (!vals.length || Math.max(...vals) <= 0) return;
    const y = yFor(Math.max(...vals) * 1.1);
    const pts = series.filter((p) => p[key] != null).map((p) => `${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`);
    svg.append(el('polyline', { points: pts.join(' '), class: cls }));
  };
  line('powerW', 'pwr');
  line('cadence', 'cad');

  // Axes labels: levels on the left, minutes along the bottom.
  for (const lvl of [1, Math.round(maxLevel / 2), maxLevel]) {
    const t = el('text', { x: 2, y: yl(lvl) + 3, class: 'axis' });
    t.textContent = lvl;
    svg.append(t);
  }
  const mins = Math.floor((t1 - t0) / 60);
  const step = Math.max(1, Math.ceil(mins / 6));
  for (let m = 0; m <= mins; m += step) {
    const t = el('text', { x: x(t0 + m * 60) - 3, y: H - 3, class: 'axis' });
    t.textContent = `${m}′`;
    svg.append(t);
  }
}
