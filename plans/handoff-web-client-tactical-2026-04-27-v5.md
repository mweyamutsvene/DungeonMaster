# Handoff: Web Client Tactical Movement + Real HP Bootstrap

**Date:** 2026-04-27  
**Branch:** master  
**Status:** Ready to commit. Build/typecheck clean.

---

## Outcome

Continued from `handoff-web-client-tactical-2026-04-27-v4.md` and implemented the next practical slice:

1. Setup combat now derives HP from real created entities instead of hardcoded values.
2. Tactical movement input is now wired in the UI with path preview + confirm flow.

This keeps tactical bootstrap working while adding first-pass player-drivable movement behavior.

---

## What Changed

### 1) Setup combat uses real HP

**File:** `packages/web-client/src/pages/SessionSetupPage.tsx`

- Character combatant HP now comes from generated character sheet values:
  - `sheet.maxHp` fallback `sheet.hp` fallback `42`
  - `hpCurrent` uses `sheet.currentHp` fallback `maxHp`
- Monster combatant HP now comes from the selected stat block `maxHp` per spawned monster.
- Removed unused `setMode` import/state usage.
- Removed unnecessary `as any` on `startCombat` payload.
- Character class display is now resilient to either `class` or `className` fields.

### 2) Tactical movement UI (preview + confirm)

**Files:**
- `packages/web-client/src/tactical/TacticalLayout.tsx`
- `packages/web-client/src/tactical/GridCanvas.tsx`
- `packages/web-client/src/hooks/use-game-server.ts`

Implemented movement loop:

1. On your turn, tap your active token to select mover.
2. Tap destination cell once -> requests `POST /sessions/:id/combat/:encounterId/path-preview`.
3. Grid renders preview path + destination marker.
4. Tap the same destination again -> submits `"move to X,Y"` via combat action endpoint.
5. Attack-mode selection clears movement state and vice versa.

Canvas rendering additions:
- selected mover ring
- blue path-highlight cells
- destination outline (green when reachable, red when blocked)

API client additions:
- `previewPath(...)` for path-preview endpoint
- `submitAction(...)` and `endTurn(...)` now typed as `ActionResponse`

### 3) Shared API typing adjustments

**File:** `packages/web-client/src/types/api.ts`

- Added exported `Character` interface for reuse.
- `Character` supports both `class` and `className` fields to accommodate mixed payload shapes.

---

## Existing In-Flight Files (still part of this milestone)

These were already modified in v4 and remain valid:

- `packages/web-client/src/App.tsx`
  - route: `/session/:id/setup`
- `packages/web-client/src/pages/LobbyPage.tsx`
  - create-session flow now routes to setup page
- `packages/web-client/src/pages/SessionSetupPage.tsx`
  - setup page itself (new)
- `plans/handoff-web-client-tactical-2026-04-27-v4.md`
  - previous handoff context

---

## Validation

Ran successfully:

- `pnpm --filter @dungeonmaster/web-client exec tsc --noEmit`
- `pnpm --filter @dungeonmaster/web-client build`

Notes:
- Build and typecheck are green.
- Manual browser runtime validation of movement was not completed in this session because the active dev-server page in tool context showed repeated `ERR_CONNECTION_REFUSED` after earlier connection loss.

---

## Known Remaining Work

1. Movement UX polish:
- Add explicit cancel button / gesture for selected mover mode.
- Consider using `reachablePosition` from preview when exact destination is blocked.
- Show movement cost text (`totalCostFeet`) in overlay.

2. Dice roll flow (`requiresPlayerInput`) still not wired to UI.

3. Spells panel still placeholder (button only).

4. Setup presets still partly simplified vs CLI scenarios (from v4).

---

## Suggested Next Sequence

1. Add a small movement status chip in tactical UI:
- `"Preview: 20ft / 30ft"`
- `"Blocked"` messaging from preview response

2. Wire `requiresPlayerInput` action loop:
- action response handling
- numeric roll input modal
- submit to `/sessions/:id/combat/roll-result`

3. Begin spells panel MVP:
- fetch known/prepared spells
- target-selection handoff similar to attack/move modes

---

## Quick Summary

This handoff moves the tactical client forward from bootstrap-only into the first interactive movement flow, and removes HP hardcoding so setup combatants use real stats from generated characters and selected monster stat blocks.
