
import { nanoid } from "nanoid";

import { SeededDiceRoller } from "../../../domain/rules/dice-roller.js";
import { attemptMovement, calculateDistance, type Position, type MovementAttempt } from "../../../domain/rules/movement.js";
import { isPitEntry, type CombatMap } from "../../../domain/rules/combat-map.js";

import { NotFoundError, ValidationError } from "../../errors.js";
import {
  normalizeResources,
  readBoolean,
  hasSpentAction,
  spendAction,
  markDisengaged,
  getPosition,
  getEffectiveSpeed,
  addActiveEffectsToResources,
} from "./helpers/resource-utils.js";
import {
  createEffect,
} from "../../../domain/entities/combat/effects.js";
import { applyKoEffectsIfNeeded } from "./helpers/ko-handler.js";
import type { ICombatRepository } from "../../repositories/combat-repository.js";
import type { IEventRepository } from "../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../repositories/game-session-repository.js";
import type { CombatEncounterRecord, CombatantStateRecord, JsonValue } from "../../types.js";
import type { ICombatantResolver } from "./helpers/combatant-resolver.js";
import type { CombatantRef } from "./helpers/combatant-ref.js";
import { findCombatantStateByRef } from "./helpers/combatant-ref.js";
import { resolveEncounterOrThrow } from "./helpers/encounter-resolver.js";
import {
  type AttackActionInput,
  type SimpleActionBaseInput,
  type HelpActionInput,
  type CastSpellActionInput,
  type ShoveActionInput,
  type GrappleActionInput,
  type HideActionInput,
  type SearchActionInput,
  type MoveActionInput,
  hashStringToInt32,
} from "./helpers/combat-utils.js";
import { resolvePitEntry } from "./helpers/pit-terrain-resolver.js";
import { detectOpportunityAttacks } from "./helpers/oa-detection.js";
import { resolveOpportunityAttacks, type ResolveOAInput } from "./helpers/opportunity-attack-resolver.js";


import { resolveActiveActorOrThrow } from "./helpers/active-actor-resolver.js";

import { AttackActionHandler } from "./action-handlers/attack-action-handler.js";
import { GrappleActionHandler } from "./action-handlers/grapple-action-handler.js";
import { SkillActionHandler } from "./action-handlers/skill-action-handler.js";
import type { INarrativeGenerator } from "../../../infrastructure/llm/narrative-generator.js";

/**
 * Executes concrete in-combat actions (attack, etc.) against the active encounter state.
 * Layer: Application.
 * Notes: Delegates deterministic mechanics to `domain/` and persists results + emits events/narration.
 */
export class ActionService {
  private readonly attackHandler: AttackActionHandler;
  private readonly grappleHandler: GrappleActionHandler;
  private readonly skillHandler: SkillActionHandler;

  constructor(
    private readonly sessions: IGameSessionRepository,
    private readonly combat: ICombatRepository,
    private readonly combatants: ICombatantResolver,
    private readonly events?: IEventRepository,
    private readonly narrativeGenerator?: INarrativeGenerator,
  ) {
    this.attackHandler = new AttackActionHandler(sessions, combat, combatants, events, narrativeGenerator);
    this.grappleHandler = new GrappleActionHandler(sessions, combat, combatants, events);
    this.skillHandler = new SkillActionHandler(sessions, combat, combatants, events);
  }

  private async resolveActiveActorOrThrow(
    sessionId: string,
    input: { encounterId?: string; actor: CombatantRef; skipActionCheck?: boolean },
  ) {
    return resolveActiveActorOrThrow(this.sessions, this.combat, sessionId, input);
  }

  private async performSimpleAction(
    sessionId: string,
    input: SimpleActionBaseInput,
    action: "Dodge" | "Dash" | "Disengage" | "CastSpell" | "Help",
    extra?: { target?: CombatantRef; spellName?: string },
  ): Promise<{ actor: CombatantStateRecord; narrative?: string }> {
    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const { encounter, combatants, actorState } = await this.resolveActiveActorOrThrow(sessionId, {
      encounterId: input.encounterId,
      actor: input.actor,
      skipActionCheck: input.skipActionCheck,
    });

    let targetState: CombatantStateRecord | null = null;
    if (extra?.target) {
      targetState = findCombatantStateByRef(combatants, extra.target);
      if (!targetState) throw new NotFoundError("Target not found in encounter");
    }

    const seed =
      (input.seed as number | undefined) ??
      hashStringToInt32(
        `${sessionId}:${encounter.id}:${encounter.round}:${encounter.turn}:${action}:${JSON.stringify(input.actor)}:${JSON.stringify(extra ?? {})}`,
      );

    const actorResources = normalizeResources(actorState.resources);
    
    // Mark turn-state flags for certain actions.
    // Note: Dash affects movement (handled by move via `dashed`), Disengage prevents OAs (handled by `disengaged`).
    // If skipActionCheck is true (bonus action), don't mark actionSpent - only mark bonusActionUsed.
    let updatedResources: JsonValue;
    if (input.skipActionCheck) {
      // Bonus action version - don't spend the regular action
      updatedResources = { ...actorResources, bonusActionUsed: true } as JsonValue;
    } else {
      updatedResources = { ...actorResources, actionSpent: true } as JsonValue;
    }
    if (action === "Disengage") {
      updatedResources = markDisengaged(updatedResources);
    }
    if (action === "Dash") {
      const speed = getEffectiveSpeed(actorState.resources);
      const currentRemaining = typeof actorResources.movementRemaining === "number"
        ? actorResources.movementRemaining : speed;
      updatedResources = {
        ...(updatedResources as any),
        dashed: true,
        movementRemaining: currentRemaining + speed,
        movementSpent: false,
      } as JsonValue;
    }
    
    const updatedActor = await this.combat.updateCombatantState(actorState.id, {
      resources: updatedResources,
    });

    let narrative: string | undefined;

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ActionResolved",
        payload: {
          encounterId: encounter.id,
          actor: input.actor,
          action,
          ...(extra?.spellName ? { spellName: extra.spellName } : {}),
          ...(extra?.target ? { target: extra.target } : {}),
        },
      });

      if (this.narrativeGenerator) {
        try {
          const actorName = await this.combatants.getName(input.actor, actorState);
          let targetName: string | undefined;
          if (extra?.target && targetState) {
            targetName = await this.combatants.getName(extra.target, targetState);
          }

          const session = await this.sessions.getById(sessionId);
          narrative = await this.narrativeGenerator.narrate({
            storyFramework: session?.storyFramework ?? {},
            events: [
              {
                type: "ActionResolved",
                action,
                actor: actorName,
                ...(targetName ? { target: targetName } : {}),
                ...(extra?.spellName ? { spellName: extra.spellName } : {}),
              },
            ],
            seed,
          });
        } catch (err) {
          console.error("[ActionService] Action narration failed:", err);
        }
      }
    }

    return { actor: updatedActor, narrative };
  }


  async attack(sessionId: string, input: AttackActionInput): Promise<{ result: unknown; target: CombatantStateRecord }> {
    return this.attackHandler.execute(sessionId, input);
  }

  async dodge(sessionId: string, input: SimpleActionBaseInput): Promise<{ actor: CombatantStateRecord }> {
    const result = await this.performSimpleAction(sessionId, input, "Dodge");

    // Apply Dodge active effects:
    // 1. Attacks against the dodger have disadvantage
    // 2. Dodger has advantage on DEX saving throws
    const entityId = result.actor.characterId ?? result.actor.monsterId ?? result.actor.npcId ?? result.actor.id;
    const dodgeEffects = [
      createEffect(nanoid(), 'disadvantage', 'attack_rolls', 'until_start_of_next_turn', {
        targetCombatantId: entityId,
        source: 'Dodge',
        description: 'Attacks against this creature have disadvantage',
      }),
      createEffect(nanoid(), 'advantage', 'saving_throws', 'until_start_of_next_turn', {
        ability: 'dexterity',
        source: 'Dodge',
        description: 'Advantage on Dexterity saving throws',
      }),
    ];
    const updatedResources = addActiveEffectsToResources(
      normalizeResources(result.actor.resources),
      ...dodgeEffects,
    );
    const updatedActor = await this.combat.updateCombatantState(result.actor.id, {
      resources: updatedResources,
    });

    return { actor: updatedActor };
  }

  async dash(sessionId: string, input: SimpleActionBaseInput): Promise<{ actor: CombatantStateRecord }> {
    return this.performSimpleAction(sessionId, input, "Dash");
  }

  async disengage(sessionId: string, input: SimpleActionBaseInput): Promise<{ actor: CombatantStateRecord }> {
    return this.performSimpleAction(sessionId, input, "Disengage");
  }

  async hide(sessionId: string, input: HideActionInput): Promise<{
    actor: CombatantStateRecord;
    result: {
      success: boolean;
      stealthRoll: number;
      reason?: string;
    };
  }> {
    return this.skillHandler.hide(sessionId, input);
  }

  /**
   * Search action: Wisdom (Perception) check to reveal Hidden creatures.
   * D&D 5e 2024: The Search action uses a Perception check vs. each hidden creature's Stealth DC.
   */
  async search(sessionId: string, input: SearchActionInput): Promise<{
    actor: CombatantStateRecord;
    result: {
      found: string[];
      roll: number;
    };
  }> {
    return this.skillHandler.search(sessionId, input);
  }

  /**
   * Help action (D&D 5e 2024): The first attack roll that an ally makes against
   * the target before the start of the helper's next turn has Advantage.
   * Creates a consumable advantage ActiveEffect on the target creature.
   */
  async help(sessionId: string, input: HelpActionInput): Promise<{ actor: CombatantStateRecord }> {
    const { encounter, combatants, actorState } = await this.resolveActiveActorOrThrow(sessionId, {
      encounterId: input.encounterId,
      actor: input.actor,
      skipActionCheck: input.skipActionCheck,
    });

    const targetState = findCombatantStateByRef(combatants, input.target);
    if (!targetState) throw new NotFoundError("Target not found in encounter");

    // D&D 5e 2024: Help action requires being within 5 feet of the target
    const actorPos = getPosition(normalizeResources(actorState.resources ?? {}));
    const targetPos = getPosition(normalizeResources(targetState.resources ?? {}));
    if (actorPos && targetPos) {
      const distance = calculateDistance(actorPos, targetPos);
      if (distance > 5.0001) {
        throw new ValidationError(
          `Help action requires being within 5 feet of the target. You are ${Math.round(distance)} ft away.`,
        );
      }
    }

    // Spend the action
    const updatedResources = input.skipActionCheck
      ? { ...(normalizeResources(actorState.resources)), bonusActionUsed: true }
      : { ...(normalizeResources(actorState.resources)), actionSpent: true };

    const updatedActor = await this.combat.updateCombatantState(actorState.id, {
      resources: updatedResources as JsonValue,
    });

    // Create consumable advantage effect on the target (advantage on attacks against it)
    // targetCombatantId uses entity ID (characterId/monsterId/npcId) to match attack handler lookups
    const targetEntityId = targetState.characterId ?? targetState.monsterId ?? targetState.npcId ?? targetState.id;
    const helpEffect = createEffect(nanoid(), "advantage", "attack_rolls", "until_triggered", {
      source: "Help",
      sourceCombatantId: actorState.id,
      targetCombatantId: targetEntityId,
      description: `Advantage on next attack against this creature (Help from ${actorState.characterId ?? actorState.monsterId ?? actorState.npcId ?? "ally"})`,
    });

    const targetResources = addActiveEffectsToResources(targetState.resources ?? {}, helpEffect);
    await this.combat.updateCombatantState(targetState.id, {
      resources: targetResources as JsonValue,
    });

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ActionResolved",
        payload: {
          encounterId: encounter.id,
          actor: input.actor,
          action: "Help",
          target: input.target,
        },
      });
    }

    return { actor: updatedActor };
  }

  async castSpell(sessionId: string, input: CastSpellActionInput): Promise<{ actor: CombatantStateRecord }> {
    if (!input.spellName || input.spellName.trim().length === 0) {
      throw new ValidationError("spellName is required");
    }
    return this.performSimpleAction(sessionId, input, "CastSpell", { spellName: input.spellName.trim() });
  }

  async shove(sessionId: string, input: ShoveActionInput): Promise<{
    actor: CombatantStateRecord;
    target: CombatantStateRecord;
    result: {
      success: boolean;
      shoveType: "push" | "prone";
      attackRoll: number;
      attackTotal: number;
      targetAC: number;
      hit: boolean;
      dc: number;
      saveRoll: number;
      total: number;
      abilityUsed: "strength" | "dexterity";
      reason?: string;
      pushedTo?: Position;
    };
  }> {
    return this.grappleHandler.shove(sessionId, input);
  }

  async grapple(sessionId: string, input: GrappleActionInput): Promise<{
    actor: CombatantStateRecord;
    target: CombatantStateRecord;
    result: {
      success: boolean;
      attackRoll: number;
      attackTotal: number;
      targetAC: number;
      hit: boolean;
      dc: number;
      saveRoll: number;
      total: number;
      abilityUsed: "strength" | "dexterity";
      reason?: string;
    };
  }> {
    return this.grappleHandler.grapple(sessionId, input);
  }

  /**
   * Escape from a grapple (2024 rules).
   * DC = 8 + grappler's STR mod + grappler's proficiency bonus.
   * Escapee rolls Athletics (STR) or Acrobatics (DEX) — picks higher.
   * On success the Grappled condition is removed.
   */
  async escapeGrapple(sessionId: string, input: SimpleActionBaseInput): Promise<{
    actor: CombatantStateRecord;
    result: {
      success: boolean;
      dc: number;
      saveRoll: number;
      total: number;
      abilityUsed: "strength" | "dexterity";
      reason?: string;
    };
  }> {
    return this.grappleHandler.escapeGrapple(sessionId, input);
  }

  async move(sessionId: string, input: MoveActionInput): Promise<{
    actor: CombatantStateRecord;
    result: {
      from: Position;
      to: Position;
      movedFeet: number;
      opportunityAttacks: Array<{
        attackerId: string;
        targetId: string;
        result: unknown;
      }>;
    };
    opportunityAttacks: Array<{
      attackerId: string;
      targetId: string;
      canAttack: boolean;
      hasReaction: boolean;
    }>;
  }> {
    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const encounter = await resolveEncounterOrThrow(this.sessions, this.combat, sessionId, input.encounterId);
    const combatants = await this.combat.listCombatants(encounter.id);
    const combatMap = encounter.mapData as CombatMap | undefined;

    const actor = findCombatantStateByRef(combatants, input.actor);
    if (!actor) throw new NotFoundError("Actor not found in encounter");

    let actorCombatStats: Awaited<ReturnType<ICombatantResolver["getCombatStats"]>> | null = null;
    const getActorCombatStats = async () => {
      if (!actorCombatStats) {
        actorCombatStats = await this.combatants.getCombatStats(input.actor);
      }
      return actorCombatStats;
    };

    // Check if actor has action available
    const resources = normalizeResources(actor.resources);
    // Movement is separate from the action economy, but we currently cap it to one move per turn.
    const movementSpent = readBoolean(resources, "movementSpent") ?? false;
    if (movementSpent) {
      throw new ValidationError("Actor has already moved this turn");
    }

    // Get current position
    const currentPos = getPosition(resources);
    if (!currentPos) {
      throw new ValidationError("Actor does not have a position set");
    }

    // Get actor's speed from resources
    const speed = getEffectiveSpeed(actor.resources);

    // Check if Dashed (doubles speed)
    const hasDashed = readBoolean(resources, "dashed") ?? false;
    const effectiveSpeed = hasDashed ? speed * 2 : speed;

    // Validate movement
    const movementAttempt: MovementAttempt = {
      from: currentPos,
      to: input.destination,
      speed: effectiveSpeed,
    };

    const movementResult = attemptMovement(movementAttempt);
    if (!movementResult.success) {
      throw new ValidationError(movementResult.reason || "Movement not allowed");
    }

    // Programmatic move path: detect OAs via shared helper, then resolve immediately.
    const oaDetections = detectOpportunityAttacks({
      combatants,
      actor,
      from: currentPos,
      to: input.destination,
    });

    const opportunityAttacks: Array<{
      attackerId: string;
      targetId: string;
      canAttack: boolean;
      hasReaction: boolean;
    }> = oaDetections.map((detection) => ({
      attackerId: detection.combatant.id,
      targetId: actor.id,
      canAttack: detection.canAttack,
      hasReaction: detection.hasReaction,
    }));

    // Update position and track remaining movement
    const distanceMoved = currentPos ? calculateDistance(currentPos, input.destination) : 0;
    const currentRemaining = typeof (resources as any).movementRemaining === "number"
      ? (resources as any).movementRemaining
      : (typeof (resources as any).speed === "number" ? (resources as any).speed : 30);
    const newMovementRemaining = Math.max(0, currentRemaining - distanceMoved);
    const updatedResources = {
      ...resources,
      position: input.destination,
      movementSpent: newMovementRemaining <= 0,
      movementRemaining: newMovementRemaining,
    };

    const updatedActor = {
      ...actor,
      resources: updatedResources as JsonValue,
    };

    // Save updated position and resources
    await this.combat.updateCombatantState(actor.id, {
      resources: updatedResources as JsonValue,
    });

    // Execute opportunity attacks via shared resolver (CO-M9: consolidated OA resolution)
    const executedAttacks: Array<{
      attackerId: string;
      targetId: string;
      result: unknown;
    }> = [];
    let latestHpCurrent = actor.hpCurrent;

    const eligibleOAs = opportunityAttacks.filter(opp => opp.canAttack);
    if (eligibleOAs.length > 0) {
      // Build synthetic PendingAction for the shared OA resolver
      const reactionOpportunities = eligibleOAs.map((opp, idx) => ({
        id: `auto-oa-${idx}`,
        combatantId: opp.attackerId,
        reactionType: "opportunity_attack" as const,
        canUse: true,
        context: {},
      }));
      const resolvedReactions = eligibleOAs.map((opp, idx) => ({
        opportunityId: `auto-oa-${idx}`,
        combatantId: opp.attackerId,
        choice: "use" as const,
        respondedAt: new Date(),
      }));
      const syntheticPendingAction = {
        id: `auto-oa-${nanoid()}`,
        encounterId: encounter.id,
        actor: input.actor,
        type: "move" as const,
        data: { type: "move" as const, from: currentPos, to: input.destination, path: [input.destination] },
        reactionOpportunities,
        resolvedReactions,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      };

      const oaInput: ResolveOAInput = {
        sessionId,
        pendingAction: syntheticPendingAction,
        encounter: { id: encounter.id, round: encounter.round, mapData: encounter.mapData },
        actor: {
          id: actor.id,
          hpCurrent: actor.hpCurrent,
          hpMax: actor.hpMax,
          resources: actor.resources,
          conditions: actor.conditions,
          characterId: actor.characterId,
          monsterId: actor.monsterId,
          npcId: (actor as any).npcId,
          combatantType: actor.combatantType,
        },
        combatants,
        moveFrom: currentPos,
      };

      const oaResult = await resolveOpportunityAttacks(oaInput, {
        combat: this.combat,
        combatants: this.combatants,
        events: this.events,
      });

      for (const executed of oaResult.executedOAs) {
        executedAttacks.push({
          attackerId: executed.attackerId,
          targetId: executed.targetId,
          result: { hit: true, damage: { applied: executed.damage } },
        });
      }

      if (!oaResult.targetStillAlive) {
        latestHpCurrent = 0;
      } else {
        // Re-fetch current HP after OA resolution
        const updatedCombatant = (await this.combat.listCombatants(encounter.id)).find(c => c.id === actor.id);
        latestHpCurrent = updatedCombatant?.hpCurrent ?? actor.hpCurrent;
      }
    }

    if (latestHpCurrent > 0 && combatMap && isPitEntry(combatMap, currentPos, input.destination)) {
      const actorAfterOa = (await this.combat.listCombatants(encounter.id)).find((c) => c.id === actor.id) ?? actor;
      const actorStats = await getActorCombatStats();
      const pitSeed =
        (input.seed as number | undefined) ??
        hashStringToInt32(`${sessionId}:${encounter.id}:${actor.id}:${currentPos.x}:${currentPos.y}:${input.destination.x}:${input.destination.y}:pit`);
      const pitResult = resolvePitEntry(
        combatMap,
        currentPos,
        input.destination,
        actorStats.abilityScores.dexterity,
        actorAfterOa.hpCurrent,
        actorAfterOa.conditions,
        new SeededDiceRoller(pitSeed),
      );

      if (pitResult.triggered) {
        await this.combat.updateCombatantState(actor.id, {
          hpCurrent: pitResult.hpAfter,
          conditions: pitResult.updatedConditions as unknown as JsonValue,
          resources: {
            ...updatedResources,
            movementRemaining: pitResult.movementEnds ? 0 : updatedResources.movementRemaining,
            movementSpent: pitResult.movementEnds ? true : updatedResources.movementSpent,
          } as JsonValue,
        });

        if (pitResult.damageApplied > 0) {
          await applyKoEffectsIfNeeded(actorAfterOa, actorAfterOa.hpCurrent, pitResult.hpAfter, this.combat);
        }
      }
    }

    // Emit movement event
    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "Move",
        payload: {
          encounterId: encounter.id,
          actorId: actor.id,
          from: currentPos,
          to: input.destination,
          distanceMoved: movementResult.distanceMoved,
        },
      });
    }

    const finalActor = (await this.combat.listCombatants(encounter.id)).find((c) => c.id === actor.id) ?? updatedActor;

    return { 
      actor: finalActor,
      result: {
        from: currentPos,
        to: input.destination,
        movedFeet: movementResult.distanceMoved,
        opportunityAttacks: executedAttacks.map(ea => ({
          attackerId: ea.attackerId,
          targetId: ea.targetId,
          result: ea.result,
        })),
      },
      opportunityAttacks: executedAttacks.map(ea => ({
        attackerId: ea.attackerId,
        targetId: ea.targetId,
        canAttack: true,
        hasReaction: false, // Reaction was used
      })),
    };
  }
}
