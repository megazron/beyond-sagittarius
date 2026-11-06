// Dev-only turntable for the crew (not part of the build): vite, then /dev/chars.html
import * as THREE from 'three';
import { randomLook } from '../src/characters/custom';
import { createCharacter, CrewId, Character, CrewPose } from '../src/characters/character';

const ids: CrewId[] = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social', 'megazron'];
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
r.setSize(innerWidth, innerHeight);
r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
r.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x4d6a78);
const sun = new THREE.DirectionalLight(0xfff0d8, 3.6); sun.position.set(4, 7, 6); sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 6, bottom: -2 }); sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = 0.02;
scene.add(sun, new THREE.HemisphereLight(0xbcd6e8, 0x394034, 1.3));
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 40), new THREE.MeshStandardMaterial({ color: 0x35402f, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const cam = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 100);
const alt = new URLSearchParams(location.search).get('skin') ?? undefined;
const customs = new URLSearchParams(location.search).get('custom');
const chars: Character[] = (window as unknown as { chars: Character[] }).chars = ids.map((id, i) => { const c = customs ? createCharacter('scientist', 1, randomLook({ name: 'x', gender: i % 2 ? 'f' : 'm' })) : createCharacter(id, 1, undefined, id === 'strong' ? alt : undefined); c.root.position.x = (i - 2.5) * 1.3; scene.add(c.root); return c; });
let pose: CrewPose = 'stand', amount = 0, t = 0, phase = 0;
const W = window as unknown as Record<string, unknown>;
W.view = (i: number, d: number, yaw: number, h: number, dist: number) => {
  const c = i < 0 ? new THREE.Vector3(0, 0, 0) : chars[i].root.position;
  cam.position.set(c.x + Math.sin(yaw) * dist, h, c.z + Math.cos(yaw) * dist);
  cam.lookAt(c.x, d, c.z);
};
W.pose = (p: CrewPose, a = 0) => { pose = p; amount = a; };
W.step = (n: number, dt = 1 / 30) => { for (let k = 0; k < n; k++) { t += dt; phase += dt * 7 * amount; chars.forEach((c) => { c.root.updateMatrixWorld(); c.animate(pose, phase, amount, t, dt); }); } r.render(scene, cam); };
/** Foot slide probe: walk a character at v m/s over flat ground, report world drift of planted feet. */
W.slide = (i: number, v: number, n = 240, dt = 1 / 60) => {
  const c = chars[i]; const res: number[] = [];
  c.setGround(() => 0);
  const b = (name: string) => c.fig.getObjectByName(name)!;
  const last: Record<string, THREE.Vector3> = {};
  const p = new THREE.Vector3(), lows: number[] = [];
  for (let k = 0; k < n; k++) {
    c.root.position.z += v * dt; t += dt;
    c.root.updateMatrixWorld(true);
    c.animate('walk', 0, v / 4, t, dt);
    c.root.updateMatrixWorld(true);
    for (const s of ['footL', 'footR']) {
      b(s).getWorldPosition(p);
      if (last[s] && k > 60 && p.y < 0.13) res.push(Math.hypot(p.x - last[s].x, p.z - last[s].z) / dt);
      if (k > 60) lows.push(p.y);
      (last[s] ??= new THREE.Vector3()).copy(p);
    }
  }
  res.sort((a, b2) => a - b2);
  c.root.position.z = 0;
  return { medianStanceSlide: res[res.length >> 1], p90: res[Math.floor(res.length * 0.9)], minFootY: Math.min(...lows) };
};
/** Walk one character past the camera, a frame every few steps. */
W.film = (i: number, v: number, k: number) => {
  const c = chars[i];
  chars.forEach((o, j) => { o.root.visible = j === i; });
  c.setGround(() => 0);
  for (let n = 0; n < k; n++) { c.root.position.z += v / 60; t += 1 / 60; c.root.updateMatrixWorld(true); c.animate('walk', 0, v / 4, t, 1 / 60); }
  const p = c.root.position;
  cam.position.set(p.x + 3.6, 1.1, p.z + 0.2); cam.lookAt(p.x, 0.95, p.z);
  r.render(scene, cam);
};
(W.view as Function)(-1, 1, 0, 1.3, 11);
Promise.all(chars.map((c) => c.whenReady)).then(() => { (W.step as Function)(4); setTimeout(() => { (W.step as Function)(2); W.ready = true; }, 3000); });
