import './cheat.css';
import type { SaveData } from '../core/save';
import type { Decision, Qte } from '../game/branch/types';
import { applyPreset, summary, type Picks, type Preset } from './presets';
import { unseal } from '../game/branch/sealed';

/**
 * The cheat menu: a test tool to start the game at any point without playing up to it (owner, 2026-11-27).
 *
 * Opened on the title screen or in the pause menu by a typed word (only its hash is here), a pad sequence (both
 * shoulder buttons held: up, down, left, right, Y), five taps in the top left corner of a touch screen, or the URL
 * (?cheat=menu). A jump is a page load with ?cheat=<point>: the game then starts through the code a player's start
 * goes through. A level point is a save written by an automated playthrough at that point (tools/cheat_snapshots.py,
 * sealed like the story data in snapshots.sealed), taken up by Continue; an opening point is a New Game started and
 * moved on the opening's own clock. Everything runs in its own save slot (core/save.ts 'cheat'): the real save is
 * never written, the path tree's record of branches seen is not added to, and a mark shows on screen.
 *
 * URL form (bots and capture plans; docs/dev/HANDOFF.md):
 *   ?cheat=menu | open.vault | open.city | open.lounge | open.pull | open.m<N> | open.run | open.film | L<level>[.<point>]
 *   &cpick=a|b|ask &cpicks=<id>:<option>,... &cinv=all &cgo=1 (start at once; else one click starts it, for the sound)
 *   &cnodmg=1 &cnodrain=1 &cfast=2 &ctod=21.5 &cwx=rain|fog|clear &cslow=0.5 &cfreecam=1 &chud=0 &cglov=1 &cctov=1
 *   (every toggle has its own c-prefixed name: ?tod= is the world's own, perf_gate.py sets it)
 * Level points are L<level>.start, .obj<N>, .scene<N>, .dec<N>, .fight<N>, .away<N>, .film<N>, .results.
 */

export interface CheatOpts {
  noDamage: boolean; noDrain: boolean; fast: number; tod: number | null; weather: 'clear' | 'rain' | 'fog' | null;
  slow: number; freeCam: boolean; hideHud: boolean; glitchOv: boolean; contOv: boolean;
}
export const opts: CheatOpts = { noDamage: false, noDrain: false, fast: 1, tod: null, weather: null, slow: 1, freeCam: false, hideHud: false, glitchOv: false, contOv: false };
export const optsActive = () => opts.noDamage || opts.noDrain || opts.fast !== 1 || opts.tod !== null || !!opts.weather || opts.slow !== 1 || opts.freeCam || opts.hideHud || opts.glitchOv || opts.contOv;

export interface Jump { target: string; preset: Preset; picks: Picks; inv: 'rec' | 'all'; go: boolean }
export interface Point { id: string; level: number; kind: string; n: number; save: number }
export interface Snapshots { v: 1; made?: string; saves: SaveData[]; points: Point[] }

export function parseUrl(q: URLSearchParams): { jump: Jump | null; menu: boolean } {
  const c = q.get('cheat');
  const num = (k: string, lo: number, hi: number) => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null; };
  if (q.get('cnodmg') === '1') opts.noDamage = true;
  if (q.get('cnodrain') === '1') opts.noDrain = true;
  opts.fast = num('cfast', 0.5, 4) ?? opts.fast;
  opts.tod = num('ctod', 0, 24) ?? opts.tod;
  const wx = q.get('cwx'); if (wx === 'clear' || wx === 'rain' || wx === 'fog') opts.weather = wx;
  opts.slow = num('cslow', 0.25, 2) ?? opts.slow;
  if (q.get('cfreecam') === '1') opts.freeCam = true;
  if (q.get('chud') === '0') opts.hideHud = true;
  if (q.get('cglov') === '1') opts.glitchOv = true;
  if (q.get('cctov') === '1') opts.contOv = true;
  if (!c) return { jump: null, menu: false };
  if (c === 'menu') return { jump: null, menu: true };
  const p = q.get('cpick'), picks: Picks = {};
  for (const kv of (q.get('cpicks') ?? '').split(',')) { const [k, v] = kv.split(':'); if (k && v) picks[k] = v; }
  return { jump: { target: c === 'city' ? 'open.city' : c, preset: p === 'b' || p === 'ask' ? p : 'a', picks, inv: q.get('cinv') === 'all' ? 'all' : 'rec', go: q.get('cgo') === '1' }, menu: false };
}

export function jumpUrl(j: Jump, o: CheatOpts = opts): string {
  const u = new URL(location.href);
  for (const k of ['cheat', 'cpick', 'cpicks', 'cinv', 'cgo', 'cnodmg', 'cnodrain', 'cfast', 'ctod', 'cwx', 'cslow', 'cfreecam', 'chud', 'cglov', 'cctov']) u.searchParams.delete(k);
  const s = u.searchParams;
  s.set('cheat', j.target);
  if (j.preset !== 'a') s.set('cpick', j.preset);
  const pk = Object.entries(j.picks).map(([k, v]) => `${k}:${v}`).join(','); if (pk) s.set('cpicks', pk);
  if (j.inv === 'all') s.set('cinv', 'all');
  if (j.go) s.set('cgo', '1');
  if (o.noDamage) s.set('cnodmg', '1');
  if (o.noDrain) s.set('cnodrain', '1');
  if (o.fast !== 1) s.set('cfast', String(o.fast));
  if (o.tod !== null) s.set('ctod', String(o.tod));
  if (o.weather) s.set('cwx', o.weather);
  if (o.slow !== 1) s.set('cslow', String(o.slow));
  if (o.freeCam) s.set('cfreecam', '1');
  if (o.hideHud) s.set('chud', '0');
  if (o.glitchOv) s.set('cglov', '1');
  if (o.contOv) s.set('cctov', '1');
  return u.toString();
}

let snaps: Promise<Snapshots> | null = null;
/** The checkpoints, unsealed on first use (the menu or a jump): not in the game's first download. */
export function loadSnapshots(): Promise<Snapshots> {
  return (snaps ??= import('./snapshots.sealed?raw').then((m) => unseal<Snapshots>(m.default)));
}

/** Everything the inventory can hold (every key any checkpoint has), twenty of each. */
export function everything(s: Snapshots, save: SaveData) {
  const keys = new Set<string>(Object.keys(save.inventory));
  for (const x of s.saves) for (const k of Object.keys(x.inventory)) keys.add(k);
  for (const k of keys) save.inventory[k] = Math.max(save.inventory[k] ?? 0, 20);
}

export interface CheatHost {
  where(): 'title' | 'pause' | 'none';
  /** The opening's points, in order: [target, label]. */
  openingPoints(): [string, string][];
  levelTitle(n: number): string;
  crew(): { id: string; name: string }[];
  decisions(): Record<string, Decision>;
  qtes(): Record<string, Qte>;
  /** The opening's moments, in the order they come. */
  openingIds(): string[];
  text(key: string): string;
  /** An option was changed in the menu (apply what shows at once: the HUD, the overlays). */
  changed(): void;
  /** The menu opened or closed (the game holds its input while it is open). */
  shown(on: boolean): void;
}

const CODE_HASH = '0aad8bb97c782c896848452534d92a1b7cb56f1b1a37bd82fd517575aaaf0f52';
const CODE_LEN = 7;
const LEVELS = 21;
const KIND_LABEL: Record<string, string> = { start: 'start', obj: 'objective', scene: 'scene', dec: 'decision', fight: 'fight', away: 'away stage', film: 'film', results: 'last step', hook: 'closing beat' };

async function sha(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class CheatMenu {
  private el: HTMLDivElement;
  private mark: HTMLDivElement;
  private ov: HTMLDivElement;
  private typed = '';
  private taps: number[] = [];
  private pad = { seq: [] as number[], was: new Set<number>() };
  open = false;
  private group = 'open';
  private target = 'open.lounge';
  private preset: Preset = 'a';
  private picks: Picks = {};
  private inv: 'rec' | 'all' = 'rec';
  private showText = false;
  private data: Snapshots | null = null;

  constructor(private host: CheatHost) {
    this.el = document.createElement('div'); this.el.id = 'cheat'; this.el.className = 'hidden';
    this.mark = document.createElement('div'); this.mark.id = 'cheat-mark'; this.mark.textContent = 'CHEAT'; this.mark.className = 'hidden';
    this.ov = document.createElement('div'); this.ov.id = 'cheat-ov'; this.ov.className = 'hidden';
    document.body.append(this.el, this.mark, this.ov);
    window.addEventListener('keydown', (e) => this.key(e), true);
    window.addEventListener('pointerdown', (e) => this.tap(e), true);
    const poll = () => { this.padPoll(); requestAnimationFrame(poll); };
    requestAnimationFrame(poll);
    this.el.addEventListener('click', (e) => this.click(e));
    this.el.addEventListener('change', (e) => this.change(e));
  }

  // ---- openers ----
  private key(e: KeyboardEvent) {
    if (this.open) { if (e.code === 'Escape') { e.stopPropagation(); e.preventDefault(); this.close(); } else if ((e.target as HTMLElement)?.tagName !== 'INPUT' && (e.target as HTMLElement)?.tagName !== 'SELECT') e.stopPropagation(); return; }
    if (this.host.where() === 'none' || e.key.length !== 1 || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    this.typed = (this.typed + e.key.toLowerCase()).slice(-CODE_LEN);
    if (this.typed.length === CODE_LEN && crypto.subtle) { const t = this.typed; void sha(t).then((h) => { if (h === CODE_HASH && this.typed === t) { this.typed = ''; this.show(); } }); }
  }
  private tap(e: PointerEvent) {
    if (this.open || e.pointerType !== 'touch' || this.host.where() === 'none') return;
    if (e.clientX > 64 || e.clientY > 64) { this.taps = []; return; }
    const now = performance.now();
    this.taps = this.taps.filter((t) => now - t < 3000); this.taps.push(now);
    if (this.taps.length >= 5) { this.taps = []; this.show(); }
  }
  /** Both shoulder buttons held, then up, down, left, right, Y (standard mapping). */
  private padPoll() {
    if (this.open || this.host.where() === 'none') return;
    const pads = navigator.getGamepads?.() ?? [];
    for (const g of pads) {
      if (!g || g.mapping !== 'standard') continue;
      const held = g.buttons[4]?.pressed && g.buttons[5]?.pressed;
      const now = new Set<number>(); g.buttons.forEach((b, i) => { if (b.pressed) now.add(i); });
      if (!held) { this.pad.seq = []; this.pad.was = now; return; }
      for (const i of [12, 13, 14, 15, 3]) if (now.has(i) && !this.pad.was.has(i)) this.pad.seq.push(i);
      this.pad.seq = this.pad.seq.slice(-5);
      this.pad.was = now;
      if (this.pad.seq.join() === '12,13,14,15,3') { this.pad.seq = []; this.show(); }
      return;
    }
  }

  // ---- the menu ----
  async show() {
    this.open = true; this.host.shown(true);
    this.el.className = ''; this.el.innerHTML = '<div class="ch-card"><p>Loading the checkpoints...</p></div>';
    try { this.data = await loadSnapshots(); } catch (e) { console.warn('cheat checkpoints did not load', e); this.data = { v: 1, saves: [], points: [] }; }
    if (this.open) this.render();
  }
  close() { this.open = false; this.el.className = 'hidden'; this.el.innerHTML = ''; this.host.shown(false); }

  /** Each level's checkpoints, then its closing beat (the Ledger's questions: L<n>.hook, from the next level's start). */
  private points(level: number) { const out = (this.data?.points ?? []).filter((p) => p.level === level); if (out.length) out.push({ id: `L${level}.hook`, level, kind: 'hook', n: 0, save: out[0].save }); return out; }
  private pointLabel(p: Point) { return p.kind === 'start' || p.kind === 'results' || p.kind === 'hook' ? KIND_LABEL[p.kind] : `${KIND_LABEL[p.kind] ?? p.kind} ${p.n}`; }

  /** The save the jump would start from, with the preset on it (for the summary). */
  private preview(): SaveData | null {
    const p = this.data?.points.find((x) => x.id === this.target);
    if (!p || !this.data) return null;
    const s = JSON.parse(JSON.stringify(this.data.saves[p.save])) as SaveData;
    applyPreset(s, this.preset, this.picks, this.host.decisions(), this.host.qtes(), this.host.openingIds());
    return s;
  }

  private render() {
    const h = this.host, o = opts;
    const groups = [['open', 'Opening'], ...Array.from({ length: LEVELS }, (_, i) => [`L${i + 1}`, `Level ${i + 1}: ${h.levelTitle(i + 1)}`])];
    const list: [string, string][] = this.group === 'open' ? h.openingPoints() : this.points(Number(this.group.slice(1))).map((p) => [p.id, this.pointLabel(p)]);
    if (!list.some(([id]) => id === this.target) && list.length) this.target = list[0][0];
    const pv = this.preview();
    const crew = h.crew();
    const sum = pv ? summary(pv.branch, crew.map((c) => c.id)).map((x) => `<span class="${x.alive ? '' : 'gone'}">${crew.find((c) => c.id === x.id)?.name ?? x.id} ${x.alive ? x.band : 'lost'}</span>`).join(' ') : '';
    // the moments the preset answers: the opening's, and the checkpoint's own log
    const ids = [...h.openingIds(), ...(pv?.branch.log.filter((l) => l.kind !== 'hidden').map((l) => l.id) ?? [])].filter((id, i, a) => a.indexOf(id) === i && (h.decisions()[id] || h.qtes()[id]));
    const pickRows = !this.pickOpen && !Object.keys(this.picks).length ? '' : ids.map((id, i) => {
      const d = h.decisions()[id], q = h.qtes()[id];
      const opts2: [string, string][] = q ? [['pass', 'pass'], ['fail', 'fail']] : d.options.filter((x) => x.tone !== 'silent').map((x, k) => [x.id, String.fromCharCode(97 + k) + (this.showText ? ` ${h.text(x.label)}` : '')]);
      const lv = h.openingIds().includes(id) ? undefined : pv?.branch.log.find((l) => l.id === id)?.level;
      return `<label class="ch-pick">${lv ? `L${lv}` : 'Opening'} ${q ? 'reflex' : 'choice'} ${i + 1} <select data-pick="${id}"><option value="">(preset)</option>${opts2.map(([v, l]) => `<option value="${v}"${this.picks[id] === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
    }).join('');
    const sel = (k: string, vals: [string, string][], cur: string) => `<select data-o="${k}">${vals.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const chk = (k: keyof CheatOpts, label: string) => `<label><input type="checkbox" data-o="${k}"${o[k] ? ' checked' : ''}> ${label}</label>`;
    this.el.innerHTML = `<div class="ch-card">
      <h2>Test jumps <small>cheat session: the real save is not touched</small></h2>
      <div class="ch-cols">
        <section><h3>Where</h3>
          <select data-g size="12">${groups.map(([v, l]) => `<option value="${v}"${v === this.group ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <div class="ch-list">${list.map(([id, l]) => `<button data-t="${id}" class="${id === this.target ? 'on' : ''}">${l}</button>`).join('') || '<p>No checkpoints recorded for this level.</p>'}</div>
        </section>
        <section><h3>Story choices</h3>
          <div class="ch-row">${(['a', 'b', 'ask'] as Preset[]).map((p) => `<button data-p="${p}" class="${p === this.preset ? 'on' : ''}">${p === 'a' ? 'all a' : p === 'b' ? 'all b' : 'as recorded / ask'}</button>`).join('')}<button data-pickopen class="${this.pickOpen ? 'on' : ''}">pick each</button></div>
          <label><input type="checkbox" data-showtext${this.showText ? ' checked' : ''}> show the choices' words (spoilers)</label>
          <div class="ch-picks">${pickRows}</div>
          <p class="ch-sum">${sum}</p>
          <h3>Inventory</h3>
          <div class="ch-row"><button data-inv="rec" class="${this.inv === 'rec' ? 'on' : ''}">what you would have</button><button data-inv="all" class="${this.inv === 'all' ? 'on' : ''}">everything</button></div>
        </section>
        <section><h3>Toggles</h3>
          ${chk('noDamage', 'no damage')}${chk('noDrain', 'no hunger or thirst drain')}
          <label>walk speed ${sel('fast', [['1', '1x'], ['1.5', '1.5x'], ['2', '2x'], ['3', '3x']], String(o.fast))}</label>
          <label>time of day ${sel('tod', [['', 'as saved'], ['6', '06:00'], ['9', '09:00'], ['12.5', '12:30'], ['17.4', '17:24'], ['19.5', '19:30'], ['21.5', '21:30'], ['1', '01:00']], o.tod === null ? '' : String(o.tod))}</label>
          <label>weather ${sel('weather', [['', 'as the story has it'], ['clear', 'clear'], ['rain', 'rain'], ['fog', 'fog']], o.weather ?? '')}</label>
          <label>speed ${sel('slow', [['0.25', '0.25x'], ['0.5', '0.5x'], ['0.75', '0.75x'], ['1', '1x'], ['1.5', '1.5x'], ['2', '2x']], String(o.slow))}</label>
          ${chk('freeCam', 'free camera (WASD, Q/E, drag; Shift fast)')}${chk('hideHud', 'hide the HUD')}${chk('glitchOv', 'glitch overlay')}${chk('contOv', 'continuity overlay')}
        </section>
      </div>
      <input class="ch-url" readonly value="${jumpUrl(this.jump())}">
      <div class="ch-row ch-go"><button data-go>Jump</button><button data-close>Close</button></div>
    </div>`;
  }
  private pickOpen = false;
  private jump(): Jump { return { target: this.target, preset: this.preset, picks: this.picks, inv: this.inv, go: false }; }

  private click(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.t) this.target = d.t;
    else if (d.p) { this.preset = d.p as Preset; this.picks = {}; this.pickOpen = false; }
    else if (d.pickopen !== undefined) this.pickOpen = !this.pickOpen;
    else if (d.inv) this.inv = d.inv as 'rec' | 'all';
    else if (d.go !== undefined) { location.href = jumpUrl(this.jump()); return; }
    else if (d.close !== undefined) { this.close(); return; }
    this.render();
  }
  private change(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.dataset.g !== undefined) { this.group = t.value; this.target = ''; }
    else if (t.dataset.pick) { if (t.value) this.picks[t.dataset.pick] = t.value; else delete this.picks[t.dataset.pick]; }
    else if (t.dataset.showtext !== undefined) this.showText = t.checked;
    else if (t.dataset.o) {
      const k = t.dataset.o as keyof CheatOpts, o = opts as unknown as Record<string, unknown>;
      if (t.getAttribute('type') === 'checkbox') o[k] = t.checked;
      else if (k === 'weather') o[k] = t.value || null;
      else if (k === 'tod') o[k] = t.value === '' ? null : Number(t.value);
      else o[k] = Number(t.value);
      this.host.changed();
    }
    this.render();
  }

  // ---- what shows during play ----
  setMark(on: boolean) { this.mark.className = on ? '' : 'hidden'; }
  overlay(lines: string[] | null) {
    if (!lines) { this.ov.className = 'hidden'; return; }
    this.ov.className = ''; this.ov.textContent = lines.join('\n');
  }
  /** One click to start a jump (it gives the page its sound); bots pass cgo=1. */
  ask(label: string, go: () => void) {
    const el = document.createElement('div'); el.id = 'cheat-go';
    el.innerHTML = `<button>Start the jump: ${label}</button>`;
    document.body.appendChild(el);
    el.querySelector('button')!.addEventListener('click', () => { el.remove(); go(); });
  }
}
