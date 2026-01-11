export type JsonValue = unknown;

export type GameSessionRecord = {
  id: string;
  storyFramework: JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

export type SessionCharacterRecord = {
  id: string;
  sessionId: string;
  name: string;
  level: number;
  className: string | null;
  sheet: JsonValue;
  faction: string;
  aiControlled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SessionMonsterRecord = {
  id: string;
  sessionId: string;
  name: string;
  monsterDefinitionId: string | null;
  statBlock: JsonValue;
  faction: string;
  aiControlled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SessionNPCRecord = {
  id: string;
  sessionId: string;
  name: string;
  statBlock: JsonValue;
  faction: string;
  aiControlled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CombatEncounterRecord = {
  id: string;
  sessionId: string;
  status: string;
  round: number;
  turn: number;
  mapData?: JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

export type CombatantType = "Character" | "Monster" | "NPC";

export type CombatantStateRecord = {
  id: string;
  encounterId: string;
  combatantType: CombatantType;
  characterId: string | null;
  monsterId: string | null;
  npcId: string | null;
  /**
   * Optional related records when a repository chooses to hydrate relations (e.g. Prisma `include`).
   * Consumers must treat these as best-effort and fall back to IDs when absent.
   */
  character?: { faction?: string | null; aiControlled?: boolean | null } | null;
  monster?: { faction?: string | null; aiControlled?: boolean | null } | null;
  npc?: { faction?: string | null; aiControlled?: boolean | null } | null;
  initiative: number | null;
  hpCurrent: number;
  hpMax: number;
  conditions: JsonValue;
  resources: JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

export type GameEventRecord = {
  id: string;
  sessionId: string;
  type: string;
  payload: JsonValue;
  createdAt: Date;
};

export type SpellDefinitionRecord = {
  id: string;
  name: string;
  level: number;
  school: string;
  ritual: boolean;
  data: JsonValue;
  createdAt: Date;
  updatedAt: Date;
};
