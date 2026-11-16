// Spoken cues with the most natural voice available.
//
// Web apps can't use Siri's voice, but iOS/macOS expose Apple's downloadable
// "Enhanced" and "Premium" voices to speechSynthesis, and they sound far more
// human. We rank installed English voices and use the best one unless the user
// picked another.

const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i;
const NICE = /ava|zoe|samantha|evan|nathan|joelle|noelle|allison|susan|serena|daniel|karen|moira|tessa|kate|oliver|jamie|matilda|google us english|google uk english/i;

export function scoreVoice(v) {
  const id = `${v.name} ${v.voiceURI}`;
  if (!/^en/i.test(v.lang) || NOVELTY.test(v.name)) return -1;
  let s = 0;
  if (/premium/i.test(id)) s += 30;
  else if (/enhanced/i.test(id)) s += 20;
  if (/siri/i.test(id)) s += 15;
  if (NICE.test(v.name)) s += 5;
  if (/en[-_](US|GB|AU|IE|CA)/i.test(v.lang)) s += 2;
  if (v.localService) s += 1;
  return s;
}

/** English voices, best first. */
export function rankedVoices(voices) {
  return voices.map((v) => ({ v, s: scoreVoice(v) })).filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.v.name.localeCompare(b.v.name)).map((x) => x.v);
}

export const voiceQuality = (v) => (/premium/i.test(`${v.name} ${v.voiceURI}`) ? 'Premium'
  : /enhanced/i.test(`${v.name} ${v.voiceURI}`) ? 'Enhanced' : 'Standard');

export class Voice {
  constructor() {
    this.enabled = true;
    this.preferredURI = null;
    this.voice = null;
    this.onvoices = null;
    if (typeof speechSynthesis !== 'undefined') {
      this.refresh();
      speechSynthesis.addEventListener?.('voiceschanged', () => this.refresh());
    }
  }

  get supported() { return typeof speechSynthesis !== 'undefined'; }

  list() { return this.supported ? rankedVoices(speechSynthesis.getVoices()) : []; }

  refresh() {
    const list = this.list();
    this.voice = list.find((v) => v.voiceURI === this.preferredURI) ?? list[0] ?? null;
    this.onvoices?.(list);
  }

  use(uri) { this.preferredURI = uri || null; this.refresh(); }

  say(text, { force = false } = {}) {
    if ((!this.enabled && !force) || !this.supported) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; }
      u.rate = 1;
      u.pitch = 1;
      speechSynthesis.speak(u);
    } catch { /* not available */ }
  }
}

/** Friendlier phrasing, with a little variety so it doesn't sound robotic. */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const spokenDuration = (s) => (s % 60 === 0 && s >= 60 ? `${s / 60} minute${s === 60 ? '' : 's'}`
  : s > 60 ? `${Math.floor(s / 60)} minutes ${s % 60} seconds` : `${s} seconds`);

export const phrases = {
  segment(seg, level) {
    const d = spokenDuration(seg.duration);
    switch (seg.kind) {
      case 'warmup': return pick([`Let's warm up. Level ${level}, nice and easy.`, `Warm-up time. Level ${level} for ${d}.`]);
      case 'recover': return pick([`Nice work. Recover at level ${level}.`, `Good job. Ease off to level ${level} and breathe.`, `Recovery. Level ${level} for ${d}.`]);
      case 'cooldown': return pick([`Cool-down. Level ${level}. Great effort today.`, `Time to cool down. Level ${level}. You did great.`]);
      default: return pick([`${seg.label}! Level ${level} for ${d}. Let's go!`, `Here we go. ${seg.label}, level ${level}, ${d}.`, `${seg.label}. Level ${level}. You've got this.`]);
    }
  },
  next: (seg, level) => pick([`Coming up: ${seg.label}, level ${level}.`, `Get ready. ${seg.label} at level ${level}.`]),
  halfway: () => pick(['Halfway there.', 'Halfway. Keep it up.', "You're halfway through this one."]),
  paused: () => pick(['Paused. Start moving when you are ready.', 'Taking a break. I will wait for you.']),
  resumed: () => pick(["And we're back.", 'Resuming. Nice.']),
  done: (min, kcal) => `Workout complete! ${min} minutes and ${kcal} calories. Well done!`,
  ceiling: (max, level) => `Max level ${max}. Now at level ${level}.`,
  reconnected: () => 'Reconnected. Picking up where you left off.',
  lost: () => 'Connection lost. Come back to the app to reconnect.',
};
