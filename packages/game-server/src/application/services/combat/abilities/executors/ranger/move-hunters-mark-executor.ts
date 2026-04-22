/**
 * Move Hunter's Mark Executor
 *
 * Shifts the Ranger's Hunter's Mark concentration effect from its current
 * target to a new target as a bonus action.
 *
 * D&D 5e 2024 rule: when the original target drops to 0 HP, on a subsequent
 * turn the ranger may use a bonus action to move the mark to a new creature.
 * This executor updates the existing Hunter's Mark ActiveEffect's
 * targetCombatantId rather than re-casting the spell (no slot spent).
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import {
  hasBonusActionAvailable,
  useBonusAction,
  getActiveEffects,
  setActiveEffects,
} from "../../../helpers/resource-utils.js";
import { requireResources } from "../executor-helpers.js";

export class MoveHuntersMarkExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classrangermovehuntersmark" || normalized === "movehuntersmark";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;
    const targetId =
      (typeof params?.targetEntityId === "string" && params.targetEntityId) ||
      (typeof params?.targetId === "string" && params.targetId) ||
      undefined;
    const targetName = typeof params?.targetName === "string" ? params.targetName : "the new target";

    if (!targetId) {
      return {
        success: false,
        summary: "No target specified for Hunter's Mark transfer.",
        error: "NO_TARGET",
      };
    }

    if (!hasBonusActionAvailable(resources)) {
      return {
        success: false,
        summary: "No bonus action available (moving Hunter's Mark requires a bonus action).",
        error: "NO_BONUS_ACTION",
      };
    }

    const effects = getActiveEffects(resources as any);
    const markIndex = effects.findIndex(
      e => typeof e.source === "string" && e.source.toLowerCase().includes("hunter's mark"),
    );
    if (markIndex === -1) {
      return {
        success: false,
        summary: "Hunter's Mark is not currently active — cast it first.",
        error: "NOT_ACTIVE",
      };
    }

    const updatedEffects = effects.map((e, i) =>
      i === markIndex ? { ...e, targetCombatantId: targetId } : e,
    );
    let updatedResources = setActiveEffects(resources as any, updatedEffects);
    updatedResources = useBonusAction(updatedResources);

    return {
      success: true,
      summary: `Moves Hunter's Mark to ${targetName}.`,
      data: {
        abilityName: "Move Hunter's Mark",
        targetName,
        updatedResources,
      },
    };
  }
}
