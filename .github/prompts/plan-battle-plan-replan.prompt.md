# Plan: Improve `shouldReplan` Heuristics in BattlePlanService

## Round: 1
## Status: DONE
## Affected Flows: AIBehavior

---

## Objective

The current `shouldReplan` only checks if the plan is 2+ rounds old (stale-round heuristic) and has a TODO placeholder for the focus-target check. This means faction AI can waste its plan slot holding a stale strategy after a critical battlefield shift (ally died, 25%+ HP lost, new threat entered). Add data-driven heuristics backed by a generation-time snapshot embedded in the plan.

---

## Analysis

### Why `shouldReplan` can't call async services
`shouldReplan` is a **private sync method** — it can't call `FactionService` (async). The fix is to **embed a snapshot into `BattlePlan`** at generation time so heuristics run on stored data without async calls.

### What data is available at generation time (in `ensurePlan`)
`ensurePlan` already calls `getAllies()` and `getEnemies()`, giving us:
- Living allies: `[combatant, ...allies].filter(hpCurrent > 0)`
- Living enemies: `enemies.filter(hpCurrent > 0)`

### Snapshot fields to add (all optional for backward compat)
| Field | Type | Purpose |
|-------|------|---------|
| `allyHpAtGeneration` | `Record<string, number>` | combatantId → hpCurrent at plan creation |
| `livingAllyIdsAtGeneration` | `string[]` | IDs of living allies when plan was generated |
| `livingEnemyIdsAtGeneration` | `string[]` | IDs of living enemies when plan was generated |

### Thresholds (named constants, not magic numbers)
```typescript
const REPLAN_STALE_ROUNDS = 2;          // plan age in rounds before forced replan
const REPLAN_HP_LOSS_THRESHOLD = 0.25;  // 25% of max HP lost triggers replan
```

---

## Changes

### AIBehavior Flow

#### [File: `application/services/combat/ai/battle-plan-types.ts`]
- [x] Add 3 optional snapshot fields to `BattlePlan` interface with JSDoc

#### [File: `application/services/combat/ai/battle-plan-service.ts`]
- [x] Add `REPLAN_STALE_ROUNDS` and `REPLAN_HP_LOSS_THRESHOLD` constants (module-level)
- [x] In `ensurePlan`: after getting allies/enemies, compute snapshot and embed in generated plan
- [x] Replace `shouldReplan` body with 4 documented heuristics:
  1. **Stale plan** (existing): `round - generatedAtRound >= REPLAN_STALE_ROUNDS`
  2. **Ally died**: any ID in `livingAllyIdsAtGeneration` now has `hpCurrent <= 0`
  3. **Ally lost significant HP**: any ally in `allyHpAtGeneration` lost > `REPLAN_HP_LOSS_THRESHOLD * hpMax`
  4. **New enemy entered**: any living combatant has an ID not in ally OR enemy snapshot sets

#### [File: `application/services/combat/ai/battle-plan-service.test.ts`] (new)
- [x] Unit tests for all 4 heuristics (each true and false case)
- [x] Backward compatibility: plan without snapshot fields falls through to stale-round check

---

## Cross-Flow Risk Checklist
- [x] Only one flow (AIBehavior) — no cross-flow risk
- [x] Pending action state machine unaffected
- [x] Action economy unaffected
- [x] AI path unchanged (LLM still generates plan, service adds snapshot)
- [x] `BattlePlan` is stored as `JsonValue` — optional fields survive JSON round-trip
- [x] Backward compatible: all new fields are optional; existing stored plans still work
- [x] D&D 5e 2024 rules: no rule changes, this is AI heuristic improvement

---

## Risks
- **JSON round-trip fidelity**: optional fields survive `JSON.stringify/parse` (they do, undefined keys are skipped). Plans without snapshot fields simply skip new heuristics — stale-round check still applies.
- **Ally ID collisions**: extremely unlikely, IDs are nanoid-generated

---

## Test Plan
- [x] Unit tests: `battle-plan-service.test.ts` — all 4 heuristics + backward compat
- [x] No E2E scenario changes needed (battle plan re-planning not tested in E2E scenarios)
- [x] Typecheck must pass

## Implementation Notes
- When the `planner.generatePlan()` returns `newPlan`, spread snapshot fields onto it AFTER generation (planner doesn't need to know about snapshot)
- `shouldReplan` builds Maps/Sets from snapshot arrays for O(1) lookups
