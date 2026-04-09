/**
 * Readied Attack Trigger — resolves readied actions with `creature_attacks` triggers.
 *
 * D&D 5e 2024: When a readied action's trigger occurs, the readying creature can
 * use its Reaction right after the trigger finishes. This helper fires readied
 * `creature_attacks` triggers after any attack resolves.
 *
 * Called from:
 * - AttackReactionHandler.complete() (two-phase attacks)
 * - AiAttackResolver (AI direct-hit and miss paths)
 */

import { nanoid } from "nanoid";
import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { ICombatantResolver } from "./combatant-resolver.js";
import type { IEventRepository } from "../../../repositories/event-repository.js";
import type { CombatantRef } from "./combatant-ref.js";
import { combatantRefFromState } from "./combatant-ref.js";
import { normalizeResources, getPosition } from "./resource-utils.js";
import { hasReactionAvailable } from "../../../../domain/rules/opportunity-attack.js";
import { SeededDiceRoller } from "../../../../domain/rules/dice-roller.js";
import { applyKoEffectsIfNeeded } from "./ko-handler.js";
import type { JsonValue } from "../../../types.js";

export interface ReadiedAttackTriggerResult {
  attackerId: string;
  attackerName: string;
  targetId: string;
  attackRoll: number;
  targetAC: number;
  hit: boolean;
  damage: number;
}

export interface ReadiedAttackTriggerDeps {
  combat: ICombatRepository;
  combatants: ICombatantResolver;
  events?: IEventRepository;
}

/**
 * After an attack resolves, check if any other combatant has a readied action
 * with `creature_attacks` trigger. If so, fire the readied action (as a reaction).
 *
 * @param sessionId - Game session
 * @param encounterId - Active encounter
 * @param attackerCombatantId - The combatant who just attacked (the trigger source)
 * @param deps - Repository dependencies
 * @returns Array of executed readied attacks
 */
export async function resolveReadiedAttackTriggers(
  sessionId: string,
  encounterId: string,
  attackerCombatantId: string,
  deps: ReadiedAttackTriggerDeps,
): Promise<ReadiedAttackTriggerResult[]> {
  const results: ReadiedAttackTriggerResult[] = [];
  const combatants = await deps.combat.listCombatants(encounterId);

  const attacker = combatants.find((c) => c.id === attackerCombatantId);
  if (!attacker || attacker.hpCurrent <= 0) return results;

  for (const reactor of combatants) {
    if (reactor.id === attackerCombatantId) continue;
    if (reactor.hpCurrent <= 0) continue;

    const reactorResources = normalizeResources(reactor.resources);
    const readiedAction = reactorResources.readiedAction as {
      responseType?: string;
      triggerType?: string;
      triggerDescription?: string;
      targetName?: string;
    } | undefined;

    if (!readiedAction) continue;
    if (readiedAction.triggerType !== "creature_attacks") continue;
    if (readiedAction.responseType !== "attack") continue;

    // Must have reaction available
    const hasReaction = hasReactionAvailable({ reactionUsed: false, ...reactorResources } as any);
    if (!hasReaction) continue;

    // If the readied action targets a specific creature, check if the attacker matches
    if (readiedAction.targetName) {
      const reactorRef = combatantRefFromState(reactor);
      if (reactorRef) {
        const attackerName = await deps.combatants.getName(
          combatantRefFromState(attacker) ?? { type: "Character", characterId: "" },
          attacker,
        );
        if (!attackerName.toLowerCase().includes(readiedAction.targetName.toLowerCase())) {
          continue; // Trigger target doesn't match the attacker
        }
      }
    }

    // Fire the readied attack reaction
    const reactorRef = combatantRefFromState(reactor);
    if (!reactorRef) continue;

    // Get reactor's attack stats
    let attackBonus = 0;
    let damageDice = { count: 1, sides: 6, modifier: 0 };
    let attackNameStr = "readied attack";
    try {
      const attacks = await deps.combatants.getAttacks(reactorRef) as Array<{
        name?: string;
        kind?: string;
        attackBonus?: number;
        damage?: { diceCount?: number; diceSides?: number; modifier?: number };
      }>;
      const meleeAttack = attacks.find((a) => a.kind === "melee") ?? attacks[0];
      if (meleeAttack) {
        attackBonus = meleeAttack.attackBonus ?? 0;
        attackNameStr = meleeAttack.name ?? "readied attack";
        if (meleeAttack.damage) {
          damageDice = {
            count: meleeAttack.damage.diceCount ?? 1,
            sides: meleeAttack.damage.diceSides ?? 6,
            modifier: meleeAttack.damage.modifier ?? 0,
          };
        }
      }
    } catch { /* use defaults */ }

    // Get attacker's AC
    let targetAC: number;
    const attackerRef = combatantRefFromState(attacker);
    try {
      const attackerStats = await deps.combatants.getCombatStats(
        attackerRef ?? { type: "Character", characterId: "" },
      );
      targetAC = attackerStats.armorClass;
    } catch {
      const attackerRes = normalizeResources(attacker.resources);
      targetAC = typeof attackerRes.armorClass === "number" ? attackerRes.armorClass : 10;
    }

    // Roll attack (deterministic via seed)
    const seed = (reactor.id + attackerCombatantId + "readied_attack_trigger").split("")
      .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
    const diceRoller = new SeededDiceRoller(seed);
    const d20Roll = diceRoller.rollDie(20);
    const attackTotal = d20Roll.total + attackBonus;
    const hit = attackTotal >= targetAC;
    let damage = 0;

    if (hit) {
      const dmgRoll = diceRoller.rollDie(damageDice.sides, damageDice.count, damageDice.modifier);
      damage = Math.max(1, dmgRoll.total);

      const hpBefore = attacker.hpCurrent;
      const hpAfter = Math.max(0, hpBefore - damage);
      await deps.combat.updateCombatantState(attacker.id, { hpCurrent: hpAfter });
      await applyKoEffectsIfNeeded(attacker, hpBefore, hpAfter, deps.combat);
    }

    // Mark reaction used + clear readied action
    const updatedResources: Record<string, unknown> = {
      ...reactorResources,
      reactionUsed: true,
      readiedAction: undefined,
    };
    await deps.combat.updateCombatantState(reactor.id, {
      resources: updatedResources as JsonValue,
    });

    const reactorName = await deps.combatants.getName(reactorRef, reactor);

    results.push({
      attackerId: reactor.id,
      attackerName: reactorName,
      targetId: attacker.id,
      attackRoll: attackTotal,
      targetAC,
      hit,
      damage,
    });

    // Emit event
    if (deps.events) {
      const targetName = await deps.combatants.getName(
        attackerRef ?? { type: "Character", characterId: "" },
        attacker,
      );
      await deps.events.append(sessionId, {
        id: nanoid(),
        type: "ReadiedActionTriggered",
        payload: {
          encounterId,
          reactorId: reactor.id,
          reactorName,
          triggerType: "creature_attacks",
          targetId: attacker.id,
          targetName,
          attackName: attackNameStr,
          attackRoll: attackTotal,
          targetAC,
          hit,
          damage,
        },
      });
    }
  }

  return results;
}
