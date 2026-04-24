/**
 * DispelMagicDeliveryHandler — D&D 5e 2024 Dispel Magic.
 *
 * RAW 2024:
 *  - Choose a target creature/object/effect within 120 ft.
 *  - Any spell of level ≤ counterspell slot level on the target ends automatically.
 *  - For each spell of level > slot level on the target: dispeller makes an ability check
 *    (d20 + spellcasting ability + PB) vs DC 10 + spell level. Success ends the spell.
 *
 * Current scope:
 *  - Breaks the TARGET's concentration spell if present (primary Dispel use case).
 *  - Compares slot level vs target concentration spell's level (looked up in catalog).
 *  - Auto-dispels if slot ≥ spell level, else rolls ability check.
 *  - Individual non-concentration active effects are not yet traversed (future work).
 */

import { findCombatantByName } from '../combat-text-parser.js';
import { findCombatantStateByRef } from '../../helpers/combatant-ref.js';
import { getCanonicalSpell } from '../../../../../domain/entities/spells/catalog/index.js';
import { breakConcentration, getConcentrationSpellName } from '../../helpers/concentration-helper.js';
import { getSpellcastingModifier } from '../../../../../domain/rules/spell-casting.js';
import type { PreparedSpellDefinition } from '../../../../../domain/entities/spells/prepared-spell-definition.js';
import type { ActionParseResult } from '../tabletop-types.js';
import type { SpellCastingContext, SpellDeliveryDeps, SpellDeliveryHandler } from './spell-delivery-handler.js';

export class DispelMagicDeliveryHandler implements SpellDeliveryHandler {
  constructor(private readonly handlerDeps: SpellDeliveryDeps) {}

  canHandle(spell: PreparedSpellDefinition): boolean {
    return spell.name.toLowerCase() === 'dispel magic';
  }

  async handle(ctx: SpellCastingContext): Promise<ActionParseResult> {
    const {
      sessionId,
      encounterId,
      castInfo,
      spellLevel,
      castAtLevel,
      sheet,
      combatants,
      actor,
      roster,
    } = ctx;
    const { deps, debugLogsEnabled } = this.handlerDeps;

    const slotLevel = castAtLevel ?? spellLevel;

    // Resolve target by name. Must be a creature currently concentrating.
    const targetName = castInfo.targetName;
    if (!targetName) {
      await deps.actions.castSpell(sessionId, { encounterId, actor, spellName: castInfo.spellName });
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "SIMPLE_ACTION_COMPLETE",
        action: "CastSpell",
        message: "Dispel Magic requires a target.",
      };
    }

    const targetRef = findCombatantByName(targetName, roster);
    const targetState = targetRef ? findCombatantStateByRef(combatants, targetRef) : undefined;
    if (!targetState) {
      await deps.actions.castSpell(sessionId, { encounterId, actor, spellName: castInfo.spellName });
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "SIMPLE_ACTION_COMPLETE",
        action: "CastSpell",
        message: `Dispel Magic: target '${targetName}' not found.`,
      };
    }

    const targetConcSpell = getConcentrationSpellName(targetState.resources);
    if (!targetConcSpell) {
      // Spell is still cast (slot consumed elsewhere), but there's nothing to dispel.
      await deps.actions.castSpell(sessionId, { encounterId, actor, spellName: castInfo.spellName });
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "SIMPLE_ACTION_COMPLETE",
        action: "CastSpell",
        message: `Dispel Magic: ${targetName} has no active concentration spell.`,
      };
    }

    // Look up the concentration spell's level in the catalog to decide auto-dispel vs check.
    const concSpellDef = getCanonicalSpell(targetConcSpell);
    const concSpellLevel = concSpellDef?.level ?? 0;

    let dispelled: boolean;
    let checkDetail: string | undefined;

    if (concSpellLevel <= slotLevel) {
      // Auto-dispel
      dispelled = true;
    } else {
      // Ability check: d20 + spellcasting mod + PB vs DC 10 + spell level
      const dc = 10 + concSpellLevel;
      if (deps.diceRoller) {
        const roll = deps.diceRoller.rollDie(20);
        const spellcastingMod = getSpellcastingModifier(sheet);
        const profBonus = typeof sheet?.proficiencyBonus === 'number' ? sheet.proficiencyBonus : 2;
        const total = roll.total + spellcastingMod + profBonus;
        dispelled = total >= dc;
        checkDetail = `d20(${roll.total}) + ${spellcastingMod + profBonus} = ${total} vs DC ${dc} → ${dispelled ? 'success' : 'fail'}`;
      } else {
        // Without a dice roller, conservatively fail the check.
        dispelled = false;
        checkDetail = 'no dice roller available — check defaulted to fail';
      }
    }

    if (dispelled) {
      await breakConcentration(targetState, encounterId, deps.combatRepo, debugLogsEnabled ? console.log : undefined);
    }

    // Spend the caster's slot (breakConcentration on the target doesn't do this).
    await deps.actions.castSpell(sessionId, { encounterId, actor, spellName: castInfo.spellName });

    const msg = dispelled
      ? `Dispel Magic: ended ${targetConcSpell} on ${targetName}${checkDetail ? ` (${checkDetail})` : ''}.`
      : `Dispel Magic failed to end ${targetConcSpell} on ${targetName}${checkDetail ? ` (${checkDetail})` : ''}.`;

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: msg,
    };
  }
}
