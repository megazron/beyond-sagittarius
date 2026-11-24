import * as THREE from 'three';
import { addCutsceneRig } from '../cinematic/cutscene';
import type { Quality } from '../core/quality';
import { smoothstep } from '../core/noise';
import { Terrain } from './terrain';
import { Sky } from './sky';
import { Forest, windUniforms } from './forest';
import { createGrass } from './grass';
import { createWater } from './water';
import { createPod, createItems } from './props';
import { addResources } from './resources';
import { createCreature } from './creature';
import { computeLayout, reserveLayout, createCamp, createRidge, StoryLayout } from './story';
import { createCharacter, Character } from '../characters/character';
import { createHound } from './predator';
import { Environment } from './environment';
import { atmosphere, patchSceneFog } from './atmosphere';
import { freezeTree } from '../core/merge';
import { SunLight } from 'three/examples/jsm/lights/SunLight.js';
import type { PostSource } from '../core/renderer';
import { applyMetal } from './pbr';
import { loadModelPack, loadFoliageCard } from './models';

/** Where a new game wakes up (Player.spawn(0, 2) in main). */
const WAKE_SPAWN = { x: 0, z: 2 };

/** The alien planet: terrain, sky, forest, water, props, lights and fog. */
export class World {
  scene = new THREE.Scene();
  terrain: Terrain;
  sky: Sky;
  forest!: Forest;
  grass!: ReturnType<typeof createGrass>;
  water!: ReturnType<typeof createWater>;
  pod!: ReturnType<typeof createPod>;
  items!: ReturnType<typeof createItems>;
  creature!: ReturnType<typeof createCreature>;
  layout!: StoryLayout;
  clearings: [number, number, number][] = [];
  /** Show finished Chapter Two work around the fire. */
  setCampWork: (done: string[]) => void = () => {};
  pod2!: ReturnType<typeof createPod>;
  camp!: ReturnType<typeof createCamp>;
  ridge!: ReturnType<typeof createRidge>;
  /** The crewmate found in this arc (the Explorer). */
  explorer!: Character;
  hound!: ReturnType<typeof createHound>;
  /** Sun or moon, with two shadow cascades fitted to the view by three's SunLight. */
  sun = new SunLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0x8fb7c8, 0x1a2420, 0.6);
  /**
   * Night that you can play in (release review: "almost black away from the fire", night shots left out of the store
   * set). A full night is still dark and blue, but the ground under the moon and the giant planet reads, the sky glows
   * at the horizon so trees and hills stand out against it, and the near ground has a cold fill. moon: the moonlight's
   * intensity (was 0.55); fill: the sky light's intensity at night (was 0.4); sky/ground: its colours at night; env: the
   * image light at night (was 0.42); exposure: how far the eye opens up at night (was 0.6). The fight's own planet fill (combat.ts, 1.55 at 34 degrees) and the eye stopping
   * down near a fire (0.78) sit on top of these; the story's camp fire light is 3.5. (GPU stills, release fixes: mean
   * brightness of the frame 12 of 255 with the old values, 26 to 30 with these; 1.05 / 0.62 / 0.55 gave 14, still black)
   */
  night = { moon: 3.0, fill: 1.4, sky: new THREE.Color(0x5d6f9c), ground: new THREE.Color(0x1f2a33), env: 1.0, exposure: 0.9 };
  fog: THREE.FogExp2;
  ready = false;
  onCreatureStep: (p: THREE.Vector3) => void = () => {};
  private lightDir = new THREE.Vector3();
  env!: Environment;
  private envGround = new THREE.Color();
  private fogPatchAt = 0;
  private shadowFrame = 0;
  private reflHidden: THREE.Object3D[] | null = null;
  /** Sunlit air for the renderer's volumetric pass. */
  post!: PostSource;

  constructor(public q: Quality) {
    this.terrain = new Terrain(q);
    this.sky = new Sky(q.cloudSteps);
    this.fog = new THREE.FogExp2(0xbcd6cf, q.fogDensity);
    this.scene.fog = this.fog;
  }

  async build(onProgress: (p: number) => void) {
    // the scans download while the terrain generates
    const assets = Promise.all([loadModelPack(this.q), loadFoliageCard('fir', this.q), loadFoliageCard('pine', this.q), loadFoliageCard('leaf', this.q)]);
    await this.terrain.generate(onProgress);
    await this.terrain.buildMeshes(onProgress);
    const s = this.scene;
    s.add(this.sky.group);
    s.add(this.terrain.group);
    this.layout = computeLayout(this.terrain);
    const [pack, fir, pine, leaf] = await assets;
    this.forest = new Forest(this.terrain, this.q, pack, { fir, pine, leaf });
    reserveLayout(this.forest, this.layout);
    // the wake-up looks from the spawn up at the giant: open ground that way, or its line played over pine trees
    const g = this.sky.giantDir, n = Math.hypot(g.x, g.z);
    for (const d of [7, 13, 19, 26, 34, 42]) this.forest.reserve(WAKE_SPAWN.x + (g.x / n) * d, WAKE_SPAWN.z + (g.z / n) * d, 2.5 + d * 0.18);
    this.forest.build();
    onProgress(0.94);
    await new Promise((r) => setTimeout(r, 0));
    s.add(this.forest.group);
    this.grass = createGrass(this.terrain, this.q);
    s.add(this.grass.mesh);
    this.water = createWater(this.terrain, this.sky, this.q);
    s.add(this.water.mesh);
    this.pod = createPod(this.terrain, this.forest);
    s.add(this.pod.root);
    const L = this.layout;
    this.items = createItems(this.terrain, this.forest, { camp: L.camp, pod: L.pod, pod2: L.pod2 }, pack, this.q);
    s.add(this.items.group);
    this.setCampWork = addResources(this.items.items, this.items.group, this.terrain, this.forest, L);
    this.pod2 = createPod(this.terrain, this.forest, L.pod2.x, L.pod2.z, -1.9, 23);
    s.add(this.pod2.root);
    this.camp = createCamp(this.terrain, this.forest, L);
    s.add(this.camp.root);
    this.ridge = createRidge(L);
    s.add(this.ridge.root);
    this.explorer = createCharacter('explorer', this.q.name === 'mobile' ? 0.6 : this.q.name === 'cinematic' ? 1.4 : 1);
    this.explorer.setGround((x, z) => this.terrain.height(x, z));
    this.explorer.root.position.copy(L.crewSpot);
    s.add(this.explorer.root);
    this.clearings = [
      [L.camp.x - 1.2, L.camp.z + 1.2, 6.5],
      [L.beacon.x, L.beacon.z, 2.2],
      [L.crewSpot.x, L.crewSpot.z, 2.5],
      [L.pod2.x, L.pod2.z, 4],
    ];
    this.grass.setClearings(this.clearings);
    this.hound = createHound();
    s.add(this.hound.root);
    this.creature = createCreature(this.terrain, (p) => this.onCreatureStep(p));
    s.add(this.creature.root);

    const metals: THREE.MeshStandardMaterial[] = [];
    s.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && !Array.isArray(m) && m.userData?.pbr === 'metal' && !metals.includes(m)) metals.push(m);
    });
    applyMetal(metals, this.q, 3);
    this.env = new Environment(this.q, this.sky);
    patchSceneFog(s);

    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(this.q.shadowMapSize, this.q.shadowMapSize);
    sh.camera.far = this.q.shadowRange;
    sh.camera.near = 1;
    sh.bias = -0.00022;
    sh.normalBias = 0.05;
    sh.radius = this.q.shadowSoftness;
    sh.autoUpdate = this.q.shadowInterval <= 1;
    s.add(this.sun, this.hemi);
    this.post = { sun: this.sun, sunDir: this.lightDir, sunColor: this.sun.color, density: 0.002, fall: 0.03, base: 0, strength: 0 };
    s.userData.post = this.post;
    onProgress(1);
    addCutsceneRig(this.scene);
    // the ground and the forest's instanced lists never move: their matrices are composed once (phones spent a tenth
    // of a frame recomposing matrices)
    freezeTree(this.terrain.group); freezeTree(this.forest.group);
    this.ready = true;
  }

  /** Objects that must not be drawn by the AO normal pass. */
  aoHidden(): THREE.Object3D[] {
    return [this.sky.group, this.grass.mesh, this.water.mesh];
  }

  /**
   * `drawn` false: another stage is on screen (Zenvora, a crewmate's stage). Light, sky and time still run (the stage's
   * exposure follows them), but the grass, the forest and the lake's mirrored render of the whole world are left alone:
   * the lake used to redraw the planet for a camera standing in the city (5.7 M triangles a frame on Ultra).
   */
  update(dt: number, time: number, hours: number, focus: THREE.Vector3, cam: THREE.Camera, renderer: THREE.WebGLRenderer, drawn = true) {
    const sky = this.sky;
    sky.update(hours, cam.position, time);
    const e = sky.sunDir.y;
    // sun by day, moon by night
    const sunUp = smoothstep(-0.06, 0.08, e);
    this.lightDir.copy(sunUp > 0.5 ? sky.sunDir : sky.moonDir);
    if (this.lightDir.y < 0.12) { this.lightDir.y = 0.12; this.lightDir.normalize(); }
    this.sun.position.copy(this.lightDir); // SunLight: direction only, cascades follow the camera
    // the leaf cards are the most expensive thing in the frame: don't redraw them every frame
    this.shadowFrame++;
    this.sun.shadow.needsUpdate = this.shadowFrame % this.q.shadowInterval === 0;

    const day = sky.day;
    const sunI = 4.6 * smoothstep(-0.02, 0.25, e);
    const N = this.night, nk = 1 - day; // nk: how much of night it is
    const moonI = N.moon * (1 - sunUp);
    this.sun.intensity = sunUp > 0.5 ? Math.max(sunI, 0.4) : moonI;
    this.sun.color.copy(sunUp > 0.5 ? sky.sunColor : new THREE.Color(0x9fb4ff));
    this.hemi.color.copy(sky.zenith).lerp(WHITE, 0.25).lerp(N.sky, nk);
    this.hemi.groundColor.copy(N.ground).lerp(tmpG.set(0x2a3a33), day);
    // image-based light carries most of the ambient now; the hemisphere fills in
    this.envGround.set(0x101814).lerp(tmpG.set(0x3a4a40), day).multiply(tmpG2.copy(this.sun.color).lerp(WHITE, 0.6));
    // the planet's image light is captured again only while the planet is on screen (a capture is six sky renders and
    // a filter pass: a spike every few seconds in the city, for a scene nobody sees)
    const envTex = drawn || !this.env.texture ? this.env.update(renderer, time, this.envGround) : this.env.texture;
    if (envTex) {
      this.scene.environment = envTex;
      this.scene.environmentIntensity = N.env + day * (1.1 - N.env);
    }
    this.hemi.intensity = (N.fill + day * (1.1 - N.fill)) * (envTex ? 0.72 : 1);
    this.fog.color.copy(sky.horizon);
    this.fog.density = this.q.fogDensity * (1 + (1 - day) * 0.5);
    // valley mist: thickest around dawn and at night, thin at noon
    const dawn = 1 - smoothstep(0.0, 0.35, Math.abs(e - 0.05));
    atmosphere.uFogHeight.value = 0.35 + (1 - day) * 0.9 + dawn * 1.2;
    atmosphere.uFogSunDir.value.copy(sunUp > 0.5 ? sky.sunDir : sky.moonDir);
    atmosphere.uFogSun.value.copy(sky.sunColor).multiplyScalar(sunUp > 0.5 ? 0.32 * smoothstep(-0.05, 0.15, e) : 0.05);
    if (time - this.fogPatchAt > 2 || time < this.fogPatchAt) { patchSceneFog(this.scene); this.fogPatchAt = time; }
    // a low sun already glows through the haze: keep the shafts from washing the frame out
    this.post.strength = sunUp > 0.5 ? 0.15 + 0.85 * smoothstep(0.05, 0.3, e) : 0.25;
    this.post.density = 0.0016 * (1 + dawn * 0.5);
    renderer.toneMappingExposure = 0.82 + (1 - day) * N.exposure;
    this.forest.setGlow(0.9 + (1 - day) * 2.2);
    this.forest.setSun(this.lightDir, this.sun.color);

    windUniforms.uTime.value = time;
    this.water.update(time, day, envTex);
    if (drawn) {
      this.grass.update(focus);
      this.forest.update(cam.position, cam);
      this.terrain.update(cam.position);
      // the lake mirrors the land, the sky and the trees; the stones, sticks, plants and bodies on the shore are a pixel
      // or two in it and were half its draw calls (the mirrored render was a seventh of the planet's frame on Web)
      this.reflHidden ??= [this.water.mesh, this.grass.mesh, this.items.group, this.creature.root, this.hound.root, this.explorer.root, this.camp.root, ...this.forest.small];
      this.water.reflect(renderer, this.scene, cam as THREE.PerspectiveCamera, this.reflHidden);
    }
    // the pods' smoke, the camp's fire, the pickups' rings and the giant on the horizon are only looks: while another
    // stage is on screen (Zenvora) they wait. In the city they were a tenth of a phone's update, and the giant's
    // footsteps still rumbled and shook the camera there, measured from wherever you stood in the street
    if (!drawn) return;
    this.pod.update(time);
    this.pod2.update(time + 7.3);
    this.camp.update(time, dt, focus);
    this.items.update(time, focus);
    this.creature.update(dt);
  }
}
const tmpG = new THREE.Color();
const tmpG2 = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
