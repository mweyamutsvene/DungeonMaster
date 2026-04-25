import { nanoid } from "nanoid";

import { attemptHide, getPassivePerception } from "../../../../domain/rules/hide.js";
import { attemptSearch } from "../../../../domain/rules/search-use-object.js";
import { SeededDiceRoller } from "../../../../domain/rules/dice-roller.js";
import { getCoverLevel, hasLineOfSight, type CombatMap } from "../../../../domain/rules/combat-map.js";
import {
  normalizeConditions,
  hasCondition,
  addCondition,
  removeCondition,
  createCondition,
  type Condition,
} from "../../../../domain/entities/combat/conditions.js";
import {
  normalizeResources,
  spendAction,
  getPosition,
} from "../helpers/resource-utils.js";

import { NotFoundError, ValidationError } from "../../../errors.js";
import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { IEventRepository } from "../../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../../repositories/game-session-repository.js";
import type { CombatantStateRecord } from "../../../types.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { CombatantRef } from "../helpers/combatant-ref.js";
import { combatantRefFromState } from "../helpers/combatant-ref.js";

import {
  type HideActionInput,
  type SearchActionInput,
  getAbilityModifier,
  hashStringToInt32,
  abilityCheckEffectMods,
} from "../helpers/combat-utils.js";
import { resolveActiveActorOrThrow } from "../helpers/active-actor-resolver.js";

export class SkillActionHandler {
  constructor(
    private readonly sessions: IGameSessionRepository,
    private readonly combat: ICombatRepository,
    private readonly combatants: ICombatantResolver,
    private readonly events?: IEventRepository,
  ) {}

  private async resolveActiveActorOrThrow(
    sessionId: string,
    input: { encounterId?: string; actor: CombatantRef; skipActionCheck?: boolean },
  ) {
    return resolveActiveActorOrThrow(this.sessions, this.combat, sessionId, input);
  }

  async hide(sessionId: string, input: HideActionInput): Promise<{
    actor: CombatantStateRecord;
    result: {
      success: boolean;
      stealthRoll: number;
      reason?: string;
    };
  }> {
    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const { encounter, combatants, actorState } = await this.resolveActiveActorOrThrow(sessionId, {
      encounterId: input.encounterId,
      actor: input.actor,
      skipActionCheck: input.isBonusAction ?? input.skipActionCheck, // Skip action check if using bonus action
    });

    const seed =
      (input.seed as number | undefined) ??
      hashStringToInt32(
        `${sessionId}:${encounter.id}:${encounter.round}:${encounter.turn}:Hide:${JSON.stringify(input.actor)}`,
      );

    const actorStats = await this.combatants.getCombatStats(input.actor);

    // Get stealth modifier from skills if available, otherwise calculate from Dex + proficiency
    let stealthModifier: number;
    if (actorStats.skills?.stealth !== undefined) {
      // Use pre-calculated stealth modifier from character sheet
      stealthModifier = actorStats.skills.stealth;
    } else {
      // Calculate: Dex mod + proficiency bonus (assuming proficiency in Stealth)
      const dexMod = getAbilityModifier(actorStats.abilityScores.dexterity);
      stealthModifier = dexMod + actorStats.proficiencyBonus;
    }

    const dice = new SeededDiceRoller(seed);

    // ActiveEffect bonuses on ability checks (e.g., Guidance +1d4 on Stealth)
    const actorCheckMods = abilityCheckEffectMods(actorState.resources, dice, 'dexterity');

    const actorIsPC = input.actor.type === "Character" || input.actor.type === "NPC";
    const actorPosition = getPosition(actorState.resources ?? {});
    const map = encounter.mapData as CombatMap | undefined;

    const opposingCombatants = combatants.filter((combatant) => {
      if (combatant.id === actorState.id) return false;
      if (combatant.hpCurrent <= 0) return false;
      const otherIsPC = combatant.combatantType === "Character" || combatant.combatantType === "NPC";
      return actorIsPC !== otherIsPC;
    });

    let observerPassivePerception: number | undefined;
    let clearlyVisibleToAnyObserver = false;
    let hasAnyObserverWithoutClearSight = false;

    for (const observer of opposingCombatants) {
      const observerRef = combatantRefFromState(observer);
      if (!observerRef) continue;
      const observerConditions = normalizeConditions(observer.conditions);
      const observerIsBlinded = hasCondition(observerConditions, "Blinded");

      const observerStats = await this.combatants.getCombatStats(observerRef);
      const observerPassive = observerStats.passivePerception ?? getPassivePerception({
        skills: observerStats.skills as Record<string, number> | undefined,
        abilityScores: { wisdom: observerStats.abilityScores.wisdom },
      });

      if (observerPassivePerception === undefined || observerPassive > observerPassivePerception) {
        observerPassivePerception = observerPassive;
      }

      let observerHasLineOfSight = true;
      let observerHasCoverAgainstActor = false;
      const observerPosition = getPosition(observer.resources ?? {});

      if (observerIsBlinded) {
        observerHasLineOfSight = false;
      } else if (map && actorPosition && observerPosition) {
        observerHasLineOfSight = hasLineOfSight(map, observerPosition, actorPosition).visible;
        const coverLevel = getCoverLevel(map, observerPosition, actorPosition);
        observerHasCoverAgainstActor = coverLevel !== "none";
      }

      const observerClearlySeesActor = observerHasLineOfSight && !observerHasCoverAgainstActor;
      if (observerClearlySeesActor) {
        clearlyVisibleToAnyObserver = true;
      } else {
        hasAnyObserverWithoutClearSight = true;
      }
    }

    const hasCoverOrObscurement = opposingCombatants.length === 0
      ? (input.hasCover ?? true)
      : (hasAnyObserverWithoutClearSight || input.hasCover === true);
    const clearlyVisible = input.hasCover === true ? false : clearlyVisibleToAnyObserver;

    const hideResult = attemptHide(dice, {
      stealthModifier: stealthModifier + actorCheckMods.bonus,
      hasCoverOrObscurement,
      clearlyVisible,
      observerPassivePerception,
      mode: actorCheckMods.mode !== "normal" ? actorCheckMods.mode : undefined,
    });

    // Spend action (or bonus action was already spent before calling this)
    let updatedActor = actorState;
    if (!input.isBonusAction && !input.skipActionCheck) {
      updatedActor = await this.combat.updateCombatantState(actorState.id, {
        resources: spendAction(actorState.resources),
      });
    }

    // If hide succeeded, add Hidden condition
    if (hideResult.success) {
      let conditions = normalizeConditions(updatedActor.conditions);
      conditions = addCondition(conditions, createCondition("Hidden" as Condition, "until_removed"));
      updatedActor = await this.combat.updateCombatantState(updatedActor.id, {
        conditions: conditions as any,
        // Store stealth roll for later detection checks
        resources: { ...(updatedActor.resources as any ?? {}), stealthRoll: hideResult.stealthRoll },
      });
    }

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ActionResolved",
        payload: {
          encounterId: encounter.id,
          actor: input.actor,
          action: "Hide",
          success: hideResult.success,
          stealthRoll: hideResult.stealthRoll,
          reason: hideResult.reason,
        },
      });
    }

    return {
      actor: updatedActor,
      result: {
        success: hideResult.success,
        stealthRoll: hideResult.stealthRoll,
        reason: hideResult.reason,
      },
    };
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
    if (input.seed !== undefined && !Number.isInteger(input.seed)) {
      throw new ValidationError("seed must be an integer");
    }

    const { encounter, combatants, actorState } = await this.resolveActiveActorOrThrow(sessionId, {
      encounterId: input.encounterId,
      actor: input.actor,
      skipActionCheck: input.skipActionCheck,
    });

    const seed =
      (input.seed as number | undefined) ??
      hashStringToInt32(
        `${sessionId}:${encounter.id}:${encounter.round}:${encounter.turn}:Search:${JSON.stringify(input.actor)}`,
      );

    const actorStats = await this.combatants.getCombatStats(input.actor);

    // Get perception modifier from skills if available, otherwise calculate from Wis + proficiency
    let perceptionModifier: number;
    if (actorStats.skills?.perception !== undefined) {
      perceptionModifier = actorStats.skills.perception;
    } else {
      const wisMod = getAbilityModifier(actorStats.abilityScores.wisdom);
      perceptionModifier = wisMod + actorStats.proficiencyBonus;
    }

    const dice = new SeededDiceRoller(seed);

    // ActiveEffect bonuses on ability checks (e.g., Guidance +1d4 on Perception)
    const actorCheckMods = abilityCheckEffectMods(actorState.resources, dice, 'wisdom');

    const searchResult = attemptSearch(dice, {
      modifier: perceptionModifier + actorCheckMods.bonus,
      dc: 0, // We'll contest against each hidden creature's stealth
      checkType: "perception",
      mode: actorCheckMods.mode !== "normal" ? actorCheckMods.mode : undefined,
    });
    const perceptionRoll = searchResult.roll;

    // Find all Hidden combatants on the opposing faction
    const found: string[] = [];
    let updatedActor = actorState;

    const actorIsPC = input.actor.type === "Character" || input.actor.type === "NPC";

    for (const combatant of combatants) {
      // Skip self
      const combatantId = combatant.characterId ?? combatant.monsterId ?? combatant.npcId;
      const actorId = (input.actor as any).characterId ?? (input.actor as any).monsterId ?? (input.actor as any).npcId;
      if (combatantId === actorId) continue;

      // Only check opposing faction
      const otherIsPC = combatant.combatantType === "Character" || combatant.combatantType === "NPC";
      if (actorIsPC === otherIsPC) continue;

      // Check if this combatant is Hidden
      const conditions = normalizeConditions(combatant.conditions);
      const isHidden = conditions.some((c: any) => c.condition === "Hidden");
      if (!isHidden) continue;

      // Contest: perception roll vs. stealth DC (stored as stealthRoll on the hidden creature)
      const res = normalizeResources(combatant.resources);
      const stealthDC = typeof (res as any).stealthRoll === "number" ? (res as any).stealthRoll : 10;

      if (perceptionRoll >= stealthDC) {
        // Found! Remove Hidden condition
        const updatedConditions = removeCondition(conditions, "Hidden" as Condition);
        await this.combat.updateCombatantState(combatant.id, {
          conditions: updatedConditions as any,
        });
        const combatantName = combatantId ?? "creature";
        found.push(combatantName);
      }
    }

    // Spend action
    updatedActor = await this.combat.updateCombatantState(actorState.id, {
      resources: spendAction(actorState.resources),
    });

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "ActionResolved",
        payload: {
          encounterId: encounter.id,
          actor: input.actor,
          action: "Search",
          perceptionRoll,
          found,
        },
      });
    }

    return {
      actor: updatedActor,
      result: {
        found,
        roll: perceptionRoll,
      },
    };
  }
}
