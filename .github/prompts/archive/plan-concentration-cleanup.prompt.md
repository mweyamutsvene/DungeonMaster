# Plan: Concentration Save Cleanup — Phase 7.3

## Overview

Concentration saves on damage are **already fully implemented** in two parallel code paths.
The issue is inconsistency between the two paths. This plan unifies them.

## Current State

### Two Incompatible Implementations

| Code Path | Tracking Field | Shape | Domain Function | Events |
|-----------|---------------|-------|:---------------:|:------:|
| ActionService (programmatic) | `resources.concentration` | `{ activeSpellId: string \| null }` | Yes (`concentrationCheckOnDamage()`) | Yes |
| RollStateMachine (tabletop) | `resources.concentrationSpellName` | `string \| undefined` | **No** — inline reimplementation | **No** |
| SpellActionHandler (stores) | `resources.concentrationSpellName` | `string` | N/A | N/A |

### Problems
1. Domain function `concentrationCheckOnDamage()` not used by the tabletop flow
2. Different resource field names (`concentration` vs `concentrationSpellName`)
3. Tabletop path doesn't emit `ConcentrationBroken`/`ConcentrationMaintained` events
4. No concentration-broken-by-condition (e.g., Incapacitated) support

## Items

| # | Feature | Complexity |
|---|---------|-----------|
| 1 | Unify tracking to `concentrationSpellName` (what SpellActionHandler uses) | Small |
| 2 | RollStateMachine → call domain `concentrationCheckOnDamage()` instead of inline math | Small |
| 3 | Emit concentration events from tabletop path | Small |
| 4 | E2E scenario: concentration broken by damage | Small |
| 5 | Concentration broken by Incapacitated/Stunned/Unconscious condition | Medium |

## Implementation

### Step 1: Unify Tracking Field
- Update `ActionService` to use `concentrationSpellName` (drop the `ConcentrationState` object)
- Or wrap both in a thin adapter — either way, one canonical field name

### Step 2: Domain Function in Tabletop Path
Replace inline code in `roll-state-machine.ts` L1074-1090:
```typescript
// Current: inline d20 + conMod + profBonus vs DC
// Replace with: concentrationCheckOnDamage(this.deps.diceRoller, damage, conMod, 'auto')
```

### Step 3: Events
Add event emission after concentration check in RollStateMachine to match ActionService behavior.

### Step 4: E2E Scenario
`core/concentration-damage-break.json` — Wizard concentrating on Hold Person, takes damage, fails CON save → concentration broken.

### Step 5: Condition-Based Breaks (Optional)
When Stunned/Unconscious/Incapacitated is applied, check and break concentration.

## Complexity

Small — mostly refactoring inline code to use existing domain function. No new mechanics.

---

## Completion Notes (Phase 7.3 — DONE)

**Status**: ✅ All 5 items implemented + 2 bonus fixes discovered during implementation.

### What Was Done

1. **Unified tracking to `concentrationSpellName`** — ActionService now reads/writes `resources.concentrationSpellName` (string) instead of the old `resources.concentration` (object with `activeSpellId`). The old object-based pattern was dead code since SpellActionHandler never wrote that shape.

2. **Created shared `concentration-helper.ts`** — New application-layer helper at `application/services/combat/helpers/concentration-helper.ts` with:
   - `getConcentrationSpellName(resources)` — safe read from untyped JSON
   - `breakConcentration(combatant, encounterId, combatRepo, debugLog?)` — full cleanup: removes field, cleans up `duration: 'concentration'` ActiveEffects from all combatants, removes concentration zones from map
   - `computeConSaveModifier(conScore, profBonus, saveProficiencies)` — consistent CON save modifier calculation
   - `isConcentrationBreakingCondition(condition)` — checks against `Incapacitated|Paralyzed|Petrified|Stunned|Unconscious`

3. **RollStateMachine now uses shared helper** — Replaced ~60 lines of inline concentration break logic with ~15 lines using `breakConcentration()` + `emitConcentrationEvent()`. Removed unused imports (`removeConcentrationEffectsFromResources`, `removeConcentrationZones`, `getMapZones`, `setMapZones`, `CombatMap`).

4. **Events emitted from tabletop path** — Added `emitConcentrationEvent()` to `TabletopEventEmitter` that emits both a typed event (`ConcentrationBroken`/`ConcentrationMaintained`) and a `NarrativeText` event with human-readable text.

5. **E2E scenario created** — `core/concentration-damage-break.json`: Wizard (CON 10, 14 HP) casts Bless, takes damage from Ogre. Runner asserts `characterConcentration: "Bless"` after casting.

6. **Condition-based concentration breaks** — Added checks in:
   - `SavingThrowResolver`: After applying conditions (e.g., Stunned from Stunning Strike), checks `isConcentrationBreakingCondition()` and breaks concentration
   - `SpellActionHandler`: After applying conditions from save-or-suck spells
   - `RollStateMachine`: On KO (hpAfter === 0), auto-breaks concentration

7. **KO auto-breaks concentration (BONUS FIX)** — Previously when `hpAfter === 0`, the `hpAfter > 0` guard skipped the concentration check entirely. Now the code explicitly auto-breaks concentration on KO without requiring a save (Unconscious → Incapacitated → concentration ends per D&D 5e 2024 rules).

8. **SpellActionHandler replacement cleanup (BONUS FIX)** — When casting a new concentration spell while already concentrating, now calls `breakConcentration()` to clean up old effects/zones before setting the new spell name. Previously it only overwrote the name.

### Files Created
- `packages/game-server/src/application/services/combat/helpers/concentration-helper.ts`
- `packages/game-server/scripts/test-harness/scenarios/core/concentration-damage-break.json`

### Files Modified
- `packages/game-server/src/application/services/combat/action-service.ts`
- `packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts`
- `packages/game-server/src/application/services/combat/tabletop/tabletop-event-emitter.ts`
- `packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts`
- `packages/game-server/src/application/services/combat/tabletop/saving-throw-resolver.ts`
- `packages/game-server/scripts/test-harness/scenario-runner.ts`

### Test Results
- **Typecheck**: 0 errors
- **Unit tests**: 458 passed, 0 failures
- **E2E tests**: 115 passed, 0 failures (including the new `concentration-damage-break` scenario)

### Assumptions
- `domain/rules/concentration.ts` was left unchanged — it's still used by `spell-resolver.ts` and its own unit test. The domain function `concentrationCheckOnDamage()` is still used by ActionService; the tabletop path uses `computeConSaveModifier()` since it needs more control over the roll flow.
- The `CONCENTRATION_BREAKING_CONDITIONS` set (`Incapacitated|Paralyzed|Petrified|Stunned|Unconscious`) follows D&D 5e 2024 rules where all these conditions include or are Incapacitated, which ends concentration.

### Open Questions / Follow-ups
- The `ConcentrationState` type and related functions in `domain/rules/concentration.ts` could be deprecated in a future cleanup pass, since the canonical tracking is now just a string field. However, `spell-resolver.ts` still uses `concentrationCheckOnDamage()` which depends on `ConcentrationState`, so this would be a larger refactor.
