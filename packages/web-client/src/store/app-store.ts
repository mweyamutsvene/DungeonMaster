import { create } from "zustand";
import type { StoredCombatant, TacticalViewResponse, EncounterState } from "../types/api";
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
  activeCombatantId: string | null;
  combatants: StoredCombatant[];

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
  hydrateCombat(encounter: EncounterState, tactical: TacticalViewResponse): void;
  handleServerEvent(event: ServerEvent): void;
  openCharacterSheet(combatantId?: string): void;
  closeCharacterSheet(): void;
  togglePartyChat(): void;
  dismissReaction(): void;
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
  pendingReaction: null,
  narrationLog: [],
  characterSheetOpen: false,
  characterSheetTargetId: null,
  partyChatOpen: false,

  setSession: (sessionId) => set({ sessionId }),
  setPlayerName: (playerName) => set({ playerName }),
  setMyCharacterId: (myCharacterId) => set({ myCharacterId }),
  setMode: (mode) => set({ mode }),

  hydrateCombat: (encounter, tactical) => {
    // Merge entity IDs from EncounterState into the richer TacticalCombatant data
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
        set({ encounterId: event.payload.encounterId, mode: "tactical" });
        break;

      case "CombatEnded":
        set({ encounterId: null, mode: "theatre", activeCombatantId: null, combatants: [] });
        break;

      case "TurnAdvanced":
        set({ round: event.payload.round });
        break;

      case "DamageApplied": {
        const match = findByRef(combatants, event.payload.target);
        if (match) {
          set({
            combatants: combatants.map((c) =>
              c.id === match.id
                ? { ...c, hp: { ...c.hp, current: event.payload.hpCurrent } }
                : c
            ),
          });
        }
        break;
      }

      case "HealingApplied": {
        const match = findByRef(combatants, event.payload.target);
        if (match) {
          set({
            combatants: combatants.map((c) =>
              c.id === match.id
                ? { ...c, hp: { ...c.hp, current: event.payload.hpCurrent } }
                : c
            ),
          });
        }
        break;
      }

      case "Move": {
        const { actorId, to } = event.payload;
        // actorId is a combatant ID (not entity ID)
        set({
          combatants: combatants.map((c) =>
            c.id === actorId ? { ...c, position: to } : c
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
        const attackerName = attacker?.name ?? findByRef(combatants, attacker ?? {})?.name ?? "?";
        const targetName = target?.name ?? findByRef(combatants, target ?? {})?.name ?? "?";
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

  openCharacterSheet: (combatantId) =>
    set({ characterSheetOpen: true, characterSheetTargetId: combatantId ?? null }),
  closeCharacterSheet: () =>
    set({ characterSheetOpen: false, characterSheetTargetId: null }),
  togglePartyChat: () => set((s) => ({ partyChatOpen: !s.partyChatOpen })),
  dismissReaction: () => set({ pendingReaction: null }),
}));
