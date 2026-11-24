import * as THREE from 'three';

/**
 * The thornix fruit (the red fruit of Episode One 1.1): about 7 cm long, a ribbed pod a little longer than wide, a
 * yellow-orange shoulder at the stalk going to deep crimson with darker grooves between the six ribs, a fine fuzz of
 * short dark bristles, matt with a slight waxy sheen. Built once and shared (the bush's fruit and the one in his hand).
 * The old one was a smooth, glowing 18 cm red ball with 9 cm thorns: "huge red balls" (owner).
 */
let geo: THREE.BufferGeometry | null = null, mat: THREE.MeshStandardMaterial | null = null;
export function redFruitGeometry() {
  if (geo) return geo;
  const g = new THREE.SphereGeometry(0.03, 24, 16), p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3), c = new THREE.Color(), top = new THREE.Color(0xd8892a), body = new THREE.Color(0x8e1424), groove = new THREE.Color(0x4a0812);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), h = y / 0.03; // -1 bottom .. 1 top (stalk)
    const rib = Math.cos(a * 6), lobe = 1 + 0.09 * rib * (1 - h * h) ** 0.5;
    // pear-ish: fuller below the middle, the stalk end pulled in, the tip a little pointed
    const taper = 1 - 0.18 * Math.max(0, h) ** 1.5 - 0.1 * Math.max(0, -h) ** 3;
    p.setXYZ(i, x * lobe * taper, y * 1.22, z * lobe * taper);
    c.copy(body).lerp(top, THREE.MathUtils.smoothstep(h, 0.35, 0.95));
    c.lerp(groove, Math.max(0, -rib) * 0.55 * (1 - Math.abs(h)));
    const speck = Math.sin(x * 900 + y * 1300) * Math.sin(z * 1100 - y * 700);
    if (speck > 0.92) c.multiplyScalar(0.55);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  // a short woody stalk and a ring of dry sepals at the top
  const stalk = new THREE.CylinderGeometry(0.0022, 0.003, 0.018, 5).translate(0, 0.045, 0);
  const sc = new Float32Array(stalk.getAttribute('position').count * 3).fill(0); for (let i = 0; i < sc.length; i += 3) { sc[i] = 0.33; sc[i + 1] = 0.25; sc[i + 2] = 0.13; }
  stalk.setAttribute('color', new THREE.BufferAttribute(sc, 3)); stalk.deleteAttribute('uv');
  g.deleteAttribute('uv');
  const parts = [g.toNonIndexed(), stalk.toNonIndexed()];
  const n = parts.reduce((s, q) => s + q.getAttribute('position').count, 0);
  const out = new THREE.BufferGeometry(), P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
  let o = 0;
  for (const q of parts) { const k = q.getAttribute('position').count * 3; P.set(q.getAttribute('position').array as Float32Array, o); N.set(q.getAttribute('normal').array as Float32Array, o); C.set(q.getAttribute('color').array as Float32Array, o); o += k; }
  out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  out.computeBoundingSphere();
  geo = out;
  return geo;
}
export function redFruitMaterial() {
  return mat ??= new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.48, metalness: 0, emissive: 0x1a0204, emissiveIntensity: 0.4 });
}
export function redFruitMesh() { return new THREE.Mesh(redFruitGeometry(), redFruitMaterial()); }
