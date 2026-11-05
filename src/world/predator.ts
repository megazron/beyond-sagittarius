import * as THREE from 'three';

/**
 * The Duskhound: a lean, six-eyed night predator about the size of a wolf,
 * with bioluminescent spines. Visual only; behaviour lives in game/story.ts.
 */
export function createHound() {
  const flat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra });
  const skin = flat(0x1d1826);
  const belly = flat(0x3a2f45);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.8, 0.6) });
  const spineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.5, 2.8) });
  const tooth = flat(0xd9d2c4);

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.72;
  root.add(body);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o;
  };
  const chest = mesh(new THREE.IcosahedronGeometry(0.42, 1), skin, body, 0, 0.05, 0.35);
  chest.scale.set(0.85, 0.95, 1.1);
  const hips = mesh(new THREE.IcosahedronGeometry(0.34, 1), skin, body, 0, 0, -0.45);
  hips.scale.set(0.8, 0.85, 1.15);
  mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.8, 6), belly, body, 0, -0.05, -0.05).rotation.x = Math.PI / 2;
  // head + jaw
  const head = new THREE.Group();
  head.position.set(0, 0.18, 0.82);
  body.add(head);
  const skull = mesh(new THREE.ConeGeometry(0.2, 0.6, 6), skin, head, 0, 0, 0.22);
  skull.rotation.x = Math.PI / 2;
  skull.scale.set(1, 1, 0.8);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.08, 0.05);
  head.add(jaw);
  const jm = mesh(new THREE.ConeGeometry(0.13, 0.48, 5), belly, jaw, 0, 0, 0.2);
  jm.rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) {
    const t = mesh(new THREE.ConeGeometry(0.018, 0.07, 3), tooth, head, (i % 2 ? 1 : -1) * (0.05 + (i >> 1) * 0.025), -0.07, 0.42 - (i >> 1) * 0.08);
    t.rotation.x = Math.PI;
  }
  // three pairs of eyes
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.035 - i * 0.007, 6, 4), eyeMat, head, sx * (0.1 + i * 0.03), 0.08 - i * 0.02, 0.24 - i * 0.09);
  }
  // spines
  for (let i = 0; i < 9; i++) {
    const h = 0.18 + Math.sin((i / 8) * Math.PI) * 0.22;
    const sp = mesh(new THREE.ConeGeometry(0.035, h, 4), spineMat, body, 0, 0.36 + Math.sin((i / 8) * Math.PI) * 0.06, 0.65 - i * 0.16);
    sp.rotation.x = -0.5;
  }
  // tail
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = body;
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.08 : 0, i === 0 ? -0.8 : -0.22);
    const m = mesh(new THREE.CylinderGeometry(0.07 - i * 0.012, 0.09 - i * 0.012, 0.24, 5), skin, seg, 0, 0, -0.11);
    m.rotation.x = Math.PI / 2;
    if (i === 4) mesh(new THREE.ConeGeometry(0.06, 0.2, 4), spineMat, seg, 0, 0, -0.28).rotation.x = -Math.PI / 2;
    parent.add(seg);
    tail.push(seg);
    parent = seg;
  }
  // legs: two segments each
  type Leg = { hip: THREE.Group; knee: THREE.Group; phase: number };
  const legs: Leg[] = [];
  for (const [x, z, ph] of [[-0.26, 0.42, 0], [0.26, 0.42, 0.5], [-0.24, -0.5, 0.5], [0.24, -0.5, 0]] as const) {
    const hip = new THREE.Group();
    hip.position.set(x, -0.05, z);
    mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.42, 5), skin, hip, 0, -0.2, 0);
    const knee = new THREE.Group();
    knee.position.y = -0.4;
    hip.add(knee);
    mesh(new THREE.CylinderGeometry(0.035, 0.06, 0.38, 5), skin, knee, 0, -0.18, 0);
    mesh(new THREE.ConeGeometry(0.06, 0.12, 4), tooth, knee, 0, -0.38, 0.05).rotation.x = Math.PI / 2;
    body.add(hip);
    legs.push({ hip, knee, phase: ph });
  }
  root.visible = false;

  let gait = 0;
  return {
    root,
    /** speed in m/s; snarl 0..1 opens the jaw and flares the eyes. */
    animate(speed: number, snarl: number, t: number, dt: number) {
      gait += dt * (1.2 + speed * 1.6);
      const amt = Math.min(1, speed / 3);
      for (const L of legs) {
        const p = (gait + L.phase) * Math.PI * 2;
        L.hip.rotation.x = Math.sin(p) * 0.65 * amt;
        L.knee.rotation.x = (0.35 + Math.max(0, Math.cos(p)) * 0.7) * amt + 0.15;
      }
      body.position.y = 0.72 + Math.abs(Math.sin(gait * Math.PI * 2)) * 0.05 * amt - snarl * 0.12;
      body.rotation.x = snarl * 0.12;
      head.rotation.x = -0.1 + Math.sin(t * 1.3) * 0.05 + snarl * 0.15;
      jaw.rotation.x = 0.1 + snarl * (0.45 + Math.sin(t * 20) * 0.1);
      tail.forEach((s, i) => { s.rotation.y = Math.sin(t * 2.2 - i * 0.7) * (0.25 + amt * 0.1); s.rotation.x = 0.12; });
      eyeMat.color.setRGB(4 + snarl * 6, 0.8 + snarl, 0.6);
    },
  };
}
