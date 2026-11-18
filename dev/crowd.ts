// Dev only: what a street of bodies costs the CPU per frame, the way Zenvora has them: the six crew at full detail, a
// crowd of creator bodies (townsfolk, walkers, people in groups) at the street's 0.8 detail, the follow camera behind
// the player. animMs is the time in every body's animate() alone (no WebGL in it); the page draws as the game does, so
// what is on screen and how far it is decide what each body does. ?n=60. Written to run on older commits too
// (copied into their worktrees by tools/crowd_cpu.py), so it only uses what has always been exported.
import * as THREE from 'three';
import * as CH from '../src/characters/character';
import { randomLook, OUTFITS } from '../src/characters/custom';
const q = new URLSearchParams(location.search);
const n = Number(q.get('n') ?? 60), detail = Number(q.get('detail') ?? 1);
const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c') as HTMLCanvasElement, antialias: false });
r.setSize(innerWidth, innerHeight); r.shadowMap.enabled = true;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x4d6a78);
const sun = new THREE.DirectionalLight(0xffffff, 3); sun.position.set(10, 20, 8); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 100 }); scene.add(sun, new THREE.HemisphereLight(0xbcd6e8, 0x394034, 1.2));
const g = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x556655 })); g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);
const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500); cam.position.set(0, 2.6, -5.2); cam.lookAt(0, 1.3, 6);
let rs = 7; const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
const W = window as unknown as Record<string, unknown>;
const people: { c: CH.Character; v: number; z0: number }[] = [];
const CREW = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social'] as const;
(async () => {
  const keys = [...CREW, ...OUTFITS.flatMap((o) => [`custom_m_${o}`, `custom_f_${o}`])];
  await CH.preloadCrew(keys, detail);
  for (let i = 0; i < n; i++) {
    const crew = i < 6;
    const c = crew ? CH.createCharacter(CREW[i], detail)
      : CH.createCharacter('scientist', detail * 0.8, { ...randomLook({ name: '', gender: i % 2 ? 'f' : 'm' }), outfit: OUTFITS[i % 6] } as Parameters<typeof CH.createCharacter>[2]);
    (c as { setCrowd?: (on: boolean) => void }).setCrowd?.(!crew);
    // the crew close by, the crowd along both pavements up to 60 m ahead; a third of the crowd walks
    const x = crew ? (i - 2.5) * 1.3 : (i % 2 ? 1 : -1) * (3 + (i % 5) * 0.8), z = crew ? 2 + (i % 2) : 3 + (i - 6) * 1.1;
    c.root.position.set(x, 0, z); c.setGround(() => 0); scene.add(c.root);
    people.push({ c, v: !crew && i % 3 === 0 ? 1.1 + rnd() * 0.5 : 0, z0: z });
  }
  await Promise.all(people.map((p) => p.c.whenReady));
  W.ready = true;
})();
let t = 0; const anim: number[] = [];
function frame() {
  requestAnimationFrame(frame);
  if (!W.ready) return;
  const dt = 1 / 60; t += dt;
  const a0 = performance.now();
  for (const p of people) {
    if (p.v) { p.c.root.position.z += p.v * dt; if (p.c.root.position.z > p.z0 + 20) p.c.root.position.z = p.z0; }
    p.c.root.updateMatrixWorld(); p.c.animate(p.v ? 'walk' : 'idle', t * 2, p.v / 4, t, dt);
  }
  anim.push(performance.now() - a0);
  r.render(scene, cam);
}
requestAnimationFrame(frame);
W.animMs = () => { const s = anim.slice(-120).sort((x, y) => x - y); return { median: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], frames: anim.length }; };
W.info = () => ({ calls: r.info.render.calls, tris: r.info.render.triangles });
