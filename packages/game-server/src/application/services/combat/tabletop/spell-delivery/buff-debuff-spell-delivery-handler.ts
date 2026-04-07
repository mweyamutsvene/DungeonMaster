/**
 * BuffDebuffSpellDeliveryHandler — handles buff/debuff spells with declared ActiveEffect instances.
 * Covers: Bless, Shield of Faith, Faerie Fire, Hold Person (as condition effect), etc.
 *
 * Resolves targets based on `appliesTo`, creates effects, and applies them to combatants.
 */

import { findCombatantByName } from '../combat-text-parser.js';
import { createEffect } from '../../../../../domain/entities/combat/effects.js';
import { addActiveEffectsToResources } from '../../helpers/resource-utils.js';
import { getSpellcastingModifier } from '../../../../../domain/rules/spell-casting.js';
import { nanoid } from 'nanoid';
import type { PreparedSpellDefinition } from '../../../../../domain/entities/spells/prepared-spell-definition.js';
import type { ActionParseResult } from '../tabletop-types.js';
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
      sheet,
      actor,
      roster,
      encounter,
      combatants,
      actorCombatant,
    } = ctx;
    const { deps, debugLogsEnabled } = this.handlerDeps;

    const effectDeclarations = spellMatch.effects ?? [];
    const appliedTo: string[] = [];

    // Guard: canHandle() ensures effects.length > 0, but warn defensively if somehow bypassed.
    if (effectDeclarations.length === 0) {
      console.warn(
        `[WARN] Spell '${castInfo.spellName}' has no effects defined — no mechanical changes applied. Check the spell catalog definition.`,
      );
      await deps.actions.castSpell(sessionId, { encounterId, actor, spellName: castInfo.spellName });
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "SIMPLE_ACTION_COMPLETE",
        action: "CastSpell",
        message: `[WARN] Spell '${castInfo.spellName}' has no effects defined — no mechanical changes applied. Check the spell catalog definition.`,
      };
    }

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
            const tid =
              (targetRef as any).characterId ??
              (targetRef as any).monsterId ??
              (targetRef as any).npcId;
            const targetC = combatants.find(
              (c: any) => c.characterId === tid || c.monsterId === tid || c.npcId === tid,
            );
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
          const c = combatants.find((x: any) => x.id === targetCId);
          return c?.characterId ?? c?.monsterId ?? c?.npcId ?? targetCId;
        })();

        // Resolve dynamic value sources (e.g., Heroism's temp HP = caster's spellcasting modifier)
        let resolvedValue = effDef.value;
        if (effDef.valueSource === 'spellcastingModifier') {
          resolvedValue = Math.max(1, getSpellcastingModifier(sheet));
        }

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
            saveToEnd: effDef.saveToEnd
              ? { ability: effDef.saveToEnd.ability as any, dc: effDef.saveToEnd.dc }
              : undefined,
            conditionName: effDef.conditionName,
            triggerSave: effDef.triggerSave
              ? {
                  ability: effDef.triggerSave.ability as any,
                  dc: effDef.triggerSave.dc,
                  halfDamageOnSave: effDef.triggerSave.halfDamageOnSave,
                }
              : undefined,
            triggerConditions: effDef.triggerConditions,
            // For effects that target "attacks against this creature" (e.g., Dodge, Faerie Fire)
            targetCombatantId:
              effDef.target === "attack_rolls" &&
              (effDef.type === "advantage" || effDef.type === "disadvantage") &&
              appliesTo === "enemies"
                ? entityId
                : undefined,
          },
        );

        const targetC = combatants.find((c: any) => c.id === targetCId);
        if (targetC) {
          const updatedResources = addActiveEffectsToResources(targetC.resources ?? {}, effect);
          await deps.combatRepo.updateCombatantState(targetCId, {
            resources: updatedResources as any,
          });
          if (!appliedTo.includes(entityId)) appliedTo.push(entityId);
          if (debugLogsEnabled)
            console.log(
              `[BuffDebuffSpellDeliveryHandler] Applied effect "${effDef.type}→${effDef.target}" to ${targetCId} from ${castInfo.spellName}`,
            );
        }
      }
    }

    // Mark action spent
    await deps.actions.castSpell(sessionId, {
      encounterId,
      actor,
      spellName: castInfo.spellName,
    });

    const targetNote =
      appliedTo.length > 0 ? ` affecting ${appliedTo.length} target(s)` : "";
    const concNote = isConcentration ? " [concentration]" : "";

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: `Cast ${castInfo.spellName}${targetNote}.${concNote}`,
    };
  }
}
