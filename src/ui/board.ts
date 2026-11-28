import './board.css';
import { t } from '../i18n';
import { escapeHtml } from './ui';
import { MYSTERY } from '../game/branch/mystery';
import { board, markSeen, recapLines } from '../game/mystery';
import type { SaveData } from '../core/save';
import { voice } from '../core/voice';

/**
 * The Ledger's QUESTIONS view (beside PATH) and the "previously" caption on Continue, in the choice layer's glass.
 * The board holds what he saw and what he asks, never a truth. Everything it says comes from the sealed data.
 */

type View = 'path' | 'q';
let view: View = 'path';

/** Thin line icons, one per kind of entry (24 px box, 1.2 px strokes). */
const ICONS: Record<string, string> = {
  spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  eye: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
  stack: '<circle cx="8" cy="17" r="2.4"/><circle cx="13" cy="17" r="2.4"/><circle cx="10.5" cy="12.8" r="2.4"/><circle cx="18" cy="17" r="2.4"/><circle cx="15.5" cy="12.8" r="2.4"/>',
  flake: '<path d="M5 18l4-12 9 4-3 9z"/><path d="M9 6l2 5"/>',
  light: '<circle cx="12" cy="9" r="2"/><path d="M3 20l6-7 3 3 4-5 5 9z"/>',
  wave: '<path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/>',
  scores: '<path d="M8 4v16M16 4v16"/><path d="M10 8l4 2M10 11l4 2M10 14l4 2"/>',
  rings: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="9"/>',
  pulse: '<path d="M2 12h5l2-5 3 10 2-5h8"/>',
  plate: '<rect x="4" y="6" width="16" height="12" rx="1"/><circle cx="7" cy="9" r=".6"/><circle cx="17" cy="9" r=".6"/><path d="M8 14h8"/>',
  knot: '<path d="M3 12h5c2 0 2-4 4-4s2 8 4 8 2-4 4-4h1"/>',
  hand: '<path d="M8 20v-8M8 12V5M11 12V4M14 12V5M17 13V8M8 20c0 0 9 1 9-6"/>',
  dream: '<path d="M16 4a8 8 0 1 0 4 12A7 7 0 0 1 16 4z"/>',
  sherd: '<path d="M4 16c3-5 13-5 16 0l-3 3H7z"/>',
  seed: '<path d="M12 21V8M12 8c-3 0-5-2-5-5 3 0 5 2 5 5zM12 12c3 0 5-2 5-5-3 0-5 2-5 5z"/>',
  line: '<path d="M2 15c5-3 9-3 20-1M2 19c5-3 9-3 20-1"/>',
  mark: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 12l2 2 4-4"/>',
  cloth: '<path d="M5 8h14v10H5zM5 12h14"/>',
  ring: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>',
  tuft: '<path d="M12 20c0-6-4-9-6-14M12 20c0-6 0-10 0-15M12 20c0-6 4-9 6-14"/>',
  tag: '<path d="M4 4h9l7 7-9 9-7-7z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
  bead: '<circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
  tally: '<path d="M5 5v14M9 5v14M13 5v14M17 5v14M3 15l17-7"/>',
};
const icon = (k: string) => `<svg class="my-ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] ?? ICONS.spark}</svg>`;

/** Draws the board into a ledger page (ui.openPath's menu page) with the PATH / QUESTIONS switch over both. */
export function attachBoard(s: SaveData, persist: () => void) {
  const page = document.querySelector<HTMLElement>('#modal-card .menu-page');
  if (!page || !MYSTERY || page.querySelector('.my-switch')) return;
  const b = board(s);
  const pathv = document.createElement('div'); pathv.className = 'my-pathv';
  while (page.firstChild) pathv.appendChild(page.firstChild);
  const sw = document.createElement('div'); sw.className = 'my-switch'; sw.setAttribute('role', 'tablist');
  sw.innerHTML = `<button data-v="path" role="tab">${escapeHtml(t('my.ui.path'))}</button><button data-v="q" role="tab">${escapeHtml(t('my.ui.questions'))}${b.fresh ? '<i class="my-dot"></i>' : ''}</button>`;
  const qv = document.createElement('div'); qv.className = 'my-board';
  page.append(sw, pathv, qv);
  const show = (v: View) => {
    view = v;
    sw.querySelectorAll<HTMLButtonElement>('button').forEach((x) => { x.classList.toggle('on', x.dataset.v === v); x.setAttribute('aria-selected', String(x.dataset.v === v)); });
    pathv.classList.toggle('hidden', v !== 'path'); qv.classList.toggle('hidden', v !== 'q');
    if (v === 'q') {
      renderBoard(qv, s);
      markSeen(s); persist(); dotTab(s);
      sw.querySelector('.my-dot')?.remove();
    }
  };
  sw.querySelectorAll<HTMLButtonElement>('button').forEach((x) => x.addEventListener('click', () => show(x.dataset.v as View)));
  show(view);
}

function renderBoard(el: HTMLElement, s: SaveData) {
  const b = board(s), d = MYSTERY!;
  const qs = b.questions.map((q) => `<li class="my-q ${q.fresh ? 'fresh' : ''}" tabindex="0" data-q="${q.id}">
      <span class="my-letter">${q.id}</span>
      <div class="my-qt">${escapeHtml(t(q.key))}</div>
      <div class="my-prog"><span style="--k:${q.total ? q.found / q.total : 0}"></span><small>${escapeHtml(t('my.ui.count', { n: q.found, m: q.total }))}</small></div>
      ${q.history.map((h) => `<div class="my-old ${h.answer ? 'done' : ''}"><s>${escapeHtml(t(h.key))}</s>${h.answer ? `<em>${escapeHtml(t(h.answer))}</em>` : `<em class="dim">${escapeHtml(t('my.ui.still'))}</em>`}</div>`).join('')}
    </li>`).join('');
  const found = b.clues.filter((x) => x.found);
  const tiles = found.map((x) => `<li class="my-c ${x.fresh ? 'fresh' : ''} ${x.c.dream ? 'dream' : ''}" tabindex="0" data-qs="${x.c.q.join('')}">
      ${icon(x.c.icon)}<div class="my-ct">${escapeHtml(t(x.c.title))}</div>
      <div class="my-cx">${escapeHtml(t(x.c.text))}</div>
      ${x.paid ? `<div class="my-pay"><b>${escapeHtml(t('my.ui.paid'))}</b> ${escapeHtml(t(x.c.pay!.key))}</div>` : ''}
      <div class="my-cf"><span>${escapeHtml(x.c.dream ? t('my.ui.dream') : t('my.ui.level', { n: x.c.level }))}</span>${x.c.q.map((l) => `<i class="my-chip">${l}</i>`).join('')}</div>
    </li>`).join('');
  const past = b.past.map((n) => `<li class="my-c past" aria-label="${escapeHtml(t('my.ui.past', { n }))}"><div class="my-cx">${escapeHtml(t('my.ui.past', { n }))}</div></li>`).join('');
  const foot = b.past.length ? t(d.footer.some, { n: b.past.length }) : found.length > 3 && d.finds.every((f) => s.flags[`find-${f.id}`]) ? t(d.footer.all) : t(d.footer.zero);
  el.innerHTML = `<div class="my-cols">
      <section class="my-left"><div class="eyebrow">${escapeHtml(t('my.ui.open'))}</div><ul class="my-qs">${qs || `<li class="my-none">${escapeHtml(t('my.ui.none'))}</li>`}</ul></section>
      <section class="my-right"><div class="eyebrow">${escapeHtml(t('my.ui.clues'))}</div><ul class="my-cs">${tiles}${past}</ul></section>
      <svg class="my-threads" aria-hidden="true"></svg>
    </div>
    <div class="my-foot"><span>${escapeHtml(t('mz.name'))}</span> ${escapeHtml(foot)}</div>`;
  // threads: a question draws hairlines to its clues and dims the rest; a clue lights its questions (tap pins)
  const cols = el.querySelector<HTMLElement>('.my-cols')!, svg = el.querySelector<SVGSVGElement>('.my-threads')!;
  let pinned: HTMLElement | null = null;
  const clear = () => { svg.innerHTML = ''; cols.classList.remove('threading'); el.querySelectorAll('.lit').forEach((x) => x.classList.remove('lit')); };
  const draw = (from: HTMLElement) => {
    clear();
    const box = cols.getBoundingClientRect(), qId = from.dataset.q, letters = from.dataset.qs;
    const qEls = qId ? [from] : Array.from(el.querySelectorAll<HTMLElement>('.my-q')).filter((x) => letters?.includes(x.dataset.q!));
    const cEls = qId ? Array.from(el.querySelectorAll<HTMLElement>('.my-c[data-qs]')).filter((x) => x.dataset.qs!.includes(qId)) : [from];
    if (!qEls.length || !cEls.length) return;
    cols.classList.add('threading');
    [...qEls, ...cEls].forEach((x) => x.classList.add('lit'));
    const stack = getComputedStyle(cols).flexDirection === 'column';
    let path = '';
    for (const q of qEls) for (const c of cEls) {
      const a = q.getBoundingClientRect(), z = c.getBoundingClientRect();
      const x1 = (stack ? a.left + 18 : a.right) - box.left, y1 = (stack ? a.bottom : a.top + a.height / 2) - box.top;
      const x2 = (stack ? z.left + 18 : z.left) - box.left, y2 = (stack ? z.top : z.top + z.height / 2) - box.top;
      const mx = (x1 + x2) / 2;
      path += stack ? `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}` : `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
    }
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    svg.innerHTML = `<path d="${path}"/>`;
  };
  el.querySelectorAll<HTMLElement>('.my-q, .my-c[data-qs]').forEach((x) => {
    x.addEventListener('mouseenter', () => { if (!pinned) draw(x); });
    x.addEventListener('mouseleave', () => { if (!pinned) clear(); });
    x.addEventListener('focus', () => { if (!pinned) draw(x); });
    x.addEventListener('blur', () => { if (!pinned) clear(); });
    x.addEventListener('click', () => { if (pinned === x) { pinned = null; clear(); } else { pinned = x; draw(x); } });
  });
}

/** The Ledger tab carries a soft dot while the board has something new. */
export function dotTab(s: SaveData | null) {
  const tab = document.getElementById('tab-ledger');
  if (!tab) return;
  tab.classList.toggle('my-new', !!s && !!MYSTERY && board(s).fresh > 0);
}

// ---------------------------------------------------------------- "previously"
let recapEl: HTMLElement | null = null;
/**
 * Three lines over the black before the world fades in, written one after another, MegaZroN's voice where a take
 * exists; then "Now: <objective>". Any key, click or tap skips. `done` runs once, at the end or on the skip.
 */
export function playRecap(s: SaveData, objective: string, done: () => void): boolean {
  const r = recapLines(s);
  if (!r) return false;
  recapEl?.remove();
  const el = recapEl = document.createElement('div');
  el.id = 'my-recap';
  const words = (k: string) => escapeHtml(t(k, { d: r.days }));
  el.innerHTML = `<div class="my-rc"><div class="eyebrow">${escapeHtml(t('my.ui.prev'))}</div>${r.lines.map((k, i) => `<p class="my-rl" style="--i:${i}">${words(k)}</p>`).join('')}<p class="my-now">${escapeHtml(t('my.ui.now', { o: objective }))}</p></div>`;
  document.body.appendChild(el);
  let finished = false, timer = 0;
  const lines = Array.from(el.querySelectorAll<HTMLElement>('.my-rl')), now = el.querySelector<HTMLElement>('.my-now')!;
  const end = () => {
    if (finished) return; finished = true;
    window.clearTimeout(timer); voice.stop();
    window.removeEventListener('keydown', key, true); el.removeEventListener('pointerdown', end);
    el.classList.add('out');
    window.setTimeout(() => { el.remove(); if (recapEl === el) recapEl = null; }, 450);
    done();
  };
  const key = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); end(); };
  window.addEventListener('keydown', key, true); el.addEventListener('pointerdown', end);
  const step = (i: number) => {
    if (finished) return;
    if (i >= lines.length) { now.classList.add('in'); timer = window.setTimeout(end, 2600); return; }
    lines[i].classList.add('in');
    const sec = voice.duration(r.lines[i]) !== null ? voice.play(r.lines[i]) ?? null : null;
    timer = window.setTimeout(() => step(i + 1), Math.max(3.2, (sec ?? 0) + 0.6, 1.2 + t(r.lines[i]).length * 0.045) * 1000);
  };
  timer = window.setTimeout(() => step(0), 500);
  return true;
}
export const recapShowing = () => !!recapEl;
