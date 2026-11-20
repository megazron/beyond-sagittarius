import { t } from '../i18n';

/**
 * Map layers, the corner minimap and the GPS route. A stage (the planet, Zenvora) gives a `MapLayer`: its extent, how
 * to paint it top-down once, and how to route between two points on it. The minimap turns with the camera (up is where
 * you look), shows the player's arrow in the middle, the objective (pinned to the rim when it is off the disc), the
 * people worth knowing, a waypoint and the route line to whichever of those you are heading for.
 */
export interface MapLayer {
  id: string;
  /** x0, z0, x1, z1 in metres. */
  bounds: [number, number, number, number];
  /** Pixels per metre of the painted layer. */
  pxPerM: number;
  paint(g: CanvasRenderingContext2D, X: (x: number) => number, Y: (z: number) => number): void;
  /** A walkable line from a to b (default: straight). */
  route?(ax: number, az: number, bx: number, bz: number): [number, number][];
  /** Metres across the minimap. */
  span: number;
  /** North is +z here (Zenvora): the map is drawn turned half round, so north is still up. Default: north is -z. */
  northPlusZ?: boolean;
}
export interface MapPoint { x: number; z: number; kind: 'goal' | 'person' | 'place' | 'way'; label?: string }

const painted = new Map<string, HTMLCanvasElement>();
/** The layer painted once, top-down, north (-z) up. */
export function layerCanvas(L: MapLayer) {
  let c = painted.get(L.id);
  if (c) return c;
  const [x0, z0, x1, z1] = L.bounds;
  c = document.createElement('canvas');
  c.width = Math.max(2, Math.round((x1 - x0) * L.pxPerM)); c.height = Math.max(2, Math.round((z1 - z0) * L.pxPerM));
  if (L.northPlusZ) L.paint(c.getContext('2d')!, (x) => (x1 - x) * L.pxPerM, (z) => (z1 - z) * L.pxPerM);
  else L.paint(c.getContext('2d')!, (x) => (x - x0) * L.pxPerM, (z) => (z - z0) * L.pxPerM);
  painted.set(L.id, c);
  return c;
}

export const routeOf = (L: MapLayer | null, ax: number, az: number, bx: number, bz: number): [number, number][] =>
  L?.route ? L.route(ax, az, bx, bz) : [[ax, az], [bx, bz]];

const COL = { goal: '#e8a33d', person: '#7fd8ff', place: '#f2ebdd', way: '#ff6ec7' };

export class Minimap {
  readonly el: HTMLCanvasElement;
  private layer: MapLayer | null = null;
  private acc = 1;
  /** Seconds between redraws (phones: twice as long). */
  interval = 0.08;
  /** Set from the full map: a point you chose. The route goes there until you reach it or clear it. */
  waypoint: { x: number; z: number } | null = null;

  constructor(host: HTMLElement, onOpen: () => void) {
    this.el = document.createElement('canvas');
    this.el.id = 'minimap'; this.el.className = 'minimap';
    this.el.setAttribute('role', 'button'); this.el.setAttribute('aria-label', t('tab.map'));
    host.appendChild(this.el);
    this.el.addEventListener('click', onOpen);
  }

  setLayer(L: MapLayer | null) { if (L?.id !== this.layer?.id) { this.layer = L; this.waypoint = null; } this.el.classList.toggle('hidden', !L); }
  get current() { return this.layer; }

  /** Where the route goes: the waypoint if one is set, else the objective. Clears a waypoint you have reached. */
  target(px: number, pz: number, goal: { x: number; z: number } | null) {
    if (this.waypoint && Math.hypot(this.waypoint.x - px, this.waypoint.z - pz) < 4) this.waypoint = null;
    return this.waypoint ?? goal;
  }

  /** Redraw (about 12 times a second): player position, camera heading (radians, 0 = looking north / -z, clockwise). */
  draw(dt: number, px: number, pz: number, heading: number, pts: MapPoint[], route: [number, number][] | null) {
    const L = this.layer;
    if (!L) return;
    this.acc += dt; if (this.acc < this.interval) return; this.acc = 0;
    const c = this.el, size = Math.round(c.clientWidth * Math.min(2, window.devicePixelRatio || 1));
    if (!size) return;
    if (c.width !== size) c.width = c.height = size;
    const g = c.getContext('2d')!, r = size / 2, k = size / L.span; // px per metre on the disc
    const src = layerCanvas(L), [x0, z0, x1, z1] = L.bounds, sg = L.northPlusZ ? -1 : 1;
    if (L.northPlusZ) heading += Math.PI;
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath(); g.arc(r, r, r - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = 'rgba(14, 13, 18, 0.82)'; g.fillRect(0, 0, size, size);
    // the world turned so the camera's heading points up, the player in the middle
    g.translate(r, r); g.rotate(-heading);
    const s = k / L.pxPerM;
    g.globalAlpha = 0.92;
    g.drawImage(src, ((L.northPlusZ ? x1 : x0) - px) * k * sg, ((L.northPlusZ ? z1 : z0) - pz) * k * sg, src.width * s, src.height * s);
    g.globalAlpha = 1;
    const P = (x: number, z: number): [number, number] => [(x - px) * k * sg, (z - pz) * k * sg];
    if (route && route.length > 1) {
      g.strokeStyle = COL.goal; g.lineWidth = Math.max(2, size / 45); g.lineJoin = g.lineCap = 'round';
      g.beginPath(); route.forEach(([x, z], i) => { const [u, v] = P(x, z); if (i) g.lineTo(u, v); else g.moveTo(u, v); }); g.stroke();
    }
    for (const p of pts) {
      let [u, v] = P(p.x, p.z);
      const d = Math.hypot(u, v), rim = r - size / 14;
      if (d > rim) { if (p.kind === 'person' || p.kind === 'place') continue; u *= rim / d; v *= rim / d; } // the goal stays on the rim
      g.fillStyle = COL[p.kind]; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = Math.max(1, size / 120);
      g.beginPath();
      if (p.kind === 'goal' || p.kind === 'way') { const q = size / 22; g.moveTo(u, v - q); g.lineTo(u + q, v); g.lineTo(u, v + q); g.lineTo(u - q, v); g.closePath(); }
      else g.arc(u, v, size / (p.kind === 'person' ? 48 : 40), 0, Math.PI * 2);
      g.fill(); g.stroke();
    }
    g.restore();
    // the player's arrow, always pointing up (where the camera looks), and a north tick on the rim
    const a = size / 16;
    g.fillStyle = '#f2ebdd'; g.strokeStyle = '#14120e'; g.lineWidth = Math.max(1, size / 90);
    g.beginPath(); g.moveTo(r, r - a); g.lineTo(r + a * 0.7, r + a * 0.8); g.lineTo(r, r + a * 0.35); g.lineTo(r - a * 0.7, r + a * 0.8); g.closePath(); g.fill(); g.stroke();
    const nx = r + Math.sin(-heading) * (r - size / 14), ny = r - Math.cos(-heading) * (r - size / 14);
    g.fillStyle = '#e8a33d'; g.font = `700 ${Math.round(size / 11)}px Barlow, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t('map.north'), nx, ny);
    g.strokeStyle = 'rgba(242, 235, 221, 0.35)'; g.lineWidth = Math.max(1, size / 80);
    g.beginPath(); g.arc(r, r, r - 1.5, 0, Math.PI * 2); g.stroke();
  }
}
