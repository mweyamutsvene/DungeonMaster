/**
 * CombatResourceBuilder — Single source of truth for initializing combat resource pools.
 *
 * Replaces the 70+ lines of class-specific if/else chains that were previously
 * scattered across `roll-state-machine.ts`'s `handleInitiativeRoll()`.
 *
 * All class-specific resource logic lives in the per-class domain files
 * (fighter.ts, monk.ts, rogue.ts, etc.) and their `resourcesAtLevel()` methods.
 * This builder composes those pools with sheet-dependent extras (spell slots,
 * Shield spell tracking, etc.) into a single `CombatResources` result.
 */

import type { ResourcePool } from "../combat/resource-pool.js";
import type { CharacterClassId } from "./class-definition.js";
import { isCharacterClassId } from "./class-definition.js";
import { getClassDefinition } from "./registry.js";
import { getMonkResourcePools } from "./monk.js";
import type { CharacterSheetLike } from "./class-feature-resolver.js";

// ----- Types -----

export interface CombatResourcesResult {
  /** All resource pools for this character in combat. */
  resourcePools: ResourcePool[];
  /** Whether the character has the Shield spell prepared (for reaction system). */
  hasShieldPrepared: boolean;
  /** Whether the character has the Counterspell spell prepared. */
  hasCounterspellPrepared: boolean;
  /** Whether the character has Absorb Elements prepared. */
  hasAbsorbElementsPrepared: boolean;
  /** Whether the character has Hellish Rebuke prepared. */
  hasHellishRebukePrepared: boolean;
}

export interface CombatResourceBuilderInput {
  /** The character's class name (e.g. "Fighter", "monk"). */
  className: string;
  /** The character's level. */
  level: number;
  /** The character's sheet data (for ability scores, spell slots, prepared spells). */
  sheet: CharacterSheetLike & {
    spellSlots?: Record<string, number>;
    preparedSpells?: Array<{ name: string; [key: string]: unknown }>;
    resourcePools?: Array<{ name: string; current: number; max: number }>;
  };
}

// ----- Builder -----

/**
 * Build all combat resource pools for a character entering combat.
 *
 * This is the ONLY place where class-specific resource initialization should happen.
 * It delegates to each class's `resourcesAtLevel()` for class-owned pools,
 * then adds cross-class concerns (spell slots, Shield tracking).
 */
export function buildCombatResources(input: CombatResourceBuilderInput): CombatResourcesResult {
  const { className, level, sheet } = input;
  const classId = className.toLowerCase();

  let resourcePools: ResourcePool[] = [];

  // 1. Class-specific resource pools (from domain class definitions)
  if (isCharacterClassId(classId)) {
    if (classId === "monk") {
      // Monk needs wisdom score for Wholeness of Body calculation
      const wisdomScore = sheet?.abilityScores?.wisdom ?? 10;
      resourcePools = [...getMonkResourcePools(level, wisdomScore)];
    } else {
      const classDef = getClassDefinition(classId as CharacterClassId);
      resourcePools = [...(classDef.resourcesAtLevel?.(level) ?? [])];
    }
  }

  // 2. Merge any existing sheet-level resource pools that aren't already present
  //    (e.g. custom homebrew pools set on the character sheet)
  if (Array.isArray(sheet?.resourcePools)) {
    for (const pool of sheet.resourcePools) {
      if (!resourcePools.some((p) => p.name === pool.name)) {
        resourcePools.push({ name: pool.name, current: pool.current, max: pool.max });
      }
    }
  }

  // 3. Spell slot pools (cross-class: Wizard, Cleric, Sorcerer, Bard, etc.)
  if (sheet?.spellSlots && typeof sheet.spellSlots === "object") {
    for (const [levelStr, count] of Object.entries(sheet.spellSlots)) {
      const poolName = `spellSlot_${levelStr}`;
      if (!resourcePools.some((p) => p.name === poolName) && typeof count === "number" && count > 0) {
        resourcePools.push({ name: poolName, current: count, max: count });
      }
    }
  }

  // 4. Prepared spell tracking (cross-class: any caster with these spells prepared)
  let hasShieldPrepared = false;
  let hasCounterspellPrepared = false;
  let hasAbsorbElementsPrepared = false;
  let hasHellishRebukePrepared = false;
  if (Array.isArray(sheet?.preparedSpells)) {
    for (const s of sheet.preparedSpells) {
      if (typeof s.name !== "string") continue;
      const name = s.name.toLowerCase();
      if (name === "shield") hasShieldPrepared = true;
      if (name === "counterspell") hasCounterspellPrepared = true;
      if (name === "absorb elements") hasAbsorbElementsPrepared = true;
      if (name === "hellish rebuke") hasHellishRebukePrepared = true;
    }
  }

  return { resourcePools, hasShieldPrepared, hasCounterspellPrepared, hasAbsorbElementsPrepared, hasHellishRebukePrepared };
}
