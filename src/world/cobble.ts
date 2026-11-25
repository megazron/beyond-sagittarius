import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Simplex } from '../core/noise';

export type CobbleKind = 'granite' | 'flint' | 'sand';

/** A river cobble of a kind: a rounded, slightly flattened stone about 13 cm long (`k` scales it). */
export function cobble(kind: CobbleKind, seed: number, k = 1): THREE.Mesh {
  const raw = new THREE.IcosahedronGeometry(1, 3); raw.deleteAttribute('normal'); raw.deleteAttribute('uv');
  const g = mergeVertices(raw), p = g.getAttribute('position'), n = new Simplex(seed);
  const col = new Float32Array(p.count * 3), c = new THREE.Color();
  const base = kind === 'flint' ? 0x24262c : kind === 'granite' ? 0x6f7073 : 0x7a5f45;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const m = 1 + 0.12 * n.noise2(x * 1.6 + y, z * 1.6) + (kind === 'flint' ? 0.06 * Math.abs(n.noise2(x * 4, y * 4 + z)) : 0);
    p.setXYZ(i, x * 0.065 * m * k, y * 0.04 * m * k, z * 0.05 * m * k);
    c.set(base);
    // granite: black and white specks; sandstone: bands; flint: a pale chalky skin on part of it
    if (kind === 'granite') { const h = n.noise2(x * 18, z * 18 + y * 9); c.multiplyScalar(h > 0.55 ? 0.35 : h < -0.6 ? 1.3 : 1); }
    else if (kind === 'sand') c.multiplyScalar(0.85 + 0.2 * Math.sin(y * 14 + n.noise2(x * 3, z * 3) * 2));
    else if (x + 0.3 * n.noise2(y * 2, z * 2) > 0.55) c.set(0xc9c2b0);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: kind === 'flint' ? 0.22 : kind === 'granite' ? 0.75 : 0.95, metalness: kind === 'flint' ? 0.08 : 0 });
  const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

