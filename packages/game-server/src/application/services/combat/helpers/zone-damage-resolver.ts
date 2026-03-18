/**
 * Zone Damage Resolver — processes zone effects during creature movement.
 *
 * Walks a movement path cell-by-cell, detecting:
 * - Zone entry (on_enter trigger)
 * - Per-5ft movement inside a zone (per_5ft_moved trigger)
 *
 * Rolls saving throws, applies damage through defenses, handles KO.
 * Returns the final position (may be mid-path if creature drops to 0 HP).
 */

import type { Position } from "../../../../domain/rules/movement.js";
import { calculateDistance } from "../../../../domain/rules/movement.js";
import type { CombatMap } from "../../../../domain/rules/combat-map.js";
import { getMapZones } from "../../../../domain/rules/combat-map.js";
import {
  isPositionInZone,
  doesZoneEffectAffect,
  getPassiveZoneSaveBonus,
  type CombatZone,
  type ZoneEffect,
} from "../../../../domain/entities/combat/zones.js";
import { applyDamageDefenses, type DamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import { extractDamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import { applyKoEffectsIfNeeded } from "./ko-handler.js";
import type { CombatantStateRecord, JsonValue } from "../../../types.js";

// ── Types ──

export interface ZoneDamageEvent {
  zoneId: string;
  zoneName: string;
  trigger: string;
  damageType?: string;
  rawDamage: number;
  finalDamage: number;
  saveAbility?: string;
  saveDC?: number;
  saveRoll?: number;
  saveTotal?: number;
  saveSuccess: boolean;
  position: Position;
}

export interface ZoneDamageResult {
  /** Total damage taken from all zone effects during this path */
  totalDamage: number;
  /** Individual zone damage events for logging/narration */
  events: ZoneDamageEvent[];
  /** Final position — may differ from destination if creature died mid-path */
  finalPosition: Position;
  /** True if creature dropped to 0 HP from zone damage */
  creatureDied: boolean;
}

export interface ZoneDamageResolverDeps {
  /** Rolls a d20. Returns { total, rolls }. If undefined, saves auto-fail. */
  rollD20?: () => { total: number; rolls: number[] };
  /** Rolls damage dice. Returns total. */
  rollDice?: (sides: number, count: number, modifier?: number) => number;
  /** Combat repository for persisting HP changes */
  combatRepo: {
    updateCombatantState(
      id: string,
      patch: Partial<Pick<CombatantStateRecord, "hpCurrent" | "conditions" | "resources">>,
    ): Promise<CombatantStateRecord>;
  };
  /** Flat bonus added to saving throws (e.g., from passive zone auras like Paladin Aura of Protection) */
  passiveZoneSaveBonus?: number;
  debugLog?: boolean;
}

// ── Resolver ──

/**
 * Process zone damage for a creature moving along a path.
 *
 * @param path       - Ordered array of positions the creature moves through (excludes start)
 * @param startPos   - Starting position before the move
 * @param combatant  - The moving combatant's record
 * @param map        - Current combat map (contains zones)
 * @param isSameFaction - Function that returns true if two combatant IDs are on the same faction
 * @param defenses   - Damage defenses for the moving creature
 * @param deps       - Dice rollers and repo access
 */
export async function resolveZoneDamageForPath(
  path: Position[],
  startPos: Position,
  combatant: CombatantStateRecord,
  map: CombatMap | undefined,
  isSameFaction: (sourceCombatantId: string) => boolean,
  defenses: DamageDefenses,
  deps: ZoneDamageResolverDeps,
): Promise<ZoneDamageResult> {
  const zones = map ? getMapZones(map) : [];
  if (zones.length === 0 || path.length === 0) {
    return {
      totalDamage: 0,
      events: [],
      finalPosition: path[path.length - 1] ?? startPos,
      creatureDied: false,
    };
  }

  const moverId = combatant.characterId ?? combatant.monsterId ?? combatant.npcId ?? combatant.id;
  let currentHP = combatant.hpCurrent;
  let totalDamage = 0;
  const events: ZoneDamageEvent[] = [];
  let finalPosition = path[path.length - 1] ?? startPos;
  let creatureDied = false;

  // Compute passive zone save bonus (e.g., Paladin Aura of Protection) at start position
  const effectiveDeps: ZoneDamageResolverDeps = deps.passiveZoneSaveBonus !== undefined ? deps : {
    ...deps,
    passiveZoneSaveBonus: getPassiveZoneSaveBonus(zones, startPos, moverId, isSameFaction),
  };

  // Track which zones the mover has already entered this move (for on_enter: once per move)
  const enteredZoneIds = new Set<string>();

  // Check if mover is already inside any zones at the start
  for (const zone of zones) {
    if (isPositionInZone(zone, startPos)) {
      enteredZoneIds.add(zone.id);
    }
  }

  // Walk the path cell by cell
  let prevPos = startPos;
  for (const cell of path) {
    // Check zone interactions at this cell
    for (const zone of zones) {
      const wasInZone = isPositionInZone(zone, prevPos);
      const isInZone = isPositionInZone(zone, cell);

      // --- On-enter trigger: first time entering the zone this move ---
      if (isInZone && !enteredZoneIds.has(zone.id)) {
        enteredZoneIds.add(zone.id);
        const entryResult = await applyZoneEffectsForTrigger(
          zone, "on_enter", cell, moverId, currentHP, isSameFaction, defenses, effectiveDeps,
        );
        events.push(...entryResult.events);
        totalDamage += entryResult.damage;
        currentHP -= entryResult.damage;

        if (currentHP <= 0) {
          creatureDied = true;
          finalPosition = prevPos; // Die at last safe position
          break;
        }
      }

      // --- Per-5ft trigger: every cell inside the zone ---
      if (isInZone) {
        const perStepResult = await applyZoneEffectsForTrigger(
          zone, "per_5ft_moved", cell, moverId, currentHP, isSameFaction, defenses, effectiveDeps,
        );
        events.push(...perStepResult.events);
        totalDamage += perStepResult.damage;
        currentHP -= perStepResult.damage;

        if (currentHP <= 0) {
          creatureDied = true;
          finalPosition = prevPos; // Die at last safe position before zone cell
          break;
        }
      }
    }

    if (creatureDied) break;
    prevPos = cell;
  }

  // If zone damage reduced HP, persist the HP change
  if (totalDamage > 0 && !creatureDied) {
    const newHP = Math.max(0, combatant.hpCurrent - totalDamage);
    await deps.combatRepo.updateCombatantState(combatant.id, {
      hpCurrent: newHP,
    });
    if (newHP <= 0) {
      await applyKoEffectsIfNeeded(combatant, combatant.hpCurrent, newHP, deps.combatRepo);
      creatureDied = true;
      // Position was already updated cell-by-cell, so finalPosition = last cell reached
    }
  } else if (creatureDied) {
    const newHP = 0;
    await deps.combatRepo.updateCombatantState(combatant.id, {
      hpCurrent: newHP,
    });
    await applyKoEffectsIfNeeded(combatant, combatant.hpCurrent, newHP, deps.combatRepo);
  }

  return {
    totalDamage,
    events,
    finalPosition,
    creatureDied,
  };
}

// ── Internal helpers ──

interface TriggerResult {
  damage: number;
  events: ZoneDamageEvent[];
}

async function applyZoneEffectsForTrigger(
  zone: CombatZone,
  trigger: "on_enter" | "per_5ft_moved",
  position: Position,
  moverId: string,
  currentHP: number,
  isSameFaction: (sourceCombatantId: string) => boolean,
  defenses: DamageDefenses,
  deps: ZoneDamageResolverDeps,
): Promise<TriggerResult> {
  let damage = 0;
  const events: ZoneDamageEvent[] = [];

  for (const effect of zone.effects) {
    if (effect.trigger !== trigger) continue;
    if (!doesZoneEffectAffect(effect, moverId, zone.sourceCombatantId, isSameFaction(zone.sourceCombatantId))) continue;
    if (!effect.damage) continue;

    // Roll saving throw if applicable
    let saveSuccess = false;
    let saveRoll: number | undefined;
    let saveTotal: number | undefined;

    if (effect.saveAbility && effect.saveDC !== undefined && deps.rollD20) {
      const roll = deps.rollD20();
      saveRoll = roll.rolls[0] ?? roll.total;
      saveTotal = roll.total + (deps.passiveZoneSaveBonus ?? 0);
      saveSuccess = saveTotal >= effect.saveDC;
    }

    // Roll damage
    let rawDamage = 0;
    if (deps.rollDice) {
      rawDamage = deps.rollDice(effect.damage.diceSides, effect.damage.diceCount, effect.damage.modifier ?? 0);
    } else {
      // Fallback: average damage
      rawDamage = Math.floor(effect.damage.diceCount * ((effect.damage.diceSides + 1) / 2)) + (effect.damage.modifier ?? 0);
    }

    // Half damage on successful save
    if (saveSuccess && effect.halfDamageOnSave) {
      rawDamage = Math.floor(rawDamage / 2);
    } else if (saveSuccess && !effect.halfDamageOnSave) {
      rawDamage = 0; // Full save negation
    }

    // Apply damage defenses
    const defenseResult = applyDamageDefenses(rawDamage, effect.damageType, defenses);
    const finalDamage = defenseResult.adjustedDamage;

    damage += finalDamage;
    events.push({
      zoneId: zone.id,
      zoneName: zone.source,
      trigger,
      damageType: effect.damageType,
      rawDamage,
      finalDamage,
      saveAbility: effect.saveAbility as string | undefined,
      saveDC: effect.saveDC,
      saveRoll,
      saveTotal,
      saveSuccess,
      position,
    });

    if (deps.debugLog) {
      console.log(`[ZoneDamage] ${zone.source} ${trigger}: ${finalDamage} ${effect.damageType ?? ""} damage at (${position.x},${position.y})${saveSuccess ? " (save)" : ""}`);
    }
  }

  return { damage, events };
}
