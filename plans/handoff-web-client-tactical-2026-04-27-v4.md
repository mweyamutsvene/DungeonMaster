# Handoff: Web Client Tactical Bootstrap Now Reaches Live Combat

**Date:** 2026-04-27  
**Branch:** master  
**Status:** Uncommitted local changes present. Browser-verified flow now reaches tactical combat from a fresh session.

---

## Outcome

The web client no longer dead-ends after session creation. A new setup step now sits between lobby creation and tactical play, and that step can seed a quick-start scenario and launch a live combat encounter that renders in the existing tactical UI.

Browser validation reached this state successfully:

- Session created from the lobby
- Redirected to `/session/:id/setup`
- Quick-start scenario loaded `Thorin Ironfist` plus `2x Goblin Warrior`
- Start Combat transitioned to `/session/:id`
- Tactical screen rendered with:
  - party HP chip
  - round tracker
  - initiative strip
  - action economy bar
  - action buttons (`Attack`, `Dodge`, `Dash`, `Help`, `Hide`, `Spells`, `End Turn`)

Observed browser state at handoff:

- Thorin Ironfist shown at `42/42`
- Round `1`
- Two Goblin Warriors present
- Action economy visible with `30ft` movement

---

## Files Changed

- `packages/web-client/src/App.tsx`
  - Added route for `/session/:id/setup`

- `packages/web-client/src/pages/LobbyPage.tsx`
  - Changed create-session flow to navigate to setup instead of dropping directly into the session page

- `packages/web-client/src/hooks/use-game-server.ts`
  - Added client methods for:
    - `generateCharacter`
    - `addMonster`
    - `startCombat`

- `packages/web-client/src/pages/SessionSetupPage.tsx`
  - New setup UI
  - Quick-start scenario templates modeled after player-cli scenarios
  - Character generation via `/sessions/:id/characters/generate`
  - Monster registration via `/sessions/:id/monsters`
  - Combat start via `/sessions/:id/combat/start`

---

## What Was Verified

### Executable validation

- `pnpm --filter @dungeonmaster/web-client build`
  - Passed after the setup-page changes

### Editor validation

- No reported errors in:
  - `packages/web-client/src/App.tsx`
  - `packages/web-client/src/hooks/use-game-server.ts`
  - `packages/web-client/src/pages/LobbyPage.tsx`
  - `packages/web-client/src/pages/SessionSetupPage.tsx`

### Manual browser validation

- Fresh create-session flow reaches setup page
- Quick-start load populates character + enemy roster
- Start Combat transitions into the existing tactical shell
- Tactical controls render for the active player

---

## Current Flow

```text
LobbyPage
  -> POST /api/sessions
  -> /session/:id/setup

SessionSetupPage
  -> POST /api/sessions/:id/characters/generate
  -> local monster roster state
  -> POST /api/sessions/:id/monsters (on combat start)
  -> POST /api/sessions/:id/combat/start
  -> /session/:id

SessionPage
  -> existing combat bootstrap/hydration
  -> TacticalLayout
```

---

## Important Shortcuts Still In This Implementation

These are the main reasons this is a bridge, not final architecture.

0. Movement is not actually player-drivable from the current tactical UI.
  - The client renders movement remaining and listens for `Move` SSE events
  - The grid canvas reports empty-cell taps
  - But `TacticalLayout` currently uses empty-cell taps only to cancel attack mode
  - There is no path preview request, no move confirmation flow, and no `submitAction("move to X,Y")` wiring yet
  - So movement display/state sync works, but movement input does not

1. Combat HP values are hardcoded in setup.
   - Characters are started with `42/42`
   - Spawned monsters are started with `7/7`
   - This matches the solo-fighter happy path well enough to load combat, but it is not derived from the generated character sheet or the chosen monster stat block.

2. Scenario templates are only partially faithful to player-cli scenarios.
   - `party-fighter-cleric` currently seeds only the fighter character, not the cleric ally
   - Monster templates are simplified, hand-authored stat blocks

3. Initiative currently appears as placeholder `0` values in the rendered tracker for this quick-start path.
   - Tactical combat loads, but this setup path is not yet mirroring the full tabletop initiative entry/roll UX the CLI demonstrates

4. Setup does not read scenario JSON files directly.
   - The page mirrors a few scenario presets in frontend code
   - There is no shared scenario-loading layer between player-cli and web-client yet

5. `setMode` is imported in `SessionSetupPage` but not used.
   - Safe to remove in cleanup unless the page later needs to force a mode before navigation

---

## Recommended Next Work

### First priority

Replace hardcoded combatant HP with values derived from actual created entities.

- For characters:
  - use the generated character payload or a follow-up fetch to determine real HP
- For monsters:
  - use the exact `maxHp` associated with the stat block used for creation

### Second priority

Move quick-start templates out of ad hoc frontend constants.

- Best long-term direction:
  - expose backend scenario/bootstrap endpoints or a shared package for presets
  - keep player-cli and web-client driven by the same seed data

### Third priority

Make quick-start combat follow the same initiative and roll flow expected by the tabletop UX.

- Right now the tactical screen appears, but the numbers shown in initiative are not credible
- This likely needs either:
  - server-side combat start with meaningful initiative assignment, or
  - a real initiative-request step before entering the tactical shell

### Fourth priority

Wire actual movement input into the tactical grid.

- `GridCanvas` already exposes `onCellTap(x, y)`
- `TacticalLayout` currently ignores those coordinates beyond cancelling attack mode
- `use-game-server.ts` has the `PathPreviewResponse` type imported, but no request method yet
- The missing pieces are:
  - path-preview API client
  - local preview/highlight state
  - move confirmation UX
  - action submission for the selected destination

---

## Suggested Cleanup Before Commit

- Remove unused `setMode` from `SessionSetupPage`
- Consider replacing `as any` on `startCombat` payload with a concrete client type
- Re-check whether the `Spells` button should remain enabled if no spell panel is implemented yet

---

## If You Pick This Up Next

Recommended sequence:

1. Wire actual movement input into the tactical grid:
  - request path preview
  - show reachable path/cell feedback
  - confirm move destination
  - submit the move action from the UI
2. Make setup derive real combatant HP and initiative data
3. Test all three quick-start presets, not just solo fighter
4. Decide whether presets stay frontend-local or move behind a server/bootstrap contract
5. Then continue with the remaining planned tactical UX work:
  - dice roll input UI
  - spells panel

---

## Quick Summary

The critical blocker is gone: the player can now create a session and reach the tactical combat screen from the web client without external CLI setup. The bridge works, but it currently relies on setup-time shortcuts that should be normalized before treating quick-start scenarios as production-ready.