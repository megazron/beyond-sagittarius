import * as THREE from 'three';
import { t } from '../i18n';
import { audio } from '../core/audio';
import { Renderer } from '../core/renderer';
import { trustBand } from '../game/branch/engine';
import type { Tone } from '../game/branch/types';
import { inputDevice, keyCap, padCap } from './glyphs';
import './moment.css';

/**
 * The cutscene choice layer: a decision over a running scene (the scene slows behind it), a press, a hold or a
 * heartbeat under pressure, the bond meter between two of the six when it moves, and MegaZroN's Ledger line saying
 * what a choice changed. Its own names and marks (the Fork, the Ledger, Bonds). Time comes from update(dt), so a held
 * clock (tests) or a paused game stops it.
 *
 * The look is the MegaZroN Ledger's (~/bs-story/CHOICE_UI.md): answers on slips torn from the book, physical acts on
 * its ink-blue binding cloth, the timer an ink line burning in from both ends, reflexes a wax seal, "You are <name>" a
 * brass plate, his notes in his own hand. Panels place themselves off the faces in the current shot (head bones
 * projected through the camera) and never in the middle of the frame, where the inserts are.
 */
export interface ForkSpec {
  /** Who is asking (an i18n name key), and the line above the options. */
  who?: string;
  prompt?: string;
  /** Shown when you choose as someone else for a moment: their name key. */
  as?: string;
  style: 'talk' | 'act';
  options: { label: string; tone?: Tone }[];
  /** Null: waits. */
  seconds: number | null;
  /** Index taken when the time runs out. */
  fallback: number;
  onDone: (index: number, timedOut: boolean) => void;
}
export interface ReflexSpec {
  kind: 'press' | 'hold' | 'beat';
  label: string;
  as?: string;
  /** press: the window; hold: how long to keep it held; beat: ignored (count beats). Null waits for the first press. */
  seconds: number | null;
  count?: number;
  onDone: (passed: boolean) => void;
}

const GUARD_MS = 300;
const BEAT = 0.86;
const BEAT_WIN = 0.2;

/** Tone marks drawn as ink stamps on a 24 box: a shape for each, never a colour alone. */
const MARK: Record<Tone, string> = {
  truth: 'M12 3.2 L20.6 11.8 L12.3 20.9 L3.4 12.2 Z',
  kind: 'M12 4.1 C16.9 3.9 20.2 7.6 20 12.1 C19.8 16.6 16.4 20.1 11.8 19.9 C7.3 19.7 3.9 16.3 4.1 11.9 C4.3 7.4 7.6 4.3 12 4.1 Z',
  nerve: 'M12.2 3.6 L20.9 19.8 L3.2 20.1 Z',
  joke: 'M2.6 13.2 C5.8 6.4 8.9 6.6 11.9 12 C14.8 17.3 18.1 17.5 21.4 10.8',
  silent: 'M11.2 11.4 L12.8 12.6',
};
/** Face buttons by where the slip sits (standard pad layout: 0 bottom, 1 right, 2 left, 3 top). */
const PAD_SLOTS: Record<number, number[]> = { 1: [0], 2: [2, 1], 3: [2, 3, 1], 4: [2, 3, 1, 0] };
const TILT = [-0.9, 0.55, -0.35, 0.7];

const el = (tag: string, cls: string, html = '') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };

/** A small seeded random, so a slip's edge or the fuse's line is the same each time it is drawn. */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
/** A ruled ink line as a filled shape: thicker where the nib pressed, tapering at both ends, never quite straight. */
function inkLine(w: number, h: number, seed: number) {
  const r = rand(seed), n = 48, top: string[] = [], bot: string[] = [];
  let wob = 0;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * w, s = Math.sin(Math.PI * i / n);
    wob = wob * 0.8 + (r() - 0.5) * 0.5;
    const th = 0.5 + 1.7 * Math.pow(s, 0.45) + (r() - 0.5) * 0.35, y = h / 2 + wob;
    top.push(`${x.toFixed(1)} ${(y - th).toFixed(2)}`); bot.unshift(`${x.toFixed(1)} ${(y + th * 0.8).toFixed(2)}`);
  }
  return `M${top.join(' L')} L${bot.join(' L')} Z`;
}
/** A circle drawn by hand: the radius wanders a little and the stroke does not quite meet itself. */
function inkRing(r: number, c: number, seed: number) {
  const q = rand(seed), n = 40, pts: string[] = [];
  const k = [q() * 6.3, q() * 6.3, q() * 6.3];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2.04;
    const rr = r * (1 + 0.018 * Math.sin(2 * a + k[0]) + 0.012 * Math.sin(3 * a + k[1]) + 0.008 * Math.sin(5 * a + k[2]));
    pts.push(`${(c + Math.cos(a) * rr).toFixed(2)} ${(c + Math.sin(a) * rr).toFixed(2)}`);
  }
  return `M${pts.join(' L')}`;
}
const tone = (tn: Tone) => `<svg class="tone ${tn}" viewBox="0 0 24 24" role="img" aria-label="${esc(t(`mo.tone.${tn}`))}"><path d="${MARK[tn]}"/></svg>`;

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const boxOf = (e: Element): Box => { const r = e.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; };

export class MomentLayer {
  private root = el('div', 'fork hidden');
  private reflexEl = el('div', 'reflex hidden');
  private ledgerEl = el('div', 'ledger-line hidden');
  private bondEl = el('div', 'bonds hidden');
  private fork: ForkSpec | null = null;
  private reflex: ReflexSpec | null = null;
  private left = 0;
  private total = 0;
  private opened = 0;
  private sel = -1;
  private held = false;
  private heldFor = 0;
  private letGo = 0;
  private beatT = 0;
  private beatsDone = 0;
  private hits = 0;
  private misses = 0;
  private pressedThis = false;
  private ledgerTimer = 0;
  private bondTimer = 0;
  private padPrev = 0;
  private dev = '';
  private seed = 1;
  /** Where the heads are on screen when a panel opened (CSS px, radius of the face), for tests and the UI sheet. */
  faces: { x: number; y: number; r: number }[] = [];
  /** Everything shown, for tests: kind, id-ish text and result. */
  readonly log: { at: number; what: string; detail: string }[] = [];

  constructor() {
    this.root.id = 'fork'; this.reflexEl.id = 'reflex'; this.ledgerEl.id = 'ledger-line'; this.bondEl.id = 'bonds';
    this.ledgerEl.setAttribute('role', 'status'); this.bondEl.setAttribute('role', 'status');
    document.body.append(this.root, this.reflexEl, this.ledgerEl, this.bondEl);
    window.addEventListener('keydown', (e) => this.key(e, true), true);
    window.addEventListener('keyup', (e) => this.key(e, false), true);
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
      if (b) this.pick(+b.dataset.i!);
    });
    const down = (e: Event) => { if (!this.reflex) return; e.preventDefault(); this.down(); };
    const up = (e: Event) => { if (!this.reflex) return; e.preventDefault(); this.up(); };
    this.reflexEl.addEventListener('pointerdown', down);
    this.reflexEl.addEventListener('pointerup', up);
    this.reflexEl.addEventListener('pointercancel', up);
  }

  /** A decision or a reflex is on screen. */
  get open() { return !!this.fork || !!this.reflex; }
  /** How the scene behind should run: a decision nearly stops it, a reflex slows it. */
  get timeScale() { return this.fork ? 0.06 : this.reflex ? 0.3 : 1; }
  get remaining() { return this.total ? Math.max(0, this.left) : null; }

  choose(spec: ForkSpec) {
    this.close();
    this.fork = spec; this.sel = -1;
    this.total = this.left = spec.seconds ?? 0;
    this.opened = performance.now();
    const seed = this.seed++;
    const as = spec.as ? `<div class="fork-as"><span>${esc(t('mo.as', { who: t(spec.as) }))}</span></div>` : '';
    const who = spec.who ? `<div class="fork-who">${esc(t(spec.who))}</div>` : '';
    const prompt = spec.prompt ? `<div class="fork-prompt">${esc(t(spec.prompt))}</div>` : '';
    const n = spec.options.length;
    const opts = spec.options.map((o, i) => `<button class="fork-o ${spec.style}" data-i="${i}" style="--r:${TILT[i % 4] * (seed % 2 ? 1 : -1)}deg;--d:${80 + i * 90}ms">`
      + `<span class="mo-key" data-slot="${i}">${this.keyFor(i, n)}</span>`
      + `<span class="fork-text">${esc(t(o.label))}</span>`
      + (o.tone ? tone(o.tone) : '')
      + `<svg class="stroke" viewBox="0 0 200 10" preserveAspectRatio="none" aria-hidden="true"><path d="M3 6.5 C40 3.5 90 7.5 130 5 S180 4 197 5.5" pathLength="100"/></svg></button>`).join('');
    const fuse = spec.seconds
      ? `<div class="fork-fuse" aria-hidden="true"><svg viewBox="0 0 600 14" preserveAspectRatio="none"><defs><clipPath id="fuse-clip-${seed}"><rect class="clip" x="0" y="0" width="600" height="14"/></clipPath></defs>`
        + `<path class="ash" d="${inkLine(600, 14, seed * 7)}"/><path class="ink" clip-path="url(#fuse-clip-${seed})" d="${inkLine(600, 14, seed * 7)}"/></svg><i class="ember l"></i><i class="ember r"></i></div>`
      : '';
    this.root.innerHTML = `<div class="fork-head">${as}${who}${prompt}</div><div class="fork-opts n${n}">${opts}</div>${fuse}`;
    this.root.classList.toggle('act', spec.style === 'act');
    this.root.classList.toggle('untimed', !spec.seconds);
    this.root.classList.remove('hidden', 'gone', 'urgent', 'answered', 'at-top');
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', spec.prompt ? t(spec.prompt) : t('mo.choose'));
    document.body.classList.add('choosing', 'forking');
    this.placeFork();
    this.paint();
    audio.tone(spec.style === 'act' ? 330 : 523, 0.12, 'sine', 0.08, 0, spec.style === 'act' ? -60 : 40);
    this.log.push({ at: performance.now(), what: 'fork', detail: spec.prompt ?? spec.options.map((o) => o.label).join('|') });
  }

  quick(spec: ReflexSpec) {
    this.close();
    this.reflex = spec;
    this.total = this.left = spec.kind === 'beat' ? (spec.count ?? 4) * BEAT + 0.6 : spec.seconds ?? 0;
    this.opened = performance.now();
    this.held = false; this.heldFor = 0; this.letGo = 0; this.beatT = 0; this.beatsDone = 0; this.hits = 0; this.misses = 0;
    const seed = this.seed++;
    const as = spec.as ? `<div class="fork-as"><span>${esc(t('mo.as', { who: t(spec.as) }))}</span></div>` : '';
    const how = t(spec.kind === 'hold' ? 'mo.hold' : spec.kind === 'beat' ? 'mo.beat' : 'mo.press');
    const pips = spec.kind === 'beat' ? `<div class="pulse">${Array.from({ length: spec.count ?? 4 }, () => '<i></i>').join('')}</div>` : '';
    const ring = inkRing(64, 75, seed * 13);
    this.reflexEl.innerHTML = `${as}<div class="reflex-ring ${spec.kind}"><svg viewBox="0 0 150 150" aria-hidden="true">`
      + `<path class="bg" d="${ring}" pathLength="100"/><path class="fg" d="${ring}" pathLength="100" stroke-dasharray="100"/>`
      + `<circle class="near" cx="75" cy="75" r="64"/></svg><div class="seal"><span class="mo-key" data-slot="-1">${this.keyFor(-1, 1)}</span></div></div>`
      + `<div class="reflex-label">${esc(t(spec.label))}</div><div class="reflex-how">${esc(how)}</div>${pips}`;
    this.reflexEl.className = `reflex ${spec.kind}`;
    this.reflexEl.setAttribute('role', 'button');
    this.reflexEl.setAttribute('aria-label', `${t(spec.label)}. ${how}`);
    document.body.classList.add('choosing');
    this.placeReflex();
    this.paint();
    audio.tone(spec.kind === 'beat' ? 90 : 740, 0.1, spec.kind === 'beat' ? 'sine' : 'square', 0.06);
    this.log.push({ at: performance.now(), what: spec.kind, detail: spec.label });
  }

  /** MegaZroN's line in the Ledger: what a choice changed, plain words, written in by his hand. */
  ledger(key: string) {
    const text = t(key);
    this.ledgerEl.innerHTML = `<small>${esc(t('mo.ledger'))}</small><span class="hand" style="--write:${Math.round(Math.min(1800, Math.max(650, text.length * 34)))}ms">${esc(text)}</span>`;
    this.ledgerEl.classList.remove('hidden', 'fading');
    this.placeSide(this.ledgerEl);
    clearTimeout(this.ledgerTimer);
    this.ledgerTimer = window.setTimeout(() => {
      this.ledgerEl.classList.add('fading');
      this.ledgerTimer = window.setTimeout(() => this.ledgerEl.classList.add('hidden'), 520);
    }, 3700);
    this.log.push({ at: performance.now(), what: 'ledger', detail: key });
  }

  /** How far `from` trusts `to` has moved: both names, a scale from -10 to 10, before and after, and the word for it. */
  bond(changes: { from: string; to: string; before: number; after: number }[]) {
    if (!changes.length) return;
    const X = (v: number) => 100 + Math.max(-10, Math.min(10, v)) * 9;
    this.bondEl.innerHTML = `<small>${esc(t('mo.bonds'))}</small>` + changes.slice(0, 3).map((c, i) => {
      const up = c.after > c.before, a = X(c.before), b = X(c.after);
      const arrow = up ? 'M3 15 L10 5 L17 15 M10 5 L10 19' : 'M3 9 L10 19 L17 9 M10 19 L10 5';
      return `<div class="bond ${up ? 'up' : 'down'}" style="--d:${200 + i * 160}ms">`
        + `<div class="bond-names"><span>${esc(t(`crew.${c.from}.name`))}</span><svg class="arrow" viewBox="0 0 20 24" role="img" aria-label="${esc(t(up ? 'mo.up' : 'mo.down'))}"><path d="${arrow}"/></svg><span>${esc(t(`crew.${c.to}.name`))}</span></div>`
        + `<div class="bond-word">${esc(t(`br.trust.${trustBand(c.after)}`))}</div>`
        + `<svg class="bond-scale" viewBox="0 0 200 26" aria-hidden="true"><path class="rule" d="M8 15.2 C60 14.4 140 15.8 192 14.9"/>`
        + `<path class="tick" d="M8 10 L8 20 M100 11 L100 19 M192 10 L192 20"/><path class="was" d="M${a} 7 L${a} 23"/>`
        + `<path class="move" d="M${a} 15 L${b} 15" pathLength="100"/><circle class="now" cx="${b}" cy="15" r="4.6"/></svg></div>`;
    }).join('');
    this.bondEl.classList.remove('hidden', 'fading');
    this.placeSide(this.bondEl);
    clearTimeout(this.bondTimer);
    this.bondTimer = window.setTimeout(() => {
      this.bondEl.classList.add('fading');
      this.bondTimer = window.setTimeout(() => this.bondEl.classList.add('hidden'), 520);
    }, 4100);
    for (const c of changes) this.log.push({ at: performance.now(), what: 'bond', detail: `${c.from}>${c.to}:${c.before}>${c.after}` });
  }

  update(dt: number) {
    this.pollPad();
    if (this.open && inputDevice() !== this.dev) this.refreshKeys();
    const r = this.reflex;
    if (this.fork && this.total) {
      this.left -= dt;
      if (this.left <= 0) { this.finishFork(this.fork.fallback, true); return; }
    }
    if (r) {
      if (r.kind === 'beat') {
        this.beatT += dt;
        const n = r.count ?? 4, k = Math.floor((this.beatT - 0.6) / BEAT);
        // the beat lands at 0.6 + i * BEAT; once its window passes unpressed it counts as missed
        while (this.beatsDone < n && this.beatT > 0.6 + this.beatsDone * BEAT + BEAT_WIN) {
          if (!this.pressedThis) this.mark(this.beatsDone, false);
          this.beatsDone++; this.pressedThis = false;
        }
        if (k >= 0 && k < n && this.lastThump !== k) { this.lastThump = k; audio.thump(0.75); this.reflexEl.classList.remove('thump'); void this.reflexEl.offsetWidth; this.reflexEl.classList.add('thump'); }
        if (this.beatsDone >= n) { this.finishReflex(this.hits >= n - 1 && this.misses <= 1); return; }
      } else if (this.total) {
        if (r.kind === 'hold') {
          if (this.held) this.heldFor += dt; else if (this.heldFor > 0) this.letGo += dt;
          // it starts when you take hold; let go for more than a moment and it is lost
          if (this.letGo > 0.3) { this.finishReflex(false); return; }
          if (this.heldFor >= this.total) { this.finishReflex(true); return; }
          if (!this.heldFor) { this.left -= dt; if (this.left < this.total - 1.6) { this.finishReflex(false); return; } }
        } else {
          this.left -= dt;
          if (this.left <= 0) { this.finishReflex(false); return; }
        }
      }
    }
    this.paint();
  }
  private lastThump = -1;

  private paint() {
    if (this.fork && this.total) {
      const k = Math.max(0, this.left / this.total);
      const clip = this.root.querySelector<SVGRectElement>('.fork-fuse .clip');
      // the line burns in from both ends towards the middle; an ember at each burning end
      if (clip) { clip.setAttribute('x', String(300 - 300 * k)); clip.setAttribute('width', String(600 * k)); }
      this.root.style.setProperty('--k', k.toFixed(4));
      this.root.classList.toggle('urgent', k < 0.34);
    }
    const r = this.reflex;
    if (r) {
      const fg = this.reflexEl.querySelector<SVGPathElement>('.fg');
      const k = r.kind === 'hold' ? this.heldFor / Math.max(0.01, this.total) : r.kind === 'beat' ? this.beatsDone / (r.count ?? 4) : this.total ? 1 - this.left / this.total : 0;
      // press: the ring is drawn and erases as the moment goes; hold: it draws itself while you hold; beat: the beats done
      if (fg) fg.style.strokeDashoffset = String(100 * (r.kind === 'press' ? k : 1 - k));
      if (r.kind === 'beat') {
        // a ring closes on the seal and lands on each beat: you see when the next one comes before it comes
        const next = this.beatT < 0.6 ? 1 - this.beatT / 0.6 : 1 - (((this.beatT - 0.6) % BEAT) / BEAT);
        this.reflexEl.style.setProperty('--near', (1 + 0.75 * next).toFixed(3));
        this.reflexEl.style.setProperty('--nearA', (this.beatsDone >= (r.count ?? 4) ? 0 : 0.25 + 0.75 * (1 - next)).toFixed(3));
      }
      this.reflexEl.classList.toggle('urgent', r.kind === 'press' && k > 0.66);
      this.reflexEl.classList.toggle('holding', this.held);
    }
  }

  private mark(i: number, hit: boolean) {
    if (hit) this.hits++; else this.misses++;
    const p = this.reflexEl.querySelectorAll('.pulse i')[i];
    p?.classList.add(hit ? 'hit' : 'miss');
  }

  private down() {
    const r = this.reflex;
    if (!r || performance.now() - this.opened < GUARD_MS) return;
    if (r.kind === 'press') { this.finishReflex(true); return; }
    if (r.kind === 'hold') { this.held = true; this.letGo = 0; return; }
    // a heartbeat: on the beat or not
    const i = Math.round((this.beatT - 0.6) / BEAT), d = Math.abs(this.beatT - 0.6 - i * BEAT);
    if (i >= this.beatsDone && i < (r.count ?? 4) && d <= BEAT_WIN && !this.pressedThis) { this.pressedThis = true; this.mark(i, true); audio.tone(180, 0.05, 'sine', 0.04); }
    else { this.misses++; audio.tone(120, 0.08, 'square', 0.04); this.reflexEl.classList.add('wrong'); setTimeout(() => this.reflexEl.classList.remove('wrong'), 160); }
  }
  private up() { if (this.reflex?.kind === 'hold') this.held = false; }

  private pick(i: number) {
    if (!this.fork || performance.now() - this.opened < GUARD_MS) return;
    if (i < 0 || i >= this.fork.options.length) return;
    this.finishFork(i, false);
  }

  private finishFork(i: number, timedOut: boolean) {
    const f = this.fork!;
    this.fork = null; this.total = 0;
    this.root.querySelectorAll('button').forEach((b, j) => b.classList.add(j === i && !timedOut ? 'taken' : 'gone'));
    this.root.classList.add('answered');
    if (timedOut) this.root.insertAdjacentHTML('beforeend', `<div class="fork-silent">${esc(t('mo.silent'))}</div>`);
    document.body.classList.remove('choosing', 'forking');
    setTimeout(() => { if (!this.fork) this.root.classList.add('hidden'); }, timedOut ? 1100 : 720);
    audio.uiClick();
    this.log.push({ at: performance.now(), what: 'picked', detail: `${f.options[i]?.label}${timedOut ? ':timeout' : ''}` });
    f.onDone(i, timedOut);
  }

  private finishReflex(passed: boolean) {
    const r = this.reflex!;
    this.reflex = null; this.total = 0;
    this.reflexEl.classList.add(passed ? 'passed' : 'failed');
    document.body.classList.remove('choosing');
    setTimeout(() => { if (!this.reflex) this.reflexEl.classList.add('hidden'); }, 700);
    audio.tone(passed ? 660 : 140, 0.18, passed ? 'sine' : 'sawtooth', 0.06, 0, passed ? 220 : -40);
    this.log.push({ at: performance.now(), what: 'result', detail: `${r.label}:${passed ? 'pass' : 'fail'}` });
    r.onDone(passed);
  }

  /** Closes whatever is open without an answer (a scene torn down). */
  close() {
    this.fork = null; this.reflex = null; this.total = 0;
    this.root.classList.add('hidden'); this.reflexEl.classList.add('hidden');
    document.body.classList.remove('choosing', 'forking');
  }

  private key(e: KeyboardEvent, isDown: boolean) {
    if (!this.open) return;
    const act = e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'Space' || e.code === 'Enter';
    e.stopPropagation(); // the scene behind must not read Enter or Escape as skip
    if (this.reflex) { if (act && isDown && !e.repeat) this.down(); else if (act && !isDown) this.up(); return; }
    if (!isDown || e.repeat || !this.fork) return;
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (m) { this.pick(+m[1] - 1); return; }
    const n = this.fork.options.length;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'KeyA') this.focus((this.sel + n - 1) % n);
    else if (e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'KeyD') this.focus((this.sel + 1) % n);
    else if (act && this.sel >= 0) this.pick(this.sel);
  }
  private focus(i: number) {
    this.sel = i;
    this.root.querySelectorAll('button').forEach((b, j) => b.classList.toggle('sel', j === i));
  }

  /** A pad: the face button where the slip sits picks it; the d-pad moves and A takes the marked slip; any face button
   *  presses or holds the seal. Read straight from the pads, so it works over a film as well as in play. */
  private pollPad() {
    const pads = navigator.getGamepads?.() ?? [];
    let mask = 0;
    for (const p of pads) if (p) for (let i = 0; i < 16 && i < p.buttons.length; i++) if (p.buttons[i].pressed) mask |= 1 << i;
    const hit = mask & ~this.padPrev, rel = this.padPrev & ~mask;
    this.padPrev = mask;
    if (!hit && !rel) return;
    if (this.reflex) {
      if (hit & 0xf) this.down();
      if ((rel & 0xf) && !(mask & 0xf)) this.up();
      return;
    }
    const f = this.fork;
    if (!f || !hit) return;
    const n = f.options.length, slots = PAD_SLOTS[Math.min(4, n)] ?? PAD_SLOTS[4];
    const s = slots.findIndex((b) => hit & (1 << b));
    if (s >= 0 && s < n) { this.pick(s); return; }
    if (hit & ((1 << 14) | (1 << 12))) this.focus((this.sel + n - 1) % n);
    else if (hit & ((1 << 15) | (1 << 13))) this.focus((this.sel + 1) % n);
    else if ((hit & 1) && this.sel >= 0) this.pick(this.sel);
  }

  /** The prompt for slip i of n (or the seal, i = -1) on the device in use: its number, its face button, or nothing
   *  on touch (the slip itself is the button). */
  private keyFor(i: number, n: number) {
    const dev = inputDevice();
    this.dev = dev;
    if (dev === 'touch') return i < 0 ? '<svg class="star" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 L23.2 16.8 L37 20 L23.2 23.2 L20 37 L16.8 23.2 L3 20 L16.8 16.8 Z"/></svg>' : '';
    if (dev === 'pad') return padCap(i < 0 ? 0 : (PAD_SLOTS[Math.min(4, n)] ?? PAD_SLOTS[4])[i] ?? 0);
    return i < 0 ? keyCap('KeyE') : `<kbd class="kc">${i + 1}</kbd>`;
  }
  private refreshKeys() {
    const n = this.fork?.options.length ?? 1;
    document.querySelectorAll<HTMLElement>('#fork .mo-key, #reflex .mo-key').forEach((k) => { k.innerHTML = this.keyFor(+k.dataset.slot!, n); });
  }

  /** The heads in the current shot, in CSS px, with the size of the face: the camera's projection of each shown head
   *  bone. Read when a panel opens (the scene behind is nearly still while it is up). */
  /** Dev stage only (dev/moment.ts): faces to place around, in place of the camera's. */
  static fakeFaces: { x: number; y: number; r: number }[] | null = null;
  private readFaces() {
    if (MomentLayer.fakeFaces) return (this.faces = MomentLayer.fakeFaces);
    const out: { x: number; y: number; r: number }[] = [];
    const pass = Renderer.current?.renderPass as unknown as { scene?: THREE.Scene; camera?: THREE.Camera } | undefined;
    const scene = pass?.scene, cam = pass?.camera as THREE.PerspectiveCamera | undefined;
    if (scene && cam) {
      const W = window.innerWidth, H = window.innerHeight, v = new THREE.Vector3(), c = new THREE.Vector3();
      cam.updateMatrixWorld(); c.setFromMatrixPosition(cam.matrixWorld);
      const tanH = Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 50) / 2));
      scene.traverseVisible((o) => {
        if (!(o as THREE.Bone).isBone || o.name !== 'head' || out.length > 24) return;
        v.setFromMatrixPosition(o.matrixWorld);
        const d = v.distanceTo(c);
        // the face sits a little above and in front of the head bone; 0.12 m is about half a face's height
        v.y += 0.06;
        v.project(cam);
        if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 1.15 || Math.abs(v.y) > 1.15) return;
        out.push({ x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, r: Math.min(H, (0.13 / Math.max(0.05, d * tanH)) * (H / 2)) });
      });
    }
    this.faces = out;
    return out;
  }
  private faceCost(b: Box, faces = this.faces) {
    // a face counts from its brow to its chin and a little either side
    return faces.reduce((s, f) => s + overlap(b, { x0: f.x - f.r * 1.2, y0: f.y - f.r * 1.3, x1: f.x + f.r * 1.2, y1: f.y + f.r * 1.5 }), 0);
  }
  private placeFork() {
    const faces = this.readFaces();
    if (!faces.length) return;
    const atBottom = this.faceCost(boxOf(this.root));
    if (!atBottom) return;
    this.root.classList.add('at-top');
    if (this.faceCost(boxOf(this.root)) >= atBottom) this.root.classList.remove('at-top');
  }
  private placeReflex() {
    const faces = this.readFaces();
    const e = this.reflexEl, W = window.innerWidth, H = window.innerHeight;
    // lower third, never the middle of the frame (the inserts); the side away from the faces, the centre if both are clear
    const spots: [number, number][] = [[0.5, 0.76], [0.2, 0.7], [0.8, 0.7], [0.2, 0.36], [0.8, 0.36]];
    let best = spots[0], bc = Infinity;
    for (const [x, y] of spots) {
      e.style.setProperty('--x', `${x * W}px`); e.style.setProperty('--y', `${y * H}px`);
      const c = this.faceCost(boxOf(e), faces) + (y < 0.5 ? 1500 : 0);
      if (c < bc - 1) { bc = c; best = [x, y]; }
    }
    e.style.setProperty('--x', `${best[0] * W}px`); e.style.setProperty('--y', `${best[1] * H}px`);
  }
  /** The Ledger note and the Bonds card keep to the side the faces are not on. */
  private placeSide(e: HTMLElement) {
    if (!this.open) this.readFaces();
    e.classList.remove('flip');
    if (!this.faces.length) return;
    const here = this.faceCost(boxOf(e));
    if (!here) return;
    e.classList.add('flip');
    if (this.faceCost(boxOf(e)) >= here) e.classList.remove('flip');
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
