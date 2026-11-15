// Beginner / Intermediate / Advanced versions of any circuit.
//
// Intermediate is the circuit as written. The other levels change:
//   - intensity: work segments get the full factor; warm-up, recovery and
//     cool-down only half of it, so easy parts stay easy;
//   - duration: work intervals get shorter (beginner) or longer (advanced, which
//     also shortens recoveries);
//   - cadence: targets move a little with the level.

export const DIFFICULTIES = {
  beginner: { label: 'Beginner', intensity: 0.7, work: 0.75, recover: 1, cadence: 0.95 },
  intermediate: { label: 'Intermediate', intensity: 1, work: 1, recover: 1, cadence: 1 },
  advanced: { label: 'Advanced', intensity: 1.2, work: 1.25, recover: 0.85, cadence: 1.05 },
};

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
