import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Port Sahil at true 2189 scale, over the human-scale bazaar: the Taravel Ring arching over the whole city,
 * supertalls of 200 to 600 m whose lit crowns fade into the haze, stacked sky lanes streaming with traffic
 * lights, levitating platforms, a koi of light swimming above the street, a message tower in three scripts,
 * and a launch tower with a ship climbing on a column of light. Original; the bazaar below keeps its warmth.
 *
 * Far things are drawn without fog and tinted towards the sky by hand, so they read huge and distant instead of
 * vanishing. Everything repeated is instanced or merged; phones get about a third.
 */

export interface MegaOpts { rich: boolean; N: number; S: number; FRONT: number; haze: THREE.Color }

let seed = 911;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const glowMat = (c: number, k = 2.5, opacity = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false, fog: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildMega(scene: THREE.Scene, o: MegaOpts) {
  seed = 911;
  const { rich, N, S, haze } = o;
  const updates: ((dt: number, t: number) => void)[] = [];
  const add = <T extends THREE.Object3D>(x: T) => { x.userData.ground = false; scene.add(x); return x; };
  const far = (c: number, k: number) => new THREE.Color(c).lerp(haze, k); // distance haze, by hand

  // ---- the Taravel Ring: an arch of the city's own, spanning the sky beyond the spaceport ----
  {
    const ringM = new THREE.MeshStandardMaterial({ color: far(0xb8c4d6, 0.45), roughness: 0.5, metalness: 0.4, fog: false, emissive: far(0x1a2438, 0.3), emissiveIntensity: 1 });
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(900, 26, 16, 160, Math.PI), ringM));
    ring.position.set(-250, -120, S - 1100); ring.rotation.set(0, 0.35, 0);
    const lights = add(new THREE.Mesh(new THREE.TorusGeometry(900, 4, 6, 160, Math.PI), glowMat(0x7fe9ff, 1.8)));
    lights.position.copy(ring.position); lights.rotation.copy(ring.rotation); lights.scale.set(1, 1, 1.02);
    // the lit habitation bands along its flank: a dotted string of windows
    const dots = new THREE.InstancedMesh(new THREE.BoxGeometry(14, 3, 3), glowMat(0xffd6a0, 1.6), rich ? 220 : 90);
    for (let i = 0; i < dots.count; i++) {
      const a = (i / dots.count) * Math.PI, r = 900 - 26 + (i % 3) * 4;
      dots.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 24), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a + Math.PI / 2), new THREE.Vector3(1, 1, 1)));
    }
    const holder = add(new THREE.Group()); holder.position.copy(ring.position); holder.rotation.copy(ring.rotation); holder.add(dots); dots.userData.ground = false;
  }

  // ---- supertalls: a forest of 200 to 600 m towers around the old town, crowns lit, shafts fading into haze ----
  {
    const skin = canvasTex(128, 512, (g) => {
      g.fillStyle = '#18202e'; g.fillRect(0, 0, 128, 512);
      for (let y = 0; y < 512; y += 8) for (let x = 0; x < 128; x += 8) if (rnd() < 0.32) { g.fillStyle = rnd() < 0.6 ? '#ffd9a0' : '#9fdcff'; g.fillRect(x + 1, y + 2, 6, 4); }
    });
    skin.wrapS = skin.wrapT = THREE.RepeatWrapping;
    const n = rich ? 70 : 26, geos: THREE.BufferGeometry[] = [], crowns: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, x = side * (60 + rnd() * 340), z = N + 120 - rnd() * (N - S + 900), h = 200 + Math.pow(rnd(), 1.6) * 420, w = 22 + rnd() * 28;
      const g = new THREE.BoxGeometry(w, h, w, 1, 1, 1); const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 16, uv.getY(k) * h / 64);
      g.rotateY(rnd() * 0.6); g.translate(x, h / 2 - 2, z); geos.push(g.toNonIndexed());
      const c = new THREE.CylinderGeometry(w * 0.18, w * 0.42, 22 + rnd() * 30, 10); c.translate(x, h + 12, z); crowns.push(c.toNonIndexed());
    }
    const towerM = new THREE.MeshStandardMaterial({ color: far(0x5a6a80, 0.35), map: skin, emissive: 0xffffff, emissiveMap: skin, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.5, fog: false });
    add(new THREE.Mesh(mergeGeometries(geos, false)!, towerM));
    add(new THREE.Mesh(mergeGeometries(crowns, false)!, glowMat(0xfff0d0, 1.6)));
    // a veil of haze at their feet: a big soft plane band hides where they meet the ground, so they rise out of mist
    const veil = add(new THREE.Mesh(new THREE.CylinderGeometry(520, 520, 120, 48, 1, true), new THREE.MeshBasicMaterial({ color: haze, transparent: true, opacity: 0.55, side: THREE.BackSide, fog: false, depthWrite: false })));
    veil.position.set(0, 55, (N + S) / 2 - 200);
  }

  // ---- sky lanes: streams of traffic lights at four heights, sweeping across and along the city ----
  {
    const per = rich ? 160 : 50, levels = [42, 70, 105, 150];
    const lane: { y: number; a: number; r: number; cz: number; v: number }[] = [];
    for (const y of levels) for (let i = 0; i < per; i++) lane.push({ y: y + (rnd() - 0.5) * 4, a: rnd() * Math.PI * 2, r: 140 + (y % 3) * 60 + rnd() * 6, cz: S - 60, v: (i % 2 ? 1 : -1) * (0.05 + rnd() * 0.02) });
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.5, 3.2), glowMat(0xfff0d8, 3), lane.length);
    const tail = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.5, 3.2), glowMat(0xff4060, 3), lane.length);
    add(head); add(tail);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), SC = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
    updates.push((dt) => {
      lane.forEach((l, i) => {
        l.a += l.v * dt;
        P.set(Math.cos(l.a) * l.r, l.y, l.cz + Math.sin(l.a) * l.r * 1.6); Q.setFromAxisAngle(UP, -l.a + (l.v > 0 ? 0 : Math.PI));
        (l.v > 0 ? head : tail).setMatrixAt(i, M.compose(P, Q, SC)); (l.v > 0 ? tail : head).setMatrixAt(i, M.compose(P.set(0, -9999, 0), Q, SC));
      });
      head.instanceMatrix.needsUpdate = tail.instanceMatrix.needsUpdate = true;
    });
  }

  // ---- levitating platforms: plazas hanging in the air, lit underneath, little towers on top ----
  {
    const deck = new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.4, metalness: 0.5 });
    const plats: { g: THREE.Group; y: number; p: number }[] = [];
    for (const [x, y, z, r] of (rich ? [[-70, 95, -40, 22], [90, 140, -120, 30], [-40, 180, -260, 26], [60, 75, 60, 16]] : [[-70, 95, -40, 22], [90, 140, -120, 30]]) as [number, number, number, number][]) {
      const g = add(new THREE.Group()); g.position.set(x, y, z);
      const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.7, 4, 32), deck); g.add(d);
      const under = new THREE.Mesh(new THREE.CircleGeometry(r * 0.6, 32), glowMat(0x7fe9ff, 2.2)); under.rotation.x = Math.PI / 2; under.position.y = -2.1; g.add(under);
      for (let k = 0; k < 5; k++) { const tw = new THREE.Mesh(new THREE.BoxGeometry(4, 8 + rnd() * 18, 4), deck); tw.position.set((rnd() - 0.5) * r, 6 + rnd() * 6, (rnd() - 0.5) * r); g.add(tw); }
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.4, 6, 48), glowMat(0xffc36b, 2)); rim.rotation.x = Math.PI / 2; rim.position.y = 2; g.add(rim);
      g.traverse((x2) => { x2.userData.ground = false; });
      plats.push({ g, y, p: rnd() * 6 });
    }
    updates.push((_, t) => plats.forEach((p) => { p.g.position.y = p.y + Math.sin(t * 0.3 + p.p) * 1.5; p.g.rotation.y = t * 0.01 + p.p; }));
  }

  // ---- a koi of light, forty metres long, swimming slowly above the bazaar ----
  {
    const segs = rich ? 26 : 14;
    const koi = add(new THREE.Group());
    const parts: THREE.Mesh[] = [];
    for (let i = 0; i < segs; i++) {
      const k = i / (segs - 1), r = Math.sin(Math.min(1, k * 1.25) * Math.PI) * 2.6 + 0.3;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), glowMat(i % 5 === 0 ? 0xffffff : k < 0.5 ? 0xff7a3a : 0xffd27a, 1.4, 0.45));
      m.scale.set(1, 0.6, 1.4); m.userData.ground = false; koi.add(m); parts.push(m);
    }
    const fin = (side: number) => { const f = new THREE.Mesh(new THREE.ConeGeometry(2.2, 6, 3), glowMat(0xffe0a0, 1.2, 0.35)); f.rotation.z = side * 1.2; f.userData.ground = false; koi.add(f); return f; };
    const fL = fin(1), fR = fin(-1), tailF = new THREE.Mesh(new THREE.ConeGeometry(3.2, 7, 4), glowMat(0xff9a5a, 1.3, 0.35)); tailF.userData.ground = false; koi.add(tailF);
    updates.push((_, t) => {
      for (let i = 0; i < segs; i++) {
        const k = i / (segs - 1), s = t * 0.16 - k * 0.55;
        parts[i].position.set(Math.sin(s * 1.3) * 14 + Math.sin(t * 0.9 - k * 5) * 1.5 * k, 30 + Math.sin(s * 0.7) * 4, -10 + Math.cos(s) * 60);
      }
      const h = parts[3].position, b = parts[segs - 1].position;
      fL.position.set(h.x + 2.4, h.y - 0.6, h.z); fR.position.set(h.x - 2.4, h.y - 0.6, h.z); tailF.position.copy(b);
    });
  }

  // ---- the message tower: a slab of light scrolling the city's greeting in three scripts ----
  {
    const c = document.createElement('canvas'); c.width = 128; c.height = 1024;
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
    const words = ['WELCOME TO PORT SAHIL', 'पोर्ट साहिल में स्वागत है', 'پورٹ ساحل میں خوش آمدید', 'LAST SHORE BEFORE THE STARS'];
    let off = 0;
    const draw = () => {
      const g = c.getContext('2d')!; g.fillStyle = '#05101e'; g.fillRect(0, 0, 128, 1024);
      g.save(); g.translate(64, 0); g.rotate(Math.PI / 2); g.font = '700 64px Rajdhani, sans-serif';
      for (let i = 0; i < 6; i++) { g.fillStyle = ['#7fe9ff', '#ffb36e', '#ff6ec7', '#b6ff6e'][i % 4]; g.fillText(words[i % 4], -off + i * 900, 22); }
      g.restore(); tx.needsUpdate = true;
    };
    const slab = add(new THREE.Mesh(new THREE.PlaneGeometry(14, 110), new THREE.MeshBasicMaterial({ map: tx, color: new THREE.Color(1.8, 1.8, 1.8), toneMapped: false, fog: false })));
    slab.position.set(-34, 60, S - 30); slab.rotation.y = 0.5;
    let acc = 0; draw();
    updates.push((dt) => { acc += dt; if (acc > 0.08) { acc = 0; off = (off + 6) % 3600; draw(); } });
  }

  // ---- the launch tower at the spaceport, and a ship climbing a column of light ----
  {
    const tw = add(new THREE.Mesh(new THREE.BoxGeometry(10, 160, 10), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.6, roughness: 0.4 })));
    tw.position.set(70, 80, S - 180); tw.castShadow = false;
    for (let y = 10; y < 160; y += 12) { const l = add(new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.6, 10.4), glowMat(0xff3030, 2))); l.position.set(70, y, S - 180); }
    const ship = add(new THREE.Group());
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(6, 36, 6, 16), new THREE.MeshStandardMaterial({ color: 0xf0f2f6, metalness: 0.4, roughness: 0.3, fog: false }));
    ship.add(hull);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(4, 16, 260, 24, 1, true), glowMat(0xbfe9ff, 1.6, 0.35)); column.position.y = -150; ship.add(column);
    ship.traverse((x) => { x.userData.ground = false; });
    updates.push((_, t) => {
      const k = (t * 0.02) % 1; ship.position.set(86, 30 + k * k * 900, S - 180); ship.visible = k < 0.95;
      (column.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.15 * Math.sin(t * 20);
    });
  }

  return { update: (dt: number, t: number) => { for (const u of updates) u(dt, t); } };
}
