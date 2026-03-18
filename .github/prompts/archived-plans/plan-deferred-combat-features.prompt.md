# Plan: Deferred Combat Features — Phase 7.2

## Overview

Implementing all deferred items from Phase 7.1's gap analysis, plus Ready action and Search action
identified in the original combat coverage audit. Ordered from quickest wins to largest features.

## Items (10 total)

### Tier 1 — Small (wiring existing code)

| # | Feature | Complexity | Description |
|---|---------|-----------|-------------|
| 1 | TWF non-Light weapon rejection | Small | Wire `canMakeOffHandAttack()` into `OffhandAttackExecutor` + action-dispatcher |
| 2 | Heavy weapon + Small creature | Small | Add disadvantage when Small/Tiny creature uses Heavy weapon |

### Tier 2 — Small-Medium (domain exists, needs app wiring)

| # | Feature | Complexity | Description |
|---|---------|-----------|-------------|
| 3 | Search action | Small-Med | Wire `attemptSearch()` into text parser + action-dispatcher + AI executor |

### Tier 3 — Medium (domain exists or partial, needs significant wiring)

| # | Feature | Complexity | Description |
|---|---------|-----------|-------------|
| 4 | Cover AC bonus | Medium | Wire `getCoverLevel()` into attack resolution, add AC bonus |
| 5 | Heal-unconscious E2E | Medium | Add NPC programmatic action step type to scenario runner |
| 6 | Versatile weapon 1h/2h | Medium | Add versatile damage alt, hand tracking, text parser |
| 7 | Loading property | Medium | Per-attack-action tracking, prevent multiple Loading fires |

### Tier 4 — Medium-Large to Large

| # | Feature | Complexity | Description |
|---|---------|-----------|-------------|
| 8 | Thrown weapons | Med-Large | New combat path: melee weapon used at range |
| 9 | Surprise | Large | New mechanic: surprised condition, initiative disadvantage |
| 10 | Ready action | Large | New subsystem: readied action + trigger + held spell concentration |

## Implementation Status

- [x] #1 TWF non-Light rejection
- [x] #2 Heavy + Small creature
- [x] #3 Search action
- [x] #4 Cover AC bonus
- [x] #5 Heal-unconscious E2E
- [x] #6 Versatile 1h/2h
- [x] #7 Loading property
- [x] #8 Thrown weapons
- [x] #9 Surprise
- [x] #10 Ready action (Phase 6.1a — non-spell)

## Completion Notes

### Session Summary (all 10 items DONE)

**#1-#5**: Completed in prior session. All E2E scenarios pass.

**#6 Versatile 1h/2h**: Fixed regex for "one-handed"/"two-handed" matching (`(?:ed)?` suffix). Fixed `monsterHp` format in scenario (flat `{name,min,max}`, NOT nested array). Scenario: `core/versatile-weapon.json` (12/12).

**#7 Loading property**: Added `loadingWeaponFiredThisTurn` resource flag. Check in `action-dispatcher.ts` after weapon spec built. Flag set in `roll-state-machine.ts` after miss and damage paths. Scenario: `core/loading-weapon.json` (9/9).

**#8 Thrown weapons**: Added `isThrownAttack` detection in `action-dispatcher.ts` with `parseThrownRange()` helper. Updated mock LLM with throw regex. Handles explicit throw (text keywords) + auto-throw (melee weapon out of reach with Thrown property). Scenario: `core/thrown-weapon.json` (8/8).

**#9 Surprise**: D&D 5e 2024 surprise = disadvantage on initiative rolls. Added `surprise?: "enemies" | "party"` to `InitiatePendingAction`, route, and service. Monster/NPC initiative now uses `diceRoller.d20().total` instead of flat `10 + dexMod`. When surprised, rolls 2d20 takes lowest. Updated scenario runner `initiate` step to pass `surprise` in payload. Scenario: `core/surprise-ambush.json` (8/8).

**#10 Ready action (Phase 6.1a)**: 
- **Text parser**: `tryParseReadyText()` in `combat-text-parser.ts` — extracts response type, trigger type, target name
- **Dispatcher**: `handleReadyAction()` in `action-dispatcher.ts` — spends action, stores `readiedAction` in combatant resources
- **Resource management**: `readiedAction: undefined` in `resetTurnResources()` — clears at start of next turn
- **Trigger detection**: Added to `initiateMove()` in `two-phase-action-service.ts` — detects when moving creature enters reach of combatant with readied attack, adds `readied_action` reaction opportunity
- **Reaction execution**: Updated `completeMove()` to handle `readied_action` alongside `opportunity_attack`, clears `readiedAction` from resources on use
- **Domain types**: Added `"readied_action"` to `ReactionType` in `pending-action.ts`
- Scenario: `core/ready-action-attack.json` (8/8)
- **Phase 6.1b (spell readying)**: NOT yet implemented — deferred to `plan-ready-action.prompt.md`

### Regression Results
- **E2E**: 98/102 passed, 4 pre-existing failures (Cleric Turn Undead, Heal-Unconscious nat-20, Multi-Action Combat out-of-reach, Monk Stunning Strike condition expiry)
- **Unit tests**: 458/458 passed, 0 failures
- **Typecheck**: Clean

### Files Changed (this session, #6-#10)
- `action-dispatcher.ts` — versatile regex, loading check, thrown detection, ready handler
- `roll-state-machine.ts` — loading flag (miss/damage), surprise initiative d20 rolls
- `combat-text-parser.ts` — ready to simple action parser, `tryParseReadyText()`
- `resource-utils.ts` — `loadingWeaponFiredThisTurn`, `readiedAction` reset
- `tabletop-types.ts` — `surprise` on InitiatePendingAction
- `tabletop-combat-service.ts` — surprise parameter passthrough
- `session-tabletop.ts` — surprise body param in initiate route
- `scenario-runner.ts` — surprise in InitiateAction input, payload passthrough
- `two-phase-action-service.ts` — readied action trigger detection in initiateMove(), execution in completeMove()
- `pending-action.ts` — `readied_action` ReactionType
- `mocks/index.ts` — throw regex for mock LLM

### New E2E Scenarios
- `core/versatile-weapon.json` — 12 steps
- `core/loading-weapon.json` — 9 steps
- `core/thrown-weapon.json` — 8 steps
- `core/surprise-ambush.json` — 8 steps
- `core/ready-action-attack.json` — 8 steps
