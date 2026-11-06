import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { skullFrom } from './hair';
import { loft, sweep, smoothPath, weaveNormal, grainNormal } from './shapes';
import { applySway, swayByStrand, SwayUniforms } from './sway';
import type { Look, CrewId } from './looks';
import type { PlayerLook } from './custom';
import type { CrewMeta } from './assets';

export interface KitInput {
  id: CrewId; custom?: PlayerLook; human: boolean; bones: Map<string, THREE.Bone>; meta: CrewMeta; look: Look; sway: SwayUniforms;
  skinC: number; glowC: number; shadeC: number; detail: number; heightM: number;
}
export interface Kit { splint: THREE.Group; footH: number; update(t: number, amount: number): void; }

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const cloth = (color: number, rough = 0.86) => new THREE.MeshStandardMaterial({ color, roughness: rough, side: THREE.DoubleSide, normalMap: weaveNormal(), normalScale: new THREE.Vector2(0.5, 0.5) });
const leather = (color: number, rough = 0.5) => new THREE.MeshStandardMaterial({ color, roughness: rough, normalMap: grainNormal(), normalScale: new THREE.Vector2(0.55, 0.55) });
const metal = (color: number, rough = 0.34) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.9 });
const glowMat = (color: number, k = 2.2) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: k, roughness: 0.4 });

/** Props that are rigid in life, carried by bones: horns, glasses, belts, halo, tail. */
export function addKit(k: KitInput): Kit {
  const { bones: B, meta: M, sway, custom, human, id } = k;
  const outfit = custom ? custom.outfit : human ? 'suit' : id;
  const piv = (n: string) => new THREE.Vector3(...M.pivots[n]);
  const local = (bone: string, p: THREE.Vector3) => p.clone().sub(piv(bone));
  const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, sh = true) => {
    const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = sh; o.receiveShadow = true; parent.add(o); return o;
  };
  const rbox = (w: number, h: number, d: number, r = 0.012) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
  const head = B.get('head')!, hips = B.get('hips')!, chest = B.get('chest')!;
  const eye = local('head', piv('eyeL')); // x>0, forward of the head pivot
  const top = M.skull.c[1] + M.skull.r[M.skull.r.length - 1][0];

  // a strip that really lies on the skull, for straps and headbands
  const skull = skullFrom(M.skull.c, M.skull.r);
  const band = (el: number, h: number, tilt: number, m: THREE.Material, gap = 1.035) => {
    const n = 48, pos: number[] = [], idx: number[] = [], uv: number[] = [];
    const d = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const az = (i / n) * Math.PI * 2 - Math.PI;
      const e = el + Math.cos(az) * tilt;
      d.set(Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e));
      const r = skull.radius(d) * gap;
      pos.push(skull.c.x + d.x * r, skull.c.y + d.y * r + h / 2, skull.c.z + d.z * r, skull.c.x + d.x * r, skull.c.y + d.y * r - h / 2, skull.c.z + d.z * r);
      uv.push(i / 8, 0, i / 8, 1);
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return add(g, m, head);
  };

  // ---- head ----
  const horn = (s: number) => {
    const m = new THREE.MeshStandardMaterial({ color: 0x2a201c, roughness: 0.36 });
    const base = V(s * eye.x * 1.5, top - 0.035, eye.z - 0.04);
    const pts = [base, base.clone().add(V(s * 0.05, 0.05, -0.02)), base.clone().add(V(s * 0.1, 0.075, -0.08)), base.clone().add(V(s * 0.13, 0.11, -0.16))];
    const g = sweep(smoothPath(pts, 12), { width: (t) => 0.034 * (1 - t) ** 0.8 + 0.002, thick: (t) => 0.032 * (1 - t) ** 0.8 + 0.002, side: V(0, 0, 1), sides: 10 });
    add(g, m, head);
    // growth rings near the root
    for (const t of [0.12, 0.24, 0.36]) {
      const p = smoothPath(pts, 12)[Math.round(t * 12)];
      const ring = add(new THREE.TorusGeometry(0.0145 * (1 - t), 0.0024, 6, 14), m, head, p.x, p.y, p.z);
      ring.rotation.set(0.9, s * 0.8, 0);
    }
  };
  if (custom ? custom.horns : id === 'strong' && !human) { horn(1); horn(-1); }

  const glasses = () => {
    const fr = metal(0xc9a86a, 0.28);
    const lens = new THREE.MeshStandardMaterial({ color: 0xbff0ff, transparent: true, opacity: 0.1, roughness: 0.04, depthWrite: false });
    const z = eye.z + 0.031;
    for (const s of [-1, 1]) {
      add(new THREE.TorusGeometry(0.0235, 0.0012, 8, 36), fr, head, s * eye.x * 1.04, eye.y - 0.003, z, false);
      add(new THREE.CircleGeometry(0.023, 28), lens, head, s * eye.x * 1.04, eye.y - 0.003, z, false);
      const arm = sweep(smoothPath([V(s * (eye.x + 0.024), eye.y + 0.002, z), V(s * (eye.x + 0.044), eye.y + 0.004, z - 0.03), V(s * (eye.x + 0.05), eye.y + 0.002, z - 0.11)], 8), { width: () => 0.0022, thick: () => 0.0018, side: V(0, 1, 0), sides: 4 });
      add(arm, fr, head, 0, 0, 0, false);
    }
    add(sweep(smoothPath([V(-eye.x + 0.02, eye.y + 0.002, z), V(0, eye.y + 0.009, z + 0.003), V(eye.x - 0.02, eye.y + 0.002, z)], 6), { width: () => 0.002, thick: () => 0.0016, side: V(0, 1, 0), sides: 4 }), fr, head, 0, 0, 0, false);
  };
  const goggles = () => {
        const c = M.skull.c, el = 0.62;
    const sm = leather(0x2c2118); sm.side = THREE.DoubleSide;
    band(el, 0.016, 0.1, sm);
    const d = new THREE.Vector3(0, Math.sin(el + 0.1), Math.cos(el + 0.1));
    const r = skull.radius(d);
    for (const s of [-1, 1]) {
      const o = add(new THREE.CylinderGeometry(0.024, 0.029, 0.018, 24), metal(0xb08a4a, 0.4), head, s * 0.034, c[1] + d.y * r + 0.006, c[2] + d.z * r + 0.012);
      o.rotation.x = Math.PI / 2 - 0.5;
      const l = add(new THREE.CircleGeometry(0.021, 20), new THREE.MeshStandardMaterial({ color: 0x20303a, roughness: 0.08, metalness: 0.4 }), o, 0, 0.0095, 0, false);
      l.rotation.x = -Math.PI / 2;
    }
  };
  const antennae = () => {
    const m = applySway(new THREE.MeshStandardMaterial({ color: k.skinC, roughness: 0.5 }), sway);
    for (const s of [-1, 1]) {
      const a = V(s * 0.04, top - 0.012, eye.z - 0.025), b = V(s * 0.075, top + 0.075, eye.z + 0.01), c = V(s * 0.12, top + 0.115, eye.z + 0.05);
      const g = sweep(smoothPath([a, b, c], 10), { width: (t) => 0.0055 * (1 - t * 0.6), thick: (t) => 0.0055 * (1 - t * 0.6), side: V(1, 0, 0), sides: 6 });
      swayByStrand(g, 0, 0.6);
      add(g, m, head);
      add(new THREE.SphereGeometry(0.0115, 12, 10), glowMat(0xffe07a, 2.6), head, c.x, c.y, c.z, false);
    }
  };
  const earGlow = () => {
    for (const s of [-1, 1]) for (const q of [0.35, 0.62]) add(new THREE.SphereGeometry(0.0034, 8, 6), glowMat(k.glowC), head, s * (eye.x + 0.075 + q * 0.05), eye.y + 0.005 + q * 0.012, eye.z - 0.11 - q * 0.08, false);
  };

  // ---- props by outfit ----
  const fit = M.fit, wrist = (s: string) => B.get(`forearmtw${s}`)!;
  const belt = (m: THREE.Material, grow = 1.04) => {
    const [rx, rz, y, z] = fit.waist;
    const g = loft([{ y: 0.024, rx: rx * grow, rz: rz * grow }, { y: -0.024, rx: rx * grow * 1.01, rz: rz * grow * 1.01 }], 28, false);
    add(g, m, hips, 0, y - piv('hips').y, z - piv('hips').z);
    return { rx: rx * grow, rz: rz * grow, y: y - piv('hips').y, z: z - piv('hips').z };
  };
  let scarfEnds: THREE.Mesh[] = [];
  switch (outfit) {
    case 'scientist': {
      if (!custom) { glasses(); earGlow(); }
      const hand = piv('handL'), dir = piv('forearmtwL').sub(hand).normalize();
      const dev = add(rbox(0.05, 0.016, 0.042, 0.006), metal(0x2a3038, 0.45), wrist('L'), 0, 0, 0);
      dev.position.copy(local('forearmtwL', hand.clone().addScaledVector(dir, 0.07)).add(V(0, 0.05, 0.012)));
      add(new THREE.BoxGeometry(0.04, 0.0015, 0.032), glowMat(0xffa040, 1.4), dev, 0, 0.0085, 0, false);
      break;
    }
    case 'medic': {
      const bag = leather(0x7a4a2a, 0.55), b = belt(cloth(0x1aa79a), 1.03);
      const sat = add(rbox(0.2, 0.15, 0.075, 0.02), bag, hips, -b.rx - 0.03, b.y - 0.14, b.z + 0.03);
      sat.rotation.z = 0.08;
      add(rbox(0.205, 0.07, 0.08, 0.018), leather(0x5e351b, 0.5), sat, 0, 0.05, 0.002);
      add(rbox(0.024, 0.016, 0.006, 0.003), metal(0xc9a86a), sat, 0, 0.018, 0.043);
      const [cx, cz, cy, cc] = fit.chest; const ch = piv('chest');
      const strapPts = (zs: number) => [V(cx * 0.62, cy - ch.y + 0.19, cc - ch.z + zs * cz * 0.45), V(cx * 0.2, cy - ch.y + 0.06, cc - ch.z + zs * cz * 1.06), V(-cx * 0.72, cy - ch.y - 0.14, cc - ch.z + zs * cz * 1.04), V(-cx * 1.12, cy - ch.y - 0.33, cc - ch.z + zs * cz * 0.6)];
      for (const z of [1, -1]) add(sweep(smoothPath(strapPts(z), 18), { width: () => 0.0165, thick: () => 0.0028, side: V(0.5, 0.8, 0), sides: 4 }), bag, chest);
      break;
    }
    case 'explorer': {
      if (!custom) goggles();
      const col = 0xd3322c;
      const [nx, nz, ny, nc] = fit.neck, n = piv('chest');
      const sc = cloth(col, 0.92);
      const wrapY = ny - n.y + 0.0;
      add(loft([{ y: wrapY + 0.045, rx: nx * 1.02, rz: nz * 1.02 }, { y: wrapY + 0.015, rx: nx * 1.2, rz: nz * 1.2, z: 0.004 }, { y: wrapY - 0.015, rx: nx * 1.3, rz: nz * 1.32, z: 0.01 }, { y: wrapY - 0.04, rx: nx * 1.18, rz: nz * 1.22, z: 0.01 }], 22), sc, chest, 0, 0, nc - n.z);
      const scarfM = applySway(cloth(col, 0.92), sway);
      for (const [s, l] of [[1, 0.5], [-1, 0.4]] as [number, number][]) {
        const front = fit.chest[3] - n.z + fit.chest[1] + 0.045;
        const g = sweep(smoothPath([V(s * nx * 0.7, wrapY, nc - n.z + nz * 1.2), V(s * nx * 1.05, wrapY - 0.11, front - 0.02), V(s * nx * 1.2, wrapY - l * 0.6, front + 0.02), V(s * nx * 1.05, wrapY - l, front + 0.015)], 14), { width: () => 0.03, thick: () => 0.0035, side: V(1, 0, 0.2), sides: 4 });
        swayByStrand(g, 0, 1.0);
        scarfEnds.push(add(g, scarfM, chest));
      }
      // backpack and bedroll
      const pc = cloth(0x5e4a30);
      const [cx, cz, cy, cc] = fit.chest, zb = cc - n.z - cz - 0.07;
      add(rbox(0.26, 0.34, 0.13, 0.035), pc, chest, 0, cy - n.y - 0.03, zb);
      add(rbox(0.2, 0.13, 0.05, 0.02), cloth(0x4e3c28), chest, 0, cy - n.y - 0.08, zb - 0.075);
      const roll = add(new THREE.CylinderGeometry(0.062, 0.062, 0.34, 16), cloth(0x8a3a30), chest, 0, cy - n.y + 0.19, zb);
      roll.rotation.z = Math.PI / 2;
      for (const s of [-1, 1]) add(sweep(smoothPath([V(s * cx * 0.62, cy - n.y + 0.13, zb + 0.06), V(s * cx * 0.66, cy - n.y + 0.2, cc - n.z), V(s * cx * 0.68, cy - n.y + 0.14, cc - n.z + cz * 1.02), V(s * cx * 0.8, cy - n.y - 0.12, cc - n.z + cz * 0.95)], 14), { width: () => 0.0155, thick: () => 0.0028, side: V(1, 0.1, 0), sides: 4 }), leather(0x3a2a1a), chest);
      break;
    }
    case 'builder': {
      const tb = leather(0x6a4524, 0.6), b = belt(tb, 1.08);
      add(rbox(0.05, 0.05, 0.012, 0.005), metal(0xb8a068, 0.4), hips, 0, b.y, b.z + b.rz + 0.004);
      const pouch = (x: number, w: number) => { const p = add(rbox(w, 0.13, 0.055, 0.016), tb, hips, x, b.y - 0.09, b.z + b.rz * 0.7); p.rotation.y = x > 0 ? 0.6 : -0.6; add(rbox(w + 0.004, 0.05, 0.06, 0.012), leather(0x523519, 0.6), p, 0, 0.045, 0); };
      pouch(b.rx * 0.82, 0.1); pouch(-b.rx * 0.82, 0.09);
      const wr = new THREE.Group(); wr.position.set(b.rx * 1.02, b.y - 0.08, b.z - b.rz * 0.2); wr.rotation.z = 0.12; hips.add(wr);
      add(rbox(0.018, 0.2, 0.008, 0.003), metal(0xb8bcc2), wr, 0, -0.08, 0);
      add(new THREE.TorusGeometry(0.024, 0.009, 8, 16, 4.6), metal(0xb8bcc2), wr, 0, 0.03, 0).rotation.z = 2.2;
      const hm = new THREE.Group(); hm.position.set(-b.rx * 1.02, b.y - 0.05, b.z - b.rz * 0.2); hips.add(hm);
      add(new THREE.CylinderGeometry(0.011, 0.012, 0.24, 10), leather(0x6a4524), hm, 0, -0.1, 0);
      add(rbox(0.1, 0.034, 0.034, 0.006), metal(0x6a6e74, 0.5), hm, 0, 0.02, 0);
      if (!custom) {
        band(0.5, 0.036, 0.14, cloth(0xd8452e, 0.9), 1.03);
      }
      break;
    }
    case 'strong': {
      belt(leather(0x4a3a24, 0.5), 1.05);
      break;
    }
    case 'social': {
      if (!custom) antennae();
      const hand = B.get('handR')!;
      const d = local('handR', piv('finger3_2R')), up = d.clone().normalize();
      const ph = add(rbox(0.074, 0.15, 0.009, 0.008), metal(0xe6d7f0, 0.25), hand);
      ph.position.copy(d.multiplyScalar(0.55).add(V(0, -0.02, 0)));
      ph.quaternion.setFromUnitVectors(V(0, 1, 0), up);
      add(new THREE.BoxGeometry(0.066, 0.138, 0.001), glowMat(0x8fd8ff, 0.8), ph, 0, 0, 0.005, false);
      if (!custom) for (const s of [-1, 1]) { const r = add(new THREE.TorusGeometry(0.021, 0.0016, 8, 28), metal(0xffd66a, 0.2), head, s * (eye.x + 0.073), eye.y - 0.075, eye.z - 0.075, false); r.rotation.y = Math.PI / 2; }
      break;
    }
    default: break;
  }

  // ---- MegaZroN ----
  let halo: THREE.Group | null = null;
  if (id === 'megazron' && !custom) {
    halo = new THREE.Group(); halo.position.set(0, M.skull.c[1] + 0.03, M.skull.c[2] - 0.17); head.add(halo);
    add(new THREE.TorusGeometry(0.2, 0.0055, 10, 90, Math.PI * 1.72), new THREE.MeshStandardMaterial({ color: 0x221708, emissive: 0xffc36a, emissiveIntensity: 1.5 }), halo, 0, 0, 0, false);
    const gold = metal(0xd4a94e, 0.3);
    for (const s of ['L', 'R']) { const hd = piv(`hand${s}`), fw = piv(`forearmtw${s}`); const r = add(new THREE.TorusGeometry(0.043, 0.004, 8, 28), gold, B.get(`forearmtw${s}`)!); r.position.copy(local(`forearmtw${s}`, hd.clone().lerp(fw, 0.28))); r.quaternion.setFromUnitVectors(V(0, 0, 1), hd.sub(fw).normalize()); }
  }

  // ---- tail: its own small skeleton off the hips ----
  const tailBones: THREE.Bone[] = [];
  if (custom ? custom.tail : id === 'explorer') {
    const n = 8, seg = 0.105, sides = 10, rings = n * 3;
    const pos: number[] = [], nor: number[] = [], si: number[] = [], sw: number[] = [], colr: number[] = [], idx: number[] = [];
    const base = new THREE.Color(k.skinC), dark = new THREE.Color(k.shadeC).multiplyScalar(0.7);
    for (let i = 0; i <= rings; i++) {
      const f = i / rings, y = -f * n * seg, r = 0.04 * (1 - f) ** 0.7 * (0.82 + 0.18 * Math.sin(Math.min(1, f * 6) * 1.57)) + 0.004;
      const b = Math.min(n - 1, Math.floor(f * n)), tt = f * n - b;
      const stripe = Math.sin(f * 28) > 0.45 || f > 0.86 ? 1 : 0;
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        pos.push(c * r, y, s * r); nor.push(c, 0, s);
        si.push(b, Math.min(n - 1, b + 1), 0, 0); sw.push(1 - tt * 0.5, tt * 0.5, 0, 0);
        const cc = stripe ? dark : base; colr.push(cc.r, cc.g, cc.b);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) { const a = i * sides + j, b = i * sides + (j + 1) % sides, c = a + sides, d = b + sides; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(idx);
    let parent: THREE.Object3D = new THREE.Bone();
    const r0 = parent as THREE.Bone;
    tailBones.push(r0);
    for (let i = 1; i < n; i++) { const b = new THREE.Bone(); b.position.y = -seg; parent.add(b); tailBones.push(b); parent = b; }
    const m = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
    m.castShadow = true; m.frustumCulled = false;
    const anchor = new THREE.Group();
    const wr = fit.waist;
    anchor.position.set(0, wr[2] - piv('hips').y - 0.1, wr[3] - piv('hips').z - wr[1] * 0.95);
    anchor.rotation.x = 1.15;
    hips.add(anchor);
    anchor.add(r0); anchor.add(m);
    anchor.updateMatrixWorld(true);
    m.bind(new THREE.Skeleton(tailBones));
  }

  // ---- splint: lashed sticks on the shin ----
  const splint = new THREE.Group();
  const shin = B.get('lowerlegR')!, shinV = local('lowerlegR', piv('footR'));
  splint.quaternion.setFromUnitVectors(V(0, -1, 0), shinV.clone().normalize());
  const len = shinV.length() * 0.95;
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4334, roughness: 0.9 });
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.011, 0.014, len, 7), wood, splint, s * 0.072, -len / 2, 0.006);
  for (const q of [0.24, 0.72]) { const w = add(new THREE.TorusGeometry(0.075, 0.009, 6, 18), new THREE.MeshStandardMaterial({ color: 0x2c4a2a, roughness: 0.9 }), splint, 0, -len * q, 0); w.rotation.x = Math.PI / 2; w.scale.y = 0.9; }
  splint.visible = false;
  shin.add(splint);

  return {
    splint, footH: piv('footL').y,
    update(t, amount) {
      if (halo) halo.rotation.z = t * 0.4;
      tailBones.forEach((b, i) => {
        const q = i / 7;
        const wag = Math.sin(t * 1.9 - q * 3.4) * (0.2 + amount * 0.14);
        b.rotation.z = wag * (0.25 + q * 0.6);
        if (i) b.rotation.x = -0.14 - amount * 0.08 + Math.sin(t * 1.3 - q * 2) * 0.05;
      });
    },
  };
}
