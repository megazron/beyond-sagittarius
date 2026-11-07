import * as THREE from 'three';

/** One task on a stage: walk to it, press interact. `need` holds it back until earlier tasks are done. */
export interface AwayTask { id: string; pos: THREE.Vector3; radius: number; label: string; need?: string[]; count?: number; run?: () => void }

/** A place that isn't the green world. The player walks on `height`, and `collide` keeps them on it. */
export interface AwayStage {
  scene: THREE.Scene;
  gravity: number;
  jump: number;
  spawn: THREE.Vector3;
  height(x: number, z: number): number;
  collide(p: THREE.Vector3, r: number): void;
  tasks: AwayTask[];
  update(dt: number, time: number): void;
  dispose?(): void;
}
