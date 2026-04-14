/**
 * SpellAttackDeliveryHandler — handles projectile/melee spell attack rolls.
 * Covers: Fire Bolt, Guiding Bolt, Inflict Wounds, Eldritch Blast (multi-beam), Scorching Ray (multi-ray).
 */

import { ValidationError } from '../../../../errors.js';
import { normalizeConditions } from '../../../../../domain/entities/combat/conditions.js';
import { getCantripDamageDice, getUpcastBonusDice, getSpellAttackCount } from '../../../../../domain/entities/spells/prepared-spell-definition.js';
import { deriveRollModeFromConditions, findCombatantByName } from '../combat-text-parser.js';
import { getEntityIdFromRef } from '../../helpers/combatant-ref.js';
import type { PreparedSpellDefinition } from '../../../../../domain/entities/spells/prepared-spell-definition.js';
import type { AttackPendingAction, WeaponSpec, ActionParseResult } from '../tabletop-types.js';
import type { SpellCastingContext, SpellDeliveryDeps, SpellDeliveryHandler } from './spell-delivery-handler.js';
import { computeSpellAttackBonus } from '../../../../../domain/rules/spell-casting.js';

export class SpellAttackDeliveryHandler implements SpellDeliveryHandler {
  constructor(private readonly handlerDeps: SpellDeliveryDeps) {}

  canHandle(spell: PreparedSpellDefinition): boolean {
    return !!spell.attackType;
  }

  async handle(ctx: SpellCastingContext): Promise<ActionParseResult> {
    const { actorId, castInfo, spellMatch, spellLevel, castAtLevel, sheet, roster, encounter, actorCombatant } = ctx;

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

    const targetId = getEntityIdFromRef(targetRef);
    const spellAttackBonus = computeSpellAttackBonus(sheet);

    const spellDamage = spellMatch.damage ?? { diceCount: 1, diceSides: 10, modifier: 0 };

    // Multi-attack spells (Eldritch Blast, Scorching Ray) scale via attack count, NOT dice count.
    // Single-attack cantrips scale via getCantripDamageDice().
    const characterLevel: number = typeof sheet?.level === "number" && sheet.level >= 1 ? sheet.level : 1;
    const totalStrikes = getSpellAttackCount(spellMatch, characterLevel, castAtLevel ?? undefined);
    const isMultiAttack = totalStrikes > 1;

    let diceCount = spellDamage.diceCount;
    if (spellMatch.level === 0 && !isMultiAttack) {
      // Standard cantrip damage scaling (Fire Bolt, etc.) — NOT for multi-attack cantrips
      diceCount = getCantripDamageDice(spellDamage.diceCount, characterLevel);
    }

    // Upcast scaling: add bonus dice per slot level above base (only for non-multi-attack spells)
    if (!isMultiAttack) {
      const upcastBonus = getUpcastBonusDice(spellMatch, castAtLevel);
      if (upcastBonus) {
        diceCount += upcastBonus.bonusDiceCount;
      }
    }

    const effectiveLevel = castAtLevel ?? spellLevel;

    const damageFormula = `${diceCount}d${spellDamage.diceSides}${
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
        diceCount,
        diceSides: spellDamage.diceSides,
        modifier: spellDamage.modifier ?? 0,
      },
      damageFormula,
      damageType: spellMatch.damageType,
    };

    const actorConditions = normalizeConditions(actorCombatant?.conditions as unknown[]);
    const inferredKind =
      spellMatch.attackType === "melee_spell" ? ("melee" as const) : ("ranged" as const);
    const rollMode = deriveRollModeFromConditions(actorConditions, [], inferredKind);

    // Collect on-hit spell effects to apply to target after damage (e.g. Guiding Bolt)
    const onHitEffects = (spellMatch.effects ?? []).filter(e => e.appliesTo === 'target');

    const pendingAction: AttackPendingAction = {
      type: "ATTACK",
      timestamp: new Date(),
      actorId,
      attacker: actorId,
      target: targetId,
      targetId,
      weaponSpec: spellWeaponSpec,
      rollMode,
      ...(isMultiAttack ? { spellStrike: 1, spellStrikeTotal: totalStrikes } : {}),
      // Carry on-hit spell effects (e.g. Guiding Bolt advantage on next attack)
      ...(onHitEffects.length > 0 ? { spellOnHitEffects: onHitEffects } : {}),
    };

    await this.handlerDeps.deps.combatRepo.setPendingAction(encounter.id, pendingAction);

    const slotNote = effectiveLevel > 0 ? ` (level ${effectiveLevel} slot spent)` : "";
    const rollModeNote = rollMode !== "normal" ? ` (${rollMode})` : "";
    const strikeNote = isMultiAttack ? ` (beam 1 of ${totalStrikes})` : "";

    return {
      requiresPlayerInput: true,
      actionComplete: false,
      type: "REQUEST_ROLL",
      rollType: "attack",
      diceNeeded: rollMode !== "normal" ? "2d20" : "d20",
      advantage: rollMode === "advantage",
      disadvantage: rollMode === "disadvantage",
      message: `Casting ${castInfo.spellName} at ${targetName}${slotNote}${rollModeNote}${strikeNote}. Roll a d20 for spell attack.`,
    };
  }
}
