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
import { getUpcastBonusDice } from '../../../../../domain/entities/spells/prepared-spell-definition.js';
import type { ActionParseResult } from '../tabletop-types.js';
import type { SpellCastingContext, SpellDeliveryDeps, SpellDeliveryHandler } from './spell-delivery-handler.js';
import { getSpellcastingModifier } from '../../../../../domain/rules/spell-casting.js';
import { hasPreventHealingEffect } from '../../helpers/resource-utils.js';

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
      castAtLevel,
      sheet,
      characters,
      actor,
      roster,
      encounter,
      combatants,
    } = ctx;
    const { deps, eventEmitter, debugLogsEnabled } = this.handlerDeps;

    // AoE healing (Mass Cure Wounds, Prayer of Healing, etc.)
    if (spellMatch.area && !castInfo.targetName) {
      return this.handleAoE(ctx);
    }

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

    // Check for prevent_healing effect (e.g., Chill Touch)
    if (hasPreventHealingEffect(targetCombatant.resources ?? {})) {
      // Still spend the action/slot
      const isBonusAction = spellMatch.isBonusAction ?? false;
      await deps.actions.castSpell(sessionId, {
        encounterId: encounter.id,
        actor,
        spellName: castInfo.spellName,
        skipActionCheck: isBonusAction,
      });
      const effectiveLevel = castAtLevel ?? spellLevel;
      const slotNote = effectiveLevel > 0 ? ` (level ${effectiveLevel} slot spent)` : "";
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "SIMPLE_ACTION_COMPLETE",
        action: "CastSpell",
        message: `Cast ${castInfo.spellName} on ${targetName}.${slotNote} Healing has no effect — target is affected by Chill Touch.`,
      };
    }

    // Roll healing dice
    const healing = spellMatch.healing!;
    const spellMod = healing.modifier ?? getSpellcastingModifier(sheet);

    // Upcast scaling: add bonus dice per slot level above base
    let healDiceCount = healing.diceCount;
    const upcastBonus = getUpcastBonusDice(spellMatch, castAtLevel);
    if (upcastBonus) {
      healDiceCount += upcastBonus.bonusDiceCount;
    }

    const healRoll = deps.diceRoller!.rollDie(healing.diceSides, healDiceCount);
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

    const effectiveLevel = castAtLevel ?? spellLevel;
    const slotNote = effectiveLevel > 0 ? ` (level ${effectiveLevel} slot spent)` : "";
    const healFormula = `${healDiceCount}d${healing.diceSides}${
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

  /**
   * AoE healing path — Mass Cure Wounds, Prayer of Healing, Mass Healing Word, etc.
   * Rolls healing once and applies to all friendly combatants (D&D 5e 2024).
   * Caps at 6 targets (standard for mass healing spells).
   */
  private async handleAoE(ctx: SpellCastingContext): Promise<ActionParseResult> {
    const {
      sessionId,
      actorId,
      castInfo,
      spellMatch,
      spellLevel,
      castAtLevel,
      sheet,
      characters,
      actor,
      roster,
      encounter,
      combatants,
    } = ctx;
    const { deps, eventEmitter, debugLogsEnabled } = this.handlerDeps;

    const healing = spellMatch.healing!;
    const spellMod = healing.modifier ?? getSpellcastingModifier(sheet);

    // Upcast scaling
    let healDiceCount = healing.diceCount;
    const upcastBonus = getUpcastBonusDice(spellMatch, castAtLevel);
    if (upcastBonus) {
      healDiceCount += upcastBonus.bonusDiceCount;
    }

    // Roll once — all targets receive the same healing (D&D 5e mass healing spells)
    const healRoll = deps.diceRoller!.rollDie(healing.diceSides, healDiceCount);
    const healTotal = Math.max(0, healRoll.total + spellMod);

    // Determine caster faction to find friendly combatants
    const actorCombatant = combatants.find(
      (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
    );
    const actorIsPC =
      actorCombatant?.combatantType === "Character" || actorCombatant?.combatantType === "NPC";

    // Collect eligible friendly targets: same faction, alive (not 3 death save failures), not at max HP
    const MAX_TARGETS = 6;
    const eligibleTargets = combatants
      .filter((c: any) => {
        const isPC = c.combatantType === "Character" || c.combatantType === "NPC";
        if (isPC !== actorIsPC) return false;
        // Skip dead combatants (3 death save failures)
        const deathSaves = (c.resources as any)?.deathSaves;
        if (deathSaves && deathSaves.failures >= 3) return false;
        // Skip combatants already at full HP (no benefit)
        if (c.hpCurrent >= c.hpMax) return false;
        // Skip combatants with prevent_healing effect (e.g., Chill Touch)
        if (hasPreventHealingEffect(c.resources ?? {})) return false;
        return true;
      })
      .slice(0, MAX_TARGETS);

    if (eligibleTargets.length === 0) {
      // Still spend the action/slot even if no one benefits
      const isBonusAction = spellMatch.isBonusAction ?? false;
      await deps.actions.castSpell(sessionId, {
        encounterId: encounter.id,
        actor,
        spellName: castInfo.spellName,
        skipActionCheck: isBonusAction,
      });

      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "SIMPLE_ACTION_COMPLETE",
        action: "CastSpell",
        message: `Cast ${castInfo.spellName}. No allies needed healing.`,
      };
    }

    // Apply healing to each eligible target
    const allMonsters = await deps.monsters.listBySession(sessionId);
    const healingSummaries: string[] = [];

    for (const target of eligibleTargets) {
      const targetId = target.characterId ?? target.monsterId ?? target.npcId;
      const hpBefore = target.hpCurrent;
      const hpAfter = Math.min(target.hpMax, hpBefore + healTotal);
      const actualHealing = hpAfter - hpBefore;

      const updatePatch: Record<string, any> = { hpCurrent: hpAfter };

      // Revive from 0 HP
      let revived = false;
      if (hpBefore === 0 && hpAfter > 0) {
        revived = true;
        let conditions = normalizeConditions(target.conditions);
        conditions = removeCondition(conditions, "Unconscious");
        updatePatch.conditions = conditions as any;
        updatePatch.resources = {
          ...(target.resources as any),
          deathSaves: { successes: 0, failures: 0 },
        };
      }

      await deps.combatRepo.updateCombatantState(target.id, updatePatch);

      // Emit healing event for this target
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

      // Build summary entry — resolve name from roster
      const targetName =
        roster.characters.find((c) => c.id === targetId)?.name ??
        roster.monsters.find((m) => m.id === targetId)?.name ??
        roster.npcs.find((n) => n.id === targetId)?.name ??
        "Unknown";

      const reviveNote = revived ? " (revived!)" : "";
      healingSummaries.push(`${targetName} ${actualHealing} HP${reviveNote}`);
    }

    // Mark action spent
    const isBonusAction = spellMatch.isBonusAction ?? false;
    await deps.actions.castSpell(sessionId, {
      encounterId: encounter.id,
      actor,
      spellName: castInfo.spellName,
      skipActionCheck: isBonusAction,
    });

    if (isBonusAction && actorCombatant) {
      const actorResources = actorCombatant.resources ?? {};
      await deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: { ...(actorResources as any), bonusActionUsed: true } as any,
      });
    }

    const effectiveLevel = castAtLevel ?? spellLevel;
    const slotNote = effectiveLevel > 0 ? ` (level ${effectiveLevel} slot spent)` : "";
    const healFormula = `${healDiceCount}d${healing.diceSides}${
      spellMod > 0 ? `+${spellMod}` : spellMod < 0 ? `${spellMod}` : ""
    }`;
    const bonusNote = isBonusAction ? " [bonus action]" : "";

    if (debugLogsEnabled)
      console.log(
        `[HealingSpellDeliveryHandler] AoE Healing: ${castInfo.spellName}: ${healFormula} = ${healTotal} to ${eligibleTargets.length} targets`,
      );

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: `Cast ${castInfo.spellName}.${slotNote}${bonusNote} Healed ${eligibleTargets.length} target(s) for ${healTotal} HP each (${healFormula} rolled ${healRoll.total}+${spellMod}=${healTotal}): ${healingSummaries.join(", ")}.`,
    };
  }
}
