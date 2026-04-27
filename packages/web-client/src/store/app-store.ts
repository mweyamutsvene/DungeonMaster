import { create } from "zustand";
import type { TacticalCombatant, TacticalViewResponse } from "../types/api";
import type { ServerEvent, ReactionPromptPayload } from "../types/server-events";

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

  // Combat
  encounterId: string | null;
  round: number;
  currentTurnCombatantId: string | null;
  combatants: TacticalCombatant[];

  // Reaction
  pendingReaction: ReactionPromptPayload | null;

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
  hydrateTacticalView(view: TacticalViewResponse): void;
  handleServerEvent(event: ServerEvent): void;
  openCharacterSheet(characterId?: string): void;
  closeCharacterSheet(): void;
  togglePartyChat(): void;
  dismissReaction(): void;
}

let _narrationSeq = 0;
function narrationId() {
  return `n-${Date.now()}-${++_narrationSeq}`;
}

function combatantName(combatants: TacticalCombatant[], id: string): string {
  return combatants.find((c) => c.id === id)?.name ?? id;
}

export const useAppStore = create<AppState>((set, get) => ({
  sessionId: null,
  playerName: "",
  myCharacterId: null,
  mode: null,
  encounterId: null,
  round: 1,
  currentTurnCombatantId: null,
  combatants: [],
  pendingReaction: null,
  narrationLog: [],
  characterSheetOpen: false,
  characterSheetTargetId: null,
  partyChatOpen: false,

  setSession: (sessionId) => set({ sessionId }),
  setPlayerName: (playerName) => set({ playerName }),
  setMyCharacterId: (myCharacterId) => set({ myCharacterId }),
  setMode: (mode) => set({ mode }),

  hydrateTacticalView: (view) =>
    set({
      encounterId: view.encounterId,
      round: view.round,
      currentTurnCombatantId: view.currentTurnCombatantId,
      combatants: view.combatants,
      mode: "tactical",
    }),

  handleServerEvent: (event) => {
    const { combatants, narrationLog } = get();

    switch (event.type) {
      case "CombatStarted":
        set({ encounterId: event.payload.encounterId, mode: "tactical" });
        break;

      case "CombatEnded":
        set({ encounterId: null, mode: "theatre", currentTurnCombatantId: null, combatants: [] });
        break;

      case "TurnAdvanced":
        set({ round: event.payload.round });
        // currentTurnCombatantId updated when tactical view is re-fetched
        break;

      case "DamageApplied": {
        const { target, hpCurrent } = event.payload;
        const targetId = target.characterId ?? target.monsterId ?? target.npcId ?? "";
        set({
          combatants: combatants.map((c) =>
            c.entityId === targetId ? { ...c, hp: { ...c.hp, current: hpCurrent } } : c
          ),
        });
        break;
      }

      case "HealingApplied": {
        const { target, hpCurrent } = event.payload;
        const targetId = target.characterId ?? target.monsterId ?? target.npcId ?? "";
        set({
          combatants: combatants.map((c) =>
            c.entityId === targetId ? { ...c, hp: { ...c.hp, current: hpCurrent } } : c
          ),
        });
        break;
      }

      case "Move": {
        const { actorId, to } = event.payload;
        set({
          combatants: combatants.map((c) =>
            c.entityId === actorId ? { ...c, position: to } : c
          ),
        });
        break;
      }

      case "NarrativeText":
        set({
          narrationLog: [
            ...narrationLog.slice(-99),
            {
              id: narrationId(),
              text: event.payload.text,
              actor: event.payload.actor?.name,
              timestamp: Date.now(),
              eventType: "NarrativeText",
            },
          ],
        });
        break;

      case "AttackResolved": {
        const { attacker, target, hit } = event.payload;
        const attackerName = attacker?.name ?? combatantName(combatants, attacker?.characterId ?? attacker?.monsterId ?? "");
        const targetName = target?.name ?? combatantName(combatants, target?.characterId ?? target?.monsterId ?? "");
        const text = hit
          ? `${attackerName} attacks ${targetName} — HIT!`
          : `${attackerName} attacks ${targetName} — MISS`;
        set({
          narrationLog: [
            ...narrationLog.slice(-99),
            { id: narrationId(), text, timestamp: Date.now(), eventType: "AttackResolved" },
          ],
        });
        break;
      }

      case "ReactionPrompt":
        set({ pendingReaction: event.payload });
        break;

      case "ReactionResolved":
        if (get().pendingReaction?.pendingActionId === event.payload.pendingActionId) {
          set({ pendingReaction: null });
        }
        break;

      default:
        break;
    }
  },

  openCharacterSheet: (characterId) =>
    set({ characterSheetOpen: true, characterSheetTargetId: characterId ?? null }),
  closeCharacterSheet: () =>
    set({ characterSheetOpen: false, characterSheetTargetId: null }),
  togglePartyChat: () => set((s) => ({ partyChatOpen: !s.partyChatOpen })),
  dismissReaction: () => set({ pendingReaction: null }),
}));
