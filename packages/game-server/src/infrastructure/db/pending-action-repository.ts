import type { Prisma, PrismaClient } from "@prisma/client";

import type { PendingActionRepository } from "../../application/repositories/pending-action-repository.js";
import type {
  PendingAction,
  PendingActionStatus,
  ReactionOpportunity,
  ReactionResponse,
  ReactionResult,
} from "../../domain/entities/combat/pending-action.js";

/**
 * Prisma-backed persistence for pending actions awaiting reaction resolution.
 * Layer: Infrastructure (DB adapter).
 *
 * Complex nested types (CombatantRef, ReactionOpportunity[], ReactionResponse[])
 * are stored as JSON columns. Status is a plain string column for efficient queries.
 */
export class PrismaPendingActionRepository implements PendingActionRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async create(action: PendingAction): Promise<PendingAction> {
    await this.prisma.pendingAction.create({
      data: {
        id: action.id,
        encounterId: action.encounterId,
        type: action.type,
        status: "awaiting_reactions",
        actor: action.actor as unknown as Prisma.InputJsonValue,
        data: action.data as unknown as Prisma.InputJsonValue,
        reactionOpportunities: action.reactionOpportunities as unknown as Prisma.InputJsonValue,
        resolvedReactions: action.resolvedReactions as unknown as Prisma.InputJsonValue,
        createdAt: action.createdAt,
        expiresAt: action.expiresAt,
      },
    });
    return action;
  }

  async getById(actionId: string): Promise<PendingAction | null> {
    const row = await this.prisma.pendingAction.findUnique({ where: { id: actionId } });
    return row ? toDomain(row) : null;
  }

  async listByEncounter(encounterId: string): Promise<PendingAction[]> {
    const rows = await this.prisma.pendingAction.findMany({
      where: { encounterId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDomain);
  }

  async addReactionResponse(actionId: string, response: ReactionResponse): Promise<PendingAction> {
    const row = await this.prisma.pendingAction.findUnique({ where: { id: actionId } });
    if (!row) throw new Error(`Pending action not found: ${actionId}`);

    const action = toDomain(row);
    action.resolvedReactions.push(response);

    const allResolved = action.reactionOpportunities.every((opp: ReactionOpportunity) =>
      action.resolvedReactions.some((r: ReactionResponse) => r.opportunityId === opp.id),
    );

    const newStatus: PendingActionStatus = allResolved ? "ready_to_complete" : "awaiting_reactions";

    await this.prisma.pendingAction.update({
      where: { id: actionId },
      data: {
        resolvedReactions: action.resolvedReactions as unknown as Prisma.InputJsonValue,
        status: newStatus,
      },
    });

    return action;
  }

  async getStatus(actionId: string): Promise<PendingActionStatus> {
    const row = await this.prisma.pendingAction.findUnique({
      where: { id: actionId },
      select: { status: true, expiresAt: true },
    });
    if (!row) throw new Error(`Pending action not found: ${actionId}`);

    if (row.expiresAt < new Date()) {
      await this.prisma.pendingAction.update({
        where: { id: actionId },
        data: { status: "expired" },
      });
      return "expired";
    }

    return row.status as PendingActionStatus;
  }

  async markCompleted(actionId: string): Promise<void> {
    await this.prisma.pendingAction.update({
      where: { id: actionId },
      data: { status: "completed" },
    });
  }

  async markCancelled(actionId: string): Promise<void> {
    await this.prisma.pendingAction.update({
      where: { id: actionId },
      data: { status: "cancelled" },
    });
  }

  async delete(actionId: string): Promise<void> {
    await this.prisma.pendingAction.delete({ where: { id: actionId } }).catch(() => {
      // Silently ignore if already deleted (matches in-memory behavior)
    });
  }

  async update(action: PendingAction): Promise<PendingAction> {
    await this.prisma.pendingAction.update({
      where: { id: action.id },
      data: {
        type: action.type,
        actor: action.actor as unknown as Prisma.InputJsonValue,
        data: action.data as unknown as Prisma.InputJsonValue,
        reactionOpportunities: action.reactionOpportunities as unknown as Prisma.InputJsonValue,
        resolvedReactions: action.resolvedReactions as unknown as Prisma.InputJsonValue,
        expiresAt: action.expiresAt,
      },
    });
    return action;
  }

  async updateReactionResult(actionId: string, opportunityId: string, result: ReactionResult): Promise<void> {
    const row = await this.prisma.pendingAction.findUnique({ where: { id: actionId } });
    if (!row) throw new Error(`Pending action not found: ${actionId}`);

    const action = toDomain(row);
    const reaction = action.resolvedReactions.find(
      (r: ReactionResponse) => r.opportunityId === opportunityId,
    );
    if (reaction) {
      reaction.result = result;
      await this.prisma.pendingAction.update({
        where: { id: actionId },
        data: {
          resolvedReactions: action.resolvedReactions as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  async cleanupExpired(): Promise<void> {
    await this.prisma.pendingAction.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }
}

// ---------------------------------------------------------------------------
// Row → Domain mapping
// ---------------------------------------------------------------------------

type PendingActionRow = {
  id: string;
  encounterId: string;
  type: string;
  status: string;
  actor: unknown;
  data: unknown;
  reactionOpportunities: unknown;
  resolvedReactions: unknown;
  createdAt: Date;
  expiresAt: Date;
};

function toDomain(row: PendingActionRow): PendingAction {
  return {
    id: row.id,
    encounterId: row.encounterId,
    type: row.type as PendingAction["type"],
    actor: row.actor as PendingAction["actor"],
    data: row.data as PendingAction["data"],
    reactionOpportunities: row.reactionOpportunities as ReactionOpportunity[],
    resolvedReactions: row.resolvedReactions as ReactionResponse[],
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}
