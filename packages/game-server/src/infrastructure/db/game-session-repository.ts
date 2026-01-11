import type { Prisma, PrismaClient } from "@prisma/client";

import type { IGameSessionRepository } from "../../application/repositories/game-session-repository.js";
import type { GameSessionRecord, JsonValue } from "../../application/types.js";

/**
 * Prisma-backed persistence for `GameSession`.
 * Layer: Infrastructure (DB adapter).
 * Notes: Sessions are the root container for runtime state (characters, combat, events).
 */
export class PrismaGameSessionRepository implements IGameSessionRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async create(input: { id: string; storyFramework: JsonValue }): Promise<GameSessionRecord> {
    const created = await this.prisma.gameSession.create({
      data: {
        id: input.id,
        storyFramework: input.storyFramework as Prisma.InputJsonValue,
      },
    });

    return created;
  }

  async getById(id: string): Promise<GameSessionRecord | null> {
    return this.prisma.gameSession.findUnique({ where: { id } });
  }
}
