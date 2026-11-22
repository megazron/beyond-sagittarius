import * as THREE from 'three';
import { fitCanvasText } from '../../core/canvastext';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CLOCK, stamp } from '../../core/cycle';
import { nearFade } from '../../core/nearfade';

/**
 * Zenvora at true 2189 scale, over the human-scale bazaar: the Taravel Ring arching over the whole city,
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
  const c = document.createElement('canvas'); c.width = w; c.height = h; fitCanvasText(c.getContext('2d')!, draw);
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
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(420, 18, 16, 160, Math.PI), ringM));
    ring.position.set(-30, -200, S - 420); ring.rotation.set(0, 0.12, 0); // seen through the gate, it fills the sky over the spaceport
    const lights = add(new THREE.Mesh(new THREE.TorusGeometry(420, 3, 6, 160, Math.PI), glowMat(0x7fe9ff, 1.8)));
    lights.position.copy(ring.position); lights.rotation.copy(ring.rotation); lights.scale.set(1, 1, 1.02);
    // the lit habitation bands along its flank: a dotted string of windows
    const dots = new THREE.InstancedMesh(new THREE.BoxGeometry(14, 3, 3), glowMat(0xffd6a0, 1.6), rich ? 220 : 90);
    for (let i = 0; i < dots.count; i++) {
      const a = (i / dots.count) * Math.PI, r = 420 - 18 + (i % 3) * 3;
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
      const side = i % 2 ? 1 : -1, x = side * (370 + rnd() * 380), z = N + 120 - rnd() * (N - S + 900), h = 200 + Math.pow(rnd(), 1.6) * 420, w = 22 + rnd() * 28;
      if (Math.abs(x) < 100 && Math.abs(z - (side > 0 ? 30 : -44)) < 32) continue; // not in a side street's square
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
  if (rich) { // phones: left out (each is a handful of draw calls a frame for a detail in the sky)
    const per = rich ? 130 : 40, levels = [24, 34, 48, 70];
    // half run along the street (x fixed), half across it (z fixed): either way, streams of light overhead
    const lane: { y: number; along: boolean; c: number; p: number; v: number }[] = [];
    for (const y of levels) for (let i = 0; i < per; i++) {
      const along = i % 2 === 0;
      lane.push({ y: y + (rnd() - 0.5) * 3, along, c: along ? (rnd() - 0.5) * 70 : S - 40 + rnd() * (N - S + 80), p: rnd(), v: (i % 4 < 2 ? 1 : -1) * (0.035 + rnd() * 0.02) });
    }
    // one instanced mesh, every light's lane in its instance and its flight in the shader (two meshes and 520 matrices
    // composed by script every frame before); headlights white where a lane runs one way, tail lights red the other
    const lg = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(0.8, 0.5, 3.2) as unknown as THREE.InstancedBufferGeometry);
    const la = new Float32Array(lane.length * 4), lb = new Float32Array(lane.length);
    lane.forEach((l, i) => { la.set([l.y, l.c, l.p, l.v], i * 4); lb[i] = l.along ? 1 : 0; });
    lg.setAttribute('aLane', new THREE.InstancedBufferAttribute(la, 4)); lg.setAttribute('aAlong', new THREE.InstancedBufferAttribute(lb, 1));
    const lm = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
    lm.onBeforeCompile = (sh) => {
      sh.uniforms.uClock = CLOCK;
      sh.vertexShader = 'attribute vec4 aLane; attribute float aAlong; uniform float uClock;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        { float p = fract(aLane.z + aLane.w * uClock), yaw = aAlong > 0.5 ? (aLane.w > 0.0 ? 0.0 : 3.14159265) : (aLane.w > 0.0 ? 1.57079633 : -1.57079633);
          float c = cos(yaw), s = sin(yaw);
          transformed = vec3(c * transformed.x + s * transformed.z, transformed.y, -s * transformed.x + c * transformed.z);
          transformed += aAlong > 0.5 ? vec3(aLane.y, aLane.x, ${(S - 260).toFixed(1)} + p * ${(N - S + 360).toFixed(1)}) : vec3(-260.0 + p * 520.0, aLane.x, aLane.y); }`);
      nearFade(lm, sh);
    };
    lm.customProgramCacheKey = () => 'mega-lanes|nearfade';
    const lights = new THREE.InstancedMesh(lg, lm, lane.length); lights.frustumCulled = false;
    const HEAD = new THREE.Color(0xfff0d8).multiplyScalar(3), TAIL = new THREE.Color(0xff4060).multiplyScalar(3);
    lane.forEach((l, i) => lights.setColorAt(i, l.v > 0 ? HEAD : TAIL));
    add(lights);
  }

  // ---- levitating platforms: plazas hanging in the air, lit underneath, little towers on top ----
  if (rich) { // phones: left out (each is a handful of draw calls a frame for a detail in the sky)
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
  // one mesh, one material: each part's place along the body is in its vertices and the swim is in the shader (it was
  // twenty-nine meshes, a material and a draw each, moved by script every frame)
  if (rich) { // phones: left out (each is a handful of draw calls a frame for a detail in the sky)
    const segs = rich ? 26 : 14, geos: THREE.BufferGeometry[] = [];
    const part = (g: THREE.BufferGeometry, c: number, k: number, opacity: number, seg: number) => { const col = new THREE.Color(c).multiplyScalar(k); geos.push(stamp(g, { color: [col.r, col.g, col.b, opacity], aKoi: [seg] })); };
    for (let i = 0; i < segs; i++) {
      const k = i / (segs - 1), r = Math.sin(Math.min(1, k * 1.25) * Math.PI) * 2.6 + 0.3;
      part(new THREE.SphereGeometry(r, 12, 8).scale(1, 0.6, 1.4), i % 5 === 0 ? 0xffffff : k < 0.5 ? 0xff7a3a : 0xffd27a, 1.4, 0.45, k);
    }
    for (const side of [1, -1]) part(new THREE.ConeGeometry(2.2, 6, 3).rotateZ(side * 1.2).translate(side * 2.4, -0.6, 0), 0xffe0a0, 1.2, 0.35, 3 / (segs - 1));
    part(new THREE.ConeGeometry(3.2, 7, 4), 0xff9a5a, 1.3, 0.35, 1);
    const km = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false, transparent: true, depthWrite: false });
    km.onBeforeCompile = (sh) => {
      sh.uniforms.uClock = CLOCK;
      sh.vertexShader = 'attribute float aKoi; uniform float uClock;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        { float t = uClock, k = aKoi, s = t * 0.16 - k * 0.55;
          transformed += vec3(sin(s * 1.3) * 14.0 + sin(t * 0.9 - k * 5.0) * 1.5 * k, 30.0 + sin(s * 0.7) * 4.0, -10.0 + cos(s) * 60.0); }`);
      nearFade(km, sh);
    };
    km.customProgramCacheKey = () => 'mega-koi|nearfade';
    const koi = add(new THREE.Mesh(mergeGeometries(geos, false)!, km));
    koi.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 30, -10), 80);
  }

  // ---- the message tower: a slab of light scrolling the city's greeting in three scripts ----
  // the strip is painted once and scrolls in the shader (it was a canvas repainted and uploaded twelve times a second)
  if (rich) { // phones: left out (each is a handful of draw calls a frame for a detail in the sky)
    const c = document.createElement('canvas'); c.width = 128; c.height = 3600;
    const words = ['WELCOME TO ZENVORA', 'ज़ेनवोरा में स्वागत है', 'زینوورا میں خوش آمدید', 'LAST STOP BEFORE THE STARS'];
    { const g = c.getContext('2d')!; g.fillStyle = '#05101e'; g.fillRect(0, 0, 128, 3600);
      g.save(); g.translate(64, 0); g.rotate(Math.PI / 2); g.font = '700 64px Rajdhani, sans-serif';
      for (let i = 0; i < 4; i++) { g.fillStyle = ['#7fe9ff', '#ffb36e', '#ff6ec7', '#b6ff6e'][i]; g.fillText(words[i], i * 900, 22); }
      g.restore(); }
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.wrapT = THREE.RepeatWrapping;
    const sm = new THREE.MeshBasicMaterial({ map: tx, color: new THREE.Color(1.8, 1.8, 1.8), toneMapped: false, fog: false });
    sm.onBeforeCompile = (sh) => {
      sh.uniforms.uClock = CLOCK;
      // a 1024-pixel window down the strip, 75 pixels a second (6 every 0.08 s, as before)
      sh.vertexShader = 'uniform float uClock;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vMapUv.y = 1.0 - ((1.0 - uv.y) * 1024.0 + mod(uClock * 75.0, 3600.0)) / 3600.0;');
      nearFade(sm, sh);
    };
    sm.customProgramCacheKey = () => 'mega-scroll|nearfade';
    const slab = add(new THREE.Mesh(new THREE.PlaneGeometry(14, 110), sm));
    slab.position.set(-34, 60, S - 30); slab.rotation.y = 0.5;
  }

  // ---- the launch tower at the spaceport, and a ship climbing a column of light ----
  {
    const tw = add(new THREE.Mesh(new THREE.BoxGeometry(10, 160, 10), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.6, roughness: 0.4 })));
    tw.position.set(24, 80, S - 58); tw.castShadow = false;
    for (let y = 10; y < 160; y += 12) { const l = add(new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.6, 10.4), glowMat(0xff3030, 2))); l.position.set(24, y, S - 58); }
    const ship = add(new THREE.Group());
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(6, 36, 6, 16), new THREE.MeshStandardMaterial({ color: 0xf0f2f6, metalness: 0.4, roughness: 0.3, fog: false }));
    ship.add(hull);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(4, 16, 260, 24, 1, true), glowMat(0xbfe9ff, 1.6, 0.35)); column.position.y = -150; ship.add(column);
    ship.traverse((x) => { x.userData.ground = false; });
    updates.push((_, t) => {
      const k = (t * 0.02) % 1; ship.position.set(36, 30 + k * k * 900, S - 58); ship.visible = k < 0.95;
      (column.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.15 * Math.sin(t * 20);
    });
  }

  // ---- the spaceport as a spectacle: two great ships holding over the apron, searchlights sweeping the sky ----
  if (rich) { // phones: left out (each is a handful of draw calls a frame for a detail in the sky)
    const hullM = new THREE.MeshStandardMaterial({ color: 0xe8edf4, metalness: 0.45, roughness: 0.3 });
    const ships: THREE.Group[] = [];
    for (const [x, y, z, s] of [[-16, 22, S - 38, 1], [20, 34, S - 80, 1.5]] as [number, number, number, number][]) {
      const g = add(new THREE.Group()); g.position.set(x, y, z); g.scale.setScalar(s);
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(5, 34, 6, 20), hullM); b.rotation.x = Math.PI / 2; g.add(b);
      for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(14, 0.6, 8), hullM); w.position.set(sx * 9, -1, 6); w.rotation.z = sx * -0.12; g.add(w); }
      const belly = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 30), glowMat(0x7fe9ff, 2.4)); belly.position.y = -5.1; g.add(belly);
      for (let i = 0; i < 10; i++) { const wl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 1.2), glowMat(0xffe2b0, 2)); wl.position.set(5.05, 1, -14 + i * 3); g.add(wl); }
      const eng = new THREE.Mesh(new THREE.CircleGeometry(4, 24), glowMat(0x9fdcff, 2.8)); eng.position.z = -22; eng.rotation.y = Math.PI; g.add(eng);
      g.traverse((x2) => { x2.userData.ground = false; }); ships.push(g);
    }
    // the searchlights: one mesh, each beam's foot and sweep in its vertices, the sweep in the shader
    const bgeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < (rich ? 6 : 3); i++) bgeos.push(stamp(new THREE.CylinderGeometry(0.6, 9, 260, 16, 1, true).translate(0, 130, 0), { aBeam: [-40 + i * 16, S - 30 - (i % 2) * 30, i] }));
    const bmM = glowMat(0xbfe9ff, 0.7, 0.16);
    bmM.onBeforeCompile = (sh) => {
      sh.uniforms.uClock = CLOCK;
      sh.vertexShader = 'attribute vec3 aBeam; uniform float uClock;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        { float t = uClock, i = aBeam.z, ax = sin(t * 0.3 + i) * 0.35, az = cos(t * 0.23 + i * 1.7) * 0.35;
          vec3 v = transformed; v.xy = vec2(cos(az) * v.x - sin(az) * v.y, sin(az) * v.x + cos(az) * v.y);
          v.yz = vec2(cos(ax) * v.y - sin(ax) * v.z, sin(ax) * v.y + cos(ax) * v.z);
          transformed = v + vec3(aBeam.x, 0.0, aBeam.y); }`);
      nearFade(bmM, sh);
    };
    bmM.customProgramCacheKey = () => 'mega-beams|nearfade';
    const beamMesh = add(new THREE.Mesh(mergeGeometries(bgeos, false)!, bmM));
    beamMesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 100, S - 45), 200);
    updates.push((_, t) => {
      ships.forEach((g, i) => { g.position.y += Math.sin(t * 0.4 + i) * 0.01; g.rotation.y = 0.3 + Math.sin(t * 0.05 + i) * 0.1; });
    });
  }

  return { update: (dt: number, t: number) => { for (const u of updates) u(dt, t); } };
}
