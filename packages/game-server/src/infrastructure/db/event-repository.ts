import type { Prisma, PrismaClient } from "@prisma/client";

import type { IEventRepository, GameEventInput } from "../../application/repositories/event-repository.js";
import type { GameEventRecord } from "../../application/types.js";

/**
 * Prisma-backed append-only game event store.
 * Layer: Infrastructure (DB adapter).
 * Notes: Used for session event history and (optionally) narration context.
 */
export class PrismaEventRepository implements IEventRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async append(
    sessionId: string,
    input: { id: string } & GameEventInput,
    combatContext?: { encounterId: string; round: number; turnNumber: number },
  ): Promise<GameEventRecord> {
    const created = await this.prisma.gameEvent.create({
      data: {
        id: input.id,
        sessionId,
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
        ...(combatContext ? {
          encounterId: combatContext.encounterId,
          round: combatContext.round,
          turnNumber: combatContext.turnNumber,
        } : {}),
      },
    });

    return created;
  }

  async listBySession(
    sessionId: string,
    input?: { limit?: number; since?: Date },
  ): Promise<GameEventRecord[]> {
    const limit = input?.limit ?? 100;

    // When fetching with a limit (no 'since' filter), get the NEWEST events
    // by sorting desc, then reverse to maintain ascending order for display
    if (!input?.since) {
      const events = await this.prisma.gameEvent.findMany({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      // Reverse to return in ascending order (oldest first within the batch)
      return events.reverse();
    }

    // When filtering by 'since', return events after that timestamp in ascending order
    return this.prisma.gameEvent.findMany({
      where: {
        sessionId,
        createdAt: { gt: input.since },
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }

  async listByEncounter(
    encounterId: string,
    input?: { limit?: number; round?: number },
  ): Promise<GameEventRecord[]> {
    const limit = input?.limit ?? 200;
    return this.prisma.gameEvent.findMany({
      where: {
        encounterId,
        ...(input?.round !== undefined ? { round: input.round } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }
}
