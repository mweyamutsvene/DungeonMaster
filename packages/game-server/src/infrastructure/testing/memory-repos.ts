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
  ICombatRepository,
  IEventRepository,
  IGameSessionRepository,
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
    input: { id: string; name: string; level: number; className: string | null; sheet: JsonValue },
  ): Promise<SessionCharacterRecord> {
    const created: SessionCharacterRecord = {
      id: input.id,
      sessionId,
      name: input.name,
      level: input.level,
      className: input.className,
      sheet: input.sheet,
      faction: "party",
      aiControlled: false,
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

  async getById(id: string): Promise<SessionMonsterRecord | null> {
    return this.monsters.get(id) ?? null;
  }

  async getManyByIds(ids: string[]): Promise<SessionMonsterRecord[]> {
    return ids.map((id) => this.monsters.get(id)).filter((m): m is SessionMonsterRecord => m !== undefined);
  }

  async listBySession(sessionId: string): Promise<SessionMonsterRecord[]> {
    return [...this.monsters.values()].filter((m) => m.sessionId === sessionId);
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
  private readonly pendingActionsByEncounter = new Map<string, JsonValue>();
  private readonly battlePlansByEncounter = new Map<string, Record<string, JsonValue>>();

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
    return [...list].sort((a, b) => {
      const ai = a.initiative ?? -Infinity;
      const bi = b.initiative ?? -Infinity;
      if (bi !== ai) return bi - ai;
      const ac = a.createdAt.getTime();
      const bc = b.createdAt.getTime();
      if (ac !== bc) return ac - bc;
      return a.id.localeCompare(b.id);
    });
  }

  async updateCombatantState(
    id: string,
    patch: Partial<Pick<CombatantStateRecord, "hpCurrent" | "hpMax" | "initiative" | "conditions" | "resources">>,
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
    this.pendingActionsByEncounter.set(encounterId, action);
  }

  async getPendingAction(encounterId: string): Promise<JsonValue | null> {
    return this.pendingActionsByEncounter.get(encounterId) ?? null;
  }

  async clearPendingAction(encounterId: string): Promise<void> {
    this.pendingActionsByEncounter.delete(encounterId);
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
    input: { id: string; type: string; payload: JsonValue },
  ): Promise<GameEventRecord> {
    const created: GameEventRecord = {
      id: input.id,
      sessionId,
      type: input.type,
      payload: input.payload,
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
      faction: input.faction ?? "neutral",
      aiControlled: input.aiControlled ?? false,
      createdAt: now(),
      updatedAt: now(),
    };
    this.npcs.set(created.id, created);
    return created;
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

  clear(): void {
    this.npcs.clear();
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
}

export function createInMemoryRepos(): InMemoryRepos {
  return {
    sessionsRepo: new MemoryGameSessionRepository(),
    charactersRepo: new MemoryCharacterRepository(),
    monstersRepo: new MemoryMonsterRepository(),
    npcsRepo: new MemoryNPCRepository(),
    combatRepo: new MemoryCombatRepository(),
    eventsRepo: new MemoryEventRepository(),
    spellsRepo: new MemorySpellRepository(),
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
}
