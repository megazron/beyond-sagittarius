import { t } from '../i18n';
import { audio } from '../core/audio';
import type { Settings } from '../core/save';
import { Action, Input, KB_ACTIONS, PAD_ACTIONS, defaultBinds } from '../game/input';
import { keyCap, padCap } from './glyphs';

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export function remapHtml(input: Input) {
  const acts = Array.from(new Set<Action>([...KB_ACTIONS, ...PAD_ACTIONS]));
  const cell = (a: Action, dev: 'kb' | 'pad') => {
    if (dev === 'kb' ? !KB_ACTIONS.includes(a) : !PAD_ACTIONS.includes(a)) return '<span class="bind none"></span>';
    return `<button class="bind" data-a="${a}" data-dev="${dev}">${dev === 'kb' ? keyCap(input.binds.kb[a][0]) : padCap(input.binds.pad[a] ?? 0)}</button>`;
  };
  return `<div class="binds" id="binds"><div class="bind-row head"><span></span><span>${esc(t('settings.keyboard'))}</span><span>${esc(t('settings.gamepad'))}</span></div>
    ${acts.map((a) => `<div class="bind-row"><span class="bind-name">${esc(t(`act.${a}`))}</span>${cell(a, 'kb')}${cell(a, 'pad')}</div>`).join('')}
    <div class="note" id="bind-msg"></div>
    <button class="btn small" id="bind-reset">${esc(t('settings.bindReset'))}</button></div>`;
}

/** Click a cell, press the new key or button. Esc, or six seconds, cancels. */
export function bindRemap(input: Input, s: Settings, save: (s: Settings) => void) {
  const root = document.getElementById('binds');
  if (!root) return;
  const msg = document.getElementById('bind-msg')!;
  const redraw = () => {
    root.querySelectorAll<HTMLElement>('.bind[data-a]').forEach((b) => {
      const a = b.dataset.a as Action;
      b.classList.remove('listen');
      b.innerHTML = b.dataset.dev === 'kb' ? keyCap(input.binds.kb[a][0]) : padCap(input.binds.pad[a] ?? 0);
    });
  };
  const commit = () => { s.binds = input.binds; save(s); redraw(); };
  root.querySelectorAll<HTMLElement>('.bind[data-a]').forEach((b) => b.addEventListener('click', () => {
    if (input.capture) return;
    const a = b.dataset.a as Action, dev = b.dataset.dev as 'kb' | 'pad';
    b.classList.add('listen');
    b.textContent = '…';
    msg.textContent = t(dev === 'kb' ? 'settings.bindPressKey' : 'settings.bindPressPad');
    audio.uiListen();
    // gives up after 6 s of play time, not wall time: a stalled frame never eats the window to press
    input.capture = {
      dev, left: 6,
      done: (code) => {
        msg.textContent = '';
        if (code === null) { redraw(); return; }
        if (dev === 'kb') input.bindKey(a, code as string); else input.bindPad(a, code as number);
        audio.uiBound();
        commit();
      },
    };
  }));
  document.getElementById('bind-reset')!.addEventListener('click', () => {
    input.binds = defaultBinds();
    delete s.binds;
    save(s);
    redraw();
  });
}
