/**
 * ActionDispatcher – routes parsed combat actions to the correct handler.
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

/** Resolve a CombatantRef to its display name from the roster. */
function resolveRefName(ref: CombatantRef, roster: LlmRoster): string {
  if (ref.type === "Character") {
    const c = roster.characters.find((r) => r.id === ref.characterId);
    if (c) return c.name;
  } else if (ref.type === "Monster") {
    const m = roster.monsters.find((r) => r.id === ref.monsterId);
    if (m) return m.name;
  } else if (ref.type === "NPC") {
    const n = roster.npcs.find((r) => r.id === ref.npcId);
    if (n) return n.name;
  }
  throw new ValidationError("Could not resolve target name from roster");
}
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
  tryParseEndTurnText,
  inferActorRef,
} from "./combat-text-parser.js";

import { TabletopEventEmitter } from "./tabletop-event-emitter.js";
import { SpellActionHandler } from "./spell-action-handler.js";
import { loadRoster } from "./roll-state-machine.js";
import { GrappleHandlers } from "./dispatch/grapple-handlers.js";
import { InteractionHandlers } from "./dispatch/interaction-handlers.js";
import { SocialHandlers } from "./dispatch/social-handlers.js";
import { MovementHandlers } from "./dispatch/movement-handlers.js";
import { AttackHandlers } from "./dispatch/attack-handlers.js";
import { ClassAbilityHandlers } from "./dispatch/class-ability-handlers.js";
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
    const enrichedRoster = await this.attackHandlers.enrichRosterWithDistances(encounterId, actorId, roster);

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

    // -- Simple actions (dash/dodge/disengage) --
    if (command.kind === "simpleAction") {
      return this.socialHandlers.handleSimpleAction(sessionId, encounterId, actorId, command.action, roster);
    }

    // -- Hide --
    if (command.kind === "hide") {
      return this.socialHandlers.handleHideAction(sessionId, encounterId, actorId, characters, roster);
    }

    // -- Search --
    if (command.kind === "search") {
      return this.socialHandlers.handleSearchAction(sessionId, encounterId, actorId, roster);
    }

    // -- Offhand attack --
    if (command.kind === "offhand") {
      return this.classAbilityHandlers.handleBonusAbility(sessionId, encounterId, actorId, "base:bonus:offhand-attack", text, characters, monsters, npcs, roster);
    }

    // -- Escape grapple --
    if (command.kind === "escapeGrapple") {
      return this.grappleHandlers.handleEscapeGrappleAction(sessionId, encounterId, actorId, roster);
    }

    // -- Help --
    if (command.kind === "help") {
      const targetName = resolveRefName(command.target, roster);
      return this.socialHandlers.handleHelpAction(sessionId, encounterId, actorId, targetName, roster);
    }

    // -- Grapple --
    if (command.kind === "grapple") {
      const targetName = resolveRefName(command.target, roster);
      return this.grappleHandlers.handleGrappleAction(sessionId, encounterId, actorId, { targetName }, roster);
    }

    // -- Shove --
    if (command.kind === "shove") {
      const targetName = resolveRefName(command.target, roster);
      return this.grappleHandlers.handleShoveAction(sessionId, encounterId, actorId, { targetName, shoveType: command.shoveType ?? "push" }, roster);
    }

    // -- Cast spell --
    if (command.kind === "castSpell") {
      const targetName = command.target ? resolveRefName(command.target, roster) : undefined;
      return this.spellHandler.handleCastSpell(sessionId, encounterId, actorId, { spellName: command.spellName, targetName, castAtLevel: command.castAtLevel }, characters, roster);
    }

    // -- Class ability --
    if (command.kind === "classAction") {
      // Try to match the ability name through the profile system
      const profiles = getAllCombatTextProfiles();
      const match = tryMatchClassAction(command.abilityName, profiles);
      if (match) {
        if (match.category === "classAction") {
          return this.classAbilityHandlers.handleClassAbility(sessionId, encounterId, actorId, match.abilityId, characters, monsters, npcs, roster, text);
        }
        return this.classAbilityHandlers.handleBonusAbility(sessionId, encounterId, actorId, match.abilityId, text, characters, monsters, npcs, roster);
      }
      throw new ValidationError(`Unknown class ability: "${command.abilityName}". Try using the exact ability name (e.g., "flurry of blows", "action surge").`);
    }

    // -- Item interactions --
    if (command.kind === "pickup") {
      return this.interactionHandlers.handlePickupAction(sessionId, encounterId, actorId, command.itemName, roster);
    }
    if (command.kind === "drop") {
      return this.interactionHandlers.handleDropAction(sessionId, encounterId, actorId, command.itemName, characters, monsters, npcs, roster);
    }
    if (command.kind === "drawWeapon") {
      return this.interactionHandlers.handleDrawWeaponAction(sessionId, encounterId, actorId, command.weaponName, characters, monsters, npcs, roster);
    }
    if (command.kind === "sheatheWeapon") {
      return this.interactionHandlers.handleSheatheWeaponAction(sessionId, encounterId, actorId, command.weaponName, roster);
    }
    if (command.kind === "useItem") {
      return this.interactionHandlers.handleUseItemAction(sessionId, encounterId, actorId, command.itemName, roster);
    }

    // -- End turn --
    if (command.kind === "endTurn") {
      const actor = inferActorRef(actorId, roster);
      await this.deps.combat.endTurn(sessionId, { encounterId, actor });
      return {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "SIMPLE_ACTION_COMPLETE" as const,
        action: "EndTurn",
        message: "Turn ended.",
      };
    }

    // rollResult should not reach here through the tabletop text flow
    throw new ValidationError(`Action type "${command.kind}" is not supported in the tabletop text flow`);
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
            return this.socialHandlers.handleReadyAction(ctx.sessionId, ctx.encounterId, ctx.actorId, ctx.text, ctx.roster);
          }
          return this.socialHandlers.handleSimpleAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed, ctx.roster);
        },
      },

      // 5. Profile-driven class action matching
      {
        id: "classAction",
        tryParse: (text) => tryMatchClassAction(text, profiles),
        handle: (parsed, ctx) => {
          if (parsed.category === "classAction") {
            return this.classAbilityHandlers.handleClassAbility(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.abilityId, ctx.characters, ctx.monsters, ctx.npcs, ctx.roster, ctx.text);
          }
          return this.classAbilityHandlers.handleBonusAbility(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.abilityId, ctx.text, ctx.characters, ctx.monsters, ctx.npcs, ctx.roster);
        },
      },

      // 6. Hide
      {
        id: "hide",
        tryParse: (text) => tryParseHideText(text) ? true : null,
        handle: (_parsed, ctx) =>
          this.socialHandlers.handleHideAction(ctx.sessionId, ctx.encounterId, ctx.actorId, ctx.characters, ctx.roster),
      },

      // 7. Search
      {
        id: "search",
        tryParse: (text) => tryParseSearchText(text) ? true : null,
        handle: (_parsed, ctx) =>
          this.socialHandlers.handleSearchAction(ctx.sessionId, ctx.encounterId, ctx.actorId, ctx.roster),
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
          this.socialHandlers.handleHelpAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed, ctx.roster),
      },

      // 10. Shove
      {
        id: "shove",
        tryParse: (text) => tryParseShoveText(text),
        handle: (parsed, ctx) =>
          this.grappleHandlers.handleShoveAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed, ctx.roster),
      },

      // 11. Escape Grapple
      {
        id: "escapeGrapple",
        tryParse: (text) => tryParseEscapeGrappleText(text),
        handle: (_parsed, ctx) =>
          this.grappleHandlers.handleEscapeGrappleAction(ctx.sessionId, ctx.encounterId, ctx.actorId, ctx.roster),
      },

      // 12. Grapple
      {
        id: "grapple",
        tryParse: (text) => tryParseGrappleText(text),
        handle: (parsed, ctx) =>
          this.grappleHandlers.handleGrappleAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed, ctx.roster),
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
          this.interactionHandlers.handlePickupAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.itemName, ctx.roster),
      },

      // 15. Drop item
      {
        id: "drop",
        tryParse: (text) => tryParseDropText(text),
        handle: (parsed, ctx) =>
          this.interactionHandlers.handleDropAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.itemName, ctx.characters, ctx.monsters, ctx.npcs, ctx.roster),
      },

      // 16. Draw weapon
      {
        id: "drawWeapon",
        tryParse: (text) => tryParseDrawWeaponText(text),
        handle: (parsed, ctx) =>
          this.interactionHandlers.handleDrawWeaponAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.weaponName, ctx.characters, ctx.monsters, ctx.npcs, ctx.roster),
      },

      // 17. Sheathe weapon
      {
        id: "sheatheWeapon",
        tryParse: (text) => tryParseSheatheWeaponText(text),
        handle: (parsed, ctx) =>
          this.interactionHandlers.handleSheatheWeaponAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.weaponName, ctx.roster),
      },

      // 18. Use item
      {
        id: "useItem",
        tryParse: (text) => {
          // "use <ability name>" should route to classAction, not item use.
          // Strip the "use " verb and check if the remainder matches any class ability.
          const stripped = text.replace(/^(?:use|try)\s+/i, "");
          if (stripped !== text && tryMatchClassAction(stripped, profiles)) return null;
          return tryParseUseItemText(text);
        },
        handle: (parsed, ctx) =>
          this.interactionHandlers.handleUseItemAction(ctx.sessionId, ctx.encounterId, ctx.actorId, parsed.itemName, ctx.roster),
      },

      // 19. End turn / pass / done / skip
      {
        id: "endTurn",
        tryParse: (text) => tryParseEndTurnText(text),
        handle: async (_parsed, ctx) => {
          const actor = inferActorRef(ctx.actorId, ctx.roster);
          await this.deps.combat.endTurn(ctx.sessionId, { encounterId: ctx.encounterId, actor });
          return {
            requiresPlayerInput: false,
            actionComplete: true,
            type: "SIMPLE_ACTION_COMPLETE" as const,
            action: "EndTurn",
            message: "Turn ended.",
          };
        },
      },

      // 20. Attack (last because it's the broadest text match)
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
}
