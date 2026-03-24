/**
 * Shared combat utility functions and types.
 *
 * Extracted from action-service.ts to be shared across action handlers,
 * two-phase-action-service, and other combat modules.
 */

import { getAbilityModifier } from "../../../../domain/rules/ability-checks.js";
import { SeededDiceRoller } from "../../../../domain/rules/dice-roller.js";
import type { AttackSpec } from "../../../../domain/combat/attack-resolver.js";
import type { Ability } from "../../../../domain/entities/core/ability-scores.js";
import type { RollMode } from "../../../../domain/rules/advantage.js";
import type { Position } from "../../../../domain/rules/movement.js";
import {
  calculateBonusFromEffects,
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
} from "../../../../domain/entities/combat/effects.js";
import { getActiveEffects } from "../helpers/resource-utils.js";
import { isRecord, readNumber } from "../helpers/json-helpers.js";
import { ValidationError } from "../../../errors.js";
import type { CombatantRef } from "../helpers/combatant-ref.js";

// Re-export getAbilityModifier from domain so callers don't need an extra import
export { getAbilityModifier } from "../../../../domain/rules/ability-checks.js";

// ---------------------------------------------------------------------------
// Ability scores extraction (deduped from action-service + combatant-resolver)
// ---------------------------------------------------------------------------

export type AbilityScoresData = Record<Ability, number>;

export function extractAbilityScores(raw: unknown): AbilityScoresData | null {
  if (!isRecord(raw)) return null;
  const abilities: Ability[] = [
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
  ];

  const out: Partial<AbilityScoresData> = {};
  for (const a of abilities) {
    const n = readNumber(raw, a);
    if (n === null) return null;
    out[a] = n;
  }

  return out as AbilityScoresData;
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Deterministic string → int32 hash (FNV-1a). Used for dice seeding. */
export function hashStringToInt32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

// ---------------------------------------------------------------------------
// CreatureAdapter — bridges JSON combatant state to domain attack resolution
// ---------------------------------------------------------------------------

export type CreatureAdapter = {
  getAC(): number;
  getAbilityModifier(ability: Ability): number;
  takeDamage(amount: number): void;
  getFeatIds?: () => readonly string[];
  getD20TestModeForAbility?: (
    ability: Ability,
    baseMode: "normal" | "advantage" | "disadvantage",
  ) => "normal" | "advantage" | "disadvantage";
};

export function buildCreatureAdapter(params: {
  armorClass: number;
  abilityScores: AbilityScoresData;
  featIds?: readonly string[];
  hpCurrent: number;
}): { creature: CreatureAdapter; getHpCurrent: () => number } {
  let hpCurrent = params.hpCurrent;

  const creature: CreatureAdapter = {
    getAC: () => params.armorClass,
    getAbilityModifier: (ability) => getAbilityModifier(params.abilityScores[ability]),
    takeDamage: (amount) => {
      const a = Number.isFinite(amount) ? amount : 0;
      hpCurrent = Math.max(0, hpCurrent - Math.max(0, a));
    },
  };

  if (params.featIds) {
    creature.getFeatIds = () => params.featIds ?? [];
  }

  return { creature, getHpCurrent: () => hpCurrent };
}

// ---------------------------------------------------------------------------
// Attack-spec parsing (input validation for API-level attack calls)
// ---------------------------------------------------------------------------

function isAbility(x: unknown): x is Ability {
  return (
    x === "strength" ||
    x === "dexterity" ||
    x === "constitution" ||
    x === "intelligence" ||
    x === "wisdom" ||
    x === "charisma"
  );
}

export function parseAttackSpec(input: unknown): AttackSpec {
  if (!isRecord(input)) throw new ValidationError("spec must be an object");

  const nameRaw = input.name;
  const name = nameRaw === undefined ? undefined : typeof nameRaw === "string" ? nameRaw : null;
  if (name === null) throw new ValidationError("spec.name must be a string");

  const attackBonus = readNumber(input, "attackBonus");
  if (attackBonus === null || !Number.isInteger(attackBonus)) {
    throw new ValidationError("spec.attackBonus must be an integer");
  }

  const kindRaw = input.kind;
  const kind = kindRaw === "ranged" ? "ranged" : kindRaw === "melee" ? "melee" : undefined;

  const attackAbilityRaw = input.attackAbility;
  const attackAbility =
    attackAbilityRaw === undefined ? undefined : isAbility(attackAbilityRaw) ? attackAbilityRaw : null;
  if (attackAbility === null) {
    throw new ValidationError("spec.attackAbility must be a valid ability name");
  }

  const modeRaw = input.mode;
  const mode =
    modeRaw === undefined
      ? undefined
      : modeRaw === "normal" || modeRaw === "advantage" || modeRaw === "disadvantage"
        ? modeRaw
        : null;
  if (mode === null) {
    throw new ValidationError("spec.mode must be normal|advantage|disadvantage");
  }

  const damageRaw = input.damage;
  if (!isRecord(damageRaw)) throw new ValidationError("spec.damage must be an object");

  const diceCount = readNumber(damageRaw, "diceCount");
  const diceSides = readNumber(damageRaw, "diceSides");
  const modifierN = damageRaw.modifier;
  const damageModifier = modifierN === undefined ? 0 : typeof modifierN === "number" ? modifierN : null;

  if (diceCount === null || !Number.isInteger(diceCount) || diceCount < 1) {
    throw new ValidationError("spec.damage.diceCount must be an integer >= 1");
  }
  if (diceSides === null || !Number.isInteger(diceSides) || diceSides < 2) {
    throw new ValidationError("spec.damage.diceSides must be an integer >= 2");
  }
  if (damageModifier === null || !Number.isInteger(damageModifier)) {
    throw new ValidationError("spec.damage.modifier must be an integer");
  }

  return {
    name: name ?? undefined,
    kind,
    attackAbility,
    mode,
    attackBonus,
    damage: {
      diceCount,
      diceSides,
      modifier: damageModifier,
    },
  };
}

// ---------------------------------------------------------------------------
// ActiveEffect ability-check bonus computation
// ---------------------------------------------------------------------------

/**
 * Compute flat + dice bonus and roll mode from ActiveEffects on ability_checks.
 * Must be called AFTER creating the SeededDiceRoller so dice bonuses are deterministic.
 */
export function abilityCheckEffectMods(
  resources: unknown,
  diceRoller: SeededDiceRoller,
  ability?: Ability,
): { bonus: number; mode: RollMode } {
  const effects = getActiveEffects(resources ?? {});
  const result = calculateBonusFromEffects(effects, 'ability_checks', ability);
  let bonus = result.flatBonus;
  for (const dr of result.diceRolls) {
    const count = Math.abs(dr.count);
    const sign = dr.count < 0 ? -1 : 1;
    for (let i = 0; i < count; i++) {
      bonus += sign * diceRoller.rollDie(dr.sides).total;
    }
  }
  const hasAdv = hasAdvantageFromEffects(effects, 'ability_checks', ability);
  const hasDisadv = hasDisadvantageFromEffects(effects, 'ability_checks', ability);
  let mode: RollMode = "normal";
  if (hasAdv && !hasDisadv) mode = "advantage";
  else if (hasDisadv && !hasAdv) mode = "disadvantage";
  return { bonus, mode };
}

// ---------------------------------------------------------------------------
// Input type definitions (used by ActionService and extracted handlers)
// ---------------------------------------------------------------------------

export type AttackActionInput = {
  encounterId?: string;
  attacker: CombatantRef;
  target: CombatantRef;
  seed?: unknown;
  spec?: unknown;
  monsterAttackName?: string;
};

export type SimpleActionBaseInput = {
  encounterId?: string;
  actor: CombatantRef;
  seed?: unknown;
  /** If true, bypass the action economy check (used by bonus action abilities like Patient Defense) */
  skipActionCheck?: boolean;
};

export type HelpActionInput = SimpleActionBaseInput & {
  target: CombatantRef;
};

export type CastSpellActionInput = SimpleActionBaseInput & {
  spellName: string;
};

export type ShoveActionInput = SimpleActionBaseInput & {
  target: CombatantRef;
  shoveType?: "push" | "prone";
};

export type GrappleActionInput = SimpleActionBaseInput & {
  target: CombatantRef;
};

export type HideActionInput = SimpleActionBaseInput & {
  /** Whether actor has cover or obscurement from enemies (assume true for simplicity) */
  hasCover?: boolean;
  /** Whether to use as bonus action (e.g., Cunning Action) */
  isBonusAction?: boolean;
};

export type SearchActionInput = SimpleActionBaseInput & {
  /** Optional: specific target creature to search for */
  targetRef?: CombatantRef;
};

export type MoveActionInput = SimpleActionBaseInput & {
  destination: Position;
};
