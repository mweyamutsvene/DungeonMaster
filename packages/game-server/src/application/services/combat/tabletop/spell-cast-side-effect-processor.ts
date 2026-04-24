/**
 * Processes `onCastSideEffects` declarations on a spell, AFTER the spell's
 * delivery handler has resolved (C-R2-1 in the inventory-G2 plan).
 *
 * Design:
 * - One wrapper call site inside `SpellActionHandler.handleCastSpell` — never
 *   invoked from individual delivery handlers.
 * - Runs only when the cast actually completed (delivery path returned
 *   `actionComplete: true`). The REACTION_CHECK path intentionally skips
 *   side-effects — they fire on the post-counterspell resume instead (wired
 *   in Commit 7 of the plan).
 * - Dual-writes: persistent `sheet.inventory` AND the live combatant's
 *   `resources.inventory` when an `actorCombatant` exists. For out-of-combat
 *   casts, only the sheet is written — the live combatant is reconstructed
 *   on next `combat/start` via `initiative-handler::buildCombatantResources`,
 *   which copies `sheet.inventory → resources.inventory`.
 * - Fail fast: throws `ValidationError` on unresolved `magicItemId` so data
 *   integrity bugs surface immediately rather than silently producing phantom
 *   items on a character sheet.
 */

import { ValidationError } from "../../../errors.js";
import type { ICharacterRepository } from "../../../repositories/character-repository.js";
import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { IEventRepository } from "../../../repositories/event-repository.js";
import type { SessionCharacterRecord } from "../../../types.js";
import type { PreparedSpellDefinition } from "../../../../domain/entities/spells/prepared-spell-definition.js";
import type { CharacterItemInstance } from "../../../../domain/entities/items/magic-item.js";
import { lookupMagicItemById } from "../../../../domain/entities/items/magic-item-catalog.js";
import { appendItemsToSheetInventory } from "../../entities/inventory-service.js";
import { normalizeResources, patchResources } from "../helpers/resource-utils.js";
import { nanoid } from "nanoid";

interface ActorCombatantLike {
  readonly id: string;
  readonly resources?: unknown;
}

export interface SpellSideEffectContext {
  readonly spell: PreparedSpellDefinition;
  readonly caster: SessionCharacterRecord | null;
  readonly actorCombatant: ActorCombatantLike | null;
  /**
   * Active encounter id. When present alongside `actorCombatant`, the processor
   * re-fetches the combatant via `combatRepo.listCombatants(encounterId)` so
   * the inventory patch goes on top of post-delivery resources (preserving
   * slot decrements, concentration flags, etc.). Without this re-fetch the
   * caller's stale `actorCombatant.resources` would overwrite slot state.
   */
  readonly encounterId?: string;
  readonly sessionId: string;
  readonly charactersRepo: ICharacterRepository;
  readonly combatRepo: ICombatRepository;
  readonly eventsRepo?: IEventRepository;
}

/**
 * Process all `onCastSideEffects` on the spell. Idempotency is NOT guaranteed —
 * callers must only invoke this once per successful cast. No-op for spells
 * without side effects.
 */
export async function processSpellCastSideEffects(
  ctx: SpellSideEffectContext,
): Promise<void> {
  const sideEffects = ctx.spell.onCastSideEffects;
  if (!sideEffects || sideEffects.length === 0) return;
  if (!ctx.caster) return; // Without a character sheet to mutate, no items can be created.

  const createdItems: CharacterItemInstance[] = [];

  for (const effect of sideEffects) {
    if (effect.type === "creates_item") {
      const itemDef = lookupMagicItemById(effect.itemRef.magicItemId);
      if (!itemDef) {
        throw new ValidationError(
          `Spell "${ctx.spell.name}" declared creates_item with unknown magicItemId: ${effect.itemRef.magicItemId}`,
        );
      }
      createdItems.push({
        magicItemId: itemDef.id,
        name: itemDef.name,
        equipped: false,
        attuned: false,
        quantity: effect.quantity,
        longRestsRemaining: effect.longRestsRemaining,
      });
    }
  }

  if (createdItems.length === 0) return;

  // Persist to the sheet (source of truth for OoC state).
  const { sheet, inventory } = appendItemsToSheetInventory(ctx.caster, createdItems);
  await ctx.charactersRepo.updateSheet(ctx.caster.id, sheet);

  // Dual-write: if an active combatant exists, mirror the inventory on
  // `resources.inventory` so mid-combat item use works without a fresh load.
  // Re-fetch the combatant (when `encounterId` is supplied) to preserve the
  // post-delivery resources — slot decrements, concentration flags, bonus-
  // action tracking, etc. Without the re-fetch we'd clobber those with stale
  // pre-cast state because `updateCombatantState` replaces `resources` wholesale.
  if (ctx.actorCombatant) {
    let baseResources: Record<string, unknown> = normalizeResources(ctx.actorCombatant.resources ?? {});
    if (ctx.encounterId) {
      const fresh = await ctx.combatRepo.listCombatants(ctx.encounterId);
      const freshActor = fresh.find((c) => c.id === ctx.actorCombatant!.id);
      if (freshActor) {
        baseResources = normalizeResources(freshActor.resources ?? {});
      }
    }
    await ctx.combatRepo.updateCombatantState(ctx.actorCombatant.id, {
      resources: patchResources(baseResources, { inventory }),
    });
  }

  if (ctx.eventsRepo) {
    for (const item of createdItems) {
      await ctx.eventsRepo.append(ctx.sessionId, {
        id: nanoid(),
        type: "InventoryChanged",
        payload: {
          characterId: ctx.caster.id,
          characterName: ctx.caster.name,
          action: "create",
          itemName: item.name,
          quantity: item.quantity,
        },
      });
    }
  }
}
