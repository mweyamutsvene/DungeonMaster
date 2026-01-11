import type { Prisma, PrismaClient } from "@prisma/client";

import type { IEventRepository } from "../../application/repositories/event-repository.js";
import type { GameEventRecord, JsonValue } from "../../application/types.js";

/**
 * Prisma-backed append-only game event store.
 * Layer: Infrastructure (DB adapter).
 * Notes: Used for session event history and (optionally) narration context.
 */
export class PrismaEventRepository implements IEventRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async append(
    sessionId: string,
    input: { id: string; type: string; payload: JsonValue },
  ): Promise<GameEventRecord> {
    const created = await this.prisma.gameEvent.create({
      data: {
        id: input.id,
        sessionId,
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });

    return created;
  }

  async listBySession(
    sessionId: string,
    input?: { limit?: number; since?: Date },
  ): Promise<GameEventRecord[]> {
    const limit = input?.limit ?? 100;

    return this.prisma.gameEvent.findMany({
      where: {
        sessionId,
        ...(input?.since ? { createdAt: { gt: input.since } } : undefined),
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }
}
