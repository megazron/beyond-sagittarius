import { t } from '../../i18n';
import { audio } from '../../core/audio';
import type { Input } from '../input';
import type { Step, TechNode } from './data';

const $ = (id: string) => document.getElementById(id)!;

/**
 * Process minigames: timing taps, hold-to-heat in a band, qualitative mixing
 * and alternating rhythm. Input arrives as events (keyboard and the on-screen
 * buttons), and time comes from update(dt), so it plays the same on a phone
 * and under the test harness.
 */
export class Craft {
  node: TechNode | null = null;
  private i = 0;
  private v = 0;
  private prog = 0;
  private hits = 0;
  private misses = 0;
  private dir = 1;
  private zone = 0.5;
  private side = 0;
  private holding = false;
  private failed = false;
  private taught = false;
  private flash = '';
  private flashT = 0;
  private end: ((ok: boolean) => void) | null = null;
  /** Called each time a run is ruined. */
  onFail: () => void = () => {};

  constructor() {
    const btn = (id: string, down: () => void, up?: () => void) => {
      const el = $(id);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); down(); });
      const rel = () => { el.classList.remove('down'); up?.(); };
      el.addEventListener('pointerup', rel);
      el.addEventListener('pointerleave', rel);
      el.addEventListener('pointercancel', rel);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    btn('mg-main', () => this.main(true), () => this.main(false));
    btn('mg-left', () => this.press(-1));
    btn('mg-right', () => this.press(1));
    $('mg-stop').addEventListener('click', () => this.stop());
    window.addEventListener('keydown', (e) => {
      if (!this.node) return;
      const c = e.code;
      if (c === 'Space' || c === 'KeyE' || c === 'Enter') { e.preventDefault(); if (!e.repeat) this.main(true); }
      else if (c === 'KeyA' || c === 'ArrowLeft') { if (!e.repeat) this.press(-1); }
      else if (c === 'KeyD' || c === 'ArrowRight') { if (!e.repeat) this.press(1); }
      else if (c === 'Escape') this.stop();
    });
    window.addEventListener('keyup', (e) => {
      if (this.node && (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter')) this.main(false);
    });
  }

  private get step(): Step { return this.node!.steps[this.i]; }

  start(node: TechNode, taught: boolean, end: (ok: boolean) => void) {
    this.node = node;
    this.taught = taught;
    this.end = end;
    this.begin(0);
    $('mg-tip').classList.toggle('hidden', !taught);
    $('mg-name').textContent = t(`tech.${node.id}`);
    $('craft').classList.remove('hidden');
    audio.blip();
  }

  private begin(i: number) {
    this.i = i;
    this.prog = 0; this.hits = 0; this.misses = 0; this.side = 0; this.holding = false; this.failed = false; this.flash = '';
    const st = this.step;
    this.v = st.kind === 'mix' ? 0.08 : st.kind === 'tap' ? 0.02 : 0;
    this.dir = 1;
    if (st.kind === 'tap') this.pickZone();
    this.layout();
    this.render();
  }

  private pickZone() { this.zone = 0.2 + Math.random() * 0.6; }

  /** Current target band on the gauge; a taught skill widens it. */
  private band(): [number, number] {
    const st = this.step, k = this.taught ? 0.05 : 0;
    if (st.kind === 'tap') { const h = st.zone / 2 + k * 0.6; return [this.zone - h, this.zone + h]; }
    return [Math.max(0, st.band[0] - k), Math.min(0.97, st.band[1] + k)];
  }

  private inBand() { const [a, b] = this.band(); return this.v >= a && this.v <= b; }

  private layout() {
    const st = this.step, n = this.node!, g = $('mg-gauge');
    $('mg-text').textContent = t(`mg.${n.id}.${this.i}`);
    $('mg-step').textContent = t('mg.step', { k: this.i + 1, n: n.steps.length });
    $('mg-keys').textContent = t(`mg.keys.${st.kind === 'rhythm' ? 'alt' : st.kind}`);
    g.className = `mg-gauge ${st.kind}${st.kind === 'mix' && st.litmus ? ' litmus' : ''}`;
    const side = st.kind === 'mix' || st.kind === 'rhythm';
    $('mg-left').classList.toggle('hidden', !side);
    $('mg-right').classList.toggle('hidden', !side);
    $('mg-main').classList.toggle('hidden', st.kind === 'rhythm');
    $('mg-left').textContent = t(st.kind === 'mix' ? 'mg.btn.less' : 'mg.btn.left');
    $('mg-right').textContent = t(st.kind === 'mix' ? 'mg.btn.more' : 'mg.btn.right');
    $('mg-main').textContent = t(st.kind === 'tap' ? 'mg.btn.strike' : st.kind === 'heat' ? 'mg.btn.hold' : 'mg.btn.done');
    $('mg-stop').textContent = t('mg.btn.stop');
    $('mg-prog').parentElement!.classList.toggle('hidden', st.kind === 'mix');
  }

  /** Bolzar talked you through it: this build can't fail. */
  sure = false;

  private fail() {
    if (this.sure) { this.misses = 0; this.hits = Math.max(this.hits, 0); return; }
    this.failed = true;
    this.holding = false;
    this.flash = '';
    audio.hurt();
    this.onFail();
    $('mg-text').textContent = t('mg.failed');
    $('mg-main').textContent = t('mg.btn.retry');
    $('mg-main').classList.remove('hidden');
    $('mg-left').classList.add('hidden');
    $('mg-right').classList.add('hidden');
  }

  private advance() {
    audio.chime();
    const n = this.node!;
    if (this.i + 1 < n.steps.length) { this.begin(this.i + 1); return; }
    this.finish(true);
  }

  private finish(ok: boolean) {
    const end = this.end;
    this.node = null; this.end = null;
    $('craft').classList.add('hidden');
    end?.(ok);
  }

  stop() { if (this.node) { audio.uiClick(); this.finish(false); } }

  /** Space, E or the middle button. */
  private main(down: boolean) {
    if (!this.node) return;
    if (this.failed) { if (down) this.begin(0); return; }
    const st = this.step;
    if (st.kind === 'heat') { this.holding = down; return; }
    if (!down) return;
    if (st.kind === 'tap') {
      if (this.inBand()) {
        this.hits++; this.flash = 'mg.tap.hit'; this.flashT = 0.9;
        audio.tone(1800, 0.08, 'square', 0.14, 0, -900);
        this.prog = this.hits / st.hits;
        if (this.hits >= st.hits) { this.advance(); return; }
        this.pickZone();
      } else {
        this.misses++; this.flash = 'mg.tap.miss'; this.flashT = 1.1;
        audio.thud();
        if (this.misses >= 3) { this.fail(); return; }
      }
    } else if (st.kind === 'mix') {
      if (this.inBand()) { this.advance(); return; }
      this.misses++;
      audio.uiClick();
      if (this.misses >= 3) { this.fail(); return; }
    }
    this.render();
  }

  /** A or D, left or right button. */
  private press(side: number) {
    if (!this.node || this.failed) return;
    const st = this.step;
    if (st.kind === 'mix') {
      this.v = Math.min(1, Math.max(0, this.v + side * 0.07));
      audio.blip();
    } else if (st.kind === 'rhythm') {
      if (side === this.side) return; // alternate, don't mash one side
      this.side = side;
      this.v = Math.min(1, this.v + 0.13);
      audio.tone(side < 0 ? 240 : 300, 0.05, 'triangle', 0.06, 0, -60);
    }
    this.render();
  }

  private padMain = false;
  /** Once per frame: A or X work the main control, d-pad left and right the sides, B stops. */
  pad(input: Input) {
    const held = input.padHeld('jump') || input.padHeld('interact');
    if (held !== this.padMain) { this.padMain = held; this.main(held); }
    if (input.menu.left) this.press(-1);
    if (input.menu.right) this.press(1);
    if (input.menu.b) this.stop();
  }

  update(dt: number) {
    if (!this.node) return;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash = ''; }
    if (this.failed) { this.render(); return; }
    const st = this.step;
    if (st.kind === 'tap') {
      this.v += this.dir * st.speed * (1 + this.hits * 0.12) * dt;
      if (this.v >= 1) { this.v = 1; this.dir = -1; }
      if (this.v <= 0) { this.v = 0; this.dir = 1; }
    } else if (st.kind === 'heat') {
      this.v = Math.max(0, this.v + (this.holding ? st.rise : -st.fall) * dt);
      if (this.inBand()) this.prog = Math.min(1, this.prog + dt / st.secs);
      if (this.v >= 1) { this.fail(); return; }
      if (this.prog >= 1) { this.advance(); return; }
    } else if (st.kind === 'rhythm') {
      this.v = Math.max(0, this.v - 0.3 * dt);
      if (this.inBand()) this.prog = Math.min(1, this.prog + dt / st.secs);
      else if (this.v > this.band()[1]) this.prog = Math.max(0, this.prog - 0.15 * dt);
      if (this.prog >= 1) { this.advance(); return; }
    }
    this.render();
  }

  private stateText(): string {
    const st = this.step, [a, b] = this.band(), n = this.node!;
    if (this.flash) return t(this.flash);
    if (st.kind === 'tap') return t('mg.tap.ready');
    const zone = this.v < a ? 'lo' : this.v > b ? 'hi' : 'ok';
    if (st.kind === 'mix') return zone === 'ok' ? t('mg.mix.ok') : t(`mg.${n.id}.${this.i}.${zone}`);
    return t(`mg.${st.kind}.${zone}`);
  }

  private render() {
    if (!this.node) return;
    const [a, b] = this.band();
    const band = $('mg-band');
    band.style.left = `${a * 100}%`;
    band.style.width = `${(b - a) * 100}%`;
    $('mg-needle').style.left = `${this.v * 100}%`;
    $('mg-prog').style.width = `${this.prog * 100}%`;
    const s = $('mg-state');
    s.textContent = this.failed ? '' : this.stateText();
    s.classList.toggle('ok', !this.failed && this.inBand());
  }

  debug() {
    if (!this.node) return null;
    return { id: this.node.id, step: this.i, kind: this.step.kind, v: this.v, band: this.band(), prog: this.prog, hits: this.hits, failed: this.failed };
  }
}
