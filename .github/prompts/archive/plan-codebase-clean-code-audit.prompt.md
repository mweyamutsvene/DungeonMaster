# Plan: Codebase Clean Code & Modularity Audit

## Status: COMPLETE — All 5 Waves Done
## Date: 2025-03-22
## Source: 6 SME Deep Dive Audits

---

## Executive Summary

Six SME agents conducted deep-dive audits across the entire codebase (~300+ files). The codebase is **architecturally sound** — DDD layering, port/adapter boundaries, and the three-pattern class ability system are well-designed. However, organic growth has accumulated significant technical debt in specific hotspots.

**By the numbers:**
- **~90 findings** across all 6 domains
- **18 HIGH priority** items (correctness bugs, god modules, massive DRY violations)
- **~35 MEDIUM priority** items (consistency gaps, missing abstractions, type safety)
- **~35 LOW priority** items (dead code, minor cleanups, nice-to-haves)
- **3 confirmed bugs** (NPC repo defaults, save spells ignoring effect bonuses, Math.random() breaking determinism)
- **~2,000+ lines of dead code** identified for deletion
- **4 god modules** identified (RSM 2,550 lines, ActionDispatcher 2,400 lines, AiActionExecutor 2,727 lines, SpellActionHandler 1,000 lines)

---

## Table of Contents

1. Critical: Correctness Bugs
2. High Priority: God Module Decomposition
3. High Priority: DRY Violations & Duplication
4. High Priority: Rules Correctness (D&D 5e 2024)
5. Medium Priority: Consistency & Pattern Adherence
6. Medium Priority: Type Safety
7. Medium Priority: Scalability Improvements
8. Medium Priority: Testability Gaps
9. Low Priority: Dead Code Cleanup
10. Low Priority: Minor Cleanups
11. New Agent Recommendations
12. Recommended Execution Order

---

## 1. Critical: Correctness Bugs

These should be fixed first — they produce incorrect game behavior.

### 1.1 Save-Based Spells Ignore Effect Bonuses (SpellSystem)
- **Source**: SpellSystem SME Finding #7
- **File**: `spell-action-handler.ts` L357–L530
- **Bug**: `handleSaveSpell()` rolls saves inline instead of using the instantiated `SavingThrowResolver`. This means save-based spells (Burning Hands, Hold Person) **ignore target's Bless/effect bonuses and effect-based advantage/disadvantage on saves**.
- **Fix**: Refactor `handleSaveSpell()` to delegate save resolution to `this.savingThrowResolver.resolve()`.
- **Effort**: Medium

### 1.2 NPC Repository Default Mismatch (EntityManagement)
- **Source**: EntityManagement SME Finding #2
- **File**: `infrastructure/testing/memory-repos.ts` L436
- **Bug**: In-memory NPC repo creates with `faction: "neutral"` / `aiControlled: false`. Prisma + schema use `"party"` / `true`. Tests diverge from production.
- **Fix**: Change defaults in `MemoryNPCRepository.createInSession()` to match Prisma schema.
- **Effort**: Small

### 1.3 Math.random() Breaks Deterministic Testing (CombatRules)
- **Source**: CombatRules SME Finding #2
- **Files**: `saving-throws.ts` L72–87, `martial-arts-die.ts` L57–60
- **Bug**: Two functions bypass `DiceRoller` and use `Math.random()` directly, breaking deterministic test guarantees.
- **Fix**: Consolidate `saving-throws.ts` into `ability-checks.ts`; refactor `martial-arts-die.ts` to accept `DiceRoller`.
- **Effort**: Small

---

## 2. High Priority: God Module Decomposition

Four modules have grown far beyond maintainable size. Each should be decomposed.

### 2.1 RollStateMachine → 3–4 focused modules (~2,550 lines)
- **Source**: CombatOrchestration SME Finding 1.1
- **File**: `tabletop/roll-state-machine.ts`
- **Decomposition**:
  - `initiative-handler.ts` — `handleInitiativeRoll`, `handleInitiativeSwap`, `loadRoster`, combatant init
  - `weapon-mastery-resolver.ts` — `resolveWeaponMastery` (7 mastery types)
  - `hit-rider-resolver.ts` — `resolvePostDamageEffect` (generic pipeline)
  - Core `roll-state-machine.ts` retains attack/damage/death-save dice flows
- **Effort**: Large

### 2.2 ActionDispatcher → handler groups (~2,400 lines)
- **Source**: CombatOrchestration SME Finding 1.2
- **File**: `tabletop/action-dispatcher.ts`
- **Decomposition**:
  - `move-handlers.ts` — move, moveToward, jump
  - `attack-handlers.ts` — attack, offhand attack
  - `interaction-handlers.ts` — pickup, drop, draw, sheathe, use item
  - `social-handlers.ts` — help, hide, search
  - `grapple-handlers.ts` — grapple, shove, escape grapple
  - Keep `dispatch()` + class/bonus ability routing in ActionDispatcher
- **Effort**: Large

### 2.3 AiActionExecutor → shared movement + attack core (~2,727 lines)
- **Source**: AIBehavior SME Findings #1, #3
- **File**: `ai/ai-action-executor.ts`
- **Key extractions**:
  - Shared `resolveMovement()` for 3 nearly-identical movement handlers (~300 lines saved)
  - `AiAttackResolver` for the 340-line inlined two-phase attack resolution (duplicates tabletop flow)
- **Risk**: Attack resolution duplicate could drift from tabletop path — consider sharing primitives
- **Effort**: Medium (movement), Large (attack resolver)

### 2.4 SpellActionHandler → strategy pattern (~1,000 lines)
- **Source**: SpellSystem SME Findings #1, #2, #4
- **File**: `tabletop/spell-action-handler.ts`
- **Decomposition**:
  - Extract `SpellCastingContext` factory (slot spending, concentration, encounter lookup)
  - Each delivery mode → standalone `SpellDeliveryHandler` implementing `canHandle()/handle()`
  - Registry-based dispatch instead of priority if-chain
- **Effort**: Medium

---

## 3. High Priority: DRY Violations & Duplication

### 3.1 Combatant Initialization Repeated 4× (CombatOrchestration)
- **Source**: CombatOrchestration SME Finding 2.1
- **File**: `roll-state-machine.ts` L500–L800
- **Issue**: 4 nearly-identical blocks for PC/Monster/NPC init
- **Fix**: Extract `buildCombatantEntry()` factory
- **Effort**: Medium

### 3.2 Encounter/Combatant Fetch Duplicated 8× (SpellSystem)
- **Source**: SpellSystem SME Finding #5
- **File**: `spell-action-handler.ts` (8 locations)
- **Fix**: Extract `resolveEncounterContext(sessionId, actorId)` utility
- **Effort**: Small

### 3.3 Duplicate `isCreatureSurprised` (CombatOrchestration)
- **Source**: CombatOrchestration SME Finding 3.1
- **Files**: `tabletop-combat-service.ts` L75, `roll-state-machine.ts` L119
- **Fix**: Move to shared utility
- **Effort**: Small

### 3.4 Duplicate Initiative Modifier Computation (CombatOrchestration)
- **Source**: CombatOrchestration SME Finding 3.2 / 5.1
- **Files**: `tabletop-combat-service.ts` L95, `roll-state-machine.ts` L135
- **Fix**: Unify into single exported function
- **Effort**: Small

### 3.5 Movement Handler Duplication in AI (~300 lines) (AIBehavior)
- **Source**: AIBehavior SME Finding #1
- **File**: `ai-action-executor.ts` L900–L1920
- **Fix**: Extract `resolveMovement(params)` shared pipeline
- **Effort**: Medium

### 3.6 Executor Validation Boilerplate (~210 lines) (ClassAbilities)
- **Source**: ClassAbilities SME Findings #8, #9
- **Files**: All 14 executor files
- **Fix**: Create `validateExecutorPrereqs()` and `checkAndSpendResource()` helpers
- **Effort**: Medium

### 3.7 JSON Utility Functions Duplicated 3–5× (EntityManagement)
- **Source**: EntityManagement SME Finding #4
- **Files**: `combatant-resolver.ts`, `creature-hydration.ts`, `resource-utils.ts`, `action-service.ts`
- **Fix**: Create shared `json-helpers.ts`
- **Effort**: Medium

### 3.8 Entity Loading Duplicated in AI Context (AIBehavior)
- **Source**: AIBehavior SME Finding #8
- **File**: `ai-context-builder.ts` L120–L340
- **Fix**: Extract shared `loadCombatantDetails()` method
- **Effort**: Medium

---

## 4. High Priority: Rules Correctness (D&D 5e 2024)

### 4.1 Grapple/Shove Uses 2014 Contested Checks
- **Source**: CombatRules SME Finding #3
- **File**: `domain/rules/grapple-shove.ts` L50–L130
- **Issue**: Uses contested Athletics checks instead of 2024 DC-based saving throw system
- **Fix**: Rewrite to 2024 DC-based mechanics
- **Effort**: Medium

### 4.2 Saving Throws Don't Enforce Natural 20/1 Auto-Success/Fail
- **Source**: CombatRules SME Finding #8
- **File**: `domain/rules/saving-throws.ts` L103–L135
- **Fix**: Apply `success = criticalSuccess || (!criticalFailure && total >= dc)`. Moot if consolidated with `ability-checks.ts`.
- **Effort**: Small

---

## 5. Medium Priority: Consistency & Pattern Adherence

### 5.1 Incomplete Feature Map Migration (ClassAbilities)
- **Source**: ClassAbilities SME Finding #3
- **Files**: `barbarian.ts` (hasDangerSense/hasFeralInstinct), `ranger.ts` (4 legacy functions)
- **Fix**: Replace with `classHasFeature()` calls; delete legacy functions

### 5.2 Executor Class Validation Missing (ClassAbilities)
- **Source**: ClassAbilities SME Finding #2
- **Files**: Monk/Rogue/Monster executors
- **Fix**: All executors should gate with `classHasFeature()`

### 5.3 Rogue Missing ClassCombatTextProfile (ClassAbilities)
- **Source**: ClassAbilities SME Finding #11
- **Fix**: Add `ROGUE_COMBAT_TEXT_PROFILE` with cunning action mapping

### 5.4 Missing `capabilitiesForLevel` on Cleric + Paladin (ClassAbilities)
- **Source**: ClassAbilities SME Finding #10
- **Fix**: Add capability listings for classes with existing executors

### 5.5 Duplicate `channelDivinityUsesForLevel` Name Collision (ClassAbilities)
- **Source**: ClassAbilities SME Finding #4
- **Files**: `cleric.ts`, `paladin.ts`
- **Fix**: Rename to `clericChannelDivinityUsesForLevel` / `paladinChannelDivinityUsesForLevel`

### 5.6 Duplicate `SessionNPCRecord` Type (EntityManagement)
- **Source**: EntityManagement SME Finding #1
- **Files**: `application/types.ts`, `repositories/npc-repository.ts`
- **Fix**: Remove duplicate, import from canonical location

### 5.7 `Condition` Type Name Collision (EntityManagement)
- **Source**: EntityManagement SME Finding #12
- **Files**: `combat/condition.ts` vs `combat/conditions.ts`
- **Fix**: Consolidate into single `conditions.ts`

### 5.8 Two Parallel Turn-Advancement Paths (CombatOrchestration)
- **Source**: CombatOrchestration SME Finding 5.2
- **File**: `combat-service.ts`
- **Fix**: Consolidate `nextTurn()` and `nextTurnDomain()` into one path

### 5.9 NPC Entity Info Missing Fields for AI (AIBehavior)
- **Source**: AIBehavior SME Finding #9
- **File**: `ai-context-builder.ts`
- **Fix**: Normalize all entity types to expose `attacks`, `actions`, `bonusActions`, etc.

### 5.10 Two Parallel Spell Resolution Paths (SpellSystem)
- **Source**: SpellSystem SME Finding #11
- **Files**: `spell-action-handler.ts` vs `action-service.ts` vs `spell-resolver.ts`
- **Fix**: Long-term unification; short-term document divergence

### 5.11 Documentation Out of Date
- **Source**: ClassAbilities SME Findings #1, #12
- **Files**: `.github/instructions/class-abilities.instructions.md`, `copilot-instructions.md`
- **Fix**: Update executor count (14 not 24), Fighter profile (2 mappings not 3)

---

## 6. Medium Priority: Type Safety

### 6.1 Pervasive `as any` in Hydration (25+ casts) (EntityManagement)
- **Source**: EntityManagement SME Finding #10
- **Files**: `combat-hydration.ts`, `combatant-resolver.ts`, `character-service.ts`
- **Fix**: Define `CharacterSheet`, `MonsterStatBlock`, `CombatantResources` interfaces; parse/validate at boundary
- **Effort**: Large

### 6.2 50+ `any` Types in Tabletop Modules (CombatOrchestration)
- **Source**: CombatOrchestration SME Finding 3.4
- **Files**: `roll-state-machine.ts`, `action-dispatcher.ts`
- **Fix**: Define minimal interfaces for `characters: any[]`, `sheet: any`, etc.
- **Effort**: Medium (incremental)

### 6.3 `any` in Spell Handler (SpellSystem)
- **Source**: SpellSystem SME Finding #8
- **File**: `spell-action-handler.ts`
- **Fix**: Define `SpellCasterSheet`, `CombatantRecord` minimal interfaces
- **Effort**: Medium

### 6.4 `weapon-mastery.ts` Uses `Record<string, unknown>` (CombatRules)
- **Source**: CombatRules SME Finding #13
- **Fix**: Define minimal typed interface
- **Effort**: Small

### 6.5 `AbilityExecutionContext.params` Untyped Bag (ClassAbilities)
- **Source**: ClassAbilities SME Finding #7
- **Fix**: Define typed `ExecutorParams` union or base interface
- **Effort**: Medium

---

## 7. Medium Priority: Scalability Improvements

### 7.1 `class-resources.ts` / `rest.ts` Switch-Statement Hubs (CombatRules)
- **Source**: CombatRules SME Finding #7
- **Fix**: Registry pattern — each class declares its `resourcePoolFactory` and `refreshPolicy`
- **Effort**: Medium

### 7.2 `CombatResourceBuilder` Monk Special Case (ClassAbilities)
- **Source**: ClassAbilities SME Finding #6
- **Fix**: Extend `resourcesAtLevel` to accept ability scores parameter
- **Effort**: Small

### 7.3 Cascade Parser Chain in ActionDispatcher (CombatOrchestration)
- **Source**: CombatOrchestration SME Finding 2.3
- **Fix**: Short-circuit parser registry pattern
- **Effort**: Medium

### 7.4 `combat-map.ts` Monolith (540 lines, 35+ exports) (CombatRules)
- **Source**: CombatRules SME Finding #6
- **Fix**: Split into types/core/sight/zones modules
- **Effort**: Medium

### 7.5 Spell Definitions as Inline Anonymous Types (SpellSystem)
- **Source**: SpellSystem SME Finding #3
- **Fix**: Create `PreparedSpellDefinition` domain interface
- **Effort**: Small

### 7.6 AI System Prompt Template System (AIBehavior)
- **Source**: AIBehavior SME Finding #4
- **Fix**: `PromptBuilder` with named sections, conditional inclusion, versioning
- **Effort**: Medium

### 7.7 AI Action Extensibility (AIBehavior)
- **Source**: AIBehavior SME Finding #6
- **Fix**: Registry/strategy pattern for AI action executors
- **Effort**: Medium

### 7.8 No Formal State Machine for Pending Actions (CombatOrchestration)
- **Source**: CombatOrchestration SME Finding 4.1
- **Fix**: Add handler map with exhaustiveness check + transition validation
- **Effort**: Medium

---

## 8. Medium Priority: Testability Gaps

### 8.1 SpellActionHandler Has Zero Unit Tests (SpellSystem)
- **Source**: SpellSystem SME Finding #9
- **Fix**: Create `spell-action-handler.test.ts` with in-memory repos
- **Effort**: Medium

### 8.2 AiActionExecutor Has Zero Unit Tests (AIBehavior)
- **Source**: AIBehavior SME Finding #11
- **Fix**: Create `ai-action-executor.test.ts` with mocks
- **Effort**: Medium

### 8.3 No MockAiDecisionMaker (AIBehavior)
- **Source**: AIBehavior SME Finding #10
- **Fix**: Add to `infrastructure/llm/mocks/index.ts`
- **Effort**: Small

### 8.4 Private Methods Block Granular Testing (CombatOrchestration)
- **Source**: CombatOrchestration SME Finding 6.2
- **Fix**: Resolved by module extraction (§2.1, §2.2) — extracted functions become public
- **Effort**: N/A (comes for free with decomposition)

### 8.5 Dynamic Imports in 7 Executors (ClassAbilities)
- **Source**: ClassAbilities SME Finding #5
- **Fix**: Audit circular dep; migrate to static imports if resolved
- **Effort**: Small

---

## 9. Low Priority: Dead Code Cleanup

Total: ~2,000+ lines ready for deletion.

### 9.1 CombatRules Dead Files (~600 lines)
- `domain/rules/bonus-action.ts` (~115 lines)
- `domain/rules/movement-rules.ts` (~22 lines)
- `domain/combat/modifiers.ts` (~240 lines)
- `domain/combat/movement.ts` (~240 lines)

### 9.2 EntityManagement Dead Hierarchies (~200 lines)
- `domain/entities/actions/` directory (5 files, all "not implemented")
- `domain/entities/items/item.ts`, `weapon.ts`, `armor.ts`, `equipment.ts` (OOP hierarchy, never instantiated)
- `domain/entities/effects/` hierarchy (superseded by `ActiveEffect`)

### 9.3 ClassAbilities Dead Code (~30 lines)
- `matchesAbilityPattern()` in `ability-executor.ts` (unused)
- `globalAbilityRegistry` singleton in `ability-registry.ts` (unused)
- Ranger legacy `has*AtLevel()` functions in `ranger.ts` (4 functions)

### 9.4 SpellSystem Dead Stubs
- `domain/entities/actions/spellcast-action.ts` (returns "not implemented")
- `domain/entities/spells/spell.ts` (class unused by handler)
- `domain/rules/concentration.ts` functions (only used by dead `spell-resolver.ts`)

### 9.5 AIBehavior Dead Code
- `infrastructure/llm/openai-provider.ts` (throws "not implemented")

### 9.6 CombatRules Minor Dead Code
- `MARTIAL_ARTS_DIE_BY_LEVEL` constant in `martial-arts-die.ts`
- `breaksHidden()` always returns true in `hide.ts`
- Incomplete barrel in `domain/rules/index.ts`

---

## 10. Low Priority: Minor Cleanups

- Duplicate `D20ModeProvider` pattern (CombatRules)
- `movement.ts` mixes basic movement + jump mechanics (CombatRules)
- `Combat` class is stateful in domain layer (CombatRules)
- Incomplete barrel exports (CombatRules, ClassAbilities)
- String literal event types without enum (CombatOrchestration)
- `loadRoster` called redundantly 2-3× per request (CombatOrchestration)
- `battle-plan-service` incomplete `shouldReplan` heuristic (AIBehavior)
- AI reaction decisions use simple heuristics not LLM (AIBehavior — accepted for now)
- Context duplication in LLM prompts (battlefield sent as text AND JSON) (AIBehavior)
- Unused `EquippedItems` import in `creature-hydration.ts` (EntityManagement)
- `PendingActionRepository` co-located with in-memory impl (EntityManagement)
- Cover detection simplified heuristic (CombatRules — document as known limitation)
- `findRetreatPosition` doesn't verify path reachability (CombatRules)

---

## 11. New Agent Recommendations

### Recommended New Agents

| Agent Name | Scope | Rationale |
|-----------|-------|-----------|
| **PromptEngineering-SME** | All system/user prompts in `infrastructure/llm/*.ts`, prompt templates, JSON schemas, few-shot examples | Cross-cuts all 6 LLM adapters; prompt quality is independent of tactical AI logic; would own template system, versioning, token optimization |
| **InventoryManagement-SME** | `domain/entities/items/**`, inventory endpoints, weapon/armor catalogs, magic items | 13 files, 1000+ lines with own data model and catalog system; rarely interacts with creature hydration or combat |
| **EnhancementAndReactions-SME** | `combat-text-profile.ts` reaction/enhancement types, `saving-throw-resolver.ts`, `two-phase-action-service.ts` | Cross-cutting concern spanning ClassAbilities + CombatRules + CombatOrchestration; adding new reactions requires expertise across all three |

### Considered But Not Recommended (Yet)

| Agent Name | Reason to Defer |
|-----------|----------------|
| Combat Initialization Agent | Valuable after RSM decomposition (§2.1) creates `initiative-handler.ts` as a standalone module; premature now |
| Turn Management Agent | Same — valuable after `nextTurn` consolidation (§5.8); would own condition expiry, zone processing, resource reset |
| Weapon Mastery Agent | Only if mastery system grows beyond current 7 types |
| Individual Class Agents (Monk, Barbarian) | Not complex enough to justify; ClassAbilities-SME handles fine |
| SpellDelivery vs SpellEffects split | Not cleanly separable until strategy pattern refactor (§2.4) is done |
| Narrative Agent | Only ~60 lines; too small for dedicated agent |

---

## 12. Recommended Execution Order

### Wave 1: Critical Fixes (Small, High Impact)
1. [x] **Bug Fix**: NPC repo defaults mismatch (§1.2) — 1 line change
2. [x] **Bug Fix**: Math.random() → DiceRoller (§1.3) — consolidated saving-throws.ts into ability-checks.ts, refactored martial-arts-die.ts
3. [x] **Bug Fix**: Save spells use SavingThrowResolver (§1.1) — SpellSystem-Implementer delegated handleSaveSpell() to resolver
4. [x] **Dead Code**: Delete 4 CombatRules dead files (§9.1) — deleted bonus-action.ts, movement-rules.ts, modifiers.ts + tests; restored movement.ts (was imported by combat.ts)
5. [x] **Dead Code**: Delete EntityManagement dead hierarchies (§9.2) — deleted actions/, items/item|weapon|armor|equipment.ts, effects/ dir
6. [x] **Dead Code**: Delete ClassAbilities dead code (§9.3) — deleted matchesAbilityPattern, globalAbilityRegistry, ranger legacy functions + migrated test; also deleted spell-resolver.ts chain and spell.ts
7. [x] **Docs**: Update executor count + Fighter profile in instructions (§5.11) — fixed to 14 executors, 2 fighter mappings, added all 7 profiles

### Wave 2: Quick Wins (Small Effort, Medium+ Priority)
8. [x] **DRY**: Extract `resolveEncounterContext()` for spell handler (§3.2) — already complete; one inline duplicate in handleCastSpell cleaned up
9. [x] **DRY**: Unify `isCreatureSurprised` (§3.3) — extracted to tabletop-utils.ts
10. [x] **DRY**: Unify initiative modifier computation (§3.4) — computeInitiativeModifiers/computeInitiativeRollMode extracted to tabletop-utils.ts
11. [x] **Consistency**: Fix executor class validation gates (§5.2) — fixed broken class extraction in 5 executors; fixed 10 pre-existing test failures
12. [x] **Consistency**: Complete Feature Map migration (§5.1) — hasDangerSense/hasFeralInstinct already removed; ranger legacy fns removed in Wave 1
13. [x] **Consistency**: Add Rogue CombatTextProfile (§5.3) — ROGUE_COMBAT_TEXT_PROFILE already exists and registered
14. [x] **Consistency**: Fix duplicate type definitions (§5.5, §5.6, §5.7) — channelDivinity already renamed; SessionNPCRecord canonical in types.ts; condition.ts consolidated into conditions.ts
15. [x] **Scalability**: Create `PreparedSpellDefinition` type (§7.5) — already implemented in prepared-spell-definition.ts

### Wave 3: Module Decomposition (Large Effort, High Impact)
16. [x] **Decompose**: RollStateMachine → 3-4 modules (§2.1) — COMPLETE. Wired InitiativeHandler, WeaponMasteryResolver, HitRiderResolver. RSM reduced from 2678 → 1671 lines (38% reduction). All 4 methods delegate to extracted modules.
17. [x] **Decompose**: ActionDispatcher → handler groups (§2.2) — COMPLETE. Wired GrappleHandlers, InteractionHandlers, SocialHandlers. 13 methods replaced with delegation. Unused imports cleaned.
18. [x] **Decompose**: SpellActionHandler → strategy pattern (§2.4) — COMPLETE. 215-line facade delegates to spell-delivery/ handlers via registry pattern.
19. [x] **Decompose**: AiActionExecutor → shared movement + attack (§2.3) — COMPLETE. Fixed orphaned code from incomplete extraction. Refactored executeMoveAwayFrom to use resolveAiMovement(). Removed inline sync/zone-damage code. Cleaned unused imports.

### Wave 4: Scaffolding & Infrastructure
20. [x] **Type Safety**: Define CharacterSheet/MonsterStatBlock/CombatantResources interfaces (§6.1) — hydration-types.ts created; 16 `as any` casts replaced in combatant-resolver.ts
21. [x] **DRY**: Create shared json-helpers.ts (§3.7) — json-helpers.ts created; isRecord/readNumber/readString/readBoolean/readArray/readObject consolidated from 7 duplication sites
22. [x] **DRY**: Create executor validation helpers (§3.6) — executor-helpers.ts created; all 14 executors updated
23. [x] **Scalability**: Registry-ify class resources (§7.1) — resourcePoolFactory + restRefreshPolicy added to all 10 class definitions; class-resources.ts + rest.ts switches replaced with registry lookups
24. [x] **Scalability**: Prompt template system (§7.6) — PromptBuilder created in infrastructure/llm/; ai-decision-maker.ts migrated; TODOs added to 5 other LLM files
25. [x] **Scalability**: Formal state machine for pending actions (§7.8) — PENDING_ACTION_TYPES const tuple + PendingActionHandlerMap + RollHandlerFn types added; rollHandlers map wired in roll-state-machine.ts; transition validation asserter added

### Wave 5: Testing & Polish
26. [x] **Testing**: Add spell-action-handler unit tests (§8.1) — 9 tests (Fire Bolt, Burning Hands, Cure Wounds, Bless, Spirit Guardians, Magic Missile, concentration, no slots, fallthrough)
27. [x] **Testing**: Add ai-action-executor unit tests (§8.2) — 9 tests (buildActorRef ×4, economy guard ×2, missing target, target not found, unknown action)
28. [x] **Testing**: MockAiDecisionMaker (§8.3) — already implemented, confirmed and skipped
29. [x] **Rules**: Rewrite grapple/shove for 2024 (§4.1) — DC-based saves, all callers updated (5 source + 3 test files)
30. [x] **Remaining**: §10 cleanups — EquippedItems import removed, InMemoryPendingActionRepository moved to memory-repos.ts, battlefield dedup fixed, ACTION_RESULT_TYPES added (7-member union), 11 barrel exports added to domain/rules/index.ts. D20ModeProvider dedup deferred (low risk).

---

## Cross-Cutting Themes

### Theme 1: God Modules
The 4 largest files (RSM, ActionDispatcher, AiActionExecutor, SpellActionHandler) account for ~8,700 lines — nearly all HIGH findings trace back to them. Decomposition is the single highest-leverage investment.

### Theme 2: Dual-Path Divergence
Multiple systems have parallel implementations that can drift: initiative computation, turn advancement, spell resolution, attack resolution (tabletop vs AI). Each dual-path is a correctness risk. Unification should be prioritized alongside decomposition.

### Theme 3: `as any` Epidemic
The JSON-blob-driven hydration layer has 75+ `as any` casts across the codebase. A typed JSON schema layer at the hydration boundary would eliminate most of them and catch bugs at compile time.

### Theme 4: Dead Code Accumulation
~2,000+ lines of dead code (dead files, dead class hierarchies, dead stubs) add cognitive load and create false impressions of coverage. A single cleanup pass would be the highest-ROI, lowest-risk change.

---

## SME Audit Source Files

All detailed findings were preserved in (cleaned up after Wave 5):
- sme-audit-combat-rules.md
- sme-audit-class-abilities.md
- sme-audit-spell-system.md
- sme-audit-combat-orchestration.md
- sme-audit-ai-behavior.md
- sme-audit-entity-management.md
