// Saved workouts (this device only, localStorage). Keeps the newest 100.

const KEY = 'workout-history';
const MAX = 100;

export function loadHistory() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function saveWorkout(entry) {
  const list = [entry, ...loadHistory()].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
  return list;
}

export function deleteWorkout(date) {
  const list = loadHistory().filter((w) => w.date !== date);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}
