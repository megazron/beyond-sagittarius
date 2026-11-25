import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { grainNormal } from '../characters/shapes';

/**
 * Episode Three's made things, built from code with their real detail (owner: "real models instead of simple shapes"):
 * the band's honeycomb (wax cells, some capped, honey in the open ones, a torn edge), the leaf it is carried in, the
 * ice blocks of Draxum's wall (rough-cut, scored, frosted), and the thing from the lake that copies voices.
 */

const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** A piece of wild comb torn from a nest, about 11 by 8 cm and 2.4 cm thick, lying flat; its middle at the origin. */
export function honeycomb(seed = 3): THREE.Group {
  const R = rng(seed), g = new THREE.Group(); g.name = 'honeycomb';
  // the torn outline: an uneven oval
  const outline: THREE.Vector2[] = [];
  for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2, r = 1 + (R() - 0.5) * 0.16 + Math.sin(a * 3 + seed) * 0.05; outline.push(new THREE.Vector2(Math.cos(a) * 0.056 * r, Math.sin(a) * 0.04 * r)); }
  const inside = (x: number, y: number, m = 0) => { let c = false; for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) { const a = outline[i], b = outline[j]; if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c && Math.hypot(x / 0.056, y / 0.04) < 1 - m; };
  const T = 0.024, cell = 0.0029; // a worker cell is about 5.4 mm across the flats
  const shape = new THREE.Shape(outline);
  const slab = new THREE.ExtrudeGeometry(shape, { depth: T * 0.8, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.002, bevelSegments: 2, curveSegments: 4 });
  slab.translate(0, 0, -T * 0.4); slab.rotateX(-Math.PI / 2);
  const wax = new THREE.MeshStandardMaterial({ color: 0xd99a32, roughness: 0.55, normalMap: grainNormal(), normalScale: new THREE.Vector2(0.25, 0.25) });
  const capM = new THREE.MeshStandardMaterial({ color: 0xe8c27a, roughness: 0.7 });
  const honeyM = new THREE.MeshPhysicalMaterial({ color: 0xb5600c, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, emissive: 0x2a1000 });
  const body = new THREE.Mesh(slab, wax); body.castShadow = true; body.receiveShadow = true; g.add(body);
  // the cells on both faces: hexagonal walls, honey standing in most, a pale cap on some; the rim cells broken open
  const walls: THREE.BufferGeometry[] = [], caps: THREE.BufferGeometry[] = [], honey: THREE.BufferGeometry[] = [];
  const dx = cell * Math.sqrt(3), dy = cell * 1.5;
  for (const side of [1, -1]) for (let row = -16; row <= 16; row++) for (let col = -22; col <= 22; col++) {
    const x = col * dx + (row & 1 ? dx / 2 : 0), z = row * dy;
    if (!inside(x, z, 0.04)) continue;
    const rim = !inside(x, z, 0.14), h = 0.004 * (rim ? 0.4 + R() * 0.5 : 0.9 + R() * 0.2);
    const w = new THREE.CylinderGeometry(cell * 1.02, cell * 1.02, h, 6, 1, true); w.rotateY(Math.PI / 6);
    // the walls are thin: an inner ring a little smaller, faces turned in
    const inner = new THREE.CylinderGeometry(cell * 0.84, cell * 0.84, h, 6, 1, true); inner.rotateY(Math.PI / 6); inner.scale(-1, 1, 1);
    for (const geo of [w, inner]) { geo.translate(x, side * (T * 0.4 + h / 2), z); walls.push(geo); }
    const top = new THREE.RingGeometry(cell * 0.84, cell * 1.02, 6, 1); top.rotateX(-Math.PI / 2); top.rotateY(Math.PI / 6); if (side < 0) top.rotateX(Math.PI);
    top.translate(x, side * (T * 0.4 + h), z); walls.push(top);
    const r = R();
    if (!rim && r < 0.3) { const c = new THREE.CircleGeometry(cell * 0.9, 6); c.rotateX(-Math.PI / 2); c.rotateY(Math.PI / 6); if (side < 0) c.rotateX(Math.PI); c.translate(x, side * (T * 0.4 + h * 0.92), z); caps.push(c); }
    else if (r < 0.9) { const c = new THREE.CircleGeometry(cell * 0.86, 6); c.rotateX(-Math.PI / 2); c.rotateY(Math.PI / 6); if (side < 0) c.rotateX(Math.PI); c.translate(x, side * (T * 0.4 + h * (0.35 + R() * 0.45)), z); honey.push(c); }
  }
  const add = (list: THREE.BufferGeometry[], m: THREE.Material) => { if (!list.length) return; const geo = mergeGeometries(list.map((x) => x.toNonIndexed())); list.forEach((x) => x.dispose()); geo.computeVertexNormals(); const o = new THREE.Mesh(geo, m); o.receiveShadow = true; g.add(o); };
  add(walls, wax); add(caps, capM); add(honey, honeyM);
  // a drip of honey running off the torn edge
  const drip = new THREE.Mesh(new THREE.CapsuleGeometry(0.0032, 0.01, 4, 8), honeyM); drip.position.set(0.054, -0.006, 0.006); drip.rotation.z = 0.5; g.add(drip);
  return g;
}

/** A broad leaf (the comb's wrapping): a pointed oval with a midrib, curled up a little at the sides; about 22 by 13 cm. */
export function leaf(): THREE.Mesh {
  const s = new THREE.Shape(); s.moveTo(-0.11, 0); s.bezierCurveTo(-0.07, 0.07, 0.05, 0.075, 0.115, 0); s.bezierCurveTo(0.05, -0.075, -0.07, -0.07, -0.11, 0);
  const geo = new THREE.ShapeGeometry(s, 12); geo.rotateX(-Math.PI / 2);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, z * z * 3.2 - Math.abs(x) * 0.02); }
  geo.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ color: 0x3d6a2c, roughness: 0.62, side: THREE.DoubleSide, normalMap: grainNormal(), normalScale: new THREE.Vector2(0.4, 0.4) });
  const o = new THREE.Mesh(geo, m); o.receiveShadow = true;
  const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0028, 0.23, 5), new THREE.MeshStandardMaterial({ color: 0x6a8a3a, roughness: 0.7 }));
  rib.rotation.z = Math.PI / 2; rib.position.y = 0.002; o.add(rib);
  return o;
}

let iceMat: THREE.MeshStandardMaterial | null = null;
/** A block of lake ice cut with a stone and levered out: 75 by 42 by 42 cm, its faces uneven, its edges knocked off,
 * the score lines of the cutting on its sides, frost on top and clear blue-grey deeper in. */
export function iceBlock(seed: number): THREE.Mesh {
  const R = rng(seed * 31 + 7), W = 0.75, H = 0.42, D = 0.42;
  const geo = new THREE.BoxGeometry(W, H, D, 10, 6, 6);
  const p = geo.getAttribute('position'), col: number[] = [], c = new THREE.Color(), deep = new THREE.Color(0x8fa6b0), frost = new THREE.Color(0xe8e6e0), slush = new THREE.Color(0xb8b0a2);
  const n = (x: number, y: number, z: number) => Math.sin(x * 23 + seed) * Math.cos(z * 19 - seed) * 0.5 + Math.sin(y * 31 + x * 7) * 0.3 + Math.sin((x + z) * 57 + y * 11) * 0.2;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // knock the edges and corners in, as a stone-cut block's are
    const ex = Math.abs(x) / (W / 2), ey = Math.abs(y) / (H / 2), ez = Math.abs(z) / (D / 2);
    const edge = [ex * ey, ey * ez, ex * ez].reduce((a, b) => Math.max(a, b), 0);
    const pull = Math.max(0, edge - 0.8) * 0.12 * (0.6 + R() * 0.8);
    x -= Math.sign(x) * pull * 0.6; y -= Math.sign(y) * pull * 0.6; z -= Math.sign(z) * pull * 0.6;
    const bump = n(x, y, z) * 0.012;
    x += Math.sign(x) * bump * ex; y += Math.sign(y) * bump * ey; z += Math.sign(z) * bump * ez;
    // the score lines along the long sides: shallow grooves every 11 cm
    if (ez > 0.99 && Math.abs(y) < H * 0.45) z -= Math.sign(z) * 0.008 * Math.max(0, 1 - Math.abs(((x + 0.055) % 0.11 + 0.11) % 0.11 - 0.055) / 0.01);
    p.setXYZ(i, x, y, z);
    const top = y > H / 2 - 0.03 ? 1 : 0, k = Math.min(1, Math.max(0, 0.5 + n(x * 2, y * 2, z * 2) * 0.6));
    c.copy(deep).lerp(slush, k * 0.6).lerp(frost, top * 0.75 + (ey > 0.97 && y < 0 ? 0.3 : 0)); col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  if (!iceMat) iceMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.02, normalMap: grainNormal(), normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.3 });
  const m = new THREE.Mesh(geo, iceMat); m.castShadow = true; m.receiveShadow = true;
  return m;
}

/**
 * The thing in Methryx's lake that copies voices: long and low (about 4.2 m), six splayed legs, a flat head with a wide
 * lipless mouth, and a pale throat sac that swells when it calls. Its skin is the colour of the slush, mottled, with an
 * ice crust along the back. One continuous body, re-bent each frame along a swimming, walking spine.
 */
export interface Copier { root: THREE.Group; update(t: number, dt: number, o: { speed: number; call: number; rear: number }): void }
export function createCopier(detail = 1): Copier {
  const root = new THREE.Group(); root.name = 'e3.copier';
  const NS = detail < 0.8 ? 28 : 44, NR = detail < 0.8 ? 12 : 18, L = 4.2;
  // radius along the body (0 the snout, 1 the tail tip): a flat wide head, a neck, a long barrel, a whip of a tail
  const rad = (u: number) => { const head = Math.exp(-((u - 0.07) ** 2) / 0.003) * 0.28, neck = 0.2 + 0.2 * Math.min(1, u / 0.25); return Math.max(0.015, Math.max(head, u < 0.25 ? neck : 0.4 * (1 - (u - 0.25) / 0.75) ** 0.9) * (u < 0.02 ? u / 0.02 : 1)); };
  const flat = (u: number) => (u < 0.16 ? 0.48 : 0.72);
  const pos = new Float32Array(NS * NR * 3), uv = new Float32Array(NS * NR * 2), col = new Float32Array(NS * NR * 3), idx: number[] = [];
  const base = new THREE.Color(0x8c8476), dark = new THREE.Color(0x4a443c), pale = new THREE.Color(0xc9c2b0), crust = new THREE.Color(0xdedad0), cc = new THREE.Color();
  for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
    const u = i / (NS - 1), a = (j / NR) * Math.PI * 2, k = (i * NR + j);
    uv[k * 2] = j / NR; uv[k * 2 + 1] = u * 6;
    const belly = Math.max(0, -Math.cos(a)), back = Math.max(0, Math.cos(a));
    const mott = 0.5 + 0.5 * Math.sin(u * 70 + j * 1.7) * Math.cos(u * 23 - j * 2.3);
    cc.copy(base).lerp(dark, mott * 0.45 * back).lerp(pale, belly * 0.85).lerp(crust, back > 0.85 && u > 0.15 && u < 0.8 && mott > 0.55 ? 0.8 : 0);
    col[k * 3] = cc.r; col[k * 3 + 1] = cc.g; col[k * 3 + 2] = cc.b;
    if (i < NS - 1) { const a0 = k, b0 = i * NR + ((j + 1) % NR), c0 = a0 + NR, d0 = b0 + NR; idx.push(a0, c0, b0, b0, c0, d0); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.02, normalMap: grainNormal(), normalScale: new THREE.Vector2(0.9, 0.9) });
  const body = new THREE.Mesh(geo, skin); body.castShadow = true; body.receiveShadow = true; body.frustumCulled = false; root.add(body);
  // the throat sac, the mouth line, the eyes (small, milky, set high: it hunts by sound)
  const sacM = new THREE.MeshStandardMaterial({ color: 0xd8cfbf, roughness: 0.25, transparent: true, opacity: 0.92, emissive: 0x1a1410 });
  const sac = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10), sacM); root.add(sac);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 24, Math.PI * 1.1), new THREE.MeshStandardMaterial({ color: 0x2a2220, roughness: 0.5 })); root.add(lip);
  const eyes = [1, -1].map(() => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshStandardMaterial({ color: 0xcfd6d0, roughness: 0.1, emissive: 0x202826 })); root.add(e); return e; });
  // six legs, each upper and lower, splayed out to the side like a newt's
  const legM = skin;
  const legs = [0.26, 0.42, 0.6].flatMap((u, n) => [1, -1].map((s) => {
    const up = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.34, 4, 8), legM), lo = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.32, 4, 8), legM);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), legM); foot.scale.set(1.4, 0.35, 1.1);
    for (const o of [up, lo, foot]) { o.castShadow = true; root.add(o); }
    return { u, s, ph: n * 2.1 + (s > 0 ? 0 : Math.PI), up, lo, foot };
  }));
  const spine: THREE.Vector3[] = Array.from({ length: NS }, () => new THREE.Vector3());
  const tan = new THREE.Vector3(), side = new THREE.Vector3(), upv = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3();
  let walk = 0;
  const at = (u: number, out: THREE.Vector3) => { const f = u * (NS - 1), i = Math.min(NS - 2, Math.floor(f)); return out.copy(spine[i]).lerp(spine[i + 1], f - i); };
  const frame = (u: number) => { const i = Math.min(NS - 2, Math.floor(u * (NS - 1))); tan.subVectors(spine[i], spine[i + 1]).normalize(); side.crossVectors(Y, tan).normalize(); upv.crossVectors(tan, side).normalize(); };
  const limb = (o: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => { o.position.copy(a).add(b).multiplyScalar(0.5); o.quaternion.setFromUnitVectors(Y, tmp.subVectors(b, a).normalize()); };
  return {
    root,
    update(t, dt, o) {
      walk += dt * (0.6 + o.speed * 1.6);
      // the spine along +x (the snout at +x): a travelling wave sideways, the head raised when it rears or calls
      for (let i = 0; i < NS; i++) {
        const u = i / (NS - 1), x = (0.5 - u) * L;
        const wave = Math.sin(walk * 2.2 - u * 7) * (0.06 + 0.28 * u * u) * (0.4 + Math.min(1, o.speed));
        const lift = (o.rear * 0.9 + o.call * 0.15) * Math.max(0, 1 - u / 0.35) ** 2;
        spine[i].set(x, 0.24 + lift + Math.sin(t * 1.3 + u * 4) * 0.01, wave);
      }
      for (let i = 0; i < NS; i++) {
        const u = i / (NS - 1); frame(u);
        const r = rad(u), fl = flat(u), breathe = 1 + Math.sin(t * 1.6) * 0.02 * (u > 0.25 && u < 0.6 ? 1 : 0);
        for (let j = 0; j < NR; j++) {
          const a = (j / NR) * Math.PI * 2, k = (i * NR + j) * 3;
          tmp.copy(spine[i]).addScaledVector(side, Math.sin(a) * r * breathe).addScaledVector(upv, Math.cos(a) * r * fl * breathe);
          pos[k] = tmp.x; pos[k + 1] = tmp.y; pos[k + 2] = tmp.z;
        }
      }
      geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
      // head parts
      frame(0.07); const hp = at(0.07, new THREE.Vector3());
      sac.position.copy(at(0.16, new THREE.Vector3())).addScaledVector(upv, -0.12 - o.call * 0.06);
      sac.scale.setScalar(0.7 + o.call * (0.6 + 0.25 * Math.sin(t * 22)));
      lip.position.copy(hp).addScaledVector(tan, 0.08).addScaledVector(upv, -0.03); lip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), upv); lip.rotateZ(Math.atan2(tan.z, tan.x) + Math.PI * 0.45);
      eyes.forEach((e, n) => e.position.copy(hp).addScaledVector(side, (n ? -1 : 1) * 0.17).addScaledVector(upv, 0.1).addScaledVector(tan, -0.02));
      // legs: the hip on the body's side, the foot planted out and forward/back with the walk, lifted on the swing
      for (const lg of legs) {
        frame(lg.u); const hip = at(lg.u, new THREE.Vector3()).addScaledVector(side, lg.s * rad(lg.u) * 0.8);
        const ph = walk * 2.2 + lg.ph, swing = Math.sin(ph), lift = Math.max(0, Math.cos(ph)) * 0.12 * Math.min(1, o.speed + 0.2);
        const foot = hip.clone().addScaledVector(side, lg.s * 0.55).addScaledVector(tan, swing * 0.22 * Math.min(1, o.speed + 0.3)); foot.y = 0.03 + lift;
        const knee = hip.clone().lerp(foot, 0.5).addScaledVector(side, lg.s * 0.1); knee.y = Math.max(hip.y, foot.y) + 0.14;
        limb(lg.up, hip, knee); limb(lg.lo, knee, foot); lg.foot.position.copy(foot);
      }
    },
  };
}
