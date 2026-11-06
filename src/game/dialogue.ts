import { t } from '../i18n';
import { audio } from '../core/audio';
import { voice } from '../core/voice';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface DlgChoice {
  /** i18n key of the button text. */
  label: string;
  params?: Record<string, string | number>;
  /** Hidden unless this holds. */
  show?: () => boolean;
  /** Shown disabled with this text when it returns one (e.g. what is missing). */
  blocked?: () => string | null;
  /** Side effect on choosing. */
  run?: () => void;
  /** Node to go to; absent ends the conversation. */
  go?: string;
  /** Runs after the panel has closed (start a minigame...). */
  then?: () => void;
}

export interface DlgNode {
  /** i18n key of the speaker's name. */
  who: string;
  /** Spoken line, or a chooser so people react to the save. Chosen once per visit. */
  say: string | (() => string);
  choices: DlgChoice[] | (() => DlgChoice[]);
  /** The line was just spoken in the scene: show it, don't say it again. */
  quiet?: boolean;
}

export interface DlgTree { start: string; nodes: Record<string, DlgNode> }

/** A conversation that has to be answered: no walking away, and maybe a clock. */
export interface DlgForced {
  /** Countdown; null waits for the player. */
  seconds: number | null;
  /** Choice taken when the countdown ends. */
  fallback: number;
  /** Told first when the countdown is what answered. */
  expired?: () => void;
}

const RING = 2 * Math.PI * 21;
/** A forced panel ignores input this long, so a skip tap meant for the scene can't answer it. */
const GUARD_MS = 320;

/** Touch-friendly conversation panel: one voiced line, a column of big choices. */
export class Dialogue {
  private tree: DlgTree | null = null;
  private current = '';
  private said = new Map<string, string>();
  private list: DlgChoice[] = [];
  private end: (() => void) | null = null;
  private forced: DlgForced | null = null;
  private left = 0;
  private lastSec = 0;
  private openedAt = 0;
  private timer = document.createElement('div');

  constructor() {
    this.timer.id = 'dlg-timer';
    this.timer.className = 'ring-timer hidden';
    this.timer.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="bg" cx="24" cy="24" r="21"/><circle class="fg" cx="24" cy="24" r="21" stroke-dasharray="${RING}"/></svg><b></b>`;
    $('dialog').prepend(this.timer);
    window.addEventListener('keydown', (e) => {
      if (!this.tree || e.repeat) return;
      if (e.code === 'Escape') { if (!this.forced) this.close(); return; }
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m) this.pick(+m[1] - 1);
    });
    $('dlg-choices').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b && !b.disabled) this.pick(+b.dataset.i!);
    });
  }

  get open() { return !!this.tree; }
  /** A decision is on screen, not just a conversation. */
  get deciding() { return !!this.tree && !!this.forced; }

  /** Seconds left on a forced panel, or null with no clock. */
  get remaining() { return this.tree && this.forced?.seconds ? this.left : null; }

  start(tree: DlgTree, end: () => void, forced: DlgForced | null = null) {
    this.tree = tree;
    this.end = end;
    this.said.clear();
    this.forced = forced;
    this.left = forced?.seconds ?? 0;
    this.lastSec = Math.ceil(this.left);
    this.openedAt = performance.now();
    this.timer.classList.toggle('hidden', !forced?.seconds);
    const box = $('dialog');
    box.classList.remove('hidden');
    // nothing pre-selected: Enter still held from skipping must not answer
    box.toggleAttribute('data-wait-focus', !!forced);
    document.body.classList.toggle('choosing', !!forced);
    this.show(tree.start);
    this.paint();
  }

  /** Runs the countdown; call every frame the game isn't paused. */
  update(dt: number) {
    if (!this.tree || !this.forced?.seconds) return;
    this.left -= dt;
    const s = Math.ceil(this.left);
    if (s !== this.lastSec && s > 0 && s <= 3) audio.tone(880, 0.05, 'square', 0.05);
    this.lastSec = s;
    this.paint();
    if (this.left > 0) return;
    this.forced.expired?.();
    this.openedAt = 0;
    this.pick(this.forced.fallback);
  }

  private paint() {
    if (!this.forced?.seconds) return;
    const k = Math.max(0, this.left / this.forced.seconds);
    this.timer.querySelector<SVGCircleElement>('.fg')!.style.strokeDashoffset = String(RING * (1 - k));
    this.timer.querySelector('b')!.textContent = String(Math.max(0, Math.ceil(this.left)));
    this.timer.classList.toggle('urgent', k < 0.34);
  }

  private show(id: string) {
    const node = this.tree!.nodes[id];
    this.current = id;
    const fresh = !this.said.has(id);
    if (fresh) this.said.set(id, typeof node.say === 'function' ? node.say() : node.say);
    const key = this.said.get(id)!;
    $('dlg-who').textContent = t(node.who);
    $('dlg-line').textContent = t(key);
    if (fresh && !node.quiet) voice.play(key);
    const all = typeof node.choices === 'function' ? node.choices() : node.choices;
    this.list = all.filter((c) => !c.show || c.show());
    $('dlg-choices').innerHTML = this.list.map((c, i) => {
      const why = c.blocked?.() ?? null;
      return `<button class="btn dlg-c" data-i="${i}" data-c="${esc(c.label)}"${why ? ' disabled' : ''}><kbd>${i + 1}</kbd><span>${esc(t(c.label, c.params))}${why ? `<small>${esc(why)}</small>` : ''}</span></button>`;
    }).join('');
  }

  pick(i: number) {
    const c = this.list[i];
    if (!c || !this.tree || c.blocked?.()) return;
    if (this.forced && performance.now() - this.openedAt < GUARD_MS) return;
    audio.uiClick();
    c.run?.();
    if (c.go) { this.show(c.go); return; }
    this.close();
    c.then?.();
  }

  close() {
    if (!this.tree) return;
    this.tree = null;
    if (!this.forced) voice.stop();
    this.forced = null;
    document.body.classList.remove('choosing');
    $('dialog').classList.add('hidden');
    const end = this.end;
    this.end = null;
    end?.();
  }

  debug() { return this.tree ? { node: this.current, line: $('dlg-line').textContent, choices: this.list.map((c) => c.label) } : null; }
}
