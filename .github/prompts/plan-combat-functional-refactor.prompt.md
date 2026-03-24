# Plan: §4.2 Combat Class Stateful in Domain Layer
## Round: 1
## Status: APPROVED
## Affected Flows: CombatRules

---

## Objective

Assess whether the `Combat` class in `domain/combat/combat.ts` should be refactored to pure
functions operating on a state record. Based on assessment, defer the full refactor but implement
safe incremental wins that fix existing `(combat as any)` reflection hacks in `combat-hydration.ts`.

---

## Assessment Summary

### Scale
- `Combat` class: **255 lines**, 5 private `Map` fields + `CombatState` record
- Methods: Initiative setup, action economy (delegate to pure functions), turn management, effects,
  position/movement state

### Production usage
- **Only 1 production consumer**: `application/services/combat/helpers/combat-hydration.ts`
  - `hydrateCombat()` creates a domain `Combat` (which rolls fresh initiative), then **immediately
    overwrites** the internal state via `(combat as any).state = state` (reflection hack #1)
  - Then patches individual action economies via `(combat as any).combatants` (reflection hack #2)
- **Test consumers**: `combat.test.ts`, `creature-abilities.test.ts`, `action-economy.test.ts`

### Full functional refactor verdict: **DEFERRED**
- The `Combat` class already works correctly; all 600+ tests pass
- The refactor (class → pure functions) would require changes in 6+ files with zero behavior change
- The hydration layer already does the serialize/deserialize round-trip — `Combat` is treated as a
  transient, request-scoped value, not a long-lived mutable object
- **Benefit: none that justifies the regression risk**

### Safe incremental wins: **IMPLEMENT**
Two public methods should be added to `Combat` to eliminate the `(combat as any)` reflection hacks:

1. `restoreState(state: CombatState): void` — allows `hydrateCombat` to override internal state
   without reflection; used to inject DB-restored round/turn/order into the in-memory instance
2. `restoreActionEconomy(creatureId: string, economy: ActionEconomy): void` — allows hydration to
   patch per-creature action economies from persisted DB values

---

## Changes

### CombatRules Flow

#### File: `packages/game-server/src/domain/combat/combat.ts`
- [x] Add `public restoreState(state: CombatState): void` method
- [x] Add `public restoreActionEconomy(creatureId: string, economy: ActionEconomy): void` method

#### File: `packages/game-server/src/application/services/combat/helpers/combat-hydration.ts`
- [x] Replace `(combat as any).state = state` with `combat.restoreState(state)`
- [x] Replace `(combat as any).combatants` reflection loop with `combat.restoreActionEconomy()` calls

---

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? → No; adding public methods is additive
- [x] Does the pending action state machine still have valid transitions? → Unaffected
- [x] Is action economy preserved? → Yes; we're only changing the internal setter path, not logic
- [x] Do both player AND AI paths handle the change? → Only combat-service touches `hydrateCombat`
- [x] Are repo interfaces updated? → No entity shape changes
- [x] Is `app.ts` registration updated? → No executor changes
- [x] Are D&D 5e 2024 rules correct? → Rules logic untouched

---

## Risks
- **Low**: Adding 2 public methods to a domain class. Tests cover existing behavior.
- The `restoreState` method exposes internal state manipulation — acceptable because it is a named,
  explicit setter used only during hydration, not general mutation.

---

## Test Plan
- [x] Existing `combat.test.ts` tests continue to pass (no behavior changes)
- [x] `creature-abilities.test.ts` and `action-economy.test.ts` unaffected
- [x] `creature-hydration.test.ts` continues to pass (uses `hydrateCombat`)
- [x] Full E2E: `test:e2e:combat:mock` passes

---

## Decision Record
- **Full functional refactor (class → pure functions)**: **DEFERRED** — high regression risk for
  zero behavior benefit. Mark §4.2 as DEFERRED in remaining-tech-debt plan.
- **Reflection hack fix (restoreState / restoreActionEconomy)**: **IMPLEMENTED** — eliminates
  `(combat as any)` in `combat-hydration.ts`, making the hydration contract explicit and typed.
