# Plan: Remaining Technical Debt Backlog

## Status: COMPLETE (ARCHIVED 2026-03-24)
## Date: 2026-03-23
## Completed: 2026-03-24
## Source: Remaining items from archived `plan-deferred-technical-debt.prompt.md`
## Baseline: 596 unit tests, 151/151 E2E, typecheck clean
## Final: 662 unit tests, 155/155 E2E, typecheck clean

---

## Overview

13/15 items completed, 2 deferred. All HIGH and MEDIUM items resolved. Deferred items moved to `plan-deferred-low-priority.prompt.md`.

---

## 1. Rules Correctness

### 1.1 Grapple + Multi-Attack Economy ✅ DONE
- **Priority**: ~~MEDIUM (blocked)~~ COMPLETED
- **File**: `application/services/combat/action-service.ts`
- **Issue**: Grapple uses `spendAction()` which marks the full action as used. D&D 5e 2024: grapple replaces ONE attack within a multi-attack action (e.g., Fighter with Extra Attack can grapple + attack).
- **Resolution**: Replaced `spendAction()` with `useAttack()` for both grapple and shove. Uses `ClassFeatureResolver.getAttacksPerAction()` to set up multi-attack counts. Dynamic `actionComplete` in grapple-handlers based on remaining attacks.
- **Plan**: See `plan-grapple-multi-attack-economy.prompt.md`
- **Affected flows**: CombatRules, CombatOrchestration

---

## 2. Consistency & Pattern Adherence

### 2.1 NPC Entity Info Missing Fields for AI ✅ DONE
- **Priority**: ~~LOW~~ COMPLETED
- **File**: `application/services/combat/ai/ai-context-builder.ts`
- **Issue**: Normalize all entity types to expose `attacks`, `actions`, `bonusActions` for AI context. Currently NPCs may be missing fields that Characters and Monsters expose.
- **Resolution**: Normalized all three entity branches (Monster, NPC, Character) in `buildEntityInfo()` to expose a consistent set of 9 fields: `traits`, `attacks`, `actions`, `bonusActions`, `reactions`, `spells`, `abilities`, `features`, `classAbilities`. Missing fields default to `[]`. Added 3 new unit tests.
- **Plan**: See `plan-npc-ai-fields.prompt.md`
- **Affected flows**: AIBehavior, EntityManagement

### 2.2 Two Parallel Spell Resolution Paths ✅ DONE
- **Priority**: ~~LOW (long-term)~~ COMPLETED
- **Files**: `spell-action-handler.ts` vs `ai-action-executor.ts` vs new `helpers/spell-slot-manager.ts`
- **Issue**: Spells could be resolved through SpellActionHandler (tabletop flow) or directly through AiActionExecutor (AI flow). The two paths had divergent implementations — AI path ignored slot spending and concentration.
- **Resolution**: Extracted shared `helpers/spell-slot-manager.ts` with `findPreparedSpellInSheet` (pure) and `prepareSpellCast` (async). Both paths now spend slots and manage concentration. Full delivery unification deferred — `SpellAttackDeliveryHandler` requires interactive player rolls (returns `requiresPlayerInput: true`), so AI mechanics remain cosmetic.
- **Plan**: See `plan-spell-path-unification.prompt.md`
- **Affected flows**: SpellSystem, AIBehavior

### ~~2.3 SSE Event Type Narrowing~~ ✅ DONE (commit 477f57b)
- **Priority**: LOW
- **File**: `application/repositories/event-repository.ts`
- **Issue**: `IEventRepository.append()` event type stays `string`. Non-combat events (`CharacterAdded`, `RestCompleted`, `SessionCreated`) block type narrowing to a discriminated union.
- **Fix**: Defined 25-event `GameEventInput` discriminated union with typed payload interfaces. All `events.append()` callers updated. `as JsonValue` casts removed.
- **Affected flows**: EntityManagement

---

## 3. Scalability Improvements

### 3.1 CombatResourceBuilder Monk Special Case ✅ DONE
- **Priority**: ~~LOW~~ COMPLETED
- **Issue**: `resourcesAtLevel` had Monk-specific hardcoding for ki points using WIS modifier.
- **Resolution**: Extended `resourcesAtLevel` signature to accept `abilityModifiers?: Record<string, number>` (matching `resourcePoolFactory` convention). Monk's `resourcesAtLevel` now uses `abilityModifiers.wisdom`; builder computes modifiers generically from sheet ability scores. Removed `getMonkResourcePools` import and `if (classId === "monk")` special case from builder. Updated `wholenessOfBodyUsesForLevel` and `getMonkResourcePools` to accept modifiers instead of raw scores.
- **Plan**: See `plan-resource-builder-generalization.prompt.md`
- **Affected flows**: ClassAbilities

### 3.2 Cascade Parser Chain in ActionDispatcher ✅ DONE
- **Priority**: ~~LOW~~ COMPLETED
- **Issue**: ActionDispatcher uses a long if/else chain to parse text into actions.
- **Resolution**: Extracted 19-entry parser chain (`ActionParserEntry<T>` interface in `action-parser-chain.ts`). `dispatch()` iterates the chain in priority order — first match wins. Each entry pairs a pure `tryParse` function with an async `handle` method. Adding a new action type = adding one entry to the array. Boolean parsers wrapped to `true | null` convention. Complex pre-dispatch logic (offhand TWF/Nick, attack target resolution) encapsulated in each entry's `handle` method.
- **Plan**: See `plan-action-parser-registry.prompt.md`
- **Affected flows**: CombatOrchestration

### 3.3 `combat-map.ts` Monolith ✅ DONE
- **Priority**: ~~LOW~~ COMPLETED
- **File**: `domain/rules/combat-map.ts` (540 lines, 35+ exports)
- **Resolution**: Split into 5 focused modules while keeping `combat-map.ts` as a barrel re-export:
  - `combat-map-types.ts` — `TerrainType`, `CoverLevel`, `MapCell`, `MapEntity`, `CombatMap`
  - `combat-map-core.ts` — `createCombatMap`, `getCellAt`, `setTerrainAt`, entity CRUD, passability, terrain speed
  - `combat-map-sight.ts` — `hasLineOfSight`, `getCoverLevel`, `getCoverACBonus`, `getCoverSaveBonus`, radius/faction queries
  - `combat-map-zones.ts` — `getMapZones`, `addZone`, `removeZone`, `updateZone`, `setMapZones`
  - `combat-map-items.ts` — `getGroundItems`, `addGroundItem`, `removeGroundItem`, position queries
  - All existing imports unchanged (barrel re-export from original path). 616 unit tests pass, 153/153 E2E pass.
- **Plan**: See `plan-combat-map-split.prompt.md`
- **Affected flows**: CombatRules

### 3.4 AI Action Extensibility ✅ DONE
- **Priority**: ~~LOW~~ COMPLETED
- **Resolution**: Extracted 14 handler classes into `ai/handlers/` implementing `AiActionHandler` interface.
  Registered via `AiActionRegistry` in `AiActionExecutor.setupRegistry()`. `execute()` reduced from ~1800 lines
  (14-branch if/else) to ~50 lines (registry lookup + dispatch). Fixed latent bug in `fallbackSimpleTurn()`
  target name resolution. All 616 unit tests pass, all 153 E2E scenarios pass.
- **Plan**: See `plan-ai-action-registry.prompt.md`
- **Affected flows**: AIBehavior

---

## 4. DRY / Cleanup

### 4.1 `movement.ts` Mixes Movement + Jump — ⏸ DEFERRED → `plan-deferred-low-priority.prompt.md`

### 4.2 `Combat` Class Stateful in Domain Layer — ⏸ DEFERRED → `plan-deferred-low-priority.prompt.md`

### 4.3 `battle-plan-service` Incomplete `shouldReplan` ✅ DONE
- **Priority**: ~~LOW~~ COMPLETED
- **Resolution**: Added 4 data-driven heuristics backed by a battlefield snapshot embedded in `BattlePlan` at generation time:
  1. Stale plan (≥2 rounds old) — existing, now uses `REPLAN_STALE_ROUNDS` constant
  2. Ally died — any living ally ID at generation is now dead
  3. Significant HP loss — any ally lost >25% of max HP (threshold: `REPLAN_HP_LOSS_THRESHOLD = 0.25`)
  4. New threat — a living combatant appears whose ID was unknown at generation (reinforcements)
- Added `allyHpAtGeneration`, `livingAllyIdsAtGeneration`, `livingEnemyIdsAtGeneration` snapshot fields to `BattlePlan`. All optional (backward compat with stored plans).
- 20 new unit tests in `battle-plan-service.test.ts` (636 total). All 153 E2E scenarios pass.
- **Plan**: See `plan-battle-plan-replan.prompt.md`
- **Affected flows**: AIBehavior

### 4.4 Cover Detection Simplified Heuristic ✅ DONE
- **Priority**: ~~LOW (documented known limitation)~~ COMPLETED
- **Files**: `domain/rules/combat-map-sight.ts`, `domain/rules/combat-map.test.ts`
- **Issue**: `getCoverLevel()` only checked 4 cardinal cells adjacent to the target, missed walls/cover cells anywhere else on the attacker→target line, and ignored `"wall"` and `"obstacle"` terrain types entirely.
- **Resolution**: Replaced 4-adjacent-cell heuristic with a ray-march algorithm (identical to `hasLineOfSight`). Added `terrainToCoverLevel()` helper that maps all 12 terrain types to their D&D 5e 2024 cover level. Walls now correctly grant full cover. `"obstacle"` terrain grants half cover. Cover anywhere on the attacker→target line is detected, not just adjacent to the target. 9 precise unit tests replace the 2 weak tests. 644 unit tests pass, 153/153 E2E pass.
- **Plan**: See `plan-cover-detection.prompt.md`
- **Affected flows**: CombatRules

### 4.5 `findRetreatPosition` Path Reachability ✅ DONE
- **Priority**: ~~LOW~~ COMPLETED
- **Fix**: Replaced the Euclidean-distance grid-scan in `findRetreatPosition` with a proper Dijkstra flood-fill (`getReachableCells`). The old implementation filtered candidates by `calculateDistance(origin, pos) > speedFeet` (Euclidean straight-line) without verifying the path was actually traversable — cells behind walls or reachable only via costly detours were incorrectly included. The new implementation enumerates only cells that A\* can actually reach within the movement budget, respecting walls, difficult terrain, diagonal alternating cost, and zone penalties.
- **Secondary fix**: `MoveAwayFromHandler` now explicitly guards the completely-blocked `findPath` case (returns early with `movedFeet: 0, blocked: true` instead of passing an unreachable destination downstream).
- **New export**: `getReachableCells(map, from, maxCostFeet, options)` — public Dijkstra flood-fill matching the architecture diagram in `combat-rules.instructions.md`.
- **Tests**: 10 new unit tests in `pathfinding.test.ts` (5 for `getReachableCells`, 5 for `findRetreatPosition`).
- **Plan**: See `plan-retreat-reachability.prompt.md`
- **Affected flows**: CombatRules, AIBehavior

---

## 5. Feature Gaps (Blocked)

### 5.1 Rest Interruption ✅ DONE
- **Priority**: ~~LOW (feature gap)~~ COMPLETED
- **Resolution**: Implemented event-log-based rest interruption state machine. No Prisma schema change needed.
  - Added `detectRestInterruption()` pure function in `domain/rules/rest.ts`
  - Added `RestStarted` to `GameEventInput` discriminated union
  - Added `CharacterService.beginRest()` — records rest via event, returns `{ restId, restType, startedAt }`
  - Updated `CharacterService.takeSessionRest()` — accepts optional `restStartedAt`; checks event log for `CombatStarted`/`DamageApplied` since that time
  - Added `POST /sessions/:id/rest/begin` endpoint
  - Updated `POST /sessions/:id/rest` to accept optional `restStartedAt` (backward compatible)
  - Combat interrupts any rest; Damage only interrupts long rest (D&D 5e 2024)
- **Plan**: See `plan-rest-interruption.prompt.md`
- **Affected flows**: EntityManagement

### ~~5.2 Hit Dice E2E Scenarios~~ ✅ DONE
- **Implemented**: Extended `RestAction` in `scenario-runner.ts` to support `hitDiceSpending` input (name-keyed, translated to ID before API call) and new `expect` fields: `characterHitDice` (remaining after rest) and `hpRecovered` (HP healed from HD spending).
- **Added scenarios**: `core/short-rest-hit-dice.json` (Fighter spends 2 HD, asserts HP ≥ 26 and 3 HD remaining) and `core/long-rest-hit-dice-recovery.json` (HD 1→3 after long rest, HP=42). 155/155 E2E passing.
- **Affected flows**: Testing

---

## Deferred Items

See `plan-deferred-low-priority.prompt.md` for the 2 items that were assessed and deferred.
