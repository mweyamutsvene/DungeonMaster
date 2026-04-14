import type { Prisma, PrismaClient } from "@prisma/client";

import type { ICharacterRepository, CharacterUpdateData } from "../../application/repositories/character-repository.js";
import type { JsonValue, SessionCharacterRecord } from "../../application/types.js";

/**
 * Prisma-backed persistence for session characters.
 * Layer: Infrastructure (DB adapter).
 * Notes: Implements `ICharacterRepository` used by application services.
 */
export class PrismaCharacterRepository implements ICharacterRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async createInSession(
    sessionId: string,
    input: {
      id: string;
      name: string;
      level: number;
      className: string | null;
      sheet: JsonValue;
    },
  ): Promise<SessionCharacterRecord> {
    const created = await this.prisma.sessionCharacter.create({
      data: {
        id: input.id,
        sessionId,
        name: input.name,
        level: input.level,
        className: input.className,
        sheet: input.sheet as Prisma.InputJsonValue,
      },
    });

    return created;
  }

  async getById(id: string): Promise<SessionCharacterRecord | null> {
    return this.prisma.sessionCharacter.findUnique({ where: { id } });
  }

  async getManyByIds(ids: string[]): Promise<SessionCharacterRecord[]> {
    return this.prisma.sessionCharacter.findMany({ where: { id: { in: ids } } });
  }

  async listBySession(sessionId: string): Promise<SessionCharacterRecord[]> {
    return this.prisma.sessionCharacter.findMany({ where: { sessionId } });
  }

  async updateSheet(id: string, sheet: JsonValue): Promise<SessionCharacterRecord> {
    return this.prisma.sessionCharacter.update({
      where: { id },
      data: { sheet: sheet as Prisma.InputJsonValue },
    });
  }

  async update(id: string, data: Partial<CharacterUpdateData>): Promise<SessionCharacterRecord> {
    const prismaData: Prisma.SessionCharacterUpdateInput = {};
    if (data.name !== undefined) prismaData.name = data.name;
    if (data.level !== undefined) prismaData.level = data.level;
    if (data.className !== undefined) prismaData.className = data.className;
    if (data.sheet !== undefined) prismaData.sheet = data.sheet as Prisma.InputJsonValue;
    if (data.faction !== undefined) prismaData.faction = data.faction;
    if (data.aiControlled !== undefined) prismaData.aiControlled = data.aiControlled;
    return this.prisma.sessionCharacter.update({
      where: { id },
      data: prismaData,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.sessionCharacter.delete({ where: { id } });
  }
}
