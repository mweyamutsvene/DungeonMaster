/**
 * RollInterruptResolver — detects which interrupt options are available for a
 * given d20 roll and builds the PendingRollInterruptData payload.
 *
 * Invoked after the d20 is rolled but BEFORE hit/save resolution so that the
 * actor (or an ally) can modify the result with Bardic Inspiration, Lucky,
 * Halfling Lucky, Portent, or Cutting Words.
 *
 * Each public method returns an empty array when no options are available,
 * which means the caller continues with normal resolution.
 */

import type { CombatantStateRecord } from "../../../../types.js";
import { getActiveEffects, getResourcePools, normalizeResources } from "../../helpers/resource-utils.js";
import { computeFeatModifiers } from "../../../../../domain/rules/feat-modifiers.js";
import { mergeFightingStyleFeatId } from "../../../../../domain/entities/classes/fighting-style.js";
import { classHasFeature } from "../../../../../domain/entities/classes/registry.js";
import { TACTICAL_MIND } from "../../../../../domain/entities/classes/feature-keys.js";
import type {
  RollInterruptOption,
  PendingRollInterruptData,
  AttackRollResumeContext,
  SaveRollResumeContext,
} from "../../../../../domain/entities/combat/pending-action.js";
import type { AttackPendingAction, SavingThrowPendingAction } from "../tabletop-types.js";

export { RollInterruptOption };

export class RollInterruptResolver {
  constructor(private readonly debugLogsEnabled: boolean = false) {}

  // ─────────────────────── Attack roll options ─────────────────────────────

  /**
   * Find interrupt options available for an attack roll made by `actorCombatant`.
   *
   * @param actorCombatant  - The attacking combatant's state record.
   * @param actorSheet      - The attacker's character sheet (for feats / species).
   * @param rawD20          - The d20 value that was rolled.
   */
  findAttackInterruptOptions(
    actorCombatant: CombatantStateRecord | undefined,
    actorSheet: Record<string, unknown>,
    rawD20: number,
  ): RollInterruptOption[] {
    if (!actorCombatant) return [];
    const options: RollInterruptOption[] = [];

    this._addBardicInspirationOption(actorCombatant, options);
    this._addLuckyFeatOption(actorCombatant, actorSheet, options);
    this._addHalflingLuckyOption(actorSheet, rawD20, options);
    this._addPortentOption(actorCombatant, options);

    if (this.debugLogsEnabled && options.length > 0) {
      console.log(
        `[RollInterruptResolver] Attack interrupt options for ${actorCombatant.id}: ${options.map(o => o.kind).join(", ")}`,
      );
    }

    return options;
  }

  // ─────────────────────── Save roll options ───────────────────────────────

  /**
   * Find interrupt options for a saving throw made by `actorCombatant`.
   * Subset of attack options: BI, Lucky, Halfling Lucky, Portent.
   */
  findSaveInterruptOptions(
    actorCombatant: CombatantStateRecord | undefined,
    actorSheet: Record<string, unknown>,
    rawD20: number,
  ): RollInterruptOption[] {
    // Same option set — saves benefit from the same interrupts as attacks.
    return this.findAttackInterruptOptions(actorCombatant, actorSheet, rawD20);
  }

  // ─────────────────────── Ability check options ───────────────────────────

  /**
   * Find interrupt options available for an ability check made by `actorCombatant`.
   * Includes Tactical Mind (Fighter L2+: spend Second Wind to reroll, take higher).
   */
  findAbilityCheckInterruptOptions(
    actorCombatant: CombatantStateRecord | undefined,
    actorSheet: Record<string, unknown>,
  ): RollInterruptOption[] {
    if (!actorCombatant) return [];
    const options: RollInterruptOption[] = [];
    this._addTacticalMindOption(actorCombatant, actorSheet, options);
    return options;
  }

  // ─────────────────────── Payload builders ────────────────────────────────

  buildAttackInterruptData(
    sessionId: string,
    encounterId: string,
    actorEntityId: string,
    rawD20: number,
    modifier: number,
    totalBeforeInterrupt: number,
    options: RollInterruptOption[],
    originalAttackAction: AttackPendingAction,
  ): PendingRollInterruptData {
    const resumeContext: AttackRollResumeContext = {
      kind: "attack",
      sessionId,
      encounterId,
      actorId: actorEntityId,
      originalAttackAction: { ...originalAttackAction } as Record<string, unknown>,
    };

    return {
      type: "roll_interrupt",
      sessionId,
      actorEntityId,
      rollKind: "attack",
      rawRoll: [rawD20],
      modifier,
      totalBeforeInterrupt,
      options,
      resumeContext,
    };
  }

  buildSaveInterruptData(
    sessionId: string,
    encounterId: string,
    actorEntityId: string,
    rawD20: number,
    modifier: number,
    totalBeforeInterrupt: number,
    options: RollInterruptOption[],
    originalSaveAction: SavingThrowPendingAction,
  ): PendingRollInterruptData {
    const resumeContext: SaveRollResumeContext = {
      kind: "save",
      sessionId,
      encounterId,
      actorId: actorEntityId,
      originalSaveAction: { ...originalSaveAction } as Record<string, unknown>,
    };

    return {
      type: "roll_interrupt",
      sessionId,
      actorEntityId,
      rollKind: "save",
      rawRoll: [rawD20],
      modifier,
      totalBeforeInterrupt,
      options,
      resumeContext,
    };
  }

  // ─────────────────────── Private helpers ─────────────────────────────────

  private _addBardicInspirationOption(
    combatant: CombatantStateRecord,
    out: RollInterruptOption[],
  ): void {
    const effects = getActiveEffects(combatant.resources);
    const biEffect = effects.find(
      e =>
        e.source === "Bardic Inspiration"
        && e.target === "custom"
        && e.duration === "until_triggered"
        && e.diceValue != null,
    );
    if (biEffect?.diceValue) {
      out.push({
        kind: "bardic-inspiration",
        effectId: biEffect.id,
        sides: biEffect.diceValue.sides,
        sourceCombatantId: combatant.id,
      });
    }
  }

  private _addLuckyFeatOption(
    combatant: CombatantStateRecord,
    actorSheet: Record<string, unknown>,
    out: RollInterruptOption[],
  ): void {
    const rawFeatIds: string[] =
      (actorSheet.featIds as string[] | undefined) ??
      (actorSheet.feats as string[] | undefined) ??
      [];
    const fightingStyle = actorSheet.fightingStyle as string | undefined;
    const featIds = mergeFightingStyleFeatId(rawFeatIds, fightingStyle);
    const featMods = computeFeatModifiers(featIds);

    if (!featMods.luckyEnabled) return;

    const resources = normalizeResources(combatant.resources);
    const directLuckPoints = typeof resources.luckPoints === "number" ? resources.luckPoints : undefined;
    const pooledLuckPoints = getResourcePools(combatant.resources)
      .find((pool) => pool.name === "luckPoints")
      ?.current;
    const luckPoints = directLuckPoints ?? pooledLuckPoints ?? 0;
    if (luckPoints > 0) {
      out.push({ kind: "lucky-feat", pointsRemaining: luckPoints });
    }
  }

  private _addHalflingLuckyOption(
    actorSheet: Record<string, unknown>,
    rawD20: number,
    out: RollInterruptOption[],
  ): void {
    // Halfling Lucky: reroll natural 1s on attack rolls, ability checks, and saves.
    if (rawD20 !== 1) return;

    const species =
      (actorSheet.species as string | undefined) ??
      (actorSheet.race as string | undefined) ??
      "";
    if (species.toLowerCase().includes("halfling")) {
      out.push({ kind: "halfling-lucky" });
    }
  }

  private _addTacticalMindOption(
    combatant: CombatantStateRecord,
    actorSheet: Record<string, unknown>,
    out: RollInterruptOption[],
  ): void {
    const className = (actorSheet.className as string | undefined) ?? "";
    const level = (actorSheet.level as number | undefined) ?? 0;
    if (!classHasFeature(className, TACTICAL_MIND, level)) return;

    const pools = getResourcePools(combatant.resources);
    const swPool = pools.find((p) => p.name === "secondWind");
    const remaining = swPool?.current ?? 0;
    if (remaining > 0) {
      out.push({ kind: "tactical-mind", secondWindRemaining: remaining });
    }
  }

  private _addPortentOption(
    combatant: CombatantStateRecord,
    out: RollInterruptOption[],
  ): void {
    // Portent (Diviner Wizard): pre-rolled values stored as ActiveEffects with
    // source "Portent" and diceValue set to the rolled value (count=1, sides=20).
    const effects = getActiveEffects(combatant.resources);
    for (const e of effects) {
      if (
        e.source === "Portent"
        && e.target === "custom"
        && e.duration === "until_triggered"
        && e.diceValue
      ) {
        out.push({
          kind: "portent",
          valueRolled: e.diceValue.sides, // sides field repurposed as the stored value
          portentEffectId: e.id,
        });
      }
    }
  }
}
