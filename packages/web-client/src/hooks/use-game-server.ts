import type { SessionResponse, EncounterState, TacticalViewResponse } from "../types/api";

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
    apiFetch<unknown>(`/sessions/${sessionId}/actions`, {
      method: "POST",
      body: JSON.stringify({
        kind: "endTurn",
        encounterId,
        actor: { type: "Character", characterId },
      }),
    }),

  submitAction: (sessionId: string, body: Record<string, unknown>) =>
    apiFetch<unknown>(`/sessions/${sessionId}/combat/action`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // POST /encounters/:encounterId/reactions/:pendingActionId/respond
  respondToReaction: (
    encounterId: string,
    pendingActionId: string,
    combatantId: string,
    choice: "use" | "decline",
  ) =>
    apiFetch<unknown>(
      `/encounters/${encounterId}/reactions/${pendingActionId}/respond`,
      { method: "POST", body: JSON.stringify({ combatantId, opportunityId: pendingActionId, choice }) },
    ),
};
