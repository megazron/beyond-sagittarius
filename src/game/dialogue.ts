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
}

export interface DlgTree { start: string; nodes: Record<string, DlgNode> }

/** Touch-friendly conversation panel: one voiced line, a column of big choices. */
export class Dialogue {
  private tree: DlgTree | null = null;
  private current = '';
  private said = new Map<string, string>();
  private list: DlgChoice[] = [];
  private end: (() => void) | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.tree || e.repeat) return;
      if (e.code === 'Escape') { this.close(); return; }
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m) this.pick(+m[1] - 1);
    });
    $('dlg-choices').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b && !b.disabled) this.pick(+b.dataset.i!);
    });
  }

  get open() { return !!this.tree; }

  start(tree: DlgTree, end: () => void) {
    this.tree = tree;
    this.end = end;
    this.said.clear();
    $('dialog').classList.remove('hidden');
    this.show(tree.start);
  }

  private show(id: string) {
    const node = this.tree!.nodes[id];
    this.current = id;
    const fresh = !this.said.has(id);
    if (fresh) this.said.set(id, typeof node.say === 'function' ? node.say() : node.say);
    const key = this.said.get(id)!;
    $('dlg-who').textContent = t(node.who);
    $('dlg-line').textContent = t(key);
    if (fresh) voice.play(key);
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
    audio.uiClick();
    c.run?.();
    if (c.go) { this.show(c.go); return; }
    this.close();
    c.then?.();
  }

  close() {
    if (!this.tree) return;
    this.tree = null;
    voice.stop();
    $('dialog').classList.add('hidden');
    const end = this.end;
    this.end = null;
    end?.();
  }

  debug() { return this.tree ? { node: this.current, line: $('dlg-line').textContent, choices: this.list.map((c) => c.label) } : null; }
}
