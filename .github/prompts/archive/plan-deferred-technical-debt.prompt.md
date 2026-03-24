# Plan: Deferred Technical Debt — Post-Audit Backlog

## Status: MOSTLY COMPLETE
## Date: 2025-03-22 (updated 2026-03-23)
## Source: Consolidated from completed plans: `plan-codebase-clean-code-audit`, `plan-wave5-testing-polish`, `plan-deferredItems`

---

## Overview

All 5 audit waves and the deferred features plan (grapple escape, AI potion use, hit dice) are complete. This plan consolidates every remaining deferred item into a single prioritized backlog for future work.

**Current stats:** 596 tests, 62 test files, typecheck clean, 151/151 E2E passing.

### Implementation Summary (2026-03-23)
Completed: §1.1, §1.3, §2.1, §2.2, §2.3, §3.1, §3.2, §5.1, §6.1, §6.2, §6.3, §7.1
Skipped (legitimate): §2.4 (DI bag pattern is idiomatic)
Remaining (blocked or low priority): §1.2, §3.3–3.5, §4.1–4.4, §5.2–5.7, §8.1, §8.2

### Additional work (2026-03-23)
- Full D&D 5e 2024 grapple/shove rewrite: Unarmed Strike attack roll + saving throw replaces contested Athletics checks
- FixedDiceRoller extended to accept sequential roll arrays
- 4 E2E scenario seeds updated for new grapple/shove mechanics

---

## Table of Contents

1. Rules Correctness
2. Type Safety
3. Consistency & Pattern Adherence
4. Scalability Improvements
5. DRY / Cleanup
6. Dead Code
7. Testability
8. Feature Gaps

---

## 1. Rules Correctness

### 1.1 Nat-20/1 on Saving Throws (§4.2) ✅ DONE
- **Priority**: HIGH
- **Issue**: D&D 5e 2024: nat-20/1 does NOT auto-succeed/fail saving throws (only attack rolls). Verify `SavingThrowResolver` does not incorrectly apply this.
- **File**: `application/services/combat/tabletop/saving-throw-resolver.ts`
- **Action**: Audit and fix if incorrect. Write test proving correct behavior.
- **Result**: Audited — already correct (`total >= action.dc`, no nat-20/1 override). Added 2 proving tests in `saving-throw-resolver.test.ts`.

### 1.2 Grapple + Multi-Attack Economy (Wave 5 deferred)
- **Priority**: MEDIUM
- **Issue**: Grapple uses `spendAction()` which marks the full action as used. D&D 5e 2024: grapple replaces ONE attack within a multi-attack action (e.g., Fighter with Extra Attack can grapple + attack).
- **File**: `application/services/combat/action-service.ts`
- **Blocked by**: Multi-attack interleaving not yet implemented.

### 1.3 Escape Grapple Skill Proficiency (Wave 5 deferred) ✅ DONE
- **Priority**: MEDIUM
- **Issue**: `escapeGrapple()` uses raw ability modifier without Athletics/Acrobatics proficiency bonus.
- **File**: `domain/rules/grapple-shove.ts`
- **Result**: Added `skillProficiencyBonus` parameter to `escapeGrapple()`. Callers (action-service.ts, ai-action-executor.ts) now pass proficiency bonus for Athletics or Acrobatics.

---

## 2. Type Safety

### 2.1 50+ `any` Types in Tabletop Modules (§6.2) ✅ DONE
- **Priority**: MEDIUM
- **Files**: `roll-state-machine.ts`, `action-dispatcher.ts`, `tabletop-types.ts`
- **Fix**: Define minimal interfaces for `characters: any[]`, `sheet: any`, etc. Incremental approach — one module at a time.
- **Note**: §6.1 (hydration-types.ts) was completed in Wave 4. This is the next layer.
- **Result**: Typed `RollProcessingCtx` (6 fields: encounter, characters, monsters, npcs, roster, command). Created `DeathSaveResult` interface. Updated ~20 method signatures across roll-state-machine.ts and action-dispatcher.ts. Remaining `any`: ~40 inline callbacks (resolve when enclosing arrays typed from repo) and ~15 `as any` casts on `.resources`/`.sheet` (`JsonValue` = `unknown`).

### 2.2 `any` in Spell Handler (§6.3) ✅ DONE
- **Priority**: MEDIUM
- **File**: `spell-action-handler.ts`
- **Fix**: Define `SpellCasterSheet`, `CombatantRecord` minimal interfaces.
- **Result**: Typed `characters` parameter as `SessionCharacterRecord[]`. Fixed `sheet.preparedSpells` access with proper cast.

### 2.3 `weapon-mastery.ts` Uses `Record<string, unknown>` (§6.4) ✅ DONE
- **Priority**: LOW
- **File**: `domain/rules/weapon-mastery.ts`
- **Result**: Created `WeaponMasterySheet` interface with typed fields. Updated function signatures.

### 2.4 `AbilityExecutionContext.params` Untyped Bag (§6.5) ⏭️ SKIPPED
- **Priority**: LOW
- **File**: `domain/abilities/ability-executor.ts`
- **Skip reason**: The `params` bag is a legitimate dependency-injection pattern. Each executor validates its own params at runtime. A discriminated union would couple all executors together.

---

## 3. Consistency & Pattern Adherence

### 3.1 Missing `capabilitiesForLevel` on Cleric + Paladin (§5.4) ✅ DONE
- **Priority**: LOW
- **Files**: `domain/entities/classes/cleric.ts`, `paladin.ts`
- **Fix**: Add capability listings to match other class definitions.

### 3.2 Two Parallel Turn-Advancement Paths (§5.8) ✅ DONE
- **Priority**: MEDIUM
- **File**: `application/services/combat/combat-service.ts`
- **Issue**: `nextTurn()` and `nextTurnDomain()` were two parallel paths.
- **Result**: Made constructor deps (diceRoller, combatantResolver, abilityRegistry) required. Deleted the fallback `nextTurn()` path (~180 lines). All callers now use `nextTurnDomain()`. RandomDiceRoller default injected in app.ts.

### 3.3 NPC Entity Info Missing Fields for AI (§5.9)
- **Priority**: LOW
- **File**: `application/services/combat/ai/ai-context-builder.ts`
- **Fix**: Normalize all entity types to expose `attacks`, `actions`, `bonusActions` for AI context.

### 3.4 Two Parallel Spell Resolution Paths (§5.10)
- **Priority**: LOW (long-term)
- **Files**: `spell-action-handler.ts` vs `action-service.ts`
- **Fix**: Document divergence; unify if feasible.

### 3.5 Tier B SSE Event Type Narrowing (Wave 5 deferred)
- **Priority**: LOW
- **File**: `application/repositories/event-repository.ts`
- **Issue**: `IEventRepository.append()` stays `string`. Non-combat events (`CharacterAdded`, `RestCompleted`, `SessionCreated`) block type narrowing.
- **Fix**: Define event type union when all event sources are catalogued.

---

## 4. Scalability Improvements

### 4.1 CombatResourceBuilder Monk Special Case (§7.2)
- **Priority**: LOW
- **Fix**: Extend `resourcesAtLevel` to accept ability scores parameter instead of Monk-specific hardcoding.

### 4.2 Cascade Parser Chain in ActionDispatcher (§7.3)
- **Priority**: LOW
- **Fix**: Short-circuit parser registry pattern (text parser tries each parser in order, returns first match).

### 4.3 `combat-map.ts` Monolith (§7.4)
- **Priority**: LOW
- **File**: `domain/rules/combat-map.ts` (540 lines, 35+ exports)
- **Fix**: Split into types/core/sight/zones modules.

### 4.4 AI Action Extensibility (§7.7)
- **Priority**: LOW
- **Fix**: Registry/strategy pattern for AI action executors (like AbilityRegistry for player abilities).

---

## 5. DRY / Cleanup

### 5.1 D20ModeProvider Dedup (§10, Wave 5 deferred) ✅ DONE
- **Priority**: LOW
- **Files**: `domain/rules/ability-checks.ts`, `domain/combat/attack-resolver.ts`
- **Issue**: Both define identical `D20ModeProvider` local type.
- **Fix**: Export from one, import in the other.
- **Result**: Exported `D20ModeProvider` type + `getAdjustedMode` function from ability-checks.ts. Removed duplicate from attack-resolver.ts, now imports.

### 5.2 `movement.ts` Mixes Movement + Jump (§10)
- **Priority**: LOW
- **Fix**: Consider splitting basic movement and jump mechanics into separate modules.

### 5.3 `Combat` Class Stateful in Domain Layer (§10)
- **Priority**: LOW
- **Issue**: `Combat` class holds mutable state in domain layer. Could be made more functional.

### 5.4 `loadRoster` Redundant Calls (§10) ⏭️ N/A
- **Priority**: LOW
- **Issue**: `loadRoster` called 2-3× per request in some flows.
- **Fix**: Cache or restructure to single load per request.
- **Result**: Investigated — each `loadRoster()` call is in a separate HTTP request handler (initiateAction, processRollResult, dispatch). Not actually redundant.

### 5.5 `battle-plan-service` Incomplete `shouldReplan` (§10)
- **Priority**: LOW
- **Fix**: Improve heuristic for when AI should regenerate battle plans.

### 5.6 Cover Detection Simplified Heuristic (§10)
- **Priority**: LOW (documented known limitation)
- **Fix**: Improve cover geometry when gameplay demands it.

### 5.7 `findRetreatPosition` Path Reachability (§10)
- **Priority**: LOW
- **Fix**: Verify retreat position path is actually traversable.

---

## 6. Dead Code

### 6.1 `openai-provider.ts` Stub (§9.5) ✅ DONE
- **Priority**: LOW
- **File**: `infrastructure/llm/openai-provider.ts`
- **Issue**: Throws "not implemented". Still exported from `infrastructure/llm/index.ts`.
- **Fix**: Remove barrel export so consumers don't accidentally depend on unimplemented provider. Keep file as a placeholder for future OpenAI support.
- **Result**: Removed barrel export from `infrastructure/llm/index.ts`. File kept intentionally — valid `LlmProvider` stub ready for implementation.

### 6.2 `breaksHidden()` Always Returns True (§9.6) ✅ DONE
- **Priority**: LOW
- **File**: `domain/rules/hide.ts`
- **Issue**: All cases return true — function is a no-op stub.
- **Fix**: Either implement per-breaker logic or remove and inline `true`.
- **Result**: Removed `StealthBreaker` type and `breaksHidden()` function from hide.ts. Removed 5 tests from hide.test.ts.

### 6.3 `MARTIAL_ARTS_DIE_BY_LEVEL` Unused (§9.6) ⏭️ N/A
- **Priority**: LOW
- **File**: `domain/rules/martial-arts-die.ts`
- **Fix**: Delete if truly unused (superseded by class definition data).
- **Result**: Constant doesn't exist. Functions `getMartialArtsDieSize`, `getMartialArtsDie`, `rollMartialArtsDie` ARE actively used. Item was a misidentification.

---

## 7. Testability

### 7.1 Dynamic Imports in 7 Executors (§8.5) ✅ DONE
- **Priority**: LOW
- **Files**: Various executor files in `abilities/executors/`
- **Issue**: Dynamic imports used to avoid circular dependencies. Complicates testing.
- **Fix**: Audit circular deps; migrate to static imports if resolved by module decomposition (Wave 3).
- **Result**: Converted all 7 executors to static imports (turn-undead, action-surge, second-wind, flurry-of-blows, patient-defense, step-of-the-wind, lay-on-hands). No circular deps found — resource-utils.ts only imports from domain types.

---

## 8. Feature Gaps

### 8.1 Rest Interruption (Phase 4 from deferred plan)
- **Priority**: LOW (feature gap, not tech debt)
- **Issue**: D&D 5e 2024: rest can be interrupted by combat/damage/spellcasting. Currently not implemented.
- **Blocked by**: No session-level time tracking or "in rest" state machine.

### 8.2 Hit Dice E2E Scenarios (Phase 3.9 from deferred plan)
- **Priority**: LOW
- **Issue**: Short rest with hit dice spending + long rest half-HD recovery have unit tests but no E2E scenarios.
- **Fix**: Create E2E scenarios when rest flow is testable via scenario runner.

---

## Recommended Execution Order

### Quick Wins (< 1 hour each)
- [x] §1.1 Nat-20/1 on saves audit — correct, 2 proving tests added
- [x] §5.1 D20ModeProvider dedup — exported + imported
- [x] §6.1 `openai-provider.ts` — barrel export removed, file kept as placeholder
- [x] §6.2 `breaksHidden()` cleanup — removed function + type + 5 tests
- [x] §6.3 `MARTIAL_ARTS_DIE_BY_LEVEL` cleanup — N/A, constant doesn't exist

### Medium Effort (half day each)
- [x] §2.1 Type safety for tabletop `any` types — ~20 signatures typed, RollProcessingCtx fully typed
- [x] §2.2 Spell handler `any` types — characters parameter typed
- [x] §3.2 Turn-advancement path consolidation — constructor deps required, fallback nextTurn() deleted (~180 lines)

### Additional Completed
- [x] §1.3 Escape grapple skill proficiency — added skillProficiencyBonus param
- [x] §2.3 WeaponMasterySheet interface — typed weapon mastery data
- [x] §3.1 capabilitiesForLevel on Cleric + Paladin
- [x] §7.1 Dynamic imports in 7 executors → static imports

### Skipped (legitimate)
- [x] §2.4 AbilityExecutionContext.params — DI bag pattern is idiomatic, skip

### Extra: Grapple/Shove 2024 Rules Rewrite
- [x] Replaced contested Athletics checks with D&D 5e 2024 Unarmed Strike (attack roll vs AC) + saving throw (STR/DEX vs DC)
- [x] Extended FixedDiceRoller to accept sequential roll arrays for 2-step mechanic testing
- [x] Updated all callers: action-service.ts, ai-action-executor.ts, grapple-handlers.ts
- [x] Rewrote domain tests (grapple-shove.test.ts) for new 2-step flow
- [x] Fixed 4 E2E scenarios (lowered test goblin AC for new attack-roll-based mechanic)

### Remaining (blocked or low priority)
- [ ] §1.2 Grapple + multi-attack economy (blocked: needs multi-attack interleaving)
- [ ] §4.3 combat-map.ts decomposition (needs separate plan)
- [ ] §8.1 Rest interruption (blocked: no session-level time tracking)
- [ ] §8.2 Hit dice E2E (blocked: rest flow not in scenario runner)
