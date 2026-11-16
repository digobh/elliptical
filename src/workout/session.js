// The workout in progress, saved on the device every few seconds so it can be
// resumed after a lost Bluetooth connection, a page reload or a closed tab.

const KEY = 'active-session';
export const MAX_AGE_MS = 6 * 60 * 60 * 1000; // offer to resume for 6 hours

const mem = new Map(); // fallback when localStorage is unavailable (tests, private mode)
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return mem.get(k) ?? null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { mem.set(k, v); } },
  del: (k) => { try { localStorage.removeItem(k); } catch { mem.delete(k); } },
};

/**
 * state: { baseId, difficulty, circuit (as built: difficulty + time applied),
 *          ceiling, elapsed, recorder (WorkoutRecorder.toJSON()), coachBaseline }
 */
export function saveSession(state, now = Date.now()) {
  store.set(KEY, JSON.stringify({ v: 1, savedAt: now, ...state }));
}

export function loadSession(now = Date.now()) {
  let s;
  try { s = JSON.parse(store.get(KEY) || 'null'); } catch { return null; }
  if (!s || s.v !== 1 || !s.circuit || now - s.savedAt > MAX_AGE_MS) return null;
  return s;
}

export function clearSession() { store.del(KEY); }
