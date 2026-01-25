import { NotFoundError } from "../../errors.js";
import type { ISpellRepository } from "../../repositories/spell-repository.js";
import type { SpellDefinitionRecord } from "../../types.js";

/**
 * Read-only lookup for static spell definitions.
 * Layer: Application.
 * Notes: Wraps `ISpellRepository` and normalizes "not found" into `NotFoundError`.
 *
 * TODO: Future spellcasting mechanics expansion:
 * - Slot consumption via ResourceUtils
 * - Concentration tracking (see domain/rules/concentration.ts)
 * - Save DC calculation based on caster stats
 * - Integration with TwoPhaseActionService for reaction spells (Shield, Counterspell)
 * - Integration with ActionService.attack() pattern for spell attacks
 * - Area-of-effect targeting and damage application
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
