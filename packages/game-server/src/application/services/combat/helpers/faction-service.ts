import type { CombatantStateRecord } from "../../../types.js";
import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { ICharacterRepository } from "../../../repositories/character-repository.js";
import type { IMonsterRepository } from "../../../repositories/monster-repository.js";
import type { INPCRepository } from "../../../repositories/npc-repository.js";

export type FactionRelationship = "ally" | "enemy" | "neutral";

/**
 * AI-L7: Default faction relationship table.
 * Same faction = ally; "neutral" is neutral to everyone;
 * otherwise hostile. Can be overridden via constructor config.
 */
const DEFAULT_RELATIONSHIP_TABLE: ReadonlyMap<string, FactionRelationship> = new Map();

export interface FactionServiceConfig {
  /**
   * AI-L7: Custom faction relationship overrides.
   * Keys are "faction1:faction2" (sorted alphabetically), values are the relationship.
   * Example: { "enemy:mercenary": "ally" } makes "enemy" and "mercenary" factions allies.
   */
  relationshipOverrides?: Record<string, FactionRelationship>;
}

export interface FactionServiceDeps {
  combat: ICombatRepository;
  characters: ICharacterRepository;
  monsters: IMonsterRepository;
  npcs: INPCRepository;
  config?: FactionServiceConfig;
}

/**
 * Determines ally/enemy relationships based on persisted faction strings.
 * Layer: Application.
 * Notes: Used by AI decision-making and targeting to distinguish allies vs enemies.
 */
export class FactionService {
  constructor(private deps: FactionServiceDeps) {}

  /**
   * Get the faction string for a combatant by loading its entity.
   */
  async getFaction(combatant: CombatantStateRecord): Promise<string> {
    if (combatant.combatantType === "Character" && combatant.characterId) {
      const character = await this.deps.characters.getById(combatant.characterId);
      return character?.faction ?? "party";
    } else if (combatant.combatantType === "Monster" && combatant.monsterId) {
      const monster = await this.deps.monsters.getById(combatant.monsterId);
      return monster?.faction ?? "enemy";
    } else if (combatant.combatantType === "NPC" && combatant.npcId) {
      const npc = await this.deps.npcs.getById(combatant.npcId);
      return npc?.faction ?? "party";
    }
    return "neutral";
  }

  /**
   * Get faction strings for multiple combatants in batch.
   * Returns a Map of combatant ID → faction string.
   */
  async getFactions(combatants: CombatantStateRecord[]): Promise<Map<string, string>> {
    const charIds = combatants.filter(c => c.combatantType === "Character" && c.characterId).map(c => c.characterId!);
    const monsterIds = combatants.filter(c => c.combatantType === "Monster" && c.monsterId).map(c => c.monsterId!);
    const npcIds = combatants.filter(c => c.combatantType === "NPC" && c.npcId).map(c => c.npcId!);

    const [chars, monsters, npcs] = await Promise.all([
      this.deps.characters.getManyByIds(charIds),
      this.deps.monsters.getManyByIds(monsterIds),
      this.deps.npcs.getManyByIds(npcIds),
    ]);

    const factionMap = new Map<string, string>();
    for (const c of combatants) {
      if (c.combatantType === "Character" && c.characterId) {
        const char = chars.find(ch => ch.id === c.characterId);
        factionMap.set(c.id, char?.faction ?? "party");
      } else if (c.combatantType === "Monster" && c.monsterId) {
        const mon = monsters.find(m => m.id === c.monsterId);
        factionMap.set(c.id, mon?.faction ?? "enemy");
      } else if (c.combatantType === "NPC" && c.npcId) {
        const npc = npcs.find(n => n.id === c.npcId);
        factionMap.set(c.id, npc?.faction ?? "party");
      } else {
        factionMap.set(c.id, "neutral");
      }
    }

    return factionMap;
  }

  /**
   * Get whether a combatant is AI-controlled by loading its entity.
   */
  async isAIControlled(combatant: CombatantStateRecord): Promise<boolean> {
    if (combatant.combatantType === "Character" && combatant.characterId) {
      const character = await this.deps.characters.getById(combatant.characterId);
      return character?.aiControlled ?? false;
    } else if (combatant.combatantType === "Monster" && combatant.monsterId) {
      const monster = await this.deps.monsters.getById(combatant.monsterId);
      return monster?.aiControlled ?? true;
    } else if (combatant.combatantType === "NPC" && combatant.npcId) {
      const npc = await this.deps.npcs.getById(combatant.npcId);
      return npc?.aiControlled ?? true;
    }
    return false;
  }

  /**
   * Determine relationship between two factions.
   */
  /**
   * Determine relationship between two factions.
   *
   * AI-L7: Now supports "neutral" faction and configurable overrides.
   * Rules (in order):
   * 1. Same faction → ally
   * 2. Check relationship overrides (if configured)
   * 3. Either faction is "neutral" → neutral
   * 4. Otherwise → enemy
   */
  getRelationship(faction1: string, faction2: string): FactionRelationship {
    if (faction1 === faction2) {
      return "ally";
    }

    // Check configurable overrides
    const overrides = this.deps.config?.relationshipOverrides;
    if (overrides) {
      const key = [faction1, faction2].sort().join(":");
      const override = overrides[key];
      if (override) return override;
    }

    // "neutral" faction is neutral to everyone
    if (faction1 === "neutral" || faction2 === "neutral") {
      return "neutral";
    }

    return "enemy";
  }

  /**
   * Get all allied combatants for the given combatant.
   */
  async getAllies(
    allCombatants: CombatantStateRecord[],
    currentCombatant: CombatantStateRecord
  ): Promise<CombatantStateRecord[]> {
    const factionMap = await this.getFactions([currentCombatant, ...allCombatants]);
    const currentFaction = factionMap.get(currentCombatant.id) || "neutral";

    const allies: CombatantStateRecord[] = [];
    for (const c of allCombatants) {
      if (c.id === currentCombatant.id) continue; // Skip self
      
      const faction = factionMap.get(c.id) || "neutral";
      if (this.getRelationship(currentFaction, faction) === "ally") {
        allies.push(c);
      }
    }

    return allies;
  }

  /**
   * Get all enemy combatants for the given combatant.
   */
  async getEnemies(
    allCombatants: CombatantStateRecord[],
    currentCombatant: CombatantStateRecord
  ): Promise<CombatantStateRecord[]> {
    const factionMap = await this.getFactions([currentCombatant, ...allCombatants]);
    const currentFaction = factionMap.get(currentCombatant.id) || "neutral";

    const enemies: CombatantStateRecord[] = [];
    for (const c of allCombatants) {
      const faction = factionMap.get(c.id) || "neutral";
      if (this.getRelationship(currentFaction, faction) === "enemy") {
        enemies.push(c);
      }
    }

    return enemies;
  }
}
