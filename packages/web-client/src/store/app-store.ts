import { create } from "zustand";
import type { StoredCombatant, TacticalViewResponse, EncounterState, ActionResponse } from "../types/api";
import type { ServerEvent, ReactionPromptPayload } from "../types/server-events";

export interface PendingRoll {
  rollType: string;      // "attack" | "damage" | "initiative" | "opportunity_attack" | "opportunity_attack_damage"
  diceNeeded?: string;   // e.g. "d20", "1d8+4", "2d6+3"
  message: string;
  actorId: string;
}

export type AppMode = "tactical" | "theatre" | null;

export interface NarrationEntry {
  id: string;
  text: string;
  actor?: string;
  timestamp: number;
  eventType: string;
}

interface AppState {
  // Session
  sessionId: string | null;
  playerName: string;
  myCharacterId: string | null;

  // Mode
  mode: AppMode;

  // Set after CombatEnded — tactical stays visible until animations finish, then clears.
  combatResult: string | null;

  // Combat
  encounterId: string | null;
  round: number;
  activeCombatantId: string | null;
  combatants: StoredCombatant[];

  // Incremented when SSE events require a tactical view re-fetch (CombatStarted, TurnAdvanced).
  // SessionPage watches this and triggers the fetch — keeps async API calls out of the store.
  tacticalVersion: number;

  // Tracks last processed TurnAdvanced ("round:turn") to deduplicate SSE backlog replays on reconnect.
  _lastSeenTurnKey: string;

  // Reaction
  pendingReaction: ReactionPromptPayload | null;

  // Pending dice roll (attack, damage, initiative, etc.)
  pendingRoll: PendingRoll | null;

  // Narration log
  narrationLog: NarrationEntry[];

  // UI
  characterSheetOpen: boolean;
  characterSheetTargetId: string | null;
  partyChatOpen: boolean;

  // Actions
  setSession(sessionId: string): void;
  setPlayerName(name: string): void;
  setMyCharacterId(id: string): void;
  setMode(mode: AppMode): void;
  hydrateCombat(encounter: EncounterState, tactical: TacticalViewResponse): void;
  moveCombatant(id: string, position: { x: number; y: number }): void;
  handleServerEvent(event: ServerEvent): void;
  openCharacterSheet(combatantId?: string): void;
  closeCharacterSheet(): void;
  togglePartyChat(): void;
  dismissReaction(): void;
  setPendingRoll(roll: PendingRoll | null): void;
  handleRollResponse(response: ActionResponse, actorId: string): void;
  addErrorLog(message: string): void;
}

let _narrationSeq = 0;
function narrationId() {
  return `n-${Date.now()}-${++_narrationSeq}`;
}

function findByRef(
  combatants: StoredCombatant[],
  ref: { characterId?: string; monsterId?: string; npcId?: string; name?: string },
): StoredCombatant | undefined {
  if (ref.characterId) return combatants.find((c) => c.characterId === ref.characterId);
  if (ref.monsterId) return combatants.find((c) => c.monsterId === ref.monsterId);
  if (ref.npcId) return combatants.find((c) => c.npcId === ref.npcId);
  if (ref.name) return combatants.find((c) => c.name === ref.name);
  return undefined;
}

export const useAppStore = create<AppState>((set, get) => ({
  sessionId: null,
  playerName: "",
  myCharacterId: null,
  mode: null,
  encounterId: null,
  round: 1,
  activeCombatantId: null,
  combatants: [],
  combatResult: null,
  tacticalVersion: 0,
  _lastSeenTurnKey: "",
  pendingReaction: null,
  pendingRoll: null,
  narrationLog: [],
  characterSheetOpen: false,
  characterSheetTargetId: null,
  partyChatOpen: false,

  setSession: (sessionId) => set({ sessionId }),
  setPlayerName: (playerName) => set({ playerName }),
  setMyCharacterId: (myCharacterId) => set({ myCharacterId }),
  setMode: (mode) => set({ mode }),
  moveCombatant: (id, position) =>
    set((s) => ({ combatants: s.combatants.map((c) => (c.id === id ? { ...c, position } : c)) })),

  hydrateCombat: (encounter, tactical) => {
    const entityMap = new Map(encounter.combatants.map((c) => [c.id, c]));
    const combatants: StoredCombatant[] = tactical.combatants.map((tc) => {
      const ec = entityMap.get(tc.id);
      return {
        ...tc,
        characterId: ec?.characterId,
        monsterId: ec?.monsterId,
        npcId: ec?.npcId,
        initiative: ec?.initiative ?? 0,
      };
    });

    set({
      encounterId: tactical.encounterId,
      round: encounter.encounter.round,
      activeCombatantId: tactical.activeCombatantId,
      combatants,
      mode: "tactical",
    });
  },

  handleServerEvent: (event) => {
    const { combatants, narrationLog } = get();

    switch (event.type) {
      case "CombatStarted":
        // Bump tacticalVersion so SessionPage re-fetches the full tactical view
        set((s) => ({
          encounterId: event.payload.encounterId,
          mode: "tactical",
          _lastSeenTurnKey: "",
          tacticalVersion: s.tacticalVersion + 1,
        }));
        break;

      case "CombatEnded":
        // Keep combatants visible so death animations can finish.
        // TacticalLayout watches combatResult and transitions to theatre after a delay.
        set({ combatResult: (event.payload as { result?: string }).result ?? "Victory" });
        break;

      case "TurnAdvanced": {
        // Deduplicate replayed SSE backlog events (SSE reconnect sends the full event history).
        const key = `${event.payload.round}:${event.payload.turn}`;
        const { _lastSeenTurnKey } = get();
        if (key === _lastSeenTurnKey) break;
        // Bump tacticalVersion so SessionPage re-fetches activeCombatantId + fresh action economy
        set((s) => ({
          round: event.payload.round,
          _lastSeenTurnKey: key,
          tacticalVersion: s.tacticalVersion + 1,
        }));
        break;
      }

      case "DamageApplied": {
        set((s) => {
          const match = findByRef(s.combatants, event.payload.target);
          if (!match) return {};
          return {
            combatants: s.combatants.map((c) =>
              c.id === match.id
                ? { ...c, hp: { ...c.hp, current: event.payload.hpCurrent } }
                : c
            ),
          };
        });
        break;
      }

      case "HealingApplied": {
        set((s) => {
          const match = findByRef(s.combatants, event.payload.target);
          if (!match) return {};
          return {
            combatants: s.combatants.map((c) =>
              c.id === match.id
                ? { ...c, hp: { ...c.hp, current: event.payload.hpCurrent } }
                : c
            ),
          };
        });
        break;
      }

      case "Move": {
        const { actorId, to, actorName: payloadActorName } = event.payload;
        // Use actorName embedded by server — avoids stale-closure lookup during SSE backlog replay
        set((s) => {
          const moverName = payloadActorName ?? s.combatants.find((c) => c.id === actorId)?.name ?? "A combatant";
          return {
            combatants: s.combatants.map((c) =>
              c.id === actorId ? { ...c, position: to } : c
            ),
            tacticalVersion: s.tacticalVersion + 1,
            narrationLog: [
              ...s.narrationLog.slice(-99),
              {
                id: narrationId(),
                text: `${moverName} moves.`,
                actor: moverName,
                timestamp: Date.now(),
                eventType: "Move",
              },
            ],
          };
        });
        break;
      }

      case "OpportunityAttack": {
        const oaPayload = event.payload;
        set((s) => {
          const oaAttackerName = oaPayload.attackerName ?? "A creature";
          // Prefer server-embedded name; fall back to store lookup
          const oaTargetName = oaPayload.targetName ?? s.combatants.find((c) => c.id === oaPayload.targetId)?.name ?? "their target";
          const critText = oaPayload.critical ? " (critical hit!)" : "";
          const oaText = oaPayload.hit && oaPayload.damage
            ? `${oaAttackerName} strikes ${oaTargetName} for ${oaPayload.damage} damage${critText}! (OA)`
            : oaPayload.hit
            ? `${oaAttackerName} hits ${oaTargetName} with an opportunity attack${critText}!`
            : `${oaAttackerName} swings at ${oaTargetName} but misses! (OA)`;
          return {
            narrationLog: [
              ...s.narrationLog.slice(-99),
              {
                id: narrationId(),
                text: oaText,
                actor: oaAttackerName,
                timestamp: Date.now(),
                eventType: "OpportunityAttack",
              },
            ],
            // Update HP immediately for OA hits — Move event triggers a full re-fetch
            combatants: oaPayload.hit && oaPayload.damage
              ? s.combatants.map((c) =>
                  c.id === oaPayload.targetId
                    ? { ...c, hp: { ...c.hp, current: Math.max(0, c.hp.current - oaPayload.damage!) } }
                    : c
                )
              : s.combatants,
          };
        });
        break;
      }

      case "NarrativeText": {
        const narrativeText = event.payload.text;
        // Prefer server-embedded actorName; fall back to store lookup via CombatantRef
        const payloadActorName = event.payload.actorName;
        const actorRef = event.payload.actor;
        set((s) => {
          const actorName = payloadActorName
            ?? (actorRef ? findByRef(s.combatants, actorRef)?.name : undefined);
          return {
            narrationLog: [
              ...s.narrationLog.slice(-99),
              {
                id: narrationId(),
                text: narrativeText,
                actor: actorName,
                timestamp: Date.now(),
                eventType: "NarrativeText",
              },
            ],
          };
        });
        break;
      }

      case "AttackResolved": {
        // NarrativeText events already describe the attack in full prose.
        // Just bump tacticalVersion so action economy refreshes after the attack.
        set((s) => ({ tacticalVersion: s.tacticalVersion + 1 }));
        break;
      }

      case "ActionResolved": {
        // Any resolved action (dodge, dash, help, hide, etc.) spends the action slot
        set((s) => ({ tacticalVersion: s.tacticalVersion + 1 }));
        break;
      }

      case "ReactionPrompt": {
        // Only show the dialog to the player whose character can react.
        // AI-controlled combatants' reactions are handled server-side.
        const myCharId = get().myCharacterId;
        const myCombatant = get().combatants.find((c) => c.characterId === myCharId);
        if (myCombatant && event.payload.combatantId === myCombatant.id) {
          set({ pendingReaction: event.payload });
        }
        break;
      }

      case "ReactionResolved":
        if (get().pendingReaction?.pendingActionId === event.payload.pendingActionId) {
          // Reaction used/declined — refresh economy so reactionAvailable updates
          set((s) => ({ pendingReaction: null, tacticalVersion: s.tacticalVersion + 1 }));
        }
        break;

      default:
        break;
    }
  },

  openCharacterSheet: (combatantId) =>
    set({ characterSheetOpen: true, characterSheetTargetId: combatantId ?? null }),
  closeCharacterSheet: () =>
    set({ characterSheetOpen: false, characterSheetTargetId: null }),
  togglePartyChat: () => set((s) => ({ partyChatOpen: !s.partyChatOpen })),
  dismissReaction: () => set({ pendingReaction: null }),

  setPendingRoll: (roll) => set({ pendingRoll: roll }),

  addErrorLog: (message) =>
    set((s) => ({
      narrationLog: [
        ...s.narrationLog.slice(-99),
        { id: narrationId(), text: message, timestamp: Date.now(), eventType: "error" },
      ],
    })),

  handleRollResponse: (response, actorId) => {
    if (response.requiresPlayerInput && response.rollType) {
      set({
        pendingRoll: {
          rollType: response.rollType,
          diceNeeded: response.diceNeeded,
          message: response.message,
          actorId,
        },
      });
    } else {
      set({ pendingRoll: null });
    }
  },
}));
