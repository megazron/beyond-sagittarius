import * as THREE from 'three';

export interface Astronaut {
  root: THREE.Group;
  body: THREE.Group;
  armL: THREE.Group; armR: THREE.Group;
  legL: THREE.Group; legR: THREE.Group;
  head: THREE.Group;
  animate(phase: number, amount: number, t: number): void;
}

/** Procedural humanoid in an exploration suit (~1.8 m). */
export function createAstronaut(suit = 0xd9dde3, accent = 0xff8a3d, damaged = false): Astronaut {
  const suitMat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.55, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.7, metalness: 0.3 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5, emissive: accent, emissiveIntensity: 0.15 });
  const visorMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a0f18, roughness: 0.05, metalness: 0.9, clearcoat: 1, clearcoatRoughness: 0.05,
    emissive: 0x112244, emissiveIntensity: 0.4,
  });
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.6, 2.2) });

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.95;
  root.add(body);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.42, 6, 14), suitMat);
  torso.position.y = 0.32; torso.scale.set(1, 1, 0.78);
  body.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.08), darkMat);
  chest.position.set(0, 0.42, 0.2); body.add(chest);
  const chestLight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.02), damaged ? accentMat : lightMat);
  chestLight.position.set(0, 0.45, 0.245); body.add(chestLight);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.08, 16), darkMat);
  belt.position.y = 0.02; belt.scale.z = 0.8; body.add(belt);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.2), suitMat);
  pack.position.set(0, 0.38, -0.27); body.add(pack);
  const packStripe = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.06, 0.21), accentMat);
  packStripe.position.set(0, 0.5, -0.27); body.add(packStripe);
  for (const sx of [-0.12, 0.12]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 10), darkMat);
    tank.position.set(sx, 0.36, -0.4); body.add(tank);
  }

  const head = new THREE.Group();
  head.position.y = 0.78; body.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.21, 24, 18), suitMat);
  head.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 16, -Math.PI * 0.42 + Math.PI / 2, Math.PI * 0.84, Math.PI * 0.28, Math.PI * 0.38), visorMat);
  visor.position.z = 0.035; visor.scale.set(1.04, 1.0, 1.02);
  head.add(visor);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 8), lightMat);
  lamp.rotation.x = Math.PI / 2; lamp.position.set(0.17, 0.08, 0.1); head.add(lamp);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.04, 8, 20), darkMat);
  collar.rotation.x = Math.PI / 2; collar.position.y = -0.17; head.add(collar);

  const limb = (r: number, len: number, mat: THREE.Material) => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
    m.position.y = -len / 2 - r * 0.6;
    g.add(m);
    return g;
  };
  const armL = limb(0.075, 0.5, suitMat); armL.position.set(-0.34, 0.6, 0); body.add(armL);
  const armR = limb(0.075, 0.5, suitMat); armR.position.set(0.34, 0.6, 0); body.add(armR);
  for (const a of [armL, armR]) {
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), darkMat);
    glove.position.y = -0.68; a.add(glove);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 10), accentMat);
    cuff.position.y = -0.58; a.add(cuff);
  }
  const legL = limb(0.095, 0.62, suitMat); legL.position.set(-0.13, 0.02, 0); body.add(legL);
  const legR = limb(0.095, 0.62, suitMat); legR.position.set(0.13, 0.02, 0); body.add(legR);
  for (const l of [legL, legR]) {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.28), darkMat);
    boot.position.set(0, -0.86, 0.04); l.add(boot);
  }

  if (damaged) {
    const scorch = new THREE.MeshStandardMaterial({ color: 0x1b1612, roughness: 1 });
    const s1 = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), scorch);
    s1.scale.set(1, 0.5, 0.3); s1.position.set(0.15, 0.25, 0.2); body.add(s1);
    const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), scorch);
    s2.scale.set(0.6, 1, 0.3); s2.position.set(-0.2, 0.5, 0.17); body.add(s2);
  }

  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  return {
    root, body, armL, armR, legL, legR, head,
    animate(phase: number, amount: number, t: number) {
      const s = Math.sin(phase) * amount;
      legL.rotation.x = s * 0.7; legR.rotation.x = -s * 0.7;
      armL.rotation.x = -s * 0.55; armR.rotation.x = s * 0.55;
      armL.rotation.z = -0.08; armR.rotation.z = 0.08;
      body.position.y = 0.95 + Math.abs(Math.cos(phase)) * 0.05 * amount + Math.sin(t * 1.6) * 0.008;
      body.rotation.x = amount * 0.08;
      head.rotation.y = Math.sin(t * 0.4) * 0.15 * (1 - amount);
    },
  };
}
