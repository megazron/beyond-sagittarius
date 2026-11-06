import * as THREE from 'three';
import { cover, Beat, Shot } from './cutscene';
import type { Character, CrewId } from '../characters/character';

type Cast = Record<CrewId, Character>;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Places the six around the deck for the opening. */
export function stageDeck(a: Cast, y: number, marks = DECK) {
  for (const id in marks) {
    const m = marks[id as keyof typeof marks], c = a[id as CrewId];
    c.root.position.set(m[0], y, m[1]);
    c.root.rotation.set(0, Math.atan2(0.1 - m[0], 0.8 - m[1]), 0);
  }
}
const DECK = { social: [-1.5, 1.4], strong: [-0.25, 2.0], medic: [1.15, 1.75], explorer: [1.95, 0.75], builder: [-2.5, 0.5], scientist: [0.3, -0.45] } as const;

/**
 * The opening: a group selfie, a snack trial, a roast session, and the moment
 * the jokes stop. `wide` is the deck master shot.
 */
export function deckScene(a: Cast, origin: THREE.Vector3): Beat[] {
  const o = (x: number, y: number, z: number) => origin.clone().add(V(x, y, z));
  const master = (): Shot => ({ from: o(4.2, -0.75, 3.05), to: o(-0.2, -1.05, 0.5), push: 0.07 });
  const selfie = (): Shot => ({ from: o(-1.05, -0.62, -0.25), to: o(-0.95, -0.82, 1.8), push: 0.04 });
  return [
    { key: 'op.1', who: 'social', shot: selfie, poses: { social: 'selfie', strong: 'idle', explorer: 'cheer', builder: 'wave', medic: 'stand' }, faces: {} },
    { key: 'op.2', who: 'strong', shot: () => cover.close(a.strong, 0.55, 1.15), poses: { strong: 'stand', social: 'selfie' } },
    { key: 'op.3', who: 'medic', shot: () => cover.close(a.medic, -0.5), poses: { medic: 'idle' }, faces: { medic: 'strong', strong: 'medic' }, after: 0.5 },
    { key: 'op.4', who: 'explorer', shot: () => cover.ots(a.explorer, a.scientist), poses: { explorer: 'point', social: 'idle', builder: 'idle', strong: 'idle' }, faces: { explorer: 'scientist', scientist: 'explorer' } },
    { key: 'op.5', who: 'scientist', shot: () => cover.close(a.scientist, 0.4), poses: { scientist: 'stand' } },
    { key: 'op.6', who: 'explorer', shot: () => cover.two(a.explorer, a.medic, 3), poses: { explorer: 'facepalm', scientist: 'idle' }, faces: { medic: 'explorer' }, after: 0.5 },
    { key: 'op.7', who: 'builder', shot: () => cover.mid(a.builder, 0.3, 1.7), poses: { builder: 'idle', explorer: 'idle' }, faces: { builder: 'medic' } },
    { key: 'op.8', who: 'medic', shot: () => cover.ots(a.medic, a.builder), poses: { medic: 'stand', builder: 'facepalm' }, faces: { medic: 'builder' } },
    { key: 'j.3', who: 'builder', shot: () => cover.close(a.builder, -0.4), poses: { builder: 'stand', medic: 'idle' } },
    { key: 'op.9', who: 'social', shot: () => cover.close(a.social, -0.4), poses: { social: 'selfie', builder: 'idle' } },
    { key: 'j.1', who: 'social', shot: () => cover.mid(a.social, 0.4, 1.7), poses: { social: 'selfie' } },
    { key: 'op.10', who: 'strong', shot: master, poses: { social: 'idle', strong: 'stand' }, faces: { strong: 'social', social: 'strong' } },
    { key: 'j.9', who: 'strong', shot: () => cover.mid(a.strong, -0.4, 2.1), poses: { strong: 'cheer' } },
    { key: 'j.2', who: 'medic', shot: () => cover.close(a.medic, 0.35, 1.05), poses: { strong: 'idle', medic: 'stand' }, after: 0.5 },
    { key: 'op.11', who: 'scientist', shot: () => cover.close(a.scientist, -0.45), poses: { scientist: 'present' }, faces: { scientist: 'strong' } },
    { key: 'op.12', who: 'social', shot: () => cover.ots(a.social, a.scientist, -0.6), poses: { social: 'argue' }, faces: { social: 'scientist', strong: 'scientist', medic: 'scientist', explorer: 'scientist', builder: 'scientist' } },
    { key: 'op.13', who: 'scientist', shot: () => cover.close(a.scientist, 0.35, 0.95), poses: { scientist: 'stand' }, after: 0.6 },
    { key: 'op.14', who: 'strong', shot: () => cover.mid(a.strong, 0.5, 2.2), poses: { strong: 'argue', social: 'idle' } },
    { key: 'op.15', who: 'scientist', shot: () => cover.close(a.scientist, 0.42), poses: { scientist: 'present', strong: 'idle' } },
    { key: 'op.16', who: 'medic', shot: () => cover.close(a.medic, 0.45, 1), poses: { scientist: 'stand' }, after: 0.8 },
    // the turn: hold on the window with nobody talking
    { hold: 1.6, shot: () => ({ from: o(0.3, -0.9, 3.4), to: o(0, -0.7, -3), push: 0.14 }), poses: { explorer: 'stand' } },
    { key: 'op.17', who: 'explorer', shot: () => cover.close(a.explorer, 0.3, 1.2), poses: { explorer: 'point' }, faces: {}, after: 0.5 },
    { key: 'op.18', who: 'builder', shot: () => cover.mid(a.builder, -0.4, 1.8), poses: { explorer: 'stand', builder: 'stand' } },
  ];
}

/** Flashback, day 39: the fight nobody posted. */
export function fightScene(a: Cast, origin: THREE.Vector3): Beat[] {
  const o = (x: number, y: number, z: number) => origin.clone().add(V(x, y, z));
  return [
    { key: 'fb.1', who: 'megazron', hold: 1, shot: () => ({ from: o(4.6, -0.5, 3), to: o(0, -1.1, 0.4), push: 0.12 }), poses: { scientist: 'stand', strong: 'stand', social: 'idle', medic: 'idle', explorer: 'idle', builder: 'idle' }, faces: { scientist: 'strong', strong: 'scientist' } },
    { key: 'fb.2', who: 'strong', shot: () => cover.ots(a.strong, a.scientist), poses: { strong: 'argue' } },
    { key: 'fb.3', who: 'scientist', shot: () => cover.close(a.scientist, 0.4, 0.95), poses: { strong: 'stand', scientist: 'shout' }, after: 0.5 },
    { key: 'fb.4', who: 'social', shot: () => cover.mid(a.social, 0.4, 1.8), poses: { social: 'argue', scientist: 'stand' }, faces: { social: 'scientist' } },
    { key: 'fb.5', who: 'medic', shot: () => cover.close(a.medic, -0.45), poses: { social: 'idle', medic: 'stand' }, faces: { medic: 'strong' } },
    { key: 'fb.6', who: 'strong', shot: () => cover.close(a.strong, 0.5, 1.1), poses: { strong: 'stand' }, after: 0.5 },
    { hold: 1.2, shot: () => cover.close(a.scientist, -0.2, 0.9), poses: { scientist: 'stand' } },
    { key: 'fb.7', who: 'scientist', shot: () => cover.close(a.scientist, -0.2, 0.85), after: 0.5 },
    { key: 'fb.8', who: 'explorer', shot: () => cover.two(a.explorer, a.scientist, 3), poses: { explorer: 'point' }, faces: { explorer: 'strong' } },
    { key: 'fb.9', who: 'builder', shot: () => cover.mid(a.builder, 0.3, 1.8), poses: { explorer: 'idle', builder: 'idle' }, after: 0.6 },
  ];
}
