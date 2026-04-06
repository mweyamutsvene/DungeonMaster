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
  spendResourceFromPool,
  hasBonusActionAvailable,
  useBonusAction,
  getActiveEffects,
  setActiveEffects,
} from "../helpers/resource-utils.js";
import {
  calculateBonusFromEffects,
  calculateFlatBonusFromEffects,
  createEffect,
  getDamageDefenseEffects,
  getEffectsByType,
  removeTriggeredEffects,
  type ActiveEffect,
  type DiceValue,
} from "../../../../domain/entities/combat/effects.js";
import { applyKoEffectsIfNeeded, applyDamageWhileUnconscious } from "../helpers/ko-handler.js";
import { ClassFeatureResolver } from "../../../../domain/entities/classes/class-feature-resolver.js";
import { classHasFeature } from "../../../../domain/entities/classes/registry.js";
import { SNEAK_ATTACK } from "../../../../domain/entities/classes/feature-keys.js";
import { divineSmiteDice } from "../../../../domain/entities/classes/paladin.js";
import { getEligibleOnHitEnhancements, matchOnHitEnhancementsInText } from "../../../../domain/entities/classes/combat-text-profile.js";
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
import { applyDamageDefenses, extractDamageDefenses } from "../../../../domain/rules/damage-defenses.js";
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
import { doubleDiceInFormula, parseDamageModifier } from "./combat-text-parser.js";
import type { TabletopEventEmitter } from "./tabletop-event-emitter.js";
import { SavingThrowResolver } from "./rolls/saving-throw-resolver.js";
import type { WeaponMasteryProperty } from "../../../../domain/rules/weapon-mastery.js";
import { concentrationCheckOnDamage } from "../../../../domain/rules/concentration.js";
import {
  getConcentrationSpellName,
  breakConcentration,
  computeConSaveModifier,
} from "../helpers/concentration-helper.js";
import { addGroundItem } from "../../../../domain/rules/combat-map.js";
import type { CombatMap } from "../../../../domain/rules/combat-map.js";
import type { GroundItem } from "../../../../domain/entities/items/ground-item.js";
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
  HitRiderEnhancement,
  HitRiderEnhancementResult,
  SaveOutcome,
  PendingActionHandlerMap,
  RollProcessingCtx,
} from "./tabletop-types.js";
// assertValidTransition is intentionally not imported here; transition validation belongs at setPendingAction() call sites.
import { InitiativeHandler } from "./rolls/initiative-handler.js";
import { WeaponMasteryResolver } from "./rolls/weapon-mastery-resolver.js";
import { HitRiderResolver } from "./rolls/hit-rider-resolver.js";

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

// ----- Helpers -----

/** Normalize an ID for case/separator-insensitive comparison. */
function normalizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ----- RollStateMachine -----

export class RollStateMachine {
  private readonly savingThrowResolver: SavingThrowResolver | null;
  private readonly initiativeHandler: InitiativeHandler;
  private readonly weaponMasteryResolver: WeaponMasteryResolver;
  private readonly hitRiderResolver: HitRiderResolver;
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
   * Creates a GroundItem from the WeaponSpec and persists the updated map.
   */
  private async dropThrownWeaponOnGround(
    encounter: CombatEncounterRecord,
    actorId: string,
    targetId: string,
    weaponSpec: { name: string; kind: "melee" | "ranged"; attackBonus: number; damage?: { diceCount: number; diceSides: number; modifier: number }; damageType?: string; properties?: string[]; normalRange?: number; longRange?: number; mastery?: string },
    round: number,
  ): Promise<void> {
    const mapData = encounter.mapData as CombatMap | undefined;
    if (!mapData) return;

    // Find target position — that's where the thrown weapon lands
    const combatants = await this.deps.combatRepo.listCombatants(encounter.id);
    const targetCombatant = combatants.find(
      (c: any) => c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
    );
    const targetPos = targetCombatant ? getPosition(targetCombatant.resources ?? {}) : null;
    if (!targetPos) return;

    // Build range string from normalRange/longRange
    let rangeStr: string | undefined;
    if (weaponSpec.normalRange && weaponSpec.normalRange > 0) {
      rangeStr = weaponSpec.longRange
        ? `${weaponSpec.normalRange}/${weaponSpec.longRange}`
        : `${weaponSpec.normalRange}`;
    }

    const groundItem: GroundItem = {
      id: nanoid(),
      name: weaponSpec.name,
      position: { ...targetPos },
      source: "thrown",
      droppedBy: actorId,
      round,
      weaponStats: {
        name: weaponSpec.name,
        kind: weaponSpec.kind === "ranged" ? "ranged" : "melee",
        ...(rangeStr ? { range: rangeStr } : {}),
        attackBonus: weaponSpec.attackBonus,
        damage: weaponSpec.damage ?? { diceCount: 1, diceSides: 4, modifier: 0 },
        ...(weaponSpec.damageType ? { damageType: weaponSpec.damageType } : {}),
        ...(weaponSpec.properties ? { properties: weaponSpec.properties } : {}),
        ...(weaponSpec.mastery ? { mastery: weaponSpec.mastery } : {}),
      },
    };

    const updatedMap = addGroundItem(mapData, groundItem);
    await this.deps.combatRepo.updateEncounter(encounter.id, { mapData: updatedMap as any });

    if (this.debugLogsEnabled) {
      console.log(`[RollStateMachine] Thrown weapon ${weaponSpec.name} dropped at (${targetPos.x}, ${targetPos.y}) by ${actorId}`);
    }
  }

  /**
   * Drop loot from a defeated monster onto the battlefield as ground items.
   * Reads the `loot` array from the monster's stat block and places each item
   * at the monster's last known position on the map.
   */
  private async dropMonsterLoot(
    encounter: CombatEncounterRecord,
    targetCombatant: { monsterId: string | null; resources?: unknown },
    monsters: SessionMonsterRecord[],
  ): Promise<void> {
    const mapData = encounter.mapData as CombatMap | undefined;
    if (!mapData) return;

    // Find the monster record for its stat block
    const monsterId = targetCombatant.monsterId;
    const monster = monsters.find((m) => m.id === monsterId);
    if (!monster) return;

    const statBlock = monster.statBlock as Record<string, unknown> | undefined;
    const loot = statBlock?.loot;
    if (!Array.isArray(loot) || loot.length === 0) return;

    // Get monster's position for drop location
    const monsterPos = getPosition(targetCombatant.resources ?? {});
    if (!monsterPos) return;

    let currentMap = mapData;
    for (const lootEntry of loot) {
      if (!lootEntry || typeof lootEntry !== "object") continue;
      const entry = lootEntry as Record<string, unknown>;
      const name = entry.name;
      if (typeof name !== "string") continue;

      const groundItem: GroundItem = {
        id: nanoid(),
        name,
        position: { ...monsterPos },
        source: "loot",
        round: encounter.round ?? 1,
        ...(entry.weaponStats && typeof entry.weaponStats === "object"
          ? { weaponStats: entry.weaponStats as GroundItem["weaponStats"] }
          : {}),
        ...(entry.inventoryItem && typeof entry.inventoryItem === "object"
          ? { inventoryItem: entry.inventoryItem as GroundItem["inventoryItem"] }
          : {}),
      };

      currentMap = addGroundItem(currentMap, groundItem);

      if (this.debugLogsEnabled) {
        console.log(`[RollStateMachine] Monster loot dropped: ${name} at (${monsterPos.x}, ${monsterPos.y})`);
      }
    }

    await this.deps.combatRepo.updateEncounter(encounter.id, { mapData: currentMap as any });
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
    if (featIds.length > 0) {
      const featMods = computeFeatModifiers(featIds);
      if (action.weaponSpec?.kind === "ranged" && featMods.rangedAttackBonus) {
        attackBonus += featMods.rangedAttackBonus;
        if (this.debugLogsEnabled) console.log(`[RollStateMachine] Archery feat: +${featMods.rangedAttackBonus} ranged attack bonus (total bonus: ${attackBonus})`);
      }
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
      const attackerForRage = allCombatants.find(
        (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
      );
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
      const targetCombatant = combatantStates.find(
        (c: any) => c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
      );
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
      const actorCombatant = combatantStates.find(
        (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
      );
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

      // Regular miss
      await this.deps.combatRepo.clearPendingAction(encounter.id);
      await this.eventEmitter.markActionSpent(encounter.id, actorId);

      // D&D 5e 2024: Loading property — mark that a Loading weapon was fired this turn
      if (action.weaponSpec?.properties?.some((p: string) => typeof p === "string" && p.toLowerCase() === "loading")) {
        const combatantStatesForLoading = await this.deps.combatRepo.listCombatants(encounter.id);
        const actorForLoading = combatantStatesForLoading.find(
          (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
        );
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
          const targetCombatant = combatantStates.find(
            (c: any) => c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId,
          );
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
    const actorCombatantForEnhancements = (await this.deps.combatRepo.listCombatants(encounter.id)).find(
      (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
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
    const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);

    const target =
      monsters.find((m) => m.id === action.targetId) ||
      characters.find((c) => c.id === action.targetId) ||
      npcs.find((n) => n.id === action.targetId);

    if (!target) {
      throw new ValidationError("Target not found");
    }

    // --- 2024 On-Hit Enhancement: match player opt-in keywords in damage text ---
    // Enhancement building moved here from handleAttackRoll (was upfront declaration).
    // Player includes keywords like "with stunning strike" or "with topple" in damage text.
    const actorChar = characters.find((c) => c.id === actorId);
    const actorClassName = actorChar?.className ?? (actorChar?.sheet as any)?.className ?? "";
    const actorLevel = ClassFeatureResolver.getLevel((actorChar?.sheet ?? {}) as any, actorChar?.level);

    if (rawText && !action.enhancements) {
      const actorCombatantForEnhancements = (await this.deps.combatRepo.listCombatants(encounter.id)).find(
        (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
      );
      const actorResForEnhancements = normalizeResources(actorCombatantForEnhancements?.resources ?? {});
      const actorResourcePools = getResourcePools(actorResForEnhancements);

      // Get raw on-hit enhancement defs for the actor's class
      const profiles = getAllCombatTextProfiles();
      const classProfile = profiles.find((p) => p.classId === actorClassName.toLowerCase());
      const onHitDefs = (classProfile?.attackEnhancements ?? []).filter((e) => (e.trigger ?? "onDeclare") === "onHit");

      // Filter to eligible defs
      const actorSubclass = (actorChar?.sheet as any)?.subclass ?? "";
      const eligibleDefs = onHitDefs.filter((def) => {
        if (actorLevel < def.minLevel) return false;
        if (def.requiresSubclass && normalizeId(def.requiresSubclass) !== normalizeId(actorSubclass ?? "")) return false;
        if (def.requiresMelee && action.weaponSpec?.kind !== "melee") return false;
        if (def.requiresBonusAction && action.bonusAction !== def.requiresBonusAction) return false;
        if (def.turnTrackingKey && actorResForEnhancements[def.turnTrackingKey] === true) return false;
        if (def.resourceCost) {
          const pool = actorResourcePools.find((p) => p.name === def.resourceCost!.pool);
          if (!pool || pool.current < def.resourceCost.amount) return false;
        }
        return true;
      });

      // Match player keywords in damage text
      const matched = matchOnHitEnhancementsInText(rawText, eligibleDefs);

      if (matched.length > 0) {
        const enhancements: HitRiderEnhancement[] = [];
        const actorSheet = (actorChar?.sheet ?? {}) as any;
        const wisdomScore = actorSheet?.abilityScores?.wisdom ?? 10;
        const profBonus = ClassFeatureResolver.getProficiencyBonus(actorSheet, actorLevel);
        const wisMod = Math.floor((wisdomScore - 10) / 2);
        const saveDC = 8 + profBonus + wisMod;

        for (const match of matched) {
          if (match.keyword === "stunning-strike") {
            enhancements.push({
              abilityId: "class:monk:stunning-strike",
              displayName: "Stunning Strike",
              postDamageEffect: "saving-throw",
              context: {
                saveAbility: "constitution",
                saveDC,
                saveReason: "Stunning Strike",
                sourceId: actorId,
                onSuccess: {
                  conditions: { add: ["StunningStrikePartial"] },
                  speedModifier: 0.5,
                  summary: "Speed halved, next attack has advantage.",
                } satisfies SaveOutcome,
                onFailure: {
                  conditions: { add: ["Stunned"] },
                  summary: "Stunned until start of monk's next turn!",
                } satisfies SaveOutcome,
                expiresAt: { event: "start_of_turn", combatantId: actorId },
                resourceCost: { pool: "ki", amount: 1 },
                turnTrackingKey: "stunningStrikeUsedThisTurn",
              },
            });
          } else if (match.keyword === "divine-smite") {
            // Find lowest available spell slot (1-5)
            let slotLevel = 0;
            for (let sl = 1; sl <= 5; sl++) {
              if (hasResourceAvailable(actorResForEnhancements, `spellSlot_${sl}`, 1)) {
                slotLevel = sl;
                break;
              }
            }
            if (slotLevel > 0 && hasBonusActionAvailable(actorResForEnhancements)) {
              // Spend the spell slot + bonus action
              let updatedSmiteRes = spendResourceFromPool(actorResForEnhancements, `spellSlot_${slotLevel}`, 1);
              updatedSmiteRes = useBonusAction(updatedSmiteRes);
              if (actorCombatantForEnhancements) {
                await this.deps.combatRepo.updateCombatantState(actorCombatantForEnhancements.id, {
                  resources: updatedSmiteRes as any,
                });
              }
              const diceCount = divineSmiteDice(slotLevel);
              enhancements.push({
                abilityId: "class:paladin:divine-smite",
                displayName: "Divine Smite",
                bonusDice: { diceCount, diceSides: 8 },
              });
              if (this.debugLogsEnabled) console.log(`[RollStateMachine] Divine Smite (on-hit): ${diceCount}d8 radiant (level ${slotLevel} slot spent)`);
            }
          } else if (match.keyword === "open-hand-technique" && match.choice) {
            const technique = match.choice;
            if (technique === "addle") {
              enhancements.push({
                abilityId: "class:monk:open-hand-technique",
                displayName: "Open Hand Technique (Addle)",
                postDamageEffect: "apply-condition",
                context: { conditionName: "Addled" },
              });
            } else if (technique === "push") {
              enhancements.push({
                abilityId: "class:monk:open-hand-technique",
                displayName: "Open Hand Technique (Push)",
                postDamageEffect: "saving-throw",
                context: {
                  saveAbility: "strength",
                  saveDC,
                  saveReason: "Open Hand Technique (Push)",
                  sourceId: actorId,
                  onSuccess: { summary: "Resists the push!" } satisfies SaveOutcome,
                  onFailure: { movement: { push: 15 }, summary: "Pushed 15 feet!" } satisfies SaveOutcome,
                },
              });
            } else if (technique === "topple") {
              enhancements.push({
                abilityId: "class:monk:open-hand-technique",
                displayName: "Open Hand Technique (Topple)",
                postDamageEffect: "saving-throw",
                context: {
                  saveAbility: "dexterity",
                  saveDC,
                  saveReason: "Open Hand Technique (Topple)",
                  sourceId: actorId,
                  onSuccess: { summary: "Keeps footing!" } satisfies SaveOutcome,
                  onFailure: { conditions: { add: ["Prone"] }, summary: "Knocked Prone!" } satisfies SaveOutcome,
                },
              });
            }
          }
        }

        if (enhancements.length > 0) {
          action.enhancements = enhancements;
          if (this.debugLogsEnabled) console.log(`[RollStateMachine] On-hit enhancements from damage text: ${enhancements.map((e) => e.displayName).join(", ")}`);
        }
      }
    }

    const damageModifier = parseDamageModifier(action.weaponSpec?.damageFormula, action.weaponSpec?.damage?.modifier);
    let totalDamage = rollValue + damageModifier;

    // ── ActiveEffect: extra damage (flat + dice) ──
    // Includes Rage melee damage bonus, Hunter's Mark, etc.
    const actorCombatant = (await this.deps.combatRepo.listCombatants(encounter.id)).find(
      (c: any) => c.characterId === action.actorId || c.monsterId === action.actorId || c.npcId === action.actorId,
    );
    const actorRes = actorCombatant?.resources ?? {} as Record<string, unknown>;
    {
      const attackerEffects = getActiveEffects(actorCombatant?.resources ?? {});
      const targetId = action.targetId;
      const isMelee = action.weaponSpec?.kind === "melee";
      const isRanged = action.weaponSpec?.kind === "ranged";
      // Filter for damage_rolls effects, honouring targetCombatantId for Hunter's Mark etc.
      // Also match melee/ranged-specific damage effects
      const dmgEffects = attackerEffects.filter(
        e => (e.type === 'bonus' || e.type === 'penalty')
          && (e.target === 'damage_rolls'
            || (e.target === 'melee_damage_rolls' && isMelee)
            || (e.target === 'ranged_damage_rolls' && isRanged))
          && (!e.targetCombatantId || e.targetCombatantId === targetId)
      );
      let effectFlatDmg = 0;
      let effectDiceDmg = 0;
      for (const eff of dmgEffects) {
        if (eff.type === 'bonus') effectFlatDmg += eff.value ?? 0;
        if (eff.type === 'penalty') effectFlatDmg -= eff.value ?? 0;
        if (eff.diceValue && this.deps.diceRoller) {
          const sign = eff.type === 'penalty' ? -1 : 1;
          const count = Math.abs(eff.diceValue.count);
          for (let i = 0; i < count; i++) {
            effectDiceDmg += sign * this.deps.diceRoller.rollDie(eff.diceValue.sides).total;
          }
        }
      }
      const effectDmgTotal = effectFlatDmg + effectDiceDmg;
      if (effectDmgTotal !== 0) {
        totalDamage = Math.max(0, totalDamage + effectDmgTotal);
        if (this.debugLogsEnabled) console.log(`[RollStateMachine] ActiveEffect damage bonus: +${effectFlatDmg} flat, +${effectDiceDmg} dice (total now ${totalDamage})`);
      }
    }

    // Apply damage resistance/immunity/vulnerability
    const damageType = action.weaponSpec?.damageType;
    if (totalDamage > 0 && damageType) {
      const targetSheet = (target as any).statBlock ?? (target as any).sheet ?? {};
      const defenses = extractDamageDefenses(targetSheet);

      // ── ActiveEffect: damage defense modifiers (resistance/vulnerability/immunity) ──
      // Includes Rage B/P/S resistance, spell-granted resistances, etc.
      const targetCombatantForDefenses = (await this.deps.combatRepo.listCombatants(encounter.id)).find(
        (c: any) => c.characterId === action.targetId || c.monsterId === action.targetId || c.npcId === action.targetId,
      );
      if (targetCombatantForDefenses) {
        const tgtEffects = getActiveEffects(targetCombatantForDefenses.resources ?? {});
        const effDef = getDamageDefenseEffects(tgtEffects, damageType);
        if (effDef.resistances) {
          const existing = defenses.damageResistances ?? [];
          defenses.damageResistances = [...new Set([...existing, damageType.toLowerCase()])];
        }
        if (effDef.vulnerabilities) {
          const existing = defenses.damageVulnerabilities ?? [];
          defenses.damageVulnerabilities = [...new Set([...existing, damageType.toLowerCase()])];
        }
        if (effDef.immunities) {
          const existing = defenses.damageImmunities ?? [];
          defenses.damageImmunities = [...new Set([...existing, damageType.toLowerCase()])];
        }
      }

      if (defenses.damageResistances || defenses.damageImmunities || defenses.damageVulnerabilities) {
        const defResult = applyDamageDefenses(totalDamage, damageType, defenses);
        totalDamage = defResult.adjustedDamage;
        if (this.debugLogsEnabled) console.log(`[RollStateMachine] Damage defense: ${defResult.defenseApplied} (${damageType}) ${defResult.originalDamage} → ${totalDamage}`);
      }
    }

    // Apply damage
    const combatantStates = await this.deps.combatRepo.listCombatants(encounter.id);
    const targetCombatant = combatantStates.find(
      (c: any) => c.characterId === action.targetId || c.monsterId === action.targetId || c.npcId === action.targetId,
    );

    const hpBefore = targetCombatant?.hpCurrent ?? 0;
    let hpAfter = hpBefore;

    if (targetCombatant) {
      hpAfter = Math.max(0, targetCombatant.hpCurrent - totalDamage);
      if (this.debugLogsEnabled) console.log(`[RollStateMachine.handleDamageRoll] HP change: ${hpBefore} -> ${hpAfter} (target: ${targetCombatant.id}, damage: ${totalDamage})`);
      await this.deps.combatRepo.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });
      await this.eventEmitter.emitDamageEvents(sessionId, encounter.id, actorId, action.targetId, characters, monsters, totalDamage, hpAfter);

      // D&D 5e 2024: Rage damage-taken tracking — track when a raging creature takes damage
      if (totalDamage > 0) {
        const targetRes = normalizeResources(targetCombatant.resources);
        if (targetRes.raging === true) {
          await this.deps.combatRepo.updateCombatantState(targetCombatant.id, {
            resources: { ...targetRes, rageDamageTakenThisTurn: true } as any,
          });
          if (this.debugLogsEnabled) console.log(`[RollStateMachine] Rage damage taken tracked for ${action.targetId}`);
        }
      }

      // If a CHARACTER drops to 0 HP from above 0 HP, initialize death saves + Unconscious
      const wasKod = await applyKoEffectsIfNeeded(
        targetCombatant, hpBefore, hpAfter, this.deps.combatRepo,
        this.debugLogsEnabled ? (msg) => console.log(`[RollStateMachine] ${msg}`) : undefined,
      );

      // D&D 5e 2024: Rage ends immediately when a creature drops to 0 HP (unconscious)
      if (hpAfter === 0) {
        const koTargetForRage = (await this.deps.combatRepo.listCombatants(encounter.id))
          .find((c: any) => c.id === targetCombatant.id);
        if (koTargetForRage) {
          const koRes = normalizeResources(koTargetForRage.resources);
          if (koRes.raging === true) {
            const effects = getActiveEffects(koTargetForRage.resources ?? {});
            const nonRageEffects = effects.filter((e: ActiveEffect) => e.source !== "Rage");
            const updatedRes = setActiveEffects({ ...koRes, raging: false }, nonRageEffects);
            await this.deps.combatRepo.updateCombatantState(koTargetForRage.id, { resources: updatedRes as any });
            if (this.debugLogsEnabled) console.log(`[RollStateMachine] Rage ended on KO for ${action.targetId}`);
          }
        }
      }

      // Auto-break concentration on KO (Unconscious = Incapacitated → concentration ends)
      if (hpAfter === 0 && targetCombatant) {
        const koTarget = (await this.deps.combatRepo.listCombatants(encounter.id))
          .find((c: any) => c.id === targetCombatant.id);
        if (koTarget) {
          const koSpellName = getConcentrationSpellName(koTarget.resources);
          if (koSpellName) {
            await breakConcentration(
              koTarget, encounter.id, this.deps.combatRepo,
              this.debugLogsEnabled ? (msg) => console.log(`[RollStateMachine] ${msg}`) : undefined,
            );
            const targetEntityId = targetCombatant.characterId ?? targetCombatant.monsterId ?? targetCombatant.npcId ?? action.targetId;
            await this.eventEmitter.emitConcentrationEvent(
              sessionId, encounter.id, targetEntityId, characters, monsters,
              { maintained: false, spellName: koSpellName, dc: 0, roll: 0, damage: totalDamage },
            );
            if (this.debugLogsEnabled) console.log(`[RollStateMachine] Concentration auto-broken on KO`);
          }
        }
      }

      // If a CHARACTER already at 0 HP takes more damage, auto-fail death saves
      if (hpBefore === 0 && targetCombatant.combatantType === "Character") {
        const isCritical = action.isCritical ?? false;
        await applyDamageWhileUnconscious(
          targetCombatant, totalDamage, isCritical, this.deps.combatRepo,
          this.debugLogsEnabled ? (msg) => console.log(`[RollStateMachine] ${msg}`) : undefined,
        );
      }

      // Concentration check: if the target is concentrating and took damage, auto-roll CON save
      // If hpAfter === 0, concentration is auto-broken (handled by KO effects / condition-based break)
      if (totalDamage > 0 && hpAfter > 0 && targetCombatant) {
        const latestCombatant = (await this.deps.combatRepo.listCombatants(encounter.id))
          .find((c: any) => c.id === targetCombatant.id);
        const spellName = getConcentrationSpellName(latestCombatant?.resources);
        if (spellName && this.deps.diceRoller) {
          // Get CON save modifier from the character sheet or stat block
          const targetSheet = (target as any).sheet ?? (target as any).statBlock;
          const conScore = targetSheet?.abilityScores?.constitution ?? 10;
          const profBonus = targetSheet?.proficiencyBonus ?? 2;
          const saveProficiencies: string[] = Array.isArray(targetSheet?.saveProficiencies) ? targetSheet.saveProficiencies : [];
          const totalMod = computeConSaveModifier(conScore, profBonus, saveProficiencies);

          const result = concentrationCheckOnDamage(this.deps.diceRoller, totalDamage, totalMod);

          if (this.debugLogsEnabled) console.log(`[RollStateMachine] Concentration check: ${result.check.total} vs DC ${result.dc} → ${result.maintained ? "maintained" : "LOST"}`);

          if (!result.maintained) {
            await breakConcentration(
              latestCombatant!,
              encounter.id,
              this.deps.combatRepo,
              this.debugLogsEnabled ? (msg) => console.log(`[RollStateMachine] ${msg}`) : undefined,
            );
          }

          // Emit concentration event
          const targetEntityId = targetCombatant.characterId ?? targetCombatant.monsterId ?? targetCombatant.npcId ?? action.targetId;
          await this.eventEmitter.emitConcentrationEvent(
            sessionId, encounter.id, targetEntityId, characters, monsters,
            {
              maintained: result.maintained,
              spellName,
              dc: result.dc,
              roll: result.check.total,
              damage: totalDamage,
            },
          );
        }
      }

      // ── ActiveEffect: retaliatory damage (Armor of Agathys, Fire Shield) ──
      if (totalDamage > 0 && action.weaponSpec?.kind === "melee") {
        const tgtEffects = getActiveEffects(targetCombatant.resources ?? {});
        const retaliatory = tgtEffects.filter(e => e.type === 'retaliatory_damage');
        if (retaliatory.length > 0 && this.deps.diceRoller) {
          const attackerForRetaliation = combatantStates.find(
            (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
          );
          if (attackerForRetaliation && attackerForRetaliation.hpCurrent > 0) {
            let totalRetaliatoryDamage = 0;
            for (const eff of retaliatory) {
              let retDmg = eff.value ?? 0;
              if (eff.diceValue) {
                for (let i = 0; i < eff.diceValue.count; i++) {
                  retDmg += this.deps.diceRoller.rollDie(eff.diceValue.sides).total;
                }
              }
              totalRetaliatoryDamage += retDmg;
              if (this.debugLogsEnabled) console.log(`[RollStateMachine] Retaliatory damage (${eff.source ?? 'effect'}): ${retDmg} ${eff.damageType ?? ''}`);
            }
            if (totalRetaliatoryDamage > 0) {
              const atkHpBefore = attackerForRetaliation.hpCurrent;
              const atkHpAfter = Math.max(0, atkHpBefore - totalRetaliatoryDamage);
              await this.deps.combatRepo.updateCombatantState(attackerForRetaliation.id, { hpCurrent: atkHpAfter });
              await applyKoEffectsIfNeeded(
                attackerForRetaliation, atkHpBefore, atkHpAfter, this.deps.combatRepo,
                this.debugLogsEnabled ? (msg) => console.log(`[RollStateMachine] ${msg}`) : undefined,
              );
              if (this.debugLogsEnabled) console.log(`[RollStateMachine] Retaliatory damage: ${totalRetaliatoryDamage} to ${actorId} (HP: ${atkHpBefore} → ${atkHpAfter})`);
            }
          }
        }
      }
    }

    // Mark Sneak Attack as used for this turn if it was applied
    if (action.sneakAttackDice && action.sneakAttackDice > 0) {
      const actorCombatant = combatantStates.find((c: any) => c.characterId === actorId);
      if (actorCombatant) {
        const actorRes = normalizeResources(actorCombatant.resources);
        await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: { ...actorRes, sneakAttackUsedThisTurn: true } as any,
        });
        if (this.debugLogsEnabled) console.log(`[RollStateMachine] Sneak Attack used this turn — marked`);
      }
    }

    await this.deps.combatRepo.clearPendingAction(encounter.id);

    const targetName = (target as any).name ?? "Target";
    const isFlurryStrike1 = action.bonusAction === "flurry-of-blows" && action.flurryStrike === 1;
    const isFlurryStrike2 = action.bonusAction === "flurry-of-blows" && action.flurryStrike === 2;

    // --- Weapon Mastery: automatic on-hit effects ---
    // Applied after damage, before hit-rider enhancements (which are player opt-in).
    // Only triggers if target is still alive (hpAfter > 0) and weapon has mastery.
    let masterySuffix = "";
    if (action.weaponSpec?.mastery && hpAfter > 0 && totalDamage > 0) {
      masterySuffix = await this.resolveWeaponMastery(
        action.weaponSpec.mastery,
        actorId,
        action.targetId,
        encounter.id,
        sessionId,
        action.weaponSpec,
        characters,
        monsters,
        npcs,
      );
    }

    // Generic hit-rider enhancement resolution (System 2)
    // Processes ALL enhancements through the unified pipeline:
    // Stunning Strike saves, OHT effects, bonus dice (Divine Smite), etc.
    const enhancementResults: HitRiderEnhancementResult[] = [];
    if (action.enhancements && action.enhancements.length > 0 && hpAfter > 0) {
      for (const enhancement of action.enhancements) {
        // Bonus dice enhancements (e.g., Divine Smite radiant damage)
        if (enhancement.bonusDice) {
          let bonusDamage = 0;
          for (let i = 0; i < enhancement.bonusDice.diceCount; i++) {
            const dieRoll = this.deps.diceRoller?.rollDie(enhancement.bonusDice.diceSides);
            bonusDamage += dieRoll?.total ?? 0;
          }
          if (bonusDamage > 0) {
            const targetCombatantForBonus = (await this.deps.combatRepo.listCombatants(encounter.id))
              .find((c: any) => c.characterId === action.targetId || c.monsterId === action.targetId || c.npcId === action.targetId);
            if (targetCombatantForBonus) {
              const bonusHpBefore = targetCombatantForBonus.hpCurrent;
              const newHp = Math.max(0, bonusHpBefore - bonusDamage);
              await this.deps.combatRepo.updateCombatantState(targetCombatantForBonus.id, { hpCurrent: newHp });
              await applyKoEffectsIfNeeded(targetCombatantForBonus, bonusHpBefore, newHp, this.deps.combatRepo);
              hpAfter = newHp;
              totalDamage += bonusDamage;
            }
            enhancementResults.push({
              abilityId: enhancement.abilityId,
              displayName: enhancement.displayName,
              summary: `${enhancement.displayName}: ${bonusDamage} bonus damage!`,
            });
          }
        }

        // Post-damage effects (saving throws, condition application, etc.)
        if (enhancement.postDamageEffect) {
          const effectResult = await this.resolvePostDamageEffect(
            enhancement, actorId, action.targetId, encounter.id,
            characters, monsters, npcs,
          );
          enhancementResults.push(effectResult);
        }
      }
    }

    // Map enhancement results to legacy response fields for backward compatibility
    // (test harness expects stunningStrike/openHandTechnique as separate response fields)
    const stunningStrikeResult = enhancementResults.find((r) => r.abilityId === "class:monk:stunning-strike");
    const ohtResult = enhancementResults.find((r) => r.abilityId === "class:monk:open-hand-technique");
    const genericEnhancements = enhancementResults.filter(
      (r) => r.abilityId !== "class:monk:stunning-strike" && r.abilityId !== "class:monk:open-hand-technique",
    );

    if (isFlurryStrike1) {
      const pendingAction2: AttackPendingAction = {
        type: "ATTACK",
        timestamp: new Date(),
        actorId,
        attacker: actorId,
        target: action.targetId,
        targetId: action.targetId,
        weaponSpec: action.weaponSpec,
        bonusAction: "flurry-of-blows",
        flurryStrike: 2,
        // On-hit enhancements are resolved per-strike via damage text keywords — nothing to propagate
      };

      await this.deps.combatRepo.setPendingAction(encounter.id, pendingAction2);

      const ohtSuffix = ohtResult ? ` ${ohtResult.summary}` : "";
      const ssSuffix = stunningStrikeResult ? ` ${stunningStrikeResult.summary}` : "";
      const enhSuffix = genericEnhancements.map((r) => ` ${r.summary}`).join("");
      return {
        rollType: "attack",
        rawRoll: rollValue,
        modifier: damageModifier,
        total: totalDamage,
        totalDamage,
        targetName,
        hpBefore,
        hpAfter,
        targetHpRemaining: hpAfter,
        actionComplete: false,
        requiresPlayerInput: true,
        type: "REQUEST_ROLL",
        diceNeeded: "d20",
        message: `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}.${masterySuffix}${ohtSuffix}${ssSuffix}${enhSuffix} Second strike: Roll a d20.`,
        ...(ohtResult ? { openHandTechnique: ohtResult } : {}),
        ...(stunningStrikeResult ? { stunningStrike: stunningStrikeResult } : {}),
      };
    }

    await this.eventEmitter.markActionSpent(encounter.id, actorId);

    // D&D 5e 2024: Loading property — mark that a Loading weapon was fired this turn
    if (action.weaponSpec?.properties?.some((p: string) => typeof p === "string" && p.toLowerCase() === "loading")) {
      const combatantStatesForLoading = await this.deps.combatRepo.listCombatants(encounter.id);
      const actorForLoading = combatantStatesForLoading.find(
        (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
      );
      if (actorForLoading) {
        const loadRes = normalizeResources(actorForLoading.resources);
        await this.deps.combatRepo.updateCombatantState(actorForLoading.id, {
          resources: { ...loadRes, loadingWeaponFiredThisTurn: true } as any,
        });
      }
    }

    // Drop thrown weapon on the ground at target position (hit)
    if (action.weaponSpec?.isThrownAttack) {
      await this.dropThrownWeaponOnGround(encounter, actorId, action.targetId, action.weaponSpec, encounter.round ?? 1);
    }

    // Check for victory/defeat if target was defeated
    let combatEnded = false;
    let victoryStatus: CombatVictoryStatus | undefined;
    if (hpAfter <= 0 && this.deps.victoryPolicy) {
      // Re-fetch combatants with updated HP
      const updatedCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
      victoryStatus = await this.deps.victoryPolicy.evaluate({ combatants: updatedCombatants }) ?? undefined;

      if (victoryStatus) {
        combatEnded = true;
        // Update encounter status
        await this.deps.combatRepo.updateEncounter(encounter.id, { status: victoryStatus });

        // Emit CombatEnded event if event repo is available
        if (this.deps.events) {
          await this.deps.events.append(sessionId, {
            id: nanoid(),
            type: "CombatEnded",
            payload: { encounterId: encounter.id, result: victoryStatus },
          });
        }
      }
    }

    // Drop loot from defeated monsters onto the battlefield
    if (hpAfter <= 0 && targetCombatant?.combatantType === "Monster") {
      await this.dropMonsterLoot(encounter, targetCombatant, monsters);
    }

    const narration = await this.eventEmitter.generateNarration(combatEnded ? "combatVictory" : "damageDealt", {
      damageRoll: rollValue,
      damageModifier,
      totalDamage,
      targetName,
      hpBefore,
      hpAfter,
      defeated: hpAfter <= 0,
      victoryStatus,
    });

    const enhancementSuffix = genericEnhancements.map((r) => ` ${r.summary}`).join("");
    return {
      rollType: "damage",
      rawRoll: rollValue,
      modifier: damageModifier,
      total: totalDamage,
      totalDamage,
      targetName,
      hpBefore,
      hpAfter,
      targetHpRemaining: hpAfter,
      actionComplete: true,
      requiresPlayerInput: false,
      message: combatEnded
        ? `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}. ${victoryStatus}!${masterySuffix}${enhancementSuffix}`
        : `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}${masterySuffix}${enhancementSuffix}`,
      narration,
      combatEnded,
      victoryStatus,
      ...(ohtResult ? { openHandTechnique: ohtResult } : {}),
      ...(stunningStrikeResult ? { stunningStrike: stunningStrikeResult } : {}),
      ...(genericEnhancements.length > 0 ? { enhancements: genericEnhancements } : {}),
    };
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
   * Resolve automatic weapon mastery effects after damage is dealt.
   *
   * Returns a suffix string to append to the damage message.
   * Effects are applied to combat state (conditions, resources, position).
   *
   * Mastery effects are AUTOMATIC (not opt-in like Stunning Strike) and
   * resolved separately from the HitRiderEnhancement pipeline.
   */
  private async resolveWeaponMastery(
    mastery: WeaponMasteryProperty,
    actorId: string,
    targetId: string,
    encounterId: string,
    sessionId: string,
    weaponSpec: import("./tabletop-types.js").WeaponSpec,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
  ): Promise<string> {
    return this.weaponMasteryResolver.resolve(mastery, actorId, targetId, encounterId, sessionId, weaponSpec, characters, monsters, npcs);
  }

  // ----- Post-Damage Effect Resolution (System 2) -----

  /**
   * Resolve a post-damage effect from a hit-rider enhancement.
   * Handles saving throws (via SavingThrowResolver), condition application, etc.
   *
   * This is the core of the generic hit-rider pipeline — any ability that triggers
   * effects after damage (Stunning Strike, Open Hand Technique, Divine Smite conditions, etc.)
   * routes through here.
   */
  private async resolvePostDamageEffect(
    enhancement: HitRiderEnhancement,
    actorId: string,
    targetId: string,
    encounterId: string,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
  ): Promise<HitRiderEnhancementResult> {
    return this.hitRiderResolver.resolvePostDamageEffect(enhancement, actorId, targetId, encounterId, characters, monsters, npcs);
  }

  /**
   * Expose the saving throw resolver for direct access by other modules.
   * Used by the action dispatcher to inject saving throws mid-flow.
   */
  getSavingThrowResolver(): SavingThrowResolver | null {
    return this.savingThrowResolver;
  }
}
