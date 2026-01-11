import type { Prisma, PrismaClient } from "@prisma/client";

import type { ISpellRepository } from "../../application/repositories/spell-repository.js";
import type { SpellDefinitionRecord } from "../../application/types.js";

/**
 * Prisma-backed access to static spell definition rows.
 * Layer: Infrastructure (DB adapter).
 * Notes: Read-only by convention at runtime; writes happen via import scripts.
 */
export class PrismaSpellRepository implements ISpellRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async getById(id: string): Promise<SpellDefinitionRecord | null> {
    return this.prisma.spellDefinition.findUnique({ where: { id } });
  }

  async getByName(name: string): Promise<SpellDefinitionRecord | null> {
    return this.prisma.spellDefinition.findUnique({ where: { name } });
  }

  async listByLevel(level: number): Promise<SpellDefinitionRecord[]> {
    return this.prisma.spellDefinition.findMany({ where: { level } });
  }
}
