import { FtmsMachine } from './ble/ftms-device.js?v=16';
import { pickAndConnect } from './ble/connect.js?v=16';
import { SimulatedMachine } from './ble/simulator.js?v=16';
import { inspectDevice } from './ble/inspector.js?v=16';
import { describeError } from './errors.js?v=16';
import { CIRCUITS, totalDuration, pctToLevel } from './workout/circuits.js?v=16';
import { WorkoutEngine } from './workout/engine.js?v=16';
import { renderProfile } from './ui/profile-chart.js?v=16';
import { renderSummaryChart } from './ui/summary-chart.js?v=16';
import { DIFFICULTIES, DIFFICULTY_KEYS, applyDifficulty } from './workout/difficulty.js?v=16';
import { WorkoutRecorder } from './workout/recorder.js?v=16';
import { CadenceCoach, MovementWatcher } from './workout/coach.js?v=16';
import { loadHistory, saveWorkout } from './workout/history.js?v=16';

const $ = (id) => document.getElementById(id);
const fmt = (s) => {
  s = Math.max(0, Math.ceil(s));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Telemetry bus – the hook for the future 3D world.
 * 'telemetry' detail: { speedKmh, cadence, powerW, resistance, heartRate, … }
 * 'workout'   detail: { state, segment, level, elapsed, total }
 */
export const bus = new EventTarget();
window.ellipticalBus = bus;

let machine = null;
let engine = null;
let chart = null;
let ticker = null;
let wakeLock = null;

// ---------- Logging ----------
$('btn-copy-log').onclick = async () => {
  try { await navigator.clipboard.writeText($('log').textContent); $('btn-copy-log').textContent = 'Copied ✓'; }
  catch { const r = document.createRange(); r.selectNodeContents($('log')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
};
function log(msg) {
  const t = new Date().toLocaleTimeString();
  $('log').textContent = `[${t}] ${msg}\n` + $('log').textContent;
}

// ---------- Connection ----------
if (!FtmsMachine.isSupported()) {
  $('ble-warning').hidden = false;
  $('ble-warning').textContent =
    'This browser has no Web Bluetooth. Use Chrome or Edge on Android / Windows / macOS, or the Bluefy browser on iPhone/iPad. The simulator works everywhere.';
  $('btn-ble').disabled = true;
  $('btn-inspect').disabled = true;
}

async function runInspector(mode) {
  const pre = $('inspect-out');
  pre.hidden = false;
  pre.textContent = 'Pick your machine in the browser dialog…\n';
  let report = '';
  const add = (line) => { report += line + '\n'; pre.textContent += line + '\n'; };
  try {
    await inspectDevice(add, { mode });
  } catch (e) {
    add(`Error: ${describeError(e)}`);
    add(`Browser: ${navigator.userAgent}`);
    add('Tip: pick another Search option and try again. Make sure the machine is on and not connected to iFit,');
    add('and that Bluefy is allowed to use Bluetooth (iOS Settings → Bluefy → Bluetooth).');
  }
  $('btn-copy-report').hidden = false;
  $('btn-copy-report').onclick = () => copyText(report);
}
$('btn-inspect').onclick = () => runInspector($('inspect-mode').value);

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    $('btn-copy-report').textContent = 'Copied ✓';
  } catch {
    // Clipboard API blocked: select the text so the user can copy manually.
    const r = document.createRange();
    r.selectNodeContents($('inspect-out'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    $('btn-copy-report').textContent = 'Selected – tap Copy';
  }
}

/** `connected`: the machine is already connected (and logging) via pickAndConnect. */
async function useMachine(m, { connected = false } = {}) {
  if (!connected) m.addEventListener('log', (e) => log(e.detail));
  m.addEventListener('data', (e) => onData(e.detail));
  m.addEventListener('disconnect', () => {
    setStatus('Disconnected', 'pill-off');
    if (engine?.state === 'running') engine.pause();
  });
  if (!connected) await m.connect();
  machine = m;
  setStatus(m.kind === 'sim' ? 'Simulator' : `Connected: ${m.name}`, m.kind === 'sim' ? 'pill-sim' : 'pill-on');
  $('connect').hidden = true;
  $('picker').hidden = false;
  $('sim-panel').hidden = m.kind !== 'sim';
  $('calib').hidden = m.kind !== 'ifit';
  renderPicker();
}

$('btn-ble').onclick = async () => {
  const btn = $('btn-ble');
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  $('log-wrap').open = true;
  try {
    const m = await pickAndConnect({
      encoding: $('encoding').value,
      rawLog: $('raw-log').checked,
      onLog: log,
    });
    await useMachine(m, { connected: true });
  } catch (e) {
    log(`Bluetooth error: ${describeError(e)}`);
    $('ble-warning').hidden = false;
    $('ble-warning').textContent = e?.name === 'NotFoundError'
      ? 'No machine selected. iFit ellipticals usually appear as "I_EL".'
      : describeError(e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect via Bluetooth';
  }
};
$('btn-sim').onclick = () => useMachine(new SimulatedMachine());

function setStatus(text, cls) {
  $('status').textContent = text;
  $('status').className = `pill ${cls}`;
}

// ---------- Preferences ----------
const prefs = {
  get(k, d) { try { const v = localStorage.getItem(`pref-${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`pref-${k}`, JSON.stringify(v)); } catch { /* ignore */ } },
};
const diffFor = (id) => prefs.get(`diff-${id}`, prefs.get('diff', 'intermediate'));
const setDiff = (id, k) => { prefs.set(`diff-${id}`, k); prefs.set('diff', k); };
$('opt-voice').checked = prefs.get('voice', true);
$('opt-autopause').checked = prefs.get('autopause', true);
$('opt-voice').onchange = (e) => prefs.set('voice', e.target.checked);
$('opt-autopause').onchange = (e) => prefs.set('autopause', e.target.checked);

/** Beginner / Intermediate / Advanced buttons. */
function diffControl(container, current, onPick, { small = false } = {}) {
  container.replaceChildren();
  container.classList.toggle('small', small);
  for (const k of DIFFICULTY_KEYS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = DIFFICULTIES[k].label;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(k === current));
    b.classList.toggle('on', k === current);
    b.onclick = (e) => { e.stopPropagation(); onPick(k); };
    container.append(b);
  }
}

// ---------- Circuit picker ----------
function renderPicker() {
  const r = machine.range;
  const who = machine.profile?.name ?? (machine.kind === 'sim' ? 'Simulator' : machine.name);
  $('range-note').textContent = `${who}: resistance levels ${r.min}–${r.max}. Circuits are scaled to this range.`;
  const list = $('circuit-list');
  list.replaceChildren();
  for (const base of CIRCUITS) {
    const card = document.createElement('div');
    card.className = 'circuit';
    card.tabIndex = 0;
    card.innerHTML = `<h3></h3><div class="seg-ctl"></div><svg class="profile"></svg><p></p><div class="meta"></div>`;
    card.querySelector('h3').textContent = base.name;
    card.querySelector('p').textContent = base.description;
    const draw = () => {
      const k = diffFor(base.id);
      const c = applyDifficulty(base, k);
      const levels = c.segments.map((s) => pctToLevel(s.pct, machine.range));
      renderProfile(card.querySelector('svg'), c, { height: 50 });
      card.querySelector('.meta').textContent = `${fmt(totalDuration(c))} · levels ${Math.min(...levels)}–${Math.max(...levels)}`;
      diffControl(card.querySelector('.seg-ctl'), k, (nk) => { setDiff(base.id, nk); draw(); }, { small: true });
    };
    draw();
    card.onclick = () => openWorkout(base);
    card.onkeydown = (e) => { if (e.key === 'Enter') openWorkout(base); };
    list.append(card);
  }
  renderHistory();
}

function renderHistory() {
  const h = loadHistory();
  $('history').hidden = h.length === 0;
  const list = $('history-list');
  list.replaceChildren();
  for (const w of h.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'hist-row';
    const when = new Date(w.date).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    row.innerHTML = `<div><strong></strong><div class="when"></div></div><div class="stats"></div>`;
    row.querySelector('strong').textContent = `${w.circuit} · ${DIFFICULTIES[w.difficulty]?.label ?? ''}`;
    row.querySelector('.when').textContent = when;
    row.querySelector('.stats').textContent = `${fmt(w.durationS)} · ${fmtDist(w.distanceM)} · ${w.kcal} kcal`;
    row.onclick = () => showSummary(w, null);
    list.append(row);
  }
}

const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m ?? 0} m`);

// ---------- Voice ----------
function say(text) {
  if (!$('opt-voice').checked || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch { /* not available */ }
}
const spokenDuration = (s) => (s >= 60 && s % 60 === 0 ? `${s / 60} minute${s === 60 ? '' : 's'}` : s >= 60 ? `${Math.floor(s / 60)} minutes ${s % 60} seconds` : `${s} seconds`);

// ---------- Workout ----------
let lastData = {};
let workout = null; // { base, circuit, difficulty, recorder, coach, watcher, autoPaused, sampler }

function openWorkout(base, difficulty = diffFor(base.id)) {
  clearInterval(ticker);
  clearInterval(workout?.sampler);
  const circuit = applyDifficulty(base, difficulty);
  engine = new WorkoutEngine(machine);
  engine.load(circuit);
  chart = renderProfile($('w-profile'), circuit, { height: 100 });
  workout = {
    base, circuit, difficulty,
    recorder: new WorkoutRecorder({ circuit, difficulty, machineKind: machine.kind }),
    coach: new CadenceCoach(),
    watcher: new MovementWatcher(),
    autoPaused: false,
    halfwaySaid: -1,
    nextSaid: -1,
  };

  $('w-name').textContent = circuit.name;
  $('w-total').textContent = fmt(engine.total);
  $('w-seg').textContent = 'Ready';
  $('w-countdown').textContent = fmt(circuit.segments[0].duration);
  $('w-next').textContent = `${circuit.segments[0].label} (lvl ${engine.levelFor(0)})`;
  $('w-level').textContent = engine.levelFor(0);
  $('w-coach').textContent = '';
  $('w-coach').className = 'coach';
  $('w-nextup').hidden = true;
  $('w-paused').hidden = true;
  $('btn-start').textContent = 'Start';
  diffControl($('w-diff'), difficulty, (k) => {
    if (engine.state !== 'idle') return;
    setDiff(base.id, k);
    openWorkout(base, k);
  });

  engine.addEventListener('segment', (e) => {
    const { index, segment, level } = e.detail;
    $('w-seg').textContent = segment.label;
    const next = circuit.segments[index + 1];
    $('w-next').textContent = next ? `${next.label} (lvl ${engine.levelFor(index + 1)})` : 'Finish';
    $('w-nextup').hidden = true;
    const lv = $('w-level');
    lv.textContent = level;
    lv.classList.remove('flash'); void lv.offsetWidth; lv.classList.add('flash');
    beep(880, 0.15);
    say(`${segment.label}. Level ${level}. ${spokenDuration(segment.duration)}.`);
    bus.dispatchEvent(new CustomEvent('workout', { detail: { state: engine.state, segment, level, index } }));
  });

  let lastBeepSecond = null;
  engine.addEventListener('tick', (e) => {
    const d = e.detail;
    const seg = circuit.segments[d.index];
    chart.setProgress(d.elapsed, d.index);
    $('w-countdown').textContent = fmt(d.segmentRemaining);
    $('m-elapsed').textContent = fmt(d.elapsed);
    const sec = Math.ceil(d.segmentRemaining);
    const running = engine.state === 'running';

    // "Next up" banner for the last 5 seconds.
    const next = circuit.segments[d.index + 1];
    if (running && next && sec <= 5) {
      const nl = engine.levelFor(d.index + 1);
      const delta = nl - d.level;
      $('nu-label').textContent = next.label;
      $('nu-level').textContent = nl;
      $('nu-delta').textContent = delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${delta}` : '';
      $('nu-count').textContent = sec;
      $('w-nextup').hidden = false;
      if (workout.nextSaid !== d.index && sec <= 5) {
        workout.nextSaid = d.index;
        say(`Next: ${next.label}, level ${nl}.`);
      }
    } else {
      $('w-nextup').hidden = true;
    }
    // Halfway cue on long segments.
    if (running && seg.duration >= 120 && workout.halfwaySaid !== d.index && d.segmentElapsed >= seg.duration / 2) {
      workout.halfwaySaid = d.index;
      say('Halfway.');
    }
    if (running && sec <= 3 && sec >= 1 && sec !== lastBeepSecond) beep(440, 0.08);
    lastBeepSecond = sec;
  });

  engine.addEventListener('state', (e) => {
    const s = e.detail.state;
    $('btn-start').textContent = s === 'running' ? 'Pause' : s === 'paused' ? 'Resume' : s === 'finished' ? 'Restart' : 'Start';
    $('w-diff').querySelectorAll('button').forEach((b) => { b.disabled = s !== 'idle'; });
    if (s === 'running') { keepAwake(); machine.startWorkout?.(); } else releaseWake();
    if (s === 'finished') finishWorkout();
    bus.dispatchEvent(new CustomEvent('workout', { detail: { state: s } }));
  });

  engine.addEventListener('error', (e) => log(`Resistance error: ${describeError(e.detail)}`));

  ticker = setInterval(() => engine.update(), 250);
  workout.sampler = setInterval(sampleSecond, 1000);

  $('picker').hidden = true;
  $('summary').hidden = true;
  $('workout').hidden = false;
  window.scrollTo(0, 0);
}

/** Once a second: record, coach, check the machine level, auto-pause. */
function sampleSecond() {
  if (!workout || !engine) return;
  const w = workout;
  const now = Date.now();
  const idx = Math.max(0, engine.index);
  const seg = w.circuit.segments[idx];
  const planned = engine.levelFor(idx);

  // Auto-pause / resume.
  if (engine.state === 'running' || w.autoPaused) {
    const status = w.watcher.update(lastData, now);
    if ($('opt-autopause').checked && engine.state === 'running' && status === 'stopped') {
      engine.pause();
      w.autoPaused = true;
      $('w-paused').hidden = false;
      say('Paused.');
    } else if (w.autoPaused && engine.state === 'paused' && status === 'moving') {
      w.autoPaused = false;
      $('w-paused').hidden = true;
      engine.start();
      say('Resuming.');
    }
  }
  if (engine.state !== 'running') return;

  const moving = MovementWatcher.isMoving(lastData);
  // Learn the rider's rhythm during the warm-up (or the first minute).
  if (moving && (seg.kind === 'warmup' || engine.elapsed < 60)) w.coach.learn(lastData.cadence);
  const target = w.coach.targetFor(seg);
  w.recorder.add(engine.elapsed, planned, lastData, { targetCadence: target, moving });

  // Cadence coaching.
  const coachEl = $('w-coach');
  if (w.coach.learning) {
    coachEl.textContent = lastData.cadence != null ? 'Learning your rhythm…' : '';
    coachEl.className = 'coach learning';
  } else if (target != null && lastData.cadence != null) {
    const fb = CadenceCoach.feedback(lastData.cadence, target);
    coachEl.textContent = { faster: `▲ Pick up the pace (${target})`, ok: `✓ On pace (${target})`, slower: `▼ Ease off (${target})` }[fb];
    coachEl.className = `coach ${fb}`;
  }
  $('m-target').textContent = target != null ? `· target ${target}` : '';

  // Did the machine reach the planned level?
  const sync = $('w-sync');
  if (lastData.resistance != null) {
    const ok = Math.round(lastData.resistance) === planned;
    sync.className = `sync small ${ok ? 'ok' : 'adjusting'}`;
    sync.innerHTML = ok ? `✓ Machine at level <span id="w-mlevel">${planned}</span>`
      : `Machine adjusting: <span id="w-mlevel">${lastData.resistance}</span> → ${planned}`;
  }
}

function finishWorkout() {
  const w = workout;
  if (!w) return;
  clearInterval(w.sampler);
  clearInterval(ticker);
  machine.endWorkout?.();
  $('w-nextup').hidden = true;
  $('w-paused').hidden = true;
  const summary = w.recorder.summary({ total: engine.total });
  if (summary.durationS < 20) {          // too short to be worth saving
    $('workout').hidden = true;
    $('picker').hidden = false;
    renderPicker();
    return;
  }
  summary.series = w.recorder.series();
  summary.maxMachineLevel = machine.range.max;
  saveWorkout(summary);
  beep(660, 0.4);
  say(`Workout complete. ${Math.round(summary.durationS / 60)} minutes, ${summary.kcal} calories. Well done!`);
  showSummary(summary, w.base);
}

function showSummary(s, base) {
  const stats = [
    ['Time', fmt(s.durationS)],
    ['Distance', fmtDist(s.distanceM)],
    [s.kcalEstimated ? 'kcal (est.)' : 'kcal', s.kcal],
    ['Avg watts', s.avgPowerW ?? '–'],
    ['Max watts', s.maxPowerW ?? '–'],
    ['Avg level', s.avgLevel ?? '–'],
    ['Avg cadence', s.avgCadence ?? '–'],
    ['Avg speed', s.avgSpeedKmh != null ? `${s.avgSpeedKmh} km/h` : '–'],
    ['On pace', s.cadenceZonePct != null ? `${s.cadenceZonePct}%` : '–'],
  ];
  if (s.avgHeartRate) stats.push(['Avg heart rate', s.avgHeartRate]);
  $('s-stats').replaceChildren(...stats.map(([k, v]) => {
    const d = document.createElement('div');
    d.className = 'metric';
    d.innerHTML = '<span class="v"></span><span class="k"></span>';
    d.querySelector('.v').textContent = v;
    d.querySelector('.k').textContent = k;
    return d;
  }));
  $('s-date').textContent = new Date(s.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  $('s-title').textContent = s.circuit;
  $('s-sub').textContent = DIFFICULTIES[s.difficulty]?.label ?? '';
  const pct = s.completion != null ? Math.round(s.completion * 100) : null;
  $('s-badge').textContent = pct == null ? '' : pct >= 99 ? 'Completed ✓' : `${pct}% done`;
  $('s-badge').hidden = pct == null;

  const baseCircuit = base ?? CIRCUITS.find((c) => c.id === s.circuitId);
  $('s-repeat').hidden = !baseCircuit || !machine;
  $('s-repeat').onclick = () => openWorkout(baseCircuit, s.difficulty);
  $('s-done').onclick = () => { $('summary').hidden = true; $('picker').hidden = false; renderPicker(); window.scrollTo(0, 0); };
  $('s-copy').onclick = async () => {
    const text = `${s.circuit} (${DIFFICULTIES[s.difficulty]?.label}) – ${$('s-date').textContent}\n` +
      stats.map(([k, v]) => `${k}: ${v}`).join('\n');
    try { await navigator.clipboard.writeText(text); $('s-copy').textContent = 'Copied ✓'; } catch { /* ignore */ }
  };

  $('workout').hidden = true;
  $('picker').hidden = true;
  $('summary').hidden = false;
  renderSummaryChart($('s-chart'), s.series ?? [], { maxLevel: s.maxMachineLevel ?? machine?.range.max ?? 20 });
  window.scrollTo(0, 0);
}

$('btn-start').onclick = () => {
  unlockAudio();
  if (engine.state === 'running') { workout.autoPaused = false; engine.pause(); }
  else { workout.autoPaused = false; $('w-paused').hidden = true; engine.start(); }
};
$('btn-skip').onclick = () => engine?.skip();
$('btn-stop').onclick = () => {
  if (engine?.state === 'running' && !confirm('End this workout?')) return;
  engine?.stop();
};
$('btn-plus').onclick = () => { engine?.nudge(+1); $('w-level').textContent = engine.levelFor(Math.max(0, engine.index)); };
$('btn-minus').onclick = () => { engine?.nudge(-1); $('w-level').textContent = engine.levelFor(Math.max(0, engine.index)); };
$('btn-back').onclick = () => {
  if (engine?.state === 'running' && !confirm('Leave this workout?')) return;
  if (engine && engine.state !== 'idle' && engine.state !== 'finished') { engine.stop(); return; } // → summary
  clearInterval(ticker);
  clearInterval(workout?.sampler);
  $('workout').hidden = true;
  $('picker').hidden = false;
  renderPicker();
};

// ---------- Resistance test (calibration) ----------
// One record per Send: what the app sent, what the rider saw on the console,
// how long it took, how it felt, and what the console reported over Bluetooth.
let calLevel = 1;
let calCurrent = null; // record awaiting the rider's tap
const calRecords = [];
const calShow = () => { $('cal-level').textContent = calLevel; };
const calStatus = (t) => { $('cal-status').textContent = t; };
const fmtRec = (r) => `app ${String(r.sent).padStart(2)} → console ${r.shown ?? '?'}` +
  `${r.secs != null ? ` (${r.secs.toFixed(1)} s)` : ''}${r.feel ? `, ${r.feel}` : ''}` +
  ` · BT level ${r.bt} · cmd ${r.ack ?? '?'}`;
const calRender = () => { $('cal-history').textContent = calRecords.map(fmtRec).reverse().join('\n'); };

for (const n of [...Array(20).keys()].map((i) => i + 1).concat(['No change'])) {
  const b = document.createElement('button');
  b.className = 'btn num';
  b.textContent = n;
  b.onclick = () => calTapConsole(n);
  $('cal-console').append(b);
}
document.querySelectorAll('.feel [data-feel]').forEach((b) => {
  b.onclick = () => {
    const r = calRecords[calRecords.length - 1];
    if (!r) return;
    r.feel = b.dataset.feel;
    calRender();
    log(`TEST: ${fmtRec(r)}`);
  };
});

$('cal-minus').onclick = () => { calLevel = Math.max(machine.range.min, calLevel - 1); calShow(); };
$('cal-plus').onclick = () => { calLevel = Math.min(machine.range.max, calLevel + 1); calShow(); };
$('cal-send').onclick = () => calSend();

async function calSend() {
  const rec = { sent: calLevel, at: performance.now(), shown: null, secs: null, feel: null, bt: '–', ack: null };
  calRecords.push(rec);
  calCurrent = rec;
  calRender();
  calStatus(`Sent level ${rec.sent}. Watch the console and tap the number it shows…`);
  machine.lastResistanceAck = null;
  await machine.setResistance(rec.sent);
  // Pick up the console's Bluetooth acknowledgement when it arrives.
  const t = setInterval(() => {
    if (machine.lastResistanceAck) { rec.ack = machine.lastResistanceAck; calRender(); clearInterval(t); }
  }, 200);
  setTimeout(() => clearInterval(t), 5000);
}

function calTapConsole(n) {
  const rec = calCurrent;
  if (!rec) { calStatus('Tap Send first.'); return; }
  rec.shown = n;
  rec.secs = (performance.now() - rec.at) / 1000;
  rec.bt = $('cal-machine').textContent;
  calCurrent = null;
  calRender();
  log(`TEST: ${fmtRec(rec)}`);
  if ($('cal-auto').checked && calLevel < machine.range.max) {
    calLevel += 1;
    calShow();
    calStatus(`Recorded. Sending level ${calLevel} in 1 s…`);
    setTimeout(calSend, 1000);
  } else {
    calStatus(calLevel >= machine.range.max ? 'Done – reached the top level. Tap Copy results.' : 'Recorded. Tap Send for the next one.');
  }
}

$('cal-copy').onclick = async () => {
  const text = 'Resistance test results\n' + calRecords.map(fmtRec).join('\n');
  try { await navigator.clipboard.writeText(text); $('cal-copy').textContent = 'Copied ✓'; }
  catch { const r = document.createRange(); r.selectNodeContents($('cal-history')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
};
$('cal-clear').onclick = () => { calRecords.length = 0; calCurrent = null; calLevel = 1; calShow(); calRender(); calStatus('Cleared. Tap Send to start.'); };

// ---------- Live data ----------
function onData(d) {
  lastData = { ...lastData, ...d };
  if (d.cadence != null) $('m-cadence').textContent = Math.round(d.cadence);
  if (d.powerW != null) $('m-power').textContent = d.powerW;
  if (d.speedKmh != null) $('m-speed').textContent = d.speedKmh.toFixed(1);
  if (d.heartRate) $('m-hr').textContent = d.heartRate;
  if (d.distanceM != null) $('m-dist').textContent = d.distanceM >= 1000 ? `${(d.distanceM / 1000).toFixed(2)} km` : `${d.distanceM} m`;
  if (d.kcal != null) $('m-kcal').textContent = d.kcal;
  if (d.resistanceCode != null || d.resistance != null) {
    const txt = d.resistanceCode != null ? `${d.resistance ?? '?'} (code ${d.resistanceCode})` : d.resistance;
    $('w-mlevel').textContent = txt;
    $('cal-machine').textContent = txt;
  }
  bus.dispatchEvent(new CustomEvent('telemetry', { detail: d }));
}

// ---------- Simulator controls ----------
$('sim-cadence').oninput = (e) => {
  $('sim-val').textContent = e.target.value;
  machine?.setCadence?.(Number(e.target.value));
};
window.addEventListener('keydown', (e) => {
  if (machine?.kind !== 'sim' || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const s = $('sim-cadence');
  s.value = Number(s.value) + (e.key === 'ArrowUp' ? 5 : -5);
  s.dispatchEvent(new Event('input'));
});

// ---------- Audio cues + screen wake lock ----------
let audio = null;
function unlockAudio() { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); }
function beep(freq, dur) {
  if (!audio) return;
  const o = audio.createOscillator(), g = audio.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.15, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
  o.connect(g).connect(audio.destination);
  o.start(); o.stop(audio.currentTime + dur);
}
async function keepAwake() {
  try { wakeLock ??= await navigator.wakeLock?.request('screen'); } catch { /* not critical */ }
}
function releaseWake() { wakeLock?.release?.(); wakeLock = null; }
