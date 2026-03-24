/**
 * SpellSlotManager — shared spell preparation helpers.
 *
 * Extracted from SpellActionHandler so both the tabletop path (SpellActionHandler)
 * and the AI path (AiActionExecutor) can consume the same resource-bookkeeping logic.
 *
 * ## What this module covers
 *   1. `findPreparedSpellInSheet` — pure lookup of a spell in a character's prepared spell list
 *   2. `prepareSpellCast`        — validate + spend slot, manage concentration, write to DB
 *
 * ## What this module does NOT cover
 *   - Spell effect delivery (damage, healing, saving throws, buff/debuff, zones)
 *   - That logic lives in `tabletop/spell-delivery/` and is tabletop-only because
 *     `SpellAttackDeliveryHandler` requires interactive player dice rolls
 *     (returns `requiresPlayerInput: true`, sets ATTACK pending action).
 *
 * ## AI path divergence note
 *   The AI path calls `prepareSpellCast` for resource bookkeeping (slot/concentration)
 *   then calls `ActionService.castSpell()` as a cosmetic step.
 *   Actual spell mechanical effects (damage/healing/conditions) are NOT applied in the AI path.
 *   See `ai-action-executor.ts executeCastSpell()` for the TODO.
 */

import { ValidationError } from "../../../errors.js";
import { hasResourceAvailable, spendResourceFromPool, normalizeResources } from "./resource-utils.js";
import { breakConcentration } from "./concentration-helper.js";
import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { PreparedSpellDefinition } from "../../../../domain/entities/spells/prepared-spell-definition.js";
import type { JsonValue } from "../../../types.js";

// ─────────────────────── Spell Lookup (pure) ────────────────────────

/**
 * Find a PreparedSpellDefinition from a character sheet's `preparedSpells` array.
 *
 * Pure, synchronous — no I/O. Returns `null` if the sheet is absent, malformed,
 * or the spell is not in the prepared list.
 */
export function findPreparedSpellInSheet(
  sheet: unknown,
  spellName: string,
): PreparedSpellDefinition | null {
  if (!sheet || typeof sheet !== "object" || Array.isArray(sheet)) return null;
  const s = sheet as Record<string, unknown>;
  if (!Array.isArray(s.preparedSpells)) return null;
  const lower = spellName.toLowerCase();
  return (
    (s.preparedSpells as unknown[]).find(
      (entry): entry is PreparedSpellDefinition =>
        entry !== null &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>).name === "string" &&
        ((entry as Record<string, unknown>).name as string).toLowerCase() === lower,
    ) ?? null
  );
}

// ─────────────────────── Spell Preparation (async) ──────────────────

/**
 * Validate + spend the spell slot and manage concentration for a caster.
 *
 * Cantrips (`spellLevel === 0`) are skipped entirely.
 *
 * Writes are committed to the database before returning.
 * If `breakConcentration` is needed it is called first (causing its own write),
 * then the slot-spend + new concentration name are committed in a second write.
 *
 * @param actorCombatantId  DB id of the caster's `CombatantState` row
 * @param encounterId       Encounter the combatant belongs to (for `listCombatants` + `breakConcentration`)
 * @param spellName         Display name of the spell being cast
 * @param spellLevel        Slot level to spend (0 = cantrip, 1-9 = leveled)
 * @param isConcentration   Whether the spell requires concentration
 * @param combatRepo        Combat repository for state reads/writes
 * @param log               Optional debug logger
 *
 * @throws {ValidationError} If no slot of the required level is available
 */
export async function prepareSpellCast(
  actorCombatantId: string,
  encounterId: string,
  spellName: string,
  spellLevel: number,
  isConcentration: boolean,
  combatRepo: ICombatRepository,
  log?: (msg: string) => void,
): Promise<void> {
  if (spellLevel <= 0) return; // Cantrips have no slot cost

  // Reload from DB for a fresh read (avoids stale in-memory resources)
  const combatants = await combatRepo.listCombatants(encounterId);
  const actorCombatant = combatants.find((c) => c.id === actorCombatantId);
  if (!actorCombatant) return; // Combatant not found — skip silently

  const poolName = `spellSlot_${spellLevel}`;
  const resources = actorCombatant.resources;

  if (!hasResourceAvailable(resources, poolName, 1)) {
    throw new ValidationError(`No level ${spellLevel} spell slots remaining`);
  }

  let updatedResources: JsonValue = spendResourceFromPool(resources, poolName, 1);

  // ── Concentration management ──────────────────────────────────────
  if (isConcentration) {
    const normalized = normalizeResources(updatedResources);
    if (normalized.concentrationSpellName) {
      log?.(
        `[SpellSlotManager] Concentration on "${normalized.concentrationSpellName}" ended (replaced by ${spellName})`,
      );
      // Clean up effects/zones from the old concentration spell
      await breakConcentration(actorCombatant, encounterId, combatRepo, log);
      // Re-fetch resources after breakConcentration modified them
      const freshCombatants = await combatRepo.listCombatants(encounterId);
      const freshCombatant = freshCombatants.find((c) => c.id === actorCombatantId);
      updatedResources = freshCombatant?.resources ?? updatedResources;
    }
    const normalizedAfter = normalizeResources(updatedResources);
    updatedResources = { ...normalizedAfter, concentrationSpellName: spellName } as JsonValue;
  }

  await combatRepo.updateCombatantState(actorCombatantId, { resources: updatedResources });
}
