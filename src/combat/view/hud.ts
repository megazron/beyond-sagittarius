// The fight's HUD: reticle and draw ring, what is in the hand, the awareness eye, arrows for attacks coming from
// off screen, a boss bar, injuries, and the touch buttons. All of it is made here and lives in its own layer.
import './combat.css';

export const ICON: Record<string, string> = {
  atk: '<path d="M5 19 19 5M15 5h4v4M5 19l3-1-2-2z"/>',
  aim: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  dge: '<path d="M4 14c2-6 8-8 13-5M17 5v4h-4M6 19h9"/>',
  blk: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/>',
  alt: '<path d="M4 20 20 4M20 4l-5 1M20 4l-1 5M7 13l4 4"/>',
  wpn: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  snk: '<path d="M4 18c2-5 5-7 8-7s4 2 8 2M9 7a2 2 0 1 0 0 .1"/>',
  trp: '<path d="M4 18h16M6 18l2-8M12 18V8M18 18l-2-8M8 10h8"/>',
};
const el = (tag: string, cls: string, html = '') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };
const RING = 2 * Math.PI * 20;

export interface TouchState { attackHeld: boolean; attackHit: boolean; aim: boolean; dodgeHit: boolean; blockHeld: boolean; altHeld: boolean; altHit: boolean; weaponHit: boolean; sneak: boolean; trapHit: boolean }

export class CombatHud {
  root = el('div', 'off'); private ret: HTMLElement; private chip: HTMLElement; private obj: HTMLElement; private eye: HTMLElement;
  private bossEl: HTMLElement; private inj: HTMLElement; private fa: HTMLElement; private studyEl: HTMLElement; private vig: HTMLElement;
  private arrowEls: HTMLElement[] = [];
  private tagEls: HTMLElement[] = [];
  private touchRoot = el('div', 'off'); private pick = el('div', 'off');
  touch: TouchState = { attackHeld: false, attackHit: false, aim: false, dodgeHit: false, blockHeld: false, altHeld: false, altHit: false, weaponHit: false, sneak: false, trapHit: false };
  private btn: Record<string, HTMLButtonElement> = {};
  private last: Record<string, string> = {};
  onTouch: () => void = () => {};

  constructor() {
    this.root.id = 'cb-hud';
    this.vig = el('div', 'vig');
    this.ret = el('div', 'ret', `<svg viewBox="0 0 46 46"><circle class="ring" cx="23" cy="23" r="20"/><circle class="chg" cx="23" cy="23" r="20" stroke-dasharray="${RING}" stroke-dashoffset="${RING}"/></svg><i></i>`);
    this.studyEl = el('div', 'study', `<svg viewBox="0 0 70 70"><circle cx="35" cy="35" r="32" stroke-dasharray="201" stroke-dashoffset="201"/></svg>`);
    this.chip = el('div', 'chip', '<b></b><span></span><div class="dur"><i></i></div>');
    this.obj = el('div', 'obj', '<div></div><small></small>');
    this.eye = el('div', 'eye', '<svg viewBox="0 0 54 30"><defs><clipPath id="cb-eye-clip"><rect x="0" y="0" width="0" height="30"/></clipPath></defs><path class="f" clip-path="url(#cb-eye-clip)" d="M2 15C12 3 42 3 52 15 42 27 12 27 2 15z"/><path class="o" d="M2 15C12 3 42 3 52 15 42 27 12 27 2 15z"/><circle cx="27" cy="15" r="5" fill="#111"/></svg>');
    this.bossEl = el('div', 'boss', '<span></span><div class="bar"><i></i></div>');
    this.inj = el('div', 'inj');
    this.fa = el('div', 'fa', '<b></b><span></span>');
    this.teachEl = el('div', 'teach');
    this.root.append(this.vig, this.ret, this.studyEl, this.eye, this.obj, this.bossEl, this.inj, this.fa, this.chip, this.teachEl);
    for (let i = 0; i < 4; i++) { const a = el('div', 'arrow', '<i></i>'); this.arrowEls.push(a); this.root.append(a); }
    for (let i = 0; i < 6; i++) { const a = el('div', 'tag'); this.tagEls.push(a); this.root.append(a); }
    this.touchRoot.id = 'cb-touch';
    const mk = (id: keyof typeof ICON, down: () => void, up: () => void = () => {}) => {
      const b = el('button', id, `<svg viewBox="0 0 24 24">${ICON[id]}</svg>`) as HTMLButtonElement;
      b.setAttribute('aria-label', id);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('down'); try { b.setPointerCapture(e.pointerId); } catch { /* ignore */ } this.onTouch(); down(); });
      const rel = () => { if (b.classList.contains('down')) { b.classList.remove('down'); up(); } };
      b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel); b.addEventListener('lostpointercapture', rel);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      this.btn[id] = b; this.touchRoot.append(b);
    };
    const T = this.touch;
    mk('atk', () => { T.attackHeld = true; T.attackHit = true; }, () => { T.attackHeld = false; });
    mk('aim', () => { T.aim = !T.aim; this.btn.aim.classList.toggle('onn', T.aim); });
    mk('dge', () => { T.dodgeHit = true; });
    mk('blk', () => { T.blockHeld = true; }, () => { T.blockHeld = false; });
    mk('alt', () => { T.altHeld = true; T.altHit = true; }, () => { T.altHeld = false; });
    mk('wpn', () => { T.weaponHit = true; });
    mk('snk', () => { T.sneak = !T.sneak; this.btn.snk.classList.toggle('onn', T.sneak); });
    mk('trp', () => { T.trapHit = true; });
    this.pick.id = 'cb-pick';
    document.body.append(this.root, this.pick);
    (document.getElementById('touch') ?? document.body).append(this.touchRoot);
  }

  private set(key: string, v: string, f: () => void) { if (this.last[key] !== v) { this.last[key] = v; f(); } }
  show(on: boolean) { this.set('show', String(on), () => { this.root.classList.toggle('off', !on); document.body.classList.toggle('cb-engaged', on); if (!on) this.picker(null); }); }
  /** Touch buttons: which ones this moment has a use for. */
  showTouch(on: boolean, o: { aim: boolean; alt: boolean; trap: boolean; block: boolean } = { aim: false, alt: false, trap: false, block: true }) {
    this.set('touch', `${on}|${o.aim}|${o.alt}|${o.trap}|${o.block}`, () => {
      this.touchRoot.classList.toggle('off', !on);
      this.btn.aim.style.display = o.aim ? '' : 'none'; this.btn.alt.style.display = o.alt ? '' : 'none'; this.btn.trp.style.display = o.trap ? '' : 'none'; this.btn.blk.style.display = o.block ? '' : 'none';
      if (!on || !o.aim) { this.touch.aim = false; this.btn.aim.classList.remove('onn'); }
      if (!on) { this.touch.sneak = false; this.btn.snk.classList.remove('onn'); this.touch.attackHeld = this.touch.blockHeld = this.touch.altHeld = false; }
    });
  }
  endFrame() { const T = this.touch; T.attackHit = T.dodgeHit = T.altHit = T.weaponHit = T.trapHit = false; }

  reticle(on: boolean, charge: number, hot: boolean) {
    this.set('ret', `${on}|${hot}`, () => { this.ret.classList.toggle('on', on); this.ret.classList.toggle('hot', hot); });
    this.set('chg', charge.toFixed(2), () => { (this.ret.querySelector('.chg') as SVGCircleElement).style.strokeDashoffset = String(RING * (1 - charge)); });
  }
  weapon(name: string | null, ammo: string | null, dur: number | null) {
    this.set('wpn', `${name}|${ammo}|${dur === null ? '' : dur.toFixed(2)}`, () => {
      this.chip.style.display = name ? '' : 'none';
      if (!name) return;
      this.chip.querySelector('b')!.textContent = name;
      this.chip.querySelector('span')!.textContent = ammo ?? '';
      const d = this.chip.querySelector('.dur') as HTMLElement;
      d.style.display = dur === null ? 'none' : ''; d.classList.toggle('low', (dur ?? 1) < 0.25);
      (d.firstElementChild as HTMLElement).style.width = `${Math.round((dur ?? 0) * 100)}%`;
    });
  }
  objective(text: string | null, sub: string | null = null, warn = false) {
    this.set('obj', `${text}|${sub}|${warn}`, () => { this.obj.classList.toggle('on', !!text); this.obj.classList.toggle('warn', warn); this.obj.firstElementChild!.textContent = text ?? ''; this.obj.querySelector('small')!.textContent = sub ?? ''; });
  }
  /** How close something is to knowing you are there (0 to 1), or that it does. */
  awareness(k: number | null, seen = false) {
    this.set('eye', k === null ? '' : `${Math.round(Math.min(1, k) * 20)}|${seen}`, () => {
      this.eye.classList.toggle('on', k !== null && k > 0.04); this.eye.classList.toggle('seen', seen);
      this.eye.querySelector('rect')!.setAttribute('width', String(54 * Math.min(1, k ?? 0)));
    });
  }
  /** Arrows round the middle of the screen for attacks you cannot see: angle clockwise from straight ahead. */
  arrows(list: { a: number; hot: boolean }[]) {
    this.arrowEls.forEach((e, i) => {
      const q = list[i];
      e.classList.toggle('on', !!q);
      if (q) { e.classList.toggle('calm', !q.hot); e.style.transform = `rotate(${q.a}rad)`; }
    });
  }
  /** The suit's marks over creatures it already knows (screen pixels; `warm` while it has not noticed you). */
  tags(list: { x: number; y: number; warm: boolean }[]) {
    this.tagEls.forEach((e, i) => {
      const q = list[i];
      if (!q) { if (e.classList.contains('on')) e.classList.remove('on'); return; }
      e.classList.add('on'); e.classList.toggle('warm', q.warm);
      e.style.transform = `translate(${q.x.toFixed(0)}px, ${q.y.toFixed(0)}px)`;
    });
  }
  private barEls: HTMLElement[] = [];
  /** Small health bars over creatures just struck. */
  bars(list: { x: number; y: number; k: number }[]) {
    while (this.barEls.length < list.length) { const b = el('div', 'hp', '<i></i>'); this.root.append(b); this.barEls.push(b); }
    this.barEls.forEach((e, i) => {
      const q = list[i];
      if (!q) { if (e.classList.contains('on')) e.classList.remove('on'); return; }
      e.classList.add('on'); e.classList.toggle('low', q.k < 0.34);
      e.style.transform = `translate(${q.x.toFixed(0)}px, ${q.y.toFixed(0)}px)`;
      (e.firstElementChild as HTMLElement).style.width = `${(q.k * 100).toFixed(0)}%`;
    });
  }
  boss(name: string | null, k = 0, p2 = false) {
    this.set('boss', `${name}|${k.toFixed(3)}|${p2}`, () => { this.bossEl.classList.toggle('on', !!name); this.bossEl.classList.toggle('p2', p2); this.bossEl.firstElementChild!.textContent = name ?? ''; (this.bossEl.querySelector('.bar i') as HTMLElement).style.width = `${Math.max(0, k) * 100}%`; });
  }
  injuries(list: { id: string; bad: boolean }[]) {
    this.set('inj', list.map((i) => i.id + i.bad).join(), () => { this.inj.innerHTML = list.map((i) => `<i class="${i.bad ? 'bad' : ''}" title="${i.id}">+</i>`).join(''); });
  }
  private teachEl: HTMLElement;
  /** The first time a weapon is in the hand: its controls for the device in use (html built by combat.ts). */
  teach(html: string | null) { this.set('teach', html ?? '', () => { this.teachEl.classList.toggle('on', !!html); if (html) this.teachEl.innerHTML = html; }); }
  analysis(title: string | null, text = '') { this.set('fa', `${title}|${text}`, () => { this.fa.classList.toggle('on', !!title); this.fa.querySelector('b')!.textContent = title ?? ''; this.fa.querySelector('span')!.textContent = text; }); }
  study(k: number) { this.set('study', k.toFixed(2), () => { this.studyEl.classList.toggle('on', k > 0.02 && k < 1); (this.studyEl.querySelector('circle') as SVGCircleElement).style.strokeDashoffset = String(201 * (1 - k)); }); }
  vignette(on: boolean) { this.set('vig', String(on), () => this.vig.classList.toggle('on', on)); }

  /** A row of things to choose from (traps to set, creatures to bring out). */
  pickerOpen = false;
  picker(items: { id: string; label: string; sub: string; ok: boolean }[] | null, onPick: (id: string) => void = () => {}) {
    this.pickerOpen = !!items;
    this.pick.classList.toggle('off', !items);
    this.pick.innerHTML = '';
    if (!items) return;
    items.forEach((it, i) => {
      const b = el('button', '', `${i + 1}. ${it.label}<small>${it.sub}</small>`) as HTMLButtonElement;
      b.disabled = !it.ok; b.dataset.id = it.id;
      b.addEventListener('click', (e) => { e.stopPropagation(); onPick(it.id); });
      this.pick.append(b);
    });
  }
  /** Choose by number key or pad (index), as a click would. */
  pickIndex(i: number) { const b = this.pick.children[i] as HTMLButtonElement | undefined; if (b && !b.disabled) b.click(); }
}
