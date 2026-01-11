import type { Creature } from "../entities/creatures/creature.js";
import type { Spell } from "../entities/spells/spell.js";
import type { Effect } from "../effects/effect.js";
import type { SpellSlotsState, SpellSlotLevel } from "./spell-slots.js";
import { canSpendSpellSlot, spendSpellSlot } from "./spell-slots.js";
import type { ConcentrationState } from "./concentration.js";
import { endConcentration, startConcentration } from "./concentration.js";

export interface CastSpellOptions {
  caster: Creature;
  spell: Spell;

  targets: readonly Creature[];

  /**
   * If omitted, the spell’s base level is used for slot consumption (minimum 1).
   * Can be higher for upcasting.
   */
  slotLevel?: SpellSlotLevel;

  /**
   * Spell slots available to the caster.
   * (For now, managed externally as a state value object.)
   */
  spellSlots?: SpellSlotsState;

  /**
   * If provided and spell requires concentration, this state is updated.
   */
  concentration?: {
    state: ConcentrationState;
    requiresConcentration: boolean;
  };

  /**
   * The mechanical effects to apply. Stage 3.2 keeps this explicit and deterministic.
   * Later stages can compile these from spell definitions.
   */
  effects?: readonly Effect[];
}

export interface CastSpellResult {
  spellId: string;
  slotSpent: SpellSlotLevel | null;
  nextSpellSlots?: SpellSlotsState;

  nextConcentration?: ConcentrationState;

  appliedToTargetIds: string[];
}

export function castSpell(options: CastSpellOptions): CastSpellResult {
  const { caster, spell, targets } = options;

  // Armor training restriction: if the caster cannot cast spells (e.g. untrained armor), block casting.
  const maybe = caster as unknown as { canCastSpells?: () => boolean };
  if (typeof maybe.canCastSpells === "function" && !maybe.canCastSpells()) {
    throw new Error("Cannot cast spells while wearing armor without training");
  }

  const base = spell.getLevel();
  const inferredSlot = Math.max(1, base) as SpellSlotLevel;
  const slotLevel = options.slotLevel ?? inferredSlot;

  let nextSpellSlots = options.spellSlots;
  let slotSpent: SpellSlotLevel | null = null;

  // Spend a slot for non-cantrips when spellSlots provided.
  if (base > 0) {
    if (!nextSpellSlots) {
      throw new Error("spellSlots are required to cast a leveled spell");
    }
    if (!canSpendSpellSlot(nextSpellSlots, slotLevel)) {
      throw new Error(`Cannot spend spell slot level ${slotLevel}`);
    }
    nextSpellSlots = spendSpellSlot(nextSpellSlots, slotLevel);
    slotSpent = slotLevel;
  }

  // Concentration rules: starting concentration ends any previous concentration.
  let nextConcentration = options.concentration?.state;
  if (options.concentration?.requiresConcentration) {
    const state = options.concentration.state;
    nextConcentration = startConcentration(endConcentration(state), spell.getId());
  }

  const effects = options.effects ?? [];
  const appliedToTargetIds: string[] = [];

  for (const target of targets) {
    for (const effect of effects) {
      effect.apply(target);
    }
    appliedToTargetIds.push(target.getId());
  }

  return {
    spellId: spell.getId(),
    slotSpent,
    nextSpellSlots,
    nextConcentration,
    appliedToTargetIds,
  };
}
