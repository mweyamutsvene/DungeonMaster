/**
 * ActionDispatcher – routes parsed combat actions to the correct handler.
 *
 * Extracted from TabletopCombatService to keep action routing and execution
 * logic separate from the public API facade.
 */

import { ValidationError } from "../../../errors.js";
import { calculateDistance, calculateLongJumpDistance, calculateHighJumpDistance, computeJumpLandingPosition } from "../../../../domain/rules/movement.js";
import { findPath, findAdjacentPosition } from "../../../../domain/rules/pathfinding.js";
import type { CombatMap } from "../../../../domain/rules/combat-map.js";
import { getCellAt, getCoverLevel, getCoverACBonus } from "../../../../domain/rules/combat-map.js";
import { abilityCheck } from "../../../../domain/rules/ability-checks.js";
import {
  normalizeConditions,
  addCondition,
  createCondition,
  readConditionNames,
  type Condition,
} from "../../../../domain/entities/combat/conditions.js";
import {
  getPosition,
  normalizeResources,
  hasBonusActionAvailable,
  useBonusAction,
  canMakeAttack,
  setAttacksAllowed,
  getAttacksAllowedThisTurn,
  spendResourceFromPool,
  getResourcePools,
  readBoolean,
  getActiveEffects,
  setActiveEffects,
  removeActiveEffectById,
  getEffectiveSpeed,
  isConditionImmuneByEffects,
  getDrawnWeapons,
  addDrawnWeapon,
  getInventory,
} from "../helpers/resource-utils.js";
import {
  calculateBonusFromEffects,
  hasAdvantageFromEffects,
  hasDisadvantageFromEffects,
} from "../../../../domain/entities/combat/effects.js";
import { ClassFeatureResolver } from "../../../../domain/entities/classes/class-feature-resolver.js";
import { tryMatchClassAction, matchAttackEnhancements } from "../../../../domain/entities/classes/combat-text-profile.js";
import { getAllCombatTextProfiles } from "../../../../domain/entities/classes/registry.js";
import {
  buildGameCommandSchemaHint,
  parseGameCommand,
  type GameCommand,
  type AttackCommand,
  type LlmRoster,
  type CombatantRef,
} from "../../../commands/game-command.js";
import type {
  SessionCharacterRecord,
  SessionMonsterRecord,
  SessionNPCRecord,
  CombatantStateRecord,
} from "../../../types.js";

import {
  tryParseMoveText,
  tryParseMoveTowardText,
  tryParseSimpleActionText,
  tryParseJumpText,
  tryParseHideText,
  tryParseOffhandAttackText,
  tryParseSearchText,
  tryParseHelpText,
  tryParseShoveText,
  tryParseGrappleText,
  tryParseEscapeGrappleText,
  tryParseCastSpellText,
  tryParsePickupText,
  tryParseDropText,
  tryParseDrawWeaponText,
  tryParseSheatheWeaponText,
  tryParseUseItemText,
  tryParseAttackText,
  deriveRollModeFromConditions,
  inferActorRef,
  findAllCombatantsByName,
  getActorNameFromRoster,
  getNameFromCombatantRef,
} from "./combat-text-parser.js";

import { findCombatantStateByRef, getPositionByRef } from "../helpers/combatant-ref.js";
import { syncEntityPosition } from "../helpers/sync-map-entity.js";
import { resolveZoneDamageForPath } from "../helpers/zone-damage-resolver.js";
import { syncAuraZones } from "../helpers/aura-sync.js";

import { TabletopEventEmitter } from "./tabletop-event-emitter.js";
import { buildPathNarration } from "./path-narrator.js";
import { SpellActionHandler } from "./spell-action-handler.js";
import { SavingThrowResolver } from "./saving-throw-resolver.js";
import { loadRoster } from "./roll-state-machine.js";
import { GrappleHandlers } from "./grapple-handlers.js";
import { InteractionHandlers } from "./interaction-handlers.js";
import { SocialHandlers } from "./social-handlers.js";
import { resolveWeaponMastery } from "../../../../domain/rules/weapon-mastery.js";
import { lookupMagicItemById } from "../../../../domain/entities/items/magic-item-catalog.js";
import { getWeaponMagicBonuses } from "../../../../domain/entities/items/inventory.js";
import type { ActionParserEntry, DispatchContext } from "./action-parser-chain.js";

import type {
  TabletopCombatServiceDeps,
  ActionParseResult,
  AttackPendingAction,
  WeaponSpec,
} from "./tabletop-types.js";

export class ActionDispatcher {
  private readonly grappleHandlers: GrappleHandlers;
  private readonly interactionHandlers: InteractionHandlers;
  private readonly socialHandlers: SocialHandlers;
  private readonly parserChain: ActionParserEntry<any>[];

  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly eventEmitter: TabletopEventEmitter,
    private readonly spellHandler: SpellActionHandler,
    private readonly debugLogsEnabled: boolean,
  ) {
    this.grappleHandlers = new GrappleHandlers(deps, eventEmitter, debugLogsEnabled);
    this.interactionHandlers = new InteractionHandlers(deps, eventEmitter, debugLogsEnabled);
    this.socialHandlers = new SocialHandlers(deps, eventEmitter, debugLogsEnabled);
    this.parserChain = this.buildParserChain();
  }

  // ----------------------------------------------------------------
  // Public entry point – replaces TabletopCombatService.parseCombatAction body
  // ----------------------------------------------------------------

  async dispatch(
    sessionId: string,
    text: string,
    actorId: string,
    encounterId: string,
  ): Promise<ActionParseResult> {
    const { characters, monsters, npcs, roster } = await loadRoster(this.deps, sessionId);
    const ctx: DispatchContext = { sessionId, encounterId, actorId, text, characters, monsters, npcs, roster };

    // Try each parser in priority order; first match wins.
    for (const parser of this.parserChain) {
      const parsed = parser.tryParse(text, roster);
      if (parsed !== null) {
        console.log(`[ActionDispatcher] Direct parse: ${parser.id}`);
        return parser.handle(parsed, ctx);
      }
    }

    // Fall back to LLM parsing
    if (!this.deps.intentParser) {
      throw new ValidationError("LLM intent parser is not configured");
    }

    // Enrich roster with distance data so LLM can disambiguate same-named targets
    const enrichedRoster = await this.enrichRosterWithDistances(encounterId, actorId, roster);

    console.log(`[ActionDispatcher] No direct parse match → LLM intent for: "${text}"`);
    const intent = await this.deps.intentParser.parseIntent({
      text,
      schemaHint: buildGameCommandSchemaHint(enrichedRoster),
    });

    let command: GameCommand | undefined;
    try {
      command = parseGameCommand(intent);
    } catch (err) {
      throw new ValidationError(`Could not parse combat action: ${(err as Error).message}`);
    }

    console.log(`[ActionDispatcher] LLM intent → ${command.kind}`, command.kind === "attack"
      ? { target: command.target?.type, spec: (command.spec as Record<string, unknown>)?.name ?? "(none)" }
      : command.kind === "move"
        ? { destination: command.destination }
        : {});

    if (command.kind === "move") {
      return this.handleMoveAction(sessionId, encounterId, actorId, command.destination, roster);
    }

    if (command.kind === "moveToward") {
      return this.handleMoveTowardAction(sessionId, encounterId, actorId, command.target, command.desiredRange, roster);
    }

    if (command.kind === "attack") {
      return this.handleAttackAction(sessionId, encounterId, actorId, text, command, characters, monsters, npcs);
    }

    // Query commands should be handled by the /llm/intent or /combat/query endpoints, not here
    if (command.kind === "query") {
      throw new ValidationError(
        `Questions should be asked separately from combat actions. ` +
        `If you meant to attack, try: "attack the <target>"`,
      );
    }

    throw new ValidationError(`Action type ${command.kind} not yet implemented`);
  }

  // ----------------------------------------------------------------
  // Parser chain – ordered list of text parsers tried by dispatch()
  // ----------------------------------------------------------------

  private buildParserChain(): ActionParserEntry<any>[] {
    const profiles = getAllCombatTextProfiles();

    return [
      // 1. Move to coordinates
      {
        id: "move",
        tryParse: (text) => tryParseMoveText(text),
        handle: (parsed, ctx) =>
          this.handleMoveAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed, ctx.roster),
      },

      // 2. Move toward creature
      {
        id: "moveToward",
        tryParse: (text, roster) => tryParseMoveTowardText(text, roster),
        handle: (parsed, ctx) =>
          this.handleMoveTowardAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.target, parsed.desiredRange, ctx.roster),
      },

      // 3. Jump
      {
        id: "jump",
        tryParse: (text, roster) => tryParseJumpText(text, roster),
        handle: (parsed, ctx) =>
          this.handleJumpAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed, ctx.characters, ctx.monsters, ctx.roster),
      },

      // 4. Simple actions (dash/dodge/disengage/ready)
      {
        id: "simpleAction",
        tryParse: (text) => tryParseSimpleActionText(text),
        handle: (parsed, ctx) => {
          if (parsed === "ready") {
            return this.handleReadyAction(ctx.sessionId, ctx.encounterId, ctx.actorId, ctx.text, ctx.roster);
          }
          return this.handleSimpleAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed, ctx.roster);
        },
      },

      // 5. Profile-driven class action matching
      {
        id: "classAction",
        tryParse: (text) => tryMatchClassAction(text, profiles),
        handle: (parsed, ctx) => {
          if (parsed.category === "classAction") {
            return this.handleClassAbility(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.abilityId, ctx.characters, ctx.roster);
          }
          return this.handleBonusAbility(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.abilityId, ctx.text, ctx.characters, ctx.monsters, ctx.npcs, ctx.roster);
        },
      },

      // 6. Hide
      {
        id: "hide",
        tryParse: (text) => tryParseHideText(text) ? true : null,
        handle: (_parsed, ctx) =>
          this.handleHideAction(ctx.sessionId, ctx.encounterId, ctx.actorId, ctx.characters, ctx.roster),
      },

      // 7. Search
      {
        id: "search",
        tryParse: (text) => tryParseSearchText(text) ? true : null,
        handle: (_parsed, ctx) =>
          this.handleSearchAction(ctx.sessionId, ctx.encounterId, ctx.actorId, ctx.roster),
      },

      // 8. Off-hand attack (with TWF validation + Nick mastery)
      {
        id: "offhand",
        tryParse: (text) => tryParseOffhandAttackText(text) ? true : null,
        handle: async (_parsed, ctx) => {
          let skipBonusCost = false;
          const actorChar = ctx.characters.find((c) => c.id === ctx.actorId);
          if (actorChar) {
            const sheet = (actorChar?.sheet ?? {}) as any;
            const className = actorChar?.className ?? sheet?.className ?? "";
            const attacks: Array<{ name: string; properties?: string[] }> = sheet?.attacks ?? [];

            // TWF validation: both weapons must have the Light property (D&D 5e 2024)
            const mainHand = attacks[0];
            const offHand = attacks.length > 1 ? attacks[1] : undefined;
            if (!offHand) {
              throw new ValidationError("Two-weapon fighting requires wielding two weapons");
            }
            const mainIsLight = mainHand?.properties?.some((p: string) => p.toLowerCase() === "light") ?? false;
            const offIsLight = offHand?.properties?.some((p: string) => p.toLowerCase() === "light") ?? false;
            if (!mainIsLight || !offIsLight) {
              throw new ValidationError("Two-weapon fighting requires both weapons to have the Light property");
            }
            if (offHand) {
              const offhandMastery = resolveWeaponMastery(offHand.name, sheet, className);
              if (offhandMastery === "nick") {
                const combatants = await this.deps.combatRepo.listCombatants(ctx.encounterId);
                const actorCombatant = combatants.find(
                  (c: any) => c.combatantType === "Character" && c.characterId === ctx.actorId,
                );
                const nickRes = actorCombatant ? normalizeResources(actorCombatant.resources) : {} as any;
                if (!nickRes.nickUsedThisTurn) {
                  skipBonusCost = true;
                }
              }
            }
          }
          return this.handleBonusAbility(ctx.sessionId, ctx.encounterId, ctx.actorId, "base:bonus:offhand-attack", ctx.text, ctx.characters, ctx.monsters, ctx.npcs, ctx.roster, skipBonusCost);
        },
      },

      // 9. Help
      {
        id: "help",
        tryParse: (text) => tryParseHelpText(text),
        handle: (parsed, ctx) =>
          this.handleHelpAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed, ctx.roster),
      },

      // 10. Shove
      {
        id: "shove",
        tryParse: (text) => tryParseShoveText(text),
        handle: (parsed, ctx) =>
          this.handleShoveAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed, ctx.roster),
      },

      // 11. Escape Grapple
      {
        id: "escapeGrapple",
        tryParse: (text) => tryParseEscapeGrappleText(text),
        handle: (_parsed, ctx) =>
          this.handleEscapeGrappleAction(ctx.sessionId, ctx.encounterId, ctx.actorId, ctx.roster),
      },

      // 12. Grapple
      {
        id: "grapple",
        tryParse: (text) => tryParseGrappleText(text),
        handle: (parsed, ctx) =>
          this.handleGrappleAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed, ctx.roster),
      },

      // 13. Cast Spell
      {
        id: "castSpell",
        tryParse: (text) => tryParseCastSpellText(text),
        handle: (parsed, ctx) =>
          this.spellHandler.handleCastSpell(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed, ctx.characters, ctx.roster),
      },

      // 14. Pickup item
      {
        id: "pickup",
        tryParse: (text) => tryParsePickupText(text),
        handle: (parsed, ctx) =>
          this.handlePickupAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.itemName, ctx.roster),
      },

      // 15. Drop item
      {
        id: "drop",
        tryParse: (text) => tryParseDropText(text),
        handle: (parsed, ctx) =>
          this.handleDropAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.itemName, ctx.characters, ctx.monsters, ctx.npcs, ctx.roster),
      },

      // 16. Draw weapon
      {
        id: "drawWeapon",
        tryParse: (text) => tryParseDrawWeaponText(text),
        handle: (parsed, ctx) =>
          this.handleDrawWeaponAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.weaponName, ctx.characters, ctx.monsters, ctx.npcs, ctx.roster),
      },

      // 17. Sheathe weapon
      {
        id: "sheatheWeapon",
        tryParse: (text) => tryParseSheatheWeaponText(text),
        handle: (parsed, ctx) =>
          this.handleSheatheWeaponAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.weaponName, ctx.roster),
      },

      // 18. Use item
      {
        id: "useItem",
        tryParse: (text) => tryParseUseItemText(text),
        handle: (parsed, ctx) =>
          this.handleUseItemAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.itemName, ctx.roster),
      },

      // 19. Attack (last because it's the broadest text match)
      {
        id: "attack",
        tryParse: (text, roster) => tryParseAttackText(text, roster),
        handle: async (parsed, ctx) => {
          const targetRef = await this.resolveAttackTarget(
            ctx.encounterId, ctx.actorId, ctx.roster, parsed.targetName, parsed.nearest,
          );
          const command = {
            kind: "attack" as const,
            attacker: inferActorRef(ctx.actorId, ctx.roster),
            target: targetRef,
          };
          return this.handleAttackAction(ctx.sessionId, ctx.encounterId, ctx.actorId, ctx.text, command, ctx.characters, ctx.monsters, ctx.npcs);
        },
      },
    ];
  }

  // ----------------------------------------------------------------
  // Private action handlers
  // ----------------------------------------------------------------

  private async handleMoveAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    destination: { x: number; y: number },
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actorRef = inferActorRef(actorId, roster);

    const moveInit = await this.deps.twoPhaseActions.initiateMove(sessionId, {
      encounterId,
      actor: actorRef,
      destination,
    });

    if (moveInit.status === "aborted_by_trigger") {
      const triggerMsg = moveInit.voluntaryMoveTriggerMessages?.join(" ") ?? "Movement trigger damage!";
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "move",
        message: `${triggerMsg} ${actorId} is knocked out and cannot move.`,
      };
    }

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

      const movedFeet = currentPos ? calculateDistance(currentPos, destination) : null;
      // Calculate remaining movement after this move
      const currentRemaining = typeof resources.movementRemaining === "number"
        ? resources.movementRemaining
        : getEffectiveSpeed(actorState.resources);
      const newMovementRemaining = Math.max(0, currentRemaining - (movedFeet ?? 0));

      await this.deps.combatRepo.updateCombatantState(actorState.id, {
        resources: {
          ...resources,
          position: destination,
          movementSpent: newMovementRemaining <= 0,
          movementRemaining: newMovementRemaining,
          lastMovePath: currentPos ? {
            cells: [
              { x: currentPos.x, y: currentPos.y, terrain: "normal", stepCostFeet: 0, cumulativeCostFeet: 0 },
              { x: destination.x, y: destination.y, terrain: "normal", stepCostFeet: movedFeet ?? 0, cumulativeCostFeet: movedFeet ?? 0 },
            ],
            costFeet: movedFeet ?? 0,
          } : undefined,
        } as any,
      });

      // Keep CombatMap entities[] in sync with the position update
      await syncEntityPosition(this.deps.combatRepo, encounterId, actorState.id, destination);

      // Sync aura zones for this combatant
      await syncAuraZones(this.deps.combatRepo, encounterId, actorId, destination);

      // --- Zone damage during movement ---
      const encounters = await this.deps.combatRepo.listEncountersBySession(sessionId);
      const encounter = encounters.find((e: any) => e.status === "Active") ?? encounters[0];
      let zoneDamageNote = "";
      if (encounter && currentPos) {
        const combatMap = encounter.mapData as unknown as CombatMap | undefined;
        if (combatMap && (combatMap.zones?.length ?? 0) > 0) {
          const actorEntityId = actorState.characterId ?? actorState.monsterId ?? actorState.npcId ?? actorState.id;
          const actorIsPC = actorState.combatantType === "Character" || actorState.combatantType === "NPC";
          const zoneDmgResult = await resolveZoneDamageForPath(
            [destination],
            currentPos,
            actorState,
            combatMap,
            (srcId: string) => {
              const src = combatantStates.find((c: any) => (c.characterId ?? c.monsterId ?? c.npcId) === srcId);
              const srcIsPC = src ? (src.combatantType === "Character" || src.combatantType === "NPC") : false;
              return actorIsPC === srcIsPC;
            },
            { damageResistances: [], damageImmunities: [], damageVulnerabilities: [] },
            { combatRepo: this.deps.combatRepo, debugLog: this.debugLogsEnabled },
          );
          if (zoneDmgResult.totalDamage > 0) {
            zoneDamageNote = ` Zone damage: ${zoneDmgResult.totalDamage} HP.`;
          }
        }
      }

      const actorName = getActorNameFromRoster(actorId, roster);
      const narration = await this.eventEmitter.generateNarration("movementComplete", {
        actorName,
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
        message: `Moved to (${destination.x}, ${destination.y})${movedFeet !== null ? ` (${Math.round(movedFeet)}ft)` : ""}.${zoneDamageNote}`,
        narration,
        // Synthesize a simple 2-cell path for straight-line moves (start → end)
        pathCells: currentPos ? [
          { x: currentPos.x, y: currentPos.y, terrain: "normal" as const, stepCostFeet: 0, cumulativeCostFeet: 0 },
          { x: destination.x, y: destination.y, terrain: "normal" as const, stepCostFeet: movedFeet ?? 0, cumulativeCostFeet: movedFeet ?? 0 },
        ] : undefined,
        pathCostFeet: movedFeet ?? undefined,
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

  /**
   * Handle "move toward <creature>" — resolve target position, A* pathfind,
   * and delegate to the standard handleMoveAction with the computed destination.
   */
  private async handleMoveTowardAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    targetRef: CombatantRef,
    desiredRange: number | undefined,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const range = desiredRange ?? 5;
    const actorRef = inferActorRef(actorId, roster);

    // Resolve positions
    const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
    const actorPos = getPositionByRef(combatantStates, actorRef);
    const targetPos = getPositionByRef(combatantStates, targetRef);

    if (!actorPos) throw new ValidationError("Actor has no position on the map.");
    if (!targetPos) throw new ValidationError("Target has no position on the map.");

    // Already in range?
    if (calculateDistance(actorPos, targetPos) <= range) {
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "MOVE_COMPLETE",
        movedTo: actorPos,
        movedFeet: 0,
        message: `Already within ${range}ft of the target.`,
      };
    }

    // Get encounter map
    const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
    const map = encounter?.mapData as unknown as CombatMap | undefined;

    if (!map || !map.cells || map.cells.length === 0) {
      // No map data — fall back to direct move toward target position minus desired range
      const dx = targetPos.x - actorPos.x;
      const dy = targetPos.y - actorPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ratio = Math.max(0, (dist - range)) / dist;
      const destination = {
        x: Math.round((actorPos.x + dx * ratio) / 5) * 5,
        y: Math.round((actorPos.y + dy * ratio) / 5) * 5,
      };
      return this.handleMoveAction(sessionId, encounterId, actorId, destination, roster);
    }

    // Find the best adjacent cell within desired range of the target
    const occupiedPositions = combatantStates
      .filter(c => {
        const p = getPosition(c.resources ?? {});
        return p && !(c.characterId === (actorRef as any).characterId && actorRef.type === "Character")
                   && !(c.monsterId === (actorRef as any).monsterId && actorRef.type === "Monster")
                   && !(c.npcId === (actorRef as any).npcId && actorRef.type === "NPC");
      })
      .map(c => getPosition(c.resources ?? {})!)
      .filter(Boolean);

    const destination = findAdjacentPosition(map, targetPos, actorPos, range);
    if (!destination) {
      throw new ValidationError(`Cannot find a passable position within ${range}ft of the target.`);
    }

    // Get actor's remaining movement
    const actorState = findCombatantStateByRef(combatantStates, actorRef);
    const resources = (actorState?.resources as any) ?? {};
    const movementRemaining = typeof resources.movementRemaining === "number"
      ? resources.movementRemaining
      : getEffectiveSpeed(actorState?.resources);

    // A* pathfinding
    const pathResult = findPath(map, actorPos, destination, {
      maxCostFeet: movementRemaining,
      avoidHazards: true,
      occupiedPositions,
    });

    // Determine actual destination from pathfinding
    let finalDestination = destination;
    let pathCells = pathResult.path;
    let pathCellsDetailed = pathResult.cells;
    const isPartial = pathResult.blocked && !!pathResult.reachablePosition;

    if (pathResult.blocked && pathResult.reachablePosition) {
      // Can't reach destination — move as far as possible
      finalDestination = pathResult.reachablePosition;
      // Trim path to only include cells up to reachable position
      const reachableIdx = pathCells.findIndex(
        p => p.x === pathResult.reachablePosition!.x && p.y === pathResult.reachablePosition!.y,
      );
      if (reachableIdx >= 0) {
        pathCells = pathCells.slice(0, reachableIdx + 1);
        pathCellsDetailed = pathCellsDetailed.slice(0, reachableIdx + 1);
      }
    } else if (pathResult.blocked && !pathResult.reachablePosition) {
      throw new ValidationError(
        `No path to the target. ${pathResult.narrationHints.join(" ")}`,
      );
    }

    // Build narration using the centralized path narrator
    const actorName = getActorNameFromRoster(actorId, roster);
    const targetName = getNameFromCombatantRef(targetRef, roster);
    const pathNarration = buildPathNarration({
      actorName,
      targetName,
      pathCells,
      pathCostFeet: pathResult.totalCostFeet,
      desiredRange: range,
      narrationHints: pathResult.narrationHints,
      partial: isPartial,
      startPosition: actorPos,
      endPosition: finalDestination,
    });

    // Delegate to initiateMove with path data for accurate OA detection and cost
    const actorRefForMove = inferActorRef(actorId, roster);
    const moveInit = await this.deps.twoPhaseActions.initiateMove(sessionId, {
      encounterId,
      actor: actorRefForMove,
      destination: finalDestination,
      pathCells,
      pathCostFeet: pathResult.totalCostFeet,
      pathNarrationHints: pathResult.narrationHints,
    });

    if (moveInit.status === "aborted_by_trigger") {
      const triggerMsg = moveInit.voluntaryMoveTriggerMessages?.join(" ") ?? "Movement trigger damage!";
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "move_towards",
        message: `${triggerMsg} ${actorId} is knocked out and cannot move.`,
      };
    }

    if (moveInit.status === "no_reactions") {
      // Update position (same logic as handleMoveAction)
      const freshCombatants = await this.deps.combatRepo.listCombatants(encounterId);
      const freshActor = freshCombatants.find((c: any) => {
        if (actorRefForMove.type === "Character") return c.characterId === actorRefForMove.characterId;
        if (actorRefForMove.type === "Monster") return c.monsterId === actorRefForMove.monsterId;
        return c.npcId === actorRefForMove.npcId;
      });

      if (!freshActor) throw new ValidationError("Actor not found in encounter");

      const res = (freshActor.resources as any) ?? {};
      const curRemaining = typeof res.movementRemaining === "number"
        ? res.movementRemaining
        : (typeof res.speed === "number" ? res.speed : 30);
      const newRemaining = Math.max(0, curRemaining - pathResult.totalCostFeet);

      await this.deps.combatRepo.updateCombatantState(freshActor.id, {
        resources: {
          ...res,
          position: finalDestination,
          movementSpent: newRemaining <= 0,
          movementRemaining: newRemaining,
          lastMovePath: {
            cells: pathCellsDetailed,
            costFeet: pathResult.totalCostFeet,
          },
        } as any,
      });

      // Keep CombatMap entities[] in sync with the position update
      await syncEntityPosition(this.deps.combatRepo, encounterId, freshActor.id, finalDestination);

      const actorName_ = getActorNameFromRoster(actorId, roster);
      const narration = await this.eventEmitter.generateNarration("movementComplete", {
        actorName: actorName_,
        from: actorPos,
        to: finalDestination,
        distance: pathResult.totalCostFeet,
      });

      // Use buildPathNarration output as the primary narration, enriched with LLM narration
      const fullNarration = narration
        ? `${narration} ${pathNarration}`.trim()
        : pathNarration;

      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "MOVE_COMPLETE",
        movedTo: finalDestination,
        movedFeet: pathResult.totalCostFeet,
        opportunityAttacks: moveInit.opportunityAttacks,
        message: `Moved to (${finalDestination.x}, ${finalDestination.y}) (${Math.round(pathResult.totalCostFeet)}ft). ${pathNarration}`.trim(),
        narration: fullNarration,
        pathCells: pathCellsDetailed,
        pathCostFeet: pathResult.totalCostFeet,
        pathfinding: {
          totalCostFeet: pathResult.totalCostFeet,
          terrainEncountered: pathResult.terrainEncountered,
          narrationHints: pathResult.narrationHints,
          wasBlocked: pathResult.blocked,
        },
      };
    }

    return {
      requiresPlayerInput: false,
      actionComplete: false,
      type: "REACTION_CHECK",
      pendingActionId: moveInit.pendingActionId,
      opportunityAttacks: moveInit.opportunityAttacks,
      message: `Opportunity attacks possible. Resolve reactions, then complete the move. ${pathNarration}`.trim(),
    };
  }

  private async handleSimpleAction(
    _sessionId: string,
    encounterId: string,
    actorId: string,
    action: "dash" | "dodge" | "disengage" | "ready",
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    return this.socialHandlers.handleSimpleAction(_sessionId, encounterId, actorId, action, roster);
  }

  /**
   * Handle the Ready action.
   *
   * D&D 5e 2024: Ready uses your Action. You specify a trigger and a response.
   * When the trigger occurs (before your next turn), you use your Reaction to
   * take the readied response. The readied action expires at the start of your
   * next turn if not triggered.
   *
   * Currently supports readying attacks with "creature enters range" trigger.
   * Spell readying (Phase 6.1b) is not yet implemented.
   */
  private async handleReadyAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    text: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    return this.socialHandlers.handleReadyAction(sessionId, encounterId, actorId, text, roster);
  }

  /**
   * Handle jump as part of movement.
   *
   * D&D 5e 2024 — Jump is NOT an action; it's part of movement.
   * Long Jump: leap up to STR score feet (half standing). Each foot costs 1 ft of movement.
   * High Jump: leap 3 + STR mod feet (half standing). Each foot costs 1 ft of movement.
   *
   * The jumpDistanceMultiplier (e.g. from Step of the Wind) is consumed here.
   *
   * Position is updated: Long Jump moves horizontally toward the nearest hostile
   * (or a specified direction target). High Jump is vertical (no horizontal displacement).
   *
   * If you land in Difficult Terrain → DC 10 DEX (Acrobatics) check or Prone.
   */
  private async handleJumpAction(
    _sessionId: string,
    encounterId: string,
    actorId: string,
    jump: import("./combat-text-parser.js").ParsedJump,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actorRef = inferActorRef(actorId, roster);

    // --- Resolve Strength & Dexterity scores/modifiers ---
    let strengthScore = 10;
    let strengthModifier = 0;
    let dexterityModifier = 0;
    let proficiencyBonus = 0;
    let acrobaticsProficient = false;

    const resolveAbilityScores = (scores: any, sheet: any) => {
      if (scores && typeof scores.strength === "number") {
        strengthScore = scores.strength;
        strengthModifier = Math.floor((strengthScore - 10) / 2);
      }
      if (scores && typeof scores.dexterity === "number") {
        dexterityModifier = Math.floor((scores.dexterity - 10) / 2);
      }
      if (typeof sheet?.proficiencyBonus === "number") {
        proficiencyBonus = sheet.proficiencyBonus;
      }
      // Check for Acrobatics proficiency
      const skillProf: string[] = Array.isArray(sheet?.skillProficiencies) ? sheet.skillProficiencies : [];
      acrobaticsProficient = skillProf.some((s: string) => s.toLowerCase() === "acrobatics");
    };

    if (actorRef.type === "Character") {
      const character = characters.find((c: any) => c.id === actorId);
      const sheet = (character?.sheet ?? {}) as any;
      resolveAbilityScores(sheet?.abilityScores, sheet);
    } else if (actorRef.type === "Monster") {
      const monster = monsters.find((m: any) => m.id === actorId);
      const statBlock = (monster?.statBlock ?? {}) as any;
      resolveAbilityScores(statBlock?.abilityScores, statBlock);
    }

    // --- Resolve jump distance multiplier from combat state ---
    const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
    const actorState = combatantStates.find((c: any) => {
      if (actorRef.type === "Character") return c.characterId === (actorRef as any).characterId;
      if (actorRef.type === "Monster") return c.monsterId === (actorRef as any).monsterId;
      return c.npcId === (actorRef as any).npcId;
    });

    if (!actorState) throw new ValidationError("Actor not found in encounter");

    const resources = (actorState.resources as any) ?? {};
    const jumpMultiplier = typeof resources.jumpDistanceMultiplier === "number"
      ? resources.jumpDistanceMultiplier
      : 1;

    // --- Determine movement already spent this turn ---
    const movementRemaining = typeof resources.movementRemaining === "number"
      ? resources.movementRemaining
      : getEffectiveSpeed(actorState.resources);

    // Running start: needs ≥ 10 ft of movement already spent (a simplification —
    // the rule says "move at least 10 feet immediately before the jump").
    const totalSpeed = getEffectiveSpeed(actorState.resources);
    const movementUsed = totalSpeed - movementRemaining;
    const hasRunningStart = movementUsed >= 10;

    // --- Calculate jump distance ---
    const jumpResult = jump.jumpType === "high"
      ? calculateHighJumpDistance(strengthModifier, hasRunningStart, jumpMultiplier)
      : calculateLongJumpDistance(strengthScore, hasRunningStart, jumpMultiplier);

    // If the player requested a specific distance, cap it
    const requestedDistance = jump.requestedDistanceFeet ?? jumpResult.maxDistanceFeet;
    const actualJumpDistance = Math.min(requestedDistance, jumpResult.maxDistanceFeet);

    // Jump costs movement 1:1
    if (actualJumpDistance > movementRemaining) {
      throw new ValidationError(
        `Not enough movement to jump ${actualJumpDistance}ft. ` +
        `Movement remaining: ${Math.round(movementRemaining)}ft. ` +
        `Max jump distance: ${jumpResult.maxDistanceFeet}ft (${jump.jumpType} jump${hasRunningStart ? ", running start" : ", standing"}${jumpMultiplier > 1 ? `, ×${jumpMultiplier} multiplier` : ""}).`,
      );
    }

    // --- Compute landing position ---
    const currentPosition = resources.position ?? { x: 0, y: 0 };

    // Determine direction target for the jump
    let directionTarget: { x: number; y: number } | undefined;
    if (jump.directionCoords) {
      directionTarget = jump.directionCoords;
    } else if (jump.directionTarget) {
      directionTarget = getPositionByRef(combatantStates, jump.directionTarget) ?? undefined;
    } else {
      // Default: jump toward the nearest hostile creature
      directionTarget = this.findNearestHostilePosition(actorRef, combatantStates, currentPosition);
    }

    const landingPosition = computeJumpLandingPosition(
      currentPosition,
      actualJumpDistance,
      jump.jumpType,
      directionTarget,
    );

    // --- Check terrain at landing position for Difficult Terrain ---
    let landedInDifficultTerrain = false;
    let proneFromLanding = false;
    let acrobaticsCheckSummary = "";

    const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
    const map = encounter?.mapData as unknown as CombatMap | undefined;

    if (map && map.cells && map.cells.length > 0) {
      const landingCell = getCellAt(map, landingPosition);
      if (landingCell && landingCell.terrain === "difficult") {
        landedInDifficultTerrain = true;

        // DC 10 Dexterity (Acrobatics) check or Prone
        if (this.deps.diceRoller) {
          // Apply ActiveEffect bonuses to the acrobatics (ability) check
          const acroEffects = getActiveEffects(actorState.resources);
          const acroBonus = calculateBonusFromEffects(acroEffects, 'ability_checks', 'dexterity');
          let acroEffectBonus = acroBonus.flatBonus;
          for (const dr of acroBonus.diceRolls) {
            acroEffectBonus += this.deps.diceRoller.rollDie(dr.sides, dr.count).total;
          }
          const acroHasAdv = hasAdvantageFromEffects(acroEffects, 'ability_checks', 'dexterity');
          const acroHasDisadv = hasDisadvantageFromEffects(acroEffects, 'ability_checks', 'dexterity');
          const acroMode: 'advantage' | 'disadvantage' | 'normal' =
            acroHasAdv && !acroHasDisadv ? 'advantage'
            : acroHasDisadv && !acroHasAdv ? 'disadvantage'
            : 'normal';

          const acrobaticsResult = abilityCheck(this.deps.diceRoller, {
            dc: 10,
            abilityModifier: dexterityModifier + acroEffectBonus,
            proficiencyBonus,
            proficient: acrobaticsProficient,
            mode: acroMode,
          });

          if (!acrobaticsResult.success) {
            proneFromLanding = true;
            acrobaticsCheckSummary = `Acrobatics check failed (rolled ${acrobaticsResult.total} vs DC 10) — Prone!`;
          } else {
            acrobaticsCheckSummary = `Acrobatics check passed (rolled ${acrobaticsResult.total} vs DC 10).`;
          }
        } else {
          // No dice roller available — auto-fail Acrobatics (conservative)
          proneFromLanding = true;
          acrobaticsCheckSummary = "Landed in difficult terrain — Prone (no dice roller for Acrobatics check).";
        }
      }
    }

    // --- Spend the movement and update position ---
    const newMovementRemaining = Math.max(0, movementRemaining - actualJumpDistance);

    await this.deps.combatRepo.updateCombatantState(actorState.id, {
      resources: {
        ...resources,
        position: landingPosition,
        movementRemaining: newMovementRemaining,
        movementSpent: newMovementRemaining <= 0,
      } as any,
    });

    // Keep CombatMap entities[] in sync with the jump landing position
    await syncEntityPosition(this.deps.combatRepo, encounterId, actorState.id, landingPosition);

    // --- Apply Prone condition if failed Acrobatics check ---
    if (proneFromLanding) {
      if (!isConditionImmuneByEffects(actorState.resources, "Prone")) {
        let conditions = normalizeConditions(actorState.conditions);
        conditions = addCondition(conditions, createCondition("Prone" as Condition, "until_removed", {
          source: "Jump: difficult terrain landing",
        }));
        await this.deps.combatRepo.updateCombatantState(actorState.id, {
          conditions: conditions as any,
        });
      }
    }

    // --- Build result ---
    const actorName = getActorNameFromRoster(actorId, roster);
    const jumpTypeLabel = jump.jumpType === "high" ? "High Jump" : "Long Jump";
    const runningLabel = hasRunningStart ? "running start" : "standing";
    const multiplierLabel = jumpMultiplier > 1 ? `, ×${jumpMultiplier} multiplier` : "";

    let message = `${actorName} performs a ${jumpTypeLabel} (${runningLabel}${multiplierLabel}): ${actualJumpDistance}ft`;
    if (jump.jumpType === "long") {
      message += ` to (${landingPosition.x}, ${landingPosition.y})`;
    }
    message += `. Movement remaining: ${Math.round(newMovementRemaining)}ft.`;
    if (acrobaticsCheckSummary) {
      message += ` ${acrobaticsCheckSummary}`;
    }

    const narration = await this.eventEmitter.generateNarration("jumpComplete", {
      actorName,
      jumpType: jump.jumpType,
      distance: actualJumpDistance,
      hasRunningStart,
      jumpMultiplier,
      landingPosition,
      landedInDifficultTerrain,
      proneFromLanding,
    });

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "JUMP_COMPLETE",
      action: jumpTypeLabel,
      message,
      narration: narration ?? undefined,
      movedFeet: actualJumpDistance,
      movedTo: landingPosition,
    };
  }

  /**
   * Find the position of the nearest hostile creature relative to the actor.
   * Used as the default jump direction when no explicit target is specified.
   */
  private findNearestHostilePosition(
    actorRef: CombatantRef,
    combatantStates: CombatantStateRecord[],
    actorPosition: { x: number; y: number },
  ): { x: number; y: number } | undefined {
    let nearestDist = Infinity;
    let nearestPos: { x: number; y: number } | undefined;

    const actorType = actorRef.type; // "Character" or "Monster" or "NPC"

    for (const combatant of combatantStates) {
      // Skip self
      if (actorType === "Character" && combatant.characterId === (actorRef as any).characterId) continue;
      if (actorType === "Monster" && combatant.monsterId === (actorRef as any).monsterId) continue;
      if (actorType === "NPC" && combatant.npcId === (actorRef as any).npcId) continue;

      // Identify hostiles: Characters are hostile to Monsters/NPCs and vice versa
      const isHostile =
        (actorType === "Character" && (combatant.combatantType === "Monster" || combatant.combatantType === "NPC")) ||
        (actorType !== "Character" && combatant.combatantType === "Character");

      if (!isHostile) continue;

      const pos = getPosition(combatant.resources ?? {});
      if (!pos) continue;

      const dist = calculateDistance(actorPosition, pos);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPos = pos;
      }
    }

    return nearestPos;
  }

  /**
   * Handle class abilities (like Action Surge) via AbilityRegistry.
   * These are abilities that don't consume action economy but may consume class resources.
   */
  private async handleClassAbility(
    sessionId: string,
    encounterId: string,
    actorId: string,
    abilityId: string,
    characters: SessionCharacterRecord[],
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = inferActorRef(actorId, roster);

    if (actor.type !== "Character") {
      throw new ValidationError("Class abilities can only be used by characters");
    }

    const character = characters.find((c) => c.id === actorId);
    if (!character) {
      throw new ValidationError("Character not found");
    }

    const sheet = (character.sheet ?? {}) as any;
    const level = sheet?.level ?? character?.level ?? 1;
    const className = sheet?.className ?? character?.className ?? "";

    const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = combatantStates.find(
      (c: any) => c.combatantType === "Character" && c.characterId === actorId,
    );
    if (!actorCombatant) {
      throw new ValidationError("Character not in combat");
    }

    const resources = actorCombatant.resources ?? {};

    const mockCreature: import("../../../../domain/abilities/ability-executor.js").AbilityActor = {
      getId: () => actorId,
      getName: () => character.name,
      getCurrentHP: () => actorCombatant.hpCurrent ?? sheet?.currentHp ?? sheet?.maxHp ?? 0,
      getMaxHP: () => actorCombatant.hpMax ?? sheet?.maxHp ?? 0,
      getSpeed: () => sheet?.speed ?? 30,
      modifyHP: (amount: number) => {
        const currentHP = actorCombatant.hpCurrent ?? 0;
        const maxHP = actorCombatant.hpMax ?? sheet?.maxHp ?? 0;
        const newHP = Math.min(maxHP, Math.max(0, currentHP + amount));
        return { actualChange: newHP - currentHP };
      },
    };

    const mockCombat: import("../../../../domain/abilities/ability-executor.js").AbilityCombatContext = {
      hasUsedAction: () => false,
      getRound: () => 0,
      getTurnIndex: () => 0,
      addEffect: () => {},
      getPosition: () => undefined,
      setPosition: () => {},
    };

    const result = await this.deps.abilityRegistry.execute({
      sessionId,
      encounterId,
      actor: mockCreature,
      combat: mockCombat,
      abilityId,
      params: {
        actor,
        resources,
        className,
        level,
        sheet,
      },
      services: {},
    });

    if (!result.success) {
      throw new ValidationError(result.error || result.summary);
    }

    let updatedResources = result.data?.updatedResources;
    if (updatedResources) {
      // Stamp round/turn on any ActiveEffects that lack them (for proper expiry tracking)
      const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
      const round = encounter?.round ?? 1;
      const turn = encounter?.turn ?? 0;
      const effects = getActiveEffects(updatedResources as any);
      const needsStamp = effects.some(e => e.appliedAtRound === undefined);
      if (needsStamp) {
        const stamped = effects.map(e =>
          e.appliedAtRound === undefined
            ? { ...e, appliedAtRound: round, appliedAtTurnIndex: turn }
            : e
        );
        updatedResources = setActiveEffects(updatedResources as any, stamped);
      }

      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: updatedResources as any,
      });
    }

    // ── AoE post-processing: Turn Undead ──────────────────────────────
    // The executor validated resource spend; now resolve saves against
    // each Undead within 30 ft and apply Frightened on failure.
    if (result.data?.aoeEffect === "turnUndead" && this.deps.diceRoller) {
      const saveDC = result.data.saveDC as number;
      const saveAbility = (result.data.saveAbility as string) || "wisdom";

      const allCombatants = await this.deps.combatRepo.listCombatants(encounterId);
      const actorResNorm = normalizeResources(actorCombatant.resources);
      const actorPos = getPosition(actorResNorm);

      if (actorPos) {
        const monsters = await this.deps.monsters.listBySession(sessionId);
        const npcs = await this.deps.npcs.listBySession(sessionId);

        const savingThrowResolver = new SavingThrowResolver(
          this.deps.combatRepo,
          this.deps.diceRoller,
          this.debugLogsEnabled,
        );

        const turnResults: string[] = [];

        for (const combatant of allCombatants) {
          if (combatant.combatantType !== "Monster" || !combatant.monsterId) continue;

          // Check if the monster is Undead
          const monsterRecord = monsters.find((m: any) => m.id === combatant.monsterId);
          if (!monsterRecord) continue;
          const statBlock = monsterRecord.statBlock as Record<string, unknown> | null;
          const creatureType = ((statBlock?.type as string) ?? "").toLowerCase();
          if (creatureType !== "undead") continue;

          // Check within 30 ft
          const cRes = normalizeResources(combatant.resources);
          const cPos = getPosition(cRes);
          if (!cPos) continue;
          const dist = calculateDistance(actorPos, cPos);
          if (dist > 30) continue;

          // Build & resolve the Wisdom saving throw
          const saveAction = savingThrowResolver.buildPendingAction({
            actorId: combatant.monsterId,
            sourceId: actorId,
            ability: saveAbility,
            dc: saveDC,
            reason: "Turn Undead",
            onSuccess: { summary: "Resists the turning" },
            onFailure: {
              summary: "Turned!",
              conditions: { add: ["Frightened"] },
            },
          });

          const resolution = await savingThrowResolver.resolve(
            saveAction,
            encounterId,
            characters,
            monsters as any[],
            npcs as any[],
          );

          const monsterName = monsterRecord.name ?? "Unknown";
          if (resolution.success) {
            turnResults.push(`${monsterName} succeeds (rolled ${resolution.total} vs DC ${saveDC})`);
          } else {
            turnResults.push(`${monsterName} fails (rolled ${resolution.total} vs DC ${saveDC}) — Frightened!`);
          }
        }

        if (turnResults.length > 0) {
          const turnSummary = turnResults.join("; ");
          return {
            requiresPlayerInput: false,
            actionComplete: true,
            type: "SIMPLE_ACTION_COMPLETE",
            action: "Turn Undead",
            message: `${result.summary} ${turnSummary}`,
          };
        }
      }
    }

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: (result.data?.abilityName as string) ?? abilityId,
      message: result.summary,
    };
  }

  /**
   * Handle Help action – give ally advantage on next attack against target.
   */
  private async handleHelpAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    targetName: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    return this.socialHandlers.handleHelpAction(sessionId, encounterId, actorId, targetName, roster);
  }

  /**
   * Handle Shove action – contested athletics check to push or knock prone.
   */
  private async handleShoveAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    shoveInfo: { targetName: string; shoveType: "push" | "prone" },
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    return this.grappleHandlers.handleShoveAction(sessionId, encounterId, actorId, shoveInfo, roster);
  }

  /**
   * Handle Grapple action – contested athletics check to apply Grappled condition.
   */
  private async handleGrappleAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    grappleInfo: { targetName: string },
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    return this.grappleHandlers.handleGrappleAction(sessionId, encounterId, actorId, grappleInfo, roster);
  }

  private async handleEscapeGrappleAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    return this.grappleHandlers.handleEscapeGrappleAction(sessionId, encounterId, actorId, roster);
  }

  /**
   * Handle Hide action – make stealth check to gain Hidden condition.
   * Rogues with Cunning Action can use this as a bonus action.
   */
  private async handleHideAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    characters: SessionCharacterRecord[],
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    return this.socialHandlers.handleHideAction(sessionId, encounterId, actorId, characters, roster);
  }

  /**
   * Handle the Search action — Perception check to reveal Hidden creatures.
   */
  private async handleSearchAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    return this.socialHandlers.handleSearchAction(sessionId, encounterId, actorId, roster);
  }

  /**
   * Handle "pick up <item>" from the ground.
   * D&D 5e 2024: Equipping a weapon (including picking it up) is part of the Attack action.
   * Alternatively, picking up an item uses the Free Object Interaction (one per turn).
   */
  private async handlePickupAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    itemName: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    return this.interactionHandlers.handlePickupAction(sessionId, encounterId, actorId, itemName, roster);
  }

  /**
   * Handle "drop <item>" — remove a weapon from the actor's equipment/pickedUpWeapons
   * and place it on the ground at the actor's position.
   * D&D 5e 2024: Dropping an item costs no action at all (not even a free interaction).
   */
  private async handleDropAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    itemName: string,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    return this.interactionHandlers.handleDropAction(sessionId, encounterId, actorId, itemName, characters, monsters, npcs, roster);
  }

  /**
   * Handle "draw <weapon>" — pull a stowed weapon into hand.
   * D&D 5e 2024: Costs the free Object Interaction (one per turn).
   * If the free interaction is already used, costs the Utilize action (standard action).
   */
  private async handleDrawWeaponAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    weaponName: string,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    return this.interactionHandlers.handleDrawWeaponAction(sessionId, encounterId, actorId, weaponName, characters, monsters, npcs, roster);
  }

  /**
   * Handle "sheathe <weapon>" — stow a drawn weapon.
   * D&D 5e 2024: Costs the free Object Interaction (one per turn).
   * If the free interaction is already used, costs the Utilize action (standard action).
   */
  private async handleSheatheWeaponAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    weaponName: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    return this.interactionHandlers.handleSheatheWeaponAction(sessionId, encounterId, actorId, weaponName, roster);
  }

  /**
   * Handle bonus actions via AbilityRegistry.
   * Builds execution context and delegates to the registered executor.
   */
  /**
   * Handle bonus actions via AbilityRegistry.
   * Builds execution context and delegates to the registered executor.
   *
   * @param skipBonusActionCost - If true, don't check/consume bonus action (Nick mastery)
   */
  private async handleBonusAbility(
    sessionId: string,
    encounterId: string,
    actorId: string,
    abilityId: string,
    text: string,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
    roster: LlmRoster,
    skipBonusActionCost = false,
  ): Promise<ActionParseResult> {
    // Check bonus action economy before executing (skipped for Nick mastery)
    if (!skipBonusActionCost) {
      const combatantStatesForCheck = await this.deps.combatRepo.listCombatants(encounterId);
      const actorCombatantForCheck = combatantStatesForCheck.find(
        (c: any) => c.combatantType === "Character" && c.characterId === actorId,
      );
      if (actorCombatantForCheck && !hasBonusActionAvailable(actorCombatantForCheck.resources)) {
        throw new ValidationError("Actor has already spent their bonus action this turn");
      }
    }

    const actorChar = characters.find((c) => c.id === actorId);
    if (!actorChar) {
      throw new ValidationError("Actor not found");
    }

    const actorSheet = (actorChar?.sheet ?? {}) as any;
    const actorClassName = actorChar?.className ?? actorSheet?.className ?? "";
    const actorLevel = ClassFeatureResolver.getLevel(actorSheet, actorChar?.level);

    const combatantStates = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = combatantStates.find(
      (c: any) => c.combatantType === "Character" && c.characterId === actorId,
    );
    if (!actorCombatant) {
      throw new ValidationError("Actor not found in encounter");
    }

    const actorPos = getPosition(actorCombatant.resources ?? {});
    const resources = (actorCombatant.resources as any) ?? {};

    // Infer target from text or find nearest enemy
    let targetRef: CombatantRef | null = null;
    let targetName: string | null = null;

    for (const m of monsters) {
      if (text.toLowerCase().includes(m.name.toLowerCase())) {
        targetRef = { type: "Monster", monsterId: m.id };
        targetName = m.name;
        break;
      }
    }

    if (!targetRef && actorPos) {
      const hostiles = combatantStates.filter(
        (c: any) => c.combatantType === "Monster" && c.hpCurrent > 0,
      );
      if (hostiles.length > 0) {
        let nearest = hostiles[0];
        let minDist = Infinity;
        for (const h of hostiles) {
          const hPos = getPosition(h.resources ?? {});
          if (!hPos) continue;
          const d = calculateDistance(actorPos, hPos);
          if (d < minDist) {
            minDist = d;
            nearest = h;
          }
        }
        targetRef = { type: "Monster", monsterId: nearest.monsterId! };
        targetName = monsters.find((m) => m.id === nearest.monsterId)?.name ?? "target";
      }
    }

    const actorRef = inferActorRef(actorId, roster);

    // Build services object for executor (bonus action abilities bypass regular action economy)
    const services = {
      attack: (params: any) => this.deps.actions.attack(sessionId, params),
      move: (params: any) => this.deps.twoPhaseActions.initiateMove(sessionId, params),
      disengage: (params: any) => this.deps.actions.disengage(sessionId, { ...params, skipActionCheck: true }),
      dash: (params: any) => this.deps.actions.dash(sessionId, { ...params, skipActionCheck: true }),
      dodge: (params: any) => this.deps.actions.dodge(sessionId, { ...params, skipActionCheck: true }),
      hide: (params: any) => this.deps.actions.hide(sessionId, { ...params, isBonusAction: true, skipActionCheck: true }),
    };

    const mockCreature: import("../../../../domain/abilities/ability-executor.js").AbilityActor = {
      getId: () => actorId,
      getName: () => actorChar.name,
      getCurrentHP: () => actorCombatant.hpCurrent ?? actorSheet?.currentHp ?? actorSheet?.maxHp ?? 0,
      getMaxHP: () => actorCombatant.hpMax ?? actorSheet?.maxHp ?? 0,
      getSpeed: () => actorSheet?.speed ?? 30,
      modifyHP: (amount: number) => {
        const currentHP = actorCombatant.hpCurrent ?? 0;
        const maxHP = actorCombatant.hpMax ?? actorSheet?.maxHp ?? 0;
        const newHP = Math.min(maxHP, Math.max(0, currentHP + amount));
        return { actualChange: newHP - currentHP };
      },
    };

    const mockCombat: import("../../../../domain/abilities/ability-executor.js").AbilityCombatContext = {
      hasUsedAction: (_actorId: string, _actionType: string) => {
        return true;
      },
      getRound: () => 0,
      getTurnIndex: () => 0,
      addEffect: () => {},
      getPosition: () => undefined,
      setPosition: () => {},
    };

    const getTargetId = (ref: CombatantRef): string => {
      if (ref.type === "Monster") return ref.monsterId!;
      if (ref.type === "Character") return ref.characterId!;
      return ref.npcId!;
    };

    const targetActor: import("../../../../domain/abilities/ability-executor.js").AbilityActor | undefined = targetRef ? {
      getId: () => getTargetId(targetRef),
      getName: () => targetName ?? "target",
      getCurrentHP: () => 0,
      getMaxHP: () => 0,
      getSpeed: () => 30,
      modifyHP: () => ({ actualChange: 0 }),
    } : undefined;

    const result = await this.deps.abilityRegistry.execute({
      sessionId,
      encounterId,
      actor: mockCreature,
      combat: mockCombat,
      abilityId,
      target: targetActor,
      params: {
        actor: actorRef,
        target: targetRef,
        targetName,
        resources,
        className: actorClassName,
        level: actorLevel,
        sheet: actorSheet,
        tabletopMode: true,
        text,
      },
      services,
    });

    // Handle result
    if (!result.success) {
      throw new ValidationError(result.error || result.summary);
    }

    // If executor returned pendingAction for tabletop flow
    if (result.requiresPlayerInput && result.pendingAction) {
      await this.deps.combatRepo.setPendingAction(encounterId, result.pendingAction as any);

      const currentResources = actorCombatant.resources ?? {};
      let updatedResourcesForBonus = skipBonusActionCost
        ? currentResources
        : useBonusAction(currentResources);

      // Track Nick mastery usage (once per turn)
      if (skipBonusActionCost) {
        updatedResourcesForBonus = {
          ...(updatedResourcesForBonus as Record<string, unknown>),
          nickUsedThisTurn: true,
        } as typeof updatedResourcesForBonus;
      }

      // Spend resource pools upfront (e.g., ki for Flurry of Blows)
      // This must happen when the ability is initiated, not when dice resolve,
      // because the resource commitment is made at ability activation time.
      if (result.resourcesSpent?.kiPoints) {
        try {
          updatedResourcesForBonus = spendResourceFromPool(updatedResourcesForBonus, "ki", result.resourcesSpent.kiPoints);
        } catch {
          // If spending fails, log but continue - the executor already validated
        }
      }
      if (result.resourcesSpent?.secondWind) {
        try {
          updatedResourcesForBonus = spendResourceFromPool(updatedResourcesForBonus, "secondWind", result.resourcesSpent.secondWind);
        } catch {
          // If spending fails, log but continue - the executor already validated
        }
      }

      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: updatedResourcesForBonus as any,
      });

      const narration = await this.eventEmitter.generateNarration("attackRequest", {
        attackerName: actorChar.name,
        targetName: targetName ?? "target",
      });

      return {
        requiresPlayerInput: true,
        type: "REQUEST_ROLL",
        rollType: result.rollType ?? "attack",
        message: result.summary,
        narration,
        diceNeeded: result.diceNeeded ?? "d20",
        pendingAction: result.pendingAction as any,
        actionComplete: false,
      };
    }

    // Executor completed the action (e.g., patient-defense, step-of-the-wind)
    let updatedResourcesForComplete = skipBonusActionCost
      ? resources
      : useBonusAction(resources);

    // Track Nick mastery usage (once per turn)
    if (skipBonusActionCost) {
      updatedResourcesForComplete = {
        ...(updatedResourcesForComplete as Record<string, unknown>),
        nickUsedThisTurn: true,
      } as typeof updatedResourcesForComplete;
    }
    if (result.resourcesSpent?.kiPoints) {
      try {
        updatedResourcesForComplete = spendResourceFromPool(updatedResourcesForComplete, "ki", result.resourcesSpent.kiPoints);
      } catch {
        // If spending fails, log but continue - the executor already validated
      }
    }

    if (result.resourcesSpent?.secondWind) {
      try {
        updatedResourcesForComplete = spendResourceFromPool(updatedResourcesForComplete, "secondWind", result.resourcesSpent.secondWind);
      } catch {
        // If spending fails, log but continue - the executor already validated
      }
    }

    // Handle generic resource pool spending (e.g., wholeness_of_body)
    if (result.data?.spendResource) {
      const { poolName, amount } = result.data.spendResource as { poolName: string; amount: number };
      if (poolName && amount && poolName !== "ki" && poolName !== "secondWind") {
        try {
          updatedResourcesForComplete = spendResourceFromPool(updatedResourcesForComplete, poolName, amount);
        } catch {
          // If spending fails, log but continue - the executor already validated
        }
      }
    }

    // Merge custom flags from executor's updatedResources (e.g., raging, rageDamageBonus)
    // The executor may set flags that the standard pool-spending logic doesn't know about.
    if (result.data?.updatedResources) {
      const executorResources = result.data.updatedResources as Record<string, unknown>;
      updatedResourcesForComplete = {
        ...(updatedResourcesForComplete as Record<string, unknown>),
        ...executorResources,
        // Only mark bonus action as used if we're not skipping the cost (Nick mastery preserves it)
        ...(skipBonusActionCost ? {} : { bonusActionUsed: true }),
      } as typeof updatedResourcesForComplete;
    }

    // Persist jumpDistanceMultiplier from abilities like Step of the Wind
    // so that the jump action can read it from combatant resources.
    if (result.data?.jumpMultiplier && typeof result.data.jumpMultiplier === "number") {
      updatedResourcesForComplete = {
        ...(updatedResourcesForComplete as Record<string, unknown>),
        jumpDistanceMultiplier: result.data.jumpMultiplier,
      } as typeof updatedResourcesForComplete;
    }

    // Build update object
    const updateData: { resources: any; hpCurrent?: number } = {
      resources: updatedResourcesForComplete as any,
    };

    if (result.data?.hpUpdate && typeof (result.data.hpUpdate as any).hpCurrent === "number") {
      updateData.hpCurrent = (result.data.hpUpdate as any).hpCurrent;
    }

    await this.deps.combatRepo.updateCombatantState(actorCombatant.id, updateData);

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: abilityId,
      message: result.summary,
    };
  }

  // ----------------------------------------------------------------
  // Target resolution helpers
  // ----------------------------------------------------------------

  /**
   * Resolve the best attack target by name, preferring the nearest among
   * same-named combatants. If no targetName is provided, picks the nearest hostile.
   */
  private async resolveAttackTarget(
    encounterId: string,
    actorId: string,
    roster: LlmRoster,
    targetName: string | undefined,
    preferNearest: boolean,
  ): Promise<CombatantRef> {
    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = combatants.find(
      (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
    );
    const actorPos = actorCombatant ? getPosition(actorCombatant.resources ?? {}) : null;
    const actorRef = inferActorRef(actorId, roster);

    if (targetName) {
      const candidates = findAllCombatantsByName(targetName, roster);
      if (candidates.length === 0) {
        throw new ValidationError(`No target found matching "${targetName}"`);
      }

      // Filter out dead/unconscious candidates (HP <= 0)
      const aliveCandidates = candidates.filter((ref) => {
        const refId = ref.type === "Character" ? (ref as any).characterId
          : ref.type === "Monster" ? (ref as any).monsterId
          : (ref as any).npcId;
        const comb = combatants.find(
          (c: any) => c.characterId === refId || c.monsterId === refId || c.npcId === refId,
        );
        if (!comb) return true; // keep if we can't verify
        const hp = typeof (comb.resources as any)?.currentHp === "number" ? (comb.resources as any).currentHp : null;
        return hp === null || hp > 0;
      });

      if (aliveCandidates.length === 0) {
        throw new ValidationError(`All targets matching "${targetName}" are dead or unconscious`);
      }
      if (aliveCandidates.length === 1 || !actorPos) return aliveCandidates[0]!;

      // Pick the nearest alive candidate
      let bestRef = aliveCandidates[0]!;
      let bestDist = Infinity;
      for (const ref of aliveCandidates) {
        const refId = ref.type === "Character" ? (ref as any).characterId
          : ref.type === "Monster" ? (ref as any).monsterId
          : (ref as any).npcId;

        const comb = combatants.find(
          (c: any) => c.characterId === refId || c.monsterId === refId || c.npcId === refId,
        );
        if (!comb) continue;
        const pos = getPosition(comb.resources ?? {});
        if (!pos) continue;
        const dist = calculateDistance(actorPos, pos);
        if (dist < bestDist) {
          bestDist = dist;
          bestRef = ref;
        }
      }
      return bestRef;
    }

    // No target name — pick nearest hostile
    if (!actorPos) throw new ValidationError("Cannot determine actor position to find nearest target");

    let bestRef: CombatantRef | null = null;
    let bestDist = Infinity;

    for (const c of combatants) {
      // Skip self
      if (c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId) continue;

      // Identify hostiles
      const isHostile =
        (actorRef.type === "Character" && (c.combatantType === "Monster" || c.combatantType === "NPC")) ||
        (actorRef.type !== "Character" && c.combatantType === "Character");
      if (!isHostile) continue;

      // Skip dead/unconscious
      const hp = typeof (c.resources as any)?.currentHp === "number" ? (c.resources as any).currentHp : null;
      if (hp !== null && hp <= 0) continue;

      const pos = getPosition(c.resources ?? {});
      if (!pos) continue;

      const dist = calculateDistance(actorPos, pos);
      if (dist < bestDist) {
        bestDist = dist;
        if (c.combatantType === "Character" && c.characterId) {
          bestRef = { type: "Character", characterId: c.characterId };
        } else if (c.combatantType === "Monster" && c.monsterId) {
          bestRef = { type: "Monster", monsterId: c.monsterId };
        } else if (c.combatantType === "NPC" && c.npcId) {
          bestRef = { type: "NPC", npcId: c.npcId };
        }
      }
    }

    if (!bestRef) throw new ValidationError("No hostile targets found");
    return bestRef;
  }

  /**
   * Build an enriched roster that includes distanceFeet for each combatant,
   * so the LLM can disambiguate same-named targets.
   */
  private async enrichRosterWithDistances(
    encounterId: string,
    actorId: string,
    roster: LlmRoster,
  ): Promise<LlmRoster> {
    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = combatants.find(
      (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
    );
    const actorPos = actorCombatant ? getPosition(actorCombatant.resources ?? {}) : null;
    if (!actorPos) return roster; // Can't compute distances without actor position

    const withDist = <T extends { id: string; name: string }>(
      entries: T[],
      idField: "characterId" | "monsterId" | "npcId",
    ): Array<T & { distanceFeet?: number }> =>
      entries.map((entry) => {
        const comb = combatants.find((c: any) => c[idField] === entry.id);
        if (!comb) return entry;
        const pos = getPosition(comb.resources ?? {});
        if (!pos) return entry;
        return { ...entry, distanceFeet: Math.round(calculateDistance(actorPos, pos)) };
      });

    return {
      characters: withDist(roster.characters, "characterId"),
      monsters: withDist(roster.monsters, "monsterId"),
      npcs: withDist(roster.npcs, "npcId"),
    };
  }

  /**
   * Handle attack action – resolve weapon, validate range, create pending attack.
   */
  private async handleAttackAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    text: string,
    command: AttackCommand,
    characters: SessionCharacterRecord[],
    monsters: SessionMonsterRecord[],
    npcs: SessionNPCRecord[],
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

    const actorChar = characters.find((c) => c.id === actorId);
    const actorSheet = (actorChar?.sheet ?? {}) as any;
    const actorLevel = ClassFeatureResolver.getLevel(actorSheet, actorChar?.level);
    const actorClassName = actorChar?.className ?? actorSheet?.className ?? "";

    // Merge picked-up weapons into the attacks array so they can be used in attacks
    const pickedUp = Array.isArray((actorCombatant.resources as any)?.pickedUpWeapons)
      ? (actorCombatant.resources as any).pickedUpWeapons as any[]
      : [];
    if (pickedUp.length > 0 && Array.isArray(actorSheet.attacks)) {
      for (const pw of pickedUp) {
        const exists = actorSheet.attacks.some((a: any) => a.name?.toLowerCase() === pw.name?.toLowerCase());
        if (!exists) actorSheet.attacks.push(pw);
      }
    }

    // Ensure attacksAllowedThisTurn is set based on Extra Attack feature
    let currentResources = actorCombatant.resources;
    if (getAttacksAllowedThisTurn(currentResources) === 1) {
      const attacksPerAction = ClassFeatureResolver.getAttacksPerAction(actorSheet, actorClassName, actorLevel);
      if (attacksPerAction > 1) {
        currentResources = setAttacksAllowed(currentResources, attacksPerAction);
        await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: currentResources as any,
        });
      }
    }

    if (!canMakeAttack(currentResources)) {
      throw new ValidationError("Actor has already spent their action this turn");
    }

    const targetCombatant = combatantStates.find((c: any) => c.monsterId === targetId || c.characterId === targetId || c.npcId === targetId);
    if (!targetCombatant) throw new ValidationError("Target not found in encounter");

    const actorPos = getPosition(actorCombatant.resources ?? {});
    const targetPos = getPosition(targetCombatant.resources ?? {});
    if (!actorPos || !targetPos) throw new ValidationError("Actor and target must have positions set");

    const lowered = text.toLowerCase();
    const textImpliesRanged =
      /\b(bow|shortbow|longbow|crossbow|shoot|arrow|ranged|sling|dart|throw|javelin|hurl)\b/.test(lowered);
    let inferredKind: "melee" | "ranged" = textImpliesRanged ? "ranged" : "melee";

    const spec = command.spec as any;
    if (spec?.kind === "ranged" || spec?.kind === "melee") {
      inferredKind = spec.kind;
    } else if (!textImpliesRanged && !spec) {
      const attacks = (actorSheet?.attacks ?? []) as any[];
      const matchedByName = attacks.find((a: any) => a.name && lowered.includes(a.name.toLowerCase()));
      if (matchedByName?.kind === "ranged") inferredKind = "ranged";
    }

    const dist = calculateDistance(actorPos, targetPos);

    // D&D 5e 2024: Thrown weapon detection — allows melee weapons to be thrown as ranged attacks
    let isThrownAttack = false;
    let thrownNormalRange: number | undefined;
    let thrownLongRange: number | undefined;
    const textImpliesThrown = /\b(throw|hurl|toss)\b/.test(lowered);

    // Helper: extract thrown range from property string like "Thrown (Range 20/60)"
    const parseThrownRange = (props: string[]): { normal: number; long: number } | null => {
      for (const p of props) {
        const match = typeof p === "string" && p.match(/thrown\s*\(\s*range\s+(\d+)\s*\/\s*(\d+)\s*\)/i);
        if (match) return { normal: parseInt(match[1]!, 10), long: parseInt(match[2]!, 10) };
      }
      // Check for bare "thrown" property (without embedded range)
      if (props.some(p => typeof p === "string" && p.toLowerCase().trim() === "thrown")) return { normal: 20, long: 60 };
      return null;
    };

    // Helper: find a throwable weapon from the actor's sheet, optionally matching a name from user text
    // Matches both melee weapons with Thrown (e.g. Handaxe, Javelin) AND ranged weapons with Thrown (e.g. Dart)
    const findThrownWeapon = (): any | null => {
      const allAttacks = (actorSheet?.attacks ?? actorSheet?.equipment?.weapons ?? []) as any[];
      const throwable = allAttacks.filter((a: any) => {
        const props = (a.properties ?? []) as string[];
        return props.some((p: string) => typeof p === "string" && /thrown/i.test(p));
      });
      if (throwable.length === 0) return null;
      // Try to match a specific weapon name from the text (e.g. "throw dart")
      const named = throwable.find((w: any) => w.name && lowered.includes(w.name.toLowerCase()));
      if (named) return named;
      // If text names a specific object (e.g. "throw rock"), don't silently fall back to a different throwable.
      // Only fall back when no particular item was specified (e.g. "throw something" / "throw at orc").
      const throwObjMatch = lowered.match(/\b(?:throw|hurl|toss)\s+(?:a\s+|the\s+|my\s+)?(\w+)/);
      if (throwObjMatch) {
        const thrownObj = throwObjMatch[1]!;
        const genericWords = ["at", "it", "that", "something", "anything", "one", "weapon"];
        if (!genericWords.includes(thrownObj)) {
          return null; // User named a specific item that doesn't match — let the error path handle it
        }
      }
      return throwable[0];
    };

    if (textImpliesThrown) {
      // Explicit thrown intent — find a melee weapon with the Thrown property
      const thrownWeapon = findThrownWeapon();
      if (thrownWeapon) {
        isThrownAttack = true;
        inferredKind = "ranged";
        // For ranged+Thrown weapons (e.g. Dart), use the weapon's own range field;
        // for melee+Thrown weapons (e.g. Handaxe), extract from the Thrown property
        if (thrownWeapon.kind === "ranged" && thrownWeapon.range && typeof thrownWeapon.range === "string" && thrownWeapon.range.toLowerCase() !== "melee") {
          const parts = thrownWeapon.range.split("/").map(Number);
          if (parts.length >= 1 && !isNaN(parts[0])) thrownNormalRange = parts[0];
          if (parts.length >= 2 && !isNaN(parts[1])) thrownLongRange = parts[1];
        } else {
          const range = parseThrownRange((thrownWeapon.properties ?? []) as string[]);
          if (range) { thrownNormalRange = range.normal; thrownLongRange = range.long; }
        }
        if (this.debugLogsEnabled) console.log(`[ActionDispatcher] Thrown weapon: ${thrownWeapon.name} (range ${thrownNormalRange}/${thrownLongRange})`);
      } else {
        // Player said "throw X" but has no throwable weapon — build a helpful error
        const allAttacks = (actorSheet?.attacks ?? actorSheet?.equipment?.weapons ?? []) as any[];
        // Check if the user named a specific weapon that exists but isn't throwable
        const namedWeapon = allAttacks.find((a: any) =>
          a.name && lowered.includes(a.name.toLowerCase()),
        );
        if (namedWeapon) {
          throw new ValidationError(
            `${namedWeapon.name} doesn't have the Thrown property and can't be thrown.`,
          );
        }
        // User tried to throw something that isn't even a weapon
        const weaponNames = allAttacks.map((a: any) => a.name).filter(Boolean);
        const hint = weaponNames.length > 0
          ? ` Your available attacks: ${weaponNames.join(", ")}.`
          : "";
        throw new ValidationError(
          `You don't have anything you can throw.${hint}`,
        );
      }
    }

    if (inferredKind === "melee") {
      const actorResources = normalizeResources(actorCombatant.resources ?? {});
      const reach = typeof (actorResources as any).reach === "number" ? (actorResources as any).reach : 5;
      if (dist > reach + 0.0001) {
        // Auto-throw: if out of melee reach, check for a thrown weapon before rejecting
        const thrownWeapon = findThrownWeapon();
        if (thrownWeapon) {
          isThrownAttack = true;
          inferredKind = "ranged";
          if (thrownWeapon.kind === "ranged" && thrownWeapon.range && typeof thrownWeapon.range === "string" && thrownWeapon.range.toLowerCase() !== "melee") {
            const parts = thrownWeapon.range.split("/").map(Number);
            if (parts.length >= 1 && !isNaN(parts[0])) thrownNormalRange = parts[0];
            if (parts.length >= 2 && !isNaN(parts[1])) thrownLongRange = parts[1];
          } else {
            const range = parseThrownRange((thrownWeapon.properties ?? []) as string[]);
            if (range) { thrownNormalRange = range.normal; thrownLongRange = range.long; }
          }
          if (this.debugLogsEnabled) console.log(`[ActionDispatcher] Auto-throw: ${thrownWeapon.name} (target at ${Math.round(dist)}ft, beyond melee reach)`);
        } else {
          throw new ValidationError(`Target is out of reach (${Math.round(dist)}ft > ${Math.round(reach)}ft)`);
        }
      }
    }

    // D&D 5e 2024: Cover AC bonus — check terrain between attacker and target
    let coverACBonus = 0;
    {
      const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
      const map = encounter?.mapData as unknown as CombatMap | undefined;
      if (map && map.cells && map.cells.length > 0) {
        const coverLevel = getCoverLevel(map, actorPos, targetPos);
        if (coverLevel === "full") {
          throw new ValidationError("Target has full cover and cannot be targeted");
        }
        coverACBonus = getCoverACBonus(coverLevel);
        if (this.debugLogsEnabled && coverACBonus > 0) {
          console.log(`[ActionDispatcher] Target has ${coverLevel} cover → +${coverACBonus} AC bonus`);
        }
      }
    }

    const isUnarmed = /\b(unarmed|fist|punch|kick)\b/.test(lowered);
    const unarmedStats = ClassFeatureResolver.getUnarmedStrikeStats(actorSheet, actorClassName, actorLevel);

    const specDamage = spec?.damage;

    // Look for equipped weapon in character sheet.
    // Always look up for thrown attacks (even with LLM spec) so we get name, properties, and range.
    let equippedWeapon: { name: string; attackBonus: number; damage: { diceCount: number; diceSides: number; modifier: number } } | null = null;
    if (isThrownAttack) {
      equippedWeapon = findThrownWeapon() ?? null;
    } else if (!spec) {
      if (actorSheet?.equipment?.weapons) {
        const weapons = actorSheet.equipment.weapons as any[];
        equippedWeapon = weapons.find((w) => w.kind === inferredKind && w.equipped)
          ?? weapons.find((w) => w.kind === inferredKind)
          ?? weapons.find((w) => w.equipped)
          ?? weapons[0]
          ?? null;
      }
      if (!equippedWeapon && actorSheet?.attacks) {
        const attacks = actorSheet.attacks as any[];
        equippedWeapon = attacks.find((a) => a.kind === inferredKind) ?? attacks[0] ?? null;
      }
    }

    const diceCount = typeof specDamage?.diceCount === "number"
      ? specDamage.diceCount
      : equippedWeapon?.damage?.diceCount ?? 1;
    const diceSidesRaw = typeof specDamage?.diceSides === "number"
      ? specDamage.diceSides
      : equippedWeapon?.damage?.diceSides ?? 8;
    const modifierRaw = typeof specDamage?.modifier === "number"
      ? specDamage.modifier
      : equippedWeapon?.damage?.modifier ?? unarmedStats.damageModifier;
    const attackBonusRaw = typeof spec?.attackBonus === "number"
      ? spec.attackBonus
      : equippedWeapon?.attackBonus ?? unarmedStats.attackBonus;

    const finalDiceSides = isUnarmed ? unarmedStats.damageDie : diceSidesRaw;
    let finalModifier = isUnarmed ? unarmedStats.damageModifier : modifierRaw;
    let finalAttackBonus = isUnarmed ? unarmedStats.attackBonus : attackBonusRaw;

    // D&D 5e 2024: Magic item weapon bonuses (+1/+2/+3 weapons)
    // Applied at weaponSpec construction time so they flow through to rolls.
    if (!isUnarmed) {
      const inventory = getInventory(currentResources);
      if (inventory.length > 0) {
        const magicBonuses = getWeaponMagicBonuses(
          inventory,
          spec?.name ?? equippedWeapon?.name ?? "",
          lookupMagicItemById,
          inferredKind as "melee" | "ranged",
        );
        if (magicBonuses.attackBonus !== 0 || magicBonuses.damageBonus !== 0) {
          finalAttackBonus += magicBonuses.attackBonus;
          finalModifier += magicBonuses.damageBonus;
          if (this.debugLogsEnabled) {
            console.log(`[ActionDispatcher] Magic weapon bonus: +${magicBonuses.attackBonus} attack, +${magicBonuses.damageBonus} damage`);
          }
        }
      }
    }

    // Versatile weapon 1h/2h auto-detection (D&D 5e 2024)
    let weaponHands: 1 | 2 | undefined;
    let effectiveDiceSides = finalDiceSides;
    if (!isUnarmed) {
      const weaponProps = (spec?.properties ?? (equippedWeapon as any)?.properties ?? []) as string[];
      const isVersatile = weaponProps.some((p: string) => typeof p === "string" && p.toLowerCase() === "versatile");
      if (isVersatile) {
        // Check for versatileDamage on the weapon/spec
        const versatileDamage = (spec as any)?.versatileDamage ?? (equippedWeapon as any)?.versatileDamage;
        // Check text for explicit grip declaration
        const textLower = text.toLowerCase();
        const explicitTwoHanded = /\b(two.hand(?:ed)?|2h|two hand(?:ed)?)\b/.test(textLower);
        const explicitOneHanded = /\b(one.hand(?:ed)?|1h|one hand(?:ed)?)\b/.test(textLower);

        if (explicitOneHanded) {
          weaponHands = 1;
        } else if (explicitTwoHanded) {
          weaponHands = 2;
        } else if (isThrownAttack) {
          // D&D 5e 2024: Thrown weapons always use 1-handed damage (can't throw two-handed)
          weaponHands = 1;
        } else {
          // Auto-detect: default to 2h unless holding shield or second weapon
          const hasShield = !!(actorSheet?.equipment?.armor?.type === "shield"
            || (actorSheet?.equipment?.shield));
          const attacks = (actorSheet?.attacks ?? actorSheet?.equipment?.weapons ?? []) as any[];
          const hasSecondWeapon = attacks.filter((a: any) => a.kind === "melee").length >= 2;
          weaponHands = (hasShield || hasSecondWeapon) ? 1 : 2;
        }

        if (weaponHands === 2 && versatileDamage?.diceSides) {
          effectiveDiceSides = versatileDamage.diceSides;
          if (this.debugLogsEnabled) console.log(`[ActionDispatcher] Versatile weapon wielded two-handed → ${diceCount}d${effectiveDiceSides}`);
        } else if (weaponHands === 1) {
          if (this.debugLogsEnabled) console.log(`[ActionDispatcher] Versatile weapon wielded one-handed → ${diceCount}d${effectiveDiceSides}`);
        }
      }
    }

    const weaponName = isUnarmed
      ? "Unarmed Strike"
      : spec?.name ?? equippedWeapon?.name ?? "Attack";

    // D&D 5e 2024: Check if the weapon is drawn (in-hand).
    // Unarmed strikes don't require drawing. If drawnWeapons is not initialized (legacy), skip check.
    if (!isUnarmed && weaponName !== "Attack") {
      const drawnWeapons = getDrawnWeapons(currentResources);
      if (drawnWeapons !== undefined && !drawnWeapons.some(n => n.toLowerCase() === weaponName.toLowerCase())) {
        // Weapon not drawn — try to auto-draw using free interaction
        const attackResources = normalizeResources(currentResources);
        const objInteractionUsed = readBoolean(attackResources, "objectInteractionUsed") ?? false;
        if (!objInteractionUsed) {
          // Auto-draw the weapon (free interaction)
          currentResources = addDrawnWeapon(currentResources, weaponName);
          currentResources = { ...(currentResources as Record<string, unknown>), objectInteractionUsed: true } as any;
          await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
            resources: currentResources as any,
          });
          if (this.debugLogsEnabled) console.log(`[ActionDispatcher] Auto-drew ${weaponName} (free interaction)`);
        } else {
          const drawn = drawnWeapons.join(", ");
          const hint = drawn ? ` Currently drawn: ${drawn}.` : "";
          throw new ValidationError(
            `${weaponName} is not drawn and your free Object Interaction is already used this turn.${hint} ` +
            `Use "draw ${weaponName}" on your next turn, or drop your current weapon (free) and pick up ${weaponName}.`,
          );
        }
      }
    }

    const modText = finalModifier === 0 ? "" : finalModifier > 0 ? `+${finalModifier}` : `${finalModifier}`;
    const damageFormula = `${diceCount}d${effectiveDiceSides}${modText}`;

    const inferredDamageType: string | undefined = isUnarmed
      ? "bludgeoning"
      : spec?.damageType ?? (equippedWeapon as any)?.damageType ?? undefined;

    const inferredProperties: string[] | undefined = isUnarmed
      ? undefined
      : spec?.properties ?? (equippedWeapon as any)?.properties ?? undefined;

    // Parse range
    let normalRange: number | undefined;
    let longRange: number | undefined;
    if (inferredKind === "ranged") {
      // D&D 5e 2024: Thrown weapons get range from the Thrown property, not the weapon.range field
      if (isThrownAttack && thrownNormalRange) {
        normalRange = thrownNormalRange;
        longRange = thrownLongRange;
      } else {
        const rangeSource = spec?.range ?? (equippedWeapon as any)?.range;
        if (typeof rangeSource === "string") {
          // Handle "melee" range string for thrown weapons that don't have numeric range
          if (rangeSource.toLowerCase() !== "melee") {
            const parts = rangeSource.split("/").map(Number);
            if (parts.length >= 1 && !isNaN(parts[0])) normalRange = parts[0];
            if (parts.length >= 2 && !isNaN(parts[1])) longRange = parts[1];
          }
        } else if (rangeSource && typeof rangeSource === "object") {
          normalRange = typeof rangeSource.normal === "number" ? rangeSource.normal : undefined;
          longRange = typeof rangeSource.long === "number"
            ? rangeSource.long
            : typeof rangeSource.max === "number"
              ? rangeSource.max
              : undefined;
        }
      }
    }

    if (inferredKind === "ranged") {
      const maxRange = longRange ?? normalRange ?? 600;
      if (dist > maxRange + 0.0001) {
        throw new ValidationError(`Target is out of range (${Math.round(dist)}ft > ${Math.round(maxRange)}ft)`);
      }
    }

    const weaponSpec: WeaponSpec = {
      name: weaponName,
      kind: inferredKind,
      attackBonus: finalAttackBonus,
      damage: { diceCount, diceSides: effectiveDiceSides, modifier: finalModifier },
      damageFormula,
      damageType: inferredDamageType,
      properties: inferredProperties,
      normalRange,
      longRange,
      mastery: resolveWeaponMastery(
        weaponName,
        actorSheet ?? {},
        actorClassName,
        (equippedWeapon as any)?.mastery ?? spec?.mastery,
      ),
      ...(weaponHands ? { hands: weaponHands } : {}),
      ...(isThrownAttack ? { isThrownAttack: true } : {}),
    };

    // D&D 5e 2024: Loading property — only one shot per action/bonus/reaction regardless of Extra Attack
    if (weaponSpec.properties?.some((p: string) => typeof p === "string" && p.toLowerCase() === "loading")) {
      const loadRes = normalizeResources(currentResources);
      if ((loadRes as any).loadingWeaponFiredThisTurn) {
        throw new ValidationError(
          `${weaponSpec.name} has the Loading property — you can only fire it once per action, regardless of Extra Attack`,
        );
      }
    }

    // Derive advantage/disadvantage from conditions + ranged situational modifiers
    let extraDisadvantage = 0;

    // Heavy weapon + Small/Tiny creature → disadvantage (D&D 5e 2024)
    if (inferredProperties?.some((p: string) => p.toLowerCase() === "heavy")) {
      const actorSize = (actorSheet?.size ?? "Medium") as string;
      const sizeNormalized = actorSize.charAt(0).toUpperCase() + actorSize.slice(1).toLowerCase();
      if (sizeNormalized === "Small" || sizeNormalized === "Tiny") {
        extraDisadvantage++;
        if (this.debugLogsEnabled) console.log(`[ActionDispatcher] Heavy weapon + ${sizeNormalized} creature → disadvantage`);
      }
    }

    if (inferredKind === "ranged") {
      if (normalRange && dist > normalRange + 0.0001) {
        extraDisadvantage++;
        if (this.debugLogsEnabled) console.log(`[ActionDispatcher] Ranged attack at long range (${Math.round(dist)}ft > ${normalRange}ft) → disadvantage`);
      }
      const hostileWithin5ft = combatantStates.some((c: any) => {
        if (c.id === actorCombatant.id) return false;
        const actorIsPC = actorCombatant.combatantType === "Character" || actorCombatant.combatantType === "NPC";
        const otherIsPC = c.combatantType === "Character" || c.combatantType === "NPC";
        if (actorIsPC === otherIsPC) return false;
        const otherPos = getPosition(c.resources ?? {});
        if (!otherPos) return false;
        return calculateDistance(actorPos, otherPos) <= 5.0001;
      });
      if (hostileWithin5ft) {
        extraDisadvantage++;
        if (this.debugLogsEnabled) console.log(`[ActionDispatcher] Ranged attack with hostile in melee → disadvantage`);
      }
    }

    const attackerConditions = readConditionNames(actorCombatant.conditions);
    const targetConditions = readConditionNames(targetCombatant.conditions);

    let extraAdvantage = 0;

    // ActiveEffect-based advantage/disadvantage
    const actorActiveEffects = getActiveEffects(actorCombatant.resources ?? {});
    const targetActiveEffects = getActiveEffects(targetCombatant.resources ?? {});
    // Attacker's own effects granting advantage on all attack rolls
    if (hasAdvantageFromEffects(actorActiveEffects, 'attack_rolls')) {
      extraAdvantage++;
      if (this.debugLogsEnabled) console.log(`[ActionDispatcher] ActiveEffect: attacker has advantage on attack_rolls`);
    }
    // Melee-specific advantage (e.g., Reckless Attack)
    if (inferredKind === 'melee' && hasAdvantageFromEffects(actorActiveEffects, 'melee_attack_rolls')) {
      extraAdvantage++;
      if (this.debugLogsEnabled) console.log(`[ActionDispatcher] ActiveEffect: attacker has advantage on melee_attack_rolls`);
    }
    // Ranged-specific advantage (e.g., Archery features)
    if (inferredKind === 'ranged' && hasAdvantageFromEffects(actorActiveEffects, 'ranged_attack_rolls')) {
      extraAdvantage++;
      if (this.debugLogsEnabled) console.log(`[ActionDispatcher] ActiveEffect: attacker has advantage on ranged_attack_rolls`);
    }
    // Attacker's own effects granting disadvantage on attack rolls (e.g., penalty effects)
    if (hasDisadvantageFromEffects(actorActiveEffects, 'attack_rolls')) {
      extraDisadvantage++;
      if (this.debugLogsEnabled) console.log(`[ActionDispatcher] ActiveEffect: attacker has disadvantage on attack_rolls`);
    }
    // Melee-specific disadvantage
    if (inferredKind === 'melee' && hasDisadvantageFromEffects(actorActiveEffects, 'melee_attack_rolls')) {
      extraDisadvantage++;
      if (this.debugLogsEnabled) console.log(`[ActionDispatcher] ActiveEffect: attacker has disadvantage on melee_attack_rolls`);
    }
    // Ranged-specific disadvantage
    if (inferredKind === 'ranged' && hasDisadvantageFromEffects(actorActiveEffects, 'ranged_attack_rolls')) {
      extraDisadvantage++;
      if (this.debugLogsEnabled) console.log(`[ActionDispatcher] ActiveEffect: attacker has disadvantage on ranged_attack_rolls`);
    }
    // Target's effects that affect attacks against them (e.g., Dodge, Faerie Fire, Reckless Attack incoming)
    // Effects with targetCombatantId matching the target grant advantage/disadvantage on attacks against that target
    for (const eff of targetActiveEffects) {
      if (eff.target !== 'attack_rolls' && eff.target !== 'melee_attack_rolls' && eff.target !== 'ranged_attack_rolls') continue;
      // Skip melee-only target effects when attack is ranged (and vice versa)
      if (eff.target === 'melee_attack_rolls' && inferredKind !== 'melee') continue;
      if (eff.target === 'ranged_attack_rolls' && inferredKind !== 'ranged') continue;
      if (eff.targetCombatantId && eff.targetCombatantId !== targetId) continue;
      if (!eff.targetCombatantId) continue; // Skip self-buffs (handled above)
      if (eff.type === 'advantage') {
        extraAdvantage++;
        if (this.debugLogsEnabled) console.log(`[ActionDispatcher] ActiveEffect on target: advantage on attacks against ${targetId} (${eff.source ?? 'unknown'})`);
      }
      if (eff.type === 'disadvantage') {
        extraDisadvantage++;
        if (this.debugLogsEnabled) console.log(`[ActionDispatcher] ActiveEffect on target: disadvantage on attacks against ${targetId} (${eff.source ?? 'unknown'})`);
      }
    }

    // Vex mastery: consume until_triggered advantage effect (one-use)
    const actorNormRes = normalizeResources(actorCombatant.resources);
    const vexEffect = actorActiveEffects.find(
      e => e.source === 'Vex' && e.type === 'advantage' && e.duration === 'until_triggered'
        && e.targetCombatantId === targetId
    );
    if (vexEffect) {
      extraAdvantage++;
      // Consume the Vex effect by removing it
      const updatedRes = removeActiveEffectById(actorCombatant.resources ?? {}, vexEffect.id);
      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: updatedRes as any,
      });
      if (this.debugLogsEnabled) console.log(`[ActionDispatcher] Vex mastery (ActiveEffect): +1 advantage vs ${targetId}`);
    }

    const rollMode = deriveRollModeFromConditions(attackerConditions, targetConditions, inferredKind, extraAdvantage, extraDisadvantage);

    // Parse attack enhancement declarations via class combat text profiles
    // Only match "onDeclare" enhancements — "onHit" enhancements (Stunning Strike, Divine Smite, OHT)
    // are offered post-hit and opted into via damage roll text (2024 rules).
    const normalizedRes = normalizeResources(actorCombatant.resources);
    const resourcePools = getResourcePools(normalizedRes);
    const attackEnhancements = matchAttackEnhancements(
      text, inferredKind, actorClassName, actorLevel,
      normalizedRes, resourcePools, getAllCombatTextProfiles(),
      "onDeclare",
    );

    const pendingAction: AttackPendingAction = {
      type: "ATTACK",
      timestamp: new Date(),
      actorId,
      attacker: actorId,
      target: targetId,
      targetId,
      weaponSpec,
      rollMode,
      ...(coverACBonus > 0 ? { coverACBonus } : {}),
    };

    await this.deps.combatRepo.setPendingAction(encounterId, pendingAction);

    const attackerName = actorChar?.name ?? "The attacker";
    const narration = await this.eventEmitter.generateNarration("attackRequest", {
      attackerName,
      targetName: (target as any).name,
      weaponName: weaponSpec.name,
    });

    const rollModeText = rollMode === "advantage"
      ? " with advantage (roll 2d20, take higher)"
      : rollMode === "disadvantage"
        ? " with disadvantage (roll 2d20, take lower)"
        : "";
    const rollMessage = `Roll a d20${rollModeText} for attack against ${(target as any).name} (no modifiers; server applies bonuses).`;

    return {
      requiresPlayerInput: true,
      type: "REQUEST_ROLL",
      rollType: "attack",
      message: rollMessage,
      narration,
      diceNeeded: "d20",
      pendingAction,
      actionComplete: false,
      advantage: rollMode === "advantage",
      disadvantage: rollMode === "disadvantage",
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Use Item (potions, consumables)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Handle "use/drink <item>" action.
   * D&D 5e 2024: Drinking a potion costs an Action.
   * The item is consumed from the combatant's inventory.
   */
  private async handleUseItemAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    itemName: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    return this.interactionHandlers.handleUseItemAction(sessionId, encounterId, actorId, itemName, roster);
  }
}
