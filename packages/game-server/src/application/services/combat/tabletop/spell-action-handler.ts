/**
 * SpellActionHandler - Resolves spell casting in tabletop combat.
 *
 * Thin facade that handles spell slot spending + concentration management,
 * then delegates to a registry of SpellDeliveryHandler strategies:
 *
 *   1. Spell attack roll (Fire Bolt, etc.)     -> SpellAttackDeliveryHandler
 *   2. Healing (Cure Wounds, Healing Word)     -> HealingSpellDeliveryHandler
 *   3. Save-based (Burning Hands, Hold Person) -> SaveSpellDeliveryHandler
 *   4. Zone (Spirit Guardians, Spike Growth)   -> ZoneSpellDeliveryHandler
 *   5. Buff/debuff (Bless, Shield of Faith)    -> BuffDebuffSpellDeliveryHandler
 *   6. Simple (Magic Missile)                  -> inline fallback
 *
 * Extracted from TabletopCombatService (Phase 3, Step 15).
 * Decomposed into strategy pattern (Phase 3, Section 2.4).
 *
 * Spell preparation logic (slot spending + concentration) is extracted into
 * `helpers/spell-slot-manager.ts` so the AI path can share the same bookkeeping.
 * See `ai-action-executor.ts executeCastSpell()` for how the AI path consumes it.
 */

import { ValidationError } from "../../../errors.js";
import { findPreparedSpellInSheet, prepareSpellCast } from "../helpers/spell-slot-manager.js";
import { inferActorRef } from "./combat-text-parser.js";
import { SavingThrowResolver } from "./saving-throw-resolver.js";
import type { TabletopEventEmitter } from "./tabletop-event-emitter.js";
import type { LlmRoster } from "../../../commands/game-command.js";
import type { TabletopCombatServiceDeps, ActionParseResult } from "./tabletop-types.js";
import type { SessionCharacterRecord } from "../../../types.js";
import {
  SpellAttackDeliveryHandler,
  HealingSpellDeliveryHandler,
  SaveSpellDeliveryHandler,
  ZoneSpellDeliveryHandler,
  BuffDebuffSpellDeliveryHandler,
} from "./spell-delivery/index.js";
import type {
  SpellDeliveryHandler,
  SpellDeliveryDeps,
  SpellCastingContext,
} from "./spell-delivery/index.js";

export class SpellActionHandler {
  private readonly savingThrowResolver: SavingThrowResolver | null;
  private readonly deliveryHandlers: SpellDeliveryHandler[];

  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly eventEmitter: TabletopEventEmitter,
    private readonly debugLogsEnabled: boolean,
  ) {
    this.savingThrowResolver = deps.diceRoller
      ? new SavingThrowResolver(deps.combatRepo, deps.diceRoller, debugLogsEnabled)
      : null;

    const handlerDeps: SpellDeliveryDeps = {
      deps,
      eventEmitter,
      debugLogsEnabled,
      savingThrowResolver: this.savingThrowResolver,
    };

    // Order matches the original priority chain
    this.deliveryHandlers = [
      new SpellAttackDeliveryHandler(handlerDeps),
      new HealingSpellDeliveryHandler(handlerDeps),
      new SaveSpellDeliveryHandler(handlerDeps),
      new ZoneSpellDeliveryHandler(handlerDeps),
      new BuffDebuffSpellDeliveryHandler(handlerDeps),
    ];
  }

  /** Resolve encounter, combatants, and actor combatant in one call. */
  private async resolveEncounterContext(sessionId: string, actorId: string) {
    const encounters = await this.deps.combatRepo.listEncountersBySession(sessionId);
    const encounter = encounters.find((e: any) => e.status === "Active") ?? encounters[0];
    if (!encounter) throw new ValidationError("No active encounter");

    const combatants = await this.deps.combatRepo.listCombatants(encounter.id);
    const actorCombatant = combatants.find(
      (c: any) => c.characterId === actorId || c.monsterId === actorId || c.npcId === actorId,
    );

    return { encounter, combatants, actorCombatant };
  }

  /**
   * Handle Cast Spell action with spell slot management and mechanical resolution.
   */
  async handleCastSpell(
    sessionId: string,
    encounterId: string,
    actorId: string,
    castInfo: { spellName: string; targetName?: string },
    characters: SessionCharacterRecord[],
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = inferActorRef(actorId, roster);

    // Look up spell info from the caster's character sheet
    const character = characters.find((c) => c.id === actorId);
    const sheet = character && typeof character.sheet === "object" ? character.sheet : null;

    // Find the spell by name (case-insensitive) using shared lookup helper
    const spellMatch = findPreparedSpellInSheet(sheet, castInfo.spellName);
    const spellLevel = spellMatch?.level ?? 0;
    const isConcentration = spellMatch?.concentration ?? false;

    // Spend spell slot + manage concentration using shared helper
    // (shared with AI path in helpers/spell-slot-manager.ts)
    if (spellLevel > 0) {
      const { encounter, actorCombatant } = await this.resolveEncounterContext(sessionId, actorId);
      if (actorCombatant) {
        await prepareSpellCast(
          actorCombatant.id,
          encounter.id,
          castInfo.spellName,
          spellLevel,
          isConcentration,
          this.deps.combatRepo,
          this.debugLogsEnabled ? (msg) => console.log(`[SpellActionHandler] ${msg}`) : undefined,
        );
      }
    }

    // Dispatch to delivery handler if spell was found and has a matching handler
    if (spellMatch) {
      const handler = this.deliveryHandlers.find((h) => h.canHandle(spellMatch));
      if (handler) {
        // Resolve encounter context AFTER slot spending so resources reflect the deduction
        const { encounter, combatants, actorCombatant } = await this.resolveEncounterContext(
          sessionId,
          actorId,
        );
        const ctx: SpellCastingContext = {
          sessionId,
          encounterId,
          actorId,
          castInfo,
          spellMatch,
          spellLevel,
          isConcentration,
          sheet,
          characters,
          actor,
          roster,
          encounter,
          combatants,
          actorCombatant,
        };
        return handler.handle(ctx);
      }
    }

    // --- Simple spell (Magic Missile, unknown spells, etc.) ---
    await this.deps.actions.castSpell(sessionId, {
      encounterId,
      actor,
      spellName: castInfo.spellName,
    });

    const targetNote = castInfo.targetName ? ` at ${castInfo.targetName}` : "";
    const slotNote = spellLevel > 0 ? ` (level ${spellLevel} slot spent)` : "";

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: `Cast ${castInfo.spellName}${targetNote}.${slotNote}`,
    };
  }
}
