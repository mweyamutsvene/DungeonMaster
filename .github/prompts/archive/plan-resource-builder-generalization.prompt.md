# Plan: CombatResourceBuilder Monk Special Case Generalization
## Round: 1
## Status: APPROVED
## Affected Flows: ClassAbilities

## Objective
Remove the Monk-specific hardcoding in `buildCombatResources()` by extending `resourcesAtLevel` to accept an `abilityModifiers` parameter (matching the existing `resourcePoolFactory` convention). This allows any class to declare ability-score-derived resource pools without special-casing in the builder.

## Current State
- `resourcesAtLevel` signature: `(level: number) => readonly ResourcePool[]` — no ability score context
- `buildCombatResources()` has `if (classId === "monk")` that imports and calls `getMonkResourcePools(level, wisdomScore)` directly
- `resourcePoolFactory` already has the generic pattern: `(level: number, abilityModifiers?: Record<string, number>) => readonly ResourcePool[]`
- Bard's `resourcePoolFactory` already uses `abilityModifiers?.["charisma"]` — proven pattern

## Changes
### ClassAbilities Flow

#### [File: domain/entities/classes/class-definition.ts]
- [x] Change `resourcesAtLevel` signature from `(level: number) => readonly ResourcePool[]` to `(level: number, abilityModifiers?: Record<string, number>) => readonly ResourcePool[]`
- [x] Update JSDoc to document abilityModifiers convention (matches resourcePoolFactory)

#### [File: domain/entities/classes/monk.ts]
- [x] Change `wholenessOfBodyUsesForLevel(level, wisdomScore)` to `wholenessOfBodyUsesForLevel(level, wisdomModifier)` — accept modifier (not score), simplify internal logic
- [x] Change `getMonkResourcePools(level, wisdomScore)` to `getMonkResourcePools(level, wisdomModifier)` — accept modifier
- [x] Update Monk `resourcesAtLevel` to extract `abilityModifiers?.wisdom ?? 0` and pass to `getMonkResourcePools`

#### [File: domain/entities/classes/combat-resource-builder.ts]
- [x] Remove `import { getMonkResourcePools } from "./monk.js"`
- [x] Remove the `if (classId === "monk") { ... }` special case
- [x] Add generic abilityModifiers computation from sheet.abilityScores once
- [x] Pass abilityModifiers to `classDef.resourcesAtLevel?.(level, abilityModifiers)` for ALL classes

#### [File: domain/entities/classes/combat-resource-builder.test.ts]
- [x] Update `wholenessOfBodyUsesForLevel` tests: pass modifiers instead of scores (0 instead of 10, 3 instead of 16, -1 instead of 8)
- [x] Update `getMonkResourcePools` tests: pass wisdom modifier instead of score (2 instead of 14)
- [x] Existing `buildCombatResources` tests should pass unchanged (behavior is identical)

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? **No** — only ClassAbilities affected
- [x] Does the pending action state machine still have valid transitions? **N/A** — resource initialization only
- [x] Is action economy preserved? **N/A** — resource pools, not action economy
- [x] Do both player AND AI paths handle the change? **Yes** — `buildCombatResources` serves both
- [x] Are repo interfaces + memory-repos updated if entity shapes change? **No shape changes**
- [x] Is `app.ts` registration updated if adding executors? **N/A** — no new executors
- [x] Are D&D 5e 2024 rules correct (not 2014)? **Yes** — Wholeness of Body uses = WIS modifier (min 1)

## Risks
- **Near zero**. Signature extension is backward-compatible (optional parameter). All other classes' `(level) => ...` lambdas still valid.
- The Monk-specific `getMonkResourcePools` and `wholenessOfBodyUsesForLevel` signatures change from score→modifier, but they're only called internally and in tests.

## Test Plan
- [x] Existing unit tests for `wholenessOfBodyUsesForLevel`, `getMonkResourcePools` updated to pass modifiers (same expected values)
- [x] Existing `buildCombatResources` tests pass with zero changes (identical external behavior)
- [x] Typecheck clean (pre-existing error in test-seed.ts only)
- [x] E2E combat scenarios pass — 153/153 passed, 0 failed

## SME Approval
- [ ] ClassAbilities-SME
