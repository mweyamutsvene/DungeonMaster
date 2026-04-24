/**
 * InventoryService — application-layer service for multi-character inventory
 * operations that need transactional guarantees.
 *
 * Covers:
 *   - `transferItem` — atomic move of N items between two characters with
 *     optimistic concurrency (via `sheetVersion`) + single retry.
 *   - `createItemsForCharacter` — add items to a sheet (used by spell
 *     side-effect processor in Commit 5 and external scripts).
 *   - `applyLongRestToInventory` — decrement `longRestsRemaining` and prune
 *     stacks that reach 0 (called on long rest).
 *   - `sweepExpiredItems` — prune stacks whose `longRestsRemaining` is
 *     already 0 (safety net, called at combat start).
 *
 * Design:
 * - Prefers `unitOfWork.run(repos => ...)` for transactional integrity.
 *   When `unitOfWork` is absent (tests using MemoryRepos), falls back to
 *   direct repo calls on the injected fallback `charactersRepo` / events
 *   repo; a WARN is logged to make the lack of transactionality explicit.
 * - All writes go through `updateSheetWithVersion` where cross-character
 *   races are possible (transfer). Single-character writes use `updateSheet`.
 * - Events emitted via whichever `IEventRepository` the caller provided
 *   (deferred when inside a UoW; immediate otherwise).
 */

import { nanoid } from "nanoid";

import type { ICharacterRepository } from "../../repositories/character-repository.js";
import type { IEventRepository } from "../../repositories/event-repository.js";
import type { InventoryChangedPayload } from "../../repositories/event-repository.js";
import type { JsonValue, SessionCharacterRecord } from "../../types.js";
import { ConflictError, NotFoundError, ValidationError } from "../../errors.js";
import type { CharacterItemInstance } from "../../../domain/entities/items/magic-item.js";
import {
  addInventoryItem,
  decrementItemExpiries,
  findInventoryItem,
  removeInventoryItem,
} from "../../../domain/entities/items/inventory.js";

/**
 * Abstraction around the Prisma UnitOfWork — duck-typed so this service can
 * be instantiated with either a real `PrismaUnitOfWork` or a minimal test
 * stub. Consumers only need the `run` method.
 */
export interface UnitOfWorkLike {
  run<T>(fn: (repos: InventoryUowRepos) => Promise<T>): Promise<T>;
}

/**
 * Subset of the full repo bundle that InventoryService uses inside a UoW.
 * Matches the shape exposed by `RepositoryBundle` in
 * `infrastructure/db/unit-of-work.ts`.
 */
export interface InventoryUowRepos {
  charactersRepo: ICharacterRepository;
  eventsRepo: IEventRepository;
}

export interface InventoryServiceDeps {
  charactersRepo: ICharacterRepository;
  events: IEventRepository;
  unitOfWork?: UnitOfWorkLike;
  logger?: { warn: (msg: string, ...rest: unknown[]) => void };
}

export interface TransferResult {
  fromInventory: CharacterItemInstance[];
  toInventory: CharacterItemInstance[];
  item: CharacterItemInstance;
  quantity: number;
}

export interface ExpirySweepResult {
  /** characterId → array of items removed during the sweep. */
  expiredByCharacter: Record<string, CharacterItemInstance[]>;
  /** Total stacks pruned across all characters. */
  totalStacksPruned: number;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getInventoryFromSheet(sheet: unknown): CharacterItemInstance[] {
  if (typeof sheet !== "object" || sheet === null) return [];
  const inv = (sheet as { inventory?: unknown }).inventory;
  return Array.isArray(inv) ? (inv as CharacterItemInstance[]) : [];
}

function setInventoryOnSheet(
  sheet: unknown,
  inventory: CharacterItemInstance[],
): Record<string, unknown> {
  const base = typeof sheet === "object" && sheet !== null ? { ...(sheet as Record<string, unknown>) } : {};
  return { ...base, inventory };
}

// ---------------------------------------------------------------------------
// InventoryService
// ---------------------------------------------------------------------------

export class InventoryService {
  constructor(private readonly deps: InventoryServiceDeps) {}

  /**
   * Atomically transfer `quantity` of `itemName` from one character to another.
   *
   * - Both characters must exist in the same session.
   * - `itemName` must exist on the source with at least `quantity`.
   * - Runs inside `unitOfWork.run` when available. Without a UoW, writes are
   *   serial on the fallback repos — a WARN is logged so tests see the gap.
   * - On `ConflictError` (sheetVersion mismatch) retries once with re-read
   *   sheets; on second failure surfaces the error.
   */
  async transferItem(
    sessionId: string,
    fromCharId: string,
    toCharId: string,
    itemName: string,
    quantity = 1,
  ): Promise<TransferResult> {
    if (quantity < 1 || !Number.isInteger(quantity)) {
      throw new ValidationError("quantity must be a positive integer");
    }
    if (fromCharId === toCharId) {
      throw new ValidationError("Cannot transfer items to the same character");
    }

    const attempt = async (repos: InventoryUowRepos): Promise<TransferResult> => {
      const from = await repos.charactersRepo.getById(fromCharId);
      if (!from || from.sessionId !== sessionId) {
        throw new NotFoundError(`Character not found: ${fromCharId}`);
      }
      const to = await repos.charactersRepo.getById(toCharId);
      if (!to || to.sessionId !== sessionId) {
        throw new NotFoundError(`Character not found: ${toCharId}`);
      }

      const fromInv = getInventoryFromSheet(from.sheet);
      const sourceItem = findInventoryItem(fromInv, itemName);
      if (!sourceItem) {
        throw new ValidationError(`Item "${itemName}" not found on ${from.name}`);
      }
      if (sourceItem.quantity < quantity) {
        throw new ValidationError(
          `Not enough "${itemName}" on ${from.name} (have ${sourceItem.quantity}, need ${quantity})`,
        );
      }
      // Transferred items cannot carry attunement (RAW: attunement breaks on handover).
      if (sourceItem.attuned) {
        throw new ValidationError(
          `Cannot transfer attuned item "${itemName}" — attunement must be broken first`,
        );
      }

      // Compute updated inventories
      const updatedFromInv = removeInventoryItem(fromInv, itemName, quantity);
      const moved: CharacterItemInstance = {
        ...sourceItem,
        // Moving strips equipped state — the recipient starts unequipped.
        equipped: false,
        attuned: false,
        slot: undefined,
        quantity,
      };
      const toInv = getInventoryFromSheet(to.sheet);
      const updatedToInv = addInventoryItem(toInv, moved);

      // Persist with optimistic concurrency on both sides.
      await repos.charactersRepo.updateSheetWithVersion(
        from.id,
        setInventoryOnSheet(from.sheet, updatedFromInv),
        from.sheetVersion,
      );
      await repos.charactersRepo.updateSheetWithVersion(
        to.id,
        setInventoryOnSheet(to.sheet, updatedToInv),
        to.sheetVersion,
      );

      await repos.eventsRepo.append(sessionId, {
        id: nanoid(),
        type: "InventoryChanged",
        payload: {
          characterId: from.id,
          characterName: from.name,
          action: "transfer-out",
          itemName: sourceItem.name,
          quantity,
          toCharacterId: to.id,
          toCharacterName: to.name,
        },
      });
      await repos.eventsRepo.append(sessionId, {
        id: nanoid(),
        type: "InventoryChanged",
        payload: {
          characterId: to.id,
          characterName: to.name,
          action: "transfer-in",
          itemName: sourceItem.name,
          quantity,
          fromCharacterId: from.id,
          fromCharacterName: from.name,
        },
      });

      return {
        fromInventory: updatedFromInv,
        toInventory: updatedToInv,
        item: moved,
        quantity,
      };
    };

    const runOnce = () => this.runInUow(attempt);
    try {
      return await runOnce();
    } catch (err) {
      if (err instanceof ConflictError) {
        // Single retry — caller's second version of the sheet may have
        // converged. If the retry also conflicts we surface the error.
        this.deps.logger?.warn?.(
          `[InventoryService.transferItem] ConflictError on first attempt; retrying once (${String(err.message)})`,
        );
        return await runOnce();
      }
      throw err;
    }
  }

  /**
   * Append items to a character's inventory. Used by the spell side-effect
   * processor (Commit 5) to persist runtime-created items (Goodberry).
   *
   * Does NOT use optimistic concurrency — callers that care about racing
   * (e.g. concurrent spell casts by the same character) should wrap this
   * in their own UoW + version guard. Single-character writes are usually
   * safe because the actor is the only mutator of their sheet at a time.
   */
  async createItemsForCharacter(
    sessionId: string,
    charId: string,
    items: CharacterItemInstance[],
  ): Promise<CharacterItemInstance[]> {
    if (items.length === 0) return [];

    const attempt = async (repos: InventoryUowRepos) => {
      const char = await repos.charactersRepo.getById(charId);
      if (!char || char.sessionId !== sessionId) {
        throw new NotFoundError(`Character not found: ${charId}`);
      }
      let inv = getInventoryFromSheet(char.sheet);
      for (const item of items) {
        inv = addInventoryItem(inv, item);
      }
      await repos.charactersRepo.updateSheet(char.id, setInventoryOnSheet(char.sheet, inv));
      for (const item of items) {
        await repos.eventsRepo.append(sessionId, {
          id: nanoid(),
          type: "InventoryChanged",
          payload: {
            characterId: char.id,
            characterName: char.name,
            action: "create",
            itemName: item.name,
            quantity: item.quantity,
          },
        });
      }
      return inv;
    };

    return this.runInUow(attempt);
  }

  /**
   * Called on long rest. Decrements `longRestsRemaining` on every stack that
   * has one; stacks reaching 0 are removed.
   */
  async applyLongRestToInventory(
    sessionId: string,
    charIds: readonly string[],
  ): Promise<ExpirySweepResult> {
    return this.mutateEachCharacter(sessionId, charIds, (inv) => decrementItemExpiries(inv), "expire");
  }

  /**
   * Called at combat start. Prunes stacks whose `longRestsRemaining` is
   * already 0 (cleanup safety net). Does NOT decrement.
   */
  async sweepExpiredItems(
    sessionId: string,
    charIds: readonly string[],
  ): Promise<ExpirySweepResult> {
    return this.mutateEachCharacter(
      sessionId,
      charIds,
      (inv) => {
        const expired: CharacterItemInstance[] = [];
        const updated: CharacterItemInstance[] = [];
        for (const item of inv) {
          if (item.longRestsRemaining === 0) {
            expired.push(item);
          } else {
            updated.push(item);
          }
        }
        return { updated, expired };
      },
      "expire",
    );
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Apply a pure mutation (inventory → {updated, expired}) to every supplied
   * character, persist the result, and emit one InventoryChanged event per
   * removed stack.
   */
  private async mutateEachCharacter(
    sessionId: string,
    charIds: readonly string[],
    mutate: (
      inv: CharacterItemInstance[],
    ) => { updated: CharacterItemInstance[]; expired: CharacterItemInstance[] },
    eventAction: InventoryChangedPayload["action"],
  ): Promise<ExpirySweepResult> {
    if (charIds.length === 0) {
      return { expiredByCharacter: {}, totalStacksPruned: 0 };
    }

    const attempt = async (repos: InventoryUowRepos): Promise<ExpirySweepResult> => {
      const expiredByCharacter: Record<string, CharacterItemInstance[]> = {};
      let totalStacksPruned = 0;

      for (const id of charIds) {
        const char = await repos.charactersRepo.getById(id);
        if (!char || char.sessionId !== sessionId) continue;

        const inv = getInventoryFromSheet(char.sheet);
        if (inv.length === 0) continue;

        const { updated, expired } = mutate(inv);
        if (expired.length === 0 && updated.length === inv.length) {
          // No actual change — skip the write.
          continue;
        }

        await repos.charactersRepo.updateSheet(
          char.id,
          setInventoryOnSheet(char.sheet, updated),
        );

        if (expired.length > 0) {
          expiredByCharacter[char.id] = expired;
          totalStacksPruned += expired.length;
          for (const item of expired) {
            await repos.eventsRepo.append(sessionId, {
              id: nanoid(),
              type: "InventoryChanged",
              payload: {
                characterId: char.id,
                characterName: char.name,
                action: eventAction,
                itemName: item.name,
                quantity: item.quantity,
              },
            });
          }
        }
      }

      return { expiredByCharacter, totalStacksPruned };
    };

    return this.runInUow(attempt);
  }

  private async runInUow<T>(fn: (repos: InventoryUowRepos) => Promise<T>): Promise<T> {
    if (this.deps.unitOfWork) {
      return this.deps.unitOfWork.run(fn);
    }
    this.deps.logger?.warn?.(
      "[InventoryService] running without a UnitOfWork — writes are not transactional",
    );
    const repos: InventoryUowRepos = {
      charactersRepo: this.deps.charactersRepo,
      eventsRepo: this.deps.events,
    };
    return fn(repos);
  }
}

// ---------------------------------------------------------------------------
// Narrow helpers exported for use by other services without constructing
// an InventoryService instance.
// ---------------------------------------------------------------------------

/**
 * Read the current sheet of a character and produce an updated sheet with
 * `items` appended to its inventory array. Pure — caller persists.
 *
 * Used by the spell side-effect processor (Commit 5) when it needs to both
 * write the sheet AND update a live combatant's resources.inventory without
 * going through the async InventoryService flow.
 */
export function appendItemsToSheetInventory(
  char: SessionCharacterRecord,
  items: readonly CharacterItemInstance[],
): { sheet: JsonValue; inventory: CharacterItemInstance[] } {
  let inv = getInventoryFromSheet(char.sheet);
  for (const item of items) {
    inv = addInventoryItem(inv, item);
  }
  return { sheet: setInventoryOnSheet(char.sheet, inv), inventory: inv };
}
