
import { nanoid } from "nanoid";

import { resolveAttack, type AttackSpec } from "../../../domain/combat/attack-resolver.js";
import { SeededDiceRoller } from "../../../domain/rules/dice-roller.js";
import { attemptMovement, crossesThroughReach, calculateDistance, type Position, type MovementAttempt } from "../../../domain/rules/movement.js";
import { canMakeOpportunityAttack } from "../../../domain/rules/opportunity-attack.js";

import { NotFoundError, ValidationError } from "../../errors.js";
import {
  normalizeResources,
  readBoolean,
  hasSpentAction,
  spendAction,
  markDisengaged,
  getPosition,
  hasReactionAvailable,
  getEffectiveSpeed,
  useReaction,
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
import { isRecord, readNumber } from "./helpers/json-helpers.js";
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
  getAbilityModifier,
  hashStringToInt32,
  buildCreatureAdapter,
} from "./helpers/combat-utils.js";

import { AttackActionHandler } from "./action-handlers/attack-action-handler.js";
import { GrappleActionHandler } from "./action-handlers/grapple-action-handler.js";
import { SkillActionHandler } from "./action-handlers/skill-action-handler.js";

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
    // TODO: Add narrative generator injection when ActionService narration is implemented
    // See INarrativeGenerator in infrastructure/llm for the active narration interface
  ) {
    this.attackHandler = new AttackActionHandler(sessions, combat, combatants, events);
    this.grappleHandler = new GrappleActionHandler(sessions, combat, combatants, events);
    this.skillHandler = new SkillActionHandler(sessions, combat, combatants, events);
  }

  private async resolveActiveActorOrThrow(
    sessionId: string,
    input: { encounterId?: string; actor: CombatantRef; skipActionCheck?: boolean },
  ): Promise<{
    encounter: CombatEncounterRecord;
    combatants: CombatantStateRecord[];
    active: CombatantStateRecord;
    actorState: CombatantStateRecord;
  }> {
    const encounter = await resolveEncounterOrThrow(this.sessions, this.combat, sessionId, input.encounterId);
    const combatants = await this.combat.listCombatants(encounter.id);

    const active = combatants[encounter.turn] ?? null;
    if (!active) {
      throw new ValidationError(
        `Encounter turn index out of range: turn=${encounter.turn} combatants=${combatants.length}`,
      );
    }

    const actorState = findCombatantStateByRef(combatants, input.actor);
    if (!actorState) throw new NotFoundError("Actor not found in encounter");

    if (actorState.id !== active.id) {
      throw new ValidationError("It is not the actor's turn");
    }

    // Skip action check for bonus action abilities like Patient Defense
    if (!input.skipActionCheck && hasSpentAction(actorState.resources)) {
      throw new ValidationError("Actor has already spent their action this turn");
    }

    return { encounter, combatants, active, actorState };
  }

  private async performSimpleAction(
    sessionId: string,
    input: SimpleActionBaseInput,
    action: "Dodge" | "Dash" | "Disengage" | "CastSpell" | "Help",
    extra?: { target?: CombatantRef; spellName?: string },
  ): Promise<{ actor: CombatantStateRecord }> {
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
      updatedResources = { ...(updatedResources as any), dashed: true } as JsonValue;
    }
    
    const updatedActor = await this.combat.updateCombatantState(actorState.id, {
      resources: updatedResources,
    });

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

      // TODO: Re-enable action narration when INarrativeGenerator is wired to ActionService
      // See infrastructure/llm/narrative-generator.ts for the active implementation
    }

    return { actor: updatedActor };
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
    const encounter = await resolveEncounterOrThrow(this.sessions, this.combat, sessionId, input.encounterId);
    const combatants = await this.combat.listCombatants(encounter.id);

    const actor = findCombatantStateByRef(combatants, input.actor);
    if (!actor) throw new NotFoundError("Actor not found in encounter");

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

    // Detect opportunity attacks from leaving reach of enemies
    const opportunityAttacks: Array<{
      attackerId: string;
      targetId: string;
      canAttack: boolean;
      hasReaction: boolean;
    }> = [];

    // Check each combatant for opportunity attacks
    for (const other of combatants) {
      if (other.id === actor.id) continue; // Skip self
      if (other.hpCurrent <= 0) continue; // Skip unconscious/dead

      const otherResources = normalizeResources(other.resources);
      const otherPos = getPosition(otherResources);
      if (!otherPos) continue; // Skip if no position

      // Get reach (default 5ft, can be modified by polearms)
      const reachValue = otherResources.reach;
      const reach = typeof reachValue === "number" ? reachValue : 5;

      // Check if movement crosses through reach
      const crossesReach = crossesThroughReach(
        { from: currentPos, to: input.destination },
        otherPos,
        reach,
      );

      if (crossesReach) {
        const hasReaction = hasReactionAvailable(otherResources);
        const isDisengaged = readBoolean(resources, "disengaged") ?? false;
        
        // Check if observer is incapacitated (can't make opportunity attacks)
        const otherConditions = Array.isArray(other.conditions) ? (other.conditions as string[]) : [];
        const observerIncapacitated = otherConditions.some(
          (c) => typeof c === "string" && c.toLowerCase() === "incapacitated",
        );
        
        const canAttack = canMakeOpportunityAttack(
          { reactionUsed: !hasReaction },
          {
            movingCreatureId: actor.id,
            observerId: other.id,
            disengaged: isDisengaged,
            canSee: true, // Vision checks would require line-of-sight calculation
            observerIncapacitated,
            leavingReach: true,
          },
        );

        opportunityAttacks.push({
          attackerId: other.id,
          targetId: actor.id,
          canAttack: canAttack.canAttack,
          hasReaction,
        });
      }
    }

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

    // Execute opportunity attacks
    const executedAttacks: Array<{
      attackerId: string;
      targetId: string;
      result: unknown;
    }> = [];

    for (const opp of opportunityAttacks) {
      if (!opp.canAttack) continue; // Skip if can't attack

      const attacker = combatants.find(c => c.id === opp.attackerId);
      if (!attacker) continue;

      // Use the attacker's reaction
      const attackerResources = normalizeResources(attacker.resources);
      const updatedAttackerResources = useReaction(attackerResources);
      await this.combat.updateCombatantState(attacker.id, {
        resources: updatedAttackerResources as JsonValue,
      });

      // Get attacker's weapon/attack
      const attackerRef: CombatantRef = attacker.combatantType === "Character" && attacker.characterId
        ? { type: "Character", characterId: attacker.characterId }
        : attacker.combatantType === "Monster" && attacker.monsterId
        ? { type: "Monster", monsterId: attacker.monsterId }
        : attacker.combatantType === "NPC" && attacker.npcId
        ? { type: "NPC", npcId: attacker.npcId }
        : { type: "Character", characterId: "" }; // Fallback (shouldn't happen)

      const attackerStats = await this.combatants.getCombatStats(attackerRef);

      const targetStats = await this.combatants.getCombatStats(input.actor);

      // Build attack spec (use equipped weapon or default melee attack)
      let spec: AttackSpec | null = null;
      const equippedWeapon = attackerStats.equipment?.weapon;

      if (equippedWeapon) {
        // TODO: Parse weapon stats to build proper spec
        // For now, use basic melee attack
        const strMod = getAbilityModifier(attackerStats.abilityScores.strength);
        spec = {
          attackBonus: strMod + 2, // Proficiency bonus estimate
          damage: { diceCount: 1, diceSides: 6, modifier: strMod },
          kind: "melee",
        };
      } else if (attacker.combatantType === "Monster") {
        // Try to get monster's first melee attack
        const attacks = await this.combatants.getMonsterAttacks(attacker.monsterId!);
        const meleeAttack = attacks.find((a: any) => a.kind === "melee");
        if (meleeAttack && isRecord(meleeAttack)) {
          const attackBonus = readNumber(meleeAttack, "attackBonus");
          const dmg = isRecord(meleeAttack.damage) ? meleeAttack.damage : null;
          const diceCount = dmg ? readNumber(dmg, "diceCount") : null;
          const diceSides = dmg ? readNumber(dmg, "diceSides") : null;
          const modifierVal = dmg ? dmg.modifier : undefined;

          if (attackBonus !== null && diceCount !== null && diceSides !== null) {
            const modN = modifierVal === undefined ? 0 : typeof modifierVal === "number" ? modifierVal : 0;
            spec = {
              name: typeof meleeAttack.name === "string" ? meleeAttack.name : undefined,
              kind: "melee",
              attackBonus,
              damage: { diceCount, diceSides, modifier: modN },
            };
          }
        }
      }

      if (!spec) {
        // Default unarmed strike
        const strMod = getAbilityModifier(attackerStats.abilityScores.strength);
        spec = {
          name: "Unarmed Strike",
          attackBonus: strMod,
          damage: { diceCount: 1, diceSides: 4, modifier: strMod },
          kind: "melee",
        };
      }

      // Execute attack
      const seed = hashStringToInt32(
        `${sessionId}:${encounter.id}:opportunity:${opp.attackerId}:${opp.targetId}:${currentPos.x}:${currentPos.y}`,
      );
      const diceRoller = new SeededDiceRoller(seed);

      const attackerAdapter = buildCreatureAdapter({
        armorClass: attackerStats.armorClass,
        abilityScores: attackerStats.abilityScores,
        featIds: attackerStats.featIds,
        hpCurrent: attacker.hpCurrent,
      }).creature as any;

      const targetAdapter = buildCreatureAdapter({
        armorClass: targetStats.armorClass,
        abilityScores: targetStats.abilityScores,
        hpCurrent: updatedActor.hpCurrent,
      });

      const target = targetAdapter.creature as any;
      const attackResult = resolveAttack(diceRoller, attackerAdapter, target, spec);

      // Apply damage to moving actor
      const newHp = targetAdapter.getHpCurrent();
      await this.combat.updateCombatantState(actor.id, {
        hpCurrent: newHp,
      });

      // Apply KO effects if target dropped to 0 HP from opportunity attack
      await applyKoEffectsIfNeeded(updatedActor, updatedActor.hpCurrent, newHp, this.combat);

      executedAttacks.push({
        attackerId: opp.attackerId,
        targetId: opp.targetId,
        result: attackResult,
      });

      // Emit opportunity attack event
      if (this.events) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "OpportunityAttack",
          payload: {
            encounterId: encounter.id,
            attackerId: opp.attackerId,
            targetId: opp.targetId,
            attackName: spec.name || "Melee Attack",
            result: attackResult,
          },
        });

        if ((attackResult as any).hit && (attackResult as any).damage?.applied > 0) {
          await this.events.append(sessionId, {
            id: nanoid(),
            type: "DamageApplied",
            payload: {
              encounterId: encounter.id,
              target: input.actor,
              amount: (attackResult as any).damage.applied,
              hpCurrent: newHp,
            },
          });
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

    return { 
      actor: updatedActor,
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
