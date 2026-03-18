import { nanoid } from "nanoid";

import { NotFoundError, ValidationError } from "../../errors.js";
import type { ICharacterRepository } from "../../repositories/character-repository.js";
import type { IEventRepository } from "../../repositories/event-repository.js";
import type { IGameSessionRepository } from "../../repositories/game-session-repository.js";
import type { JsonValue, SessionCharacterRecord } from "../../types.js";
import { refreshClassResourcePools, type RestType } from "../../../domain/rules/rest.js";
import type { ResourcePool } from "../../../domain/entities/combat/resource-pool.js";
import type { CharacterClassId } from "../../../domain/entities/classes/class-definition.js";
import { enrichSheetAttacks } from "../../../domain/entities/items/weapon-catalog.js";
import { enrichSheetArmor } from "../../../domain/entities/items/armor-catalog.js";

/**
 * Character CRUD for a given game session.
 * Layer: Application.
 * Notes: Validates inputs and emits game events via `IEventRepository` when configured.
 */
export class CharacterService {
  constructor(
    private readonly sessions: IGameSessionRepository,
    private readonly characters: ICharacterRepository,
    private readonly events?: IEventRepository,
  ) {}

  async addCharacter(
    sessionId: string,
    input: {
      name: string;
      level: number;
      className?: string | null;
      sheet: JsonValue;
      id?: string;
    },
  ): Promise<SessionCharacterRecord> {
    const session = await this.sessions.getById(sessionId);
    if (!session) throw new NotFoundError(`Session not found: ${sessionId}`);

    if (!input.name.trim()) throw new ValidationError("Character name is required");
    if (!Number.isInteger(input.level) || input.level < 1 || input.level > 20) {
      throw new ValidationError("Character level must be 1-20");
    }

    const id = input.id ?? nanoid();

    // Enrich sheet with canonical weapon properties and armor metadata from catalogs
    let sheet = (typeof input.sheet === "object" && input.sheet !== null)
      ? enrichSheetArmor(enrichSheetAttacks(input.sheet as Record<string, unknown>))
      : input.sheet;

    const created = await this.characters.createInSession(sessionId, {
      id,
      name: input.name,
      level: input.level,
      className: input.className ?? null,
      sheet,
    });

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "CharacterAdded",
        payload: { characterId: id, name: input.name, level: input.level },
      });
    }

    return created;
  }

  async listCharacters(sessionId: string): Promise<SessionCharacterRecord[]> {
    const session = await this.sessions.getById(sessionId);
    if (!session) throw new NotFoundError(`Session not found: ${sessionId}`);
    return this.characters.listBySession(sessionId);
  }

  async getCharacterOrThrow(id: string): Promise<SessionCharacterRecord> {
    const character = await this.characters.getById(id);
    if (!character) throw new NotFoundError(`Character not found: ${id}`);
    return character;
  }

  /**
   * Take a short or long rest for all characters in a session.
   * Refreshes class resource pools and (on long rest) restores HP.
   */
  async takeSessionRest(
    sessionId: string,
    restType: RestType,
  ): Promise<{ characters: Array<{ id: string; name: string; poolsRefreshed: string[] }> }> {
    const session = await this.sessions.getById(sessionId);
    if (!session) throw new NotFoundError(`Session not found: ${sessionId}`);

    const characters = await this.characters.listBySession(sessionId);
    const results: Array<{ id: string; name: string; poolsRefreshed: string[] }> = [];

    for (const char of characters) {
      const sheet = (char.sheet as Record<string, unknown>) ?? {};
      const className = char.className ?? (sheet.className as string | undefined) ?? "";
      const level = char.level ?? 1;
      const pools: ResourcePool[] = Array.isArray(sheet.resourcePools)
        ? (sheet.resourcePools as ResourcePool[])
        : [];

      // Refresh class resource pools
      const charismaScore = (sheet.abilityScores as any)?.charisma ?? 10;
      const charismaMod = Math.floor((charismaScore - 10) / 2);
      const beforePools = pools.map(p => ({ ...p }));
      const refreshedPools = refreshClassResourcePools({
        classId: className.toLowerCase() as CharacterClassId,
        level,
        rest: restType,
        pools,
        charismaModifier: charismaMod,
      });

      // Track which pools were refreshed
      const poolsRefreshed: string[] = [];
      for (let i = 0; i < refreshedPools.length; i++) {
        if (refreshedPools[i] && beforePools[i] && refreshedPools[i].current !== beforePools[i].current) {
          poolsRefreshed.push(refreshedPools[i].name);
        }
      }

      // Build updated sheet
      const updatedSheet: Record<string, unknown> = {
        ...sheet,
        resourcePools: refreshedPools,
      };

      // Long rest: restore HP to max
      if (restType === "long") {
        const maxHp = (sheet.maxHp as number) ?? (sheet.currentHp as number) ?? 10;
        updatedSheet.currentHp = maxHp;
        
        // Also refresh spell slot pools
        for (const pool of refreshedPools) {
          if (pool.name.startsWith("spellSlot_")) {
            pool.current = pool.max;
            if (!poolsRefreshed.includes(pool.name)) {
              poolsRefreshed.push(pool.name);
            }
          }
        }
      }

      await this.characters.updateSheet(char.id, updatedSheet as JsonValue);
      results.push({ id: char.id, name: char.name, poolsRefreshed });
    }

    if (this.events) {
      await this.events.append(sessionId, {
        id: nanoid(),
        type: "RestCompleted",
        payload: { restType, characters: results.map(r => ({ id: r.id, name: r.name })) },
      });
    }

    return { characters: results };
  }
}
