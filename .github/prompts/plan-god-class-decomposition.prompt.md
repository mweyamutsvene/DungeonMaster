# Plan: God-Class Decomposition — Combat Service Layer

## Round: 1
## Status: DRAFT
## Affected Flows: CombatOrchestration, CombatRules, AIBehavior

---

## Objective

Decompose three oversized application-layer services (`action-dispatcher.ts`, `action-service.ts`, `two-phase-action-service.ts`) into focused, single-responsibility modules. The goal is to reduce per-file cognitive load, eliminate merge-conflict hotspots, and make adding new actions/reactions a one-module operation.

**NOT in scope:** `combat-service.ts` (1,083 lines, 6 public methods — acceptable), `tactical-view-service.ts` (547 lines — healthy), `tabletop-combat-service.ts` (435 lines — already decomposed facade), `roll-state-machine.ts` (1,555 lines — deferred, different problem shape).

---

## Current State Analysis

### action-dispatcher.ts (2,143 lines) — WORST OFFENDER

**Problem:** One class with 19 private handler methods + 1 public `dispatch()` + text parsing chain. Three handler groups already extracted (GrappleHandlers, InteractionHandlers, SocialHandlers), but the biggest methods remain inlined.

**Method sizes (lines):**
| Method | Lines | Status |
|--------|-------|--------|
| `handleAttackAction` | ~589 | 🔴 Extract |
| `handleBonusAbility` | ~438 | 🔴 Extract |
| `handleJumpAction` | ~270 | 🟡 Extract |
| `dispatch()` (text parsing chain) | ~230 | 🟡 Refactor |
| `handleMoveTowardAction` | ~213 | 🟡 Extract |
| `handleClassAbility` | ~193 | 🟡 Extract |
| `handleMoveAction` | ~135 | 🟢 Ok as-is |
| 13 delegating one-liners | ~5 each | ✅ Already delegate to sub-handlers |

**Already extracted:** `GrappleHandlers` (123 lines), `InteractionHandlers` (471 lines), `SocialHandlers` (197 lines) — these follow the established pattern.

### action-service.ts (1,565 lines) — GOD CLASS

**Problem:** 12 public action methods (attack, dodge, dash, disengage, hide, search, help, castSpell, shove, grapple, escapeGrapple, move) + ~310 lines of helper functions/types at the top. `attack()` alone is ~338 lines. The shove/grapple/escapeGrapple methods are ~160-180 lines each with significant shared boilerplate (resolve encounter → validate actor → resolve target → roll dice → apply conditions → emit events).

**Method sizes (lines):**
| Method | Lines | Status |
|--------|-------|--------|
| `attack` | ~338 | 🔴 Extract |
| `shove` | ~175 | 🟡 Extract with grapple family |
| `grapple` | ~158 | 🟡 Extract with shove family |
| `escapeGrapple` | ~123 | 🟡 Extract with grapple family |
| `move` | ~98 | 🟢 Ok |
| `hide` | ~97 | 🟢 Ok |
| `search` | ~111 | 🟢 Ok |
| `dodge`, `dash`, `disengage`, `help`, `castSpell` | 4-30 each | ✅ Thin, delegate to `performSimpleAction` |

**Helper functions at top (lines 80-310):** `extractAbilityScores`, `modifier`, `clamp`, `abilityCheckEffectMods`, `hashStringToInt32`, `buildCreatureAdapter`, `parseAttackSpec`, type definitions — these are stateless utilities that should be separate modules.

### two-phase-action-service.ts (1,939 lines) — GROWING FAST

**Problem:** 8 public methods (4 initiate/complete pairs) for move, attack, spell, damage-reaction phases. Each pair is 200-500 lines. `completeMove` alone is ~435 lines (most of it is OA resolution with ActiveEffect integration). `initiateAttack`/`completeAttack` are ~190/~435 lines. New reaction types (damage reactions added recently) each add another ~250 lines to this file.

**Method sizes (lines):**
| Method | Lines | Status |
|--------|-------|--------|
| `completeMove` | ~435 | 🔴 Extract (OA resolution is a sub-problem) |
| `completeAttack` | ~435 | 🔴 Extract |
| `initiateSpellCast` | ~170 | 🟡 Extract with completeSpellCast |
| `completeSpellCast` | ~138 | 🟡 Extract with initiateSpellCast |
| `initiateMove` | ~363 | 🟡 Already somewhat clean |
| `initiateAttack` | ~192 | 🟢 Ok |
| `initiateDamageReaction` | ~81 | ✅ Small |
| `completeDamageReaction` | ~68 | ✅ Small |

---

## Decomposition Strategy

### Guiding Principles

1. **Follow the existing extraction pattern.** `GrappleHandlers`, `InteractionHandlers`, `SocialHandlers` already demonstrate the pattern: stateless handler class that receives `deps` + `eventEmitter` in constructor, with methods that match the old private method signatures.

2. **Keep the dispatcher as a thin router.** After extraction, `ActionDispatcher.dispatch()` should be ~100 lines of text parsing → route to handler, similar to how `TabletopCombatService` delegates to `ActionDispatcher`.

3. **Keep ActionService as a thin facade.** After extraction, it should hold constructor DI + routing, with each action method being a 3-line delegation.

4. **Extract by "action family" not by individual action.** Group related actions that share types and patterns (e.g., shove + grapple + escapeGrapple share reach validation, contested check, condition application).

5. **Don't change public API signatures.** The route handlers, AI executor, and test harness all consume these services — keep the same method names and return types. The refactoring is purely internal.

6. **Shared combat utilities get their own module.** Functions like `buildCreatureAdapter`, `parseAttackSpec`, `hashStringToInt32`, `abilityCheckEffectMods` that are used across multiple handlers go into a shared utilities file.

---

## Phase 1: Extract shared utilities from action-service.ts

### File: `combat/helpers/combat-utils.ts` (NEW)
- [ ] Move `extractAbilityScores()`, `modifier()`, `clamp()`, `hashStringToInt32()` — pure functions
- [ ] Move `buildCreatureAdapter()` factory function + `CreatureAdapter` type
- [ ] Move `parseAttackSpec()` input validation
- [ ] Move `abilityCheckEffectMods()` — ActiveEffect bonus computation
- [ ] Move all input type definitions (`AttackActionInput`, `SimpleActionBaseInput`, `HideActionInput`, etc.)
- [ ] Update imports in `action-service.ts` and `two-phase-action-service.ts`

**Rationale:** These are stateless utilities shared across multiple services. They have no dependency on any class — they operate on raw data. Getting them out first simplifies all subsequent extractions.

---

## Phase 2: Decompose action-dispatcher.ts

### Phase 2a: Extract AttackHandlers

#### File: `tabletop/attack-handlers.ts` (NEW, ~650 lines)
- [ ] Move `handleAttackAction()` (~589 lines) — resolves weapon spec, cover, advantage/disadvantage, two-phase initiation
- [ ] Move `handleBonusAbility()` (~438 lines) — off-hand attacks, class bonus abilities via AbilityRegistry
- [ ] Move `resolveAttackTarget()` private helper (used by both attack and direct-attack parsing)
- [ ] Move `enrichRosterWithDistances()` private helper (roster enrichment for target disambiguation)
- [ ] Constructor takes `deps: TabletopCombatServiceDeps`, `eventEmitter: TabletopEventEmitter`, `spellHandler: SpellActionHandler`, `debugLogsEnabled: boolean`

**Rationale:** Attack resolution is the single biggest responsibility in the dispatcher (1,027 lines combined). The two methods are tightly coupled (bonus ability uses the same weapon spec resolution). This mirrors the `GrappleHandlers` extraction pattern.

### Phase 2b: Extract MovementHandlers

#### File: `tabletop/movement-handlers.ts` (NEW, ~620 lines)
- [ ] Move `handleMoveAction()` (~135 lines) — pathfinding + two-phase move initiation
- [ ] Move `handleMoveTowardAction()` (~213 lines) — smart pathfinding to approach a target
- [ ] Move `handleJumpAction()` (~270 lines) — jump distance calculation, terrain landing, Acrobatics check
- [ ] Move `findNearestHostilePosition()` private helper

**Rationale:** All three handle position changes with movement economy. Jump uses overlapping logic (pathfinding, terrain checks, position updates) with move. Grouping keeps movement-related concerns together.

### Phase 2c: Extract ClassAbilityHandlers

#### File: `tabletop/class-ability-handlers.ts` (NEW, ~200 lines)
- [ ] Move `handleClassAbility()` (~193 lines) — routes through AbilityRegistry for non-bonus-action abilities

**Rationale:** This is already fairly clean and self-contained. Could potentially fold into `attack-handlers.ts` since `handleBonusAbility` is going there, but keeping separate preserves the "free ability vs bonus ability" distinction and keeps attack-handlers focused on weapon attacks.

### Phase 2d: Simplify dispatch() text-parsing chain

#### Changes in `action-dispatcher.ts` (EXISTING)
- [ ] Replace the current 20-line short-circuit chain with a `parseAction(text, roster)` function in `combat-text-parser.ts` that returns a discriminated union `{ type: 'move', data } | { type: 'attack', data } | ...`
- [ ] `dispatch()` becomes a switch on `parsedAction.type` → delegate to the appropriate handler
- [ ] The LLM fallback path stays in `dispatch()` (it needs the roster enrichment + intent parser)

**Rationale:** The current parsing chain (`directMove || directMoveToward || directJump || ...`) is 30+ lines of cascading null checks. A single `parseAction()` function with early return is clearer and makes adding new action types a one-line addition.

### Post Phase 2 state of action-dispatcher.ts

Should be ~200-250 lines: constructor instantiating handler classes + `dispatch()` routing + LLM fallback. Comparable to `tabletop-combat-service.ts` (435 lines facade).

---

## Phase 3: Decompose action-service.ts

### Phase 3a: Extract AttackActionHandler

#### File: `combat/actions/attack-action-handler.ts` (NEW, ~400 lines)
- [ ] Move `attack()` method body (~338 lines) — the full attack resolution pipeline
- [ ] Constructor takes `sessions`, `combat`, `combatants`, `events` (same deps as ActionService)
- [ ] Uses utilities from `combat-utils.ts` (`buildCreatureAdapter`, `parseAttackSpec`, etc.)

**Rationale:** `attack()` is the biggest method and has the most complex ActiveEffect integration (advantage/disadvantage, AC bonuses, extra damage, retaliatory damage, concentration checks). Isolating it means changes to attack resolution don't risk breaking dodge/hide/grapple.

### Phase 3b: Extract GrappleActionHandler

#### File: `combat/actions/grapple-action-handler.ts` (NEW, ~500 lines)
- [ ] Move `shove()` (~175 lines)
- [ ] Move `grapple()` (~158 lines)  
- [ ] Move `escapeGrapple()` (~123 lines)
- [ ] Share the common pattern: resolve encounter → validate reach → contested check → apply condition → emit event

**Rationale:** These three methods share identical boilerplate (encounter resolution, reach validation, ability modifier extraction, contested check pattern). A single handler class can share that setup.

### Phase 3c: Extract SkillActionHandler

#### File: `combat/actions/skill-action-handler.ts` (NEW, ~250 lines)
- [ ] Move `hide()` (~97 lines)
- [ ] Move `search()` (~111 lines)
- [ ] Both follow the same pattern: validate actor → dice roll → apply conditions/reveal → emit event

**Rationale:** Hide and Search are skill-based actions with similar structure. They share the same deps and follow the same resolve → roll → apply pattern.

### Phase 3d: Slim ActionService to facade

#### Changes to `combat/action-service.ts` (EXISTING, target ~250 lines)
- [ ] Constructor creates `AttackActionHandler`, `GrappleActionHandler`, `SkillActionHandler`
- [ ] `attack()` → `this.attackHandler.execute(sessionId, input)`
- [ ] `shove()` → `this.grappleHandler.shove(sessionId, input)`
- [ ] `grapple()` → `this.grappleHandler.grapple(sessionId, input)`
- [ ] `escapeGrapple()` → `this.grappleHandler.escapeGrapple(sessionId, input)`
- [ ] `hide()` → `this.skillHandler.hide(sessionId, input)`
- [ ] `search()` → `this.skillHandler.search(sessionId, input)`
- [ ] Keep `dodge()`, `dash()`, `disengage()`, `help()`, `castSpell()` inline (they delegate to `performSimpleAction` and are 4-30 lines each)
- [ ] Keep `move()` inline (98 lines, clean, no strong extraction case)
- [ ] Keep `performSimpleAction()` inline (shared template method for simple actions)

**Rationale:** The facade pattern is proven by TabletopCombatService. Public API stays identical. Route handlers, AI executor, and tests see no change.

### Post Phase 3 state of action-service.ts

Should be ~350-400 lines: types + facade constructor + thin delegation methods + `performSimpleAction` template + `move()`.

---

## Phase 4: Decompose two-phase-action-service.ts

### Phase 4a: Extract OpportunityAttackResolver

#### File: `combat/helpers/opportunity-attack-resolver.ts` (NEW, ~350 lines)
- [ ] Extract the OA resolution loop from `completeMove()` — the 200+ line block that rolls attacks, applies ActiveEffect modifiers, resolves damage defenses, applies retaliatory damage, tracks rage, and emits events
- [ ] Pure function or small class: `resolveOpportunityAttacks(pendingAction, combatants, combatantResolver, diceRollerFactory, combatRepo): OAResult[]`
- [ ] Also used by AI movement resolver (currently duplicates some OA logic)

**Rationale:** The OA resolution is the single biggest source of complexity in `completeMove()`. It's a self-contained sub-problem (given a list of resolved reactions, roll and apply each OA) with no dependency on the two-phase pending-action state.

### Phase 4b: Extract ReactionPhaseHandlers

#### File: `combat/two-phase/move-reaction-handler.ts` (NEW, ~450 lines)
- [ ] Move `initiateMove()` + `completeMove()` (after OA resolver extraction, completeMove drops to ~200 lines)
- [ ] Uses `OpportunityAttackResolver` for the OA loop

#### File: `combat/two-phase/attack-reaction-handler.ts` (NEW, ~450 lines)  
- [ ] Move `initiateAttack()` + `completeAttack()`
- [ ] Attack reaction detection (Shield spell, etc.) lives here

#### File: `combat/two-phase/spell-reaction-handler.ts` (NEW, ~320 lines)
- [ ] Move `initiateSpellCast()` + `completeSpellCast()`
- [ ] Counterspell/Shield reaction detection lives here

#### Keep in two-phase-action-service.ts:
- [ ] `initiateDamageReaction()` + `completeDamageReaction()` (~150 lines combined — small enough to stay)
- [ ] The service constructor + shared pending-action lifecycle utilities
- [ ] `applyVoluntaryMoveTriggers()` private helper (can stay or move to move-reaction-handler)

### Phase 4c: Slim TwoPhaseActionService to facade

#### Changes to `combat/two-phase-action-service.ts` (EXISTING, target ~300 lines)
- [ ] Constructor creates `MoveReactionHandler`, `AttackReactionHandler`, `SpellReactionHandler`
- [ ] `initiateMove()` → `this.moveHandler.initiate(sessionId, input)`
- [ ] `completeMove()` → `this.moveHandler.complete(sessionId, input)`
- [ ] Same pattern for attack and spell pairs
- [ ] Keep damage reaction methods inline (small)

### Post Phase 4 state of two-phase-action-service.ts

Should be ~300-350 lines: constructor + thin delegation + damage reaction pair.

---

## Execution Order & Dependencies

```
Phase 1 (shared utils)         ← no deps, do first
  ↓
Phase 2 (action-dispatcher)    ← uses Phase 1 utils
Phase 3 (action-service)       ← uses Phase 1 utils, independent of Phase 2
  ↓ ↓
Phase 4 (two-phase-action)     ← uses Phase 1 utils, can use Phase 3 handlers
```

**Phases 2 and 3 are independent** and can be done in parallel.
Phase 4 depends on Phase 1 only, so it can also run in parallel with 2 and 3.

---

## Cross-Flow Risk Checklist

- [ ] Do changes in one flow break assumptions in another?
  - **Risk:** AI executor (`ai-action-executor.ts`) imports `ActionService` and `TwoPhaseActionService` by type. Facade pattern preserves the interface, so no breakage.
  - **Risk:** Route handlers import both services. Same — facade interface unchanged.
- [ ] Does the pending action state machine still have valid transitions?
  - **No changes to state machine.** The initiate/complete lifecycle stays in the facade. Only internal method bodies are extracted.
- [ ] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)?
  - **No changes to economy logic.** It moves to handler modules 1:1.
- [ ] Do both player AND AI paths handle the change?
  - **Yes.** AI uses `ActionService.attack()` and `TwoPhaseActionService.initiateMove()` — those remain as facade methods.
- [ ] Are repo interfaces + memory-repos updated if entity shapes change?
  - **No entity shape changes.** This is a pure structural refactoring.
- [ ] Is `app.ts` registration updated if adding executors?
  - **No new executors.** The handler classes are internal to the service — not registered in app.ts.
- [ ] Are D&D 5e 2024 rules correct (not 2014)?
  - **No rule changes.** Logic moves verbatim.

---

## File Inventory (net new files)

| Phase | New File | Est. Lines | Extracted From |
|-------|----------|------------|----------------|
| 1 | `combat/helpers/combat-utils.ts` | ~250 | action-service.ts top |
| 2a | `tabletop/attack-handlers.ts` | ~650 | action-dispatcher.ts |
| 2b | `tabletop/movement-handlers.ts` | ~620 | action-dispatcher.ts |
| 2c | `tabletop/class-ability-handlers.ts` | ~200 | action-dispatcher.ts |
| 3a | `combat/actions/attack-action-handler.ts` | ~400 | action-service.ts |
| 3b | `combat/actions/grapple-action-handler.ts` | ~500 | action-service.ts |
| 3c | `combat/actions/skill-action-handler.ts` | ~250 | action-service.ts |
| 4a | `combat/helpers/opportunity-attack-resolver.ts` | ~350 | two-phase-action-service.ts |
| 4b | `combat/two-phase/move-reaction-handler.ts` | ~450 | two-phase-action-service.ts |
| 4b | `combat/two-phase/attack-reaction-handler.ts` | ~450 | two-phase-action-service.ts |
| 4b | `combat/two-phase/spell-reaction-handler.ts` | ~320 | two-phase-action-service.ts |

**Reduced file sizes:**
| File | Before | After |
|------|--------|-------|
| `action-dispatcher.ts` | 2,143 | ~250 |
| `action-service.ts` | 1,565 | ~350 |
| `two-phase-action-service.ts` | 1,939 | ~300 |

**Total lines stay the same** — this is a structural refactoring, not a reduction.

---

## Risks

1. **Import path churn.** 11 new files = many new import paths. Mitigated by barrel exports (`index.ts` files) and keeping public API surfaces unchanged.

2. **Test coverage during extraction.** Moving code to new files can introduce subtle bugs (wrong `this` context, missing closure variables). Mitigated by: run full test suite after each phase, no logic changes during extraction.

3. **Merge conflicts with in-flight work.** If other features are being developed against the old file structure, this will conflict. Mitigate by doing this as a dedicated sprint with no other combat changes in flight.

4. **Over-extraction.** Some small methods (handleMoveAction at 135 lines) are fine where they are. The plan deliberately leaves `move()`, `dodge()`, `dash()`, etc. inline when they're small enough. Don't extract for the sake of extracting.

---

## Test Plan

- [ ] `pnpm -C packages/game-server typecheck` passes after each phase
- [ ] `pnpm -C packages/game-server test` passes after each phase (unit + integration)
- [ ] `pnpm -C packages/game-server test:e2e:combat:mock` passes after each phase (43 scenarios)
- [ ] No new test files needed — this is a structural refactoring. Existing tests exercise the public API which doesn't change.
- [ ] After Phase 2d (dispatch simplification), verify LLM fallback path still works with intent-parsing E2E tests

---

## Open Questions

1. **Should `roll-state-machine.ts` (1,555 lines) be included?** It has a different problem shape (sequential roll processing, not action routing). Deferred to a separate plan.
answer: No, defer to separate plan focused on roll processing architecture.

2. **Should `combat-text-parser.ts` (616 lines) get the unified `parseAction()` function?** Phase 2d proposes this, but it could also stay as individual `tryParse*` functions if the discriminated union approach feels over-engineered.
answer: Yes, unify under `parseAction()` for a single source of truth and easier extension.

3. **Should `action-service.ts` be renamed to something more specific after slimming?** It would still handle dodge/dash/disengage/move/help/castSpell — arguably "simple actions." Could rename to `simple-action-service.ts` with the facade becoming the new `action-service.ts`. Or keep the name since all callers import it already.
answer: Keep the name for continuity. The public API is unchanged, and "ActionService" still makes sense as a facade name.

4. **Should the `combat/actions/` subfolder mirror `tabletop/` naming?** The tabletop folder handles the text-based (player-CLI) path while `combat/actions/` handles the programmatic (API) path. Having both is somewhat confusing. Could unify under `combat/handlers/` instead.
answer: Yes, make it clearer