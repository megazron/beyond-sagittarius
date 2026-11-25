import * as THREE from 'three';

/** One task on a stage: walk to it, press interact. `need` holds it back until earlier tasks are done. */
export interface AwayTask { id: string; pos: THREE.Vector3; radius: number; label: string; need?: string[]; count?: number; run?: () => void; optional?: boolean; repeat?: boolean }

/** A place that isn't Verdaxis. The player walks on `height`, and `collide` keeps them on it. */
export interface AwayStage {
  scene: THREE.Scene;
  gravity: number;
  jump: number;
  spawn: THREE.Vector3;
  height(x: number, z: number): number;
  collide(p: THREE.Vector3, r: number): void;
  /** How far the camera may pull back before a wall (0 to 1). Open stages leave it out. */
  clearance?(fx: number, fz: number, cx: number, cz: number): number;
  /** The highest the follow camera may be with the player's feet at fy (under awnings and shelters). */
  ceiling?(fx: number, fz: number, fy: number, cx: number, cz: number): number;
  /** How crowded it is round the player (0 to 1): the follow camera rises and looks down over the heads. */
  crowdNear?(): number;
  /** Hero views: the first time the player walks into a box, the camera turns to the view for a few seconds. */
  /** Pushes the follow camera off a big vehicle's side and nose (xz, in place). */
  keepOff?: (p: THREE.Vector3) => void;
  vistas?: { x0: number; x1: number; z0: number; z1: number; yaw: number; pitch: number; secs: number; after?: string }[];
  tasks: AwayTask[];
  /** Scales a lineage's own light (Draxum's ember seams) from 1 down to 0. */
  setGlow?(k: number): void;
  update(dt: number, time: number, camera?: THREE.Camera): void;
  /** Someone on the stage speaks to the player for this long: they turn to face them, look at them, and talk. */
  /** The sky over the stage, when it has weather: rain 0..1 (heard as well as seen). */
  weather?: { rain: number; night: number };
  talk?(id: string, seconds: number, listener: THREE.Vector3): void;
  dispose?(): void;
  /** What is still loading for this stage (tools/perf_gate.py waits for an empty list): bodies whose builds have not all
   * arrived, props not yet built. */
  pending?(): string[];
  /** The stage top-down, for the minimap, the full map and the GPS route. */
  mapLayer?: import('../../ui/minimap').MapLayer;
  /** A closing scene once every task is done (the take-off from Zenvora): it drives the camera, the player's body and
   * its people, and calls `done` at its end or when skipped. */
  outro?: { start(player: import('../../characters/character').Character | null, done: () => void): void; skip(): void; readonly active: boolean; readonly remaining: number };
}
