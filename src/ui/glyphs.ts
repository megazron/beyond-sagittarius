import type { Action, Input, InputDevice } from '../game/input';
import { icon } from './icons';

/** Things a prompt can name: bound actions plus fixed menu and camera inputs. */
export type Glyph = Action | 'move' | 'look' | 'confirm' | 'cancel' | 'tabs' | 'wheel' | 'skip';

let input: Input | null = null;
export function initGlyphs(i: Input) {
  input = i;
  i.onDevice(() => refreshGlyphs());
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', Escape: 'Esc', Backspace: 'Bksp', CapsLock: 'Caps',
  ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', AltLeft: 'Alt', AltRight: 'R Alt',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', Backslash: '\\',
};
export function keyName(code: string) {
  return KEY_NAMES[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}
export function keyCap(code: string) {
  const arrow = /^Arrow(Up|Down|Left|Right)$/.exec(code);
  if (arrow) return `<kbd class="kc">${icon(arrow[1].toLowerCase())}</kbd>`;
  const n = keyName(code);
  return `<kbd class="kc${n.length > 1 ? ' wide' : ''}">${n.replace(/[&<>]/g, '')}</kbd>`;
}

const FACE: Record<string, string[]> = { xbox: ['A', 'B', 'X', 'Y'], nintendo: ['B', 'A', 'Y', 'X'] };
const PS = ['ps-cross', 'ps-circle', 'ps-square', 'ps-triangle'];
const SHOULDER: Record<string, string[]> = { xbox: ['LB', 'RB', 'LT', 'RT'], ps: ['L1', 'R1', 'L2', 'R2'], nintendo: ['L', 'R', 'ZL', 'ZR'] };
const MIDDLE: Record<string, string[]> = { xbox: ['View', 'Menu'], ps: ['Share', 'Options'], nintendo: ['-', '+'] };

export function padCap(b: number) {
  const style = input?.padStyle ?? 'xbox';
  if (b <= 3) return `<span class="pc face">${style === 'ps' ? icon(PS[b]) : FACE[style][b]}</span>`;
  if (b <= 7) return `<span class="pc bumper">${SHOULDER[style][b - 4]}</span>`;
  if (b <= 9) return `<span class="pc bumper">${MIDDLE[style][b - 8]}</span>`;
  if (b <= 11) return `<span class="pc face">${b === 10 ? 'L' : 'R'}</span>`;
  if (b <= 15) return `<span class="pc face">${icon(['up', 'down', 'left', 'right'][b - 12])}</span>`;
  return `<span class="pc face">${b}</span>`;
}

const TOUCH: Partial<Record<Glyph, string>> = {
  move: 'stick', look: 'drag', interact: 'use', jump: 'jump', sprint: 'sprint', inventory: 'inventory', wheel: 'inventory', pause: 'pause',
  objectives: 'pause', crew: 'pause', codex: 'pause', confirm: 'tap', cancel: 'back', skip: 'tap',
};

function html(g: Glyph, dev: InputDevice): string {
  const i = input;
  if (!i) return '';
  if (dev === 'touch') return `<span class="tc">${icon(TOUCH[g] ?? 'tap')}</span>`;
  if (dev === 'pad') {
    switch (g) {
      case 'move': return '<span class="pc face stick">L</span>';
      case 'look': return '<span class="pc face stick">R</span>';
      case 'confirm': case 'skip': return padCap(0);
      case 'cancel': return padCap(1);
      case 'tabs': return padCap(4) + padCap(5);
      case 'wheel': return padCap(i.binds.pad.inventory ?? 3);
      case 'forward': case 'back': case 'left': case 'right': return '<span class="pc face stick">L</span>';
      default: return padCap(i.binds.pad[g] ?? 0);
    }
  }
  const k = i.binds.kb;
  switch (g) {
    case 'move': return k.forward[0] === 'KeyW' && k.left[0] === 'KeyA' && k.back[0] === 'KeyS' && k.right[0] === 'KeyD'
      ? '<kbd class="kc wide">WASD</kbd>' : [k.forward, k.left, k.back, k.right].map((c) => keyCap(c[0])).join('');
    case 'look': return `<span class="tc">${icon('mouse')}</span>`;
    case 'confirm': return keyCap('Enter');
    case 'skip': return keyCap('Enter');
    case 'cancel': return keyCap('Escape');
    case 'tabs': return keyCap('KeyQ') + keyCap('KeyR');
    case 'wheel': return keyCap(k.inventory[0]);
    default: return keyCap(k[g][0]);
  }
}

/** A glyph that follows the device in use. */
export const glyph = (g: Glyph) => `<span class="gl" data-glyph="${g}">${html(g, input?.device ?? 'kbm')}</span>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Escapes text and turns [[action]] tokens into glyphs. */
export const glyphText = (s: string) => esc(s).replace(/\[\[(\w+)\]\]/g, (_, g: Glyph) => glyph(g));

export function refreshGlyphs(root: ParentNode = document) {
  const dev = input?.device ?? 'kbm';
  root.querySelectorAll<HTMLElement>('[data-glyph]').forEach((el) => { el.innerHTML = html(el.dataset.glyph as Glyph, dev); });
}
