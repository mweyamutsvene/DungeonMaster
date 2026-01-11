import { NotFoundError } from "../../errors.js";
import type { ISpellRepository } from "../../repositories/spell-repository.js";
import type { SpellDefinitionRecord } from "../../types.js";

/**
 * Read-only access to static spell definitions.
 * Layer: Application.
 * Notes: Wraps `ISpellRepository` and normalizes “not found” into `NotFoundError`.
 */
export class SpellcastingService {
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
