# Plan: Deferred Low-Priority Items

## Status: BACKLOG
## Date: 2026-03-24
## Source: Deferred items from archived `plan-remaining-tech-debt.prompt.md`
## Baseline: 662 unit tests, 155/155 E2E, typecheck clean

---

## Overview

Two items assessed and deferred during the March 2026 tech debt cleanup. Both were found to be low-value at current codebase size. Pick them up when working in the relevant area or when a concrete use-case justifies the work.

---

## 4.1 `movement.ts` Mixes Movement + Jump

- **Priority**: LOW
- **File**: `domain/rules/movement.ts`
- **Assessment**: Assessed at 324 lines. Jump functions (`calculateLongJumpDistance`, `calculateHighJumpDistance`, `computeJumpLandingPosition`, `JumpParams`, `JumpResult`) and constants (`MOVEMENT_MODIFIERS`, `STANDARD_SPEEDS`) have **zero usages** across the codebase — they are dead code. Splitting dead code into a new file provides no benefit. Split is only worthwhile when jump mechanics are wired into actual gameplay and the file grows substantially with new movement types (swim, climb, fly). Decision: **Defer until jump wiring work begins**.
- **Unblocked by**: Adding jump/swim/fly movement to actual gameplay (wiring `computeJumpLandingPosition` to an action handler).
- **Plan**: See `plan-movement-split.prompt.md`
- **Affected flows**: CombatRules

---

## 4.2 `Combat` Class Stateful in Domain Layer

- **Priority**: LOW
- **Issue**: `Combat` class holds mutable state in domain layer. Could be made more functional (pure functions operating on combat state records).
- **Risk**: Large refactor with high regression risk for low benefit. The class works correctly.
- **Assessment**: Assessed at 255 lines. Only 1 production consumer (`combat-hydration.ts`). The class is a transient, request-scoped object (created, used, discarded per API call). A full functional refactor (class → pure functions) would touch 6+ files with zero behavior change. Decision: **Full refactor deferred**.
- **Safe wins already done**: Added `restoreState(state: CombatState)` and `restoreActionEconomy(creatureId, economy)` public methods to eliminate `(combat as any)` reflection hacks in `combat-hydration.ts`.
- **Unblocked by**: A concrete pain point — e.g., needing to serialize/replay combat state for undo, replay, or multiplayer sync.
- **Plan**: See `plan-combat-functional-refactor.prompt.md`
- **Affected flows**: CombatRules
