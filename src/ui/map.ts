import { t } from '../i18n';
import { WORLD_SIZE, HALF } from '../world/terrain';
import { icon } from './icons';
import { layerCanvas as layerCanvasOf } from './minimap';

type Height = (x: number, z: number) => number;
let base: HTMLCanvasElement | null = null;

/** Contour chart of the planet, drawn once from the height field. */
function chart(height: Height, res: number): HTMLCanvasElement {
  if (base) return base;
  const c = document.createElement('canvas');
  c.width = c.height = res;
  const g = c.getContext('2d')!;
  const img = g.createImageData(res, res);
  const h = new Float32Array(res * res);
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) h[y * res + x] = height((x / (res - 1) - 0.5) * WORLD_SIZE, (y / (res - 1) - 0.5) * WORLD_SIZE);
  const band = (v: number) => Math.floor(v / 9);
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const i = y * res + x, v = h[i];
    const r = h[i + (x < res - 1 ? 1 : 0)], d = h[i + (y < res - 1 ? res : 0)];
    const contour = band(v) !== band(r) || band(v) !== band(d);
    const major = contour && band(v) % 5 === 0;
    const shade = Math.max(-1, Math.min(1, (r - v + d - v) * 0.22));
    let R = 205 + shade * 22, G = 195 + shade * 22, B = 170 + shade * 20;
    if (v < -0.1) { R = 128; G = 150; B = 148; }
    else if (contour) { const k = major ? 0.62 : 0.8; R *= k; G *= k * 0.97; B *= k * 0.9; }
    const o = i * 4; img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  base = c;
  return c;
}

export interface MapPin { x: number; z: number; icon: string; label?: string; cls?: string }

export function mapHtml() { return `<div class="map"><canvas id="map-chart"></canvas><div id="map-pins"></div><div class="map-note"></div></div>`; }

/** Fills the Map tab, centred on the player and zoomed to the explored part of the world. */
export function drawMap(height: Height, player: { x: number; z: number; yaw: number }, pins: MapPin[], res: number) {
  const canvas = document.getElementById('map-chart') as HTMLCanvasElement | null;
  if (!canvas) return;
  const box = canvas.parentElement!.getBoundingClientRect();
  canvas.width = Math.max(2, Math.floor(box.width)); canvas.height = Math.max(2, Math.floor(box.height));
  const src = chart(height, res), g = canvas.getContext('2d')!;
  const span = WORLD_SIZE * 0.42; // metres across the short side
  const scale = Math.min(canvas.width, canvas.height) / span; // px per metre
  const toPx = (x: number, z: number) => ({ x: canvas.width / 2 + (x - player.x) * scale, y: canvas.height / 2 + (z - player.z) * scale });
  const k = (res / WORLD_SIZE) / scale;
  g.imageSmoothingEnabled = true;
  g.fillStyle = '#c9bfa6'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(src, (player.x + HALF) * (res / WORLD_SIZE) - canvas.width / 2 * k, (player.z + HALF) * (res / WORLD_SIZE) - canvas.height / 2 * k, canvas.width * k, canvas.height * k, 0, 0, canvas.width, canvas.height);
  const out = document.getElementById('map-pins')!;
  const clamp = (v: number, m: number) => Math.max(18, Math.min(m - 18, v));
  out.innerHTML = pins.map((p) => { const q = toPx(p.x, p.z); return `<span class="pin ${p.cls ?? ''}" style="left:${clamp(q.x, canvas.width)}px;top:${clamp(q.y, canvas.height)}px">${icon(p.icon)}${p.label ? `<em>${p.label.replace(/</g, '')}</em>` : ''}</span>`; }).join('')
    + `<span class="pin you" style="left:${canvas.width / 2}px;top:${canvas.height / 2}px;transform:translate(-50%,-50%) rotate(${-player.yaw}rad)"><svg class="ic" viewBox="0 0 24 24"><path class="f" d="M12 2l7 19-7-5-7 5z"/></svg></span>`;
  (document.querySelector('.map-note') as HTMLElement).textContent = t('map.note');
}

/** The planet as a map layer: the contour chart, for the minimap and the full map. */
export function planetLayer(height: Height, res: number): import('./minimap').MapLayer {
  return { id: 'planet', bounds: [-HALF, -HALF, HALF, HALF], pxPerM: res / WORLD_SIZE, span: 200, paint: (g) => { g.drawImage(chart(height, res), 0, 0); } };
}

/**
 * The full map of a layer: drag to pan, wheel or pinch (or the buttons) to zoom, tap to set a waypoint (tap it again,
 * or Clear, to remove it). North is up; you are the arrow.
 */
export function interactiveMap(L: import('./minimap').MapLayer, player: { x: number; z: number; heading: number }, pins: MapPin[],
  way: { get(): { x: number; z: number } | null; set(p: { x: number; z: number } | null): void }, note: string) {
  const canvas = document.getElementById('map-chart') as HTMLCanvasElement | null;
  if (!canvas) return;
  const wrap = canvas.parentElement!;
  const src = layerCanvasOf(L), [x0, z0, x1, z1] = L.bounds;
  const view = { cx: player.x, cz: player.z, k: 0 }; // k: px per metre on screen
  const ctl = document.createElement('div'); ctl.className = 'map-ctl';
  ctl.innerHTML = `<button class="mz" data-z="1.4" aria-label="${t('map.zoomIn')}">+</button><button class="mz" data-z="0.714" aria-label="${t('map.zoomOut')}">&minus;</button><button class="mc">${t('map.centre')}</button><button class="mw">${t('map.clear')}</button>`;
  wrap.appendChild(ctl);
  const fit = () => { const b = wrap.getBoundingClientRect(); canvas.width = Math.max(2, Math.floor(b.width)); canvas.height = Math.max(2, Math.floor(b.height)); if (!view.k) view.k = Math.min(canvas.width, canvas.height) / (L.span * 2.2); };
  const sg = L.northPlusZ ? -1 : 1; // Zenvora's north is +z: the map is turned half round, north still up
  const toPx = (x: number, z: number) => ({ x: canvas.width / 2 + (x - view.cx) * view.k * sg, y: canvas.height / 2 + (z - view.cz) * view.k * sg });
  const toW = (px: number, py: number) => ({ x: view.cx + (px - canvas.width / 2) / view.k * sg, z: view.cz + (py - canvas.height / 2) / view.k * sg });
  const draw = () => {
    fit();
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#c9bfa6'; g.fillRect(0, 0, canvas.width, canvas.height);
    const a = sg > 0 ? toPx(x0, z0) : toPx(x1, z1), b = sg > 0 ? toPx(x1, z1) : toPx(x0, z0);
    g.imageSmoothingEnabled = true; g.drawImage(src, a.x, a.y, b.x - a.x, b.y - a.y);
    const w = way.get(), out = document.getElementById('map-pins')!;
    const all = [...pins, ...(w ? [{ x: w.x, z: w.z, icon: 'marker', cls: 'way', label: t('map.waypoint') }] : [])];
    out.innerHTML = all.map((p) => { const q = toPx(p.x, p.z); return `<span class="pin ${p.cls ?? ''}" style="left:${q.x}px;top:${q.y}px">${icon(p.icon)}${p.label ? `<em>${p.label.replace(/</g, '')}</em>` : ''}</span>`; }).join('')
      + (() => { const q = toPx(player.x, player.z); return `<span class="pin you" style="left:${q.x}px;top:${q.y}px;transform:translate(-50%,-50%) rotate(${player.heading + (sg < 0 ? Math.PI : 0)}rad)"><svg class="ic" viewBox="0 0 24 24"><path class="f" d="M12 2l7 19-7-5-7 5z"/></svg></span>`; })();
    (ctl.querySelector('.mw') as HTMLElement).style.visibility = w ? 'visible' : 'hidden';
  };
  const zoom = (f: number) => { view.k = Math.max(0.05, Math.min(40, view.k * f)); draw(); };
  ctl.querySelectorAll<HTMLButtonElement>('.mz').forEach((bt) => bt.addEventListener('click', () => zoom(+bt.dataset.z!)));
  (ctl.querySelector('.mc') as HTMLElement).addEventListener('click', () => { view.cx = player.x; view.cz = player.z; draw(); });
  (ctl.querySelector('.mw') as HTMLElement).addEventListener('click', () => { way.set(null); draw(); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
  // one finger (or the mouse) pans, two pinch; a tap that did not move sets the waypoint
  const pts = new Map<number, { x: number; y: number }>(); let moved = 0, pinch = 0;
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); moved = 0; if (pts.size === 2) { const [p, q] = [...pts.values()]; pinch = Math.hypot(p.x - q.x, p.y - q.y); } });
  canvas.addEventListener('pointermove', (e) => {
    const o = pts.get(e.pointerId); if (!o) return;
    const dx = e.offsetX - o.x, dy = e.offsetY - o.y; o.x = e.offsetX; o.y = e.offsetY; moved += Math.abs(dx) + Math.abs(dy);
    if (pts.size === 1) { view.cx -= dx / view.k * sg; view.cz -= dy / view.k * sg; draw(); }
    else if (pts.size === 2) { const [p, q] = [...pts.values()]; const d = Math.hypot(p.x - q.x, p.y - q.y); if (pinch > 0) zoom(d / pinch); pinch = d; }
  });
  const up = (e: PointerEvent) => {
    const was = pts.size; pts.delete(e.pointerId);
    if (was !== 1 || moved > 8) return;
    const w = toW(e.offsetX, e.offsetY), cur = way.get();
    if (cur && Math.hypot(cur.x - w.x, cur.z - w.z) * view.k < 22) way.set(null);
    else if (w.x > x0 && w.x < x1 && w.z > z0 && w.z < z1) way.set({ x: w.x, z: w.z });
    draw();
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', (e) => pts.delete(e.pointerId));
  (document.querySelector('.map-note') as HTMLElement).textContent = note;
  draw();
  return draw;
}
