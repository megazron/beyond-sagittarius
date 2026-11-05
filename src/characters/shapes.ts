import * as THREE from 'three';

/** One horizontal cross-section of a lofted body part. */
export interface Ring { y: number; rx: number; rz: number; x?: number; z?: number; }

/** Smooth closed surface through elliptical rings (limbs, torso, clothes). */
export function loft(rings: Ring[], seg = 14, cap = true): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const cols = seg + 1;
  let v = 0;
  rings.forEach((r, i) => {
    if (i) v += Math.hypot(r.y - rings[i - 1].y, r.rx - rings[i - 1].rx);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push((r.x ?? 0) + Math.sin(a) * r.rx, r.y, (r.z ?? 0) + Math.cos(a) * r.rz);
      uv.push(j / seg, v);
    }
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      // rings may run top-down or bottom-up
      if (rings[i + 1].y < rings[i].y) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  if (cap) {
    for (const end of [0, rings.length - 1]) {
      const r = rings[end], c = pos.length / 3;
      pos.push(r.x ?? 0, r.y, r.z ?? 0); uv.push(0.5, 0.5);
      const down = (end === 0) === (rings[1].y > rings[0].y);
      for (let j = 0; j < seg; j++) {
        const a = end * cols + j, b = a + 1;
        if (down) idx.push(c, b, a); else idx.push(c, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the seam normals
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < rings.length; i++) {
    const a = i * cols, b = a + seg;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

/** Open surface over part of the rings (coat skirts, capes, skirts). */
export function arcLoft(rings: Ring[], a0: number, a1: number, seg = 12): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const cols = seg + 1;
  rings.forEach((r, i) => {
    for (let j = 0; j <= seg; j++) {
      const a = a0 + (j / seg) * (a1 - a0);
      pos.push((r.x ?? 0) + Math.sin(a) * r.rx, r.y, (r.z ?? 0) + Math.cos(a) * r.rz);
      uv.push(j / seg, i / (rings.length - 1));
    }
  });
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A limb segment hanging down from the origin: rx0/rx1 with a muscle bulge. */
export function limb(len: number, r0: number, r1: number, bulge = 0.12, flat = 1, seg = 12): THREE.BufferGeometry {
  const rs: Ring[] = [];
  const N = 7;
  for (let i = 0; i <= N; i++) {
    const k = i / N;
    const r = (r0 + (r1 - r0) * k) * (1 + bulge * Math.sin(Math.min(1, k * 1.5) * Math.PI));
    const end = i === 0 || i === N ? 0.82 : 1;
    rs.push({ y: -len * k, rx: r * end, rz: r * flat * end });
  }
  return loft(rs, seg);
}

/** Options for sweep(). `side` is the initial cross-section axis. */
export interface SweepOpts { width: (t: number) => number; thick: (t: number) => number; side: THREE.Vector3; sides?: number; }

/**
 * Ribbon-like solid along a path: used for hair locks, scarves, straps.
 * Adds per-vertex aT (0 root .. 1 tip) and aTan (strand direction).
 */
export function sweep(path: THREE.Vector3[], o: SweepOpts): THREE.BufferGeometry {
  const S = o.sides ?? 6;
  const pos: number[] = [], at: number[] = [], tan: number[] = [], idx: number[] = [], uv: number[] = [];
  const side = o.side.clone().normalize();
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  const n = path.length;
  for (let i = 0; i < n; i++) {
    T.subVectors(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)]).normalize();
    side.addScaledVector(T, -side.dot(T)).normalize(); // parallel transport
    N.crossVectors(T, side).normalize();
    B.copy(side);
    const t = i / (n - 1), w = o.width(t), d = o.thick(t);
    for (let j = 0; j < S; j++) {
      const a = (j / S) * Math.PI * 2;
      // lens section: sharp on the edges, a soft ridge on the faces
      const ca = Math.cos(a), sa = Math.sin(a);
      const x = Math.sign(ca) * Math.pow(Math.abs(ca), 1.5) * w, y = Math.sign(sa) * Math.pow(Math.abs(sa), 0.8) * d;
      pos.push(path[i].x + B.x * x + N.x * y, path[i].y + B.y * x + N.y * y, path[i].z + B.z * x + N.z * y);
      at.push(t); tan.push(T.x, T.y, T.z); uv.push(j / S, t);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < S; j++) {
      const a = i * S + j, b = i * S + ((j + 1) % S), c = a + S, d = b + S;
      idx.push(a, c, b, b, c, d);
    }
  }
  // close the root
  for (let j = 1; j < S - 1; j++) idx.push(0, j, j + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  g.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Catmull-Rom resample so hand-placed control points become a smooth path. */
export function smoothPath(pts: THREE.Vector3[], n = 10): THREE.Vector3[] {
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal').getPoints(n);
}

let weave: THREE.CanvasTexture | null = null, grain: THREE.CanvasTexture | null = null;

/** Tiny generated normal map: woven cloth. */
export function weaveNormal() {
  if (weave) return weave;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!, d = g.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const over = ((x >> 2) + (y >> 2)) & 1;
    const nx = over ? Math.sin(((x & 3) / 4) * Math.PI * 2) * 0.45 : 0;
    const ny = over ? 0 : Math.sin(((y & 3) / 4) * Math.PI * 2) * 0.45;
    const i = (y * 128 + x) * 4;
    d.data[i] = 128 + nx * 127; d.data[i + 1] = 128 + ny * 127; d.data[i + 2] = 235; d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  weave = new THREE.CanvasTexture(c);
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.repeat.set(10, 12);
  return weave;
}

/** Tiny generated normal map: pebbled leather / worn surfaces. */
export function grainNormal() {
  if (grain) return grain;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!, d = g.createImageData(128, 128);
  const h = new Float32Array(128 * 128);
  for (let k = 0; k < 500; k++) {
    const cx = Math.random() * 128, cy = Math.random() * 128, r = 2 + Math.random() * 4;
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
      const q = Math.hypot(x, y) / r;
      if (q < 1) h[((cy + y) & 127) * 128 + ((cx + x) & 127)] += (1 - q) * 0.5;
    }
  }
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const nx = h[y * 128 + ((x + 1) & 127)] - h[y * 128 + ((x + 127) & 127)];
    const ny = h[((y + 1) & 127) * 128 + x] - h[((y + 127) & 127) * 128 + x];
    const i = (y * 128 + x) * 4;
    d.data[i] = 128 - Math.max(-1, Math.min(1, nx)) * 110; d.data[i + 1] = 128 - Math.max(-1, Math.min(1, ny)) * 110; d.data[i + 2] = 230; d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  grain = new THREE.CanvasTexture(c);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(4, 5);
  return grain;
}
