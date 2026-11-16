// Beginner / Intermediate / Advanced versions of any circuit.
//
// Each level has a resistance CEILING (on a 16-level machine like the ProForm
// Endurance 420E: Beginner 6, Intermediate 10, Advanced 14). The circuit's effort
// percentages are scaled into 1…ceiling, so its shape is kept and 100 % effort
// = the ceiling. The ceiling can be changed during a workout.
// Levels also change interval length (beginner shorter work, advanced longer
// work and shorter recoveries) and nudge cadence targets.

export const DIFFICULTIES = {
  beginner: { label: 'Beginner', ceiling16: 6, intensity: 1, work: 0.75, recover: 1, cadence: 0.95 },
  intermediate: { label: 'Intermediate', ceiling16: 10, intensity: 1, work: 1, recover: 1, cadence: 1 },
  advanced: { label: 'Advanced', ceiling16: 14, intensity: 1, work: 1.25, recover: 0.85, cadence: 1.05 },
};

/** Ceiling for a difficulty on the connected machine (scaled from the 16-level values). */
export function ceilingFor(key, range) {
  const c16 = (DIFFICULTIES[key] ?? DIFFICULTIES.intermediate).ceiling16;
  if (range.max === 16 && range.min === 1) return c16;
  const lvl = range.min + ((range.max - range.min) * (c16 - 1)) / 15;
  return Math.max(range.min + 1, Math.min(range.max, Math.round(lvl)));
}

export const DIFFICULTY_KEYS = Object.keys(DIFFICULTIES);

const round5 = (s) => Math.max(5, Math.round(s / 5) * 5);
const clampPct = (p) => Math.max(0, Math.min(100, Math.round(p)));

export function applyDifficulty(circuit, key = 'intermediate') {
  const d = DIFFICULTIES[key] ?? DIFFICULTIES.intermediate;
  const easyFactor = 1 + (d.intensity - 1) / 2;
  return {
    ...circuit,
    difficulty: key in DIFFICULTIES ? key : 'intermediate',
    segments: circuit.segments.map((s) => {
      const isWork = (s.kind ?? 'work') === 'work';
      const durFactor = isWork ? d.work : s.kind === 'recover' ? d.recover : 1;
      return {
        ...s,
        pct: clampPct(s.pct * (isWork ? d.intensity : easyFactor)),
        duration: durFactor === 1 ? s.duration : round5(s.duration * durFactor),
        cadence: s.cadence ? Math.round(s.cadence * d.cadence) : s.cadence,
      };
    }),
  };
}
