/**
 * RollStateMachine - Handles all dice-roll resolution for tabletop combat.
 *
 * Manages the state transitions:
 *   INITIATIVE → combat started
 *   ATTACK     → hit/miss → DAMAGE pending
 *   DAMAGE     → HP reduction, victory check, flurry strike 2
 *   DEATH_SAVE → stabilized / dead / revived
 *
 * Extracted from TabletopCombatService (Phase 3, Step 14).
 */

import { nanoid } from "nanoid";
import { ValidationError } from "../../../errors.js";
import type {
  SessionCharacterRecord,
  SessionMonsterRecord,
  SessionNPCRecord,
  CombatEncounterRecord,
} from "../../../types.js";
import { calculateDistance } from "../../../../domain/rules/movement.js";
import {
  getPosition,
  normalizeResources,
  getResourcePools,
  hasResourceAvailable,
  getActiveEffects,
} from "../helpers/resource-utils.js";
import {
  calculateBonusFromEffects,
  calculateFlatBonusFromEffects,
} from "../../../../domain/entities/combat/effects.js";
import { applyKoEffectsIfNeeded } from "../helpers/ko-handler.js";
import { ClassFeatureResolver } from "../../../../domain/entities/classes/class-feature-resolver.js";
import { classHasFeature } from "../../../../domain/entities/classes/registry.js";
import { SNEAK_ATTACK } from "../../../../domain/entities/classes/feature-keys.js";
import { getEligibleOnHitEnhancements } from "../../../../domain/entities/classes/combat-text-profile.js";
import { getAllCombatTextProfiles } from "../../../../domain/entities/classes/registry.js";
import {
  normalizeConditions,
  removeCondition,
  type Condition,
} from "../../../../domain/entities/combat/conditions.js";
import {
  buildGameCommandSchemaHint,
  parseGameCommand,
  type LlmRoster,
  type RollResultCommand,
} from "../../../commands/game-command.js";
import type { CombatVictoryStatus } from "../combat-victory-policy.js";
import { sneakAttackDiceForLevel, isSneakAttackEligible } from "../../../../domain/entities/classes/rogue.js";
import {
  makeDeathSave,
  applyDeathSaveResult,
  resetDeathSaves,
  takeDamageWhileUnconscious,
  type DeathSaves,
} from "../../../../domain/rules/death-saves.js";

import { computeFeatModifiers } from "../../../../domain/rules/feat-modifiers.js";
import { doubleDiceInFormula } from "./combat-text-parser.js";
import { findCombatantByEntityId } from "../helpers/combatant-lookup.js";
import type { TabletopEventEmitter } from "./tabletop-event-emitter.js";
import { SavingThrowResolver } from "./rolls/saving-throw-resolver.js";

import type {
  PendingAction as TwoPhasePendingAction,
  PendingLuckyRerollData,
  ReactionOpportunity,
} from "../../../../domain/entities/combat/pending-action.js";
import type {
  TabletopCombatServiceDeps,
  TabletopPendingAction,
  PendingActionType,
  InitiatePendingAction,
  InitiativeSwapPendingAction,
  AttackPendingAction,
  DamagePendingAction,
  DeathSavePendingAction,
  SavingThrowPendingAction,
  SavingThrowAutoResult,
  CombatStartedResult,
  AttackResult,
  DamageResult,
  DeathSaveResult,

  SaveOutcome,
  PendingActionHandlerMap,
  RollProcessingCtx,
} from "./tabletop-types.js";
// assertValidTransition is intentionally not imported here; transition validation belongs at setPendingAction() call sites.
import { InitiativeHandler } from "./rolls/initiative-handler.js";
import { WeaponMasteryResolver } from "./rolls/weapon-mastery-resolver.js";
import { HitRiderResolver } from "./rolls/hit-rider-resolver.js";
import { DamageResolver } from "./rolls/damage-resolver.js";

/**
 * Load session entities and build an LlmRoster.
 * Shared by TabletopCombatService, RollStateMachine, and ActionDispatcher.
 */
export async function loadRoster(
  deps: Pick<TabletopCombatServiceDeps, "characters" | "monsters" | "npcs">,
  sessionId: string,
) {
  const characters = await deps.characters.listBySession(sessionId);
  const monsters = await deps.monsters.listBySession(sessionId);
  const npcs = await deps.npcs.listBySession(sessionId);

  const roster: LlmRoster = {
    characters: characters.map((c) => ({ id: c.id, name: c.name })),
    monsters: monsters.map((m) => ({ id: m.id, name: m.name })),
    npcs: npcs.map((n) => ({ id: n.id, name: n.name })),
  };

  return { characters, monsters, npcs, roster };
}

// ----- RollStateMachine -----

export class RollStateMachine {
  private readonly savingThrowResolver: SavingThrowResolver | null;
  private readonly initiativeHandler: InitiativeHandler;
  private readonly weaponMasteryResolver: WeaponMasteryResolver;
  private readonly hitRiderResolver: HitRiderResolver;
  private readonly damageResolver: DamageResolver;
  /** Exhaustive handler map — Record<PendingActionType, ...> enforces compile-time coverage. */
  private readonly rollHandlers: PendingActionHandlerMap;

  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly eventEmitter: TabletopEventEmitter,
    private readonly debugLogsEnabled: boolean,
  ) {
    this.savingThrowResolver = deps.diceRoller
      ? new SavingThrowResolver(deps.combatRepo, deps.diceRoller, debugLogsEnabled)
      : null;
    this.initiativeHandler = new InitiativeHandler(deps, eventEmitter, debugLogsEnabled);
    this.weaponMasteryResolver = new WeaponMasteryResolver(deps, this.savingThrowResolver, debugLogsEnabled);
    this.hitRiderResolver = new HitRiderResolver(deps, this.savingThrowResolver, debugLogsEnabled);
    this.damageResolver = new DamageResolver(deps, eventEmitter, this.hitRiderResolver, this.weaponMasteryResolver, debugLogsEnabled);

    // Handler map — every key in PendingActionType must have an entry (exhaustiveness check).
    // Adding a new PendingActionType will cause a compile error here until wired in.
    this.rollHandlers = {
      INITIATIVE: (action, ctx) =>
        this.handleInitiativeRoll(
          ctx.sessionId, ctx.encounter, action as InitiatePendingAction,
          ctx.command as RollResultCommand | undefined, ctx.actorId, ctx.characters, ctx.monsters, ctx.npcs,
        ),
      INITIATIVE_SWAP: (action, ctx) =>
        this.handleInitiativeSwap(
          action as InitiativeSwapPendingAction,
          ctx.text, ctx.characters, ctx.monsters, ctx.npcs,
        ),
      ATTACK: (action, ctx) =>
        this.handleAttackRoll(
          ctx.sessionId, ctx.encounter, action as AttackPendingAction,
          ctx.command as RollResultCommand, ctx.actorId, ctx.characters, ctx.monsters, ctx.npcs,
        ),
      DAMAGE: (action, ctx) =>
        this.handleDamageRoll(
          ctx.sessionId, ctx.encounter, action as DamagePendingAction,
          ctx.command as RollResultCommand, ctx.actorId, ctx.characters, ctx.monsters, ctx.npcs, ctx.text,
        ),
      DEATH_SAVE: (action, ctx) =>
        this.handleDeathSaveRoll(
          ctx.sessionId, ctx.encounter, action as DeathSavePendingAction,
          ctx.command as RollResultCommand, ctx.actorId,
        ),
      SAVING_THROW: (action, ctx) =>
        this.handleSavingThrowAction(
          ctx.sessionId, ctx.encounter, action as SavingThrowPendingAction,
          ctx.characters, ctx.monsters, ctx.npcs,
        ),
    };
  }

  /**
   * Drop a thrown weapon on the ground at the target position after a thrown attack.
   * Delegates to DamageResolver (which owns the ground-item logic).
   */
  private async dropThrownWeaponOnGround(
    encounter: CombatEncounterRecord,
    actorId: string,
    targetId: string,
    weaponSpec: { name: string; kind: "melee" | "ranged"; attackBonus: number; damage?: { diceCount: number; diceSides: number; modifier: number }; damageType?: string; properties?: string[]; normalRange?: number; longRange?: number; mastery?: string },
    round: number,
  ): Promise<void> {
    return this.damageResolver.dropThrownWeaponOnGround(encounter, actorId, targetId, weaponSpec, round);
  }

  /**
   * Process a roll result (initiative, attack, damage, death save, or saving throw).
   * Routes to the appropriate handler based on the pending action type.
   * SAVING_THROW actions are auto-resolved (no player roll needed).
   */
  async processRollResult(
    sessionId: string,
    text: string,
    actorId: string,
  ): Promise<CombatStartedResult | AttackResult | DamageResult | DeathSaveResult | SavingThrowAutoResult> {
    const { characters, monsters, npcs, roster } = await loadRoster(this.deps, sessionId);

    // Get pending action
    const encounters = await this.deps.combatRepo.listEncountersBySession(sessionId);
    const encounter = encounters.find((e: any) => e.status === "Pending" || e.status === "Active") ?? encounters[0];

    if (!encounter) {
      throw new ValidationError("No active encounter found");
    }

    const pendingAction = await this.deps.combatRepo.getPendingAction(encounter.id);
    if (!pendingAction || typeof pendingAction !== "object") {
      throw new ValidationError("No pending action found");
    }

    const action = pendingAction as TabletopPendingAction;

    // Map each pending action type to the expected roll-type string used by parseRollValue.
    // Record<PendingActionType, string> here ensures this map stays exhaustive.
    const EXPECTED_ROLL_TYPE: Record<PendingActionType, string> = {
      INITIATIVE:      "initiative",
      INITIATIVE_SWAP: "initiativeSwap",
      ATTACK:          "attack",
      DAMAGE:          "damage",
      DEATH_SAVE:      "deathSave",
      SAVING_THROW:    "savingThrow",
    };

    // SAVING_THROW and INITIATIVE_SWAP skip parseRollValue:
    //   SAVING_THROW  — auto-resolved by the server, no dice roll needed.
    //   INITIATIVE_SWAP — text choice ("swap with X" / "decline"), not a dice roll.
    const SKIP_ROLL_PARSE = new Set<PendingActionType>(["SAVING_THROW", "INITIATIVE_SWAP"]);

    const command = SKIP_ROLL_PARSE.has(action.type)
      ? undefined
      : await this.parseRollValue(text, EXPECTED_ROLL_TYPE[action.type], roster);

    const ctx: RollProcessingCtx = {
      sessionId,
      text,
      actorId,
      encounter,
      characters,
      monsters,
      npcs,
      roster,
      command,
    };

    // Dispatch via exhaustive handler map — replaces the scattered if-chain.
    // TypeScript ensures every PendingActionType has an entry in this.rollHandlers.
    return this.rollHandlers[action.type](action, ctx);
  }

  // ----- Private helpers -----

  private async parseRollValue(text: string, expectedRollType: string, roster: LlmRoster): Promise<RollResultCommand> {
    const D20_ROLL_TYPES = new Set(["attack", "initiative", "deathSave"]);

    const numberFromText = (() => {
      const m = text.match(/\b(\d{1,3})\b/);
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    })();

    if (numberFromText !== null && D20_ROLL_TYPES.has(expectedRollType) && (numberFromText < 1 || numberFromText > 20)) {
      throw new ValidationError(
        `Invalid d20 roll: ${numberFromText}. A d20 roll must be between 1 and 20.`,
      );
    }

    const looksLikeARoll = /\broll(?:ed)?\b/i.test(text);

    if (looksLikeARoll && numberFromText !== null) {
      return { kind: "rollResult" as const, value: numberFromText, rollType: expectedRollType as RollResultCommand["rollType"] };
    }

    if (!this.deps.intentParser) {
      if (numberFromText !== null) {
        return { kind: "rollResult" as const, value: numberFromText, rollType: expectedRollType as RollResultCommand["rollType"] };
      }
      throw new ValidationError("Could not parse roll value from text and LLM is not configured");
    }

    const contextHint = `\n\nCONTEXT: The player has a pending action. When they say "I rolled X", interpret this as rollType="${expectedRollType}".`;
    const intent = await this.deps.intentParser.parseIntent({
      text,
      schemaHint: buildGameCommandSchemaHint(roster) + contextHint,
    });

    try {
      const command = parseGameCommand(intent);
      if (command.kind === "rollResult") return command;
      return {
        kind: "rollResult" as const,
        value: (intent as Record<string, unknown>).value as number ?? (intent as Record<string, unknown>).result as number ?? (intent as Record<string, unknown>).roll as number,
        values: (intent as Record<string, unknown>).values as number[] | undefined,
        rollType: ((intent as Record<string, unknown>).rollType as string ?? expectedRollType) as RollResultCommand["rollType"],
      };
    } catch {
      if (numberFromText !== null) {
        return { kind: "rollResult" as const, value: numberFromText, rollType: expectedRollType as RollResultCommand["rollType"] };
      }
      return {
        kind: "rollResult" as const,
        value: (intent as Record<string, unknown>).value as number ?? (intent as Record<string, unknown>).result as number ?? (intent as Record<string, unknown>).roll as number,
        rollType: expectedRollType as RollResultCommand["rollType"],
      };
    }
  }

  // ----- Roll handlers -----

  private async handleInitiativeRoll(
    sessionId: string,
    encounter: CombatEncounterRecord,
    action: InitiatePendingAction,
    command: RollResultCommand | undefined,
    actorId: string,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
  ): Promise<CombatStartedResult> {
    return this.initiativeHandler.handleInitiativeRoll(sessionId, encounter, action, command, actorId, characters, monsters, npcs);
  }

  /**
   * D&D 5e 2024 Alert feat: handle initiative swap decision.
   * Player says "swap with <name>" or "no swap"/"decline".
   */
  private async handleInitiativeSwap(
    action: InitiativeSwapPendingAction,
    text: string,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
  ): Promise<CombatStartedResult> {
    return this.initiativeHandler.handleInitiativeSwap(action, text, characters, monsters, npcs);
  }

  private async handleAttackRoll(
    sessionId: string,
    encounter: CombatEncounterRecord,
    action: AttackPendingAction,
    command: RollResultCommand,
    actorId: string,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
  ): Promise<AttackResult> {
    const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);

    const targetId = action.targetId || action.target;
    const target =
      monsters.find((m) => m.id === targetId) ||
      characters.find((c) => c.id === targetId) ||
      npcs.find((n) => n.id === targetId);

    if (!target || !targetId) {
      throw new ValidationError("Target not found");
    }

    const baseAC = (target as any).statBlock?.armorClass || (target as any).sheet?.armorClass || 10;
    // D&D 5e 2024: Cover grants AC bonus (half +2, three-quarters +5)
    const coverBonus = (action as any).coverACBonus ?? 0;
    const targetAC = baseAC + coverBonus;
    let attackBonus = action.weaponSpec?.attackBonus ?? 5;

    // Apply feat modifiers to attack bonus (e.g. Archery +2 for ranged)
    const attackerChar = characters.find((c) => c.id === actorId);
    const attackerSheet = (attackerChar?.sheet ?? {}) as Record<string, unknown>;
    const featIds: string[] = (attackerSheet.featIds as string[] | undefined) ?? (attackerSheet.feats as string[] | undefined) ?? [];
    const attackerFeatMods = computeFeatModifiers(featIds);
    if (action.weaponSpec?.kind === "ranged" && attackerFeatMods.rangedAttackBonus) {
      attackBonus += attackerFeatMods.rangedAttackBonus;
      if (this.debugLogsEnabled) console.log(`[RollStateMachine] Archery feat: +${attackerFeatMods.rangedAttackBonus} ranged attack bonus (total bonus: ${attackBonus})`);
    }

    // ── ActiveEffect: attack bonus + AC modifiers ──
    const attackerCombatant = (await this.deps.combatRepo.listCombatants(encounter.id))
      .find((c: any) => c.id === actorId);
    const attackerEffects = getActiveEffects(attackerCombatant?.resources ?? {});
    const targetCombatant = (await this.deps.combatRepo.listCombatants(encounter.id))
      .find((c: any) => c.id === targetId);
    const targetEffects = getActiveEffects(targetCombatant?.resources ?? {});

    // Attack bonus from effects (flat + dice)
    const attackBonusResult = calculateBonusFromEffects(attackerEffects, 'attack_rolls');
    attackBonus += attackBonusResult.flatBonus;
    // Roll dice-based attack bonuses (e.g., Bless 1d4)
    let effectDiceBonus = 0;
    if (this.deps.diceRoller) {
      for (const dr of attackBonusResult.diceRolls) {
        const count = Math.abs(dr.count);
        const sign = dr.count < 0 ? -1 : 1;
        for (let i = 0; i < count; i++) {
          effectDiceBonus += sign * this.deps.diceRoller.rollDie(dr.sides).total;
        }
      }
    }
    attackBonus += effectDiceBonus;
    if (effectDiceBonus !== 0 && this.debugLogsEnabled) {
      console.log(`[RollStateMachine] ActiveEffect attack bonus: +${attackBonusResult.flatBonus} flat, +${effectDiceBonus} dice (total bonus: ${attackBonus})`);
    }

    // AC bonus from effects on target (e.g., Shield of Faith +2 AC)
    const acBonusFromEffects = calculateFlatBonusFromEffects(targetEffects, 'armor_class');
    const effectAdjustedAC = targetAC + acBonusFromEffects;
    if (acBonusFromEffects !== 0 && this.debugLogsEnabled) {
      console.log(`[RollStateMachine] ActiveEffect AC bonus on target: +${acBonusFromEffects} (AC ${targetAC} → ${effectAdjustedAC})`);
    }

    const total = rollValue + attackBonus;
    // D&D 5e 2024: Natural 20 always hits (critical), natural 1 always misses
    const isCritical = rollValue === 20;
    const isCriticalMiss = rollValue === 1;
    const hit = isCriticalMiss ? false : (isCritical ? true : total >= effectAdjustedAC);

    // Emit events
    await this.eventEmitter.emitAttackEvents(sessionId, encounter.id, actorId, targetId, characters, monsters, hit, rollValue, total);

    // D&D 5e 2024: Rage attack tracking — any attack roll counts (hit or miss)
    // Use entity ID matching (characterId/monsterId/npcId) since actorId is an entity ID, not a combatant record ID
    {
      const allCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
      const attackerForRage = findCombatantByEntityId(allCombatants, actorId);
      if (attackerForRage) {
        const atkRes = normalizeResources(attackerForRage.resources);
        if (atkRes.raging === true) {
          await this.deps.combatRepo.updateCombatantState(attackerForRage.id, {
            resources: { ...atkRes, rageAttackedThisTurn: true } as any,
          });
          if (this.debugLogsEnabled) console.log(`[RollStateMachine] Rage attack tracked for ${actorId}`);
        }
      }
    }

    // Consume StunningStrikePartial after this attack (only grants advantage on ONE attack)
    {
      const combatantStates = await this.deps.combatRepo.listCombatants(encounter.id);
      const targetCombatant = findCombatantByEntityId(combatantStates, targetId);
      if (targetCombatant) {
        const targetConds = normalizeConditions(targetCombatant.conditions);
        if (targetConds.some(c => c.condition === "StunningStrikePartial")) {
          const updatedConds = removeCondition(targetConds, "StunningStrikePartial" as Condition);
          await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
            conditions: updatedConds as any,
          });
          if (this.debugLogsEnabled) console.log(`[RollStateMachine] Consumed StunningStrikePartial on ${targetId} after attack`);
        }
      }
    }

    // D&D 5e 2024: Making an attack breaks the Hidden condition (hit or miss)
    {
      const combatantStates = await this.deps.combatRepo.listCombatants(encounter.id);
      const actorCombatant = findCombatantByEntityId(combatantStates, actorId);
      if (actorCombatant) {
        const actorConds = normalizeConditions(actorCombatant.conditions);
        if (actorConds.some(c => c.condition === "Hidden")) {
          const updatedConds = removeCondition(actorConds, "Hidden" as Condition);
          await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
            conditions: updatedConds as any,
          });
          if (this.debugLogsEnabled) console.log(`[RollStateMachine] Hidden condition removed from ${actorId} after attack`);
        }
      }
    }

    if (!hit) {
      const combatantStatesForLucky = await this.deps.combatRepo.listCombatants(encounter.id);
      const actorCombatantForLucky = findCombatantByEntityId(combatantStatesForLucky, actorId);

      // Lucky interactive decision: pause miss resolution and prompt spend/decline.
      if (
        !action.luckyPrompted
        && attackerFeatMods.luckyEnabled
        && actorCombatantForLucky
        && actorCombatantForLucky.combatantType === "Character"
        && hasResourceAvailable(actorCombatantForLucky.resources, "luckPoints", 1)
      ) {
        const pendingActionId = nanoid();
        const opportunityId = nanoid();
        const actorRef = { type: "Character" as const, characterId: actorId };
        const opportunity: ReactionOpportunity = {
          id: opportunityId,
          combatantId: actorCombatantForLucky.id,
          reactionType: "lucky_reroll",
          canUse: true,
          context: {
            rollType: "attack",
            originalRoll: rollValue,
            originalTotal: total,
            targetAC: effectAdjustedAC,
          },
        };
        const luckyData: PendingLuckyRerollData = {
          type: "lucky_reroll",
          sessionId,
          actorEntityId: actorId,
          originalRoll: rollValue,
          originalTotal: total,
          attackBonus,
          targetAC: effectAdjustedAC,
          originalAttackAction: {
            ...action,
            luckyPrompted: true,
            timestamp: new Date(),
          } as Record<string, unknown>,
        };
        const luckyPendingAction: TwoPhasePendingAction = {
          id: pendingActionId,
          encounterId: encounter.id,
          actor: actorRef,
          type: "lucky_reroll",
          data: luckyData,
          reactionOpportunities: [opportunity],
          resolvedReactions: [],
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60000),
        };

        await this.deps.pendingActions.create(luckyPendingAction);
        await this.deps.combatRepo.setPendingAction(encounter.id, {
          id: pendingActionId,
          type: "reaction_pending",
          pendingActionId,
          reactionType: "lucky_reroll",
          target: actorRef,
        } as any);

        return {
          rollType: "attack",
          rawRoll: rollValue,
          modifier: attackBonus,
          total,
          targetAC: effectAdjustedAC,
          hit: false,
          targetHpRemaining: (target as any).statBlock?.hp ?? (target as any).sheet?.maxHp ?? 0,
          requiresPlayerInput: true,
          actionComplete: false,
          message: `${rollValue} + ${attackBonus} = ${total} vs AC ${effectAdjustedAC}. Miss! Spend 1 Luck Point to reroll?`,
          pendingActionId,
          luckyPrompt: {
            pendingActionId,
            reactionType: "lucky_reroll",
            rollType: "attack",
            originalRoll: rollValue,
            originalTotal: total,
            targetAC: effectAdjustedAC,
          },
        };
      }

      // Handle miss for Flurry strike 1
      if (action.bonusAction === "flurry-of-blows" && action.flurryStrike === 1) {
        const pendingAction2: AttackPendingAction = {
          type: "ATTACK",
          timestamp: new Date(),
          actorId,
          attacker: actorId,
          target: action.target,
          targetId: action.targetId,
          weaponSpec: action.weaponSpec,
          bonusAction: "flurry-of-blows",
          flurryStrike: 2,
        };

        await this.deps.combatRepo.setPendingAction(encounter.id, pendingAction2);

        return {
          rollType: "attack",
          rawRoll: rollValue,
          modifier: attackBonus,
          total,
          targetAC: effectAdjustedAC,
          hit: false,
          targetHpRemaining: (target as any).statBlock?.hp ?? (target as any).sheet?.maxHp ?? 0,
          requiresPlayerInput: true,
          actionComplete: false,
          type: "REQUEST_ROLL",
          diceNeeded: "d20",
          message: `${rollValue} + ${attackBonus} = ${total} vs AC ${effectAdjustedAC}. Miss! Second strike: Roll a d20.`,
        };
      }

      // Handle miss for multi-attack spell (Eldritch Blast beams, Scorching Ray rays)
      if (action.spellStrike && action.spellStrikeTotal && action.spellStrike < action.spellStrikeTotal) {
        const nextStrike = action.spellStrike + 1;
        const nextPending: AttackPendingAction = {
          type: "ATTACK",
          timestamp: new Date(),
          actorId,
          attacker: actorId,
          target: action.target,
          targetId: action.targetId,
          weaponSpec: action.weaponSpec,
          spellStrike: nextStrike,
          spellStrikeTotal: action.spellStrikeTotal,
        };

        await this.deps.combatRepo.setPendingAction(encounter.id, nextPending);

        return {
          rollType: "attack",
          rawRoll: rollValue,
          modifier: attackBonus,
          total,
          targetAC: effectAdjustedAC,
          hit: false,
          targetHpRemaining: (target as any).statBlock?.hp ?? (target as any).sheet?.maxHp ?? 0,
          requiresPlayerInput: true,
          actionComplete: false,
          type: "REQUEST_ROLL",
          diceNeeded: "d20",
          message: `${rollValue} + ${attackBonus} = ${total} vs AC ${effectAdjustedAC}. Miss! Beam ${nextStrike} of ${action.spellStrikeTotal}: Roll a d20.`,
        };
      }

      // Regular miss
      await this.deps.combatRepo.clearPendingAction(encounter.id);
      await this.eventEmitter.markActionSpent(encounter.id, actorId);

      // D&D 5e 2024: Loading property — mark that a Loading weapon was fired this turn
      if (action.weaponSpec?.properties?.some((p: string) => typeof p === "string" && p.toLowerCase() === "loading")) {
        const combatantStatesForLoading = await this.deps.combatRepo.listCombatants(encounter.id);
        const actorForLoading = findCombatantByEntityId(combatantStatesForLoading, actorId);
        if (actorForLoading) {
          const loadRes = normalizeResources(actorForLoading.resources);
          await this.deps.combatRepo.updateCombatantState(actorForLoading.id, {
            resources: { ...loadRes, loadingWeaponFiredThisTurn: true } as any,
          });
        }
      }

      // --- Weapon Mastery: Graze ---
      // On a miss, deal damage equal to the ability modifier used for the attack (minimum 0).
      let grazeDamage = 0;
      let grazeSuffix = "";
      if (action.weaponSpec?.mastery === "graze" && !isCriticalMiss) {
        const abilityMod = action.weaponSpec.damage?.modifier ?? 0;
        grazeDamage = Math.max(0, abilityMod);
        if (grazeDamage > 0) {
          const combatantStates = await this.deps.combatRepo.listCombatants(encounter.id);
          const targetCombatant = findCombatantByEntityId(combatantStates, targetId);
          if (targetCombatant && targetCombatant.hpCurrent > 0) {
            const hpBefore = targetCombatant.hpCurrent;
            const hpAfter = Math.max(0, hpBefore - grazeDamage);
            await this.deps.combatRepo.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });
            await applyKoEffectsIfNeeded(targetCombatant, hpBefore, hpAfter, this.deps.combatRepo);
            grazeSuffix = ` Graze: ${grazeDamage} ${action.weaponSpec.damageType ?? ""} damage. HP: ${hpBefore} → ${hpAfter}.`;
            if (this.debugLogsEnabled) console.log(`[RollStateMachine] Graze mastery: ${grazeDamage} damage to ${targetId} (HP: ${hpBefore} → ${hpAfter})`);
          }
        }
      }

      const narration = await this.eventEmitter.generateNarration(isCriticalMiss ? "criticalMiss" : "attackMiss", {
        attackRoll: rollValue,
        attackBonus,
        total,
        targetAC: effectAdjustedAC,
        targetName: target?.name ?? "target",
        weaponName: action.weaponSpec?.name,
      });

      const missMessage = isCriticalMiss
        ? `Natural 1! Critical Miss!`
        : `${rollValue} + ${attackBonus} = ${total} vs AC ${effectAdjustedAC}. Miss!${grazeSuffix}`;

      // Drop thrown weapon on the ground at target position (miss)
      if (action.weaponSpec?.isThrownAttack) {
        await this.dropThrownWeaponOnGround(encounter, actorId, targetId, action.weaponSpec, encounter.round ?? 1);
      }

      return {
        rollType: "attack",
        rawRoll: rollValue,
        modifier: attackBonus,
        total,
        targetAC: effectAdjustedAC,
        hit: false,
        isCritical: false,
        targetHpRemaining: (target as any).statBlock?.hp ?? (target as any).sheet?.maxHp ?? 0,
        requiresPlayerInput: false,
        actionComplete: true,
        message: missMessage,
        narration,
      };
    }

    // Hit - check Sneak Attack eligibility before building damage formula
    let sneakAttackDiceCount = 0;
    const actorChar = characters.find((c) => c.id === actorId);
    const actorClassName = actorChar?.className ?? (actorChar?.sheet as any)?.className ?? "";
    const actorLevel = ClassFeatureResolver.getLevel((actorChar?.sheet ?? {}) as any, actorChar?.level);

    if (classHasFeature(actorClassName, SNEAK_ATTACK, actorLevel)) {
      const combatantStates = await this.deps.combatRepo.listCombatants(encounter.id);
      const actorCombatant = combatantStates.find((c: any) => c.characterId === actorId);
      const targetCombatant = combatantStates.find((c: any) =>
        c.monsterId === targetId || c.characterId === targetId || c.npcId === targetId);

      // Check ally adjacency: any friendly combatant (not attacker, not target) within 5ft of target
      let allyAdjacentToTarget = false;
      if (targetCombatant) {
        const targetPos = getPosition(targetCombatant.resources ?? {});
        if (targetPos) {
          for (const c of combatantStates) {
            // Skip attacker and target
            if (c.id === actorCombatant?.id || c.id === targetCombatant.id) continue;
            // Skip dead/unconscious allies
            const conds = Array.isArray(c.conditions) ? c.conditions as string[] : [];
            if (conds.some((cd: string) => cd.toLowerCase() === "unconscious" || cd.toLowerCase() === "dead")) continue;
            // Must be same faction as attacker (Characters/NPCs vs Monsters)
            const attackerIsPC = actorCombatant?.combatantType === "Character" || actorCombatant?.combatantType === "NPC";
            const allyIsPC = c.combatantType === "Character" || c.combatantType === "NPC";
            if (attackerIsPC !== allyIsPC) continue;
            // Check distance to target
            const allyPos = getPosition(c.resources ?? {});
            if (allyPos && calculateDistance(allyPos, targetPos) <= 5.0001) {
              allyAdjacentToTarget = true;
              break;
            }
          }
        }
      }

      const sneakUsed = actorCombatant?.resources
        ? (normalizeResources(actorCombatant.resources) as any).sneakAttackUsedThisTurn === true
        : false;

      const eligible = isSneakAttackEligible({
        className: actorClassName,
        weaponKind: action.weaponSpec?.kind ?? "melee",
        weaponProperties: action.weaponSpec?.properties,
        hasAdvantage: action.rollMode === "advantage",
        allyAdjacentToTarget,
        sneakAttackUsedThisTurn: sneakUsed,
      });

      if (eligible) {
        sneakAttackDiceCount = sneakAttackDiceForLevel(actorLevel);
        if (this.debugLogsEnabled) console.log(`[RollStateMachine] Sneak Attack eligible! Adding ${sneakAttackDiceCount}d6`);
      }
    }

    // Hit - request damage roll
    // 2024 rules: on-hit enhancements (Stunning Strike, Divine Smite, OHT) are NOT built here.
    // Instead, we compute eligible enhancements and return them in the hit response.
    // Player opts in by including keywords in their damage roll text.

    // Compute eligible on-hit enhancements for the attacker
    const actorSheet = (actorChar?.sheet ?? {}) as any;
    const actorCombatantForEnhancements = findCombatantByEntityId(
      await this.deps.combatRepo.listCombatants(encounter.id), actorId,
    );
    const actorResForEnhancements = normalizeResources(actorCombatantForEnhancements?.resources ?? {});
    const actorResourcePools = getResourcePools(actorResForEnhancements);
    const eligibleEnhancements = actorChar
      ? getEligibleOnHitEnhancements(
          action.weaponSpec?.kind ?? "melee",
          actorClassName,
          actorLevel,
          actorResForEnhancements,
          actorResourcePools,
          getAllCombatTextProfiles(),
          action.bonusAction,
          (actorChar?.sheet as any)?.subclass ?? "",
        )
      : [];

    if (this.debugLogsEnabled && eligibleEnhancements.length > 0) {
      console.log(`[RollStateMachine] Eligible on-hit enhancements: ${eligibleEnhancements.map((e) => e.keyword).join(", ")}`);
    }

    const damageAction: DamagePendingAction = {
      type: "DAMAGE",
      timestamp: new Date(),
      actorId,
      targetId: targetId!,
      weaponSpec: action.weaponSpec,
      attackRollResult: total,
      isCritical,
      bonusAction: action.bonusAction,
      flurryStrike: action.flurryStrike,
      sneakAttackDice: sneakAttackDiceCount > 0 ? sneakAttackDiceCount : undefined,
      spellStrike: action.spellStrike,
      spellStrikeTotal: action.spellStrikeTotal,
      // Enhancements are built at damage time from player opt-in keywords, not here
    };

    await this.deps.combatRepo.setPendingAction(encounter.id, damageAction);

    // Build damage formula including Sneak Attack dice if eligible
    let baseDamageFormula = action.weaponSpec?.damageFormula ?? "1d8";
    if (sneakAttackDiceCount > 0) {
      // Insert sneak attack dice before the modifier: "1d6+3" → "1d6+3d6+3"
      const modMatch = baseDamageFormula.match(/([+-]\d+)$/);
      if (modMatch) {
        const beforeMod = baseDamageFormula.slice(0, modMatch.index);
        baseDamageFormula = `${beforeMod}+${sneakAttackDiceCount}d6${modMatch[1]}`;
      } else {
        baseDamageFormula = `${baseDamageFormula}+${sneakAttackDiceCount}d6`;
      }
    }

    // On critical hit, double ALL damage dice (weapon + sneak attack per 5e 2024)
    const damageFormula = isCritical ? doubleDiceInFormula(baseDamageFormula) : baseDamageFormula;

    const narration = await this.eventEmitter.generateNarration(isCritical ? "criticalHit" : "attackHit", {
      attackRoll: rollValue,
      attackBonus,
      total,
      targetAC: effectAdjustedAC,
      targetName: target?.name ?? "target",
      damageFormula,
      weaponName: action.weaponSpec?.name,
    });

    const hitMessage = isCritical
      ? `Natural 20! Critical Hit! Roll ${damageFormula} for damage.`
      : `${rollValue} + ${attackBonus} = ${total} vs AC ${effectAdjustedAC}. Hit! Roll ${damageFormula} for damage.`;

    return {
      rollType: "damage",
      rawRoll: rollValue,
      modifier: attackBonus,
      total,
      targetAC: effectAdjustedAC,
      hit: true,
      isCritical,
      requiresPlayerInput: true,
      actionComplete: false,
      type: "REQUEST_ROLL",
      diceNeeded: damageFormula,
      message: hitMessage,
      narration,
      ...(eligibleEnhancements.length > 0 ? { eligibleEnhancements } : {}),
    };
  }

  private async handleDamageRoll(
    sessionId: string,
    encounter: CombatEncounterRecord,
    action: DamagePendingAction,
    command: RollResultCommand,
    actorId: string,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
    rawText?: string,
  ): Promise<DamageResult> {
    return this.damageResolver.resolve(sessionId, encounter, action, command, actorId, characters, monsters, npcs, rawText);
  }

  /**
   * Handle a death saving throw roll result.
   * D&D 5e: DC 10, nat 20 = revive with 1 HP, nat 1 = 2 failures.
   * 3 successes = stabilized, 3 failures = dead.
   * After the death save, the turn auto-advances (dying characters can't act),
   * unless the character is revived by a nat 20.
   */
  private async handleDeathSaveRoll(
    sessionId: string,
    encounter: CombatEncounterRecord,
    action: DeathSavePendingAction,
    command: { value?: number; values?: number[] },
    actorId: string,
  ): Promise<DeathSaveResult> {
    const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);
    const currentDeathSaves = action.currentDeathSaves;

    const saveResult = makeDeathSave(rollValue, currentDeathSaves);
    const updatedDeathSaves = applyDeathSaveResult(currentDeathSaves, saveResult);

    let resultType: string;
    let hpRestored = 0;
    let isStabilized = false;
    let isDead = false;

    if (saveResult.outcome === "dead") {
      resultType = "dead";
      isDead = true;
    } else if (saveResult.outcome === "stabilized") {
      resultType = "stabilized";
      isStabilized = true;
    } else if (saveResult.outcome === "success" && (saveResult as any).criticalSuccess) {
      resultType = "revived";
      hpRestored = 1;
    } else {
      resultType = saveResult.outcome; // "success" or "failure"
    }

    // Update combatant state
    const combatants = await this.deps.combatRepo.listCombatants(encounter.id);
    const actorCombatant = combatants.find((c) => c.characterId === actorId);

    // Compute the actual final death saves for response + storage
    // applyDeathSaveResult returns unchanged counters for dead/stabilized outcomes,
    // but we need to reflect the real final state
    let finalDeathSaves: DeathSaves;
    if (resultType === "revived") {
      finalDeathSaves = resetDeathSaves();
    } else if (isDead) {
      finalDeathSaves = { successes: currentDeathSaves.successes, failures: 3 };
    } else if (isStabilized) {
      finalDeathSaves = { successes: 3, failures: currentDeathSaves.failures };
    } else {
      finalDeathSaves = updatedDeathSaves;
    }

    if (actorCombatant) {
      const resources = normalizeResources(actorCombatant.resources);
      const updatedResources = {
        ...resources,
        deathSaves: finalDeathSaves,
        stabilized: isStabilized || (resultType === "revived" ? false : !!(resources as any).stabilized),
      };

      const updateData: Record<string, unknown> = { resources: updatedResources };

      if (hpRestored > 0) {
        updateData.hpCurrent = hpRestored;
        // Remove Unconscious condition on revival (keep Prone — standing up costs movement)
        const conditions = normalizeConditions(actorCombatant.conditions);
        updateData.conditions = removeCondition(conditions, "Unconscious" as Condition) as any;
      }

      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, updateData);
    }

    // Clear pending action
    await this.deps.combatRepo.clearPendingAction(encounter.id);

    // Emit death save event
    if (this.deps.events) {
      await this.deps.events.append(sessionId, {
        id: nanoid(),
        type: "DeathSave",
        payload: {
          encounterId: encounter.id,
          combatantId: actorCombatant?.id,
          roll: rollValue,
          result: resultType,
          deathSaves: finalDeathSaves,
          ...(hpRestored > 0 ? { hpRestored } : {}),
        },
      });
    }

    // Check victory/defeat after death
    let combatEnded = false;
    let victoryStatus: CombatVictoryStatus | undefined;
    if (isDead && this.deps.victoryPolicy) {
      const updatedCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
      victoryStatus = (await this.deps.victoryPolicy.evaluate({ combatants: updatedCombatants })) ?? undefined;
      if (victoryStatus) {
        combatEnded = true;
        await this.deps.combatRepo.updateEncounter(encounter.id, { status: victoryStatus });
        if (this.deps.events) {
          await this.deps.events.append(sessionId, {
            id: nanoid(),
            type: "CombatEnded",
            payload: { encounterId: encounter.id, result: victoryStatus },
          });
        }
      }
    }

    // Auto-advance turn (dying characters can't act)
    // If revived (nat 20), the player can act normally — don't auto-advance
    if (!hpRestored && !combatEnded) {
      await this.deps.combat.nextTurn(sessionId, { encounterId: encounter.id, skipDeathSaveAutoRoll: true });
      if (this.deps.aiOrchestrator) {
        void this.deps.aiOrchestrator.processAllMonsterTurns(sessionId, encounter.id).catch(console.error);
      }
    }

    // Build message
    let message: string;
    if (resultType === "revived") {
      message = `Death Save: Natural 20! Regains 1 HP and is conscious!`;
    } else if (resultType === "stabilized") {
      message = `Death Save: ${rollValue} — Success! (3 successes) Stabilized!`;
    } else if (resultType === "dead") {
      message = `Death Save: ${rollValue} — ${rollValue === 1 ? "Natural 1! Two failures!" : "Failure!"} (3 failures) Dead!`;
    } else if (resultType === "success") {
      message = `Death Save: ${rollValue} — Success! (${updatedDeathSaves.successes} successes, ${updatedDeathSaves.failures} failures)`;
    } else {
      message = `Death Save: ${rollValue} — ${rollValue === 1 ? "Natural 1! Two failures!" : "Failure!"} (${updatedDeathSaves.successes} successes, ${updatedDeathSaves.failures} failures)`;
    }

    const narration = await this.eventEmitter.generateNarration("deathSave", {
      roll: rollValue,
      result: resultType,
      deathSaves: updatedDeathSaves,
    });

    return {
      rollType: "deathSave",
      rawRoll: rollValue,
      deathSaveResult: resultType,
      deathSaves: finalDeathSaves,
      actionComplete: true,
      requiresPlayerInput: false,
      message,
      narration,
      combatEnded,
      victoryStatus,
    };
  }

  // ----- Saving Throw Handler -----

  /**
   * Handle a SAVING_THROW pending action.
   * Auto-resolves the save (server rolls) and applies the outcome.
   * Returns a SavingThrowAutoResult (cast as DamageResult for the union return type).
   */
  private async handleSavingThrowAction(
    sessionId: string,
    encounter: CombatEncounterRecord,
    action: SavingThrowPendingAction,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
  ): Promise<SavingThrowAutoResult> {
    if (!this.savingThrowResolver) {
      throw new ValidationError("DiceRoller is required for saving throw resolution");
    }

    // Auto-resolve the saving throw
    const resolution = await this.savingThrowResolver.resolve(
      action,
      encounter.id,
      characters,
      monsters,
      npcs,
    );

    // Clear the pending action
    await this.deps.combatRepo.clearPendingAction(encounter.id);

    const narration = await this.eventEmitter.generateNarration("savingThrow", {
      reason: action.reason,
      ability: action.ability,
      dc: action.dc,
      rawRoll: resolution.rawRoll,
      modifier: resolution.modifier,
      total: resolution.total,
      success: resolution.success,
      outcomeSummary: resolution.appliedOutcome.summary,
    });

    return this.savingThrowResolver.buildResult(action, resolution, {
      actionComplete: true,
      requiresPlayerInput: false,
      narration,
    });
  }

  // ----- Weapon Mastery Resolution -----

  /**
   * Expose the saving throw resolver for direct access by other modules.
   * Used by the action dispatcher to inject saving throws mid-flow.
   */
  getSavingThrowResolver(): SavingThrowResolver | null {
    return this.savingThrowResolver;
  }
}
