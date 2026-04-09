/**
 * HitRiderResolver — assembles and resolves post-damage hit-rider enhancements.
 *
 * Two responsibilities:
 * 1. **Assembly** (`assembleOnHitEnhancements`): filter eligible on-hit defs, match
 *    player opt-in keywords in damage text, and build the HitRiderEnhancement[] list
 *    (Stunning Strike, Divine Smite, Open Hand Technique, etc.).
 * 2. **Resolution** (`resolvePostDamageEffect`): resolve post-damage effects (saving
 *    throws, condition application) via SavingThrowResolver.
 *
 * Extracted from RollStateMachine (Phase: God-Module Decomposition §2.1).
 */

import {
  normalizeResources,
  updateResourcePool,
  isConditionImmuneByEffects,
  getResourcePools,
  hasResourceAvailable,
  spendResourceFromPool,
  hasBonusActionAvailable,
  useBonusAction,
} from "../../helpers/resource-utils.js";
import { findCombatantByEntityId } from "../../helpers/combatant-lookup.js";
import {
  normalizeConditions,
  addCondition,
  createCondition,
  type Condition,
} from "../../../../../domain/entities/combat/conditions.js";
import { ClassFeatureResolver } from "../../../../../domain/entities/classes/class-feature-resolver.js";
import { divineSmiteDice } from "../../../../../domain/entities/classes/paladin.js";
import { matchOnHitEnhancementsInText } from "../../../../../domain/entities/classes/combat-text-profile.js";
import { getAllCombatTextProfiles } from "../../../../../domain/entities/classes/registry.js";
import type { SavingThrowResolver } from "./saving-throw-resolver.js";
import type {
  HitRiderEnhancement,
  HitRiderEnhancementResult,
  SaveOutcome,
  TabletopCombatServiceDeps,
  WeaponSpec,
} from "../tabletop-types.js";
import type { SessionCharacterRecord } from "../../../../types.js";

/** Normalize an ID for case/separator-insensitive comparison. */
function normalizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export class HitRiderResolver {
  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly savingThrowResolver: SavingThrowResolver | null,
    private readonly debugLogsEnabled: boolean,
  ) {}

  /**
   * Assemble on-hit enhancements from player opt-in keywords in damage text.
   * Handles eligibility filtering, text matching, and class-specific enhancement
   * building (Stunning Strike, Divine Smite, Open Hand Technique).
   *
   * Returns an empty array when no keywords match or the actor has no eligible enhancements.
   */
  async assembleOnHitEnhancements(input: {
    rawText: string;
    actorId: string;
    encounterId: string;
    characters: SessionCharacterRecord[];
    weaponSpec?: WeaponSpec;
    bonusAction?: string;
  }): Promise<HitRiderEnhancement[]> {
    const { rawText, actorId, encounterId, characters, weaponSpec, bonusAction } = input;

    const actorChar = characters.find((c) => c.id === actorId);
    if (!actorChar) return [];

    const actorClassName = actorChar.className ?? (actorChar.sheet as any)?.className ?? "";
    const actorLevel = ClassFeatureResolver.getLevel((actorChar.sheet ?? {}) as any, actorChar.level);

    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = findCombatantByEntityId(combatants, actorId);
    const actorRes = normalizeResources(actorCombatant?.resources ?? {});
    const actorResourcePools = getResourcePools(actorRes);

    // Get raw on-hit enhancement defs for the actor's class
    const profiles = getAllCombatTextProfiles();
    const matchingProfiles = profiles.filter((p) => p.classId === actorClassName.toLowerCase());
    const onHitDefs = matchingProfiles.flatMap((p) => (p.attackEnhancements ?? []).filter((e) => (e.trigger ?? "onDeclare") === "onHit"));

    // Filter to eligible defs
    const actorSubclass = (actorChar.sheet as any)?.subclass ?? "";
    const eligibleDefs = onHitDefs.filter((def) => {
      if (actorLevel < def.minLevel) return false;
      if (def.requiresSubclass && normalizeId(def.requiresSubclass) !== normalizeId(actorSubclass ?? "")) return false;
      if (def.requiresMelee && weaponSpec?.kind !== "melee") return false;
      if (def.requiresBonusAction && bonusAction !== def.requiresBonusAction) return false;
      if (def.turnTrackingKey && actorRes[def.turnTrackingKey] === true) return false;
      if (def.resourceCost) {
        const pool = actorResourcePools.find((p) => p.name === def.resourceCost!.pool);
        if (!pool || pool.current < def.resourceCost.amount) return false;
      }
      return true;
    });

    // Match player keywords in damage text
    const matched = matchOnHitEnhancementsInText(rawText, eligibleDefs);
    if (matched.length === 0) return [];

    const enhancements: HitRiderEnhancement[] = [];
    const actorSheet = (actorChar.sheet ?? {}) as any;
    const wisdomScore = actorSheet?.abilityScores?.wisdom ?? 10;
    const profBonus = ClassFeatureResolver.getProficiencyBonus(actorSheet, actorLevel);
    const wisMod = Math.floor((wisdomScore - 10) / 2);
    const saveDC = 8 + profBonus + wisMod;

    for (const match of matched) {
      if (match.keyword === "stunning-strike") {
        enhancements.push({
          abilityId: "class:monk:stunning-strike",
          displayName: "Stunning Strike",
          postDamageEffect: "saving-throw",
          context: {
            saveAbility: "constitution",
            saveDC,
            saveReason: "Stunning Strike",
            sourceId: actorId,
            onSuccess: {
              conditions: { add: ["StunningStrikePartial"] },
              speedModifier: 0.5,
              summary: "Speed halved, next attack has advantage.",
            } satisfies SaveOutcome,
            onFailure: {
              conditions: { add: ["Stunned"] },
              summary: "Stunned until start of monk's next turn!",
            } satisfies SaveOutcome,
            expiresAt: { event: "start_of_turn", combatantId: actorId },
            resourceCost: { pool: "ki", amount: 1 },
            turnTrackingKey: "stunningStrikeUsedThisTurn",
          },
        });
      } else if (match.keyword === "divine-smite") {
        // Find lowest available spell slot (1-5)
        let slotLevel = 0;
        for (let sl = 1; sl <= 5; sl++) {
          if (hasResourceAvailable(actorRes, `spellSlot_${sl}`, 1)) {
            slotLevel = sl;
            break;
          }
        }
        if (slotLevel > 0 && hasBonusActionAvailable(actorRes)) {
          // Spend the spell slot + bonus action
          let updatedSmiteRes = spendResourceFromPool(actorRes, `spellSlot_${slotLevel}`, 1);
          updatedSmiteRes = useBonusAction(updatedSmiteRes);
          if (actorCombatant) {
            await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
              resources: updatedSmiteRes as any,
            });
          }
          const diceCount = divineSmiteDice(slotLevel);
          enhancements.push({
            abilityId: "class:paladin:divine-smite",
            displayName: "Divine Smite",
            bonusDice: { diceCount, diceSides: 8 },
          });
          if (this.debugLogsEnabled) console.log(`[HitRiderResolver] Divine Smite (on-hit): ${diceCount}d8 radiant (level ${slotLevel} slot spent)`);
        }
      } else if (match.keyword === "open-hand-technique" && match.choice) {
        const technique = match.choice;
        if (technique === "addle") {
          enhancements.push({
            abilityId: "class:monk:open-hand-technique",
            displayName: "Open Hand Technique (Addle)",
            postDamageEffect: "apply-condition",
            context: { conditionName: "Addled" },
          });
        } else if (technique === "push") {
          enhancements.push({
            abilityId: "class:monk:open-hand-technique",
            displayName: "Open Hand Technique (Push)",
            postDamageEffect: "saving-throw",
            context: {
              saveAbility: "strength",
              saveDC,
              saveReason: "Open Hand Technique (Push)",
              sourceId: actorId,
              onSuccess: { summary: "Resists the push!" } satisfies SaveOutcome,
              onFailure: { movement: { push: 15 }, summary: "Pushed 15 feet!" } satisfies SaveOutcome,
            },
          });
        } else if (technique === "topple") {
          enhancements.push({
            abilityId: "class:monk:open-hand-technique",
            displayName: "Open Hand Technique (Topple)",
            postDamageEffect: "saving-throw",
            context: {
              saveAbility: "dexterity",
              saveDC,
              saveReason: "Open Hand Technique (Topple)",
              sourceId: actorId,
              onSuccess: { summary: "Keeps footing!" } satisfies SaveOutcome,
              onFailure: { conditions: { add: ["Prone"] }, summary: "Knocked Prone!" } satisfies SaveOutcome,
            },
          });
        }
      }
    }

    return enhancements;
  }

  /**
   * Resolve a post-damage effect from a hit-rider enhancement.
   * Handles saving throws (via SavingThrowResolver), condition application, etc.
   */
  async resolvePostDamageEffect(
    enhancement: HitRiderEnhancement,
    actorId: string,
    targetId: string,
    encounterId: string,
    characters: any[],
    monsters: any[],
    npcs: any[],
  ): Promise<HitRiderEnhancementResult> {
    const ctx = enhancement.context ?? {};
    const target =
      monsters.find((m) => m.id === targetId) ||
      characters.find((c) => c.id === targetId) ||
      npcs.find((n) => n.id === targetId);
    const targetName = (target as any)?.name ?? "Target";

    // Spend resources if specified in context (e.g. 1 ki for Stunning Strike)
    if (ctx.resourceCost) {
      const { pool, amount } = ctx.resourceCost as { pool: string; amount: number };
      const combatants = await this.deps.combatRepo.listCombatants(encounterId);
      const actorCombatant = combatants.find(
        (c: any) => c.combatantType === "Character" && c.characterId === actorId,
      );
      if (actorCombatant) {
        let updatedRes = updateResourcePool(actorCombatant.resources ?? {}, pool, (p) => ({
          ...p, current: Math.max(0, p.current - amount),
        }));
        const normalized = normalizeResources(updatedRes);
        if (ctx.turnTrackingKey) {
          (normalized as any)[ctx.turnTrackingKey as string] = true;
        }
        await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: normalized as any,
        });
        if (this.debugLogsEnabled) {
          console.log(`[RollStateMachine] ${enhancement.displayName}: Spent ${amount} ${pool}`);
        }
      }
    }

    switch (enhancement.postDamageEffect) {
      case "saving-throw": {
        if (!this.savingThrowResolver) {
          return {
            abilityId: enhancement.abilityId,
            displayName: enhancement.displayName,
            summary: `${enhancement.displayName}: Saving throw resolver not available.`,
          };
        }

        const saveAction = this.savingThrowResolver.buildPendingAction({
          actorId: targetId,
          sourceId: (ctx.sourceId as string) ?? actorId,
          ability: ctx.saveAbility as string,
          dc: ctx.saveDC as number,
          reason: ctx.saveReason as string,
          onSuccess: ctx.onSuccess as SaveOutcome,
          onFailure: ctx.onFailure as SaveOutcome,
          context: ctx.expiresAt ? { expiresAt: ctx.expiresAt } : undefined,
        });

        const resolution = await this.savingThrowResolver.resolve(
          saveAction, encounterId, characters, monsters, npcs,
        );

        const abilityUpper = ((ctx.saveAbility as string) ?? "").toUpperCase().slice(0, 3);
        const successSummary = `${enhancement.displayName}: ${targetName} makes ${abilityUpper} save (${resolution.total} vs DC ${resolution.dc})! ${resolution.appliedOutcome.summary}`;
        const failureSummary = `${enhancement.displayName}: ${targetName} fails ${abilityUpper} save (${resolution.total} vs DC ${resolution.dc}) and is ${resolution.conditionsApplied[0] ?? "affected"}!`;

        if (this.debugLogsEnabled) {
          console.log(`[RollStateMachine] ${enhancement.displayName}: ${targetName} ${resolution.success ? "makes" : "fails"} ${abilityUpper} save (${resolution.total} vs DC ${resolution.dc})`);
        }

        return {
          abilityId: enhancement.abilityId,
          displayName: enhancement.displayName,
          summary: resolution.success ? successSummary : failureSummary,
          saved: resolution.success,
          saveRoll: resolution.rawRoll,
          saveTotal: resolution.total,
          saveDC: resolution.dc,
          conditionApplied: resolution.conditionsApplied[0],
        };
      }

      case "apply-condition": {
        const conditionName = ctx.conditionName as string;
        const combatants = await this.deps.combatRepo.listCombatants(encounterId);
        const targetCombatant = findCombatantByEntityId(combatants, targetId);
        if (targetCombatant && !isConditionImmuneByEffects(targetCombatant.resources, conditionName)) {
          let conditions = normalizeConditions(targetCombatant.conditions);
          conditions = addCondition(conditions, createCondition(conditionName as Condition, "until_removed", {
            source: enhancement.displayName,
          }));
          await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
            conditions: conditions as any,
          });
        }

        if (this.debugLogsEnabled) {
          console.log(`[RollStateMachine] ${enhancement.displayName}: ${targetName} is ${conditionName}`);
        }

        return {
          abilityId: enhancement.abilityId,
          displayName: enhancement.displayName,
          summary: `${enhancement.displayName}: ${targetName} has disadvantage on next attack roll!`,
          conditionApplied: conditionName,
        };
      }

      default:
        return {
          abilityId: enhancement.abilityId,
          displayName: enhancement.displayName,
          summary: `${enhancement.displayName} effect triggered.`,
        };
    }
  }
}
