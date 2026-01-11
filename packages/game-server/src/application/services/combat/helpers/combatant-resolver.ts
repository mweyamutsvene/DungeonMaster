import type { Ability } from "../../../../domain/entities/core/ability-scores.js";
import type { EquippedItems } from "../../../../domain/entities/items/equipped-items.js";

import { ValidationError } from "../../../errors.js";
import type { ICharacterRepository } from "../../../repositories/character-repository.js";
import type { IMonsterRepository } from "../../../repositories/monster-repository.js";
import type { INPCRepository } from "../../../repositories/npc-repository.js";
import type { CombatantStateRecord } from "../../../types.js";

import type { CombatantRef } from "./combatant-ref.js";

type AbilityScoresData = Record<Ability, number>;

type CombatantEquipment = {
  weapon?: string;
  armor?: string;
};

export type CombatantCombatStats = {
  name: string;
  armorClass: number;
  abilityScores: AbilityScoresData;
  featIds?: readonly string[];
  equipment?: CombatantEquipment;
};

export interface ICombatantResolver {
  getName(ref: CombatantRef, state: CombatantStateRecord): Promise<string>;
  getNames(combatants: CombatantStateRecord[]): Promise<Map<string, string>>;
  getCombatStats(ref: CombatantRef): Promise<CombatantCombatStats>;
  getMonsterAttacks(monsterId: string): Promise<unknown[]>;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function readNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function extractAbilityScores(raw: unknown): AbilityScoresData | null {
  if (!isRecord(raw)) return null;
  const abilities: Ability[] = [
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
  ];

  const out: Partial<AbilityScoresData> = {};
  for (const a of abilities) {
    const n = readNumber(raw, a);
    if (n === null) return null;
    out[a] = n;
  }

  return out as AbilityScoresData;
}

function extractEquippedFromSheet(sheet: Record<string, unknown>): CombatantEquipment {
  const equip = sheet.equipment as EquippedItems | undefined;
  if (!equip || typeof equip !== "object") return {};

  const weaponName = (equip as any).weapon?.name;

  let armorText: string | undefined;
  if ((equip as any).armor?.name && typeof (equip as any).armor.name === "string") {
    armorText = (equip as any).armor.name;
  }
  if ((equip as any).shield?.name && typeof (equip as any).shield.name === "string") {
    armorText = armorText ? `${armorText} and ${(equip as any).shield.name}` : (equip as any).shield.name;
  }

  return {
    weapon: typeof weaponName === "string" ? weaponName : undefined,
    armor: armorText,
  };
}

export class CombatantResolver implements ICombatantResolver {
  constructor(
    private readonly characters: ICharacterRepository,
    private readonly monsters: IMonsterRepository,
    private readonly npcs: INPCRepository,
  ) {}

  async getName(ref: CombatantRef, state: CombatantStateRecord): Promise<string> {
    if (ref.type === "Character" && state.characterId) {
      const c = await this.characters.getById(state.characterId);
      return c?.name || "The fighter";
    }
    if (ref.type === "Monster" && state.monsterId) {
      const m = await this.monsters.getById(state.monsterId);
      return m?.name || "The monster";
    }
    if (ref.type === "NPC" && state.npcId) {
      const n = await this.npcs.getById(state.npcId);
      return n?.name || "The NPC";
    }
    return "The actor";
  }

  async getNames(combatants: CombatantStateRecord[]): Promise<Map<string, string>> {
    const charIds = combatants.filter(c => c.combatantType === "Character" && c.characterId).map(c => c.characterId!);
    const monsterIds = combatants.filter(c => c.combatantType === "Monster" && c.monsterId).map(c => c.monsterId!);
    const npcIds = combatants.filter(c => c.combatantType === "NPC" && c.npcId).map(c => c.npcId!);

    const [chars, monsters, npcs] = await Promise.all([
      this.characters.getManyByIds(charIds),
      this.monsters.getManyByIds(monsterIds),
      this.npcs.getManyByIds(npcIds),
    ]);

    const nameMap = new Map<string, string>();
    for (const c of combatants) {
      if (c.combatantType === "Character" && c.characterId) {
        const char = chars.find(ch => ch.id === c.characterId);
        nameMap.set(c.id, char?.name || "The fighter");
      } else if (c.combatantType === "Monster" && c.monsterId) {
        const mon = monsters.find(m => m.id === c.monsterId);
        nameMap.set(c.id, mon?.name || "The monster");
      } else if (c.combatantType === "NPC" && c.npcId) {
        const npc = npcs.find(n => n.id === c.npcId);
        nameMap.set(c.id, npc?.name || "The NPC");
      } else {
        nameMap.set(c.id, "The actor");
      }
    }

    return nameMap;
  }

  async getCombatStats(ref: CombatantRef): Promise<CombatantCombatStats> {
    if (ref.type === "Character") {
      const c = await this.characters.getById(ref.characterId);
      if (!c) throw new ValidationError(`Character not found: ${ref.characterId}`);
      if (!isRecord(c.sheet)) throw new ValidationError("Character sheet must be an object");

      const armorClass = readNumber(c.sheet, "armorClass") ?? readNumber(c.sheet, "ac");
      const abilityScores = extractAbilityScores((c.sheet as any).abilityScores);

      const featIdsRaw = (c.sheet as any).featIds;
      const featIds =
        Array.isArray(featIdsRaw) && featIdsRaw.every((x: unknown) => typeof x === "string")
          ? (featIdsRaw as string[])
          : undefined;

      if (armorClass === null || !abilityScores) {
        throw new ValidationError("Character is missing required combat stats (armorClass, abilityScores)");
      }

      return {
        name: c.name,
        armorClass,
        abilityScores,
        featIds,
        equipment: extractEquippedFromSheet(c.sheet),
      };
    }

    if (ref.type === "Monster") {
      const m = await this.monsters.getById(ref.monsterId);
      if (!m) throw new ValidationError(`Monster not found: ${ref.monsterId}`);
      if (!isRecord(m.statBlock)) throw new ValidationError("Monster statBlock must be an object");

      const armorClass = readNumber(m.statBlock, "armorClass") ?? readNumber(m.statBlock, "ac");
      const abilityScores = extractAbilityScores((m.statBlock as any).abilityScores);
      if (armorClass === null || !abilityScores) {
        throw new ValidationError("Monster is missing required combat stats (armorClass, abilityScores)");
      }

      return {
        name: m.name,
        armorClass,
        abilityScores,
      };
    }

    const n = await this.npcs.getById(ref.npcId);
    if (!n) throw new ValidationError(`NPC not found: ${ref.npcId}`);
    if (!isRecord(n.statBlock)) throw new ValidationError("NPC statBlock must be an object");

    const armorClass = readNumber(n.statBlock, "armorClass") ?? readNumber(n.statBlock, "ac");
    const abilityScores = extractAbilityScores((n.statBlock as any).abilityScores);
    if (armorClass === null || !abilityScores) {
      throw new ValidationError("NPC is missing required combat stats (armorClass, abilityScores)");
    }

    return {
      name: n.name,
      armorClass,
      abilityScores,
    };
  }

  async getMonsterAttacks(monsterId: string): Promise<unknown[]> {
    const m = await this.monsters.getById(monsterId);
    if (!m) throw new ValidationError(`Monster not found: ${monsterId}`);
    if (!isRecord(m.statBlock)) throw new ValidationError("Monster statBlock must be an object");

    const attacks = (m.statBlock as any).attacks;
    return Array.isArray(attacks) ? attacks : [];
  }
}
