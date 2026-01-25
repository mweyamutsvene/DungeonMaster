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
import { AiContextBuilder } from "./ai-context-builder.js";
import { AiActionExecutor } from "./ai-action-executor.js";

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

  /** Extracted context builder */
  private readonly contextBuilder: AiContextBuilder;

  /** Extracted action executor */
  private readonly actionExecutor: AiActionExecutor;

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
    private readonly aiDecisionMaker?: IAiDecisionMaker,
    private readonly events?: IEventRepository,
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
    );
  }

  /**
   * AI decides whether to use a reaction (Opportunity Attack, Counterspell, etc.)
   * This allows tactical decision-making: save reaction for Shield spell, ignore low-value targets, etc.
   */
  private async aiDecideReaction(
    combatantState: CombatantStateRecord,
    reactionType: "opportunity_attack" | "shield_spell" | "other",
    context: { targetName?: string; spellName?: string; hpPercent?: number },
  ): Promise<boolean> {
    // Simple heuristic for now (can be enhanced with LLM later):

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

    // Counterspell: Always attempt to counter (using spellName context for future logic)
    if (reactionType === "shield_spell") {
      this.aiLog(`[AI Reaction] ${combatantState.id} counterspelling ${context.spellName}`);
      return true;
    }

    // Default: use reaction
    return true;
  }

  /**
   * Build an ActorRef from a combatant state record.
   */
  private buildActorRef(combatant: CombatantStateRecord): ActorRef | null {
    if (combatant.combatantType === "Monster" && combatant.monsterId) {
      return { type: "Monster", monsterId: combatant.monsterId };
    }
    if (combatant.combatantType === "NPC" && combatant.npcId) {
      return { type: "NPC", npcId: combatant.npcId };
    }
    if (combatant.combatantType === "Character" && combatant.characterId) {
      return { type: "Character", characterId: combatant.characterId };
    }
    return null;
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

    // Skip dead combatants entirely
    if (currentCombatant.hpCurrent <= 0) {
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
      await this.combatService.nextTurn(sessionId, { encounterId });
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

    await this.executeAiTurn(sessionId, encounter, currentCombatant, combatants);
    this.aiLog("[AiTurnOrchestrator] AI turn completed");
    return true;
  }

  /**
   * Execute a single AI-controlled combatant turn using LLM as the "brain"
   * Implements feedback loop: LLM decides action → server executes → LLM sees results → repeats until turn ends
   */
  private async executeAiTurn(
    sessionId: string,
    encounter: CombatEncounterRecord,
    aiCombatant: CombatantStateRecord,
    allCombatants: CombatantStateRecord[],
  ): Promise<void> {
    const aiCombatantId = aiCombatant.id;

    // Load the entity based on type
    const { entityName, entityData } = await this.loadEntity(aiCombatant);
    if (!entityData) {
      await this.combatService.nextTurn(sessionId, { encounterId: encounter.id });
      return;
    }

    // If no AI decision maker available, fall back to simple behavior
    if (!this.aiDecisionMaker) {
      await this.fallbackSimpleTurn(sessionId, encounter, entityData, allCombatants);
      return;
    }

    // Execute turn loop: LLM decides actions until it explicitly ends turn
    const actionHistory: string[] = [];
    const turnResults: TurnStepResult[] = [];
    let turnComplete = false;
    let iterations = 0;
    const maxIterations = 5; // Safety limit

    // Load recent narrative history
    const recentNarrative = await this.loadRecentNarrative(sessionId, encounter.id);

    // Mutable snapshot for iteration
    let currentCombatants = allCombatants;
    let currentAiCombatant = aiCombatant;

    while (!turnComplete && iterations < maxIterations) {
      iterations++;

      // Build combat context for LLM
      const context = await this.contextBuilder.build(
        entityData,
        currentAiCombatant,
        currentCombatants,
        encounter,
        recentNarrative,
        actionHistory,
        turnResults,
      );

      // Get AI decision
      const decision = await this.aiDecisionMaker.decide({
        combatantName: entityName,
        combatantType: aiCombatant.combatantType,
        context,
      });

      if (!decision) {
        // LLM failed to provide decision, end turn
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

      // Execute the action
      const result = await this.actionExecutor.execute(
        sessionId,
        encounter.id,
        currentAiCombatant,
        decision,
        currentCombatants,
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
      }

      // If action is awaiting player input (e.g., player OA roll), pause AI turn
      if (result.data?.awaitingPlayerInput) {
        this.aiLog("[AiTurnOrchestrator] Pausing turn - awaiting player input for opportunity attack");
        return; // Do NOT call nextTurn() - turn pauses until player responds
      }

      // Refresh combatant snapshots
      try {
        currentCombatants = await this.combat.listCombatants(encounter.id);
        currentAiCombatant = currentCombatants.find((c) => c.id === aiCombatantId) ?? currentAiCombatant;
      } catch {
        // If refresh fails, continue with existing snapshot
      }

      // Check if turn should end
      if (decision.endTurn !== false) {
        turnComplete = true;
        break;
      }
    }

    // Advance to next turn
    await this.combatService.nextTurn(sessionId, { encounterId: encounter.id });
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
   * Fallback behavior when LLM is not available
   */
  private async fallbackSimpleTurn(
    sessionId: string,
    encounter: CombatEncounterRecord,
    entityData: Record<string, unknown>,
    allCombatants: CombatantStateRecord[],
  ): Promise<void> {
    // Only works for monsters with stat blocks
    if (!entityData.statBlock) {
      await this.combatService.nextTurn(sessionId, { encounterId: encounter.id });
      return;
    }

    const alivePlayerCombatants = allCombatants.filter(
      (c) => c.combatantType === "Character" && c.hpCurrent > 0,
    );

    if (alivePlayerCombatants.length === 0) {
      await this.combatService.nextTurn(sessionId, { encounterId: encounter.id });
      return;
    }

    const target = alivePlayerCombatants[0]!;
    const statBlock = entityData.statBlock as Record<string, unknown>;
    const attacks = (statBlock.actions as Array<{ name: string }>) || [];

    if (attacks.length === 0) {
      await this.combatService.nextTurn(sessionId, { encounterId: encounter.id });
      return;
    }

    try {
      const monsterId = entityData.id as string;
      const monsterName = entityData.name as string;

      const result = await this.actionService.attack(sessionId, {
        encounterId: encounter.id,
        attacker: { type: "Monster", monsterId },
        target: { type: "Character", characterId: target.characterId! },
        monsterAttackName: attacks[0]!.name,
      });

      if (this.events) {
        const attackResult = result.result as Record<string, unknown>;
        const hitOrMiss = attackResult.hit ? "hit" : "missed";
        const damageData = attackResult.damage as Record<string, unknown> | undefined;
        const damageAmount = attackResult.hit ? (damageData?.applied ?? 0) : 0;

        await this.events.append(sessionId, {
          id: nanoid(),
          type: "NarrativeText",
          payload: {
            encounterId: encounter.id,
            actor: { type: "Monster", monsterId },
            text:
              (damageAmount as number) > 0
                ? `${monsterName} attacks and ${hitOrMiss} for ${damageAmount} damage!`
                : `${monsterName} attacks but ${hitOrMiss}!`,
          },
        });
      }
    } catch (error) {
      console.error(`Fallback turn failed for ${entityData.name}:`, error);
    }

    await this.combatService.nextTurn(sessionId, { encounterId: encounter.id });
  }

  /**
   * Process all consecutive AI turns until a player turn is reached
   */
  async processAllMonsterTurns(sessionId: string, encounterId: string): Promise<void> {
    let processed = true;
    while (processed) {
      processed = await this.processMonsterTurnIfNeeded(sessionId, encounterId);
    }
  }
}
