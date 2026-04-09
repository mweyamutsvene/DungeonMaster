export { resolveAttack, isAutoCriticalHit, type DamageSpec, type AttackSpec, type AttackRoll, type AttackResult, type AttackResolveOptions } from "./attack-resolver.js";
export { Combat, type Combatant, type CombatState } from "./combat.js";
export { rollInitiative, swapInitiative, type InitiativeEntry } from "./initiative.js";
// movement.ts removed — dead code. Canonical movement lives in domain/rules/movement.ts
