/**
 * SavingThrowResolver - Handles saving throw resolution in the tabletop flow.
 *
 * Auto-resolves saving throws for all targets (monsters and players alike in v1).
 * Uses the DiceRoller for deterministic/seeded rolls.
 * Works with both structured ActiveCondition[] and legacy string[] conditions.
 */

import type { DiceRoller } from "../../../../../domain/rules/dice-roller.js";
import type { ICombatRepository } from "../../../../repositories/combat-repository.js";
import {
  normalizeConditions,
  addCondition,
  removeCondition,
  createCondition,
  getExhaustionD20Penalty,
  type ActiveCondition,
  type Condition,
  type ConditionDuration,
} from "../../../../../domain/entities/combat/conditions.js";
import { getAbilityModifier, getProficiencyBonus } from "../../../../../domain/rules/ability-checks.js";
import { normalizeResources, getPosition, setPosition, getActiveEffects, isConditionImmuneByEffects, removeActiveEffectById } from "../../helpers/resource-utils.js";
import { findCombatantByEntityId } from "../../helpers/combatant-lookup.js";
import {
  applyForcedMovement,
  calculateDistance,
  directionFromTo,
  type ForcedMovementDirection,
} from "../../../../../domain/rules/movement.js";

/** Minimal map shape needed for forced-movement collision detection. */
type PassabilityMap = Parameters<typeof applyForcedMovement>[3];
import {
  breakConcentration,
  getConcentrationSpellName,
  isConcentrationBreakingCondition,
} from "../../helpers/concentration-helper.js";
import {
  calculateBonusFromEffects,
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
  type ActiveEffect,
} from "../../../../../domain/entities/combat/effects.js";
import type { SavingThrowPendingAction, SaveOutcome, SavingThrowAutoResult } from "../tabletop-types.js";
import { classHasFeature } from "../../../../../domain/entities/classes/registry.js";
import { AURA_OF_PROTECTION, EVASION } from "../../../../../domain/entities/classes/feature-keys.js";
import { computeAuraSaveBonus, getAuraOfProtectionRange } from "../../../../../domain/entities/classes/paladin.js";
import { getSpeciesTraits } from "../../../../../domain/entities/creatures/species-registry.js";

/**
 * Parameters for creating a saving throw pending action.
 */
export interface CreateSavingThrowParams {
  /** Who must make the save */
  actorId: string;
  /** Who forced the save */
  sourceId: string;
  /** Ability score for the save */
  ability: string;
  /** Pre-calculated DC */
  dc: number;
  /** Human-readable reason */
  reason: string;
  /** What happens on success */
  onSuccess: SaveOutcome;
  /** What happens on failure */
  onFailure: SaveOutcome;
  /** Extra context */
  context?: Record<string, unknown>;
}

/**
 * Detailed result from resolving a saving throw.
 */
export interface SavingThrowResolution {
  /** Whether the save succeeded */
  success: boolean;
  /** Raw d20 roll */
  rawRoll: number;
  /** Total modifier applied */
  modifier: number;
  /** Final total (roll + modifier) */
  total: number;
  /** DC checked against */
  dc: number;
  /** Cover bonus applied to the save (DEX saves only) */
  coverBonus?: number;
  /** The outcome that was applied */
  appliedOutcome: SaveOutcome;
  /** Conditions added */
  conditionsApplied: string[];
  /** Conditions removed */
  conditionsRemoved: string[];
  /** Whether the target has Evasion (Rogue 7/Monk 7 — DEX saves only) */
  hasEvasion?: boolean;
}

export class SavingThrowResolver {
  constructor(
    private readonly combatRepo: ICombatRepository,
    private readonly diceRoller: DiceRoller,
    private readonly debugLogsEnabled: boolean = false,
  ) {}

  /**
   * Build a SavingThrowPendingAction from parameters.
   */
  buildPendingAction(params: CreateSavingThrowParams): SavingThrowPendingAction {
    return {
      type: "SAVING_THROW",
      timestamp: new Date(),
      actorId: params.actorId,
      sourceId: params.sourceId,
      ability: params.ability,
      dc: params.dc,
      reason: params.reason,
      onSuccess: params.onSuccess,
      onFailure: params.onFailure,
      context: params.context,
    };
  }

  /**
   * Auto-resolve a saving throw for a target creature.
   * Rolls d20, applies modifiers, determines success/failure,
   * and applies the appropriate outcome (conditions, damage, movement).
   */
  async resolve(
    action: SavingThrowPendingAction,
    encounterId: string,
    characters: any[],
    monsters: any[],
    npcs: any[],
  ): Promise<SavingThrowResolution> {
    const target =
      monsters.find((m) => m.id === action.actorId) ||
      characters.find((c) => c.id === action.actorId) ||
      npcs.find((n) => n.id === action.actorId);

    // Get target stats for save modifier calculation
    const targetSheet = (target as any)?.statBlock ?? (target as any)?.sheet ?? {};
    const abilityScores = targetSheet?.abilityScores ?? {};
    const abilityScore = abilityScores[action.ability] ?? 10;
    const abilityMod = getAbilityModifier(abilityScore);

    // Check proficiency in this save
    const level = targetSheet?.level ?? (target as any)?.level ?? 1;
    const profBonus = getProficiencyBonus(level);
    const saveProficiencies: string[] = Array.isArray(targetSheet?.saveProficiencies)
      ? targetSheet.saveProficiencies
      : Array.isArray(targetSheet?.proficiencies)
        ? targetSheet.proficiencies
        : [];
    const profKey = `${action.ability}_save`;
    const altProfKey = action.ability;
    const isProficient = saveProficiencies.includes(profKey) || saveProficiencies.includes(altProfKey);
    const profMod = isProficient ? profBonus : 0;

    let totalModifier = abilityMod + profMod;

    // ── ActiveEffect: saving throw bonuses (flat + dice) + advantage/disadvantage ──
    const combatantsForEffects = await this.combatRepo.listCombatants(encounterId);
    const targetCombatantForEffects = findCombatantByEntityId(combatantsForEffects, action.actorId);
    const targetEffects = getActiveEffects(targetCombatantForEffects?.resources ?? {});

    // Brutal Strike (Staggering Blow): disadvantage on next attack roll OR saving throw.
    // If consumed by a saving throw, remove immediately.
    let staggeringSaveDisadvantage = false;
    const staggeringEffect = targetEffects.find(
      (e) =>
        e.source === "Brutal Strike: Staggering Blow"
        && e.type === "disadvantage"
        && e.target === "custom"
        && e.duration === "until_triggered",
    );
    if (staggeringEffect && targetCombatantForEffects) {
      staggeringSaveDisadvantage = true;
      const updatedResources = removeActiveEffectById(targetCombatantForEffects.resources ?? {}, staggeringEffect.id);
      await this.combatRepo.updateCombatantState(targetCombatantForEffects.id, {
        resources: updatedResources as any,
      });
      if (this.debugLogsEnabled) {
        console.log(`[SavingThrowResolver] Brutal Strike Staggering Blow consumed on save for ${targetCombatantForEffects.id}`);
      }
    }
    const saveAbility = action.ability as import("../../../../../domain/entities/core/ability-scores.js").Ability | undefined;
    const saveBonusResult = calculateBonusFromEffects(targetEffects, 'saving_throws', saveAbility);
    totalModifier += saveBonusResult.flatBonus;
    let effectSaveDiceBonus = 0;
    for (const dr of saveBonusResult.diceRolls) {
      const count = Math.abs(dr.count);
      const sign = dr.count < 0 ? -1 : 1;
      for (let i = 0; i < count; i++) {
        effectSaveDiceBonus += sign * this.diceRoller.rollDie(dr.sides).total;
      }
    }
    totalModifier += effectSaveDiceBonus;

    // ── D&D 2024 Exhaustion: flat penalty to all d20 tests (-2 per level) ──
    const targetConditionsForExhaustion = normalizeConditions(targetCombatantForEffects?.conditions as unknown[] ?? []);
    const exhaustionPenalty = getExhaustionD20Penalty(targetConditionsForExhaustion);
    if (exhaustionPenalty !== 0) {
      totalModifier += exhaustionPenalty;
      if (this.debugLogsEnabled) {
        console.log(`[SavingThrowResolver] Exhaustion penalty ${exhaustionPenalty} on save`);
      }
    }

    // ── Cover bonus for DEX saves (D&D 5e 2024) ──
    let coverBonusApplied = 0;
    if (action.ability === 'dexterity' && typeof action.context?.coverBonus === 'number') {
      coverBonusApplied = action.context.coverBonus as number;
      totalModifier += coverBonusApplied;
      if (this.debugLogsEnabled) {
        console.log(`[SavingThrowResolver] Cover bonus +${coverBonusApplied} on DEX save`);
      }
    }

    // ── Paladin Aura of Protection (level 6+) ──
    // All allies within 10 ft (30 ft at level 18) add the Paladin's CHA modifier (min +1) to saves.
    {
      const targetFaction = characters.find((c: any) => c.id === action.actorId)?.faction;
      let bestAuraBonus = 0;

      for (const combatant of combatantsForEffects) {
        if (!combatant.characterId) continue; // Only Characters can be paladins with this aura
        const paladinChar = characters.find((c: any) => c.id === combatant.characterId);
        if (!paladinChar) continue;
        if (combatant.characterId === action.actorId) continue; // Don't self-stack (handled by aura applying to self too, but redundant)

        // Must be same faction as the target
        if (targetFaction !== undefined && (paladinChar.faction ?? "party") !== targetFaction) continue;

        // Must be a paladin with Aura of Protection at level 6+
        const paladinClass = ((paladinChar.className ?? (paladinChar.sheet as any)?.className ?? "")).toLowerCase();
        const paladinLevel: number = paladinChar.level ?? (paladinChar.sheet as any)?.level ?? 1;
        if (!classHasFeature(paladinClass, AURA_OF_PROTECTION, paladinLevel)) continue;

        // Check range (if positions available)
        const auraRange = getAuraOfProtectionRange(paladinLevel);
        const paladinCombatantPos = getPosition(normalizeResources(combatant.resources ?? {}));
        const targetCombatantPos = targetCombatantForEffects
          ? getPosition(normalizeResources(targetCombatantForEffects.resources ?? {}))
          : undefined;

        if (paladinCombatantPos && targetCombatantPos) {
          const dist = calculateDistance(paladinCombatantPos, targetCombatantPos);
          if (dist > auraRange) continue;
        }
        // If positions not available: encounter-wide fallback (aura applies)

        // Get paladin's CHA modifier
        const paladinSheet = (paladinChar.sheet ?? {}) as Record<string, unknown>;
        const paladinAbilityScores = (paladinSheet.abilityScores ?? {}) as Record<string, number>;
        const paladinCha = paladinAbilityScores.charisma ?? 10;
        const paladinChaMod = getAbilityModifier(paladinCha);
        const auraBonus = computeAuraSaveBonus(paladinChaMod);

        if (auraBonus > bestAuraBonus) bestAuraBonus = auraBonus;
      }

      // Also check if the target itself is a paladin (aura applies to self)
      const selfChar = characters.find((c: any) => c.id === action.actorId);
      if (selfChar) {
        const selfClass = ((selfChar.className ?? (selfChar.sheet as any)?.className ?? "")).toLowerCase();
        const selfLevel: number = selfChar.level ?? (selfChar.sheet as any)?.level ?? 1;
        if (classHasFeature(selfClass, AURA_OF_PROTECTION, selfLevel)) {
          const selfSheet = (selfChar.sheet ?? {}) as Record<string, unknown>;
          const selfAbilityScores = (selfSheet.abilityScores ?? {}) as Record<string, number>;
          const selfCha = selfAbilityScores.charisma ?? 10;
          const selfChaMod = getAbilityModifier(selfCha);
          const selfAuraBonus = computeAuraSaveBonus(selfChaMod);
          if (selfAuraBonus > bestAuraBonus) bestAuraBonus = selfAuraBonus;
        }
      }

      if (bestAuraBonus > 0) {
        totalModifier += bestAuraBonus;
        if (this.debugLogsEnabled) {
          console.log(`[SavingThrowResolver] Paladin Aura of Protection +${bestAuraBonus} on saving throw`);
        }
      }
    }

    // Check advantage/disadvantage on saving throws from effects
    // D&D 5e 2024: Danger Sense is negated if the creature is Blinded, Deafened, or Incapacitated
    let filteredEffects = targetEffects;
    if (targetCombatantForEffects) {
      const targetCondNames = normalizeConditions(targetCombatantForEffects.conditions as unknown[])
        .map(c => c.condition.toLowerCase());
      const dangerSenseNegated = targetCondNames.some(c =>
        c === "blinded" || c === "deafened" || c === "incapacitated",
      );
      if (dangerSenseNegated) {
        filteredEffects = targetEffects.filter(e => e.source !== "Danger Sense");
        if (filteredEffects.length !== targetEffects.length && this.debugLogsEnabled) {
          console.log(`[SavingThrowResolver] Danger Sense negated by condition — filtering out advantage`);
        }
      }
    }
    const hasEffectAdvantage = hasAdvantageFromEffects(filteredEffects, 'saving_throws', saveAbility);
    const hasEffectDisadvantage = hasDisadvantageFromEffects(filteredEffects, 'saving_throws', saveAbility) || staggeringSaveDisadvantage;

    // ── Species save advantages (Elf vs charmed, Halfling vs frightened, Dwarf vs poisoned, etc.) ──
    let speciesAdvantage = false;
    const speciesName = targetSheet?.species ?? targetSheet?.race;
    if (typeof speciesName === "string") {
      const speciesTraits = getSpeciesTraits(speciesName);
      if (speciesTraits) {
        // Check condition-based advantages (e.g., Halfling: advantage on saves vs Frightened)
        const conditionsOnFailure: string[] = action.onFailure?.conditions?.add ?? [];
        for (const sa of speciesTraits.saveAdvantages) {
          if (sa.againstCondition && conditionsOnFailure.some(
            c => c.toLowerCase() === sa.againstCondition!.toLowerCase(),
          )) {
            speciesAdvantage = true;
            if (this.debugLogsEnabled) {
              console.log(`[SavingThrowResolver] Species advantage: ${speciesName} vs ${sa.againstCondition}`);
            }
            break;
          }
        }
      }
    }

    const hasFinalAdvantage = hasEffectAdvantage || speciesAdvantage;

    // Roll the d20 (with advantage/disadvantage from effects)
    let roll;
    if (hasFinalAdvantage && !hasEffectDisadvantage) {
      const roll1 = this.diceRoller.d20();
      const roll2 = this.diceRoller.d20();
      roll = roll1.total >= roll2.total ? roll1 : roll2;
      if (this.debugLogsEnabled) console.log(`[SavingThrowResolver] Advantage on save: d20(${roll1.total}, ${roll2.total}) → ${roll.total}`);
    } else if (hasEffectDisadvantage && !hasFinalAdvantage) {
      const roll1 = this.diceRoller.d20();
      const roll2 = this.diceRoller.d20();
      roll = roll1.total <= roll2.total ? roll1 : roll2;
      if (this.debugLogsEnabled) console.log(`[SavingThrowResolver] Disadvantage on save: d20(${roll1.total}, ${roll2.total}) → ${roll.total}`);
    } else {
      roll = this.diceRoller.d20();
    }
    const rawRoll = roll.total;
    const total = rawRoll + totalModifier;
    const success = total >= action.dc;

    if (this.debugLogsEnabled) {
      console.log(
        `[SavingThrowResolver] ${action.reason}: d20(${rawRoll}) + ${totalModifier} = ${total} vs DC ${action.dc} → ${success ? "SUCCESS" : "FAILURE"}`,
      );
    }

    const outcome = success ? action.onSuccess : action.onFailure;
    const conditionsApplied: string[] = [];
    const conditionsRemoved: string[] = [];

    // Apply condition changes
    if (outcome.conditions) {
      const combatants = await this.combatRepo.listCombatants(encounterId);
      const targetCombatant = findCombatantByEntityId(combatants, action.actorId);

      if (targetCombatant) {
        let conditions = normalizeConditions(targetCombatant.conditions);

        if (outcome.conditions.add) {
          for (const condName of outcome.conditions.add) {
            // Check condition immunity from ActiveEffects
            if (isConditionImmuneByEffects(targetCombatant.resources, condName)) {
              continue; // Skip — creature is immune to this condition
            }
            // Try to get expiry info from context
            const expiresAt = (action.context?.expiresAt as { event: 'start_of_turn' | 'end_of_turn'; combatantId: string } | undefined);
            // Use sourceId (caster combatant ID) for conditions like Frightened that need
            // to track who applied them. Fall back to reason (spell name) for display.
            const condSource = action.sourceId ?? action.reason;
            const newCond = createCondition(condName as Condition, expiresAt ? 'until_start_of_next_turn' : 'until_removed', {
              source: condSource,
              expiresAt,
            });
            conditions = addCondition(conditions, newCond);
            conditionsApplied.push(condName);
          }
        }

        if (outcome.conditions.remove) {
          for (const condName of outcome.conditions.remove) {
            conditions = removeCondition(conditions, condName as Condition);
            conditionsRemoved.push(condName);
          }
        }

        // Store structured ActiveCondition[] directly in conditions column
        // (normalizeConditions handles both formats on read, so this is backward-compatible)
        await this.combatRepo.updateCombatantState(targetCombatant.id, {
          conditions: conditions as any,
        });

        // Check if any applied condition should auto-break concentration
        if (conditionsApplied.some(isConcentrationBreakingCondition)) {
          const spellName = getConcentrationSpellName(targetCombatant.resources);
          if (spellName) {
            await breakConcentration(targetCombatant, encounterId, this.combatRepo);
          }
        }
      }
    }

    // Apply movement effects (push) using forced movement primitive
    // Forced movement does NOT provoke opportunity attacks (D&D 5e 2024)
    if (outcome.movement?.push) {
      const combatants = await this.combatRepo.listCombatants(encounterId);
      const targetCombatant = findCombatantByEntityId(combatants, action.actorId);
      const sourceCombatant = findCombatantByEntityId(combatants, action.sourceId);

      if (targetCombatant && sourceCombatant) {
        const targetRes = normalizeResources(targetCombatant.resources);
        const sourceRes = normalizeResources(sourceCombatant.resources);
        const targetPos = getPosition(targetRes);
        const sourcePos = getPosition(sourceRes);

        if (targetPos && sourcePos) {
          const dir = outcome.movement.direction ?? directionFromTo(sourcePos, targetPos);
          const encounter = await this.combatRepo.getEncounterById(encounterId);
          const map = encounter?.mapData as unknown as PassabilityMap | undefined;
          const pushResult = applyForcedMovement(targetPos, dir, outcome.movement.push, map);
          if (pushResult.distanceMoved > 0) {
            const updatedRes = setPosition(targetRes, pushResult.finalPosition);
            await this.combatRepo.updateCombatantState(targetCombatant.id, {
              resources: updatedRes as any,
            });
          }
        }
      }
    }

    // ── Evasion detection (Rogue 7, Monk 7) — DEX saves only ──
    let evasionDetected = false;
    if (action.ability === "dexterity") {
      const className = (targetSheet?.className ?? (target as any)?.className ?? "").toLowerCase();
      if (className && classHasFeature(className, EVASION, level)) {
        evasionDetected = true;
        if (this.debugLogsEnabled) {
          console.log(`[SavingThrowResolver] Evasion detected for ${className} level ${level} — DEX save adjustments apply`);
        }
      }
    }

    return {
      success,
      rawRoll,
      modifier: totalModifier,
      total,
      dc: action.dc,
      coverBonus: coverBonusApplied > 0 ? coverBonusApplied : undefined,
      appliedOutcome: outcome,
      conditionsApplied,
      conditionsRemoved,
      hasEvasion: evasionDetected || undefined,
    };
  }

  /**
   * Build a SavingThrowAutoResult from the resolution for API response.
   */
  buildResult(
    action: SavingThrowPendingAction,
    resolution: SavingThrowResolution,
    opts?: {
      actionComplete?: boolean;
      requiresPlayerInput?: boolean;
      type?: "REQUEST_ROLL";
      diceNeeded?: string;
      narration?: string;
    },
  ): SavingThrowAutoResult {
    return {
      rollType: "savingThrow",
      ability: action.ability,
      dc: action.dc,
      rawRoll: resolution.rawRoll,
      modifier: resolution.modifier,
      total: resolution.total,
      success: resolution.success,
      reason: action.reason,
      outcomeSummary: resolution.appliedOutcome.summary,
      conditionsApplied: resolution.conditionsApplied.length > 0 ? resolution.conditionsApplied : undefined,
      conditionsRemoved: resolution.conditionsRemoved.length > 0 ? resolution.conditionsRemoved : undefined,
      actionComplete: opts?.actionComplete ?? true,
      requiresPlayerInput: opts?.requiresPlayerInput ?? false,
      message: (() => {
        const coverPart = resolution.coverBonus && resolution.coverBonus > 0
          ? ` + ${resolution.coverBonus} (${(action.context?.coverLevel as string) ?? 'cover'})`
          : '';
        const baseModifier = resolution.modifier - (resolution.coverBonus ?? 0);
        return `${action.reason}: d20(${resolution.rawRoll}) + ${baseModifier}${coverPart} = ${resolution.total} vs DC ${action.dc} → ${resolution.success ? "Success" : "Failure"}. ${resolution.appliedOutcome.summary}`;
      })(),
      narration: opts?.narration,
      type: opts?.type,
      diceNeeded: opts?.diceNeeded,
    };
  }
}
