/**
 * AiTurnOrchestrator - Orchestrates AI combatant turns using LLM for decisions.
 *
 * Layer: Application
 * Responsibility: Process AI turns by coordinating context building, decision making, and action execution.
 * Formerly MonsterAIService, renamed to reflect that it handles all AI-controlled combatants
 * (Monsters, NPCs, and AI-controlled Characters).
 */

import type {
  ICombatRepository,
  ICharacterRepository,
  IMonsterRepository,
  INPCRepository,
  IEventRepository,
} from "../../../repositories/index.js";
import type { PendingActionRepository } from "../../../repositories/pending-action-repository.js";
import type { CombatEncounterRecord, CombatantStateRecord } from "../../../types.js";
import type { ActionService } from "../action-service.js";
import type { CombatService } from "../combat-service.js";
import type { FactionService } from "../helpers/faction-service.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { AbilityRegistry } from "../abilities/ability-registry.js";
import { TwoPhaseActionService } from "../two-phase-action-service.js";
import { nanoid } from "nanoid";
import type { IAiDecisionMaker, AiDecision, TurnStepResult, ActorRef } from "./ai-types.js";
import type { DiceRoller } from "../../../../domain/rules/dice-roller.js";
import { buildActorRef as buildActorRefShared } from "./build-actor-ref.js";
import { AiContextBuilder } from "./ai-context-builder.js";
import { AiActionExecutor } from "./ai-action-executor.js";
import { readConditionNames } from "../../../../domain/entities/combat/conditions.js";
import { normalizeResources, setAttacksAllowed, getActiveEffects } from "../helpers/resource-utils.js";
import { isLegendaryCreature as isLegendaryCreatureCheck } from "../helpers/resource-utils.js";
import { spendLegendaryAction as spendLegendaryActionCharges } from "../helpers/resource-utils.js";
import { chooseLegendaryAction, type LegendaryActionDecision } from "./legendary-action-handler.js";
import type { BattlePlanService } from "./battle-plan-service.js";
import { DeterministicAiDecisionMaker } from "./deterministic-ai.js";
import { ClassFeatureResolver } from "../../../../domain/entities/classes/class-feature-resolver.js";
import { getNpcMechanicsSource } from "../helpers/class-backed-actor.js";
import {
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
  calculateBonusFromEffects,
  getDamageDefenseEffects,
} from "../../../../domain/entities/combat/effects.js";
import { normalizeConditions } from "../../../../domain/entities/combat/conditions.js";
import { deriveRollModeFromConditions } from "../tabletop/combat-text-parser.js";
import { applyDamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import { applyKoEffectsIfNeeded } from "../helpers/ko-handler.js";
import { breakConcentration, getConcentrationSpellName } from "../helpers/concentration-helper.js";

/**
 * LLM-driven tactical decision-making for AI-controlled combatants.
 * Handles Monsters, NPCs, and AI-controlled Characters.
 *
 * Layer: Application.
 * Notes: Uses faction-based ally/enemy determination. LLM is optional and must not decide rules.
 */
export class AiTurnOrchestrator {
  private readonly aiDebugEnabled =
    process.env.DM_AI_DEBUG === "1" ||
    process.env.DM_AI_DEBUG === "true" ||
    process.env.DM_AI_DEBUG === "yes";

  /** Tracks combatants we've already narrated as "downed" to avoid repeat messages */
  private readonly downedSkipNarrated = new Set<string>();

  /** Tracks encounters currently being processed by processAllMonsterTurns to prevent concurrent races */
  private readonly _inFlight = new Set<string>();

  /** Extracted context builder */
  private readonly contextBuilder: AiContextBuilder;

  /** Extracted action executor */
  private readonly actionExecutor: AiActionExecutor;

  /** Deterministic fallback AI for when LLM is unavailable or returns null */
  private readonly deterministicAi: DeterministicAiDecisionMaker = new DeterministicAiDecisionMaker();

  private aiLog(...args: unknown[]): void {
    if (this.aiDebugEnabled) console.log(...args);
  }

  constructor(
    private readonly combat: ICombatRepository,
    private readonly characters: ICharacterRepository,
    private readonly monsters: IMonsterRepository,
    private readonly npcs: INPCRepository,
    private readonly factionService: FactionService,
    private readonly actionService: ActionService,
    private readonly combatService: CombatService,
    private readonly combatantResolver: ICombatantResolver,
    private readonly abilityRegistry: AbilityRegistry,
    private readonly twoPhaseActions: TwoPhaseActionService,
    private readonly pendingActions: PendingActionRepository,
    private readonly diceRoller?: DiceRoller,
    private readonly aiDecisionMaker?: IAiDecisionMaker,
    private readonly events?: IEventRepository,
    private readonly battlePlanService?: BattlePlanService,
  ) {
    // Initialize extracted collaborators
    this.contextBuilder = new AiContextBuilder(
      characters,
      monsters,
      npcs,
      factionService,
      combatantResolver,
    );

    this.actionExecutor = new AiActionExecutor(
      actionService,
      twoPhaseActions,
      combat,
      pendingActions,
      combatantResolver,
      abilityRegistry,
      this.aiDecideReaction.bind(this),
      this.aiLog.bind(this),
      diceRoller,
      events,
      characters, // for spell slot + concentration bookkeeping
      monsters,   // for AI spell delivery (damage, saves, etc.)
      npcs,       // for AI spell delivery (damage, saves, etc.)
    );
  }

  /**
   * AI decides whether to use a reaction (Opportunity Attack, Shield, Counterspell, etc.)
   * This allows tactical decision-making: save reaction for Shield spell, ignore low-value targets, etc.
   */
  private async aiDecideReaction(
    combatantState: CombatantStateRecord,
    reactionType: "opportunity_attack" | "shield_spell" | "counterspell" | "other",
    context: { targetName?: string; spellName?: string; spellLevel?: number; hpPercent?: number; attackTotal?: number; currentAC?: number },
  ): Promise<boolean> {
    // Opportunity Attacks: Always use if healthy, skip if below 25% HP
    if (reactionType === "opportunity_attack") {
      const hpPercent = combatantState.hpCurrent / combatantState.hpMax;
      if (hpPercent < 0.25) {
        this.aiLog(
          `[AI Reaction] ${combatantState.id} declining OA - low HP (${Math.round(hpPercent * 100)}%)`,
        );
        return false;
      }
      this.aiLog(`[AI Reaction] ${combatantState.id} using OA on ${context.targetName}`);
      return true;
    }

    // Shield: only use if the attack would hit without Shield but miss with it
    // Shield grants +5 AC until next turn, so only worth using if attackTotal > currentAC
    // and attackTotal <= currentAC + 5 (otherwise Shield won't help)
    if (reactionType === "shield_spell") {
      const { attackTotal, currentAC } = context;
      if (attackTotal !== undefined && currentAC !== undefined) {
        const wouldHitWithout = attackTotal >= currentAC;
        const wouldMissWith = attackTotal < currentAC + 5;
        if (!wouldHitWithout) {
          // Attack already misses — don't waste Shield
          this.aiLog(
            `[AI Reaction] ${combatantState.id} declining Shield - attack ${attackTotal} already misses AC ${currentAC}`,
          );
          return false;
        }
        if (!wouldMissWith) {
          // Attack is too high — Shield +5 AC won't save us
          this.aiLog(
            `[AI Reaction] ${combatantState.id} declining Shield - attack ${attackTotal} exceeds AC ${currentAC} + 5`,
          );
          return false;
        }
        this.aiLog(
          `[AI Reaction] ${combatantState.id} using Shield - attack ${attackTotal} vs AC ${currentAC}, Shield brings AC to ${currentAC + 5}`,
        );
        return true;
      }
      // No attack info available — use Shield defensively (conservative)
      this.aiLog(`[AI Reaction] ${combatantState.id} using Shield (no attack roll info available)`);
      return true;
    }

    // Counterspell: context-aware decision based on spell level and remaining slots
    if (reactionType === "counterspell") {
      const spellLevel = typeof context.spellLevel === "number" ? context.spellLevel : 0;

      // Never counter cantrips — waste of a reaction and spell slot
      if (spellLevel === 0) {
        this.aiLog(`[AI Reaction] ${combatantState.id} NOT counterspelling cantrip ${context.spellName}`);
        return false;
      }

      // Always counter high-level spells (3+)
      if (spellLevel >= 3) {
        this.aiLog(`[AI Reaction] ${combatantState.id} counterspelling L${spellLevel} ${context.spellName}`);
        return true;
      }

      // For low-level spells (1-2), counter if creature has 2+ spell slots remaining
      const resources = combatantState.resources as Record<string, unknown> | undefined;
      const resourcePools = (resources?.resourcePools ?? []) as Array<{ name: string; current: number; max: number }>;
      const totalSlotsRemaining = resourcePools
        .filter((p) => p.name.startsWith("spellSlot_") || p.name === "pactMagic")
        .reduce((sum, p) => sum + (typeof p.current === "number" ? p.current : 0), 0);

      if (totalSlotsRemaining >= 2) {
        this.aiLog(
          `[AI Reaction] ${combatantState.id} counterspelling L${spellLevel} ${context.spellName} (${totalSlotsRemaining} slots remaining)`,
        );
        return true;
      }

      // Only 1 slot left and low-level spell — save it
      this.aiLog(
        `[AI Reaction] ${combatantState.id} NOT counterspelling L${spellLevel} ${context.spellName} (conserving last slot)`,
      );
      return false;
    }

    // Default: use reaction
    return true;
  }

  /**
   * Build an ActorRef from a combatant state record.
   * Delegates to shared helper (AI-L5).
   */
  private buildActorRef(combatant: CombatantStateRecord): ActorRef | null {
    return buildActorRefShared(combatant);
  }

  /**
   * Check if current turn belongs to an AI-controlled combatant and auto-process if needed
   * Returns true if an AI turn was processed
   */
  async processMonsterTurnIfNeeded(sessionId: string, encounterId: string): Promise<boolean> {
    const encounter = await this.combat.getEncounterById(encounterId);
    if (!encounter || encounter.status !== "Active") {
      return false;
    }

    const combatants = await this.combat.listCombatants(encounterId);
    if (combatants.length === 0) {
      return false;
    }

    const currentCombatant = combatants[encounter.turn];
    if (!currentCombatant) {
      return false;
    }

    // Handle combatants at 0 HP
    if (currentCombatant.hpCurrent <= 0) {
      // Check if this is a dying CHARACTER (needs interactive death save)
      if (currentCombatant.combatantType === "Character" && currentCombatant.characterId) {
        const resources = (currentCombatant.resources ?? {}) as Record<string, unknown>;
        const deathSaves = resources.deathSaves as { successes: number; failures: number } | undefined;
        const isStabilized = resources.stabilized === true;
        const failures = deathSaves?.failures ?? 0;

        // Character is dying (not yet dead or stabilized) — set up death save pending action
        if (failures < 3 && !isStabilized) {
          // Set DEATH_SAVE pending action so the tabletop flow can prompt the player
          await this.combat.setPendingAction(encounterId, {
            type: "DEATH_SAVE",
            timestamp: new Date(),
            actorId: currentCombatant.characterId,
            encounterId,
            currentDeathSaves: deathSaves ?? { successes: 0, failures: 0 },
          });

          if (this.events) {
            let name = "Character";
            const c = await this.characters.getById(currentCombatant.characterId);
            name = c?.name ?? "Character";

            await this.events.append(sessionId, {
              id: nanoid(),
              type: "NarrativeText",
              payload: { encounterId, text: `${name} is dying! Death saving throw required.` },
            });
          }

          // Return false to stop the AI loop — player needs to roll death save
          return false;
        }

        // Character is stabilized at 0 HP — skip their turn
        if (isStabilized) {
          if (this.events) {
            const c = await this.characters.getById(currentCombatant.characterId);
            const name = c?.name ?? "Character";
            await this.events.append(sessionId, {
              id: nanoid(),
              type: "NarrativeText",
              payload: { encounterId, text: `${name} is stabilized but unconscious.` },
            });
          }
          await this.combatService.nextTurn(sessionId, { encounterId, skipDeathSaveAutoRoll: true });
          return true;
        }
      }

      // Dead combatant (monster/NPC at 0 HP, or character with 3 failures) — skip
      if (this.events) {
        const key = `${encounterId}:${currentCombatant.id}`;
        if (!this.downedSkipNarrated.has(key)) {
          this.downedSkipNarrated.add(key);

          let name = "Combatant";
          if (currentCombatant.combatantType === "Monster" && currentCombatant.monsterId) {
            const m = await this.monsters.getById(currentCombatant.monsterId);
            name = m?.name ?? "Monster";
          } else if (currentCombatant.combatantType === "NPC" && currentCombatant.npcId) {
            const n = await this.npcs.getById(currentCombatant.npcId);
            name = n?.name ?? "NPC";
          } else if (currentCombatant.combatantType === "Character" && currentCombatant.characterId) {
            const c = await this.characters.getById(currentCombatant.characterId);
            name = c?.name ?? "Character";
          }

          await this.events.append(sessionId, {
            id: nanoid(),
            type: "NarrativeText",
            payload: { encounterId, text: `${name} is down and cannot act.` },
          });
        }
      }
      await this.combatService.nextTurn(sessionId, { encounterId, skipDeathSaveAutoRoll: true });
      return true;
    }

    // Stunned/Incapacitated combatants cannot act — skip their turn
    const combatantConditions: string[] = readConditionNames(currentCombatant.conditions).map(c => c.toLowerCase());
    if (combatantConditions.includes("stunned") || combatantConditions.includes("incapacitated") || combatantConditions.includes("paralyzed")) {
      const condName = combatantConditions.find(c => ["stunned", "incapacitated", "paralyzed"].includes(c)) ?? "incapacitated";
      if (this.events) {
        let name = "Combatant";
        if (currentCombatant.combatantType === "Monster" && currentCombatant.monsterId) {
          const m = await this.monsters.getById(currentCombatant.monsterId);
          name = m?.name ?? "Monster";
        } else if (currentCombatant.combatantType === "NPC" && currentCombatant.npcId) {
          const n = await this.npcs.getById(currentCombatant.npcId);
          name = n?.name ?? "NPC";
        } else if (currentCombatant.combatantType === "Character" && currentCombatant.characterId) {
          const c = await this.characters.getById(currentCombatant.characterId);
          name = c?.name ?? "Character";
        }
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "NarrativeText",
          payload: { encounterId, text: `${name} is ${condName} and cannot act!` },
        });
      }
      await this.combatService.nextTurn(sessionId, { encounterId, skipDeathSaveAutoRoll: true });
      return true;
    }

    // Check if this combatant is AI-controlled
    const isAI = await this.factionService.isAIControlled(currentCombatant);
    if (!isAI) {
      return false;
    }

    this.aiLog("[AiTurnOrchestrator] Processing AI combatant turn:", {
      type: currentCombatant.combatantType,
      id: currentCombatant.characterId || currentCombatant.monsterId || currentCombatant.npcId,
      turn: encounter.turn,
    });

    const turnCompleted = await this.executeAiTurn(sessionId, encounter, currentCombatant, combatants);
    this.aiLog("[AiTurnOrchestrator] AI turn completed");
    
    // If AI turn paused for player input (e.g., OA), return false to stop the loop
    return turnCompleted;
  }

  /**
   * Execute a single AI-controlled combatant turn using LLM as the "brain"
   * Implements feedback loop: LLM decides action → server executes → LLM sees results → repeats until turn ends
   * @returns true if turn completed normally, false if paused awaiting player input
   */
  private async executeAiTurn(
    sessionId: string,
    encounter: CombatEncounterRecord,
    aiCombatant: CombatantStateRecord,
    allCombatants: CombatantStateRecord[],
  ): Promise<boolean> {
    const aiCombatantId = aiCombatant.id;

    // Load the entity based on type
    const { entityName, entityData } = await this.loadEntity(aiCombatant);
    if (!entityData) {
      await this.combatService.nextTurn(sessionId, { encounterId: encounter.id, skipDeathSaveAutoRoll: true });
      return true;
    }

    // Use LLM decision maker if available, otherwise deterministic fallback
    const decisionMaker: IAiDecisionMaker = this.aiDecisionMaker ?? this.deterministicAi;

    // Execute turn loop: LLM decides actions until it explicitly ends turn
    const actionHistory: string[] = [];
    const turnResults: TurnStepResult[] = [];
    let turnComplete = false;
    let iterations = 0;
    let consecutiveFailures = 0;
    const maxIterations = 5; // Safety limit
    const maxConsecutiveFailures = 2; // End turn after 2 consecutive failures

    // Load recent narrative history
    const recentNarrative = await this.loadRecentNarrative(sessionId, encounter.id);

    // Load or generate faction battle plan (once per turn, reused across steps)
    let battlePlanView: Awaited<ReturnType<typeof this.contextBuilder.build>>["battlePlan"];
    if (this.battlePlanService) {
      try {
        const plan = await this.battlePlanService.ensurePlan(encounter.id, encounter, aiCombatant, allCombatants);
        if (plan) {
          battlePlanView = this.battlePlanService.getPlanViewForCombatant(plan, entityName);
        }
      } catch (err) {
        this.aiLog("[AiTurnOrchestrator] Battle plan generation failed, continuing without plan:", err);
      }
    }

    // Mutable snapshot for iteration
    let currentCombatants = allCombatants;
    let currentAiCombatant = aiCombatant;

    // Set up attacksAllowedThisTurn for Extra Attack / Multiattack
    const attacksPerAction = this.computeAttacksPerAction(aiCombatant, entityData);
    {
      const updatedResources = setAttacksAllowed(currentAiCombatant.resources, attacksPerAction);
      await this.combat.updateCombatantState(currentAiCombatant.id, { resources: updatedResources });
      currentAiCombatant = { ...currentAiCombatant, resources: updatedResources };
    }

    while (!turnComplete && iterations < maxIterations) {
      iterations++;

      // Check for deferred bonus action (stored when attack was paused by a reaction)
      const currentRes = normalizeResources(currentAiCombatant.resources);
      if (typeof (currentRes as any).pendingBonusAction === "string" && (currentRes as any).pendingBonusAction) {
        const deferredBonus = (currentRes as any).pendingBonusAction as string;
        // Clear it first to avoid re-execution on any subsequent loops
        await this.combat.updateCombatantState(currentAiCombatant.id, {
          resources: { ...currentRes, pendingBonusAction: undefined } as any,
        });
        // Execute the deferred bonus action then end turn (main action was already spent)
        const actorRef = this.buildActorRef(aiCombatant);
        const syntheticDecision: AiDecision = { action: "endTurn", bonusAction: deferredBonus, endTurn: true };
        await this.actionExecutor.executeBonusAction(
          sessionId, encounter.id, currentAiCombatant, syntheticDecision, actorRef,
        );
        break; // End the turn — main action was already spent before the reaction
      }

      // Check for deferred turn end (stored when attack was paused by a reaction
      // and the decision had endTurn: true — prevents consuming the next
      // combatant's queued decision on resume)
      if ((currentRes as any).turnShouldEndAfterReaction === true) {
        await this.combat.updateCombatantState(currentAiCombatant.id, {
          resources: { ...currentRes, turnShouldEndAfterReaction: undefined } as any,
        });
        this.aiLog("[AiTurnOrchestrator] Turn ending after reaction resolved (deferred endTurn)");
        break;
      }

      // Build combat context for LLM
      const context = await this.contextBuilder.build(
        entityData,
        currentAiCombatant,
        currentCombatants,
        encounter,
        recentNarrative,
        actionHistory,
        turnResults,
        battlePlanView,
      );

      // Get AI decision (LLM or deterministic fallback)
      let decision = await decisionMaker.decide({
        combatantName: entityName,
        combatantType: aiCombatant.combatantType,
        context,
      });

      // If LLM returned null, fall back to deterministic AI for remaining actions
      if (!decision && decisionMaker !== this.deterministicAi) {
        this.aiLog("[AiTurnOrchestrator] LLM returned null, falling back to deterministic AI");
        decision = await this.deterministicAi.decide({
          combatantName: entityName,
          combatantType: aiCombatant.combatantType,
          context,
        });
      }

      if (!decision) {
        // Even deterministic AI returned null — end turn
        break;
      }

      const actorRef = this.buildActorRef(aiCombatant);

      // Emit decision event for tests/transcripts
      if (this.events && actorRef) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "AiDecision",
          payload: {
            encounterId: encounter.id,
            actor: actorRef,
            decision: {
              action: decision.action,
              target: decision.target,
              attackName: decision.attackName,
              destination: (decision as Record<string, unknown>).destination,
              spellName: (decision as Record<string, unknown>).spellName,
              seed: (decision as Record<string, unknown>).seed,
              bonusAction: decision.bonusAction,
              intentNarration: decision.intentNarration,
              reasoning: decision.reasoning,
              endTurn: decision.endTurn,
            },
          },
        });
      }

      // Log intent narration if provided
      if (decision.intentNarration) {
        const intentText = decision.intentNarration.trim();
        this.aiLog("[AiTurnOrchestrator] Intent:", intentText);
        if (this.events && intentText) {
          await this.events.append(sessionId, {
            id: nanoid(),
            type: "NarrativeText",
            payload: {
              encounterId: encounter.id,
              ...(actorRef ? { actor: actorRef } : undefined),
              text: intentText,
            },
          });
        }
      }

      this.aiLog(`[AiTurnOrchestrator] Decision: action=${decision.action}, target=${decision.target ?? "none"}, endTurn=${decision.endTurn}, bonusAction=${decision.bonusAction ?? "none"}`);

      // Execute the action
      const result = await this.actionExecutor.execute(
        sessionId,
        encounter.id,
        currentAiCombatant,
        decision,
        currentCombatants,
        encounter,
      );

      // Add result to history for next iteration
      actionHistory.push(result.summary);
      turnResults.push({
        ...result,
        step: iterations,
        intentNarration: decision.intentNarration,
        reasoning: decision.reasoning,
        decision: {
          target: decision.target,
          attackName: decision.attackName,
          destination: (decision as Record<string, unknown>).destination as { x: number; y: number } | undefined,
          bonusAction: decision.bonusAction,
          spellName: (decision as Record<string, unknown>).spellName as string | undefined,
          seed: (decision as Record<string, unknown>).seed as number | undefined,
          endTurn: decision.endTurn,
        },
      });

      // If action failed, emit error narrative
      if (!result.ok && this.events) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "NarrativeText",
          payload: {
            encounterId: encounter.id,
            ...(actorRef ? { actor: actorRef } : undefined),
            text: `[Action Failed] ${result.summary}`,
          },
        });
        
        // Track consecutive failures to avoid infinite loops
        consecutiveFailures++;
        if (consecutiveFailures >= maxConsecutiveFailures) {
          this.aiLog("[AiTurnOrchestrator] Too many consecutive failures, ending turn");
          break;
        }
      } else {
        consecutiveFailures = 0; // Reset on success
      }

      // If action is awaiting player input (e.g., player OA roll), pause AI turn
      if (result.data?.awaitingPlayerInput) {
        // If the decision wanted to end the turn, store a flag so when the turn
        // resumes after the reaction resolves, we immediately end instead of
        // consuming the next queued decision (which belongs to the next combatant).
        if (decision.endTurn !== false) {
          const currentRes = normalizeResources(currentAiCombatant.resources);
          await this.combat.updateCombatantState(aiCombatantId, {
            resources: { ...currentRes, turnShouldEndAfterReaction: true } as any,
          });
        }
        this.aiLog("[AiTurnOrchestrator] Pausing turn - awaiting player input for opportunity attack");
        return false; // Do NOT call nextTurn() - turn pauses until player responds
      }

      // Refresh combatant snapshots
      try {
        currentCombatants = await this.combat.listCombatants(encounter.id);
        currentAiCombatant = currentCombatants.find((c) => c.id === aiCombatantId) ?? currentAiCombatant;
      } catch {
        // If refresh fails, continue with existing snapshot
      }

      // Defensive fix: moveToward should NEVER end the turn — force loop continuation
      if (decision.action === "moveToward" && result.ok) {
        this.aiLog(`[AiTurnOrchestrator] moveToward succeeded — forcing turnComplete=false regardless of endTurn=${decision.endTurn}`);
        // Don't break — continue the loop so the AI can attack after moving
        continue;
      }

      // Execute bonus action if the handler didn't already do it
      if (result.ok && decision.bonusAction) {
        const refreshedRes = normalizeResources(currentAiCombatant.resources);
        const bonusAlreadySpent = (refreshedRes as Record<string, unknown>).bonusActionUsed === true;
        if (!bonusAlreadySpent) {
          this.aiLog(`[AiTurnOrchestrator] Executing bonus action at orchestrator level: ${decision.bonusAction}`);
          const actorRefForBonus = this.buildActorRef(aiCombatant);
          const bonusResult = await this.actionExecutor.executeBonusAction(
            sessionId, encounter.id, currentAiCombatant, decision, actorRefForBonus,
          );
          if (bonusResult) {
            this.aiLog(`[AiTurnOrchestrator] Bonus action result: ${bonusResult.summary}`);
            actionHistory.push(bonusResult.summary);
          }
          // Refresh again after bonus action
          try {
            currentCombatants = await this.combat.listCombatants(encounter.id);
            currentAiCombatant = currentCombatants.find((c) => c.id === aiCombatantId) ?? currentAiCombatant;
          } catch {
            // If refresh fails, continue with existing snapshot
          }
        } else {
          this.aiLog(`[AiTurnOrchestrator] Bonus action already spent by handler, skipping orchestrator-level execution`);
        }
      }

      // Check if turn should end
      if (decision.endTurn !== false) {
        turnComplete = true;
        break;
      }
    }

    // Advance to next turn
    await this.combatService.nextTurn(sessionId, { encounterId: encounter.id, skipDeathSaveAutoRoll: true });
    return true;
  }

  /**
   * Load entity data based on combatant type.
   */
  private async loadEntity(
    aiCombatant: CombatantStateRecord,
  ): Promise<{ entityName: string; entityData: Record<string, unknown> | null }> {
    if (aiCombatant.combatantType === "Monster" && aiCombatant.monsterId) {
      const monster = await this.monsters.getById(aiCombatant.monsterId);
      if (!monster) return { entityName: "Unknown", entityData: null };
      return { entityName: monster.name, entityData: monster as unknown as Record<string, unknown> };
    }

    if (aiCombatant.combatantType === "NPC" && aiCombatant.npcId) {
      const npc = await this.npcs.getById(aiCombatant.npcId);
      if (!npc) return { entityName: "Unknown", entityData: null };
      return { entityName: npc.name, entityData: npc as unknown as Record<string, unknown> };
    }

    if (aiCombatant.combatantType === "Character" && aiCombatant.characterId) {
      const character = await this.characters.getById(aiCombatant.characterId);
      if (!character) return { entityName: "Unknown", entityData: null };
      return { entityName: character.name, entityData: character as unknown as Record<string, unknown> };
    }

    return { entityName: "Unknown", entityData: null };
  }

  /**
   * Load recent narrative history for context.
   */
  private async loadRecentNarrative(sessionId: string, encounterId: string): Promise<string[]> {
    if (!this.events) return [];

    try {
      const allEvents = await this.events.listBySession(sessionId);
      const narrativeEvents = allEvents
        .filter((e) => {
          if (e.type !== "NarrativeText") return false;
          const payload = e.payload as Record<string, unknown> | null | undefined;
          if (!payload) return false;
          return payload.encounterId === encounterId && typeof payload.text === "string";
        })
        .slice(-10); // Last 10 narrative events for context

      return narrativeEvents.map((e) => (e.payload as { text: string }).text);
    } catch (err) {
      console.warn("[AiTurnOrchestrator] Failed to load recent narrative:", err);
      return [];
    }
  }

  /**
   * Compute the number of attacks per action for an AI combatant.
   * Characters/NPCs use ClassFeatureResolver; Monsters parse the Multiattack action description.
   */
  private computeAttacksPerAction(
    combatant: CombatantStateRecord,
    entityData: Record<string, unknown>,
  ): number {
    if (combatant.combatantType === "Character") {
      const className = entityData.className as string | undefined;
      const level = entityData.level as number | undefined;
      return ClassFeatureResolver.getAttacksPerAction(null, className, level);
    }
    if (combatant.combatantType === "NPC") {
      const statBlock = entityData.statBlock as Record<string, unknown> | undefined;
      const className = statBlock?.className as string | undefined;
      const level = statBlock?.level as number | undefined;
      return ClassFeatureResolver.getAttacksPerAction(null, className, level);
    }
    if (combatant.combatantType === "Monster") {
      const statBlock = entityData.statBlock as Record<string, unknown> | undefined;
      const actions = (statBlock?.actions as unknown[]) ?? [];
      const multiattack = actions.find(
        (a: any) => typeof a?.name === "string" && a.name.toLowerCase() === "multiattack",
      ) as { description?: string } | undefined;
      if (!multiattack?.description) return 1;

      const desc = multiattack.description.toLowerCase();
      const wordMap: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };
      for (const [word, count] of Object.entries(wordMap)) {
        if (desc.includes(word)) return count;
      }
      const numMatch = desc.match(/(\d+)\s*(?:attacks|strikes)/);
      if (numMatch) return parseInt(numMatch[1], 10);
      return 1;
    }
    return 1;
  }

  /**
   * Process all consecutive AI turns until a player turn is reached.
   * Also processes legendary actions after each turn ends and lair actions at round start.
   */
  async processAllMonsterTurns(sessionId: string, encounterId: string): Promise<void> {
    // Concurrency guard: skip if already processing this encounter
    if (this._inFlight.has(encounterId)) return;
    this._inFlight.add(encounterId);

    try {
    // Determine who just ended their turn (the combatant before the current one in initiative order).
    // Legendary actions fire "immediately after another creature's turn ends".
    const enc0 = await this.combat.getEncounterById(encounterId);
    if (!enc0 || enc0.status !== "Active") return;

    const combatants0 = await this.combat.listCombatants(encounterId);
    if (combatants0.length === 0) return;

    const prevIndex = (enc0.turn - 1 + combatants0.length) % combatants0.length;
    const justEndedCombatant = combatants0[prevIndex];
    if (justEndedCombatant) {
      try {
        await this.processLegendaryActionsAfterTurn(sessionId, encounterId, justEndedCombatant.id);
      } catch (err) {
        console.error("[processAllMonsterTurns] Legendary action processing failed, continuing:", err);
      }
    }

    // Lair actions trigger at initiative count 20 (start of round).
    try {
      await this.processLairActionsIfNeeded(sessionId, encounterId);
    } catch (err) {
      console.error("[processAllMonsterTurns] Lair action processing failed, continuing:", err);
    }

    let processed = true;
    // Guard against infinite loops (e.g., all remaining combatants are stabilized/dead)
    // Max iterations = 2x combatant count should be enough for one full round
    let iterations = 0;
    const maxIterations = Math.max(combatants0.length * 2, 10);
    while (processed && iterations < maxIterations) {
      iterations++;

      // Snapshot who is about to act (will be used for legendary action after their turn)
      const encSnap = await this.combat.getEncounterById(encounterId);
      const snapCombatants = encSnap ? await this.combat.listCombatants(encounterId) : [];
      const aboutToAct = encSnap ? snapCombatants[encSnap.turn] : undefined;

      try {
        processed = await this.processMonsterTurnIfNeeded(sessionId, encounterId);
      } catch (aiTurnErr) {
        console.error(`[processAllMonsterTurns] AI turn processing failed for encounter ${encounterId}, attempting to advance turn:`, aiTurnErr);
        // Try to advance to next turn so combat doesn't get stuck
        try {
          await this.combatService.nextTurn(sessionId, { encounterId, skipDeathSaveAutoRoll: true });
        } catch (advanceErr) {
          console.error("[processAllMonsterTurns] Failed to advance turn after error, breaking:", advanceErr);
          break;
        }
        continue;
      }

      // After each turn, re-check encounter status — break early if combat ended
      const encAfter = await this.combat.getEncounterById(encounterId);
      if (!encAfter || encAfter.status !== "Active") {
        break;
      }

      // After an AI turn completes, fire legendary actions for the combatant that just ended
      if (processed && aboutToAct) {
        try {
          await this.processLegendaryActionsAfterTurn(sessionId, encounterId, aboutToAct.id);
        } catch (err) {
          console.error("[processAllMonsterTurns] Post-turn legendary action failed, continuing:", err);
        }
      }
    }
    } finally {
      this._inFlight.delete(encounterId);
    }
  }

  /**
   * Process legendary actions after a creature's turn ends.
   *
   * D&D 5e 2024: Immediately after another creature's turn ends, a legendary
   * creature can spend charges to take a legendary action.
   *
   * Called from the combat loop after each turn advancement.
   *
   * @param sessionId - Session ID
   * @param encounterId - Encounter ID
   * @param justEndedCombatantId - The combatant whose turn just ended
   */
  async processLegendaryActionsAfterTurn(
    sessionId: string,
    encounterId: string,
    justEndedCombatantId: string,
  ): Promise<void> {
    const encounter = await this.combat.getEncounterById(encounterId);
    if (!encounter || encounter.status !== "Active") return;

    const combatants = await this.combat.listCombatants(encounterId);

    // Track "turn number" since each boss's last turn for spreading heuristic
    // We count how many creatures have gone since the boss's last reset
    const turnsSinceBossReset = new Map<string, number>();

    // Find all legendary creatures (not the one whose turn just ended)
    const legendaryBosses = combatants.filter(c => {
      if (c.id === justEndedCombatantId) return false;
      if (c.hpCurrent <= 0) return false;
      return isLegendaryCreatureCheck(c.resources);
    });

    if (legendaryBosses.length === 0) return;

    for (const boss of legendaryBosses) {
      // Determine turn number for spreading heuristic
      // Count how many non-boss combatants exist (approximates turns per round)
      const turnNumber = this.getLegendaryTurnCount(boss, combatants, encounter);

      const decision = chooseLegendaryAction(boss, combatants, turnNumber);
      if (!decision) continue;

      this.aiLog(`[LegendaryAction] Boss ${boss.id} uses ${decision.actionName} (cost=${decision.cost})`);

      try {
        // Deduct charges
        const updatedResources = spendLegendaryActionCharges(boss.resources, decision.cost);
        await this.combat.updateCombatantState(boss.id, { resources: updatedResources as any });

        // Emit narrative event
        if (this.events) {
          // Resolve boss name
          let bossName = "Boss";
          if (boss.monsterId) {
            const m = await this.monsters.getById(boss.monsterId);
            bossName = m?.name ?? "Boss";
          } else if (boss.npcId) {
            const n = await this.npcs.getById(boss.npcId);
            bossName = n?.name ?? "Boss";
          }

          await this.events.append(sessionId, {
            id: nanoid(),
            type: "LegendaryAction",
            payload: {
              encounterId,
              combatantId: boss.id,
              actionName: decision.actionName,
              actionType: decision.actionType,
              cost: decision.cost,
              targetId: decision.targetId,
            },
          });

          await this.events.append(sessionId, {
            id: nanoid(),
            type: "NarrativeText",
            payload: {
              encounterId,
              text: `${bossName} uses a legendary action: ${decision.actionName}!`,
            },
          });
        }

        // Execute the legendary action
        if (decision.actionType === "attack" && decision.targetId) {
          await this.executeLegendaryAttack(sessionId, encounterId, boss, decision, combatants);
        }
        // Move and special actions emit narrative only for v1
        // (full move resolution can be added later)

      } catch (err) {
        this.aiLog(`[LegendaryAction] Failed to execute legendary action for ${boss.id}:`, err);
        // Don't let legendary action failures break the combat loop
      }
    }
  }

  /**
   * Execute a legendary attack action.
   * Resolves the attack directly (d20 + bonus vs AC, damage on hit)
   * WITHOUT consuming the boss's action economy, since legendary actions
   * use their own charge system.
   */
  private async executeLegendaryAttack(
    sessionId: string,
    encounterId: string,
    boss: CombatantStateRecord,
    decision: LegendaryActionDecision,
    combatants: CombatantStateRecord[],
  ): Promise<void> {
    const target = combatants.find(c => c.id === decision.targetId);
    if (!target || !this.diceRoller) return;

    // Look up the attack from the boss's stat block
    let attacks: Array<{ name: string; attackBonus: number; damage: { diceCount: number; diceSides: number; modifier: number }; damageType?: string; kind?: string }> = [];
    if (boss.monsterId) {
      const mon = await this.monsters.getById(boss.monsterId);
      if (mon) {
        const sb = mon.statBlock as Record<string, unknown>;
        if (Array.isArray(sb?.attacks)) attacks = sb.attacks as typeof attacks;
      }
    } else if (boss.npcId) {
      const npc = await this.npcs.getById(boss.npcId);
      if (npc) {
        const sb = getNpcMechanicsSource(npc);
        if (Array.isArray(sb?.attacks)) attacks = sb.attacks as typeof attacks;
      }
    }

    const attackDef = attacks.find(a =>
      typeof a.name === "string" && a.name.toLowerCase() === (decision.attackName ?? "").toLowerCase(),
    );
    if (!attackDef) {
      this.aiLog(`[LegendaryAction] Attack "${decision.attackName}" not found in boss stat block`);
      return;
    }

    // ── ActiveEffect integration: advantage/disadvantage + attack bonus ──
    const attackerActiveEffects = getActiveEffects(boss.resources ?? {});
    const targetActiveEffects = getActiveEffects(target.resources ?? {});
    const targetEntityId = target.characterId ?? target.monsterId ?? target.npcId ?? target.id;
    const attackKind: "melee" | "ranged" = (attackDef as any).kind === "ranged" ? "ranged" : "melee";

    let effectAdvantage = 0;
    let effectDisadvantage = 0;

    // Attacker's self-effects
    if (hasAdvantageFromEffects(attackerActiveEffects, "attack_rolls")) effectAdvantage++;
    if (attackKind === "melee" && hasAdvantageFromEffects(attackerActiveEffects, "melee_attack_rolls")) effectAdvantage++;
    if (attackKind === "ranged" && hasAdvantageFromEffects(attackerActiveEffects, "ranged_attack_rolls")) effectAdvantage++;
    if (hasDisadvantageFromEffects(attackerActiveEffects, "attack_rolls")) effectDisadvantage++;
    if (attackKind === "melee" && hasDisadvantageFromEffects(attackerActiveEffects, "melee_attack_rolls")) effectDisadvantage++;
    if (attackKind === "ranged" && hasDisadvantageFromEffects(attackerActiveEffects, "ranged_attack_rolls")) effectDisadvantage++;

    // Target's effects on incoming attacks (Dodge → disadvantage)
    for (const eff of targetActiveEffects) {
      if (eff.target !== "attack_rolls" && eff.target !== "melee_attack_rolls" && eff.target !== "ranged_attack_rolls") continue;
      if (eff.target === "melee_attack_rolls" && attackKind !== "melee") continue;
      if (eff.target === "ranged_attack_rolls" && attackKind !== "ranged") continue;
      if (!eff.targetCombatantId) continue;
      if (eff.targetCombatantId !== target.id && eff.targetCombatantId !== targetEntityId) continue;
      if (eff.type === "advantage") effectAdvantage++;
      if (eff.type === "disadvantage") effectDisadvantage++;
    }

    // Condition-based roll mode
    const attackerConditions = normalizeConditions(boss.conditions as unknown[]);
    const targetConditions = normalizeConditions(target.conditions as unknown[]);
    const rollMode = deriveRollModeFromConditions(attackerConditions, targetConditions, attackKind, effectAdvantage, effectDisadvantage);

    // Roll d20 with advantage/disadvantage
    let d20: number;
    if (rollMode === "advantage") {
      const r1 = this.diceRoller.d20().total;
      const r2 = this.diceRoller.d20().total;
      d20 = Math.max(r1, r2);
    } else if (rollMode === "disadvantage") {
      const r1 = this.diceRoller.d20().total;
      const r2 = this.diceRoller.d20().total;
      d20 = Math.min(r1, r2);
    } else {
      d20 = this.diceRoller.d20().total;
    }
    const isCritical = d20 === 20;

    // Attack bonus from ActiveEffects (Bless, etc.)
    const atkBonusResult = calculateBonusFromEffects(attackerActiveEffects, "attack_rolls");
    let effectAtkBonus = atkBonusResult.flatBonus;
    for (const dr of atkBonusResult.diceRolls) {
      const count = Math.abs(dr.count);
      const sign = dr.count < 0 ? -1 : 1;
      for (let i = 0; i < count; i++) {
        effectAtkBonus += sign * this.diceRoller.rollDie(dr.sides).total;
      }
    }
    const attackBonus = (attackDef.attackBonus ?? 0) + effectAtkBonus;
    const attackTotal = d20 + attackBonus;

    // Get target AC (with ActiveEffect bonuses like Shield)
    let ac = 10;
    if (target.characterId) {
      const ch = await this.characters.getById(target.characterId);
      if (ch) ac = (ch.sheet as any)?.armorClass ?? 10;
    } else if (target.monsterId) {
      const m = await this.monsters.getById(target.monsterId);
      if (m) ac = (m.statBlock as any)?.armorClass ?? 10;
    } else if (target.npcId) {
      const n = await this.npcs.getById(target.npcId);
      if (n) ac = (n.statBlock as any)?.armorClass ?? 10;
    }
    // AC bonus from target ActiveEffects (Shield spell, etc.)
    for (const eff of targetActiveEffects) {
      if (eff.target === "armor_class" && eff.type === "bonus" && typeof eff.value === "number") {
        ac += eff.value;
      }
    }

    const hit = isCritical || attackTotal >= ac;

    this.aiLog(`[LegendaryAction] Attack roll: ${d20} + ${attackDef.attackBonus}${effectAtkBonus ? ` + effect(${effectAtkBonus})` : ""} = ${attackTotal} vs AC ${ac}${rollMode !== "normal" ? ` [${rollMode}]` : ""} → ${hit ? "HIT" : "MISS"}`);

    // Emit attack event
    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "AttackResolved",
        payload: {
          encounterId,
          attackName: attackDef.name,
          attackRoll: d20,
          attackBonus,
          attackTotal,
          targetAC: ac,
          hit,
          critical: isCritical,
          source: "legendary_action",
        },
      });
    }

    if (!hit) return;

    // Roll damage
    const effectiveDiceCount = isCritical ? (attackDef.damage?.diceCount ?? 1) * 2 : (attackDef.damage?.diceCount ?? 1);
    const diceSides = attackDef.damage?.diceSides ?? 6;
    let totalDamage = 0;
    for (let i = 0; i < effectiveDiceCount; i++) {
      totalDamage += this.diceRoller.rollDie(diceSides).total;
    }
    totalDamage += attackDef.damage?.modifier ?? 0;

    // ActiveEffect: extra damage from attacker (Rage bonus, Hunter's Mark, etc.)
    const dmgEffects = attackerActiveEffects.filter(
      (e) =>
        (e.type === "bonus" || e.type === "penalty") &&
        (e.target === "damage_rolls" ||
          (e.target === "melee_damage_rolls" && attackKind === "melee") ||
          (e.target === "ranged_damage_rolls" && attackKind === "ranged")),
    );
    for (const eff of dmgEffects) {
      if (eff.type === "bonus") totalDamage += eff.value ?? 0;
      if (eff.type === "penalty") totalDamage -= eff.value ?? 0;
      if (eff.diceValue) {
        const sign = eff.type === "penalty" ? -1 : 1;
        for (let i = 0; i < Math.abs(eff.diceValue.count); i++) {
          totalDamage += sign * this.diceRoller.rollDie(eff.diceValue.sides).total;
        }
      }
    }
    totalDamage = Math.max(0, totalDamage);

    // Apply damage resistance / immunity / vulnerability
    const dmgType = attackDef.damageType;
    if (totalDamage > 0 && dmgType) {
      try {
        const targetRef = this.buildActorRef(target);
        if (targetRef) {
          const tgtStats = await this.combatantResolver.getCombatStats(targetRef as any);
          const defenses = tgtStats.damageDefenses ? { ...tgtStats.damageDefenses } : ({} as any);

          // Merge in ActiveEffect damage defenses
          const effDef = getDamageDefenseEffects(targetActiveEffects, dmgType);
          if (effDef.resistances) {
            defenses.damageResistances = [
              ...new Set([...(defenses.damageResistances ?? []), dmgType.toLowerCase()]),
            ];
          }
          if (effDef.vulnerabilities) {
            defenses.damageVulnerabilities = [
              ...new Set([...(defenses.damageVulnerabilities ?? []), dmgType.toLowerCase()]),
            ];
          }
          if (effDef.immunities) {
            defenses.damageImmunities = [
              ...new Set([...(defenses.damageImmunities ?? []), dmgType.toLowerCase()]),
            ];
          }

          if (defenses.damageResistances || defenses.damageImmunities || defenses.damageVulnerabilities) {
            const defResult = applyDamageDefenses(totalDamage, dmgType, defenses);
            totalDamage = defResult.adjustedDamage;
          }
        }
      } catch {
        /* proceed without defenses if stats unavailable */
      }
    }

    // Apply damage
    const hpBefore = target.hpCurrent;
    const newHp = Math.max(0, hpBefore - totalDamage);
    await this.combat.updateCombatantState(target.id, { hpCurrent: newHp });

    // Handle KO effects (unconscious, death save tracking)
    await applyKoEffectsIfNeeded(
      target,
      hpBefore,
      newHp,
      this.combat,
      (msg) => this.aiLog(`[LegendaryAction KO] ${msg}`),
    );

    if (newHp === 0) {
      const spellName = getConcentrationSpellName(target.resources);
      if (spellName) {
        await breakConcentration(target, encounterId, this.combat, (msg) =>
          this.aiLog(`[LegendaryAction KO] ${msg}`),
        );
      }
    }

    this.aiLog(`[LegendaryAction] Damage: ${totalDamage} ${dmgType ?? ""} → target HP ${hpBefore} → ${newHp}`);

    // D&D 5e 2024: Rage damage-taken tracking
    {
      const tgtRes = normalizeResources(target.resources);
      if (tgtRes.raging === true) {
        await this.combat.updateCombatantState(target.id, {
          resources: { ...tgtRes, rageDamageTakenThisTurn: true } as any,
        });
      }
    }

    // Emit damage event
    if (this.events) {
      const targetRef = this.buildActorRef(target);
      if (targetRef) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "DamageApplied",
          payload: {
            encounterId,
            target: targetRef,
            amount: totalDamage,
            hpCurrent: newHp,
            source: "legendary_action",
            damageType: dmgType ?? "untyped",
          },
        });
      }
    }
  }

  /**
   * Calculate how many turns have passed since this boss's position in init order.
   * Used for the "spread actions across the round" heuristic.
   */
  private getLegendaryTurnCount(
    boss: CombatantStateRecord,
    combatants: readonly CombatantStateRecord[],
    encounter: CombatEncounterRecord,
  ): number {
    const bossIndex = combatants.findIndex(c => c.id === boss.id);
    if (bossIndex < 0) return 1;

    // Current turn index
    const currentTurn = encounter.turn;

    // How many turns since boss's turn  
    if (currentTurn > bossIndex) {
      return currentTurn - bossIndex;
    }
    // Boss hasn't gone yet this round: count from start
    return combatants.length - bossIndex + currentTurn;
  }

  /**
   * Process lair actions at initiative count 20 (losing ties).
   *
   * D&D 5e 2024: On initiative count 20 (losing ties), the boss can trigger
   * ONE lair action per round. We check at the start of the AI turn loop
   * (which runs after a player turn). If this is the first time init-20
   * triggers this round, we fire one lair action.
   *
   * Implementation: Track `lairActionUsedThisRound` on the boss's resources.
   * Reset it when the round advances (detected by round number change).
   */
  private async processLairActionsIfNeeded(
    sessionId: string,
    encounterId: string,
  ): Promise<void> {
    const encounter = await this.combat.getEncounterById(encounterId);
    if (!encounter || encounter.status !== "Active") return;

    const combatants = await this.combat.listCombatants(encounterId);

    // Find bosses with lair actions that are in their lair
    const lairBosses = combatants.filter(c => {
      if (c.hpCurrent <= 0) return false;
      const res = normalizeResources(c.resources);
      return Array.isArray(res.lairActions) && res.lairActions.length > 0 && res.isInLair === true;
    });

    if (lairBosses.length === 0) return;

    for (const boss of lairBosses) {
      const res = normalizeResources(boss.resources);

      // Check if lair action already used this round
      const lastLairRound = typeof res.lairActionLastRound === "number" ? res.lairActionLastRound : 0;
      if (lastLairRound >= encounter.round) continue; // Already used this round

      // Check incapacitated
      const conditions = readConditionNames(boss.conditions).map(c => c.toLowerCase());
      if (conditions.includes("incapacitated") || conditions.includes("stunned") ||
          conditions.includes("paralyzed") || conditions.includes("unconscious")) {
        continue;
      }

      const lairActions = res.lairActions as Array<{
        name: string;
        description: string;
        saveDC?: number;
        saveAbility?: string;
        damage?: string;
        damageType?: string;
        effect?: string;
      }>;

      if (lairActions.length === 0) continue;

      // Pick a lair action (simple: cycle through them based on round number)
      const actionIndex = (encounter.round - 1) % lairActions.length;
      const chosenAction = lairActions[actionIndex];
      if (!chosenAction) continue;

      // Mark lair action as used this round
      const updatedRes = { ...res, lairActionLastRound: encounter.round };
      await this.combat.updateCombatantState(boss.id, { resources: updatedRes as any });

      // Resolve boss name
      let bossName = "Boss";
      if (boss.monsterId) {
        const m = await this.monsters.getById(boss.monsterId);
        bossName = m?.name ?? "Boss";
      }

      this.aiLog(`[LairAction] ${bossName} uses lair action: ${chosenAction.name}`);

      // Emit events
      if (this.events) {
        await this.events.append(sessionId, {
          id: nanoid(),
          type: "LairAction",
          payload: {
            encounterId,
            combatantId: boss.id,
            actionName: chosenAction.name,
            description: chosenAction.description,
            ...(chosenAction.damageType ? { damageType: chosenAction.damageType } : {}),
          },
        });

        await this.events.append(sessionId, {
          id: nanoid(),
          type: "NarrativeText",
          payload: {
            encounterId,
            text: `The lair shudders as ${bossName} triggers a lair action: ${chosenAction.name}! ${chosenAction.description}`,
          },
        });
      }

      // If the lair action deals damage with a save, resolve it against all enemies
      if (chosenAction.saveDC && chosenAction.damage) {
        await this.resolveLairActionDamage(
          sessionId, encounterId, boss, chosenAction, combatants,
        );
      }
    }
  }

  /**
   * Resolve damage from a lair action with a saving throw against enemy combatants.
   */
  private async resolveLairActionDamage(
    sessionId: string,
    encounterId: string,
    boss: CombatantStateRecord,
    action: { saveDC?: number; saveAbility?: string; damage?: string; damageType?: string },
    combatants: CombatantStateRecord[],
  ): Promise<void> {
    if (!action.saveDC || !action.damage || !this.diceRoller) return;

    const bossFaction = boss.monster?.faction ?? boss.npc?.faction ?? "enemy";
    const targets = combatants.filter(c => {
      if (c.id === boss.id) return false;
      if (c.hpCurrent <= 0) return false;
      const cf = c.character?.faction ?? c.monster?.faction ?? c.npc?.faction ?? "party";
      return cf !== bossFaction;
    });

    // Parse damage dice (e.g., "2d6" or "3d8")
    const diceMatch = action.damage.match(/^(\d+)d(\d+)$/);
    if (!diceMatch) return;
    const diceCount = parseInt(diceMatch[1], 10);
    const diceSides = parseInt(diceMatch[2], 10);

    for (const target of targets) {
      // Roll damage
      let totalDamage = 0;
      for (let i = 0; i < diceCount; i++) {
        totalDamage += this.diceRoller.rollDie(diceSides).total;
      }

      // Roll saving throw
      const saveRoll = this.diceRoller.rollDie(20).total;
      const saved = saveRoll >= action.saveDC;
      const finalDamage = saved ? Math.floor(totalDamage / 2) : totalDamage;

      if (finalDamage > 0) {
        const newHp = Math.max(0, target.hpCurrent - finalDamage);
        await this.combat.updateCombatantState(target.id, { hpCurrent: newHp });

        if (this.events) {
          // Build target ref from combatant
          const targetRef = this.buildActorRef(target);
          if (targetRef) {
            await this.events.append(sessionId, {
              id: nanoid(),
              type: "DamageApplied",
              payload: {
                encounterId,
                target: targetRef,
                amount: finalDamage,
                hpCurrent: newHp,
                source: "lair_action",
                damageType: action.damageType ?? "untyped",
                saved,
              },
            });
          }
        }
      }
    }
  }
}

