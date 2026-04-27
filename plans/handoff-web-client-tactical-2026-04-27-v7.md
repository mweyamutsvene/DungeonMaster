# Handoff: Web Client Tactical View v7 — Dice Roll Modal + Full Attack Flow
**Date:** 2026-04-27  
**Commit:** `18d855f`  
**Prior Handoff:** `plans/handoff-web-client-tactical-2026-04-27-v6.md`

---

## What Was Implemented This Session

### Dice Roll Modal (`DiceRollModal.tsx`)

A bottom-sheet modal that intercepts every `requiresPlayerInput: true` response from the server and prompts the player to roll.

- Parses `diceNeeded` notation (e.g. `d20`, `1d8+3`, `2d6`) and renders a **Roll** button
- Rolling generates a random client-side result with breakdown display (e.g. `(7) + 3 = 10`)
- Player can override with a manual entry field
- On Confirm: submits `"I rolled N"` to `POST /sessions/:id/combat/roll-result`
- On response: if another `requiresPlayerInput` follows (damage after hit), chains directly into the next modal
- Cancel: clears the pending roll without submitting

**Roll type labels and emoji:**
| rollType | Label | Emoji |
|---|---|---|
| `initiative` | Roll Initiative | ⚡ |
| `attack` | Roll Attack | ⚔️ |
| `damage` | Roll Damage | 💥 |
| `opportunity_attack` | Roll Opportunity Attack | ⚔️ |
| `opportunity_attack_damage` | Roll Opportunity Attack Damage | 💥 |

---

## New Files
| File | Purpose |
|------|---------|
| `packages/web-client/src/shared-ui/DiceRollModal.tsx` | New dice roll prompt component |

## Modified Files
| File | Change |
|------|--------|
| `packages/web-client/src/store/app-store.ts` | Added `PendingRoll` type, `pendingRoll` state, `setPendingRoll()`, `handleRollResponse()` |
| `packages/web-client/src/hooks/use-game-server.ts` | Added `submitRoll()` for `POST /sessions/:id/combat/roll-result` |
| `packages/web-client/src/pages/SessionPage.tsx` | Added `DiceRollModal` import + renders `{pendingRoll && <DiceRollModal />}` |
| `packages/web-client/src/tactical/TacticalLayout.tsx` | `handleAttackToken` now calls `handleRollResponse(response, actorId)` |
| `packages/web-client/src/tactical/ActionBar.tsx` | `doAction` now calls `handleRollResponse(response, actorId)` |

---

## Browser-Verified Flow

| Step | Result |
|------|--------|
| Create session → Solo Fighter vs Goblins | ✅ |
| Start Combat → Tactical View | ✅ |
| Click Thorin → select mover | ✅ Blue ring + hint text |
| Click cell (35,10) → path preview | ✅ Blue path rendered |
| Double-click to confirm move | ✅ Thorin moves to (35,10), adjacent to goblin |
| Click Attack → click goblin at (40,10) | ✅ "Roll Attack" modal appears |
| Click "Roll d20" → rolls 19 | ✅ Breakdown shown, Confirm enabled |
| Confirm attack roll | ✅ "19 + 6 = 25 vs AC 15. Hit!" |
| "Roll Damage" modal appears for `1d8+3` | ✅ Chains immediately |
| Roll 1d8+3 → 7+3 = 10 → Confirm | ✅ |
| "Thorin Ironfist deals 13 damage to Goblin Warrior. Goblin Warrior falls!" | ✅ |
| Initiative tracker shows first goblin strikethrough | ✅ |
| Goblin token disappears from grid | ✅ |

---

## Current State of the Web Client

### Working End-to-End
- Lobby → Session Setup → Combat Start → Tactical View
- Real HP from character sheets + monster stat blocks
- Canvas grid with tokens (HP bar, active/selected rings, dead token rendering)
- Movement: select → path preview → confirm → optimistic position update
- **Attack: attack mode → click enemy → attack roll modal → hit/miss → damage roll modal → HP update**
- Action economy bar (ACTION/BONUS/REACT/MOVE)
- End Turn button
- Combat log (narration events from SSE)
- Reaction prompt modal (pre-existing)

### Not Yet Implemented
1. **Initiative roll on combat start** — `POST /sessions/:id/combat/start` puts combat in `"Active"` status directly (no `Pending` + initiative prompts in the current flow). If using `initiate` endpoint instead, an initiative roll modal would be needed. Current flow skips this. See notes below.
2. **Extra Attack chaining** — Fighter L5 gets 2 attacks. After the first kill, the server may prompt for a second attack roll. This should chain via `handleRollResponse` already — but untested.
3. **Spells panel** — `📖 Spells` button wired but opens no panel.
4. **Movement UX polish** — No cancel gesture for selected mover; no movement cost per cell overlay; no `reachablePosition` fallback for blocked destinations.
5. **Opportunity attack reaction** — `ReactionPrompt` modal pre-exists for this; needs integration test.
6. **Turn advance feedback** — No loading spinner between AI turns.

---

## Architecture Notes

### Store shape for pending rolls
```ts
interface PendingRoll {
  rollType: string;      // "attack" | "damage" | "initiative" | ...
  diceNeeded?: string;   // e.g. "d20", "1d8+3"
  message: string;       // server's human-readable message
  actorId: string;
}
```

### Roll chain pattern
Any code that calls `gameServer.submitAction(...)` or `gameServer.submitRoll(...)` should:
```ts
const response = await gameServer.submitAction(...);
handleRollResponse(response, actorId);  // sets pendingRoll if requiresPlayerInput
```
`handleRollResponse` clears `pendingRoll` when the response is final (no more rolls needed).

---

## Recommended Next Work

### Priority 1: Extra Attack chaining (untested)
Fighter L5 should get 2 attacks. After the first attack resolves (goblin killed), the server might return another `requiresPlayerInput: true` for the second attack roll. Verify this chains through `handleRollResponse` correctly.

### Priority 2: Spells Panel MVP
1. Fetch `GET /sessions/:id/characters/:charId/spells` (or similar) 
2. List prepared/known spells with slot levels
3. Cast flow: select spell → (pick target if needed) → submit `"cast <spell>"` → dice modal for saving throw if applicable

### Priority 3: Initiative Roll (if switching to `initiate` endpoint)
The current setup skips initiative (combat starts immediately `Active`). If we want the full tabletop flow:
- `POST /sessions/:id/combat/initiate` with `{ text: "I attack", actorId }`
- Response: `requiresPlayerInput: true, rollType: "initiative"`
- `DiceRollModal` handles it already

### Priority 4: Movement UX Polish
- Cancel button/gesture for selected mover mode
- Movement cost overlay per cell (from `PathPreviewResponse.cells[].cumulativeCostFeet`)
- `reachablePosition` fallback when destination is blocked

---

## Dev Commands
```powershell
# Start game server (port 3001)
pnpm -C packages/game-server dev

# Start web client (port 5173+)
pnpm --filter @dungeonmaster/web-client dev
```
