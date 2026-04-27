# Handoff: Web Client — Tactical Mode Shell Complete, Next: Tactical Interactions

**Date:** 2026-04-26  
**Branch:** master  
**Status:** Shell done, typecheck clean, builds successfully. Tactical interactions not yet wired.

---

## What Was Built (Do Not Redo)

`packages/web-client/` is a new pnpm workspace package — a Vite + React 18 + TypeScript + Tailwind + Zustand + PWA app that connects to the existing `game-server` on port 3001.

**To run the dev server:**
```
pnpm --filter @dungeonmaster/web-client dev
```
Opens on http://localhost:5173. Proxy: `/api/*` → `http://localhost:3001/*`.

### File map
```
packages/web-client/
├── package.json / vite.config.ts / tsconfig.json / tailwind.config.ts / postcss.config.js
├── index.html
└── src/
    ├── main.tsx                         React 18 entry
    ├── App.tsx                          BrowserRouter → / and /session/:id
    ├── index.css                        Tailwind base + scrollbar-hide utility
    ├── types/
    │   ├── server-events.ts             Discriminated union of all SSE event types (NO catch-all — intentional for TS narrowing)
    │   └── api.ts                       SessionResponse, EncounterState, TacticalViewResponse, StoredCombatant
    ├── store/app-store.ts               Zustand store — session, mode, combatants, narration, reactions
    ├── hooks/
    │   ├── use-sse.ts                   EventSource → named listeners per event type → store.handleServerEvent, auto-reconnect
    │   └── use-game-server.ts           Typed fetch wrappers (getCombatState, getTacticalView, endTurn, submitAction, respondToReaction)
    ├── pages/
    │   ├── LobbyPage.tsx                Join by session ID code, or create new session
    │   └── SessionPage.tsx              Bootstraps session, checks active combat, connects SSE, renders mode
    ├── tactical/
    │   ├── TacticalLayout.tsx           Flex-column shell (status bar → initiative → canvas → economy → action bar → log)
    │   ├── PartyStatusBar.tsx           HP bars for Character-type combatants, tap → CharacterSheetModal
    │   ├── InitiativeTracker.tsx        Horizontal scroll, highlights activeCombatantId
    │   ├── GridCanvas.tsx               HTML5 Canvas — draws grid + tokens + HP bars, click → onTokenTap / onCellTap
    │   ├── ActionEconomyBar.tsx         Action/Bonus/Reaction pips + movement bar (uses actionEconomy.movementRemainingFeet)
    │   ├── ActionBar.tsx                Attack/Dodge/Dash/Help/Hide/Spells buttons + End Turn
    │   └── NarrationLog.tsx             Collapsible combat log, auto-scroll
    ├── theatre/
    │   └── TheatreLayout.tsx            Placeholder — scene image + narration scroll + action input (all disabled/mock)
    └── shared-ui/
        ├── CharacterSheetModal.tsx      Slide-up overlay showing HP + action economy + conditions
        └── ReactionPrompt.tsx           Countdown popup → Use Reaction / Decline → POST to server
```

---

## Architecture Decisions You Must Know

### Store shape (`src/store/app-store.ts`)
```ts
mode: "tactical" | "theatre" | null     // null = loading
encounterId: string | null
round: number
activeCombatantId: string | null        // the combatant whose turn it is (NOT an entity ID)
combatants: StoredCombatant[]           // see types/api.ts
```

`StoredCombatant` is `TacticalCombatant` (from tactical view) merged with entity IDs from `EncounterState`:
```ts
{
  id: string                    // combatant record ID
  name: string
  combatantType: "Character" | "Monster" | "NPC"
  characterId?: string          // underlying entity ID — use this for "is it my turn?"
  monsterId?: string
  npcId?: string
  initiative: number
  hp: { current: number; max: number }
  position: { x: number; y: number } | null
  actionEconomy: {
    actionAvailable: boolean
    bonusActionAvailable: boolean
    reactionAvailable: boolean
    movementRemainingFeet: number
    attacksUsed: number
    attacksAllowed: number
  }
  movement: { speed: number; dashed: boolean; movementSpent: boolean }
  turnFlags: { actionSpent: boolean; bonusActionUsed: boolean; reactionUsed: boolean; disengaged: boolean }
  conditions?: string[]
  deathSaves?: { successes: number; failures: number }
}
```

`myCharacterId` in the store is the local player's character entity ID. **Not set anywhere yet** — the player has no way to claim a character. That needs to be built.

### Mode routing
- `SessionPage` on mount: calls `GET /sessions/:id` (verify exists), then `GET /sessions/:id/combat` (404 = no combat → theatre mode, else → fetch tactical view → hydrate + tactical mode)
- SSE `CombatStarted` event → switches mode to tactical
- SSE `CombatEnded` event → switches mode to theatre
- After `CombatStarted`, the client should re-fetch the tactical view to hydrate combatants (currently it does not — the re-fetch after CombatStarted is NOT implemented yet)

### SSE event types (`src/types/server-events.ts`)
The union has NO catch-all `{ type: string; payload: unknown }` — this was intentional because TypeScript can't narrow a discriminated union with a string catch-all. Unknown events hit the `default:` branch of the switch in the store. The SSE hook uses `RawServerEvent` for the wire format and casts before dispatch.

### API field names — critical gotchas found during this session
The server's tactical view uses different field names than you'd expect. These are the **actual** names:
- `combatantType` (NOT `entityType`)
- `actionEconomy.movementRemainingFeet` (NOT `resources.movementRemaining`)
- `activeCombatantId` (NOT `currentTurnCombatantId`)
- `movement.speed` for max speed (NOT `resources.movementMax`)
- **No `round` on TacticalViewResponse** — round comes from `EncounterState.encounter.round`

---

## Server API Reference (Verified Routes)

**Base URL:** `http://localhost:3001` (proxied via `/api` in the Vite dev server)

### Session
| Method | Path | Notes |
|--------|------|-------|
| POST | `/sessions` | Create session. Body optional. Returns `{ id, ... }` |
| GET | `/sessions/:id` | Returns `{ session, characters, monsters, npcs }` |

### Combat state
| Method | Path | Notes |
|--------|------|-------|
| GET | `/sessions/:id/combat` | Returns `EncounterState`. **404 if no encounter exists** (expected — means no combat, go to theatre) |
| GET | `/sessions/:id/combat/:encounterId/tactical` | Returns `TacticalViewResponse`. Requires active encounter ID |
| GET | `/sessions/:id/combat/:encounterId/combatants` | Raw combatant records array |

### Combat actions (tabletop flow — what the UI should call)
| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/sessions/:id/combat/next` | `{ encounterId?: string }` | Advance to next turn |
| POST | `/sessions/:id/combat/initiate` | `{ text: string; actorId: string }` | LLM-parsed combat initiation (initiative prompt). `actorId` = character entity ID |
| POST | `/sessions/:id/combat/action` | `{ text: string; actorId: string; encounterId: string }` | LLM-parsed action (attack, move, cast spell, etc.). Natural language. `actorId` = **character entity ID** |
| POST | `/sessions/:id/combat/roll-result` | `{ text: string; actorId: string }` | Submit a dice roll result (e.g. "18" for an attack roll) |
| POST | `/sessions/:id/combat/move/complete` | `{ pendingActionId: string; roll?: number; rollType?: string }` | Completes a move that was interrupted by an OA prompt |

### Path preview (movement UI)
| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/sessions/:id/combat/:encounterId/path-preview` | `{ from: {x,y}, to: {x,y}, maxCostFeet?: number, desiredRange?: number, avoidHazards?: boolean }` | Returns A* path cells for movement preview |

### Events
| Method | Path | Notes |
|--------|------|-------|
| GET | `/sessions/:id/events` | SSE stream. Sends named events matching `GameEventType` strings |

### Characters (for session setup)
| Method | Path | Notes |
|--------|------|-------|
| POST | `/sessions/:id/characters` | Create a character in the session |
| GET | `/sessions/:id/characters` | Not confirmed — use `GET /sessions/:id` which returns characters |
| POST | `/sessions/:id/monsters` | Add a monster to the session |
| POST | `/sessions/:id/combat/start` | Start combat. Body: `{ combatants: [...] }` |

---

## What Is NOT Done (Next Steps)

The plan is: finish tactical mode fully, then build theatre mode.

### Immediate gaps (blocking a real session)

1. **No character claiming** — `myCharacterId` in the store is never set. The player joins a session but the app doesn't know which character is theirs. Need: after joining, player picks/claims a character, store saves `myCharacterId = character.entityId`.

2. **No re-fetch after `CombatStarted` SSE event** — when the server emits `CombatStarted`, the store switches mode but combatants array is empty because the tactical view wasn't fetched. Fix: in `use-sse.ts` or `SessionPage`, listen for `CombatStarted` and trigger a `getCombatState` + `getTacticalView` + `hydrateCombat`.

3. **No re-fetch after `TurnAdvanced`** — action economy resets on turn advance aren't reflected in store. The tactical view needs to be re-fetched after `TurnAdvanced` to get fresh `actionEconomy` for the new active combatant.

4. **End Turn button calls wrong path** — currently uses a non-existent `endTurn(sessionId, encounterId)` that POSTs to `/sessions/:id/combat/${encounterId}/turn`. The real route is `POST /sessions/:id/combat/next` with body `{ encounterId }`. The `gameServer.endTurn` in `use-game-server.ts` already has the right path — double-check it posts the body correctly.

### M3 tactical features to build (in order)

**M3.2 Touch controls:**
- Pinch-to-zoom on the canvas (use pointer events, track distance between two touches)
- Two-finger pan
- Mobile-friendly tap detection (distinguish tap vs scroll)

**M3.3 Movement — tap cell to move:**
1. Player taps their own token → selected
2. Player taps empty cell → call `POST /sessions/:id/combat/:encounterId/path-preview` with `{ from: currentPos, to: tappedCell, maxCostFeet: movementRemainingFeet }`
3. Show path preview on canvas (highlight cells along the path, color code by terrain cost)
4. Player taps the destination again → confirm → call `POST /sessions/:id/combat/action` with `{ text: "move to X,Y", actorId, encounterId }`
5. Handle OA interrupts: server may respond with a pending action (opportunity attack) — show a popup for the opponent's player to react

**M3.4 Attack flow:**
1. Player taps Attack button → enters targeting mode (enemy tokens highlighted)
2. Player taps enemy token → call `POST /sessions/:id/combat/action` with `{ text: "attack [name]", actorId, encounterId }`
3. Server may respond with `requiresPlayerInput: true` and a `rollType` — show dice roll UI
4. Player submits roll → `POST /sessions/:id/combat/roll-result` with `{ text: "rolled 14", actorId }`
5. Damage roll → another `POST /sessions/:id/combat/roll-result`

**M3.5 Action bar wiring:**
- Connect each action button to the right API call
- Dodge, Dash, Help, Hide → `POST /sessions/:id/combat/action` with natural language text
- Spells panel → expandable list of prepared spells with slot costs (need to fetch from character sheet)

**M3.6 Initiative tracker already renders** — but `TurnAdvanced` SSE event should trigger tactical view re-fetch to update `activeCombatantId`.

**M3.7 Reaction prompts already work** — `ReactionPrompt` component renders, has countdown, responds to server. But `respondToReaction` in `use-game-server.ts` calls a non-existent endpoint. The real reaction flow goes through `POST /sessions/:id/combat/move/complete` (for OA) or the pending-roll-interrupt endpoint. Needs investigation — check `session-tabletop.ts` for the actual reaction response endpoint.

**M3.8 AI enemy turns** — server handles AI automatically. Client just needs to animate token movement when it sees `Move` SSE events, and show attack results from `AttackResolved` / `DamageApplied` events. Canvas already handles position updates via `Move` events.

**M3.9 Theatre ↔ Tactical transition** — already handled by `CombatStarted` / `CombatEnded` SSE events switching the mode in the store. Visual transition (scene image sliding out, grid sliding in) is purely CSS/animation work.

---

## Important: How the CLI Does It (Reference)

The `packages/player-cli/` package is the best reference for how to talk to the server. Key files:
- `packages/player-cli/src/game-client.ts` — all HTTP calls with correct paths and bodies
- `packages/player-cli/src/types.ts` — `EncounterState`, `TacticalState`, `ActionResponse` types (already adapted into `src/types/api.ts`)
- `packages/player-cli/src/event-stream.ts` — how SSE events are consumed (already adapted into `src/hooks/use-sse.ts`)
- `packages/player-cli/src/agent-setup.ts` — end-to-end flow: create session → add characters/monsters → start combat → run turns

The `POST /sessions/:id/combat/action` endpoint takes natural language (e.g. `"attack goblin"`, `"move to 3,4"`, `"cast fireball at goblin"`). It uses LLM intent parsing. The `actorId` must be the **character entity ID** (from `character.id`, not the combatant record ID).

---

## Known Bugs / Debt Left

1. `ReactionPrompt.tsx` calls `respondToReaction` which hits a non-existent `/reactions/:id` path. Needs to be routed to the correct server endpoint — investigate `session-tabletop.ts` for how reactions are resolved.
2. `gameServer.endTurn` sends `{ encounterId }` as body — confirm this matches what `POST /sessions/:id/combat/next` expects (it does: `Body: { encounterId?: string }`).
3. `myCharacterId` is never populated — all "is my turn" logic in ActionBar and ActionEconomyBar falls back to showing the active combatant's data, not the player's character.
4. After `CombatStarted` SSE, combatants array is empty — need to trigger a re-fetch of the tactical view.
5. The canvas doesn't yet handle combatants with `position: null` gracefully in the grid size calculation (already guarded but not tested with real data).
