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
import { hasResourceAvailable, spendResourceFromPool, normalizeResources, getResourcePools } from "./resource-utils.js";
import { breakConcentration } from "./concentration-helper.js";
import { getCanonicalSpell } from "../../../../domain/entities/spells/catalog/index.js";
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

// ─────────────────────── Catalog-First Resolution ───────────────────

/**
 * Resolve a spell definition from the canonical catalog first, then fallback to character sheet.
 *
 * Priority chain:
 * 1. Canonical catalog (single source of truth for mechanics)
 * 2. Character sheet's preparedSpells (backward compat for custom/homebrew spells)
 *
 * When both sources have the spell, catalog is the base and sheet overrides specific fields.
 * This lets character sheets provide custom tweaks (e.g., modified damage for a magic item)
 * while the catalog provides canonical mechanics.
 */
export function resolveSpell(
  spellName: string,
  sheet: unknown,
): PreparedSpellDefinition | null {
  const canonical = getCanonicalSpell(spellName);
  const fromSheet = findPreparedSpellInSheet(sheet, spellName);

  if (canonical && fromSheet) {
    // Merge: catalog is base, sheet can override specific fields
    return { ...canonical, ...stripUndefined(fromSheet) };
  }

  return canonical ?? fromSheet;
}

function stripUndefined(obj: PreparedSpellDefinition): Partial<PreparedSpellDefinition> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Partial<PreparedSpellDefinition>;
}

// ─────────────────────── Upcast Validation (pure) ──────────────────

/**
 * Validate upcast constraints.
 * Cantrips cannot be upcast. Cast level must be >= spell level and <= 9.
 * Throws ValidationError on violations. No-ops when castAtLevel is undefined.
 */
export function validateUpcast(spellLevel: number, castAtLevel: number | undefined, isCantrip: boolean): void {
  if (castAtLevel == null) return;
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
 * @param spellLevel        Base level of the spell (0 = cantrip, 1-9 = leveled)
 * @param isConcentration   Whether the spell requires concentration
 * @param combatRepo        Combat repository for state reads/writes
 * @param log               Optional debug logger
 * @param castAtLevel       Optional slot level to spend (for upcasting). Must be >= spellLevel and <= 9.
 *
 * @throws {ValidationError} If no slot of the required level is available,
 *         or if castAtLevel is invalid (below spell level or above 9)
 */
export async function prepareSpellCast(
  actorCombatantId: string,
  encounterId: string,
  spellName: string,
  spellLevel: number,
  isConcentration: boolean,
  combatRepo: ICombatRepository,
  log?: (msg: string) => void,
  castAtLevel?: number,
): Promise<void> {
  if (spellLevel <= 0) return; // Cantrips have no slot cost

  // Determine the effective slot level to spend
  const effectiveLevel = castAtLevel ?? spellLevel;

  // Validate upcasting constraints (delegated to shared pure function)
  validateUpcast(spellLevel, castAtLevel, false);

  // Reload from DB for a fresh read (avoids stale in-memory resources)
  const combatants = await combatRepo.listCombatants(encounterId);
  const actorCombatant = combatants.find((c) => c.id === actorCombatantId);
  if (!actorCombatant) return; // Combatant not found — skip silently

  const poolName = `spellSlot_${effectiveLevel}`;
  const resources = actorCombatant.resources;

  // Try standard spell slot first, then fall back to Pact Magic, then legacy spellSlots object format.
  // NOTE: prepareSpellCast is creature-type agnostic — it works for Characters, Monsters, and NPCs
  // as long as they have spellSlot_N resource pools or a legacy spellSlots object in resources.
  let slotPoolName: string;
  let legacySlotDeduction: (() => JsonValue) | null = null;

  if (hasResourceAvailable(resources, poolName, 1)) {
    slotPoolName = poolName;
  } else {
    // Warlock Pact Magic fallback: pactMagic pool can be used for any spell level
    // that the pact slot level can cover (pact slot level determined by warlock level,
    // validated at character creation/import time — here we just check availability)
    if (hasResourceAvailable(resources, "pactMagic", 1)) {
      // Validate pact slot level is high enough for the spell
      const normalized = normalizeResources(resources);
      const pactSlotLevel = typeof normalized.pactSlotLevel === "number" ? normalized.pactSlotLevel : undefined;
      if (pactSlotLevel !== undefined && pactSlotLevel < effectiveLevel) {
        throw new ValidationError(
          `Pact Magic slot level ${pactSlotLevel} is too low for a level ${effectiveLevel} spell`,
        );
      }
      log?.(`[SpellSlotManager] No standard level ${effectiveLevel} slot; using Pact Magic slot`);
      slotPoolName = "pactMagic";
    } else {
      // AI-H1: Generic fallback — check for legacy spellSlots object format
      // { spellSlots: { "3": 2, "4": 1 } } used by some monster/NPC resources.
      // This ensures monsters with legacy spell slot tracking also have slots deducted.
      const normalizedRaw = normalizeResources(resources);
      const legacySlots = normalizedRaw.spellSlots;
      if (typeof legacySlots === "object" && legacySlots !== null && !Array.isArray(legacySlots)) {
        const slotMap = legacySlots as Record<string, unknown>;
        const levelKey = String(effectiveLevel);
        const slotsAtLevel = typeof slotMap[levelKey] === "number" ? (slotMap[levelKey] as number) : 0;
        if (slotsAtLevel > 0) {
          log?.(`[SpellSlotManager] Using legacy spellSlots object format for level ${effectiveLevel} slot`);
          // Capture deduction as a closure to apply after concentration handling
          legacySlotDeduction = () => {
            const currentNorm = normalizeResources(resources);
            const currentLegacy = (currentNorm.spellSlots as Record<string, unknown>) ?? {};
            const updated = { ...currentLegacy, [levelKey]: Math.max(0, (slotsAtLevel) - 1) };
            return { ...currentNorm, spellSlots: updated } as JsonValue;
          };
          // Use a sentinel pool name — we'll handle this via legacySlotDeduction
          slotPoolName = `__legacy_${levelKey}`;
        } else {
          throw new ValidationError(`No level ${effectiveLevel} spell slots remaining`);
        }
      } else {
        throw new ValidationError(`No level ${effectiveLevel} spell slots remaining`);
      }
    }
  }

  let updatedResources: JsonValue;
  if (legacySlotDeduction) {
    // Apply legacy spellSlots object deduction directly
    updatedResources = legacySlotDeduction();
  } else {
    updatedResources = spendResourceFromPool(resources, slotPoolName, 1);
  }

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
