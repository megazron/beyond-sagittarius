// The four tension moments the story can call in a fight, a chase or a hiding place: a quick press, a steady hand,
// a held breath and an aimed shot. Logic only: view/tensionUi.ts draws them and feeds them input.
import { clamp, rng, TUNING, defaultAssist } from './core.ts';
import type { Assist, Difficulty } from './core.ts';

export type TensionKind = 'quick' | 'steady' | 'breath' | 'aim';
export interface TensionSpec {
  kind: TensionKind;
  /** Length of the moment (quick: per press). */
  seconds?: number;
  /** Presses in a row (quick), beats to hold through (breath). */
  count?: number;
  difficulty?: Difficulty; assist?: Assist; seed?: number;
  /** Harder for a reason the story knows (an injury, poison): windows shrink by this factor. */
  strain?: number;
}
export interface TensionInput { press: boolean; held: boolean; axis: number; px: number; py: number }
export const noTensionInput = (): TensionInput => ({ press: false, held: false, axis: 0, px: 0.5, py: 0.5 });
export interface TensionResult { passed: boolean; score: number; misses: number }

export class Tension {
  spec: TensionSpec;
  t = 0;
  result: TensionResult | null = null;
  // what the picture needs
  /** quick and aim: the closing ring, 1 open to 0 shut; the window it must be pressed in. */
  ring = 1; win: [number, number] = [0.2, 0.42];
  done = 0; need = 1; misses = 0; allowed = 0;
  /** steady: where the marker and the band are (-1 to 1) and how wide the band is. */
  marker = 0; band = 0; bandW = 0.28; outT = 0; private vel = 0;
  /** breath: 0 to 1 through the current beat (the beat is at 1), and whether this beat was taken. */
  beat = 0; private took = false; private interval = 0.95; pulse = 0;
  /** aim: where the target is and how big, in a unit square. */
  tx = 0.5; ty = 0.5; tr = 0.09;
  private mult: number;
  private seconds: number;
  private rand: () => number;
  private assist: Assist;
  private wasHeld = false;

  constructor(spec: TensionSpec) {
    this.spec = spec;
    this.assist = spec.assist ?? defaultAssist();
    this.mult = TUNING[spec.difficulty ?? 'normal'].tension / (spec.strain ?? 1);
    this.rand = rng(spec.seed ?? 7);
    const k = spec.kind;
    this.seconds = spec.seconds ?? (k === 'quick' ? 1.5 : k === 'steady' ? 4.5 : k === 'aim' ? 2.8 : 0);
    if (k === 'quick') { this.need = spec.count ?? 1; const w = 0.2 * this.mult; this.win = [0.3 - w / 2, 0.3 + w / 2 + 0.04]; this.seconds *= Math.sqrt(this.mult); }
    if (k === 'steady') { this.bandW = clamp(0.26 * this.mult, 0.14, 0.5); this.allowed = 1.1 * this.mult; }
    if (k === 'breath') { this.need = spec.count ?? 6; this.allowed = this.mult >= 1.4 ? 2 : 1; }
    if (k === 'aim') { this.tr = clamp(0.085 * this.mult * (this.assist.aim === 2 ? 1.6 : this.assist.aim === 1 ? 1.25 : 1), 0.05, 0.2); this.seconds *= Math.sqrt(this.mult); }
  }

  private end(passed: boolean, score: number) { if (!this.result) this.result = { passed, score: clamp(score, 0, 1), misses: this.misses }; }

  update(dt: number, I: TensionInput) {
    if (this.result) return;
    this.t += dt;
    const A = this.assist, k = this.spec.kind;
    // with hold-to-press, holding the button counts as a press at the right moment
    const hold = A.hold && I.held;
    if (k === 'quick') {
      const inWin = () => this.ring >= this.win[0] && this.ring <= this.win[1];
      if (!(A.noTimers && inWin())) this.ring -= dt / this.seconds;
      const press = I.press || (hold && inWin());
      if (press) {
        if (inWin()) { this.done++; if (this.done >= this.need) this.end(true, 1 - this.misses * 0.3); else this.ring = 1; }
        else { this.misses++; this.end(false, 0); }
      } else if (this.ring <= 0) { this.misses++; this.end(false, 0); }
    } else if (k === 'steady') {
      // the hand shakes; the place to hold it moves
      this.band = Math.sin(this.t * 0.9) * 0.45 + Math.sin(this.t * 2.1 + 1.3) * 0.15;
      const shake = (this.rand() - 0.5) * 9 * (hold ? 0.3 : 1) / Math.sqrt(this.mult);
      this.vel += (shake + I.axis * 7 - this.vel * 3.2) * dt;
      if (hold) this.vel += (this.band - this.marker) * 6 * dt;
      this.marker = clamp(this.marker + this.vel * dt, -1, 1);
      if (Math.abs(this.marker) >= 1) this.vel = 0;
      const out = Math.abs(this.marker - this.band) > this.bandW;
      if (out) this.outT += dt;
      this.ring = 1 - this.t / this.seconds;
      if (this.outT > this.allowed) { this.misses = 1; this.end(false, 0); }
      else if (this.t >= this.seconds) this.end(true, 1 - this.outT / Math.max(0.01, this.allowed));
    } else if (k === 'breath') {
      // your own pulse: press on the beat, and only on the beat. It quickens when you get it wrong.
      this.beat += dt / this.interval;
      this.pulse = Math.max(0, this.pulse - dt * 3);
      const tol = clamp(0.17 * this.mult, 0.1, 0.34) / this.interval;
      const near = Math.abs(this.beat - 1) <= tol;
      const press = I.press || (hold && !this.took && this.beat >= 1);
      if (press && !this.took) {
        if (near) { this.took = true; this.done++; this.pulse = 1; }
        else if (!(A.noTimers)) { this.misses++; this.interval = Math.max(0.6, this.interval - 0.1); this.took = this.beat > 0.5; }
      }
      if (this.beat >= 1 + tol) {
        if (!this.took && !A.noTimers) { this.misses++; this.interval = Math.max(0.6, this.interval - 0.1); }
        if (this.took || !A.noTimers) { this.beat -= 1; this.took = false; }
        else this.beat = 1 + tol; // waits for the press
      }
      if (this.misses > this.allowed) this.end(false, this.done / this.need);
      else if (this.done >= this.need) this.end(true, 1 - this.misses / (this.allowed + 1));
    } else {
      this.tx = 0.5 + Math.sin(this.t * 1.7 + 0.4) * 0.3; this.ty = 0.5 + Math.sin(this.t * 2.3) * 0.18;
      const on = Math.hypot(I.px - this.tx, (I.py - this.ty)) <= this.tr;
      const inTime = this.ring > 0.02;
      if (!(A.noTimers && this.ring < 0.3)) this.ring -= dt / this.seconds;
      if (I.press || (hold && on)) {
        if (on && inTime) this.end(true, 0.5 + this.ring * 0.5);
        else if (I.press) { this.misses++; if (this.misses > 1) this.end(false, 0); }
      }
      if (this.ring <= 0) this.end(false, 0);
    }
    this.wasHeld = I.held;
  }
}
