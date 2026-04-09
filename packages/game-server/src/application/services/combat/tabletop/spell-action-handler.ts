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
import { resolveSpell, prepareSpellCast } from "../helpers/spell-slot-manager.js";
import { applyKoEffectsIfNeeded } from "../helpers/ko-handler.js";
import { normalizeResources, getPosition } from "../helpers/resource-utils.js";
import { findCombatantByEntityId } from "../helpers/combatant-lookup.js";
import { calculateDistance } from "../../../../domain/rules/movement.js";
import { inferActorRef, findCombatantByName } from "./combat-text-parser.js";
import { SavingThrowResolver } from "./rolls/saving-throw-resolver.js";
import { getCanonicalSpell } from "../../../../domain/entities/spells/catalog/index.js";
import { readConditionNames, getConditionEffects } from "../../../../domain/entities/combat/conditions.js";
import type { Condition } from "../../../../domain/entities/combat/conditions.js";
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
    const actorCombatant = findCombatantByEntityId(combatants, actorId);

    return { encounter, combatants, actorCombatant };
  }

  /**
   * Handle Cast Spell action with spell slot management and mechanical resolution.
   */
  async handleCastSpell(
    sessionId: string,
    encounterId: string,
    actorId: string,
    castInfo: { spellName: string; targetName?: string; castAtLevel?: number },
    characters: SessionCharacterRecord[],
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = inferActorRef(actorId, roster);

    // Look up spell info from the caster's character sheet
    const character = characters.find((c) => c.id === actorId);
    const sheet = character && typeof character.sheet === "object" ? character.sheet : null;

    // Find the spell by name (case-insensitive) using shared lookup helper
    const spellMatch = resolveSpell(castInfo.spellName, sheet);
    const spellLevel = spellMatch?.level ?? 0;
    const isConcentration = spellMatch?.concentration ?? false;
    const isBonusAction = spellMatch?.isBonusAction ?? false;
    const isCantrip = spellLevel === 0;

    // Determine effective cast level (for upcasting)
    const castAtLevel = castInfo.castAtLevel;
    if (castAtLevel != null) {
      if (isCantrip) {
        throw new ValidationError("Cantrips cannot be upcast");
      }
      if (castAtLevel < spellLevel) {
        throw new ValidationError(
          `Cannot cast a level ${spellLevel} spell using a level ${castAtLevel} slot`,
        );
      }
      if (castAtLevel > 9) {
        throw new ValidationError(`Spell slot level cannot exceed 9 (got ${castAtLevel})`);
      }
    }
    const effectiveCastLevel = castAtLevel ?? spellLevel;
    const targetRef = castInfo.targetName ? findCombatantByName(castInfo.targetName, roster) : undefined;

    // D&D 5e 2024: Spell component enforcement
    // Verbal component: blocked by any condition that sets cannotSpeak (Stunned, Paralyzed, Petrified, Unconscious)
    // TODO: SS-M9 — Check if caster is in a Silence zone effect (requires zone position lookup)
    // TODO: SS-M9 — Somatic component enforcement (free hand check — too complex with current equipment tracking)
    // TODO: SS-M9 — Subtle Spell metamagic (Sorcerer) should bypass V/S requirements; no metamagic system yet
    {
      const canonical = getCanonicalSpell(castInfo.spellName);
      const hasVerbalComponent = canonical?.components?.v ?? (spellMatch as any)?.components?.v ?? false;
      if (hasVerbalComponent) {
        const { actorCombatant: componentCheckCombatant } = await this.resolveEncounterContext(sessionId, actorId);
        if (componentCheckCombatant) {
          const conditionNames = readConditionNames(componentCheckCombatant.conditions);
          const cannotSpeak = conditionNames.some((name) => {
            const effects = getConditionEffects(name as Condition);
            return effects.cannotSpeak;
          });
          if (cannotSpeak) {
            throw new ValidationError(
              `Cannot cast ${castInfo.spellName} — verbal component required but caster cannot speak (${conditionNames.filter((name) => getConditionEffects(name as Condition).cannotSpeak).join(", ")})`,
            );
          }
        }
      }
    }

    // D&D 5e 2024: Bonus action spell restriction
    // If a bonus action spell (leveled) was cast this turn, only cantrips as action spells.
    // If a leveled action spell was cast this turn, only cantrip bonus action spells allowed.
    {
      const { actorCombatant: checkCombatant } = await this.resolveEncounterContext(sessionId, actorId);
      if (checkCombatant) {
        const res = normalizeResources(checkCombatant.resources);
        if (isBonusAction && !isCantrip && res.actionSpellCastThisTurn === true) {
          throw new ValidationError(
            "Cannot cast a leveled bonus action spell — a leveled action spell was already cast this turn.",
          );
        }
        if (!isBonusAction && !isCantrip && res.bonusActionSpellCastThisTurn === true) {
          throw new ValidationError(
            "Cannot cast a leveled action spell — a leveled bonus action spell was already cast this turn. Only cantrips are allowed.",
          );
        }
      }
    }

    // D&D 5e 2024: Spell range validation
    // Validate that the target is within the spell's range before proceeding.
    // Self-range spells skip validation (they may affect other creatures via AoE).
    if (spellMatch?.range !== undefined && spellMatch.range !== 'self' && castInfo.targetName) {
      const { combatants: rangeCombatants, actorCombatant: rangeActor } =
        await this.resolveEncounterContext(sessionId, actorId);
      if (rangeActor) {
        const rangeTargetRef = findCombatantByName(castInfo.targetName, roster);
        if (rangeTargetRef) {
          const rangeTargetId =
            (rangeTargetRef as any).characterId ??
            (rangeTargetRef as any).monsterId ??
            (rangeTargetRef as any).npcId;
          const rangeTarget = findCombatantByEntityId(rangeCombatants, rangeTargetId);
          if (rangeTarget) {
            const casterPos = getPosition(normalizeResources(rangeActor.resources ?? {}));
            const targetPos = getPosition(normalizeResources(rangeTarget.resources ?? {}));
            if (casterPos && targetPos) {
              const maxRange = spellMatch.range === 'touch' ? 5 : spellMatch.range;
              const distance = calculateDistance(casterPos, targetPos);
              if (distance > maxRange) {
                const rangeLabel = spellMatch.range === 'touch' ? 'Touch (5 ft)' : `${spellMatch.range} ft`;
                throw new ValidationError(
                  `${castInfo.spellName} has a range of ${rangeLabel}. ${castInfo.targetName} is ${Math.round(distance)} ft away.`,
                );
              }
            }
          }
        }
      }
    }

    // Two-phase spell reactions: allow Counterspell opportunities on player-cast spells.
    // If reactions are available, we pause the spell resolution and wait for responses.
    const initiateResult = await this.deps.twoPhaseActions.initiateSpellCast(sessionId, {
      encounterId,
      actor,
      spellName: castInfo.spellName,
      spellLevel: effectiveCastLevel,
      target: targetRef ?? undefined,
    });

    if (initiateResult.status === "awaiting_reactions" && initiateResult.pendingActionId) {
      const { encounter, actorCombatant } = await this.resolveEncounterContext(sessionId, actorId);
      const pendingSpellReaction = await this.deps.pendingActions.getById(initiateResult.pendingActionId);

      // Spell slot is consumed on cast attempt (even if counterspelled), same as AI flow.
      if (spellLevel > 0 && actorCombatant) {
        await prepareSpellCast(
          actorCombatant.id,
          encounter.id,
          castInfo.spellName,
          spellLevel,
          isConcentration,
          this.deps.combatRepo,
          this.debugLogsEnabled ? (msg) => console.log(`[SpellActionHandler] ${msg}`) : undefined,
          castAtLevel,
        );

        // Track bonus action spell restriction for leveled spells.
        if (!isCantrip) {
          const freshCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
          const fresh = freshCombatants.find((c) => c.id === actorCombatant.id);
          if (fresh) {
            const res = normalizeResources(fresh.resources);
            const flag = isBonusAction ? "bonusActionSpellCastThisTurn" : "actionSpellCastThisTurn";
            await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
              resources: { ...res, [flag]: true } as any,
            });
          }
        }
      }

      // Spending your action happens when the spell is attempted, before reaction resolution.
      await this.deps.actions.castSpell(sessionId, {
        encounterId,
        actor,
        spellName: castInfo.spellName,
      });

      await this.deps.combatRepo.setPendingAction(encounter.id, {
        id: initiateResult.pendingActionId,
        type: "reaction_pending",
        pendingActionId: initiateResult.pendingActionId,
        reactionType: "counterspell",
        spellName: castInfo.spellName,
        spellLevel: effectiveCastLevel,
      } as any);

      const byCombatantId = new Map(
        initiateResult.counterspellOpportunities.map((o) => [o.combatantId, o]),
      );
      const reactionChoices =
        pendingSpellReaction?.reactionOpportunities.map((opp) => {
          const info = byCombatantId.get(opp.combatantId);
          return {
            combatantId: opp.combatantId,
            combatantName: info?.combatantName ?? opp.combatantId,
            opportunityId: opp.id,
            canUse: opp.canUse,
            hasReaction: info?.hasReaction ?? true,
            hasSpellSlot: info?.hasSpellSlot ?? true,
          };
        }) ?? [];

      return {
        requiresPlayerInput: false,
        actionComplete: false,
        type: "REACTION_CHECK",
        pendingActionId: initiateResult.pendingActionId,
        opportunityAttacks: reactionChoices,
        message: `Counterspell reactions available. Resolve reactions before ${castInfo.spellName} resolves.`,
      };
    }

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
          castAtLevel,
        );

        // Track bonus action spell restriction (D&D 5e 2024)
        if (!isCantrip) {
          const freshCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
          const fresh = freshCombatants.find((c) => c.id === actorCombatant.id);
          if (fresh) {
            const res = normalizeResources(fresh.resources);
            const flag = isBonusAction ? "bonusActionSpellCastThisTurn" : "actionSpellCastThisTurn";
            await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
              resources: { ...res, [flag]: true } as any,
            });
          }
        }
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
          castAtLevel: effectiveCastLevel,
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

      // Warn when a known spell has no delivery handler — likely missing effects[], damage, or healing definition
      console.warn(
        `[SpellActionHandler] [WARN] Spell '${spellMatch.name}' has no effects defined — no mechanical changes applied. Check the spell catalog definition.`,
      );
    }

    // --- Simple spell (Magic Missile, unknown spells, etc.) ---

    // Magic Missile: 3 darts at 1d4+1 force each at level 1, +1 dart per upcasted level
    const isMagicMissile = castInfo.spellName.toLowerCase() === "magic missile";
    if (isMagicMissile && this.deps.diceRoller && castInfo.targetName) {
      const { encounter, combatants } = await this.resolveEncounterContext(sessionId, actorId);
      const targetRef = findCombatantByName(castInfo.targetName, roster);
      if (targetRef) {
        const targetId =
          (targetRef as any).characterId ?? (targetRef as any).monsterId ?? (targetRef as any).npcId;
        const targetCombatant = findCombatantByEntityId(combatants, targetId);
        if (targetCombatant) {
          const dartCount = 3 + Math.max(0, effectiveCastLevel - 1);
          let totalDamage = 0;
          const dartRolls: number[] = [];
          for (let i = 0; i < dartCount; i++) {
            const roll = this.deps.diceRoller.rollDie(4, 1, 1);
            dartRolls.push(roll.total);
            totalDamage += roll.total;
          }

          const hpBefore = targetCombatant.hpCurrent;
          const hpAfter = Math.max(0, hpBefore - totalDamage);
          await this.deps.combatRepo.updateCombatantState(targetCombatant.id, { hpCurrent: hpAfter });
          await applyKoEffectsIfNeeded(targetCombatant, hpBefore, hpAfter, this.deps.combatRepo);

          // Mark action spent
          await this.deps.actions.castSpell(sessionId, {
            encounterId,
            actor,
            spellName: castInfo.spellName,
          });

          // Check victory
          if (hpAfter <= 0 && this.deps.victoryPolicy) {
            const allCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
            const result = await this.deps.victoryPolicy.evaluate({ combatants: allCombatants });
            if (result) {
              await this.deps.combatRepo.updateEncounter(encounter.id, { status: result });
            }
          }

          const slotNote = effectiveCastLevel > 0 ? ` (level ${effectiveCastLevel} slot spent)` : "";
          return {
            requiresPlayerInput: false,
            actionComplete: true,
            type: "SIMPLE_ACTION_COMPLETE",
            action: "CastSpell",
            message: `Cast Magic Missile at ${castInfo.targetName}.${slotNote} ${dartCount} darts (${dartRolls.map((r) => `1d4+1=${r}`).join(", ")}) = ${totalDamage} force damage. HP: ${hpBefore} → ${hpAfter}.`,
          };
        }
      }
    }

    await this.deps.actions.castSpell(sessionId, {
      encounterId,
      actor,
      spellName: castInfo.spellName,
    });

    const targetNote = castInfo.targetName ? ` at ${castInfo.targetName}` : "";
    const slotNote = effectiveCastLevel > 0 ? ` (level ${effectiveCastLevel} slot spent)` : "";

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "CastSpell",
      message: `Cast ${castInfo.spellName}${targetNote}.${slotNote}`,
    };
  }
}
