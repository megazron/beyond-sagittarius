import type { Input } from '../game/input';
import { audio } from '../core/audio';
import { icon } from './icons';

export type TouchAction = 'wheel' | 'pause' | 'codex';

/**
 * On-screen controls for phones and tablets, laid out like a mobile action game:
 * a stick that appears under your left thumb (push it to the rim to run), one
 * context button that uses what is in reach and otherwise jumps, a bag for the
 * item wheel and a menu button. Looking is a drag on the world (game/input.ts).
 */
export class TouchControls {
  private root = document.getElementById('touch')!;
  private zone = document.getElementById('joy-zone')!;
  private base = document.getElementById('joy')!;
  private knob = document.getElementById('joy-knob')!;
  private act = document.getElementById('tb-act')!;
  private joyId: number | null = null;
  private origin = { x: 0, y: 0 };
  private radius = 56;
  sprint = false;
  /** Total joystick travel (tutorial checks the player moved with it). */
  moveTotal = 0;

  constructor(private input: Input, private onAction: (a: TouchAction) => void) {
    this.zone.addEventListener('pointerdown', (e) => this.joyDown(e));
    this.zone.addEventListener('pointermove', (e) => this.joyMove(e));
    const up = (e: PointerEvent) => { if (e.pointerId === this.joyId) this.joyUp(); };
    this.zone.addEventListener('pointerup', up);
    this.zone.addEventListener('pointercancel', up);
    this.zone.addEventListener('lostpointercapture', up);

    const tapBtn = (id: string, fn: () => void) => {
      const el = document.getElementById(id)!;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.add('down');
        input.setDevice('touch');
        fn();
      });
      const release = () => el.classList.remove('down');
      el.addEventListener('pointerup', release);
      el.addEventListener('pointerleave', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    // panels open on release: opening on press would let the same touch's click
    // land on whatever menu button appears under the finger
    const menuBtn = (id: string, a: TouchAction) => {
      tapBtn(id, () => {});
      document.getElementById(id)!.addEventListener('click', () => { audio.uiClick(); onAction(a); });
    };
    tapBtn('tb-act', () => input.tapAction(document.body.classList.contains('can-act') ? 'interact' : 'jump'));
    menuBtn('tb-inv', 'wheel');
    menuBtn('tb-pause', 'pause');
    menuBtn('tb-codex', 'codex');
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  private layout() {
    const s = Math.min(window.innerWidth, window.innerHeight);
    this.radius = Math.max(42, Math.min(70, s * 0.13));
    document.documentElement.style.setProperty('--joy-r', `${this.radius}px`);
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
    if (!on) this.reset();
  }

  /** The context button shows what it will do. */
  private shown = '';
  syncAct() {
    const want = document.body.classList.contains('can-act') ? 'use' : 'jump';
    if (want !== this.shown) { this.shown = want; document.getElementById('tb-act-ico')!.innerHTML = icon(want); }
  }

  setSprint(on: boolean) {
    if (on === this.sprint) return;
    this.sprint = on;
    this.base.classList.toggle('run', on);
    this.input.holdAction('sprint', on);
  }

  /** Pulse a control (tutorial). Pass null to clear. */
  highlight(id: string | null) {
    this.root.querySelectorAll('.pulse').forEach((el) => el.classList.remove('pulse'));
    if (id) document.getElementById(id)?.classList.add('pulse');
  }

  /** Called every frame. */
  update() { this.syncAct(); }

  reset() {
    this.joyUp();
    this.setSprint(false);
  }

  private joyDown(e: PointerEvent) {
    if (this.joyId !== null) return;
    e.preventDefault();
    this.input.setDevice('touch');
    this.joyId = e.pointerId;
    try { this.zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.origin = { x: e.clientX, y: e.clientY };
    this.base.classList.add('active');
    this.base.style.left = `${e.clientX}px`;
    this.base.style.top = `${e.clientY}px`;
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private joyMove(e: PointerEvent) {
    if (e.pointerId !== this.joyId) return;
    e.preventDefault();
    let dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y;
    const d = Math.hypot(dx, dy), r = this.radius;
    if (d > r) { dx *= r / d; dy *= r / d; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // small dead zone, then a linear response
    const k = d < 6 ? 0 : 1;
    const nx = (dx / r) * k, ny = (dy / r) * k;
    this.moveTotal += Math.abs(nx - this.input.touchMove.x) + Math.abs(ny - this.input.touchMove.y);
    this.input.touchMove.x = nx;
    this.input.touchMove.y = ny;
    // pushed to the rim, forwards: run. Easing off walks again.
    if (d >= r * 0.92 && ny < -0.6) this.setSprint(true);
    else if (d < r * 0.7) this.setSprint(false);
  }

  private joyUp() {
    this.joyId = null;
    this.setSprint(false);
    this.input.touchMove.x = this.input.touchMove.y = 0;
    this.base.classList.remove('active');
    this.base.style.left = '';
    this.base.style.top = '';
    this.knob.style.transform = 'translate(-50%, -50%)';
  }
}
