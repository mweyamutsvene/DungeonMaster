// REST API response shapes — keep in sync with game-server route handlers.

export interface SessionRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  storyFramework?: unknown;
}

export interface CharacterRecord {
  id: string;
  name: string;
  class: string;
  level: number;
  sessionId: string;
}

export interface MonsterRecord {
  id: string;
  name: string;
  sessionId: string;
}

export interface SessionResponse {
  session: SessionRecord;
  characters: CharacterRecord[];
  monsters: MonsterRecord[];
  npcs: unknown[];
}

export interface EncounterRecord {
  id: string;
  sessionId: string;
  status: "Pending" | "Active" | "Completed";
  round: number;
}

// Combatant as returned by the tactical view endpoint
export interface TacticalCombatant {
  id: string;
  name: string;
  entityType: "Character" | "Monster" | "NPC";
  entityId: string;
  initiative: number;
  hp: { current: number; max: number };
  ac: number;
  position?: { x: number; y: number };
  isCurrentTurn: boolean;
  resources?: {
    actionAvailable: boolean;
    bonusActionAvailable: boolean;
    reactionAvailable: boolean;
    movementRemaining: number;
    movementMax: number;
  };
}

export interface TacticalViewResponse {
  encounterId: string;
  round: number;
  currentTurnCombatantId: string | null;
  combatants: TacticalCombatant[];
  map?: {
    width: number;
    height: number;
    terrain: unknown[];
  };
}
