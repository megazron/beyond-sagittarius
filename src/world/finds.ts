import * as THREE from 'three';

/**
 * Small props for the level-end beats and the things off the path (game/mysteryplay.ts places them). Plain shapes from
 * a handful of shared materials, so a prop costs no new shader program after the first: no lights are ever added (a light
 * added in play recompiles every material in the scene).
 */
const M: Record<string, THREE.Material> = {};
function mat(k: string): THREE.Material {
  if (M[k]) return M[k];
  const c: Record<string, [number, number, number?]> = {
    stone: [0x8a857c, 0.95], pale: [0xd8d2c4, 0.85], dark: [0x2a2520, 1], wood: [0x6b4c33, 0.9], bark: [0x4a3a2c, 1], sap: [0xe8dcc0, 0.6],
    fruit: [0x6b3a22, 0.7], cord: [0xb89a6a, 0.9], metal: [0x9aa3ab, 0.4, 0.8], paint: [0xd8c040, 0.6, 0.2], blue: [0x3a5a8c, 0.9],
    clay: [0xa4532e, 0.85], ash: [0x3b3733, 1], fur: [0x5b4a3a, 1], glass: [0x5fb07a, 0.15], card: [0xe8e0cc, 0.8], ink: [0x2a2a3a, 0.8],
    soil: [0x4d3b2a, 1], grass: [0x5d6b35, 1],
  };
  const [color, roughness, metalness] = c[k] ?? [0x888888, 0.9];
  return (M[k] = new THREE.MeshStandardMaterial({ color, roughness, metalness: metalness ?? 0 }));
}
/** A glowing point (no light): a fire or a lamp seen far off. */
const GLOW: Record<string, THREE.Material> = {};
function glow(c: number) { return (GLOW[c] ??= new THREE.MeshBasicMaterial({ color: c, fog: false, toneMapped: false })); }

/** Unfogged pale for a shape far up in the sky (fog washed it out to nothing, GPU take r1). */
let SKY: THREE.Material | null = null;
const sky = () => (SKY ??= new THREE.MeshBasicMaterial({ color: 0xe9ecf2, fog: false }));
const box = (w: number, h: number, d: number, m: string) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(m));
const ball = (r: number, m: string, seg = 10) => new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 3)), mat(m));

/** Every prop kind buildProp knows (tools/mystery_test.ts checks the sealed data names only these). */
export const PROP_KINDS = ['smallstack', 'chip', 'tallform', 'glowpoint', 'glowfield', 'trunkmarks', 'dotrings', 'panelA', 'panelB', 'stakecord', 'rockmark', 'rockmark2', 'bankcut', 'skyform', 'groundline', 'cardA', 'cardB', 'clothsq', 'ringstone', 'thornfur', 'smalltag', 'bankbead', 'notchstick'];

/** Builds a named prop at the origin (its foot at y 0). `n` and the like come from the sealed data where needed. */
export function buildProp(kind: string): THREE.Group {
  const g = new THREE.Group(); g.name = `my.${kind}`;
  const add = (o: THREE.Object3D, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); g.add(o); return o; };
  switch (kind) {
    case 'smallstack': {
      add(box(0.3, 0.03, 0.24, 'stone'), 0, 0.015, 0);
      const at = [[-0.06, 0, -0.03], [0, 0, -0.03], [0.06, 0, -0.03], [-0.03, 0, 0.03], [0.03, 0, 0.03], [-0.03, 1, 0], [0.03, 1, 0]];
      for (const [x, l, z] of at) { const p = ball(0.022, 'fruit', 8); p.scale.set(1, 0.8, 1.25); add(p, x, 0.05 + l * 0.036, z + (l ? 0.0 : 0)); }
      break;
    }
    case 'chip': {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.012, 5), mat('stone')); f.scale.set(1.3, 1, 0.9); add(f, 0, 0.01, 0);
      const skin = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.004, 5), mat('pale')); add(skin, -0.01, 0.018, 0.005);
      add(ball(0.012, 'stone', 6), 0.04, 0.012, 0);
      break;
    }
    case 'tallform': {
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 2.6, 4, 8), mat('dark')); add(b, 0, 1.9, 0);
      const h = ball(0.42, 'dark', 8); h.scale.set(0.8, 1.2, 1.1); add(h, 0, 3.6, 0.25);
      break;
    }
    case 'glowpoint': { const p = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), glow(0xffc070)); add(p, 0, 0, 0); break; }
    case 'glowfield': {
      for (let i = 0; i < 12; i++) add(new THREE.Mesh(new THREE.SphereGeometry(i === 11 ? 0.9 : 0.55, 8, 6), glow(0xffb060)));
      break;
    }
    case 'trunkmarks': {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.27, 3.4, 10), mat('bark')), 0, 1.7, 0);
      for (let i = 0; i < 3; i++) { const s = box(0.03, 0.42, 0.02, 'sap'); s.rotation.z = 0.18; add(s, -0.07 + i * 0.07, 2.25 - i * 0.02, 0.215); }
      break;
    }
    case 'dotrings': {
      for (let r = 0; r < 3; r++) {
        const R = 3.4 + r * 0.8, n = 16 + r * 4;
        for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + r * 0.3, p = new THREE.Mesh(new THREE.CircleGeometry(0.13, 7), mat('sap')); p.rotation.x = -Math.PI / 2; p.scale.set(1, 1.4, 1); add(p, Math.cos(a) * R, 0.03, Math.sin(a) * R); }
      }
      break;
    }
    case 'panelA': case 'panelB': {
      const p = box(0.9, 0.04, 0.6, 'metal'); p.rotation.x = -0.35; add(p, 0, 0.2, 0);
      for (let i = 0; i < 6; i++) add(ball(0.014, 'metal', 6), -0.38 + (i % 3) * 0.38, 0.235 - (i < 3 ? 0.1 : -0.09) * 0.35, i < 3 ? -0.24 : 0.24);
      const n = box(kind === 'panelB' ? 0.34 : 0.26, 0.005, 0.08, kind === 'panelB' ? 'paint' : 'ink'); n.rotation.x = -0.35; add(n, 0.05, 0.227, 0.02);
      break;
    }
    case 'stakecord': {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.5, 6), mat('wood')), 0, 0.25, 0);
      const k = new THREE.Mesh(new THREE.TorusKnotGeometry(0.035, 0.008, 40, 6, 2, 3), mat('cord')); k.rotation.x = Math.PI / 2; add(k, 0, 0.36, 0.02);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.6, 5), mat('cord')); c.rotation.z = Math.PI / 2.4; add(c, 0.25, 0.25, 0.02);
      break;
    }
    case 'rockmark': case 'rockmark2': {
      const s = kind === 'rockmark2' ? 0.55 : 1;
      add(box(1.2, 1.0, 0.25, 'stone'), 0, 0.5, -0.13);
      const palm = new THREE.Mesh(new THREE.CircleGeometry(0.06 * s, 10), mat('clay')); add(palm, 0, 0.62, 0.002);
      for (let i = 0; i < 5; i++) { const f = box(0.022 * s, 0.075 * s, 0.002, 'clay'); const a = -0.9 + i * 0.42; f.rotation.z = a * 0.5; add(f, Math.sin(a * 0.55) * 0.08 * s - (i === 0 ? 0.03 * s : 0), 0.62 + Math.cos(a * 0.4) * 0.09 * s - (i === 0 ? 0.04 * s : 0), 0.003); }
      break;
    }
    case 'bankcut': {
      add(box(1.6, 0.9, 0.3, 'soil'), 0, 0.45, -0.15);
      add(box(1.62, 0.06, 0.02, 'ash'), 0, 0.42, 0.005);
      for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 10, 1, true, 0, 1.6), mat('clay')); (c.material as THREE.Material).side = THREE.DoubleSide; c.rotation.x = Math.PI / 2; add(c, -0.6 + i * 0.3, 0.42 + (i % 2) * 0.02, 0.01); }
      break;
    }
    case 'skyform': {
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(6, 60, 4, 12), sky()); b.rotation.z = Math.PI / 2; add(b);
      const r = new THREE.Mesh(new THREE.TorusGeometry(10, 1.2, 6, 20), sky()); r.rotation.y = Math.PI / 2; add(r, -14, 0, 0);
      break;
    }
    case 'groundline': {
      for (let i = 0; i < 2; i++) { const l = box(0.5, 0.12, 40, i ? 'grass' : 'soil'); add(l, i * 0.55, 0.06 - i * 0.03, 20); }
      break;
    }
    case 'cardA': case 'cardB': {
      add(box(kind === 'cardA' ? 0.16 : 0.07, 0.003, kind === 'cardA' ? 0.07 : 0.04, 'card'), 0, 0.002, 0);
      const m = new THREE.Mesh(new THREE.RingGeometry(0.008, 0.013, 6), mat('ink')); m.rotation.x = -Math.PI / 2; add(m, kind === 'cardA' ? 0.05 : 0.015, 0.005, 0);
      break;
    }
    case 'clothsq': { add(box(0.3, 0.02, 0.3, 'blue'), 0, 0.03, 0); const s = ball(0.09, 'stone', 7); s.scale.y = 0.6; add(s, 0.05, 0.08, 0.03); break; }
    case 'ringstone': { const c = ball(0.11, 'stone', 12); c.scale.y = 0.55; add(c, 0, 0.06, 0); const r = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 4, 16), mat('pale')); r.rotation.x = Math.PI / 2; add(r, 0, 0.12, 0); break; }
    case 'thornfur': { add(new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.9, 4), mat('wood')), 0, 0.45, 0); const f = ball(0.06, 'fur', 7); f.scale.set(1.4, 0.7, 1); add(f, 0.02, 0.62, 0); break; }
    case 'smalltag': { add(box(0.07, 0.003, 0.04, 'metal'), 0, 0.01, 0); add(box(0.05, 0.004, 0.006, 'ink'), 0, 0.013, 0.005); add(box(0.5, 0.03, 0.4, 'metal'), 0.1, 0.0, -0.2); break; }
    case 'bankbead': { add(box(0.3, 0.06, 0.3, 'soil'), 0, 0.03, 0); add(new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.007, 6, 10), mat('glass')), 0, 0.068, 0); break; }
    case 'notchstick': { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6), mat('wood')); s.rotation.z = Math.PI / 2; add(s, 0, 0.02, 0); for (let i = 0; i < 10; i++) add(box(0.003, 0.026, 0.026, 'dark'), -0.13 + i * 0.024 + Math.floor(i / 5) * 0.03, 0.02, 0); break; }
    default: add(ball(0.05, 'pale'));
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = kind !== 'skyform' && kind !== 'glowpoint' && kind !== 'glowfield'; o.receiveShadow = true; } });
  return g;
}

/** A soft glint over a thing off the path (seen within a few metres): a small additive sprite that breathes. */
let glintTex: THREE.Texture | null = null;
export function buildGlint(): THREE.Sprite {
  if (!glintTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d')!, g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,250,235,1)'); g.addColorStop(0.25, 'rgba(255,240,210,.5)'); g.addColorStop(1, 'rgba(255,240,210,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    glintTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  s.scale.setScalar(0.35); s.name = 'my.glint';
  return s;
}
