import { audio } from '../core/audio';
import type { Input } from '../game/input';

/**
 * Menu focus for keyboard and gamepad, plus the sounds every control makes.
 * It works on whatever is on top: the full-screen menu, anything with the class
 * .nav-layer, or the title screen, so new panels need no wiring.
 */
const FOCUSABLE = 'button:not(:disabled), a[href], input, [tabindex="0"]';
const BACK = '#m-close, #nm-back, #c-no, #p-resume, [data-back]';

export class MenuNav {
  private layerEl: HTMLElement | null = null;
  private soundsOff = false;

  constructor(private input: Input, private onTab: (dir: number) => void) {
    window.addEventListener('keydown', (e) => this.key(e));
    const wake = () => audio.start();
    window.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });
    document.addEventListener('click', (e) => this.clickSound(e), true);
    document.addEventListener('input', (e) => {
      const r = e.target as HTMLInputElement;
      if (r.type === 'range') audio.uiSlider((+r.value - +r.min) / ((+r.max - +r.min) || 1));
    }, true);
    document.addEventListener('pointerover', (e) => {
      const el = (e.target as HTMLElement).closest?.('button, a.btn');
      if (el && (e as PointerEvent).pointerType === 'mouse' && !(el as HTMLButtonElement).disabled) audio.uiMove();
    }, true);
  }

  private clickSound(e: Event) {
    const el = (e.target as HTMLElement).closest?.('button, a.btn') as HTMLElement | null;
    if (!el || this.soundsOff) return;
    if (el.matches(BACK)) audio.uiBack();
    else if (el.closest('.seg, .swatches, .tabs')) audio.uiToggle();
    else audio.uiClick();
  }

  layer(): HTMLElement | null {
    const modal = document.getElementById('modal')!;
    if (!modal.classList.contains('hidden') && !modal.classList.contains('leaving')) return document.getElementById('modal-card');
    const layers = document.querySelectorAll<HTMLElement>('.nav-layer:not(.hidden)');
    if (layers.length) return layers[layers.length - 1];
    const title = document.getElementById('title')!;
    return title.classList.contains('hidden') ? null : title;
  }

  private items(root: HTMLElement) {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
  }

  /** Focus the first sensible control when a layer appears (not on touch: it would raise keyboards). */
  private settle(root: HTMLElement, asked = false) {
    if (this.input.device === 'touch') return;
    if (!asked && root.hasAttribute('data-wait-focus')) return; // focus only once the player moves
    if (root.contains(document.activeElement) && document.activeElement !== root) return;
    const list = this.items(root).filter((el) => !(el instanceof HTMLInputElement && el.type === 'text'));
    (list.find((el) => el.matches('.primary, .active')) ?? list.find((el) => !el.closest('.tabs') && !el.matches(BACK)) ?? list[0])?.focus({ preventScroll: true });
  }

  private move(dir: 'up' | 'down' | 'left' | 'right') {
    const root = this.layer();
    if (!root) return;
    const list = this.items(root);
    const cur = document.activeElement as HTMLElement;
    if (!root.contains(cur) || cur === root) { this.settle(root, true); return; }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best: HTMLElement | null = null, bs = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (along < 4) continue;
      const score = along + across * 2.4;
      if (score < bs) { bs = score; best = el; }
    }
    if (best) { best.focus({ preventScroll: true }); best.scrollIntoView({ block: 'nearest' }); audio.uiMove(); }
    else if (dir === 'up' || dir === 'down') root.scrollBy({ top: dir === 'up' ? -120 : 120 });
  }

  private nudge(r: HTMLInputElement, sign: number) {
    const rtl = getComputedStyle(r).direction === 'rtl' ? -1 : 1;
    r.value = String(+r.value + sign * rtl * (+r.step || 0.05));
    r.dispatchEvent(new Event('input', { bubbles: true }));
  }

  back() {
    const root = this.layer();
    const el = root && root.id !== 'title' ? root.querySelector<HTMLElement>(BACK) : null;
    if (el) { el.click(); return true; }
    return false;
  }

  private key(e: KeyboardEvent) {
    const root = this.layer();
    if (!root) return;
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.type === 'text') return;
    const dir = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[e.code];
    if (dir) {
      if (t instanceof HTMLInputElement && t.type === 'range' && (dir === 'left' || dir === 'right')) return;
      e.preventDefault();
      this.move(dir);
    } else if (root.id === 'modal-card' && (e.code === 'KeyQ' || e.code === 'KeyR')) this.onTab(e.code === 'KeyQ' ? -1 : 1);
  }

  /** Once per frame, after input.poll(). */
  update() {
    const root = this.layer();
    if (root !== this.layerEl) { this.layerEl = root; if (root) this.settle(root); }
    const m = this.input.menu;
    if (!root || this.input.capture) return;
    const cur = document.activeElement as HTMLElement;
    const range = cur instanceof HTMLInputElement && cur.type === 'range' ? cur : null;
    if (m.up) this.move('up');
    if (m.down) this.move('down');
    if (m.left) { if (range) this.nudge(range, -1); else this.move('left'); }
    if (m.right) { if (range) this.nudge(range, 1); else this.move('right'); }
    if (m.a && root.contains(cur) && cur !== root) cur.click();
    else if (m.a) this.settle(root, true);
    if (m.b) this.back();
    if (m.lb) this.onTab(-1);
    if (m.rb) this.onTab(1);
    if (m.scroll) root.scrollBy({ top: m.scroll * 18 });
  }

  /** Content changed under the same layer. */
  refocus() { const r = this.layer(); if (r) { (document.activeElement as HTMLElement | null)?.blur?.(); this.settle(r); } }
}
