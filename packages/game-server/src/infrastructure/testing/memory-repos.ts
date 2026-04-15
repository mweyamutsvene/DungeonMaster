/**
 * In-memory repository implementations for testing.
 *
 * These provide the same interface as the Prisma repositories but store
 * everything in memory, enabling fast isolated tests without database.
 *
 * Extracted from app.test.ts for reuse across test harness and Vitest tests.
 */

import type {
  ICharacterRepository,
  CharacterUpdateData,
  ICombatRepository,
  IEventRepository,
  GameEventInput,
  IGameSessionRepository,
  IItemDefinitionRepository,
  IMonsterRepository,
  INPCRepository,
  ISpellRepository,
} from "../../application/repositories/index.js";
import type {
  CombatantStateRecord,
  CombatEncounterRecord,
  GameEventRecord,
  GameSessionRecord,
  JsonValue,
  SessionCharacterRecord,
  ItemDefinitionRecord,
  SessionMonsterRecord,
  SessionNPCRecord,
  SpellDefinitionRecord,
} from "../../application/types.js";

function now(): Date {
  return new Date();
}

// ============================================================================
// MemoryGameSessionRepository
// ============================================================================

export class MemoryGameSessionRepository implements IGameSessionRepository {
  private readonly sessions = new Map<string, GameSessionRecord>();

  async create(input: { id: string; storyFramework: JsonValue }): Promise<GameSessionRecord> {
    const created: GameSessionRecord = {
      id: input.id,
      storyFramework: input.storyFramework,
      createdAt: now(),
      updatedAt: now(),
    };
    this.sessions.set(created.id, created);
    return created;
  }

  async getById(id: string): Promise<GameSessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async listAll(input?: { limit?: number; offset?: number }): Promise<{ items: GameSessionRecord[]; total: number }> {
    const all = [...this.sessions.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const limit = input?.limit ?? 50;
    const offset = input?.offset ?? 0;
    return { items: all.slice(offset, offset + limit), total: all.length };
  }

  // Test helper: clear all sessions
  clear(): void {
    this.sessions.clear();
  }
}

// ============================================================================
// MemoryCharacterRepository
// ============================================================================

export class MemoryCharacterRepository implements ICharacterRepository {
  private readonly characters = new Map<string, SessionCharacterRecord>();

  async createInSession(
    sessionId: string,
    input: { id: string; name: string; level: number; className: string | null; sheet: JsonValue; faction?: string; aiControlled?: boolean },
  ): Promise<SessionCharacterRecord> {
    const created: SessionCharacterRecord = {
      id: input.id,
      sessionId,
      name: input.name,
      level: input.level,
      className: input.className,
      sheet: input.sheet,
      faction: input.faction ?? "party",
      aiControlled: input.aiControlled ?? false,
      createdAt: now(),
      updatedAt: now(),
    };
    this.characters.set(created.id, created);
    return created;
  }

  async getById(id: string): Promise<SessionCharacterRecord | null> {
    return this.characters.get(id) ?? null;
  }

  async getManyByIds(ids: string[]): Promise<SessionCharacterRecord[]> {
    return ids.map((id) => this.characters.get(id)).filter((c): c is SessionCharacterRecord => c !== undefined);
  }

  async listBySession(sessionId: string): Promise<SessionCharacterRecord[]> {
    return [...this.characters.values()].filter((c) => c.sessionId === sessionId);
  }

  async updateSheet(id: string, sheet: JsonValue): Promise<SessionCharacterRecord> {
    const existing = this.characters.get(id);
    if (!existing) throw new Error("Character not found: " + id);
    const updated: SessionCharacterRecord = { ...existing, sheet, updatedAt: now() };
    this.characters.set(id, updated);
    return updated;
  }

  async update(id: string, data: Partial<CharacterUpdateData>): Promise<SessionCharacterRecord> {
    const existing = this.characters.get(id);
    if (!existing) throw new Error("Character not found: " + id);
    const updated: SessionCharacterRecord = {
      ...existing,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.level !== undefined ? { level: data.level } : {}),
      ...(data.className !== undefined ? { className: data.className } : {}),
      ...(data.sheet !== undefined ? { sheet: data.sheet } : {}),
      ...(data.faction !== undefined ? { faction: data.faction } : {}),
      ...(data.aiControlled !== undefined ? { aiControlled: data.aiControlled } : {}),
      updatedAt: now(),
    };
    this.characters.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.characters.delete(id);
  }

  clear(): void {
    this.characters.clear();
  }
}

// ============================================================================
// MemoryMonsterRepository
// ============================================================================

export class MemoryMonsterRepository implements IMonsterRepository {
  private readonly monsters = new Map<string, SessionMonsterRecord>();

  async createInSession(
    sessionId: string,
    input: { id: string; name: string; monsterDefinitionId: string | null; statBlock: JsonValue },
  ): Promise<SessionMonsterRecord> {
    const created: SessionMonsterRecord = {
      id: input.id,
      sessionId,
      name: input.name,
      monsterDefinitionId: input.monsterDefinitionId,
      statBlock: input.statBlock,
      faction: "enemy",
      aiControlled: true,
      createdAt: now(),
      updatedAt: now(),
    };
    this.monsters.set(created.id, created);
    return created;
  }

  async createMany(
    sessionId: string,
    inputs: Array<{ id: string; name: string; monsterDefinitionId: string | null; statBlock: JsonValue }>,
  ): Promise<SessionMonsterRecord[]> {
    const results: SessionMonsterRecord[] = [];
    for (const input of inputs) {
      results.push(await this.createInSession(sessionId, input));
    }
    return results;
  }

  async getById(id: string): Promise<SessionMonsterRecord | null> {
    return this.monsters.get(id) ?? null;
  }

  async getManyByIds(ids: string[]): Promise<SessionMonsterRecord[]> {
    return ids.map((id) => this.monsters.get(id)).filter((m): m is SessionMonsterRecord => m !== undefined);
  }

  async listBySession(sessionId: string): Promise<SessionMonsterRecord[]> {
    return [...this.monsters.values()].filter((m) => m.sessionId === sessionId);
  }

  async delete(id: string): Promise<void> {
    this.monsters.delete(id);
  }

  async updateStatBlock(id: string, data: Partial<Record<string, unknown>>): Promise<SessionMonsterRecord> {
    const existing = this.monsters.get(id);
    if (!existing) throw new Error("Monster not found: " + id);
    const currentStatBlock = (existing.statBlock as Record<string, unknown>) ?? {};
    const merged = { ...currentStatBlock, ...data };
    const updated: SessionMonsterRecord = { ...existing, statBlock: merged, updatedAt: now() };
    this.monsters.set(id, updated);
    return updated;
  }

  clear(): void {
    this.monsters.clear();
  }
}

// ============================================================================
// MemoryCombatRepository
// ============================================================================

export class MemoryCombatRepository implements ICombatRepository {
  private readonly encounters = new Map<string, CombatEncounterRecord>();
  private readonly combatantsByEncounter = new Map<string, CombatantStateRecord[]>();
  private readonly pendingActionsByEncounter = new Map<string, JsonValue[]>();
  private readonly battlePlansByEncounter = new Map<string, Record<string, JsonValue>>();

  /** Optional entity repos for resolving character/monster/npc relations in listCombatants. */
  private characterRepo?: MemoryCharacterRepository;
  private monsterRepo?: MemoryMonsterRepository;
  private npcRepo?: MemoryNPCRepository;

  /**
   * Link entity repos so listCombatants can include relation data (faction, aiControlled).
   * Mirrors Prisma's include behavior. Standalone tests that don't need relations can skip this.
   */
  linkEntityRepos(chars: MemoryCharacterRepository, monsters: MemoryMonsterRepository, npcs: MemoryNPCRepository): void {
    this.characterRepo = chars;
    this.monsterRepo = monsters;
    this.npcRepo = npcs;
  }

  async createEncounter(
    sessionId: string,
    input: { id: string; status: string; round: number; turn: number; mapData?: JsonValue; surprise?: JsonValue },
  ): Promise<CombatEncounterRecord> {
    const created: CombatEncounterRecord = {
      id: input.id,
      sessionId,
      status: input.status,
      round: input.round,
      turn: input.turn,
      mapData: input.mapData,
      surprise: input.surprise,
      createdAt: now(),
      updatedAt: now(),
    };
    this.encounters.set(created.id, created);
    return created;
  }

  async listEncountersBySession(sessionId: string): Promise<CombatEncounterRecord[]> {
    return [...this.encounters.values()]
      .filter((e) => e.sessionId === sessionId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getEncounterById(id: string): Promise<CombatEncounterRecord | null> {
    return this.encounters.get(id) ?? null;
  }

  async updateEncounter(
    id: string,
    patch: Partial<Pick<CombatEncounterRecord, "status" | "round" | "turn" | "mapData" | "surprise" | "battlePlans">>,
  ): Promise<CombatEncounterRecord> {
    const existing = this.encounters.get(id);
    if (!existing) throw new Error("Encounter not found: " + id);
    const next: CombatEncounterRecord = {
      ...existing,
      ...patch,
      updatedAt: now(),
    };
    this.encounters.set(id, next);
    return next;
  }

  async listCombatants(encounterId: string): Promise<CombatantStateRecord[]> {
    const list = this.combatantsByEncounter.get(encounterId) ?? [];
    const sorted = [...list].sort((a, b) => {
      const ai = a.initiative ?? -Infinity;
      const bi = b.initiative ?? -Infinity;
      if (bi !== ai) return bi - ai;
      const ac = a.createdAt.getTime();
      const bc = b.createdAt.getTime();
      if (ac !== bc) return ac - bc;
      return a.id.localeCompare(b.id);
    });

    // Resolve relations if entity repos are linked (mirrors Prisma include)
    if (this.characterRepo || this.monsterRepo || this.npcRepo) {
      const results: CombatantStateRecord[] = [];
      for (const rec of sorted) {
        let character: CombatantStateRecord["character"];
        let monster: CombatantStateRecord["monster"];
        let npc: CombatantStateRecord["npc"];

        if (rec.characterId && this.characterRepo) {
          const ch = await this.characterRepo.getById(rec.characterId);
          if (ch) character = { faction: ch.faction, aiControlled: ch.aiControlled };
        }
        if (rec.monsterId && this.monsterRepo) {
          const m = await this.monsterRepo.getById(rec.monsterId);
          if (m) monster = { faction: m.faction, aiControlled: m.aiControlled };
        }
        if (rec.npcId && this.npcRepo) {
          const n = await this.npcRepo.getById(rec.npcId);
          if (n) npc = { faction: n.faction, aiControlled: n.aiControlled };
        }

        results.push({ ...rec, character, monster, npc });
      }
      return results;
    }

    return sorted;
  }

  async updateCombatantState(
    id: string,
    patch: Partial<Pick<CombatantStateRecord, "hpCurrent" | "hpMax" | "hpTemp" | "initiative" | "conditions" | "resources">>,
  ): Promise<CombatantStateRecord> {
    for (const [encounterId, list] of this.combatantsByEncounter.entries()) {
      const idx = list.findIndex((c) => c.id === id);
      if (idx === -1) continue;
      const existing = list[idx]!;
      const updated: CombatantStateRecord = {
        ...existing,
        ...patch,
        updatedAt: now(),
      };
      const next = [...list];
      next[idx] = updated;
      this.combatantsByEncounter.set(encounterId, next);
      return updated;
    }
    throw new Error("CombatantState not found: " + id);
  }

  async createCombatants(
    encounterId: string,
    combatants: Array<{
      id: string;
      combatantType: CombatantStateRecord["combatantType"];
      characterId: string | null;
      monsterId: string | null;
      npcId: string | null;
      initiative: number | null;
      hpCurrent: number;
      hpMax: number;
      hpTemp?: number;
      conditions: JsonValue;
      resources: JsonValue;
    }>,
  ): Promise<CombatantStateRecord[]> {
    const baseTime = now().getTime();

    const created = combatants.map((c, i) => {
      const rec: CombatantStateRecord = {
        id: c.id,
        encounterId,
        combatantType: c.combatantType,
        characterId: c.characterId,
        monsterId: c.monsterId,
        npcId: c.npcId,
        initiative: c.initiative,
        hpCurrent: c.hpCurrent,
        hpMax: c.hpMax,
        hpTemp: c.hpTemp ?? 0,
        conditions: c.conditions,
        resources: c.resources,
        createdAt: new Date(baseTime + i),
        updatedAt: new Date(baseTime + i),
      };
      return rec;
    });

    this.combatantsByEncounter.set(encounterId, created);
    return created;
  }

  async setPendingAction(encounterId: string, action: JsonValue): Promise<void> {
    if (action === null || action === undefined) {
      // null push = clear (backward compat)
      const queue = this.pendingActionsByEncounter.get(encounterId) ?? [];
      queue.shift();
      if (queue.length > 0) this.pendingActionsByEncounter.set(encounterId, queue);
      else this.pendingActionsByEncounter.delete(encounterId);
      return;
    }
    const queue = this.pendingActionsByEncounter.get(encounterId) ?? [];
    queue.push(action);
    this.pendingActionsByEncounter.set(encounterId, queue);
  }

  async getPendingAction(encounterId: string): Promise<JsonValue | null> {
    return this.pendingActionsByEncounter.get(encounterId)?.[0] ?? null;
  }

  async clearPendingAction(encounterId: string): Promise<void> {
    const queue = this.pendingActionsByEncounter.get(encounterId);
    if (!queue || queue.length === 0) {
      this.pendingActionsByEncounter.delete(encounterId);
      return;
    }
    queue.shift();
    if (queue.length === 0) this.pendingActionsByEncounter.delete(encounterId);
  }

  async findActiveEncounter(sessionId: string): Promise<CombatEncounterRecord | null> {
    const encounters = await this.listEncountersBySession(sessionId);
    return encounters.find((e) => e.status === "Active") ?? null;
  }

  async findById(encounterId: string): Promise<CombatEncounterRecord | null> {
    return this.getEncounterById(encounterId);
  }

  async startCombat(
    encounterId: string,
    initiatives: Record<string, number>,
  ): Promise<CombatEncounterRecord> {
    const combatants = await this.listCombatants(encounterId);
    await Promise.all(
      combatants.map((c) =>
        this.updateCombatantState(c.id, {
          initiative: initiatives[c.id] ?? c.initiative ?? null,
        }),
      ),
    );
    return this.updateEncounter(encounterId, { status: "Active" });
  }

  async getBattlePlan(encounterId: string, faction: string): Promise<JsonValue | null> {
    const plans = this.battlePlansByEncounter.get(encounterId);
    if (!plans) return null;
    return plans[faction] ?? null;
  }

  async updateBattlePlan(encounterId: string, faction: string, plan: JsonValue): Promise<void> {
    const existing = this.battlePlansByEncounter.get(encounterId) ?? {};
    existing[faction] = plan;
    this.battlePlansByEncounter.set(encounterId, existing);
  }

  clear(): void {
    this.encounters.clear();
    this.combatantsByEncounter.clear();
    this.pendingActionsByEncounter.clear();
    this.battlePlansByEncounter.clear();
  }
}

// ============================================================================
// MemoryEventRepository
// ============================================================================

export class MemoryEventRepository implements IEventRepository {
  private readonly events: GameEventRecord[] = [];

  async append(
    sessionId: string,
    input: { id: string } & GameEventInput,
    combatContext?: { encounterId: string; round: number; turnNumber: number },
  ): Promise<GameEventRecord> {
    const created: GameEventRecord = {
      id: input.id,
      sessionId,
      type: input.type,
      payload: input.payload as JsonValue,
      ...(combatContext ? {
        encounterId: combatContext.encounterId,
        round: combatContext.round,
        turnNumber: combatContext.turnNumber,
      } : {}),
      createdAt: now(),
    };
    this.events.push(created);
    return created;
  }

  async listBySession(
    sessionId: string,
    input?: { limit?: number; since?: Date },
  ): Promise<GameEventRecord[]> {
    const filtered = this.events
      .filter((e) => e.sessionId === sessionId)
      .filter((e) => (input?.since ? e.createdAt > input.since : true));

    const limit = input?.limit ?? 100;
    return filtered.slice(-limit);
  }

  async listByEncounter(
    encounterId: string,
    input?: { limit?: number; round?: number },
  ): Promise<GameEventRecord[]> {
    const filtered = this.events
      .filter((e) => e.encounterId === encounterId)
      .filter((e) => (input?.round !== undefined ? e.round === input.round : true));

    const limit = input?.limit ?? 200;
    return filtered.slice(-limit);
  }

  clear(): void {
    this.events.length = 0;
  }

  // Test helper: get all events
  getAll(): GameEventRecord[] {
    return [...this.events];
  }
}

// ============================================================================
// MemorySpellRepository
// ============================================================================

export class MemorySpellRepository implements ISpellRepository {
  private readonly spells = new Map<string, SpellDefinitionRecord>();

  async getById(id: string): Promise<SpellDefinitionRecord | null> {
    return this.spells.get(id) ?? null;
  }

  async getByName(name: string): Promise<SpellDefinitionRecord | null> {
    for (const spell of this.spells.values()) {
      if (spell.name.toLowerCase() === name.toLowerCase()) {
        return spell;
      }
    }
    return null;
  }

  async listByLevel(level: number): Promise<SpellDefinitionRecord[]> {
    return [...this.spells.values()].filter((s) => s.level === level);
  }

  // Test helper: add a spell
  addSpell(spell: SpellDefinitionRecord): void {
    this.spells.set(spell.id, spell);
  }

  clear(): void {
    this.spells.clear();
  }
}

// ============================================================================
// MemoryItemDefinitionRepository
// ============================================================================

export class MemoryItemDefinitionRepository implements IItemDefinitionRepository {
  private readonly itemsById = new Map<string, ItemDefinitionRecord>();

  async findById(id: string): Promise<ItemDefinitionRecord | null> {
    return this.itemsById.get(id) ?? null;
  }

  async findByName(name: string): Promise<ItemDefinitionRecord | null> {
    const lowerName = name.toLowerCase();
    for (const item of this.itemsById.values()) {
      if (item.name.toLowerCase() === lowerName) {
        return item;
      }
    }
    return null;
  }

  async listAll(): Promise<ItemDefinitionRecord[]> {
    return [...this.itemsById.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async upsert(item: {
    id: string;
    name: string;
    category: string;
    data: JsonValue;
  }): Promise<ItemDefinitionRecord> {
    const existing = this.itemsById.get(item.id);
    const timestamp = now();
    const record: ItemDefinitionRecord = {
      id: item.id,
      name: item.name,
      category: item.category,
      data: item.data,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.itemsById.set(item.id, record);
    return record;
  }

  clear(): void {
    this.itemsById.clear();
  }
}

// ============================================================================
// MemoryNPCRepository
// ============================================================================

export class MemoryNPCRepository implements INPCRepository {
  private readonly npcs = new Map<string, SessionNPCRecord>();

  async createInSession(
    sessionId: string,
    input: { id: string; name: string; statBlock: JsonValue; faction?: string; aiControlled?: boolean },
  ): Promise<SessionNPCRecord> {
    const created: SessionNPCRecord = {
      id: input.id,
      sessionId,
      name: input.name,
      statBlock: input.statBlock,
      faction: input.faction ?? "party",
      aiControlled: input.aiControlled ?? true,
      createdAt: now(),
      updatedAt: now(),
    };
    this.npcs.set(created.id, created);
    return created;
  }

  async createMany(
    sessionId: string,
    inputs: Array<{ id: string; name: string; statBlock: JsonValue; faction?: string; aiControlled?: boolean }>,
  ): Promise<SessionNPCRecord[]> {
    const results: SessionNPCRecord[] = [];
    for (const input of inputs) {
      results.push(await this.createInSession(sessionId, input));
    }
    return results;
  }

  async getById(id: string): Promise<SessionNPCRecord | null> {
    return this.npcs.get(id) ?? null;
  }

  async getManyByIds(ids: string[]): Promise<SessionNPCRecord[]> {
    return ids.map((id) => this.npcs.get(id)).filter((n): n is SessionNPCRecord => n !== undefined);
  }

  async listBySession(sessionId: string): Promise<SessionNPCRecord[]> {
    return [...this.npcs.values()].filter((n) => n.sessionId === sessionId);
  }

  async delete(id: string): Promise<void> {
    this.npcs.delete(id);
  }

  async updateStatBlock(id: string, data: Partial<Record<string, unknown>>): Promise<SessionNPCRecord> {
    const existing = this.npcs.get(id);
    if (!existing) throw new Error("NPC not found: " + id);
    const currentStatBlock = (existing.statBlock as Record<string, unknown>) ?? {};
    const merged = { ...currentStatBlock, ...data };
    const updated: SessionNPCRecord = { ...existing, statBlock: merged, updatedAt: now() };
    this.npcs.set(id, updated);
    return updated;
  }

  clear(): void {
    this.npcs.clear();
  }
}

// ============================================================================
// InMemoryPendingActionRepository
// ============================================================================

import type { PendingActionRepository } from "../../application/repositories/pending-action-repository.js";
import type { PendingAction, PendingActionStatus, ReactionResponse, ReactionOpportunity, ReactionResult } from "../../domain/entities/combat/pending-action.js";

export class InMemoryPendingActionRepository implements PendingActionRepository {
  private actions = new Map<string, PendingAction>();
  private statuses = new Map<string, PendingActionStatus>();

  async create(action: PendingAction): Promise<PendingAction> {
    this.actions.set(action.id, action);
    this.statuses.set(action.id, "awaiting_reactions");
    return action;
  }

  async getById(actionId: string): Promise<PendingAction | null> {
    return this.actions.get(actionId) ?? null;
  }

  async listByEncounter(encounterId: string): Promise<PendingAction[]> {
    return Array.from(this.actions.values()).filter(a => a.encounterId === encounterId);
  }

  async addReactionResponse(actionId: string, response: ReactionResponse): Promise<PendingAction> {
    const action = this.actions.get(actionId);
    if (!action) {
      throw new Error(`Pending action not found: ${actionId}`);
    }

    action.resolvedReactions.push(response);

    const allResolved = action.reactionOpportunities.every((opp: ReactionOpportunity) =>
      action.resolvedReactions.some((r: ReactionResponse) => r.opportunityId === opp.id)
    );

    if (allResolved) {
      this.statuses.set(actionId, "ready_to_complete");
    }

    return action;
  }

  async getStatus(actionId: string): Promise<PendingActionStatus> {
    const status = this.statuses.get(actionId);
    if (!status) {
      throw new Error(`Pending action not found: ${actionId}`);
    }

    const action = this.actions.get(actionId);
    if (action && action.expiresAt < new Date()) {
      this.statuses.set(actionId, "expired");
      return "expired";
    }

    return status;
  }

  async markCompleted(actionId: string): Promise<void> {
    this.statuses.set(actionId, "completed");
  }

  async markCancelled(actionId: string): Promise<void> {
    this.statuses.set(actionId, "cancelled");
  }

  async delete(actionId: string): Promise<void> {
    this.actions.delete(actionId);
    this.statuses.delete(actionId);
  }

  async update(action: PendingAction): Promise<PendingAction> {
    this.actions.set(action.id, action);
    return action;
  }

  async updateReactionResult(actionId: string, opportunityId: string, result: ReactionResult): Promise<void> {
    const action = this.actions.get(actionId);
    if (!action) {
      throw new Error(`Pending action not found: ${actionId}`);
    }

    const reaction = action.resolvedReactions.find((r: ReactionResponse) => r.opportunityId === opportunityId);
    if (reaction) {
      reaction.result = result;
    }
  }

  async cleanupExpired(): Promise<void> {
    const now = new Date();
    for (const [id, action] of this.actions.entries()) {
      if (action.expiresAt < now) {
        await this.delete(id);
      }
    }
  }

  clear(): void {
    this.actions.clear();
    this.statuses.clear();
  }
}

// ============================================================================
// Factory: Create all repos at once
// ============================================================================

export interface InMemoryRepos {
  sessionsRepo: MemoryGameSessionRepository;
  charactersRepo: MemoryCharacterRepository;
  monstersRepo: MemoryMonsterRepository;
  npcsRepo: MemoryNPCRepository;
  combatRepo: MemoryCombatRepository;
  eventsRepo: MemoryEventRepository;
  spellsRepo: MemorySpellRepository;
  itemDefinitionsRepo: MemoryItemDefinitionRepository;
  pendingActionsRepo: InMemoryPendingActionRepository;
}

export function createInMemoryRepos(): InMemoryRepos {
  const charactersRepo = new MemoryCharacterRepository();
  const monstersRepo = new MemoryMonsterRepository();
  const npcsRepo = new MemoryNPCRepository();
  const combatRepo = new MemoryCombatRepository();
  combatRepo.linkEntityRepos(charactersRepo, monstersRepo, npcsRepo);

  return {
    sessionsRepo: new MemoryGameSessionRepository(),
    charactersRepo,
    monstersRepo,
    npcsRepo,
    combatRepo,
    eventsRepo: new MemoryEventRepository(),
    spellsRepo: new MemorySpellRepository(),
    itemDefinitionsRepo: new MemoryItemDefinitionRepository(),
    pendingActionsRepo: new InMemoryPendingActionRepository(),
  };
}

export function clearAllRepos(repos: InMemoryRepos): void {
  repos.sessionsRepo.clear();
  repos.charactersRepo.clear();
  repos.monstersRepo.clear();
  repos.npcsRepo.clear();
  repos.combatRepo.clear();
  repos.eventsRepo.clear();
  repos.spellsRepo.clear();
  repos.itemDefinitionsRepo.clear();
  repos.pendingActionsRepo.clear();
}
