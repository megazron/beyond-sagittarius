import { t, tIn, getLang, setLang, Lang, onLangChange, RTL } from '../i18n';
import { CREW_IDS } from '../core/crew';
import type { CrewSkins } from '../characters/custom';
import type { CineUI } from '../cinematic/cinematic';
import type { Settings } from '../core/save';
import type { QualityName } from '../core/quality';
import { audio } from '../core/audio';
import { voice } from '../core/voice';
import { portraits } from './portraits';
import { icon } from './icons';
import { glyph, glyphText } from './glyphs';
import { ITEM_ICON } from './wheel';
import { mapHtml } from './map';
import { remapHtml, bindRemap } from './remap';
import type { Input } from '../game/input';
import * as THREE from 'three';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const LEVEL_COUNT = 10;
export const PLAYABLE_LEVELS = 10;
const CREW = CREW_IDS;

export type MenuTab = 'pause' | 'map' | 'inventory' | 'objectives' | 'crew';
const TABS: [MenuTab, string, string][] = [['pause', 'pause', 'tab.game'], ['map', 'planet', 'tab.map'], ['inventory', 'inventory', 'tab.inventory'], ['objectives', 'objectives', 'tab.goals'], ['crew', 'crew', 'tab.crew']];
const ALL_ITEMS = ['stone', 'branch', 'tinder', 'frond', 'flint', 'vine', 'scrap', 'fruit'];

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
  /** Subtitle language; null follows the game language. */
  subLang: Lang | null = null;
  private subT(key: string) { return tIn(this.subLang ?? getLang(), key); }
  private subStyle(el: HTMLElement) {
    const l = this.subLang ?? getLang();
    el.dir = RTL[l] ? 'rtl' : 'ltr';
    el.classList.remove('sub-en', 'sub-hi', 'sub-ur');
    el.classList.add(`sub-${l}`);
  }

  /** Set by main: switches the full-screen menu to a tab. */
  onMenuTab: ((tab: MenuTab) => void) | null = null;
  onDamage: (() => void) | null = null;
  input: Input | null = null;
  private clockText = '';
  private seen: Record<string, number> = {};
  private flareTimer = 0;
  private needTimers: Record<string, number> = {};
  private staminaTimer = 0;
  private healthTimer = 0;
  private promptAnchor: THREE.Vector3 | null = null;
  private markPoint: THREE.Vector3 | null = null;
  private markDist: number | null = null;
  private v = new THREE.Vector3();

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
    (el.querySelector('.speaker') as HTMLElement).textContent = speakerKey ? this.subT(speakerKey) : '';
    (el.querySelector('.line') as HTMLElement).textContent = this.subT(key);
    this.subStyle(el);
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
    if (!this.subtitlesOn) { el.classList.add('hidden'); return; }
    el.textContent = this.subT(key);
    this.subStyle(el);
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
  /** Vitals stay out of sight until they change or run low. */
  setStats(s: Stats) {
    const health = document.querySelector('.vbar') as HTMLElement;
    (health.querySelector('i') as HTMLElement).style.width = `${Math.max(0, Math.min(100, s.health))}%`;
    const was = this.seen.health ?? s.health;
    if (Math.abs(was - s.health) > 0.4) {
      this.seen.health = s.health;
      health.classList.add('show');
      clearTimeout(this.healthTimer);
      this.healthTimer = window.setTimeout(() => { if ((this.seen.health ?? 100) >= 35) health.classList.remove('show'); }, 3500);
    }
    this.seen.health ??= s.health;
    if (s.health < 35) health.classList.add('show');
    health.classList.toggle('low', s.health < 20);
    for (const k of ['thirst', 'hunger'] as const) {
      const el = document.querySelector(`.need[data-stat="${k}"]`) as HTMLElement;
      const rose = s[k] > (this.seen[k] ?? s[k]) + 1;
      this.seen[k] = s[k];
      if (rose) { el.classList.add('show'); clearTimeout(this.needTimers[k]); this.needTimers[k] = window.setTimeout(() => el.classList.remove('show'), 2500); }
      el.classList.toggle('warn', s[k] < 30);
      el.classList.toggle('low', s[k] < 15);
    }
    const st = $('stamina');
    (st.querySelector('.s-fg') as SVGElement).style.strokeDashoffset = String(100 - Math.max(0, Math.min(100, s.stamina)));
    st.classList.toggle('low', s.stamina < 22);
    if (s.stamina < 99) { st.classList.add('show'); clearTimeout(this.staminaTimer); this.staminaTimer = window.setTimeout(() => st.classList.remove('show'), 900); }
  }

  /** One quiet line; the description shows for a few seconds when the goal changes. */
  private flare() {
    const q = $('objective');
    q.classList.add('flare');
    clearTimeout(this.flareTimer);
    this.flareTimer = window.setTimeout(() => q.classList.remove('flare'), 8000);
  }

  setObjective(level: number, progress: string | null) {
    const prev = this.objectiveState;
    this.objectiveState = { level, progress };
    if (prev.level !== level || prev.progress !== progress) this.flare();
    if (level > LEVEL_COUNT) {
      $('obj-title').textContent = t('level.arc.title');
      $('obj-desc').textContent = t('level.arc.desc');
      $('obj-progress').textContent = '';
      return;
    }
    $('obj-title').textContent = t(`level.${level}.title`);
    $('obj-desc').textContent = level <= PLAYABLE_LEVELS ? t(`level.${level}.desc`) : t('level.locked');
    $('obj-progress').textContent = progress ?? '';
  }

  private lastInv: { inv: Record<string, number>; tools: string[] } = { inv: {}, tools: [] };
  setInventory(inv: Record<string, number>, tools: string[] = this.lastInv.tools) { this.lastInv = { inv, tools }; }

  /** Wrist-device readout with raw (already translated) lines. */
  deviceLines(lines: string[] | null, small = false, alert = false) {
    const el = $('device');
    if (!lines) { el.classList.add('hidden'); return; }
    el.classList.toggle('small', small);
    el.classList.toggle('alert', alert);
    el.innerHTML = lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
    el.classList.remove('hidden');
  }

  /** Prompt that sits on the thing it is about. No anchor: low in the centre. */
  setPrompt(text: string | null, anchor: THREE.Vector3 | null = null) {
    const el = $('prompt');
    document.body.classList.toggle('can-act', !!text);
    this.promptAnchor = anchor;
    if (!text) { el.classList.add('hidden'); return; }
    (el.querySelector('.ptext') as HTMLElement).textContent = text;
    el.classList.remove('hidden');
  }

  /** The goal's point in the world, drawn by track(). */
  setMarker(point: THREE.Vector3 | null, dist: number | null) { this.markPoint = point; this.markDist = dist; }

  /** Every frame: pin the prompt and the goal marker to the world. */
  track(cam: THREE.Camera) {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = $('prompt');
    if (!pr.classList.contains('hidden')) {
      let x = w / 2, y = h * 0.66;
      if (this.promptAnchor) {
        const v = this.v.copy(this.promptAnchor).project(cam);
        if (v.z < 1 && Math.abs(v.x) < 1.2) { x = (v.x + 1) / 2 * w; y = (1 - v.y) / 2 * h; }
      }
      const half = pr.offsetWidth / 2;
      pr.style.transform = `translate(${Math.round(Math.max(half + 10, Math.min(w - half - 10, x)) - half)}px, ${Math.round(Math.max(70, Math.min(h - 130, y - pr.offsetHeight - 12)))}px)`;
    }
    const m = $('wmark');
    if (!this.markPoint) { m.classList.add('hidden'); return; }
    m.classList.remove('hidden');
    const v = this.v.copy(this.markPoint); v.y += 1.4; v.project(cam);
    const behind = v.z > 1;
    let nx = behind ? -v.x * 4 : v.x, ny = behind ? 0.8 : v.y;
    const edge = Math.max(Math.abs(nx) / 0.9, Math.abs(ny) / 0.8, 1);
    nx /= edge; ny /= edge;
    m.style.transform = `translate(${Math.round((nx + 1) / 2 * w)}px, ${Math.round((1 - ny) / 2 * h)}px)`;
    const near = !behind && edge === 1 && Math.abs(nx) < 0.22;
    m.classList.toggle('edge', edge > 1);
    m.classList.toggle('read', near || $('objective').classList.contains('flare'));
    $('wmark-dist').textContent = this.markDist !== null ? t('hud.distance', { m: Math.round(this.markDist) }) : '';
  }

  /** Light contextual hint, low on the screen. */
  hint(text: string | null) {
    const el = $('tutorial');
    if (!text) { el.classList.add('hidden'); return; }
    (el.querySelector('.tut-text') as HTMLElement).innerHTML = glyphText(text);
    el.classList.remove('hidden');
  }

  toast(text: string) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.innerHTML = glyphText(text);
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 5000);
    const all = $('toasts').children;
    if (all.length > 3) all[0].remove();
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
    this.onDamage?.();
  }

  setClock(day: number, hours: number) {
    const h = Math.floor(hours) % 24, m = Math.floor((hours % 1) * 60);
    this.clockText = `${t('hud.day', { d: day })} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // ---------- modals ----------
  private leaveTimer = 0;
  private openModal(html: string) {
    const m = $('modal');
    clearTimeout(this.leaveTimer);
    if (m.classList.contains('hidden') || m.classList.contains('leaving')) audio.uiOpen();
    m.classList.remove('leaving');
    $('modal-card').innerHTML = html;
    $('modal-card').scrollTop = 0;
    m.classList.remove('hidden');
    document.body.classList.add('in-menu');
    document.querySelectorAll<HTMLElement>('#modal-card [data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon!); });
  }
  closeModal() {
    const m = $('modal');
    document.body.classList.remove('in-menu');
    if (!m.classList.contains('hidden') && !m.classList.contains('leaving')) {
      audio.uiClose();
      m.classList.add('leaving');
      clearTimeout(this.leaveTimer);
      this.leaveTimer = window.setTimeout(() => { m.classList.add('hidden'); m.classList.remove('leaving'); }, 130);
    }
    // a focused (now hidden) name field would swallow game keys
    (document.activeElement as HTMLElement | null)?.blur?.();
  }
  /** Full-screen menu shell: tab strip, page, button hints. */
  private menuPage(tab: MenuTab, body: string, back = 'menu.close') {
    this.openModal(`<header class="menu-top"><span class="tabhint">${glyph('tabs')}</span>
      <nav class="tabs main-tabs">${TABS.map(([id, ic, label]) => `<button id="tab-${id}" class="tab ${id === tab ? 'active' : ''}" data-tab="${id}">${icon(ic)}<span>${escapeHtml(t(label))}</span></button>`).join('')}</nav>
      <span class="menu-clock">${escapeHtml(this.clockText)}</span></header>
      <div class="menu-page">${body}</div>${this.foot(back)}`);
    document.querySelectorAll<HTMLElement>('.main-tabs .tab').forEach((b) => b.addEventListener('click', () => { if (b.dataset.tab !== tab) { audio.uiTab(); this.onMenuTab?.(b.dataset.tab as MenuTab); } }));
  }
  private foot(back: string) {
    return `<footer class="menu-foot"><span class="hintline">${glyph('confirm')}<span>${escapeHtml(t('menu.select'))}</span></span><button class="foot-btn" id="m-close">${glyph('cancel')}<span>${escapeHtml(t(back))}</span></button></footer>`;
  }
  /** LB/RB, Q/E style: the next tab in whichever strip is showing. */
  cycleTab(dir: number) {
    const strip = document.querySelector('#modal-card .sub-tabs') ?? document.querySelector('#modal-card .main-tabs');
    if (!strip) return;
    const tabs = Array.from(strip.querySelectorAll<HTMLElement>('.tab'));
    const i = tabs.findIndex((x) => x.classList.contains('active'));
    tabs[(i + dir + tabs.length) % tabs.length]?.click();
  }
  modalOpen() { return !$('modal').classList.contains('hidden'); }

  openSettings(s: Settings, quality: QualityName, onChange: (s: Settings) => void, onQuality: (q: QualityName) => void, onClose: () => void, onTutorial?: () => void, onSkins?: () => void, onLegal?: () => void) {
    const seg = (name: string, opts: [string, string][], cur: string) =>
      `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'active' : ''}">${escapeHtml(l)}</button>`).join('')}</div>`;
    const onOff = (name: string, v: boolean) => seg(name, [['1', t('settings.on')], ['0', t('settings.off')]], v ? '1' : '0');
    const row = (label: string, body: string) => `<div class="row"><label>${escapeHtml(t(label))}</label>${body}</div>`;
    const range = (id: string, label: string, min: number, max: number, step: number, v: number) => row(label, `<input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}">`);
    const LANGS: [string, string][] = [['en', 'English'], ['hi', 'हिन्दी'], ['ur', 'اردو']];
    const panes: [string, string, string][] = [
      ['sound', 'settings.tabSound', `
        ${row('menu.language', seg('lang', LANGS, s.lang))}
        ${row('settings.subLang', seg('subLang', [['same', t('settings.same')], ...LANGS, ['off', t('settings.off')]], s.subLang))}
        ${row('settings.voiceLang', seg('voiceLang', [['same', t('settings.same')], ...LANGS], s.voiceLang))}
        ${range('set-vol', 'settings.volume', 0, 1, 0.05, s.volume)}${range('set-voice', 'settings.voice', 0, 1, 0.05, s.voiceVolume)}
        ${range('set-music', 'settings.music', 0, 1, 0.05, s.musicVolume)}${range('set-sfx', 'settings.sfx', 0, 1, 0.05, s.sfxVolume)}
        ${row('settings.mute', onOff('muted', s.muted))}`],
      ['display', 'settings.tabDisplay', `
        ${row('settings.quality', seg('quality', [['mobile', t('settings.qualityMobile')], ['web', t('settings.qualityWeb')], ['ultra', t('settings.qualityUltra')]], quality))}
        <div class="note">${escapeHtml(t('settings.qualityNote'))}</div>
        ${row('settings.fps', onOff('showFps', s.showFps))}`],
      ['controls', 'settings.tabControls', `
        ${range('set-sens', 'settings.sensitivity', 0.3, 2.5, 0.1, s.sensitivity)}
        ${row('settings.invertY', onOff('invertY', s.invertY))}
        ${row('settings.vibration', onOff('vibration', s.vibration !== false))}
        ${this.input ? remapHtml(this.input) : ''}`],
      ['system', 'settings.tabSystem', `
        ${onTutorial ? row('settings.tutorial', `<button class="btn small" id="set-tut">${escapeHtml(t('settings.tutorialReplay'))}</button>`) : ''}
        ${onSkins ? row('menu.skins', `<button class="btn small" id="set-skins">${escapeHtml(t('menu.skins'))}</button>`) : ''}
        ${onLegal ? row('legal.title', `<button class="btn small" id="set-legal">${escapeHtml(t('legal.title'))}</button>`) : ''}`],
    ];
    this.openModal(`<header class="menu-top"><span class="tabhint">${glyph('tabs')}</span><h2>${escapeHtml(t('settings.title'))}</h2>
        <nav class="tabs sub-tabs">${panes.map(([id, label], i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-pane="${id}"><span>${escapeHtml(t(label))}</span></button>`).join('')}</nav></header>
      <div class="menu-page">${panes.map(([id, , body], i) => `<section class="pane ${i === 0 ? '' : 'hidden'}" data-pane="${id}">${body}</section>`).join('')}</div>${this.foot('menu.back')}`);
    document.querySelectorAll<HTMLElement>('.sub-tabs .tab').forEach((b) => b.addEventListener('click', () => {
      audio.uiTab();
      document.querySelectorAll('.sub-tabs .tab').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll<HTMLElement>('.pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.pane));
      $('modal-card').scrollTop = 0;
    }));
    if (this.input) bindRemap(this.input, s, onChange);
    if (onLegal) $('set-legal').addEventListener('click', () => onLegal());
    if (onSkins) $('set-skins').addEventListener('click', () => onSkins());
    if (onTutorial) $('set-tut').addEventListener('click', () => { audio.uiClick(); const b = $('set-tut'); b.textContent = t('settings.tutorialQueued'); (b as HTMLButtonElement).disabled = true; onTutorial(); });
    const card = $('modal-card');
    card.querySelectorAll<HTMLElement>('.seg[data-seg]').forEach((g) => {
      g.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
        audio.uiClick();
        const name = g.dataset.seg!, v = b.dataset.v!;
        if (name === 'quality') { if (v !== quality) onQuality(v as QualityName); return; }
        if (name === 'subLang' || name === 'voiceLang') {
          (s as unknown as Record<string, string>)[name] = v;
          g.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
          onChange(s);
          return;
        }
        if (name === 'lang') { s.lang = v as Lang; setLang(s.lang); onChange(s); this.openSettings(s, quality, onChange, onQuality, onClose, onTutorial, onSkins, onLegal); return; }
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
    $('m-close').addEventListener('click', () => { this.closeModal(); onClose(); });
  }

  openPause(h: { resume: () => void; settings: () => void; look: () => void; skins: () => void; quit: () => void }) {
    const row = (id: string, ic: string, label: string, cls = '') => `<button class="btn ${cls}" id="${id}">${icon(ic)}<span>${escapeHtml(t(label))}</span></button>`;
    const { level, progress } = this.objectiveState;
    this.menuPage('pause', `<div class="pause">
      <div class="menu">${row('p-resume', 'play', 'menu.resume', 'primary')}${row('p-set', 'settings', 'menu.settings')}${row('p-look', 'look', 'menu.changeLook')}${row('p-skins', 'skins', 'menu.skins')}${row('p-quit', 'quit', 'menu.quitTitle')}</div>
      <aside class="pause-side"><div class="eyebrow">${escapeHtml(t('hud.objective'))}</div>
        <div class="side-title">${escapeHtml($('obj-title').textContent ?? '')}</div>
        <p>${escapeHtml($('obj-desc').textContent ?? '')}</p>${progress ? `<p class="accent">${escapeHtml(progress)}</p>` : ''}${level > LEVEL_COUNT ? '' : `<div class="eyebrow dim">${escapeHtml(t('hud.level', { n: level }))}</div>`}</aside></div>`, 'menu.resume');
    const bind = (id: string, f: () => void) => $(id).addEventListener('click', f);
    bind('p-look', h.look); bind('p-skins', h.skins); bind('p-resume', h.resume); bind('p-set', h.settings); bind('p-quit', h.quit);
    bind('m-close', h.resume);
  }

  /** The Map tab; main draws into it once the layout exists. */
  openMap(onClose: () => void) {
    this.menuPage('map', mapHtml());
    $('m-close').addEventListener('click', () => { this.closeModal(); onClose(); });
  }

  /** Inventory tab: everything you carry, with a short description. */
  openInventory(inv: Record<string, number>, tools: string[], onClose: () => void) {
    const keys = ALL_ITEMS.filter((k) => (inv[k] ?? 0) > 0);
    const row = (k: string, n: number | null) => `<li>${icon(ITEM_ICON[k] ?? 'marker')}
      <span class="iname">${escapeHtml(t(`item.${k}`))}${n !== null ? ` <b>${n}</b>` : ` <b class="tool">${escapeHtml(t('inv.tool'))}</b>`}</span>
      <span class="idesc">${escapeHtml(t(`itemdesc.${k}`))}</span></li>`;
    const list = keys.map((k) => row(k, inv[k] ?? 0)).join('') + tools.map((k) => row(k, null)).join('');
    this.menuPage('inventory', `<ul class="inv-list">${list || `<li class="empty"><span class="iname">${escapeHtml(t('wheel.empty'))}</span></li>`}</ul>
      <div class="note">${escapeHtml(t('inv.note'))}</div>`);
    $('m-close').addEventListener('click', () => { this.closeModal(); onClose(); });
  }

  openObjectives(current: number, completed: number[], onClose: () => void) {
    const items = Array.from({ length: LEVEL_COUNT }, (_, i) => {
      const n = i + 1;
      const done = completed.includes(n);
      const cls = done ? 'done' : n === current ? 'current' : n > PLAYABLE_LEVELS ? 'locked' : 'upcoming';
      const st = done ? t('level.done') : n === current && n <= PLAYABLE_LEVELS ? t('level.current') : n > PLAYABLE_LEVELS ? t('level.locked') : '';
      return `<li class="${cls}"><span class="num">${done ? icon('check') : String(n).padStart(2, '0')}</span><span>${escapeHtml(t(`level.${n}.title`))}</span><span class="st">${escapeHtml(st)}</span></li>`;
    }).join('');
    const arc = current > LEVEL_COUNT ? `<div class="note arc">${escapeHtml(t('level.arc.title'))}: ${escapeHtml(t('level.arc.desc'))}</div>` : '';
    this.menuPage('objectives', `<h3 class="page-h">${escapeHtml(t('objectives.title'))}</h3><ul class="levels">${items}</ul>${arc}`);
    $('m-close').addEventListener('click', () => { this.closeModal(); onClose(); });
  }

  openCrew(status: (id: string) => { status: string; unlocked: boolean }, onClose: () => void, onRename?: () => void) {
    const cards = CREW.map((c, i) => {
      const st = i === 0 ? { status: t('crew.skills'), unlocked: true } : status(c);
      const found = i > 0 && st.unlocked;
      return `
      <div class="crew-card ${i === 0 ? 'you' : ''} ${found ? 'found' : ''}" data-crew="${c}">
        <img class="cp" alt="" data-portrait="${c}">
        <div class="cbody"><div class="cn">${icon(c)}${escapeHtml(t(`crew.${c}.name`))}${i === 0 ? ` · ${escapeHtml(t('crew.you'))}` : ''}</div>
        <div class="cr">${escapeHtml(t(`crew.${c}.role`))}</div>
        <div class="cl">${escapeHtml(t(`crew.${c}.line`))}</div>
        <div class="cs">${escapeHtml(st.status)}</div>
        <div class="skills">${[1, 2, 3].map((k) => { const on = st.unlocked && k === 1; return `<span class="${on ? 'on' : ''}">${on ? '' : icon('lock')}${escapeHtml(t(`crew.${c}.s${k}`))}</span>`; }).join('')}</div></div>
      </div>`;
    }).join('');
    this.menuPage('crew', `<div class="crew-grid">${cards}</div><div class="note">${escapeHtml(t('crew.note'))}</div>`);
    void portraits().then((p) => document.querySelectorAll<HTMLImageElement>('img[data-portrait]').forEach((im) => { const u = p[im.dataset.portrait!]; if (u) im.src = u; }));
    $('m-close').addEventListener('click', () => { this.closeModal(); onClose(); });
    void onRename;
  }

  /** Terms, privacy, safety, parody note and licences. */
  openLegal(onClose: () => void) {
    const sec = (k: string) => `<h3>${escapeHtml(t(`legal.${k}H`))}</h3><p>${escapeHtml(t(`legal.${k}`))}</p>`;
    this.openModal(`<h2>${escapeHtml(t('legal.title'))}</h2><div class="legal">
      <p class="note">${escapeHtml(t('legal.template'))}</p>
      ${['terms', 'privacy', 'safety', 'parody', 'licences'].map(sec).join('')}
      <p><a href="https://github.com/megazron/beyond-sagittarius#readme" target="_blank" rel="noopener">${escapeHtml(t('legal.readFull'))}</a></p></div>
      ${this.foot('menu.back')}`);
    $('m-close').addEventListener('click', () => { this.closeModal(); onClose(); });
  }

  /** Plain modal shell for other UI modules. */
  openRaw(html: string) { this.openModal(html); }

  /** Skins menu with the code field. Locked skins are not listed at all. */
  openSkins(current: CrewSkins, unlocked: string[], onPick: (s: CrewSkins) => void, onCode: (code: string) => Promise<boolean>, onClose: () => void) {
    const opts: [string, string][] = [['default', t('skins.strong.default')]];
    if (unlocked.includes('strong.suit')) opts.push(['suit', t('skins.strong.suit')]);
    const cur = current.strong ?? 'default';
    this.openModal(`<h2>${escapeHtml(t('skins.title'))}</h2>
      <div class="row"><label>${escapeHtml(t('crew.strong.name'))}</label>
        <div class="seg" id="skin-strong">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'active' : ''}">${escapeHtml(l)}</button>`).join('')}</div></div>
      <div class="note">${escapeHtml(t('skins.note'))}</div>
      <div class="row"><label for="skin-code">${escapeHtml(t('skins.code'))}</label>
        <div class="code-row"><input id="skin-code" type="text" maxlength="24" autocomplete="off" spellcheck="false"><button class="btn small" id="skin-try">${escapeHtml(t('skins.try'))}</button></div></div>
      <div class="note" id="skin-msg"></div>
      ${this.foot('menu.back')}`);
    document.querySelectorAll<HTMLButtonElement>('#skin-strong button').forEach((b) => b.addEventListener('click', () => {
      onPick({ ...current, strong: b.dataset.v as 'default' | 'suit' });
      document.querySelectorAll('#skin-strong button').forEach((x) => x.classList.toggle('active', x === b));
    }));
    const input = $('skin-code') as HTMLInputElement;
    const go = async () => {
      if (await onCode(input.value)) { audio.chime(); this.openSkins(current, [...unlocked, 'strong.suit'], onPick, onCode, onClose); $('skin-msg').textContent = t('skins.ok'); }
      else { audio.uiDenied(); $('skin-msg').textContent = t('skins.wrong'); input.value = ''; }
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') void go(); });
    $('skin-try').addEventListener('click', () => void go());
    $('m-close').addEventListener('click', () => { this.closeModal(); onClose(); });
  }

  openConfirm(text: string, onYes: () => void, onNo: () => void) {
    this.openModal(`<div class="center-msg"><p>${escapeHtml(text)}</p>
      <div class="actions"><button class="btn primary" id="c-yes">${escapeHtml(t('menu.newGame'))}</button><button class="btn" id="c-no">${escapeHtml(t('menu.back'))}</button></div></div>`);
    $('c-yes').addEventListener('click', () => { this.closeModal(); onYes(); });
    $('c-no').addEventListener('click', () => { this.closeModal(); onNo(); });
  }

  openDeath(onRetry: () => void) {
    this.openModal(`<div class="center-msg death"><h2>${escapeHtml(t('death.title'))}</h2><p>${escapeHtml(t('death.text'))}</p>
      <div class="actions"><button class="btn primary" id="d-retry">${escapeHtml(t('death.retry'))}</button></div></div>`);
    $('d-retry').addEventListener('click', () => { this.closeModal(); onRetry(); });
  }

  setFps(text: string | null) {
    const el = $('fps');
    if (text === null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = text;
  }

  private refreshLang() {
    if (!$('hud')) return;
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
