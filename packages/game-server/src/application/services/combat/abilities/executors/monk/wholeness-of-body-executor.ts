import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { WHOLENESS_OF_BODY } from "../../../../../../domain/entities/classes/feature-keys.js";
import { hasResourceAvailable } from "../../../helpers/resource-utils.js";
import { rollMartialArtsDie } from "../../../../../../domain/rules/martial-arts-die.js";
import { SeededDiceRoller } from "../../../../../../domain/rules/dice-roller.js";
import { requireActor, requireClassFeature, extractClassInfo } from "../executor-helpers.js";

/**
 * Wholeness of Body (Monk Level 6 - Open Hand Subclass)
 * 
 * As a Bonus Action, roll your Martial Arts die and regain HP equal to
 * the roll + Wisdom modifier (minimum 1).
 * 
 * Uses per long rest: Wisdom modifier (minimum 1)
 */
export class WholenessOfBodyExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (
      normalized === 'wholenessofbody' ||
      normalized === 'classmonkwholenessofbody'
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { actor, params } = context;

    const actorErr = requireActor(params); if (actorErr) return actorErr;
    const featureErr = requireClassFeature(params, WHOLENESS_OF_BODY, "Wholeness of Body (requires Monk level 6+)"); if (featureErr) return featureErr;

    const actorRef = params!.actor;
    const { level } = extractClassInfo(params);

    // Validate Open Hand subclass (type-agnostic: works for Characters, NPCs, and Monsters)
    const sheet = params?.sheet as Record<string, unknown> | undefined;
    const subclass = (sheet?.subclass as string)
      || (typeof (actorRef as any).getSubclass === "function" ? (actorRef as any).getSubclass() : undefined)
      || (params?.subclass as string | undefined);
    if (subclass && subclass !== "Open Hand") {
      return {
        success: false,
        summary: "Wholeness of Body requires Open Hand subclass",
        error: "INVALID_SUBCLASS",
      };
    }

    // Validate resources - passed via params.resources
    const resources = params?.resources;
    if (!resources) {
      return {
        success: false,
        summary: 'No resources provided for validation',
        error: 'MISSING_RESOURCES',
      };
    }

    // Check if uses remaining (Wisdom modifier times per long rest)
    const wholenessPool = (resources as any)?.resourcePools?.find((p: any) => p.name === 'wholeness_of_body');
    
    if (wholenessPool && wholenessPool.current <= 0) {
      return {
        success: false,
        summary: 'No uses of Wholeness of Body remaining',
        error: 'NO_USES_REMAINING',
      };
    }

    // Roll Martial Arts die (scales with monk level)
    const monkLevel = (params?.level as number) || (actorRef as any).level || 6;
    const dice = new SeededDiceRoller(Date.now());
    const martialArtsDieRoll = rollMartialArtsDie(dice, monkLevel);
    
    // Get Wisdom modifier from sheet (tabletop) or actorRef (AI)
    const wisdomScore = (sheet as any)?.abilityScores?.wisdom ?? (actorRef as any).abilityScores?.wisdom ?? 10;
    const wisdomModifier = Math.floor((wisdomScore - 10) / 2);
    const healAmount = Math.max(1, martialArtsDieRoll + wisdomModifier);

    // Calculate HP gain (bounded by maxHP)
    const currentHP = actor.getCurrentHP();
    const maxHP = actor.getMaxHP();
    const actualHealing = Math.min(healAmount, maxHP - currentHP);
    
    // Apply healing via Creature.modifyHP()
    const healResult = actor.modifyHP(actualHealing);
    const newHP = currentHP + (healResult.actualChange ?? actualHealing);
    
    return {
      success: true,
      summary: `${actor.getName()} uses Wholeness of Body and regains ${healResult.actualChange ?? actualHealing} HP!`,
      data: {
        abilityName: 'Wholeness of Body',
        healAmount: healResult.actualChange ?? actualHealing,
        totalRoll: healAmount,
        currentHP: newHP,
        maxHP,
        hpUpdate: { hpCurrent: newHP },
        spendResource: { poolName: 'wholeness_of_body', amount: 1 },
      },
    };
  }
}
