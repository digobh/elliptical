// Decides when the coach talks between segment announcements: pace feedback,
// motivation, hard-effort boosts and workout milestones. Pure logic, called once
// a second; returns clip ids to play (or null). Unit-tested.

/** Shuffled deck: every item once before any repeats, never the same twice in a row. */
export class Deck {
  constructor(items, rng = Math.random) { this.items = items; this.rng = rng; this.pile = []; this.last = null; }
  next() {
    if (!this.pile.length) {
      this.pile = [...this.items];
      for (let i = this.pile.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.pile[i], this.pile[j]] = [this.pile[j], this.pile[i]];
      }
      if (this.pile.length > 1 && this.pile[this.pile.length - 1] === this.last) this.pile.unshift(this.pile.pop());
    }
    this.last = this.pile.pop();
    return this.last;
  }
}

const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}-${i + 1}`);

export const isHard = (seg) => (seg.kind ?? 'work') === 'work' &&
  (seg.pct >= 70 || /sprint|all-out|max|peak|summit/i.test(seg.label));

export class CoachTalk {
  /**
   * chattiness: seconds between motivation lines [min, max].
   * quietAfterS: no new line within this many seconds of the last one.
   */
  constructor({ rng = Math.random, chattiness = [60, 90], quietAfterS = 6, paceAfterS = 8, paceGapS = 30 } = {}) {
    this.rng = rng;
    this.chattiness = chattiness;
    this.quietAfterS = quietAfterS;
    this.paceAfterS = paceAfterS;
    this.paceGapS = paceGapS;
    this.decks = {
      behind: new Deck(ids('behind', 5), rng),
      fast: new Deck(ids('fast', 3), rng),
      ontrack: new Deck(ids('ontrack', 4), rng),
      motivate: new Deck(ids('motivate', 12), rng),
      boost: new Deck(ids('boost', 3), rng),
    };
    this.lastSpokeAt = -Infinity;
    this.nextMotivationAt = this._gap(0);
    this.lastPaceCueAt = -Infinity;
    this.offPaceFor = 0;
    this.offPaceKind = null;
    this.okFor = 0;
    this.awaitingRecovery = false;
    this.said = new Set(); // one-off milestones
    this.boostedSegment = -1;
  }

  _gap(t) { const [a, b] = this.chattiness; return t + a + this.rng() * (b - a); }

  /** Tell the talker something else was just said (segment announcements etc.). */
  spoke(t) { this.lastSpokeAt = t; }

  /**
   * s: { t (workout seconds), total, index, seg, segElapsed, segRemaining,
   *      isLast, feedback: 'faster' | 'ok' | 'slower' | null, moving }
   */
  tick(s) {
    const out = this._decide(s);
    if (out) this.lastSpokeAt = s.t;
    return out;
  }

  _decide(s) {
    const { t, total, seg, segElapsed, segRemaining } = s;
    const kind = seg.kind ?? 'work';
    const easyEnds = kind === 'warmup' || kind === 'cooldown';

    // Pace tracking (always updated, even when we stay quiet).
    if (s.feedback === 'faster' || s.feedback === 'slower') {
      this.offPaceFor = this.offPaceKind === s.feedback ? this.offPaceFor + 1 : 1;
      this.offPaceKind = s.feedback;
      this.okFor = 0;
    } else if (s.feedback === 'ok') {
      this.okFor++;
      this.offPaceFor = 0;
      this.offPaceKind = null;
    }

    // Time-critical lines may break the quiet window.
    const hard = isHard(seg);
    if (hard && seg.duration >= 25 && Math.round(segRemaining) === 10 && !this.said.has(`ten-${s.index}`)) {
      this.said.add(`ten-${s.index}`);
      return ['ten-seconds'];
    }
    if (total >= 240 && Math.round(total - t) === 60 && !this.said.has('one-minute')) {
      this.said.add('one-minute');
      return ['one-minute'];
    }

    // Everything else waits for a quiet moment away from announcements.
    const quiet = t - this.lastSpokeAt >= this.quietAfterS && segElapsed >= 6 && segRemaining > 8;
    if (!quiet || !s.moving) return null;

    if (t >= total / 2 && total >= 300 && !this.said.has('halfway-workout')) {
      this.said.add('halfway-workout');
      return ['halfway-workout'];
    }

    // Back on track after a pace cue.
    if (this.awaitingRecovery && this.okFor >= 4) {
      this.awaitingRecovery = false;
      return [this.decks.ontrack.next()];
    }
    // Off pace for a while → nudge (not during warm-up / cool-down).
    if (!easyEnds && this.offPaceFor >= this.paceAfterS && t - this.lastPaceCueAt >= this.paceGapS) {
      this.lastPaceCueAt = t;
      this.awaitingRecovery = true;
      this.offPaceFor = 0;
      return [this.offPaceKind === 'faster' ? this.decks.behind.next() : this.decks.fast.next()];
    }

    // Hard segments: one boost around the middle.
    if (hard && this.boostedSegment !== s.index && segElapsed >= seg.duration * 0.4) {
      this.boostedSegment = s.index;
      return [this.decks.boost.next()];
    }

    // Motivation every 60–90 s.
    if (t >= this.nextMotivationAt) {
      this.nextMotivationAt = this._gap(t);
      return [this.decks.motivate.next()];
    }
    return null;
  }
}
