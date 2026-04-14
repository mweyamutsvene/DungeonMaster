import type { Prisma, PrismaClient } from "@prisma/client";

import type { IMonsterRepository } from "../../application/repositories/monster-repository.js";
import type { JsonValue, SessionMonsterRecord } from "../../application/types.js";

/**
 * Prisma-backed persistence for session monsters.
 * Layer: Infrastructure (DB adapter).
 * Notes: Stores per-session monsters plus their stat blocks/faction/AI flags.
 */
export class PrismaMonsterRepository implements IMonsterRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async createInSession(
    sessionId: string,
    input: {
      id: string;
      name: string;
      monsterDefinitionId: string | null;
      statBlock: JsonValue;
    },
  ): Promise<SessionMonsterRecord> {
    const created = await this.prisma.sessionMonster.create({
      data: {
        id: input.id,
        sessionId,
        name: input.name,
        monsterDefinitionId: input.monsterDefinitionId,
        statBlock: input.statBlock as Prisma.InputJsonValue,
      },
    });

    return created;
  }

  async createMany(
    sessionId: string,
    inputs: Array<{
      id: string;
      name: string;
      monsterDefinitionId: string | null;
      statBlock: JsonValue;
    }>,
  ): Promise<SessionMonsterRecord[]> {
    if (inputs.length === 0) return [];
    const results: SessionMonsterRecord[] = [];
    for (const input of inputs) {
      results.push(await this.createInSession(sessionId, input));
    }
    return results;
  }

  async getById(id: string): Promise<SessionMonsterRecord | null> {
    return this.prisma.sessionMonster.findUnique({ where: { id } });
  }

  async getManyByIds(ids: string[]): Promise<SessionMonsterRecord[]> {
    return this.prisma.sessionMonster.findMany({ where: { id: { in: ids } } });
  }

  async listBySession(sessionId: string): Promise<SessionMonsterRecord[]> {
    return this.prisma.sessionMonster.findMany({ where: { sessionId } });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.sessionMonster.delete({
      where: { id },
    });
  }

  async updateStatBlock(id: string, data: Partial<Record<string, unknown>>): Promise<SessionMonsterRecord> {
    const existing = await this.prisma.sessionMonster.findUnique({ where: { id } });
    if (!existing) throw new Error("Monster not found: " + id);
    const currentStatBlock = (existing.statBlock as Record<string, unknown>) ?? {};
    const merged = { ...currentStatBlock, ...data };
    return this.prisma.sessionMonster.update({
      where: { id },
      data: { statBlock: merged as Prisma.InputJsonValue },
    });
  }
}
