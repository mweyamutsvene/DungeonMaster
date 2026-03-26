import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  ICharacterRepository,
  ICombatRepository,
  IEventRepository,
  IGameSessionRepository,
  IMonsterRepository,
  INPCRepository,
  ISpellRepository,
} from "../../application/repositories/index.js";
import type { PendingActionRepository } from "../../application/repositories/pending-action-repository.js";

import { PrismaCharacterRepository } from "./character-repository.js";
import { PrismaCombatRepository } from "./combat-repository.js";
import { PrismaEventRepository } from "./event-repository.js";
import { PrismaGameSessionRepository } from "./game-session-repository.js";
import { PrismaMonsterRepository } from "./monster-repository.js";
import { PrismaNPCRepository } from "./npc-repository.js";
import { PrismaSpellRepository } from "./spell-repository.js";
import { PrismaPendingActionRepository } from "./pending-action-repository.js";
import {
  DeferredPublishingEventRepository,
  publishDeferredEvents,
  type DeferredEvent,
} from "./deferred-publishing-event-repository.js";

export type RepositoryBundle = {
  sessionsRepo: IGameSessionRepository;
  charactersRepo: ICharacterRepository;
  monstersRepo: IMonsterRepository;
  npcsRepo: INPCRepository;
  combatRepo: ICombatRepository;
  eventsRepo: IEventRepository;
  spellsRepo: ISpellRepository;
  pendingActionsRepo: PendingActionRepository;
};

/**
 * Transaction boundary for multi-repository operations.
 * Layer: Infrastructure (DB adapter).
 * Notes: Runs app logic in a Prisma transaction and publishes buffered SSE events after commit.
 */
export class PrismaUnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  async run<T>(fn: (repos: RepositoryBundle) => Promise<T>): Promise<T> {
    const deferred: DeferredEvent[] = [];

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const events = new DeferredPublishingEventRepository(new PrismaEventRepository(tx), deferred);

      const repos: RepositoryBundle = {
        sessionsRepo: new PrismaGameSessionRepository(tx),
        charactersRepo: new PrismaCharacterRepository(tx),
        monstersRepo: new PrismaMonsterRepository(tx),
        npcsRepo: new PrismaNPCRepository(tx),
        combatRepo: new PrismaCombatRepository(tx),
        eventsRepo: events,
        spellsRepo: new PrismaSpellRepository(tx),
        pendingActionsRepo: new PrismaPendingActionRepository(tx),
      };

      return fn(repos);
    });

    publishDeferredEvents(deferred);
    return result;
  }
}