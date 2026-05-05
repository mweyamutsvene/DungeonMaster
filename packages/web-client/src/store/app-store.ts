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

/** Raw data stored for AttackResolved entries — names resolved at render time via live combatants. */
export interface AttackLogData {
  hit: boolean | undefined;
  critical?: boolean;
  attackTotal?: number;
  attackRoll?: number;
  targetAC?: number;
  damageApplied?: number;
  attacker?: { characterId?: string; monsterId?: string; npcId?: string };
  target?: { characterId?: string; monsterId?: string; npcId?: string };
}

export interface NarrationEntry {
  id: string;
  text: string;
  actor?: string;
  timestamp: number;
  eventType: string;
  /** Present only for AttackResolved entries — used for render-time name resolution. */
  attackData?: AttackLogData;
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

  /** Latest AttackResolved event (transient — used to trigger sprite attack animations). */
  lastAttackEvent: { seq: number; attackerId: string | null; targetId: string | null } | null;

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
  setPendingReaction(payload: ReactionPromptPayload | null): void;
  setPendingRoll(roll: PendingRoll | null): void;
  handleRollResponse(response: ActionResponse, actorId: string): void;
  addErrorLog(message: string): void;
}

let _narrationSeq = 0;
function narrationId() {
  return `n-${Date.now()}-${++_narrationSeq}`;
}

// Buffer for player-attack path where AttackResolved fires BEFORE NarrativeText.
// Held here (not in Zustand state) so it never triggers a re-render by itself.
// Flushed after the matching NarrativeText, or on TurnAdvanced as a safety valve.
let _pendingAttackEntry: NarrationEntry | null = null;

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
  lastAttackEvent: null,
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
        // Flush any pending attack entry that never got a NarrativeText (safety valve).
        set((s) => {
          const stalePending = _pendingAttackEntry;
          _pendingAttackEntry = null;
          return {
            round: event.payload.round,
            _lastSeenTurnKey: key,
            tacticalVersion: s.tacticalVersion + 1,
            narrationLog: stalePending
              ? [...s.narrationLog.slice(-99), stalePending]
              : s.narrationLog,
          };
        });
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
        const payloadActorName = event.payload.actorName;
        const actorRef = event.payload.actor;
        set((s) => {
          const actorName = payloadActorName
            ?? (actorRef ? findByRef(s.combatants, actorRef)?.name : undefined);
          const narrativeEntry: NarrationEntry = {
            id: narrationId(),
            text: narrativeText,
            actor: actorName,
            timestamp: Date.now(),
            eventType: "NarrativeText",
          };
          const trimmed = s.narrationLog.slice(-99);
          const pending = _pendingAttackEntry;
          _pendingAttackEntry = null;
          if (pending) {
            // Player path: flush buffered attack outcome AFTER the prose line.
            return { narrationLog: [...trimmed, narrativeEntry, pending] };
          }
          return { narrationLog: [...trimmed, narrativeEntry] };
        });
        break;
      }

      case "AttackResolved": {
        // Optimistically advance the attacker's economy locally:
        //   attacksUsed += 1 (and actionAvailable→false when exhausted).
        // We deliberately do NOT bump tacticalVersion here: the GET /tactical
        // re-fetch races with the server's mid-attack resource write and
        // returns stale economy (e.g. attacksUsed=1 after the 2nd Extra
        // Attack), overwriting the optimistic increment and leaving the UI
        // saying "Attack 1/2" while the server has already exhausted the
        // action. TurnAdvanced re-syncs at end of turn.
        const p = event.payload;
        set((s) => {
          const attackerMatch = p.attacker ? findByRef(s.combatants, p.attacker) : undefined;
          const targetMatch = p.target ? findByRef(s.combatants, p.target) : undefined;
          const lastSeq = (s.lastAttackEvent?.seq ?? 0) + 1;
          const updatedCombatants = attackerMatch
            ? s.combatants.map((c) => {
                if (c.id !== attackerMatch.id) return c;
                const ae = c.actionEconomy;
                const usedNext = (ae?.attacksUsed ?? 0) + 1;
                const allowed = ae?.attacksAllowed ?? 1;
                const actionExhausted = usedNext >= allowed;
                return {
                  ...c,
                  turnFlags: actionExhausted
                    ? { ...c.turnFlags, actionSpent: true }
                    : c.turnFlags,
                  actionEconomy: ae
                    ? {
                        ...ae,
                        attacksUsed: usedNext,
                        actionAvailable: actionExhausted ? false : ae.actionAvailable,
                      }
                    : ae,
                };
              })
            : s.combatants;

          const attackEntry: NarrationEntry = {
            id: narrationId(),
            text: "",
            timestamp: Date.now(),
            eventType: "AttackResolved",
            attackData: {
              hit: p.hit,
              critical: p.critical as boolean | undefined,
              attackTotal: p.attackTotal as number | undefined,
              attackRoll: p.attackRoll as number | undefined,
              targetAC: p.targetAC as number | undefined,
              damageApplied: p.damageApplied as number | undefined,
              attacker: p.attacker,
              target: p.target,
            },
          };

          const trimmed = s.narrationLog.slice(-99);
          const lastEntry = trimmed[trimmed.length - 1];

          const lastAttackEvent = {
            seq: lastSeq,
            attackerId: attackerMatch?.id ?? null,
            targetId: targetMatch?.id ?? null,
          };

          if (lastEntry?.eventType === "NarrativeText") {
            // AI path: prose already logged — append outcome immediately.
            return {
              combatants: updatedCombatants,
              narrationLog: [...trimmed, attackEntry],
              lastAttackEvent,
            };
          }

          // Player path: prose not yet logged — buffer the entry.
          // If there's a stale pending entry (safety), flush it first.
          const base = _pendingAttackEntry ? [...trimmed, _pendingAttackEntry] : trimmed;
          _pendingAttackEntry = attackEntry;
          return {
            combatants: updatedCombatants,
            narrationLog: base,
            lastAttackEvent,
          };
        });
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
  setPendingReaction: (payload) => set({ pendingReaction: payload }),

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
    } else if (response.combatStarted === true && response.encounterId) {
      // Initiative resolved — combat transitioned to Active. Switch to tactical mode
      // and bump tacticalVersion so SessionPage re-fetches the now-populated encounter.
      set((s) => ({
        pendingRoll: null,
        encounterId: response.encounterId!,
        mode: "tactical",
        tacticalVersion: s.tacticalVersion + 1,
      }));
    } else {
      set({ pendingRoll: null });
    }
  },
}));
