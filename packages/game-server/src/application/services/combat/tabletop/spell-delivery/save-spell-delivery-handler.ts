/**
 * SaveSpellDeliveryHandler — handles saving throw spells.
 * Covers: Burning Hands, Hold Person, Thunderwave, etc.
 *
 * Delegates save resolution to SavingThrowResolver which handles proficiency,
 * effect bonuses (Bless), and advantage/disadvantage on saves.
 */

import { ValidationError } from '../../../../errors.js';
import { normalizeResources, getPosition } from '../../helpers/resource-utils.js';
import { applyKoEffectsIfNeeded } from '../../helpers/ko-handler.js';
import { findCombatantByName } from '../combat-text-parser.js';
import { applyDamageDefenses, extractDamageDefenses } from '../../../../../domain/rules/damage-defenses.js';
import { getCoverLevel, getCoverSaveBonus } from '../../../../../domain/rules/combat-map.js';
import type { CombatMap } from '../../../../../domain/rules/combat-map.js';
import type { PreparedSpellDefinition } from '../../../../../domain/entities/spells/prepared-spell-definition.js';
import type { ActionParseResult } from '../tabletop-types.js';
import type { SpellCastingContext, SpellDeliveryDeps, SpellDeliveryHandler } from './spell-delivery-handler.js';

export class SaveSpellDeliveryHandler implements SpellDeliveryHandler {
  constructor(private readonly handlerDeps: SpellDeliveryDeps) {}

  canHandle(spell: PreparedSpellDefinition): boolean {
    return !!(spell.saveAbility && this.handlerDeps.deps.diceRoller);
  }

  async handle(ctx: SpellCastingContext): Promise<ActionParseResult> {
    const {
      sessionId,
      encounterId,
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
      actorCombatant,
    } = ctx;
    const { deps, eventEmitter, debugLogsEnabled, savingThrowResolver } = this.handlerDeps;

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
    const spellSaveDC = sheet?.spellSaveDC ?? 13;
    const saveAbility = spellMatch.saveAbility!;

    // Look up target's stats for damage resistance/immunity/vulnerability
    const allMonsters = await deps.monsters.listBySession(sessionId);
    const allNpcs = await deps.npcs.listBySession(sessionId);
    const targetMonster = allMonsters.find((m) => m.id === targetId);
    const targetChar = characters.find((c) => c.id === targetId);
    const targetNpc = allNpcs.find((n) => n.id === targetId);
    const targetStats =
      (targetMonster as any)?.statBlock ??
      (targetChar as any)?.sheet ??
      (targetNpc as any)?.statBlock ??
      {};

    // D&D 5e 2024: DEX saving throw cover bonus
    let coverBonus = 0;
    if (saveAbility === "dexterity") {
      const map = encounter?.mapData as unknown as CombatMap | undefined;
      if (map && map.cells && map.cells.length > 0) {
        const targetCombatant = combatants.find(
          (c: any) =>
            c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
        );
        const casterPos = actorCombatant
          ? getPosition(normalizeResources(actorCombatant.resources ?? {}))
          : null;
        const targetPos = targetCombatant
          ? getPosition(normalizeResources(targetCombatant.resources ?? {}))
          : null;
        if (casterPos && targetPos) {
          const coverLevel = getCoverLevel(map, casterPos, targetPos);
          if (coverLevel === "full") {
            // Total cover — target is unaffected. Consume action economy and return.
            await deps.actions.castSpell(sessionId, {
              encounterId,
              actor,
              spellName: castInfo.spellName,
            });
            const slotNote = spellLevel > 0 ? ` (level ${spellLevel} slot spent)` : "";
            return {
              requiresPlayerInput: false,
              actionComplete: true,
              type: "SIMPLE_ACTION_COMPLETE" as const,
              action: "CastSpell",
              message: `Cast ${castInfo.spellName} at ${targetName}.${slotNote} ${targetName} has total cover and is unaffected.`,
            };
          }
          coverBonus = getCoverSaveBonus(coverLevel);
        }
      }
    }

    // Delegate save resolution to SavingThrowResolver (handles proficiency, effect bonuses,
    // advantage/disadvantage from Bless, conditions, etc.)
    const saveAction = savingThrowResolver!.buildPendingAction({
      actorId: targetId,
      sourceId: actorId,
      ability: saveAbility,
      dc: spellSaveDC,
      reason: castInfo.spellName,
      onSuccess: { summary: "Save succeeded" },
      onFailure: {
        summary: "Save failed",
        conditions: spellMatch.conditions?.onFailure
          ? { add: spellMatch.conditions.onFailure }
          : undefined,
      },
      context: coverBonus > 0 ? { coverBonus } : undefined,
    });

    const resolution = await savingThrowResolver!.resolve(
      saveAction,
      encounter.id,
      characters,
      allMonsters as any[],
      allNpcs as any[],
    );
    const saveSuccess = resolution.success;

    if (debugLogsEnabled)
      console.log(
        `[SaveSpellDeliveryHandler] ${targetName} ${saveAbility} save: d20(${resolution.rawRoll}) + ${resolution.modifier} = ${resolution.total} vs DC ${spellSaveDC} → ${saveSuccess ? "SUCCESS" : "FAILURE"}`,
      );

    // Calculate and apply damage
    const spellDamage = spellMatch.damage;
    let damageMessage = "";
    if (spellDamage) {
      const damageRoll = deps.diceRoller!.rollDie(spellDamage.diceSides, spellDamage.diceCount);
      let totalDamage = damageRoll.total + (spellDamage.modifier ?? 0);

      // Half damage on save (D&D 5e standard for many save spells)
      const halfOnSave = spellMatch.halfDamageOnSave ?? true;
      if (saveSuccess && halfOnSave) {
        totalDamage = Math.floor(totalDamage / 2);
      } else if (saveSuccess && !halfOnSave) {
        totalDamage = 0;
      }

      if (totalDamage > 0) {
        const targetCombatant = combatants.find(
          (c: any) =>
            c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
        );
        if (targetCombatant) {
          // Apply damage resistance/immunity/vulnerability for spell damage
          const spellDmgType = spellMatch.damageType;
          if (spellDmgType && totalDamage > 0) {
            const spellDefenses = extractDamageDefenses(targetStats);
            if (
              spellDefenses.damageResistances ||
              spellDefenses.damageImmunities ||
              spellDefenses.damageVulnerabilities
            ) {
              const defResult = applyDamageDefenses(totalDamage, spellDmgType, spellDefenses);
              totalDamage = defResult.adjustedDamage;
            }
          }
          const hpBefore = targetCombatant.hpCurrent;
          const hpAfter = Math.max(0, hpBefore - totalDamage);
          await deps.combatRepo.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });

          // Apply KO effects if target dropped to 0 HP
          await applyKoEffectsIfNeeded(
            targetCombatant,
            hpBefore,
            hpAfter,
            deps.combatRepo,
          );

          await eventEmitter.emitDamageEvents(
            sessionId,
            encounter.id,
            actorId,
            targetId,
            characters,
            allMonsters as any,
            totalDamage,
            hpAfter,
          );
          damageMessage = ` ${totalDamage} ${spellMatch.damageType ?? ""} damage (HP: ${hpBefore} → ${hpAfter}).`;

          // Check victory
          if (hpAfter <= 0 && deps.victoryPolicy) {
            const allCombatants = await deps.combatRepo.listCombatants(encounter.id);
            const result = await deps.victoryPolicy.evaluate({ combatants: allCombatants });
            if (result) {
              await deps.combatRepo.updateEncounter(encounter.id, { status: result });
            }
          }
        }
      } else {
        damageMessage = " No damage (save succeeded).";
      }
    }

    // Condition message from resolver results (conditions already applied by resolver)
    const conditionMessage =
      resolution.conditionsApplied.length > 0
        ? ` ${resolution.conditionsApplied.join(", ")} applied!`
        : "";

    // Mark action spent
    await deps.actions.castSpell(sessionId, {
      encounterId,
      actor,
      spellName: castInfo.spellName,
    });

    const slotNote = spellLevel > 0 ? ` (level ${spellLevel} slot spent)` : "";
    const saveResult = saveSuccess ? "Save succeeded" : "Save failed";

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: `Cast ${castInfo.spellName} at ${targetName}.${slotNote} ${saveAbility.charAt(0).toUpperCase() + saveAbility.slice(1)} save DC ${spellSaveDC}: d20(${resolution.rawRoll})+${resolution.modifier}=${resolution.total}. ${saveResult}.${damageMessage}${conditionMessage}`,
    };
  }
}
