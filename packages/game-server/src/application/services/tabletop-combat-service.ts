/**
 * TabletopCombatService - Manages tabletop-style combat flow with manual dice rolling.
 *
 * This service owns the pending-action state machine for tabletop combat:
 * INITIATIVE → ATTACK_ROLL → DAMAGE_ROLL → complete
 *
 * Extracted from routes/sessions.ts to provide a clean separation between
 * HTTP handling and combat flow orchestration.
 */

import { nanoid } from "nanoid";
import type { ICharacterRepository } from "../repositories/character-repository.js";
import type { IMonsterRepository } from "../repositories/monster-repository.js";
import type { INPCRepository } from "../repositories/npc-repository.js";
import type { ICombatRepository } from "../repositories/combat-repository.js";
import type { IEventRepository } from "../repositories/event-repository.js";
import type { PendingActionRepository } from "../repositories/pending-action-repository.js";
import type { CombatService } from "./combat/combat-service.js";
import type { ActionService } from "./combat/action-service.js";
import type { TwoPhaseActionService } from "./combat/two-phase-action-service.js";
import type { CombatantResolver } from "./combat/helpers/combatant-resolver.js";
import type { AiTurnOrchestrator } from "./combat/ai/index.js";
import type { IIntentParser } from "../../infrastructure/llm/intent-parser.js";
import type { INarrativeGenerator } from "../../infrastructure/llm/narrative-generator.js";
import type { CombatVictoryPolicy, CombatVictoryStatus } from "./combat/combat-victory-policy.js";
import { ValidationError, NotFoundError } from "../errors.js";
import { calculateDistance } from "../../domain/rules/movement.js";
import {
  getPosition,
  normalizeResources,
} from "./combat/helpers/resource-utils.js";
import { ClassFeatureResolver } from "../../domain/entities/classes/class-feature-resolver.js";
import {
  buildGameCommandSchemaHint,
  parseGameCommand,
  type LlmRoster,
} from "../commands/game-command.js";
import type { DiceRoller } from "../../domain/rules/dice-roller.js";

// ----- Types -----

export type PendingActionType = "INITIATIVE" | "ATTACK" | "DAMAGE";

export interface InitiatePendingAction {
  type: "INITIATIVE";
  timestamp: Date;
  actorId: string;
  initiator: string;
  intendedTarget?: string;
  intendedTargets?: string[];
}

export interface AttackPendingAction {
  type: "ATTACK";
  timestamp: Date;
  actorId: string;
  attacker: string;
  target?: string;
  targetId?: string;
  weaponSpec?: WeaponSpec;
  bonusAction?: "flurry-of-blows";
  flurryStrike?: 1 | 2;
}

export interface DamagePendingAction {
  type: "DAMAGE";
  timestamp: Date;
  actorId: string;
  targetId: string;
  weaponSpec?: WeaponSpec;
  attackRollResult: number;
  bonusAction?: "flurry-of-blows";
  flurryStrike?: 1 | 2;
}

export type TabletopPendingAction = InitiatePendingAction | AttackPendingAction | DamagePendingAction;

export interface WeaponSpec {
  name: string;
  kind: "melee" | "ranged";
  attackBonus: number;
  damage?: { diceCount: number; diceSides: number; modifier: number };
  damageFormula?: string;
}

export interface RollRequest {
  requiresPlayerInput: true;
  type: "REQUEST_ROLL";
  rollType: "initiative" | "attack" | "damage";
  message: string;
  narration?: string;
  diceNeeded: string;
  pendingAction?: TabletopPendingAction;
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface CombatStartedResult {
  rollType: "initiative";
  rawRoll: number;
  modifier: number;
  total: number;
  combatStarted: true;
  encounterId: string;
  turnOrder: Array<{ actorId: string; actorName: string; initiative: number }>;
  currentTurn: { actorId: string; actorName: string; initiative: number } | null;
  message: string;
  narration?: string;
}

export interface AttackResult {
  rollType: "attack" | "damage";
  rawRoll: number;
  modifier: number;
  total: number;
  targetAC: number;
  hit: boolean;
  targetHpRemaining?: number;
  requiresPlayerInput: boolean;
  actionComplete: boolean;
  message: string;
  narration?: string;
  type?: "REQUEST_ROLL";
  diceNeeded?: string;
}

export interface DamageResult {
  rollType: "damage" | "attack";
  rawRoll: number;
  modifier: number;
  total: number;
  totalDamage: number;
  targetName: string;
  hpBefore: number;
  hpAfter: number;
  targetHpRemaining: number;
  actionComplete: boolean;
  requiresPlayerInput: boolean;
  message: string;
  narration?: string;
  type?: "REQUEST_ROLL";
  diceNeeded?: string;
  combatEnded?: boolean;
  victoryStatus?: CombatVictoryStatus;
}

export interface ActionParseResult {
  requiresPlayerInput: boolean;
  actionComplete: boolean;
  type: string;
  action?: string;
  message: string;
  narration?: string;
  success?: boolean;
  pendingAction?: TabletopPendingAction;
  movedTo?: { x: number; y: number };
  to?: { x: number; y: number };
  movedFeet?: number | null;
  opportunityAttacks?: unknown[];
  pendingActionId?: string;
  rollType?: string;
  diceNeeded?: string;
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface TabletopCombatServiceDeps {
  characters: ICharacterRepository;
  monsters: IMonsterRepository;
  npcs: INPCRepository;
  combatRepo: ICombatRepository;
  combat: CombatService;
  actions: ActionService;
  twoPhaseActions: TwoPhaseActionService;
  combatants: CombatantResolver;
  pendingActions: PendingActionRepository;
  events?: IEventRepository;
  monsterAI?: AiTurnOrchestrator;
  intentParser?: IIntentParser;
  narrativeGenerator?: INarrativeGenerator;
  victoryPolicy?: CombatVictoryPolicy;
}

export class TabletopCombatService {
  private debugLogsEnabled: boolean;

  constructor(private readonly deps: TabletopCombatServiceDeps) {
    this.debugLogsEnabled =
      process.env.DM_DEBUG_LOGS === "1" ||
      process.env.DM_DEBUG_LOGS === "true" ||
      process.env.DM_DEBUG_LOGS === "yes";
  }

  // ----- Narrative helper -----

  /**
   * Generate narrative flavor text for an event using the LLM.
   * Returns undefined if no narrative generator is configured.
   */
  private async generateNarration(eventType: string, payload: Record<string, unknown>): Promise<string | undefined> {
    if (!this.deps.narrativeGenerator) {
      return undefined;
    }

    try {
      const narration = await this.deps.narrativeGenerator.narrate({
        storyFramework: { genre: "fantasy", tone: "heroic" },
        events: [{ type: eventType, payload }],
      });
      return narration;
    } catch (err) {
      if (this.debugLogsEnabled) {
        console.error("[TabletopCombat] Narration failed:", err);
      }
      return undefined;
    }
  }

  // ----- Public API -----

  /**
   * Initiate a combat action from natural language text.
   * Returns a roll request (typically for initiative).
   */
  async initiateAction(sessionId: string, text: string, actorId: string): Promise<RollRequest> {
    const { roster, monsters } = await this.loadRoster(sessionId);

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
      encounter = await this.deps.combatRepo.createEncounter(sessionId, {
        id: encounterId,
        status: "Pending",
        round: 0,
        turn: 0,
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

    const pendingAction: InitiatePendingAction = {
      type: "INITIATIVE",
      timestamp: new Date(),
      actorId,
      initiator: actorId,
      intendedTarget,
      intendedTargets,
    };

    await this.deps.combatRepo.setPendingAction(encounter.id, pendingAction);

    const narration = await this.generateNarration("initiativeRequest", {
      actorId,
      target: intendedTarget,
    });

    return {
      requiresPlayerInput: true,
      type: "REQUEST_ROLL",
      rollType: "initiative",
      message: "Roll for initiative! (d20 + your DEX modifier)",
      narration,
      diceNeeded: "d20",
      pendingAction,
    };
  }

  /**
   * Process a roll result (initiative, attack, or damage).
   */
  async processRollResult(
    sessionId: string,
    text: string,
    actorId: string,
  ): Promise<CombatStartedResult | AttackResult | DamageResult> {
    const { characters, monsters, npcs, roster } = await this.loadRoster(sessionId);

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

    // Determine expected roll type
    let expectedRollType = "initiative";
    if (action.type === "ATTACK") expectedRollType = "attack";
    else if (action.type === "DAMAGE") expectedRollType = "damage";

    // Parse roll value
    const command = await this.parseRollValue(text, expectedRollType, roster);

    // Route to appropriate handler
    if (action.type === "INITIATIVE" && command.rollType === "initiative") {
      return this.handleInitiativeRoll(sessionId, encounter, action, command, actorId, characters, monsters, npcs);
    }

    if (action.type === "ATTACK" && command.rollType === "attack") {
      return this.handleAttackRoll(sessionId, encounter, action, command, actorId, characters, monsters, npcs);
    }

    if (action.type === "DAMAGE" && command.rollType === "damage") {
      return this.handleDamageRoll(sessionId, encounter, action, command, actorId, characters, monsters, npcs);
    }

    throw new ValidationError(`Roll type ${command.rollType} not yet implemented for action type ${action.type}`);
  }

  /**
   * Parse a combat action from text (move, attack, bonus action).
   */
  async parseCombatAction(
    sessionId: string,
    text: string,
    actorId: string,
    encounterId: string,
  ): Promise<ActionParseResult> {
    const { characters, monsters, npcs, roster } = await this.loadRoster(sessionId);

    // Try direct parsing first
    const directMove = this.tryParseMoveText(text);
    const directSimple = directMove ? null : this.tryParseSimpleActionText(text);
    const directBonus = directMove || directSimple ? null : this.tryParseBonusActionText(text);
    const directHelp = !directMove && !directSimple && !directBonus ? this.tryParseHelpText(text) : null;
    const directShove = !directMove && !directSimple && !directBonus && !directHelp ? this.tryParseShoveText(text) : null;
    const directCastSpell = !directMove && !directSimple && !directBonus && !directHelp && !directShove ? this.tryParseCastSpellText(text) : null;

    if (directMove) {
      return this.handleMoveAction(sessionId, encounterId, actorId, directMove, roster);
    }

    if (directSimple) {
      return this.handleSimpleAction(sessionId, encounterId, actorId, directSimple, roster);
    }

    if (directBonus === "flurry-of-blows") {
      return this.handleFlurryOfBlows(sessionId, encounterId, actorId, text, characters, monsters);
    }

    if (directHelp) {
      return this.handleHelpAction(sessionId, encounterId, actorId, directHelp, roster, [...characters, ...monsters, ...npcs]);
    }

    if (directShove) {
      return this.handleShoveAction(sessionId, encounterId, actorId, directShove, roster, [...characters, ...monsters, ...npcs]);
    }

    if (directCastSpell) {
      return this.handleCastSpellAction(sessionId, encounterId, actorId, directCastSpell, roster);
    }

    // Fall back to LLM parsing
    if (!this.deps.intentParser) {
      throw new ValidationError("LLM intent parser is not configured");
    }

    const intent = await this.deps.intentParser.parseIntent({
      text,
      schemaHint: buildGameCommandSchemaHint(roster),
    });

    let command: any;
    try {
      command = parseGameCommand(intent);
    } catch (err) {
      throw new ValidationError(`Could not parse combat action: ${(err as Error).message}`);
    }

    if (command.kind === "move") {
      return this.handleMoveAction(sessionId, encounterId, actorId, command.destination, roster);
    }

    if (command.kind === "attack") {
      return this.handleAttackAction(sessionId, encounterId, actorId, text, command, characters, monsters, npcs);
    }

    throw new ValidationError(`Action type ${command.kind} not yet implemented`);
  }

  /**
   * Complete a move after reaction resolution.
   */
  async completeMove(sessionId: string, pendingActionId: string): Promise<ActionParseResult> {
    const pendingAction = await this.deps.pendingActions.getById(pendingActionId);
    if (!pendingAction) {
      throw new NotFoundError(`Pending action not found: ${pendingActionId}`);
    }

    // Check for player OAs needing rolls
    const combatants = await this.deps.combatRepo.listCombatants(pendingAction.encounterId);
    const playerOAsAwaitingRolls = pendingAction.resolvedReactions
      .filter((r: any) => r.choice === "use")
      .filter((r: any) => {
        const combatant = combatants.find((c) => c.id === r.combatantId);
        return combatant?.combatantType === "Character";
      })
      .filter((r: any) => !r.result || !r.result.attackRoll);

    if (playerOAsAwaitingRolls.length > 0) {
      const nextOA = playerOAsAwaitingRolls[0] as any;
      const needsDamage = nextOA.result?.hit === true && !nextOA.result.damageRoll;

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
    const actorCombatant = combatants.find(
      (c) =>
        (pendingAction.actor.type === "Character" && c.characterId === (pendingAction.actor as any).characterId) ||
        (pendingAction.actor.type === "Monster" && c.monsterId === (pendingAction.actor as any).monsterId) ||
        (pendingAction.actor.type === "NPC" && c.npcId === (pendingAction.actor as any).npcId),
    );

    const isMonsterOrNpc = actorCombatant && (actorCombatant.combatantType === "Monster" || actorCombatant.combatantType === "NPC");

    if (isMonsterOrNpc) {
      await this.deps.combat.nextTurn(sessionId, { encounterId: pendingAction.encounterId });
      if (this.deps.monsterAI) {
        void this.deps.monsterAI.processAllMonsterTurns(sessionId, pendingAction.encounterId).catch(console.error);
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

  // ----- Private helpers -----

  private async loadRoster(sessionId: string) {
    const characters = await this.deps.characters.listBySession(sessionId);
    const monsters = await this.deps.monsters.listBySession(sessionId);
    const npcs = await this.deps.npcs.listBySession(sessionId);

    const roster: LlmRoster = {
      characters: characters.map((c) => ({ id: c.id, name: c.name })),
      monsters: monsters.map((m) => ({ id: m.id, name: m.name })),
      npcs: npcs.map((n) => ({ id: n.id, name: n.name })),
    };

    return { characters, monsters, npcs, roster };
  }

  private async parseRollValue(text: string, expectedRollType: string, roster: LlmRoster) {
    const numberFromText = (() => {
      const m = text.match(/\b(\d{1,3})\b/);
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    })();

    const looksLikeARoll = /\broll(?:ed)?\b/i.test(text);

    if (looksLikeARoll && numberFromText !== null) {
      return { kind: "rollResult", value: numberFromText, rollType: expectedRollType };
    }

    if (!this.deps.intentParser) {
      if (numberFromText !== null) {
        return { kind: "rollResult", value: numberFromText, rollType: expectedRollType };
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
        kind: "rollResult",
        value: (intent as any).value ?? (intent as any).result ?? (intent as any).roll,
        values: (intent as any).values,
        rollType: (intent as any).rollType ?? expectedRollType,
      };
    } catch {
      if (numberFromText !== null) {
        return { kind: "rollResult", value: numberFromText, rollType: expectedRollType };
      }
      return {
        kind: "rollResult",
        value: (intent as any).value ?? (intent as any).result ?? (intent as any).roll,
        rollType: expectedRollType,
      };
    }
  }

  private async handleInitiativeRoll(
    sessionId: string,
    encounter: any,
    action: InitiatePendingAction,
    command: any,
    actorId: string,
    characters: any[],
    monsters: any[],
    npcs: any[],
  ): Promise<CombatStartedResult> {
    const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);

    const character = characters.find((c) => c.id === actorId);
    let dexModifier = 0;

    if (character && typeof character.sheet === "object" && character.sheet !== null) {
      const sheet = character.sheet as any;
      if (sheet.abilityScores?.dexterity) {
        dexModifier = Math.floor((sheet.abilityScores.dexterity - 10) / 2);
      }
    }

    const finalInitiative = rollValue + dexModifier;

    // Include all session monsters
    const intendedTargetIds: string[] = action.intendedTargets ?? (action.intendedTarget ? [action.intendedTarget] : []);
    const allMonsterIds = monsters.map((m) => m.id);
    const targetIds: string[] = [...new Set([...intendedTargetIds, ...allMonsterIds])];

    // Build combatants
    const combatants: any[] = [];

    if (character) {
      const sheet = character.sheet as any;
      combatants.push({
        combatantType: "Character" as const,
        characterId: actorId,
        initiative: finalInitiative,
        hpCurrent: sheet?.maxHp ?? 10,
        hpMax: sheet?.maxHp ?? 10,
      });
    }

    for (const targetId of targetIds) {
      const monster = monsters.find((m) => m.id === targetId);
      if (monster) {
        const statBlock = monster.statBlock as any;
        let monsterInitiative = 10;

        if (statBlock.abilityScores?.dexterity) {
          const monsterDexMod = Math.floor((statBlock.abilityScores.dexterity - 10) / 2);
          monsterInitiative = 10 + monsterDexMod;
        }

        combatants.push({
          combatantType: "Monster" as const,
          monsterId: targetId,
          initiative: monsterInitiative,
          hpCurrent: statBlock.hp ?? statBlock.maxHp ?? 10,
          hpMax: statBlock.maxHp ?? statBlock.hp ?? 10,
        });
      }
    }

    // Check for existing combatants
    const existingCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
    if (existingCombatants.length > 0) {
      throw new ValidationError("Combat already started - encounter has combatants");
    }

    await this.deps.combat.addCombatantsToEncounter(sessionId, encounter.id, combatants);
    const combatantStates = await this.deps.combatRepo.listCombatants(encounter.id);

    const turnOrder = combatantStates.map((c: any) => ({
      actorId: c.characterId || c.monsterId || c.npcId || c.id,
      actorName:
        c.combatantType === "Character"
          ? characters.find((ch) => ch.id === c.characterId)?.name ?? "Character"
          : c.combatantType === "Monster"
            ? monsters.find((m) => m.id === c.monsterId)?.name ?? "Monster"
            : npcs.find((n) => n.id === c.npcId)?.name ?? "NPC",
      initiative: c.initiative ?? 0,
    }));

    const currentTurn = turnOrder[0] ?? null;

    await this.deps.combatRepo.clearPendingAction(encounter.id);

    // If monster acts first, start monster AI
    if (this.deps.monsterAI && currentTurn?.actorId && monsters.some((m) => m.id === currentTurn.actorId)) {
      void this.deps.monsterAI.processAllMonsterTurns(sessionId, encounter.id).catch(console.error);
    }

    const narration = await this.generateNarration("combatStarted", {
      initiativeRoll: rollValue,
      dexModifier,
      finalInitiative,
      firstActor: currentTurn?.actorName,
    });

    return {
      rollType: "initiative",
      rawRoll: rollValue,
      modifier: dexModifier,
      total: finalInitiative,
      combatStarted: true,
      encounterId: encounter.id,
      turnOrder,
      currentTurn,
      message: `Combat started! ${currentTurn?.actorName}'s turn (Initiative: ${currentTurn?.initiative}).`,
      narration,
    };
  }

  private async handleAttackRoll(
    sessionId: string,
    encounter: any,
    action: AttackPendingAction,
    command: any,
    actorId: string,
    characters: any[],
    monsters: any[],
    npcs: any[],
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

    const targetAC = (target as any).statBlock?.armorClass || (target as any).sheet?.armorClass || 10;
    const attackBonus = action.weaponSpec?.attackBonus ?? 5;
    const total = rollValue + attackBonus;
    const hit = total >= targetAC;

    // Emit events
    await this.emitAttackEvents(sessionId, encounter.id, actorId, targetId, characters, monsters, hit, rollValue, total);

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
          targetAC,
          hit: false,
          targetHpRemaining: (target as any).statBlock?.hp ?? (target as any).sheet?.maxHp ?? 0,
          requiresPlayerInput: true,
          actionComplete: false,
          type: "REQUEST_ROLL",
          diceNeeded: "d20",
          message: `${rollValue} + ${attackBonus} = ${total} vs AC ${targetAC}. Miss! Second strike: Roll a d20.`,
        };
      }

      // Regular miss
      await this.deps.combatRepo.clearPendingAction(encounter.id);
      await this.markActionSpent(encounter.id, actorId);

      const narration = await this.generateNarration("attackMiss", {
        attackRoll: rollValue,
        attackBonus,
        total,
        targetAC,
        targetName: target?.name ?? "target",
      });

      return {
        rollType: "attack",
        rawRoll: rollValue,
        modifier: attackBonus,
        total,
        targetAC,
        hit: false,
        targetHpRemaining: (target as any).statBlock?.hp ?? (target as any).sheet?.maxHp ?? 0,
        requiresPlayerInput: false,
        actionComplete: true,
        message: `${rollValue} + ${attackBonus} = ${total} vs AC ${targetAC}. Miss!`,
        narration,
      };
    }

    // Hit - request damage roll
    const damageAction: DamagePendingAction = {
      type: "DAMAGE",
      timestamp: new Date(),
      actorId,
      targetId: targetId!,
      weaponSpec: action.weaponSpec,
      attackRollResult: total,
      bonusAction: action.bonusAction,
      flurryStrike: action.flurryStrike,
    };

    await this.deps.combatRepo.setPendingAction(encounter.id, damageAction);

    const narration = await this.generateNarration("attackHit", {
      attackRoll: rollValue,
      attackBonus,
      total,
      targetAC,
      targetName: target?.name ?? "target",
      damageFormula: action.weaponSpec?.damageFormula ?? "1d8",
    });

    return {
      rollType: "damage",
      rawRoll: rollValue,
      modifier: attackBonus,
      total,
      targetAC,
      hit: true,
      requiresPlayerInput: true,
      actionComplete: false,
      type: "REQUEST_ROLL",
      diceNeeded: action.weaponSpec?.damageFormula ?? "1d8",
      message: `${rollValue} + ${attackBonus} = ${total} vs AC ${targetAC}. Hit! Roll ${action.weaponSpec?.damageFormula ?? "1d8"} for damage.`,
      narration,
    };
  }

  private async handleDamageRoll(
    sessionId: string,
    encounter: any,
    action: DamagePendingAction,
    command: any,
    actorId: string,
    characters: any[],
    monsters: any[],
    npcs: any[],
  ): Promise<DamageResult> {
    const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);

    const target =
      monsters.find((m) => m.id === action.targetId) ||
      characters.find((c) => c.id === action.targetId) ||
      npcs.find((n) => n.id === action.targetId);

    if (!target) {
      throw new ValidationError("Target not found");
    }

    const damageModifier = this.parseDamageModifier(action.weaponSpec?.damageFormula, action.weaponSpec?.damage?.modifier);
    const totalDamage = rollValue + damageModifier;

    // Apply damage
    const combatantStates = await this.deps.combatRepo.listCombatants(encounter.id);
    const targetCombatant = combatantStates.find(
      (c: any) => c.characterId === action.targetId || c.monsterId === action.targetId || c.npcId === action.targetId,
    );

    const hpBefore = targetCombatant?.hpCurrent ?? 0;
    let hpAfter = hpBefore;

    if (targetCombatant) {
      hpAfter = Math.max(0, targetCombatant.hpCurrent - totalDamage);
      await this.deps.combatRepo.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });
      await this.emitDamageEvents(sessionId, encounter.id, actorId, action.targetId, characters, monsters, totalDamage, hpAfter);
    }

    await this.deps.combatRepo.clearPendingAction(encounter.id);

    const targetName = (target as any).name ?? "Target";
    const isFlurryStrike1 = action.bonusAction === "flurry-of-blows" && action.flurryStrike === 1;

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
      };

      await this.deps.combatRepo.setPendingAction(encounter.id, pendingAction2);

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
        message: `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}. Second strike: Roll a d20.`,
      };
    }

    await this.markActionSpent(encounter.id, actorId);

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

    const narration = await this.generateNarration(combatEnded ? "combatVictory" : "damageDealt", {
      damageRoll: rollValue,
      damageModifier,
      totalDamage,
      targetName,
      hpBefore,
      hpAfter,
      defeated: hpAfter <= 0,
      victoryStatus,
    });

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
        ? `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}. ${victoryStatus}!`
        : `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}`,
      narration,
      combatEnded,
      victoryStatus,
    };
  }

  private async handleMoveAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    destination: { x: number; y: number },
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actorRef = this.inferActorRef(actorId, roster);

    const moveInit = await this.deps.twoPhaseActions.initiateMove(sessionId, {
      encounterId,
      actor: actorRef,
      destination,
    });

    if (moveInit.status === "no_reactions") {
      const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
      const actorState = combatantStates.find((c: any) => {
        if (actorRef.type === "Character") return c.characterId === actorRef.characterId;
        if (actorRef.type === "Monster") return c.monsterId === actorRef.monsterId;
        return c.npcId === actorRef.npcId;
      });

      if (!actorState) throw new ValidationError("Actor not found in encounter");

      const resources = (actorState.resources as any) ?? {};
      const currentPos = resources.position;

      await this.deps.combatRepo.updateCombatantState(actorState.id, {
        resources: { ...resources, position: destination, movementSpent: true } as any,
      });

      const movedFeet = currentPos ? calculateDistance(currentPos, destination) : null;

      const narration = await this.generateNarration("movementComplete", {
        actorId,
        from: currentPos,
        to: destination,
        distance: movedFeet,
      });

      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "MOVE_COMPLETE",
        movedTo: destination,
        movedFeet,
        opportunityAttacks: moveInit.opportunityAttacks,
        message: `Moved to (${destination.x}, ${destination.y})${movedFeet !== null ? ` (${Math.round(movedFeet)}ft)` : ""}.`,
        narration,
      };
    }

    return {
      requiresPlayerInput: false,
      actionComplete: false,
      type: "REACTION_CHECK",
      pendingActionId: moveInit.pendingActionId,
      opportunityAttacks: moveInit.opportunityAttacks,
      message: "Opportunity attacks possible. Resolve reactions, then complete the move.",
    };
  }

  private async handleSimpleAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    action: "dash" | "dodge" | "disengage",
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = this.inferActorRef(actorId, roster);

    if (action === "dash") {
      await this.deps.actions.dash(sessionId, { encounterId, actor });
      return { requiresPlayerInput: false, actionComplete: true, type: "SIMPLE_ACTION_COMPLETE", action: "Dash", message: "Dashed." };
    }
    if (action === "dodge") {
      await this.deps.actions.dodge(sessionId, { encounterId, actor });
      return { requiresPlayerInput: false, actionComplete: true, type: "SIMPLE_ACTION_COMPLETE", action: "Dodge", message: "Dodged." };
    }
    if (action === "disengage") {
      await this.deps.actions.disengage(sessionId, { encounterId, actor });
      return { requiresPlayerInput: false, actionComplete: true, type: "SIMPLE_ACTION_COMPLETE", action: "Disengage", message: "Disengaged." };
    }

    throw new ValidationError(`Unknown simple action: ${action}`);
  }

  /**
   * Handle the Help action - give an ally advantage on their next attack.
   */
  private async handleHelpAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    targetName: string,
    roster: LlmRoster,
    allCreatures: any[],
  ): Promise<ActionParseResult> {
    const actor = this.inferActorRef(actorId, roster);

    // Find the target (ally to help) by name
    const normalizedTarget = targetName.toLowerCase();
    const targetCreature = allCreatures.find((c) => c.name.toLowerCase() === normalizedTarget);

    if (!targetCreature) {
      throw new ValidationError(`Could not find target "${targetName}" for Help action`);
    }

    // Build target ref
    let targetRef: any;
    if (roster.characters.some((c) => c.id === targetCreature.id)) {
      targetRef = { type: "Character", characterId: targetCreature.id };
    } else if (roster.monsters.some((m) => m.id === targetCreature.id)) {
      targetRef = { type: "Monster", monsterId: targetCreature.id };
    } else if (roster.npcs.some((n) => n.id === targetCreature.id)) {
      targetRef = { type: "NPC", npcId: targetCreature.id };
    } else {
      throw new ValidationError(`Could not resolve target "${targetName}" in roster`);
    }

    await this.deps.actions.help(sessionId, { encounterId, actor, target: targetRef });

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Help",
      message: `Helped ${targetCreature.name}. Their next attack against a target within 5 feet of you has advantage.`,
    };
  }

  /**
   * Handle the Shove action - push or knock prone a target.
   */
  private async handleShoveAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    shoveInput: { target: string; shoveType: "push" | "prone" },
    roster: LlmRoster,
    allCreatures: any[],
  ): Promise<ActionParseResult> {
    const actor = this.inferActorRef(actorId, roster);

    // Find the target by name
    const normalizedTarget = shoveInput.target.toLowerCase();
    const targetCreature = allCreatures.find((c) => c.name.toLowerCase() === normalizedTarget);

    if (!targetCreature) {
      throw new ValidationError(`Could not find target "${shoveInput.target}" for Shove action`);
    }

    // Build target ref
    let targetRef: any;
    if (roster.characters.some((c) => c.id === targetCreature.id)) {
      targetRef = { type: "Character", characterId: targetCreature.id };
    } else if (roster.monsters.some((m) => m.id === targetCreature.id)) {
      targetRef = { type: "Monster", monsterId: targetCreature.id };
    } else if (roster.npcs.some((n) => n.id === targetCreature.id)) {
      targetRef = { type: "NPC", npcId: targetCreature.id };
    } else {
      throw new ValidationError(`Could not resolve target "${shoveInput.target}" in roster`);
    }

    const result = await this.deps.actions.shove(sessionId, {
      encounterId,
      actor,
      target: targetRef,
      shoveType: shoveInput.shoveType,
    });

    const shoveTypeLabel = shoveInput.shoveType === "prone" ? "knocked prone" : "pushed 5 feet";
    const successMsg = result.result.success
      ? `Shove succeeded! ${targetCreature.name} was ${shoveTypeLabel}.`
      : `Shove failed! ${targetCreature.name} resisted (${result.result.attackerRoll} vs ${result.result.targetRoll}).`;

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SHOVE_COMPLETE",
      action: "Shove",
      success: result.result.success,
      message: successMsg,
    };
  }

  /**
   * Handle the Cast Spell action - cast a spell (currently just marks action spent).
   */
  private async handleCastSpellAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    spellInput: { spellName: string; target?: string },
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = this.inferActorRef(actorId, roster);

    await this.deps.actions.castSpell(sessionId, {
      encounterId,
      actor,
      spellName: spellInput.spellName,
    });

    const targetMsg = spellInput.target ? ` at ${spellInput.target}` : "";
    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SPELL_CAST_COMPLETE",
      action: "CastSpell",
      message: `Cast ${spellInput.spellName}${targetMsg}.`,
    };
  }

  private async handleFlurryOfBlows(
    sessionId: string,
    encounterId: string,
    actorId: string,
    text: string,
    characters: any[],
    monsters: any[],
  ): Promise<ActionParseResult> {
    const actorChar = characters.find((c) => c.id === actorId);
    const actorSheet = (actorChar?.sheet ?? {}) as any;
    const actorLevel = ClassFeatureResolver.getLevel(actorSheet, actorChar?.level);
    const actorClassName = actorChar?.className ?? actorSheet?.className ?? "";

    if (!ClassFeatureResolver.isMonk(actorSheet, actorClassName) || actorLevel < 2) {
      throw new ValidationError("Flurry of Blows requires Monk level 2+");
    }

    // Find target
    let inferredTarget: string | null = null;
    for (const m of monsters) {
      if (text.toLowerCase().includes(m.name.toLowerCase())) {
        inferredTarget = m.id;
        break;
      }
    }

    if (!inferredTarget) {
      const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
      const actorCombatant = combatantStates.find((c: any) => c.combatantType === "Character" && c.characterId === actorId);
      if (!actorCombatant) throw new ValidationError("Actor not found in encounter");

      const actorPos = getPosition(actorCombatant.resources ?? {});
      if (!actorPos) throw new ValidationError("Actor has no position");

      const hostiles = combatantStates.filter((c: any) => c.combatantType === "Monster" && c.hpCurrent > 0);
      if (hostiles.length === 0) throw new ValidationError("No valid targets available");

      let nearest = hostiles[0];
      let minDist = 9999;
      for (const h of hostiles) {
        const hPos = getPosition(h.resources ?? {});
        if (!hPos) continue;
        const d = calculateDistance(actorPos, hPos);
        if (d < minDist) {
          minDist = d;
          nearest = h;
        }
      }
      inferredTarget = nearest.monsterId!;
    }

    const target = monsters.find((m) => m.id === inferredTarget);
    if (!target) throw new ValidationError("Target not found");

    // Validate reach
    const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = combatantStates.find((c: any) => c.combatantType === "Character" && c.characterId === actorId);
    const targetCombatant = combatantStates.find((c: any) => c.monsterId === inferredTarget);
    if (!actorCombatant || !targetCombatant) throw new ValidationError("Combatants not found");

    const actorPos = getPosition(actorCombatant.resources ?? {});
    const targetPos = getPosition(targetCombatant.resources ?? {});
    if (!actorPos || !targetPos) throw new ValidationError("Positions not set");

    const dist = calculateDistance(actorPos, targetPos);
    if (dist > 5 + 0.0001) {
      throw new ValidationError(`Target is out of reach (${Math.round(dist)}ft > 5ft)`);
    }

    const unarmedStats = ClassFeatureResolver.getUnarmedStrikeStats(actorSheet, actorClassName, actorLevel);

    const weaponSpec: WeaponSpec = {
      name: "Flurry of Blows (Unarmed Strike)",
      kind: "melee",
      attackBonus: unarmedStats.attackBonus,
      damage: { diceCount: 1, diceSides: unarmedStats.damageDie, modifier: unarmedStats.damageModifier },
      damageFormula: unarmedStats.damageFormula,
    };

    const pendingAction: AttackPendingAction = {
      type: "ATTACK",
      timestamp: new Date(),
      actorId,
      attacker: actorId,
      target: inferredTarget,
      targetId: inferredTarget,
      weaponSpec,
      bonusAction: "flurry-of-blows",
      flurryStrike: 1,
    };

    await this.deps.combatRepo.setPendingAction(encounterId, pendingAction);

    const narration = await this.generateNarration("attackRequest", {
      attackerName: actorId,
      targetName: target.name,
    });

    return {
      requiresPlayerInput: true,
      type: "REQUEST_ROLL",
      rollType: "attack",
      message: `Roll a d20 for attack against ${target.name} (no modifiers; server applies bonuses).`,
      narration,
      diceNeeded: "d20",
      pendingAction,
      actionComplete: false,
    };
  }

  private async handleAttackAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    text: string,
    command: any,
    characters: any[],
    monsters: any[],
    npcs: any[],
  ): Promise<ActionParseResult> {
    const targetId = command.target
      ? command.target.type === "Character"
        ? command.target.characterId
        : command.target.type === "Monster"
          ? command.target.monsterId
          : command.target.npcId
      : undefined;

    const target =
      monsters.find((m) => m.id === targetId) ||
      characters.find((c) => c.id === targetId) ||
      npcs.find((n) => n.id === targetId);

    if (!target) {
      throw new ValidationError("Target not found");
    }

    // Validate positions
    const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = combatantStates.find((c: any) => c.combatantType === "Character" && c.characterId === actorId);
    if (!actorCombatant) throw new ValidationError("Actor not found in encounter");

    const targetCombatant = combatantStates.find((c: any) => c.monsterId === targetId || c.characterId === targetId || c.npcId === targetId);
    if (!targetCombatant) throw new ValidationError("Target not found in encounter");

    const actorPos = getPosition(actorCombatant.resources ?? {});
    const targetPos = getPosition(targetCombatant.resources ?? {});
    if (!actorPos || !targetPos) throw new ValidationError("Actor and target must have positions set");

    const lowered = text.toLowerCase();
    const inferredKind: "melee" | "ranged" =
      /\b(bow|shortbow|longbow|shoot|arrow|ranged)\b/.test(lowered) ? "ranged" : "melee";

    if (inferredKind === "melee") {
      const actorResources = normalizeResources(actorCombatant.resources ?? {});
      const reach = typeof (actorResources as any).reach === "number" ? (actorResources as any).reach : 5;
      const dist = calculateDistance(actorPos, targetPos);
      if (dist > reach + 0.0001) {
        throw new ValidationError(`Target is out of reach (${Math.round(dist)}ft > ${Math.round(reach)}ft)`);
      }
    }

    // Compute weapon spec
    const actorChar = characters.find((c) => c.id === actorId);
    const actorSheet = (actorChar?.sheet ?? {}) as any;
    const actorLevel = ClassFeatureResolver.getLevel(actorSheet, actorChar?.level);
    const actorClassName = actorChar?.className ?? actorSheet?.className ?? "";

    const isUnarmed = /\b(unarmed|fist|punch|kick)\b/.test(lowered);
    const unarmedStats = ClassFeatureResolver.getUnarmedStrikeStats(actorSheet, actorClassName, actorLevel);

    const spec = command.spec as any;
    const specDamage = spec?.damage;

    const diceCount = typeof specDamage?.diceCount === "number" ? specDamage.diceCount : 1;
    const diceSidesRaw = typeof specDamage?.diceSides === "number" ? specDamage.diceSides : 8;
    const modifierRaw = typeof specDamage?.modifier === "number" ? specDamage.modifier : unarmedStats.damageModifier;
    const attackBonusRaw = typeof spec?.attackBonus === "number" ? spec.attackBonus : unarmedStats.attackBonus;

    const finalDiceSides = isUnarmed ? unarmedStats.damageDie : diceSidesRaw;
    const finalModifier = isUnarmed ? unarmedStats.damageModifier : modifierRaw;
    const finalAttackBonus = isUnarmed ? unarmedStats.attackBonus : attackBonusRaw;

    const modText = finalModifier === 0 ? "" : finalModifier > 0 ? `+${finalModifier}` : `${finalModifier}`;
    const damageFormula = `${diceCount}d${finalDiceSides}${modText}`;

    const weaponSpec: WeaponSpec = {
      name: isUnarmed ? "Unarmed Strike" : "Attack",
      kind: inferredKind,
      attackBonus: finalAttackBonus,
      damage: { diceCount, diceSides: finalDiceSides, modifier: finalModifier },
      damageFormula,
    };

    const pendingAction: AttackPendingAction = {
      type: "ATTACK",
      timestamp: new Date(),
      actorId,
      attacker: actorId,
      target: targetId,
      targetId,
      weaponSpec,
    };

    await this.deps.combatRepo.setPendingAction(encounterId, pendingAction);

    const narration = await this.generateNarration("attackRequest", {
      attackerName: actorId,
      targetName: (target as any).name,
    });

    return {
      requiresPlayerInput: true,
      type: "REQUEST_ROLL",
      rollType: "attack",
      message: `Roll a d20 for attack against ${(target as any).name} (no modifiers; server applies bonuses).`,
      narration,
      diceNeeded: "d20",
      pendingAction,
      actionComplete: false,
    };
  }

  // ----- Text parsing helpers -----

  private tryParseMoveText(input: string): { x: number; y: number } | null {
    const normalized = input.trim().toLowerCase();
    if (!normalized.startsWith("move")) return null;

    const match = normalized.match(/move\s*(?:to\s*)?\(?\s*(-?\d+)\s*[ ,]\s*(-?\d+)\s*\)?/);
    if (!match) return null;
    const x = Number.parseInt(match[1]!, 10);
    const y = Number.parseInt(match[2]!, 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  private tryParseSimpleActionText(input: string): "dash" | "dodge" | "disengage" | null {
    const normalized = input.trim().toLowerCase();
    if (/\b(dash)\b/.test(normalized)) return "dash";
    if (/\b(dodge)\b/.test(normalized)) return "dodge";
    if (/\b(disengage)\b/.test(normalized)) return "disengage";
    return null;
  }

  /**
   * Parse "help <target>" command.
   * Returns the target name if found, null otherwise.
   */
  private tryParseHelpText(input: string): string | null {
    const normalized = input.trim().toLowerCase();
    // Match "help <target>" or "help attack <target>"
    const match = normalized.match(/\bhelp\s+(?:attack\s+)?(.+)/i);
    if (!match) return null;
    return match[1]!.trim();
  }

  /**
   * Parse "shove <target>" command.
   * Returns { target, shoveType } if found, null otherwise.
   */
  private tryParseShoveText(input: string): { target: string; shoveType: "push" | "prone" } | null {
    const normalized = input.trim().toLowerCase();
    // Match "shove <target>" or "shove <target> prone" or "push <target>"
    const shoveMatch = normalized.match(/\bshove\s+(.+?)(?:\s+(prone|push))?\s*$/i);
    const pushMatch = normalized.match(/\bpush\s+(.+)/i);
    
    if (shoveMatch) {
      const target = shoveMatch[1]!.replace(/\s*(prone|push)\s*$/i, "").trim();
      const shoveType = shoveMatch[2]?.toLowerCase() === "prone" ? "prone" : "push";
      return { target, shoveType };
    }
    if (pushMatch) {
      return { target: pushMatch[1]!.trim(), shoveType: "push" };
    }
    return null;
  }

  /**
   * Parse "cast <spell>" or "cast <spell> at/on <target>" command.
   * Returns { spellName, target? } if found, null otherwise.
   */
  private tryParseCastSpellText(input: string): { spellName: string; target?: string } | null {
    const normalized = input.trim();
    // Match "cast <spell>" or "cast <spell> at/on <target>"
    const match = normalized.match(/\bcast\s+([\w\s]+?)(?:\s+(?:at|on|against)\s+(.+))?\s*$/i);
    if (!match) return null;
    const spellName = match[1]!.trim();
    const target = match[2]?.trim();
    if (!spellName) return null;
    return { spellName, target };
  }

  private tryParseBonusActionText(input: string): "flurry-of-blows" | "patient-defense" | "step-of-the-wind" | null {
    const normalized = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (/flurry|flurryofblows/.test(normalized)) return "flurry-of-blows";
    if (/patientdefense/.test(normalized)) return "patient-defense";
    if (/stepofthewind/.test(normalized)) return "step-of-the-wind";
    return null;
  }

  private inferActorRef(id: string, roster: LlmRoster) {
    if (roster.characters.some((c) => c.id === id)) return { type: "Character" as const, characterId: id };
    if (roster.monsters.some((m) => m.id === id)) return { type: "Monster" as const, monsterId: id };
    if (roster.npcs.some((n) => n.id === id)) return { type: "NPC" as const, npcId: id };
    throw new ValidationError(`actorId not found in roster: ${id}`);
  }

  // ----- Helper utilities -----

  private parseDamageModifier(formula: unknown, explicit?: number): number {
    if (typeof explicit === "number") return explicit;
    if (typeof formula !== "string") return 0;
    const m = formula.match(/([+-])\s*(\d+)\b/);
    if (!m) return 0;
    const sign = m[1] === "-" ? -1 : 1;
    const n = Number(m[2]);
    return Number.isFinite(n) ? sign * n : 0;
  }

  private async markActionSpent(encounterId: string, actorId: string) {
    const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = combatantStates.find((c: any) => c.characterId === actorId);
    if (actorCombatant) {
      const resources = (actorCombatant.resources as any) ?? {};
      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: { ...resources, actionSpent: true },
      });
    }
  }

  private async emitAttackEvents(
    sessionId: string,
    encounterId: string,
    attackerId: string,
    targetId: string,
    characters: any[],
    monsters: any[],
    hit: boolean,
    rollValue: number,
    total: number,
  ) {
    if (!this.deps.events) return;

    const attackerRef = { type: "Character" as const, characterId: attackerId };
    const targetRef = monsters.some((m) => m.id === targetId)
      ? ({ type: "Monster" as const, monsterId: targetId } as const)
      : characters.some((c) => c.id === targetId)
        ? ({ type: "Character" as const, characterId: targetId } as const)
        : ({ type: "NPC" as const, npcId: targetId } as const);

    const attackerName = characters.find((c) => c.id === attackerId)?.name ?? "Player";
    const targetName = monsters.find((m) => m.id === targetId)?.name ?? characters.find((c) => c.id === targetId)?.name ?? "Target";

    await this.deps.events.append(sessionId, {
      id: nanoid(),
      type: "AttackResolved",
      payload: {
        encounterId,
        attacker: attackerRef,
        target: targetRef,
        result: {
          hit,
          critical: rollValue === 20,
          attack: { d20: rollValue, total },
          damage: { applied: 0, roll: { total: 0, rolls: [] } },
        },
      },
    });

    await this.deps.events.append(sessionId, {
      id: nanoid(),
      type: "NarrativeText",
      payload: {
        encounterId,
        actor: attackerRef,
        text: hit
          ? `${attackerName} strikes ${targetName}!`
          : `${attackerName} swings at ${targetName} but misses.`,
      },
    });
  }

  private async emitDamageEvents(
    sessionId: string,
    encounterId: string,
    attackerId: string,
    targetId: string,
    characters: any[],
    monsters: any[],
    totalDamage: number,
    hpAfter: number,
  ) {
    if (!this.deps.events) return;

    const attackerRef = { type: "Character" as const, characterId: attackerId };
    const targetRef = monsters.some((m) => m.id === targetId)
      ? ({ type: "Monster" as const, monsterId: targetId } as const)
      : characters.some((c) => c.id === targetId)
        ? ({ type: "Character" as const, characterId: targetId } as const)
        : ({ type: "NPC" as const, npcId: targetId } as const);

    const attackerName = characters.find((c) => c.id === attackerId)?.name ?? "Player";
    const targetName = monsters.find((m) => m.id === targetId)?.name ?? characters.find((c) => c.id === targetId)?.name ?? "Target";

    await this.deps.events.append(sessionId, {
      id: nanoid(),
      type: "DamageApplied",
      payload: {
        encounterId,
        target: targetRef,
        amount: totalDamage,
        hpCurrent: hpAfter,
      },
    });

    await this.deps.events.append(sessionId, {
      id: nanoid(),
      type: "NarrativeText",
      payload: {
        encounterId,
        actor: attackerRef,
        text:
          hpAfter === 0
            ? `${attackerName} deals ${totalDamage} damage to ${targetName}. ${targetName} falls!`
            : `${attackerName} deals ${totalDamage} damage to ${targetName}.`,
      },
    });
  }
}
