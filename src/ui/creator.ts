import * as THREE from 'three';
import { t } from '../i18n';
import { createCharacter, Character } from '../characters/character';
import { cleanName, NAME_MAX } from '../core/crew';
import {
  ACCENTS, EARS, EYES, GLOWS, HAIRS, HAIR_COLOURS, HAIR_TIPS, IRISES, LINEAGES, LINEAGE_IDS, MARKS, OUTFITS, PlayerLook, SKINS, defaultLook, randomLook,
} from '../characters/custom';
import type { UI } from './ui';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Live 3D preview, rebuilt when a choice changes. */
class Preview {
  private r: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(26, 1, 0.05, 30);
  private fig: Character | null = null;
  private yaw = 0.35;
  private raf = 0;
  private time = 0;
  private last = performance.now();

  constructor(private canvas: HTMLCanvasElement, detail: number, private look: PlayerLook) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    const key = new THREE.DirectionalLight(0xfff0dc, 3); key.position.set(1.6, 3, 3);
    const rim = new THREE.DirectionalLight(0x8fd8ff, 2.6); rim.position.set(-3, 2, -2);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xc4d6ea, 0x2a2622, 1.4));
    this.detail = detail;
    this.rebuild(look);
    let drag = false, px = 0;
    canvas.addEventListener('pointerdown', (e) => { drag = true; px = e.clientX; canvas.setPointerCapture(e.pointerId); e.stopPropagation(); });
    canvas.addEventListener('pointermove', (e) => { if (drag) { this.yaw += (e.clientX - px) * 0.012; px = e.clientX; } });
    canvas.addEventListener('pointerup', () => { drag = false; });
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now; this.time += dt;
      this.fit();
      const f = this.fig;
      if (!f) return;
      f.root.rotation.y = this.yaw;
      f.root.updateMatrixWorld(true);
      f.animate('idle', 0, 0, this.time, dt);
      this.r.render(this.scene, this.cam);
    };
    tick();
  }
  private detail: number;

  private fit() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.r.setSize(w, h, false);
      this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    }
    const dist = this.cam.aspect < 0.8 ? 5.4 : 4.6;
    this.cam.position.set(0, 1.25, dist);
    this.cam.lookAt(0, 0.98, 0);
  }

  rebuild(look: PlayerLook) {
    this.look = look;
    if (this.fig) this.scene.remove(this.fig.root);
    this.fig = createCharacter('scientist', this.detail, look);
    this.scene.add(this.fig.root);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.r.dispose();
    this.r.forceContextLoss();
  }
}

const swatches = (key: keyof PlayerLook, list: number[], cur: number) =>
  `<div class="swatches" data-k="${key}">${list.map((c) => `<button style="background:${css(c)}" data-v="${c}" class="${c === cur ? 'active' : ''}" aria-label="${css(c)}"></button>`).join('')}</div>`;
const choices = (key: keyof PlayerLook, opts: [string, string][], cur: string) =>
  `<div class="seg" data-k="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'active' : ''}">${esc(l)}</button>`).join('')}</div>`;
const row = (label: string, body: string) => `<div class="row"><label>${esc(t(label))}</label>${body}</div>`;

/**
 * Character creator: the only thing the player names is themselves. Used for a
 * new game and for changing your look later.
 */
export function openCreator(ui: UI, start: PlayerLook, mode: 'new' | 'edit', detail: number, onDone: (look: PlayerLook) => void, onBack: () => void) {
  const look: PlayerLook = { ...start };
  let preview: Preview | null = null;
  const off = (v: boolean): [string, string][] => { void v; return [['1', t('settings.on')], ['0', t('settings.off')]]; };
  const close = () => { preview?.dispose(); preview = null; ui.closeModal(); };

  const render = () => {
    const nums = (a: unknown[]) => a.map((_, i) => [String(i), String(i + 1)]) as [string, string][];
    void nums;
    ui.openRaw(`<h2>${esc(t('cc.title'))}</h2>
      <div class="creator">
        <div class="cc-view"><canvas id="cc-canvas"></canvas><div class="note">${esc(t('cc.rotate'))}</div></div>
        <div class="cc-opts">
          <div class="name-row you"><label for="nm-scientist"><span class="nr">${esc(t('cc.name'))}</span></label>
            <input id="nm-scientist" type="text" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false" dir="auto" placeholder="${esc(t('crew.scientist.name'))}" value="${esc(look.name)}"></div>
          ${row('cc.gender', choices('gender', [['m', t('cc.he')], ['f', t('cc.she')]], look.gender))}
          <div class="note">${esc(t('cc.note'))}</div>
          ${row('cc.height', `<input type="range" data-n="height" min="0.92" max="1.08" step="0.01" value="${look.height}">`)}
          ${row('cc.build', `<input type="range" data-n="build" min="0" max="1" step="0.05" value="${look.build}">`)}
          ${row('cc.lineage', choices('lineage', LINEAGE_IDS.map((l) => [l, t(`lin.${l}`)]), look.lineage))}
          ${row('cc.skin', swatches('skin', SKINS, look.skin))}
          ${row('cc.ears', choices('ears', EARS.map((e, i) => [e, String(i + 1)]), look.ears))}
          ${row('cc.horns', choices('horns', off(look.horns), look.horns ? '1' : '0'))}
          ${row('cc.tail', choices('tail', off(look.tail), look.tail ? '1' : '0'))}
          ${row('cc.marks', choices('marks', MARKS.map((e, i) => [e, String(i + 1)]), look.marks))}
          ${row('cc.glow', swatches('glow', GLOWS, look.glow))}
          ${row('cc.face', choices('eye', EYES.map((e, i) => [e, String(i + 1)]), look.eye))}
          ${row('cc.eyes', swatches('iris', IRISES, look.iris))}
          ${row('cc.eyeGlow', choices('eyeGlow', off(look.eyeGlow), look.eyeGlow ? '1' : '0'))}
          ${row('cc.hair', choices('hair', HAIRS.map((e, i) => [e, String(i + 1)]), look.hair))}
          ${row('cc.hairRoot', swatches('hairRoot', HAIR_COLOURS, look.hairRoot))}
          ${row('cc.hairTip', swatches('hairTip', HAIR_TIPS, look.hairTip))}
          ${row('cc.outfit', choices('outfit', OUTFITS.map((o) => [o, t(`crew.${o}.role`)]), look.outfit))}
          ${row('cc.accent', swatches('accent', ACCENTS, look.accent))}
        </div>
      </div>
      <div class="actions">
        <button class="btn primary" id="nm-ok">${esc(t(mode === 'new' ? 'cc.begin' : 'cc.save'))}</button>
        <button class="btn" id="cc-random">${esc(t('cc.random'))}</button>
        <button class="btn" id="cc-reset">${esc(t('cc.reset'))}</button>
        <button class="btn" id="nm-back">${esc(t('menu.back'))}</button>
      </div>`);
    preview?.dispose();
    preview = new Preview(document.getElementById('cc-canvas') as HTMLCanvasElement, detail, look);
    const card = document.getElementById('modal-card')!;
    const nameEl = document.getElementById('nm-scientist') as HTMLInputElement;
    nameEl.addEventListener('keydown', (e) => e.stopPropagation());
    nameEl.addEventListener('input', () => { look.name = nameEl.value; });
    let pending = 0;
    const changed = () => { clearTimeout(pending); pending = window.setTimeout(() => preview?.rebuild({ ...look }), 90); };
    card.querySelectorAll<HTMLElement>('.seg[data-k], .swatches[data-k]').forEach((g) => {
      const key = g.dataset.k as keyof PlayerLook;
      g.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
        const v = b.dataset.v!;
        const rec = look as unknown as Record<string, unknown>;
        if (g.classList.contains('swatches')) rec[key] = +v;
        else if (key === 'horns' || key === 'tail' || key === 'eyeGlow') rec[key] = v === '1';
        else rec[key] = v;
        if (key === 'lineage') { Object.assign(look, LINEAGES[look.lineage]); render(); return; }
        g.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        changed();
      }));
    });
    card.querySelectorAll<HTMLInputElement>('input[data-n]').forEach((el) => el.addEventListener('input', () => {
      (look as unknown as Record<string, number>)[el.dataset.n!] = +el.value;
      changed();
    }));
    document.getElementById('nm-ok')!.addEventListener('click', () => {
      look.name = cleanName(look.name);
      close();
      onDone(look);
    });
    document.getElementById('cc-random')!.addEventListener('click', () => { Object.assign(look, randomLook(look)); render(); });
    document.getElementById('cc-reset')!.addEventListener('click', () => { Object.assign(look, defaultLook(), { name: look.name, gender: look.gender }); render(); });
    document.getElementById('nm-back')!.addEventListener('click', () => { close(); onBack(); });
  };
  render();
}
