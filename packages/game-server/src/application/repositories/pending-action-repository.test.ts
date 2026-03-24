import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryPendingActionRepository } from "../../infrastructure/testing/memory-repos.js";
import type { PendingAction, ReactionOpportunity } from "../../domain/entities/combat/pending-action.js";

describe("InMemoryPendingActionRepository", () => {
  let repo: InMemoryPendingActionRepository;

  beforeEach(() => {
    repo = new InMemoryPendingActionRepository();
  });

  describe("create", () => {
    it("should store a new pending action", async () => {
      const pendingAction: PendingAction = {
        id: "move_123",
        encounterId: "enc_1",
        actor: { type: "Monster", monsterId: "goblin_1" },
        type: "move",
        data: {
          type: "move",
          from: { x: 5, y: 5 },
          to: { x: 10, y: 10 },
          path: [{ x: 10, y: 10 }],
        },
        reactionOpportunities: [],
        resolvedReactions: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      };

      const created = await repo.create(pendingAction);

      expect(created).toEqual(pendingAction);
      expect(await repo.getById("move_123")).toEqual(pendingAction);
    });

    it("should initialize status as awaiting_reactions", async () => {
      const pendingAction: PendingAction = {
        id: "move_456",
        encounterId: "enc_1",
        actor: { type: "Monster", monsterId: "goblin_1" },
        type: "move",
        data: {
          type: "move",
          from: { x: 5, y: 5 },
          to: { x: 10, y: 10 },
          path: [{ x: 10, y: 10 }],
        },
        reactionOpportunities: [],
        resolvedReactions: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      };

      await repo.create(pendingAction);

      const status = await repo.getStatus("move_456");
      expect(status).toBe("awaiting_reactions");
    });
  });

  describe("getById", () => {
    it("should return null for non-existent action", async () => {
      const result = await repo.getById("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("listByEncounter", () => {
    it("should return all actions for an encounter", async () => {
      const action1: PendingAction = {
        id: "move_1",
        encounterId: "enc_1",
        actor: { type: "Monster", monsterId: "goblin_1" },
        type: "move",
        data: { type: "move", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, path: [] },
        reactionOpportunities: [],
        resolvedReactions: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      };

      const action2: PendingAction = {
        id: "move_2",
        encounterId: "enc_1",
        actor: { type: "Monster", monsterId: "goblin_2" },
        type: "move",
        data: { type: "move", from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, path: [] },
        reactionOpportunities: [],
        resolvedReactions: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      };

      const action3: PendingAction = {
        id: "move_3",
        encounterId: "enc_2",
        actor: { type: "Monster", monsterId: "goblin_3" },
        type: "move",
        data: { type: "move", from: { x: 0, y: 0 }, to: { x: 15, y: 15 }, path: [] },
        reactionOpportunities: [],
        resolvedReactions: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      };

      await repo.create(action1);
      await repo.create(action2);
      await repo.create(action3);

      const enc1Actions = await repo.listByEncounter("enc_1");
      expect(enc1Actions).toHaveLength(2);
      expect(enc1Actions.map(a => a.id)).toEqual(["move_1", "move_2"]);

      const enc2Actions = await repo.listByEncounter("enc_2");
      expect(enc2Actions).toHaveLength(1);
      expect(enc2Actions[0].id).toBe("move_3");
    });
  });

  describe("addReactionResponse", () => {
    it("should add a reaction response", async () => {
      const opportunity: ReactionOpportunity = {
        id: "opp_1",
        combatantId: "fighter_1",
        reactionType: "opportunity_attack",
        canUse: true,
        context: {},
      };

      const pendingAction: PendingAction = {
        id: "move_789",
        encounterId: "enc_1",
        actor: { type: "Monster", monsterId: "goblin_1" },
        type: "move",
        data: { type: "move", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, path: [] },
        reactionOpportunities: [opportunity],
        resolvedReactions: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      };

      await repo.create(pendingAction);

      const response = {
        opportunityId: "opp_1",
        combatantId: "fighter_1",
        choice: "use" as const,
        respondedAt: new Date(),
      };

      const updated = await repo.addReactionResponse("move_789", response);

      expect(updated.resolvedReactions).toHaveLength(1);
      expect(updated.resolvedReactions[0]).toMatchObject({
        opportunityId: "opp_1",
        combatantId: "fighter_1",
        choice: "use",
      });
    });

    it("should update status to ready_to_complete when all reactions resolved", async () => {
      const opportunity: ReactionOpportunity = {
        id: "opp_1",
        combatantId: "fighter_1",
        reactionType: "opportunity_attack",
        canUse: true,
        context: {},
      };

      const pendingAction: PendingAction = {
        id: "move_complete",
        encounterId: "enc_1",
        actor: { type: "Monster", monsterId: "goblin_1" },
        type: "move",
        data: { type: "move", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, path: [] },
        reactionOpportunities: [opportunity],
        resolvedReactions: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      };

      await repo.create(pendingAction);

      const response = {
        opportunityId: "opp_1",
        combatantId: "fighter_1",
        choice: "decline" as const,
        respondedAt: new Date(),
      };

      await repo.addReactionResponse("move_complete", response);

      const status = await repo.getStatus("move_complete");
      expect(status).toBe("ready_to_complete");
    });

    it("should throw error for non-existent action", async () => {
      const response = {
        opportunityId: "opp_1",
        combatantId: "fighter_1",
        choice: "use" as const,
        respondedAt: new Date(),
      };

      await expect(repo.addReactionResponse("nonexistent", response)).rejects.toThrow(
        "Pending action not found: nonexistent"
      );
    });
  });

  describe("getStatus", () => {
    it("should return expired status for expired actions", async () => {
      const pendingAction: PendingAction = {
        id: "move_expired",
        encounterId: "enc_1",
        actor: { type: "Monster", monsterId: "goblin_1" },
        type: "move",
        data: { type: "move", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, path: [] },
        reactionOpportunities: [],
        resolvedReactions: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      };

      await repo.create(pendingAction);

      const status = await repo.getStatus("move_expired");
      expect(status).toBe("expired");
    });

    it("should throw error for non-existent action", async () => {
      await expect(repo.getStatus("nonexistent")).rejects.toThrow(
        "Pending action not found: nonexistent"
      );
    });
  });

  describe("markCompleted", () => {
    it("should update status to completed", async () => {
      const pendingAction: PendingAction = {
        id: "move_done",
        encounterId: "enc_1",
        actor: { type: "Monster", monsterId: "goblin_1" },
        type: "move",
        data: { type: "move", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, path: [] },
        reactionOpportunities: [],
        resolvedReactions: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      };

      await repo.create(pendingAction);
      await repo.markCompleted("move_done");

      const status = await repo.getStatus("move_done");
      expect(status).toBe("completed");
    });
  });

  describe("markCancelled", () => {
    it("should update status to cancelled", async () => {
      const pendingAction: PendingAction = {
        id: "move_cancel",
        encounterId: "enc_1",
        actor: { type: "Monster", monsterId: "goblin_1" },
        type: "move",
        data: { type: "move", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, path: [] },
        reactionOpportunities: [],
        resolvedReactions: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      };

      await repo.create(pendingAction);
      await repo.markCancelled("move_cancel");

      const status = await repo.getStatus("move_cancel");
      expect(status).toBe("cancelled");
    });
  });

  describe("delete", () => {
    it("should remove action", async () => {
      const pendingAction: PendingAction = {
        id: "move_delete",
        encounterId: "enc_1",
        actor: { type: "Monster", monsterId: "goblin_1" },
        type: "move",
        data: { type: "move", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, path: [] },
        reactionOpportunities: [],
        resolvedReactions: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      };

      await repo.create(pendingAction);
      expect(await repo.getById("move_delete")).not.toBeNull();

      await repo.delete("move_delete");
      expect(await repo.getById("move_delete")).toBeNull();
    });
  });

  describe("cleanupExpired", () => {
    it("should remove expired actions", async () => {
      const activeAction: PendingAction = {
        id: "move_active",
        encounterId: "enc_1",
        actor: { type: "Monster", monsterId: "goblin_1" },
        type: "move",
        data: { type: "move", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, path: [] },
        reactionOpportunities: [],
        resolvedReactions: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000), // Still valid
      };

      const expiredAction: PendingAction = {
        id: "move_old",
        encounterId: "enc_1",
        actor: { type: "Monster", monsterId: "goblin_2" },
        type: "move",
        data: { type: "move", from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, path: [] },
        reactionOpportunities: [],
        resolvedReactions: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() - 1000), // Expired
      };

      await repo.create(activeAction);
      await repo.create(expiredAction);

      await repo.cleanupExpired();

      expect(await repo.getById("move_active")).not.toBeNull();
      expect(await repo.getById("move_old")).toBeNull();
    });
  });
});
