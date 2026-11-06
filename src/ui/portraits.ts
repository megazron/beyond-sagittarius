import * as THREE from 'three';
import { createCharacter, CrewId } from '../characters/character';
import type { PlayerLook, CrewSkins } from '../characters/custom';

const IDS: CrewId[] = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social'];
let cache: Promise<Record<string, string>> | null = null;
let cacheKey = '';
let look: PlayerLook | undefined, skins: CrewSkins = {}, detail = 1;

/** New portraits next time the panel opens. */
export function setPortraitCast(l: PlayerLook, s: CrewSkins, d = 1) { look = l; skins = s; detail = d; const k = JSON.stringify([l, s]); if (k !== cacheKey) { cacheKey = k; cache = null; } }

/** Renders one bust per crewmate, once, for the crew panel. */
export function portraits(): Promise<Record<string, string>> {
  cache ??= new Promise((resolve) => {
    // yield first so the panel opens at once
    setTimeout(async () => {
      const out: Record<string, string> = {};
      try {
        const canvas = document.createElement('canvas');
        const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
        r.setSize(224, 280, false);
        r.toneMapping = THREE.ACESFilmicToneMapping;
        const scene = new THREE.Scene();
        const key = new THREE.DirectionalLight(0xfff0dc, 3); key.position.set(1.2, 2, 2.4);
        const rim = new THREE.DirectionalLight(0x8fd8ff, 2.4); rim.position.set(-2, 1.4, -1.6);
        scene.add(key, rim, new THREE.HemisphereLight(0xb8cce0, 0x28242a, 1.3));
        const cam = new THREE.PerspectiveCamera(26, 224 / 280, 0.05, 20);
        for (const id of IDS) {
          const c = createCharacter(id, detail, id === 'scientist' ? look : undefined, id === 'strong' && skins.strong === 'suit' ? 'suit' : undefined);
          await c.whenReady;
          scene.add(c.root);
          scene.updateMatrixWorld(true);
          c.animate('stand', 0, 0, 1, 1);
          scene.updateMatrixWorld(true);
          const h = new THREE.Vector3().setFromMatrixPosition(c.head.matrixWorld);
          cam.position.set(h.x + 0.2, h.y + 0.12, h.z + 1.2);
          cam.lookAt(h.x, h.y + 0.06, h.z);
          r.render(scene, cam);
          out[id] = canvas.toDataURL('image/webp', 0.86);
          scene.remove(c.root);
        }
        r.dispose();
        r.forceContextLoss();
      } catch (e) { console.warn('[portraits]', e); }
      resolve(out);
    }, 30);
  });
  return cache;
}
