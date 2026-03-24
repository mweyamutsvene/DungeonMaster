# Plan: Combat Edge Cases — Filling Non-Solid Gaps (Phase 7.1)

## Overview

After completing all 8 weapon mastery properties and reviewing the 83 E2E scenarios, several
standard D&D 5e 2024 combat mechanics are either implemented but untested, or partially implemented.
This plan addresses the "non-solid" items from the coverage audit.

## Scope

### Code Changes Required (1 item)

| # | Feature | Gap | Fix |
|---|---------|-----|-----|
| 1 | Hidden broken on attack | `breaksHidden("attack")` domain function exists but is never called after attack resolution | Strip Hidden from attacker after `handleAttackRoll()` resolves |

### E2E-Only Scenarios (code exists, just needs tests)

| # | Feature | Code Location | Scenario |
|---|---------|--------------|----------|
| 2 | Ranged attack in melee → disadvantage | `action-dispatcher.ts` L1638-1651 | `core/ranged-in-melee.json` |
| 3 | Long range → disadvantage | `action-dispatcher.ts` L1634-1637 | `core/long-range-disadvantage.json` |
| 4 | Dash → 2× movement budget | `movement.ts` L61, `two-phase-action-service.ts` L130 | `core/dash-movement.json` |
| 5 | Disengage → OA suppressed | `opportunity-attack.ts` L57-59 | `core/disengage-oa-suppression.json` |
| 6 | Death save: Nat 20 → 1 HP revival | `death-saves.ts` L30-32, `roll-state-machine.ts` L1273-1280 | `core/death-save-nat20.json` |
| 7 | Death save: Nat 1 → 2 failures | `death-saves.ts` L35-40 | `core/death-save-nat1.json` |
| 8 | Death save: 3 failures → dead | `death-saves.ts` L37 | `core/death-save-failure.json` |
| 9 | Concentration replacement | `spell-action-handler.ts` L119-127 | `core/concentration-replacement.json` |
| 10 | Healing at 0 HP → revival | `spell-action-handler.ts` L466-480 | `core/heal-unconscious.json` |
| 11 | Hidden broken on attack | After code fix | `core/hidden-breaks-on-attack.json` |

### Deferred (out of scope) — NOW RESOLVED

All previously-deferred items now have passing E2E scenarios:

| Feature | Scenario | Status |
|---------|----------|--------|
| TWF non-Light weapon rejection | `core/twf-light-required.json` | ✅ Passing |
| Thrown weapons | `core/thrown-weapon.json` | ✅ Passing |
| Cover mechanics | `core/cover-ac-bonus.json` | ✅ Passing |
| Surprise rounds | `core/surprise-ambush.json` | ✅ Passing |
| Heavy weapon + Small creature | `core/heavy-weapon-small-creature.json` | ✅ Passing |
| Versatile weapon 1h/2h | `core/versatile-weapon.json` | ✅ Passing |
| Loading property | `core/loading-weapon.json` | ✅ Passing |

## Implementation Order

1. **Code change**: Hidden breaks on attack (roll-state-machine.ts)
2. **E2E scenarios** (create all 10 test scenarios)
3. **Run all tests** to verify

## Complexity

Low-Medium — mostly writing E2E scenario JSON files for existing code. One small code change.

---

## Implementation Notes (Completed)

**Date**: Phase 7.1 complete  
**Final test results**: 92 E2E passed (was 83), 458 unit tests passed, typecheck clean

### Code Change
- **Hidden broken on attack**: Added ~15 lines in `roll-state-machine.ts` (after the StunningStrikePartial block, before hit/miss branching). Queries the actor's conditions, checks for "Hidden", and strips it via `removeCondition()`. Works for all attack types (melee, ranged, spell attacks).

### E2E Scenarios Created (9 of 10)
| Scenario | Steps | Notes |
|----------|-------|-------|
| `core/ranged-in-melee.json` | 8/8 | Archer with hostile within 5ft → disadvantage on ranged attack |
| `core/long-range-disadvantage.json` | 8/8 | Longbow at 200ft (beyond 150ft normal range) → disadvantage |
| `core/dash-movement.json` | 7/7 | Dash + move 55ft within doubled 60ft budget → position verified |
| `core/disengage-oa-suppression.json` | 7/7 | Disengage + retreat past hostile → full HP (no OA triggered) |
| `core/death-save-nat20.json` | 7/7 | Nat 20 → revived with 1HP, deathSaves reset to {0,0} |
| `core/death-save-nat1.json` | 8/8 | Nat 1 → 2 failures; subsequent success → {1,2} |
| `core/death-save-failure.json` | 10/10 | 3 sequential failures → dead |
| `core/concentration-replacement.json` | 14/14 | Bless (concentration) → Hold Person replaces it → Fire Bolt no effect |
| `core/hidden-breaks-on-attack.json` | 10/10 | Hide → assert Hidden → attack → assert NOT Hidden |

### Deferred Scenario — NOW RESOLVED
- **heal-unconscious**: ~~Cannot test with single-PC scenario runner.~~ Now tested with multi-PC scenario runner. Two scenarios exist:
  - `core/heal-unconscious.json` — Single-PC style heal test (death save → healing)
  - `core/heal-unconscious-ally.json` — Multi-PC: Goblin KOs Fighter → Cleric casts Cure Wounds → revival (10/10 steps)
  
  **Key fix**: AI two-phase attack flow was NOT applying Unconscious+Prone conditions when KO'ing a character. Fixed by extracting KO handling into shared `ko-handler.ts` utility (used across 7+ damage paths: roll-state-machine, ai-action-executor, two-phase-action-service, spell-action-handler, action-service).

### Multi-PC Scenarios Added
- `core/heal-unconscious-ally.json` — 2 PCs (Fighter + Cleric) vs Goblin Brute (10/10 steps)
- `core/multi-pc-coordinated-attack.json` — 2 Fighters vs Goblin Warrior (14/14 steps)

### Assumptions
- Ranged-in-melee disadvantage uses Shortbow (normal 80ft) with hostile at 5ft — verified against `action-dispatcher.ts` proximity check
- Long range disadvantage uses Longbow (150/600) at 200ft — verified against `action-dispatcher.ts` range check
- Death save scenarios all start by KO'ing the PC with a scripted monster attack (20 to hit, damage ≥ max HP)
- Concentration replacement tested with Bless→Hold Person (both concentration) plus Fire Bolt (cantrip, non-concentration)
