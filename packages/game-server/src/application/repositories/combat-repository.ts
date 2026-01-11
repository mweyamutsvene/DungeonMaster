import type {
  CombatantStateRecord,
  CombatEncounterRecord,
  CombatantType,
  JsonValue,
} from "../types.js";

export interface ICombatRepository {
  createEncounter(
    sessionId: string,
    input: { id: string; status: string; round: number; turn: number; mapData?: JsonValue },
  ): Promise<CombatEncounterRecord>;

  listEncountersBySession(sessionId: string): Promise<CombatEncounterRecord[]>;

  getEncounterById(id: string): Promise<CombatEncounterRecord | null>;

  updateEncounter(
    id: string,
    patch: Partial<Pick<CombatEncounterRecord, "status" | "round" | "turn" | "mapData">>,
  ): Promise<CombatEncounterRecord>;

  listCombatants(encounterId: string): Promise<CombatantStateRecord[]>;

  updateCombatantState(
    id: string,
    patch: Partial<Pick<CombatantStateRecord, "hpCurrent" | "hpMax" | "initiative" | "conditions" | "resources">>,
  ): Promise<CombatantStateRecord>;

  createCombatants(
    encounterId: string,
    combatants: Array<{
      id: string;
      combatantType: CombatantType;
      characterId: string | null;
      monsterId: string | null;
      npcId: string | null;
      initiative: number | null;
      hpCurrent: number;
      hpMax: number;
      conditions: JsonValue;
      resources: JsonValue;
    }>,
  ): Promise<CombatantStateRecord[]>;

  // Tabletop combat flow - pending actions
  setPendingAction(encounterId: string, action: JsonValue): Promise<void>;
  getPendingAction(encounterId: string): Promise<JsonValue | null>;
  clearPendingAction(encounterId: string): Promise<void>;

  // Helper methods for tabletop flow
  findActiveEncounter(sessionId: string): Promise<CombatEncounterRecord | null>;
  findById(encounterId: string): Promise<CombatEncounterRecord | null>;
  startCombat(encounterId: string, initiatives: Record<string, number>): Promise<CombatEncounterRecord>;
}
