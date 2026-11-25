const BASE = import.meta.env.BASE_URL;

/** Recorded human sounds in public/audio/sfx/human/ (index.json: name -> files). */
export type HumanSound = 'gasp' | 'grunt' | 'yelp' | 'scream' | 'land' | 'breath' | 'laugh' | 'crowd';

export type Surface = 'stone' | 'grass' | 'wood' | 'carpet' | 'snow' | 'metal';
export type Space = 'open' | 'street' | 'room' | 'ship' | 'hall';
/** Reverb per space: tail length, brightness (low-pass on the tail, Hz), early reflections, send level. */
const SPACES: Record<Exclude<Space, 'open'>, { secs: number; bright: number; early: number; wet: number }> = {
  street: { secs: 1.1, bright: 5000, early: 0.5, wet: 0.16 },
  room: { secs: 0.55, bright: 3800, early: 0.8, wet: 0.2 },
  ship: { secs: 1.4, bright: 7000, early: 0.9, wet: 0.24 },
  hall: { secs: 3.2, bright: 4200, early: 0.4, wet: 0.32 },
};
/** Beds that are outside: heard through the walls when you are in. */
const OUTDOOR_BEDS = new Set(['amb_bazaar', 'amb_street', 'amb_traffic', 'amb_walla', 'amb_rain', 'amb_wind']);
/** A room's answer: decaying stereo noise, a few early reflections, the top rolled off as it dies. */
function impulse(ctx: BaseAudioContext, secs: number, bright: number, early: number) {
  const sr = ctx.sampleRate, n = Math.floor(sr * secs), b = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let z = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // a one-pole low-pass whose corner falls from `bright` to a third of it as the tail dies
      const fc = bright * (1 - 0.66 * t), a = Math.exp(-2 * Math.PI * fc / sr);
      z = z * a + (Math.random() * 2 - 1) * (1 - a);
      d[i] = z * Math.pow(1 - t, 3) * 2.5;
    }
    // early reflections: a handful of taps in the first 60 ms
    for (let r = 0; r < 7; r++) { const i = Math.floor(sr * (0.007 + Math.random() * 0.055)); if (i < n) d[i] += (Math.random() < 0.5 ? -1 : 1) * early * (0.6 - r * 0.06); }
  }
  return b;
}

// WebAudio soundscape synthesised at runtime, plus a few recorded human sounds.
export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private drone: GainNode | null = null;
  private wind: GainNode | null = null;
  private alarmTimer = 0;
  volume = 0.7;
  private buses: { music: GainNode; sfx: GainNode; voice: GainNode; analyser: AnalyserNode } | null = null;
  private mix = { music: 0.6, sfx: 0.8, voice: 1, muted: false };
  private ducked = false;
  private meter = new Uint8Array(256);
  private humans: Promise<Map<string, AudioBuffer[]>> | null = null;
  private lastHuman = new Map<string, AudioBuffer>();
  private clickBuf: AudioBuffer | null = null;
  private lastUi = 0;

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
    } catch { return; }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.mix.muted ? 0 : this.volume;
    // everything passes one last filter: open, except where there is no air to carry sound (vacuum())
    this.vac = this.ctx.createBiquadFilter(); this.vac.type = 'lowpass'; this.vac.frequency.value = 20000; this.vac.Q.value = 0.7;
    // the very last node: the speakers and the recording tap both hang off it, so the vacuum heartbeat and the capture
    // sync marks (which bypass the mix) are recorded too
    this.post = this.ctx.createGain();
    this.master.connect(this.vac).connect(this.post).connect(this.ctx.destination);
    const music = this.ctx.createGain(), sfx = this.ctx.createGain(), voice = this.ctx.createGain();
    const analyser = this.ctx.createAnalyser(); analyser.fftSize = 256;
    music.connect(this.master); sfx.connect(this.master); voice.connect(analyser); analyser.connect(this.master);
    this.buses = { music, sfx, voice, analyser };
    this.applyMix();
    void this.loadHumans();
    void this.loadSfx().then(() => this.preloadSfx('ui_', 'pickup', 'step_'));
  }

  private loadHumans() {
    this.humans ??= (async () => {
      const out = new Map<string, AudioBuffer[]>();
      try {
        const r = await fetch(`${BASE}audio/sfx/human/index.json`);
        if (!r.ok) return out;
        const index = await r.json() as Record<string, string[]>;
        await Promise.all(Object.entries(index).map(async ([name, files]) => {
          const got = await Promise.all(files.map(async (f) => {
            try {
              const a = await fetch(`${BASE}audio/sfx/human/${f}`);
              return a.ok ? await this.ctx!.decodeAudioData(await a.arrayBuffer()) : null;
            } catch { return null; }
          }));
          out.set(name, got.filter((b): b is AudioBuffer => !!b));
        }));
      } catch { /* the game just stays quieter */ }
      return out;
    })();
    return this.humans;
  }

  /** Play a recorded human sound (random take, never the same one twice running). */
  human(name: HumanSound, vol = 0.8) {
    if (!this.ctx) return;
    void this.loadHumans().then((all) => {
      const takes = all.get(name), ctx = this.ctx;
      if (!takes?.length || !ctx) return;
      const fresh = takes.length > 1 ? takes.filter((b) => b !== this.lastHuman.get(name)) : takes;
      const buf = fresh[Math.floor(Math.random() * fresh.length)];
      this.lastHuman.set(name, buf);
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.playbackRate.value = 0.96 + Math.random() * 0.08; g.gain.value = vol;
      src.connect(g).connect(this.sfxOut); src.start();
    });
  }

  private applyMix() {
    if (!this.ctx || !this.buses) return;
    // under a spoken line the music drops to a third and the effects to half, fast, and come back slowly: a line said
    // over the title sequence's loudest bars ("You still owe me snacks!") was lost at the old 0.45 and 0.7
    const t = this.ctx.currentTime, d = this.ducked ? 0.3 : 1, b = this.buses, tc = this.ducked ? 0.05 : 0.3;
    b.music.gain.setTargetAtTime(this.mix.music * d, t, tc);
    b.sfx.gain.setTargetAtTime(this.mix.sfx * (this.ducked ? 0.5 : 1), t, tc);
    b.voice.gain.setTargetAtTime(this.mix.voice, t, 0.05);
  }

  /** Bus levels 0..1 and global mute. */
  setMix(m: { music?: number; sfx?: number; voice?: number; muted?: boolean }) {
    Object.assign(this.mix, m);
    this.applyMix();
    this.setVolume(this.volume);
  }

  voiceIn(): AudioNode { return this.buses!.voice; }
  private memBus: AudioNode | null = null;
  /** A remembered voice: no low end and no air (a phone-thin band), a little quieter, with a short soft echo, so it
   * reads as inside his head and not as someone standing there. Feeds the voice bus (ducking and volume as usual). */
  memoryIn(): AudioNode {
    if (this.memBus) return this.memBus;
    const ctx = this.ctx!, out = this.buses!.voice;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420; hp.Q.value = 0.8;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.9;
    const dry = ctx.createGain(); dry.gain.value = 0.8;
    const dl = ctx.createDelay(1); dl.delayTime.value = 0.13;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const wet = ctx.createGain(); wet.gain.value = 0.38;
    hp.connect(lp); lp.connect(dry).connect(out);
    lp.connect(dl); dl.connect(fb).connect(dl); dl.connect(wet).connect(out);
    this.memBus = hp;
    return hp;
  }

  // ---------------------------------------------------------------- the space you are in
  // Everything in the world (effects, beds, voices a little) is sent to a reverb shaped like where you stand, and the
  // beds that belong outside (street, traffic, crowd, rain) go through a low-pass that closes when you go in.
  private outdoor: BiquadFilterNode | null = null;
  private outdoorGain: GainNode | null = null;
  private get outdoorOut(): AudioNode {
    if (!this.ctx) return this.master;
    if (!this.outdoor) {
      const f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      f.type = 'lowpass'; f.frequency.value = 20000; f.Q.value = 0.5;
      f.connect(g).connect(this.sfxOut);
      this.outdoor = f; this.outdoorGain = g;
    }
    return this.outdoor;
  }
  private inside = 0;
  /** 0 outside, 1 indoors with the windows shut: the outside beds lose their top and some level. */
  setIndoors(k: number) {
    if (!this.ctx || Math.abs(k - this.inside) < 0.01) return;
    this.inside = k;
    const t = this.ctx.currentTime;
    void this.outdoorOut;
    this.outdoor!.frequency.setTargetAtTime(20000 * Math.pow(650 / 20000, k), t, 0.25);
    this.outdoorGain!.gain.setTargetAtTime(1 - 0.45 * k, t, 0.25);
  }
  private spaces = new Map<Space, { conv: ConvolverNode; wet: GainNode }>();
  private space: Space = 'open';
  /** Reverb for where the ears are: open air, a street between buildings, a room, the liner's deck, the Vault. */
  setSpace(sp: Space) {
    const ctx = this.ctx;
    if (!ctx || !this.buses || sp === this.space) return;
    this.space = sp;
    const t = ctx.currentTime;
    for (const [k, v] of this.spaces) if (k !== sp) v.wet.gain.setTargetAtTime(0, t, 0.4);
    if (sp === 'open') return;
    let s = this.spaces.get(sp);
    if (!s) {
      const P = SPACES[sp];
      const conv = ctx.createConvolver(), wet = ctx.createGain();
      conv.buffer = impulse(ctx, P.secs, P.bright, P.early);
      wet.gain.value = 0;
      this.buses.sfx.connect(conv); conv.connect(wet).connect(this.master);
      // voices get the room too, but less: they must stay clear
      const vs = ctx.createGain(); vs.gain.value = 0.35; this.buses.voice.connect(vs).connect(conv);
      s = { conv, wet }; this.spaces.set(sp, s);
    }
    s.wet.gain.setTargetAtTime(SPACES[sp].wet, t, 0.4);
  }
  private vac: BiquadFilterNode | null = null;
  private vacTimer = 0;
  /** No air: the world is heard as from inside your own head (everything muffled), over your own heartbeat. */
  vacuum(on: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.vac) return;
    this.vac.frequency.setTargetAtTime(on ? 380 : 20000, ctx.currentTime, on ? 0.04 : 0.25);
    clearInterval(this.vacTimer);
    if (!on) return;
    const beat = () => { if (!this.ctx) return; const t = this.ctx.currentTime; for (const [dt, v] of [[0, 0.5], [0.16, 0.32]] as [number, number][]) { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.setValueAtTime(62, t + dt); o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.12); g.gain.setValueAtTime(0, t + dt); g.gain.linearRampToValueAtTime(v, t + dt + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.2); o.connect(g).connect(this.post ?? this.ctx.destination); o.start(t + dt); o.stop(t + dt + 0.25); } };
    beat(); this.vacTimer = window.setInterval(beat, 860);
  }
  private post: GainNode | null = null;
  /** A capture sync mark: a short beep (2 kHz for syncMark, 1.5 kHz for syncTest) straight onto the last node (no mix, duck, filter or vacuum), at the
   *  audio clock's now. Returns that audio-clock time. */
  mark(dur = 0.06, freq = 2000): number {
    const ctx = this.ctx; if (!ctx || !this.post) return 0;
    const t0 = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.5, t0 + 0.003); g.gain.setValueAtTime(0.5, t0 + dur); g.gain.linearRampToValueAtTime(0, t0 + dur + 0.005);
    o.connect(g).connect(this.post); o.start(t0); o.stop(t0 + dur + 0.02);
    return t0;
  }
  private tapNode: MediaStreamAudioDestinationNode | null = null;
  /** What the speakers get, as a stream (recordings of real play: tools/gpu_capture.py). */
  tap(): MediaStream | null {
    if (!this.ctx) return null;
    if (!this.tapNode) { this.tapNode = this.ctx.createMediaStreamDestination(); (this.post ?? this.master).connect(this.tapNode); }
    return this.tapNode.stream;
  }
  duck(on: boolean) { this.ducked = on; this.applyMix(); }
  private slept = false;
  /** Silence everything while the page or app is hidden, and pick up where it was after. */
  sleep(on: boolean) {
    const c = this.ctx;
    if (!c) return;
    if (on && c.state === 'running') { this.slept = true; void c.suspend(); }
    else if (!on && this.slept) { this.slept = false; void c.resume(); }
  }
  voiceLevel() {
    if (!this.buses) return 0;
    this.buses.analyser.getByteTimeDomainData(this.meter);
    let s = 0;
    for (let i = 0; i < this.meter.length; i++) { const v = (this.meter[i] - 128) / 128; s += v * v; }
    return Math.min(1, Math.sqrt(s / this.meter.length) * 4);
  }
  private get sfxOut(): AudioNode { return this.buses?.sfx ?? this.master; }
  private get musicOut(): AudioNode { return this.buses?.music ?? this.master; }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(this.mix.muted ? 0 : v, this.ctx.currentTime, 0.1);
  }

  private noiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    return b;
  }

  /** Space pad for the cinematic. */
  startDrone() {
    if (!this.ctx || this.drone) return;
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    [55, 82.4, 110.3, 164.8].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? 'sawtooth' : 'triangle';
      o.frequency.value = f; o.detune.value = (i - 1.5) * 7;
      const og = ctx.createGain(); og.gain.value = 0.12 / (i + 1);
      o.connect(og).connect(lp); o.start();
    });
    lp.connect(g).connect(this.musicOut);
    g.gain.setTargetAtTime(0.5, ctx.currentTime, 2);
    this.drone = g;
  }

  stopDrone() {
    if (!this.ctx || !this.drone) return;
    const g = this.drone; this.drone = null;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
    setTimeout(() => g.disconnect(), 3000);
  }

  private scores = new Map<string, Promise<AudioBuffer | null>>();
  private scoreBuffer(name: string) {
    let p = this.scores.get(name);
    if (!p) {
      p = (async () => {
        try {
          const r = await fetch(`${BASE}audio/music/${name}.mp3`);
          return r.ok && this.ctx ? await this.ctx.decodeAudioData(await r.arrayBuffer()) : null;
        } catch { return null; }
      })();
      this.scores.set(name, p);
    }
    return p;
  }
  /** Fetch and decode ahead of time, so the first note lands on time. */
  preloadScore(...names: string[]) { if (this.ctx) names.forEach((n) => void this.scoreBuffer(n)); }

  /**
   * Music and its sound-design stem, started on the same sample, each on its own bus.
   * `now` is seconds into the score on the audio clock: picture follows it.
   */
  async playScore(music: string, sfx: string) {
    const ctx = this.ctx;
    if (!ctx) return null;
    const [m, s] = await Promise.all([this.scoreBuffer(music), this.scoreBuffer(sfx)]);
    if (!m) return null;
    const t0 = ctx.currentTime + 0.08;
    const nodes = ([[m, this.musicOut], [s, this.sfxOut]] as [AudioBuffer | null, AudioNode][]).filter((n): n is [AudioBuffer, AudioNode] => !!n[0]).map(([buf, out]) => {
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.connect(g).connect(out); src.start(t0);
      return { src, g };
    });
    return {
      now: () => (ctx.state === 'running' ? ctx.currentTime - t0 : undefined),
      stop: () => nodes.forEach(({ src, g }) => { g.gain.setTargetAtTime(0, ctx.currentTime, 0.12); try { src.stop(ctx.currentTime + 0.7); } catch { /* over already */ } }),
    };
  }

  /** Forest wind bed for the planet. */
  startWind() {
    if (!this.ctx || this.wind) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer(); src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 220; lfo.connect(lfoG).connect(bp.frequency); lfo.start();
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp).connect(g).connect(this.sfxOut); src.start();
    g.gain.setTargetAtTime(0.35, ctx.currentTime, 3);
    this.wind = g;
  }

  stopWind() {
    if (!this.ctx || !this.wind) return;
    const g = this.wind; this.wind = null;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    setTimeout(() => g.disconnect(), 2000);
  }

  tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, when = 0, slide = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.sfxOut); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  blip() { this.tone(880, 0.12, 'sine', 0.15); this.tone(1320, 0.15, 'sine', 0.1, 0.06); }
  chime() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 1.2, 'sine', 0.12, i * 0.11)); }
  /** Short filtered noise: the body of every UI sound. */
  private tick(freq: number, q: number, dur: number, vol: number, when = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime + when;
    this.clickBuf ??= (() => { const b = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; })();
    const src = ctx.createBufferSource(); src.buffer = this.clickBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfxOut); src.start(t0, Math.random() * 0.3); src.stop(t0 + dur + 0.02);
  }
  /** One UI sound per moment: code that still calls uiClick next to the global handler stays single. */
  private once(ms = 45) { const n = performance.now(); if (n - this.lastUi < ms) return false; this.lastUi = n; return true; }
  uiClick() { if (this.once() && !this.sample('ui_click', 0.32)) { this.tick(2300, 1.4, 0.05, 0.28); this.tone(170, 0.07, 'sine', 0.13, 0, -70); } }
  uiMove() { if (this.once(30)) this.tick(3400, 3, 0.025, 0.12); }
  uiBack() { if (this.once() && !this.sample('ui_back', 0.32)) { this.tick(1500, 1.4, 0.05, 0.2); this.tone(240, 0.09, 'sine', 0.1, 0, -120); } }
  uiToggle() { if (this.once() && !this.sample('ui_toggle', 0.3)) { this.tick(2800, 2, 0.03, 0.2); this.tick(1900, 2, 0.03, 0.14, 0.035); } }
  uiSlider(v: number) { if (this.once(55)) this.tick(900 + v * 1800, 6, 0.03, 0.14); }
  uiOpen() { if (this.sample('ui_open', 0.28)) return; this.tick(700, 0.8, 0.16, 0.16); this.tone(210, 0.14, 'sine', 0.07, 0, 170); }
  uiClose() { if (this.sample('ui_close', 0.28)) return; this.tick(520, 0.8, 0.13, 0.13); this.tone(320, 0.12, 'sine', 0.06, 0, -170); }
  uiTab() { if (this.once()) { this.tick(1200, 1, 0.08, 0.15); this.tick(2600, 2, 0.03, 0.1, 0.03); } }
  uiWheel() { this.tick(1600, 1, 0.1, 0.12); this.tone(300, 0.1, 'sine', 0.06, 0, 200); }
  uiDenied() { if (this.sample('ui_error', 0.3)) return; this.tone(130, 0.08, 'square', 0.05); this.tone(110, 0.1, 'square', 0.05, 0.09); }
  uiListen() { this.tone(980, 0.09, 'sine', 0.07); }
  uiBound() { this.tone(980, 0.06, 'sine', 0.07); this.tone(1470, 0.1, 'sine', 0.07, 0.06); }
  pickup() { if (this.sample('pickup', 0.5)) return; this.tick(1100, 1.2, 0.06, 0.16); this.tone(620, 0.09, 'sine', 0.06, 0.02, 180); }
  hurt() { this.tone(160, 0.5, 'sawtooth', 0.15, 0, -90); }
  beep() { this.tone(1046, 0.08, 'square', 0.05); }
  thud() { this.tone(48, 1.4, 'sine', 0.5, 0, -18); this.tone(70, 0.6, 'triangle', 0.2); }
  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx; const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.5;
    f.frequency.setValueAtTime(200, ctx.currentTime); f.frequency.exponentialRampToValueAtTime(3000, ctx.currentTime + 3);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 2.5); g.gain.linearRampToValueAtTime(0, ctx.currentTime + 4);
    src.connect(f).connect(g).connect(this.sfxOut); src.start(); src.stop(ctx.currentTime + 4.2);
  }

  /** Test hook (recordings): the clock frames are recorded on; while set, what is played is written to `log`. */
  manual: (() => number) | null = null;
  log: { path: string; at: number; vol: number; loop?: boolean; until?: number }[] = [];
  private note(path: string, vol: number, delay = 0, loop = false) {
    if (!this.manual) return;
    const at = this.manual() + delay;
    if (loop) for (const e of this.log) if (e.loop && e.until === undefined && e.path === path) e.until = at;
    this.log.push({ path, at, vol, loop: loop || undefined });
    if (this.log.length > 800) this.log.shift();
  }
  private endLoop(path: string) { if (!this.manual) return; const at = this.manual(); for (const e of this.log) if (e.loop && e.until === undefined && e.path === path) e.until = at; }

  // ---------------------------------------------------------------- recorded soundscape
  // public/audio/sfx/index.json and music/index.json (tools/fetch_sounds.py): name -> file. `step_grass` picks one of
  // step_grass_1..5 at random, never the same one twice running.
  private sfxIdx: Promise<Record<string, { f: string; d: number; loop: boolean }>> | null = null;
  private sfxNames: Record<string, { f: string; d: number; loop: boolean }> = {};
  private musicIdx: Record<string, { f: string; d: number }> = {};
  private sfxBuf = new Map<string, Promise<AudioBuffer | null>>();
  private ready = new Map<string, AudioBuffer>();
  private lastPick = new Map<string, string>();
  private loadSfx() {
    this.sfxIdx ??= (async () => {
      try {
        const [a, b] = await Promise.all([fetch(`${BASE}audio/sfx/index.json`), fetch(`${BASE}audio/music/index.json`)]);
        if (a.ok) this.sfxNames = await a.json();
        if (b.ok) this.musicIdx = await b.json();
      } catch { /* no recorded sound: the synthesised one stays */ }
      return this.sfxNames;
    })();
    return this.sfxIdx;
  }
  private buf(path: string): Promise<AudioBuffer | null> {
    let p = this.sfxBuf.get(path);
    if (!p) {
      p = (async () => {
        try {
          const r = await fetch(`${BASE}audio/${path}`);
          const b = r.ok && this.ctx ? await this.ctx.decodeAudioData(await r.arrayBuffer()) : null;
          if (b) this.ready.set(path, b);
          return b;
        } catch { return null; }
      })();
      this.sfxBuf.set(path, p);
    }
    return p;
  }
  private variants(name: string) {
    const n = this.sfxNames;
    if (n[name]) return [name];
    const out: string[] = [];
    for (let i = 1; n[`${name}_${i}`]; i++) out.push(`${name}_${i}`);
    return out;
  }
  private pick(name: string) {
    const v = this.variants(name);
    if (!v.length) return null;
    const last = this.lastPick.get(name), pool = v.length > 1 ? v.filter((x) => x !== last) : v;
    const k = pool[Math.floor(Math.random() * pool.length)];
    this.lastPick.set(name, k);
    return `sfx/${this.sfxNames[k].f}`;
  }
  /** Decode ahead: every sound whose name starts with one of these. */
  preloadSfx(...prefixes: string[]) {
    if (!this.ctx) return;
    void this.loadSfx().then((n) => { for (const k in n) if (prefixes.some((p) => k.startsWith(p))) void this.buf(`sfx/${n[k].f}`); });
  }
  /** Is there a recorded sound by this name (or numbered takes of it)? */
  hasSfx(name: string) { return this.variants(name).length > 0; }

  private panner(at: { x: number; y: number; z: number }, near: number, far: number) {
    const ctx = this.ctx!, p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = near; p.maxDistance = far; p.rolloffFactor = 1.1;
    p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z;
    return p;
  }
  /** Where the ears are: the camera. Call every frame the world is heard. */
  private ear = { x: 0, y: 0, z: 0 };
  /** Where the ears are now (the camera). */
  get earPos(): { readonly x: number; readonly y: number; readonly z: number } { return this.ear; }
  listen(pos: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }, up = { x: 0, y: 1, z: 0 }) {
    this.ear.x = pos.x; this.ear.y = pos.y; this.ear.z = pos.z;
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      const t = this.ctx!.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.02); l.positionY.setTargetAtTime(pos.y, t, 0.02); l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02); l.forwardY.setTargetAtTime(fwd.y, t, 0.02); l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    } else { l.setPosition(pos.x, pos.y, pos.z); l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }

  /**
   * A one-shot recorded sound. With `at` it sits in the world (HRTF, fading with distance from `near` to `far` m).
   * Returns false when it is not loaded yet (it starts loading), so callers can fall back to a synthesised one.
   */
  sample(name: string, vol = 0.8, o: { at?: { x: number; y: number; z: number }; near?: number; far?: number; rate?: number; delay?: number; outside?: boolean; dur?: number; tag?: string } = {}): boolean {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return false;
    if (!this.sfxIdx) { void this.loadSfx(); return false; }
    const path = this.pick(name);
    if (!path) return false;
    if (this.manual) {
      // the log carries what the ears would hear: the panner's inverse-distance fall-off from where the camera is
      const near = o.near ?? 2, d = o.at ? Math.max(near, Math.hypot(o.at.x - this.ear.x, o.at.y - this.ear.y, o.at.z - this.ear.z)) : near;
      this.note(path, vol * near / (near + 1.1 * (d - near)), o.delay ?? 0);
    }
    const b = this.ready.get(path);
    if (!b) { void this.buf(path); return false; }
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b; src.playbackRate.value = (o.rate ?? 1) * (0.95 + Math.random() * 0.1); g.gain.value = vol;
    let node: AudioNode = src.connect(g);
    if (o.at) node = node.connect(this.panner(o.at, o.near ?? 2, o.far ?? 60));
    // a sound placed outside while you are in: through the walls (muffled), like the street beds
    node.connect(o.at && o.outside ? this.outdoorOut : this.sfxOut);
    const t0 = ctx.currentTime + (o.delay ?? 0);
    src.start(t0);
    // `dur`: only the first seconds of the file, faded out over the last half second of them
    if (o.dur) { g.gain.setValueAtTime(vol, t0 + Math.max(0, o.dur - 0.6)); g.gain.linearRampToValueAtTime(0, t0 + o.dur); src.stop(t0 + o.dur + 0.05); }
    // `tag`: stopTag() can fade it out early (a skipped scene's sounds)
    if (o.tag) { const set = this.tagged.get(o.tag) ?? this.tagged.set(o.tag, new Set()).get(o.tag)!; const h = { src, g }; set.add(h); src.onended = () => set.delete(h); }
    return true;
  }
  private tagged = new Map<string, Set<{ src: AudioBufferSourceNode; g: GainNode }>>();
  /** Fades out (over `fade` s) and stops every sound started with this tag. */
  stopTag(tag: string, fade = 0.3) {
    const ctx = this.ctx, set = this.tagged.get(tag);
    if (!ctx || !set) return;
    for (const { src, g } of set) { g.gain.cancelScheduledValues(ctx.currentTime); g.gain.setValueAtTime(g.gain.value, ctx.currentTime); g.gain.linearRampToValueAtTime(0, ctx.currentTime + fade); try { src.stop(ctx.currentTime + fade + 0.05); } catch { /* already stopped */ } }
    set.clear();
  }

  /** A footstep on a surface: stone, grass, wood, carpet, snow, metal. */
  step(surface: Surface, vol = 0.5, at?: { x: number; y: number; z: number }) {
    this.sample(`step_${surface}`, vol, at ? { at, near: 1.5, far: 25 } : {});
  }

  private beds = new Map<string, { src: AudioBufferSourceNode; g: GainNode; want: number }>();
  private bedWant: Record<string, number> = {};
  /**
   * The ambience: name -> level (0..1) for every bed that should be playing; the rest fade out. Beds are stereo
   * loops (city murmur, traffic, wind, birds, room tone, ship hum).
   */
  setBeds(want: Record<string, number>, fade = 2.5) {
    this.bedWant = want;
    const ctx = this.ctx;
    if (!ctx) return;
    void this.loadSfx().then(async () => {
      if (this.bedWant !== want) return;
      for (const [name, b] of this.beds) if (!(name in want)) {
        this.endLoop(`sfx/${this.sfxNames[name]?.f}`);
        b.g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
        const s = b.src; window.setTimeout(() => { try { s.stop(); } catch { /* over */ } }, fade * 1000 + 200);
        this.beds.delete(name);
      }
      for (const [name, v] of Object.entries(want)) {
        const cur = this.beds.get(name);
        if (cur) { cur.want = v; cur.g.gain.setTargetAtTime(v, ctx.currentTime, fade / 3); continue; }
        const e = this.sfxNames[name];
        if (!e) continue;
        const buf = await this.buf(`sfx/${e.f}`);
        if (!buf || this.bedWant !== want || this.beds.has(name)) continue;
        const src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = buf; src.loop = true; g.gain.value = 0;
        src.connect(g).connect(OUTDOOR_BEDS.has(name) ? this.outdoorOut : this.sfxOut);
        src.start(ctx.currentTime, Math.random() * buf.duration);
        g.gain.setTargetAtTime(v, ctx.currentTime, fade / 3);
        this.beds.set(name, { src, g, want: v });
        this.note(`sfx/${e.f}`, v, 0, true);
      }
    });
  }
  /** Change one bed's level without touching the others (inside/outside, day/night). */
  bedLevel(name: string, v: number, fade = 1.2) {
    const b = this.beds.get(name);
    if (this.bedWant[name] !== undefined) this.bedWant[name] = v;
    if (b && this.ctx) { b.want = v; b.g.gain.setTargetAtTime(v, this.ctx.currentTime, fade / 3); }
  }

  private track: { name: string; src: AudioBufferSourceNode; g: GainNode } | null = null;
  private trackWant: string | null = null;
  /** Music for where you are: crossfades from what is playing; null fades it out. Tracks loop. */
  music(name: string | null, vol = 1, fade = 3) {
    if (this.trackWant === name && this.track?.name === name) { if (this.track && this.ctx) this.track.g.gain.setTargetAtTime(vol, this.ctx.currentTime, fade / 3); return; }
    this.trackWant = name;
    const ctx = this.ctx;
    if (!ctx) return;
    const old = this.track;
    if (old && old.name !== name) {
      this.endLoop(`music/${this.musicIdx[old.name]?.f}`);
      old.g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
      window.setTimeout(() => { try { old.src.stop(); } catch { /* over */ } }, fade * 1000 + 300);
      this.track = null;
    }
    if (!name) return;
    void this.loadSfx().then(async () => {
      const e = this.musicIdx[name];
      if (!e || this.trackWant !== name) return;
      const buf = await this.buf(`music/${e.f}`);
      if (!buf || this.trackWant !== name || this.track?.name === name) return;
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.loop = true; g.gain.value = 0;
      src.connect(g).connect(this.musicOut); src.start();
      g.gain.setTargetAtTime(vol, ctx.currentTime, fade / 3);
      this.track = { name, src, g };
      this.note(`music/${e.f}`, vol, 0, true);
    });
  }
  get musicPlaying() { return this.track?.name ?? null; }
  get bedsPlaying() { return [...this.beds.keys()]; }

  /** A looping sound fixed in the world (a fire, an engine, a fountain): move it, change its level, stop it. */
  emitter(name: string, at: { x: number; y: number; z: number }, vol = 0.8, near = 3, far = 50) {
    const ctx = this.ctx;
    let live: { src: AudioBufferSourceNode; g: GainNode; p: PannerNode } | null = null, stopped = false;
    if (ctx) void this.loadSfx().then(async () => {
      const e = this.sfxNames[name] ?? this.sfxNames[`${name}_1`];
      if (!e) return;
      const buf = await this.buf(`sfx/${e.f}`);
      if (!buf || stopped) return;
      const src = ctx.createBufferSource(), g = ctx.createGain(), p = this.panner(at, near, far);
      src.buffer = buf; src.loop = true; g.gain.value = 0;
      src.connect(g).connect(p).connect(this.sfxOut); src.start(ctx.currentTime, Math.random() * buf.duration);
      g.gain.setTargetAtTime(vol, ctx.currentTime, 0.4);
      live = { src, g, p };
    });
    return {
      move(v: { x: number; y: number; z: number }) { at = v; if (live) { live.p.positionX.value = v.x; live.p.positionY.value = v.y; live.p.positionZ.value = v.z; } },
      set(v: number) { vol = v; if (live && ctx) live.g.gain.setTargetAtTime(v, ctx.currentTime, 0.2); },
      stop() { stopped = true; if (live && ctx) { const l = live; l.g.gain.setTargetAtTime(0, ctx.currentTime, 0.2); window.setTimeout(() => { try { l.src.stop(); } catch { /* over */ } }, 900); live = null; } },
    };
  }

  alarm(on: boolean) {
    clearInterval(this.alarmTimer);
    if (!on || !this.ctx) return;
    const fire = () => { this.tone(740, 0.35, 'square', 0.07); this.tone(554, 0.35, 'square', 0.07, 0.38); };
    fire();
    this.alarmTimer = window.setInterval(fire, 800);
  }
}

export const audio = new Audio();
