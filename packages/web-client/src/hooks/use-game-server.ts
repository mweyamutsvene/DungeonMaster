import type {
  SessionResponse,
  EncounterState,
  TacticalViewResponse,
  ActionResponse,
  PathPreviewResponse,
  CharacterSpellsResponse,
  SpellCatalogEntry,
  Character,
} from "../types/api";

const BASE = "/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export const gameServer = {
  getSession: (sessionId: string) =>
    apiFetch<SessionResponse>(`/sessions/${sessionId}`),

  listSessions: () =>
    apiFetch<{ sessions: SessionResponse["session"][] }>("/sessions"),

  // GET /sessions/:id/combat — 404 if no encounter exists
  getCombatState: (sessionId: string, encounterId?: string) => {
    const qs = encounterId ? `?encounterId=${encounterId}` : "";
    return apiFetch<EncounterState>(`/sessions/${sessionId}/combat${qs}`);
  },

  getTacticalView: (sessionId: string, encounterId: string) =>
    apiFetch<TacticalViewResponse>(`/sessions/${sessionId}/combat/${encounterId}/tactical`),

  // POST /sessions/:id/actions with kind "endTurn" — requires characterId for actor
  endTurn: (sessionId: string, encounterId: string, characterId: string) =>
    apiFetch<ActionResponse>(`/sessions/${sessionId}/actions`, {
      method: "POST",
      body: JSON.stringify({
        kind: "endTurn",
        encounterId,
        actor: { type: "Character", characterId },
      }),
    }),

  submitAction: (sessionId: string, body: Record<string, unknown>) =>
    apiFetch<ActionResponse>(`/sessions/${sessionId}/combat/action`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // POST /sessions/:id/combat/roll-result — submit a dice roll (initiative, attack, damage, saving throw)
  submitRoll: (sessionId: string, body: { text: string; actorId: string }) =>
    apiFetch<ActionResponse>(`/sessions/${sessionId}/combat/roll-result`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // POST /sessions/:id/combat/move/complete — finish a move after OA reactions resolve
  completeMove: (sessionId: string, body: { pendingActionId: string; roll?: number; rollType?: string }) =>
    apiFetch<ActionResponse>(`/sessions/${sessionId}/combat/move/complete`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // POST /encounters/:encounterId/reactions/:pendingActionId/respond
  respondToReaction: (
    encounterId: string,
    pendingActionId: string,
    body: { combatantId: string; opportunityId: string; choice: "use" | "decline" },
  ) =>
    apiFetch<{ success: boolean; status: string }>(`/encounters/${encounterId}/reactions/${pendingActionId}/respond`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // GET /encounters/:encounterId/reactions — list all pending reactions (for refresh hydration)
  getActiveReactions: (encounterId: string) =>
    apiFetch<{
      pendingActions: Array<{
        id: string;
        type: string;
        actor: { type: string; characterId?: string; monsterId?: string; npcId?: string };
        actorName: string;
        status: "awaiting_reactions" | "ready_to_complete" | "completed" | "cancelled" | "expired";
        reactionOpportunities: Array<{
          id: string;
          combatantId: string;
          combatantName: string;
          reactionType: string;
          oaType?: "weapon" | "spell";
          canUse: boolean;
          reason?: string;
          context: Record<string, unknown>;
        }>;
        resolvedReactions: Array<{ opportunityId: string; combatantId: string; choice: "use" | "decline" }>;
        expiresAt: string;
      }>;
    }>(`/encounters/${encounterId}/reactions`),

  previewPath: (
    sessionId: string,
    encounterId: string,
    body: {
      from: { x: number; y: number };
      to: { x: number; y: number };
      maxCostFeet?: number;
      desiredRange?: number;
      avoidHazards?: boolean;
    },
  ) =>
    apiFetch<PathPreviewResponse>(
      `/sessions/${sessionId}/combat/${encounterId}/path-preview`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  // POST /sessions/:id/characters/generate — auto-generate character sheet
  generateCharacter: (
    sessionId: string,
    body: { name: string; className: string; level: number },
  ) =>
    apiFetch<Character>(
      `/sessions/${sessionId}/characters/generate`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  // POST /sessions/:id/monsters — add monster to session
  addMonster: (sessionId: string, body: Record<string, unknown>) =>
    apiFetch<{ id: string }>(
      `/sessions/${sessionId}/monsters`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  // POST /sessions/:id/combat/start — start combat with combatants
  startCombat: (
    sessionId: string,
    body: {
      combatants: Array<{        combatantType: "Character" | "Monster";
        characterId?: string;
        monsterId?: string;
        hpCurrent: number;
        hpMax: number;
      }>;
    },
  ) =>
    apiFetch<{ encounterId: string }>(
      `/sessions/${sessionId}/combat/start`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  // POST /sessions/:id/combat/initiate — start combat via tabletop flow, requests initiative roll
  initiateCombat: (sessionId: string, body: { text: string; actorId: string }) =>
    apiFetch<ActionResponse>(
      `/sessions/${sessionId}/combat/initiate`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  // GET /sessions/:id/characters/:characterId/spells
  getCharacterSpells: (sessionId: string, characterId: string) =>
    apiFetch<CharacterSpellsResponse>(
      `/sessions/${sessionId}/characters/${characterId}/spells`,
    ),

  // GET /spells — full spell catalog with display metadata
  getSpellCatalog: () =>
    apiFetch<{ spells: SpellCatalogEntry[] }>("/spells"),
};
