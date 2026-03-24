/**
 * ActionDispatcher â€“ routes parsed combat actions to the correct handler.
 *
 * Extracted from TabletopCombatService to keep action routing and execution
 * logic separate from the public API facade.
 */

import { ValidationError } from "../../../errors.js";
import {
  normalizeResources,
} from "../helpers/resource-utils.js";
import { tryMatchClassAction } from "../../../../domain/entities/classes/combat-text-profile.js";
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
  inferActorRef,
} from "./combat-text-parser.js";

import { TabletopEventEmitter } from "./tabletop-event-emitter.js";
import { SpellActionHandler } from "./spell-action-handler.js";
import { loadRoster } from "./roll-state-machine.js";
import { GrappleHandlers } from "./grapple-handlers.js";
import { InteractionHandlers } from "./interaction-handlers.js";
import { SocialHandlers } from "./social-handlers.js";
import { MovementHandlers } from "./movement-handlers.js";
import { AttackHandlers } from "./attack-handlers.js";
import { ClassAbilityHandlers } from "./class-ability-handlers.js";
import { resolveWeaponMastery } from "../../../../domain/rules/weapon-mastery.js";
import type { ActionParserEntry, DispatchContext } from "./action-parser-chain.js";

import type {
  TabletopCombatServiceDeps,
  ActionParseResult,
} from "./tabletop-types.js";

export class ActionDispatcher {
  private readonly grappleHandlers: GrappleHandlers;
  private readonly interactionHandlers: InteractionHandlers;
  private readonly socialHandlers: SocialHandlers;
  private readonly movementHandlers: MovementHandlers;
  private readonly attackHandlers: AttackHandlers;
  private readonly classAbilityHandlers: ClassAbilityHandlers;
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
    this.movementHandlers = new MovementHandlers(deps, eventEmitter, debugLogsEnabled);
    this.attackHandlers = new AttackHandlers(deps, eventEmitter, debugLogsEnabled);
    this.classAbilityHandlers = new ClassAbilityHandlers(deps, eventEmitter, debugLogsEnabled);
    this.parserChain = this.buildParserChain();
  }

  // ----------------------------------------------------------------
  // Public entry point â€“ replaces TabletopCombatService.parseCombatAction body
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
    const enrichedRoster = await this.attackHandlers.enrichRosterWithDistances(encounterId, actorId, roster);

    console.log(`[ActionDispatcher] No direct parse match â†’ LLM intent for: "${text}"`);
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

    console.log(`[ActionDispatcher] LLM intent â†’ ${command.kind}`, command.kind === "attack"
      ? { target: command.target?.type, spec: (command.spec as Record<string, unknown>)?.name ?? "(none)" }
      : command.kind === "move"
        ? { destination: command.destination }
        : {});

    if (command.kind === "move") {
      return this.movementHandlers.handleMoveAction(sessionId, encounterId, actorId, command.destination, roster);
    }

    if (command.kind === "moveToward") {
      return this.movementHandlers.handleMoveTowardAction(sessionId, encounterId, actorId, command.target, command.desiredRange, roster);
    }

    if (command.kind === "attack") {
      return this.attackHandlers.handleAttackAction(sessionId, encounterId, actorId, text, command, characters, monsters, npcs);
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
  // Parser chain â€“ ordered list of text parsers tried by dispatch()
  // ----------------------------------------------------------------

  private buildParserChain(): ActionParserEntry<any>[] {
    const profiles = getAllCombatTextProfiles();

    return [
      // 1. Move to coordinates
      {
        id: "move",
        tryParse: (text) => tryParseMoveText(text),
        handle: (parsed, ctx) =>
          this.movementHandlers.handleMoveAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed, ctx.roster),
      },

      // 2. Move toward creature
      {
        id: "moveToward",
        tryParse: (text, roster) => tryParseMoveTowardText(text, roster),
        handle: (parsed, ctx) =>
          this.movementHandlers.handleMoveTowardAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.target, parsed.desiredRange, ctx.roster),
      },

      // 3. Jump
      {
        id: "jump",
        tryParse: (text, roster) => tryParseJumpText(text, roster),
        handle: (parsed, ctx) =>
          this.movementHandlers.handleJumpAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed, ctx.characters, ctx.monsters, ctx.roster),
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
            return this.classAbilityHandlers.handleClassAbility(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.abilityId, ctx.characters, ctx.roster);
          }
          return this.classAbilityHandlers.handleBonusAbility(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.abilityId, ctx.text, ctx.characters, ctx.monsters, ctx.npcs, ctx.roster);
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
          return this.classAbilityHandlers.handleBonusAbility(ctx.sessionId, ctx.encounterId, ctx.actorId, "base:bonus:offhand-attack", ctx.text, ctx.characters, ctx.monsters, ctx.npcs, ctx.roster, skipBonusCost);
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
          const targetRef = await this.attackHandlers.resolveAttackTarget(
            ctx.encounterId, ctx.actorId, ctx.roster, parsed.targetName, parsed.nearest,
          );
          const command = {
            kind: "attack" as const,
            attacker: inferActorRef(ctx.actorId, ctx.roster),
            target: targetRef,
          };
          return this.attackHandlers.handleAttackAction(ctx.sessionId, ctx.encounterId, ctx.actorId, ctx.text, command, ctx.characters, ctx.monsters, ctx.npcs);
        },
      },
    ];
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
   * Handle Help action â€“ give ally advantage on next attack against target.
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
   * Handle Shove action â€“ contested athletics check to push or knock prone.
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
   * Handle Grapple action â€“ contested athletics check to apply Grappled condition.
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
   * Handle Hide action â€“ make stealth check to gain Hidden condition.
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
   * Handle the Search action â€” Perception check to reveal Hidden creatures.
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
   * Handle "drop <item>" â€” remove a weapon from the actor's equipment/pickedUpWeapons
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
   * Handle "draw <weapon>" â€” pull a stowed weapon into hand.
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
   * Handle "sheathe <weapon>" â€” stow a drawn weapon.
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
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Use Item (potions, consumables)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
