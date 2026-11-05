// Keyboard, mouse (pointer-lock with drag fallback) and touch input.
// Touch: the on-screen joystick (ui/touch.ts) feeds `touchMove`, drags on the
// world (canvas) look around, and on-screen buttons press virtual keys.
export type InputDevice = 'kbm' | 'touch';

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  /** Keys held by on-screen buttons (merged into down()). */
  virtual = new Set<string>();
  lookDX = 0;
  lookDY = 0;
  wheel = 0;
  touchMove = { x: 0, y: 0 };
  enabled = false;
  /** Total look movement so far (tutorial uses it to see the player looked around). */
  lookTotal = 0;
  /** Last device the player used; drives prompt glyphs and the touch overlay. */
  device: InputDevice;
  private dragging = false;
  private lookPointer: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private pinch = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private deviceListeners = new Set<(d: InputDevice) => void>();

  constructor(private canvas: HTMLCanvasElement) {
    this.device = matchMedia('(pointer: coarse)').matches ? 'touch' : 'kbm';
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.setDevice('kbm');
      if (this.enabled && ['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.virtual.clear(); });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        this.setDevice('touch');
        if (!this.enabled) return;
        this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.lookPointer === null) {
          this.lookPointer = e.pointerId;
          this.lookLast = { x: e.clientX, y: e.clientY };
          try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        } else if (this.pinch.size === 2) {
          this.pinchDist = this.pinchSpan();
        }
        e.preventDefault();
        return;
      }
      if (!this.enabled) return;
      this.dragging = true;
      if (e.button === 0 && document.pointerLockElement !== canvas) {
        try { const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined; r?.catch?.(() => {}); } catch { /* ignore */ }
      }
    });
    window.addEventListener('pointerup', (e) => this.endPointer(e));
    window.addEventListener('pointercancel', (e) => this.endPointer(e));
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        if (!this.pinch.has(e.pointerId)) return;
        this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pinch.size === 2) {
          // two fingers on the world: pinch changes the camera distance
          const d = this.pinchSpan();
          if (this.pinchDist > 0) this.wheel += (this.pinchDist - d) / 40;
          this.pinchDist = d;
          return;
        }
        if (e.pointerId === this.lookPointer && this.enabled) {
          const dx = (e.clientX - this.lookLast.x) * 2, dy = (e.clientY - this.lookLast.y) * 2;
          this.lookDX += dx; this.lookDY += dy;
          this.lookTotal += Math.abs(dx) + Math.abs(dy);
          this.lookLast = { x: e.clientX, y: e.clientY };
        }
        return;
      }
      if (e.movementX || e.movementY) this.setDevice('kbm');
      if (!this.enabled) return;
      if (document.pointerLockElement === canvas || this.dragging) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
        this.lookTotal += Math.abs(e.movementX) + Math.abs(e.movementY);
      }
    });
    canvas.addEventListener('wheel', (e) => { if (this.enabled) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    // no long-press menus / selection on the game surface
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private pinchSpan() {
    const [a, b] = Array.from(this.pinch.values());
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private endPointer(e: PointerEvent) {
    if (e.pointerType === 'mouse') { this.dragging = false; return; }
    this.pinch.delete(e.pointerId);
    if (this.pinch.size < 2) this.pinchDist = 0;
    if (e.pointerId === this.lookPointer) {
      this.lookPointer = null;
      // hand look over to a remaining finger, if any
      const rest = Array.from(this.pinch.entries())[0];
      if (rest) { this.lookPointer = rest[0]; this.lookLast = { ...rest[1] }; }
    }
  }

  setDevice(d: InputDevice) {
    if (d === this.device) return;
    this.device = d;
    this.deviceListeners.forEach((f) => f(d));
  }
  onDevice(f: (d: InputDevice) => void) { this.deviceListeners.add(f); }

  /** Press a key for one frame (on-screen buttons). */
  tap(code: string) { this.pressed.add(code); }
  /** Hold or release a virtual key (on-screen sprint). */
  hold(code: string, on: boolean) { if (on) this.virtual.add(code); else this.virtual.delete(code); }

  down(code: string) { return this.keys.has(code) || this.virtual.has(code); }
  hit(code: string) { return this.pressed.has(code); }

  endFrame() {
    this.pressed.clear();
    this.lookDX = this.lookDY = 0;
    this.wheel = 0;
  }

  /** Stop all touch movement (menus opened, game paused). */
  resetTouch() {
    this.touchMove.x = this.touchMove.y = 0;
    this.lookPointer = null;
    this.pinch.clear();
    this.virtual.clear();
  }

  releasePointer() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
