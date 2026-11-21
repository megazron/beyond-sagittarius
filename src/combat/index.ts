// What the rest of the game may use of the fight. The story calls `startEncounter` and `tension` on the Combat
// object main.ts makes (`game.combat`); everything else in src/combat is its own business.
export { Combat, defaultCombatSettings } from './combat';
export type { CombatSettings, CombatSave, StartOpts } from './combat';
export type { EncounterId, Outcome } from './sim/encounters';
export type { TensionSpec, TensionResult, TensionKind } from './sim/tension';
export type { Difficulty } from './sim/core';
