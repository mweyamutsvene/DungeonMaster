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
import { resolveSpell, prepareSpellCast, validateUpcast } from "../helpers/spell-slot-manager.js";
import { applyKoEffectsIfNeeded } from "../helpers/ko-handler.js";
import { normalizeResources, getPosition, patchResources, getResourcePools } from "../helpers/resource-utils.js";
import { findCombatantByEntityId } from "../helpers/combatant-lookup.js";
import { buildCombatResources } from "../../../../domain/entities/classes/combat-resource-builder.js";
import { getEntityIdFromRef } from "../helpers/combatant-ref.js";
import { calculateDistance } from "../../../../domain/rules/movement.js";
import { getSpellCasterType, isSpellAvailable } from "../../../../domain/rules/spell-preparation.js";
import { inferActorRef, findCombatantByName } from "./combat-text-parser.js";
import { applyDamageDefenses, extractDamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import { SavingThrowResolver } from "./rolls/saving-throw-resolver.js";
import { getCanonicalSpell } from "../../../../domain/entities/spells/catalog/index.js";
import { parseMaterialComponent } from "../../../../domain/entities/spells/catalog/material-component.js";
import { processSpellCastSideEffects } from "./spell-cast-side-effect-processor.js";
import { readConditionNames, getConditionEffects } from "../../../../domain/entities/combat/conditions.js";
import type { Condition } from "../../../../domain/entities/combat/conditions.js";
import type { TabletopEventEmitter } from "./tabletop-event-emitter.js";
import type { LlmRoster } from "../../../commands/game-command.js";
import type { TabletopCombatServiceDeps, ActionParseResult } from "./tabletop-types.js";
import type { SessionCharacterRecord, JsonValue } from "../../../types.js";
import type { CharacterSheet } from "../helpers/hydration-types.js";
import {
  SpellAttackDeliveryHandler,
  HealingSpellDeliveryHandler,
  SaveSpellDeliveryHandler,
  ZoneSpellDeliveryHandler,
  BuffDebuffSpellDeliveryHandler,
  DispelMagicDeliveryHandler,
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

    // Order matches the original priority chain.
    // DispelMagicDeliveryHandler goes first because it matches by spell name — it prevents
    // Dispel Magic from being misrouted to BuffDebuffSpellDeliveryHandler's catch-all.
    this.deliveryHandlers = [
      new DispelMagicDeliveryHandler(handlerDeps),
      new SpellAttackDeliveryHandler(handlerDeps),
      new HealingSpellDeliveryHandler(handlerDeps),
      new SaveSpellDeliveryHandler(handlerDeps),
      new ZoneSpellDeliveryHandler(handlerDeps),
      new BuffDebuffSpellDeliveryHandler(handlerDeps),
    ];
  }

  /**
   * Run `onCastSideEffects` processing on a successful cast (C-R2-1 single
   * wrapper call site). No-op for spells without side effects or for results
   * that didn't actually complete (REACTION_CHECK, etc.).
   */
  private async finalizeSpellCast<T extends ActionParseResult>(
    spellMatch: { readonly onCastSideEffects?: unknown; readonly name: string } | null,
    casterCharId: string,
    characters: SessionCharacterRecord[],
    actorCombatant: { readonly id: string; readonly resources?: unknown } | null,
    sessionId: string,
    encounterId: string,
    result: T,
  ): Promise<T> {
    const sideEffects = (spellMatch as { readonly onCastSideEffects?: readonly unknown[] } | null)?.onCastSideEffects;
    if (!sideEffects || !Array.isArray(sideEffects) || sideEffects.length === 0) return result;
    if (!result.actionComplete) return result;

    const caster = characters.find((c) => c.id === casterCharId) ?? null;
    await processSpellCastSideEffects({
      spell: spellMatch as unknown as import("../../../../domain/entities/spells/prepared-spell-definition.js").PreparedSpellDefinition,
      caster,
      actorCombatant,
      encounterId,
      sessionId,
      charactersRepo: this.deps.characters,
      combatRepo: this.deps.combatRepo,
      eventsRepo: this.deps.events,
    });
    return result;
  }

  /**
   * Lazily initialize resource pools for a combatant that entered combat without rolling
   * initiative (e.g. action taken before initiative or pre-fix session state).
   * Only writes to DB if `resourcePools` is currently absent.
   */
  private async ensureResourcePoolsInitialized(
    combatantId: string,
    encounterId: string,
    character: SessionCharacterRecord | undefined,
  ): Promise<void> {
    if (!character) return;
    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const combatant = combatants.find((c) => c.id === combatantId);
    if (!combatant) return;
    const existingPools = getResourcePools(combatant.resources);
    if (existingPools.length > 0) return; // already initialized

    const sheet = (typeof character.sheet === "object" && character.sheet !== null ? character.sheet : {}) as Record<string, unknown>;
    const classLevels = Array.isArray((sheet as any).classLevels) ? (sheet as any).classLevels : undefined;
    const combatRes = buildCombatResources({
      className: character.className ?? "",
      level: character.level ?? 1,
      sheet: sheet as any,
      classLevels,
    });
    if (combatRes.resourcePools.length === 0) return;
    const normalized = normalizeResources(combatant.resources);
    await this.deps.combatRepo.updateCombatantState(combatantId, {
      resources: { ...normalized, resourcePools: combatRes.resourcePools } as import("../../../types.js").JsonValue,
    });
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

  private readSpellList(sheet: CharacterSheet | null, key: "preparedSpells" | "knownSpells") {
    if (!sheet) return undefined;
    const raw = (sheet as Record<string, unknown>)[key];
    return Array.isArray(raw) ? raw as Array<string | { name: string }> : undefined;
  }

  /**
   * Handle Cast Spell action with spell slot management and mechanical resolution.
   */
  async handleCastSpell(
    sessionId: string,
    encounterId: string,
    actorId: string,
    castInfo: { spellName: string; targetName?: string; castAtLevel?: number; isBonusActionFromText?: boolean; bypassTwoSpellRule?: boolean },
    characters: SessionCharacterRecord[],
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = inferActorRef(actorId, roster);

    // Look up spell info from the caster's character sheet
    const character = characters.find((c) => c.id === actorId);
    const sheet = (character && typeof character.sheet === "object" ? character.sheet : null) as CharacterSheet | null;

    // Ensure sheet.level is populated from the character record (DB column is always set,
    // but the sheet JSON blob may omit it — affects cantrip scaling and multi-attack count)
    if (sheet && character && sheet.level == null) {
      (sheet as Record<string, unknown>).level = character.level;
    }

    // Find the spell by name (case-insensitive) using shared lookup helper
    const spellMatch = resolveSpell(castInfo.spellName, sheet);
    const spellLevel = spellMatch?.level ?? 0;
    const isConcentration = spellMatch?.concentration ?? false;
    const isBonusAction = spellMatch?.isBonusAction ?? castInfo.isBonusActionFromText ?? false;
    const isCantrip = spellLevel === 0;

    const classIdRaw = (sheet as Record<string, unknown> | null)?.classId;
    const classId =
      (typeof classIdRaw === "string" && classIdRaw.trim().length > 0
        ? classIdRaw.trim().toLowerCase()
        : character?.className?.toLowerCase()) ?? "";
    const casterType = classId.length > 0 ? getSpellCasterType(classId) : "none";
    if (!isCantrip && casterType !== "none") {
      const preparedSpells = this.readSpellList(sheet, "preparedSpells");
      const knownSpells = this.readSpellList(sheet, "knownSpells");
      const spellName = spellMatch?.name ?? castInfo.spellName;

      if (!isSpellAvailable(spellName, preparedSpells, knownSpells)) {
        throw new ValidationError(`${spellName} is not prepared. Prepare spells during a Long Rest.`);
      }
    }

    // Determine effective cast level (for upcasting)
    const castAtLevel = castInfo.castAtLevel;
    validateUpcast(spellLevel, castAtLevel, isCantrip);
    const effectiveCastLevel = castAtLevel ?? spellLevel;
    const targetRef = castInfo.targetName ? findCombatantByName(castInfo.targetName, roster) : undefined;

    // Resolve encounter context once up front to avoid redundant DB round-trips.
    // Later steps that modify combatant state will re-fetch combatants as needed.
    const { encounter, combatants, actorCombatant } = await this.resolveEncounterContext(sessionId, actorId);

    // D&D 5e 2024: Spell component enforcement
    // Verbal component: blocked by any condition that sets cannotSpeak (Stunned, Paralyzed, Petrified, Unconscious)
    // TODO: SS-M9 — Check if caster is in a Silence zone effect (requires zone position lookup)
    // TODO: SS-M9 — Somatic component enforcement (free hand check — too complex with current equipment tracking)
    // TODO: SS-M9 — Subtle Spell metamagic (Sorcerer) should bypass V/S requirements; no metamagic system yet
    {
      const canonical = getCanonicalSpell(castInfo.spellName);
      const hasVerbalComponent = canonical?.components?.v ?? false;
      if (hasVerbalComponent) {
        if (actorCombatant) {
          const conditionNames = readConditionNames(actorCombatant.conditions);
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

      // D&D 5e 2024: Material component enforcement.
      // All costed components (costGp > 0) require the caster to have the item in inventory.
      // Consumed components are removed from inventory at cast time.
      // Enforcement is skipped when inventoryService is not provided (test environments).
      const material = parseMaterialComponent(canonical?.components?.m);
      if (material?.costGp && material.costGp > 0 && this.deps.inventoryService) {
        const check = await this.deps.inventoryService.findItemMatchingComponent(
          sessionId,
          actorId,
          material,
        );
        if (!check.found) {
          throw new ValidationError(
            `Cannot cast ${castInfo.spellName} — required material component: ${material.description}`,
          );
        }
        if (material.consumed) {
          await this.deps.inventoryService.consumeMaterialComponent(
            sessionId,
            actorId,
            material,
          );
        }
      }
    }

    // D&D 5e 2024: Bonus action spell restriction
    // If a bonus action spell (leveled) was cast this turn, only cantrips as action spells.
    // If a leveled action spell was cast this turn, only cantrip bonus action spells allowed.
    //
    // Quickened Spell metamagic (sorcerer) bypasses this rule when converting
    // an action spell into a bonus action spell.
    if (!castInfo.bypassTwoSpellRule) {
      if (actorCombatant) {
        const res = normalizeResources(actorCombatant.resources);
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
      if (actorCombatant) {
        const rangeTargetRef = findCombatantByName(castInfo.targetName, roster);
        if (rangeTargetRef) {
          const rangeTargetId = getEntityIdFromRef(rangeTargetRef);
          const rangeTarget = findCombatantByEntityId(combatants, rangeTargetId);
          if (rangeTarget) {
            const casterPos = getPosition(normalizeResources(actorCombatant.resources ?? {}));
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
      const pendingSpellReaction = await this.deps.pendingActions.getById(initiateResult.pendingActionId);

      // Spell slot is consumed on cast attempt (even if counterspelled), same as AI flow.
      if (spellLevel > 0 && actorCombatant) {
        await this.ensureResourcePoolsInitialized(actorCombatant.id, encounter.id, character);
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
              resources: patchResources(res, { [flag]: true }),
            });
          }
        }
      }

      // Spending your action happens when the spell is attempted, before reaction resolution.
      await this.deps.actions.castSpell(sessionId, {
        encounterId,
        actor,
        spellName: castInfo.spellName,
        skipActionCheck: isBonusAction,
      });

      // If bonus action spell, mark bonus action used on resources
      if (isBonusAction && actorCombatant) {
        const actorResources = normalizeResources(actorCombatant.resources ?? {});
        await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: patchResources(actorResources, { bonusActionUsed: true }),
        });
      }

      await this.deps.combatRepo.setPendingAction(encounter.id, {
        id: initiateResult.pendingActionId,
        type: "reaction_pending",
        pendingActionId: initiateResult.pendingActionId,
        reactionType: "counterspell",
        spellName: castInfo.spellName,
        spellLevel: effectiveCastLevel,
      } as JsonValue);

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
      if (actorCombatant) {
        await this.ensureResourcePoolsInitialized(actorCombatant.id, encounter.id, character);
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
              resources: patchResources(res, { [flag]: true }),
            });
          }
        }
      }
    }

    // Dispatch to delivery handler if spell was found and has a matching handler
    if (spellMatch) {
      const handler = this.deliveryHandlers.find((h) => h.canHandle(spellMatch));
      if (handler) {
        // Re-fetch combatants after slot spending so resources reflect the deduction
        const freshCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
        const freshActorCombatant = findCombatantByEntityId(freshCombatants, actorId);
        const ctx: SpellCastingContext = {
          sessionId,
          encounterId,
          actorId,
          castInfo,
          spellMatch,
          spellLevel,
          castAtLevel: effectiveCastLevel,
          isConcentration,
          isBonusAction,
          sheet,
          characters,
          actor,
          roster,
          encounter,
          combatants: freshCombatants,
          actorCombatant: freshActorCombatant,
        };
        return this.finalizeSpellCast(
          spellMatch,
          actorId,
          characters,
          freshActorCombatant ?? null,
          sessionId,
          encounter.id,
          await handler.handle(ctx),
        );
      }

      // Warn when a known spell has no delivery handler — likely missing effects[], damage, or healing definition
      console.warn(
        `[SpellActionHandler] [WARN] Spell '${spellMatch.name}' has no effects defined — no mechanical changes applied. Check the spell catalog definition.`,
      );
    }

    // --- Auto-hit spells (Magic Missile, etc.) — catalog-driven via autoHit + dartCount fields ---
    const resolvedSpell = spellMatch ?? getCanonicalSpell(castInfo.spellName);
    if (resolvedSpell?.autoHit && resolvedSpell.dartCount && resolvedSpell.damage && this.deps.diceRoller && castInfo.targetName) {
      const autoHitTargetRef = findCombatantByName(castInfo.targetName, roster);
      if (autoHitTargetRef) {
        const targetId = getEntityIdFromRef(autoHitTargetRef);
        const targetCombatant = findCombatantByEntityId(combatants, targetId);
        if (targetCombatant) {
          const dartCount = resolvedSpell.dartCount + Math.max(0, effectiveCastLevel - resolvedSpell.level);
          const diceSides = resolvedSpell.damage.diceSides;
          const diceCount = resolvedSpell.damage.diceCount;
          const modifier = resolvedSpell.damage.modifier ?? 0;
          let totalDamage = 0;
          const dartRolls: number[] = [];
          for (let i = 0; i < dartCount; i++) {
            const roll = this.deps.diceRoller.rollDie(diceSides, diceCount, modifier);
            dartRolls.push(roll.total);
            totalDamage += roll.total;
          }

          // Apply damage defenses (immunity/resistance/vulnerability)
          const damageType = resolvedSpell.damageType ?? "force";
          if (totalDamage > 0) {
            const allMonsters = await this.deps.monsters.listBySession(sessionId);
            const allNpcs = await this.deps.npcs.listBySession(sessionId);
            const targetMonster = allMonsters.find(m => m.id === targetId);
            const targetChar = characters.find((c) => c.id === targetId);
            const targetNpc = allNpcs.find(n => n.id === targetId);
            const targetStats =
              targetMonster?.statBlock ??
              targetChar?.sheet ??
              targetNpc?.statBlock ??
              {};
            const defenses = extractDamageDefenses(targetStats);
            if (defenses.damageResistances || defenses.damageImmunities || defenses.damageVulnerabilities) {
              const defResult = applyDamageDefenses(totalDamage, damageType, defenses);
              totalDamage = defResult.adjustedDamage;
            }
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
            skipActionCheck: isBonusAction,
          });

          // If bonus action spell, mark bonus action used on resources
          if (isBonusAction && actorCombatant) {
            const actorResources = normalizeResources(actorCombatant.resources ?? {});
            await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
              resources: patchResources(actorResources, { bonusActionUsed: true }),
            });
          }

          // Check victory
          if (hpAfter <= 0 && this.deps.victoryPolicy) {
            const allCombatants = await this.deps.combatRepo.listCombatants(encounter.id);
            const result = await this.deps.victoryPolicy.evaluate({ combatants: allCombatants });
            if (result) {
              await this.deps.combatRepo.updateEncounter(encounter.id, { status: result });
            }
          }

          const diceNotation = `${diceCount}d${diceSides}${modifier ? `+${modifier}` : ""}`;
          const slotNote = effectiveCastLevel > 0 ? ` (level ${effectiveCastLevel} slot spent)` : "";
          return this.finalizeSpellCast(
            spellMatch,
            actorId,
            characters,
            actorCombatant ?? null,
            sessionId,
            encounter.id,
            {
              requiresPlayerInput: false,
              actionComplete: true,
              type: "SIMPLE_ACTION_COMPLETE",
              action: "CastSpell",
              message: `Cast ${castInfo.spellName} at ${castInfo.targetName}.${slotNote} ${dartCount} darts (${dartRolls.map((r) => `${diceNotation}=${r}`).join(", ")}) = ${totalDamage} ${damageType} damage. HP: ${hpBefore} → ${hpAfter}.`,
            },
          );
        }
      }
    }

    await this.deps.actions.castSpell(sessionId, {
      encounterId,
      actor,
      spellName: castInfo.spellName,
      skipActionCheck: isBonusAction,
    });

    // If bonus action spell, mark bonus action used on resources
    if (isBonusAction && actorCombatant) {
      const actorResources = normalizeResources(actorCombatant.resources ?? {});
      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: patchResources(actorResources, { bonusActionUsed: true }),
      });
    }

    const targetNote = castInfo.targetName ? ` at ${castInfo.targetName}` : "";
    const slotNote = effectiveCastLevel > 0 ? ` (level ${effectiveCastLevel} slot spent)` : "";

    return this.finalizeSpellCast(
      spellMatch,
      actorId,
      characters,
      actorCombatant ?? null,
      sessionId,
      encounter.id,
      {
        requiresPlayerInput: false,
        actionComplete: true,
        type: "SIMPLE_ACTION_COMPLETE",
        action: "CastSpell",
        message: `Cast ${castInfo.spellName}${targetNote}.${slotNote}`,
      },
    );
  }
}
