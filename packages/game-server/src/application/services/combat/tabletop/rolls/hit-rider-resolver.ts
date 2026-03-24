/**
 * HitRiderResolver — resolves post-damage effects from hit-rider enhancements.
 *
 * Handles saving throws (via SavingThrowResolver), condition application, etc.
 * This is the core of the generic hit-rider pipeline — any ability that triggers
 * effects after damage (Stunning Strike, Open Hand Technique, etc.) routes through here.
 *
 * Extracted from RollStateMachine (Phase: God-Module Decomposition §2.1).
 */

import {
  normalizeResources,
  updateResourcePool,
  isConditionImmuneByEffects,
} from "../../helpers/resource-utils.js";
import {
  normalizeConditions,
  addCondition,
  createCondition,
  type Condition,
} from "../../../../../domain/entities/combat/conditions.js";
import type { SavingThrowResolver } from "./saving-throw-resolver.js";
import type {
  HitRiderEnhancement,
  HitRiderEnhancementResult,
  SaveOutcome,
  TabletopCombatServiceDeps,
} from "../tabletop-types.js";

export class HitRiderResolver {
  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly savingThrowResolver: SavingThrowResolver | null,
    private readonly debugLogsEnabled: boolean,
  ) {}

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
        const targetCombatant = combatants.find(
          (c: any) => c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
        );
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
