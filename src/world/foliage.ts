import * as THREE from 'three';
import { mulberry32, lerp } from '../core/noise';

/**
 * Tree crowns built from alpha-tested cards carrying real scans: boughs composed
 * from Poly Haven twig and leaf sheets (tools/fetch_assets.py). Each sheet has a
 * long bough on the left half and a spray on the right. Card normals are bent
 * away from the crown axis, the usual trick that makes a pile of quads light
 * like one soft volume. `foliageAtlas` paints a stand-in if the sheets can't load.
 */
export function foliageAtlas(): { map: THREE.CanvasTexture; alpha: THREE.CanvasTexture } {
  const S = 1024, c = document.createElement('canvas');
  c.width = S; c.height = S / 2;
  const g = c.getContext('2d')!;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  // needle spray
  const spray = (x0: number, y0: number, ang: number, len: number, w: number) => {
    for (let i = 0; i < 90; i++) {
      const t = i / 90, px = x0 + Math.cos(ang) * len * t, py = y0 + Math.sin(ang) * len * t;
      const nl = (1 - t * 0.75) * w * rnd(0.7, 1.15);
      for (const sgn of [-1, 1]) {
        const a = ang + sgn * rnd(0.5, 0.95), v = rnd(0.55, 1);
        g.strokeStyle = `rgb(${Math.round(60 * v)},${Math.round(105 * v)},${Math.round(82 * v)})`;
        g.lineWidth = rnd(1.4, 2.6);
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * nl, py + Math.sin(a) * nl); g.stroke();
      }
    }
    g.strokeStyle = '#2a2420'; g.lineWidth = 3.5;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len); g.stroke();
  };
  spray(256, 500, -Math.PI / 2, 470, 90);
  for (let i = 0; i < 10; i++) {
    const t = 0.12 + i * 0.075, s = i % 2 ? 1 : -1;
    spray(256, 500 - 470 * t, -Math.PI / 2 + s * 0.85, 210 * (1 - t * 0.7), 46);
  }
  // broad-leaf cluster
  for (let i = 0; i < 620; i++) {
    const a = rnd(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 236;
    const x = 768 + Math.cos(a) * r, y = 256 + Math.sin(a) * r, v = rnd(0.5, 1) * (1 - r / 700);
    g.save(); g.translate(x, y); g.rotate(rnd(0, Math.PI * 2));
    g.fillStyle = `rgb(${Math.round(rnd(58, 86) * v)},${Math.round(rnd(104, 132) * v)},${Math.round(rnd(58, 84) * v)})`;
    const L = rnd(15, 26), W = L * rnd(0.3, 0.45);
    g.beginPath(); g.moveTo(-L, 0); g.quadraticCurveTo(0, -W * 1.6, L, 0); g.quadraticCurveTo(0, W * 1.6, -L, 0); g.fill();
    g.strokeStyle = 'rgba(190,220,160,0.25)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-L, 0); g.lineTo(L, 0); g.stroke();
    g.restore();
  }
  // Colour and coverage are kept apart: the colour map gets an opaque leaf-toned
  // background, so mip-mapping can't bleed black into the edges of the cards.
  const al = document.createElement('canvas'); al.width = c.width; al.height = c.height;
  const ag = al.getContext('2d')!;
  ag.fillStyle = '#000'; ag.fillRect(0, 0, al.width, al.height);
  ag.globalCompositeOperation = 'lighter';
  ag.filter = 'brightness(0) invert(1)';
  ag.drawImage(c, 0, 0);
  const op = document.createElement('canvas'); op.width = c.width; op.height = c.height;
  const og = op.getContext('2d')!;
  og.fillStyle = '#31533f'; og.fillRect(0, 0, op.width / 2, op.height);
  og.fillStyle = '#3f6134'; og.fillRect(op.width / 2, 0, op.width / 2, op.height);
  og.drawImage(c, 0, 0);
  const map = new THREE.CanvasTexture(op), alpha = new THREE.CanvasTexture(al);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = alpha.anisotropy = 4;
  return { map, alpha };
}


export interface CrownLod { whorls: number; per: number; segs: number; widen: number; layers: number }

/** Quality levels of a crown: LOD 0 close-up, LOD 1 mid-distance, LOD 2 a handful of big cards. */
export const CROWN_LODS: CrownLod[] = [
  { whorls: 22, per: 7, segs: 3, widen: 1, layers: 2 },
  { whorls: 14, per: 5, segs: 2, widen: 1.5, layers: 1 },
  { whorls: 7, per: 4, segs: 1, widen: 2.4, layers: 1 },
];

interface Mesh { pos: number[]; nor: number[]; uv: number[]; col: number[]; idx: number[] }

const toGeometry = (m: Mesh) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(m.col, 3));
  g.setIndex(m.idx);
  return g;
};

const v = new THREE.Vector3(), side = new THREE.Vector3(), dir = new THREE.Vector3(), nrm = new THREE.Vector3(), out = new THREE.Vector3();

/**
 * One bough: a curved strip of `segs` quads from `root`, heading along azimuth
 * `az`, drooping as it goes. `roll` turns the card around the bough's own axis.
 */
function bough(m: Mesh, root: THREE.Vector3, az: number, rise: number, droop: number, len: number, width: number, roll: number, segs: number, half: 0 | 1, shade: number, axisY: number) {
  const ca = Math.cos(az), sa = Math.sin(az);
  side.set(-sa, 0, ca).multiplyScalar(Math.cos(roll)).add(new THREE.Vector3(0, Math.sin(roll), 0)).normalize();
  const base = m.pos.length / 3;
  let px = root.x, py = root.y, pz = root.z;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    if (i > 0) {
      const slope = rise - droop * t;
      const step = len / segs;
      px += ca * step; pz += sa * step; py += slope * step;
    }
    const w = width * (i === segs ? 0.55 : 0.5 + 0.5 * Math.sin(Math.min(1, t * 1.6 + 0.2) * Math.PI / 2));
    for (const s of [-1, 1]) {
      v.set(px, py, pz).addScaledVector(side, s * w * 0.5);
      m.pos.push(v.x, v.y, v.z);
      out.set(v.x, (v.y - axisY) * 0.6, v.z).normalize();
      nrm.set(0, 1, 0).lerp(out, 0.65).normalize();
      m.nor.push(nrm.x, nrm.y, nrm.z);
      m.uv.push(half * 0.5 + (s + 1) * 0.25, t * 0.98 + 0.01);
      // inner needles sit in the shade of the crown, tips catch the sky
      const c = shade * (0.55 + 0.6 * t);
      m.col.push(c, c, c);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = base + i * 2;
    m.idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
}

/**
 * Conifer crown. `base` is where the crown starts; `shape` 1 is a narrow fir, 0.6
 * a looser pine. Fixed seed so all LODs of a tree agree.
 */
export function coniferCrown(height: number, base: number, lod: CrownLod, detail: number, seed: number, spread = 0.25, rng = mulberry32(seed)): THREE.BufferGeometry {
  const m: Mesh = { pos: [], nor: [], uv: [], col: [], idx: [] };
  const whorls = Math.max(3, Math.round(lod.whorls * Math.min(detail, 1.2)));
  const root = new THREE.Vector3();
  for (let i = 0; i < whorls; i++) {
    const k = i / (whorls - 1);
    const y = base + (height - base) * Math.pow(k, 0.92);
    const len = Math.pow(1 - k, 0.85) * height * spread + 0.45;
    const per = Math.max(2, Math.round(lod.per * (1 - k * 0.45)));
    const rise = lerp(-0.38, 0.75, k * k) + 0.06;
    for (let j = 0; j < per; j++) {
      const az = ((j + (i % 2) * 0.5) / per) * Math.PI * 2 + (rng() - 0.5) * 0.7;
      const L = len * (0.82 + rng() * 0.36);
      const shade = 0.72 + k * 0.42 + rng() * 0.12;
      root.set(Math.cos(az) * 0.06, y + (rng() - 0.5) * (height / whorls) * 0.6, Math.sin(az) * 0.06);
      for (let l = 0; l < lod.layers; l++) {
        const roll = (l === 0 ? 0.16 : -0.75) + (rng() - 0.5) * 0.5;
        bough(m, root, az + (l ? (rng() - 0.5) * 0.5 : 0), rise - l * 0.12, 0.55 + rng() * 0.3, L, L * 0.72 * lod.widen, roll, lod.segs, l === 0 ? 0 : 1, shade * (l ? 0.85 : 1), height * 0.5);
      }
    }
  }
  return toGeometry(m);
}

/** Broad-leaf crown: sprays facing outwards around several lobes. */
export function broadCrown(lobes: [number, number, number, number][], lod: CrownLod, detail: number, seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const m: Mesh = { pos: [], nor: [], uv: [], col: [], idx: [] };
  const n = Math.max(3, Math.round(lod.whorls * lod.per * 0.14 * Math.min(detail, 1.2)));
  const c = new THREE.Vector3(), d = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3();
  for (const [cx, cy, cz, r] of lobes) {
    c.set(cx, cy, cz);
    for (let i = 0; i < n; i++) {
      const y = rng() * 2 - 1, a = rng() * Math.PI * 2, q = Math.sqrt(1 - y * y);
      d.set(q * Math.cos(a), y * 0.8, q * Math.sin(a));
      const p = c.clone().addScaledVector(d, r * (0.45 + rng() * 0.5));
      const s = r * (0.95 + rng() * 0.5) * Math.sqrt(lod.widen);
      u.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).cross(d).normalize();
      w.crossVectors(d, u).normalize();
      const base = m.pos.length / 3;
      const lit = 0.55 + (y * 0.5 + 0.5) * 0.6;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        v.copy(p).addScaledVector(u, sx * s * 0.5).addScaledVector(w, sy * s * 0.5);
        m.pos.push(v.x, v.y, v.z);
        nrm.copy(v).sub(c).normalize().lerp(d, 0.4).normalize();
        m.nor.push(nrm.x, nrm.y, nrm.z);
        m.uv.push(0.5 + (sx + 1) * 0.25, (sy + 1) * 0.5);
        m.col.push(lit, lit, lit);
      }
      m.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }
  return toGeometry(m);
}
