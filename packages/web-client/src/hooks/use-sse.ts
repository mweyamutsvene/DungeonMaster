import { useEffect, useRef } from "react";
import { useAppStore } from "../store/app-store";
import type { ServerEvent, RawServerEvent } from "../types/server-events";

const SSE_URL = (sessionId: string) => `/api/sessions/${sessionId}/events`;

function toServerEvent(raw: RawServerEvent): ServerEvent {
  // Cast is intentional — the store's switch handles unknown types via default.
  return raw as unknown as ServerEvent;
}

export function useSSE(sessionId: string | null) {
  const handleServerEvent = useAppStore((s) => s.handleServerEvent);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const connect = () => {
      const es = new EventSource(SSE_URL(sessionId));
      esRef.current = es;

      es.onmessage = (e) => {
        try {
          const raw = JSON.parse(e.data) as RawServerEvent;
          handleServerEvent(toServerEvent(raw));
        } catch {
          // malformed event — ignore
        }
      };

      // Named event listeners for all known event types
      const eventTypes = [
        "CombatStarted", "CombatEnded", "TurnAdvanced",
        "DamageApplied", "HealingApplied", "AttackResolved",
        "ActionResolved", "Move", "NarrativeText",
        "ReactionPrompt", "ReactionResolved", "DeathSave",
        "CharacterAdded", "MonsterAdded", "NPCAdded",
        "InventoryChanged", "RestStarted", "RestCompleted",
      ];

      for (const type of eventTypes) {
        es.addEventListener(type, (e) => {
          try {
            const parsed = JSON.parse((e as MessageEvent).data) as RawServerEvent;
            const raw: RawServerEvent = { type: parsed.type ?? type, payload: parsed.payload ?? parsed };
            handleServerEvent(toServerEvent(raw));
          } catch {
            // ignore
          }
        });
      }

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [sessionId, handleServerEvent]);
}
