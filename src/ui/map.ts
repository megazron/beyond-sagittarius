import { t } from '../i18n';
import { WORLD_SIZE, HALF } from '../world/terrain';
import { icon } from './icons';

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
