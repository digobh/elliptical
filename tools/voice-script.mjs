// Everything the coach (ElevenLabs voice "Jessica") says, as short clips.
// Edit here, then run: node tools/generate-voice.mjs
// Groups whose ids end in a number are rotated like a shuffled deck.

const n2w = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];

const labels = {
  // segment name → how Jessica says it (work segments with energy, easy ones calm)
  'Warm-up': 'Warm-up.', 'Cool-down': 'Cool-down.', Recover: 'Recover.', Rest: 'Rest.', Break: 'Take a break.',
  Low: 'Low.', Medium: 'Medium.', High: 'High!', Max: 'Max effort!', Climb: 'Climb!', Crest: 'Over the crest!',
  Descent: 'Descent.', Sprint: 'Sprint!', Peak: 'Peak!', 'All-out': 'All out!', Summit: 'Summit push!',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`Step ${i}`, `Step ${n2w[i]}.`])),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => [`Km ${i}`, `Kilometer ${n2w[i]}.`])),
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const CLIPS = {
  // A. falling behind the pace
  'behind-1': 'Pick up the pace a little!',
  'behind-2': "Come on, a bit faster. You've got this!",
  'behind-3': 'Push the rhythm, stay with me!',
  'behind-4': "You're dropping off. Let's bring it back up!",
  'behind-5': 'Faster legs! Find that rhythm.',
  // B. too fast
  'fast-1': 'Ease off a touch. Save some energy.',
  'fast-2': 'Nice power, but slow it down a little.',
  'fast-3': 'Steady. No need to rush this one.',
  // C. back on track
  'ontrack-1': "That's it! Right on pace.",
  'ontrack-2': "Perfect, you're back on track!",
  'ontrack-3': 'Yes! Hold that rhythm.',
  'ontrack-4': 'Beautiful. Keep it just like that.',
  // D. motivation
  'motivate-1': "You're doing great. Keep it going!",
  'motivate-2': 'Strong legs, strong mind.',
  'motivate-3': 'Every stride counts. Stay with it!',
  'motivate-4': 'Breathe deep and stay relaxed.',
  'motivate-5': 'This is where you get stronger.',
  'motivate-6': 'Look at you go!',
  'motivate-7': "Stay focused. You're crushing it.",
  'motivate-8': 'Shoulders relaxed, core tight.',
  'motivate-9': "One segment at a time. You've got this.",
  'motivate-10': 'Future you is going to thank you for this.',
  'motivate-11': 'Find your rhythm and own it.',
  'motivate-12': "You showed up today. That's what matters.",
  // E. hard-effort boosts
  'boost-1': 'Dig deep! Almost there!',
  'boost-2': 'Push, push, push!',
  'boost-3': "Give it everything you've got!",
  'ten-seconds': "Ten more seconds! Don't stop now!",
  // F. milestones
  'start': "Let's get started. Nice and easy to warm up.",
  'halfway-workout': 'Halfway through the workout. Amazing work!',
  'last-segment': 'Last segment. Finish strong!',
  'one-minute': 'One minute left!',
  'cooldown-start': 'Time to cool down. You did great today.',
  'complete': 'Workout complete! Well done, that was awesome.',
  // G. app events
  'coming-up': 'Coming up…',
  'halfway-segment': 'Halfway through this one.',
  'paused': "Paused. Start moving when you're ready.",
  'resumed': "And we're back!",
  'lost': 'I lost the connection. Come back to the app to reconnect.',
  'reconnected': "Reconnected. Let's pick up where we left off.",
  'max-level': 'Max level changed.',
  // levels and segment names (combined live: "Sprint!" + "Level twelve.")
  ...Object.fromEntries(n2w.slice(1).map((w, i) => [`level-${i + 1}`, `Level ${w}.`])),
  ...Object.fromEntries(Object.entries(labels).map(([k, v]) => [`seg-${slug(k)}`, v])),
};

export const segClipId = (label) => `seg-${slug(label)}`;
