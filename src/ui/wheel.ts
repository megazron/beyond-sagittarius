import { t } from '../i18n';
import { audio } from '../core/audio';
import { icon } from './icons';
import type { Input } from '../game/input';

export const ITEM_ICON: Record<string, string> = {
  stone: 'stone', branch: 'branch', fruit: 'fruit', redFruit: 'redFruit', tinder: 'tinder', frond: 'frond', flint: 'flint', vine: 'vine', scrap: 'scrap', spear: 'spear', transmitter: 'transmitter',
};

/**
 * Radial item wheel. Hold the inventory input, aim with the stick or the mouse
 * (or touch a segment), let go to use it. The world slows while it is open.
 */
export class Wheel {
  private el = document.getElementById('wheel')!;
  private items: { key: string; n: number | null }[] = [];
  private sel = -1;
  private aim = { x: 0, y: 0 };
  open = false;

  constructor(private input: Input, private onUse: (key: string) => void) {
    this.el.addEventListener('pointerdown', (e) => {
      const seg = (e.target as HTMLElement).closest<HTMLElement>('.wseg');
      if (seg) { this.pick(+seg.dataset.i!); this.close(true); }
      else this.close(false);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = this.el.getBoundingClientRect();
      this.point(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    });
  }

  show(inv: Record<string, number>, tools: string[]) {
    this.items = [...Object.keys(inv).filter((k) => (inv[k] ?? 0) > 0).map((k) => ({ key: k, n: inv[k] })), ...tools.map((k) => ({ key: k, n: null }))];
    this.sel = -1; this.aim = { x: 0, y: 0 };
    const N = Math.max(this.items.length, 1), R = 38;
    this.el.querySelector('.wring')!.innerHTML = this.items.map((it, i) => {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      return `<button class="wseg" data-i="${i}" style="left:${50 + Math.cos(a) * R}%;top:${50 + Math.sin(a) * R}%">${icon(ITEM_ICON[it.key] ?? 'marker')}${it.n !== null ? `<b>${it.n}</b>` : ''}</button>`;
    }).join('');
    this.label();
    this.el.classList.remove('hidden');
    this.open = true;
    audio.uiWheel();
  }

  private label() {
    const it = this.items[this.sel];
    this.el.querySelector('.wname')!.textContent = it ? t(`item.${it.key}`) : this.items.length ? '' : t('wheel.empty');
    this.el.querySelector('.wdesc')!.textContent = it ? t(`itemdesc.${it.key}`) : '';
  }

  private pick(i: number) {
    if (i === this.sel) return;
    this.sel = i;
    this.el.querySelectorAll('.wseg').forEach((b, k) => b.classList.toggle('on', k === i));
    this.label();
    if (i >= 0) audio.uiMove();
  }

  private point(x: number, y: number) {
    if (!this.items.length || Math.hypot(x, y) < 24) return;
    const a = Math.atan2(y, x) + Math.PI / 2, N = this.items.length;
    this.pick(((Math.round((a / (Math.PI * 2)) * N) % N) + N) % N);
  }

  /** While open: read the stick and pointer-lock mouse. */
  update(lookX: number, lookY: number, stickX: number, stickY: number) {
    if (!this.open) return;
    if (Math.hypot(stickX, stickY) > 0.5) this.point(stickX * 100, stickY * 100);
    else if (lookX || lookY) {
      this.aim.x = Math.max(-120, Math.min(120, this.aim.x + lookX));
      this.aim.y = Math.max(-120, Math.min(120, this.aim.y + lookY));
      this.point(this.aim.x, this.aim.y);
    }
  }

  close(use: boolean) {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    const it = this.items[this.sel];
    if (use && it) this.onUse(it.key);
    void this.input;
  }
}
