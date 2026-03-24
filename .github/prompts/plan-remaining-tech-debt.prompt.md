# Plan: Remaining Technical Debt Backlog

## Status: BACKLOG
## Date: 2026-03-23
## Source: Remaining items from archived `plan-deferred-technical-debt.prompt.md`
## Baseline: 596 unit tests, 151/151 E2E, typecheck clean

---

## Overview

Low-priority and blocked items remaining after the main tech debt cleanup. All HIGH and MEDIUM items have been resolved. These are opportunistic improvements — pick them up when working in the relevant area, or when a blocker is lifted.

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

### 3.2 Cascade Parser Chain in ActionDispatcher
- **Priority**: LOW
- **Issue**: ActionDispatcher uses a long if/else chain to parse text into actions.
- **Fix**: Short-circuit parser registry pattern (text parser tries each parser in order, returns first match). Similar to how AbilityRegistry works for executors.
- **Affected flows**: CombatOrchestration

### 3.3 `combat-map.ts` Monolith
- **Priority**: LOW
- **File**: `domain/rules/combat-map.ts` (540 lines, 35+ exports)
- **Fix**: Split into types/core/sight/zones modules. Large but stable — only split if adding significant new functionality.
- **Affected flows**: CombatRules

### 3.4 AI Action Extensibility
- **Priority**: LOW
- **Issue**: AI action executors are a large switch/if-else chain in `ai-action-executor.ts`.
- **Fix**: Registry/strategy pattern for AI action executors (like AbilityRegistry for player abilities).
- **Affected flows**: AIBehavior

---

## 4. DRY / Cleanup

### 4.1 `movement.ts` Mixes Movement + Jump
- **Priority**: LOW
- **File**: `domain/rules/movement.ts`
- **Fix**: Consider splitting basic movement and jump mechanics into separate modules. Only worthwhile if adding new movement features (swimming, climbing, flying).
- **Affected flows**: CombatRules

### 4.2 `Combat` Class Stateful in Domain Layer
- **Priority**: LOW
- **Issue**: `Combat` class holds mutable state in domain layer. Could be made more functional (pure functions operating on combat state records).
- **Risk**: Large refactor with high regression risk for low benefit. The class works correctly.
- **Affected flows**: CombatRules

### 4.3 `battle-plan-service` Incomplete `shouldReplan`
- **Priority**: LOW
- **Fix**: Improve heuristic for when AI should regenerate battle plans (e.g., after significant HP loss, ally death, new threats).
- **Affected flows**: AIBehavior

### 4.4 Cover Detection Simplified Heuristic
- **Priority**: LOW (documented known limitation)
- **Fix**: Improve cover geometry when gameplay demands it. Current implementation uses simple line-of-sight without obstacle size/shape.
- **Affected flows**: CombatRules

### 4.5 `findRetreatPosition` Path Reachability
- **Priority**: LOW
- **Fix**: Verify retreat position path is actually traversable (currently picks position by distance without pathfinding validation).
- **Affected flows**: AIBehavior

---

## 5. Feature Gaps (Blocked)

### 5.1 Rest Interruption
- **Priority**: LOW (feature gap)
- **Issue**: D&D 5e 2024: rest can be interrupted by combat/damage/spellcasting ≥1 hour for long rest, ≥1 minute for short rest. Currently not implemented.
- **Blocked by**: No session-level time tracking or "in rest" state machine.
- **Affected flows**: EntityManagement, CombatOrchestration

### 5.2 Hit Dice E2E Scenarios
- **Priority**: LOW
- **Issue**: Short rest with hit dice spending + long rest half-HD recovery have unit tests but no E2E scenarios.
- **Blocked by**: Rest flow not yet supported in the scenario runner.
- **Affected flows**: Testing

---

## Recommended Approach

These are all **opportunistic** — pick up when you're already working in the area:

| When working on... | Consider picking up... |
|---------------------|----------------------|
| Multi-attack / Extra Attack rework | ~~§1.1 Grapple economy~~ ✅ DONE |
| AI improvements | §2.1 NPC fields, §3.4 AI extensibility, §4.3 replan, §4.5 retreat |
| Spell system changes | §2.2 Spell path unification |
| New event types | ~~§2.3 SSE type narrowing~~ ✅ DONE |
| New class abilities | §3.1 Resource builder generalization |
| Action text parsing | §3.2 Parser registry |
| Map/terrain features | §3.3 combat-map split, §4.4 cover |
| Movement/terrain types | §4.1 movement split |
| Rest system expansion | §5.1 interruption, §5.2 E2E scenarios |
