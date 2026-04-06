import { NotFoundError } from "../../errors.js";
import type { ISpellRepository } from "../../repositories/spell-repository.js";
import type { SpellDefinitionRecord } from "../../types.js";
import { getCanonicalSpell } from "../../../domain/entities/spells/catalog/index.js";

/**
 * Read-only lookup for static spell definitions.
 * Layer: Application.
 * Notes: Uses canonical spell catalog as primary source, falls back to
 * `ISpellRepository` (Prisma) for spells not in the catalog.
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
    // Try canonical catalog first (synchronous, no DB round-trip)
    const canonical = getCanonicalSpell(name);
    if (canonical) {
      return {
        id: `catalog:${canonical.name.toLowerCase().replace(/\s+/g, "-")}`,
        name: canonical.name,
        level: canonical.level,
        school: canonical.school,
        ritual: canonical.ritual ?? false,
        data: canonical as unknown as SpellDefinitionRecord["data"],
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
    }

    // Fall back to DB repository
    const spell = await this.spells.getByName(name);
    if (!spell) throw new NotFoundError(`Spell not found: ${name}`);
    return spell;
  }
}
