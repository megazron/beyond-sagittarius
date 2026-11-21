// Draws a tension moment and feeds it the player's hands: keys, mouse, touch or pad. The rules are in sim/tension.ts.
import { Tension, noTensionInput } from '../sim/tension';
import type { TensionSpec, TensionResult } from '../sim/tension';
import { t } from '../../i18n';
import { audio } from '../../core/audio';
import type { Input } from '../../game/input';

export class TensionUi {
  private root = document.createElement('div');
  private cur: { T: Tension; done: (r: TensionResult) => void; endT: number } | null = null;
  private I = noTensionInput();
  private press = false; private held = false; private keys = new Set<string>();
  private opened = 0; private lastDone = 0; private lastPulse = 0;

  constructor(private input: Input) {
    this.root.id = 'cb-tension'; this.root.className = 'off';
    document.body.append(this.root);
    const down = (e: Event) => { if (!this.cur) return; e.preventDefault(); e.stopPropagation(); if (performance.now() - this.opened > 250) { this.press = true; } this.held = true; };
    const up = () => { this.held = false; };
    this.root.addEventListener('pointerdown', (e) => { this.point(e); down(e); });
    this.root.addEventListener('pointermove', (e) => this.point(e));
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', (e) => {
      if (!this.cur) return;
      e.stopPropagation();
      if (['KeyE', 'KeyF', 'Space', 'Enter'].includes(e.code)) { if (!e.repeat && performance.now() - this.opened > 250) this.press = true; this.held = true; e.preventDefault(); }
      this.keys.add(e.code);
    }, true);
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); if (['KeyE', 'KeyF', 'Space', 'Enter'].includes(e.code)) this.held = false; }, true);
  }
  private point(e: PointerEvent) {
    if (!this.cur) return;
    const box = this.root.querySelector('.box, .bar') as HTMLElement | null;
    if (!box) return;
    const r = box.getBoundingClientRect();
    this.I.px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); this.I.py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    // steady: the pointer's side of the middle pushes the hand that way (touch and mouse)
    if (this.cur.T.spec.kind === 'steady' && (e.pointerType !== 'mouse' || e.buttons)) this.axisPtr = (this.I.px - 0.5) * 2.4;
  }
  private axisPtr = 0;
  get open() { return !!this.cur; }

  run(spec: TensionSpec, done: (r: TensionResult) => void) {
    const T = new Tension(spec), k = spec.kind;
    this.cur = { T, done, endT: 0 };
    this.press = false; this.held = false; this.axisPtr = 0; this.keys.clear(); this.opened = performance.now(); this.lastDone = 0; this.lastPulse = 0;
    this.I = noTensionInput();
    const lbl = `<div class="lbl">${t(`cb.tn.${k}`)}</div>`;
    const dots = (n: number) => `<div class="dots">${'<i></i>'.repeat(n)}</div>`;
    if (k === 'quick') {
      const [a, b] = T.win;
      this.root.innerHTML = `${lbl}<svg viewBox="-110 -110 220 220"><circle r="${100 * ((a + b) / 2)}" fill="none" stroke="rgba(159,208,168,.6)" stroke-width="${100 * (b - a)}"/><circle class="rg" r="100" fill="none" stroke="#fff" stroke-width="4"/><circle r="5" fill="#e8a33d"/></svg>${T.need > 1 ? dots(T.need) : ''}<button class="tap">${t('cb.tn.quick')}</button>`;
    } else if (k === 'steady') {
      this.root.innerHTML = `${lbl}<div class="bar"><div class="band"></div><div class="mk"></div></div><div class="prog"><i></i></div><button class="tap">●</button>`;
    } else if (k === 'breath') {
      this.root.innerHTML = `${lbl}<svg viewBox="-110 -110 220 220"><circle r="46" fill="none" stroke="rgba(159,208,168,.7)" stroke-width="10"/><circle class="rg" r="100" fill="none" stroke="#fff" stroke-width="4"/><circle class="ht" r="30" fill="#b3261e"/></svg>${dots(T.need)}<button class="tap">♥</button>`;
    } else {
      this.root.innerHTML = `${lbl}<div class="box"><div class="tg"><i></i></div><div class="cur"></div></div><div class="prog"><i></i></div><button class="tap">◎</button>`;
      this.I.px = 0.5; this.I.py = 0.75;
    }
    this.root.classList.remove('off');
    document.body.classList.add('choosing');
    this.input.releasePointer();
    audio.beep();
  }

  update(dt: number) {
    const c = this.cur;
    if (!c) return;
    const T = c.T, k = T.spec.kind, inp = this.input;
    if (c.endT > 0) { c.endT -= dt; if (c.endT <= 0) { this.cur = null; this.root.classList.add('off'); document.body.classList.remove('choosing'); c.done(T.result!); } return; }
    const I = this.I;
    I.press = this.press || inp.padBtnHit(0) || inp.padBtnHit(7); this.press = false;
    I.held = this.held || inp.padBtn(0) || inp.padBtn(7);
    const kb = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    I.axis = Math.max(-1, Math.min(1, kb + inp.padMove.x + this.axisPtr));
    if (k === 'aim') {
      // pad and keys move the mark; a mouse or a finger puts it where it points
      const ky = (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0);
      I.px = Math.min(1, Math.max(0, I.px + (kb + inp.padMove.x + inp.padAim.x) * dt * 0.8)); I.py = Math.min(1, Math.max(0, I.py + (ky + inp.padMove.y + inp.padAim.y) * dt * 0.8));
    }
    T.update(dt, I);
    const q = (s: string) => this.root.querySelector(s) as HTMLElement | SVGElement | null;
    if (k === 'quick') { q('.rg')?.setAttribute('r', String(Math.max(0, T.ring) * 100)); }
    else if (k === 'steady') {
      const bar = q('.bar') as HTMLElement, band = q('.band') as HTMLElement, mk = q('.mk') as HTMLElement;
      band.style.left = `${(T.band - T.bandW + 1) * 50}%`; band.style.width = `${T.bandW * 100}%`; mk.style.left = `${(T.marker + 1) * 50}%`;
      bar.classList.toggle('out', Math.abs(T.marker - T.band) > T.bandW);
      (q('.prog i') as HTMLElement).style.width = `${(1 - Math.max(0, T.ring)) * 100}%`;
    } else if (k === 'breath') {
      q('.rg')?.setAttribute('r', String(46 + Math.max(0, 1 - T.beat) * 54));
      q('.ht')?.setAttribute('r', String(26 + T.pulse * 12 + (T.beat > 0.9 ? 4 : 0)));
      // the heart is heard as well as seen
      if (T.beat < this.lastPulse) { if (!audio.sample('cb_heart', 0.9)) { audio.tone(58, 0.16, 'sine', 0.5); audio.tone(46, 0.2, 'sine', 0.4, 0.14); } inp.rumble(60, 0.4); }
      this.lastPulse = T.beat;
    } else {
      const tg = q('.tg') as HTMLElement, cur = q('.cur') as HTMLElement, box = q('.box') as HTMLElement, w = box.clientWidth;
      tg.style.left = `${T.tx * 100}%`; tg.style.top = `${T.ty * 100}%`; tg.style.width = tg.style.height = `${T.tr * 2 * w}px`;
      (tg.firstElementChild as HTMLElement).style.transform = `scale(${1 + Math.max(0, T.ring) * 2.2})`;
      cur.style.left = `${I.px * 100}%`; cur.style.top = `${I.py * 100}%`;
      (q('.prog i') as HTMLElement).style.width = `${(1 - Math.max(0, T.ring)) * 100}%`;
    }
    const dots = this.root.querySelectorAll('.dots i');
    if (dots.length) dots.forEach((d, i) => d.classList.toggle('ok', i < T.done));
    if (T.done > this.lastDone) { this.lastDone = T.done; audio.tone(660, 0.08, 'sine', 0.12); }
    if (T.result) {
      c.endT = 0.35;
      if (T.result.passed) { audio.tone(784, 0.14, 'sine', 0.14); audio.tone(1046, 0.2, 'sine', 0.1, 0.08); }
      else { audio.tone(140, 0.3, 'sawtooth', 0.14, 0, -60); inp.rumble(160, 0.7); }
      this.root.querySelectorAll('.dots i').forEach((d, i) => { if (!T.result!.passed && i >= T.done) d.classList.add('no'); });
    }
  }
}
