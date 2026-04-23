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
  hasHellishRebukePrepared: boolean;  /** Whether the character has the Cutting Words subclass feature (College of Lore, L3+). */
  hasCuttingWords: boolean;  /** Whether the character has the War Caster feat. */
  warCasterEnabled: boolean;
  /** Whether the character has the Sentinel feat. */
  sentinelEnabled: boolean;
  /** Warlock Pact Magic slot level (undefined for non-warlocks). */
  pactSlotLevel?: number;
  /** Fighting-style flag: Protection (reaction to impose disadvantage on ally-targeting attacks). */
  hasProtectionStyle: boolean;
  /** Fighting-style flag: Interception (reaction to reduce damage to nearby ally). */
  hasInterceptionStyle: boolean;
  /** Whether the character currently has a shield equipped (gates Protection). */
  hasShieldEquipped: boolean;
  /** Whether the character currently has a main-hand or two-handed melee weapon equipped (gates Interception). */
  hasWeaponEquipped: boolean;
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

  // 2. Merge sheet-level resource pools.
  //    The sheet carries PERSISTED state (e.g. post-rest spend/refund), so it overrides
  //    the class defaults for `current`/`max` when names collide. Pools on the sheet that
  //    aren't produced by class defaults (e.g. custom homebrew pools) are appended.
  if (Array.isArray(sheet?.resourcePools)) {
    for (const pool of sheet.resourcePools) {
      const idx = resourcePools.findIndex((p) => p.name === pool.name);
      if (idx === -1) {
        resourcePools.push({ name: pool.name, current: pool.current, max: pool.max });
      } else {
        resourcePools[idx] = { name: pool.name, current: pool.current, max: pool.max };
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

  // 8. Cutting Words (College of Lore Bard, L3+).
  //    Subclass-gated subclass feature — checked by class entries.
  let hasCuttingWords = false;
  for (const entry of classEntries) {
    if (entry.classId.toLowerCase() !== "bard") continue;
    if (entry.level < 3) continue;
    const sub = (entry.subclass ?? "").toLowerCase().replace(/\s+/g, "-");
    if (sub === "college-of-lore" || sub === "lore") {
      hasCuttingWords = true;
      break;
    }
  }

  // 9. Fighting-style passives + equipment snapshot (for Protection/Interception ally reactions).
  //    Read directly from the sheet at combat init so that Protection/Interception
  //    detectors in fighter.ts can gate on equipped items.
  //    TODO: staleness risk — if a character swaps weapons/shield mid-combat via an
  //    inventory action, these flags are NOT refreshed. Re-equip flows should either
  //    rebuild resources or mutate the combatant's resource flags directly.
  const sheetRaw = sheet as unknown as Record<string, unknown>;
  const fightingStyleRaw = sheetRaw?.fightingStyle;
  const fightingStyle = typeof fightingStyleRaw === "string" ? fightingStyleRaw.toLowerCase() : undefined;
  const hasProtectionStyle = fightingStyle === "protection";
  const hasInterceptionStyle = fightingStyle === "interception";

  // Shield equipped: check pre-enriched equippedShield, then fallback to equipment.shield.
  let hasShieldEquipped = false;
  const enrichedShield = sheetRaw?.equippedShield;
  if (enrichedShield && typeof enrichedShield === "object") {
    const es = enrichedShield as Record<string, unknown>;
    if (typeof es.name === "string") hasShieldEquipped = true;
  }
  if (!hasShieldEquipped) {
    const equip = sheetRaw?.equipment;
    if (equip && typeof equip === "object" && !Array.isArray(equip)) {
      const shieldObj = (equip as Record<string, unknown>).shield;
      if (shieldObj && typeof shieldObj === "object") {
        const shieldName = (shieldObj as Record<string, unknown>).name;
        if (typeof shieldName === "string") hasShieldEquipped = true;
      }
    }
  }

  // Weapon equipped: any main-hand or two-handed melee weapon on sheet.equipment.weapons.
  // A weapon is considered "main-hand/two-handed" when it is not explicitly flagged as
  // off-hand only (equipped !== false AND offHand !== true). Ranged weapons are excluded.
  let hasWeaponEquipped = false;
  const equip = sheetRaw?.equipment;
  if (equip && typeof equip === "object" && !Array.isArray(equip)) {
    const weapons = (equip as Record<string, unknown>).weapons;
    if (Array.isArray(weapons)) {
      for (const w of weapons) {
        if (!w || typeof w !== "object") continue;
        const weapon = w as Record<string, unknown>;
        if (weapon.equipped === false) continue;
        if (weapon.offHand === true) continue;
        const kind = typeof weapon.kind === "string" ? weapon.kind.toLowerCase() : "melee";
        if (kind !== "melee") continue;
        hasWeaponEquipped = true;
        break;
      }
    }
  }

  return {
    resourcePools,
    hasShieldPrepared,
    hasCounterspellPrepared,
    hasAbsorbElementsPrepared,
    hasHellishRebukePrepared,
    hasCuttingWords,
    warCasterEnabled,
    sentinelEnabled,
    pactSlotLevel,
    hasProtectionStyle,
    hasInterceptionStyle,
    hasShieldEquipped,
    hasWeaponEquipped,
  };
}
