/**
 * TabletopCombatService – Facade for tabletop-style combat with manual dice rolling.
 *
 * This thin facade owns the pending-action state machine and delegates to:
 *   - RollStateMachine   – initiative / attack / damage / death-save rolls
 *   - ActionDispatcher   – parseCombatAction routing + all action handlers
 *   - SpellActionHandler – spell casting flow
 *   - TabletopEventEmitter – narration + event emission
 *
 * Public API (unchanged):
 *   initiateAction(sessionId, text, actorId)
 *   processRollResult(sessionId, text, actorId)
 *   parseCombatAction(sessionId, text, actorId, encounterId)
 *   completeMove(sessionId, pendingActionId, roll?, rollType?)
 */

import { nanoid } from "nanoid";
import { ValidationError, NotFoundError } from "../../errors.js";
import {
  buildGameCommandSchemaHint,
  parseGameCommand,
} from "../../commands/game-command.js";
import { createCombatMap } from "../../../domain/rules/combat-map.js";
import { getPassivePerception, computeSurprise } from "../../../domain/rules/hide.js";
import type { SurpriseCreatureInfo } from "../../../domain/rules/hide.js";
import type { JsonValue } from "../../types.js";

// Re-export types from the new module so existing consumers don't break
export type {
  PendingActionType,
  SurpriseSpec,
  InitiatePendingAction,
  AttackPendingAction,
  DamagePendingAction,
  DeathSavePendingAction,
  SavingThrowPendingAction,
  SavingThrowAutoResult,
  SaveOutcome,
  HitRiderEnhancement,
  HitRiderEnhancementResult,
  TabletopPendingAction,
  WeaponSpec,
  RollRequest,
  CombatStartedResult,
  AttackResult,
  DamageResult,
  ActionParseResult,
  TabletopCombatServiceDeps,
} from "./tabletop/tabletop-types.js";

import type {
  TabletopCombatServiceDeps,
  SurpriseSpec,
  InitiatePendingAction,
  RollRequest,
  CombatStartedResult,
  AttackResult,
  DamageResult,
  DeathSaveResult,
  SavingThrowAutoResult,
  ActionParseResult,
} from "./tabletop/tabletop-types.js";

import { TabletopEventEmitter } from "./tabletop/tabletop-event-emitter.js";
import { combatantRefFromState } from "./helpers/combatant-ref.js";
import { RollStateMachine, loadRoster, type LoadRosterResult } from "./tabletop/roll-state-machine.js";
import { SpellActionHandler } from "./tabletop/spell-action-handler.js";
import { ActionDispatcher } from "./tabletop/action-dispatcher.js";
import { computeInitiativeModifiers } from "./tabletop/tabletop-utils.js";

// computeInitiativeModifiers imported from tabletop/tabletop-utils.ts (isCreatureSurprised used internally)

export class TabletopCombatService {
  private debugLogsEnabled: boolean;
  private readonly eventEmitter: TabletopEventEmitter;
  private readonly rollStateMachine: RollStateMachine;
  private readonly spellHandler: SpellActionHandler;
  private readonly actionDispatcher: ActionDispatcher;

  constructor(private readonly deps: TabletopCombatServiceDeps) {
    this.debugLogsEnabled =
      process.env.DM_DEBUG_LOGS === "1" ||
      process.env.DM_DEBUG_LOGS === "true" ||
      process.env.DM_DEBUG_LOGS === "yes";

    this.eventEmitter = new TabletopEventEmitter({
      combatRepo: deps.combatRepo,
      events: deps.events,
      narrativeGenerator: deps.narrativeGenerator,
      debugLogsEnabled: this.debugLogsEnabled,
    });

    this.rollStateMachine = new RollStateMachine(
      deps,
      this.eventEmitter,
      this.debugLogsEnabled,
    );

    this.spellHandler = new SpellActionHandler(
      deps,
      this.eventEmitter,
      this.debugLogsEnabled,
    );

    this.actionDispatcher = new ActionDispatcher(
      deps,
      this.eventEmitter,
      this.spellHandler,
      this.debugLogsEnabled,
    );
  }

  // ----- Public API -----

  /**
   * Initiate a combat action from natural language text.
   * Returns a roll request (typically for initiative).
   */
  async initiateAction(sessionId: string, text: string, actorId: string): Promise<RollRequest> {
    const { characters, monsters, npcs, roster } = await loadRoster(this.deps, sessionId);

    let command: any = null;
    if (this.deps.intentParser) {
      try {
        const intent = await this.deps.intentParser.parseIntent({
          text,
          schemaHint: buildGameCommandSchemaHint(roster),
        });
        command = parseGameCommand(intent);
      } catch {
        command = null;
      }
    }

    // Find or create encounter
    const encounters = await this.deps.combatRepo.listEncountersBySession(sessionId);
    let encounter = encounters.find((e: any) => e.status === "Active") ?? encounters[0];

    if (!encounter) {
      const encounterId = nanoid();
      const map = createCombatMap({
        id: `${encounterId}-map`,
        name: "Combat Arena",
        width: 100,
        height: 100,
        gridSize: 5,
      });
      encounter = await this.deps.combatRepo.createEncounter(sessionId, {
        id: encounterId,
        status: "Pending",
        round: 0,
        turn: 0,
        mapData: map as unknown as JsonValue,
      });
    }

    // Extract targets from text
    let intendedTargets: string[] = [];
    const textLower = text.toLowerCase();
    for (const monster of monsters) {
      if (textLower.includes(monster.name.toLowerCase())) {
        intendedTargets.push(monster.id);
      }
    }

    if (intendedTargets.length === 0 && command?.kind === "attack" && command?.target) {
      const targetId =
        command.target.type === "Character"
          ? command.target.characterId
          : command.target.type === "Monster"
            ? command.target.monsterId
            : command.target.npcId;
      intendedTargets = [targetId];
    }

    const intendedTarget = intendedTargets[0];

    // --- Resolve surprise from server-managed state ---
    // 1. Read surprise from encounter (set via PATCH /combat/surprise)
    // 2. If not set, auto-compute from creature Hidden conditions + Stealth vs Passive Perception
    let surprise: SurpriseSpec | undefined;
    if (encounter.surprise !== undefined && encounter.surprise !== null) {
      surprise = encounter.surprise as unknown as SurpriseSpec;
    } else {
      // Auto-compute surprise from creature states
      const creatureInfos: SurpriseCreatureInfo[] = [];

      for (const char of characters) {
        const sheet = char.sheet as any;
        const conditions = sheet?.conditions ?? [];
        const isHidden = Array.isArray(conditions) && conditions.some(
          (c: unknown) => (typeof c === "string" ? c : typeof c === "object" && c !== null && "condition" in c ? (c as any).condition : "") === "Hidden",
        );
        const stealthRoll = sheet?.resources?.stealthRoll as number | undefined;
        creatureInfos.push({
          id: char.id,
          side: "party",
          isHidden,
          stealthRoll,
          passivePerception: getPassivePerception(sheet ?? {}),
        });
      }

      for (const monster of monsters) {
        const statBlock = monster.statBlock as any;
        const conditions = statBlock?.conditions ?? [];
        const isHidden = Array.isArray(conditions) && conditions.some(
          (c: unknown) => (typeof c === "string" ? c : typeof c === "object" && c !== null && "condition" in c ? (c as any).condition : "") === "Hidden",
        );
        const stealthRoll = statBlock?.resources?.stealthRoll as number | undefined;
        creatureInfos.push({
          id: monster.id,
          side: "enemy",
          isHidden,
          stealthRoll,
          passivePerception: getPassivePerception(statBlock ?? {}),
        });
      }

      for (const npc of npcs) {
        const statBlock = npc.statBlock as any;
        const conditions = statBlock?.conditions ?? [];
        const isHidden = Array.isArray(conditions) && conditions.some(
          (c: unknown) => (typeof c === "string" ? c : typeof c === "object" && c !== null && "condition" in c ? (c as any).condition : "") === "Hidden",
        );
        const stealthRoll = statBlock?.resources?.stealthRoll as number | undefined;
        creatureInfos.push({
          id: npc.id,
          side: "party",
          isHidden,
          stealthRoll,
          passivePerception: getPassivePerception(statBlock ?? {}),
        });
      }

      const surprisedIds = computeSurprise(creatureInfos);
      if (surprisedIds) {
        surprise = { surprised: surprisedIds };
        // Store auto-computed surprise on encounter
        await this.deps.combatRepo.updateEncounter(encounter.id, { surprise: surprise as unknown as JsonValue });
      }
    }

    const pendingAction: InitiatePendingAction = {
      type: "INITIATIVE",
      timestamp: new Date(),
      actorId,
      initiator: actorId,
      intendedTarget,
      intendedTargets,
      ...(surprise ? { surprise } : {}),
    };

    await this.deps.combatRepo.setPendingAction(encounter.id, pendingAction);

    // Resolve names for narrative
    const actorChar = characters.find((c) => c.id === actorId);
    const actorName = actorChar?.name ?? "The adventurer";
    const targetCreature = monsters.find((m) => m.id === intendedTarget) ?? npcs.find((n) => n.id === intendedTarget);
    const targetName = targetCreature?.name ?? "the enemy";

    const narration = await this.eventEmitter.generateNarration("initiativeRequest", {
      actorName,
      targetName,
    });

    // Compute initiative advantage/disadvantage for the initiating player
    const actorSheet = actorChar?.sheet as any;
    const actorClassName = (actorSheet?.className ?? "") as string;
    const actorLevel = (actorSheet?.level ?? 0) as number;
    const initModifiers = computeInitiativeModifiers(
      actorId, surprise, "party",
      actorSheet?.conditions,
      actorClassName ? { className: actorClassName, level: actorLevel } : undefined,
    );

    const rollRequest: RollRequest = {
      requiresPlayerInput: true,
      type: "REQUEST_ROLL",
      rollType: "initiative",
      message: initModifiers.disadvantage
        ? "Roll for initiative with disadvantage! (2d20 take lowest + DEX modifier)"
        : initModifiers.advantage
          ? "Roll for initiative with advantage! (2d20 take highest + DEX modifier)"
          : "Roll for initiative! (d20 + your DEX modifier)",
      narration,
      diceNeeded: initModifiers.advantage || initModifiers.disadvantage ? "2d20" : "d20",
      pendingAction,
    };
    if (initModifiers.advantage) rollRequest.advantage = true;
    if (initModifiers.disadvantage) rollRequest.disadvantage = true;

    return rollRequest;
  }

  /**
   * Process a roll result (initiative, attack, damage, death save, or saving throw).
   * Delegates to RollStateMachine.
   * SAVING_THROW actions are auto-resolved (no player roll needed).
   */
  async processRollResult(
    sessionId: string,
    text: string,
    actorId: string,
  ): Promise<CombatStartedResult | AttackResult | DamageResult | DeathSaveResult | SavingThrowAutoResult> {
    const preloaded = await loadRoster(this.deps, sessionId);
    return this.rollStateMachine.processRollResult(sessionId, text, actorId, preloaded);
  }

  /**
   * Parse a combat action from text (move, attack, bonus action, spell, etc.).
   * Delegates to ActionDispatcher.
   */
  async parseCombatAction(
    sessionId: string,
    text: string,
    actorId: string,
    encounterId: string,
  ): Promise<ActionParseResult> {
    const preloaded = await loadRoster(this.deps, sessionId);
    return this.actionDispatcher.dispatch(sessionId, text, actorId, encounterId, preloaded);
  }

  /**
   * Complete a move after reaction resolution.
   * Accepts optional roll data for player opportunity attacks.
   */
  async completeMove(
    sessionId: string,
    pendingActionId: string,
    roll?: number,
    rollType?: string,
  ): Promise<ActionParseResult> {
    const pendingAction = await this.deps.pendingActions.getById(pendingActionId);
    if (!pendingAction) {
      // Pending action was already consumed by reaction auto-complete — return graceful response
      return {
        success: true,
        requiresPlayerInput: false,
        actionComplete: true,
        type: "MOVE_COMPLETE",
        message: "Move already completed.",
      };
    }

    // Check for player OAs needing rolls
    const combatants = await this.deps.combatRepo.listCombatants(pendingAction.encounterId);
    const playerOAs = pendingAction.resolvedReactions
      .filter((r: any) => r.choice === "use")
      .filter((r: any) => {
        const combatant = combatants.find((c) => c.id === r.combatantId);
        return combatant?.combatantType === "Character";
      });

    // Find OAs that still need rolls (either attack roll or damage roll).
    // Spell OA reactions (War Caster) are auto-resolved by the server — skip them.
    const playerOAsAwaitingRolls = playerOAs.filter((r: any) => {
      const opp = pendingAction.reactionOpportunities.find(
        (o: any) => o.id === r.opportunityId,
      );
      if (opp?.oaType === "spell") return false;
      if (!r.result || !r.result.attackRoll) return true;
      if (r.result.hit === true && !r.result.damageRoll) return true;
      return false;
    });

    if (playerOAsAwaitingRolls.length > 0) {
      const nextOA = playerOAsAwaitingRolls[0] as any;
      const needsDamage = nextOA.result?.hit === true && !nextOA.result.damageRoll;

      if (roll !== undefined) {
        if (rollType === "opportunity_attack" && !needsDamage) {
          // Process attack roll — resolve stats via combatantRefFromState
          const target = combatants.find((c) => {
            const ref = combatantRefFromState(c);
            if (!ref) return false;
            const actorRef = pendingAction.actor as any;
            return (
              (actorRef.type === "Character" && ref.type === "Character" && ref.characterId === actorRef.characterId) ||
              (actorRef.type === "Monster" && ref.type === "Monster" && ref.monsterId === actorRef.monsterId) ||
              (actorRef.type === "NPC" && ref.type === "NPC" && ref.npcId === actorRef.npcId)
            );
          });

          const attacker = combatants.find((c) => c.id === nextOA.combatantId);
          const attackMod = await this.resolveOAAttackModifier(attacker);

          const totalAttack = roll + attackMod;
          let targetAC = 10;
          if (target) {
            const targetRef = combatantRefFromState(target);
            if (targetRef) {
              const targetStats = await this.deps.combatants.getCombatStats(targetRef);
              targetAC = targetStats.armorClass;
            }
          }
          const hit = totalAttack >= targetAC;

          nextOA.result = { attackRoll: roll, totalAttack, hit };
          await this.deps.pendingActions.updateReactionResult(pendingActionId, nextOA.opportunityId, nextOA.result);

          if (hit) {
            return {
              requiresPlayerInput: true,
              type: "REQUEST_ROLL",
              rollType: "opportunity_attack_damage",
              pendingActionId,
              diceNeeded: "1d8",
              message: `Opportunity attack hits (${roll}+${attackMod}=${totalAttack} vs AC ${targetAC})! Roll damage.`,
              actionComplete: false,
            };
          } else {
            return this.completeMove(sessionId, pendingActionId);
          }
        } else if (rollType === "opportunity_attack_damage" && needsDamage) {
          // Process damage roll
          const attacker = combatants.find((c) => c.id === nextOA.combatantId);
          const damageMod = await this.resolveOADamageModifier(attacker);

          const totalDamage = roll + damageMod;
          nextOA.result = { ...nextOA.result, damageRoll: roll, totalDamage };
          await this.deps.pendingActions.updateReactionResult(pendingActionId, nextOA.opportunityId, nextOA.result);

          return this.completeMove(sessionId, pendingActionId);
        }
      }

      // No roll provided or wrong type - request the appropriate roll
      if (needsDamage) {
        return {
          requiresPlayerInput: true,
          type: "REQUEST_ROLL",
          rollType: "opportunity_attack_damage",
          pendingActionId,
          diceNeeded: "1d8",
          message: "Opportunity attack hit! Roll damage.",
          actionComplete: false,
        };
      }

      return {
        requiresPlayerInput: true,
        type: "REQUEST_ROLL",
        rollType: "opportunity_attack",
        pendingActionId,
        diceNeeded: "d20",
        message: "Opportunity attack! Roll d20.",
        actionComplete: false,
      };
    }

    const result = await this.deps.twoPhaseActions.completeMove(sessionId, { pendingActionId });
    await this.deps.combatRepo.clearPendingAction(pendingAction.encounterId);

    // Handle monster/NPC turn advancement
    const actorCombatant = combatants.find((c) => {
      const ref = combatantRefFromState(c);
      if (!ref) return false;
      const actorRef = pendingAction.actor as any;
      return (
        (actorRef.type === "Character" && ref.type === "Character" && ref.characterId === actorRef.characterId) ||
        (actorRef.type === "Monster" && ref.type === "Monster" && ref.monsterId === actorRef.monsterId) ||
        (actorRef.type === "NPC" && ref.type === "NPC" && ref.npcId === actorRef.npcId)
      );
    });

    const isMonsterOrNpc = actorCombatant && (actorCombatant.combatantType === "Monster" || actorCombatant.combatantType === "NPC");

    if (isMonsterOrNpc) {
      await this.deps.combat.nextTurn(sessionId, { encounterId: pendingAction.encounterId, skipDeathSaveAutoRoll: true });
      if (this.deps.aiOrchestrator) {
        void this.deps.aiOrchestrator.processAllMonsterTurns(sessionId, pendingAction.encounterId).catch(console.error);
      }
    }

    return {
      success: true,
      requiresPlayerInput: false,
      actionComplete: true,
      type: "MOVE_COMPLETE",
      to: result.to,
      movedTo: result.to,
      message: `Movement complete. Now at (${result.to.x}, ${result.to.y}).`,
    };
  }

  /**
   * Compute attack modifier for a player opportunity attack.
   * Uses proficiency + max(STR, DEX) from full combat stats.
   */
  private async resolveOAAttackModifier(
    attacker: { combatantType?: string; characterId?: string | null; monsterId?: string | null; npcId?: string | null } | undefined,
  ): Promise<number> {
    if (!attacker) return 0;
    const ref = combatantRefFromState(attacker as any);
    if (!ref) return 0;
    const stats = await this.deps.combatants.getCombatStats(ref);
    const strMod = Math.floor((stats.abilityScores.strength - 10) / 2);
    const dexMod = Math.floor((stats.abilityScores.dexterity - 10) / 2);
    return stats.proficiencyBonus + Math.max(strMod, dexMod);
  }

  /**
   * Compute damage modifier for a player opportunity attack.
   * Uses max(STR, DEX) from full combat stats.
   */
  private async resolveOADamageModifier(
    attacker: { combatantType?: string; characterId?: string | null; monsterId?: string | null; npcId?: string | null } | undefined,
  ): Promise<number> {
    if (!attacker) return 0;
    const ref = combatantRefFromState(attacker as any);
    if (!ref) return 0;
    const stats = await this.deps.combatants.getCombatStats(ref);
    const strMod = Math.floor((stats.abilityScores.strength - 10) / 2);
    const dexMod = Math.floor((stats.abilityScores.dexterity - 10) / 2);
    return Math.max(strMod, dexMod);
  }
}
