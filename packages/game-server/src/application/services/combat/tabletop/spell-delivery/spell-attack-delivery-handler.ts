/**
 * SpellAttackDeliveryHandler — handles projectile/melee spell attack rolls.
 * Covers: Fire Bolt, Guiding Bolt, Inflict Wounds, etc.
 */

import { ValidationError } from '../../../../errors.js';
import { readConditionNames } from '../../../../../domain/entities/combat/conditions.js';
import { deriveRollModeFromConditions, findCombatantByName } from '../combat-text-parser.js';
import type { PreparedSpellDefinition } from '../../../../../domain/entities/spells/prepared-spell-definition.js';
import type { AttackPendingAction, WeaponSpec, ActionParseResult } from '../tabletop-types.js';
import type { SpellCastingContext, SpellDeliveryDeps, SpellDeliveryHandler } from './spell-delivery-handler.js';

export class SpellAttackDeliveryHandler implements SpellDeliveryHandler {
  constructor(private readonly handlerDeps: SpellDeliveryDeps) {}

  canHandle(spell: PreparedSpellDefinition): boolean {
    return !!spell.attackType;
  }

  async handle(ctx: SpellCastingContext): Promise<ActionParseResult> {
    const { actorId, castInfo, spellMatch, spellLevel, sheet, roster, encounter, actorCombatant } = ctx;

    const targetName = castInfo.targetName;
    if (!targetName) {
      throw new ValidationError(
        `${castInfo.spellName} requires a target. Usage: cast ${castInfo.spellName} at <target>`,
      );
    }

    const targetRef = findCombatantByName(targetName, roster);
    if (!targetRef) {
      throw new ValidationError(`Target "${targetName}" not found`);
    }

    const targetId =
      (targetRef as any).characterId ?? (targetRef as any).monsterId ?? (targetRef as any).npcId;
    const spellAttackBonus = sheet?.spellAttackBonus ?? 5;

    const spellDamage = spellMatch.damage ?? { diceCount: 1, diceSides: 10, modifier: 0 };
    const damageFormula = `${spellDamage.diceCount}d${spellDamage.diceSides}${
      (spellDamage.modifier ?? 0) > 0
        ? `+${spellDamage.modifier}`
        : (spellDamage.modifier ?? 0) < 0
          ? `${spellDamage.modifier}`
          : ""
    }`;

    const spellWeaponSpec: WeaponSpec = {
      name: castInfo.spellName,
      kind: spellMatch.attackType === "melee_spell" ? "melee" : "ranged",
      attackBonus: spellAttackBonus,
      damage: {
        diceCount: spellDamage.diceCount,
        diceSides: spellDamage.diceSides,
        modifier: spellDamage.modifier ?? 0,
      },
      damageFormula,
      damageType: spellMatch.damageType,
    };

    const actorConditions: string[] = readConditionNames(actorCombatant?.conditions);
    const inferredKind =
      spellMatch.attackType === "melee_spell" ? ("melee" as const) : ("ranged" as const);
    const rollMode = deriveRollModeFromConditions(actorConditions, [], inferredKind);

    const pendingAction: AttackPendingAction = {
      type: "ATTACK",
      timestamp: new Date(),
      actorId,
      attacker: actorId,
      target: targetId,
      targetId,
      weaponSpec: spellWeaponSpec,
      rollMode,
    };

    await this.handlerDeps.deps.combatRepo.setPendingAction(encounter.id, pendingAction);

    const slotNote = spellLevel > 0 ? ` (level ${spellLevel} slot spent)` : "";
    const rollModeNote = rollMode !== "normal" ? ` (${rollMode})` : "";

    return {
      requiresPlayerInput: true,
      actionComplete: false,
      type: "REQUEST_ROLL",
      rollType: "attack",
      diceNeeded: "d20",
      advantage: rollMode === "advantage",
      disadvantage: rollMode === "disadvantage",
      message: `Casting ${castInfo.spellName} at ${targetName}${slotNote}${rollModeNote}. Roll a d20 for spell attack.`,
    };
  }
}
