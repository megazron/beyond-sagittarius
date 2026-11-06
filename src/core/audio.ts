const BASE = import.meta.env.BASE_URL;

/** Recorded human sounds in public/audio/sfx/human/ (index.json: name -> files). */
export type HumanSound = 'gasp' | 'grunt' | 'yelp' | 'scream' | 'land' | 'breath' | 'laugh' | 'crowd';

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
    this.master.connect(this.ctx.destination);
    const music = this.ctx.createGain(), sfx = this.ctx.createGain(), voice = this.ctx.createGain();
    const analyser = this.ctx.createAnalyser(); analyser.fftSize = 256;
    music.connect(this.master); sfx.connect(this.master); voice.connect(analyser); analyser.connect(this.master);
    this.buses = { music, sfx, voice, analyser };
    this.applyMix();
    void this.loadHumans();
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
    const t = this.ctx.currentTime, d = this.ducked ? 0.45 : 1, b = this.buses;
    b.music.gain.setTargetAtTime(this.mix.music * d, t, 0.12);
    b.sfx.gain.setTargetAtTime(this.mix.sfx * (this.ducked ? 0.7 : 1), t, 0.12);
    b.voice.gain.setTargetAtTime(this.mix.voice, t, 0.05);
  }

  /** Bus levels 0..1 and global mute. */
  setMix(m: { music?: number; sfx?: number; voice?: number; muted?: boolean }) {
    Object.assign(this.mix, m);
    this.applyMix();
    this.setVolume(this.volume);
  }

  voiceIn(): AudioNode { return this.buses!.voice; }
  duck(on: boolean) { this.ducked = on; this.applyMix(); }
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
  uiClick() { if (this.once()) { this.tick(2300, 1.4, 0.05, 0.28); this.tone(170, 0.07, 'sine', 0.13, 0, -70); } }
  uiMove() { if (this.once(30)) this.tick(3400, 3, 0.025, 0.12); }
  uiBack() { if (this.once()) { this.tick(1500, 1.4, 0.05, 0.2); this.tone(240, 0.09, 'sine', 0.1, 0, -120); } }
  uiToggle() { if (this.once()) { this.tick(2800, 2, 0.03, 0.2); this.tick(1900, 2, 0.03, 0.14, 0.035); } }
  uiSlider(v: number) { if (this.once(55)) this.tick(900 + v * 1800, 6, 0.03, 0.14); }
  uiOpen() { this.tick(700, 0.8, 0.16, 0.16); this.tone(210, 0.14, 'sine', 0.07, 0, 170); }
  uiClose() { this.tick(520, 0.8, 0.13, 0.13); this.tone(320, 0.12, 'sine', 0.06, 0, -170); }
  uiTab() { if (this.once()) { this.tick(1200, 1, 0.08, 0.15); this.tick(2600, 2, 0.03, 0.1, 0.03); } }
  uiWheel() { this.tick(1600, 1, 0.1, 0.12); this.tone(300, 0.1, 'sine', 0.06, 0, 200); }
  uiDenied() { this.tone(130, 0.08, 'square', 0.05); this.tone(110, 0.1, 'square', 0.05, 0.09); }
  uiListen() { this.tone(980, 0.09, 'sine', 0.07); }
  uiBound() { this.tone(980, 0.06, 'sine', 0.07); this.tone(1470, 0.1, 'sine', 0.07, 0.06); }
  pickup() { this.tick(1100, 1.2, 0.06, 0.16); this.tone(620, 0.09, 'sine', 0.06, 0.02, 180); }
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

  alarm(on: boolean) {
    clearInterval(this.alarmTimer);
    if (!on || !this.ctx) return;
    const fire = () => { this.tone(740, 0.35, 'square', 0.07); this.tone(554, 0.35, 'square', 0.07, 0.38); };
    fire();
    this.alarmTimer = window.setInterval(fire, 800);
  }
}

export const audio = new Audio();
