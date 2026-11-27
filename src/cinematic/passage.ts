import * as THREE from 'three';

/**
 * The way aft from the lounge to the escape pods (deck units, the lounge's own frame): the hatch in the aft bulkhead,
 * the passage behind it and the pod bay at its end, six pod hatches round the bay's wall (the six gold bays round the
 * spine outside). One place with the lounge: whoever leaves the lounge is seen to go through the hatch, along the rails
 * and towards the bay. The passage can tear open between them and the bay.
 */
export const PASSAGE = {
  /** the hatch in the aft bulkhead: its plane, its middle across the ship, its width and its lintel */
  doorX: 5.95, doorZ: 0.9, doorW: 1.1, doorTop: -0.1,
  /** the passage: where it ends (the bay's mouth), half its width, floor and ceiling */
  x1: 17.95, half: 1.6, floor: -2.2, ceil: 0.35,
  /** the pod bay: a drum round the passage's axis, its far wall, its radius, where the six hatches are along it */
  bayX1: 23.4, bayR: 2.9, axisY: -1.05, podX: 20.6,
  /** the handrails: their height and how far they stand off the walls */
  railY: -1.1, railOff: 0.09,
  /** where the passage tears: sections aft of this come away */
  tearX: 13.9,
  /** the lanes the six travel in, across the passage from its middle (doorZ): along the far wall's rail, and beside it
   *  towards the middle for whoever is towed. The near wall's side is left clear: the cameras work from there. */
  laneRail: -1.18, laneTow: -0.52,
} as const;

/** The parts of the route, for the continuity log (continuity.ts setPlaces). */
export const ROUTE_PLACES = [{ name: 'lounge', from: -Infinity }, { name: 'passage', from: PASSAGE.doorX }, { name: 'pod bay', from: PASSAGE.x1 }];

export interface Passage {
  group: THREE.Group;
  /** The hatch's door: 0 shut, 1 slid open along the bulkhead. */
  door(k: number): void;
  /** The passage's lamps: emergency red strips and the bay's hatch lamps (0 dark .. 1 full), and whether the hatches read green (ready) or red. */
  lamps(red: number, bay: number, ready: boolean): void;
  light: THREE.PointLight; bayLight: THREE.PointLight;
  /** The break: 0 whole, up to 1: a seam opens at tearX, the plates aft of it come away one by one and the bay drifts off. */
  tear(k: number, t: number): void;
  /** How torn it is and how far the hatch is open now (continuity log). */
  torn: number; open: number;
  /** The passage is drawn only while the hatch is open or it is in shot (the door and its sign always are). */
  show(on: boolean): void;
  /** Loose things adrift in the passage and the alarm beacons' sweep, at film time t. */
  drift(t: number): void;
}

function signTexture(text: string, color: string, w = 512, h = 128) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!; g.fillStyle = '#0b0f12'; g.fillRect(0, 0, w, h);
  g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  let px = Math.round(h * 0.52); g.font = `700 ${px}px Rajdhani, sans-serif`;
  while (g.measureText(text).width > w - 40 && px > 12) g.font = `700 ${px -= 2}px Rajdhani, sans-serif`;
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function hazardTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 16;
  const g = c.getContext('2d')!; g.fillStyle = '#17150c'; g.fillRect(0, 0, 256, 16); g.fillStyle = '#c9a227';
  for (let x = -16; x < 256; x += 32) { g.beginPath(); g.moveTo(x, 16); g.lineTo(x + 16, 0); g.lineTo(x + 32, 0); g.lineTo(x + 16, 16); g.closePath(); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(4, 1);
  return t;
}

export function createPassage(frameMat: THREE.Material, hullTex: THREE.Texture): Passage {
  const P = PASSAGE, group = new THREE.Group(); group.name = 'passage';
  const pt = hullTex.clone(); pt.repeat.set(1, 1); pt.needsUpdate = true;
  const panel = new THREE.MeshStandardMaterial({ color: 0x4d545e, map: pt, metalness: 0.45, roughness: 0.68, side: THREE.DoubleSide });
  const stripM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.2, 0.9) });
  const floorM = new THREE.MeshStandardMaterial({ color: 0x2c3038, metalness: 0.6, roughness: 0.55, side: THREE.DoubleSide });
  const railM = new THREE.MeshStandardMaterial({ color: 0xd9b25a, metalness: 0.9, roughness: 0.3 });
  const redM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.25, 0.15) });
  const podLampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.6, 0.9) });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide });
  const pipeM = new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.85, roughness: 0.35 });
  const lockM = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.6, roughness: 0.5 });
  const screenM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.9, 1.3) });
  const beaconM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.02, 0.02) });
  const hazM = new THREE.MeshBasicMaterial({ map: hazardTexture(), side: THREE.DoubleSide });
  const wayM = new THREE.MeshBasicMaterial({ map: signTexture('>>>', '#7dffb0', 256, 80), transparent: true, opacity: 0.85 });
  const beacons: THREE.Mesh[] = [];
  const W = P.half * 2, H = P.ceil - P.floor, yc = (P.ceil + P.floor) / 2;

  // ---- the passage, in 2 m sections so the sections aft of the tear can come away plate by plate ----
  const SEC = 2, n = Math.round((P.x1 - P.doorX) / SEC);
  const plates: { m: THREE.Object3D; x: number; out: THREE.Vector3; spin: THREE.Vector3; order: number }[] = [];
  const body = new THREE.Group(); group.add(body);
  const fixed = new THREE.Group(), loose = new THREE.Group(); body.add(fixed, loose);
  const arrow = signTexture('ESCAPE PODS  >>>', '#7dffb0');
  const signM = new THREE.MeshBasicMaterial({ map: arrow, side: THREE.DoubleSide });
  for (let i = 0; i < n; i++) {
    const x = P.doorX + (i + 0.5) * SEC, aft = x > P.tearX, par = aft ? loose : fixed;
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number, out: THREE.Vector3, k: number) => {
      const o = new THREE.Mesh(g, m); o.position.set(px, py, pz); o.receiveShadow = true; par.add(o);
      if (aft) plates.push({ m: o, x: px, out, spin: new THREE.Vector3(Math.sin(i * 3.1 + k), Math.sin(i * 1.7 + k * 2), Math.sin(i * 2.3 + k * 3)), order: (px - P.tearX) / (P.x1 - P.tearX) + k * 0.06 });
      return o;
    };
    const floors = [mk(new THREE.BoxGeometry(SEC - 0.02, 0.04, W), floorM, x, P.floor - 0.02, P.doorZ, new THREE.Vector3(0.2, -1, 0.1), 0)];
    mk(new THREE.BoxGeometry(SEC - 0.02, 0.04, W), panel, x, P.ceil + 0.02, P.doorZ, new THREE.Vector3(0.1, 1, -0.5), 1);
    const walls = [mk(new THREE.BoxGeometry(SEC - 0.02, H, 0.04), panel, x, yc, P.doorZ - P.half - 0.02, new THREE.Vector3(0.15, 0.3, -1), 2),
      mk(new THREE.BoxGeometry(SEC - 0.02, H, 0.04), panel, x, yc, P.doorZ + P.half + 0.02, new THREE.Vector3(0.2, 0.1, 1), 3)];
    // a rib round each joint, the rails, the floor's red strips; a sign every other section on the far wall
    const rib = new THREE.Group(); rib.position.set(x - SEC / 2, yc, P.doorZ); par.add(rib);
    for (const [w, h, py, pz] of [[0.1, 0.08, H / 2 - 0.04, 0, W], [0.1, 0.08, -H / 2 + 0.04, 0, W]] as const) { const r = new THREE.Mesh(new THREE.BoxGeometry(w, h, W), frameMat); r.position.set(0, py, pz); rib.add(r); }
    for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.1, H, 0.08), frameMat); r.position.set(0, 0, s * (P.half - 0.04)); rib.add(r); }
    if (aft) plates.push({ m: rib, x: x - SEC / 2, out: new THREE.Vector3(0.3, 0.2, -0.6), spin: new THREE.Vector3(0.4, 0.2, 0.7), order: (x - SEC / 2 - P.tearX) / (P.x1 - P.tearX) + 0.1 });
    for (const s of [-1, 1]) {
      mk(new THREE.CylinderGeometry(0.018, 0.018, SEC - 0.06, 8).rotateZ(Math.PI / 2), railM, x, P.railY, P.doorZ + s * (P.half - P.railOff), new THREE.Vector3(0.1, 0.2, s), 4 + s);
      mk(new THREE.BoxGeometry(SEC - 0.02, 0.025, 0.05), redM, x, P.floor + 0.02, P.doorZ + s * (P.half - 0.05), new THREE.Vector3(0.1, -0.6, s), 6 + s);
    }
    mk(new THREE.BoxGeometry(SEC - 0.5, 0.02, 0.1), stripM, x, P.ceil - 0.02, P.doorZ, new THREE.Vector3(0.1, 1, -0.5), 1);
    for (const s of [-1, 1]) mk(new THREE.BoxGeometry(SEC - 0.02, 0.5, 0.03), dark, x, P.floor + 0.3, P.doorZ + s * (P.half - 0.02), new THREE.Vector3(0.15, 0.1, s), 2.5 + s);
    if (i % 2 === 0) mk(new THREE.PlaneGeometry(1.2, 0.3), signM, x, -0.02, P.doorZ - P.half + 0.012, new THREE.Vector3(0.15, 0.3, -1), 2);
    // ---- what a ship's passage has on its walls: each thing rides on its own wall plate, so it goes with it in the break ----
    for (const s of [-1, 1]) {
      const wall = walls[s < 0 ? 0 : 1], zin = -s * 0.02; // the plate's inner face, in the plate's own frame
      const add = (g: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number) => { const o = new THREE.Mesh(g, m); o.position.set(px, py - yc, zin - s * pz); wall.add(o); return o; };
      // service runs under the ceiling: two pipes and a cable tray
      add(new THREE.CylinderGeometry(0.045, 0.045, SEC - 0.02, 8).rotateZ(Math.PI / 2), pipeM, 0, P.ceil - 0.2, 0.09);
      add(new THREE.CylinderGeometry(0.028, 0.028, SEC - 0.02, 8).rotateZ(Math.PI / 2), railM, 0, P.ceil - 0.34, 0.07);
      add(new THREE.BoxGeometry(SEC - 0.02, 0.03, 0.2), dark, 0, P.ceil - 0.46, 0.12);
      // the rail's brackets
      for (const bx of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.03, 0.03, P.railOff), frameMat, bx, P.railY, P.railOff / 2);
      // lockers and service hatches, by turns, with a small status lamp each; a hazard band along the wall's foot
      if ((i + (s > 0 ? 1 : 0)) % 2 === 0) {
        add(new THREE.BoxGeometry(1.1, 0.62, 0.1), lockM, -0.2, -0.52, 0.05);
        add(new THREE.BoxGeometry(0.5, 0.012, 0.012), stripM, -0.2, -0.26, 0.105);
        add(new THREE.BoxGeometry(0.05, 0.3, 0.03), railM, 0.22, -0.52, 0.11);
      } else {
        add(new THREE.BoxGeometry(0.62, 0.8, 0.05), lockM, 0.3, -0.5, 0.025);
        add(new THREE.TorusGeometry(0.2, 0.022, 6, 20), railM, 0.3, -0.5, 0.055);
        add(new THREE.BoxGeometry(0.3, 0.16, 0.02), screenM, -0.5, -0.38, 0.012);
      }
      add(new THREE.BoxGeometry(SEC - 0.02, 0.1, 0.012), hazM, 0, P.floor + 0.64, 0.008);
      // an alarm beacon at every other joint, high on the wall: it sweeps (drift) and takes the alarm lamps' red
      if (i % 2 === 1) { const b = add(new THREE.CylinderGeometry(0.05, 0.06, 0.09, 10).rotateX(Math.PI / 2), beaconM, -SEC / 2 + 0.16, P.ceil - 0.62, 0.05); beacons.push(b); }
    }
    // the floor: a grating's cross bars and a lit way-marker down the middle, pointing aft
    const fl = floors[0];
    for (const bx of [-0.66, -0.33, 0, 0.33, 0.66]) { const o = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, W - 0.3), dark); o.position.set(bx, 0.026, 0); fl.add(o); }
    const way = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.22), wayM); way.rotation.x = -Math.PI / 2; way.position.set(0, 0.034, 0); fl.add(way);
  }

  // ---- the pod bay: a drum, six hatches round its wall, each with a ring, a shut iris, a lamp and its number ----
  const bay = new THREE.Group(); bay.name = 'podbay'; body.add(bay);
  const BX = (P.x1 + P.bayX1) / 2; bay.position.set(BX, P.axisY, P.doorZ); // its own middle: it turns about itself as it drifts off
  const L = P.bayX1 - P.x1, drum = new THREE.Mesh(new THREE.CylinderGeometry(P.bayR, P.bayR, L, 36, 1, true), panel);
  drum.rotation.z = Math.PI / 2; bay.add(drum);
  const far = new THREE.Mesh(new THREE.CircleGeometry(P.bayR, 36), panel); far.position.set(P.bayX1 - BX, 0, 0); far.rotation.y = -Math.PI / 2; bay.add(far);
  // the bay's mouth: a wall round the passage's end
  const mouth = new THREE.Shape(); mouth.absarc(0, 0, P.bayR, 0, Math.PI * 2, false);
  const hole = new THREE.Path(); hole.moveTo(-P.half, P.floor - P.axisY); hole.lineTo(P.half, P.floor - P.axisY); hole.lineTo(P.half, P.ceil - P.axisY); hole.lineTo(-P.half, P.ceil - P.axisY); hole.closePath(); mouth.holes.push(hole);
  const mw = new THREE.Mesh(new THREE.ShapeGeometry(mouth, 36), panel); mw.position.set(P.x1 - BX, 0, 0); mw.rotation.y = Math.PI / 2; bay.add(mw);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(L, 0.04, W), floorM); deck.position.set(0, P.floor - 0.02 - P.axisY, 0); bay.add(deck);
  // the six pod hatches, in a ring on the bay's far wall: seen all the way down the passage, from the lounge's hatch
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i / 6) * Math.PI * 2, r = 1.12, pod = new THREE.Group();
    bay.add(pod); pod.position.set(P.bayX1 - BX - 0.06, Math.sin(a) * r, Math.cos(a) * r); pod.rotation.y = -Math.PI / 2; // facing down the passage
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 10, 32), railM); pod.add(ring);
    const iris = new THREE.Mesh(new THREE.CircleGeometry(0.39, 32), dark); iris.position.z = 0.005; pod.add(iris);
    for (let b = 0; b < 6; b++) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.76, 0.01), frameMat); blade.rotation.z = (b / 6) * Math.PI; blade.position.z = 0.012; pod.add(blade); }
    const lamp = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.022, 6, 40), podLampM); lamp.position.z = 0.02; pod.add(lamp);
    // a collar standing off the wall and a lit sill inside it: the hatch has depth, a pod is behind it
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.22, 24, 1, true).rotateX(Math.PI / 2), lockM); collar.position.z = 0.11; pod.add(collar);
    for (const [bx, by] of [[-0.62, 0], [0.62, 0]] as const) { const grab = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.36, 6), railM); grab.position.set(bx, by, 0.1); pod.add(grab); }
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.11), new THREE.MeshBasicMaterial({ map: signTexture(`POD ${i + 1}`, '#7dffb0', 256, 96) })); num.position.set(0, 0, 0.03); pod.add(num);
  }
  // the bay's own frames and its rails to the hatches: a room, not a painted end wall
  for (const bx of [P.x1 - BX + 0.5, 0, P.bayX1 - BX - 1.2]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(P.bayR - 0.06, 0.07, 6, 40), frameMat); ring.rotation.y = Math.PI / 2; ring.position.x = bx; bay.add(ring); }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, r = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, L - 0.3, 6).rotateZ(Math.PI / 2), railM); r.position.set(0, Math.sin(a) * (P.bayR - 0.2), Math.cos(a) * (P.bayR - 0.2)); bay.add(r); }
  for (const s of [-1, 1]) { const strip = new THREE.Mesh(new THREE.BoxGeometry(L - 0.4, 0.03, 0.08), podLampM); strip.position.set(0, P.floor + 0.02 - P.axisY, s * 0.9); bay.add(strip); }
  // loose things adrift in the passage since gravity went: cases, a helmet, sheets, a cup. Kept high and on the near
  // wall's side, clear of the lanes the six travel in
  const loot = new THREE.Group(); fixed.add(loot);
  const things: { m: THREE.Mesh; p: THREE.Vector3; v: THREE.Vector3; w: THREE.Vector3 }[] = [];
  const caseM = new THREE.MeshStandardMaterial({ color: 0x6e5a3c, metalness: 0.3, roughness: 0.6 }), paperM = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.9, side: THREE.DoubleSide }), helmM = new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.5, roughness: 0.4 });
  const R = (k: number) => { const x = Math.sin(k * 127.1) * 43758.5453; return x - Math.floor(x); };
  for (let k = 0; k < 9; k++) {
    const kind = k % 4, g = kind === 0 ? new THREE.BoxGeometry(0.2, 0.12, 0.15) : kind === 1 ? new THREE.PlaneGeometry(0.21, 0.3) : kind === 2 ? new THREE.BoxGeometry(0.1, 0.03, 0.16) : new THREE.CylinderGeometry(0.035, 0.03, 0.09, 8);
    const m = new THREE.Mesh(g, kind === 0 ? caseM : kind === 1 ? paperM : kind === 2 ? helmM : pipeM);
    // (between where the cameras stand: one drifted across a lens and filled the frame)
    const p = new THREE.Vector3(P.doorX + 2.8 + R(k + 1) * 2.0, P.ceil - 0.18 - R(k + 7) * 0.4, P.doorZ + 0.95 + R(k + 13) * 0.45); // (along the near wall under the ceiling: down the middle they hid the bay from the shot that shows it)
    things.push({ m, p, v: new THREE.Vector3(0.06 + R(k + 21) * 0.06, 0.04 + R(k + 23) * 0.04, 0.05 + R(k + 29) * 0.05), w: new THREE.Vector3(R(k + 31) - 0.5, R(k + 37) - 0.5, R(k + 41) - 0.5).multiplyScalar(1.4) });
    loot.add(m);
  }
  const bayLight = new THREE.PointLight(0xbfffe0, 0, 12, 1.6); bayLight.position.set(P.podX - BX, 0, 0); bay.add(bayLight);
  const light = new THREE.PointLight(0xff3a22, 0, 9, 1.6); light.position.set(P.doorX + 5, -0.5, P.doorZ); body.add(light);
  // the emergency strips' own light, steady while the passage has power: faces read by it
  const fills = [P.doorX + 2.4, P.doorX + 6.4].map((x) => { const f = new THREE.PointLight(0xffe2c8, 0, 8, 1.4); f.position.set(x, P.ceil - 0.3, P.doorZ + 0.5); body.add(f); return f; });

  // ---- the hatch's door: a slab in the opening that slides along the bulkhead towards the room's side ----
  const doorM = new THREE.MeshStandardMaterial({ color: 0x3a4049, metalness: 0.7, roughness: 0.35 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, P.doorTop - P.floor, P.doorW), doorM); door.position.set(P.doorX - 0.05, (P.doorTop + P.floor) / 2, P.doorZ); door.castShadow = true; group.add(door);
  const doorSign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), new THREE.MeshBasicMaterial({ map: signTexture('ESCAPE PODS', '#7dffb0', 512, 128) }));
  doorSign.position.set(P.doorX - 0.03, P.doorTop + 0.22, P.doorZ); doorSign.rotation.y = -Math.PI / 2; group.add(doorSign);

  // the hole's light through the gap, once it opens
  const glow = new THREE.PointLight(0xffc890, 0, 22, 1.2); glow.position.set(P.tearX + 2.6, 0.9, P.doorZ - 2.6); body.add(glow);
  const bay0 = bay.position.clone(), home = plates.map((p) => ({ p: p.m.position.clone(), q: p.m.quaternion.clone() }));
  const out: Passage = {
    group, light, bayLight, torn: 0, open: 0,
    show(on) { body.visible = on; },
    drift(t) {
      // (each wanders a hand or two about its own place, whatever clock it is given: it never crosses into the lanes)
      things.forEach((th, i) => { th.m.position.set(th.p.x + th.v.x * Math.sin(t * 0.21 + i), th.p.y + th.v.y * Math.sin(t * 0.17 + i * 2), th.p.z + th.v.z * 0.5 * Math.sin(t * 0.19 + i * 3)); th.m.rotation.set(th.w.x * t * 0.4, th.w.y * t * 0.4, th.w.z * t * 0.4); });
      // the beacons: a red sweep, each a little after the one before it down the passage (the lamps' own level sets how bright)
      beacons.forEach((b, i) => { const k = 0.5 + 0.5 * Math.sin(t * 7 - i * 0.9); b.scale.setScalar(0.9 + 0.25 * k); });
    },
    door(k) { k = Math.min(1, Math.max(0, k)); out.open = k; door.position.z = P.doorZ + k * (P.doorW + 0.04); },
    lamps(red, bayK, ready) { redM.color.setRGB(2.6 * red + 0.05, 0.25 * red, 0.15 * red); podLampM.color.setRGB(ready ? 0.4 * bayK : 2.6 * bayK, ready ? 2.6 * bayK : 0.3 * bayK, ready ? 0.9 * bayK : 0.2 * bayK); light.intensity = 9 * red; bayLight.intensity = 24 * bayK; const pw = red > 0.3 ? 1 : red / 0.3; fills.forEach((f) => { f.intensity = 3.2 * pw; }); stripM.color.setRGB(1.5 * pw + 0.03, 1.2 * pw + 0.03, 0.9 * pw + 0.03); beaconM.color.setRGB(3.2 * red + 0.1, 0.3 * red, 0.15 * red); screenM.color.setRGB(0.25 * pw, 0.9 * pw, 1.3 * pw); bayLight.color.set(ready ? 0xbfffe0 : 0xff5a40); },
    tear(k, t) {
      out.torn = k; glow.intensity = 13 * Math.min(1, k * 2.2);
      plates.forEach((p, i) => {
        // each plate lets go in its turn (the seam first, then aft), then drifts out and turns, slowly: there is no air to hurry it
        const g = Math.max(0, (k - p.order * 0.55) / 0.45), e = g * g;
        p.m.position.copy(home[i].p).addScaledVector(p.out, e * 3.2);
        p.m.quaternion.copy(home[i].q); if (e > 0) { p.m.rotateX(p.spin.x * e * 1.4 + Math.sin(t * 0.7 + i) * 0.02 * g); p.m.rotateY(p.spin.y * e * 1.1); p.m.rotateZ(p.spin.z * e * 1.2); }
      });
      const d = Math.max(0, (k - 0.35) / 0.65);
      bay.position.copy(bay0).add(new THREE.Vector3(d * d * 6.5, d * d * 1.2, d * d * 2.2)); bay.rotation.set(d * 0.18, d * 0.22, d * 0.3);
    },
  };
  out.lamps(0, 0, true); out.drift(0); body.visible = false;
  body.traverse((o) => { o.castShadow = false; });
  return out;
}
