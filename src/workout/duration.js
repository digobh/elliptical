// Make a circuit shorter or longer while keeping its shape: every segment is
// scaled by the same factor (rounded to 5 s, at least 5 s), then the rounding
// error is absorbed by the longest segments so the total lands on target.

import { totalDuration } from './circuits.js';

const round5 = (s) => Math.max(5, Math.round(s / 5) * 5);

export function applyDuration(circuit, targetS) {
  const total = totalDuration(circuit);
  if (!targetS || Math.abs(targetS - total) < 5) return circuit;
  const k = targetS / total;
  const segments = circuit.segments.map((s) => ({ ...s, duration: round5(s.duration * k) }));
  // Absorb rounding drift (in 5 s steps) on the longest segments.
  let drift = targetS - segments.reduce((t, s) => t + s.duration, 0);
  const byLength = [...segments].sort((a, b) => b.duration - a.duration);
  for (let i = 0; Math.abs(drift) >= 5 && i < byLength.length * 4; i++) {
    const s = byLength[i % byLength.length];
    const step = drift > 0 ? 5 : -5;
    if (s.duration + step >= 5) { s.duration += step; drift -= step; }
  }
  return { ...circuit, segments, adjustedS: targetS };
}

/** Allowed range for the time picker, in whole minutes. */
export function durationLimits(suggestedS) {
  const min = Math.max(1, Math.ceil((suggestedS * 0.4) / 60));
  const max = Math.max(min + 1, Math.round((suggestedS * 3) / 60));
  return { min, max };
}
