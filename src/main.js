import { FtmsMachine } from './ble/ftms-device.js?v=25';
import { pickAndConnect } from './ble/connect.js?v=25';
import { SimulatedMachine } from './ble/simulator.js?v=25';
import { inspectDevice } from './ble/inspector.js?v=25';
import { describeError } from './errors.js?v=25';
import { CIRCUITS, totalDuration, pctToLevel } from './workout/circuits.js?v=25';
import { WorkoutEngine } from './workout/engine.js?v=25';
import { renderProfile } from './ui/profile-chart.js?v=25';
import { renderSummaryChart } from './ui/summary-chart.js?v=25';
import { DIFFICULTIES, DIFFICULTY_KEYS, applyDifficulty, ceilingFor } from './workout/difficulty.js?v=25';
import { applyDuration, durationLimits } from './workout/duration.js?v=25';
import { WorkoutRecorder } from './workout/recorder.js?v=25';
import { CadenceCoach, MovementWatcher } from './workout/coach.js?v=25';
import { loadHistory, saveWorkout } from './workout/history.js?v=25';
import { saveSession, loadSession, clearSession } from './workout/session.js?v=25';
import { Voice, voiceQuality } from './ui/voice.js?v=25';
import { CoachAudio } from './ui/coach-audio.js?v=25';
import { CoachTalk } from './workout/talk.js?v=25';
import { segClipId } from '../tools/voice-script.mjs?v=25';

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

$('resume-note').hidden = !loadSession();

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
  m.addEventListener('disconnect', handleDisconnect);
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

// Custom time per circuit, stored as a factor of the suggested time so it
// carries over when the difficulty changes. null = suggested time.
const timeFactor = (id) => prefs.get(`time-${id}`, null);
const setTimeFactor = (id, f) => prefs.set(`time-${id}`, f);

/** Circuit with the chosen difficulty and time applied. */
function buildCircuit(base, difficulty) {
  const withDiff = applyDifficulty(base, difficulty);
  const suggested = totalDuration(withDiff);
  const f = base.fixedTime ? null : timeFactor(base.id);
  const target = f == null ? null : Math.round((suggested * f) / 60) * 60;
  const c = applyDuration(withDiff, target);
  return { ...c, suggestedS: suggested };
}

/** − 22 min + (Reset) control. `onChange` redraws the owner. */
function timeControl(container, base, difficulty, onChange) {
  const c = buildCircuit(base, difficulty);
  if (base.fixedTime) {
    container.innerHTML = '<span class="t-val"></span> <span class="muted small">fixed protocol</span>';
    container.querySelector('.t-val').textContent = fmt(totalDuration(c));
    return;
  }
  const total = totalDuration(c);
  const { min, max } = durationLimits(c.suggestedS);
  const minutes = Math.round(total / 60);
  const custom = timeFactor(base.id) != null;
  container.innerHTML = `<button type="button" class="btn t-btn" aria-label="Shorter">−</button>
    <span class="t-val"></span>
    <button type="button" class="btn t-btn" aria-label="Longer">+</button>
    <button type="button" class="btn ghost t-reset">Reset</button>`;
  const [minus, plus] = container.querySelectorAll('.t-btn');
  container.querySelector('.t-val').textContent = custom ? `${fmt(total)} (suggested ${fmt(c.suggestedS)})` : `${fmt(total)} suggested`;
  container.querySelector('.t-reset').hidden = !custom;
  const set = (m) => {
    setTimeFactor(base.id, Math.abs(m * 60 - c.suggestedS) < 30 ? null : (m * 60) / c.suggestedS);
    onChange();
  };
  minus.disabled = minutes <= min;
  plus.disabled = minutes >= max;
  minus.onclick = (e) => { e.stopPropagation(); set(Math.max(min, minutes - 1)); };
  plus.onclick = (e) => { e.stopPropagation(); set(Math.min(max, minutes + 1)); };
  container.querySelector('.t-reset').onclick = (e) => { e.stopPropagation(); setTimeFactor(base.id, null); onChange(); };
  container.onclick = (e) => e.stopPropagation();
}
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
function renderResumeCard() {
  const saved = loadSession();
  const base = saved && CIRCUITS.find((c) => c.id === saved.baseId);
  $('resume-card').hidden = !base;
  if (!base) return;
  const total = saved.circuit.segments.reduce((t, x) => t + x.duration, 0);
  $('resume-text').textContent = `${saved.circuit.name} · ${DIFFICULTIES[saved.difficulty]?.label ?? ''} – stopped at ${fmt(saved.elapsed)} of ${fmt(total)}`;
  $('resume-go').onclick = () => openWorkout(base, saved.difficulty, saved);
  $('resume-discard').onclick = () => {
    if (!confirm('Discard the unfinished workout?')) return;
    // keep what was done: save it to history as a partial workout
    const rec = WorkoutRecorder.fromJSON(saved.recorder, saved.circuit);
    const sum = rec.summary({ total });
    if (sum.durationS >= 20) { sum.series = rec.series(); sum.ceiling = saved.ceiling; sum.maxMachineLevel = machine.range.max; saveWorkout(sum); }
    clearSession();
    renderPicker();
  };
}

function renderPicker() {
  renderResumeCard();
  const r = machine.range;
  const who = machine.profile?.name ?? (machine.kind === 'sim' ? 'Simulator' : machine.name);
  $('range-note').textContent = `${who}: resistance levels ${r.min}–${r.max}. Circuits are scaled to this range.`;
  const list = $('circuit-list');
  list.replaceChildren();
  for (const base of CIRCUITS) {
    const card = document.createElement('div');
    card.className = 'circuit';
    card.tabIndex = 0;
    card.innerHTML = `<h3></h3><div class="seg-ctl"></div><svg class="profile"></svg><p></p>
      <div class="time-ctl"></div><div class="meta"></div>`;
    card.querySelector('h3').textContent = base.name;
    card.querySelector('p').textContent = base.description;
    const draw = () => {
      const k = diffFor(base.id);
      const c = buildCircuit(base, k);
      const cap = ceilingFor(k, machine.range);
      const levels = c.segments.map((s) => pctToLevel(s.pct, { ...machine.range, max: cap }));
      renderProfile(card.querySelector('svg'), c, { height: 50 });
      card.querySelector('.meta').textContent = `levels ${Math.min(...levels)}–${Math.max(...levels)} · max ${cap}`;
      timeControl(card.querySelector('.time-ctl'), base, k, draw);
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
// Coach = recorded ElevenLabs clips ("Jessica"); the browser voice is only a
// fallback or an explicit choice in Voice settings.
const voice = new Voice();
voice.enabled = true;
const APP_VERSION = new URL(import.meta.url).searchParams.get('v') ?? '';
const coachAudio = new CoachAudio({ version: APP_VERSION });
window.ellipticalCoach = coachAudio; // handy for debugging
coachAudio.load().catch((e) => log(`Coach voice not loaded: ${describeError(e)}`));
const usingJessica = () => (prefs.get('voiceURI', 'jessica') ?? 'jessica') === 'jessica';
if (!usingJessica()) voice.use(prefs.get('voiceURI', null));

const levelClip = (l) => `level-${Math.max(1, Math.min(16, Math.round(l)))}`;

/** Say a sentence made of clip ids. priority 2 = announcements, 1 = chatter. */
function speak(ids, { priority = 1 } = {}) {
  if (!$('opt-voice').checked) return;
  if (usingJessica()) coachAudio.play(ids, { priority, fallback: (text) => voice.say(text) });
  else voice.say(coachAudio.text(ids));
  if (workout?.talk && engine) workout.talk.spoke(engine.elapsed);
}

function renderVoices(list = voice.list()) {
  const sel = $('opt-voice-pick');
  sel.replaceChildren();
  sel.append(new Option('Jessica – natural coach voice', 'jessica'));
  if (list.length) {
    sel.append(new Option(`Phone voice: best available (${list[0].name})`, ''));
    for (const v of list) sel.append(new Option(`Phone voice: ${v.name} · ${voiceQuality(v)} (${v.lang})`, v.voiceURI));
  }
  sel.value = prefs.get('voiceURI', 'jessica') ?? '';
  $('voice-hint').hidden = true;
}
voice.onvoices = (list) => renderVoices(list);
renderVoices();
$('opt-voice-pick').onchange = (e) => {
  prefs.set('voiceURI', e.target.value || null);
  if (e.target.value !== 'jessica') voice.use(e.target.value);
};
// Diagnostics: list exactly what speechSynthesis exposes on this device.
$('voice-all').onclick = async () => {
  const out = $('voice-all-out');
  out.hidden = false;
  if (!voice.supported) { out.textContent = 'speechSynthesis is not available in this browser.'; return; }
  let all = speechSynthesis.getVoices();
  if (!all.length) { await sleep(800); all = speechSynthesis.getVoices(); }
  const lines = all.map((v) => `${v.name} | ${v.lang} | ${v.voiceURI}${v.localService ? '' : ' | remote'}${v.default ? ' | default' : ''}`);
  out.textContent = `${all.length} voices (${navigator.userAgent.match(/Bluefy\/[\d.]+|Version\/[\d.]+/)?.[0] ?? ''})\n` + lines.join('\n');
  try { await navigator.clipboard.writeText(out.textContent); $('voice-all').textContent = 'Copied to clipboard ✓'; } catch { /* ignore */ }
};
$('voice-test').onclick = () => {
  unlockAudio();
  const was = $('opt-voice').checked;
  $('opt-voice').checked = true;
  speak(['seg-sprint', 'level-8', 'motivate-6'], { priority: 3 });
  $('opt-voice').checked = was;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Workout ----------
let lastData = {};
let workout = null; // { base, circuit, difficulty, recorder, coach, watcher, autoPaused, sampler }

/** `restore`: a saved session (see session.js) to continue from. */
function openWorkout(base, difficulty = diffFor(base.id), restore = null) {
  unlockAudio(); // opened by a tap: lets the coach clips decode before Start
  clearInterval(ticker);
  clearInterval(workout?.sampler);
  const circuit = restore?.circuit ?? buildCircuit(base, difficulty);
  engine = new WorkoutEngine(machine);
  engine.load(circuit);
  engine.setCeiling(restore?.ceiling ?? ceilingFor(difficulty, machine.range));
  chart = renderProfile($('w-profile'), circuit, { height: 100 });
  const coach = new CadenceCoach();
  if (restore?.coachBaseline) coach.baseline = restore.coachBaseline;
  workout = {
    base, circuit, difficulty,
    recorder: restore?.recorder ? WorkoutRecorder.fromJSON(restore.recorder, circuit)
      : new WorkoutRecorder({ circuit, difficulty, machineKind: machine.kind }),
    coach,
    watcher: new MovementWatcher(),
    autoPaused: false,
    talk: new CoachTalk(),
    halfwaySaid: -1,
    nextSaid: -1,
  };

  $('w-name').textContent = circuit.name;
  $('w-total').textContent = fmt(engine.total);
  $('w-seg').textContent = 'Ready';
  $('w-countdown').textContent = fmt(circuit.segments[0].duration);
  $('w-el').textContent = '0:00';
  $('w-rem').textContent = fmt(engine.total);
  $('w-next').textContent = `${circuit.segments[0].label} (lvl ${engine.levelFor(0)})`;
  $('w-level').textContent = engine.levelFor(0);
  showCeiling();
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
  timeControl($('w-time'), base, difficulty, () => { if (engine.state === 'idle') openWorkout(base, difficulty); });

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
    if (!workout.silentNext) {
      const segs = workout.circuit.segments;
      const isLast = index === segs.length - 1;
      let ids;
      if (index === 0 && segment.kind === 'warmup') ids = ['start', levelClip(level)];
      else if (segment.kind === 'cooldown') ids = ['cooldown-start', levelClip(level)];
      else ids = [segClipId(segment.label), levelClip(level), ...(isLast ? ['last-segment'] : [])];
      speak(ids, { priority: 2 });
    }
    workout.silentNext = false;
    bus.dispatchEvent(new CustomEvent('workout', { detail: { state: engine.state, segment, level, index } }));
  });

  let lastBeepSecond = null;
  engine.addEventListener('tick', (e) => {
    const d = e.detail;
    const seg = circuit.segments[d.index];
    chart.setProgress(d.elapsed, d.index);
    $('w-countdown').textContent = fmt(d.segmentRemaining);
    $('m-elapsed').textContent = fmt(d.elapsed);
    $('w-el').textContent = fmt(d.elapsed);
    $('w-rem').textContent = fmt(d.total - d.elapsed);
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
        speak(['coming-up', segClipId(next.label), levelClip(nl)], { priority: 2 });
      }
    } else {
      $('w-nextup').hidden = true;
    }
    // Halfway cue on long segments.
    if (running && seg.duration >= 120 && workout.halfwaySaid !== d.index && d.segmentElapsed >= seg.duration / 2) {
      workout.halfwaySaid = d.index;
      speak(['halfway-segment']);
    }
    if (running && sec <= 3 && sec >= 1 && sec !== lastBeepSecond) beep(440, 0.08);
    lastBeepSecond = sec;
  });

  engine.addEventListener('state', (e) => {
    const s = e.detail.state;
    $('btn-start').textContent = s === 'running' ? 'Pause' : s === 'paused' ? 'Resume' : s === 'finished' ? 'Restart' : 'Start';
    $('w-diff').querySelectorAll('button').forEach((b) => { b.disabled = s !== 'idle'; });
    $('w-time').hidden = s !== 'idle';
    if (s === 'running') { keepAwake(); machine.startWorkout?.(); } else releaseWake();
    if (s === 'paused') persistSession();
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

  if (restore) {
    workout.silentNext = true;
    engine.seek(restore.elapsed);          // paused at the saved point; level is sent
    $('w-seg').textContent = `${circuit.segments[engine.index].label} – resumed`;
    log(`Resumed ${circuit.name} at ${fmt(restore.elapsed)}`);
  }
}

// ---------- Saving the session in progress ----------
function persistSession() {
  if (!workout || !engine || !['running', 'paused'].includes(engine.state)) return;
  saveSession({
    baseId: workout.base.id,
    difficulty: workout.difficulty,
    circuit: workout.circuit,
    ceiling: engine.ceiling,
    elapsed: Math.floor(engine.elapsed),
    recorder: workout.recorder.toJSON(),
    coachBaseline: workout.coach.baseline,
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistSession();
  else if (machine && !machine.connected && machine.reconnect) tryReconnect();
});
window.addEventListener('pagehide', persistSession);

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
      speak(['paused'], { priority: 2 });
    } else if (w.autoPaused && engine.state === 'paused' && status === 'moving') {
      w.autoPaused = false;
      $('w-paused').hidden = true;
      engine.start();
      speak(['resumed'], { priority: 2 });
    }
  }
  if (engine.state !== 'running') return;
  if (Math.floor(engine.elapsed) % 5 === 0) persistSession();

  const moving = MovementWatcher.isMoving(lastData);
  // Learn the rider's rhythm during the warm-up (or the first minute).
  if (moving && (seg.kind === 'warmup' || engine.elapsed < 60)) w.coach.learn(lastData.cadence);
  const target = w.coach.targetFor(seg);
  w.recorder.add(engine.elapsed, planned, lastData, { targetCadence: target, moving });

  // Cadence coaching.
  const coachEl = $('w-coach');
  let fb = null;
  if (w.coach.learning) {
    coachEl.textContent = lastData.cadence != null ? 'Learning your rhythm…' : '';
    coachEl.className = 'coach learning';
  } else if (target != null && lastData.cadence != null) {
    fb = CadenceCoach.feedback(lastData.cadence, target);
    coachEl.textContent = { faster: `▲ Pick up the pace (${target})`, ok: `✓ On pace (${target})`, slower: `▼ Ease off (${target})` }[fb];
    coachEl.className = `coach ${fb}`;
  }
  $('m-target').textContent = target != null ? `· target ${target}` : '';

  // Jessica: pace feedback, motivation, boosts, milestones.
  const segElapsed = engine.elapsed - w.circuit.segments.slice(0, idx).reduce((a, x) => a + x.duration, 0);
  const lines = w.talk.tick({
    t: engine.elapsed, total: engine.total, index: idx, seg,
    segElapsed, segRemaining: seg.duration - segElapsed,
    isLast: idx === w.circuit.segments.length - 1,
    feedback: fb, moving: moving && !coachAudio.speaking,
  });
  if (lines) speak(lines, { priority: lines[0] === 'ten-seconds' || lines[0] === 'one-minute' ? 2 : 1 });

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
  clearSession();
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
  summary.ceiling = engine.ceiling;
  summary.maxMachineLevel = machine.range.max;
  saveWorkout(summary);
  beep(660, 0.4);
  speak(['complete'], { priority: 3 });
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
  if (s.ceiling) stats.push(['Max level setting', s.ceiling]);
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
// Tap the circuit chart to jump to that point.
$('w-profile').addEventListener('click', (e) => {
  if (!engine || engine.state === 'finished') return;
  const rect = e.currentTarget.getBoundingClientRect();
  const t = Math.round(((e.clientX - rect.left) / rect.width) * engine.total);
  const seg = workout.circuit.segments[engine.segmentIndexAt(Math.min(t, engine.total - 1))];
  if (!confirm(`Jump to ${fmt(t)} (${seg.label})?`)) return;
  engine.seek(t);
  log(`Jumped to ${fmt(t)}`);
  persistSession();
});

// ---------- Lost connection: pause, save, reconnect, carry on ----------
let reconnecting = false;
let resumeAfterReconnect = false;
function handleDisconnect() {
  setStatus('Reconnecting…', 'pill-off');
  if (engine?.state === 'running') { engine.pause(); resumeAfterReconnect = true; }
  persistSession();
  if (!$('workout').hidden) {
    $('w-conn').hidden = false;
    $('w-conn-text').textContent = 'Connection lost – reconnecting… (keep this app open)';
  }
  speak(['lost'], { priority: 3 });
  tryReconnect();
}
async function tryReconnect() {
  if (reconnecting || !machine?.reconnect || machine.connected) return;
  reconnecting = true;
  for (let i = 0; i < 15 && !machine.connected; i++) {
    if (document.visibilityState === 'visible') {
      try { await machine.reconnect(); } catch (e) { log(`Reconnect attempt ${i + 1} failed: ${describeError(e)}`); }
    }
    if (!machine.connected) await sleep(3000);
  }
  reconnecting = false;
  if (!machine.connected) {
    $('w-conn-text').textContent = 'Could not reconnect. Turn the machine on, then tap Retry.';
    $('w-conn-retry').hidden = false;
    return;
  }
  setStatus(`Connected: ${machine.name}`, 'pill-on');
  $('w-conn').hidden = true;
  $('w-conn-retry').hidden = true;
  engine?.reapply();
  if (resumeAfterReconnect && engine?.state === 'paused') {
    resumeAfterReconnect = false;
    engine.start();
    speak(['reconnected'], { priority: 3 });
  }
}
$('w-conn-retry').onclick = () => { $('w-conn-retry').hidden = true; $('w-conn-text').textContent = 'Reconnecting…'; tryReconnect(); };

// "Max level": change the ceiling during the workout when it is too heavy / too easy.
function showCeiling() {
  if (!engine) return;
  const r = machine.range;
  $('w-ceiling').textContent = engine.ceiling ?? r.max;
  $('ceil-minus').disabled = (engine.ceiling ?? r.max) <= r.min + 1;
  $('ceil-plus').disabled = (engine.ceiling ?? r.max) >= r.max;
}
function changeCeiling(delta) {
  if (!engine) return;
  const before = engine.ceiling ?? machine.range.max;
  const now = engine.setCeiling(before + delta);
  if (now === before) return;
  showCeiling();
  const idx = Math.max(0, engine.index);
  $('w-level').textContent = engine.levelFor(idx);
  const next = workout.circuit.segments[idx + 1];
  if (next) $('w-next').textContent = `${next.label} (lvl ${engine.levelFor(idx + 1)})`;
  if (engine.state === 'running') speak(['max-level', levelClip(now)], { priority: 2 });
  persistSession();
  log(`Max level ${before} → ${now}`);
}
$('ceil-minus').onclick = () => changeCeiling(-1);
$('ceil-plus').onclick = () => changeCeiling(+1);

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
function unlockAudio() {
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  audio.resume?.();
  coachAudio.attach(audio);
}
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
