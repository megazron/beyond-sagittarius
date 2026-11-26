import { t } from '../i18n';
import { audio } from '../core/audio';
import { trustBand } from '../game/branch/engine';
import type { Tone } from '../game/branch/types';

/**
 * The cutscene choice layer: a decision over a running scene (the scene slows behind it), a press, a hold or a
 * heartbeat under pressure, the bond meter between two of the six when it moves, and MegaZroN's Ledger line saying
 * what a choice changed. Its own names and marks (the Fork, the Ledger, Bonds). Time comes from update(dt), so a held
 * clock (tests) or a paused game stops it.
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

const MARK: Record<Tone, string> = { truth: '◇', kind: '○', nerve: '△', joke: '∿', silent: '·' };
const GUARD_MS = 300;
const BEAT = 0.86;
const BEAT_WIN = 0.2;

const el = (tag: string, cls: string, html = '') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };

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
  /** Everything shown, for tests: kind, id-ish text and result. */
  readonly log: { at: number; what: string; detail: string }[] = [];

  constructor() {
    this.root.id = 'fork'; this.reflexEl.id = 'reflex'; this.ledgerEl.id = 'ledger-line'; this.bondEl.id = 'bonds';
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
    const as = spec.as ? `<div class="fork-as">${esc(t('mo.as', { who: t(spec.as) }))}</div>` : '';
    const who = spec.who ? `<div class="fork-who">${esc(t(spec.who))}</div>` : '';
    const prompt = spec.prompt ? `<div class="fork-prompt">${esc(t(spec.prompt))}</div>` : '';
    const opts = spec.options.map((o, i) => `<button class="btn fork-o ${spec.style}" data-i="${i}"><kbd>${i + 1}</kbd>${o.tone ? `<i class="tone ${o.tone}" aria-hidden="true">${MARK[o.tone]}</i>` : ''}<span>${esc(t(o.label))}</span></button>`).join('');
    const fuse = spec.seconds ? '<div class="fork-fuse"><b></b></div>' : '';
    this.root.innerHTML = `${as}${who}${prompt}<div class="fork-opts ${spec.options.length > 2 ? 'three' : ''}">${opts}</div>${fuse}`;
    this.root.classList.toggle('act', spec.style === 'act');
    this.root.classList.remove('hidden', 'gone');
    document.body.classList.add('choosing', 'forking');
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
    const as = spec.as ? `<div class="fork-as">${esc(t('mo.as', { who: t(spec.as) }))}</div>` : '';
    const how = t(spec.kind === 'hold' ? 'mo.hold' : spec.kind === 'beat' ? 'mo.beat' : 'mo.press');
    const pips = spec.kind === 'beat' ? `<div class="pulse">${Array.from({ length: spec.count ?? 4 }, () => '<i></i>').join('')}</div>` : '';
    this.reflexEl.innerHTML = `${as}<div class="reflex-ring ${spec.kind}"><svg viewBox="0 0 48 48" aria-hidden="true"><circle class="bg" cx="24" cy="24" r="21"/><circle class="fg" cx="24" cy="24" r="21" pathLength="100" stroke-dasharray="100"/></svg><kbd>E</kbd></div><div class="reflex-label">${esc(t(spec.label))}</div><div class="reflex-how">${esc(how)}</div>${pips}`;
    this.reflexEl.className = `reflex ${spec.kind}`;
    document.body.classList.add('choosing');
    this.paint();
    audio.tone(spec.kind === 'beat' ? 90 : 740, 0.1, spec.kind === 'beat' ? 'sine' : 'square', 0.06);
    this.log.push({ at: performance.now(), what: spec.kind, detail: spec.label });
  }

  /** MegaZroN's line in the Ledger: what a choice changed, plain words. */
  ledger(key: string) {
    this.ledgerEl.innerHTML = `<small>${esc(t('mo.ledger'))}</small><span>${esc(t(key))}</span>`;
    this.ledgerEl.classList.remove('hidden');
    clearTimeout(this.ledgerTimer);
    this.ledgerTimer = window.setTimeout(() => this.ledgerEl.classList.add('hidden'), 4200);
    this.log.push({ at: performance.now(), what: 'ledger', detail: key });
  }

  /** How far `from` trusts `to` has moved: both names, a meter from -10 to 10, before and after, and the word for it. */
  bond(changes: { from: string; to: string; before: number; after: number }[]) {
    if (!changes.length) return;
    this.bondEl.innerHTML = `<small>${esc(t('mo.bonds'))}</small>` + changes.slice(0, 3).map((c) => {
      const pos = (v: number) => `${50 + v * 5}%`, up = c.after > c.before;
      return `<div class="bond ${up ? 'up' : 'down'}"><div class="bond-names">${esc(t(`crew.${c.from}.name`))} <b>${up ? '▲' : '▼'}</b> ${esc(t(`crew.${c.to}.name`))}</div>`
        + `<div class="bond-bar"><i class="was" style="left:${pos(c.before)}"></i><i class="now" style="left:${pos(c.before)}" data-to="${pos(c.after)}"></i></div>`
        + `<div class="bond-word">${esc(t(`br.trust.${trustBand(c.after)}`))}</div></div>`;
    }).join('');
    this.bondEl.classList.remove('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => this.bondEl.querySelectorAll<HTMLElement>('.now').forEach((n) => (n.style.left = n.dataset.to!))));
    clearTimeout(this.bondTimer);
    this.bondTimer = window.setTimeout(() => this.bondEl.classList.add('hidden'), 4600);
    for (const c of changes) this.log.push({ at: performance.now(), what: 'bond', detail: `${c.from}>${c.to}:${c.before}>${c.after}` });
  }

  update(dt: number) {
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
      const b = this.root.querySelector<HTMLElement>('.fork-fuse b');
      const k = Math.max(0, this.left / this.total);
      if (b) b.style.transform = `scaleX(${k})`;
      this.root.classList.toggle('urgent', k < 0.34);
    }
    const r = this.reflex;
    if (r) {
      const fg = this.reflexEl.querySelector<SVGCircleElement>('.fg');
      const k = r.kind === 'hold' ? this.heldFor / Math.max(0.01, this.total) : r.kind === 'beat' ? this.beatsDone / (r.count ?? 4) : this.total ? 1 - this.left / this.total : 0;
      if (fg) fg.style.strokeDashoffset = String(100 * (r.kind === 'press' ? k : 1 - k));
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
    this.root.querySelectorAll('button').forEach((b, j) => b.classList.add(j === i ? 'taken' : 'gone'));
    if (timedOut) this.root.insertAdjacentHTML('beforeend', `<div class="fork-silent">${esc(t('mo.silent'))}</div>`);
    document.body.classList.remove('choosing', 'forking');
    // the answer's line starts at once: its subtitle waits until the panel showing the pick has gone (it was written over
    // the fading buttons, GPU take P8 vine)
    document.body.classList.add('forkout');
    setTimeout(() => { if (!this.fork) { this.root.classList.add('hidden'); document.body.classList.remove('forkout'); } }, timedOut ? 900 : 520);
    audio.uiClick();
    this.log.push({ at: performance.now(), what: 'picked', detail: `${f.options[i]?.label}${timedOut ? ':timeout' : ''}` });
    f.onDone(i, timedOut);
  }

  private finishReflex(passed: boolean) {
    const r = this.reflex!;
    this.reflex = null; this.total = 0;
    this.reflexEl.classList.add(passed ? 'passed' : 'failed');
    document.body.classList.remove('choosing');
    setTimeout(() => { if (!this.reflex) this.reflexEl.classList.add('hidden'); }, 600);
    audio.tone(passed ? 660 : 140, 0.18, passed ? 'sine' : 'sawtooth', 0.06, 0, passed ? 220 : -40);
    this.log.push({ at: performance.now(), what: 'result', detail: `${r.label}:${passed ? 'pass' : 'fail'}` });
    r.onDone(passed);
  }

  /** Closes whatever is open without an answer (a scene torn down). */
  close() {
    this.fork = null; this.reflex = null; this.total = 0;
    this.root.classList.add('hidden'); this.reflexEl.classList.add('hidden');
    document.body.classList.remove('choosing', 'forking', 'forkout');
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
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
