import { t } from '../i18n';
import { audio } from '../core/audio';
import { voice } from '../core/voice';
import type { SaveData } from '../core/save';
import { AGES, TECH, TECH_BY_ID, TechNode } from '../game/tech/data';
import { isDiscovered, techState, playableCount } from '../game/tech/tech';
import { escapeHtml as esc } from './ui';
import type { UI } from './ui';

const $ = (id: string) => document.getElementById(id)!;
const CONSENT_KEY = 'bs-consent-v1';

let queueToken = 0;
/** Speak lines one after another; a new queue or stopSpeech() cancels it. */
export function speak(keys: string[]) {
  const tk = ++queueToken;
  let i = 0;
  const next = () => {
    if (tk !== queueToken || i >= keys.length) return;
    const d = voice.play(keys[i++]);
    setTimeout(next, ((d ?? 0) + 0.35) * 1000);
  };
  next();
}
export function stopSpeech() { queueToken++; voice.stop(); }

const jokerName = (n: TechNode) => t(n.joker === 'megazron' ? 'mz.name' : `crew.${n.joker}.name`);
const warnings = (n: TechNode) => n.warn.map((w) => `<p class="warn" data-warn="${w}">${esc(t(`warn.${w}`))}</p>`).join('');
const needs = (n: TechNode) => n.requires.map((r) => t(`tech.${r}`)).join(', ');

// ---------------- discovery card ----------------
let discClose: (() => void) | null = null;
window.addEventListener('keydown', (e) => {
  if (discClose && !e.repeat && (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyE')) { e.preventDefault(); discClose(); }
});

/** What you just found: the true explanation, the plain warning, then the joke. */
export function showDiscovery(n: TechNode, onClose: () => void) {
  const el = $('disc');
  el.innerHTML = `<div class="eyebrow">${esc(t('disc.head'))}</div>
    <h2>${esc(t(`tech.${n.id}`))}</h2>
    <p class="disc-text">${esc(t(`${n.codex}.text`))}</p>
    ${warnings(n)}
    <p class="disc-joke"><b>${esc(jokerName(n))}</b> ${esc(t(`${n.codex}.joke`))}</p>
    <button class="btn primary" id="disc-ok">${esc(t('disc.continue'))}</button>`;
  el.classList.remove('hidden');
  audio.chime();
  speak([`${n.codex}.text`, ...n.warn.map((w) => `warn.${w}`), `${n.codex}.joke`]);
  discClose = () => {
    discClose = null;
    stopSpeech();
    el.classList.add('hidden');
    audio.uiClick();
    onClose();
  };
  $('disc-ok').addEventListener('click', () => discClose?.());
}

// ---------------- codex ----------------
const ICON = { done: '◆', open: '◇', locked: '▢', planned: '▢' } as const;

function detail(save: SaveData, n: TechNode): string {
  const st = techState(save, n);
  const req = n.requires.length ? `<p class="note">${esc(t('codex.needs', { list: needs(n) }))}</p>` : '';
  if (st === 'planned') return `<p>${esc(t('codex.planned'))}</p>${req}`;
  if (st !== 'done') return `<p>${esc(t('codex.undiscovered'))}</p>${req}`;
  return `<p>${esc(t(`${n.codex}.text`))}</p>${warnings(n)}
    <p class="disc-joke"><b>${esc(jokerName(n))}</b> ${esc(t(`${n.codex}.joke`))}</p>
    <button class="btn small cx-listen" data-id="${n.id}">${esc(t('safety.listen'))}</button>`;
}

/** Vertical tree: one trunk per age, tap a node to open it in place. Reads the same on a phone. */
export function openCodex(ui: UI, save: SaveData, onClose: () => void) {
  const found = (save.discoveries ?? []).length;
  const ages = AGES.map((a) => {
    const nodes = TECH.filter((n) => n.age === a);
    const done = nodes.filter((n) => isDiscovered(save, n.id)).length;
    return `<section class="cx-age"><h3>${esc(t(`age.${a}`))}<span>${done}/${nodes.length}</span></h3>
      <ul class="cx-tree">${nodes.map((n) => {
        const st = techState(save, n);
        return `<li class="cx-${st}"><button class="cx-node" data-id="${n.id}" data-state="${st}"><i>${ICON[st]}</i><span>${esc(t(`tech.${n.id}`))}</span><em>${esc(t(`codex.st.${st}`))}</em></button><div class="cx-detail hidden"></div></li>`;
      }).join('')}</ul></section>`;
  }).join('');
  ui.menuPage('codex', `<h3 class="page-h">${esc(t('codex.title'))}</h3>
    <div class="note arc">${esc(t('codex.progress', { k: found, n: playableCount() }))}</div>
    <div class="cx-safety"><div class="eyebrow">${esc(t('safety.title'))}</div><p>${esc(t('safety.text'))}</p><button class="btn small" id="cx-safety-listen">${esc(t('safety.listen'))}</button></div>
    <div class="cx-ages">${ages}</div>`);
  const card = $('modal-card');
  card.scrollTop = 0;
  $('cx-safety-listen').addEventListener('click', () => { audio.uiClick(); speak(['safety.text']); });
  card.querySelectorAll<HTMLButtonElement>('.cx-node').forEach((b) => b.addEventListener('click', () => {
    audio.uiClick();
    const box = b.nextElementSibling as HTMLElement;
    const opening = box.classList.contains('hidden');
    card.querySelectorAll('.cx-detail').forEach((d) => d.classList.add('hidden'));
    if (!opening) return;
    box.innerHTML = detail(save, TECH_BY_ID[b.dataset.id!]);
    box.classList.remove('hidden');
    box.querySelector<HTMLButtonElement>('.cx-listen')?.addEventListener('click', () => {
      const n = TECH_BY_ID[b.dataset.id!];
      audio.uiClick();
      speak([`${n.codex}.text`, ...n.warn.map((w) => `warn.${w}`), `${n.codex}.joke`]);
    });
  }));
  $('m-close').addEventListener('click', () => { audio.uiClick(); stopSpeech(); ui.closeModal(); onClose(); });
}

// ---------------- first-launch card ----------------
export function consentGiven(): boolean {
  try { return !!localStorage.getItem(CONSENT_KEY); } catch { return false; }
}

/** "Do not try this at home" plus the Terms and Privacy accept. Remembered per device. */
export function showSafetyCard(ui: UI) {
  if (consentGiven()) return;
  const el = $('safety');
  const render = () => {
    el.innerHTML = `<div class="safety-card">
      <h2>${esc(t('safety.title'))}</h2>
      <p>${esc(t('safety.text'))}</p>
      <p class="note">${esc(t('safety.accept'))} <button class="linkish" id="sf-legal">${esc(t('safety.legal'))}</button></p>
      <div class="actions"><button class="btn primary" id="sf-ok">${esc(t('safety.ok'))}</button><button class="btn" id="sf-listen">${esc(t('safety.listen'))}</button></div></div>`;
    $('sf-listen').addEventListener('click', () => { audio.start(); audio.uiClick(); void voice.load().then(() => speak(['safety.text'])); });
    $('sf-legal').addEventListener('click', () => {
      audio.start(); audio.uiClick();
      el.classList.add('hidden');
      ui.openLegal(() => el.classList.remove('hidden'));
    });
    $('sf-ok').addEventListener('click', () => {
      audio.start(); audio.uiClick(); stopSpeech();
      try { localStorage.setItem(CONSENT_KEY, String(Date.now())); } catch { /* private mode: shows again next time */ }
      el.classList.add('hidden');
    });
  };
  render();
  el.classList.remove('hidden');
  return render;
}
