# Handoff: Web Client — Tactical Interactions Wired, Next: Movement + Spells + Theatre

**Date:** 2026-04-26  
**Branch:** master  
**Commit:** 5084c29  
**Status:** All blocking bugs fixed. Attack, Dodge, Dash, Help, Hide wired. Character claiming works. SSE re-fetches work. Build clean.

---

## What Was Fixed This Session (Do Not Redo)

### Bugs closed

| Bug | Fix |
|-----|-----|
| `endTurn` called wrong endpoint | Now uses `POST /sessions/:id/actions` with `{ kind: "endTurn", encounterId, actor: { type: "Character", characterId } }` — matching the CLI |
| `respondToReaction` called non-existent path | Now uses `POST /encounters/:encounterId/reactions/:pendingActionId/respond` with `{ combatantId, opportunityId: pendingActionId, choice }` |
| `CombatStarted` SSE → combatants empty | Store increments `tacticalVersion` on `CombatStarted`; `SessionPage` watches and re-fetches tactical view |
| `TurnAdvanced` SSE → stale activeCombatantId | Same `tacticalVersion` mechanism — full tactical re-fetch after each turn advance |
| `myCharacterId` never set | Character picker shown in `SessionPage` before the game view — player picks from session's character list |
| Action buttons did nothing | Dodge/Dash/Help/Hide wired to `submitAction` with natural language text; Attack enters canvas targeting mode |

### New flows

**Character claiming:** After joining/creating a session, `SessionPage` shows a character picker if `myCharacterId` is null and the session has characters. Player taps their character, `myCharacterId` is stored. "Observer" option lets them skip.

**Attack targeting mode:** Tapping the Attack button (when it's your turn) enters `attackMode = true`. Enemy tokens on the canvas pulse orange. Tapping an enemy submits `"attack [name]"` as a `submitAction` call. Tapping empty space or a non-enemy cancels the mode.

**SSE re-fetch pattern:** `app-store.ts` has a `tacticalVersion: number` field. When `CombatStarted` or `TurnAdvanced` fires, the store increments `tacticalVersion` without making any API calls. `SessionPage` watches this value via a `useEffect` + `useRef` (to skip re-runs for the same version). When it changes, it fetches `getCombatState + getTacticalView` in parallel and calls `hydrateCombat`.

---

## Current Architecture State

### Store shape (`src/store/app-store.ts`)
Same as before, plus:
```ts
tacticalVersion: number   // incremented on CombatStarted + TurnAdvanced SSE events
```

### File map (unchanged from last handoff, components now wired)
```
packages/web-client/src/
├── hooks/
│   ├── use-game-server.ts       — endTurn + respondToReaction now correct
│   └── use-sse.ts               — unchanged
├── pages/
│   └── SessionPage.tsx          — adds tacticalVersion watcher + character picker
├── store/app-store.ts           — adds tacticalVersion field
├── tactical/
│   ├── ActionBar.tsx            — action buttons wired; attack/endTurn/dodge/dash/help/hide
│   ├── GridCanvas.tsx           — attackMode prop: enemy token highlighting
│   └── TacticalLayout.tsx      — manages attackMode state, routes token taps
└── shared-ui/
    └── ReactionPrompt.tsx       — correct reaction endpoint
```

---

## Server API Reference (Verified This Session)

All endpoints below are confirmed working:

| Method | Path | Body | Notes |
|--------|------|------|-------|
| `POST` | `/sessions/:id/actions` | `{ kind: "endTurn", encounterId, actor: { type, characterId } }` | End turn — programmatic action |
| `POST` | `/sessions/:id/combat/action` | `{ text, actorId, encounterId }` | Natural language action (attack, dodge, dash, etc.) |
| `POST` | `/encounters/:encounterId/reactions/:pendingActionId/respond` | `{ combatantId, opportunityId, choice }` | Reaction response |
| `GET` | `/sessions/:id/combat/:encounterId/tactical` | — | Full tactical view including activeCombatantId |

`actorId` in combat/action = **character entity ID** (`character.id` from session response).  
`combatantId` in encounter = combatant record ID (different from entity ID).

---

## What Is NOT Done (Next Steps)

### Immediate / High Priority

**M3.2 Movement — tap cell to move:**  
1. Player taps own token → mark as selected (currently just opens sheet)
2. Player taps empty cell → call `POST /sessions/:id/combat/:encounterId/path-preview` with `{ from: currentPos, to: tappedCell, maxCostFeet: movementRemainingFeet }`
3. Render path preview on canvas (blue highlighted cells)
4. Second tap on destination confirms → `submitAction` with `"move to X,Y"`
5. OA interrupt: if server returns a pending action, the `ReactionPrompt` already handles it

**M3.5 Spells panel:**  
- Spells button exists but is not wired
- Fetch `GET /sessions/:id/characters/:characterId/spells` for prepared spell list
- Display as expandable list with slot costs
- Tapping a spell: single-target → enter targeting mode like Attack; AoE → enter cell-select mode

**M3.4 Dice roll UI:**  
- After `submitAction`, the server may return a `requiresPlayerInput: true` + `rollType` in the response
- The client needs to detect this and show a dice roll input ("Roll your d20")
- Player submits result → `POST /sessions/:id/combat/roll-result` with `{ text: "rolled 14", actorId }`
- Check `ActionResponse` shape in `packages/player-cli/src/types.ts` for the full shape

### Medium Priority

**Theatre mode (placeholder currently):**  
`packages/web-client/src/theatre/TheatreLayout.tsx` is an empty stub. Build:
- Narration text display (styled prose)
- Action input box → `POST /sessions/:id/combat/action` with natural language
- Scene image placeholder
- Party chat

**Roll result flow (`requiresPlayerInput`):**  
The `submitAction` and other combat action endpoints return an `ActionResponse` that may include `requiresPlayerInput: true` with a `rollType`. Need to detect this in `ActionBar` / `TacticalLayout` and show a numeric input for the player to roll and submit.

### Already Working (No Action Needed)

- Reaction prompts: `ReactionPrompt` component renders, timer works, responds to server
- SSE reconnection: auto-reconnects on drop
- HP updates: `DamageApplied` / `HealingApplied` events update token HP bars in real time
- Token movement: `Move` SSE event updates position on canvas
- Initiative tracker: renders turn order, highlights active combatant
- Narration log: `NarrativeText` and `AttackResolved` events append to log
- Action economy bar: shows pip state for active combatant

---

## Known Remaining Debt

1. **`ActionResponse` handling** — `submitAction` and `endTurn` return a response that may contain `requiresPlayerInput`, `pendingAction`, or narrative text. Currently ignored. See `player-cli/src/types.ts` → `ActionResponse` for the full shape.

2. **Spell slot tracking** — `actionEconomy.resourcePools` on `StoredCombatant` contains spell slots but the Spells button doesn't use them yet.

3. **`setMyCharacterId("")` (observer mode)** — the "no character" path sets `myCharacterId` to an empty string `""`. Downstream checks use `!!myCharacterId` which treats `""` as falsy — so all "is my turn" checks work. But it's a bit fragile. Consider `null | string` and a separate `isObserver` flag if this causes issues.

4. **No NPC/monster token distinguishing** — all non-Character combatants are shown as red. Boss monsters, friendly NPCs, and hostiles all look identical. Consider `combatantType` + faction data when available.

5. **Canvas: `position: null` combatants** — combatants not yet placed on the grid (position is null) are skipped in rendering. Fine for now, but if the server places a combatant with null position, they won't appear.

---

## How the CLI Does It (Reference)

`packages/player-cli/src/` is the best reference for server interaction patterns:
- `game-client.ts` — all HTTP calls with correct paths/bodies
- `types.ts` — `ActionResponse` shape (check `requiresPlayerInput`, `pendingAction`)
- `event-stream.ts` — SSE event consumption with `waitFor` pattern
- `agent-setup.ts` — end-to-end: create session → combat → run turns

For combat flow: the CLI uses `submitAction` → checks `requiresPlayerInput` → `submitRoll` → loops. The web client needs this same loop but driven by player UI instead of programmatic logic.

---

## Build & Dev

```bash
# Dev server (proxies /api/* → http://localhost:3001)
pnpm --filter @dungeonmaster/web-client dev
# Opens at http://localhost:5173

# Typecheck
pnpm --filter @dungeonmaster/web-client exec tsc --noEmit

# Build
pnpm --filter @dungeonmaster/web-client build
```

Game server must be running on port 3001 for the proxy to work.
