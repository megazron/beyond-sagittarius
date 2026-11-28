import * as THREE from 'three';
import { audio } from '../core/audio';
import { Renderer } from '../core/renderer';
import type { Character } from '../characters/character';

// The kit MegaZroN's films are made with (see ~/megazron/ENTRANCES_v2.md): shots on a clock, a page that is written as
// the nib moves over it, his writing hand driven to the nib's point, and the film's own sounds. Each film is a plain
// timeline: the same second always gives the same picture, so a recording and the game show the same film.

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const smooth = sm;

/**
 * One shot: the camera from `a` to `b` (through `via`: a crane or an arc) over [t0, t1], looking from `la` to `lb`,
 * lens `fov` (vertical degrees), focus `f` (metres) with the blur `ap`. A cut is a new shot starting where the last
 * ended; a move is one shot.
 */
export interface Shot { origin?: () => THREE.Vector3; up?: THREE.Vector3; t0: number; t1: number; a: THREE.Vector3; b?: THREE.Vector3; via?: THREE.Vector3; la: THREE.Vector3; lb?: THREE.Vector3; fov?: [number, number]; f?: [number, number]; ap?: number; ease?: 'io' | 'lin' | 'in' | 'out'; look?: [number, number]; rack?: [number, number]; breath?: number; roll?: [number, number] }

const LK = new THREE.Vector3();
/** Puts the camera where the shot is at `t`; returns the shot's index. */
export function shoot(shots: Shot[], t: number, cam: THREE.PerspectiveCamera, at?: (t: number) => THREE.Vector3 | null): number {
  let i = 0; while (i + 1 < shots.length && t >= shots[i + 1].t0) i++;
  const s = shots[i], k = Math.min(1, Math.max(0, (t - s.t0) / Math.max(1e-3, s.t1 - s.t0)));
  const e = s.ease === 'lin' ? k : s.ease === 'in' ? k * k : s.ease === 'out' ? 1 - (1 - k) * (1 - k) : sm(0, 1, k);
  const b = s.b ?? s.a;
  if (s.via) { const u = 1 - e; cam.position.set(0, 0, 0).addScaledVector(s.a, u * u).addScaledVector(s.via, 2 * u * e).addScaledVector(b, e * e); }
  else cam.position.lerpVectors(s.a, b, e);
  // a shot can be placed relative to a live point (his head as he leans): a, b, via, la, lb are offsets from it
  const o = s.origin?.(); if (o) cam.position.add(o);
  // held, not locked off: a slow breath in the frame
  const br = s.breath ?? 1;
  cam.position.y += Math.sin(t * 0.6) * 0.004 * br; cam.position.x += Math.sin(t * 0.43 + 1) * 0.003 * br;
  const lk = s.look ? sm(s.look[0], s.look[1], k) : e;
  LK.lerpVectors(s.la, s.lb ?? s.la, lk);
  if (o) LK.add(o);
  const live = at?.(t); if (live) LK.copy(live);
  // looking down at a page, the frame's up is the page's top (else lookAt picks a roll and the writing runs sideways)
  if (s.up) cam.up.copy(s.up); else cam.up.set(0, 1, 0);
  cam.lookAt(LK);
  if (s.roll) cam.rotateZ(s.roll[0] + (s.roll[1] - s.roll[0]) * e);
  const fov = s.fov ? s.fov[0] + (s.fov[1] - s.fov[0]) * e : 36;
  if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
  if (s.f) {
    const rk = s.rack ? sm(s.rack[0], s.rack[1], k) : e;
    Renderer.current?.setDof(s.f[0] + (s.f[1] - s.f[0]) * rk, s.ap ?? 0.012);
  } else Renderer.current?.setDof(0, 0);
  return i;
}

/** A line of writing on a page: `text` written from t0 to t1 (or already there: t0 = t1 = -1), at x, y in page pixels. */
export interface Ink { text: string; x: number; y: number; t0: number; t1: number; size?: number; font?: string; color?: string; w?: number }

/**
 * A page (or a spread) drawn on a canvas, with writing that appears behind the nib. The canvas is the page as the
 * writer sees it (top is away from him). `nib(t)` is where on the page the nib is (pixels), or null when it is lifted.
 */
export class Page {
  canvas = document.createElement('canvas');
  tex: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private last = '';
  private widths = new Map<Ink, number>();
  constructor(public w: number, public h: number, private ground: (g: CanvasRenderingContext2D, w: number, h: number) => void, public ink: Ink[] = []) {
    this.canvas.width = w; this.canvas.height = h;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
  }
  private font(k: Ink) { return k.font ?? `${k.size ?? 44}px "Segoe Script", "Ink Free", "Bradley Hand", "Lucida Handwriting", cursive`; }
  private width(k: Ink) {
    let v = this.widths.get(k);
    if (v === undefined) { this.g.font = this.font(k); v = this.g.measureText(k.text).width; if (v > 0) this.widths.set(k, v); }
    return v;
  }
  /** How much of each line is written at t (0..1). */
  private part(k: Ink, t: number) { return k.t0 < 0 ? 1 : Math.min(1, Math.max(0, (t - k.t0) / Math.max(1e-3, k.t1 - k.t0))); }
  draw(t: number) {
    const parts = this.ink.map((k) => Math.round(this.part(k, t) * 400));
    const key = parts.join(',');
    if (key === this.last) return;
    this.last = key;
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.ground(g, this.w, this.h);
    for (const [i, k] of this.ink.entries()) {
      const p = parts[i] / 400; if (p <= 0) continue;
      const w = this.width(k);
      g.save();
      g.beginPath(); g.rect(k.x - 4, k.y - (k.size ?? 44) * 1.4, w * p + 6, (k.size ?? 44) * 2); g.clip();
      g.font = this.font(k); g.fillStyle = k.color ?? 'rgba(28,16,10,0.92)'; g.textBaseline = 'alphabetic';
      g.fillText(k.text, k.x, k.y);
      g.restore();
    }
    this.tex.needsUpdate = true;
  }
  /** The nib's point on the page at t (pixels) while a line is being written; null between lines. */
  nib(t: number): [number, number] | null {
    for (const k of this.ink) {
      if (k.t0 < 0 || t < k.t0 || t > k.t1) continue;
      const p = this.part(k, t), w = this.width(k), s = k.size ?? 44;
      // up and down through the letters, a little forward and back: a hand writing, not a ruler
      const ph = (t - k.t0) * 9.5;
      return [k.x + w * p + Math.sin(ph * 1.3) * s * 0.08, k.y - s * (0.28 + 0.26 * Math.sin(ph))];
    }
    return null;
  }
  /** Is the nib on the paper (a line in progress)? */
  writing(t: number) { return this.ink.some((k) => k.t0 >= 0 && t >= k.t0 && t <= k.t1); }
}

/** A ruled ledger paper: cream with grain and foxing, faint rules, a red margin. */
export function paperGround(opts: { rules?: number; margin?: number; tone?: string; cols?: number[]; spine?: boolean; scribble?: [number, number] } = {}) {
  let grain: HTMLCanvasElement | null = null;
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    if (!grain) {
      grain = document.createElement('canvas'); grain.width = w; grain.height = h;
      const q = grain.getContext('2d')!;
      q.fillStyle = opts.tone ?? '#e9dcbc'; q.fillRect(0, 0, w, h);
      // fibres and foxing (seeded, so every frame and every run is the same paper)
      let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 2600; i++) { q.fillStyle = `rgba(${90 + r() * 40},${60 + r() * 30},${30 + r() * 20},${0.03 + r() * 0.05})`; q.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2); }
      for (let i = 0; i < 18; i++) { const x = r() * w, y = r() * h, rr = 10 + r() * 50; const gr = q.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(150,100,50,0.10)'); gr.addColorStop(1, 'rgba(150,100,50,0)'); q.fillStyle = gr; q.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
      // darker towards the edges and the gutter
      const vg = q.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(70,40,15,0.28)'); q.fillStyle = vg; q.fillRect(0, 0, w, h);
      if (opts.spine) { const sp = q.createLinearGradient(w / 2 - 60, 0, w / 2 + 60, 0); sp.addColorStop(0, 'rgba(60,35,15,0)'); sp.addColorStop(0.5, 'rgba(60,35,15,0.45)'); sp.addColorStop(1, 'rgba(60,35,15,0)'); q.fillStyle = sp; q.fillRect(w / 2 - 60, 0, 120, h); }
      if (opts.rules) { q.strokeStyle = 'rgba(70,90,120,0.22)'; q.lineWidth = 2; for (let y = opts.rules * 2.2; y < h - 20; y += opts.rules) { q.beginPath(); q.moveTo(20, y); q.lineTo(w - 20, y); q.stroke(); } }
      if (opts.margin) { q.strokeStyle = 'rgba(160,40,30,0.35)'; q.lineWidth = 3; q.beginPath(); q.moveTo(opts.margin, 0); q.lineTo(opts.margin, h); q.stroke(); }
      // older entries, faded: a hand's rhythm without words (earlier pages of the volume)
      if (opts.scribble) {
        q.strokeStyle = 'rgba(80,52,32,0.42)'; q.lineWidth = 2.4; q.lineCap = 'round';
        for (let y = (opts.rules ?? 80) * 2.6; y < h - 60; y += opts.rules ?? 80) {
          let x = opts.scribble[0];
          while (x < opts.scribble[1]) {
            const wd = 40 + r() * 150; q.beginPath(); q.moveTo(x, y);
            for (let u = 0; u < wd; u += 4) q.lineTo(x + u, y - 8 - Math.abs(Math.sin(u * 0.21 + r())) * 18 * (0.5 + r() * 0.5));
            q.stroke(); x += wd + 18 + r() * 20;
          }
        }
      }
      for (const x of opts.cols ?? []) { q.strokeStyle = 'rgba(70,50,30,0.35)'; q.lineWidth = 2; q.beginPath(); q.moveTo(x, opts.rules ? opts.rules * 2.2 - 10 : 0); q.lineTo(x, h - 30); q.stroke(); }
    }
    g.drawImage(grain, 0, 0);
  };
}

/**
 * His writing hand: the right hand is held where the quill's nib lands on `nib` (a world point), closed-loop: each frame
 * the error between where the nib is and where it should be moves the hand target, so the nib really traces the
 * letters whatever the arm's chain does. With no point the hand rests on the page's lower edge below his shoulder.
 */
export class WritingHand {
  private at = new THREE.Vector3(); private fingers = V(0, -0.5, 1).normalize(); private palm = V(0.35, -0.9, 0.1).normalize();
  private off = new THREE.Vector3(0, 0.09, -0.07);
  private nibW = new THREE.Vector3(); private goal = new THREE.Vector3();
  private on = false; private holdL: { at: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3; radius?: number; grasp?: boolean; rigid?: boolean } | null = null;
  constructor(private host: Character, private quill: THREE.Object3D) {}
  /** Where the right hand should put the nib (null: hand off, the clip's own arm), and the left hand flat on a point. */
  set(nib: THREE.Vector3 | null, left: { at: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3; radius?: number; grasp?: boolean; rigid?: boolean } | null = null) {
    if (nib) this.goal.copy(nib);
    const was = this.on; this.on = !!nib;
    if (!nib && was) this.off.set(0, 0.09, -0.07);
    // the first frame of a reach: the target starts where the nib should be (not at the world's origin)
    if (nib && !was) this.at.copy(this.goal).add(this.off);
    this.holdL = left ? { at: left.at, fingers: left.fingers, palm: left.palm, radius: left.radius ?? 0.0, grasp: left.grasp ?? false, rigid: left.rigid } : null;
    this.host.setHold(this.on || this.holdL ? { R: this.on ? { at: this.at, fingers: this.fingers, palm: this.palm, radius: 0.004, grasp: true } : undefined, L: this.holdL ?? undefined } : null);
  }
  /** After the body is posed: measure the nib, correct the target for next frame. */
  after() {
    if (!this.on) return;
    this.quill.updateWorldMatrix(true, false);
    this.quill.localToWorld(this.nibW.set(0, -0.022, 0));
    const err = this.goal.clone().sub(this.nibW);
    if (err.length() < 0.5) this.off.addScaledVector(err, 0.35);
    this.off.clampLength(0, 0.22);
    this.at.copy(this.goal).add(this.off);
  }
  /** How the writing hand lies (world directions; the default suits a writer facing +z): a film whose writer faces
   *  elsewhere, or wants the hand off the line it has just written, sets its own. */
  pose(fingers: THREE.Vector3, palm: THREE.Vector3) { this.fingers.copy(fingers).normalize(); this.palm.copy(palm).normalize(); }
  /** What each hand is asked to touch this frame (the contact probe reads it): the nib's goal and the left hold. */
  get targets() { return { nib: this.on ? this.goal : null, L: this.holdL }; }
  /** Where the nib is now (world). */
  get nib() { return this.nibW; }
}

/** The film's own synthesised sounds: a bowed note, a sub swell, the nib on paper. */
export class FilmSound {
  private g: GainNode | null = null;
  private notes: { o: OscillatorNode[]; g: GainNode }[] = [];
  private noise: AudioBuffer | null = null;
  private out() {
    const ctx = audio.ctx; if (!ctx) return null;
    if (!this.g) { this.g = ctx.createGain(); this.g.gain.value = 1; this.g.connect(audio.master); }
    return this.g;
  }
  /** A held bowed chord (Hz list) rising over `rise` s to `vol`. Returns an id for fade(). */
  hold(freqs: number[], vol: number, rise = 2, type: OscillatorType = 'sawtooth', cut = 600) {
    const ctx = audio.ctx, out = this.out(); if (!ctx || !out) return -1;
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut; lp.Q.value = 0.5;
    const o = freqs.map((f, i) => { const x = ctx.createOscillator(); x.type = i % 2 ? 'sine' : type; x.frequency.value = f; x.detune.value = (i - 1) * 4; const xg = ctx.createGain(); xg.gain.value = 1 / (1 + i * 0.7) / freqs.length; x.connect(xg).connect(lp); x.start(); return x; });
    lp.connect(g).connect(out);
    g.gain.setTargetAtTime(vol, ctx.currentTime, rise / 3);
    this.notes.push({ o, g });
    return this.notes.length - 1;
  }
  /** Fade one held sound to `to` over `secs` (0 secs: a hard cut). */
  fade(id: number, to: number, secs: number) {
    const ctx = audio.ctx, n = this.notes[id]; if (!ctx || !n) return;
    n.g.gain.cancelScheduledValues(ctx.currentTime); n.g.gain.setValueAtTime(n.g.gain.value, ctx.currentTime);
    if (secs <= 0.02) n.g.gain.linearRampToValueAtTime(to, ctx.currentTime + 0.03); else n.g.gain.setTargetAtTime(to, ctx.currentTime, secs / 3);
  }
  /** Glide a held sound's pitch by a ratio over `secs`. */
  bend(id: number, ratio: number, secs: number) { const ctx = audio.ctx, n = this.notes[id]; if (!ctx || !n) return; for (const o of n.o) o.frequency.setTargetAtTime(o.frequency.value * ratio, ctx.currentTime, secs / 3); }
  private noiseBuf() {
    const ctx = audio.ctx!;
    this.noise ??= (() => { const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; })();
    return this.noise;
  }
  /** Filtered noise: the nib's scratch (high, short), a tap, a flutter, wind. */
  burst(freq: number, q: number, dur: number, vol: number, when = 0, type: BiquadFilterType = 'bandpass') {
    const ctx = audio.ctx, out = this.out(); if (!ctx || !out) return;
    const t0 = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf();
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.012, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(out); s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.02);
  }
  /** A deep hit: a sine drop with a noise body (a book shut, a door, a wave). */
  thump(vol = 0.6, f0 = 90) {
    const ctx = audio.ctx, out = this.out(); if (!ctx || !out) return;
    const t0 = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f0 * 0.45, t0 + 0.35);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    o.connect(g).connect(out); o.start(t0); o.stop(t0 + 1);
    this.burst(260, 0.8, 0.25, vol * 0.5);
  }
  /** Writing: call each frame with whether the nib is on the paper; it scratches at the letters' pace. */
  private nextScratch = 0;
  scratch(on: boolean, t: number, vol = 0.07) {
    if (!on || t < this.nextScratch) return;
    this.nextScratch = t + 0.09 + Math.random() * 0.09;
    this.burst(3400 + Math.random() * 2200, 2.5, 0.06 + Math.random() * 0.06, vol * (0.6 + Math.random() * 0.6));
  }
  stop() {
    const ctx = audio.ctx;
    for (const n of this.notes) { if (ctx) { n.g.gain.cancelScheduledValues(ctx.currentTime); n.g.gain.setTargetAtTime(0, ctx.currentTime, 0.15); } for (const o of n.o) try { o.stop((ctx?.currentTime ?? 0) + 1); } catch { /* stopped */ } }
    this.notes = [];
    this.nextScratch = 0;
  }
}

/** A film for the Vault's runner: its length, its lines (key and second), and what it does each frame. */
export interface Film {
  len: number;
  lines: { key: string; at: number }[];
  /** Called once when it starts (dress the room, place him). */
  start(): void;
  /** Each frame with the film's clock. */
  frame(t: number, dt: number): void;
  /** When the end begins to go into the title (seconds): the caller starts the hand-over there. */
  handover?: number;
  stop?(): void;
}
