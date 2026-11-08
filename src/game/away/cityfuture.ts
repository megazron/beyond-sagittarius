import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Port Sahil's 2189 layer, over the bazaar street: towers stepping up behind it with solar sails and antenna
 * clusters, sky bridges, neon and holographic brand signs, ad screens that change, a maglev guideway with a tram
 * gliding in, hover traffic and drones overhead, delivery bots on the pavements, steam off the chai and the
 * biryani, and ships rising from the spaceport at the end of the street.
 *
 * Built for phones: every repeated thing is one InstancedMesh or one merged mesh, and `rich` false roughly halves it.
 */

export interface FutureOpts { rich: boolean; N: number; S: number; FRONT: number; FLOOR: number; shops: { name: string; side: number; z: number; fg: string }[] }

let seed = 77;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** A tower's skin: glass bands and a grid of windows, a few lit even in daylight. */
const towerSkin = () => {
  const t = canvasTex(256, 512, (g) => {
    g.fillStyle = '#4a5f73'; g.fillRect(0, 0, 256, 512);
    for (let y = 0; y < 512; y += 16) {
      g.fillStyle = 'rgba(20,30,44,.85)'; g.fillRect(0, y + 3, 256, 10);
      for (let x = 0; x < 256; x += 16) if (rnd() < 0.18) { g.fillStyle = rnd() < 0.5 ? 'rgba(255,214,150,.95)' : 'rgba(170,230,255,.9)'; g.fillRect(x + 2, y + 4, 12, 8); }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};

export function buildFuture(scene: THREE.Scene, o: FutureOpts) {
  seed = 77;
  const { rich, N, S, FRONT, FLOOR } = o;
  const updates: ((dt: number, t: number) => void)[] = [];
  const add = <T extends THREE.Object3D>(x: T) => { scene.add(x); return x; };

  // ---- towers behind both sides, stepping up away from the street; merged per material ----
  const skin = towerSkin();
  const towerM = new THREE.MeshStandardMaterial({ color: 0xffffff, map: skin, emissive: 0xffffff, emissiveMap: skin, emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.5 });
  const crownM = new THREE.MeshStandardMaterial({ color: 0xe9eef3, roughness: 0.35, metalness: 0.4 });
  const sailM = new THREE.MeshStandardMaterial({ color: 0x1d3150, roughness: 0.2, metalness: 0.7, emissive: 0x0b2440, side: THREE.DoubleSide });
  const mastM = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.4, metalness: 0.8 });
  const towerG: THREE.BufferGeometry[] = [], crownG: THREE.BufferGeometry[] = [], sailG: THREE.BufferGeometry[] = [], mastG: THREE.BufferGeometry[] = [];
  const put = (list: THREE.BufferGeometry[], g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0) => { g.rotateX(rx); g.rotateY(ry); g.translate(x, y, z); list.push(g); };
  const tops: THREE.Vector3[] = [];
  for (const side of [-1, 1]) for (let z = N - 6; z > S + 10; z -= 16 + rnd() * 10) {
    const x = side * (FRONT + 18 + rnd() * 14), h = 34 + rnd() * 70, w = 9 + rnd() * 6, d = 9 + rnd() * 6;
    // a podium, the shaft, a setback, and a crown
    const shaft = new THREE.BoxGeometry(w, h, d); const uv = shaft.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 8, uv.getY(i) * h / 16);
    put(towerG, shaft, x, h / 2, z);
    put(towerG, new THREE.BoxGeometry(w * 0.7, h * 0.25, d * 0.7), x, h + h * 0.125, z);
    const top = h * 1.25;
    put(crownG, new THREE.CylinderGeometry(w * 0.3, w * 0.42, 3, 12), x, top + 1.5, z);
    tops.push(new THREE.Vector3(x, top + 3, z));
    // solar sails on stalks, tilted to the sun; an antenna cluster
    for (let s = 0; s < 2; s++) put(sailG, new THREE.PlaneGeometry(7, 4), x + (s - 0.5) * 7, top - 2 + s * 2, z + side * 3, side * 0.4, -0.6);
    for (let m = 0; m < 3; m++) put(mastG, new THREE.CylinderGeometry(0.08, 0.12, 5 + m * 3, 6), x + (m - 1) * 1.2, top + 3 + (5 + m * 3) / 2, z - 1);
  }
  const merged = (list: THREE.BufferGeometry[], m: THREE.Material, shadows = false) => {
    if (!list.length) return;
    const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)), false); if (!g) return;
    const mesh = add(new THREE.Mesh(g, m)); mesh.castShadow = shadows; mesh.receiveShadow = shadows; mesh.userData.ground = false;
  };
  merged(towerG, towerM, rich); merged(crownG, crownM); merged(sailG, sailM); merged(mastG, mastM);
  // blinking aircraft lights on the tallest masts
  const blink = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3030).multiplyScalar(3) }), tops.length);
  tops.forEach((p, i) => blink.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y + 11, p.z - 1)));
  add(blink); updates.push((_, t) => { (blink.material as THREE.MeshBasicMaterial).color.setScalar(0).setRGB(Math.sin(t * 3) > 0.6 ? 3 : 0.3, 0.1, 0.1); });

  // ---- sky bridges across the street between the towers ----
  const bridgeM = new THREE.MeshStandardMaterial({ color: 0x9fc3d8, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.75 });
  const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6ff7ff).multiplyScalar(2.2) });
  const bridges = rich ? [40, 6, -34] : [6];
  for (const z of bridges) {
    const y = 26 + rnd() * 10, span = 2 * (FRONT + 22);
    const tube = add(new THREE.Mesh(new THREE.CapsuleGeometry(1.8, span - 3.6, 4, 12), bridgeM)); tube.rotation.z = Math.PI / 2; tube.position.set(0, y, z); tube.userData.ground = false;
    const strip = add(new THREE.Mesh(new THREE.BoxGeometry(span, 0.12, 0.25), glowM)); strip.position.set(0, y - 1.7, z);
  }

  // ---- neon blade signs and holographic brand signs ----
  const neon = (text: string, color: string, vertical: boolean) => canvasTex(vertical ? 128 : 512, vertical ? 512 : 128, (g) => {
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    g.strokeStyle = color; g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 20; g.lineWidth = 6;
    g.font = '700 84px Rajdhani, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (vertical) text.split('').forEach((ch, i) => g.fillText(ch, 64, 60 + i * 80)); else g.fillText(text, 256, 68);
    g.strokeRect(6, 6, g.canvas.width - 12, g.canvas.height - 12);
  });
  const additive = (map: THREE.Texture, k = 2.5) => new THREE.MeshBasicMaterial({ map, color: new THREE.Color(k, k, k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const blades: [string, string, number, number][] = [['CHAI', '#ffb347', 1, 18], ['MEHNDI', '#ff6ec7', -1, -26], ['BIRYANI', '#7cff9a', -1, 4], ['RISHTA.AI', '#7fd8ff', 1, -40], ['DAWAI', '#5fffd0', 1, -12], ['SNAPGRAM', '#ff5d8f', -1, 36]];
  for (const [txt, col, side, z] of blades) {
    const v = add(new THREE.Mesh(new THREE.PlaneGeometry(0.9, Math.min(6, txt.length * 0.62 + 0.5)), additive(neon(txt, col, true), 2.2)));
    v.position.set(side * (FRONT - 0.9), 6.5, z); v.rotation.y = 0; v.userData.ground = false;
  }
  // holograms floating over the shops they belong to, slowly turning and flickering
  const holos: THREE.Mesh[] = [];
  for (const sh of o.shops) {
    const h = add(new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), additive(neon(sh.name, sh.fg === '#202024' ? '#bfe9ff' : sh.fg, false), 1.8)));
    h.position.set(sh.side * (FRONT - 2.2), 5.6 + FLOOR, sh.z); h.userData.ground = false; holos.push(h);
    const beam = add(new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.4, 16, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fe9ff).multiplyScalar(0.6), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false })));
    beam.position.set(sh.side * (FRONT - 2.2), 4.6 + FLOOR, sh.z); beam.rotation.x = Math.PI;
  }
  updates.push((_, t) => holos.forEach((h, i) => {
    h.rotation.y = Math.sin(t * 0.4 + i) * 0.5;
    (h.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.25 * Math.sin(t * 23 + i * 7) * (Math.sin(t * 0.7 + i) > 0.9 ? 1 : 0.1);
  }));

  // ---- ad screens on the towers: they change every few seconds ----
  const ADS: [string, string, string][] = [
    ['LAMAZON ORBIT', 'Same day to Saturn', '#ff9900'], ['CAPPLE VISION 9', 'See more. Blink less.', '#bfe9ff'], ['CHAI COSMOS', 'Now open on Europa', '#ffcf7a'],
    ['SNAPGRAM', 'Post it before it happens', '#ff5d8f'], ['RISHTA.AI', 'Your aunty, but faster', '#7fd8ff'], ['BIRYANI SUPERNOVA', 'Extra spicy. Extra stellar.', '#7cff9a'],
  ];
  const screens: { c: HTMLCanvasElement; t: THREE.CanvasTexture; k: number }[] = [];
  const drawAd = (c: HTMLCanvasElement, k: number) => {
    const g = c.getContext('2d')!, [a, b, col] = ADS[k % ADS.length];
    const gr = g.createLinearGradient(0, 0, 512, 288); gr.addColorStop(0, '#0b1020'); gr.addColorStop(1, '#22123a');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 288);
    g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 24; g.font = '700 58px Rajdhani, sans-serif'; g.textAlign = 'center'; g.fillText(a, 256, 130);
    g.shadowBlur = 0; g.fillStyle = '#ffffff'; g.font = '500 32px Rajdhani, sans-serif'; g.fillText(b, 256, 190);
  };
  const adSpots: [number, number, number][] = [[-1, 30, 28], [1, -4, 34], [-1, -38, 24], [1, 52, 30]];
  for (const [side, z, y] of (rich ? adSpots : adSpots.slice(0, 2))) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 288;
    const k = screens.length; drawAd(c, k);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
    const scr = add(new THREE.Mesh(new THREE.PlaneGeometry(16, 9), new THREE.MeshBasicMaterial({ map: tx, color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false })));
    scr.position.set(side * (FRONT + 17.5), y, z); scr.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; scr.userData.ground = false;
    screens.push({ c, t: tx, k });
  }
  let adT = 0;
  updates.push((dt) => { adT += dt; if (adT > 4.5) { adT = 0; for (const s of screens) { s.k++; drawAd(s.c, s.k); s.t.needsUpdate = true; } } });

  // ---- the maglev guideway down the middle of the street, and a second tram that glides past ----
  const rail = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, N - S), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4ff3ff).multiplyScalar(1.8), toneMapped: false })));
  rail.position.set(-2.2, 0.03, (N + S) / 2); rail.userData.ground = false;
  const glider = new THREE.Group(); add(glider);
  const gm = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.25, metalness: 0.5 });
  const gbody = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 10, 6, 16), gm); gbody.rotation.x = Math.PI / 2; gbody.position.y = 1.9; gbody.scale.set(1, 1, 0.95); glider.add(gbody);
  const gwin = new THREE.Mesh(new THREE.CapsuleGeometry(1.32, 9, 4, 16, ), new THREE.MeshStandardMaterial({ color: 0x223344, emissive: 0xffe6c0, emissiveIntensity: 0.4, roughness: 0.1 })); gwin.rotation.x = Math.PI / 2; gwin.position.y = 2.15; gwin.scale.set(1.0, 1, 0.35); glider.add(gwin);
  const gglow = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6ff7ff).multiplyScalar(2.5), toneMapped: false })); gglow.position.y = 0.5; glider.add(gglow);
  glider.traverse((x) => { x.userData.ground = false; (x as THREE.Mesh).castShadow = true; });
  glider.position.set(2.2, 0, S - 40);
  updates.push((dt) => { glider.position.z += dt * 14; if (glider.position.z > N + 40) glider.position.z = S - 60; });

  // ---- hover traffic and drones overhead: instanced, moving along lanes ----
  const cars = rich ? 26 : 12, drones = rich ? 18 : 8;
  const carG = mergeGeometries([new THREE.CapsuleGeometry(0.9, 2.4, 4, 10).rotateX(Math.PI / 2).toNonIndexed(), new THREE.BoxGeometry(1.6, 0.25, 2.2).translate(0, -0.55, 0).toNonIndexed()], false)!;
  const carM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.6 });
  const carI = new THREE.InstancedMesh(carG, carM, cars); carI.castShadow = rich; carI.userData.ground = false;
  const carLights = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe0b0).multiplyScalar(3), toneMapped: false }), cars);
  const lanes = Array.from({ length: cars }, (_, i) => ({ x: (i % 4 - 1.5) * 4.5, y: 16 + (i % 3) * 5 + rnd() * 2, z: S + rnd() * (N - S), v: (i % 2 ? 1 : -1) * (10 + rnd() * 9) }));
  lanes.forEach((_, i) => carI.setColorAt(i, new THREE.Color().setHSL(rnd(), 0.5, 0.55)));
  add(carI); add(carLights);
  const droneG = mergeGeometries([new THREE.BoxGeometry(0.5, 0.12, 0.5).toNonIndexed(), ...[[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]].map(([x, z]) => new THREE.CylinderGeometry(0.18, 0.18, 0.03, 10).translate(x, 0.08, z).toNonIndexed())], false)!;
  const droneI = new THREE.InstancedMesh(droneG, new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5, metalness: 0.6 }), drones); droneI.userData.ground = false;
  const droneL = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fffd4).multiplyScalar(3), toneMapped: false }), drones);
  const dpaths = Array.from({ length: drones }, () => ({ cx: (rnd() - 0.5) * 14, cz: S + 10 + rnd() * (N - S - 20), r: 2 + rnd() * 6, y: 7 + rnd() * 6, w: 0.3 + rnd() * 0.5, p: rnd() * 6 }));
  add(droneI); add(droneL);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), SC = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  updates.push((dt, t) => {
    lanes.forEach((l, i) => {
      l.z += l.v * dt; if (l.z > N + 30) l.z = S - 30; if (l.z < S - 30) l.z = N + 30;
      Q.setFromAxisAngle(UP, l.v > 0 ? 0 : Math.PI); P.set(l.x, l.y + Math.sin(t * 0.8 + i) * 0.3, l.z);
      carI.setMatrixAt(i, M.compose(P, Q, SC)); P.z += (l.v > 0 ? 1.9 : -1.9); carLights.setMatrixAt(i, M.compose(P, Q, SC));
    });
    dpaths.forEach((d, i) => {
      const a = t * d.w + d.p; P.set(d.cx + Math.cos(a) * d.r, d.y + Math.sin(t * 1.3 + i) * 0.4, d.cz + Math.sin(a) * d.r);
      Q.setFromAxisAngle(UP, -a); droneI.setMatrixAt(i, M.compose(P, Q, SC)); P.y -= 0.12; droneL.setMatrixAt(i, M.compose(P, Q, SC));
    });
    carI.instanceMatrix.needsUpdate = carLights.instanceMatrix.needsUpdate = droneI.instanceMatrix.needsUpdate = droneL.instanceMatrix.needsUpdate = true;
  });

  // ---- delivery bots on the pavements: little boxes on wheels with a face ----
  const botFace = canvasTex(128, 64, (g) => { g.fillStyle = '#10161f'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#7fffd4'; g.beginPath(); g.arc(42, 30, 8, 0, 7); g.arc(86, 30, 8, 0, 7); g.fill(); g.fillRect(48, 46, 32, 4); });
  const bots: { g: THREE.Group; z0: number; z1: number; dir: number }[] = [];
  for (let i = 0; i < (rich ? 4 : 2); i++) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.7), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xff9900 : 0xf4f4f6, roughness: 0.4 })); b.position.y = 0.42; g.add(b);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), new THREE.MeshBasicMaterial({ map: botFace, color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: false })); f.position.set(0, 0.5, 0.36); g.add(f);
    const flag = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.9), new THREE.MeshBasicMaterial({ color: 0xffffff })); flag.position.set(0.2, 1.1, -0.25); g.add(flag);
    for (const [x, z] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), new THREE.MeshStandardMaterial({ color: 0x222222 })); w.rotation.z = Math.PI / 2; w.position.set(x, 0.1, z); g.add(w); }
    g.traverse((x) => { x.userData.ground = false; (x as THREE.Mesh).castShadow = true; });
    const side = i % 2 ? 1 : -1, z0 = S + 20 + rnd() * 40, z1 = z0 + 30 + rnd() * 40;
    g.position.set(side * 6.1, FLOOR, z0 + rnd() * (z1 - z0)); add(g); bots.push({ g, z0, z1, dir: rnd() < 0.5 ? 1 : -1 });
  }
  updates.push((dt) => bots.forEach((b) => {
    b.g.position.z += b.dir * dt * 1.4; if (b.g.position.z > b.z1) b.dir = -1; else if (b.g.position.z < b.z0) b.dir = 1;
    b.g.rotation.y = b.dir > 0 ? 0 : Math.PI;
  }));

  // ---- steam off the chai and the biryani: a few soft sprites rising ----
  const puff = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 30); r.addColorStop(0, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  const steam: { s: THREE.Sprite; base: THREE.Vector3; p: number }[] = [];
  for (const [x, y, z] of [[6.4, 1.2, 12.6], [-8.6, 1.6, 0], [-8.6, 1.6, 1.4]] as [number, number, number][]) for (let i = 0; i < (rich ? 6 : 3); i++) {
    const s = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, transparent: true, depthWrite: false, opacity: 0.5 }))); steam.push({ s, base: new THREE.Vector3(x, y, z), p: i / 6 });
  }
  updates.push((dt, t) => steam.forEach((q) => {
    const k = (t * 0.25 + q.p) % 1; q.s.position.set(q.base.x + Math.sin(t + q.p * 9) * 0.15 * k, q.base.y + k * 1.6, q.base.z);
    q.s.scale.setScalar(0.3 + k * 0.9); q.s.material.opacity = 0.45 * (1 - k);
  }));

  // ---- ships at the end of the street: shuttles rising from the pads and settling again ----
  const shipM = new THREE.MeshStandardMaterial({ color: 0xeef1f5, roughness: 0.3, metalness: 0.5 });
  const flameM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fdcff).multiplyScalar(3), transparent: true, opacity: 0.8, toneMapped: false });
  const ships: { g: THREE.Group; x: number; z: number; p: number }[] = [];
  for (let i = 0; i < (rich ? 3 : 2); i++) {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(2.2, 9, 4, 16), shipM); g.add(hull);
    for (const a of [0, 2.1, 4.2]) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 3), shipM); fin.position.set(Math.cos(a) * 2.4, -4, Math.sin(a) * 2.4); fin.rotation.y = -a; g.add(fin); }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(1.4, 6, 16, 1, true), flameM); flame.position.y = -9.5; flame.rotation.x = Math.PI; g.add(flame);
    g.traverse((x) => { x.userData.ground = false; });
    add(g); ships.push({ g, x: (i - 1) * 42 + 8, z: S - 110 - i * 30, p: i * 0.37 });
  }
  updates.push((_, t) => ships.forEach((s) => {
    const k = (t * 0.03 + s.p) % 1; // a slow climb, then gone, then the next one on the pad
    s.g.position.set(s.x, 8 + k * k * 260, s.z); s.g.visible = k < 0.92;
    (s.g.children[s.g.children.length - 1] as THREE.Mesh).scale.setScalar(0.7 + Math.sin(t * 30) * 0.1);
  }));

  return { update: (dt: number, t: number) => { for (const u of updates) u(dt, t); } };
}
