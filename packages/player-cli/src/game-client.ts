/**
 * Game Client — Core API Protocol Layer
 *
 * Encapsulates ALL game-server HTTP calls as typed methods.
 * This is the reusable "SDK" that drives the interactive REPL.
 */

import { HttpClient } from "./http-client.js";
import { EventStream } from "./event-stream.js";
import type {
  GameSessionRecord,
  SessionCharacterRecord,
  SessionMonsterRecord,
  SessionNPCRecord,
  ActionResponse,
  EncounterState,
  TacticalState,
  GameEvent,
  ReactionPendingAction,
  ReactionResponse,
  IntentResult,
  CombatQueryResponse,
  RestResponse,
  InventoryResponse,
} from "./types.js";

export interface GameClientOptions {
  verbose?: boolean;
}

export class GameClient {
  private readonly http: HttpClient;

  constructor(
    private readonly baseUrl: string,
    private readonly options: GameClientOptions = {},
  ) {
    this.http = new HttpClient(baseUrl, { verbose: options.verbose });
  }

  // ==========================================================================
  // Health Check
  // ==========================================================================

  async healthCheck(): Promise<{ status: string }> {
    return this.http.get<{ status: string }>("/health");
  }

  // ==========================================================================
  // Session Lifecycle
  // ==========================================================================

  async createSession(storyFramework?: unknown): Promise<GameSessionRecord> {
    return this.http.post<GameSessionRecord>("/sessions", {
      storyFramework: storyFramework ?? {},
    });
  }

  async addCharacter(
    sessionId: string,
    character: { name: string; level: number; className: string; sheet?: Record<string, unknown> },
  ): Promise<SessionCharacterRecord> {
    return this.http.post<SessionCharacterRecord>(
      `/sessions/${sessionId}/characters`,
      character,
    );
  }

  async generateCharacter(
    sessionId: string,
    character: { name: string; className: string; level?: number; sheet?: Record<string, unknown> },
  ): Promise<SessionCharacterRecord> {
    return this.http.post<SessionCharacterRecord>(
      `/sessions/${sessionId}/characters/generate`,
      character,
    );
  }

  async addMonster(
    sessionId: string,
    monster: { name: string; statBlock: Record<string, unknown> },
  ): Promise<SessionMonsterRecord> {
    return this.http.post<SessionMonsterRecord>(
      `/sessions/${sessionId}/monsters`,
      monster,
    );
  }

  async addNpc(
    sessionId: string,
    npc: { name: string; statBlock: Record<string, unknown>; faction?: string; aiControlled?: boolean },
  ): Promise<SessionNPCRecord> {
    return this.http.post<SessionNPCRecord>(
      `/sessions/${sessionId}/npcs`,
      npc,
    );
  }

  // ==========================================================================
  // Tabletop Combat Flow
  // ==========================================================================

  async initiateCombat(
    sessionId: string,
    input: { text: string; actorId: string },
  ): Promise<ActionResponse> {
    return this.http.post<ActionResponse>(
      `/sessions/${sessionId}/combat/initiate`,
      input,
    );
  }

  async submitRoll(
    sessionId: string,
    input: { text: string; actorId: string },
  ): Promise<ActionResponse> {
    return this.http.post<ActionResponse>(
      `/sessions/${sessionId}/combat/roll-result`,
      input,
    );
  }

  async submitAction(
    sessionId: string,
    input: { text: string; actorId: string; encounterId: string },
  ): Promise<ActionResponse> {
    return this.http.post<ActionResponse>(
      `/sessions/${sessionId}/combat/action`,
      input,
    );
  }

  async completeMove(
    sessionId: string,
    input: { pendingActionId: string; roll?: number; rollType?: string },
  ): Promise<ActionResponse> {
    return this.http.post<ActionResponse>(
      `/sessions/${sessionId}/combat/move/complete`,
      input,
    );
  }

  async endTurn(
    sessionId: string,
    input: { encounterId: string; characterId: string },
  ): Promise<unknown> {
    return this.http.post(
      `/sessions/${sessionId}/actions`,
      {
        kind: "endTurn",
        encounterId: input.encounterId,
        actor: { type: "Character", characterId: input.characterId },
      },
    );
  }

  async rest(
    sessionId: string,
    input: { type: "short" | "long" },
  ): Promise<RestResponse> {
    return this.http.post<RestResponse>(
      `/sessions/${sessionId}/rest`,
      input,
    );
  }

  // ==========================================================================
  // Inventory
  // ==========================================================================

  async getInventory(
    sessionId: string,
    characterId: string,
  ): Promise<InventoryResponse> {
    return this.http.get<InventoryResponse>(
      `/sessions/${sessionId}/characters/${characterId}/inventory`,
    );
  }

  // ==========================================================================
  // State Queries
  // ==========================================================================

  async getCombatState(sessionId: string, encounterId?: string): Promise<EncounterState> {
    const qs = encounterId ? `?encounterId=${encounterId}` : "";
    return this.http.get<EncounterState>(`/sessions/${sessionId}/combat${qs}`);
  }

  async getTacticalView(sessionId: string, encounterId: string): Promise<TacticalState> {
    return this.http.get<TacticalState>(
      `/sessions/${sessionId}/combat/${encounterId}/tactical`,
    );
  }

  async getEvents(sessionId: string, opts?: { limit?: number }): Promise<GameEvent[]> {
    const limit = opts?.limit ?? 50;
    return this.http.get<GameEvent[]>(
      `/sessions/${sessionId}/events-json?limit=${limit}`,
    );
  }

  // ==========================================================================
  // Reactions
  // ==========================================================================

  async getReactions(encounterId: string): Promise<{ pendingActions: ReactionPendingAction[] }> {
    return this.http.get<{ pendingActions: ReactionPendingAction[] }>(
      `/encounters/${encounterId}/reactions`,
    );
  }

  async respondToReaction(
    encounterId: string,
    pendingActionId: string,
    input: { combatantId: string; opportunityId: string; choice: "use" | "decline" },
  ): Promise<ReactionResponse> {
    return this.http.post<ReactionResponse>(
      `/encounters/${encounterId}/reactions/${pendingActionId}/respond`,
      input,
    );
  }

  // ==========================================================================
  // LLM (routed through server)
  // ==========================================================================

  async parseIntent(sessionId: string, input: { text: string }): Promise<IntentResult> {
    return this.http.post<IntentResult>(
      `/sessions/${sessionId}/llm/intent`,
      input,
    );
  }

  async queryTactical(
    sessionId: string,
    input: { query: string; actorId: string; encounterId: string },
  ): Promise<CombatQueryResponse> {
    return this.http.post<CombatQueryResponse>(
      `/sessions/${sessionId}/combat/query`,
      input,
    );
  }

  // ==========================================================================
  // SSE Event Stream
  // ==========================================================================

  connectEventStream(sessionId: string): EventStream {
    return new EventStream(this.http, sessionId, { verbose: this.options.verbose });
  }
}
