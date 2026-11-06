// Keyboard, mouse (pointer-lock with drag fallback), touch and gamepad input.
// Touch: the on-screen joystick (ui/touch.ts) feeds `touchMove`, drags on the
// world (canvas) look around, and on-screen buttons press actions.
// Gamepad: Gamepad API, polled once per frame from main.ts.
// Game code asks for actions (`held('jump')`, `act('interact')`), so the player
// can rebind them. Raw `down('KeyX')` / `hit('KeyX')` still read the keyboard.
export type InputDevice = 'kbm' | 'touch' | 'pad';
export type PadStyle = 'xbox' | 'ps' | 'nintendo';

export type Action = 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'jump' | 'interact' | 'inventory' | 'crew' | 'objectives' | 'codex' | 'pause';
/** Actions listed in the remap screen, in order. */
export const KB_ACTIONS: Action[] = ['forward', 'back', 'left', 'right', 'sprint', 'jump', 'interact', 'inventory', 'crew', 'objectives', 'codex'];
export const PAD_ACTIONS: Action[] = ['sprint', 'jump', 'interact', 'inventory', 'crew', 'objectives', 'codex', 'pause'];

export interface Binds { kb: Record<Action, string[]>; pad: Partial<Record<Action, number>> }

/** Standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 10 L3, 11 R3, 12-15 d-pad. */
export function defaultBinds(): Binds {
  return {
    kb: {
      forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA'], right: ['KeyD'],
      sprint: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], interact: ['KeyE', 'KeyF'],
      inventory: ['KeyI', 'Tab'], crew: ['KeyC'], objectives: ['KeyJ', 'KeyO'], codex: ['KeyK'], pause: ['Escape'],
    },
    pad: { sprint: 6, jump: 0, interact: 2, inventory: 3, crew: 5, objectives: 8, codex: 4, pause: 9 },
  };
}

export interface MenuKeys { up: boolean; down: boolean; left: boolean; right: boolean; a: boolean; b: boolean; lb: boolean; rb: boolean; scroll: number }
const noMenu = (): MenuKeys => ({ up: false, down: false, left: false, right: false, a: false, b: false, lb: false, rb: false, scroll: 0 });

const DEAD = 0.18;
const stick = (v: number) => { const a = Math.abs(v); return a < DEAD ? 0 : Math.sign(v) * ((a - DEAD) / (1 - DEAD)); };

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  /** Keys held by on-screen buttons (merged into down()). */
  virtual = new Set<string>();
  private actTaps = new Set<Action>();
  private actHolds = new Set<Action>();
  lookDX = 0;
  lookDY = 0;
  wheel = 0;
  touchMove = { x: 0, y: 0 };
  padMove = { x: 0, y: 0 };
  enabled = false;
  /** Total look movement so far (tutorial uses it to see the player looked around). */
  lookTotal = 0;
  /** Last device the player used; drives prompt glyphs and the touch overlay. */
  device: InputDevice;
  padStyle: PadStyle = 'xbox';
  padConnected = false;
  binds: Binds = defaultBinds();
  /** Edges for menu navigation this frame (ui/nav.ts reads them). */
  menu: MenuKeys = noMenu();
  /** The remap screen is listening: the next key or button goes here. */
  capture: { dev: 'kb' | 'pad'; done: (code: string | number | null) => void } | null = null;
  vibration = true;
  private padDown = new Set<number>();
  private padHit = new Set<number>();
  private repeat = { dir: '', next: 0 };
  private pad: Gamepad | null = null;
  private dragging = false;
  private lookPointer: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private pinch = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private deviceListeners = new Set<(d: InputDevice) => void>();
  private disconnectListeners = new Set<() => void>();

  constructor(private canvas: HTMLCanvasElement) {
    this.device = matchMedia('(pointer: coarse)').matches ? 'touch' : 'kbm';
    window.addEventListener('keydown', (e) => {
      if (this.capture?.dev === 'kb') {
        e.preventDefault(); e.stopImmediatePropagation();
        const c = this.capture; this.capture = null;
        c.done(e.code === 'Escape' ? null : e.code);
        return;
      }
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.setDevice('kbm');
      if (this.enabled && ['Space', 'Tab'].includes(e.code)) e.preventDefault();
    }, true);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.virtual.clear(); this.actHolds.clear(); });
    window.addEventListener('gamepaddisconnected', () => {
      this.pollPads();
      if (!this.pad) { this.padConnected = false; this.padDown.clear(); this.padMove.x = this.padMove.y = 0; this.disconnectListeners.forEach((f) => f()); }
    });

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
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.setDevice('kbm');
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

  // ---------- gamepad ----------
  private pollPads() {
    let list: (Gamepad | null)[] = [];
    try { list = Array.from(navigator.getGamepads?.() ?? []); } catch { /* blocked by policy */ }
    this.pad = list.find((g) => g?.connected) ?? null;
    if (this.pad) {
      this.padConnected = true;
      const id = this.pad.id.toLowerCase();
      this.padStyle = /054c|playstation|dualsense|dualshock/.test(id) ? 'ps' : /057e|nintendo|joy-con|pro controller/.test(id) ? 'nintendo' : 'xbox';
    }
  }

  /** Read the pad once per frame, before anything asks about input. */
  poll(dt: number) {
    this.menu = noMenu();
    this.padHit.clear();
    this.pollPads();
    const g = this.pad;
    if (!g) { this.padMove.x = this.padMove.y = 0; return; }
    const was = this.padDown;
    const now = new Set<number>();
    g.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.4) now.add(i); });
    for (const i of now) if (!was.has(i)) this.padHit.add(i);
    this.padDown = now;
    const lx = stick(g.axes[0] ?? 0), ly = stick(g.axes[1] ?? 0), rx = stick(g.axes[2] ?? 0), ry = stick(g.axes[3] ?? 0);
    if (this.padHit.size || Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0.4) this.setDevice('pad');

    if (this.capture?.dev === 'pad') {
      const hit = Array.from(this.padHit)[0];
      if (hit !== undefined) { const c = this.capture; this.capture = null; c.done(hit); this.padHit.clear(); }
      return;
    }

    if (this.enabled) {
      this.padMove.x = lx; this.padMove.y = ly;
      // look: squared response, so small tilts aim and full tilt turns
      const dx = rx * Math.abs(rx) * 950 * dt, dy = ry * Math.abs(ry) * 620 * dt;
      this.lookDX += dx; this.lookDY += dy;
      this.lookTotal += Math.abs(dx) + Math.abs(dy);
      if (now.has(12)) this.wheel -= dt * 5;
      if (now.has(13)) this.wheel += dt * 5;
    } else this.padMove.x = this.padMove.y = 0;

    // menus: d-pad or left stick, repeating when held
    const dir = now.has(12) || ly < -0.55 ? 'up' : now.has(13) || ly > 0.55 ? 'down' : now.has(14) || lx < -0.55 ? 'left' : now.has(15) || lx > 0.55 ? 'right' : '';
    const t = performance.now();
    if (dir && dir !== this.repeat.dir) { this.repeat = { dir, next: t + 380 }; this.menu[dir as 'up'] = true; }
    else if (dir && t >= this.repeat.next) { this.repeat.next = t + 110; this.menu[dir as 'up'] = true; }
    else if (!dir) this.repeat.dir = '';
    this.menu.a = this.padHit.has(0);
    this.menu.b = this.padHit.has(1);
    this.menu.lb = this.padHit.has(4);
    this.menu.rb = this.padHit.has(5);
    this.menu.scroll = ry;
  }

  /** Any button that should skip a cutscene. */
  padSkip() { return this.padHit.has(0) || this.padHit.has(1) || this.padHit.has(9); }

  rumble(ms: number, strength: number) {
    if (!this.vibration || this.device !== 'pad') return;
    const act = (this.pad as unknown as { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } } | null)?.vibrationActuator;
    act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 })?.catch?.(() => {});
  }

  // ---------- actions ----------
  /** Is the action held on any device? */
  held(a: Action) {
    if (this.actHolds.has(a)) return true;
    const p = this.binds.pad[a];
    return (p !== undefined && this.padDown.has(p)) || this.binds.kb[a].some((c) => this.down(c));
  }
  /** Was the action pressed this frame? */
  act(a: Action) {
    if (this.actTaps.has(a)) return true;
    const p = this.binds.pad[a];
    return (p !== undefined && this.padHit.has(p)) || this.binds.kb[a].some((c) => this.hit(c));
  }
  /** Was the action pressed on the pad this frame? Key presses go through keydown in main.ts. */
  padAct(a: Action) { const p = this.binds.pad[a]; return p !== undefined && this.padHit.has(p); }
  /** Which action, if any, a keyboard code triggers. */
  actionFor(code: string): Action | null {
    for (const a of Object.keys(this.binds.kb) as Action[]) if (this.binds.kb[a].includes(code)) return a;
    return null;
  }

  /** Press an action for one frame (on-screen buttons). */
  tapAction(a: Action) { this.actTaps.add(a); }
  /** Hold or release an action (on-screen sprint). */
  holdAction(a: Action, on: boolean) { if (on) this.actHolds.add(a); else this.actHolds.delete(a); }

  setBinds(b: Binds | undefined) {
    const d = defaultBinds();
    this.binds = { kb: { ...d.kb, ...b?.kb }, pad: { ...d.pad, ...b?.pad } };
  }

  /** Bind a key: it leaves any other action, which inherits this action's old key if left with none. */
  bindKey(a: Action, code: string) {
    const kb = this.binds.kb, old = kb[a][0];
    for (const k of Object.keys(kb) as Action[]) {
      if (k === a || !kb[k].includes(code)) continue;
      kb[k] = kb[k].filter((c) => c !== code);
      if (!kb[k].length) kb[k] = [old];
    }
    kb[a] = [code, ...kb[a].slice(1).filter((c) => c !== code && c !== old)];
  }

  bindPad(a: Action, button: number) {
    const pad = this.binds.pad, old = pad[a];
    for (const k of Object.keys(pad) as Action[]) if (k !== a && pad[k] === button) pad[k] = old;
    pad[a] = button;
  }

  setDevice(d: InputDevice) {
    if (d === this.device) return;
    this.device = d;
    this.deviceListeners.forEach((f) => f(d));
  }
  onDevice(f: (d: InputDevice) => void) { this.deviceListeners.add(f); }
  onPadLost(f: () => void) { this.disconnectListeners.add(f); }

  /** Press a key for one frame. */
  tap(code: string) { this.pressed.add(code); }
  /** Hold or release a virtual key. */
  hold(code: string, on: boolean) { if (on) this.virtual.add(code); else this.virtual.delete(code); }

  down(code: string) { return this.keys.has(code) || this.virtual.has(code); }
  hit(code: string) { return this.pressed.has(code); }

  endFrame() {
    this.pressed.clear();
    this.actTaps.clear();
    this.lookDX = this.lookDY = 0;
    this.wheel = 0;
  }

  /** Stop all touch movement (menus opened, game paused). */
  resetTouch() {
    this.touchMove.x = this.touchMove.y = 0;
    this.lookPointer = null;
    this.pinch.clear();
    this.virtual.clear();
    this.actHolds.clear();
  }

  releasePointer() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
