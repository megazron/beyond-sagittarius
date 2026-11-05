// Fully synthesised WebAudio soundscape (no audio files).
export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private drone: GainNode | null = null;
  private wind: GainNode | null = null;
  private alarmTimer = 0;
  volume = 0.7;

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
    } catch { return; }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
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
    lp.connect(g).connect(this.master);
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
    src.connect(bp).connect(g).connect(this.master); src.start();
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
    o.connect(g).connect(this.master); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  blip() { this.tone(880, 0.12, 'sine', 0.15); this.tone(1320, 0.15, 'sine', 0.1, 0.06); }
  chime() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 1.2, 'sine', 0.12, i * 0.11)); }
  uiClick() { this.tone(1200, 0.05, 'square', 0.04); }
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
    src.connect(f).connect(g).connect(this.master); src.start(); src.stop(ctx.currentTime + 4.2);
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
