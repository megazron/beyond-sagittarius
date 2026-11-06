import type { Input } from '../game/input';
import { audio } from '../core/audio';

export type TouchAction = 'inventory' | 'crew' | 'objectives' | 'pause';

/**
 * On-screen controls for phones and tablets: a floating virtual joystick on
 * the left (touch anywhere in the zone to place it), and buttons for
 * interact, jump, sprint (toggle) and the inventory / crew / objectives /
 * pause panels. Looking around is a drag on the world itself (game/input.ts).
 */
export class TouchControls {
  private root = document.getElementById('touch')!;
  private zone = document.getElementById('joy-zone')!;
  private base = document.getElementById('joy')!;
  private knob = document.getElementById('joy-knob')!;
  private act = document.getElementById('tb-act')!;
  private sprintBtn = document.getElementById('tb-sprint')!;
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
    tapBtn('tb-act', () => input.tapAction('interact'));
    tapBtn('tb-jump', () => input.tapAction('jump'));
    tapBtn('tb-sprint', () => this.setSprint(!this.sprint));
    menuBtn('tb-inv', 'inventory');
    menuBtn('tb-crew', 'crew');
    menuBtn('tb-obj', 'objectives');
    menuBtn('tb-pause', 'pause');
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

  /** Highlight the interact button while something can be used. */
  setActionAvailable(on: boolean) { this.act.classList.toggle('ready', on); }

  private sprintUsed = false;
  setSprint(on: boolean) {
    this.sprint = on;
    this.sprintUsed = false;
    this.sprintBtn.classList.toggle('on', on);
    this.input.holdAction('sprint', on);
  }

  /** Pulse a control (tutorial). Pass null to clear. */
  highlight(id: string | null) {
    this.root.querySelectorAll('.pulse').forEach((el) => el.classList.remove('pulse'));
    if (id) document.getElementById(id)?.classList.add('pulse');
  }

  /** Called every frame: sprint switches itself off when you stop. */
  update() {
    const m = this.input.touchMove;
    const moving = Math.hypot(m.x, m.y) >= 0.15;
    if (moving) this.sprintUsed = true;
    if (this.sprint && this.sprintUsed && !moving && this.joyId === null) this.setSprint(false);
  }

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
  }

  private joyUp() {
    this.joyId = null;
    this.input.touchMove.x = this.input.touchMove.y = 0;
    this.base.classList.remove('active');
    this.base.style.left = '';
    this.base.style.top = '';
    this.knob.style.transform = 'translate(-50%, -50%)';
  }
}
