/**
 * AiActionExecutor - Thin facade over AiActionRegistry.
 *
 * Layer: Application
 * Responsibility: Enforce action economy, then delegate to the registered
 * `AiActionHandler` strategy for the given action type.
 *
 * Extending with a new AI action:
 *   1. Create `handlers/<action>-handler.ts` implementing `AiActionHandler`
 *   2. Export from `handlers/index.ts`
 *   3. Register in `setupRegistry()` below
 */

import type { CombatEncounterRecord, CombatantStateRecord } from "../../../types.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { ActionService as CombatActionService } from "../action-service.js";
import type { TwoPhaseActionService } from "../two-phase-action-service.js";
import type { ICombatRepository } from "../../../repositories/index.js";
import type { ICharacterRepository } from "../../../repositories/character-repository.js";
import type { IMonsterRepository } from "../../../repositories/monster-repository.js";
import type { INPCRepository } from "../../../repositories/npc-repository.js";
import type { IEventRepository } from "../../../repositories/event-repository.js";
import type { PendingActionRepository } from "../../../repositories/pending-action-repository.js";
import type { AbilityRegistry } from "../abilities/ability-registry.js";
import type { AiDecision, TurnStepResult, ActorRef } from "./ai-types.js";
import type { DiceRoller } from "../../../../domain/rules/dice-roller.js";
import { buildActorRef as buildActorRefShared } from "./build-actor-ref.js";
import type { AiMovementDeps } from "./ai-movement-resolver.js";
import type { AiActionHandlerContext, AiActionHandlerDeps } from "./ai-action-handler.js";
import type { AiLogger, AiReactionDecider } from "./ai-action-handler.js";
import { AiActionRegistry } from "./ai-action-registry.js";
import {
  AttackHandler,
  MoveHandler,
  MoveTowardHandler,
  MoveAwayFromHandler,
  BasicActionHandler,
  HelpHandler,
  CastSpellHandler,
  ShoveHandler,
  GrappleHandler,
  EscapeGrappleHandler,
  HideHandler,
  SearchHandler,
  UseObjectHandler,
  UseFeatureHandler,
  EndTurnHandler,
} from "./handlers/index.js";

export class AiActionExecutor {
  constructor(
    private readonly actionService: CombatActionService,
    private readonly twoPhaseActions: TwoPhaseActionService,
    private readonly combat: ICombatRepository,
    private readonly pendingActions: PendingActionRepository,
    private readonly combatantResolver: ICombatantResolver,
    private readonly abilityRegistry: AbilityRegistry,
    private readonly aiDecideReaction: AiReactionDecider,
    private readonly aiLog: AiLogger,
    private readonly diceRoller?: DiceRoller,
    private readonly events?: IEventRepository,
    /** Character repository for spell slot + concentration bookkeeping. Optional for backward compat. */
    private readonly characters?: ICharacterRepository,
    private readonly monsters?: IMonsterRepository,
    private readonly npcs?: INPCRepository,
  ) {
    this.registry = new AiActionRegistry();
    this.setupRegistry();
  }

  // Initialized in constructor â€” declared here for TypeScript field ordering.
  private readonly registry: AiActionRegistry;

  /**
   * Normalize a name for fuzzy matching.
   */
  private normalizeName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Find a combatant by name (exact or partial match).
   */
  private async findCombatantByName(
    desiredName: string,
    allCombatants: CombatantStateRecord[],
  ): Promise<CombatantStateRecord | null> {
    const nameMap = await this.combatantResolver.getNames(allCombatants);
    const desired = this.normalizeName(desiredName);
    if (!desired) return null;

    const named = allCombatants
      .map((c) => ({ combatant: c, name: nameMap.get(c.id) }))
      .filter((x): x is { combatant: CombatantStateRecord; name: string } => typeof x.name === "string");

    const exact = named.find((x) => this.normalizeName(x.name) === desired);
    if (exact) return exact.combatant;

    const partial = named.filter((x) => {
      const n = this.normalizeName(x.name);
      return n.includes(desired) || desired.includes(n);
    });
    if (partial.length === 1) return partial[0]!.combatant;

    return null;
  }

  /**
   * Build an ActorRef from a combatant state record.
   * Delegates to shared helper (AI-L5).
   */
  buildActorRef(combatant: CombatantStateRecord): ActorRef | null {
    return buildActorRefShared(combatant);
  }

  /**
   * Convert a combatant state to a ref for targeting.
   */
  private toCombatantRef(c: CombatantStateRecord): ActorRef | null {
    if (c.combatantType === "Character" && c.characterId)
      return { type: "Character", characterId: c.characterId };
    if (c.combatantType === "Monster" && c.monsterId)
      return { type: "Monster", monsterId: c.monsterId };
    if (c.combatantType === "NPC" && c.npcId) return { type: "NPC", npcId: c.npcId };
    return null;
  }

  /**
   * Check if action economy allows this action type.
   */
  private isActionConsuming(action: string): boolean {
    return ["attack", "disengage", "dash", "dodge", "help", "castSpell", "shove", "grapple", "escapeGrapple", "hide", "search", "useObject", "useFeature"].includes(action);
  }

  /**
   * Get action economy from combatant resources.
   */
  private getEconomy(aiCombatant: CombatantStateRecord): { actionSpent: boolean; bonusActionSpent: boolean } {
    const resources = aiCombatant.resources as Record<string, unknown> | null;
    return {
      actionSpent: resources?.actionSpent === true,
      bonusActionSpent: resources?.bonusActionSpent === true,
    };
  }

  /** Build deps bundle for resolveAiMovement. */
  private getMovementDeps(): AiMovementDeps {
    return {
      combat: this.combat,
      twoPhaseActions: this.twoPhaseActions,
      pendingActions: this.pendingActions,
      combatantResolver: this.combatantResolver,
      aiDecideReaction: this.aiDecideReaction,
      aiLog: this.aiLog,
    };
  }

  /** Build the full deps bundle, including bound executor helpers. */
  private buildDeps(): AiActionHandlerDeps {
    return {
      actionService: this.actionService,
      twoPhaseActions: this.twoPhaseActions,
      combat: this.combat,
      pendingActions: this.pendingActions,
      combatantResolver: this.combatantResolver,
      abilityRegistry: this.abilityRegistry,
      aiDecideReaction: this.aiDecideReaction,
      aiLog: this.aiLog,
      diceRoller: this.diceRoller,
      events: this.events,
      characters: this.characters,
      monsters: this.monsters,
      npcs: this.npcs,
      findCombatantByName: this.findCombatantByName.bind(this),
      toCombatantRef: this.toCombatantRef.bind(this),
      getMovementDeps: this.getMovementDeps.bind(this),
      executeBonusAction: this.executeBonusAction.bind(this),
    };
  }

  /** Register all built-in action handlers. One handler per action type (or small group). */
  private setupRegistry(): void {
    this.registry.register(new AttackHandler());
    this.registry.register(new MoveHandler());
    this.registry.register(new MoveTowardHandler());
    this.registry.register(new MoveAwayFromHandler());
    this.registry.register(new BasicActionHandler());
    this.registry.register(new HelpHandler());
    this.registry.register(new CastSpellHandler());
    this.registry.register(new ShoveHandler());
    this.registry.register(new GrappleHandler());
    this.registry.register(new EscapeGrappleHandler());
    this.registry.register(new HideHandler());
    this.registry.register(new SearchHandler());
    this.registry.register(new UseObjectHandler());
    this.registry.register(new UseFeatureHandler());
    this.registry.register(new EndTurnHandler());
  }

  /**
   * Execute an AI decision and return the result.
   * Economy guard stays here; action dispatch delegates to the registry.
   */
  async execute(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
    encounter?: CombatEncounterRecord,
  ): Promise<Omit<TurnStepResult, "step">> {
    try {
      const actorRef = this.buildActorRef(aiCombatant);

      // Server-side action economy enforcement (runs before any handler)
      const economy = this.getEconomy(aiCombatant);
      if (economy.actionSpent && this.isActionConsuming(decision.action)) {
        this.aiLog(`[AiActionExecutor] Rejecting ${decision.action} - action already spent this turn`);
        return {
          action: decision.action,
          ok: false,
          summary: `Cannot ${decision.action} - action already spent this turn. Use "move" or "endTurn" instead.`,
          data: { reason: "action_spent", suggestedAction: "move" },
        };
      }

      const ctx: AiActionHandlerContext = { sessionId, encounterId, encounter, aiCombatant, decision, allCombatants, actorRef };
      return this.registry.execute(ctx, this.buildDeps());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[AiActionExecutor] Error executing action:", error);
      return {
        action: decision.action,
        ok: false,
        summary: `Error executing ${decision.action}: ${message}`,
        data: { reason: "exception", message },
      };
    }
  }

  /**
   * Execute bonus action using the ability registry.
   * Falls back to legacy string matching for backward compatibility.
   * Returns summary of bonus action result, or null if none.
   */
  async executeBonusAction(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    actorRef: ActorRef | null,
  ): Promise<{ action: string; summary: string } | null> {
    if (!decision.bonusAction || typeof decision.bonusAction !== "string") {
      return null;
    }

    if (!actorRef) {
      this.aiLog("[AiActionExecutor] Cannot execute bonus action: invalid actor ref");
      return null;
    }

    const bonusActionId = decision.bonusAction.trim();

    // Try registry first
    if (this.abilityRegistry.hasExecutor(bonusActionId)) {
      try {
        const actorEntityId = actorRef.type === "Monster" ? actorRef.monsterId!
          : actorRef.type === "Character" ? actorRef.characterId!
          : actorRef.npcId!;

        let className: string | undefined;
        let level: number | undefined;
        let speed: number | undefined;
        let sheet: Record<string, unknown> | undefined;

        if (actorRef.type === "Character" && this.characters) {
          const character = await this.characters.getById(actorEntityId);
          const rawSheet = character?.sheet;
          if (rawSheet && typeof rawSheet === "object" && rawSheet !== null && !Array.isArray(rawSheet)) {
            sheet = rawSheet as Record<string, unknown>;
          }
          className = character?.className ?? (typeof sheet?.className === "string" ? sheet.className : undefined);
          level = character?.level ?? (typeof sheet?.level === "number" ? sheet.level : undefined);
          speed = typeof sheet?.speed === "number" ? sheet.speed : undefined;
        } else if (actorRef.type === "Monster" && this.monsters) {
          const monster = await this.monsters.getById(actorEntityId);
          const rawStatBlock = monster?.statBlock;
          if (rawStatBlock && typeof rawStatBlock === "object" && rawStatBlock !== null && !Array.isArray(rawStatBlock)) {
            sheet = rawStatBlock as Record<string, unknown>;
          }
          className = typeof sheet?.className === "string" ? sheet.className : undefined;
          level = typeof sheet?.level === "number" ? sheet.level : undefined;
          speed = typeof sheet?.speed === "number" ? sheet.speed : undefined;
        } else if (actorRef.type === "NPC" && this.npcs) {
          const npc = await this.npcs.getById(actorEntityId);
          const rawSheet = npc?.sheet;
          const rawStatBlock = npc?.statBlock;
          if (rawSheet && typeof rawSheet === "object" && rawSheet !== null && !Array.isArray(rawSheet)) {
            sheet = rawSheet as Record<string, unknown>;
          } else if (rawStatBlock && typeof rawStatBlock === "object" && rawStatBlock !== null && !Array.isArray(rawStatBlock)) {
            sheet = rawStatBlock as Record<string, unknown>;
          }
          className = npc?.className ?? (typeof sheet?.className === "string" ? sheet.className : undefined) ?? undefined;
          level = npc?.level ?? (typeof sheet?.level === "number" ? sheet.level : undefined) ?? undefined;
          speed = typeof sheet?.speed === "number" ? sheet.speed : undefined;
        }

        let abilityResources = aiCombatant.resources;
        if (speed !== undefined) {
          const normalizedResources = aiCombatant.resources && typeof aiCombatant.resources === "object" && !Array.isArray(aiCombatant.resources)
            ? { ...(aiCombatant.resources as Record<string, unknown>) }
            : {};
          if (typeof normalizedResources.speed !== "number") {
            normalizedResources.speed = speed;
            abilityResources = normalizedResources;
            await this.combat.updateCombatantState(aiCombatant.id, {
              resources: normalizedResources,
            });
          }
        }

        const result = await this.abilityRegistry.execute({
          sessionId,
          encounterId,
          actor: {
            getId: () => actorEntityId,
            getName: () => (aiCombatant as any).name ?? "Unknown",
            getCurrentHP: () => aiCombatant.hpCurrent ?? 0,
            getMaxHP: () => aiCombatant.hpMax ?? 0,
            getSpeed: () => speed ?? 30,
            modifyHP: () => ({ actualChange: 0 }),
          },
          combat: {
            hasUsedAction: () => true,
            getRound: () => 0,
            getTurnIndex: () => 0,
            addEffect: () => {},
            getPosition: () => undefined,
            setPosition: () => {},
          },
          abilityId: bonusActionId,
          params: {
            actor: actorRef,
            resources: abilityResources,
            ...(className ? { className } : {}),
            ...(level ? { level } : {}),
            ...(sheet ? { sheet } : {}),
            target: decision.target
              ? {
                  type: actorRef.type === "Monster" ? "Character" : "Monster",
                  [actorRef.type === "Monster" ? "characterId" : "monsterId"]: decision.target,
                }
              : undefined,
            targetName: decision.target,
          },
          services: {
            disengage: async (params: Parameters<CombatActionService["disengage"]>[1]) =>
              this.actionService.disengage(sessionId, { ...params, skipActionCheck: true }),
            dash: async (params: Parameters<CombatActionService["dash"]>[1]) =>
              this.actionService.dash(sessionId, { ...params, skipActionCheck: true }),
            dodge: async (params: Parameters<CombatActionService["dodge"]>[1]) =>
              this.actionService.dodge(sessionId, { ...params, skipActionCheck: true }),
            hide: async (params: Parameters<CombatActionService["hide"]>[1]) =>
              this.actionService.hide(sessionId, { ...params, isBonusAction: true, skipActionCheck: true }),
            attack: async (params: Parameters<CombatActionService["attack"]>[1]) =>
              this.actionService.attack(sessionId, params),
          },
        });

        // If execution includes resource spending, update combatant resources
        if (result.success && result.data?.spendResource) {
          const spendResource = result.data.spendResource as { poolName: string; amount: number };
          const { spendResourceFromPool } = await import("../helpers/resource-utils.js");
          // Re-read fresh state to preserve any flags set by the executor (e.g., disengaged)
          const freshCombatants = await this.combat.listCombatants(encounterId);
          const freshCombatant = freshCombatants.find((c) => c.id === aiCombatant.id);
          const freshResources = freshCombatant?.resources ?? aiCombatant.resources;
          const updatedResources = spendResourceFromPool(
            freshResources,
            spendResource.poolName,
            spendResource.amount,
          );
          await this.combat.updateCombatantState(aiCombatant.id, { resources: updatedResources });
        }

        return {
          action: bonusActionId,
          summary: result.summary,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.aiLog(`[AiActionExecutor] Registry execution failed: ${message}`);
        // Fall through to legacy handling
      }
    }

    // Map-based fallback for known bonus actions that resolve to disengage/hide/dash
    const bonus = bonusActionId.toLowerCase();
    const BONUS_ACTION_MAP: Record<string, "disengage" | "hide" | "dash"> = {
      "nimble_escape_disengage": "disengage",
      "disengage": "disengage",
      "nimble_escape_hide": "hide",
      "hide": "hide",
      "cunning_action_dash": "dash",
      "cunning_action_disengage": "disengage",
      "cunning_action_hide": "hide",
    };

    const mappedAction = BONUS_ACTION_MAP[bonus];
    if (mappedAction) {
      try {
        switch (mappedAction) {
          case "disengage":
            await this.actionService.disengage(sessionId, { encounterId, actor: actorRef });
            return { action: "disengage", summary: `Disengaged (${bonusActionId})` };
          case "dash":
            await this.actionService.dash(sessionId, { encounterId, actor: actorRef });
            return { action: "dash", summary: `Dashed (${bonusActionId})` };
          case "hide": {
            const hideResult = await this.actionService.hide(sessionId, { encounterId, actor: actorRef, isBonusAction: true });
            const outcome = hideResult.result.success ? `Hidden (Stealth: ${hideResult.result.stealthRoll})` : `failed to hide`;
            return { action: "hide", summary: `${outcome} (${bonusActionId})` };
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.aiLog(`[AiActionExecutor] Bonus action failed: ${message}`);
        return { action: bonus, summary: `Bonus action failed: ${message}` };
      }
    }

    // Unknown bonus action
    this.aiLog(`[AiActionExecutor] Unknown bonus action: ${decision.bonusAction}`);
    return { action: bonus, summary: `Bonus action ${decision.bonusAction} not implemented` };
  }
}
