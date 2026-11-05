import { t, tDefault, getLang, setLang, Lang, onLangChange } from '../i18n';
import { CREW_IDS, CrewNames, NAME_MAX, normaliseNames } from '../core/crew';
import type { CineUI } from '../cinematic/cinematic';
import type { Settings } from '../core/save';
import type { QualityName } from '../core/quality';
import { audio } from '../core/audio';
import { voice } from '../core/voice';
import { portraits } from './portraits';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const LEVEL_COUNT = 10;
export const PLAYABLE_LEVELS = 10;
const CREW = CREW_IDS;

const ITEM_ICONS: Record<string, string> = {
  stone: '◆', branch: '⟋', fruit: '●', tinder: '❋', frond: '❦', flint: '◭', vine: '∿', scrap: '▰', spear: '↗', transmitter: '⌁',
};
/** Always-visible inventory slots; the rest appear once you hold some. */
const BASE_SLOTS = ['stone', 'branch'];
const EXTRA_SLOTS = ['tinder', 'frond', 'flint', 'vine', 'scrap'];

export interface Stats { health: number; thirst: number; hunger: number; stamina: number }

export class UI implements CineUI {
  private typeTimer = 0;
  private subTimer = 0;
  private lastSub: { key: string | null; speaker?: string } = { key: null };
  private lastCaption: string | null = null;
  private lastChapter: string[] | null = null;
  private lastAlert: string | null = null;
  private objectiveState: { level: number; progress: string | null } = { level: 1, progress: null };
  subtitlesOn = true;

  constructor() {
    onLangChange(() => this.refreshLang());
  }

  // ---------- generic ----------
  show(id: string, on: boolean) { $(id).classList.toggle('hidden', !on); }

  setLoading(p: number) { $('loader-fill').style.width = `${Math.round(p * 100)}%`; }

  fade(color: 'black' | 'white', to: number, seconds: number) {
    const f = $('fade');
    f.classList.toggle('white', color === 'white');
    f.style.transition = `opacity ${seconds}s ease`;
    requestAnimationFrame(() => (f.style.opacity = String(to)));
  }

  // ---------- cinematic ----------
  subtitle(key: string | null, speakerKey?: string, quiet = false) {
    this.lastSub = { key, speaker: speakerKey };
    const el = $('subtitle');
    clearTimeout(this.subTimer);
    if (key && !quiet) voice.play(key);
    if (!key || !this.subtitlesOn) { el.classList.add('hidden'); return; }
    (el.querySelector('.speaker') as HTMLElement).textContent = speakerKey ? t(speakerKey) : '';
    (el.querySelector('.line') as HTMLElement).textContent = t(key);
    el.classList.remove('hidden');
  }

  /** Subtitle that clears itself. */
  say(key: string, speakerKey: string | undefined, seconds = 4) {
    this.subtitle(key, speakerKey);
    const spoken = voice.duration(key);
    this.subTimer = window.setTimeout(() => this.subtitle(null), Math.max(seconds, (spoken ?? 0) + 0.4) * 1000);
  }

  caption(key: string | null) {
    this.lastCaption = key;
    const el = $('caption');
    if (!key) { el.classList.add('hidden'); return; }
    voice.play(key);
    el.textContent = t(key);
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  }

  chapter(keys: string[] | null) {
    this.lastChapter = keys;
    const el = $('chapter');
    if (!keys) { el.classList.add('hidden'); return; }
    el.innerHTML = '';
    keys.forEach((k, i) => {
      const d = document.createElement('div');
      d.className = i === 0 && keys.length > 1 ? 'c1' : 'c2';
      d.textContent = t(k);
      el.appendChild(d);
    });
    el.classList.remove('hidden');
  }

  mission(keys: string[] | null) {
    const el = $('mission');
    clearInterval(this.typeTimer);
    if (!keys) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const lines = keys.map((k) => t(k));
    let li = 0, ci = 0;
    const render = () => {
      el.innerHTML = '';
      for (let i = 0; i <= li && i < lines.length; i++) {
        const d = document.createElement('div');
        const txt = i < li ? lines[i] : lines[i].slice(0, ci);
        if (i === lines.length - 1 && i < li) d.className = 'ok';
        d.textContent = txt;
        if (i === li) { const c = document.createElement('span'); c.className = 'cursor'; d.appendChild(c); }
        el.appendChild(d);
      }
    };
    this.typeTimer = window.setInterval(() => {
      if (li >= lines.length) { clearInterval(this.typeTimer); render(); return; }
      ci += 2;
      if (ci >= lines[li].length) { li++; ci = 0; audio.beep(); }
      render();
    }, 28);
  }

  aiAlert(key: string | null) {
    this.lastAlert = key;
    const el = $('ai-alert');
    if (!key) { el.classList.add('hidden'); return; }
    voice.play(key);
    el.textContent = t(key);
    el.classList.remove('hidden');
  }

  device(keys: string[] | null) {
    const el = $('device');
    if (!keys) { el.classList.add('hidden'); return; }
    el.innerHTML = keys.map((k) => `<div>${escapeHtml(t(k))}</div>`).join('');
    el.classList.remove('hidden');
  }

  // ---------- HUD ----------
  setStats(s: Stats) {
    for (const k of ['health', 'thirst', 'hunger', 'stamina'] as const) {
      const row = document.querySelector(`.stat[data-stat="${k}"]`) as HTMLElement;
      (row.querySelector('i') as HTMLElement).style.width = `${Math.max(0, Math.min(100, s[k]))}%`;
      row.classList.toggle('low', s[k] < 20);
    }
  }

  setObjective(level: number, progress: string | null) {
    this.objectiveState = { level, progress };
    if (level > LEVEL_COUNT) {
      $('obj-level').textContent = t('wake.chapter');
      $('obj-title').textContent = t('level.arc.title');
      $('obj-desc').textContent = t('level.arc.desc');
      $('obj-progress').textContent = '';
      return;
    }
    $('obj-level').textContent = t('hud.level', { n: level });
    $('obj-title').textContent = t(`level.${level}.title`);
    $('obj-desc').textContent = level <= PLAYABLE_LEVELS ? t(`level.${level}.desc`) : t('level.locked');
    $('obj-progress').textContent = progress ?? '';
  }

  private lastInv: { inv: Record<string, number>; tools: string[] } = { inv: {}, tools: [] };
  setInventory(inv: Record<string, number>, tools: string[] = this.lastInv.tools) {
    this.lastInv = { inv, tools };
    const el = $('inventory');
    const keys = [...BASE_SLOTS, ...EXTRA_SLOTS.filter((k) => (inv[k] ?? 0) > 0)];
    const slot = (k: string, n: number | null) =>
      `<div class="slot ${n === 0 ? 'empty' : ''} ${n === null ? 'tool' : ''}" data-item="${k}">${n !== null ? `<span class="n">${n}</span>` : ''}<span class="ico">${ITEM_ICONS[k] ?? '?'}</span><span>${escapeHtml(t(`item.${k}`))}</span></div>`;
    el.innerHTML = keys.map((k) => slot(k, inv[k] ?? 0)).join('') + tools.map((k) => slot(k, null)).join('');
  }

  /** Wrist-device readout with raw (already translated) lines. */
  deviceLines(lines: string[] | null, small = false, alert = false) {
    const el = $('device');
    if (!lines) { el.classList.add('hidden'); return; }
    el.classList.toggle('small', small);
    el.classList.toggle('alert', alert);
    el.innerHTML = lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
    el.classList.remove('hidden');
  }

  setPrompt(text: string | null) {
    const el = $('prompt');
    document.body.classList.toggle('can-act', !!text);
    if (!text) { el.classList.add('hidden'); return; }
    (el.querySelector('span') as HTMLElement).textContent = text;
    el.classList.remove('hidden');
  }

  toast(text: string) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 5000);
    const all = $('toasts').children;
    if (all.length > 4) all[0].remove();
  }

  banner(title: string, sub: string) {
    const el = $('banner');
    (el.querySelector('.b-title') as HTMLElement).textContent = title;
    (el.querySelector('.b-sub') as HTMLElement).textContent = sub;
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    setTimeout(() => el.classList.add('hidden'), 4600);
  }

  memory(key: string | null, seconds = 9) {
    const el = $('memory');
    if (!key) { el.classList.add('hidden'); return; }
    voice.play(key);
    seconds = Math.max(seconds, (voice.duration(key) ?? 0) + 0.5);
    el.textContent = t(key);
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), seconds * 1000);
  }

  damage() {
    const el = $('damage');
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), 120);
  }

  setClock(day: number, hours: number) {
    const h = Math.floor(hours) % 24, m = Math.floor((hours % 1) * 60);
    $('clock').textContent = `${t('hud.day', { d: day })} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** yaw: camera heading in radians (0 = north/-Z). bearing: world bearing of objective. */
  setCompass(yaw: number, bearing: number | null, dist: number | null) {
    const strip = $('compass-strip');
    const width = strip.clientWidth || 400;
    const pxPerRad = width / (Math.PI * 0.9);
    const heading = -yaw;
    const parts: string[] = [];
    const labels: [number, string][] = [[0, t('compass.n')], [Math.PI / 2, t('compass.e')], [Math.PI, t('compass.s')], [-Math.PI / 2, t('compass.w')]];
    const rel = (a: number) => Math.atan2(Math.sin(a - heading), Math.cos(a - heading));
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = rel(a);
      if (Math.abs(r) < Math.PI * 0.5) parts.push(`<span class="tick" style="left:${width / 2 + r * pxPerRad}px"></span>`);
    }
    for (const [a, l] of labels) {
      const r = rel(a);
      if (Math.abs(r) < Math.PI * 0.5) parts.push(`<span style="left:${width / 2 + r * pxPerRad}px">${escapeHtml(l)}</span>`);
    }
    if (bearing !== null) {
      const r = rel(bearing);
      const clamped = Math.max(-Math.PI * 0.44, Math.min(Math.PI * 0.44, r));
      parts.push(`<span class="marker" style="left:${width / 2 + clamped * pxPerRad}px">◆</span>`);
    }
    strip.innerHTML = parts.join('');
    $('compass-dist').textContent = dist !== null ? t('hud.distance', { m: Math.round(dist) }) : '';
  }

  // ---------- modals ----------
  private openModal(html: string) {
    $('modal-card').innerHTML = html;
    $('modal').classList.remove('hidden');
  }
  closeModal() {
    $('modal').classList.add('hidden');
    // a focused (now hidden) name field would swallow game keys
    (document.activeElement as HTMLElement | null)?.blur?.();
  }
  modalOpen() { return !$('modal').classList.contains('hidden'); }

  openSettings(s: Settings, quality: QualityName, onChange: (s: Settings) => void, onQuality: (q: QualityName) => void, onClose: () => void, onTutorial?: () => void) {
    const seg = (name: string, opts: [string, string][], cur: string) =>
      `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'active' : ''}">${escapeHtml(l)}</button>`).join('')}</div>`;
    const onOff = (name: string, v: boolean) => seg(name, [['1', t('settings.on')], ['0', t('settings.off')]], v ? '1' : '0');
    this.openModal(`
      <h2>${escapeHtml(t('settings.title'))}</h2>
      <div class="row"><label>${escapeHtml(t('settings.quality'))}</label>${seg('quality', [['mobile', t('settings.qualityMobile')], ['web', t('settings.qualityWeb')], ['ultra', t('settings.qualityUltra')]], quality)}</div>
      <div class="note">${escapeHtml(t('settings.qualityNote'))}</div>
      <div class="row"><label>${escapeHtml(t('menu.language'))}</label>${seg('lang', [['en', 'English'], ['hi', 'हिन्दी'], ['ur', 'اردو']], s.lang)}</div>
      <div class="row"><label>${escapeHtml(t('settings.sensitivity'))}</label><input type="range" id="set-sens" min="0.3" max="2.5" step="0.1" value="${s.sensitivity}"></div>
      <div class="row"><label>${escapeHtml(t('settings.volume'))}</label><input type="range" id="set-vol" min="0" max="1" step="0.05" value="${s.volume}"></div>
      <div class="row"><label>${escapeHtml(t('settings.voice'))}</label><input type="range" id="set-voice" min="0" max="1" step="0.05" value="${s.voiceVolume}"></div>
      <div class="row"><label>${escapeHtml(t('settings.music'))}</label><input type="range" id="set-music" min="0" max="1" step="0.05" value="${s.musicVolume}"></div>
      <div class="row"><label>${escapeHtml(t('settings.sfx'))}</label><input type="range" id="set-sfx" min="0" max="1" step="0.05" value="${s.sfxVolume}"></div>
      <div class="row"><label>${escapeHtml(t('settings.mute'))}</label>${onOff('muted', s.muted)}</div>
      <div class="row"><label>${escapeHtml(t('settings.invertY'))}</label>${onOff('invertY', s.invertY)}</div>
      <div class="row"><label>${escapeHtml(t('settings.subtitles'))}</label>${onOff('subtitles', s.subtitles)}</div>
      <div class="row"><label>${escapeHtml(t('settings.fps'))}</label>${onOff('showFps', s.showFps)}</div>
      ${onTutorial ? `<div class="row"><label>${escapeHtml(t('settings.tutorial'))}</label><button class="btn small" id="set-tut">${escapeHtml(t('settings.tutorialReplay'))}</button></div>` : ''}
      <div class="actions"><button class="btn" id="m-close">${escapeHtml(t('menu.back'))}</button></div>`);
    const card = $('modal-card');
    if (onTutorial) $('set-tut').addEventListener('click', () => { audio.uiClick(); const b = $('set-tut'); b.textContent = t('settings.tutorialQueued'); (b as HTMLButtonElement).disabled = true; onTutorial(); });
    card.querySelectorAll<HTMLElement>('.seg').forEach((g) => {
      g.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
        audio.uiClick();
        const name = g.dataset.seg!, v = b.dataset.v!;
        if (name === 'quality') { if (v !== quality) onQuality(v as QualityName); return; }
        if (name === 'lang') { s.lang = v as Lang; setLang(s.lang); onChange(s); this.openSettings(s, quality, onChange, onQuality, onClose); return; }
        (s as unknown as Record<string, boolean>)[name] = v === '1';
        g.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        onChange(s);
      }));
    });
    ($('set-sens') as HTMLInputElement).addEventListener('input', (e) => { s.sensitivity = +(e.target as HTMLInputElement).value; onChange(s); });
    const slider = (id: string, f: (v: number) => void) => ($(id) as HTMLInputElement).addEventListener('input', (e) => { f(+(e.target as HTMLInputElement).value); onChange(s); });
    slider('set-vol', (v) => (s.volume = v));
    slider('set-voice', (v) => (s.voiceVolume = v));
    slider('set-music', (v) => (s.musicVolume = v));
    slider('set-sfx', (v) => (s.sfxVolume = v));
    $('m-close').addEventListener('click', () => { audio.uiClick(); this.closeModal(); onClose(); });
  }

  openPause(h: { resume: () => void; settings: () => void; objectives: () => void; crew: () => void; quit: () => void }) {
    this.openModal(`
      <h2>${escapeHtml(t('menu.paused'))}</h2>
      <div class="menu">
        <button class="btn primary" id="p-resume">${escapeHtml(t('menu.resume'))}</button>
        <button class="btn" id="p-obj">${escapeHtml(t('menu.objectives'))}</button>
        <button class="btn" id="p-crew">${escapeHtml(t('menu.crew'))}</button>
        <button class="btn" id="p-set">${escapeHtml(t('menu.settings'))}</button>
        <button class="btn" id="p-quit">${escapeHtml(t('menu.quitTitle'))}</button>
      </div>
      <h2 style="margin-top:24px">${escapeHtml(t('controls.title'))}</h2>
      <ul class="controls-list">${['move', 'sprint', 'jump', 'interact', 'look', 'zoom', 'objectives', 'crew', 'inventory', 'pause', 'touch'].map((k) => `<li>${escapeHtml(t(`controls.${k}`))}</li>`).join('')}</ul>`);
    const bind = (id: string, f: () => void) => $(id).addEventListener('click', () => { audio.uiClick(); f(); });
    bind('p-resume', h.resume); bind('p-obj', h.objectives); bind('p-crew', h.crew); bind('p-set', h.settings); bind('p-quit', h.quit);
  }

  /** Inventory panel: everything you carry, with a short description. */
  openInventory(inv: Record<string, number>, tools: string[], onClose: () => void) {
    const keys = [...BASE_SLOTS, ...EXTRA_SLOTS, 'fruit'].filter((k, i, a) => a.indexOf(k) === i && (BASE_SLOTS.includes(k) || (inv[k] ?? 0) > 0));
    const row = (k: string, n: number | null) => `<li class="${n === 0 ? 'empty' : ''}"><span class="ico">${ITEM_ICONS[k] ?? '?'}</span>
      <span class="iname">${escapeHtml(t(`item.${k}`))}${n !== null ? ` <b>×${n}</b>` : ` <b class="tool">${escapeHtml(t('inv.tool'))}</b>`}</span>
      <span class="idesc">${escapeHtml(t(`itemdesc.${k}`))}</span></li>`;
    const list = keys.map((k) => row(k, inv[k] ?? 0)).join('') + tools.map((k) => row(k, null)).join('');
    this.openModal(`<h2>${escapeHtml(t('inv.title'))}</h2><ul class="inv-list">${list}</ul>
      <div class="note">${escapeHtml(t('inv.note'))}</div>
      <div class="actions"><button class="btn" id="m-close">${escapeHtml(t('menu.close'))}</button></div>`);
    $('m-close').addEventListener('click', () => { audio.uiClick(); this.closeModal(); onClose(); });
  }

  openObjectives(current: number, completed: number[], onClose: () => void) {
    const items = Array.from({ length: LEVEL_COUNT }, (_, i) => {
      const n = i + 1;
      const done = completed.includes(n);
      const cls = done ? 'done' : n === current ? 'current' : n > PLAYABLE_LEVELS ? 'locked' : 'upcoming';
      const st = done ? t('level.done') : n === current && n <= PLAYABLE_LEVELS ? t('level.current') : n > PLAYABLE_LEVELS ? t('level.locked') : '';
      return `<li class="${cls}"><span class="num">${String(n).padStart(2, '0')}</span><span>${escapeHtml(t(`level.${n}.title`))}</span><span class="st">${escapeHtml(st)}</span></li>`;
    }).join('');
    const arc = current > LEVEL_COUNT ? `<div class="note arc">${escapeHtml(t('level.arc.title'))} — ${escapeHtml(t('level.arc.desc'))}</div>` : '';
    this.openModal(`<h2>${escapeHtml(t('objectives.title'))}</h2><ul class="levels">${items}</ul>${arc}
      <div class="actions"><button class="btn" id="m-close">${escapeHtml(t('menu.close'))}</button></div>`);
    $('m-close').addEventListener('click', () => { audio.uiClick(); this.closeModal(); onClose(); });
  }

  openCrew(status: (id: string) => { status: string; unlocked: boolean }, onClose: () => void, onRename?: () => void) {
    const cards = CREW.map((c, i) => {
      const st = i === 0 ? { status: t('crew.skills'), unlocked: true } : status(c);
      const found = i > 0 && st.unlocked;
      return `
      <div class="crew-card ${i === 0 ? 'you' : ''} ${found ? 'found' : ''}" data-crew="${c}">
        <img class="cp" alt="" data-portrait="${c}">
        <div class="cn">${escapeHtml(t(`crew.${c}.name`))}${i === 0 ? ` · ${escapeHtml(t('crew.you'))}` : ''}</div>
        <div class="cr">${escapeHtml(t(`crew.${c}.role`))}</div>
        <div class="cl">${escapeHtml(t(`crew.${c}.line`))}</div>
        <div class="cs">${escapeHtml(st.status)}</div>
        <div class="skills">${[1, 2, 3].map((k) => { const on = st.unlocked && k === 1; return `<span class="${on ? 'on' : ''}">${escapeHtml(t(`crew.${c}.s${k}`))}${on ? '' : ' · ' + escapeHtml(t('crew.locked'))}</span>`; }).join('')}</div>
      </div>`;
    }).join('');
    this.openModal(`<h2>${escapeHtml(t('crew.title'))}</h2><div class="crew-grid">${cards}</div>
      <div class="note">${escapeHtml(t('crew.note'))}</div>
      <div class="actions">${onRename ? `<button class="btn" id="m-rename">${escapeHtml(t('names.edit'))}</button>` : ''}<button class="btn" id="m-close">${escapeHtml(t('menu.close'))}</button></div>`);
    void portraits().then((p) => document.querySelectorAll<HTMLImageElement>('img[data-portrait]').forEach((im) => { const u = p[im.dataset.portrait!]; if (u) im.src = u; }));
    $('m-close').addEventListener('click', () => { audio.uiClick(); this.closeModal(); onClose(); });
    if (onRename) $('m-rename').addEventListener('click', () => { audio.uiClick(); onRename(); });
  }

  /**
   * Pre-game name screen (also reachable from the crew panel). Empty fields
   * keep the localised default name.
   */
  openNames(current: CrewNames, mode: 'new' | 'edit', onDone: (names: CrewNames) => void, onBack: () => void) {
    const rows = CREW.map((c, i) => `
      <div class="name-row ${i === 0 ? 'you' : ''}">
        <label for="nm-${c}"><span class="nr">${escapeHtml(t(`crew.${c}.role`))}</span>${i === 0 ? `<span class="ny">${escapeHtml(t('crew.you'))}</span>` : ''}</label>
        <input id="nm-${c}" data-crew="${c}" type="text" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false" dir="auto"
          placeholder="${escapeHtml(tDefault(`crew.${c}.name`))}" value="${escapeHtml(current[c] ?? '')}">
      </div>`).join('');
    this.openModal(`<h2>${escapeHtml(t('names.title'))}</h2>
      <p class="note">${escapeHtml(t('names.subtitle'))}</p>
      <div class="names">${rows}</div>
      <div class="actions">
        <button class="btn primary" id="nm-ok">${escapeHtml(t(mode === 'new' ? 'names.begin' : 'names.save'))}</button>
        <button class="btn" id="nm-reset">${escapeHtml(t('names.reset'))}</button>
        <button class="btn" id="nm-back">${escapeHtml(t('menu.back'))}</button>
      </div>`);
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('#modal-card .name-row input'));
    const collect = () => normaliseNames(Object.fromEntries(inputs.map((el) => [el.dataset.crew!, el.value])));
    const ok = () => { audio.uiClick(); const n = collect(); this.closeModal(); onDone(n); };
    inputs.forEach((el, i) => el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { if (i < inputs.length - 1) inputs[i + 1].focus(); else ok(); }
      if (e.key === 'Escape') { this.closeModal(); onBack(); }
    }));
    $('nm-ok').addEventListener('click', ok);
    $('nm-reset').addEventListener('click', () => { audio.uiClick(); inputs.forEach((el) => (el.value = '')); });
    $('nm-back').addEventListener('click', () => { audio.uiClick(); this.closeModal(); onBack(); });
    setTimeout(() => inputs[0]?.focus(), 30);
  }

  openConfirm(text: string, onYes: () => void, onNo: () => void) {
    this.openModal(`<p style="font-size:16px;line-height:1.6">${escapeHtml(text)}</p>
      <div class="actions"><button class="btn primary" id="c-yes">${escapeHtml(t('menu.newGame'))}</button><button class="btn" id="c-no">${escapeHtml(t('menu.back'))}</button></div>`);
    $('c-yes').addEventListener('click', () => { this.closeModal(); onYes(); });
    $('c-no').addEventListener('click', () => { this.closeModal(); onNo(); });
  }

  openDeath(onRetry: () => void) {
    this.openModal(`<h2 style="color:#ff6a5a">${escapeHtml(t('death.title'))}</h2><p style="line-height:1.6">${escapeHtml(t('death.text'))}</p>
      <div class="actions"><button class="btn primary" id="d-retry">${escapeHtml(t('death.retry'))}</button></div>`);
    $('d-retry').addEventListener('click', () => { this.closeModal(); onRetry(); });
  }

  setFps(text: string | null) {
    const el = $('fps');
    if (text === null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = text;
  }

  private refreshLang() {
    document.querySelectorAll<HTMLButtonElement>('.btn.lang').forEach((b) => b.classList.toggle('active', b.dataset.lang === getLang()));
    if (this.lastSub.key && !$('subtitle').classList.contains('hidden')) this.subtitle(this.lastSub.key, this.lastSub.speaker);
    if (this.lastCaption && !$('caption').classList.contains('hidden')) this.caption(this.lastCaption);
    if (this.lastChapter && !$('chapter').classList.contains('hidden')) this.chapter(this.lastChapter);
    if (this.lastAlert && !$('ai-alert').classList.contains('hidden')) this.aiAlert(this.lastAlert);
    this.setObjective(this.objectiveState.level, this.objectiveState.progress);
    this.setInventory(this.lastInv.inv, this.lastInv.tools);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
