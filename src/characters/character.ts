import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, lerp } from '../core/noise';
import { loft, arcLoft, limb, sweep, smoothPath, weaveNormal, grainNormal, Ring } from './shapes';
import { applySway, swayByHeight, swayByStrand, swayUniforms } from './sway';
import { paintFace, headGeometry } from './face';
import { buildHair, HAIRSTYLES, HAIR_CAP, SKULL } from './hair';
import { LOOKS, CrewId, Look } from './looks';

export type { CrewId } from './looks';
export type CrewPose = 'stand' | 'idle' | 'walk' | 'sit' | 'injured' | 'wave' | 'lie' | 'point' | 'cheer' | 'facepalm' | 'selfie' | 'shout' | 'argue' | 'present' | 'write';
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---- materials ----
const cloth = (color: number, rough = 0.86) => new THREE.MeshStandardMaterial({ color, roughness: rough, side: THREE.DoubleSide, normalMap: weaveNormal(), normalScale: new THREE.Vector2(0.5, 0.5) });
const leather = (color: number, rough = 0.5) => new THREE.MeshStandardMaterial({ color, roughness: rough, side: THREE.DoubleSide, normalMap: grainNormal(), normalScale: new THREE.Vector2(0.55, 0.55) });
const metal = (color: number, rough = 0.34) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.9 });
const glowMat = (color: number, k = 2.2) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: k, roughness: 0.4 });

function marksTexture(kind: Look['marks'], color: number) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  const col = `#${color.toString(16).padStart(6, '0')}`;
  g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round';
  let seed = 9; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  if (kind === 'dots' || kind === 'stars') for (let i = 0; i < 34; i++) { g.beginPath(); g.arc(r() * 256, r() * 256, 1.5 + r() * 2.5, 0, 7); g.fill(); }
  else if (kind === 'cracks') { g.lineWidth = 2.4; for (let i = 0; i < 7; i++) { let x = r() * 256, y = r() * 256; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 60; y += 14 + r() * 26; g.lineTo(x, y); } g.stroke(); } }
  else if (kind === 'veins') { g.lineWidth = 1.5; for (let i = 0; i < 5; i++) { const x = 20 + i * 50; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 30, 90, x - 30, 170, x, 256); g.stroke(); } }
  else if (kind === 'stripes') { g.globalAlpha = 0.9; g.fillStyle = '#7a2030'; for (let i = 0; i < 7; i++) { const y = i * 38 + 8; g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(128, y + 16, 256, y); g.quadraticCurveTo(128, y + 24, 0, y + 8); g.fill(); } }
  else if (kind === 'plates') { g.lineWidth = 1.6; g.globalAlpha = 0.7; for (let y = 0; y < 256; y += 42) for (let x = (y / 42 % 2) * 30; x < 256; x += 60) { g.strokeRect(x, y, 56, 38); } }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The six crew. Every character shares one skeleton but has its own body,
 * species features, outfit, anime hair, face, posture and motion.
 */
export function createCharacter(id: CrewId, detail = 1) {
  const L = LOOKS[id], B = L.build, P = L.persona;
  const sway = swayUniforms();
  const root = new THREE.Group();
  const fig = new THREE.Group();
  fig.scale.setScalar(B.height);
  root.add(fig);

  const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, sh = true) => {
    const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = sh; o.receiveShadow = true; parent.add(o); return o;
  };
  const swayMat = (m: THREE.MeshStandardMaterial) => { m.side = THREE.DoubleSide; return applySway(m, sway) as THREE.MeshStandardMaterial; };

  // ---- skin ----
  const marksTex = marksTexture(L.marks, L.glow);
  const skinCol = new THREE.Color(L.face.skin);
  const skin = new THREE.MeshStandardMaterial({ color: skinCol, roughness: 0.48, emissive: L.marks === 'stripes' ? 0x000000 : 0xffffff, emissiveMap: L.marks === 'stripes' ? null : marksTex, emissiveIntensity: 1.15 });
  if (L.marks === 'stripes') { skin.map = marksTex; skin.color.set(0xffffff); const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!; g.fillStyle = `#${L.face.skin.toString(16).padStart(6, '0')}`; g.fillRect(0, 0, 256, 256); g.globalAlpha = 0.85; g.fillStyle = '#90283a'; for (let i = 0; i < 7; i++) { const y = i * 38 + 8; g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(128, y + 16, 256, y); g.quadraticCurveTo(128, y + 24, 0, y + 8); g.fill(); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; skin.map = t; }

  // ---- skeleton ----
  const body = new THREE.Group(); // pelvis
  const hipY = 0.93;
  body.position.y = hipY;
  fig.add(body);
  const chest = new THREE.Group(); chest.position.y = 0.1; body.add(chest);
  const neck = new THREE.Group(); neck.position.y = 0.46; chest.add(neck);
  const head = new THREE.Group(); head.position.y = 0.075; neck.add(head);
  head.scale.setScalar(B.head);
  const sw = 0.19 * B.shoulder;
  const joint = (parent: THREE.Object3D, x: number, y: number, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  const armL = joint(chest, sw, 0.385), armR = joint(chest, -sw, 0.385);
  const foreL = joint(armL, 0, -0.29), foreR = joint(armR, 0, -0.29);
  const handL = joint(foreL, 0, -0.26), handR = joint(foreR, 0, -0.26);
  const hw = 0.092 * B.hip;
  const legL = joint(body, hw, -0.02), legR = joint(body, -hw, -0.02);
  const shinL = joint(legL, 0, -0.45), shinR = joint(legR, 0, -0.45);
  const footL = joint(shinL, 0, -0.42), footR = joint(shinR, 0, -0.42);

  // ---- naked base (arms/legs/neck are covered per outfit) ----
  const lt = B.limb;
  const neckGeo = limb(0.1, 0.05 * Math.sqrt(lt), 0.056 * Math.sqrt(lt), 0, 0.95);
  add(neckGeo, skin, neck, 0, 0.09, 0);
  const handGeo = () => {
    const parts: THREE.BufferGeometry[] = [loft([{ y: 0, rx: 0.036, rz: 0.02 }, { y: -0.05, rx: 0.046, rz: 0.021 }, { y: -0.09, rx: 0.042, rz: 0.016 }], 8)];
    for (let i = 0; i < 4; i++) {
      const f = limb(0.07 - Math.abs(i - 1.5) * 0.007, 0.0095, 0.0075, 0, 1, 5);
      f.rotateX(-0.28); f.translate(-0.03 + i * 0.02, -0.088, 0.003);
      parts.push(f);
    }
    const th = limb(0.055, 0.011, 0.008, 0, 1, 5); th.rotateZ(0.7); th.rotateX(-0.3); th.translate(0.04, -0.03, 0.012); parts.push(th);
    return mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }))!;
  };
  const hg = handGeo();
  const addHands = (m: THREE.Material) => {
    add(hg, m, handL).scale.set(Math.sqrt(lt), 1, Math.sqrt(lt));
    const r = add(hg, m, handR); r.scale.set(-Math.sqrt(lt), 1, Math.sqrt(lt)); (r.material as THREE.Material).side = THREE.DoubleSide;
  };

  /** Arm sleeve/forearm geometry for a thickness multiplier. */
  const upperArm = (k = 1) => limb(0.3, 0.055 * lt * k, 0.044 * lt * k, 0.16);
  const foreArm = (k = 1) => limb(0.265, 0.044 * lt * k, 0.031 * lt * k, 0.14);
  const thigh = (k = 1) => limb(0.46, 0.082 * Math.sqrt(lt * B.hip) * k, 0.056 * lt ** 0.5 * k, 0.08);
  const shin = (k = 1) => limb(0.43, 0.056 * lt ** 0.5 * k, 0.036 * lt ** 0.5 * k, 0.18);
  const sleeves = (up: THREE.Material | null, lo: THREE.Material | null, k = 1.08) => {
    add(upperArm(up === skin ? 1 : k), up ?? skin, armL); add(upperArm(up === skin ? 1 : k), up ?? skin, armR);
    add(foreArm(lo === skin ? 1 : k), lo ?? skin, foreL); add(foreArm(lo === skin ? 1 : k), lo ?? skin, foreR);
  };
  const pants = (m: THREE.Material, k = 1.1) => {
    add(thigh(k), m, legL); add(thigh(k), m, legR); add(shin(k), m, shinL); add(shin(k), m, shinR);
  };
  const boot = (m: THREE.Material, sole: THREE.Material, tall = 0.15, wide = 1) => {
    const shaft = loft([{ y: tall, rx: 0.052 * wide, rz: 0.058 * wide }, { y: 0.02, rx: 0.046 * wide, rz: 0.06 * wide, z: 0.012 }, { y: -0.035, rx: 0.052 * wide, rz: 0.075, z: 0.02 }, { y: -0.062, rx: 0.056 * wide, rz: 0.13, z: 0.06 }, { y: -0.078, rx: 0.052 * wide, rz: 0.13, z: 0.06 }], 12);
    const s = new THREE.BoxGeometry(0.1 * wide, 0.018, 0.245);
    for (const f of [footL, footR]) { add(shaft, m, f); add(s, sole, f, 0, -0.078, 0.06); }
  };
  /** Torso surface; `k` inflates it for outer layers, `open` fills the chest with a second layer. */
  const torsoRings = (k = 1): Ring[] => {
    const w = B.waist, c = B.chest, s = B.shoulder, b = B.bust;
    return [
      { y: -0.14, rx: 0.145 * B.hip * k, rz: 0.1 * B.hip * k },
      { y: -0.04, rx: 0.15 * B.hip * k, rz: 0.105 * B.hip * k },
      { y: 0.05, rx: 0.122 * w * k, rz: 0.088 * w * k },
      { y: 0.15, rx: 0.13 * lerp(w, c, 0.5) * k, rz: 0.094 * c * k },
      { y: 0.26, rx: 0.155 * c * k, rz: (0.104 + b * 0.022) * c * k, z: b * 0.02 },
      { y: 0.33, rx: 0.17 * c * k, rz: (0.108 + b * 0.016) * c * k, z: b * 0.012 },
      { y: 0.4, rx: 0.175 * s * k, rz: 0.086 * k },
      { y: 0.445, rx: 0.12 * s * k, rz: 0.066 * k },
      { y: 0.475, rx: 0.058 * k, rz: 0.054 * k },
    ];
  };
  const torso = (m: THREE.Material, k = 1) => add(loft(torsoRings(k), 18), m, chest);
  /** Hip block under the shirt (body group, so the waist can twist). */
  const pelvis = (m: THREE.Material) => add(loft([{ y: 0.12, rx: 0.13 * B.hip, rz: 0.1 * B.hip }, { y: 0.02, rx: 0.155 * B.hip, rz: 0.11 * B.hip }, { y: -0.08, rx: 0.15 * B.hip, rz: 0.115 * B.hip }, { y: -0.13, rx: 0.1 * B.hip, rz: 0.09 * B.hip }], 14), m, body);
  const belt = (m: THREE.Material, k = 1, y = 0.03) => add(loft([{ y: y + 0.024, rx: 0.156 * B.hip * k, rz: 0.116 * B.hip * k }, { y: y - 0.024, rx: 0.158 * B.hip * k, rz: 0.118 * B.hip * k }], 16), m, body);
  /** A strap around the chest, between two points. */
  const strap = (pts: THREE.Vector3[], m: THREE.Material, parent: THREE.Object3D, w = 0.02) => {
    const g = sweep(smoothPath(pts, 16), { width: () => w, thick: () => 0.006, side: V(0, 1, 0).cross(pts[1].clone().sub(pts[0])).normalize(), sides: 4 });
    return add(g, m, parent);
  };
  /** Coat skirt panel hanging from the waist, with cloth sway. */
  const coatPanel = (m: THREE.MeshStandardMaterial, a0: number, a1: number, len: number, flare = 1.35) => {
    const r0 = 0.165 * B.hip, rz0 = 0.125 * B.hip;
    const rings: Ring[] = [0, 0.33, 0.66, 1].map((k) => ({ y: 0.05 - len * k, rx: r0 * (1 + (flare - 1) * k), rz: rz0 * (1 + (flare - 1) * k) }));
    const g = arcLoft(rings, a0, a1, 12);
    swayByHeight(g, 0.05, 0.05 - len, 1);
    return add(g, swayMat(m), body);
  };
  const rollCuff = (m: THREE.Material, parent: THREE.Object3D, y: number, r: number) => { const t = add(new THREE.TorusGeometry(r, 0.012, 6, 14), m, parent, 0, y, 0); t.rotation.x = Math.PI / 2; return t; };

  // ---- head ----
  const face = paintFace(L.face);
  const headMat = new THREE.MeshStandardMaterial({ map: face.open, roughness: 0.46, emissive: 0xffffff, emissiveMap: face.glowMap, emissiveIntensity: 1.1 });
  const headMesh = add(headGeometry(detail), headMat, head, SKULL.x, 0.1, SKULL.z + 0.008);
  headMesh.scale.set(0.103, 0.128, 0.11);
  const hair = buildHair(HAIRSTYLES[id](), L.hair, sway, detail, HAIR_CAP[id][0], HAIR_CAP[id][1]);
  head.add(hair);
  const ear = (shape: 'fin' | 'long' | 'tuft' | 'round') => {
    for (const s of [-1, 1]) {
      const pts = shape === 'fin' ? [V(s * 0.1, 0.1, -0.005), V(s * 0.14, 0.125, -0.03), V(s * 0.175, 0.17, -0.06)]
        : shape === 'long' ? [V(s * 0.1, 0.1, -0.005), V(s * 0.155, 0.135, -0.03), V(s * 0.23, 0.2, -0.06)]
          : shape === 'tuft' ? [V(s * 0.09, 0.15, -0.01), V(s * 0.115, 0.21, -0.02), V(s * 0.12, 0.27, -0.03)]
            : [V(s * 0.1, 0.1, -0.005), V(s * 0.125, 0.11, -0.012), V(s * 0.135, 0.13, -0.02)];
      const g = sweep(smoothPath(pts, 8), { width: (t) => (shape === 'fin' ? 0.04 : 0.026) * Math.pow(1 - t, 0.6) * Math.min(1, 0.5 + t * 2), thick: () => 0.005, side: V(0, 1, 0.3), sides: 6 });
      add(g, skin, head);
      if (shape === 'fin') for (const k of [0.3, 0.6]) add(new THREE.SphereGeometry(0.0055, 6, 4), glowMat(L.glow), head, s * (0.1 + 0.075 * k), 0.105 + 0.065 * k, -0.005 - 0.055 * k, false);
    }
  };
  const horn = (s: number, m: THREE.Material, len = 0.13) => {
    const pts = [V(s * 0.062, 0.2, 0.05), V(s * 0.11, 0.26, 0.015), V(s * 0.15, 0.285 + len * 0.15, -0.05)];
    add(sweep(smoothPath(pts, 8), { width: (t) => 0.02 * (1 - t) + 0.002, thick: (t) => 0.018 * (1 - t) + 0.002, side: V(0, 0, 1), sides: 6 }), m, head);
  };

  // ---- role outfits: silhouette first ----
  const tailParts: { g: THREE.Group; k: number }[] = [];
  const extras: { halo?: THREE.Group } = {};
  switch (id) {
    case 'scientist': {
      const coat = cloth(0xb9bcb6, 0.8), under = cloth(0x1f2d3f), trou = cloth(0x2c3440), dark = leather(0x2a2522);
      torso(under); pelvis(trou); pants(trou, 1.06); boot(dark, leather(0x15120f), 0.1);
      sleeves(coat, coat, 1.22); addHands(skin);
      // lab coat: open front, scorched hem, torn on one side
      add(arcLoft(torsoRings(1.1), 0.52, 5.76, 16), coat, chest);
      coatPanel(coat.clone(), 0.5, Math.PI + 0.1, 0.72); coatPanel(coat.clone(), Math.PI - 0.1, 5.78, 0.56);
      const lapel = (s: number) => { const g = new THREE.BoxGeometry(0.052, 0.21, 0.012); const m = add(g, coat, chest, s * 0.056, 0.33, 0.102); m.rotation.z = -s * 0.2; m.rotation.x = -0.16; };
      lapel(1); lapel(-1);
      add(new THREE.BoxGeometry(0.07, 0.05, 0.012), cloth(0x3a4a64), chest, -0.08, 0.27, 0.105);
      // round glasses and the wrist device
      const fr = metal(0xc9a86a, 0.3);
      for (const s of [-1, 1]) { add(new THREE.TorusGeometry(0.039, 0.0034, 6, 22), fr, head, s * 0.044, 0.104, 0.116, false); add(new THREE.CircleGeometry(0.037, 20), new THREE.MeshStandardMaterial({ color: 0xbff0ff, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.4 }), head, s * 0.044, 0.104, 0.116, false); }
      add(new THREE.BoxGeometry(0.018, 0.004, 0.004), fr, head, 0, 0.106, 0.119, false);
      add(new THREE.BoxGeometry(0.06, 0.05, 0.034), metal(0x2a3038), foreL, 0, -0.2, 0.03);
      add(new THREE.BoxGeometry(0.044, 0.034, 0.002), glowMat(0xffa040, 1.4), foreL, 0, -0.2, 0.048, false);
      ear('fin');
      break;
    }
    case 'strong': {
      const vest = leather(0x2c3a3a), trou = cloth(0x3b3a30), blk = leather(0x1b1a1a);
      torso(skin); pelvis(trou); pants(trou, 1.2); boot(blk, leather(0x0e0d0c), 0.2, 1.22);
      sleeves(skin, skin); addHands(blk);
      add(arcLoft(torsoRings(1.05), 0.45, 5.83, 16), vest, chest);
      for (const y of [0.2, 0.28, 0.36]) strap([V(-0.08, y, 0.135), V(0, y - 0.01, 0.15), V(0.08, y, 0.135)], metal(0xa8a090), chest, 0.008);
      for (const s of [-1, 1]) { const p = add(new THREE.SphereGeometry(0.075, 14, 10), leather(0x2c3a3a, 0.4), chest, s * sw * 1.02, 0.425, 0); p.scale.set(1.05, 0.55, 1); }
      belt(metal(0x6a5a3a, 0.5), 1.05);
      const links = strap([V(-0.1, 0.42, 0.06), V(0, 0.27, 0.15), V(0.1, 0.42, 0.06)], metal(0xcfc8a8), chest, 0.004);
      links.castShadow = false;
      add(new THREE.BoxGeometry(0.04, 0.06, 0.006), metal(0xddd8b8), chest, 0, 0.25, 0.158);
      horn(1, new THREE.MeshStandardMaterial({ color: 0x302420, roughness: 0.32 })); horn(-1, new THREE.MeshStandardMaterial({ color: 0x302420, roughness: 0.32 }));
      ear('round');
      break;
    }
    case 'medic': {
      const coat = cloth(0xc4c6c4, 0.72), teal = cloth(0x1aa79a), trou = cloth(0x3a4664), gl = leather(0x20806f, 0.42);
      torso(coat, 1.02); pelvis(trou); pants(trou, 1.04); boot(leather(0xe8e4dc), leather(0x2a2a2e), 0.12, 0.92);
      sleeves(coat, coat, 1.12); addHands(gl);
      coatPanel(coat.clone(), 0.75, Math.PI * 2 - 0.75, 0.32, 1.14);
      belt(teal, 1.06, 0.06);
      // teal shoulder band and collar: no medical emblems, the band is the identity
      for (const a of [armL, armR]) rollCuff(teal, a, -0.13, 0.052 * lt * 1.15);
      add(loft([{ y: 0.53, rx: 0.07, rz: 0.066 }, { y: 0.46, rx: 0.094, rz: 0.08 }], 14, false), teal, chest);
      // cross-body satchel
      const bag = leather(0x7a4a2a);
      strap([V(0.16, 0.42, 0.0), V(0.06, 0.36, 0.135), V(-0.13, 0.08, 0.13), V(-0.19, 0.02, 0.03)], bag, chest, 0.017);
      strap([V(0.16, 0.42, 0.0), V(0.05, 0.3, -0.11), V(-0.18, 0.05, -0.08)], bag, chest, 0.017);
      add(new THREE.BoxGeometry(0.18, 0.15, 0.08), bag, chest, -0.2, -0.04, 0.02).rotation.z = 0.08;
      add(new THREE.BoxGeometry(0.15, 0.04, 0.086), leather(0x5e351b), chest, -0.2, 0.02, 0.02);
      ear('long');
      break;
    }
    case 'explorer': {
      const jk = leather(0x8b6a44, 0.68), tee = cloth(0x2d6a5c), trou = cloth(0x4c4a34), bt = leather(0x4a3220);
      torso(tee); pelvis(trou); add(thigh(1.14), trou, legL); add(thigh(1.14), trou, legR); add(shin(1), skin, shinL); add(shin(1), skin, shinR);
      boot(bt, leather(0x1d1712), 0.24, 1.05);
      sleeves(jk, jk, 1.2); addHands(leather(0x30241a));
      add(arcLoft(torsoRings(1.08), 0.5, 5.78, 16), jk, chest);
      belt(leather(0x2c2118), 1.06);
      add(new THREE.BoxGeometry(0.07, 0.09, 0.05), leather(0x3a2a1a), body, 0.15, -0.05, 0.06);
      // backpack with a bedroll
      add(new THREE.BoxGeometry(0.25, 0.34, 0.14), cloth(0x5e4a30), chest, 0, 0.26, -0.17);
      const roll = add(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 12), cloth(0x8a3a30), chest, 0, 0.47, -0.17); roll.rotation.z = Math.PI / 2;
      // long scarf with trailing ends
      const scarfM = swayMat(cloth(0xd3322c, 0.92));
      add(loft([{ y: 0.53, rx: 0.086, rz: 0.08 }, { y: 0.49, rx: 0.1, rz: 0.094 }, { y: 0.455, rx: 0.098, rz: 0.09 }], 14), cloth(0xd3322c, 0.92), chest);
      const scarf = (s: number, l: number) => {
        const g = sweep(smoothPath([V(s * 0.05, 0.47, -0.08), V(s * 0.09, 0.38, -0.135), V(s * 0.1, 0.38 - l * 0.5, -0.18), V(s * 0.08, 0.38 - l, -0.22)], 14), { width: () => 0.038, thick: () => 0.006, side: V(1, 0, 0), sides: 4 });
        swayByStrand(g, 0, 1.1);
        add(g, scarfM, chest);
      };
      scarf(1, 0.5); scarf(-1, 0.42);
      // goggles pushed up on the forehead
      const gm = leather(0x2c2118);
      add(new THREE.TorusGeometry(0.106, 0.009, 6, 26), gm, head, 0, 0.17, 0.003).rotation.x = Math.PI / 2 - 0.3;
      for (const s of [-1, 1]) { const o = add(new THREE.CylinderGeometry(0.034, 0.04, 0.026, 18), metal(0xb08a4a), head, s * 0.048, 0.214, 0.096); o.rotation.x = Math.PI / 2 - 0.4; add(new THREE.CircleGeometry(0.03, 16), new THREE.MeshStandardMaterial({ color: 0x143040, roughness: 0.08, metalness: 0.7 }), head, s * 0.048, 0.2195, 0.11, false).rotation.x = -0.4; }
      ear('tuft');
      // tail: chain of segments that follows the walk
      let parent: THREE.Object3D = body, r = 0.042;
      const tm = skin;
      for (let i = 0; i < 9; i++) {
        const g = new THREE.Group(); g.position.set(0, i === 0 ? -0.04 : -0.1, i === 0 ? -0.11 : 0);
        if (i === 0) g.rotation.x = 1.0;
        add(limb(0.115, r, r * 0.86, 0, 1, 8), tm, g);
        parent.add(g); parent = g; tailParts.push({ g, k: i / 8 }); r *= 0.87;
      }
      add(new THREE.ConeGeometry(0.03, 0.12, 8).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: 0x8c2a0a, roughness: 0.6 }), parent, 0, -0.16, 0);
      break;
    }
    case 'builder': {
      const shirt = cloth(0xc9a13a), over = cloth(0x28508f), bt = leather(0x3a2c20);
      torso(shirt); pelvis(over); pants(over, 1.22); boot(bt, leather(0x141210), 0.16, 1.2);
      sleeves(shirt, skin, 1.14); addHands(skin);
      for (const f of [foreL, foreR]) rollCuff(shirt, f, -0.02, 0.05 * lt);
      // bib overalls
      const bib = new THREE.BoxGeometry(0.24 * B.chest, 0.22, 0.03);
      add(bib, over, chest, 0, 0.17, 0.11 * B.waist).rotation.x = -0.06;
      for (const s of [-1, 1]) {
        strap([V(s * 0.09, 0.28, 0.115), V(s * 0.1, 0.43, 0.075), V(s * 0.07, 0.46, -0.04), V(s * 0.05, 0.2, -0.125)], over, chest, 0.018);
        add(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 10).rotateX(Math.PI / 2), metal(0xe2c86a), chest, s * 0.09, 0.27, 0.127);
      }
      // tool belt with wrench, hammer and pouches
      const tb = leather(0x6a4524, 0.6);
      belt(tb, 1.12);
      add(new THREE.BoxGeometry(0.1, 0.13, 0.05), tb, body, 0.17 * B.hip, -0.06, 0.05);
      add(new THREE.BoxGeometry(0.09, 0.12, 0.05), tb, body, -0.17 * B.hip, -0.06, 0.05);
      const wrench = new THREE.Group(); wrench.position.set(0.19 * B.hip, -0.06, -0.03); wrench.rotation.z = 0.15; body.add(wrench);
      add(new THREE.BoxGeometry(0.02, 0.2, 0.01), metal(0xb8bcc2), wrench, 0, -0.08, 0);
      add(new THREE.TorusGeometry(0.03, 0.012, 6, 12, 4.6), metal(0xb8bcc2), wrench, 0, 0.03, 0).rotation.z = 2.2;
      const hammer = new THREE.Group(); hammer.position.set(-0.18 * B.hip, -0.04, -0.05); body.add(hammer);
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 8), leather(0x6a4524), hammer, 0, -0.1, 0);
      add(new THREE.BoxGeometry(0.1, 0.04, 0.04), metal(0x6a6e74), hammer, 0, 0.02, 0);
      // headband, a pencil behind the ear, brow plates
      add(new THREE.CylinderGeometry(0.112, 0.116, 0.042, 22, 1, true), cloth(0xd8452e, 0.9), head, 0, 0.175, -0.005);
      add(new THREE.CylinderGeometry(0.005, 0.005, 0.14, 6).rotateZ(1.25), new THREE.MeshStandardMaterial({ color: 0xf4c430, roughness: 0.6 }), head, 0.09, 0.128, -0.03);
      ear('round');
      break;
    }
    case 'megazron': {
      // Star-black skin, an ink-blue greatcoat with gold piping, a quill that writes by itself.
      const coat = cloth(0x141a3c, 0.62), gold = metal(0xd4a94e, 0.3), dark = cloth(0x0a0b16);
      torso(dark); pelvis(dark); pants(dark, 1.04); boot(leather(0x0c0c12, 0.3), metal(0xd4a94e, 0.4), 0.26, 0.92);
      sleeves(coat, coat, 1.3); addHands(leather(0xe9e2d0, 0.32));
      add(arcLoft(torsoRings(1.1), 0.34, 5.94, 16), coat, chest);
      for (const [a0, a1] of [[0.34, Math.PI], [Math.PI, 5.94]]) coatPanel(coat.clone(), a0, a1, 0.96, 1.55);
      // tall winged collar
      for (const s of [-1, 1]) { const g = arcLoft([{ y: 0.42, rx: 0.1, rz: 0.08 }, { y: 0.66, rx: 0.17, rz: 0.13, z: -0.02 }], s > 0 ? 0.25 : Math.PI, s > 0 ? Math.PI : 2 * Math.PI - 0.25, 10); add(g, coat, chest); }
      // gold piping down the coat and around the cuffs
      for (const s of [-1, 1]) { strap([V(s * 0.06, 0.45, 0.1), V(s * 0.11, 0.2, 0.125), V(s * 0.13, 0, 0.13)], gold, chest, 0.007); }
      for (const f of [foreL, foreR]) rollCuff(gold, f, -0.235, 0.05);
      // a slim halo with a gap, turning behind his head
      const halo = new THREE.Group(); halo.position.set(0, 0.14, -0.1); head.add(halo);
      add(new THREE.TorusGeometry(0.2, 0.006, 8, 64, Math.PI * 1.72), new THREE.MeshStandardMaterial({ color: 0x221708, emissive: 0xffc36a, emissiveIntensity: 1.5 }), halo, 0, 0, 0, false);
      extras.halo = halo;
      ear('long');
      break;
    }
    case 'social': {
      const jk = new THREE.MeshStandardMaterial({ color: 0xffc81e, roughness: 0.34, side: THREE.DoubleSide, metalness: 0.12, normalMap: weaveNormal(), normalScale: new THREE.Vector2(0.2, 0.2) });
      const stripe = cloth(0xff3f9e), top = cloth(0x201038), wide = cloth(0x6b2bd0), bt = leather(0xf5f0ea, 0.32);
      torso(top); pelvis(wide);
      // wide flared trousers
      add(thigh(1.2), wide, legL); add(thigh(1.2), wide, legR);
      const flare = () => loft([{ y: 0, rx: 0.075, rz: 0.075 }, { y: -0.2, rx: 0.09, rz: 0.09 }, { y: -0.42, rx: 0.14, rz: 0.14 }], 12, false);
      for (const s of [shinL, shinR]) { const g = flare(); swayByHeight(g, -0.05, -0.42, 0.6); add(g, swayMat(wide.clone()), s); }
      boot(bt, leather(0xff3f9e), 0.05, 1);
      sleeves(jk, jk, 1.45); addHands(skin);
      // her phone is never not in her hand
      add(new THREE.BoxGeometry(0.075, 0.15, 0.009), metal(0xe6d7f0, 0.25), handR, 0, -0.1, 0.03);
      add(new THREE.BoxGeometry(0.066, 0.135, 0.001), glowMat(0x8fd8ff, 0.8), handR, 0, -0.1, 0.0355, false);
      // cropped bomber with loud colour blocks
      const rings = torsoRings(1.13).slice(3);
      add(arcLoft(rings, 0.42, 5.86, 16), jk, chest);
      for (const a of [foreL, foreR]) rollCuff(stripe, a, -0.24, 0.042);
      for (const a of [armL, armR]) { rollCuff(stripe, a, -0.06, 0.07); rollCuff(wide, a, -0.1, 0.07); }
      add(loft([{ y: 0.2, rx: 0.16 * B.chest, rz: 0.12 * B.chest }, { y: 0.165, rx: 0.15 * B.chest, rz: 0.115 * B.chest }], 14, false), stripe, chest);
      add(loft([{ y: 0.52, rx: 0.076, rz: 0.07 }, { y: 0.455, rx: 0.1, rz: 0.086 }], 14, false), stripe, chest);
      // hoops, hair stars, antennae with glowing tips
      for (const s of [-1, 1]) {
        add(new THREE.TorusGeometry(0.03, 0.003, 6, 22), metal(0xffd66a, 0.2), head, s * 0.105, 0.045, 0.0, false).rotation.y = Math.PI / 2;
        const pts = [V(s * 0.05, 0.215, 0.05), V(s * 0.085, 0.3, 0.075), V(s * 0.13, 0.335, 0.11)];
        const ag = sweep(smoothPath(pts, 8), { width: () => 0.0045, thick: () => 0.0045, side: V(1, 0, 0), sides: 5 });
        swayByStrand(ag, 0, 0.6);
        add(ag, swayMat(new THREE.MeshStandardMaterial({ color: L.face.skin, roughness: 0.5 })), head);
        add(new THREE.SphereGeometry(0.013, 10, 8), glowMat(0xffe07a, 2.6), head, s * 0.13, 0.335, 0.11, false);
      }
      ear('round');
      break;
    }
  }
  // tiling for skin marks on lofts
  marksTex.repeat.set(1, 3);

  // ---- splint (the Explorer's leg) ----
  const splint = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4334, roughness: 0.9 });
  add(new THREE.BoxGeometry(0.024, 0.46, 0.024), wood, splint, 0.08, -0.23, 0);
  add(new THREE.BoxGeometry(0.024, 0.46, 0.024), wood, splint, -0.08, -0.23, 0);
  for (const y of [-0.1, -0.34]) add(new THREE.TorusGeometry(0.086, 0.01, 4, 10), new THREE.MeshStandardMaterial({ color: 0x2c4a2a }), splint, 0, y, 0).rotation.x = Math.PI / 2;
  splint.visible = false;
  shinR.add(splint);

  // ---- name tag ----
  const tagCanvas = document.createElement('canvas');
  tagCanvas.width = 512; tagCanvas.height = 96;
  const tagTex = new THREE.CanvasTexture(tagCanvas); tagTex.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, transparent: true, depthWrite: false, fog: false }));
  tag.scale.set(1.6, 0.3, 1); tag.position.y = 2.25 * B.height; tag.renderOrder = 5; tag.visible = false;
  root.add(tag);
  let tagText = '';
  const setName = (name: string, role: string) => {
    const key = `${name}|${role}`;
    if (key === tagText) return;
    tagText = key;
    const g = tagCanvas.getContext('2d')!;
    g.clearRect(0, 0, 512, 96);
    g.fillStyle = 'rgba(8,16,24,0.62)'; g.beginPath(); g.roundRect(56, 6, 400, 84, 10); g.fill();
    g.fillStyle = '#ffd7a0'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = "600 34px 'Exo 2', 'Noto Sans Devanagari', 'Noto Naskh Arabic', sans-serif"; g.fillText(name, 256, 36, 380);
    g.fillStyle = '#8fd8e6'; g.font = "22px 'Exo 2', 'Noto Sans Devanagari', 'Noto Naskh Arabic', sans-serif"; g.fillText(role, 256, 70, 380);
    tagTex.needsUpdate = true;
  };

  // ---- animation state ----
  const cur = { aLx: 0, aLy: 0, aLz: 0, aRx: 0, aRy: 0, aRz: 0, eL: 0.2, eR: 0.2, lL: 0, lR: 0, kL: 0, kR: 0, fL: 0, fR: 0, sp: 0, spZ: 0, spY: 0, hx: 0, hy: 0, hz: 0, y: 0, by: 0 };
  const lastPos = new THREE.Vector3(), lastVel = new THREE.Vector3(), swing = new THREE.Vector3(), swingV = new THREE.Vector3(), tmp = new THREE.Vector3();
  let blinkAt = 2 + Math.random() * 3, blinkT = 0, speak = 0, speakPhase = 0;
  let inited = false;
  const lookAt = { y: 0, x: 0 };
  let curMap: THREE.Texture = face.open;
  const setFaceMap = (m: THREE.Texture, g: THREE.Texture) => { if (curMap !== m) { curMap = m; headMat.map = m; headMat.emissiveMap = g; headMat.needsUpdate = false; } };

  function animate(kind: CrewPose, phase: number, amount: number, t: number, dt: number) {
    const s = Math.sin(phase), c = Math.cos(phase);
    const k = amount * P.stride;
    const stance = P.stance;
    // defaults = relaxed standing in this character's posture
    const T = { aLx: 0.02, aLy: 0, aLz: stance + 0.08, aRx: 0.02, aRy: 0, aRz: -stance - 0.08, eL: 0.22, eR: 0.22, lL: 0, lR: 0, kL: 0.02, kR: 0.02, fL: 0, fR: 0, sp: P.stoop + amount * P.lean, spZ: 0, spY: 0, hx: -P.stoop * 0.6, hy: 0, hz: 0, y: 0, by: 0 };
    const breathe = Math.sin(t * 1.5) * 0.008;
    // walking
    if (amount > 0.02) {
      T.lL = -s * 0.62 * k; T.lR = s * 0.62 * k;
      T.kL = 0.1 + Math.max(0, Math.sin(phase + 1.2)) * 0.95 * k; T.kR = 0.1 + Math.max(0, Math.sin(phase + 1.2 + Math.PI)) * 0.95 * k;
      T.fL = 0.3 * k * Math.max(0, -s); T.fR = 0.3 * k * Math.max(0, s);
      T.aLx = s * 0.78 * P.armSwing * amount; T.aRx = -s * 0.78 * P.armSwing * amount;
      T.eL = 0.3 + Math.max(0, -s) * 0.5 * amount; T.eR = 0.3 + Math.max(0, s) * 0.5 * amount;
      T.y = Math.abs(c) * P.bounce * amount - 0.015 * amount;
      T.spY = s * P.shoulderSway * amount * 1.4;
      T.spZ = -s * P.hipSway * amount;
      body.rotation.z = s * P.hipSway * amount * 0.8;
      body.rotation.y = -s * P.shoulderSway * amount * 0.6;
    } else { body.rotation.z *= 0.9; body.rotation.y *= 0.9; }
    // personality idles
    const idleK = 1 - clamp(amount * 4, 0, 1);
    if (kind === 'idle' && idleK > 0.5) {
      const w = t * 0.7;
      switch (P.idle) {
        case 'fidget': // adjusts the glasses every few seconds, otherwise thinks
          if (Math.sin(t * 0.55) > 0.82) { T.aRx = -1.2; T.aRy = 0.6; T.aRz = 0.05; T.eR = 2.3; T.hx = 0.08; } else { T.aLx = -0.5; T.eL = 1.35; T.aLz = 0.35; T.hy = Math.sin(w) * 0.2; }
          break;
        case 'folded': T.aLx = -0.32; T.aRx = -0.42; T.eL = 2.0; T.eR = 2.0; T.aLz = 0.16; T.aRz = -0.16; T.aLy = -1.1; T.aRy = 1.1; T.hy = Math.sin(t * 0.3) * 0.3; T.lL = -0.04; T.lR = 0.04; T.spZ = 0.03; break;
        case 'clasped': T.aLx = -0.1; T.aRx = -0.1; T.aLz = 0.06; T.aRz = -0.06; T.aLy = -0.75; T.aRy = 0.75; T.eL = 1.0; T.eR = 1.0; T.hz = Math.sin(t * 0.4) * 0.04; break;
        case 'scout': T.aRx = Math.sin(t * 0.45) > 0.5 ? -2.3 : 0; T.eR = Math.sin(t * 0.45) > 0.5 ? 1.6 : 0.3; T.hy = Math.sin(t * 0.6) * 0.65; T.spZ = Math.sin(t * 0.8) * 0.03; T.by = Math.sin(t * 1.6) * 0.012; break;
        case 'shrug': T.aRz = -0.5; T.aRy = 1.0; T.eR = 1.7; T.aRx = 0.1; T.aLx = -0.1; T.spY = Math.sin(t * 0.5) * 0.1; break;
        case 'pose': T.aLz = 0.62; T.aLx = 0.15; T.aLy = -1.2; T.eL = 1.75; T.spZ = -0.07 + Math.sin(t * 1.1) * 0.03; T.lR = -0.12; T.kR = 0.25; T.hz = Math.sin(t * 1.1) * 0.08; T.hy = Math.sin(t * 0.8) * 0.2; T.aRx = -0.1 + Math.sin(t * 2.2) * 0.1; break;
      }
    }
    // story poses
    switch (kind) {
      case 'wave': T.aRx = -2.8; T.aRz = -0.3 + Math.sin(t * 9) * 0.35; T.eR = 0.3; break;
      case 'sit': T.lL = -1.4; T.lR = -1.1; T.kL = 1.3; T.kR = 1.1; T.fL = -0.2; T.fR = -0.2; T.aLx = -0.5; T.aRx = -0.6; T.eL = 1; T.eR = 1; T.sp = 0.2; T.y = -0.66; break;
      case 'injured': T.lL = -1.45; T.lR = -1.55; T.kL = 1.1; T.kR = 0.12; T.aLx = -0.9; T.aRx = 0.4; T.eL = 1.1; T.aRz = -0.35; T.sp = -0.14; T.hx = 0.2 + Math.sin(t * 0.6) * 0.05; T.y = -0.68; break;
      case 'lie': T.lL = -0.04; T.lR = 0.05; T.aLz = 0.42; T.aRz = -0.2; T.eL = 0.4; T.eR = 0.5; T.y = 0; break;
      case 'point': T.aRx = -1.5; T.aRz = -0.1; T.eR = 0.12; T.sp += 0.06; T.hy = -0.06; break;
      case 'cheer': T.aLx = -2.8; T.aRx = -2.8; T.aLz = 0.2; T.aRz = -0.2; T.eL = 0.4 + Math.sin(t * 10) * 0.25; T.eR = 0.4 + Math.cos(t * 10) * 0.25; T.y = Math.abs(Math.sin(t * 6)) * 0.08; break;
      case 'facepalm': T.aRx = -1.7; T.aRz = 0.28; T.eR = 2.3; T.hx = 0.4; T.sp += 0.08; T.hy = Math.sin(t * 1.6) * 0.09; break;
      case 'selfie': T.aRx = -2.1; T.aRz = -0.55; T.eR = 0.55; T.hz = 0.2; T.hy = -0.35; T.aLz = 0.6; T.aLy = -1.2; T.eL = 1.75; T.spZ = 0.08; break;
      case 'shout': T.aLx = -0.9; T.aRx = -0.9; T.aLz = 0.35; T.aRz = -0.35; T.eL = 1.2; T.eR = 1.2; T.sp += 0.12; T.hx = -0.14; break;
      case 'present': T.aLx = -0.9; T.aRx = -0.9; T.aLz = 0.55; T.aRz = -0.55; T.eL = 0.5; T.eR = 0.5; T.hx = -0.05; T.sp -= 0.04; break;
      case 'write': T.aRx = -0.85; T.aRy = 0.5; T.eR = 1.1; T.aLx = -0.45; T.eL = 0.8; T.hx = 0.34; T.sp += 0.14; break;
      case 'argue': T.aRx = -1.15 + Math.sin(t * 6) * 0.2; T.eR = 0.75 + Math.sin(t * 6) * 0.3; T.aLz = 0.6; T.aLy = -1.2; T.eL = 1.75; T.hz = Math.sin(t * 3) * 0.08; T.sp += 0.05; break;
    }
    const r = 1 - Math.exp(-dt * (amount > 0.02 ? 22 : 8));
    for (const key in T) { const q = key as keyof typeof T; cur[q] += (T[q] - cur[q]) * r; }
    armL.rotation.set(cur.aLx, cur.aLy, cur.aLz, 'ZYX'); armR.rotation.set(cur.aRx, cur.aRy, cur.aRz, 'ZYX');
    foreL.rotation.x = -cur.eL; foreR.rotation.x = -cur.eR;
    legL.rotation.x = cur.lL; legR.rotation.x = cur.lR;
    shinL.rotation.x = cur.kL; shinR.rotation.x = cur.kR;
    footL.rotation.x = cur.fL - (cur.lL + cur.kL) * (kind === 'sit' || kind === 'injured' ? 0 : 0.5); footR.rotation.x = cur.fR - (cur.lR + cur.kR) * (kind === 'sit' || kind === 'injured' ? 0 : 0.5);
    chest.rotation.set(cur.sp + breathe, cur.spY, cur.spZ);
    chest.scale.set(1 + breathe * 0.6, 1 + breathe * 0.5, 1 + breathe);
    head.rotation.set(cur.hx + lookAt.x, cur.hy + lookAt.y + (kind === 'idle' ? Math.sin(t * 0.37) * 0.1 : 0), cur.hz);
    body.position.y = hipY + cur.y + cur.by - clamp(cur.kL + cur.kR, 0, 1) * 0.012 + breathe * 0.2;

    // secondary motion: spring on the body's world velocity, in body space
    tmp.setFromMatrixPosition(root.matrixWorld);
    if (!inited) { lastPos.copy(tmp); inited = true; }
    const vel = tmp.clone().sub(lastPos).divideScalar(Math.max(dt, 1 / 120));
    lastPos.copy(tmp);
    if (vel.length() > 30) vel.set(0, 0, 0);
    const yaw = root.rotation.y;
    const cs = Math.cos(-yaw), sn = Math.sin(-yaw);
    const lx = vel.x * cs + vel.z * sn, lz = -vel.x * sn + vel.z * cs;
    const target = tmp.set(-lx * 0.045, 0.0 - Math.abs(c) * 0.012 * amount + vel.y * -0.02, -lz * 0.045);
    target.x += Math.sin(t * 0.8) * 0.016; target.z += Math.cos(t * 0.63) * 0.012; // breeze
    swingV.addScaledVector(tmp.sub(swing), 90 * dt); swingV.multiplyScalar(Math.exp(-dt * 9));
    swing.addScaledVector(swingV, dt);
    swing.clampLength(0, 0.34);
    sway.uSwing.value.copy(swing);
    sway.uTime.value = t;
    sway.uFlutter.value = 0.008 + amount * 0.016;
    lastVel.copy(vel);

    if (tailParts.length) {
      tailParts.forEach(({ g, k: q }, i) => {
        const wag = Math.sin(t * 1.9 - q * 3.4) * (0.2 + amount * 0.14);
        g.rotation.z = wag * (0.4 + q);
        if (i) g.rotation.x = -0.18 - amount * 0.1 + Math.sin(t * 1.3 - q * 2) * 0.05;
      });
    }
    if (extras.halo) extras.halo.rotation.z = t * 0.4;
    // face
    if (speak > 0) { speakPhase += dt * 11; speak = Math.max(0, speak - dt); }
    blinkAt -= dt;
    if (blinkAt <= 0) { blinkT = 0.13; blinkAt = 2 + Math.random() * 4; }
    if (blinkT > 0) { blinkT -= dt; setFaceMap(face.blink, face.glowBlink); }
    else if (speak > 0.05 && Math.sin(speakPhase) > 0.1) setFaceMap(face.talk, face.glowMap);
    else setFaceMap(face.open, face.glowMap);
  }

  return {
    id, root, body, chest, head, armL, armR, legL, legR, handL, handR, fig, look: L,
    animate,
    setName,
    setSplint(on: boolean) { splint.visible = on; },
    setTagVisible(v: number) { (tag.material as THREE.SpriteMaterial).opacity = v; tag.visible = v > 0.02; },
    /** Mouth moves while > 0 (seconds of speech left). */
    say(seconds: number) { speak = Math.max(speak, seconds); },
    /** Head offset for looking at something (radians). */
    look2(y: number, x: number) { lookAt.y = y; lookAt.x = x; },
  };
}

export type Character = ReturnType<typeof createCharacter>;
