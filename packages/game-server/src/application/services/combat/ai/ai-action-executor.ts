/**
 * AiActionExecutor - Executes AI combat decisions by delegating to game services.
 *
 * Layer: Application
 * Responsibility: Translate AiDecision into actual game state changes.
 */

import type { CombatantStateRecord } from "../../../types.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { ActionService as CombatActionService } from "../action-service.js";
import type { TwoPhaseActionService } from "../two-phase-action-service.js";
import type { ICombatRepository } from "../../../repositories/index.js";
import type { IEventRepository } from "../../../repositories/event-repository.js";
import type { PendingActionRepository } from "../../../repositories/pending-action-repository.js";
import type { AbilityRegistry } from "../abilities/ability-registry.js";
import type { AiDecision, TurnStepResult, ActorRef } from "./ai-types.js";
import type { DiceRoller } from "../../../../domain/rules/dice-roller.js";
import type { CombatantRef } from "../helpers/combatant-ref.js";
import { nanoid } from "nanoid";
import { normalizeResources, hasResourceAvailable, readBoolean, getActiveEffects, getEffectiveSpeed, getPosition } from "../helpers/resource-utils.js";
import { applyKoEffectsIfNeeded, applyDamageWhileUnconscious } from "../helpers/ko-handler.js";
import { hasReactionAvailable } from "../../../../domain/rules/opportunity-attack.js";
import { calculateDistance } from "../../../../domain/rules/movement.js";
import { findPath, findAdjacentPosition, findRetreatPosition } from "../../../../domain/rules/pathfinding.js";
import type { CombatMap } from "../../../../domain/rules/combat-map.js";
import { getMapZones } from "../../../../domain/rules/combat-map.js";
import { applyDamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import { detectDamageReactions } from "../../../../domain/entities/classes/combat-text-profile.js";
import { getAllCombatTextProfiles } from "../../../../domain/entities/classes/registry.js";
import { normalizeConditions, hasCondition } from "../../../../domain/entities/combat/conditions.js";
import {
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
  calculateFlatBonusFromEffects,
  calculateBonusFromEffects,
  getDamageDefenseEffects,
} from "../../../../domain/entities/combat/effects.js";
import { deriveRollModeFromConditions } from "../tabletop/combat-text-parser.js";
import { buildPathNarration } from "../tabletop/path-narrator.js";
import { syncEntityPosition } from "../helpers/sync-map-entity.js";
import { resolveZoneDamageForPath } from "../helpers/zone-damage-resolver.js";
import { syncAuraZones } from "../helpers/aura-sync.js";

/** Logger signature for diagnostic output */
type AiLogger = (msg: string) => void;

/** Generate a cell-by-cell straight-line path between two grid positions (5ft cells).
 *  Uses DDA-style line rasterisation aligned to a 5ft grid. */
function generateLinearPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 5) return [to]; // same or adjacent cell
  const steps = Math.max(1, Math.round(dist / 5));
  const cells: { x: number; y: number }[] = [];
  for (let i = 1; i <= steps; i++) {
    const ratio = i / steps;
    cells.push({
      x: Math.round(from.x + dx * ratio),
      y: Math.round(from.y + dy * ratio),
    });
  }
  return cells;
}

/**
 * AI reaction decision callback type.
 * Used for opportunity attacks and other reaction decisions.
 */
type AiReactionDecider = (
  combatant: CombatantStateRecord,
  reactionType: "opportunity_attack" | "shield_spell" | "other",
  context: { targetName?: string; hpPercent?: number },
) => Promise<boolean>;

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
  ) {}

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
   */
  buildActorRef(combatant: CombatantStateRecord): ActorRef | null {
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
    return ["attack", "disengage", "dash", "dodge", "help", "castSpell", "shove", "grapple", "hide", "search", "useObject"].includes(action);
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

  /**
   * Execute an AI decision and return the result.
   */
  async execute(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
  ): Promise<Omit<TurnStepResult, "step">> {
    try {
      const actorRef = this.buildActorRef(aiCombatant);

      // Server-side action economy enforcement
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

      if (decision.action === "attack") {
        return this.executeAttack(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "move") {
        return this.executeMove(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "moveToward") {
        return this.executeMoveToward(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "moveAwayFrom") {
        return this.executeMoveAwayFrom(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "disengage" || decision.action === "dash" || decision.action === "dodge") {
        return this.executeBasicAction(sessionId, encounterId, aiCombatant, decision, actorRef);
      }

      if (decision.action === "help") {
        return this.executeHelp(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "castSpell") {
        return this.executeCastSpell(sessionId, encounterId, aiCombatant, decision, actorRef);
      }

      if (decision.action === "shove") {
        return this.executeShove(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "grapple") {
        return this.executeGrapple(sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef);
      }

      if (decision.action === "hide") {
        return this.executeHide(sessionId, encounterId, aiCombatant, decision, actorRef);
      }

      if (decision.action === "search") {
        return this.executeSearch(sessionId, encounterId, aiCombatant, decision, actorRef);
      }

      if (decision.action === "useObject") {
        return {
          action: decision.action,
          ok: false,
          summary: "No usable objects available. Use 'attack', 'move', or 'endTurn' instead.",
          data: { reason: "no_usable_objects" },
        };
      }

      if (decision.action === "endTurn") {
        return this.executeEndTurn(sessionId, encounterId, aiCombatant, decision, actorRef);
      }

      return {
        action: decision.action,
        ok: false,
        summary: `Action ${decision.action} not recognized. Use 'attack', 'move', 'dodge', 'dash', 'disengage', 'help', 'shove', 'grapple', 'hide', 'search', 'castSpell', or 'endTurn'.`,
        data: { reason: "unknown_action" },
      };
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

  /** Execute an attack action. Supports two-phase reactions (Shield, Deflect Attacks, damage reactions). */
  async executeAttack(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    console.log("[AiActionExecutor] Executing attack action:", {
      target: decision.target,
      attackName: decision.attackName,
    });

    if (!decision.target || !decision.attackName) {
      console.log("[AiActionExecutor] Attack failed: missing parameters");
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Attack requires target and attackName",
        data: { reason: "missing_parameters" },
      };
    }

    if (!actorRef) {
      console.log("[AiActionExecutor] Attack failed: invalid combatant reference");
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const targetCombatant = await this.findCombatantByName(decision.target, allCombatants);
    if (!targetCombatant) {
      console.log("[AiActionExecutor] Attack failed: target not found:", decision.target);
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target ${decision.target} not found`,
        data: { reason: "target_not_found", target: decision.target },
      };
    }

    const targetRef = this.toCombatantRef(targetCombatant);
    if (!targetRef) {
      console.log("[AiActionExecutor] Attack failed: invalid target reference");
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid target reference",
        data: { reason: "invalid_target_reference" },
      };
    }

    // ── Range validation: enforce D&D 5e distance rules before attacking ──
    const actorResources = normalizeResources(aiCombatant.resources);
    const actorPos = getPosition(actorResources);
    const targetPos = getPosition(normalizeResources(targetCombatant.resources));
    if (actorPos && targetPos) {
      const dist = calculateDistance(actorPos, targetPos);
      // Look up the chosen attack to determine melee vs ranged and reach/range
      const monsterAttacks = actorRef.type === "Monster"
        ? await this.combatantResolver.getMonsterAttacks(actorRef.monsterId)
        : [];
      const desiredName = (decision.attackName ?? "").trim().toLowerCase();
      const chosenAttack = monsterAttacks.find(
        (a: any) => typeof a?.name === "string" && a.name.trim().toLowerCase() === desiredName,
      ) as Record<string, unknown> | undefined;
      const attackKindCheck: "melee" | "ranged" = (chosenAttack as any)?.kind === "ranged" ? "ranged" : "melee";

      if (attackKindCheck === "melee") {
        const reachValue = (chosenAttack as any)?.reach ?? (actorResources as any).reach;
        const reach = typeof reachValue === "number" ? reachValue : 5;
        if (dist > reach + 0.0001) {
          this.aiLog(`[AiActionExecutor] Melee attack out of reach: ${Math.round(dist)}ft > ${reach}ft`);
          return {
            action: decision.action,
            ok: false,
            summary: `Failed: Target is ${Math.round(dist)}ft away, but ${decision.attackName} has ${reach}ft reach. Move closer first.`,
            data: { reason: "out_of_reach", distance: Math.round(dist), reach },
          };
        }
      } else {
        // Ranged attack: check max range
        const rangeObj = (chosenAttack as any)?.range;
        let maxRange = 600; // D&D 5e default: no range means 600ft
        if (typeof rangeObj === "string") {
          const parts = rangeObj.split("/").map(Number);
          if (parts.length >= 2 && !isNaN(parts[1]!)) maxRange = parts[1]!;
          else if (parts.length >= 1 && !isNaN(parts[0]!)) maxRange = parts[0]!;
        } else if (rangeObj && typeof rangeObj === "object") {
          maxRange = typeof rangeObj.long === "number" ? rangeObj.long
            : typeof rangeObj.max === "number" ? rangeObj.max
            : typeof rangeObj.normal === "number" ? rangeObj.normal
            : 600;
        }
        if (dist > maxRange + 0.0001) {
          this.aiLog(`[AiActionExecutor] Ranged attack out of range: ${Math.round(dist)}ft > ${maxRange}ft`);
          return {
            action: decision.action,
            ok: false,
            summary: `Failed: Target is ${Math.round(dist)}ft away, beyond ${decision.attackName}'s ${maxRange}ft range. Move closer first.`,
            data: { reason: "out_of_range", distance: Math.round(dist), maxRange },
          };
        }
      }
    }

    // Check if target is a Character with Shield reaction available
    const targetResources = normalizeResources(targetCombatant.resources);
    const targetHasShield = targetCombatant.combatantType === "Character"
      && targetResources.hasShieldPrepared === true
      && hasReactionAvailable({ reactionUsed: !!targetResources.reactionUsed } as any)
      && hasResourceAvailable(targetCombatant.resources, "spellSlot_1", 1);

    // Check if target is a Character that may have Deflect Attacks (Monk reaction)
    // We check the basic prerequisites here; the full eligibility check is in initiateAttack()
    const targetHasDeflectReaction = targetCombatant.combatantType === "Character"
      && hasReactionAvailable({ reactionUsed: !!targetResources.reactionUsed } as any);

    // If target has Shield or Deflect Attacks and we have a dice roller, use two-phase flow
    // This allows initiateAttack() to detect all reaction opportunities
    if ((targetHasShield || targetHasDeflectReaction) && this.diceRoller) {
      console.log("[AiActionExecutor] Target may have reactions (Shield/Deflect) - using two-phase attack flow");

      // Build attack spec from monster's stat block
      const attackerStats = await this.combatantResolver.getCombatStats(actorRef as CombatantRef);
      const monsterAttacks = actorRef.type === "Monster" ? await this.combatantResolver.getMonsterAttacks(actorRef.monsterId) : [];
      const desiredName = (decision.attackName ?? "").trim().toLowerCase();
      const picked = monsterAttacks.find(
        (a: any) => typeof a?.name === "string" && a.name.trim().toLowerCase() === desiredName,
      ) as Record<string, unknown> | undefined;

      if (!picked) {
        console.log("[AiActionExecutor] Two-phase flow: attack not found, falling back to normal flow");
        // Fall through to normal path below
      } else {
        const attackBonusBase = typeof picked.attackBonus === "number" ? picked.attackBonus : 0;
        const dmg = typeof picked.damage === "object" && picked.damage !== null ? picked.damage as Record<string, unknown> : null;
        const diceCount = dmg && typeof dmg.diceCount === "number" ? dmg.diceCount : 1;
        const diceSides = dmg && typeof dmg.diceSides === "number" ? dmg.diceSides : 6;
        const modifier = dmg && typeof dmg.modifier === "number" ? dmg.modifier : 0;

        // ── ActiveEffect integration: advantage/disadvantage + attack bonus + AC bonus ──
        const attackerActiveEffects = getActiveEffects(aiCombatant.resources ?? {});
        const targetActiveEffects = getActiveEffects(targetCombatant.resources ?? {});
        const attackKind: "melee" | "ranged" = (picked as any).kind === "ranged" ? "ranged" : "melee";

        // Count advantage/disadvantage from ActiveEffects
        let effectAdvantage = 0;
        let effectDisadvantage = 0;

        // Attacker's self-effects
        if (hasAdvantageFromEffects(attackerActiveEffects, 'attack_rolls')) effectAdvantage++;
        if (attackKind === 'melee' && hasAdvantageFromEffects(attackerActiveEffects, 'melee_attack_rolls')) effectAdvantage++;
        if (attackKind === 'ranged' && hasAdvantageFromEffects(attackerActiveEffects, 'ranged_attack_rolls')) effectAdvantage++;
        if (hasDisadvantageFromEffects(attackerActiveEffects, 'attack_rolls')) effectDisadvantage++;
        if (attackKind === 'melee' && hasDisadvantageFromEffects(attackerActiveEffects, 'melee_attack_rolls')) effectDisadvantage++;
        if (attackKind === 'ranged' && hasDisadvantageFromEffects(attackerActiveEffects, 'ranged_attack_rolls')) effectDisadvantage++;

        // Target's effects on incoming attacks (e.g., Dodge → disadvantage, Reckless Attack → advantage)
        for (const eff of targetActiveEffects) {
          if (eff.target !== 'attack_rolls' && eff.target !== 'melee_attack_rolls' && eff.target !== 'ranged_attack_rolls') continue;
          if (eff.target === 'melee_attack_rolls' && attackKind !== 'melee') continue;
          if (eff.target === 'ranged_attack_rolls' && attackKind !== 'ranged') continue;
          if (!eff.targetCombatantId || eff.targetCombatantId !== targetCombatant.id) continue;
          if (eff.type === 'advantage') effectAdvantage++;
          if (eff.type === 'disadvantage') effectDisadvantage++;
        }

        // Resolve advantage/disadvantage from conditions + effects
        const attackerCondNames = normalizeConditions(aiCombatant.conditions as unknown[]).map(c => c.condition);
        const targetCondNames = normalizeConditions(targetCombatant.conditions as unknown[]).map(c => c.condition);
        const rollMode = deriveRollModeFromConditions(attackerCondNames, targetCondNames, attackKind, effectAdvantage, effectDisadvantage);

        // Roll d20 with resolved advantage/disadvantage mode
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
        const critical = d20 === 20;

        // Attack bonus from ActiveEffects (Bless, etc.)
        const atkBonusResult = calculateBonusFromEffects(attackerActiveEffects, 'attack_rolls');
        let effectAtkBonus = atkBonusResult.flatBonus;
        for (const dr of atkBonusResult.diceRolls) {
          const count = Math.abs(dr.count);
          const sign = dr.count < 0 ? -1 : 1;
          for (let i = 0; i < count; i++) {
            effectAtkBonus += sign * this.diceRoller.rollDie(dr.sides).total;
          }
        }
        const attackBonus = attackBonusBase + effectAtkBonus;
        const attackTotal = d20 + attackBonus;

        console.log(`[AiActionExecutor] Two-phase flow: d20=${d20} + ${attackBonusBase} + effect(${effectAtkBonus}) = ${attackTotal}${rollMode !== "normal" ? ` [${rollMode}]` : ""}`);

        // Get target AC from combat stats (character sheet), not resources
        let targetAC: number;
        try {
          const targetStats = await this.combatantResolver.getCombatStats(targetRef as CombatantRef);
          targetAC = targetStats.armorClass;
        } catch {
          targetAC = typeof targetResources.armorClass === "number" ? targetResources.armorClass as number : 10;
        }
        // AC bonus from target's ActiveEffects (Shield of Faith, etc.)
        const acBonusFromEffects = calculateFlatBonusFromEffects(targetActiveEffects, 'armor_class');
        targetAC += acBonusFromEffects;

        // Call initiateAttack to check Shield eligibility
        const initiateResult = await this.twoPhaseActions.initiateAttack(sessionId, {
          encounterId,
          actor: actorRef as CombatantRef,
          target: targetRef as CombatantRef,
          attackName: decision.attackName,
          attackRoll: attackTotal,
        });

        // D&D 5e 2024: Rage attack tracking — any attack roll counts (hit or miss)
        {
          const atkRes = normalizeResources(aiCombatant.resources);
          if (atkRes.raging === true) {
            await this.combat.updateCombatantState(aiCombatant.id, {
              resources: { ...atkRes, rageAttackedThisTurn: true } as any,
            });
          }
        }

        if (initiateResult.status === "miss") {
          // Clean miss - no reaction needed
          console.log("[AiActionExecutor] Two-phase flow: attack missed, no reaction opportunity");
          
          // Emit AttackResolved event so CLI can display miss
          if (this.events) {
            await this.events.append(sessionId, {
              id: nanoid(),
              type: "AttackResolved",
              payload: {
                encounterId,
                attacker: actorRef,
                target: targetRef,
                attackName: decision.attackName,
                attackRoll: d20,
                attackBonus: attackBonus,
                attackTotal,
                targetAC,
                hit: false,
                critical: false,
                damageApplied: 0,
              },
            });
          }

          // Still need to mark action as spent
          const { spendAction } = await import("../helpers/resource-utils.js");
          await this.combat.updateCombatantState(aiCombatant.id, {
            resources: spendAction(aiCombatant.resources),
          });

          const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
          const mainSummary = `Attack missed ${decision.target}`;
          const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

          return {
            action: decision.action,
            ok: true,
            summary: fullSummary,
            data: { hit: false, damage: 0, target: decision.target, attackName: decision.attackName },
          };
        }

        if (initiateResult.status === "awaiting_reactions" && initiateResult.pendingActionId) {
          console.log("[AiActionExecutor] Two-phase flow: awaiting player reaction");

          // Update the pending action data with damage spec for later completion
          const pendingAction = await this.pendingActions.getById(initiateResult.pendingActionId);
          if (pendingAction) {
            const attackData = pendingAction.data as any;
            const shieldDmgType = typeof (picked as any).damageType === "string" ? (picked as any).damageType : undefined;
            attackData.damageSpec = { diceCount, diceSides, modifier, damageType: shieldDmgType };
            attackData.critical = critical;
            attackData.sessionId = sessionId;
            attackData.targetAC = targetAC;
            await this.pendingActions.update(pendingAction);
          }

          // Store pending action on encounter for polling
          await this.combat.setPendingAction(encounterId, {
            id: initiateResult.pendingActionId,
            type: "reaction_pending",
            pendingActionId: initiateResult.pendingActionId,
            attackerName: decision.attackName,
            target: targetRef,
            attackRoll: attackTotal,
          });

          // Mark action as spent
          const { spendAction } = await import("../helpers/resource-utils.js");
          await this.combat.updateCombatantState(aiCombatant.id, {
            resources: spendAction(aiCombatant.resources),
          });

          return {
            action: decision.action,
            ok: true,
            summary: `Attack on ${decision.target} - awaiting player reaction`,
            data: {
              awaitingPlayerInput: true,
              pendingActionId: initiateResult.pendingActionId,
              target: decision.target,
              attackName: decision.attackName,
              attackRoll: attackTotal,
            },
          };
        }

        // Status is "hit" (no reaction triggered) - proceed with damage
        if (initiateResult.status === "hit") {
          console.log("[AiActionExecutor] Two-phase flow: hit with no reaction, resolving damage");

          const effectiveDiceCount = critical ? diceCount * 2 : diceCount;
          const damageRoll = this.diceRoller.rollDie(diceSides, effectiveDiceCount, modifier);
          let damageApplied = Math.max(0, damageRoll.total);

          // ── ActiveEffect: extra damage from attacker effects (Rage, Hunter's Mark, etc.) ──
          {
            const dmgEffects = attackerActiveEffects.filter(
              e => (e.type === 'bonus' || e.type === 'penalty')
                && (e.target === 'damage_rolls'
                  || (e.target === 'melee_damage_rolls' && attackKind === 'melee')
                  || (e.target === 'ranged_damage_rolls' && attackKind === 'ranged'))
                && (!e.targetCombatantId || e.targetCombatantId === targetCombatant.id)
            );
            let effectDmgTotal = 0;
            for (const eff of dmgEffects) {
              if (eff.type === 'bonus') effectDmgTotal += eff.value ?? 0;
              if (eff.type === 'penalty') effectDmgTotal -= eff.value ?? 0;
              if (eff.diceValue) {
                const sign = eff.type === 'penalty' ? -1 : 1;
                const count = Math.abs(eff.diceValue.count);
                for (let i = 0; i < count; i++) {
                  effectDmgTotal += sign * this.diceRoller.rollDie(eff.diceValue.sides).total;
                }
              }
            }
            if (effectDmgTotal !== 0) {
              damageApplied = Math.max(0, damageApplied + effectDmgTotal);
            }
          }

          // Apply damage resistance/immunity/vulnerability (stat-block + ActiveEffects)
          const pickedDmgType = typeof (picked as any).damageType === "string" ? (picked as any).damageType : undefined;
          if (damageApplied > 0 && pickedDmgType && targetRef) {
            try {
              const tgtStats = await this.combatantResolver.getCombatStats(targetRef as CombatantRef);
              const defenses = tgtStats.damageDefenses ? { ...tgtStats.damageDefenses } : {} as any;

              // Merge ActiveEffect damage defenses (Rage resistance, etc.)
              const effDef = getDamageDefenseEffects(targetActiveEffects, pickedDmgType);
              if (effDef.resistances) {
                defenses.damageResistances = [...new Set([...(defenses.damageResistances ?? []), pickedDmgType.toLowerCase()])];
              }
              if (effDef.vulnerabilities) {
                defenses.damageVulnerabilities = [...new Set([...(defenses.damageVulnerabilities ?? []), pickedDmgType.toLowerCase()])];
              }
              if (effDef.immunities) {
                defenses.damageImmunities = [...new Set([...(defenses.damageImmunities ?? []), pickedDmgType.toLowerCase()])];
              }

              if (defenses.damageResistances || defenses.damageImmunities || defenses.damageVulnerabilities) {
                const defResult = applyDamageDefenses(damageApplied, pickedDmgType, defenses);
                damageApplied = defResult.adjustedDamage;
              }
            } catch { /* proceed without defenses */ }
          }

          if (damageApplied > 0) {
            const hpBefore = targetCombatant.hpCurrent;
            const hpAfter = Math.max(0, hpBefore - damageApplied);
            await this.combat.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });

            // Apply KO effects (Unconscious + Prone + death saves) if character dropped to 0 HP
            await applyKoEffectsIfNeeded(
              targetCombatant,
              hpBefore,
              hpAfter,
              this.combat,
              (msg) => this.aiLog(`[KO] ${msg}`),
            );

            // Apply damage-while-unconscious (auto-fail death saves) if already at 0 HP
            if (hpBefore === 0 && targetCombatant.combatantType === "Character") {
              const isCritical = critical ?? false;
              await applyDamageWhileUnconscious(
                targetCombatant,
                damageApplied,
                isCritical,
                this.combat,
                (msg) => this.aiLog(`[KO] ${msg}`),
              );
            }

            // D&D 5e 2024: Rage damage-taken tracking
            {
              const tgtRes = normalizeResources(targetCombatant.resources);
              if (tgtRes.raging === true) {
                await this.combat.updateCombatantState(targetCombatant.id, {
                  resources: { ...tgtRes, rageDamageTakenThisTurn: true } as any,
                });
              }
            }
          }

          // ── ActiveEffect: retaliatory damage (Armor of Agathys, Fire Shield) ──
          if (damageApplied > 0 && attackKind === "melee") {
            const retaliatory = targetActiveEffects.filter(e => e.type === 'retaliatory_damage');
            if (retaliatory.length > 0 && aiCombatant.hpCurrent > 0) {
              let totalRetaliatoryDamage = 0;
              for (const eff of retaliatory) {
                let retDmg = eff.value ?? 0;
                if (eff.diceValue) {
                  for (let i = 0; i < eff.diceValue.count; i++) {
                    retDmg += this.diceRoller.rollDie(eff.diceValue.sides).total;
                  }
                }
                totalRetaliatoryDamage += retDmg;
                this.aiLog(`Retaliatory damage (${eff.source ?? 'effect'}): ${retDmg} ${eff.damageType ?? ''}`);
              }
              if (totalRetaliatoryDamage > 0) {
                const atkHpBefore = aiCombatant.hpCurrent;
                const atkHpAfter = Math.max(0, atkHpBefore - totalRetaliatoryDamage);
                await this.combat.updateCombatantState(aiCombatant.id, { hpCurrent: atkHpAfter });
                await applyKoEffectsIfNeeded(
                  aiCombatant, atkHpBefore, atkHpAfter, this.combat,
                  (msg) => this.aiLog(`[KO] ${msg}`),
                );
                this.aiLog(`Retaliatory damage: ${totalRetaliatoryDamage} to AI attacker (HP: ${atkHpBefore} → ${atkHpAfter})`);
              }
            }
          }

          // Mark action as spent
          const { spendAction } = await import("../helpers/resource-utils.js");
          await this.combat.updateCombatantState(aiCombatant.id, {
            resources: spendAction(aiCombatant.resources),
          });

          // Emit AttackResolved + DamageApplied events so CLI can display the result
          if (this.events) {
            const hpAfterForEvent = damageApplied > 0
              ? Math.max(0, targetCombatant.hpCurrent - damageApplied)
              : targetCombatant.hpCurrent;
            await this.events.append(sessionId, {
              id: nanoid(),
              type: "AttackResolved",
              payload: {
                encounterId,
                attacker: actorRef,
                target: targetRef,
                attackName: decision.attackName,
                attackRoll: d20,
                attackBonus: attackBonus,
                attackTotal,
                targetAC,
                hit: true,
                critical,
                damageApplied,
              },
            });
            if (damageApplied > 0) {
              await this.events.append(sessionId, {
                id: nanoid(),
                type: "DamageApplied",
                payload: {
                  encounterId,
                  amount: damageApplied,
                  hpCurrent: hpAfterForEvent,
                  source: decision.attackName,
                },
              });
            }
          }

          // --- Damage reaction detection (Absorb Elements, Hellish Rebuke) ---
          if (damageApplied > 0 && pickedDmgType && targetCombatant.combatantType === "Character") {
            const freshTargetResources = normalizeResources(
              (await this.combat.listCombatants(encounterId))
                .find((c) => c.id === targetCombatant.id)?.resources ?? targetCombatant.resources,
            );
            const stillHasReaction = hasReactionAvailable({ reactionUsed: false, ...freshTargetResources } as any)
              && !readBoolean(freshTargetResources, "reactionUsed");

            if (stillHasReaction && targetCombatant.hpCurrent - damageApplied > 0) {
              try {
                const tgtStats = await this.combatantResolver.getCombatStats(targetRef as CombatantRef);
                const dmgInput = {
                  className: tgtStats.className?.toLowerCase() ?? "",
                  level: tgtStats.level ?? 1,
                  abilityScores: (tgtStats.abilityScores ?? {}) as Record<string, number>,
                  resources: freshTargetResources,
                  hasReaction: true,
                  isCharacter: true,
                  damageType: pickedDmgType,
                  damageAmount: damageApplied,
                  attackerId: actorRef.type === "Monster" ? (actorRef as any).monsterId : (actorRef as any).characterId ?? "",
                };

                const dmgReactions = detectDamageReactions(dmgInput, getAllCombatTextProfiles());
                if (dmgReactions.length > 0) {
                  const dr = dmgReactions[0]!;
                  const drResult = await this.twoPhaseActions.initiateDamageReaction(sessionId, {
                    encounterId,
                    target: targetRef as CombatantRef,
                    attackerId: actorRef as CombatantRef,
                    damageType: pickedDmgType,
                    damageAmount: damageApplied,
                    detectedReaction: dr,
                    targetCombatantId: targetCombatant.id,
                  });

                  if (drResult.status === "awaiting_reactions" && drResult.pendingActionId) {
                    // Store pending action on encounter for polling
                    await this.combat.setPendingAction(encounterId, {
                      id: drResult.pendingActionId,
                      type: "reaction_pending",
                      pendingActionId: drResult.pendingActionId,
                      reactionType: dr.reactionType,
                      target: targetRef,
                    });

                    console.log(`[AiActionExecutor] Damage reaction (${dr.reactionType}) pending — pausing for player`);
                    return {
                      action: decision.action,
                      ok: true,
                      summary: `Attack hit ${decision.target} for ${damageApplied} damage - awaiting damage reaction`,
                      data: {
                        awaitingPlayerInput: true,
                        pendingActionId: drResult.pendingActionId,
                        hit: true,
                        damage: damageApplied,
                        target: decision.target,
                        attackName: decision.attackName,
                      },
                    };
                  }
                }
              } catch { /* skip damage reaction detection if stats unavailable */ }
            }
          }

          const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
          const mainSummary = `Attack hit ${decision.target} for ${damageApplied} damage`;
          const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

          return {
            action: decision.action,
            ok: true,
            summary: fullSummary,
            data: { hit: true, damage: damageApplied, target: decision.target, attackName: decision.attackName },
          };
        }
      }
    }

    // Normal flow (no Shield protection needed)
    console.log("[AiActionExecutor] Calling actionService.attack...", { attacker: actorRef, target: targetRef });
    const result = await this.actionService.attack(sessionId, {
      encounterId,
      attacker: actorRef,
      target: targetRef,
      monsterAttackName: decision.attackName,
    });
    const hit = Boolean((result.result as Record<string, unknown>).hit);
    const damage = hit ? ((result.result as Record<string, unknown>).damage as Record<string, unknown>)?.applied ?? 0 : 0;

    console.log("[AiActionExecutor] Attack completed:", { hit, damage });

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);

    const mainSummary = hit
      ? `Attack hit ${decision.target} for ${damage} damage`
      : `Attack missed ${decision.target}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: {
        hit,
        damage,
        target: decision.target,
        attackName: decision.attackName,
        ...(bonusResult ? { bonusAction: bonusResult } : {}),
      },
    };
  }

  private async executeMove(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!decision.destination) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Move requires destination",
        data: { reason: "missing_destination" },
      };
    }

    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    // Get current position and available speed
    const resources = (aiCombatant.resources as Record<string, unknown>) ?? {};
    const currentPos = resources.position as { x: number; y: number } | undefined;
    const speed = getEffectiveSpeed(aiCombatant.resources);
    const hasDashed = (resources.dashed as boolean) ?? false;
    let effectiveSpeed = hasDashed ? speed * 2 : speed;

    // Account for Prone stand-up cost: standing costs half base speed
    const aiConditions = normalizeConditions(aiCombatant.conditions as unknown[]);
    const isProne = hasCondition(aiConditions, "Prone");
    if (isProne) {
      const standUpCost = Math.ceil(speed / 2);
      effectiveSpeed -= standUpCost;
      this.aiLog(`[AiActionExecutor] Prone stand-up costs ${standUpCost}ft, effective speed: ${effectiveSpeed}ft`);
      if (effectiveSpeed <= 0) {
        return {
          action: decision.action,
          ok: false,
          summary: `Failed: Standing from Prone costs ${standUpCost}ft, no movement remaining`,
          data: { reason: "prone_no_movement" },
        };
      }
    }

    // Validate/clamp destination if needed
    let finalDestination = decision.destination;
    if (currentPos) {
      const requestedDistance = calculateDistance(currentPos, decision.destination);
      if (requestedDistance > effectiveSpeed) {
        // Clamp to max distance along the same direction
        // Use 0.99 factor to avoid floating point precision issues at the boundary
        const ratio = (effectiveSpeed * 0.99) / requestedDistance;
        const dx = decision.destination.x - currentPos.x;
        const dy = decision.destination.y - currentPos.y;
        finalDestination = {
          x: Math.round(currentPos.x + dx * ratio),
          y: Math.round(currentPos.y + dy * ratio),
        };
        const clampedDist = calculateDistance(currentPos, finalDestination);
        this.aiLog(`[AiActionExecutor] Clamped move from ${requestedDistance.toFixed(1)}ft to ${clampedDist.toFixed(1)}ft (max ${effectiveSpeed}ft): (${decision.destination.x}, ${decision.destination.y}) -> (${finalDestination.x}, ${finalDestination.y})`);
      }
    }

    // Initiate two-phase move to detect opportunity attacks
    const moveInit = await this.twoPhaseActions.initiateMove(sessionId, {
      encounterId,
      actor: actorRef,
      destination: finalDestination,
    });

    let movedFeet = 0;
    const aiDecisions: Array<{ attackerId: string; used: boolean; reason: string }> = [];

    // Handle on_voluntary_move trigger (e.g., Booming Blade) — creature KO'd before moving
    if (moveInit.status === "aborted_by_trigger") {
      const triggerMsg = moveInit.voluntaryMoveTriggerMessages?.join(" ") ?? "Movement trigger damage!";
      return {
        action: decision.action,
        ok: false,
        summary: `${triggerMsg} Knocked out before moving.`,
        data: { reason: "knocked_out_by_movement_trigger" },
      };
    }

    // Handle the simple case: no opportunity attacks, just move directly
    if (moveInit.status === "no_reactions") {
      // Calculate distance moved
      movedFeet = currentPos ? Math.round(calculateDistance(currentPos, finalDestination)) : 0;

      // Calculate remaining movement after this move
      const currentRemaining = typeof resources.movementRemaining === "number"
        ? resources.movementRemaining
        : effectiveSpeed;
      const newMovementRemaining = Math.max(0, currentRemaining - movedFeet);

      // Update position directly
      await this.combat.updateCombatantState(aiCombatant.id, {
        resources: {
          ...resources,
          position: finalDestination,
          movementSpent: newMovementRemaining <= 0,
          movementRemaining: newMovementRemaining,
        } as any,
      });

      // Keep CombatMap entities[] in sync with the position update
      await syncEntityPosition(this.combat, encounterId, aiCombatant.id, finalDestination);

      // Sync aura zones for this combatant
      const aiEntityId = aiCombatant.characterId ?? aiCombatant.monsterId ?? aiCombatant.npcId ?? aiCombatant.id;
      await syncAuraZones(this.combat, encounterId, aiEntityId, finalDestination);

      // --- Zone damage during AI movement ---
      const aiEncounter = await this.combat.getEncounterById(encounterId);
      if (aiEncounter && currentPos) {
        const combatMap = aiEncounter.mapData as unknown as import("../../../../domain/rules/combat-map.js").CombatMap | undefined;
        if (combatMap && (combatMap.zones?.length ?? 0) > 0) {
          const aiIsPC = aiCombatant.combatantType === "Character" || aiCombatant.combatantType === "NPC";
          const aiCombatants = await this.combat.listCombatants(encounterId);
          const movePath = generateLinearPath(currentPos, finalDestination);
          await resolveZoneDamageForPath(
            movePath,
            currentPos,
            aiCombatant,
            combatMap,
            (srcId: string) => {
              const src = aiCombatants.find((c: any) => (c.characterId ?? c.monsterId ?? c.npcId) === srcId);
              const srcIsPC = src ? (src.combatantType === "Character" || src.combatantType === "NPC") : false;
              return aiIsPC === srcIsPC;
            },
            { damageResistances: [], damageImmunities: [], damageVulnerabilities: [] },
            { combatRepo: this.combat },
          );
        }
      }

      // Process bonus action if included
      const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);

      const mainSummary = `Moved ${movedFeet}ft to (${finalDestination.x}, ${finalDestination.y})`;
      const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

      return {
        action: decision.action,
        ok: true,
        summary: fullSummary,
        data: {
          movedFeet,
          destination: finalDestination,
          opportunityAttacks: [],
          ...(bonusResult ? { bonusAction: bonusResult } : {}),
        },
      };
    }

    // If there are reactions, resolve them automatically
    if (moveInit.status === "awaiting_reactions" && moveInit.pendingActionId) {
      const pendingAction = await this.pendingActions.getById(moveInit.pendingActionId);
      if (!pendingAction) {
        return {
          action: decision.action,
          ok: false,
          summary: "Failed: Pending action not found",
          data: { reason: "pending_action_missing" },
        };
      }

      // Resolve each reaction opportunity
      for (const opp of moveInit.opportunityAttacks) {
        if (!opp.canAttack) {
          aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "cannot_attack" });
          continue;
        }

        // Get the attacker's state
        const attackerState = allCombatants.find((c) => c.id === opp.combatantId);
        if (!attackerState) {
          aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "attacker_not_found" });
          continue;
        }

        // Player characters don't auto-resolve - their OAs are handled via /combat/roll-result
        if (attackerState.combatantType === "Character") {
          aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "player_prompted" });
          continue;
        }

        // AI decides whether to use reaction for AI/Monster attackers
        const shouldUseReaction = await this.aiDecideReaction(attackerState, "opportunity_attack", {
          targetName: await this.combatantResolver.getName(actorRef, aiCombatant),
          hpPercent: attackerState.hpCurrent / attackerState.hpMax,
        });

        aiDecisions.push({
          attackerId: opp.combatantId,
          used: shouldUseReaction,
          reason: shouldUseReaction ? "ai_used" : "ai_declined",
        });

        // Update pending action with AI's decision
        if (shouldUseReaction && opp.opportunityId) {
          const updatedResolvedReactions = [
            ...pendingAction.resolvedReactions,
            {
              opportunityId: opp.opportunityId,
              combatantId: opp.combatantId,
              choice: "use" as const,
              respondedAt: new Date(),
            },
          ];
          await this.pendingActions.update({
            ...pendingAction,
            resolvedReactions: updatedResolvedReactions,
          });
        }
      }
    }

    // Check if there are player OAs that need prompting
    const playerOAsNeedingInput = aiDecisions.filter((d) => d.reason === "player_prompted");
    if (playerOAsNeedingInput.length > 0 && moveInit.pendingActionId) {
      // Get the pending action to include opportunity info
      const pendingAction = await this.pendingActions.getById(moveInit.pendingActionId);
      
      // Store the pending action details in the encounter so the CLI can detect the OA
      await this.combat.setPendingAction(encounterId, {
        id: moveInit.pendingActionId,
        type: "opportunity_attack_pending",
        pendingActionId: moveInit.pendingActionId,
        opportunities: moveInit.opportunityAttacks.map((opp) => ({
          combatantId: opp.combatantId,
          combatantName: opp.combatantName,
          canAttack: opp.canAttack,
          hasReaction: opp.hasReaction,
          opportunityId: opp.opportunityId,
        })),
        target: actorRef,
        destination: finalDestination,
      });

      // Return success but indicate we're awaiting player input
      const mainSummary = `Moved toward (${finalDestination.x}, ${finalDestination.y}) - awaiting ${playerOAsNeedingInput.length} player OA(s)`;

      return {
        action: decision.action,
        ok: true,
        summary: mainSummary,
        data: {
          awaitingPlayerInput: true,
          playerOAsCount: playerOAsNeedingInput.length,
          pendingActionId: moveInit.pendingActionId,
        },
      };
    }

    // No player OAs, or all reactions resolved - complete the move
    const moveComplete = await this.twoPhaseActions.completeMove(sessionId, {
      pendingActionId: moveInit.pendingActionId || "",
    });

    movedFeet = moveComplete.movedFeet;

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);

    const usedCount = aiDecisions.filter((d) => d.used).length;
    const playerPromptCount = aiDecisions.filter((d) => d.reason === "player_prompted").length;
    const oaSummary =
      moveInit.opportunityAttacks.length > 0
        ? `, triggered ${usedCount}/${moveInit.opportunityAttacks.length} OA(s)` +
          (playerPromptCount > 0 ? ` (${playerPromptCount} awaiting player input)` : "")
        : "";
    const mainSummary = `Moved ${movedFeet}ft to (${finalDestination.x}, ${finalDestination.y})${oaSummary}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: {
        movedFeet,
        destination: decision.destination,
        opportunityAttacks: moveComplete.opportunityAttacks,
        aiReactionDecisions: aiDecisions,
        ...(bonusResult ? { bonusAction: bonusResult } : {}),
      },
    };
  }

  /**
   * Execute a "moveToward" decision: resolve target position, A* pathfind, clamp to speed, two-phase move.
   */
  private async executeMoveToward(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!decision.target) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: moveToward requires a target name",
        data: { reason: "missing_target" },
      };
    }

    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    // Resolve actor position
    const resources = (aiCombatant.resources as Record<string, unknown>) ?? {};
    const currentPos = resources.position as { x: number; y: number } | undefined;
    if (!currentPos) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Actor has no position",
        data: { reason: "no_actor_position" },
      };
    }

    // Resolve target combatant
    const targetCombatant = await this.findCombatantByName(decision.target, allCombatants);
    if (!targetCombatant) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target "${decision.target}" not found`,
        data: { reason: "target_not_found" },
      };
    }

    const targetResources = (targetCombatant.resources as Record<string, unknown>) ?? {};
    const targetPos = targetResources.position as { x: number; y: number } | undefined;
    if (!targetPos) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target "${decision.target}" has no position`,
        data: { reason: "target_no_position" },
      };
    }

    const desiredRange = decision.desiredRange ?? 5;

    // Check if already in range
    const currentDistance = calculateDistance(currentPos, targetPos);
    if (currentDistance <= desiredRange) {
      return {
        action: decision.action,
        ok: true,
        summary: `Already within ${desiredRange}ft of ${decision.target} (${Math.round(currentDistance)}ft away)`,
        data: { movedFeet: 0, alreadyInRange: true },
      };
    }

    // Calculate effective speed
    const speed = getEffectiveSpeed(aiCombatant.resources);
    const hasDashed = (resources.dashed as boolean) ?? false;
    let effectiveSpeed = hasDashed ? speed * 2 : speed;

    // Account for Prone stand-up cost
    const aiConditions = normalizeConditions(aiCombatant.conditions as unknown[]);
    const isProne = hasCondition(aiConditions, "Prone");
    if (isProne) {
      const standUpCost = Math.ceil(speed / 2);
      effectiveSpeed -= standUpCost;
      this.aiLog(`[AiActionExecutor] Prone stand-up costs ${standUpCost}ft, effective speed: ${effectiveSpeed}ft`);
      if (effectiveSpeed <= 0) {
        return {
          action: decision.action,
          ok: false,
          summary: `Failed: Standing from Prone costs ${Math.ceil(speed / 2)}ft, no movement remaining`,
          data: { reason: "prone_no_movement" },
        };
      }
    }

    // Try to get combat map for A* pathfinding
    let combatMap: CombatMap | undefined;
    try {
      const encounter = await this.combat.getEncounterById(encounterId);
      combatMap = encounter?.mapData as unknown as CombatMap | undefined;
    } catch {
      // No map available, fall back to linear interpolation
    }

    let finalDestination: { x: number; y: number };
    let pathCells: { x: number; y: number }[] | undefined;
    let pathCostFeet: number | undefined;
    let pathNarrationHints: string[] | undefined;

    if (combatMap) {
      // Use A* pathfinding
      const dest = findAdjacentPosition(combatMap, targetPos, currentPos, desiredRange);
      if (!dest) {
        return {
          action: decision.action,
          ok: false,
          summary: `Failed: No reachable position within ${desiredRange}ft of ${decision.target}`,
          data: { reason: "no_reachable_position" },
        };
      }

      // Build occupied positions (exclude self and target)
      const occupiedPositions = allCombatants
        .filter((c) => c.id !== aiCombatant.id && c.id !== targetCombatant.id)
        .map((c) => (c.resources as Record<string, unknown>)?.position as { x: number; y: number })
        .filter((p): p is { x: number; y: number } => !!p && typeof p.x === "number" && typeof p.y === "number");

      const pathResult = findPath(combatMap, currentPos, dest, {
        maxCostFeet: effectiveSpeed,
        occupiedPositions,
        zones: getMapZones(combatMap),
      });

      if (pathResult.blocked && pathResult.path.length === 0) {
        return {
          action: decision.action,
          ok: false,
          summary: `Failed: Path to ${decision.target} is completely blocked`,
          data: { reason: "path_blocked" },
        };
      }

      // Use reachable position (might be partial path if speed insufficient to reach destination)
      finalDestination = pathResult.reachablePosition ?? dest;
      pathCells = pathResult.path;
      pathCostFeet = pathResult.totalCostFeet;
      pathNarrationHints = pathResult.narrationHints;
    } else {
      // No map: linear interpolation toward target, clamped to speed
      const dx = targetPos.x - currentPos.x;
      const dy = targetPos.y - currentPos.y;
      const dist = currentDistance - desiredRange;
      const moveDist = Math.min(dist, effectiveSpeed);
      const ratio = moveDist / currentDistance;
      finalDestination = {
        x: Math.round(currentPos.x + dx * ratio),
        y: Math.round(currentPos.y + dy * ratio),
      };
    }

    // Initiate two-phase move (with pathfinding data if available)
    const moveInit = await this.twoPhaseActions.initiateMove(sessionId, {
      encounterId,
      actor: actorRef,
      destination: finalDestination,
      pathCells,
      pathCostFeet,
      pathNarrationHints,
    });

    const targetName = await this.combatantResolver.getName(
      this.toCombatantRef(targetCombatant) ?? actorRef,
      targetCombatant,
    );
    const actorName = await this.combatantResolver.getName(actorRef, aiCombatant);

    let movedFeet = 0;
    const aiDecisions: Array<{ attackerId: string; used: boolean; reason: string }> = [];

    if (moveInit.status === "aborted_by_trigger") {
      const triggerMsg = moveInit.voluntaryMoveTriggerMessages?.join(" ") ?? "Movement trigger damage!";
      return {
        action: decision.action,
        ok: false,
        summary: `${triggerMsg} Knocked out before moving.`,
        data: { reason: "knocked_out_by_movement_trigger" },
      };
    }

    if (moveInit.status === "no_reactions") {
      movedFeet = currentPos ? Math.round(calculateDistance(currentPos, finalDestination)) : 0;

      const currentRemaining = typeof resources.movementRemaining === "number"
        ? resources.movementRemaining
        : effectiveSpeed;
      const newMovementRemaining = Math.max(0, currentRemaining - (pathCostFeet ?? movedFeet));

      await this.combat.updateCombatantState(aiCombatant.id, {
        resources: {
          ...resources,
          position: finalDestination,
          movementSpent: newMovementRemaining <= 0,
          movementRemaining: newMovementRemaining,
        } as any,
      });

      // Keep CombatMap entities[] in sync with the position update
      await syncEntityPosition(this.combat, encounterId, aiCombatant.id, finalDestination);

      // Sync aura zones for this combatant
      const mtEntityId = aiCombatant.characterId ?? aiCombatant.monsterId ?? aiCombatant.npcId ?? aiCombatant.id;
      await syncAuraZones(this.combat, encounterId, mtEntityId, finalDestination);

      // --- Zone damage during AI moveToward ---
      const mtEncounter = await this.combat.getEncounterById(encounterId);
      if (mtEncounter && currentPos) {
        const mtCombatMap = mtEncounter.mapData as unknown as import("../../../../domain/rules/combat-map.js").CombatMap | undefined;
        if (mtCombatMap && (mtCombatMap.zones?.length ?? 0) > 0) {
          const mtIsPC = aiCombatant.combatantType === "Character" || aiCombatant.combatantType === "NPC";
          const mtCombatants = await this.combat.listCombatants(encounterId);
          await resolveZoneDamageForPath(
            pathCells ?? [finalDestination],
            currentPos,
            aiCombatant,
            mtCombatMap,
            (srcId: string) => {
              const src = mtCombatants.find((c: any) => (c.characterId ?? c.monsterId ?? c.npcId) === srcId);
              const srcIsPC = src ? (src.combatantType === "Character" || src.combatantType === "NPC") : false;
              return mtIsPC === srcIsPC;
            },
            { damageResistances: [], damageImmunities: [], damageVulnerabilities: [] },
            { combatRepo: this.combat },
          );
        }
      }

      const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
      const pathNarration = buildPathNarration({
        actorName,
        targetName,
        pathCells,
        pathCostFeet,
        desiredRange,
        narrationHints: pathNarrationHints,
        partial: pathCostFeet != null && pathCostFeet < calculateDistance(currentPos, finalDestination),
        startPosition: currentPos,
        endPosition: finalDestination,
      });
      const mainSummary = pathNarration;
      const fullSummary = bonusResult ? `${mainSummary} ${bonusResult.summary}` : mainSummary;

      return {
        action: decision.action,
        ok: true,
        summary: fullSummary,
        data: {
          movedFeet: pathCostFeet ?? movedFeet,
          destination: finalDestination,
          targetName,
          desiredRange,
          pathNarration,
          pathNarrationHints,
          opportunityAttacks: [],
          ...(bonusResult ? { bonusAction: bonusResult } : {}),
        },
      };
    }

    // If there are reactions, resolve them (same flow as executeMove)
    if (moveInit.status === "awaiting_reactions" && moveInit.pendingActionId) {
      const pendingAction = await this.pendingActions.getById(moveInit.pendingActionId);
      if (!pendingAction) {
        return {
          action: decision.action,
          ok: false,
          summary: "Failed: Pending action not found",
          data: { reason: "pending_action_missing" },
        };
      }

      for (const opp of moveInit.opportunityAttacks) {
        if (!opp.canAttack) {
          aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "cannot_attack" });
          continue;
        }

        const attackerState = allCombatants.find((c) => c.id === opp.combatantId);
        if (!attackerState) {
          aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "attacker_not_found" });
          continue;
        }

        if (attackerState.combatantType === "Character") {
          aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "player_prompted" });
          continue;
        }

        const shouldUseReaction = await this.aiDecideReaction(attackerState, "opportunity_attack", {
          targetName: await this.combatantResolver.getName(actorRef, aiCombatant),
          hpPercent: attackerState.hpCurrent / attackerState.hpMax,
        });

        aiDecisions.push({
          attackerId: opp.combatantId,
          used: shouldUseReaction,
          reason: shouldUseReaction ? "ai_used" : "ai_declined",
        });

        if (shouldUseReaction && opp.opportunityId) {
          const updatedResolvedReactions = [
            ...pendingAction.resolvedReactions,
            {
              opportunityId: opp.opportunityId,
              combatantId: opp.combatantId,
              choice: "use" as const,
              respondedAt: new Date(),
            },
          ];
          await this.pendingActions.update({
            ...pendingAction,
            resolvedReactions: updatedResolvedReactions,
          });
        }
      }
    }

    // Check if there are player OAs that need prompting
    const playerOAsNeedingInput = aiDecisions.filter((d) => d.reason === "player_prompted");
    if (playerOAsNeedingInput.length > 0 && moveInit.pendingActionId) {
      await this.combat.setPendingAction(encounterId, {
        id: moveInit.pendingActionId,
        type: "opportunity_attack_pending",
        pendingActionId: moveInit.pendingActionId,
        opportunities: moveInit.opportunityAttacks.map((opp) => ({
          combatantId: opp.combatantId,
          combatantName: opp.combatantName,
          canAttack: opp.canAttack,
          hasReaction: opp.hasReaction,
          opportunityId: opp.opportunityId,
        })),
        target: actorRef,
        destination: finalDestination,
      });

      return {
        action: decision.action,
        ok: true,
        summary: `Moved toward ${targetName} - awaiting ${playerOAsNeedingInput.length} player OA(s)`,
        data: {
          awaitingPlayerInput: true,
          playerOAsCount: playerOAsNeedingInput.length,
          pendingActionId: moveInit.pendingActionId,
        },
      };
    }

    // No player OAs — complete the move
    const moveComplete = await this.twoPhaseActions.completeMove(sessionId, {
      pendingActionId: moveInit.pendingActionId || "",
    });

    movedFeet = moveComplete.movedFeet;

    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);

    const usedCount = aiDecisions.filter((d) => d.used).length;
    const oaSummary =
      moveInit.opportunityAttacks.length > 0
        ? ` Triggered ${usedCount}/${moveInit.opportunityAttacks.length} OA(s).`
        : "";
    const pathNarration = buildPathNarration({
      actorName,
      targetName,
      pathCells,
      pathCostFeet: movedFeet,
      desiredRange,
      narrationHints: pathNarrationHints,
      partial: false,
      startPosition: currentPos,
      endPosition: finalDestination,
    });
    const mainSummary = `${pathNarration}${oaSummary}`;
    const fullSummary = bonusResult ? `${mainSummary} ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: {
        movedFeet,
        destination: finalDestination,
        targetName,
        desiredRange,
        pathNarration,
        pathNarrationHints,
        opportunityAttacks: moveComplete.opportunityAttacks,
        aiReactionDecisions: aiDecisions,
        ...(bonusResult ? { bonusAction: bonusResult } : {}),
      },
    };
  }

  /**
   * Execute a "moveAwayFrom" decision: move as far as possible AWAY from the named target.
   * Server handles retreat pathfinding — LLM only needs to name who to flee from.
   */
  private async executeMoveAwayFrom(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!decision.target) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: moveAwayFrom requires a target name",
        data: { reason: "missing_target" },
      };
    }

    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const resources = (aiCombatant.resources as Record<string, unknown>) ?? {};
    const currentPos = resources.position as { x: number; y: number } | undefined;
    if (!currentPos) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Actor has no position",
        data: { reason: "no_actor_position" },
      };
    }

    // Resolve target position (flee FROM this creature)
    const targetCombatant = await this.findCombatantByName(decision.target, allCombatants);
    if (!targetCombatant) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target "${decision.target}" not found`,
        data: { reason: "target_not_found" },
      };
    }

    const targetResources = (targetCombatant.resources as Record<string, unknown>) ?? {};
    const targetPos = targetResources.position as { x: number; y: number } | undefined;
    if (!targetPos) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target "${decision.target}" has no position`,
        data: { reason: "target_no_position" },
      };
    }

    // Calculate effective speed
    const speed = getEffectiveSpeed(aiCombatant.resources);
    const hasDashed = (resources.dashed as boolean) ?? false;
    let effectiveSpeed = hasDashed ? speed * 2 : speed;

    // Account for Prone stand-up cost
    const aiConditions = normalizeConditions(aiCombatant.conditions as unknown[]);
    const isProne = hasCondition(aiConditions, "Prone");
    if (isProne) {
      const standUpCost = Math.ceil(speed / 2);
      effectiveSpeed -= standUpCost;
      if (effectiveSpeed <= 0) {
        return {
          action: decision.action,
          ok: false,
          summary: `Failed: Standing from Prone costs ${Math.ceil(speed / 2)}ft, no movement remaining`,
          data: { reason: "prone_no_movement" },
        };
      }
    }

    // Try to get combat map
    let combatMap: CombatMap | undefined;
    try {
      const encounter = await this.combat.getEncounterById(encounterId);
      combatMap = encounter?.mapData as unknown as CombatMap | undefined;
    } catch {
      // No map
    }

    // Build occupied positions (exclude self)
    const occupiedPositions = allCombatants
      .filter((c) => c.id !== aiCombatant.id)
      .map((c) => (c.resources as Record<string, unknown>)?.position as { x: number; y: number })
      .filter((p): p is { x: number; y: number } => !!p && typeof p.x === "number" && typeof p.y === "number");

    // Get zones for pathfinding awareness
    let zones: import("../../../../domain/entities/combat/zones.js").CombatZone[] | undefined;
    if (combatMap) {
      zones = getMapZones(combatMap);
    }

    const retreatDest = findRetreatPosition(
      combatMap,
      currentPos,
      targetPos,
      effectiveSpeed,
      occupiedPositions,
      zones,
    );

    const retreatDistance = calculateDistance(currentPos, retreatDest);
    if (retreatDistance < 1) {
      return {
        action: decision.action,
        ok: true,
        summary: `Cannot retreat further from ${decision.target} — surrounded or blocked`,
        data: { movedFeet: 0, blocked: true },
      };
    }

    // Use A* pathfinding to get the actual path if map is available
    let pathCells: { x: number; y: number }[] | undefined;
    let pathCostFeet: number | undefined;
    let pathNarrationHints: string[] | undefined;

    if (combatMap) {
      const pathResult = findPath(combatMap, currentPos, retreatDest, {
        maxCostFeet: effectiveSpeed,
        occupiedPositions,
        zones,
      });
      if (!pathResult.blocked || pathResult.path.length > 0) {
        retreatDest.x = (pathResult.reachablePosition ?? retreatDest).x;
        retreatDest.y = (pathResult.reachablePosition ?? retreatDest).y;
        pathCells = pathResult.path;
        pathCostFeet = pathResult.totalCostFeet;
        pathNarrationHints = pathResult.narrationHints;
      }
    }

    // Initiate two-phase move
    const moveInit = await this.twoPhaseActions.initiateMove(sessionId, {
      encounterId,
      actor: actorRef,
      destination: retreatDest,
      pathCells,
      pathCostFeet,
      pathNarrationHints,
    });

    const actorName = await this.combatantResolver.getName(actorRef, aiCombatant);
    const targetName = await this.combatantResolver.getName(
      this.toCombatantRef(targetCombatant) ?? actorRef,
      targetCombatant,
    );

    if (moveInit.status === "aborted_by_trigger") {
      const triggerMsg = moveInit.voluntaryMoveTriggerMessages?.join(" ") ?? "Movement trigger damage!";
      return {
        action: decision.action,
        ok: false,
        summary: `${triggerMsg} Knocked out before retreating.`,
        data: { reason: "knocked_out_by_movement_trigger" },
      };
    }

    if (moveInit.status === "no_reactions") {
      const movedFeet = Math.round(calculateDistance(currentPos, retreatDest));

      const currentRemaining = typeof resources.movementRemaining === "number"
        ? resources.movementRemaining
        : effectiveSpeed;
      const newMovementRemaining = Math.max(0, currentRemaining - (pathCostFeet ?? movedFeet));

      await this.combat.updateCombatantState(aiCombatant.id, {
        resources: {
          ...resources,
          position: retreatDest,
          movementSpent: newMovementRemaining <= 0,
          movementRemaining: newMovementRemaining,
        } as any,
      });

      await syncEntityPosition(this.combat, encounterId, aiCombatant.id, retreatDest);

      const mtEntityId = aiCombatant.characterId ?? aiCombatant.monsterId ?? aiCombatant.npcId ?? aiCombatant.id;
      await syncAuraZones(this.combat, encounterId, mtEntityId, retreatDest);

      // Zone damage along retreat path
      const mtEncounter = await this.combat.getEncounterById(encounterId);
      if (mtEncounter && currentPos) {
        const mtCombatMap = mtEncounter.mapData as unknown as CombatMap | undefined;
        if (mtCombatMap && (mtCombatMap.zones?.length ?? 0) > 0) {
          const mtIsPC = aiCombatant.combatantType === "Character" || aiCombatant.combatantType === "NPC";
          const mtCombatants = await this.combat.listCombatants(encounterId);
          await resolveZoneDamageForPath(
            pathCells ?? [retreatDest],
            currentPos,
            aiCombatant,
            mtCombatMap,
            (srcId: string) => {
              const src = mtCombatants.find((c: any) => (c.characterId ?? c.monsterId ?? c.npcId) === srcId);
              const srcIsPC = src ? (src.combatantType === "Character" || src.combatantType === "NPC") : false;
              return mtIsPC === srcIsPC;
            },
            { damageResistances: [], damageImmunities: [], damageVulnerabilities: [] },
            { combatRepo: this.combat },
          );
        }
      }

      const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
      const newDist = Math.round(calculateDistance(retreatDest, targetPos));
      const mainSummary = `${actorName} retreats ${pathCostFeet ?? movedFeet}ft from ${targetName} (now ${newDist}ft away)`;
      const fullSummary = bonusResult ? `${mainSummary}. ${bonusResult.summary}` : mainSummary;

      return {
        action: decision.action,
        ok: true,
        summary: fullSummary,
        data: {
          movedFeet: pathCostFeet ?? movedFeet,
          destination: retreatDest,
          targetName,
          retreatedFromDistance: Math.round(calculateDistance(currentPos, targetPos)),
          newDistance: newDist,
          ...(bonusResult ? { bonusAction: bonusResult } : {}),
        },
      };
    }

    // Reactions pending (opportunity attacks) — same handling as moveToward
    const aiDecisions: Array<{ attackerId: string; used: boolean; reason: string }> = [];

    if (moveInit.status === "awaiting_reactions" && moveInit.pendingActionId) {
      const pendingAction = await this.pendingActions.getById(moveInit.pendingActionId);
      if (!pendingAction) {
        return {
          action: decision.action,
          ok: false,
          summary: "Failed: Pending action not found",
          data: { reason: "pending_action_missing" },
        };
      }

      for (const opp of moveInit.opportunityAttacks) {
        if (!opp.canAttack) {
          aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "cannot_attack" });
          continue;
        }

        const attackerState = allCombatants.find((c) => c.id === opp.combatantId);
        if (!attackerState) {
          aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "attacker_not_found" });
          continue;
        }

        if (attackerState.combatantType === "Character") {
          aiDecisions.push({ attackerId: opp.combatantId, used: false, reason: "player_prompted" });
          continue;
        }

        const shouldUseReaction = await this.aiDecideReaction(attackerState, "opportunity_attack", {
          targetName: await this.combatantResolver.getName(actorRef, aiCombatant),
          hpPercent: attackerState.hpCurrent / attackerState.hpMax,
        });

        aiDecisions.push({
          attackerId: opp.combatantId,
          used: shouldUseReaction,
          reason: shouldUseReaction ? "ai_used" : "ai_declined",
        });

        if (shouldUseReaction && opp.opportunityId) {
          const updatedResolvedReactions = [
            ...pendingAction.resolvedReactions,
            {
              opportunityId: opp.opportunityId,
              combatantId: opp.combatantId,
              choice: "use" as const,
              respondedAt: new Date(),
            },
          ];
          await this.pendingActions.update({
            ...pendingAction,
            resolvedReactions: updatedResolvedReactions,
          });
        }
      }
    }

    // Player OAs need prompting
    const playerOAsNeedingInput = aiDecisions.filter((d) => d.reason === "player_prompted");
    if (playerOAsNeedingInput.length > 0 && moveInit.pendingActionId) {
      await this.combat.setPendingAction(encounterId, {
        id: moveInit.pendingActionId,
        type: "opportunity_attack_pending",
        pendingActionId: moveInit.pendingActionId,
        opportunities: moveInit.opportunityAttacks.map((opp) => ({
          combatantId: opp.combatantId,
          combatantName: opp.combatantName,
          canAttack: opp.canAttack,
          hasReaction: opp.hasReaction,
          opportunityId: opp.opportunityId,
        })),
        target: actorRef,
        destination: retreatDest,
      });

      return {
        action: decision.action,
        ok: true,
        summary: `Retreating from ${targetName} — awaiting ${playerOAsNeedingInput.length} player OA(s)`,
        data: {
          awaitingPlayerInput: true,
          playerOAsCount: playerOAsNeedingInput.length,
          pendingActionId: moveInit.pendingActionId,
        },
      };
    }

    // Complete the move after reactions resolve
    const moveComplete = await this.twoPhaseActions.completeMove(sessionId, {
      pendingActionId: moveInit.pendingActionId || "",
    });

    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const newDist = Math.round(calculateDistance(retreatDest, targetPos));
    const usedCount = aiDecisions.filter((d) => d.used).length;
    const oaSummary = moveInit.opportunityAttacks.length > 0
      ? ` Triggered ${usedCount}/${moveInit.opportunityAttacks.length} OA(s).`
      : "";
    const mainSummary = `${actorName} retreats ${moveComplete.movedFeet}ft from ${targetName} (now ${newDist}ft away).${oaSummary}`;
    const fullSummary = bonusResult ? `${mainSummary} ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: {
        movedFeet: moveComplete.movedFeet,
        destination: retreatDest,
        targetName,
        newDistance: newDist,
        opportunityAttacks: moveComplete.opportunityAttacks,
        aiReactionDecisions: aiDecisions,
        ...(bonusResult ? { bonusAction: bonusResult } : {}),
      },
    };
  }

  private async executeBasicAction(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    let mainSummary = "";
    if (decision.action === "disengage") {
      await this.actionService.disengage(sessionId, { encounterId, actor: actorRef });
      mainSummary = "Disengaged (no opportunity attacks while moving this turn)";
    } else if (decision.action === "dash") {
      await this.actionService.dash(sessionId, { encounterId, actor: actorRef });
      mainSummary = "Dashed (movement speed doubled for this turn)";
    } else {
      await this.actionService.dodge(sessionId, { encounterId, actor: actorRef });
      mainSummary = "Dodged (enemies have disadvantage on attacks until next turn)";
    }

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: bonusResult ? { bonusAction: bonusResult } : undefined,
    };
  }

  private async executeHelp(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }
    if (!decision.target) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Help requires a target",
        data: { reason: "missing_target" },
      };
    }

    const targetCombatant = await this.findCombatantByName(decision.target, allCombatants);
    if (!targetCombatant) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target ${decision.target} not found`,
        data: { reason: "target_not_found", target: decision.target },
      };
    }

    const targetRef = this.toCombatantRef(targetCombatant);
    if (!targetRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid target reference",
        data: { reason: "invalid_target_reference" },
      };
    }

    await this.actionService.help(sessionId, { encounterId, actor: actorRef, target: targetRef });

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const mainSummary = `Helped ${decision.target} (next check/attack gains advantage, depending on context)`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: { target: decision.target, ...(bonusResult ? { bonusAction: bonusResult } : {}) },
    };
  }

  private async executeCastSpell(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const spellNameRaw = (decision as Record<string, unknown>).spellName;
    const spellName = typeof spellNameRaw === "string" ? spellNameRaw.trim() : "";
    if (spellName.length === 0) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: castSpell requires spellName",
        data: { reason: "missing_spell_name" },
      };
    }

    // Determine spell level from the decision or default to 1
    const spellLevelRaw = (decision as Record<string, unknown>).spellLevel;
    const spellLevel = typeof spellLevelRaw === "number" ? spellLevelRaw : 1;

    // Use two-phase spell cast flow to detect Counterspell opportunities
    const initiateResult = await this.twoPhaseActions.initiateSpellCast(sessionId, {
      encounterId,
      actor: actorRef as CombatantRef,
      spellName,
      spellLevel,
    });

    console.log("[AiActionExecutor] initiateSpellCast result:", {
      status: initiateResult.status,
      pendingActionId: initiateResult.pendingActionId,
      counterspellOpportunities: initiateResult.counterspellOpportunities.length,
    });

    if (initiateResult.status === "awaiting_reactions" && initiateResult.pendingActionId) {
      console.log("[AiActionExecutor] Spell cast awaiting Counterspell reaction from player");

      // Store pending action on encounter for reaction route polling
      await this.combat.setPendingAction(encounterId, {
        id: initiateResult.pendingActionId,
        type: "reaction_pending",
        pendingActionId: initiateResult.pendingActionId,
        reactionType: "counterspell",
        spellName,
        spellLevel,
      });

      // Mark action as spent
      const { spendAction } = await import("../helpers/resource-utils.js");
      await this.combat.updateCombatantState(aiCombatant.id, {
        resources: spendAction(aiCombatant.resources),
      });

      return {
        action: decision.action,
        ok: true,
        summary: `Casting ${spellName} - awaiting Counterspell reaction`,
        data: {
          awaitingPlayerInput: true,
          pendingActionId: initiateResult.pendingActionId,
          spellName,
          spellLevel,
        },
      };
    }

    // No Counterspell opportunities — spell resolves immediately
    // Use cosmetic castSpell to mark action spent + emit event
    await this.actionService.castSpell(sessionId, { encounterId, actor: actorRef, spellName });

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const mainSummary = `Cast spell: ${spellName}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: { spellName, spellLevel, ...(bonusResult ? { bonusAction: bonusResult } : {}) },
    };
  }

  private async executeShove(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!decision.target) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Shove requires target",
        data: { reason: "missing_target" },
      };
    }

    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const targetCombatant = await this.findCombatantByName(decision.target, allCombatants);
    if (!targetCombatant) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target ${decision.target} not found`,
        data: { reason: "target_not_found", target: decision.target },
      };
    }

    const targetRef = this.toCombatantRef(targetCombatant);
    if (!targetRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid target reference",
        data: { reason: "invalid_target_reference" },
      };
    }

    const seed = typeof (decision as Record<string, unknown>).seed === "number"
      ? (decision as Record<string, unknown>).seed as number
      : undefined;
    const result = await this.actionService.shove(sessionId, {
      encounterId,
      actor: actorRef,
      target: targetRef,
      shoveType: "push",
      ...(seed !== undefined ? { seed } : {}),
    } as Parameters<CombatActionService["shove"]>[1]);

    const data: Record<string, unknown> = {
      target: decision.target,
      success: result.result.success,
      attackerRoll: result.result.attackerRoll,
      targetRoll: result.result.targetRoll,
      ...(result.result.pushedTo ? { pushedTo: result.result.pushedTo } : {}),
      ...(seed !== undefined ? { seed } : {}),
    };

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) {
      data.bonusAction = bonusResult;
    }

    if (result.result.success) {
      const mainSummary = result.result.pushedTo
        ? `Shove succeeded: pushed ${decision.target} to (${result.result.pushedTo.x}, ${result.result.pushedTo.y})`
        : `Shove succeeded against ${decision.target}`;
      const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
      return { action: decision.action, ok: true, summary: fullSummary, data };
    }

    const mainSummary = `Shove failed against ${decision.target} (attacker ${result.result.attackerRoll} vs target ${result.result.targetRoll})`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data,
    };
  }

  private async executeGrapple(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    allCombatants: CombatantStateRecord[],
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!decision.target) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Grapple requires target",
        data: { reason: "missing_target" },
      };
    }

    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const targetCombatant = await this.findCombatantByName(decision.target, allCombatants);
    if (!targetCombatant) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target ${decision.target} not found`,
        data: { reason: "target_not_found", target: decision.target },
      };
    }

    const targetRef = this.toCombatantRef(targetCombatant);
    if (!targetRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid target reference",
        data: { reason: "invalid_target_reference" },
      };
    }

    const seed = typeof (decision as Record<string, unknown>).seed === "number"
      ? (decision as Record<string, unknown>).seed as number
      : undefined;
    const result = await this.actionService.grapple(sessionId, {
      encounterId,
      actor: actorRef,
      target: targetRef,
      ...(seed !== undefined ? { seed } : {}),
    } as Parameters<CombatActionService["grapple"]>[1]);

    const data: Record<string, unknown> = {
      target: decision.target,
      success: result.result.success,
      attackerRoll: result.result.attackerRoll,
      targetRoll: result.result.targetRoll,
      ...(seed !== undefined ? { seed } : {}),
    };

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) {
      data.bonusAction = bonusResult;
    }

    if (result.result.success) {
      const mainSummary = `Grapple succeeded: ${decision.target} is grappled (attacker ${result.result.attackerRoll} vs target ${result.result.targetRoll})`;
      const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
      return { action: decision.action, ok: true, summary: fullSummary, data };
    }

    const mainSummary = `Grapple failed against ${decision.target} (attacker ${result.result.attackerRoll} vs target ${result.result.targetRoll})`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data,
    };
  }

  private async executeHide(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const result = await this.actionService.hide(sessionId, {
      encounterId,
      actor: actorRef,
      hasCover: true, // AI assumes cover is available
    });

    const data: Record<string, unknown> = {
      success: result.result.success,
      stealthRoll: result.result.stealthRoll,
    };

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) {
      data.bonusAction = bonusResult;
    }

    const mainSummary = result.result.success
      ? `Hide succeeded: stealth roll ${result.result.stealthRoll}`
      : `Hide failed: stealth roll ${result.result.stealthRoll}${result.result.reason ? ` (${result.result.reason})` : ""}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data,
    };
  }

  private async executeSearch(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const result = await this.actionService.search(sessionId, {
      encounterId,
      actor: actorRef,
    });

    const data: Record<string, unknown> = {
      found: result.result.found,
      roll: result.result.roll,
    };

    // Process bonus action if included
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) {
      data.bonusAction = bonusResult;
    }

    const mainSummary = result.result.found.length > 0
      ? `Search: found ${result.result.found.join(", ")} (perception roll ${result.result.roll})`
      : `Search: no hidden creatures found (perception roll ${result.result.roll})`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data,
    };
  }

  private async executeEndTurn(
    sessionId: string,
    encounterId: string,
    aiCombatant: CombatantStateRecord,
    decision: AiDecision,
    actorRef: ActorRef | null,
  ): Promise<Omit<TurnStepResult, "step">> {
    // Process bonus action even if ending turn (e.g., Nimble Escape without main action)
    const bonusResult = await this.executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const summary = bonusResult ? `Ended turn (bonus action: ${bonusResult.summary})` : "Ended turn";
    return {
      action: decision.action,
      ok: true,
      summary,
      data: bonusResult ? { bonusAction: bonusResult } : undefined,
    };
  }

  /**
   * Execute bonus action using the ability registry.
   * Falls back to legacy string matching for backward compatibility.
   * Returns summary of bonus action result, or null if none.
   */
  private async executeBonusAction(
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
        const result = await this.abilityRegistry.execute({
          sessionId,
          encounterId,
          actor: {
            getId: () => actorEntityId,
            getName: () => (aiCombatant as any).name ?? "Unknown",
            getCurrentHP: () => aiCombatant.hpCurrent ?? 0,
            getMaxHP: () => aiCombatant.hpMax ?? 0,
            getSpeed: () => 30,
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
            resources: aiCombatant.resources,
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
          const updatedResources = spendResourceFromPool(
            aiCombatant.resources,
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

    // Legacy string matching for backward compatibility
    const bonus = bonusActionId.toLowerCase();

    try {
      // Nimble Escape: Disengage as bonus action
      if (bonus === "nimble_escape_disengage" || bonus === "disengage") {
        await this.actionService.disengage(sessionId, { encounterId, actor: actorRef });
        return { action: "disengage", summary: "Disengaged (bonus action)" };
      }

      // Nimble Escape: Hide as bonus action
      if (bonus === "nimble_escape_hide" || bonus === "hide") {
        const hideResult = await this.actionService.hide(sessionId, { encounterId, actor: actorRef, isBonusAction: true });
        const outcome = hideResult.result.success ? `Hidden (Stealth: ${hideResult.result.stealthRoll})` : `failed to hide`;
        return { action: "hide", summary: `${outcome} (bonus action)` };
      }

      // Cunning Action (Rogue): Dash as bonus action
      if (bonus === "cunning_action_dash") {
        await this.actionService.dash(sessionId, { encounterId, actor: actorRef });
        return { action: "dash", summary: "Dashed (bonus action)" };
      }

      // Cunning Action (Rogue): Disengage as bonus action
      if (bonus === "cunning_action_disengage") {
        await this.actionService.disengage(sessionId, { encounterId, actor: actorRef });
        return { action: "disengage", summary: "Disengaged (bonus action)" };
      }

      // Cunning Action (Rogue): Hide as bonus action
      if (bonus === "cunning_action_hide") {
        const hideResult = await this.actionService.hide(sessionId, { encounterId, actor: actorRef, isBonusAction: true });
        const outcome = hideResult.result.success ? `Hidden (Stealth: ${hideResult.result.stealthRoll})` : `failed to hide`;
        return { action: "hide", summary: `${outcome} (bonus action via Cunning Action)` };
      }

      // Unknown bonus action
      this.aiLog(`[AiActionExecutor] Unknown bonus action: ${decision.bonusAction}`);
      return { action: bonus, summary: `Bonus action ${decision.bonusAction} not implemented` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.aiLog(`[AiActionExecutor] Bonus action failed: ${message}`);
      return { action: bonus, summary: `Bonus action failed: ${message}` };
    }
  }
}
