# Handoff: Web Client Tactical View v6
**Date:** 2026-04-27  
**Commit:** `87b3d00`  
**Prior Handoff:** `plans/handoff-web-client-tactical-2026-04-27-v5.md`

---

## What Was Verified This Session

Full browser integration test — fresh session, new game server start, real combat flow:

| Step | Result |
|------|--------|
| Lobby → Create Session | ✅ Navigates to `/session/:id/setup` |
| Setup page quick-start "Solo Fighter vs Goblins" | ✅ Generates Thorin (real HP 40/40), adds 2 Goblin Warriors |
| Start Combat | ✅ Navigates to `/session/:id` tactical view |
| Character picker | ✅ Shows Thorin Ironfist · Level 5 |
| Tactical grid hydration | ✅ Tokens placed at server positions, HP/movement bars correct |
| Token selection (click Thorin) | ✅ Blue ring + hint text appear |
| Path preview (click destination) | ✅ Blue path cells + green destination border |
| Move confirm (double-click destination) | ✅ Server confirms move; token visually snaps to new position |
| Movement budget bar | ✅ Updates to 3ft remaining after 30ft move |

---

## Bug Fixed This Session

**Symptom:** After a confirmed move, Thorin's token stayed at the old position visually until the next page load.

**Root cause:** The `Move` SSE event handler in the store was correct, but Fastify SSE connections don't close immediately — their Fastify log entry only appears after disconnect — making it hard to diagnose. More importantly, SSE latency meant the canvas never got an update in the same render cycle as the move.

**Fix (`87b3d00`):**
- Added `moveCombatant(id, position)` action to `app-store.ts` (functional `set` — no stale closure).
- Called it in `TacticalLayout.handleCellTap` immediately after `gameServer.submitAction` returns (optimistic update). SSE Move event later becomes a no-op (same position).

---

## Current State of the Web Client

### Working End-to-End
- Lobby → Session Setup → Combat Start → Tactical View full flow
- Real character HP from generated sheet
- Monster HP from stat blocks  
- Canvas grid with tokens (position, HP bar, active ring, selected ring)
- Movement: select token → path preview → confirm move → instant visual update
- Action economy bar (ACTION/BONUS/REACT/MOVE)
- End Turn button
- Combat log (narration log UI present, events from SSE)

### Not Yet Implemented
1. **Dice roll prompt UI** — `requiresPlayerInput: true` responses (attack roll, damage roll, initiative) go to the server but the client has no modal to capture d20/damage dice rolls. Currently the server likely just stalls waiting for a roll submission. This is the most critical next feature.
2. **Attack flow UI** — Attack button toggles `attackMode`, ring appears on enemy tokens, clicking enemy submits `"attack <name>"`. But then the server requests a roll which isn't handled yet.
3. **Spells panel** — `📖 Spells` button is wired (shows in action bar) but opens no panel.
4. **Movement UX polish** — No cancel button; no movement cost overlay per cell; no `reachablePosition` fallback for blocked destinations.
5. **Turn advance feedback** — `TurnAdvanced` SSE event bumps `tacticalVersion`, triggering a full tactical re-fetch. But there's no visual loading state between turns.

---

## Recommended Next Work

### Priority 1: Dice Roll UI (blocks all combat)
When `submitAction` returns a response with `requiresPlayerInput: true` and `pendingRoll` (type: `attack_roll`, `damage_roll`, or `initiative`), show a modal with:
- Roll description (e.g. "Roll d20 + 5 for attack")
- A "Roll Dice" button that generates a random roll client-side (deterministic dice not needed for UI)
- Submit to the appropriate endpoint (`/combat/roll` or similar)

### Priority 2: Attack Flow  
1. Click Attack → `attackMode = true`
2. Click enemy token → `"attack <name>"` → server returns `requiresPlayerInput` (attack roll)
3. Dice modal → submit roll → server returns hit/miss → if hit, `requiresPlayerInput` (damage roll)  
4. Damage modal → submit → `DamageApplied` SSE event → HP bar updates

### Priority 3: Initiative Roll
Combat starts in `Pending` status. The first action the server asks for is an initiative roll. This needs the dice roll UI too.

---

## Key Files
| File | Purpose |
|------|---------|
| `packages/web-client/src/store/app-store.ts` | Zustand store — `moveCombatant` added |
| `packages/web-client/src/tactical/TacticalLayout.tsx` | Movement + attack orchestration |
| `packages/web-client/src/tactical/GridCanvas.tsx` | Canvas renderer |
| `packages/web-client/src/pages/SessionSetupPage.tsx` | Setup/bootstrap page |
| `packages/web-client/src/hooks/use-game-server.ts` | HTTP API client |
| `packages/web-client/src/types/server-events.ts` | SSE event types |

---

## Dev Commands
```powershell
# Start game server (port 3001)
pnpm -C packages/game-server dev

# Start web client (port 5173 or 5174 if occupied)
pnpm --filter @dungeonmaster/web-client dev
```
