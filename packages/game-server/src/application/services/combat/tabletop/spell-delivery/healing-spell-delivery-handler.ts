/**
 * HealingSpellDeliveryHandler — handles healing spells.
 * Covers: Cure Wounds (action), Healing Word (bonus action), etc.
 *
 * D&D 5e 2024 healing flow:
 *  - Roll healing dice + spellcasting modifier
 *  - Clamp to target's max HP
 *  - If target was at 0 HP: remove Unconscious, reset death saves (revive)
 *  - Healing Word is a bonus action; Cure Wounds uses the regular action
 */

import { ValidationError } from '../../../../errors.js';
import { findCombatantByName } from '../combat-text-parser.js';
import { normalizeConditions, removeCondition } from '../../../../../domain/entities/combat/conditions.js';
import type { PreparedSpellDefinition } from '../../../../../domain/entities/spells/prepared-spell-definition.js';
import type { ActionParseResult } from '../tabletop-types.js';
import type { SpellCastingContext, SpellDeliveryDeps, SpellDeliveryHandler } from './spell-delivery-handler.js';

export class HealingSpellDeliveryHandler implements SpellDeliveryHandler {
  constructor(private readonly handlerDeps: SpellDeliveryDeps) {}

  canHandle(spell: PreparedSpellDefinition): boolean {
    return !!(spell.healing && this.handlerDeps.deps.diceRoller);
  }

  async handle(ctx: SpellCastingContext): Promise<ActionParseResult> {
    const {
      sessionId,
      actorId,
      castInfo,
      spellMatch,
      spellLevel,
      sheet,
      characters,
      actor,
      roster,
      encounter,
      combatants,
    } = ctx;
    const { deps, eventEmitter, debugLogsEnabled } = this.handlerDeps;

    const targetName = castInfo.targetName;
    if (!targetName) {
      throw new ValidationError(
        `${castInfo.spellName} requires a target. Usage: cast ${castInfo.spellName} on <target>`,
      );
    }

    const targetRef = findCombatantByName(targetName, roster);
    if (!targetRef) {
      throw new ValidationError(`Target "${targetName}" not found`);
    }

    const targetId =
      (targetRef as any).characterId ??
      (targetRef as any).monsterId ??
      (targetRef as any).npcId;

    // Find the target combatant
    const targetCombatant = combatants.find(
      (c: any) =>
        c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
    );
    if (!targetCombatant) throw new ValidationError(`Target combatant not found in encounter`);

    // Validate target isn't dead (3 death save failures)
    const resources = targetCombatant.resources as any;
    const deathSaves = resources?.deathSaves;
    if (deathSaves && deathSaves.failures >= 3) {
      throw new ValidationError(`${targetName} is dead and cannot be healed`);
    }

    // Roll healing dice
    const healing = spellMatch.healing!;
    const spellMod =
      healing.modifier ??
      (sheet?.spellcastingAbility
        ? Math.floor(
            ((sheet?.abilityScores?.[sheet.spellcastingAbility] ?? 10) - 10) / 2,
          )
        : 0);
    const healRoll = deps.diceRoller!.rollDie(healing.diceSides, healing.diceCount);
    const healTotal = Math.max(0, healRoll.total + spellMod);

    // Apply healing (clamp to maxHp)
    const hpBefore = targetCombatant.hpCurrent;
    const hpMax = targetCombatant.hpMax;
    const hpAfter = Math.min(hpMax, hpBefore + healTotal);
    const actualHealing = hpAfter - hpBefore;

    const updatePatch: Record<string, any> = { hpCurrent: hpAfter };

    // If healed from 0 HP → remove Unconscious, reset death saves (revive)
    let revivedFromUnconscious = false;
    if (hpBefore === 0 && hpAfter > 0) {
      revivedFromUnconscious = true;
      let conditions = normalizeConditions(targetCombatant.conditions);
      conditions = removeCondition(conditions, "Unconscious");
      updatePatch.conditions = conditions as any;

      // Reset death saves
      const targetResources = targetCombatant.resources ?? {};
      updatePatch.resources = {
        ...(targetResources as any),
        deathSaves: { successes: 0, failures: 0 },
      };
    }

    await deps.combatRepo.updateCombatantState(targetCombatant.id, updatePatch);

    // Emit healing events
    const allMonsters = await deps.monsters.listBySession(sessionId);
    await eventEmitter.emitHealingEvents(
      sessionId,
      encounter.id,
      actorId,
      targetId,
      characters,
      allMonsters as any,
      actualHealing,
      hpAfter,
    );

    // Mark action spent (bonus action for Healing Word, regular action for Cure Wounds)
    const isBonusAction = spellMatch.isBonusAction ?? false;
    await deps.actions.castSpell(sessionId, {
      encounterId: encounter.id,
      actor,
      spellName: castInfo.spellName,
      skipActionCheck: isBonusAction,
    });

    // If bonus action spell, also mark bonus action used on resources
    if (isBonusAction) {
      const actorCombatant = combatants.find(
        (c: any) =>
          c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
      );
      if (actorCombatant) {
        const actorResources = actorCombatant.resources ?? {};
        await deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: { ...(actorResources as any), bonusActionUsed: true } as any,
        });
      }
    }

    const slotNote = spellLevel > 0 ? ` (level ${spellLevel} slot spent)` : "";
    const healFormula = `${healing.diceCount}d${healing.diceSides}${
      spellMod > 0 ? `+${spellMod}` : spellMod < 0 ? `${spellMod}` : ""
    }`;
    const reviveNote = revivedFromUnconscious ? ` ${targetName} regains consciousness!` : "";
    const bonusNote = isBonusAction ? " [bonus action]" : "";

    if (debugLogsEnabled)
      console.log(
        `[HealingSpellDeliveryHandler] Healing: ${castInfo.spellName} on ${targetName}: ${healFormula} = ${healTotal} (HP: ${hpBefore} → ${hpAfter})${reviveNote}`,
      );

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: `Cast ${castInfo.spellName} on ${targetName}.${slotNote}${bonusNote} Healed ${actualHealing} HP (${healFormula} rolled ${healRoll.total}+${spellMod}=${healTotal}). HP: ${hpBefore} → ${hpAfter}.${reviveNote}`,
    };
  }
}
