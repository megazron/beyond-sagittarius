import * as THREE from 'three';
import { clamp, lerp } from '../core/noise';

export type CrewPose = 'idle' | 'walk' | 'sit' | 'injured' | 'wave';

export interface CrewLook {
  suit: number;
  accent: number;
  skin: number;
  hair: number;
  hairStyle: 'ponytail' | 'short' | 'bun';
}

/** Default looks for the five friends (the Scientist is the player's astronaut). */
export const CREW_LOOKS: Record<string, CrewLook> = {
  strong: { suit: 0x56606e, accent: 0xe0453a, skin: 0xd7a587, hair: 0x2b2420, hairStyle: 'short' },
  medic: { suit: 0xe7ecef, accent: 0x3fd3a0, skin: 0xb98463, hair: 0x1a1414, hairStyle: 'bun' },
  explorer: { suit: 0x8f9a66, accent: 0xffb13a, skin: 0xa8714f, hair: 0x3a2216, hairStyle: 'ponytail' },
  builder: { suit: 0x3f5f86, accent: 0xffd23a, skin: 0xe2b896, hair: 0x101014, hairStyle: 'short' },
  social: { suit: 0x7a4c86, accent: 0x6fe3ff, skin: 0x8f5b3f, hair: 0x120c0c, hairStyle: 'bun' },
};

/**
 * Stylised low-poly crewmate (~1.75 m): flat-shaded suit with a role colour,
 * helmet clipped to the belt, visible face and hair, name tag sprite.
 */
export function createCrewFigure(look: CrewLook) {
  const flat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true, ...extra });
  const suit = flat(look.suit);
  const suitDark = flat(0x23262d, { metalness: 0.25 });
  const accent = flat(look.accent, { emissive: look.accent, emissiveIntensity: 0.25 });
  const skin = flat(look.skin, { roughness: 0.8 });
  const hair = flat(look.hair, { roughness: 0.9 });
  const eye = new THREE.MeshBasicMaterial({ color: 0x0b0b10 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x0a1222, metalness: 0.9, roughness: 0.12, flatShading: true, emissive: 0x0b2244 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.92;
  root.add(body);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
  };

  // torso: tapered prism + chest plate + role stripe
  const torso = mesh(new THREE.CylinderGeometry(0.21, 0.17, 0.56, 7), suit, body, 0, 0.32, 0);
  torso.scale.z = 0.72;
  mesh(new THREE.BoxGeometry(0.3, 0.16, 0.06), suitDark, body, 0, 0.44, 0.15);
  mesh(new THREE.BoxGeometry(0.31, 0.04, 0.065), accent, body, 0, 0.5, 0.155);
  mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.07, 7), suitDark, body, 0, 0.05, 0).scale.z = 0.75;
  mesh(new THREE.BoxGeometry(0.3, 0.36, 0.14), suit, body, 0, 0.36, -0.2);
  mesh(new THREE.BoxGeometry(0.31, 0.05, 0.15), accent, body, 0, 0.46, -0.2);
  // helmet clipped to the hip
  const helm = mesh(new THREE.IcosahedronGeometry(0.15, 1), suit, body, 0.24, 0.05, -0.06);
  mesh(new THREE.SphereGeometry(0.125, 8, 6, 0, Math.PI), visor, helm, 0, 0, 0.04).rotation.y = Math.PI / 2;

  // head
  const head = new THREE.Group();
  head.position.y = 0.76;
  body.add(head);
  mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 6), skin, head, 0, -0.1, 0);
  mesh(new THREE.TorusGeometry(0.1, 0.035, 4, 8), suitDark, head, 0, -0.14, 0).rotation.x = Math.PI / 2;
  const face = mesh(new THREE.IcosahedronGeometry(0.13, 1), skin, head, 0, 0.04, 0.01);
  face.scale.set(0.92, 1.08, 0.98);
  for (const sx of [-0.045, 0.045]) mesh(new THREE.BoxGeometry(0.025, 0.03, 0.01), eye, head, sx, 0.06, 0.125);
  mesh(new THREE.ConeGeometry(0.02, 0.05, 3), skin, head, 0, 0.02, 0.135).rotation.x = Math.PI / 2;
  // hair: a cap over the crown and back of the head, leaving the face clear
  const cap = mesh(new THREE.IcosahedronGeometry(0.14, 1), hair, head, 0, 0.1, -0.045);
  cap.scale.set(1.0, 0.78, 0.96);
  const fringe = mesh(new THREE.BoxGeometry(0.2, 0.05, 0.06), hair, head, 0, 0.15, 0.08);
  fringe.rotation.x = 0.35;
  if (look.hairStyle === 'ponytail') {
    const tail = mesh(new THREE.ConeGeometry(0.05, 0.3, 5), hair, head, 0, 0.0, -0.16);
    tail.rotation.x = -2.6;
  } else if (look.hairStyle === 'bun') {
    mesh(new THREE.IcosahedronGeometry(0.065, 0), hair, head, 0, 0.17, -0.1);
  }

  // limbs (pivot groups at shoulder / hip)
  const limb = (r: number, len: number, mat: THREE.Material, x: number, y: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    const upper = mesh(new THREE.CylinderGeometry(r, r * 0.85, len, 6), mat, g, 0, -len / 2, 0);
    body.add(g);
    return { g, upper };
  };
  const armL = limb(0.06, 0.52, suit, -0.27, 0.58);
  const armR = limb(0.06, 0.52, suit, 0.27, 0.58);
  for (const a of [armL, armR]) {
    mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.05, 6), accent, a.g, 0, -0.42, 0);
    mesh(new THREE.IcosahedronGeometry(0.06, 0), suitDark, a.g, 0, -0.56, 0);
  }
  const legL = limb(0.08, 0.6, suit, -0.11, 0.02);
  const legR = limb(0.08, 0.6, suit, 0.11, 0.02);
  for (const l of [legL, legR]) mesh(new THREE.BoxGeometry(0.14, 0.11, 0.26), suitDark, l.g, 0, -0.84, 0.04);
  // a splint appears on the right leg once applied
  const splint = new THREE.Group();
  const wood = flat(0x5a4334);
  mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03), wood, splint, 0.09, -0.4, 0);
  mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03), wood, splint, -0.09, -0.4, 0);
  for (const y of [-0.22, -0.55]) mesh(new THREE.TorusGeometry(0.1, 0.012, 3, 8), flat(0x2c4a2a), splint, 0, y, 0).rotation.x = Math.PI / 2;
  splint.visible = false;
  legR.g.add(splint);

  // name tag
  const tagCanvas = document.createElement('canvas');
  tagCanvas.width = 512; tagCanvas.height = 96;
  const tagTex = new THREE.CanvasTexture(tagCanvas);
  tagTex.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, transparent: true, depthWrite: false, fog: false }));
  tag.scale.set(1.6, 0.3, 1);
  tag.position.y = 2.15;
  tag.renderOrder = 5;
  root.add(tag);
  let tagText = '';
  const setName = (name: string, role: string) => {
    const key = `${name}|${role}`;
    if (key === tagText) return;
    tagText = key;
    const g = tagCanvas.getContext('2d')!;
    g.clearRect(0, 0, 512, 96);
    g.fillStyle = 'rgba(8,16,24,0.62)';
    g.beginPath(); g.roundRect(56, 6, 400, 84, 10); g.fill();
    g.fillStyle = '#ffd7a0';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = "600 34px 'Exo 2', 'Noto Sans Devanagari', 'Noto Naskh Arabic', sans-serif";
    g.fillText(name, 256, 36, 380);
    g.fillStyle = '#8fd8e6';
    g.font = "22px 'Exo 2', 'Noto Sans Devanagari', 'Noto Naskh Arabic', sans-serif";
    g.fillText(role, 256, 70, 380);
    tagTex.needsUpdate = true;
  };

  let wavePhase = 0;
  const pose = { kind: 'idle' as CrewPose, blend: 0 };

  return {
    root,
    setName,
    setSplint(on: boolean) { splint.visible = on; },
    setTagVisible(v: number) {
      (tag.material as THREE.SpriteMaterial).opacity = v;
      tag.visible = v > 0.02;
    },
    /** phase: walk-cycle phase, amount: 0..1 speed, t: seconds. */
    animate(kind: CrewPose, phase: number, amount: number, t: number, dt: number) {
      pose.kind = kind;
      const sitting = kind === 'sit' || kind === 'injured';
      pose.blend = clamp(pose.blend + (sitting ? dt : -dt) * 2.5, 0, 1);
      const sb = pose.blend;
      const s = Math.sin(phase) * amount;
      const breathe = Math.sin(t * 1.7) * 0.012;
      // standing / walking
      let lL = s * 0.75, lR = -s * 0.75, aL = -s * 0.6, aR = s * 0.6, aLz = 0.1, aRz = -0.1;
      let by = 0.92 + Math.abs(Math.cos(phase)) * 0.045 * amount + breathe;
      let lean = amount * 0.1;
      if (kind === 'wave') {
        wavePhase += dt;
        aR = -2.7; aRz = -0.3 + Math.sin(wavePhase * 9) * 0.35;
      }
      // sitting on the ground (legs forward) / injured (one leg out, hand on knee)
      const sitL = kind === 'injured' ? -1.45 : -1.35, sitR = kind === 'injured' ? -1.55 : -1.1;
      lL = lerp(lL, sitL, sb); lR = lerp(lR, sitR, sb);
      aL = lerp(aL, kind === 'injured' ? -0.9 : -0.55, sb); aR = lerp(aR, kind === 'injured' ? -0.4 : -0.7, sb);
      aLz = lerp(aLz, 0.25, sb); aRz = lerp(aRz, -0.2, sb);
      by = lerp(by, 0.2 + breathe, sb);
      lean = lerp(lean, kind === 'injured' ? -0.18 : 0.12, sb);
      legL.g.rotation.x = lL; legR.g.rotation.x = lR;
      armL.g.rotation.x = aL; armR.g.rotation.x = aR;
      armL.g.rotation.z = aLz; armR.g.rotation.z = aRz;
      body.position.y = by;
      body.rotation.x = lean;
      head.rotation.y = Math.sin(t * 0.37) * 0.35 * (1 - amount);
      head.rotation.x = kind === 'injured' ? 0.2 + Math.sin(t * 0.6) * 0.05 : Math.sin(t * 0.23) * 0.06;
    },
  };
}

export type CrewFigure = ReturnType<typeof createCrewFigure>;
