// Plays the coach's recorded clips (ElevenLabs "Jessica", assets/voice/jessica)
// through Web Audio, chaining several clips into one sentence:
//   ['coming-up', 'seg-sprint', 'level-12'] → "Coming up… Sprint! Level twelve."
// Falls back to the browser's speech voice when a clip is missing or audio
// isn't unlocked yet.

const GAP = 0.12; // seconds between chained clips

export class CoachAudio {
  constructor({ base = 'assets/voice/jessica', version = '' } = {}) {
    this.base = base;
    this.version = version;
    this.texts = {};      // id → text (for the speech fallback)
    this.raw = new Map(); // id → ArrayBuffer (downloaded)
    this.buffers = new Map(); // id → AudioBuffer (decoded)
    this.ctx = null;
    this.current = [];    // playing source nodes
    this.busyUntil = 0;   // ctx time when the current sentence ends
    this.currentPriority = 0;
    this.loaded = false;
  }

  /** Download the manifest and all clips (≈1 MB). Safe to call early. */
  async load() {
    const q = this.version ? `?v=${this.version}` : '';
    const m = await (await fetch(`${this.base}/manifest.json${q}`)).json();
    this.texts = m.clips;
    await Promise.all(Object.keys(m.clips).map(async (id) => {
      try {
        const r = await fetch(`${this.base}/${id}.mp3${q}`);
        if (r.ok) this.raw.set(id, await r.arrayBuffer());
      } catch { /* missing clip → speech fallback */ }
    }));
    this.loaded = true;
    if (this.ctx) await this._decodeAll();
  }

  /** Give the player the (user-gesture unlocked) AudioContext. */
  async attach(ctx) {
    if (this.ctx === ctx) return;
    this.ctx = ctx;
    if (this.loaded) await this._decodeAll();
  }

  async _decodeAll() {
    for (const [id, data] of this.raw) {
      if (this.buffers.has(id)) continue;
      try {
        // decodeAudioData detaches the buffer, so give it a copy.
        this.buffers.set(id, await this.ctx.decodeAudioData(data.slice(0)));
      } catch { /* undecodable → fallback */ }
    }
  }

  has(id) { return id in this.texts; }
  text(ids) { return ids.map((id) => this.texts[id] ?? '').filter(Boolean).join(' '); }
  get speaking() { return !!this.ctx && this.ctx.currentTime < this.busyUntil; }

  /**
   * Play clips back to back. A higher-or-equal priority interrupts what is
   * playing; a lower one is dropped while something more important plays.
   * Returns true if played with recorded audio, false if it fell back/was dropped.
   */
  play(ids, { priority = 1, fallback } = {}) {
    if (this.speaking && priority < this.currentPriority) return false;
    const bufs = ids.map((id) => this.buffers.get(id));
    if (this.ctx && bufs.some((b) => !b) && ids.every((id) => this.raw.has(id))) {
      // Downloaded but not decoded yet (e.g. right after the first tap): decode
      // just these clips, then play – a fraction of a second later.
      Promise.all(ids.filter((id) => !this.buffers.has(id)).map(async (id) => {
        this.buffers.set(id, await this.ctx.decodeAudioData(this.raw.get(id).slice(0)));
      })).then(() => this.play(ids, { priority, fallback }), () => fallback?.(this.text(ids)));
      return true;
    }
    if (!this.ctx || bufs.some((b) => !b)) {
      fallback?.(this.text(ids));
      return false;
    }
    this.stop();
    let t = this.ctx.currentTime + 0.05;
    for (const b of bufs) {
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.connect(this.ctx.destination);
      src.start(t);
      this.current.push(src);
      t += b.duration + GAP;
    }
    this.busyUntil = t;
    this.currentPriority = priority;
    return true;
  }

  stop() {
    for (const s of this.current) { try { s.stop(); } catch { /* already ended */ } }
    this.current = [];
    this.busyUntil = 0;
  }
}
