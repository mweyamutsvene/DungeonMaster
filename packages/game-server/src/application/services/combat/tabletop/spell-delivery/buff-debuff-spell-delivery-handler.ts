/**
 * BuffDebuffSpellDeliveryHandler — handles buff/debuff spells with declared ActiveEffect instances.
 * Covers: Bless, Shield of Faith, Faerie Fire, Hold Person (as condition effect), etc.
 *
 * Resolves targets based on `appliesTo`, creates effects, and applies them to combatants.
 */

import { findCombatantByName } from '../combat-text-parser.js';
import { createEffect } from '../../../../../domain/entities/combat/effects.js';
import { addActiveEffectsToResources, normalizeResources, patchResources } from '../../helpers/resource-utils.js';
import { findCombatantByEntityId } from '../../helpers/combatant-lookup.js';
import { getEntityIdFromRef } from '../../helpers/combatant-ref.js';
import { getSpellcastingModifier, computeSpellSaveDC } from '../../../../../domain/rules/spell-casting.js';
import { nanoid } from 'nanoid';
import type { Ability } from '../../../../../domain/entities/core/ability-scores.js';
import type { PreparedSpellDefinition } from '../../../../../domain/entities/spells/prepared-spell-definition.js';
import type { ActionParseResult } from '../tabletop-types.js';
import type { JsonValue } from '../../../../types.js';
import type { SpellCastingContext, SpellDeliveryDeps, SpellDeliveryHandler } from './spell-delivery-handler.js';

export class BuffDebuffSpellDeliveryHandler implements SpellDeliveryHandler {
  constructor(private readonly handlerDeps: SpellDeliveryDeps) {}

  canHandle(spell: PreparedSpellDefinition): boolean {
    return !!(spell.effects && spell.effects.length > 0);
  }

  async handle(ctx: SpellCastingContext): Promise<ActionParseResult> {
    const {
      sessionId,
      encounterId,
      actorId,
      castInfo,
      spellMatch,
      isConcentration,
      isBonusAction,
      sheet,
      actor,
      roster,
      encounter,
      combatants,
      actorCombatant,
      characters,
    } = ctx;
    const { deps, debugLogsEnabled, savingThrowResolver } = this.handlerDeps;

    const effectDeclarations = spellMatch.effects ?? [];
    const appliedTo: string[] = [];
    const saveMessages: string[] = [];

    // Guard: canHandle() ensures effects.length > 0, but warn defensively if somehow bypassed.
    if (effectDeclarations.length === 0) {
      console.warn(
        `[WARN] Spell '${castInfo.spellName}' has no effects defined — no mechanical changes applied. Check the spell catalog definition.`,
      );
      await deps.actions.castSpell(sessionId, { encounterId, actor, spellName: castInfo.spellName, skipActionCheck: isBonusAction });
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "SIMPLE_ACTION_COMPLETE",
        action: "CastSpell",
        message: `[WARN] Spell '${castInfo.spellName}' has no effects defined — no mechanical changes applied. Check the spell catalog definition.`,
      };
    }

    // Bane-style save-on-cast: spell has `saveAbility` but no `damage` or `conditions.onFailure`.
    // SaveSpellDeliveryHandler defers these to us. We roll a save per target; effects apply only on failure.
    const requiresSaveOnCast =
      !!spellMatch.saveAbility &&
      !spellMatch.damage &&
      !spellMatch.conditions?.onFailure?.length;
    const spellSaveDC = requiresSaveOnCast ? computeSpellSaveDC(sheet) : 0;
    const saveFailedByCombatantId = new Map<string, boolean>();
    let allMonstersCache: Awaited<ReturnType<typeof deps.monsters.listBySession>> | null = null;
    let allNpcsCache: Awaited<ReturnType<typeof deps.npcs.listBySession>> | null = null;

    const resolveSaveForTarget = async (targetCombatantId: string): Promise<boolean> => {
      // Returns `true` if the save FAILED (effect should apply).
      if (saveFailedByCombatantId.has(targetCombatantId)) {
        return saveFailedByCombatantId.get(targetCombatantId)!;
      }
      if (!savingThrowResolver || !requiresSaveOnCast) {
        saveFailedByCombatantId.set(targetCombatantId, true);
        return true;
      }
      const targetC = combatants.find((c) => c.id === targetCombatantId);
      const targetEntityId = targetC?.characterId ?? targetC?.monsterId ?? targetC?.npcId ?? targetCombatantId;
      if (allMonstersCache === null) allMonstersCache = await deps.monsters.listBySession(sessionId);
      if (allNpcsCache === null) allNpcsCache = await deps.npcs.listBySession(sessionId);
      const saveAction = savingThrowResolver.buildPendingAction({
        actorId: targetEntityId,
        sourceId: actorId,
        ability: spellMatch.saveAbility! as Ability,
        dc: spellSaveDC,
        reason: castInfo.spellName,
        onSuccess: { summary: 'Save succeeded' },
        onFailure: { summary: 'Save failed' },
      });
      const resolution = await savingThrowResolver.resolve(
        saveAction,
        encounter.id,
        characters,
        allMonstersCache!,
        allNpcsCache!,
      );
      const failed = !resolution.success;
      saveFailedByCombatantId.set(targetCombatantId, failed);
      saveMessages.push(
        `${targetEntityId}: ${spellMatch.saveAbility} save d20(${resolution.rawRoll})+${resolution.modifier}=${resolution.total} vs DC ${spellSaveDC} → ${failed ? 'FAIL' : 'SUCCESS'}`,
      );
      if (debugLogsEnabled) {
        console.log(
          `[BuffDebuffSpellDeliveryHandler] ${castInfo.spellName} ${spellMatch.saveAbility} save for ${targetEntityId}: ${resolution.total} vs DC ${spellSaveDC} → ${failed ? 'FAIL' : 'SUCCESS'}`,
        );
      }
      return failed;
    };

    for (const effDef of effectDeclarations) {
      // Resolve target combatants
      const targetCombatantIds: string[] = [];
      const appliesTo = effDef.appliesTo ?? "target";

      if (appliesTo === "self") {
        if (actorCombatant) targetCombatantIds.push(actorCombatant.id);
      } else if (appliesTo === "target") {
        if (castInfo.targetName) {
          const targetRef = findCombatantByName(castInfo.targetName, roster);
          if (targetRef) {
            const tid = getEntityIdFromRef(targetRef);
            const targetC = findCombatantByEntityId(combatants, tid);
            if (targetC) targetCombatantIds.push(targetC.id);
          }
        }
      } else if (appliesTo === "allies") {
        // Same faction as caster
        const actorIsPC =
          actorCombatant?.combatantType === "Character" ||
          actorCombatant?.combatantType === "NPC";
        for (const c of combatants) {
          if (c.hpCurrent <= 0) continue;
          const isPC = c.combatantType === "Character" || c.combatantType === "NPC";
          if (isPC === actorIsPC) targetCombatantIds.push(c.id);
        }
      } else if (appliesTo === "enemies") {
        const actorIsPC =
          actorCombatant?.combatantType === "Character" ||
          actorCombatant?.combatantType === "NPC";
        for (const c of combatants) {
          if (c.hpCurrent <= 0) continue;
          const isPC = c.combatantType === "Character" || c.combatantType === "NPC";
          if (isPC !== actorIsPC) targetCombatantIds.push(c.id);
        }
      }

      // Create ActiveEffect for each target
      for (const targetCId of targetCombatantIds) {
        const entityId = (() => {
          const c = combatants.find(x => x.id === targetCId);
          return c?.characterId ?? c?.monsterId ?? c?.npcId ?? targetCId;
        })();

        // Bane-style save-on-cast: skip effect application on successful save.
        // Caster-side damage riders (Hex/Hunter's Mark) are NOT subject to save-on-cast
        // since the effect is applied to the caster; keep that branch untouched.
        const isCasterDamageRiderForSaveCheck =
          appliesTo === 'target' &&
          (effDef.target === 'damage_rolls' || effDef.target === 'melee_damage_rolls' || effDef.target === 'ranged_damage_rolls') &&
          (effDef.type === 'bonus' || effDef.type === 'penalty');
        if (requiresSaveOnCast && !isCasterDamageRiderForSaveCheck) {
          const failed = await resolveSaveForTarget(targetCId);
          if (!failed) continue;
        }

        // Detect caster-side damage riders (Hex, Hunter's Mark):
        // These spells target an enemy but the extra damage is dealt BY the caster.
        // Route the effect to the caster's resources with targetCombatantId pointing
        // to the victim so damage resolvers can scope the bonus per-target.
        const isCasterDamageRider =
          appliesTo === 'target' &&
          (effDef.target === 'damage_rolls' || effDef.target === 'melee_damage_rolls' || effDef.target === 'ranged_damage_rolls') &&
          (effDef.type === 'bonus' || effDef.type === 'penalty');

        // Resolve dynamic value sources (e.g., Heroism's temp HP = caster's spellcasting modifier)
        let resolvedValue = effDef.value;
        if (effDef.valueSource === 'spellcastingModifier') {
          resolvedValue = Math.max(1, getSpellcastingModifier(sheet));
        }

        // Resolve DC=0 placeholders on triggerSave / saveToEnd to the caster's spell save DC.
        // Smite spells (Searing/Thunderous/Wrathful) and Ensnaring Strike declare DC=0 in the
        // catalog; the real DC comes from the caster's sheet at cast time.
        const casterSpellSaveDC = computeSpellSaveDC(sheet);
        const resolvedTriggerSave = effDef.triggerSave
          ? {
              ability: effDef.triggerSave.ability as Ability,
              dc: effDef.triggerSave.dc && effDef.triggerSave.dc > 0 ? effDef.triggerSave.dc : casterSpellSaveDC,
              halfDamageOnSave: effDef.triggerSave.halfDamageOnSave,
            }
          : undefined;
        const resolvedSaveToEnd = effDef.saveToEnd
          ? {
              ability: effDef.saveToEnd.ability as Ability,
              dc: effDef.saveToEnd.dc && effDef.saveToEnd.dc > 0 ? effDef.saveToEnd.dc : casterSpellSaveDC,
            }
          : undefined;

        const effect = createEffect(
          nanoid(),
          effDef.type,
          effDef.target,
          isConcentration ? "concentration" : effDef.duration,
          {
            value: resolvedValue,
            diceValue: effDef.diceValue
              ? { count: effDef.diceValue.count, sides: effDef.diceValue.sides }
              : undefined,
            damageType: effDef.damageType,
            roundsRemaining: effDef.roundsRemaining,
            source: castInfo.spellName,
            sourceCombatantId: actorId,
            description: `${castInfo.spellName} (${effDef.type} on ${effDef.target})`,
            triggerAt: effDef.triggerAt,
            saveToEnd: resolvedSaveToEnd,
            conditionName: effDef.conditionName,
            triggerSave: resolvedTriggerSave,
            triggerConditions: effDef.triggerConditions,
            // For effects that target "attacks against this creature" (e.g., Dodge, Faerie Fire)
            // OR caster-side damage riders scoped to a specific target (Hex, Hunter's Mark)
            targetCombatantId:
              isCasterDamageRider
                ? entityId
                : effDef.target === "attack_rolls" &&
                  (effDef.type === "advantage" || effDef.type === "disadvantage") &&
                  appliesTo === "enemies"
                  ? entityId
                  : undefined,
          },
        );

        // Caster-side damage riders go on the CASTER's resources (not the target's)
        const recipientCId = isCasterDamageRider ? actorCombatant?.id : targetCId;
        const recipientC = recipientCId ? combatants.find(c => c.id === recipientCId) : undefined;
        if (recipientC) {
          const updatedResources = addActiveEffectsToResources(recipientC.resources ?? {}, effect);
          await deps.combatRepo.updateCombatantState(recipientC.id, {
            resources: updatedResources as JsonValue,
          });
          // Mutate the in-memory snapshot so subsequent effectDeclarations that target
          // the same combatant accumulate with earlier effects (fixes Bane / Bless
          // multi-effect-on-same-target overwrite: SPELL-BANE audit).
          (recipientC as any).resources = updatedResources;
          if (!appliedTo.includes(entityId)) appliedTo.push(entityId);
          if (debugLogsEnabled)
            console.log(
              `[BuffDebuffSpellDeliveryHandler] Applied effect "${effDef.type}→${effDef.target}" to ${recipientC.id}${isCasterDamageRider ? ' (caster, scoped to ' + entityId + ')' : ''} from ${castInfo.spellName}`,
            );
        }
      }
    }

    // Mark action spent
    await deps.actions.castSpell(sessionId, {
      encounterId,
      actor,
      spellName: castInfo.spellName,
      skipActionCheck: isBonusAction,
    });

    // If bonus action spell, mark bonus action used on resources.
    // CRITICAL: re-fetch the combatant here — earlier effect-writes in this handler mutated
    // actorCombatant.resources (e.g., Hex damage rider on caster). Reading from the stale
    // `actorCombatant.resources` snapshot would clobber those freshly-written effects.
    if (isBonusAction && actorCombatant) {
      const refreshed = (await deps.combatRepo.listCombatants(encounterId)).find(
        (c) => c.id === actorCombatant.id,
      );
      const actorResources = normalizeResources(refreshed?.resources ?? actorCombatant.resources ?? {});
      await deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: patchResources(actorResources, { bonusActionUsed: true }),
      });
    }

    const targetNote =
      appliedTo.length > 0 ? ` affecting ${appliedTo.length} target(s)` : "";
    const concNote = isConcentration ? " [concentration]" : "";
    const saveNote = saveMessages.length > 0 ? ` [${saveMessages.join('; ')}]` : "";

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: `Cast ${castInfo.spellName}${targetNote}.${concNote}${saveNote}`,
    };
  }
}
