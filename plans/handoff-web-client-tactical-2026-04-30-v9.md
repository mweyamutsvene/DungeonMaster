# Web Client Tactical UX — Handoff v9
**Date:** 2026-04-30  
**Branch:** master  
**Commit:** a9a1ce5  
**Status:** ACTIVE

---

## Session Summary

Completed two features from the v8 backlog:
1. **Initiative roll flow** — DiceRollModal appears when combat first starts
2. **Movement cost overlay** — banner shows path cost + remaining feet during path preview

Both verified in browser. Committed.

---

## Initiative Roll Flow Architecture

### Before (old `combat/start`)
```
SessionSetupPage → gameServer.startCombat() → encounter Active immediately
                                             → no initiative roll
                                             → navigate to session page
```

### After (new `combat/initiate`)
```
SessionSetupPage
  → gameServer.initiateCombat({ text: "start combat", actorId: characterId })
  → Server: creates Pending encounter, queues InitiativeHandler, returns {requiresPlayerInput, rollType: "initiative"}
  → setPendingRoll({ rollType: "initiative", diceNeeded: "d20", ... })
  → navigate to /session/:id
      → SessionPage renders DiceRollModal (always rendered, regardless of mode)
      → getCombatState throws 400 (Pending, no combatants) → setMode("theatre") [expected, ok]
  → DiceRollModal visible with ⚡ Roll Initiative header
  → Player clicks "🎲 Roll d20"
  → gameServer.submitRoll → InitiativeHandler runs
      → adds all combatants from DB, starts Active encounter
      → returns { combatStarted: true, encounterId, turnOrder }
  → handleRollResponse detects combatStarted: true
      → set({ pendingRoll: null, encounterId, mode: "tactical", tacticalVersion: +1 })
  → SessionPage useEffect fires (tacticalVersion changed), calls getCombatState()
      → succeeds this time (encounter is Active, combatants exist)
      → hydrateCombat → TacticalLayout renders with full state
```

### Key Files Modified
| File | Change |
|------|--------|
| `src/types/api.ts` | Added `combatStarted?`, `encounterId?`, `turnOrder?` to `ActionResponse` |
| `src/hooks/use-game-server.ts` | Added `initiateCombat(sessionId, body)` method |
| `src/store/app-store.ts` | `handleRollResponse` handles `combatStarted: true` → sets mode + bumps `tacticalVersion` |
| `src/pages/SessionSetupPage.tsx` | Uses `initiateCombat` instead of `startCombat`; sets `pendingRoll` before navigate |
| `src/tactical/TacticalLayout.tsx` | Movement cost overlay in hint banner |

### intendedTargets Note
`initiateCombat("start combat", actorId)` → text has no monster names → `intendedTargets = []`.  
`InitiativeHandler.process` uses `allMonsterIds = monsters.map(m => m.id)` as fallback — all session monsters are included.

### 400 errors during startup are expected
`getCombatState` for a Pending encounter (no combatants) throws 400. SessionPage catches it and sets `mode("theatre")`. The `DiceRollModal` renders regardless of mode, so the roll still shows. This is correct behavior.

---

## Movement Cost Overlay

When a path preview is active:
- Banner shows: `Path: Xft · Y ft remaining`
- "X ft remaining" = `movementBudget - pathPreview.totalCostFeet`
- When blocked: red "Path blocked" text
- Default (no preview): generic "Tap destination to preview, tap again to move"

Located in `TacticalLayout.tsx` lines ~275-290.

---

## Browser Verification Results

| Step | Result |
|------|--------|
| Create session → navigate to setup page | ✅ |
| Click "Solo Fighter vs Goblins" template | ✅ Thorin + 2 Goblins added |
| Click "Start Combat" | ✅ |
| DiceRollModal shows with ⚡ Roll Initiative | ✅ |
| Click "🎲 Roll d20" | ✅ |
| Tactical view loads: Thorin (20), Goblin (13), Goblin (4) | ✅ |
| Click Thorin → click destination → "Path: 20ft · 10ft remaining" | ✅ |
| Path tiles highlighted on grid | ✅ |

---

## Current State of Features

### Implemented (confirmed working)
- ✅ Tactical grid with isometric rendering
- ✅ Initiative roll flow (DiceRollModal on first combat start)
- ✅ Turn order strip with initiative values
- ✅ HP bar in PartyStatusBar
- ✅ Action economy pips (ACTION, BONUS, REACT)
- ✅ Movement budget bar (30ft)
- ✅ Path preview with cost overlay
- ✅ Path highlighting on canvas (tiles turn teal)
- ✅ Move execution (confirm second click)
- ✅ Opportunity attack reactions (auto-handled for AI monsters)
- ✅ Attack flow: click Attack → click enemy token → server requests roll → DiceRollModal → damage roll
- ✅ Spell flow: Spells button → spell list → pendingSpellName → click enemy token → cast
- ✅ End Turn button
- ✅ Combat log drawer

### Not Yet Implemented
- ❌ Extra attack chaining (Fighter L5 / Paladin Extra Attack) — second attack doesn't chain automatically
- ❌ Spell targeting visual (highlight valid targets when `pendingSpellName` is set)
- ❌ Reaction prompt in browser (Shield, Counterspell, OA on player movement) — needs server-side reaction flow
- ❌ Character sheet modal (opens but may have render issues — not tested this session)

---

## Next Priorities

1. **Spell targeting visual** — pure client change, high impact UX
   - When `pendingSpellName` is set, iterate `combatants` and draw a highlight ring on enemy tokens on canvas
   - Hint banner: "Select target for {spellName}"
   
2. **Extra attack chaining** — complex, server-dependent
   - Server returns `{ requiresPlayerInput: true, rollType: "attack" }` after first attack if Extra Attack available
   - Client needs to chain the second roll automatically, or prompt user again
   
3. **Reaction prompt** — medium complexity
   - Server pauses on `REACTION_CHECK` (already handled for OAs)
   - Need UI to let player choose Shield / Counterspell manually (currently auto-skipped)

---

## Architecture Reference

```
SessionSetupPage → initiateCombat → pendingRoll → navigate
SessionPage:
  - DiceRollModal (always rendered) → submitRoll → handleRollResponse
  - getCombatState → hydrateCombat → TacticalLayout
  - SSE stream: CombatStarted, TurnAdvanced, DamageApplied, AttackResolved, etc.

app-store.ts (Zustand):
  - pendingRoll → triggers DiceRollModal
  - encounterId, mode ("theatre" | "tactical")
  - tacticalVersion → SessionPage re-fetches on bump
  - myCharacterId, activeCombatantId, myTurn
  - combatants[], movementBudget

TacticalLayout.tsx:
  - selectedMoverId → move mode
  - pathPreview → banner overlay + canvas tiles
  - attackMode → click enemy to attack
  - pendingSpellName → click enemy to cast
```
