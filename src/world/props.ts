import * as THREE from 'three';
import { mulberry32, smoothstep } from '../core/noise';
import { Terrain, LAKE } from './terrain';
import type { Forest } from './forest';

export type ItemType = 'stone' | 'branch' | 'fruit' | 'redFruit';

export interface Item {
  id: string;
  type: ItemType;
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  active: boolean;
  examined?: boolean;
}

/** Crashed escape pod with smoke, sparks and debris at the spawn point. */
export function createPod(terrain: Terrain, forest: Forest) {
  const group = new THREE.Group();
  const x = 4.5, z = -3.5;
  const y = terrain.height(x, z);
  group.position.set(x, y - 0.6, z);
  group.rotation.set(0.35, 0.8, 0.25);
  const hull = new THREE.MeshStandardMaterial({ color: 0xa9afb8, metalness: 0.25, roughness: 0.62 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xff7a2a, roughness: 0.55, emissive: 0x401000 });
  const burnt = new THREE.MeshStandardMaterial({ color: 0x1b1714, metalness: 0.3, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b1420, metalness: 0.9, roughness: 0.1, emissive: 0x0a2a44, emissiveIntensity: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 2.2, 8, 24), hull);
  body.rotation.z = Math.PI / 2;
  group.add(body);
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1.18, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), burnt);
  shield.rotation.z = Math.PI / 2; shield.position.x = -1.1; shield.scale.set(1, 0.6, 1);
  group.add(shield);
  const win = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 10, 0, Math.PI, 0, Math.PI / 2), glass);
  win.position.set(0.8, 0.7, 0); win.rotation.x = -Math.PI / 2; win.scale.set(1, 1, 0.5);
  group.add(win);
  for (const sx of [-0.4, 0.9]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.13, 1.13, 0.16, 32, 1, true), stripe);
    band.rotation.z = Math.PI / 2; band.position.x = sx; group.add(band);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 5), burnt);
  antenna.position.set(1.2, 1.2, -0.3); antenna.rotation.z = -0.5; group.add(antenna);
  const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 0.5, 16), burnt);
  thruster.rotation.z = Math.PI / 2; thruster.position.x = 2.3; group.add(thruster);
  const hatch = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 1.4), hull);
  hatch.position.set(0.4, -0.2, 1.6); hatch.rotation.set(0.9, 0.2, 0.1);
  group.add(hatch);
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.6, 0.3) });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), lightMat);
  beacon.position.set(1.9, 0.6, 0.2); group.add(beacon);
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // Scorched debris trail
  const rnd = mulberry32(11);
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x8d939c, metalness: 0.7, roughness: 0.5 });
  const debris = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.2 + rnd() * 0.7, 0.04, 0.2 + rnd() * 0.5), i % 3 ? debrisMat : burnt);
    const dx = x + 3 + rnd() * 18, dz = z + 2 + (rnd() - 0.5) * 8;
    d.position.set(dx, terrain.height(dx, dz) + 0.03, dz);
    d.rotation.set((rnd() - 0.5) * 0.6, rnd() * 6, (rnd() - 0.5) * 0.6);
    d.castShadow = true; d.receiveShadow = true;
    debris.add(d);
  }
  // furrow of churned earth
  const furrow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 20), new THREE.MeshStandardMaterial({ color: 0x1e1a1c, roughness: 1, transparent: true, opacity: 0.75 }));
  furrow.rotation.x = -Math.PI / 2; furrow.rotation.z = Math.PI / 2 - 0.1;
  furrow.position.set(x + 11, terrain.height(x + 11, z) + 0.06, z + 0.5);
  forest.addObstacle(x, z, 1.8);

  // Smoke column (soft sprites)
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const N = 70;
  const smokePos = new Float32Array(N * 3);
  const seeds = new Float32Array(N);
  for (let i = 0; i < N; i++) seeds[i] = rnd();
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
  const smokeLife = new Float32Array(N);
  smokeGeo.setAttribute('aLife', new THREE.BufferAttribute(smokeLife, 1));
  const smokeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uScale: { value: 1 } }]),
    vertexShader: `attribute float aLife; varying float vLife; varying float vFade; uniform float uScale;
      #include <fog_pars_vertex>
      void main(){ vLife = aLife; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vFade = smoothstep(3.0, 12.0, -mvPosition.z);
        gl_PointSize = (1.5 + aLife * 7.0) * uScale / -mvPosition.z; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D uMap; varying float vLife; varying float vFade;
      #include <fog_pars_fragment>
      void main(){ float a = texture2D(uMap, gl_PointCoord).a * sin(vLife * 3.14159) * 0.32 * vFade;
        gl_FragColor = vec4(mix(vec3(0.12, 0.11, 0.12), vec3(0.42, 0.42, 0.46), vLife), a);
        #include <fog_fragment>
      }`,
  });
  smokeMat.uniforms.uMap.value = tex;
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  smoke.frustumCulled = false;
  smoke.onBeforeRender = (r) => { smokeMat.uniforms.uScale.value = r.domElement.height * 0.5 / Math.tan(Math.PI / 6); };

  const sparksGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(20 * 3);
  sparksGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparksGeo, new THREE.PointsMaterial({ size: 0.12, color: new THREE.Color(6, 3, 1), transparent: true }));
  sparks.frustumCulled = false;

  const root = new THREE.Group();
  void furrow;
  root.add(group, debris, smoke, sparks);
  const src = new THREE.Vector3(x - 0.5, y + 0.6, z);
  return {
    root,
    update(t: number) {
      for (let i = 0; i < N; i++) {
        const life = (t * 0.08 + seeds[i]) % 1;
        const drift = life * life;
        smokePos[i * 3] = src.x + Math.sin(seeds[i] * 40) * life * 2 + drift * 9;
        smokePos[i * 3 + 1] = src.y + life * 22;
        smokePos[i * 3 + 2] = src.z + Math.cos(seeds[i] * 33) * life * 2 - drift * 3;
        smokeLife[i] = life;
      }
      smokeGeo.attributes.aLife.needsUpdate = true;
      smokeGeo.attributes.position.needsUpdate = true;
      for (let i = 0; i < 20; i++) {
        const life = (t * 1.3 + i / 20) % 1;
        const a = i * 2.4;
        sparkPos[i * 3] = src.x + 1.5 + Math.cos(a) * life * 0.8;
        sparkPos[i * 3 + 1] = src.y - 0.2 + life * 0.9 - life * life * 1.4;
        sparkPos[i * 3 + 2] = src.z + Math.sin(a) * life * 0.8;
      }
      sparksGeo.attributes.position.needsUpdate = true;
      sparks.visible = Math.sin(t * 2.3) + Math.sin(t * 5.1) > 0.9;
      lightMat.color.setRGB(Math.sin(t * 3) > 0 ? 5 : 0.2, 0.4, 0.2);
    },
  };
}

/** Collectable stones and branches + glowpod (safe) and thornberry (toxic) bushes. */
export function createItems(terrain: Terrain, forest: Forest) {
  const group = new THREE.Group();
  const items: Item[] = [];
  const rnd = mulberry32(42);
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8494, roughness: 0.85 });
  const branchMat = new THREE.MeshStandardMaterial({ color: 0x5a4334, roughness: 0.9 });
  const stoneGeo = new THREE.DodecahedronGeometry(0.16, 1);
  {
    const p = stoneGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * 0.6);
    stoneGeo.computeVertexNormals();
  }
  const branchGeo = new THREE.CylinderGeometry(0.025, 0.04, 1.1, 6, 3);
  branchGeo.rotateZ(Math.PI / 2);
  {
    const p = branchGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.sin(p.getX(i) * 3) * 0.04);
    branchGeo.computeVertexNormals();
  }
  const twig = new THREE.CylinderGeometry(0.012, 0.02, 0.35, 4);
  twig.rotateZ(0.9); twig.translate(0.2, 0.08, 0);

  const ringGeo = new THREE.RingGeometry(0.35, 0.42, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.4, 2.6), transparent: true, opacity: 0.0, depthWrite: false });

  const placeOnGround = (type: 'stone' | 'branch', count: number, minR: number, maxR: number) => {
    let k = 0, tries = 0;
    while (k < count && tries < 4000) {
      tries++;
      const a = rnd() * Math.PI * 2, r = minR + rnd() * (maxR - minR);
      const x = Math.cos(a) * r + 2, z = Math.sin(a) * r - 4;
      const h = terrain.height(x, z);
      if (h < 0.6) continue;
      const o = new THREE.Group();
      if (type === 'stone') {
        const m = new THREE.Mesh(stoneGeo, stoneMat);
        m.scale.setScalar(0.8 + rnd() * 0.8); m.rotation.y = rnd() * 6;
        o.add(m);
      } else {
        const m = new THREE.Mesh(branchGeo, branchMat);
        o.add(m);
        const tw = new THREE.Mesh(twig, branchMat); o.add(tw);
        o.rotation.y = rnd() * 6;
      }
      o.children.forEach((c) => { c.castShadow = true; });
      const ring = new THREE.Mesh(ringGeo, ringMat.clone());
      ring.position.y = 0.02; ring.name = 'ring';
      o.add(ring);
      o.position.set(x, h + 0.06, z);
      group.add(o);
      items.push({ id: `${type}-${k}`, type, obj: o, pos: o.position, active: true });
      k++;
    }
  };
  placeOnGround('stone', 7, 5, 22);
  placeOnGround('branch', 7, 5, 22);
  placeOnGround('stone', 22, 22, 110);
  placeOnGround('branch', 22, 22, 110);

  // Fruit bushes along the lake shore, between spawn and water
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x1d4c49, roughness: 0.7, side: THREE.DoubleSide });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x2b2f28, roughness: 0.9 });
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x3aa9ff, roughness: 0.25, emissive: new THREE.Color(0.2, 0.9, 1.6), emissiveIntensity: 1.4 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xa3132a, roughness: 0.35, metalness: 0.1, emissive: 0x3a0008, emissiveIntensity: 0.6 });
  const thornGeo = new THREE.ConeGeometry(0.02, 0.09, 4);
  const toLake = new THREE.Vector2(LAKE.x, LAKE.z).normalize();
  let bushIndex = 0;
  for (let i = 0; i < 14; i++) {
    const safe = i % 5 !== 1 && i % 5 !== 3;
    const ang = Math.atan2(toLake.y, toLake.x) + (rnd() - 0.5) * 2.4;
    // spread along the shore facing spawn
    let bx = 0, bz = 0, h = 0, ok = false;
    for (let t = 0; t < 40 && !ok; t++) {
      const rr = LAKE.r + 4 + rnd() * 18;
      const a2 = Math.atan2(-LAKE.z, -LAKE.x) + (rnd() - 0.5) * 2.2;
      bx = LAKE.x + Math.cos(a2) * rr; bz = LAKE.z + Math.sin(a2) * rr;
      h = terrain.height(bx, bz);
      ok = h > 0.5 && h < 8;
    }
    void ang;
    if (!ok) continue;
    const bush = new THREE.Group();
    bush.position.set(bx, h, bz);
    for (let s = 0; s < 6; s++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, 1.1, 5), stemMat);
      st.position.y = 0.5; st.rotation.set((rnd() - 0.5) * 0.9, 0, (rnd() - 0.5) * 0.9);
      bush.add(st);
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 5), leafMat);
      leaf.scale.set(1, 0.18, 0.5);
      leaf.position.set((rnd() - 0.5) * 0.9, 0.5 + rnd() * 0.6, (rnd() - 0.5) * 0.9);
      leaf.rotation.set(rnd(), rnd() * 6, rnd() * 0.5);
      bush.add(leaf);
    }
    bush.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(bush);
    forest.addObstacle(bx, bz, 0.45);
    for (let f = 0; f < 3; f++) {
      const fruit = new THREE.Group();
      const m = new THREE.Mesh(new THREE.SphereGeometry(safe ? 0.11 : 0.09, 14, 10), safe ? blueMat : redMat);
      m.scale.y = safe ? 1.3 : 1;
      fruit.add(m);
      if (!safe) {
        for (let k = 0; k < 10; k++) {
          const th = new THREE.Mesh(thornGeo, stemMat);
          const dir = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
          th.position.copy(dir).multiplyScalar(0.09);
          th.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          fruit.add(th);
        }
      }
      const fa = (f / 3) * Math.PI * 2 + rnd();
      fruit.position.set(bx + Math.cos(fa) * 0.42, h + 0.75 + rnd() * 0.35, bz + Math.sin(fa) * 0.42);
      group.add(fruit);
      items.push({ id: `${safe ? 'fruit' : 'red'}-${bushIndex}-${f}`, type: safe ? 'fruit' : 'redFruit', obj: fruit, pos: fruit.position, active: true });
    }
    bushIndex++;
  }

  return {
    group,
    items,
    update(t: number, player: THREE.Vector3) {
      for (const it of items) {
        if (!it.active) continue;
        const d = it.pos.distanceTo(player);
        const ring = it.obj.getObjectByName('ring') as THREE.Mesh | undefined;
        if (ring) {
          (ring.material as THREE.MeshBasicMaterial).opacity = smoothstep(9, 3, d) * (0.5 + 0.3 * Math.sin(t * 4));
          ring.scale.setScalar(1 + 0.1 * Math.sin(t * 4));
        }
        if (it.type === 'fruit') it.obj.position.y += Math.sin(t * 1.5 + it.pos.x) * 0.0005;
      }
    },
  };
}
