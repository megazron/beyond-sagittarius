import * as THREE from 'three';

/** One task on a stage: walk to it, press interact. `need` holds it back until earlier tasks are done. */
export interface AwayTask { id: string; pos: THREE.Vector3; radius: number; label: string; need?: string[]; count?: number; run?: () => void; optional?: boolean; repeat?: boolean }

/** A place that isn't the green world. The player walks on `height`, and `collide` keeps them on it. */
export interface AwayStage {
  scene: THREE.Scene;
  gravity: number;
  jump: number;
  spawn: THREE.Vector3;
  height(x: number, z: number): number;
  collide(p: THREE.Vector3, r: number): void;
  /** How far the camera may pull back before a wall (0 to 1). Open stages leave it out. */
  clearance?(fx: number, fz: number, cx: number, cz: number): number;
  /** Hero views: the first time the player walks into a box, the camera turns to the view for a few seconds. */
  vistas?: { x0: number; x1: number; z0: number; z1: number; yaw: number; pitch: number; secs: number }[];
  tasks: AwayTask[];
  update(dt: number, time: number): void;
  dispose?(): void;
}
