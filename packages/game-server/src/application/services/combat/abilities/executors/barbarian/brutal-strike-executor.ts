/**
 * Brutal Strike Executor
 *
 * Handles the Barbarian's "Brutal Strike" feature (level 9, D&D 5e 2024).
 * When using Reckless Attack and hitting, forgo the Brutal Critical die to instead
 * choose one of three effects: Forceful Blow (push + damage), Hamstring Blow (speed halved + damage),
 * or Staggering Blow (disadvantage on next attack/save + damage).
 *
 * This executor is a FREE ACTION (no action economy cost).
 * Requirements: currently raging AND used Reckless Attack this turn.
 *
 * NOTE: The +1d10 bonus damage and target condition application require a follow-up
 * mechanism. This executor validates eligibility, records the variant choice in actor
 * resources, and returns the bonus dice info for narration/logging.
 * See: .github/prompts/plan-brutal-strike-variants.prompt.md for full interactivity.
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import { BRUTAL_STRIKE } from "../../../../../../domain/entities/classes/feature-keys.js";
import { canUseBrutalStrike, getBrutalStrikeBonusDice, type BrutalStrikeOption } from "../../../../../../domain/entities/classes/barbarian.js";
import { requireActor, requireResources, requireClassFeature, extractClassInfo } from "../executor-helpers.js";
import { getActiveEffects, readBoolean } from "../../../helpers/resource-utils.js";

function resolveTargetId(params: Record<string, unknown> | undefined): string | null {
  if (!params) return null;

  if (typeof params.targetId === "string" && params.targetId.length > 0) {
    return params.targetId;
  }

  const target = params.target as { type?: string; characterId?: string; monsterId?: string; npcId?: string } | undefined;
  if (!target || typeof target !== "object") return null;
  if (target.type === "Character" && typeof target.characterId === "string") return target.characterId;
  if (target.type === "Monster" && typeof target.monsterId === "string") return target.monsterId;
  if (target.type === "NPC" && typeof target.npcId === "string") return target.npcId;
  return null;
}

export class BrutalStrikeExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return (
      normalized === "classbarbarianbrutalstrike" ||
      normalized === "brutalstrike" ||
      normalized === "hamstringblow" ||
      normalized === "forcefulblow" ||
      normalized === "staggeringblow"
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const actorErr = requireActor(params); if (actorErr) return actorErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;
    const featureErr = requireClassFeature(params, BRUTAL_STRIKE, "Brutal Strike (requires Barbarian level 9+)"); if (featureErr) return featureErr;

    const resources = params!.resources as Record<string, unknown>;

    // Check: must be currently raging
    const isRaging = readBoolean(resources, "raging") === true;
    if (!isRaging) {
      return {
        success: false,
        summary: "Brutal Strike requires active Rage",
        error: "NOT_RAGING",
      };
    }

    // Check: must have used Reckless Attack this turn
    const activeEffects = getActiveEffects(resources as any);
    const usedRecklessAttack = activeEffects.some((e) => e.source === "Reckless Attack");
    if (!canUseBrutalStrike(isRaging, usedRecklessAttack)) {
      return {
        success: false,
        summary: "Brutal Strike requires Reckless Attack to have been used this turn",
        error: "RECKLESS_ATTACK_NOT_USED",
      };
    }

    // Determine variant from abilityId or params
    let variant: BrutalStrikeOption = "hamstring-blow"; // Default per D&D 2024 rules (most common)
    const rawId = context.abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (rawId === "forcefulblow") variant = "forceful-blow";
    else if (rawId === "staggeringblow") variant = "staggering-blow";
    else if (rawId === "hamstringblow") variant = "hamstring-blow";

    if (params?.variant) {
      const v = (params.variant as string).toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (v === "forcefulblow") variant = "forceful-blow";
      else if (v === "staggeringblow") variant = "staggering-blow";
      else if (v === "hamstringblow") variant = "hamstring-blow";
    }

    // Get weapon damage dice for bonus dice calculation (from params or default)
    const weaponDamageDice = (params?.weaponDamageDice as string | undefined) ?? "1d12";
    const bonusDice = getBrutalStrikeBonusDice(weaponDamageDice);

    const targetId = resolveTargetId(params);
    if (!targetId) {
      return {
        success: false,
        summary: "Brutal Strike requires a target",
        error: "MISSING_TARGET",
      };
    }

    const variantDescriptions: Record<BrutalStrikeOption, string> = {
      "hamstring-blow": `+${bonusDice} damage, target's speed halved until start of your next turn`,
      "forceful-blow": `+${bonusDice} damage, target pushed 15 ft away`,
      "staggering-blow": `+${bonusDice} damage, target has disadvantage on next attack roll or saving throw`,
    };

    const { level } = extractClassInfo(params);

    // Record variant in actor resources for downstream processing
    const updatedResources = {
      ...(resources as Record<string, unknown>),
      brutalStrikeUsed: true,
      brutalStrikeVariant: variant,
      brutalStrikeBonusDice: bonusDice,
    };

    return {
      success: true,
      summary: `Brutal Strike (${variant})! ${variantDescriptions[variant]}. Roll ${bonusDice} for bonus damage.`,
      data: {
        abilityName: "Brutal Strike",
        variant,
        bonusDice,
        brutalStrikeVariant: variant,
        brutalStrikeBonusDice: bonusDice,
        brutalStrikeTargetId: targetId,
        updatedResources,
        level,
      },
    };
  }
}
