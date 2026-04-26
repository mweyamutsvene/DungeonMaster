import type { SessionCharacterRecord, SessionNPCRecord } from "../../../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    if (typeof value[key] === "number") return value[key] as number;
  }
  return undefined;
}

export function isClassBackedNpc(npc: SessionNPCRecord): boolean {
  return typeof npc.className === "string"
    && npc.className.length > 0
    && typeof npc.level === "number"
    && isRecord(npc.sheet);
}

export function getNpcMechanicsSource(npc: SessionNPCRecord): Record<string, unknown> {
  if (isRecord(npc.sheet)) {
    return {
      ...npc.sheet,
      ...(typeof npc.className === "string" && typeof npc.sheet.className !== "string"
        ? { className: npc.className }
        : {}),
      ...(typeof npc.level === "number" && typeof npc.sheet.level !== "number"
        ? { level: npc.level }
        : {}),
    };
  }

  if (isRecord(npc.statBlock)) {
    return npc.statBlock;
  }

  return {};
}

export function getNpcClassName(npc: SessionNPCRecord): string {
  if (typeof npc.className === "string" && npc.className.length > 0) return npc.className;
  const source = getNpcMechanicsSource(npc);
  return typeof source.className === "string" ? source.className : "";
}

export function getNpcLevel(npc: SessionNPCRecord): number {
  if (typeof npc.level === "number") return npc.level;
  return readNumber(getNpcMechanicsSource(npc), "level") ?? 0;
}

export function getNpcCurrentHpFromSource(npc: SessionNPCRecord): number {
  return readNumber(getNpcMechanicsSource(npc), "currentHP", "currentHp", "hp", "maxHP", "maxHp") ?? 0;
}

export function getNpcMaxHpFromSource(npc: SessionNPCRecord): number {
  return readNumber(getNpcMechanicsSource(npc), "maxHP", "maxHp", "hp", "currentHP", "currentHp") ?? 0;
}

export function getNpcConditionsFromSource(npc: SessionNPCRecord): unknown {
  return getNpcMechanicsSource(npc).conditions;
}

export type ClassBackedActorSource = {
  sourceType: "Character" | "NPC";
  name: string;
  className: string;
  level: number;
  sheet: Record<string, unknown>;
};

export function getClassBackedActorSource(
  actorId: string,
  characters: SessionCharacterRecord[],
  npcs: SessionNPCRecord[],
): ClassBackedActorSource | null {
  const character = characters.find((entry) => entry.id === actorId);
  if (character && isRecord(character.sheet)) {
    return {
      sourceType: "Character",
      name: character.name,
      className: typeof character.sheet.className === "string" ? character.sheet.className : character.className ?? "",
      level: typeof character.sheet.level === "number" ? character.sheet.level : character.level,
      sheet: character.sheet,
    };
  }

  const npc = npcs.find((entry) => entry.id === actorId);
  if (npc && isClassBackedNpc(npc)) {
    return {
      sourceType: "NPC",
      name: npc.name,
      className: getNpcClassName(npc),
      level: getNpcLevel(npc),
      sheet: getNpcMechanicsSource(npc),
    };
  }

  return null;
}