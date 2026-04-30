// REST API response shapes — mirroring actual game-server route handlers.

export interface SessionRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  storyFramework?: unknown;
}

export interface Character {
  id: string;
  name: string;
  class?: string;
  className?: string | null;
  level: number;
  sessionId: string;
  sheet?: {
    maxHp?: number;
    hp?: number;
    currentHp?: number;
    armorClass?: number;
    abilityScores?: Record<string, number>;
    [key: string]: unknown;
  };
}

export interface SessionResponse {
  session: SessionRecord;
  characters: Character[];
  monsters: { id: string; name: string; sessionId: string }[];
  npcs: unknown[];
}

// Shape returned by GET /sessions/:id/combat
export interface EncounterState {
  encounter: {
    id: string;
    status: string; // "Pending" | "Active" | "Completed"
    round: number;
    turn: number;
    pendingAction?: unknown;
  };
  combatants: EncounterCombatant[];
  activeCombatant: EncounterCombatant | null;
}

export interface EncounterCombatant {
  id: string;
  combatantType: "Character" | "Monster" | "NPC";
  characterId?: string;
  monsterId?: string;
  npcId?: string;
  hpCurrent: number;
  hpMax: number;
  initiative: number;
  resources?: Record<string, unknown>;
}

// Shape returned by GET /sessions/:id/combat/:encounterId/tactical
export interface TacticalViewResponse {
  encounterId: string;
  status: string;
  activeCombatantId: string;
  combatants: TacticalCombatant[];
  pendingAction?: unknown;
  map?: unknown;
  lastMovePath?: unknown;
  zones?: unknown[];
  groundItems?: unknown;
  flankingEnabled?: boolean;
}

export interface TacticalCombatant {
  id: string;
  name: string;
  combatantType: "Character" | "Monster" | "NPC";
  hp: { current: number; max: number };
  position: { x: number; y: number } | null;
  distanceFromActive: number | null;
  actionEconomy: {
    actionAvailable: boolean;
    bonusActionAvailable: boolean;
    reactionAvailable: boolean;
    movementRemainingFeet: number;
    attacksUsed: number;
    attacksAllowed: number;
  };
  resourcePools: Array<{ name: string; current: number; max: number }>;
  movement: { speed: number; dashed: boolean; movementSpent: boolean };
  turnFlags: {
    actionSpent: boolean;
    bonusActionUsed: boolean;
    reactionUsed: boolean;
    disengaged: boolean;
  };
  conditions?: string[];
  deathSaves?: { successes: number; failures: number };
}

// Stored combatant extends the tactical view shape with entity IDs (from EncounterState)
export interface StoredCombatant extends TacticalCombatant {
  characterId?: string;
  monsterId?: string;
  npcId?: string;
  initiative: number;
}

export interface ActionResponse {
  requiresPlayerInput: boolean;
  actionComplete: boolean;
  type: string;
  message: string;
  rollType?: string;
  diceNeeded?: string;
  narration?: string;
  success?: boolean;
  movedTo?: { x: number; y: number };
  pendingActionId?: string;
  /** Populated on REACTION_CHECK — monsters that may take opportunity attacks on the moving combatant. */
  opportunityAttacks?: Array<{
    combatantId: string;
    opportunityId: string;
    combatantName?: string;
    canAttack: boolean;
    reactionType?: string;
  }>;
  /** Populated when an initiative roll resolves and combat transitions to Active. */
  combatStarted?: boolean;
  encounterId?: string;
  turnOrder?: Array<{ actorId: string; actorName: string; initiative: number }>;
}

export interface PathPreviewResponse {
  blocked: boolean;
  path: { x: number; y: number }[];
  cells: { x: number; y: number; terrain: string; stepCostFeet: number; cumulativeCostFeet: number }[];
  totalCostFeet: number;
  terrainEncountered: string[];
  narrationHints: string[];
  reachablePosition: { x: number; y: number } | null;
}

export interface CharacterSpellsResponse {
  classId: string;
  casterType: string;
  spellcastingAbility: string;
  maxPreparedSpells: number;
  preparedSpells: string[];
  knownSpells: string[];
}

export interface SpellCatalogEntry {
  id: string;           // spell.name.toLowerCase()
  name: string;
  level: number;        // 0 = cantrip
  school: string;
  castingTime: 'action' | 'bonus_action' | 'reaction';
  description: string;
  classLists: string[];
}
