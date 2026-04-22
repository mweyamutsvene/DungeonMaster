/**
 * Class-level passive ActiveEffects installed when combat begins.
 *
 * Some class features are always-on passives that the rest of the combat
 * system already consumes via ActiveEffect queries — e.g. the saving-throw
 * resolver reads effects with `source === "Danger Sense"` to grant DEX-save
 * advantage, and `getEffectiveSpeed()` sums `speed_modifier` effects into
 * the base speed. Those features are silently dead unless some code path
 * actually installs the effect.
 *
 * This module centralizes the "what effects should be pre-installed for a
 * given class/level?" decision as a pure function so the combat-start flow
 * can simply call it once when creating each combatant's initial resources.
 *
 * Rules covered (D&D 5e 2024):
 *   - Barbarian L2 Danger Sense → advantage on DEX saves (negation handled
 *     by the saving-throw-resolver when the Barbarian is Blinded/Deafened/
 *     Incapacitated).
 *   - Barbarian L5 Fast Movement → +10 ft speed (not wearing heavy armor —
 *     armor gating is out of scope here; the application layer should skip
 *     this effect for heavy-armor builds if needed).
 *   - Monk L2 Unarmored Movement → +10 ft speed (no armor, no shield — same
 *     armor-gating caveat as above; Monk L2+ in the base class assumes
 *     unarmored play in 2024 RAW).
 */

import { createEffect, type ActiveEffect } from "../entities/combat/effects.js";

export interface ClassStartupContext {
  readonly classId: string;
  readonly level: number;
}

/**
 * Returns the ActiveEffects that should be pre-installed on a combatant based
 * on its class/level passives. Safe to call for any class/level (returns [] if
 * nothing applies).
 */
export function getClassStartupEffects(ctx: ClassStartupContext): ActiveEffect[] {
  const effects: ActiveEffect[] = [];
  const classId = ctx.classId.toLowerCase();
  const level = ctx.level;

  if (classId === "barbarian" && level >= 2) {
    effects.push(
      createEffect("class-danger-sense", "advantage", "saving_throws", "permanent", {
        ability: "dexterity",
        source: "Danger Sense",
        description: "Barbarian L2: advantage on DEX saving throws against effects you can see.",
      }),
    );
  }

  if (classId === "barbarian" && level >= 5) {
    effects.push(
      createEffect("class-fast-movement", "speed_modifier", "speed", "permanent", {
        value: 10,
        source: "Fast Movement",
        description: "Barbarian L5: +10 ft speed when not wearing heavy armor.",
      }),
    );
  }

  if (classId === "monk" && level >= 2) {
    effects.push(
      createEffect("class-unarmored-movement", "speed_modifier", "speed", "permanent", {
        value: 10,
        source: "Unarmored Movement",
        description: "Monk L2: +10 ft speed while unarmored and not wielding a shield.",
      }),
    );
  }

  return effects;
}
