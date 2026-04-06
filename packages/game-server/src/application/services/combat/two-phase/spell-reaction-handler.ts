/**
 * SpellReactionHandler — initiateSpellCast() + completeSpellCast() for two-phase spells.
 *
 * Extracted from TwoPhaseActionService (Phase: God-Module Decomposition §4b).
 */

import { nanoid } from "nanoid";
import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { IEventRepository, ReactionPromptEventPayload } from "../../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../../repositories/game-session-repository.js";
import type { PendingActionRepository } from "../../../repositories/pending-action-repository.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { CombatantRef } from "../helpers/combatant-ref.js";
import type { Position } from "../../../../domain/rules/movement.js";
import type {
  PendingAction,
  ReactionOpportunity,
  ReactionResponse,
  PendingSpellCastData,
} from "../../../../domain/entities/combat/pending-action.js";
import { calculateDistance } from "../../../../domain/rules/movement.js";
import { hasReactionAvailable } from "../../../../domain/rules/opportunity-attack.js";
import { getSpellcastingAbility } from "../../../../domain/rules/spell-casting.js";
import { resolveEncounterOrThrow } from "../helpers/encounter-resolver.js";
import { findCombatantStateByRef } from "../helpers/combatant-ref.js";
import { ValidationError, NotFoundError } from "../../../errors.js";
import {
  normalizeResources,
  getPosition,
} from "../helpers/resource-utils.js";
import { detectSpellReactions } from "../../../../domain/entities/classes/combat-text-profile.js";
import { getAllCombatTextProfiles } from "../../../../domain/entities/classes/registry.js";
import type { JsonValue } from "../../../types.js";

export class SpellReactionHandler {
  constructor(
    private readonly sessions: IGameSessionRepository,
    private readonly combat: ICombatRepository,
    private readonly combatants: ICombatantResolver,
    private readonly pendingActions: PendingActionRepository,
    private readonly events?: IEventRepository,
  ) {}

  /**
   * Phase 1: Initiate spell cast, detect counterspell opportunities.
   */
  async initiate(sessionId: string, input: {
    encounterId?: string;
    actor: CombatantRef;
    spellName: string;
    spellLevel: number;
    target?: CombatantRef;
    targetPosition?: Position;
  }): Promise<{
    status: "no_reactions" | "awaiting_reactions";
    pendingActionId?: string;
    counterspellOpportunities: Array<{
      combatantId: string;
      combatantName: string;
      canUse: boolean;
      hasReaction: boolean;
      hasSpellSlot: boolean;
    }>;
  }> {
    const encounter = await resolveEncounterOrThrow(this.sessions, this.combat, sessionId, input.encounterId);
    const combatants = await this.combat.listCombatants(encounter.id);

    const actor = findCombatantStateByRef(combatants, input.actor);
    if (!actor) throw new NotFoundError("Actor not found in encounter");

    // Check for counterspell opportunities
    const counterspellOpportunities: Array<{
      combatantId: string;
      combatantName: string;
      canUse: boolean;
      hasReaction: boolean;
      hasSpellSlot: boolean;
    }> = [];

    const reactionOpportunities: ReactionOpportunity[] = [];

    for (const other of combatants) {
      if (other.id === actor.id) continue;
      if (other.hpCurrent <= 0) continue;

      const otherResources = normalizeResources(other.resources);
      const hasReaction = hasReactionAvailable({ reactionUsed: false, ...otherResources } as any);

      if (!hasReaction) continue;

      const otherRef: CombatantRef = other.characterId
        ? { type: "Character", characterId: other.characterId }
        : other.monsterId
          ? { type: "Monster", monsterId: other.monsterId }
          : { type: "NPC", npcId: other.npcId ?? "" };

      let otherStats: { className?: string; level?: number; abilityScores?: Record<string, number>; proficiencyBonus?: number } | null = null;
      try {
        otherStats = await this.combatants.getCombatStats(otherRef);
      } catch { continue; }

      const actorPos = getPosition(normalizeResources(actor.resources));
      const otherPos = getPosition(otherResources);
      const distance = (actorPos && otherPos) ? calculateDistance(actorPos, otherPos) : 30;

      const spellDetectionInput = {
        className: otherStats.className?.toLowerCase() ?? "",
        level: otherStats.level ?? 1,
        abilityScores: (otherStats.abilityScores ?? {}) as Record<string, number>,
        resources: otherResources,
        hasReaction,
        isCharacter: other.combatantType === "Character",
        spellName: input.spellName,
        spellLevel: input.spellLevel,
        casterId: actor.id,
        distance,
      };

      const detectedReactions = detectSpellReactions(spellDetectionInput, getAllCombatTextProfiles());
      if (detectedReactions.length === 0) continue;

      for (const detected of detectedReactions) {
        const otherName = await this.combatants.getName(otherRef, other);

        counterspellOpportunities.push({
          combatantId: other.id,
          combatantName: otherName,
          canUse: true,
          hasReaction,
          hasSpellSlot: true,
        });

        reactionOpportunities.push({
          id: nanoid(),
          combatantId: other.id,
          reactionType: "counterspell",
          canUse: true,
          context: {
            ...detected.context,
            spellName: input.spellName,
            spellLevel: input.spellLevel,
            casterId: actor.id,
          },
        });
      }
    }

    // If no reactions possible, return immediately
    if (reactionOpportunities.length === 0) {
      return {
        status: "no_reactions",
        counterspellOpportunities,
      };
    }

    // Create pending action
    const pendingActionId = nanoid();
    const spellData: PendingSpellCastData = {
      type: "spell_cast",
      spellName: input.spellName,
      spellLevel: input.spellLevel,
      target: input.target,
      targetPosition: input.targetPosition,
    };

    const pendingAction: PendingAction = {
      id: pendingActionId,
      encounterId: encounter.id,
      actor: input.actor,
      type: "spell_cast",
      data: spellData,
      reactionOpportunities,
      resolvedReactions: [],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    };

    await this.pendingActions.create(pendingAction);

    // Emit reaction prompts
    if (this.events) {
      const actorName = await this.combatants.getName(input.actor, actor);

      for (const opp of reactionOpportunities) {
        const payload: ReactionPromptEventPayload = {
          encounterId: encounter.id,
          pendingActionId,
          combatantId: opp.combatantId,
          reactionOpportunity: opp,
          actor: input.actor,
          actorName,
          expiresAt: pendingAction.expiresAt.toISOString(),
        };

        await this.events.append(sessionId, {
          id: nanoid(),
          type: "ReactionPrompt",
          payload,
        });
      }
    }

    return {
      status: "awaiting_reactions",
      pendingActionId,
      counterspellOpportunities,
    };
  }

  /**
   * Phase 2: Complete spell cast after counterspell resolution.
   */
  async complete(sessionId: string, input: {
    pendingActionId: string;
    diceRoller?: { rollDie(sides: number, count?: number, modifier?: number): { total: number; rolls: number[] } };
  }): Promise<{
    wasCountered: boolean;
    counterspells: Array<{
      casterId: string;
      casterName: string;
      success: boolean;
      abilityCheckDC?: number;
      abilityCheckRoll?: number;
    }>;
  }> {
    const pendingAction = await this.pendingActions.getById(input.pendingActionId);
    if (!pendingAction) {
      throw new NotFoundError(`Pending action not found: ${input.pendingActionId}`);
    }

    if (pendingAction.type !== "spell_cast") {
      throw new ValidationError("Pending action is not a spell cast");
    }

    const encounter = await this.combat.getEncounterById(pendingAction.encounterId);
    if (!encounter) throw new NotFoundError("Encounter not found");

    const combatants = await this.combat.listCombatants(encounter.id);

    // Resolve each counterspell attempt
    const counterspells: Array<{
      casterId: string;
      casterName: string;
      success: boolean;
      abilityCheckDC?: number;
      abilityCheckRoll?: number;
    }> = [];

    for (const resolved of pendingAction.resolvedReactions) {
      if (resolved.choice !== "use") continue;

      const opp = pendingAction.reactionOpportunities.find(
        (o) => o.id === resolved.opportunityId && o.reactionType === "counterspell",
      );
      if (!opp) continue;

      const counterspellerState = combatants.find((c) => c.id === opp.combatantId);
      if (!counterspellerState) continue;

      const counterspellerName = await this.combatants.getName(
        counterspellerState.characterId
          ? { type: "Character", characterId: counterspellerState.characterId }
          : { type: "Monster", monsterId: counterspellerState.monsterId ?? "" },
        counterspellerState,
      );

      const slotToSpend = typeof opp.context.slotToSpend === "string" ? opp.context.slotToSpend : "spellSlot_3";
      const targetSpellLevel = (pendingAction.data as PendingSpellCastData).spellLevel;

      // D&D 5e 2024 Counterspell mechanic:
      // Determine the level at which Counterspell is being cast from the slot spent
      const counterspellLevel = slotToSpend.startsWith("spellSlot_")
        ? parseInt(slotToSpend.replace("spellSlot_", ""), 10) || 3
        : 3;

      let success: boolean;
      let abilityCheckDC: number | undefined;
      let abilityCheckTotal: number | undefined;

      if (counterspellLevel >= targetSpellLevel) {
        // Auto-counter: Counterspell level >= target spell level
        success = true;
      } else {
        // Counterspeller makes a spellcasting ability check
        // DC = 10 + target spell's level
        abilityCheckDC = 10 + targetSpellLevel;

        let spellcastingMod = 0;
        if (input.diceRoller) {
          try {
            const csRef = counterspellerState.characterId
              ? { type: "Character" as const, characterId: counterspellerState.characterId }
              : { type: "Monster" as const, monsterId: counterspellerState.monsterId ?? "" };
            const csStats = await this.combatants.getCombatStats(csRef);
            // Use the counterspeller's spellcasting ability modifier + proficiency
            const spellcastingAbility = getSpellcastingAbility(csStats.className);
            const abilityScore = (csStats.abilityScores as Record<string, number>)?.[spellcastingAbility] ?? 10;
            const abilityMod = Math.floor((abilityScore - 10) / 2);
            const profBonus = csStats.proficiencyBonus ?? 2;
            spellcastingMod = abilityMod + profBonus;
          } catch { /* default 0 */ }

          const checkRoll = input.diceRoller.rollDie(20);
          abilityCheckTotal = checkRoll.total + spellcastingMod;
          success = abilityCheckTotal >= abilityCheckDC;
        } else {
          // No dice roller — default to failure (conservative)
          abilityCheckTotal = 10;
          success = abilityCheckTotal >= abilityCheckDC;
        }
      }

      counterspells.push({
        casterId: opp.combatantId,
        casterName: counterspellerName,
        success,
        abilityCheckDC,
        abilityCheckRoll: abilityCheckTotal,
      });

      // Spend the counterspeller's spell slot and mark reaction used
      if (counterspellerState) {
        const { spendResourceFromPool } = await import("../helpers/resource-utils.js");
        const csResources = normalizeResources(counterspellerState.resources);
        let updatedResources: JsonValue;
        try {
          updatedResources = spendResourceFromPool(counterspellerState.resources, slotToSpend, 1);
        } catch {
          updatedResources = counterspellerState.resources as JsonValue;
        }
        const normalizedUpdated = normalizeResources(updatedResources);
        await this.combat.updateCombatantState(counterspellerState.id, {
          resources: { ...normalizedUpdated, reactionUsed: true } as JsonValue,
        });
      }

      // Emit Counterspell event
      if (this.events) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "Counterspell",
          payload: {
            encounterId: encounter.id,
            counterspellerId: opp.combatantId,
            counterspellerName,
            targetSpell: (pendingAction.data as PendingSpellCastData).spellName,
            counterspellLevel,
            targetSpellLevel,
            abilityCheckDC,
            abilityCheckRoll: abilityCheckTotal,
            success,
          },
        });
      }

      // If one counterspell succeeds, spell is countered — stop checking
      if (success) break;
    }

    const wasCountered = counterspells.some((c) => c.success);

    // Mark as completed
    await this.pendingActions.markCompleted(input.pendingActionId);
    await this.pendingActions.delete(input.pendingActionId);

    return {
      wasCountered,
      counterspells,
    };
  }
}
