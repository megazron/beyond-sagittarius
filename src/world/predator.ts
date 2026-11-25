import * as THREE from 'three';
import { loft, limb, grainNormal } from '../characters/shapes';

export interface HoundOptions {
  /** The big one: the pack's oldest, that came to the fire on the first night and comes back on the firing night.
   *  A third bigger, grey at the muzzle, the left ear torn, three pale scars across the snout, one quill snapped. */
  big?: boolean;
}

/**
 * The Duskhound (an original Verdaxis animal, not any Earth one): a lean, long-legged night hunter about the size of a
 * wolf. Six eyes in three pairs (the big front pair for the dark, two small pairs above and behind them for the edges of
 * the light); a crest of quills along the spine that lie flat when it walks and stand up when it means to fight, their
 * tips lit from inside (cold bioluminescence, like the photophores of deep-sea fish); a long narrow skull with a lip that
 * peels back off the teeth; swept-back ears that flick to sounds; digitigrade legs (it walks on its toes, the hock high
 * off the ground like a dog's); a long whip tail with a lit tip. Its hide is a dark violet-grey, paler under the belly
 * and throat.
 *
 * Visual only; behaviour is elsewhere (the fight's simulation, the story's scenes). `animate` poses it each frame from a
 * speed and a snarl; `look` turns its head to a point; `sniff` puts its nose to the ground.
 */
export function createHound(o: HoundOptions = {}) {
  const big = !!o.big, S = big ? 1.3 : 1;
  const flat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.62, normalMap: grainNormal(), normalScale: new THREE.Vector2(0.8, 0.8), ...extra });
  const skin = flat(big ? 0x262030 : 0x1d1826);
  const belly = flat(big ? 0x4a4352 : 0x3a2f45, { roughness: 0.75 });
  const muzzleM = big ? flat(0x6a6670, { roughness: 0.8 }) : skin;
  const gum = flat(0x4a1e28, { roughness: 0.4 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.8, 0.6) });
  const spineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.5, 2.8) });
  const quillM = flat(0x15111c, { roughness: 0.4 });
  const tooth = flat(0xd9d2c4, { roughness: 0.35 });
  const claw = flat(0x1a1714, { roughness: 0.3 });
  const scarM = flat(0xa49aa6, { roughness: 0.9 });

  const root = new THREE.Group();
  const scaled = new THREE.Group(); scaled.scale.setScalar(S); root.add(scaled);
  const body = new THREE.Group();
  const HIP = 0.74;
  body.position.y = HIP;
  scaled.add(body);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const ob = new THREE.Mesh(g, m); ob.position.set(x, y, z); ob.castShadow = true; parent.add(ob); return ob;
  };
  const along = (g: THREE.BufferGeometry) => { g.rotateX(Math.PI / 2); return g; };

  // ---- the body: deep chest and a hump of shoulder muscle, a tucked waist, a strong haunch; breathes
  const chest = new THREE.Group(); body.add(chest);
  mesh(along(loft([
    { y: 0.98, rx: 0.12, rz: 0.15, z: -0.04 }, { y: 0.78, rx: 0.2, rz: 0.3, z: 0.02 }, { y: 0.5, rx: 0.27, rz: 0.42, z: -0.04 },
    { y: 0.22, rx: 0.25, rz: 0.36, z: 0.02 }, { y: -0.12, rx: 0.17, rz: 0.21, z: 0.1 }, { y: -0.42, rx: 0.22, rz: 0.27, z: 0.06 },
    { y: -0.72, rx: 0.24, rz: 0.28, z: 0.03 }, { y: -0.95, rx: 0.12, rz: 0.15, z: 0.02 },
  ], 18)), skin, chest, 0, 0.06, 0);
  // the pale throat and belly: a second, slightly smaller skin showing below
  mesh(along(loft([
    { y: 0.86, rx: 0.1, rz: 0.12, z: 0.06 }, { y: 0.55, rx: 0.2, rz: 0.3, z: 0.1 }, { y: 0.15, rx: 0.19, rz: 0.27, z: 0.1 }, { y: -0.2, rx: 0.12, rz: 0.15, z: 0.12 },
  ], 14)), belly, chest, 0, 0.04, 0);

  // ---- the crest: quills along the spine from the nape to the rump, flat at rest, up when it snarls; lit tips
  const quills: THREE.Group[] = [];
  for (let i = 0; i < 15; i++) {
    const k = i / 14, len = 0.12 + Math.sin(k * Math.PI) * 0.24;
    const q = new THREE.Group();
    q.position.set(0, 0.34 + Math.sin(k * Math.PI) * 0.12 - (k < 0.2 ? (0.2 - k) * 0.5 : 0), 0.78 - k * 1.55);
    if (big && i === 6) { mesh(new THREE.ConeGeometry(0.022, len * 0.45, 4).translate(0, len * 0.22, 0), quillM, q); }
    else {
      mesh(new THREE.ConeGeometry(0.024, len, 4).translate(0, len / 2, 0), quillM, q);
      mesh(new THREE.SphereGeometry(0.012, 5, 4), spineMat, q, 0, len * 0.92, 0);
    }
    body.add(q); quills.push(q);
  }

  // ---- neck and head
  const neck = new THREE.Group(); neck.position.set(0, 0.18, 0.86); body.add(neck);
  mesh(along(loft([{ y: -0.12, rx: 0.15, rz: 0.2 }, { y: 0.12, rx: 0.12, rz: 0.15, z: -0.04 }, { y: 0.3, rx: 0.1, rz: 0.12, z: -0.08 }], 12)), skin, neck).rotation.x = -0.55;
  const head = new THREE.Group(); head.position.set(0, 0.17, 0.27); neck.add(head);
  // skull: a long narrow wedge, high at the brow, the muzzle running out flat and fine
  mesh(along(loft([{ y: -0.1, rx: 0.12, rz: 0.12 }, { y: 0.06, rx: 0.14, rz: 0.13, z: -0.02 }, { y: 0.2, rx: 0.1, rz: 0.085, z: -0.01 }, { y: 0.38, rx: 0.065, rz: 0.055, z: 0.02 }, { y: 0.47, rx: 0.035, rz: 0.035, z: 0.025 }], 14)), skin, head);
  if (big) mesh(along(loft([{ y: 0.16, rx: 0.095, rz: 0.08, z: -0.012 }, { y: 0.38, rx: 0.068, rz: 0.058, z: 0.02 }, { y: 0.475, rx: 0.037, rz: 0.037, z: 0.025 }], 12)), muzzleM, head);
  // brow ridges over the main eyes
  for (const sx of [-1, 1]) mesh(new THREE.CapsuleGeometry(0.022, 0.08, 3, 6).rotateX(Math.PI / 2), skin, head, sx * 0.085, 0.07, 0.1).rotation.y = sx * 0.3;
  // nostrils
  for (const sx of [-1, 1]) mesh(new THREE.SphereGeometry(0.009, 5, 4), gum, head, sx * 0.018, 0.005, 0.47);
  // the upper lip: a hinged flap along the muzzle that lifts off the teeth
  const lip = new THREE.Group(); lip.position.set(0, -0.035, 0.12); head.add(lip);
  mesh(along(loft([{ y: 0, rx: 0.1, rz: 0.03 }, { y: 0.2, rx: 0.07, rz: 0.025 }, { y: 0.33, rx: 0.04, rz: 0.02 }], 10)), skin, lip);
  for (let i = 0; i < 8; i++) {
    const sx = i % 2 ? 1 : -1, k = i >> 1, long = k === 0 ? 0.075 : 0.04;
    mesh(new THREE.ConeGeometry(0.011, long, 4), tooth, head, sx * (0.04 - k * 0.006), -0.05, 0.34 - k * 0.07).rotation.x = Math.PI;
  }
  const jaw = new THREE.Group(); jaw.position.set(0, -0.07, 0.04); head.add(jaw);
  mesh(along(loft([{ y: 0, rx: 0.1, rz: 0.045 }, { y: 0.24, rx: 0.065, rz: 0.035 }, { y: 0.4, rx: 0.03, rz: 0.02 }], 10)), belly, jaw);
  mesh(along(loft([{ y: 0.02, rx: 0.075, rz: 0.015 }, { y: 0.36, rx: 0.025, rz: 0.01 }], 8)), gum, jaw, 0, 0.03, 0);
  for (let i = 0; i < 6; i++) { const sx = i % 2 ? 1 : -1, k = i >> 1; mesh(new THREE.ConeGeometry(0.009, k === 0 ? 0.055 : 0.03, 4), tooth, jaw, sx * (0.035 - k * 0.006), 0.035, 0.33 - k * 0.08); }
  // six eyes in three pairs: the big pair forward, two small pairs above and behind
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.028 - i * 0.007, 8, 6), eyeMat, head, sx * (0.075 + i * 0.022), 0.045 + i * 0.03, 0.17 - i * 0.075);
  }
  // ears: long, swept back, flick to sounds and lie flat in a snarl
  const ears: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Group(); e.position.set(sx * 0.08, 0.1, -0.04); head.add(e);
    const torn = big && sx < 0;
    const eg = new THREE.ConeGeometry(0.05, torn ? 0.13 : 0.2, 4); eg.translate(0, torn ? 0.065 : 0.1, 0); eg.scale(1, 1, 0.35);
    mesh(eg, skin, e).rotation.set(-0.9, 0, -sx * 0.35);
    ears.push(e);
  }
  if (big) {
    // three old scars across the snout, pale lines in the hide
    for (let i = 0; i < 3; i++) mesh(new THREE.BoxGeometry(0.005, 0.11, 0.008), scarM, head, -0.02 + i * 0.025, 0.035, 0.24 + i * 0.035).rotation.set(0.3, 0, 0.9);
  }

  // ---- legs: digitigrade. Front: shoulder, elbow, wrist, paw. Hind: hip (thigh), stifle (shank), hock (long cannon), paw
  type Leg = { top: THREE.Group; mid: THREE.Group; low: THREE.Group; front: boolean };
  const legs: Leg[] = [];
  const paw = (parent: THREE.Object3D) => {
    mesh(new THREE.SphereGeometry(0.055, 8, 5).scale(1, 0.5, 1.35), skin, parent, 0, -0.01, 0.03);
    for (let c = 0; c < 3; c++) mesh(new THREE.ConeGeometry(0.012, 0.05, 4).rotateX(Math.PI / 2 + 0.5), claw, parent, (c - 1) * 0.028, -0.03, 0.1);
  };
  for (const [side, front] of [[-1, true], [1, true], [-1, false], [1, false]] as const) {
    const top = new THREE.Group(); top.position.set(side * (front ? 0.19 : 0.17), front ? 0.02 : -0.02, front ? 0.5 : -0.62); body.add(top);
    const mid = new THREE.Group(), low = new THREE.Group();
    if (front) {
      mesh(limb(0.34, 0.1, 0.06, 0.25, 1.3, 10), skin, top);
      mid.position.y = -0.33; top.add(mid);
      mesh(limb(0.3, 0.05, 0.035, 0.08, 1.1, 8), skin, mid);
      low.position.y = -0.3; mid.add(low);
      mesh(limb(0.1, 0.035, 0.03, 0, 1, 6), skin, low);
      const p = new THREE.Group(); p.position.y = -0.1; low.add(p); paw(p);
    } else {
      // a heavy thigh, the shank running back down to a high hock, a long cannon bone to the toes
      mesh(limb(0.36, 0.15, 0.07, 0.3, 1.4, 10), skin, top);
      mid.position.y = -0.34; top.add(mid);
      mesh(limb(0.3, 0.06, 0.035, 0.1, 1.2, 8), skin, mid);
      low.position.y = -0.3; mid.add(low);
      mesh(limb(0.16, 0.033, 0.028, 0, 1, 6), skin, low);
      const p = new THREE.Group(); p.position.y = -0.16; low.add(p); paw(p);
    }
    legs.push({ top, mid, low, front });
  }

  // ---- the tail: a long whip, seven segments, a lit tip
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = body;
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.1 : 0, i === 0 ? -0.92 : -0.17);
    const r0 = 0.075 - i * 0.009, r1 = r0 - 0.009;
    mesh(new THREE.CylinderGeometry(r1, r0, 0.18, 10).rotateX(Math.PI / 2), skin, seg, 0, 0, -0.085);
    if (i === 6) mesh(new THREE.ConeGeometry(0.03, 0.16, 5).rotateX(-Math.PI / 2), spineMat, seg, 0, 0, -0.24);
    parent.add(seg); tail.push(seg); parent = seg;
  }
  root.visible = false;

  // ---- motion
  let gait = 0, breath = 0, snarlS = 0, sniffS = 0, sniffTo = 0, earT = 1, yawS = 0, pitchS = 0;
  let lookAt: THREE.Vector3 | null = null;
  const P = new THREE.Vector3();
  const ease = (cur: number, to: number, dt: number, r: number) => cur + (to - cur) * (1 - Math.exp(-dt * r));
  const walkPh = [0.25, 0.75, 0, 0.5], trotPh = [0, 0.5, 0.5, 0];
  return {
    root,
    head,
    big,
    /** Turn the head (and neck) towards a world point; null looks ahead. */
    look(p: THREE.Vector3 | null) { lookAt = p ? p.clone() : null; },
    /** 0..1: nose down to the ground, working the scent. */
    sniff(k: number) { sniffTo = k; },
    /** speed in m/s; snarl 0..1 lifts the lip, opens the jaw, stands the quills up, flattens the ears, brightens the eyes. */
    animate(speed: number, snarl: number, t: number, dt: number) {
      dt = Math.min(dt, 0.1);
      snarlS = ease(snarlS, snarl, dt, 7); sniffS = ease(sniffS, sniffTo, dt, 3);
      const amt = Math.min(1, speed / 2.2), run = THREE.MathUtils.smoothstep(speed, 3, 6.5);
      gait += (dt * (0.7 + speed * (0.62 - run * 0.2))) / S;
      breath += dt * (1.6 + snarlS * 2 + run * 3);
      // a walk is four beats (left hind, left fore, right hind, right fore); a trot and a run move diagonal pairs together
      const trot = THREE.MathUtils.smoothstep(speed, 1.6, 3.2);
      legs.forEach((L, i) => {
        const ph = THREE.MathUtils.lerp(walkPh[i], trotPh[i], trot);
        const p = (gait + ph) * Math.PI * 2, swing = Math.sin(p), lift = Math.max(0, Math.cos(p));
        const A = (0.42 + run * 0.35) * amt;
        if (L.front) {
          // (a positive turn swings the part below backwards) in the swing the elbow and the wrist fold the paw back and up
          L.top.rotation.x = -swing * A - snarlS * 0.15;
          L.mid.rotation.x = lift * 0.6 * amt - 0.05 + snarlS * 0.2;
          L.low.rotation.x = lift * 0.9 * amt + 0.06;
        } else {
          // thigh forward to the stifle, the shank back down to the high hock, the cannon near upright to the toes
          L.top.rotation.x = -swing * A - 0.45 - snarlS * 0.15;
          L.mid.rotation.x = 1.0 + lift * 0.45 * amt + snarlS * 0.2;
          L.low.rotation.x = -0.6 - lift * 0.5 * amt - snarlS * 0.1;
        }
      });
      const bob = Math.abs(Math.sin(gait * Math.PI * 2)) * 0.04 * amt;
      body.position.y = HIP + bob - snarlS * 0.1 - sniffS * 0.04;
      // a crouch in front when it snarls (the weight back on the haunches, ready to go), the nose down when it smells
      body.rotation.x = snarlS * 0.12 + sniffS * 0.08 - run * 0.04;
      chest.scale.set(1 + Math.sin(breath) * 0.018, 1 + Math.sin(breath) * 0.025, 1);
      // the head: towards what it watches, within what a neck can do; sniffing puts it down and works it side to side
      let yaw = 0, pitch = 0;
      if (lookAt && neck.parent) {
        root.updateMatrixWorld(true);
        P.copy(lookAt); neck.parent.worldToLocal(P); P.sub(neck.position);
        yaw = THREE.MathUtils.clamp(Math.atan2(P.x, P.z), -1.1, 1.1);
        pitch = THREE.MathUtils.clamp(Math.atan2(P.y - 0.15, Math.hypot(P.x, P.z)), -0.5, 0.5);
      }
      yawS = ease(yawS, yaw + Math.sin(t * 2.3) * 0.25 * sniffS, dt, 4); pitchS = ease(pitchS, pitch, dt, 4);
      neck.rotation.set(-pitchS * 0.5 + sniffS * 0.75 + snarlS * 0.25, yawS * 0.55, 0);
      head.rotation.set(-pitchS * 0.5 + sniffS * 0.3 - snarlS * 0.15 + Math.sin(t * 1.3) * 0.03 + (sniffS > 0.5 ? Math.sin(t * 11) * 0.03 : 0), yawS * 0.45, 0);
      lip.rotation.x = -snarlS * 0.3;
      jaw.rotation.x = 0.05 + snarlS * (0.42 + Math.sin(t * 19) * 0.06) + run * 0.12;
      // ears: back and flat in a snarl, up otherwise, with a flick now and then
      earT -= dt;
      if (earT < -0.15) earT = 1.5 + ((t * 7.3) % 3);
      const flick = earT < 0 ? 1 : 0;
      ears.forEach((e, i) => { e.rotation.x = snarlS * 0.7 - flick * (i ? 0.35 : 0); e.rotation.z = (i ? -1 : 1) * snarlS * 0.3; });
      // the crest: quills flat along the back, up in a wave from nape to rump as the snarl comes
      quills.forEach((q, i) => { const k = i / (quills.length - 1); const up = THREE.MathUtils.clamp(snarlS * 1.6 - k * 0.6, 0, 1); q.rotation.x = -1.25 + up * 0.95 + Math.sin(t * 3 + i) * 0.03; });
      // the tail low and loose as it walks, out stiff behind in a snarl, streaming in a run
      tail.forEach((s, i) => {
        s.rotation.y = Math.sin(t * (1.8 + run * 3) - i * 0.6) * (0.16 + amt * 0.08) * (1 - snarlS * 0.7);
        s.rotation.x = i === 0 ? 0.55 - snarlS * 0.45 - run * 0.4 : 0.06 - snarlS * 0.04;
      });
      eyeMat.color.setRGB(3 + snarlS * 6, 0.7 + snarlS, 0.5);
      spineMat.color.setRGB(1.6 + snarlS * 2.4, 0.35 + snarlS * 0.4, 2 + snarlS * 2);
    },
  };
}
