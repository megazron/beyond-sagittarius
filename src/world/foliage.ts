import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Leafy canopies built from alpha-tested cards. The atlas is painted at start-up
 * (no download): left half = a needle spray, right half = a broad-leaf cluster.
 * Card normals point away from the crown centre, the usual trick that makes a
 * pile of quads light like one soft volume.
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

/** One card: `half` 0 = needle, 1 = broad cluster. Bottom-centre at the origin. */
function card(w: number, h: number, half: 0 | 1, center: boolean) {
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(0, center ? 0 : h / 2, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + half * 0.5);
  return g;
}

function outward(g: THREE.BufferGeometry, c: THREE.Vector3, k = 0.75) {
  const p = g.attributes.position, n = g.attributes.normal;
  const v = new THREE.Vector3(), m = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(c).normalize();
    m.set(n.getX(i), n.getY(i), n.getZ(i)).lerp(v, k).normalize();
    n.setXYZ(i, m.x, m.y, m.z);
  }
}

function tint(g: THREE.BufferGeometry, r: number, gg: number, b: number) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = gg; a[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
}

const place = (g: THREE.BufferGeometry, pos: THREE.Vector3, e: THREE.Euler) => {
  g.applyMatrix4(new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(1, 1, 1)));
  return g;
};

/** Conifer-like spire: whorls of drooping needle sprays, smaller towards the tip. */
export function spireCanopy(height: number, base: number, detail: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const whorls = Math.round(13 * detail);
  const axis = new THREE.Vector3(0, height * 0.55, 0);
  for (let i = 0; i < whorls; i++) {
    const k = i / (whorls - 1);
    const y = base + (height - base) * Math.pow(k, 0.9);
    const len = (1 - k) * height * 0.26 + 0.7;
    const per = Math.max(3, Math.round((7 - k * 3) * detail));
    for (let j = 0; j < per; j++) {
      const a = ((j + (i % 2) * 0.5) / per) * Math.PI * 2 + Math.random() * 0.4;
      const g = card(len * 0.85, len * 1.15, 0, false);
      // lay the spray out along the branch, tilted down at the tip
      place(g, new THREE.Vector3(0, y, 0), new THREE.Euler(1.2 + k * 0.35 + Math.random() * 0.25, a, 0, 'YXZ'));
      outward(g, axis, 0.55);
      const v = 0.62 + k * 0.5 + Math.random() * 0.12;
      tint(g, v, v, v);
      parts.push(g);
    }
  }
  return mergeGeometries(parts)!;
}

/** Rounded broad-leaf crown: overlapping cluster cards around the crown volume. */
export function crownCanopy(centres: [number, number, number, number][], detail: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [cx, cy, cz, r] of centres) {
    const c = new THREE.Vector3(cx, cy, cz);
    const n = Math.round(11 * detail);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, q = Math.sqrt(1 - u * u);
      const d = new THREE.Vector3(q * Math.cos(a), u * 0.72, q * Math.sin(a)).multiplyScalar(r * (0.5 + Math.random() * 0.45));
      const s = r * (0.95 + Math.random() * 0.5);
      const g = card(s, s, 1, true);
      place(g, c.clone().add(d), new THREE.Euler(Math.random() * 1.6 - 0.8, a + Math.PI / 2, Math.random() * 3));
      outward(g, c, 0.85);
      const v = 0.5 + (0.5 + u * 0.5) * 0.65;
      tint(g, v, v, v);
      parts.push(g);
    }
  }
  return mergeGeometries(parts)!;
}
