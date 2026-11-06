import { t } from '../i18n';
import { audio } from '../core/audio';

const RING = 2 * Math.PI * 21;
/** Input is ignored this long after opening, so a skip tap can't pass it. */
const GUARD_MS = 280;

export interface QuickSpec {
  label: string;
  /** Window; null waits for the press. */
  seconds: number | null;
  onDone: (passed: boolean) => void;
}

/**
 * The quick-time prompt, and the mark that an answer went in the book. Choices
 * themselves use the conversation panel (game/dialogue.ts). Time comes from
 * update(), so a paused game stops the clock.
 */
export class QuickPrompt {
  private el = document.createElement('div');
  private ledger = document.createElement('div');
  private spec: QuickSpec | null = null;
  private left = 0;
  private total = 0;
  private opened = 0;
  private ledgerTimer = 0;

  constructor() {
    this.el.id = 'qte';
    this.el.className = 'qte hidden';
    this.ledger.id = 'ledger-note';
    this.ledger.className = 'ledger-note hidden';
    document.body.append(this.el, this.ledger);
    window.addEventListener('keydown', (e) => this.key(e), true);
  }

  get open() { return !!this.spec; }
  get remaining() { return this.spec && this.total ? this.left : null; }

  quick(spec: QuickSpec) {
    this.spec = spec;
    this.total = this.left = spec.seconds ?? 0;
    this.opened = performance.now();
    const ring = spec.seconds ? `<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="bg" cx="24" cy="24" r="21"/><circle class="fg" cx="24" cy="24" r="21" stroke-dasharray="${RING}"/></svg>` : '';
    this.el.innerHTML = `<button id="qte-btn" class="ring-timer">${ring}<kbd>E</kbd></button><div class="qte-label"></div>`;
    this.el.querySelector('.qte-label')!.textContent = spec.label;
    this.el.querySelector('button')!.addEventListener('click', () => this.press());
    this.el.classList.remove('hidden');
    document.body.classList.add('choosing');
    this.paint();
    audio.beep();
  }

  /** A short mark that the answer has gone in the book. */
  note() {
    this.ledger.textContent = t('br.written');
    this.ledger.classList.remove('hidden');
    clearTimeout(this.ledgerTimer);
    this.ledgerTimer = window.setTimeout(() => this.ledger.classList.add('hidden'), 2200);
  }

  private paint() {
    const fg = this.el.querySelector<SVGCircleElement>('.fg');
    if (!fg) return;
    const k = Math.max(0, this.left / this.total);
    fg.style.strokeDashoffset = String(RING * (1 - k));
    this.el.classList.toggle('urgent', k < 0.34);
  }

  update(dt: number) {
    if (!this.spec || !this.total) return;
    this.left -= dt;
    this.paint();
    if (this.left <= 0) this.finish(false);
  }

  /** The press itself: key, tap or pad. */
  press() { if (performance.now() - this.opened >= GUARD_MS) this.finish(true); }

  private finish(passed: boolean) {
    const s = this.spec;
    if (!s) return;
    this.spec = null;
    this.total = 0;
    this.el.classList.add('hidden');
    document.body.classList.remove('choosing');
    s.onDone(passed);
  }

  private key(e: KeyboardEvent) {
    if (!this.spec) return;
    e.stopPropagation(); // the scene behind mustn't read Enter or Escape as skip
    if (!e.repeat && (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'Space' || e.code === 'Enter')) this.press();
  }
}
