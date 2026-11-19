/**
 * Text that always fits. Every place the game writes words (subtitles, banners, buttons, objectives, the dialogue
 * box, title cards, the menus) is a slot here. When a slot's text changes, or the screen changes size, the slot
 * wraps first; if it still runs past its box, its lines or the screen edge, the type shrinks step by step down to
 * the slot's smallest size; if even that is too long, it is cut to its line count with an ellipsis, and a tap or
 * click opens it in full (the whole text is also its tooltip).
 *
 * `auditFit` is the test side: it puts every string of a language into every slot it can appear in and reports
 * the ones that still spill (tools/text_fit.py runs it at phone to 4K sizes in English, Hindi and Urdu).
 */
import { t, getLang } from '../i18n';
import en from '../i18n/en.json';

/** lines: most lines the slot may take; min: smallest font size in px; free: may sit part off screen (world-anchored). */
export type Slot = { sel: string; lines: number; min: number; free?: boolean; keys: RegExp };

const SPOKEN = /^(cine\.(line|ai|caption)\d|wake\.line|dlg\.\d|op\.|fb\.|mz\.(?!name)|npc\.[a-z]+\.(?!name$|role$)|city\.(done|friend|npc)\.|away\.[a-z]+\.intro$|away\.fell|br\.(?!.*\.(title|o\..*|lock\..*)$)(rad|res|acc|mz|fire|splint|tovik|pello|crew)|rad\.|after\.|ch2\.|teach\.|j\.|sk\.|warn\.|fail\.|medic\.|memory\.|beacon\.unknown\d|film\.scientist|safety\.joke)/;
const NAMES = /^(crew\.[a-z]+\.name|npc\.[a-z]+\.name|city\.who\.|mz\.name$|beacon\.voice$)/;
const CARD = /^(cine\.(year|chapter|approach|montage)|wake\.chapter|chapter2?\.|takeoff\.card|level\.\d+\.title|city\.title|film\.sub|br\.written)$|^(chapter2?\.|ch\.)/;

export const SLOTS: Slot[] = [
  { sel: '#subtitle .line', lines: 4, min: 13, keys: SPOKEN },
  { sel: '#subtitle .speaker', lines: 1, min: 12, keys: NAMES },
  { sel: '#caption', lines: 5, min: 13, keys: /^(cine\.(caption\d|montage|approach)|mz\.intro)/ },
  { sel: '#chapter .c1', lines: 2, min: 12, keys: /^(cine\.year|hud\.level|level\.complete|takeoff\.card|city\.title)$/ },
  { sel: '#chapter .c2', lines: 3, min: 18, keys: CARD },
  { sel: '#mission > div', lines: 2, min: 12, keys: /^(cine\.mission|wake\.device|signal\.|beacon\.\d|beacon\.(strong|medic|builder|social|unknown1))/ },
  { sel: '#ai-alert', lines: 3, min: 12, keys: /^cine\.ai\d$/ },
  { sel: '#device > div', lines: 2, min: 12, keys: /^(wake\.device|signal\.|beacon\.)/ },
  { sel: '#obj-title', lines: 2, min: 14, keys: /^(level\.\d+\.title|city\.task\.|away\.[a-z]+\.place|away\.(ring|scree|wreck|moon|clouds)\.(?!intro$)[a-z]+$)/ },
  { sel: '#obj-progress', lines: 2, min: 12, keys: /^(progress\.|hud\.level)/ },
  { sel: '#obj-desc', lines: 6, min: 11, keys: /^(level\.\d+\.(desc|hint)|level\.arc\.)/ },
  { sel: '#prompt .ptext', lines: 2, min: 13, free: true, keys: /^(prompt\.|action\.|act\.|city\.talk$|city\.task\.)/ },
  { sel: '.toast', lines: 4, min: 12, keys: /^(msg\.|away\.fav\.|br\.(tovik|pello)\.|mg\.failed$|item\.)/ },
  { sel: '#banner .b-title', lines: 2, min: 18, keys: /^(hud\.level|level\.complete|chapter2\.c1)$/ },
  { sel: '#banner .b-sub', lines: 2, min: 13, keys: /^(level\.\d+\.title|chapter2\.c2)$/ },
  { sel: '#memory', lines: 8, min: 12, keys: /^(memory\.|medic\.hint)/ },
  { sel: '#tutorial .tut-text', lines: 3, min: 13, keys: /^tut\./ },
  { sel: '#wheel .wname', lines: 2, min: 12, keys: /^item\./ },
  { sel: '#wheel .wdesc', lines: 4, min: 11, keys: /^itemdesc\./ },
  { sel: '#mg-name', lines: 2, min: 13, keys: /^tech\.[a-z]+\.name$|^tech\.[a-z]+$/ },
  { sel: '#mg-step', lines: 1, min: 11, keys: /^mg\.step$/ },
  { sel: '#mg-text', lines: 5, min: 12, keys: /^mg\.[a-z]+\.\d$/ },
  { sel: '#mg-state', lines: 2, min: 12, keys: /^mg\.(heat|rhythm|mix|tap)\.|^mg\.[a-z]+\.\d\.(lo|hi)$/ },
  { sel: '#mg-keys', lines: 3, min: 11, keys: /^mg\.keys\./ },
  { sel: '#craft .mgb', lines: 2, min: 12, keys: /^mg\.btn\./ },
  { sel: '#mg-stop', lines: 1, min: 11, keys: /^mg\.btn\.stop$/ },
  { sel: '#dlg-who', lines: 1, min: 12, keys: NAMES },
  { sel: '#dlg-line', lines: 7, min: 13, keys: SPOKEN },
  { sel: '#dlg-choices .btn', lines: 2, min: 13, keys: /^(br\.[a-z]+\.o\.|dlg\.(nothing|need)$|npc\.[a-z]+\.(ask|bye|trade|buy|sell|opt)|city\.talk$)/ },
  { sel: '#fc-name', lines: 2, min: 22, keys: /^crew\.[a-z]+\.name$/ },
  { sel: '#fc-role', lines: 2, min: 12, keys: /^(crew\.[a-z]+\.role|lin\.)/ },
  { sel: '#fc-loc', lines: 2, min: 11, keys: /^film\.loc\./ },
  { sel: '#ft-main', lines: 2, min: 22, keys: /^(title\.name|film\.sub)$/ },
  { sel: '#ft-sub', lines: 2, min: 11, keys: /^(film\.sub|title\.tagline|cine\.chapter)$/ },
  { sel: '#title .menu > .btn', lines: 2, min: 15, keys: /^(menu\.(continue|newGame|settings|download|quitDesktop)|br\.chapters)$/ },
  { sel: '#title .tagline', lines: 5, min: 12, keys: /^title\.tagline$/ },
  { sel: '#title .game-name', lines: 2, min: 20, keys: /^title\.name$/ },
  { sel: '#btn-skip > span:last-child', lines: 1, min: 12, keys: /^cine\.skip$/ },
  { sel: '#loading .loader-text', lines: 2, min: 12, keys: /^menu\.loading$/ },
  // menus: whatever the open menu holds
  { sel: '.modal-card .btn > span, .modal-card .btn:not(:has(> span))', lines: 2, min: 13, keys: /^(menu\.|settings\.|br\.(opening|replay|chapters)$)/ },
  { sel: '.modal-card .tab > span', lines: 1, min: 12, keys: /^tab\./ },
  { sel: '.modal-card h2, .modal-card .page-h, .modal-card .side-title', lines: 2, min: 15, keys: /^(settings\.title|objectives\.title|legal\.title|codex\.title|br\.path\.title|br\.chapters)$/ },
  { sel: '.modal-card .row > label', lines: 2, min: 12, keys: /^settings\.(?!.*Note$)/ },
  { sel: '.modal-card .seg button', lines: 1, min: 11, keys: /^settings\.(on|off|low|high|same)/ },
];

const ALL = SLOTS.map((s) => s.sel).join(', ');
const slotOf = (el: Element) => SLOTS.find((s) => el.matches(s.sel));

/** Is the element laid out at all? */
function shown(el: HTMLElement) { return el.isConnected && el.getClientRects().length > 0; }

function lineHeight(el: HTMLElement) {
  const cs = getComputedStyle(el), fs = parseFloat(cs.fontSize);
  const lh = parseFloat(cs.lineHeight);
  return Number.isFinite(lh) ? lh : fs * 1.25;
}

/** Why the text does not fit, or '' if it does. */
export function spill(el: HTMLElement, slot: Slot): string {
  if (!shown(el) || !el.textContent?.trim()) return '';
  const r = el.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  if (r.width <= 2 && r.height <= 2) return ''; // visually hidden text, there for screen readers
  const range = document.createRange(); range.selectNodeContents(el);
  const tr = range.getBoundingClientRect();
  if (!slot.free) {
    if (tr.left < -0.5 || tr.right > vw + 0.5) return 'off screen (x)';
    // inside a page that scrolls, below the fold is fine: it scrolls into view
    let scrolls = false;
    for (let p = el.parentElement; p && !scrolls; p = p.parentElement) { const oy = getComputedStyle(p).overflowY; scrolls = oy === 'auto' || oy === 'scroll'; }
    if (!scrolls && (tr.top < -0.5 || tr.bottom > vh + 0.5)) return 'off screen (y)';
  }
  if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) return 'wider than its box';
  if (tr.left < r.left - 1.5 || tr.right > r.right + 1.5) return 'past its box';
  const clip = el.classList.contains('fit-clip');
  if (!clip) {
    const lines = Math.round(tr.height / lineHeight(el));
    if (lines > slot.lines) return `${lines} lines (max ${slot.lines})`;
  } else if (el.scrollHeight > el.clientHeight + 2 && !el.classList.contains('fit-open')) return '';
  // a parent that clips (a card, a box with a set size) must hold it
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') {
      const pr = p.getBoundingClientRect();
      if (tr.right > pr.right + 1.5 || tr.left < pr.left - 1.5) return 'cut by its card';
      break;
    }
  }
  return '';
}

/** Fit one slot: wrap, then shrink, then cut with an ellipsis that opens on a tap. */
export function fitEl(el: HTMLElement, slot = slotOf(el)) {
  if (!slot) return;
  el.style.removeProperty('font-size');
  el.classList.remove('fit-clip', 'fit-shrunk');
  el.style.removeProperty('--fit-lines');
  if (el.dataset.fitTitle) { el.removeAttribute('title'); delete el.dataset.fitTitle; }
  if (!shown(el) || !spill(el, slot)) return;
  const base = parseFloat(getComputedStyle(el).fontSize);
  const lo0 = Math.min(base, Math.max(slot.min, base * 0.55));
  const at = (px: number) => { el.style.fontSize = `${px}px`; return !spill(el, slot); };
  if (at(lo0)) {
    // largest size that fits, to half a pixel
    let lo = lo0, hi = base;
    while (hi - lo > 0.5) { const m = (lo + hi) / 2; if (at(m)) lo = m; else hi = m; }
    at(lo);
    el.classList.add('fit-shrunk');
    return;
  }
  el.classList.add('fit-clip');
  el.style.setProperty('--fit-lines', String(slot.lines));
  if (!el.title) { el.title = el.textContent ?? ''; el.dataset.fitTitle = '1'; }
}

let pending = new Set<HTMLElement>();
let raf = 0;
let observer: MutationObserver | null = null;
/** Off: nothing is fitted (the test measures the game as it was with this). */
export const fitState = { on: true };

function flush() {
  raf = 0;
  if (!fitState.on) { pending.clear(); return; }
  const list = [...pending]; pending = new Set();
  for (const el of list) fitEl(el);
  observer?.takeRecords();
}
function queue(el: HTMLElement) { pending.add(el); if (!raf) raf = requestAnimationFrame(flush); }

function collect(n: Node) {
  const el = (n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement) as HTMLElement | null;
  if (!el) return;
  const own = el.closest(ALL) as HTMLElement | null;
  if (own) queue(own);
  el.querySelectorAll<HTMLElement>(ALL).forEach(queue);
}

export function refitAll() { document.querySelectorAll<HTMLElement>(ALL).forEach(queue); }

/** Start fitting every slot as its text changes, and again when the screen changes size or the fonts arrive. */
export function startFit() {
  if (observer) return;
  observer = new MutationObserver((recs) => { for (const r of recs) collect(r.target); });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'dir'] });
  window.addEventListener('resize', refitAll);
  void document.fonts?.ready.then(refitAll);
  document.fonts?.addEventListener?.('loadingdone', refitAll);
  // a cut line opens in full on a tap, and closes again on the next
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('.fit-clip') as HTMLElement | null;
    if (el && !el.closest('button')) el.classList.toggle('fit-open');
  }, true);
  refitAll();
}

// ---------------------------------------------------------------------------------------------- the audit
const LONG = { item: 'Hammerstone', name: 'Draxum Korrath-Vel', n: 22, k: 12, m: 1234, p: 100, d: 41, list: 'Flint ×2, Hammerstone ×1, Dry moss ×3', action: 'Assemble the beacon' };

function unhide(el: HTMLElement) {
  const undo: (() => void)[] = [];
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (n.classList.contains('hidden')) { const m = n; m.classList.remove('hidden'); undo.push(() => m.classList.add('hidden')); }
  }
  return () => undo.forEach((f) => f());
}

export type FitFailure = { slot: string; key: string; why: string; text: string };

/**
 * Put every string of the current language into every slot it can take and list what spills.
 * Slots that only exist inside an open menu are checked against what that menu holds right now.
 */
export function auditFit(opts: { fit?: boolean; menus?: boolean } = {}): { checked: number; clipped: number; failures: FitFailure[]; cut: FitFailure[] } {
  const fit = opts.fit ?? true;
  const keys = Object.keys(en as Record<string, string>).filter((k) => !k.startsWith('g.f.') && !k.startsWith('vo.') && !k.startsWith('_'));
  const failures: FitFailure[] = [], cut: FitFailure[] = [];
  let checked = 0, clipped = 0;
  document.body.classList.add('fit-audit');
  document.body.classList.toggle('fit-off', !fit);
  for (const slot of SLOTS) {
    const els = [...document.querySelectorAll<HTMLElement>(slot.sel)];
    if (!els.length) continue;
    const el = els[0];
    if (!!el.closest('.modal-card') !== !!opts.menus) continue;
    if (opts.menus) {
      // menus: the live strings in place
      for (const e of els) {
        if (!shown(e)) continue;
        checked++;
        if (fit) fitEl(e, slot);
        if (e.classList.contains('fit-clip')) { clipped++; cut.push({ slot: slot.sel, key: '(menu)', why: 'cut', text: e.textContent ?? '' }); }
        const why = spill(e, slot);
        if (why) failures.push({ slot: slot.sel, key: '(menu)', why, text: e.textContent ?? '' });
      }
      continue;
    }
    const restore = unhide(el);
    const saved = el.innerHTML, savedTitle = el.title;
    for (const k of keys) {
      if (!slot.keys.test(k)) continue;
      el.textContent = t(k, LONG);
      checked++;
      if (fit) fitEl(el, slot); else { el.style.removeProperty('font-size'); el.classList.remove('fit-clip'); }
      if (el.classList.contains('fit-clip')) { clipped++; cut.push({ slot: slot.sel, key: k, why: 'cut', text: el.textContent ?? '' }); }
      const why = spill(el, slot);
      if (why) failures.push({ slot: slot.sel, key: k, why, text: el.textContent ?? '' });
    }
    el.innerHTML = saved; el.title = savedTitle;
    el.style.removeProperty('font-size'); el.classList.remove('fit-clip', 'fit-shrunk');
    restore();
  }
  document.body.classList.remove('fit-audit', 'fit-off');
  observer?.takeRecords();
  void getLang;
  return { checked, clipped, failures, cut };
}
