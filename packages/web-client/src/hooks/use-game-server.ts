import type { SessionResponse, TacticalViewResponse, EncounterRecord } from "../types/api";

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

  getEncounters: (sessionId: string) =>
    apiFetch<{ encounters: EncounterRecord[] }>(`/sessions/${sessionId}/combat/encounters`),

  getTacticalView: (sessionId: string, encounterId: string) =>
    apiFetch<TacticalViewResponse>(`/sessions/${sessionId}/combat/${encounterId}/tactical`),

  endTurn: (sessionId: string, encounterId: string) =>
    apiFetch<unknown>(`/sessions/${sessionId}/combat/${encounterId}/turn`, {
      method: "POST",
    }),

  submitAction: (sessionId: string, body: Record<string, unknown>) =>
    apiFetch<unknown>(`/sessions/${sessionId}/combat/action`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  respondToReaction: (
    sessionId: string,
    encounterId: string,
    pendingActionId: string,
    choice: "use" | "decline",
  ) =>
    apiFetch<unknown>(`/sessions/${sessionId}/combat/${encounterId}/reactions/${pendingActionId}`, {
      method: "POST",
      body: JSON.stringify({ choice }),
    }),
};
