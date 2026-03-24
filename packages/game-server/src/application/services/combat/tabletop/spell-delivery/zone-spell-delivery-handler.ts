/**
 * ZoneSpellDeliveryHandler — handles area-of-effect zone spells.
 * Covers: Spirit Guardians (aura), Spike Growth, Cloud of Daggers, Web, etc.
 *
 * Creates a persistent CombatZone on the map. Zone effects (damage, conditions)
 * are applied to creatures that enter or start their turn in the zone.
 */

import { findCombatantByName } from '../combat-text-parser.js';
import { createEffect } from '../../../../../domain/entities/combat/effects.js';
import { createZone } from '../../../../../domain/entities/combat/zones.js';
import type { ZoneEffect } from '../../../../../domain/entities/combat/zones.js';
import { addZone } from '../../../../../domain/rules/combat-map.js';
import { getPosition } from '../../helpers/resource-utils.js';
import { nanoid } from 'nanoid';
import type { CombatMap } from '../../../../../domain/rules/combat-map.js';
import type { PreparedSpellDefinition } from '../../../../../domain/entities/spells/prepared-spell-definition.js';
import type { ActionParseResult } from '../tabletop-types.js';
import type { JsonValue } from '../../../../types.js';
import type { SpellCastingContext, SpellDeliveryDeps, SpellDeliveryHandler } from './spell-delivery-handler.js';

export class ZoneSpellDeliveryHandler implements SpellDeliveryHandler {
  constructor(private readonly handlerDeps: SpellDeliveryDeps) {}

  canHandle(spell: PreparedSpellDefinition): boolean {
    return !!spell.zone;
  }

  async handle(ctx: SpellCastingContext): Promise<ActionParseResult> {
    const {
      sessionId,
      encounterId,
      actorId,
      castInfo,
      spellMatch,
      isConcentration,
      roster,
      encounter,
      combatants,
      actor,
    } = ctx;
    const { deps, debugLogsEnabled } = this.handlerDeps;

    const zoneDef = spellMatch.zone!;
    const map = encounter.mapData as unknown as CombatMap | undefined;
    let zoneCenter = { x: 0, y: 0 };

    // Helper: get position from mapData.entities first, then fall back to combatant resources
    const getEntityPosition = (entityId: string): { x: number; y: number } | null => {
      if (map) {
        const mapEntity = map.entities.find((e) => e.id === entityId);
        if (mapEntity) return mapEntity.position;
      }
      // Fallback: read from combatant resources (entities are lazily populated in mapData)
      const combatant = combatants.find(
        (c: any) =>
          c.characterId === entityId || c.monsterId === entityId || c.npcId === entityId,
      );
      if (combatant) return getPosition(combatant.resources);
      return null;
    };

    if (zoneDef.attachToSelf || zoneDef.type === "aura") {
      // Aura: center on caster
      const pos = getEntityPosition(actorId);
      if (pos) zoneCenter = pos;
    } else if (castInfo.targetName) {
      // Placed zone at target location — use target's position
      const targetRef = findCombatantByName(castInfo.targetName, roster);
      if (targetRef) {
        const tid =
          (targetRef as any).characterId ??
          (targetRef as any).monsterId ??
          (targetRef as any).npcId;
        const pos = getEntityPosition(tid);
        if (pos) zoneCenter = pos;
      }
    } else {
      // Default to caster's position
      const pos = getEntityPosition(actorId);
      if (pos) zoneCenter = pos;
    }

    // Build ZoneEffect array from spell declaration
    const zoneEffects: ZoneEffect[] = zoneDef.effects.map((eff) => {
      const ze: ZoneEffect = {
        trigger: eff.trigger,
        damage: eff.damage,
        damageType: eff.damageType,
        saveAbility: eff.saveAbility as any,
        saveDC: eff.saveDC,
        halfDamageOnSave: eff.halfDamageOnSave,
        conditions: eff.conditions,
        activeEffect: eff.activeEffect
          ? createEffect(
              nanoid(),
              eff.activeEffect.type,
              eff.activeEffect.target,
              isConcentration ? "concentration" : "permanent",
              {
                value: eff.activeEffect.value,
                source: castInfo.spellName,
                sourceCombatantId: actorId,
                description: `${castInfo.spellName} zone aura`,
              },
            )
          : undefined,
        affectsAllies: eff.affectsAllies,
        affectsEnemies: eff.affectsEnemies,
        affectsSelf: eff.affectsSelf,
      };
      return ze;
    });

    // Determine combat round/turn info
    const currentRound = encounter.round ?? 1;
    const currentTurnIndex = encounter.turn ?? 0;

    // Create the zone
    const zone = createZone(
      nanoid(),
      zoneDef.type,
      zoneCenter,
      zoneDef.radiusFeet,
      castInfo.spellName,
      actorId,
      zoneEffects,
      isConcentration ? "concentration" : "rounds",
      {
        attachedTo:
          zoneDef.attachToSelf || zoneDef.type === "aura" ? actorId : undefined,
        shape: zoneDef.shape ?? "circle",
        createdAtRound: currentRound,
        createdAtTurnIndex: currentTurnIndex,
        direction: zoneDef.direction,
        width: zoneDef.width,
      },
    );

    // Add zone to map data
    if (map) {
      const updatedMap = addZone(map, zone);
      await deps.combatRepo.updateEncounter(encounter.id, {
        mapData: updatedMap as unknown as JsonValue,
      });
      if (debugLogsEnabled)
        console.log(
          `[ZoneSpellDeliveryHandler] Created zone "${zone.id}" for ${castInfo.spellName} at (${zoneCenter.x}, ${zoneCenter.y}) radius=${zoneDef.radiusFeet}ft`,
        );
    }

    // Mark action spent
    await deps.actions.castSpell(sessionId, {
      encounterId,
      actor,
      spellName: castInfo.spellName,
    });

    const concNote = isConcentration ? " [concentration]" : "";
    const typeNote =
      zoneDef.type === "aura"
        ? " (aura, moves with caster)"
        : ` at (${zoneCenter.x}, ${zoneCenter.y})`;

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: `Cast ${castInfo.spellName}${typeNote}, ${zoneDef.radiusFeet}ft radius.${concNote}`,
    };
  }
}
