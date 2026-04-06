import { NotFoundError } from "../../errors.js";
import type { ISpellRepository } from "../../repositories/spell-repository.js";
import type { SpellDefinitionRecord } from "../../types.js";

/**
 * Read-only lookup for static spell definitions.
 * Layer: Application.
 * Notes: Wraps `ISpellRepository` and normalizes "not found" into `NotFoundError`.
 *
 * Implemented mechanics (handled by other services):
 * - Slot consumption: SpellSlotManager
 * - Concentration tracking: domain/rules/concentration.ts, ConcentrationHelper
 * - Save DC / spell attack bonus: domain/rules/spell-casting.ts (computeSpellSaveDC, computeSpellAttackBonus)
 * - Reaction spells (Shield, Counterspell): TwoPhaseActionService + SpellReactionHandler
 * - Spell attacks: SpellAttackDeliveryHandler
 * - AoE targeting: SaveSpellDeliveryHandler.handleAoE()
 */
export class SpellLookupService {
  constructor(private readonly spells: ISpellRepository) {}

  async getSpellByIdOrThrow(id: string): Promise<SpellDefinitionRecord> {
    const spell = await this.spells.getById(id);
    if (!spell) throw new NotFoundError(`Spell not found: ${id}`);
    return spell;
  }

  async getSpellByNameOrThrow(name: string): Promise<SpellDefinitionRecord> {
    const spell = await this.spells.getByName(name);
    if (!spell) throw new NotFoundError(`Spell not found: ${name}`);
    return spell;
  }
}
