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
import type { CharacterSheetLike } from "./class-feature-resolver.js";
import { pactMagicSlotsForLevel } from "./warlock.js";
import { computeFeatModifiers, FEAT_WAR_CASTER, FEAT_SENTINEL } from "../../rules/feat-modifiers.js";
import { LUCKY_POINTS_MAX } from "../../rules/lucky.js";

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
  /** Whether the character has the War Caster feat. */
  warCasterEnabled: boolean;
  /** Whether the character has the Sentinel feat. */
  sentinelEnabled: boolean;
  /** Warlock Pact Magic slot level (undefined for non-warlocks). */
  pactSlotLevel?: number;
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
  /**
   * Multi-class support: when provided, iterates all class entries for resource pools.
   * Each entry's resourcesAtLevel() is called with the class-specific level.
   * When absent, uses single className + level (backward compatible).
   */
  classLevels?: Array<{ classId: string; level: number; subclass?: string }>;
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
  const { className, level, sheet, classLevels } = input;

  let resourcePools: ResourcePool[] = [];

  // Compute ability modifiers from sheet scores (shared across all class entries)
  const abilityModifiers: Record<string, number> = {};
  if (sheet?.abilityScores) {
    for (const [ability, score] of Object.entries(sheet.abilityScores)) {
      if (typeof score === "number") {
        abilityModifiers[ability] = Math.floor((score - 10) / 2);
      }
    }
  }

  // 1. Class-specific resource pools (from domain class definitions)
  //    When classLevels is provided, iterate each class entry for its pools.
  //    Otherwise fall back to single className + level (backward compatible).
  const classEntries = classLevels && classLevels.length > 0
    ? classLevels
    : [{ classId: className.toLowerCase(), level, subclass: (sheet as any)?.subclass as string | undefined }];

  for (const entry of classEntries) {
    const entryClassId = entry.classId.toLowerCase();
    if (isCharacterClassId(entryClassId)) {
      const classDef = getClassDefinition(entryClassId as CharacterClassId);
      const classPools = classDef.resourcesAtLevel?.(entry.level, abilityModifiers, entry.subclass) ?? [];
      // Merge: only add pools not already present (avoid duplicates across classes)
      for (const pool of classPools) {
        if (!resourcePools.some((p) => p.name === pool.name)) {
          resourcePools.push({ ...pool });
        }
      }
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

  // 5. War Caster feat detection (for OA spell option)
  const featIds: readonly string[] = (sheet as any)?.featIds ?? (sheet as any)?.feats ?? [];
  const featMods = computeFeatModifiers(Array.isArray(featIds) ? featIds : []);

  // Lucky feat is tracked as a runtime resource pool in combat.
  if (featMods.luckyEnabled && !resourcePools.some((p) => p.name === "luckPoints")) {
    resourcePools.push({ name: "luckPoints", current: LUCKY_POINTS_MAX, max: LUCKY_POINTS_MAX });
  }

  const warCasterEnabled = Array.isArray(featIds) && featIds.includes(FEAT_WAR_CASTER);

  // 6. Sentinel feat detection (for OA enhancements)
  const sentinelEnabled = Array.isArray(featIds) && featIds.includes(FEAT_SENTINEL);

  // 7. Pact Magic slot level (Warlock only — check all class entries)
  let pactSlotLevel: number | undefined;
  for (const entry of classEntries) {
    if (entry.classId.toLowerCase() === "warlock" && entry.level >= 1) {
      pactSlotLevel = pactMagicSlotsForLevel(entry.level).slotLevel;
      break;
    }
  }

  return { resourcePools, hasShieldPrepared, hasCounterspellPrepared, hasAbsorbElementsPrepared, hasHellishRebukePrepared, warCasterEnabled, sentinelEnabled, pactSlotLevel };
}
