import * as THREE from 'three';
import type { Quality } from '../core/quality';
import { smoothstep } from '../core/noise';
import { Terrain } from './terrain';
import { Sky } from './sky';
import { Forest, windUniforms } from './forest';
import { createGrass } from './grass';
import { createWater } from './water';
import { createPod, createItems } from './props';
import { createCreature } from './creature';

/** The alien planet: terrain, sky, forest, water, props, lights and fog. */
export class World {
  scene = new THREE.Scene();
  terrain: Terrain;
  sky = new Sky();
  forest!: Forest;
  grass!: ReturnType<typeof createGrass>;
  water!: ReturnType<typeof createWater>;
  pod!: ReturnType<typeof createPod>;
  items!: ReturnType<typeof createItems>;
  creature!: ReturnType<typeof createCreature>;
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0x8fb7c8, 0x1a2420, 0.6);
  fog: THREE.FogExp2;
  ready = false;
  onCreatureStep: (p: THREE.Vector3) => void = () => {};
  private lightDir = new THREE.Vector3();

  constructor(private q: Quality) {
    this.terrain = new Terrain(q);
    this.fog = new THREE.FogExp2(0xbcd6cf, q.fogDensity);
    this.scene.fog = this.fog;
  }

  async build(onProgress: (p: number) => void) {
    await this.terrain.generate(onProgress);
    await this.terrain.buildMeshes(onProgress);
    const s = this.scene;
    s.add(this.sky.group);
    s.add(this.terrain.group);
    this.forest = new Forest(this.terrain, this.q);
    this.forest.build();
    onProgress(0.94);
    await new Promise((r) => setTimeout(r, 0));
    s.add(this.forest.group);
    this.grass = createGrass(this.terrain, this.q);
    s.add(this.grass.mesh);
    this.water = createWater(this.terrain, this.sky);
    s.add(this.water.mesh);
    this.pod = createPod(this.terrain, this.forest);
    s.add(this.pod.root);
    this.items = createItems(this.terrain, this.forest);
    s.add(this.items.group);
    this.creature = createCreature(this.terrain, (p) => this.onCreatureStep(p));
    s.add(this.creature.root);

    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(this.q.shadowMapSize, this.q.shadowMapSize);
    const ext = this.q.shadowExtent;
    Object.assign(sh.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 500 });
    sh.camera.updateProjectionMatrix();
    sh.bias = -0.0004;
    sh.normalBias = 0.04;
    s.add(this.sun, this.sun.target, this.hemi);
    onProgress(1);
    this.ready = true;
  }

  /** Objects that must not be drawn by the AO normal pass. */
  aoHidden(): THREE.Object3D[] {
    return [this.sky.group, this.grass.mesh, this.water.mesh];
  }

  update(dt: number, time: number, hours: number, focus: THREE.Vector3, cam: THREE.Camera, renderer: THREE.WebGLRenderer) {
    const sky = this.sky;
    sky.update(hours, cam.position, time);
    const e = sky.sunDir.y;
    // sun by day, moon by night
    const sunUp = smoothstep(-0.06, 0.08, e);
    this.lightDir.copy(sunUp > 0.5 ? sky.sunDir : sky.moonDir);
    if (this.lightDir.y < 0.12) { this.lightDir.y = 0.12; this.lightDir.normalize(); }
    this.sun.position.copy(focus).addScaledVector(this.lightDir, 220);
    this.sun.target.position.copy(focus);
    // snap shadow camera to texels to avoid shimmering
    const texel = (this.q.shadowExtent * 2) / this.q.shadowMapSize;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    this.sun.position.x = this.sun.target.position.x + this.lightDir.x * 220;
    this.sun.position.z = this.sun.target.position.z + this.lightDir.z * 220;

    const day = sky.day;
    const sunI = 3.4 * smoothstep(-0.02, 0.25, e);
    const moonI = 0.55 * (1 - sunUp);
    this.sun.intensity = sunUp > 0.5 ? Math.max(sunI, 0.4) : moonI;
    this.sun.color.copy(sunUp > 0.5 ? sky.sunColor : new THREE.Color(0x9fb4ff));
    this.hemi.color.copy(sky.zenith).lerp(new THREE.Color(0xffffff), 0.25);
    this.hemi.groundColor.set(0x141c1a).lerp(new THREE.Color(0x2a3a33), day);
    this.hemi.intensity = 0.35 + day * 0.65;
    this.fog.color.copy(sky.horizon);
    this.fog.density = this.q.fogDensity * (1 + (1 - day) * 0.5);
    renderer.toneMappingExposure = 0.95 + (1 - day) * 0.55;
    this.forest.setGlow(1.6 + (1 - day) * 2.4);

    windUniforms.uTime.value = time;
    this.grass.update(focus);
    this.water.update(time, day);
    this.forest.update(cam.position);
    this.pod.update(time);
    this.items.update(time, focus);
    this.creature.update(dt);
  }
}
