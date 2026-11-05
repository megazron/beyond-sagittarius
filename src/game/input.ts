// Keyboard, mouse (pointer-lock with drag fallback) and touch input.
export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  lookDX = 0;
  lookDY = 0;
  wheel = 0;
  touchMove = { x: 0, y: 0 };
  enabled = false;
  private dragging = false;
  private moveTouch: number | null = null;
  private lookTouch: number | null = null;
  private moveOrigin = { x: 0, y: 0 };
  private lookLast = { x: 0, y: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (this.enabled && ['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.dragging = true;
      if (e.button === 0 && document.pointerLockElement !== canvas) {
        try { const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined; r?.catch?.(() => {}); } catch { /* ignore */ }
      }
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement === canvas || this.dragging) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      }
    });
    canvas.addEventListener('wheel', (e) => { if (this.enabled) this.wheel += Math.sign(e.deltaY); }, { passive: true });

    canvas.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < window.innerWidth * 0.45 && this.moveTouch === null) {
          this.moveTouch = t.identifier; this.moveOrigin = { x: t.clientX, y: t.clientY };
        } else if (this.lookTouch === null) {
          this.lookTouch = t.identifier; this.lookLast = { x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.moveTouch) {
          this.touchMove.x = Math.max(-1, Math.min(1, (t.clientX - this.moveOrigin.x) / 60));
          this.touchMove.y = Math.max(-1, Math.min(1, (t.clientY - this.moveOrigin.y) / 60));
        } else if (t.identifier === this.lookTouch) {
          this.lookDX += (t.clientX - this.lookLast.x) * 2;
          this.lookDY += (t.clientY - this.lookLast.y) * 2;
          this.lookLast = { x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.moveTouch) { this.moveTouch = null; this.touchMove.x = this.touchMove.y = 0; }
        if (t.identifier === this.lookTouch) this.lookTouch = null;
      }
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
  }

  down(code: string) { return this.keys.has(code); }
  hit(code: string) { return this.pressed.has(code); }

  endFrame() {
    this.pressed.clear();
    this.lookDX = this.lookDY = 0;
    this.wheel = 0;
  }

  releasePointer() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
