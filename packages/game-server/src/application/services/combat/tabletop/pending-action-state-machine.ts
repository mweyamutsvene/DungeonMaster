/**
 * Formal state machine for TabletopPendingAction transitions.
 *
 * VALID_PENDING_TRANSITIONS documents every legal state-to-state move.
 * assertValidTransition throws a ValidationError when an invalid transition
 * is attempted, preventing corrupted combat state.
 *
 * null = "no pending action" (start of sequence or fully resolved).
 */

import { ValidationError } from "../../../errors.js";
import type { PendingActionType } from "./tabletop-types.js";

/**
 * Maps each from-type to the set of valid to-types.
 * null represents "no pending action" (start or fully resolved state).
 */
export const VALID_PENDING_TRANSITIONS: Readonly<
  Record<PendingActionType | "null", ReadonlyArray<PendingActionType | null>>
> = {
  // First action in a combat sequence — or re-entry after full resolution
  null: ["INITIATIVE", "ATTACK", "DEATH_SAVE", "SAVING_THROW"],
  // Initiative roll pending → combat starts (null) or Alert feat swap offered
  INITIATIVE: [null, "INITIATIVE_SWAP"],
  // Alert feat swap decision → combat starts
  INITIATIVE_SWAP: [null],
  // Attack roll → miss resolves to null, hit creates DAMAGE, Flurry second strike is another ATTACK
  ATTACK: [null, "DAMAGE", "ATTACK"],
  // Damage applied → done (null), Flurry second strike needs another ATTACK, hit-rider save → SAVING_THROW
  DAMAGE: [null, "ATTACK", "SAVING_THROW"],
  // Death save → stabilized / dead / revived → null
  DEATH_SAVE: [null],
  // Auto-resolved save → done (null) or chained saves (SAVING_THROW → SAVING_THROW)
  SAVING_THROW: [null, "SAVING_THROW"],
};

/**
 * Assert that a pending action transition is valid.
 * Throws a ValidationError when the transition is not listed in
 * VALID_PENDING_TRANSITIONS, preventing corrupted combat state.
 *
 * @param from - The previous pending action type, or null if none was pending.
 * @param to   - The new pending action type being set, or null if clearing.
 */
export function assertValidTransition(
  from: PendingActionType | null,
  to: PendingActionType | null,
): void {
  const fromKey = from ?? "null";
  const validTargets =
    VALID_PENDING_TRANSITIONS[fromKey as keyof typeof VALID_PENDING_TRANSITIONS];
  if (validTargets && !validTargets.includes(to)) {
    const validStr = validTargets.map((t) => String(t ?? "null")).join(", ");
    throw new ValidationError(
      `Invalid pending action transition: ${fromKey} → ${String(to ?? "null")}. ` +
        `Valid transitions from ${fromKey}: [${validStr}]`,
    );
  }
}
