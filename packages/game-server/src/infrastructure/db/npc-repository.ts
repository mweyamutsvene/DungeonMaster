import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  INPCRepository,
  CreateNPCInput,
} from "../../application/repositories/npc-repository.js";
import type { SessionNPCRecord } from "../../application/types.js";

/**
 * Prisma-backed persistence for session NPCs.
 * Layer: Infrastructure (DB adapter).
 * Notes: Used for allies/neutral actors (and AI-controlled NPCs) during encounters.
 */
export class PrismaNPCRepository implements INPCRepository {
  constructor(private prisma: PrismaClient | Prisma.TransactionClient) {}

  async createInSession(sessionId: string, input: CreateNPCInput): Promise<SessionNPCRecord> {
    const npc = await this.prisma.sessionNPC.create({
      data: {
        id: input.id,
        sessionId,
        name: input.name,
        statBlock: input.statBlock as Prisma.InputJsonValue,
        faction: input.faction ?? "party",
        aiControlled: input.aiControlled ?? true,
      },
    });
    return npc;
  }

  async getById(id: string): Promise<SessionNPCRecord | null> {
    return await this.prisma.sessionNPC.findUnique({
      where: { id },
    });
  }

  async getManyByIds(ids: string[]): Promise<SessionNPCRecord[]> {
    return await this.prisma.sessionNPC.findMany({
      where: { id: { in: ids } },
    });
  }

  async listBySession(sessionId: string): Promise<SessionNPCRecord[]> {
    return await this.prisma.sessionNPC.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.sessionNPC.delete({
      where: { id },
    });
  }
}
